import React, { useState } from 'react';
import { markIcons, markColors, iconNames, colorNames, defaultMark, markKey } from '../marks.js';
import { Modal } from './ui.jsx';
export function MarkSymbol({ mark }) {
  return (
    <span
      aria-label={iconNames[mark?.icon || 'circle']}
      style={{ color: markColors[mark?.color] || 'var(--map-accent)', fontSize: 22 }}
    >
      {markIcons[mark?.icon || 'circle']}
    </span>
  );
}
export default function MarkPicker({ journey: j, favorite, onClose, remember }) {
  const presets = j.snapshot.objects
    .filter((o) => o.kind === 'markPreset' && o.state === 'active')
    .sort((a, b) => (a.payload.order || 0) - (b.payload.order || 0));
  const [mark, setMark] = useState(
    favorite?.payload.mark || defaultMark(document.documentElement.dataset.palette),
  );
  const [name, setName] = useState(''),
    [save, setSave] = useState(false),
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
      if (save)
        await j.mutate({
          kind: 'create',
          objectType: 'markPreset',
          objectId: crypto.randomUUID(),
          patch: { ...mark, name, order: (presets.at(-1)?.payload.order || 0) + 1024 },
        });
      if (favorite) await j.mutate({ kind: 'patch', objectId: favorite.id, patch: { mark } });
      remember?.(mark);
    }
    onClose();
  }
  return (
    <Modal title={favorite ? '自定义标记' : '管理预设'} onClose={onClose}>
      {!favorite &&
        presets.map((p, i) => (
          <div className="mark-preset-row" key={p.id}>
            <button
              onClick={() => {
                setEditing(p);
                setMark({ icon: p.payload.icon, color: p.payload.color });
                setName(p.payload.name);
              }}
            >
              <MarkSymbol mark={p.payload} />
              {p.payload.name || '未命名'}
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
      <div className="mark-options" aria-label="图标">
        {Object.keys(markIcons).map((icon) => (
          <button
            key={icon}
            aria-label={iconNames[icon]}
            aria-pressed={mark.icon === icon}
            onClick={() => setMark({ ...mark, icon })}
          >
            {markIcons[icon]}
          </button>
        ))}
      </div>
      <div className="mark-options" aria-label="颜色">
        {Object.keys(markColors).map((color) => (
          <button
            key={color}
            aria-label={colorNames[color]}
            aria-pressed={mark.color === color}
            onClick={() => setMark({ ...mark, color })}
            style={{ color: markColors[color] }}
          >
            ●
          </button>
        ))}
      </div>
      {!editing && (
        <label>
          <input
            type="checkbox"
            checked={save || !favorite}
            onChange={(e) => setSave(e.target.checked)}
          />
          存为预设
        </label>
      )}
      {(save || editing || !favorite) && (
        <label>
          它代表什么（选填）
          <input maxLength={12} value={name} onChange={(e) => setName(e.target.value)} />
        </label>
      )}
      {error && <p role="alert">{error}</p>}
      <button
        className="primary"
        disabled={busy}
        onClick={() =>
          run(async () => {
            if (!favorite && !editing) {
              await j.mutate({
                kind: 'create',
                objectType: 'markPreset',
                objectId: crypto.randomUUID(),
                patch: { ...mark, name, order: (presets.at(-1)?.payload.order || 0) + 1024 },
              });
              onClose();
            } else await submit();
          })
        }
      >
        完成
      </button>
    </Modal>
  );
}
