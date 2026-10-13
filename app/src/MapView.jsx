import React,{useEffect,useLayoutEffect,useMemo,useRef,useState} from 'react';
import {Search,Star,Plus,X,LocateFixed,SlidersHorizontal,ChevronUp,ChevronDown,MapPin,Navigation,RefreshCw,ArrowLeft,List} from 'lucide-react';
import {loadAmap,searchPlaces,suggestPlaces,placeDetail,reverseGeocode,estimateRoute,geocode} from './amap';
import {orderedActivities,visibleDays,dayLabel,routeSignature,endpointSignature} from './domain';
import {destinationKey,validCenter,planMapCamera,resolveMapCamera,cameraContext} from './map-camera.js';
import MapRoutePicker from './components/MapRoutePicker.jsx';
import SelectionTrack from './components/SelectionTrack.jsx';
import {reducedMotion} from './usePageNavigation.js';
import './map.css';

const located=p=>Number.isFinite(p?.lng)&&Number.isFinite(p?.lat);
const keyOf=p=>p?.providerPlaceId?`amap:${p.providerPlaceId}`:JSON.stringify([p?.name,p?.address,p?.lng,p?.lat]);
const category=p=>/餐|食|咖啡|茶/.test(p.category)?'餐饮':/住宿|酒店/.test(p.category)?'住宿':/景|公园|博物|文化/.test(p.category)?'景点':/交通|机场|车站/.test(p.category)?'交通':'其他';
export default function MapView({journey:j,onEditActivity}) {
 const {snapshot,context}=j,trip=snapshot.trip,initial=context.map||{};
 const initialPlace=initial.selectedActivityId?snapshot.objects.find(o=>o.id===initial.selectedActivityId)?.payload.place:initial.selected;
 const [query,setQuery]=useState(initial.query||''),[results,setResults]=useState([]),[suggestions,setSuggestions]=useState([]),[selected,setSelected]=useState(initialPlace||null),[mode,setMode]=useState(initialPlace?'detail':'browse'),[expanded,setExpanded]=useState(false),[error,setError]=useState(''),[mapError,setMapError]=useState(''),[busy,setBusy]=useState(false),[ready,setReady]=useState(0),[mapEpoch,setMapEpoch]=useState(0),[routeDay,setRouteDay]=useState(initial.dayId||initial.routeDay||''),[filter,setFilter]=useState(initial.filter||{category:'全部',arranged:'全部'}),[filterDraft,setFilterDraft]=useState(filter),[manual,setManual]=useState({name:'',address:''}),[keyboardOpen,setKeyboardOpen]=useState(false),[cameraChoice,setCameraChoice]=useState(null),[cameraLoading,setCameraLoading]=useState(false);
 const panelAnimation=useRef(null),panelHeight=useRef(null),filterButton=useRef(null);
 const canvas=useRef(null),panel=useRef(null),map=useRef(null),markers=useRef([]),lines=useRef([]),searchSeq=useRef(0),composing=useRef(false),cameraTimer=useRef(null),lastContext=useRef(initial),alive=useRef(true),snapshotRef=useRef(snapshot),selectRef=useRef(null);
 snapshotRef.current=snapshot;
 const cameraGeneration=useRef(0),cameraIntent=useRef(0),activityIntent=useRef(initial.selectedActivityId||null),consumedChoice=useRef(null);
 const selectedPlaceRef=useRef(selected);selectedPlaceRef.current=selected;
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
 useLayoutEffect(()=>{if(mode==='filter')panel.current.querySelector('.map-panel-title button')?.focus()},[mode]);
 const routeActivities=useMemo(()=>routeDay&&snapshot.objects.some(x=>x.id===routeDay&&x.kind==='day'&&x.state==='active')?orderedActivities(snapshot,routeDay):[],[snapshot,routeDay]);
 const saveMap=patch=>{lastContext.current={...lastContext.current,...patch};j.setContext({map:lastContext.current});};
 selectRef.current=p=>choose(p);
 useEffect(()=>{let width=innerWidth;const resize=()=>{const v=window.visualViewport;document.documentElement.style.setProperty('--visual-height',`${v?.height||innerHeight}px`);setKeyboardOpen(!!v&&innerHeight-v.height-v.offsetTop>100);if(width!==innerWidth){width=innerWidth;shiftCamera(selectedPlaceRef.current);}};resize();window.visualViewport?.addEventListener('resize',resize);return()=>window.visualViewport?.removeEventListener('resize',resize);},[]);
 useEffect(()=>{saveMap({query,selected,routeDay,filter});},[query,selected,routeDay,filter]);
 useEffect(()=>{
   alive.current=true;let instance,disposed=false,initialized=false,userMoved=false;
   const generation=++cameraGeneration.current,entryIntent=cameraIntent.current,controller=new AbortController();
   setMapError('');setCameraLoading(true);
   const currentActivity=activityIntent.current?snapshotRef.current.objects.find(o=>o.id===activityIntent.current&&o.kind==='activity'&&o.state==='active'&&snapshotRef.current.objects.some(d=>d.id===o.payload.dayId&&d.state==='active')):null;
   const plan=planMapCamera({destination:trip.destination,saved:lastContext.current,activityPlace:currentActivity?.payload.place,userPlace:cameraChoice&&cameraChoice!==consumedChoice.current&&cameraChoice.destination===destinationKey(trip.destination)?cameraChoice.place:null,favorites:snapshotRef.current.objects.filter(o=>o.kind==='favorite'&&o.state==='active')});
   if(plan.source==='destination'&&!currentActivity&&lastContext.current.cameraDestination!==destinationKey(trip.destination)){selectedPlaceRef.current=null;setSelected(null);setMode('browse');}
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
     instance=new AMap.Map(canvas.current,{viewMode:'2D',zoom:camera.zoom,center:camera.center,resizeEnable:true});
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
     instance.addControl(new AMap.Scale({position:'LT',offset:new AMap.Pixel(16,96)}));

   })().catch(error=>{if(current()){instance?.destroy();if(map.current===instance)map.current=null;setCameraLoading(false);setMapError(error.message);}});
   return()=>{alive.current=false;disposed=true;controller.abort();clearTimeout(cameraTimer.current);searchSeq.current++;instance?.destroy();if(map.current===instance){map.current=null;markers.current=[];lines.current=[];}};
 },[trip.id,trip.destination,mapEpoch,cameraChoice]);
 useEffect(()=>{
   if(!map.current||!window.AMap)return;
   const AMap=window.AMap,m=map.current;m.remove(markers.current);m.remove(lines.current);markers.current=[];lines.current=[];
   const add=(p,label,className,order)=>{if(!located(p))return;const node=document.createElement('button');node.type='button';node.className=`place-marker ${className||''}`;node.textContent=label;node.setAttribute('aria-label',p.name);const marker=new AMap.Marker({position:[p.lng,p.lat],content:node,offset:new AMap.Pixel(-17,-17),zIndex:order||10});marker.on('click',()=>selectRef.current(p));markers.current.push(marker);};
   visibleFavorites.forEach(o=>add(o.payload,'★',isArranged(o.payload)?'arranged':''));
   routeActivities.forEach((a,i)=>add(a.payload.place,String(i+1),'route-marker',20));
   if(selected)add(selected,'•','selected-marker',30);
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
   if(mode!=='search'||composing.current)return;
   const seq=++searchSeq.current;
   if(!query.trim()){setResults([]);setSuggestions([]);return;}
   const timer=setTimeout(async()=>{
     setBusy(true);setError('');
     try{
       const [places,tips]=await Promise.all([searchPlaces(query,trip.destination),suggestPlaces(query,trip.destination)]);
       if(seq===searchSeq.current&&alive.current){setResults(places);setSuggestions(tips.filter(t=>t.name&&!places.some(p=>keyOf(p)===keyOf(t)||(!t.providerPlaceId&&p.name===t.name))).slice(0,5));}
     }catch(e){if(seq===searchSeq.current)setError(e.message);}finally{if(seq===searchSeq.current)setBusy(false);}
   },350);return()=>{clearTimeout(timer);searchSeq.current++;};
 },[query,mode,trip.destination]);
 function shiftCamera(p,allowInitialize=false){
   if(!located(p))return;
   if(!map.current){if(allowInitialize)setCameraChoice({place:p,destination:destinationKey(trip.destination)});return;}
   clearTimeout(cameraTimer.current);const targetMap=map.current;
   cameraTimer.current=setTimeout(()=>{if(map.current!==targetMap)return;targetMap.setZoomAndCenter(Math.max(15,targetMap.getZoom()),[p.lng,p.lat],true);const r=panel.current?.getBoundingClientRect(),mobile=innerWidth<760;if(r)targetMap.panBy(mobile?0:(r.width+80)/2,mobile?-(r.height+100)/2:0,0);},60);
 }
 async function choose(p){const sequence=++searchSeq.current;cameraIntent.current++;setBusy(false);setError('');try{if(p.providerPlaceId&&!located(p))p=await placeDetail(p.providerPlaceId)||p;if(sequence!==searchSeq.current||!alive.current)return;setSelected(p);setMode('detail');setExpanded(false);document.activeElement?.blur?.();shiftCamera(p,true);}catch(e){if(sequence===searchSeq.current&&alive.current)setError(e.message);}}
 async function pickHere(){if(!map.current)return;const c=map.current.getCenter();setBusy(true);try{let p;try{p=await reverseGeocode(c.lng,c.lat);}catch{p={name:'',address:'',lng:c.lng,lat:c.lat,provider:null,providerPlaceId:null,category:'',sourceUrl:'',fetchedAt:null,coordSystem:'GCJ-02'};}setSelected(p);setManual({name:p.name,address:p.address});setMode('manual');}finally{setBusy(false);}}
 async function favorite(){if(!selected)return;setBusy(true);setError('');try{const existing=snapshot.objects.find(x=>x.kind==='favorite'&&keyOf(x.payload)===keyOf(selected));if(existing){if(existing.state==='deleted')setError('此收藏已删除，可在设置的已删除内容中恢复');return;}await j.mutate({kind:'create',objectId:crypto.randomUUID(),objectType:'favorite',patch:selected});}catch(e){setError(e.message);}finally{setBusy(false);}}
 const selectedFavorite=selected&&snapshot.objects.find(o=>o.kind==='favorite'&&keyOf(o.payload)===keyOf(selected));
 const member=snapshot.members.find(x=>x.userId===j.user.id),canDelete=trip.ownerId===j.user.id||trip.teamMode==='admin'&&member?.isAdmin;
 const arranged=selected?activities.filter(a=>a.payload.place&&keyOf(a.payload.place)===keyOf(selected)):[];
 async function removeFavorite(){try{await j.mutate(canDelete?{kind:'delete',objectId:selectedFavorite.id,generation:selectedFavorite.generation}:{kind:'express',objectId:selectedFavorite.id,generation:selectedFavorite.generation,expression:{wishDelete:true}});}catch(e){setError(e.message);}}
 function closeTask(){searchSeq.current++;setBusy(false);setError('');setMode(selected?'detail':'browse');setExpanded(false);if(mode==='filter')filterButton.current?.focus();else document.activeElement?.blur?.();}
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
     <button ref={filterButton} className={`map-icon map-filter-toggle ${filter.category!=='全部'||filter.arranged!=='全部'?'has-filter':''}`} aria-label="筛选收藏" aria-expanded={mode==='filter'} aria-controls="map-place-panel" onClick={()=>{if(mode==='filter'){closeTask();return}setFilterDraft(filter);setMode('filter');setExpanded(true)}}><SlidersHorizontal size={19}/></button>
   </div>
   {cameraLoading&&<div className="map-load-error glass" role="status"><MapPin size={22}/><span>正在定位地图…</span></div>}
   {mapError&&<div className="map-load-error glass" role="status"><MapPin size={22}/><span>{mapError}</span><button onClick={()=>setMapEpoch(v=>v+1)}><RefreshCw size={16}/>重试</button></div>}
   {mode==='pick'&&<div className="map-crosshair" aria-hidden="true">+</div>}
   <div className="map-tools glass"><button className="map-icon" aria-label="放大地图" onClick={()=>map.current?.zoomIn()}><Plus size={20}/></button><button className="map-icon" aria-label="缩小地图" onClick={()=>map.current?.zoomOut()}>−</button><button className="map-icon" aria-label="定位到我" onClick={locate}><LocateFixed size={20}/></button></div>
   <div id="map-place-panel" ref={panel} onKeyDown={e=>{if(e.key==='Escape'&&mode==='filter'){e.preventDefault();closeTask();filterButton.current?.focus()}}} className={`map-panel glass ${expanded||mode==='search'||mode==='filter'||mode==='manual'?'expanded':''} mode-${mode}`}>
     {mode==='filter'?<><div className="map-panel-title"><h2>筛选收藏</h2><button onClick={closeTask}>取消</button></div><fieldset><legend>类别</legend><SelectionTrack className="map-chips" activeKey={filterDraft.category}>{['全部','餐饮','景点','住宿','交通','其他'].map(c=><button key={c} className={filterDraft.category===c?'selected':''} aria-pressed={filterDraft.category===c} onClick={()=>setFilterDraft({...filterDraft,category:c})}>{c}</button>)}</SelectionTrack></fieldset><fieldset><legend>安排状态</legend><SelectionTrack className="map-chips" activeKey={filterDraft.arranged}>{['全部','已安排','未安排'].map(c=><button key={c} className={filterDraft.arranged===c?'selected':''} aria-pressed={filterDraft.arranged===c} onClick={()=>setFilterDraft({...filterDraft,arranged:c})}>{c}</button>)}</SelectionTrack></fieldset><button className="primary" onClick={()=>{setFilter(filterDraft);closeTask()}}>完成</button></>:
      mode==='manual'?<><div className="map-panel-title"><h2>{selected?'编辑地点':'手动填写地点'}</h2><button onClick={closeTask}>取消</button></div><label>名称<input value={manual.name} onChange={e=>setManual({...manual,name:e.target.value})}/></label><label>地址<input value={manual.address} onChange={e=>setManual({...manual,address:e.target.value})}/></label><label>类别<select value={manual.category||selected?.category||''} onChange={e=>setManual({...manual,category:e.target.value})}><option value="">未分类</option>{['餐饮','景点','住宿','交通','其他'].map(c=><option key={c}>{c}</option>)}</select></label><button className="primary" disabled={!manual.name.trim()} onClick={async()=>{const p={lng:null,lat:null,provider:null,providerPlaceId:null,sourceUrl:'',fetchedAt:null,coordSystem:'GCJ-02',...selected,...manual};if(selectedFavorite?.state==='active')await j.mutate({kind:'patch',objectId:selectedFavorite.id,patch:p});setSelected(p);setMode('detail');setExpanded(false);}}>完成</button></>:
      mode==='pick'?<><div className="map-panel-title"><h2>移动地图选择位置</h2><button onClick={closeTask}>取消</button></div><button className="primary" disabled={busy||!map.current} onClick={pickHere}>选这里</button></>:
      <><div className="map-search-row"><Search size={20}/><input aria-label="搜索地点" placeholder="搜索地点或地址" value={query} onFocus={()=>{setMode('search');setExpanded(true)}} onChange={e=>setQuery(e.target.value)} onCompositionStart={()=>{composing.current=true;searchSeq.current++}} onCompositionEnd={e=>{composing.current=false;setQuery(e.currentTarget.value)}}/>{mode==='search'?<button onClick={closeTask}>取消</button>:<button className="map-icon" aria-label="查看收藏列表" aria-expanded={mode==='list'} onClick={()=>{if(mode==='list')closeTask();else{setMode('list');setExpanded(true)}}}><List size={20}/></button>}</div>
      {mode==='search'?<div className="map-panel-scroll"><div className="map-small-actions"><button onClick={()=>setMode('pick')} disabled={!map.current}><MapPin size={16}/>地图选点</button><button onClick={()=>{setSelected(null);setManual({name:query,address:''});setMode('manual')}}>手动填写</button></div>{busy&&<p role="status">正在查找…</p>}{!busy&&query&&results.length===0&&suggestions.length===0&&!error&&<p className="map-empty">没有找到相关地点</p>}{suggestions.map((p,i)=><button key={keyOf(p)+i} className="map-result" onClick={()=>{const match=results.find(r=>r.name===p.name);p.providerPlaceId?choose(p):match?choose(match):setQuery(p.name)}}><Search size={17}/><span><strong>{p.name}</strong>{p.address&&<small>{p.address}</small>}</span></button>)}{results.map((p,i)=><button key={keyOf(p)+i} className="map-result" onClick={()=>choose(p)}><MapPin size={18}/><span><strong>{p.name}</strong>{p.address&&<small>{p.address}</small>}</span></button>)}</div>:
       mode==='detail'&&selected?<div className="map-panel-scroll"><div className="map-panel-title"><h2>{selected.name}</h2><button className="map-icon" aria-label="关闭地点" onClick={()=>{setSelected(null);setMode('browse')}}><X size={18}/></button></div>{selected.address&&<p className="place-address">{selected.address}</p>}<div className="map-actions"><button className="primary" onClick={startActivity}><Plus size={18}/>加入行程</button><button disabled={busy||selectedFavorite?.state==='active'} onClick={favorite}><Star size={18}/>{selectedFavorite?.state==='active'?'已收藏':'收藏'}</button></div>{arranged.length>0&&<div className="place-visits">{arranged.map(a=><button key={a.id} onClick={()=>onEditActivity(a)}>{snapshot.objects.find(d=>d.id===a.payload.dayId)?.payload.date||dayLabel(snapshot.objects.find(d=>d.id===a.payload.dayId)||{payload:{ordinal:1}},trip)} · {a.payload.title}</button>)}</div>}<button className="map-details-toggle" aria-expanded={expanded} onClick={()=>setExpanded(!expanded)}>{expanded?'收起操作':'更多操作'}{expanded?<ChevronUp size={16}/>:<ChevronDown size={16}/>}</button>{expanded&&<><button className="map-text-action" onClick={()=>{setManual({name:selected.name,address:selected.address,category:selected.category});setMode('manual')}}>编辑地点资料</button>{located(selected)&&<a className="map-text-action" target="_blank" rel="noreferrer" href={`https://uri.amap.com/navigation?to=${selected.lng},${selected.lat},${encodeURIComponent(selected.name)}&mode=car&coordinate=gaode&callnative=1`}><Navigation size={16}/>导航到这里</a>}{selectedFavorite?.state==='active'&&<button className="map-text-action" onClick={removeFavorite}>{canDelete?'取消团队收藏':'希望删除此收藏'}</button>}</>}</div>:
       (mode==='list'||expanded)?<div className="map-panel-scroll"><div className="map-panel-title"><h2>共享收藏</h2><button onClick={()=>{setSelected(null);setManual({name:'',address:''});setMode('manual')}}><Plus size={18}/>添加</button></div>{visibleFavorites.length===0?<p className="map-empty">{favorites.length?'没有符合筛选的收藏':'还没有收藏地点'}</p>:visibleFavorites.map(o=><button className="map-result" key={o.id} onClick={()=>choose(o.payload)}><Star size={18}/><span><strong>{o.payload.name}</strong>{o.payload.address&&<small>{o.payload.address}</small>}<small>{category(o.payload)}{isArranged(o.payload)?' · 已安排':''}</small></span></button>)}</div>:null}</>}
     {error&&<p className="map-error" role="alert">{error}</p>}
   </div>
 </section>;
}
