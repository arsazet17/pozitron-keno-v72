'use strict';

import fs from 'node:fs/promises';
import crypto from 'node:crypto';

const INDEX = 'index.html';
const MANIFEST = 'manifest.webmanifest';
const SW = 'sw.js';

const assets = [
  'sprint-marathon.js',
  'max-retro.js',
  'next-draw-banner.js'
];

async function exists(path) {
  try { await fs.access(path); return true; } catch { return false; }
}

async function fileHash(path) {
  const data = await fs.readFile(path);
  return crypto.createHash('sha256').update(data).digest('hex').slice(0, 12);
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function normalizeIndexForBuild(html) {
  let x = html;
  x = x.replace(
    /<meta\s+name=["']app-build["']\s+content=["'][^"']*["']\s*\/?>/i,
    '<meta name="app-build" content="BUILD">'
  );
  x = x.replace(
    /(<span[^>]*id=["']appBuildBadge["'][^>]*>)[^<]*(<\/span>)/i,
    '$1BUILD$2'
  );
  for (const asset of assets) {
    const name = escapeRegExp(asset);
    x = x.replace(
      new RegExp(`(<script\\b[^>]*\\bsrc=["']${name})(?:\\?v=[^"']*)?(["'][^>]*><\\/script>)`, 'gi'),
      '$1?v=HASH$2'
    );
  }
  x = x.replace(
    /serviceWorker\.register\(\s*['"]\.\/sw\.js(?:\?v=[^'"]*)?['"]/g,
    "serviceWorker.register('./sw.js?v=BUILD'"
  );
  return x;
}

function normalizeManifestForBuild(text) {
  try {
    const m = JSON.parse(text);
    m.start_url = './?v=BUILD';
    return JSON.stringify(m);
  } catch {
    return text.replace(/("start_url"\s*:\s*")[^"]*(")/, '$1./?v=BUILD$2');
  }
}

async function appBuildHash() {
  const parts = [];
  const index = await fs.readFile(INDEX, 'utf8');
  parts.push(normalizeIndexForBuild(index));

  const manifest = await fs.readFile(MANIFEST, 'utf8');
  parts.push(normalizeManifestForBuild(manifest));

  for (const asset of assets) {
    if (await exists(asset)) {
      parts.push(asset);
      parts.push(await fs.readFile(asset));
    }
  }

  return crypto
    .createHash('sha256')
    .update(parts.map(p => Buffer.isBuffer(p) ? p : Buffer.from(String(p))).reduce((a,b)=>Buffer.concat([a,b]), Buffer.alloc(0)))
    .digest('hex')
    .slice(0, 12);
}

let html = await fs.readFile(INDEX, 'utf8');
let manifestText = await fs.readFile(MANIFEST, 'utf8');
let changed = false;

// Подключаем next-draw-banner.js, если файл уже есть, а ссылки нет.
if (await exists('next-draw-banner.js') && !html.includes('next-draw-banner.js')) {
  html = html.replace(
    /<\/body>/i,
    '<script src="next-draw-banner.js?v=bootstrap"></script>\n</body>'
  );
  changed = true;
}

// Хэши отдельных JS.
for (const asset of assets) {
  if (!(await exists(asset))) continue;
  const version = await fileHash(asset);
  const name = escapeRegExp(asset);
  const re = new RegExp(
    `(<script\\b[^>]*\\bsrc=["']${name})(?:\\?v=[^"']*)?(["'][^>]*><\\/script>)`,
    'gi'
  );
  const before = html;
  html = html.replace(re, `$1?v=${version}$2`);
  if (html !== before) {
    changed = true;
  }
}

// Сохраняем промежуточный index, чтобы build считался уже от актуальных JS-хэшей,
// но normalizeIndexForBuild исключает сами ?v= из общего build.
await fs.writeFile(INDEX, html, 'utf8');

const build = await appBuildHash();
html = await fs.readFile(INDEX, 'utf8');

// Метка build в head.
if (/<meta\s+name=["']app-build["']/i.test(html)) {
  html = html.replace(
    /<meta\s+name=["']app-build["']\s+content=["'][^"']*["']\s*\/?>/i,
    `<meta name="app-build" content="${build}">`
  );
} else {
  html = html.replace(
    /<meta name="theme-color"[^>]*>/i,
    m => `${m}\n<meta name="app-build" content="${build}">`
  );
}

// Видимый build рядом с версией.
if (html.includes('id="appBuildBadge"')) {
  html = html.replace(
    /(<span[^>]*id=["']appBuildBadge["'][^>]*>)[^<]*(<\/span>)/i,
    `$1build ${build}$2`
  );
} else {
  html = html.replace(
    /(<div class="brand">🎯 ПОЗИТРОН КЕНО v7\.2<\/div>)/,
    `$1\n      <div class="sub">сборка <span id="appBuildBadge">build ${build}</span></div>`
  );
}

// Service Worker registration: обновление без браузерного HTTP-cache.
const swRegistration = `
<script id="v72-sw-register">
if ('serviceWorker' in navigator) {
  window.addEventListener('load', async () => {
    try {
      const reg = await navigator.serviceWorker.register('./sw.js?v=${build}', { updateViaCache: 'none' });
      await reg.update();
    } catch (e) {
      console.warn('SW update failed', e);
    }
  });
}
</script>
`;

if (html.includes('id="v72-sw-register"')) {
  html = html.replace(
    /<script id="v72-sw-register">[\s\S]*?<\/script>/,
    swRegistration.trim()
  );
} else {
  html = html.replace(/<\/body>/i, `${swRegistration}\n</body>`);
}

await fs.writeFile(INDEX, html, 'utf8');

// Manifest start_url меняется только при реальном build.
let manifest;
try {
  manifest = JSON.parse(manifestText);
} catch {
  manifest = {
    name: 'ПОЗИТРОН КЕНО v7.2 AI Переходов',
    short_name: 'КЕНО v7.2',
    display: 'standalone',
    background_color: '#07111f',
    theme_color: '#08111f',
    lang: 'ru'
  };
}
manifest.start_url = `./?v=${build}`;
manifest.scope = './';
await fs.writeFile(MANIFEST, JSON.stringify(manifest, null, 2) + '\n', 'utf8');

// SW cache получает тот же build.
let sw = `const CACHE='pozitron-v72-shell-${build}';

const SHELL=[
  './',
  './index.html',
  './manifest.webmanifest',
  './sprint-marathon.js',
  './max-retro.js',
  './next-draw-banner.js',
  './icon-v72.png'
];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE)
      .then(cache => cache.addAll(SHELL))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', event => {
  if (event.request.method !== 'GET') return;
  const url = new URL(event.request.url);

  // Данные всегда идут из сети и не замораживаются оболочкой.
  if (
    url.pathname.endsWith('/keno-history.json') ||
    url.pathname.endsWith('/keno-auto.json')
  ) {
    event.respondWith(fetch(new Request(event.request, { cache: 'no-store' })));
    return;
  }

  if (url.origin !== self.location.origin) return;

  // Оболочка: network-first, cache только как offline fallback.
  event.respondWith(
    fetch(new Request(event.request, { cache: 'no-store' }))
      .then(response => {
        const copy = response.clone();
        caches.open(CACHE).then(cache => cache.put(event.request, copy)).catch(() => {});
        return response;
      })
      .catch(() => caches.match(event.request))
  );
});
`;
await fs.writeFile(SW, sw, 'utf8');

console.log(`PASS APP BUILD ${build}`);
