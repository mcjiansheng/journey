import React, {
  createContext,
  useContext,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from 'react';
import { NOTE, NOTE_NAMES, noteColor, IMAGE_FRAMES, variantsFor } from '../board.js';

// Above the selection the bar clears the rotation handle; below it, the size label.
const GAP_ABOVE = 58;
const GAP_BELOW = 36;
const RAIL_GAP = 26;

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
  // 复制一份: a sheet with a plus, not two stacked squares (those read as layers).
  copy: (
    <>
      <rect x="4" y="7" width="13" height="13" rx="2.5" />
      <path d="M8 4h9.5A2.5 2.5 0 0 1 20 6.5V16M10.5 10.5v6M7.5 13.5h6" />
    </>
  ),
  // 置于顶层 / 置于底层: an arrow to a bar, up or down.
  front: (
    <>
      <path d="M5 4.5h14" />
      <path d="M12 20V9M7.5 13 12 8.5l4.5 4.5" />
    </>
  ),
  back: (
    <>
      <path d="M5 19.5h14" />
      <path d="M12 4v11M7.5 11 12 15.5l4.5-4.5" />
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

// Hover names: shown quickly beside the button, away from the object.
const TipContext = createContext(null);

const IconButton = ({
  icon,
  label,
  shortcut,
  onClick,
  pressed,
  danger,
  disabled,
  className = '',
  side,
}) => {
  const tip = useContext(TipContext);
  const show = (e) => side && tip?.show(e.currentTarget, label, side, shortcut);
  return (
    <button
      type="button"
      className={`ib ${danger ? 'danger' : ''} ${className}`}
      aria-label={label}
      aria-pressed={pressed}
      disabled={disabled}
      onClick={(e) => {
        tip?.hide();
        onClick?.(e);
      }}
      onPointerEnter={show}
      onPointerLeave={() => tip?.hide()}
      onFocus={(e) => e.currentTarget.matches(':focus-visible') && show(e)}
      onBlur={() => tip?.hide()}
    >
      <ActionIcon name={icon} />
    </button>
  );
};

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
  const popRef = useRef(null);
  const [pos, setPos] = useState(null);
  const [pop, setPop] = useState(null); // 'color' | 'style' | 'align'
  const [tipState, setTipState] = useState(null); // { label, x, y, side }
  const tipTimer = useRef(0);
  const tipApi = useRef(null);
  tipApi.current ||= {
    show: (el, label, side = 'bottom', shortcut = '') => {
      clearTimeout(tipTimer.current);
      tipTimer.current = setTimeout(() => {
        const box = el.getBoundingClientRect();
        const origin = (railRef.current || barRef.current)?.offsetParent?.getBoundingClientRect();
        if (!origin) return;
        let s = side;
        if (s === 'right' && box.right + 120 > origin.right) s = 'left';
        else if (s === 'left' && box.left - 120 < origin.left) s = 'right';
        setTipState({
          label,
          shortcut,
          side: s,
          x:
            (s === 'left' ? box.left : s === 'right' ? box.right : box.left + box.width / 2) -
            origin.left,
          y:
            (s === 'top' ? box.top : s === 'bottom' ? box.bottom : box.top + box.height / 2) -
            origin.top,
        });
      }, 120);
    },
    hide: () => {
      clearTimeout(tipTimer.current);
      setTipState(null);
    },
  };
  useEffect(() => () => clearTimeout(tipTimer.current), []);
  useEffect(() => {
    if (hidden) tipApi.current.hide();
  }, [hidden]);

  // Place the bar, its pop-up and the rail so none of them cover another or
  // the object's handles: bar above (or below), pop-up beyond the bar, rail
  // beside the object, moved along its side (or to the other side) when the
  // bar or pop-up reaches into its column.
  useLayoutEffect(() => {
    if (!rect) return;
    const originEl = (railRef.current || barRef.current)?.offsetParent;
    const origin = originEl?.getBoundingClientRect();
    const rel = (sel, root = originEl) => {
      const el = origin && root?.querySelector(sel);
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return r.width && r.height
        ? { x: r.left - origin.left, y: r.top - origin.top, w: r.width, h: r.height }
        : null;
    };
    const tb = rel('#toolbar');
    const zoomRect = rel('#zoom');
    const tlRect = rel('#top-left');
    const hrRect = typeof document !== 'undefined' ? rel('.header-right', document) : null;
    const bottomLimit = tb ? tb.y - 10 : stage.h - 96;

    const bw = barRef.current?.offsetWidth || 0;
    const bh = barRef.current?.offsetHeight || 0;
    const pw = popRef.current?.offsetWidth || 0;
    const ph = popRef.current?.offsetHeight || 0;
    const above = rect.y - GAP_ABOVE - bh;
    const aboveTop = pop && ph ? above - 8 - ph : above;
    const below = rect.y + rect.h + GAP_BELOW;
    const belowBottom = below + bh + (pop && ph ? 8 + ph : 0);
    const barBelow =
      above < topSafe
        ? below + bh <= bottomLimit || bottomLimit - (rect.y + rect.h) >= rect.y - topSafe
        : aboveTop < topSafe && belowBottom <= bottomLimit;
    const top = barBelow ? Math.min(below, bottomLimit - bh) : Math.max(topSafe, above);
    const cx = rect.x + rect.w / 2;
    const left = Math.min(stage.w - 8 - bw, Math.max(8, cx - bw / 2));
    let popLeft = Math.min(stage.w - 8 - pw, Math.max(8, left + bw / 2 - pw / 2));
    const popBelow = barBelow
      ? top + bh + 8 + ph <= stage.h - 8
      : top - 8 - ph < 8 && top + bh + 8 + ph <= bottomLimit;
    const popTop = pop && ph ? (popBelow ? top + bh + 8 : Math.max(8, top - 8 - ph)) : 0;
    if (pw && ph && popTop < topSafe) {
      if (
        hrRect &&
        popTop < hrRect.y + hrRect.h + 6 &&
        popLeft + pw > hrRect.x - 8 &&
        popLeft < hrRect.x + hrRect.w + 8
      ) {
        const cand = hrRect.x - 8 - pw;
        if (cand >= 8 && (!tlRect || cand >= tlRect.x + tlRect.w + 8)) popLeft = cand;
      }
      if (
        tlRect &&
        popTop < tlRect.y + tlRect.h + 6 &&
        popLeft < tlRect.x + tlRect.w + 8 &&
        popLeft + pw > tlRect.x - 8
      ) {
        const cand = tlRect.x + tlRect.w + 8;
        if (cand + pw <= stage.w - 8 && (!hrRect || cand + pw <= hrRect.x - 8)) popLeft = cand;
      }
    }
    const blocks = [];
    if (bw) blocks.push({ x: left, y: top, w: bw, h: bh });
    if (pw) blocks.push({ x: popLeft, y: popTop, w: pw, h: ph });

    const railBlocks = [...blocks];
    for (const b of [tb, zoomRect, tlRect, hrRect]) if (b) railBlocks.push(b);
    const rw = railRef.current?.offsetWidth || 0;
    const rh = railRef.current?.offsetHeight || 0;
    const minTop = topSafe;
    const maxTop = Math.max(minTop, bottomLimit - rh);
    const clampTop = (y) => Math.max(minTop, Math.min(maxTop, y));
    const hits = (r) =>
      railBlocks.some(
        (b) =>
          r.x < b.x + b.w + 6 && b.x < r.x + r.w + 6 && r.y < b.y + b.h + 6 && b.y < r.y + r.h + 6,
      );
    const sides = [];
    const rightX = rect.x + rect.w + RAIL_GAP;
    const leftX = rect.x - RAIL_GAP - rw;
    if (rightX + rw <= stage.w - 8) sides.push(['right', rightX]);
    if (leftX >= 8) sides.push(['left', leftX]);
    if (!sides.length) {
      const insideRight = Math.min(stage.w - 8 - rw, rect.x + rect.w - RAIL_GAP - rw);
      const insideLeft = Math.max(8, rect.x + RAIL_GAP);
      sides.push(['right', Math.max(8, insideRight)]);
      if (insideLeft + rw <= stage.w - 8) sides.push(['left', insideLeft]);
    }
    const idealY = rect.y + rect.h / 2 - rh / 2;
    let rail = null;
    for (const [side, x] of sides) {
      const y0 = clampTop(idealY);
      const cands = [y0];
      const col = railBlocks.filter((b) => x - 6 < b.x + b.w && b.x < x + rw + 6);
      for (const b of col) {
        cands.push(clampTop(b.y - 10 - rh), clampTop(b.y + b.h + 10));
      }
      const valid = cands
        .filter((y) => !hits({ x, y, w: rw, h: rh }))
        .sort((a, b) => Math.abs(a - idealY) - Math.abs(b - idealY));
      const candidate = valid.length
        ? { side, x, y: valid[0], ok: true, dist: Math.abs(valid[0] - idealY) }
        : { side, x, y: y0, ok: false, dist: Infinity };
      if (!rail || (candidate.ok && (!rail.ok || candidate.dist + 10 < rail.dist))) {
        rail = candidate;
      }
    }
    const next = {
      left,
      top,
      h: bh,
      barBelow,
      popLeft,
      popTop,
      railLeft: rail.x,
      railTop: rail.y,
      railSide: rail.side,
      // Nowhere free (a tiny object with the pop-up open): the rail steps aside.
      railAway: !rail.ok,
    };
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
  const toggle = (name) => {
    tipApi.current.hide();
    setPop((p) => (p === name ? null : name));
  };
  // Hover names go away from the object: above a bar that sits above it, etc.
  const barSide = pos?.barBelow ? 'bottom' : 'top';
  const railSide = pos?.railSide || 'right';

  const barTipSide = pop ? null : barSide;

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
        side={barTipSide}
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
          side={barTipSide}
          key="edit"
          icon="edit"
          label={type === 'todo' ? '编辑清单' : type === 'section' ? '重命名分区' : '编辑文字'}
          onClick={onEdit}
        />,
      );
    if (type === 'gallery') {
      doing.push(
        <IconButton
          side={barTipSide}
          key="add"
          icon="imageAdd"
          label="添加图片"
          onClick={onGalleryAdd}
        />,
      );
      doing.push(
        <IconButton side={barTipSide} key="crop" icon="crop" label="调整显示" onClick={onEdit} />,
      );
    }
  }
  if (one && type === 'image' && one.content.assetId)
    doing.push(
      <IconButton
        side={barTipSide}
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
        side={barTipSide}
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
        side={barTipSide}
        key="align"
        icon="align"
        label="对齐与分布"
        pressed={pop === 'align'}
        onClick={() => toggle('align')}
      />,
    );
    if (!items.some((it) => it.content?.type === 'section'))
      looks.push(
        <IconButton
          side={barTipSide}
          key="wrap"
          icon="section"
          label="框进分区"
          onClick={onWrapSection}
        />,
      );
  }
  const showBar = multi || locked || doing.length > 0 || looks.length > 0;

  const popStyle =
    pos?.popLeft != null ? { left: pos.popLeft, top: pos.popTop } : { left: -9999, top: -9999 };
  return (
    <TipContext.Provider value={tipApi.current}>
      {pop && showBar && (
        <div
          ref={popRef}
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
                side={barSide}
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
        className={`ui glass ${hidden || pos?.railAway ? 'is-hidden' : ''}`}
        aria-hidden={hidden || pos?.railAway || undefined}
        role="toolbar"
        aria-orientation="vertical"
        aria-label="排列"
        style={pos ? { left: pos.railLeft, top: pos.railTop } : { left: -9999, top: -9999 }}
      >
        <IconButton side={railSide} icon="front" label="置于顶层" shortcut="]" onClick={onFront} />
        <IconButton side={railSide} icon="back" label="置于底层" shortcut="[" onClick={onBack} />
        <IconButton
          side={railSide}
          icon="copy"
          label="复制一份"
          shortcut="⌘D"
          onClick={onDuplicate}
        />
        <IconButton
          side={railSide}
          icon={locked ? 'unlock' : 'lock'}
          label={locked ? '解锁' : '锁定'}
          pressed={locked}
          onClick={onToggleLock}
        />
        <span className="sep" aria-hidden="true" />
        <IconButton
          side={railSide}
          icon="delete"
          label="删除"
          shortcut="⌫"
          danger
          onClick={onDelete}
        />
      </div>

      {tipState && !hidden && (
        <div
          className={`act-tip ${tipState.side}`}
          role="tooltip"
          style={{ left: tipState.x, top: tipState.y }}
        >
          {tipState.label}
          {tipState.shortcut && <kbd>{tipState.shortcut}</kbd>}
        </div>
      )}
    </TipContext.Provider>
  );
}
