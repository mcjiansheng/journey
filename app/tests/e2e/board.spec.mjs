import { test, expect } from '@playwright/test';
import { fileURLToPath } from 'node:url';
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { deflateSync, crc32 } from 'node:zlib';
import { createApp, shutdownServer } from '../../server/index.mjs';

let app, server, base;
const password = 'JourneyBoard2026!';
const suffix = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);

test.beforeAll(async () => {
  mkdirSync(resolve(process.cwd(), '../.local/evidence/1111-白板界面'), { recursive: true });
  app = createApp({
    distPath: fileURLToPath(new URL('../../dist/', import.meta.url)),
    databasePath: ':memory:',
    securityPath: ':memory:',
    // No keys, even when ../.local/amap.json has them: map widgets use tiles.
    config: { amapKey: '', amapWebKey: '' },
  });
  server = await new Promise((resolve) => {
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

async function boardItems(page, boardId = 'default-board') {
  return page.evaluate(async (boardId) => {
    const list = await fetch('/api/trips').then((r) => r.json());
    const tripId = list.trips[0].id;
    const res = await fetch(`/api/trips/${tripId}/boards/${boardId}/items`).then((r) => r.json());
    const snapshot = await fetch(`/api/trips/${tripId}`).then((r) => r.json());
    return {
      tripId,
      items: res.items.map((i) => ({
        id: i.id,
        state: i.state,
        generation: i.generation,
        payload: i.payload,
      })),
      objects: snapshot.objects,
    };
  }, boardId);
}

async function seedPlaceWidget(page) {
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
    const post = async (objectType, patch, objectId) => {
      const res = await fetch(`/api/trips/${tripId}/operations`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          id: crypto.randomUUID(),
          objectId,
          kind: 'create',
          objectType,
          patch,
          clock: { leaseId: lease.leaseId, elapsedMs: 0, uncertaintyMs: 0 },
        }),
      });
      if (!res.ok) throw new Error(await res.text());
      return res.json();
    };
    const favoriteId = crypto.randomUUID();
    const itemId = crypto.randomUUID();
    await post(
      'favorite',
      {
        name: '西湖断桥',
        address: '杭州西湖',
        lng: 120.15,
        lat: 30.27,
        provider: null,
        providerPlaceId: null,
        category: '景点',
        sourceUrl: '',
        fetchedAt: null,
        coordSystem: 'GCJ-02',
        mark: null,
      },
      favoriteId,
    );
    await post(
      'boardItem',
      {
        boardId: board.id,
        frame: { x: 120, y: 120, w: 352, h: 168, rotation: 0, scale: 1 },
        z: 1,
        content: { type: 'widget', kind: 'place', favoriteId },
        style: { size: 'M' },
      },
      itemId,
    );
    return { tripId, boardId: board.id, favoriteId, itemId };
  });
}

async function addActivity(page, title = '断桥残雪') {
  await page.getByRole('button', { name: '添加活动', exact: true }).first().click();
  await page.getByLabel('活动名称').fill(title);
  await page.getByRole('dialog').getByRole('button', { name: '完成', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.getByRole('heading', { name: title, exact: true })).toBeVisible();
}

test('board: basic sticker lifecycle (stick note, edit text, scale, delete, restore)', async ({
  page,
}) => {
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
  // The panel stays open so several stickers can be added in a row (问题 1).
  await expect(page.locator('#panel')).toBeVisible();
  await page.locator('#panel button[aria-label="关闭"]').click();
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

  // 7. Open Recent Deletions from the board menu and restore (问题 9)
  await page.locator('#top-left .switcher-button').click();
  await page.getByRole('menuitem', { name: /最近删除/ }).click();
  await expect(page.locator('#drawer')).toBeVisible();
  await expect(page.locator('#drawer .recent-row')).toContainText('买一把西湖绸伞');
  await page.locator('#drawer .restore-btn').click();
  await page.locator('#drawer button[aria-label="关闭"]').click();

  // 8. Note is restored
  await expect(page.locator('.board-item.item-note')).toBeVisible();
  await expect(page.locator('.board-item.item-note .note-text')).toContainText('买一把西湖绸伞');

  // 9. The server must accept the edit → delete → restore sequence (not just
  // the optimistic local UI). The queued operations may still be flushing.
  await expect
    .poll(async () => (await boardItems(page)).items.map((i) => i.state))
    .toEqual(['active']);
});

test('board: place widget schedules a real activity with the full place payload', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await register(page);
  await createTrip(page);
  const seeded = await seedPlaceWidget(page);

  await page.locator('nav button[aria-label="白板"]').first().click();
  await expect(page.locator('.board-container')).toBeVisible();
  const widget = page.locator('.board-item.item-widget').first();
  await expect(widget).toBeVisible();
  await widget.click();
  const schedule = page.locator('#actions button.primary:has-text("加入行程")');
  await expect(schedule).toBeVisible();
  await schedule.click();

  // The activity is created and the board item is linked on the server (the
  // two-step request must not leave a 422/INVALID_REFERENCE behind).
  await expect
    .poll(async () => {
      const state = await boardItems(page);
      return state.items.find((i) => i.id === seeded.itemId)?.payload?.linkedActivityId || null;
    })
    .not.toBeNull();
  const state = await boardItems(page);
  const activity = state.objects.find((o) => o.kind === 'activity');
  expect(activity).toBeTruthy();
  expect(activity.payload.title).toBe('西湖断桥');
  expect(activity.payload.place).toMatchObject({ name: '西湖断桥', lng: 120.15, lat: 30.27 });
  expect(activity.payload.place.mark).toBeUndefined();

  await page.locator('nav button[aria-label="行程"]').first().click();
  await expect(page.getByRole('heading', { name: '西湖断桥', exact: true })).toBeVisible();
});

