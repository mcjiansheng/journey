import {test,expect,devices} from '@playwright/test';
import {fileURLToPath} from 'node:url';
import {createApp,shutdownServer} from '../../server/index.mjs';
import {launchWebKit} from '../../scripts/browser-runtime.mjs';

let app,server,base;
test.beforeAll(async()=>{
 app=createApp({distPath:fileURLToPath(new URL('../../dist/',import.meta.url)),databasePath:':memory:',securityPath:':memory:'});
 server=await new Promise(resolve=>{const listener=app.listen(0,'127.0.0.1',()=>resolve(listener))});
 base=`http://127.0.0.1:${server.address().port}`;app.locals.config.appOrigin=base;
});
test.afterAll(async()=>{if(server)await shutdownServer(server,app)});

function navigation(page,mobile){return page.getByRole('navigation',{name:mobile?'手机主导航':'主导航',exact:true});}
async function navigate(page,label,mobile){await navigation(page,mobile).getByRole('button',{name:label,exact:true}).click();}
async function home(page,mobile){
 await page.getByRole('button',{name:mobile?'返回我的旅程':'我的旅程',exact:true}).click();
 await expect(page.getByRole('heading',{name:'我的旅程',exact:true})).toBeVisible();
}
function fulfillDetail(route){
 const callback=new URL(route.request().url()).searchParams.get('callback');
 const id=new URL(route.request().url()).searchParams.get('id');
 const data={status:'1',info:'OK',infocode:'10000',count:'1',pois:[{id,name:id==='BRETAINACTIVITY'?'高德原始入口':'保留的湖边地点',address:'高德原始地址',type:'风景名胜;公园',location:'118.7975,32.0739',biz_ext:{open_time:'每天 09:00–17:00'}}]};
 return route.fulfill({status:200,contentType:callback?'application/javascript':'application/json',body:callback?`${callback}(${JSON.stringify(data)})`:JSON.stringify(data)});
}
async function setup(page,mobile,{holdComplete=false,coldActivity=false}={}){
 await page.goto(base);
 await page.evaluate(async()=>{
  const auth=await fetch('/api/auth/register',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({identifier:`map-retention-${crypto.randomUUID()}@example.test`,password:'JourneyRetention2026!',displayName:'地图保留验收'})}).then(r=>r.json());
  const headers={'Content-Type':'application/json','X-CSRF-Token':auth.csrfToken};
  const create=async name=>{
   const response=await fetch('/api/trips',{method:'POST',headers,body:JSON.stringify({id:crypto.randomUUID(),name,teamMode:'admin',timezone:'Asia/Shanghai',currency:'CNY',dayCount:2,startDate:'2026-11-01',destination:'南京'})});
   if(!response.ok)throw new Error(`Trip fixture failed: ${response.status}`);
   return response.json();
  };
  const first=await create('地图保留旅程');await create('另一段旅程');
  const days=first.objects.filter(o=>o.kind==='day').sort((a,b)=>a.payload.ordinal-b.payload.ordinal);
  const place={name:'我们约定的东门',address:'东门售票亭旁集合',lng:118.7975,lat:32.0739,provider:'amap',providerPlaceId:'BRETAINACTIVITY',category:'景点',sourceUrl:'',fetchedAt:null,coordSystem:'GCJ-02'};
  const lease=await fetch('/api/clock',{method:'POST',headers,body:JSON.stringify({deviceId:crypto.randomUUID()})}).then(r=>r.json());
  const response=await fetch(`/api/trips/${first.trip.id}/operations`,{method:'POST',headers,body:JSON.stringify({id:crypto.randomUUID(),objectId:crypto.randomUUID(),kind:'create',objectType:'activity',patch:{title:'第二天湖边集合',dayId:days[1].id,place},clock:{leaseId:lease.leaseId,elapsedMs:0,uncertaintyMs:0}})});
  if(!response.ok)throw new Error(`Activity fixture failed: ${response.status}`);
  await fetch('/api/navigation',{method:'PUT',headers,body:JSON.stringify({lastTripId:first.trip.id})});
 });
 await page.reload();await page.getByRole('button',{name:/继续旅程/}).click();
 await expect(page.locator('.journey-map')).toHaveCount(0);
 if(coldActivity)return;
 // Load the real SDK, then release the warmup map before wrapping its constructor.
 await navigate(page,'地图',mobile);
 await expect.poll(()=>page.evaluate(()=>!!window.AMap?.Map),{timeout:30000}).toBe(true);
 await home(page,mobile);
 await page.evaluate(holdComplete=>{
  window.__retentionHoldComplete=holdComplete;window.__retentionCompletions=[];
  window.__retentionInstances=[];window.__retentionDestroyed=[];window.__retentionCameraCalls=[];
  window.AMap.Map=new Proxy(window.AMap.Map,{construct(Target,args){
   const instance=Reflect.construct(Target,args),index=window.__retentionInstances.length;
   window.__retentionInstances.push(instance);
   const destroy=instance.destroy;instance.destroy=function(...args){window.__retentionDestroyed.push(index);return destroy.apply(this,args);};
   const setZoomAndCenter=instance.setZoomAndCenter;instance.setZoomAndCenter=function(...args){window.__retentionCameraCalls.push(index);return setZoomAndCenter.apply(this,args);};
   const on=instance.on;on.call(instance,'complete',()=>{instance.__retentionReady=true;});
   if(holdComplete)instance.on=function(name,handler,...rest){
    return on.call(this,name,name==='complete'?function(...args){
     if(window.__retentionHoldComplete)window.__retentionCompletions.push(()=>handler.apply(this,args));else handler.apply(this,args);
    }:handler,...rest);
   };
   return instance;
  }});
 },holdComplete);
 await page.getByRole('button',{name:/继续旅程/}).click();
 await navigate(page,'地图',mobile);
 await expect.poll(()=>page.evaluate(()=>window.__retentionInstances[0]?.__retentionReady),{timeout:30000}).toBe(true);
 if(!holdComplete)await expect(page.getByText('正在定位地图…',{exact:true})).toHaveCount(0);
 await page.evaluate(()=>{window.__retentionCanvas=document.querySelector('.map-canvas');});
}
async function select(page){
 await page.evaluate(()=>window.__retentionInstances[0].emit('hotspotclick',{id:'BRETAINSELECTED',name:'保留的湖边地点',lnglat:new window.AMap.LngLat(118.7975,32.0739),originEvent:{target:document.querySelector('.map-canvas')}}));
 await expect(page.getByRole('heading',{name:'保留的湖边地点',exact:true})).toBeVisible();
 await expect(page.locator('.place-information-hours')).toContainText('09:00');
 await expect(page.getByText('正在载入地点…',{exact:true})).toHaveCount(0);
 await page.getByRole('button',{name:'更多操作',exact:true}).click();
 await page.getByRole('button',{name:'编辑地点资料',exact:true}).click();
 await page.getByLabel('名称',{exact:true}).fill('保留的自定义地点');
 await page.getByLabel('地址',{exact:true}).fill('北门长椅旁');
 await page.locator('.map-panel').getByRole('button',{name:'完成',exact:true}).click();
 await expect(page.getByRole('heading',{name:'保留的自定义地点',exact:true})).toBeVisible();
 await page.evaluate(()=>window.__retentionInstances[0].setZoomAndCenter(13,[118.82,32.09],true));
 await settle(page);
}
async function settle(page){
 await page.waitForTimeout(500);
 await expect.poll(()=>page.locator('.map-panel').evaluate(el=>el.getAnimations().every(a=>a.playState!=='running'))).toBe(true);
}
async function camera(page){return page.evaluate(()=>{const map=window.__retentionInstances[0],center=map.getCenter();return[center.lng,center.lat,map.getZoom()].map(n=>Number(n.toFixed(6)));});}
async function expectSameMap(page){
 expect(await page.evaluate(()=>({count:window.__retentionInstances.length,destroyed:window.__retentionDestroyed,sameCanvas:document.querySelector('.map-canvas')===window.__retentionCanvas}))).toEqual({count:1,destroyed:[],sameCanvas:true});
}
async function expectInactive(page,mobile){
 await expect(page.locator('.journey-map')).toBeHidden();
 expect(await page.locator('.journey-map').evaluate(root=>{
  const input=root.querySelector('input[aria-label="搜索地点"]');input.focus();
  return{inert:!!root.closest('[inert]'),hidden:!!root.closest('[aria-hidden="true"]'),focusBlocked:document.activeElement!==input};
 })).toEqual({inert:true,hidden:true,focusBlocked:true});
 await expect(page.getByRole('textbox',{name:'搜索地点',exact:true})).toHaveCount(0);
 await expect(navigation(page,mobile)).toBeVisible();
 await expect(page.locator('.map-shell,.map-content')).toHaveCount(0);
}
async function retention(page,mobile){
 let details=0;await page.route('**/_AMapService/v3/place/detail?**',route=>{details++;return fulfillDetail(route);});
 await setup(page,mobile);await select(page);const before=await camera(page);expect(details).toBe(1);
 await page.evaluate(()=>{
  window.__retentionLoading=[];
  const loading=node=>/正在定位地图…|正在载入地点…/.test(node.textContent||'');
  window.__retentionObserver=new MutationObserver(records=>{for(const record of records)for(const node of record.addedNodes)if(loading(node))window.__retentionLoading.push(node.textContent);});
  window.__retentionObserver.observe(document.querySelector('#main'),{childList:true,subtree:true});
 });
 for(const label of ['行程','费用','管理','行程','费用','管理']){
  await navigate(page,label,mobile);await expectInactive(page,mobile);await expectSameMap(page);
  await navigate(page,'地图',mobile);await expect(page.getByRole('heading',{name:'保留的自定义地点',exact:true})).toBeVisible();
  await expect(page.locator('.place-address')).toHaveText('北门长椅旁');
  await expect(page.locator('.place-information-hours')).toContainText('09:00');
  await settle(page);await expectSameMap(page);expect(await camera(page)).toEqual(before);expect(details).toBe(1);
 }
 await page.getByRole('button',{name:'地图路线日期',exact:true}).click();
 await expect(page.locator('.map-route-menu')).toHaveClass(/is-open/);
 // Keep focus in the open menu to check descendants that explicitly opt into visibility.
 await navigation(page,mobile).getByRole('button',{name:'行程',exact:true}).evaluate(button=>button.click());
 await expectInactive(page,mobile);await expect(page.locator('.map-route-menu')).toBeHidden();
 await navigate(page,'地图',mobile);await expectSameMap(page);
 await page.getByRole('button',{name:'地图路线日期',exact:true}).click();
 expect(await page.evaluate(()=>window.__retentionLoading)).toEqual([]);
 // A retained desktop search must not match mobile navigation CSS while hidden.
 if(!mobile){
  await page.getByRole('textbox',{name:'搜索地点',exact:true}).focus();
  await expect(page.locator('.journey-map')).toHaveClass(/map-searching/);
  await navigate(page,'行程',false);await page.setViewportSize({width:390,height:844});
  await expectInactive(page,true);await expectSameMap(page);
 }
}

