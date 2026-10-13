import {test,expect} from '@playwright/test';
import {createServer} from 'vite';
import {fileURLToPath} from 'node:url';
import {createApp,shutdownServer} from '../../server/index.mjs';

let app,server,vite,base;
test.beforeAll(async()=>{
 app=createApp({distPath:fileURLToPath(new URL('../../dist/',import.meta.url)),databasePath:':memory:',securityPath:':memory:'});
 server=await new Promise(resolve=>{const listener=app.listen(0,'127.0.0.1',()=>resolve(listener))});
 const api=`http://127.0.0.1:${server.address().port}`;
 base=api;
 if(process.env.MAP_SELECTION_TEST_DEV==='1'){
  vite=await createServer({server:{host:'127.0.0.1',port:0,proxy:{'/api':api,'/_AMapService':api}}});
  await vite.listen();base=vite.resolvedUrls.local[0].replace(/\/$/,'');
 }
 app.locals.config.appOrigin=base;
});
test.afterAll(async()=>{if(vite)await vite.close();if(server)await shutdownServer(server,app)});

async function setup(page,{favoriteCount=1}={}){
 await page.goto(base);
 await page.evaluate(async favoriteCount=>{
  const auth=await fetch('/api/auth/register',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({identifier:`selection-${crypto.randomUUID()}@example.test`,password:'JourneySelection2026!',displayName:'地图选点验收'})}).then(r=>r.json());
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
 // Capture the real SDK instance so its pixel conversion and pan direction can be checked.
 await page.getByRole('navigation',{name:'手机主导航'}).getByRole('button',{name:'地图',exact:true}).click();
 await expect.poll(()=>page.evaluate(()=>!!window.AMap?.Map),{timeout:30000}).toBe(true);
 await page.getByRole('navigation',{name:'手机主导航'}).getByRole('button',{name:'行程',exact:true}).click();
 await page.evaluate(()=>{
  const AMap=window.AMap;
  AMap.Map=new Proxy(AMap.Map,{construct(Target,args){const instance=Reflect.construct(Target,args);window.__selectionMap=instance;return instance;}});
 });
}

async function visibleMapFooter(page){
 await expect.poll(()=>page.evaluate(()=>{
  const panel=document.querySelector('.map-panel').getBoundingClientRect();
  const nav=document.querySelector('.bottom-nav').getBoundingClientRect();
  const viewport=window.visualViewport,top=viewport?.offsetTop||0;
  const bottom=Math.min(top+(viewport?.height||innerHeight),nav.height?nav.top:Infinity);
  return ['.amap-logo','.amap-copyright','.amap-scalecontrol'].every(selector=>{
   const element=document.querySelector(selector);if(!element)return false;
   // The real SDK omits copyright text at 320px and hides its empty placeholder.
   if(selector==='.amap-copyright'&&element.style.display==='none'&&!element.textContent.trim())return true;
   const bounds=element.getBoundingClientRect();
   return bounds.width>0&&bounds.height>0&&bounds.top>=Math.max(top,panel.bottom)&&bounds.bottom<=bottom&&bounds.left>=0&&bounds.right<=innerWidth;
  });
 })).toBe(true);
}

async function visibleSelectedMarker(page){
 await expect(page.locator('.selected-marker')).toBeVisible({timeout:30000});
 await expect.poll(()=>page.evaluate(()=>{
  const panel=document.querySelector('.map-panel');
  return panel.getAnimations().every(animation=>animation.playState!=='running');
 })).toBe(true);
 await visibleMapFooter(page);
 await expect.poll(()=>page.evaluate(()=>{
  const marker=document.querySelector('.selected-marker').getBoundingClientRect();
  const panel=document.querySelector('.map-panel').getBoundingClientRect();
  const nav=document.querySelector('.bottom-nav').getBoundingClientRect();
  return marker.top>=panel.bottom+12&&marker.bottom<=nav.top-12&&marker.left>=0&&marker.right<=innerWidth;
 })).toBe(true);
}

for(const width of [390,320])test(`real map selection and activity entry leave the marker visible at ${width}px`,async({page})=>{
 test.setTimeout(90000);await page.setViewportSize({width,height:844});await setup(page);
 await page.getByRole('navigation',{name:'手机主导航'}).getByRole('button',{name:'地图',exact:true}).click();
 await expect.poll(()=>page.evaluate(()=>!!window.__selectionMap&&document.querySelectorAll('.place-marker').length>0),{timeout:30000}).toBe(true);
 const before=await page.evaluate(()=>window.__selectionMap.lngLatToContainer([118.7975,32.0739]).y);
 await page.evaluate(()=>window.__selectionMap.panBy(0,80,0));
 await expect.poll(()=>page.evaluate(()=>window.__selectionMap.lngLatToContainer([118.7975,32.0739]).y)).toBeCloseTo(before+80,0);
 await page.getByRole('button',{name:'查看收藏列表',exact:true}).click();
 await page.locator('.map-result').filter({hasText:'玄武湖选点验收'}).click();
 await visibleSelectedMarker(page);
 await page.getByRole('button',{name:'更多操作',exact:false}).click();
 await visibleSelectedMarker(page);
 await page.setViewportSize({width,height:640});
 await visibleSelectedMarker(page);
 await page.getByRole('navigation',{name:'手机主导航'}).getByRole('button',{name:'行程',exact:true}).click();
 await page.locator('.activity-card').getByRole('button',{name:'地图',exact:true}).click();
 await visibleSelectedMarker(page);
});

for(const width of [390,320])test(`real SDK footer stays visible beside long lists and the keyboard at ${width}px`,async({page},testInfo)=>{
 test.setTimeout(90000);await page.setViewportSize({width,height:640});await setup(page,{favoriteCount:16});
 await page.getByRole('navigation',{name:'手机主导航'}).getByRole('button',{name:'地图',exact:true}).click();
 await expect.poll(()=>page.evaluate(()=>!!window.__selectionMap&&document.querySelectorAll('.place-marker').length>0),{timeout:30000}).toBe(true);
 await page.getByRole('button',{name:'查看收藏列表',exact:true}).click();
 await expect(page.locator('.map-result')).toHaveCount(16);await visibleMapFooter(page);
 await page.locator('.map-result').last().scrollIntoViewIfNeeded();await visibleMapFooter(page);
 const results=Array.from({length:20},(_,index)=>({id:`footer-poi-${index}`,name:`长搜索地点${index}`,address:'南京市玄武区',type:'风景名胜',location:'118.7975,32.0739'}));
 for(const [path,data] of [['place/text',{status:'1',info:'OK',infocode:'10000',count:'20',pois:results}],['assistant/inputtips',{status:'1',info:'OK',infocode:'10000',count:'0',tips:[]}]]){
  await page.route(`**/_AMapService/v3/${path}?**`,route=>{
   const callback=new URL(route.request().url()).searchParams.get('callback');
   return route.fulfill({status:200,contentType:callback?'application/javascript':'application/json',body:callback?`${callback}(${JSON.stringify(data)})`:JSON.stringify(data)});
  });
 }
 await page.getByRole('textbox',{name:'搜索地点',exact:true}).fill('长搜索验收');
 await expect(page.locator('.map-result')).toHaveCount(20);await visibleMapFooter(page);
 await expect(page.locator('.bottom-nav')).toBeHidden();
 await page.locator('.map-result').last().scrollIntoViewIfNeeded();await visibleMapFooter(page);
 await page.evaluate(()=>{
  const viewport=window.visualViewport;window.__footerViewportDescriptor=Object.getOwnPropertyDescriptor(viewport,'height');
  Object.defineProperty(viewport,'height',{configurable:true,get:()=>400});viewport.dispatchEvent(new Event('resize'));
 });
 await expect(page.locator('.journey-map')).toHaveClass(/map-keyboard-open/);await visibleMapFooter(page);
 await page.locator('.map-result').last().scrollIntoViewIfNeeded();await visibleMapFooter(page);
 await page.screenshot({path:testInfo.outputPath('map-footer-keyboard.png'),animations:'disabled'});
 await page.evaluate(()=>{
  const viewport=window.visualViewport,descriptor=window.__footerViewportDescriptor;
  if(descriptor)Object.defineProperty(viewport,'height',descriptor);else delete viewport.height;
  viewport.dispatchEvent(new Event('resize'));
 });
});
