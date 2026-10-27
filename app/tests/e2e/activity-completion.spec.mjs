import {test,expect} from '@playwright/test';
import {fileURLToPath} from 'node:url';
import {createApp,shutdownServer} from '../../server/index.mjs';
import {launchWebKit} from '../../scripts/browser-runtime.mjs';
let app,server,base,vite;
test.beforeEach(async()=>{
 app=createApp({distPath:fileURLToPath(new URL('../../dist/',import.meta.url)),databasePath:':memory:',securityPath:':memory:',config:{amapKey:''}});
 server=await new Promise(resolve=>{const listener=app.listen(0,'127.0.0.1',()=>resolve(listener))});
 base=`http://127.0.0.1:${server.address().port}`;if(process.env.ACTIVITY_TEST_DEV==='1'){const {createServer}=await import('vite');vite=await createServer({server:{host:'127.0.0.1',port:0,proxy:{'/api':base}}});await vite.listen();base=vite.resolvedUrls.local[0].replace(/\/$/,'')}app.locals.config.appOrigin=base;
});
test.afterEach(async()=>{if(vite)await vite.close();if(server)await shutdownServer(server,app)});
async function setup(page){
 await page.goto(base);await page.getByRole('button',{name:'创建账号',exact:true}).click();
 await page.getByLabel('手机号或邮箱').fill(`completion-${crypto.randomUUID()}@example.test`);await page.getByLabel('你的称呼').fill('完成验收');
 await page.getByLabel('密码',{exact:true}).fill('JourneyCompletion2026!');await page.getByLabel('确认密码',{exact:true}).fill('JourneyCompletion2026!');await page.getByRole('button',{name:'创建账号并继续'}).click();
 await page.getByRole('button',{name:'创建旅程',exact:true}).click();await page.getByLabel('旅程名称').fill('活动完成验收');await page.getByLabel('目的地',{exact:true}).fill('南京');
 await page.getByText('更多设置',{exact:true}).click();await page.getByLabel('旅程时区',{exact:true}).selectOption('Asia/Shanghai');await page.getByLabel('出发日期',{exact:true}).fill('2026-11-01');await page.getByLabel('结束日期',{exact:true}).fill('2026-11-03');
 await page.getByRole('dialog').getByRole('button',{name:'创建旅程'}).click();await expect(page.locator('.day-heading')).toBeVisible();
}
const complete=page=>page.getByRole('dialog').getByRole('button',{name:'完成',exact:true});
async function finish(page){await complete(page).click();await expect(page.getByRole('dialog')).toHaveCount(0)}
async function add(page,title){await page.getByRole('button',{name:'添加活动',exact:true}).first().click();await page.getByLabel('活动名称').fill(title);await expect(page.getByLabel('活动名称')).toBeFocused();await finish(page)}
async function edit(page,title){await page.getByRole('heading',{name:title,exact:true}).click();await expect(page.getByRole('dialog')).toBeVisible()}

test('one pointer click saves newly created and existing activities from focused fields',async({page})=>{
 await setup(page);for(let n=0;n<3;n++){await add(page,`活动${n}`);await expect(page.getByRole('heading',{name:`活动${n}`,exact:true})).toBeVisible()}
 await edit(page,'活动0');await page.getByLabel('活动名称').fill('改名后');await finish(page);
 await edit(page,'改名后');await page.getByRole('button',{name:'具体时间',exact:true}).click();await page.getByLabel('开始时间',{exact:true}).fill('09:20');await finish(page);
 await edit(page,'改名后');await expect(page.getByLabel('开始时间',{exact:true})).toHaveValue('09:20');await page.getByRole('combobox',{name:/地点/}).fill('南京站');await finish(page);
 await edit(page,'改名后');await expect(page.getByRole('combobox',{name:/地点/})).toHaveValue('南京站');await page.getByText('备注与链接',{exact:true}).click();await page.getByLabel('备注',{exact:true}).fill('刚输入的备注');await finish(page);
 await edit(page,'改名后');await expect(page.getByLabel('备注',{exact:true})).toHaveValue('刚输入的备注');await page.getByLabel('链接',{exact:true}).fill('https://example.test/');await finish(page);
 await edit(page,'改名后');await expect(page.getByLabel('链接',{exact:true})).toHaveValue('https://example.test/');await page.getByText('到场与预留时间',{exact:true}).click();await page.getByLabel('提前到场（分钟）').fill('15');await finish(page);
 await page.reload();await page.getByRole('button',{name:/继续旅程/}).click();await edit(page,'改名后');await page.getByText('到场与预留时间',{exact:true}).click();await expect(page.getByLabel('提前到场（分钟）')).toHaveValue('15');
});

