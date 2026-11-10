import test from 'node:test';
import assert from 'node:assert/strict';
import {
  WIDGET_SIZES,
  WIDGET_KINDS,
  widgetSize,
  widgetDeps,
  widgetModel,
} from '../src/board-widgets.js';

function createMockSnapshot() {
  return {
    trip: {
      id: 'trip-1',
      title: '杭州西湖三日游',
      destination: '杭州',
      startDate: '2026-12-01',
      dayCount: 3,
      timezone: 'Asia/Shanghai',
      currency: 'CNY',
    },
    members: [
      { userId: 'u1', name: 'Alice' },
      { userId: 'u2', name: 'Bob' },
    ],
    objects: [
      {
        id: 'day-1',
        tripId: 'trip-1',
        kind: 'day',
        state: 'active',
        generation: 1,
        clocks: {},
        payload: { ordinal: 1, date: '2026-12-01' },
      },
      {
        id: 'day-2',
        tripId: 'trip-1',
        kind: 'day',
        state: 'active',
        generation: 1,
        clocks: {},
        payload: { ordinal: 2, date: '2026-12-02' },
      },
      {
        id: 'act-1',
        tripId: 'trip-1',
        kind: 'activity',
        state: 'active',
        generation: 1,
        clocks: {},
        payload: {
          dayId: 'day-1',
          ordinal: 1,
          title: '断桥残雪',
          time: { mode: 'precise', start: '09:00', end: '10:30' },
          place: { name: '断桥残雪', lng: 120.14, lat: 30.25 },
          buffers: { before: 15 },
          notes: '早上去人少',
        },
      },
      {
        id: 'act-2',
        tripId: 'trip-1',
        kind: 'activity',
        state: 'active',
        generation: 1,
        clocks: {},
        payload: {
          dayId: 'day-1',
          ordinal: 2,
          title: '平湖秋月',
          time: { mode: 'flexible', period: 'morning' },
          place: { name: '平湖秋月', lng: 120.15, lat: 30.24 },
          buffers: {},
          notes: '',
        },
      },
      {
        id: 'route-1-2',
        tripId: 'trip-1',
        kind: 'route',
        state: 'active',
        generation: 1,
        clocks: {},
        payload: {
          fromId: 'act-1',
          toId: 'act-2',
          mode: 'walking',
          minutes: 20,
          distance: 1200,
          path: [[120.14, 30.25], [120.15, 30.24]],
        },
      },
      {
        id: 'fav-1',
        tripId: 'trip-1',
        kind: 'favorite',
        state: 'active',
        generation: 1,
        clocks: {},
        payload: {
          name: '西泠印社',
          address: '孤山路31号',
          lng: 120.13,
          lat: 30.24,
          category: '人文景点',
          mark: { color: 'green', icon: 'camera' },
        },
      },
      {
        id: 'exp-1',
        tripId: 'trip-1',
        kind: 'expense',
        state: 'active',
        generation: 1,
        clocks: {},
        payload: {
          title: '楼外楼午餐',
          activityId: 'act-2',
          payment: {
            status: 'paid',
            currency: 'CNY',
            amountMinor: 38000,
          },
        },
      },
      {
        id: 'exp-2',
        tripId: 'trip-1',
        kind: 'expense',
        state: 'active',
        generation: 1,
        clocks: {},
        payload: {
          title: '游船门票 (预估)',
          payment: {
            status: 'estimated',
            currency: 'CNY',
            amountMinor: 10000,
          },
        },
      },
      {
        id: 'exp-3',
        tripId: 'trip-1',
        kind: 'expense',
        state: 'active',
        generation: 1,
        clocks: {},
        payload: {
          title: '外币咖啡',
          payment: {
            status: 'paid',
            currency: 'USD',
            amountMinor: 1500,
          },
        },
      },
    ],
  };
}

test('board-widgets: widgetSize resolution and clamps', () => {
  assert.equal(widgetSize({ content: { kind: 'activity' }, style: { size: 'S' } }), 'S');
  assert.equal(widgetSize({ content: { kind: 'activity' }, style: { size: 'M' } }), 'M');
  // L is not allowed for activity, fallback to S
  assert.equal(widgetSize({ content: { kind: 'activity' }, style: { size: 'L' } }), 'S');

  // Day supports S, M, L
  assert.equal(widgetSize({ content: { kind: 'day' }, style: { size: 'L' } }), 'L');

  // Unknown fallback
  assert.equal(widgetSize({ content: { kind: 'unknown' } }), 'S');
});

