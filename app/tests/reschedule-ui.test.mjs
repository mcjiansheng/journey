import test from 'node:test';
import assert from 'node:assert/strict';
import {reschedulePlan} from '../src/reschedule.js';
import {previewReschedule} from '../src/domain.js';
const snapshot={trip:{id:'trip',startDate:'2026-11-01',dayCount:3},objects:[1,2,3,5].flatMap(n=>[
 {id:`day${n}`,kind:'day',state:'active',payload:{date:`2026-11-0${n}`,ordinal:n}},
 {id:`activity${n}`,kind:'activity',state:'active',payload:{title:`活动${n}`,dayId:`day${n}`}}
])};
test('moving dates keeps day numbers and leaves existing outside arrangements in place',()=>{
 const plan=reschedulePlan(snapshot,'2026-11-03',3);
 assert.equal(plan.affected,true);
 assert.deepEqual(plan.moves.map(m=>[m.activityId,m.date]),[['activity1','2026-11-03'],['activity2','2026-11-04'],['activity3','2026-11-05']]);
 const next=previewReschedule(snapshot,{startDate:'2026-11-03',dayCount:3,moves:plan.moves});
 assert.equal(next.objects.find(o=>o.id==='activity5').payload.dayId,'day5');
});
test('extending the end needs no second step; keeping dates has no moves',()=>{
 assert.equal(reschedulePlan(snapshot,'2026-11-01',4).affected,false);
 assert.deepEqual(reschedulePlan(snapshot,'2026-11-03',3,'keep').moves,[]);
});
test('shortening moves removed days to the last day; custom moves only selected activities',()=>{
 const plan=reschedulePlan(snapshot,'2026-11-01',2);
 assert.equal(plan.rows.find(r=>r.activity.id==='activity3').date,'2026-11-02');
 assert.deepEqual(reschedulePlan(snapshot,'2026-11-01',2,'custom',{'activity3':1},new Set(['activity3'])).moves,[{activityId:'activity3',ordinal:1,date:'2026-11-01'}]);
});
test('switching away from custom drops its targets, and shrinking clamps custom targets',()=>{
 const targets={activity1:2},selected=new Set(['activity1']);
 const moved=reschedulePlan(snapshot,'2026-11-03',3,'move',targets,selected);
 assert.equal(moved.moves.find(m=>m.activityId==='activity1').ordinal,1);
 const custom=reschedulePlan(snapshot,'2026-11-03',1,'custom',targets,selected);
 assert.deepEqual(custom.moves,[{activityId:'activity1',ordinal:1,date:'2026-11-03'}]);
});
