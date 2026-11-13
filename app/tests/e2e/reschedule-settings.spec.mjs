import {test,expect} from '@playwright/test';
import {fileURLToPath} from 'node:url';
import {createApp,shutdownServer} from '../../server/index.mjs';
let app,server,base;
test.beforeAll(async()=>{
 app=createApp({distPath:fileURLToPath(new URL('../../dist/',import.meta.url)),databasePath:':memory:',securityPath:':memory:',config:{amapKey:'itinerary-test'}});
 server=await new Promise(resolve=>{const listener=app.listen(0,'127.0.0.1',()=>resolve(listener))});base=`http://127.0.0.1:${server.address().port}`;app.locals.config.appOrigin=base;
});
test.afterAll(async()=>{if(server)await shutdownServer(server,app)});
async function setup(page,{count=3,located=false,precise=false,dayCount=2,startDate='2026-11-01'}={}){
 await page.route('https://webapi.amap.com/maps?**',route=>route.fulfill({contentType:'text/javascript',body:`window.__routeCalls=0;const Service=class{search(from,to,callback){window.__routeCalls++;if(window.__routeFailure){callback('error',{});return}callback('complete',{routes:[{time:1200,distance:1200,path:[[118,32],[118.01,32.01]]}]})}};window.AMap={plugin(plugins,callback){callback()},Walking:Service,Driving:Service,Riding:Service,Transfer:Service,PlaceSearch:Service,AutoComplete:Service,Geocoder:Service,Scale:Service};window.___onAPILoaded();`}));
 await page.goto(base);
 const fixture=await page.evaluate(async({count,located,precise,dayCount,startDate})=>{
  const auth=await fetch('/api/auth/register',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({identifier:`itinerary-${crypto.randomUUID()}@example.test`,password:'JourneyReview2026!',displayName:'行程验收'})}).then(r=>r.json());
  const headers={'Content-Type':'application/json','X-CSRF-Token':auth.csrfToken};
  const snapshot=await fetch('/api/trips',{method:'POST',headers,body:JSON.stringify({id:crypto.randomUUID(),name:'行程审查验收',teamMode:'admin',timezone:'Asia/Shanghai',currency:'CNY',dayCount,startDate,destination:'南京'})}).then(r=>r.json());
  const lease=await fetch('/api/clock',{method:'POST',headers,body:JSON.stringify({deviceId:crypto.randomUUID()})}).then(r=>r.json());
  const ids=[];
  for(let index=0;index<count;index++){
   const objectId=crypto.randomUUID();ids.push(objectId);
   const patch={title:`活动${index+1}`,dayId:snapshot.objects[0].id,order:index*1024,...(precise?{time:{mode:'precise',start:index?'12:30':'10:30',end:index?'14:00':'12:00',endDayOffset:0},notes:index?'东门集合，提前预约':''}:{}),...(located?{place:{name:`地点${index+1}`,lng:118+index*.01,lat:32+index*.01}}:{})};
   const response=await fetch(`/api/trips/${snapshot.trip.id}/operations`,{method:'POST',headers,body:JSON.stringify({id:crypto.randomUUID(),objectId,kind:'create',objectType:'activity',patch,clock:{leaseId:lease.leaseId,elapsedMs:index,uncertaintyMs:0}})});if(!response.ok)throw new Error(await response.text());
  }
  await fetch('/api/navigation',{method:'PUT',headers,body:JSON.stringify({lastTripId:snapshot.trip.id})});return{tripId:snapshot.trip.id,ids,headers,lease};
 },{count,located,precise,dayCount,startDate});
 await page.reload();await page.getByRole('button',{name:/继续旅程/}).click();await expect(page.locator('.activity-card')).toHaveCount(count);return fixture;
}

