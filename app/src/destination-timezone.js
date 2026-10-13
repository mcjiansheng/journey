// AMap's six-digit domestic administrative code identifies the destination's civil time.
// Mainland China uses Beijing time, including destinations in Xinjiang.
const MAINLAND_PREFIXES = new Set([
  '11','12','13','14','15','21','22','23','31','32','33','34','35','36','37',
  '41','42','43','44','45','46','50','51','52','53','54','61','62','63','64','65',
]);
const OTHER_ZONES = {'71':'Asia/Taipei','81':'Asia/Hong_Kong','82':'Asia/Macau'};
export function timezoneFromAdcode(adcode) {
  if (typeof adcode !== 'string' || !/^\d{6}$/.test(adcode)) return null;
  const province = adcode.slice(0,2);
  return MAINLAND_PREFIXES.has(province) ? 'Asia/Shanghai' : OTHER_ZONES[province] || null;
}
export function timezoneFromGeocodes(geocodes) {
  // Use the same first provider result as destination geocoding; do not search for a convenient fallback.
  return Array.isArray(geocodes) ? timezoneFromAdcode(geocodes[0]?.adcode) : null;
}
export function migrateTimezoneChoice(draft) {
  if (draft.timezoneChoice === 'device') return 'destination';
  if (draft.timezoneChoice) return draft.timezoneChoice;
  return draft.timezone && draft.timezone !== 'Asia/Shanghai' ? draft.timezone : 'destination';
}
export function validTimezone(zone) {
  if (typeof zone !== 'string' || !zone) return false;
  try { new Intl.DateTimeFormat('zh-CN',{timeZone:zone}); return true; }
  catch { return false; }
}
export function timezoneLabel(zone,reference) {
  const name=zone==='Asia/Shanghai' ? '北京时间' : new Intl.DateTimeFormat('zh-CN',{timeZone:zone,timeZoneName:'long'}).formatToParts(reference).find(p=>p.type==='timeZoneName').value;
  const offset=new Intl.DateTimeFormat('en',{timeZone:zone,timeZoneName:'longOffset'}).formatToParts(reference).find(p=>p.type==='timeZoneName').value.replace('GMT','UTC');
  return `${name}（${offset}）`;
}
