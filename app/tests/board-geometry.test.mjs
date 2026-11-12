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
  rebaseBox,
  overlapShare,
  inSection,
  strokeHit,
  segmentDistance,
} from '../src/board-geometry.js';
import { exportFileName, exportScale } from '../src/board-export.js';
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

test('alignment only with nearby objects, and the guide joins just that one', () => {
  const moving = { x: 103, y: 300, w: 40, h: 40 };
  const far = { x: 100, y: 1000, w: 100, h: 50 }; // same column, far below
  const close = { x: 104, y: 380, w: 60, h: 40 }; // just below
  const r = snapToGuides(moving, [far, close], 6, 120);
  assert.equal(r.dx, 1); // to the close one's left edge (104), not the far one's (100)
  assert.equal(r.guides.length, 1);
  assert.deepEqual([r.guides[0].from, r.guides[0].to], [300, 420]);
  // Nothing close: no snapping at all.
  const none = snapToGuides(moving, [far], 6, 120);
  assert.deepEqual([none.dx, none.dy, none.guides.length], [0, 0, 0]);
});

test('a rotated item’s resize outline stays on the real box when the frame shifts', () => {
  const from = { x: 0, y: 0, w: 168, h: 168, rotation: -30 };
  const to = keepAnchor(from, { ...from, w: 352 }, 'e');
  const box = { x: 0, y: 0, w: 300, h: 168 }; // in from's unrotated space
  const moved = rebaseBox(box, from, to);
  // Its top-left corner is the same point on screen either way.
  const world = (p, f) => rotatePoint(p, { x: f.x + f.w / 2, y: f.y + f.h / 2 }, f.rotation);
  const a = world({ x: box.x, y: box.y }, from);
  const b = world({ x: moved.x, y: moved.y }, to);
  near(a.x, b.x, 0.01);
  near(a.y, b.y, 0.01);
  assert.equal(rebaseBox(box, { ...from, rotation: 0 }, to), box);
});

test('exported pictures are named after the trip, the board and the day', () => {
  assert.equal(
    exportFileName('苏州/周末', '主白板', new Date(2026, 10, 12)),
    '苏州 周末-主白板-20261112.png',
  );
  assert.equal(exportFileName('', '', new Date(2026, 0, 5)), '白板-20260105.png');
});

test('section membership: at least half inside; nested sections only when fully inside', () => {
  const sec = { x: 0, y: 0, w: 400, h: 300 };
  assert.equal(overlapShare(sec, { x: 10, y: 10, w: 100, h: 100 }), 1);
  near(overlapShare(sec, { x: 350, y: 10, w: 100, h: 100 }), 0.5);
  assert.equal(inSection(sec, { x: 340, y: 10, w: 100, h: 100 }), true); // 60% inside
  assert.equal(inSection(sec, { x: 360, y: 10, w: 100, h: 100 }), false); // 40% inside
  assert.equal(inSection(sec, { x: 340, y: 10, w: 100, h: 100 }, true), false);
  assert.equal(inSection(sec, { x: 10, y: 10, w: 100, h: 100 }, true), true);
  assert.equal(overlapShare(sec, { x: 500, y: 0, w: 10, h: 10 }), 0);
});

test('eraser: swept circle against stroke segments', () => {
  near(segmentDistance(0, 0, 10, 0, 5, -5, 5, 5), 0); // crossing
  near(segmentDistance(0, 0, 10, 0, 0, 3, 10, 3), 3);
  const stroke = {
    frame: { x: 100, y: 100, w: 100, h: 20, rotation: 0 },
    content: {
      type: 'stroke',
      points: [
        [0, 10],
        [100, 10],
      ],
    },
  };
  // A point on the line, a near miss inside the radius, a clear miss.
  assert.equal(strokeHit(stroke, { x: 150, y: 110 }, { x: 150, y: 110 }, 4), true);
  assert.equal(strokeHit(stroke, { x: 150, y: 115 }, { x: 150, y: 115 }, 6), true);
  assert.equal(strokeHit(stroke, { x: 150, y: 130 }, { x: 150, y: 130 }, 6), false);
  // A fast swipe whose two samples sit on both sides of the line still hits.
  assert.equal(strokeHit(stroke, { x: 150, y: 60 }, { x: 150, y: 160 }, 2), true);
  // Turned 90° about its centre, the line runs vertically through x = 150.
  const turned = { ...stroke, frame: { ...stroke.frame, rotation: 90 } };
  assert.equal(strokeHit(turned, { x: 150, y: 70 }, { x: 150, y: 70 }, 3), true);
  assert.equal(strokeHit(turned, { x: 120, y: 110 }, { x: 120, y: 110 }, 3), false);
  // A dot (one point) is hit near it.
  const dot = { frame: { x: 0, y: 0, w: 20, h: 20 }, content: { points: [[10, 10]] } };
  assert.equal(strokeHit(dot, { x: 12, y: 10 }, { x: 12, y: 10 }, 3), true);
});

test('export scale stays sharp but bounded', () => {
  assert.equal(exportScale(1000, 800), 2);
  const big = exportScale(8000, 6000);
  assert.ok(big < 1 && 8000 * 6000 * big * big <= 24e6 + 1);
  assert.ok(exportScale(40000, 500) * 40000 <= 16000);
});
