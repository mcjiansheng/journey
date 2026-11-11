import { createContext, useEffect, useState } from 'react';

// Whether map widgets may load real map imagery. The board turns this on only
// when the canvas is zoomed in enough for the detail to matter and the browser
// is online; the sticker panel turns it on for its few previews.
export const MapDetailContext = createContext(false);

const base = () => (import.meta.env?.BASE_URL ?? '/').replace(/\/?$/, '/');

// AMap static images need a "Web 服务" key on the server (AMAP_WEB_KEY). When the
// server has none, widgets compose the same AMap raster tiles the JS API uses.
let configPromise = null;
let staticAvailable = false;
function loadConfig() {
  configPromise ||= fetch(`${base()}api/config`, { credentials: 'same-origin' })
    .then((r) => (r.ok ? r.json() : {}))
    .then((c) => (staticAvailable = Boolean(c?.staticMap)))
    .catch(() => false);
  return configPromise;
}
export function useStaticMapAvailable() {
  const [ok, setOk] = useState(staticAvailable);
  useEffect(() => {
    let alive = true;
    loadConfig().then((v) => alive && setOk(v));
    return () => {
      alive = false;
    };
  }, []);
  return ok;
}

export function staticMapUrl({ lng, lat, zoom }, w, h) {
  const params = new URLSearchParams({
    location: `${lng.toFixed(6)},${lat.toFixed(6)}`,
    zoom: String(zoom),
    size: `${Math.round(w)}*${Math.round(h)}`,
    scale: '2',
  });
  return `${base()}_AMapService/v3/staticmap?${params}`;
}

export function tileUrl({ x, y, z }) {
  const s = 1 + ((x + y) % 4);
  return `https://webrd0${s}.is.autonavi.com/appmaptile?lang=zh_cn&size=1&scale=1&style=8&x=${x}&y=${y}&z=${z}`;
}
