import React from 'react';
import { WidgetFrame } from './WidgetFrame.jsx';

export function CountdownWidget({ item, model }) {
  const size = model.size || 'S';
  const days = model.days || [];

  const left = (
    <>
      <div className="label">{model.label}</div>
      <div className="big">
        {model.number}
        {model.unit && <small>{model.unit}</small>}
      </div>
      <div className="dest">
        <svg className="ic" viewBox="0 0 24 24">
          <path d="M17.8 19.2 16 11l3.5-3.5C21 6 21.5 4 21 3c-1-.5-3 0-4.5 1.5L13 8 4.8 6.2c-.5-.1-.9.1-1.1.5l-.3.5c-.2.5-.1 1 .3 1.3L9 12l-2 3H4l-1 1 3 2 2 3 1-1v-3l3-2 3.5 5.3c.3.4.8.5 1.3.3l.5-.2c.4-.3.6-.7.5-1.2z" />
        </svg>
        <span>
          {model.destination}
          {model.startDateLabel ? ` · ${model.startDateLabel} 出发` : ''}
        </span>
      </div>
    </>
  );

  return (
    <WidgetFrame
      item={item}
      model={model}
      className={`w-count ${size.toLowerCase()}`}
      ariaLabel={`倒计时小组件：${model.label} ${model.number}${model.unit}`}
    >
      <i className="rings" />
      <div className="pad">
        {size === 'S' ? (
          left
        ) : (
          <>
            <div className="l">{left}</div>
            <div className="r">
              <div className="range">
                {model.startDateLabel} {model.startWd} – {model.endMd} {model.endWd}
              </div>
              <div className="dots">
                {days.map((d) => (
                  <i key={d.id} className={d.ordinal <= model.progress ? 'on' : ''} />
                ))}
              </div>
              <div className="sub">
                {model.sub || `共 ${model.totalDays} 天 · 已排 ${model.activityCount} 项安排`}
              </div>
            </div>
          </>
        )}
      </div>
    </WidgetFrame>
  );
}
