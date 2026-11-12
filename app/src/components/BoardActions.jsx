import React, { useLayoutEffect, useRef, useState } from 'react';
import { NOTE, NOTE_NAMES, noteColor, IMAGE_FRAMES, variantsFor } from '../board.js';

// Above the selection the bar clears the rotation handle; below it, the size label.
const GAP_ABOVE = 50;
const GAP_BELOW = 36;
const RAIL_GAP = 14;

// Line icons on a 24px grid (stroke = currentColor), shared with the context menu.
const ICONS = {
  edit: (
    <>
      <path d="M4 20h4L19 9l-4-4L4 16z" />
      <path d="m13.5 6.5 4 4" />
    </>
  ),
  open: (
    <>
      <path d="M14 4h6v6M20 4l-8 8" />
      <path d="M18 14v4a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4" />
    </>
  ),
  style: (
    <>
      <path d="M12 3a9 9 0 1 0 0 18c1.2 0 1.6-.8 1.6-1.6 0-.9-.7-1.3-.7-2.1 0-.9.8-1.6 1.7-1.6H17a4 4 0 0 0 4-4c0-4.9-4-8.7-9-8.7z" />
      <circle cx="7.5" cy="11" r="1.1" />
      <circle cx="10" cy="7" r="1.1" />
      <circle cx="15" cy="7.5" r="1.1" />
    </>
  ),
  heart: <path d="M12 20s-7-4.4-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 10c0 5.6-7 10-7 10z" />,
  copy: (
    <>
      <rect x="8" y="8" width="12" height="12" rx="2.5" />
      <path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2" />
    </>
  ),
  front: (
    <>
      <rect x="4" y="4" width="11" height="11" rx="2" />
      <rect x="9" y="9" width="11" height="11" rx="2" className="fill" />
    </>
  ),
  back: (
    <>
      <rect x="9" y="9" width="11" height="11" rx="2" />
      <rect x="4" y="4" width="11" height="11" rx="2" className="fill" />
    </>
  ),
  lock: (
    <>
      <rect x="5" y="11" width="14" height="9" rx="2" />
      <path d="M8 11V8a4 4 0 0 1 8 0v3" />
    </>
  ),
  unlock: (
    <>
      <rect x="5" y="11" width="14" height="9" rx="2" />
      <path d="M8 11V8a4 4 0 0 1 7.6-1.8" />
    </>
  ),
  delete: (
    <>
      <path d="M4 7h16M10 11v6M14 11v6" />
      <path d="M6 7l1 12a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-12M9 7V4h6v3" />
    </>
  ),
  align: (
    <>
      <path d="M4 4v16" />
      <rect x="7" y="6" width="12" height="4" rx="1.5" />
      <rect x="7" y="14" width="7" height="4" rx="1.5" />
    </>
  ),
  section: (
    <>
      <path d="M4 9V6a2 2 0 0 1 2-2h3M15 4h3a2 2 0 0 1 2 2v3M20 15v3a2 2 0 0 1-2 2h-3M9 20H6a2 2 0 0 1-2-2v-3" />
      <path d="M8 9h5" />
    </>
  ),
  note: (
    <>
      <path d="M5 4h14v11l-5 5H5z" />
      <path d="M19 15h-5v5" />
    </>
  ),
  todo: (
    <>
      <rect x="4" y="5" width="5" height="5" rx="1.2" />
      <path d="m5.3 7.5 1.2 1.2 2-2.2M12 7.5h8M4 14h5v5H4zM12 16.5h8" />
    </>
  ),
  image: (
    <>
      <rect x="3" y="4" width="18" height="16" rx="3" />
      <circle cx="9" cy="10" r="2" />
      <path d="m21 16-5-5-9 9" />
    </>
  ),
  imageAdd: (
    <>
      <path d="M13 4H6a3 3 0 0 0-3 3v10a3 3 0 0 0 3 3h12a3 3 0 0 0 3-3v-6" />
      <path d="m21 17-5-5-9 8M18 2v6M15 5h6" />
    </>
  ),
  crop: (
    <>
      <path d="M6 2v14a2 2 0 0 0 2 2h14" />
      <path d="M18 22V8a2 2 0 0 0-2-2H2" />
    </>
  ),
  'align-left': <path d="M4 4v16M8 7h11M8 12h7M8 17h9" />,
  'align-hcenter': <path d="M12 4v16M6 7h12M8 12h8M5 17h14" />,
  'align-right': <path d="M20 4v16M5 7h11M9 12h7M7 17h9" />,
  'align-top': <path d="M4 4h16M7 8v11M12 8v7M17 8v9" />,
  'align-vcenter': <path d="M4 12h16M7 6v12M12 8v8M17 5v14" />,
  'align-bottom': <path d="M4 20h16M7 5v11M12 9v7M17 7v9" />,
  hspace: <path d="M4 4v16M20 4v16M9 8h6v8H9z" />,
  vspace: <path d="M4 4h16M4 20h16M8 9h8v6H8z" />,
};

