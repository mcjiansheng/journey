import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID, createHash } from 'node:crypto';
import { mkdtempSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createApp } from '../server/index.mjs';

const origin = 'http://127.0.0.1:4177';

async function fixture(t) {
  let now = Date.now();
  const dir = mkdtempSync(join(tmpdir(), 'journey-board-test-'));
  const assetsDir = join(dir, 'assets');
  const codes = new Map();
  const app = createApp({
    databasePath: join(dir, 'test.sqlite'),
    assetsDir,
    now: () => now,
    sendCode: async c => codes.set(c.identifier, c),
    config: { appOrigin: origin, basePath: '/journey/' },
    sseIntervalMs: 50,
  });
  const server = app.listen(0, '127.0.0.1');
  await new Promise(r => server.once('listening', r));
  const url = `http://127.0.0.1:${server.address().port}/journey`;
  t.after(async () => {
    server.closeAllConnections();
    await new Promise(r => server.close(r));
    app.locals.close();
    rmSync(dir, { recursive: true, force: true });
  });

  const req = async (path, { actor, body, method = 'GET', csrf = true, requestOrigin = origin, headers: extraHeaders = {} } = {}) => {
    const headers = { ...extraHeaders };
    if (actor) {
      headers.cookie = actor.cookie;
      if (csrf) headers['x-csrf-token'] = actor.csrfToken;
    }
    if (method !== 'GET') headers.origin = requestOrigin;
    const isRaw = Buffer.isBuffer(body);
    if (!isRaw && body !== undefined && !headers['content-type']) {
      headers['content-type'] = 'application/json';
    }
    const response = await fetch(url + path, {
      method,
      headers,
      body: body === undefined ? undefined : (isRaw ? body : JSON.stringify(body)),
    });
    const contentType = response.headers.get('content-type') || '';
    let data;
    if (contentType.includes('application/json')) {
      data = await response.json();
    } else {
      const arrayBuf = await response.arrayBuffer();
      data = Buffer.from(arrayBuf);
    }
    return {
      status: response.status,
      data,
      headers: response.headers,
      cookie: response.headers.get('set-cookie')?.split(';')[0],
    };
  };

  const account = async n => {
    const r = await req('/api/auth/register', {
      method: 'POST',
      body: { identifier: `${n}@example.com`, password: 'long-test-password', displayName: n },
    });
    assert.equal(r.status, 201, JSON.stringify(r.data));
    return { ...r.data, cookie: r.cookie };
  };

  const trip = async (actor, teamMode = 'equal') => {
    const r = await req('/api/trips', {
      actor,
      method: 'POST',
      body: {
        id: randomUUID(),
        name: '白板测试旅程',
        teamMode,
        timezone: 'Asia/Tokyo',
        currency: 'JPY',
        dayCount: 2,
        startDate: '2026-12-20',
        destination: '大阪',
      },
    });
    assert.equal(r.status, 201, JSON.stringify(r.data));
    return r.data;
  };

  const invite = async (actor, t) => {
    const r = await req(`/api/trips/${t}/invites`, { actor, method: 'POST', body: { expiresInHours: 24 } });
    assert.equal(r.status, 200);
    return r.data;
  };

  const joinTrip = async (actor, code) => req('/api/invites/accept', { actor, method: 'POST', body: { code } });

  const clock = async actor => {
    const r = await req('/api/clock', { actor, method: 'POST', body: { deviceId: randomUUID() } });
    assert.equal(r.status, 200);
    return r.data;
  };

  const op = async (actor, tid, body, { elapsed = 0, lease } = {}) => {
    lease ||= await clock(actor);
    return req(`/api/trips/${tid}/operations`, {
      actor,
      method: 'POST',
      body: {
        id: randomUUID(),
        ...body,
        clock: { leaseId: lease.leaseId, elapsedMs: elapsed, uncertaintyMs: 0 },
      },
    });
  };

  return { app, req, account, trip, invite, joinTrip, clock, op, assetsDir, url, advance: ms => (now += ms), getNow: () => now };
}

