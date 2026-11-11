import React, { useLayoutEffect, useRef, useState } from 'react';
import {
  NOTE,
  NOTE_NAMES,
  noteColor,
  STYLE_VARIANTS,
  IMAGE_FRAMES,
  GALLERY_RATIOS,
  nextTilt,
} from '../board.js';

const SWAP = { '3:4': '4:3', '4:3': '3:4', '16:9': '9:16', '9:16': '16:9', '1:1': '1:1' };

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
  onChangeStyle,
  onGalleryRatio,
  onGalleryAdd,
  onEdit,
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
  const [styleOpen, setStyleOpen] = useState(false);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el || !rect) return;
    const bw = el.offsetWidth;
    const bh = el.offsetHeight;
    const above = rect.y - GAP - bh;
    const top = above >= topSafe ? above : Math.min(rect.y + rect.h + GAP, stage.h - bh - 96);
    const cx = rect.x + rect.w / 2;
    const left = Math.min(stage.w - 8 - bw, Math.max(8, cx - bw / 2));
    setPos((p) => (p && p.left === left && p.top === top && p.h === bh ? p : { left, top, h: bh }));
  });

  if (!item) return null;

  const type = item.content?.type;
  const kind = item.content?.kind;
  const isWidget = type === 'widget';
  const isNote = type === 'note';
  const isLocked = Boolean(item.style?.locked ?? item.locked);
  const currentNote = isNote || type === 'todo' ? noteColor(item.style?.color || 'gray') : null;
  const style = item.style || {};
  const variants = STYLE_VARIANTS[type];
  const frames =
    type === 'image'
      ? IMAGE_FRAMES
      : type === 'gallery'
        ? IMAGE_FRAMES.filter(([id]) => ['none', 'polaroid', 'card', 'tape'].includes(id))
        : null;
  const canTilt = ['image', 'note', 'gallery', 'emoji'].includes(type);
  const hasStyles = Boolean(variants || frames || canTilt);
  const ratio = style.ratio || '1:1';

  // The style choices open beside the bar, outside it: the bar scrolls
  // sideways and would clip anything hanging off it.
  const barBelow = pos && rect && pos.top > rect.y;
  const popStyle = pos
    ? barBelow
      ? { left: pos.left, top: pos.top + (pos.h || 44) + 6 }
      : { left: pos.left, top: pos.top - 6, transform: 'translateY(-100%)' }
    : { left: -9999, top: -9999 };

  return (
    <>
      {styleOpen && hasStyles && !isLocked && (
        <div
          className={`style-pop ui glass ${hidden ? 'is-hidden' : ''}`}
          role="group"
          aria-label="贴纸样式"
          style={popStyle}
        >
          {variants &&
            variants.map(([id, name]) => (
              <button
                key={id}
                className={`style-chip v-${id}`}
                aria-pressed={(style.variant || 'plain') === id}
                onClick={() => onChangeStyle({ variant: id })}
              >
                {name}
              </button>
            ))}
          {frames &&
            frames.map(([id, name]) => (
              <button
                key={id}
                className="style-chip"
                aria-pressed={(style.frameStyle || 'none') === id}
                onClick={() => onChangeStyle({ frameStyle: id })}
              >
                {name}
              </button>
            ))}
          {canTilt && (
            <button
              className="style-chip"
              aria-pressed={Boolean(style.tilt)}
              onClick={() => onChangeStyle({ tilt: nextTilt(style.tilt || 0) })}
              title="每点一次换一个角度，回到 0° 为摆正"
            >
              歪一点 {style.tilt ? `${style.tilt}°` : ''}
            </button>
          )}
        </div>
      )}
      <div
        id="actions"
        ref={ref}
        className={`ui glass on ${hidden ? 'is-hidden' : ''}`}
        aria-hidden={hidden || undefined}
        role="toolbar"
        aria-label="所选对象操作"
        style={pos ? { left: pos.left, top: pos.top } : { left: -9999, top: -9999 }}
      >
        {type === 'gallery' && (
          <>
            <div className="seg" role="group" aria-label="图库比例">
              {GALLERY_RATIOS.filter((r) => r !== '4:3' && r !== '9:16').map((r) => {
                const active = ratio === r || ratio === SWAP[r];
                return (
                  <button
                    key={r}
                    aria-pressed={active}
                    onClick={() => onGalleryRatio(active ? ratio : r)}
                  >
                    {active ? ratio : r}
                  </button>
                );
              })}
            </div>
            <button
              onClick={() => onGalleryRatio(SWAP[ratio])}
              disabled={ratio === '1:1'}
              title="横竖互换"
            >
              ⇄ 横竖
            </button>
            <button onClick={onGalleryAdd}>添加图片</button>
            <button onClick={onEdit}>调整显示</button>
            <div className="sep" />
          </>
        )}

        {type === 'todo' && (
          <>
            <button className="primary" onClick={onEdit}>
              编辑清单
            </button>
            {Object.keys(NOTE).map((id) => (
              <button
                key={id}
                className="sw"
                style={{ backgroundColor: NOTE[id] }}
                aria-pressed={currentNote === id}
                aria-label={`待办颜色：${NOTE_NAMES[id]}`}
                title={NOTE_NAMES[id]}
                onClick={() => onChangeStyle({ color: id })}
              />
            ))}
            <div className="sep" />
          </>
        )}

        {hasStyles && !isLocked && (
          <button aria-expanded={styleOpen} onClick={() => setStyleOpen((v) => !v)}>
            样式
          </button>
        )}

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
                : kind === 'place' || kind === 'places'
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
    </>
  );
}
