#!/usr/bin/env node
// Shared fixtures for the native clients (docs/设计文档/11-原生端功能对齐.md §4).
//
// Runs the web client's pure functions on fixed inputs and writes every call
// and its result to mobile/fixtures/*.json. The Android and iOS unit tests
// replay each case through their own port and must produce the same result,
// so the three clients follow one set of rules instead of three readings of it.
//
//   node mobile/tools/generate-fixtures.mjs          regenerate the files
//   node mobile/tools/generate-fixtures.mjs --check  exit 1 if a file is stale
//
// Case format: { fn, args, result } or { fn, args, error: { message, code } }; files with
// several modules add `module`. An arg "$snapshot" means the file's top-level `snapshot`;
// "$fn:simplify" means the port of board.js `simplify` passed as a callback.
// `args` and `result` are JSON (undefined becomes null; object fields that are
// undefined are left out). Compare numbers with a tolerance of 1e-9.
import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import * as rich from '../../app/src/rich-text.js';
import * as board from '../../app/src/board.js';
import * as geo from '../../app/src/board-geometry.js';
import * as widgets from '../../app/src/board-widgets.js';
import * as domain from '../../app/src/domain.js';
import * as expenses from '../../app/src/expenses.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const outDir = path.resolve(here, '..', 'fixtures');
const json = (value) => {
  const text = JSON.stringify(value);
  return text === undefined ? null : JSON.parse(text);
};

// Large shared inputs (the trip snapshots) are written once at the top of a file
// and referenced from cases as "$<name>"; native tests resolve the reference.
const refs = new Map();
const ref = (name, value) => (refs.set(value, `$${name}`), value);

function recorder(module, source) {
  const cases = [];
  const call = (fn, ...args) => {
    if (typeof module[fn] !== 'function') throw new Error(`${source} does not export ${fn}`);
    const input = args.map((a) =>
      refs.has(a) ? refs.get(a) : typeof a === 'function' ? `$fn:${a.name}` : json(a),
    );
    try {
      const result = module[fn](
        ...args.map((a) => (typeof a === 'function' ? a : structuredClone(a))),
      );
      cases.push({ fn, args: input, result: json(result) });
      return result;
    } catch (error) {
      cases.push({ fn, args: input, error: { message: error.message, code: error.code ?? null } });
      return undefined;
    }
  };
  return { cases, call };
}

const header = (sources, note) => ({
  $comment:
    '由 mobile/tools/generate-fixtures.mjs 从网页端代码生成，不要手改。网页端函数改动后重新运行该脚本。' +
    (note ? ' ' + note : ''),
  sources,
});

