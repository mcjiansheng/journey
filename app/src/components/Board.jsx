import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import './board.css';
import { useBoard, readBoardCache } from '../board-sync.js';
import { BoardItem } from './BoardItem.jsx';
import { BoardToolbar } from './BoardToolbar.jsx';
import { BoardActions } from './BoardActions.jsx';
import { BoardStickerPanel } from './BoardStickerPanel.jsx';
import { BoardRecentDeletions } from './BoardRecentDeletions.jsx';
import { BoardSwitcher } from './BoardSwitcher.jsx';
import { NoteFormatBar } from './NoteFormatBar.jsx';
import { BoardContextMenu } from './BoardContextMenu.jsx';
import { api } from '../sync.js';
import { processImageFile } from '../board-sync.js';
import { MapDetailContext } from './widgets/map-context.js';
import {
  toWorld,
  toScreen,
  center,
  visibleArea,
  topZ,
  bottomZ,
  simplify,
  pathD,
  scaled,
  strokeLook,
  galleryFrameSize,
  GALLERY_PADDING,
  stickerUrl,
  itemRotation,
} from '../board.js';
import { WIDGET_SIZES, widgetSize, widgetScale, pickWidgetSize } from '../board-widgets.js';
import {
  frameBounds,
  frameCenter,
  groupBounds,
  intersects,
  contains,
  rectFrom,
  toLocal,
  keepAnchor,
  handleAngle,
  snapAngle,
  rotateFrames,
  snapRatio,
  ratioNumber,
  finalizeStroke,
  snapToGuides,
  alignFrames,
} from '../board-geometry.js';

const DRAG_THRESHOLD = 3;
const ZOOM_MIN = 0.15;
const ZOOM_MAX = 3;
const NARROW = '(max-width: 760px)';
const DOCK_NAMES = { left: '左侧', right: '右侧', bottom: '底部' };
const peerColor = (i) => `var(--peer-${((i || 0) % 4) + 1})`;

function useMedia(query) {
  const [matches, setMatches] = useState(() => matchMedia(query).matches);
  useEffect(() => {
    const m = matchMedia(query);
    const update = () => setMatches(m.matches);
    m.addEventListener('change', update);
    return () => m.removeEventListener('change', update);
  }, [query]);
  return matches;
}

function useOnline() {
  const [online, setOnline] = useState(() => navigator.onLine !== false);
  useEffect(() => {
    const up = () => setOnline(true);
    const down = () => setOnline(false);
    window.addEventListener('online', up);
    window.addEventListener('offline', down);
    return () => {
      window.removeEventListener('online', up);
      window.removeEventListener('offline', down);
    };
  }, []);
  return online;
}

const sameSet = (a, b) => a.size === b.size && [...a].every((x) => b.has(x));
const GROUP = '__group';
const PREVIEW_ID = '__preview';
const MIN_SIDE = { text: 40, note: 100, todo: 160, section: 160, gallery: 60 };
const MIN_SIDE_H = { note: 80, todo: 100, section: 100, gallery: 60 };

/** Content, style and size of a new object made from a panel spec. */
export function specTemplate(spec) {
  switch (spec?.type) {
    case 'widget': {
      const [w, h] = WIDGET_SIZES[spec.size] || [352, 168];
      return { content: { type: 'widget', ...spec.content }, style: { size: spec.size }, w, h };
    }
    case 'note':
      return { content: { type: 'note', text: '' }, style: { color: spec.color }, w: 200, h: 200 };
    case 'emoji':
      return { content: { type: 'emoji', char: spec.char }, style: {}, w: 80, h: 80 };
    case 'todo':
      return {
        content: { type: 'todo', title: '待办', items: [] },
        style: { color: 'gray', variant: 'plain' },
        w: 260,
        h: 180,
      };
    case 'section':
      return {
        content: { type: 'section', title: '' },
        style: { color: spec.color || 'blue', variant: 'plain' },
        w: 640,
        h: 420,
      };
    case 'gallery':
      return { content: { type: 'gallery', images: [] }, style: { ratio: '4:3' }, w: 320, h: 240 };
    case 'sticker': {
      const st = spec.sticker || {};
      const side = 140;
      const ratio = (st.height || 1) / (st.width || 1);
      return {
        content: {
          type: 'image',
          src: stickerUrl(st.id),
          mime: st.mime || 'image/png',
          width: st.width || side,
          height: st.height || side,
          animated: Boolean(st.animated),
          caption: '',
        },
        style: { frameStyle: 'sticker' },
        w: ratio > 1 ? Math.round(side / ratio) : side,
        h: ratio > 1 ? side : Math.round(side * ratio),
      };
    }
    default:
      return null;
  }
}

const NO_STICKERS = [];

