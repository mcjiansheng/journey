import {test,expect} from '@playwright/test';
import {fileURLToPath} from 'node:url';
import {existsSync} from 'node:fs';
import {createApp,shutdownServer} from '../../server/index.mjs';
let app,server;
const base='http://127.0.0.1:4195';
test.beforeAll(async()=>{
 const distPath=process.env.ACTIVITY_PLACE_DIST||fileURLToPath(new URL('../../dist/',import.meta.url));
 expect(existsSync(distPath+'/index.html'),distPath).toBe(true);
 app=createApp({distPath,databasePath:':memory:',securityPath:':memory:',config:{appOrigin:base}});
 server=await new Promise(resolve=>{const s=app.listen(4195,'127.0.0.1',()=>resolve(s));});
});
test.afterAll(async()=>{if(server)await shutdownServer(server,app);});
async function start(page){
 const response=await page.goto(base);expect(response.status()).toBe(200);await page.getByRole('button',{name:'创建账号',exact:true}).click();
 await page.getByLabel('手机号或邮箱').fill(`place-${Date.now()}@example.test`);await page.getByLabel('你的称呼').fill('地点验收');await page.getByLabel('密码',{exact:true}).fill('CourseJourney2026!');await page.getByLabel('确认密码',{exact:true}).fill('CourseJourney2026!');await page.getByRole('button',{name:'创建账号并继续'}).click();
 await page.getByRole('button',{name:'创建旅程',exact:true}).click();await page.getByLabel('旅程名称').fill('地点输入验收');await page.getByLabel('目的地',{exact:true}).fill('南京');await page.getByLabel('出发日期',{exact:true}).fill('2026-11-01');await page.getByLabel('结束日期',{exact:true}).fill('2026-11-01');await page.getByRole('radio',{name:'平等团队',exact:true}).check();await page.getByRole('dialog').getByRole('button',{name:'创建旅程'}).click();
 await page.getByRole('button',{name:'添加活动',exact:true}).first().click();await page.getByLabel('活动名称').fill('湖边散步');return page.getByRole('combobox',{name:'地点 选填'});
}
async function snapshot(page){return page.evaluate(async()=>{const {trips}=await fetch('/api/trips').then(r=>r.json());return fetch(`/api/trips/${trips[0].id}`).then(r=>r.json());});}
async function savedPlace(page){return (await snapshot(page)).objects.find(o=>o.kind==='activity')?.payload.place;}
async function finish(page){await page.getByRole('dialog').getByRole('button',{name:'完成',exact:true}).click();await expect(page.locator('.sync-status.synced')).toBeVisible();}
async function reopen(page){await page.locator('.activity-main').first().click();}
async function layout(page,name){expect(await page.locator('.modal-body').evaluate(el=>el.scrollWidth<=el.clientWidth)).toBe(true);await page.screenshot({path:`../.local/evidence/activity-place-${name}.png`,scale:'css',animations:'disabled'});}

