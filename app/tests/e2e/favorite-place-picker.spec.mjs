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

async function setup(page,{title='保留中的活动草稿',empty=false}={}){
 await page.emulateMedia({reducedMotion:'reduce'});
 // Only the local fixture server is used, including while searching favorites.
 await page.route('https://**/*',route=>route.abort('failed'));
 await page.goto(base);
 const tripId=await page.evaluate(async empty=>{
  const auth=await fetch('/api/auth/register',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({identifier:`picker-${crypto.randomUUID()}@example.test`,password:'JourneyFavoritePicker2026!',displayName:'收藏选择验收'})}).then(r=>r.json());
  const headers={'Content-Type':'application/json','X-CSRF-Token':auth.csrfToken};
  const snapshot=await fetch('/api/trips',{method:'POST',headers,body:JSON.stringify({id:crypto.randomUUID(),name:'收藏选择验收',teamMode:'admin',timezone:'Asia/Shanghai',currency:'CNY',dayCount:3,startDate:'2026-11-01',destination:'南京'})}).then(r=>r.json());
  const lease=await fetch('/api/clock',{method:'POST',headers,body:JSON.stringify({deviceId:crypto.randomUUID()})}).then(r=>r.json());
  const post=async(objectType,patch)=>{
   const response=await fetch(`/api/trips/${snapshot.trip.id}/operations`,{method:'POST',headers,body:JSON.stringify({id:crypto.randomUUID(),objectId:crypto.randomUUID(),kind:'create',objectType,patch,clock:{leaseId:lease.leaseId,elapsedMs:0,uncertaintyMs:0}})});
   if(!response.ok)throw new Error(`Fixture operation failed: ${response.status} ${await response.text()}`);
  };
  await post('markPreset',{name:'必吃',icon:'triangle',color:'coral',order:0});
  await post('markPreset',{name:'观景',icon:'star',color:'amber',order:1024});
  for(let index=0;index<(empty?0:24);index++){
   const name=index===0?'名称命中咖啡馆':index===1?'地址命中店':`收藏地点${String(index+1).padStart(2,'0')}`;
   await post('favorite',{name,address:index===1?'玄武门中央路88号':`南京第${index+1}街区`,lng:118.7+index/1000,lat:32.05+index/1000,provider:null,providerPlaceId:null,category:'景点',sourceUrl:'',fetchedAt:null,coordSystem:'GCJ-02',mark:index<4?{icon:'triangle',color:'coral'}:index<8?{icon:'star',color:'amber'}:index===23?{icon:'heart',color:'purple'}:null});
  }
  await fetch('/api/navigation',{method:'PUT',headers,body:JSON.stringify({lastTripId:snapshot.trip.id,tripId:snapshot.trip.id,context:{page:'itinerary'}})});
  return snapshot.trip.id;
 },empty);
 await page.reload();await page.getByRole('button',{name:/继续旅程/}).click();
 await page.getByRole('button',{name:'添加活动',exact:true}).first().click();
 if(title!==null)await page.getByLabel('活动名称',{exact:true}).fill(title);
 return tripId;
}
async function snapshot(page,tripId){return page.evaluate(tripId=>fetch(`/api/trips/${tripId}`).then(r=>r.json()),tripId)}

const picker=page=>page.getByRole('dialog',{name:'从收藏选择',exact:true});
const rows=page=>picker(page).getByRole('list',{name:'收藏地点',exact:true}).getByRole('button');
async function openPicker(page){
 await page.getByRole('button',{name:'从收藏选择',exact:true}).click();
 await expect(picker(page)).toBeVisible();
}
async function assertSelectArrow(select){
 const style=await select.evaluate(el=>{
  const s=getComputedStyle(el);return {appearance:s.appearance,padding:parseFloat(s.paddingRight),position:s.backgroundPosition,size:s.backgroundSize,image:s.backgroundImage};
 });
 expect(style.appearance).toBe('none');expect(style.padding).toBeGreaterThanOrEqual(40);
 expect(style.position).toContain('14px');expect(style.size).toBe('16px 16px');expect(style.image).toContain('data:image/svg+xml');
}

