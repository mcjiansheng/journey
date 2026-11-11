import React, { useState, useRef, useMemo, useLayoutEffect, useEffect } from 'react';
import { BoardWidget } from './widgets/index.jsx';
import { MapDetailContext } from './widgets/map-context.js';
import { WIDGET_SIZES } from '../board-widgets.js';
import { NOTE, NOTE_NAMES, nearestDock } from '../board.js';
import { orderedActivities, visibleDays, dayLabel, timeLabel } from '../domain.js';

const EMOJIS = [
  '✈️',
  '🚄',
  '🏨',
  '🍜',
  '☕️',
  '🍣',
  '⛩️',
  '🎡',
  '📸',
  '🗺️',
  '🛍️',
  '🌸',
  '🏔️',
  '🏖️',
  '🎉',
  '✨',
  '❤️',
  '💡',
];

export const DOCKS = ['left', 'right', 'bottom'];
const DOCK_NAMES = { left: '左侧', right: '右侧', bottom: '底部' };
const PREVIEW_SCALE = 0.48;
const WEEKDAYS = ['日', '一', '二', '三', '四', '五', '六'];
const DRAG_THRESHOLD = 4;

function prefersReducedMotion() {
  const m = document.documentElement.dataset.motion;
  if (m === 'true') return true;
  if (m === 'false') return false;
  return matchMedia('(prefers-reduced-motion: reduce)').matches;
}

function dateText(iso) {
  if (!iso) return '';
  const [y, m, d] = iso.split('-').map(Number);
  const wd = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  return `${m}/${d} 周${WEEKDAYS[wd]}`;
}

/** Scaled, non-interactive widget preview (旧 P2-16). */
const Preview = React.memo(function Preview({ content, size, snapshot, scale = PREVIEW_SCALE }) {
  const [bw, bh] = WIDGET_SIZES[size] || [168, 168];
  const item = {
    content: { type: 'widget', ...content },
    style: { size },
    frame: { x: 0, y: 0, w: bw * scale, h: bh * scale },
  };
  return (
    <div className="thumb" style={{ width: bw * scale, height: bh * scale }} aria-hidden="true">
      <BoardWidget item={item} snapshot={snapshot} />
    </div>
  );
});