test('P1: board and boardItem schema, main snapshot exclusion, receipt without snapshot, incremental items endpoint', async t => {
  const f = await fixture(t);
  const a = await f.account('alice');
  const s = await f.trip(a);
  const tid = s.trip.id;

  // 1. Create a board
  const boardId = randomUUID();
  let r = await f.op(a, tid, {
    objectId: boardId,
    kind: 'create',
    objectType: 'board',
    patch: { title: '主白板', order: 0, background: 'dots' },
  });
  assert.equal(r.status, 200);
  assert.ok(r.data.snapshot.objects.some(o => o.id === boardId && o.kind === 'board'));

  // 2. Create boardItems: note, stroke, widget
  const noteId = randomUUID();
  r = await f.op(a, tid, {
    objectId: noteId,
    kind: 'create',
    objectType: 'boardItem',
    patch: {
      boardId,
      frame: { x: 100, y: 100, w: 200, h: 200, rotation: 0, scale: 1 },
      z: 1,
      content: { type: 'note', text: '记得买车票' },
      style: { color: 'yellow' },
    },
  });
  assert.equal(r.status, 200);
  assert.equal(r.data.snapshot, undefined, 'boardItem operation receipt must omit snapshot');
  assert.equal(r.data.receipt.changed, true);

  // 3. Main trip snapshot must exclude boardItem
  const tripSnap = (await f.req(`/api/trips/${tid}`, { actor: a })).data;
  assert.ok(tripSnap.objects.some(o => o.id === boardId));
  assert.equal(tripSnap.objects.some(o => o.id === noteId), false, 'boardItem must be excluded from main snapshot');

  // 4. Incremental items endpoint: GET /api/trips/:id/boards/:boardId/items
  let itemsRes = await f.req(`/api/trips/${tid}/boards/${boardId}/items`, { actor: a });
  assert.equal(itemsRes.status, 200);
  assert.equal(itemsRes.data.items.length, 1);
  assert.equal(itemsRes.data.items[0].id, noteId);
  assert.equal(itemsRes.data.items[0].payload.createdBy, a.user.id);
  assert.equal(itemsRes.data.items[0].payload.content.text, '记得买车票');
  const cursor1 = itemsRes.data.cursor;

  // 5. Add second boardItem and test since cursor
  const strokeId = randomUUID();
  f.advance(500);
  await f.op(a, tid, {
    objectId: strokeId,
    kind: 'create',
    objectType: 'boardItem',
    patch: {
      boardId,
      frame: { x: 50, y: 50, w: 100, h: 100, rotation: 0, scale: 1 },
      z: 2,
      content: { type: 'stroke', tool: 'pen', points: [[0, 0], [10, 10], [20, 15]] },
      style: { color: 'accent', size: 4 },
    },
  });

  itemsRes = await f.req(`/api/trips/${tid}/boards/${boardId}/items?since=${cursor1}`, { actor: a });
  assert.equal(itemsRes.status, 200);
  assert.equal(itemsRes.data.items.length, 1);
  assert.equal(itemsRes.data.items[0].id, strokeId);
});

test('P1: independent LWW group clocks, direct delete & restore without voting, express rejection', async t => {
  const f = await fixture(t);
  const a = await f.account('alice');
  const b = await f.account('bob');
  const s = await f.trip(a, 'equal');
  const tid = s.trip.id;
  await f.joinTrip(b, (await f.invite(a, tid)).code);

  const boardId = randomUUID();
  await f.op(a, tid, { objectId: boardId, kind: 'create', objectType: 'board', patch: { title: '看板', order: 0, background: 'dots' } });

  const itemId = randomUUID();
  const leaseA = await f.clock(a);
  await f.op(a, tid, {
    objectId: itemId,
    kind: 'create',
    objectType: 'boardItem',
    patch: {
      boardId,
      frame: { x: 10, y: 20, w: 100, h: 100, rotation: 0, scale: 1 },
      z: 1,
      content: { type: 'note', text: '原版' },
      style: { color: 'yellow' },
    },
  }, { lease: leaseA });

  // Concurrent edits: A moves frame (early), B edits content (late)
  f.advance(1000);
  const leaseB = await f.clock(b);
  await f.op(b, tid, {
    objectId: itemId,
    kind: 'patch',
    patch: { content: { type: 'note', text: '阿哲改了文字' } },
  }, { lease: leaseB });

  // A's offline move with earlier clock
  await f.op(a, tid, {
    objectId: itemId,
    kind: 'patch',
    patch: { frame: { x: 300, y: 400, w: 100, h: 100, rotation: 0, scale: 1 } },
  }, { lease: leaseA, elapsed: 200 });

  let itemsRes = await f.req(`/api/trips/${tid}/boards/${boardId}/items`, { actor: a });
  let item = itemsRes.data.items.find(i => i.id === itemId);
  assert.equal(item.payload.frame.x, 300, 'frame from A is preserved');
  assert.equal(item.payload.content.text, '阿哲改了文字', 'content from B is preserved');

  // Any member can directly delete boardItem without voting
  f.advance(1000);
  let delRes = await f.op(b, tid, { objectId: itemId, kind: 'delete', generation: item.generation });
  assert.equal(delRes.status, 200);

  itemsRes = await f.req(`/api/trips/${tid}/boards/${boardId}/items`, { actor: a });
  item = itemsRes.data.items.find(i => i.id === itemId);
  assert.equal(item.state, 'deleted');

  // express on boardItem must be rejected
  let expRes = await f.op(a, tid, { objectId: itemId, kind: 'express', generation: item.generation, expression: { wishRestore: true } });
  assert.equal(expRes.status, 422);
  assert.equal(expRes.data.error.code, 'VALIDATION');

  // Any member can directly restore boardItem without voting
  let restRes = await f.op(a, tid, { objectId: itemId, kind: 'restore', generation: item.generation });
  assert.equal(restRes.status, 200);

  itemsRes = await f.req(`/api/trips/${tid}/boards/${boardId}/items`, { actor: a });
  item = itemsRes.data.items.find(i => i.id === itemId);
  assert.equal(item.state, 'active');
});

