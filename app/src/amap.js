import AMapLoader from '@amap/amap-jsapi-loader';
import { api } from './sync';

let promise;
export async function loadAmap(config) {
 if(!promise)promise=(async()=>{
   const c=config||await api('/api/config');
   if(!c.amapKey)throw new Error('地图暂时无法载入，请稍后重试');
   window._AMapSecurityConfig={serviceHost:location.origin+import.meta.env.BASE_URL.replace(/\/$/,'')+'/_AMapService'};
   const AMap=await AMapLoader.load({key:c.amapKey,version:'2.0'});
   const plugins=['AMap.PlaceSearch','AMap.AutoComplete','AMap.Geocoder','AMap.Walking','AMap.Driving','AMap.Riding','AMap.Transfer','AMap.Scale'];
   await new Promise((resolve,reject)=>{
     const timer=setTimeout(()=>reject(new Error('地图工具载入超时，请重试')),20000);
     AMap.plugin(plugins,()=>{clearTimeout(timer);plugins.every(p=>typeof AMap[p.split('.')[1]]==='function')?resolve():reject(new Error('地图工具未能载入，请重试'));});
   });
   return AMap;
 })().catch(e=>{promise=null;throw e;});
 return promise;
}
const str=v=>typeof v==='string'?v:'';
const num=v=>Number.isFinite(Number(v))&&v!==''&&v!==null?Number(v):null;
export function normalizePlace(p) {
 const coords=p.location;
 const lng=coords?.getLng?.()??coords?.lng??(typeof coords==='string'?num(coords.split(',')[0]):null);
 const lat=coords?.getLat?.()??coords?.lat??(typeof coords==='string'?num(coords.split(',')[1]):null);
 const category=str(p.type).split(';')[0]||'';
 return {name:str(p.name),address:str(p.address)||str(p.district),lng:num(lng),lat:num(lat),provider:'amap',providerPlaceId:str(p.id)||null,category,sourceUrl:'',fetchedAt:Date.now(),coordSystem:'GCJ-02'};
}
function call(service,method,args) {
 return new Promise((resolve,reject)=>{
   const timeout=setTimeout(()=>reject(new Error('地图查询超时，请重试')),15000);
   service[method](...args,(status,result)=>{
     clearTimeout(timeout);
     if(status==='complete')resolve(result);
     else if(status==='no_data')resolve(null);
     else reject(new Error('地图查询未完成，请重试'));
   });
 });
}
export async function searchPlaces(query,city='') {
 const AMap=await loadAmap();const search=new AMap.PlaceSearch({city:city||'全国',pageSize:20,extensions:'base'});
 const result=await call(search,'search',[query]);
 return result?.poiList?.pois?.map(normalizePlace)||[];
}
export async function suggestPlaces(query,city='') {
 const AMap=await loadAmap();const result=await call(new AMap.AutoComplete({city:city||'全国'}),'search',[query]);
 return result?.tips?.map(normalizePlace)||[];
}
export async function placeDetail(id) {
 const AMap=await loadAmap();const result=await call(new AMap.PlaceSearch({extensions:'base'}),'getDetails',[id]);
 return result?.poiList?.pois?.[0]?normalizePlace(result.poiList.pois[0]):null;
}
export async function geocode(address,city='') {
 const AMap=await loadAmap();const result=await call(new AMap.Geocoder({city:city||'全国'}),'getLocation',[address]);
 const p=result?.geocodes?.[0];return p?normalizePlace({...p,name:address,address:p.formattedAddress}):null;
}
export async function reverseGeocode(lng,lat) {
 const AMap=await loadAmap();const result=await call(new AMap.Geocoder({extensions:'base'}),'getAddress',[[lng,lat]]);
 const address=result?.regeocode?.formattedAddress||'';
 return {name:address,address,lng,lat,provider:'amap',providerPlaceId:null,category:'',sourceUrl:'',fetchedAt:Date.now(),coordSystem:'GCJ-02'};
}
export async function estimateRoute(from,to,mode='walking',city='') {
 if(![from?.lng,from?.lat,to?.lng,to?.lat].every(Number.isFinite))throw new Error('请先为两处地点选择地图位置');
 const AMap=await loadAmap();
 const Service={walking:AMap.Walking,driving:AMap.Driving,bicycling:AMap.Riding,transit:AMap.Transfer}[mode];
 if(!Service)throw new Error('请选择交通方式');
 if(mode==='transit'&&!city)throw new Error('请先填写旅程目的地，以查询公交路线');
 const service=new Service({...(mode==='transit'?{city}:{}),extensions:'base'});
 const result=await call(service,'search',[[from.lng,from.lat],[to.lng,to.lat]]);
 const route=result?.routes?.[0]||result?.plans?.[0];
 if(!route||!Number.isFinite(route.time))throw new Error('未找到可用路线，可自行填写通勤时间');
 const coords=[];
 const append=values=>{for(const p of values||[]){const lng=p.getLng?.()??p.lng??p[0];const lat=p.getLat?.()??p.lat??p[1];if(Number.isFinite(lng)&&Number.isFinite(lat))coords.push([lng,lat]);}};
 for(const step of route.steps||route.rides||[])append(step.path);
 for(const segment of route.segments||[]){for(const s of segment.walking?.steps||[])append(s.path);for(const b of segment.bus?.buslines||[])append(b.path);}
 if(!coords.length)append(route.path);
 return {minutes:Math.ceil(route.time/60),distance:Number.isFinite(route.distance)?route.distance:null,path:coords};
}
