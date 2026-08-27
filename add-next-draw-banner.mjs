'use strict';

import fs from 'node:fs/promises';
import crypto from 'node:crypto';

const INDEX = 'index.html';
const JS = 'next-draw-banner.js';

let html = await fs.readFile(INDEX, 'utf8');
const js = await fs.readFile(JS);
const version = crypto.createHash('sha256').update(js).digest('hex').slice(0, 12);

const tag = `<script src="${JS}?v=${version}"></script>`;

if (/next-draw-banner\.js(?:\?v=[^"']*)?/.test(html)) {
  html = html.replace(
    /<script src=["']next-draw-banner\.js(?:\?v=[^"']*)?["']><\/script>/,
    tag
  );
} else {
  html = html.replace(/<\/body>/i, `${tag}\n</body>`);
}

await fs.writeFile(INDEX, html, 'utf8');
console.log(`PASS: ${JS}?v=${version}`);
