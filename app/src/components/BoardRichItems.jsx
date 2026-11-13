import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { assetUrl, GALLERY_PADDING } from '../board.js';

const stop = (e) => e.stopPropagation();
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

/** Geometry of one gallery image inside a w×h window: cover, then crop zoom/offset. */
export function galleryImageBox(img, w, h) {
  const iw = img.width || 1;
  const ih = img.height || 1;
  const crop = img.crop || { x: 0, y: 0, zoom: 1 };
  const s = Math.max(w / iw, h / ih) * (crop.zoom || 1);
  const dw = iw * s;
  const dh = ih * s;
  return {
    width: dw,
    height: dh,
    left: (w - dw) / 2 - ((crop.x || 0) * (dw - w)) / 2,
    top: (h - dh) / 2 - ((crop.y || 0) * (dh - h)) / 2,
  };
}

/**
 * 图库: several photos in one frame. Arrows, dots, ← → keys and a sideways
 * trackpad swipe change the photo; double-click to adjust how each photo fills
 * the frame (drag to move, wheel or −/+ to zoom).
 */
export function GalleryView({ item, tripId, isEditing, selected, onChange, onAddImages, onDone }) {
  const images = item.content?.images || [];
  // The photo window is the frame minus the decorative border of its style.
  const frame = item.frame || { w: 300, h: 300 };
  const [pt, pr, pb, pl] = GALLERY_PADDING[item.style?.frameStyle] || GALLERY_PADDING.none;
  const f = { w: Math.max(1, frame.w - pl - pr), h: Math.max(1, frame.h - pt - pb) };
  const [index, setIndex] = useState(0);
  const [draft, setDraft] = useState(null); // crop being dragged
  const rootRef = useRef(null);
  const count = images.length;
  const i = count ? ((index % count) + count) % count : 0;
  const current = images[i];
  const crop = draft || current?.crop || { x: 0, y: 0, zoom: 1 };

  useEffect(() => {
    if (index >= count && count) setIndex(count - 1);
  }, [count, index]);

  // Sideways trackpad scroll over the gallery flips photos instead of panning.
  useEffect(() => {
    const el = rootRef.current;
    if (!el) return undefined;
    let acc = 0;
    let last = 0;
    const onWheel = (e) => {
      if (isEditing) {
        e.preventDefault();
        e.stopPropagation();
        commitCrop({ ...crop, zoom: clamp((crop.zoom || 1) * Math.exp(-e.deltaY * 0.004), 1, 4) });
        return;
      }
      if (Math.abs(e.deltaX) <= Math.abs(e.deltaY) || count < 2 || e.ctrlKey) return;
      e.preventDefault();
      e.stopPropagation();
      acc += e.deltaX;
      const now = Date.now();
      if (Math.abs(acc) > 60 && now - last > 350) {
        // Snapshot the direction: the setState updater may run later, after
        // `acc` has been reset (that made every swipe go backwards).
        const dir = acc > 0 ? 1 : -1;
        setIndex((v) => (v + dir + count) % count);
        acc = 0;
        last = now;
      }
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  });

  useEffect(() => {
    if (!selected && !isEditing) return undefined;
    const onKey = (e) => {
      if (e.target.closest?.('input, textarea, [contenteditable="true"]')) return;
      if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
        e.preventDefault();
        const dir = e.key === 'ArrowRight' ? 1 : -1;
        setIndex((v) => (v + dir + count) % count);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [selected, isEditing]);

  const commitCrop = (next) => {
    if (!current) return;
    const nextImages = images.map((img, k) =>
      k === i
        ? {
            ...img,
            crop: {
              x: +clamp(next.x, -1, 1).toFixed(3),
              y: +clamp(next.y, -1, 1).toFixed(3),
              zoom: +clamp(next.zoom, 1, 4).toFixed(3),
            },
          }
        : img,
    );
    onChange?.({ ...item.content, images: nextImages });
  };

  const onPanDown = (e) => {
    if (!isEditing || !current || e.button !== 0) return;
    e.stopPropagation();
    const target = e.currentTarget;
    target.setPointerCapture(e.pointerId);
    const box = galleryImageBox({ ...current, crop }, f.w, f.h);
    const start = {
      x: e.clientX,
      y: e.clientY,
      crop,
      rangeX: box.width - f.w,
      rangeY: box.height - f.h,
    };
    const k = rootRef.current?.getBoundingClientRect().width / f.w || 1;
    let latest = crop;
    const move = (ev) => {
      const dx = (ev.clientX - start.x) / k;
      const dy = (ev.clientY - start.y) / k;
      latest = {
        ...start.crop,
        x: start.rangeX > 0 ? clamp(start.crop.x - (2 * dx) / start.rangeX, -1, 1) : 0,
        y: start.rangeY > 0 ? clamp(start.crop.y - (2 * dy) / start.rangeY, -1, 1) : 0,
      };
      setDraft(latest);
    };
    const up = () => {
      target.removeEventListener('pointermove', move);
      target.removeEventListener('pointerup', up);
      target.removeEventListener('pointercancel', up);
      setDraft(null);
      commitCrop(latest);
    };
    target.addEventListener('pointermove', move);
    target.addEventListener('pointerup', up);
    target.addEventListener('pointercancel', up);
  };

  const removeCurrent = () => {
    if (!current) return;
    onChange?.({ ...item.content, images: images.filter((_, k) => k !== i) });
  };

  const box = current ? galleryImageBox({ ...current, crop }, f.w, f.h) : null;
  return (
    <div
      ref={rootRef}
      className={`gallery-view ${isEditing ? 'is-editing' : ''}`}
      aria-label={`图库，第 ${i + 1} 张，共 ${count} 张`}
    >
      <div className="gallery-window" onPointerDown={onPanDown}>
        {current ? (
          <img
            key={current.assetId}
            src={assetUrl(tripId, current.assetId)}
            alt=""
            draggable={false}
            style={{ width: box.width, height: box.height, left: box.left, top: box.top }}
          />
        ) : (
          <button className="gallery-empty" onPointerDown={stop} onClick={onAddImages}>
            ＋ 添加图片
          </button>
        )}
      </div>
      {count > 1 && (
        <>
          <button
            className="gallery-nav prev"
            aria-label="上一张"
            onPointerDown={stop}
            onClick={() => setIndex((i - 1 + count) % count)}
          >
            ‹
          </button>
          <button
            className="gallery-nav next"
            aria-label="下一张"
            onPointerDown={stop}
            onClick={() => setIndex((i + 1) % count)}
          >
            ›
          </button>
          <div className="gallery-dots" onPointerDown={stop}>
            {images.map((img, k) => (
              <button
                key={img.assetId + k}
                aria-label={`第 ${k + 1} 张`}
                aria-current={k === i}
                onClick={() => setIndex(k)}
              />
            ))}
          </div>
        </>
      )}
      {isEditing && (
        <div className="gallery-tools" onPointerDown={stop}>
          <button
            className="sym"
            onClick={() => commitCrop({ ...crop, zoom: crop.zoom / 1.2 })}
            aria-label="缩小"
            title="缩小"
          >
            −
          </button>
          <span className="zoom-pct" aria-live="polite">
            {Math.round((crop.zoom || 1) * 100)}%
          </span>
          <button
            className="sym"
            onClick={() => commitCrop({ ...crop, zoom: crop.zoom * 1.2 })}
            aria-label="放大"
            title="放大"
          >
            ＋
          </button>
          <button onClick={() => commitCrop({ x: 0, y: 0, zoom: 1 })}>重置</button>
          <span className="sep" aria-hidden="true" />
          <button onClick={onAddImages}>添加图片</button>
          {current && (
            <button className="danger" onClick={removeCurrent}>
              移除这张
            </button>
          )}
          <button className="primary" onClick={onDone}>
            完成
          </button>
        </div>
      )}
      {isEditing && current && <div className="gallery-hint">拖动调整位置，滚轮缩放</div>}
    </div>
  );
}

/** 待办: a shared checklist. Ticking works without selecting; double-click to edit. */
export function TodoView({ item, isEditing, onChange, onAutoHeight, onDone }) {
  const content = item.content || {};
  const items = content.items || [];
  const rootRef = useRef(null);
  const [title, setTitle] = useState(content.title || '');
  const [newText, setNewText] = useState('');
  const [dragging, setDragging] = useState(null); // { from, to }
  const newRef = useRef(null);

  useEffect(() => setTitle(content.title || ''), [content.title]);
  useEffect(() => {
    if (isEditing) newRef.current?.focus();
  }, [isEditing]);

  // Grow the frame with the list.
  useLayoutEffect(() => {
    const el = rootRef.current;
    if (el) onAutoHeight?.(Math.ceil(el.scrollHeight));
  });

  const update = (patch) => onChange?.({ ...content, ...patch });
  const setItems = (next) => update({ items: next });
  const toggle = (id) => setItems(items.map((t) => (t.id === id ? { ...t, done: !t.done } : t)));
  const add = () => {
    const text = newText.trim().slice(0, 120);
    if (!text || items.length >= 60) return;
    setItems([...items, { id: crypto.randomUUID(), text, done: false }]);
    setNewText('');
  };

  const onHandleDown = (e, from) => {
    e.stopPropagation();
    e.preventDefault();
    const list = e.currentTarget.closest('ul');
    const rows = [...list.querySelectorAll('li.todo-row')];
    const tops = rows.map((r) => r.getBoundingClientRect());
    let to = from;
    const move = (ev) => {
      to = tops.findIndex((r) => ev.clientY < r.top + r.height / 2);
      if (to === -1) to = rows.length - 1;
      else if (to > from) to -= 1;
      setDragging({ from, to });
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      setDragging(null);
      if (to !== from) {
        const next = [...items];
        const [moved] = next.splice(from, 1);
        next.splice(to, 0, moved);
        setItems(next);
      }
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    setDragging({ from, to: from });
  };

  const done = items.filter((t) => t.done).length;
  return (
    <div ref={rootRef} className={`todo-view ${isEditing ? 'is-editing' : ''}`}>
      <div className="todo-head">
        {isEditing ? (
          <input
            className="todo-title-input"
            value={title}
            maxLength={40}
            placeholder="待办标题"
            onPointerDown={stop}
            onChange={(e) => setTitle(e.target.value)}
            onBlur={() => title !== (content.title || '') && update({ title: title.trim() })}
          />
        ) : (
          <b className="todo-title">{content.title || '待办'}</b>
        )}
        <span className="todo-count">
          {done}/{items.length}
        </span>
      </div>
      {items.length > 0 && (
        <div className="todo-progress" aria-hidden="true">
          <i style={{ width: `${(done / items.length) * 100}%` }} />
        </div>
      )}
      <ul className="todo-list">
        {items.map((t, k) => (
          <li
            key={t.id}
            className={`todo-row ${t.done ? 'done' : ''} ${dragging?.to === k && dragging.from !== k ? 'drop-here' : ''} ${dragging?.from === k ? 'dragging' : ''}`}
          >
            {isEditing && (
              <span
                className="todo-grip"
                aria-label="拖动排序"
                role="button"
                onPointerDown={(e) => onHandleDown(e, k)}
              >
                ⋮⋮
              </span>
            )}
            <button
              className="todo-check"
              role="checkbox"
              aria-checked={t.done}
              aria-label={t.text}
              onPointerDown={stop}
              onClick={() => toggle(t.id)}
            />
            {isEditing ? (
              <TodoText
                value={t.text}
                onCommit={(text) =>
                  setItems(
                    items.map((x) => (x.id === t.id ? { ...x, text: text.slice(0, 120) } : x)),
                  )
                }
              />
            ) : (
              <span className="todo-text">{t.text}</span>
            )}
            {isEditing && (
              <button
                className="todo-remove"
                aria-label={`删除「${t.text}」`}
                onPointerDown={stop}
                onClick={() => setItems(items.filter((x) => x.id !== t.id))}
              >
                ×
              </button>
            )}
          </li>
        ))}
      </ul>
      {!items.length && !isEditing && <p className="todo-empty">双击添加待办事项</p>}
      {isEditing && (
        <div className="todo-add" onPointerDown={stop}>
          <input
            ref={newRef}
            value={newText}
            maxLength={120}
            placeholder="添加一项，回车确认"
            onChange={(e) => setNewText(e.target.value)}
            onKeyDown={(e) => {
              if (e.nativeEvent.isComposing || e.keyCode === 229) return;
              if (e.key === 'Enter') {
                e.preventDefault();
                add();
              } else if (e.key === 'Escape') {
                e.preventDefault();
                onDone?.();
              }
            }}
          />
          <button onClick={onDone}>完成</button>
        </div>
      )}
    </div>
  );
}

function TodoText({ value, onCommit }) {
  const [text, setText] = useState(value);
  useEffect(() => setText(value), [value]);
  return (
    <input
      className="todo-text-input"
      value={text}
      maxLength={120}
      onPointerDown={stop}
      onChange={(e) => setText(e.target.value)}
      onBlur={() => text.trim() && text !== value && onCommit(text.trim())}
      onKeyDown={(e) => {
        if (e.nativeEvent.isComposing || e.keyCode === 229) return;
        if (e.key === 'Enter') e.currentTarget.blur();
      }}
    />
  );
}
