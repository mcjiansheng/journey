import React from 'react';
import { WidgetFrame } from './WidgetFrame.jsx';

/** How full the ring is: the last 30 days before departure, then the trip itself. */
export function countdownFraction(model) {
  if (typeof model.number !== 'number') return 0;
  if (model.label === '距出发') return Math.max(0, Math.min(1, 1 - model.number / 30));
  if (model.label === '旅途中') return Math.min(1, (model.progress || 0) / (model.totalDays || 1));
  return 1;
}

export function CountdownWidget({ item, model }) {
  const size = model.size || 'S';
  const days = model.days || [];
  const variant = item.style?.variant || 'plain';
  const digits = String(model.number);

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

  const plane = (
    <svg className="ic" viewBox="0 0 24 24">
      <path d="M17.8 19.2 16 11l3.5-3.5C21 6 21.5 4 21 3c-1-.5-3 0-4.5 1.5L13 8 4.8 6.2c-.5-.1-.9.1-1.1.5l-.3.5c-.2.5-.1 1 .3 1.3L9 12l-2 3H4l-1 1 3 2 2 3 1-1v-3l3-2 3.5 5.3c.3.4.8.5 1.3.3l.5-.2c.4-.3.6-.7.5-1.2z" />
    </svg>
  );
  let face = left;
  if (variant === 'flip')
    face = (
      <>
        <div className="label">{model.label}</div>
        <div className="flip-digits">
          {digits.split('').map((d, i) => (
            <span key={i} className="fd">
              <b>{d}</b>
            </span>
          ))}
          {model.unit && <em>{model.unit}</em>}
        </div>
        <div className="dest">
          {plane}
          <span>{model.destination}</span>
        </div>
      </>
    );
  else if (variant === 'calendar')
    face = (
      <div className="cal">
        <div className="cal-top">
          <i />
          <i />
          <span>{model.label}</span>
        </div>
        <div className="cal-num">{model.number}</div>
        <div className="cal-unit">
          {model.unit || '　'} · {model.destination}
        </div>
      </div>
    );
  else if (variant === 'ring') {
    const frac = countdownFraction(model);
    const c = 2 * Math.PI * 42;
    face = (
      <div className="ring-face">
        <svg viewBox="0 0 100 100" className="ring-svg">
          <circle cx="50" cy="50" r="42" className="track" />
          <circle
            cx="50"
            cy="50"
            r="42"
            className="bar"
            strokeDasharray={`${(c * frac).toFixed(1)} ${c.toFixed(1)}`}
          />
        </svg>
        <div className="ring-text">
          <small>{model.label}</small>
          <b>{model.number}</b>
          <small>{model.unit}</small>
        </div>
      </div>
    );
  }

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
          face
        ) : (
          <>
            <div className="l">{face}</div>
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
