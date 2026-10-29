import test from 'node:test';
import {previewReschedule} from '../src/domain.js';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Script } from 'node:vm';
import { randomUUID } from 'node:crypto';
import { performance } from 'node:perf_hooks';

// Exercise the real singleton controller with isolated browser storage and transport.
const controllerSource = readFileSync(new URL('../src/sync.js', import.meta.url), 'utf8')
  .replace("import { useSyncExternalStore } from 'react';", '')
  .replace("import { openDB } from 'idb';", '')
  .replace("import { previewReschedule } from './domain.js';", '')
  .replace('import.meta.env.BASE_URL', "'/journey/'")
  .replaceAll('export ', '');

function fixture() {
  const users = {
    A: { id: 'A', displayName: 'Alice', preferences: {} },
    B: { id: 'B', displayName: 'Bob', preferences: {} },
  };
  const pendingOperation = {
    id: 'b-pending', tripId: 'B-trip', objectId: 'B-trip', kind: 'patch',
    patch: { name: 'Bob pending change' }, blocked: 'CLOCK_UNCERTAIN',
    clock: { leaseId: null, elapsedMs: 0, uncertaintyMs: 0, uncertain: true },
  };
  const storage = new Map([['account:B', {
    user: users.B, trips: [{ id: 'B-trip' }], snapshots: {}, contexts: {},
    queue: [pendingOperation], lastTripId: null,
  }]]);
  const posted = [];
  const deferred = {};
  let currentUser;
  const response = data => ({ ok: true, json: async () => structuredClone(data) });
  const fetch = async (url, options) => {
    const path = url.replace('/journey', '');
    if (path === '/api/auth/login') {
      currentUser = JSON.parse(options.body).identifier;
      return response({ user: users[currentUser], csrfToken: `${currentUser}-csrf` });
    }
    if (path === '/api/auth/logout') return response({ ok: true });
    if (path === '/api/clock') return response({
      leaseId: `${currentUser}-lease`, serverTime: Date.now(), expiresAt: Date.now() + 100000,
    });
    if (path === '/api/trips') return response({
      trips: currentUser === 'B' ? [{ id: 'B-trip' }] : [], navigation: {},
    });
    if (path === '/api/me') return new Promise(resolve => {
      deferred.profile = () => resolve(response({ ...users.A, displayName: 'Alice changed' }));
    });
    if (path === '/api/session') return new Promise(resolve => {
      deferred.session = () => resolve(response({ user: users.A, csrfToken: 'A-csrf' }));
    });
    if (path === '/api/trips/B-trip/operations') {
      posted.push(JSON.parse(options.body));
      return response({ snapshot: { trip: { id: 'B-trip' }, objects: [], cursor: 1, epoch: 1 } });
    }
    throw new Error(`Unexpected test request: ${path}`);
  };
  const sandbox = {
    fetch, structuredClone, performance, crypto: { randomUUID },
    openDB: async () => ({
      get: async (_, key) => structuredClone(storage.get(key)),
      put: async (_, value, key) => storage.set(key, structuredClone(value)),
      delete: async (_, key) => storage.delete(key),
    }),
    previewReschedule, useSyncExternalStore() {}, navigator: { onLine: true },
    window: { addEventListener() {} },
    document: { addEventListener() {}, visibilityState: 'hidden' },
    setTimeout, clearTimeout, setInterval() {},
  };
  const subject = new Script(`(function () {
    ${controllerSource}
    return { login, logout, updateProfile, retry, persistLocal, setError, getState: () => state };
  })()`).runInNewContext(sandbox);
  const login = identifier => subject.login({ identifier, password: 'long-test-password' });
  return { subject, login, storage, posted, deferred };
}

test('a delayed profile response cannot overwrite another account or its cache', async () => {
  const f = fixture();
  await f.login('A');
  const pending = f.subject.updateProfile({ displayName: 'Alice changed' });
  pending.catch(() => {});
  await f.subject.logout();
  await f.login('B');
  f.deferred.profile();
  await assert.rejects(pending, { code: 'SESSION_CHANGED' });
  assert.equal(f.subject.getState().user.id, 'B');
  assert.deepEqual(f.storage.get('account:A').trips, []);
  assert.equal(f.storage.get('account:B').queue[0].id, 'b-pending');
});

