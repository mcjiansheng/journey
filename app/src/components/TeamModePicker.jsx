import React,{useId} from 'react';
import {ShieldCheck,UsersRound,Loader2} from 'lucide-react';
import './team-mode.css';

const modes=[
 {value:'admin',label:'管理员团队',Icon:ShieldCheck,description:'创建者与管理员可直接删除内容，成员可表达自己的意见。'},
 {value:'equal',label:'平等团队',Icon:UsersRound,description:'成员可通过集体表态删除内容，创建者也可直接删除。'},
];

export default function TeamModePicker({value,onChange,disabled=false,pending=false,error=''}) {
 const id=useId();
 return <fieldset className="team-mode" role="radiogroup" aria-labelledby={`${id}-label`} disabled={disabled||pending} aria-busy={pending}>
  <legend id={`${id}-label`}>团队类型</legend>
  <div className="team-mode-panel">
   <div className="team-mode-options">
    {modes.map(({value:mode,label,Icon})=><label className="team-mode-option" key={mode}>
     <input type="radio" name={id} value={mode} checked={value===mode} aria-describedby={`${id}-${mode}-description`} onChange={()=>onChange(mode)}/>
     <span className="team-mode-face"><Icon size={18} aria-hidden="true"/><span>{label}</span></span>
    </label>)}
   </div>
   <div className="team-mode-copy" aria-live="polite" aria-atomic="true">
    {modes.map(mode=><p key={mode.value} id={`${id}-${mode.value}-description`} hidden={value!==mode.value}>{mode.description}</p>)}
    <p className="team-mode-common">大家都能添加和编辑行程。</p>
   </div>
  </div>
  {pending&&<p className="team-mode-status" role="status"><Loader2 size={14} className="spin" aria-hidden="true"/>正在切换…</p>}
  {error&&<p className="field-error" role="alert">{error}</p>}
 </fieldset>;
}
