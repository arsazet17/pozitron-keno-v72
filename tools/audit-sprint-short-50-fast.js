'use strict';

const fs = require('fs');
const vm = require('vm');
const path = require('path');

const file = path.join(__dirname, 'audit-sprint-short-50.js');
let src = fs.readFileSync(file, 'utf8');
src = src.replace(
  'function buildGroupMovementStats(winnerCache, drawCounts, endIndex) {',
  'const __GM_AUDIT_CACHE = new Map();\nfunction buildGroupMovementStats(winnerCache, drawCounts, endIndex) {\n  if (__GM_AUDIT_CACHE.has(endIndex)) return __GM_AUDIT_CACHE.get(endIndex);'
);
src = src.replace(
  '  return {books};\n}\n\nfunction gmStableSignal',
  '  const __value = {books};\n  __GM_AUDIT_CACHE.set(endIndex, __value);\n  return __value;\n}\n\nfunction gmStableSignal'
);
vm.runInThisContext(src, { filename: file });
