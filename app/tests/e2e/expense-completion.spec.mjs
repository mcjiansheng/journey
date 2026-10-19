import {test,expect} from '@playwright/test';
import {fileURLToPath} from 'node:url';
import {createApp,shutdownServer} from '../../server/index.mjs';
let app,server,base,vite;
test.beforeEach(async()=>{
 app=createApp({distPath:fileURLToPath(new URL('../../dist/',import.meta.url)),databasePath:':memory:',securityPath:':memory:',config:{amapKey:''}});
 server=await new Promise(resolve=>{const listener=app.listen(0,'127.0.0.1',()=>resolve(listener))});
 base=`http://127.0.0.1:${server.address().port}`;if(process.env.EXPENSE_TEST_DEV==='1'){const {createServer}=await import('vite');vite=await createServer({server:{host:'127.0.0.1',port:0,proxy:{'/api':base}}});await vite.listen();base=vite.resolvedUrls.local[0].replace(/\/$/,'')}app.locals.config.appOrigin=base;
});
test.afterEach(async()=>{if(vite)await vite.close();if(server)await shutdownServer(server,app)});
async function setup(page){
 await page.goto(base);await page.getByRole('button',{name:'创建账号',exact:true}).click();
 await page.getByLabel('手机号或邮箱').fill(`completion-${crypto.randomUUID()}@example.test`);await page.getByLabel('你的称呼').fill('完成验收');
 await page.getByLabel('密码',{exact:true}).fill('JourneyCompletion2026!');await page.getByLabel('确认密码',{exact:true}).fill('JourneyCompletion2026!');await page.getByRole('button',{name:'创建账号并继续'}).click();
 await page.getByRole('button',{name:'创建旅程',exact:true}).click();await page.getByLabel('旅程名称').fill('活动完成验收');await page.getByLabel('目的地',{exact:true}).fill('南京');
 await page.getByLabel('旅程时区',{exact:true}).selectOption('Asia/Shanghai');await page.getByLabel('出发日期',{exact:true}).fill('2026-11-01');await page.getByLabel('结束日期',{exact:true}).fill('2026-11-03');
 await page.getByRole('dialog').getByRole('button',{name:'创建旅程'}).click();await expect(page.getByRole('tab',{name:/第1天/})).toBeVisible();await page.getByRole('navigation',{name:'主导航',exact:true}).getByRole('button',{name:'费用',exact:true}).click();
}
const complete=page=>page.getByRole('dialog').getByRole('button',{name:'完成',exact:true});
async function finish(page){await complete(page).click();await expect(page.getByRole('dialog')).toHaveCount(0)}
async function openNew(page){await page.getByRole('button',{name:'记一笔',exact:true}).click()}
async function add(page,title,amount='12'){await openNew(page);await page.getByLabel('费用名称').fill(title);await page.getByLabel('实际金额',{exact:true}).fill(amount);await finish(page)}
async function edit(page,title){await page.locator('.expense-title').filter({hasText:title}).click();await expect(page.getByRole('dialog')).toBeVisible()}
async function companion(page){const other=await page.context().newPage();await other.goto(base);await expect(other.getByRole('button',{name:/继续旅程/})).toBeVisible();await other.getByRole('button',{name:/继续旅程/}).click();await other.getByRole('navigation',{name:'主导航',exact:true}).getByRole('button',{name:'费用',exact:true}).click();return other}
async function failStorage(page){await page.evaluate(()=>{window.originalPut=IDBObjectStore.prototype.put;IDBObjectStore.prototype.put=function(value,key){if(this.name==='kv'&&String(key).startsWith('account:'))throw new DOMException('Test quota exhausted','QuotaExceededError');return window.originalPut.call(this,value,key)}})}
async function restoreStorage(page){await page.evaluate(()=>{IDBObjectStore.prototype.put=window.originalPut})}
async function holdStorage(page,title){await page.evaluate(title=>{window.originalPut=IDBObjectStore.prototype.put;window.holdWrite=true;window.heldWriteStarted=false;IDBObjectStore.prototype.put=function(value,key){const request=window.originalPut.call(this,value,key);if(this.name==='kv'&&String(key).startsWith('account:')&&window.holdWrite&&value.queue.some(op=>op.patch?.title===title)){window.heldWriteStarted=true;const store=this;const keepAlive=()=>{if(window.holdWrite){const ping=store.get(key);ping.onsuccess=keepAlive}};keepAlive()}return request}},title)}
async function releaseStorage(page){await page.evaluate(()=>{window.holdWrite=false;IDBObjectStore.prototype.put=window.originalPut})}