for(const width of [1440,390])test(`completion remains right-aligned before blur, after creation and after reopening at ${width}px`,async({page})=>{
 await page.setViewportSize({width,height:900});await setup(page);
 await page.getByRole('button',{name:'添加活动',exact:true}).first().click();
 const dialog=page.getByRole('dialog'),title=page.getByLabel('活动名称');
 const position=async()=>{
  await expect(dialog.getByRole('button',{name:'放弃未完成输入',exact:true,includeHidden:true})).toHaveCount(0);
  await expect(dialog.locator('.modal-actions > button')).toHaveCount(0);await expect(dialog.locator('.modal-head').getByRole('button',{name:'完成',exact:true})).toHaveCount(1);
  await expect(complete(page)).toHaveClass(/primary/);await complete(page).scrollIntoViewIfNeeded();
  return complete(page).evaluate(button=>{
   const bounds=button.getBoundingClientRect(),footer=button.parentElement.getBoundingClientRect();
   return{left:Math.round(bounds.left*100)/100,right:Math.round(bounds.right*100)/100,inset:Math.round((footer.right-bounds.right)*100)/100};
  });
 };
 const before=await position();expect(before.inset).toBeGreaterThanOrEqual(0);
 await expect(dialog.locator('.modal-head').getByRole('button',{name:'关闭',exact:true})).toHaveCount(0);
 const savedTitle=`按钮位置验收${width}`;
 await title.fill(savedTitle);await expect(title).toBeFocused();expect(await position()).toEqual(before);
 await title.press('Tab');await expect(dialog.getByRole('heading',{name:'添加活动',exact:true})).toBeVisible();
 expect(await position()).toEqual(before);
 await page.screenshot({path:`../.local/evidence/activity-editor-completion-${width}.png`,scale:'css',animations:'disabled'});
 // Closing an invalid field retains its input; reopening uses the saved activity card.
 await title.fill('');await page.keyboard.press('Escape');
 await expect(dialog).toHaveCount(0);await edit(page,savedTitle);await expect(title).toHaveValue('');
 expect(await position()).toEqual(before);
 await complete(page).click();await expect(dialog.getByRole('alert')).toHaveText('请填写活动名称。');
 expect(await position()).toEqual(before);
 await title.fill(`恢复后完成${width}`);await expect(title).toBeFocused();await finish(page);
 await expect(page.getByRole('heading',{name:`恢复后完成${width}`,exact:true})).toBeVisible();
});

test('completion validates the entire draft and retains invalid input',async({page})=>{
 await setup(page);await page.getByRole('button',{name:'添加活动',exact:true}).first().click();await complete(page).click();await expect(page.getByRole('dialog').getByRole('alert')).toHaveText('请填写活动名称。');
 await page.getByLabel('活动名称').fill('校验活动');await page.getByRole('button',{name:'具体时间',exact:true}).click();await complete(page).click();await expect(page.getByRole('dialog').getByRole('alert')).toContainText('请填写开始时间');
 await page.getByLabel('开始时间',{exact:true}).fill('10:00');await page.getByLabel('结束时间 · 选填').fill('09:00');await complete(page).click();await expect(page.getByRole('dialog').getByRole('alert')).toContainText('结束时间早于开始时间');
 await page.getByLabel('结束时间 · 选填').fill('11:00');await page.getByText('备注与链接',{exact:true}).click();await page.getByLabel('链接',{exact:true}).fill('bad-link');await complete(page).click();await expect(page.getByRole('dialog').getByRole('alert')).toHaveText('请输入完整链接。');
 await page.getByLabel('链接',{exact:true}).fill('https://example.test/');await finish(page);
});

