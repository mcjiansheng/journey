import { createContext } from 'react';

// Whether map widgets may load real AMap static images. The board turns this on
// only when the canvas is zoomed in enough for the detail to matter and the
// browser is online; previews in the sticker panel keep the offline sketch.
export const MapDetailContext = createContext(false);

export function staticMapUrl({ lng, lat, zoom }, w, h) {
  const base = (import.meta.env?.BASE_URL ?? '/').replace(/\/?$/, '/');
  const params = new URLSearchParams({
    location: `${lng.toFixed(6)},${lat.toFixed(6)}`,
    zoom: String(zoom),
    size: `${Math.round(w)}*${Math.round(h)}`,
    scale: '2',
  });
  return `${base}_AMapService/v3/staticmap?${params}`;
}
