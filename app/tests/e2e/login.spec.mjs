import {test,expect} from '@playwright/test';
import {fileURLToPath} from 'node:url';
import {createApp,shutdownServer} from '../../server/index.mjs';
import {launchWebKit} from '../../scripts/browser-runtime.mjs';

let app,server,base;
test.beforeAll(async()=>{
 app=createApp({distPath:fileURLToPath(new URL('../../dist/',import.meta.url)),databasePath:':memory:',securityPath:':memory:'});
 server=await new Promise(resolve=>{const listener=app.listen(0,'127.0.0.1',()=>resolve(listener))});
 base=`http://127.0.0.1:${server.address().port}`;
 app.locals.config.appOrigin=base;
});
test.afterAll(async()=>{if(server)await shutdownServer(server,app)});
async function screenshot(page,name){await page.screenshot({path:`../.local/evidence/login-${name}.png`,fullPage:true,animations:'disabled',scale:'css'})}
async function noOverflow(page){expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true)}
async function sampleSwitch(page,register){
 return page.evaluate(async register=>{
  const card=document.querySelector('.login-card'),sketch=document.querySelector('.journey-sketch'),mode=document.querySelector('.login-mode');
  const measure=()=>({height:card.getBoundingClientRect().height,top:card.getBoundingClientRect().top,sketchTop:sketch.getBoundingClientRect().top,sketchLeft:sketch.getBoundingClientRect().left,thumb:new DOMMatrix(getComputedStyle(mode,'::before').transform).m41});
  const before=measure(),frames=[],start=performance.now();mode.querySelectorAll('button')[register?1:0].click();
  while(performance.now()-start<480){await new Promise(requestAnimationFrame);frames.push(measure())}
  return{before,frames,after:measure()};
 },register);
}
function expectSmoothSwitch({before,frames,after}){
 const [low,high]=[before.height,after.height].sort((a,b)=>a-b);
 expect(high-low).toBeGreaterThan(150);
 expect(frames.some(frame=>frame.height>low+5&&frame.height<high-5)).toBe(true);
 expect(frames.some(frame=>frame.thumb>5&&frame.thumb<Math.max(before.thumb,after.thumb)-5)).toBe(true);
 for(const frame of frames){expect(Math.abs(frame.top-before.top)).toBeLessThan(1);expect(Math.abs(frame.sketchTop-before.sketchTop)).toBeLessThan(1);expect(Math.abs(frame.sketchLeft-before.sketchLeft)).toBeLessThan(1)}
}

test('mode switch animates card and thumb, anchors artwork, and reverses without stale state',async({page})=>{
 await page.setViewportSize({width:1440,height:900});await page.goto(base);await expect(page.getByRole('heading',{name:'欢迎回来'})).toBeVisible();
 expectSmoothSwitch(await sampleSwitch(page,true));await screenshot(page,'register-desktop');
 expectSmoothSwitch(await sampleSwitch(page,false));
 const result=await page.evaluate(async()=>{
  const card=document.querySelector('.login-card'),buttons=document.querySelectorAll('.login-mode button');
  const initial=card.getBoundingClientRect().height,heights=[initial],start=performance.now();let step=0;
  const changes=[[0,1],[80,0],[150,1],[230,0]];
  while(performance.now()-start<720){
   const elapsed=performance.now()-start;
   if(step<changes.length&&elapsed>=changes[step][0])buttons[changes[step++][1]].click();
   await new Promise(requestAnimationFrame);heights.push(card.getBoundingClientRect().height);
  }
  return{initial,heights,mode:card.dataset.mode};
 });
 expect(result.mode).toBe('login');expect(Math.abs(result.heights.at(-1)-result.initial)).toBeLessThan(1);
 expect(Math.max(...result.heights.slice(1).map((height,index)=>Math.abs(height-result.heights[index])))).toBeLessThan(90);
 await expect(page.getByRole('textbox',{name:'你的称呼'})).toHaveCount(0);await expect(page.getByLabel('确认密码',{exact:true})).toBeDisabled();
 await page.getByLabel('密码',{exact:true}).focus();await page.keyboard.press('Tab');await expect(page.getByRole('button',{name:'显示密码',exact:true})).toBeFocused();await page.keyboard.press('Tab');await expect(page.getByRole('button',{name:'登录并继续'})).toBeFocused();
 await page.setViewportSize({width:390,height:844});await page.evaluate(()=>scrollTo(0,0));expectSmoothSwitch(await sampleSwitch(page,true));await noOverflow(page);
 await page.emulateMedia({reducedMotion:'reduce'});await page.getByRole('button',{name:'登录',exact:true}).click();
 expect(await page.locator('.login-card').evaluate(el=>el.getAnimations({subtree:true}).length)).toBe(0);
 await expect(page.getByLabel('确认密码',{exact:true})).toBeDisabled();
});

