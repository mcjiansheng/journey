import { WIDGET_SIZES, widgetSize } from './board-widgets.js';

export function toWorld(screenPoint, view) {
  return {
    x: (screenPoint.x - view.x) / view.k,
    y: (screenPoint.y - view.y) / view.k,
  };
}

export function toScreen(worldPoint, view) {
  return {
    x: worldPoint.x * view.k + view.x,
    y: worldPoint.y * view.k + view.y,
  };
}

export function contentBounds(items = []) {
  const activeItems = items.filter((it) => it.state !== 'deleted');
  if (!activeItems.length) return null;
  let minX = Infinity,
    minY = Infinity,
    maxX = -Infinity,
    maxY = -Infinity;
  for (const it of activeItems) {
    const f = it.frame || { x: 0, y: 0, w: 100, h: 100 };
    minX = Math.min(minX, f.x);
    minY = Math.min(minY, f.y);
    maxX = Math.max(maxX, f.x + (f.w || 0));
    maxY = Math.max(maxY, f.y + (f.h || 0));
  }
  return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
}

export function center(items = [], viewport = { w: 1200, h: 800 }) {
  const bounds = contentBounds(items);
  if (!bounds || bounds.w === 0 || bounds.h === 0) {
    return { x: viewport.w / 2 - 200, y: viewport.h / 2 - 150, k: 1 };
  }
  const pad = viewport.w < 640 ? 32 : 90;
  const topPad = 70,
    bottomPad = 140;
  const availW = Math.max(100, viewport.w - pad * 2);
  const availH = Math.max(100, viewport.h - topPad - bottomPad);
  const k = Math.min(1.2, Math.max(0.2, Math.min(availW / bounds.w, availH / bounds.h)));
  const cx = bounds.x + bounds.w / 2;
  const cy = bounds.y + bounds.h / 2;
  return {
    x: viewport.w / 2 - cx * k,
    y: topPad + (viewport.h - topPad - bottomPad) / 2 - cy * k,
    k,
  };
}

export function topZ(items = []) {
  const activeItems = items.filter((i) => i.state !== 'deleted');
  if (!activeItems.length) return 1;
  return Math.max(0, ...activeItems.map((i) => i.z || 0)) + 1;
}

export function bottomZ(items = []) {
  const activeItems = items.filter((i) => i.state !== 'deleted');
  if (!activeItems.length) return 0;
  return Math.min(0, ...activeItems.map((i) => i.z || 0)) - 1;
}

export function simplify(points, epsilon = 1.5) {
  if (!points || points.length < 3) return points ? [...points] : [];
  let maxDist = 0;
  let index = 0;
  const start = points[0];
  const end = points[points.length - 1];
  const dx = end[0] - start[0];
  const dy = end[1] - start[1];
  const len = Math.hypot(dx, dy) || 1;

  for (let i = 1; i < points.length - 1; i++) {
    const pt = points[i];
    const dist = Math.abs(dy * pt[0] - dx * pt[1] + end[0] * start[1] - end[1] * start[0]) / len;
    if (dist > maxDist) {
      maxDist = dist;
      index = i;
    }
  }

  if (maxDist > epsilon) {
    const left = simplify(points.slice(0, index + 1), epsilon);
    const right = simplify(points.slice(index), epsilon);
    return left.slice(0, -1).concat(right);
  }
  return [start, end];
}

export function pathD(points) {
  if (!points || !points.length) return '';
  if (points.length === 1) return `M${points[0][0]} ${points[0][1]}l0.01 0`;
  if (points.length === 2)
    return `M${points[0][0]} ${points[0][1]}L${points[1][0]} ${points[1][1]}`;
  let d = `M${points[0][0]} ${points[0][1]}`;
  for (let i = 1; i < points.length - 1; i++) {
    const mx = (points[i][0] + points[i + 1][0]) / 2;
    const my = (points[i][1] + points[i + 1][1]) / 2;
    d += `Q${points[i][0]} ${points[i][1]} ${mx} ${my}`;
  }
  const last = points[points.length - 1];
  d += `L${last[0]} ${last[1]}`;
  return d;
}