// ---------------------------------------------------------------------------
// A trip snapshot shared by the itinerary and widget fixtures. It deliberately
// contains the awkward cases: a deleted day and activity, a route whose fromId
// no longer matches, favorites with and without a preset mark, foreign
// currencies, a deleted expense and a `board` object old clients do not know.
// ---------------------------------------------------------------------------
const obj = (id, kind, payload, extra = {}) => ({
  id,
  tripId: 'trip-1',
  kind,
  state: 'active',
  generation: 1,
  clocks: {},
  payload,
  ...extra,
});
const place = (name, lng, lat, extra = {}) => ({
  name,
  address: '',
  lng,
  lat,
  provider: 'amap',
  providerPlaceId: null,
  category: '',
  sourceUrl: '',
  fetchedAt: null,
  coordSystem: 'GCJ-02',
  ...extra,
});
const time = (mode, start = null, end = null, period = '') => ({
  mode,
  period,
  start,
  end,
  endDayOffset: 0,
});
const SNAPSHOT = ref('snapshot', {
  trip: {
    id: 'trip-1',
    name: '杭州三日',
    destination: '杭州',
    startDate: '2026-12-01',
    endDate: '2026-12-03',
    dayCount: 3,
    timezone: 'Asia/Shanghai',
    currency: 'CNY',
    teamMode: 'equal',
    ownerId: 'u1',
    state: 'active',
  },
  members: [
    { userId: 'u1', displayName: 'Alice', isAdmin: true },
    { userId: 'u2', displayName: 'Bob', isAdmin: false },
  ],
  objects: [
    obj('day-1', 'day', { ordinal: 1, date: '2026-12-01' }),
    obj('day-2', 'day', { ordinal: 2, date: '2026-12-02' }),
    obj('day-3', 'day', { ordinal: 3, date: '2026-12-03' }, { state: 'deleted' }),
    obj('day-x', 'day', { ordinal: 4, date: null }),
    // day-1: stored order differs from time order on purpose.
    obj('act-1', 'activity', {
      title: '断桥残雪',
      dayId: 'day-1',
      order: 3,
      time: time('precise', '09:00', '10:30'),
      place: place('断桥残雪', 120.1517, 30.2615),
      buffers: { before: 15, after: null },
      notes: '早上去人少',
      url: '',
    }),
    obj('act-2', 'activity', {
      title: '平湖秋月',
      dayId: 'day-1',
      order: 1,
      time: time('flexible', null, null, '上午'),
      place: place('平湖秋月', 120.1452, 30.2551),
      buffers: { before: null, after: null },
      notes: '',
      url: '',
    }),
    obj('act-3', 'activity', {
      title: '楼外楼午餐',
      dayId: 'day-1',
      order: 2,
      time: time('precise', '08:30', '09:00'),
      place: place('楼外楼', 120.1446, 30.2532),
      buffers: { before: null, after: 10 },
      notes: '',
      url: 'https://example.test/menu',
    }),
    obj('act-4', 'activity', {
      title: '雷峰塔夜景',
      dayId: 'day-1',
      order: 4,
      time: time('precise', '19:00', '21:00'),
      place: null,
      buffers: { before: null, after: null },
      notes: '',
      url: '',
    }),
    obj(
      'act-5',
      'activity',
      {
        title: '已删除的安排',
        dayId: 'day-1',
        order: 5,
        time: time('flexible'),
        place: null,
        buffers: { before: null, after: null },
        notes: '',
        url: '',
      },
      { state: 'deleted' },
    ),
    obj('act-6', 'activity', {
      title: '灵隐寺',
      dayId: 'day-2',
      order: 1,
      time: time('precise', '23:00', '01:00'),
      place: place('灵隐寺', 120.1012, 30.2408),
      buffers: { before: null, after: null },
      notes: '',
      url: '',
    }),
    obj('act-7', 'activity', {
      title: '被删除那天的安排',
      dayId: 'day-3',
      order: 1,
      time: time('flexible'),
      place: place('西溪湿地', 120.0726, 30.2726),
      buffers: { before: null, after: null },
      notes: '',
      url: '',
    }),
    // Routes are matched by fromId AND toId; route-stale points at act-2 from
    // an activity that is no longer right before it.
    obj('route-1', 'route', {
      fromId: 'act-3',
      toId: 'act-1',
      mode: 'walking',
      minutes: 12,
      distance: 900,
    }),
    obj('route-stale', 'route', {
      fromId: 'act-6',
      toId: 'act-2',
      mode: 'driving',
      minutes: 40,
      distance: 15000,
    }),
    obj('preset-food', 'markPreset', { icon: 'circle', color: 'coral', name: '必吃', order: 1 }),
    obj('preset-view', 'markPreset', { icon: 'triangle', color: 'blue', name: '机位', order: 2 }),
    obj('preset-empty', 'markPreset', {
      icon: 'square',
      color: 'purple',
      name: '没人用',
      order: 3,
    }),
    obj('fav-1', 'favorite', {
      ...place('知味观', 120.1601, 30.2575, { category: '餐饮' }),
      mark: { icon: 'circle', color: 'coral' },
    }),
    obj('fav-2', 'favorite', {
      ...place('宝石山', 120.1468, 30.2654, { category: '景点' }),
      mark: { icon: 'triangle', color: 'blue' },
    }),
    obj('fav-3', 'favorite', place('西泠印社', 120.1405, 30.2575, { category: '景点' })),
    obj(
      'fav-4',
      'favorite',
      { ...place('已删除收藏', 120.15, 30.25), mark: { icon: 'circle', color: 'coral' } },
      { state: 'deleted' },
    ),
    obj('exp-1', 'expense', {
      title: '',
      activityId: 'act-3',
      date: null,
      payment: { status: 'paid', currency: 'CNY', amountMinor: 38000 },
    }),
    obj('exp-2', 'expense', {
      title: '游船票',
      activityId: null,
      date: '2026-12-02',
      payment: { status: 'estimated', currency: 'CNY', amountMinor: 10000 },
    }),
    obj('exp-3', 'expense', {
      title: '外币咖啡',
      activityId: null,
      date: '2026-12-01',
      payment: { status: 'paid', currency: 'USD', amountMinor: 1500 },
    }),
    obj('exp-4', 'expense', {
      title: '',
      activityId: 'act-7',
      date: null,
      payment: { status: 'paid', currency: 'JPY', amountMinor: 1200 },
    }),
    obj(
      'exp-5',
      'expense',
      {
        title: '已删除费用',
        activityId: null,
        date: '2026-12-01',
        payment: { status: 'paid', currency: 'CNY', amountMinor: 999 },
      },
      { state: 'deleted' },
    ),
    obj('default-board', 'board', { title: '主白板', order: 0, background: 'dots' }),
    obj(
      'board-old',
      'board',
      { title: '已删除的白板', order: 1, background: 'grid' },
      { state: 'deleted' },
    ),
  ],
  cursor: 42,
  epoch: 7,
});

