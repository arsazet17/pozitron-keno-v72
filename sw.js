const CACHE='pozitron-v72-shell-3395e66c6791';
const SHELL=[
 './','./index.html','./manifest.webmanifest',
 './sprint-marathon.js','./max-retro.js','./next-draw-banner.js',
 './keno-payouts-v1.json','./icon-v72.png'
];
self.addEventListener('install',event=>event.waitUntil(
 caches.open(CACHE).then(c=>c.addAll(SHELL)).then(()=>self.skipWaiting())
));
self.addEventListener('activate',event=>event.waitUntil(
 caches.keys().then(keys=>Promise.all(keys.filter(k=>k!==CACHE).map(k=>caches.delete(k)))).then(()=>self.clients.claim())
));
self.addEventListener('fetch',event=>{
 if(event.request.method!=='GET')return;
 const url=new URL(event.request.url);
 if(url.pathname.endsWith('/keno-history.json')||url.pathname.endsWith('/keno-auto.json')){
   event.respondWith(fetch(new Request(event.request,{cache:'no-store'})));return;
 }
 if(url.origin!==self.location.origin)return;
 event.respondWith(
  fetch(new Request(event.request,{cache:'no-store'}))
   .then(r=>{const copy=r.clone();caches.open(CACHE).then(c=>c.put(event.request,copy)).catch(()=>{});return r})
   .catch(()=>caches.match(event.request))
 );
});
