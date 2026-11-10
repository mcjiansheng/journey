import React from 'react';
import { mapSvg, project } from '../../board.js';

export function MapSketch({
  seed = 'default',
  w = 168,
  h = 168,
  stops = [],
  legs = [],
  box = null,
  className = '',
}) {
  const bgMarkup = mapSvg(seed, w, h);

  let paths = null;
  let stopElements = null;

  if (stops.length && box) {
    const located = stops.filter((s) => s.lng != null && s.lat != null);
    const coords = located.map((s) => [s.lng, s.lat]);
    const projected = project(coords, box);
    const posMap = new Map();
    located.forEach((s, i) => posMap.set(s.id, projected[i]));

    const pathSegments = [];
    legs.forEach((l) => {
      const p = posMap.get(l.fromId);
      const q = posMap.get(l.toId);
      if (!p || !q) return;

      let g;
      if (l.path && l.path.length > 1) {
        const pPath = project(l.path, box);
        g = 'M' + pPath.map((x) => `${x[0].toFixed(1)} ${x[1].toFixed(1)}`).join('L');
      } else {
        const mx = ((p[0] + q[0]) / 2 + (q[1] - p[1]) * 0.18).toFixed(1);
        const my = ((p[1] + q[1]) / 2 - (q[0] - p[0]) * 0.18).toFixed(1);
        g = `M${p[0].toFixed(1)} ${p[1].toFixed(1)}Q${mx} ${my} ${q[0].toFixed(1)} ${q[1].toFixed(1)}`;
      }

      const dash = l.hasRoute ? '' : '1 7';
      pathSegments.push(
        <React.Fragment key={`${l.fromId}-${l.toId}`}>
          <path
            d={g}
            stroke="#fff"
            strokeOpacity="0.9"
            strokeWidth="7"
            fill="none"
            strokeLinecap="round"
            strokeDasharray={dash || undefined}
          />
          <path
            d={g}
            stroke="var(--primary)"
            strokeWidth="3.5"
            fill="none"
            strokeLinecap="round"
            strokeDasharray={dash || undefined}
          />
        </React.Fragment>,
      );
    });

    paths = (
      <svg
        className="map route-overlay"
        viewBox={`0 0 ${w} ${h}`}
        style={{ position: 'absolute', left: 0, top: 0, width: '100%', height: '100%' }}
      >
        {pathSegments}
      </svg>
    );

    stopElements = (
      <div className="stops">
        {located.map((s, i) => {
          const pt = projected[i];
          if (!pt) return null;
          const leftPct = ((pt[0] / w) * 100).toFixed(2);
          const topPct = ((pt[1] / h) * 100).toFixed(2);
          const skyColor = s.sky?.c || 'var(--primary)';
          return (
            <span
              key={s.id}
              style={{
                left: `${leftPct}%`,
                top: `${topPct}%`,
                '--c': skyColor,
              }}
            >
              {s.n}
            </span>
          );
        })}
      </div>
    );
  }

  return (
    <div
      className={`map-sketch-container ${className}`}
      style={{ position: 'absolute', inset: 0, overflow: 'hidden' }}
    >
      <div
        dangerouslySetInnerHTML={{ __html: bgMarkup }}
        style={{ width: '100%', height: '100%', position: 'absolute', inset: 0 }}
      />
      {paths}
      {stopElements}
    </div>
  );
}
