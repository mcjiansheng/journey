import ScrollableTabs from './ScrollableTabs.jsx';
import DateRangePicker from './DateRangePicker.jsx';
import { reducedMotion } from '../usePageNavigation.js';
import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import {
  CalendarDays,
  LocateFixed,
  ArrowDownToLine,
  Wallet,
  Plus,
  MapPin,
  Trash2,
  Route,
  ChevronLeft,
  ChevronRight,
  MoreHorizontal,
  GripVertical,
  RotateCcw,
  Navigation,
  Pencil,
  UserMinus,
  UserPlus,
  LockKeyhole,
} from 'lucide-react';
import { Field, Modal, Empty, AsyncButton, active, id, errorMessage, money } from './ui.jsx';
import {
  visibleDays,
  outsideDays,
  orderedActivities,
  routeSignature,
  dayLabel,
  timeLabel,
  travelAdvice,
} from '../domain.js';
import { estimateRoute, searchPlaces } from '../amap.js';
import './itinerary.css';
import { dateAdd } from '../domain.js';
import { reschedulePlan } from '../reschedule.js';

const routeEstimates = new Map();
const located = (place) => [place?.lng, place?.lat].every(Number.isFinite);
const routeKey = (trip, from, to) => `${trip.id}:${routeSignature(from, to, 'walking')}`;
function useRouteEstimates(j, list, routes) {
  const [estimates, setEstimates] = useState({});
  useEffect(() => {
    let live = true;
    for (let i = 1; i < list.length; i++) {
      const from = list[i - 1],
        to = list[i];
      if (
        !located(from.payload.place) ||
        !located(to.payload.place) ||
        routes.some((r) => r.payload.fromId === from.id && r.payload.toId === to.id)
      )
        continue;
      const key = routeKey(j.snapshot.trip, from, to);
      if (!routeEstimates.has(key))
        routeEstimates.set(
          key,
          estimateRoute(
            from.payload.place,
            to.payload.place,
            'walking',
            j.snapshot.trip.destination,
          ).catch(() => {
            routeEstimates.delete(key);
            return null;
          }),
        );
      routeEstimates.get(key).then((value) => {
        if (live && value)
          setEstimates((previous) => (previous[key] ? previous : { ...previous, [key]: value }));
      });
    }
    return () => {
      live = false;
    };
  }, [
    j.snapshot.trip.id,
    j.snapshot.trip.destination,
    j.status === 'offline',
    j.status === 'synced',
    JSON.stringify(list.map((o) => [o.id, o.payload.place])),
    JSON.stringify(routes.map((r) => [r.id, r.state, r.payload.fromId, r.payload.toId])),
  ]);
  return estimates;
}

export function directPermission(j, o) {
  const trip = j.snapshot.trip;
  const me = j.snapshot.members.find((m) => m.userId === j.user.id);
  return trip.ownerId === j.user.id || (trip.teamMode === 'admin' && !!me?.isAdmin);
}

export function ObjectActions({ journey: j, object: o, prominent = false, onDeleted, children }) {
  const [error, setError] = useState(''),
    [pending, setPending] = useState(false);
  const pendingOperation = useRef(false);
  const perform = async (operation) => {
    if (pendingOperation.current) return;
    pendingOperation.current = true;
    setPending(true);
    const scope = j.captureScope();
    try {
      setError('');
      await j.mutate(operation, scope);
      if (operation.kind === 'delete') {
        j.notify?.({
          message: '已删除',
          actionLabel: '撤销',
          onAction: () =>
            j.mutate(
              { objectId: o.id, kind: 'restore', generation: operation.generation + 1 },
              scope,
            ),
        });
        onDeleted?.();
      }
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      pendingOperation.current = false;
      setPending(false);
    }
  };
  const expression = o.expressions?.find((e) => e.userId === j.user.id) || {};
  const deleted = o.state === 'deleted';
  const direct = deleted
    ? j.snapshot.trip.ownerId === j.user.id ||
      j.snapshot.members.find((m) => m.userId === j.user.id)?.isAdmin
    : directPermission(j, o);
  const opinionKey = deleted ? 'wishRestore' : 'wishDelete';
  const label = direct
    ? deleted
      ? '恢复'
      : '删除'
    : deleted
      ? expression.wishRestore
        ? '撤回恢复意见'
        : '希望恢复'
      : expression.wishDelete
        ? '撤回删除意见'
        : '希望删除';
  const Icon = deleted ? RotateCcw : Trash2;
  return (
    <div className={`object-actions${prominent ? ' prominent-actions' : ''}`}>
      {children}
      {!deleted && o.kind === 'activity' && (
        <button
          className="text-button"
          disabled={pending}
          onClick={() =>
            perform({
              objectId: o.id,
              kind: 'express',
              generation: o.generation,
              expression: { notParticipating: !expression.notParticipating },
            })
          }
        >
          {expression.notParticipating ? <UserPlus size={16} /> : <UserMinus size={16} />}{' '}
          {expression.notParticipating ? '重新参加' : '我不参加'}
        </button>
      )}
      <button
        className={
          prominent
            ? deleted
              ? 'secondary lifecycle-action'
              : 'secondary lifecycle-action danger'
            : direct && !deleted
              ? 'danger text-button lifecycle-action'
              : 'text-button'
        }
        disabled={pending}
        onClick={() =>
          perform(
            direct
              ? { objectId: o.id, kind: deleted ? 'restore' : 'delete', generation: o.generation }
              : {
                  objectId: o.id,
                  kind: 'express',
                  generation: o.generation,
                  expression: { [opinionKey]: !expression[opinionKey] },
                },
          )
        }
      >
        <Icon size={16} />
        {label}
      </button>
      {deleted && o.expressions?.some((e) => e.wishRestore) && (
        <small>{o.expressions.filter((e) => e.wishRestore).length} 位同伴希望恢复</small>
      )}
      {error && (
        <small className="field-error" role="alert">
          {error}
        </small>
      )}
    </div>
  );
}

