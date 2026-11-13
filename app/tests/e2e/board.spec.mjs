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

  // 5. One click selects (no menu); clicking again opens the menus
  await note.click();
  await page.waitForTimeout(400);
  await expect(page.locator('#actions')).toHaveCount(0);
  await page.waitForTimeout(300);
  await note.click();
  await expect(page.locator('#actions')).toBeVisible();
  await expect(page.locator('#arrange')).toBeVisible();

  // 6. Delete note from the arrange rail
  await page.locator('#arrange button[aria-label="删除"]').click();
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

  await openBoard(page);
  await expect(page.locator('.board-container')).toBeVisible();
  const widget = page.locator('.board-item.item-widget').first();
  await expect(widget).toBeVisible();
  await openActions(page, widget);
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
  await openBoard(page);
  await expect(actWidget.locator('.title')).toContainText('苏堤春晓漫步');

  // 5. Switch to itinerary, delete the activity
  await page.locator('nav button[aria-label="行程"]').first().click();
  const card2 = page.locator('article.activity-card:has-text("苏堤春晓漫步")');
  await card2.locator('summary[aria-label^="活动更多操作"]').click();
  await card2.locator('button:has-text("删除")').click();

  // 6. Switch to Whiteboard -> widget has gone state (gone-pill, is-gone)
  await openBoard(page);
  await expect(page.locator('.board-item.item-widget .widget-frame.is-gone')).toBeVisible();
  await expect(actWidget.locator('.gone-pill')).toContainText('已移除');

  // 7. Switch to itinerary, restore activity
  await page.locator('nav button[aria-label="旅程设置"]').first().click();
  await page.locator('button.settings-link:has-text("已删除的内容")').click();
  await page.locator('.modal button:has-text("恢复")').first().click();
  await page.locator('.modal button[aria-label="关闭"]').click();

  // 8. Switch to Whiteboard -> widget is revived!
  await openBoard(page);
  await expect(page.locator('.board-item.item-widget .widget-frame.is-gone')).toHaveCount(0);
  await expect(actWidget.locator('.title')).toContainText('苏堤春晓漫步');
});

