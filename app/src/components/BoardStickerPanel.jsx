import React, { useState, useRef } from 'react';
import { BoardWidget } from './widgets/index.jsx';

const EMOJIS = [
  '✈️',
  '🚄',
  '🏨',
  '🍜',
  '☕️',
  '🍣',
  '⛩️',
  '🎡',
  '📸',
  '🗺️',
  '🛍️',
  '🌸',
  '🏔️',
  '🏖️',
  '🎉',
  '✨',
  '❤️',
  '💡',
];

const NOTE_COLORS = [
  { id: 'yellow', name: '暖黄', hex: '#fef08a' },
  { id: 'green', name: '薄荷', hex: '#bbf7d0' },
  { id: 'blue', name: '晴空', hex: '#bfdbfe' },
  { id: 'pink', name: '淡粉', hex: '#fbcfe8' },
  { id: 'purple', name: '香芋', hex: '#e9d5ff' },
  { id: 'gray', name: '浅灰', hex: '#e2e8f0' },
];

export function BoardStickerPanel({
  snapshot,
  open,
  onClose,
  onAddWidget,
  onAddNote,
  onAddEmoji,
  onUploadImage,
}) {
  const [tab, setTab] = useState('widget');
  const fileInputRef = useRef(null);

  if (!open) return null;

  const activities = (snapshot?.objects || []).filter(
    (o) => o.kind === 'activity' && o.state === 'active',
  );
  const days = (snapshot?.objects || []).filter((o) => o.kind === 'day' && o.state === 'active');
  const favorites = (snapshot?.objects || []).filter(
    (o) => o.kind === 'favorite' && o.state === 'active',
  );

  const handleFileChange = (e) => {
    const files = Array.from(e.target.files || []);
    if (!files.length) return;
    for (const f of files) {
      onUploadImage(f);
    }
    e.target.value = '';
    onClose();
  };

  return (
    <div id="panel" className="ui sheet glass on" role="dialog" aria-label="贴纸与小组件">
      <header>
        <h2>贴纸与小组件</h2>
        <button className="iconbtn" onClick={onClose} aria-label="关闭">
          ✕
        </button>
      </header>

      <div className="tabs" role="tablist">
        <button role="tab" aria-selected={tab === 'widget'} onClick={() => setTab('widget')}>
          小组件
        </button>
        <button role="tab" aria-selected={tab === 'note'} onClick={() => setTab('note')}>
          便签
        </button>
        <button role="tab" aria-selected={tab === 'emoji'} onClick={() => setTab('emoji')}>
          表情
        </button>
        <button role="tab" aria-selected={tab === 'image'} onClick={() => setTab('image')}>
          图片
        </button>
      </div>

      <div className="body">
        {tab === 'widget' && (
          <div className="widget-gallery">
            <div className="group">概览</div>
            <div className="gallery">
              <button
                onClick={() => {
                  onAddWidget({ kind: 'countdown' }, 'M');
                  onClose();
                }}
              >
                <div className="thumb">
                  <BoardWidget
                    item={{ content: { kind: 'countdown' }, style: { size: 'M' } }}
                    snapshot={snapshot}
                  />
                </div>
                <span>倒计时</span>
              </button>

              <button
                onClick={() => {
                  onAddWidget({ kind: 'clock' }, 'S');
                  onClose();
                }}
              >
                <div className="thumb">
                  <BoardWidget
                    item={{ content: { kind: 'clock' }, style: { size: 'S' } }}
                    snapshot={snapshot}
                  />
                </div>
                <span>当地时间</span>
              </button>

              <button
                onClick={() => {
                  onAddWidget({ kind: 'expense' }, 'M');
                  onClose();
                }}
              >
                <div className="thumb">
                  <BoardWidget
                    item={{ content: { kind: 'expense' }, style: { size: 'M' } }}
                    snapshot={snapshot}
                  />
                </div>
                <span>费用概览</span>
              </button>
            </div>

            {days.length > 0 && (
              <>
                <div className="group">日程与路线</div>
                <div className="gallery">
                  {days.map((d) => (
                    <React.Fragment key={d.id}>
                      <button
                        onClick={() => {
                          onAddWidget({ kind: 'day', dayId: d.id }, 'M');
                          onClose();
                        }}
                      >
                        <div className="thumb">
                          <BoardWidget
                            item={{ content: { kind: 'day', dayId: d.id }, style: { size: 'M' } }}
                            snapshot={snapshot}
                          />
                        </div>
                        <span>第 {d.payload.ordinal} 天概览</span>
                      </button>

                      <button
                        onClick={() => {
                          onAddWidget({ kind: 'route', dayId: d.id }, 'M');
                          onClose();
                        }}
                      >
                        <div className="thumb">
                          <BoardWidget
                            item={{ content: { kind: 'route', dayId: d.id }, style: { size: 'M' } }}
                            snapshot={snapshot}
                          />
                        </div>
                        <span>第 {d.payload.ordinal} 天路线</span>
                      </button>
                    </React.Fragment>
                  ))}
                </div>
              </>
            )}

            {activities.length > 0 && (
              <>
                <div className="group">具体活动</div>
                <div className="gallery">
                  {activities.map((a) => (
                    <button
                      key={a.id}
                      onClick={() => {
                        onAddWidget({ kind: 'activity', activityId: a.id }, 'M');
                        onClose();
                      }}
                    >
                      <div className="thumb">
                        <BoardWidget
                          item={{
                            content: { kind: 'activity', activityId: a.id },
                            style: { size: 'M' },
                          }}
                          snapshot={snapshot}
                        />
                      </div>
                      <span className="ellipsis" style={{ maxWidth: 160 }}>
                        {a.payload.title}
                      </span>
                    </button>
                  ))}
                </div>
              </>
            )}

            {favorites.length > 0 && (
              <>
                <div className="group">收藏地点</div>
                <div className="gallery">
                  {favorites.map((f) => (
                    <button
                      key={f.id}
                      onClick={() => {
                        onAddWidget({ kind: 'place', favoriteId: f.id }, 'S');
                        onClose();
                      }}
                    >
                      <div className="thumb">
                        <BoardWidget
                          item={{
                            content: { kind: 'place', favoriteId: f.id },
                            style: { size: 'S' },
                          }}
                          snapshot={snapshot}
                        />
                      </div>
                      <span className="ellipsis" style={{ maxWidth: 100 }}>
                        {f.payload.name}
                      </span>
                    </button>
                  ))}
                </div>
              </>
            )}
          </div>
        )}

        {tab === 'note' && (
          <div className="grid c3" style={{ padding: '8px 0' }}>
            {NOTE_COLORS.map((c) => (
              <button
                key={c.id}
                className="pick-note"
                style={{ backgroundColor: c.hex }}
                onClick={() => {
                  onAddNote(c.id);
                  onClose();
                }}
                title={c.name}
              />
            ))}
          </div>
        )}

        {tab === 'emoji' && (
          <div className="grid c6" style={{ padding: '8px 0' }}>
            {EMOJIS.map((e) => (
              <button
                key={e}
                className="pick-emoji"
                onClick={() => {
                  onAddEmoji(e);
                  onClose();
                }}
              >
                {e}
              </button>
            ))}
          </div>
        )}

        {tab === 'image' && (
          <div style={{ padding: '8px 0' }}>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/jpeg,image/png,image/webp,image/gif"
              multiple
              hidden
              onChange={handleFileChange}
            />
            <button className="upload" onClick={() => fileInputRef.current?.click()}>
              + 上传图片或 GIF
            </button>
            <div className="hint">
              支持 JPG、PNG、WebP（自动压缩至 2048px，≤1.5MB）与动画 GIF（原样保留，≤5MB）。
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
