import {test,expect} from '@playwright/test';
import {fileURLToPath} from 'node:url';
import {createApp,shutdownServer} from '../../server/index.mjs';
import {launchWebKit} from '../../scripts/browser-runtime.mjs';

test.setTimeout(90000);
let app,server,base,browser;
test.beforeAll(async()=>{
 app=createApp({distPath:fileURLToPath(new URL('../../dist/',import.meta.url)),databasePath:':memory:',securityPath:':memory:'});
 server=await new Promise(resolve=>{const listener=app.listen(0,'127.0.0.1',()=>resolve(listener))});
 base=`http://127.0.0.1:${server.address().port}`;app.locals.config.appOrigin=base;
 browser=await launchWebKit();
});
test.afterAll(async()=>{if(browser)await browser.close();if(server)await shutdownServer(server,app)});
async function openCreate(page){
 await page.goto(base);await page.getByRole('button',{name:'创建账号',exact:true}).click();
 await page.getByLabel('手机号或邮箱').fill(`team-${crypto.randomUUID()}@example.test`);
 await page.getByLabel('你的称呼').fill('视觉验收');
 await page.getByLabel('密码',{exact:true}).fill('JourneyTeam2026!');
 await page.getByLabel('确认密码',{exact:true}).fill('JourneyTeam2026!');
 await page.getByRole('button',{name:'创建账号并继续'}).click();
 await page.getByRole('button',{name:'创建旅程',exact:true}).click();
}
const radio=(page,mode)=>page.getByRole('radio',{name:mode==='admin'?'管理员团队':'平等团队',exact:true});
async function evidence(page,name){
 await page.screenshot({path:`../.local/evidence/team-mode-${name}.png`,fullPage:true,animations:'disabled',scale:'css'});
 await page.locator('.team-mode').screenshot({path:`../.local/evidence/team-mode-${name}-cards.png`,animations:'disabled',scale:'css'});
}
async function layout(page,stacked){
 const cards=page.locator('.team-mode-face');
 await page.mouse.move(0,0);
 await expect(cards.nth(0)).toHaveCSS('transform','none');await expect(cards.nth(1)).toHaveCSS('transform','none');
 const a=await cards.nth(0).boundingBox(),b=await cards.nth(1).boundingBox();
 if(stacked){expect(Math.abs(a.x-b.x)).toBeLessThan(1);expect(b.y).toBeGreaterThan(a.y+a.height)}
 else{expect(Math.abs(a.y-b.y)).toBeLessThan(1);expect(b.x).toBeGreaterThan(a.x+a.width)}
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
 const bounds=await page.locator('.team-mode').boundingBox();
 for(const rect of [a,b]){expect(rect.x).toBeGreaterThanOrEqual(bounds.x);expect(rect.x+rect.width).toBeLessThanOrEqual(bounds.x+bounds.width+1)}
}

test('creation cards: responsive layout, native keyboard, draft and themes',async()=>{
 const context=await browser.newContext({viewport:{width:1440,height:1000},serviceWorkers:'block'}),page=await context.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));
 try{
  await openCreate(page);await expect(page.getByRole('radiogroup',{name:'团队类型'})).toBeVisible();
  await expect(radio(page,'admin')).toBeChecked();
  await expect(radio(page,'equal')).toHaveAccessibleDescription('成员可通过集体表态删除内容，创建者也可直接删除。 大家都能添加和编辑行程。');
  await expect(page.locator('.team-mode-description')).toHaveCount(2);
  await layout(page,false);await evidence(page,'desktop-light');
  await radio(page,'admin').focus();await page.keyboard.press('ArrowRight');await expect(radio(page,'equal')).toBeChecked();await expect(radio(page,'equal')).toBeFocused();
  await page.keyboard.press('ArrowLeft');await expect(radio(page,'admin')).toBeChecked();
  await page.keyboard.press('Tab');await expect(page.locator('.trip-extra-settings>summary')).toBeFocused();
  await radio(page,'equal').check();await page.getByRole('button',{name:'关闭',exact:true}).click();await page.getByRole('button',{name:'创建旅程',exact:true}).click();await expect(radio(page,'equal')).toBeChecked();
  for(const width of [1024,430,390,360,320]){
   await page.setViewportSize({width,height:1000});await layout(page,width<500);
   if(width===390)await evidence(page,'mobile-light');
  }
  await page.setViewportSize({width:390,height:1000});await page.evaluate(()=>document.documentElement.dataset.theme='dark');await evidence(page,'mobile-dark');
  await page.setViewportSize({width:1440,height:1000});await layout(page,false);await evidence(page,'desktop-dark');
  await page.evaluate(()=>{document.documentElement.dataset.theme='system';document.documentElement.dataset.transparency='true';document.documentElement.dataset.motion='true'});
  await page.emulateMedia({colorScheme:'dark',reducedMotion:'reduce'});
  expect(await page.locator('.team-mode-face').first().evaluate(el=>getComputedStyle(el).backdropFilter)).toBe('none');
  expect(await page.locator('.team-mode-face').first().evaluate(el=>getComputedStyle(el).transitionDuration)).toBe('0s');
  expect(errors).toEqual([]);
 }finally{await context.close()}
});

