const CACHE='pozitron-v72-shell-ae1266305355';
const SHELL=[
 './','./index.html','./manifest.webmanifest',
 './group-matrix.js','./next-draw-banner.js',
 './icon-v72.png'
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
 if(url.pathname.endsWith('/keno-history.json')){
   event.respondWith(fetch(new Request(event.request,{cache:'no-store'})));return;
 }
 if(url.origin!==self.location.origin)return;
 event.respondWith(
  fetch(new Request(event.request,{cache:'no-store'}))
   .then(r=>{const copy=r.clone();caches.open(CACHE).then(c=>c.put(event.request,copy)).catch(()=>{});return r})
   .catch(()=>caches.match(event.request))
 );
});