test('board: widget integration with itinerary (activity pin, rename, gone state, revival)', async ({
  page,
}) => {
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
  await page.locator('#panel button[aria-label="关闭"]').click();

  const note = page.locator('.board-item.item-note');
  await expect(note).toBeVisible();

  // 4. Test bring to front / send to back
  await note.click();
  await page.locator('#actions button:has-text("置顶")').click();
  const noteZ = await note.evaluate((el) => parseInt(el.style.zIndex || '0', 10));
  const strokeZ = await page
    .locator('.board-item.item-stroke')
    .evaluate((el) => parseInt(el.style.zIndex || '0', 10));
  expect(noteZ).toBeGreaterThan(strokeZ);

  // 5. Select eraser tool and erase the stroke where it is visible (not covered by the note).
  // The eraser removes whole strokes only; stickers under the pointer are never erased.
  await page.locator('#toolbar button[data-tool="eraser"]').click();
  const strokeStart = await page
    .locator('.board-item.item-stroke path.stroke-paint')
    .evaluate((path) => {
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

  // Add three stickers without reopening the panel (问题 1 验收)
  await page.locator('#toolbar button[data-tool="sticker"]').click();
  await page.locator('#panel .gallery button:has-text("倒计时")').click();
  await page.locator('#panel .gallery button:has-text("当地时间")').click();
  await page.locator('#panel .tabs button:has-text("便签")').click();
  await page.locator('.pick-note').first().click();
  await expect(page.locator('#panel')).toBeVisible();
  await expect(page.locator('.board-item')).toHaveCount(3);
  await page.locator('#stage').click({ position: { x: 900, y: 600 } });
  await page.locator('#panel .tabs button:has-text("小组件")').click();

  const dir = '../.local/evidence/1111-白板界面';
  const shoot = async (name, { palette = 'forest', theme = 'light' } = {}) => {
    await page.evaluate(
      ([palette, theme]) => {
        document.documentElement.dataset.palette = palette;
        document.documentElement.dataset.theme = theme;
      },
      [palette, theme],
    );
    await page.waitForTimeout(250);
    await page.screenshot({ path: `${dir}/${name}.png`, fullPage: false });
  };

  // Panel open, docked left: visible border, background and selected states.
  await page.setViewportSize({ width: 1280, height: 800 });
  for (const palette of ['forest', 'atlas'])
    for (const theme of ['light', 'dark'])
      await shoot(`board-1280-${palette}-${theme}-panel`, { palette, theme });

  await page.locator('#panel button[aria-label="关闭"]').click();
  await shoot('board-1280-forest-light');
  await page.setViewportSize({ width: 1440, height: 900 });
  await shoot('board-1440-forest-light');
  await page.setViewportSize({ width: 390, height: 844 });
  await shoot('board-390-forest-light');
  await shoot('board-390-atlas-dark', { palette: 'atlas', theme: 'dark' });
  await page.locator('#toolbar button[data-tool="sticker"]').click();
  await shoot('board-390-forest-light-sheet');
});

async function openBoard(page) {
  await page.locator('nav button[aria-label="白板"]').first().click();
  await expect(page.locator('.board-container')).toBeVisible();
}

async function addFromPanel(page, tab, locator) {
  if (!(await page.locator('#panel').count()))
    await page.locator('#toolbar button[data-tool="sticker"]').click();
  await page.locator(`#panel .tabs button:has-text("${tab}")`).click();
  await page.locator(locator).first().click();
  await page.locator('#panel button[aria-label="关闭"]').click();
}

test('board: pen draft follows the pointer before release; text replaces placeholder', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await register(page);
  await createTrip(page);
  await openBoard(page);

  // 问题 3/8: the draft is visible while the button is still held.
  await page.locator('#toolbar button[data-tool="pen"]').click();
  const box = await page.locator('#stage').boundingBox();
  const x = box.x + 600;
  const y = box.y + 300;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + 25, y + 10);
  await page.mouse.move(x + 50, y + 20);
  await page.waitForTimeout(50);
  const draft = await page.locator('#draft path').evaluate((p) => {
    const r = p.getBoundingClientRect();
    return { left: r.left, top: r.top, width: r.width, right: r.right, bottom: r.bottom };
  });
  expect(draft.width).toBeGreaterThan(30);
  expect(draft.left).toBeGreaterThanOrEqual(0);
  expect(draft.right).toBeLessThanOrEqual(1280);
  expect(draft.top).toBeGreaterThanOrEqual(0);
  expect(draft.bottom).toBeLessThanOrEqual(800);
  await page.mouse.up();
  await expect(page.locator('#draft')).toHaveCount(0);
  await expect(page.locator('.board-item.item-stroke')).toHaveCount(1);

  // 问题 7: typing on a new text object yields exactly what was typed.
  await page.locator('#toolbar button[data-tool="text"]').click();
  await page.mouse.click(box.x + 500, box.y + 500);
  const text = page.locator('.board-item.item-text .text-inner');
  await expect(text).toBeFocused();
  await page.keyboard.type('你好');
  await page.keyboard.press('Escape');
  await expect
    .poll(async () =>
      (await boardItems(page)).items
        .filter((i) => i.payload.content.type === 'text')
        .map((i) => i.payload.content.text),
    )
    .toEqual(['你好']);
  // The frame grew with the text instead of staying 160×48.
  const textFrame = (await boardItems(page)).items.find((i) => i.payload.content.type === 'text')
    .payload.frame;
  expect(textFrame.w).toBeLessThan(160);
  // Regression: the first characters used to stack one per line inside the
  // initial 40px frame, so the label must come out wider than it is tall.
  const textBox = await page.locator('.board-item.item-text .text-inner').boundingBox();
  expect(textBox.width).toBeGreaterThan(textBox.height);

  // An empty text object is discarded, not left behind invisibly.
  await page.locator('#toolbar button[data-tool="text"]').click();
  await page.mouse.click(box.x + 800, box.y + 500);
  await expect(page.locator('.board-item.item-text .text-inner').last()).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(page.locator('.board-item.item-text')).toHaveCount(1);
});