export function Board({
  tripId,
  boardId: initialBoardId,
  snapshot,
  currentUserId,
  mutate,
  onNavigate,
  notify,
  modalOpen = false,
  dock = 'left',
  onDockChange,
  boardContext = {},
  onBoardContext,
  onPeersChange,
  stickers: accountStickers = NO_STICKERS,
  onStickersChange,
}) {
  // ---------- Boards ----------
  const boards = useMemo(
    () =>
      (snapshot?.objects || [])
        .filter((o) => o.kind === 'board' && o.state === 'active')
        .sort(
          (a, b) => (a.payload?.order ?? 0) - (b.payload?.order ?? 0) || a.id.localeCompare(b.id),
        ),
    [snapshot],
  );
  const deletedBoards = useMemo(
    () => (snapshot?.objects || []).filter((o) => o.kind === 'board' && o.state === 'deleted'),
    [snapshot],
  );
  const activeBoard = boards.find((b) => b.id === initialBoardId) || boards[0];
  const boardId = activeBoard?.id || initialBoardId || 'default-board';

  useEffect(() => {
    if (snapshot && !boards.length && mutate) {
      mutate({
        kind: 'create',
        objectType: 'board',
        objectId: boardId,
        patch: { title: '主白板' },
      });
    }
  }, [snapshot, boards.length, boardId, mutate]);

  const {
    items,
    activeItems,
    deletedItems,
    loading,
    peerPresences,
    addBoardItem,
    patchBoardItem,
    deleteBoardItem,
    restoreBoardItem,
    sendPresence,
    uploadAsset,
  } = useBoard(tripId, boardId, { mutate, currentUserId });

  const itemsById = useMemo(() => new Map(items.map((it) => [it.id, it])), [items]);
  const itemsByIdRef = useRef(itemsById);
  itemsByIdRef.current = itemsById;
  const activeItemsRef = useRef(activeItems);
  activeItemsRef.current = activeItems;

  // ---------- Viewport ----------
  const stageRef = useRef(null);
  const savedView = boardContext?.viewports?.[boardId];
  const [view, setView] = useState(() =>
    savedView && Number.isFinite(savedView.k) ? savedView : { x: 0, y: 0, k: 1 },
  );
  const viewRef = useRef(view);
  viewRef.current = view;
  const [stageSize, setStageSize] = useState({ w: 0, h: 0 });
  const narrow = useMedia(NARROW);
  const online = useOnline();

  useEffect(() => {
    const el = stageRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return undefined;
    const update = () => setStageSize({ w: el.clientWidth, h: el.clientHeight });
    update();
    const observer = new ResizeObserver(update);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  // ---------- Tools & UI ----------
  const [tool, setTool] = useState('select');
  const [penColor, setPenColor] = useState('default');
  const [penSize, setPenSize] = useState(4);
  const [hlColor, setHlColor] = useState('yellow');
  const [panelOpen, setPanelOpen] = useState(false);
  const [deletionsOpen, setDeletionsOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);

  // Screen space covered by the docked sticker panel, so "center" means the
  // part of the canvas the user can see.
  const insets = useMemo(() => {
    if (!panelOpen) return {};
    if (narrow) return { bottom: Math.round(stageSize.h * 0.6) };
    if (dock === 'right') return { right: 16 + 360 };
    if (dock === 'bottom') return { bottom: 84 + 280 };
    return { left: (stageRef.current ? boardLeftOffset(stageRef.current) : 16) + 360 };
  }, [panelOpen, narrow, dock, stageSize.h]);
  const insetsRef = useRef(insets);
  insetsRef.current = insets;

  // ---------- Selection & editing ----------
  const [selectedIds, setSelectedIds] = useState(() => new Set());
  const [editingId, setEditingId] = useState(null);
  // The first click only selects (move, scale, rotate); clicking the selection
  // again or right-clicking brings up the menus.
  const [actionsOpen, setActionsOpen] = useState(false);
  const [contextMenu, setContextMenu] = useState(null); // { x, y, kind, at }
  const selectedIdsRef = useRef(selectedIds);
  selectedIdsRef.current = selectedIds;
  const select = useCallback((ids) => {
    const next = ids instanceof Set ? ids : new Set(ids);
    if (!sameSet(selectedIdsRef.current, next)) {
      setActionsOpen(false);
      selectedIdsRef.current = next;
    }
    setSelectedIds((prev) => (sameSet(prev, next) ? prev : next));
    return next;
  }, []);
  const menuTimer = useRef(0);
  const toggleMenuSoon = () => {
    clearTimeout(menuTimer.current);
    // Wait out a double click, which edits instead.
    menuTimer.current = setTimeout(() => setActionsOpen((o) => !o), 230);
  };
  useEffect(() => () => clearTimeout(menuTimer.current), []);
  // Interacting with a menu cancels a pending menu toggle: otherwise the
  // delayed toggle (which waits out a double click) can fire just after a
  // style/color click and close the menus the user is still using.
  useEffect(() => {
    const cancelPendingToggle = (e) => {
      if (e.target?.closest?.('.ui')) clearTimeout(menuTimer.current);
    };
    document.addEventListener('pointerdown', cancelPendingToggle, true);
    return () => document.removeEventListener('pointerdown', cancelPendingToggle, true);
  }, []);
  // Fixed-width text follows the height it actually wraps to. Measured from
  // layout, not from the pointer maths, so the server frame stays truthful
  // (also after reload or a redo of the side resize).
  useEffect(() => {
    if (gestureRef.current || editingId) return;
    const changes = [];
    for (const [id, size] of measuredRef.current) {
      const it = itemsByIdRef.current.get(id);
      if (
        it?.content?.type === 'text' &&
        it.style?.autoWidth === false &&
        stageSize.w &&
        Math.abs((it.frame?.h || 0) - size.h) > 1
      )
        changes.push({ id, patch: { frame: { ...it.frame, h: size.h } } });
    }
    if (changes.length) applyPatches(changes, { record: false });
  });
  // Laid-out size of text items, reported by BoardItem. A tick lets the board
  // persist the wrapped height once layout settles (the drag release only knows
  // the height from before the last wrap).
  const measuredRef = useRef(new Map());
  const [measureTick, setMeasureTick] = useState(0);
  const onMeasure = useCallback((id, size) => {
    const prev = measuredRef.current.get(id);
    measuredRef.current.set(id, size);
    if (!prev || prev.w !== size.w || prev.h !== size.h) setMeasureTick((t) => t + 1);
  }, []);

  // ---------- Live frames ----------
  // Local gesture frames and peer frames are kept apart: a peer heartbeat must
  // never wipe the frame of the object being dragged here (N-4, 旧 P2-8).
  const [localLive, setLocalLive] = useState(null); // { frames, sizes, boxes }
  const remoteLive = useMemo(() => {
    const map = new Map();
    for (const p of peerPresences.values())
      if (p.live && typeof p.live === 'object')
        for (const [id, f] of Object.entries(p.live)) map.set(id, f);
    return map;
  }, [peerPresences]);
  const peerSelections = useMemo(() => {
    const map = new Map();
    for (const p of peerPresences.values())
      for (const id of p.selected || [])
        if (!map.has(id))
          map.set(id, {
            name: p.displayName || '同伴',
            color: peerColor(p.colorIndex),
            editing: p.editing === id,
          });
    return map;
  }, [peerPresences]);

  useEffect(() => {
    const seen = new Map();
    for (const p of peerPresences.values())
      if (p.userId && !seen.has(p.userId)) seen.set(p.userId, p.colorIndex || 0);
    onPeersChange?.(seen);
  }, [peerPresences, onPeersChange]);
  useEffect(() => () => onPeersChange?.(new Map()), [onPeersChange]);

  // ---------- Undo / redo ----------
  const [undoStack, setUndoStack] = useState([]);
  const [redoStack, setRedoStack] = useState([]);
  const pushHistory = useCallback((entry) => {
    setUndoStack((s) => [...s.slice(-99), entry]);
    setRedoStack([]);
  }, []);

  const recordPatch = (id, patch) => {
    const it = itemsByIdRef.current.get(id);
    if (!it) return null;
    const before = {};
    for (const key of Object.keys(patch)) {
      if (key === 'style') before.style = { locked: false, ...(it.style || {}) };
      else before[key] = it[key] ?? null;
    }
    return { id, before, after: patch };
  };
  const applyPatches = (changes, { record = true } = {}) => {
    const entries = [];
    for (const { id, patch } of changes) {
      const rec = record ? recordPatch(id, patch) : null;
      if (rec) entries.push(rec);
      patchBoardItem(id, patch).catch(() => {});
    }
    if (entries.length) pushHistory({ type: 'patch', changes: entries });
  };
  // `pop` marks objects placed by the app (stickers, uploads, copies) so people
  // see where they landed; strokes and text appear where the pointer already is.
  const addItem = async (data, { pop = false } = {}) => {
    const item = await addBoardItem(data);
    pushHistory({ type: 'add', ids: [item.id] });
    if (pop) flash(item.id);
    return item;
  };
  const removeItems = (ids, { toast = true, record = true } = {}) => {
    const list = [...ids].filter((id) => itemsByIdRef.current.get(id)?.state !== 'deleted');
    if (!list.length) return;
    for (const id of list) deleteBoardItem(id).catch(() => {});
    if (record) pushHistory({ type: 'delete', ids: list });
    if (toast)
      notify?.({
        message: list.length > 1 ? `已删除 ${list.length} 个对象` : '已删除',
        actionLabel: '撤销',
        timeout: 5000,
        onAction: async () => {
          for (const id of list) await restoreBoardItem(id);
        },
      });
  };

  const runHistory = (entry, direction) => {
    if (entry.type === 'patch') {
      for (const c of entry.changes)
        patchBoardItem(c.id, direction === 'undo' ? c.before : c.after).catch(() => {});
    } else {
      const remove = (entry.type === 'add') === (direction === 'undo');
      for (const id of entry.ids)
        (remove ? deleteBoardItem(id) : restoreBoardItem(id)).catch(() => {});
    }
  };
  const undo = () => {
    const entry = undoStack[undoStack.length - 1];
    if (!entry) return;
    setUndoStack((s) => s.slice(0, -1));
    setRedoStack((s) => [...s, entry]);
    runHistory(entry, 'undo');
    select([]);
  };
  const redo = () => {
    const entry = redoStack[redoStack.length - 1];
    if (!entry) return;
    setRedoStack((s) => s.slice(0, -1));
    setUndoStack((s) => [...s, entry]);
    runHistory(entry, 'redo');
  };

  // New objects pulse once so people see where they landed.
  const [flashId, setFlashId] = useState(null);
  const flashTimer = useRef(0);
  const flash = (id) => {
    clearTimeout(flashTimer.current);
    setFlashId(id);
    flashTimer.current = setTimeout(() => setFlashId(null), 600);
  };
  useEffect(() => () => clearTimeout(flashTimer.current), []);

  // ---------- Initial view & persistence ----------
  const initializedViewRef = useRef(Boolean(savedView));
  useEffect(() => {
    if (initializedViewRef.current || loading) return;
    initializedViewRef.current = true;
    if (activeItems.length === 0 || !stageRef.current) return;
    const rect = stageRef.current.getBoundingClientRect();
    setView(center(activeItems, { w: rect.width || 1200, h: rect.height || 800 }));
  }, [loading, activeItems]);

  // Remember each board's viewport (旧 P2-11).
  const boardContextRef = useRef(boardContext);
  boardContextRef.current = boardContext;
  useEffect(() => {
    if (!initializedViewRef.current) return undefined;
    const t = setTimeout(() => {
      const prev = boardContextRef.current?.viewports || {};
      const cur = prev[boardId];
      const v = { x: Math.round(view.x), y: Math.round(view.y), k: +view.k.toFixed(3) };
      if (cur && cur.x === v.x && cur.y === v.y && cur.k === v.k) return;
      onBoardContext?.({ viewports: { ...prev, [boardId]: v } });
    }, 500);
    return () => clearTimeout(t);
  }, [view, boardId]);

  // ---------- Coordinates ----------
  const screenToWorld = useCallback((clientX, clientY) => {
    if (!stageRef.current) return { x: 0, y: 0 };
    const rect = stageRef.current.getBoundingClientRect();
    return toWorld({ x: clientX - rect.left, y: clientY - rect.top }, viewRef.current);
  }, []);

  const fitContent = () => {
    if (!stageRef.current) return;
    const rect = stageRef.current.getBoundingClientRect();
    setView(center(activeItems, { w: rect.width, h: rect.height }, insetsRef.current));
  };

  const zoomAround = (factor, sx, sy) => {
    const v = viewRef.current;
    const nextK = Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, v.k * factor));
    const w = toWorld({ x: sx, y: sy }, v);
    setView({ k: nextK, x: sx - w.x * nextK, y: sy - w.y * nextK });
  };
  const zoomCenter = () => {
    const a = visibleArea(stageSize, insetsRef.current);
    return [a.x + a.w / 2, a.y + a.h / 2];
  };
  const zoomBy = (factor) => zoomAround(factor, ...zoomCenter());
  const toggleZoom = () => {
    if (Math.abs(view.k - 1) < 0.01) fitContent();
    else zoomAround(1 / view.k, ...zoomCenter());
  };

  // Wheel must be a non-passive native listener so preventDefault stops the
  // browser from zooming the page on trackpad pinch.
  useEffect(() => {
    const el = stageRef.current;
    if (!el) return undefined;
    const onWheel = (e) => {
      if (e.target.closest?.('.ui')) return;
      // Content that can scroll keeps the wheel (long checklists, photo windows).
      for (let n = e.target; n && n !== el; n = n.parentElement) {
        const cs = getComputedStyle(n);
        if (/(auto|scroll)/.test(cs.overflowY) && n.scrollHeight > n.clientHeight + 1) return;
      }
      e.preventDefault();
      const rect = el.getBoundingClientRect();
      if (e.ctrlKey || e.metaKey) {
        zoomAround(Math.exp(-e.deltaY * 0.005), e.clientX - rect.left, e.clientY - rect.top);
      } else {
        setView((v) => ({ ...v, x: v.x - e.deltaX, y: v.y - e.deltaY }));
      }
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, []);

  // ---------- Spawning ----------
  const getCenterSpawnPoint = (w = 200, h = 200) => {
    if (!stageRef.current) return { x: 100, y: 100 };
    const a = visibleArea(stageSize, insetsRef.current);
    const mid = toWorld({ x: a.x + a.w / 2, y: a.y + a.h / 2 }, viewRef.current);
    let x = Math.round(mid.x - w / 2);
    let y = Math.round(mid.y - h / 2);
    while (
      activeItemsRef.current.some(
        (it) => Math.abs((it.frame?.x ?? 0) - x) < 12 && Math.abs((it.frame?.y ?? 0) - y) < 12,
      )
    ) {
      x += 24;
      y += 24;
    }
    return { x, y };
  };
  const spawnAt = (w, h, at) =>
    at ? { x: Math.round(at.x - w / 2), y: Math.round(at.y - h / 2) } : getCenterSpawnPoint(w, h);

  const addWidget = async (content, size = 'M', at) => {
    const [w, h] = WIDGET_SIZES[size] || [352, 168];
    const pt = spawnAt(w, h, at);
    const item = await addItem(
      {
        content: { type: 'widget', ...content },
        style: { size },
        frame: { x: pt.x, y: pt.y, w, h, scale: 1 },
        z: topZ(activeItemsRef.current),
      },
      { pop: true },
    );
    select([item.id]);
  };
  // Notes, emoji, checklists and sections share one path, so what was dragged
  // out of the panel (specTemplate) is exactly what lands.
  const addFromSpec = async (spec, at) => {
    const t = specTemplate(spec);
    if (!t) return null;
    const pt = spawnAt(t.w, t.h, at);
    const item = await addItem(
      {
        content: t.content,
        style: t.style,
        frame: { x: pt.x, y: pt.y, w: t.w, h: t.h, scale: 1 },
        z: spec.type === 'section' ? bottomZ(activeItemsRef.current) : topZ(activeItemsRef.current),
      },
      { pop: true },
    );
    select([item.id]);
    if (['note', 'todo', 'section'].includes(spec.type)) setEditingId(item.id);
    return item;
  };
  // 图库: pick photos first, then the gallery appears with all of them.
  const galleryPicker = useRef(null);
  const imagePicker = useRef(null);
  const galleryTarget = useRef(null); // { id } to append, or { at } to create
  const openGalleryPicker = (target) => {
    galleryTarget.current = target;
    galleryPicker.current?.click();
  };
  const onGalleryFiles = async (files) => {
    const target = galleryTarget.current || {};
    galleryTarget.current = null;
    const list = [...files].filter((f) => f.type.startsWith('image/')).slice(0, 30);
    if (!list.length) return;
    const placeholder = target.id
      ? null
      : { id: crypto.randomUUID(), frame: { ...spawnAt(320, 320, target.at), w: 320, h: 320 } };
    if (placeholder)
      setUploads((u) => [...u, { ...placeholder, file: null, status: 'uploading', message: '' }]);
    const uploaded = [];
    let error = null;
    for (const file of list) {
      try {
        // Keep PNG/WebP transparency instead of flattening onto black.
        const res = await uploadAsset(file, { keepAlpha: true });
        uploaded.push({
          assetId: res.assetId,
          mime: res.mime || 'image/png',
          width: res.width || 400,
          height: res.height || 300,
          animated: Boolean(res.isGif),
          crop: { x: 0, y: 0, zoom: 1 },
        });
      } catch (err) {
        error = err;
      }
    }
    if (placeholder) setUploads((u) => u.filter((x) => x.id !== placeholder.id));
    if (error)
      notify?.({ message: `${uploaded.length ? '部分' : ''}图片上传失败：${error.message || ''}` });
    if (!uploaded.length) return;
    if (target.id) {
      const g = itemsByIdRef.current.get(target.id);
      if (!g) return;
      const images = [...(g.content.images || []), ...uploaded].slice(0, 30);
      applyPatches([{ id: g.id, patch: { content: { ...g.content, images } } }]);
      return;
    }
    const first = uploaded[0];
    const ratio = snapRatio(first.width / first.height);
    const { w, h } = galleryFrameSize(ratioNumber(ratio) >= 1 ? 360 : 260, ratio);
    const item = await addItem(
      {
        content: { type: 'gallery', images: uploaded },
        style: { ratio },
        frame: { x: placeholder.frame.x, y: placeholder.frame.y, w, h, scale: 1 },
        z: topZ(activeItemsRef.current),
      },
      { pop: true },
    );
    select([item.id]);
  };
  const addPlaces = (mark, at) => addWidget({ kind: 'places', mark }, 'M', at);

  // ---------- My stickers (account library) ----------
  const [stickers, setStickers] = useState(accountStickers);
  const stickersRef = useRef(stickers);
  stickersRef.current = stickers;
  useEffect(() => setStickers(accountStickers || NO_STICKERS), [accountStickers]);
  // The library follows the account: tell the app so another trip opened in the
  // same session sees the change without a reload.
  const updateStickers = (next) => {
    setStickers(next);
    onStickersChange?.(next);
  };
  const uploadSticker = async (file) => {
    try {
      const processed = await processImageFile(file, { keepAlpha: true });
      // Stickers stay small: GIFs are kept as they are, stills use the processed full size.
      const id = crypto.randomUUID();
      const sticker = await api(
        `/api/me/stickers/${id}?w=${processed.width}&h=${processed.height}`,
        {
          method: 'PUT',
          raw: true,
          headers: { 'Content-Type': processed.mime },
          body: processed.fullBlob,
        },
      );
      updateStickers([sticker, ...stickersRef.current.filter((x) => x.id !== sticker.id)]);
      return sticker;
    } catch (err) {
      notify?.({ message: err?.message || '表情上传失败' });
      return null;
    }
  };
  const removeSticker = async (id) => {
    updateStickers(stickersRef.current.filter((x) => x.id !== id));
    try {
      await api(`/api/me/stickers/${id}`, { method: 'DELETE' });
    } catch (err) {
      notify?.({ message: err?.message || '删除表情失败' });
    }
  };
  // Placing a sticker copies it into this trip so everyone on the board sees it.
  const addSticker = async (sticker, at) => {
    const side = 140;
    const { w, h } = specTemplate({ type: 'sticker', sticker });
    const pt = spawnAt(w, h, at);
    const uid = crypto.randomUUID();
    setUploads((u) => [
      ...u,
      { id: uid, file: null, frame: { x: pt.x, y: pt.y, w, h }, status: 'uploading', message: '' },
    ]);
    try {
      const blob = await fetch(stickerUrl(sticker.id), { credentials: 'same-origin' }).then((r) => {
        if (!r.ok) throw new Error('表情已不存在');
        return r.blob();
      });
      const file = new File([blob], `sticker.${(sticker.mime || 'image/png').split('/')[1]}`, {
        type: sticker.mime || blob.type,
      });
      // Keep PNG/WebP transparency instead of flattening onto black.
      const res = await uploadAsset(file, { keepAlpha: true });
      const item = await addItem(
        {
          content: {
            type: 'image',
            assetId: res.assetId,
            mime: res.mime || sticker.mime,
            width: res.width || sticker.width || side,
            height: res.height || sticker.height || side,
            animated: Boolean(res.isGif),
            caption: '',
          },
          style: { frameStyle: 'sticker' },
          frame: { x: pt.x, y: pt.y, w, h, scale: 1 },
          z: topZ(activeItemsRef.current),
        },
        { pop: true },
      );
      select([item.id]);
    } catch (err) {
      notify?.({ message: err?.message || '表情贴到白板失败' });
    } finally {
      setUploads((u) => u.filter((x) => x.id !== uid));
    }
  };

  const addSpec = (spec, at) => {
    setTool('select');
    if (spec.type === 'widget') return addWidget(spec.content, spec.size, at);
    if (spec.type === 'gallery') return openGalleryPicker({ at });
    if (spec.type === 'places') return addPlaces(spec.mark, at);
    if (spec.type === 'sticker') return addSticker(spec.sticker, at);
    return addFromSpec(spec, at);
  };
  const inStage = (clientX, clientY) => {
    const rect = stageRef.current?.getBoundingClientRect();
    return (
      rect &&
      clientX >= rect.left &&
      clientX <= rect.right &&
      clientY >= rect.top &&
      clientY <= rect.bottom
    );
  };
  // Dragging out of the panel: once the pointer leaves the panel the object is
  // on the board, at full size, under the pointer; dragging it back onto the
  // panel and letting go puts it back (nothing is created).
  const [dragPreview, setDragPreview] = useState(null); // { spec, at }
  const panelDrag = ({ phase, spec, clientX, clientY, overPanel }) => {
    if (phase === 'move') {
      setDragPreview(
        overPanel || !inStage(clientX, clientY)
          ? null
          : { spec, at: screenToWorld(clientX, clientY) },
      );
      return;
    }
    setDragPreview(null);
    if (phase === 'end' && !overPanel && inStage(clientX, clientY))
      addSpec(spec, screenToWorld(clientX, clientY));
  };

  // Image uploads show a placeholder with progress where the image will land,
  // and turn into "上传失败 · 重试" instead of an alert (N-14).
  const [uploads, setUploads] = useState([]);
  const [dropping, setDropping] = useState(false);
  // Paste images straight onto the board.
  useEffect(() => {
    const onPaste = (e) => {
      if (modalOpenRef.current) return;
      if (e.target?.closest?.('input, textarea, [contenteditable="true"]')) return;
      const files = [...(e.clipboardData?.files || [])].filter((f) => f.type.startsWith('image/'));
      if (!files.length) return;
      e.preventDefault();
      files.slice(0, 12).forEach((file) => handlers.current.upload(file));
    };
    window.addEventListener('paste', onPaste);
    return () => window.removeEventListener('paste', onPaste);
  }, []);
  const startUpload = async (file, placeholder, at) => {
    const id = placeholder?.id || crypto.randomUUID();
    const frame = placeholder?.frame || { ...spawnAt(240, 180, at), w: 240, h: 180 };
    setUploads((u) => [
      ...u.filter((x) => x.id !== id),
      { id, file, frame, status: 'uploading', message: '' },
    ]);
    try {
      // Keep PNG/WebP transparency instead of flattening onto black.
      const res = await uploadAsset(file, { keepAlpha: true });
      if (res.converted) notify?.({ message: '动图超过 5MB，已转成静态图片' });
      const aspect = (res.height || 300) / (res.width || 400);
      const w = Math.round(Math.min(320, res.width || 320));
      const h = Math.round(w * aspect);
      setUploads((u) => u.filter((x) => x.id !== id));
      const item = await addItem(
        {
          content: {
            type: 'image',
            assetId: res.assetId,
            mime: res.mime || 'image/png',
            width: res.width || 400,
            height: res.height || 300,
            animated: Boolean(res.isGif),
            caption: '',
          },
          style: { frameStyle: 'none' },
          frame: {
            x: Math.round(frame.x + frame.w / 2 - w / 2),
            y: Math.round(frame.y + frame.h / 2 - h / 2),
            w,
            h,
            scale: 1,
          },
          z: topZ(activeItemsRef.current),
        },
        { pop: true },
      );
      select([item.id]);
    } catch (err) {
      setUploads((u) =>
        u.map((x) =>
          x.id === id ? { ...x, status: 'failed', message: err?.message || '上传失败' } : x,
        ),
      );
    }
  };

  // ---------- Object operations ----------
  const selectedItems = activeItems.filter((it) => selectedIds.has(it.id));
  const primarySelected = selectedItems[0];
  const selectedNow = () =>
    activeItemsRef.current.filter((it) => selectedIdsRef.current.has(it.id));
  const unlockedNow = () => selectedNow().filter((it) => !it.style?.locked);

  const changeStyle = (patch) => {
    const changes = [];
    for (const it of unlockedNow()) {
      const style = { ...(it.style || {}), ...patch };
      const next = { style };
      // A gallery keeps its photo ratio when its frame border changes.
      if (it.content?.type === 'gallery' && 'frameStyle' in patch) {
        const { w, h } = galleryFrameSize(it.frame.w, style.ratio || '4:3', style.frameStyle);
        next.frame = { ...it.frame, w, h };
      }
      changes.push({ id: it.id, patch: next });
    }
    if (changes.length) applyPatches(changes);
  };
  const COLORABLE = ['note', 'todo', 'section'];
  const changeColor = (color) =>
    applyPatches(
      unlockedNow()
        .filter((it) => COLORABLE.includes(it.content?.type))
        .map((it) => ({ id: it.id, patch: { style: { ...(it.style || {}), color } } })),
    );
  const bringToFront = () => {
    let z = topZ(activeItemsRef.current);
    const list = selectedNow().sort((a, b) => (a.z || 0) - (b.z || 0));
    applyPatches(list.map((it) => ({ id: it.id, patch: { z: z++ } })));
  };
  const sendToBack = () => {
    const list = selectedNow().sort((a, b) => (b.z || 0) - (a.z || 0));
    let z = bottomZ(activeItemsRef.current);
    applyPatches(list.map((it) => ({ id: it.id, patch: { z: z-- } })));
  };
  const duplicate = async () => {
    const list = selectedNow();
    if (!list.length) return;
    let z = topZ(activeItemsRef.current);
    const ids = [];
    for (const it of list.sort((a, b) => (a.z || 0) - (b.z || 0))) {
      const f = it.frame || { x: 0, y: 0, w: 100, h: 100, scale: 1 };
      const copy = await addItem({
        content: { ...it.content },
        style: { ...(it.style || {}), locked: false },
        frame: { ...f, x: f.x + 24, y: f.y + 24 },
        z: it.content?.type === 'section' ? it.z : z++,
      });
      ids.push(copy.id);
    }
    if (ids.length === 1) flash(ids[0]);
    select(ids);
  };
  const toggleLock = () => {
    const list = selectedNow();
    if (!list.length) return;
    const lock = !list.every((it) => it.style?.locked ?? it.locked);
    applyPatches(
      list.map((it) => ({ id: it.id, patch: { style: { ...(it.style || {}), locked: lock } } })),
    );
  };
  const deleteSelected = () => {
    removeItems(selectedIdsRef.current);
    select([]);
    sendPresence({ selected: [] });
  };
  const alignSelected = (mode) => {
    const list = unlockedNow();
    const out = alignFrames(Object.fromEntries(list.map((it) => [it.id, it.frame])), mode);
    applyPatches(Object.entries(out).map(([id, frame]) => ({ id, patch: { frame } })));
  };
  // 框进分区: a section around the selection, sent behind it.
  const wrapInSection = async () => {
    const list = selectedNow().filter((it) => it.content?.type !== 'section');
    const b = groupBounds(list.map((it) => it.frame));
    if (!b) return;
    const pad = 40;
    const item = await addItem(
      {
        content: { type: 'section', title: '' },
        style: { color: 'blue', variant: 'plain' },
        frame: {
          x: Math.round(b.x - pad),
          y: Math.round(b.y - pad - 24),
          w: Math.round(b.w + pad * 2),
          h: Math.round(b.h + pad * 2 + 24),
          scale: 1,
        },
        z: bottomZ(activeItemsRef.current),
      },
      { pop: true },
    );
    select([item.id]);
    setEditingId(item.id);
  };
  const selectAll = () => {
    const ids = activeItemsRef.current.map((it) => it.id);
    select(ids);
    sendPresence({ selected: ids });
  };
  const nudge = (dx, dy) => {
    const list = unlockedNow();
    if (!list.length) return;
    applyPatches(
      list.map((it) => ({
        id: it.id,
        patch: { frame: { ...it.frame, x: it.frame.x + dx, y: it.frame.y + dy } },
      })),
    );
  };
  // Any picture on the board (also one someone else added) can go into my
  // own sticker library; the server copies the file.
  const saveToStickers = async (item) => {
    if (item?.content?.type !== 'image' || !item.content.assetId) return;
    try {
      const c = item.content;
      const sticker = await api(
        `/api/trips/${item.tripId || tripId}/assets/${c.assetId}/to-stickers?w=${c.width || 200}&h=${c.height || 200}`,
        { method: 'POST' },
      );
      if (sticker?.duplicate) {
        notify?.({ message: '已经在我的表情里了' });
        return;
      }
      updateStickers([sticker, ...stickersRef.current.filter((x) => x.id !== sticker.id)]);
      notify?.({ message: '已收藏到我的表情，所有旅程都能用' });
    } catch (err) {
      notify?.({ message: err?.message || '收藏失败，请稍后重试' });
    }
  };

  const schedulePlace = async (item) => {
    // Create a real activity for the place widget, then link the board item to
    // it. `ordinal` is not part of the activity schema, and a favorite's payload
    // carries `mark`, which is not part of Place — both are stripped below.
    const days = (snapshot?.objects || []).filter((o) => o.kind === 'day' && o.state === 'active');
    const firstDay = days[0];
    if (!firstDay || !mutate) return;
    const favorite = item.content?.favoriteId
      ? snapshot.objects.find((o) => o.id === item.content.favoriteId)
      : null;
    const source = item.content?.place || favorite?.payload || null;
    let placeData = null;
    if (source) {
      const { mark: _mark, ...place } = source;
      placeData = {
        name: place.name || '新地点',
        address: place.address || '',
        lng: place.lng ?? null,
        lat: place.lat ?? null,
        provider: place.provider ?? null,
        providerPlaceId: place.providerPlaceId ?? null,
        category: place.category || '',
        sourceUrl: place.sourceUrl || '',
        fetchedAt: place.fetchedAt ?? null,
        coordSystem: place.coordSystem || 'GCJ-02',
      };
    }
    const actId = crypto.randomUUID();
    try {
      await mutate({
        kind: 'create',
        objectType: 'activity',
        objectId: actId,
        patch: {
          dayId: firstDay.id,
          order: 999,
          title: placeData?.name || '安排',
          ...(placeData ? { place: placeData } : {}),
        },
      });
      await patchBoardItem(item.id, { linkedActivityId: actId });
    } catch (err) {
      notify?.({ message: err?.message || '加入行程失败，请稍后重试' });
    }
  };

  const openTarget = (item) => {
    const kind = item.content?.kind;
    if (kind === 'activity') onNavigate?.('itinerary', { activityId: item.content.activityId });
    else if (kind === 'day' || kind === 'route')
      onNavigate?.('itinerary', { dayId: item.content.dayId });
    else if (kind === 'place') onNavigate?.('map', { favoriteId: item.content.favoriteId });
    else if (kind === 'places') onNavigate?.('map', {});
    else if (kind === 'expense') onNavigate?.('ledger', {});
  };

  // ---------- Board management ----------
  const [counts, setCounts] = useState({});
  useEffect(() => {
    if (!menuOpen) return undefined;
    let alive = true;
    (async () => {
      const next = {};
      for (const b of boards) {
        if (b.id === boardId) continue;
        const cached = await readBoardCache(tripId, b.id);
        if (cached?.items) next[b.id] = cached.items.filter((it) => it.state !== 'deleted').length;
      }
      if (alive) setCounts(next);
    })();
    return () => {
      alive = false;
    };
  }, [menuOpen, boards, boardId, tripId]);

  // Same rule as the server: deleting a board is for the trip owner (and admins
  // in an admin-run team); restoring for the owner and any admin.
  const me = (snapshot?.members || []).find((m) => m.userId === currentUserId);
  const isOwner = snapshot?.trip?.ownerId === currentUserId;
  const canDeleteBoard = isOwner || (snapshot?.trip?.teamMode === 'admin' && Boolean(me?.isAdmin));
  const canRestoreBoard = isOwner || Boolean(me?.isAdmin);

  const switchBoard = (id, extra = {}) =>
    onBoardContext?.({ boardId: id, renaming: null, ...extra });
  const createBoard = async () => {
    const id = crypto.randomUUID();
    const order = Math.max(0, ...boards.map((b) => b.payload?.order ?? 0)) + 1;
    try {
      await mutate({
        kind: 'create',
        objectType: 'board',
        objectId: id,
        patch: { title: `白板 ${boards.length + 1}`, order },
      });
      switchBoard(id, { renaming: id });
    } catch (err) {
      notify?.({ message: err?.message || '新建白板失败，请稍后重试' });
    }
  };
  const renameBoard = async (board, title) => {
    try {
      await mutate({ kind: 'patch', objectType: 'board', objectId: board.id, patch: { title } });
    } catch (err) {
      notify?.({ message: err?.message || '重命名失败，请稍后重试' });
    }
  };
  const deleteBoard = async (board) => {
    if (boards.length <= 1 || !canDeleteBoard) return;
    const idx = boards.findIndex((b) => b.id === board.id);
    const neighbor = boards[idx + 1] || boards[idx - 1];
    try {
      await mutate({
        kind: 'delete',
        objectType: 'board',
        objectId: board.id,
        generation: board.generation || 0,
      });
      switchBoard(neighbor.id);
      notify?.({ message: `已删除白板「${board.payload?.title || '白板'}」` });
    } catch (err) {
      notify?.({ message: err?.message || '删除白板失败，请稍后重试' });
    }
  };
  const restoreBoard = async (board) => {
    try {
      await mutate({
        kind: 'restore',
        objectType: 'board',
        objectId: board.id,
        generation: board.generation || 0,
      });
      setDeletionsOpen(false);
      switchBoard(board.id);
    } catch (err) {
      notify?.({ message: err?.message || '恢复白板失败，请稍后重试' });
    }
  };

  // ---------- Gestures ----------
  const gestureRef = useRef(null);
  const [gestureActive, setGestureActive] = useState(false);
  const [drawing, setDrawing] = useState(null); // { tool, color, size }
  const [resizingId, setResizingId] = useState(null);
  const [marquee, setMarquee] = useState(null); // world rect while box-selecting
  const draftPathRef = useRef(null);
  const visibleRef = useRef([]);
  // 对齐吸附: on by default, remembered on this device.
  const [snapOn, setSnapOn] = useState(() => {
    try {
      return localStorage.getItem('journey.boardSnap') !== 'off';
    } catch {
      return true;
    }
  });
  const snapRef = useRef(snapOn);
  snapRef.current = snapOn;
  const toggleSnap = () =>
    setSnapOn((on) => {
      try {
        localStorage.setItem('journey.boardSnap', on ? 'off' : 'on');
      } catch {}
      return !on;
    });

  // Objects and handles capture on themselves (so click/dblclick still reach
  // them); blank-canvas gestures and the eraser capture on the stage. Either
  // way moves and the release bubble to the stage handlers (旧 P2-2).
  const capture = (pointerId, el = stageRef.current) => {
    try {
      el?.setPointerCapture(pointerId);
    } catch {}
  };

  const eraseAt = (clientX, clientY, g) => {
    const el = document.elementFromPoint(clientX, clientY);
    const id = el?.closest?.('.board-item')?.dataset?.itemId;
    if (!id || g.erased.has(id)) return;
    const target = itemsByIdRef.current.get(id);
    if (target?.content?.type !== 'stroke' || target.style?.locked) return;
    g.erased.add(id);
    deleteBoardItem(id).catch(() => {});
  };

  const scheduleLive = (g, live) => {
    g.pending = live;
    if (g.raf) return;
    g.raf = requestAnimationFrame(() => {
      g.raf = 0;
      if (gestureRef.current !== g) return;
      setLocalLive(g.pending);
      sendPresence({ live: g.pending.frames, selected: [...selectedIdsRef.current] });
    });
  };

  const startMarquee = (e, additive) => {
    capture(e.pointerId);
    gestureRef.current = {
      type: 'marquee',
      pointerId: e.pointerId,
      mask: 1,
      start: screenToWorld(e.clientX, e.clientY),
      base: additive ? new Set(selectedIdsRef.current) : new Set(),
      moved: false,
    };
    setEditingId(null);
  };

  const handleStagePointerDown = (e) => {
    if (e.target.closest('.ui')) return;
    setContextMenu(null);
    if (e.button !== 0 && e.button !== 1) return; // N-13: right click opens the menu instead
    document.activeElement?.blur?.();
    const panByButton = e.button === 1;

    if (!panByButton && tool === 'eraser') {
      capture(e.pointerId);
      gestureRef.current = { type: 'erase', pointerId: e.pointerId, mask: 1, erased: new Set() };
      eraseAt(e.clientX, e.clientY, gestureRef.current);
      return;
    }

    if (!panByButton && (tool === 'pen' || tool === 'highlighter')) {
      capture(e.pointerId);
      const pt = screenToWorld(e.clientX, e.clientY);
      const look = {
        tool,
        color: tool === 'pen' ? penColor : hlColor,
        size: penSize,
      };
      gestureRef.current = {
        type: 'draw',
        pointerId: e.pointerId,
        mask: 1,
        points: [[pt.x, pt.y]],
        look,
        raf: 0,
      };
      setDrawing(look);
      setGestureActive(true);
      return;
    }

    if (!panByButton && tool === 'text') {
      const pt = screenToWorld(e.clientX, e.clientY);
      addItem({
        content: { type: 'text', text: '' },
        style: { size: 'body', autoWidth: true },
        frame: { x: Math.round(pt.x), y: Math.round(pt.y - 16), w: 40, h: 32, scale: 1 },
        z: topZ(activeItemsRef.current),
      }).then((item) => {
        select([item.id]);
        setEditingId(item.id);
        sendPresence({ selected: [item.id], editing: item.id });
        setTool('select');
      });
      return;
    }

    // 框选: the marquee tool, or Shift-drag on empty canvas with the select tool.
    if (!panByButton && (tool === 'marquee' || e.shiftKey)) {
      startMarquee(e, e.shiftKey);
      return;
    }

    capture(e.pointerId);
    gestureRef.current = {
      type: 'pan',
      pointerId: e.pointerId,
      mask: panByButton ? 4 : 1,
      startX: e.clientX,
      startY: e.clientY,
      view0: { ...viewRef.current },
    };
    stageRef.current?.classList.add('panning');
    if (!panByButton) {
      select([]);
      setEditingId(null);
      sendPresence({ selected: [], editing: null }, { immediate: true });
    }
  };

  // Objects that move with a section: everything lying fully inside it.
  const withSectionContents = (ids) => {
    const out = new Set(ids);
    for (const id of ids) {
      const it = itemsByIdRef.current.get(id);
      if (it?.content?.type !== 'section') continue;
      const area = frameBounds(it.frame);
      for (const other of activeItemsRef.current)
        if (
          !out.has(other.id) &&
          !other.style?.locked &&
          other.state !== 'deleted' &&
          contains(area, frameBounds(other.frame || {}))
        )
          out.add(other.id);
    }
    return [...out];
  };

  const itemPointerDown = (e, id) => {
    const item = itemsByIdRef.current.get(id);
    if (!item) return;
    setContextMenu(null);
    if (tool === 'eraser') {
      if (e.button !== 0) return;
      e.stopPropagation();
      capture(e.pointerId);
      gestureRef.current = { type: 'erase', pointerId: e.pointerId, mask: 1, erased: new Set() };
      eraseAt(e.clientX, e.clientY, gestureRef.current);
      return;
    }
    // The marquee tool selects from wherever it starts, objects included.
    if (tool === 'marquee') return;
    if (e.button !== 0) return;
    e.stopPropagation();
    document.activeElement?.blur?.();

    const wasSelected = selectedIdsRef.current.has(id);
    let next;
    if (e.shiftKey || e.metaKey || e.ctrlKey) {
      next = new Set(selectedIdsRef.current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
    } else {
      next = wasSelected ? selectedIdsRef.current : new Set([id]);
    }
    select(next);
    sendPresence({ selected: [...next] });
    const reclick = wasSelected && !e.shiftKey && !e.metaKey && !e.ctrlKey;
    if (item.style?.locked) {
      if (reclick) toggleMenuSoon();
      return;
    }

    const ids = withSectionContents(
      [...next].filter((x) => !itemsByIdRef.current.get(x)?.style?.locked),
    );
    const moving = new Set(ids);
    capture(e.pointerId, e.currentTarget);
    gestureRef.current = {
      type: 'drag',
      pointerId: e.pointerId,
      mask: 1,
      started: false,
      reclick,
      startClient: [e.clientX, e.clientY],
      startWorld: screenToWorld(e.clientX, e.clientY),
      frames0: new Map(
        ids.map((x) => [
          x,
          { ...(itemsByIdRef.current.get(x)?.frame || { x: 0, y: 0, w: 100, h: 100 }) },
        ]),
      ),
      // Alignment targets: what is on screen and not moving.
      others: visibleRef.current
        .filter((it) => !moving.has(it.id) && it.content?.type !== 'stroke')
        .map((it) => frameBounds(it.frame || { x: 0, y: 0, w: 0, h: 0 })),
      raf: 0,
    };
  };

  const handlePointerDown = (e, id, anchor) => {
    e.stopPropagation();
    if (e.button !== 0) return;
    setContextMenu(null);
    const world = screenToWorld(e.clientX, e.clientY);
    const target = e.currentTarget;
    const begin = () => {
      capture(e.pointerId, target);
      setGestureActive(true);
    };

    if (id === GROUP) {
      const list = unlockedNow();
      if (!list.length) return;
      begin();
      const frames0 = Object.fromEntries(list.map((it) => [it.id, { ...it.frame }]));
      const box0 = groupBounds(Object.values(frames0));
      const center = { x: box0.x + box0.w / 2, y: box0.y + box0.h / 2 };
      gestureRef.current =
        anchor === 'rotate'
          ? {
              type: 'grotate',
              pointerId: e.pointerId,
              mask: 1,
              frames0,
              center,
              start: handleAngle(center, world),
              raf: 0,
            }
          : {
              type: 'gresize',
              pointerId: e.pointerId,
              mask: 1,
              frames0,
              items: Object.fromEntries(list.map((it) => [it.id, it])),
              box0,
              fixed: {
                x: anchor.includes('w') ? box0.x + box0.w : box0.x,
                y: anchor.includes('n') ? box0.y + box0.h : box0.y,
              },
              raf: 0,
            };
      return;
    }

    const item = itemsByIdRef.current.get(id);
    if (!item || item.style?.locked) return;
    begin();
    const f0 = { rotation: 0, scale: 1, ...(item.frame || { x: 0, y: 0, w: 100, h: 100 }) };
    // A legacy tilt becomes a real rotation the first time the item is changed.
    if (!f0.rotation && item.style?.tilt) f0.rotation = item.style.tilt;
    if (item.content?.type === 'text') {
      const m = measuredRef.current.get(id);
      if (m) {
        f0.h = m.h;
        if (item.style?.autoWidth !== false) f0.w = m.w;
      }
    }
    setResizingId(id);
    const base = { pointerId: e.pointerId, mask: 1, id, item, frame0: f0, raf: 0 };

    if (anchor === 'rotate') {
      const center = frameCenter(f0);
      gestureRef.current = {
        ...base,
        type: 'rotate',
        center,
        start: handleAngle(center, world),
        base: f0.rotation || 0,
      };
    } else if (anchor.startsWith('edge-')) {
      const edge = anchor.slice(5);
      gestureRef.current = {
        ...base,
        type: 'reshape',
        edge,
        axis: edge === 's' ? 'y' : 'x',
        kind: item.content?.kind,
        size: widgetSize(item),
        wk: widgetScale(item),
      };
    } else if (anchor.startsWith('side-')) {
      gestureRef.current = { ...base, type: 'side', side: anchor.slice(5) };
    } else {
      gestureRef.current = { ...base, type: 'resize', anchor, bbox0: { w: f0.w, h: f0.h } };
    }
  };

  const sideFrame = (g, cur) => {
    const { frame0: f0, side, item } = g;
    const type = item.content?.type;
    const minW = MIN_SIDE[type] || 40;
    const minH = MIN_SIDE_H[type] || 40;
    let w = f0.w;
    let h = f0.h;
    if (side === 'e') w = Math.max(minW, cur.x - f0.x);
    if (side === 'w') w = Math.max(minW, f0.x + f0.w - cur.x);
    if (side === 's') h = Math.max(minH, cur.y - f0.y);
    if (side === 'n') h = Math.max(minH, f0.y + f0.h - cur.y);
    let ratio = null;
    const raw = { w, h };
    if (type === 'gallery') {
      // The photo window snaps to a common ratio; the other side stays.
      const [pt, pr, pb, pl] = GALLERY_PADDING[item.style?.frameStyle] || GALLERY_PADDING.none;
      const innerW = Math.max(1, w - pl - pr);
      const innerH = Math.max(1, h - pt - pb);
      ratio = snapRatio(innerW / innerH);
      if (side === 'e' || side === 'w') w = Math.round(innerH * ratioNumber(ratio) + pl + pr);
      else h = Math.round(innerW / ratioNumber(ratio) + pt + pb);
    }
    const next = {
      ...f0,
      w: Math.round(w),
      h: Math.round(h),
      x: side === 'w' ? Math.round(f0.x + f0.w - w) : f0.x,
      y: side === 'n' ? Math.round(f0.y + f0.h - h) : f0.y,
    };
    const rawBox = {
      x: side === 'w' ? f0.x + f0.w - raw.w : f0.x,
      y: side === 'n' ? f0.y + f0.h - raw.h : f0.y,
      w: raw.w,
      h: raw.h,
    };
    return { frame: keepAnchor(f0, next, side), ratio, rawBox };
  };

  const handlePointerMove = (e) => {
    const g = gestureRef.current;
    if (!g || e.pointerId !== g.pointerId) return;
    // A release that happened outside the window never reached us.
    if (e.pointerType === 'mouse' && (e.buttons & g.mask) === 0) {
      endGesture(e);
      return;
    }

    if (g.type === 'pan') {
      setView({
        ...g.view0,
        x: g.view0.x + e.clientX - g.startX,
        y: g.view0.y + e.clientY - g.startY,
      });
    } else if (g.type === 'draw') {
      const evs = e.nativeEvent.getCoalescedEvents?.() ?? [e.nativeEvent];
      for (const ev of evs.length ? evs : [e.nativeEvent]) {
        const p = screenToWorld(ev.clientX, ev.clientY);
        g.points.push([p.x, p.y]);
      }
      if (!g.raf)
        g.raf = requestAnimationFrame(() => {
          g.raf = 0;
          draftPathRef.current?.setAttribute('d', pathD(g.points));
        });
    } else if (g.type === 'erase') {
      eraseAt(e.clientX, e.clientY, g);
    } else if (g.type === 'marquee') {
      const cur = screenToWorld(e.clientX, e.clientY);
      const rect = rectFrom(g.start, cur);
      if (!g.moved && rect.w * viewRef.current.k < 3 && rect.h * viewRef.current.k < 3) return;
      g.moved = true;
      const hits = new Set(g.base);
      for (const it of activeItemsRef.current) {
        const b = frameBounds(it.frame || { x: 0, y: 0, w: 0, h: 0 });
        // Sections only when fully inside, so a big area is not picked up by accident.
        if (it.content?.type === 'section' ? contains(rect, b) : intersects(rect, b))
          hits.add(it.id);
      }
      g.hits = hits;
      setMarquee(rect);
      select(hits);
    } else if (g.type === 'drag') {
      if (!g.started) {
        const dx = e.clientX - g.startClient[0];
        const dy = e.clientY - g.startClient[1];
        if (Math.hypot(dx, dy) < DRAG_THRESHOLD) return;
        g.started = true;
        clearTimeout(menuTimer.current);
        setGestureActive(true);
      }
      const cur = screenToWorld(e.clientX, e.clientY);
      let dx = cur.x - g.startWorld.x;
      let dy = cur.y - g.startWorld.y;
      let guides = null;
      // Alignment guides (toggle beside the zoom); hold Alt (⌥) to flip it
      // for this drag. Only objects close to the moving one take part.
      if (snapRef.current !== e.altKey && g.others.length) {
        g.box0 ||= groupBounds([...g.frames0.values()]);
        const moved = { ...g.box0, x: g.box0.x + dx, y: g.box0.y + dy };
        const k = viewRef.current.k;
        const snap = snapToGuides(moved, g.others, 6 / k, 240 / k);
        dx += snap.dx;
        dy += snap.dy;
        guides = snap.guides.length ? snap.guides : null;
      }
      const frames = {};
      for (const [id, f0] of g.frames0)
        frames[id] = { ...f0, x: Math.round(f0.x + dx), y: Math.round(f0.y + dy) };
      scheduleLive(g, { frames, guides });
    } else if (g.type === 'resize') {
      const cur = toLocal(screenToWorld(e.clientX, e.clientY), g.frame0);
      const { frame0: f0, bbox0, anchor } = g;
      let sx = 1;
      let sy = 1;
      if (anchor.includes('e')) sx = Math.max(0.1, (cur.x - f0.x) / (bbox0.w || 1));
      if (anchor.includes('w')) sx = Math.max(0.1, (f0.x + bbox0.w - cur.x) / (bbox0.w || 1));
      if (anchor.includes('s')) sy = Math.max(0.1, (cur.y - f0.y) / (bbox0.h || 1));
      if (anchor.includes('n')) sy = Math.max(0.1, (f0.y + bbox0.h - cur.y) / (bbox0.h || 1));
      const f = keepAnchor(f0, scaled(g.item, f0, bbox0, sx, sy, anchor), anchor);
      scheduleLive(g, { frames: { [g.id]: f } });
    } else if (g.type === 'side') {
      const cur = toLocal(screenToWorld(e.clientX, e.clientY), g.frame0);
      const { frame, ratio, rawBox } = sideFrame(g, cur);
      g.ratio = ratio;
      scheduleLive(g, {
        frames: { [g.id]: frame },
        labels: ratio ? { [g.id]: ratio } : null,
        boxes: ratio ? { [g.id]: rawBox } : null,
      });
    } else if (g.type === 'rotate') {
      const cur = screenToWorld(e.clientX, e.clientY);
      const angle = snapAngle(g.base + handleAngle(g.center, cur) - g.start, e.shiftKey);
      scheduleLive(g, {
        frames: { [g.id]: { ...g.frame0, rotation: angle } },
        angles: { [g.id]: `${Math.round(angle)}°` },
      });
    } else if (g.type === 'grotate') {
      const cur = screenToWorld(e.clientX, e.clientY);
      const delta = snapAngle(handleAngle(g.center, cur) - g.start, e.shiftKey);
      g.delta = delta;
      scheduleLive(g, { frames: rotateFrames(g.frames0, g.center, delta), groupAngle: delta });
    } else if (g.type === 'gresize') {
      const cur = screenToWorld(e.clientX, e.clientY);
      const { box0, fixed } = g;
      const s = Math.min(
        10,
        Math.max(
          0.1,
          Math.max(
            Math.abs(cur.x - fixed.x) / (box0.w || 1),
            Math.abs(cur.y - fixed.y) / (box0.h || 1),
          ),
        ),
      );
      const frames = {};
      for (const [id, f0] of Object.entries(g.frames0)) {
        const c0 = frameCenter(f0);
        const c1 = { x: fixed.x + (c0.x - fixed.x) * s, y: fixed.y + (c0.y - fixed.y) * s };
        const sz = scaled(g.items[id], f0, { w: f0.w, h: f0.h }, s, s, 'se');
        frames[id] = {
          ...sz,
          x: Math.round(c1.x - sz.w / 2),
          y: Math.round(c1.y - sz.h / 2),
          rotation: f0.rotation || 0,
        };
      }
      scheduleLive(g, { frames });
    } else if (g.type === 'reshape') {
      const cur = toLocal(screenToWorld(e.clientX, e.clientY), g.frame0);
      const f0 = g.frame0;
      let box;
      if (g.edge === 'e') box = { x: f0.x, y: f0.y, w: Math.max(40, cur.x - f0.x), h: f0.h };
      else if (g.edge === 'w') {
        const w = Math.max(40, f0.x + f0.w - cur.x);
        box = { x: f0.x + f0.w - w, y: f0.y, w, h: f0.h };
      } else box = { x: f0.x, y: f0.y, w: f0.w, h: Math.max(40, cur.y - f0.y) };
      g.size = pickWidgetSize(g.kind, box.w, box.h, g.size, g.axis);
      const [bw, bh] = WIDGET_SIZES[g.size] || [168, 168];
      const w = Math.round(bw * g.wk);
      const h = Math.round(bh * g.wk);
      const frame = keepAnchor(
        f0,
        { ...f0, w, h, x: g.edge === 'w' ? f0.x + f0.w - w : f0.x },
        g.edge,
      );
      scheduleLive(g, {
        frames: { [g.id]: frame },
        sizes: { [g.id]: g.size },
        boxes: { [g.id]: box },
      });
    }
  };

  const endGesture = () => {
    const g = gestureRef.current;
    if (!g) return;
    gestureRef.current = null;
    cancelAnimationFrame(g.raf);
    stageRef.current?.classList.remove('panning');
    setGestureActive(false);
    setResizingId(null);

    if (g.type === 'draw') {
      if (g.points.length >= 2) {
        // Same origin and (nearly) the same points as the draft: no jump on release.
        const { frame, points } = finalizeStroke(g.points, simplify);
        const isHl = g.look.tool === 'highlighter';
        // addItem updates local items synchronously before awaiting the
        // server, so the saved stroke replaces the draft in the same frame.
        addItem({
          content: { type: 'stroke', tool: g.look.tool, points },
          style: { color: g.look.color, size: isHl ? 16 : g.look.size },
          frame,
          z: topZ(activeItemsRef.current),
        }).catch(() => {});
      }
      setDrawing(null);
      return;
    }
    if (g.type === 'erase') {
      if (g.erased.size) pushHistory({ type: 'delete', ids: [...g.erased] });
      return;
    }
    if (g.type === 'marquee') {
      setMarquee(null);
      if (!g.moved) {
        select(g.base);
        return;
      }
      sendPresence({ selected: [...(g.hits || [])] });
      // One marquee, then back to selecting so the picked objects can be moved.
      if (tool === 'marquee' && g.hits?.size) setTool('select');
      return;
    }
    if (g.type === 'drag' && !g.started) {
      if (g.reclick) toggleMenuSoon();
      return;
    }
    const transforms = ['drag', 'resize', 'reshape', 'side', 'rotate', 'grotate', 'gresize'];
    if (transforms.includes(g.type) && g.pending) {
      const changes = Object.entries(g.pending.frames).map(([id, frame]) => {
        const it = itemsByIdRef.current.get(id);
        const patch = { frame };
        let style = null;
        if (g.type === 'reshape') style = { ...(it?.style || {}), size: g.pending.sizes[id] };
        if (g.type === 'side' && it?.content?.type === 'text') {
          style = { ...(it.style || {}), autoWidth: false };
          patch.frame = { ...frame, h: measuredRef.current.get(id)?.h ?? frame.h };
        }
        if (g.type === 'side' && g.ratio) style = { ...(it?.style || {}), ratio: g.ratio };
        // Rotation replaces the old decorative tilt.
        if (it?.style?.tilt && (frame.rotation || 0) !== (it.frame?.rotation || 0))
          style = { ...(style || it.style), tilt: 0 };
        if (style) patch.style = style;
        return { id, patch };
      });
      applyPatches(changes);
      setLocalLive(null); // batched with the local item update: no flash back
      sendPresence({ live: null, selected: [...selectedIdsRef.current] }, { immediate: true });
      return;
    }
    if (transforms.includes(g.type)) setLocalLive(null);
  };

  // Start the draft path at the first point as soon as it mounts.
  const setDraftPath = useCallback((el) => {
    draftPathRef.current = el;
    const g = gestureRef.current;
    if (el && g?.type === 'draw') el.setAttribute('d', pathD(g.points));
  }, []);

  const onStageContextMenu = (e) => {
    if (e.target.closest('.ui')) return;
    e.preventDefault();
    if (gestureRef.current) return;
    if (tool !== 'select' && tool !== 'marquee') setTool('select');
    const id = e.target.closest?.('.board-item[data-item-id]')?.dataset?.itemId;
    const container = stageRef.current?.parentElement?.getBoundingClientRect();
    const pos = { x: e.clientX - (container?.left || 0), y: e.clientY - (container?.top || 0) };
    clearTimeout(menuTimer.current);
    setActionsOpen(false);
    if (id && itemsByIdRef.current.get(id)) {
      if (!selectedIdsRef.current.has(id)) {
        select([id]);
        sendPresence({ selected: [id] });
      }
      setContextMenu({ ...pos, kind: 'item' });
    } else {
      select([]);
      setContextMenu({ ...pos, kind: 'canvas', at: screenToWorld(e.clientX, e.clientY) });
    }
  };

  // ---------- Text ----------
  const commitText = (id, text, size, html) => {
    const item = itemsByIdRef.current.get(id);
    if (!item) return;
    if (item.content?.type === 'text' && !text.trim()) {
      // Nothing was typed: drop it without leaving a ghost in 最近删除.
      deleteBoardItem(id).catch(() => {});
      select([]);
      return;
    }
    const patch = {};
    if (html !== undefined) {
      if (html !== (item.content?.html || '') || text !== (item.content?.text || ''))
        patch.content = { ...item.content, text, html };
    } else if (text !== (item.content?.text || '')) patch.content = { ...item.content, text };
    if (size) {
      const f = item.frame || {};
      if (Math.abs((f.w || 0) - size.w) > 1 || Math.abs((f.h || 0) - size.h) > 1)
        patch.frame = { ...f, w: size.w, h: size.h };
    }
    if (Object.keys(patch).length) applyPatches([{ id, patch }]);
  };
  const endEditing = () => {
    setEditingId(null);
    sendPresence({ editing: null, selected: [...selectedIdsRef.current] });
  };
  const itemDoubleClick = (id) => {
    clearTimeout(menuTimer.current);
    setActionsOpen(false);
    const item = itemsByIdRef.current.get(id);
    if (!item || item.style?.locked) return;
    const type = item.content?.type;
    if (['note', 'text', 'todo', 'gallery', 'section'].includes(type)) {
      select([id]);
      setEditingId(id);
      sendPresence({ editing: id, selected: [id] });
    } else if (type === 'widget') {
      openTarget(item);
    }
  };

  // Stable callbacks for memoized BoardItem.
  const handlers = useRef({});
  const contentChange = (id, content) => {
    const item = itemsByIdRef.current.get(id);
    if (!item) return;
    const patch = { content };
    // A gallery that loses its last photo keeps its frame; nothing else to fix.
    applyPatches([{ id, patch }]);
  };
  const autoHeight = (id, h) => {
    const item = itemsByIdRef.current.get(id);
    const f = item?.frame;
    // Only grows: a list that was made taller by hand keeps its height.
    if (!f || h <= f.h + 2 || gestureRef.current) return;
    patchBoardItem(id, { frame: { ...f, h: Math.max(80, Math.min(1200, h)) } }).catch(() => {});
  };
  handlers.current = {
    itemPointerDown,
    handlePointerDown,
    commitText,
    endEditing,
    itemDoubleClick,
    contentChange,
    autoHeight,
    galleryAdd: (id) => openGalleryPicker({ id }),
    upload: (file) => startUpload(file),
  };
  const itemCallbacks = useMemo(
    () => ({
      onItemPointerDown: (e, id) => handlers.current.itemPointerDown(e, id),
      onHandlePointerDown: (e, id, a) => handlers.current.handlePointerDown(e, id, a),
      onCommitText: (id, text, size, html) => handlers.current.commitText(id, text, size, html),
      onContentChange: (id, content) => handlers.current.contentChange(id, content),
      onAutoHeight: (id, h) => handlers.current.autoHeight(id, h),
      onGalleryAddImages: (id) => handlers.current.galleryAdd(id),
      onEndEditing: (id) => handlers.current.endEditing(id),
      onItemDoubleClick: (id) => handlers.current.itemDoubleClick(id),
      onMeasure,
    }),
    [],
  );

  // ---------- Keyboard (N-3) ----------
  const modalOpenRef = useRef(modalOpen);
  modalOpenRef.current = modalOpen;
  const keyHandlers = useRef({});
  keyHandlers.current = {
    undo,
    redo,
    deleteSelected,
    duplicate,
    selectAll,
    bringToFront,
    sendToBack,
    nudge,
    pickImages: () => imagePicker.current?.click(),
  };
  useEffect(() => {
    const onKey = (e) => {
      if (e.defaultPrevented || e.isComposing || e.keyCode === 229) return;
      if (modalOpenRef.current) return;
      const t = e.target;
      if (e.key === 'Escape' && t?.closest?.('#panel, #drawer')) {
        setPanelOpen(false);
        setDeletionsOpen(false);
        return;
      }
      if (
        t?.closest?.(
          'input, textarea, select, [contenteditable="true"], [role="dialog"], [role="menu"]',
        )
      )
        return;
      const mod = e.metaKey || e.ctrlKey;
      if (mod && !e.altKey && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        if (e.shiftKey) keyHandlers.current.redo();
        else keyHandlers.current.undo();
        return;
      }
      if (mod && !e.altKey && e.key.toLowerCase() === 'y') {
        e.preventDefault();
        keyHandlers.current.redo();
        return;
      }
      if (mod && !e.altKey && e.key.toLowerCase() === 'a') {
        e.preventDefault();
        keyHandlers.current.selectAll();
        return;
      }
      if (mod && !e.altKey && e.key.toLowerCase() === 'd') {
        e.preventDefault();
        if (selectedIdsRef.current.size) keyHandlers.current.duplicate();
        return;
      }
      const arrows = {
        ArrowLeft: [-1, 0],
        ArrowRight: [1, 0],
        ArrowUp: [0, -1],
        ArrowDown: [0, 1],
      };
      if (arrows[e.key] && selectedIdsRef.current.size && !mod) {
        e.preventDefault();
        const step = e.shiftKey ? 10 : 1;
        keyHandlers.current.nudge(arrows[e.key][0] * step, arrows[e.key][1] * step);
        return;
      }
      if (mod || e.altKey) return;
      const k = e.key.toLowerCase();
      if (e.key === 'Backspace' || e.key === 'Delete') {
        if (selectedIdsRef.current.size) {
          e.preventDefault();
          keyHandlers.current.deleteSelected();
        }
      } else if (e.key === ']') keyHandlers.current.bringToFront();
      else if (e.key === '[') keyHandlers.current.sendToBack();
      else if (k === 'm') setTool('marquee');
      else if (k === 'i') keyHandlers.current.pickImages();
      else if (k === 'v') setTool('select');
      else if (k === 's') setPanelOpen((p) => !p);
      else if (k === 't') setTool('text');
      else if (k === 'p') setTool('pen');
      else if (k === 'h') setTool('highlighter');
      else if (k === 'e') setTool('eraser');
      else if (e.key === 'Escape') {
        setEditingId(null);
        setContextMenu(null);
        setActionsOpen(false);
        select([]);
        setPanelOpen(false);
        setDeletionsOpen(false);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [select]);

  // ---------- Render data ----------
  const frameOf = (it) => localLive?.frames?.[it.id] ?? remoteLive.get(it.id) ?? it.frame;

  const visibleItems = useMemo(() => {
    if (!stageSize.w || !stageSize.h) return activeItems;
    const margin = 200;
    const minX = -view.x / view.k - margin;
    const minY = -view.y / view.k - margin;
    const maxX = (stageSize.w - view.x) / view.k + margin;
    const maxY = (stageSize.h - view.y) / view.k + margin;
    return activeItems.filter((it) => {
      const f = it.frame || {};
      return f.x + (f.w || 0) >= minX && f.x <= maxX && f.y + (f.h || 0) >= minY && f.y <= maxY;
    });
  }, [activeItems, view, stageSize]);
  visibleRef.current = visibleItems;

  // Display items keep their identity unless their frame/size is live, so
  // memoized BoardItems skip re-rendering.
  const displayCache = useRef(new Map());
  const displayItem = (it) => {
    const f = frameOf(it);
    const size = localLive?.sizes?.[it.id];
    if (f === it.frame && !size) return it;
    const key = `${it.id}`;
    const prev = displayCache.current.get(key);
    if (prev && prev.src === it && prev.f === f && prev.size === size) return prev.out;
    const out = {
      ...it,
      frame: f,
      ...(size ? { style: { ...(it.style || {}), size } } : {}),
    };
    displayCache.current.set(key, { src: it, f, size, out });
    return out;
  };

  // Selection on screen: the box around everything selected (rotation included).
  const selectedFrames = selectedItems.map((it) => {
    const f = frameOf(it) || { x: 0, y: 0, w: 100, h: 100 };
    const m = it.content?.type === 'text' ? measuredRef.current.get(it.id) : null;
    const shown = m ? { ...f, h: m.h, w: it.style?.autoWidth !== false ? m.w : f.w } : f;
    return { ...shown, rotation: itemRotation({ ...it, frame: shown }) };
  });
  const selectionBox = selectedFrames.length ? groupBounds(selectedFrames) : null;
  const multi = selectedItems.length > 1;
  const groupLocked = multi && selectedItems.every((it) => it.style?.locked);

  // The bar stays mounted while a gesture runs and only fades, so starting or
  // ending a drag/scale no longer pops it in and out.
  const actionsHidden = gestureActive || Boolean(editingId) || Boolean(drawing);
  let actionsRect = null;
  if (selectionBox) {
    const p = toScreen({ x: selectionBox.x, y: selectionBox.y }, view);
    actionsRect = { x: p.x, y: p.y, w: selectionBox.w * view.k, h: selectionBox.h * view.k };
  }

  const editingItem = editingId ? itemsById.get(editingId) : null;
  let formatRect = null;
  if (editingItem?.content?.type === 'note') {
    const f = frameOf(editingItem);
    const b = frameBounds(f);
    const p = toScreen({ x: b.x, y: b.y }, view);
    formatRect = { x: p.x, y: p.y, w: b.w * view.k, h: b.h * view.k };
  }

  const preview = (() => {
    if (!dragPreview) return null;
    const t = specTemplate(
      dragPreview.spec.type === 'places'
        ? { type: 'widget', content: { kind: 'places', mark: dragPreview.spec.mark }, size: 'M' }
        : dragPreview.spec,
    );
    if (!t) return null;
    return {
      id: PREVIEW_ID,
      tripId,
      content: t.content,
      style: t.style,
      frame: {
        x: dragPreview.at.x - t.w / 2,
        y: dragPreview.at.y - t.h / 2,
        w: t.w,
        h: t.h,
        scale: 1,
      },
      z: 99998,
    };
  })();

  const contextItems = (() => {
    if (!contextMenu) return [];
    if (contextMenu.kind === 'canvas') {
      const at = contextMenu.at;
      return [
        {
          label: '在这里贴便签',
          icon: 'note',
          onClick: () => addSpec({ type: 'note', color: 'yellow' }, at),
        },
        { label: '在这里加待办', icon: 'todo', onClick: () => addSpec({ type: 'todo' }, at) },
        { label: '在这里画分区', icon: 'section', onClick: () => addSpec({ type: 'section' }, at) },
        {
          label: '上传图片…',
          icon: 'image',
          shortcut: 'I',
          onClick: () => imagePicker.current?.click(),
        },
        { divider: true },
        { label: '全选', shortcut: '⌘A', onClick: selectAll, disabled: !activeItems.length },
        { label: '适应全板', onClick: fitContent, disabled: !activeItems.length },
      ];
    }
    const list = selectedItems;
    const one = list.length === 1 ? list[0] : null;
    const type = one?.content?.type;
    const locked = list.length > 0 && list.every((it) => it.style?.locked);
    const out = [];
    if (one && ['note', 'text', 'todo', 'gallery', 'section'].includes(type) && !locked)
      out.push({
        label: type === 'gallery' ? '调整显示' : '编辑',
        icon: 'edit',
        shortcut: '双击',
        onClick: () => itemDoubleClick(one.id),
      });
    if (
      one &&
      type === 'widget' &&
      one.content.kind !== 'clock' &&
      one.content.kind !== 'countdown'
    )
      out.push({ label: '打开', icon: 'open', onClick: () => openTarget(one) });
    if (!locked)
      out.push({ label: '外观与样式…', icon: 'style', onClick: () => setActionsOpen(true) });
    if (one && type === 'image' && one.content.assetId)
      out.push({ label: '收藏到我的表情', icon: 'heart', onClick: () => saveToStickers(one) });
    out.push({ divider: true });
    out.push({ label: '复制一份', icon: 'copy', shortcut: '⌘D', onClick: duplicate });
    out.push({ label: '置于顶层', icon: 'front', shortcut: ']', onClick: bringToFront });
    out.push({ label: '置于底层', icon: 'back', shortcut: '[', onClick: sendToBack });
    if (list.length > 1 && !locked)
      out.push({
        label: '对齐',
        icon: 'align',
        children: [
          { label: '左对齐', onClick: () => alignSelected('left') },
          { label: '水平居中', onClick: () => alignSelected('hcenter') },
          { label: '右对齐', onClick: () => alignSelected('right') },
          { label: '顶端对齐', onClick: () => alignSelected('top') },
          { label: '垂直居中', onClick: () => alignSelected('vcenter') },
          { label: '底端对齐', onClick: () => alignSelected('bottom') },
          { divider: true },
          { label: '水平等距', onClick: () => alignSelected('hspace'), disabled: list.length < 3 },
          { label: '垂直等距', onClick: () => alignSelected('vspace'), disabled: list.length < 3 },
        ],
      });
    if (!list.some((it) => it.content?.type === 'section'))
      out.push({ label: '框进分区', icon: 'section', onClick: wrapInSection });
    out.push({
      label: locked ? '解锁' : '锁定',
      icon: locked ? 'unlock' : 'lock',
      onClick: toggleLock,
    });
    out.push({ divider: true });
    out.push({
      label: '删除',
      icon: 'delete',
      shortcut: '⌫',
      danger: true,
      onClick: deleteSelected,
    });
    return out;
  })();

  const mapDetail = view.k >= 0.4;
  const gridSize = (view.k < 0.4 ? 48 : 24) * view.k;
  const empty = !loading && activeItems.length === 0 && uploads.length === 0;
  const topSafe = narrow ? 84 : 76;
  const guides = localLive?.guides || null;

  return (
    <div
      className="board-container"
      data-panel={panelOpen ? 'open' : 'closed'}
      data-dock={narrow ? 'sheet' : dock}
    >
      <BoardSwitcher
        boards={boards.length ? boards : activeBoard ? [activeBoard] : []}
        currentId={boardId}
        counts={{ ...counts, [boardId]: activeItems.length }}
        startRenaming={boardContext?.renaming === boardId}
        onOpenChange={(open) => {
          setMenuOpen(open);
          if (!open && boardContext?.renaming) onBoardContext?.({ renaming: null });
        }}
        onSwitch={(id) => switchBoard(id)}
        onCreate={createBoard}
        onRename={renameBoard}
        onDelete={deleteBoard}
        canDelete={canDeleteBoard}
        onOpenDeletions={() => {
          setPanelOpen(false);
          setDeletionsOpen(true);
        }}
      />

      <div
        id="stage"
        ref={stageRef}
        data-tool={tool}
        data-sparse={view.k < 0.4 ? 'true' : undefined}
        style={{
          '--grid-x': `${view.x}px`,
          '--grid-y': `${view.y}px`,
          '--grid-size': `${gridSize}px`,
        }}
        onDragOver={(e) => {
          if (![...(e.dataTransfer?.types || [])].includes('Files')) return;
          e.preventDefault();
          e.dataTransfer.dropEffect = 'copy';
          setDropping(true);
        }}
        onDragLeave={(e) => {
          if (!e.currentTarget.contains(e.relatedTarget)) setDropping(false);
        }}
        onDrop={(e) => {
          const files = [...(e.dataTransfer?.files || [])].filter((f) =>
            f.type.startsWith('image/'),
          );
          setDropping(false);
          if (!files.length) return;
          e.preventDefault();
          const at = screenToWorld(e.clientX, e.clientY);
          files
            .slice(0, 12)
            .forEach((file, i) => startUpload(file, null, { x: at.x + i * 28, y: at.y + i * 28 }));
        }}
        data-dropping={dropping ? 'true' : undefined}
        onPointerDown={handleStagePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={endGesture}
        onPointerCancel={endGesture}
        onLostPointerCapture={endGesture}
        onContextMenu={onStageContextMenu}
      >
        <MapDetailContext.Provider value={mapDetail}>
          <div
            id="world"
            style={{
              transform: `translate(${view.x}px, ${view.y}px) scale(${view.k})`,
              '--ik': 1 / view.k,
            }}
          >
            <div id="items">
              {visibleItems.map((item) => {
                const peer = peerSelections.get(item.id);
                const shown = displayItem(item);
                const size = localLive?.sizes?.[item.id];
                const selected = selectedIds.has(item.id);
                return (
                  <BoardItem
                    key={item.id}
                    item={shown}
                    snapshot={snapshot}
                    selected={selected}
                    handles={selected && !multi}
                    isEditing={editingId === item.id}
                    flash={flashId === item.id}
                    peerName={peer?.name || null}
                    peerColor={peer?.color || null}
                    peerEditing={Boolean(peer?.editing)}
                    resizing={resizingId === item.id}
                    reshape={
                      size
                        ? { size, box: localLive.boxes[item.id] }
                        : localLive?.labels?.[item.id]
                          ? { box: localLive.boxes[item.id] }
                          : null
                    }
                    ratioLabel={localLive?.labels?.[item.id] ?? null}
                    angleLabel={localLive?.angles?.[item.id] ?? null}
                    tripId={tripId}
                    {...itemCallbacks}
                  />
                );
              })}
              {preview && (
                <BoardItem
                  key={PREVIEW_ID}
                  item={preview}
                  snapshot={snapshot}
                  preview
                  tripId={tripId}
                />
              )}
              {uploads.map((u) => (
                <div
                  key={u.id}
                  className={`board-item upload-placeholder ${u.status}`}
                  style={{
                    transform: `translate(${u.frame.x}px, ${u.frame.y}px)`,
                    width: u.frame.w,
                    height: u.frame.h,
                    zIndex: 99990,
                  }}
                  onPointerDown={(e) => e.stopPropagation()}
                >
                  {u.status === 'uploading' ? (
                    <>
                      <span className="ring" aria-hidden="true" />
                      <span>{u.message || '正在上传…'}</span>
                    </>
                  ) : (
                    <>
                      <span>上传失败 · {u.message}</span>
                      <span className="row">
                        {u.file && <button onClick={() => startUpload(u.file, u)}>重试</button>}
                        <button
                          onClick={() => setUploads((list) => list.filter((x) => x.id !== u.id))}
                        >
                          移除
                        </button>
                      </span>
                    </>
                  )}
                </div>
              ))}
            </div>

            {multi && selectionBox && (
              <div
                className={`group-box ${gestureActive ? 'is-moving' : ''}`}
                style={{
                  transform: `translate(${selectionBox.x}px, ${selectionBox.y}px)`,
                  width: selectionBox.w,
                  height: selectionBox.h,
                }}
              >
                <span className="count">
                  {localLive?.groupAngle != null
                    ? `${Math.round(localLive.groupAngle)}°`
                    : `已选 ${selectedItems.length} 项`}
                </span>
                {!groupLocked && (
                  <>
                    <div
                      className="handle rotate h-rot"
                      role="presentation"
                      title="拖动旋转，按住 Shift 每次 15°"
                      onPointerDown={(e) => handlePointerDown(e, GROUP, 'rotate')}
                    />
                    {['nw', 'ne', 'se', 'sw'].map((a) => (
                      <div
                        key={a}
                        className={`handle corner h-${a}`}
                        onPointerDown={(e) => handlePointerDown(e, GROUP, a)}
                      />
                    ))}
                  </>
                )}
              </div>
            )}

            {marquee && (
              <div
                className="marquee"
                style={{
                  transform: `translate(${marquee.x}px, ${marquee.y}px)`,
                  width: marquee.w,
                  height: marquee.h,
                }}
              />
            )}

            {guides?.map((gd, i) => (
              <div
                key={i}
                className={`guide ${gd.axis}`}
                style={
                  gd.axis === 'x'
                    ? { transform: `translate(${gd.pos}px, ${gd.from}px)`, height: gd.to - gd.from }
                    : { transform: `translate(${gd.from}px, ${gd.pos}px)`, width: gd.to - gd.from }
                }
              />
            ))}

            {drawing &&
              (() => {
                const st = strokeLook(drawing.tool, drawing.color, drawing.size);
                return (
                  <svg
                    id="draft"
                    className={drawing.tool === 'highlighter' ? 'highlighter' : ''}
                    aria-hidden="true"
                  >
                    <path
                      ref={setDraftPath}
                      stroke={st.stroke}
                      strokeWidth={st.width}
                      strokeOpacity={st.opacity}
                      fill="none"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  </svg>
                );
              })()}
          </div>
        </MapDetailContext.Provider>
      </div>

      {empty && (
        <p className="board-empty-hint" aria-live="polite">
          从{panelOpen ? DOCK_NAMES[narrow ? 'bottom' : dock] : ''}贴纸面板拖入行程、地点，或按 P
          开始画
        </p>
      )}

      {selectedItems.length > 0 && actionsRect && actionsOpen && (
        <BoardActions
          items={selectedItems}
          rect={actionsRect}
          stage={stageSize}
          topSafe={topSafe}
          hidden={actionsHidden}
          onClose={() => setActionsOpen(false)}
          onColor={changeColor}
          onStyle={changeStyle}
          onGalleryAdd={() => openGalleryPicker({ id: primarySelected.id })}
          onEdit={() => itemDoubleClick(primarySelected.id)}
          onFront={bringToFront}
          onBack={sendToBack}
          onDuplicate={duplicate}
          onToggleLock={toggleLock}
          onDelete={deleteSelected}
          onAlign={alignSelected}
          onWrapSection={wrapInSection}
          onSaveSticker={saveToStickers}
          onSchedulePlace={schedulePlace}
          onOpenTarget={openTarget}
        />
      )}

      {contextMenu && (
        <BoardContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          items={contextItems}
          onClose={() => setContextMenu(null)}
        />
      )}

      <div id="zoom" className="ui glass" role="group" aria-label="缩放">
        <button className="iconbtn" onClick={() => zoomBy(1 / 1.2)} aria-label="缩小">
          <svg viewBox="0 0 24 24">
            <path d="M5 12h14" />
          </svg>
        </button>
        <button
          className="zoom-value"
          onClick={toggleZoom}
          title="在 100% 与适应全板之间切换"
          aria-label={`当前缩放 ${Math.round(view.k * 100)}%，点按切换 100% 或适应全板`}
        >
          {Math.round(view.k * 100)}%
        </button>
        <button className="iconbtn" onClick={() => zoomBy(1.2)} aria-label="放大">
          <svg viewBox="0 0 24 24">
            <path d="M12 5v14M5 12h14" />
          </svg>
        </button>
        <button
          className={`iconbtn snap-toggle ${snapOn ? 'on' : ''}`}
          onClick={toggleSnap}
          aria-pressed={snapOn}
          aria-label={snapOn ? '对齐吸附：开（点按关闭）' : '对齐吸附：关（点按开启）'}
          title={
            snapOn ? '对齐吸附：开 · 拖动时按住 ⌥ 临时关闭' : '对齐吸附：关 · 拖动时按住 ⌥ 临时开启'
          }
        >
          <svg viewBox="0 0 24 24">
            <path d="M6 4v7a6 6 0 0 0 12 0V4h-4v7a2 2 0 0 1-4 0V4z" />
            <path d="M6 8h4M14 8h4" />
          </svg>
        </button>
        <button className="iconbtn" onClick={fitContent} title="适应全板" aria-label="适应全板">
          <svg viewBox="0 0 24 24">
            <path d="M8 3H5a2 2 0 0 0-2 2v3m18 0V5a2 2 0 0 0-2-2h-3m0 18h3a2 2 0 0 0 2-2v-3M3 16v3a2 2 0 0 0 2 2h3" />
          </svg>
        </button>
      </div>

      <BoardToolbar
        activeTool={tool}
        onSelectTool={(t) => {
          setTool(t);
          if (t !== 'select' && t !== 'marquee') select([]);
        }}
        penColor={penColor}
        penSize={penSize}
        onChangePenColor={setPenColor}
        onChangePenSize={setPenSize}
        hlColor={hlColor}
        onChangeHlColor={setHlColor}
        panelOpen={panelOpen}
        onTogglePanel={() => {
          setDeletionsOpen(false);
          setPanelOpen((p) => !p);
        }}
        onPickImages={() => imagePicker.current?.click()}
        canUndo={undoStack.length > 0}
        canRedo={redoStack.length > 0}
        onUndo={undo}
        onRedo={redo}
        hidden={narrow && panelOpen}
      />

      <BoardStickerPanel
        snapshot={snapshot}
        open={panelOpen}
        onClose={() => setPanelOpen(false)}
        dock={dock}
        onDockChange={onDockChange}
        narrow={narrow}
        onAdd={(spec) => addSpec(spec)}
        onDragSpec={panelDrag}
        stickers={stickers}
        onUploadSticker={uploadSticker}
        onRemoveSticker={removeSticker}
      />

      {formatRect && (
        <NoteFormatBar
          rect={formatRect}
          stage={stageSize}
          fontSize={editingItem.style?.fontSize || 'm'}
          onFontSize={(fontSize) =>
            applyPatches([
              { id: editingItem.id, patch: { style: { ...(editingItem.style || {}), fontSize } } },
            ])
          }
        />
      )}

      <input
        ref={galleryPicker}
        type="file"
        accept="image/jpeg,image/png,image/webp,image/gif"
        multiple
        hidden
        onChange={(e) => {
          onGalleryFiles(e.target.files || []);
          e.target.value = '';
        }}
      />
      <input
        ref={imagePicker}
        type="file"
        accept="image/jpeg,image/png,image/webp,image/gif"
        multiple
        hidden
        aria-label="上传图片"
        onChange={(e) => {
          const files = [...(e.target.files || [])].slice(0, 12);
          e.target.value = '';
          const a = visibleArea(stageSize, insetsRef.current);
          const mid = toWorld({ x: a.x + a.w / 2, y: a.y + a.h / 2 }, viewRef.current);
          files.forEach((file, i) =>
            startUpload(file, null, { x: mid.x + i * 28, y: mid.y + i * 28 }),
          );
        }}
      />
      {dropping && <div className="drop-hint">松手把图片放到这里</div>}

      <BoardRecentDeletions
        open={deletionsOpen}
        onClose={() => setDeletionsOpen(false)}
        deletedItems={deletedItems}
        onRestore={(id) => restoreBoardItem(id)}
        deletedBoards={deletedBoards}
        onRestoreBoard={canRestoreBoard ? restoreBoard : null}
      />
    </div>
  );
}

// Left edge of the canvas that the collapsed sidebar does not cover.
function boardLeftOffset(stage) {
  const v = getComputedStyle(stage).getPropertyValue('--board-left');
  return parseFloat(v) || 16;
}
