import { test, expect } from '@playwright/test';
import { fileURLToPath } from 'node:url';
import { mkdirSync, writeFileSync } from 'node:fs';
import { palettePreviews } from '../../src/palette-meta.js';
import { launchWebKit } from '../../scripts/browser-runtime.mjs';
const evidence = '../.local/evidence/settings-redesign';
import { createApp, shutdownServer } from '../../server/index.mjs';
let app, server, base;
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
async function account(page) {
  const r = await page.request.post(`${base}/api/auth/register`, {
    headers: { origin: base },
    data: {
      identifier: `settings-${crypto.randomUUID()}@example.test`,
      password: 'JourneySettings2026!',
      displayName: '设置验收',
    },
  });
  expect(r.status()).toBe(201);
  await page.goto(base);
  await expect(page.getByRole('button', { name: '我的设置', exact: true })).toBeVisible();
}
test('desktop categorized settings save appearance to the account and survive reload', async ({
  page, browser,
}) => {
  await page.setViewportSize({ width: 1280, height: 850 });
  await account(page);
  await page.getByRole('button', { name: '我的设置', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: '我的设置', exact: true });
  await expect(dialog).toBeVisible();
  await expect.poll(()=>dialog.locator('.personal-category').evaluate(el=>el.scrollHeight-el.clientHeight)).toBeLessThanOrEqual(1);
  await dialog.screenshot({ path: `${evidence}/desktop-forest-light.png` });
  await dialog.getByRole('button', { name: '海图蓝', exact: true }).click();
  await expect(page.locator('html')).toHaveAttribute('data-palette', 'atlas');
  await expect(dialog.getByRole('button', { name: '深色', exact: true })).toBeEnabled();
  await dialog.getByRole('button', { name: '深色', exact: true }).click();
  await expect(dialog.getByRole('button', { name: '深色', exact: true })).toBeEnabled();
  await dialog
    .getByRole('group', { name: '减少透明效果', exact: true })
    .getByRole('button', { name: '开', exact: true })
    .click();
  await expect(dialog.getByRole('button', { name: '深色', exact: true })).toBeEnabled();
  const session = await page.request.get(`${base}/api/session`);
  expect((await session.json()).user.preferences).toMatchObject({
    palette: 'atlas',
    theme: 'dark',
    reducedTransparency: true,
  });
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-palette', 'atlas');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await expect(page.locator('html')).toHaveAttribute('data-transparency', 'true');
  const storage = await page.context().storageState();
  const otherDevice = await browser.newContext({
    storageState: { cookies: storage.cookies, origins: [] },
  });
  try {
    const secondPage = await otherDevice.newPage();
    await secondPage.goto(base);
    await expect(secondPage.locator('html')).toHaveAttribute('data-palette', 'atlas');
    await expect(secondPage.locator('html')).toHaveAttribute('data-theme', 'dark');
    await expect(secondPage.locator('html')).toHaveAttribute('data-transparency', 'true');
  } finally {
    await otherDevice.close();
  }
  // The parser-blocking script is served by the same production server under Helmet CSP.
  const bootstrap = await page.request.get(`${base}/appearance-init.js`);
  expect(bootstrap.status()).toBe(200);
  expect(bootstrap.headers()['content-security-policy']).toContain("'self'");
  expect(await bootstrap.text()).toContain('root.dataset.palette');
});
test('mobile settings open an index, navigate categories and recover from a failed save', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await account(page);
  await page.getByRole('button', { name: '我的设置', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: '我的设置', exact: true });
  await expect(dialog.getByRole('heading', { name: '外观', exact: true })).not.toBeVisible();
  await page.screenshot({ path: `${evidence}/mobile-index.png` });
  await expect(
    dialog.getByRole('navigation', { name: '设置分类' }).getByRole('button', { name: /地图/ }),
  ).not.toBeVisible();
  await dialog
    .getByRole('navigation', { name: '设置分类' })
    .getByRole('button', { name: /外观/ })
    .click();
  await expect(dialog.getByRole('heading', { name: '外观', exact: true })).toBeVisible();
  await page.screenshot({ path: `${evidence}/mobile-appearance.png` });
  await page.route('**/api/me', (route) =>
    route.fulfill({
      status: 503,
      contentType: 'application/json',
      body: JSON.stringify({ error: { code: 'UNAVAILABLE', message: '暂时无法保存设置' } }),
    }),
  );
  await dialog.getByRole('button', { name: '海图蓝', exact: true }).click();
  await expect(dialog.getByRole('alert')).toContainText('暂时无法保存设置');
  await expect(page.locator('html')).toHaveAttribute('data-palette', 'forest');
  await dialog.getByRole('button', { name: '我的设置', exact: true }).click();
  await dialog
    .getByRole('navigation', { name: '设置分类' })
    .getByRole('button', { name: /保存与同步/ })
    .click();
  await expect(dialog.getByRole('button', { name: '立即同步', exact: true })).toBeVisible();
});