// ---------------------------------------------------------------------------
// rich-text.json
// ---------------------------------------------------------------------------
function richTextFixture() {
  const { cases, call } = recorder(rich, 'app/src/rich-text.js');
  const html = [
    '',
    '纯文本',
    '<b>粗</b><i>斜</i><u>下划线</u><s>删除线</s>',
    '<strong>粗</strong><em>斜</em><strike>删</strike>',
    '<B>大写标签</B><I>斜</I>',
    '<p>段落</p><div>块</div>',
    '第一行<br>第二行<br/>第三行<br />',
    '<div style="text-align: center">居中</div><div data-align="right">靠右</div>',
    '<li style="text-align:left">列表对齐</li><span style="text-align:center">不保留</span>',
    '<ul><li>一</li><li>二</li></ul><ol><li>甲</li></ol>',
    '<ul data-list="check"><li data-checked="true">已完成</li><li>未完成</li></ul>',
    '<ul data-list="other"><li data-checked="yes">非法值</li></ul>',
    '<span data-color="red">红</span><span data-color="accent">主题色</span>',
    '<span data-color="green">不在调色板</span><span style="color:red">自由颜色</span>',
    '<font color="#000001" data-color="blue">font 改成 span</font>',
    '<span onclick="alert(1)" class="x" id="y">去掉事件和类名</span>',
    '<script>alert(1)</script>保留',
    '<style>b{color:red}</style><iframe src="x"></iframe><template><b>x</b></template>后面',
    '<a href="javascript:alert(1)">链接文字</a>',
    '<img src="x" onerror="alert(1)">图片之后',
    '<table><tr><td>表格</td></tr></table>',
    'a < b && c > d',
    '&lt;已转义&gt; &amp; &nbsp; &#39; &#x27; &copy',
    '<!-- 注释 -->注释之后',
    '<b><i>交叉</b>嵌套</i>',
    '<div>未闭合<b>粗',
    '</b>多余的结束标签',
    '<b>表情 🎉 与中文 混排</b>',
    '<div><br></div><div>空行之后</div>',
    '<span data-color="purple"><b>颜色里加粗</b></span>',
  ];
  for (const h of html) call('sanitizeRichText', h);
  for (const h of html) call('richTextToPlain', h);
  for (const t of ['', '一行', '两行\n第二行', '<标签> & "引号"', '多个\n\n\n\n空行'])
    call('plainToRichText', t);
  return {
    ...header(['app/src/rich-text.js']),
    noteTextColors: json(rich.NOTE_TEXT_COLORS),
    cases,
  };
}