test('P1: widget target, style validation, patch restrictions, cross-trip isolation, deleted activity reference', async t => {
  const f = await fixture(t);
  const a = await f.account('alice');
  const s = await f.trip(a);
  const tid = s.trip.id;
  const boardId = randomUUID();
  await f.op(a, tid, { objectId: boardId, kind: 'create', objectType: 'board', patch: { title: '小组件板', order: 0, background: 'dots' } });

  const dayId = s.objects[0].id;
  const actId = randomUUID();
  await f.op(a, tid, { objectId: actId, kind: 'create', objectType: 'activity', patch: { title: '环球影城', dayId } });

  // 1. Activity widget creation valid
  const actWidgetId = randomUUID();
  let r = await f.op(a, tid, {
    objectId: actWidgetId,
    kind: 'create',
    objectType: 'boardItem',
    patch: {
      boardId,
      frame: { x: 0, y: 0, w: 352, h: 168, rotation: 0, scale: 1 },
      z: 1,
      content: { type: 'widget', kind: 'activity', activityId: actId },
      style: { size: 'M' },
    },
  });
  assert.equal(r.status, 200);

  // 2. Missing target
  let bad = await f.op(a, tid, {
    objectId: randomUUID(),
    kind: 'create',
    objectType: 'boardItem',
    patch: {
      boardId,
      frame: { x: 0, y: 0, w: 168, h: 168, rotation: 0, scale: 1 },
      z: 1,
      content: { type: 'widget', kind: 'activity' },
      style: { size: 'S' },
    },
  });
  assert.equal(bad.status, 422);
  assert.equal(bad.data.error.code, 'VALIDATION');

  // 3. Size not allowed for kind (e.g. activity does not allow L)
  bad = await f.op(a, tid, {
    objectId: randomUUID(),
    kind: 'create',
    objectType: 'boardItem',
    patch: {
      boardId,
      frame: { x: 0, y: 0, w: 352, h: 352, rotation: 0, scale: 1 },
      z: 1,
      content: { type: 'widget', kind: 'activity', activityId: actId },
      style: { size: 'L' },
    },
  });
  assert.equal(bad.status, 422);
  assert.equal(bad.data.error.code, 'VALIDATION');

  // 4. Patch cannot change content.type or widget kind
  bad = await f.op(a, tid, {
    objectId: actWidgetId,
    kind: 'patch',
    patch: { content: { type: 'note', text: '变便签' } },
  });
  assert.equal(bad.status, 422);
  assert.equal(bad.data.error.code, 'VALIDATION');

  // 5. Patch cannot change boardId or createdBy
  bad = await f.op(a, tid, {
    objectId: actWidgetId,
    kind: 'patch',
    patch: { boardId: randomUUID() },
  });
  assert.equal(bad.status, 422);
  assert.equal(bad.data.error.code, 'VALIDATION');

  // 6. Cross-trip activity reference fails with INVALID_REFERENCE
  const otherTrip = await f.trip(a);
  bad = await f.op(a, tid, {
    objectId: randomUUID(),
    kind: 'create',
    objectType: 'boardItem',
    patch: {
      boardId,
      frame: { x: 0, y: 0, w: 352, h: 168, rotation: 0, scale: 1 },
      z: 1,
      content: { type: 'widget', kind: 'activity', activityId: otherTrip.objects[0].id },
      style: { size: 'M' },
    },
  });
  assert.equal(bad.status, 422);
  assert.equal(bad.data.error.code, 'INVALID_REFERENCE');

  // 7. Pointing to deleted activity is ALLOWED
  await f.op(a, tid, { objectId: actId, kind: 'delete', generation: 0 });
  const actWidget2 = randomUUID();
  r = await f.op(a, tid, {
    objectId: actWidget2,
    kind: 'create',
    objectType: 'boardItem',
    patch: {
      boardId,
      frame: { x: 0, y: 0, w: 168, h: 168, rotation: 0, scale: 1 },
      z: 1,
      content: { type: 'widget', kind: 'activity', activityId: actId },
      style: { size: 'S' },
    },
  });
  assert.equal(r.status, 200, 'widget referencing deleted activity must be allowed to create');
});

