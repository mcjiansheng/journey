import {test,expect,webkit,devices} from '@playwright/test';
import {readFileSync} from 'node:fs';
const reusableAccounts=process.env.E2E_ACCOUNTS_FILE?JSON.parse(readFileSync(process.env.E2E_ACCOUNTS_FILE,'utf8')):{};
const suffix=()=>Date.now().toString(36)+Math.random().toString(36).slice(2,6);
async function register(page,name){
 await page.goto('./');
 if(reusableAccounts[name]){
  await page.getByLabel('手机号或邮箱').fill(reusableAccounts[name]);await page.getByLabel('密码',{exact:true}).fill('CourseJourney2026!');
  await page.getByRole('button',{name:'登录并继续'}).click();
 }else{
  await page.getByRole('button',{name:'创建账号',exact:true}).click();
  await page.getByLabel('手机号或邮箱').fill(`qa-${suffix()}@example.test`);
  await page.getByLabel('你的称呼').fill(name);await page.getByLabel('密码',{exact:true}).fill('CourseJourney2026!');
  await page.getByRole('button',{name:'创建账号并继续'}).click();
 }
 await expect(page.getByRole('button',{name:'创建旅程',exact:true})).toBeVisible();
}
async function createTrip(page,name){await page.getByRole('button',{name:'创建旅程',exact:true}).click();await page.getByLabel('旅程名称').fill(name);await page.getByLabel('目的地',{exact:true}).fill('南京');await page.getByLabel('出发日期',{exact:true}).fill('2026-11-01');await page.getByLabel('结束日期',{exact:true}).fill('2026-11-01');await page.getByRole('radio',{name:'平等团队',exact:true}).check();await page.getByRole('dialog').getByRole('button',{name:'创建旅程'}).click();await expect(page.getByRole('button',{name:'添加活动',exact:true}).first()).toBeVisible();}
async function addActivity(page,name){await page.getByRole('button',{name:'添加活动',exact:true}).first().click();await page.getByLabel('活动名称').fill(name);await page.getByLabel('所在日').selectOption({index:1});await page.getByRole('dialog').getByRole('button',{name:'完成',exact:true}).click();await expect(page.getByRole('button',{name:name,exact:false}).first()).toBeVisible();await expect(page.locator('.sync-status.synced')).toBeVisible();}
test('desktop registration, create, edit, context and mobile layout',async({page})=>{
 const errors=[];page.on('pageerror',e=>errors.push(e.message));await page.setViewportSize({width:1440,height:900});
 await register(page,'课程甲');await createTrip(page,'双会话验收旅程');await addActivity(page,'下午散步');
 await page.locator('.activity-card').hover();await expect(page.locator('.activity-card')).toHaveAttribute('data-pointer-active','');await page.screenshot({path:'../.local/evidence/desktop-itinerary.png',fullPage:true,scale:'css'});
 await page.getByRole('button',{name:'我的旅程',exact:true}).click();await expect(page.getByText('继续旅程',{exact:true})).toBeVisible();
 await page.getByRole('button',{name:/继续旅程/}).click();await expect(page.getByText('下午散步',{exact:true}).first()).toBeVisible();
 await page.setViewportSize({width:1024,height:768});await page.screenshot({path:'../.local/evidence/tablet-itinerary.png',fullPage:true,scale:'css'});expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBeTruthy();
 await page.setViewportSize({width:390,height:844});await page.screenshot({path:'../.local/evidence/mobile-itinerary.png',fullPage:true,scale:'css'});
 await expect(page.getByRole('navigation',{name:'手机主导航'})).toBeVisible();
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBeTruthy();expect(errors).toEqual([]);
});
async function nav(page,label){await page.getByRole('navigation',{name:'主导航',exact:true}).getByRole('button',{name:label,exact:true}).click();}
async function closeDialog(page){await page.getByRole('dialog').getByRole('button',{name:'关闭',exact:true}).click();}
async function editTitle(page,oldTitle,newTitle){await page.getByRole('button',{name:oldTitle,exact:false}).filter({has:page.locator('h3')}).click();await page.getByLabel('活动名称').fill(newTitle);await page.getByRole('dialog').getByRole('button',{name:'完成',exact:true}).click();}
async function readApi(page,path,method='GET',body){return page.evaluate(async({path,method,body})=>{const root=new URL('.',location.href);const session=await fetch(new URL('api/session',root)).then(r=>r.json());const r=await fetch(new URL(path.replace(/^\//,''),root),{method,headers:{'Content-Type':'application/json','X-CSRF-Token':session.csrfToken},...(body===undefined?{}:{body:JSON.stringify(body)})});return{status:r.status,data:await r.json()};},{path,method,body});}
test('two real sessions: invite, realtime, offline reload and occurrence-time merge, deletion and expense',async({browser})=>{
 const a=await browser.newContext(),b=await browser.newContext();const pa=await a.newPage(),pb=await b.newPage();
 try{
 await register(pa,'协作甲');await createTrip(pa,'离线与协作验收');await addActivity(pa,'共同午餐');
 await pa.getByRole('button',{name:/查看.*位同行伙伴/}).click();await pa.getByRole('button',{name:'生成邀请',exact:true}).click();
 const code=await pa.locator('.invite-code').innerText();await closeDialog(pa);
 await register(pb,'协作乙');await pb.getByRole('button',{name:'加入旅程',exact:true}).click();await pb.getByLabel('邀请编码或链接').fill(code);await pb.getByRole('button',{name:'查看旅程',exact:true}).click();await pb.getByRole('button',{name:'确认加入',exact:true}).click();
 await expect(pb.locator('h3',{hasText:'共同午餐'})).toBeVisible();await expect(pa.getByRole('button',{name:'查看 2 位同行伙伴'})).toBeVisible();
 await editTitle(pb,'共同午餐','同伴修改的午餐');await expect(pa.locator('h3',{hasText:'同伴修改的午餐'})).toBeVisible();
 await pa.evaluate(()=>navigator.serviceWorker.ready);await a.setOffline(true);await editTitle(pa,'同伴修改的午餐','离线较早修改');await expect(pa.locator('.sync-status.offline')).toBeVisible();
 // A's old change is durably queued before B's newer edit; transport order must not decide the value.
 await editTitle(pb,'同伴修改的午餐','联网较新修改');await expect(pb.locator('.sync-status.synced')).toBeVisible();
 await pa.reload();await pa.getByRole('button',{name:/继续旅程/}).click();await expect(pa.locator('h3',{hasText:'离线较早修改'})).toBeVisible();
 await a.setOffline(false);await expect(pa.locator('h3',{hasText:'联网较新修改'})).toBeVisible();await expect(pa.locator('.sync-status.synced')).toBeVisible();
 // Member cannot directly delete in equal mode; expression stays below strict majority.
 await pb.locator('.activity-more summary').click();await expect(pb.getByRole('button',{name:'希望删除',exact:true}).first()).toBeVisible();
 const trips=(await readApi(pb,'api/trips')).data.trips;const tid=trips[0].id;const snap=(await readApi(pb,`api/trips/${tid}`)).data;const act=snap.objects.find(x=>x.kind==='activity');
 const clock=(await readApi(pb,'api/clock','POST',{deviceId:'e2e-boundary'})).data;
 const denied=await readApi(pb,`api/trips/${tid}/operations`,'POST',{id:crypto.randomUUID(),kind:'delete',objectId:act.id,generation:act.generation,clock:{leaseId:clock.leaseId,elapsedMs:0,uncertaintyMs:1}});expect(denied.status).toBe(403);
 await pa.locator('.activity-more summary').click();await pa.locator('.activity-card').getByRole('button',{name:'删除',exact:true}).click();await expect(pb.locator('h3',{hasText:'联网较新修改'})).not.toBeVisible();
 await nav(pa,'设置');await pa.getByRole('button',{name:'已删除的内容',exact:true}).click();await pa.getByRole('dialog').getByRole('button',{name:'恢复',exact:true}).click();await closeDialog(pa);await expect(pb.locator('h3',{hasText:'联网较新修改'})).toBeVisible();
 await nav(pa,'费用');await pa.getByRole('button',{name:'记一笔',exact:true}).click();await pa.getByLabel('费用名称').fill('午餐预算');await pa.getByRole('dialog').getByRole('button',{name:'预计',exact:true}).click();await pa.getByLabel('预计金额 · 可暂空').fill('80');await pa.getByRole('dialog').getByRole('button',{name:'完成',exact:true}).click();await expect(pa.getByRole('button',{name:'午餐预算',exact:true})).toBeVisible();
 await pa.getByRole('button',{name:'午餐预算',exact:true}).click();await pa.getByRole('dialog').getByRole('button',{name:'已支付',exact:true}).click();await pa.getByLabel('实际金额').fill('76.50');await pa.getByRole('dialog').getByRole('button',{name:'完成',exact:true}).click();await expect(pa.getByText('1 笔支出',{exact:true})).toBeVisible();
 await expect(pa.locator('.sync-status.synced')).toBeVisible();const final=(await readApi(pa,`api/trips/${tid}`)).data;const expenses=final.objects.filter(x=>x.kind==='expense'&&x.state==='active');expect(expenses).toHaveLength(1);expect(expenses[0].payload.payment).toEqual({amountMinor:7650,currency:'CNY',status:'paid'});
 await pa.screenshot({path:'../.local/evidence/collaboration-ledger.png',fullPage:true,scale:'css'});
 }finally{await cleanup(pb);await cleanup(pa);await a.close();await b.close();}
});
test('real AMap POI search, shared favorite and viewport map',async({page})=>{
 test.setTimeout(90000);await register(page,'地图验收');await createTrip(page,'南京地图验收');await nav(page,'地图');
 await expect(page.locator('.amap-maps')).toBeVisible({timeout:30000});
 const initialTrips=(await readApi(page,'api/trips')).data.trips;const tripId=initialTrips[0].id;
 const savedCamera=async()=>((await readApi(page,'api/trips')).data.navigation.contexts[tripId]?.map||{});
 await expect.poll(async()=>(await savedCamera()).cameraDestination,{timeout:20000}).toBe('南京');
 const destinationCamera=await savedCamera();expect(destinationCamera.center[0]).toBeGreaterThan(118.5);expect(destinationCamera.center[0]).toBeLessThan(119.1);expect(destinationCamera.center[1]).toBeGreaterThan(31.8);expect(destinationCamera.center[1]).toBeLessThan(32.3);
 await page.screenshot({path:'../.local/evidence/map-destination-nanjing.png',fullPage:true,scale:'css'});
 await page.getByRole('button',{name:'放大地图',exact:true}).click();await expect.poll(async()=>(await savedCamera()).zoom).toBeGreaterThan(destinationCamera.zoom);const zoomed=await savedCamera();
 await page.getByTitle('返回我的旅程',{exact:true}).click();await page.getByRole('button',{name:/继续旅程/}).click();await expect(page.locator('.amap-maps')).toBeVisible({timeout:30000});
 await expect.poll(async()=>(await savedCamera()).zoom).toBe(zoomed.zoom);const restored=await savedCamera();expect(restored.center[0]).toBeCloseTo(zoomed.center[0],4);expect(restored.center[1]).toBeCloseTo(zoomed.center[1],4);
 await page.getByLabel('搜索地点').fill('南京博物院');
 await expect(page.locator('.map-result').first()).toBeVisible({timeout:30000});
 await page.getByRole('button',{name:'南京博物院 中山东路321号',exact:true}).click();await page.getByRole('button',{name:'收藏',exact:true}).click();await expect(page.getByRole('button',{name:'已收藏',exact:true})).toBeVisible();
 await expect(page.locator('.sync-status.synced')).toBeVisible();await page.screenshot({path:'../.local/evidence/desktop-map.png',fullPage:true,scale:'css'});
 const rect=await page.locator('.map-canvas').boundingBox();const view=page.viewportSize();expect(rect.width).toBe(view.width);expect(rect.height).toBe(view.height);
 await page.setViewportSize({width:390,height:844});await page.waitForTimeout(300);await page.screenshot({path:'../.local/evidence/mobile-map.png',fullPage:true,scale:'css'});expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBeTruthy();
 const trips=(await readApi(page,'api/trips')).data.trips;const snap=(await readApi(page,`api/trips/${trips[0].id}`)).data;const poi=snap.objects.find(x=>x.kind==='favorite');expect(poi.payload.provider).toBe('amap');expect(poi.payload.providerPlaceId).toBeTruthy();expect(poi.payload.lng).toBeGreaterThan(118);expect(poi.payload.lat).toBeGreaterThan(32);
 await page.setViewportSize({width:1280,height:800});await page.getByRole('button',{name:'加入行程',exact:true}).click();await page.getByLabel('所在日').selectOption({index:1});await page.getByRole('dialog').getByRole('button',{name:'完成',exact:true}).click();
 await page.getByLabel('搜索地点').fill('南京明孝陵');await page.locator('.map-result').filter({hasText:'明孝陵'}).filter({has:page.locator('small')}).first().click();await page.getByRole('button',{name:'加入行程',exact:true}).click();await page.getByLabel('所在日').selectOption({index:1});await page.getByRole('dialog').getByRole('button',{name:'完成',exact:true}).click();await page.getByLabel('地图路线日期').selectOption({index:1});
 await expect.poll(async()=>{const r=await readApi(page,`api/trips/${trips[0].id}`);return r.data.objects.find(o=>o.kind==='route'&&o.payload.path.length>2)?.payload.minutes||0;},{timeout:35000}).toBeGreaterThan(0);await expect(page.locator('.sync-status.synced')).toBeVisible();await page.screenshot({path:'../.local/evidence/desktop-route.png',fullPage:true,scale:'css'});
 await nav(page,'设置');await page.getByLabel('目的地',{exact:true}).fill('杭州');await page.getByLabel('目的地',{exact:true}).blur();await expect(page.locator('.sync-status.synced')).toBeVisible();await nav(page,'地图');
 await expect.poll(async()=>(await savedCamera()).cameraDestination,{timeout:20000}).toBe('杭州');const changed=await savedCamera();expect(changed.center[0]).toBeGreaterThan(120);expect(changed.center[0]).toBeLessThan(120.5);expect(changed.center[1]).toBeGreaterThan(30);expect(changed.center[1]).toBeLessThan(30.5);
 await page.screenshot({path:'../.local/evidence/map-destination-hangzhou.png',fullPage:true,scale:'css'});
});
test('trip and day recovery, settings shared with home, and draft return',async({page})=>{
 await register(page,'恢复验收');await createTrip(page,'日期恢复验收');await addActivity(page,'保留的活动');
 await page.getByRole('button',{name:'当天操作'}).click();await page.locator('.day-lifecycle').getByRole('button',{name:'删除',exact:true}).click();
 await expect(page.locator('h3',{hasText:'保留的活动'})).not.toBeVisible();await page.getByRole('button',{name:'已删除的计划日'}).click();await page.getByRole('dialog').getByRole('button',{name:'恢复',exact:true}).click();await closeDialog(page);await expect(page.locator('h3',{hasText:'保留的活动'})).toBeVisible();
 await nav(page,'设置');await page.getByText('旅程删除与恢复',{exact:true}).click();await page.locator('.lifecycle-menu').getByRole('button',{name:'删除',exact:true}).click();await expect(page.getByText('旅程已删除',{exact:true})).toBeVisible();await page.getByRole('button',{name:'返回我的旅程',exact:true}).click();
 await expect(page.getByRole('heading',{name:'已删除旅程'})).toBeVisible();await page.locator('.recovery-trip-card').click();await page.locator('.trip-recovery').getByRole('button',{name:'恢复',exact:true}).click();await expect(page.getByLabel('旅程名称')).toBeVisible();
 await page.getByLabel('外观',{exact:true}).selectOption('dark');await expect(page.locator('html')).toHaveAttribute('data-theme','dark');await page.getByRole('button',{name:'我的旅程',exact:true}).click();await page.getByRole('button',{name:'恢 恢复验收',exact:true}).click();await expect(page.getByLabel('外观',{exact:true})).toHaveValue('dark');await closeDialog(page);await page.getByRole('button',{name:/继续旅程/}).click();await nav(page,'行程');
 await page.locator('.activity-card').getByRole('button',{name:'编辑',exact:true}).click();await page.getByLabel('活动名称').fill('');await closeDialog(page);await page.getByRole('button',{name:'我的旅程',exact:true}).click();await page.getByRole('button',{name:/继续旅程/}).click();await page.locator('.activity-card').getByRole('button',{name:'编辑',exact:true}).click();await expect(page.getByLabel('活动名称')).toHaveValue('');await page.getByLabel('活动名称').fill('草稿继续完成');await page.getByRole('dialog').getByRole('button',{name:'完成',exact:true}).click();
 await page.setViewportSize({width:360,height:780});await page.screenshot({path:'../.local/evidence/mobile-dark.png',fullPage:true,scale:'css'});expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBeTruthy();
});
test('offline date change allows immediate activity creation and uploads stable references',async({page,context})=>{
 await register(page,'离线改期验收');await createTrip(page,'离线新日期');await page.evaluate(()=>navigator.serviceWorker.ready);
 await context.setOffline(true);await page.getByRole('button',{name:'调整日期',exact:true}).click();await page.getByLabel('开始日期',{exact:true}).fill('2026-11-10');await page.getByLabel('计划天数').fill('2');await page.getByRole('dialog').getByRole('button',{name:'调整日期',exact:true}).click();
 await expect(page.getByRole('tab',{name:/第2天/})).toBeVisible();await page.getByRole('button',{name:'添加活动',exact:true}).click();await page.getByLabel('活动名称').fill('新日期上的离线活动');await page.getByLabel('所在日').selectOption({label:'第2天 · 2026-11-11'});await page.getByRole('dialog').getByRole('button',{name:'完成',exact:true}).click();await page.getByRole('tab',{name:/第2天/}).click();await expect(page.locator('h3',{hasText:'新日期上的离线活动'})).toBeVisible();
 await context.setOffline(false);await expect(page.locator('.sync-status.synced')).toBeVisible();const trips=(await readApi(page,'api/trips')).data.trips;const snap=(await readApi(page,`api/trips/${trips[0].id}`)).data;const act=snap.objects.find(o=>o.kind==='activity');expect(snap.objects.find(o=>o.id===act.payload.dayId).payload.date).toBe('2026-11-11');
});
async function cleanup(page){try{const r=await readApi(page,'api/trips');if(r.status===200)for(const t of r.data.trips)await readApi(page,`api/trips/${t.id}/leave`,'POST',{confirmPurge:true});}catch{}}
test.afterEach(async({page})=>{await cleanup(page);});

test('iOS WebKit touch layout, real editor and shared feedback settings',async()=>{
 const browser=await webkit.launch({headless:true,channel:'',ignoreDefaultArgs:[]});const context=await browser.newContext({...devices['iPhone 15'],baseURL:process.env.E2E_URL||'http://127.0.0.1:4177/'});const page=await context.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));
 try{
 await register(page,'iOS验收');await createTrip(page,'iOS旅程');await addActivity(page,'手机编辑活动');await expect(page.getByRole('navigation',{name:'手机主导航'})).toBeVisible();
 await page.getByRole('navigation',{name:'手机主导航'}).getByRole('button',{name:'设置',exact:true}).click();await page.getByLabel('轻提示音',{exact:true}).check();await expect(page.getByLabel('轻提示音',{exact:true})).toBeChecked();await page.getByLabel('减少动态效果').selectOption('true');
 await page.screenshot({path:'../.local/evidence/ios-settings.png',fullPage:true,scale:'css'});await page.getByRole('navigation',{name:'手机主导航'}).getByRole('button',{name:'行程',exact:true}).click();await page.locator('.activity-card').getByRole('button',{name:'编辑',exact:true}).click();await page.getByLabel('活动名称').fill('iOS修改完成');await page.getByRole('dialog').getByRole('button',{name:'完成',exact:true}).click();await expect(page.locator('h3',{hasText:'iOS修改完成'})).toBeVisible();await expect(page.locator('.sync-status.synced')).toBeVisible();await expect(page.getByRole('navigation',{name:'手机主导航'}).getByRole('button',{name:'费用',exact:true})).toBeVisible();await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));await page.screenshot({path:'../.local/evidence/ios-itinerary.png',fullPage:true,scale:'css'});expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBeTruthy();expect(errors).toEqual([]);
 }finally{await cleanup(page);await context.close();await browser.close();}
});


test('stock Android Chrome touch feedback and small screen editor',async({browser})=>{
 const context=await browser.newContext({...devices['Pixel 7'],baseURL:process.env.E2E_URL||'http://127.0.0.1:4177/'});const page=await context.newPage();
 try{
 await register(page,'Android验收');await createTrip(page,'Android旅程');await addActivity(page,'触屏行程');
 await page.getByRole('navigation',{name:'手机主导航'}).getByRole('button',{name:'设置',exact:true}).click();
 await expect(page.getByLabel('触感反馈',{exact:true})).toBeChecked();await page.getByLabel('触感反馈',{exact:true}).uncheck();await page.getByLabel('轻提示音',{exact:true}).check();
 expect(await page.evaluate(()=>JSON.parse(localStorage.getItem('journey.appearance')).interactionHaptics)).toBe(false);
 await page.getByLabel('减少透明效果').selectOption('true');await expect(page.locator('html')).toHaveAttribute('data-transparency','true');
 await page.screenshot({path:'../.local/evidence/android-settings.png',fullPage:true,scale:'css'});expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBeTruthy();
 }finally{await cleanup(page);await context.close();}
});


test('creation requires destination and dates and uses destination timezone regardless of device',async({browser})=>{
 const context=await browser.newContext({timezoneId:'America/Los_Angeles',baseURL:process.env.E2E_URL||'http://127.0.0.1:4177/',viewport:{width:1440,height:900}});const page=await context.newPage();
 try{
 await register(page,'课程甲');
 const user=(await readApi(page,'api/session')).data.user;const draftKey=`journey.form:${user.id}:createTrip`;
 await page.evaluate(({draftKey})=>localStorage.setItem(draftKey,JSON.stringify({name:'保存过的行程',destination:'纽约',teamMode:'equal',startDate:'2027-03-13',dayCount:'3',currency:'CNY',timezone:'America/New_York'})),{draftKey});
 await page.getByRole('button',{name:'创建旅程',exact:true}).click();await expect(page.getByLabel('旅程名称')).toHaveValue('保存过的行程');await expect(page.getByLabel('结束日期')).toHaveValue('2027-03-15');await page.getByText('更多设置',{exact:true}).click();await expect(page.getByLabel('旅程时区')).toHaveValue('America/New_York');await closeDialog(page);
 await page.evaluate(key=>localStorage.removeItem(key),draftKey);await page.getByRole('button',{name:'创建旅程',exact:true}).click();
 const dialog=page.getByRole('dialog');await page.getByLabel('旅程名称').fill('南京目的地时区');await page.getByRole('radio',{name:'平等团队',exact:true}).check();
 await expect(page.getByLabel('目的地',{exact:true})).toBeVisible();await expect(page.getByLabel('出发日期',{exact:true})).toBeVisible();await expect(page.getByLabel('结束日期',{exact:true})).toBeVisible();await expect(page.getByLabel('旅程时区',{exact:true})).not.toBeVisible();
 await dialog.getByRole('button',{name:'创建旅程',exact:true}).click();expect(await page.getByLabel('目的地',{exact:true}).evaluate(el=>el.validity.valueMissing)).toBe(true);await expect(dialog).toBeVisible();
 await page.getByLabel('目的地',{exact:true}).fill('南京');await page.getByLabel('出发日期').fill('2027-03-13');await page.getByLabel('结束日期').fill('2027-03-12');expect(await page.getByLabel('结束日期').evaluate(el=>el.validity.rangeUnderflow)).toBe(true);await dialog.getByRole('button',{name:'创建旅程',exact:true}).click();await expect(dialog).toBeVisible();
 await page.getByLabel('结束日期').fill('2027-03-15');await page.getByText('更多设置',{exact:true}).click();await expect(page.getByLabel('旅程时区')).toHaveValue('destination');await expect(page.getByLabel('旅程时区').locator('option:checked')).toHaveText(/目的地当地.*北京/);await page.getByText('更多设置',{exact:true}).click();
 await page.screenshot({path:'../.local/evidence/create-trip-desktop.png',fullPage:true,scale:'css'});
 await page.setViewportSize({width:390,height:844});await page.screenshot({path:'../.local/evidence/create-trip-mobile.png',fullPage:true,scale:'css'});expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBeTruthy();
 await dialog.getByRole('button',{name:'创建旅程',exact:true}).click();await expect(dialog).not.toBeVisible();const list=(await readApi(page,'api/trips')).data.trips;const trip=list.find(t=>t.name==='南京目的地时区');expect(trip.timezone).toBe('Asia/Shanghai');expect(trip.destination).toBe('南京');expect(trip.startDate).toBe('2027-03-13');expect(trip.dayCount).toBe(3);
 const snapshot=(await readApi(page,`api/trips/${trip.id}`)).data;expect(snapshot.objects.filter(o=>o.kind==='day').map(o=>o.payload.date).sort()).toEqual(['2027-03-13','2027-03-14','2027-03-15']);
 }finally{await cleanup(page);await context.close();}
});
