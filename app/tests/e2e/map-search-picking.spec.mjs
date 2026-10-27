import {test,expect} from '@playwright/test';
import {fileURLToPath} from 'node:url';
import {createApp,shutdownServer} from '../../server/index.mjs';

let app,server,base;
test.beforeEach(async()=>{
 app=createApp({distPath:fileURLToPath(new URL('../../dist/',import.meta.url)),databasePath:':memory:',securityPath:':memory:'});
 server=await new Promise(resolve=>{const listener=app.listen(0,'127.0.0.1',()=>resolve(listener))});
 const api=`http://127.0.0.1:${server.address().port}`;
 base=api;
 app.locals.config.appOrigin=base;
});
test.afterEach(async()=>{if(server)await shutdownServer(server,app)});

async function setup(page,{favoriteCount=1}={}){
 await page.goto(base);
 await page.evaluate(async favoriteCount=>{
  const auth=await fetch('/api/auth/register',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({identifier:`search-picking-${crypto.randomUUID()}@example.test`,password:'JourneySelection2026!',displayName:'地图选点验收'})}).then(r=>r.json());
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
  AMap.Map=new Proxy(AMap.Map,{construct(Target,args){const instance=Reflect.construct(Target,args);window.__pickingMap=instance;return instance;}});
 });
 await page.getByRole('button',{name:/继续旅程/}).click();
}

async function openMap(page){
 await page.setViewportSize({width:390,height:844});await setup(page);
 await page.getByRole('navigation',{name:'手机主导航'}).getByRole('button',{name:'地图',exact:true}).click();
 await expect.poll(()=>page.evaluate(()=>!!window.__pickingMap&&document.querySelectorAll('.place-marker').length>0),{timeout:30000}).toBe(true);
}

function fulfillAmap(route,data){
 const callback=new URL(route.request().url()).searchParams.get('callback');
 return route.fulfill({status:200,contentType:callback?'application/javascript':'application/json',body:callback?`${callback}(${JSON.stringify(data)})`:JSON.stringify(data)});
}
const ok=extra=>({status:'1',info:'OK',infocode:'10000',...extra});
const regeocode=address=>({formatted_address:address,addressComponent:{country:'中国',province:'江苏省',city:'南京市',citycode:'025',district:'玄武区',adcode:'320102',township:'玄武门街道',towncode:'320102',neighborhood:{name:[],type:[]},building:{name:[],type:[]},streetNumber:{street:'玄武路',number:'1号',location:'118.8111,32.0888',direction:'北',distance:'0'}},roads:[],roadinters:[],pois:[],aois:[]});
const poi=(name,id='BTESTSEARCH')=>({id,name,address:'南京市玄武区',type:'风景名胜',location:'118.7975,32.0739'});
async function emptySuggestions(page){await page.route('**/_AMapService/v3/assistant/inputtips?**',route=>fulfillAmap(route,ok({count:'0',tips:[]})));}

test('IME composition end searches unchanged Chinese input after debounce',async({page})=>{
 test.setTimeout(90000);await openMap(page);await emptySuggestions(page);
 let searches=0;
 await page.route('**/_AMapService/v3/place/text?**',route=>{searches++;return fulfillAmap(route,ok({count:'1',pois:[poi('玄武湖输入法结果')]}));});
 const input=page.getByRole('textbox',{name:'搜索地点',exact:true});await input.focus();
 await input.dispatchEvent('compositionstart');await input.fill('玄武湖');
 await page.waitForTimeout(550);expect(searches).toBe(0);
 await input.dispatchEvent('compositionend',{data:'玄武湖'});
 await expect(page.locator('.map-result').filter({hasText:'玄武湖输入法结果'})).toBeVisible();
 expect(searches).toBe(1);await expect(input).toHaveValue('玄武湖');
});

test('real AMap service searches Chinese place names',async({page})=>{
 test.setTimeout(90000);await openMap(page);
 const response=page.waitForResponse(r=>r.url().includes('/_AMapService/v3/place/text?')&&r.status()===200);
 await page.getByRole('textbox',{name:'搜索地点',exact:true}).fill('玄武湖');
 await response;
 await expect(page.locator('.map-result').filter({hasText:'玄武湖'}).first()).toBeVisible({timeout:25000});
 await page.locator('.map-result').filter({hasText:'玄武湖'}).first().click();
 await expect(page.locator('.mode-detail h2')).toContainText('玄武湖');
 await expect(page.getByRole('button',{name:'加入行程',exact:true})).toBeVisible();
});

async function emitMap(page,type,{id,name,lng=118.79,lat=32.07}={}){
 await page.evaluate(({type,id,name,lng,lat})=>window.__pickingMap.emit(type,{id,name,lnglat:new window.AMap.LngLat(lng,lat),originEvent:{target:document.querySelector('.map-canvas')}}),{type,id,name,lng,lat});
}
async function enterPick(page){
 await page.getByRole('textbox',{name:'搜索地点',exact:true}).focus();
 await page.getByRole('button',{name:'地图选点',exact:true}).click();
 await expect(page.getByRole('heading',{name:'点击地图选择位置',exact:true})).toBeVisible();
 await expect(page.getByRole('button',{name:'选这里',exact:true})).toHaveCount(0);
 await expect(page.locator('.map-crosshair')).toHaveCount(0);
}