test('board: shortcuts ignore other dialogs; release outside does not stick', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await register(page);
  await createTrip(page);
  await openBoard(page);
  await addFromPanel(page, '便签', '.pick-note');
  const note = page.locator('.board-item.item-note');
  await page.keyboard.press('Escape'); // finish editing the new note
  await note.click();
  await expect(page.locator('#actions')).toBeVisible();

  // N-3: Backspace / letters while another dialog is open do nothing to the board.
  await page.locator('.members-button').click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await page.keyboard.press('Backspace');
  await page.keyboard.press('p');
  await page.keyboard.press('Escape');
  await expect(note).toBeVisible();
  await expect(page.locator('#toolbar button[data-tool="pen"]')).toHaveAttribute(
    'aria-pressed',
    'false',
  );

  // 旧 P2-2: releasing over the toolbar ends the drag; the note no longer follows.
  const nb = await note.boundingBox();
  const tb = await page.locator('#toolbar').boundingBox();
  await page.mouse.move(nb.x + nb.width / 2, nb.y + nb.height / 2);
  await page.mouse.down();
  await page.mouse.move(nb.x + nb.width / 2 + 40, nb.y + nb.height / 2 + 40, { steps: 4 });
  await page.mouse.move(tb.x + 30, tb.y + tb.height / 2, { steps: 6 });
  await page.mouse.up();
  await page.waitForTimeout(50);
  const after = await note.boundingBox();
  await page.mouse.move(200, 200, { steps: 4 });
  await page.waitForTimeout(100);
  expect(await note.boundingBox()).toEqual(after);

  // Undo puts the note back where it was before the drag.
  await page.locator('#toolbar button[aria-label="撤销"]').click();
  await expect.poll(async () => (await note.boundingBox()).x).toBeCloseTo(nb.x, 0);
});

test('board: dragging a widget edge switches its form and keeps its scale', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await register(page);
  await createTrip(page);
  await openBoard(page);
  await page.locator('#toolbar button[data-tool="sticker"]').click();
  await page.locator('#panel .gallery button:has-text("当地时间")').click();
  await page.locator('#panel button[aria-label="关闭"]').click();
  const widget = page.locator('.board-item.item-widget');
  await widget.click();

  const handle = page.locator('.board-item.item-widget .handle.h-e');
  await expect(handle).toBeVisible();
  const hb = await handle.boundingBox();
  await page.mouse.move(hb.x + hb.width / 2, hb.y + hb.height / 2);
  await page.mouse.down();
  await page.mouse.move(hb.x + 220, hb.y + hb.height / 2, { steps: 8 });
  await expect(page.locator('.reshape-outline')).toBeVisible();
  await page.mouse.up();

  await expect.poll(async () => (await boardItems(page)).items[0].payload.style.size).toBe('M');
  const { frame } = (await boardItems(page)).items[0].payload;
  expect(frame.w).toBe(352);
  expect(frame.h).toBe(168);

  // Back to square by pulling the edge in again.
  await widget.click();
  const hb2 = await page.locator('.board-item.item-widget .handle.h-e').boundingBox();
  await page.mouse.move(hb2.x + hb2.width / 2, hb2.y + hb2.height / 2);
  await page.mouse.down();
  await page.mouse.move(hb2.x - 200, hb2.y + hb2.height / 2, { steps: 8 });
  await page.mouse.up();
  await expect.poll(async () => (await boardItems(page)).items[0].payload.style.size).toBe('S');
});

