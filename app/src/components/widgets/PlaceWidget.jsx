import React from 'react';
import { WidgetFrame } from './WidgetFrame.jsx';
import { MapSketch } from './MapSketch.jsx';

export function PlaceWidget({ item, model }) {
  const size = model.size || 'S';
  const mc = model.markColorHex || '#ffa000';
  const ok = !model.gone && Boolean(model.scheduled);

  const pinSvg = (
    <svg className="pin" viewBox="0 0 38 48">
      <path
        d="M19 47C19 47 3 30 3 18a16 16 0 0 1 32 0c0 12-16 29-16 29Z"
        fill={mc}
        stroke="#fff"
        strokeWidth="2.5"
      />
      <g transform="translate(9.500 8.500) scale(.79)">
        <path d={model.markPath} fill="#fff" />
      </g>
    </svg>
  );

  return (
    <WidgetFrame
      item={item}
      model={model}
      className={`w-place ${size.toLowerCase()}`}
      style={{ '--mc': mc }}
      ariaLabel={`地点小组件：${model.name}`}
    >
      <MapSketch seed={model.favoriteId || model.name || 'place'} w={168} h={168} className="map" />
      <i className="pulse" />
      {pinSvg}

      {size === 'S' ? (
        <>
          {model.category && !model.gone && <span className="pill cat">{model.category}</span>}
          {ok && (
            <span className="pill sched">
              <svg className="ic" viewBox="0 0 24 24">
                <path d="M20 6 9 17l-5-5" />
              </svg>
              {model.scheduled.dayLabel}
            </span>
          )}
          <div className="info">
            <div className="name ellipsis strike">{model.name}</div>
            <div className="addr ellipsis">{model.gone ? '已从收藏移除' : model.address}</div>
          </div>
        </>
      ) : (
        <div className="side">
          <div className="catline">{model.category || '收藏地点'}</div>
          <div className="name clamp2 strike">{model.name}</div>
          <div className="addr clamp2">{model.address}</div>
          <div className={`status ${ok ? 'on' : ''}`}>
            {model.gone ? (
              '已从收藏移除，恢复后这里会复原'
            ) : ok ? (
              <>
                <svg className="ic" viewBox="0 0 24 24">
                  <path d="M20 6 9 17l-5-5" />
                </svg>
                已安排 · {model.scheduled.dayLabel}
              </>
            ) : (
              <>
                <svg className="ic" viewBox="0 0 24 24">
                  <circle cx="6" cy="19" r="3" />
                  <path d="M9 19h8.5a3.5 3.5 0 0 0 0-7h-11a3.5 3.5 0 0 1 0-7H15" />
                  <circle cx="18" cy="5" r="3" />
                </svg>
                还没排进行程
              </>
            )}
          </div>
        </div>
      )}
    </WidgetFrame>
  );
}
