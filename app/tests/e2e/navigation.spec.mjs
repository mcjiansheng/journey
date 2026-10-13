import {test,expect} from '@playwright/test';
import {fileURLToPath} from 'node:url';
import {mkdirSync,writeFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {createApp,shutdownServer} from '../../server/index.mjs';
import {launchWebKit} from '../../scripts/browser-runtime.mjs';

let app,server,base;
const password='JourneyNavigation2026!';
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
 await page.getByLabel('手机号或邮箱').fill(`navigation-${suffix()}@example.test`);
 await page.getByLabel('你的称呼').fill('导航验收');await page.getByLabel('密码',{exact:true}).fill(password);
 await page.getByLabel('确认密码',{exact:true}).fill(password);await page.getByRole('button',{name:'创建账号并继续'}).click();
 await expect(page.getByRole('button',{name:'创建旅程',exact:true})).toBeVisible();
}
async function createTrip(page,name='导航动效验收'){
 await page.getByRole('button',{name:'创建旅程',exact:true}).click();await page.getByLabel('旅程名称').fill(name);
 await page.getByLabel('目的地',{exact:true}).fill('南京');await page.getByLabel('出发日期',{exact:true}).fill('2026-11-01');
 await page.getByLabel('旅程时区',{exact:true}).selectOption('Asia/Shanghai');
 await page.getByLabel('结束日期',{exact:true}).fill('2026-11-03');await page.getByRole('radio',{name:'平等团队',exact:true}).check();
 await page.getByRole('dialog').getByRole('button',{name:'创建旅程'}).click();
 await expect(page.getByRole('tab',{name:/第1天/})).toBeVisible();
}
async function addActivity(page,name){
 await page.getByRole('button',{name:'添加活动',exact:true}).first().click();await page.getByLabel('活动名称').fill(name);
 await page.getByRole('dialog').getByRole('button',{name:'完成',exact:true}).click();
 await expect(page.getByRole('heading',{name,exact:true})).toBeVisible();await expect(page.locator('.sync-status.synced')).toBeVisible();
}
async function screenshot(page,name){await page.screenshot({path:`../.local/evidence/navigation-${name}.png`,fullPage:true,animations:'disabled',scale:'css'})}
async function noOverflow(page){expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true)}
async function sampleSidebarMotion(page,label){
 return page.evaluate(async label=>{
  const sidebar=document.querySelector('.sidebar');
  const measure=()=>{
   const r=sidebar.getBoundingClientRect(),t=document.querySelector('.trip-title>span')?.getBoundingClientRect(),icons=[...sidebar.querySelectorAll('nav button svg')].map(svg=>{const box=svg.getBoundingClientRect();return{width:box.width,height:box.height}}),buttons=[...sidebar.querySelectorAll('nav button')].map(button=>button.getBoundingClientRect());
   const extras=[...sidebar.querySelectorAll('.brand,.back-home,.sidebar-foot')].filter(element=>{const style=getComputedStyle(element);return style.display!=='none'&&style.visibility!=='hidden'&&Number(style.opacity)>.01}).map(element=>{const box=element.getBoundingClientRect();return [...buttons].some(button=>box.left<button.right&&box.right>button.left&&box.top<button.bottom&&box.bottom>button.top)});
   return{width:r.width,top:r.top,height:r.height,center:r.top+r.height/2,titleX:t?.x??null,titleY:t?.y??null,icons,visibleExtrasOverlap:extras.some(Boolean)};
  };
  const before=measure(),button=document.querySelector(`nav[aria-label="主导航"] button[aria-label="${label}"]`);if(!button)throw new Error(`Missing navigation button: ${label}`);button.click();
  const frames=[],started=performance.now();while(performance.now()-started<520){await new Promise(requestAnimationFrame);frames.push(measure())}
  return{before,frames,after:measure()};
 },label);
}
function expectSidebarFramesStable(sample,title){
 expect(sample.frames.length).toBeGreaterThan(0);
 for(const frame of sample.frames){
  expect(frame.icons.every(icon=>Math.abs(icon.width-20)<1&&Math.abs(icon.height-20)<1)).toBe(true);
  if(frame.titleX!==null){expect(Math.abs(frame.titleX-title.x)).toBeLessThan(2);expect(Math.abs(frame.titleY-title.y)).toBeLessThan(2)}
  expect(frame.visibleExtrasOverlap).toBe(false);
 }
}
async function sampleIndicator(page,selector,clickSelector){
 return page.evaluate(async({selector,click})=>{
  const indicator=document.querySelector(selector);if(!indicator)throw new Error(`Missing selection indicator: ${selector}`);
  const position=()=>{const r=indicator.getBoundingClientRect();return{x:r.left,y:r.top,width:r.width,height:r.height}};
  const before=position(),beforeSelected=trackSelected(),target=document.querySelector(click);if(!target)throw new Error(`Missing click target: ${click}`);target.click();const frames=[],started=performance.now();
  while(performance.now()-started<520){await new Promise(requestAnimationFrame);frames.push(position())}
  return{before,frames,after:position(),beforeSelected,afterSelected:trackSelected()};
  function trackSelected(){return document.querySelector(`${selector.split(' .selection-indicator')[0]} button[aria-selected="true"] strong`)?.textContent||document.querySelector(`${selector.split(' .selection-indicator')[0]} button[aria-current="page"]`)?.getAttribute('aria-label')}
 },{selector,click:clickSelector});
}
function expectIndicatorTravels(sample,axis='x'){
 const {before,frames,after}=sample;expect(Math.abs(after[axis]-before[axis]),JSON.stringify({before,after,beforeSelected:sample.beforeSelected,afterSelected:sample.afterSelected})).toBeGreaterThan(10);
 expect(frames.some(f=>f[axis]>Math.min(before[axis],after[axis])+2&&f[axis]<Math.max(before[axis],after[axis])-2)).toBe(true);
}

