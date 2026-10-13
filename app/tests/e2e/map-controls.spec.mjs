import {test,expect} from '@playwright/test';
import {fileURLToPath} from 'node:url';
import {mkdirSync} from 'node:fs';
import {resolve} from 'node:path';
import {createApp,shutdownServer} from '../../server/index.mjs';
import {launchWebKit} from '../../scripts/browser-runtime.mjs';

let app,server,base;
const password='JourneyMapControls2026!';
const suffix=()=>Date.now().toString(36)+Math.random().toString(36).slice(2,7);

test.beforeAll(async()=>{
 mkdirSync(resolve(process.cwd(),'../.local/evidence'),{recursive:true});
 app=createApp({distPath:fileURLToPath(new URL('../../dist/',import.meta.url)),databasePath:':memory:',securityPath:':memory:',config:{amapKey:''}});
 server=await new Promise(resolve=>{const listener=app.listen(0,'127.0.0.1',()=>resolve(listener))});
 base=`http://127.0.0.1:${server.address().port}`;app.locals.config.appOrigin=base;
});
test.afterAll(async()=>{if(server)await shutdownServer(server,app)});

async function register(page){
 await page.goto(base);await page.getByRole('button',{name:'创建账号',exact:true}).click();
 await page.getByLabel('手机号或邮箱').fill(`map-controls-${suffix()}@example.test`);
 await page.getByLabel('你的称呼').fill('地图控件验收');await page.getByLabel('密码',{exact:true}).fill(password);
 await page.getByLabel('确认密码',{exact:true}).fill(password);await page.getByRole('button',{name:'创建账号并继续'}).click();
 await expect(page.getByRole('button',{name:'创建旅程',exact:true})).toBeVisible();
}
async function createTrip(page){
 await page.getByRole('button',{name:'创建旅程',exact:true}).click();await page.getByLabel('旅程名称').fill('地图控件验收旅程');
 await page.getByLabel('目的地',{exact:true}).fill('南京');await page.getByLabel('出发日期',{exact:true}).fill('2026-11-01');
 await page.getByLabel('旅程时区',{exact:true}).selectOption('Asia/Shanghai');await page.getByLabel('结束日期',{exact:true}).fill('2026-11-03');
 await page.getByRole('radio',{name:'平等团队',exact:true}).check();await page.getByRole('dialog').getByRole('button',{name:'创建旅程'}).click();
 await expect(page.getByRole('tab',{name:/第1天/})).toBeVisible();
}
async function openMap(page,{mobile=false}={}){
 await page.getByRole('navigation',{name:mobile?'手机主导航':'主导航',exact:true}).getByRole('button',{name:'地图',exact:true}).click();
 await expect(page.locator('.map-shell')).toBeVisible();
}
async function screenshot(page,name){
 await page.screenshot({path:`../.local/evidence/map-controls-${name}.png`,fullPage:true,animations:'disabled',scale:'css'});
}
async function checkNoOverflow(page){
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
}

test('map controls align, fit the viewport, and return home',async({page})=>{
 await page.setViewportSize({width:1440,height:900});await register(page);await createTrip(page);await openMap(page);
 await expect(page.locator('.trip-title')).toHaveCount(0);
 await expect(page.locator('.map-home')).toBeVisible();await expect(page.locator('.map-load-error')).toContainText('地图暂时无法载入');
 const geometry=await page.evaluate(()=>{
  const rect=selector=>{const r=document.querySelector(selector).getBoundingClientRect();return{x:r.x,y:r.y,width:r.width,height:r.height}};
  return{upper:rect('.map-upper-controls'),panel:rect('.map-panel.mode-browse:not(.expanded)'),headerRight:rect('.map-shell .header-right')};
 });
 expect(geometry.upper.width).toBeCloseTo(350,0);expect(geometry.upper.height).toBeCloseTo(56,0);
 expect(geometry.panel.width).toBeCloseTo(350,0);expect(geometry.panel.height).toBeCloseTo(56,0);
 expect(Math.abs((geometry.headerRight.x+geometry.headerRight.width/2)-(geometry.upper.x+geometry.upper.width/2))).toBeLessThan(2);
 await screenshot(page,'desktop');
 await page.locator('.map-home').click();await expect(page.getByRole('heading',{name:'我的旅程',exact:true})).toBeVisible();
 await expect(page.getByRole('button',{name:/继续旅程/})).toContainText('地图控件验收旅程');
});

