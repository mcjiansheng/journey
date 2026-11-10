import { useState, useEffect, useRef, useCallback } from 'react';
import { openDB } from 'idb';
import { api, onPresence, onTripChange, getDeviceId } from './sync.js';
import { WIDGET_SIZES } from './board-widgets.js';

let databasePromise = null;
function getDb() {
  return (databasePromise ||= openDB('journey-v1', 1, {
    upgrade(d) {
      if (!d.objectStoreNames.contains('kv')) {
        d.createObjectStore('kv');
      }
    },
  }));
}

export function normalizeBoardItem(item) {
  if (!item) return item;
  const p = item.payload || {};
  const style = p.style ?? item.style ?? {};
  const locked = Boolean(style.locked ?? item.locked);
  return {
    ...item,
    boardId: p.boardId ?? item.boardId,
    frame: p.frame ?? item.frame ?? { x: 0, y: 0, w: 100, h: 100, rotation: 0, scale: 1 },
    z: p.z ?? item.z ?? 0,
    content: p.content ?? item.content ?? {},
    style,
    locked,
    linkedActivityId:
      p.linkedActivityId !== undefined ? p.linkedActivityId : (item.linkedActivityId ?? null),
    createdBy: p.createdBy ?? item.createdBy,
  };
}

const ALLOWED_PATCH_KEYS = ['frame', 'z', 'content', 'style', 'linkedActivityId'];

export function cleanBoardItemPatch(rawPatch) {
  if (!rawPatch || typeof rawPatch !== 'object') return {};
  const cleaned = {};
  const source = rawPatch.payload ? { ...rawPatch.payload, ...rawPatch } : rawPatch;

  let stylePatch = source.style ? { ...source.style } : undefined;
  if ('locked' in source) {
    stylePatch = { ...(stylePatch || {}), locked: Boolean(source.locked) };
  }
  if (stylePatch !== undefined) {
    const validStyle = {};
    if (stylePatch.color !== undefined) validStyle.color = stylePatch.color;
    if (stylePatch.size !== undefined) validStyle.size = stylePatch.size;
    if (stylePatch.frameStyle !== undefined) validStyle.frameStyle = stylePatch.frameStyle;
    if (stylePatch.locked !== undefined) validStyle.locked = Boolean(stylePatch.locked);
    cleaned.style = validStyle;
  }

  for (const k of ALLOWED_PATCH_KEYS) {
    if (k === 'style') continue;
    if (k in source && source[k] !== undefined) {
      cleaned[k] = source[k];
    }
  }

  if (cleaned.frame) {
    cleaned.frame = {
      x: cleaned.frame.x,
      y: cleaned.frame.y,
      w: cleaned.frame.w,
      h: cleaned.frame.h,
      rotation: cleaned.frame.rotation ?? 0,
      scale: cleaned.frame.scale ?? 1,
    };
  }
  return cleaned;
}

export async function readBoardCache(tripId, boardId) {
  try {
    const db = await getDb();
    const key = `board:${tripId}:${boardId}`;
    const cached = await db.get('kv', key);
    if (cached && Array.isArray(cached.items)) {
      return {
        ...cached,
        items: cached.items.map(normalizeBoardItem),
      };
    }
    return cached || null;
  } catch {
    return null;
  }
}

export async function writeBoardCache(tripId, boardId, data) {
  try {
    const db = await getDb();
    const key = `board:${tripId}:${boardId}`;
    await db.put('kv', data, key);
  } catch {
    /* Ignore IDB quota or storage failure in background */
  }
}