test('a previous account reapply cannot rewrite or upload the next account pending edits', async () => {
  const f = fixture();
  await f.login('A');
  const pending = f.subject.retry({ reapply: true });
  pending.catch(() => {});
  await f.subject.logout();
  await f.login('B');
  f.deferred.session();
  await assert.rejects(pending, { code: 'SESSION_CHANGED' });
  assert.equal(f.subject.getState().user.id, 'B');
  assert.equal(f.posted.length, 0);
  const operation = f.storage.get('account:B').queue[0];
  assert.equal(operation.id, 'b-pending');
  assert.equal(operation.blocked, 'CLOCK_UNCERTAIN');
  assert.equal(operation.clock.uncertain, true);
});

test('durable local completion preserves blocked sync errors and clears recovered storage errors', async () => {
  const blocked = fixture();
  await blocked.login('B');
  blocked.subject.setError(Object.assign(new Error('The edit clock needs review'), { code: 'CLOCK_UNCERTAIN' }));
  await blocked.subject.persistLocal();
  assert.equal(blocked.subject.getState().error.code, 'CLOCK_UNCERTAIN');
  assert.equal(blocked.subject.getState().status, 'error');
  assert.equal(blocked.posted.length, 0);

  const recovered = fixture();
  await recovered.login('A');
  recovered.subject.setError(Object.assign(new Error('Device storage was full'), { code: 'LOCAL_STORAGE' }));
  await recovered.subject.persistLocal();
  assert.equal(recovered.subject.getState().error, null);
  assert.equal(recovered.subject.getState().status, 'synced');
});

function recoveryFixture(queue, options={}) {
  const posts=[],storage=new Map();let handler=options.handler,failStorage=false,putCount=0;
  const snapshot=id=>({trip:{id,name:id},objects:id==='t'?(options.objects||[]):[],cursor:1,epoch:1});
  const ok=data=>({ok:true,json:async()=>structuredClone(data)});
  const sandbox={structuredClone,performance:options.performance||performance,crypto:{randomUUID},previewReschedule,navigator:{onLine:true},
    window:{addEventListener(){}},document:{addEventListener(){},visibilityState:'hidden'},setTimeout,clearTimeout,setInterval(){},useSyncExternalStore(){},
    openDB:async()=>({put:async(_,value,key)=>{putCount++;if(options.beforePut)await options.beforePut();if(failStorage)throw new Error('full');storage.set(key,structuredClone(value));},delete:async(_,key)=>storage.delete(key)}),
    fetch:async(url,request)=>{
      const path=url.replace('/journey','');
      if(path==='/api/auth/logout')return ok({ok:true});
      if(path==='/api/clock'&&options.clock)return ok(await options.clock());
      if(path==='/api/clock')return ok({leaseId:'lease',serverTime:Date.now(),expiresAt:Date.now()+100000});
      if(path.endsWith('/operations')){const body=JSON.parse(request.body);posts.push(body);if(handler){const result=await handler(body,path);if(result)return result;}return ok({snapshot:snapshot(path.split('/')[3])});}
      if(path.startsWith('/api/trips/'))return ok(snapshot(path.split('/')[3]));
      throw new Error('Unexpected '+path);
    }};
  const subject=new Script(`(function(){${controllerSource}
    account={user:{id:'A',preferences:{}},trips:[{id:'t',name:'Trip'},{id:'other',name:'Other'}],snapshots:{t:${JSON.stringify(snapshot('t'))}},contexts:{},queue:${JSON.stringify(queue)}};
    csrf='csrf';selected='t';connection='current';lease={leaseId:'lease',uncertaintyMs:2,serverTime:Date.now(),expiresAt:Date.now()+100000};leasePerformance=performance.now();leaseWall=Date.now();renderAccount();
    return {flush,logout,ensureClock,getRecoveryPaused:()=>recoveryPaused,reapplyPending,discardPending,retryPending,clearError,mutate,captureScope,setContext,updateDrafts,persistLocal,
      expireLease:()=>{lease.expiresAt=lease.serverTime-1;},withLocal:job=>serializeLocal(job),select:id=>{selected=id;renderAccount();},getState:()=>state,getQueue:()=>clone(account.queue),add:op=>{account.queue.push(op);renderAccount();},switchAccount:(queue=[])=>{authEpoch++;account=emptyAccount({id:'B'});account.queue=clone(queue);selected=null;renderAccount();}};
  })()`).runInNewContext(sandbox);
  return {subject,posts,storage,getPutCount:()=>putCount,setHandler:fn=>handler=fn,failStorage:()=>{failStorage=true;},restoreStorage:()=>{failStorage=false;}};
}
const queued=(id,tripId='t',extra={})=>({id,tripId,objectId:tripId,kind:'patch',patch:{name:id},generation:0,clock:{leaseId:'lease',elapsedMs:0,uncertaintyMs:2},...extra});
const failed=(code,status=409)=>({ok:false,status,json:async()=>({error:{code,message:code}})});

