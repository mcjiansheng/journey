import {test,expect} from '@playwright/test';
import {fileURLToPath} from 'node:url';
import {createApp,shutdownServer} from '../../server/index.mjs';

let app,server,base;
test.beforeAll(async()=>{
 app=createApp({distPath:fileURLToPath(new URL('../../dist/',import.meta.url)),databasePath:':memory:',securityPath:':memory:'});
 server=await new Promise(resolve=>{const listener=app.listen(0,'127.0.0.1',()=>resolve(listener))});
 base=`http://127.0.0.1:${server.address().port}`;app.locals.config.appOrigin=base;
});
test.afterAll(async()=>{if(server)await shutdownServer(server,app)});

async function openMap(page){
 await page.setViewportSize({width:390,height:844});await page.goto(base);
 await page.evaluate(async()=>{
  const auth=await fetch('/api/auth/register',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({identifier:`place-information-${crypto.randomUUID()}@example.test`,password:'JourneyPoiInfo2026!',displayName:'地点资料验收'})}).then(r=>r.json());
  const headers={'Content-Type':'application/json','X-CSRF-Token':auth.csrfToken};
  const response=await fetch('/api/trips',{method:'POST',headers,body:JSON.stringify({id:crypto.randomUUID(),name:'地点资料验收',teamMode:'admin',timezone:'Asia/Shanghai',currency:'CNY',dayCount:1,startDate:'2026-11-01',destination:'南京'})});
  if(!response.ok)throw new Error(`Trip fixture failed: ${response.status}`);
  const snapshot=await response.json();
  await fetch('/api/navigation',{method:'PUT',headers,body:JSON.stringify({lastTripId:snapshot.trip.id})});
 });
 await page.reload();await page.getByRole('button',{name:/继续旅程/}).click();
 const navigation=page.getByRole('navigation',{name:'手机主导航'});
 await navigation.getByRole('button',{name:'地图',exact:true}).click();
 await expect.poll(()=>page.evaluate(()=>!!window.AMap?.Map),{timeout:30000}).toBe(true);
 await navigation.getByRole('button',{name:'行程',exact:true}).click();
 await page.evaluate(()=>{window.AMap.Map=new Proxy(window.AMap.Map,{construct(Target,args){const instance=Reflect.construct(Target,args);window.__informationMap=instance;window.__informationMapReady=false;instance.on('complete',()=>{window.__informationMapReady=true;});return instance;}})});
 await navigation.getByRole('button',{name:'地图',exact:true}).click();
 await expect.poll(()=>page.evaluate(()=>!!window.__informationMap&&window.__informationMapReady),{timeout:30000}).toBe(true);
}

async function select(page,id,name){
 await page.evaluate(({id,name})=>window.__informationMap.emit('hotspotclick',{id,name,lnglat:new window.AMap.LngLat(118.7975,32.0739),originEvent:{target:document.querySelector('.map-canvas')}}),{id,name});
 await expect(page.getByRole('heading',{name,exact:true})).toBeVisible();
 await expect(page.getByRole('button',{name:'加入行程',exact:true})).toBeEnabled();
}

function fulfill(route,poi){
 const callback=new URL(route.request().url()).searchParams.get('callback');
 const data={status:'1',info:'OK',infocode:'10000',count:'1',pois:[poi]};
 return route.fulfill({status:200,contentType:callback?'application/javascript':'application/json',body:callback?`${callback}(${JSON.stringify(data)})`:JSON.stringify(data)});
}

async function objects(page){
 return page.evaluate(async()=>{const trips=await fetch('/api/trips').then(r=>r.json());return (await fetch(`/api/trips/${trips.trips[0].id}`).then(r=>r.json())).objects;});
}

