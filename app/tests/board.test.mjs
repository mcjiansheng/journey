import test from 'node:test';
import assert from 'node:assert/strict';
import {
  toWorld,
  toScreen,
  contentBounds,
  center,
  DEFAULT_ZOOM,
  topZ,
  bottomZ,
  simplify,
  pathD,
  scaled,
  project,
  hourOf,
  sky,
  mapSvg,
  visibleArea,
  strokeLook,
  nearestDock,
  geoFit,
  geoProject,
} from '../src/board.js';

test('board: coordinate transformations', () => {
  const view = { x: 100, y: 50, k: 2 };
  const world = { x: 20, y: 30 };
  const screen = toScreen(world, view);
  assert.deepEqual(screen, { x: 140, y: 110 });

  const restored = toWorld(screen, view);
  assert.equal(Math.round(restored.x), world.x);
  assert.equal(Math.round(restored.y), world.y);
});

test('board: contentBounds and center calculation', () => {
  assert.equal(contentBounds([]), null);
  assert.equal(
    contentBounds([{ state: 'deleted', frame: { x: 10, y: 10, w: 100, h: 100 } }]),
    null,
  );

  const items = [
    { id: '1', state: 'active', frame: { x: 100, y: 200, w: 150, h: 120 } },
    { id: '2', state: 'active', frame: { x: 300, y: 100, w: 200, h: 300 } },
    { id: '3', state: 'deleted', frame: { x: 1000, y: 1000, w: 500, h: 500 } },
  ];
  const bounds = contentBounds(items);
  assert.deepEqual(bounds, { x: 100, y: 100, w: 400, h: 300 });

  const cEmpty = center([], { w: 1200, h: 800 });
  assert.equal(cEmpty.k, DEFAULT_ZOOM, 'an empty board opens at the comfortable 80%');

  const c = center(items, { w: 1200, h: 800 });
  assert.ok(c.k > 0.2 && c.k <= 1);
  // A few small objects are not blown up past the cap.
  assert.ok(center(items, { w: 1200, h: 800 }, {}, DEFAULT_ZOOM).k <= DEFAULT_ZOOM);
  // Center of bounds (300, 250) should be around the center of viewport
  const screenCenter = toScreen({ x: 300, y: 250 }, c);
  assert.ok(Math.abs(screenCenter.x - 600) < 50);
});

test('board: topZ and bottomZ', () => {
  assert.equal(topZ([]), 1);
  assert.equal(bottomZ([]), 0);

  const items = [
    { id: '1', state: 'active', z: 3 },
    { id: '2', state: 'active', z: 7 },
    { id: '3', state: 'deleted', z: 99 },
  ];
  assert.equal(topZ(items), 8);
  assert.equal(bottomZ(items), -1);
});

test('board: simplify and pathD', () => {
  assert.deepEqual(simplify(null), []);
  assert.deepEqual(simplify([[10, 10]]), [[10, 10]]);
  assert.deepEqual(
    simplify([
      [10, 10],
      [20, 20],
    ]),
    [
      [10, 10],
      [20, 20],
    ],
  );

  // Collinear points
  const line = [
    [0, 0],
    [10, 10],
    [20, 20],
    [30, 30],
  ];
  const simplified = simplify(line, 1);
  assert.deepEqual(simplified, [
    [0, 0],
    [30, 30],
  ]);

  // Complex path
  const curve = [
    [0, 0],
    [10, 50],
    [20, 0],
  ];
  assert.equal(simplify(curve, 1).length, 3);

  // pathD tests
  assert.equal(pathD([]), '');
  assert.ok(pathD([[0, 0]]).startsWith('M0 0'));
  assert.equal(
    pathD([
      [0, 0],
      [10, 10],
    ]),
    'M0 0L10 10',
  );
  const dCurve = pathD([
    [0, 0],
    [10, 20],
    [30, 40],
  ]);
  assert.ok(dCurve.includes('Q'));
});

