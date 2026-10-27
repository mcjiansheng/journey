const svgNS='http://www.w3.org/2000/svg';
const starPath='m12 3 2.78 5.63L21 9.54l-4.5 4.38 1.06 6.2L12 17.2l-5.56 2.92 1.06-6.2L3 9.54l6.22-.91L12 3Z';

function shape(tag,attributes){
 const element=document.createElementNS(svgNS,tag);
 for(const [name,value] of Object.entries(attributes))element.setAttribute(name,value);
 return element;
}

export function createMapMarker(place,{selected=false,saved=false,arranged=false,order=null}={}){
 const button=document.createElement('button');
 button.type='button';button.className=`place-marker${selected?' selected-marker':order!==null?' route-marker':' favorite-marker'}${arranged?' arranged':''}`;
 button.setAttribute('aria-label',place.name);button.setAttribute('aria-pressed',String(selected));
 const graphic=document.createElement('span');graphic.className='marker-graphic';graphic.setAttribute('aria-hidden','true');
 if(selected){
  const pin=shape('svg',{viewBox:'0 0 32 42',fill:'none'});
  pin.append(shape('path',{d:'M16 40C13 35 2 25 2 16a14 14 0 0 1 28 0c0 9-11 19-14 24Z',fill:'currentColor',stroke:'#fffefa','stroke-width':'2'}));
  if(saved){
   const star=shape('path',{d:starPath,fill:'#fffefa',transform:'translate(4 4)'});pin.append(star);
  }else pin.append(shape('circle',{cx:'16',cy:'16',r:'5',fill:'#fffefa'}));
  graphic.append(pin);
  const label=document.createElement('span');label.className='marker-label';label.textContent=place.name;label.setAttribute('aria-hidden','true');button.append(label);
 }else if(order!==null){
  graphic.textContent=String(order);
 }else{
  const star=shape('svg',{viewBox:'0 0 24 24'});star.append(shape('path',{d:starPath,fill:'currentColor'}));graphic.append(star);
 }
 button.append(graphic);return button;
}
