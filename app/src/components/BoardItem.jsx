import React, { useRef, useEffect, useCallback, useLayoutEffect, useState } from 'react';
import { BoardWidget } from './widgets/index.jsx';
import { GalleryView, TodoView } from './BoardRichItems.jsx';
import { pathD, strokeLook, noteColor, assetUrl, itemRotation } from '../board.js';
import { sanitizeRichText, richTextToPlain, plainToRichText } from '../rich-text.js';
import { widgetEdgeHandles, widgetSize, widgetScale } from '../board-widgets.js';

const SIZE_NAMES = { S: '小', M: '中', L: '大' };
// Side handles that change one dimension (widgets use their own form handles).
const SIDES = {
  text: ['e', 'w'],
  note: ['n', 'e', 's', 'w'],
  todo: ['n', 'e', 's', 'w'],
  section: ['n', 'e', 's', 'w'],
  gallery: ['n', 'e', 's', 'w'],
};
const SIDE_TITLES = {
  text: '左右拖动改变换行宽度',
  gallery: '拖动边缘切换比例 1:2 · 9:16 · 3:4 · 1:1 · 4:3 · 16:9 · 2:1',
};
// Handle classes are prefixed: bare `sw`/`w` collide with the swatch and
// widget classes and drew stray circles around the left handles.
const CORNERS = ['nw', 'ne', 'se', 'sw'];

/**
 * One object on the board. Wrapped in React.memo: callbacks are stable and take
 * the item id, so a drag only re-renders the dragged items (旧 P2-6).
 */