// ---------------------------------------------------------------------------
// board-geometry.json (app/src/board.js + app/src/board-geometry.js)
// ---------------------------------------------------------------------------
function boardGeometryFixture() {
  const b = recorder(board, 'app/src/board.js');
  const g = recorder(geo, 'app/src/board-geometry.js');
  const view = { x: 120, y: -40, k: 0.8 };
  b.call('toWorld', { x: 0, y: 0 }, view);
  b.call('toWorld', { x: 400, y: 300 }, view);
  b.call('toScreen', { x: 100, y: 50 }, view);
  b.call('toScreen', { x: -250, y: 1200 }, { x: 0, y: 0, k: 1.44 });

  const items = [
    { id: 'a', state: 'active', z: 3, frame: { x: 0, y: 0, w: 200, h: 150 } },
    { id: 'b', state: 'active', z: -2, frame: { x: 400, y: 220, w: 100, h: 80 } },
    { id: 'c', state: 'deleted', z: 99, frame: { x: 5000, y: 5000, w: 10, h: 10 } },
    { id: 'd', state: 'active', frame: { x: -120, y: 60, w: 50, h: 0 } },
  ];
  b.call('contentBounds', []);
  b.call('contentBounds', items);
  b.call('contentBounds', [items[2]]);
  b.call('center', [], { w: 1200, h: 800 });
  b.call('center', items, { w: 1200, h: 800 });
  b.call('center', items, { w: 390, h: 844 }, { top: 60, bottom: 120 });
  b.call('center', items, { w: 1440, h: 900 }, { left: 360 }, 1);
  b.call('center', [items[0]], { w: 600, h: 500 }, {}, 3);
  b.call('topZ', []);
  b.call('topZ', items);
  b.call('bottomZ', []);
  b.call('bottomZ', items);
  b.call('visibleArea', { w: 1200, h: 800 }, { left: 300, bottom: 80 });

  const wave = Array.from({ length: 40 }, (_, i) => [
    i * 5,
    Math.round(Math.sin(i / 4) * 40 * 100) / 100,
  ]);
  b.call('simplify', []);
  b.call('simplify', [
    [0, 0],
    [10, 10],
  ]);
  b.call('simplify', [
    [0, 0],
    [5, 0.2],
    [10, 0],
    [15, 0.3],
    [20, 0],
  ]);
  b.call('simplify', wave);
  b.call('simplify', wave, 0.35);
  b.call('simplify', wave, 8);

  const frame0 = { x: 100, y: 100, w: 200, h: 160, rotation: 0, scale: 1 };
  for (const [type, extra] of [
    ['note', {}],
    ['todo', {}],
    ['section', {}],
    ['text', {}],
    ['emoji', {}],
    ['image', {}],
    ['gallery', { ratio: '4:3' }],
    ['stroke', {}],
    ['shape', {}],
    ['widget', { kind: 'day' }],
    ['link', {}],
  ]) {
    const item = { content: { type, ...extra }, frame: frame0, style: {} };
    for (const [sx, sy, anchor] of [
      [1.5, 1.5, 'se'],
      [0.3, 0.3, 'nw'],
      [2, 1, 'e'],
      [1, 0.5, 's'],
      [6, 6, 'ne'],
    ])
      b.call(
        'scaled',
        item,
        frame0,
        { x: frame0.x, y: frame0.y, w: frame0.w, h: frame0.h },
        sx,
        sy,
        anchor,
      );
  }
  b.call('cleanBoardStylePatch', {});
  b.call('cleanBoardStylePatch', {
    color: 'yellow',
    size: 'M',
    locked: 1,
    tilt: -3,
    unknown: 'drop me',
    fill: '#fff',
    mapStyle: 'ink',
  });
  b.call('cleanBoardStylePatch', { locked: 0, ratio: '16:9', autoWidth: true, variant: 'tape' });
  b.call('nextBoardStyle', { color: 'yellow' }, {});
  b.call('nextBoardStyle', { color: 'yellow' }, { style: { size: 'L' } });
  b.call(
    'nextBoardStyle',
    { color: 'yellow', size: 'L' },
    { style: { size: 'S' } },
    { replace: true },
  );
  b.call('nextBoardStyle', { color: 'yellow' }, { locked: 'yes' });
  b.call('ratioValue', '4:3');
  b.call('ratioValue', 'bad');
  b.call('ratioValue');

  const tilted = { x: 10, y: 20, w: 120, h: 80, rotation: 30 };
  g.call('normalizeAngle', 0);
  g.call('normalizeAngle', 190);
  g.call('normalizeAngle', -180);
  g.call('normalizeAngle', 540.04);
  g.call('normalizeAngle', -725.55);
  g.call('frameCenter', tilted);
  g.call('rotatePoint', { x: 10, y: 0 }, { x: 0, y: 0 }, 90);
  g.call('rotatePoint', { x: 3, y: 4 }, { x: 1, y: 1 }, -45);
  g.call('rotatePoint', { x: 3, y: 4 }, { x: 1, y: 1 }, 0);
  g.call('toLocal', { x: 70, y: 60 }, tilted);
  g.call('frameCorners', tilted);
  g.call('frameBounds', { x: 0, y: 0, w: 100, h: 50 });
  g.call('frameBounds', tilted);
  g.call('unionBounds', []);
  g.call('unionBounds', [
    { x: 0, y: 0, w: 10, h: 10 },
    { x: -5, y: 20, w: 3, h: 4 },
  ]);
  g.call('groupBounds', [{ x: 0, y: 0, w: 10, h: 10, rotation: 45 }, tilted]);
  g.call('intersects', { x: 0, y: 0, w: 10, h: 10 }, { x: 10, y: 10, w: 5, h: 5 });
  g.call('intersects', { x: 0, y: 0, w: 10, h: 10 }, { x: 9, y: 9, w: 5, h: 5 });
  g.call('overlapShare', { x: 0, y: 0, w: 100, h: 100 }, { x: 50, y: 50, w: 100, h: 100 });
  g.call('overlapShare', { x: 0, y: 0, w: 100, h: 100 }, { x: 0, y: 0, w: 0, h: 0 });
  g.call('inSection', { x: 0, y: 0, w: 300, h: 300 }, { x: 100, y: 100, w: 400, h: 100 });
  g.call('inSection', { x: 0, y: 0, w: 300, h: 300 }, { x: 250, y: 0, w: 200, h: 100 });
  g.call('inSection', { x: 0, y: 0, w: 300, h: 300 }, { x: 10, y: 10, w: 20, h: 20 }, true);
  g.call('contains', { x: 0, y: 0, w: 100, h: 100 }, { x: 10, y: 10, w: 20, h: 20 });
  g.call('contains', { x: 0, y: 0, w: 100, h: 100 }, { x: 90, y: 90, w: 20, h: 20 });
  g.call('rectFrom', { x: 50, y: 10 }, { x: 5, y: 80 });
  for (const anchor of ['se', 'nw', 'e', 'n'])
    g.call('keepAnchor', tilted, { ...tilted, w: 180, h: 100 }, anchor);
  g.call('keepAnchor', { ...tilted, rotation: 0 }, { ...tilted, rotation: 0, w: 180 }, 'se');
  g.call('handleAngle', { x: 0, y: 0 }, { x: 10, y: -10 });
  g.call('handleAngle', { x: 0, y: 0 }, { x: -3, y: 4 });
  for (const deg of [0, 3, 44, 46, 89.6, -91, 178]) {
    g.call('snapAngle', deg);
    g.call('snapAngle', deg, true);
  }
  g.call(
    'rotateFrames',
    {
      a: { x: 0, y: 0, w: 100, h: 50, rotation: 0 },
      b: { x: 200, y: 0, w: 40, h: 40, rotation: 10 },
    },
    { x: 120, y: 25 },
    90,
  );
  for (const r of ['1:1', '16:9', '9:16', 'x']) g.call('ratioNumber', r);
  for (const v of [0.4, 0.55, 0.74, 1, 1.2, 1.4, 1.7, 2.5]) g.call('snapRatio', v);
  g.call('finalizeStroke', wave, board.simplify);
  g.call(
    'finalizeStroke',
    Array.from({ length: 1500 }, (_, i) => [i, Math.round(Math.sin(i / 3) * 30 * 100) / 100]),
    board.simplify,
    1000,
  );
  g.call(
    'scaleStrokePoints',
    [
      [0, 0],
      [10, 20],
      [33.33, 7],
    ],
    { w: 100, h: 50 },
    { w: 150, h: 25 },
  );
  g.call('scaleStrokePoints', [[1, 2]], { w: 100, h: 50 }, { w: 100, h: 50 });
  const others = [
    { x: 300, y: 0, w: 100, h: 100 },
    { x: 0, y: 400, w: 120, h: 60 },
    { x: 1000, y: 1000, w: 50, h: 50 },
  ];
  g.call('snapToGuides', { x: 3, y: 150, w: 100, h: 80 }, others, 6);
  g.call('snapToGuides', { x: 296, y: 150, w: 100, h: 80 }, others, 6, 240);
  g.call('snapToGuides', { x: 500, y: 500, w: 10, h: 10 }, others, 6, 240);
  const frames = {
    a: { x: 0, y: 0, w: 100, h: 50 },
    b: { x: 160, y: 40, w: 60, h: 90, rotation: 20 },
    c: { x: 300, y: 10, w: 80, h: 30 },
  };
  for (const mode of ['left', 'hcenter', 'right', 'top', 'vcenter', 'bottom', 'hspace', 'vspace'])
    g.call('alignFrames', frames, mode);
  g.call(
    'rebaseBox',
    { x: 10, y: 10, w: 20, h: 20 },
    { x: 0, y: 0, w: 100, h: 100 },
    { x: 50, y: 0, w: 200, h: 50 },
  );
  g.call('segmentDistance', 0, 0, 10, 0, 5, 5, 5, 10);
  g.call('segmentDistance', 0, 0, 10, 0, 5, -1, 5, 1);
  const stroke = {
    frame: { x: 100, y: 100, w: 200, h: 100, rotation: 15 },
    content: {
      type: 'stroke',
      points: [
        [0, 0],
        [100, 50],
        [200, 100],
      ],
    },
  };
  g.call('strokeHit', stroke, { x: 190, y: 150 }, { x: 210, y: 150 }, 8);
  g.call('strokeHit', stroke, { x: 0, y: 0 }, { x: 10, y: 10 }, 8);
  g.call(
    'strokeHit',
    { frame: stroke.frame, content: { points: [] } },
    { x: 0, y: 0 },
    { x: 1, y: 1 },
    8,
  );

  return {
    ...header(['app/src/board.js', 'app/src/board-geometry.js']),
    constants: {
      DEFAULT_ZOOM: board.DEFAULT_ZOOM,
      BOARD_STYLE_KEYS: json(board.BOARD_STYLE_KEYS),
      GALLERY_RATIOS: json(board.GALLERY_RATIOS),
      GALLERY_SNAP_RATIOS: json(geo.GALLERY_SNAP_RATIOS),
      HL_WIDTH: board.HL_WIDTH,
      HL_OPACITY: board.HL_OPACITY,
    },
    cases: [
      ...b.cases.map((c) => ({ module: 'board', ...c })),
      ...g.cases.map((c) => ({ module: 'board-geometry', ...c })),
    ],
  };
}

