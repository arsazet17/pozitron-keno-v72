#!/usr/bin/env node
'use strict';

const fs = require('fs');

const APP_VERSION = '7.2.4';
const BUILD = 'gm230-020926';

const browserMovementBlock = "\n  // GROUP_MOVEMENT_V230\n  const GROUP_MOVEMENT_CONFIG = {\n    p2:    { minN: 1200, minHalf: 500, edge: 0.0040, alpha: 400, sprint: 0.28, marathon: 0.12 },\n    p3:    { minN:  700, minHalf: 250, edge: 0.0050, alpha: 300, sprint: 0.25, marathon: 0.18 },\n    p4:    { minN:  450, minHalf: 180, edge: 0.0060, alpha: 220, sprint: 0.20, marathon: 0.25 },\n    p5:    { minN:  350, minHalf: 140, edge: 0.0065, alpha: 180, sprint: 0.12, marathon: 0.25 },\n    nbr:   { minN:  900, minHalf: 350, edge: 0.0045, alpha: 350, sprint: 0.12, marathon: 0.12 },\n    empty: { minN:  200, minHalf:  75, edge: 0.0060, alpha: 250, sprint: 0.08, marathon: 0.08 }\n  };\n\n  function gmNewBook() {\n    return { all: new Map(), first: new Map(), second: new Map() };\n  }\n\n  function gmBump(map, key, hit) {\n    const row = map.get(key) || { n: 0, wins: 0 };\n    row.n += 1;\n    if (hit) row.wins += 1;\n    map.set(key, row);\n  }\n\n  function gmAdd(book, key, hit, firstHalf) {\n    gmBump(book.all, key, hit);\n    gmBump(firstHalf ? book.first : book.second, key, hit);\n  }\n\n  function gmStateAt(index, col) {\n    if (drawCountCache.length !== (Array.isArray(draws) ? draws.length : 0)) rebuildStateCache();\n    return Math.min(4, drawCountCache[index]?.[col] || 0);\n  }\n\n  function gmStateText(value) {\n    return Number(value) === 4 ? '4+' : String(value);\n  }\n\n  function gmPathKey(endIndex, col, len) {\n    const out = [];\n    for (let i = endIndex - len + 1; i <= endIndex; i += 1) out.push(gmStateAt(i, col));\n    return out.join('>');\n  }\n\n  function gmNeighborKey(index, col) {\n    const left = col === 1 ? 10 : col - 1;\n    const right = col === 10 ? 1 : col + 1;\n    const sides = [gmStateAt(index, left), gmStateAt(index, right)].sort((a, b) => a - b);\n    return `${gmStateAt(index, col)}|${sides[0]}|${sides[1]}`;\n  }\n\n  function gmEmptyBucket(index, col) {\n    if (gmStateAt(index, col) !== 0) return null;\n    let streak = 0;\n    for (let i = index; i >= 0 && streak < 4; i -= 1) {\n      if (gmStateAt(i, col) !== 0) break;\n      streak += 1;\n    }\n    return String(Math.min(4, streak));\n  }\n\n  function buildGroupMovementStats(endIndex) {\n    if (groupMovementCache.endIndex === endIndex && groupMovementCache.stats) {\n      return groupMovementCache.stats;\n    }\n\n    const books = {\n      p2: gmNewBook(), p3: gmNewBook(), p4: gmNewBook(),\n      p5: gmNewBook(), nbr: gmNewBook(), empty: gmNewBook()\n    };\n    const zeroStreak = Array(11).fill(0);\n    const split = Math.floor(endIndex / 2);\n\n    for (let t = 0; t < endIndex; t += 1) {\n      const nextWinner = winnerAt(t + 1);\n      const firstHalf = t < split;\n\n      for (let col = 1; col <= 10; col += 1) {\n        const hit = col === nextWinner;\n        const state = gmStateAt(t, col);\n        zeroStreak[col] = state === 0 ? Math.min(4, zeroStreak[col] + 1) : 0;\n\n        for (const len of [2, 3, 4, 5]) {\n          if (t < len - 1) continue;\n          gmAdd(books[`p${len}`], gmPathKey(t, col, len), hit, firstHalf);\n        }\n\n        gmAdd(books.nbr, gmNeighborKey(t, col), hit, firstHalf);\n        if (state === 0) gmAdd(books.empty, String(zeroStreak[col]), hit, firstHalf);\n      }\n    }\n\n    const stats = { books };\n    groupMovementCache = { endIndex, stats };\n    return stats;\n  }\n\n  function gmFeatureLabel(feature, key) {\n    if (feature[0] === 'p') return key.split('>').map(gmStateText).join('→');\n    if (feature === 'nbr') {\n      const [self, a, b] = key.split('|');\n      return `${gmStateText(self)} · соседи ${gmStateText(a)}/${gmStateText(b)}`;\n    }\n    return `пусто ×${key === '4' ? '4+' : key}`;\n  }\n\n  function gmStableSignal(stats, feature, key, typeKey) {\n    const cfg = GROUP_MOVEMENT_CONFIG[feature];\n    const book = stats.books[feature];\n    const all = book.all.get(key);\n    const first = book.first.get(key);\n    const second = book.second.get(key);\n\n    if (!all || !first || !second) return null;\n    if (all.n < cfg.minN || first.n < cfg.minHalf || second.n < cfg.minHalf) return null;\n\n    const posterior = (all.wins + 0.10 * cfg.alpha) / (all.n + cfg.alpha);\n    const halfAlpha = cfg.alpha / 2;\n    const r1 = (first.wins + 0.10 * halfAlpha) / (first.n + halfAlpha);\n    const r2 = (second.wins + 0.10 * halfAlpha) / (second.n + halfAlpha);\n\n    if (Math.abs(posterior - 0.10) < cfg.edge) return null;\n    if ((r1 - 0.10) * (r2 - 0.10) <= 0) return null;\n    if (Math.abs(r1 - r2) > 0.025) return null;\n\n    const normalized = Math.max(-1, Math.min(1, (posterior - 0.10) / 0.02));\n    const weight = typeKey === 'sprint' ? cfg.sprint : cfg.marathon;\n\n    return {\n      feature,\n      key,\n      n: all.n,\n      rate: all.wins / all.n,\n      posterior,\n      weight,\n      effect: normalized * weight,\n      label: gmFeatureLabel(feature, key)\n    };\n  }\n\n  function groupMovementScore(endIndex, col, typeKey) {\n    const stats = buildGroupMovementStats(endIndex);\n    const signals = [];\n\n    for (const len of [2, 3, 4, 5]) {\n      const feature = `p${len}`;\n      const signal = gmStableSignal(stats, feature, gmPathKey(endIndex, col, len), typeKey);\n      if (signal) signals.push(signal);\n    }\n\n    const neighbor = gmStableSignal(stats, 'nbr', gmNeighborKey(endIndex, col), typeKey);\n    if (neighbor) signals.push(neighbor);\n\n    const emptyKey = gmEmptyBucket(endIndex, col);\n    if (emptyKey !== null) {\n      const empty = gmStableSignal(stats, 'empty', emptyKey, typeKey);\n      if (empty) signals.push(empty);\n    }\n\n    const weightedSum = signals.reduce((sum, s) => sum + s.effect, 0);\n    const weightSum = signals.reduce((sum, s) => sum + s.weight, 0);\n    const quality = weightedSum / Math.max(0.25, weightSum);\n    const coverage = Math.min(1, weightSum / 0.35);\n    const scale = typeKey === 'sprint' ? 1.10 : 1.00;\n    const points = Math.max(-0.85, Math.min(0.85, quality * coverage * scale));\n\n    signals.sort((a, b) => Math.abs(b.effect) - Math.abs(a.effect) || b.n - a.n);\n\n    return {\n      points,\n      activeWeight: weightSum,\n      signals,\n      summary: signals.slice(0, 2).map(s =>\n        `${s.label} ${Math.round(s.rate * 1000) / 10}% N${s.n}`\n      ).join('; ')\n    };\n  }\n\n";
const nodeMovementBlock = "\n// GROUP_MOVEMENT_V230\nconst GROUP_MOVEMENT_CONFIG = {\n  p2:    { minN: 1200, minHalf: 500, edge: 0.0040, alpha: 400, sprint: 0.28, marathon: 0.12 },\n  p3:    { minN:  700, minHalf: 250, edge: 0.0050, alpha: 300, sprint: 0.25, marathon: 0.18 },\n  p4:    { minN:  450, minHalf: 180, edge: 0.0060, alpha: 220, sprint: 0.20, marathon: 0.25 },\n  p5:    { minN:  350, minHalf: 140, edge: 0.0065, alpha: 180, sprint: 0.12, marathon: 0.25 },\n  nbr:   { minN:  900, minHalf: 350, edge: 0.0045, alpha: 350, sprint: 0.12, marathon: 0.12 },\n  empty: { minN:  200, minHalf:  75, edge: 0.0060, alpha: 250, sprint: 0.08, marathon: 0.08 }\n};\n\nconst GROUP_MOVEMENT_CACHE = new Map();\n\nfunction gmNewBook() {\n  return { all: new Map(), first: new Map(), second: new Map() };\n}\n\nfunction gmBump(map, key, hit) {\n  const row = map.get(key) || { n: 0, wins: 0 };\n  row.n += 1;\n  if (hit) row.wins += 1;\n  map.set(key, row);\n}\n\nfunction gmAdd(book, key, hit, firstHalf) {\n  gmBump(book.all, key, hit);\n  gmBump(firstHalf ? book.first : book.second, key, hit);\n}\n\nfunction gmStateAt(drawCounts, index, col) {\n  return Math.min(4, drawCounts[index]?.[col] || 0);\n}\n\nfunction gmStateText(value) {\n  return Number(value) === 4 ? '4+' : String(value);\n}\n\nfunction gmPathKey(drawCounts, endIndex, col, len) {\n  const out = [];\n  for (let i = endIndex - len + 1; i <= endIndex; i += 1) {\n    out.push(gmStateAt(drawCounts, i, col));\n  }\n  return out.join('>');\n}\n\nfunction gmNeighborKey(drawCounts, index, col) {\n  const left = col === 1 ? 10 : col - 1;\n  const right = col === 10 ? 1 : col + 1;\n  const sides = [\n    gmStateAt(drawCounts, index, left),\n    gmStateAt(drawCounts, index, right)\n  ].sort((a, b) => a - b);\n  return `${gmStateAt(drawCounts, index, col)}|${sides[0]}|${sides[1]}`;\n}\n\nfunction gmEmptyBucket(drawCounts, index, col) {\n  if (gmStateAt(drawCounts, index, col) !== 0) return null;\n  let streak = 0;\n  for (let i = index; i >= 0 && streak < 4; i -= 1) {\n    if (gmStateAt(drawCounts, i, col) !== 0) break;\n    streak += 1;\n  }\n  return String(Math.min(4, streak));\n}\n\nfunction buildGroupMovementStats(draws, winnerCache, drawCounts, endIndex) {\n  const cacheKey = `${draws.length}:${endIndex}:${Number(draws[endIndex]?.draw || 0)}`;\n  if (GROUP_MOVEMENT_CACHE.has(cacheKey)) return GROUP_MOVEMENT_CACHE.get(cacheKey);\n\n  const books = {\n    p2: gmNewBook(), p3: gmNewBook(), p4: gmNewBook(),\n    p5: gmNewBook(), nbr: gmNewBook(), empty: gmNewBook()\n  };\n  const zeroStreak = Array(11).fill(0);\n  const split = Math.floor(endIndex / 2);\n\n  for (let t = 0; t < endIndex; t += 1) {\n    const nextWinner = winnerCache[t + 1];\n    const firstHalf = t < split;\n\n    for (let col = 1; col <= 10; col += 1) {\n      const hit = col === nextWinner;\n      const state = gmStateAt(drawCounts, t, col);\n      zeroStreak[col] = state === 0 ? Math.min(4, zeroStreak[col] + 1) : 0;\n\n      for (const len of [2, 3, 4, 5]) {\n        if (t < len - 1) continue;\n        gmAdd(books[`p${len}`], gmPathKey(drawCounts, t, col, len), hit, firstHalf);\n      }\n\n      gmAdd(books.nbr, gmNeighborKey(drawCounts, t, col), hit, firstHalf);\n      if (state === 0) gmAdd(books.empty, String(zeroStreak[col]), hit, firstHalf);\n    }\n  }\n\n  const stats = { books };\n  GROUP_MOVEMENT_CACHE.set(cacheKey, stats);\n  return stats;\n}\n\nfunction gmFeatureLabel(feature, key) {\n  if (feature[0] === 'p') return key.split('>').map(gmStateText).join('→');\n  if (feature === 'nbr') {\n    const [self, a, b] = key.split('|');\n    return `${gmStateText(self)} · соседи ${gmStateText(a)}/${gmStateText(b)}`;\n  }\n  return `пусто ×${key === '4' ? '4+' : key}`;\n}\n\nfunction gmStableSignal(stats, feature, key, typeKey) {\n  const cfg = GROUP_MOVEMENT_CONFIG[feature];\n  const book = stats.books[feature];\n  const all = book.all.get(key);\n  const first = book.first.get(key);\n  const second = book.second.get(key);\n\n  if (!all || !first || !second) return null;\n  if (all.n < cfg.minN || first.n < cfg.minHalf || second.n < cfg.minHalf) return null;\n\n  const posterior = (all.wins + 0.10 * cfg.alpha) / (all.n + cfg.alpha);\n  const halfAlpha = cfg.alpha / 2;\n  const r1 = (first.wins + 0.10 * halfAlpha) / (first.n + halfAlpha);\n  const r2 = (second.wins + 0.10 * halfAlpha) / (second.n + halfAlpha);\n\n  if (Math.abs(posterior - 0.10) < cfg.edge) return null;\n  if ((r1 - 0.10) * (r2 - 0.10) <= 0) return null;\n  if (Math.abs(r1 - r2) > 0.025) return null;\n\n  const normalized = Math.max(-1, Math.min(1, (posterior - 0.10) / 0.02));\n  const weight = typeKey === 'sprint' ? cfg.sprint : cfg.marathon;\n\n  return {\n    feature,\n    key,\n    n: all.n,\n    rate: all.wins / all.n,\n    posterior,\n    weight,\n    effect: normalized * weight,\n    label: gmFeatureLabel(feature, key)\n  };\n}\n\nfunction groupMovementScore(draws, winnerCache, drawCounts, endIndex, col, typeKey) {\n  const stats = buildGroupMovementStats(draws, winnerCache, drawCounts, endIndex);\n  const signals = [];\n\n  for (const len of [2, 3, 4, 5]) {\n    const feature = `p${len}`;\n    const signal = gmStableSignal(\n      stats,\n      feature,\n      gmPathKey(drawCounts, endIndex, col, len),\n      typeKey\n    );\n    if (signal) signals.push(signal);\n  }\n\n  const neighbor = gmStableSignal(\n    stats,\n    'nbr',\n    gmNeighborKey(drawCounts, endIndex, col),\n    typeKey\n  );\n  if (neighbor) signals.push(neighbor);\n\n  const emptyKey = gmEmptyBucket(drawCounts, endIndex, col);\n  if (emptyKey !== null) {\n    const empty = gmStableSignal(stats, 'empty', emptyKey, typeKey);\n    if (empty) signals.push(empty);\n  }\n\n  const weightedSum = signals.reduce((sum, s) => sum + s.effect, 0);\n  const weightSum = signals.reduce((sum, s) => sum + s.weight, 0);\n  const quality = weightedSum / Math.max(0.25, weightSum);\n  const coverage = Math.min(1, weightSum / 0.35);\n  const scale = typeKey === 'sprint' ? 1.10 : 1.00;\n  const points = Math.max(-0.85, Math.min(0.85, quality * coverage * scale));\n\n  signals.sort((a, b) => Math.abs(b.effect) - Math.abs(a.effect) || b.n - a.n);\n\n  return {\n    points,\n    activeWeight: weightSum,\n    signals,\n    summary: signals.slice(0, 2).map(s =>\n      `${s.label} ${Math.round(s.rate * 1000) / 10}% N${s.n}`\n    ).join('; ')\n  };\n}\n\n";
const browserOldScore = "      const stability = 1 - Math.min(1, Math.abs(rate80 - rate240) * 8);\n      const activity = sprint ? 0.65 * rate12 + 0.35 * rate30 : 0.55 * rate80 + 0.45 * rate240;\n      const score = sprint\n        ? activity * 55 + transition * 25 + perColumnRegime * 12 + momentum * 1.5\n        : activity * 60 + transition * 20 + stability * 3 + perColumnRegime * 5;\n";
const browserNewScore = "      const stability = 1 - Math.min(1, Math.abs(rate80 - rate240) * 8);\n      const activity = sprint ? 0.65 * rate12 + 0.35 * rate30 : 0.55 * rate80 + 0.45 * rate240;\n      const movement = groupMovementScore(endIndex, col, typeKey);\n      const baseScore = sprint\n        ? activity * 55 + transition * 25 + perColumnRegime * 12 + momentum * 1.5\n        : activity * 60 + transition * 20 + stability * 3 + perColumnRegime * 5;\n      const score = baseScore + movement.points;\n";
const nodeOldScore = "    const stability = 1 - Math.min(1, Math.abs(rate80 - rate240) * 8);\n\n    const activity = sprint\n      ? 0.65 * rate12 + 0.35 * rate30\n      : 0.55 * rate80 + 0.45 * rate240;\n\n    const score = sprint\n      ? activity * 55\n        + transition * 25\n        + perColumnRegime * 12\n        + momentum * 1.5\n      : activity * 60\n        + transition * 20\n        + stability * 3\n        + perColumnRegime * 5;\n";
const nodeNewScore = "    const stability = 1 - Math.min(1, Math.abs(rate80 - rate240) * 8);\n\n    const activity = sprint\n      ? 0.65 * rate12 + 0.35 * rate30\n      : 0.55 * rate80 + 0.45 * rate240;\n\n    const movement = groupMovementScore(\n      draws,\n      winnerCache,\n      drawCounts,\n      endIndex,\n      col,\n      typeKey\n    );\n\n    const baseScore = sprint\n      ? activity * 55\n        + transition * 25\n        + perColumnRegime * 12\n        + momentum * 1.5\n      : activity * 60\n        + transition * 20\n        + stability * 3\n        + perColumnRegime * 5;\n\n    const score = baseScore + movement.points;\n";

