import { useSyncExternalStore } from 'react';
import { openDB } from 'idb';
import { previewReschedule } from './domain.js';

const base = import.meta.env.BASE_URL;
const listeners = new Set();
const freshContext = () => ({page:'itinerary',dayId:null,drafts:{},map:{},scroll:{}});
let state = {ready:false,user:null,config:null,trips:[],snapshot:null,context:freshContext(),status:'checking',error:null,pendingCount:0,pendingRecoveryGroups:[],recoveryBusy:false,tripsLoadState:{status:'idle',error:null,hasLoaded:false},sessionExpired:false};
let account=null, selected=null, csrf='', source=null, flushing=false, loadPromise=null, lease=null, leasePerformance=0, leaseWall=0, notifyTimer=null;
let authEpoch=0, refreshSeq=0, database, persistChain=Promise.resolve();
let deviceId, connection='checking', recoveryPaused=false, recoveryToken=null, localChain=Promise.resolve();
const flushWaiters=new Set();
const serializeLocal=job=>{const result=localChain.catch(()=>{}).then(job);localChain=result.catch(()=>{});return result;};
function captureScope(){return {accountId:account?.user.id,tripId:selected,epoch:authEpoch};}
function requireScope(scope,selection=false){if(scope&&(scope.epoch!==authEpoch||scope.accountId!==account?.user.id||(selection&&scope.tripId!==selected)))throw changedSession();}
function operationSummary(op,objects){
  const existing=objects.get(op.objectId),patch=op.patch||{},kind=op.objectId===op.tripId?'trip':op.objectType||existing?.kind;
  const value={...(existing?.payload||{}),...patch};
  if(op.kind!=='create'&&!existing)return '修改已不可用的内容';
  const label={trip:'旅程',activity:'活动',expense:'费用',favorite:'地点',day:'日期',route:'路线'}[kind]||'内容';
  const objectName=id=>{const object=objects.get(id);return object?.payload?.title||object?.payload?.name||'';};
  const routeName=kind==='route'?[objectName(value.fromId)||value.fromPlace?.name,objectName(value.toId)].filter(Boolean).join(' → '):'';
  const name=String(value.title||value.name||routeName||(kind==='day'?(value.date||`第 ${value.ordinal} 天`):'')).slice(0,80),target=label+(name?`「${name}」`:'');
  const action={create:'添加',patch:'修改',delete:'删除',restore:'恢复',express:'更新意愿',reschedule:'调整日期'}[op.kind]||'更新';
  const details=[];
  if(op.kind==='express'){const labels={notParticipating:'不参与',wishDelete:'删除意愿',wishRestore:'恢复意愿'};for(const [key,text]of Object.entries(labels))if(key in (op.expression||{}))details.push((op.expression[key]?'设置':'取消')+text);}
  if(op.kind==='reschedule'){
    const count=patch.dayCount;
    if(patch.startDate){const end=new Date(`${patch.startDate}T12:00:00Z`);end.setUTCDate(end.getUTCDate()+count-1);details.push(`${patch.startDate} 至 ${end.toISOString().slice(0,10)}`);}
    else details.push(`共 ${count} 天，日期待定`);
    if(patch.moves?.length)details.push(`移动 ${patch.moves.length} 项活动`);
  }else if(op.kind==='create'||op.kind==='patch'){
    if(kind==='trip'&&'destination'in patch)details.push(`目的地：${patch.destination}`);
    if(kind==='expense'&&patch.payment){const payment=patch.payment;const digits=new Intl.NumberFormat('zh-CN',{style:'currency',currency:payment.currency}).resolvedOptions().maximumFractionDigits;details.push((payment.status==='paid'?'已支付':'预计')+(payment.amountMinor===null?'，金额待定':` ${payment.currency} ${payment.amountMinor/10**digits}`));}
    const fields={notes:'备注',time:'时间',dayId:'所属日期',place:'地点',url:'链接',order:'顺序',activityId:'关联活动',teamMode:'协作方式',currency:'默认币种',timezone:'时区',startDate:'开始日期',dayCount:'天数',buffers:'预留时间',fromId:'出发地',fromPlace:'出发地',toId:'目的地',mode:'交通方式',minutes:'耗时'};
    if(op.kind==='patch')for(const [key,text]of Object.entries(fields))if(key in patch)details.push(text);
  }
  if(op.kind==='create')objects.set(op.objectId,{kind,payload:clone(patch)});
  else if(op.kind==='patch'&&existing)Object.assign(existing.payload,clone(patch));
  return action+target+(details.length?' · '+details.join('，'):'');
}
function recoveryGroups(){
  if(!account)return [];
  const groups=[];
  for(const tripId of new Set(account.queue.map(op=>op.tripId))){
    const tripOps=account.queue.filter(op=>op.tripId===tripId),index=tripOps.findIndex(op=>op.blocked||op.clock?.uncertain||op.receiptUnknown);
    if(index<0)continue;
    const suffix=tripOps.slice(index),first=suffix[0],snapshot=account.snapshots[tripId],hasUnknownReceipt=suffix.some(op=>op.receiptUnknown);
    const objects=new Map((snapshot?.objects||[]).map(object=>[object.id,clone(object)]));
    const trip=snapshot?.trip||account.trips.find(value=>value.id===tripId);if(trip)objects.set(tripId,{kind:'trip',payload:clone(trip)});
    const summaries=new Map(tripOps.map(op=>[op.id,operationSummary(op,objects)]));
    groups.push({id:first.id,opIds:suffix.map(op=>op.id),tripId,tripName:account.trips.find(t=>t.id===tripId)?.name||'旅程',reason:first.blocked||(first.receiptUnknown?'RECEIPT_UNKNOWN':'CLOCK_UNCERTAIN'),canReapply:Boolean((first.blocked==='CLOCK_UNCERTAIN'||(!first.blocked&&first.clock?.uncertain))&&!hasUnknownReceipt),canDiscard:!hasUnknownReceipt,operations:suffix.map(op=>({id:op.id,summary:summaries.get(op.id)}))});
  }
  return groups;
}
const changedSession=()=>Object.assign(new Error('账户已切换，请在当前账户继续操作'),{code:'SESSION_CHANGED'});
const requireCurrent=(epoch,owner)=>{if(epoch!==authEpoch||owner!==account)throw changedSession();};
const db = () => database ||= openDB('journey-v1',1,{upgrade(d){d.createObjectStore('kv');}});
const emit = patch => {state={...state,...patch};for(const fn of listeners)fn();};
const clone = value => structuredClone(value);
const message = e => e instanceof Error ? e.message : String(e);
const setError = e => emit({error:{message:message(e),code:e.code||'ERROR',details:e.details},status:e.code==='NETWORK'?'offline':'error'});
const emptyAccount = user => ({user,trips:[],snapshots:{},contexts:{},lastTripId:null,queue:[]});

