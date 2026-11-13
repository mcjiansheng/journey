import React from 'react';
import { WidgetFrame } from './WidgetFrame.jsx';
import { MapSketch } from './MapSketch.jsx';

/** All favorites sharing one mark preset on one map (问题 6). */
export function PlacesWidget({ item, model }) {
  const size = model.size || 'M';
  const stops = model.stops || [];
  const mark = (
    <svg className="mark" viewBox="0 0 24 24" aria-hidden="true">
      <path d={model.markPath} fill="currentColor" />
    </svg>
  );
  const empty = model.located ? null : (
    <div className="empty">{stops.length ? '这类地点还没有坐标' : '这类收藏已全部移除'}</div>
  );
  const seed = `places-${model.mark?.icon}-${model.mark?.color}`;

  return (
    <WidgetFrame
      item={item}
      model={model}
      className={`w-places ${size.toLowerCase()}`}
      style={{ '--mc': model.markColorHex }}
      ariaLabel={`地点分类小组件：${model.title}，${stops.length} 个地点`}
    >
      {size === 'M' ? (
        <>
          <MapSketch
            mapStyle={item.style?.mapStyle}
            seed={seed}
            w={352}
            h={168}
            stops={stops}
            box={{ x: 168, y: 22, w: 162, h: 124 }}
          />
          {empty}
          <div className="panel">
            <span className="pill head">
              {mark}
              {model.title}
            </span>
            <div className="big">
              {stops.length}
              <small>个地点</small>
            </div>
            <ol className="names">
              {stops.slice(0, 3).map((s) => (
                <li key={s.id} className="ellipsis">
                  <b>{s.n}</b>
                  {s.title}
                </li>
              ))}
            </ol>
            {stops.length > 3 && <div className="more">还有 {stops.length - 3} 个</div>}
          </div>
        </>
      ) : (
        <>
          <div className="maparea">
            <MapSketch
              mapStyle={item.style?.mapStyle}
              seed={seed}
              w={352}
              h={200}
              stops={stops}
              box={{ x: 26, y: 40, w: 300, h: 140 }}
            />
            {empty}
            <span className="pill head">
              {mark}
              {model.title} · {stops.length}
            </span>
          </div>
          <ol className="list">
            {stops.slice(0, 6).map((s) => (
              <li key={s.id} className={s.located ? '' : 'off'}>
                <span className="n">{s.n}</span>
                <b className="ellipsis">{s.title}</b>
                <span className="ellipsis">{s.located ? s.address : '未定位'}</span>
              </li>
            ))}
            {stops.length > 6 && <li className="more">还有 {stops.length - 6} 个地点</li>}
          </ol>
        </>
      )}
    </WidgetFrame>
  );
}