// ---------------------------------------------------------------------------
// board-widgets.json
// ---------------------------------------------------------------------------
function boardWidgetsFixture() {
  const { cases, call } = recorder(widgets, 'app/src/board-widgets.js');
  const item = (kind, fields, size, extra = {}) => ({
    content: { type: 'widget', kind, ...fields },
    style: size ? { size } : {},
    frame: { x: 0, y: 0, w: 168, h: 168, rotation: 0, scale: 1 },
    ...extra,
  });
  const items = [
    item('activity', { activityId: 'act-1' }, 'S'),
    item('activity', { activityId: 'act-2' }, 'M'),
    item('activity', { activityId: 'act-4' }, 'M'),
    item('activity', { activityId: 'act-5' }, 'S'),
    item('activity', { activityId: 'act-7' }, 'S'),
    item('activity', { activityId: 'missing' }, 'S'),
    item('activity', { activityId: 'act-1' }, 'L'),
    item('day', { dayId: 'day-1' }, 'S'),
    item('day', { dayId: 'day-1' }, 'M'),
    item('day', { dayId: 'day-1' }, 'L'),
    item('day', { dayId: 'day-2' }, 'M'),
    item('day', { dayId: 'day-3' }, 'M'),
    item('day', { dayId: 'day-x' }, 'S'),
    item('route', { dayId: 'day-1' }, 'M'),
    item('route', { dayId: 'day-1' }, 'L'),
    item('route', { dayId: 'day-2' }, 'M'),
    item('place', { favoriteId: 'fav-1' }, 'S'),
    item('place', { favoriteId: 'fav-3' }, 'M'),
    item('place', { favoriteId: 'fav-4' }, 'S'),
    item('place', { favoriteId: 'fav-2' }, 'M', { linkedActivityId: 'act-1' }),
    item('places', { mark: { icon: 'circle', color: 'coral' } }, 'M'),
    item('places', { mark: { icon: 'triangle', color: 'blue' } }, 'L'),
    item('places', { mark: { icon: 'square', color: 'purple' } }, 'M'),
    item('countdown', {}, 'S'),
    item('countdown', {}, 'M'),
    item('clock', {}, 'S'),
    item('clock', {}, 'M'),
    item('expense', {}, 'S'),
    item('expense', {}, 'M'),
    item('unknown-kind', {}, 'S'),
  ];
  const moments = [
    { now: Date.parse('2026-11-20T02:00:00Z'), deviceTimeZone: 'Asia/Shanghai' },
    { now: Date.parse('2026-12-01T03:30:00Z'), deviceTimeZone: 'Europe/Paris' },
    { now: Date.parse('2026-12-02T15:00:00Z'), deviceTimeZone: 'UTC' },
    { now: Date.parse('2026-12-10T10:00:00Z'), deviceTimeZone: 'Asia/Shanghai' },
  ];
  for (const it of items) {
    call('widgetSize', it);
    call('widgetScale', it);
    call('widgetEdgeHandles', it);
    call('widgetDeps', SNAPSHOT, it);
  }
  for (const it of items) {
    const timeDependent = ['countdown', 'clock', 'expense', 'day', 'activity'].includes(
      it.content.kind,
    );
    for (const options of timeDependent ? moments : moments.slice(1, 2))
      call('widgetModel', SNAPSHOT, it, options);
  }
  const undated = ref('undatedSnapshot', {
    ...SNAPSHOT,
    trip: { ...SNAPSHOT.trip, startDate: null, endDate: null },
  });
  call('widgetModel', undated, item('countdown', {}, 'S'), moments[0]);
  call('placeGroups', SNAPSHOT);
  call('placeGroups', { objects: [] });
  call('markGroupName', { key: 'unsorted', mark: null, name: '未分类' });
  call('markGroupName', {
    key: 'circle:coral',
    mark: { icon: 'circle', color: 'coral' },
    name: '',
  });
  for (const [kind, w, h, prev, axis] of [
    ['day', 360, 170, 'S', 'x'],
    ['day', 200, 200, 'M', 'x'],
    ['day', 352, 360, 'M', 'y'],
    ['route', 352, 200, 'L', 'y'],
    ['activity', 400, 168, 'S', 'x'],
  ])
    call('pickWidgetSize', kind, w, h, prev, axis);
  return {
    ...header(
      ['app/src/board-widgets.js'],
      'widgetModel 的结果按旅程目的地时区计算，deviceTimeZone 只影响时钟的对照行。',
    ),
    constants: {
      WIDGET_SIZES: json(widgets.WIDGET_SIZES),
      WIDGET_KINDS: json(widgets.WIDGET_KINDS),
      WIDGET_SCALE_MIN: widgets.WIDGET_SCALE_MIN,
      WIDGET_SCALE_MAX: widgets.WIDGET_SCALE_MAX,
      UNSORTED_KEY: widgets.UNSORTED_KEY,
    },
    snapshot: SNAPSHOT,
    undatedSnapshot: undated,
    cases,
  };
}

