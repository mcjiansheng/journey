import React, { useState, useEffect } from 'react';
import { WidgetFrame } from './WidgetFrame.jsx';

export function ClockWidget({ item, model }) {
  const size = model.size || 'S';
  const tz = model.timezone || 'Asia/Shanghai';

  const [time, setTime] = useState(() => {
    const parts = new Intl.DateTimeFormat('en-GB', {
      timeZone: tz,
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false,
    }).formatToParts(new Date());
    const m = Object.fromEntries(parts.map((p) => [p.type, +p.value]));
    return {
      h: m.hour || 0,
      m: m.minute || 0,
      s: m.second || 0,
    };
  });

  useEffect(() => {
    const interval = setInterval(() => {
      const parts = new Intl.DateTimeFormat('en-GB', {
        timeZone: tz,
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hour12: false,
      }).formatToParts(new Date());
      const m = Object.fromEntries(parts.map((p) => [p.type, +p.value]));
      setTime({
        h: m.hour || 0,
        m: m.minute || 0,
        s: m.second || 0,
      });
    }, 1000);
    return () => clearInterval(interval);
  }, [tz]);

  const hDeg = (time.h % 12) * 30 + time.m / 2;
  const mDeg = time.m * 6 + time.s / 10;
  const sDeg = time.s * 6;
  const digiStr = `${String(time.h).padStart(2, '0')}:${String(time.m).padStart(2, '0')}`;

  // Ticks in SVG
  const ticks = [];
  for (let i = 0; i < 60; i++) {
    const isMajor = i % 5 === 0;
    ticks.push(
      <line
        key={i}
        x1="50"
        y1={isMajor ? 3 : 4.5}
        x2="50"
        y2={isMajor ? 8 : 6.5}
        stroke="#fff"
        strokeOpacity={isMajor ? 0.9 : 0.35}
        strokeWidth={isMajor ? 1.2 : 0.6}
        transform={`rotate(${i * 6} 50 50)`}
      />,
    );
  }

  // HTML Numbers 1-12
  const numbers = [];
  for (let i = 1; i <= 12; i++) {
    const rad = (i * Math.PI) / 6;
    const left = (50 + 33.5 * Math.sin(rad)).toFixed(1);
    const top = (50 - 33.5 * Math.cos(rad)).toFixed(1);
    numbers.push(
      <span key={i} style={{ left: `${left}%`, top: `${top}%` }}>
        {i}
      </span>,
    );
  }

  const face = (
    <>
      <svg className="face" viewBox="0 0 100 100">
        <circle cx="50" cy="50" r="49" fill="#1b1d21" stroke="#ffffff22" />
        {ticks}
      </svg>
      <div className="dial">
        {numbers}
        <span className="cityl" style={{ left: '50%', top: '32%' }}>
          {model.destination}
        </span>
      </div>
      <svg className="face hands" viewBox="0 0 100 100">
        <line
          className="hh"
          x1="50"
          y1="52"
          x2="50"
          y2="27"
          stroke="#fff"
          strokeWidth="3.4"
          strokeLinecap="round"
          transform={`rotate(${hDeg} 50 50)`}
        />
        <line
          className="mm"
          x1="50"
          y1="53"
          x2="50"
          y2="13"
          stroke="#fff"
          strokeWidth="2.4"
          strokeLinecap="round"
          transform={`rotate(${mDeg} 50 50)`}
        />
        <line
          className="ss"
          x1="50"
          y1="59"
          x2="50"
          y2="10"
          stroke="#ffa62b"
          strokeWidth="0.9"
          strokeLinecap="round"
          transform={`rotate(${sDeg} 50 50)`}
        />
        <circle cx="50" cy="50" r="2.2" fill="#ffa62b" />
        <circle cx="50" cy="50" r="0.9" fill="#1b1d21" />
      </svg>
    </>
  );

  return (
    <WidgetFrame
      item={item}
      model={model}
      className={`w-clock ${size.toLowerCase()}`}
      ariaLabel={`时钟小组件：${model.destination} ${digiStr}`}
    >
      {face}
      {size === 'M' && (
        <div className="side">
          <div className="city">{model.destination} 当地时间</div>
          <div className="digi">{digiStr}</div>
          <div className="diff">{model.diffStr}</div>
        </div>
      )}
    </WidgetFrame>
  );
}
