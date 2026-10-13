import React,{useEffect,useMemo,useRef,useState} from 'react';
import {Compass,Plus,LogIn,ArrowRight,UserRound,ScanLine,Link,CameraOff,CalendarDays,MapPin} from 'lucide-react';
import {Modal,Field,AsyncButton,IconButton,Empty,errorMessage,useDraft} from './ui.jsx';
import {dateAdd,dateRangeDays} from '../domain.js';
import {resolveDestinationTimezone} from '../amap.js';
import {migrateTimezoneChoice,validTimezone,timezoneLabel} from '../destination-timezone.js';
import TeamModePicker from './TeamModePicker.jsx';
export function Login({journey:j,onDone}){const[form,setForm]=useState(()=>{try{return JSON.parse(sessionStorage.getItem('journey.loginDraft'))||{identifier:'',password:'',displayName:'',register:false}}catch{return {identifier:'',password:'',displayName:'',register:false}}});const[error,setError]=useState(''),[busy,setBusy]=useState(false);function change(key,value){const n={...form,[key]:value};setForm(n);sessionStorage.setItem('journey.loginDraft',JSON.stringify({...n,password:''}))}return <div className="login-wrap"><div className="brand-mark"><Compass size={32}/></div><p className="eyebrow">同行 JOURNEY</p><h1>把下一程，<br/>一起安排好。</h1><p className="muted">收集想去的地方，安排每天的时间，<br/>和同伴共用一份旅行计划。</p><div className="segmented"><button className={!form.register?'selected':''} onClick={()=>change('register',false)}>登录</button><button className={form.register?'selected':''} onClick={()=>change('register',true)}>创建账号</button></div><form className="login-form" onSubmit={async e=>{e.preventDefault();setError('');setBusy(true);try{await j.login(form);sessionStorage.removeItem('journey.loginDraft');onDone?.()}catch(e){setError(errorMessage(e))}finally{setBusy(false)}}}><Field label="手机号或邮箱"><input autoComplete="username" required value={form.identifier} onChange={e=>change('identifier',e.target.value)} placeholder="输入手机号或邮箱"/></Field>{form.register&&<Field label="你的称呼"><input autoComplete="nickname" required maxLength={80} value={form.displayName} onChange={e=>change('displayName',e.target.value)}/></Field>}<Field label="密码"><input type="password" autoComplete={form.register?'new-password':'current-password'} required minLength={10} maxLength={128} value={form.password} onChange={e=>change('password',e.target.value)} placeholder={form.register?'10 至 128 个字符':'输入密码'}/></Field>{error&&<p role="alert" className="field-error">{error}</p>}<button className="primary" disabled={busy} type="submit">{busy?'正在继续…':form.register?'创建账号并继续':'登录并继续'}<ArrowRight size={17}/></button></form></div>}
export function CreateTrip({journey:j,onClose}) {
 const localZone=Intl.DateTimeFormat().resolvedOptions().timeZone;
 const [draft,setDraft]=useDraft(j,'createTrip',{name:'',teamMode:'admin',destination:'',startDate:'',endDate:'',currency:'CNY',timezoneChoice:'destination'});
 const [error,setError]=useState(''),[busy,setBusy]=useState(false),[extraOpen,setExtraOpen]=useState(false);
 const [lookup,setLookup]=useState({destination:'',status:'idle',timezone:null,error:''});
 const lookupSequence=useRef(0);
 const form={...draft,teamMode:draft.teamMode||'admin',endDate:draft.endDate??(draft.startDate&&Number(draft.dayCount)>0?dateAdd(draft.startDate,Number(draft.dayCount)-1):''),timezoneChoice:migrateTimezoneChoice(draft)};
 const destination=form.destination.trim(),automatic=form.timezoneChoice==='destination';
 const destinationTimezone=lookup.destination===destination&&lookup.status==='ready'?lookup.timezone:null;
 const timezone=automatic ? destinationTimezone : form.timezoneChoice;
 const pending=automatic&&!!destination&&(lookup.destination!==destination||lookup.status==='pending');
 const reference=useMemo(()=>form.startDate?new Date(`${form.startDate}T12:00:00Z`):new Date(),[form.startDate]);
 const zones=useMemo(()=>[...new Set([localZone,'Asia/Shanghai','Asia/Taipei','Asia/Hong_Kong','Asia/Macau','UTC',...Intl.supportedValuesOf('timeZone')])], [localZone]);
 const zoneOptions=useMemo(()=>zones.map(zone=>({value:zone,label:`${timezoneLabel(zone,reference)} · ${zone.split('/').at(-1).replaceAll('_',' ')}`})),[zones,reference]);
 const update=(key,value)=>{setDraft({...form,[key]:value});setError('')};
 useEffect(()=>{
  const sequence=++lookupSequence.current,controller=new AbortController();
  if(!automatic)return()=>controller.abort();
  if(!destination){setLookup({destination:'',status:'idle',timezone:null,error:''});return()=>controller.abort();}
  if(lookup.destination===destination&&lookup.status==='ready')return()=>controller.abort();
  setLookup({destination,status:'pending',timezone:null,error:''});
  const timer=setTimeout(async()=>{
   try {
    const zone=await resolveDestinationTimezone(destination,{signal:controller.signal});
    if(!controller.signal.aborted&&sequence===lookupSequence.current)setLookup({destination,status:'ready',timezone:zone,error:''});
   }catch(error){
    if(!controller.signal.aborted&&sequence===lookupSequence.current){setLookup({destination,status:'error',timezone:null,error:'未能确认目的地时区，请手动选择。'});setExtraOpen(true);}
   }
  },400);
  return()=>{clearTimeout(timer);controller.abort();};
 },[destination,automatic]);
 const automaticLabel=destinationTimezone ? `目的地当地 · ${timezoneLabel(destinationTimezone,reference)}` : pending ? '目的地当地 · 正在确认…' : !destination ? '目的地当地 · 填写目的地后确认' : automatic&&lookup.status==='error' ? '目的地当地 · 未能确认' : '按目的地自动确定';
 return <Modal title="开始一段新旅程" onClose={onClose}>
  <form onSubmit={async e=>{
   e.preventDefault();setError('');
   try {
    const dayCount=dateRangeDays(form.startDate,form.endDate);
    if(!destination)throw new Error('请填写目的地');
    if(!validTimezone(timezone)){setExtraOpen(true);throw new Error(pending?'正在确认目的地时区，请稍候。':'请选择旅程时区。');}
    setBusy(true);
    await j.createTrip({name:form.name.trim(),teamMode:form.teamMode,destination,startDate:form.startDate,dayCount,currency:form.currency,timezone});
    localStorage.removeItem(`journey.form:${j.user?.id||'guest'}:createTrip`);onClose();
   }catch(e){setError(errorMessage(e))}finally{setBusy(false)}
  }}>
   <Field label="旅程名称"><input required maxLength={120} value={form.name} autoFocus onChange={e=>update('name',e.target.value)} placeholder="给这次旅行起个名字"/></Field>
   <Field label="目的地" help={timezone&&validTimezone(timezone)?automatic?automaticLabel:`${timezoneLabel(timezone,reference)}`:pending?'正在确认目的地时区…':undefined}><input required maxLength={240} value={form.destination} onChange={e=>update('destination',e.target.value)} placeholder="城市或地区，例如南京"/></Field>
   <div className="form-grid create-trip-dates">
    <Field label="出发日期" help="按目的地当地日期安排"><input type="date" required value={form.startDate} onChange={e=>update('startDate',e.target.value)}/></Field>
    <Field label="结束日期"><input type="date" required min={form.startDate||undefined} max={form.startDate?dateAdd(form.startDate,364):undefined} value={form.endDate} onChange={e=>update('endDate',e.target.value)}/></Field>
   </div>
   <TeamModePicker value={form.teamMode} onChange={mode=>update('teamMode',mode)} disabled={busy}/>
   <details className="trip-extra-settings" open={extraOpen} onToggle={event=>setExtraOpen(event.currentTarget.open)}><summary>更多设置</summary>
    <Field label="旅程时区" error={automatic&&lookup.destination===destination&&lookup.status==='error'?lookup.error:undefined}><select value={form.timezoneChoice} onChange={e=>update('timezoneChoice',e.target.value)}><option value="destination">{automaticLabel}</option>{zoneOptions.map(zone=><option value={zone.value} key={zone.value}>{zone.label}</option>)}</select></Field>
    <Field label="记账币种"><select value={form.currency} onChange={e=>update('currency',e.target.value)}>{['CNY','USD','EUR','JPY','GBP','HKD','KRW','SGD','THB'].map(c=><option key={c}>{c}</option>)}</select></Field>
   </details>
   {error&&<p className="field-error" role="alert">{error}</p>}
   <button className="primary full" disabled={busy||pending} type="submit">{busy?'正在创建…':pending?'正在确认时区…':'创建旅程'}<ArrowRight size={17}/></button>
  </form>
 </Modal>;
}
export function inviteCode(input){const text=input.trim();try{const u=new URL(text);return u.searchParams.get('invite')||u.pathname.split('/').filter(Boolean).at(-1)}catch{return text}}
export function JoinTrip({journey:j,onClose,initialCode=''}){const[code,setCode]=useState(initialCode),[preview,setPreview]=useState(null),[error,setError]=useState(''),[scan,setScan]=useState(false);const video=useRef(null);useEffect(()=>{if(!scan)return;let stream,raf,cancelled=false;async function start(){try{if(!window.BarcodeDetector)throw new Error('此浏览器暂不支持扫码，请输入邀请编码或粘贴邀请链接。');stream=await navigator.mediaDevices.getUserMedia({video:{facingMode:'environment'}});if(cancelled){stream.getTracks().forEach(t=>t.stop());return}video.current.srcObject=stream;await video.current.play();const detector=new BarcodeDetector({formats:['qr_code']});async function tick(){if(cancelled)return;try{const codes=await detector.detect(video.current);if(codes.length){setCode(inviteCode(codes[0].rawValue));setPreview(null);setScan(false);return}}catch{}raf=requestAnimationFrame(tick)}tick()}catch(e){setError(errorMessage(e));setScan(false)}}start();return()=>{cancelled=true;cancelAnimationFrame(raf);stream?.getTracks().forEach(t=>t.stop())}},[scan]);return <Modal title="加入同伴的旅程" onClose={onClose}><p className="muted">输入同伴发来的邀请编码，或粘贴邀请链接。</p><Field label="邀请编码或链接"><input value={code} onChange={e=>{setCode(e.target.value);setPreview(null)}} autoFocus autoComplete="off"/></Field><button className="secondary full" onClick={()=>{setError('');setScan(!scan)}}><ScanLine size={18}/>{scan?'停止扫码':'扫描二维码'}</button>{scan&&<video className="scanner" ref={video} playsInline muted/>}{preview&&<div className="invite-preview"><Compass size={26}/><h3>{preview.name}</h3><p>{preview.teamMode==='admin'?'管理员团队':'平等团队'} · 加入后可共同添加和编辑</p></div>}{error&&<p role="alert" className="field-error">{error}</p>}<AsyncButton className="primary full" disabled={!code.trim()} onClick={async()=>{setError('');try{const parsed=inviteCode(code);if(!j.user){localStorage.setItem('journey.inviteIntent',parsed);onClose();return}if(!preview)setPreview(await j.api(`/api/invites/${encodeURIComponent(parsed)}`));else{await j.joinTrip(parsed);localStorage.removeItem('journey.inviteIntent');onClose()}}catch(e){setError(errorMessage(e))}}}>{!j.user?'登录后继续':preview?'确认加入':'查看旅程'}<ArrowRight size={17}/></AsyncButton></Modal>}
export function Home({journey:j,onCreate,onJoin,onSettings}){const allTrips=j.trips||[];const trips=allTrips.filter(t=>t.state!=='deleted');const deletedTrips=allTrips.filter(t=>t.state==='deleted');const recent=trips.find(t=>t.id===j.lastTripId);return <div className="home"><header className="home-header"><a className="brand" href="#" onClick={e=>e.preventDefault()}><Compass/>同行<span>JOURNEY</span></a><button className="profile-button" onClick={onSettings}><span className="avatar">{j.user?.displayName?.slice(0,1)||<UserRound size={18}/>}</span><span>{j.user?.displayName||'个人设置'}</span></button></header><main className="home-main"><h1>我的旅程</h1>{recent&&<button className="continue-card" onClick={()=>j.openTrip(recent.id).catch(()=>{})}><div className="trip-art"><Compass size={48}/></div><div className="continue-content"><span className="eyebrow">继续旅程</span><h2>{recent.name}</h2><p>{[recent.destination,recent.startDate,`${recent.dayCount||1}天`].filter(Boolean).join(' · ')}</p></div><span className="continue-arrow"><ArrowRight/></span></button>}<div className="home-actions"><button className="primary" onClick={onCreate}><Plus size={18}/>创建旅程</button><button className="secondary" onClick={onJoin}><LogIn size={18}/>加入旅程</button></div>{trips.filter(t=>t.id!==recent?.id).length>0&&<section className="other-trips"><h2>其他旅程</h2><div className="trip-grid">{trips.filter(t=>t.id!==recent?.id).map(t=><button className="trip-card" key={t.id} onClick={()=>j.openTrip(t.id).catch(()=>{})}><span className="trip-card-icon"><Compass/></span><h3>{t.name}</h3><p>{[t.destination,t.startDate,t.archived?'已归档':null].filter(Boolean).join(' · ')||`${t.dayCount||1}天`}</p><ArrowRight size={17}/></button>)}</div></section>}{deletedTrips.length>0&&<section className="other-trips deleted-trips"><h2>已删除旅程</h2><div className="trip-grid">{deletedTrips.map(t=><button className="trip-card recovery-trip-card" key={t.id} onClick={()=>j.openTrip(t.id).catch(()=>{})}><h3>{t.name}</h3><p>查看与恢复{t.expressions?.some(e=>e.wishRestore)?` · ${t.expressions.filter(e=>e.wishRestore).length} 位同伴希望恢复`:""}</p><ArrowRight size={17}/></button>)}</div></section>}</main></div>}
