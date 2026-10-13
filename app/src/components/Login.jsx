import React,{useEffect,useId,useRef,useState} from 'react';
import {ArrowRight,Eye,EyeOff,LockKeyhole,UserRound} from 'lucide-react';
import {Field,IconButton,errorMessage} from './ui.jsx';

function JourneySketch(){
 return <figure className="journey-sketch">
  <svg className="journey-drawing" viewBox="0 0 640 460" fill="none" aria-hidden="true" focusable="false">
   <g stroke="currentColor" strokeLinecap="round" strokeLinejoin="round">
    <g className="sketch-atmosphere" strokeWidth="1">
     <circle cx="327" cy="231" r="112"/><circle cx="327" cy="231" r="139"/>
     <path d="M48 351c44-5 68-8 102-1m329-183c37-17 64-17 100-8"/>
     <circle cx="134" cy="170" r="5"/><circle cx="510" cy="317" r="8"/>
     <path d="M205 119v12m-6-6h12m247 242v10m-5-5h10"/>
    </g>
    <path className="sketch-route" d="M23 318C100 244 134 289 181 311S258 321 289 265S378 252 420 233S478 170 536 142" strokeWidth="1.6" strokeDasharray="4 10"/>
    <g transform="translate(87 264)"><g className="sketch-parallax sketch-pin"><g className="sketch-float">
     <ellipse className="sketch-shadow" cy="43" rx="22" ry="5" stroke="none"/>
     <path className="sketch-paper" d="M0 24S-19 3-19-9a19 19 0 0 1 38 0C19 3 0 24 0 24Z" strokeWidth="2"/>
     <circle cy="-9" r="6" strokeWidth="1.8"/><circle className="sketch-tint" cy="-9" r="3" stroke="none"/>
    </g></g></g>
    <g transform="translate(183 318)"><g className="sketch-parallax sketch-photo"><g className="sketch-float">
     <g transform="rotate(13)">
      <rect className="sketch-tint" x="-22" y="-22" width="52" height="60" rx="7" stroke="none"/>
      <rect className="sketch-paper" x="-29" y="-32" width="54" height="60" rx="6" strokeWidth="1.8"/>
      <path d="M-20 11-7-6 3 6l7-8 7 13" strokeWidth="1.7"/>
      <circle className="sketch-tint" cx="9" cy="-18" r="5" stroke="none"/>
      <path d="M-19 18h34" strokeWidth="1.4" opacity=".35"/>
     </g>
    </g></g></g>
    <g transform="translate(327 231)"><g className="sketch-parallax sketch-compass"><g className="sketch-float">
     <circle className="sketch-halo" r="79" stroke="none"/>
     <circle className="sketch-paper" r="58" strokeWidth="1.4"/>
     <circle r="47" strokeWidth="2.2"/>
     <g opacity=".45" strokeWidth="1.5"><path d="M0-38v5m0 66v5m-38-38h5m66 0h5"/></g>
     <g className="sketch-needle">
      <path className="sketch-tint" d="m20-22-10 32-30 12 10-32Z" strokeWidth="2"/>
      <path d="m20-22-20 22-10-10Z" fill="currentColor" strokeWidth="1.5"/>
      <circle r="3" className="sketch-paper" strokeWidth="1.5"/>
     </g>
    </g></g></g>
    <g transform="translate(535 143)"><g className="sketch-parallax sketch-plane"><g className="sketch-float">
     <path className="sketch-tint" d="m-28 1 75-27-26 65-15-28Z" stroke="none" transform="translate(4 7)"/>
     <path className="sketch-paper" d="m-32-5 76-24-26 65L3 8Z" strokeWidth="1.8"/>
     <path d="M3 8 44-29M3 8l-3 21 12-10" strokeWidth="1.8"/>
     <path className="sketch-wind" d="m-49 11-14 6m27 9-27 12" strokeWidth="1.5"/>
    </g></g></g>
    <g className="sketch-sparkles" strokeWidth="1.5"><path d="M416 108v12m-6-6h12"/><circle cx="69" cy="186" r="2" fill="currentColor" stroke="none"/><circle cx="439" cy="299" r="3" fill="currentColor" stroke="none"/></g>
   </g>
  </svg>
  <figcaption>一起计划，一起出发<span aria-hidden="true">。</span></figcaption>
 </figure>;
}

function useSketchPointer(ref,enabled){
 useEffect(()=>{
  if(!enabled)return;
  const node=ref.current,root=document.documentElement;
  const reduced=matchMedia('(prefers-reduced-motion: reduce)'),fine=matchMedia('(any-pointer: fine)');
  let frame=0;
  const reset=()=>{cancelAnimationFrame(frame);node.style.removeProperty('--sketch-x');node.style.removeProperty('--sketch-y');node.style.removeProperty('--needle-turn')};
  const allowed=()=>fine.matches&&root.dataset.motion!=='true'&&(root.dataset.motion==='false'||!reduced.matches);
  const move=event=>{
   if(event.pointerType==='touch'||!allowed())return;
   const rect=node.getBoundingClientRect(),sketch=node.querySelector('.journey-sketch').getBoundingClientRect();
   const x=Math.max(-1,Math.min(1,(event.clientX-rect.left)/rect.width*2-1));
   const y=Math.max(-1,Math.min(1,(event.clientY-sketch.top)/sketch.height*2-1));
   cancelAnimationFrame(frame);
   frame=requestAnimationFrame(()=>{node.style.setProperty('--sketch-x',`${x*12}px`);node.style.setProperty('--sketch-y',`${y*9}px`);node.style.setProperty('--needle-turn',`${x*22-y*9}deg`)});
  };
  const preferencesChanged=()=>{if(!allowed())reset()};
  const observer=new MutationObserver(preferencesChanged);
  observer.observe(root,{attributes:true,attributeFilter:['data-motion']});
  reduced.addEventListener('change',preferencesChanged);fine.addEventListener('change',preferencesChanged);
  node.addEventListener('pointermove',move,{passive:true});node.addEventListener('pointerleave',reset);
  return()=>{reset();observer.disconnect();reduced.removeEventListener('change',preferencesChanged);fine.removeEventListener('change',preferencesChanged);node.removeEventListener('pointermove',move);node.removeEventListener('pointerleave',reset)};
 },[ref,enabled]);
}

