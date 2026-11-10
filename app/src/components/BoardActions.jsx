import React from 'react';
import { WIDGET_KINDS, widgetSize } from '../board-widgets.js';

const NOTE_COLORS = [
  { id: 'yellow', hex: '#fef08a' },
  { id: 'green', hex: '#bbf7d0' },
  { id: 'blue', hex: '#bfdbfe' },
  { id: 'pink', hex: '#fbcfe8' },
  { id: 'purple', hex: '#e9d5ff' },
  { id: 'gray', hex: '#e2e8f0' },
];

export function BoardActions({
  item,
  pos,
  onChangeWidgetSize,
  onChangeNoteColor,
  onBringToFront,
  onSendToBack,
  onDuplicate,
  onToggleLock,
  onDelete,
  onSchedulePlace,
  onOpenTarget,
}) {
  if (!item) return null;

  const type = item.content?.type;
  const kind = item.content?.kind;
  const isWidget = type === 'widget';
  const isNote = type === 'note';
  const allowedSizes = isWidget ? WIDGET_KINDS[kind] || ['S'] : [];
  const currentSize = isWidget ? widgetSize(item) : null;
  const isLocked = Boolean(item.locked);

  return (
    <div
      id="actions"
      className="ui glass on"
      style={{
        left: `${pos.x}px`,
        top: `${pos.y - 48}px`,
        transform: 'translateX(-50%)',
      }}
    >
      {/* Widget sizes seg */}
      {isWidget && allowedSizes.length > 1 && (
        <div className="seg">
          {allowedSizes.map((sz) => (
            <button
              key={sz}
              aria-pressed={currentSize === sz}
              onClick={() => onChangeWidgetSize(sz)}
            >
              {sz === 'S' ? '小' : sz === 'M' ? '中' : '大'}
            </button>
          ))}
        </div>
      )}

      {/* Widget Contextual Actions */}
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

      {/* Note Colors */}
      {isNote && (
        <>
          {NOTE_COLORS.map((c) => (
            <button
              key={c.id}
              className="sw"
              style={{ backgroundColor: c.hex }}
              aria-pressed={item.style?.color === c.id}
              onClick={() => onChangeNoteColor(c.id)}
            />
          ))}
          <div className="sep" />
        </>
      )}

      {/* Common Layer & Management */}
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