for(const width of [1440,390])test(`map instance, viewport and edited details survive repeated tab switching at ${width}px`,async({page})=>{
 test.setTimeout(120000);await page.setViewportSize({width,height:900});await retention(page,width<=760);
});

test('WebKit mobile retains the real map across repeated tab switching',async()=>{
 test.setTimeout(120000);const browser=await launchWebKit();
 const context=await browser.newContext({...devices['iPhone 15'],serviceWorkers:'block'});
 try{await retention(await context.newPage(),true);}finally{await context.close();await browser.close();}
});

test('activity navigation reuses the map and home releases it before another trip opens',async({page})=>{
 test.setTimeout(120000);await page.setViewportSize({width:390,height:844});
 let details=0;await page.route('**/_AMapService/v3/place/detail?**',route=>{details++;return fulfillDetail(route);});
 await setup(page,true);await select(page);await navigate(page,'行程',true);
 await page.getByRole('combobox',{name:'当前计划日'}).selectOption({label:'第2天 11/02'});
 await page.locator('.activity-card').filter({hasText:'第二天湖边集合'}).getByRole('button',{name:'地图',exact:true}).click();
 await expect(page.getByRole('heading',{name:'我们约定的东门',exact:true})).toBeVisible();
 await expect(page.locator('.place-address')).toHaveText('东门售票亭旁集合');
 await expect(page.getByRole('button',{name:'地图路线日期',exact:true})).toContainText('第2天路线');
 await expect(page.locator('.place-information-hours')).toContainText('09:00');
 await settle(page);await expectSameMap(page);expect(details).toBe(2);
 expect(await page.evaluate(()=>window.__retentionCameraCalls.length)).toBeGreaterThan(1);
 await home(page,true);await expect(page.locator('.journey-map')).toHaveCount(0);
 expect(await page.evaluate(()=>window.__retentionDestroyed)).toEqual([0]);
 await page.locator('.trip-card').filter({hasText:'另一段旅程'}).click();
 await expect(page.getByRole('combobox',{name:'当前计划日'})).toBeVisible();
 expect(await page.evaluate(()=>window.__retentionInstances.length)).toBe(1);
 await navigate(page,'地图',true);
 await expect.poll(()=>page.evaluate(()=>window.__retentionInstances[1]?.__retentionReady),{timeout:30000}).toBe(true);
 expect(await page.evaluate(()=>({count:window.__retentionInstances.length,destroyed:window.__retentionDestroyed,sameCanvas:document.querySelector('.map-canvas')===window.__retentionCanvas}))).toEqual({count:2,destroyed:[0],sameCanvas:false});
 await expect(page.getByRole('heading',{name:'我们约定的东门',exact:true})).toHaveCount(0);
 await expect(page.getByRole('heading',{name:'保留的自定义地点',exact:true})).toHaveCount(0);
 await expect(page.getByRole('button',{name:'地图路线日期',exact:true})).toContainText('第1天路线');
 await expect(page.getByRole('textbox',{name:'搜索地点',exact:true})).toHaveValue('');expect(details).toBe(2);
});


