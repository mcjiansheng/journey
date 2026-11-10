import test from 'node:test';
import assert from 'node:assert/strict';
import {
  toWorld,
  toScreen,
  contentBounds,
  center,
  topZ,
  bottomZ,
  simplify,
  pathD,
  scaled,
  project,
  hourOf,
  sky,
  mapSvg,
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
  assert.equal(contentBounds([{ state: 'deleted', frame: { x: 10, y: 10, w: 100, h: 100 } }]), null);

  const items = [
    { id: '1', state: 'active', frame: { x: 100, y: 200, w: 150, h: 120 } },
    { id: '2', state: 'active', frame: { x: 300, y: 100, w: 200, h: 300 } },
    { id: '3', state: 'deleted', frame: { x: 1000, y: 1000, w: 500, h: 500 } },
  ];
  const bounds = contentBounds(items);
  assert.deepEqual(bounds, { x: 100, y: 100, w: 400, h: 300 });

  const cEmpty = center([], { w: 1200, h: 800 });
  assert.ok(cEmpty.k === 1);

  const c = center(items, { w: 1200, h: 800 });
  assert.ok(c.k > 0.2 && c.k <= 1.2);
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
  assert.deepEqual(simplify([[10, 10], [20, 20]]), [[10, 10], [20, 20]]);

  // Collinear points
  const line = [[0, 0], [10, 10], [20, 20], [30, 30]];
  const simplified = simplify(line, 1);
  assert.deepEqual(simplified, [[0, 0], [30, 30]]);

  // Complex path
  const curve = [[0, 0], [10, 50], [20, 0]];
  assert.equal(simplify(curve, 1).length, 3);

  // pathD tests
  assert.equal(pathD([]), '');
  assert.ok(pathD([[0, 0]]).startsWith('M0 0'));
  assert.equal(pathD([[0, 0], [10, 10]]), 'M0 0L10 10');
  const dCurve = pathD([[0, 0], [10, 20], [30, 40]]);
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

  // Widget aspect locked and clamped
  const widget = { content: { type: 'widget', kind: 'activity' }, style: { size: 'S' } };
  const sWidget = scaled(widget, { x: 100, y: 100, w: 168, h: 168, scale: 1 }, { w: 168, h: 168 }, 2, 2, 'se');
  assert.equal(sWidget.w, sWidget.h);
  assert.equal(sWidget.w, 336);

  // Text scaling modifies scale
  const textItem = { content: { type: 'text' } };
  const sText = scaled(textItem, { x: 0, y: 0, w: 150, h: 60, scale: 1 }, { w: 150, h: 60 }, 1.5, 1.5, 'se');
  assert.equal(sText.scale, 1.5);
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
