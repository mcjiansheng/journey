import React from 'react';
import { WidgetFrame } from './WidgetFrame.jsx';
import { MapSketch } from './MapSketch.jsx';

export function RouteWidget({ item, model }) {
  const size = model.size || 'M';
  const stops = model.stops || [];
  const legs = model.legs || [];
  const dayTxt = `${model.dayLabel}${model.dateLabel ? ` · ${model.dateLabel}` : ''}`;
  const timeTxt = legs.length
    ? model.minutes
      ? `路上约 ${model.minutes} 分钟`
      : '路程未估算'
    : '只有一站';

  const empty = stops.some((s) => s.located) ? null : (
    <div className="empty">{stops.length ? '这天的安排还没有地点' : '这天还没有安排'}</div>
  );

  return (
    <WidgetFrame
      item={item}
      model={model}
      className={`w-route ${size.toLowerCase()}`}
      ariaLabel={`路线小组件：${dayTxt}`}
    >
      {size === 'M' ? (
        <>
          <MapSketch
            mapStyle={item.style?.mapStyle}
            seed={`route-${item.content?.dayId || 'x'}`}
            w={352}
            h={168}
            stops={stops}
            legs={legs}
            box={{ x: 182, y: 26, w: 146, h: 116 }}
          />
          {empty}
          <div className="panel">
            <span className="pill dpill">{dayTxt}</span>
            <div className="big">
              {stops.length}
              <small>站</small>
            </div>
            <div className="sub">
              <svg className="ic" viewBox="0 0 24 24">
                <circle cx="6" cy="19" r="3" />
                <path d="M9 19h8.5a3.5 3.5 0 0 0 0-7h-11a3.5 3.5 0 0 1 0-7H15" />
                <circle cx="18" cy="5" r="3" />
              </svg>
              <span>{timeTxt}</span>
            </div>
            <div className="sub2 ellipsis strike">
              {stops.length > 1
                ? `${stops[0].title} → ${stops[stops.length - 1].title}`
                : stops[0]?.title || ''}
            </div>
          </div>
        </>
      ) : (
        <>
          <div className="maparea">
            <MapSketch
              mapStyle={item.style?.mapStyle}
              seed={`route-${item.content?.dayId || 'x'}`}
              w={352}
              h={168}
              stops={stops}
              legs={legs}
              box={{ x: 34, y: 46, w: 284, h: 100 }}
            />
            {empty}
            <span className="pill dpill">{dayTxt} · 路线</span>
          </div>
          <div className="list">
            {stops.length ? (
              stops.slice(0, 4).map((a, i) => {
                const leg = i > 0 ? legs[i - 1] : null;
                const off = !a.located;
                return (
                  <React.Fragment key={a.id}>
                    {leg && (
                      <div className="lg">
                        <svg className="ic" viewBox="0 0 24 24">
                          <circle cx="6" cy="19" r="3" />
                          <path d="M9 19h8.5a3.5 3.5 0 0 0 0-7h-11a3.5 3.5 0 0 1 0-7H15" />
                          <circle cx="18" cy="5" r="3" />
                        </svg>
                        <span>{leg.minutes != null ? `约 ${leg.minutes} 分钟` : '路程未估算'}</span>
                      </div>
                    )}
                    <div
                      className={`st ${off ? 'off' : ''}`}
                      style={{ '--c': a.sky?.c || '#5cc0ff' }}
                    >
                      <span className="n">{i + 1}</span>
                      <b className="ellipsis strike">{a.title}</b>
                      <span>{off ? '未定位' : a.timeText}</span>
                    </div>
                  </React.Fragment>
                );
              })
            ) : (
              <div className="st off">
                <b>这天还没有安排</b>
              </div>
            )}
            <div className="sum">
              <span>{stops.length} 站</span>
              {stops.length > 4 && <span>还有 {stops.length - 4} 站未列出</span>}
              <span>
                {timeTxt}
                {model.distance != null ? ` · ${(model.distance / 1000).toFixed(1)} 公里` : ''}
                {model.missing > 0 && model.minutes ? ` · ${model.missing} 段未估算` : ''}
              </span>
            </div>
          </div>
        </>
      )}
    </WidgetFrame>
  );
}