export async function api(path,{body,method='GET',...options}={}) {
  let res;const requestEpoch=authEpoch;
  try {res=await fetch(base.replace(/\/$/,'')+path,{method,credentials:'same-origin',...options,headers:{...(body!==undefined?{'Content-Type':'application/json'}:{}),...(method!=='GET'&&csrf?{'X-CSRF-Token':csrf}:{}),...options.headers},...(body!==undefined?{body:JSON.stringify(body)}:{})});}
  catch {if(requestEpoch===authEpoch){connection='offline';emit({status:'offline'});}const error=new Error('连接中断，修改会在联网后继续同步');error.code='NETWORK';throw error;}
  let value;
  try {value=await res.json();}catch{if(res.ok){if(requestEpoch===authEpoch){connection='offline';emit({status:'offline'});}throw Object.assign(new Error('连接中断，正在确认同步结果'),{code:'NETWORK'});}value={};}
  if(!res.ok){const e=new Error(value.error?.message||'请求失败，请重试');e.code=value.error?.code||'REQUEST_FAILED';e.status=res.status;e.details=value.error?.details;throw e;}
  return value;
}

async function persist() {
  const owner=account;
  if(!owner)return;
  // A single transaction persists both the operation queue and its local display.
  const job=async()=>{const d=await db();const snapshot=clone(owner);await d.put('kv',snapshot,`account:${snapshot.user.id}`);};
  persistChain=persistChain.catch(()=>{}).then(job);
  try {await persistChain;}catch(e){const err=new Error('此设备未能保存修改，请保持页面打开并释放存储空间后重试');err.code='LOCAL_STORAGE';setError(err);throw err;}
}