test('completion closes during delayed or failed network sync and persists across reload',async({page})=>{
 await setup(page);await add(page,'同步活动');await expect(page.locator('.sync-status.synced')).toBeVisible();
 let release;const gate=new Promise(resolve=>{release=resolve});let arrived=false;
 await page.route('**/api/trips/*/operations',async route=>{arrived=true;await gate;await route.abort('failed')});
 await edit(page,'同步活动');await page.getByLabel('活动名称').fill('网络中断后保留');await finish(page);await expect.poll(()=>arrived).toBe(true);await expect(page.getByRole('heading',{name:'网络中断后保留',exact:true})).toBeVisible();
 release();await expect(page.locator('.sync-status.offline')).toContainText('连接中断');await page.unroute('**/api/trips/*/operations');await page.reload();await page.getByRole('button',{name:/继续旅程/}).click();await expect(page.getByRole('heading',{name:'网络中断后保留',exact:true})).toBeVisible();await expect(page.locator('.sync-status.synced')).toBeVisible();
});

test('completion skips an already queued blur value and preserves a later collaborator change',async({page})=>{
 await setup(page);await add(page,'失焦竞争活动');await expect(page.locator('.sync-status.synced')).toBeVisible();
 await edit(page,'失焦竞争活动');await page.getByLabel('活动名称').fill('本机先修改的名称');
 const patches=[];
 page.on('request',request=>{
  if(request.method()==='POST'&&/\/api\/trips\/[^/]+\/operations$/.test(request.url())){
   const operation=request.postDataJSON();if(operation.patch?.title==='本机先修改的名称')patches.push(operation);
  }
 });
 await page.evaluate(()=>{
  window.originalPut=IDBObjectStore.prototype.put;window.holdWrite=true;window.heldWriteStarted=false;
  IDBObjectStore.prototype.put=function(value,key){
   const request=window.originalPut.call(this,value,key);
   if(this.name==='kv'&&String(key).startsWith('account:')&&window.holdWrite&&value.queue.some(operation=>operation.patch?.title==='本机先修改的名称')){
    window.heldWriteStarted=true;const store=this;
    const keepAlive=()=>{if(window.holdWrite){const ping=store.get(key);ping.onsuccess=keepAlive}};keepAlive();
   }
   return request;
  };
 });
 await page.getByLabel('活动名称').press('Tab');await expect.poll(()=>page.evaluate(()=>window.heldWriteStarted)).toBe(true);
 await complete(page).click();await expect(complete(page)).toBeDisabled();
 // A remote operation follows the blur edit while its durable local write is held.
 await page.waitForTimeout(150);
 const remote=await page.evaluate(async()=>{
  const session=await fetch('/api/session').then(response=>response.json());
  const headers={'Content-Type':'application/json','X-CSRF-Token':session.csrfToken};
  const tripId=(await fetch('/api/trips').then(response=>response.json())).trips[0].id;
  const snapshot=await fetch(`/api/trips/${tripId}`).then(response=>response.json());
  const object=snapshot.objects.find(object=>object.kind==='activity'&&object.payload.title==='失焦竞争活动');
  const lease=await fetch('/api/clock',{method:'POST',headers,body:JSON.stringify({deviceId:crypto.randomUUID()})}).then(response=>response.json());
  const response=await fetch(`/api/trips/${tripId}/operations`,{method:'POST',headers,body:JSON.stringify({id:crypto.randomUUID(),objectId:object.id,kind:'patch',patch:{title:'同伴后来修改的名称'},clock:{leaseId:lease.leaseId,elapsedMs:0,uncertaintyMs:0}})});
  return response.status;
 });
 expect(remote).toBe(200);await page.waitForTimeout(150);
 await page.evaluate(()=>{window.holdWrite=false;IDBObjectStore.prototype.put=window.originalPut});
 await expect(page.getByRole('dialog')).toHaveCount(0);await expect(page.locator('.sync-status.synced')).toBeVisible();
 expect(patches).toHaveLength(1);await expect(page.getByRole('heading',{name:'同伴后来修改的名称',exact:true})).toBeVisible();
});