test('board: freehand drawing with pen, unified z-order, and eraser', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await register(page);
  await createTrip(page);

  await openBoard(page);
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
  await openActions(page, note);
  await page.locator('#arrange button[aria-label="置于顶层"]').click();
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
  await openBoard(page);
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

// The board opens at a comfortable 80%; most tests measure in board units at
// 100%, so they switch to it with ⇧0 (the design-tool shortcut).
async function openBoardAtDefault(page) {
  await page.locator('nav button[aria-label="白板"]').first().click();
  await expect(page.locator('.board-container')).toBeVisible();
}
async function openBoard(page) {
  await openBoardAtDefault(page);
  await expect(page.locator('.board-container')).toHaveAttribute('data-loading', 'false');
  // The label is there even where the number is hidden (narrow screens).
  const zoom = page.locator('#zoom .zoom-value');
  const at100 = async () => /当前缩放 100%/.test((await zoom.getAttribute('aria-label')) || '');
  await expect
    .poll(async () => {
      await page.keyboard.press('Shift+Digit0');
      return at100();
    })
    .toBe(true);
  await page.waitForTimeout(300);
  expect(await at100()).toBe(true);
}

// The first click only selects; clicking the selection again opens its menus.
// Wait between the clicks so they are not a double click (which edits).
async function openActions(page, target) {
  await target.click();
  await page.waitForTimeout(650);
  await target.click();
  await expect(page.locator('#arrange')).toBeVisible();
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
  await openActions(page, note);

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
  // Menus come back after the gesture when asked for; no 小/中 switch.
  await openActions(page, widget);
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
  await expect(panel.locator('.create-tile')).toHaveCount(3);
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

  // Rotate with the handle above the selection (Shift: 15° steps).
  const image = page.locator('.board-item.item-image');
  await image.click();
  const rot = await image.locator('.handle.h-rot').boundingBox();
  const ib = await image.boundingBox();
  await page.mouse.move(rot.x + rot.width / 2, rot.y + rot.height / 2);
  await page.mouse.down();
  await page.keyboard.down('Shift');
  await page.mouse.move(ib.x + ib.width + 80, ib.y + ib.height / 2 - 40, { steps: 8 });
  await page.mouse.up();
  await page.keyboard.up('Shift');
  await expect(image).toHaveAttribute('style', /rotate\(/);
  await openActions(page, image);
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
  await page.screenshot({ path: evidence('image-frames.png') });
  await expect
    .poll(async () => {
      const it = (await boardItems(page)).items.find((i) => i.payload.content.type === 'image');
      const r = it?.payload.frame.rotation || 0;
      return it && [it.payload.style.frameStyle, r !== 0 && r % 15 === 0];
    })
    .toEqual(['stamp', true]);
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

  // Ratios come from the edges: drag the right edge and the photo window
  // snaps to 1:2 · 9:16 · 3:4 · 1:1 · 4:3 · 16:9 · 2:1.
  await gallery.click();
  const dragEdge = async (dx) => {
    const e = await gallery.locator('.handle.h-e').boundingBox();
    await page.mouse.move(e.x + e.width / 2, e.y + e.height / 2);
    await page.mouse.down();
    await page.mouse.move(e.x + e.width / 2 + dx, e.y + e.height / 2, { steps: 8 });
    await expect(gallery.locator('.dim')).toBeVisible();
    await page.mouse.up();
  };
  const aspect = async () => {
    const b = await gallery.boundingBox();
    return Math.round((b.width / b.height) * 10) / 10;
  };
  await dragEdge(120);
  await expect.poll(aspect).toBe(1.8);
  const now = await gallery.boundingBox();
  await dragEdge(-(now.width - 150));
  await expect.poll(aspect).toBe(0.6);
  const actions = page.locator('#actions');

  // A 9:16 gallery is taller than the canvas: drag it up so its tools row is
  // on screen (the canvas is panned by gestures, not by page scrolling).
  const tall = await gallery.boundingBox();
  await page.mouse.move(tall.x + tall.width / 2, tall.y + 40);
  await page.mouse.down();
  await page.mouse.move(tall.x + tall.width / 2, tall.y + 40 - 120, { steps: 6 });
  await page.mouse.up();
  await openActions(page, gallery);
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
  // A preset makes a category; the seeded place has no mark (未分类).
  await page.evaluate(async () => {
    const list = await fetch('/api/trips').then((r) => r.json());
    const tripId = list.trips[0].id;
    const session = await fetch('/api/session').then((r) => r.json());
    const headers = { 'Content-Type': 'application/json', 'X-CSRF-Token': session.csrfToken };
    const lease = await fetch('/api/clock', {
      method: 'POST',
      headers,
      body: JSON.stringify({ deviceId: crypto.randomUUID() }),
    }).then((r) => r.json());
    const post = async (objectType, patch) => {
      const res = await fetch(`/api/trips/${tripId}/operations`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          id: crypto.randomUUID(),
          objectId: crypto.randomUUID(),
          kind: 'create',
          objectType,
          patch,
          clock: { leaseId: lease.leaseId, elapsedMs: 0, uncertaintyMs: 0 },
        }),
      });
      if (!res.ok) throw new Error(await res.text());
    };
    await post('markPreset', { name: '公园', icon: 'flag', color: 'graphite', order: 0 });
    for (const [name, lng] of [
      ['太子湾公园', 120.149],
      ['柳浪闻莺', 120.158],
    ])
      await post('favorite', {
        name,
        address: '杭州',
        lng,
        lat: 30.24,
        provider: null,
        providerPlaceId: null,
        category: '公园',
        sourceUrl: '',
        fetchedAt: null,
        coordSystem: 'GCJ-02',
        mark: { icon: 'flag', color: 'graphite' },
      });
  });
  await openBoard(page);
  await page.locator('#toolbar button[data-tool="sticker"]').click();
  const panel = page.locator('#panel');
  await expect(panel.locator('.mark-chip')).toHaveCount(2);
  await expect(panel.locator('.mark-chip').first()).toContainText('公园');
  await expect(panel.locator('.mark-chip').last()).toContainText('未分类');
  await panel.getByRole('button', { name: /整类加入/ }).click();
  const map = page.locator('.board-item .widget-frame.w-places');
  await expect(map).toHaveCount(1);
  await expect(map).toBeVisible();
  await expect(map).toContainText('太子湾公园');
  await expect(map).not.toContainText('西湖断桥');
  // 未分类 is a list only: places without a preset are not one category.
  await panel.locator('.mark-chip').last().click();
  await expect(panel.locator('.place-row')).toContainText('西湖断桥');
  await expect(panel.getByRole('button', { name: /整类加入/ })).toHaveCount(0);
  await expect(panel.locator('.unsorted-hint')).toBeVisible();
  await panel.getByLabel('搜索小组件').fill('断桥');
  await expect(panel.locator('.place-row')).toHaveCount(1);
  await page.screenshot({ path: evidence('places-group.png') });
});

// ---------- Third pass: selection, box select, sections, drag-out, uploads ----------

async function noteAt(page, x, y, text) {
  await page.mouse.click(x, y, { button: 'right' });
  await page.getByRole('menuitem', { name: '在这里贴便签' }).click();
  const note = page.locator('.board-item.item-note.editing');
  await expect(note).toBeVisible();
  await page.keyboard.type(text);
  await page.keyboard.press('Escape');
  return page.locator('.board-item.item-note', { hasText: text });
}

