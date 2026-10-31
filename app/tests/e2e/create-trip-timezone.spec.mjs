import { test, expect } from '@playwright/test';
import { fileURLToPath } from 'node:url';
import { createApp, shutdownServer } from '../../server/index.mjs';

let app, server, base;
test.beforeAll(async () => {
  app = createApp({ distPath: fileURLToPath(new URL('../../dist/', import.meta.url)), databasePath: ':memory:', securityPath: ':memory:', config: { amapKey: '' } });
  server = await new Promise(resolve => { const listener = app.listen(0, '127.0.0.1', () => resolve(listener)); });
  base = `http://127.0.0.1:${server.address().port}`;
  app.locals.config.appOrigin = base;
});
test.afterAll(async () => { if (server) await shutdownServer(server, app); });

async function openCreate(page, destination, name) {
  await page.goto(base);
  await page.evaluate(async () => {
    const response = await fetch('/api/auth/register', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ identifier: `trip-timezone-${crypto.randomUUID()}@example.test`, password: 'JourneyTimezone2026!', displayName: '旅程验收' }) });
    if (!response.ok) throw new Error(`Registration failed: ${response.status}`);
  });
  await page.reload();
  await page.getByRole('button', { name: '创建旅程', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('旅程名称').fill(name);
  await dialog.getByLabel('目的地', { exact: true }).fill(destination);
  await dialog.getByLabel('出发日期').fill('2026-11-01');
  await dialog.getByLabel('结束日期').fill('2026-11-03');
  return dialog;
}
async function createdTrip(page, name) {
  return page.evaluate(async name => (await fetch('/api/trips').then(r => r.json())).trips.find(t => t.name === name), name);
}

test('Beijing works immediately with no map key even when device is overseas', async ({ browser }) => {
  const context = await browser.newContext({ timezoneId: 'America/Los_Angeles', viewport: { width: 390, height: 844 } });
  try {
    const page = await context.newPage();
    const dialog = await openCreate(page, '北京', '北京自动时区');
    await expect(dialog.getByRole('radio', { name: '管理员团队', exact: true })).toBeChecked();
    await expect(dialog.getByLabel('旅程时区')).toBeHidden();
    await dialog.getByRole('button', { name: '创建旅程', exact: true }).click();
    await expect(dialog).toHaveCount(0);
    const trip = await createdTrip(page, '北京自动时区');
    expect(trip.timezone).toBe('Asia/Shanghai');
    expect(trip.teamMode).toBe('admin');
    expect(trip.dayCount).toBe(3);
  } finally { await context.close(); }
});

test('unavailable destination lookup keeps local timezone and allows creation', async ({ browser }) => {
  const context = await browser.newContext({ timezoneId: 'Europe/Paris' });
  try {
    const page = await context.newPage();
    const dialog = await openCreate(page, '还没定下的小镇', '当地默认时区');
    await page.waitForTimeout(600);
    await expect(dialog.getByRole('alert')).toHaveCount(0);
    await dialog.getByRole('radio', { name: '平等团队', exact: true }).check();
    await dialog.getByRole('button', { name: '创建旅程', exact: true }).click();
    await expect(dialog).toHaveCount(0);
    const trip = await createdTrip(page, '当地默认时区');
    expect(trip.timezone).toBe('Europe/Paris');
    expect(trip.teamMode).toBe('equal');
  } finally { await context.close(); }
});

test('manual adjustment survives destination changes and failed creation preserves the form', async ({ page }) => {
  const dialog = await openCreate(page, '北京', '保留创建输入');
  await dialog.getByRole('button', { name: '更多设置', exact: true }).click();
  await dialog.getByLabel('旅程时区').selectOption('Asia/Tokyo');
  await dialog.getByLabel('目的地', { exact: true }).fill('上海');
  await expect(dialog.getByLabel('旅程时区')).toHaveValue('Asia/Tokyo');
  let failed = false;
  await page.route('**/api/trips', route => {
    if (route.request().method() === 'POST' && !failed) {
      failed = true;
      return route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: '暂时无法创建' }) });
    }
    return route.continue();
  });
  await dialog.getByRole('button', { name: '创建旅程', exact: true }).click();
  await expect(dialog.getByRole('alert')).toBeVisible();
  await expect(dialog.getByLabel('旅程名称')).toHaveValue('保留创建输入');
  await expect(dialog.getByLabel('目的地', { exact: true })).toHaveValue('上海');
  await expect(dialog.getByLabel('旅程时区')).toHaveValue('Asia/Tokyo');
  await dialog.getByRole('button', { name: '创建旅程', exact: true }).click();
  await expect(dialog).toHaveCount(0);
  expect((await createdTrip(page, '保留创建输入')).timezone).toBe('Asia/Tokyo');
});