test('completion saves a newer field value while its earlier blur write is pending',async({page})=>{
 await setup(page);await add(page,'连续修改活动');await expect(page.locator('.sync-status.synced')).toBeVisible();await edit(page,'连续修改活动');
 await page.getByLabel('活动名称').fill('失焦时名称');
 const titles=[];page.on('request',request=>{if(request.method()==='POST'&&/\/api\/trips\/[^/]+\/operations$/.test(request.url())){const title=request.postDataJSON().patch?.title;if(title)titles.push(title)}});
 await page.evaluate(()=>{
  window.originalPut=IDBObjectStore.prototype.put;window.holdWrite=true;window.heldWriteStarted=false;
  IDBObjectStore.prototype.put=function(value,key){
   const request=window.originalPut.call(this,value,key);
   if(this.name==='kv'&&String(key).startsWith('account:')&&window.holdWrite&&value.queue.some(operation=>operation.patch?.title==='失焦时名称')){
    window.heldWriteStarted=true;const store=this;const keepAlive=()=>{if(window.holdWrite){const ping=store.get(key);ping.onsuccess=keepAlive}};keepAlive();
   }
   return request;
  };
 });
 await page.getByLabel('活动名称').press('Tab');await expect.poll(()=>page.evaluate(()=>window.heldWriteStarted)).toBe(true);
 await page.getByLabel('活动名称').fill('完成时新名称');await complete(page).click();await expect(complete(page)).toBeDisabled();
 await page.evaluate(()=>{window.holdWrite=false;IDBObjectStore.prototype.put=window.originalPut});
 await expect(page.getByRole('dialog')).toHaveCount(0);await expect(page.locator('.sync-status.synced')).toBeVisible();
 expect(titles).toEqual(['失焦时名称','完成时新名称']);await expect(page.getByRole('heading',{name:'完成时新名称',exact:true})).toBeVisible();
});

for(const existing of [false,true])test(`local storage failure leaves a ${existing?'existing':'new'} activity editable for retry`,async({page})=>{
 await setup(page);if(existing){await add(page,'存储活动');await expect(page.locator('.sync-status.synced')).toBeVisible();await edit(page,'存储活动')}else await page.getByRole('button',{name:'添加活动',exact:true}).first().click();await page.getByLabel('活动名称').fill('存储恢复后活动');
 await page.evaluate(()=>{window.originalPut=IDBObjectStore.prototype.put;IDBObjectStore.prototype.put=function(value,key){if(this.name==='kv'&&String(key).startsWith('account:'))throw new DOMException('Test quota exhausted','QuotaExceededError');return window.originalPut.call(this,value,key)}});
 await complete(page).click();await expect(page.getByRole('dialog').getByRole('alert')).toContainText('此设备未能保存修改');await expect(page.getByLabel('活动名称')).toHaveValue('存储恢复后活动');
 await page.evaluate(()=>{IDBObjectStore.prototype.put=window.originalPut});await finish(page);await page.reload();await page.getByRole('button',{name:/继续旅程/}).click();await expect(page.getByRole('heading',{name:'存储恢复后活动',exact:true})).toBeVisible();await expect(page.locator('.sync-status.synced')).toBeVisible();await expect(page.getByRole('alert')).toHaveCount(0);
});

test('reopening and completing leaves activity order and collaborator edits intact',async({page})=>{
 await setup(page);await add(page,'第一项');await add(page,'第二项');await expect(page.locator('.sync-status.synced')).toBeVisible();
 await page.getByRole('button',{name:'拖动排序：第二项',exact:true}).press('ArrowUp');await expect(page.locator('.activity-card h3')).toHaveText(['第二项','第一项']);
 await edit(page,'第一项');await finish(page);await expect(page.locator('.activity-card h3')).toHaveText(['第二项','第一项']);
 await edit(page,'第一项');const other=await page.context().newPage();await other.goto(base);await expect.poll(async()=>await other.getByRole('button',{name:/继续旅程/}).count()||await other.getByRole('heading',{name:'第一项',exact:true}).count()||await other.getByRole('dialog').count()).toBeGreaterThan(0);if(await other.getByRole('button',{name:/继续旅程/}).count())await other.getByRole('button',{name:/继续旅程/}).click();if(!await other.getByRole('dialog').count())await edit(other,'第一项');
 await other.getByText('备注与链接',{exact:true}).click();await other.getByLabel('备注',{exact:true}).fill('同伴刚修改的备注');await finish(other);await expect(other.locator('.sync-status.synced')).toBeVisible();
 await finish(page);await edit(page,'第一项');await expect(page.getByLabel('备注',{exact:true})).toHaveValue('同伴刚修改的备注');await other.close();
});