test('P2: asset upload, magic bytes type check, size boundaries, duplicate and conflict, purge removal', async t => {
  const f = await fixture(t);
  const a = await f.account('alice');
  const b = await f.account('bob');
  const s = await f.trip(a);
  const tid = s.trip.id;

  const validPng = Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A, 0x00, 0x00, 0x00, 0x0D, 0x49, 0x48, 0x44, 0x52]);
  const validGif = Buffer.from('GIF89a\x01\x00\x01\x00\x80\x00\x00\xff\xff\xff\x00\x00\x00!\xf9\x04\x01\x00\x00\x00\x00,\x00\x00\x00\x00\x01\x00\x01\x00\x00\x02\x02D\x01\x00;', 'binary');
  const fakeImage = Buffer.from('NOT AN IMAGE AT ALL');

  const assetId1 = randomUUID();

  // 1. Fake image rejected with ASSET_TYPE (415)
  let up = await f.req(`/api/trips/${tid}/assets/${assetId1}`, {
    actor: a,
    method: 'PUT',
    body: fakeImage,
    headers: { 'content-type': 'image/png' },
  });
  assert.equal(up.status, 415);
  assert.equal(up.data.error.code, 'ASSET_TYPE');

  // 2. Non-member rejected with 403
  up = await f.req(`/api/trips/${tid}/assets/${assetId1}`, {
    actor: b,
    method: 'PUT',
    body: validPng,
    headers: { 'content-type': 'application/octet-stream' },
  });
  assert.equal(up.status, 403);

  // 3. Valid PNG upload succeeds
  up = await f.req(`/api/trips/${tid}/assets/${assetId1}`, {
    actor: a,
    method: 'PUT',
    body: validPng,
  });
  assert.equal(up.status, 200);
  assert.equal(up.data.ok, true);

  // 4. Duplicate upload of identical content succeeds (200)
  up = await f.req(`/api/trips/${tid}/assets/${assetId1}`, {
    actor: a,
    method: 'PUT',
    body: validPng,
  });
  assert.equal(up.status, 200);

  // 5. Duplicate upload of different content returns 409 ASSET_CONFLICT
  const anotherPng = Buffer.concat([validPng, Buffer.from([1, 2, 3])]);
  up = await f.req(`/api/trips/${tid}/assets/${assetId1}`, {
    actor: a,
    method: 'PUT',
    body: anotherPng,
  });
  assert.equal(up.status, 409);
  assert.equal(up.data.error.code, 'ASSET_CONFLICT');

  // 6. Download asset
  let down = await f.req(`/api/trips/${tid}/assets/${assetId1}`, { actor: a });
  assert.equal(down.status, 200);
  assert.equal(down.headers.get('content-type'), 'image/png');
  assert.ok(down.headers.get('cache-control').includes('immutable'));
  assert.deepEqual(down.data, validPng);

  // 7. Non-member download rejected (403)
  down = await f.req(`/api/trips/${tid}/assets/${assetId1}`, { actor: b });
  assert.equal(down.status, 403);

  // 8. Size limits: thumbnail > 300KB
  const bigThumb = Buffer.concat([validPng, Buffer.alloc(305 * 1024)]);
  up = await f.req(`/api/trips/${tid}/assets/${randomUUID()}?variant=thumb`, {
    actor: a,
    method: 'PUT',
    body: bigThumb,
  });
  assert.equal(up.status, 413);
  assert.equal(up.data.error.code, 'ASSET_TOO_LARGE');

  // 9. When trip is purged, assets dir is deleted
  assert.ok(existsSync(join(f.assetsDir, tid)));
  await f.req(`/api/trips/${tid}/leave`, { actor: a, method: 'POST', body: { confirmPurge: true } });
  assert.equal(existsSync(join(f.assetsDir, tid)), false, 'purging trip must delete asset directory');
});

