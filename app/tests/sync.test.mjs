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