function RouteEditor({ journey: j, from, to, object, estimate, onClose }) {
  const emptyPlace = {
    name: '',
    address: '',
    lng: null,
    lat: null,
    provider: null,
    providerPlaceId: null,
    category: '',
    sourceUrl: '',
    fetchedAt: null,
    coordSystem: 'GCJ-02',
  };
  const [draft, setDraft] = useState(
    object?.payload || {
      fromId: from?.id || null,
      fromPlace: from ? null : emptyPlace,
      toId: to.id,
      mode: 'walking',
      minutes: null,
      manual: false,
      inputSignature: '',
      path: [],
      distance: null,
      ...estimate,
    },
  );
  const [error, setError] = useState(''),
    [query, setQuery] = useState(''),
    [results, setResults] = useState([]);
  const origin = from || { id: 'origin', payload: { place: draft.fromPlace } };
  const currentObject = object
    ? j.snapshot.objects.find((o) => o.id === object.id) || object
    : null;
  async function save(p) {
    try {
      if (!from && !p.fromPlace?.name.trim()) throw new Error('请填写出发地点。');
      if (p.minutes !== null && (!Number.isFinite(p.minutes) || p.minutes < 0))
        throw new Error('请填写非负路程时长。');
      await j.mutate({
        objectId: object?.id || id(),
        kind: object ? 'patch' : 'create',
        objectType: 'route',
        patch: p,
      });
      onClose();
    } catch (e) {
      setError(errorMessage(e));
    }
  }
  function place(key, value) {
    setDraft({
      ...draft,
      fromPlace: {
        ...emptyPlace,
        ...draft.fromPlace,
        [key]: value,
        lng: null,
        lat: null,
        provider: null,
        providerPlaceId: null,
      },
    });
  }
  return (
    <Modal title="前往下一站" onClose={onClose}>
      <p className="muted">
        {from?.payload.title || draft.fromPlace?.name || '出发地'} → {to.payload.title}
      </p>
      {!from && (
        <fieldset>
          <legend>出发地</legend>
          <div className="place-search">
            <Field label="搜索出发地">
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="酒店、车站或其他地点"
              />
            </Field>
            <AsyncButton
              className="secondary small"
              disabled={!query.trim()}
              onClick={async () => {
                try {
                  setResults(await searchPlaces(query, j.snapshot.trip.destination));
                } catch (e) {
                  setError(errorMessage(e));
                }
              }}
            >
              查找
            </AsyncButton>
          </div>
          {results.length > 0 && (
            <div className="place-choices">
              {results.map((p, i) => (
                <button
                  key={p.providerPlaceId || i}
                  onClick={() => {
                    setDraft({ ...draft, fromPlace: p });
                    setResults([]);
                  }}
                >
                  <strong>{p.name}</strong>
                  <small>{p.address}</small>
                </button>
              ))}
            </div>
          )}
          <Field label="出发地点名称">
            <input
              value={draft.fromPlace?.name || ''}
              onChange={(e) => place('name', e.target.value)}
            />
          </Field>
          <Field label="出发地址">
            <input
              value={draft.fromPlace?.address || ''}
              onChange={(e) => place('address', e.target.value)}
            />
          </Field>
        </fieldset>
      )}
      <Field label="交通方式">
        <select value={draft.mode} onChange={(e) => setDraft({ ...draft, mode: e.target.value })}>
          {[
            ['walking', '步行'],
            ['driving', '驾车'],
            ['bicycling', '骑行'],
            ['transit', '公共交通'],
          ].map(([v, l]) => (
            <option value={v} key={v}>
              {l}
            </option>
          ))}
        </select>
      </Field>
      <Field label="预计耗时（分钟）">
        <input
          type="number"
          min="0"
          value={draft.minutes ?? ''}
          onChange={(e) =>
            setDraft({
              ...draft,
              minutes: e.target.value === '' ? null : Number(e.target.value),
              manual: true,
            })
          }
        />
      </Field>
      {error && (
        <p className="field-error" role="alert">
          {error}
        </p>
      )}
      <div className="button-row route-editor-actions">
        <AsyncButton
          className="secondary"
          onClick={async () => {
            try {
              setError('');
              const route = await estimateRoute(
                origin.payload.place,
                to.payload.place,
                draft.mode,
                j.snapshot.trip.destination,
              );
              await save({
                ...draft,
                ...route,
                manual: false,
                inputSignature: routeSignature(origin, to, draft.mode),
              });
            } catch (e) {
              setError(errorMessage(e));
            }
          }}
        >
          重新估算
        </AsyncButton>
        <AsyncButton
          className="primary"
          onClick={() => save({ ...draft, inputSignature: routeSignature(origin, to, draft.mode) })}
        >
          完成
        </AsyncButton>
      </div>
      {currentObject && (
        <div className="route-lifecycle">
          <span>{currentObject.state === 'deleted' ? '这段路程已删除' : '路程管理'}</span>
          <ObjectActions journey={j} object={currentObject} prominent />
        </div>
      )}
    </Modal>
  );
}

