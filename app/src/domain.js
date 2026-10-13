export const active = object => object.state === 'active';
export function orderedActivities(snapshot, dayId) {
  const rows = (snapshot?.objects || []).filter(o => o.kind === 'activity' && active(o) && o.payload.dayId === dayId)
    .sort((a,b) => (a.payload.order ?? 0) - (b.payload.order ?? 0) || a.id.localeCompare(b.id));
  const precise = rows.filter(o => o.payload.time?.mode === 'precise' && o.payload.time.start)
    .sort((a,b) => a.payload.time.start.localeCompare(b.payload.time.start) || a.id.localeCompare(b.id));
  let i=0;
  return rows.map(o => o.payload.time?.mode === 'precise' && o.payload.time.start ? precise[i++] : o);
}
export function dateAdd(value, days) {
  if (!value) return null;
  const d = new Date(`${value}T12:00:00Z`); d.setUTCDate(d.getUTCDate()+days);
  return d.toISOString().slice(0,10);
}
export function previewReschedule(snapshot, patch) {
  const next=structuredClone(snapshot),days=next.objects.filter(o=>o.kind==='day');
  const useDay=day=>{
    if(day?.state==='deleted')throw Object.assign(new Error('此计划日已删除，请先在已删除的内容中恢复'),{code:'DAY_DELETED'});
    return day;
  };
  const getDay=(ordinal,date)=>{
    const found=days.find(d=>date?d.payload.date===date:!d.payload.date&&d.payload.ordinal===ordinal);
    if(found)return useDay(found);
    const day={id:planDayId(next.trip.id,{date,ordinal}),tripId:next.trip.id,kind:'day',payload:{date,ordinal},state:'active',generation:0,expressions:[]};
    days.push(day);next.objects.push(day);return day;
  };
  for(let i=1;i<=patch.dayCount;i++)getDay(i,dateAdd(patch.startDate,i-1));
  for(const move of patch.moves){
    const activity=next.objects.find(o=>o.id===move.activityId&&o.kind==='activity');
    const day=move.dayId?useDay(days.find(d=>d.id===move.dayId)):getDay(move.ordinal||1,move.date||dateAdd(patch.startDate,(move.ordinal||1)-1));
    if(activity&&day)activity.payload.dayId=day.id;
  }
  next.trip.startDate=patch.startDate;next.trip.dayCount=patch.dayCount;return next;
}
export function visibleDays(snapshot) {
  const trip = snapshot?.trip;
  if (!trip) return [];
  return (snapshot.objects || []).filter(o => o.kind === 'day' && active(o) && (trip.startDate
    ? o.payload.date >= trip.startDate && o.payload.date < dateAdd(trip.startDate,trip.dayCount)
    : !o.payload.date && o.payload.ordinal >= 1 && o.payload.ordinal <= trip.dayCount))
    .sort((a,b) => trip.startDate ? a.payload.date.localeCompare(b.payload.date) : a.payload.ordinal - b.payload.ordinal);
}
export function outsideDays(snapshot) {
  const ids=new Set(visibleDays(snapshot).map(x=>x.id));
  return (snapshot?.objects||[]).filter(o=>o.kind==='day'&&active(o)&&!ids.has(o.id));
}
export function dayLabel(day,trip) {
  const n=trip?.startDate&&day.payload.date ? Math.round((Date.parse(day.payload.date)-Date.parse(trip.startDate))/86400000)+1 : day.payload.ordinal;
  return `第${n}天`;
}
export function timeLabel(p) {
  const t = p.time;
  if (!t || t.mode !== 'precise') return ({morning:'上午',afternoon:'下午',evening:'晚上',anytime:'',unsorted:''})[t?.period] ?? t?.period ?? '';
  if (!t.start) return '';
  return t.start+(t.end ? `–${t.endDayOffset ? t.endDayOffset === 1 ? '次日' : `${t.endDayOffset}天后` : ''}${t.end}` : '');
}
export function endpointSignature(from,to) {
  const p=o=>o?.payload?.place ?? o;
  const s=o=>{const v=p(o); return v ? [v.providerPlaceId || '',v.lng ?? null,v.lat ?? null,v.address||'',v.name||''] : null;};
  return JSON.stringify([from?.id||'',s(from),to?.id||'',s(to)]);
}
export const routeSignature=(from,to,mode)=>JSON.stringify([endpointSignature(from,to),mode]);
export const minutesOf=value=>/^\d{2}:\d{2}$/.test(value||'') ? Number(value.slice(0,2))*60+Number(value.slice(3)) : null;
export function formatMinutes(value) {const n=((value%1440)+1440)%1440;return `${String(Math.floor(n/60)).padStart(2,'0')}:${String(n%60).padStart(2,'0')}`;}
export function money(amount,currency='CNY') {return amount===null||amount===undefined?'':new Intl.NumberFormat('zh-CN',{style:'currency',currency}).format(amount/(currency==='JPY'?1:100));}
export function travelAdvice(previous,target,route) {
 const p=previous?.payload||previous,t=target?.payload||target,r=route?.payload||route;
 const ts=t?.time?.mode==='precise'?minutesOf(t.time.start):null;
 const te=t?.time?.mode==='precise'?minutesOf(t.time.end):null;
 const ps=p?.time?.mode==='precise'?minutesOf(p.time.start):null;
 const pe=p?.time?.mode==='precise'?minutesOf(p.time.end):null;
 const end=pe===null?null:pe+(p.time.endDayOffset||0)*1440;
 const overlapMinutes=ts!==null&&te!==null&&ps!==null&&end!==null ? Math.max(0,Math.min(end,te+(t.time.endDayOffset||0)*1440)-Math.max(ps,ts)):null;
 const arrive=ts===null?null:ts-(t.buffers?.before??0);
 const depart=arrive===null||!Number.isFinite(r?.minutes)?null:arrive-r.minutes;
 const lateMinutes=depart===null||end===null?null:Math.max(0,end+(p.buffers?.after??0)-depart);
 const label=n=>n===null?null:(n<0?'前一天 ':n>=1440?'次日 ':'')+formatMinutes(n);
 return {depart:label(depart),arrive:label(arrive),lateMinutes,overlapMinutes};
}

// Include trip identity so queued references remain distinct across trips. Date
// days keep their identity across range changes; undated days keep their ordinal.
export function planDayId(tripId,{date=null,ordinal}) {
  return date ? `plan-day-${tripId}-date-${date}` : `plan-day-${tripId}-ordinal-${ordinal}`;
}