test('board-widgets: widgetDeps generates stable cache keys', () => {
  const snapshot = createMockSnapshot();
  const actItem = { content: { kind: 'activity', activityId: 'act-1' }, style: { size: 'M' } };
  const d1 = widgetDeps(snapshot, actItem);
  assert.ok(d1.includes('act-1'));
  assert.ok(d1.includes('M'));

  const missingItem = { content: { kind: 'activity', activityId: 'nonexistent' } };
  assert.equal(widgetDeps(snapshot, missingItem), 'missing');

  const dayItem = { content: { kind: 'day', dayId: 'day-1' }, style: { size: 'S' } };
  assert.ok(widgetDeps(snapshot, dayItem).includes('day-1'));
});

test('board-widgets: activity widget model', () => {
  const snapshot = createMockSnapshot();
  const item = { content: { kind: 'activity', activityId: 'act-2' }, style: { size: 'M' } };
  const m = widgetModel(snapshot, item);

  assert.equal(m.kind, 'activity');
  assert.equal(m.gone, false);
  assert.equal(m.title, '平湖秋月');
  assert.equal(m.index, 2);
  assert.equal(m.dayLabel, '第1天');
  assert.ok(m.legText.includes('20 分钟'));
  assert.equal(m.placeName, '平湖秋月');

  // Mark activity as deleted
  const act2 = snapshot.objects.find(o => o.id === 'act-2');
  act2.state = 'deleted';
  const mGone = widgetModel(snapshot, item);
  assert.equal(mGone.gone, true);
});

test('board-widgets: day widget model', () => {
  const snapshot = createMockSnapshot();
  const item = { content: { kind: 'day', dayId: 'day-1' }, style: { size: 'M' } };
  const m = widgetModel(snapshot, item);

  assert.equal(m.kind, 'day');
  assert.equal(m.gone, false);
  assert.equal(m.count, 2);
  assert.equal(m.items.length, 2);
  assert.equal(m.items[0].title, '断桥残雪');
  assert.equal(m.items[1].title, '平湖秋月');
  assert.ok(m.items[1].legIn.includes('20 分钟'));
});

test('board-widgets: place widget model (favorite & linked activity)', () => {
  const snapshot = createMockSnapshot();
  const item = {
    content: { kind: 'place', favoriteId: 'fav-1' },
    linkedActivityId: 'act-1',
    style: { size: 'S' },
  };
  const m = widgetModel(snapshot, item);

  assert.equal(m.kind, 'place');
  assert.equal(m.gone, false);
  assert.equal(m.name, '西泠印社');
  assert.equal(m.category, '人文景点');
  assert.equal(m.mark.color, 'green');
  assert.equal(m.mark.icon, 'camera');
  assert.equal(m.scheduled?.dayLabel, '第1天');
});

test('board-widgets: route widget model', () => {
  const snapshot = createMockSnapshot();
  const item = { content: { kind: 'route', dayId: 'day-1' }, style: { size: 'M' } };
  const m = widgetModel(snapshot, item);

  assert.equal(m.kind, 'route');
  assert.equal(m.stops.length, 2);
  assert.equal(m.legs.length, 1);
  assert.equal(m.minutes, 20);
  assert.equal(m.distance, 1200);
  assert.equal(m.missing, 0);
});

test('board-widgets: countdown widget model across phases', () => {
  const snapshot = createMockSnapshot();
  const item = { content: { kind: 'countdown' }, style: { size: 'M' } };

  // 1. Before trip: 2026-11-20
  const mBefore = widgetModel(snapshot, item, { now: Date.parse('2026-11-20T10:00:00Z') });
  assert.equal(mBefore.label, '距出发');
  assert.equal(mBefore.number, 11); // 2026-12-01 - 2026-11-20
  assert.equal(mBefore.startDateLabel, '12/1');
  assert.equal(mBefore.startWd, '周二');
  assert.equal(mBefore.endMd, '12/2');
  assert.equal(mBefore.endWd, '周三');
  assert.deepEqual(
    mBefore.days.map((d) => d.ordinal),
    [1, 2],
  );

  // 2. During trip: 2026-12-02
  const mDuring = widgetModel(snapshot, item, { now: Date.parse('2026-12-02T10:00:00Z') });
  assert.equal(mDuring.label, '旅途中');
  assert.equal(mDuring.number, 2);

  // 3. After trip: 2026-12-10
  const mAfter = widgetModel(snapshot, item, { now: Date.parse('2026-12-10T10:00:00Z') });
  assert.equal(mAfter.label, '已结束');
  assert.ok(mAfter.number > 0);

  // 4. Undated trip
  const snapshotUndated = { ...snapshot, trip: { ...snapshot.trip, startDate: null } };
  const mUndated = widgetModel(snapshotUndated, item);
  assert.equal(mUndated.number, '—');
});

