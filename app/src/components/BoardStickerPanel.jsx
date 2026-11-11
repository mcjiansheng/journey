import React, { useState, useRef, useMemo, useLayoutEffect, useEffect } from 'react';
import { BoardWidget } from './widgets/index.jsx';
import { MapDetailContext } from './widgets/map-context.js';
import { WIDGET_SIZES, placeGroups, markGroupName } from '../board-widgets.js';
import { NOTE, NOTE_NAMES, nearestDock, stickerUrl } from '../board.js';
import { markColors, markPaths } from '../marks.js';
import { orderedActivities, visibleDays, dayLabel, timeLabel } from '../domain.js';

const RECENT_KEY = 'journey.recentEmoji';
const RECENT_MAX = 24;
const STICKER_TYPES = 'image/png,image/jpeg,image/webp,image/gif';

function loadRecent() {
  try {
    const v = JSON.parse(localStorage.getItem(RECENT_KEY) || '[]');
    return Array.isArray(v) ? v.filter((x) => typeof x === 'string').slice(0, RECENT_MAX) : [];
  } catch {
    return [];
  }
}
function saveRecent(list) {
  try {
    localStorage.setItem(RECENT_KEY, JSON.stringify(list));
  } catch {}
}
function graphemes(text) {
  try {
    const seg = new Intl.Segmenter('zh', { granularity: 'grapheme' });
    return Array.from(seg.segment(text), (x) => x.segment);
  } catch {
    return Array.from(text);
  }
}

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
  stickers = [],
  onUploadSticker,
  onRemoveSticker,
}) {
  const [tab, setTab] = useState('widget');
  const [query, setQuery] = useState('');
  const [expanded, setExpanded] = useState(false);
  const [dockDrag, setDockDrag] = useState(null); // { x, y, target }
  const [dockMenu, setDockMenu] = useState(false);
  const [announce, setAnnounce] = useState('');
  const [itemDrag, setItemDrag] = useState(null); // { spec, x, y }
  const [dayId, setDayId] = useState(null);
  const [placeKey, setPlaceKey] = useState(null);
  const [recentEmoji, setRecentEmoji] = useState(loadRecent);
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
  const groups = useMemo(() => placeGroups(snapshot), [snapshot]);
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
  const used = (spec) => {
    if (spec.type !== 'emoji') return;
    setRecentEmoji((list) => {
      const next = [spec.char, ...list.filter((c) => c !== spec.char)].slice(0, RECENT_MAX);
      saveRecent(next);
      return next;
    });
  };
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
      if (!overPanel) {
        used(spec);
        onDropOnCanvas?.(spec, e.clientX, e.clientY);
      }
    },
    onPointerCancel: () => {
      itemGestureRef.current = null;
      setItemDrag(null);
    },
    onClick: () => {
      // A drag ends with a click event too; only a plain click adds at center.
      if (Date.now() - lastDragEndRef.current < 300) return;
      used(spec);
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
  // Places are organised by the mark preset they carry, one group at a time.
  const currentGroup = groups.find((g) => g.key === placeKey) || groups[0];
  const groupOf = (f) => groups.find((g) => g.favorites.includes(f));
  const shownPlaces = q ? visibleFavorites : currentGroup?.favorites || [];
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

                  {!q && (
                    <section className="group-block">
                      <div className="group">新建</div>
                      <div className="tile-grid create-grid">
                        <button
                          className="tile create-tile"
                          aria-label="添加图库"
                          {...itemHandlers({ type: 'gallery' })}
                        >
                          <span className="create-art gallery-art" aria-hidden="true">
                            <i />
                            <i />
                            <i />
                          </span>
                          <span>图库</span>
                        </button>
                        <button
                          className="tile create-tile"
                          aria-label="添加待办"
                          {...itemHandlers({ type: 'todo' })}
                        >
                          <span className="create-art todo-art" aria-hidden="true">
                            <i className="done" />
                            <i />
                            <i />
                          </span>
                          <span>待办</span>
                        </button>
                      </div>
                    </section>
                  )}

                  {groups.length > 0 && (!q || visibleFavorites.length > 0) && (
                    <section className="group-block places-block">
                      <div className="group-head">
                        <div className="group">
                          地点 <small>{q ? visibleFavorites.length : favorites.length}</small>
                        </div>
                      </div>
                      {!q && (
                        <div className="mark-chips" role="tablist" aria-label="按标记筛选地点">
                          {groups.map((g) => (
                            <button
                              key={g.key}
                              role="tab"
                              aria-selected={g === currentGroup}
                              className="mark-chip"
                              style={{ '--mc': markColors[g.mark.color] || '#b7791f' }}
                              onClick={() => setPlaceKey(g.key)}
                            >
                              <svg viewBox="0 0 24 24" aria-hidden="true">
                                <path d={markPaths[g.mark.icon] || markPaths.star} />
                              </svg>
                              {markGroupName(g)}
                              <small>{g.favorites.length}</small>
                            </button>
                          ))}
                        </div>
                      )}
                      {!q && currentGroup && (
                        <button
                          className="tile wide-tile"
                          aria-label={`整类加入：${markGroupName(currentGroup)}`}
                          {...itemHandlers(
                            widgetSpec({ kind: 'places', mark: currentGroup.mark }, 'M'),
                          )}
                        >
                          <Preview
                            content={{ kind: 'places', mark: currentGroup.mark }}
                            size="M"
                            snapshot={snapshot}
                            scale={0.62}
                          />
                          <span>
                            整类加入 · {markGroupName(currentGroup)} {currentGroup.favorites.length}{' '}
                            处
                          </span>
                        </button>
                      )}
                      <ul className="place-list">
                        {shownPlaces.map((f) => {
                          const g = groupOf(f);
                          return (
                            <li key={f.id} className="place-row">
                              <span
                                className="place-dot"
                                style={{ '--mc': markColors[g?.mark.color] || '#b7791f' }}
                                aria-hidden="true"
                              >
                                <svg viewBox="0 0 24 24">
                                  <path d={markPaths[g?.mark.icon] || markPaths.star} />
                                </svg>
                              </span>
                              <span className="act-title">
                                <b>{f.payload.name}</b>
                                <small>
                                  {q && g ? `${markGroupName(g)} · ` : ''}
                                  {f.payload.address || f.payload.category || '没有地址'}
                                </small>
                              </span>
                              <button
                                className="chip-btn"
                                aria-label={`添加地点：${f.payload.name}`}
                                title="拖到白板或点击添加"
                                {...itemHandlers(
                                  widgetSpec({ kind: 'place', favoriteId: f.id }, 'S'),
                                )}
                              >
                                ＋
                              </button>
                            </li>
                          );
                        })}
                      </ul>
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
              <EmojiTab
                itemHandlers={itemHandlers}
                recent={recentEmoji}
                stickers={stickers}
                onUploadSticker={onUploadSticker}
                onRemoveSticker={onRemoveSticker}
              />
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
          ) : itemDrag.spec.type === 'sticker' ? (
            <img className="ghost-sticker" src={stickerUrl(itemDrag.spec.sticker.id)} alt="" />
          ) : itemDrag.spec.type === 'todo' || itemDrag.spec.type === 'gallery' ? (
            <div className={`ghost-card ${itemDrag.spec.type}`}>
              {itemDrag.spec.type === 'todo' ? '待办' : '图库'}
            </div>
          ) : (
            <div className="ghost-emoji">{itemDrag.spec.char}</div>
          )}
        </div>
      )}
    </>
  );
}