function read(path) {
  if (!fs.existsSync(path)) throw new Error(`Нет файла ${path}`);
  return fs.readFileSync(path, 'utf8');
}
function write(path, text) {
  fs.writeFileSync(path, text);
}
function replaceOnce(text, from, to, label) {
  const n = text.split(from).length - 1;
  if (n !== 1) throw new Error(`${label}: ожидалось 1 совпадение, найдено ${n}`);
  return text.replace(from, to);
}
function replaceOneOf(text, candidates, to, label) {
  if (text.includes(to)) return text;
  for (const from of candidates) {
    if (text.includes(from)) return text.replace(from, to);
  }
  throw new Error(`${label}: не найден ожидаемый старый фрагмент`);
}

function patchBrowser(text) {
  if (text.includes('// GROUP_MOVEMENT_V230')) return text;

  text = replaceOneOf(
    text,
    ["const ALGORITHM_VERSION = '2.1.0';", "const ALGORITHM_VERSION = '2.2.0';"],
    "const ALGORITHM_VERSION = '2.3.0';",
    'sprint-marathon version'
  );

  text = replaceOnce(
    text,
    "  let stateCache = [];\n",
    "  let stateCache = [];\n  let drawCountCache = [];\n  let groupMovementCache = { endIndex: -1, stats: null };\n",
    'browser cache vars'
  );

  text = replaceOnce(
    text,
    "    const drawCounts = new Array(list.length);\n",
    "    drawCountCache = new Array(list.length);\n    groupMovementCache = { endIndex: -1, stats: null };\n",
    'browser drawCountCache'
  );

  text = replaceOnce(text, "      drawCounts[i] = counts(list[i]);\n", "      drawCountCache[i] = counts(list[i]);\n", 'browser draw counts fill');
  text = replaceOnce(
    text,
    "      stateCache[i] = Math.min(4, drawCounts[i - 1][winnerCache[i]] || 0);\n",
    "      stateCache[i] = Math.min(4, drawCountCache[i - 1][winnerCache[i]] || 0);\n",
    'browser state cache source'
  );

  text = replaceOnce(
    text,
    "  function rankColumns(pred, endIndex, typeKey) {\n",
    browserMovementBlock + "  function rankColumns(pred, endIndex, typeKey) {\n",
    'browser movement insert'
  );

  text = replaceOnce(
    text,
    "    const current = counts(draws[endIndex]);\n",
    "    const current = drawCountCache.length === draws.length ? drawCountCache[endIndex] : counts(draws[endIndex]);\n",
    'browser current counts'
  );

  text = replaceOnce(text, browserOldScore, browserNewScore, 'browser score');

  text = replaceOnce(
    text,
    "      reasons.push(`режим ${stateLabel(state)} — малый вес`);\n",
    "      reasons.push(`режим ${stateLabel(state)} — малый вес`);\n      reasons.push(movement.signals.length ? `движение групп ${movement.points >= 0 ? '+' : ''}${movement.points.toFixed(2)} · ${movement.summary}` : 'движение групп: устойчивого сигнала нет');\n",
    'browser reason'
  );

  text = replaceOnce(
    text,
    "        reasons, regime: pred.probs[state] || 0, perColumnRegime, activity, transition, momentum, stability\n",
    "        reasons, regime: pred.probs[state] || 0, perColumnRegime, activity, transition, momentum, stability,\n        baseScore, movementPoints: movement.points, movementSignals: movement.signals\n",
    'browser row fields'
  );

  return text;
}

