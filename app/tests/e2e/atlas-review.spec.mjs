import { test, expect, request } from '@playwright/test';
import { fileURLToPath } from 'node:url';
import { mkdirSync } from 'node:fs';
import { createApp, shutdownServer } from '../../server/index.mjs';
let app, server, base, seededState;
const evidence = '../.local/evidence/atlas-review';
test.beforeAll(async () => {
  mkdirSync(evidence, { recursive: true });
  app = createApp({
    distPath: fileURLToPath(new URL('../../dist/', import.meta.url)),
    databasePath: ':memory:',
    securityPath: ':memory:',
    config: { amapKey: '' },
  });
  server = await new Promise((resolve) => {
    const s = app.listen(0, '127.0.0.1', () => resolve(s));
  });
  base = `http://127.0.0.1:${server.address().port}`;
  app.locals.config.appOrigin = base;
});
test.afterAll(async () => {
  if (server) await shutdownServer(server, app);
});
const nav = (page, label) =>
  page
    .getByRole('navigation', { name: /^(主导航|手机主导航)$/ })
    .getByRole('button', { name: label, exact: true });
async function seed(page) {
  if (seededState) {
    await page.context().addCookies(seededState.cookies);
    await page.goto(base);
    await expect(page.locator('.continue-card')).toBeVisible();
    return;
  }
  await page.goto(base);
  const fixture = await page.evaluate(async () => {
    const auth = await fetch('/api/auth/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        identifier: `r3-${crypto.randomUUID()}@example.test`,
        password: 'JourneyReview2026!',
        displayName: '周晴',
      }),
    }).then((r) => r.json());
    const headers = { 'Content-Type': 'application/json', 'X-CSRF-Token': auth.csrfToken };
    const createTrip = (name, destination) =>
      fetch('/api/trips', {
        method: 'POST',
        headers,
        body: JSON.stringify({
          id: crypto.randomUUID(),
          name,
          teamMode: 'admin',
          timezone: 'Asia/Shanghai',
          currency: 'CNY',
          dayCount: 3,
          startDate: '2026-11-01',
          destination,
        }),
      }).then((r) => r.json());
    const snapshot = await createTrip('南京周末 · 秋日漫游', '南京');
    await createTrip('成都慢游', '成都');
    const lease = await fetch('/api/clock', {
      method: 'POST',
      headers,
      body: JSON.stringify({ deviceId: crypto.randomUUID() }),
    }).then((r) => r.json());
    let elapsed = 0;
    async function create(objectType, patch) {
      const objectId = crypto.randomUUID();
      const r = await fetch(`/api/trips/${snapshot.trip.id}/operations`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          id: crypto.randomUUID(),
          objectId,
          kind: 'create',
          objectType,
          patch,
          clock: { leaseId: lease.leaseId, elapsedMs: ++elapsed, uncertaintyMs: 0 },
        }),
      });
      if (!r.ok) throw new Error(await r.text());
      return objectId;
    }
    const activityId = await create('activity', {
      title: '抵达南京南站，入住酒店',
      dayId: snapshot.objects[0].id,
      order: 1024,
      time: { mode: 'precise', start: '10:30', end: '12:00', endDayOffset: 0 },
      notes: '行李先寄存前台',
      place: { name: '南京金陵饭店', lng: 118.78, lat: 32.04 },
    });
    await create('activity', {
      title: '老门东午饭',
      dayId: snapshot.objects[0].id,
      order: 2048,
      time: { mode: 'precise', start: '12:30', end: '14:00', endDayOffset: 0 },
      notes: '鸭血粉丝汤、烧饼',
    });
    await create('expense', {
      title: '酒店',
      activityId,
      date: '2026-11-01',
      payment: { status: 'paid', amountMinor: 120000, currency: 'CNY' },
    });
    await create('expense', {
      title: '出租车',
      activityId,
      date: '2026-11-01',
      payment: { status: 'paid', amountMinor: 5900, currency: 'CNY' },
    });
    const invite = await fetch(`/api/trips/${snapshot.trip.id}/invites`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ expiresInHours: 1 }),
    }).then((r) => r.json());
    await fetch('/api/navigation', {
      method: 'PUT',
      headers,
      body: JSON.stringify({ lastTripId: snapshot.trip.id }),
    });
    return { invite: invite.code };
  });
  for (const name of ['林晓', '王珊']) {
    const api = await request.newContext({ baseURL: base, extraHTTPHeaders: { Origin: base } });
    try {
      const auth = await (
        await api.post('/api/auth/register', {
          data: {
            identifier: `member-${crypto.randomUUID()}@example.test`,
            password: 'JourneyReview2026!',
            displayName: name,
          },
        })
      ).json();
      const joined = await api.post('/api/invites/accept', {
        headers: { 'X-CSRF-Token': auth.csrfToken },
        data: { code: fixture.invite },
      });
      expect(joined.ok()).toBe(true);
    } finally {
      await api.dispose();
    }
  }
  await page.reload();
  await expect(page.locator('.continue-card')).toBeVisible();
  seededState = await page.context().storageState();
}
async function shot(page, name) {
  await page.screenshot({ path: `${evidence}/${name}.png`, scale: 'css' });
}

