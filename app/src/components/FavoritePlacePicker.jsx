import React, { useState } from 'react';
import { Search } from 'lucide-react';
import { Modal } from './ui.jsx';
import { MarkGlyph } from './FavoriteMarkEditor.jsx';
import { defaultMark, markColors, markKey, markLabel } from '../marks.js';
import './favorite-place-picker.css';

export default function FavoritePlacePicker({ favorites, presets, onChoose, onClose }) {
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState('all');
  const search = query.trim().toLocaleLowerCase();
  const presetFor = (mark) =>
    mark && presets.find((item) => markKey(item.payload) === markKey(mark));
  const shown = favorites.filter(({ payload }) => {
    const matchesFilter =
      filter === 'all' ||
      (filter === 'unmarked' ? !presetFor(payload.mark) : markKey(payload.mark) === filter);
    return (
      matchesFilter &&
      (!search ||
        [payload.name, payload.address].some((value) =>
          value?.toLocaleLowerCase().includes(search),
        ))
    );
  });

  return (
    <div
      onCancel={(event) => event.stopPropagation()}
      onKeyDown={(event) => {
        if (event.key === 'Escape' && !event.nativeEvent.isComposing) {
          event.preventDefault();
          event.stopPropagation();
          onClose();
        }
      }}
    >
      <Modal
        title="从收藏选择"
        className="favorite-place-picker"
        initialFocus="input"
        onClose={onClose}
      >
        <div className="favorite-place-picker-tools">
          <div className="favorite-place-picker-search">
            <Search size={18} aria-hidden="true" />
            <input
              aria-label="搜索收藏地点"
              placeholder="搜索名称或地址"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              type="search"
            />
          </div>
          <div className="favorite-place-picker-filters" role="group" aria-label="按标记筛选">
            <button type="button" aria-pressed={filter === 'all'} onClick={() => setFilter('all')}>
              全部
            </button>
            {presets.map(({ id, payload }) => (
              <button
                type="button"
                key={id}
                aria-pressed={filter === markKey(payload)}
                onClick={() => setFilter(markKey(payload))}
              >
                <MarkGlyph icon={payload.icon} style={{ color: markColors[payload.color] }} />
                {payload.name || markLabel(payload)}
              </button>
            ))}
            <button
              type="button"
              aria-pressed={filter === 'unmarked'}
              onClick={() => setFilter('unmarked')}
            >
              未分类
            </button>
          </div>
          <p className="favorite-place-picker-count" role="status">
            {shown.length} 个地点
          </p>
        </div>
        <ul className="favorite-place-picker-list" aria-label="收藏地点">
          {shown.map(({ id, payload }) => {
            const mark = payload.mark || defaultMark();
            const preset = presetFor(payload.mark);
            return (
              <li key={id}>
                <button
                  type="button"
                  onClick={() => {
                    const { mark: favoriteMark, ...place } = payload;
                    onChoose(place);
                  }}
                >
                  <span className="favorite-place-picker-mark" title={markLabel(mark)}>
                    <MarkGlyph icon={mark.icon} style={{ color: markColors[mark.color] }} />
                  </span>
                  <span className="favorite-place-picker-copy">
                    <strong>{payload.name}</strong>
                    {payload.address && <small>{payload.address}</small>}
                  </span>
                  <span className="favorite-place-picker-preset">
                    {preset ? preset.payload.name || markLabel(mark) : '未分类'}
                  </span>
                </button>
              </li>
            );
          })}
          {!shown.length && (
            <li className="favorite-place-picker-empty">
              {favorites.length ? '没有找到匹配的收藏地点。' : '还没有收藏的地点。'}
            </li>
          )}
        </ul>
      </Modal>
    </div>
  );
}