test('empty paid completion validates without creating; unnamed zero and estimated null amounts save',async({page})=>{
 await setup(page);await openNew(page);await complete(page).click();await expect(page.getByRole('dialog').getByRole('alert')).toContainText('请填写已支付金额');await page.getByRole('dialog').getByRole('button',{name:'关闭',exact:true}).click();await expect(page.locator('.expense-row')).toHaveCount(0);
 await add(page,'','0');await expect(page.locator('.expense-title')).toHaveText('已支付 · ¥0.00');
 await openNew(page);await page.getByRole('dialog').getByRole('button',{name:'预计',exact:true}).click();await finish(page);await expect(page.locator('.expense-row')).toHaveCount(2);await expect(page.locator('.expense-title').last()).toHaveText('预计 · 金额待定');
 await page.reload();await page.getByRole('button',{name:/继续旅程/}).click();await expect(page.locator('.expense-row')).toHaveCount(2);
});
test('completion validates paid and currency amounts and keeps input',async({page})=>{
 await setup(page);await openNew(page);await page.getByLabel('费用名称').fill('校验');await complete(page).click();await expect(page.getByRole('dialog').getByRole('alert')).toContainText('请填写已支付金额');
 for(const amount of ['-1','abc','1.234']){await page.getByLabel('实际金额',{exact:true}).fill(amount);await complete(page).click();await expect(page.getByRole('dialog').getByRole('alert')).toContainText('有效金额');await expect(page.getByLabel('实际金额',{exact:true})).toHaveValue(amount)}
 await page.getByLabel('实际金额',{exact:true}).fill('1.5');await page.getByLabel('币种').selectOption('JPY');await complete(page).click();await expect(page.getByRole('dialog').getByRole('alert')).toContainText('有效金额');await page.getByLabel('实际金额',{exact:true}).fill('1');await finish(page);
});
test('clean fields follow a companion while local dirty input survives and reopening writes nothing',async({page})=>{
 await setup(page);await add(page,'双会话');await expect(page.locator('.sync-status.synced')).toBeVisible();const other=await companion(page);await edit(page,'双会话');await page.getByLabel('备注',{exact:true}).fill('本地备注');
 await edit(other,'双会话');await other.getByLabel('费用名称').fill('同伴名称');await other.getByLabel('实际金额',{exact:true}).fill('25');await finish(other);await expect(other.locator('.sync-status.synced')).toBeVisible();
 await expect(page.getByLabel('费用名称')).toHaveValue('同伴名称');await expect(page.getByLabel('实际金额',{exact:true})).toHaveValue('25');await expect(page.getByLabel('备注',{exact:true})).toHaveValue('本地备注');await finish(page);await expect(page.locator('.sync-status.synced')).toBeVisible();
 const patches=[];page.on('request',request=>{if(request.method()==='POST'&&/\/operations$/.test(request.url()))patches.push(request.postDataJSON())});await edit(page,'同伴名称');await page.getByLabel('费用名称').press('Tab');await finish(page);expect(patches).toHaveLength(0);await other.close();
});
test('completion skips its queued blur and preserves later input during local persistence',async({page})=>{
 await setup(page);await add(page,'保存竞争');await expect(page.locator('.sync-status.synced')).toBeVisible();await edit(page,'保存竞争');await page.getByLabel('费用名称').fill('失焦名称');await holdStorage(page,'失焦名称');
 const titles=[];page.on('request',request=>{if(request.method()==='POST'&&/\/operations$/.test(request.url())){const title=request.postDataJSON().patch?.title;if(title)titles.push(title)}});
 await page.getByLabel('费用名称').press('Tab');await expect.poll(()=>page.evaluate(()=>window.heldWriteStarted)).toBe(true);await page.getByLabel('费用名称').fill('最新名称');await complete(page).click();await expect(complete(page)).toBeDisabled();await releaseStorage(page);await expect(page.getByRole('dialog')).toHaveCount(0);await expect(page.locator('.sync-status.synced')).toBeVisible();expect(titles).toEqual(['失焦名称','最新名称']);
 await edit(page,'最新名称');await page.getByLabel('费用名称').fill('单次名称');await holdStorage(page,'单次名称');await page.getByLabel('费用名称').press('Tab');await expect.poll(()=>page.evaluate(()=>window.heldWriteStarted)).toBe(true);await complete(page).click();await releaseStorage(page);await expect(page.getByRole('dialog')).toHaveCount(0);await expect(page.locator('.sync-status.synced')).toBeVisible();expect(titles.filter(title=>title==='单次名称')).toHaveLength(1);
});
test('offline changes persist through reopening then sync',async({page})=>{
 await setup(page);await add(page,'离线费用');await expect(page.locator('.sync-status.synced')).toBeVisible();await page.context().setOffline(true);await edit(page,'离线费用');await page.getByLabel('备注',{exact:true}).fill('离线备注');await finish(page);await edit(page,'离线费用');await expect(page.getByLabel('备注',{exact:true})).toHaveValue('离线备注');await finish(page);await page.context().setOffline(false);await expect(page.locator('.sync-status.synced')).toBeVisible();await page.reload();await page.getByRole('button',{name:/继续旅程/}).click();await edit(page,'离线费用');await expect(page.getByLabel('备注',{exact:true})).toHaveValue('离线备注');
});
test('failed local create remains retryable after reopening with one create operation',async({page})=>{
 await setup(page);await openNew(page);await page.getByLabel('费用名称').fill('存储恢复');await page.getByLabel('实际金额',{exact:true}).fill('0');await failStorage(page);await complete(page).click();await expect(page.getByRole('dialog').getByRole('alert')).toContainText('此设备未能保存修改');await page.getByRole('dialog').getByRole('button',{name:'关闭',exact:true}).click();await edit(page,'存储恢复');await complete(page).click();await expect(page.getByRole('dialog').getByRole('alert')).toContainText('此设备未能保存修改');
 const creates=[];page.on('request',request=>{if(request.method()==='POST'&&/\/operations$/.test(request.url())){const op=request.postDataJSON();if(op.kind==='create'&&op.objectType==='expense')creates.push(op)}});await restoreStorage(page);await finish(page);await expect(page.locator('.sync-status.synced')).toBeVisible();expect(creates).toHaveLength(1);await expect(page.locator('.expense-row')).toHaveCount(1);
});
test('an old completion cannot close a newly opened expense editor',async({page})=>{
 await setup(page);await add(page,'慢费用');await add(page,'另一费用');await expect(page.locator('.sync-status.synced')).toBeVisible();await edit(page,'慢费用');await page.getByLabel('费用名称').fill('慢保存名称');await holdStorage(page,'慢保存名称');await complete(page).click();await expect(complete(page)).toBeDisabled();await page.getByRole('dialog').getByRole('button',{name:'关闭',exact:true}).click();await edit(page,'另一费用');await releaseStorage(page);await expect(page.locator('.sync-status.synced')).toBeVisible();await expect(page.getByLabel('费用名称')).toHaveValue('另一费用');await finish(page);
});
test('legacy expense input stays recoverable until an explicit choice',async({page})=>{
 await setup(page);await add(page,'旧草稿');await expect(page.locator('.sync-status.synced')).toBeVisible();await page.waitForTimeout(800);
 await page.evaluate(async()=>{const database=await new Promise((resolve,reject)=>{const request=indexedDB.open('journey-v1');request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error)});const transaction=database.transaction('kv','readwrite'),store=transaction.objectStore('kv');await new Promise((resolve,reject)=>{const request=store.openCursor();request.onerror=()=>reject(request.error);request.onsuccess=()=>{const cursor=request.result;if(!cursor)return resolve();if(String(cursor.key).startsWith('account:')){const account=cursor.value,tripId=account.lastTripId,object=account.snapshots[tripId].objects.find(o=>o.kind==='expense'),key=`expense:${object.id}`;account.contexts[tripId].drafts[key]={...object.payload,amount:'34',notes:'上次备注'};delete account.contexts[tripId].drafts[`${key}:editedFields`];cursor.update(account)}cursor.continue()}});await new Promise((resolve,reject)=>{transaction.oncomplete=resolve;transaction.onerror=()=>reject(transaction.error)});database.close()});
 await page.reload();await page.getByRole('button',{name:/继续旅程/}).click();await edit(page,'旧草稿');await expect(page.getByLabel('备注',{exact:true})).toHaveValue('');await finish(page);await edit(page,'旧草稿');await page.getByRole('button',{name:'恢复上次输入',exact:true}).click();await expect(page.getByLabel('备注',{exact:true})).toHaveValue('上次备注');await expect(page.getByLabel('实际金额',{exact:true})).toHaveValue('34');await finish(page);await edit(page,'旧草稿');await expect(page.getByRole('button',{name:'恢复上次输入',exact:true})).toHaveCount(0);
});