test('board: scaled handles note, widget, text, and other items', () => {
  const note = { content: { type: 'note' } };
  const frame0 = { x: 50, y: 50, w: 200, h: 200, scale: 1 };
  const bbox0 = { w: 200, h: 200 };

  // Note free scale
  const sNote = scaled(note, frame0, bbox0, 1.5, 1.2, 'se');
  assert.equal(sNote.w, 300);
  assert.equal(sNote.h, 240);

  // Note anchor nw (shrinks from top-left, moves x/y)
  const sNoteNw = scaled(note, frame0, bbox0, 0.5, 0.5, 'nw');
  assert.equal(sNoteNw.w, 100);
  assert.equal(sNoteNw.h, 100);
  assert.equal(sNoteNw.x, 150);
  assert.equal(sNoteNw.y, 150);

  // Note clamped
  const sNoteClamp = scaled(note, frame0, bbox0, 10, 10, 'se');
  assert.equal(sNoteClamp.w, 900);
  assert.equal(sNoteClamp.h, 900);

  // Widget aspect locked; corners scale within 0.75–1.6× the form's base size
  const widget = { content: { type: 'widget', kind: 'activity' }, style: { size: 'S' } };
  const sWidget = scaled(
    widget,
    { x: 100, y: 100, w: 168, h: 168, scale: 1 },
    { w: 168, h: 168 },
    2,
    2,
    'se',
  );
  assert.equal(sWidget.w, sWidget.h);
  assert.equal(sWidget.w, Math.round(168 * 1.6));
  const sSmall = scaled(
    widget,
    { x: 100, y: 100, w: 168, h: 168, scale: 1 },
    { w: 168, h: 168 },
    0.2,
    0.2,
    'se',
  );
  assert.equal(sSmall.w, 126);

  // Text scaling modifies scale
  const textItem = { content: { type: 'text' } };
  const sText = scaled(
    textItem,
    { x: 0, y: 0, w: 150, h: 60, scale: 1 },
    { w: 150, h: 60 },
    1.5,
    1.5,
    'se',
  );
  assert.equal(sText.scale, 1.5);
  // The frame is the size seen on the board, so selection and culling match (N-2)
  assert.equal(sText.w, 225);
  assert.equal(sText.h, 90);
  // A second resize starts from the visible size and does not jump
  const again = scaled(textItem, sText, { w: sText.w, h: sText.h }, 2, 2, 'se');
  assert.equal(again.scale, 3);
  assert.equal(again.w, 450);
});

test('board: project coordinates', () => {
  const box = { x: 0, y: 0, w: 200, h: 100 };
  assert.deepEqual(project([], box), []);
  assert.deepEqual(project([[120, 30]], box), [[100, 50]]);

  const stops = [
    [120.1, 30.2],
    [120.2, 30.3],
  ];
  const projected = project(stops, box);
  assert.equal(projected.length, 2);
  assert.ok(projected[0][0] <= projected[1][0]);
});

test('board: hourOf and sky', () => {
  assert.equal(hourOf(null), null);
  assert.equal(hourOf({ time: { mode: 'flexible', period: 'morning' } }), 9.5);
  assert.equal(hourOf({ time: { mode: 'precise', start: '14:30' } }), 14.5);
  assert.equal(hourOf({ time: { mode: 'none' } }), null);

  const skyNone = sky(null);
  assert.equal(skyNone.none, true);

  const skyNoon = sky(12);
  assert.equal(skyNoon.night, false);
  assert.ok(skyNoon.a && skyNoon.b);

  const skyNight = sky(23);
  assert.equal(skyNight.night, true);
});

test('board: mapSvg determinism', () => {
  const svg1 = mapSvg('hangzhou', 352, 168);
  const svg2 = mapSvg('hangzhou', 352, 168);
  const svg3 = mapSvg('tokyo', 352, 168);

  assert.equal(svg1, svg2);
  assert.notEqual(svg1, svg3);
  assert.ok(svg1.includes('<svg class="map-bg"'));
  assert.ok(svg1.includes('var(--map-land)'));
});

test('board: center keeps content inside the area not covered by the panel', () => {
  const items = [{ state: 'active', frame: { x: 0, y: 0, w: 400, h: 200 } }];
  const v = center(items, { w: 1280, h: 800 }, { left: 376 });
  const left = toScreen({ x: 0, y: 0 }, v).x;
  const right = toScreen({ x: 400, y: 0 }, v).x;
  assert.ok(left > 376, 'content starts right of the docked panel');
  assert.ok(Math.abs((left + right) / 2 - (376 + (1280 - 376) / 2)) < 1);
  assert.deepEqual(visibleArea({ w: 1280, h: 800 }, { bottom: 364 }), {
    x: 0,
    y: 0,
    w: 1280,
    h: 436,
  });
});

test('board: stroke look shares colors and widths between draft and saved stroke', () => {
  assert.deepEqual(strokeLook('pen', 'blue', 8), {
    stroke: 'var(--ink-blue)',
    width: 8,
    opacity: 1,
  });
  assert.deepEqual(strokeLook('pen', 'unknown'), {
    stroke: 'var(--ink-default)',
    width: 4,
    opacity: 1,
  });
  const hl = strokeLook('highlighter', 'pink', 99);
  assert.equal(hl.stroke, 'var(--hl-pink)');
  assert.equal(hl.width, 16);
  assert.ok(hl.opacity < 1);
});