test('both usages preserve saved mode, pending lock and error rollback',async()=>{
 const context=await browser.newContext({viewport:{width:1440,height:1000},serviceWorkers:'block'}),page=await context.newPage();
 try{
  await openCreate(page);await page.getByLabel('旅程名称').fill('周末出行');
  // Choose a local timezone before typing a destination; this suite needs no map service.
  await page.locator('.trip-extra-settings>summary').click();await page.getByLabel('旅程时区',{exact:true}).selectOption('Asia/Shanghai');
  await page.getByLabel('目的地',{exact:true}).fill('南京');
  await page.getByLabel('出发日期',{exact:true}).fill('2026-11-01');await page.getByLabel('结束日期',{exact:true}).fill('2026-11-02');
  await radio(page,'equal').check();
  let release;const gate=new Promise(resolve=>release=resolve);
  await page.route('**/api/trips',async route=>{if(route.request().method()==='POST')await gate;await route.continue()});
  await page.getByRole('dialog').getByRole('button',{name:'创建旅程',exact:true}).click();
  await expect(radio(page,'admin')).toBeDisabled();await expect(radio(page,'equal')).toBeDisabled();release();
  await expect(page.getByRole('button',{name:'添加活动',exact:true}).first()).toBeVisible();
  await page.getByRole('navigation',{name:'主导航',exact:true}).getByRole('button',{name:'设置',exact:true}).click();await expect(radio(page,'equal')).toBeChecked();
  await layout(page,false);await evidence(page,'settings-desktop');
  let releaseTeam;const teamGate=new Promise(resolve=>releaseTeam=resolve);
  await page.route('**/api/trips/*/team',async route=>{await teamGate;await route.continue()});
  await radio(page,'admin').check();await expect(page.getByRole('radiogroup')).toHaveAttribute('aria-busy','true');await expect(page.getByRole('status').filter({hasText:'正在切换'})).toBeVisible();await expect(radio(page,'equal')).toBeDisabled();releaseTeam();
  await expect(page.getByRole('radiogroup')).toHaveAttribute('aria-busy','false');await expect(radio(page,'admin')).toBeChecked();await page.unroute('**/api/trips/*/team');
  await page.route('**/api/trips/*/team',route=>route.fulfill({status:403,contentType:'application/json',body:JSON.stringify({error:{code:'FORBIDDEN',message:'切换未完成，请重试。'}})}));
  await radio(page,'equal').click();await expect(page.locator('.team-mode [role=alert]')).toContainText('切换未完成');await expect(radio(page,'admin')).toBeChecked();await expect(radio(page,'equal')).toBeEnabled();
  await page.unroute('**/api/trips/*/team');
  await Promise.all([page.waitForResponse(response=>response.url().endsWith('/team')&&response.request().method()==='PATCH'&&response.ok()),radio(page,'equal').click()]);
  await expect(radio(page,'equal')).toBeChecked();await expect(page.locator('.team-mode [role=alert]')).toHaveCount(0);await expect(page.getByRole('radiogroup')).toHaveAttribute('aria-busy','false');
  await page.reload();await page.getByRole('button',{name:/继续旅程/}).click();
  await page.getByRole('navigation',{name:'主导航',exact:true}).getByRole('button',{name:'设置',exact:true}).click();await expect(radio(page,'equal')).toBeChecked();
  await page.setViewportSize({width:390,height:844});await layout(page,true);await page.locator('.team-mode').scrollIntoViewIfNeeded();await evidence(page,'settings-mobile');
 }finally{await context.close()}
});
