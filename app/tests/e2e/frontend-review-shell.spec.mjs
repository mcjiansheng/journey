import {test,expect} from '@playwright/test';
import {fileURLToPath} from 'node:url';
import {mkdirSync} from 'node:fs';
import {createApp,shutdownServer} from '../../server/index.mjs';

let app,server,base;
test.beforeAll(async()=>{
 app=createApp({distPath:fileURLToPath(new URL('../../dist/',import.meta.url)),databasePath:':memory:',securityPath:':memory:',config:{amapKey:''}});
 server=await new Promise(resolve=>{const listener=app.listen(0,'127.0.0.1',()=>resolve(listener))});
 base=`http://127.0.0.1:${server.address().port}`;app.locals.config.appOrigin=base;
 mkdirSync('../.local/evidence/frontend-review',{recursive:true});
});
test.afterAll(async()=>{if(server)await shutdownServer(server,app)});
async function seed(page,{trip=true,contextPage='settings'}={}){
 await page.goto(base);
 const result=await page.evaluate(async({trip,contextPage})=>{
  const credentials={identifier:`review-shell-${crypto.randomUUID()}@example.test`,password:'JourneyReview2026!',displayName:'审查验收'};
  const auth=await fetch('/api/auth/register',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(credentials)}).then(r=>r.json());
  const headers={'Content-Type':'application/json','X-CSRF-Token':auth.csrfToken};
  if(!trip)return credentials;
  const snapshot=await fetch('/api/trips',{method:'POST',headers,body:JSON.stringify({id:crypto.randomUUID(),name:'南京三日慢游',teamMode:'admin',timezone:'Asia/Shanghai',currency:'CNY',dayCount:3,startDate:'2026-11-01',destination:'南京'})}).then(r=>r.json());
  await fetch('/api/navigation',{method:'PUT',headers,body:JSON.stringify({lastTripId:snapshot.trip.id,tripId:snapshot.trip.id,context:{page:contextPage,dayId:snapshot.objects.filter(o=>o.kind==='day')[1].id,drafts:{review:{title:'待续草稿'}}}})});
  return {...credentials,tripId:snapshot.trip.id};
 },{trip,contextPage});
 await page.reload();return result;
}
const nav=(page,label)=>page.getByRole('navigation',{name:'主导航',exact:true}).getByRole('button',{name:label,exact:true});

test('continuation skips management while retaining day and draft, sync opens directly, dialogs focus titles',async({page,browser})=>{
 const credentials=await seed(page);await page.getByRole('button',{name:/继续旅程/}).click();
 await expect(nav(page,'行程')).toHaveAttribute('aria-current','page');
 await expect(page.getByRole('tab',{name:/第2天/})).toHaveAttribute('aria-selected','true');
 await page.locator('.sync-status').click();
 await expect(page.getByRole('dialog',{name:'保存与同步'})).toBeVisible();
 await expect(page.getByLabel('称呼',{exact:true})).toHaveCount(0);
 await expect(page.getByRole('heading',{name:'保存与同步',exact:true})).toBeFocused();
 await page.keyboard.press('Escape');await page.getByRole('button',{name:/查看.*位同行伙伴/}).click();
 await expect(page.getByRole('heading',{name:'同行的伙伴'})).toBeFocused();await page.keyboard.press('Escape');
 await nav(page,'管理').click();await expect(page.getByLabel('旅程名称')).toBeVisible();
 await expect(page.getByLabel('称呼',{exact:true})).toHaveCount(0);
 await page.locator('.profile-button').click();await expect(page.getByRole('heading',{name:'个人设置'})).toBeFocused();
 await page.mouse.click(3,3);await expect(page.getByRole('dialog')).toBeVisible();await page.keyboard.press('Escape');
 await expect.poll(()=>page.evaluate(async tripId=>(await fetch('/api/trips').then(r=>r.json())).navigation.contexts[tripId]?.page,credentials.tripId)).toBe('settings');
 const second=await browser.newContext({viewport:{width:390,height:844}});const mobile=await second.newPage();
 try{
  await mobile.goto(base);await mobile.getByLabel('手机号或邮箱').fill(credentials.identifier);await mobile.getByLabel('密码',{exact:true}).fill(credentials.password);await mobile.getByRole('button',{name:'登录并继续'}).click();
  await mobile.getByRole('button',{name:/继续旅程/}).click();
  await expect(mobile.getByRole('navigation',{name:'手机主导航'}).getByRole('button',{name:'行程',exact:true})).toHaveAttribute('aria-current','page');
  await expect(mobile.getByLabel('当前计划日').locator('option:checked')).toContainText('第2天');
  const saved=await mobile.evaluate(async tripId=>(await fetch('/api/trips').then(r=>r.json())).navigation.contexts[tripId],credentials.tripId);
  expect(saved.drafts.review.title).toBe('待续草稿');
  await second.setOffline(true);await mobile.reload();await mobile.getByRole('button',{name:/继续旅程/}).click();
  await expect(mobile.locator('.sync-status.offline span')).toBeVisible();
  await mobile.screenshot({path:'../.local/evidence/frontend-review/mobile-offline.png'});
 }finally{await second.close()}
});

