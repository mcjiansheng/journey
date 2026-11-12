import test from 'node:test';
import assert from 'node:assert/strict';
import { sanitizeRichText, richTextToPlain, plainToRichText } from '../src/rich-text.js';
import { placeGroups, markGroupName, widgetModel, widgetDeps } from '../src/board-widgets.js';
import {
  galleryFrameSize,
  GALLERY_PADDING,
  itemRotation,
  variantsFor,
  ratioValue,
  STYLE_VARIANTS,
  IMAGE_FRAMES,
  cleanBoardStylePatch,
} from '../src/board.js';
import { EMOJI_GROUPS, EMOJI_ZH } from '../src/emoji-data.js';
import { BOARD_VARIANTS, IMAGE_FRAMES as SERVER_FRAMES, GALLERY_RATIOS } from '../server/model.mjs';

test('rich text: keeps the formatting the note bar makes and nothing else', () => {
  const out = sanitizeRichText(
    '<div style="text-align:center"><strong>粗</strong><em>斜</em><u>下</u><strike>删</strike></div>' +
      '<ul data-list="check"><li data-checked="true">a</li><li>b</li></ul>' +
      '<ol><li>1</li></ol><span data-color="red">红</span><span data-color="javascript:x">x</span>' +
      '<img src=x onerror=alert(1)><script>alert(2)</script><a href="javascript:alert(3)">link</a>' +
      '<p onclick="evil()">p</p>',
  );
  assert.match(out, /<div data-align="center"><b>粗<\/b><i>斜<\/i><u>下<\/u><s>删<\/s><\/div>/);
  assert.match(out, /<ul data-list="check"><li data-checked="true">a<\/li><li>b<\/li><\/ul>/);
  assert.match(out, /<ol><li>1<\/li><\/ol>/);
  assert.match(out, /<span data-color="red">红<\/span>/);
  assert.doesNotMatch(out, /javascript|onerror|onclick|<img|<script|alert\(2\)|<a\b/);
  assert.match(out, /link/);
});

test('rich text: plain text round trip and escaping', () => {
  const html = plainToRichText('第一行\n<b>不是粗体</b> & 继续');
  assert.doesNotMatch(html, /<b>/);
  assert.equal(richTextToPlain(html), '第一行\n<b>不是粗体</b> & 继续');
  assert.equal(richTextToPlain(sanitizeRichText('<div>a</div><div>b</div>')), 'a\nb');
});

const fav = (id, name, mark, extra = {}) => ({
  id,
  kind: 'favorite',
  state: 'active',
  payload: { name, lng: 117 + Math.random(), lat: 31, mark, ...extra },
});
const snapshot = {
  trip: { id: 't', timezone: 'Asia/Shanghai' },
  objects: [
    {
      id: 'p2',
      kind: 'markPreset',
      state: 'active',
      payload: { name: '美食', icon: 'food', color: 'amber', order: 1 },
    },
    {
      id: 'p1',
      kind: 'markPreset',
      state: 'active',
      payload: { name: '想去', icon: 'heart', color: 'rose', order: 0 },
    },
    fav('f1', '包公园', { icon: 'heart', color: 'rose' }),
    fav('f2', '淮河路', { icon: 'food', color: 'amber' }),
    fav('f3', '李府', { icon: 'heart', color: 'rose' }),
    fav('f4', '无标记', undefined, { lng: null, lat: null }),
    { ...fav('f5', '已删除', { icon: 'heart', color: 'rose' }), state: 'deleted' },
  ],
};

test('places: only presets make a category, everything else is 未分类', () => {
  const groups = placeGroups(snapshot);
  assert.deepEqual(
    groups.map((g) => [markGroupName(g), g.preset, g.favorites.map((f) => f.id)]),
    [
      ['想去', true, ['f1', 'f3']],
      ['美食', true, ['f2']],
      ['未分类', false, ['f4']],
    ],
  );
  // A mark nobody saved as a preset is not a category of its own.
  const loose = {
    ...snapshot,
    objects: [...snapshot.objects, fav('f6', '随便', { icon: 'flag', color: 'blue' })],
  };
  const last = placeGroups(loose).at(-1);
  assert.equal(markGroupName(last), '未分类');
  assert.deepEqual(
    last.favorites.map((f) => f.id),
    ['f4', 'f6'],
  );
  // Presets with no places are left out.
  const empty = {
    ...snapshot,
    objects: [
      ...snapshot.objects,
      {
        id: 'p3',
        kind: 'markPreset',
        state: 'active',
        payload: { name: '空', icon: 'flag', color: 'red', order: 2 },
      },
    ],
  };
  assert.equal(
    placeGroups(empty).some((g) => g.name === '空'),
    false,
  );
});