test('P3: presence upstream, broadcast to other connections, rate limit, inactivity leave', async t => {
  const f = await fixture(t);
  const a = await f.account('alice');
  const b = await f.account('bob');
  const s = await f.trip(a);
  const tid = s.trip.id;
  await f.joinTrip(b, (await f.invite(a, tid)).code);

  const boardId = randomUUID();
  await f.op(a, tid, { objectId: boardId, kind: 'create', objectType: 'board', patch: { title: '在线板', order: 0, background: 'dots' } });

  // Connect SSE for B
  const ctrlB = new AbortController();
  const listener = f.app.listen(0, '127.0.0.1');
  await new Promise(r => listener.once('listening', r));
  t.after(() => {
    ctrlB.abort();
    listener.closeAllConnections();
    listener.close();
  });

  const sseUrl = `http://127.0.0.1:${listener.address().port}/journey/api/trips/${tid}/events`;
  const sseResB = await fetch(sseUrl, { headers: { cookie: b.cookie }, signal: ctrlB.signal });
  assert.equal(sseResB.status, 200);
  const readerB = sseResB.body.getReader();
  const decoder = new TextDecoder();

  // Read initial change event
  let initial = (await readerB.read()).value;
  assert.match(decoder.decode(initial), /event: change/);

  // Member A posts presence
  const devA = randomUUID();
  let presRes = await f.req(`/api/trips/${tid}/boards/${boardId}/presence`, {
    actor: a,
    method: 'POST',
    body: { deviceId: devA, selected: [], editing: null, live: null },
  });
  assert.equal(presRes.status, 204);

  // Member B receives presence event
  let received = '';
  for (let i = 0; i < 5; i++) {
    const chunk = await readerB.read();
    if (chunk.done) break;
    received += decoder.decode(chunk.value);
    if (received.includes('event: presence')) break;
  }
  assert.match(received, /event: presence/);
  assert.ok(received.includes(a.user.id));
  assert.ok(received.includes(devA));

  // Presence rate limit: > 15/s per device returns 429 PRESENCE_RATE
  for (let i = 0; i < 15; i++) {
    await f.req(`/api/trips/${tid}/boards/${boardId}/presence`, {
      actor: a,
      method: 'POST',
      body: { deviceId: devA, selected: [] },
    });
  }
  let rateExceeded = await f.req(`/api/trips/${tid}/boards/${boardId}/presence`, {
    actor: a,
    method: 'POST',
    body: { deviceId: devA, selected: [] },
  });
  assert.equal(rateExceeded.status, 429);
  assert.equal(rateExceeded.data.error.code, 'PRESENCE_RATE');

  // Member A sends leave
  await f.advance(2000);
  const devA2 = randomUUID();
  await f.req(`/api/trips/${tid}/boards/${boardId}/presence`, {
    actor: a,
    method: 'POST',
    body: { deviceId: devA2, selected: [] },
  });
  await f.req(`/api/trips/${tid}/boards/${boardId}/presence`, {
    actor: a,
    method: 'POST',
    body: { deviceId: devA2, selected: [], leave: true },
  });

  received = '';
  for (let i = 0; i < 5; i++) {
    const chunk = await readerB.read();
    if (chunk.done) break;
    received += decoder.decode(chunk.value);
    if (received.includes('"leave":true')) break;
  }
  assert.match(received, /"leave":true/);

  await readerB.cancel();
});