export function ActionIcon({ name }) {
  return (
    <svg viewBox="0 0 24 24" className="act-ic" aria-hidden="true">
      {ICONS[name] || null}
    </svg>
  );
}

const IconButton = ({ icon, label, onClick, pressed, danger, disabled, className = '' }) => (
  <button
    type="button"
    className={`ib ${danger ? 'danger' : ''} ${className}`}
    aria-label={label}
    title={label}
    aria-pressed={pressed}
    disabled={disabled}
    onClick={onClick}
  >
    <ActionIcon name={icon} />
  </button>
);

const ALIGNS = [
  ['left', '左对齐', 'align-left'],
  ['hcenter', '水平居中', 'align-hcenter'],
  ['right', '右对齐', 'align-right'],
  ['top', '顶端对齐', 'align-top'],
  ['vcenter', '垂直居中', 'align-vcenter'],
  ['bottom', '底端对齐', 'align-bottom'],
  ['hspace', '水平等距', 'hspace'],
  ['vspace', '垂直等距', 'vspace'],
];
const COLORABLE = ['note', 'todo', 'section'];
const OPEN_LABEL = {
  place: '在地图查看',
  places: '在地图查看',
  activity: '在行程中查看',
  day: '在行程中查看',
  route: '在行程中查看',
  expense: '打开账本',
};

/**
 * Menus for the selection, shown once the selection is clicked again (or from
 * the right-click menu): what the object does and looks like on a bar above
 * it, how it sits on the board (layer, copy, lock, delete) on a rail at its
 * side. `rect` is the selection's screen rect inside the stage.
 */
