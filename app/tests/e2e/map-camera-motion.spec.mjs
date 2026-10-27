import {test,expect} from '@playwright/test';
import {fileURLToPath} from 'node:url';
import {createApp,shutdownServer} from '../../server/index.mjs';

let app,server,base;
test.beforeAll(async()=>{
 app=createApp({distPath:fileURLToPath(new URL('../../dist/',import.meta.url)),databasePath:':memory:',securityPath:':memory:'});
 server=await new Promise(resolve=>{const listener=app.listen(0,'127.0.0.1',()=>resolve(listener))});
 const api=`http://127.0.0.1:${server.address().port}`;
 base=api;
 app.locals.config.appOrigin=base;
});
test.afterAll(async()=>{if(server)await shutdownServer(server,app)});

async function setup(page,{favoriteCount=1}={}){
 await page.goto(base);
 await page.evaluate(async favoriteCount=>{
  const auth=await fetch('/api/auth/register',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({identifier:`camera-motion-${crypto.randomUUID()}@example.test`,password:'JourneySelection2026!',displayName:'地图选点验收'})}).then(r=>r.json());
  const headers={'Content-Type':'application/json','X-CSRF-Token':auth.csrfToken};
  const snapshot=await fetch('/api/trips',{method:'POST',headers,body:JSON.stringify({id:crypto.randomUUID(),name:'地图选点验收',teamMode:'admin',timezone:'Asia/Shanghai',currency:'CNY',dayCount:1,startDate:'2026-11-01',destination:'南京'})}).then(r=>r.json());
  const place={name:'玄武湖选点验收',address:'南京市玄武区玄武湖',lng:118.7975,lat:32.0739,provider:null,providerPlaceId:null,category:'景点',sourceUrl:'',fetchedAt:null,coordSystem:'GCJ-02'};
  const lease=await fetch('/api/clock',{method:'POST',headers,body:JSON.stringify({deviceId:crypto.randomUUID()})}).then(r=>r.json());
  const fixtures=[...Array.from({length:favoriteCount},(_,index)=>['favorite',{...place,name:index?`长列表收藏${index}`:place.name}]),['activity',{title:'湖边散步验收',dayId:snapshot.objects[0].id,place}]];
  for(const [objectType,patch] of fixtures){
   const response=await fetch(`/api/trips/${snapshot.trip.id}/operations`,{method:'POST',headers,body:JSON.stringify({id:crypto.randomUUID(),objectId:crypto.randomUUID(),kind:'create',objectType,patch,clock:{leaseId:lease.leaseId,elapsedMs:0,uncertaintyMs:0}})});
   if(!response.ok)throw new Error(`Fixture operation failed: ${response.status}`);
  }
  await fetch('/api/navigation',{method:'PUT',headers,body:JSON.stringify({lastTripId:snapshot.trip.id})});
 },favoriteCount);
 await page.reload();await page.getByRole('button',{name:/继续旅程/}).click();
 await expect(page.getByRole('heading',{name:'湖边散步验收',exact:true})).toBeVisible();
 // Capture the actual SDK instance while preserving all native map behavior.
 await page.getByRole('navigation',{name:'手机主导航'}).getByRole('button',{name:'地图',exact:true}).click();
 await expect.poll(()=>page.evaluate(()=>!!window.AMap?.Map),{timeout:30000}).toBe(true);
 await page.getByRole('button',{name:'返回我的旅程',exact:true}).click();
 await expect(page.getByRole('heading',{name:'我的旅程',exact:true})).toBeVisible();
 await page.evaluate(()=>{
  const AMap=window.AMap;
  AMap.Map=new Proxy(AMap.Map,{construct(Target,args){const instance=Reflect.construct(Target,args);window.__cameraMap=instance;window.__cameraCalls=[];
   for(const name of ['setZoomAndCenter','panBy']){const original=instance[name];instance[name]=function(...args){window.__cameraCalls.push({name,args});return original.apply(this,args);};}
   return instance;}});
 });
 await page.getByRole('button',{name:/继续旅程/}).click();
}

async function openMap(page){
 await page.setViewportSize({width:390,height:844});await setup(page);
 await page.getByRole('navigation',{name:'手机主导航'}).getByRole('button',{name:'地图',exact:true}).click();
 await expect.poll(()=>page.evaluate(()=>!!window.__cameraMap&&document.querySelectorAll('.place-marker').length>0),{timeout:30000}).toBe(true);
}

