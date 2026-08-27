'use strict';

import fs from 'node:fs/promises';
import crypto from 'node:crypto';

const INDEX = 'index.html';

const assets = [
  'sprint-marathon.js',
  'max-retro.js',
  'next-draw-banner.js'
];

async function exists(path) {
  try {
    await fs.access(path);
    return true;
  } catch {
    return false;
  }
}

async function fileHash(path) {
  const data = await fs.readFile(path);
  return crypto
    .createHash('sha256')
    .update(data)
    .digest('hex')
    .slice(0, 12);
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

let html = await fs.readFile(INDEX, 'utf8');
let changed = false;

// Если рамка следующего тиража уже загружена в репозиторий,
// но ещё не подключена в index.html — подключаем автоматически.
if (
  await exists('next-draw-banner.js') &&
  !html.includes('next-draw-banner.js')
) {
  html = html.replace(
    /<\/body>/i,
    '<script src="next-draw-banner.js?v=bootstrap"></script>\n</body>'
  );
  changed = true;
  console.log('ADD next-draw-banner.js -> index.html');
}

for (const asset of assets) {
  if (!(await exists(asset))) {
    console.log(`SKIP ${asset}: file not found`);
    continue;
  }

  const version = await fileHash(asset);
  const name = escapeRegExp(asset);

  const scriptRe = new RegExp(
    `(<script\\b[^>]*\\bsrc=["']${name})(?:\\?v=[^"']*)?(["'][^>]*><\\/script>)`,
    'gi'
  );

  const before = html;
  html = html.replace(scriptRe, `$1?v=${version}$2`);

  if (html !== before) {
    changed = true;
    console.log(`${asset} -> ?v=${version}`);
  } else {
    console.log(`WARN ${asset}: reference not found in index.html`);
  }
}

if (changed) {
  await fs.writeFile(INDEX, html, 'utf8');
  console.log('PASS: index.html versions updated');
} else {
  console.log('PASS: versions already current');
}
