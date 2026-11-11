import React, { useContext, useMemo, useState } from 'react';
import { mapSvg, project, geoFit, geoProject, geoTiles } from '../../board.js';
import { MapDetailContext, staticMapUrl, tileUrl, useStaticMapAvailable } from './map-context.js';

/**
 * Map background for place and route widgets. With real coordinates and map
 * detail enabled it shows an AMap static image and projects stops onto it with
 * the same Web Mercator math; otherwise (offline, failed, zoomed out, or no
 * coordinates) it falls back to the generated sketch.
 *
 * `anchor` places a single `location` (place widgets put it under the pin);
 * `box` is where a route's stops should sit inside the container.
 */
export function MapSketch({
  seed = 'default',
  w = 168,
  h = 168,
  stops = [],
  legs = [],
  box = null,
  anchor = null,
  location = null,
  className = '',
}) {
  const detail = useContext(MapDetailContext);
  const staticOk = useStaticMapAvailable();
  // static image → raster tiles → generated sketch, each step on failure
  const [failed, setFailed] = useState({ static: false, tiles: false });
  const bgMarkup = useMemo(() => mapSvg(seed, w, h), [seed, w, h]);

  const located = useMemo(() => stops.filter((s) => s.lng != null && s.lat != null), [stops]);
  const lng = location?.lng;
  const lat = location?.lat;
  const ax = anchor?.x ?? w / 2;
  const ay = anchor?.y ?? h / 2;
  const view = useMemo(() => {
    if (lng != null && lat != null) {
      return geoFit([[lng, lat]], { x: ax, y: ay, w: 0, h: 0 }, w, h, { singleZoom: 16 });
    }
    if (located.length && box) {
      return geoFit(
        located.map((s) => [s.lng, s.lat]),
        box,
        w,
        h,
      );
    }
    return null;
  }, [lng, lat, ax, ay, located, box, w, h]);

  const offline = typeof navigator !== 'undefined' && navigator.onLine === false;
  const real = Boolean(detail && view && !offline);
  const mode = !real
    ? 'sketch'
    : staticOk && !failed.static
      ? 'static'
      : !failed.tiles
        ? 'tiles'
        : 'sketch';
  const useStatic = mode !== 'sketch';
  const showOfflineBadge = Boolean(detail && view && mode === 'sketch');
  const tiles = useMemo(() => (mode === 'tiles' ? geoTiles(view, w, h) : []), [mode, view, w, h]);

  const projectPoints = (pts) =>
    useStatic ? geoProject(pts, view, w, h) : project(pts, box || { x: 0, y: 0, w, h });

  let paths = null;
  let stopElements = null;

  if (located.length && box) {
    const projected = projectPoints(located.map((s) => [s.lng, s.lat]));
    const posMap = new Map();
    located.forEach((s, i) => posMap.set(s.id, projected[i]));

    const pathSegments = [];
    legs.forEach((l) => {
      const p = posMap.get(l.fromId);
      const q = posMap.get(l.toId);
      if (!p || !q) return;

      let g;
      if (l.path && l.path.length > 1) {
        const pPath = useStatic ? projectPoints(l.path) : project(l.path, box);
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
            stroke="var(--map-route)"
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
          const skyColor = s.sky?.c || 'var(--map-route)';
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
      className={`map-sketch-container ${useStatic ? 'is-static' : ''} ${className}`}
      style={{ position: 'absolute', inset: 0, overflow: 'hidden' }}
    >
      {mode === 'static' ? (
        <img
          className="static-map"
          src={staticMapUrl(view, w, h)}
          alt=""
          draggable={false}
          loading="lazy"
          onError={() => setFailed((f) => ({ ...f, static: true }))}
        />
      ) : mode === 'tiles' ? (
        <div className="map-tiles" aria-hidden="true">
          {tiles.map((t) => (
            <img
              key={`${t.z}/${t.x}/${t.y}`}
              src={tileUrl(t)}
              alt=""
              draggable={false}
              loading="lazy"
              referrerPolicy="no-referrer"
              style={{ left: t.left, top: t.top, width: t.size, height: t.size }}
              onError={() => setFailed((f) => ({ ...f, tiles: true }))}
            />
          ))}
        </div>
      ) : (
        <div
          className="sketch-map"
          dangerouslySetInnerHTML={{ __html: bgMarkup }}
          style={{ width: '100%', height: '100%', position: 'absolute', inset: 0 }}
        />
      )}
      {paths}
      {stopElements}
      {showOfflineBadge && <span className="map-offline">{offline ? '离线' : '地图未载入'}</span>}
    </div>
  );
}
