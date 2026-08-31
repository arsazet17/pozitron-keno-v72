'use strict';

import fs from 'node:fs/promises';
import crypto from 'node:crypto';

const INDEX='index.html';
const MANIFEST='manifest.webmanifest';
const SW='sw.js';
const VERSION_FILE='app-version.json';

const assets=['sprint-marathon.js','max-retro.js','next-draw-banner.js','keno-payouts-v1.json'];

async function exists(path){try{await fs.access(path);return true}catch{return false}}
async function fileHash(path){
  const data=await fs.readFile(path);
  return crypto.createHash('sha256').update(data).digest('hex').slice(0,12);
}
function escapeRegExp(value){return value.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')}
async function appVersion(){
  try{return String(JSON.parse(await fs.readFile(VERSION_FILE,'utf8')).version||'7.2.2')}
  catch{return '7.2.2'}
}
function normalizeIndexForBuild(html){
  let x=html.replace(/<meta\s+name=["']app-build["']\s+content=["'][^"']*["']\s*\/?>/i,'<meta name="app-build" content="BUILD">');
  for(const asset of ['sprint-marathon.js','max-retro.js','next-draw-banner.js']){
    const name=escapeRegExp(asset);
    x=x.replace(new RegExp(`(<script\\b[^>]*\\bsrc=["']${name})(?:\\?v=[^"']*)?(["'][^>]*><\\/script>)`,'gi'),'$1?v=HASH$2');
  }
  x=x.replace(/serviceWorker\.register\(\s*['"]\.\/sw\.js(?:\?v=[^'"]*)?['"]/g,"serviceWorker.register('./sw.js?v=BUILD'");
  return x;
}
function normalizeManifestForBuild(text){
  try{const m=JSON.parse(text);m.start_url='./?v=BUILD';return JSON.stringify(m)}
  catch{return text.replace(/("start_url"\s*:\s*")[^"]*(")/,'$1./?v=BUILD$2')}
}
async function appBuildHash(){
  const parts=[normalizeIndexForBuild(await fs.readFile(INDEX,'utf8')),normalizeManifestForBuild(await fs.readFile(MANIFEST,'utf8'))];
  for(const asset of assets)if(await exists(asset)){parts.push(asset);parts.push(await fs.readFile(asset))}
  return crypto.createHash('sha256')
    .update(parts.map(p=>Buffer.isBuffer(p)?p:Buffer.from(String(p))).reduce((a,b)=>Buffer.concat([a,b]),Buffer.alloc(0)))
    .digest('hex').slice(0,12);
}

let html=await fs.readFile(INDEX,'utf8');
const version=await appVersion();

// Visible semantic version only.
html=html.replace(/<title>ПОЗИТРОН КЕНО v7\.2(?:\.\d+)?<\/title>/,`<title>ПОЗИТРОН КЕНО v${version}</title>`);
html=html.replace(/(<span[^>]*id=["']appVersionBadge["'][^>]*>)[^<]*(<\/span>)/i,`$1v${version}$2`);
html=html.replace(/\s*<div class="sub">сборка <span id="appBuildBadge">[^<]*<\/span><\/div>\s*/i,'\n');

for(const asset of ['sprint-marathon.js','max-retro.js','next-draw-banner.js']){
  if(!(await exists(asset)))continue;
  const hash=await fileHash(asset),name=escapeRegExp(asset);
  html=html.replace(new RegExp(`(<script\\b[^>]*\\bsrc=["']${name})(?:\\?v=[^"']*)?(["'][^>]*><\\/script>)`,'gi'),`$1?v=${hash}$2`);
}
await fs.writeFile(INDEX,html,'utf8');

const build=await appBuildHash();
html=await fs.readFile(INDEX,'utf8');
if(/<meta\s+name=["']app-build["']/i.test(html)){
  html=html.replace(/<meta\s+name=["']app-build["']\s+content=["'][^"']*["']\s*\/?>/i,`<meta name="app-build" content="${build}">`);
}else{
  html=html.replace(/<meta name="theme-color"[^>]*>/i,m=>`${m}\n<meta name="app-build" content="${build}">`);
}

const swRegistration=`<script id="v72-sw-register">
if ('serviceWorker' in navigator) {
  window.addEventListener('load', async () => {
    try {
      const reg = await navigator.serviceWorker.register('./sw.js?v=${build}', { updateViaCache: 'none' });
      await reg.update();
    } catch (e) { console.warn('SW update failed', e); }
  });
}
</script>`;
if(html.includes('id="v72-sw-register"'))html=html.replace(/<script id="v72-sw-register">[\s\S]*?<\/script>/,swRegistration);
else html=html.replace(/<\/body>/i,`${swRegistration}\n</body>`);
await fs.writeFile(INDEX,html,'utf8');

let manifest;
try{manifest=JSON.parse(await fs.readFile(MANIFEST,'utf8'))}catch{manifest={}}
manifest.name=`ПОЗИТРОН КЕНО v${version} AI Переходов`;
manifest.short_name=`КЕНО v${version}`;
manifest.start_url=`./?v=${build}`;
manifest.scope='./';
manifest.display=manifest.display||'standalone';
manifest.background_color=manifest.background_color||'#07111f';
manifest.theme_color=manifest.theme_color||'#08111f';
manifest.lang=manifest.lang||'ru';
await fs.writeFile(MANIFEST,JSON.stringify(manifest,null,2)+'\n','utf8');

const sw=`const CACHE='pozitron-v72-shell-${build}';
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
`;
await fs.writeFile(SW,sw,'utf8');
console.log(`PASS v${version} build ${build}`);
