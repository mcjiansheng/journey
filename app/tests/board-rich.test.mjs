import test from 'node:test';
import assert from 'node:assert/strict';
import { sanitizeRichText, richTextToPlain, plainToRichText } from '../src/rich-text.js';
import { placeGroups, markGroupName, widgetModel, widgetDeps } from '../src/board-widgets.js';
import {
  galleryFrameSize,
  GALLERY_PADDING,
  nextTilt,
  TILTS,
  ratioValue,
  STYLE_VARIANTS,
  IMAGE_FRAMES,
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

test('places: favourites are grouped by mark, ordered by preset', () => {
  const groups = placeGroups(snapshot);
  assert.deepEqual(
    groups.map((g) => [markGroupName(g), g.favorites.map((f) => f.id)]),
    [
      ['想去', ['f1', 'f3']],
      ['美食', ['f2']],
      [markGroupName(groups[2]), ['f4']],
    ],
  );
  assert.ok(markGroupName(groups[2]).length > 0);
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

test('tilt cycles back to straight', () => {
  let t = 0;
  for (let i = 0; i < TILTS.length; i++) t = nextTilt(t);
  assert.equal(t, 0);
});

test('client style choices are accepted by the server schema', () => {
  for (const [type, list] of Object.entries(STYLE_VARIANTS))
    for (const [id] of list) assert.ok(BOARD_VARIANTS[type]?.includes(id), `${type}.${id}`);
  for (const [id] of IMAGE_FRAMES) assert.ok(SERVER_FRAMES.includes(id), id);
  assert.ok(GALLERY_RATIOS.includes('16:9') && GALLERY_RATIOS.includes('9:16'));
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