test('head restores palette and browser chrome before the app module runs', async ({ page }) => {
  await page.addInitScript(() =>
    localStorage.setItem(
      'journey.appearance',
      JSON.stringify({
        palette: 'atlas',
        theme: 'dark',
        reducedMotion: true,
        reducedTransparency: true,
      }),
    ),
  );
  await page.route('**/assets/**', (route) =>
    route.request().url().split('?')[0].endsWith('.js') ? route.abort() : route.continue(),
  );
  await page.goto(base);
  await expect(page.locator('#root')).toBeEmpty();
  await expect(page.locator('html')).toHaveAttribute('data-palette', 'atlas');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await expect(page.locator('html')).toHaveAttribute('data-motion', 'true');
  await expect(page.locator('meta[name="theme-color"]')).toHaveAttribute(
    'content',
    palettePreviews.atlas.dark.page,
  );
});

test('closing settings during a failed save restores the global appearance',async({page})=>{
 await page.setViewportSize({width:1440,height:900});await account(page);
 await page.getByRole('button',{name:'我的设置',exact:true}).click();
 let release;
 const gate=new Promise(resolve=>release=resolve);
 await page.route('**/api/me',async route=>{await gate;await route.fulfill({status:503,contentType:'application/json',body:JSON.stringify({error:{message:'暂时无法保存设置'}})});});
 await page.getByRole('button',{name:'海图蓝',exact:true}).click();
 await expect(page.locator('html')).toHaveAttribute('data-palette','atlas');
 await page.keyboard.press('Escape');await expect(page.getByRole('dialog')).toHaveCount(0);
 release();
 await expect(page.locator('html')).toHaveAttribute('data-palette','forest');
 expect(await page.evaluate(()=>JSON.parse(localStorage.getItem('journey.appearance')).palette)).not.toBe('atlas');
});


test('reopening settings waits for the pending save before accepting a new choice',async({page})=>{
 await page.setViewportSize({width:1440,height:900});await account(page);
 let release;let calls=0;
 const gate=new Promise(resolve=>release=resolve);
 await page.route('**/api/me',async route=>{
  if(route.request().method()!=='PATCH')return route.continue();
  if(++calls!==1)return route.continue();
  await gate;
  await route.fulfill({status:503,contentType:'application/json',body:JSON.stringify({error:{message:'暂时无法保存设置'}})});
 });
 await page.getByRole('button',{name:'我的设置',exact:true}).click();
 await page.getByRole('button',{name:'海图蓝',exact:true}).click();
 await expect.poll(()=>calls).toBe(1);
 await page.keyboard.press('Escape');
 await page.getByRole('button',{name:'我的设置',exact:true}).click();
 await expect(page.getByRole('button',{name:'海图蓝',exact:true})).toBeDisabled();
 const failed=page.waitForResponse(r=>r.url().endsWith('/api/me')&&r.status()===503);
 release();await (await failed).finished();
 await expect(page.locator('html')).toHaveAttribute('data-palette','forest');
 await expect(page.getByRole('button',{name:'海图蓝',exact:true})).toBeEnabled();
 const saved=page.waitForResponse(r=>r.url().endsWith('/api/me')&&r.request().method()==='PATCH'&&r.status()===200);
 await page.getByRole('button',{name:'海图蓝',exact:true}).click();await saved;
 await expect(page.locator('html')).toHaveAttribute('data-palette','atlas');
 await page.reload();
 await expect(page.locator('html')).toHaveAttribute('data-palette','atlas');
});


test('account display name saves on blur and survives reopening settings',async({page})=>{
 await page.setViewportSize({width:1440,height:900});await account(page);
 const errors=[];page.on('pageerror',error=>errors.push(error.message));
 await page.getByRole('button',{name:'我的设置',exact:true}).click();
 await page.getByRole('navigation',{name:'设置分类'}).getByRole('button',{name:/^账号/}).click();
 const saved=page.waitForResponse(r=>r.url().endsWith('/api/me')&&r.request().method()==='PATCH');
 await page.getByLabel('你的称呼').fill('新的称呼');await page.getByLabel('你的称呼').press('Tab');
 const response=await saved;expect(response.ok()).toBe(true);expect((await response.json()).displayName).toBe('新的称呼');
 await page.reload();
 await page.getByRole('button',{name:'我的设置',exact:true}).click();
 await page.getByRole('navigation',{name:'设置分类'}).getByRole('button',{name:/^账号/}).click();
 await expect(page.getByLabel('你的称呼')).toHaveValue('新的称呼');expect(errors).toEqual([]);
});

async function openMotionSettings(page, width = 1280) {
  await page.setViewportSize({ width, height: 850 });
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await account(page);
  await page.getByRole('button', { name: '我的设置', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: '我的设置', exact: true });
  await expect(dialog).not.toHaveAttribute('data-enter');
  await dialog.getByRole('navigation', { name: '设置分类' })
    .getByRole('button', { name: /^辅助功能/ }).click();
  await expect(dialog.getByRole('heading', { name: '辅助功能', exact: true })).toBeVisible();
  return dialog;
}

