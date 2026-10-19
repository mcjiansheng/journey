import {test,expect} from '@playwright/test';
import {fileURLToPath} from 'node:url';
import {createApp,shutdownServer} from '../../server/index.mjs';

let app,server,base;
test.beforeEach(async()=>{
 app=createApp({distPath:fileURLToPath(new URL('../../dist/',import.meta.url)),databasePath:':memory:',securityPath:':memory:',config:{amapKey:''}});
 server=await new Promise(resolve=>{const listener=app.listen(0,'127.0.0.1',()=>resolve(listener))});
 base=`http://127.0.0.1:${server.address().port}`;app.locals.config.appOrigin=base;
});
test.afterEach(async()=>{if(server)await shutdownServer(server,app)});

async function api(page,path,method='GET',body){
 return page.evaluate(async({path,method,body})=>{
  const session=await fetch('/api/session').then(r=>r.json());
  const response=await fetch(path,{method,headers:{'Content-Type':'application/json','X-CSRF-Token':session.csrfToken},...(body===undefined?{}:{body:JSON.stringify(body)})});
  return {status:response.status,data:await response.json()};
 },{path,method,body});
}
async function setup(page,{trip=true}={}){
 await page.goto(base);await page.getByRole('button',{name:'创建账号',exact:true}).click();
 await page.getByLabel('手机号或邮箱').fill(`sync-${crypto.randomUUID()}@example.test`);await page.getByLabel('你的称呼').fill('同步验收');
 await page.getByLabel('密码',{exact:true}).fill('JourneySync2026!');await page.getByLabel('确认密码',{exact:true}).fill('JourneySync2026!');await page.getByRole('button',{name:'创建账号并继续'}).click();
 await expect(page.getByRole('heading',{name:'我的旅程',exact:true})).toBeVisible();
 if(!trip)return;
 const result=await api(page,'/api/trips','POST',{id:crypto.randomUUID(),name:'同步恢复验收',destination:'南京',teamMode:'admin',timezone:'Asia/Shanghai',currency:'CNY',startDate:'2026-11-01',dayCount:2});
 expect(result.status).toBe(201);
 await page.reload();await page.getByRole('button',{name:/同步恢复验收/}).click();await expect(page.locator('.sync-status.synced')).toBeVisible();
 return result.data.trip.id;
}
async function storedAccount(page){
 return page.evaluate(async()=>{
  const database=await new Promise((resolve,reject)=>{const r=indexedDB.open('journey-v1');r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error)});
  const read=key=>new Promise((resolve,reject)=>{const r=database.transaction('kv').objectStore('kv').get(key);r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error)});
  const user=await read('activeUser'),account=await read(`account:${user}`);database.close();return account;
 });
}
async function seedBlocked(page,tripId){
 // Wait for the navigation debounce before installing an old, durable offline queue.
 await page.waitForTimeout(800);
 return page.evaluate(async tripId=>{
  const database=await new Promise((resolve,reject)=>{const r=indexedDB.open('journey-v1');r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error)});
  const read=key=>new Promise((resolve,reject)=>{const r=database.transaction('kv').objectStore('kv').get(key);r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error)});
  const user=await read('activeUser'),account=await read(`account:${user}`),objectId=crypto.randomUUID();
  const clock={leaseId:null,elapsedMs:0,uncertaintyMs:0,uncertain:true};
  account.queue=[
   {id:crypto.randomUUID(),tripId,objectId,kind:'create',objectType:'expense',patch:{title:'较早输入',payment:{status:'paid',amountMinor:100,currency:'CNY'},notes:'',activityId:null},clock,blocked:'CLOCK_UNCERTAIN'},
   {id:crypto.randomUUID(),tripId,objectId,kind:'patch',patch:{title:'较新输入'},clock}
  ];
  account.contexts[tripId].drafts['unfinished-test']={notes:'仍要保留的输入'};
  await new Promise((resolve,reject)=>{const t=database.transaction('kv','readwrite');t.objectStore('kv').put(account,`account:${user}`);t.oncomplete=resolve;t.onerror=()=>reject(t.error)});
  database.close();return objectId;
 },tripId);
}
async function openRecovery(page){
 await page.getByRole('button',{name:'查看保存与同步',exact:true}).click();
 await expect(page.locator('.sync-recovery-group')).toHaveCount(1);
}

test('cached startup and failed uploads stay offline while the browser itself is online',async({page})=>{
 await setup(page);await page.route('**/api/**',route=>route.abort('failed'));await page.reload();
 await expect(page.getByText('暂时无法更新旅程列表，以下显示本机保留的旅程。')).toBeVisible();
 expect(await page.evaluate(()=>navigator.onLine)).toBe(true);
 await page.getByRole('button',{name:/继续旅程/}).click();await expect(page.locator('.sync-status.offline')).toHaveText('连接中断');
 await page.getByRole('button',{name:'添加活动',exact:true}).first().click();await page.getByLabel('活动名称').fill('断线时的输入');await page.getByRole('dialog').getByRole('button',{name:'完成',exact:true}).click();
 await expect(page.getByRole('heading',{name:'断线时的输入',exact:true})).toBeVisible();await expect(page.locator('.sync-status.synced,.sync-status.syncing')).toHaveCount(0);
 await page.unroute('**/api/**');
});