test('navigation indicator moves across pages and rapid reversals return home cleanly',async({page})=>{
 await page.setViewportSize({width:1440,height:900});await register(page);await createTrip(page);
 const nav=page.getByRole('navigation',{name:'主导航',exact:true});
 expectIndicatorTravels(await sampleIndicator(page,'nav[aria-label="主导航"] .selection-indicator','nav[aria-label="主导航"] button[aria-label="费用"]'),'y');
 await screenshot(page,'navigation-ledger');
 const result=await page.evaluate(async()=>{
  const buttons=[...document.querySelectorAll('nav[aria-label="主导航"] button')];
  const click=label=>buttons.find(button=>button.getAttribute('aria-label')===label).click();
  click('地图');await new Promise(r=>setTimeout(r,75));click('行程');await new Promise(r=>setTimeout(r,75));click('设置');await new Promise(r=>setTimeout(r,75));click('费用');await new Promise(r=>setTimeout(r,75));click('行程');
  await new Promise(resolve=>setTimeout(resolve,520));return document.querySelector('nav[aria-label="主导航"] button[aria-current="page"]')?.getAttribute('aria-label');
 });
 expect(result).toBe('行程');await expect(page.getByRole('heading',{name:'行程',exact:true})).toBeVisible();
 await page.getByRole('button',{name:'我的旅程',exact:true}).click();await expect(page.getByRole('heading',{name:'我的旅程',exact:true})).toBeVisible();
 await expect(page.getByRole('button',{name:/继续旅程/})).toContainText('导航动效验收');await screenshot(page,'home');
});