function patchNode(text) {
  if (text.includes('// GROUP_MOVEMENT_V230')) return text;

  text = replaceOneOf(
    text,
    ["const ALGORITHM_VERSION = '2.1.0';", "const ALGORITHM_VERSION = '2.2.0';"],
    "const ALGORITHM_VERSION = '2.3.0';",
    'keno-auto algorithm version'
  );
  text = replaceOneOf(
    text,
    ["const MODEL_VERSION = 'screen-sm-2.1.0';", "const MODEL_VERSION = 'screen-sm-2.2.0';"],
    "const MODEL_VERSION = 'screen-sm-2.3.0';",
    'keno-auto model version'
  );

  text = replaceOnce(
    text,
    "function rankColumns(draws, winnerCache, drawCounts, pred, endIndex, typeKey) {\n",
    nodeMovementBlock + "function rankColumns(draws, winnerCache, drawCounts, pred, endIndex, typeKey) {\n",
    'node movement insert'
  );

  text = replaceOnce(text, nodeOldScore, nodeNewScore, 'node score');

  text = replaceOnce(
    text,
    "    reasons.push(`режим ${state === 4 ? '4+' : state} — малый вес`);\n",
    "    reasons.push(`режим ${state === 4 ? '4+' : state} — малый вес`);\n    reasons.push(movement.signals.length ? `движение групп ${movement.points >= 0 ? '+' : ''}${movement.points.toFixed(2)} · ${movement.summary}` : 'движение групп: устойчивого сигнала нет');\n",
    'node reason'
  );

  text = replaceOnce(
    text,
    "      stability\n    });\n",
    "      stability,\n      baseScore,\n      movementPoints: movement.points,\n      movementSignals: movement.signals\n    });\n",
    'node row fields'
  );

  return text;
}

