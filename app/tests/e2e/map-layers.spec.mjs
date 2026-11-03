import {test,expect} from '@playwright/test';
import {fileURLToPath} from 'node:url';
import {createApp,shutdownServer} from '../../server/index.mjs';

let app,server,base;
test.beforeEach(async()=>{
 app=createApp({distPath:fileURLToPath(new URL('../../dist/',import.meta.url)),databasePath:':memory:',securityPath:':memory:',config:{amapKey:'map-layer-fixture'}});
 server=await new Promise(resolve=>{const listener=app.listen(0,'127.0.0.1',()=>resolve(listener))});
 base=`http://127.0.0.1:${server.address().port}`;app.locals.config.appOrigin=base;
});
test.afterEach(async()=>{if(server)await shutdownServer(server,app)});

// The SDK fixture records our overlay and camera calls; real SDK motion remains
// covered by map-camera-motion.spec.mjs and map-retention.spec.mjs.
const sdk=`
class Pixel {constructor(x,y){this.x=x;this.y=y}}
class Marker {constructor(options){this.options=options;this.content=options.content;this.content.style.top='280px';this.content.style.left='70%'}on(name,handler){this.content.addEventListener(name,handler)}}
class MapFixture {
 constructor(canvas,options){this.canvas=canvas;this.center=options.center;this.zoom=options.zoom;this.handlers={};window.__layerMap=this;window.__layerFits=[];setTimeout(()=>this.handlers.complete?.(),10)}
 on(name,handler){this.handlers[name]=handler}
 getCenter(){return{lng:this.center[0],lat:this.center[1]}}getZoom(){return this.zoom}
 add(items){for(const item of (Array.isArray(items)?items:[items]))if(item.content)this.canvas.append(item.content)}
 remove(items){for(const item of (Array.isArray(items)?items:[items]))item.content?.remove()}
 lngLatToContainer(p){return {x:(p[0]-118)*10000,y:(p[1]-32)*10000}}
 addControl(){}stopMove(){}destroy(){this.canvas.replaceChildren()}
 setFitView(items,immediate,padding,maxZoom){window.__layerFits.push({positions:items.map(item=>item.options.position),immediate,padding,maxZoom});this.center=items[0].options.position;this.zoom=maxZoom}
}
class Service {search(_a,_b,callback){(callback||_b)('no_data',null)}}
class Geocoder {getLocation(_name,callback){callback('complete',{geocodes:[{location:{lng:118.8,lat:32.07}}]})}}
class LabelMarker {constructor(options){this.options=options}}
class LabelsLayer {constructor(options){this.options=options;this.content=document.createElement('div');this.content.className='map-sdk-labels'}add(items){for(const item of items){const text=document.createElement('span');text.textContent=item.options.text.content;this.content.append(text)}}}
window.AMap={Map:MapFixture,Marker,Pixel,LabelMarker,LabelsLayer,Polyline:class{},Scale:class{},Geocoder,PlaceSearch:Service,AutoComplete:Service,Walking:Service,Driving:Service,Riding:Service,Transfer:Service,plugin(_plugins,done){done()}};
window.___onAPILoaded();`;

