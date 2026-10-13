import test from 'node:test';
import assert from 'node:assert/strict';
import {destinationKey,validCenter,planMapCamera,resolveMapCamera,cameraContext} from '../src/map-camera.js';
const nanjing={name:'南京',lng:118.7969,lat:32.0603};
const hangzhou={name:'杭州',lng:120.1551,lat:30.2741};
const beijing=[116.4074,39.9042];

test('first entry resolves the destination before a center is available, ahead of unrelated favorites',async()=>{
 const plan=planMapCamera({destination:' 南京 ',favorites:[{payload:hangzhou}]});
 assert.equal(plan.source,'destination');assert.equal(plan.center,undefined);assert.equal(plan.destination,'南京');
 let queried;
 const camera=await resolveMapCamera(plan,async value=>{queried=value;return nanjing});
 assert.equal(queried,'南京');assert.deepEqual(camera.center,[nanjing.lng,nanjing.lat]);
 assert.deepEqual(cameraContext(camera),{center:[nanjing.lng,nanjing.lat],zoom:12,cameraDestination:'南京',cameraSource:'destination'});
});
test('a marked viewport restores its exact position and zoom across leaving and returning',()=>{
 const saved={center:[118.81,32.08],zoom:16,cameraDestination:'南京',selected:hangzhou};
 const plan=planMapCamera({destination:'南京',saved});
 assert.equal(plan.source,'viewport');assert.deepEqual(plan.center,saved.center);assert.equal(plan.zoom,16);
 plan.center[0]=0;assert.equal(saved.center[0],118.81);
});
test('an unmarked legacy default and a changed destination require fresh destination resolution',async()=>{
 for(const saved of [{center:beijing,zoom:12},{center:[nanjing.lng,nanjing.lat],zoom:16,cameraDestination:'南京',selected:nanjing}]){
  const plan=planMapCamera({destination:'杭州',saved,favorites:[nanjing]});
  assert.equal(plan.source,'destination');assert.equal(plan.center,undefined);
  const camera=await resolveMapCamera(plan,async()=>hangzhou);
  assert.deepEqual(camera.center,[hangzhou.lng,hangzhou.lat]);assert.equal(camera.zoom,12);
 }
});
test('an explicit activity and a newer user selection override the saved viewport',()=>{
 const input={destination:'南京',saved:{center:beijing,cameraDestination:'南京'},activityPlace:hangzhou};
 assert.deepEqual(planMapCamera(input).center,[hangzhou.lng,hangzhou.lat]);
 const selected=planMapCamera({...input,userPlace:nanjing});
 assert.equal(selected.source,'place');assert.deepEqual(selected.center,[nanjing.lng,nanjing.lat]);
});
test('empty destinations use only known places and never a fabricated map center',async()=>{
 const empty=planMapCamera({destination:'',saved:{center:beijing}});
 assert.equal(empty.source,'empty');assert.equal(empty.center,undefined);
 await assert.rejects(resolveMapCamera(empty,()=>assert.fail('must not geocode empty destination')),/填写旅程目的地/);
 assert.equal(planMapCamera({destination:'',favorites:[nanjing]}).source,'favorite');
 const saved={center:[118.8,32.1],zoom:14,cameraDestination:''};
 assert.equal(planMapCamera({destination:null,saved}).source,'viewport');
});
test('invalid coordinates cannot become a saved viewport or a geocoded destination',async()=>{
 for(const point of [null,[118],['118',32],[181,32],[118,91],[NaN,32]])assert.equal(validCenter(point),false);
 const plan=planMapCamera({destination:'南京',saved:{center:[999,99],cameraDestination:'南京'}});
 assert.equal(plan.source,'destination');
 await assert.rejects(resolveMapCamera(plan,async()=>({lng:null,lat:null})),/未找到旅程目的地/);
 await assert.rejects(resolveMapCamera(plan,async()=>null),/未找到旅程目的地/);
 assert.throws(()=>cameraContext({center:beijing.slice(0,1)}),/坐标无效/);
 assert.equal(destinationKey(' 南京 '),'南京');
});
test('a cancelled geocode result never supplies a late camera center',async()=>{
 const abort=new AbortController();let finish;
 const pending=resolveMapCamera(planMapCamera({destination:'南京'}),()=>new Promise(resolve=>{finish=resolve}),abort.signal);
 abort.abort();finish(nanjing);
 await assert.rejects(pending,{name:'AbortError'});
 const alreadyCancelled=new AbortController();alreadyCancelled.abort();
 await assert.rejects(resolveMapCamera(planMapCamera({destination:'南京'}),()=>assert.fail('cancelled lookup'),alreadyCancelled.signal),{name:'AbortError'});
});
test('provider failures remain actionable instead of silently falling back to another city',async()=>{
 await assert.rejects(resolveMapCamera(planMapCamera({destination:'南京'}),async()=>{throw new Error('地图查询超时，请重试')}),/南京.*地图查询超时/);
});
