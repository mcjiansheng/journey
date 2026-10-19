import {test,expect} from '@playwright/test';
import {fileURLToPath} from 'node:url';
import {createApp,shutdownServer} from '../../server/index.mjs';

let app,server,base;
test.beforeEach(async()=>{
 app=createApp({distPath:fileURLToPath(new URL('../../dist/',import.meta.url)),databasePath:':memory:',securityPath:':memory:',config:{amapKey:''}});
 server=await new Promise(resolve=>{const listener=app.listen(0,'127.0.0.1',()=>resolve(listener))});
 base=`http://127.0.0.1:${server.address().port}`;app.locals.config.appOrigin=base;
});
test.afterEach(async()=>{if(server)await shutdownServer(server,app)});

async function seedTrip(page){
 await page.goto(base);
 await page.evaluate(async()=>{
  const auth=await fetch('/api/auth/register',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({identifier:`route-menu-${crypto.randomUUID()}@example.test`,password:'JourneyRouteMenu2026!',displayName:'路线菜单验收'})}).then(r=>r.json());
  const headers={'Content-Type':'application/json','X-CSRF-Token':auth.csrfToken};
  const snapshot=await fetch('/api/trips',{method:'POST',headers,body:JSON.stringify({id:crypto.randomUUID(),name:'路线菜单验收旅程',teamMode:'admin',timezone:'Asia/Shanghai',currency:'CNY',dayCount:9,startDate:'2026-11-01',destination:'南京'})}).then(r=>r.json());
  const lease=await fetch('/api/clock',{method:'POST',headers,body:JSON.stringify({deviceId:crypto.randomUUID()})}).then(r=>r.json());
  const patch={name:'玄武湖路线验收地点',address:'南京市玄武区',lng:118.7975,lat:32.0739,provider:null,providerPlaceId:null,category:'景点',sourceUrl:'',fetchedAt:null,coordSystem:'GCJ-02'};
  const response=await fetch(`/api/trips/${snapshot.trip.id}/operations`,{method:'POST',headers,body:JSON.stringify({id:crypto.randomUUID(),objectId:crypto.randomUUID(),kind:'create',objectType:'favorite',patch,clock:{leaseId:lease.leaseId,elapsedMs:0,uncertaintyMs:0}})});
  if(!response.ok)throw new Error(`Fixture operation failed: ${response.status}`);
  await fetch('/api/navigation',{method:'PUT',headers,body:JSON.stringify({lastTripId:snapshot.trip.id})});
 });
 await page.reload();
 await page.getByRole('button',{name:/继续旅程/}).click();
 await page.getByRole('navigation',{name:'主导航',exact:true}).getByRole('button',{name:'地图',exact:true}).click();
 await expect(page.locator('.map-shell')).toBeVisible();
 await page.getByRole('button',{name:'查看收藏列表',exact:true}).click();
 await page.locator('.map-result').filter({hasText:'玄武湖路线验收地点'}).click();
 await expect(page.locator('.map-panel.mode-detail')).toBeVisible();
 await expect(page.getByRole('heading',{name:'玄武湖路线验收地点',exact:true})).toBeVisible();
}

async function surfaceState(page){
 return page.locator('.map-route-menu').evaluate(menu=>{
  const style=getComputedStyle(menu),channels=style.backgroundColor.replace(/rgba?\(|\)|,/g,' ').replace(/\s*\/\s*/,' ').trim().split(/\s+/).map(Number);
  return{alpha:channels.length>=4?channels.at(-1):1,backgroundImage:style.backgroundImage,backdropFilter:style.backdropFilter};
 });
}

test('nine-day route menu layers over place details, scrolls, and preserves keyboard and theme behavior',async({page})=>{
 await page.setViewportSize({width:1280,height:720});await seedTrip(page);
 const trigger=page.getByRole('button',{name:'地图路线日期',exact:true});
 await expect(page.getByRole('heading',{name:'玄武湖路线验收地点',exact:true})).toBeVisible();
 await trigger.click();
 const menu=page.locator('.map-route-menu'),list=page.getByRole('listbox',{name:'地图路线日期',exact:true}),options=list.getByRole('option');
 await expect(list).toBeVisible();await expect(options).toHaveCount(10);
 await menu.evaluate(el=>Promise.all(el.getAnimations().map(animation=>animation.finished.catch(()=>{}))));
 const layering=await page.evaluate(()=>{
  const list=document.querySelector('.map-route-options'),panel=document.querySelector('.map-panel'),listRect=list.getBoundingClientRect(),panelRect=panel.getBoundingClientRect();
  const left=Math.max(listRect.left,panelRect.left),right=Math.min(listRect.right,panelRect.right),top=Math.max(listRect.top,panelRect.top),bottom=Math.min(listRect.bottom,panelRect.bottom);
  const target=document.elementFromPoint((left+right)/2,(top+bottom)/2);
  return{overlaps:right>left&&bottom>top,listOnTop:list.contains(target),target:target?.className?.baseVal||target?.className||target?.tagName};
 });
 expect(layering.overlaps).toBe(true);expect(layering.listOnTop).toBe(true);
 expect((await surfaceState(page)).alpha).toBe(1);
 await page.keyboard.press('Escape');await expect(menu).toBeHidden();await expect(trigger).toBeFocused();
 await expect(page.getByRole('heading',{name:'玄武湖路线验收地点',exact:true})).toBeVisible();

 await trigger.click();await page.keyboard.press('End');
 await expect(options.nth(9)).toBeFocused();
 await expect.poll(()=>list.evaluate(el=>el.scrollTop)).toBeGreaterThan(0);
 await page.keyboard.press('Enter');
 await expect(menu).toBeHidden();await expect(trigger).toContainText(/第9天路线/);await expect(trigger).toBeFocused();
 await expect(page.getByRole('heading',{name:'玄武湖路线验收地点',exact:true})).toBeVisible();

 await page.locator('html').evaluate(el=>{el.dataset.theme='dark'});
 await trigger.click();await expect(list).toBeVisible();
 await expect(options.nth(9)).toHaveAttribute('aria-selected','true');
 expect((await surfaceState(page)).alpha).toBe(1);
 await page.locator('html').evaluate(el=>{el.dataset.transparency='true'});
 const reduced=await surfaceState(page);expect(reduced.alpha).toBe(1);expect(reduced.backgroundImage).toBe('none');expect(reduced.backdropFilter).toBe('none');
 await page.keyboard.press('Escape');await expect(trigger).toBeFocused();
 await expect(page.getByRole('heading',{name:'玄武湖路线验收地点',exact:true})).toBeVisible();
});
