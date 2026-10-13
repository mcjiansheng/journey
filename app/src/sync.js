import { useSyncExternalStore } from 'react';
import { openDB } from 'idb';
import { previewReschedule } from './domain.js';

const base = import.meta.env.BASE_URL;
const listeners = new Set();
const freshContext = () => ({page:'itinerary',dayId:null,drafts:{},map:{},scroll:{}});
let state = {ready:false,user:null,config:null,trips:[],snapshot:null,context:freshContext(),status:'syncing',error:null,pendingCount:0,sessionExpired:false};
let account=null, selected=null, csrf='', source=null, flushing=false, loadPromise=null, lease=null, leasePerformance=0, leaseWall=0, notifyTimer=null;
let authEpoch=0, refreshSeq=0, database, persistChain=Promise.resolve();
let deviceId;
const changedSession=()=>Object.assign(new Error('账户已切换，请在当前账户继续操作'),{code:'SESSION_CHANGED'});
const requireCurrent=(epoch,owner)=>{if(epoch!==authEpoch||owner!==account)throw changedSession();};
const db = () => database ||= openDB('journey-v1',1,{upgrade(d){d.createObjectStore('kv');}});
const emit = patch => {state={...state,...patch};for(const fn of listeners)fn();};
const clone = value => structuredClone(value);
const message = e => e instanceof Error ? e.message : String(e);
const setError = e => emit({error:{message:message(e),code:e.code||'ERROR',details:e.details},status:'error'});
const emptyAccount = user => ({user,trips:[],snapshots:{},contexts:{},lastTripId:null,queue:[]});

export async function api(path,{body,method='GET',...options}={}) {
  let res;
  try {res=await fetch(base.replace(/\/$/,'')+path,{method,credentials:'same-origin',...options,headers:{...(body!==undefined?{'Content-Type':'application/json'}:{}),...(method!=='GET'&&csrf?{'X-CSRF-Token':csrf}:{}),...options.headers},...(body!==undefined?{body:JSON.stringify(body)}:{})});}
  catch {const error=new Error('连接中断，修改会在联网后继续同步');error.code='NETWORK';throw error;}
  let value;
  try {value=await res.json();}catch{value={};}
  if(!res.ok){const e=new Error(value.error?.message||'请求失败，请重试');e.code=value.error?.code||'REQUEST_FAILED';e.status=res.status;e.details=value.error?.details;throw e;}
  return value;
}