test('closing an invalid unfinished draft preserves only its edited fields on reopening',async({page})=>{
 await setup(page);await add(page,'未完成修改');await edit(page,'未完成修改');await page.getByRole('button',{name:'具体时间',exact:true}).click();
 await page.keyboard.press('Escape');await edit(page,'未完成修改');await expect(page.getByLabel('开始时间',{exact:true})).toHaveValue('');
 await complete(page).click();await expect(page.getByRole('dialog').getByRole('alert')).toContainText('请填写开始时间');await page.getByLabel('开始时间',{exact:true}).fill('08:00');await finish(page);
});

test('closing during a slow local write cannot close the next activity editor',async({page})=>{
 await setup(page);await add(page,'慢保存活动');await add(page,'另一项活动');await expect(page.locator('.sync-status.synced')).toBeVisible();await edit(page,'慢保存活动');await page.getByLabel('活动名称').fill('慢保存后名称');
 // Hold the first account write by keeping its IndexedDB transaction busy until released.
 await page.evaluate(()=>{
  window.originalPut=IDBObjectStore.prototype.put;window.holdWrite=true;
  IDBObjectStore.prototype.put=function(value,key){const request=window.originalPut.call(this,value,key);if(this.name==='kv'&&String(key).startsWith('account:')&&window.holdWrite){const store=this;const keepAlive=()=>{if(window.holdWrite){const ping=store.get(key);ping.onsuccess=keepAlive}};keepAlive()}return request};
 });
 await complete(page).click();await expect(complete(page)).toBeDisabled();await page.keyboard.press('Escape');await edit(page,'另一项活动');
 await page.evaluate(()=>{window.holdWrite=false;IDBObjectStore.prototype.put=window.originalPut});await expect(page.locator('.sync-status.synced')).toBeVisible();await expect(page.getByRole('dialog')).toBeVisible();await expect(page.getByLabel('活动名称')).toHaveValue('另一项活动');
});


test('WebKit touch completes new and existing activities with one real tap',async()=>{
 const browser=await launchWebKit();
 try{const context=await browser.newContext({viewport:{width:390,height:844},hasTouch:true,isMobile:true});const page=await context.newPage();await setup(page);
  for(let n=0;n<2;n++){await page.getByRole('button',{name:'添加活动',exact:true}).first().tap();await page.getByLabel('活动名称').fill(`触屏活动${n}`);await expect(page.getByLabel('活动名称')).toBeFocused();await complete(page).tap();await expect(page.getByRole('dialog')).toHaveCount(0);await expect(page.getByRole('heading',{name:`触屏活动${n}`,exact:true})).toBeVisible()}
  await page.getByRole('heading',{name:'触屏活动0',exact:true}).tap();await page.getByLabel('活动名称').fill('触屏修改后');await complete(page).tap();await expect(page.getByRole('dialog')).toHaveCount(0);await expect(page.getByRole('heading',{name:'触屏修改后',exact:true})).toBeVisible();await page.getByRole('heading',{name:'触屏修改后',exact:true}).tap();await page.getByRole('combobox',{name:/地点/}).fill('南京站');await expect(page.locator('.activity-place-status').first()).toBeVisible();await complete(page).tap();await expect(page.getByRole('dialog')).toHaveCount(0);
  await page.getByRole('heading',{name:'触屏修改后',exact:true}).tap();await page.getByLabel('活动名称').fill('');await complete(page).tap();await expect(page.getByRole('dialog').getByRole('alert')).toContainText('请填写活动名称');
  await page.getByLabel('活动名称').fill('触屏校验后完成');await complete(page).tap();await expect(page.getByRole('dialog')).toHaveCount(0);await expect(page.getByRole('heading',{name:'触屏校验后完成',exact:true})).toBeVisible();await context.close();
 }finally{await browser.close()}
});

async function openCompanion(page,title){
 const other=await page.context().newPage();await other.goto(base);
 await expect.poll(async()=>await other.getByRole('button',{name:/继续旅程/}).count()||await other.getByRole('heading',{name:title,exact:true}).count()||await other.getByRole('dialog').count()).toBeGreaterThan(0);
 if(await other.getByRole('button',{name:/继续旅程/}).count())await other.getByRole('button',{name:/继续旅程/}).click();
 if(!await other.getByRole('dialog').count())await edit(other,title);return other;
}