function ModeCopy({register,login,registration}){
 return <span className="login-copy"><span data-copy="login" aria-hidden={register}>{login}</span><span data-copy="register" aria-hidden={!register}>{registration}</span></span>;
}

function RegisterField({register,children}){
 return <div className="login-reveal" aria-hidden={!register} inert={!register}><div>{children}</div></div>;
}

export default function Login({journey:j,onDone,illustrated=false}){
 const[form,setForm]=useState(()=>{try{return JSON.parse(sessionStorage.getItem('journey.loginDraft'))||{identifier:'',password:'',displayName:'',register:false}}catch{return {identifier:'',password:'',displayName:'',register:false}}});
 const[error,setError]=useState(''),[busy,setBusy]=useState(false),[showPassword,setShowPassword]=useState(false);
 const[confirmation,setConfirmation]=useState(''),[confirmationTouched,setConfirmationTouched]=useState(false),[showConfirmation,setShowConfirmation]=useState(false);
 const layout=useRef(null),confirmationInput=useRef(null),headingId=useId();
 const confirmationError=form.register&&confirmationTouched&&confirmation!==form.password?'两次输入的密码不一致':'';
 useSketchPointer(layout,illustrated);
 function change(key,value){
  const n={...form,[key]:value};setForm(n);setError('');
  if(key==='register'){setConfirmationTouched(false);setShowConfirmation(false)}
  sessionStorage.setItem('journey.loginDraft',JSON.stringify({...n,password:''}));
 }
 async function submit(event){
  event.preventDefault();if(busy)return;setError('');
  if(form.register&&confirmation!==form.password){setConfirmationTouched(true);confirmationInput.current.focus();return}
  setBusy(true);
  try{await j.login(form);sessionStorage.removeItem('journey.loginDraft');onDone?.()}catch(e){setError(errorMessage(e))}finally{setBusy(false)}
 }
 const card=<section className="login-card" data-mode={form.register?'register':'login'} aria-labelledby={headingId}>
  <header className="login-heading">
   <h1 id={headingId}><ModeCopy register={form.register} login="欢迎回来" registration="从这里，一起出发"/></h1>
   <p><ModeCopy register={form.register} login="登录后，继续你的旅行计划" registration="创建账号，开启你的下一程"/></p>
  </header>
  <div className="segmented login-mode" role="group" aria-label="账号操作">
   <button type="button" aria-pressed={!form.register} className={!form.register?'selected':''} disabled={busy} onClick={()=>change('register',false)}>登录</button>
   <button type="button" aria-pressed={form.register} className={form.register?'selected':''} disabled={busy} onClick={()=>change('register',true)}>创建账号</button>
  </div>
  <form className="login-form" aria-busy={busy} onSubmit={submit}>
   <Field label="手机号或邮箱"><input autoComplete="username" autoCapitalize="none" spellCheck={false} required disabled={busy} value={form.identifier} onChange={e=>change('identifier',e.target.value)} placeholder="输入手机号或邮箱"/><UserRound className="login-field-icon" size={18} aria-hidden="true"/></Field>
   <RegisterField register={form.register}><Field label="你的称呼"><input autoComplete="nickname" required={form.register} disabled={busy||!form.register} maxLength={80} value={form.displayName} onChange={e=>change('displayName',e.target.value)} placeholder="怎么称呼你"/><UserRound className="login-field-icon" size={18} aria-hidden="true"/></Field></RegisterField>
   <Field label="密码"><input type={showPassword?'text':'password'} autoComplete={form.register?'new-password':'current-password'} required disabled={busy} minLength={10} maxLength={128} value={form.password} onChange={e=>change('password',e.target.value)} placeholder={form.register?'10 至 128 个字符':'输入密码'}/><LockKeyhole className="login-field-icon" size={18} aria-hidden="true"/><IconButton icon={showPassword?EyeOff:Eye} label={showPassword?'隐藏密码':'显示密码'} onClick={()=>setShowPassword(v=>!v)}/></Field>
   <RegisterField register={form.register}><Field label="确认密码" error={confirmationError}><input ref={confirmationInput} type={showConfirmation?'text':'password'} autoComplete="new-password" required={form.register} disabled={busy||!form.register} maxLength={128} value={confirmation} onChange={e=>setConfirmation(e.target.value)} onBlur={()=>setConfirmationTouched(true)} placeholder="再次输入密码"/><LockKeyhole className="login-field-icon" size={18} aria-hidden="true"/><IconButton icon={showConfirmation?EyeOff:Eye} label={showConfirmation?'隐藏确认密码':'显示确认密码'} disabled={busy||!form.register} onClick={()=>setShowConfirmation(v=>!v)}/></Field></RegisterField>
   {error&&<p role="alert" className="field-error">{error}</p>}
   <button className="primary" disabled={busy} type="submit">{busy?<span>正在继续…</span>:<ModeCopy register={form.register} login="登录并继续" registration="创建账号并继续"/>}<ArrowRight size={18} aria-hidden="true"/></button>
  </form>
 </section>;
 return illustrated?<div className="auth-layout" ref={layout}><JourneySketch/>{card}</div>:card;
}