export async function processImageFile(file) {
  const isGif = file.type === 'image/gif' || file.name?.toLowerCase().endsWith('.gif');
  if (isGif) {
    if (file.size > 5 * 1024 * 1024) {
      throw new Error('GIF 图片不能超过 5MB');
    }
  } else {
    if (file.size > 20 * 1024 * 1024) {
      throw new Error('图片文件过大');
    }
  }

  // In browser, create image element and extract dimensions & thumbnails
  if (typeof window === 'undefined' || typeof document === 'undefined') {
    return {
      fullBlob: file,
      thumbBlob: file,
      width: 400,
      height: 300,
      isGif,
      mime: file.type || (isGif ? 'image/gif' : 'image/jpeg'),
    };
  }

  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise((resolve, reject) => {
      const el = new Image();
      el.onload = () => resolve(el);
      el.onerror = () => reject(new Error('图片解析失败'));
      el.src = url;
    });

    const origW = img.naturalWidth || img.width || 400;
    const origH = img.naturalHeight || img.height || 300;

    // Thumbnail: max 400px
    const thumbScale = Math.min(1, 400 / Math.max(origW, origH));
    const thumbW = Math.max(1, Math.round(origW * thumbScale));
    const thumbH = Math.max(1, Math.round(origH * thumbScale));
    const canvasThumb = document.createElement('canvas');
    canvasThumb.width = thumbW;
    canvasThumb.height = thumbH;
    const ctxThumb = canvasThumb.getContext('2d');
    ctxThumb.drawImage(img, 0, 0, thumbW, thumbH);
    const thumbBlob = await new Promise((r) => canvasThumb.toBlob(r, 'image/webp', 0.8));

    if (isGif) {
      return {
        fullBlob: file,
        thumbBlob: thumbBlob || file,
        width: origW,
        height: origH,
        isGif: true,
        mime: 'image/gif',
      };
    }

    // Static image: clamp to max 2048px
    const fullScale = Math.min(1, 2048 / Math.max(origW, origH));
    const fullW = Math.max(1, Math.round(origW * fullScale));
    const fullH = Math.max(1, Math.round(origH * fullScale));
    const canvasFull = document.createElement('canvas');
    canvasFull.width = fullW;
    canvasFull.height = fullH;
    const ctxFull = canvasFull.getContext('2d');
    ctxFull.drawImage(img, 0, 0, fullW, fullH);
    const fullBlob = await new Promise((r) => canvasFull.toBlob(r, 'image/jpeg', 0.88));

    if (fullBlob && fullBlob.size > 1.5 * 1024 * 1024) {
      // Re-compress if over 1.5MB
      const compressed = await new Promise((r) => canvasFull.toBlob(r, 'image/jpeg', 0.7));
      return {
        fullBlob: compressed || fullBlob,
        thumbBlob: thumbBlob || file,
        width: origW,
        height: origH,
        isGif: false,
        mime: 'image/jpeg',
      };
    }

    return {
      fullBlob: fullBlob || file,
      thumbBlob: thumbBlob || file,
      width: origW,
      height: origH,
      isGif: false,
      mime: 'image/jpeg',
    };
  } finally {
    URL.revokeObjectURL(url);
  }
}

export async function uploadAsset(tripId, file) {
  const processed = await processImageFile(file);
  const assetId = crypto.randomUUID();

  // Upload full variant
  await api(`/api/trips/${tripId}/assets/${assetId}?variant=full`, {
    method: 'PUT',
    raw: true,
    headers: { 'Content-Type': processed.mime },
    body: processed.fullBlob,
  });

  // Upload thumb variant
  await api(`/api/trips/${tripId}/assets/${assetId}?variant=thumb`, {
    method: 'PUT',
    raw: true,
    headers: { 'Content-Type': 'image/webp' },
    body: processed.thumbBlob,
  });

  return {
    assetId,
    width: processed.width,
    height: processed.height,
    isGif: processed.isGif,
    mime: processed.mime,
  };
}

