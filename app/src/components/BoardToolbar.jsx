import React from 'react';

const PEN_COLORS = [
  { id: 'default', color: 'var(--text)' },
  { id: 'accent', color: 'var(--brand, #059669)' },
  { id: 'red', color: '#dc2626' },
  { id: 'orange', color: '#ea580c' },
  { id: 'blue', color: '#2563eb' },
  { id: 'purple', color: '#9333ea' },
];

const PEN_SIZES = [2, 4, 8];

const HL_COLORS = [
  { id: 'yellow', color: '#fef08a' },
  { id: 'green', color: '#bbf7d0' },
  { id: 'blue', color: '#bfdbfe' },
  { id: 'pink', color: '#fbcfe8' },
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
}) {
  const showOptions = activeTool === 'pen' || activeTool === 'highlighter';

  return (
    <>
      {showOptions && (
        <div id="options" className="ui glass">
          {activeTool === 'pen' && (
            <>
              {PEN_COLORS.map((c) => (
                <button
                  key={c.id}
                  className="sw"
                  style={{ backgroundColor: c.color }}
                  aria-pressed={penColor === c.id}
                  onClick={() => onChangePenColor(c.id)}
                  title={`画笔颜色：${c.id}`}
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
                >
                  <i style={{ width: sz * 1.5, height: sz * 1.5 }} />
                </button>
              ))}
            </>
          )}

          {activeTool === 'highlighter' && (
            <>
              {HL_COLORS.map((c) => (
                <button
                  key={c.id}
                  className="sw"
                  style={{ backgroundColor: c.color }}
                  aria-pressed={hlColor === c.id}
                  onClick={() => onChangeHlColor(c.id)}
                  title={`荧光笔颜色：${c.id}`}
                />
              ))}
            </>
          )}
        </div>
      )}

      <div id="toolbar" className="ui glass" role="toolbar" aria-label="白板工具">
        <button
          className="tool"
          data-tool="select"
          aria-pressed={activeTool === 'select'}
          onClick={() => onSelectTool('select')}
          title="选择 (V)"
          aria-label="选择"
        >
          <svg viewBox="0 0 24 24">
            <path d="m5 3 14 8-6 2-2 6z" />
          </svg>
        </button>

        <button
          className="tool"
          data-tool="sticker"
          aria-pressed={panelOpen}
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
          data-tool="text"
          aria-pressed={activeTool === 'text'}
          onClick={() => onSelectTool('text')}
          title="文字 (T)"
          aria-label="文字"
        >
          <svg viewBox="0 0 24 24">
            <path d="M5 6V4h14v2M12 4v16M9 20h6" />
          </svg>
        </button>

        <button
          className="tool"
          data-tool="pen"
          aria-pressed={activeTool === 'pen'}
          onClick={() => onSelectTool('pen')}
          title="画笔 (P)"
          aria-label="画笔"
        >
          <svg viewBox="0 0 24 24">
            <path d="M4 20l1-4L16 5l3 3L8 19z" />
            <path d="m14 7 3 3" />
          </svg>
        </button>

        <button
          className="tool"
          data-tool="highlighter"
          aria-pressed={activeTool === 'highlighter'}
          onClick={() => onSelectTool('highlighter')}
          title="荧光笔 (H)"
          aria-label="荧光笔"
        >
          <svg viewBox="0 0 24 24">
            <path d="m9 14 7-9 4 3-7 9z" />
            <path d="m9 14-2 4 4 1 2-2M4 21h9" />
          </svg>
        </button>

        <button
          className="tool"
          data-tool="eraser"
          aria-pressed={activeTool === 'eraser'}
          onClick={() => onSelectTool('eraser')}
          title="橡皮 (E)，整笔擦除"
          aria-label="橡皮"
        >
          <svg viewBox="0 0 24 24">
            <path d="m4 15 9-9 7 7-6 6H8z" />
            <path d="M9 10l7 7M8 19h12" />
          </svg>
        </button>
      </div>
    </>
  );
}
