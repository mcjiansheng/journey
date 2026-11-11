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
  stickerUrl,
} from '../board.js';
import { WIDGET_SIZES, widgetSize, widgetScale, pickWidgetSize } from '../board-widgets.js';

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
  const selectedIdsRef = useRef(selectedIds);
  selectedIdsRef.current = selectedIds;
  const select = useCallback((ids) => {
    const next = ids instanceof Set ? ids : new Set(ids);
    setSelectedIds((prev) => (sameSet(prev, next) ? prev : next));
    return next;
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
  const addNote = async (color = 'yellow', at) => {
    const pt = spawnAt(200, 200, at);
    const item = await addItem(
      {
        content: { type: 'note', text: '' },
        style: { color },
        frame: { x: pt.x, y: pt.y, w: 200, h: 200, scale: 1 },
        z: topZ(activeItemsRef.current),
      },
      { pop: true },
    );
    select([item.id]);
    setEditingId(item.id);
  };
  const addEmoji = async (char, at) => {
    const pt = spawnAt(80, 80, at);
    const item = await addItem(
      {
        content: { type: 'emoji', char },
        style: {},
        frame: { x: pt.x, y: pt.y, w: 80, h: 80, scale: 1 },
        z: topZ(activeItemsRef.current),
      },
      { pop: true },
    );
    select([item.id]);
  };
  const addTodo = async (at) => {
    const pt = spawnAt(260, 160, at);
    const item = await addItem(
      {
        content: { type: 'todo', title: '待办', items: [] },
        style: { color: 'gray', variant: 'plain' },
        frame: { x: pt.x, y: pt.y, w: 260, h: 160, scale: 1 },
        z: topZ(activeItemsRef.current),
      },
      { pop: true },
    );
    select([item.id]);
    setEditingId(item.id);
  };
  // 图库: pick photos first, then the gallery appears with all of them.
  const galleryPicker = useRef(null);
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
    const ratio = first.width >= first.height ? '4:3' : '3:4';
    const { w, h } = galleryFrameSize(320, ratio);
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
    const ratio = (sticker.height || 1) / (sticker.width || 1);
    const w = ratio > 1 ? Math.round(side / ratio) : side;
    const h = ratio > 1 ? side : Math.round(side * ratio);
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
    if (spec.type === 'note') return addNote(spec.color, at);
    if (spec.type === 'emoji') return addEmoji(spec.char, at);
    if (spec.type === 'todo') return addTodo(at);
    if (spec.type === 'gallery') return openGalleryPicker({ at });
    if (spec.type === 'places') return addPlaces(spec.mark, at);
    if (spec.type === 'sticker') return addSticker(spec.sticker, at);
    return null;
  };
  const dropSpec = (spec, clientX, clientY) => {
    const rect = stageRef.current?.getBoundingClientRect();
    if (!rect || clientX < rect.left || clientX > rect.right || clientY < rect.top) return;
    if (clientY > rect.bottom) return;
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
  const primarySelected = activeItems.find((it) => selectedIds.has(it.id));

  const changeStyle = (patch) => {
    const it = primarySelected;
    if (!it) return;
    const style = { ...(it.style || {}), ...patch };
    const next = { style };
    // A gallery keeps its photo ratio when its frame border changes.
    if (it.content?.type === 'gallery' && 'frameStyle' in patch) {
      const { w, h } = galleryFrameSize(it.frame.w, style.ratio || '4:3', style.frameStyle);
      next.frame = { ...it.frame, w, h };
    }
    applyPatches([{ id: it.id, patch: next }]);
  };
  const changeGalleryRatio = (ratio) => {
    const it = primarySelected;
    if (it?.content?.type !== 'gallery') return;
    const f = it.frame;
    const { w, h } = galleryFrameSize(f.w, ratio, it.style?.frameStyle);
    applyPatches([
      { id: it.id, patch: { style: { ...(it.style || {}), ratio }, frame: { ...f, w, h } } },
    ]);
  };
  const changeNoteColor = (color) => {
    if (primarySelected?.content?.type !== 'note') return;
    applyPatches([
      { id: primarySelected.id, patch: { style: { ...(primarySelected.style || {}), color } } },
    ]);
  };
  const bringToFront = () =>
    primarySelected && applyPatches([{ id: primarySelected.id, patch: { z: topZ(activeItems) } }]);
  const sendToBack = () =>
    primarySelected &&
    applyPatches([{ id: primarySelected.id, patch: { z: bottomZ(activeItems) } }]);
  const duplicate = async () => {
    if (!primarySelected) return;
    const f = primarySelected.frame || { x: 0, y: 0, w: 100, h: 100, scale: 1 };
    const item = await addItem(
      {
        content: { ...primarySelected.content },
        style: { ...(primarySelected.style || {}) },
        frame: { ...f, x: f.x + 20, y: f.y + 20 },
        z: topZ(activeItems),
      },
      { pop: true },
    );
    select([item.id]);
  };
  const toggleLock = () => {
    if (!primarySelected) return;
    const locked = Boolean(primarySelected.style?.locked ?? primarySelected.locked);
    applyPatches([
      {
        id: primarySelected.id,
        patch: { style: { ...(primarySelected.style || {}), locked: !locked } },
      },
    ]);
  };
  const deleteSelected = () => {
    removeItems(selectedIdsRef.current);
    select([]);
    sendPresence({ selected: [] });
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
  const draftPathRef = useRef(null);

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

  const handleStagePointerDown = (e) => {
    if (e.target.closest('.ui')) return;
    if (e.button !== 0 && e.button !== 1) return; // N-13: right click does nothing
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
        style: { size: 'body' },
        frame: { x: Math.round(pt.x), y: Math.round(pt.y - 16), w: 120, h: 32, scale: 1 },
        z: topZ(activeItemsRef.current),
      }).then((item) => {
        select([item.id]);
        setEditingId(item.id);
        sendPresence({ selected: [item.id], editing: item.id });
        setTool('select');
      });
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

  const itemPointerDown = (e, id) => {
    const item = itemsByIdRef.current.get(id);
    if (!item) return;
    if (tool === 'eraser') {
      if (e.button !== 0) return;
      e.stopPropagation();
      capture(e.pointerId);
      gestureRef.current = { type: 'erase', pointerId: e.pointerId, mask: 1, erased: new Set() };
      eraseAt(e.clientX, e.clientY, gestureRef.current);
      return;
    }
    if (e.button !== 0) return;
    e.stopPropagation();
    document.activeElement?.blur?.();

    let next;
    if (e.shiftKey) {
      next = new Set(selectedIdsRef.current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
    } else {
      next = selectedIdsRef.current.has(id) ? selectedIdsRef.current : new Set([id]);
    }
    select(next);
    sendPresence({ selected: [...next] });
    if (item.style?.locked) return;

    const ids = [...next].filter((x) => !itemsByIdRef.current.get(x)?.style?.locked);
    capture(e.pointerId, e.currentTarget);
    gestureRef.current = {
      type: 'drag',
      pointerId: e.pointerId,
      mask: 1,
      started: false,
      startClient: [e.clientX, e.clientY],
      startWorld: screenToWorld(e.clientX, e.clientY),
      frames0: new Map(
        ids.map((x) => [
          x,
          { ...(itemsByIdRef.current.get(x)?.frame || { x: 0, y: 0, w: 100, h: 100 }) },
        ]),
      ),
      raf: 0,
    };
  };

  const handlePointerDown = (e, id, anchor) => {
    const item = itemsByIdRef.current.get(id);
    e.stopPropagation();
    if (e.button !== 0 || !item || item.style?.locked) return;
    capture(e.pointerId, e.currentTarget);
    const f0 = { ...(item.frame || { x: 0, y: 0, w: 100, h: 100, scale: 1 }) };
    setGestureActive(true);
    setResizingId(id);
    if (anchor.startsWith('edge-')) {
      const edge = anchor.slice(5);
      gestureRef.current = {
        type: 'reshape',
        pointerId: e.pointerId,
        mask: 1,
        id,
        edge,
        axis: edge === 's' ? 'y' : 'x',
        kind: item.content?.kind,
        size: widgetSize(item),
        wk: widgetScale(item),
        frame0: f0,
        raf: 0,
      };
    } else {
      gestureRef.current = {
        type: 'resize',
        pointerId: e.pointerId,
        mask: 1,
        id,
        item,
        anchor,
        frame0: f0,
        bbox0: { w: f0.w, h: f0.h },
        raf: 0,
      };
    }
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
    } else if (g.type === 'drag') {
      if (!g.started) {
        const dx = e.clientX - g.startClient[0];
        const dy = e.clientY - g.startClient[1];
        if (Math.hypot(dx, dy) < DRAG_THRESHOLD) return;
        g.started = true;
        setGestureActive(true);
      }
      const cur = screenToWorld(e.clientX, e.clientY);
      const dx = cur.x - g.startWorld.x;
      const dy = cur.y - g.startWorld.y;
      const frames = {};
      for (const [id, f0] of g.frames0)
        frames[id] = { ...f0, x: Math.round(f0.x + dx), y: Math.round(f0.y + dy) };
      scheduleLive(g, { frames });
    } else if (g.type === 'resize') {
      const cur = screenToWorld(e.clientX, e.clientY);
      const { frame0: f0, bbox0, anchor } = g;
      let sx = 1;
      let sy = 1;
      if (anchor.includes('e')) sx = Math.max(0.1, (cur.x - f0.x) / (bbox0.w || 1));
      if (anchor.includes('w')) sx = Math.max(0.1, (f0.x + bbox0.w - cur.x) / (bbox0.w || 1));
      if (anchor.includes('s')) sy = Math.max(0.1, (cur.y - f0.y) / (bbox0.h || 1));
      if (anchor.includes('n')) sy = Math.max(0.1, (f0.y + bbox0.h - cur.y) / (bbox0.h || 1));
      scheduleLive(g, { frames: { [g.id]: scaled(g.item, f0, bbox0, sx, sy, anchor) } });
    } else if (g.type === 'reshape') {
      const cur = screenToWorld(e.clientX, e.clientY);
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
      const frame = { ...f0, w, h, x: g.edge === 'w' ? f0.x + f0.w - w : f0.x };
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
      const pts = simplify(g.points, 1.5);
      if (pts.length >= 2) {
        const xs = pts.map((p) => p[0]);
        const ys = pts.map((p) => p[1]);
        const minX = Math.min(...xs);
        const minY = Math.min(...ys);
        const w = Math.max(20, Math.max(...xs) - minX);
        const h = Math.max(20, Math.max(...ys) - minY);
        const isHl = g.look.tool === 'highlighter';
        // addItem updates local items synchronously before awaiting the
        // server, so the saved stroke replaces the draft in the same frame.
        addItem({
          content: {
            type: 'stroke',
            tool: g.look.tool,
            points: pts.map(([x, y]) => [
              Math.round((x - minX) * 10) / 10,
              Math.round((y - minY) * 10) / 10,
            ]),
          },
          style: { color: g.look.color, size: isHl ? 16 : g.look.size },
          frame: {
            x: Math.round(minX),
            y: Math.round(minY),
            w: Math.round(w),
            h: Math.round(h),
            scale: 1,
          },
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
    if ((g.type === 'drag' || g.type === 'resize' || g.type === 'reshape') && g.pending) {
      const changes = Object.entries(g.pending.frames).map(([id, frame]) => {
        const patch = { frame };
        if (g.type === 'reshape') {
          const it = itemsByIdRef.current.get(id);
          patch.style = { ...(it?.style || {}), size: g.pending.sizes[id] };
        }
        return { id, patch };
      });
      applyPatches(changes);
      setLocalLive(null); // batched with the local item update: no flash back
      sendPresence({ live: null, selected: [...selectedIdsRef.current] }, { immediate: true });
      return;
    }
    if (g.type === 'drag' || g.type === 'resize' || g.type === 'reshape') {
      setLocalLive(null);
    }
  };

  // Start the draft path at the first point as soon as it mounts.
  const setDraftPath = useCallback((el) => {
    draftPathRef.current = el;
    const g = gestureRef.current;
    if (el && g?.type === 'draw') el.setAttribute('d', pathD(g.points));
  }, []);

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
    const item = itemsByIdRef.current.get(id);
    if (!item || item.style?.locked) return;
    const type = item.content?.type;
    if (type === 'note' || type === 'text' || type === 'todo' || type === 'gallery') {
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
    if (!f || Math.abs(f.h - h) < 3 || gestureRef.current) return;
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
    }),
    [],
  );

  // ---------- Keyboard (N-3) ----------
  const modalOpenRef = useRef(modalOpen);
  modalOpenRef.current = modalOpen;
  const keyHandlers = useRef({});
  keyHandlers.current = { undo, redo, deleteSelected };
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
      if (mod || e.altKey) return;
      const k = e.key.toLowerCase();
      if (e.key === 'Backspace' || e.key === 'Delete') {
        if (selectedIdsRef.current.size) {
          e.preventDefault();
          keyHandlers.current.deleteSelected();
        }
      } else if (k === 'v') setTool('select');
      else if (k === 's') setPanelOpen((p) => !p);
      else if (k === 't') setTool('text');
      else if (k === 'p') setTool('pen');
      else if (k === 'h') setTool('highlighter');
      else if (k === 'e') setTool('eraser');
      else if (e.key === 'Escape') {
        setEditingId(null);
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

  // The bar stays mounted while a gesture runs and only fades, so starting or
  // ending a drag/scale no longer pops it in and out.
  const actionsHidden = gestureActive || Boolean(editingId) || Boolean(drawing);
  let actionsRect = null;
  if (primarySelected) {
    const f = frameOf(primarySelected) || { x: 0, y: 0, w: 100, h: 100 };
    const p = toScreen({ x: f.x, y: f.y }, view);
    actionsRect = { x: p.x, y: p.y, w: f.w * view.k, h: f.h * view.k };
  }

  const editingItem = editingId ? itemsById.get(editingId) : null;
  let formatRect = null;
  if (editingItem?.content?.type === 'note') {
    const f = frameOf(editingItem);
    const p = toScreen({ x: f.x, y: f.y }, view);
    formatRect = { x: p.x, y: p.y, w: f.w * view.k, h: f.h * view.k };
  }

  const mapDetail = view.k >= 0.4;
  const gridSize = (view.k < 0.4 ? 48 : 24) * view.k;
  const empty = !loading && activeItems.length === 0 && uploads.length === 0;
  const topSafe = narrow ? 84 : 76;

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
                return (
                  <BoardItem
                    key={item.id}
                    item={shown}
                    snapshot={snapshot}
                    selected={selectedIds.has(item.id)}
                    isEditing={editingId === item.id}
                    flash={flashId === item.id}
                    peerName={peer?.name || null}
                    peerColor={peer?.color || null}
                    peerEditing={Boolean(peer?.editing)}
                    resizing={resizingId === item.id}
                    reshape={size ? { size, box: localLive.boxes[item.id] } : null}
                    tripId={tripId}
                    {...itemCallbacks}
                  />
                );
              })}
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
                      <span>正在上传…</span>
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

            {drawing &&
              (() => {
                const s = strokeLook(drawing.tool, drawing.color, drawing.size);
                return (
                  <svg
                    id="draft"
                    className={drawing.tool === 'highlighter' ? 'highlighter' : ''}
                    aria-hidden="true"
                  >
                    <path
                      ref={setDraftPath}
                      stroke={s.stroke}
                      strokeWidth={s.width}
                      strokeOpacity={s.opacity}
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

      {primarySelected && actionsRect && (
        <BoardActions
          key={primarySelected.id}
          item={primarySelected}
          rect={actionsRect}
          stage={stageSize}
          topSafe={topSafe}
          hidden={actionsHidden}
          onChangeNoteColor={changeNoteColor}
          onChangeStyle={changeStyle}
          onGalleryRatio={changeGalleryRatio}
          onGalleryAdd={() => openGalleryPicker({ id: primarySelected.id })}
          onEdit={() => itemDoubleClick(primarySelected.id)}
          onBringToFront={bringToFront}
          onSendToBack={sendToBack}
          onDuplicate={duplicate}
          onToggleLock={toggleLock}
          onDelete={deleteSelected}
          onSchedulePlace={schedulePlace}
          onOpenTarget={openTarget}
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
          if (t !== 'select') select([]);
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
        onDropOnCanvas={dropSpec}
        onUploadImage={(file) => startUpload(file)}
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