test('board-widgets: clock widget model', () => {
  const snapshot = createMockSnapshot();
  const item = { content: { kind: 'clock' }, style: { size: 'S' } };
  const now = Date.parse('2026-12-01T12:30:00Z');
  // Shanghai is UTC+8, so 20:30
  const m = widgetModel(snapshot, item, { now, deviceTimeZone: 'Asia/Shanghai' });
  assert.equal(m.hours, 20);
  assert.equal(m.minutes, 30);
  assert.equal(m.diffStr, '与你这里同一时区');

  // Compared to UTC
  const mUtc = widgetModel(snapshot, item, { now, deviceTimeZone: 'UTC' });
  assert.ok(mUtc.diffStr.includes('快 8 小时'));
});

test('board-widgets: expense widget model', () => {
  const snapshot = createMockSnapshot();
  const item = { content: { kind: 'expense' }, style: { size: 'M' } };
  const m = widgetModel(snapshot, item, { now: Date.parse('2026-12-02T10:00:00Z') });

  assert.equal(m.total, 38000); // 380.00 CNY (paid only)
  assert.equal(m.formattedTotal, '¥380.00');
  assert.equal(m.est, 10000);   // 100.00 CNY (estimated)
  assert.equal(m.formattedEst, '¥100.00');
  assert.equal(m.per, 19000);   // 38000 / 2 members
  assert.equal(m.formattedPer, '¥190.00');
  assert.equal(m.others['USD'], 1500);
  assert.deepEqual(m.perDay, [38000, 0]);
  assert.equal(m.hi, 1); // 2026-12-02 is the second visible day
  assert.equal(m.top.length, 1);
  assert.equal(m.top[0].title, '楼外楼午餐');
  assert.equal(m.top[0].dayText, '第 1 天');
  assert.equal(m.top[0].formatted, '¥380.00');
});

test('board-widgets: expense widget currency factors (KRW/JPY/CNY)', () => {
  const item = { content: { kind: 'expense' }, style: { size: 'M' } };
  const withCurrency = (currency, amountMinor) => {
    const snapshot = createMockSnapshot();
    snapshot.trip.currency = currency;
    snapshot.objects = snapshot.objects.filter((o) => o.kind !== 'expense');
    snapshot.objects.push({
      id: 'exp-main',
      tripId: 'trip-1',
      kind: 'expense',
      state: 'active',
      generation: 1,
      clocks: {},
      payload: {
        title: '午饭钱',
        activityId: 'act-2',
        payment: { status: 'paid', currency, amountMinor },
      },
    });
    return widgetModel(snapshot, item, { now: Date.parse('2026-12-02T10:00:00Z') });
  };

  // KRW has 0 decimals (currencyFactor 1): 150000 minor is ₩150,000, not ₩1,500.
  const krw = withCurrency('KRW', 150000);
  assert.equal(krw.cur, 'KRW');
  assert.equal(krw.total, 150000);
  assert.equal(krw.formattedTotal, '₩150,000');
  assert.equal(krw.per, 75000);
  assert.equal(krw.formattedPer, '₩75,000');
  assert.deepEqual(krw.perDay, [150000, 0]);
  assert.equal(krw.top[0].formatted, '₩150,000');

  // JPY regression (currencyFactor 1): 1000 minor is ¥1,000, not ¥10.00.
  const jpy = withCurrency('JPY', 1000);
  assert.equal(jpy.total, 1000);
  assert.ok(jpy.formattedTotal.endsWith('¥1,000'));
  assert.ok(jpy.formattedPer.endsWith('¥500'));

  // CNY regression (currencyFactor 100): 12000 minor is ¥120.00.
  const cny = withCurrency('CNY', 12000);
  assert.equal(cny.formattedTotal, '¥120.00');
  assert.equal(cny.formattedPer, '¥60.00');
});