test('board: create, rename, switch and delete boards', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await register(page);
  await createTrip(page);
  await openBoard(page);
  const switcher = page.locator('#top-left .switcher-button');
  await expect(switcher).toContainText('主白板');

  await switcher.click();
  await page.getByRole('menuitem', { name: /新建白板/ }).click();
  const nameInput = page.locator('.rename-form input');
  await expect(nameInput).toBeFocused();
  await nameInput.fill('回忆墙');
  await page.locator('.rename-form button[type="submit"]').click();
  await expect(switcher).toContainText('回忆墙');

  await switcher.click();
  await page.getByRole('menuitemradio', { name: /主白板/ }).click();
  await expect(switcher).toContainText('主白板');

  await switcher.click();
  await page.getByRole('menuitemradio', { name: /回忆墙/ }).click();
  await expect(switcher).toContainText('回忆墙');
  await switcher.click();
  await page.getByRole('menuitem', { name: /删除当前白板/ }).click();
  await page.locator('.confirm-delete button.danger-fill').click();
  await expect(switcher).toContainText('主白板');
  await switcher.click();
  await expect(page.getByRole('menuitemradio')).toHaveCount(1);
  await expect(page.getByRole('menuitem', { name: /删除当前白板/ })).toBeDisabled();
});

test('board: sticker panel docks to the nearest edge and remembers it', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await register(page);
  await createTrip(page);
  await openBoard(page);
  await page.locator('#toolbar button[data-tool="sticker"]').click();
  const panel = page.locator('#panel');
  await expect(panel).toHaveClass(/dock-left/);

  const handle = page.locator('#panel .dock-handle');
  const hb = await handle.boundingBox();
  await page.mouse.move(hb.x + hb.width / 2, hb.y + hb.height / 2);
  await page.mouse.down();
  await page.mouse.move(950, 400, { steps: 4 });
  await expect(page.locator('.dock-target.right.on')).toBeVisible();
  await page.mouse.move(1000, 420, { steps: 4 });
  await page.mouse.up();
  await expect(panel).toHaveClass(/dock-right/);

  // A new sticker spawns in the visible part of the canvas, not under the panel.
  await page.locator('#panel .tabs button:has-text("表情")').click();
  await page.locator('.pick-emoji').first().click();
  const emoji = await page.locator('.board-item.item-emoji').boundingBox();
  const pb = await panel.boundingBox();
  expect(emoji.x + emoji.width).toBeLessThan(pb.x);

  // Keyboard: ↓ on the handle docks to the bottom.
  await handle.focus();
  await page.keyboard.press('ArrowDown');
  await expect(panel).toHaveClass(/dock-bottom/);

  // Saved to the account and restored after reload.
  await expect
    .poll(() =>
      page.evaluate(() =>
        fetch('/api/session')
          .then((r) => r.json())
          .then((s) => s.user?.preferences?.boardPanelDock),
      ),
    )
    .toBe('bottom');
  await page.reload();
  await page.getByRole('button', { name: /继续旅程/ }).click();
  await openBoard(page);
  await page.locator('#toolbar button[data-tool="sticker"]').click();
  await expect(page.locator('#panel')).toHaveClass(/dock-bottom/);
});

test('board: place widget draws AMap tiles and falls back to the sketch', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await register(page);
  await createTrip(page);
  await seedPlaceWidget(page);
  // No AMAP_WEB_KEY on the test server → tiles, not /v3/staticmap.
  const staticRequests = [];
  page.on('request', (r) => r.url().includes('/v3/staticmap') && staticRequests.push(r.url()));
  // Keep the test offline-safe: answer tile requests with a tiny PNG.
  const png = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
    'base64',
  );
  await page.route(/autonavi\.com\/appmaptile/, (route) =>
    route.fulfill({ status: 200, contentType: 'image/png', body: png }),
  );
  await openBoard(page);
  const tiles = page.locator('.w-place .map-tiles img');
  await expect(tiles.first()).toBeVisible();
  const src = await tiles.first().getAttribute('src');
  expect(src).toMatch(
    /webrd0[1-4]\.is\.autonavi\.com\/appmaptile\?.*style=8.*x=\d+&y=\d+&z=1[0-8]/,
  );
  expect(staticRequests).toEqual([]);

  // When tiles cannot load, the sketch comes back with a small notice.
  await page.unroute(/autonavi\.com\/appmaptile/);
  await page.route(/autonavi\.com\/appmaptile/, (route) => route.abort());
  await page.reload();
  await page.getByRole('button', { name: /继续旅程/ }).click();
  await openBoard(page);
  await expect(page.locator('.w-place .sketch-map')).toBeVisible();
  await expect(page.locator('.w-place .map-offline')).toBeVisible();
});