async function sampleMotionChoice(group, choice) {
  return group.getByRole('button', { name: choice, exact: true }).evaluate(async (button) => {
    const dialog = button.closest('dialog');
    const top = dialog.getBoundingClientRect().top;
    const samples = [];
    button.click();
    const start = performance.now();
    while (performance.now() - start < 260) {
      await new Promise(requestAnimationFrame);
      samples.push({ opacity: Number(getComputedStyle(dialog).opacity), top: dialog.getBoundingClientRect().top });
    }
    return { top, samples };
  });
}

for (const engine of ['Chrome', 'WebKit']) {
  test(`${engine}: restoring motion keeps an open dialog still and follows all three preferences`, async ({ page }) => {
    const browser = engine === 'WebKit' ? await launchWebKit() : null;
    try {
      if (browser) page = await browser.newPage();
      const dialog = await openMotionSettings(page, engine === 'WebKit' ? 390 : 1280);
      const group = dialog.getByRole('group', { name: '减少动态效果', exact: true });
      await group.getByRole('button', { name: '开', exact: true }).click();
      await expect(group.getByRole('button', { name: '跟随系统', exact: true })).toBeEnabled();
      const result = await sampleMotionChoice(group, '跟随系统');
      writeFileSync(`${evidence}/motion-${engine.toLowerCase()}-restored.json`, JSON.stringify(result, null, 2));
      await dialog.screenshot({ path: `${evidence}/motion-${engine.toLowerCase()}-restored.png` });
      expect(result.samples.length).toBeGreaterThan(3);
      expect(result.samples.every(sample => sample.opacity === 1 && Math.abs(sample.top - result.top) < 0.1)).toBe(true);
      await expect(page.locator('html')).toHaveAttribute('data-motion', 'system');
      const indicator = group.locator('.selection-indicator');
      await expect.poll(() => indicator.evaluate(el => getComputedStyle(el).transitionDuration)).not.toBe('0s');
      await page.emulateMedia({ reducedMotion: 'reduce' });
      await expect.poll(() => indicator.evaluate(el => getComputedStyle(el).transitionDuration)).toBe('0s');
      await group.getByRole('button', { name: '关', exact: true }).click();
      await expect(group.getByRole('button', { name: '跟随系统', exact: true })).toBeEnabled();
      await expect.poll(() => indicator.evaluate(el => getComputedStyle(el).transitionDuration)).not.toBe('0s');
      await group.getByRole('button', { name: '跟随系统', exact: true }).click();
      await expect(group.getByRole('button', { name: '开', exact: true })).toBeEnabled();
      await expect.poll(() => indicator.evaluate(el => getComputedStyle(el).transitionDuration)).toBe('0s');
      await page.keyboard.press('Escape');
      await page.getByRole('button', { name: '我的设置', exact: true }).click();
      await expect(page.getByRole('dialog')).not.toHaveAttribute('data-enter');
      await expect(page.getByRole('dialog')).toHaveCSS('opacity', '1');
    } finally {
      if (browser) await browser.close();
    }
  });
}

test('settings selections move continuously and rapid category changes keep the final content', async ({ page }) => {
  const dialog = await openMotionSettings(page);
  const group = dialog.getByRole('group', { name: '减少动态效果', exact: true });
  const positions = await group.getByRole('button', { name: '关', exact: true }).evaluate(async button => {
    const surface = button.parentElement.querySelector('.selection-indicator');
    const positions = [surface.getBoundingClientRect().left];
    button.click();
    const start = performance.now();
    while (performance.now() - start < 240) {
      await new Promise(requestAnimationFrame);
      positions.push(surface.getBoundingClientRect().left);
    }
    return positions;
  });
  const from = positions[0], to = positions.at(-1);
  expect(to - from).toBeGreaterThan(20);
  expect(positions.filter(value => value > from + 1 && value < to - 1).length).toBeGreaterThan(1);
  const result = await dialog.evaluate(async dialog => {
    const panel = dialog.querySelector('.personal-category');
    const choose = title => [...dialog.querySelectorAll('nav button')].find(button => button.querySelector('strong').textContent === title).click();
    choose('通知与提示');
    const opacities = [];
    const start = performance.now();
    while (performance.now() - start < 220) {
      await new Promise(requestAnimationFrame);
      opacities.push(Number(getComputedStyle(panel).opacity));
    }
    choose('外观');
    await new Promise(requestAnimationFrame);
    choose('通知与提示');
    await new Promise(resolve => setTimeout(resolve, 220));
    return { opacities, heading: panel.querySelector('h3').textContent, finalOpacity: getComputedStyle(panel).opacity };
  });
  writeFileSync(`${evidence}/motion-selection-and-category.json`, JSON.stringify({ positions, ...result }, null, 2));
  await dialog.screenshot({ path: `${evidence}/motion-notifications.png` });
  expect(result.opacities.some(opacity => opacity > 0 && opacity < 1)).toBe(true);
  expect(result.heading).toBe('通知与提示');
  expect(result.finalOpacity).toBe('1');
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
});
