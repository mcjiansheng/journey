import React,{useEffect,useId,useRef,useState} from 'react';
import {Map,MapPin,Search,X} from 'lucide-react';
import {searchPlaces} from '../amap.js';
import './activity-place.css';

const blankPlace={address:'',lng:null,lat:null,provider:null,providerPlaceId:null,category:'',sourceUrl:'',fetchedAt:null,coordSystem:'GCJ-02'};

export default function ActivityPlaceField({place,destination,favorites,onChange,onCommit,onMap}) {
 const inputId=useId(),listId=`${inputId}-results`,addressId=`${inputId}-address`;
 const input=useRef(null),sequence=useRef(0);
 const [mode,setMode]=useState(null),[results,setResults]=useState([]),[status,setStatus]=useState('idle');
 const [activeIndex,setActiveIndex]=useState(-1),[composing,setComposing]=useState(false),[retry,setRetry]=useState(0);
 const query=place?.name||place?.address||'';
 const expanded=mode==='search'&&results.length>0;

 function dismiss() {
  sequence.current++;
  setMode(null);setResults([]);setStatus('idle');setActiveIndex(-1);
 }
 useEffect(()=>{
  const current=++sequence.current;
  setResults([]);setActiveIndex(-1);setStatus('idle');
  if(mode!=='search'||composing||!query.trim())return;
  const timer=setTimeout(async()=>{
   setStatus('loading');
   try {
    const found=await searchPlaces(query.trim(),destination);
    if(sequence.current!==current)return;
    setResults(found);setStatus('success');
   } catch {
    if(sequence.current===current)setStatus('error');
   }
  },350);
  return()=>{clearTimeout(timer);sequence.current++;};
 },[query,destination,mode,composing,retry]);
 useEffect(()=>{
  if(activeIndex>=0)document.getElementById(`${listId}-${activeIndex}`)?.scrollIntoView({block:'nearest'});
 },[activeIndex,listId]);

 function type(value) {
  dismiss();
  // Free text is a new place: never retain the previous POI's address or coordinates.
  onChange(value?{...blankPlace,name:value}:null);
  if(value.trim())setMode('search');
 }
 function choose(value) {
  dismiss();onChange(value);onCommit(value);input.current?.focus();
 }
 function keyDown(event) {
  if(event.nativeEvent.isComposing||composing)return;
  if(event.key==='Escape'&&mode){event.preventDefault();event.stopPropagation();dismiss();return;}
  if((event.key==='ArrowDown'||event.key==='ArrowUp')&&expanded){
   event.preventDefault();
   setActiveIndex(index=>event.key==='ArrowDown'?(index+1)%results.length:(index<=0?results.length-1:index-1));
  } else if(event.key==='Enter') {
   event.preventDefault();
   if(expanded&&results[activeIndex])choose(results[activeIndex]);
   else if(query.trim()){dismiss();setMode('search');setRetry(n=>n+1);}
  }
 }

 return <div className="field activity-place-field" onBlur={event=>{
  if(!event.currentTarget.contains(event.relatedTarget)){dismiss();onCommit(place);}
 }}>
  <label htmlFor={inputId}>地点 <span className="activity-place-optional">选填</span></label>
  <div className="activity-place-input">
   <Search size={18} aria-hidden="true"/>
   <input ref={input} id={inputId} role="combobox" aria-autocomplete="list" aria-expanded={expanded}
    aria-controls={expanded?listId:undefined} aria-activedescendant={expanded&&activeIndex>=0?`${listId}-${activeIndex}`:undefined}
    aria-describedby={place?.address?addressId:undefined} autoComplete="off" maxLength={240}
    value={query} placeholder="想去哪里？搜索或直接填写" onChange={event=>type(event.target.value)} onKeyDown={keyDown}
    onCompositionStart={()=>{sequence.current++;setComposing(true);setResults([]);setStatus('idle');setActiveIndex(-1);}}
    onCompositionEnd={()=>setComposing(false)}/>
   {query&&<button type="button" className="icon-button" aria-label="清除地点" onClick={()=>choose(null)}><X size={17}/></button>}
  </div>
  {place?.address&&<p className="activity-place-address" id={addressId}><MapPin size={15} aria-hidden="true"/><span>{place.address}</span></p>}
  {mode==='search'&&<>
   {status==='loading'&&<p className="activity-place-status" role="status">正在查找…</p>}
   {status==='error'&&<div className="activity-place-status"><span role="status">地点搜索暂时不可用，已保留你的输入。</span><button type="button" className="text-button" onClick={()=>{setStatus('idle');setRetry(n=>n+1);}}>重试</button></div>}
   {status==='success'&&!results.length&&<p className="activity-place-status" role="status">没有找到相关地点，已保留你的输入。</p>}
   {expanded&&<ul id={listId} role="listbox" aria-label="地点搜索结果" className="activity-place-results">
    {results.map((result,index)=><li id={`${listId}-${index}`} role="option" aria-selected={activeIndex===index}
     key={result.providerPlaceId||index} onMouseDown={event=>event.preventDefault()}
     onClick={()=>choose(result)}>
     <MapPin size={17} aria-hidden="true"/><span><strong>{result.name}</strong>{result.address&&<small>{result.address}</small>}</span>
    </li>)}
   </ul>}
  </>}
  <div className="button-row activity-place-actions">
   <button type="button" className="text-button" aria-expanded={mode==='favorites'} onClick={()=>{const show=mode!=='favorites';dismiss();if(show)setMode('favorites');}}><MapPin size={16}/>从收藏选择</button>
   <button type="button" className="text-button" onClick={()=>{dismiss();onCommit(place);onMap();}}><Map size={16}/>在地图查找</button>
  </div>
  {mode==='favorites'&&<div className="activity-place-favorites">
   {favorites.length?favorites.map(favorite=><button type="button" key={favorite.id} onClick={()=>choose(favorite.payload)}>
    <MapPin size={17} aria-hidden="true"/><span><strong>{favorite.payload.name}</strong>{favorite.payload.address&&<small>{favorite.payload.address}</small>}</span>
   </button>):<p className="activity-place-status" role="status">还没有收藏的地点。</p>}
  </div>}
 </div>;
}