test('map mode centers the compact sidebar, hides its trip title, and keeps navigation icons stable',async({page})=>{
 await page.setViewportSize({width:1440,height:900});await register(page);await createTrip(page);
 await screenshot(page,'itinerary-desktop');
 const title=page.locator('.trip-title>span');const before=await page.evaluate(()=>{
  const r=document.querySelector('.trip-title>span').getBoundingClientRect();return{x:r.x,y:r.y,width:r.width,height:r.height};
 });
 const opening=await sampleSidebarMotion(page,'地图');expectSidebarFramesStable(opening,before);
 await expect(page.locator('.app-shell')).toHaveClass(/map-shell/);await expect.poll(()=>page.locator('.sidebar').evaluate(el=>el.getBoundingClientRect().width)).toBeLessThan(100);
 await screenshot(page,'map-desktop');
 const compact={width:opening.after.width,top:opening.after.top,height:opening.after.height,center:opening.after.center,title:{x:opening.after.titleX,y:opening.after.titleY},icons:opening.after.icons};
 expect(compact.width).toBeLessThan(100);expect(Math.abs(compact.center-450)).toBeLessThan(3);
 expect(compact.icons.every(icon=>Math.abs(icon.width-20)<1&&Math.abs(icon.height-20)<1)).toBe(true);
 expect(compact.title.x).toBeNull();expect(compact.title.y).toBeNull();await expect(title).toHaveCount(0);
 const closing=await sampleSidebarMotion(page,'行程');expectSidebarFramesStable(closing,before);
 expect(closing.frames.some(frame=>frame.width>compact.width+5&&frame.width<Math.max(...closing.frames.map(x=>x.width))-5)).toBe(true);
 await expect(page.locator('.app-shell')).not.toHaveClass(/map-shell/);await screenshot(page,'map-return');
 writeFileSync(resolve(process.cwd(),'../.local/evidence/navigation-frames.json'),JSON.stringify({opening,closing},null,2));
 const transparency=await page.evaluate(()=>{
  document.documentElement.dataset.transparency='true';const result=['nav[aria-label="主导航"]','.day-tabs'].map(selector=>{
   const track=document.querySelector(selector),button=track.querySelector('button.selected'),indicator=track.querySelector('.selection-indicator'),buttonStyle=getComputedStyle(button),style=getComputedStyle(indicator),rect=indicator.getBoundingClientRect();
   return{selector,buttonBackground:buttonStyle.backgroundColor,indicatorVisible:style.display!=='none'&&Number(style.opacity)>0&&rect.width>0&&rect.height>0};
  });delete document.documentElement.dataset.transparency;return result;
 });
 for(const track of transparency){expect(track.buttonBackground,track.selector).toBe('rgba(0, 0, 0, 0)');expect(track.indicatorVisible,track.selector).toBe(true)}
 await page.setViewportSize({width:800,height:500});
 await expect.poll(()=>page.evaluate(()=>{
  const sidebar=document.querySelector('.sidebar'),settings=sidebar.querySelector('nav button[aria-label="设置"]').getBoundingClientRect(),profile=sidebar.querySelector('.profile-button').getBoundingClientRect();
  return settings.bottom<=profile.top;
 })).toBe(true);
});

