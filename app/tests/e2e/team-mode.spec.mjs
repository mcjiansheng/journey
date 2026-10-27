import {test,expect} from '@playwright/test';
import {fileURLToPath} from 'node:url';
import {createApp,shutdownServer} from '../../server/index.mjs';
import {launchWebKit} from '../../scripts/browser-runtime.mjs';

let app,server,base;
const password='JourneyTeamMode2026!';
const descriptions={
 '管理员团队':'创建者与管理员可直接删除。 成员可表达自己的意见。',
 '平等团队':'成员通过集体表态删除内容。 创建者也可直接删除。',
};

test.beforeAll(async()=>{
 app=createApp({distPath:fileURLToPath(new URL('../../dist/',import.meta.url)),databasePath:':memory:',securityPath:':memory:',config:{amapKey:''}});
 server=await new Promise(resolve=>{const listener=app.listen(0,'127.0.0.1',()=>resolve(listener))});
 base=`http://127.0.0.1:${server.address().port}`;
 app.locals.config.appOrigin=base;
});
test.afterAll(async()=>{if(server)await shutdownServer(server,app)});

async function register(page){
 await page.goto(base);
 await page.getByRole('button',{name:'创建账号',exact:true}).click();
 const suffix=Date.now().toString(36)+Math.random().toString(36).slice(2,7);
 await page.getByLabel('手机号或邮箱').fill(`team-mode-${suffix}@example.test`);
 await page.getByLabel('你的称呼').fill('团队模式验收');
 await page.getByLabel('密码',{exact:true}).fill(password);
 await page.getByLabel('确认密码',{exact:true}).fill(password);
 await page.getByRole('button',{name:'创建账号并继续'}).click();
 await expect(page.getByRole('button',{name:'创建旅程',exact:true})).toBeVisible();
}

async function openCreate(page){
 await page.getByRole('button',{name:'创建旅程',exact:true}).click();
 const dialog=page.getByRole('dialog');
 await expect(dialog.getByRole('radiogroup',{name:'团队类型'})).toBeVisible();
 await dialog.getByLabel('旅程名称').fill('团队类型验收旅程');
 await dialog.getByLabel('目的地').fill('南京');
 await dialog.getByLabel('出发日期').fill('2026-11-01');
 await dialog.getByLabel('结束日期').fill('2026-11-02');
 await dialog.getByText('更多设置',{exact:true}).click();
 await dialog.getByLabel('旅程时区').selectOption('Asia/Shanghai');
 return dialog;
}

async function createTrip(page,mode='admin'){
 const dialog=await openCreate(page);
 await dialog.getByRole('radio',{name:mode==='admin'?'管理员团队':'平等团队',exact:true}).check();
 await dialog.getByRole('button',{name:'创建旅程',exact:true}).click();
 await expect(page.getByRole('button',{name:'添加活动',exact:true}).first()).toBeVisible();
}

async function openSettings(page){
 await page.getByRole('navigation',{name:/^(主导航|手机主导航)$/}).getByRole('button',{name:'管理',exact:true}).click();
 const row=page.locator('.settings-page .settings-link').filter({hasText:'团队类型'});
 await expect(row).toBeVisible();
 await expect(row).toHaveAttribute('aria-haspopup','dialog');
 await expect(page.locator('.settings-page input[type="radio"]')).toHaveCount(0);
 const members=page.locator('.settings-page .settings-link').filter({hasText:'成员与邀请'});
 const [rowBox,membersBox]=await Promise.all([row.boundingBox(),members.boundingBox()]);
 expect(rowBox).not.toBeNull();expect(membersBox).not.toBeNull();
 expect(Math.abs(rowBox.height-membersBox.height)).toBeLessThan(1);
 return row;
}

async function openTeamModeDialog(page,row){
 await row.click();
 const dialog=page.getByRole('dialog',{name:'团队类型'});
 await expect(dialog).toBeVisible();
 const picker=dialog.getByRole('radiogroup',{name:'团队类型'});
 await expect(picker).toBeVisible();
 if(await picker.locator('input:checked').isDisabled())await expect(dialog.getByRole('heading',{name:'团队类型',exact:true})).toBeFocused();
 else await expect(picker.locator('input:checked')).toBeFocused();
 return {dialog,picker};
}

async function reopenCurrentTripAfterReload(page){
 await page.setViewportSize({width:1440,height:900});
 await page.reload();
 const continueTrip=page.getByRole('button',{name:/继续旅程/});
 await expect(continueTrip).toBeVisible();
 await continueTrip.click();
 await expect(page.getByRole('navigation',{name:'主导航'})).toBeVisible();
 return openSettings(page);
}

