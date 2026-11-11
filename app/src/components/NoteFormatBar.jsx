import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { NOTE_TEXT_COLORS } from '../rich-text.js';

// foreColor writes <font color>; each palette entry gets a sentinel color that
// is swapped for <span data-color="id"> right after, so notes never store raw CSS.
const SENTINEL = Object.fromEntries(
  NOTE_TEXT_COLORS.map((c, i) => [c.id, `#0000${(i + 1).toString(16).padStart(2, '0')}`]),
);

function editorOf() {
  const sel = window.getSelection();
  const node = sel?.anchorNode;
  const el = node?.nodeType === 1 ? node : node?.parentElement;
  return el?.closest?.('.note-text[contenteditable="true"]') || null;
}

function replaceSentinels(editor) {
  for (const [id, hex] of Object.entries(SENTINEL)) {
    for (const font of editor.querySelectorAll(`font[color="${hex}"]`)) {
      const span = document.createElement('span');
      if (id !== 'ink') span.dataset.color = id;
      span.append(...font.childNodes);
      font.replaceWith(span);
    }
  }
}

const B = ({ label, active, onRun, children, className = '' }) => (
  <button
    type="button"
    className={`fmt ${className}`}
    aria-label={label}
    title={label}
    aria-pressed={active === undefined ? undefined : active}
    // Keep focus and selection inside the note.
    onPointerDown={(e) => {
      e.preventDefault();
      e.stopPropagation();
    }}
    onClick={onRun}
  >
    {children}
  </button>
);

/** Floating format bar for the note being edited (便签排版). */
export function NoteFormatBar({ rect, stage, fontSize = 'm', onFontSize }) {
  const ref = useRef(null);
  const [pos, setPos] = useState(null);
  const [state, setState] = useState({});
  const [colors, setColors] = useState(false);

  useEffect(() => {
    const read = () => {
      if (!editorOf()) return;
      const q = (c) => {
        try {
          return document.queryCommandState(c);
        } catch {
          return false;
        }
      };
      setState({
        bold: q('bold'),
        italic: q('italic'),
        underline: q('underline'),
        strike: q('strikeThrough'),
        ul: q('insertUnorderedList'),
        ol: q('insertOrderedList'),
        center: q('justifyCenter'),
        right: q('justifyRight'),
      });
    };
    document.addEventListener('selectionchange', read);
    read();
    return () => document.removeEventListener('selectionchange', read);
  }, []);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el || !rect) return;
    const bw = el.offsetWidth;
    const bh = el.offsetHeight;
    const above = rect.y - 10 - bh;
    const top = Math.max(
      8,
      above >= 70 ? above : Math.min(rect.y + rect.h + 10, stage.h - bh - 90),
    );
    // Never let the bar leave the screen on narrow boards; it wraps instead.
    const maxLeft = Math.max(8, stage.w - 8 - bw);
    const left = Math.min(maxLeft, Math.max(8, rect.x + rect.w / 2 - bw / 2));
    setPos((p) => (p && p.left === left && p.top === top ? p : { left, top }));
  });

  const run = (cmd, value) => {
    const editor = editorOf();
    if (!editor) return;
    try {
      document.execCommand('styleWithCSS', false, false);
      document.execCommand(cmd, false, value);
    } catch {}
    editor.dispatchEvent(new Event('input', { bubbles: true }));
  };

  const checklist = () => {
    const editor = editorOf();
    if (!editor) return;
    const node = window.getSelection()?.anchorNode;
    let ul = (node?.nodeType === 1 ? node : node?.parentElement)?.closest('ul');
    if (!ul || !editor.contains(ul)) {
      run('insertUnorderedList');
      const n2 = window.getSelection()?.anchorNode;
      ul = (n2?.nodeType === 1 ? n2 : n2?.parentElement)?.closest('ul');
      if (ul && editor.contains(ul)) ul.dataset.list = 'check';
    } else if (ul.dataset.list === 'check') {
      delete ul.dataset.list;
    } else {
      ul.dataset.list = 'check';
    }
    editor.dispatchEvent(new Event('input', { bubbles: true }));
  };

  const color = (id) => {
    const editor = editorOf();
    run('foreColor', SENTINEL[id]);
    if (editor) replaceSentinels(editor);
    setColors(false);
  };

  return (
    <div
      ref={ref}
      id="note-format"
      className="ui glass"
      role="toolbar"
      aria-label="便签文字格式"
      style={pos ? { left: pos.left, top: pos.top } : { left: -9999, top: -9999 }}
      onPointerDown={(e) => e.stopPropagation()}
    >
      <B label="粗体 (⌘B)" active={state.bold} onRun={() => run('bold')}>
        <b>B</b>
      </B>
      <B label="斜体 (⌘I)" active={state.italic} onRun={() => run('italic')}>
        <i>I</i>
      </B>
      <B label="下划线 (⌘U)" active={state.underline} onRun={() => run('underline')}>
        <u>U</u>
      </B>
      <B label="删除线" active={state.strike} onRun={() => run('strikeThrough')}>
        <s>S</s>
      </B>
      <span className="sep" />
      <B label="项目符号列表" active={state.ul} onRun={() => run('insertUnorderedList')}>
        <svg viewBox="0 0 24 24">
          <path d="M9 6h11M9 12h11M9 18h11" />
          <circle cx="4.5" cy="6" r="1.2" />
          <circle cx="4.5" cy="12" r="1.2" />
          <circle cx="4.5" cy="18" r="1.2" />
        </svg>
      </B>
      <B label="编号列表" active={state.ol} onRun={() => run('insertOrderedList')}>
        <svg viewBox="0 0 24 24">
          <path d="M10 6h10M10 12h10M10 18h10M4 5l1.5-1v5M3.5 13.5a1.5 1.5 0 1 1 2.6 1L3.5 17h3" />
        </svg>
      </B>
      <B label="勾选清单" onRun={checklist}>
        <svg viewBox="0 0 24 24">
          <rect x="3" y="4" width="6" height="6" rx="1.5" />
          <path d="m4.5 7 1.2 1.2L8 5.8M12 7h9M3 14h6v6H3zM12 17h9" />
        </svg>
      </B>
      <span className="sep" />
      <B label="左对齐" active={!state.center && !state.right} onRun={() => run('justifyLeft')}>
        <svg viewBox="0 0 24 24">
          <path d="M4 6h16M4 12h10M4 18h14" />
        </svg>
      </B>
      <B label="居中" active={state.center} onRun={() => run('justifyCenter')}>
        <svg viewBox="0 0 24 24">
          <path d="M4 6h16M7 12h10M5 18h14" />
        </svg>
      </B>
      <B label="右对齐" active={state.right} onRun={() => run('justifyRight')}>
        <svg viewBox="0 0 24 24">
          <path d="M4 6h16M10 12h10M6 18h14" />
        </svg>
      </B>
      <span className="sep" />
      {['s', 'm', 'l'].map((sz) => (
        <B
          key={sz}
          label={{ s: '小字', m: '中字', l: '大字' }[sz]}
          active={fontSize === sz}
          className={`fs-btn fs-${sz}`}
          onRun={() => onFontSize?.(sz)}
        >
          A
        </B>
      ))}
      <span className="sep" />
      <div className="fmt-colors">
        <B label="文字颜色" onRun={() => setColors((v) => !v)}>
          <span className="color-dot" />
        </B>
        {colors && (
          <div className="fmt-color-pop glass" role="menu">
            {NOTE_TEXT_COLORS.map((c) => (
              <B key={c.id} label={c.name} onRun={() => color(c.id)}>
                <span className="color-dot" style={{ background: c.value }} />
              </B>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