export function useBoard(tripId, boardId, { mutate, currentUserId } = {}) {
  const [items, setItems] = useState([]);
  const [cursor, setCursor] = useState(0);
  const [epoch, setEpoch] = useState(null);
  const [loading, setLoading] = useState(true);
  const [peerPresences, setPeerPresences] = useState(new Map());
  const [presenceOnline, setPresenceOnline] = useState(true);

  const itemsRef = useRef(items);
  itemsRef.current = items;
  const cursorRef = useRef(cursor);
  cursorRef.current = cursor;
  const epochRef = useRef(epoch);
  epochRef.current = epoch;

  const presenceTimerRef = useRef(null);
  const lastPresenceSendRef = useRef(0);
  const consecutivePresenceErrorsRef = useRef(0);
  const pendingPresenceRef = useRef(null);

  // Load from IndexedDB and server
  const loadData = useCallback(async () => {
    if (!tripId || !boardId) return;
    try {
      const cached = await readBoardCache(tripId, boardId);
      if (cached && Array.isArray(cached.items)) {
        const normCached = cached.items.map(normalizeBoardItem);
        setItems(normCached);
        setCursor(cached.cursor || 0);
        setEpoch(cached.epoch || null);
        itemsRef.current = normCached;
        cursorRef.current = cached.cursor || 0;
        epochRef.current = cached.epoch || null;
      }

      const since = cached?.cursor ? `?since=${cached.cursor}` : '';
      const res = await api(`/api/trips/${tripId}/boards/${boardId}/items${since}`);

      if (res) {
        const map = new Map((cached?.items || []).map((it) => [it.id, normalizeBoardItem(it)]));
        for (const item of res.items || []) {
          map.set(item.id, normalizeBoardItem(item));
        }
        const merged = Array.from(map.values());

        setItems(merged);
        setCursor(res.cursor || 0);
        setEpoch(res.epoch || 0);
        itemsRef.current = merged;
        cursorRef.current = res.cursor || 0;
        epochRef.current = res.epoch || 0;

        await writeBoardCache(tripId, boardId, {
          cursor: res.cursor || 0,
          epoch: res.epoch || 0,
          items: merged,
        });
      }
    } catch {
      /* If offline, cached items remain available */
    } finally {
      setLoading(false);
    }
  }, [tripId, boardId]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  // Listen to trip change notifications from SSE
  useEffect(() => {
    const unsub = onTripChange(async () => {
      if (!tripId || !boardId) return;
      try {
        const since = cursorRef.current ? `?since=${cursorRef.current}` : '';
        const res = await api(`/api/trips/${tripId}/boards/${boardId}/items${since}`);
        if (!res) return;

        let merged;
        if (epochRef.current && res.epoch === epochRef.current && since) {
          const map = new Map(itemsRef.current.map((it) => [it.id, normalizeBoardItem(it)]));
          for (const item of res.items || []) {
            map.set(item.id, normalizeBoardItem(item));
          }
          merged = Array.from(map.values());
        } else {
          merged = (res.items || []).map(normalizeBoardItem);
        }

        setItems(merged);
        setCursor(res.cursor || 0);
        setEpoch(res.epoch || 0);
        itemsRef.current = merged;
        cursorRef.current = res.cursor || 0;
        epochRef.current = res.epoch || 0;

        await writeBoardCache(tripId, boardId, {
          cursor: res.cursor || 0,
          epoch: res.epoch || 0,
          items: merged,
        });
      } catch {
        /* Ignore transient SSE refresh errors */
      }
    });
    return unsub;
  }, [tripId, boardId]);

  // Listen to presence events from SSE
  useEffect(() => {
    const unsub = onPresence((data) => {
      if (data.boardId && data.boardId !== boardId) return;
      const key = `${data.userId}:${data.deviceId}`;
      setPeerPresences((prev) => {
        const next = new Map(prev);
        if (data.leave) {
          next.delete(key);
        } else {
          next.set(key, { ...data, at: data.at || Date.now() });
        }
        return next;
      });
    });

    // Clean up stale presences every 5 seconds
    const interval = setInterval(() => {
      const now = Date.now();
      setPeerPresences((prev) => {
        let changed = false;
        const next = new Map(prev);
        for (const [k, p] of next.entries()) {
          if (now - (p.at || 0) > 15000) {
            next.delete(k);
            changed = true;
          }
        }
        return changed ? next : prev;
      });
    }, 5000);

    return () => {
      unsub();
      clearInterval(interval);
    };
  }, [boardId]);

  // Upstream presence
  const sendPresence = useCallback(
    async (payload, { immediate = false } = {}) => {
      if (!tripId || !boardId) return;
      const devId = getDeviceId?.() || 'unknown-device';
      const body = {
        deviceId: devId,
        selected: (payload.selected || []).slice(0, 20),
        editing: payload.editing ?? null,
        live: payload.live ?? null,
        ...(payload.leave ? { leave: true } : {}),
      };

      pendingPresenceRef.current = body;
      const now = Date.now();
      const elapsed = now - lastPresenceSendRef.current;

      const doSend = async () => {
        if (!pendingPresenceRef.current) return;
        const toSend = pendingPresenceRef.current;
        pendingPresenceRef.current = null;
        lastPresenceSendRef.current = Date.now();
        try {
          await api(`/api/trips/${tripId}/boards/${boardId}/presence`, {
            method: 'POST',
            body: toSend,
          });
          consecutivePresenceErrorsRef.current = 0;
          setPresenceOnline(true);
        } catch (e) {
          if (e.code === 'PRESENCE_RATE') return;
          consecutivePresenceErrorsRef.current++;
          if (consecutivePresenceErrorsRef.current >= 3) {
            setPresenceOnline(false);
          }
        }
      };

      if (immediate || elapsed >= 60) {
        clearTimeout(presenceTimerRef.current);
        await doSend();
      } else {
        clearTimeout(presenceTimerRef.current);
        presenceTimerRef.current = setTimeout(doSend, 60 - elapsed);
      }
    },
    [tripId, boardId],
  );

  // Heartbeat presence every 5 seconds
  useEffect(() => {
    const heartbeat = setInterval(() => {
      if (document.visibilityState === 'visible' && !loading) {
        sendPresence({}, { immediate: true });
      }
    }, 5000);
    return () => clearInterval(heartbeat);
  }, [sendPresence, loading]);

  // Leave presence on unmount
  useEffect(() => {
    return () => {
      sendPresence({ leave: true }, { immediate: true });
    };
  }, [sendPresence]);

  // Operations
  const addBoardItem = useCallback(
    async (itemData) => {
      const now = Date.now();
      const id = itemData.id || crypto.randomUUID();
      const newItem = normalizeBoardItem({
        id,
        tripId,
        boardId,
        createdBy: currentUserId,
        createdAt: now,
        updatedAt: now,
        state: 'active',
        generation: 0,
        ...itemData,
      });

      setItems((prev) => {
        const next = [...prev, newItem];
        writeBoardCache(tripId, boardId, {
          cursor: cursorRef.current,
          epoch: epochRef.current,
          items: next,
        });
        return next;
      });

      if (mutate) {
        await mutate({
          kind: 'create',
          objectType: 'boardItem',
          objectId: id,
          patch: {
            boardId,
            content: newItem.content,
            style: newItem.style || {},
            frame: newItem.frame,
            z: newItem.z || 0,
            linkedActivityId: newItem.linkedActivityId || null,
          },
        });
      }
      return newItem;
    },
    [tripId, boardId, currentUserId, mutate],
  );

  const patchBoardItem = useCallback(
    async (itemId, patch) => {
      const now = Date.now();
      const target = itemsRef.current.find((it) => it.id === itemId);
      const styleWithLock =
        patch.style || patch.locked !== undefined
          ? {
              ...(target?.style || {}),
              ...(patch.style || {}),
              ...(patch.locked !== undefined ? { locked: Boolean(patch.locked) } : {}),
            }
          : undefined;
      const patchToClean = {
        ...patch,
        ...(styleWithLock ? { style: styleWithLock } : {}),
      };
      const cleaned = cleanBoardItemPatch(patchToClean);
      let updatedItem = null;
      setItems((prev) => {
        const next = prev.map((it) => {
          if (it.id === itemId) {
            updatedItem = normalizeBoardItem({
              ...it,
              ...cleaned,
              content: cleaned.content ? { ...(it.content || {}), ...cleaned.content } : it.content,
              style: cleaned.style ? { ...(it.style || {}), ...cleaned.style } : it.style,
              frame: cleaned.frame ? { ...(it.frame || {}), ...cleaned.frame } : it.frame,
              updatedAt: now,
              generation: (it.generation || 0) + 1,
            });
            return updatedItem;
          }
          return it;
        });
        writeBoardCache(tripId, boardId, {
          cursor: cursorRef.current,
          epoch: epochRef.current,
          items: next,
        });
        return next;
      });

      if (mutate && updatedItem) {
        await mutate({
          kind: 'patch',
          objectType: 'boardItem',
          objectId: itemId,
          patch: cleaned,
        });
      }
      return updatedItem;
    },
    [tripId, boardId, mutate],
  );

  const deleteBoardItem = useCallback(
    async (itemId) => {
      const target = itemsRef.current.find((it) => it.id === itemId);
      setItems((prev) => {
        const next = prev.map((it) =>
          it.id === itemId
            ? {
                ...it,
                state: 'deleted',
                generation: (it.generation || 0) + 1,
                updatedAt: Date.now(),
              }
            : it,
        );
        writeBoardCache(tripId, boardId, {
          cursor: cursorRef.current,
          epoch: epochRef.current,
          items: next,
        });
        return next;
      });

      if (mutate && target) {
        await mutate({
          kind: 'delete',
          objectType: 'boardItem',
          objectId: itemId,
          generation: target.generation || 0,
        });
      }
    },
    [tripId, boardId, mutate],
  );

  const restoreBoardItem = useCallback(
    async (itemId) => {
      const target = itemsRef.current.find((it) => it.id === itemId);
      setItems((prev) => {
        const next = prev.map((it) =>
          it.id === itemId
            ? {
                ...it,
                state: 'active',
                generation: (it.generation || 0) + 1,
                updatedAt: Date.now(),
              }
            : it,
        );
        writeBoardCache(tripId, boardId, {
          cursor: cursorRef.current,
          epoch: epochRef.current,
          items: next,
        });
        return next;
      });

      if (mutate && target) {
        await mutate({
          kind: 'restore',
          objectType: 'boardItem',
          objectId: itemId,
          generation: target.generation || 0,
        });
      }
    },
    [tripId, boardId, mutate],
  );

  const activeItems = items.filter((it) => it.state !== 'deleted');
  const deletedItems = items
    .filter((it) => it.state === 'deleted')
    .sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));

  return {
    items,
    activeItems,
    deletedItems,
    loading,
    cursor,
    peerPresences,
    presenceOnline,
    addBoardItem,
    patchBoardItem,
    deleteBoardItem,
    restoreBoardItem,
    sendPresence,
    uploadAsset: (file) => uploadAsset(tripId, file),
    reload: loadData,
  };
}