test('an activity chosen before map initialization completes keeps its selection and route day',async({page})=>{
 test.setTimeout(90000);await page.setViewportSize({width:390,height:844});
 await page.route('**/_AMapService/v3/place/detail?**',fulfillDetail);
 await setup(page,true,{holdComplete:true});
 await expect.poll(()=>page.evaluate(()=>window.__retentionCompletions.length)).toBe(1);
 await navigate(page,'行程',true);await page.getByRole('combobox',{name:'当前计划日'}).selectOption({label:'第2天 11/02'});
 await page.locator('.activity-card').filter({hasText:'第二天湖边集合'}).getByRole('button',{name:'地图',exact:true}).click();
 await expectSameMap(page);
 await page.evaluate(()=>{window.__retentionHoldComplete=false;for(const complete of window.__retentionCompletions.splice(0))complete();});
 await expect(page.getByRole('heading',{name:'我们约定的东门',exact:true})).toBeVisible();
 await expect(page.locator('.place-address')).toHaveText('东门售票亭旁集合');
 await expect(page.getByRole('button',{name:'地图路线日期',exact:true})).toContainText('第2天路线');
 await expect(page.locator('.place-information-hours')).toContainText('09:00');
 await expect(page.getByText('正在定位地图…',{exact:true})).toHaveCount(0);
 await settle(page);await expectSameMap(page);
});


