import React, { useEffect, useRef, useState } from 'react';

/**
 * Top-left board switcher (问题 9). Lists the trip's boards, creates, renames
 * and deletes them, and holds the entry to "最近删除" that used to be a lone
 * trash icon people read as "clear the board".
 */
export function BoardSwitcher({
  boards,
  currentId,
  counts = {},
  startRenaming = false,
  onSwitch,
  onCreate,
  onRename,
  onDelete,
  onOpenDeletions,
  onOpenChange,
}) {
  const current = boards.find((b) => b.id === currentId) || boards[0];
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState(startRenaming ? 'rename' : 'list'); // list | rename | confirm-delete
  const [title, setTitle] = useState(current?.payload?.title || '');
  const rootRef = useRef(null);
  const inputRef = useRef(null);
  const buttonRef = useRef(null);

  useEffect(() => {
    if (startRenaming) {
      setOpen(true);
      setMode('rename');
      setTitle(current?.payload?.title || '');
    }
  }, [startRenaming]);

  useEffect(() => onOpenChange?.(open), [open]);

  useEffect(() => {
    if (!open) return undefined;
    const close = (e) => {
      if (!rootRef.current?.contains(e.target)) setOpen(false);
    };
    const onKey = (e) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        setOpen(false);
        buttonRef.current?.focus();
      }
    };
    window.addEventListener('pointerdown', close);
    window.addEventListener('keydown', onKey, true);
    return () => {
      window.removeEventListener('pointerdown', close);
      window.removeEventListener('keydown', onKey, true);
    };
  }, [open]);

  useEffect(() => {
    if (open && mode === 'rename') {
      inputRef.current?.focus();
      inputRef.current?.select();
    }
  }, [open, mode]);

  const toggle = () => {
    setMode('list');
    setOpen((v) => !v);
  };

  const submitRename = (e) => {
    e?.preventDefault();
    const next = title.trim().slice(0, 30);
    if (next && next !== current?.payload?.title) onRename?.(current, next);
    setMode('list');
    setOpen(false);
  };

  const currentCount = counts[current?.id];

  return (
    <div id="top-left" className="ui board-switcher" ref={rootRef}>
      <button
        ref={buttonRef}
        className="chip glass switcher-button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={`当前白板：${current?.payload?.title || '白板'}，切换或管理白板`}
        onClick={toggle}
      >
        <svg viewBox="0 0 24 24" aria-hidden="true" className="ic">
          <rect x="3" y="4" width="18" height="16" rx="3" />
          <path d="M3 9h18M9 9v11" />
        </svg>
        <span className="ellipsis">{current?.payload?.title || '白板'}</span>
        <svg viewBox="0 0 24 24" aria-hidden="true" className="ic caret">
          <path d="m6 9 6 6 6-6" />
        </svg>
      </button>

      {open && (
        <div className="switcher-menu glass" role="menu" aria-label="白板">
          {mode === 'rename' ? (
            <form className="rename-form" onSubmit={submitRename}>
              <label>
                <span>白板名称</span>
                <input
                  ref={inputRef}
                  value={title}
                  maxLength={30}
                  onChange={(e) => setTitle(e.target.value)}
                  onKeyDown={(e) => e.stopPropagation()}
                />
              </label>
              <div className="row-actions">
                <button type="button" onClick={() => setMode('list')}>
                  取消
                </button>
                <button type="submit" className="primary" disabled={!title.trim()}>
                  保存
                </button>
              </div>
            </form>
          ) : mode === 'confirm-delete' ? (
            <div className="confirm-delete" role="alertdialog" aria-label="删除白板">
              <p>
                删除「{current?.payload?.title}」？
                <br />
                <small>
                  {currentCount
                    ? `白板上的 ${currentCount} 个对象会一起移到最近删除，可以随白板一起恢复。`
                    : '可以在「最近删除」中恢复。'}
                </small>
              </p>
              <div className="row-actions">
                <button type="button" onClick={() => setMode('list')}>
                  取消
                </button>
                <button
                  type="button"
                  className="danger-fill"
                  onClick={() => {
                    setOpen(false);
                    onDelete?.(current);
                  }}
                >
                  删除
                </button>
              </div>
            </div>
          ) : (
            <>
              {boards.map((b) => (
                <button
                  key={b.id}
                  role="menuitemradio"
                  aria-checked={b.id === current?.id}
                  className="board-row"
                  onClick={() => {
                    setOpen(false);
                    if (b.id !== current?.id) onSwitch?.(b.id);
                  }}
                >
                  <span className="check" aria-hidden="true">
                    {b.id === current?.id ? '✓' : ''}
                  </span>
                  <span className="ellipsis">{b.payload?.title || '白板'}</span>
                  {counts[b.id] != null && <small>{counts[b.id]} 项</small>}
                </button>
              ))}
              <div className="menu-sep" role="separator" />
              <button role="menuitem" onClick={() => onCreate?.()}>
                ＋ 新建白板
              </button>
              <button
                role="menuitem"
                onClick={() => {
                  setTitle(current?.payload?.title || '');
                  setMode('rename');
                }}
              >
                ✎ 重命名当前白板
              </button>
              <button
                role="menuitem"
                onClick={() => {
                  setOpen(false);
                  onOpenDeletions?.();
                }}
              >
                🗂 最近删除…
              </button>
              <button
                role="menuitem"
                className="danger"
                disabled={boards.length <= 1}
                title={boards.length <= 1 ? '至少保留一块白板' : ''}
                onClick={() => setMode('confirm-delete')}
              >
                🗑 删除当前白板
              </button>
            </>
          )}
        </div>
      )}
    </div>
  );
}
