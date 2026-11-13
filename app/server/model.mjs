import { z } from 'zod';
import { markIcons, markColors } from '../src/marks.js';
const mark=z.object({icon:z.enum(Object.keys(markIcons)),color:z.enum(Object.keys(markColors))}).strict();
import { endpointSignature,routeSignature,planDayId } from '../src/domain.js';
export function fail(code,message,status=422,details){const e=new Error(message);Object.assign(e,{code,status,details});throw e;}
export const id=z.string().min(1).max(256).regex(/^[A-Za-z0-9_-]+$/);
const text=z.string().max(10000),name=z.string().trim().min(1).max(240),date=z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(v=>!Number.isNaN(Date.parse(v))&&new Date(v).toISOString().slice(0,10)===v),currency=z.string().regex(/^[A-Z]{3}$/),number=z.number().finite(),nullableNumber=number.nonnegative().nullable();
const url=z.union([z.literal(''),z.url().refine(v=>/^https?:/.test(v))]);
const noteColor=z.enum(['yellow','green','blue','pink','purple','gray']);
const inkColor=z.enum(['default','accent','red','orange','blue','purple']);
const hlColor=z.enum(['yellow','green','blue','pink']);
const coord=z.number().finite().min(-1e6).max(1e6);
export const frame=z.object({
  x:coord,y:coord,
  w:z.number().min(0).max(8000),h:z.number().min(0).max(8000),
  rotation:z.number().min(-180).max(180).default(0),
  scale:z.number().min(0.3).max(8).default(1),
}).strict();
export const WIDGET_KINDS={
  activity:['S','M'],day:['S','M','L'],place:['S','M'],route:['M','L'],
  countdown:['S','M'],clock:['S','M'],expense:['S','M'],places:['M','L'],
};
// Board sticker styles. Kept here and mirrored in src/board.js (STYLE_VARIANTS).
export const BOARD_VARIANTS={note:['plain','lined','grid','kraft','tape','torn'],text:['plain','hand','marker','outline','label'],emoji:['plain','sticker','shadow'],todo:['plain','paper','glass'],section:['plain','dashed','solid'],countdown:['plain','flip','calendar','ring'],clock:['plain','digital','minimal','sky'],expense:['plain','receipt','ring','minimal'],place:['plain','flat','polaroid','outline'],places:['plain','flat','polaroid','outline'],route:['plain','flat','polaroid','outline']};
export const MAP_STYLES=['standard','light','dark','satellite','sketch'];
export const IMAGE_FRAMES=['none','polaroid','tape','stamp','circle','card','sticker'];
export const GALLERY_RATIOS=['1:1','3:4','4:3','16:9','9:16','1:2','2:1'];
const assetMime=z.enum(['image/jpeg','image/webp','image/png','image/gif']);
const boardContent=z.discriminatedUnion('type',[
  z.object({type:z.literal('note'),text:z.string().max(500),html:z.string().max(8000).optional()}).strict(),
  z.object({type:z.literal('gallery'),images:z.array(z.object({assetId:id,mime:assetMime,width:z.number().int().positive(),height:z.number().int().positive(),animated:z.boolean().default(false),crop:z.object({x:z.number().min(-1).max(1).default(0),y:z.number().min(-1).max(1).default(0),zoom:z.number().min(1).max(4).default(1)}).strict().default({x:0,y:0,zoom:1})}).strict()).max(30)}).strict(),
  z.object({type:z.literal('todo'),title:z.string().max(40).default(''),items:z.array(z.object({id,text:z.string().max(120),done:z.boolean().default(false)}).strict()).max(60)}).strict(),
  z.object({type:z.literal('text'),text:z.string().max(500)}).strict(),
  z.object({type:z.literal('section'),title:z.string().max(40).default('')}).strict(),
  z.object({type:z.literal('emoji'),char:z.string().min(1).max(32)}).strict(),
  z.object({type:z.literal('image'),assetId:id,mime:z.enum(['image/jpeg','image/webp','image/png','image/gif']),width:z.number().int().positive(),height:z.number().int().positive(),animated:z.boolean().default(false),caption:z.string().max(60).default('')}).strict(),
  z.object({type:z.literal('link'),url,title:z.string().max(80).default('')}).strict(),
  z.object({type:z.literal('widget'),kind:z.enum(Object.keys(WIDGET_KINDS)),activityId:id.optional(),dayId:id.optional(),favoriteId:id.optional(),place:z.lazy(()=>place).optional(),mark:z.lazy(()=>mark).optional()}).strict().superRefine((v,ctx)=>{
    if(v.kind==='places'&&!v.mark)ctx.addIssue({code:'custom',message:'地点分类小组件缺少标记',path:['mark']});
    const need={activity:['activityId'],day:['dayId'],route:['dayId']}[v.kind]||[];
    for(const k of need)if(!v[k])ctx.addIssue({code:'custom',message:'小组件缺少目标',path:[k]});
    if(v.kind==='place'&&!v.favoriteId&&!v.place)ctx.addIssue({code:'custom',message:'地点小组件须且只能指定收藏或独立地点'});
    if(v.kind==='place'&&v.favoriteId&&v.place)ctx.addIssue({code:'custom',message:'地点小组件须且只能指定收藏或独立地点'});
    const allowed={activity:['activityId'],day:['dayId'],route:['dayId'],place:['favoriteId','place'],places:['mark']}[v.kind]||[];
    for(const k of ['activityId','dayId','favoriteId','place','mark']){if(v[k]!==undefined&&!allowed.includes(k))ctx.addIssue({code:'custom',message:'多余的目标字段',path:[k]});}
  }),
  z.object({type:z.literal('stroke'),tool:z.enum(['pen','highlighter']),points:z.array(z.tuple([z.number(),z.number()])).min(1).max(1000)}).strict(),
  z.object({type:z.literal('shape'),kind:z.enum(['rect','ellipse','line','arrow']),filled:z.boolean().default(false)}).strict(),
]);
export function validateBoardItem(item){
  const {type}=item.content;const s=item.style||{};
  const vkey=type==='widget'?item.content.kind:type;
  if(s.variant!==undefined&&!(BOARD_VARIANTS[vkey]||[]).includes(s.variant))fail('VALIDATION','贴纸样式不正确');
  if(s.autoWidth!==undefined&&type!=='text')fail('VALIDATION','只有文字可以自动宽度');
  if(s.mapStyle!==undefined&&!(type==='widget'&&['place','places','route'].includes(item.content.kind)))fail('VALIDATION','只有地图小组件可以设置地图样式');
  if(s.fontSize!==undefined&&type!=='note')fail('VALIDATION','只有便签可以设置字号档位');
  if(s.tilt!==undefined&&!['image','note','gallery','emoji'].includes(type))fail('VALIDATION','此类型不允许倾斜');
  if(s.ratio!==undefined&&type!=='gallery')fail('VALIDATION','只有图库可以设置比例');
  if(type==='note'){
    if(!s.color||!noteColor.safeParse(s.color).success)fail('VALIDATION','便签颜色不正确');
    if(s.size!==undefined)fail('VALIDATION','便签不允许设置字号');
    if(s.frameStyle!==undefined)fail('VALIDATION','便签不允许设置相框样式');
  }else if(type==='text'){
    if(s.color!==undefined)fail('VALIDATION','文字颜色不单独设置');
    if(!s.size||!['title','body','small'].includes(s.size))fail('VALIDATION','文字字号需为 title、body 或 small');
    if(s.frameStyle!==undefined)fail('VALIDATION','文字不允许设置相框样式');
  }else if(type==='stroke'){
    if(item.content.tool==='pen'){
      if(!s.color||!inkColor.safeParse(s.color).success)fail('VALIDATION','画笔颜色不正确');
      if(![2,4,8].includes(s.size))fail('VALIDATION','画笔粗细需为 2、4 或 8');
    }else{
      if(!s.color||!hlColor.safeParse(s.color).success)fail('VALIDATION','荧光笔颜色不正确');
      if(s.size!==16)fail('VALIDATION','荧光笔粗细需为 16');
    }
    if(s.frameStyle!==undefined)fail('VALIDATION','笔迹不允许设置相框样式');
  }else if(type==='image'){
    if(s.color!==undefined)fail('VALIDATION','图片不允许设置颜色');
    if(s.size!==undefined)fail('VALIDATION','图片不允许设置规格');
    if(s.frameStyle!==undefined&&!IMAGE_FRAMES.includes(s.frameStyle))fail('VALIDATION','图片相框样式不正确');
  }else if(type==='widget'){
    if(s.color!==undefined)fail('VALIDATION','小组件不允许设置颜色');
    const allowed=WIDGET_KINDS[item.content.kind]||[];
    if(!s.size||!allowed.includes(s.size))fail('VALIDATION',`小组件规格需为 ${allowed.join('、')}`);
    if(s.frameStyle!==undefined)fail('VALIDATION','小组件不允许设置相框样式');
  }else if(type==='todo'){
    if(s.color!==undefined&&!noteColor.safeParse(s.color).success)fail('VALIDATION','待办颜色不正确');
    if(s.size!==undefined||s.frameStyle!==undefined)fail('VALIDATION','待办不允许设置规格或相框');
  }else if(type==='section'){
    if(!s.color||!noteColor.safeParse(s.color).success)fail('VALIDATION','分区颜色不正确');
    if(s.size!==undefined||s.frameStyle!==undefined)fail('VALIDATION','分区不允许设置规格或相框');
  }else if(type==='gallery'){
    if(s.color!==undefined||s.size!==undefined)fail('VALIDATION','图库不允许设置颜色或规格');
    if(s.frameStyle!==undefined&&!IMAGE_FRAMES.includes(s.frameStyle))fail('VALIDATION','图库相框样式不正确');
  }else{
    if(s.color!==undefined)fail('VALIDATION','此类型不允许设置颜色');
    if(s.size!==undefined)fail('VALIDATION','此类型不允许设置规格');
    if(s.frameStyle!==undefined)fail('VALIDATION','此类型不允许设置相框样式');
  }
}
const place=z.object({name,address:text.default(''),lng:number.min(-180).max(180).nullable().default(null),lat:number.min(-90).max(90).nullable().default(null),provider:z.enum(['amap']).nullable().default(null),providerPlaceId:text.nullable().default(null),category:text.default(''),sourceUrl:url.default(''),fetchedAt:nullableNumber.default(null),coordSystem:z.literal('GCJ-02').default('GCJ-02')}).strict().refine(v=>(v.lng===null)===(v.lat===null),'经纬度需同时填写');
const time=z.object({mode:z.enum(['flexible','precise']),period:text.default(''),start:z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/).nullable().default(null),end:z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/).nullable().default(null),endDayOffset:z.number().int().min(0).max(7).default(0)}).strict().refine(v=>v.mode!=='precise'||(!v.end||(v.start&&(v.endDayOffset>0||v.end>=v.start))),'结束时间须晚于开始时间').refine(v=>v.mode!=='flexible'||(!v.start&&!v.end),'灵活时间不包含精确时刻');
export const schemas={
  day:z.object({ordinal:z.number().int().min(1).max(10000),date:date.nullable().default(null)}).strict(),
  activity:z.object({title:name,dayId:id,order:number.default(0),time:time.default({mode:'flexible',period:'',start:null,end:null,endDayOffset:0}),place:place.nullable().default(null),buffers:z.object({before:nullableNumber,after:nullableNumber}).strict().default({before:null,after:null}),notes:text.default(''),url:url.default('')}).strict(),
  favorite:place.safeExtend({mark:mark.nullable().default(null)}),
  markPreset:mark.extend({name:z.string().trim().max(12).default(''),order:z.number().finite().default(0)}),
  expense:z.object({title:text.default(''),date:date.nullable().default(null),payment:z.object({status:z.enum(['paid','estimated']),amountMinor:z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER).nullable(),currency}).strict().refine(v=>v.status!=='paid'||v.amountMinor!==null,'已支付费用需填写金额'),notes:text.default(''),activityId:id.nullable().default(null)}).strict(),
  route:z.object({fromId:id.nullable(),fromPlace:place.nullable().default(null),toId:id,mode:z.enum(['walking','driving','bicycling','transit']),minutes:nullableNumber,manual:z.boolean(),inputSignature:z.string().max(1000),path:z.array(z.tuple([number,number])).max(100000).default([]),distance:nullableNumber.default(null)}).strict().refine(v=>Boolean(v.fromId)!==Boolean(v.fromPlace),'请选择前一活动或独立出发地'),
  board:z.object({title:z.string().trim().min(1).max(30),order:z.number().finite().default(0),background:z.enum(['dots','grid','plain']).default('dots')}).strict(),
  boardItem:z.object({boardId:id,frame,z:z.number().finite().default(0),content:boardContent,style:z.object({color:z.string().max(12).optional(),size:z.union([z.enum(['title','body','small']),z.enum(['S','M','L']),z.number().min(1).max(32)]).optional(),frameStyle:z.enum(IMAGE_FRAMES).optional(),variant:z.string().max(16).optional(),fontSize:z.enum(['s','m','l']).optional(),tilt:z.number().min(-15).max(15).optional(),ratio:z.enum(GALLERY_RATIOS).optional(),autoWidth:z.boolean().optional(),locked:z.boolean().optional(),mapStyle:z.enum(MAP_STYLES).optional()}).strict().default({}),linkedActivityId:id.nullable().default(null),createdBy:id}).strict()
};
export const tripSchema=z.object({id:id.max(160),name,teamMode:z.enum(['admin','equal']),timezone:z.string().max(80).refine(v=>{try{new Intl.DateTimeFormat('en',{timeZone:v});return true;}catch{return false;}}),currency,dayCount:z.number().int().min(1).max(365),startDate:date,destination:text.trim().min(1)}).strict();
export const operationSchema=z.object({id,tripId:id.optional(),objectId:id,kind:z.enum(['create','patch','delete','restore','express','reschedule']),objectType:z.enum(['day','activity','favorite','markPreset','expense','route','board','boardItem']).optional(),patch:z.record(z.string(),z.unknown()).optional(),generation:z.number().int().nonnegative().optional(),expression:z.object({notParticipating:z.boolean().optional(),wishDelete:z.boolean().optional(),wishRestore:z.boolean().optional()}).strict().optional(),clock:z.object({leaseId:id,elapsedMs:number.nonnegative(),uncertaintyMs:number.nonnegative().max(60000),uncertain:z.boolean().optional()}).strict()}).strict();
function formatValidationIssue(issue){if(!issue)return '输入项格式不正确，请根据提示检查修改';const m=issue.message;if(m&&!/^(String must|Number must|Expected |Invalid |Required)/.test(m))return m;const path=issue.path?.[issue.path.length-1];const fieldNames={password:'密码',identifier:'账号',displayName:'称呼',title:'名称',name:'名称',destination:'目的地',startDate:'出发日期',dayCount:'天数',timezone:'时区',currency:'币种',amountMinor:'金额',code:'验证码',notes:'备注',address:'地址',minutes:'耗时'};const name=fieldNames[path]||path||'输入项';if(issue.code==='too_small')return issue.type==='string'?`${name}长度至少需 ${issue.minimum} 个字符`:`${name}不能小于 ${issue.minimum}`;if(issue.code==='too_big')return issue.type==='string'?`${name}长度不能超过 ${issue.maximum} 个字符`:`${name}不能大于 ${issue.maximum}`;if(issue.code==='invalid_type'&&issue.received==='undefined')return `请填写${name}`;if(issue.code==='invalid_string'&&issue.validation==='email')return '请输入有效的电子邮箱地址';return m||`${name}格式不正确，请重新输入`;}
export function parse(schema,data){const r=schema.safeParse(data);if(!r.success){const message=formatValidationIssue(r.error.issues[0]);fail('VALIDATION',message,422,r.error.issues.map(i=>({path:i.path,message:formatValidationIssue(i)})));}return r.data;}
export const json=JSON.parse;
export const stringify=JSON.stringify;
function expressionsFor(db,tripId,objectId){return db.prepare('SELECT e.userId,e.data FROM expressions e JOIN members m ON m.tripId=e.tripId AND m.userId=e.userId WHERE e.tripId=? AND objectId=?').all(tripId,objectId).map(e=>({userId:e.userId,...json(e.data)}));}
export function tripMembers(db,tripId){return db.prepare('SELECT m.*,u.displayName FROM members m JOIN users u ON m.userId=u.id WHERE tripId=? ORDER BY joinOrder').all(tripId).map(m=>({userId:m.userId,displayName:m.displayName,isAdmin:!!m.isAdmin,canInvite:!!m.canInvite,joinOrder:m.joinOrder}));}
export function snapshot(db,tripId){const row=db.prepare('SELECT * FROM trips WHERE id=?').get(tripId);const trip={...json(row.data),expressions:expressionsFor(db,tripId,tripId)};const objects=db.prepare("SELECT * FROM objects WHERE tripId=? AND kind != 'boardItem' ORDER BY (kind != 'day'), id").all(tripId).map(o=>({...o,payload:json(o.payload),clocks:json(o.clocks),expressions:expressionsFor(db,tripId,o.id)}));return {trip,members:tripMembers(db,tripId),objects,cursor:row.cursor,epoch:db.prepare('SELECT epoch FROM sync_meta WHERE id=1').get().epoch};}
export function membership(db,tripId,userId){if(db.prepare('SELECT 1 FROM purges WHERE tripId=?').get(tripId))fail('TRIP_PURGED','旅程已永久清除',410);const row=db.prepare('SELECT * FROM trips WHERE id=?').get(tripId);if(!row)fail('NOT_FOUND','旅程不存在',404);const member=db.prepare('SELECT * FROM members WHERE tripId=? AND userId=?').get(tripId,userId);if(!member)fail('FORBIDDEN','你已不在此旅程团队',403);return {trip:json(row.data),member,row};}
export function next(db,tripId){db.prepare('UPDATE trips SET sequence=sequence+1,cursor=cursor+1 WHERE id=?').run(tripId);return db.prepare('SELECT sequence FROM trips WHERE id=?').get(tripId).sequence;}
function writeObject(db,o){db.prepare('UPDATE objects SET payload=?,state=?,generation=?,clocks=?,changedCursor=? WHERE tripId=? AND id=?').run(stringify(o.payload),o.state,o.generation,stringify(o.clocks),o.changedCursor||0,o.tripId,o.id);}
function loadObject(db,t,id){const o=db.prepare('SELECT * FROM objects WHERE tripId=? AND id=?').get(t,id);if(!o)fail('NOT_FOUND','内容不存在',404);return {...o,payload:json(o.payload),clocks:json(o.clocks)};}
export function ensureDefaultBoard(db, tripId) {
  const b = db.prepare("SELECT kind FROM objects WHERE tripId=? AND id='default-board'").get(tripId);
  if (!b) {
    db.prepare("INSERT OR IGNORE INTO objects(id,tripId,kind,payload,state,generation,clocks,changedCursor) VALUES(?,?,?,?,?,?,?,0)")
      .run('default-board', tripId, 'board', stringify({ title: '主白板', order: 0, background: 'dots' }), 'active', 0, '{}');
  }
}
function references(db,t,kind,p,objectId){
  const ref=(value,k)=>{if(!value)return;const o=db.prepare('SELECT kind FROM objects WHERE tripId=? AND id=?').get(t,value);if(!o||o.kind!==k)fail('INVALID_REFERENCE','所选关联内容不在当前旅程中，请重新选择');};
  if(kind==='board'){
    const activeBoards=db.prepare("SELECT COUNT(*) n FROM objects WHERE tripId=? AND kind='board' AND state='active' AND id!=?").get(t,objectId).n;
    if(activeBoards>=20)fail('BOARD_FULL','每段旅程最多创建 20 块白板',409);
  }
  if(kind==='boardItem'){
    let b=db.prepare("SELECT kind FROM objects WHERE tripId=? AND id=?").get(t,p.boardId);
    if(!b&&p.boardId==='default-board'){
      ensureDefaultBoard(db,t);
      b=db.prepare("SELECT kind FROM objects WHERE tripId=? AND id=?").get(t,p.boardId);
    }
    if(!b||b.kind!=='board')fail('INVALID_REFERENCE','所选白板不在当前旅程中');
    if(p.linkedActivityId)ref(p.linkedActivityId,'activity');
    if(p.content.type==='widget'){
      if(p.content.activityId)ref(p.content.activityId,'activity');
      if(p.content.dayId)ref(p.content.dayId,'day');
      if(p.content.favoriteId)ref(p.content.favoriteId,'favorite');
    }
    const activeItems=db.prepare("SELECT COUNT(*) n FROM objects WHERE tripId=? AND kind='boardItem' AND state='active' AND id!=? AND json_extract(payload, '$.boardId')=?").get(t,objectId,p.boardId).n;
    if(activeItems>=2000)fail('BOARD_FULL','每块白板最多添加 2000 个对象',409);
  }
  if(kind==='markPreset'){const duplicate=db.prepare("SELECT id,payload FROM objects WHERE tripId=? AND kind='markPreset' AND state='active' AND id!=?").all(t,objectId).some(o=>{const v=json(o.payload);return v.icon===p.icon&&v.color===p.color;});if(duplicate)fail('MARK_PRESET_EXISTS','这个标记已有预设',409);}
  if(kind==='day'){const existing=db.prepare("SELECT id,state,generation,payload FROM objects WHERE tripId=? AND kind='day' AND id!=?").all(t,objectId).find(d=>{const v=json(d.payload);return p.date?v.date===p.date:v.date===null&&v.ordinal===p.ordinal;});if(existing)fail(existing.state==='deleted'?'DAY_DELETED':'DAY_EXISTS',existing.state==='deleted'?'此计划日已删除，请先恢复':'此计划日已存在',409,{objectId:existing.id,generation:existing.generation});}
  if(kind==='activity')ref(p.dayId,'day');
  if(kind==='expense')ref(p.activityId,'activity');
  if(kind==='route'){ref(p.fromId,'activity');ref(p.toId,'activity');const from=p.fromId?loadObject(db,t,p.fromId):{id:'origin',payload:{place:p.fromPlace}},to=loadObject(db,t,p.toId);if(p.inputSignature!==routeSignature(from,to,p.mode))fail('ROUTE_INPUT_CHANGED','路线起终点或交通方式已变化，请重新估算',409);}
}
export function clockEvidence(db,userId,op,now){const c=op.clock,l=db.prepare('SELECT * FROM leases WHERE id=? AND userId=?').get(c.leaseId,userId);if(!l||c.uncertain)fail('CLOCK_UNCERTAIN','未能确认离线修改的先后顺序，请保持网络连接后重新保存',409);const at=l.serverTime+c.elapsedMs;if(at>now+Math.max(100,c.uncertaintyMs)||at>l.expiresAt)fail('CLOCK_INVALID','设备系统时间与服务器差异过大，请核对设备系统时间后重试',409);return {at,uncertainty:c.uncertaintyMs+Math.ceil(c.elapsedMs*0.00005),actor:userId,id:op.id,leaseId:l.id,deviceId:l.deviceId};}
function wins(old,c){if(!old)return true;if(old.at===c.at&&old.uncertainty===0&&c.uncertainty===0)return c.id>old.id;if(old.leaseId!==c.leaseId&&Math.abs(old.at-c.at)<=old.uncertainty+c.uncertainty)fail('CLOCK_UNCERTAIN','多人同时离线修改了同一内容，请确认后重新保存',409);return c.at>old.at||(c.at===old.at&&c.id>old.id);}
function lifecycle(db,o,state){if(o.state===state)return false;o.state=state;o.generation++;if(state==='active'){const rows=db.prepare('SELECT * FROM expressions WHERE tripId=? AND objectId=?').all(o.tripId,o.id);for(const r of rows){const data=json(r.data);data.wishDelete=false;data.wishRestore=false;db.prepare('UPDATE expressions SET data=?,clocks=? WHERE tripId=? AND objectId=? AND userId=?').run(stringify(data),stringify({notParticipating:json(r.clocks).notParticipating}),o.tripId,o.id,r.userId);}}writeObject(db,o);return true;}
export function applyOperation(db,t,userId,op,now){const {trip,member}=membership(db,t,userId),c=clockEvidence(db,userId,op,now);let changed=false,ignored=[];
 if(op.kind==='reschedule')return reschedule(db,t,trip,op,c);
 if(op.objectId===t){if(op.kind==='patch'){const patch=parse(z.object({name:name.optional(),destination:text.optional(),timezone:tripSchema.shape.timezone.optional()}).strict(),op.patch);trip.clocks||={};for(const [k,v]of Object.entries(patch)){if(wins(trip.clocks[k],c)){trip[k]=v;trip.clocks[k]=c;changed=true;}else ignored.push(k);}db.prepare('UPDATE trips SET data=? WHERE id=?').run(stringify(trip),t);return {changed,ignored};}}
 let o;if(op.kind==='create'){
 if(!op.objectType)fail('VALIDATION','请选择内容类型');const existingObj=db.prepare('SELECT kind FROM objects WHERE tripId=? AND id=?').get(t,op.objectId);if(existingObj){if(existingObj.kind===op.objectType)return {changed:false,ignored:[],duplicate:true};fail('OBJECT_EXISTS','该日程或活动内容已存在，请勿重复添加',409);}
 const rawPatch=op.objectType==='boardItem'?{...op.patch,createdBy:userId}:op.patch;
 const payload=parse(schemas[op.objectType],rawPatch);
 if(op.objectType==='boardItem')validateBoardItem(payload);
 references(db,t,op.objectType,payload,op.objectId);
 if(op.objectType==='favorite'&&payload.provider&&payload.providerPlaceId){const existing=db.prepare("SELECT * FROM objects WHERE tripId=? AND kind='favorite'").all(t).find(r=>{const p=json(r.payload);return p.provider===payload.provider&&p.providerPlaceId===payload.providerPlaceId;});if(existing){if(existing.state==='deleted')fail('FAVORITE_DELETED','该地点在已删除收藏中，请恢复',409,{objectId:existing.id,generation:existing.generation});return {changed:false,existingObjectId:existing.id};}}
 const clocks=Object.fromEntries(Object.keys(payload).map(k=>[k,c]));if(op.objectType==='favorite')clocks.$place=c;if(op.objectType==='route')clocks.$route=c;
 db.prepare('INSERT INTO objects(id,tripId,kind,payload,state,generation,clocks,changedCursor) VALUES(?,?,?,?,?,?,?,0)').run(op.objectId,t,op.objectType,stringify(payload),'active',0,stringify(clocks));return {changed:true};
 }
 o=op.objectId===t?{id:t,tripId:t,kind:'trip',payload:{},state:trip.state,generation:trip.generation,clocks:{}}:loadObject(db,t,op.objectId);
 const life=(state)=>{if(o.kind==='trip'){if(o.state===state)return false;trip.state=state;trip.generation++;o.state=state;o.generation=trip.generation;if(state==='active'){db.prepare('DELETE FROM expressions WHERE tripId=? AND objectId=?').run(t,t);}db.prepare('UPDATE trips SET data=? WHERE id=?').run(stringify(trip),t);return true;}if(state==='active'&&o.kind==='markPreset')references(db,t,o.kind,o.payload,o.id);return lifecycle(db,o,state);};
 if(op.kind==='patch'){let p=op.patch?{...op.patch}:null;if(!p||!Object.keys(p).length)fail('VALIDATION','修改内容不能为空');
 if(o.kind==='boardItem'){
   if(Object.hasOwn(p,'boardId')||Object.hasOwn(p,'createdBy'))fail('VALIDATION','白板归属与创建者不可修改');
   if(p.content){
     if(p.content.type&&p.content.type!==o.payload.content.type)fail('VALIDATION','元素内容类型不可变更');
     if(o.payload.content.type==='widget'&&p.content.kind&&p.content.kind!==o.payload.content.kind)fail('VALIDATION','小组件种类不可变更');
   }
 }
 let proposed=parse(schemas[o.kind],{...o.payload,...p});
 if(o.kind==='boardItem')validateBoardItem(proposed);
 references(db,t,o.kind,proposed,o.id);
 if(o.kind==='route'){const origin=v=>v.fromId?loadObject(db,t,v.fromId):{id:'origin',payload:{place:v.fromPlace}};const previous=JSON.parse(o.payload.inputSignature)[0];const updated=endpointSignature(origin(proposed),loadObject(db,t,proposed.toId));if(previous!==updated){if(proposed.manual||!Object.hasOwn(p,'minutes'))p={...p,minutes:null,manual:false,path:[],distance:null};else p={...p,path:p.path||[],distance:p.distance??null};proposed=parse(schemas.route,{...o.payload,...p});}}
 const previousPayload=o.payload;const merged={...o.payload};const group=o.kind==='favorite'?'$place':o.kind==='route'?'$route':null;
 if(o.kind==='favorite'&&Object.hasOwn(p,'mark')){if(wins(o.clocks.mark,c)){merged.mark=p.mark;o.clocks.mark=c;changed=true;}else ignored.push('mark');delete p.mark;}
 if(group&&Object.keys(p).length){if(wins(o.clocks[group],c)){Object.assign(merged,p);o.clocks[group]=c;changed=true;}else ignored.push(...Object.keys(p));}
 else for(const [k,v]of Object.entries(p)){if(wins(o.clocks[k],c)){merged[k]=v;o.clocks[k]=c;changed=true;}else ignored.push(k);}
 o.payload=parse(schemas[o.kind],merged);
 if(o.kind==='boardItem')validateBoardItem(o.payload);
 references(db,t,o.kind,o.payload,o.id);writeObject(db,o);
 if(o.kind==='markPreset'&&(previousPayload.icon!==o.payload.icon||previousPayload.color!==o.payload.color)){
 const favorites=db.prepare("SELECT * FROM objects WHERE tripId=? AND kind='favorite'").all(t);
 for(const row of favorites){const f={...row,payload:json(row.payload),clocks:json(row.clocks)};if(f.payload.mark?.icon===previousPayload.icon&&f.payload.mark?.color===previousPayload.color&&wins(f.clocks.mark,c)){f.payload.mark={icon:o.payload.icon,color:o.payload.color};f.clocks.mark=c;writeObject(db,f);}}
 }}
 else {if(op.generation!==o.generation){
   // Any member deletes/restores board items directly. A stale request whose goal a peer already reached
   // (two people erase the same stroke) is a no-op; answering 409 would block the sender's whole trip queue.
   if(o.kind==='boardItem'&&((op.kind==='delete'&&o.state==='deleted')||(op.kind==='restore'&&o.state==='active')))return {changed:false,ignored:[]};
   fail('STALE_GENERATION','其他同行成员刚刚更新了此内容，请刷新查看最新版本',409,{generation:o.generation});
 }
 if(op.kind==='delete'){
   if(o.kind==='boardItem'){changed=life('deleted');}
   else{if(trip.ownerId!==userId&&!(trip.teamMode==='admin'&&member.isAdmin))fail('FORBIDDEN','你可以表达希望删除',403);changed=life('deleted');}
 }else if(op.kind==='restore'){
   if(o.kind==='boardItem'){
     const activeItems=db.prepare("SELECT COUNT(*) n FROM objects WHERE tripId=? AND kind='boardItem' AND state='active' AND id!=? AND json_extract(payload, '$.boardId')=?").get(t,o.id,o.payload.boardId).n;
     if(activeItems>=2000)fail('BOARD_FULL','每块白板最多添加 2000 个对象',409);
     changed=life('active');
   }else if(o.kind==='board'){
     const activeBoards=db.prepare("SELECT COUNT(*) n FROM objects WHERE tripId=? AND kind='board' AND state='active' AND id!=?").get(t,o.id).n;
     if(activeBoards>=20)fail('BOARD_FULL','每段旅程最多创建 20 块白板',409);
     if(trip.ownerId!==userId&&!member.isAdmin)fail('FORBIDDEN','你可以支持恢复',403);
     changed=life('active');
   }else{if(trip.ownerId!==userId&&!member.isAdmin)fail('FORBIDDEN','你可以支持恢复',403);changed=life('active');}
 }else if(op.kind==='express'){
 if(o.kind==='boardItem')fail('VALIDATION','白板元素不支持投票表态');
 const expression=op.expression;if(!expression||!Object.keys(expression).length)fail('VALIDATION','表达不能为空');if(o.kind!=='activity'&&expression.notParticipating!==undefined)fail('VALIDATION','此内容不适用参加状态');if(o.state==='active'&&expression.wishRestore===true||o.state==='deleted'&&expression.wishDelete===true)fail('INVALID_EXPRESSION','请针对当前内容状态表达意愿',409);
 const prev=db.prepare('SELECT * FROM expressions WHERE tripId=? AND objectId=? AND userId=?').get(t,o.id,userId),data=prev?json(prev.data):{notParticipating:false,wishDelete:false,wishRestore:false},clocks=prev?json(prev.clocks):{};
 for(const [k,v]of Object.entries(expression)){if(wins(clocks[k],c)){clocks[k]=c;if(data[k]!==v){data[k]=v;changed=true;}}else ignored.push(k);}
 db.prepare('INSERT INTO expressions VALUES(?,?,?,?,?) ON CONFLICT(tripId,objectId,userId) DO UPDATE SET data=excluded.data,clocks=excluded.clocks').run(t,o.id,userId,stringify(data),stringify(clocks));
 if(changed){const all=db.prepare('SELECT e.data FROM expressions e JOIN members m ON m.tripId=e.tripId AND m.userId=e.userId WHERE e.tripId=? AND e.objectId=?').all(t,o.id).map(r=>json(r.data)),n=db.prepare('SELECT COUNT(*) n FROM members WHERE tripId=?').get(t).n,threshold=Math.floor(n/2)+1;
 if(o.state==='active'&&trip.teamMode==='equal'&&all.some(e=>e.wishDelete)&&all.filter(e=>e.wishDelete||(o.kind==='activity'&&e.notParticipating)).length>=threshold)life('deleted');else if(o.state==='deleted'&&all.filter(e=>e.wishRestore).length>=threshold)life('active');}
 }}return {changed,ignored};
}
function reschedule(db,t,trip,op,c) {
 const p=parse(z.object({startDate:date.nullable(),dayCount:z.number().int().min(1).max(365),moves:z.array(z.object({activityId:id,dayId:id.optional(),date:date.optional(),ordinal:z.number().int().min(1).max(365).optional()}).strict()).max(10000)}).strict(),op.patch);
 trip.clocks||={};const scheduleWins=wins(trip.clocks.schedule,c);let changed=false;
 const days=db.prepare("SELECT * FROM objects WHERE tripId=? AND kind='day'").all(t).map(r=>({...r,payload:json(r.payload)}));
 const ensureUsable=d=>{if(d?.state==='deleted')fail('DAY_DELETED','此计划日已删除，请先恢复',409,{objectId:d.id,generation:d.generation});return d;};
 const getDay=(ordinal,dayDate)=>{
  let d=days.find(d=>dayDate?d.payload.date===dayDate:d.payload.date===null&&d.payload.ordinal===ordinal);
  if(d)return ensureUsable(d);
  const dayId=planDayId(t,{date:dayDate,ordinal});
  if(db.prepare('SELECT 1 FROM objects WHERE tripId=? AND id=?').get(t,dayId))fail('DAY_ID_CONFLICT','所选日期已存在日程安排，请重新选择日期',409);
  d={id:dayId,payload:{ordinal,date:dayDate},state:'active',generation:0};
  db.prepare('INSERT INTO objects(id,tripId,kind,payload,state,generation,clocks) VALUES(?,?,?,?,?,?,?)').run(d.id,t,'day',stringify(d.payload),'active',0,stringify({ordinal:c,date:c}));days.push(d);changed=true;return d;
 };
 const dateFor=ordinal=>p.startDate?new Date(Date.parse(p.startDate)+(ordinal-1)*86400000).toISOString().slice(0,10):null;
 // A losing offline range still establishes its plan-day references, so dependent
 // queued activity edits retain their original date as an outside-range arrangement.
 for(let i=1;i<=p.dayCount;i++)getDay(i,dateFor(i));
 for(const m of p.moves){
  const activity=loadObject(db,t,m.activityId);if(activity.kind!=='activity')fail('INVALID_REFERENCE','只能移动活动');
  const day=m.dayId?ensureUsable(days.find(d=>d.id===m.dayId)):m.date?getDay(m.ordinal||1,m.date):m.ordinal?getDay(m.ordinal,dateFor(m.ordinal)):null;
  if(!day)fail('INVALID_REFERENCE','请选择活动目标日期');
  if(wins(activity.clocks.dayId,c)){activity.payload.dayId=day.id;activity.clocks.dayId=c;writeObject(db,activity);changed=true;}
 }
 if(scheduleWins){trip.startDate=p.startDate;trip.dayCount=p.dayCount;trip.clocks.schedule=c;db.prepare('UPDATE trips SET data=? WHERE id=?').run(stringify(trip),t);changed=true;}
 return {changed,ignored:scheduleWins?[]:['schedule']};
}
