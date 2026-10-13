import React,{useId} from 'react';
import {Check,Loader2} from 'lucide-react';
import './team-mode.css';

const modes=[
 {value:'admin',label:'管理员团队',description:'创建者与管理员可直接删除内容。',detail:'成员可表达自己的意见。'},
 {value:'equal',label:'平等团队',description:'成员可通过集体表态删除内容。',detail:'创建者也可直接删除。'},
];

// Original line drawings: a shield coordinating a team, and peers in a shared circle.
function TeamModeIllustration({mode}) {
 return <svg className="team-mode-art" viewBox="0 0 128 80" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
  <ellipse cx="64" cy="42" rx="51" ry="33" fill="var(--accent-soft)" stroke="none" opacity=".7"/>
  {mode==='admin'?<>
   <path d="M64 40v8M30 53v-5h68v5" opacity=".4"/>
   <path d="M64 9c-5 4-11 6-17 7v12c0 10 7 16 17 21 10-5 17-11 17-21V16c-6-1-12-3-17-7Z" fill="var(--surface)"/>
   <path d="m57 28 5 5 10-11" strokeWidth="2.2"/>
   <circle cx="30" cy="60" r="5"/><path d="M20 75v-3a10 10 0 0 1 20 0v3"/>
   <circle cx="64" cy="60" r="5"/><path d="M54 75v-3a10 10 0 0 1 20 0v3"/>
   <circle cx="98" cy="60" r="5"/><path d="M88 75v-3a10 10 0 0 1 20 0v3"/>
   <path d="M24 23v6m-3-3h6m73-8v6m-3-3h6" opacity=".4"/>
  </>:<>
   <path d="M41 24a35 27 0 0 1 46 0M102 48c0 13-17 25-38 25S26 61 26 48" opacity=".4"/>
   <circle cx="28" cy="36" r="6"/><path d="M16 55v-4a12 12 0 0 1 24 0v4"/>
   <circle cx="64" cy="49" r="6"/><path d="M52 68v-4a12 12 0 0 1 24 0v4"/>
   <circle cx="100" cy="36" r="6"/><path d="M88 55v-4a12 12 0 0 1 24 0v4"/>
   <path d="M53 13h22a4 4 0 0 1 4 4v12a4 4 0 0 1-4 4h-9l-7 6v-6h-6a4 4 0 0 1-4-4V17a4 4 0 0 1 4-4Z" fill="var(--surface)"/>
   <path d="M58 23h12"/><circle cx="64" cy="73" r="2" fill="currentColor" stroke="none"/>
  </>}
 </svg>;
}

export default function TeamModePicker({value,onChange,disabled=false,pending=false,error=''}) {
 const id=useId();
 return <fieldset className="team-mode" role="radiogroup" aria-labelledby={`${id}-label`} aria-describedby={`${id}-common`} disabled={disabled||pending} aria-busy={pending}>
  <legend id={`${id}-label`}>团队类型</legend>
  <div className="team-mode-panel">
   <div className="team-mode-options">
    {modes.map(({value:mode,label,description,detail})=><label className="team-mode-option" key={mode}>
     <input type="radio" name={id} value={mode} checked={value===mode} aria-labelledby={`${id}-${mode}-label`} aria-describedby={`${id}-${mode}-description`} onChange={()=>onChange(mode)}/>
     <span className="team-mode-face">
      <TeamModeIllustration mode={mode}/>
      <span className="team-mode-indicator" aria-hidden="true"><Check size={13} strokeWidth={2.5}/></span>
      <span className="team-mode-content">
       <span className="team-mode-title" id={`${id}-${mode}-label`}>{label}</span>
       <span className="team-mode-description" id={`${id}-${mode}-description`}>
        <span>{description}</span><span className="team-mode-detail">{detail}</span>
       </span>
      </span>
     </span>
    </label>)}
   </div>
   <p className="team-mode-common" id={`${id}-common`}>大家都能添加和编辑行程。</p>
  </div>
  {pending&&<p className="team-mode-status" role="status"><Loader2 size={14} className="spin" aria-hidden="true"/>正在切换…</p>}
  {error&&<p className="field-error" role="alert">{error}</p>}
 </fieldset>;
}