test('board: right-click menus, box select, group move, align and sections', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await register(page);
  await createTrip(page);
  await openBoard(page);
  const a = await noteAt(page, 420, 300, '甲');
  const b = await noteAt(page, 760, 420, '乙');
  await expect(page.locator('.board-item.item-note')).toHaveCount(2);

  // Right-click an object: its menu at the pointer, with shortcuts.
  await a.click({ button: 'right' });
  const menu = page.locator('.context-menu');
  await expect(menu).toBeVisible();
  await expect(menu.getByRole('menuitem', { name: /复制一份/ })).toContainText('⌘D');
  await page.keyboard.press('Escape');
  await expect(menu).toHaveCount(0);

  // 框选 tool: drag a box over both notes.
  await page.locator('#toolbar button[data-tool="marquee"]').click();
  await page.mouse.move(300, 200);
  await page.mouse.down();
  await page.mouse.move(1050, 700, { steps: 10 });
  await page.mouse.up();
  await expect(page.locator('.group-box')).toBeVisible();
  await expect(page.locator('.group-box .count')).toContainText('已选 2 项');
  // Back to the select tool so the selection can be moved.
  await expect(page.locator('#toolbar button[data-tool="select"]')).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await page.screenshot({ path: evidence('3-marquee.png') });

  // Moving one moves both.
  const before = await boardItems(page);
  const ab = await a.boundingBox();
  await page.mouse.move(ab.x + ab.width / 2, ab.y + 40);
  await page.mouse.down();
  await page.mouse.move(ab.x + ab.width / 2 + 60, ab.y + 40 + 30, { steps: 8 });
  await page.mouse.up();
  await expect
    .poll(async () => {
      const after = await boardItems(page);
      return after.items.every((it) => {
        const old = before.items.find((x) => x.id === it.id);
        return Math.round(it.payload.frame.x - old.payload.frame.x) === 60;
      });
    })
    .toBe(true);

  // Align left from the right-click menu.
  await a.click({ button: 'right' });
  await page.getByRole('menuitem', { name: '对齐' }).click();
  await page.getByRole('menuitem', { name: '左对齐' }).click();
  await expect
    .poll(async () => new Set((await boardItems(page)).items.map((i) => i.payload.frame.x)).size)
    .toBe(1);

  // 框进分区: a section appears behind them; moving its title moves them too.
  await a.click({ button: 'right' });
  await page.getByRole('menuitem', { name: '框进分区' }).click();
  const section = page.locator('.board-item.item-section');
  await expect(section).toBeVisible();
  // 框进分区 opens the title for editing; wait for its input before typing.
  await expect(page.getByLabel('分区名称')).toBeFocused();
  await page.keyboard.type('第1天');
  await page.keyboard.press('Enter');
  await expect(section.locator('.section-title')).toContainText('第1天');
  const title = await section.locator('.section-title').boundingBox();
  const snap = await boardItems(page);
  await page.mouse.move(title.x + title.width / 2, title.y + title.height / 2);
  await page.mouse.down();
  await page.mouse.move(title.x + title.width / 2 + 80, title.y + title.height / 2, { steps: 8 });
  await page.mouse.up();
  await expect
    .poll(async () => {
      const after = await boardItems(page);
      return after.items.map((it) => {
        const old = snap.items.find((x) => x.id === it.id);
        return Math.round(it.payload.frame.x - old.payload.frame.x);
      });
    })
    .toEqual([80, 80, 80]);
  await page.screenshot({ path: evidence('3-section.png') });

  // Clicking inside the section (not on its title, border or resize handles)
  // pans the canvas and drops the section selection.
  const sb = await section.boundingBox();
  await page.mouse.click(sb.x + 30, sb.y + sb.height - 30);
  await expect(page.locator('.group-box')).toHaveCount(0);
  await expect(section.locator('.box')).toHaveCount(0);
});

test('board: dragging out of the panel places the real object; back onto the panel cancels', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await register(page);
  await createTrip(page);
  await openBoard(page);
  await page.locator('#toolbar button[data-tool="sticker"]').click();
  await page.locator('#panel .tabs button:has-text("便签")').click();
  const tile = page.locator('.pick-note').first();
  const tb = await tile.boundingBox();
  const drag = async (toX, toY, back) => {
    await page.mouse.move(tb.x + tb.width / 2, tb.y + tb.height / 2);
    await page.mouse.down();
    await page.mouse.move(toX, toY, { steps: 12 });
    await expect(page.locator('.board-item.is-preview.item-note')).toBeVisible();
    await expect(page.locator('#panel')).toHaveClass(/dragging-out/);
    if (back) {
      await page.mouse.move(tb.x + tb.width / 2, tb.y + tb.height / 2 + 30, { steps: 12 });
      await expect(page.locator('.board-item.is-preview')).toHaveCount(0);
      await expect(page.locator('#panel .drag-back-hint')).toContainText('松手取消');
    }
    await page.mouse.up();
  };
  await drag(900, 400, true);
  await expect(page.locator('.board-item.item-note')).toHaveCount(0);
  await drag(900, 400, false);
  await expect(page.locator('.board-item.item-note:not(.is-preview)')).toHaveCount(1);
  const nb = await page.locator('.board-item.item-note').boundingBox();
  expect(Math.abs(nb.x + nb.width / 2 - 900)).toBeLessThan(4);
  expect(Math.abs(nb.y + nb.height / 2 - 400)).toBeLessThan(4);
});