test('date list supports pointer and keyboard selection, escape, and outside close',async({page})=>{
 await register(page);await createTrip(page);await openMap(page);
 const dateButton=page.getByRole('button',{name:'地图路线日期',exact:true});
 await expect(dateButton).toHaveAttribute('aria-haspopup','listbox');await expect(dateButton).toHaveAttribute('aria-expanded','false');
 await dateButton.click();const list=page.getByRole('listbox',{name:'地图路线日期',exact:true});
 await expect(list).toBeVisible();await expect(dateButton).toHaveAttribute('aria-expanded','true');
 const options=list.getByRole('option');expect(await options.count()).toBeGreaterThanOrEqual(4);
 await page.keyboard.press('Home');await page.keyboard.press('ArrowDown');await page.keyboard.press('ArrowUp');
 await page.keyboard.press('End');await page.keyboard.press('Enter');
 await expect(dateButton).toContainText(/第3天路线/);await expect(list).toHaveCount(0);
 await dateButton.click();await expect(list).toBeVisible();await page.keyboard.press('Escape');
 await expect(list).toHaveCount(0);await expect(dateButton).toHaveAttribute('aria-expanded','false');
 await dateButton.click();await expect(list).toBeVisible();await page.locator('.map-canvas').click({position:{x:12,y:12}});
 await expect(list).toHaveCount(0);await expect(dateButton).toHaveAttribute('aria-expanded','false');
});

test('favorite filters cancel and apply, and search input survives rapid panel toggles',async({page})=>{
 await page.setViewportSize({width:1440,height:900});await register(page);await createTrip(page);await openMap(page);
 const filterButton=page.getByRole('button',{name:'筛选收藏',exact:true});
 await expect(filterButton).toHaveAttribute('aria-expanded','false');await filterButton.click();
 const filterPanel=page.locator('.map-panel.mode-filter');await expect(filterPanel).toBeVisible();await expect(filterButton).toHaveAttribute('aria-expanded','true');
 const cancelFilter=filterPanel.getByRole('button',{name:'取消',exact:true});await expect(cancelFilter).toBeFocused();
 await page.keyboard.press('Escape');await expect(filterPanel).toHaveCount(0);await expect(filterButton).toBeFocused();
 await filterButton.click();await expect(filterPanel).toBeVisible();await expect(cancelFilter).toBeFocused();
 const category=filterPanel.locator('fieldset').filter({has:page.getByText('类别',{exact:true})});
 const arrangement=filterPanel.locator('fieldset').filter({has:page.getByText('安排状态',{exact:true})});
 await expect(category).toBeVisible();await expect(arrangement).toBeVisible();
 await expect(category.locator('.selection-indicator')).toBeVisible();await expect(arrangement.locator('.selection-indicator')).toBeVisible();
 const categoryOption=category.getByRole('button',{name:'景点',exact:true});
 await categoryOption.click();await expect(categoryOption).toHaveAttribute('aria-pressed','true');
 await filterPanel.getByRole('button',{name:'取消',exact:true}).click();await expect(filterPanel).toHaveCount(0);
 await filterButton.click();const reopened=page.locator('.map-panel.mode-filter');await expect(reopened).toBeVisible();
 const reopenedCategory=reopened.locator('fieldset').filter({has:page.getByText('类别',{exact:true})});
 await expect(reopenedCategory.getByRole('button',{name:'全部',exact:true})).toHaveAttribute('aria-pressed','true');
 await expect(reopenedCategory.getByRole('button',{name:'景点',exact:true})).toHaveAttribute('aria-pressed','false');
 const statusOption=reopened.locator('fieldset').filter({has:page.getByText('安排状态',{exact:true})}).getByRole('button',{name:'未安排',exact:true});
 await statusOption.click();await reopened.getByRole('button',{name:'完成',exact:true}).click();await expect(reopened).toHaveCount(0);
 await filterButton.click();const applied=page.locator('.map-panel.mode-filter');await expect(applied).toBeVisible();
 await expect(applied.locator('fieldset').filter({has:page.getByText('安排状态',{exact:true})}).getByRole('button',{name:'未安排',exact:true})).toHaveAttribute('aria-pressed','true');
 await applied.getByRole('button',{name:'取消',exact:true}).click();

 const search=page.getByRole('textbox',{name:'搜索地点',exact:true});
 await search.evaluate(el=>{window.__mapSearchInput=el});
 const animation=await page.evaluate(async()=>{
  const panel=document.querySelector('.map-panel'),input=document.querySelector('[aria-label="搜索地点"]'),heights=[];const start=performance.now();
  input.focus();while(performance.now()-start<320){await new Promise(requestAnimationFrame);heights.push(panel.getBoundingClientRect().height)}return heights;
 });
 expect(animation.length).toBeGreaterThan(2);expect(new Set(animation.map(Math.round)).size).toBeGreaterThan(2);
 await expect(search).toBeFocused();await expect.poll(()=>search.evaluate(el=>el===window.__mapSearchInput)).toBe(true);
 await page.getByRole('button',{name:'取消',exact:true}).click();await expect(search).not.toBeFocused();
 const favoriteAnimation=await page.evaluate(async()=>{
  const panel=document.querySelector('.map-panel'),toggle=document.querySelector('[aria-label="查看收藏列表"]'),heights=[];const start=performance.now();
  toggle.click();while(performance.now()-start<320){await new Promise(requestAnimationFrame);heights.push(panel.getBoundingClientRect().height)}return heights;
 });
 expect(favoriteAnimation.length).toBeGreaterThan(2);expect(new Set(favoriteAnimation.map(Math.round)).size).toBeGreaterThan(2);
 await expect(page.getByRole('heading',{name:'共享收藏',exact:true})).toBeVisible();
 await expect.poll(()=>search.evaluate(el=>el===window.__mapSearchInput)).toBe(true);
});