function EmojiTab({ itemHandlers, recent, stickers, onUploadSticker, onRemoveSticker }) {
  const [data, setData] = useState(null);
  const [failed, setFailed] = useState(false);
  const [group, setGroup] = useState(recent.length ? 'recent' : 'smileys');
  const [query, setQuery] = useState('');
  const [busy, setBusy] = useState(0);
  const [manage, setManage] = useState(false);
  const fileRef = useRef(null);
  const gridRef = useRef(null);

  useEffect(() => {
    let alive = true;
    import('../emoji-data.js')
      .then((m) => alive && setData(m))
      .catch(() => alive && setFailed(true));
    return () => {
      alive = false;
    };
  }, []);

  const q = query.trim().toLowerCase();
  const results = useMemo(() => {
    if (!q || !data) return [];
    const out = [];
    const seen = new Set();
    const push = (char) => {
      if (!seen.has(char)) {
        seen.add(char);
        out.push(char);
      }
    };
    // Most specific first: the exact keyword, then the category it names
    // (「美食」「旅行」…), then the keyword's emoji, then names.
    if (data.EMOJI_ZH[q]) graphemes(data.EMOJI_ZH[q]).forEach(push);
    for (const g of data.EMOJI_GROUPS)
      if (g.label.includes(q) || q.includes(g.label)) g.items.forEach(([char]) => push(char));
    const keys = Object.keys(data.EMOJI_ZH).sort((a, b) => b.length - a.length);
    for (const key of keys) {
      if (key === q || !(key.includes(q) || q.includes(key))) continue;
      graphemes(data.EMOJI_ZH[key]).forEach(push);
    }
    for (const g of data.EMOJI_GROUPS)
      for (const [char, name] of g.items) if (name.includes(q)) push(char);
    return out.slice(0, 160);
  }, [q, data]);

  const tabs = data
    ? [
        ...(recent.length ? [{ id: 'recent', label: '最近', icon: '🕘' }] : []),
        ...data.EMOJI_GROUPS.map((g) => ({ id: g.id, label: g.label, icon: g.icon })),
      ]
    : [];
  const current =
    group === 'recent'
      ? recent
      : (data?.EMOJI_GROUPS.find((g) => g.id === group) || data?.EMOJI_GROUPS[0])?.items.map(
          (x) => x[0],
        ) || [];
  const names = useMemo(() => {
    const m = new Map();
    data?.EMOJI_GROUPS.forEach((g) => g.items.forEach(([c, n]) => m.set(c, n)));
    return m;
  }, [data]);
  const shown = q ? results : current;

  const pick = async (e) => {
    const files = Array.from(e.target.files || []);
    e.target.value = '';
    for (const f of files) {
      setBusy((n) => n + 1);
      try {
        await onUploadSticker?.(f);
      } finally {
        setBusy((n) => n - 1);
      }
    }
  };

  return (
    <div className="emoji-tab">
      <input
        className="panel-search"
        type="search"
        value={query}
        placeholder="搜索表情，例如 开心、美食、飞机"
        aria-label="搜索表情"
        onChange={(e) => setQuery(e.target.value)}
      />

      {!q && (
        <section className="my-stickers" aria-label="我的表情">
          <div className="group-head">
            <div className="group">
              我的表情 <small>{stickers.length}</small>
            </div>
            {stickers.length > 0 && (
              <button className="link-btn" onClick={() => setManage((v) => !v)}>
                {manage ? '完成' : '管理'}
              </button>
            )}
          </div>
          <div className="sticker-grid">
            <input
              ref={fileRef}
              type="file"
              accept={STICKER_TYPES}
              multiple
              hidden
              onChange={pick}
            />
            <button
              className="sticker-add"
              aria-label="上传自己的表情"
              title="上传图片或 GIF，所有行程都能用"
              disabled={busy > 0}
              onClick={() => fileRef.current?.click()}
            >
              {busy > 0 ? <span className="spin" aria-hidden="true" /> : '＋'}
            </button>
            {stickers.map((st) =>
              manage ? (
                <button
                  key={st.id}
                  className="my-sticker removing"
                  aria-label="删除这个表情"
                  onClick={() => onRemoveSticker?.(st.id)}
                >
                  <img src={stickerUrl(st.id)} alt="" loading="lazy" draggable="false" />
                  <span className="x" aria-hidden="true">
                    ×
                  </span>
                </button>
              ) : (
                <button
                  key={st.id}
                  className="my-sticker"
                  aria-label={st.animated ? '添加我的动图表情' : '添加我的表情'}
                  {...itemHandlers({ type: 'sticker', sticker: st })}
                >
                  <img src={stickerUrl(st.id)} alt="" loading="lazy" draggable="false" />
                </button>
              ),
            )}
          </div>
        </section>
      )}

      {!q && tabs.length > 0 && (
        <div className="emoji-cats" role="tablist" aria-label="表情分类">
          {tabs.map((t) => (
            <button
              key={t.id}
              role="tab"
              aria-selected={t.id === group}
              title={t.label}
              aria-label={t.label}
              onClick={() => {
                setGroup(t.id);
                gridRef.current?.scrollTo?.({ top: 0 });
              }}
            >
              {t.icon}
            </button>
          ))}
        </div>
      )}

      {failed && <p className="panel-empty">表情库没能载入，请刷新后重试</p>}
      {!data && !failed && <p className="panel-empty">正在载入表情…</p>}
      {data && q && !results.length && <p className="panel-empty">没有找到「{query.trim()}」</p>}
      <div className="grid emoji-grid" ref={gridRef}>
        {shown.map((e) => (
          <button
            key={e}
            className="pick-emoji"
            aria-label={`添加表情 ${e}`}
            title={names.get(e) || ''}
            {...itemHandlers({ type: 'emoji', char: e })}
          >
            {e}
          </button>
        ))}
      </div>
    </div>
  );
}