function fulfillAmap(route,data){
 const callback=new URL(route.request().url()).searchParams.get('callback');
 return route.fulfill({status:200,contentType:callback?'application/javascript':'application/json',body:callback?`${callback}(${JSON.stringify(data)})`:JSON.stringify(data)});
}
const ok=extra=>({status:'1',info:'OK',infocode:'10000',...extra});
const regeocode=address=>({formatted_address:address,addressComponent:{country:'中国',province:'江苏省',city:'南京市',citycode:'025',district:'玄武区',adcode:'320102',township:'玄武门街道',towncode:'320102',neighborhood:{name:[],type:[]},building:{name:[],type:[]},streetNumber:{street:'玄武路',number:'1号',location:'118.8111,32.0888',direction:'北',distance:'0'}},roads:[],roadinters:[],pois:[],aois:[]});
const poi=(name,id='BTESTSEARCH')=>({id,name,address:'南京市玄武区',type:'风景名胜',location:'118.7975,32.0739'});

async function settle(page){
 await page.waitForTimeout(750);
 await expect.poll(()=>page.locator('.map-panel').evaluate(el=>el.getAnimations().every(a=>a.playState!=='running'))).toBe(true);
}
async function viewport(page){return page.evaluate(()=>{const map=window.__cameraMap,c=map.getCenter();return {lng:c.lng,lat:c.lat,zoom:map.getZoom()};});}
async function emit(page,type,{id='BCAMERA',name='原地地点',lng=118.79,lat=32.07}={}){
 await page.evaluate(({type,id,name,lng,lat})=>window.__cameraMap.emit(type,{id,name,lnglat:new window.AMap.LngLat(lng,lat),originEvent:{target:document.querySelector('.map-canvas')}}),{type,id,name,lng,lat});
}
async function noMovement(page,before){await settle(page);expect(await viewport(page)).toEqual(before);expect(await page.evaluate(()=>window.__cameraCalls)).toEqual([]);}
async function resetCalls(page){await page.evaluate(()=>{window.__cameraCalls=[];});}
async function favorite(page){await page.getByRole('button',{name:'查看收藏列表',exact:true}).click();await page.locator('.map-result').filter({hasText:'玄武湖选点验收'}).click();}
async function markerClearOfPanel(page){
 await expect.poll(()=>page.evaluate(()=>{
  const marker=document.querySelector('.selected-marker').getBoundingClientRect(),panel=document.querySelector('.map-panel').getBoundingClientRect(),nav=document.querySelector('.bottom-nav').getBoundingClientRect();
  return marker.top>panel.bottom&&marker.bottom<nav.top&&marker.left>=0&&marker.right<=innerWidth;
 })).toBe(true);
}

for(const width of [390,1440])test(`map POI, marker, detail return and point selection preserve the ${width}px viewport`,async({page})=>{
 test.setTimeout(90000);await openMap(page);await page.setViewportSize({width,height:844});
 await page.route('**/_AMapService/v3/place/detail?**',route=>fulfillAmap(route,ok({count:'1',pois:[poi('原地地点','BCAMERA')]})));
 await page.evaluate(()=>window.__cameraMap.setZoomAndCenter(13,[118.7975,32.0739],true));await settle(page);await resetCalls(page);
 const before=await viewport(page);
 await emit(page,'hotspotclick');await expect(page.getByRole('heading',{name:'原地地点',exact:true})).toBeVisible();await expect(page.getByRole('button',{name:'收藏',exact:true})).toBeEnabled();await noMovement(page,before);
 await page.getByRole('button',{name:'更多操作',exact:true}).click();await noMovement(page,before);
 await page.getByRole('button',{name:'编辑地点资料',exact:true}).click();await page.getByRole('button',{name:'取消',exact:true}).click();await noMovement(page,before);
 await page.getByRole('button',{name:'关闭地点',exact:true}).click();await noMovement(page,before);
 await page.locator('.place-marker:not(.selected-marker)').first().click();await expect(page.getByRole('heading',{name:'玄武湖选点验收',exact:true})).toBeVisible();await noMovement(page,before);
 await page.getByRole('textbox',{name:'搜索地点',exact:true}).focus();await page.getByRole('button',{name:'地图选点',exact:true}).click();
 await page.route('**/_AMapService/v3/geocode/regeo?**',route=>fulfillAmap(route,ok({regeocode:regeocode('手动坐标地址')})));
 await emit(page,'click',{lng:118.8,lat:32.08});await expect(page.getByRole('heading',{name:'手动坐标地址',exact:true})).toBeVisible();await noMovement(page,before);
 // A keyboard viewport resize must not promote selection into a navigation request.
 await page.evaluate(()=>{
  const v=window.visualViewport;window.__cameraViewportHeight=Object.getOwnPropertyDescriptor(v,'height');
  Object.defineProperty(v,'height',{configurable:true,get:()=>500});v.dispatchEvent(new Event('resize'));
 });await noMovement(page,before);
 await page.evaluate(()=>{
  const v=window.visualViewport,descriptor=window.__cameraViewportHeight;if(descriptor)Object.defineProperty(v,'height',descriptor);else delete v.height;
  v.dispatchEvent(new Event('resize'));
 });await noMovement(page,before);
});

