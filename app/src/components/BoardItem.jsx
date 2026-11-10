import React, { useRef, useEffect, useCallback } from 'react';
import { BoardWidget } from './widgets/index.jsx';
import { pathD } from '../board.js';

export function BoardItem({
  item,
  snapshot,
  selected = false,
  isEditing = false,
  peerSelection = null,
  isResizing = false,
  onPointerDown,
  onSelect,
  onTextChange,
  onStartEditing,
  onEndEditing,
  onHandlePointerDown,
}) {
  const p = item.payload || {};
  const content = item.content || p.content || {};
  const f = item.frame || p.frame || { x: 0, y: 0, w: 100, h: 100, scale: 1 };
  const style = item.style || p.style || {};
  const z = item.z ?? p.z ?? 0;
  const type = content.type || 'widget';
  const locked = Boolean(style.locked ?? item.locked);

  const noteTextRef = useRef(null);
  const currentTextRef = useRef(content.text || '');
  const prevPropTextRef = useRef(content.text || '');

  useEffect(() => {
    if (!isEditing && noteTextRef.current) {
      if (content.text !== prevPropTextRef.current) {
        prevPropTextRef.current = content.text;
        currentTextRef.current = content.text || '';
        noteTextRef.current.innerText = content.text || '';
      }
    }
  }, [content.text, isEditing]);

  useEffect(() => {
    if (isEditing && noteTextRef.current) {
      noteTextRef.current.focus();
      const sel = window.getSelection();
      const range = document.createRange();
      range.selectNodeContents(noteTextRef.current);
      range.collapse(false);
      sel?.removeAllRanges();
      sel?.addRange(range);
    }
  }, [isEditing]);

  const commit = useCallback(() => {
    const raw = noteTextRef.current ? noteTextRef.current.innerText || '' : currentTextRef.current;
    const text = raw.replace(/\r?\n$/, '').slice(0, 500);
    currentTextRef.current = text;
    if (text !== (content.text || '')) {
      onTextChange?.(item.id, text);
    }
  }, [item.id, content.text, onTextChange]);

  const handleBlur = () => {
    commit();
    onEndEditing?.();
  };

  const handleInput = (e) => {
    currentTextRef.current = e.currentTarget.innerText || e.currentTarget.textContent || '';
  };

  const prevEditingRef = useRef(isEditing);
  useEffect(() => {
    if (prevEditingRef.current && !isEditing) {
      commit();
    }
    prevEditingRef.current = isEditing;
  }, [isEditing, commit]);

  const handlePointerDown = (e) => {
    if (isEditing) return;
    onPointerDown?.(e, item);
  };

  const handleDoubleClick = (e) => {
    if (type === 'note' || type === 'text') {
      e.stopPropagation();
      onStartEditing?.(item.id);
    }
  };

  // Content rendering
  let renderedContent = null;
  if (type === 'widget') {
    renderedContent = <BoardWidget item={item} snapshot={snapshot} />;
  } else if (type === 'note') {
    const color = style.color || 'yellow';
    renderedContent = (
      <div className={`note-card ${color}`} onDoubleClick={handleDoubleClick}>
        <div
          ref={noteTextRef}
          className="note-text"
          contentEditable={isEditing}
          suppressContentEditableWarning
          onInput={handleInput}
          onBlur={handleBlur}
          onPointerDown={(e) => {
            if (isEditing) e.stopPropagation();
          }}
        >
          {content.text || ''}
        </div>
      </div>
    );
  } else if (type === 'text') {
    const size = style.size || 'body';
    renderedContent = (
      <div
        className={`text-sticker ${size}`}
        onDoubleClick={handleDoubleClick}
        style={{ transform: `scale(${f.scale || 1})`, transformOrigin: 'top left' }}
      >
        <div
          ref={noteTextRef}
          className="text-inner"
          contentEditable={isEditing}
          suppressContentEditableWarning
          onInput={handleInput}
          onBlur={handleBlur}
          onPointerDown={(e) => {
            if (isEditing) e.stopPropagation();
          }}
        >
          {content.text || ''}
        </div>
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
    const assetId = content.assetId;
    const isGif = Boolean(content.animated || content.isGif);
    const src = assetId
      ? `/api/trips/${item.tripId}/assets/${assetId}?variant=full`
      : content.src || '';

    renderedContent = (
      <div className={`image-sticker ${isPolaroid ? 'polaroid' : ''}`}>
        <img src={src} alt={content.caption || '贴纸图片'} draggable={false} />
        {isPolaroid && content.caption && <div className="cap">{content.caption}</div>}
      </div>
    );
  } else if (type === 'stroke') {
    const isHl = content.tool === 'highlighter' || style.tool === 'highlighter';
    const strokeWidth = isHl ? style.size || 16 : style.size || 4;

    let strokeColor;
    if (isHl) {
      const hlMap = {
        yellow: 'rgba(254, 240, 138, 0.65)',
        green: 'rgba(187, 247, 208, 0.65)',
        blue: 'rgba(191, 219, 254, 0.65)',
        pink: 'rgba(251, 207, 232, 0.65)',
      };
      strokeColor = hlMap[style.color] || 'rgba(254, 240, 138, 0.65)';
    } else {
      const penMap = {
        default: 'var(--text)',
        accent: 'var(--brand, #059669)',
        red: '#dc2626',
        orange: '#ea580c',
        blue: '#2563eb',
        purple: '#9333ea',
      };
      strokeColor = penMap[style.color] || style.color || 'var(--text)';
    }
    const d = pathD(content.points);

    renderedContent = (
      <svg
        className={`stroke-container ${isHl ? 'highlighter' : ''}`}
        style={{ width: f.w, height: f.h }}
      >
        <path
          d={d}
          stroke={strokeColor}
          strokeWidth={strokeWidth}
          fill="none"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    );
  }

  return (
    <div
      className={`board-item item-${type} ${locked ? 'locked' : ''}`}
      data-item-id={item.id}
      style={{
        transform: `translate(${f.x}px, ${f.y}px)`,
        width: f.w,
        height: f.h,
        zIndex: z,
      }}
      onPointerDown={handlePointerDown}
    >
      {renderedContent}

      {/* Local Selection Box & Handles */}
      {selected && (
        <div className="box" style={{ width: f.w, height: f.h }}>
          {locked && <span className="lock">🔒</span>}
          {isResizing && (
            <span className="dim">
              {Math.round(f.w)} × {Math.round(f.h)}
            </span>
          )}
          {!locked && (
            <>
              <div
                className="handle nw"
                onPointerDown={(e) => onHandlePointerDown?.(e, item, 'nw')}
              />
              <div
                className="handle ne"
                onPointerDown={(e) => onHandlePointerDown?.(e, item, 'ne')}
              />
              <div
                className="handle se"
                onPointerDown={(e) => onHandlePointerDown?.(e, item, 'se')}
              />
              <div
                className="handle sw"
                onPointerDown={(e) => onHandlePointerDown?.(e, item, 'sw')}
              />
            </>
          )}
        </div>
      )}

      {/* Peer Remote Selection Box */}
      {peerSelection && (
        <div
          className={`box peer ${peerSelection.isEditing ? 'editing' : ''}`}
          style={{
            width: f.w,
            height: f.h,
            '--c': peerSelection.color,
          }}
        >
          <span className="who">{peerSelection.displayName}</span>
        </div>
      )}
    </div>
  );
}