test('day selection indicator travels with its content and rapid reverse switches settle correctly',async({page})=>{
 await page.setViewportSize({width:1440,height:900});await register(page);await createTrip(page);
 await addActivity(page,'第一天活动');await page.getByRole('tab',{name:/第2天/}).click();await addActivity(page,'第二天活动');
 await page.getByRole('tab',{name:/第3天/}).click();await addActivity(page,'第三天活动');
 await page.getByRole('tab',{name:/第1天/}).click();const firstDay=page.getByRole('tab',{name:/第1天/});await expect(firstDay).toHaveAttribute('aria-selected','true');await expect(page.getByRole('heading',{name:'第一天活动',exact:true})).toBeVisible();
 await expect.poll(()=>page.evaluate(()=>{
  const indicator=document.querySelector('.day-tabs .selection-indicator').getBoundingClientRect(),selected=document.querySelector('.day-tabs button[aria-selected="true"]').getBoundingClientRect();
  return Math.abs(indicator.x-selected.x);
 })).toBeLessThan(1);
 expectIndicatorTravels(await sampleIndicator(page,'.day-tabs .selection-indicator','.day-tabs [role="tab"]:nth-of-type(3)'));
 await expect(page.getByRole('heading',{name:'第三天活动',exact:true})).toBeVisible();
 const content=await page.evaluate(async()=>{
  const target=document.querySelector('.day-content')||document.querySelector('.activity-list');const positions=[];const start=performance.now();
  document.querySelectorAll('.day-tabs [role="tab"]')[1].click();
  while(performance.now()-start<520){await new Promise(requestAnimationFrame);positions.push(target.getBoundingClientRect().left)}
  return{positions,selected:document.querySelector('.day-tabs [role="tab"][aria-selected="true"] strong')?.textContent};
 });
 expect(content.selected).toMatch('第2天');expect(content.positions.some(left=>Math.abs(left-content.positions[0])>0.1)).toBe(true);
 const final=await page.evaluate(async()=>{
  const tabs=[...document.querySelectorAll('.day-tabs [role="tab"]')];
  tabs[0].click();await new Promise(r=>setTimeout(r,65));tabs[2].click();await new Promise(r=>setTimeout(r,65));tabs[1].click();
  await new Promise(r=>setTimeout(r,520));return document.querySelector('.day-tabs [role="tab"][aria-selected="true"] strong')?.textContent;
 });
 expect(final).toMatch('第2天');await expect(page.getByRole('heading',{name:'第二天活动',exact:true})).toBeVisible();await screenshot(page,'day-two');
});

test('mobile widths, reduced motion, and WebKit keep navigation reachable',async({page})=>{
 await register(page);await createTrip(page,'窄屏导航验收');
 for(const [width,height] of [[390,844],[320,740]]){
  await page.setViewportSize({width,height});await noOverflow(page);
  await expect(page.getByRole('navigation',{name:'手机主导航'})).toBeVisible();
  await page.getByRole('navigation',{name:'手机主导航'}).getByRole('button',{name:'地图',exact:true}).click();
  await expect(page.locator('.map-shell')).toBeVisible();await noOverflow(page);await screenshot(page,`mobile-${width}`);
  await page.getByRole('navigation',{name:'手机主导航'}).getByRole('button',{name:'行程',exact:true}).click();await expect(page.locator('.map-shell')).toHaveCount(0);
 }
 await page.emulateMedia({reducedMotion:'reduce'});
 await page.getByRole('navigation',{name:'手机主导航'}).getByRole('button',{name:'费用',exact:true}).click();
 await expect(page.locator('nav[aria-label="手机主导航"] button[aria-current="page"]')).toHaveAttribute('aria-label','费用');
 expect(await page.locator('.selection-indicator').evaluateAll(nodes=>nodes.every(node=>{
  const style=getComputedStyle(node);return style.transitionDuration.split(',').every(value=>Number.parseFloat(value)===0)&&style.animationDuration.split(',').every(value=>Number.parseFloat(value)===0);
 }))).toBe(true);
 const browser=await launchWebKit();
 try{
  const context=await browser.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true,deviceScaleFactor:3});const webPage=await context.newPage();
  await register(webPage);await createTrip(webPage,'WebKit导航验收');await noOverflow(webPage);
  await webPage.getByRole('navigation',{name:'手机主导航'}).getByRole('button',{name:'地图',exact:true}).tap();
  await expect(webPage.locator('.map-shell')).toBeVisible();await webPage.screenshot({path:'../.local/evidence/navigation-webkit-map.png',fullPage:true,animations:'disabled',scale:'css'});
  await webPage.getByRole('navigation',{name:'手机主导航'}).getByRole('button',{name:'行程',exact:true}).tap();
  await expect(webPage.getByRole('heading',{name:'行程',exact:true})).toBeVisible();await noOverflow(webPage);await context.close();
 }finally{await browser.close()}
});
