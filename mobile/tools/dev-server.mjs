import { randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { createApp, shutdownServer } from '../../app/server/index.mjs';

// A real Journey server with a separate database for native-client acceptance.
const root = fileURLToPath(new URL('../../', import.meta.url));
const port = Number(process.env.JOURNEY_TEST_PORT || 4188);
const host = process.env.JOURNEY_TEST_HOST || '127.0.0.1';
const origin = process.env.JOURNEY_TEST_ORIGIN || `http://127.0.0.1:${port}`;
const output = resolve(root, '.local/mobile-acceptance');
await mkdir(output, { recursive: true });
const app = createApp({
  databasePath: resolve(output, 'journey.sqlite'),
  config: { appOrigin: origin, basePath: '/', secureCookies: false },
});
const server = app.listen(port, host);
await new Promise((accept, reject) => {
  server.once('listening', accept);
  server.once('error', reject);
});
for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => shutdownServer(server, app).then(() => process.exit(0)));
}

if (process.argv.includes('--seed')) {
  const suffix = randomUUID().slice(0, 8);
  const password = `journey-local-${randomUUID()}`;
  let cookie, csrf;
  const request = async (path, method = 'GET', body) => {
    const response = await fetch(origin + path, {
      method,
      headers: {
        Origin: origin,
        ...(cookie ? { Cookie: cookie } : {}),
        ...(csrf ? { 'X-CSRF-Token': csrf } : {}),
        ...(body ? { 'Content-Type': 'application/json' } : {}),
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    const data = await response.json();
    if (!response.ok) throw new Error(`${path}: ${JSON.stringify(data)}`);
    cookie = response.headers.get('set-cookie')?.split(';')[0] || cookie;
    csrf = data.csrfToken || csrf;
    return data;
  };
  try {
    const identifier = `native-${suffix}@example.com`;
    await request('/api/auth/register', 'POST', { identifier, password, displayName: '原生验收' });
    const snapshot = await request('/api/trips', 'POST', {
      id: randomUUID(), name: '南京周末', destination: '南京', teamMode: 'equal',
      timezone: 'Asia/Shanghai', currency: 'CNY', startDate: '2026-11-07', dayCount: 2,
    });
    const tripId = snapshot.trip.id;
    const lease = await request('/api/clock', 'POST', { deviceId: randomUUID() });
    const start = performance.now();
    const create = (objectType, patch) => request(`/api/trips/${tripId}/operations`, 'POST', {
      id: randomUUID(), objectId: randomUUID(), kind: 'create', objectType, patch,
      clock: { leaseId: lease.leaseId, elapsedMs: performance.now() - start, uncertaintyMs: 0 },
    });
    const place = { name: '南京博物院', address: '中山东路321号', lng: 118.8254, lat: 32.0418, coordSystem: 'GCJ-02' };
    await create('activity', {
      title: '逛南京博物院', dayId: snapshot.objects[0].id, place,
      time: { mode: 'precise', start: '09:30', end: '11:30', endDayOffset: 0, period: '' },
      notes: '东门集合', buffers: { before: 15, after: null },
    });
    await create('favorite', place);
    await create('expense', { title: '午餐', date: '2026-11-07', payment: { status: 'paid', amountMinor: 6800, currency: 'CNY' } });
    const invite = await request(`/api/trips/${tripId}/invites`, 'POST', { expiresInHours: 24 });
    await writeFile(resolve(output, 'fixture.json'), JSON.stringify({
      serverURL: origin, identifier, password, tripId, inviteCode: invite.code,
    }, null, 2) + '\n', { mode: 0o600 });
    console.log(`Local test account and trip: ${resolve(output, 'fixture.json')}`);
  } catch (error) {
    await shutdownServer(server, app);
    throw error;
  }
}
console.log(`Native acceptance server: ${origin}`);