async function dates(page) {
 await page.getByRole('button',{name:'当天操作',exact:true}).click();
 await page.getByRole('button',{name:'调整日期与天数',exact:true}).click();
}
test('date shift offers a preview and moves arrangements with their day number',async({page})=>{
 await page.setViewportSize({width:1440,height:1000});const f=await setup(page);
 await dates(page);await expect(page.locator('.reschedule-list')).toHaveCount(0);
 await page.getByLabel('开始日期',{exact:true}).fill('2026-11-03');
 await page.getByRole('button',{name:'下一步',exact:true}).click();
 await expect(page.getByText('跟着一起移动',{exact:true})).toBeVisible();
 await expect(page.locator('.reschedule-option').first()).toContainText('2026-11-01 → 2026-11-03');
 await page.getByRole('dialog').getByRole('button',{name:'完成',exact:true}).click();
 await expect(page.getByRole('dialog')).toHaveCount(0);
 await expect(page.locator('.activity-card')).toHaveCount(3);
 await expect(page.locator('.sync-status.synced')).toBeVisible();
 const result=await page.evaluate(async f=>fetch(`/api/trips/${f.tripId}`,{headers:f.headers}).then(r=>r.json()),f);
 const a=result.objects.find(o=>o.id===f.ids[0]);expect(result.objects.find(o=>o.id===a.payload.dayId).payload.date).toBe('2026-11-03');
});
test('extending dates completes directly and whole day swap is in the day menu',async({page})=>{
 await page.setViewportSize({width:1440,height:1000});await setup(page);
 await dates(page);await page.getByLabel('结束日期',{exact:true}).fill('2026-11-04');
 await expect(page.getByRole('button',{name:'下一步',exact:true})).toHaveCount(0);
 await page.getByRole('dialog').getByRole('button',{name:'完成',exact:true}).click();
 await page.getByRole('button',{name:'当天操作',exact:true}).click();await page.getByRole('button',{name:'与另一天交换',exact:true}).click();
 await page.getByRole('dialog').getByRole('button',{name:/第2天/}).click();
 await expect(page.getByRole('dialog')).toHaveCount(0);await expect(page.locator('.activity-card')).toHaveCount(0);
 await page.getByRole('tab',{name:/第2天/}).click();await expect(page.locator('.activity-card')).toHaveCount(3);
});
test('trip settings groups show actual membership and searchable timezone',async({page})=>{
 await page.setViewportSize({width:390,height:844});await setup(page);
 await page.getByRole('button',{name:'旅程设置',exact:true}).click();
 await expect(page.getByRole('button',{name:/成员与邀请/})).toContainText('仅你一人');
 for(const name of ['基本信息','日程','成员与权限','整理']) await expect(page.getByRole('heading',{name,exact:true})).toBeVisible();
 await page.getByRole('button',{name:/^时区/}).click();await page.getByLabel('搜索时区').fill('Tokyo');
 await expect(page.getByRole('dialog').getByRole('button',{name:/Asia\/Tokyo/})).toBeVisible();
 await page.getByRole('dialog').getByRole('button',{name:/Asia\/Tokyo/}).click();
 await expect(page.getByRole('dialog')).toHaveCount(0);
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
});

for (const width of [1440, 390]) test(`calendar selects a range in two clicks and marks removed dates at ${width}px`, async ({page}, testInfo) => {
 await page.setViewportSize({width,height:950});await setup(page);await dates(page);
 const calendar=page.getByRole('group',{name:'日历选择日期范围'});
 await calendar.getByRole('button',{name:/^2026年11月3日/}).click();
 await expect(calendar.getByRole('status')).toContainText('再选结束日期');
 await expect(page.getByRole('dialog').getByRole('button',{name:'完成',exact:true})).toBeDisabled();
 await calendar.getByRole('button',{name:/^2026年11月4日/}).click();
 await expect(page.getByLabel('开始日期',{exact:true})).toHaveValue('2026-11-03');
 await expect(page.getByLabel('结束日期',{exact:true})).toHaveValue('2026-11-04');
 await expect(calendar.locator('.removed-date')).toHaveCount(2);
 await expect(calendar.locator('.in-range')).toHaveCount(2);
 await expect(page.getByRole('button',{name:'下一步',exact:true})).toBeEnabled();
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
 await page.screenshot({path:testInfo.outputPath(`date-range-${width}.png`),scale:'css'});
 await calendar.getByRole('button',{name:'上个月',exact:true}).click();
 await expect(calendar).toContainText('2026 年 10 月');
 await calendar.getByRole('button',{name:/^2026年10月30日/}).click();
 await calendar.getByRole('button',{name:'下个月',exact:true}).click();
 await calendar.getByRole('button',{name:/^2026年11月2日/}).click();
 await expect(page.getByLabel('开始日期',{exact:true})).toHaveValue('2026-10-30');
 await expect(page.getByLabel('结束日期',{exact:true})).toHaveValue('2026-11-02');
 await expect(calendar.locator('.removed-date')).toHaveCount(0);
});

test('calendar supports keyboard range selection and reversed date clicks',async({page})=>{
 await page.setViewportSize({width:1440,height:1000});await setup(page);await dates(page);
 const calendar=page.getByRole('group',{name:'日历选择日期范围'});
 const third=calendar.getByRole('button',{name:/^2026年11月3日/});
 await third.focus();await third.press('Enter');await third.press('ArrowRight');await page.keyboard.press('ArrowRight');await page.keyboard.press('Enter');
 await expect(page.getByLabel('开始日期',{exact:true})).toHaveValue('2026-11-03');
 await expect(page.getByLabel('结束日期',{exact:true})).toHaveValue('2026-11-05');
 await calendar.getByRole('button',{name:/^2026年11月10日/}).click();await calendar.getByRole('button',{name:/^2026年11月7日/}).click();
 await expect(page.getByLabel('开始日期',{exact:true})).toHaveValue('2026-11-07');
 await expect(page.getByLabel('结束日期',{exact:true})).toHaveValue('2026-11-10');
});
