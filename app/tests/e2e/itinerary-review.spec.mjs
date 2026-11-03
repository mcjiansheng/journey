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
test('automatic routes reuse estimates without creating route tasks and preserve deleted routes',async({page})=>{
 const f=await setup(page,{located:true});
 await expect(page.locator('.route-row').filter({hasText:'步行约 20 分钟'})).toHaveCount(2);
 expect(await page.evaluate(()=>window.__routeCalls)).toBe(2);
 const objects=await page.evaluate(async f=>fetch(`/api/trips/${f.tripId}`,{headers:f.headers}).then(r=>r.json()),f);
 expect(objects.objects.filter(o=>o.kind==='route')).toHaveLength(0);
 await page.getByRole('tab',{name:/第2天/}).click();await page.getByRole('tab',{name:/第1天/}).click();
 await expect(page.locator('.route-row').filter({hasText:'步行约 20 分钟'})).toHaveCount(2);expect(await page.evaluate(()=>window.__routeCalls)).toBe(2);
 await page.locator('.route-row').first().click();await expect(page.getByLabel('预计耗时（分钟）')).toHaveValue('20');await page.getByRole('dialog').getByRole('button',{name:'完成',exact:true}).click();
 await page.locator('.route-row').first().click();await page.getByRole('dialog').getByRole('button',{name:'删除',exact:true}).click();await page.getByRole('dialog').getByRole('button',{name:'完成',exact:true}).click();
 await expect(page.locator('.route-row').filter({hasText:'路程已删除'})).toHaveCount(1);expect(await page.evaluate(()=>window.__routeCalls)).toBe(2);
 await page.locator('.route-row').filter({hasText:'路程已删除'}).click();await expect(page.getByRole('dialog').getByRole('button',{name:'恢复',exact:true})).toBeVisible();
});
test('failed route estimates retry after the connection returns',async({page,context})=>{
 await page.addInitScript(()=>{window.__routeFailure=true});await setup(page,{located:true});
 await expect.poll(()=>page.evaluate(()=>window.__routeCalls)).toBe(2);
 await page.evaluate(()=>{window.__routeFailure=false});await context.setOffline(true);await expect(page.locator('.sync-status.offline')).toBeVisible();
 await context.setOffline(false);await expect(page.locator('.route-row').filter({hasText:'步行约 20 分钟'})).toHaveCount(2);
});
test('delete toast restores the activity and opinions remain visible',async({page})=>{
 const f=await setup(page);
 await page.evaluate(async f=>{const r=await fetch(`/api/trips/${f.tripId}/operations`,{method:'POST',headers:f.headers,body:JSON.stringify({id:crypto.randomUUID(),objectId:f.ids[0],kind:'express',generation:0,expression:{notParticipating:true,wishDelete:true},clock:{leaseId:f.lease.leaseId,elapsedMs:100,uncertaintyMs:0}})});if(!r.ok)throw new Error(await r.text())},f);
 const card=page.locator('.activity-card').first();await expect(card).toContainText('1 人不参加');await expect(card).toContainText('1/1 希望删除');
 await card.locator('.activity-more summary').click();await card.getByRole('button',{name:'删除',exact:true}).click();await expect(page.locator('.activity-card')).toHaveCount(2);
 await page.getByRole('button',{name:'撤销',exact:true}).click();await expect(page.locator('.activity-card')).toHaveCount(3);
});
test('mobile date bar stays visible and changes dates after scrolling',async({page},testInfo)=>{
 await page.setViewportSize({width:390,height:844});await setup(page,{count:12});
 await expect(page.getByText('灵活安排',{exact:true})).toHaveCount(0);await expect(page.locator('.route-row')).toHaveCount(11);
 await page.locator('.main-content').evaluate(element=>{element.scrollTop=550});
 await expect(page.getByLabel('当前计划日')).toBeVisible();const bar=await page.locator('.mobile-day-bar').boundingBox(),header=await page.locator('.trip-header').boundingBox();expect(bar.y).toBeGreaterThanOrEqual(header.y+header.height-1);expect(bar.y).toBeLessThan(header.y+header.height+5);
 await page.getByRole('button',{name:'后一天',exact:true}).click();await expect(page.getByText('这一天还没有安排',{exact:true})).toBeVisible();await expect(page.getByLabel('当前计划日')).toHaveValue(await page.getByLabel('当前计划日').locator('option').filter({hasText:'第2天'}).getAttribute('value'));
 await expect(page.locator('.day-content-stage')).not.toHaveAttribute('data-transitioning','');expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);await page.screenshot({path:testInfo.outputPath('mobile-date-bar.png'),scale:'css'});
});

