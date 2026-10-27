import test from 'node:test';
import assert from 'node:assert/strict';
import {orderedActivities,activityOrderPlan,visibleDays,outsideDays,timeLabel,routeSignature,endpointSignature,previewReschedule,planDayId,dateRangeDays} from '../src/domain.js';
function defaultActivityOrder(snapshot,payload,id){const plan=activityOrderPlan(snapshot,payload,id);for(const update of plan.updates)snapshot.objects.find(o=>o.id===update.objectId).payload.order=update.order;return plan.order;}
const activity=(id,order,time)=>({id,kind:'activity',state:'active',payload:{dayId:'day',order,time}});
test('flexible positions survive precise activity sorting without invented times',()=>{
 const a=activity('late',0,{mode:'precise',start:'16:00'}),b=activity('coffee',1,{mode:'flexible',period:'afternoon'}),c=activity('early',2,{mode:'precise',start:'14:00'});
 assert.deepEqual(orderedActivities({objects:[a,b,c]},'day').map(x=>x.id),['early','coffee','late']);
 assert.equal(timeLabel(b.payload),'下午');assert.equal(timeLabel({time:{mode:'precise',start:'23:00',end:'01:00',endDayOffset:1}}),'23:00–次日01:00');
});
test('new periods insert around precise times while later edits keep manual ranks',()=>{
 const morning=activity('morning',0,{mode:'precise',start:'09:30'}),evening=activity('evening',1024,{mode:'precise',start:'19:30'});
 const s={objects:[morning,evening]},flexible=activity('flexible',0,{mode:'flexible',period:'晚上'});
 flexible.payload.order=defaultActivityOrder(s,flexible.payload,flexible.id);
 s.objects.push(flexible);
 assert.deepEqual(orderedActivities(s,'day').map(x=>x.id),['morning','flexible','evening']);
 flexible.payload.order=-1024;flexible.payload.title='晚饭换个名字';
 assert.deepEqual(orderedActivities(s,'day').map(x=>x.id),['flexible','morning','evening']);
 flexible.payload.time.period='上午';
 flexible.payload.order=defaultActivityOrder(s,flexible.payload,flexible.id);
 assert.deepEqual(orderedActivities(s,'day').map(x=>x.id),['flexible','morning','evening']);
});
test('default insertion uses displayed slots when precise stored ranks are reversed',()=>{
 const s={objects:[activity('late',0,{mode:'precise',start:'18:00'}),activity('early',1024,{mode:'precise',start:'09:00'})]};
 const noon=activity('noon',0,{mode:'flexible',period:'中午'});
 noon.payload.order=defaultActivityOrder(s,noon.payload,noon.id);s.objects.push(noon);
 assert.deepEqual(orderedActivities(s,'day').map(x=>x.id),['early','noon','late']);
 assert.equal(defaultActivityOrder({objects:[]},{dayId:'day',time:{mode:'flexible'}},'new'),0);
 assert.equal(defaultActivityOrder(s,{dayId:'day',time:{mode:'flexible'}},'new'),2048);
});
test('days beyond a shortened date range retain their dates',()=>{
 const s={trip:{startDate:'2026-11-10',dayCount:2},objects:[0,1,2].map(i=>({id:`day${i}`,kind:'day',state:'active',payload:{ordinal:i+1,date:`2026-11-${10+i}`}}))};
 assert.deepEqual(visibleDays(s).map(x=>x.id),['day0','day1']);assert.equal(outsideDays(s)[0].payload.date,'2026-11-12');
});
test('route input changes when endpoints or mode change',()=>{
 const from={id:'a',payload:{place:{name:'a',address:'',lng:118,lat:32}}},to={id:'b',payload:{place:{name:'b',address:'',lng:118.1,lat:32.1}}};
 assert.notEqual(routeSignature(from,to,'walking'),routeSignature(from,to,'driving'));
 const changed=structuredClone(to);changed.payload.place.lng=118.2;assert.notEqual(endpointSignature(from,to),endpointSignature(from,changed));
});

test('offline date preview establishes stable days while preserving unselected activities and deleted boundaries',()=>{
 const old={id:'historic',kind:'day',state:'active',payload:{date:null,ordinal:1}};
 const s={trip:{id:'trip',startDate:null,dayCount:1},objects:[old,{...activity('keep',0,{}),payload:{dayId:'historic',order:0}},{...activity('move',1,{}),payload:{dayId:'historic',order:1}}]};
 const p=previewReschedule(s,{startDate:'2026-11-10',dayCount:2,moves:[{activityId:'move',ordinal:2}]});
 assert.equal(p.objects.find(o=>o.id==='move').payload.dayId,planDayId('trip',{date:'2026-11-11',ordinal:2}));
 assert.equal(p.objects.find(o=>o.id==='keep').payload.dayId,'historic');assert.equal(s.trip.startDate,null);
 p.objects.find(o=>o.kind==='day'&&o.payload.date==='2026-11-11').state='deleted';
 assert.throws(()=>previewReschedule(p,{startDate:'2026-11-10',dayCount:2,moves:[]}),{code:'DAY_DELETED'});
});

test('creation dates count inclusive calendar days through DST, leap days and year boundaries',()=>{
 assert.equal(dateRangeDays('2026-03-07','2026-03-09'),3);
 assert.equal(dateRangeDays('2026-11-01','2026-11-01'),1);
 assert.equal(dateRangeDays('2028-02-28','2028-03-01'),3);
 assert.equal(dateRangeDays('2026-12-31','2027-01-01'),2);
 assert.throws(()=>dateRangeDays('','2026-11-01'));
 assert.throws(()=>dateRangeDays('2026-02-29','2026-03-01'));
 assert.throws(()=>dateRangeDays('2026-11-02','2026-11-01'));
 assert.throws(()=>dateRangeDays('2026-01-01','2027-01-01'));
});

test('editing a precise time preserves the remaining visible slots and inserts among periods',()=>{
 const late=activity('late',0,{mode:'precise',start:'18:00'}),morning=activity('morning',1024,{mode:'flexible',period:'上午'}),early=activity('early',2048,{mode:'precise',start:'09:00'});
 const snapshot={objects:[late,morning,early]},payload={...early.payload,time:{mode:'precise',start:'16:00'}};
 payload.order=defaultActivityOrder(snapshot,payload,early.id);early.payload=payload;
 assert.deepEqual(orderedActivities(snapshot,'day').map(o=>o.id),['morning','early','late']);
});
test('period insertion creates an actual rank gap for tied or adjacent floating point ranks',()=>{
 for(const ranks of [[0,0],[1,1+Number.EPSILON]]){
  const morning=activity('b-morning',ranks[0],{mode:'precise',start:'09:00'}),evening=activity('c-evening',ranks[1],{mode:'precise',start:'19:00'}),afternoon=activity('a-afternoon',0,{mode:'flexible',period:'下午'});
  const snapshot={objects:[morning,evening]};afternoon.payload.order=defaultActivityOrder(snapshot,afternoon.payload,afternoon.id);snapshot.objects.push(afternoon);
  assert.deepEqual(orderedActivities(snapshot,'day').map(o=>o.id),['b-morning','a-afternoon','c-evening']);
 }
});