test('entry layout, pointer feedback, appearance settings and narrow screens',async({page})=>{
 const errors=[];page.on('pageerror',error=>errors.push(error.message));
 await page.setViewportSize({width:1440,height:900});await page.goto(base);
 await expect(page.getByRole('heading',{name:'欢迎回来'})).toBeVisible();
 const drawing=await page.locator('.journey-sketch').boundingBox(),card=await page.locator('.login-card').boundingBox();
 expect(drawing.x+drawing.width).toBeLessThan(card.x);await noOverflow(page);
 await expect(page.getByRole('contentinfo',{name:'网站备案信息'})).toBeInViewport();
 await screenshot(page,'desktop');
 await page.mouse.move(200,280);
 await expect.poll(()=>page.locator('.auth-layout').evaluate(el=>el.style.getPropertyValue('--sketch-x'))).not.toBe('');
 await page.mouse.move(1430,10);
 await expect.poll(()=>page.locator('.auth-layout').evaluate(el=>el.style.getPropertyValue('--sketch-x'))).toBe('');
 await page.emulateMedia({reducedMotion:'reduce'});await page.mouse.move(210,280);
 expect(await page.locator('.auth-layout').evaluate(el=>el.style.getPropertyValue('--sketch-x'))).toBe('');
 expect(await page.locator('.sketch-float').first().evaluate(el=>getComputedStyle(el).animationName)).toBe('none');
 await page.evaluate(()=>document.documentElement.dataset.theme='dark');await screenshot(page,'dark');
 await page.evaluate(()=>document.documentElement.dataset.transparency='true');
 expect(await page.locator('.login-card').evaluate(el=>getComputedStyle(el).backdropFilter)).toBe('none');
 await page.evaluate(()=>{document.documentElement.dataset.theme='light';delete document.documentElement.dataset.transparency});
 for(const [width,height] of [[1024,768],[768,1024],[390,844],[320,740]]){
  await page.setViewportSize({width,height});await noOverflow(page);await expect(page.getByRole('button',{name:'登录并继续'})).toBeVisible();
  await screenshot(page,`${width}`);
 }
 await page.getByRole('button',{name:'创建账号',exact:true}).click();await screenshot(page,'register-320');await noOverflow(page);
 expect(errors).toEqual([]);
});

