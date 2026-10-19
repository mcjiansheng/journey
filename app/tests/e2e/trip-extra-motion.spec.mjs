import {test,expect} from '@playwright/test';
import {fileURLToPath} from 'node:url';
import {createApp,shutdownServer} from '../../server/index.mjs';
import {launchWebKit} from '../../scripts/browser-runtime.mjs';

let app,server,base;
test.beforeAll(async()=>{
 app=createApp({distPath:fileURLToPath(new URL('../../dist/',import.meta.url)),databasePath:':memory:',securityPath:':memory:',config:{amapKey:''}});
 server=await new Promise(resolve=>{const listener=app.listen(0,'127.0.0.1',()=>resolve(listener))});
 base=`http://127.0.0.1:${server.address().port}`;app.locals.config.appOrigin=base;
});
test.afterAll(async()=>{if(server)await shutdownServer(server,app)});

async function openCreate(page){
 await page.goto(base);
 await page.evaluate(async()=>{
  const response=await fetch('/api/auth/register',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({identifier:`extra-motion-${crypto.randomUUID()}@example.test`,password:'JourneyMotion2026!',displayName:'展开动效验收'})});
  if(!response.ok)throw new Error(`Registration failed: ${response.status}`);
 });
 await page.reload();await page.getByRole('button',{name:'创建旅程',exact:true}).click();
 return page.getByRole('button',{name:'更多设置',exact:true});
}

async function sampleToggle(page,reversal=false){
 return page.evaluate(async reversal=>{
  const button=document.querySelector('.trip-extra-toggle'),content=document.querySelector('.trip-extra-content');
  const heights=[content.getBoundingClientRect().height];button.click();
  const start=performance.now();let reversed=false;
  while(performance.now()-start<400){
   await new Promise(requestAnimationFrame);heights.push(content.getBoundingClientRect().height);
   if(reversal&&!reversed&&performance.now()-start>=60){button.click();reversed=true;}
  }
  return heights;
 },reversal);
}

async function checkDisclosure(page,{tabToButtons=true}={}){
 const toggle=await openCreate(page),content=page.locator('.trip-extra-content');
 await expect(toggle).toHaveAttribute('aria-expanded','false');
 await expect(page.getByLabel('旅程时区')).toBeHidden();
 const heights=await sampleToggle(page),full=heights.at(-1);
 expect(heights[0]).toBe(0);expect(full).toBeGreaterThan(100);
 expect(heights.filter(h=>h>1&&h<full-1).length).toBeGreaterThan(2);
 await page.getByLabel('记账币种').selectOption('USD');
 await toggle.focus();await toggle.press('Space');
 await expect(toggle).toHaveAttribute('aria-expanded','false');
 await expect(content).toHaveAttribute('inert','');
 expect(await content.evaluate(el=>{el.querySelector('select').focus();return el.contains(document.activeElement)})).toBe(false);
 await toggle.press('Tab');
 expect(await content.evaluate(el=>el.contains(document.activeElement))).toBe(false);
 if(tabToButtons)await expect(page.getByRole('dialog').getByRole('button',{name:'创建旅程',exact:true})).toBeFocused();
 await expect.poll(()=>content.evaluate(el=>el.getBoundingClientRect().height)).toBe(0);
 const reversed=await sampleToggle(page,true);
 expect(Math.max(...reversed)).toBeGreaterThan(1);expect(reversed.at(-1)).toBe(0);
 await toggle.focus();await toggle.press('Enter');
 await expect(page.getByLabel('记账币种')).toHaveValue('USD');
 await expect(page.getByLabel('旅程时区')).toBeVisible();
 await toggle.press('Escape');await expect(page.getByRole('dialog')).toHaveCount(0);
}

test('more settings expands continuously, reverses, and keeps keyboard order and values',async({page})=>{
 await page.setViewportSize({width:1440,height:900});await checkDisclosure(page);
});

test('mobile WebKit more settings expands and reverses without losing values',async()=>{
 const browser=await launchWebKit();
 try{const page=await browser.newPage({viewport:{width:390,height:844}});await checkDisclosure(page,{tabToButtons:false})}finally{await browser.close()}
});

test('more settings follows system and in-app reduced motion without hiding fields',async({page})=>{
 const toggle=await openCreate(page);
 for(const preference of ['system','app']){
  await page.emulateMedia({reducedMotion:preference==='system'?'reduce':'no-preference'});
  await page.evaluate(value=>{if(value==='app')document.documentElement.dataset.motion='true';else delete document.documentElement.dataset.motion},preference);
  const heights=await sampleToggle(page);
  expect(heights[0]).toBe(0);expect(heights[1]).toBeGreaterThan(100);
  expect(new Set(heights.slice(1))).toHaveProperty('size',1);
  await expect(page.getByLabel('旅程时区')).toBeVisible();
  await toggle.click();await expect(page.getByLabel('旅程时区')).toBeHidden();
 }
});
