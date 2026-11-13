import { test, expect } from '@playwright/test';
import { fileURLToPath } from 'node:url';
import { mkdtemp, mkdir, rm } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createApp, shutdownServer } from '../../server/index.mjs';

const password = 'JourneyEpoch2026!';
const suffix = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);

let dir, app, server, base, port;

async function start() {
  app = createApp({
    distPath: fileURLToPath(new URL('../../dist/', import.meta.url)),
    databasePath: join(dir, 'main.sqlite'),
    securityPath: join(dir, 'security.sqlite'),
    assetsDir: join(dir, 'assets'),
    config: { amapKey: '' },
  });
  server = await new Promise((resolve) => {
    const listener = app.listen(port, '127.0.0.1', () => resolve(listener));
  });
  app.locals.config.appOrigin = base;
}

test.beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), 'journey-epoch-e2e-'));
  await mkdir(join(dir, 'assets'), { recursive: true });
  port = await new Promise((resolve) => {
    const probe = createServer();
    probe.listen(0, '127.0.0.1', () => {
      const value = probe.address().port;
      probe.close(() => resolve(value));
    });
  });
  base = `http://127.0.0.1:${port}`;
  await start();
});

test.afterAll(async () => {
  if (server) await shutdownServer(server, app);
  if (dir) await rm(dir, { recursive: true, force: true });
});

async function register(page) {
  await page.goto(base);
  await page.getByRole('button', { name: '创建账号', exact: true }).click();
  await page.getByLabel('手机号或邮箱').fill(`epoch-${suffix()}@example.test`);
  await page.getByLabel('你的称呼').fill('重启验收');
  await page.getByLabel('密码', { exact: true }).fill(password);
  await page.getByLabel('确认密码', { exact: true }).fill(password);
  await page.getByRole('button', { name: '创建账号并继续' }).click();
  await expect(page.getByRole('button', { name: '创建旅程', exact: true })).toBeVisible();
}

async function createTrip(page) {
  await page.getByRole('button', { name: '创建旅程', exact: true }).click();
  await page.getByLabel('旅程名称').fill('重启旅程');
  await page.getByLabel('目的地', { exact: true }).fill('杭州');
  await page.getByLabel('出发日期', { exact: true }).fill('2026-12-01');
  await page.getByText('更多设置', { exact: true }).click();
  await page.getByLabel('旅程时区', { exact: true }).selectOption('Asia/Shanghai');
  await page.getByLabel('结束日期', { exact: true }).fill('2026-12-03');
  await page.getByRole('radio', { name: '平等团队', exact: true }).check();
  await page.getByRole('dialog').getByRole('button', { name: '创建旅程' }).click();
  await expect(page.locator('.itinerary-page')).toBeVisible();
}

async function createBoardNote(page) {
  return page.evaluate(async () => {
    const list = await fetch('/api/trips').then((r) => r.json());
    const tripId = list.trips[0].id;
    const session = await fetch('/api/session').then((r) => r.json());
    const headers = { 'Content-Type': 'application/json', 'X-CSRF-Token': session.csrfToken };
    const snapshot = await fetch(`/api/trips/${tripId}`).then((r) => r.json());
    const board = snapshot.objects.find((o) => o.kind === 'board');
    const lease = await fetch('/api/clock', {
      method: 'POST',
      headers,
      body: JSON.stringify({ deviceId: crypto.randomUUID() }),
    }).then((r) => r.json());
    const itemId = crypto.randomUUID();
    const res = await fetch(`/api/trips/${tripId}/operations`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        id: crypto.randomUUID(),
        objectId: itemId,
        kind: 'create',
        objectType: 'boardItem',
        patch: {
          boardId: board.id,
          frame: { x: 120, y: 120, w: 180, h: 140, rotation: 0, scale: 1 },
          z: 1,
          content: { type: 'note', text: '重启后应保留' },
          style: { color: 'yellow' },
        },
        clock: { leaseId: lease.leaseId, elapsedMs: 0, uncertaintyMs: 0 },
      }),
    });
    if (!res.ok) throw new Error(await res.text());
    return { tripId, boardId: board.id, itemId };
  });
}

async function serverItemState(page, boardId) {
  return page.evaluate(async (boardId) => {
    const list = await fetch('/api/trips').then((r) => r.json());
    const tripId = list.trips[0].id;
    const res = await fetch(`/api/trips/${tripId}/boards/${boardId}/items`).then((r) => r.json());
    return { count: res.items.length, states: res.items.map((i) => i.state), epoch: res.epoch };
  }, boardId);
}

test('board: an epoch change after a server restart never drops cached board items', async ({
  page,
}) => {
  test.setTimeout(120000);
  await page.setViewportSize({ width: 1280, height: 800 });
  await register(page);
  await createTrip(page);
  const seeded = await createBoardNote(page);

  await page.locator('nav button[aria-label="白板"]').first().click();
  await expect(page.locator('.board-container')).toBeVisible();
  await expect(page.locator('.board-item.item-note')).toHaveCount(1);
  const beforeEpoch = (await serverItemState(page, seeded.boardId)).epoch;

  // Restart the process on the same database and port. The security ledger
  // allocates a new epoch, so the page's cached cursor is no longer valid.
  await shutdownServer(server, app);
  server = null;
  await new Promise((resolve) => setTimeout(resolve, 600));
  await start();
  const restarted = await serverItemState(page, seeded.boardId);
  expect(restarted.epoch).toBeGreaterThan(beforeEpoch);
  expect(restarted.count).toBe(1);

  // EventSource reconnects and the server emits an initial change event; the
  // client must perform a full reload instead of treating it as an increment.
  await expect(page.locator('.board-item.item-note')).toHaveCount(1, { timeout: 20000 });
  await page.reload();
  await page.getByRole('button', { name: /继续旅程/ }).click();
  await expect(page.locator('.board-container, .itinerary-page').first()).toBeVisible();
  if ((await page.locator('.board-container').count()) === 0) {
    await page.locator('nav button[aria-label="白板"]').first().click();
  }
  await expect(page.locator('.board-container')).toBeVisible();
  await expect(page.locator('.board-item.item-note')).toHaveCount(1, { timeout: 20000 });

  const after = await serverItemState(page, seeded.boardId);
  expect(after.count).toBe(1);
  expect(after.states).toEqual(['active']);
});