async function expectSettingRow(row,selected){
 await expect(row).toContainText('团队类型');
 await expect(row).toContainText(selected);
 await expect(row).toBeEnabled();
}

async function closeCreateExtras(dialog){
 const toggle=dialog.getByRole('button',{name:'更多设置',exact:true});
 if(await toggle.getAttribute('aria-expanded')==='true')await toggle.click();
 await expect(toggle).toHaveAttribute('aria-expanded','false');
}

async function expectPickerContent(picker,selected){
 for(const [label,description] of Object.entries(descriptions)){
  const radio=picker.getByRole('radio',{name:label,exact:true});
  await expect(radio).toHaveAccessibleName(label);
  await expect(radio).toHaveAccessibleDescription(description);
  const card=radio.locator('..');
  await expect(card).toContainText(description,{useInnerText:true});
  const icon=card.locator('svg.team-mode-art');
  await expect(icon).toHaveAttribute('aria-hidden','true');
 }
 await expect(picker.getByRole('radio',{name:selected,exact:true})).toBeChecked();
}

async function expectCardLayout(picker){
 const admin=await picker.locator('.team-mode-option').nth(0).boundingBox();
 const equal=await picker.locator('.team-mode-option').nth(1).boundingBox();
 const panelWidth=await picker.locator('.team-mode-panel').evaluate(node=>node.getBoundingClientRect().width);
 expect(admin).not.toBeNull();expect(equal).not.toBeNull();
 if(panelWidth<400){
  expect(Math.abs(admin.x-equal.x)).toBeLessThan(2);
  expect(equal.y).toBeGreaterThan(admin.y+admin.height-2);
 }else{
  expect(equal.x).toBeGreaterThan(admin.x+admin.width-2);
  expect(Math.abs(admin.y-equal.y)).toBeLessThan(2);
 }
}

async function capture(page,testInfo,name){
 const path=testInfo.outputPath(`${name}.png`);
 await page.mouse.move(1,1);
 await page.screenshot({path,fullPage:true,animations:'disabled',scale:'css'});
 await testInfo.attach(name,{path,contentType:'image/png'});
}

async function verifyLayouts(page,picker){
 for(const [width,height] of [[320,740],[390,844],[768,900],[1440,900]]){
  await page.setViewportSize({width,height});
  await expectCardLayout(picker);
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
 }
}

test('creation selection is accessible, responsive, and persisted with the created trip',async({page},testInfo)=>{
 await page.setViewportSize({width:1440,height:900});
 await register(page);
 const dialog=await openCreate(page);
 const picker=dialog.getByRole('radiogroup',{name:'团队类型'});
 await expectPickerContent(picker,'管理员团队');
 await expectCardLayout(picker);
 await closeCreateExtras(dialog);
 await capture(page,testInfo,'team-mode-create-desktop');

 await page.setViewportSize({width:390,height:844});
 await expectCardLayout(picker);
 await capture(page,testInfo,'team-mode-create-mobile');

 // Native radio arrows move selection within the group; Tab leaves the group.
 const admin=picker.getByRole('radio',{name:'管理员团队',exact:true});
 const equal=picker.getByRole('radio',{name:'平等团队',exact:true});
 await admin.focus();
 await page.keyboard.press('ArrowRight');
 await expect(equal).toBeChecked();
 await expect(equal).toBeFocused();
 await page.keyboard.press('Tab');
 await expect(picker.locator('input[type="radio"]:focus')).toHaveCount(0);
 await equal.check();
 await expectPickerContent(picker,'平等团队');
 await dialog.getByRole('button',{name:'创建旅程',exact:true}).click();
 await expect(page.getByRole('button',{name:'添加活动',exact:true}).first()).toBeVisible();

 const trip=await page.evaluate(async()=>{
  const response=await fetch('/api/trips');
  return (await response.json()).trips[0];
 });
 expect(trip).toMatchObject({name:'团队类型验收旅程',teamMode:'equal'});

 const settings=await openSettings(page);
 await expectSettingRow(settings,'平等团队');
 await page.setViewportSize({width:1440,height:900});
 await settings.scrollIntoViewIfNeeded();
 await capture(page,testInfo,'team-mode-settings-main-desktop');
 await page.setViewportSize({width:390,height:844});
 await settings.scrollIntoViewIfNeeded();
 await capture(page,testInfo,'team-mode-settings-main-mobile');
 await page.setViewportSize({width:1440,height:900});
 const {dialog:settingsDialog,picker:settingsPicker}=await openTeamModeDialog(page,settings);
 await expectPickerContent(settingsPicker,'平等团队');
 await verifyLayouts(page,settingsPicker);
 await page.setViewportSize({width:1440,height:900});
 await settingsPicker.locator('.team-mode-options').scrollIntoViewIfNeeded();
 await capture(page,testInfo,'team-mode-picker-desktop');
 await page.setViewportSize({width:390,height:844});
 await settingsPicker.locator('.team-mode-options').scrollIntoViewIfNeeded();
 await capture(page,testInfo,'team-mode-picker-mobile');
 await page.keyboard.press('Escape');
 await expect(settingsDialog).toHaveCount(0);
 await expect(settings).toBeFocused();
 const reloadedSettings=await reopenCurrentTripAfterReload(page);
 await expectSettingRow(reloadedSettings,'平等团队');
});