test('P1: presence 上行不消耗全局 IP 配额，大量 presence 后普通 API 仍可用', async t => {
  const f = await fixture(t);
  const a = await f.account('alice');
  const s = await f.trip(a);
  const tid = s.trip.id;
  const boardId = randomUUID();
  await f.op(a, tid, { objectId: boardId, kind: 'create', objectType: 'board', patch: { title: '限流板', order: 0, background: 'dots' } });

  // 设备 15 次/秒限频保留：同一 deviceId 连发会得到 PRESENCE_RATE
  const floodDevice = randomUUID();
  let deviceRateCode = null;
  for (let i = 0; i < 17; i++) {
    const r = await f.req(`/api/trips/${tid}/boards/${boardId}/presence`, {
      actor: a,
      method: 'POST',
      body: { deviceId: floodDevice, selected: [] },
    });
    if (r.status === 429 && !deviceRateCode) deviceRateCode = r.data.error.code;
  }
  assert.equal(deviceRateCode, 'PRESENCE_RATE', '同一设备超过 15 次/秒应返回 PRESENCE_RATE');

  // 全局 IP 桶为 500 次/分：presence 若仍计入，这里 520 次必然把后续普通 API 打成 429。
  const statuses = new Set();
  let routeRateCode = null;
  for (let i = 0; i < 520; i++) {
    const r = await f.req(`/api/trips/${tid}/boards/${boardId}/presence`, {
      actor: a,
      method: 'POST',
      body: { deviceId: randomUUID(), selected: [] },
    });
    statuses.add(r.status);
    if (r.status === 429 && !routeRateCode) routeRateCode = r.data.error.code;
    assert.ok(r.status === 204 || r.status === 429, `presence 只应返回 204 或自身限频 429，实际 ${r.status}`);
  }
  assert.ok(statuses.has(204), 'burst 中应有成功的 presence');
  assert.equal(statuses.has(429), true, '超过 presence 自身限频后应返回 429');
  assert.equal(routeRateCode, 'PRESENCE_RATE', 'presence 限频错误码应为 PRESENCE_RATE');

  const snap = await f.req(`/api/trips/${tid}`, { actor: a });
  assert.equal(snap.status, 200, 'presence burst 后普通 API 不应被全局 IP 桶 429');
  assert.equal(snap.data.trip.id, tid);
});

test('P1: presence 的 live 键数超过 200 返回 422 VALIDATION', async t => {
  const f = await fixture(t);
  const a = await f.account('alice');
  const s = await f.trip(a);
  const tid = s.trip.id;
  const boardId = randomUUID();
  await f.op(a, tid, { objectId: boardId, kind: 'create', objectType: 'board', patch: { title: '上限板', order: 0, background: 'dots' } });
  const frameAt = i => ({ x: i, y: i, w: 10, h: 10 });

  const tooMany = {};
  for (let i = 0; i < 201; i++) tooMany[`live_${i}`] = frameAt(i);
  let r = await f.req(`/api/trips/${tid}/boards/${boardId}/presence`, {
    actor: a,
    method: 'POST',
    body: { deviceId: randomUUID(), selected: [], live: tooMany },
  });
  assert.equal(r.status, 422);
  assert.equal(r.data.error.code, 'VALIDATION');
  assert.match(r.data.error.message, /实况对象最多 200 个/);

  // 边界：200 个键不触发键数上限（这些 id 不存在于白板，走对象归属校验）
  const atLimit = {};
  for (let i = 0; i < 200; i++) atLimit[`live_${i}`] = frameAt(i);
  r = await f.req(`/api/trips/${tid}/boards/${boardId}/presence`, {
    actor: a,
    method: 'POST',
    body: { deviceId: randomUUID(), selected: [], live: atLimit },
  });
  assert.equal(r.status, 422);
  assert.doesNotMatch(r.data.error.message, /实况对象最多/);
});

