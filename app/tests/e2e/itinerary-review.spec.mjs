import {test,expect} from '@playwright/test';
import {fileURLToPath} from 'node:url';
import {createApp,shutdownServer} from '../../server/index.mjs';
let app,server,base;
test.beforeAll(async()=>{
 app=createApp({distPath:fileURLToPath(new URL('../../dist/',import.meta.url)),databasePath:':memory:',securityPath:':memory:',config:{amapKey:'itinerary-test'}});
 server=await new Promise(resolve=>{const listener=app.listen(0,'127.0.0.1',()=>resolve(listener))});base=`http://127.0.0.1:${server.address().port}`;app.locals.config.appOrigin=base;
});
test.afterAll(async()=>{if(server)await shutdownServer(server,app)});
async function setup(page,{count=3,located=false}={}){
 await page.route('https://webapi.amap.com/maps?**',route=>route.fulfill({contentType:'text/javascript',body:`window.__routeCalls=0;const Service=class{search(from,to,callback){window.__routeCalls++;if(window.__routeFailure){callback('error',{});return}callback('complete',{routes:[{time:1200,distance:1200,path:[[118,32],[118.01,32.01]]}]})}};window.AMap={plugin(plugins,callback){callback()},Walking:Service,Driving:Service,Riding:Service,Transfer:Service,PlaceSearch:Service,AutoComplete:Service,Geocoder:Service,Scale:Service};window.___onAPILoaded();`}));
 await page.goto(base);
 const fixture=await page.evaluate(async({count,located})=>{
  const auth=await fetch('/api/auth/register',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({identifier:`itinerary-${crypto.randomUUID()}@example.test`,password:'JourneyReview2026!',displayName:'行程验收'})}).then(r=>r.json());
  const headers={'Content-Type':'application/json','X-CSRF-Token':auth.csrfToken};
  const snapshot=await fetch('/api/trips',{method:'POST',headers,body:JSON.stringify({id:crypto.randomUUID(),name:'行程审查验收',teamMode:'admin',timezone:'Asia/Shanghai',currency:'CNY',dayCount:2,startDate:'2026-11-01',destination:'南京'})}).then(r=>r.json());
  const lease=await fetch('/api/clock',{method:'POST',headers,body:JSON.stringify({deviceId:crypto.randomUUID()})}).then(r=>r.json());
  const ids=[];
  for(let index=0;index<count;index++){
   const objectId=crypto.randomUUID();ids.push(objectId);
   const patch={title:`活动${index+1}`,dayId:snapshot.objects[0].id,order:index*1024,...(located?{place:{name:`地点${index+1}`,lng:118+index*.01,lat:32+index*.01}}:{})};
   const response=await fetch(`/api/trips/${snapshot.trip.id}/operations`,{method:'POST',headers,body:JSON.stringify({id:crypto.randomUUID(),objectId,kind:'create',objectType:'activity',patch,clock:{leaseId:lease.leaseId,elapsedMs:index,uncertaintyMs:0}})});if(!response.ok)throw new Error(await response.text());
  }
  await fetch('/api/navigation',{method:'PUT',headers,body:JSON.stringify({lastTripId:snapshot.trip.id})});return{tripId:snapshot.trip.id,ids,headers,lease};
 },{count,located});
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
 await page.getByRole('button',{name:'后一天',exact:true}).click();await expect(page.getByText('这一天还没有安排',{exact:true})).toBeVisible();await expect(page.getByLabel('当前计划日')).toHaveValue(await page.getByLabel('当前计划日').locator('option').nth(1).getAttribute('value'));
 await expect(page.locator('.day-content-stage')).not.toHaveAttribute('data-transitioning','');expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);await page.screenshot({path:testInfo.outputPath('mobile-date-bar.png'),scale:'css'});
});
