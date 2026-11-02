import {test,expect,request} from '@playwright/test';
import {fileURLToPath} from 'node:url';
import {mkdirSync,writeFileSync} from 'node:fs';
import {createApp,shutdownServer} from '../../server/index.mjs';
import {sidebarGeometry} from '../helpers/sidebar-geometry.mjs';
let app,server,base,seededState;
const evidence=`../.local/evidence/design-review-1101/${process.env.JOURNEY_REVIEW_PALETTE || 'forest'}-${process.env.JOURNEY_REVIEW_THEME || 'system'}`;
test.beforeEach(async ({page}) => {
 await page.addInitScript(prefs => localStorage.setItem('journey.appearance', JSON.stringify(prefs)), {palette: process.env.JOURNEY_REVIEW_PALETTE || 'forest', theme: process.env.JOURNEY_REVIEW_THEME || 'system'});
});
test.beforeAll(async()=>{
 mkdirSync(evidence,{recursive:true});
 app=createApp({distPath:fileURLToPath(new URL('../../dist/',import.meta.url)),databasePath:':memory:',securityPath:':memory:',config:{amapKey:''}});
 server=await new Promise(resolve=>{const s=app.listen(0,'127.0.0.1',()=>resolve(s))});base=`http://127.0.0.1:${server.address().port}`;app.locals.config.appOrigin=base;
});
test.afterAll(async()=>{if(server)await shutdownServer(server,app)});
const nav=(page,label)=>page.getByRole('navigation',{name:/^(主导航|手机主导航)$/}).getByRole('button',{name:label,exact:true});
async function resetFixtureAppearance(page) {
 const prefs={palette:process.env.JOURNEY_REVIEW_PALETTE||'forest',theme:process.env.JOURNEY_REVIEW_THEME||'system'};
 const session=await (await page.request.get(base+'/api/session')).json();
 const result=await page.request.patch(base+'/api/me',{headers:{Origin:base,'X-CSRF-Token':session.csrfToken},data:{preferences:prefs}});
 expect(result.ok()).toBe(true);
}
async function seed(page){
 if(seededState){await page.context().addCookies(seededState.cookies);await resetFixtureAppearance(page);await page.goto(base);await expect(page.locator('.continue-card')).toBeVisible();return;}
 await page.goto(base);
 const fixture=await page.evaluate(async()=>{
  const auth=await fetch('/api/auth/register',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({identifier:`r3-${crypto.randomUUID()}@example.test`,password:'JourneyReview2026!',displayName:'周晴'})}).then(r=>r.json());
  const headers={'Content-Type':'application/json','X-CSRF-Token':auth.csrfToken};
  await fetch('/api/me',{method:'PATCH',headers,body:JSON.stringify({preferences:JSON.parse(localStorage.getItem('journey.appearance'))})});
  const createTrip=(name,destination)=>fetch('/api/trips',{method:'POST',headers,body:JSON.stringify({id:crypto.randomUUID(),name,teamMode:'admin',timezone:'Asia/Shanghai',currency:'CNY',dayCount:3,startDate:'2026-11-01',destination})}).then(r=>r.json());
  const snapshot=await createTrip('南京周末 · 秋日漫游','南京');await createTrip('成都慢游','成都');
  const lease=await fetch('/api/clock',{method:'POST',headers,body:JSON.stringify({deviceId:crypto.randomUUID()})}).then(r=>r.json());let elapsed=0;
  async function create(objectType,patch){const objectId=crypto.randomUUID();const r=await fetch(`/api/trips/${snapshot.trip.id}/operations`,{method:'POST',headers,body:JSON.stringify({id:crypto.randomUUID(),objectId,kind:'create',objectType,patch,clock:{leaseId:lease.leaseId,elapsedMs:++elapsed,uncertaintyMs:0}})});if(!r.ok)throw new Error(await r.text());return objectId;}
  const activityId=await create('activity',{title:'抵达南京南站，入住酒店',dayId:snapshot.objects[0].id,order:1024,time:{mode:'precise',start:'10:30',end:'12:00',endDayOffset:0},notes:'行李先寄存前台',place:{name:'南京金陵饭店',lng:118.78,lat:32.04}});
  await create('activity',{title:'老门东午饭',dayId:snapshot.objects[0].id,order:2048,time:{mode:'precise',start:'12:30',end:'14:00',endDayOffset:0},notes:'鸭血粉丝汤、烧饼'});
  await create('expense',{title:'酒店',activityId,date:'2026-11-01',payment:{status:'paid',amountMinor:120000,currency:'CNY'}});
  await create('expense',{title:'出租车',activityId,date:'2026-11-01',payment:{status:'paid',amountMinor:5900,currency:'CNY'}});
  const invite=await fetch(`/api/trips/${snapshot.trip.id}/invites`,{method:'POST',headers,body:JSON.stringify({expiresInHours:1})}).then(r=>r.json());
  await fetch('/api/navigation',{method:'PUT',headers,body:JSON.stringify({lastTripId:snapshot.trip.id})});return{invite:invite.code};
 });
 for(const name of ['林晓','王珊']){
  const api=await request.newContext({baseURL:base,extraHTTPHeaders:{Origin:base}});
  try{const auth=await (await api.post('/api/auth/register',{data:{identifier:`member-${crypto.randomUUID()}@example.test`,password:'JourneyReview2026!',displayName:name}})).json();const joined=await api.post('/api/invites/accept',{headers:{'X-CSRF-Token':auth.csrfToken},data:{code:fixture.invite}});expect(joined.ok()).toBe(true)}finally{await api.dispose()}
 }
 await page.reload();await expect(page.locator('.continue-card')).toBeVisible();seededState=await page.context().storageState();
}
async function shot(page,name){await page.screenshot({path:`${evidence}/${name}.png`,scale:'css'})}

