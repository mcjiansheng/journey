import React from 'react';

export function BoardRecentDeletions({
  open,
  onClose,
  deletedItems = [],
  onRestore,
  deletedBoards = [],
  onRestoreBoard,
}) {
  if (!open) return null;
  // A text object that was never given any text is discarded, not "deleted".
  const items = deletedItems.filter((it) => !(it.content?.type === 'text' && !it.content?.text));

  return (
    <div id="drawer" className="ui sheet glass on" role="dialog" aria-label="最近删除">
      <header>
        <h2>最近删除</h2>
        <button className="iconbtn" onClick={onClose} aria-label="关闭">
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d="M6 6l12 12M18 6 6 18" />
          </svg>
        </button>
      </header>
      <div className="body">
        {deletedBoards.length > 0 && (
          <>
            <div className="group">白板</div>
            {deletedBoards.map((b) => (
              <div key={b.id} className="recent-row">
                <div className="info">
                  <b>{b.payload?.title || '白板'}</b>
                  <span>整块白板及其内容</span>
                </div>
                <button className="restore-btn" onClick={() => onRestoreBoard?.(b)}>
                  恢复
                </button>
              </div>
            ))}
            <div className="group">对象</div>
          </>
        )}
        {items.length === 0 ? (
          <div style={{ padding: '24px 0', textAlign: 'center', color: 'var(--muted)' }}>
            没有已删除的内容
          </div>
        ) : (
          items.map((item) => {
            const type = item.content?.type;
            const title =
              type === 'note'
                ? item.content?.text || '空白便签'
                : type === 'widget'
                  ? `小组件 · ${item.content?.kind}`
                  : type === 'text'
                    ? item.content?.text || '文本'
                    : type === 'emoji'
                      ? `表情 ${item.content?.char || item.content?.emoji || ''}`
                      : type === 'image'
                        ? '图片'
                        : '笔迹';

            const timeStr = item.updatedAt
              ? new Date(item.updatedAt).toLocaleTimeString([], {
                  hour: '2-digit',
                  minute: '2-digit',
                })
              : '';

            return (
              <div key={item.id} className="recent-row">
                <div className="info">
                  <b>{title}</b>
                  <span>删除于 {timeStr}</span>
                </div>
                <button className="restore-btn" onClick={() => onRestore(item.id)}>
                  恢复
                </button>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