test('an earlier blur preserves newer input when the same expense reopens',async({page})=>{
 await setup(page);await add(page,'重新编辑');await expect(page.locator('.sync-status.synced')).toBeVisible();await edit(page,'重新编辑');await page.getByLabel('费用名称').fill('旧编辑器已提交');await holdStorage(page,'旧编辑器已提交');await page.getByLabel('费用名称').press('Tab');await expect.poll(()=>page.evaluate(()=>window.heldWriteStarted)).toBe(true);
 await page.getByRole('dialog').getByRole('button',{name:'关闭',exact:true}).click();await edit(page,'旧编辑器已提交');await page.getByLabel('费用名称').fill('新编辑器的输入');await releaseStorage(page);await expect(page.locator('.sync-status.synced')).toBeVisible();await expect(page.getByLabel('费用名称')).toHaveValue('新编辑器的输入');await finish(page);await expect(page.locator('.expense-title')).toHaveText('新编辑器的输入');
});
test('invalid amount remains a draft while another expense group saves independently',async({page})=>{
 await setup(page);await add(page,'独立字段');await expect(page.locator('.sync-status.synced')).toBeVisible();await edit(page,'独立字段');await page.getByLabel('实际金额',{exact:true}).fill('invalid');await page.getByLabel('备注',{exact:true}).fill('可单独保存的备注');await page.getByLabel('备注',{exact:true}).press('Tab');await expect(page.locator('.sync-status.synced')).toBeVisible();await page.getByRole('dialog').getByRole('button',{name:'关闭',exact:true}).click();await expect(page.locator('.expense-info p')).toHaveText('可单独保存的备注');await edit(page,'独立字段');await expect(page.getByLabel('实际金额',{exact:true})).toHaveValue('invalid');await complete(page).click();await expect(page.getByRole('dialog').getByRole('alert')).toContainText('有效金额');await page.getByLabel('实际金额',{exact:true}).fill('0');await finish(page);
});