export const BoardItem = React.memo(function BoardItem({
  item,
  snapshot,
  selected = false,
  handles = false,
  preview = false,
  isEditing = false,
  flash = false,
  peerName = null,
  peerColor = null,
  peerEditing = false,
  resizing = false,
  reshape = null,
  onItemPointerDown,
  onItemDoubleClick,
  onHandlePointerDown,
  onCommitText,
  onEndEditing,
  tripId,
  onContentChange,
  onGalleryAddImages,
  onAutoHeight,
  onMeasure,
  takeTyped,
  sectionHint = null,
  ratioLabel = null,
  angleLabel = null,
}) {
  const content = item.content || {};
  const f = item.frame || { x: 0, y: 0, w: 100, h: 100, scale: 1 };
  const style = item.style || {};
  const z = item.z ?? 0;
  const type = content.type || 'widget';
  const locked = Boolean(style.locked ?? item.locked);

  const textRef = useRef(null);
  const stickerRef = useRef(null);
  const editedRef = useRef(false);
  // Text: the frame follows the laid-out text, so the selection box always
  // matches what is on screen (auto width grows as you type; a fixed width
  // wraps and grows downwards).
  const [measured, setMeasured] = useState(null);
  const scale = f.scale || 1;
  useLayoutEffect(() => {
    const el = stickerRef.current;
    if (type !== 'text' || !el) return undefined;
    const update = () => {
      const next = {
        w: Math.max(24, Math.ceil(el.offsetWidth * scale)),
        h: Math.max(20, Math.ceil(el.offsetHeight * scale)),
      };
      setMeasured((m) => (m && m.w === next.w && m.h === next.h ? m : next));
      onMeasure?.(item.id, next);
    };
    update();
    if (typeof ResizeObserver === 'undefined') return undefined;
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, [type, scale, item.id, onMeasure]);
  const isNote = type === 'note';
  // Notes are rich text (sanitized on every render, peers included); text
  // stickers stay plain.
  const noteHtml = isNote
    ? content.html
      ? sanitizeRichText(content.html)
      : plainToRichText(content.text || '')
    : '';

  // Keep the DOM in sync with remote edits while not editing.
  useLayoutEffect(() => {
    const el = textRef.current;
    if (isEditing || !el) return;
    if (isNote) {
      if (el.innerHTML !== noteHtml) el.innerHTML = noteHtml;
    } else if (el.innerText !== (content.text || '')) {
      el.innerText = content.text || '';
    }
  }, [content.text, noteHtml, isEditing, isNote]);

  // Entering edit mode: an empty object gets a caret; existing text is fully
  // selected so typing replaces it (Figma / Keynote behaviour).
  useEffect(() => {
    const el = textRef.current;
    if (!isEditing || !el) return;
    editedRef.current = true;
    el.focus();
    const sel = window.getSelection();
    const range = document.createRange();
    range.selectNodeContents(el);
    if (!(el.innerText || '').trim()) range.collapse(true);
    sel?.removeAllRanges();
    sel?.addRange(range);
    // Opened by typing on the selected object: add what was typed at the end.
    const typed = takeTyped?.(item.id);
    if (typed) {
      range.selectNodeContents(el);
      range.collapse(false);
      sel?.removeAllRanges();
      sel?.addRange(range);
      document.execCommand('insertText', false, typed);
    }
  }, [isEditing]);

  const commit = useCallback(() => {
    const el = textRef.current;
    if (!el) return;
    let text = (el.innerText || '').replace(/\r?\n$/, '').slice(0, 500);
    let html;
    if (isNote) {
      html = sanitizeRichText(el.innerHTML).slice(0, 8000);
      text = richTextToPlain(html).slice(0, 500);
    }
    let size = null;
    if (type === 'text' && stickerRef.current) {
      // Grow the frame to the laid-out text (frame = what you see, N-2).
      const box = stickerRef.current;
      size = {
        w: Math.max(24, Math.ceil(box.offsetWidth * scale)),
        h: Math.max(20, Math.ceil(box.offsetHeight * scale)),
      };
    }
    onCommitText?.(item.id, text, size, html);
  }, [item.id, type, isNote, scale, onCommitText]);

  // Leaving edit mode by any route (blur, Esc, selecting elsewhere) commits once.
  const prevEditingRef = useRef(isEditing);
  useEffect(() => {
    if (prevEditingRef.current && !isEditing && editedRef.current) {
      editedRef.current = false;
      commit();
    }
    prevEditingRef.current = isEditing;
  }, [isEditing, commit]);

  const handleBlur = () => {
    if (!editedRef.current) return;
    editedRef.current = false;
    commit();
    onEndEditing?.(item.id);
  };

  const handleEditKeyDown = (e) => {
    if (e.nativeEvent.isComposing || e.keyCode === 229) return;
    e.stopPropagation();
    if (e.key === 'Escape') {
      e.preventDefault();
      e.currentTarget.blur();
    }
  };

  const handlePointerDown = (e) => {
    if (isEditing) return;
    // Checklist boxes in a note tick without entering edit mode.
    const li = isNote && e.button === 0 ? e.target.closest?.('ul[data-list="check"] > li') : null;
    if (li && !locked && e.clientX - li.getBoundingClientRect().left < 24) {
      e.stopPropagation();
      if (li.dataset.checked === 'true') delete li.dataset.checked;
      else li.dataset.checked = 'true';
      const html = sanitizeRichText(textRef.current.innerHTML);
      onCommitText?.(item.id, richTextToPlain(html), null, html);
      return;
    }
    onItemPointerDown?.(e, item.id);
  };

  const handleDoubleClick = (e) => {
    e.stopPropagation();
    onItemDoubleClick?.(item.id);
  };

  const editable = (className, placeholder) => (
    <div
      ref={textRef}
      className={className}
      data-placeholder={placeholder}
      contentEditable={isEditing}
      suppressContentEditableWarning
      onBlur={handleBlur}
      onKeyDown={isEditing ? handleEditKeyDown : undefined}
      onPointerDown={(e) => {
        if (isEditing) e.stopPropagation();
      }}
    />
  );

  let renderedContent = null;
  if (type === 'widget') {
    renderedContent = <BoardWidget item={item} snapshot={snapshot} />;
  } else if (type === 'note') {
    renderedContent = (
      <div
        className={`note-card ${noteColor(style.color)} v-${style.variant || 'plain'} fs-${style.fontSize || 'm'}`}
      >
        {editable('note-text', '写点什么')}
      </div>
    );
  } else if (type === 'text') {
    const size = style.size || 'body';
    const auto = style.autoWidth !== false;
    renderedContent = (
      <div
        ref={stickerRef}
        className={`text-sticker ${size} v-${style.variant || 'plain'} ${auto ? 'auto' : 'fixed'}`}
        style={{
          transform: `scale(${scale})`,
          width: auto ? undefined : Math.max(24, f.w / scale),
        }}
      >
        {editable('text-inner', '输入文字')}
      </div>
    );
  } else if (type === 'section') {
    renderedContent = (
      <SectionBox
        item={item}
        isEditing={isEditing}
        onRename={(title) => onContentChange?.(item.id, { ...content, title })}
        onDone={() => onEndEditing?.(item.id)}
      />
    );
  } else if (type === 'emoji') {
    const fontSize = Math.round(Math.min(f.w, f.h) * 0.72);
    renderedContent = (
      <div
        className={`emoji-sticker v-${style.variant || 'plain'}`}
        style={{ fontSize: `${fontSize}px` }}
      >
        <span>{content.char || content.emoji || '✨'}</span>
      </div>
    );
  } else if (type === 'image') {
    renderedContent = (
      <ImageSticker
        content={content}
        frameStyle={style.frameStyle || (style.polaroid ? 'polaroid' : 'none')}
        src={content.assetId ? assetUrl(item.tripId || tripId, content.assetId) : content.src || ''}
      />
    );
  } else if (type === 'gallery') {
    renderedContent = (
      <div className={`gallery-sticker frame-${style.frameStyle || 'none'}`}>
        <GalleryView
          item={item}
          tripId={item.tripId || tripId}
          isEditing={isEditing}
          selected={selected}
          onChange={(next) => onContentChange?.(item.id, next)}
          onAddImages={() => onGalleryAddImages?.(item.id)}
          onDone={() => onEndEditing?.(item.id)}
        />
      </div>
    );
  } else if (type === 'todo') {
    renderedContent = (
      <div
        className={`todo-sticker ${noteColor(style.color || 'gray')} v-${style.variant || 'plain'}`}
      >
        <TodoView
          item={item}
          isEditing={isEditing}
          onChange={(next) => onContentChange?.(item.id, next)}
          onAutoHeight={(h) => onAutoHeight?.(item.id, h)}
          onDone={() => onEndEditing?.(item.id)}
        />
      </div>
    );
  } else if (type === 'stroke') {
    const tool =
      content.tool === 'highlighter' || style.tool === 'highlighter' ? 'highlighter' : 'pen';
    const look = strokeLook(tool, style.color, style.size);
    const d = pathD(content.points);
    // Only the painted path is hit-testable; a wider transparent twin makes
    // thin lines easy to grab at any zoom (N-5).
    renderedContent = (
      <svg
        className={`stroke-container ${tool === 'highlighter' ? 'highlighter' : ''}`}
        style={{ width: f.w, height: f.h }}
        overflow="visible"
      >
        <path
          className="stroke-paint"
          d={d}
          stroke={look.stroke}
          strokeOpacity={look.opacity}
          strokeWidth={look.width}
          fill="none"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        <path
          className="stroke-hit"
          d={d}
          stroke="transparent"
          fill="none"
          strokeLinecap="round"
          strokeLinejoin="round"
          style={{ strokeWidth: `max(${look.width}px, calc(12px * var(--ik)))` }}
        />
      </svg>
    );
  }

  const edges = type === 'widget' && !locked ? widgetEdgeHandles(item) : [];
  const sides = type !== 'widget' && !locked ? SIDES[type] || [] : [];
  const dimLabel =
    angleLabel ??
    ratioLabel ??
    (reshape
      ? SIZE_NAMES[reshape.size]
      : type === 'widget'
        ? `${SIZE_NAMES[widgetSize(item)]} · ${Math.round(widgetScale(item) * 100)}%`
        : type === 'text'
          ? `${Math.round(scale * 100)}%`
          : `${Math.round(f.w)} × ${Math.round(f.h)}`);
  // Text shows at its laid-out size; everything else at its frame.
  const w = type === 'text' && measured ? (style.autoWidth !== false ? measured.w : f.w) : f.w;
  const h = type === 'text' && measured ? measured.h : f.h;
  const rotation = itemRotation(item);
  const canRotate = type !== 'section' && !locked;

  return (
    <div
      className={`board-item item-${type} ${locked ? 'locked' : ''} ${isEditing ? 'editing' : ''} ${reshape ? 'reshaping' : ''} ${flash ? 'just-added' : ''} ${selected ? 'is-selected' : ''} ${preview ? 'is-preview' : ''} ${rotation ? 'rotated' : ''}`}
      data-item-id={item.id}
      style={{
        transform: `translate(${f.x}px, ${f.y}px)${rotation ? ` rotate(${rotation}deg)` : ''}`,
        width: w,
        height: h,
        zIndex: z,
      }}
      onPointerDown={handlePointerDown}
      onDoubleClick={handleDoubleClick}
    >
      {renderedContent}

      {reshape && (
        <div
          className="reshape-outline"
          style={{
            left: reshape.box.x - f.x,
            top: reshape.box.y - f.y,
            width: reshape.box.w,
            height: reshape.box.h,
          }}
        />
      )}

      {sectionHint && (
        <div
          className={`section-hint ${sectionHint}`}
          style={{ width: w, height: h }}
          aria-hidden="true"
        />
      )}

      {selected && (
        <div
          className={`box ${handles ? 'with-handles' : 'outline'}`}
          style={{ width: w, height: h }}
        >
          {locked && <span className="lock">🔒</span>}
          {handles && (resizing || reshape || angleLabel != null) && dimLabel && (
            <span className="dim">{dimLabel}</span>
          )}
          {handles && canRotate && (
            <div
              className="handle rotate h-rot"
              role="presentation"
              title="拖动旋转，按住 Shift 每次 15°"
              onPointerDown={(e) => onHandlePointerDown?.(e, item.id, 'rotate')}
            />
          )}
          {handles &&
            !locked &&
            CORNERS.map((a) => (
              <div
                key={a}
                className={`handle corner h-${a}`}
                onPointerDown={(e) => onHandlePointerDown?.(e, item.id, a)}
              />
            ))}
          {handles &&
            edges.map((a) => (
              <div
                key={a}
                className={`handle edge h-${a}`}
                role="presentation"
                title={a === 's' ? '往下拉变成大号，往上收回中号' : '左右拉动切换正方形 / 长方形'}
                onPointerDown={(e) => onHandlePointerDown?.(e, item.id, `edge-${a}`)}
              />
            ))}
          {handles &&
            sides.map((a) => (
              <div
                key={a}
                className={`handle edge side h-${a}`}
                role="presentation"
                title={SIDE_TITLES[type] || '拖动边缘调整大小'}
                onPointerDown={(e) => onHandlePointerDown?.(e, item.id, `side-${a}`)}
              />
            ))}
        </div>
      )}

      {peerName && (
        <div
          className={`box peer ${peerEditing ? 'editing' : ''}`}
          style={{ width: w, height: h, '--c': peerColor }}
        >
          <span className="who">{peerName}</span>
        </div>
      )}
    </div>
  );
});

/** Photo sticker with frame styles; a failed load shows a retry card, not alt text. */
function ImageSticker({ content, frameStyle, src }) {
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => setFailed(false), [src]);
  const url = attempt ? `${src}${src.includes('?') ? '&' : '?'}r=${attempt}` : src;
  return (
    <div className={`image-sticker frame-${frameStyle}`}>
      {failed ? (
        <div className="image-failed">
          <span>图片未能载入</span>
          <button
            onPointerDown={(e) => e.stopPropagation()}
            onClick={() => {
              setFailed(false);
              setAttempt((a) => a + 1);
            }}
          >
            重试
          </button>
        </div>
      ) : (
        <img
          src={url}
          alt={content.caption || ''}
          draggable={false}
          onError={() => setFailed(true)}
        />
      )}
      {frameStyle === 'polaroid' && content.caption && <div className="cap">{content.caption}</div>}
    </div>
  );
}

