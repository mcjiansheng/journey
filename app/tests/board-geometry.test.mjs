import test from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizeAngle,
  rotatePoint,
  toLocal,
  frameBounds,
  groupBounds,
  keepAnchor,
  handleAngle,
  snapAngle,
  rotateFrames,
  snapRatio,
  finalizeStroke,
  snapToGuides,
  alignFrames,
  intersects,
  contains,
  rectFrom,
} from '../src/board-geometry.js';
import { simplify, pathD } from '../src/board.js';

const near = (a, b, eps = 0.01) => assert.ok(Math.abs(a - b) <= eps, `${a} ≈ ${b}`);

test('angles normalise and snap', () => {
  assert.equal(normalizeAngle(190), -170);
  assert.equal(normalizeAngle(-180), 180);
  assert.equal(snapAngle(88), 90);
  assert.equal(snapAngle(84), 84);
  assert.equal(snapAngle(22, true), 15);
  assert.equal(snapAngle(23, true), 30);
  // The handle sits above the item: straight up is 0°.
  near(handleAngle({ x: 0, y: 0 }, { x: 0, y: -10 }), 0);
  near(handleAngle({ x: 0, y: 0 }, { x: 10, y: 0 }), 90);
});

test('rotated frames: bounds, local points and a fixed anchor while resizing', () => {
  const f = { x: 0, y: 0, w: 100, h: 50, rotation: 90 };
  const b = frameBounds(f);
  near(b.w, 50);
  near(b.h, 100);
  near(b.x, 25);
  near(b.y, -25);
  const p = rotatePoint({ x: 100, y: 25 }, { x: 50, y: 25 }, 90);
  near(p.x, 50);
  near(p.y, 75);
  const back = toLocal(p, f);
  near(back.x, 100);
  near(back.y, 25);
  // Grow the width from the east handle: the west edge stays on screen.
  const grown = keepAnchor(f, { ...f, w: 160 }, 'e');
  const westBefore = rotatePoint({ x: 0, y: 25 }, { x: 50, y: 25 }, 90);
  const westAfter = rotatePoint(
    { x: grown.x, y: grown.y + 25 },
    { x: grown.x + 80, y: grown.y + 25 },
    90,
  );
  near(westAfter.x, westBefore.x, 0.1);
  near(westAfter.y, westBefore.y, 0.1);
  assert.equal(keepAnchor({ ...f, rotation: 0 }, { ...f, rotation: 0, w: 160 }, 'e').x, 0);
});

test('group rotation turns every item around the group center', () => {
  const frames = {
    a: { x: 0, y: 0, w: 10, h: 10, rotation: 0 },
    b: { x: 90, y: 0, w: 10, h: 10, rotation: 10 },
  };
  const out = rotateFrames(frames, { x: 50, y: 5 }, 180);
  near(out.a.x, 90);
  near(out.b.x, 0);
  assert.equal(out.b.rotation, -170);
  const g = groupBounds(Object.values(frames));
  assert.equal(g.w > 99, true);
});

test('gallery edges snap to common ratios', () => {
  assert.equal(snapRatio(1.02), '1:1');
  assert.equal(snapRatio(0.5), '1:2');
  assert.equal(snapRatio(0.58), '9:16');
  assert.equal(snapRatio(1.3), '4:3');
  assert.equal(snapRatio(1.8), '16:9');
  assert.equal(snapRatio(2.4), '2:1');
});

test('a saved stroke lands where the draft was drawn', () => {
  const pts = [];
  for (let i = 0; i <= 200; i++) pts.push([103.37 + i * 0.7, 51.81 + Math.sin(i / 9) * 30]);
  const { frame, points } = finalizeStroke(pts, simplify);
  // Absolute positions of kept points equal the drawn ones (to 0.01 px).
  for (const [x, y] of points) {
    const ax = frame.x + x;
    const ay = frame.y + y;
    assert.ok(pts.some(([px, py]) => Math.abs(px - ax) < 0.01 && Math.abs(py - ay) < 0.01));
  }
  assert.ok(Number.isInteger(frame.x) && Number.isInteger(frame.y));
  // The curve keeps its shape: far more points than the old 1.5px simplify kept.
  assert.ok(points.length > simplify(pts, 1.5).length);
  assert.ok(pathD(points).startsWith('M'));
  // Very long strokes still fit the server's 1000-point limit.
  const long = [];
  for (let i = 0; i < 5000; i++) long.push([i * 0.5, Math.sin(i / 3) * 40]);
  assert.ok(finalizeStroke(long, simplify).points.length <= 1000);
});

test('alignment guides snap a moving box to nearby edges and centers', () => {
  const others = [{ x: 100, y: 100, w: 100, h: 50 }];
  const r = snapToGuides({ x: 103, y: 300, w: 40, h: 40 }, others, 6);
  assert.equal(r.dx, -3);
  assert.equal(r.dy, 0);
  assert.equal(r.guides[0].axis, 'x');
  assert.equal(r.guides[0].pos, 100);
  const none = snapToGuides({ x: 400, y: 400, w: 10, h: 10 }, others, 6);
  assert.deepEqual([none.dx, none.dy, none.guides.length], [0, 0, 0]);
});

test('align and distribute selected items', () => {
  const frames = {
    a: { x: 0, y: 0, w: 10, h: 10 },
    b: { x: 50, y: 20, w: 20, h: 10 },
    c: { x: 200, y: 5, w: 10, h: 30 },
  };
  const left = alignFrames(frames, 'left');
  assert.deepEqual(
    Object.values(left).map((f) => f.x),
    [0, 0, 0],
  );
  const bottom = alignFrames(frames, 'bottom');
  assert.deepEqual(
    Object.values(bottom).map((f) => f.y + f.h),
    [35, 35, 35],
  );
  const spread = alignFrames(frames, 'hspace');
  // Equal gaps: (210 - 40) / 2 = 85
  assert.equal(spread.b.x, 95);
  assert.deepEqual(alignFrames({ a: frames.a, b: frames.b }, 'hspace'), {});
});

test('marquee hit tests', () => {
  const r = rectFrom({ x: 10, y: 10 }, { x: 0, y: 0 });
  assert.deepEqual(r, { x: 0, y: 0, w: 10, h: 10 });
  assert.ok(intersects(r, { x: 5, y: 5, w: 100, h: 100 }));
  assert.ok(!contains(r, { x: 5, y: 5, w: 100, h: 100 }));
  assert.ok(contains(r, { x: 2, y: 2, w: 3, h: 3 }));
});