test('a first activity map entry persists its selected place and route day across home',async({page})=>{
 test.setTimeout(90000);await page.setViewportSize({width:390,height:844});
 await page.route('**/_AMapService/v3/place/detail?**',fulfillDetail);
 await setup(page,true,{coldActivity:true});
 await page.getByRole('combobox',{name:'当前计划日'}).selectOption({label:'第2天 11/02'});
 await page.locator('.activity-card').filter({hasText:'第二天湖边集合'}).getByRole('button',{name:'地图',exact:true}).click();
 await expect(page.getByRole('heading',{name:'我们约定的东门',exact:true})).toBeVisible();
 await expect(page.getByRole('button',{name:'地图路线日期',exact:true})).toContainText('第2天路线');
 await expect(page.locator('.place-information-hours')).toContainText('09:00');
 await expect(page.getByText('正在定位地图…',{exact:true})).toHaveCount(0);
 await home(page,true);await page.getByRole('button',{name:/继续旅程/}).click();
 await expect(page.getByRole('heading',{name:'我们约定的东门',exact:true})).toBeVisible();
 await expect(page.locator('.place-address')).toHaveText('东门售票亭旁集合');
 await expect(page.getByRole('button',{name:'地图路线日期',exact:true})).toContainText('第2天路线');
 await expect(page.getByText('正在定位地图…',{exact:true})).toHaveCount(0);
 await expect(page.locator('.place-information-hours')).toContainText('09:00');
});