test('password visibility, recoverable login, registration and subsequent login',async({page})=>{
 await page.goto(base);
 const identifier=`entry-${Date.now()}@example.test`,password='JourneyEntry2026!';
 await page.getByLabel('手机号或邮箱').fill(identifier);await page.getByLabel('密码',{exact:true}).fill(password);
 await page.getByRole('button',{name:'显示密码',exact:true}).click();await expect(page.getByLabel('密码',{exact:true})).toHaveAttribute('type','text');
 await page.getByRole('button',{name:'隐藏密码',exact:true}).click();await expect(page.getByLabel('密码',{exact:true})).toHaveAttribute('type','password');
 await page.getByRole('button',{name:'登录并继续'}).click();await expect(page.locator('.login-form [role=alert]')).toBeVisible();
 await expect(page.getByLabel('手机号或邮箱')).toHaveValue(identifier);await expect(page.getByLabel('密码',{exact:true})).toHaveValue(password);
 await page.getByRole('button',{name:'创建账号',exact:true}).click();await expect(page.locator('.login-form [role=alert]')).toHaveCount(0);
 await expect(page.getByLabel('密码',{exact:true})).toHaveAttribute('autocomplete','new-password');await page.getByLabel('你的称呼').fill('一起出发');
 const registrations=[];page.on('request',request=>{if(request.url().endsWith('/api/auth/register'))registrations.push(request.postDataJSON())});
 await page.getByRole('button',{name:'创建账号并继续'}).click();await expect(page.getByLabel('确认密码',{exact:true})).toBeFocused();
 await page.getByLabel('确认密码',{exact:true}).fill('DifferentPassword!');await page.getByRole('button',{name:'创建账号并继续'}).click();
 await expect(page.getByText('两次输入的密码不一致',{exact:true})).toBeVisible();await expect(page.getByLabel('确认密码',{exact:true})).toHaveAttribute('aria-invalid','true');expect(registrations).toEqual([]);
 await page.getByLabel('确认密码',{exact:true}).fill(password);await expect(page.getByText('两次输入的密码不一致',{exact:true})).toHaveCount(0);
 await page.getByRole('button',{name:'显示确认密码',exact:true}).click();await expect(page.getByLabel('确认密码',{exact:true})).toHaveAttribute('type','text');
 await page.getByLabel('密码',{exact:true}).fill('ChangedPassword!');await expect(page.getByText('两次输入的密码不一致',{exact:true})).toBeVisible();await page.getByLabel('密码',{exact:true}).fill(password);
 expect(await page.evaluate(()=>JSON.parse(sessionStorage.getItem('journey.loginDraft')).password)).toBe('');
 expect(await page.evaluate(()=>sessionStorage.getItem('journey.loginDraft'))).not.toContain(password);
 await page.getByRole('button',{name:'创建账号并继续'}).click();await expect(page.getByRole('button',{name:'创建旅程',exact:true})).toBeVisible();
 expect(registrations).toHaveLength(1);expect(registrations[0]).not.toHaveProperty('confirmation');
 expect(await page.evaluate(()=>sessionStorage.getItem('journey.loginDraft'))).toBeNull();
 await page.context().clearCookies();await page.reload();
 await page.getByLabel('手机号或邮箱').fill(identifier);await page.getByLabel('密码',{exact:true}).fill(password);await page.getByRole('button',{name:'登录并继续'}).click();
 await expect(page.getByRole('button',{name:'创建旅程',exact:true})).toBeVisible();
});

test('iPhone WebKit keeps the glass form and filing reachable',async()=>{
 const browser=await launchWebKit();
 try{
  const context=await browser.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true,deviceScaleFactor:3});const page=await context.newPage();
  await page.goto(base);await expect(page.getByRole('heading',{name:'欢迎回来'})).toBeVisible();await noOverflow(page);await screenshot(page,'webkit-mobile');
  await page.getByLabel('手机号或邮箱').fill('touch@example.test');await page.getByLabel('密码',{exact:true}).fill('JourneyEntry2026!');
  await page.getByRole('button',{name:'显示密码',exact:true}).tap();await expect(page.getByLabel('密码',{exact:true})).toHaveAttribute('type','text');
  expectSmoothSwitch(await sampleSwitch(page,true));await expect(page.getByLabel('你的称呼')).toBeVisible();await noOverflow(page);
  await page.getByLabel('你的称呼').fill('触屏测试');await page.getByLabel('确认密码',{exact:true}).fill('JourneyEntry2026!');await screenshot(page,'webkit-register');
  await page.getByRole('button',{name:'登录',exact:true}).tap();await expect(page.getByLabel('确认密码',{exact:true})).toBeDisabled();
  await page.getByRole('contentinfo',{name:'网站备案信息'}).scrollIntoViewIfNeeded();await expect(page.getByRole('contentinfo',{name:'网站备案信息'})).toBeInViewport();
 }finally{await browser.close()}
});