test('board: new strokes stay in place and presence does not report a lost connection', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await register(page);
  await createTrip(page);
  await openBoard(page);
  await page.locator('#toolbar button[data-tool="pen"]').click();
  const box = await page.locator('#stage').boundingBox();
  // Far from the origin, where scaling the item (old pop animation) moved it most.
  const x = box.x + 900;
  const y = box.y + 600;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + 30, y - 40, { steps: 4 });
  await page.mouse.move(x + 60, y, { steps: 4 });
  await page.mouse.up();
  const stroke = page.locator('.board-item.item-stroke');
  await expect(stroke).toHaveCount(1);
  const positions = [];
  for (let i = 0; i < 8; i++) {
    positions.push(await stroke.boundingBox());
    await page.waitForTimeout(40);
  }
  for (const p of positions) {
    expect(Math.abs(p.x - positions.at(-1).x)).toBeLessThan(1);
    expect(Math.abs(p.y - positions.at(-1).y)).toBeLessThan(1);
  }
  await expect(stroke).not.toHaveClass(/just-added/);

  // Presence heartbeats answer 204; they must not flip sync status to offline.
  await page.waitForTimeout(6000);
  await expect(page.locator('.sync-status')).not.toHaveClass(/offline/);
});

test('board: released drags and scales never flash back to the old frame', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await register(page);
  await createTrip(page);
  await openBoard(page);
  await page.locator('#toolbar button[data-tool="sticker"]').click();
  await page.locator('#panel .gallery button:has-text("当地时间")').click();
  await page.locator('#panel button[aria-label="关闭"]').click();
  const widget = page.locator('.board-item.item-widget');
  await widget.click();
  // Record every frame the widget's rect changes, through release and the
  // server round trip that follows.
  await page.evaluate(() => {
    const el = document.querySelector('.board-item.item-widget');
    window.__frames = [];
    const tick = () => {
      const r = el.getBoundingClientRect();
      window.__frames.push([Math.round(r.x), Math.round(r.width)]);
      if (window.__frames.length < 240) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
  const wb = await widget.boundingBox();
  await page.mouse.move(wb.x + wb.width / 2, wb.y + wb.height / 2);
  await page.mouse.down();
  await page.mouse.move(wb.x + wb.width / 2 + 160, wb.y + wb.height / 2, { steps: 10 });
  await page.mouse.up();
  const se = page.locator('.board-item.item-widget .handle.h-se');
  const hb = await se.boundingBox();
  await page.mouse.move(hb.x + hb.width / 2, hb.y + hb.height / 2);
  await page.mouse.down();
  await page.mouse.move(hb.x + hb.width / 2 + 60, hb.y + hb.height / 2 + 60, { steps: 10 });
  await page.mouse.up();
  await page.waitForFunction(() => window.__frames.length >= 240, null, { timeout: 15000 });
  const frames = await page.evaluate(() => window.__frames);
  // x only moves forward (drag right) and width only grows (scale up): any step
  // back is the flash this test guards against.
  for (let i = 1; i < frames.length; i++) {
    expect(frames[i][0]).toBeGreaterThanOrEqual(frames[i - 1][0] - 1);
    expect(frames[i][1]).toBeGreaterThanOrEqual(frames[i - 1][1] - 1);
  }
  // The action bar stays mounted and only fades while the gesture runs.
  await expect(page.locator('#actions')).toBeVisible();
  await expect(page.locator('#actions .seg')).toHaveCount(0);
});

test('board: sticker panel shows places up top and one day at a time', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await register(page);
  await createTrip(page);
  await seedPlaceWidget(page);
  await openBoard(page);
  await page.locator('#toolbar button[data-tool="sticker"]').click();
  const panel = page.locator('#panel');
  const groups = await panel
    .locator('.group-block > .group, .group-block > .group-head .group')
    .allInnerTexts();
  expect(groups.map((g) => g.replace(/\s*\d+$/, '').trim())).toEqual([
    '概览',
    '新建',
    '地点',
    '日程',
  ]);
  await expect(panel.locator('.tile-grid').first().locator('.tile')).toHaveCount(3);
  await expect(panel.locator('.create-tile')).toHaveCount(2);
  // The trip has 3 days: chips, not three rows of buttons.
  await expect(panel.locator('.day-chip')).toHaveCount(3);
  await expect(panel.locator('.day-chip[aria-selected="true"]')).toHaveCount(1);
  await panel.locator('.day-chip').nth(1).click();
  await expect(panel.locator('.day-title')).toContainText('第2天');
  await expect(panel.locator('.day-previews .tile')).toHaveCount(2);
});

// A real, decodable PNG so uploads exercise the whole pipeline (blank-image regression).
function png(w, h, [r, g, b]) {
  const chunk = (type, data) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(body));
    return Buffer.concat([len, body, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  const rows = [];
  for (let y = 0; y < h; y++) {
    const row = Buffer.alloc(1 + w * 3);
    for (let x = 0; x < w; x++) row.set([r, (g + x) & 255, (b + y) & 255], 1 + x * 3);
    rows.push(row);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(Buffer.concat(rows))),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}
const evidence = (name) => resolve(process.cwd(), '../.local/evidence/1111-白板界面', name);
const loaded = (img) => img.evaluate((el) => el.complete && el.naturalWidth > 0);

test('board: rich note formatting is saved and survives a reload', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await register(page);
  await createTrip(page);
  await openBoard(page);
  await addFromPanel(page, '便签', '.pick-note');
  const note = page.locator('.board-item.item-note').first();
  await note.dblclick();
  const bar = page.locator('#note-format');
  await expect(bar).toBeVisible();
  const text = note.locator('.note-text');
  await text.click();
  await page.keyboard.type('出发清单');
  await page.keyboard.press('ControlOrMeta+A');
  await bar.getByRole('button', { name: /粗体/ }).click();
  await bar.getByRole('button', { name: '居中' }).click();
  await bar.getByRole('button', { name: '大字' }).click();
  await expect(text.locator('b')).toContainText('出发清单');
  // macOS 浏览器里 End 不会把整段选区收起到行尾；向右一次即可把插入点
  // 放到选中文字之后，随后的换行和勾选清单接在它后面（不是替换整段）。
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('Enter');
  await bar.getByRole('button', { name: '勾选清单' }).click();
  await page.keyboard.type('护照');
  await page.screenshot({ path: evidence('rich-note.png') });
  await page.locator('#stage').click({ position: { x: 900, y: 600 } });
  await expect(bar).toHaveCount(0);
  await expect
    .poll(async () => {
      const n = (await boardItems(page)).items.find((i) => i.payload.content.type === 'note');
      return n && [n.payload.content.html, n.payload.style.fontSize];
    })
    .toEqual([expect.stringContaining('<b>'), 'l']);
  await page.reload();
  await page.getByRole('button', { name: /继续旅程/ }).click();
  await openBoard(page);
  await expect(page.locator('.board-item.item-note .note-text b').first()).toContainText(
    '出发清单',
  );
  await expect(page.locator('.board-item.item-note ul[data-list="check"] li')).toContainText(
    '护照',
  );
  await expect(page.locator('.board-item.item-note .note-card')).toHaveClass(/fs-l/);
});

test('board: dropped and pasted images actually show; styles apply', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await register(page);
  await createTrip(page);
  await openBoard(page);
  const dt = await page.evaluateHandle(
    (b64) => {
      const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
      const t = new DataTransfer();
      t.items.add(new File([bytes], 'drop.png', { type: 'image/png' }));
      return t;
    },
    png(64, 48, [200, 60, 40]).toString('base64'),
  );
  await page.dispatchEvent('#stage', 'dragover', { dataTransfer: dt, clientX: 600, clientY: 380 });
  await expect(page.locator('.drop-hint')).toBeVisible();
  await page.dispatchEvent('#stage', 'drop', { dataTransfer: dt, clientX: 600, clientY: 380 });
  const img = page.locator('.board-item.item-image img');
  await expect(img).toBeVisible();
  await expect.poll(() => loaded(img)).toBe(true);
  await expect(page.locator('.image-failed')).toHaveCount(0);

  await page.locator('.board-item.item-image').click();
  await page.locator('#actions').getByRole('button', { name: '样式' }).click();
  const pop = page.locator('.style-pop');
  await expect(pop).toBeVisible();
  const frames = [
    ['无边框', 'none'],
    ['拍立得', 'polaroid'],
    ['胶带', 'tape'],
    ['邮票', 'stamp'],
    ['圆形', 'circle'],
    ['卡片', 'card'],
    ['透明贴纸', 'sticker'],
  ];
  for (const [name, frame] of frames) {
    await pop.getByRole('button', { name, exact: true }).click();
    await expect(page.locator('.board-item.item-image .image-sticker')).toHaveClass(
      new RegExp(`frame-${frame}`),
    );
  }
  await pop.getByRole('button', { name: '邮票', exact: true }).click();
  await pop.getByRole('button', { name: /歪一点/ }).click();
  await expect(page.locator('.board-item.item-image')).toHaveClass(/tilted/);
  await page.screenshot({ path: evidence('image-frames.png') });
  await expect
    .poll(async () => {
      const it = (await boardItems(page)).items.find((i) => i.payload.content.type === 'image');
      return it && [it.payload.style.frameStyle, it.payload.style.tilt];
    })
    .toEqual(['stamp', -4]);
});

