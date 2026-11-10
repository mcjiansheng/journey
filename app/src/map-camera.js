// Camera provenance lives in personal navigation context, never shared trip data.
export const destinationKey = (value) => (typeof value === 'string' ? value.trim() : '');
export const validCenter = (value) =>
  Array.isArray(value) &&
  value.length === 2 &&
  value.every(Number.isFinite) &&
  Math.abs(value[0]) <= 180 &&
  Math.abs(value[1]) <= 90;
export const locatedPlace = (place) => validCenter([place?.lng, place?.lat]);
export const DEFAULT_CITY_CENTER = [116.397128, 39.916527];
export function currentCityFromAmap(AMap = globalThis.window?.AMap) {
  const location = AMap?.getConfig?.()?.defaultLocation;
  if (Array.isArray(location) && location.length >= 2) {
    const point = location.slice(-2).map(Number);
    if (validCenter(point)) return { name: '当前城市', lng: point[0], lat: point[1] };
  }
  return { name: '当前城市', lng: DEFAULT_CITY_CENTER[0], lat: DEFAULT_CITY_CENTER[1] };
}
const zoomOf = (value, fallback) =>
  Number.isFinite(value) && value >= 2 && value <= 20 ? value : fallback;
const atPlace = (source, place, destination) => ({
  source,
  place,
  destination,
  center: [place.lng, place.lat],
  zoom: 15,
});

export function planMapCamera({
  destination,
  saved = {},
  activityPlace = null,
  userPlace = null,
  favorites = [],
}) {
  const key = destinationKey(destination);
  // A selection made while initialization is pending supersedes the older entry intent.
  if (locatedPlace(userPlace)) return atPlace('place', userPlace, key);
  if (locatedPlace(activityPlace)) return atPlace('activity', activityPlace, key);
  const marked =
    typeof saved.cameraDestination === 'string' &&
    saved.cameraDestination === key &&
    (!key || saved.cameraSource !== 'current-city');
  if (marked && validCenter(saved.center))
    return {
      source: 'viewport',
      destination: key,
      center: [...saved.center],
      zoom: zoomOf(saved.zoom, 12),
    };
  // Unmarked legacy centers may be the SDK's Beijing default and are not evidence of a destination.
  if (key) return { source: 'destination', destination: key, zoom: 12 };
  if (locatedPlace(saved.selected)) return atPlace('place', saved.selected, key);
  const favorite = favorites.map((value) => value?.payload || value).find(locatedPlace);
  if (favorite) return atPlace('favorite', favorite, key);
  return { source: 'empty', destination: key, zoom: 12 };
}
function checkAbort(signal) {
  if (signal?.aborted) throw signal.reason || new DOMException('地图初始化已取消', 'AbortError');
}
async function resolveFallbackCamera(plan, fallback = currentCityFromAmap, signal) {
  checkAbort(signal);
  let city = null;
  try {
    city = typeof fallback === 'function' ? await fallback(signal) : fallback;
  } catch {
    checkAbort(signal);
  }
  checkAbort(signal);
  const center = locatedPlace(city)
    ? [city.lng, city.lat]
    : validCenter(city)
      ? [...city]
      : [...DEFAULT_CITY_CENTER];
  return {
    ...plan,
    source: 'current-city',
    center,
    zoom: zoomOf(plan.zoom, 12),
  };
}
export async function resolveMapCamera(plan, lookup, signal, fallback) {
  checkAbort(signal);
  if (plan.source === 'empty') return resolveFallbackCamera(plan, fallback, signal);
  if (plan.source !== 'destination') return plan;
  let place = null;
  try {
    place = await lookup(plan.destination, signal);
  } catch {
    checkAbort(signal);
    return resolveFallbackCamera(plan, fallback, signal);
  }
  checkAbort(signal);
  if (!locatedPlace(place)) return resolveFallbackCamera(plan, fallback, signal);
  return { ...plan, center: [place.lng, place.lat] };
}
export function cameraContext(camera) {
  if (!validCenter(camera.center)) throw new Error('地图视口坐标无效');
  return {
    center: [...camera.center],
    zoom: zoomOf(camera.zoom, 12),
    cameraDestination: camera.destination,
    cameraSource: camera.source,
  };
}