test('a rejected operation blocks its trip suffix while other trips continue; dismissing error preserves recovery',async()=>{
  const f=recoveryFixture([queued('first'),queued('later'),queued('independent','other')],{handler:body=>body.id==='first'?failed('STALE'):null});
  await f.subject.flush();
  assert.deepEqual(f.posts.map(x=>x.id),['first','independent']);
  f.subject.clearError();
  assert.equal(f.subject.getState().status,'blocked');
  assert.deepEqual(Array.from(f.subject.getState().pendingRecoveryGroups[0].opIds),['first','later']);
  assert.equal(f.subject.getQueue()[0].generation,0);
});

test('a lost receipt remains offline and is retried using identical operation content',async()=>{
  let attempts=0;
  const f=recoveryFixture([queued('first'),queued('later')],{handler:()=>{if(attempts++===0)throw new Error('connection lost');}});
  await f.subject.flush();
  assert.equal(f.subject.getState().status,'offline');
  assert.equal(f.subject.getQueue()[0].receiptUnknown,true);
  assert.equal(f.subject.getState().pendingRecoveryGroups[0].canReapply,false);
  await f.subject.retryPending('first');
  assert.deepEqual(f.posts[0],f.posts[1]);
  assert.deepEqual(f.posts.map(x=>x.id),['first','first','later']);
  assert.equal(f.subject.getState().status,'synced');
});

test('reapplying a confirmed suffix shares a clock and preserves original order, object identity and generation',async()=>{
  const f=recoveryFixture([queued('first','t',{blocked:'CLOCK_UNCERTAIN',clock:{uncertain:true}}),queued('later','t',{generation:3}),queued('fixed','t',{blocked:'STALE',generation:4})]);
  const preview=f.subject.getState().pendingRecoveryGroups[0];
  await f.subject.reapplyPending(preview);
  await f.subject.flush();
  // Recovery's automatic flush can still be finishing when the action resolves.
  await new Promise(resolve=>setTimeout(resolve,5));
  assert.equal(f.posts.length,2);
  assert.ok(f.posts[0].id<f.posts[1].id);
  assert.deepEqual(f.posts[0].clock,f.posts[1].clock);
  assert.equal(f.posts[1].generation,3);
  assert.equal(f.posts[0].objectId,'t');
  assert.equal(f.subject.getQueue()[0].blocked,'STALE');
});

test('changed confirmation refuses a newly expanded suffix',async()=>{
  const f=recoveryFixture([queued('first','t',{blocked:'CLOCK_UNCERTAIN',clock:{uncertain:true}})]);
  const preview=f.subject.getState().pendingRecoveryGroups[0];
  f.subject.add(queued('new'));
  await assert.rejects(f.subject.discardPending(preview),e=>e.code==='RECOVERY_CHANGED'&&e.details.preview.opIds.length===2);
  assert.equal(f.subject.getQueue().length,2);
});