test('board: text boxes fit their text and wrap from the side handles', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await register(page);
  await createTrip(page);
  await openBoard(page);
  await page.locator('#toolbar button[data-tool="text"]').click();
  await page.mouse.click(400, 400);
  // Item creation round-trips, so the editor may take a moment to focus; typing
  // before that would go nowhere (and an empty text box is discarded).
  await expect(page.locator('.board-item.item-text .text-inner')).toBeFocused();
  await page.keyboard.type('一段比较长的说明文字用来测试换行');
  await page.keyboard.press('Escape');
  const text = page.locator('.board-item.item-text');
  const inner = text.locator('.text-sticker');
  await text.click();
  const box = await text.locator('.box').boundingBox();
  const tb = await inner.boundingBox();
  // The selection matches what is on screen (问题: 框格与文字不符).
  expect(Math.abs(box.width - tb.width)).toBeLessThan(3);
  expect(Math.abs(box.height - tb.height)).toBeLessThan(3);
  // Narrow it from the right handle: it wraps onto more lines and stays fitted.
  const e = await text.locator('.handle.h-e').boundingBox();
  await page.mouse.move(e.x + e.width / 2, e.y + e.height / 2);
  await page.mouse.down();
  await page.mouse.move(e.x + e.width / 2 - tb.width / 2, e.y + e.height / 2, { steps: 8 });
  await page.mouse.up();
  const wrapped = await inner.boundingBox();
  expect(wrapped.height).toBeGreaterThan(tb.height * 1.6);
  // The laid-out height is measured one frame later and the selection follows.
  await expect
    .poll(async () => {
      const b = await text.locator('.box').boundingBox();
      const w = await inner.boundingBox();
      return Math.abs(b.height - w.height);
    })
    .toBeLessThan(3);
  await expect
    .poll(async () => {
      const it = (await boardItems(page)).items.find((i) => i.payload.content.type === 'text');
      return it?.payload.style.autoWidth;
    })
    .toBe(false);
  await page.screenshot({ path: evidence('3-text-wrap.png') });
});

test('board: a released pen stroke stays exactly where it was drawn', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await register(page);
  await createTrip(page);
  await openBoard(page);
  // Not at 100%: the shift showed at other zoom levels.
  await page.locator('#zoom button[aria-label="缩小"]').click();
  await page.locator('#zoom button[aria-label="缩小"]').click();
  await page.locator('#toolbar button[data-tool="pen"]').click();
  await page.mouse.move(500, 300);
  await page.mouse.down();
  for (let i = 1; i <= 40; i++)
    await page.mouse.move(500 + i * 6.3, 300 + Math.sin(i / 4) * 60 + i * 1.7);
  const draft = await page.evaluate(() => {
    const r = document.querySelector('#draft path').getBoundingClientRect();
    return [r.x, r.y, r.width, r.height];
  });
  await page.mouse.up();
  const saved = await page.evaluate(() => {
    const r = document
      .querySelector('.board-item.item-stroke .stroke-paint')
      .getBoundingClientRect();
    return [r.x, r.y, r.width, r.height];
  });
  for (let i = 0; i < 4; i++) expect(Math.abs(saved[i] - draft[i])).toBeLessThan(0.75);
});

test('board: big pictures are compressed, the toolbar uploads, and pictures can be saved as my stickers', async ({
  page,
}) => {
  test.setTimeout(120000);
  await page.setViewportSize({ width: 1280, height: 800 });
  await register(page);
  await createTrip(page);
  await openBoard(page);
  // A noisy 2400×1800 PNG is far over the 1.5MB limit before compression.
  const big = Buffer.alloc(2400 * 1800 * 3);
  for (let i = 0; i < big.length; i++) big[i] = (i * 2654435761) >>> 24;
  const noisy = (() => {
    const w = 2400;
    const h = 1800;
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
    for (let y = 0; y < h; y++)
      rows.push(Buffer.concat([Buffer.from([0]), big.subarray(y * w * 3, (y + 1) * w * 3)]));
    return Buffer.concat([
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      chunk('IHDR', ihdr),
      chunk('IDAT', deflateSync(Buffer.concat(rows), { level: 1 })),
      chunk('IEND', Buffer.alloc(0)),
    ]);
  })();
  expect(noisy.length).toBeGreaterThan(2 * 1024 * 1024);
  const chooser = page.waitForEvent('filechooser');
  await page.locator('#toolbar button[data-tool="image"]').click();
  await (await chooser).setFiles({ name: 'noise.png', mimeType: 'image/png', buffer: noisy });
  const img = page.locator('.board-item.item-image img');
  await expect(img).toBeVisible({ timeout: 60000 });
  await expect.poll(() => loaded(img)).toBe(true);
  await expect(page.locator('.upload-placeholder.failed')).toHaveCount(0);

  // Save it into my stickers from its menu.
  await openActions(page, page.locator('.board-item.item-image'));
  await page.locator('#actions').getByRole('button', { name: '收藏到我的表情' }).click();
  await expect
    .poll(async () => {
      const s = await page.evaluate(() => fetch('/api/session').then((r) => r.json()));
      return (s.user || s).preferences.stickers?.length || 0;
    })
    .toBe(1);
});