for(const width of [1440,390])test(`adjacent precise activities show notes without a stray zero at ${width}px`,async({page})=>{
 await page.setViewportSize({width,height:844});await setup(page,{count:2,precise:true});
 await expect(page.locator('.activity-notes')).toHaveText('东门集合，提前预约');
 await expect(page.locator('.timing-note')).toHaveCount(0);
 const zeros=await page.locator('.activity-card').evaluateAll(cards=>cards.flatMap(card=>{
  const walker=document.createTreeWalker(card,NodeFilter.SHOW_TEXT),found=[];let node;
  while(node=walker.nextNode())if(node.textContent.trim()==='0')found.push(node.textContent);
  return found;
 }));expect(zeros).toEqual([]);
 await expect(page.locator('.activity-time-lock')).toHaveCount(2);
 const route=page.locator('.route-add').last();
 if(width===390){await expect(route).toBeVisible();await page.getByRole('button',{name:'当天操作',exact:true}).click();await page.getByRole('button',{name:'调整顺序',exact:true}).click();await expect(route).toBeHidden();await page.getByRole('button',{name:'完成',exact:true}).click();await expect(route).toBeVisible()}
 await page.locator('.activity-more>summary').last().click();
 await expect(page.locator('.activity-more-panel').last().getByRole('button')).toHaveText(['编辑','我不参加','删除']);
 expect((await page.locator('.activity-more-panel').last().boundingBox()).width).toBeGreaterThanOrEqual(200);
 await page.getByRole('button',{name:'当天操作',exact:true}).click();await expect(page.getByRole('button',{name:'调整日期与天数…',exact:true})).toBeVisible();
});

test('associated expenses appear on their activity and edit closes the menu',async({page})=>{
 const f=await setup(page,{count:2});
 await page.evaluate(async f=>{
  const response=await fetch(`/api/trips/${f.tripId}/operations`,{method:'POST',headers:f.headers,body:JSON.stringify({id:crypto.randomUUID(),objectId:crypto.randomUUID(),kind:'create',objectType:'expense',patch:{title:'门票',activityId:f.ids[1],payment:{status:'paid',currency:'CNY',amountMinor:16800}},clock:{leaseId:f.lease.leaseId,elapsedMs:100,uncertaintyMs:0}})});
  if(!response.ok)throw new Error(await response.text());
 },f);
 const first=page.locator('.activity-card').first(),second=page.locator('.activity-card').last();
 await expect(second.locator('.activity-opinions')).toContainText('168.00');await expect(first.locator('.activity-opinions')).toHaveCount(0);
 await second.locator('.activity-more>summary').click();await second.getByRole('button',{name:'编辑',exact:true}).click();
 await expect(page.getByRole('dialog')).toBeVisible();await page.keyboard.press('Escape');await expect(second.locator('.activity-more')).not.toHaveAttribute('open','');
});