async function persist() {
  const snapshot=account&&clone(account);
  if(!snapshot)return;
  // A single transaction persists both the operation queue and its local display.
  const job=async()=>{const d=await db();await d.put('kv',snapshot,`account:${snapshot.user.id}`);};
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
    status:state.error?'error':!navigator.onLine?'offline':pending?'syncing':'synced',...extra});
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
    catch(e){if(e.status===401){csrf='';emit({sessionExpired:!!account,user:null});}else if(e.code!=='NETWORK')setError(e);}
    emit({ready:true,...(!navigator.onLine?{status:'offline'}:{})});
    if(account&&!state.sessionExpired)void flush();
  }catch(e){setError(e);emit({ready:true});}
}
async function refreshTrips() {
  const epoch=authEpoch;
  const r=await api('/api/trips');
  if(epoch!==authEpoch||!account)return;
  account.trips=r.trips;
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
    acceptSnapshot(r);renderAccount();await persist();
  }catch(e){if(epoch!==authEpoch)return;await accessFailure(e,id);throw e;}
}
async function accessFailure(e,id) {
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
  source.onerror=()=>{if(epoch===authEpoch&&!navigator.onLine)emit({status:'offline'});};
}
function maybeNotify() {
  if(!account?.user.preferences?.collaborationNotifications||document.visibilityState!=='hidden'||!('Notification'in window)||Notification.permission!=='granted'||flushing)return;
  clearTimeout(notifyTimer);notifyTimer=setTimeout(()=>new Notification('旅程有新变化',{body:account?.snapshots[selected]?.trip.name||'同伴更新了旅程',tag:`journey-${selected}`,icon:base+'icon.svg'}),1200);
}
async function openTrip(id) {
  if(!account)throw new Error('请先登录');
  const epoch=authEpoch,owner=account;
  selected=id;account.lastTripId=id;account.contexts[id]||=freshContext();emit({error:null});renderAccount();await persist();
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
  csrf=r.csrfToken;closeSource();selected=null;lease=null;
  account=stored||emptyAccount(r.user);account.user=r.user;
  await(await db()).put('kv',r.user.id,'activeUser');if(epoch!==authEpoch)throw changedSession();emit({error:null,sessionExpired:false});await calibrate();if(epoch!==authEpoch)throw changedSession();await refreshTrips();if(epoch!==authEpoch)throw changedSession();renderAccount();if(previousTrip&&previousUserId===r.user.id)await openTrip(previousTrip);void flush();return r;
}
async function logout() {
  const epoch=++authEpoch,owner=account;
  await persist();await api('/api/auth/logout',{method:'POST'});
  requireCurrent(epoch,owner);closeSource();csrf='';lease=null;selected=null;account=null;
  await(await db()).delete('kv','activeUser');emit({user:null,snapshot:null,trips:[],context:freshContext(),error:null,pendingCount:0,sessionExpired:false,status:'synced'});
}
async function createTrip(form) {
  const epoch=authEpoch,owner=account;
  const r=await api('/api/trips',{method:'POST',body:{id:crypto.randomUUID(),...form}});requireCurrent(epoch,owner);acceptSnapshot(r);await openTrip(r.trip.id);return r;
}
async function joinTrip(code) {const epoch=authEpoch,owner=account;const r=await api('/api/invites/accept',{method:'POST',body:{code}});requireCurrent(epoch,owner);acceptSnapshot(r);await openTrip(r.trip.id);return r;}
async function mutate(input) {
  if(!account||!selected)throw new Error('请先打开旅程');
  if(input.kind==='reschedule')previewReschedule(state.snapshot,input.patch);
  const op={...clone(input),id:crypto.randomUUID(),tripId:selected,clock:operationClock()};
  account.queue.push(op);renderAccount({error:null});
  try{await persist();}catch(e){throw e;}
  renderAccount();void flush();return op;
}
async function flush() {
  if(flushing||!account||!csrf||state.sessionExpired||!navigator.onLine)return;
  flushing=true;const epoch=authEpoch;
  try {
    // The queue spans trips, so edits keep uploading after going home.
    const attempted=new Set();
    while(epoch===authEpoch&&account) {
      const op=account.queue.find(x=>!attempted.has(x.id));
      if(!op)break;
      attempted.add(op.id);
      if(epoch!==authEpoch||!account)break;
      if(op.blocked)continue;
      if(op.clock.uncertain){op.blocked='CLOCK_UNCERTAIN';setError(Object.assign(new Error('部分修改的时间无法确认，请在保存与同步中重新应用这些内容'),{code:'CLOCK_UNCERTAIN'}));await persist();continue;}
      try {
        const {tripId,blocked,failure,...body}=op;
        const r=await api(`/api/trips/${op.tripId}/operations`,{method:'POST',body});
        if(epoch!==authEpoch||!account)break;
        account.queue=account.queue.filter(x=>x.id!==op.id);acceptSnapshot(r.snapshot);await persist();renderAccount();
      }catch(e){
        if(epoch!==authEpoch||!account)break;
        if(e.code==='NETWORK'){emit({status:'offline'});break;}
        if(e.status===401){emit({sessionExpired:true});closeSource();break;}
        if(e.status===410||e.code==='TRIP_PURGED'){await accessFailure(e,op.tripId);continue;}
        op.blocked=e.code||'FAILED';op.failure=message(e);setError(e);await persist();
        if(e.status===403||e.status===404){await accessFailure(e,op.tripId);}
      }
    }
  }finally{flushing=false;if(epoch===authEpoch)renderAccount();}
}
let navigationTimer;
function setContext(patch) {
  if(!account||!selected)return;
  const id=selected;
  account.contexts[id]={...(account.contexts[id]||freshContext()),...patch};renderAccount();void persist().catch(()=>{});
  clearTimeout(navigationTimer);
  const epoch=authEpoch;
  navigationTimer=setTimeout(()=>{if(account&&epoch===authEpoch)void api('/api/navigation',{method:'PUT',body:{tripId:id,context:account.contexts[id],lastTripId:account.lastTripId}}).catch(()=>{});},700);
}
function setDraft(key,value) {setContext({drafts:{...state.context.drafts,[key]:value}});}
async function retry(options={}) {
  const epoch=authEpoch,owner=account;
  emit({error:null});
  await synchronizeSession();
  requireCurrent(epoch,owner);
  if(options.reapply){
    for(const op of account.queue){
      if(op.blocked==='CLOCK_UNCERTAIN'||op.clock.uncertain){op.id=crypto.randomUUID();op.clock=operationClock();delete op.blocked;delete op.failure;}
    }
  }else for(const op of account.queue)if(op.blocked!=='CLOCK_UNCERTAIN'){delete op.blocked;delete op.failure;}
  await persist();requireCurrent(epoch,owner);await refreshTrips();requireCurrent(epoch,owner);if(selected){await refresh();requireCurrent(epoch,owner);subscribeTrip(selected);}await flush();
}
async function updateProfile(patch) {const epoch=authEpoch,owner=account;const r=await api('/api/me',{method:'PATCH',body:patch});requireCurrent(epoch,owner);account.user=r.user||r;await persist();requireCurrent(epoch,owner);renderAccount();return account.user;}
const clearError=()=>emit({error:null});
window.addEventListener('offline',()=>emit({status:'offline'}));
window.addEventListener('online',()=>void retry().catch(setError));
document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='visible'&&account&&navigator.onLine)void retry().catch(e=>{if(e.code!=='NETWORK')setError(e);});});
// Reconnection also runs while a tab stays visible; SSE handles content changes.
setInterval(()=>{if(account&&navigator.onLine&&!state.sessionExpired&&account.queue.some(x=>!x.blocked))void flush();},5000);
export function useJourney() {
  loadPromise ||= initialize();
  const value=useSyncExternalStore(fn=>{listeners.add(fn);return()=>listeners.delete(fn);},()=>state);
  return {...value,lastTripId:account?.lastTripId,pendingOperations:account?.queue||[],api,login,logout,openTrip,goHome,refresh,createTrip,joinTrip,mutate,setContext,setDraft,clearError,retry,updateProfile,refreshTrips};
}
