# 实现合同

权威：../docs/设计文档/01、02、03、05（含 C23）。代码目录 app，与历史原型隔离。Node >=22.13，ES modules，node:sqlite 持久化 WAL；React/Vite。所有 API 相对 BASE_PATH（默认 /）；客户端 api helper 自动加前缀。无示例业务数据、无生产认证绕过。

## 数据与 API

JSON 请求/响应；错误 {error:{code,message,details?}}。Cookie HttpOnly 会话，变更检查 Origin + CSRF（GET /api/session 返回 csrfToken）。

- GET /api/config -> {basePath,amapKey,auth:{email:boolean,phone:boolean},version}
- POST /api/auth/register {identifier,password,displayName}、POST /api/auth/login {identifier,password} -> session；本轮正式 UI 使用密码账号。
- 可选验证码渠道：POST /api/auth/request {identifier} -> {challengeId,expiresIn}，POST /api/auth/verify {challengeId,code,displayName?} -> session。
- GET /api/session -> {user:{id,displayName,identifier,isAdmin,preferences},csrfToken,serverTime}，未登录返回 401。
- POST /api/auth/logout；PATCH /api/me {displayName?,preferences?} -> user。
- POST /api/clock {deviceId} -> {leaseId,serverTime,expiresAt}，租约绑定用户。操作 clock={leaseId,elapsedMs,uncertaintyMs,uncertain?}；发生时刻=serverTime+elapsedMs，不用到达顺序。客户端以 performance.now 单调差计算，侦测墙钟突变；已排队时钟不可改写。离线刷新后的新编辑若无法建立时间依据，保留队列，联网后允许用户明确重新应用。不同租约竞争时间区间无法判断且无因果依据时返回 CLOCK_UNCERTAIN，原值不变。精确同刻用 operationId 稳定定序。服务端拒绝未来、超租期及不合法证据。
- GET /api/trips -> {trips:[Trip],navigation:{lastTripId?,contexts?}}
- POST /api/trips {id,name,teamMode:'admin'|'equal',timezone,currency,dayCount,startDate,destination} -> Snapshot。新建要求目的地 trim 后非空、合法非空 startDate、显式 dayCount（1–365，按含首尾日期的自然日计算），并显式选择团队模式。客户端根据真实目的地行政区划确定当地 IANA 时区并预填 timezone，用户可手动调整；未能解析时须手动选择；服务端核验提交时区。客户端将必填的起止日期转换为 startDate + dayCount，存储与 API 不新增 endDate。历史无日期旅程继续允许读取、编辑与既有改期操作。
- GET /api/trips/:id -> Snapshot={trip:Trip,members:[Member],objects:[Object],cursor:number,epoch:number}。
- GET /api/trips/:id/members -> {members:[Member]}，供成员与邀请界面独立刷新；Snapshot 中继续保留成员摘要，支持顶部头像、权限判断与离线展示。
- Trip={id,name,ownerId,createdBy,teamMode,timezone,currency,destination,startDate:null|string,dayCount,state,generation,...}；Member={userId,displayName,isAdmin,canInvite,joinOrder}。
- Object={id,tripId,kind:'day'|'activity'|'favorite'|'expense'|'route',payload,state:'active'|'deleted',generation,clocks?,expressions?}。expressions 数组 {userId,notParticipating,wishDelete,wishRestore}，只含当前成员。
- day payload={ordinal,date:null|string}；activity={title,dayId,order:number,time:{mode:'flexible'|'precise',period:'',start:null|'HH:mm',end:null|'HH:mm',endDayOffset:0},place:null|Place,buffers:{before:null|number,after:null|number},notes:'',url:''}。
- Place={name,address:'',lng:null|number,lat:null|number,provider:null|'amap',providerPlaceId:null|string,category:'',sourceUrl:'',fetchedAt:null|number,coordSystem:'GCJ-02'}，成组修改地点。
- favorite payload=Place；expense={title:'',payment:{status:'paid'|'estimated',amountMinor:null|integer,currency},notes:'',activityId:null|string}；route={fromId:null|string,fromPlace:null|Place,toId,mode:'walking'|'driving'|'bicycling'|'transit',minutes:null|number,manual:boolean,inputSignature:string,path:[],distance:null|number}。
- POST /api/trips/:id/operations Operation -> {snapshot,receipt}。Operation={id,objectId,kind:'create'|'patch'|'delete'|'restore'|'express'|'reschedule',objectType?,patch?,generation?,expression?,clock}。create 使用 patch 初始 payload；patch 只发送修改的顶层逻辑组（时间/payment/place 原子组），trip objectId=tripId 可 patch name/destination，模式修改走成员管理。express={notParticipating?:boolean,wishDelete?:boolean,wishRestore?:boolean}。create 相同高德 POI favorite 去重；已删除返回恢复路径错误。生命周期独立，旧轮命令拒绝，内容可更新隐藏对象。
- reschedule 操作 objectId=tripId，patch={startDate,dayCount,moves:[{activityId,dayId?,date?,ordinal?}]}；事务中建/复用计划日，保留未选活动原日期/时间；缩短范围不删对象。具体实现可补充合同，但先通知协调者。
- PATCH /api/trips/:id/members/:userId {isAdmin?,canInvite?}，DELETE 同 URL 移除，POST /api/trips/:id/leave {confirmPurge:boolean} -> {purged:boolean}；PATCH /api/trips/:id/team {teamMode}；POST /api/trips/:id/archive {archived:boolean} 是本人旅程列表整理。
- POST /api/trips/:id/invites {expiresInHours} -> {id,code,url,expiresAt}；GET 同 URL -> {invites:[{id,issuedBy,expiresAt,revokedAt}]}；DELETE /api/trips/:id/invites/:inviteId；GET /api/invites/:code 仅最小预览 {name,teamMode}；POST /api/invites/accept {code} -> Snapshot。
- GET /api/trips/:id/events 是 SSE，只推 event:change / data:{cursor,epoch}，变更时客户端重读快照；连接立即发当前游标避免读取订阅间隙。授权变化立即关闭并发 event:revoked，周期复查会话。
- PUT /api/navigation {lastTripId?,tripId?,context?} -> {ok:true}，context 账号隔离，包含 page/dayId/scroll/selection/draft/map。
- 地图安全代理 /_AMapService/*，服务端注入 jscode，限定高德域名与路径并鉴权限流。前端通过 SDK 插件搜索/逆编码/路线，不能输出安全密钥；/api/config 只暴露公开 JS key。

## 前端集成（实现于 src/sync.js）

export useJourney() hook -> {ready,user,config,trips,snapshot,context,status,error,pendingCount,pendingOperations,pendingRecoveryGroups,recoveryBusy,tripsLoadState,sessionExpired,api,login,logout,openTrip,goHome,refresh,createTrip,joinTrip,mutate,captureScope,setContext,setDraft,updateDrafts,persistLocal,clearError,retry,retryPending,reapplyPending,discardPending,updateProfile,refreshTrips}。
api(path,{method,body}) 返回解析 JSON；path=/api/... 自动加 base；throws Error 带 code/status/details。
login({identifier,password,displayName?,register:boolean})；openTrip(id)；createTrip(form)；joinTrip(code)。mutate({objectId,kind,objectType,patch,generation,expression}) 立即乐观更新并等待本机持久化，自动上传，返回 Promise；不会为权限管理建立离线队列。
setContext(patch)（同步更新 React、异步持久化/上传）、setDraft(key,value) context.drafts；goHome 保留本旅程 context 和成员身份。context 默认 {page:'itinerary',dayId:null,drafts:{},map:{},scroll:{}}。status='checking'|'syncing'|'synced'|'offline'|'blocked'|'error'，连接状态由权威读取与同步结果确认，不能只依据 navigator.onLine 或队列为空。tripsLoadState={status:'idle'|'loading'|'ready'|'error',error,hasLoaded}，首页区分加载失败、缓存列表与确认空列表。hook 单例控制器，多组件共用。

- captureScope() 返回账号、旅程与会话代次；mutate(input,scope) 在实际入队前核验作用域，setContext(patch,scope)、updateDrafts(updater,scope)、persistLocal(scope) 可供编辑器清理所属旅程的已保存输入，避免旧异步结果影响后来打开的旅程。
- 每段旅程按原队列顺序上传，阻塞项之后的修改暂停，其他旅程继续。网络失败或回执无法解析时，按原操作标识与内容重试以确认结果。对象级 403/404 需另读旅程确认访问权限。
- pendingRecoveryGroups 每组为 {id,tripId,tripName,opIds,operations:[{id,summary}],reason,canReapply,canDiscard}。retryPending(id) 原样重试首个待处理项；reapplyPending(preview) 仅允许时间无法确认的修改及其同旅程后缀，经确认后用新时间与有序操作标识重提交，保持对象标识及生命周期代次；discardPending(preview) 明确放弃所列后缀并保留未完成草稿；存在未知回执时禁止放弃或重新应用，用户须先明确选择重试以继续提交并确认结果。恢复先等待在途请求结束，确认范围变化抛 RECOVERY_CHANGED（details.preview 为新预览），本机存储成功后才发布新队列。
- 费用编辑按 title/payment/notes/activityId 四组跟踪真实输入，payment 包含金额文本；干净组随共享快照更新，完成等待本机持久化，失败保留输入。旧完整草稿与共享内容不同时需显式恢复。费用名称可空；已支付须有非负有效金额（含零），预计金额可空。

实现于 src/MapView.jsx default component({journey,onEditActivity})，onEditActivity(activityObjectOrNull,initialPatch?)。UI owner 引入即可；地图全视口布局自行 style 在 map.css。

## 实施选择

- 手机底栏四项 行程/地图/费用/设置；首页个人设置同组件。
- 归档为个人列表整理，权限由本人控制，共享行程保持可编辑。
- 通知先提供本人设备的协作变化通知（用户主动开启权限；页面保持连接时），无行程闹钟或假送达开关。
- 日期范围、逻辑组、生命周期、永久清除与邀请撤权以正式规则为准。软删除保留，不提供未经决定的到期清理。
- 凭据缺失渠道在 config 标明并返回可操作错误，不生成固定验证码或生产测试登录。

- Service Worker 按构建内容版本预缓存应用 HTML/CSS/JS，地图瓦片和私人 API 不加入共享缓存。应用更新等待旧页面退出；所有未上传修改保存在账号隔离的 IndexedDB。
- trip 与 objects 均在快照附 expressions；临时删除不会删除关联对象，恢复使用最新内容。

- 新计划日使用 planDayId(tripId,{date,ordinal}) 的稳定标识，离线日期预览与服务器一致。较早的改期操作落败时仍建立其活动依赖的日期对象，作为范围外安排保留；命中已删除日期返回 DAY_DELETED，须先恢复。
