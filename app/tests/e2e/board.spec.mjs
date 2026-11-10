import { test, expect } from '@playwright/test';
import { fileURLToPath } from 'node:url';
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { createApp, shutdownServer } from '../../server/index.mjs';

let app, server, base;
const password = 'JourneyBoard2026!';
const suffix = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);

test.beforeAll(async () => {
  mkdirSync(resolve(process.cwd(), '../.local/evidence/1110-白板-小组件'), { recursive: true });
  app = createApp({
    distPath: fileURLToPath(new URL('../../dist/', import.meta.url)),
    databasePath: ':memory:',
    securityPath: ':memory:',
    config: { amapKey: '' },
  });
  server = await new Promise(resolve => {
    const listener = app.listen(0, '127.0.0.1', () => resolve(listener));
  });
  base = `http://127.0.0.1:${server.address().port}`;
  app.locals.config.appOrigin = base;
});

test.afterAll(async () => {
  if (server) await shutdownServer(server, app);
});

async function register(page, name = '白板测试员') {
  await page.goto(base);
  await page.getByRole('button', { name: '创建账号', exact: true }).click();
  await page.getByLabel('手机号或邮箱').fill(`board-${suffix()}@example.test`);
  await page.getByLabel('你的称呼').fill(name);
  await page.getByLabel('密码', { exact: true }).fill(password);
  await page.getByLabel('确认密码', { exact: true }).fill(password);
  await page.getByRole('button', { name: '创建账号并继续' }).click();
  await expect(page.getByRole('button', { name: '创建旅程', exact: true })).toBeVisible();
}

async function createTrip(page, name = '白板协作测试旅程') {
  await page.getByRole('button', { name: '创建旅程', exact: true }).click();
  await page.getByLabel('旅程名称').fill(name);
  await page.getByLabel('目的地', { exact: true }).fill('杭州');
  await page.getByLabel('出发日期', { exact: true }).fill('2026-12-01');
  await page.getByText('更多设置', { exact: true }).click();
  await page.getByLabel('旅程时区', { exact: true }).selectOption('Asia/Shanghai');
  await page.getByLabel('结束日期', { exact: true }).fill('2026-12-03');
  await page.getByRole('radio', { name: '平等团队', exact: true }).check();
  await page.getByRole('dialog').getByRole('button', { name: '创建旅程' }).click();
  await expect(page.locator('.itinerary-page')).toBeVisible();
}

async function addActivity(page, title = '断桥残雪') {
  await page.getByRole('button', { name: '添加活动', exact: true }).first().click();
  await page.getByLabel('活动名称').fill(title);
  await page.getByRole('dialog').getByRole('button', { name: '完成', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.getByRole('heading', { name: title, exact: true })).toBeVisible();
}

test('board: basic sticker lifecycle (stick note, edit text, scale, delete, restore)', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await register(page);
  await createTrip(page);

  // 1. Whiteboard navigation
  const boardNavBtn = page.locator('nav button[aria-label="白板"]').first();
  await expect(boardNavBtn).toBeVisible();
  await boardNavBtn.click();
  await expect(page.locator('.board-container')).toBeVisible();
  await expect(page.locator('#stage')).toBeVisible();

  // 2. Open sticker panel and add yellow sticky note
  await page.locator('#toolbar button[data-tool="sticker"]').click();
  await expect(page.locator('#panel')).toBeVisible();
  await page.locator('#panel .tabs button:has-text("便签")').click();
  await page.locator('.pick-note').first().click();
  await expect(page.locator('#panel')).toHaveCount(0);

  // 3. Verify note exists
  const note = page.locator('.board-item.item-note');
  await expect(note).toBeVisible();
  await expect(note.locator('.note-card')).toBeVisible();

  // 4. Edit text on note
  await note.dblclick();
  await note.locator('.note-text').fill('买一把西湖绸伞');
  await page.locator('#stage').click({ position: { x: 400, y: 300 } }); // blur
  await expect(note.locator('.note-text')).toContainText('买一把西湖绸伞');

  // 5. Select note and test contextual actions bar
  await note.click();
  await expect(page.locator('#actions')).toBeVisible();

  // 6. Delete note
  await page.locator('#actions button.danger:has-text("删除")').click();
  await expect(note).toHaveCount(0);

  // 7. Open Recent Deletions drawer and restore
  await page.locator('#top-right button[aria-label="最近删除"]').click();
  await expect(page.locator('#drawer')).toBeVisible();
  await expect(page.locator('#drawer .recent-row')).toContainText('买一把西湖绸伞');
  await page.locator('#drawer .restore-btn').click();
  await page.locator('#drawer button[aria-label="关闭"]').click();

  // 8. Note is restored
  await expect(page.locator('.board-item.item-note')).toBeVisible();
  await expect(page.locator('.board-item.item-note .note-text')).toContainText('买一把西湖绸伞');
});

