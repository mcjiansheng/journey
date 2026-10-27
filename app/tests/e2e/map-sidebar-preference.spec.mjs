import {test,expect} from '@playwright/test';
import {fileURLToPath} from 'node:url';
import {createApp,shutdownServer} from '../../server/index.mjs';
import {launchWebKit} from '../../scripts/browser-runtime.mjs';

let app,server,base;
test.beforeAll(async()=>{
 app=createApp({distPath:fileURLToPath(new URL('../../dist/',import.meta.url)),databasePath:':memory:',securityPath:':memory:',config:{amapKey:''}});
 server=await new Promise(resolve=>{const listener=app.listen(0,'127.0.0.1',()=>resolve(listener))});
 base=`http://127.0.0.1:${server.address().port}`;app.locals.config.appOrigin=base;
});
test.afterAll(async()=>{if(server)await shutdownServer(server,app)});

const nav=(page,label)=>page.getByRole('navigation',{name:'主导航',exact:true}).getByRole('button',{name:label,exact:true});
async function seed(page){
 await page.goto(base);
 await page.evaluate(async()=>{
  const auth=await fetch('/api/auth/register',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({identifier:`map-sidebar-${crypto.randomUUID()}@example.test`,password:'JourneyMapSidebar2026!',displayName:'侧栏验收'})}).then(r=>r.json());
  const headers={'Content-Type':'application/json','X-CSRF-Token':auth.csrfToken};
  const snapshot=await fetch('/api/trips',{method:'POST',headers,body:JSON.stringify({id:crypto.randomUUID(),name:'地图侧栏验收',teamMode:'admin',timezone:'Asia/Shanghai',currency:'CNY',dayCount:1,startDate:'2026-11-01',destination:'南京'})}).then(r=>r.json());
  await fetch('/api/navigation',{method:'PUT',headers,body:JSON.stringify({lastTripId:snapshot.trip.id,tripId:snapshot.trip.id,context:{page:'itinerary'}})});
 });
 await page.reload();await page.getByRole('button',{name:/继续旅程/}).click();
 await expect(page.locator('.itinerary-page')).toBeVisible();
}
async function openPreferences(page){
 await nav(page,'行程').click();await page.locator('.profile-button').click();
 return page.getByRole('dialog',{name:'个人设置'}).getByRole('switch',{name:'地图自动收起侧栏',exact:true});
}
async function expectSidebar(page,{width,height,compact=false}){
 const sidebar=page.locator('.sidebar');
 await expect.poll(()=>sidebar.evaluate(el=>el.getBoundingClientRect().width)).toBe(width);
 await expect.poll(()=>sidebar.evaluate(el=>el.getBoundingClientRect().height)).toBe(height);
 const layout=await sidebar.evaluate(el=>{
  const box=el.getBoundingClientRect();return {center:box.top+box.height/2,viewportHeight:innerHeight,brandVisibility:getComputedStyle(el.querySelector('.brand')).visibility,profileVisibility:getComputedStyle(el.querySelector('.sidebar-foot')).visibility,labelOpacity:getComputedStyle(el.querySelector('nav button>span')).opacity,buttonHeight:el.querySelector('nav button').getBoundingClientRect().height};
 });
 expect(layout.center).toBeCloseTo(layout.viewportHeight/2,0);
 if(compact){
  expect(layout.brandVisibility).toBe('hidden');expect(layout.profileVisibility).toBe('hidden');
  expect(layout.labelOpacity).toBe('0');expect(layout.buttonHeight).toBe(50);
 }else{
  await expect(sidebar.locator('.sidebar-foot')).toBeVisible();
  await expect.poll(()=>sidebar.locator('nav button>span').first().evaluate(el=>getComputedStyle(el).opacity)).toBe('1');
 }
}
async function checkPreference(page,viewport){
 await page.setViewportSize(viewport);await seed(page);
 const full={width:viewport.width<=1100?180:200,height:viewport.height-28};
 await expectSidebar(page,full);
 await nav(page,'地图').click();await expectSidebar(page,{width:72,height:342,compact:true});
 const toggle=await openPreferences(page);await expect(toggle).toBeChecked();await toggle.uncheck();
 await expect(page.locator('html')).toHaveAttribute('data-map-sidebar-collapse','false');
 expect(await page.evaluate(()=>JSON.parse(localStorage.getItem('journey.appearance')).autoCollapseMapSidebar)).toBe(false);
 await page.keyboard.press('Escape');await expectSidebar(page,full);
 await nav(page,'地图').click();await expectSidebar(page,full);
 await nav(page,'费用').click();await expectSidebar(page,full);
 await nav(page,'管理').click();await expectSidebar(page,full);
 await page.reload();await page.getByRole('button',{name:/继续旅程/}).click();
 const savedToggle=await openPreferences(page);await expect(savedToggle).not.toBeChecked();
 await page.keyboard.press('Escape');await nav(page,'地图').click();await expectSidebar(page,full);
 const restoredToggle=await openPreferences(page);await restoredToggle.check();
 await page.keyboard.press('Escape');await expectSidebar(page,full);
 await nav(page,'地图').click();await expectSidebar(page,{width:72,height:342,compact:true});
 await page.setViewportSize({width:390,height:844});
 await expect(page.locator('.sidebar')).toBeHidden();
 const mobileNav=page.getByRole('navigation',{name:'手机主导航',exact:true});await expect(mobileNav).toBeVisible();
 const before=await mobileNav.boundingBox();
 await page.getByRole('button',{name:'个人设置',exact:true}).click();
 await page.getByRole('switch',{name:'地图自动收起侧栏',exact:true}).uncheck();await page.keyboard.press('Escape');
 await expect(page.locator('.sidebar')).toBeHidden();await expect(mobileNav).toBeVisible();
 const after=await mobileNav.boundingBox();
 for(const key of ['x','y','width','height'])expect(after[key]).toBeCloseTo(before[key]);
 await mobileNav.getByRole('button',{name:'行程',exact:true}).click();await expect(page.locator('.itinerary-page')).toBeVisible();
}

for(const viewport of [{width:1440,height:900},{width:800,height:500}]){
 test(`Chrome map sidebar preference persists and preserves navigation at ${viewport.width}×${viewport.height}`,async({page})=>{
  await checkPreference(page,viewport);
 });
 test(`WebKit map sidebar preference persists and preserves navigation at ${viewport.width}×${viewport.height}`,async()=>{
  const browser=await launchWebKit();const context=await browser.newContext({viewport});
  try{await checkPreference(await context.newPage(),viewport)}finally{await context.close();await browser.close()}
 });
}