test('sidebar morph keeps every icon fixed across five trips, reversal and reduced motion',async({page})=>{
 await page.setViewportSize({width:1440,height:900});await seed(page);await page.locator('.continue-card').click();
 await expect(page.locator('.sidebar nav .selection-indicator')).toBeVisible();
 await page.evaluate(()=>document.fonts.ready);
 await page.evaluate(fn=>{window.sidebarGeometry=eval(`(${fn})`)},sidebarGeometry.toString());
 const samples=await page.evaluate(async()=>{
  const sidebar=document.querySelector('.sidebar');
  const measure=()=>({box:window.sidebarGeometry(sidebar),icons:[...sidebar.querySelectorAll('button>svg')].map(icon=>{const b=icon.getBoundingClientRect();return{x:b.x,y:b.y,width:b.width,height:b.height}}),brand:Number(getComputedStyle(sidebar.querySelector('.brand')).opacity),label:Number(getComputedStyle(sidebar.querySelector('nav button>span')).opacity),navClip:getComputedStyle(sidebar.querySelector('.sidebar-navigation')).clipPath,indicator:{width:sidebar.querySelector('.selection-indicator').getBoundingClientRect().width,background:getComputedStyle(sidebar.querySelector('.selection-indicator')).background},buttonWidth:sidebar.querySelector('nav button').getBoundingClientRect().width});
  const samples=[];
  for(let round=0;round<5;round++)for(const label of ['地图','行程']){
   const before=measure(),frames=[];sidebar.querySelector(`nav button[aria-label="${label}"]`).click();const start=performance.now();
   while(performance.now()-start<330){await new Promise(requestAnimationFrame);frames.push({...measure(),at:performance.now()-start})}
   samples.push({label,before,frames});
  }
  sidebar.querySelector('nav button[aria-label="地图"]').click();await new Promise(r=>setTimeout(r,70));sidebar.querySelector('nav button[aria-label="行程"]').click();await new Promise(r=>setTimeout(r,320));
  return {samples,final:measure()};
 });
 writeFileSync(`${evidence}/sidebar-frames.json`,JSON.stringify(samples,null,2));
 for(const sample of samples.samples){
  for(const frame of sample.frames)for(let i=0;i<frame.icons.length;i++)for(const axis of ['x','y'])expect(Math.abs(frame.icons[i][axis]-sample.before.icons[i][axis])).toBeLessThanOrEqual(1);
  for(const frame of sample.frames)expect(Math.abs(frame.indicator.width-frame.buttonWidth)).toBeLessThanOrEqual(1);
  expect(sample.frames.filter(f=>f.at<=300).length).toBeGreaterThanOrEqual(15);
  const end=sample.frames.at(-1);expect(end.box.width).toBeCloseTo(sample.label==='地图'?72:200,0);
  expect(sample.frames.some(f=>f.brand>0&&f.brand<1)).toBe(true);
 }
 expect(samples.final.box.width).toBe(200);
 writeFileSync(`${evidence}/sidebar-frames.json`,JSON.stringify(samples,null,2));
 await nav(page,'地图').click();await expect(page.locator('.map-offline-places')).toBeVisible();await shot(page,'map-compact');
 await page.emulateMedia({reducedMotion:'reduce'});await nav(page,'行程').click();
 expect(await page.locator('.sidebar').evaluate(el=>el.getAnimations().length)).toBe(0);
 expect((await page.locator('.sidebar').evaluate(sidebarGeometry)).width).toBe(200);
});

for(const width of [1440,390])for(const theme of ['light','dark'])test(`review screenshots and Chinese avatars ${width} ${theme}`,async({page})=>{
 await page.setViewportSize({width,height:900});await page.emulateMedia({colorScheme:theme,reducedMotion:'reduce'});await seed(page);
 await shot(page,`home-${width}-${theme}`);
 expect(await page.locator('.trip-card-icon').evaluate(el=>getComputedStyle(el).placeItems)).toBe('center');
 await page.locator('.continue-card').click();await expect(page.locator('.activity-card')).toHaveCount(2);
 await expect(page.locator('.sync-status.synced>svg')).toBeVisible();
 if(width===390){await expect(page.locator('.members-button .avatar:visible')).toHaveCount(1);await expect(page.locator('.member-overflow')).toHaveText('+1')}
 for(const [label,name] of [['行程','itinerary'],['费用','expenses'],['旅程设置','settings']]){await nav(page,label).click();await shot(page,`${name}-${width}-${theme}`);expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true)}
 const effective=process.env.JOURNEY_REVIEW_THEME==='system'||!process.env.JOURNEY_REVIEW_THEME?theme:process.env.JOURNEY_REVIEW_THEME;
 const auto=await page.locator('.app-shell').evaluate(el=>({page:getComputedStyle(el).backgroundImage,selected:getComputedStyle(el.querySelector('.sidebar nav button.selected')).backgroundColor}));
 await page.evaluate(theme=>document.documentElement.dataset.theme=theme,effective);
 expect(await page.locator('.app-shell').evaluate(el=>({page:getComputedStyle(el).backgroundImage,selected:getComputedStyle(el.querySelector('.sidebar nav button.selected')).backgroundColor}))).toEqual(auto);
 await page.locator('.members-button').click();await expect(page.locator('.member-more')).toHaveCount(2);
 for(const row of await page.locator('.member-row:has(.member-more)').all()){
  const title=await row.locator('.member-info').boundingBox(),more=await row.locator('.member-more').boundingBox();
  expect(Math.abs((title.y+title.height/2)-(more.y+more.height/2))).toBeLessThan(1);
 }
 await shot(page,`team-${width}-${theme}`);
});