test('board: countdown, clock and expense widgets have looks', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await register(page);
  await createTrip(page);
  await openBoard(page);
  await page.locator('#toolbar button[data-tool="sticker"]').click();
  await page.locator('#panel .gallery button:has-text("倒计时")').click();
  await page.locator('#panel button[aria-label="关闭"]').click();
  const w = page.locator('.board-item.item-widget');
  await openActions(page, w);
  await page.locator('#actions').getByRole('button', { name: '样式' }).click();
  for (const [name, cls] of [
    ['翻页', 'v-flip'],
    ['日历', 'v-calendar'],
    ['圆环', 'v-ring'],
  ]) {
    await page.locator('.style-pop').getByRole('button', { name, exact: true }).click();
    await expect(w.locator('.w.w-count')).toHaveClass(new RegExp(cls));
  }
  await page.screenshot({ path: evidence('3-widget-looks.png') });
});

// ---------- 第三轮追修 ----------

test('board: panel drags never get stuck (back and forth, Escape, release on the panel)', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await register(page);
  await createTrip(page);
  await openBoard(page);
  await page.locator('#toolbar button[data-tool="sticker"]').click();
  const panel = page.locator('#panel');
  const tile = panel.locator('.gallery button:has-text("当地时间")');
  const tb = await tile.boundingBox();
  const home = { x: tb.x + tb.width / 2, y: tb.y + tb.height / 2 };
  const preview = page.locator('.board-item.is-preview');
  const settled = async () => {
    await expect(preview).toHaveCount(0);
    await expect(panel).not.toHaveClass(/dragging-out|drop-back/);
    await expect(panel.locator('.drag-back-hint')).toHaveCount(0);
  };

  // Out, back, out, back, out — then let go on the board: exactly one clock.
  await page.mouse.move(home.x, home.y);
  await page.mouse.down();
  for (let i = 0; i < 2; i++) {
    await page.mouse.move(900, 420, { steps: 10 });
    await expect(preview).toBeVisible();
    await page.mouse.move(home.x, home.y + 40, { steps: 10 });
    await expect(preview).toHaveCount(0);
  }
  await page.mouse.move(900, 420, { steps: 10 });
  await page.mouse.up();
  await settled();
  await expect(page.locator('.board-item.item-widget')).toHaveCount(1);

  // Back onto the panel and let go: nothing is added, nothing stays behind.
  await page.mouse.move(home.x, home.y);
  await page.mouse.down();
  await page.mouse.move(900, 300, { steps: 10 });
  await page.mouse.move(home.x, home.y + 40, { steps: 10 });
  await page.mouse.up();
  await settled();
  await expect(page.locator('.board-item.item-widget')).toHaveCount(1);

  // Escape cancels a drag in progress.
  await page.mouse.move(home.x, home.y);
  await page.mouse.down();
  await page.mouse.move(800, 500, { steps: 10 });
  await expect(preview).toBeVisible();
  await page.keyboard.press('Escape');
  await settled();
  await page.mouse.up();
  await expect(page.locator('.board-item.item-widget')).toHaveCount(1);
});

test('board: menus never cover each other; rail buttons are named on hover', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await register(page);
  await createTrip(page);
  await openBoard(page);
  await page.locator('#toolbar button[data-tool="sticker"]').click();
  await page.locator('#panel .gallery button:has-text("倒计时")').click();
  await page.locator('#panel button[aria-label="关闭"]').click();
  // Move it close to the top-left corner, where the bar has to go below it.
  const w = page.locator('.board-item.item-widget');
  const wb = await w.boundingBox();
  await page.mouse.move(wb.x + wb.width / 2, wb.y + wb.height / 2);
  await page.mouse.down();
  await page.mouse.move(260, 170, { steps: 10 });
  await page.mouse.up();
  await openActions(page, w);
  await page.locator('#actions').getByRole('button', { name: '样式' }).click();
  await expect(page.locator('.style-pop')).toBeVisible();
  const boxes = await page.evaluate(() =>
    ['#actions', '.style-pop', '#arrange']
      .map((sel) => document.querySelector(sel))
      .filter((el) => el && getComputedStyle(el).opacity !== '0')
      .map((el) => el.getBoundingClientRect().toJSON()),
  );
  const overlap = (a, b) =>
    a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;
  for (let i = 0; i < boxes.length; i++)
    for (let j = i + 1; j < boxes.length; j++) expect(overlap(boxes[i], boxes[j])).toBe(false);
  await page.screenshot({ path: evidence('3b-menus-no-overlap.png') });

  // The rail's icons are distinct and named on hover.
  await page.locator('.style-pop').getByRole('button', { name: '翻页', exact: true }).click();
  await page.locator('#arrange button[aria-label="置于顶层"]').hover();
  await expect(page.locator('.act-tip')).toContainText('置于顶层');
  await page.locator('#arrange button[aria-label="复制一份"]').hover();
  await expect(page.locator('.act-tip')).toContainText('复制一份');
  await expect(page.locator('.act-tip')).toContainText('⌘D');
  await page.screenshot({ path: evidence('3b-rail-tip.png') });
});

