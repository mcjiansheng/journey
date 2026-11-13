import {
  orderedActivities,
  dayLabel,
  timeLabel,
  travelAdvice,
  money,
  visibleDays,
} from './domain.js';
import { expenseDate, expenseTitle } from './expenses.js';
import { markColors, markPaths, defaultMark, colorNames, iconNames } from './marks.js';
import { hourOf, sky } from './board.js';

export const WIDGET_SIZES = {
  S: [168, 168],
  M: [352, 168],
  L: [352, 352],
};

export const WIDGET_KINDS = {
  activity: ['S', 'M'],
  day: ['S', 'M', 'L'],
  place: ['S', 'M'],
  route: ['M', 'L'],
  countdown: ['S', 'M'],
  clock: ['S', 'M'],
  expense: ['S', 'M'],
  places: ['M', 'L'],
};

const sameMark = (a, b) => Boolean(a && b && a.icon === b.icon && a.color === b.color);
export const UNSORTED_KEY = 'unsorted';
/**
 * Favorites grouped by mark preset. Only a mark the user saved as a preset
 * makes a category; every other place is 「未分类」 (last, `preset: false`).
 * Presets without places are left out.
 */
export function placeGroups(snapshot) {
  const objects = snapshot?.objects || [];
  const presets = objects
    .filter((o) => o.kind === 'markPreset' && o.state === 'active')
    .sort((a, b) => (a.payload.order ?? 0) - (b.payload.order ?? 0));
  const favorites = objects.filter((o) => o.kind === 'favorite' && o.state === 'active');
  const groups = presets.map((p) => ({
    key: `${p.payload.icon}:${p.payload.color}`,
    mark: { icon: p.payload.icon, color: p.payload.color },
    name: p.payload.name || '',
    preset: true,
    favorites: [],
  }));
  const unsorted = {
    key: UNSORTED_KEY,
    mark: null,
    name: '未分类',
    preset: false,
    favorites: [],
  };
  for (const f of favorites) {
    const mark = f.payload.mark || defaultMark();
    const g = groups.find((x) => sameMark(x.mark, mark));
    (g || unsorted).favorites.push(f);
  }
  const out = groups.filter((g) => g.favorites.length);
  if (unsorted.favorites.length) out.push(unsorted);
  return out;
}
export function markGroupName(group) {
  if (group && group.preset === false) return '未分类';
  return (
    group?.name ||
    `${colorNames[group?.mark?.color] || ''}${iconNames[group?.mark?.icon] || '标记'}`
  );
}

// Corner handles scale a widget within this range of its form's base size.
export const WIDGET_SCALE_MIN = 0.75;
export const WIDGET_SCALE_MAX = 1.6;

/** Current zoom factor of a widget relative to its form's base size. */
export function widgetScale(item) {
  const [baseW] = WIDGET_SIZES[widgetSize(item)] || [168, 168];
  const w = item?.frame?.w || baseW;
  return Math.min(WIDGET_SCALE_MAX, Math.max(WIDGET_SCALE_MIN, w / baseW));
}

/**
 * Form (S/M/L) chosen while an edge handle is dragged. The hysteresis band
 * keeps the form from flickering when the pointer rests near the threshold.
 *   axis 'x': square S ⇄ wide M        axis 'y': wide M ⇄ big square L
 */
export function pickWidgetSize(kind, liveW, liveH, prev, axis) {
  const allowed = WIDGET_KINDS[kind] || ['S'];
  const r = liveW / Math.max(1, liveH);
  if (axis === 'x') {
    if (prev === 'S' && allowed.includes('M') && r > 1.65) return 'M';
    if (prev === 'M' && allowed.includes('S') && r < 1.35) return 'S';
  } else {
    if (prev === 'M' && allowed.includes('L') && r < 1.45) return 'L';
    if (prev === 'L' && allowed.includes('M') && r > 1.75) return 'M';
  }
  return prev;
}