test('settings mode switch persists on success, blocks duplicate changes while pending, and rolls back on failure',async({page})=>{
 await page.setViewportSize({width:1440,height:900});
 await register(page);
 await createTrip(page,'admin');
 const row=await openSettings(page);
 await expectSettingRow(row,'管理员团队');

 let successfulPatches=0;
 page.on('request',request=>{if(request.method()==='PATCH'&&/\/api\/trips\/[^/]+\/team$/.test(request.url()))successfulPatches++});
 let {dialog,picker}=await openTeamModeDialog(page,row);
 await picker.getByRole('radio',{name:'平等团队',exact:true}).check();
 await expect.poll(()=>successfulPatches).toBe(1);
 await expectPickerContent(picker,'平等团队');
 await expect(picker.getByRole('radio',{name:'平等团队',exact:true})).toBeEnabled();
 await expect(picker.getByRole('status')).toHaveCount(0);
 await dialog.getByRole('button',{name:'完成',exact:true}).click();
 await expect(dialog).toHaveCount(0);
 await expect(row).toBeFocused();
 await expectSettingRow(row,'平等团队');
 const reloaded=await reopenCurrentTripAfterReload(page);
 await expectSettingRow(reloaded,'平等团队');

 let releasePending,markPending;
 const pendingResponse=new Promise(resolve=>{releasePending=resolve});
 const requestStarted=new Promise(resolve=>{markPending=resolve});
 let pendingPatches=0;
 await page.route('**/api/trips/*/team',async route=>{
  pendingPatches++;markPending();await pendingResponse;
  await route.fulfill({status:503,contentType:'application/json',body:JSON.stringify({error:{code:'TEMPORARY',message:'团队类型暂时无法切换'}})});
 });
 ({dialog,picker}=await openTeamModeDialog(page,reloaded));
 await picker.getByRole('radio',{name:'管理员团队',exact:true}).check();
 await requestStarted;
 await expect(picker.locator('input[type="radio"]')).toHaveCount(2);
 await expect(picker.getByRole('radio',{name:'管理员团队',exact:true})).toBeDisabled();
 await expect(picker.getByRole('radio',{name:'平等团队',exact:true})).toBeDisabled();
 await expect(dialog.getByRole('button',{name:'完成',exact:true})).toBeDisabled();
 await expect(picker.getByRole('status')).toContainText('正在切换');
 await picker.getByRole('radio',{name:'平等团队',exact:true}).click({force:true});
 await page.waitForTimeout(120);
 expect(pendingPatches).toBe(1);
 await dialog.getByRole('button',{name:'关闭',exact:true}).click();
 await expect(dialog).toHaveCount(0);
 await expect(reloaded).toBeFocused();
 ({dialog,picker}=await openTeamModeDialog(page,reloaded));
 await dialog.getByRole('button',{name:'关闭',exact:true}).click();
 await expect(reloaded).toBeFocused();
 releasePending();
 await expect.poll(()=>pendingPatches).toBe(1);
 await expect(page.getByRole('alert')).toContainText('团队类型暂时无法切换');
 const inlineError=reloaded.locator('xpath=following-sibling::*[1]');
 await expect(inlineError).toHaveAttribute('role','alert');
 await expect(inlineError).toContainText('团队类型暂时无法切换');
 await expectSettingRow(reloaded,'平等团队');
 await expect(reloaded).toBeEnabled();
 await page.unroute('**/api/trips/*/team');

 ({dialog,picker}=await openTeamModeDialog(page,reloaded));
 await expectPickerContent(picker,'平等团队');
 await picker.getByRole('radio',{name:'管理员团队',exact:true}).check();
 await expect(picker.getByRole('radio',{name:'管理员团队',exact:true})).toBeChecked();
 await expect(picker.getByRole('radio',{name:'管理员团队',exact:true})).toBeEnabled();
 await expect(picker.getByRole('status')).toHaveCount(0);
 await expect(picker.getByRole('alert')).toHaveCount(0);
 await dialog.getByRole('button',{name:'完成',exact:true}).click();
 await expect(reloaded).toContainText('管理员团队');
 await expect(reloaded).toBeEnabled();
});