test('board: snapping can be switched off and is remembered', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await register(page);
  await createTrip(page);
  await openBoard(page);
  const toggle = page.locator('#zoom .snap-toggle');
  await expect(toggle).toHaveAttribute('aria-pressed', 'true');
  await toggle.click();
  await expect(toggle).toHaveAttribute('aria-pressed', 'false');
  await page.reload();
  await page.getByRole('button', { name: /继续旅程/ }).click();
  await openBoard(page);
  await expect(page.locator('#zoom .snap-toggle')).toHaveAttribute('aria-pressed', 'false');
});

test('board: my stickers can be removed from the emoji page with a right-click', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await register(page);
  await createTrip(page);
  await openBoard(page);
  await page.locator('#toolbar button[data-tool="sticker"]').click();
  const panel = page.locator('#panel');
  await panel.locator('.tabs button:has-text("表情")').click();
  const chooser = page.waitForEvent('filechooser');
  await panel.getByRole('button', { name: '上传自己的表情' }).click();
  await (
    await chooser
  ).setFiles({ name: 'me.png', mimeType: 'image/png', buffer: png(40, 40, [90, 160, 250]) });
  const mine = panel.locator('.my-sticker');
  await expect(mine).toHaveCount(1);
  await mine.click({ button: 'right' });
  const menu = page.getByRole('menu', { name: '我的表情' });
  await expect(menu).toBeVisible();
  await menu.getByRole('menuitem', { name: '取消收藏' }).click();
  await expect(mine).toHaveCount(0);
  await expect
    .poll(async () => {
      const s = await page.evaluate(() => fetch('/api/session').then((r) => r.json()));
      return (s.user || s).preferences.stickers?.length || 0;
    })
    .toBe(0);
});

test('board: gallery adjusting controls stay readable when zoomed out', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await register(page);
  await createTrip(page);
  await openBoard(page);
  await page.locator('#toolbar button[data-tool="sticker"]').click();
  const chooser = page.waitForEvent('filechooser');
  await page.locator('#panel').getByRole('button', { name: '添加图库' }).click();
  await (
    await chooser
  ).setFiles([{ name: 'a.png', mimeType: 'image/png', buffer: png(80, 60, [30, 120, 200]) }]);
  await page.locator('#panel button[aria-label="关闭"]').click();
  for (let i = 0; i < 3; i++) await page.locator('#zoom button[aria-label="缩小"]').click();
  const gallery = page.locator('.board-item.item-gallery');
  await gallery.dblclick();
  const done = gallery.locator('.gallery-tools button', { hasText: '完成' });
  await expect(done).toBeVisible();
  const b = await done.boundingBox();
  expect(b.height).toBeGreaterThanOrEqual(34);
  const fs = await done.evaluate((el) => {
    const r = el.getBoundingClientRect();
    return parseFloat(getComputedStyle(el).fontSize) * (r.height / el.offsetHeight);
  });
  expect(fs).toBeGreaterThanOrEqual(13);
  await page.screenshot({ path: evidence('3b-gallery-tools-zoomed-out.png') });
});

// ---------- 第三轮追修 2 ----------

test('board: opens at 80%; text keeps its on-screen size when zoomed out; tool names on hover', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await register(page);
  await createTrip(page);
  await openBoardAtDefault(page);
  await expect(page.locator('#zoom .zoom-value')).toHaveText('80%');

  // Zoomed out, new text is bigger on the board so it reads the same on screen.
  for (let i = 0; i < 3; i++) await page.locator('#zoom button[aria-label="缩小"]').click();
  const k = parseInt(await page.locator('#zoom .zoom-value').innerText(), 10) / 100;
  await page.locator('#toolbar button[data-tool="text"]').click();
  await page.mouse.click(640, 400);
  await expect(page.locator('.board-item.item-text.editing')).toBeVisible();
  await page.keyboard.type('看得清');
  await page.keyboard.press('Escape');
  await expect
    .poll(async () => {
      const it = (await boardItems(page)).items.find((i) => i.payload.content.type === 'text');
      return it && Math.abs(it.payload.frame.scale - 1 / k) < 0.02;
    })
    .toBe(true);

  // Toolbar buttons are named on hover, with their key.
  await page.locator('#toolbar button[data-tool="pen"]').hover();
  await expect(page.locator('.tool-tip')).toContainText('画笔');
  await expect(page.locator('.tool-tip kbd')).toHaveText('P');
  await page.locator('#toolbar button[data-tool="image"]').hover();
  await expect(page.locator('.tool-tip')).toContainText('上传图片');
  await page.locator('#zoom .snap-toggle').hover();
  const snapTipPos = await page.locator('#zoom .snap-toggle').evaluate((el) => {
    const s = getComputedStyle(el, '::after');
    return { right: s.right, left: parseFloat(s.left), btnRight: el.getBoundingClientRect().right };
  });
  expect(snapTipPos.right).toBe('0px');
  expect(snapTipPos.left).toBeLessThan(0);
  expect(snapTipPos.btnRight).toBeLessThanOrEqual(1280);
  await page.screenshot({ path: evidence('3c-tips.png') });
});