test('real AMap all-details displays compact photos, category and hours on mobile and desktop',async({page},testInfo)=>{
 test.setTimeout(90000);await openMap(page);
 const response=page.waitForResponse(r=>r.url().includes('/_AMapService/v3/place/detail?')&&r.status()===200);
 await select(page,'B00190BBCZ','玄武湖景区');
 // getDetails uses the SDK's dedicated detail endpoint, whose URL omits the
 // constructor's extensions option. Assert its actual rich response instead.
 const body=await (await response).text();
 const payload=JSON.parse(body.slice(body.indexOf('{'),body.lastIndexOf('}')+1));
 expect(payload.pois[0].photos.length).toBeGreaterThan(0);
 expect(payload.pois[0].biz_ext.opentime2||payload.pois[0].biz_ext.open_time).toBeTruthy();
 await expect(page.locator('.place-information-type')).toHaveText('国家级景点');
 await expect(page.locator('.place-information-hours')).toContainText(/24|00:00/);
 const photo=page.locator('.place-information-photo');
 await expect(photo).toBeVisible();await expect(photo).toHaveAttribute('src',/^https:\/\//);
 await expect.poll(()=>photo.evaluate(img=>img.complete&&img.naturalWidth>0),{timeout:25000}).toBe(true);
 await expect(photo).toHaveCSS('width','88px');await expect(photo).toHaveCSS('height','72px');
 await expect(page.locator('.place-information-contact')).toBeHidden();
 // Keep the selected pin in the exposed map area below the compact panel.
 await page.evaluate(location=>{
  const map=window.__informationMap,zoom=15;
  const point=map.lngLatToPixel(location.split(',').map(Number),zoom);
  const center=map.pixelToLngLat(new window.AMap.Pixel(point.x,point.y-180),zoom);
  map.setZoomAndCenter(zoom,center,true);
 },payload.pois[0].location);
 const marker=page.locator('.selected-marker');
 await expect(marker).toBeVisible();await expect(marker).toBeInViewport();
 await expect.poll(async()=>{
  const pin=await marker.boundingBox(),panel=await page.locator('.map-panel').boundingBox(),navigation=await page.getByRole('navigation',{name:'手机主导航'}).boundingBox();
  return !!pin&&!!panel&&!!navigation&&pin.y>panel.y+panel.height+8&&pin.y+pin.height<navigation.y;
 }).toBe(true);
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
 await page.screenshot({path:testInfo.outputPath('place-information-mobile.png'),scale:'css'});
 await page.setViewportSize({width:1440,height:900});
 await expect(page.getByRole('button',{name:'加入行程',exact:true})).toBeInViewport();
 await page.screenshot({path:testInfo.outputPath('place-information-desktop.png'),scale:'css'});
 await page.getByRole('button',{name:'更多操作',exact:true}).click();
 await expect(page.locator('.place-information-contact')).toContainText('025-83614286');
 await expect(page.getByRole('link',{name:'在高德地图查看'})).toHaveAttribute('href','https://www.amap.com/place/B00190BBCZ');
});

test('rich details recover from a broken photo, persist clean place data and clear missing fields',async({page})=>{
 test.setTimeout(90000);await openMap(page);
 const rich={id:'BINFOFULL',name:'资料完整景区',type:'风景名胜;公园广场;公园',address:'南京市玄武区',location:'118.7975,32.0739',tel:'025-12345678',website:'https://example.com/park',biz_ext:{opentime2:'每天 09:00–17:00'},photos:[{title:'景区照片',url:'http://store.is.autonavi.com/showpic/place-information-broken'}],deep_info:{type:'scenic',intro:'沿湖步道与园林景观。',opentime:'09:00–17:00'}};
 const sparse={id:'BINFOEMPTY',name:'资料精简地点',type:[],address:'南京市',location:'118.8,32.07',tel:[],website:[],photos:[],biz_ext:[]};
 await page.route('https://store.is.autonavi.com/showpic/place-information-broken',route=>route.abort('failed'));
 await page.route('**/_AMapService/v3/place/detail?**',route=>fulfill(route,new URL(route.request().url()).searchParams.get('id')===rich.id?rich:sparse));
 await select(page,rich.id,rich.name);
 await expect(page.locator('.place-information-type')).toHaveText('公园');
 await expect(page.locator('.place-information-hours')).toContainText('每天 09:00–17:00');
 await expect(page.locator('.place-information-photo')).toHaveCount(0);
 await expect(page.locator('.place-information-introduction')).toBeHidden();
 await page.getByRole('button',{name:'更多操作',exact:true}).click();
 await expect(page.locator('.place-information-introduction')).toHaveText('沿湖步道与园林景观。');
 await expect(page.getByRole('link',{name:'地点网站'})).toHaveAttribute('href',rich.website);
 await page.getByRole('button',{name:'收藏',exact:true}).click();
 await expect(page.getByRole('button',{name:'已收藏',exact:true})).toBeDisabled();
 const favorite=(await objects(page)).find(o=>o.kind==='favorite');
 expect(favorite.payload.name).toBe(rich.name);expect(favorite.payload.information).toBeUndefined();
 await page.getByRole('button',{name:'加入行程',exact:true}).click();
 await expect(page.getByRole('dialog')).toBeVisible();
 await page.getByRole('dialog').getByLabel('所在日').selectOption({index:1});
 await page.getByRole('dialog').getByRole('button',{name:'完成',exact:true}).click();
 await expect(page.getByRole('dialog')).toHaveCount(0);
 await expect.poll(async()=>(await objects(page)).filter(o=>o.kind==='activity').length).toBe(1);
 const activity=(await objects(page)).find(o=>o.kind==='activity');
 expect(activity.payload.place.name).toBe(rich.name);expect(activity.payload.place.information).toBeUndefined();
 await select(page,sparse.id,sparse.name);
 await expect(page.locator('.place-information-type,.place-information-hours,.place-information-photo,.place-information-contact,.place-information-introduction')).toHaveCount(0);
 await page.getByRole('button',{name:'更多操作',exact:true}).click();
 await expect(page.getByRole('link',{name:'地点网站'})).toHaveCount(0);
 await expect(page.getByRole('link',{name:'在高德地图查看'})).toHaveAttribute('href','https://www.amap.com/place/BINFOEMPTY');
});

test('a located selection remains actionable while optional details are pending',async({page})=>{
 test.setTimeout(90000);await openMap(page);
 let release,started;
 const pending=new Promise(resolve=>{release=resolve});
 const requested=new Promise(resolve=>{started=resolve});
 await page.route('**/_AMapService/v3/place/detail?**',async route=>{
  started();await pending;
  await fulfill(route,{id:'BINFODELAY',name:'延迟详情地点',type:'风景名胜',address:'南京市',location:'118.7975,32.0739'});
 });
 try{
  await select(page,'BINFODELAY','延迟详情地点');await requested;
  await expect(page.getByText('正在载入地点…',{exact:true})).toBeVisible();
  await expect(page.getByRole('button',{name:'收藏',exact:true})).toBeEnabled();
  await expect(page.getByRole('button',{name:'加入行程',exact:true})).toBeEnabled();
  await page.getByRole('button',{name:'收藏',exact:true}).click();
  await expect(page.getByRole('button',{name:'已收藏',exact:true})).toBeDisabled();
  expect((await objects(page)).find(o=>o.kind==='favorite').payload).toMatchObject({name:'延迟详情地点',lng:118.7975,lat:32.0739,providerPlaceId:'BINFODELAY'});
  await page.getByRole('button',{name:'加入行程',exact:true}).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await expect(page.getByRole('dialog').getByLabel('活动名称')).toHaveValue('延迟详情地点');
 }finally{release();}
});

test('returning from an activity preserves edited provider place facts after detail refresh',async({page})=>{
 test.setTimeout(90000);await openMap(page);
 let requests=0;
 await page.route('**/_AMapService/v3/place/detail?**',route=>{
  requests++;
  return fulfill(route,{id:'BINFOEDIT',name:'高德原始地点',type:requests===1?'风景名胜;公园':'餐饮服务;餐厅',address:requests===1?'高德原始地址':'更新后的高德地址',location:requests===1?'118.7975,32.0739':'121.5,31.2',biz_ext:{open_time:requests===1?'每天开放':'复查完成'}});
 });
 await select(page,'BINFOEDIT','高德原始地点');
 await expect(page.locator('.place-information-hours')).toContainText('每天开放');
 await page.getByRole('button',{name:'更多操作',exact:true}).click();
 await page.getByRole('button',{name:'编辑地点资料',exact:true}).click();
 await page.getByLabel('名称',{exact:true}).fill('我们约定的湖边入口');
 await page.getByLabel('地址',{exact:true}).fill('东门售票亭旁集合');
 await page.locator('.map-panel select').selectOption('景点');
 await page.locator('.map-panel').getByRole('button',{name:'完成',exact:true}).click();
 await page.getByRole('button',{name:'加入行程',exact:true}).click();
 await page.getByRole('dialog').getByLabel('所在日').selectOption({index:1});
 await page.getByRole('dialog').getByRole('button',{name:'完成',exact:true}).click();
 await expect(page.getByRole('dialog')).toHaveCount(0);
 await expect.poll(async()=>(await objects(page)).filter(o=>o.kind==='activity').length).toBe(1);
 const saved=(await objects(page)).find(o=>o.kind==='activity').payload.place;
 expect(saved).toMatchObject({name:'我们约定的湖边入口',address:'东门售票亭旁集合',category:'景点',lng:118.7975,lat:32.0739,providerPlaceId:'BINFOEDIT'});
 expect((await objects(page)).filter(o=>o.kind==='favorite')).toHaveLength(0);
 await page.getByRole('navigation',{name:'手机主导航'}).getByRole('button',{name:'行程',exact:true}).click();
 await page.locator('.activity-card').filter({hasText:'我们约定的湖边入口'}).getByRole('button',{name:'地图',exact:true}).click();
 await expect(page.locator('.place-information-hours')).toContainText('复查完成');
 await expect(page.getByRole('heading',{name:'我们约定的湖边入口',exact:true})).toBeVisible();
 await expect(page.locator('.place-address')).toHaveText('东门售票亭旁集合');
 await page.getByRole('button',{name:'更多操作',exact:true}).click();
 await expect(page.getByRole('link',{name:'导航到这里',exact:true})).toHaveAttribute('href',/to=118\.7975,32\.0739,/);
 await page.getByRole('button',{name:'编辑地点资料',exact:true}).click();
 await expect(page.locator('.map-panel select')).toHaveValue('景点');
 expect((await objects(page)).find(o=>o.kind==='activity').payload.place).toEqual(saved);
});
