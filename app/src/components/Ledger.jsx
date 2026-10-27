import React,{useEffect,useRef,useState} from 'react';
import {Plus,Receipt,ArrowUpRight,MoreHorizontal} from 'lucide-react';
import {Modal,Field,Empty,money,active,id,errorMessage,currencyFactor} from './ui.jsx';
import {ObjectActions} from './Itinerary.jsx';
import './editor-ledger.css';
const groups=['title','payment','notes','activityId','date'];
const today=timezone=>new Intl.DateTimeFormat('sv-SE',{timeZone:timezone}).format(new Date());
const same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
const asDraft=payload=>({...payload,amount:payload.payment.amountMinor===null?'':String(payload.payment.amountMinor/currencyFactor(payload.payment.currency))});
const groupValue=(draft,key)=>key==='payment'?{payment:draft.payment,amount:draft.amount}:key==='date'?(draft.date||null):draft[key];
export function ExpenseEditor({journey:j,object,objectId:providedId,initialPaymentStatus,onClose}){
 const scope=useRef(j.captureScope()).current;
 const objectId=useRef(providedId||object?.id||j.context.pendingExpenseId||id()).current;
 const existing=j.snapshot.objects.find(o=>o.id===objectId)||object;
 const draftKey=`expense:${objectId}`,fieldsKey=`${draftKey}:editedFields`,legacyKey=`${draftKey}:previousInput`;
 const fallback=useRef({title:'',payment:{status:'paid',amountMinor:null,currency:j.snapshot.trip.currency||'CNY'},amount:'',notes:'',activityId:null,date:today(j.snapshot.trip.timezone)}).current;
 const edited=useRef(new Set());edited.current=new Set((j.context.drafts?.[fieldsKey]||(!existing&&j.context.drafts?.[draftKey]?groups:[])).filter(key=>groups.includes(key)));
 const legacyRef=useRef((()=>{if(!existing)return null;const drafts=j.context.drafts||{},raw=drafts[legacyKey]||(!Array.isArray(drafts[fieldsKey])?drafts[draftKey]:null);return raw&&groups.some(key=>!same(groupValue(raw,key),groupValue(asDraft(existing.payload),key)))?raw:null})());
 const[legacy,setLegacy]=useState(legacyRef.current);
 const[local,setLocal]=useState(()=>j.context.drafts?.[draftKey]||fallback);
 // Clean groups follow the current shared snapshot, including while this editor is open.
 const draft=existing?{...asDraft(existing.payload),...Object.fromEntries([...edited.current].flatMap(key=>key==='payment'?[['payment',local.payment],['amount',local.amount]]:[[key,local[key]]]))}:local;
 const latestDraft=useRef(draft);latestDraft.current=draft;
 const latestJourney=useRef(j);latestJourney.current=j;
 const mounted=useRef(true),created=useRef(!!existing),serial=useRef(Promise.resolve()),completingRef=useRef(false);
 const[pendingSaves,setPendingSaves]=useState(0);const[error,setError]=useState(''),[completing,setCompleting]=useState(false);
 useEffect(()=>{mounted.current=true;j.setContext({selection:{type:'expense',id:objectId},...(!existing?{pendingExpenseId:objectId}:{})},scope);if(initialPaymentStatus)setDraft({...latestDraft.current,payment:{...latestDraft.current.payment,status:initialPaymentStatus}});return()=>{mounted.current=false}},[]);
 function retainDraft(next){j.updateDrafts(drafts=>({...drafts,[draftKey]:next,[fieldsKey]:[...edited.current],...(legacyRef.current?{[legacyKey]:legacyRef.current}:{})}),scope)}
 function setDraft(next){setError('');for(const key of groups)if(!same(groupValue(latestDraft.current,key),groupValue(next,key)))edited.current.add(key);latestDraft.current=next;setLocal(next);retainDraft(next)}
 function change(key,value){setDraft({...draft,[key]:value})}
 function resolveLegacy(restore){const previous=legacyRef.current;legacyRef.current=null;setLegacy(null);if(restore)setDraft({...latestDraft.current,...previous});j.updateDrafts(drafts=>({...drafts,[draftKey]:latestDraft.current,[fieldsKey]:[...edited.current],[legacyKey]:null}),scope)}
 function validation(p){const factor=currencyFactor(p.payment.currency),minor=Math.round(Number(p.amount)*factor);if(p.amount!==''&&(!/^\d+(\.\d{0,2})?$/.test(p.amount)||!Number.isSafeInteger(minor)||Math.abs(Number(p.amount)*factor-minor)>0.000001))return '请按所选币种填写有效金额。';if(p.payment.status==='paid'&&p.amount==='')return '请填写已支付金额。';return ''}
 function payload(p){return {title:p.title.trim(),payment:{...p.payment,amountMinor:p.amount===''?null:Math.round(Number(p.amount)*currencyFactor(p.payment.currency))},notes:p.notes,activityId:p.activityId,date:p.date||null}}
 function save(requested,p){setPendingSaves(n=>n+1);const input=structuredClone(p),normalized=payload(input);
  const task=serial.current.then(async()=>{let saved=[];
   if(!created.current&&latestJourney.current.snapshot.objects.some(o=>o.id===objectId))created.current=true;
   if(!created.current){try{await j.mutate({objectId,kind:'create',objectType:'expense',patch:normalized},scope)}catch(e){if(e.code==='LOCAL_STORAGE'){created.current=true;for(const key of groups)edited.current.add(key);if(mounted.current)retainDraft(latestDraft.current)}throw e}created.current=true;saved=groups;
   }else{const changed=requested.filter(key=>edited.current.has(key));if(changed.length){await j.mutate({objectId,kind:'patch',patch:Object.fromEntries(changed.map(key=>[key,normalized[key]]))},scope);saved=changed}}
   if(mounted.current&&latestJourney.current.context.pendingExpenseId===objectId)j.setContext({pendingExpenseId:null},scope);
   // Clear only the groups whose current input is the value this write accepted.
   j.updateDrafts(drafts=>{const current=drafts[draftKey],fields=drafts[fieldsKey];if(!current||!Array.isArray(fields))return drafts;return {...drafts,[fieldsKey]:fields.filter(key=>!(saved.includes(key)&&same(groupValue(current,key),groupValue(input,key))))}},scope);
   for(const key of saved)if(same(groupValue(latestDraft.current,key),groupValue(input,key)))edited.current.delete(key);
  });const tracked=task.finally(()=>{if(mounted.current)setPendingSaves(n=>n-1)});serial.current=tracked.catch(()=>{});return tracked;
 }
 function commit(group,p=latestDraft.current){if(completingRef.current||!edited.current.has(group))return;const issue=!created.current||group==='payment'?validation(p):'';if(issue){setError(issue);return}setError('');void save([group],p).catch(e=>{if(mounted.current)setError(errorMessage(e))})}
 function requestClose(){if(!completingRef.current){const p=latestDraft.current;const valid=[...edited.current].filter(key=>key!=='payment'||!validation(p));if((created.current&&valid.length)||(!created.current&&!validation(p)))void save(valid,p).catch(()=>{});}close()}
 function close(){mounted.current=false;if(latestJourney.current.context.selection?.id===objectId)j.setContext({selection:null},scope);onClose()}
 async function complete(){if(completingRef.current)return;
  const p=latestDraft.current,issue=validation(p);if(issue){setError(issue);return}
  completingRef.current=true;setCompleting(true);setError('');try{await save([...edited.current],p);await j.persistLocal(scope);if(mounted.current){j.updateDrafts(drafts=>({...drafts,[draftKey]:null,[fieldsKey]:null,...(legacyRef.current?{[legacyKey]:legacyRef.current}:{})}),scope);close()}}catch(e){if(mounted.current)setError(errorMessage(e))}finally{completingRef.current=false;if(mounted.current)setCompleting(false)}
 }
 return <Modal className="editor-modal" title={existing?'编辑费用':'记一笔'} onClose={requestClose} initialFocus={existing?'title':'input'} dismissOnBackdrop={false} action={<button className="primary small editor-done" disabled={completing} onPointerDown={e=>{if(e.pointerType==='mouse'&&e.button===0)e.preventDefault()}} onClick={complete}>完成</button>}><div className="editor-save-row"><p className="editor-save-status" role="status">{pendingSaves?'正在保存…':error?'部分输入待完善':edited.current.size?'修改会自动保存':created.current?'已保存到此设备':'填写后自动保存'}</p><button className="text-button editor-later" onPointerDown={e=>{if(e.pointerType==='mouse'&&e.button===0)e.preventDefault()}} onClick={requestClose}>稍后继续</button></div><div inert={completing}>{legacy&&<div><p className="muted">有上次未完成的输入。</p><div className="button-row"><button className="text-button" onClick={()=>resolveLegacy(true)}>恢复上次输入</button><button className="text-button" onClick={()=>resolveLegacy(false)}>保留当前费用</button></div></div>}<Field label="费用名称"><input value={draft.title} onChange={e=>change('title',e.target.value)} onBlur={()=>commit('title')} placeholder="这笔钱花在哪里？"/></Field><fieldset onBlur={e=>{if(!e.currentTarget.contains(e.relatedTarget))commit('payment')}}><legend>金额与支付状态</legend><div className="segmented">{[['paid','已支付'],['estimated','预计']].map(([v,l])=><button key={v} className={draft.payment.status===v?'selected':''} onClick={()=>{const p={...draft,payment:{...draft.payment,status:v}};setDraft(p);commit('payment',p)}}>{l}</button>)}</div><div className="form-grid"><Field label={draft.payment.status==='paid'?'实际金额':'预计金额 · 可暂空'}><input className="amount-with-currency" inputMode="decimal" placeholder={currencyFactor(draft.payment.currency)===1?'0':'0.00'} value={draft.amount} onChange={e=>change('amount',e.target.value)}/><span className="amount-prefix" aria-hidden="true">{draft.payment.currency}</span></Field><Field label="币种"><select value={draft.payment.currency} onChange={e=>change('payment',{...draft.payment,currency:e.target.value})}>{['CNY','USD','EUR','JPY','GBP','HKD','KRW','SGD','THB'].map(x=><option key={x}>{x}</option>)}</select></Field></div></fieldset><Field label="费用日期"><input type="date" value={draft.date||''} onChange={e=>change('date',e.target.value||null)} onBlur={()=>commit('date')}/></Field><Field label="关联活动 · 选填"><select value={draft.activityId||''} onChange={e=>{const p={...draft,activityId:e.target.value||null};setDraft(p);commit('activityId',p)}}><option value="">不关联活动</option>{active(j.snapshot,'activity').filter(a=>j.snapshot.objects.some(d=>d.id===a.payload.dayId&&d.state==='active')).map(o=><option key={o.id} value={o.id}>{o.payload.title}</option>)}</select></Field><Field label="备注"><textarea value={draft.notes} rows={3} onChange={e=>change('notes',e.target.value)} onBlur={()=>commit('notes')}/></Field>{error&&<p className="field-error" role="alert">{error}</p>}</div></Modal>
}
export default function Ledger({journey:j,onEditActivity}){
 const[editing,setEditing]=useState(()=>j.context.selection?.type==='expense'?j.context.selection.id:undefined),[paying,setPaying]=useState(null),[dateFilter,setDateFilter]=useState(''),[error,setError]=useState('');
 const expenses=active(j.snapshot,'expense');
 const paid=expenses.filter(o=>o.payload.payment.status==='paid'),estimated=expenses.filter(o=>o.payload.payment.status==='estimated');
 const totals=paid.filter(o=>!dateFilter||(dateFilter==='undated'?!o.payload.date:o.payload.date===dateFilter)).reduce((a,o)=>{const p=o.payload.payment;if(p.amountMinor!==null)a[p.currency]=(a[p.currency]||0)+p.amountMinor;return a},{});
 const dates=[...new Set([...expenses.map(o=>o.payload.date),dateFilter==='undated'?null:dateFilter].filter(Boolean))].sort().reverse();
 const shown=list=>list.filter(o=>!dateFilter||(dateFilter==='undated'?!o.payload.date:o.payload.date===dateFilter));
 function edit(objectId,status=null){setPaying(status);setEditing(objectId)}
 async function markPaid(o){
  if(o.payload.payment.amountMinor===null){edit(o.id,'paid');return}
  try{setError('');await j.mutate({objectId:o.id,kind:'patch',patch:{payment:{...o.payload.payment,status:'paid'}}});j.notify?.({message:'已登记支付'})}catch(e){setError(errorMessage(e))}
 }
 function rows(list){return list.map(o=><article className="expense-row" key={o.id}>
  <div className="expense-icon"><Receipt size={19}/></div>
  <div className="expense-info">
   <button onClick={()=>edit(o.id)} className="expense-title">{o.payload.title||`${o.payload.payment.status==='paid'?'已支付':'预计'} · ${money(o.payload.payment.amountMinor,o.payload.payment.currency)}`}</button>
   <small className="expense-date">{o.payload.date?<time dateTime={o.payload.date}>{o.payload.date.replaceAll('-','/')}</time>:'日期未记录'}</small>
   {o.payload.notes&&<p>{o.payload.notes}</p>}
   {o.payload.activityId&&j.snapshot.objects.some(a=>a.id===o.payload.activityId&&a.state==='active'&&j.snapshot.objects.some(d=>d.id===a.payload.dayId&&d.state==='active'))&&<button className="text-button small" onClick={()=>{const a=j.snapshot.objects.find(a=>a.id===o.payload.activityId);if(a)onEditActivity(a)}}>查看关联活动<ArrowUpRight size={13}/></button>}
  </div>
  <div className="expense-trailing"><button className="expense-amount" onClick={()=>edit(o.id)}>{money(o.payload.payment.amountMinor,o.payload.payment.currency)}</button>{o.payload.payment.status==='estimated'&&<button className="text-button expense-pay" onClick={()=>markPaid(o)}>已付</button>}</div>
  <details className="expense-more"><summary aria-label={`${o.payload.title||'这笔费用'}的更多操作`}><MoreHorizontal size={19}/></summary><div className="expense-more-panel"><ObjectActions journey={j} object={o}/></div></details>
 </article>)}
 return <div className="page ledger-page"><div className="page-heading"><div><h1 className="sr-only">费用</h1></div><button className="primary" onClick={()=>edit(j.context.pendingExpenseId||id())}><Plus size={18}/>记一笔</button></div>
  <section className="ledger-total"><span>已支付合计</span><div className="ledger-currency-totals">{(Object.entries(totals).length?Object.entries(totals):[[j.snapshot.trip.currency,0]]).map(([c,n])=><div key={c}><span>{c}</span><strong>{money(n,c)}</strong></div>)}</div><small>{shown(paid).length} 笔支出</small></section>
  {expenses.length>0&&<div className="ledger-date-filter"><Field label="按日期查看"><select value={dateFilter} onChange={e=>setDateFilter(e.target.value)}><option value="">全部日期</option>{dates.map(date=><option key={date} value={date}>{date.replaceAll('-','/')}</option>)}{(dateFilter==='undated'||expenses.some(o=>!o.payload.date))&&<option value="undated">未记录日期</option>}</select></Field></div>}
  {error&&<p className="field-error" role="alert">{error}</p>}
  <section className="section"><h2>已支付</h2>{shown(paid).length?rows(shown(paid)):<Empty icon={Receipt} title={dateFilter?'这一天没有已支付费用':'还没有已支付费用'} action={!dateFilter&&<button className="secondary" onClick={()=>edit(j.context.pendingExpenseId||id())}>记下第一笔</button>}>{!dateFilter&&'可直接记账，也可以关联已有活动。'}</Empty>}</section>
  {shown(estimated).length>0&&<section className="section"><h2>预计支出 <small>{shown(estimated).length} 笔</small></h2><div className="estimated-list">{rows(shown(estimated))}</div></section>}
  {editing!==undefined&&<ExpenseEditor key={editing} journey={j} objectId={editing} object={j.snapshot.objects.find(o=>o.id===editing)} initialPaymentStatus={paying} onClose={()=>setEditing(undefined)}/>}</div>
}
