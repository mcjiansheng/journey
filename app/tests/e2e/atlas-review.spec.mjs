import { test, expect, request } from '@playwright/test';
import { fileURLToPath } from 'node:url';
import { mkdirSync } from 'node:fs';
import { createApp, shutdownServer } from '../../server/index.mjs';
let app, server, base, seededState;
const evidence = `../.local/evidence/atlas-review/${process.env.JOURNEY_REVIEW_PALETTE || 'forest'}-${process.env.JOURNEY_REVIEW_THEME || 'system'}`;
test.beforeEach(async ({page}) => {
 await page.addInitScript(prefs => localStorage.setItem('journey.appearance', JSON.stringify(prefs)), {palette: process.env.JOURNEY_REVIEW_PALETTE || 'forest', theme: process.env.JOURNEY_REVIEW_THEME || 'system'});
});
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
async function resetFixtureAppearance(page) {
 const prefs={palette:process.env.JOURNEY_REVIEW_PALETTE||'forest',theme:process.env.JOURNEY_REVIEW_THEME||'system'};
 const session=await (await page.request.get(base+'/api/session')).json();
 const result=await page.request.patch(base+'/api/me',{headers:{Origin:base,'X-CSRF-Token':session.csrfToken},data:{preferences:prefs}});
 expect(result.ok()).toBe(true);
}
async function seed(page) {
  if (seededState) {
    await page.context().addCookies(seededState.cookies);await resetFixtureAppearance(page);
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
  await fetch('/api/me',{method:'PATCH',headers,body:JSON.stringify({preferences:JSON.parse(localStorage.getItem('journey.appearance'))})});
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
    await expect(page.locator('.activity-card')).toHaveCount(2);
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
    await expect(page.locator('.expense-row')).toHaveCount(2);
    await capture('expenses');
    await page.getByRole('button', { name: '记一笔', exact: true }).click();
    await capture('expense-editor');
    await close();
    await nav(page, '旅程设置').click();
    await expect(page.getByLabel('旅程名称')).toBeVisible();
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
    await page.getByRole('navigation', {name:'设置分类'}).getByRole('button', {name:/^外观/}).click();
    await page.getByRole('button', {name:'深色',exact:true}).click();
    await expect(page.locator('html')).toHaveAttribute('data-theme','dark');
    await capture('personal-dark');
    await close();
    await page.locator('.continue-card').click();
    await nav(page, '旅程设置').click();
    await expect(page.getByLabel('旅程名称')).toBeVisible();
    await capture('settings-dark');
    expect(errors).toEqual([]);
  });

for (const width of [1440, 390]) test(`palette materials retain selection, weight and compact layout at ${width}px`, async ({page, context}) => {
  await page.setViewportSize({width,height:900});
  await page.emulateMedia({reducedMotion:'reduce'});
  await seed(page); await page.locator('.continue-card').click();
  await expect(page.locator('.activity-card')).toHaveCount(2);
  const client=await context.newCDPSession(page);
  for (const palette of ['forest','atlas']) for (const mode of ['light','dark','system']) for (const flat of [false,true]) {
    await page.emulateMedia({colorScheme:mode==='light'?'light':'dark',reducedMotion:'reduce'});
    await page.evaluate(({palette,mode,flat})=>{Object.assign(document.documentElement.dataset,{palette,theme:mode,transparency:String(flat)});},{palette,mode,flat});
    const indicator=page.locator(width>760?'.sidebar .selection-indicator':'.bottom-nav .selection-indicator');
    await expect(indicator).toBeVisible();
    const style=await indicator.evaluate(el=>{const s=getComputedStyle(el),root=getComputedStyle(document.documentElement);const sample=document.createElement('span');sample.style.color='var(--optical-selected)';document.body.append(sample);const expected=getComputedStyle(sample).color;sample.remove();return{background:s.backgroundColor,expected,surface:root.getPropertyValue('--surface').trim(),shadow:root.getPropertyValue('--optical-shadow').trim()}});
    expect(style.background).toBe(style.expected);
    if(flat) { expect(style.shadow).toBe('transparent'); expect(await page.locator('html').evaluate(el=>getComputedStyle(el).getPropertyValue('--pointer-highlight').trim())).toBe('transparent'); }
    for(const selector of ['.activity-time','.activity-main h3']) expect(await page.locator(selector).first().evaluate(el=>getComputedStyle(el).fontWeight)).toBe('600');
    if(width>760) expect(await page.getByRole('tab',{selected:true}).locator('strong').evaluate(el=>getComputedStyle(el).fontWeight)).toBe('600');
    expect(await page.locator('.trip-title').evaluate(el=>getComputedStyle(el).fontFamily)).not.toMatch(/Songti|Noto Serif|Source Han|Journey/i);
    expect((await page.locator('.activity-card').first().boundingBox()).y).toBeLessThan(width>760?300:230);
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
    await shot(page,`materials-${palette}-${mode}-${flat?'flat':'glass'}-${width}`);
  }
  // The system preference uses the same tokens; explicit off takes priority on Web.
  await client.send('Emulation.setEmulatedMedia',{features:[{name:'prefers-reduced-transparency',value:'reduce'}]});
  await page.evaluate(()=>document.documentElement.dataset.transparency='system');
  expect(await page.locator('html').evaluate(el=>getComputedStyle(el).getPropertyValue('--optical-shadow').trim())).toBe('transparent');
  await page.evaluate(()=>document.documentElement.dataset.transparency='false');
  expect(await page.locator('html').evaluate(el=>getComputedStyle(el).getPropertyValue('--optical-shadow').trim())).not.toBe('transparent');
});