for(const width of [390,320])test(`map controls fit ${width}px mobile viewport and reduce motion cleanly`,async({page})=>{
 await page.setViewportSize({width,height:844});await register(page);await createTrip(page);await openMap(page,{mobile:true});
 await checkNoOverflow(page);
 const bounds=await page.evaluate(()=>['.map-upper-controls','.map-panel'].map(selector=>{const r=document.querySelector(selector).getBoundingClientRect();return{left:r.left,right:r.right,width:r.width,height:r.height}}));
 for(const box of bounds){expect(box.left).toBeGreaterThanOrEqual(0);expect(box.right).toBeLessThanOrEqual(width);expect(box.width).toBeGreaterThan(0);expect(box.height).toBeCloseTo(56,0)}
 await screenshot(page,`mobile-${width}`);
 await expect(page.locator('.map-shell .header-right')).toBeVisible();
 await page.emulateMedia({reducedMotion:'reduce'});
 const transition=await page.locator('.map-panel').evaluate(el=>getComputedStyle(el).transitionDuration);
 expect(transition.split(',').every(value=>parseFloat(value.trim())===0)).toBe(true);
 await page.getByRole('button',{name:'筛选收藏',exact:true}).click();await expect(page.locator('.map-panel.mode-filter')).toBeVisible();
 expect(await page.locator('.map-panel').evaluate(el=>el.getAnimations().length)).toBe(0);
});

test('detail actions stay visible and 320px manual edit returns to the selected place',async({page})=>{
 await page.setViewportSize({width:320,height:844});await register(page);await createTrip(page);await openMap(page,{mobile:true});
 const search=page.getByRole('textbox',{name:'搜索地点',exact:true});await search.fill('手动地点验收');
 await page.getByRole('button',{name:'手动填写',exact:true}).click();
 const name=page.getByLabel('名称',{exact:true});await name.focus();
 await page.evaluate(()=>{
  const viewport=window.visualViewport;window.__mapOriginalVisualHeight=Object.getOwnPropertyDescriptor(viewport,'height');
  Object.defineProperty(viewport,'height',{configurable:true,get:()=>400});viewport.dispatchEvent(new Event('resize'));
 });
 await expect(page.locator('.journey-map')).toHaveClass(/map-keyboard-open/);
 await expect(page.locator('.map-shell .bottom-nav')).toBeHidden();
 expect(await page.locator('.map-panel').evaluate(el=>el.getBoundingClientRect().bottom)).toBeLessThanOrEqual(400);
 await name.fill('玄武湖');await page.getByLabel('地址',{exact:true}).fill('南京市玄武区');
 const finish=page.getByRole('button',{name:'完成',exact:true});await finish.scrollIntoViewIfNeeded();
 await page.getByRole('button',{name:'完成',exact:true}).click();
 await page.evaluate(()=>{
  const viewport=window.visualViewport,descriptor=window.__mapOriginalVisualHeight;
  if(descriptor)Object.defineProperty(viewport,'height',descriptor);else delete viewport.height;
  delete window.__mapOriginalVisualHeight;viewport.dispatchEvent(new Event('resize'));
 });
 await expect(page.locator('.journey-map')).not.toHaveClass(/map-keyboard-open/);await expect(page.locator('.map-shell .bottom-nav')).toBeVisible();
 await expect(page.getByRole('heading',{name:'玄武湖',exact:true})).toBeVisible();
 const details=page.locator('.map-details-toggle');await expect(details).toBeVisible();await expect(details).toHaveAttribute('aria-expanded','false');await expect(details).toHaveText(/更多操作/);
 await details.click();await expect(details).toHaveAttribute('aria-expanded','true');
 await page.getByRole('button',{name:'编辑地点资料',exact:true}).click();
 await expect(page.getByRole('heading',{name:'编辑地点',exact:true})).toBeVisible();
 await expect(page.getByLabel('名称',{exact:true})).toHaveValue('玄武湖');await expect(page.getByLabel('地址',{exact:true})).toHaveValue('南京市玄武区');
 await page.getByRole('button',{name:'取消',exact:true}).click();
 await expect(page.getByRole('heading',{name:'玄武湖',exact:true})).toBeVisible();
 await expect(details).toBeVisible();await expect(details).toHaveAttribute('aria-expanded','false');await expect(details).toHaveText(/更多操作/);
 await screenshot(page,'detail-mobile-320');
});