test('failed durable recovery retains the original queued operation',async()=>{
  const f=recoveryFixture([queued('first','t',{blocked:'CLOCK_UNCERTAIN',clock:{uncertain:true}})]);
  const original=f.subject.getQueue();f.failStorage();
  await assert.rejects(f.subject.reapplyPending(f.subject.getState().pendingRecoveryGroups[0]),{code:'LOCAL_STORAGE'});
  assert.deepEqual(f.subject.getQueue(),original);
});

test('object-level 403 keeps trip membership after successful authoritative access check',async()=>{
  const f=recoveryFixture([queued('first'),queued('later')],{handler:()=>failed('OBJECT_FORBIDDEN',403)});
  await f.subject.flush();
  assert.equal(f.subject.getState().trips.length,2);
  assert.equal(f.subject.getQueue().length,2);
  assert.equal(f.posts.length,1);
});

test('discard waits for in-flight operation and rejects its changed suffix',async()=>{
  let release,started;
  const begun=new Promise(resolve=>started=resolve);
  const f=recoveryFixture([queued('inflight'),queued('uncertain','t',{blocked:'CLOCK_UNCERTAIN',clock:{uncertain:true}})] ,{handler:()=>{started();return new Promise(resolve=>release=()=>resolve(null));}});
  const preview=f.subject.getState().pendingRecoveryGroups[0];
  const flushing=f.subject.flush();await begun;
  const discard=f.subject.discardPending(preview);
  assert.equal(f.subject.getState().recoveryBusy,true);
  release();await flushing;await discard;
  assert.equal(f.subject.getQueue().length,0);
  assert.equal(f.posts.length,1);
});

test('account switching during in-flight recovery cannot affect the new account',async()=>{
  let release,started;
  const begun=new Promise(resolve=>started=resolve);
  const f=recoveryFixture([queued('inflight'),queued('uncertain','t',{blocked:'CLOCK_UNCERTAIN',clock:{uncertain:true}})],{handler:()=>{started();return new Promise(resolve=>release=()=>resolve(null));}});
  const flushing=f.subject.flush();await begun;
  const recovery=f.subject.discardPending(f.subject.getState().pendingRecoveryGroups[0]);recovery.catch(()=>{});
  f.subject.switchAccount();release();await flushing;
  await assert.rejects(recovery,{code:'SESSION_CHANGED'});
  assert.equal(f.subject.getState().user.id,'B');assert.equal(f.subject.getQueue().length,0);
});

test('ordinary retry storage failure preserves the blocked queue exactly',async()=>{
  const f=recoveryFixture([queued('first','t',{blocked:'STALE'})]);
  const original=f.subject.getQueue();f.failStorage();
  await assert.rejects(f.subject.retryPending('first'),{code:'LOCAL_STORAGE'});
  assert.deepEqual(f.subject.getQueue(),original);
  assert.equal(f.posts.length,0);
});

test('queued mutation captures its originating trip before waiting for local persistence',async()=>{
  const f=recoveryFixture([]);let release,started;const began=new Promise(resolve=>started=resolve);
  const held=f.subject.withLocal(()=>new Promise(resolve=>{release=resolve;started();}));
  await began;
  const mutation=f.subject.mutate({objectId:'t',kind:'patch',patch:{name:'old trip'}});mutation.catch(()=>{});
  f.subject.select('other');release();await held;
  await assert.rejects(mutation,{code:'SESSION_CHANGED'});
  assert.equal(f.subject.getQueue().length,0);
});

test('recovery persistence preserves drafts edited while the storage transaction is pending',async()=>{
  let release,started;const began=new Promise(resolve=>started=resolve),gate=new Promise(resolve=>release=resolve);
  const f=recoveryFixture([queued('first','t',{blocked:'CLOCK_UNCERTAIN',clock:{uncertain:true}})],{beforePut:()=>{started();return gate;}});
  const scope=f.subject.captureScope(),recovery=f.subject.discardPending(f.subject.getState().pendingRecoveryGroups[0]);
  await began;f.subject.setContext({drafts:{expense:{title:'new draft'}}},scope);release();
  await recovery;await f.subject.persistLocal(scope);
  assert.equal(f.storage.get('account:A').contexts.t.drafts.expense.title,'new draft');
  assert.equal(f.storage.get('account:A').queue.length,0);
});

