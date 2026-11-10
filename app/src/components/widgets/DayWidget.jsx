import React from 'react';
import { WidgetFrame } from './WidgetFrame.jsx';

export function DayWidget({ item, model }) {
  const size = model.size || 'S';
  const list = model.items || [];

  const head = (
    <div className="head">
      <div className="dnum">{model.dateNumber ?? '–'}</div>
      <div className="dmeta">
        <b>{model.weekday}</b>
        <span>{model.dayLabel}</span>
      </div>
      <div className="count">{model.count ? `${model.count} 项安排` : ''}</div>
    </div>
  );

  const renderEvent = (a) => (
    <div key={a.id} className="ev" style={{ '--c': a.sky?.c || '#9fb3c8' }}>
      <b className="ellipsis">{a.title}</b>
      <span className="ellipsis">
        {[a.timeText, a.placeName].filter(Boolean).join(' · ') || '时间地点未定'}
      </span>
    </div>
  );

  const none = <div className="none">这天还没有安排</div>;

  return (
    <WidgetFrame
      item={item}
      model={model}
      className={`w-day ${size.toLowerCase()}`}
      ariaLabel={`日程概览小组件：${model.dayLabel}`}
    >
      <div className="pad">
        {head}
        {size !== 'L' ? (
          <div className="evs">
            {list.length ? (
              <>
                {list.slice(0, size === 'S' ? 2 : 3).map(renderEvent)}
                {list.length > (size === 'S' ? 2 : 3) && (
                  <div className="more">还有 {list.length - (size === 'S' ? 2 : 3)} 项</div>
                )}
              </>
            ) : (
              none
            )}
          </div>
        ) : (
          <div className="tl">
            {list.length ? (
              <>
                {list.slice(0, 4).map((a, i) => (
                  <React.Fragment key={a.id}>
                    {i > 0 && a.legIn && (
                      <div className="leg">
                        <svg className="ic" viewBox="0 0 24 24">
                          <circle cx="6" cy="19" r="3" />
                          <path d="M9 19h8.5a3.5 3.5 0 0 0 0-7h-11a3.5 3.5 0 0 1 0-7H15" />
                          <circle cx="18" cy="5" r="3" />
                        </svg>
                        <span>{a.legIn}</span>
                      </div>
                    )}
                    {i > 0 && !a.legIn && (
                      <div className="leg" style={{ paddingTop: 5, paddingBottom: 5 }} />
                    )}
                    <div className="stop" style={{ '--c': a.sky?.c || '#9fb3c8' }}>
                      <span className="n">{i + 1}</span>
                      <div style={{ minWidth: 0 }}>
                        <div className="tt ellipsis">
                          {[a.timeText || '时间待定', a.placeName].filter(Boolean).join(' · ')}
                        </div>
                        <b className="ellipsis">{a.title}</b>
                      </div>
                    </div>
                  </React.Fragment>
                ))}
                {list.length > 4 && (
                  <div className="more" style={{ marginTop: 6 }}>
                    还有 {list.length - 4} 项
                  </div>
                )}
              </>
            ) : (
              none
            )}
          </div>
        )}
      </div>
    </WidgetFrame>
  );
}
