// Run from any directory: node app/scripts/load-check.mjs
// Emits JSON to stdout; all fixture files and sockets are removed before exit.
import { mkdtemp, rm, stat } from 'node:fs/promises';
import { tmpdir, hostname, platform, release, arch, cpus, totalmem } from 'node:os';
import { join } from 'node:path';
import { randomBytes, randomUUID } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { createApp, shutdownServer } from '../server/index.mjs';
import { hash } from '../server/auth.mjs';
import { schemas } from '../server/model.mjs';
import { transaction } from '../server/db.mjs';

const ACCOUNTS = 10, SESSIONS_PER_ACCOUNT = 5, ROUNDS = 3;
const STREAMS = ACCOUNTS * SESSIONS_PER_ACCOUNT;
const round = value => Math.round(value * 1000) / 1000;
function distribution(values) {
  const sorted = [...values].sort((a, b) => a - b);
  if (!sorted.length) return { samples: 0, minMs: null, p50Ms: null, p95Ms: null, maxMs: null, meanMs: null };
  const quantile = p => sorted[Math.max(0, Math.ceil(sorted.length * p) - 1)];
  return {
    samples: sorted.length, minMs: round(sorted[0]), p50Ms: round(quantile(0.5)),
    p95Ms: round(quantile(0.95)), maxMs: round(sorted.at(-1)),
    meanMs: round(sorted.reduce((a, b) => a + b, 0) / sorted.length),
  };
}

