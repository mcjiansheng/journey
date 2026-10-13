// Camera provenance lives in personal navigation context, never shared trip data.
export const destinationKey = value => typeof value === 'string' ? value.trim() : '';
export const validCenter = value => Array.isArray(value) && value.length === 2
  && value.every(Number.isFinite) && Math.abs(value[0]) <= 180 && Math.abs(value[1]) <= 90;
export const locatedPlace = place => validCenter([place?.lng, place?.lat]);
const zoomOf = (value, fallback) => Number.isFinite(value) && value >= 2 && value <= 20 ? value : fallback;
const atPlace = (source, place, destination) => ({source, place, destination, center:[place.lng,place.lat],zoom:15});

export function planMapCamera({destination,saved={},activityPlace=null,userPlace=null,favorites=[]}) {
  const key = destinationKey(destination);
  // A selection made while initialization is pending supersedes the older entry intent.
  if (locatedPlace(userPlace)) return atPlace('place',userPlace,key);
  if (locatedPlace(activityPlace)) return atPlace('activity',activityPlace,key);
  const marked = typeof saved.cameraDestination === 'string' && saved.cameraDestination === key;
  if (marked && validCenter(saved.center)) return {source:'viewport',destination:key,center:[...saved.center],zoom:zoomOf(saved.zoom,12)};
  // Unmarked legacy centers may be the SDK's Beijing default and are not evidence of a destination.
  if (key) return {source:'destination',destination:key,zoom:12};
  if (locatedPlace(saved.selected)) return atPlace('place',saved.selected,key);
  const favorite = favorites.map(value=>value?.payload||value).find(locatedPlace);
  if (favorite) return atPlace('favorite',favorite,key);
  return {source:'empty',destination:key};
}
function checkAbort(signal) {
  if (signal?.aborted) throw signal.reason || new DOMException('地图初始化已取消','AbortError');
}
export async function resolveMapCamera(plan,lookup,signal) {
  checkAbort(signal);
  if (plan.source === 'empty') throw new Error('先填写旅程目的地，或搜索并选择一个地点。');
  if (plan.source !== 'destination') return plan;
  let place;
  try { place = await lookup(plan.destination,signal); }
  catch (error) {
    checkAbort(signal);
    throw new Error(`暂时无法定位旅程目的地「${plan.destination}」。${error.message||'请稍后重试。'}`);
  }
  checkAbort(signal);
  if (!locatedPlace(place)) throw new Error(`未找到旅程目的地「${plan.destination}」，请检查名称，或搜索并选择地点。`);
  return {...plan,center:[place.lng,place.lat]};
}
export function cameraContext(camera) {
  if (!validCenter(camera.center)) throw new Error('地图视口坐标无效');
  return {center:[...camera.center],zoom:zoomOf(camera.zoom,12),cameraDestination:camera.destination,cameraSource:camera.source};
}