test('board: gallery holds several photos, switches ratio and pans a photo', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await register(page);
  await createTrip(page);
  await openBoard(page);
  await page.locator('#toolbar button[data-tool="sticker"]').click();
  const chooser = page.waitForEvent('filechooser');
  await page.locator('#panel').getByRole('button', { name: '添加图库' }).click();
  await (
    await chooser
  ).setFiles([
    { name: 'a.png', mimeType: 'image/png', buffer: png(80, 60, [30, 120, 200]) },
    { name: 'b.png', mimeType: 'image/png', buffer: png(60, 90, [220, 180, 40]) },
  ]);
  const gallery = page.locator('.board-item.item-gallery');
  await expect(gallery).toBeVisible();
  await expect(gallery.locator('.gallery-dots button')).toHaveCount(2);
  await expect.poll(() => loaded(gallery.locator('.gallery-window img'))).toBe(true);
  await gallery.hover();
  await gallery.getByRole('button', { name: '下一张' }).click();
  await expect(gallery.locator('.gallery-dots button').nth(1)).toHaveAttribute(
    'aria-current',
    'true',
  );

  await gallery.click();
  const actions = page.locator('#actions');
  await actions.getByRole('button', { name: '16:9' }).click();
  await expect
    .poll(async () => {
      const b = await gallery.boundingBox();
      return Math.round((b.width / b.height) * 10) / 10;
    })
    .toBe(1.8);
  await actions.getByRole('button', { name: /横竖/ }).click();
  await expect
    .poll(async () => {
      const b = await gallery.boundingBox();
      return b.width < b.height;
    })
    .toBe(true);

  // A 9:16 gallery is taller than the canvas: drag it up so its tools row is
  // on screen (the canvas is panned by gestures, not by page scrolling).
  const tall = await gallery.boundingBox();
  await page.mouse.move(tall.x + tall.width / 2, tall.y + 40);
  await page.mouse.down();
  await page.mouse.move(tall.x + tall.width / 2, tall.y + 40 - 120, { steps: 6 });
  await page.mouse.up();
  await actions.getByRole('button', { name: '调整显示' }).click();
  await expect(gallery.locator('.gallery-tools')).toBeVisible();
  await gallery.getByRole('button', { name: '放大' }).click();
  const win = await gallery.locator('.gallery-window').boundingBox();
  await page.mouse.move(win.x + win.width / 2, win.y + win.height / 2);
  await page.mouse.down();
  await page.mouse.move(win.x + win.width / 2 + 30, win.y + win.height / 2 + 20, { steps: 5 });
  await page.mouse.up();
  await page.screenshot({ path: evidence('gallery.png') });
  await gallery.getByRole('button', { name: '完成' }).click();
  await expect
    .poll(async () => {
      const it = (await boardItems(page)).items.find((i) => i.payload.content.type === 'gallery');
      return (
        it && [
          it.payload.style.ratio,
          it.payload.content.images.length,
          it.payload.content.images[1].crop?.zoom > 1,
        ]
      );
    })
    .toEqual(['9:16', 2, true]);

  // A sideways trackpad swipe always advances to the next photo and wraps:
  // the direction used to flip because the accumulator was read too late.
  const current = () =>
    page.evaluate(() =>
      [...document.querySelectorAll('.gallery-dots button')].findIndex(
        (d) => d.getAttribute('aria-current') === 'true',
      ),
    );
  const gb = await gallery.boundingBox();
  expect(await current()).toBe(1);
  for (const expected of [0, 1]) {
    await page.mouse.move(gb.x + gb.width / 2, gb.y + gb.height / 2);
    await page.mouse.wheel(100, 0);
    await expect.poll(current).toBe(expected);
    await page.waitForTimeout(400); // the swipe throttle takes 350ms
  }
});

