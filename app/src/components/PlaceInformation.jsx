import {useState} from 'react';
import {Clock3,ExternalLink,Globe,Phone} from 'lucide-react';
import './place-information.css';

function PlacePhoto({photo,name}) {
 const [failed,setFailed]=useState(false);
 return !failed&&photo?.url?<img className="place-information-photo" src={photo.url} alt={photo.title||`${name}照片`} loading="lazy" referrerPolicy="no-referrer" onError={()=>setFailed(true)}/>:null;
}

export default function PlaceInformation({place,expanded=false}) {
 const info=place?.information;
 if(!info)return null;
 const hasSummary=info.photo||info.type||info.openingHours;
 const hasDetails=info.introduction||info.telephone||info.website||info.detailUrl;
 if(!hasSummary&&!hasDetails)return null;
 return <section className="place-information" aria-label="地点资料">
  {hasSummary&&<div className="place-information-summary">
   {info.photo&&<PlacePhoto key={info.photo.url} photo={info.photo} name={place.name}/>}
   <div className="place-information-facts">
    {info.type&&<p className="place-information-type">{info.type}</p>}
    {info.openingHours&&<p className="place-information-hours"><Clock3 size={14} aria-hidden="true"/><span>{info.openingHours}</span></p>}
   </div>
  </div>}
  {hasDetails&&expanded&&<div className="place-information-details">
    {info.introduction&&<p className="place-information-introduction">{info.introduction}</p>}
    {info.telephone&&<p className="place-information-contact"><Phone size={14} aria-hidden="true"/>{info.telephoneUrl?<a href={info.telephoneUrl}>{info.telephone}</a>:<span>{info.telephone}</span>}</p>}
    {info.website&&<a className="place-information-link" href={info.website} target="_blank" rel="noopener noreferrer"><Globe size={14} aria-hidden="true"/>地点网站<ExternalLink size={12} aria-hidden="true"/></a>}
    {info.detailUrl&&<a className="place-information-link place-information-source" href={info.detailUrl} target="_blank" rel="noopener noreferrer">在高德地图查看<ExternalLink size={12} aria-hidden="true"/></a>}
   </div>}
 </section>;
}