test('a blur save completed after closing does not restore an old value over a companion edit',async({page})=>{
 await setup(page);await add(page,'关闭后保存');await edit(page,'关闭后保存');await page.getByLabel('活动名称').fill(' 关闭时的新名称 ');
 await page.evaluate(()=>{window.originalPut=IDBObjectStore.prototype.put;window.holdWrite=true;IDBObjectStore.prototype.put=function(value,key){const request=window.originalPut.call(this,value,key);if(this.name==='kv'&&String(key).startsWith('account:')&&window.holdWrite){const store=this;const keepAlive=()=>{if(window.holdWrite){const ping=store.get(key);ping.onsuccess=keepAlive}};keepAlive()}return request}});
 await page.keyboard.press('Escape');await expect(page.getByRole('dialog')).toHaveCount(0);await page.evaluate(()=>{window.holdWrite=false;IDBObjectStore.prototype.put=window.originalPut});await expect(page.locator('.sync-status.synced')).toBeVisible();
 const other=await openCompanion(page,'关闭时的新名称');await other.getByLabel('活动名称').fill('同伴随后改名');await finish(other);await expect(other.locator('.sync-status.synced')).toBeVisible();
 await edit(page,'同伴随后改名');await expect(page.getByLabel('活动名称')).toHaveValue('同伴随后改名');await finish(page);await other.close();
});

test('local persistence failure remains retryable after closing and reopening the optimistic activity',async({page})=>{
 await setup(page);await add(page,'重新打开重试');await expect(page.locator('.sync-status.synced')).toBeVisible();await edit(page,'重新打开重试');await page.getByLabel('活动名称').fill('仍待本机保存');
 await page.evaluate(()=>{window.originalPut=IDBObjectStore.prototype.put;IDBObjectStore.prototype.put=function(value,key){if(this.name==='kv'&&String(key).startsWith('account:'))throw new DOMException('Test quota exhausted','QuotaExceededError');return window.originalPut.call(this,value,key)}});
 await complete(page).click();await expect(page.getByRole('dialog').getByRole('alert')).toContainText('此设备未能保存修改');await page.keyboard.press('Escape');await edit(page,'仍待本机保存');
 await complete(page).click();await expect(page.getByRole('dialog').getByRole('alert')).toContainText('此设备未能保存修改');
 await page.evaluate(()=>{IDBObjectStore.prototype.put=window.originalPut});await finish(page);await expect(page.locator('.sync-status.synced')).toBeVisible();await page.reload();await page.getByRole('button',{name:/继续旅程/}).click();await expect(page.getByRole('heading',{name:'仍待本机保存',exact:true})).toBeVisible();
});

test('older unfinished input remains recoverable until explicitly restored or discarded',async({page})=>{
 await setup(page);await add(page,'旧输入恢复');await expect(page.locator('.sync-status.synced')).toBeVisible();
 // Let the final navigation save finish before installing a persisted older-format draft.
 await page.waitForTimeout(800);
 await page.evaluate(async()=>{
  const database=await new Promise((resolve,reject)=>{const request=indexedDB.open('journey-v1');request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error)});
  const transaction=database.transaction('kv','readwrite'),store=transaction.objectStore('kv');
  await new Promise((resolve,reject)=>{const request=store.openCursor();request.onerror=()=>reject(request.error);request.onsuccess=()=>{const cursor=request.result;if(!cursor)return resolve();if(String(cursor.key).startsWith('account:')){const account=cursor.value,tripId=account.lastTripId,object=account.snapshots[tripId].objects.find(object=>object.kind==='activity'&&object.payload.title==='旧输入恢复'),key=`activity:${object.id}`;account.contexts[tripId].drafts[key]={...object.payload,notes:'上次尚未保存的备注',time:{...object.payload.time,mode:'precise',start:null},url:'unfinished-link'};delete account.contexts[tripId].drafts[`${key}:editedFields`];cursor.update(account)}cursor.continue()}});
  await new Promise((resolve,reject)=>{transaction.oncomplete=resolve;transaction.onerror=()=>reject(transaction.error)});database.close();
 });
 await page.reload();await page.getByRole('button',{name:/继续旅程/}).click();await edit(page,'旧输入恢复');await expect(page.getByRole('button',{name:'恢复上次输入',exact:true})).toBeVisible();await finish(page);
 await edit(page,'旧输入恢复');await page.getByRole('button',{name:'恢复上次输入',exact:true}).click();await expect(page.getByLabel('备注',{exact:true})).toHaveValue('上次尚未保存的备注');await expect(page.getByLabel('链接',{exact:true})).toHaveValue('unfinished-link');await expect(page.getByLabel('开始时间',{exact:true})).toHaveValue('');
 await complete(page).click();await expect(page.getByRole('dialog').getByRole('alert')).toContainText('请填写开始时间');await page.getByLabel('开始时间',{exact:true}).fill('07:30');await page.getByLabel('链接',{exact:true}).fill('https://example.test/restored');await finish(page);
 await edit(page,'旧输入恢复');await expect(page.getByRole('button',{name:'恢复上次输入',exact:true})).toHaveCount(0);await expect(page.getByLabel('备注',{exact:true})).toHaveValue('上次尚未保存的备注');await finish(page);
});