test('recovery summaries distinguish queued business objects and retain earlier create and rename context',()=>{
  const f=recoveryFixture([
    queued('create','t',{kind:'create',objectId:'meal',objectType:'expense',blocked:'CLOCK_UNCERTAIN',patch:{title:'午餐',payment:{currency:'CNY',amountMinor:2000,status:'estimated'}}}),
    queued('rename','t',{objectId:'meal',patch:{title:'晚餐'}}),
    queued('notes','t',{objectId:'meal',patch:{notes:'private long text'}}),
    queued('missing','t',{objectId:'absent',patch:{notes:'private'}}),
    queued('dates','t',{kind:'reschedule',patch:{startDate:'2026-10-20',dayCount:3,moves:[]}}),
  ]);
  const summaries=Array.from(f.subject.getState().pendingRecoveryGroups[0].operations,op=>op.summary);
  assert.match(summaries[0],/添加费用「午餐」.*预计 CNY 20/);
  assert.match(summaries[1],/修改费用「晚餐」/);
  assert.match(summaries[2],/修改费用「晚餐」.*备注/);
  assert.equal(summaries[3],'修改已不可用的内容');
  assert.match(summaries[4],/2026-10-20 至 2026-10-22/);
  assert.ok(summaries.every(summary=>!summary.includes('private')));
});

test('discard refuses unknown receipts without submitting them; explicit retry confirms using the original operation',async()=>{
  const f=recoveryFixture([queued('unknown','t',{receiptUnknown:true}),queued('blocked','t',{blocked:'STALE'})]);
  const preview=f.subject.getState().pendingRecoveryGroups[0],original=f.subject.getQueue();
  assert.equal(preview.canDiscard,false);assert.equal(preview.canReapply,false);
  await assert.rejects(f.subject.discardPending(preview),{code:'RECEIPT_UNCONFIRMED'});
  assert.equal(f.posts.length,0);assert.deepEqual(f.subject.getQueue(),original);
  await f.subject.retryPending('unknown');
  assert.equal(f.posts.length,1);assert.equal(f.posts[0].id,'unknown');
  assert.deepEqual(f.posts[0].clock,original[0].clock);
  assert.equal(f.subject.getQueue().length,1);assert.equal(f.subject.getQueue()[0].id,'blocked');
});

test('successful remote receipt with failed local storage retains the original operation for idempotent confirmation',async()=>{
  const f=recoveryFixture([queued('confirmed')]);const original=f.subject.getQueue();
  f.failStorage();await f.subject.flush();
  assert.equal(f.subject.getState().error.code,'LOCAL_STORAGE');
  assert.deepEqual(f.subject.getQueue(),original);
  assert.equal(f.subject.getQueue()[0].blocked,undefined);
  f.restoreStorage();await f.subject.persistLocal();
  await new Promise(resolve=>setTimeout(resolve,5));
  assert.deepEqual(f.posts[0],f.posts[1]);assert.equal(f.subject.getQueue().length,0);
});


test('local persistence waiting preserves the input occurrence clock and captured payload',async()=>{
  let now=1000,release,started;const began=new Promise(resolve=>started=resolve);
  const f=recoveryFixture([],{performance:{now:()=>now}});
  const held=f.subject.withLocal(()=>new Promise(resolve=>{release=resolve;started();}));await began;
  now=1100;const input={objectId:'t',kind:'patch',patch:{name:'input at 1100'}};
  const mutation=f.subject.mutate(input);
  input.patch.name='changed after dispatch';
  // A collaborator's edit at elapsed 500 must remain later than this local input.
  now=1700;release();await held;const operation=await mutation;
  assert.equal(operation.clock.elapsedMs,100);
  assert.ok(operation.clock.elapsedMs<500);
  assert.equal(operation.patch.name,'input at 1100');
  assert.equal(operation.tripId,'t');
});