test('board: widget integration with itinerary (activity pin, rename, gone state, revival)', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await register(page);
  await createTrip(page);
  await addActivity(page, '苏堤春晓');

  // 1. In itinerary, open activity details menu and click "贴到白板"
  const actHeading = page.getByRole('heading', { name: '苏堤春晓', exact: true });
  await expect(actHeading).toBeVisible();
  const actCard = page.locator('article.activity-card:has-text("苏堤春晓")');
  await actCard.locator('summary[aria-label^="活动更多操作"]').click();
  const pinBtn = actCard.locator('button.pin-to-board-button');
  await expect(pinBtn).toBeVisible();
  await pinBtn.click();

  // 2. Automatically switched to Whiteboard and widget is pinned
  await expect(page.locator('.board-container')).toBeVisible();
  const actWidget = page.locator('.board-item.item-widget .widget-frame.w-act');
  await expect(actWidget).toBeVisible();
  await expect(actWidget.locator('.title')).toContainText('苏堤春晓');

  // 3. Switch back to itinerary, rename activity
  await page.locator('nav button[aria-label="行程"]').first().click();
  await expect(page.locator('.itinerary-page')).toBeVisible();
  await page.locator('article.activity-card:has-text("苏堤春晓") button.activity-main').click();
  await page.getByLabel('活动名称').fill('苏堤春晓漫步');
  await page.getByRole('dialog').getByRole('button', { name: '完成', exact: true }).click();

  // 4. Switch to Whiteboard, check title updated
  await page.locator('nav button[aria-label="白板"]').first().click();
  await expect(actWidget.locator('.title')).toContainText('苏堤春晓漫步');

  // 5. Switch to itinerary, delete the activity
  await page.locator('nav button[aria-label="行程"]').first().click();
  const card2 = page.locator('article.activity-card:has-text("苏堤春晓漫步")');
  await card2.locator('summary[aria-label^="活动更多操作"]').click();
  await card2.locator('button:has-text("删除")').click();

  // 6. Switch to Whiteboard -> widget has gone state (gone-pill, is-gone)
  await page.locator('nav button[aria-label="白板"]').first().click();
  await expect(page.locator('.board-item.item-widget .widget-frame.is-gone')).toBeVisible();
  await expect(actWidget.locator('.gone-pill')).toContainText('已移除');

  // 7. Switch to itinerary, restore activity
  await page.locator('nav button[aria-label="旅程设置"]').first().click();
  await page.locator('button.settings-link:has-text("已删除的内容")').click();
  await page.locator('.modal button:has-text("恢复")').first().click();
  await page.locator('.modal button[aria-label="关闭"]').click();

  // 8. Switch to Whiteboard -> widget is revived!
  await page.locator('nav button[aria-label="白板"]').first().click();
  await expect(page.locator('.board-item.item-widget .widget-frame.is-gone')).toHaveCount(0);
  await expect(actWidget.locator('.title')).toContainText('苏堤春晓漫步');
});

