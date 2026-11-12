// Geometry for the board: rotation, group transforms, snapping and alignment.
// Frames are { x, y, w, h, rotation, scale }; rotation is in degrees around the
// frame center, the same way the item is drawn.

export const rad = (deg) => (deg * Math.PI) / 180;

export function normalizeAngle(deg) {
  let a = ((((deg + 180) % 360) + 360) % 360) - 180;
  if (a === -180) a = 180;
  return Math.round(a * 10) / 10;
}

export function frameCenter(f) {
  return { x: f.x + f.w / 2, y: f.y + f.h / 2 };
}

export function rotatePoint(p, c, deg) {
  if (!deg) return { x: p.x, y: p.y };
  const a = rad(deg);
  const cos = Math.cos(a);
  const sin = Math.sin(a);
  const dx = p.x - c.x;
  const dy = p.y - c.y;
  return { x: c.x + dx * cos - dy * sin, y: c.y + dx * sin + dy * cos };
}

/** World point → the item's unrotated space (for resizing a rotated item). */
export function toLocal(p, f) {
  return rotatePoint(p, frameCenter(f), -(f.rotation || 0));
}

export function frameCorners(f) {
  const c = frameCenter(f);
  return [
    { x: f.x, y: f.y },
    { x: f.x + f.w, y: f.y },
    { x: f.x + f.w, y: f.y + f.h },
    { x: f.x, y: f.y + f.h },
  ].map((p) => rotatePoint(p, c, f.rotation || 0));
}

/** Axis-aligned box around a (possibly rotated) frame. */
export function frameBounds(f) {
  if (!f.rotation) return { x: f.x, y: f.y, w: f.w, h: f.h };
  const pts = frameCorners(f);
  const xs = pts.map((p) => p.x);
  const ys = pts.map((p) => p.y);
  const x = Math.min(...xs);
  const y = Math.min(...ys);
  return { x, y, w: Math.max(...xs) - x, h: Math.max(...ys) - y };
}