export function Reschedule({ journey: j, onClose }) {
  const trip = j.snapshot.trip;
  const [startDate, setStart] = useState(trip.startDate || ''),
    [count, setCount] = useState(trip.dayCount || 1),
    [step, setStep] = useState(1),
    [selectingRange, setSelectingRange] = useState(false),
    [strategy, setStrategy] = useState('move'),
    [targets, setTargets] = useState({}),
    [selected, setSelected] = useState(new Set()),
    [error, setError] = useState('');
  const valid = Number.isInteger(Number(count)) && count >= 1 && count <= 365;
  const plan = reschedulePlan(
    j.snapshot,
    startDate || null,
    valid ? Number(count) : 1,
    strategy,
    targets,
    selected,
  );
  const endDate = startDate && valid ? dateAdd(startDate, Number(count) - 1) : '';
  const shift =
    trip.startDate && startDate
      ? Math.round((Date.parse(startDate) - Date.parse(trip.startDate)) / 86400000)
      : 0;
  async function finish() {
    try {
      if (!valid) throw new Error('天数应为 1 至 365。');
      await j.mutate({
        objectId: trip.id,
        kind: 'reschedule',
        patch: {
          startDate: startDate || null,
          dayCount: Number(count),
          moves: plan.affected || strategy === 'custom' ? plan.moves : [],
        },
      });
      onClose();
    } catch (e) {
      setError(errorMessage(e));
    }
  }
  return (
    <Modal title={step === 1 ? '调整旅程日期' : '已有安排怎么办'} onClose={onClose} wide>
      {step === 1 ? (
        <>
          <DateRangePicker
            startDate={startDate}
            endDate={endDate}
            originalStartDate={trip.startDate}
            originalEndDate={dateAdd(trip.startDate, trip.dayCount - 1)}
            onSelectionChange={setSelectingRange}
            onChange={(start, end) => {
              setStart(start);
              setCount(Math.round((Date.parse(end) - Date.parse(start)) / 86400000) + 1);
            }}
          />
          <div className="form-grid">
            <Field label="开始日期">
              <input type="date" value={startDate} onChange={(e) => setStart(e.target.value)} />
            </Field>
            {startDate ? (
              <Field label="结束日期">
                <input
                  type="date"
                  min={startDate}
                  value={endDate}
                  onChange={(e) => {
                    if (e.target.value)
                      setCount(
                        Math.round(
                          (Date.parse(e.target.value) - Date.parse(startDate)) / 86400000,
                        ) + 1,
                      );
                  }}
                />
              </Field>
            ) : (
              <Field label="计划天数">
                <input
                  type="number"
                  min="1"
                  max="365"
                  value={count}
                  onChange={(e) => setCount(e.target.value)}
                />
              </Field>
            )}
          </div>
          <p>{startDate ? `${startDate} – ${endDate} · ${count} 天` : `日期未定 · ${count} 天`}</p>
          <p className="muted">
            原来{' '}
            {trip.startDate
              ? `${trip.startDate} – ${dateAdd(trip.startDate, trip.dayCount - 1)}`
              : '日期未定'}{' '}
            · {trip.dayCount} 天
            {shift ? `，整体${shift > 0 ? '推后' : '提前'} ${Math.abs(shift)} 天` : ''}
          </p>
        </>
      ) : (
        <>
          <div className="reschedule-options">
            {[
              ['move', shift || !trip.startDate ? '跟着一起移动' : '移到最后一天'],
              ['keep', shift ? '留在原来的日期' : '放进行程外安排'],
              ['custom', '逐项选择…'],
            ].map(([value, label]) => (
              <label className="reschedule-option" key={value}>
                <span>
                  <input
                    type="radio"
                    name="date-strategy"
                    checked={strategy === value}
                    onChange={() => setStrategy(value)}
                  />{' '}
                  {label}
                </span>
                {value !== 'custom' &&
                  plan.rows
                    .filter((row) => row.affected)
                    .slice(0, 3)
                    .map((row) => (
                      <small key={row.activity.id}>
                        {row.activity.payload.title}：
                        {row.day.payload.date || `第${row.day.payload.ordinal}天`} →{' '}
                        {value === 'keep'
                          ? row.day.payload.date || `第${row.day.payload.ordinal}天`
                          : row.date || `第${row.ordinal}天`}
                      </small>
                    ))}
              </label>
            ))}
          </div>
          {strategy === 'custom' && (
            <div className="reschedule-list">
              <p className="muted">勾选要移动的安排；其他安排保留原来的日期。</p>
              {plan.rows.map((row) => (
                <div className="check-row reschedule-row" key={row.activity.id}>
                  <label className="reschedule-choice">
                    <input
                      type="checkbox"
                      checked={selected.has(row.activity.id)}
                      onChange={(e) =>
                        setSelected((previous) => {
                          const next = new Set(previous);
                          e.target.checked
                            ? next.add(row.activity.id)
                            : next.delete(row.activity.id);
                          return next;
                        })
                      }
                    />
                    <span>
                      <strong>{row.activity.payload.title}</strong>
                      <small>
                        {row.day.payload.date || `第${row.day.payload.ordinal}天`} →{' '}
                        {row.date || `第${row.ordinal}天`}
                      </small>
                    </span>
                  </label>
                  <select
                    aria-label={`${row.activity.payload.title}移动到哪一天`}
                    value={row.ordinal}
                    onChange={(e) => {
                      setTargets({ ...targets, [row.activity.id]: Number(e.target.value) });
                      setSelected((previous) => new Set([...previous, row.activity.id]));
                    }}
                  >
                    {Array.from({ length: Number(count) }, (_, i) => (
                      <option key={i} value={i + 1}>
                        第{i + 1}天
                      </option>
                    ))}
                  </select>
                </div>
              ))}
            </div>
          )}
          <button className="text-button" onClick={() => setStep(1)}>
            返回选日期
          </button>
        </>
      )}
      {error && (
        <p className="field-error" role="alert">
          {error}
        </p>
      )}
      <AsyncButton
        className="primary full"
        disabled={!valid || selectingRange}
        onClick={step === 1 && plan.affected ? () => setStep(2) : finish}
      >
        {step === 1 && plan.affected ? '下一步' : '完成'}
      </AsyncButton>
    </Modal>
  );
}

