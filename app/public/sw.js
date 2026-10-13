const CACHE='journey-shell-__BUILD_ID__';
const root=new URL('./',self.location).pathname;
const ASSETS=/*__PRECACHE__*/[];
const STATIC=['icon.svg','icon-maskable.svg','icon-192.png','icon-512.png','apple-touch-icon.png','manifest.webmanifest'];
self.addEventListener('install',event=>event.waitUntil(caches.open(CACHE).then(c=>c.addAll([...new Set([root,...STATIC.map(p=>root+p),...ASSETS.map(p=>root+p)])]))));
self.addEventListener('activate',event=>event.waitUntil(Promise.all([caches.keys().then(keys=>Promise.all(keys.filter(k=>k.startsWith('journey-shell-')&&k!==CACHE).map(k=>caches.delete(k)))),self.clients.claim()])));
self.addEventListener('fetch',event=>{
 const req=event.request,u=new URL(req.url);
 if(req.method!=='GET'||u.origin!==self.location.origin||!u.pathname.startsWith(root)||u.pathname.includes('/api/')||u.pathname.includes('/_AMapService/'))return;
 if(req.mode==='navigate')event.respondWith(fetch(req).then(r=>{if(r.ok){const copy=r.clone();void caches.open(CACHE).then(c=>c.put(root,copy));}return r;}).catch(()=>caches.match(root)));
 else if(u.pathname.startsWith(root+'assets/')||STATIC.some(p=>u.pathname===root+p))event.respondWith(caches.match(req).then(hit=>hit||fetch(req).then(r=>{if(r.ok){const copy=r.clone();void caches.open(CACHE).then(c=>c.put(req,copy));}return r;})));
});