test('board: typing on a selected note edits it; right-click menu has one highlight', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await register(page);
  await createTrip(page);
  await openBoard(page);
  await addFromPanel(page, '便签', '.pick-note');
  const note = page.locator('.board-item.item-note');
  await page.keyboard.type('第一行');
  await page.keyboard.press('Escape');
  await expect(note.locator('.note-text')).toContainText('第一行');
  await page.keyboard.press('Shift+Digit1');
  await expect(page.locator('#zoom .zoom-value')).toHaveText('80%');
  await page.keyboard.press('Shift+Digit0');
  await expect(page.locator('#zoom .zoom-value')).toHaveText('100%');
  await page.locator('#stage').click({ position: { x: 1000, y: 650 } });

  // One click selects; typing goes straight into the note (added at the end).
  await note.click();
  await page.waitForTimeout(150);
  await page.keyboard.type('xyz');
  await expect(note).toHaveClass(/editing/);
  await expect(note.locator('.note-text')).toContainText('第一行xyz');
  await page.keyboard.press('Escape');
  await expect
    .poll(async () => {
      const it = (await boardItems(page)).items.find((i) => i.payload.content.type === 'note');
      return it?.payload.content.text;
    })
    .toContain('第一行xyz');
  // Enter also opens it; Backspace on a selected (not editing) note still deletes it.
  await page.locator('#stage').click({ position: { x: 1000, y: 650 } });
  await note.click();
  await page.waitForTimeout(150);
  await page.keyboard.press('Enter');
  await expect(note).toHaveClass(/editing/);
  await page.keyboard.press('Escape');

  // Right-click menu: nothing pre-selected; the hovered item is the only highlight.
  await note.click({ button: 'right' });
  const menu = page.locator('.context-menu');
  await expect(menu).toBeVisible();
  expect(await page.evaluate(() => document.activeElement?.getAttribute('role'))).toBe('menu');
  const second = menu.getByRole('menuitem').nth(1);
  await second.hover();
  await expect(second).toBeFocused();
  const highlighted = await menu.getByRole('menuitem').evaluateAll(
    (els) =>
      els.filter((el) => {
        const bg = getComputedStyle(el).backgroundColor;
        return bg && !/rgba\(0, 0, 0, 0\)|transparent/.test(bg);
      }).length,
  );
  expect(highlighted).toBe(1);
  await page.keyboard.press('ArrowDown');
  const highlightedAfterKey = await menu.getByRole('menuitem').evaluateAll(
    (els) =>
      els.filter((el) => {
        const bg = getComputedStyle(el).backgroundColor;
        return bg && !/rgba\(0, 0, 0, 0\)|transparent/.test(bg);
      }).length,
  );
  expect(highlightedAfterKey).toBe(1);
  await page.screenshot({ path: evidence('3c-context-one-highlight.png') });
  await page.keyboard.press('Escape');

  await note.click();
  await page.waitForTimeout(150);
  await page.keyboard.press('Backspace');
  await expect(note).toHaveCount(0);
});

test('board: export the board as one PNG with a margin', async ({ page }) => {
  test.setTimeout(90000);
  await page.setViewportSize({ width: 1280, height: 800 });
  await register(page);
  await createTrip(page);
  await openBoard(page);
  await addFromPanel(page, '便签', '.pick-note');
  await page.keyboard.type('导出我');
  await page.keyboard.press('Escape');
  await addFromPanel(page, '小组件', '#panel .gallery button:has-text("当地时间")');
  // Push one object far away: the picture covers everything, not just the view.
  const w = page.locator('.board-item.item-widget');
  const wb = await w.boundingBox();
  await page.mouse.move(wb.x + wb.width / 2, wb.y + wb.height / 2);
  await page.mouse.down();
  await page.mouse.move(1200, 760, { steps: 10 });
  await page.mouse.up();

  await page.mouse.click(200, 650, { button: 'right' });
  const download = page.waitForEvent('download');
  await page.getByRole('menuitem', { name: '导出为图片' }).click();
  const file = await download;
  expect(file.suggestedFilename()).toMatch(/\.png$/);
  const path = await file.path();
  const { readFileSync } = await import('node:fs');
  const buf = readFileSync(path);
  expect(buf.subarray(1, 4).toString()).toBe('PNG');
  const width = buf.readUInt32BE(16);
  const height = buf.readUInt32BE(20);
  // Both objects plus a 64px margin on each side (×2 for sharpness).
  const items = (await boardItems(page)).items.map((i) => i.payload.frame);
  const minX = Math.min(...items.map((f) => f.x));
  const maxX = Math.max(...items.map((f) => f.x + f.w));
  expect(width).toBeGreaterThanOrEqual(Math.floor((maxX - minX + 128) * 1.5));
  expect(height).toBeGreaterThan(200);
  await expect(page.locator('.export-busy')).toHaveCount(0);
  const { copyFileSync } = await import('node:fs');
  copyFileSync(path, evidence('3c-export.png'));
});