for(const width of [1440,1280,390,320])test(`favorite picker searches and filters 24 saved places at ${width}px`,async({page})=>{
 await page.setViewportSize({width,height:width===1280?702:900});const tripId=await setup(page);
 const activity=page.locator('.activity-editor-modal');
 const period=activity.getByLabel('时段',{exact:true});await period.selectOption('下午');await expect(period).toHaveValue('下午');await assertSelectArrow(period);
 await activity.getByRole('button',{name:'具体时间',exact:true}).click();
 await activity.getByLabel('开始时间',{exact:true}).fill('10:20');
 await activity.getByLabel('结束时间 · 选填',{exact:true}).fill('08:30');
 const endDay=activity.getByLabel('结束日',{exact:true});await endDay.selectOption('1');await expect(endDay).toHaveValue('1');await assertSelectArrow(endDay);
 await openPicker(page);await expect(rows(page)).toHaveCount(24);
 const searchInset=await picker(page).getByLabel('搜索收藏地点',{exact:true}).evaluate(el=>parseFloat(getComputedStyle(el).paddingLeft));
 expect(searchInset).toBeGreaterThanOrEqual(40);
 await expect(rows(page).locator('[data-mark-icon="star"]')).toHaveCount(19);
 await expect(rows(page).locator('[data-mark-icon="triangle"]')).toHaveCount(4);
 const list=picker(page).getByRole('list',{name:'收藏地点',exact:true});
 const geometry=await list.evaluate(el=>({height:el.clientHeight,scrollHeight:el.scrollHeight}));
 expect(geometry.height).toBeGreaterThan(width>760?320:220);
 if(width===1280)expect(geometry.height).toBeGreaterThanOrEqual(408);expect(geometry.scrollHeight).toBeGreaterThan(geometry.height);
 await rows(page).last().scrollIntoViewIfNeeded();await expect(rows(page).last()).toBeVisible();
 await list.evaluate(el=>el.scrollTop=0);
 expect(await picker(page).evaluate(el=>el.scrollWidth<=el.clientWidth)).toBe(true);
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
 await page.mouse.move(5,5);
 await page.screenshot({path:`../.local/evidence/1103-favorite-picker/${width}.png`,fullPage:true,animations:'disabled'});
 const search=picker(page).getByLabel('搜索收藏地点',{exact:true});
 await search.fill('名称命中');await expect(rows(page)).toHaveCount(1);await expect(rows(page)).toContainText('名称命中咖啡馆');
 await search.fill('中央路');await expect(rows(page)).toHaveCount(1);await expect(rows(page)).toContainText('地址命中店');
 await search.fill('找不到的收藏');await expect(rows(page)).toHaveCount(0);await expect(picker(page).getByText('没有找到匹配的收藏地点。',{exact:true})).toBeVisible();
 await search.fill('');
 const filters=picker(page).getByRole('group',{name:'按标记筛选',exact:true});
 await filters.getByRole('button',{name:/观景/}).click();await expect(rows(page)).toHaveCount(4);await expect(rows(page).locator('[data-mark-icon="star"]')).toHaveCount(4);
 await filters.getByRole('button',{name:/未分类/}).click();await expect(rows(page)).toHaveCount(16);await expect(rows(page).locator('[data-mark-icon="star"]')).toHaveCount(15);await expect(rows(page).locator('[data-mark-icon="heart"]')).toHaveCount(1);await expect(rows(page).filter({hasText:'收藏地点24'})).toContainText('未分类');
 await filters.getByRole('button',{name:/必吃/}).click();await expect(rows(page)).toHaveCount(4);await expect(rows(page).locator('[data-mark-icon="triangle"]')).toHaveCount(4);
 await search.press('Escape');await expect(picker(page)).toHaveCount(0);await expect(activity).toBeVisible();
 await expect(activity.getByLabel('活动名称',{exact:true})).toHaveValue('保留中的活动草稿');
 await expect(activity.getByLabel('开始时间',{exact:true})).toHaveValue('10:20');await expect(endDay).toHaveValue('1');
 await openPicker(page);
 await picker(page).getByRole('group',{name:'按标记筛选',exact:true}).getByRole('button',{name:/全部/}).click();
 await picker(page).getByLabel('搜索收藏地点',{exact:true}).fill('名称命中');
 await rows(page).first().click();await expect(picker(page)).toHaveCount(0);
 await expect(activity.getByRole('combobox',{name:'地点 选填'})).toHaveValue('名称命中咖啡馆');
 await activity.getByRole('button',{name:'完成',exact:true}).click();await expect(activity).toHaveCount(0);await expect(page.locator('.sync-status.synced')).toBeVisible();
 const saved=await snapshot(page,tripId),favorite=saved.objects.find(o=>o.kind==='favorite'&&o.payload.name==='名称命中咖啡馆').payload;
 const {mark,...place}=favorite;const activityPayload=saved.objects.find(o=>o.kind==='activity').payload;
 expect(activityPayload.place).toEqual(place);expect(Object.hasOwn(activityPayload.place,'mark')).toBe(false);
 expect(activityPayload.title).toBe('保留中的活动草稿');expect(activityPayload.time.endDayOffset).toBe(1);
});

