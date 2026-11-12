import { WIDGET_SIZES, WIDGET_SCALE_MIN, WIDGET_SCALE_MAX, widgetSize } from './board-widgets.js';

// Stroke, highlighter and note colors come from design tokens only, so the
// draft layer, saved strokes, toolbar swatches and dark mode all agree (N-12).
export const PEN = {
  default: 'var(--ink-default)',
  accent: 'var(--ink-accent)',
  red: 'var(--ink-red)',
  orange: 'var(--ink-orange)',
  blue: 'var(--ink-blue)',
  purple: 'var(--ink-purple)',
};
export const PEN_NAMES = {
  default: '墨色',
  accent: '主题色',
  red: '红',
  orange: '橙',
  blue: '蓝',
  purple: '紫',
};
export const HL = {
  yellow: 'var(--hl-yellow)',
  green: 'var(--hl-green)',
  blue: 'var(--hl-blue)',
  pink: 'var(--hl-pink)',
};
export const HL_NAMES = { yellow: '黄', green: '绿', blue: '蓝', pink: '粉' };
export const NOTE = {
  yellow: 'var(--note-yellow)',
  green: 'var(--note-green)',
  blue: 'var(--note-blue)',
  pink: 'var(--note-pink)',
  purple: 'var(--note-purple)',
  gray: 'var(--note-gray)',
};
export const NOTE_NAMES = {
  yellow: '暖黄',
  green: '薄荷',
  blue: '晴空',
  pink: '淡粉',
  purple: '香芋',
  gray: '浅灰',
};
// Legacy note colors written by the prototype.
const NOTE_ALIASES = { mint: 'green', sky: 'blue', lavender: 'purple', orange: 'yellow' };
export function noteColor(color) {
  return NOTE[NOTE_ALIASES[color] || color] ? NOTE_ALIASES[color] || color : 'yellow';
}
export const HL_WIDTH = 16;
export const HL_OPACITY = 0.45;
export function strokeLook(tool, color, size) {
  return tool === 'highlighter'
    ? { stroke: HL[color] ?? HL.yellow, width: HL_WIDTH, opacity: HL_OPACITY }
    : { stroke: PEN[color] ?? PEN.default, width: size ?? 4, opacity: 1 };
}

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

/**
 * Fit the content into the visible part of the stage. `insets` reserves the
 * screen space covered by floating UI (the docked sticker panel), so "fit" and
 * "spawn at center" both refer to the canvas the user can actually see.
 */
export function center(items = [], viewport = { w: 1200, h: 800 }, insets = {}) {
  const { left = 0, right = 0, top = 0, bottom = 0 } = insets;
  const vw = Math.max(100, viewport.w - left - right);
  const vh = Math.max(100, viewport.h - top - bottom);
  const bounds = contentBounds(items);
  if (!bounds || bounds.w === 0 || bounds.h === 0) {
    return { x: left + vw / 2 - 200, y: top + vh / 2 - 150, k: 1 };
  }
  const pad = vw < 640 ? 32 : 90;
  const topPad = 70,
    bottomPad = 140;
  const availW = Math.max(100, vw - pad * 2);
  const availH = Math.max(100, vh - topPad - bottomPad);
  const k = Math.min(1.2, Math.max(0.2, Math.min(availW / bounds.w, availH / bounds.h)));
  const cx = bounds.x + bounds.w / 2;
  const cy = bounds.y + bounds.h / 2;
  return {
    x: left + vw / 2 - cx * k,
    y: top + topPad + (vh - topPad - bottomPad) / 2 - cy * k,
    k,
  };
}

/** Nearest dock edge for a pointer position; the panel never floats freely. */
export function nearestDock(x, y, vw, vh) {
  const d = { left: x, right: vw - x, bottom: vh - y };
  return Object.entries(d).sort((a, b) => a[1] - b[1])[0][0];
}