test('filter apply remains clickable at 800x500 and filter content scrolls on narrow mobile',async({page})=>{
 await page.setViewportSize({width:800,height:500});await register(page);await createTrip(page);await openMap(page);
 await page.getByRole('button',{name:'筛选收藏',exact:true}).click();const desktopFilter=page.locator('.map-panel.mode-filter');
 const finish=desktopFilter.getByRole('button',{name:'完成',exact:true});await finish.scrollIntoViewIfNeeded();await finish.click();await expect(desktopFilter).toHaveCount(0);

 await page.setViewportSize({width:320,height:500});await page.getByRole('navigation',{name:'手机主导航',exact:true}).getByRole('button',{name:'地图',exact:true}).click();
 await page.getByRole('button',{name:'筛选收藏',exact:true}).click();const mobileFilter=page.locator('.map-panel.mode-filter');await expect(mobileFilter).toBeVisible();
 const scrollable=await mobileFilter.evaluate(panel=>[panel,...panel.querySelectorAll('*')].find(el=>el.scrollHeight>el.clientHeight+1&&getComputedStyle(el).overflowY!=='visible'));
 expect(scrollable).toBeTruthy();
 const before=await mobileFilter.evaluate(panel=>{const el=[panel,...panel.querySelectorAll('*')].find(node=>node.scrollHeight>node.clientHeight+1&&getComputedStyle(node).overflowY!=='visible');return el.scrollTop});
 await mobileFilter.getByRole('button',{name:'完成',exact:true}).scrollIntoViewIfNeeded();
 const after=await mobileFilter.evaluate(panel=>{const el=[panel,...panel.querySelectorAll('*')].find(node=>node.scrollHeight>node.clientHeight+1&&getComputedStyle(node).overflowY!=='visible');return el.scrollTop});
 expect(after).toBeGreaterThan(before);
});

test('WebKit 320px smoke covers route picker keyboard and manual detail actions',async()=>{
 const browser=await launchWebKit();const context=await browser.newContext({viewport:{width:320,height:740}});const page=await context.newPage();
 try{
  await register(page);await createTrip(page);await openMap(page,{mobile:true});
  const dateButton=page.getByRole('button',{name:'地图路线日期',exact:true});await dateButton.click();
  await page.keyboard.press('ArrowDown');await page.keyboard.press('Enter');await expect(dateButton).toContainText(/第1天路线/);
  await dateButton.click();await page.keyboard.press('Escape');await expect(page.getByRole('listbox',{name:'地图路线日期',exact:true})).toHaveCount(0);
  await page.getByRole('textbox',{name:'搜索地点',exact:true}).fill('WebKit手动地点');
  await page.getByRole('button',{name:'手动填写',exact:true}).click();await page.getByLabel('名称',{exact:true}).fill('WebKit地点');
  await page.getByLabel('地址',{exact:true}).fill('南京');await page.getByRole('button',{name:'完成',exact:true}).click();
  await expect(page.getByRole('heading',{name:'WebKit地点',exact:true})).toBeVisible();
  const details=page.locator('.map-details-toggle');await expect(details).toHaveText(/更多操作/);await details.click();
  await page.getByRole('button',{name:'编辑地点资料',exact:true}).click();await page.getByRole('button',{name:'取消',exact:true}).click();
  await expect(page.getByRole('heading',{name:'WebKit地点',exact:true})).toBeVisible();
 }finally{await context.close();await browser.close()}
});