async function run() {
  const dir = await mkdtemp(join(tmpdir(), 'journey-load-check-'));
  const mainPath = join(dir, 'business.sqlite');
  const securityPath = join(dir, 'security.sqlite');
  const app = createApp({
    databasePath: mainPath, securityPath,
    distPath: join(dir, 'no-static-files'),
    config: { basePath: '/', appOrigin: 'http://127.0.0.1', secureCookies: false, trustProxy: false },
  });
  let server;
  const streams = [], streamErrors = [], apiSamples = [], successfulWrites = [];
  let requestCount = 0;
  const overallStart = performance.now();
  try {
    const tripId = randomUUID(), dayId = randomUUID(), db = app.locals.db;
    const clients = [];
    transaction(db, () => {
      for (let userIndex = 0; userIndex < ACCOUNTS; userIndex++) {
        const userId = `load-user-${userIndex}`;
        db.prepare('INSERT INTO users VALUES(?,?,?,?,?)').run(userId, `${userId}@example.test`, userId, 0, '{}');
        for (let sessionIndex = 0; sessionIndex < SESSIONS_PER_ACCOUNT; sessionIndex++) {
          const token = randomBytes(32).toString('base64url'), csrf = randomBytes(24).toString('base64url');
          db.prepare('INSERT INTO sessions VALUES(?,?,?,?)').run(hash(token), userId, csrf, Date.now() + 3600000);
          clients.push({ userIndex, sessionIndex, cookie: `journey_session=${token}`, csrf });
        }
      }
      const trip = {
        id: tripId, name: 'Temporary capacity fixture', ownerId: 'load-user-0', createdBy: 'load-user-0',
        teamMode: 'equal', timezone: 'Asia/Shanghai', currency: 'CNY', destination: '',
        startDate: null, dayCount: 1, state: 'active', generation: 0, clocks: {}, createdAt: Date.now(),
      };
      db.prepare('INSERT INTO trips VALUES(?,?,0,10)').run(tripId, JSON.stringify(trip));
      db.prepare('INSERT INTO objects VALUES(?,?,?,?,?,?,?)').run(dayId, tripId, 'day', JSON.stringify({ ordinal: 1, date: null }), 'active', 0, '{}');
      for (let userIndex = 0; userIndex < ACCOUNTS; userIndex++) {
        db.prepare('INSERT INTO members VALUES(?,?,0,1,?,0)').run(tripId, `load-user-${userIndex}`, userIndex + 1);
        const payload = schemas.activity.parse({ title: `Activity ${userIndex}`, dayId, order: userIndex });
        db.prepare('INSERT INTO objects VALUES(?,?,?,?,?,?,?)').run(`load-activity-${userIndex}`, tripId, 'activity', JSON.stringify(payload), 'active', 0, '{}');
      }
    });
    server = app.listen(0, '127.0.0.1');
    await new Promise((resolve, reject) => { server.once('listening', resolve); server.once('error', reject); });
    const origin = `http://127.0.0.1:${server.address().port}`;
    app.locals.config.appOrigin = origin;

    async function request(client, path, { body, measured = false, category } = {}) {
      requestCount++;
      const startedAt = performance.now();
      let sample;
      if (measured) { sample = { category, startedAt, ok: false }; apiSamples.push(sample); }
      try {
        const response = await fetch(origin + path, {
          method: body === undefined ? 'GET' : 'POST', signal: AbortSignal.timeout(10000),
          headers: { cookie: client.cookie, ...(body === undefined ? {} : {
            origin, 'content-type': 'application/json', 'x-csrf-token': client.csrf,
          }) },
          ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        });
        const data = await response.json();
        if (sample) { sample.status = response.status; sample.code = data.error?.code; }
        if (!response.ok) throw new Error(`HTTP ${response.status}: ${data.error?.code || 'UNKNOWN'}`);
        if (sample) sample.ok = true;
        return { data, startedAt };
      } finally {
        if (sample) sample.durationMs = performance.now() - startedAt;
      }
    }

    // Confirm every independent cookie through the normal session middleware.
    await Promise.all(clients.map(async client => {
      const { data } = await request(client, '/api/session');
      if (data.user.id !== `load-user-${client.userIndex}`) throw new Error('SESSION_IDENTITY_MISMATCH');
    }));
    const writers = clients.filter(client => client.sessionIndex === 0);
    await Promise.all(writers.map(async client => {
      client.lease = (await request(client, '/api/clock', { body: { deviceId: randomUUID() } })).data;
      client.leaseStartedAt = performance.now();
    }));

    async function connect(client) {
      const controller = new AbortController(), arrivals = new Map();
      const stream = { controller, arrivals, finished: false };
      streams.push(stream);
      requestCount++;
      const headerTimeout = setTimeout(() => controller.abort(), 10000);
      let response;
      try {
        response = await fetch(`${origin}/api/trips/${tripId}/events`, {
          headers: { cookie: client.cookie, accept: 'text/event-stream' }, signal: controller.signal,
        });
      } finally { clearTimeout(headerTimeout); }
      if (!response.ok) throw new Error(`SSE_HTTP_${response.status}`);
      let resolveReady, rejectReady;
      const ready = new Promise((resolve, reject) => { resolveReady = resolve; rejectReady = reject; });
      const firstEventTimeout = setTimeout(() => rejectReady(new Error('SSE_INITIAL_EVENT_TIMEOUT')), 10000);
      stream.task = (async () => {
        const reader = response.body.getReader(), decoder = new TextDecoder();
        let buffer = '';
        try {
          while (true) {
            const { done, value } = await reader.read();
            if (done) { if (!controller.signal.aborted) throw new Error('SSE_EARLY_CLOSE'); break; }
            buffer += decoder.decode(value, { stream: true });
            let split;
            while ((split = buffer.indexOf('\n\n')) >= 0) {
              const event = buffer.slice(0, split); buffer = buffer.slice(split + 2);
              if (!event.startsWith('event: change\n')) continue;
              const data = JSON.parse(event.slice(event.indexOf('data: ') + 6));
              arrivals.set(data.cursor, { monotonic: performance.now(), wall: Date.now() });
              clearTimeout(firstEventTimeout); resolveReady();
            }
          }
        } catch (error) {
          if (!controller.signal.aborted) { streamErrors.push(error.message); rejectReady(error); }
        } finally { clearTimeout(firstEventTimeout); stream.finished = true; reader.releaseLock(); }
      })();
      await ready;
    }
    await Promise.all(clients.map(connect));

    const measuredStart = performance.now();
    for (let cycle = 1; cycle <= ROUNDS; cycle++) {
      await Promise.all(writers.map(async client => {
        try {
          const result = await request(client, `/api/trips/${tripId}/operations`, {
            measured: true, category: 'write', body: {
              id: randomUUID(), objectId: `load-activity-${client.userIndex}`, kind: 'patch',
              patch: { notes: `round-${cycle}-writer-${client.userIndex}` },
              clock: { leaseId: client.lease.leaseId, elapsedMs: Math.floor(performance.now() - client.leaseStartedAt), uncertaintyMs: 0 },
            },
          });
          if (!result.data.receipt.changed) throw new Error('WRITE_NOT_APPLIED');
          successfulWrites.push({ cursor: result.data.receipt.cursor, receivedAt: result.data.receipt.receivedAt, startedAt: result.startedAt });
        } catch (error) { streamErrors.push(`write-${client.userIndex}-${cycle}: ${error.message}`); }
      }));
      await Promise.all(writers.map(async client => {
        try { await request(client, `/api/trips/${tripId}`, { measured: true, category: 'read' }); }
        catch (error) { streamErrors.push(`read-${client.userIndex}-${cycle}: ${error.message}`); }
      }));
    }
    const deliveryDeadline = performance.now() + 5000;
    while (performance.now() < deliveryDeadline && streams.some(stream => successfulWrites.some(write => !stream.arrivals.has(write.cursor)))) {
      await new Promise(resolve => setTimeout(resolve, 10));
    }
    const sseEndToEnd = [], sseFromReceipt = [];
    let missingEvents = 0;
    for (const stream of streams) for (const write of successfulWrites) {
      const arrival = stream.arrivals.get(write.cursor);
      if (!arrival) { missingEvents++; continue; }
      sseEndToEnd.push(arrival.monotonic - write.startedAt);
      sseFromReceipt.push(arrival.wall - write.receivedAt);
    }
    const finalSnapshot = (await request(writers[0], `/api/trips/${tripId}`)).data;
    for (const client of writers) {
      const activity = finalSnapshot.objects.find(object => object.id === `load-activity-${client.userIndex}`);
      if (activity?.payload.notes !== `round-${ROUNDS}-writer-${client.userIndex}`) streamErrors.push(`FINAL_CONTENT_MISMATCH_${client.userIndex}`);
    }
    const failures = apiSamples.filter(sample => !sample.ok);
    const report = {
      recordedAt: new Date().toISOString(),
      host: { hostname: hostname(), platform: platform(), release: release(), arch: arch(), node: process.version, cpu: cpus()[0]?.model, logicalCpus: cpus().length, memoryGiB: round(totalmem() / 1024 ** 3) },
      fixture: { accounts: ACCOUNTS, sessions: STREAMS, simultaneousSse: streams.length, concurrentWriters: writers.length, rounds: ROUNDS, trips: 1, days: 1, activities: ACCOUNTS, objects: finalSnapshot.objects.length, finalCursor: finalSnapshot.cursor },
      transport: { listenHost: '127.0.0.1', ephemeralPort: server.address().port, requestsIncludingSetup: requestCount, ipRateLimitUnchanged: '500 requests / 60 seconds', csrfEnabled: true, sessionAuthorizationEnabled: true, sqlite: { journalMode: db.prepare('PRAGMA journal_mode').get().journal_mode, synchronous: db.prepare('PRAGMA synchronous').get().synchronous, mainBytes: (await stat(mainPath)).size, walBytes: (await stat(mainPath + '-wal').catch(() => ({ size: 0 }))).size } },
      api: {
        all: distribution(apiSamples.map(sample => sample.durationMs)),
        reads: distribution(apiSamples.filter(sample => sample.category === 'read').map(sample => sample.durationMs)),
        writes: distribution(apiSamples.filter(sample => sample.category === 'write').map(sample => sample.durationMs)),
        errors: failures.length, errorRate: round(failures.length / apiSamples.length),
      },
      sse: {
        expectedEvents: STREAMS * ACCOUNTS * ROUNDS, receivedEvents: sseEndToEnd.length, missingEvents,
        requestStartToEvent: distribution(sseEndToEnd), serverReceiptTimestampToEvent: distribution(sseFromReceipt),
        receiptMetricResolutionMs: 1,
      },
      measuredDurationMs: round(performance.now() - measuredStart), totalDurationMs: round(performance.now() - overallStart),
      errors: streamErrors,
      passed: failures.length === 0 && streamErrors.length === 0 && missingEvents === 0 && successfulWrites.length === ACCOUNTS * ROUNDS && streams.every(stream => !stream.finished),
    };
    if (requestCount >= 500) throw new Error('LOAD_CHECK_REQUEST_BUDGET_EXCEEDED');
    return report;
  } finally {
    for (const stream of streams) stream.controller.abort();
    await Promise.allSettled(streams.map(stream => stream.task));
    if (server) await shutdownServer(server, app, { timeoutMs: 2000 }); else app.locals.close();
    await rm(dir, { recursive: true, force: true });
  }
}

try {
  const report = await run();
  console.log(JSON.stringify(report, null, 2));
  if (!report.passed) process.exitCode = 1;
} catch (error) { console.error(error.stack || error.message); process.exitCode = 1; }
