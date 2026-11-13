import {test,expect} from '@playwright/test';
import {fileURLToPath} from 'node:url';
import {createApp,shutdownServer} from '../../server/index.mjs';
import {launchWebKit} from '../../scripts/browser-runtime.mjs';

let app,server,base;
test.beforeAll(async()=>{
 app=createApp({distPath:fileURLToPath(new URL('../../dist/',import.meta.url)),databasePath:':memory:',securityPath:':memory:',config:{amapKey:''}});
 server=await new Promise(resolve=>{const listener=app.listen(0,'127.0.0.1',()=>resolve(listener))});
 base=`http://127.0.0.1:${server.address().port}`;app.locals.config.appOrigin=base;
});
test.afterAll(async()=>{if(server)await shutdownServer(server,app)});

async function fixture(page){
 await page.setViewportSize({width:1100,height:800});
 await page.emulateMedia({reducedMotion:'no-preference'});
 await page.goto(base);
 // main.jsx installs the real feedback listeners before rendering React.
 await page.locator('#root > *').first().waitFor();
 await page.evaluate(()=>{
  document.querySelector('#root').style.display='none';
  document.documentElement.dataset.theme='dark';
  document.documentElement.dataset.palette='atlas';
  document.documentElement.dataset.motion='false';
  document.documentElement.dataset.transparency='false';
  document.body.style.height='2000px';
  for(const [id,left] of [['glow-a',200],['glow-b',440]]){
   const card=document.createElement('div');
   card.id=id;card.dataset.pointerGlow='';card.textContent=id;
   card.style.cssText=`position:fixed;left:${left}px;top:200px;width:200px;height:120px;border-radius:20px;background:var(--surface);`;
   document.body.append(card);
  }
 });
}
async function light(page,id='glow-a'){
 return page.locator(`#${id}`).evaluate(el=>{
  const style=getComputedStyle(el,'::after');
  return {active:el.hasAttribute('data-pointer-active'),x:el.style.getPropertyValue('--pointer-x'),y:el.style.getPropertyValue('--pointer-y'),strength:Number(el.style.getPropertyValue('--pointer-strength')),opacity:Number(style.opacity),background:style.backgroundImage,shadow:style.boxShadow};
 });
}
async function move(page,x,y,strength,id='glow-a'){
 await page.mouse.move(x,y);
 await expect.poll(async()=>Number((await light(page,id)).opacity.toFixed(3))).toBe(strength);
 const value=await light(page,id);
 expect(value.active).toBe(true);expect(value.strength).toBeCloseTo(strength,3);
 return value;
}

for(const engine of ['Chrome','WebKit']){
 test(`${engine} proximity glow follows the edge, fades in place, and respects preferences`,async({page:chromePage},testInfo)=>{
  const browser=engine==='WebKit'?await launchWebKit():null;
  const page=browser?await browser.newPage():chromePage;
  try{
   await fixture(page);
   await page.mouse.move(152,237);
   expect((await light(page)).active).toBe(false);
   const strengths=[];
   for(const [x,strength] of [[164,.25],[176,.5],[188,.75]]){
    const value=await move(page,x,237,strength);strengths.push(value.opacity);
    expect(value.x).toBe(`${x-200}px`);expect(value.y).toBe('37px');
    expect(value.background).toContain(`at ${x-200}px 37px`);
   }
   expect(strengths[0]).toBeLessThan(strengths[1]);expect(strengths[1]).toBeLessThan(strengths[2]);
   await page.screenshot({path:testInfo.outputPath('edge-before.png')});
   await move(page,210,237,1);
   await page.screenshot({path:testInfo.outputPath('edge-after.png')});
   await page.mouse.move(420,237);
   await expect.poll(async()=> (await light(page,'glow-b')).active).toBe(true);
   expect((await light(page)).strength).toBeCloseTo(1-20/48,4);
   expect((await light(page,'glow-b')).strength).toBeCloseTo(1-20/48,4);
   await move(page,460,237,1,'glow-b');
   expect((await light(page)).active).toBe(false);
   const before=await light(page,'glow-b');
   await page.mouse.move(900,650);
   const fade=await page.locator('#glow-b').evaluate(async el=>{
    const samples=[],start=performance.now();
    while(performance.now()-start<260){await new Promise(requestAnimationFrame);samples.push({opacity:Number(getComputedStyle(el,'::after').opacity),x:el.style.getPropertyValue('--pointer-x'),y:el.style.getPropertyValue('--pointer-y')});}
    return samples;
   });
   expect(fade.some(value=>value.opacity>0&&value.opacity<1)).toBe(true);
   expect(fade.at(-1).opacity).toBe(0);
   for(const value of fade){expect(value.x).toBe(before.x);expect(value.y).toBe(before.y);}
   expect((await light(page,'glow-b')).background).toContain('at 20px 37px');
   for(const event of ['blur','scroll','touch']){
    await move(page,211,238,1);
    if(event==='scroll'){
     const cleared=await page.evaluate(()=>new Promise(resolve=>{
      document.addEventListener('scroll',()=>{
       const el=document.querySelector('#glow-a');
       resolve({active:el.hasAttribute('data-pointer-active'),x:el.style.getPropertyValue('--pointer-x'),y:el.style.getPropertyValue('--pointer-y')});
      },{capture:true,once:true});
      window.scrollTo(0,100);
     }));
     expect(cleared).toEqual({active:false,x:'11px',y:'38px'});
     await page.mouse.move(900,650);
     continue;
    }
    await page.evaluate(type=>{
     if(type==='blur')window.dispatchEvent(new Event('blur'));
     if(type==='touch')document.dispatchEvent(new PointerEvent('pointermove',{pointerType:'touch',clientX:211,clientY:238,bubbles:true}));
    },event);
    await expect.poll(async()=> (await light(page)).opacity,{message:`${event} clears the glow`}).toBe(0);
    const value=await light(page);expect(value.active).toBe(false);expect(value.x).toBe('11px');expect(value.y).toBe('38px');
    await page.mouse.move(900,650);
   }
   for(const preference of ['app','system']){
    await page.evaluate(value=>{document.documentElement.dataset.motion=value==='app'?'true':'system'},preference);
    await page.emulateMedia({reducedMotion:preference==='system'?'reduce':'no-preference'});
    await page.mouse.move(212,239);
    expect((await light(page)).active).toBe(false);expect((await light(page)).opacity).toBe(0);
    await page.mouse.move(900,650);
   }
   await page.emulateMedia({reducedMotion:'no-preference'});
   await page.evaluate(()=>{document.documentElement.dataset.motion='false';document.documentElement.dataset.transparency='true'});
   await move(page,213,240,1);
   const flat=await light(page);
   expect(flat.background).toMatch(/rgba\(0, 0, 0, 0\).*rgba\(0, 0, 0, 0\)/);
   expect(flat.shadow).toMatch(/(?:rgba\(0, 0, 0, 0\)|color\(srgb 0 0 0 \/ 0\))/);
  }finally{if(browser)await browser.close()}
 });
}