test('board: rich notes, gallery, todo, place groups, sticker styles and the personal sticker library', async t => {
  const f = await fixture(t);
  const a = await f.account('carol');
  const s = await f.trip(a);
  const tid = s.trip.id;
  const boardId = randomUUID();
  await f.op(a, tid, { objectId: boardId, kind: 'create', objectType: 'board', patch: { title: '素材板', order: 0, background: 'dots' } });
  const frameOf = (w = 200, h = 200) => ({ x: 0, y: 0, w, h, rotation: 0, scale: 1 });
  const create = (content, style = {}) =>
    f.op(a, tid, { objectId: randomUUID(), kind: 'create', objectType: 'boardItem', patch: { boardId, frame: frameOf(), z: 1, content, style } });

  // Rich note with paper style and size step
  let r = await create({ type: 'note', text: '买伞', html: '<b>买伞</b>' }, { color: 'yellow', variant: 'lined', fontSize: 'l', tilt: -3 });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  r = await create({ type: 'note', text: 'x' }, { color: 'yellow', variant: 'polaroid' });
  assert.equal(r.status, 422, 'note variants are checked per type');
  r = await create({ type: 'text', text: 'x' }, { size: 'body', fontSize: 'l' });
  assert.equal(r.status, 422, 'only notes take font size steps');

  // Image frames
  const assetId = randomUUID();
  r = await create({ type: 'image', assetId, mime: 'image/png', width: 10, height: 10 }, { frameStyle: 'stamp', tilt: 4 });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  r = await create({ type: 'image', assetId, mime: 'image/png', width: 10, height: 10 }, { frameStyle: 'hexagon' });
  assert.equal(r.status, 422);

  // Gallery and todo
  r = await create(
    { type: 'gallery', images: [{ assetId, mime: 'image/png', width: 10, height: 10, crop: { x: 0.2, y: -0.1, zoom: 1.5 } }] },
    { ratio: '3:4' },
  );
  assert.equal(r.status, 200, JSON.stringify(r.data));
  r = await create({ type: 'gallery', images: [] }, { ratio: '2:1' });
  assert.equal(r.status, 200, 'edge snapping reaches 1:2 and 2:1');
  r = await create({ type: 'gallery', images: [] }, { ratio: '5:4' });
  assert.equal(r.status, 422);
  r = await create({ type: 'todo', title: '出发前', items: [{ id: randomUUID(), text: '换外币', done: true }] }, { color: 'green', variant: 'paper' });
  assert.equal(r.status, 200, JSON.stringify(r.data));

  // Places-by-mark widget
  r = await create({ type: 'widget', kind: 'places', mark: { icon: 'heart', color: 'rose' } }, { size: 'L' });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  r = await create({ type: 'widget', kind: 'places' }, { size: 'M' });
  assert.equal(r.status, 422, 'a place group needs its mark');
  // Map widgets: card variant and map look; other objects cannot take a map look
  r = await create({ type: 'widget', kind: 'places', mark: { icon: 'heart', color: 'rose' } }, { size: 'M', variant: 'polaroid', mapStyle: 'dark' });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  r = await create({ type: 'widget', kind: 'places', mark: { icon: 'heart', color: 'rose' } }, { size: 'M', mapStyle: 'neon' });
  assert.equal(r.status, 422, 'unknown map looks are refused');
  r = await create({ type: 'note', text: 'x' }, { color: 'yellow', mapStyle: 'dark' });
  assert.equal(r.status, 422, 'only map widgets take a map look');

  // Emoji: longer ZWJ sequences and sticker style
  r = await create({ type: 'emoji', char: '👨‍👩‍👧‍👦' }, { variant: 'sticker' });
  assert.equal(r.status, 200, JSON.stringify(r.data));

  // Personal sticker library
  const gif = Buffer.from('GIF89a\x01\x00\x01\x00\x80\x00\x00\xff\xff\xff\x00\x00\x00!\xf9\x04\x01\x00\x00\x00\x00,\x00\x00\x00\x00\x01\x00\x01\x00\x00\x02\x02D\x01\x00;', 'binary');
  const stickerId = randomUUID();
  r = await f.req(`/api/me/stickers/${stickerId}?w=120&h=90`, { actor: a, method: 'PUT', body: gif, headers: { 'content-type': 'image/gif' } });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.deepEqual([r.data.mime, r.data.width, r.data.height, r.data.animated], ['image/gif', 120, 90, true]);
  r = await f.req('/api/session', { actor: a });
  const me = r.data.user || r.data;
  assert.equal(me.preferences.stickers[0].id, stickerId);
  r = await f.req(`/api/me/stickers/${stickerId}`, { actor: a });
  assert.equal(r.status, 200);
  assert.equal(r.headers.get('content-type'), 'image/gif');
  // Another account cannot read it
  const b = await f.account('dave');
  r = await f.req(`/api/me/stickers/${stickerId}`, { actor: b });
  assert.equal(r.status, 404);
  // The list is server-owned: PATCH /api/me cannot overwrite it
  await f.req('/api/me', { actor: a, method: 'PATCH', body: { preferences: { stickers: [] } } });
  r = await f.req('/api/session', { actor: a });
  assert.equal((r.data.user || r.data).preferences.stickers.length, 1);
  r = await f.req(`/api/me/stickers/${stickerId}`, { actor: a, method: 'DELETE' });
  assert.equal(r.status, 204);
  r = await f.req('/api/session', { actor: a });
  assert.equal((r.data.user || r.data).preferences.stickers.length, 0);
  r = await f.req(`/api/me/stickers/${randomUUID()}`, { actor: a, method: 'PUT', body: Buffer.from('nope'), headers: { 'content-type': 'image/png' } });
  assert.equal(r.status, 415);
});

