import React, { useLayoutEffect, useRef, useState } from 'react';
import { PEN, PEN_NAMES, HL, HL_NAMES } from '../board.js';

const PEN_SIZES = [2, 4, 8];

const TOOLS = [
  {
    id: 'select',
    label: '选择',
    key: 'V',
    icon: <path d="m5 3 14 8-6 2-2 6z" />,
  },
  {
    id: 'marquee',
    label: '框选',
    key: 'M',
    hint: '拖出方框选中多个对象',
    icon: (
      <>
        <path d="M4 8V5a1 1 0 0 1 1-1h3M16 4h3a1 1 0 0 1 1 1v3M20 16v3a1 1 0 0 1-1 1h-3M8 20H5a1 1 0 0 1-1-1v-3" />
        <path d="M11 4h2M11 20h2M4 11v2M20 11v2" />
      </>
    ),
  },
  {
    id: 'text',
    label: '文字',
    key: 'T',
    icon: <path d="M5 6V4h14v2M12 4v16M9 20h6" />,
  },
  {
    id: 'pen',
    label: '画笔',
    key: 'P',
    icon: (
      <>
        <path d="M4 20l1-4L16 5l3 3L8 19z" />
        <path d="m14 7 3 3" />
      </>
    ),
  },
  {
    id: 'highlighter',
    label: '荧光笔',
    key: 'H',
    icon: (
      <>
        <path d="m9 14 7-9 4 3-7 9z" />
        <path d="m9 14-2 4 4 1 2-2M4 21h9" />
      </>
    ),
  },
  {
    id: 'eraser',
    label: '橡皮',
    key: 'E',
    hint: '整笔擦除',
    icon: (
      <>
        <path d="m4 15 9-9 7 7-6 6H8z" />
        <path d="M9 10l7 7M8 19h12" />
      </>
    ),
  },
];

export function BoardToolbar({
  activeTool,
  onSelectTool,
  penColor,
  penSize,
  onChangePenColor,
  onChangePenSize,
  hlColor,
  onChangeHlColor,
  panelOpen,
  onTogglePanel,
  onPickImages,
  canUndo,
  canRedo,
  onUndo,
  onRedo,
  hidden = false,
}) {
  const showOptions = activeTool === 'pen' || activeTool === 'highlighter';
  const toolRefs = useRef({});
  const wrapRef = useRef(null);
  const optionsRef = useRef(null);
  const [optionsLeft, setOptionsLeft] = useState(null);

  // Anchor the color/size bubble above the tool it belongs to, clamped so it
  // stays on screen (问题 6).
  useLayoutEffect(() => {
    if (!showOptions) return;
    const btn = toolRefs.current[activeTool];
    const wrap = wrapRef.current;
    const opts = optionsRef.current;
    if (!btn || !wrap || !opts) return;
    const wrapRect = wrap.getBoundingClientRect();
    const btnRect = btn.getBoundingClientRect();
    const half = opts.offsetWidth / 2;
    const centerX = btnRect.left + btnRect.width / 2;
    const clamped = Math.min(window.innerWidth - 8 - half, Math.max(8 + half, centerX));
    setOptionsLeft(clamped - wrapRect.left);
  }, [showOptions, activeTool, penColor, hlColor, penSize]);

  const dotColor = (id) =>
    id === 'pen' ? PEN[penColor] : id === 'highlighter' ? HL[hlColor] : null;

  return (
    <div id="toolbar-wrap" className={`ui ${hidden ? 'is-hidden' : ''}`} ref={wrapRef}>
      {showOptions && (
        <div
          id="options"
          className="glass"
          ref={optionsRef}
          role="group"
          aria-label={activeTool === 'pen' ? '画笔选项' : '荧光笔选项'}
          style={optionsLeft == null ? { visibility: 'hidden' } : { left: optionsLeft }}
        >
          {activeTool === 'pen' && (
            <>
              {Object.keys(PEN).map((id) => (
                <button
                  key={id}
                  className="sw"
                  style={{ backgroundColor: PEN[id] }}
                  aria-pressed={penColor === id}
                  onClick={() => onChangePenColor(id)}
                  title={`画笔颜色：${PEN_NAMES[id]}`}
                  aria-label={`画笔颜色：${PEN_NAMES[id]}`}
                />
              ))}
              <div className="sep" />
              {PEN_SIZES.map((sz) => (
                <button
                  key={sz}
                  className="sz"
                  aria-pressed={penSize === sz}
                  onClick={() => onChangePenSize(sz)}
                  title={`粗细：${sz}px`}
                  aria-label={`粗细 ${sz} 像素`}
                >
                  <i style={{ width: sz * 1.5, height: sz * 1.5 }} />
                </button>
              ))}
            </>
          )}
          {activeTool === 'highlighter' &&
            Object.keys(HL).map((id) => (
              <button
                key={id}
                className="sw"
                style={{ backgroundColor: HL[id] }}
                aria-pressed={hlColor === id}
                onClick={() => onChangeHlColor(id)}
                title={`荧光笔颜色：${HL_NAMES[id]}`}
                aria-label={`荧光笔颜色：${HL_NAMES[id]}`}
              />
            ))}
        </div>
      )}

      <div id="toolbar" className="glass" role="toolbar" aria-label="白板工具">
        <button
          className="tool"
          onClick={onUndo}
          disabled={!canUndo}
          title="撤销 (⌘Z)"
          aria-label="撤销"
        >
          <svg viewBox="0 0 24 24">
            <path d="M9 14 4 9l5-5" />
            <path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H11" />
          </svg>
        </button>
        <button
          className="tool"
          onClick={onRedo}
          disabled={!canRedo}
          title="重做 (⇧⌘Z)"
          aria-label="重做"
        >
          <svg viewBox="0 0 24 24">
            <path d="m15 14 5-5-5-5" />
            <path d="M20 9H9.5a5.5 5.5 0 0 0 0 11H13" />
          </svg>
        </button>
        <div className="sep" />
        {TOOLS.map((t) => (
          <button
            key={t.id}
            ref={(el) => (toolRefs.current[t.id] = el)}
            className="tool"
            data-tool={t.id}
            aria-pressed={activeTool === t.id}
            onClick={() => onSelectTool(t.id)}
            title={`${t.label} (${t.key})${t.hint ? `，${t.hint}` : ''}`}
            aria-label={t.label}
          >
            <svg viewBox="0 0 24 24">{t.icon}</svg>
            {dotColor(t.id) && <span className="tool-dot" style={{ background: dotColor(t.id) }} />}
          </button>
        ))}
        <div className="sep" />
        <button
          className={`tool sticker-btn ${panelOpen ? 'is-open' : ''}`}
          data-tool="sticker"
          aria-expanded={panelOpen}
          aria-controls="panel"
          onClick={onTogglePanel}
          title="贴纸与小组件 (S)"
          aria-label="贴纸与小组件"
        >
          <svg viewBox="0 0 24 24">
            <path d="M4 4h16v10l-6 6H4z" />
            <path d="M20 14h-6v6" />
          </svg>
        </button>
        <button
          className="tool"
          data-tool="image"
          onClick={onPickImages}
          title="上传图片 (I)，也可以直接拖入或粘贴"
          aria-label="上传图片"
        >
          <svg viewBox="0 0 24 24">
            <rect x="3" y="4" width="18" height="16" rx="3" />
            <circle cx="9" cy="10" r="2" />
            <path d="m21 16-5-5-9 9" />
          </svg>
        </button>
      </div>
    </div>
  );
}