/** 分区: a labelled area. Only its title tab and border take the pointer, so
 * the canvas inside stays usable (pan, draw, select what is inside). */
function SectionBox({ item, isEditing, onRename, onDone }) {
  const style = item.style || {};
  const title = item.content?.title || '';
  const [draft, setDraft] = useState(title);
  const inputRef = useRef(null);
  useEffect(() => {
    if (!isEditing) return;
    setDraft(title);
    requestAnimationFrame(() => {
      inputRef.current?.focus();
      inputRef.current?.select();
    });
  }, [isEditing]);
  const commit = () => {
    const next = draft.trim().slice(0, 40);
    if (next !== title) onRename(next);
    onDone();
  };
  return (
    <div
      className={`section-box ${noteColor(style.color || 'blue')} v-${style.variant || 'plain'}`}
    >
      {['t', 'r', 'b', 'l'].map((e) => (
        <i key={e} className={`section-edge ${e}`} aria-hidden="true" />
      ))}
      <div className="section-title">
        {isEditing ? (
          <input
            ref={inputRef}
            value={draft}
            maxLength={40}
            aria-label="分区名称"
            placeholder="分区名称"
            onChange={(e) => setDraft(e.target.value)}
            onPointerDown={(e) => e.stopPropagation()}
            onKeyDown={(e) => {
              if (e.nativeEvent.isComposing || e.keyCode === 229) return;
              e.stopPropagation();
              if (e.key === 'Enter') commit();
              if (e.key === 'Escape') onDone();
            }}
            onBlur={commit}
          />
        ) : (
          <span>{title || '未命名分区'}</span>
        )}
      </div>
    </div>
  );
}