test('board: sections, rotation, widget looks, auto-width text and saving a board picture as a sticker', async t => {
  const f = await fixture(t);
  const a = await f.account('erin');
  const s = await f.trip(a);
  const tid = s.trip.id;
  const boardId = randomUUID();
  await f.op(a, tid, { objectId: boardId, kind: 'create', objectType: 'board', patch: { title: '分区板', order: 0 } });
  const create = (content, style = {}, frame = { x: 0, y: 0, w: 200, h: 200, rotation: 0, scale: 1 }) =>
    f.op(a, tid, { objectId: randomUUID(), kind: 'create', objectType: 'boardItem', patch: { boardId, frame, z: 1, content, style } });

  let r = await create({ type: 'section', title: '第1天' }, { color: 'blue', variant: 'dashed' });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  r = await create({ type: 'section', title: 'x' }, {});
  assert.equal(r.status, 422, 'a section needs a color');
  r = await create({ type: 'section', title: 'x' }, { color: 'blue', variant: 'kraft' });
  assert.equal(r.status, 422);
  // Real rotation lives on the frame
  r = await create({ type: 'note', text: '' }, { color: 'pink' }, { x: 0, y: 0, w: 200, h: 200, rotation: -37.5, scale: 1 });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  // Widget looks are checked per kind
  r = await create({ type: 'widget', kind: 'countdown' }, { size: 'S', variant: 'flip' });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  r = await create({ type: 'widget', kind: 'clock' }, { size: 'M', variant: 'sky' });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  r = await create({ type: 'widget', kind: 'expense' }, { size: 'S', variant: 'receipt' });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  r = await create({ type: 'widget', kind: 'clock' }, { size: 'S', variant: 'receipt' });
  assert.equal(r.status, 422);
  // Text: auto width only for text
  r = await create({ type: 'text', text: '你好' }, { size: 'body', autoWidth: true });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  r = await create({ type: 'note', text: '' }, { color: 'pink', autoWidth: false });
  assert.equal(r.status, 422);

  // A picture on the board goes into my sticker library (once).
  const png = Buffer.from('89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d49444154789c6360f8cfc0f01f0005000201b4a3c6d50000000049454e44ae426082', 'hex');
  const assetId = randomUUID();
  r = await f.req(`/api/trips/${tid}/assets/${assetId}?variant=full`, { actor: a, method: 'PUT', body: png, headers: { 'content-type': 'image/png' } });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  r = await f.req(`/api/trips/${tid}/assets/${assetId}/to-stickers?w=1&h=1`, { actor: a, method: 'POST' });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.equal(r.data.mime, 'image/png');
  const saved = r.data.id;
  r = await f.req(`/api/trips/${tid}/assets/${assetId}/to-stickers?w=1&h=1`, { actor: a, method: 'POST' });
  assert.equal(r.data.duplicate, true);
  assert.equal(r.data.id, saved);
  r = await f.req(`/api/me/stickers/${saved}`, { actor: a });
  assert.equal(r.status, 200);
  // Uploading the same file again is not a second copy either.
  r = await f.req(`/api/me/stickers/${randomUUID()}?w=1&h=1`, { actor: a, method: 'PUT', body: png, headers: { 'content-type': 'image/png' } });
  assert.equal(r.data.duplicate, true);
  // Someone outside the trip cannot copy its pictures.
  const b = await f.account('frank');
  r = await f.req(`/api/trips/${tid}/assets/${assetId}/to-stickers`, { actor: b, method: 'POST' });
  assert.ok([403, 404].includes(r.status), String(r.status));
  r = await f.req(`/api/trips/${tid}/assets/${randomUUID()}/to-stickers`, { actor: a, method: 'POST' });
  assert.equal(r.status, 404);
});