test('basemap hotspot opens details and supports favorite and itinerary actions',async({page})=>{
 test.setTimeout(90000);await openMap(page);
 await page.route('**/_AMapService/v3/place/detail?**',route=>fulfillAmap(route,ok({count:'1',pois:[poi('底图玄武湖','BHOTSPOT')]})));
 await emitMap(page,'hotspotclick',{id:'BHOTSPOT',name:'底图玄武湖'});
 await expect(page.getByRole('heading',{name:'底图玄武湖',exact:true})).toBeVisible();
 await page.getByRole('button',{name:'收藏',exact:true}).click();
 await expect(page.getByRole('button',{name:'已收藏',exact:true})).toBeDisabled();
 await page.getByRole('button',{name:'加入行程',exact:true}).click();
 await expect(page.getByRole('dialog')).toBeVisible();
 await expect(page.getByRole('dialog').getByRole('textbox').first()).toHaveValue('底图玄武湖');
});

test('blank map clicks select their coordinates only while picking',async({page})=>{
 test.setTimeout(90000);await openMap(page);const requests=[];
 await page.route('**/_AMapService/v3/geocode/regeo?**',route=>{requests.push(new URL(route.request().url()).searchParams.get('location'));return fulfillAmap(route,ok({regeocode:regeocode('点击坐标的地址')}));});
 await emitMap(page,'click',{lng:118.8111,lat:32.0888});await page.waitForTimeout(150);
 expect(requests).toEqual([]);await expect(page.locator('.mode-detail')).toHaveCount(0);
 await enterPick(page);
 const center=await page.evaluate(()=>{const c=window.__pickingMap.getCenter();return [c.lng,c.lat]});
 expect(Math.abs(center[0]-118.8111)+Math.abs(center[1]-32.0888)).toBeGreaterThan(.001);
 await emitMap(page,'click',{lng:118.8111,lat:32.0888});
 await expect.poll(()=>requests.length).toBe(1);expect(requests[0]).toBe('118.8111,32.0888');
 await expect(page.getByRole('heading',{name:'点击坐标的地址',exact:true})).toBeVisible();
});

test('canceling or choosing a newer place prevents delayed selection responses from replacing it',async({page})=>{
 test.setTimeout(90000);await openMap(page);let release,started;
 const requested=new Promise(resolve=>{started=resolve});const gate=new Promise(resolve=>{release=resolve});
 await page.route('**/_AMapService/v3/geocode/regeo?**',async route=>{started();await gate;await fulfillAmap(route,ok({regeocode:regeocode('过期逆地理地址')}));});
 await page.route('**/_AMapService/v3/place/detail?**',route=>fulfillAmap(route,ok({count:'1',pois:[poi('新的地点','BNEW')]})));
 await enterPick(page);await emitMap(page,'click');await requested;
 await page.getByRole('button',{name:'关闭地点',exact:true}).click();
 await emitMap(page,'hotspotclick',{id:'BNEW',name:'新的地点'});
 await expect(page.getByRole('heading',{name:'新的地点',exact:true})).toBeVisible();
 release();await page.waitForTimeout(600);
 await expect(page.getByRole('heading',{name:'新的地点',exact:true})).toBeVisible();
 await expect(page.getByRole('heading',{name:'过期逆地理地址',exact:true})).toHaveCount(0);
});

test('search failure preserves the query and retries successfully',async({page})=>{
 test.setTimeout(90000);await openMap(page);let fail=true;
 for(const path of ['place/text','assistant/inputtips'])await page.route(`**/_AMapService/v3/${path}?**`,route=>fulfillAmap(route,fail?{status:'0',info:'SERVICE_NOT_AVAILABLE',infocode:'10016'}:ok(path==='place/text'?{count:'1',pois:[poi('重试成功地点')]}:{count:'0',tips:[]})));
 const input=page.getByRole('textbox',{name:'搜索地点',exact:true});await input.fill('重试地点');
 await expect(page.getByRole('alert')).toHaveText('地点搜索暂时不可用，请重试');await expect(input).toHaveValue('重试地点');
 fail=false;await page.getByRole('button',{name:'重试',exact:true}).click();
 await expect(page.locator('.map-result').filter({hasText:'重试成功地点'})).toBeVisible();
 await expect(page.getByRole('alert')).toHaveCount(0);
});