test('choosing favorites fills an empty activity title and follows replacements until manually edited',async({page})=>{
 await page.setViewportSize({width:1440,height:900});const tripId=await setup(page,{title:null});
 const activity=page.locator('.activity-editor-modal'),title=activity.getByLabel('活动名称',{exact:true});
 await expect(title).toHaveValue('');await expect(activity.getByRole('button',{name:'完成',exact:true})).toBeDisabled();
 async function choose(query){
  await openPicker(page);await picker(page).getByLabel('搜索收藏地点',{exact:true}).fill(query);await expect(rows(page)).toHaveCount(1);await rows(page).first().click();await expect(picker(page)).toHaveCount(0);
 }
 await choose('名称命中');await expect(title).toHaveValue('名称命中咖啡馆');
 await expect(activity.getByRole('button',{name:'完成',exact:true})).toBeEnabled();
 await choose('地址命中');await expect(title).toHaveValue('地址命中店');
 await expect(page.locator('.sync-status.synced')).toBeVisible();
 const first=(await snapshot(page,tripId)).objects.find(o=>o.kind==='activity');expect(first.payload.title).toBe('地址命中店');expect(first.payload.place.name).toBe('地址命中店');
 // Reloading an unfinished editor restores its draft and automatic title mode.
 await page.reload();await page.getByRole('button',{name:/继续旅程/}).click();
 await expect(activity).toBeVisible();await expect(title).toHaveValue('地址命中店');
 await choose('收藏地点03');await expect(title).toHaveValue('收藏地点03');
 // Re-entering the same place name still counts as a manually written title.
 await title.fill('临时手写');await title.fill('收藏地点03');
 await choose('收藏地点04');await expect(title).toHaveValue('收藏地点03');
 await title.fill('');await expect(title).toHaveValue('收藏地点04');
 await choose('收藏地点05');await expect(title).toHaveValue('收藏地点05');
 await title.fill('我的安排');await choose('收藏地点06');await expect(title).toHaveValue('我的安排');
 await activity.getByRole('button',{name:'完成',exact:true}).click();await expect(activity).toHaveCount(0);await expect(page.locator('.sync-status.synced')).toBeVisible();
 const updated=(await snapshot(page,tripId)).objects.find(o=>o.id===first.id).payload;
 expect(updated.title).toBe('我的安排');expect(updated.place.name).toBe('收藏地点06');expect(Object.hasOwn(updated.place,'mark')).toBe(false);
});


test('a completed automatic title preserves a later remote rename when reopened',async({page})=>{
 await page.setViewportSize({width:1440,height:900});const tripId=await setup(page,{title:null});
 const activity=page.locator('.activity-editor-modal');
 await openPicker(page);await picker(page).getByLabel('搜索收藏地点',{exact:true}).fill('名称命中');await rows(page).first().click();
 await expect(activity.getByLabel('活动名称',{exact:true})).toHaveValue('名称命中咖啡馆');
 await activity.getByRole('button',{name:'完成',exact:true}).click();await expect(activity).toHaveCount(0);await expect(page.locator('.sync-status.synced')).toBeVisible();
 const object=(await snapshot(page,tripId)).objects.find(o=>o.kind==='activity');
 await page.evaluate(async({tripId,objectId})=>{
  const session=await fetch('/api/session').then(r=>r.json());
  const headers={'Content-Type':'application/json','X-CSRF-Token':session.csrfToken};
  const lease=await fetch('/api/clock',{method:'POST',headers,body:JSON.stringify({deviceId:crypto.randomUUID()})}).then(r=>r.json());
  const response=await fetch(`/api/trips/${tripId}/operations`,{method:'POST',headers,body:JSON.stringify({id:crypto.randomUUID(),objectId,kind:'patch',patch:{title:'同行改好的活动名'},clock:{leaseId:lease.leaseId,elapsedMs:0,uncertaintyMs:0}})});
  if(!response.ok)throw new Error(`Remote rename failed: ${response.status}`);
 },{tripId,objectId:object.id});
 await page.reload();await page.getByRole('button',{name:/继续旅程/}).click();await page.getByRole('heading',{name:'同行改好的活动名',exact:true}).click();
 await expect(activity.getByLabel('活动名称',{exact:true})).toHaveValue('同行改好的活动名');
 await activity.getByRole('button',{name:'完成',exact:true}).click();await expect(activity).toHaveCount(0);await expect(page.locator('.sync-status.synced')).toBeVisible();
 expect((await snapshot(page,tripId)).objects.find(o=>o.id===object.id).payload.title).toBe('同行改好的活动名');
});


test('empty favorites explain the empty list without closing the activity draft',async({page})=>{
 await page.setViewportSize({width:390,height:900});await setup(page,{empty:true});
 await openPicker(page);await expect(rows(page)).toHaveCount(0);
 await expect(picker(page).getByText('还没有收藏的地点。',{exact:true})).toBeVisible();
 await expect(picker(page).getByRole('status')).toHaveText('0 个地点');
 await page.keyboard.press('Escape');await expect(picker(page)).toHaveCount(0);
 await expect(page.locator('.activity-editor-modal').getByLabel('活动名称',{exact:true})).toHaveValue('保留中的活动草稿');
});