function SwapDays({ journey: j, source, onClose }) {
  const days = visibleDays(j.snapshot).filter((day) => day.id !== source.id);
  const [error, setError] = useState('');
  return (
    <Modal title="与另一天交换" onClose={onClose}>
      <p>{dayLabel(source, j.snapshot.trip)}的全部安排将与所选日期对调。</p>
      {days.map((day) => (
        <AsyncButton
          key={day.id}
          className="settings-link"
          onClick={async () => {
            try {
              const moves = active(j.snapshot, 'activity')
                .filter((o) => [source.id, day.id].includes(o.payload.dayId))
                .map((o) => ({
                  activityId: o.id,
                  dayId: o.payload.dayId === source.id ? day.id : source.id,
                }));
              await j.mutate({
                objectId: j.snapshot.trip.id,
                kind: 'reschedule',
                patch: {
                  startDate: j.snapshot.trip.startDate,
                  dayCount: j.snapshot.trip.dayCount,
                  moves,
                },
              });
              onClose();
            } catch (e) {
              setError(errorMessage(e));
            }
          }}
        >
          {dayLabel(day, j.snapshot.trip)} {day.payload.date}
          <ChevronRight size={17} />
        </AsyncButton>
      ))}
      {error && (
        <p className="field-error" role="alert">
          {error}
        </p>
      )}
    </Modal>
  );
}