test('an old account recovery cannot release a new account recovery lock after logout resets busy',async()=>{
  let releasePost,postStarted,releaseClock,clockStarted;
  const posted=new Promise(resolve=>postStarted=resolve),clockBegan=new Promise(resolve=>clockStarted=resolve);
  const clockGate=new Promise(resolve=>releaseClock=resolve);
  const f=recoveryFixture([queued('inflight'),queued('old-block','t',{blocked:'CLOCK_UNCERTAIN',clock:{uncertain:true}})],{
    handler:()=>{postStarted();return new Promise(resolve=>releasePost=()=>resolve(null));},
    clock:()=>{clockStarted();return clockGate;},
  });
  const flushing=f.subject.flush();await posted;
  const oldRecovery=f.subject.discardPending(f.subject.getState().pendingRecoveryGroups[0]);oldRecovery.catch(()=>{});
  await f.subject.logout();assert.equal(f.subject.getState().recoveryBusy,false);
  f.subject.switchAccount([queued('new-block','other',{blocked:'CLOCK_UNCERTAIN',clock:{uncertain:true}})]);
  const newRecovery=f.subject.reapplyPending(f.subject.getState().pendingRecoveryGroups[0]);
  releasePost();await flushing;await clockBegan;
  await assert.rejects(oldRecovery,{code:'SESSION_CHANGED'});
  assert.equal(f.subject.getState().recoveryBusy,true);
  assert.equal(f.subject.getRecoveryPaused(),true);
  f.setHandler(null);releaseClock({leaseId:'new-lease',serverTime:Date.now(),expiresAt:Date.now()+100000});
  await newRecovery;assert.equal(f.subject.getState().recoveryBusy,false);
});

test('proactive lease renewal updates subsequent edits without rewriting existing queued or unknown-receipt operations',async()=>{
  const existing=queued('existing','t',{receiptUnknown:true,clock:{leaseId:'old-lease',elapsedMs:42,uncertaintyMs:3}});
  const f=recoveryFixture([existing],{clock:async()=>({leaseId:'renewed-lease',serverTime:Date.now(),expiresAt:Date.now()+100000})});
  f.subject.expireLease();
  await f.subject.ensureClock();
  const preserved=f.subject.getQueue()[0];
  assert.equal(preserved.id,'existing');
  assert.deepEqual(preserved.clock,{leaseId:'old-lease',elapsedMs:42,uncertaintyMs:3});
  const created=await f.subject.mutate({objectId:'t',kind:'patch',patch:{name:'fresh edit'}});
  assert.equal(created.clock.leaseId,'renewed-lease');
  assert.equal(created.clock.uncertain,undefined);
});

test('consecutive draft updates coalesce pending persistence writes and avoid replaying snapshot projections',async()=>{
  const f=recoveryFixture([]);
  const beforeSnapshot=f.subject.getState().snapshot;
  const scope=f.subject.captureScope();
  for(let i=0;i<20;i++)f.subject.updateDrafts(drafts=>({...drafts,activity:{title:`draft-${i}`}}),scope);
  assert.equal(f.subject.getState().context.drafts.activity.title,'draft-19');
  assert.equal(f.subject.getState().snapshot,beforeSnapshot);
  await f.subject.persistLocal(scope);
  assert.equal(f.storage.get('account:A').contexts.t.drafts.activity.title,'draft-19');
  assert.ok(f.getPutCount()<=2,`expected coalesced writes, got ${f.getPutCount()}`);
});

test('pending draft writes preserve the originating account during a slow write and account change',async()=>{
  let release,begin,count=0;
  const begun=new Promise(resolve=>begin=resolve),gate=new Promise(resolve=>release=resolve);
  const f=recoveryFixture([],{beforePut:async()=>{if(++count===1){begin();await gate;}}});
  f.subject.setContext({drafts:{title:'A-first'}});
  await begun;
  f.subject.setContext({drafts:{title:'A-latest'}});
  f.subject.switchAccount();
  f.subject.select('t');
  f.subject.setContext({drafts:{title:'B-latest'}});
  release();
  await f.subject.persistLocal();
  assert.equal(f.storage.get('account:B').contexts.t.drafts.title,'B-latest');
  assert.equal(f.storage.get('account:A').contexts.t.drafts.title,'A-latest');
});
