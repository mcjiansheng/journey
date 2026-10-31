import {test,expect} from '@playwright/test';
import {fileURLToPath} from 'node:url';
import {mkdirSync} from 'node:fs';
import {createApp,shutdownServer} from '../../server/index.mjs';
let app,server,base;
test.beforeAll(async()=>{
 app=createApp({distPath:fileURLToPath(new URL('../../dist/',import.meta.url)),databasePath:':memory:',securityPath:':memory:',config:{amapKey:''}});
 server=await new Promise(resolve=>{const listener=app.listen(0,'127.0.0.1',()=>resolve(listener))});
 base=`http://127.0.0.1:${server.address().port}`;app.locals.config.appOrigin=base;
 mkdirSync('../.local/evidence/design-review-1031',{recursive:true});
});
test.afterAll(async()=>{if(server)await shutdownServer(server,app)});
async function seed(page,{outside=false}={}){
 await page.goto(base);
 await page.evaluate(async({outside})=>{
  const auth=await fetch('/api/auth/register',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({identifier:`design-${crypto.randomUUID()}@example.test`,password:'JourneyReview2026!',displayName:'林晓'})}).then(r=>r.json());
  const headers={'Content-Type':'application/json','X-CSRF-Token':auth.csrfToken};
  const snapshot=await fetch('/api/trips',{method:'POST',headers,body:JSON.stringify({id:crypto.randomUUID(),name:'南京三日慢游',teamMode:'equal',timezone:'Asia/Shanghai',currency:'CNY',dayCount:3,startDate:'2026-11-06',destination:'南京'})}).then(r=>r.json());
  const lease=await fetch('/api/clock',{method:'POST',headers,body:JSON.stringify({deviceId:crypto.randomUUID()})}).then(r=>r.json());
  let elapsed=0;
  async function create(objectType,patch){const id=crypto.randomUUID();const r=await fetch(`/api/trips/${snapshot.trip.id}/operations`,{method:'POST',headers,body:JSON.stringify({id:crypto.randomUUID(),objectId:id,kind:'create',objectType,patch,clock:{leaseId:lease.leaseId,elapsedMs:++elapsed,uncertaintyMs:0}})});if(!r.ok)throw new Error(await r.text());return id;}
  const day=snapshot.objects.find(o=>o.kind==='day'&&o.payload.ordinal===1);
  const activityDay=outside?await create('day',{ordinal:5,date:'2026-11-10'}):day.id;
  const activityId=await create('activity',{title:'南京博物院',dayId:activityDay,order:1024,time:{mode:'precise',start:'10:30',end:'12:00',endDayOffset:0},notes:'东门集合，提前预约',place:{name:'南京博物院',lng:118.825,lat:32.039}});
  await create('activity',{title:'秦淮午餐',dayId:activityDay,order:2048,time:{mode:'precise',start:'12:30',end:'14:00',endDayOffset:0},notes:'行李先寄存前台',place:{name:'夫子庙',lng:118.788,lat:32.020}});
  await create('favorite',{name:'玄武湖',address:'南京市玄武区',lng:118.796,lat:32.073});
  for(const [title,date,amount] of [['午餐','2026-11-06',16800],['酒店',null,120000],['出租车',null,5900]])await create('expense',{title,payment:{status:'paid',amountMinor:amount,currency:'CNY'},date,activityId:title==='午餐'?activityId:null});
 },{outside});
 await page.reload();await expect(page.getByRole('heading',{name:'全部旅程'})).toBeVisible();
 await expect(page.locator('.trip-card')).toContainText('11/06–11/08 · 3 天');
 await expect(page.locator('.trip-card')).toContainText('1 人同行');
 await page.locator('.trip-card').first().click();
}
const nav=(page,label)=>page.getByRole('navigation',{name:/^(主导航|手机主导航)$/}).getByRole('button',{name:label,exact:true});
for(const width of [1440,390])for(const theme of ['light','dark'])test(`review layouts ${width} ${theme}`,async({page})=>{
 await page.setViewportSize({width,height:900});await page.emulateMedia({colorScheme:theme,reducedMotion:'reduce'});await seed(page);
 await expect(page.locator('.activity-card')).toHaveCount(2);
 expect(await page.locator('.activity-card').first().evaluate(el=>getComputedStyle(el).backdropFilter)).toBe('none');
 await page.screenshot({path:`../.local/evidence/design-review-1031/itinerary-${width}-${theme}.png`});
 if(width===390){const first=await page.locator('.activity-card').first().boundingBox();expect(first.y).toBeLessThan(240);await expect(page.locator('.members-button .avatar-stack')).toBeVisible();}
 await nav(page,'费用').click();await expect(page.locator('.ledger-currency-totals')).toContainText('1,427.00');await expect(page.locator('.ledger-currency-totals')).not.toContainText('CNY');
 await expect(page.locator('.expense-date-group>h3').filter({hasText:'未记录日期'})).toHaveCount(1);
 await expect(page.locator('.expense-row')).toHaveCount(3);
 await page.getByRole('group',{name:'按日期查看'}).getByRole('button',{name:'第1天',exact:true}).click();await expect(page.locator('.expense-row')).toHaveCount(1);
 await page.getByRole('group',{name:'按日期查看'}).getByRole('button',{name:'全部',exact:true}).click();
 await page.screenshot({path:`../.local/evidence/design-review-1031/ledger-${width}-${theme}.png`});
 await nav(page,'地图').click();await expect(page.locator('.map-offline-places')).toBeVisible();await expect(page.getByRole('button',{name:'定位到我'})).toHaveCount(0);
 await expect(page.locator('.map-offline-places').getByRole('link',{name:'导航到南京博物院',exact:true})).toHaveAttribute('href',/118.825,32.039/);
 await expect(page.locator('.map-offline-places')).toContainText('玄武湖');
 if(width===1440)await expect.poll(()=>page.locator('.sidebar').evaluate(el=>el.getBoundingClientRect().width)).toBe(200);
 await page.screenshot({path:`../.local/evidence/design-review-1031/map-${width}-${theme}.png`});
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
 const box=await page.locator('.map-offline-places').boundingBox();expect(box.x).toBeGreaterThanOrEqual(0);expect(box.x+box.width).toBeLessThanOrEqual(width);
 await page.locator('.sync-status').click();await expect(page.getByRole('dialog').getByRole('button',{name:'立即同步'})).toBeVisible();await expect(page.getByRole('dialog').getByRole('button',{name:'重试连接'})).toHaveCount(0);
});

test('mobile outside activities retain route editing when the current day is empty',async({page})=>{
 await page.setViewportSize({width:390,height:844});await seed(page,{outside:true});
 await expect(page.getByText('这一天还没有安排',{exact:true})).toBeVisible();
 await page.getByText('行程外安排',{exact:true}).click();
 const route=page.locator('.outside .route-add').last();await expect(route).toBeHidden();
 await page.getByRole('button',{name:'排序',exact:true}).click();await expect(route).toBeVisible();await route.click();await expect(page.getByRole('dialog')).toBeVisible();
});