export async function pinWidgetToBoard(journey, content, size = 'M') {
  const [w, h] = WIDGET_SIZES[size] || [352, 168];
  const boards = (journey.snapshot?.objects || []).filter(
    (x) => x.kind === 'board' && x.state === 'active',
  );
  let boardId = boards[0]?.id || 'default-board';
  const itemId = crypto.randomUUID();
  const now = Date.now();
  const newItem = normalizeBoardItem({
    id: itemId,
    tripId: journey.snapshot.trip.id,
    boardId,
    content: { type: 'widget', ...content },
    style: { size },
    frame: { x: 200, y: 150, w, h, scale: 1 },
    z: 1,
    state: 'active',
    generation: 0,
    createdAt: now,
    updatedAt: now,
  });

  const cached = (await readBoardCache(journey.snapshot.trip.id, boardId)) || {
    cursor: 0,
    epoch: 0,
    items: [],
  };
  await writeBoardCache(journey.snapshot.trip.id, boardId, {
    ...cached,
    items: [...(cached.items || []), newItem],
  });

  await journey.mutate({
    kind: 'create',
    objectType: 'boardItem',
    objectId: itemId,
    patch: {
      boardId,
      content: { type: 'widget', ...content },
      style: { size },
      frame: { x: 200, y: 150, w, h, scale: 1 },
      z: 1,
    },
  });
  journey.notify?.({ message: '已贴到白板' });
  journey.setContext({ page: 'board', board: { boardId } });
}