test('a prefilled map activity still requires durable storage after closing and reopening',async({page})=>{
 await setup(page);await page.getByRole('tab',{name:/第1天/}).click();const nav=page.getByRole('navigation',{name:'主导航',exact:true});await nav.getByRole('button',{name:'地图',exact:true}).click();
 await page.getByRole('textbox',{name:'搜索地点',exact:true}).fill('地图预填活动');await page.getByRole('button',{name:'手动填写',exact:true}).click();await page.getByLabel('名称',{exact:true}).fill('地图预填活动');await page.locator('.map-panel').getByRole('button',{name:'完成',exact:true}).click();await page.getByRole('button',{name:'加入行程',exact:true}).click();
 await expect(page.getByLabel('活动名称')).toHaveValue('地图预填活动');await expect(page.getByLabel('活动名称')).toBeFocused();await expect(page.getByLabel('所在日')).not.toHaveValue('');
 await page.evaluate(()=>{window.originalPut=IDBObjectStore.prototype.put;IDBObjectStore.prototype.put=function(value,key){if(this.name==='kv'&&String(key).startsWith('account:'))throw new DOMException('Test quota exhausted','QuotaExceededError');return window.originalPut.call(this,value,key)}});
 await page.keyboard.press('Escape');await expect(page.locator('.global-notice')).toContainText('此设备未能保存修改');await nav.getByRole('button',{name:'行程',exact:true}).click();await edit(page,'地图预填活动');
 await complete(page).click();await expect(page.getByRole('dialog').getByRole('alert')).toContainText('此设备未能保存修改');
 await page.evaluate(()=>{IDBObjectStore.prototype.put=window.originalPut});await finish(page);await expect(page.locator('.sync-status.synced')).toBeVisible();await expect(page.getByRole('heading',{name:'地图预填活动',exact:true})).toHaveCount(1);
});
test('existing activity editor exposes deletion and undo restores its card',async({page})=>{
 await setup(page);await add(page,'编辑页删除');await edit(page,'编辑页删除');
 await expect(page.getByRole('dialog').getByRole('heading',{name:'编辑页删除',exact:true})).toBeVisible();await expect(page.getByRole('dialog').getByRole('heading',{name:'编辑页删除',exact:true})).toBeFocused();
 await page.getByRole('dialog').getByRole('button',{name:'删除',exact:true}).click();await expect(page.getByRole('dialog')).toHaveCount(0);await expect(page.locator('.activity-card')).toHaveCount(0);await page.getByRole('button',{name:'撤销',exact:true}).click();await expect(page.locator('.activity-card h3')).toHaveText('编辑页删除');
});
test('mobile later action closes an empty activity and restores unfinished input',async({page})=>{
 await page.setViewportSize({width:390,height:844});await setup(page);await page.getByRole('button',{name:'添加活动',exact:true}).first().click();await page.getByRole('button',{name:'稍后继续',exact:true}).click();await expect(page.getByRole('dialog')).toHaveCount(0);await expect(page.locator('.activity-card')).toHaveCount(0);
 await page.getByRole('button',{name:'添加活动',exact:true}).first().click();await page.getByRole('button',{name:'具体时间',exact:true}).click();await expect(page.getByLabel('开始时间',{exact:true})).toBeVisible();await page.getByLabel('活动名称').fill('待定时间的活动');await page.getByRole('button',{name:'稍后继续',exact:true}).click();await expect(page.getByRole('dialog')).toHaveCount(0);await expect(page.locator('.activity-card')).toHaveCount(0);
 await page.getByRole('button',{name:'添加活动',exact:true}).first().click();await expect(page.getByLabel('活动名称')).toHaveValue('待定时间的活动');await expect(page.getByLabel('开始时间',{exact:true})).toHaveValue('');await page.getByLabel('开始时间',{exact:true}).fill('10:00');await finish(page);await expect(page.locator('.activity-card h3')).toHaveText('待定时间的活动');
});
test('a queued activity save remains scoped to its original trip after closing',async({page})=>{
 await setup(page);await add(page,'原旅程活动');await expect(page.locator('.sync-status.synced')).toBeVisible();await edit(page,'原旅程活动');
 // Reach the public journey controller through the mounted editor's React props.
 // Switching directly while persistence is held exercises the lifecycle that a
 // normal home navigation, which waits for persistence, cannot reach.
 await page.evaluate(async()=>{
  const node=document.querySelector('.editor-modal'),key=Object.keys(node).find(key=>key.startsWith('__reactFiber$'));let fiber=node[key];
  while(fiber&&!fiber.memoizedProps?.journey?.captureScope)fiber=fiber.return;
  window.activityTestJourney=fiber.memoizedProps.journey;const j=window.activityTestJourney;window.originalActivityTrip=j.captureScope().tripId;
  const other=await j.api('/api/trips',{method:'POST',body:{id:crypto.randomUUID(),name:'另一旅程',teamMode:'equal',timezone:'Asia/Shanghai',currency:'CNY',dayCount:1,startDate:'2026-11-01',destination:'南京'}});window.otherActivityTrip=other.trip.id;
  await j.openTrip(window.otherActivityTrip);await j.openTrip(window.originalActivityTrip);
 });
 await expect(page.getByLabel('活动名称')).toHaveValue('原旅程活动');await page.getByLabel('活动名称').fill('已进入保存的名称');
 await page.evaluate(()=>{window.originalPut=IDBObjectStore.prototype.put;window.holdWrite=true;window.heldWriteStarted=false;IDBObjectStore.prototype.put=function(value,key){const request=window.originalPut.call(this,value,key);if(this.name==='kv'&&String(key).startsWith('account:')&&window.holdWrite&&value.queue.some(op=>op.patch?.title==='已进入保存的名称')){window.heldWriteStarted=true;const store=this;const ping=()=>{if(window.holdWrite){const request=store.get(key);request.onsuccess=ping}};ping()}return request}});
 const sent=[];page.on('request',request=>{if(request.method()==='POST'&&/\/operations$/.test(request.url()))sent.push({url:request.url(),operation:request.postDataJSON()})});
 await page.getByLabel('活动名称').press('Tab');await expect.poll(()=>page.evaluate(()=>window.heldWriteStarted)).toBe(true);await page.getByLabel('活动名称').fill('仍在原旅程的草稿');await page.getByRole('button',{name:'稍后继续',exact:true}).click();
 await page.evaluate(()=>{window.switchActivityTrip=window.activityTestJourney.openTrip(window.otherActivityTrip)});await expect(page.locator('.trip-title')).toHaveText('另一旅程');
 await page.evaluate(()=>{window.holdWrite=false;IDBObjectStore.prototype.put=window.originalPut});await page.evaluate(()=>window.switchActivityTrip);await expect(page.locator('.sync-status.synced')).toBeVisible();
 const otherId=await page.evaluate(()=>window.otherActivityTrip);expect(sent.filter(entry=>entry.url.endsWith(`/api/trips/${otherId}/operations`))).toHaveLength(0);await expect(page.locator('.activity-card')).toHaveCount(0);
 await page.evaluate(()=>window.activityTestJourney.openTrip(window.originalActivityTrip));await edit(page,'已进入保存的名称');await expect(page.getByLabel('活动名称')).toHaveValue('仍在原旅程的草稿');await finish(page);await expect(page.locator('.activity-card h3')).toHaveText('仍在原旅程的草稿');
});