test('today stays marked and date overflow follows selection without moving focus',async({page},testInfo)=>{
 await page.clock.install({time:new Date('2026-11-01T04:00:00Z')});
 await page.setViewportSize({width:1100,height:844});
 await setup(page,{count:1,dayCount:15,startDate:'2026-10-28'});
 const tabs=page.getByRole('tablist',{name:'计划日'}),today=tabs.getByRole('tab',{name:/第5天/});
 await expect(today).toHaveAttribute('aria-current','date');await expect(today).toContainText('今天');
 await expect(page.locator('.itinerary-date-tabs')).toHaveClass(/has-after/);
 await page.getByRole('button',{name:'向后浏览日期',exact:true}).click();
 await page.getByRole('tab',{name:/第15天/}).click();
 await expect(page.getByRole('tab',{name:/第15天/})).toHaveAttribute('aria-selected','true');
 await page.getByRole('button',{name:'回到今天',exact:true}).click();
 await expect(today).toHaveAttribute('aria-selected','true');await expect(today).not.toBeFocused();
 expect(await today.evaluate(button=>{const b=button.getBoundingClientRect(),p=button.parentElement.getBoundingClientRect();return b.left>=p.left-1&&b.right<=p.right+1})).toBe(true);
 expect(await today.evaluate(button=>{const b=button.getBoundingClientRect(),p=button.parentElement.getBoundingClientRect();return Math.abs(b.left+b.width/2-p.left-p.width/2)<2})).toBe(true);
 await page.locator('.day-tabs').evaluate(strip=>{strip.scrollLeft=0});
 await page.getByRole('button',{name:'当天操作',exact:true}).click();
 await expect.poll(()=>page.locator('.day-tabs').evaluate(strip=>strip.scrollLeft)).toBe(0);
 await page.screenshot({path:testInfo.outputPath('today-date-strip.png'),scale:'css'});
 await page.getByRole('button',{name:'与另一天交换…',exact:true}).click();
 await expect(page.getByRole('dialog').getByRole('button').filter({hasText:/第.*天/})).toHaveCount(14);
 await page.keyboard.press('Escape');
 await page.setViewportSize({width:390,height:844});
 await page.getByRole('button',{name:'后一天',exact:true}).click();
 await expect(page.getByLabel('当前计划日').locator('option').first()).toHaveText('回到今天');
 await page.getByRole('button',{name:'回到今天',exact:true}).click();
 await expect(page.getByLabel('当前计划日')).toHaveValue(await page.getByLabel('当前计划日').locator('option').filter({hasText:'· 今天'}).getAttribute('value'));
});

test('activity expenses distinguish paid and estimated and open only linked entries',async({page},testInfo)=>{
 const f=await setup(page,{count:2,dayCount:15});
 await page.evaluate(async f=>{
  for(const [index,payment] of [{status:'paid',currency:'CNY',amountMinor:16800},{status:'paid',currency:'CNY',amountMinor:2000},{status:'estimated',currency:'CNY',amountMinor:6000},{status:'paid',currency:'USD',amountMinor:1000}].entries()){
   const response=await fetch(`/api/trips/${f.tripId}/operations`,{method:'POST',headers:f.headers,body:JSON.stringify({id:crypto.randomUUID(),objectId:crypto.randomUUID(),kind:'create',objectType:'expense',patch:{title:`活动费用${index}`,activityId:f.ids[index===3?0:1],date:index===2?null:'2026-11-01',payment},clock:{leaseId:f.lease.leaseId,elapsedMs:100+index,uncertaintyMs:0}})});
   if(!response.ok)throw new Error(await response.text());
  }
 },f);
 const card=page.locator('.activity-card').last();
 await expect(card.getByRole('button',{name:/已付/})).toHaveText(/已付.*188.00.*2 笔/);
 await expect(card.getByRole('button',{name:/预计/})).toHaveText(/预计.*60.00.*1 笔/);
 await card.getByRole('button',{name:/已付/}).click();
 await expect(page.locator('.ledger-activity-filter')).toContainText('活动2');
 await expect(page.locator('.expense-row')).toHaveCount(3);await expect(page.locator('.ledger-total')).toContainText('188.00');
 await page.setViewportSize({width:390,height:844});
 await expect(page.locator('.ledger-date-tabs')).toHaveClass(/has-after/);
 await page.screenshot({path:testInfo.outputPath('activity-expense-mobile.png'),scale:'css'});
 await expect(page.getByRole('button',{name:'未记录日期',exact:true})).toHaveCount(0);
 await page.getByRole('group',{name:'按日期查看'}).getByRole('button',{name:/^第 15 天 · /}).click();
 await expect(page.locator('.expense-row')).toHaveCount(0);
 await expect.poll(()=>page.getByRole('group',{name:'按日期查看'}).getByRole('button',{name:/^第 15 天 · /}).evaluate(button=>{const b=button.getBoundingClientRect(),p=button.parentElement.getBoundingClientRect();return b.left>=p.left-1&&b.right<=p.right+1})).toBe(true);
 await page.getByRole('group',{name:'按日期查看'}).getByRole('button',{name:/^第 1 天 · /}).click();
 await expect(page.locator('.expense-row')).toHaveCount(3);
 await page.getByRole('button',{name:'查看全部费用',exact:true}).click();
 await expect(page.locator('.ledger-activity-filter')).toHaveCount(0);
});
