import React, { useLayoutEffect, useRef, useState } from 'react';
import { NOTE, NOTE_NAMES, noteColor } from '../board.js';

const GAP = 12;

/**
 * Context bar for the selected object. `rect` is the object's screen rect inside
 * the stage; the bar sits above it, or below when the floating header would
 * cover it, and is clamped horizontally into the stage (N-8).
 */
export function BoardActions({
  item,
  rect,
  stage,
  topSafe = 76,
  hidden = false,
  onChangeNoteColor,
  onBringToFront,
  onSendToBack,
  onDuplicate,
  onToggleLock,
  onDelete,
  onSchedulePlace,
  onOpenTarget,
}) {
  const ref = useRef(null);
  const [pos, setPos] = useState(null);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el || !rect) return;
    const bw = el.offsetWidth;
    const bh = el.offsetHeight;
    const above = rect.y - GAP - bh;
    const top = above >= topSafe ? above : Math.min(rect.y + rect.h + GAP, stage.h - bh - 96);
    const cx = rect.x + rect.w / 2;
    const left = Math.min(stage.w - 8 - bw, Math.max(8, cx - bw / 2));
    setPos((p) => (p && p.left === left && p.top === top ? p : { left, top }));
  });

  if (!item) return null;

  const type = item.content?.type;
  const kind = item.content?.kind;
  const isWidget = type === 'widget';
  const isNote = type === 'note';
  const isLocked = Boolean(item.style?.locked ?? item.locked);
  const currentNote = isNote ? noteColor(item.style?.color) : null;

  return (
    <div
      id="actions"
      ref={ref}
      className={`ui glass on ${hidden ? 'is-hidden' : ''}`}
      aria-hidden={hidden || undefined}
      role="toolbar"
      aria-label="所选对象操作"
      style={pos ? { left: pos.left, top: pos.top } : { left: -9999, top: -9999 }}
    >
      {isWidget && kind === 'place' && !item.linkedActivityId && (
        <button className="primary" onClick={() => onSchedulePlace(item)}>
          加入行程
        </button>
      )}

      {isWidget && (
        <button onClick={() => onOpenTarget(item)}>
          {kind === 'activity'
            ? '打开安排'
            : kind === 'day' || kind === 'route'
              ? '查看这天'
              : kind === 'place'
                ? '在地图查看'
                : kind === 'expense'
                  ? '打开账本'
                  : '查看'}
        </button>
      )}

      {isNote && (
        <>
          {Object.keys(NOTE).map((id) => (
            <button
              key={id}
              className="sw"
              style={{ backgroundColor: NOTE[id] }}
              aria-pressed={currentNote === id}
              aria-label={`便签颜色：${NOTE_NAMES[id]}`}
              title={NOTE_NAMES[id]}
              onClick={() => onChangeNoteColor(id)}
            />
          ))}
          <div className="sep" />
        </>
      )}

      <button onClick={onBringToFront} title="置顶">
        置顶
      </button>
      <button onClick={onSendToBack} title="置底">
        置底
      </button>
      <button onClick={onDuplicate} title="复制一份">
        复制
      </button>
      <button onClick={onToggleLock} title={isLocked ? '解锁' : '锁定'}>
        {isLocked ? '解锁' : '锁定'}
      </button>
      <button className="danger" onClick={onDelete} title="删除">
        删除
      </button>
    </div>
  );
}