/** Which edge handles a widget offers in its current form. */
export function widgetEdgeHandles(item) {
  const allowed = WIDGET_KINDS[item?.content?.kind] || ['S'];
  const size = widgetSize(item);
  const handles = [];
  if (allowed.includes('S') && allowed.includes('M') && size !== 'L') handles.push('e', 'w');
  if (allowed.includes('L') && (size === 'M' || size === 'L')) handles.push('s');
  return handles;
}

export function widgetSize(item) {
  const kind = item?.content?.kind;
  const allowed = WIDGET_KINDS[kind] || ['S'];
  const curSize = item?.style?.size;
  return allowed.includes(curSize) ? curSize : allowed[0];
}

const MODE_NAMES = {
  walking: '步行',
  driving: '驾车',
  bicycling: '骑行',
  transit: '公共交通',
};

function formatMd(isoDate) {
  if (!isoDate) return '';
  const [y, m, d] = isoDate.split('-');
  return `${+m}/${+d}`;
}

function findLegRoute(snapshot, prevId, targetId) {
  const activeRoute = snapshot.objects.find(
    (o) =>
      o.kind === 'route' &&
      o.state === 'active' &&
      o.payload.fromId === prevId &&
      o.payload.toId === targetId,
  );
  if (activeRoute) return activeRoute;
  return (
    snapshot.objects.find(
      (o) =>
        o.kind === 'route' &&
        o.state !== 'deleted' &&
        o.payload.fromId === prevId &&
        o.payload.toId === targetId,
    ) || null
  );
}

export function widgetDeps(snapshot, item) {
  const content = item?.content || {};
  const kind = content.kind;
  if (!snapshot) return '';

  if (kind === 'activity') {
    const act = snapshot.objects.find((o) => o.id === content.activityId);
    if (!act) return 'missing';
    const dayActs = act.payload?.dayId
      ? orderedActivities(snapshot, act.payload.dayId)
          .map((a) => a.id)
          .join(',')
      : '';
    const leg = snapshot.objects.find(
      (o) => o.kind === 'route' && o.payload?.toId === act.id && o.state === 'active',
    );
    return `${act.id}:${act.state}:${act.generation}:${dayActs}:${leg?.generation || 0}:${item.style?.size}`;
  }

  if (kind === 'day' || kind === 'route') {
    const day = snapshot.objects.find((o) => o.id === content.dayId);
    const dayActs = content.dayId
      ? orderedActivities(snapshot, content.dayId)
          .map(
            (a) =>
              `${a.id}:${a.state}:${a.payload.title}:${a.payload.time?.start}:${a.payload.place?.lng}`,
          )
          .join('|')
      : '';
    const routes = snapshot.objects
      .filter((o) => o.kind === 'route')
      .map((r) => `${r.id}:${r.state}:${r.payload.minutes}`)
      .join('|');
    return `${day?.id}:${day?.state}:${dayActs}:${routes}:${item.style?.size}`;
  }

  if (kind === 'place') {
    const fav = content.favoriteId
      ? snapshot.objects.find((o) => o.id === content.favoriteId)
      : null;
    const linked = item.linkedActivityId
      ? snapshot.objects.find((o) => o.id === item.linkedActivityId)
      : null;
    const linkedDay = linked?.payload?.dayId
      ? snapshot.objects.find((o) => o.id === linked.payload.dayId)
      : null;
    return `${fav?.id}:${fav?.state}:${fav?.generation}:${linked?.id}:${linked?.state}:${linkedDay?.id}:${linkedDay?.state}:${item.style?.size}`;
  }

  if (kind === 'places') {
    const m = content.mark || {};
    const favs = snapshot.objects
      .filter((o) => o.kind === 'favorite' && sameMark(o.payload.mark || defaultMark(), m))
      .map((o) => `${o.id}:${o.state}:${o.generation}:${o.payload.lng}:${o.payload.name}`)
      .join('|');
    const preset = snapshot.objects.find((o) => o.kind === 'markPreset' && sameMark(o.payload, m));
    return `${favs}:${preset?.payload?.name}:${preset?.state}:${item.style?.size}`;
  }

  if (kind === 'countdown') {
    const actCount = snapshot.objects.filter(
      (o) => o.kind === 'activity' && o.state === 'active',
    ).length;
    return `${snapshot.trip?.startDate}:${snapshot.trip?.dayCount}:${actCount}:${item.style?.size}`;
  }

  if (kind === 'clock') {
    return `${snapshot.trip?.timezone}:${snapshot.trip?.destination}:${item.style?.size}`;
  }

  if (kind === 'expense') {
    const expenses = snapshot.objects
      .filter((o) => o.kind === 'expense')
      .map(
        (e) => `${e.id}:${e.state}:${e.payload.payment?.status}:${e.payload.payment?.amountMinor}`,
      )
      .join('|');
    return `${expenses}:${snapshot.members?.length}:${item.style?.size}`;
  }

  return '';
}