export default function Itinerary({ journey: j, onEdit, onDates, onDeleted, onViewExpenses }) {
  const [route, setRoute] = useState(null),
    [dayMenuId, setDayMenuId] = useState(null),
    [dragging, setDragging] = useState(null),
    [sorting, setSorting] = useState(false),
    [swapSource, setSwapSource] = useState(null),
    [now, setNow] = useState(() => Date.now());
  const itineraryPage = useRef(null);
  const swipeStart = useRef(null),
    reorderSerial = useRef(Promise.resolve()),
    latestJourney = useRef(j);
  latestJourney.current = j;
  const dragRef = useRef(null),
    dragCleanup = useRef(null),
    dayContent = useRef(null),
    dayStage = useRef(null),
    previousDay = useRef(null),
    dayAnimation = useRef({ incoming: null, height: null, outgoing: new Set() });
  const days = visibleDays(j.snapshot),
    outside = outsideDays(j.snapshot);
  const current = days.find((d) => d.id === j.context.dayId) || days[0];
  useEffect(() => {
    if (!j.context.focusActivityId) return;
    const card = itineraryPage.current?.querySelector(
      `[data-activity-id="${CSS.escape(j.context.focusActivityId)}"]`,
    );
    if (!card) return;
    const outsideSection = card.closest('details.outside');
    if (outsideSection) outsideSection.open = true;
    card.scrollIntoView({ behavior: reducedMotion() ? 'instant' : 'smooth', block: 'center' });
    card.classList.add('activity-focused');
    const timer = setTimeout(() => {
      card.classList.remove('activity-focused');
      j.setContext({ focusActivityId: null });
    }, 1000);
    return () => {
      clearTimeout(timer);
      card.classList.remove('activity-focused');
    };
  }, [j.context.focusActivityId, current?.id]);

  const dayMenu = !!current && dayMenuId === current.id;
  useEffect(() => {
    setDayMenuId(null);
    setSorting(false);
  }, [current?.id]);
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 60000);
    return () => clearInterval(timer);
  }, []);
  useLayoutEffect(() => {
    const element = dayContent.current,
      stage = dayStage.current,
      animations = dayAnimation.current,
      before = previousDay.current;
    if (!element || !stage) return;
    previousDay.current = {
      id: current?.id,
      content: element.cloneNode(true),
      height: element.getBoundingClientRect().height,
    };
    const timing = { duration: 200, easing: 'cubic-bezier(.4,0,.2,1)' };
    function resize(fromHeight) {
      animations.height?.cancel();
      stage.dataset.transitioning = '';
      animations.height = stage.animate(
        [{ height: `${fromHeight}px` }, { height: `${previousDay.current.height}px` }],
        timing,
      );
      animations.height.onfinish = () => {
        delete stage.dataset.transitioning;
      };
    }
    if (!before) return;
    if (before.id === current?.id) {
      if (
        animations.height?.playState === 'running' &&
        Math.abs(before.height - previousDay.current.height) > 0.5
      )
        resize(stage.getBoundingClientRect().height);
      return;
    }
    const opacity =
      animations.incoming?.playState === 'running' ? getComputedStyle(element).opacity : 1;
    const fromHeight =
      animations.height?.playState === 'running'
        ? stage.getBoundingClientRect().height
        : before.height;
    animations.incoming?.cancel();
    animations.height?.cancel();
    if (reducedMotion()) {
      for (const outgoing of animations.outgoing) {
        outgoing.animation.cancel();
        outgoing.element.remove();
      }
      animations.outgoing.clear();
      delete stage.dataset.transitioning;
      return;
    }
    const outgoing = before.content;
    outgoing.className = 'day-content-outgoing';
    outgoing.inert = true;
    outgoing.setAttribute('aria-hidden', 'true');
    stage.append(outgoing);
    stage.dataset.transitioning = '';
    const fade = outgoing.animate([{ opacity }, { opacity: 0 }], timing),
      entry = { element: outgoing, animation: fade };
    animations.outgoing.add(entry);
    fade.onfinish = () => {
      outgoing.remove();
      animations.outgoing.delete(entry);
    };
    animations.incoming = element.animate([{ opacity: 0 }, { opacity: 1 }], timing);
    resize(fromHeight);
  });
  useEffect(() => () => dragCleanup.current?.(), []);
  useEffect(
    () => () => {
      const animations = dayAnimation.current;
      animations.incoming?.cancel();
      animations.height?.cancel();
      for (const outgoing of animations.outgoing) {
        outgoing.animation.cancel();
        outgoing.element.remove();
      }
      animations.outgoing.clear();
    },
    [],
  );
  const list = current ? orderedActivities(j.snapshot, current.id) : [];
  const routes = j.snapshot.objects.filter((o) => o.kind === 'route');
  const estimates = useRouteEstimates(j, list, routes);
  const dateParts = Object.fromEntries(
    new Intl.DateTimeFormat('en-CA', {
      timeZone: j.snapshot.trip.timezone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    })
      .formatToParts(new Date(now))
      .map((p) => [p.type, p.value]),
  );
  const today = `${dateParts.year}-${dateParts.month}-${dateParts.day}`,
    clock = `${dateParts.hour}:${dateParts.minute}`;
  const todayDay = days.find((d) => d.payload.date === today);
  const nextActivity =
    current?.payload.date === today
      ? list.find(
          (o) =>
            o.payload.time?.mode === 'precise' &&
            (o.payload.time.endDayOffset > 0 ||
              (o.payload.time.end || o.payload.time.start) >= clock),
        )
      : null;
  function changeDay(direction) {
    const index = days.findIndex((d) => d.id === current?.id);
    if (days[index + direction]) j.setContext({ dayId: days[index + direction].id });
  }
  function showNext() {
    document
      .querySelector(`[data-activity-id="${CSS.escape(nextActivity.id)}"]`)
      ?.scrollIntoView({ block: 'center', behavior: reducedMotion() ? 'instant' : 'smooth' });
  }

  async function applyMove(list, o, targetId, placeAfter, scope) {
    if (o.id === targetId) return;
    const next = list.filter((item) => item.id !== o.id);
    const targetIndex = next.findIndex((item) => item.id === targetId);
    if (targetIndex < 0) return;
    next.splice(targetIndex + (placeAfter ? 1 : 0), 0, o);
    const index = next.findIndex((item) => item.id === o.id),
      before = next[index - 1],
      afterItem = next[index + 1];
    const beforeOrder = before ? Number(before.payload.order ?? 0) : null,
      afterOrder = afterItem ? Number(afterItem.payload.order ?? 0) : null;
    // Precise times can put the displayed slots in a different order from their
    // stored ranks. Normalize those slots before inserting a flexible activity.
    const remaining = next.filter((item) => item.id !== o.id);
    const ranksInDisplayOrder = remaining.every(
      (item, i) =>
        !i || Number(remaining[i - 1].payload.order ?? 0) < Number(item.payload.order ?? 0),
    );
    if (
      !ranksInDisplayOrder ||
      (beforeOrder !== null && afterOrder !== null && afterOrder - beforeOrder < 0.000001)
    ) {
      await Promise.all(
        next.map((item, itemIndex) =>
          Number(item.payload.order ?? 0) === itemIndex * 1024
            ? null
            : j.mutate(
                { objectId: item.id, kind: 'patch', patch: { order: itemIndex * 1024 } },
                scope,
              ),
        ),
      );
      return;
    }
    const order =
      beforeOrder !== null && afterOrder !== null
        ? (beforeOrder + afterOrder) / 2
        : beforeOrder !== null
          ? beforeOrder + 1
          : afterOrder !== null
            ? afterOrder - 1
            : 0;
    await j.mutate({ objectId: o.id, kind: 'patch', patch: { order } }, scope);
  }
  function queueMove(o, { targetId, direction, placeAfter = false }) {
    const scope = j.captureScope(),
      dayId = o.payload.dayId;
    const task = reorderSerial.current.then(async () => {
      const latest = latestJourney.current;
      if (latest.snapshot.trip.id !== scope.tripId || latest.user.id !== scope.accountId) return;
      const rows = orderedActivities(latest.snapshot, dayId),
        source = rows.find((item) => item.id === o.id);
      if (!source) return;
      const target = direction
        ? rows[rows.findIndex((item) => item.id === o.id) + direction]?.id
        : targetId;
      if (target)
        await applyMove(rows, source, target, direction ? direction > 0 : placeAfter, scope);
    });
    reorderSerial.current = task.catch(() => {});
    return task;
  }
  function moveTo(o, targetId, placeAfter = false) {
    return queueMove(o, { targetId, placeAfter });
  }
  function moveBy(o, direction) {
    return queueMove(o, { direction });
  }
  function beginDrag(event, o) {
    if (event.button !== undefined && event.button !== 0) return;
    event.preventDefault();
    const value = { id: o.id, targetId: o.id, after: false };
    dragRef.current = value;
    setDragging(value);
    const move = (pointerEvent) => updateDrag(pointerEvent);
    const end = () => finishDrag();
    const cancel = () => finishDrag(true);
    document.addEventListener('pointermove', move, { capture: true });
    document.addEventListener('pointerup', end, { capture: true, once: true });
    document.addEventListener('pointercancel', cancel, { capture: true, once: true });
    dragCleanup.current = () => {
      document.removeEventListener('pointermove', move, { capture: true });
      document.removeEventListener('pointerup', end, { capture: true });
      document.removeEventListener('pointercancel', cancel, { capture: true });
    };
  }
  function updateDrag(event) {
    if (!dragRef.current) return;
    const card = document
      .elementFromPoint(event.clientX, event.clientY)
      ?.closest?.('[data-activity-id]');
    if (!card) return;
    const targetId = card.dataset.activityId;
    if (!list.some((item) => item.id === targetId)) return;
    const rect = card.getBoundingClientRect(),
      placeAfter = event.clientY > rect.top + rect.height / 2;
    const value = { ...dragRef.current, targetId, after: placeAfter };
    dragRef.current = value;
    setDragging(value);
  }
  function finishDrag(cancelled = false) {
    const value = dragRef.current;
    dragCleanup.current?.();
    dragCleanup.current = null;
    dragRef.current = null;
    setDragging(null);
    if (cancelled || !value || value.id === value.targetId) return;
    const source = list.find((item) => item.id === value.id);
    if (source) moveTo(source, value.targetId, value.after).catch(() => {});
  }

  function cards(items, sortable = false) {
    return items.map((o, index) => {
      const prev = items[index - 1];
      const matchingRoutes = routes.filter(
        (r) => r.payload.fromId === (prev?.id || null) && r.payload.toId === o.id,
      );
      const leg =
        matchingRoutes.find((r) => r.state === 'active') ||
        matchingRoutes.find((r) => r.state === 'deleted');
      const estimate = prev && !leg ? estimates[routeKey(j.snapshot.trip, prev, o)] : null;
      const routePayload = leg?.state === 'active' ? leg.payload : estimate;
      const mode = { walking: '步行', driving: '驾车', bicycling: '骑行', transit: '公共交通' }[
        leg?.payload.mode || 'walking'
      ];
      const advice = travelAdvice(prev, o, routePayload);
      const depart = advice.depart,
        late = advice.lateMinutes,
        overlap = advice.overlapMinutes;
      const flexible = o.payload.time?.mode !== 'precise';
      const hasRoute = leg?.state === 'deleted' || Number.isFinite(routePayload?.minutes);
      const showRoute =
        !!prev || !!leg || (o.payload.time?.mode === 'precise' && !!o.payload.time.start);
      const notParticipating = o.expressions?.filter((e) => e.notParticipating).length || 0,
        wishDelete = o.expressions?.filter((e) => e.wishDelete).length || 0;
      const linkedExpenses = active(j.snapshot, 'expense').filter(
        (e) => e.payload.activityId === o.id,
      );
      const expenseSummaries = ['paid', 'estimated'].flatMap((status) => {
        const totals = linkedExpenses
          .filter((e) => e.payload.payment.status === status)
          .reduce((totals, e) => {
            const payment = e.payload.payment;
            const summary = (totals[payment.currency] ||= { amount: 0, count: 0, known: false });
            summary.count++;
            if (payment.amountMinor !== null) {
              summary.amount += payment.amountMinor;
              summary.known = true;
            }
            return totals;
          }, {});
        return Object.entries(totals).map(([currency, summary]) => ({
          status,
          currency,
          ...summary,
        }));
      });
      const dropClass =
        dragging?.targetId === o.id && dragging.id !== o.id
          ? dragging.after
            ? ' drop-after'
            : ' drop-before'
          : '';
      return (
        <React.Fragment key={o.id}>
          {showRoute && (
            <div className={`route-slot${hasRoute ? ' has-route' : ''}`}>
              <button
                className={`route-row${hasRoute ? '' : ' route-add'}`}
                aria-label={hasRoute ? undefined : prev ? '添加两站之间的路程' : '设置出发地与路程'}
                title={hasRoute ? undefined : prev ? '添加路程' : '设置出发地与路程'}
                onClick={() => setRoute({ from: prev, to: o, object: leg, estimate })}
              >
                {hasRoute ? <Route size={14} /> : <Plus size={14} />}
                <span>
                  {leg?.state === 'deleted'
                    ? '路程已删除 · 查看与恢复'
                    : hasRoute
                      ? `${mode}约 ${routePayload.minutes} 分钟`
                      : prev
                        ? '路程'
                        : '出发地'}
                  {depart !== null ? ` · 建议 ${depart} 出发` : ''}
                </span>
                {hasRoute && <ChevronRight size={14} />}
              </button>
            </div>
          )}
          <article
            data-activity-id={o.id}
            className={`activity-card${nextActivity?.id === o.id ? ' next-activity' : ''}${dragging?.id === o.id ? ' dragging' : ''}${dropClass}`}
          >
            {sortable && flexible && (
              <button
                className="drag-handle"
                aria-label={`拖动排序：${o.payload.title}`}
                title="拖动调整顺序 · 也可用 ↑ ↓ 键"
                onPointerDown={(event) => beginDrag(event, o)}
                onKeyDown={(event) => {
                  if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
                    event.preventDefault();
                    moveBy(o, event.key === 'ArrowUp' ? -1 : 1).catch(() => {});
                  }
                }}
              >
                <GripVertical size={18} />
              </button>
            )}

            <div className="activity-number">{index + 1}</div>
            <div className="activity-content">
              <button className="activity-main" onClick={() => onEdit(o)}>
                {timeLabel(o.payload) && (
                  <span className="activity-time">
                    {timeLabel(o.payload)}
                    {!flexible && (
                      <span
                        className="activity-time-lock"
                        title="按具体时间排列，改时间即可调整位置"
                      >
                        <LockKeyhole size={12} />
                      </span>
                    )}
                    {nextActivity?.id === o.id && <span className="next-label">下一项</span>}
                  </span>
                )}
                <h3>{o.payload.title}</h3>
                {o.payload.buffers?.before !== null && o.payload.buffers?.before !== undefined && (
                  <small>提前 {o.payload.buffers.before} 分钟到场</small>
                )}
              </button>
              {o.payload.place?.name && (
                <div className="activity-place-row">
                  <button
                    className="activity-place"
                    aria-label="地图"
                    title={`在地图查看：${o.payload.place.name}`}
                    onClick={() =>
                      j.setContext({
                        page: 'map',
                        map: { ...j.context.map, dayId: o.payload.dayId, selectedActivityId: o.id },
                      })
                    }
                  >
                    <MapPin size={14} />
                    <span>{o.payload.place.name}</span>
                  </button>
                  {located(o.payload.place) && (
                    <a
                      className="activity-navigation"
                      aria-label={`导航到${o.payload.place.name}`}
                      title="导航到这里"
                      target="_blank"
                      rel="noreferrer"
                      href={`https://uri.amap.com/navigation?to=${o.payload.place.lng},${o.payload.place.lat},${encodeURIComponent(o.payload.place.name)}&mode=car&coordinate=gaode&callnative=1`}
                    >
                      <Navigation size={15} />
                    </a>
                  )}
                </div>
              )}
              {(late > 0 || overlap > 0) && (
                <p className="timing-note">
                  {late ? `按当前安排会晚 ${late} 分钟到场` : `与上一项安排重叠 ${overlap} 分钟`}
                </p>
              )}
              {o.payload.notes && (
                <p className="activity-notes" title={o.payload.notes}>
                  {o.payload.notes}
                </p>
              )}
              <div className="activity-toolbar">
                {(expenseSummaries.length > 0 || notParticipating > 0 || wishDelete > 0) && (
                  <div className="activity-opinions">
                    {expenseSummaries.map(({ status, currency, amount, count, known }) => (
                      <button
                        className="activity-expense-link"
                        key={`${status}-${currency}`}
                        onClick={() => onViewExpenses(o.id)}
                      >
                        <Wallet size={14} />
                        {status === 'paid' ? '已付' : '预计'}{' '}
                        {known ? money(amount, currency) : '金额待补'} · {count} 笔
                      </button>
                    ))}
                    {notParticipating > 0 && <span>{notParticipating} 人不参加</span>}
                    {wishDelete > 0 && (
                      <span>
                        {wishDelete}/{j.snapshot.members.length} 希望删除
                      </span>
                    )}
                  </div>
                )}
                <div className="activity-controls">
                  <details className="activity-more">
                    <summary aria-label={`活动更多操作：${o.payload.title}`} title="活动更多操作">
                      <MoreHorizontal size={19} />
                    </summary>
                    <div className="activity-more-panel">
                      <ObjectActions journey={j} object={o}>
                        <button
                          className="text-button"
                          onClick={(event) => {
                            event.currentTarget.closest('details').open = false;
                            onEdit(o);
                          }}
                        >
                          <Pencil size={16} />
                          编辑
                        </button>
                        {o.payload.place && (
                          <button
                            className="text-button"
                            onClick={(event) => {
                              event.currentTarget.closest('details').open = false;
                              j.setContext({
                                page: 'map',
                                map: {
                                  ...j.context.map,
                                  dayId: o.payload.dayId,
                                  selectedActivityId: o.id,
                                },
                              });
                            }}
                          >
                            <MapPin size={16} />
                            在地图查看
                          </button>
                        )}
                      </ObjectActions>
                    </div>
                  </details>
                </div>
              </div>
            </div>
          </article>
        </React.Fragment>
      );
    });
  }

  return (
    <div ref={itineraryPage} className={`page itinerary-page${sorting ? ' is-sorting' : ''}`}>
      <h1 className="sr-only">行程</h1>
      {swapSource && (
        <SwapDays journey={j} source={swapSource} onClose={() => setSwapSource(null)} />
      )}
      {sorting && (
        <div className="sorting-banner">
          <span>按住 ⋮⋮ 拖动调整顺序；有具体时间的安排会按时间自动排列</span>
          <button className="text-button" onClick={() => setSorting(false)}>
            完成
          </button>
        </div>
      )}
      <div className="itinerary-toolbar">
        {((todayDay && todayDay.id !== current?.id) || nextActivity) && (
          <nav className="day-browse-actions" aria-label="浏览行程">
            {todayDay && todayDay.id !== current?.id && (
              <button
                className="secondary day-jump desktop-today-jump"
                onClick={() => j.setContext({ dayId: todayDay.id })}
              >
                <LocateFixed size={16} />
                回到今天
              </button>
            )}
            {nextActivity && (
              <button className="secondary day-jump" onClick={showNext}>
                <ArrowDownToLine size={16} />
                下一项 {nextActivity.payload.time.start}
              </button>
            )}
          </nav>
        )}

        <ScrollableTabs
          selection
          activeKey={current?.id}
          className="itinerary-date-tabs"
          trackClassName="day-tabs"
          role="tablist"
          aria-label="计划日"
        >
          {days.map((d) => (
            <button
              key={d.id}
              role="tab"
              aria-selected={d.id === current?.id}
              className={`${d.id === current?.id ? 'selected' : ''}${d.payload.date === today ? ' is-today' : ''}`}
              aria-current={d.payload.date === today ? 'date' : undefined}
              onClick={() => j.setContext({ dayId: d.id })}
            >
              <strong>{dayLabel(d, j.snapshot.trip)}</strong>
              {d.payload.date && (
                <small>
                  {d.payload.date === today ? '今天' : d.payload.date.slice(5).replace('-', ' / ')}
                </small>
              )}
            </button>
          ))}
        </ScrollableTabs>
        {current && (
          <div
            className="mobile-day-bar"
            onTouchStart={(e) => {
              swipeStart.current = [e.touches[0].clientX, e.touches[0].clientY];
            }}
            onTouchEnd={(e) => {
              const start = swipeStart.current;
              swipeStart.current = null;
              if (start) {
                const dx = e.changedTouches[0].clientX - start[0],
                  dy = e.changedTouches[0].clientY - start[1];
                if (Math.abs(dx) > 55 && Math.abs(dx) > Math.abs(dy) * 1.5)
                  changeDay(dx < 0 ? 1 : -1);
              }
            }}
          >
            <button
              className="icon-button"
              aria-label="前一天"
              disabled={current.id === days[0]?.id}
              onClick={() => changeDay(-1)}
            >
              <ChevronLeft size={18} />
            </button>
            <select
              aria-label="当前计划日"
              value={current.id}
              onChange={(e) =>
                j.setContext({ dayId: e.target.value === 'today' ? todayDay.id : e.target.value })
              }
            >
              {todayDay && todayDay.id !== current.id && <option value="today">回到今天</option>}
              {days.map((d) => (
                <option value={d.id} key={d.id}>
                  {dayLabel(d, j.snapshot.trip)}
                  {d.payload.date ? ` ${d.payload.date.slice(5).replace('-', '/')}` : ''}
                  {d.payload.date === today ? ' · 今天' : ''}
                </option>
              ))}
            </select>
            <button
              className="icon-button"
              aria-label="后一天"
              disabled={current.id === days.at(-1)?.id}
              onClick={() => changeDay(1)}
            >
              <ChevronRight size={18} />
            </button>
            {todayDay && todayDay.id !== current.id && (
              <button
                className="icon-button mobile-today-jump"
                aria-label="回到今天"
                onClick={() => j.setContext({ dayId: todayDay.id })}
              >
                <LocateFixed size={17} />
              </button>
            )}
          </div>
        )}
        <div className="day-heading">
          <div className="button-row">
            <button
              className="primary small day-add"
              disabled={!current}
              onClick={() => onEdit(null, { dayId: current.id })}
            >
              <Plus size={16} />
              添加活动
            </button>
            {current && (
              <button
                className="icon-button compact"
                aria-label="当天操作"
                aria-expanded={dayMenu}
                onClick={() => setDayMenuId(dayMenu ? null : current.id)}
              >
                <MoreHorizontal size={18} />
              </button>
            )}
          </div>
        </div>
      </div>
      {nextActivity && (
        <nav className="mobile-next-activity" aria-label="浏览行程">
          <button className="secondary day-jump" onClick={showNext}>
            <ArrowDownToLine size={16} />
            下一项 {nextActivity.payload.time.start}
          </button>
        </nav>
      )}
      {!current && j.snapshot.objects.some((o) => o.kind === 'day' && o.state === 'deleted') && (
        <button className="text-button deleted-days-entry" onClick={onDeleted}>
          已删除的计划日
          <ChevronRight size={14} />
        </button>
      )}
      {current && (
        <button
          className="primary itinerary-add-fab"
          onClick={() => onEdit(null, { dayId: current.id })}
        >
          <Plus size={18} />
          添加活动
        </button>
      )}
      <div className="day-content-stage" ref={dayStage}>
        <div className="day-content" ref={dayContent}>
          {current && dayMenu && (
            <div className="day-lifecycle">
              <span>
                {dayLabel(current, j.snapshot.trip)}
                {current.payload.date ? ` · ${current.payload.date}` : ''}
              </span>
              <div className="day-menu-actions">
                <button
                  className="text-button mobile-sort-entry"
                  onClick={() => {
                    setSorting(true);
                    setDayMenuId(null);
                  }}
                >
                  调整顺序
                </button>
                <button
                  className="text-button"
                  disabled={days.length < 2}
                  onClick={() => {
                    setSwapSource(current);
                    setDayMenuId(null);
                  }}
                >
                  与另一天交换…
                </button>
                <button
                  className="text-button"
                  onClick={() => {
                    setDayMenuId(null);
                    onDates();
                  }}
                >
                  <CalendarDays size={16} />
                  调整日期与天数…
                </button>
                {j.snapshot.objects.some((o) => o.kind === 'day' && o.state === 'deleted') && (
                  <button className="text-button" onClick={onDeleted}>
                    已删除的计划日
                    <ChevronRight size={14} />
                  </button>
                )}
                <ObjectActions journey={j} object={current} />
              </div>
            </div>
          )}
          <div className="activity-list">
            {list.length ? (
              cards(list, true)
            ) : (
              <Empty
                icon={CalendarDays}
                title="这一天还没有安排"
                action={
                  <button
                    className="secondary"
                    disabled={!current}
                    onClick={() => onEdit(null, { dayId: current.id })}
                  >
                    <Plus size={16} />
                    添加第一项安排
                  </button>
                }
              >
                添加活动，或到地图查找想去的地方。
              </Empty>
            )}
          </div>
          {current && (
            <div className="continuations">
              {active(j.snapshot, 'activity')
                .filter((o) => o.payload.time?.endDayOffset > 0)
                .filter((o) => {
                  const d = active(j.snapshot, 'day').find((d) => d.id === o.payload.dayId);
                  return (
                    d &&
                    d.payload.ordinal < current.payload.ordinal &&
                    d.payload.ordinal + o.payload.time.endDayOffset >= current.payload.ordinal
                  );
                })
                .map((o) => (
                  <button className="continuation" key={o.id} onClick={() => onEdit(o)}>
                    <span>从前一天延续</span>
                    <strong>{o.payload.title}</strong>
                    <small>{timeLabel(o.payload)}</small>
                  </button>
                ))}
            </div>
          )}
        </div>
      </div>
      {outside.length > 0 && (
        <details className="outside">
          <summary>行程外安排</summary>
          {outside.map((d) => (
            <section key={d.id}>
              <h3>{d.payload.date || `原计划第${d.payload.ordinal}天`}</h3>
              {cards(orderedActivities(j.snapshot, d.id))}
            </section>
          ))}
        </details>
      )}
      {route && <RouteEditor journey={j} {...route} onClose={() => setRoute(null)} />}
    </div>
  );
}