export function BoardActions({
  items,
  rect,
  stage,
  topSafe = 76,
  hidden = false,
  onColor,
  onStyle,
  onGalleryAdd,
  onEdit,
  onFront,
  onBack,
  onDuplicate,
  onToggleLock,
  onDelete,
  onAlign,
  onWrapSection,
  onSaveSticker,
  onSchedulePlace,
  onOpenTarget,
}) {
  const barRef = useRef(null);
  const railRef = useRef(null);
  const [pos, setPos] = useState(null);
  const [pop, setPop] = useState(null); // 'color' | 'style' | 'align'

  useLayoutEffect(() => {
    if (!rect) return;
    const bar = barRef.current;
    const rail = railRef.current;
    const bw = bar?.offsetWidth || 0;
    const bh = bar?.offsetHeight || 0;
    const above = rect.y - GAP_ABOVE - bh;
    const barBelow = above < topSafe;
    const top = barBelow ? Math.min(rect.y + rect.h + GAP_BELOW, stage.h - bh - 96) : above;
    const cx = rect.x + rect.w / 2;
    const left = Math.min(stage.w - 8 - bw, Math.max(8, cx - bw / 2));
    const rw = rail?.offsetWidth || 0;
    const rh = rail?.offsetHeight || 0;
    const right = rect.x + rect.w + RAIL_GAP;
    const railLeft = right + rw <= stage.w - 8 ? right : Math.max(8, rect.x - RAIL_GAP - rw);
    const railTop = Math.max(topSafe, Math.min(stage.h - rh - 96, rect.y + rect.h / 2 - rh / 2));
    const next = { left, top, h: bh, barBelow, railLeft, railTop };
    setPos((p) => (p && Object.keys(next).every((k) => p[k] === next[k]) ? p : next));
  });

  if (!items?.length) return null;

  const multi = items.length > 1;
  const one = multi ? null : items[0];
  const type = one?.content?.type;
  const kind = one?.content?.kind;
  const locked = items.every((it) => Boolean(it.style?.locked ?? it.locked));
  const colorable = !locked && items.every((it) => COLORABLE.includes(it.content?.type));
  const currentColor = colorable ? noteColor(items[0].style?.color || 'yellow') : null;
  const variants = one && !locked ? variantsFor(one) : null;
  const frames =
    one && !locked
      ? type === 'image'
        ? IMAGE_FRAMES
        : type === 'gallery'
          ? IMAGE_FRAMES.filter(([id]) => ['none', 'polaroid', 'card', 'tape'].includes(id))
          : null
      : null;
  const style = one?.style || {};
  const toggle = (name) => setPop((p) => (p === name ? null : name));

  // ---- Bar: what it does, then how it looks ----
  const doing = [];
  if (one && type === 'widget' && kind === 'place' && !one.linkedActivityId && !locked)
    doing.push(
      <button
        key="schedule"
        type="button"
        className="primary text"
        onClick={() => onSchedulePlace(one)}
      >
        加入行程
      </button>,
    );
  if (one && type === 'widget' && OPEN_LABEL[kind])
    doing.push(
      <IconButton
        key="open"
        icon="open"
        label={OPEN_LABEL[kind]}
        onClick={() => onOpenTarget(one)}
      />,
    );
  if (one && !locked) {
    if (['note', 'text', 'todo', 'section'].includes(type))
      doing.push(
        <IconButton
          key="edit"
          icon="edit"
          label={type === 'todo' ? '编辑清单' : type === 'section' ? '重命名分区' : '编辑文字'}
          onClick={onEdit}
        />,
      );
    if (type === 'gallery') {
      doing.push(<IconButton key="add" icon="imageAdd" label="添加图片" onClick={onGalleryAdd} />);
      doing.push(<IconButton key="crop" icon="crop" label="调整显示" onClick={onEdit} />);
    }
  }
  if (one && type === 'image' && one.content.assetId)
    doing.push(
      <IconButton
        key="fav"
        icon="heart"
        label="收藏到我的表情"
        onClick={() => onSaveSticker(one)}
      />,
    );

  const looks = [];
  if (colorable)
    looks.push(
      <button
        key="color"
        type="button"
        className="ib color-btn"
        aria-label={`颜色：${NOTE_NAMES[currentColor]}`}
        title="颜色"
        aria-expanded={pop === 'color'}
        onClick={() => toggle('color')}
      >
        <span className="dot" style={{ background: NOTE[currentColor] }} />
      </button>,
    );
  if (variants || frames)
    looks.push(
      <IconButton
        key="style"
        icon="style"
        label="样式"
        pressed={pop === 'style'}
        onClick={() => toggle('style')}
      />,
    );
  if (multi && !locked) {
    looks.push(
      <IconButton
        key="align"
        icon="align"
        label="对齐与分布"
        pressed={pop === 'align'}
        onClick={() => toggle('align')}
      />,
    );
    if (!items.some((it) => it.content?.type === 'section'))
      looks.push(<IconButton key="wrap" icon="section" label="框进分区" onClick={onWrapSection} />);
  }
  const showBar = multi || locked || doing.length > 0 || looks.length > 0;

  const popStyle = pos
    ? pos.barBelow
      ? { left: pos.left, top: pos.top + pos.h + 6 }
      : { left: pos.left, top: pos.top - 6, transform: 'translateY(-100%)' }
    : { left: -9999, top: -9999 };

  return (
    <>
      {pop && showBar && (
        <div
          className={`style-pop ui glass ${hidden ? 'is-hidden' : ''}`}
          role="group"
          aria-label={pop === 'color' ? '颜色' : pop === 'align' ? '对齐与分布' : '样式'}
          style={popStyle}
        >
          {pop === 'color' &&
            Object.keys(NOTE).map((id) => (
              <button
                key={id}
                type="button"
                className="sw"
                style={{ backgroundColor: NOTE[id] }}
                aria-pressed={currentColor === id}
                onClick={() => onColor(id)}
                title={NOTE_NAMES[id]}
                aria-label={`颜色：${NOTE_NAMES[id]}`}
              />
            ))}
          {pop === 'style' &&
            variants?.map(([id, name]) => (
              <button
                key={id}
                type="button"
                className={`style-chip v-${id}`}
                aria-pressed={(style.variant || 'plain') === id}
                onClick={() => onStyle({ variant: id })}
              >
                {name}
              </button>
            ))}
          {pop === 'style' &&
            frames?.map(([id, name]) => (
              <button
                key={id}
                type="button"
                className={`style-chip f-${id}`}
                aria-pressed={(style.frameStyle || 'none') === id}
                onClick={() => onStyle({ frameStyle: id })}
              >
                {name}
              </button>
            ))}
          {pop === 'align' &&
            ALIGNS.map(([mode, label, icon]) => (
              <IconButton
                key={mode}
                icon={icon}
                label={label}
                disabled={(mode === 'hspace' || mode === 'vspace') && items.length < 3}
                onClick={() => onAlign(mode)}
              />
            ))}
        </div>
      )}

      {showBar && (
        <div
          id="actions"
          ref={barRef}
          className={`ui glass on ${hidden ? 'is-hidden' : ''}`}
          aria-hidden={hidden || undefined}
          role="toolbar"
          aria-label={multi ? `已选 ${items.length} 项` : '所选对象'}
          style={pos ? { left: pos.left, top: pos.top } : { left: -9999, top: -9999 }}
        >
          {multi && <span className="sel-count">{items.length} 项</span>}
          {doing}
          {doing.length > 0 && looks.length > 0 && <span className="sep" aria-hidden="true" />}
          {looks}
          {locked && <span className="sel-count">已锁定</span>}
        </div>
      )}

      <div
        id="arrange"
        ref={railRef}
        className={`ui glass ${hidden ? 'is-hidden' : ''}`}
        aria-hidden={hidden || undefined}
        role="toolbar"
        aria-orientation="vertical"
        aria-label="排列"
        style={pos ? { left: pos.railLeft, top: pos.railTop } : { left: -9999, top: -9999 }}
      >
        <IconButton icon="front" label="置于顶层" onClick={onFront} />
        <IconButton icon="back" label="置于底层" onClick={onBack} />
        <IconButton icon="copy" label="复制一份" onClick={onDuplicate} />
        <IconButton
          icon={locked ? 'unlock' : 'lock'}
          label={locked ? '解锁' : '锁定'}
          pressed={locked}
          onClick={onToggleLock}
        />
        <span className="sep" aria-hidden="true" />
        <IconButton icon="delete" label="删除" danger onClick={onDelete} />
      </div>
    </>
  );
}