// Validate the new visual vocabulary across the real existing task flows.
for (const width of [1440, 768, 390, 320])
  test(`atlas pages and dialogs remain usable at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.emulateMedia({ reducedMotion: 'reduce' });
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    async function capture(name) {
      await page.evaluate(() => document.fonts.ready);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
        true,
      );
      for (const button of await page.locator('dialog[open] .modal-head button').all()) {
        const box = await button.boundingBox();
        expect(box.x).toBeGreaterThanOrEqual(0);
        expect(box.x + box.width).toBeLessThanOrEqual(width);
      }
      await shot(page, `${name}-${width}`);
    }
    async function close() {
      await page.keyboard.press('Escape');
      await expect(page.getByRole('dialog')).toHaveCount(0);
    }
    await page.goto(base);
    await expect(page.getByRole('heading', { name: '欢迎回来' })).toBeVisible();
    await capture('login');
    await page.getByRole('button', { name: '创建账号', exact: true }).click();
    await capture('register');
    await seed(page);
    await capture('home');
    await page.getByRole('button', { name: '创建旅程', exact: true }).click();
    await capture('create');
    await close();
    await page.getByRole('button', { name: '加入旅程', exact: true }).click();
    await capture('join');
    await close();
    await page.locator('.continue-card').click();
    await capture('itinerary');
    await page.locator('.activity-main').first().click();
    await capture('activity-editor');
    await close();
    await page.locator('.sync-status').click();
    await capture('sync');
    await close();
    await page.locator('.members-button').click();
    await capture('team');
    await page.getByRole('button', { name: '生成邀请', exact: true }).click();
    await expect(page.locator('.invite-code')).toBeVisible();
    await capture('invite');
    await close();
    await nav(page, '地图').click();
    await expect(page.locator('.map-offline-places')).toBeVisible();
    await capture('map');
    await nav(page, '费用').click();
    await capture('expenses');
    await page.getByRole('button', { name: '记一笔', exact: true }).click();
    await capture('expense-editor');
    await close();
    await nav(page, '管理').click();
    await capture('settings');
    await page.getByRole('button', { name: '日期与计划天数', exact: false }).click();
    await capture('dates');
    await close();
    await page.getByRole('button', { name: '已删除的内容', exact: true }).click();
    await capture('deleted');
    await close();
    await page.locator(width > 760 ? '.back-home' : '.header-home').click();
    await page.locator('.home-header .profile-button').click();
    await capture('personal');
    await page.getByLabel('外观', { exact: true }).selectOption('dark');
    await capture('personal-dark');
    await close();
    await page.locator('.continue-card').click();
    await nav(page, '管理').click();
    await capture('settings-dark');
    expect(errors).toEqual([]);
  });