// ---------------------------------------------------------------------------
// itinerary.json (app/src/domain.js + app/src/expenses.js)
// ---------------------------------------------------------------------------
function itineraryFixture() {
  const d = recorder(domain, 'app/src/domain.js');
  const e = recorder(expenses, 'app/src/expenses.js');
  for (const dayId of ['day-1', 'day-2', 'day-3', 'day-x', 'missing'])
    d.call('orderedActivities', SNAPSHOT, dayId);
  d.call('visibleDays', SNAPSHOT);
  d.call('outsideDays', SNAPSHOT);
  for (const day of SNAPSHOT.objects.filter((o) => o.kind === 'day'))
    d.call('dayLabel', day, SNAPSHOT.trip);
  for (const p of [
    { time: time('precise', '09:00', '10:30') },
    { time: time('precise', '23:00', '01:00') },
    { time: { ...time('precise', '22:00', '02:00'), endDayOffset: 1 } },
    { time: time('precise', '07:15') },
    { time: time('flexible', null, null, '下午') },
    { time: time('flexible') },
    {},
  ])
    d.call('timeLabel', p);
  for (const v of ['00:00', '09:05', '23:59', '', null, '7:3']) d.call('minutesOf', v);
  for (const v of [0, 5, 59, 60, 61, 125, 1440, null]) d.call('formatMinutes', v);
  for (const c of ['CNY', 'USD', 'JPY', 'KRW', 'EUR', 'XXX']) d.call('currencyFactor', c);
  for (const [a, c] of [
    [38000, 'CNY'],
    [1500, 'USD'],
    [1200, 'JPY'],
    [0, 'CNY'],
    [-250, 'CNY'],
  ])
    d.call('money', a, c);
  for (const [v, n] of [
    ['2026-12-01', 1],
    ['2026-12-31', 1],
    ['2026-03-01', -1],
    ['2028-02-28', 2],
  ])
    d.call('dateAdd', v, n);
  d.call('dateRangeDays', '2026-12-01', '2026-12-03');
  d.call('dateRangeDays', '2026-12-03', '2026-12-01');
  d.call('dateRangeDays', 'bad', '2026-12-01');
  d.call('planDayId', 'trip-1', { date: '2026-12-01', ordinal: 1 });
  d.call('planDayId', 'trip-1', { ordinal: 4 });
  const acts = Object.fromEntries(
    SNAPSHOT.objects.filter((o) => o.kind === 'activity').map((o) => [o.id, o]),
  );
  d.call('endpointSignature', acts['act-3'], acts['act-1']);
  d.call('routeSignature', acts['act-3'], acts['act-1'], 'walking');
  d.call(
    'travelAdvice',
    acts['act-3'],
    acts['act-1'],
    SNAPSHOT.objects.find((o) => o.id === 'route-1'),
  );
  d.call('travelAdvice', acts['act-2'], acts['act-1'], null);
  d.call(
    'activityOrderPlan',
    SNAPSHOT,
    { dayId: 'day-1', time: time('precise', '12:00') },
    'new-act',
  );
  d.call(
    'activityOrderPlan',
    SNAPSHOT,
    { dayId: 'day-1', time: time('flexible', null, null, '晚上') },
    'act-2',
  );
  d.call('activityOrderPlan', SNAPSHOT, { dayId: 'day-2', time: time('flexible') }, 'act-1');
  for (const ex of SNAPSHOT.objects.filter((o) => o.kind === 'expense')) {
    e.call('linkedExpenseActivity', SNAPSHOT, ex);
    e.call('expenseDate', SNAPSHOT, ex);
    e.call('expenseTitle', SNAPSHOT, ex);
  }
  for (const date of ['2026-12-01', '2026-12-05', null]) e.call('expenseDateLabel', SNAPSHOT, date);
  return {
    ...header(['app/src/domain.js', 'app/src/expenses.js']),
    snapshot: SNAPSHOT,
    cases: [
      ...d.cases.map((c) => ({ module: 'domain', ...c })),
      ...e.cases.map((c) => ({ module: 'expenses', ...c })),
    ],
  };
}

// ---------------------------------------------------------------------------
const files = {
  'rich-text.json': richTextFixture(),
  'board-geometry.json': boardGeometryFixture(),
  'board-widgets.json': boardWidgetsFixture(),
  'itinerary.json': itineraryFixture(),
};

const check = process.argv.includes('--check');
let stale = 0;
for (const [name, data] of Object.entries(files)) {
  const file = path.join(outDir, name);
  const text = JSON.stringify(data, null, 2) + '\n';
  if (check) {
    const current = await readFile(file, 'utf8').catch(() => '');
    if (current !== text) {
      stale++;
      console.error(
        `mobile/fixtures/${name} 与网页端代码不一致，请运行 node mobile/tools/generate-fixtures.mjs`,
      );
    }
  } else {
    await writeFile(file, text);
    console.log(`mobile/fixtures/${name}: ${data.cases.length} cases`);
  }
}
if (check) {
  if (stale) process.exit(1);
  console.log('Native fixtures match the web client.');
}