export function BoardStickerPanel({
  snapshot,
  open,
  onClose,
  dock = 'left',
  onDockChange,
  narrow = false,
  onAdd,
  onDropOnCanvas,
  onUploadImage,
}) {
  const [tab, setTab] = useState('widget');
  const [query, setQuery] = useState('');
  const [expanded, setExpanded] = useState(false);
  const [dockDrag, setDockDrag] = useState(null); // { x, y, target }
  const [dockMenu, setDockMenu] = useState(false);
  const [announce, setAnnounce] = useState('');
  const [itemDrag, setItemDrag] = useState(null); // { spec, x, y }
  const [dayId, setDayId] = useState(null);
  const [allPlaces, setAllPlaces] = useState(false);
  const fileInputRef = useRef(null);
  const panelRef = useRef(null);
  const dockGestureRef = useRef(null);
  const itemGestureRef = useRef(null);
  const flipRef = useRef(null);
  const lastDragEndRef = useRef(0);

  const days = useMemo(() => (snapshot ? visibleDays(snapshot) : []), [snapshot]);
  const favorites = useMemo(
    () => (snapshot?.objects || []).filter((o) => o.kind === 'favorite' && o.state === 'active'),
    [snapshot],
  );
  const q = query.trim().toLowerCase();
  const dayRows = useMemo(
    () =>
      days.map((d) => {
        const acts = orderedActivities(snapshot, d.id);
        return {
          day: d,
          label: dayLabel(d, snapshot.trip),
          date: dateText(d.payload.date),
          acts,
          located: acts.filter((a) => a.payload.place?.lng != null && a.payload.place?.lat != null)
            .length,
        };
      }),
    [days, snapshot],
  );
  const matches = (...texts) =>
    !q ||
    texts.some((t) =>
      String(t || '')
        .toLowerCase()
        .includes(q),
    );

  // FLIP: after the dock changes, animate from the floating card's rect.
  useLayoutEffect(() => {
    const from = flipRef.current;
    const el = panelRef.current;
    flipRef.current = null;
    if (!from || !el || prefersReducedMotion()) return;
    const to = el.getBoundingClientRect();
    if (!to.width || !to.height) return;
    el.animate(
      [
        {
          transformOrigin: '0 0',
          transform: `translate(${from.left - to.left}px, ${from.top - to.top}px) scale(${from.width / to.width}, ${from.height / to.height})`,
        },
        { transformOrigin: '0 0', transform: 'none' },
      ],
      { duration: 200, easing: 'cubic-bezier(.2,.8,.2,1)' },
    );
  }, [dock]);

  useEffect(() => {
    if (!dockMenu) return undefined;
    const close = () => setDockMenu(false);
    window.addEventListener('pointerdown', close);
    return () => window.removeEventListener('pointerdown', close);
  }, [dockMenu]);

  useEffect(() => {
    if (!dockDrag) return undefined;
    const onKey = (e) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        dockGestureRef.current = null;
        setDockDrag(null);
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [Boolean(dockDrag)]);

  if (!open) return null;

  const changeDock = (next) => {
    if (!DOCKS.includes(next)) return;
    onDockChange?.(next);
    setAnnounce(`贴纸面板已停靠在${DOCK_NAMES[next]}`);
  };

  // ---- Dock drag (handle / header) ----
  const onDockPointerDown = (e) => {
    if (narrow || e.button !== 0) return;
    if (e.target.closest('button:not(.dock-handle), input')) return;
    dockGestureRef.current = { id: e.pointerId, sx: e.clientX, sy: e.clientY, started: false };
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {}
  };
  const onDockPointerMove = (e) => {
    const g = dockGestureRef.current;
    if (!g || g.id !== e.pointerId) return;
    if (!g.started && Math.hypot(e.clientX - g.sx, e.clientY - g.sy) < DRAG_THRESHOLD) return;
    g.started = true;
    g.next = { x: e.clientX, y: e.clientY };
    if (!g.raf)
      g.raf = requestAnimationFrame(() => {
        g.raf = 0;
        if (dockGestureRef.current !== g) return;
        const { x, y } = g.next;
        setDockDrag({ x, y, target: nearestDock(x, y, window.innerWidth, window.innerHeight) });
      });
  };
  const onDockPointerUp = (e) => {
    const g = dockGestureRef.current;
    dockGestureRef.current = null;
    if (!g || !g.started) return;
    cancelAnimationFrame(g.raf);
    const target = nearestDock(e.clientX, e.clientY, window.innerWidth, window.innerHeight);
    flipRef.current = panelRef.current?.getBoundingClientRect() || null;
    setDockDrag(null);
    if (target !== dock) changeDock(target);
    else flipRef.current = null;
  };
  const onDockLost = () => {
    if (dockGestureRef.current?.started) return; // pointerup handles commit
    dockGestureRef.current = null;
  };
  const onHandleKeyDown = (e) => {
    const map = { ArrowLeft: 'left', ArrowRight: 'right', ArrowDown: 'bottom' };
    if (map[e.key]) {
      e.preventDefault();
      changeDock(map[e.key]);
    }
  };

  // ---- Items: click to add at center, drag onto the canvas ----
  const itemHandlers = (spec) => ({
    onPointerDown: (e) => {
      if (e.button !== 0) return;
      itemGestureRef.current = { spec, sx: e.clientX, sy: e.clientY, started: false };
      try {
        e.currentTarget.setPointerCapture(e.pointerId);
      } catch {}
    },
    onPointerMove: (e) => {
      const g = itemGestureRef.current;
      if (!g) return;
      if (!g.started && Math.hypot(e.clientX - g.sx, e.clientY - g.sy) < DRAG_THRESHOLD) return;
      g.started = true;
      setItemDrag({ spec, x: e.clientX, y: e.clientY });
    },
    onPointerUp: (e) => {
      const g = itemGestureRef.current;
      itemGestureRef.current = null;
      if (!g?.started) return;
      lastDragEndRef.current = Date.now();
      setItemDrag(null);
      const panelRect = panelRef.current?.getBoundingClientRect();
      const overPanel =
        panelRect &&
        e.clientX >= panelRect.left &&
        e.clientX <= panelRect.right &&
        e.clientY >= panelRect.top &&
        e.clientY <= panelRect.bottom;
      if (!overPanel) onDropOnCanvas?.(spec, e.clientX, e.clientY);
    },
    onPointerCancel: () => {
      itemGestureRef.current = null;
      setItemDrag(null);
    },
    onClick: () => {
      // A drag ends with a click event too; only a plain click adds at center.
      if (Date.now() - lastDragEndRef.current < 300) return;
      onAdd?.(spec);
    },
  });
  const widgetSpec = (content, size, extra = {}) => ({ type: 'widget', content, size, ...extra });

  const handleFileChange = (e) => {
    const files = Array.from(e.target.files || []);
    for (const f of files) onUploadImage(f);
    e.target.value = '';
  };

  const overviews = [
    { label: '倒计时', content: { kind: 'countdown' }, size: 'S' },
    { label: '当地时间', content: { kind: 'clock' }, size: 'S' },
    { label: '费用', content: { kind: 'expense' }, size: 'S' },
  ];
  const PLACE_LIMIT = 6;

  const visibleDayRows = dayRows.filter((r) =>
    matches(
      r.label,
      r.date,
      ...r.acts.map((a) => a.payload.title),
      ...r.acts.map((a) => a.payload.place?.name),
    ),
  );
  const visibleFavorites = favorites.filter((f) =>
    matches(f.payload.name, f.payload.address, f.payload.category),
  );
  const shownPlaces = allPlaces || q ? visibleFavorites : visibleFavorites.slice(0, PLACE_LIMIT);
  // One day at a time: a row of day chips instead of a list that grows with
  // the trip. Defaults to today when the trip is under way.
  let todayIso = '';
  try {
    todayIso = new Intl.DateTimeFormat('en-CA', {
      timeZone: snapshot?.trip?.timezone || undefined,
    }).format(new Date());
  } catch {}
  const currentRow =
    visibleDayRows.find((r) => r.day.id === dayId) ||
    visibleDayRows.find((r) => r.day.payload.date === todayIso) ||
    visibleDayRows[0];
  const currentActs = currentRow
    ? currentRow.acts.filter((a) =>
        matches(a.payload.title, a.payload.place?.name, currentRow.label, currentRow.date),
      )
    : [];
  const online = typeof navigator === 'undefined' || navigator.onLine !== false;

  const layout = narrow ? 'sheet-bottom' : `dock-${dockDrag ? 'floating' : dock}`;
  const floatingStyle = dockDrag ? { left: dockDrag.x - 140, top: dockDrag.y - 20 } : undefined;

  return (
    <>
      {dockDrag &&
        DOCKS.map((k) => (
          <div
            key={k}
            className={`dock-target ${k} ${dockDrag.target === k ? 'on' : ''}`}
            aria-hidden="true"
          />
        ))}
      <div
        id="panel"
        ref={panelRef}
        className={`ui sheet glass on ${layout} ${expanded ? 'expanded' : ''} ${dockDrag ? 'dragging' : ''}`}
        style={floatingStyle}
        role="dialog"
        aria-label="贴纸与小组件"
      >
        <header
          onPointerDown={onDockPointerDown}
          onPointerMove={onDockPointerMove}
          onPointerUp={onDockPointerUp}
          onLostPointerCapture={onDockLost}
        >
          {narrow ? (
            <button
              className="sheet-grabber"
              aria-label={expanded ? '收起面板' : '展开面板'}
              onClick={() => setExpanded((v) => !v)}
            />
          ) : (
            <button
              className="dock-handle"
              aria-label={`移动面板（当前停靠：${DOCK_NAMES[dock]}）`}
              title="拖动到左侧、右侧或底部；也可用方向键切换"
              onKeyDown={onHandleKeyDown}
              onContextMenu={(e) => {
                e.preventDefault();
                setDockMenu(true);
              }}
            >
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <circle cx="9" cy="7" r="1.4" />
                <circle cx="15" cy="7" r="1.4" />
                <circle cx="9" cy="12" r="1.4" />
                <circle cx="15" cy="12" r="1.4" />
                <circle cx="9" cy="17" r="1.4" />
                <circle cx="15" cy="17" r="1.4" />
              </svg>
            </button>
          )}
          <h2>贴纸与小组件</h2>
          <button className="iconbtn" onClick={onClose} aria-label="关闭">
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="M6 6l12 12M18 6 6 18" />
            </svg>
          </button>
          {dockMenu && (
            <div className="dock-menu glass" role="menu" onPointerDown={(e) => e.stopPropagation()}>
              {DOCKS.map((k) => (
                <button
                  key={k}
                  role="menuitemradio"
                  aria-checked={dock === k}
                  onClick={() => {
                    setDockMenu(false);
                    changeDock(k);
                  }}
                >
                  停靠在{DOCK_NAMES[k]}
                </button>
              ))}
            </div>
          )}
        </header>
        <span className="sr-only" aria-live="polite">
          {announce}
        </span>

        <div className="panel-main">
          <div className="tabs" role="tablist" aria-label="贴纸类型">
            {[
              ['widget', '小组件'],
              ['note', '便签'],
              ['emoji', '表情'],
              ['image', '图片'],
            ].map(([id, label]) => (
              <button key={id} role="tab" aria-selected={tab === id} onClick={() => setTab(id)}>
                {label}
              </button>
            ))}
          </div>

          <div className="body">
            {tab === 'widget' && (
              <MapDetailContext.Provider value={online}>
                <div className="widget-gallery">
                  <input
                    className="panel-search"
                    type="search"
                    value={query}
                    placeholder="搜索活动、地点或第几天"
                    aria-label="搜索小组件"
                    onChange={(e) => setQuery(e.target.value)}
                  />

                  {!q && (
                    <section className="group-block">
                      <div className="group">概览</div>
                      <div className="gallery tile-grid">
                        {overviews.map((o) => (
                          <button
                            key={o.label}
                            className="tile"
                            aria-label={`添加${o.label}`}
                            {...itemHandlers(widgetSpec(o.content, o.size))}
                          >
                            <Preview
                              content={o.content}
                              size={o.size}
                              snapshot={snapshot}
                              scale={0.55}
                            />
                            <span>{o.label}</span>
                          </button>
                        ))}
                      </div>
                    </section>
                  )}

                  {visibleFavorites.length > 0 && (
                    <section className="group-block">
                      <div className="group-head">
                        <div className="group">
                          地点 <small>{visibleFavorites.length}</small>
                        </div>
                        {!q && visibleFavorites.length > PLACE_LIMIT && (
                          <button className="link-btn" onClick={() => setAllPlaces((v) => !v)}>
                            {allPlaces ? '收起' : `全部 ${visibleFavorites.length} 个`}
                          </button>
                        )}
                      </div>
                      <div className="tile-grid">
                        {shownPlaces.map((f) => (
                          <button
                            key={f.id}
                            className="tile"
                            aria-label={`添加地点：${f.payload.name}`}
                            title={f.payload.name}
                            {...itemHandlers(widgetSpec({ kind: 'place', favoriteId: f.id }, 'S'))}
                          >
                            <Preview
                              content={{ kind: 'place', favoriteId: f.id }}
                              size="S"
                              snapshot={snapshot}
                              scale={0.55}
                            />
                            <span className="ellipsis">{f.payload.name}</span>
                          </button>
                        ))}
                      </div>
                    </section>
                  )}

                  {visibleDayRows.length > 0 && currentRow && (
                    <section className="group-block">
                      <div className="group">日程</div>
                      <div className="day-chips" role="tablist" aria-label="选择哪一天">
                        {visibleDayRows.map((r) => (
                          <button
                            key={r.day.id}
                            role="tab"
                            aria-selected={r === currentRow}
                            className={`day-chip ${r.acts.length ? 'has-acts' : ''}`}
                            title={`${r.label} ${r.date}`}
                            onClick={() => setDayId(r.day.id)}
                          >
                            <b>{r.label.replace(/[第天]/g, '')}</b>
                            <small>{r.date.split(' ')[0]}</small>
                          </button>
                        ))}
                      </div>
                      <div className="day-detail">
                        <div className="day-title">
                          <b>{currentRow.label}</b>
                          <span>
                            {currentRow.date}
                            {currentRow.date ? ' · ' : ''}
                            {currentRow.acts.length
                              ? `${currentRow.acts.length} 项安排`
                              : '还没有安排'}
                          </span>
                        </div>
                        <div className="day-previews">
                          <button
                            className="tile"
                            aria-label={`添加${currentRow.label}概览`}
                            {...itemHandlers(
                              widgetSpec({ kind: 'day', dayId: currentRow.day.id }, 'M'),
                            )}
                          >
                            <Preview
                              content={{ kind: 'day', dayId: currentRow.day.id }}
                              size="M"
                              snapshot={snapshot}
                              scale={0.44}
                            />
                            <span>概览</span>
                          </button>
                          {currentRow.located >= 2 ? (
                            <button
                              className="tile"
                              aria-label={`添加${currentRow.label}路线`}
                              {...itemHandlers(
                                widgetSpec({ kind: 'route', dayId: currentRow.day.id }, 'M'),
                              )}
                            >
                              <Preview
                                content={{ kind: 'route', dayId: currentRow.day.id }}
                                size="M"
                                snapshot={snapshot}
                                scale={0.44}
                              />
                              <span>路线</span>
                            </button>
                          ) : (
                            <div className="tile tile-empty" aria-label="路线不可用">
                              <div className="thumb-empty">至少 2 个有位置的安排才能显示路线</div>
                              <span>路线</span>
                            </div>
                          )}
                        </div>
                        {currentActs.length > 0 && (
                          <ul className="act-list">
                            {currentActs.map((a) => (
                              <li key={a.id} className="act-row">
                                <span className="act-icon" aria-hidden="true">
                                  {a.payload.place ? '📍' : '•'}
                                </span>
                                <span className="act-title">
                                  <b>{a.payload.title}</b>
                                  <small>{timeLabel(a.payload) || '时间待定'}</small>
                                </span>
                                <button
                                  className="chip-btn"
                                  aria-label={`以小号添加 ${a.payload.title}`}
                                  {...itemHandlers(
                                    widgetSpec({ kind: 'activity', activityId: a.id }, 'S'),
                                  )}
                                >
                                  小
                                </button>
                                <button
                                  className="chip-btn"
                                  aria-label={`以中号添加 ${a.payload.title}`}
                                  {...itemHandlers(
                                    widgetSpec({ kind: 'activity', activityId: a.id }, 'M'),
                                  )}
                                >
                                  中
                                </button>
                              </li>
                            ))}
                          </ul>
                        )}
                      </div>
                    </section>
                  )}

                  {q && !visibleDayRows.length && !visibleFavorites.length && (
                    <p className="panel-empty">没有找到「{query.trim()}」</p>
                  )}
                </div>
              </MapDetailContext.Provider>
            )}

            {tab === 'note' && (
              <div className="grid c3 note-grid">
                {Object.keys(NOTE).map((id) => (
                  <button
                    key={id}
                    className="pick-note"
                    style={{ backgroundColor: NOTE[id] }}
                    title={NOTE_NAMES[id]}
                    aria-label={`添加${NOTE_NAMES[id]}便签`}
                    {...itemHandlers({ type: 'note', color: id })}
                  />
                ))}
              </div>
            )}

            {tab === 'emoji' && (
              <div className="grid c6 emoji-grid">
                {EMOJIS.map((e) => (
                  <button
                    key={e}
                    className="pick-emoji"
                    aria-label={`添加表情 ${e}`}
                    {...itemHandlers({ type: 'emoji', char: e })}
                  >
                    {e}
                  </button>
                ))}
              </div>
            )}

            {tab === 'image' && (
              <div className="image-tab">
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/jpeg,image/png,image/webp,image/gif"
                  multiple
                  hidden
                  onChange={handleFileChange}
                />
                <button className="upload" onClick={() => fileInputRef.current?.click()}>
                  + 上传图片或 GIF
                </button>
                <div className="hint">
                  支持 JPG、PNG、WebP（自动压缩至 2048px，≤1.5MB）与动画 GIF（原样保留，≤5MB）。
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      {itemDrag && (
        <div
          className="panel-drag-ghost"
          aria-hidden="true"
          style={{ left: itemDrag.x, top: itemDrag.y }}
        >
          {itemDrag.spec.type === 'widget' ? (
            <Preview
              content={itemDrag.spec.content}
              size={itemDrag.spec.size}
              snapshot={snapshot}
            />
          ) : itemDrag.spec.type === 'note' ? (
            <div className="ghost-note" style={{ background: NOTE[itemDrag.spec.color] }} />
          ) : (
            <div className="ghost-emoji">{itemDrag.spec.char}</div>
          )}
        </div>
      )}
    </>
  );
}