test('single location input: free text, real POI keyboard selection, replace, clear and reload',async({page})=>{
 test.setTimeout(90000);await page.setViewportSize({width:1440,height:900});const errors=[];page.on('pageerror',e=>errors.push(e.message));const input=await start(page);
 await expect(page.getByLabel('地点名称',{exact:true})).toHaveCount(0);await expect(page.getByLabel('地址',{exact:true})).toHaveCount(0);await layout(page,'desktop-empty');
 await input.fill('酒店附近吃饭');await finish(page);await expect.poll(()=>savedPlace(page)).toMatchObject({name:'酒店附近吃饭',address:'',lng:null,lat:null});
 await page.reload();await page.getByRole('button',{name:/继续旅程/}).click();await reopen(page);await expect(input).toHaveValue('酒店附近吃饭');
 await input.fill('玄武湖公园');await expect(page.getByRole('listbox').getByRole('option').first()).toBeVisible({timeout:30000});const name=await page.getByRole('listbox').getByRole('option').first().locator('strong').innerText();await layout(page,'desktop-results');
 await input.press('ArrowDown');await input.press('Enter');await expect(input).toHaveValue(name);await expect(page.getByRole('listbox')).toHaveCount(0);await expect(page.locator('.activity-place-address')).toBeVisible();await layout(page,'desktop-selected');await finish(page);
 await expect.poll(()=>savedPlace(page)).toMatchObject({name,provider:'amap'});const p=await savedPlace(page);expect(Number.isFinite(p.lng)).toBe(true);expect(Number.isFinite(p.lat)).toBe(true);
 await reopen(page);await input.fill('另找一家咖啡店');await finish(page);await expect.poll(()=>savedPlace(page)).toMatchObject({name:'另找一家咖啡店',address:'',lng:null,lat:null,provider:null,providerPlaceId:null,fetchedAt:null});
 await reopen(page);await page.getByRole('button',{name:'清除地点'}).click();await finish(page);await expect.poll(()=>savedPlace(page)).toBeNull();expect(errors).toEqual([]);
});
test('touch selection, shared favorites and map handoff retain the place',async({browser})=>{
 test.setTimeout(90000);const context=await browser.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true});const page=await context.newPage();
 try{const input=await start(page);await input.fill('南京博物院');await expect(page.getByRole('listbox').getByRole('option').first()).toBeVisible({timeout:30000});const name=await page.getByRole('listbox').getByRole('option').first().locator('strong').innerText();await layout(page,'mobile-results');
 await page.getByRole('listbox').getByRole('option').first().tap();await expect(input).toHaveValue(name);await expect(page.getByRole('listbox')).toHaveCount(0);await layout(page,'mobile-selected');await finish(page);await reopen(page);
 await page.getByRole('button',{name:'在地图查找',exact:true}).click();await expect(page.locator('.map-panel')).toBeVisible();await page.getByRole('textbox',{name:'搜索地点',exact:true}).fill('玄武湖公园');await expect(page.locator('.map-result').first()).toBeVisible({timeout:30000});await page.locator('.map-result').first().click();
 await page.getByRole('button',{name:'收藏',exact:true}).click();await expect(page.getByRole('button',{name:'已收藏',exact:true})).toBeVisible();await page.getByRole('button',{name:'加入行程',exact:true}).click();await expect(input).toBeVisible();
 const favorite=(await snapshot(page)).objects.find(o=>o.kind==='favorite').payload;await expect(input).toHaveValue(favorite.name);await expect.poll(()=>savedPlace(page)).toEqual(favorite);
 await page.getByRole('button',{name:'清除地点'}).click();await page.getByRole('button',{name:'从收藏选择'}).click();await page.locator('.activity-place-favorites button').first().tap();await expect(input).toHaveValue(favorite.name);await finish(page);await expect.poll(()=>savedPlace(page)).toEqual(favorite);
 await page.locator('nav:visible').getByRole('button',{name:'行程',exact:true}).click();await reopen(page);await page.setViewportSize({width:320,height:740});await layout(page,'mobile-320');
 }finally{await context.close();}
});
test('failed and superseded searches preserve text, IME and Escape',async({page})=>{
 test.setTimeout(90000);const input=await start(page);await input.fill('玄武湖');await expect(page.getByRole('listbox').getByRole('option').first()).toBeVisible({timeout:30000});
 let release,started;const held=new Promise(resolve=>{release=resolve;});const requestStarted=new Promise(resolve=>{started=resolve;});
 await page.route('**/_AMapService/v3/place/text?**',async route=>{started();await held;await route.continue();},{times:1});
 await input.fill('夫子庙');await requestStarted;await input.fill('南京博物院');await expect(page.getByRole('listbox').getByRole('option').first()).toBeVisible({timeout:30000});await input.press('ArrowDown');await input.press('Enter');const chosen=await input.inputValue();
 const oldResponse=page.waitForResponse(r=>r.url().includes('/v3/place/text')&&r.url().includes(encodeURIComponent('夫子庙')));release();await oldResponse;await expect(input).toHaveValue(chosen);await expect(page.getByRole('listbox')).toHaveCount(0);
 await page.route('**/_AMapService/v3/place/text?**',route=>route.abort());await input.fill('离线约定的见面处');await expect(page.getByText('地点搜索暂时不可用，已保留你的输入。')).toBeVisible({timeout:30000});await page.getByRole('button',{name:'重试',exact:true}).click();await expect(page.getByText('地点搜索暂时不可用，已保留你的输入。')).toBeVisible({timeout:30000});
 await input.press('Escape');await expect(page.getByRole('dialog')).toBeVisible();await input.dispatchEvent('compositionstart');await input.fill('酒店门口');await input.press('Enter');await expect(input).toHaveValue('酒店门口');await input.dispatchEvent('compositionend');await finish(page);await expect.poll(()=>savedPlace(page)).toMatchObject({name:'酒店门口',lng:null,lat:null});
});