test('board: dock target is the nearest edge, never floating', () => {
  assert.equal(nearestDock(100, 400, 1280, 800), 'left');
  assert.equal(nearestDock(1000, 300, 1280, 800), 'right');
  assert.equal(nearestDock(640, 760, 1280, 800), 'bottom');
  assert.equal(nearestDock(640, 100, 1280, 800), 'left');
});

test('board: static map fit puts points inside the requested box', () => {
  const pts = [
    [117.227, 31.82],
    [117.3, 31.86],
    [117.25, 31.79],
  ];
  const box = { x: 182, y: 26, w: 146, h: 116 };
  const view = geoFit(pts, box, 352, 168);
  assert.ok(Number.isInteger(view.zoom) && view.zoom >= 3 && view.zoom <= 17);
  for (const [x, y] of geoProject(pts, view, 352, 168)) {
    assert.ok(x >= box.x - 0.5 && x <= box.x + box.w + 0.5, `x ${x}`);
    assert.ok(y >= box.y - 0.5 && y <= box.y + box.h + 0.5, `y ${y}`);
  }
  // A single place lands exactly on the anchor (under the pin)
  const one = geoFit([[117.227, 31.82]], { x: 84, y: 67, w: 0, h: 0 }, 168, 168, {
    singleZoom: 16,
  });
  assert.equal(one.zoom, 16);
  const [[px, py]] = geoProject([[117.227, 31.82]], one, 168, 168);
  assert.ok(Math.abs(px - 84) < 0.01 && Math.abs(py - 67) < 0.01);
});

test('board: pending local changes survive an older server copy', async () => {
  const { reconcilePending, mergeExpected, PENDING_TTL } = await import('../src/board-pending.js');
  const local = [{ id: 'a', state: 'active', frame: { x: 200, y: 0, w: 168, h: 168 } }];
  const stale = [{ id: 'a', state: 'active', frame: { x: 10, y: 0, w: 168, h: 168 } }];
  const pending = new Map([['a', { expect: { frame: { x: 200 } }, at: 1000 }]]);
  // An echo of an earlier operation must not move the object back.
  assert.equal(reconcilePending(stale, local, pending, 2000)[0].frame.x, 200);
  assert.ok(pending.has('a'));
  // Once the server has the change, its copy wins and the entry is cleared.
  const fresh = [{ id: 'a', state: 'active', frame: { x: 200, y: 0, w: 168, h: 168 } }];
  assert.equal(reconcilePending(fresh, local, pending, 2500)[0], fresh[0]);
  assert.equal(pending.size, 0);
  // A conflicting peer change wins after the grace period.
  pending.set('a', { expect: { frame: { x: 200 } }, at: 0 });
  assert.equal(reconcilePending(stale, local, pending, PENDING_TTL + 1)[0].frame.x, 10);
  // A local item the server has not seen yet is kept.
  const created = new Map([['b', { expect: { state: 'active' }, at: 1000 }]]);
  const out = reconcilePending([], [{ id: 'b', state: 'active' }], created, 1200);
  assert.deepEqual(
    out.map((i) => i.id),
    ['b'],
  );
  assert.deepEqual(mergeExpected({ frame: { x: 1 } }, { frame: { y: 2 }, z: 3 }), {
    frame: { x: 1, y: 2 },
    z: 3,
  });
});

test('board: map tiles cover the container and align with projected points', async () => {
  const { geoTiles } = await import('../src/board.js');
  const view = geoFit([[117.227, 31.82]], { x: 84, y: 67, w: 0, h: 0 }, 168, 168, {
    singleZoom: 16,
  });
  const tiles = geoTiles(view, 168, 168);
  assert.ok(tiles.length >= 4 && tiles.length <= 9);
  assert.ok(tiles.every((t) => t.z === 17 && t.size === 128));
  // Union of tiles covers the whole container.
  assert.ok(Math.min(...tiles.map((t) => t.left)) <= 0);
  assert.ok(Math.min(...tiles.map((t) => t.top)) <= 0);
  assert.ok(Math.max(...tiles.map((t) => t.left + t.size)) >= 168);
  assert.ok(Math.max(...tiles.map((t) => t.top + t.size)) >= 168);
  // The tile holding the place, at z17, contains the anchor pixel.
  const n = 2 ** 17;
  const tx = Math.floor(((117.227 + 180) / 360) * n);
  const s = Math.sin((31.82 * Math.PI) / 180);
  const ty = Math.floor((0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI)) * n);
  const t = tiles.find((t) => t.x === tx && t.y === ty);
  assert.ok(t && t.left <= 84 && t.left + t.size >= 84 && t.top <= 67 && t.top + t.size >= 67);
});