test('board: todo list can be built, ticked without selecting, and reordered', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await register(page);
  await createTrip(page);
  await openBoard(page);
  await addFromPanel(page, '小组件', '#panel button[aria-label="添加待办"]');
  const todo = page.locator('.board-item.item-todo');
  await expect(todo).toBeVisible();
  const input = todo.locator('.todo-add input');
  await input.click();
  for (const t of ['带护照', '换些现金', '订接机']) {
    await input.fill(t);
    await input.press('Enter');
  }
  await input.press('Escape');
  await expect(todo.locator('.todo-row')).toHaveCount(3);
  await page.locator('#stage').click({ position: { x: 1000, y: 650 } });
  await todo.locator('.todo-check').first().click();
  await expect(todo.locator('.todo-check').first()).toHaveAttribute('aria-checked', 'true');
  await expect(todo.locator('.todo-count')).toContainText('1/3');
  await expect(page.locator('#actions')).toHaveCount(0);
  await page.screenshot({ path: evidence('todo.png') });
  await expect
    .poll(async () => {
      const it = (await boardItems(page)).items.find((i) => i.payload.content.type === 'todo');
      return it?.payload.content.items.map((x) => [x.text, x.done]);
    })
    .toEqual([
      ['带护照', true],
      ['换些现金', false],
      ['订接机', false],
    ]);
});