for(const reduce of [false,true])test(`explicit favorite, search and location navigation uses ${reduce?'reduced':'smooth'} camera motion`,async({page})=>{
 test.setTimeout(90000);await page.emulateMedia({reducedMotion:reduce?'reduce':'no-preference'});await openMap(page);await settle(page);await resetCalls(page);
 await page.evaluate(()=>{
  window.__cameraFrames=[];const start=performance.now();
  function frame(){const map=window.__cameraMap,c=map.getCenter();window.__cameraFrames.push([c.lng,c.lat,map.getZoom()]);if(performance.now()-start<1000)requestAnimationFrame(frame);}
  requestAnimationFrame(frame);
 });
 await favorite(page);await expect.poll(()=>page.evaluate(()=>window.__cameraCalls.length)).toBe(1);await settle(page);await markerClearOfPanel(page);
 let calls=await page.evaluate(()=>window.__cameraCalls);expect(calls).toHaveLength(1);expect(calls[0].name).toBe('setZoomAndCenter');expect(calls[0].args[2]).toBe(reduce);expect(calls[0].args[3]).toBe(360);
 if(!reduce)expect(await page.evaluate(()=>new Set(window.__cameraFrames.map(p=>p.map(n=>n.toFixed(5)).join(','))).size)).toBeGreaterThan(3);
 await page.route('**/_AMapService/v3/place/text?**',route=>fulfillAmap(route,ok({count:'1',pois:[poi('搜索前往地点','BSEARCHCAMERA')]})));
 await page.route('**/_AMapService/v3/assistant/inputtips?**',route=>fulfillAmap(route,ok({count:'0',tips:[]})));
 await page.getByRole('textbox',{name:'搜索地点',exact:true}).fill('搜索前往');await expect(page.locator('.map-result').filter({hasText:'搜索前往地点'})).toBeVisible();await resetCalls(page);
 await page.locator('.map-result').filter({hasText:'搜索前往地点'}).click();await settle(page);await markerClearOfPanel(page);
 calls=await page.evaluate(()=>window.__cameraCalls);expect(calls).toHaveLength(1);expect(calls[0].args[2]).toBe(reduce);
 await resetCalls(page);await page.evaluate(()=>{
  navigator.geolocation.getCurrentPosition=callback=>callback({coords:{longitude:118.81,latitude:32.08}});
  window.AMap.convertFrom=(_point,_system,callback)=>callback('complete',{locations:[new window.AMap.LngLat(118.81,32.08)]});
 });
 await page.getByRole('button',{name:'定位到我',exact:true}).click();await settle(page);
 calls=await page.evaluate(()=>window.__cameraCalls);expect(calls).toHaveLength(1);expect(calls[0].name).toBe('setZoomAndCenter');expect(calls[0].args[2]).toBe(reduce);
});

test('a map gesture cancels pending explicit camera navigation',async({page})=>{
 test.setTimeout(90000);await openMap(page);await settle(page);await resetCalls(page);
 await page.getByRole('button',{name:'查看收藏列表',exact:true}).click();
 await page.locator('.map-result').filter({hasText:'玄武湖选点验收'}).click();
 await emit(page,'dragstart');const before=await viewport(page);await noMovement(page,before);
});

for(const gesture of ['dragstart','zoomstart'])test(`late search detail cannot reclaim the camera after ${gesture}`,async({page})=>{
 test.setTimeout(90000);await openMap(page);await settle(page);
 let release,started;const held=new Promise(resolve=>{release=resolve}),requested=new Promise(resolve=>{started=resolve});
 await page.route('**/_AMapService/v3/place/text?**',route=>fulfillAmap(route,ok({count:'0',pois:[]})));
 await page.route('**/_AMapService/v3/assistant/inputtips?**',route=>fulfillAmap(route,ok({count:'1',tips:[{id:'BLATECAMERA',name:'延迟地点',district:'南京市',location:''}]})));
 await page.route('**/_AMapService/v3/place/detail?**',async route=>{started();await held;await fulfillAmap(route,ok({count:'1',pois:[poi('延迟地点','BLATECAMERA')]}));});
 try{
  await page.getByRole('textbox',{name:'搜索地点',exact:true}).fill('延迟地点');await page.locator('.map-result').filter({hasText:'延迟地点'}).click();await requested;
  if(gesture==='zoomstart'){
   const zoom=(await viewport(page)).zoom+1;
   await page.evaluate(zoom=>window.__cameraMap.setZoom(zoom,true),zoom);
   await expect.poll(async()=>(await viewport(page)).zoom).toBe(zoom);
  }
  await emit(page,gesture);await resetCalls(page);const before=await viewport(page);release();
  await expect(page.getByRole('button',{name:'加入行程',exact:true})).toBeEnabled();await noMovement(page,before);
 }finally{release();}
});
