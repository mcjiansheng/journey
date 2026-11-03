import React, { useState } from 'react';
import { markColors, iconNames, defaultMark, markKey, markLabel } from '../marks.js';
import { MarkGlyph, MarkOptions } from './FavoriteMarkEditor.jsx';
import { Modal } from './ui.jsx';
export function MarkSymbol({ mark }) {
  return (
    <span
      className="mark-symbol"
      aria-label={iconNames[mark?.icon || 'circle']}
      style={{ color: markColors[mark?.color] || 'var(--map-accent)', fontSize: 22 }}
    >
      <MarkGlyph icon={mark?.icon || 'circle'} />
    </span>
  );
}
export default function MarkPicker({ journey: j, onClose }) {
  const presets = j.snapshot.objects
    .filter((o) => o.kind === 'markPreset' && o.state === 'active')
    .sort((a, b) => (a.payload.order || 0) - (b.payload.order || 0));
  const [mark, setMark] = useState(defaultMark(document.documentElement.dataset.palette));
  const [name, setName] = useState(''),
    [editing, setEditing] = useState(null),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false);
  async function run(fn) {
    setBusy(true);
    setError('');
    try {
      await fn();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  async function submit() {
    if (editing) {
      const count = j.snapshot.objects.filter(
        (o) => o.kind === 'favorite' && markKey(o.payload.mark) === markKey(editing.payload),
      ).length;
      if (
        markKey(mark) !== markKey(editing.payload) &&
        count &&
        !window.confirm('有 ' + count + ' 个地点在用这个标记，一起改吗？')
      )
        return;
      await j.mutate({ kind: 'patch', objectId: editing.id, patch: { ...mark, name } });
    } else {
      await j.mutate({
        kind: 'create',
        objectType: 'markPreset',
        objectId: crypto.randomUUID(),
        patch: { ...mark, name, order: (presets.at(-1)?.payload.order || 0) + 1024 },
      });
    }
    onClose();
  }
  return (
    <Modal className="mark-manager" title="管理预设" onClose={onClose}>
      {presets.map((p, i) => (
        <div className="mark-preset-row" key={p.id}>
          <button
            onClick={() => {
              setEditing(p);
              setMark({ icon: p.payload.icon, color: p.payload.color });
              setName(p.payload.name);
            }}
          >
            <MarkSymbol mark={p.payload} />
            {p.payload.name || markLabel(p.payload)}
          </button>
          <button
            disabled={busy || i === 0}
            onClick={() =>
              run(async () => {
                const reordered = [...presets];
                [reordered[i - 1], reordered[i]] = [reordered[i], reordered[i - 1]];
                for (const [order, preset] of reordered.entries())
                  await j.mutate({
                    kind: 'patch',
                    objectId: preset.id,
                    patch: { order: order * 1024 },
                  });
              })
            }
          >
            上移
          </button>
          <button
            disabled={busy}
            onClick={() =>
              run(() => j.mutate({ kind: 'delete', objectId: p.id, generation: p.generation }))
            }
          >
            删除
          </button>
        </div>
      ))}
      <div className="mark-preview">
        <MarkSymbol mark={mark} />
        {name || '标记预览'}
      </div>
      <MarkOptions mark={mark} onChange={setMark} />
      <label className="mark-name-field">
        它代表什么（选填）
        <input maxLength={12} value={name} onChange={(e) => setName(e.target.value)} />
      </label>
      {error && <p role="alert">{error}</p>}
      <button className="primary" disabled={busy} onClick={() => run(submit)}>
        完成
      </button>
    </Modal>
  );
}
