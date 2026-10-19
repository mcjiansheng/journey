const text=value=>typeof value==='string'?value.trim():'';

export function safePlaceUrl(value) {
 const candidate=text(value);
 if(!/^https?:\/\//i.test(candidate))return '';
 try{const url=new URL(candidate);return url.username||url.password?'':url.href;}catch{return '';}
}

function photoUrl(value) {
 const safe=safePlaceUrl(value);
 if(!safe)return '';
 const url=new URL(safe);
 // Provider photos still arrive as HTTP; match the existing HTTPS-only CSP.
 if(url.hostname.endsWith('.amap.com')||url.hostname.endsWith('.autonavi.com'))url.protocol='https:';
 return url.href;
}

// AMap JSAPI maps deep_info into the named scenic/dining/cinema/hotel objects.
// Keep these optional display facts separate from the persisted place schema.
export function normalizePlaceInformation(p={}) {
 const detail=[p.scenic,p.dining,p.cinema,p.hotel].find(value=>value&&typeof value==='object')||{};
 const photos=[...(Array.isArray(p.photos)?p.photos:[]),...(Array.isArray(detail.photos)?detail.photos:[])];
 const photo=photos.map(value=>({url:photoUrl(value?.url),title:text(value?.title)})).find(value=>value.url)||null;
 const telephone=text(p.tel);
 const firstTelephone=telephone.split(/[;,；，]/)[0].trim();
 const telephoneUrl=/^\+?[\d\s()-]{3,30}$/.test(firstTelephone)?`tel:${firstTelephone.replace(/[\s()-]/g,'')}`:'';
 const type=text(p.type).split(';').map(value=>value.trim()).filter(Boolean).at(-1)||'';
 const id=text(p.id);
 // Current JSAPI flattens biz_ext.open_time/opentime2 onto the returned POI.
 return {type,photo,openingHours:text(p.opentime2)||text(p.open_time)||text(detail.opentime)||text(detail.openingtime),telephone,telephoneUrl,website:safePlaceUrl(p.website),introduction:text(detail.intro),detailUrl:id?`https://www.amap.com/place/${encodeURIComponent(id)}`:''};
}
