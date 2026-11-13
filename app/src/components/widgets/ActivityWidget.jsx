import React from 'react';
import { WidgetFrame } from './WidgetFrame.jsx';

export function ActivityWidget({ item, model }) {
  const size = model.size || 'S';
  const s = model.sky || {};

  const scene = (
    <>
      <i
        className="orb"
        style={{ left: `${s.x ?? 78}%`, top: `${s.y ?? 26}%`, '--orb': s.orb || '#fff' }}
      />
      {s.night && <i className="stars" />}
      <i className="hill" />
      <i className="hill b" />
    </>
  );

  const top = (
    <div className="top">
      <span className="pill">
        {model.dayLabel}
        {model.dateLabel ? ` · ${model.dateLabel}` : ''}
      </span>
      {model.index != null && <span className="num">{model.index}</span>}
    </div>
  );

  const timeHtml = (
    <div className={`time ${model.time?.precise ? '' : 'soft'}`}>
      {model.time?.start || model.time?.text || '时间待定'}
      {model.time?.end && <small>{model.time.end}</small>}
    </div>
  );

  const placeHtml = model.placeName ? (
    <div className="place ellipsis">
      <svg className="ic" viewBox="0 0 24 24">
        <path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0Z" />
        <circle cx="12" cy="10" r="3" />
      </svg>
      <span className="ellipsis">{model.placeName}</span>
    </div>
  ) : null;

  return (
    <WidgetFrame
      item={item}
      model={model}
      className={`w-act ${size.toLowerCase()}`}
      style={{
        '--a': s.a || 'var(--widget-brand-a, #2f7abc)',
        '--b': s.b || 'var(--widget-brand-b, #1f5fb4)',
      }}
      ariaLabel={`日程小组件：${model.title}`}
    >
      {scene}
      <div className="pad">
        {size === 'S' ? (
          <>
            {top}
            {timeHtml}
            <div className="title clamp2 strike">{model.title}</div>
            {placeHtml}
          </>
        ) : (
          <>
            <div className="left">
              {top}
              {timeHtml}
              {model.time?.precise && (
                <div className="row" style={{ marginTop: 5, opacity: 0.8 }}>
                  <svg className="ic" viewBox="0 0 24 24">
                    <rect x="4" y="11" width="16" height="10" rx="2" />
                    <path d="M8 11V7a4 4 0 0 1 8 0v4" />
                  </svg>
                  <span>按具体时间</span>
                </div>
              )}
            </div>
            <div className="right">
              <div className="title clamp2 strike">{model.title}</div>
              {model.placeName && (
                <div className="row">
                  <svg className="ic" viewBox="0 0 24 24">
                    <path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0Z" />
                    <circle cx="12" cy="10" r="3" />
                  </svg>
                  <span className="ellipsis">{model.placeName}</span>
                </div>
              )}
              {model.bufferBefore != null && (
                <div className="row">
                  <svg className="ic" viewBox="0 0 24 24">
                    <circle cx="12" cy="12" r="9" />
                    <path d="M12 7v5l3 2" />
                  </svg>
                  <span>提前 {model.bufferBefore} 分钟到场</span>
                </div>
              )}
              {model.legText && (
                <div className="row">
                  <svg className="ic" viewBox="0 0 24 24">
                    <circle cx="6" cy="19" r="3" />
                    <path d="M9 19h8.5a3.5 3.5 0 0 0 0-7h-11a3.5 3.5 0 0 1 0-7H15" />
                    <circle cx="18" cy="5" r="3" />
                  </svg>
                  <span className="ellipsis">{model.legText}</span>
                </div>
              )}
              {model.notes && !model.legText && (
                <div className="note-line ellipsis">{model.notes}</div>
              )}
              {model.gone && <div className="row">已从行程移除，恢复后这里会复原</div>}
            </div>
          </>
        )}
      </div>
    </WidgetFrame>
  );
}
