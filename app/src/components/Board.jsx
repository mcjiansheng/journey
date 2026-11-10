import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import './board.css';
import { useBoard } from '../board-sync.js';
import { BoardItem } from './BoardItem.jsx';
import { BoardToolbar } from './BoardToolbar.jsx';
import { BoardActions } from './BoardActions.jsx';
import { BoardStickerPanel } from './BoardStickerPanel.jsx';
import { BoardRecentDeletions } from './BoardRecentDeletions.jsx';
import {
  toWorld,
  toScreen,
  center,
  contentBounds,
  topZ,
  bottomZ,
  simplify,
  pathD,
  scaled,
} from '../board.js';
import { WIDGET_SIZES, widgetSize } from '../board-widgets.js';

const PEER_COLORS = ['#d9622b', '#7a5bd0', '#1f8fb3', '#c0397a'];

export function Board({
  tripId,
  boardId: initialBoardId,
  snapshot,
  currentUserId,
  mutate,
  onNavigate,
}) {
  // Ensure we have a valid boardId
  const boards = (snapshot?.objects || []).filter(
    (o) => o.kind === 'board' && o.state === 'active',
  );
  const activeBoard = boards.find((b) => b.id === initialBoardId) || boards[0];
  const boardId = activeBoard?.id || initialBoardId || 'default-board';

  // If no board exists in trip, create one
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

  // Client sync manager
  const {
    items,
    activeItems,
    deletedItems,
    loading,
    peerPresences,
    presenceOnline,
    addBoardItem,
    patchBoardItem,
    deleteBoardItem,
    restoreBoardItem,
    sendPresence,
    uploadAsset,
  } = useBoard(tripId, boardId, { mutate, currentUserId });

  // Viewport
  const stageRef = useRef(null);
  const [view, setView] = useState({ x: 0, y: 0, k: 1 });
  const viewRef = useRef(view);
  viewRef.current = view;
  const [stageSize, setStageSize] = useState({ w: 0, h: 0 });

  useEffect(() => {
    const el = stageRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return undefined;
    const update = () => setStageSize({ w: el.clientWidth, h: el.clientHeight });
    update();
    const observer = new ResizeObserver(update);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  // Tools & UI state
  const [tool, setTool] = useState('select');
  const [penColor, setPenColor] = useState('default');
  const [penSize, setPenSize] = useState(4);
  const [hlColor, setHlColor] = useState('yellow');
  const [panelOpen, setPanelOpen] = useState(false);
  const [deletionsOpen, setDeletionsOpen] = useState(false);

  // Selection & Editing
  const [selectedIds, setSelectedIds] = useState(new Set());
  const [editingId, setEditingId] = useState(null);
  const selectedIdsRef = useRef(selectedIds);
  selectedIdsRef.current = selectedIds;

  // Live remote drag positions
  const [remoteLive, setRemoteLive] = useState(new Map());

  // Undo / Redo
  const [undoStack, setUndoStack] = useState([]);
  const [redoStack, setRedoStack] = useState([]);

  // Interaction gesture refs
  const gestureRef = useRef(null);
  const [draftPoints, setDraftPoints] = useState([]);
  const [isResizing, setIsResizing] = useState(false);

  // Center the viewport on saved content once the board has loaded. Creating
  // the first item on an empty board must not move the viewport.
  const initializedViewRef = useRef(false);
  useEffect(() => {
    if (initializedViewRef.current || loading) return;
    initializedViewRef.current = true;
    if (activeItems.length === 0 || !stageRef.current) return;
    const rect = stageRef.current.getBoundingClientRect();
    const c = center(activeItems, { w: rect.width || 1200, h: rect.height || 800 });
    setView(c);
  }, [loading, activeItems]);

  // Aggregate remote presence
  useEffect(() => {
    const liveMap = new Map();
    for (const p of peerPresences.values()) {
      if (p.live && typeof p.live === 'object') {
        for (const [id, f] of Object.entries(p.live)) {
          // If we are locally dragging that item, ignore peer live
          if (!selectedIdsRef.current.has(id)) {
            liveMap.set(id, f);
          }
        }
      }
    }
    setRemoteLive(liveMap);
  }, [peerPresences]);

  // Coordinate helper
  const screenToWorld = useCallback((clientX, clientY) => {
    if (!stageRef.current) return { x: 0, y: 0 };
    const rect = stageRef.current.getBoundingClientRect();
    return toWorld({ x: clientX - rect.left, y: clientY - rect.top }, viewRef.current);
  }, []);

  // Center viewport on content
  const handleFitContent = useCallback(() => {
    if (!stageRef.current) return;
    const rect = stageRef.current.getBoundingClientRect();
    const c = center(activeItems, { w: rect.width, h: rect.height });
    setView(c);
  }, [activeItems]);

  // Deselect on click blank canvas
  // Eraser: removes whole strokes under the pointer. Only the topmost element is hit,
  // so strokes covered by a sticker cannot be erased (prototype `eraseAt`).
  const eraseAt = (clientX, clientY, gesture) => {
    const el = document.elementFromPoint(clientX, clientY);
    const id = el?.closest?.('.board-item')?.dataset?.itemId;
    if (!id || gesture.erased.has(id)) return;
    const target = activeItems.find((it) => it.id === id);
    if (target?.content?.type !== 'stroke' || target.locked) return;
    gesture.erased.add(id);
    deleteBoardItem(id);
  };

  const handleStagePointerDown = (e) => {
    if (e.target.closest('.board-item') || e.target.closest('.ui') || e.target.closest('.handle')) {
      return;
    }
    // Commit any in-progress contentEditable text before selection is cleared.
    document.activeElement?.blur?.();
    try {
      e.currentTarget.setPointerCapture?.(e.pointerId);
    } catch {}

    if (tool === 'eraser') {
      gestureRef.current = { type: 'erase', erased: new Set() };
      return;
    }

    // Drawing with pen / highlighter
    if (tool === 'pen' || tool === 'highlighter') {
      const pt = screenToWorld(e.clientX, e.clientY);
      gestureRef.current = {
        type: 'draw',
        tool,
        points: [[pt.x, pt.y]],
      };
      setDraftPoints([[pt.x, pt.y]]);
      return;
    }

    // Creating text with text tool
    if (tool === 'text') {
      const pt = screenToWorld(e.clientX, e.clientY);
      const z = topZ(activeItems);
      addBoardItem({
        content: { type: 'text', text: '新文本' },
        style: { size: 'body' },
        frame: { x: Math.round(pt.x), y: Math.round(pt.y), w: 160, h: 48, scale: 1 },
        z,
      }).then((newItem) => {
        setSelectedIds(new Set([newItem.id]));
        setEditingId(newItem.id);
        setTool('select');
      });
      return;
    }

    // Middle button, space, or select tool on empty space: pan canvas
    gestureRef.current = {
      type: 'pan',
      startX: e.clientX,
      startY: e.clientY,
      view0: { ...viewRef.current },
    };
    stageRef.current?.classList.add('panning');

    // Deselect items and clear editing
    setSelectedIds(new Set());
    setEditingId(null);
    sendPresence({ selected: [], editing: null }, { immediate: true });
  };

  const handlePointerMove = (e) => {
    const gesture = gestureRef.current;
    if (!gesture) return;

    if (gesture.type === 'pan') {
      const dx = e.clientX - gesture.startX;
      const dy = e.clientY - gesture.startY;
      setView({
        ...gesture.view0,
        x: gesture.view0.x + dx,
        y: gesture.view0.y + dy,
      });
    } else if (gesture.type === 'draw') {
      const pt = screenToWorld(e.clientX, e.clientY);
      gesture.points.push([pt.x, pt.y]);
      setDraftPoints([...gesture.points]);
    } else if (gesture.type === 'erase') {
      eraseAt(e.clientX, e.clientY, gesture);
    } else if (gesture.type === 'drag') {
      const curWorld = screenToWorld(e.clientX, e.clientY);
      const dx = curWorld.x - gesture.startWorld.x;
      const dy = curWorld.y - gesture.startWorld.y;

      const liveFrames = {};
      gesture.items.forEach((it) => {
        const f0 = gesture.frames.get(it.id);
        if (f0) {
          liveFrames[it.id] = {
            ...f0,
            x: Math.round(f0.x + dx),
            y: Math.round(f0.y + dy),
          };
        }
      });
      gesture.currentLive = liveFrames;
      sendPresence({ live: liveFrames });
      // Trigger rerender with temporary live positions
      setRemoteLive((prev) => new Map([...prev, ...Object.entries(liveFrames)]));
    } else if (gesture.type === 'resize') {
      const curWorld = screenToWorld(e.clientX, e.clientY);
      const f0 = gesture.frame0;
      const bbox0 = gesture.bbox0;
      let sx = 1,
        sy = 1;

      if (gesture.anchor.includes('e')) sx = Math.max(0.1, (curWorld.x - f0.x) / (bbox0.w || 1));
      if (gesture.anchor.includes('w'))
        sx = Math.max(0.1, (f0.x + bbox0.w - curWorld.x) / (bbox0.w || 1));
      if (gesture.anchor.includes('s')) sy = Math.max(0.1, (curWorld.y - f0.y) / (bbox0.h || 1));
      if (gesture.anchor.includes('n'))
        sy = Math.max(0.1, (f0.y + bbox0.h - curWorld.y) / (bbox0.h || 1));

      const nextF = scaled(gesture.item, f0, bbox0, sx, sy, gesture.anchor);
      gesture.currentLive = { [gesture.item.id]: nextF };
      sendPresence({ live: gesture.currentLive });
      setRemoteLive((prev) => new Map([...prev, [gesture.item.id, nextF]]));
    }
  };

  const handlePointerUp = async () => {
    const gesture = gestureRef.current;
    gestureRef.current = null;
    stageRef.current?.classList.remove('panning');
    setIsResizing(false);

    if (!gesture) return;

    if (gesture.type === 'draw') {
      const pts = simplify(gesture.points, 1.5);
      setDraftPoints([]);
      if (pts.length < 2) return;

      const xs = pts.map((p) => p[0]);
      const ys = pts.map((p) => p[1]);
      const minX = Math.min(...xs);
      const minY = Math.min(...ys);
      const maxX = Math.max(...xs);
      const maxY = Math.max(...ys);
      const w = Math.max(20, maxX - minX);
      const h = Math.max(20, maxY - minY);

      // Relative points within bounding box
      const relPts = pts.map(([x, y]) => [
        Math.round((x - minX) * 10) / 10,
        Math.round((y - minY) * 10) / 10,
      ]);

      const isHl = gesture.tool === 'highlighter';
      await addBoardItem({
        content: {
          type: 'stroke',
          tool: gesture.tool,
          points: relPts,
        },
        style: {
          color: isHl ? hlColor : penColor,
          size: isHl ? 16 : penSize,
        },
        frame: {
          x: Math.round(minX),
          y: Math.round(minY),
          w: Math.round(w),
          h: Math.round(h),
          scale: 1,
        },
        z: topZ(activeItems),
      });
    } else if (gesture.type === 'drag' && gesture.currentLive) {
      // Commit final position
      for (const [id, f] of Object.entries(gesture.currentLive)) {
        await patchBoardItem(id, { frame: f });
      }
      sendPresence({ live: null }, { immediate: true });
    } else if (gesture.type === 'resize' && gesture.currentLive) {
      for (const [id, f] of Object.entries(gesture.currentLive)) {
        await patchBoardItem(id, { frame: f });
      }
      sendPresence({ live: null }, { immediate: true });
    }
  };

  // Wheel zoom and pan
  const handleWheel = (e) => {
    e.preventDefault();
    if (e.ctrlKey || e.metaKey) {
      // Pinch to zoom
      const zoomFactor = Math.exp(-e.deltaY * 0.005);
      const rect = stageRef.current.getBoundingClientRect();
      const mouseX = e.clientX - rect.left;
      const mouseY = e.clientY - rect.top;
      const w = toWorld({ x: mouseX, y: mouseY }, viewRef.current);
      const nextK = Math.max(0.15, Math.min(3.0, viewRef.current.k * zoomFactor));
      setView({
        k: nextK,
        x: mouseX - w.x * nextK,
        y: mouseY - w.y * nextK,
      });
    } else {
      // Pan
      setView((v) => ({
        ...v,
        x: v.x - e.deltaX,
        y: v.y - e.deltaY,
      }));
    }
  };

  // Item interaction
  const handleItemPointerDown = (e, item) => {
    if (tool === 'eraser') {
      e.stopPropagation();
      try {
        stageRef.current?.setPointerCapture?.(e.pointerId);
      } catch {}
      gestureRef.current = { type: 'erase', erased: new Set() };
      eraseAt(e.clientX, e.clientY, gestureRef.current);
      return;
    }

    if (e.button !== 0) return;
    e.stopPropagation();

    const isSelected = selectedIdsRef.current.has(item.id);
    const newSelected = isSelected ? selectedIdsRef.current : new Set([item.id]);
    setSelectedIds(newSelected);
    sendPresence({ selected: Array.from(newSelected) });

    if (item.locked) return;

    // Start drag
    const startWorld = screenToWorld(e.clientX, e.clientY);
    const targetItems = activeItems.filter((it) => newSelected.has(it.id));
    const frames = new Map(
      targetItems.map((it) => [it.id, { ...(it.frame || { x: 0, y: 0, w: 100, h: 100 }) }]),
    );

    gestureRef.current = {
      type: 'drag',
      startWorld,
      items: targetItems,
      frames,
      currentLive: null,
    };
  };

  // 4-corner scale handle drag
  const handleHandlePointerDown = (e, item, anchor) => {
    e.stopPropagation();
    if (e.button !== 0 || item.locked) return;

    const startWorld = screenToWorld(e.clientX, e.clientY);
    const f0 = { ...(item.frame || { x: 0, y: 0, w: 100, h: 100, scale: 1 }) };
    const bbox0 = { w: f0.w, h: f0.h };

    setIsResizing(true);
    gestureRef.current = {
      type: 'resize',
      item,
      anchor,
      startWorld,
      frame0: f0,
      bbox0,
      currentLive: null,
    };
  };

  // Add Item Helpers
  const getCenterSpawnPoint = (w = 200, h = 200) => {
    if (!stageRef.current) return { x: 100, y: 100 };
    const rect = stageRef.current.getBoundingClientRect();
    const mid = toWorld({ x: rect.width / 2, y: rect.height / 2 }, viewRef.current);
    let x = Math.round(mid.x - w / 2);
    let y = Math.round(mid.y - h / 2);
    // Stagger new items when the center is already taken, as the prototype does.
    while (
      activeItems.some(
        (it) => Math.abs((it.frame?.x ?? 0) - x) < 12 && Math.abs((it.frame?.y ?? 0) - y) < 12,
      )
    ) {
      x += 24;
      y += 24;
    }
    return { x, y };
  };

  const handleAddWidget = async (content, size = 'M') => {
    const [w, h] = WIDGET_SIZES[size] || [352, 168];
    const pt = getCenterSpawnPoint(w, h);
    const z = topZ(activeItems);
    const newItem = await addBoardItem({
      content: { type: 'widget', ...content },
      style: { size },
      frame: { x: pt.x, y: pt.y, w, h, scale: 1 },
      z,
    });
    setSelectedIds(new Set([newItem.id]));
  };

  const handleAddNote = async (color = 'yellow') => {
    const w = 200,
      h = 200;
    const pt = getCenterSpawnPoint(w, h);
    const z = topZ(activeItems);
    const newItem = await addBoardItem({
      content: { type: 'note', text: '新便签' },
      style: { color },
      frame: { x: pt.x, y: pt.y, w, h, scale: 1 },
      z,
    });
    setSelectedIds(new Set([newItem.id]));
    setEditingId(newItem.id);
  };

  const handleAddEmoji = async (emoji) => {
    const w = 80,
      h = 80;
    const pt = getCenterSpawnPoint(w, h);
    const z = topZ(activeItems);
    const newItem = await addBoardItem({
      content: { type: 'emoji', char: emoji },
      style: {},
      frame: { x: pt.x, y: pt.y, w, h, scale: 1 },
      z,
    });
    setSelectedIds(new Set([newItem.id]));
  };

  const handleUploadImage = async (file) => {
    try {
      const res = await uploadAsset(file);
      const isGif = res.isGif;
      const maxW = 320;
      const aspect = (res.height || 300) / (res.width || 400);
      const w = Math.round(Math.min(maxW, res.width || maxW));
      const h = Math.round(w * aspect);
      const pt = getCenterSpawnPoint(w, h);
      const z = topZ(activeItems);

      const newItem = await addBoardItem({
        content: {
          type: 'image',
          assetId: res.assetId,
          mime: res.mime || 'image/png',
          width: res.width || 400,
          height: res.height || 300,
          animated: Boolean(isGif),
          caption: '',
        },
        style: { frameStyle: 'none' },
        frame: { x: pt.x, y: pt.y, w, h, scale: 1 },
        z,
      });
      setSelectedIds(new Set([newItem.id]));
    } catch (err) {
      alert(err.message || '图片上传失败');
    }
  };

  // Actions Bar operations
  const primarySelected = activeItems.find((it) => selectedIds.has(it.id));

  const handleChangeWidgetSize = async (newSize) => {
    if (!primarySelected || primarySelected.content?.type !== 'widget') return;
    const [w, h] = WIDGET_SIZES[newSize] || [168, 168];
    const prevF = primarySelected.frame || { x: 0, y: 0 };
    await patchBoardItem(primarySelected.id, {
      style: { size: newSize },
      frame: { ...prevF, w, h },
    });
  };

  const handleChangeNoteColor = async (color) => {
    if (!primarySelected || primarySelected.content?.type !== 'note') return;
    await patchBoardItem(primarySelected.id, { style: { color } });
  };

  const handleBringToFront = async () => {
    if (!primarySelected) return;
    const z = topZ(activeItems);
    await patchBoardItem(primarySelected.id, { z });
  };

  const handleSendToBack = async () => {
    if (!primarySelected) return;
    const z = bottomZ(activeItems);
    await patchBoardItem(primarySelected.id, { z });
  };

  const handleDuplicate = async () => {
    if (!primarySelected) return;
    const f = primarySelected.frame || { x: 0, y: 0, w: 100, h: 100, scale: 1 };
    const z = topZ(activeItems);
    const newItem = await addBoardItem({
      content: { ...primarySelected.content },
      style: { ...(primarySelected.style || {}) },
      frame: { ...f, x: f.x + 20, y: f.y + 20 },
      z,
    });
    setSelectedIds(new Set([newItem.id]));
  };

  const handleToggleLock = async () => {
    if (!primarySelected) return;
    const curLocked = Boolean(primarySelected.style?.locked ?? primarySelected.locked);
    await patchBoardItem(primarySelected.id, {
      style: { ...(primarySelected.style || {}), locked: !curLocked },
    });
  };

  const handleDeleteSelected = async () => {
    for (const id of selectedIds) {
      await deleteBoardItem(id);
    }
    setSelectedIds(new Set());
    sendPresence({ selected: [] });
  };

  const handleSchedulePlace = async (item) => {
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
      alert(err?.message || '加入行程失败，请稍后重试');
    }
  };

  const handleOpenTarget = (item) => {
    const kind = item.content?.kind;
    if (kind === 'activity') {
      onNavigate?.('itinerary', { activityId: item.content.activityId });
    } else if (kind === 'day' || kind === 'route') {
      onNavigate?.('itinerary', { dayId: item.content.dayId });
    } else if (kind === 'place') {
      onNavigate?.('map', { favoriteId: item.content.favoriteId });
    } else if (kind === 'expense') {
      onNavigate?.('ledger', {});
    }
  };

  // Keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e) => {
      if (editingId) return; // Typing in note or text
      if (e.key === 'Backspace' || e.key === 'Delete') {
        if (selectedIds.size > 0) {
          handleDeleteSelected();
        }
      } else if (e.key === 'v' || e.key === 'V') {
        setTool('select');
      } else if (e.key === 's' || e.key === 'S') {
        setPanelOpen((p) => !p);
      } else if (e.key === 't' || e.key === 'T') {
        setTool('text');
      } else if (e.key === 'p' || e.key === 'P') {
        setTool('pen');
      } else if (e.key === 'h' || e.key === 'H') {
        setTool('highlighter');
      } else if (e.key === 'e' || e.key === 'E') {
        setTool('eraser');
      } else if (e.key === 'Escape') {
        setSelectedIds(new Set());
        setPanelOpen(false);
        setDeletionsOpen(false);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [selectedIds, editingId]);

  // Only render items that intersect the viewport (200px margin), as the spec requires.
  const visibleItems = useMemo(() => {
    if (!stageSize.w || !stageSize.h) return activeItems;
    const margin = 200;
    const minX = -view.x / view.k - margin;
    const minY = -view.y / view.k - margin;
    const maxX = (stageSize.w - view.x) / view.k + margin;
    const maxY = (stageSize.h - view.y) / view.k + margin;
    return activeItems.filter((it) => {
      const f = it.frame || {};
      const w = f.w || 0;
      const h = f.h || 0;
      return f.x + w >= minX && f.x <= maxX && f.y + h >= minY && f.y <= maxY;
    });
  }, [activeItems, view, stageSize]);

  // Actions bar screen position
  let actionsScreenPos = null;
  if (primarySelected) {
    const f = remoteLive.get(primarySelected.id) ||
      primarySelected.frame || { x: 0, y: 0, w: 100, h: 100 };
    actionsScreenPos = toScreen({ x: f.x + f.w / 2, y: f.y }, view);
  }

  // Active peers list
  const peerList = Array.from(peerPresences.values());

  return (
    <div className="board-container">
      {/* Top Left Bar */}
      <div id="top-left" className="ui">
        <div className="chip glass">
          {snapshot?.trip?.destination || '旅程'} <small>· 白板</small>
        </div>
      </div>

      {/* Top Right Bar */}
      <div id="top-right" className="ui">
        <div id="peers">
          {peerList.map((p, i) => (
            <div
              key={p.deviceId || i}
              className={`avatar ${!presenceOnline ? 'offline' : ''}`}
              style={{ backgroundColor: PEER_COLORS[i % PEER_COLORS.length] }}
              title={p.displayName || '同伴'}
            >
              {(p.displayName || '同')[0]}
              <span className="dot" />
            </div>
          ))}
        </div>

        <button
          className="iconbtn glass"
          onClick={handleFitContent}
          title="适应全板"
          aria-label="适应全板"
        >
          <svg viewBox="0 0 24 24">
            <path d="M8 3H5a2 2 0 0 0-2 2v3m18 0V5a2 2 0 0 0-2-2h-3m0 18h3a2 2 0 0 0 2-2v-3M3 16v3a2 2 0 0 0 2 2h3" />
          </svg>
        </button>

        <button
          className="iconbtn glass"
          onClick={() => setDeletionsOpen(true)}
          title="最近删除"
          aria-label="最近删除"
        >
          <svg viewBox="0 0 24 24">
            <path d="M3 6h18M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
          </svg>
        </button>
      </div>

      {/* Stage Canvas */}
      <div
        id="stage"
        ref={stageRef}
        data-tool={tool}
        onPointerDown={handleStagePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onWheel={handleWheel}
      >
        <div
          id="world"
          style={{
            transform: `translate(${view.x}px, ${view.y}px) scale(${view.k})`,
          }}
        >
          <div id="items">
            {visibleItems.map((item) => {
              const liveF = remoteLive.get(item.id);
              const displayItem = liveF ? { ...item, frame: liveF } : item;

              // Peer selection
              let peerSel = null;
              for (const [key, p] of peerPresences.entries()) {
                if (p.selected && p.selected.includes(item.id)) {
                  peerSel = {
                    displayName: p.displayName || '同伴',
                    color: PEER_COLORS[p.colorIndex || 0],
                    isEditing: p.editing === item.id,
                  };
                  break;
                }
              }

              return (
                <BoardItem
                  key={item.id}
                  item={displayItem}
                  snapshot={snapshot}
                  selected={selectedIds.has(item.id)}
                  isEditing={editingId === item.id}
                  peerSelection={peerSel}
                  isResizing={isResizing && selectedIds.has(item.id)}
                  onPointerDown={handleItemPointerDown}
                  onTextChange={(id, text) =>
                    patchBoardItem(id, { content: { ...item.content, text } })
                  }
                  onStartEditing={(id) => {
                    setEditingId(id);
                    sendPresence({ editing: id });
                  }}
                  onEndEditing={() => {
                    setEditingId(null);
                    sendPresence({ editing: null });
                  }}
                  onHandlePointerDown={handleHandlePointerDown}
                />
              );
            })}
          </div>

          {/* In-progress drawing path */}
          {draftPoints.length > 1 && (
            <svg id="draft">
              <path
                d={pathD(draftPoints)}
                stroke={tool === 'highlighter' ? 'rgba(254, 240, 138, 0.65)' : 'var(--text)'}
                strokeWidth={tool === 'highlighter' ? 18 : penSize}
                fill="none"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          )}
        </div>
      </div>

      {/* Contextual Actions Bar above selection */}
      {primarySelected && actionsScreenPos && (
        <BoardActions
          item={primarySelected}
          pos={actionsScreenPos}
          onChangeWidgetSize={handleChangeWidgetSize}
          onChangeNoteColor={handleChangeNoteColor}
          onBringToFront={handleBringToFront}
          onSendToBack={handleSendToBack}
          onDuplicate={handleDuplicate}
          onToggleLock={handleToggleLock}
          onDelete={handleDeleteSelected}
          onSchedulePlace={handleSchedulePlace}
          onOpenTarget={handleOpenTarget}
        />
      )}

      {/* Bottom Toolbar & Options */}
      <BoardToolbar
        activeTool={tool}
        onSelectTool={(t) => {
          setTool(t);
          if (t !== 'select') setSelectedIds(new Set());
        }}
        penColor={penColor}
        penSize={penSize}
        onChangePenColor={setPenColor}
        onChangePenSize={setPenSize}
        hlColor={hlColor}
        onChangeHlColor={setHlColor}
        panelOpen={panelOpen}
        onTogglePanel={() => setPanelOpen((p) => !p)}
      />

      {/* Sticker Drawer */}
      <BoardStickerPanel
        snapshot={snapshot}
        open={panelOpen}
        onClose={() => setPanelOpen(false)}
        onAddWidget={handleAddWidget}
        onAddNote={handleAddNote}
        onAddEmoji={handleAddEmoji}
        onUploadImage={handleUploadImage}
      />

      {/* Recent Deletions Drawer */}
      <BoardRecentDeletions
        open={deletionsOpen}
        onClose={() => setDeletionsOpen(false)}
        deletedItems={deletedItems}
        onRestore={(id) => restoreBoardItem(id)}
      />
    </div>
  );
}