test('board: freehand drawing with pen, unified z-order, and eraser', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await register(page);
  await createTrip(page);

  await page.locator('nav button[aria-label="白板"]').first().click();
  await expect(page.locator('.board-container')).toBeVisible();

  // 1. Select Pen tool
  await page.locator('#toolbar button[data-tool="pen"]').click();
  await expect(page.locator('#options')).toBeVisible();

  // 2. Draw stroke
  const stage = page.locator('#stage');
  const box = await stage.boundingBox();
  expect(box).toBeTruthy();
  // Draw clear of the viewport center, where the next sticker spawns, so the
  // eraser can hit a visible part of the stroke.
  const startX = box.x + 120;
  const startY = box.y + 120;

  await page.mouse.move(startX, startY);
  await page.mouse.down();
  await page.mouse.move(startX + 100, startY + 50);
  await page.mouse.move(startX + 150, startY + 120);
  await page.mouse.up();

  // Stroke item created
  await expect(page.locator('.board-item.item-stroke')).toBeVisible();

  // 3. Add a sticky note that overlaps the stroke
  await page.locator('#toolbar button[data-tool="sticker"]').click();
  await page.locator('#panel .tabs button:has-text("便签")').click();
  await page.locator('.pick-note').first().click();

  const note = page.locator('.board-item.item-note');
  await expect(note).toBeVisible();

  // 4. Test bring to front / send to back
  await note.click();
  await page.locator('#actions button:has-text("置顶")').click();
  const noteZ = await note.evaluate(el => parseInt(el.style.zIndex || '0', 10));
  const strokeZ = await page.locator('.board-item.item-stroke').evaluate(el => parseInt(el.style.zIndex || '0', 10));
  expect(noteZ).toBeGreaterThan(strokeZ);

  // 5. Select eraser tool and erase the stroke where it is visible (not covered by the note).
  // The eraser removes whole strokes only; stickers under the pointer are never erased.
  await page.locator('#toolbar button[data-tool="eraser"]').click();
  const strokeStart = await page.locator('.board-item.item-stroke path').evaluate((path) => {
    const p = path.getPointAtLength(0);
    const m = path.getScreenCTM();
    return { x: p.x * m.a + p.y * m.c + m.e, y: p.x * m.b + p.y * m.d + m.f };
  });
  const hitIsStroke = await page.evaluate(
    ({ x, y }) => Boolean(document.elementFromPoint(x, y)?.closest('.item-stroke')),
    strokeStart,
  );
  expect(hitIsStroke).toBe(true);
  await page.mouse.move(strokeStart.x, strokeStart.y);
  await page.mouse.down();
  await page.mouse.move(strokeStart.x + 2, strokeStart.y + 1);
  await page.mouse.up();
  await expect(page.locator('.board-item.item-stroke')).toHaveCount(0);
  await expect(note).toBeVisible();

  // 6. Eraser over a sticker does not delete it.
  const noteBox = await note.boundingBox();
  await page.mouse.click(noteBox.x + noteBox.width / 2, noteBox.y + noteBox.height / 2);
  await expect(note).toBeVisible();
});

test('board: responsive screenshots across palettes and viewports', async ({ page }) => {
  await register(page);
  await createTrip(page);
  await addActivity(page, '雷峰夕照');

  // Navigate to whiteboard and add a few sample widgets & notes
  await page.locator('nav button[aria-label="白板"]').first().click();
  await expect(page.locator('.board-container')).toBeVisible();

  // Add countdown widget
  await page.locator('#toolbar button[data-tool="sticker"]').click();
  await page.locator('#panel .gallery button:has-text("倒计时")').click();

  // Add clock widget
  await page.locator('#toolbar button[data-tool="sticker"]').click();
  await page.locator('#panel .gallery button:has-text("当地时间")').click();

  // Add note
  await page.locator('#toolbar button[data-tool="sticker"]').click();
  await page.locator('#panel .tabs button:has-text("便签")').click();
  await page.locator('.pick-note').first().click();

  // 1. Desktop 1280px Light Forest
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.screenshot({
    path: '../.local/evidence/1110-白板-小组件/board-desktop-1280-forest-light.png',
    fullPage: false,
  });

  // 2. Desktop 1280px Dark Forest
  await page.evaluate(() => {
    document.documentElement.dataset.mode = 'dark';
  });
  await page.screenshot({
    path: '../.local/evidence/1110-白板-小组件/board-desktop-1280-forest-dark.png',
    fullPage: false,
  });

  // 3. Mobile 390px Light Forest
  await page.evaluate(() => {
    document.documentElement.dataset.mode = 'light';
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({
    path: '../.local/evidence/1110-白板-小组件/board-mobile-390-forest-light.png',
    fullPage: false,
  });

  // 4. Mobile 390px Dark Atlas
  await page.evaluate(() => {
    document.documentElement.dataset.palette = 'atlas';
    document.documentElement.dataset.mode = 'dark';
  });
  await page.screenshot({
    path: '../.local/evidence/1110-白板-小组件/board-mobile-390-atlas-dark.png',
    fullPage: false,
  });

  // 5. Desktop 1440px Light Forest
  await page.evaluate(() => {
    document.documentElement.dataset.palette = 'forest';
    document.documentElement.dataset.mode = 'light';
  });
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.screenshot({
    path: '../.local/evidence/1110-白板-小组件/board-desktop-1440-forest-light.png',
    fullPage: false,
  });
});
