import React,{useId} from 'react';
import {Check,Loader2} from 'lucide-react';
import './team-mode.css';

const modes=[
 {value:'admin',label:'管理员团队',summary:'由管理员管理',description:'创建者与管理员可直接删除内容，成员可表达自己的意见。'},
 {value:'equal',label:'平等团队',summary:'由成员共同表态',description:'成员可通过集体表态删除内容，创建者也可直接删除。'},
];

// Original line drawings: a central steward, or three peers around one shared plan.
function TeamModeSketch({mode}) {
 return <svg className="team-mode-sketch" viewBox="0 0 160 100" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
  <path className="team-mode-sketch-ground" d="M20 88h120"/>
  {mode==='admin'?<>
   <path className="team-mode-sketch-tint" d="M80 12 101 20v19c0 16-21 26-21 26S59 55 59 39V20z"/>
   <path d="M80 12 101 20v19c0 16-21 26-21 26S59 55 59 39V20z"/>
   <path d="m71 36 6 6 12-14M80 66v10M43 76h74M43 76v8m74-8v8"/>
   <circle cx="36" cy="48" r="7"/><circle cx="124" cy="48" r="7"/><path d="M24 68v-3a12 12 0 0 1 24 0v3M112 68v-3a12 12 0 0 1 24 0v3"/>
   <path className="team-mode-sketch-paper" d="M68 75h24v17H68z"/><path d="M74 81h12m-12 5h7"/>
  </>:<>
   <ellipse className="team-mode-sketch-tint" cx="80" cy="64" rx="40" ry="21"/>
   <path d="M46 48a43 43 0 0 1 23-12m22 0a43 43 0 0 1 23 12M47 79a55 55 0 0 0 66 0" strokeDasharray="3 5"/>
   <circle cx="80" cy="20" r="7"/><path d="M68 40v-3a12 12 0 0 1 24 0v3"/>
   <circle cx="32" cy="57" r="7"/><path d="M20 77v-3a12 12 0 0 1 24 0v3"/>
   <circle cx="128" cy="57" r="7"/><path d="M116 77v-3a12 12 0 0 1 24 0v3"/>
   <path className="team-mode-sketch-paper" d="M66 53h28v22H66z"/><path d="m72 63 4 4 6-8m3 3h4m-4 6h4"/>
   <path d="m51 60 4 4 6-7m38 3 4 4 6-7"/>
  </>}
 </svg>;
}

export default function TeamModePicker({value,onChange,disabled=false,pending=false,error=''}) {
 const id=useId();
 return <fieldset className="team-mode" role="radiogroup" aria-labelledby={`${id}-label`} aria-describedby={`${id}-common`} disabled={disabled||pending} aria-busy={pending}>
  <legend id={`${id}-label`}>团队类型</legend>
  <div className="team-mode-panel">
   <div className="team-mode-options">
    {modes.map(({value:mode,label,summary,description})=><label className="team-mode-option" key={mode}>
     <input type="radio" name={id} value={mode} checked={value===mode} aria-labelledby={`${id}-${mode}-label`} aria-describedby={`${id}-${mode}-description ${id}-common`} onChange={()=>onChange(mode)}/>
     <span className="team-mode-face">
      <span className="team-mode-indicator"><Check size={12} aria-hidden="true"/></span>
      <TeamModeSketch mode={mode}/>
      <span className="team-mode-details">
       <span className="team-mode-title" id={`${id}-${mode}-label`}>{label}</span>
       <span className="team-mode-summary">{summary}</span>
       <span className="team-mode-description" id={`${id}-${mode}-description`}>{description}</span>
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