test('trip creation proceeds during a pending destination lookup using device timezone',async({page})=>{
 await page.emulateMedia({reducedMotion:'reduce'});await seed(page,{trip:false});
 let requested=false;await page.route('**/api/config',async route=>{requested=true;await new Promise(resolve=>setTimeout(resolve,3500));await route.fulfill({json:{amapKey:''}}).catch(()=>{})});
 await page.getByRole('button',{name:'创建旅程',exact:true}).click();
 await expect(page.getByLabel('旅程名称')).toBeFocused();
 await page.getByLabel('旅程名称').fill('慢网也能开始');await page.getByLabel('目的地',{exact:true}).fill('南京');
 await page.getByLabel('出发日期',{exact:true}).fill('2026-11-01');await page.getByLabel('结束日期',{exact:true}).fill('2026-11-03');
 await expect.poll(()=>requested).toBe(true);
 const zone=await page.evaluate(()=>Intl.DateTimeFormat().resolvedOptions().timeZone);
 const started=Date.now();await page.getByRole('dialog').getByRole('button',{name:'创建旅程',exact:true}).click();
 await expect(page.getByRole('dialog')).toHaveCount(0);expect(Date.now()-started).toBeLessThan(3000);
 const trip=await page.evaluate(async()=>(await fetch('/api/trips').then(r=>r.json())).trips[0]);expect(trip.timezone).toBe(zone);
 await nav(page,'管理').click();await page.getByLabel('旅程时区').selectOption('Asia/Tokyo');await expect(page.locator('.sync-status.synced')).toBeVisible();
 await expect.poll(()=>page.evaluate(async()=>(await fetch('/api/trips').then(r=>r.json())).trips[0].timezone)).toBe('Asia/Tokyo');
});

test('map can retain full desktop navigation and page columns share an edge',async({page})=>{
 await page.setViewportSize({width:1440,height:900});await seed(page);
 await page.evaluate(()=>{localStorage.setItem('journey.appearance',JSON.stringify({autoCollapseMapSidebar:false}));document.documentElement.dataset.mapSidebarCollapse='false'});
 await page.getByRole('button',{name:/继续旅程/}).click();
 const before=await page.locator('.sidebar').boundingBox();const itinerary=await page.locator('.itinerary-page').boundingBox();
 await nav(page,'费用').click();const ledger=await page.locator('.ledger-page').boundingBox();expect(ledger.x).toBeCloseTo(itinerary.x);expect(ledger.width).toBeCloseTo(itinerary.width);
 await nav(page,'地图').click();await expect(page.locator('.map-trip-title')).toContainText('南京三日慢游');
 await expect(page.locator('.sidebar-foot')).toBeVisible();await expect(nav(page,'管理').locator('span')).toBeVisible();
 const map=await page.locator('.sidebar').boundingBox();expect(map.width).toBeCloseTo(before.width);expect(map.height).toBeCloseTo(before.height);
 await page.screenshot({path:'../.local/evidence/frontend-review/desktop-map-shell.png'});
 for(const width of [390,360]){
  await page.setViewportSize({width,height:844});await page.getByRole('navigation',{name:'手机主导航'}).getByRole('button',{name:'管理',exact:true}).click();
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  await page.screenshot({path:`../.local/evidence/frontend-review/mobile-management-${width}.png`});
 }
});
