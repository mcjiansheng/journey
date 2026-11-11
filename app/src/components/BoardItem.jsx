import React, { useRef, useEffect, useCallback, useLayoutEffect, useState } from 'react';
import { BoardWidget } from './widgets/index.jsx';
import { GalleryView, TodoView } from './BoardRichItems.jsx';
import { pathD, strokeLook, noteColor, assetUrl } from '../board.js';
import { sanitizeRichText, richTextToPlain, plainToRichText } from '../rich-text.js';
import { widgetEdgeHandles, widgetSize, widgetScale } from '../board-widgets.js';

const SIZE_NAMES = { S: '小', M: '中', L: '大' };
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
}) {
  const content = item.content || {};
  const f = item.frame || { x: 0, y: 0, w: 100, h: 100, scale: 1 };
  const style = item.style || {};
  const z = item.z ?? 0;
  const type = content.type || 'widget';
  const locked = Boolean(style.locked ?? item.locked);

  const textRef = useRef(null);
  const editedRef = useRef(false);
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
    if (type === 'text') {
      // Grow the frame to the laid-out text (frame = what you see, N-2).
      const scale = f.scale || 1;
      size = {
        w: Math.max(24, Math.ceil(el.offsetWidth * scale)),
        h: Math.max(20, Math.ceil(el.offsetHeight * scale)),
      };
    }
    onCommitText?.(item.id, text, size, html);
  }, [item.id, type, isNote, f.scale, onCommitText]);

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
    renderedContent = (
      <div
        className={`text-sticker ${size} v-${style.variant || 'plain'}`}
        style={{ transform: `scale(${f.scale || 1})` }}
      >
        {editable('text-inner', '输入文字')}
      </div>
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
  const dimLabel = reshape
    ? SIZE_NAMES[reshape.size]
    : type === 'widget'
      ? `${SIZE_NAMES[widgetSize(item)]} · ${Math.round(widgetScale(item) * 100)}%`
      : `${Math.round(f.w)} × ${Math.round(f.h)}`;

  return (
    <div
      className={`board-item item-${type} ${style.tilt ? 'tilted' : ''} ${locked ? 'locked' : ''} ${isEditing ? 'editing' : ''} ${reshape ? 'reshaping' : ''} ${flash ? 'just-added' : ''}`}
      data-item-id={item.id}
      style={{
        transform: `translate(${f.x}px, ${f.y}px)`,
        width: f.w,
        height: f.h,
        zIndex: z,
        ...(style.tilt ? { '--tilt': `${style.tilt}deg` } : {}),
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

      {selected && (
        <div className="box" style={{ width: f.w, height: f.h }}>
          {locked && <span className="lock">🔒</span>}
          {(resizing || reshape) && dimLabel && <span className="dim">{dimLabel}</span>}
          {!locked &&
            CORNERS.map((a) => (
              <div
                key={a}
                className={`handle corner h-${a}`}
                onPointerDown={(e) => onHandlePointerDown?.(e, item.id, a)}
              />
            ))}
          {edges.map((a) => (
            <div
              key={a}
              className={`handle edge h-${a}`}
              role="presentation"
              title={a === 's' ? '往下拉变成大号，往上收回中号' : '左右拉动切换正方形 / 长方形'}
              onPointerDown={(e) => onHandlePointerDown?.(e, item.id, `edge-${a}`)}
            />
          ))}
        </div>
      )}

      {peerName && (
        <div
          className={`box peer ${peerEditing ? 'editing' : ''}`}
          style={{ width: f.w, height: f.h, '--c': peerColor }}
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
