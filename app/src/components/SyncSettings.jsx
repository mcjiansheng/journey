import React,{useEffect,useRef,useState} from 'react';
import {RefreshCw} from 'lucide-react';
import {AsyncButton,Modal,Section,errorMessage} from './ui.jsx';
import './sync-settings.css';

export const syncStatusText={synced:'已同步',syncing:'正在同步',offline:'连接中断',checking:'正在确认同步',blocked:'修改需要处理',error:'同步需要处理'};

function recoveryReason(group){
 if(group.canDiscard===false)return '有修改的提交结果尚未确认。重试会继续提交这些修改，确认结果后再处理其余内容。';
 if(group.reason==='CLOCK_UNCERTAIN')return '部分修改的先后时间无法确认，可以重新应用或放弃这些修改。';
 if(group.reason==='STALE_GENERATION')return '内容状态已被同伴更新，请查看当前内容后处理这些修改。';
 if(group.reason==='FORBIDDEN')return '当前权限无法提交这些修改。';
 return '部分修改尚未上传，可以重试或查看待处理内容。';
}

export default function SyncSettings({journey:j}){
 const [error,setError]=useState(''),[confirmation,setConfirmation]=useState(null);
 const mounted=useRef(false);
 useEffect(()=>{mounted.current=true;return()=>{mounted.current=false}},[]);
 const groups=j.pendingRecoveryGroups||[];
 async function run(action){
  setError('');
  try{await action()}catch(e){if(mounted.current)setError(errorMessage(e))}
 }
 function preview(group,action){
  setError('');setConfirmation({group:structuredClone(group),action,error:''});
 }
 async function confirm(){
  const pending=confirmation;
  try{
   await (pending.action==='reapply'?j.reapplyPending(pending.group):j.discardPending(pending.group));
   if(mounted.current)setConfirmation(null);
  }catch(e){
   if(!mounted.current)return;
   if(e.code==='RECOVERY_CHANGED'){
    const group=e.details?.preview;
    if(group)setConfirmation({...pending,group,error:'待处理内容已变化，请重新确认。'});
    else{setConfirmation(null);setError('待处理内容已变化，请重新查看。')}
   }else setConfirmation({...pending,error:errorMessage(e)});
  }
 }
 return <Section title="保存与同步">
  <div className="setting-row">
   <div><strong>{syncStatusText[j.status]||'正在确认同步'}</strong><p>{j.pendingCount?`${j.pendingCount} 项修改等待上传`:j.status==='synced'?'当前修改已同步。':'本机草稿会继续保留。'}</p></div>
   <AsyncButton className="secondary small" disabled={j.recoveryBusy} onClick={()=>run(()=>j.retry())}><RefreshCw size={15}/>重试连接</AsyncButton>
  </div>
  {groups.map(group=><article className="sync-recovery-group" key={group.tripId}>
   <h3>{group.tripName}</h3><p className="muted">{recoveryReason(group)}</p>
   <details><summary>{group.operations.length} 项修改需要处理</summary><ol className="sync-operation-list">{group.operations.map(operation=><li key={operation.id}>{operation.summary}</li>)}</ol></details>
   <div className="button-row">
    {group.canReapply?<button className="secondary small" disabled={j.recoveryBusy} onClick={()=>preview(group,'reapply')}>重新应用</button>:<AsyncButton className="secondary small" disabled={j.recoveryBusy} onClick={()=>run(()=>j.retryPending(group.id))}>{group.canDiscard===false?'重试并确认结果':'重试这些修改'}</AsyncButton>}
    <button className="text-button danger" disabled={j.recoveryBusy||group.canDiscard===false} onClick={()=>preview(group,'discard')}>放弃这些修改</button>
   </div>
  </article>)}
  {error&&<p className="field-error" role="alert">{error}</p>}
  <details><summary>本机存储</summary><p className="muted">当前设备保留各旅程的草稿和待上传修改。</p><AsyncButton className="text-button" onClick={()=>run(async()=>{const estimate=await navigator.storage?.estimate?.();setError(estimate?`已使用约 ${(estimate.usage/1024/1024).toFixed(1)} MB，可用容量约 ${(estimate.quota/1024/1024).toFixed(0)} MB。`:'当前浏览器无法读取存储容量。')})}>查看存储用量</AsyncButton></details>
  {confirmation&&<Modal title={confirmation.action==='reapply'?'重新应用修改':'放弃待上传修改'} onClose={()=>{if(!j.recoveryBusy)setConfirmation(null)}}>
   <h3>{confirmation.group.tripName}</h3>
   <p className="muted">{confirmation.action==='reapply'?`将下面 ${confirmation.group.operations.length} 项修改按当前内容重新提交。`:`放弃下面 ${confirmation.group.operations.length} 项尚未上传的修改。未完成的编辑输入会保留。`}</p>
   <ol className="sync-operation-list">{confirmation.group.operations.map(operation=><li key={operation.id}>{operation.summary}</li>)}</ol>
   {confirmation.error&&<p className="field-error" role="alert">{confirmation.error}</p>}
   <div className="button-row"><button className="secondary" disabled={j.recoveryBusy} onClick={()=>setConfirmation(null)}>取消</button><AsyncButton className={confirmation.action==='reapply'?'primary':'danger-button'} disabled={j.recoveryBusy} onClick={confirm}>{confirmation.action==='reapply'?'确认重新应用':'确认放弃'}</AsyncButton></div>
  </Modal>}
 </Section>;
}