async function setup(page,{empty=false}={}){
 await page.route('https://webapi.amap.com/maps?**',route=>route.fulfill({status:200,contentType:'application/javascript',body:sdk}));
 await page.goto(base);
 await page.evaluate(async empty=>{
  const auth=await fetch('/api/auth/register',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({identifier:`map-layer-${crypto.randomUUID()}@example.test`,password:'JourneyMapLayers2026!',displayName:'地图图层验收'})}).then(r=>r.json());
  const headers={'Content-Type':'application/json','X-CSRF-Token':auth.csrfToken};
  const snapshot=await fetch('/api/trips',{method:'POST',headers,body:JSON.stringify({id:crypto.randomUUID(),name:'地图图层验收旅程',teamMode:'admin',timezone:'Asia/Shanghai',currency:'CNY',dayCount:2,startDate:'2026-11-01',destination:'南京'})}).then(r=>r.json());
  const days=snapshot.objects.filter(o=>o.kind==='day').sort((a,b)=>a.payload.ordinal-b.payload.ordinal);
  const place=(name,lng,lat)=>({name,address:'南京',lng,lat,provider:null,providerPlaceId:null,category:'景点',sourceUrl:'',fetchedAt:null,coordSystem:'GCJ-02'});
  const first=place('第一天公园',118.78,32.08),second=place('第一天湖边',118.8,32.09),third=place('第二天博物馆',118.85,32.04),saved=place('想去的咖啡馆',118.82,32.05);
  const fixtures=empty?[]:[['activity',{title:first.name,dayId:days[0].id,place:first}],['activity',{title:second.name,dayId:days[0].id,place:second}],['activity',{title:third.name,dayId:days[1].id,place:third}],['favorite',first],['favorite',saved],['activity',{title:'尚未选地点',dayId:days[0].id,place:null,order:999}]];
  const lease=await fetch('/api/clock',{method:'POST',headers,body:JSON.stringify({deviceId:crypto.randomUUID()})}).then(r=>r.json());
  for(const [objectType,patch] of fixtures){
   const response=await fetch(`/api/trips/${snapshot.trip.id}/operations`,{method:'POST',headers,body:JSON.stringify({id:crypto.randomUUID(),objectId:crypto.randomUUID(),kind:'create',objectType,patch,clock:{leaseId:lease.leaseId,elapsedMs:0,uncertaintyMs:0}})});
   if(!response.ok)throw new Error(`Fixture operation failed: ${response.status}`);
  }
  await fetch('/api/navigation',{method:'PUT',headers,body:JSON.stringify({lastTripId:snapshot.trip.id,tripId:snapshot.trip.id,context:{page:'map',map:{}}})});
 },empty);
 await page.reload();await page.getByRole('button',{name:/继续旅程/}).click();
 await expect(page.locator('.journey-map')).toBeVisible();await expect(page.getByText('正在定位地图…',{exact:true})).toHaveCount(0);
}

for(const width of [390,1440])test(`all locations show activities and favorites, fit once, and filter at ${width}px`,async({page})=>{
 await page.setViewportSize({width,height:900});await setup(page);
 await expect(page.getByRole('button',{name:'地图路线日期',exact:true})).toContainText('全部地点');
 await expect(page.locator('.route-marker')).toHaveCount(3);await expect(page.locator('.favorite-marker')).toHaveCount(1);
 expect(await page.locator('.route-marker .marker-graphic').allTextContents()).toEqual(['1','2','1']);
 const fit=await page.evaluate(()=>window.__layerFits);expect(fit).toHaveLength(1);expect(fit[0].positions).toHaveLength(4);expect(fit[0].maxZoom).toBe(15);
 const geometry=await page.locator('.map-panel').boundingBox();
 expect(fit[0].padding[width<=760?0:3]).toBeGreaterThan(width<=760?geometry.y+geometry.height:geometry.x+geometry.width);
 const filter=page.getByRole('button',{name:'筛选地点',exact:true});await filter.click();
 await page.locator('fieldset').filter({has:page.getByText('显示',{exact:true})}).getByRole('button',{name:'收藏',exact:true}).click();
 await page.locator('.map-panel').getByRole('button',{name:'完成',exact:true}).click();
 await expect(page.locator('.route-marker')).toHaveCount(0);await expect(page.locator('.favorite-marker')).toHaveCount(2);
 expect(await page.evaluate(()=>window.__layerFits.length)).toBe(1);
 await filter.click();await page.locator('fieldset').filter({has:page.getByText('显示',{exact:true})}).getByRole('button',{name:'全部',exact:true}).click();
 await page.locator('.map-panel').getByRole('button',{name:'完成',exact:true}).click();
 const nav=page.getByRole('navigation',{name:width<=760?'手机主导航':'主导航',exact:true});await nav.getByRole('button',{name:'行程',exact:true}).click();
 if(width<=760)await page.getByRole('combobox',{name:'当前计划日'}).selectOption(await page.getByRole('option',{name:/^第2天/}).getAttribute('value'));else await page.getByRole('tab',{name:/第2天/}).click();await nav.getByRole('button',{name:'地图',exact:true}).click();
 await expect(page.getByRole('button',{name:'地图路线日期',exact:true})).toContainText('第2天路线');await expect(page.locator('.route-marker')).toHaveCount(1);
 await expect(page.locator('.route-marker')).toHaveAttribute('aria-label','第二天博物馆');expect(await page.evaluate(()=>window.__layerFits.length)).toBe(1);
});