function optimistic(snapshot,queue) {
  if(!snapshot)return null;
  let next=clone(snapshot);
  for(const op of queue.filter(x=>x.tripId===snapshot.trip.id)) {
    const obj=op.objectId===next.trip.id?next.trip:next.objects.find(x=>x.id===op.objectId);
    if(op.kind==='reschedule'){try{next=previewReschedule(next,op.patch);}catch{/* A remote deletion may invalidate an already queued date change. Keep the queue for recovery. */}}
    else if(op.kind==='create'&&!obj)next.objects.push({id:op.objectId,tripId:op.tripId,kind:op.objectType,payload:clone(op.patch),state:'active',generation:0,expressions:[]});
    else if(op.kind==='patch'&&obj){if(obj===next.trip)Object.assign(obj,op.patch);else Object.assign(obj.payload,op.patch);}
    else if((op.kind==='delete'||op.kind==='restore')&&obj&&obj.generation===op.generation){obj.state=op.kind==='delete'?'deleted':'active';obj.generation++;}
    else if(op.kind==='express'&&obj){obj.expressions||=[];let expr=obj.expressions.find(x=>x.userId===account.user.id);if(!expr){expr={userId:account.user.id};obj.expressions.push(expr);}Object.assign(expr,op.expression);}
  }
  return next;
}
function renderAccount(extra={}) {
  if(!account)return;
  const pending=account.queue.length;
  emit({user:account.user,trips:account.trips,snapshot:selected?optimistic(account.snapshots[selected],account.queue):null,
    context:selected?(account.contexts[selected]||freshContext()):freshContext(),pendingCount:pending,
    pendingRecoveryGroups:recoveryGroups(),status:!navigator.onLine||connection==='offline'?'offline':state.error?'error':connection==='checking'?'checking':recoveryGroups().length?'blocked':pending?'syncing':'synced',...extra});
}
function acceptSnapshot(snapshot) {
  if(!account||!snapshot?.trip)return;
  const old=account.snapshots[snapshot.trip.id];
  if(old&&((old.epoch??0)>(snapshot.epoch??0)||((old.epoch??0)===(snapshot.epoch??0)&&old.cursor>snapshot.cursor)))return;
  account.snapshots[snapshot.trip.id]=snapshot;
  const index=account.trips.findIndex(x=>x.id===snapshot.trip.id);
  if(index<0)account.trips.push(snapshot.trip);else account.trips[index]={...account.trips[index],...snapshot.trip};
}
async function calibrate() {
  const epoch=authEpoch,owner=account;
  const start=performance.now();
  const r=await api('/api/clock',{method:'POST',body:{deviceId}});
  requireCurrent(epoch,owner);
  const end=performance.now();
  lease={...r,uncertaintyMs:Math.ceil((end-start)/2)+2};
  leasePerformance=(start+end)/2;leaseWall=Date.now()-(end-leasePerformance);
}
function operationClock() {
  if(!lease)return {leaseId:null,elapsedMs:0,uncertaintyMs:0,uncertain:true};
  const elapsed=performance.now()-leasePerformance;
  const changed=Math.abs((Date.now()-leaseWall)-elapsed)>2000;
  return {leaseId:lease.leaseId,elapsedMs:Math.max(0,Math.round(elapsed)),uncertaintyMs:lease.uncertaintyMs+Math.ceil(elapsed*0.00005),...(changed||lease.serverTime+elapsed>lease.expiresAt?{uncertain:true}:{})};
}
async function synchronizeSession() {
  let epoch=authEpoch;
  const s=await api('/api/session');
  if(epoch!==authEpoch)throw changedSession();
  if(account&&account.user.id!==s.user.id){epoch=++authEpoch;selected=null;closeSource();}
  const stored=await (await db()).get('kv',`account:${s.user.id}`);
  if(epoch!==authEpoch)throw changedSession();
  csrf=s.csrfToken;
  account=account?.user.id===s.user.id?account:stored||emptyAccount(s.user);
  account.user=s.user;
  await (await db()).put('kv',s.user.id,'activeUser');
  if(epoch!==authEpoch)throw changedSession();
  emit({sessionExpired:false});
  await calibrate();
}
async function initialize() {
  try {
    const d=await db();deviceId=await d.get('kv','deviceId');if(!deviceId){deviceId=crypto.randomUUID();await d.put('kv',deviceId,'deviceId');}
    const id=await d.get('kv','activeUser');
    if(id){account=await d.get('kv',`account:${id}`);if(account)renderAccount();}
    try {const config=await api('/api/config');emit({config});await d.put('kv',config,'config');}
    catch(e){const config=await d.get('kv','config');if(config)emit({config});if(e.code!=='NETWORK')setError(e);}
    try {await synchronizeSession();await refreshTrips();}
    catch(e){if(e.status===401){csrf='';emit({sessionExpired:!!account,user:null});}else {emit({tripsLoadState:{...state.tripsLoadState,status:'error',error:message(e)}});if(e.code!=='NETWORK')setError(e);}}
    emit({ready:true,...(!navigator.onLine?{status:'offline'}:{})});
    if(account&&!state.sessionExpired)void flush();
  }catch(e){setError(e);emit({ready:true});}
}
async function refreshTrips() {
  const epoch=authEpoch;
  emit({tripsLoadState:{...state.tripsLoadState,status:'loading',error:null}});
  let r;try{r=await api('/api/trips');}catch(e){if(epoch===authEpoch)emit({tripsLoadState:{...state.tripsLoadState,status:'error',error:message(e)}});throw e;}
  if(epoch!==authEpoch||!account)return;
  connection='current';if(state.error?.code==='NETWORK')emit({error:null});account.trips=r.trips;
  emit({tripsLoadState:{status:'ready',error:null,hasLoaded:true}});
  if(r.navigation){
    account.lastTripId ||= r.navigation.lastTripId;
    for(const [id,ctx]of Object.entries(r.navigation.contexts||{}))if(!account.contexts[id])account.contexts[id]=ctx;
  }
  renderAccount();await persist();return r;
}
async function refresh() {
  const id=selected,epoch=authEpoch,seq=++refreshSeq;
  if(!id)return refreshTrips();
  try {
    const r=await api(`/api/trips/${id}`);
    if(epoch!==authEpoch||seq!==refreshSeq||!account)return;
    connection='current';if(state.error?.code==='NETWORK')emit({error:null});acceptSnapshot(r);renderAccount();await persist();
  }catch(e){if(epoch!==authEpoch)return;await accessFailure(e,id);throw e;}
}
async function accessFailure(e,id) {
  const epoch=authEpoch,owner=account;
  return serializeLocal(async()=>{
  requireCurrent(epoch,owner);
  if(e.status===401){closeSource();csrf='';emit({sessionExpired:true});}
  else if(e.status===403||e.status===404||e.status===410){
    closeSource();
    if(e.status===410||e.code==='TRIP_PURGED'){
      delete account.snapshots[id];delete account.contexts[id];account.queue=account.queue.filter(x=>x.tripId!==id);
    }
    account.trips=account.trips.filter(x=>x.id!==id);if(selected===id)selected=null;
    renderAccount();await persist();
  }
  setError(e);
  });
}
function closeSource(){source?.close();source=null;}
function subscribeTrip(id) {
  closeSource();if(!navigator.onLine)return;
  const epoch=authEpoch;
  source=new EventSource(base.replace(/\/$/,'')+`/api/trips/${id}/events`);
  source.addEventListener('change',async event=>{
    if(epoch!==authEpoch||selected!==id)return;
    let notice;try{notice=JSON.parse(event.data);}catch{return;}
    const current=account.snapshots[id];
    if((notice.epoch??0)<(current?.epoch??0)||((notice.epoch??0)===(current?.epoch??0)&&notice.cursor<=(current?.cursor??-1)))return;
    try {await refresh();maybeNotify();}catch{/* refresh sets recoverable error */}
  });
  source.addEventListener('revoked',()=>{if(epoch===authEpoch)void refresh().catch(()=>{});});
  source.onopen=()=>{if(epoch===authEpoch)void refresh().catch(()=>{});};
  source.onerror=()=>{if(epoch===authEpoch)void refresh().catch(e=>{if(epoch===authEpoch&&e.code==='NETWORK')emit({status:'offline'});});};
}
function maybeNotify() {
  if(!account?.user.preferences?.collaborationNotifications||document.visibilityState!=='hidden'||!('Notification'in window)||Notification.permission!=='granted'||flushing)return;
  clearTimeout(notifyTimer);notifyTimer=setTimeout(()=>new Notification('旅程有新变化',{body:account?.snapshots[selected]?.trip.name||'同伴更新了旅程',tag:`journey-${selected}`,icon:base+'icon.svg'}),1200);
}
async function openTrip(id) {
  if(!account)throw new Error('请先登录');
  const epoch=authEpoch,owner=account;
  selected=id;account.lastTripId=id;account.contexts[id]||=freshContext();
  if(account.contexts[id].page==='settings')account.contexts[id]={...account.contexts[id],page:'itinerary'};
  emit({error:null});renderAccount();await persist();
  requireCurrent(epoch,owner);if(selected!==id)return;
  void api('/api/navigation',{method:'PUT',body:{lastTripId:id,tripId:id,context:account.contexts[id]}}).catch(()=>{});
  try{await refresh();requireCurrent(epoch,owner);if(selected!==id)return;subscribeTrip(id);void flush();}catch(e){if(e.code==='NETWORK'&&epoch===authEpoch&&owner===account&&account.snapshots[id]){emit({error:null,status:'offline'});}else throw e;}
}
async function goHome() {const epoch=authEpoch,owner=account,id=selected;await persist();requireCurrent(epoch,owner);if(selected!==id)return;selected=null;closeSource();renderAccount();if(navigator.onLine)void refreshTrips().catch(e=>{if(e.code!=='NETWORK'&&epoch===authEpoch)setError(e);});}
async function login(challengeId,code,displayName) {
  const previousUserId=account?.user.id,previousTrip=selected;
  const epoch=++authEpoch;
  const passwordMode=typeof challengeId==='object';
  const r=await api(passwordMode ? challengeId.register ? '/api/auth/register' : '/api/auth/login' : '/api/auth/verify',{method:'POST',body:passwordMode?{identifier:challengeId.identifier,password:challengeId.password,...(challengeId.register?{displayName:challengeId.displayName}:{})}:{challengeId,code,displayName}});
  if(epoch!==authEpoch)throw changedSession();
  const stored=await (await db()).get('kv',`account:${r.user.id}`);
  if(epoch!==authEpoch)throw changedSession();
  csrf=r.csrfToken;closeSource();selected=null;lease=null;connection='checking';emit({tripsLoadState:{status:'idle',error:null,hasLoaded:false}});
  account=stored||emptyAccount(r.user);account.user=r.user;
  await(await db()).put('kv',r.user.id,'activeUser');if(epoch!==authEpoch)throw changedSession();emit({error:null,sessionExpired:false});await calibrate();if(epoch!==authEpoch)throw changedSession();await refreshTrips();if(epoch!==authEpoch)throw changedSession();renderAccount();if(previousTrip&&previousUserId===r.user.id)await openTrip(previousTrip);void flush();return r;
}
async function logout() {
  const epoch=++authEpoch,owner=account;
  await persist();await api('/api/auth/logout',{method:'POST'});
  requireCurrent(epoch,owner);closeSource();csrf='';lease=null;selected=null;account=null;
  await(await db()).delete('kv','activeUser');recoveryToken=null;recoveryPaused=false;emit({user:null,snapshot:null,trips:[],context:freshContext(),error:null,pendingCount:0,pendingRecoveryGroups:[],recoveryBusy:false,tripsLoadState:{status:'idle',error:null,hasLoaded:false},sessionExpired:false,status:'synced'});
}
async function createTrip(form) {
  const epoch=authEpoch,owner=account;
  const r=await api('/api/trips',{method:'POST',body:{id:crypto.randomUUID(),...form}});requireCurrent(epoch,owner);acceptSnapshot(r);await openTrip(r.trip.id);return r;
}
async function joinTrip(code) {const epoch=authEpoch,owner=account;const r=await api('/api/invites/accept',{method:'POST',body:{code}});requireCurrent(epoch,owner);acceptSnapshot(r);await openTrip(r.trip.id);return r;}
async function mutate(input,scope=captureScope()) {
  if(!account||!selected)throw new Error('请先打开旅程');
  requireScope(scope,true);
  const op={...clone(input),id:crypto.randomUUID(),tripId:selected,clock:operationClock()};
  return serializeLocal(async()=>{
    requireScope(scope,true);
    if(op.kind==='reschedule')previewReschedule(state.snapshot,op.patch);
    const epoch=authEpoch,owner=account;
    account.queue.push(op);renderAccount({error:null});
    await persist();requireCurrent(epoch,owner);renderAccount();void flush();return op;
  });
}
async function flush() {
  if(flushing||recoveryPaused||!account||!csrf||state.sessionExpired||!navigator.onLine)return;
  flushing=true;const epoch=authEpoch;
  try {
    const attempted=new Set(),pausedTrips=new Set();
    while(epoch===authEpoch&&account&&!recoveryPaused) {
      const op=account.queue.find(x=>!attempted.has(x.id)&&!pausedTrips.has(x.tripId));
      if(!op)break;
      attempted.add(op.id);
      if(op.blocked){pausedTrips.add(op.tripId);continue;}
      if(op.clock.uncertain&&!op.receiptUnknown){op.blocked='CLOCK_UNCERTAIN';pausedTrips.add(op.tripId);await persist();renderAccount();continue;}
      try {
        const {tripId,blocked,failure,receiptUnknown,...body}=op;
        const r=await api(`/api/trips/${op.tripId}/operations`,{method:'POST',body});
        if(epoch!==authEpoch||!account)break;
        connection='current';if(state.error?.code==='NETWORK')emit({error:null});
        await serializeLocal(async()=>{requireCurrent(epoch,account);acceptSnapshot(r.snapshot);const candidate=clone(account);candidate.queue=candidate.queue.filter(x=>x.id!==op.id);await persistCandidate(candidate,epoch,account);});renderAccount();
      }catch(e){
        if(epoch!==authEpoch||!account)break;
        if(e.code==='LOCAL_STORAGE'){setError(e);break;}
        if(e.code==='NETWORK'){op.receiptUnknown=true;await persist();renderAccount();break;}
        if(e.status===401){emit({sessionExpired:true});closeSource();break;}
        if(e.status===410||e.code==='TRIP_PURGED'){await accessFailure(e,op.tripId);continue;}
        delete op.receiptUnknown;op.blocked=e.code||'FAILED';op.failure=message(e);pausedTrips.add(op.tripId);await persist();renderAccount();
        if(e.status===403||e.status===404){
          try {const snapshot=await api(`/api/trips/${op.tripId}`);if(epoch===authEpoch&&account){acceptSnapshot(snapshot);await persist();renderAccount();}}
          catch(check){if(epoch===authEpoch&&account){if(check.status===403||check.status===404||check.status===410)await accessFailure(check,op.tripId);else if(check.code!=='NETWORK')setError(check);}}
        }
      }
    }
  }catch(e){if(epoch===authEpoch&&e.code!=='SESSION_CHANGED')setError(e);}
  finally{flushing=false;for(const resolve of flushWaiters)resolve();flushWaiters.clear();if(epoch===authEpoch)renderAccount();}
}
function changedRecovery(tripId){const preview=recoveryGroups().find(g=>g.tripId===tripId)||null;return Object.assign(new Error('待同步修改已变化，请重新确认'),{code:'RECOVERY_CHANGED',preview,details:{preview}});}
async function recover(preview,mode){
  const reapply=mode==='reapply';let resumeFlush=false;
  if(state.recoveryBusy)throw changedRecovery(preview.tripId);
  const epoch=authEpoch,owner=account;
  const token={};recoveryToken=token;recoveryPaused=true;emit({recoveryBusy:true});
  try{
    if(flushing)await new Promise(resolve=>flushWaiters.add(resolve));
    return await serializeLocal(async()=>{
      requireCurrent(epoch,owner);
      const current=recoveryGroups().find(g=>g.tripId===preview.tripId);
      if(!current||current.id!==preview.id||JSON.stringify(current.opIds)!==JSON.stringify(preview.opIds))throw changedRecovery(preview.tripId);
      if(mode==='discard'&&!current.canDiscard)throw Object.assign(new Error('请先重试并确认提交结果，再处理其余修改。'),{code:'RECEIPT_UNCONFIRMED'});
      if(reapply&&!current.canReapply)throw Object.assign(new Error('这些修改需要按原顺序重试或放弃'),{code:'RECOVERY_NOT_REAPPLICABLE'});
      if(reapply)await calibrate();
      else if(mode==='discard') {const snapshot=await api(`/api/trips/${preview.tripId}`);requireCurrent(epoch,owner);acceptSnapshot(snapshot);}
      requireCurrent(epoch,owner);
      const latest=recoveryGroups().find(g=>g.tripId===preview.tripId);
      if(!latest||JSON.stringify(latest.opIds)!==JSON.stringify(preview.opIds))throw changedRecovery(preview.tripId);
      const candidate=clone(account),ids=new Set(preview.opIds);
      if(reapply){const clock=operationClock(),prefix=crypto.randomUUID();let index=0;for(const op of candidate.queue)if(ids.has(op.id)){op.id=prefix+'-'+String(index++).padStart(8,'0');op.clock=clone(clock);if(op.blocked==='CLOCK_UNCERTAIN'){delete op.blocked;delete op.failure;}}}
      else if(mode==='discard')candidate.queue=candidate.queue.filter(op=>!ids.has(op.id));
      else {const first=candidate.queue.find(op=>op.id===preview.id);delete first.blocked;delete first.failure;}
      await persistCandidate(candidate,epoch,owner);requireCurrent(epoch,owner);
      renderAccount({error:null});resumeFlush=true;
    });
  }finally{if(recoveryToken===token){recoveryToken=null;recoveryPaused=false;emit({recoveryBusy:false});if(resumeFlush)void flush();}}
}
async function persistCandidate(candidate,epoch,owner){
  const job=async()=>{const d=await db();requireCurrent(epoch,owner);const snapshot={...clone(owner),queue:candidate.queue};await d.put('kv',snapshot,`account:${snapshot.user.id}`);requireCurrent(epoch,owner);account.queue=candidate.queue;};
  persistChain=persistChain.catch(()=>{}).then(job);
  try{await persistChain;}catch(e){if(e.code==='SESSION_CHANGED')throw e;throw Object.assign(new Error('此设备未能保存修改，请释放存储空间后重试'),{code:'LOCAL_STORAGE'});}
}
const reapplyPending=preview=>recover(preview,'reapply');
const discardPending=preview=>recover(preview,'discard');
async function retryPending(id){
  const preview=recoveryGroups().find(group=>group.id===id);
  if(!preview)return;
  if(preview.reason==='CLOCK_UNCERTAIN')throw Object.assign(new Error('请确认重新应用这些修改'),{code:'CLOCK_UNCERTAIN'});
  await recover(preview,'retry');
  if(flushing)await new Promise(resolve=>flushWaiters.add(resolve));
  else await flush();
}
let navigationTimer;
function setContext(patch,scope) {
  requireScope(scope);
  if(!account||!(scope?.tripId||selected))return;
  const id=scope?.tripId||selected;
  account.contexts[id]={...(account.contexts[id]||freshContext()),...patch};renderAccount();void persist().catch(()=>{});
  clearTimeout(navigationTimer);
  const epoch=authEpoch;
  navigationTimer=setTimeout(()=>{if(account&&epoch===authEpoch)void api('/api/navigation',{method:'PUT',body:{tripId:id,context:account.contexts[id],lastTripId:account.lastTripId}}).catch(()=>{});},700);
}
function updateDrafts(updater,scope) {
  requireScope(scope);
  const id=scope?.tripId||selected;if(!account||!id)return;
  const drafts=(account.contexts[id]||freshContext()).drafts,next=updater(drafts);
  if(next!==drafts)setContext({drafts:next},scope);
}
function setDraft(key,value) {updateDrafts(drafts=>({...drafts,[key]:value}));}
async function persistLocal(scope) {
  requireScope(scope);
  const epoch=authEpoch,owner=account;
  await persist();requireCurrent(epoch,owner);
  if(state.error?.code==='LOCAL_STORAGE')emit({error:null});
  renderAccount();void flush();
}
async function retry(options={}) {
  try {
  const epoch=authEpoch,owner=account;
  emit({error:null});
  await synchronizeSession();
  requireCurrent(epoch,owner);
  await persist();requireCurrent(epoch,owner);await refreshTrips();requireCurrent(epoch,owner);if(selected){await refresh();requireCurrent(epoch,owner);subscribeTrip(selected);}await flush();
  }catch(e){if(e.code!=='SESSION_CHANGED'){if(e.code==='NETWORK'){connection='offline';renderAccount();}else setError(e);}throw e;}
}
async function updateProfile(patch) {const epoch=authEpoch,owner=account;const r=await api('/api/me',{method:'PATCH',body:patch});requireCurrent(epoch,owner);account.user=r.user||r;await persist();requireCurrent(epoch,owner);renderAccount();return account.user;}
const clearError=()=>{emit({error:null});renderAccount();};
window.addEventListener('offline',()=>emit({status:'offline'}));
window.addEventListener('online',()=>void retry().catch(setError));
document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='visible'&&account&&navigator.onLine)void retry().catch(e=>{if(e.code!=='NETWORK')setError(e);});});
// Reconnection also runs while a tab stays visible; SSE handles content changes.
setInterval(()=>{if(account&&navigator.onLine&&!state.sessionExpired&&account.queue.some(x=>!x.blocked))void flush();},5000);
export function useJourney() {
  loadPromise ||= initialize();
  const value=useSyncExternalStore(fn=>{listeners.add(fn);return()=>listeners.delete(fn);},()=>state);
  return {...value,lastTripId:account?.lastTripId,pendingOperations:account?.queue||[],captureScope,retryPending,reapplyPending,discardPending,api,login,logout,openTrip,goHome,refresh,createTrip,joinTrip,mutate,setContext,setDraft,updateDrafts,persistLocal,clearError,retry,updateProfile,refreshTrips};
}