test('a failed empty trip list is distinguished from a confirmed empty list',async({page})=>{
 await setup(page,{trip:false});await expect(page.getByRole('heading',{name:'还没有旅程',exact:true})).toBeVisible();
 await page.route('**/api/trips',route=>route.abort('failed'));await page.reload();
 await expect(page.getByText('旅程列表加载失败。',{exact:true})).toBeVisible();await expect(page.getByRole('heading',{name:'还没有旅程',exact:true})).toHaveCount(0);
 await page.unroute('**/api/trips');await page.getByRole('button',{name:'重新加载旅程',exact:true}).click();await expect(page.getByRole('heading',{name:'还没有旅程',exact:true})).toBeVisible();
});

test('opening an uncached trip exposes the failure and supports retry',async({page})=>{
 await setup(page,{trip:false});const id=crypto.randomUUID();
 await api(page,'/api/trips','POST',{id,name:'尚未缓存的旅程',destination:'南京',teamMode:'admin',timezone:'Asia/Shanghai',currency:'CNY',startDate:'2026-11-01',dayCount:1});
 await page.reload();await page.route(`**/api/trips/${id}`,route=>route.abort('failed'));await page.getByRole('button',{name:/尚未缓存的旅程/}).click();
 await expect(page.getByRole('alert').filter({hasText:'打开旅程失败'})).toBeVisible();await page.unroute(`**/api/trips/${id}`);
 await page.getByRole('button',{name:'重新打开旅程',exact:true}).click();await expect(page.locator('.sync-status.synced')).toBeVisible();
});

test('recovery survives banner dismissal and reload, and reapplies the complete suffix in order',async({page})=>{
 const tripId=await setup(page),objectId=await seedBlocked(page,tripId);await page.reload();
 const dismiss=page.getByRole('button',{name:'关闭提示',exact:true});if(await dismiss.count())await dismiss.click();
 await openRecovery(page);await expect(page.getByText('2 项修改需要处理',{exact:true})).toBeVisible();await page.getByRole('dialog').getByRole('button',{name:'关闭',exact:true}).click();
 await page.reload();await openRecovery(page);await page.getByRole('button',{name:'重新应用',exact:true}).click();
 const confirmation=page.getByRole('dialog',{name:'重新应用修改',exact:true});await expect(confirmation.locator('li')).toHaveCount(2);await confirmation.getByRole('button',{name:'确认重新应用',exact:true}).click();
 await expect(page.locator('.sync-recovery-group')).toHaveCount(0);
 await expect.poll(async()=>{const r=await api(page,`/api/trips/${tripId}`);return r.data.objects.find(o=>o.id===objectId)?.payload.title}).toBe('较新输入');
 expect((await storedAccount(page)).queue).toHaveLength(0);
});

test('discard waits for durable storage, removes the previewed changes, and retains drafts',async({page})=>{
 const tripId=await setup(page),objectId=await seedBlocked(page,tripId);await page.reload();await openRecovery(page);
 await page.setViewportSize({width:390,height:844});await page.getByRole('button',{name:'放弃这些修改',exact:true}).click();
 const confirmation=page.getByRole('dialog',{name:'放弃待上传修改',exact:true});await expect(confirmation.locator('li')).toHaveCount(2);
 expect(await confirmation.evaluate(el=>el.scrollWidth<=el.clientWidth)).toBe(true);
 await page.evaluate(()=>{window.originalPut=IDBObjectStore.prototype.put;IDBObjectStore.prototype.put=function(value,key){if(this.name==='kv'&&String(key).startsWith('account:'))throw new DOMException('Test quota exhausted','QuotaExceededError');return window.originalPut.call(this,value,key)}});
 await confirmation.getByRole('button',{name:'确认放弃',exact:true}).click();await expect(confirmation.getByRole('alert')).toContainText('此设备未能保存修改');
 expect((await storedAccount(page)).queue).toHaveLength(2);
 await page.evaluate(()=>{IDBObjectStore.prototype.put=window.originalPut});await confirmation.getByRole('button',{name:'确认放弃',exact:true}).click();await expect(confirmation).toHaveCount(0);await expect(page.locator('.sync-recovery-group')).toHaveCount(0);
 const stored=await storedAccount(page);expect(stored.queue).toHaveLength(0);expect(stored.contexts[tripId].drafts['unfinished-test']).toEqual({notes:'仍要保留的输入'});
 const r=await api(page,`/api/trips/${tripId}`);expect(r.data.objects.find(o=>o.id===objectId)).toBeUndefined();
});

test('an unknown submission requires an explicit retry before discard becomes available',async({page})=>{
 const tripId=await setup(page);
 await page.route('**/api/trips/*/operations',route=>route.abort('failed'));
 await page.getByRole('button',{name:'添加活动',exact:true}).first().click();await page.getByLabel('活动名称').fill('尚未到达服务端');await page.getByRole('dialog').getByRole('button',{name:'完成',exact:true}).click();
 await expect(page.locator('.sync-status.offline')).toBeVisible();
 expect((await api(page,`/api/trips/${tripId}`)).data.objects.some(o=>o.kind==='activity')).toBe(false);
 await page.locator('.sync-status').click();
 await expect(page.getByRole('button',{name:'放弃这些修改',exact:true})).toBeDisabled();
 await expect(page.getByText('有修改的提交结果尚未确认。重试会继续提交这些修改，确认结果后再处理其余内容。',{exact:true})).toBeVisible();
 await page.unroute('**/api/trips/*/operations');await page.getByRole('button',{name:'重试并确认结果',exact:true}).click();
 await expect(page.locator('.sync-recovery-group')).toHaveCount(0);
 const snapshot=(await api(page,`/api/trips/${tripId}`)).data;
 expect(snapshot.objects.filter(o=>o.kind==='activity').map(o=>o.payload.title)).toEqual(['尚未到达服务端']);
});
