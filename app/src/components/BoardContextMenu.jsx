import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { ActionIcon } from './BoardActions.jsx';

/**
 * Right-click menu for the board: at the pointer, with keyboard shortcuts
 * shown on the right. Items: { label, icon, shortcut, onClick, danger,
 * disabled, divider, children }.
 */
export function BoardContextMenu({ x, y, items, onClose, fixed = false, label = '对象菜单' }) {
  const ref = useRef(null);
  const [pos, setPos] = useState({ left: x, top: y });
  const [sub, setSub] = useState(null); // index of the open submenu

  useLayoutEffect(() => {
    const el = ref.current;
    const parent = fixed ? null : el?.offsetParent;
    if (!el || (!fixed && !parent)) return;
    // `fixed`: x/y are viewport coordinates (menus opened from panels).
    const pw = fixed ? window.innerWidth : parent.clientWidth;
    const ph = fixed ? window.innerHeight : parent.clientHeight;
    setPos({
      left: Math.max(8, Math.min(x, pw - el.offsetWidth - 8)),
      top: Math.max(8, Math.min(y, ph - el.offsetHeight - 8)),
    });
    // Focus the menu itself, not its first item: opened with the mouse, a ring
    // on the first item next to the hover highlight read as two selections.
    el.focus({ preventScroll: true });
  }, [x, y]);

  useEffect(() => {
    const close = (e) => {
      if (ref.current?.contains(e.target)) return;
      onClose();
    };
    const onKey = (e) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
        return;
      }
      if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
      e.preventDefault();
      const list = [...(ref.current?.querySelectorAll('[role="menuitem"]:not([disabled])') || [])];
      const i = list.indexOf(document.activeElement);
      const next =
        i < 0
          ? list[e.key === 'ArrowDown' ? 0 : list.length - 1]
          : list[(i + (e.key === 'ArrowDown' ? 1 : list.length - 1)) % list.length];
      next?.focus();
    };
    window.addEventListener('pointerdown', close, true);
    window.addEventListener('keydown', onKey, true);
    window.addEventListener('wheel', onClose, { passive: true });
    window.addEventListener('blur', onClose);
    return () => {
      window.removeEventListener('pointerdown', close, true);
      window.removeEventListener('keydown', onKey, true);
      window.removeEventListener('wheel', onClose);
      window.removeEventListener('blur', onClose);
    };
  }, [onClose]);

  const run = (item) => {
    if (item.disabled) return;
    onClose();
    item.onClick?.();
  };

  const renderItems = (list, nested = false) =>
    list.map((item, i) =>
      item.divider ? (
        <div key={`d${i}`} className="cm-sep" role="separator" />
      ) : (
        <div
          key={item.label}
          className="cm-row"
          onPointerEnter={(e) => {
            if (!nested) setSub(item.children ? i : null);
            // One highlight: the item under the pointer is also the focused one.
            e.currentTarget.querySelector('[role="menuitem"]:not([disabled])')?.focus({
              preventScroll: true,
            });
          }}
          onPointerMove={(e) => {
            const btn = e.currentTarget.querySelector('[role="menuitem"]:not([disabled])');
            if (btn && document.activeElement !== btn) btn.focus({ preventScroll: true });
          }}
        >
          <button
            type="button"
            role="menuitem"
            className={`cm-item ${item.danger ? 'danger' : ''}`}
            disabled={item.disabled}
            aria-haspopup={item.children ? 'menu' : undefined}
            aria-expanded={item.children ? sub === i : undefined}
            onClick={() => (item.children ? setSub(sub === i ? null : i) : run(item))}
            onKeyDown={(e) => {
              if (item.children && e.key === 'ArrowRight') {
                e.preventDefault();
                setSub(i);
              }
            }}
          >
            <span className="cm-icon" aria-hidden="true">
              {item.icon && <ActionIcon name={item.icon} />}
            </span>
            <span className="cm-label">{item.label}</span>
            {item.shortcut && <kbd>{item.shortcut}</kbd>}
            {item.children && (
              <svg className="cm-more" viewBox="0 0 24 24" aria-hidden="true">
                <path d="m9 6 6 6-6 6" />
              </svg>
            )}
          </button>
          {item.children && sub === i && (
            <div className="cm-sub glass" role="menu" aria-label={item.label}>
              {renderItems(item.children, true)}
            </div>
          )}
        </div>
      ),
    );

  const menu = (
    <div
      ref={ref}
      className={`context-menu ui glass ${fixed ? 'is-fixed' : ''}`}
      tabIndex={-1}
      role="menu"
      aria-label={label}
      style={{ left: pos.left, top: pos.top }}
      onContextMenu={(e) => e.preventDefault()}
    >
      {renderItems(items)}
    </div>
  );
  // Inside a glass panel `position: fixed` would be relative to the panel.
  return fixed && typeof document !== 'undefined' ? createPortal(menu, document.body) : menu;
}