test('team mode cards retain light and dark appearance and respond to reduced motion',async({page},testInfo)=>{
 await page.setViewportSize({width:1440,height:900});
 await register(page);
 await createTrip(page,'admin');
 const row=await openSettings(page);
 const light=await page.evaluate(()=>getComputedStyle(document.documentElement).backgroundColor);
 await page.evaluate(()=>{document.documentElement.dataset.theme='dark'});
 const dark=await page.evaluate(()=>getComputedStyle(document.documentElement).backgroundColor);
 expect(dark).not.toBe(light);
 await row.scrollIntoViewIfNeeded();
 await capture(page,testInfo,'team-mode-dark-settings-desktop');
 let {dialog,picker}=await openTeamModeDialog(page,row);
 await expectPickerContent(picker,'管理员团队');
 await picker.locator('.team-mode-options').scrollIntoViewIfNeeded();
 await capture(page,testInfo,'team-mode-dark-picker-desktop');
 await page.setViewportSize({width:390,height:844});
 await picker.locator('.team-mode-options').scrollIntoViewIfNeeded();
 await capture(page,testInfo,'team-mode-dark-picker-mobile');
 await dialog.getByRole('button',{name:'完成',exact:true}).click();
 await expect(dialog).toHaveCount(0);
 await row.scrollIntoViewIfNeeded();
 await capture(page,testInfo,'team-mode-dark-settings-mobile');
 await page.setViewportSize({width:1440,height:900});
 await page.evaluate(()=>{document.documentElement.dataset.theme='light'});
 await expectSettingRow(row,'管理员团队');

 ({dialog,picker}=await openTeamModeDialog(page,row));
 await page.emulateMedia({forcedColors:'active'});
 const selected=picker.getByRole('radio',{name:'管理员团队',exact:true});
 await dialog.getByRole('button',{name:'关闭',exact:true}).focus();
 await page.keyboard.press('Tab');
 await expect(selected).toBeFocused();
 const selectedFace=selected.locator('..').locator('.team-mode-face');
 await expect(selectedFace).toHaveCSS('outline-offset','3px');
 await page.keyboard.press('Escape');
 await expect(dialog).toHaveCount(0);
 await expect(row).toBeFocused();
 await page.emulateMedia({forcedColors:'none'});

 ({dialog,picker}=await openTeamModeDialog(page,row));
 await page.emulateMedia({reducedMotion:'reduce'});
 expect(await page.evaluate(()=>matchMedia('(prefers-reduced-motion: reduce)').matches)).toBe(true);
 const durations=await picker.evaluate(node=>{
  const face=node.querySelector('.team-mode-face'),indicator=node.querySelector('.team-mode-indicator');
  return [face,indicator].map(element=>getComputedStyle(element).transitionDuration.split(',').map(value=>Number.parseFloat(value)));
 });
 expect(durations.every(values=>values.every(value=>value===0))).toBe(true);
 await picker.getByRole('radio',{name:'平等团队',exact:true}).check();
 await expect(picker.getByRole('radio',{name:'平等团队',exact:true})).toBeChecked();
});

test('mobile WebKit renders both cards and switches the selected team',async({},testInfo)=>{
 const browser=await launchWebKit();
 try{
  const context=await browser.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true,deviceScaleFactor:2});
  const page=await context.newPage();
  await register(page);
  await createTrip(page,'admin');
  const row=await openSettings(page);
  const {picker}=await openTeamModeDialog(page,row);
  await expectPickerContent(picker,'管理员团队');
  await expectCardLayout(picker);
  await picker.getByRole('radio',{name:'平等团队',exact:true}).tap();
  await expect(picker.getByRole('radio',{name:'平等团队',exact:true})).toBeEnabled();
  await expectPickerContent(picker,'平等团队');
  await picker.evaluate(node=>node.scrollIntoView({block:'center'}));
  await capture(page,testInfo,'team-mode-webkit-mobile');
 }finally{await browser.close()}
});