test('places widget: one map for a whole group, follows its favourites', () => {
  const item = {
    content: { type: 'widget', kind: 'places', mark: { icon: 'heart', color: 'rose' } },
    style: { size: 'M' },
  };
  const m = widgetModel(snapshot, item);
  assert.equal(m.title, '想去');
  assert.deepEqual(
    m.stops.map((s) => s.title),
    ['包公园', '李府'],
  );
  assert.equal(m.located, 2);
  assert.equal(m.gone, false);
  const before = widgetDeps(snapshot, item);
  assert.ok(before);
  const moved = {
    ...snapshot,
    objects: snapshot.objects.map((o) => (o.id === 'f3' ? { ...o, generation: 2 } : o)),
  };
  assert.notEqual(widgetDeps(moved, item), before);
  const empty = widgetModel(snapshot, {
    ...item,
    content: { ...item.content, mark: { icon: 'flag', color: 'blue' } },
  });
  assert.equal(empty.gone, true);
});

test('gallery frame keeps the photo ratio inside each border', () => {
  assert.deepEqual(galleryFrameSize(320, '4:3'), { w: 320, h: 240 });
  assert.deepEqual(galleryFrameSize(300, '1:1', 'card'), { w: 300, h: 300 });
  const [pt, pr, pb, pl] = GALLERY_PADDING.polaroid;
  const p = galleryFrameSize(316, '3:4', 'polaroid');
  assert.equal(Math.round(((p.w - pl - pr) / (p.h - pt - pb)) * 100) / 100, 0.75);
  assert.equal(ratioValue('16:9'), 16 / 9);
  assert.equal(ratioValue('bad'), 1);
});

test('rotation replaces the old tilt; widgets get looks by kind', () => {
  assert.equal(itemRotation({ frame: { rotation: 0 }, style: { tilt: -4 } }), -4);
  assert.equal(itemRotation({ frame: { rotation: 30 }, style: { tilt: -4 } }), 30);
  assert.equal(itemRotation({ frame: {}, style: {} }), 0);
  assert.deepEqual(
    variantsFor({ content: { type: 'widget', kind: 'clock' } }).map(([id]) => id),
    ['plain', 'digital', 'minimal', 'sky'],
  );
  // Map widgets got card looks (the map itself is style.mapStyle); day cards have none.
  assert.deepEqual(
    variantsFor({ content: { type: 'widget', kind: 'route' } }).map(([id]) => id),
    ['plain', 'flat', 'polaroid', 'outline'],
  );
  assert.equal(variantsFor({ content: { type: 'widget', kind: 'day' } }), null);
});

test('board patches keep every style the UI can set', () => {
  // Regression: the second-round styles (variant/fontSize/tilt/ratio) were
  // dropped by the sync whitelist, so format bar, 样式 and 歪一点 never saved.
  const patched = cleanBoardStylePatch({
    color: 'yellow',
    size: 'M',
    frameStyle: 'stamp',
    variant: 'tape',
    fontSize: 'l',
    tilt: -4,
    ratio: '9:16',
    locked: true,
    unknown: 'x',
  });
  assert.deepEqual(patched, {
    color: 'yellow',
    size: 'M',
    frameStyle: 'stamp',
    variant: 'tape',
    fontSize: 'l',
    tilt: -4,
    ratio: '9:16',
    locked: true,
  });
  assert.deepEqual(cleanBoardStylePatch({}), {});
});

test('client style choices are accepted by the server schema', () => {
  for (const [type, list] of Object.entries(STYLE_VARIANTS))
    for (const [id] of list) assert.ok(BOARD_VARIANTS[type]?.includes(id), `${type}.${id}`);
  for (const [id] of IMAGE_FRAMES) assert.ok(SERVER_FRAMES.includes(id), id);
  assert.ok(GALLERY_RATIOS.includes('16:9') && GALLERY_RATIOS.includes('9:16'));
  for (const r of ['1:2', '9:16', '3:4', '1:1', '4:3', '16:9', '2:1'])
    assert.ok(GALLERY_RATIOS.includes(r), r);
});

test('emoji library: categories, unique entries and Chinese keywords', () => {
  assert.ok(EMOJI_GROUPS.length >= 8);
  const all = EMOJI_GROUPS.flatMap((g) => g.items.map((x) => x[0]));
  assert.ok(all.length > 1000);
  assert.equal(new Set(all).size, all.length);
  for (const g of EMOJI_GROUPS) assert.ok(g.label && g.icon && g.items.length);
  assert.ok(EMOJI_ZH['开心']?.length || EMOJI_ZH['笑']?.length);
  assert.ok(Object.keys(EMOJI_ZH).some((k) => k.includes('飞机')));
});