/** Screen-space rectangle of the stage that floating panels do not cover. */
export function visibleArea(stage = { w: 0, h: 0 }, insets = {}) {
  const { left = 0, right = 0, top = 0, bottom = 0 } = insets;
  return {
    x: left,
    y: top,
    w: Math.max(0, stage.w - left - right),
    h: Math.max(0, stage.h - top - bottom),
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

/**
 * Corner-handle scaling. `frame.w/h` is always the size seen on the board:
 * text keeps its layout and grows through `scale`, so its frame must grow with
 * it or the selection box, culling and "fit" all read the unscaled size (N-2).
 * Widgets keep their form (S/M/L) here; the edge handles change form instead.
 */
export function scaled(item, frame0, bbox0, sx, sy, anchor = 'se') {
  const type = item.content?.type;
  let w = bbox0.w;
  let h = bbox0.h;
  let scale = frame0.scale || 1;
  const s = Math.max(sx, sy);

  if (type === 'note') {
    w = clamp(bbox0.w * sx, 100, 900);
    h = clamp(bbox0.h * sy, 80, 900);
  } else if (type === 'todo') {
    w = clamp(bbox0.w * sx, 160, 900);
    h = clamp(bbox0.h * sy, 100, 1200);
  } else if (type === 'section') {
    w = clamp(bbox0.w * sx, 160, 8000);
    h = clamp(bbox0.h * sy, 100, 8000);
  } else if (type === 'widget') {
    const size = widgetSize(item);
    const base = WIDGET_SIZES[size] || [168, 168];
    w = clamp(bbox0.w * s, base[0] * WIDGET_SCALE_MIN, base[0] * WIDGET_SCALE_MAX);
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
    w: Math.round(w),
    h: Math.round(h),
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

// ---------- Web Mercator helpers for static map tiles ----------
// AMap static images use the standard 256px Web Mercator grid on GCJ-02
// coordinates, which is what places already store, so stops can be overlaid
// on the image without asking the service where it put them.
const TILE = 256;
function mercX(lng) {
  return (lng + 180) / 360;
}
function mercY(lat) {
  const s = Math.sin((clamp(lat, -85, 85) * Math.PI) / 180);
  return 0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI);
}
function invX(x) {
  return x * 360 - 180;
}
function invY(y) {
  const n = Math.PI - 2 * Math.PI * y;
  return (180 / Math.PI) * Math.atan(0.5 * (Math.exp(n) - Math.exp(-n)));
}

/**
 * Pick an integer zoom and image center so the points land inside `box`
 * (container pixels) of a `w`×`h` image. One point is placed at the box center.
 */
export function geoFit(points, box, w, h, { maxZoom = 17, singleZoom = 15 } = {}) {
  if (!points?.length) return null;
  const xs = points.map(([lng]) => mercX(lng));
  const ys = points.map(([, lat]) => mercY(lat));
  const x0 = Math.min(...xs),
    x1 = Math.max(...xs),
    y0 = Math.min(...ys),
    y1 = Math.max(...ys);
  let zoom = singleZoom;
  if (points.length > 1 && (x1 > x0 || y1 > y0)) {
    const fitX = x1 > x0 ? box.w / ((x1 - x0) * TILE) : Infinity;
    const fitY = y1 > y0 ? box.h / ((y1 - y0) * TILE) : Infinity;
    zoom = Math.floor(Math.log2(Math.min(fitX, fitY)));
  }
  zoom = clamp(zoom, 3, maxZoom);
  const world = TILE * 2 ** zoom;
  // Content center in world pixels sits at the box center; the image center is
  // offset from it by the box center's distance to the container center.
  const cx = ((x0 + x1) / 2) * world - (box.x + box.w / 2 - w / 2);
  const cy = ((y0 + y1) / 2) * world - (box.y + box.h / 2 - h / 2);
  return { lng: invX(cx / world), lat: invY(cy / world), zoom };
}

/** Project lng/lat points into container pixels of an image centered on `view`. */
export function geoProject(points, view, w, h) {
  const world = TILE * 2 ** view.zoom;
  const cx = mercX(view.lng) * world;
  const cy = mercY(view.lat) * world;
  return points.map(([lng, lat]) => [
    mercX(lng) * world - cx + w / 2,
    mercY(lat) * world - cy + h / 2,
  ]);
}

/**
 * Raster tiles covering a `w`×`h` container centered on `view`. Tiles come one
 * zoom level deeper and are drawn at half size, so they stay sharp on 2× screens.
 * Returns { x, y, z, left, top, size } in container pixels.
 */
export function geoTiles(view, w, h, { maxZoom = 18 } = {}) {
  const z = Math.min(maxZoom, view.zoom + 1);
  const size = TILE / 2 ** (z - view.zoom);
  const world = TILE * 2 ** view.zoom;
  const left0 = mercX(view.lng) * world - w / 2;
  const top0 = mercY(view.lat) * world - h / 2;
  const n = 2 ** z;
  const tiles = [];
  for (let ty = Math.floor(top0 / size); ty * size < top0 + h; ty++) {
    if (ty < 0 || ty >= n) continue;
    for (let tx = Math.floor(left0 / size); tx * size < left0 + w; tx++) {
      tiles.push({
        x: ((tx % n) + n) % n,
        y: ty,
        z,
        left: Math.round(tx * size - left0),
        top: Math.round(ty * size - top0),
        size,
      });
    }
  }
  return tiles;
}

// ---------- Sticker styles (mirrors server/model.mjs BOARD_VARIANTS) ----------
export const STYLE_VARIANTS = {
  note: [
    ['plain', '纯色'],
    ['lined', '横线'],
    ['grid', '方格'],
    ['kraft', '牛皮纸'],
    ['tape', '胶带'],
    ['torn', '撕边'],
  ],
  text: [
    ['plain', '默认'],
    ['hand', '手写'],
    ['marker', '荧光底'],
    ['outline', '描边'],
    ['label', '标签'],
  ],
  emoji: [
    ['plain', '原样'],
    ['sticker', '贴纸白边'],
    ['shadow', '投影'],
  ],
  todo: [
    ['plain', '卡片'],
    ['paper', '便签纸'],
    ['glass', '玻璃'],
  ],
  section: [
    ['plain', '浅底'],
    ['dashed', '虚线框'],
    ['solid', '实色标题'],
  ],
  // Widgets are keyed by their kind.
  countdown: [
    ['plain', '渐变'],
    ['flip', '翻页'],
    ['calendar', '日历'],
    ['ring', '圆环'],
  ],
  clock: [
    ['plain', '表盘'],
    ['digital', '数字'],
    ['minimal', '极简'],
    ['sky', '天色'],
  ],
  expense: [
    ['plain', '卡片'],
    ['receipt', '小票'],
    ['ring', '圆环'],
    ['minimal', '极简'],
  ],
};
/** Variant list for an item: widgets by kind, everything else by type. */
export function variantsFor(item) {
  const type = item?.content?.type;
  return STYLE_VARIANTS[type === 'widget' ? item.content.kind : type] || null;
}
export const IMAGE_FRAMES = [
  ['none', '无边框'],
  ['polaroid', '拍立得'],
  ['tape', '胶带'],
  ['stamp', '邮票'],
  ['circle', '圆形'],
  ['card', '卡片'],
  ['sticker', '透明贴纸'],
];
export const GALLERY_RATIOS = ['1:1', '3:4', '4:3', '16:9', '9:16', '1:2', '2:1'];
// Style fields the board may patch. Keep in sync with the style schema in
// server/model.mjs; the sync layer drops everything else before saving.
export const BOARD_STYLE_KEYS = [
  'color',
  'size',
  'frameStyle',
  'variant',
  'fontSize',
  'tilt',
  'ratio',
  'autoWidth',
  'locked',
];
/** Drop style fields the board does not know before they reach the server. */
export function cleanBoardStylePatch(stylePatch = {}) {
  const out = {};
  for (const key of BOARD_STYLE_KEYS) {
    if (stylePatch[key] !== undefined)
      out[key] = key === 'locked' ? Boolean(stylePatch[key]) : stylePatch[key];
  }
  return out;
}
export function ratioValue(ratio = '1:1') {
  const [a, b] = String(ratio).split(':').map(Number);
  return a > 0 && b > 0 ? a / b : 1;
}
/** Frame for a gallery of width `w` at `ratio` (w / h). Polaroid adds a caption strip. */
// Border of each gallery frame style (top, right, bottom, left); the photo
// window inside keeps the chosen ratio.
export const GALLERY_PADDING = {
  none: [0, 0, 0, 0],
  tape: [0, 0, 0, 0],
  card: [6, 6, 6, 6],
  polaroid: [8, 8, 30, 8],
};
export function galleryFrameSize(w, ratio, frameStyle = 'none') {
  const [pt, pr, pb, pl] = GALLERY_PADDING[frameStyle] || GALLERY_PADDING.none;
  const inner = Math.max(40, w - pl - pr);
  return { w: Math.round(w), h: Math.round(inner / ratioValue(ratio) + pt + pb) };
}
/**
 * Angle an item is drawn at. Older stickers kept a decorative `style.tilt`;
 * rotation replaced it, so a tilt still shows until the item is rotated.
 */
export function itemRotation(item) {
  const r = item?.frame?.rotation || 0;
  return r || item?.style?.tilt || 0;
}

export function assetUrl(tripId, assetId, variant = 'full') {
  const base = (import.meta.env?.BASE_URL ?? '/').replace(/\/?$/, '/');
  return `${base}api/trips/${tripId}/assets/${assetId}?variant=${variant}`;
}
export function stickerUrl(stickerId) {
  const base = (import.meta.env?.BASE_URL ?? '/').replace(/\/?$/, '/');
  return `${base}api/me/stickers/${stickerId}`;
}
