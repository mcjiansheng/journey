import test from 'node:test';
import assert from 'node:assert/strict';
import {orderedActivities,visibleDays,outsideDays,timeLabel,routeSignature,endpointSignature,previewReschedule,planDayId} from '../src/domain.js';
const activity=(id,order,time)=>({id,kind:'activity',state:'active',payload:{dayId:'day',order,time}});
test('flexible positions survive precise activity sorting without invented times',()=>{
 const a=activity('late',0,{mode:'precise',start:'16:00'}),b=activity('coffee',1,{mode:'flexible',period:'afternoon'}),c=activity('early',2,{mode:'precise',start:'14:00'});
 assert.deepEqual(orderedActivities({objects:[a,b,c]},'day').map(x=>x.id),['early','coffee','late']);
 assert.equal(timeLabel(b.payload),'下午');assert.equal(timeLabel({time:{mode:'precise',start:'23:00',end:'01:00',endDayOffset:1}}),'23:00–次日01:00');
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
