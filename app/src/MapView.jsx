import React,{useEffect,useLayoutEffect,useMemo,useRef,useState} from 'react';
import {Search,Star,Plus,X,LocateFixed,SlidersHorizontal,ChevronUp,ChevronDown,MapPin,Navigation,RefreshCw,ArrowLeft,List} from 'lucide-react';
import {loadAmap,normalizePlace,searchPlaces,suggestPlaces,placeDetail,reverseGeocode,estimateRoute,geocode} from './amap';
import {orderedActivities,visibleDays,dayLabel,routeSignature,endpointSignature} from './domain';
import {destinationKey,validCenter,planMapCamera,resolveMapCamera,cameraContext} from './map-camera.js';
import MapRoutePicker from './components/MapRoutePicker.jsx';
import SelectionTrack from './components/SelectionTrack.jsx';
import {reducedMotion} from './usePageNavigation.js';
import {createMapMarker} from './map-marker.js';
import PlaceInformation from './components/PlaceInformation.jsx';
import './map.css';
import './map-markers.css';

const located=p=>Number.isFinite(p?.lng)&&Number.isFinite(p?.lat);
const keyOf=p=>p?.providerPlaceId?`amap:${p.providerPlaceId}`:JSON.stringify([p?.name,p?.address,p?.lng,p?.lat]);
const category=p=>/餐|食|咖啡|茶/.test(p.category)?'餐饮':/住宿|酒店/.test(p.category)?'住宿':/景|公园|博物|文化/.test(p.category)?'景点':/交通|机场|车站/.test(p.category)?'交通':'其他';
export default function MapView({journey:j,onEditActivity}) {
 const {snapshot,context}=j,trip=snapshot.trip,initial=context.map||{};
 const initialPlace=initial.selectedActivityId?snapshot.objects.find(o=>o.id===initial.selectedActivityId)?.payload.place:initial.selected;
 const [query,setQuery]=useState(initial.query||''),[results,setResults]=useState([]),[suggestions,setSuggestions]=useState([]),[selected,setSelected]=useState(initialPlace||null),[mode,setMode]=useState(initialPlace?'detail':'browse'),[expanded,setExpanded]=useState(false),[error,setError]=useState(''),[mapError,setMapError]=useState(''),[busy,setBusy]=useState(false),[ready,setReady]=useState(0),[mapEpoch,setMapEpoch]=useState(0),[routeDay,setRouteDay]=useState(initial.dayId||initial.routeDay||''),[filter,setFilter]=useState(initial.filter||{category:'全部',arranged:'全部'}),[filterDraft,setFilterDraft]=useState(filter),[manual,setManual]=useState({name:'',address:''}),[keyboardOpen,setKeyboardOpen]=useState(false),[cameraChoice,setCameraChoice]=useState(null),[cameraLoading,setCameraLoading]=useState(false);
 const panelAnimation=useRef(null),panelHeight=useRef(null),filterButton=useRef(null);
 const [composing,setComposing]=useState(false),[searchStatus,setSearchStatus]=useState('idle'),[searchAttempt,setSearchAttempt]=useState(0),[placeLoading,setPlaceLoading]=useState(false);
 const [placeInformation,setPlaceInformation]=useState(null);
 const restoredInformation=useRef(false);
 const canvas=useRef(null),panel=useRef(null),map=useRef(null),markers=useRef([]),lines=useRef([]),searchSeq=useRef(0),selectionSeq=useRef(0),pointClickTimer=useRef(null),cameraTimer=useRef(null),lastContext=useRef(initial),alive=useRef(true),snapshotRef=useRef(snapshot),selectRef=useRef(null),pickRef=useRef(null),modeRef=useRef(mode);
 modeRef.current=mode;
 snapshotRef.current=snapshot;
 const cameraGeneration=useRef(0),cameraIntent=useRef(0),activityIntent=useRef(initial.selectedActivityId||null),consumedChoice=useRef(null),cameraRequest=useRef(0);
 const favorites=snapshot.objects.filter(x=>x.kind==='favorite'&&x.state==='active');
 const days=visibleDays(snapshot);
 const activeDayIds=new Set(snapshot.objects.filter(x=>x.kind==='day'&&x.state==='active').map(x=>x.id));
 const activities=snapshot.objects.filter(x=>x.kind==='activity'&&x.state==='active'&&activeDayIds.has(x.payload.dayId));
 const isArranged=p=>activities.some(a=>a.payload.place&&keyOf(a.payload.place)===keyOf(p));
 const visibleFavorites=favorites.filter(o=>(filter.category==='全部'||category(o.payload)===filter.category)&&(filter.arranged==='全部'||isArranged(o.payload)===(filter.arranged==='已安排')));
 // Measure the new natural size, then continue from the currently visible height.
 useLayoutEffect(()=>{
   const element=panel.current;
   const before=panelAnimation.current?.playState==='running'?element.getBoundingClientRect().height:panelHeight.current;
   panelAnimation.current?.cancel();
   const after=element.getBoundingClientRect().height;
   panelHeight.current=after;
   if(before!==null&&Math.abs(after-before)>1&&!reducedMotion())
     panelAnimation.current=element.animate([{height:`${before}px`},{height:`${after}px`}],{duration:220,easing:'cubic-bezier(.2,.7,.2,1)'});
 },[mode,expanded,selected,results,suggestions,error,filter,favorites.length]);
 useEffect(()=>()=>panelAnimation.current?.cancel(),[]);
 useLayoutEffect(()=>{if(mode==='filter'||mode==='pick')panel.current.querySelector('.map-panel-title button')?.focus()},[mode]);
 const routeActivities=useMemo(()=>routeDay&&snapshot.objects.some(x=>x.id===routeDay&&x.kind==='day'&&x.state==='active')?orderedActivities(snapshot,routeDay):[],[snapshot,routeDay]);
 const saveMap=patch=>{lastContext.current={...lastContext.current,...patch};j.setContext({map:lastContext.current});};
 selectRef.current=(p,options)=>choose(p,options);
 pickRef.current=point=>pickAt(point);
 useEffect(()=>{const resize=()=>{const v=window.visualViewport,nextHeight=v?.height||innerHeight;document.documentElement.style.setProperty('--visual-height',`${nextHeight}px`);setKeyboardOpen(!!v&&innerHeight-v.height-v.offsetTop>100);};resize();window.visualViewport?.addEventListener('resize',resize);return()=>window.visualViewport?.removeEventListener('resize',resize);},[]);
 useEffect(()=>{saveMap({query,selected,routeDay,filter});},[query,selected,routeDay,filter]);
 useEffect(()=>{
   if(!ready||restoredInformation.current)return;
   restoredInformation.current=true;
   if(selected?.providerPlaceId&&modeRef.current==='detail'&&!placeLoading)hydratePlace(selected,selectionSeq.current,false,cameraIntent.current,true);
 },[ready]);
 useEffect(()=>{
   alive.current=true;let instance,disposed=false,initialized=false,userMoved=false;
   const generation=++cameraGeneration.current,entryIntent=cameraIntent.current,controller=new AbortController();
   setMapError('');setCameraLoading(true);
   const currentActivity=activityIntent.current?snapshotRef.current.objects.find(o=>o.id===activityIntent.current&&o.kind==='activity'&&o.state==='active'&&snapshotRef.current.objects.some(d=>d.id===o.payload.dayId&&d.state==='active')):null;
   const plan=planMapCamera({destination:trip.destination,saved:lastContext.current,activityPlace:currentActivity?.payload.place,userPlace:cameraChoice&&cameraChoice!==consumedChoice.current&&cameraChoice.destination===destinationKey(trip.destination)?cameraChoice.place:null,favorites:snapshotRef.current.objects.filter(o=>o.kind==='favorite'&&o.state==='active')});
   if(plan.source==='destination'&&!currentActivity&&lastContext.current.cameraDestination!==destinationKey(trip.destination)){setSelected(null);setMode('browse');}
   function current(){return !disposed&&generation===cameraGeneration.current;}
   function persistCamera(source='viewport',extra={}){
     if(!current()||map.current!==instance||!initialized)return;
     const center=instance.getCenter(),point=[center.lng,center.lat];
     if(validCenter(point))saveMap({...cameraContext({center:point,zoom:instance.getZoom(),destination:destinationKey(trip.destination),source}),...extra});
   }
   (async()=>{
     const AMap=await loadAmap(j.config);
     if(!current())return;
     const camera=await resolveMapCamera(plan,(destination,signal)=>geocode(destination,'',{signal}),controller.signal);
     if(!current())return;
     instance=new AMap.Map(canvas.current,{viewMode:'2D',zoom:camera.zoom,center:camera.center,resizeEnable:true,isHotspot:true});
     map.current=instance;
     instance.on('complete',()=>{
       if(!current()||initialized||map.current!==instance)return;
       initialized=true;activityIntent.current=null;consumedChoice.current=cameraChoice;setReady(v=>v+1);setCameraLoading(false);
       if(!userMoved&&entryIntent===cameraIntent.current&&(camera.source==='activity'||camera.source==='place'))shiftCamera(camera.place);
       persistCamera(camera.source,{selectedActivityId:null});
     });
     instance.on('moveend',()=>persistCamera());
     instance.on('zoomend',()=>persistCamera());
     instance.on('dragstart',()=>{userMoved=true;cameraIntent.current++;clearTimeout(cameraTimer.current);instance.stopMove?.();});
     // Also invalidate pending navigation on wheel, pinch or zoom-control input.
     // Do not stopMove here: this event also accompanies our own camera transition.
     instance.on('zoomstart',()=>{userMoved=true;cameraIntent.current++;clearTimeout(cameraTimer.current);});
     instance.on('hotspotclick',event=>{
       if(!current()||!['browse','search','detail','pick','list'].includes(modeRef.current))return;
       clearTimeout(pointClickTimer.current);
       selectRef.current(normalizePlace({...event,location:event.lnglat}),{details:true,moveCamera:false});
     });
     instance.on('click',event=>{
       if(!current()||modeRef.current!=='pick')return;
       // A hotspot can also emit a map click. Let its named POI take priority.
       clearTimeout(pointClickTimer.current);
       pointClickTimer.current=setTimeout(()=>{if(current()&&modeRef.current==='pick')pickRef.current(event.lnglat);},0);
     });
     instance.addControl(new AMap.Scale({position:'LT',offset:new AMap.Pixel(16,96)}));

   })().catch(error=>{if(current()){instance?.destroy();if(map.current===instance)map.current=null;setCameraLoading(false);setMapError(error.message);}});
   return()=>{alive.current=false;disposed=true;controller.abort();clearTimeout(cameraTimer.current);clearTimeout(pointClickTimer.current);searchSeq.current++;selectionSeq.current++;instance?.destroy();if(map.current===instance){map.current=null;markers.current=[];lines.current=[];}};
 },[trip.id,trip.destination,mapEpoch,cameraChoice]);
 useEffect(()=>{
   if(!map.current||!window.AMap)return;
   const AMap=window.AMap,m=map.current;m.remove(markers.current);m.remove(lines.current);markers.current=[];lines.current=[];
   const add=(p,options={})=>{if(!located(p))return;const node=createMapMarker(p,options);const marker=new AMap.Marker({position:[p.lng,p.lat],content:node,offset:new AMap.Pixel(-22,options.selected?-44:-22),zIndex:options.selected?30:options.order!==undefined?20:10});marker.on('click',()=>selectRef.current(p,{preservePlace:true,moveCamera:false}));markers.current.push(marker);};
   const isSelected=p=>selected&&keyOf(p)===keyOf(selected);
   visibleFavorites.filter(o=>!isSelected(o.payload)&&!routeActivities.some(a=>keyOf(a.payload.place)===keyOf(o.payload))).forEach(o=>add(o.payload,{saved:true,arranged:isArranged(o.payload)}));
   routeActivities.forEach((a,i)=>{if(!isSelected(a.payload.place))add(a.payload.place,{order:i+1})});
   if(selected)add(selected,{selected:true,saved:favorites.some(o=>keyOf(o.payload)===keyOf(selected))});
   for(let i=1;i<routeActivities.length;i++){
     const from=routeActivities[i-1],to=routeActivities[i];
     if(!located(from.payload.place)||!located(to.payload.place))continue;
     const route=snapshot.objects.find(x=>x.kind==='route'&&x.state==='active'&&x.payload.fromId===from.id&&x.payload.toId===to.id);
     if(!route?.payload.path?.length||route.payload.inputSignature!==routeSignature(from,to,route.payload.mode))continue;
     lines.current.push(new AMap.Polyline({path:route.payload.path,strokeColor:'#18786b',strokeWeight:5,strokeOpacity:.8,showDir:true}));
   }
   m.add([...lines.current,...markers.current]);
 },[ready,snapshot,routeDay,filter,selected]);
 useEffect(()=>{
   if(!routeDay||!navigator.onLine||!map.current)return;
   let disposed=false;
   (async()=>{for(let i=1;i<routeActivities.length&&!disposed;i++){
     const from=routeActivities[i-1],to=routeActivities[i];
     if(!located(from.payload.place)||!located(to.payload.place))continue;
     const old=snapshotRef.current.objects.find(x=>x.kind==='route'&&x.payload.fromId===from.id&&x.payload.toId===to.id);
     if(old?.state==='deleted')continue;
     const mode=old?.payload.mode||'walking',signature=routeSignature(from,to,mode);
     if(old?.payload.inputSignature===signature)continue;
     // A manual duration survives mode/time changes while its endpoints stay fixed.
     if(old?.payload.manual){try{if(JSON.parse(old.payload.inputSignature)[0]===endpointSignature(from,to))continue;}catch{}}
     try{
       const route=await estimateRoute(from.payload.place,to.payload.place,mode,trip.destination);
       if(disposed||!alive.current)return;
       const currentFrom=snapshotRef.current.objects.find(x=>x.id===from.id),currentTo=snapshotRef.current.objects.find(x=>x.id===to.id);
       if(routeSignature(currentFrom,currentTo,mode)!==signature)continue;
       const current=snapshotRef.current.objects.find(x=>x.id===old?.id);
       if(current?.payload.manual&&current.payload.inputSignature===signature)continue;
       await j.mutate({kind:old?'patch':'create',objectId:old?.id||crypto.randomUUID(),objectType:'route',patch:{fromId:from.id,toId:to.id,mode,...route,manual:false,inputSignature:signature}});
     }catch(e){if(!disposed)setError(e.message);}
   }})();return()=>{disposed=true;};
 },[routeDay,routeActivities.map(x=>x.id+keyOf(x.payload.place)).join('|'),ready]);
 useEffect(()=>{
   const seq=++searchSeq.current;
   setResults([]);setSuggestions([]);setSearchStatus('idle');
   if(mode!=='search'||composing||!query.trim())return;
   setSearchStatus('loading');setError('');
   const timer=setTimeout(async()=>{
     const [search,suggest]=await Promise.allSettled([searchPlaces(query.trim(),trip.destination),suggestPlaces(query.trim(),trip.destination)]);
     if(seq!==searchSeq.current||!alive.current)return;
     const places=search.status==='fulfilled'?search.value:[],tips=suggest.status==='fulfilled'?suggest.value.filter(t=>t.name):[];
     setResults(places);setSuggestions(tips.filter(t=>t.name&&!places.some(p=>keyOf(p)===keyOf(t)||(!t.providerPlaceId&&p.name===t.name))).slice(0,5));
     setSearchStatus(!places.length&&!tips.length&&(search.status==='rejected'||suggest.status==='rejected')?'error':'success');
   },350);return()=>{clearTimeout(timer);searchSeq.current++;};
 },[query,mode,trip.destination,composing,searchAttempt]);
 function shiftCamera(p,allowInitialize=false){
   if(!located(p))return;
   if(!map.current){if(allowInitialize)setCameraChoice({place:p,destination:destinationKey(trip.destination)});return;}
   clearTimeout(cameraTimer.current);const targetMap=map.current,intent=cameraIntent.current,request=++cameraRequest.current;
   cameraTimer.current=setTimeout(async()=>{
     // One camera transition targets the space beside/below the settled panel.
     // Panel updates themselves never change the user's viewport.
     while(panelAnimation.current?.playState==='running')await panelAnimation.current.finished.catch(()=>{});
     if(map.current!==targetMap||cameraIntent.current!==intent||cameraRequest.current!==request)return;
     const r=panel.current?.getBoundingClientRect(),canvasBounds=canvas.current?.getBoundingClientRect();
     if(!r||!canvasBounds)return;
     const zoom=Math.max(15,targetMap.getZoom());
     let offsetX=0,offsetY=0;
     if(innerWidth<=760){
       const viewport=window.visualViewport,viewportBottom=(viewport?.offsetTop||0)+(viewport?.height||innerHeight);
       const navigation=document.querySelector('.bottom-nav')?.getBoundingClientRect();
       const bottom=Math.min(viewportBottom,navigation?.height?navigation.top:viewportBottom);
       offsetY=(r.bottom+bottom)/2-(canvasBounds.top+canvasBounds.height/2);
     }else offsetX=(r.width+80)/2;
     const point=targetMap.lngLatToPixel([p.lng,p.lat],zoom);
     const center=targetMap.pixelToLngLat(new window.AMap.Pixel(point.x-offsetX,point.y-offsetY),zoom);
     targetMap.setZoomAndCenter(zoom,center,reducedMotion(),360);
   },60);
 }

 function beginTask(nextMode){
   selectionSeq.current++;searchSeq.current++;cameraIntent.current++;clearTimeout(cameraTimer.current);clearTimeout(pointClickTimer.current);map.current?.stopMove?.();
   setBusy(false);setPlaceLoading(false);setError('');modeRef.current=nextMode;setMode(nextMode);
 }
 function showPlace(p,moveCamera){
   setSelected(p);setPlaceInformation(null);modeRef.current='detail';setMode('detail');setExpanded(false);
   document.activeElement?.blur?.();if(moveCamera)shiftCamera(p,true);
 }
 async function choose(p,{moveCamera=true,preservePlace=false}={}){
   beginTask('detail');const sequence=selectionSeq.current,intent=cameraIntent.current;showPlace(p,moveCamera);
   if(p.providerPlaceId)await hydratePlace(p,sequence,moveCamera&&!located(p),intent,preservePlace);
 }
 async function hydratePlace(p,sequence,moveCamera,intent,preservePlace=false){
   setPlaceLoading(true);
   try{
     const detail=await placeDetail(p.providerPlaceId);
     if(sequence!==selectionSeq.current||!alive.current)return;
     if(detail){
       const {information,...place}=detail;
       setSelected(preservePlace&&located(p)?p:place);
       setPlaceInformation(information);
       if(moveCamera&&cameraIntent.current===intent)shiftCamera(place,true);
     }
   }catch(e){if(sequence===selectionSeq.current&&alive.current)setError(e.message);}
   finally{if(sequence===selectionSeq.current&&alive.current)setPlaceLoading(false);}
 }
 async function pickAt(point){
   const p=normalizePlace({name:'选定位置',location:point});if(!located(p))return;
   beginTask('detail');const sequence=selectionSeq.current;showPlace(p,false);setPlaceLoading(true);
   try{
     const detail=await reverseGeocode(p.lng,p.lat);
     if(sequence===selectionSeq.current&&alive.current)setSelected({...detail,name:detail.name||p.name});
   }catch(e){if(sequence===selectionSeq.current&&alive.current)setError(e.message);}
   finally{if(sequence===selectionSeq.current&&alive.current)setPlaceLoading(false);}
 }
 function updateQuery(value){searchSeq.current++;if(value===query)setSearchAttempt(n=>n+1);setQuery(value);setResults([]);setSuggestions([]);setSearchStatus('idle');}
 async function favorite(){if(!selected)return;setBusy(true);setError('');try{const existing=snapshot.objects.find(x=>x.kind==='favorite'&&keyOf(x.payload)===keyOf(selected));if(existing){if(existing.state==='deleted')setError('此收藏已删除，可在设置的已删除内容中恢复');return;}await j.mutate({kind:'create',objectId:crypto.randomUUID(),objectType:'favorite',patch:selected});}catch(e){setError(e.message);}finally{setBusy(false);}}
 const selectedFavorite=selected&&snapshot.objects.find(o=>o.kind==='favorite'&&keyOf(o.payload)===keyOf(selected));
 const member=snapshot.members.find(x=>x.userId===j.user.id),canDelete=trip.ownerId===j.user.id||trip.teamMode==='admin'&&member?.isAdmin;
 const arranged=selected?activities.filter(a=>a.payload.place&&keyOf(a.payload.place)===keyOf(selected)):[];
 async function removeFavorite(){try{await j.mutate(canDelete?{kind:'delete',objectId:selectedFavorite.id,generation:selectedFavorite.generation}:{kind:'express',objectId:selectedFavorite.id,generation:selectedFavorite.generation,expression:{wishDelete:true}});}catch(e){setError(e.message);}}
 function closeTask(){beginTask(selected?'detail':'browse');setExpanded(false);if(mode==='filter')filterButton.current?.focus();else document.activeElement?.blur?.();}
 const startActivity=async()=>{
   const target=context.map?.addingActivity;
   if(target){
     const existing=snapshot.objects.find(o=>o.id===target&&o.kind==='activity');
     const draft=context.drafts?.[`activity:${target}`]||existing?.payload||{};
     const next={...draft,place:selected};
     j.setDraft(`activity:${target}`,next);
     if(existing)await j.mutate({kind:'patch',objectId:target,patch:{place:selected}});
     saveMap({addingActivity:null});
     onEditActivity(existing||null,{...next,_draftId:target});
   }else onEditActivity(null,{place:selected,title:selected.name,...(routeDay?{dayId:routeDay}:{})});
 };
 function locate(){
   setError('');if(!navigator.geolocation){setError('此浏览器无法定位，请通过搜索选择地点');return;}
   const generation=cameraGeneration.current,intent=++cameraIntent.current;
   const current=()=>alive.current&&generation===cameraGeneration.current&&intent===cameraIntent.current;
   navigator.geolocation.getCurrentPosition(async pos=>{if(!current())return;try{const AMap=await loadAmap();if(!current())return;AMap.convertFrom([pos.coords.longitude,pos.coords.latitude],'gps',(status,result)=>{if(!current())return;const p=result.locations?.[0];if(status==='complete'&&p)shiftCamera({name:'当前位置',lng:p.getLng?.()??p.lng,lat:p.getLat?.()??p.lat},true);else setError('定位转换未完成，请重试');});}catch(e){if(current())setError(e.message);}},()=>{if(current())setError('未取得定位权限，请通过搜索选择地点');},{timeout:12000,maximumAge:30000});
 }
 return <section className={`journey-map ${mode==='search'?'map-searching':''} ${keyboardOpen?'map-keyboard-open':''}`} aria-label="地图与共享收藏">
   <div ref={canvas} className="map-canvas"/>
   <div className="map-upper-controls glass">
     <MapRoutePicker value={routeDay} options={[{value:'',label:'全部收藏'},...days.map(d=>({value:d.id,label:`${dayLabel(d,trip)}路线`,date:d.payload.date}))]} onChange={setRouteDay}/>
     <button ref={filterButton} className={`map-icon map-filter-toggle ${filter.category!=='全部'||filter.arranged!=='全部'?'has-filter':''}`} aria-label="筛选收藏" aria-expanded={mode==='filter'} aria-controls="map-place-panel" onClick={()=>{if(mode==='filter'){closeTask();return}setFilterDraft(filter);beginTask('filter');setExpanded(true)}}><SlidersHorizontal size={19}/></button>
   </div>
   {cameraLoading&&<div className="map-load-error glass" role="status"><MapPin size={22}/><span>正在定位地图…</span></div>}
   {mapError&&<div className="map-load-error glass" role="status"><MapPin size={22}/><span>{mapError}</span><button onClick={()=>setMapEpoch(v=>v+1)}><RefreshCw size={16}/>重试</button></div>}
   <div className="map-tools glass"><button className="map-icon" aria-label="放大地图" onClick={()=>map.current?.zoomIn()}><Plus size={20}/></button><button className="map-icon" aria-label="缩小地图" onClick={()=>map.current?.zoomOut()}>−</button><button className="map-icon" aria-label="定位到我" onClick={locate}><LocateFixed size={20}/></button></div>
   <div id="map-place-panel" ref={panel} onKeyDown={e=>{if(e.key==='Escape'&&!e.nativeEvent.isComposing&&!composing&&['filter','pick','search'].includes(mode)){e.preventDefault();closeTask()}}} className={`map-panel glass ${expanded||mode==='search'||mode==='filter'||mode==='manual'?'expanded':''} mode-${mode}`}>
     {mode==='filter'?<><div className="map-panel-title"><h2>筛选收藏</h2><button onClick={closeTask}>取消</button></div><fieldset><legend>类别</legend><SelectionTrack className="map-chips" activeKey={filterDraft.category}>{['全部','餐饮','景点','住宿','交通','其他'].map(c=><button key={c} className={filterDraft.category===c?'selected':''} aria-pressed={filterDraft.category===c} onClick={()=>setFilterDraft({...filterDraft,category:c})}>{c}</button>)}</SelectionTrack></fieldset><fieldset><legend>安排状态</legend><SelectionTrack className="map-chips" activeKey={filterDraft.arranged}>{['全部','已安排','未安排'].map(c=><button key={c} className={filterDraft.arranged===c?'selected':''} aria-pressed={filterDraft.arranged===c} onClick={()=>setFilterDraft({...filterDraft,arranged:c})}>{c}</button>)}</SelectionTrack></fieldset><button className="primary" onClick={()=>{setFilter(filterDraft);closeTask()}}>完成</button></>:
      mode==='manual'?<><div className="map-panel-title"><h2>{selected?'编辑地点':'手动填写地点'}</h2><button onClick={closeTask}>取消</button></div><label>名称<input value={manual.name} onChange={e=>setManual({...manual,name:e.target.value})}/></label><label>地址<input value={manual.address} onChange={e=>setManual({...manual,address:e.target.value})}/></label><label>类别<select value={manual.category||selected?.category||''} onChange={e=>setManual({...manual,category:e.target.value})}><option value="">未分类</option>{['餐饮','景点','住宿','交通','其他'].map(c=><option key={c}>{c}</option>)}</select></label><button className="primary" disabled={!manual.name.trim()} onClick={async()=>{const p={lng:null,lat:null,provider:null,providerPlaceId:null,sourceUrl:'',fetchedAt:null,coordSystem:'GCJ-02',...selected,...manual};if(selectedFavorite?.state==='active')await j.mutate({kind:'patch',objectId:selectedFavorite.id,patch:p});setSelected(p);setMode('detail');setExpanded(false);}}>完成</button></>:
      mode==='pick'?<div className="map-panel-title"><h2>点击地图选择位置</h2><button onClick={closeTask}>取消</button></div>:
      <><div className="map-search-row"><Search size={20}/><input aria-label="搜索地点" placeholder="搜索地点或地址" value={query} onFocus={()=>{if(mode!=='search')beginTask('search');setExpanded(true)}} onChange={e=>updateQuery(e.target.value)} onCompositionStart={()=>{searchSeq.current++;setComposing(true);setResults([]);setSuggestions([]);setSearchStatus('idle')}} onCompositionEnd={e=>{setComposing(false);updateQuery(e.currentTarget.value)}} onKeyDown={e=>{if(e.key==='Enter'&&!e.nativeEvent.isComposing&&!composing){e.preventDefault();setSearchAttempt(n=>n+1)}}}/>{mode==='search'?<button onClick={closeTask}>取消</button>:<button className="map-icon" aria-label="查看收藏列表" aria-expanded={mode==='list'} onClick={()=>{if(mode==='list')closeTask();else{beginTask('list');setExpanded(true)}}}><List size={20}/></button>}</div>
      {mode==='search'?<div className="map-panel-scroll"><div className="map-small-actions"><button onClick={()=>{beginTask('pick');setExpanded(false);document.activeElement?.blur?.()}} disabled={!map.current}><MapPin size={16}/>地图选点</button><button onClick={()=>{setSelected(null);setManual({name:query,address:''});beginTask('manual')}}>手动填写</button></div>{searchStatus==='loading'&&<p role="status">正在查找…</p>}{searchStatus==='error'&&<div className="map-search-error"><p role="alert">地点搜索暂时不可用，请重试</p><button onClick={()=>setSearchAttempt(n=>n+1)}><RefreshCw size={16}/>重试</button></div>}{searchStatus==='success'&&results.length===0&&suggestions.length===0&&<p className="map-empty" role="status">没有找到相关地点</p>}{suggestions.map((p,i)=><button key={keyOf(p)+i} className="map-result" onClick={()=>{const match=results.find(r=>r.name===p.name);p.providerPlaceId||located(p)?choose(p):match?choose(match):updateQuery(p.name)}}><Search size={17}/><span><strong>{p.name}</strong>{p.address&&<small>{p.address}</small>}</span></button>)}{results.map((p,i)=><button key={keyOf(p)+i} className="map-result" onClick={()=>choose(p)}><MapPin size={18}/><span><strong>{p.name}</strong>{p.address&&<small>{p.address}</small>}</span></button>)}</div>:
       mode==='detail'&&selected?<div className="map-panel-scroll"><div className="map-panel-title"><h2>{selected.name}</h2><button className="map-icon" aria-label="关闭地点" onClick={()=>{setSelected(null);beginTask('browse')}}><X size={18}/></button></div>{selected.address&&<p className="place-address">{selected.address}</p>}<PlaceInformation place={{...selected,information:placeInformation}} expanded={expanded}/>{placeLoading&&<p role="status">正在载入地点…</p>}<div className="map-actions"><button className="primary" disabled={placeLoading&&!located(selected)} onClick={startActivity}><Plus size={18}/>加入行程</button><button disabled={busy||(placeLoading&&!located(selected))||selectedFavorite?.state==='active'} onClick={favorite}><Star size={18}/>{selectedFavorite?.state==='active'?'已收藏':'收藏'}</button></div>{arranged.length>0&&<div className="place-visits">{arranged.map(a=><button key={a.id} onClick={()=>onEditActivity(a)}>{snapshot.objects.find(d=>d.id===a.payload.dayId)?.payload.date||dayLabel(snapshot.objects.find(d=>d.id===a.payload.dayId)||{payload:{ordinal:1}},trip)} · {a.payload.title}</button>)}</div>}<button className="map-details-toggle" aria-expanded={expanded} onClick={()=>setExpanded(!expanded)}>{expanded?'收起操作':'更多操作'}{expanded?<ChevronUp size={16}/>:<ChevronDown size={16}/>}</button>{expanded&&<><button className="map-text-action" onClick={()=>{setManual({name:selected.name,address:selected.address,category:selected.category});beginTask('manual')}}>编辑地点资料</button>{located(selected)&&<a className="map-text-action" target="_blank" rel="noreferrer" href={`https://uri.amap.com/navigation?to=${selected.lng},${selected.lat},${encodeURIComponent(selected.name)}&mode=car&coordinate=gaode&callnative=1`}><Navigation size={16}/>导航到这里</a>}{selectedFavorite?.state==='active'&&<button className="map-text-action" onClick={removeFavorite}>{canDelete?'取消团队收藏':'希望删除此收藏'}</button>}</>}</div>:
       (mode==='list'||expanded)?<div className="map-panel-scroll"><div className="map-panel-title"><h2>共享收藏</h2><button onClick={()=>{setSelected(null);setManual({name:'',address:''});beginTask('manual')}}><Plus size={18}/>添加</button></div>{visibleFavorites.length===0?<p className="map-empty">{favorites.length?'没有符合筛选的收藏':'还没有收藏地点'}</p>:visibleFavorites.map(o=><button className="map-result" key={o.id} onClick={()=>choose(o.payload,{preservePlace:true})}><Star size={18}/><span><strong>{o.payload.name}</strong>{o.payload.address&&<small>{o.payload.address}</small>}<small>{category(o.payload)}{isArranged(o.payload)?' · 已安排':''}</small></span></button>)}</div>:null}</>}
     {error&&<p className="map-error" role="alert">{error}</p>}
   </div>
 </section>;
}