function clamp(v, min, max) {
  return Math.max(min, Math.min(max, v));
}

export function scaled(item, frame0, bbox0, sx, sy, anchor = 'se') {
  const type = item.content?.type;
  let w = bbox0.w;
  let h = bbox0.h;
  let scale = frame0.scale || 1;
  const s = Math.max(sx, sy);

  if (type === 'note') {
    w = clamp(bbox0.w * sx, 100, 900);
    h = clamp(bbox0.h * sy, 80, 900);
  } else if (type === 'widget') {
    const size = widgetSize(item);
    const base = WIDGET_SIZES[size] || [168, 168];
    w = clamp(bbox0.w * s, base[0] * 0.6, base[0] * 2.5);
    h = (w * base[1]) / base[0];
  } else if (type === 'text') {
    const factor = clamp(s, 0.3 / scale, 8 / scale);
    scale = scale * factor;
    w = bbox0.w * factor;
    h = bbox0.h * factor;
  } else {
    w = clamp(bbox0.w * s, 24, 2400);
    h = (w * bbox0.h) / (bbox0.w || 1);
  }

  const f = {
    ...frame0,
    w: type === 'text' ? frame0.w : Math.round(w),
    h: type === 'text' ? frame0.h : Math.round(h),
    scale: type === 'text' ? +scale.toFixed(3) : 1,
  };

  if (anchor.includes('w')) f.x = Math.round(frame0.x + bbox0.w - w);
  if (anchor.includes('n')) f.y = Math.round(frame0.y + bbox0.h - h);
  if (anchor === 'c') {
    f.x = Math.round(frame0.x + (bbox0.w - w) / 2);
    f.y = Math.round(frame0.y + (bbox0.h - h) / 2);
  }

  return f;
}

export function project(stops, box) {
  if (!stops || !stops.length) return [];
  if (stops.length === 1) {
    return [[box.x + box.w / 2, box.y + box.h / 2]];
  }
  const avgLat = stops.reduce((sum, p) => sum + p[1], 0) / stops.length;
  const k = Math.cos((avgLat * Math.PI) / 180);
  const xy = stops.map(([lng, lat]) => [lng * k, -lat]);
  const xs = xy.map((p) => p[0]);
  const ys = xy.map((p) => p[1]);
  const x0 = Math.min(...xs);
  const x1 = Math.max(...xs);
  const y0 = Math.min(...ys);
  const y1 = Math.max(...ys);

  const spanX = x1 - x0;
  const spanY = y1 - y0;
  const sc = Math.min(
    spanX > 0.000001 ? box.w / spanX : Infinity,
    spanY > 0.000001 ? box.h / spanY : Infinity,
  );
  const s = Number.isFinite(sc) ? sc : 0;

  return xy.map(([x, y]) => [
    box.x + box.w / 2 + (x - (x0 + x1) / 2) * s,
    box.y + box.h / 2 + (y - (y0 + y1) / 2) * s,
  ]);
}

export function hourOf(activity) {
  if (!activity || !activity.time) return null;
  const time = activity.time;
  if (time.mode === 'precise' && time.start) {
    const parts = time.start.split(':');
    return +parts[0] + +parts[1] / 60;
  }
  const periods = { morning: 9.5, afternoon: 15, evening: 20 };
  return periods[time.period] ?? null;
}

