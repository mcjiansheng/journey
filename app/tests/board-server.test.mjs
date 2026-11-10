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