test('board: emoji search, recent emoji and my own stickers', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await register(page);
  await createTrip(page);
  await openBoard(page);
  await page.locator('#toolbar button[data-tool="sticker"]').click();
  const panel = page.locator('#panel');
  await panel.locator('.tabs button:has-text("表情")').click();
  await expect(panel.locator('.emoji-cats button').first()).toBeVisible();
  expect(await panel.locator('.emoji-cats button').count()).toBeGreaterThanOrEqual(10);
  await panel.getByLabel('搜索表情').fill('飞机');
  await expect(panel.locator('.pick-emoji', { hasText: '✈' }).first()).toBeVisible();
  // Category words and everyday synonyms find something instead of nothing.
  await panel.getByLabel('搜索表情').fill('美食');
  await expect(panel.locator('.pick-emoji').first()).toBeVisible();
  await panel.getByLabel('搜索表情').fill('开心');
  await expect(panel.locator('.pick-emoji', { hasText: '😀' }).first()).toBeVisible();
  await panel.getByLabel('搜索表情').fill('飞机');
  await panel.locator('.pick-emoji', { hasText: '✈' }).first().click();
  await expect(page.locator('.board-item.item-emoji')).toHaveCount(1);
  await panel.getByLabel('搜索表情').fill('');
  await expect(panel.getByRole('tab', { name: '最近' })).toBeVisible();

  const chooser = page.waitForEvent('filechooser');
  await panel.getByRole('button', { name: '上传自己的表情' }).click();
  await (
    await chooser
  ).setFiles({ name: 'me.png', mimeType: 'image/png', buffer: png(40, 40, [250, 120, 160]) });
  const mine = panel.locator('.my-sticker');
  await expect(mine).toHaveCount(1);
  await expect.poll(() => loaded(mine.locator('img'))).toBe(true);
  await mine.click();
  const placed = page.locator('.board-item.item-image .image-sticker.frame-sticker img');
  await expect(placed).toBeVisible();
  await expect.poll(() => loaded(placed)).toBe(true);
  await page.screenshot({ path: evidence('emoji-stickers.png') });

  // My stickers keep PNG (transparency) instead of being flattened into JPEG.
  const prefs = await page.evaluate(() => fetch('/api/session').then((r) => r.json()));
  expect((prefs.user || prefs).preferences.stickers).toHaveLength(1);
  expect((prefs.user || prefs).preferences.stickers[0].mime).toBe('image/png');

  // The library follows the account: another trip opened in this session sees
  // it without a reload.
  await page.locator('#panel button[aria-label="关闭"]').click();
  await page.locator('button.back-home').click();
  await page.getByRole('button', { name: '创建旅程', exact: true }).click();
  await page.getByLabel('旅程名称').fill('表情随账号走');
  await page.getByLabel('目的地', { exact: true }).fill('苏州');
  await page.getByLabel('出发日期', { exact: true }).fill('2026-12-05');
  await page.getByText('更多设置', { exact: true }).click();
  await page.getByLabel('旅程时区', { exact: true }).selectOption('Asia/Shanghai');
  await page.getByLabel('结束日期', { exact: true }).fill('2026-12-06');
  await page.getByRole('radio', { name: '平等团队', exact: true }).check();
  await page.getByRole('dialog').getByRole('button', { name: '创建旅程' }).click();
  await expect(page.locator('.itinerary-page')).toBeVisible();
  await openBoard(page);
  await page.locator('#toolbar button[data-tool="sticker"]').click();
  await page.locator('#panel .tabs button:has-text("表情")').click();
  await expect(page.locator('#panel .my-sticker')).toHaveCount(1);
});

test('board: places panel groups by mark and adds a whole group as one map', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await register(page);
  await createTrip(page);
  await seedPlaceWidget(page);
  await openBoard(page);
  await page.locator('#toolbar button[data-tool="sticker"]').click();
  const panel = page.locator('#panel');
  await expect(panel.locator('.mark-chip')).toHaveCount(1);
  await expect(panel.locator('.place-row')).toContainText('西湖断桥');
  await panel.getByRole('button', { name: /整类加入/ }).click();
  const map = page.locator('.board-item .widget-frame.w-places');
  await expect(map).toHaveCount(1);
  await expect(map).toBeVisible();
  await expect(map).toContainText('西湖断桥');
  await panel.getByLabel('搜索小组件').fill('断桥');
  await expect(panel.locator('.place-row')).toHaveCount(1);
  await page.screenshot({ path: evidence('places-group.png') });
});