// ---------- Third pass, follow-up 3 ----------
test('board: 外观与样式 opens styles; sections show what belongs; eraser reaches covered strokes and quick swipes', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await register(page);
  await createTrip(page);
  await openBoard(page);
  const a = await noteAt(page, 380, 260, '甲');
  const b = await noteAt(page, 860, 260, '乙');

  // Right-click → 外观与样式… opens the style choices right away.
  await a.click({ button: 'right' });
  await page.getByRole('menuitem', { name: /外观与样式/ }).click();
  const pop = page.locator('.style-pop');
  await expect(pop).toBeVisible();
  await expect(pop.getByRole('button', { name: '横线' })).toBeVisible();
  await page.screenshot({ path: evidence('3d-look-from-menu.png') });
  await page.keyboard.press('Escape');

  // A section around 甲: selecting it outlines 甲 (not 乙); selecting 甲 marks the section.
  await a.click({ button: 'right' });
  await page.getByRole('menuitem', { name: '框进分区' }).click();
  const section = page.locator('.board-item.item-section');
  await expect(section).toBeVisible();
  await page.keyboard.press('Escape');
  await page.locator('#stage').click({ position: { x: 1100, y: 650 } });
  await section.locator('.section-title').click();
  await expect(a.locator('.section-hint.member')).toHaveCount(1);
  await expect(b.locator('.section-hint')).toHaveCount(0);
  await page.screenshot({ path: evidence('3d-section-members.png') });
  await page.locator('#stage').click({ position: { x: 1100, y: 650 } });
  await a.click();
  await expect(section.locator('.section-hint.parent')).toHaveCount(1);
  await page.keyboard.press('Escape');

  // A stroke under a note: the eraser on the note still removes the stroke.
  const draw = async (x0, y, x1) => {
    await page.locator('#toolbar button[data-tool="pen"]').click();
    await page.mouse.move(x0, y);
    await page.mouse.down();
    await page.mouse.move((x0 + x1) / 2, y, { steps: 4 });
    await page.mouse.move(x1, y, { steps: 4 });
    await page.mouse.up();
  };
  await draw(300, 600, 700);
  await expect(page.locator('.board-item.item-stroke')).toHaveCount(1);
  await page.locator('#toolbar button[data-tool="select"]').click();
  const cover = await noteAt(page, 500, 640, '盖住');
  const cb = await cover.boundingBox();
  expect(cb.x < 500 && cb.x + cb.width > 500 && cb.y < 600 && cb.y + cb.height > 600).toBe(true);
  await page.locator('#toolbar button[data-tool="eraser"]').click();
  await page.mouse.move(500, 600);
  await expect(page.locator('.eraser-ring')).toHaveCSS('opacity', '1');
  await page.mouse.down();
  await page.mouse.up();
  await expect(page.locator('.board-item.item-stroke')).toHaveCount(0);
  await expect(cover).toBeVisible();

  // A quick swipe whose two samples sit on either side of a line still erases it.
  await draw(300, 470, 700);
  await expect(page.locator('.board-item.item-stroke')).toHaveCount(1);
  await page.locator('#toolbar button[data-tool="eraser"]').click();
  await page.mouse.move(360, 440);
  await page.mouse.down();
  await page.mouse.move(360, 500, { steps: 1 });
  await page.mouse.up();
  await expect(page.locator('.board-item.item-stroke')).toHaveCount(0);
  await expect
    .poll(
      async () =>
        (await boardItems(page)).items.filter(
          (i) => i.payload.content.type === 'stroke' && i.state !== 'deleted',
        ).length,
    )
    .toBe(0);
});

test('board: offline shows once, never as a returning banner, and notices stay off the toolbar', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await register(page);
  await createTrip(page);
  await openBoard(page);
  await page.context().setOffline(true);
  await noteAt(page, 500, 300, '离线也能写');
  await expect(page.locator('.sync-status.offline')).toBeVisible();
  const notice = page.locator('.action-notice');
  await expect(notice).toContainText('已离线');
  const nb = await notice.boundingBox();
  const tb = await page.locator('#toolbar').boundingBox();
  expect(nb.y + nb.height < tb.y || nb.y > tb.y + tb.height).toBe(true);
  await page.screenshot({ path: evidence('3d-offline-notice.png') });
  // On narrow viewports (390px), the offline indicator must not overlap adjacent header buttons.
  await page.setViewportSize({ width: 390, height: 844 });
  const syncBox = await page.locator('.sync-status.offline').boundingBox();
  const memBox = await page.locator('.members-button').boundingBox();
  expect(syncBox.x + syncBox.width).toBeLessThanOrEqual(memBox.x + 1);
  await page.setViewportSize({ width: 1280, height: 800 });
  // Keep working offline for a while: no page-wide 连接中断 banner shows up.
  await noteAt(page, 800, 300, '再写一张');
  await page.waitForTimeout(3000);
  await expect(page.locator('.global-notice')).toHaveCount(0);
  await page.context().setOffline(false);
  await expect
    .poll(
      async () =>
        (await boardItems(page)).items.filter((i) => i.payload.content.type === 'note').length,
      {
        timeout: 20000,
      },
    )
    .toBe(2);
});
