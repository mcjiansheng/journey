import { test, expect } from '@playwright/test';
import { fileURLToPath } from 'node:url';
import { createApp, shutdownServer } from '../../server/index.mjs';
import { launchWebKit } from '../../scripts/browser-runtime.mjs';

let app, server, base;
test.beforeAll(async () => {
  app = createApp({
    distPath: fileURLToPath(new URL('../../dist/', import.meta.url)),
    databasePath: ':memory:',
    securityPath: ':memory:',
    config: { amapKey: 'deferred-init-test' },
  });
  server = await new Promise((resolve) => {
    const listener = app.listen(0, '127.0.0.1', () => resolve(listener));
  });
  base = `http://127.0.0.1:${server.address().port}`;
  app.locals.config.appOrigin = base;
});
test.afterAll(async () => { if (server) await shutdownServer(server, app); });

// Implement only the SDK methods this empty-trip fixture actually exercises.
function installSdk() {
  window.__mapInstances = [];
  window.__mapDestroyed = [];
  class Pixel { constructor(x, y) { this.x = x; this.y = y; } }
  class Scale {}
  class Service {}
  class Geocoder {
    getLocation(address, callback) {
      callback('complete', { geocodes: [{ location: { lng: 118.8, lat: 32.1 }, formattedAddress: address }] });
    }
  }
  class Map {
    constructor(container, options) {
      this.index = window.__mapInstances.length;
      this.center = { lng: options.center[0], lat: options.center[1] };
      this.zoom = options.zoom;
      this.container = container;
      this.canvas = document.createElement('canvas');
      this.canvas.dataset.sdkCanvas = String(this.index);
      container.append(this.canvas);
      this.pendingSidebar = document.querySelector('.sidebar').getAnimations().some(a => ['running', 'paused'].includes(a.playState));
      window.__mapInstances.push(this);
    }
    on(name, callback) { if (name === 'complete') queueMicrotask(callback); }
    addControl() {}
    remove() {}
    add() {}
    getCenter() { return this.center; }
    getZoom() { return this.zoom; }
    stopMove() {}
    destroy() { window.__mapDestroyed.push(this.index); this.canvas.remove(); }
  }
  window.AMap = {
    Map, Pixel, Scale, Geocoder,
    PlaceSearch: Service, AutoComplete: Service, Walking: Service,
    Driving: Service, Riding: Service, Transfer: Service,
    plugin(names, callback) { callback(); },
  };
  window.___onAPILoaded();
}

const nav = (page, label) => page.getByRole('navigation', { name: '主导航', exact: true }).getByRole('button', { name: label, exact: true });
async function settleEffects(page) {
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
}
async function holdSidebar(page) {
  await page.evaluate(() => {
    // A real paused WAAPI animation keeps .finished pending without wall-clock races.
    window.__entryAnimation = document.querySelector('.sidebar').animate(
      [{ opacity: 1 }, { opacity: 0.99 }], { duration: 60000 },
    );
    window.__entryAnimation.pause();
  });
}
async function setup(page) {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await page.addInitScript(() => { window.__mapInstances = []; window.__mapDestroyed = []; });
  let sdkRequests = 0;
  await page.route('https://webapi.amap.com/maps?**', route => {
    sdkRequests++;
    return route.fulfill({ contentType: 'text/javascript', body: `(${installSdk.toString()})();` });
  });
  await page.goto(base);
  await page.evaluate(async () => {
    const auth = await fetch('/api/auth/register', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ identifier: `deferred-${crypto.randomUUID()}@example.test`, password: 'JourneyDeferred2026!', displayName: '地图生命周期验收' }),
    }).then(r => r.json());
    const headers = { 'Content-Type': 'application/json', 'X-CSRF-Token': auth.csrfToken };
    const snapshot = await fetch('/api/trips', {
      method: 'POST', headers,
      body: JSON.stringify({ id: crypto.randomUUID(), name: '延后地图初始化', teamMode: 'admin', timezone: 'Asia/Shanghai', currency: 'CNY', dayCount: 1, startDate: '2026-11-01', destination: '南京' }),
    }).then(r => r.json());
    await fetch('/api/navigation', { method: 'PUT', headers, body: JSON.stringify({ lastTripId: snapshot.trip.id }) });
  });
  await page.reload();
  await page.getByRole('button', { name: /继续旅程/ }).click();
  await expect(nav(page, '行程')).toHaveAttribute('aria-current', 'page');
  return () => sdkRequests;
}

async function verifyLifecycle(page) {
  const sdkRequests = await setup(page);
  await holdSidebar(page);
  await nav(page, '地图').click();
  await expect(page.getByRole('region', { name: '正在准备地图' })).toHaveAttribute('aria-busy', 'true');
  await settleEffects(page);
  expect(sdkRequests()).toBe(0);
  await expect(page.locator('.map-canvas')).toHaveCount(0);
  await nav(page, '行程').click();
  await page.evaluate(() => window.__entryAnimation.finish());
  await settleEffects(page);
  expect(sdkRequests()).toBe(0);
  expect(await page.evaluate(() => window.__mapInstances.length)).toBe(0);
  await expect(page.locator('.journey-map')).toHaveCount(0);

  await holdSidebar(page);
  await nav(page, '地图').click();
  await expect(page.getByRole('region', { name: '正在准备地图' })).toBeVisible();
  await settleEffects(page);
  expect(sdkRequests()).toBe(0);
  await page.evaluate(() => window.__entryAnimation.finish());
  await expect.poll(() => page.evaluate(() => window.__mapInstances.length)).toBe(1);
  await expect(page.getByText('正在定位地图…', { exact: true })).toHaveCount(0);
  expect(await page.evaluate(() => window.__mapInstances[0].pendingSidebar)).toBe(false);
  expect(sdkRequests()).toBe(1);
  await page.evaluate(() => { window.__retainedCanvas = document.querySelector('.map-canvas'); });

  for (const label of ['行程', '费用', '旅程设置', '行程']) {
    await nav(page, label).click();
    await expect(page.locator('.journey-map')).toBeHidden();
    expect(await page.locator('.journey-map').evaluate(el => !!el.closest('[inert][aria-hidden="true"]'))).toBe(true);
    await nav(page, '地图').click();
    await expect(page.locator('.journey-map')).toBeVisible();
    expect(await page.evaluate(() => ({
      count: window.__mapInstances.length,
      destroyed: window.__mapDestroyed,
      sameContainer: document.querySelector('.map-canvas') === window.__retainedCanvas,
      sameSdkCanvas: document.querySelector('[data-sdk-canvas]') === window.__mapInstances[0].canvas,
    }))).toEqual({ count: 1, destroyed: [], sameContainer: true, sameSdkCanvas: true });
  }
  await page.getByRole('button', { name: '我的旅程', exact: true }).click();
  await expect(page.getByRole('heading', { name: '我的旅程', exact: true })).toBeVisible();
  await expect(page.locator('.map-canvas')).toHaveCount(0);
  expect(await page.evaluate(() => window.__mapDestroyed)).toEqual([0]);
}

test('first map visit waits for the sidebar, cancels cleanly, and retains its canvas until home', async ({ page }) => {
  await verifyLifecycle(page);
});
test('WebKit defers, cancels and retains the first map instance', async () => {
  const browser = await launchWebKit();
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, serviceWorkers: 'block' });
  try { await verifyLifecycle(await context.newPage()); }
  finally { await context.close(); await browser.close(); }
});