let sprint = patchBrowser(read('sprint-marathon.js'));
let auto = patchNode(read('keno-auto.js'));

write('sprint-marathon.js', sprint);
write('keno-auto.js', auto);

const appVersion = JSON.parse(read('app-version.json'));
appVersion.version = APP_VERSION;
write('app-version.json', JSON.stringify(appVersion, null, 2) + '\n');

const manifest = JSON.parse(read('manifest.webmanifest'));
manifest.name = String(manifest.name || '').replace(/v7\.2\.\d+/g, `v${APP_VERSION}`);
manifest.short_name = String(manifest.short_name || '').replace(/v7\.2\.\d+/g, `v${APP_VERSION}`);
manifest.start_url = `./?v=${BUILD}`;
write('manifest.webmanifest', JSON.stringify(manifest, null, 2) + '\n');

let sw = read('sw.js');
sw = sw.replace(/const CACHE='pozitron-v72-shell-[^']+';/, `const CACHE='pozitron-v72-shell-${BUILD}';`);
write('sw.js', sw);

let index = read('index.html');
index = index.replace(/v7\.2\.\d+/g, `v${APP_VERSION}`);
index = index.replace(/<meta name="app-build" content="[^"]+">/, `<meta name="app-build" content="${BUILD}">`);
index = index.replace(/sprint-marathon\.js\?v=[^"]+/, `sprint-marathon.js?v=${BUILD}`);
index = index.replace(/sw\.js\?v=[^'"]+/, `sw.js?v=${BUILD}`);
write('index.html', index);

console.log('Установлено: KENO v7.2.4 · Group Movement 2.3.0');
