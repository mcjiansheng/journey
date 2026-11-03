import React, { useState } from 'react';
import { Check, Plus } from 'lucide-react';
import { markPaths, markColors, iconNames, colorNames, markKey, defaultMark } from '../marks.js';

export function MarkGlyph({ icon = 'circle', ...props }) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" data-mark-icon={icon} {...props}>
      <path d={markPaths[icon]} fill="currentColor" strokeLinejoin="round" />
    </svg>
  );
}

export function MarkOptions({ mark, onChange }) {
  return (
    <div className="mark-choices">
      <div className="mark-choice-row" role="group" aria-label="图形">
        {Object.keys(markPaths).map((icon) => (
          <button
            type="button"
            key={icon}
            className="mark-choice"
            aria-label={iconNames[icon]}
            title={iconNames[icon]}
            aria-pressed={mark.icon === icon}
            onClick={() => onChange({ ...mark, icon })}
          >
            <MarkGlyph icon={icon} />
          </button>
        ))}
      </div>
      <div className="mark-choice-row" role="group" aria-label="颜色">
        {Object.entries(markColors).map(([color, value]) => (
          <button
            type="button"
            key={color}
            className="mark-choice mark-color-choice"
            aria-label={colorNames[color]}
            title={colorNames[color]}
            aria-pressed={mark.color === color}
            onClick={() => onChange({ ...mark, color })}
          >
            <span style={{ background: value }}>
              {mark.color === color && <Check size={13} strokeWidth={2.5} />}
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}

export default function FavoriteMarkEditor({ journey: j, favorite, remember, onManage }) {
  const mark = favorite.payload.mark || defaultMark(document.documentElement.dataset.palette);
  const presets = j.snapshot.objects
    .filter((o) => o.kind === 'markPreset' && o.state === 'active')
    .sort((a, b) => (a.payload.order || 0) - (b.payload.order || 0));
  const existing = presets.find((p) => markKey(p.payload) === markKey(mark));
  const [saving, setSaving] = useState(false),
    [name, setName] = useState(''),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false);
  async function change(next) {
    setError('');
    try {
      await j.mutate({ kind: 'patch', objectId: favorite.id, patch: { mark: next } });
      remember(next);
    } catch (e) {
      setError(e.message);
    }
  }
  async function save(e) {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      await j.mutate({
        kind: 'create',
        objectType: 'markPreset',
        objectId: crypto.randomUUID(),
        patch: { ...mark, name, order: (presets.at(-1)?.payload.order || 0) + 1024 },
      });
      setSaving(false);
      setName('');
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="favorite-mark-editor" aria-label="收藏标记">
      <h3>标记</h3>
      <MarkOptions mark={mark} onChange={change} />
      <div className="mark-presets-heading">
        <h3>预设</h3>
        <div>
          {presets.length > 0 && (
            <button type="button" className="mark-text-button" onClick={onManage}>
              管理
            </button>
          )}
          <button
            type="button"
            className="mark-text-button"
            disabled={!!existing}
            aria-expanded={saving}
            onClick={() => setSaving(!saving)}
          >
            <Plus size={14} />
            存为预设
          </button>
        </div>
      </div>
      {presets.length > 0 && (
        <div className="mark-preset-chips">
          {presets.map((p) => (
            <button
              type="button"
              key={p.id}
              aria-label={p.payload.name || '应用预设'}
              aria-pressed={markKey(p.payload) === markKey(mark)}
              onClick={() => change({ icon: p.payload.icon, color: p.payload.color })}
            >
              <MarkGlyph icon={p.payload.icon} style={{ color: markColors[p.payload.color] }} />
              {p.payload.name}
            </button>
          ))}
        </div>
      )}
      {saving && !existing && (
        <form className="mark-save-form" onSubmit={save}>
          <label>
            <span className="sr-only">预设名称（选填）</span>
            <input
              autoFocus
              maxLength={12}
              aria-label="预设名称（选填）"
              placeholder="预设名称（选填）"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </label>
          <button type="submit" className="primary" disabled={busy}>
            保存
          </button>
          <button type="button" className="mark-text-button" onClick={() => setSaving(false)}>
            取消
          </button>
        </form>
      )}
      {error && (
        <p className="mark-error" role="alert">
          {error}
        </p>
      )}
    </section>
  );
}