test('first map hint closes and stays closed after reopening the trip',async({page})=>{
 await page.setViewportSize({width:390,height:844});await setup(page,{empty:true});
 await expect(page.locator('.map-first-guide')).toBeVisible();await page.getByRole('button',{name:'关闭地图提示',exact:true}).click();
 await expect(page.locator('.map-first-guide')).toHaveCount(0);await page.getByRole('button',{name:'返回我的旅程',exact:true}).click();
 await page.getByRole('button',{name:/继续旅程/}).click();await expect(page.locator('.journey-map')).toBeVisible();await expect(page.locator('.map-first-guide')).toHaveCount(0);
});


test('cancelling a favorite offers undo and restores the same place',async({page})=>{
 await page.setViewportSize({width:390,height:844});await setup(page);
 await page.locator('.favorite-marker').click();await page.getByRole('button',{name:'更多操作',exact:true}).click();
 await page.getByRole('button',{name:'取消团队收藏',exact:true}).click();
 await expect(page.getByRole('button',{name:'收藏',exact:true})).toBeEnabled();
 await page.getByRole('button',{name:'撤销',exact:true}).click();
 await expect(page.getByRole('button',{name:'已收藏',exact:true})).toBeDisabled();
 await expect(page.getByRole('heading',{name:'想去的咖啡馆',exact:true})).toBeVisible();
});

test('map panels share palette and reduced-transparency tokens including system dark',async({page})=>{
 await page.setViewportSize({width:1440,height:900});await setup(page);
 for(const palette of ['forest','atlas'])for(const theme of ['light','dark','system'])for(const flat of [false,true]){
  await page.emulateMedia({colorScheme:theme==='light'?'light':'dark',reducedMotion:'reduce'});
  await page.evaluate(p=>Object.assign(document.documentElement.dataset,p),{palette,theme,transparency:String(flat)});
  const actual=await page.locator('.map-panel.glass').evaluate(el=>{
   const s=getComputedStyle(el),sample=document.createElement('span');sample.style.background='var(--glass)';document.body.append(sample);const expected=getComputedStyle(sample).backgroundColor;sample.remove();return{background:s.backgroundColor,filter:s.backdropFilter,expected};
  });
  expect(actual.background).toBe(actual.expected);expect(actual.filter).toBe(flat?'none':'blur(16px)');
  await page.getByRole('button',{name:'地图路线日期',exact:true}).click();
  expect(await page.locator('.map-route-menu').evaluate(el=>getComputedStyle(el).backgroundColor)).not.toMatch(/rgba/);
  await page.getByRole('button',{name:'地图路线日期',exact:true}).click();
 }
});

test('favorite names, palette tokens and shared mark preset edit/delete',async({page})=>{
 await page.setViewportSize({width:1440,height:900});await setup(page);
 await expect(page.locator('.map-sdk-labels')).toContainText('想去的咖啡馆');
 await page.evaluate(()=>document.documentElement.dataset.palette='atlas');
 await expect.poll(()=>page.locator('.route-marker .marker-graphic').first().evaluate(el=>getComputedStyle(el).backgroundColor)).toBe('rgb(27, 52, 66)');
 await page.locator('.favorite-marker').click();
 await page.getByRole('button',{name:'自定义',exact:true}).click();
 const dialog=page.getByRole('dialog');
 await dialog.getByRole('button',{name:'三角',exact:true}).click();
 await dialog.getByRole('button',{name:'珊瑚红',exact:true}).click();
 await dialog.getByLabel('存为预设').check();
 await dialog.getByLabel('它代表什么（选填）').fill('必吃');
 await dialog.getByRole('button',{name:'完成',exact:true}).click();
 await expect(page.locator('.mark-presets')).toContainText('必吃');
 await expect(page.locator('.map-legend')).toContainText('必吃');
 await expect(page.locator('.map-legend button')).toHaveCount(1);
 await expect(page.locator('.map-legend')).not.toContainText('未命名');
 await expect(page.locator('.sync-status.synced')).toBeVisible();
 await page.getByRole('button',{name:'关闭地点',exact:true}).click();
 await page.getByRole('button',{name:'筛选地点',exact:true}).click();
 const markFilters=page.locator('fieldset').filter({has:page.locator('legend').getByText('标记',{exact:true})});
 await expect(markFilters.getByRole('button')).toHaveCount(2);
 await expect(markFilters.getByRole('button',{name:/必吃/})).toBeVisible();
 await page.locator('.map-panel').getByRole('button',{name:'完成',exact:true}).click();
 await page.getByRole('button',{name:'查看收藏列表',exact:true}).click();
 await page.locator('.map-panel').getByRole('button',{name:'管理预设',exact:true}).click();
 await page.getByRole('dialog').getByRole('button',{name:/必吃/}).click();
 await page.getByRole('dialog').getByRole('button',{name:'圆',exact:true}).click();
 page.once('dialog',dialog=>dialog.accept());
 await page.getByRole('dialog').getByRole('button',{name:'完成',exact:true}).click();
 await expect(page.locator('.favorite-marker .marker-graphic')).toContainText('●');
 await page.locator('.map-panel').getByRole('button',{name:'管理预设',exact:true}).click();
 await page.getByRole('dialog').getByRole('button',{name:'删除',exact:true}).click();
 await expect(page.locator('.map-legend')).toHaveCount(0);
 await expect(page.locator('.favorite-marker .marker-graphic')).toContainText('●');
 await page.getByRole('dialog').getByRole('button',{name:'关闭',exact:true}).click();
 await page.screenshot({path:'../.local/evidence/1103-map-marks.png',fullPage:true});
});