test('older search responses cannot replace newer results or reopen canceled search',async({page})=>{
 test.setTimeout(90000);await openMap(page);await emptySuggestions(page);let release,started;
 const requested=new Promise(resolve=>{started=resolve});const gate=new Promise(resolve=>{release=resolve});
 await page.route('**/_AMapService/v3/place/text?**',async route=>{
  const old=new URL(route.request().url()).searchParams.get('keywords')==='旧查询';
  if(old){started();await gate;}
  await fulfillAmap(route,ok({count:'1',pois:[poi(old?'过期搜索结果':'新搜索结果',old?'BOLD':'BNEW')]}));
 });
 const input=page.getByRole('textbox',{name:'搜索地点',exact:true});await input.fill('旧查询');await requested;
 await input.fill('新查询');await expect(page.locator('.map-result').filter({hasText:'新搜索结果'})).toBeVisible();
 await page.getByRole('button',{name:'取消',exact:true}).click();release();await page.waitForTimeout(600);
 await expect(page.locator('.mode-search')).toHaveCount(0);await expect(page.locator('.map-result').filter({hasText:'过期搜索结果'})).toHaveCount(0);
 await input.focus();await expect(page.locator('.map-result').filter({hasText:'新搜索结果'})).toBeVisible();
});

test('a real mouse click on a basemap label opens that POI',async({page},testInfo)=>{
 test.setTimeout(90000);await openMap(page);
 await page.evaluate(()=>{
  window.__clickedHotspot=null;
  window.__pickingMap.on('hotspotclick',event=>{window.__clickedHotspot={id:event.id,name:event.name};});
  window.__pickingMap.setZoomAndCenter(16,[118.7955,32.071]);
 });
 // The SDK renders labels in canvas. Scan the unobstructed map using actual
 // pointer clicks, stopping at the first label whose SDK hotspot event fires.
 await page.waitForTimeout(1500);
 let clicked=null;
 for(let y=350;y<=700&&!clicked;y+=24)for(let x=35;x<=335&&!clicked;x+=24){
  await page.mouse.click(x,y);await page.waitForTimeout(55);
  clicked=await page.evaluate(()=>window.__clickedHotspot);
 }
 expect(clicked,'a rendered basemap label should respond to a physical mouse click').toBeTruthy();
 await expect(page.locator('.mode-detail h2')).toContainText(clicked.name);
 await expect(page.getByRole('button',{name:'加入行程',exact:true})).toBeVisible();
 await expect(page.getByRole('button',{name:'加入行程',exact:true})).toBeEnabled({timeout:20000});
 await expect(page.locator('.place-address')).not.toBeEmpty();
 await page.screenshot({path:testInfo.outputPath('real-basemap-label-selection.png'),animations:'disabled'});
 await page.screenshot({path:'../.local/evidence/map-native-poi-selection.png',animations:'disabled'});
});

test('hotspot detail failure preserves its name and location',async({page})=>{
 test.setTimeout(90000);await openMap(page);
 await page.route('**/_AMapService/v3/place/detail?**',route=>fulfillAmap(route,{status:'0',info:'SERVICE_NOT_AVAILABLE',infocode:'10016'}));
 await emitMap(page,'hotspotclick',{id:'BDETAILFAIL',name:'保留的底图地点',lng:118.8123,lat:32.0765});
 await expect(page.getByRole('heading',{name:'保留的底图地点',exact:true})).toBeVisible();
 await expect(page.locator('.map-error')).toContainText('地图查询未完成');
 await page.getByRole('button',{name:'更多操作',exact:true}).click();
 await expect(page.getByRole('link',{name:'导航到这里',exact:true})).toHaveAttribute('href',/to=118\.8123,32\.0765,/);
 await expect(page.getByRole('button',{name:'收藏',exact:true})).toBeEnabled();
});

for(const order of [['click','hotspotclick'],['hotspotclick','click']])test(`named hotspot wins simultaneous ${order.join(' then ')} events while picking`,async({page})=>{
 test.setTimeout(90000);await openMap(page);let reverseRequests=0;
 await page.route('**/_AMapService/v3/geocode/regeo?**',route=>{reverseRequests++;return fulfillAmap(route,ok({regeocode:regeocode('不应显示的空白点地址')}));});
 await page.route('**/_AMapService/v3/place/detail?**',route=>fulfillAmap(route,ok({count:'1',pois:[poi('优先显示的底图地点','BNAMED')]})));
 await enterPick(page);
 await page.evaluate(order=>{
  const event={id:'BNAMED',name:'优先显示的底图地点',lnglat:new window.AMap.LngLat(118.79,32.07),originEvent:{target:document.querySelector('.map-canvas')}};
  for(const type of order)window.__pickingMap.emit(type,event);
 },order);
 await expect(page.getByRole('heading',{name:'优先显示的底图地点',exact:true})).toBeVisible();
 await page.waitForTimeout(350);expect(reverseRequests).toBe(0);
});

test('successful place search remains visible when autocomplete fails',async({page})=>{
 test.setTimeout(90000);await openMap(page);
 await page.route('**/_AMapService/v3/place/text?**',route=>fulfillAmap(route,ok({count:'1',pois:[poi('主搜索成功地点')]})));
 await page.route('**/_AMapService/v3/assistant/inputtips?**',route=>fulfillAmap(route,{status:'0',info:'SERVICE_NOT_AVAILABLE',infocode:'10016'}));
 await page.getByRole('textbox',{name:'搜索地点',exact:true}).fill('主搜索');
 await expect(page.locator('.map-result').filter({hasText:'主搜索成功地点'})).toBeVisible();
 await expect(page.getByRole('alert')).toHaveCount(0);
});