export function unionBounds(boxes) {
  if (!boxes.length) return null;
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (const b of boxes) {
    x0 = Math.min(x0, b.x);
    y0 = Math.min(y0, b.y);
    x1 = Math.max(x1, b.x + b.w);
    y1 = Math.max(y1, b.y + b.h);
  }
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

export const groupBounds = (frames) => unionBounds(frames.map(frameBounds));

export function intersects(a, b) {
  return a.x <= b.x + b.w && b.x <= a.x + a.w && a.y <= b.y + b.h && b.y <= a.y + a.h;
}
export function contains(outer, inner) {
  return (
    inner.x >= outer.x &&
    inner.y >= outer.y &&
    inner.x + inner.w <= outer.x + outer.w &&
    inner.y + inner.h <= outer.y + outer.h
  );
}

/** Rectangle from two corner points, in any order. */
export function rectFrom(a, b) {
  const x = Math.min(a.x, b.x);
  const y = Math.min(a.y, b.y);
  return { x, y, w: Math.abs(a.x - b.x), h: Math.abs(a.y - b.y) };
}

// The point of an unrotated frame that stays put while a handle is dragged:
// the opposite corner for corners, the opposite edge's midpoint for edges.
function fixedPoint(anchor, f) {
  const x = anchor.includes('e') ? f.x : anchor.includes('w') ? f.x + f.w : f.x + f.w / 2;
  const y = anchor.includes('s') ? f.y : anchor.includes('n') ? f.y + f.h : f.y + f.h / 2;
  return { x, y };
}

/**
 * Move `next` (a resized copy of `prev`, computed in unrotated space) so the
 * point opposite the dragged handle stays where it is on screen. Without this
 * a rotated item would drift while it is resized.
 */
export function keepAnchor(prev, next, anchor) {
  const r = prev.rotation || 0;
  if (!r) return next;
  const before = rotatePoint(fixedPoint(anchor, prev), frameCenter(prev), r);
  const after = rotatePoint(fixedPoint(anchor, next), frameCenter(next), r);
  return {
    ...next,
    x: Math.round((next.x + before.x - after.x) * 10) / 10,
    y: Math.round((next.y + before.y - after.y) * 10) / 10,
  };
}

/** Angle for the rotation handle (above the item) at world point `p`. */
export function handleAngle(center, p) {
  return (Math.atan2(p.y - center.y, p.x - center.x) * 180) / Math.PI + 90;
}

/**
 * Shift: 15° steps. Otherwise the item sticks to the right angles when it is
 * within 3° of them, so "straight" is easy to hit.
 */
export function snapAngle(deg, step = false) {
  if (step) return normalizeAngle(Math.round(deg / 15) * 15);
  const right = Math.round(deg / 90) * 90;
  if (Math.abs(deg - right) <= 3) return normalizeAngle(right);
  return normalizeAngle(Math.round(deg));
}

/** Rotate a set of frames around `c` by `delta` degrees. */
export function rotateFrames(frames, c, delta) {
  const out = {};
  for (const [id, f] of Object.entries(frames)) {
    const fc = rotatePoint(frameCenter(f), c, delta);
    out[id] = {
      ...f,
      x: Math.round((fc.x - f.w / 2) * 10) / 10,
      y: Math.round((fc.y - f.h / 2) * 10) / 10,
      rotation: normalizeAngle((f.rotation || 0) + delta),
    };
  }
  return out;
}

// ---------- Gallery ratios ----------
export const GALLERY_SNAP_RATIOS = ['1:2', '9:16', '3:4', '1:1', '4:3', '16:9', '2:1'];
export function ratioNumber(ratio = '1:1') {
  const [a, b] = String(ratio).split(':').map(Number);
  return a > 0 && b > 0 ? a / b : 1;
}
/** Nearest common ratio to a width/height value. */
export function snapRatio(value) {
  let best = '1:1';
  let bestD = Infinity;
  for (const r of GALLERY_SNAP_RATIOS) {
    const d = Math.abs(Math.log(ratioNumber(r)) - Math.log(Math.max(0.01, value)));
    if (d < bestD) {
      bestD = d;
      best = r;
    }
  }
  return best;
}

// ---------- Strokes ----------
/**
 * Saved stroke: points relative to the frame origin, and that origin is the
 * same (rounded) one the frame is drawn at, so the saved path lands exactly on
 * the draft path. Only near-duplicate points are dropped (≤ 0.35 world px off
 * the line), which keeps the curve's shape; long strokes thin out further only
 * when they would pass the 1000-point limit.
 */
export function finalizeStroke(points, simplifyFn, limit = 1000) {
  let eps = 0.35;
  let pts = simplifyFn(points, eps);
  while (pts.length > limit && eps < 8) {
    eps *= 1.6;
    pts = simplifyFn(points, eps);
  }
  if (pts.length > limit) pts = pts.filter((_, i) => i % Math.ceil(pts.length / limit) === 0);
  const xs = pts.map((p) => p[0]);
  const ys = pts.map((p) => p[1]);
  const x = Math.floor(Math.min(...xs));
  const y = Math.floor(Math.min(...ys));
  const w = Math.max(20, Math.ceil(Math.max(...xs) - x));
  const h = Math.max(20, Math.ceil(Math.max(...ys) - y));
  return {
    frame: { x, y, w, h, scale: 1 },
    points: pts.map(([px, py]) => [
      Math.round((px - x) * 100) / 100,
      Math.round((py - y) * 100) / 100,
    ]),
  };
}

// ---------- Alignment ----------
const edgesX = (b) => [b.x, b.x + b.w / 2, b.x + b.w];
const edgesY = (b) => [b.y, b.y + b.h / 2, b.y + b.h];

// Gap between two boxes along one axis (0 when they overlap on it).
const gapY = (a, b) => Math.max(0, b.y - (a.y + a.h), a.y - (b.y + b.h));
const gapX = (a, b) => Math.max(0, b.x - (a.x + a.w), a.x - (b.x + b.w));

/**
 * Snap a moving box to the edges and centers of nearby boxes. Only boxes
 * within `near` of the moving one count (a vertical guide needs the other box
 * close above or below, a horizontal one close to the side), and the closest
 * one wins ties, so the guide connects the box you are actually lining up
 * with. Returns the correction to add and the guides (world coordinates).
 */
export function snapToGuides(moving, others, threshold, near = Infinity) {
  let bestX = null;
  let bestY = null;
  const better = (cur, d, gap) =>
    !cur ||
    Math.abs(d) < Math.abs(cur.d) - 0.01 ||
    (Math.abs(d) - Math.abs(cur.d) < 0.01 && gap < cur.gap);
  for (const o of others) {
    const gy = gapY(moving, o);
    if (gy <= near)
      for (const mx of edgesX(moving))
        for (const ox of edgesX(o)) {
          const d = ox - mx;
          if (Math.abs(d) <= threshold && better(bestX, d, gy)) bestX = { d, pos: ox, o, gap: gy };
        }
    const gx = gapX(moving, o);
    if (gx <= near)
      for (const my of edgesY(moving))
        for (const oy of edgesY(o)) {
          const d = oy - my;
          if (Math.abs(d) <= threshold && better(bestY, d, gx)) bestY = { d, pos: oy, o, gap: gx };
        }
  }
  const dx = bestX ? bestX.d : 0;
  const dy = bestY ? bestY.d : 0;
  const snapped = { ...moving, x: moving.x + dx, y: moving.y + dy };
  const guides = [];
  if (bestX) {
    const ys = [snapped.y, snapped.y + snapped.h, bestX.o.y, bestX.o.y + bestX.o.h];
    guides.push({ axis: 'x', pos: bestX.pos, from: Math.min(...ys), to: Math.max(...ys) });
  }
  if (bestY) {
    const xs = [snapped.x, snapped.x + snapped.w, bestY.o.x, bestY.o.x + bestY.o.w];
    guides.push({ axis: 'y', pos: bestY.pos, from: Math.min(...xs), to: Math.max(...xs) });
  }
  return { dx, dy, guides };
}

/**
 * Align or distribute frames (keyed by id) by their visible bounds.
 * mode: left | hcenter | right | top | vcenter | bottom | hspace | vspace
 */
export function alignFrames(frames, mode) {
  const ids = Object.keys(frames);
  const boxes = Object.fromEntries(ids.map((id) => [id, frameBounds(frames[id])]));
  const all = unionBounds(Object.values(boxes));
  const out = {};
  const move = (id, dx, dy) => {
    const f = frames[id];
    out[id] = { ...f, x: Math.round(f.x + dx), y: Math.round(f.y + dy) };
  };
  if (mode === 'hspace' || mode === 'vspace') {
    const horizontal = mode === 'hspace';
    const sorted = [...ids].sort((a, b) =>
      horizontal ? boxes[a].x - boxes[b].x : boxes[a].y - boxes[b].y,
    );
    if (sorted.length < 3) return {};
    const total = sorted.reduce((s, id) => s + (horizontal ? boxes[id].w : boxes[id].h), 0);
    const gap = ((horizontal ? all.w : all.h) - total) / (sorted.length - 1);
    let cursor = horizontal ? all.x : all.y;
    for (const id of sorted) {
      const b = boxes[id];
      if (horizontal) move(id, cursor - b.x, 0);
      else move(id, 0, cursor - b.y);
      cursor += (horizontal ? b.w : b.h) + gap;
    }
    return out;
  }
  for (const id of ids) {
    const b = boxes[id];
    if (mode === 'left') move(id, all.x - b.x, 0);
    else if (mode === 'right') move(id, all.x + all.w - (b.x + b.w), 0);
    else if (mode === 'hcenter') move(id, all.x + all.w / 2 - (b.x + b.w / 2), 0);
    else if (mode === 'top') move(id, 0, all.y - b.y);
    else if (mode === 'bottom') move(id, 0, all.y + all.h - (b.y + b.h));
    else if (mode === 'vcenter') move(id, 0, all.y + all.h / 2 - (b.y + b.h / 2));
  }
  return out;
}

/**
 * A box given in the unrotated space of `from` (a resize gesture's start
 * frame), re-expressed in the unrotated space of `to` (the frame now drawn).
 * The resize outline of a rotated item is drawn inside the item, so without
 * this it slides away from the real box whenever the frame shifts.
 */
export function rebaseBox(box, from, to) {
  const r = from.rotation || 0;
  if (!r || !box) return box;
  const c0 = frameCenter(from);
  const d = rotatePoint(c0, frameCenter(to), -r);
  return { ...box, x: box.x - c0.x + d.x, y: box.y - c0.y + d.y };
}