for(const failure of ['422','offline'])test(`favorite marks stay visible locally after ${failure} and reload`,async({page})=>{
 await page.setViewportSize({width:1440,height:900});await setup(page);
 await page.route('**/api/trips/*/operations',route=>failure==='422'
  ?route.fulfill({status:422,contentType:'application/json',body:JSON.stringify({error:{code:'VALIDATION',message:'测试服务暂不接受标记'}})})
  :route.abort('failed'));
 await page.locator('.favorite-marker').click();
 await page.getByRole('button',{name:'自定义',exact:true}).click();
 const dialog=page.getByRole('dialog');
 await dialog.getByRole('button',{name:'三角',exact:true}).click();
 await dialog.getByRole('button',{name:'珊瑚红',exact:true}).click();
 await dialog.getByRole('button',{name:'完成',exact:true}).click();
 await expect(dialog).toHaveCount(0);
 await expect(page.locator(failure==='422'?'.sync-status.blocked':'.sync-status.offline')).toBeVisible();
 async function assertMark(){
  await expect(page.locator('.selected-marker .marker-graphic')).toContainText('▲');
  await expect(page.locator('.mark-current')).toContainText('珊瑚红三角');
  await expect(page.locator('.mark-current')).toContainText('▲');
  await expect(page.locator('.map-legend')).toHaveCount(0);
  await expect(page.locator('.place-marker')).toHaveCount(4);
  const offset=await page.locator('.mark-presets').evaluate(row=>{
   const label=row.querySelector('.mark-row-label').getBoundingClientRect();
   return Math.max(...[...row.querySelectorAll('button')].map(button=>{
    const bounds=button.getBoundingClientRect();
    return Math.abs(bounds.y+bounds.height/2-label.y-label.height/2);
   }));
  });
  expect(offset).toBeLessThanOrEqual(2);
 }
 async function queue(){
  return page.evaluate(async()=>{
   const database=await new Promise((resolve,reject)=>{const r=indexedDB.open('journey-v1');r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error)});
   const read=key=>new Promise((resolve,reject)=>{const r=database.transaction('kv').objectStore('kv').get(key);r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error)});
   const user=await read('activeUser'),account=await read(`account:${user}`);database.close();return account.queue;
  });
 }
 await assertMark();
 const original=await queue();expect(original).toHaveLength(1);
 expect(original[0].patch.mark).toEqual({icon:'triangle',color:'coral'});
 await page.reload();
 await page.getByRole('button',{name:/继续旅程/}).click();
 await expect(page.locator('.journey-map')).toBeVisible();
 await assertMark();
 const restored=await queue();expect(restored).toHaveLength(1);
 expect(restored[0].id).toBe(original[0].id);
 expect(restored[0].clock).toEqual(original[0].clock);
 expect(restored[0].patch).toEqual(original[0].patch);
 await page.getByRole('button',{name:'筛选地点',exact:true}).click();
 await expect(page.locator('fieldset').filter({has:page.locator('legend').getByText('标记',{exact:true})})).toHaveCount(0);
 await expect(page.locator('.place-marker')).toHaveCount(4);
});