export function sky(h) {
  if (h === null || h === undefined) {
    return {
      a: 'var(--widget-brand-a)',
      b: 'var(--widget-brand-b)',
      orb: '#ffffff',
      c: '#9fb3c8',
      x: 78,
      y: 26,
      none: true,
      night: false,
    };
  }
  const day = clamp((h - 6) / 12, 0, 1);
  const x = 68 + 20 * day;
  const y = 26 - 12 * Math.sin(day * Math.PI);

  if (h < 5 || h >= 21) {
    return { a: '#232a5c', b: '#0a0e24', orb: '#e8ecff', c: '#b79cf0', x: 74, y: 24, night: true };
  }
  if (h < 8) {
    return { a: '#a16748', b: '#6d5aa8', orb: '#fff1c9', c: '#ffb86b', x, y, night: false };
  }
  if (h < 11) {
    return { a: '#3a7ba4', b: '#2c6fbe', orb: '#fff6cf', c: '#ffcf5c', x, y, night: false };
  }
  if (h < 14) {
    return { a: '#3d92e2', b: '#1f5fb4', orb: '#fffbe0', c: '#5cc0ff', x, y, night: false };
  }
  if (h < 17) {
    return { a: '#2f7abc', b: '#9c6938', orb: '#ffe9a8', c: '#6fd0c0', x, y, night: false };
  }
  if (h < 19.5) {
    return { a: '#b45d40', b: '#5d438c', orb: '#ffd9a0', c: '#ff8a65', x, y, night: false };
  }
  return { a: '#453f86', b: '#151a42', orb: '#eef0ff', c: '#b79cf0', x: 72, y: 26, night: true };
}

export function mapSvg(seed, w, h) {
  let x = 0;
  for (const ch of String(seed)) x = (x * 31 + ch.charCodeAt(0)) >>> 0;
  const r = () => (x = (x * 1664525 + 1013904223) >>> 0) / 4294967296;

  const ang = (r() - 0.5) * 36;
  const cx = w / 2,
    cy = h / 2,
    R = Math.max(w, h);
  let s = `<rect width="${w}" height="${h}" fill="var(--map-land)"/><g transform="rotate(${ang.toFixed(1)} ${cx} ${cy})">`;

  for (let i = 0; i < 9; i++) {
    s += `<rect x="${(r() * w * 1.2 - w * 0.1).toFixed(0)}" y="${(r() * h * 1.2 - h * 0.1).toFixed(0)}" width="${(26 + r() * 40).toFixed(0)}" height="${(20 + r() * 34).toFixed(0)}" rx="5" fill="var(--map-block)"/>`;
  }
  const py = h * (0.15 + r() * 0.2),
    px = w * (0.55 + r() * 0.25);
  s += `<path d="M${px.toFixed(0)} ${py.toFixed(0)}c20-14 44-6 50 12s-10 34-30 34-36-30-20-46Z" fill="var(--map-park)"/><path d="M${-R} ${(h * (0.62 + r() * 0.2)).toFixed(0)}c${(R * 0.6).toFixed(0)}-30 ${(R * 0.9).toFixed(0)} 34 ${(R * 3).toFixed(0)}-10" stroke="var(--map-water)" stroke-width="${(16 + r() * 10).toFixed(0)}" fill="none" stroke-linecap="round"/>`;

  for (let gx = -R; gx < R * 2; gx += 24 + r() * 16) {
    s += `<path d="M${gx.toFixed(0)} ${-R}L${(gx + (r() - 0.5) * 20).toFixed(0)} ${R * 2}" stroke="var(--map-road)" stroke-width="3"/>`;
  }
  for (let gy = -R; gy < R * 2; gy += 26 + r() * 18) {
    s += `<path d="M${-R} ${gy.toFixed(0)}L${R * 2} ${(gy + (r() - 0.5) * 20).toFixed(0)}" stroke="var(--map-road)" stroke-width="3"/>`;
  }
  s += `<path d="M${-R} ${(h * (0.3 + r() * 0.2)).toFixed(0)}Q${cx.toFixed(0)} ${(h * (0.1 + r() * 0.5)).toFixed(0)} ${R * 2} ${(h * (0.4 + r() * 0.2)).toFixed(0)}" stroke="var(--map-major)" stroke-width="6" fill="none"/><path d="M${(w * (0.25 + r() * 0.2)).toFixed(0)} ${-R}Q${(w * (0.2 + r() * 0.4)).toFixed(0)} ${cy.toFixed(0)} ${(w * (0.4 + r() * 0.3)).toFixed(0)} ${R * 2}" stroke="var(--map-major)" stroke-width="6" fill="none"/></g>`;
  return `<svg class="map-bg" viewBox="0 0 ${w} ${h}" preserveAspectRatio="xMidYMid slice">${s}</svg>`;
}