export function widgetModel(snapshot, item, { now = Date.now(), deviceTimeZone } = {}) {
  const content = item?.content || {};
  const kind = content.kind;
  const size = widgetSize(item);
  const trip = snapshot.trip || {};

  if (kind === 'activity') {
    const target = snapshot.objects.find(
      (o) => o.id === content.activityId && o.kind === 'activity',
    );
    const day = target
      ? snapshot.objects.find((o) => o.id === target.payload.dayId && o.kind === 'day')
      : null;
    const gone = !target || target.state === 'deleted' || !day || day.state === 'deleted';

    const p = target?.payload || {
      title: '日程',
      time: { mode: 'flexible', period: '' },
      place: null,
      buffers: {},
      notes: '',
    };
    const ordered = day && day.state === 'active' ? orderedActivities(snapshot, day.id) : [];
    const idx = target && !gone ? ordered.findIndex((a) => a.id === target.id) + 1 : null;
    const index = idx > 0 ? idx : null;

    const tLabel = timeLabel(p);
    const [t1, t2] = tLabel ? tLabel.split('–') : ['', ''];
    const timeObj = {
      text: tLabel || '时间待定',
      start: t1 || null,
      end: t2 ? `至 ${t2}` : null,
      precise: p.time?.mode === 'precise',
    };

    let legText = '';
    if (index && index > 1) {
      const prevAct = ordered[index - 2];
      const leg = findLegRoute(snapshot, prevAct.id, target.id);
      if (leg && Number.isFinite(leg.payload?.minutes)) {
        const mode = MODE_NAMES[leg.payload.mode] || '路上';
        const adv = travelAdvice(prevAct, target, leg);
        legText =
          `${mode}约 ${leg.payload.minutes} 分钟` +
          (adv.depart ? ` · 建议 ${adv.depart} 出发` : '');
      }
    }

    const hour = hourOf(p);
    return {
      kind: 'activity',
      size,
      gone,
      title: p.title,
      dayLabel: dayLabel(day, trip),
      dateLabel: day?.payload?.date ? formatMd(day.payload.date) : '',
      index,
      time: timeObj,
      placeName: p.place?.name || '',
      bufferBefore: p.buffers?.before ?? null,
      legText,
      notes: p.notes || '',
      hour,
      sky: sky(hour),
    };
  }

  if (kind === 'day') {
    const target = snapshot.objects.find((o) => o.id === content.dayId && o.kind === 'day');
    const gone = !target || target.state === 'deleted';
    const dPayload = target?.payload || { ordinal: 1, date: null };
    const acts = target && target.state === 'active' ? orderedActivities(snapshot, target.id) : [];

    let dateNumber = dPayload.ordinal;
    let weekday = '未定日期';
    if (dPayload.date) {
      const parsed = new Date(dPayload.date + 'T00:00:00');
      dateNumber = parsed.getDate();
      weekday = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'][parsed.getDay()];
    }

    const items = acts.map((a, i) => {
      const prev = i > 0 ? acts[i - 1] : null;
      let legIn = null;
      if (prev) {
        const r = findLegRoute(snapshot, prev.id, a.id);
        if (r && Number.isFinite(r.payload?.minutes)) {
          legIn = `${MODE_NAMES[r.payload.mode] || '路程'}约 ${r.payload.minutes} 分钟`;
        }
      }
      return {
        id: a.id,
        title: a.payload.title,
        timeText: timeLabel(a.payload),
        placeName: a.payload.place?.name || '',
        hour: hourOf(a.payload),
        sky: sky(hourOf(a.payload)),
        legIn,
      };
    });

    return {
      kind: 'day',
      size,
      gone,
      dateNumber,
      weekday,
      dayLabel: dayLabel(target, trip),
      count: acts.length,
      items,
    };
  }

  if (kind === 'places') {
    const mark = content.mark || defaultMark();
    const group = placeGroups(snapshot).find((g) => g.preset && sameMark(g.mark, mark));
    const favorites = group?.favorites || [];
    const stops = favorites.map((f, i) => ({
      id: f.id,
      n: i + 1,
      title: f.payload.name,
      address: f.payload.address || '',
      lng: f.payload.lng,
      lat: f.payload.lat,
      located: f.payload.lng != null && f.payload.lat != null,
      sky: { c: markColors[mark.color] || '#b7791f' },
    }));
    return {
      size,
      title: group ? markGroupName(group) : markGroupName({ mark }),
      mark,
      markColorHex: markColors[mark.color] || '#b7791f',
      markPath: markPaths[mark.icon] || markPaths.star,
      stops,
      located: stops.filter((s) => s.located).length,
      gone: !favorites.length,
    };
  }

  if (kind === 'place') {
    let p = { name: '地点', address: '', lng: null, lat: null, category: '' };
    let gone = false;
    let mark = defaultMark();

    if (content.favoriteId) {
      const fav = snapshot.objects.find(
        (o) => o.id === content.favoriteId && o.kind === 'favorite',
      );
      gone = !fav || fav.state === 'deleted';
      if (fav?.payload) {
        p = fav.payload;
        mark = fav.payload.mark || defaultMark();
      }
    } else if (content.place) {
      p = content.place;
      gone = false;
    }

    let scheduled = null;
    if (item.linkedActivityId) {
      const act = snapshot.objects.find(
        (o) => o.id === item.linkedActivityId && o.kind === 'activity' && o.state === 'active',
      );
      const day = act
        ? snapshot.objects.find(
            (o) => o.id === act.payload.dayId && o.kind === 'day' && o.state === 'active',
          )
        : null;
      if (act && day) {
        scheduled = { dayLabel: dayLabel(day, trip) };
      }
    }

    return {
      kind: 'place',
      size,
      gone,
      name: p.name || '地点',
      address: p.address || '',
      category: p.category || '',
      mark,
      markColorHex: markColors[mark.color] || '#ffa000',
      markPath: markPaths[mark.icon] || markPaths.star,
      lng: p.lng,
      lat: p.lat,
      scheduled,
      favoriteId: content.favoriteId || null,
    };
  }

  if (kind === 'route') {
    const day = snapshot.objects.find((o) => o.id === content.dayId && o.kind === 'day');
    const gone = !day || day.state === 'deleted';
    const acts = day && day.state === 'active' ? orderedActivities(snapshot, day.id) : [];

    const legs = [];
    for (let i = 1; i < acts.length; i++) {
      const from = acts[i - 1];
      const to = acts[i];
      const r = findLegRoute(snapshot, from.id, to.id);
      legs.push({
        fromId: from.id,
        toId: to.id,
        mode: r?.payload?.mode || 'walking',
        minutes: r?.payload?.minutes ?? null,
        distance: r?.payload?.distance ?? null,
        path: r?.payload?.path || [],
        hasRoute: !!r,
      });
    }

    const stops = acts.map((a, i) => ({
      n: i + 1,
      id: a.id,
      title: a.payload.title,
      timeText: timeLabel(a.payload),
      located: a.payload.place?.lng != null && a.payload.place?.lat != null,
      lng: a.payload.place?.lng ?? null,
      lat: a.payload.place?.lat ?? null,
      hour: hourOf(a.payload),
      sky: sky(hourOf(a.payload)),
    }));

    const knownLegs = legs.filter((l) => l.minutes != null);
    const totalMinutes = knownLegs.reduce((sum, l) => sum + l.minutes, 0);
    const missing = legs.length - knownLegs.length;
    const allDist = legs.length > 0 && legs.every((l) => l.distance != null);
    const totalDistance = allDist ? legs.reduce((sum, l) => sum + l.distance, 0) : null;

    return {
      kind: 'route',
      size,
      gone,
      dayLabel: dayLabel(day, trip),
      dateLabel: day?.payload?.date ? formatMd(day.payload.date) : '',
      stops,
      legs,
      minutes: totalMinutes,
      missing,
      distance: totalDistance,
    };
  }

  if (kind === 'countdown') {
    const tz = trip.timezone || 'Asia/Shanghai';
    const todayIso = new Intl.DateTimeFormat('en-CA', { timeZone: tz }).format(new Date(now));
    const startDate = trip.startDate;
    const dayCount = trip.dayCount || 1;
    const days = visibleDays(snapshot);

    let label = '距出发';
    let number = 0;
    let unit = '天';
    let progress = 0;
    let sub = '';

    if (!startDate) {
      label = '出发日期';
      number = '—';
      unit = '';
      progress = 0;
      sub = '还没定出发日期';
    } else {
      const diff = Math.round((Date.parse(startDate) - Date.parse(todayIso)) / 86400000);
      if (diff > 0) {
        label = '距出发';
        number = diff;
        unit = '天';
        progress = 0;
      } else if (diff > -dayCount) {
        label = '旅途中';
        number = 1 - diff;
        unit = `/ ${dayCount} 天`;
        progress = 1 - diff;
      } else {
        label = '已结束';
        number = -diff - dayCount + 1;
        unit = '天前';
        progress = dayCount;
      }
    }

    const firstDay = days[0];
    const lastDay = days[days.length - 1];
    const actCount = snapshot.objects.filter(
      (o) => o.kind === 'activity' && o.state === 'active',
    ).length;

    return {
      kind: 'countdown',
      size,
      gone: false,
      label,
      number,
      unit,
      progress,
      destination: trip.destination || '旅程',
      startDateLabel: firstDay?.payload?.date ? formatMd(firstDay.payload.date) : '未定日期',
      startWd: firstDay?.payload?.date
        ? ['周日', '周一', '周二', '周三', '周四', '周五', '周六'][
            new Date(firstDay.payload.date + 'T00:00:00').getDay()
          ]
        : '',
      endMd: lastDay?.payload?.date ? formatMd(lastDay.payload.date) : '',
      endWd: lastDay?.payload?.date
        ? ['周日', '周一', '周二', '周三', '周四', '周五', '周六'][
            new Date(lastDay.payload.date + 'T00:00:00').getDay()
          ]
        : '',
      totalDays: dayCount,
      activityCount: actCount,
      days: days.map((d) => ({ id: d.id, ordinal: d.payload.ordinal, date: d.payload.date })),
      sub,
    };
  }

  if (kind === 'clock') {
    const tz = trip.timezone || 'Asia/Shanghai';
    const parts = new Intl.DateTimeFormat('en-GB', {
      timeZone: tz,
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false,
    }).formatToParts(new Date(now));

    const pMap = Object.fromEntries(parts.map((p) => [p.type, +p.value]));
    const hours = pMap.hour || 0;
    const minutes = pMap.minute || 0;
    const seconds = pMap.second || 0;

    const localNow = new Date(now);
    const destString = localNow.toLocaleString('en-US', { timeZone: tz });
    const localString = localNow.toLocaleString(
      'en-US',
      deviceTimeZone ? { timeZone: deviceTimeZone } : undefined,
    );
    const diffHours = Math.round((new Date(destString) - new Date(localString)) / 3600000);

    let diffStr = '与你这里同一时区';
    if (diffHours > 0) diffStr = `比你这里快 ${diffHours} 小时`;
    else if (diffHours < 0) diffStr = `比你这里慢 ${Math.abs(diffHours)} 小时`;

    return {
      kind: 'clock',
      size,
      gone: false,
      destination: trip.destination || '当地',
      hours,
      minutes,
      seconds,
      timeStr: `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`,
      diffStr,
      timezone: tz,
    };
  }

  if (kind === 'expense') {
    const cur = trip.currency || 'CNY';
    const list = snapshot.objects.filter((o) => o.kind === 'expense' && o.state === 'active');
    const paid = list.filter((e) => e.payload.payment?.status === 'paid');
    const main = paid.filter((e) => e.payload.payment?.currency === cur);
    const total = main.reduce((s, e) => s + (e.payload.payment.amountMinor || 0), 0);
    const memberCount = snapshot.members?.length || 1;
    const per = memberCount > 1 ? Math.round(total / memberCount) : null;

    const est = list
      .filter(
        (e) => e.payload.payment?.status === 'estimated' && e.payload.payment?.currency === cur,
      )
      .reduce((s, e) => s + (e.payload.payment.amountMinor || 0), 0);

    const others = {};
    for (const e of paid) {
      const c = e.payload.payment?.currency;
      if (c && c !== cur) {
        others[c] = (others[c] || 0) + (e.payload.payment.amountMinor || 0);
      }
    }

    const days = visibleDays(snapshot);
    const perDay = days.map((d) => {
      const dayIso = d.payload.date;
      return main
        .filter((e) => expenseDate(snapshot, e) === dayIso)
        .reduce((sum, e) => sum + (e.payload.payment.amountMinor || 0), 0);
    });

    const tz = trip.timezone || 'Asia/Shanghai';
    const todayIso = new Intl.DateTimeFormat('en-CA', { timeZone: tz }).format(new Date(now));
    const todayIdx = days.findIndex((d) => d.payload.date === todayIso);
    const maxVal = Math.max(0, ...perDay);
    const hi = todayIdx >= 0 ? todayIdx : perDay.indexOf(maxVal);

    const top = [...main]
      .sort((a, b) => b.payload.payment.amountMinor - a.payload.payment.amountMinor)
      .slice(0, 4)
      .map((e) => {
        const eIso = expenseDate(snapshot, e);
        const dObj = days.find((d) => d.payload.date === eIso);
        let dayText = '未记日期';
        if (dObj) dayText = `第 ${dObj.payload.ordinal} 天`;
        else if (eIso && days[0]?.payload.date && eIso < days[0].payload.date) dayText = '行前';
        else if (
          eIso &&
          days[days.length - 1]?.payload.date &&
          eIso > days[days.length - 1].payload.date
        )
          dayText = '行后';
        return {
          title: expenseTitle(snapshot, e),
          dayText,
          amount: e.payload.payment.amountMinor,
          formatted: money(e.payload.payment.amountMinor, cur),
        };
      });

    return {
      kind: 'expense',
      size,
      gone: false,
      cur,
      total,
      formattedTotal: money(total, cur),
      count: paid.length,
      per,
      formattedPer: per != null ? money(per, cur) : null,
      est,
      formattedEst: est ? money(est, cur) : null,
      others,
      perDay,
      hi,
      max: maxVal,
      top,
    };
  }

  return { kind, size, gone: false };
}
