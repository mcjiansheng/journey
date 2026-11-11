import React, { useRef, useEffect, useCallback, useLayoutEffect } from 'react';
import { BoardWidget } from './widgets/index.jsx';
import { pathD, strokeLook, noteColor } from '../board.js';
import { widgetEdgeHandles, widgetSize, widgetScale } from '../board-widgets.js';

const SIZE_NAMES = { S: '小', M: '中', L: '大' };
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
}) {
  const content = item.content || {};
  const f = item.frame || { x: 0, y: 0, w: 100, h: 100, scale: 1 };
  const style = item.style || {};
  const z = item.z ?? 0;
  const type = content.type || 'widget';
  const locked = Boolean(style.locked ?? item.locked);

  const textRef = useRef(null);
  const editedRef = useRef(false);

  // Keep the DOM text in sync with remote edits while not editing.
  useLayoutEffect(() => {
    if (!isEditing && textRef.current && textRef.current.innerText !== (content.text || '')) {
      textRef.current.innerText = content.text || '';
    }
  }, [content.text, isEditing]);

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
    const text = (el.innerText || '').replace(/\r?\n$/, '').slice(0, 500);
    let size = null;
    if (type === 'text') {
      // Grow the frame to the laid-out text (frame = what you see, N-2).
      const scale = f.scale || 1;
      size = {
        w: Math.max(24, Math.ceil(el.offsetWidth * scale)),
        h: Math.max(20, Math.ceil(el.offsetHeight * scale)),
      };
    }
    onCommitText?.(item.id, text, size);
  }, [item.id, type, f.scale, onCommitText]);

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
      <div className={`note-card ${noteColor(style.color)}`}>
        {editable('note-text', '写点什么')}
      </div>
    );
  } else if (type === 'text') {
    const size = style.size || 'body';
    renderedContent = (
      <div className={`text-sticker ${size}`} style={{ transform: `scale(${f.scale || 1})` }}>
        {editable('text-inner', '输入文字')}
      </div>
    );
  } else if (type === 'emoji') {
    const fontSize = Math.round(Math.min(f.w, f.h) * 0.72);
    renderedContent = (
      <div className="emoji-sticker" style={{ fontSize: `${fontSize}px` }}>
        {content.char || content.emoji || '✨'}
      </div>
    );
  } else if (type === 'image') {
    const isPolaroid = style.frameStyle === 'polaroid' || Boolean(style.polaroid);
    const src = content.assetId
      ? `/api/trips/${item.tripId}/assets/${content.assetId}?variant=full`
      : content.src || '';
    renderedContent = (
      <div className={`image-sticker ${isPolaroid ? 'polaroid' : ''}`}>
        <img src={src} alt={content.caption || '贴纸图片'} draggable={false} />
        {isPolaroid && content.caption && <div className="cap">{content.caption}</div>}
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
      className={`board-item item-${type} ${locked ? 'locked' : ''} ${isEditing ? 'editing' : ''} ${reshape ? 'reshaping' : ''} ${flash ? 'just-added' : ''}`}
      data-item-id={item.id}
      style={{
        transform: `translate(${f.x}px, ${f.y}px)`,
        width: f.w,
        height: f.h,
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

      {selected && (
        <div className="box" style={{ width: f.w, height: f.h }}>
          {locked && <span className="lock">🔒</span>}
          {(resizing || reshape) && dimLabel && <span className="dim">{dimLabel}</span>}
          {!locked &&
            CORNERS.map((a) => (
              <div
                key={a}
                className={`handle ${a}`}
                onPointerDown={(e) => onHandlePointerDown?.(e, item.id, a)}
              />
            ))}
          {edges.map((a) => (
            <div
              key={a}
              className={`handle edge ${a}`}
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
