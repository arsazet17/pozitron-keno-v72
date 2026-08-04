'use strict';

const fs = require('fs');

const SOURCE_URL = 'https://lucky-numbers.ru/lottery/ru/keno2';
const HISTORY_FILE = 'keno-history.json';
const OUTPUT_FILE = 'keno-auto.json';
const ALGORITHM_VERSION = '2.2.0';
const colOf = n => n % 10 || 10;
const clamp01 = v => Math.max(0, Math.min(1, Number(v) || 0));

function counts(draw) {
  const out = Array(11).fill(0);
  for (const n of draw?.balls || []) out[colOf(Number(n))] += 1;
  return out;
}

function winner(draw) {
  const final = counts(draw);
  const max = Math.max(...final.slice(1));
  const running = Array(11).fill(0);
  for (const raw of draw?.balls || []) {
    const c = colOf(Number(raw));
    running[c] += 1;
    if (running[c] === max) return c;
  }
  return 1;
}

function makeCache(draws) {
  const countCache = draws.map(counts);
  const winnerCache = draws.map(winner);
  const stateCache = Array(draws.length).fill(null);
  for (let i = 1; i < draws.length; i += 1) {
    stateCache[i] = Math.min(4, countCache[i - 1][winnerCache[i]] || 0);
  }
  return { countCache, winnerCache, stateCache };
}

function weightedSequenceSimilarity(cache, aEnd, bEnd, len) {
  const a = [], b = [];
  for (let k = len - 1; k >= 0; k -= 1) {
    const av = cache.stateCache[aEnd - k];
    const bv = cache.stateCache[bEnd - k];
    if (av === null || bv === null || av === undefined || bv === undefined) continue;
    a.push(av); b.push(bv);
  }
  if (!a.length || a.length !== b.length) return 0;
  let score = 0, total = 0;
  for (let i = 0; i < a.length; i += 1) {
    const w = i + 1;
    total += w;
    score += w * (1 - Math.min(1, Math.abs(a[i] - b[i]) / 4));
  }
  return total ? score / total : 0;
}

function countVectorSimilarity(a, b) {
  let diff = 0;
  for (let c = 1; c <= 10; c += 1) diff += Math.abs((a[c] || 0) - (b[c] || 0));
  return clamp01(1 - diff / 24);
}

function recentWinnerRate(cache, col, endIndex, window) {
  const start = Math.max(0, endIndex - window + 1);
  let hits = 0;
  for (let i = start; i <= endIndex; i += 1) if (cache.winnerCache[i] === col) hits += 1;
  return hits / Math.max(1, endIndex - start + 1);
}

function transitionWinnerRate(cache, col, endIndex, window) {
  if (endIndex < 2) return 0.10;
  const currentWinner = cache.winnerCache[endIndex];
  const start = Math.max(1, endIndex - window + 1);
  let cases = 0, hits = 0;
  for (let i = start; i <= endIndex; i += 1) {
    if (cache.winnerCache[i - 1] !== currentWinner) continue;
    cases += 1;
    if (cache.winnerCache[i] === col) hits += 1;
  }
  return (hits + 2) / (cases + 20);
}

function analogRows(draws, cache, endIndex, type) {
  const sprint = type === 'sprint';
  const targetCounts = cache.countCache[endIndex];
  const targetWinner = cache.winnerCache[endIndex];
  const seqLen = sprint ? 4 : 7;
  const maxLookback = sprint ? 5000 : 12000;
  const start = Math.max(seqLen, endIndex - maxLookback);
  const rows = [];

  for (let i = start; i < endIndex; i += 1) {
    if (endIndex - i <= seqLen + 1) continue;
    const vec = countVectorSimilarity(targetCounts, cache.countCache[i]);
    const seq = weightedSequenceSimilarity(cache, endIndex, i, seqLen);
    const sameWinner = cache.winnerCache[i] === targetWinner ? 1 : 0;
    const score = sprint
      ? vec * 0.50 + seq * 0.30 + sameWinner * 0.20
      : vec * 0.42 + seq * 0.43 + sameWinner * 0.15;
    if (score < (sprint ? 0.48 : 0.52)) continue;
    rows.push({ index: i, nextIndex: i + 1, score });
  }

  rows.sort((a, b) => b.score - a.score || b.index - a.index);
  return rows.slice(0, sprint ? 90 : 180);
}

function modelProbabilities(draws, cache, endIndex, type) {
  const sprint = type === 'sprint';
  const rows = analogRows(draws, cache, endIndex, type);
  const weightedHits = Array(11).fill(0);
  let totalWeight = 0;

  rows.forEach((row, rank) => {
    const recency = 0.72 + 0.28 * ((row.index + 1) / Math.max(1, endIndex));
    const rankWeight = Math.max(0.45, 1 - rank / Math.max(100, rows.length * 1.4));
    const weight = Math.pow(row.score, 4) * recency * rankWeight;
    weightedHits[cache.winnerCache[row.nextIndex]] += weight;
    totalWeight += weight;
  });

  const prior = 14;
  const probs = Array(11).fill(0);
  for (let col = 1; col <= 10; col += 1) {
    const analogP = (weightedHits[col] + prior * 0.10) / (totalWeight + prior);
    const transitionP = transitionWinnerRate(cache, col, endIndex, sprint ? 220 : 700);
    const recentP = recentWinnerRate(cache, col, endIndex, sprint ? 30 : 240);
    probs[col] = sprint
      ? analogP * 0.74 + transitionP * 0.16 + recentP * 0.10
      : analogP * 0.80 + transitionP * 0.10 + recentP * 0.10;
  }

  const total = probs.slice(1).reduce((a, b) => a + b, 0) || 1;
  for (let col = 1; col <= 10; col += 1) probs[col] /= total;

  const columns = Array.from({ length: 10 }, (_, i) => i + 1)
    .sort((a, b) => probs[b] - probs[a] || a - b)
    .slice(0, 4);

  return { probs, columns, analogs: rows.length, rows };
}

function recentGap(draws, n, endIndex, maxWindow = 40) {
  const start = Math.max(0, endIndex - maxWindow + 1);
  for (let i = endIndex; i >= start; i -= 1) {
    if ((draws[i]?.balls || []).includes(n)) return endIndex - i;
  }
  return maxWindow;
}

function numberScore(draws, n, endIndex, type) {
  const lastSet = new Set(draws[endIndex]?.balls || []);
  if (type === 'sprint') {
    const prevSet = new Set(draws[endIndex - 1]?.balls || []);
    const recent = draws.slice(Math.max(0, endIndex - 7), endIndex + 1);
    const hits = recent.filter(d => (d?.balls || []).includes(n)).length;
    const has = x => x >= 1 && x <= 80 && lastSet.has(x);
    let score = lastSet.has(n) ? 0.30 : 0.62;
    score += hits / Math.max(1, recent.length) * 0.95;
    if (!lastSet.has(n) && prevSet.has(n)) score += 0.45;
    if (has(n - 1) || has(n + 1)) score += 0.40;
    if (has(n - 10) || has(n + 10)) score += 0.48;
    if (has(n - 2) || has(n + 2)) score += 0.20;
    if (recentGap(draws, n, endIndex, 12) >= 3) score += 0.28;
    return score;
  }

  const recent80 = draws.slice(Math.max(0, endIndex - 79), endIndex + 1);
  const long240 = draws.slice(Math.max(0, endIndex - 239), endIndex + 1);
  const rate80 = recent80.filter(d => (d?.balls || []).includes(n)).length / Math.max(1, recent80.length);
  const rate240 = long240.filter(d => (d?.balls || []).includes(n)).length / Math.max(1, long240.length);
  const gap = recentGap(draws, n, endIndex, 60);
  const half = Math.max(1, Math.floor(recent80.length / 2));
  const earlyRate = recent80.slice(0, half).filter(d => (d?.balls || []).includes(n)).length / half;
  const latePart = recent80.slice(half);
  const lateRate = latePart.filter(d => (d?.balls || []).includes(n)).length / Math.max(1, latePart.length);
  const stability = 1 - Math.min(1, Math.abs(rate80 - rate240) * 5);
  let score = rate80 * 1.45 + rate240 * 1.25 + stability * 0.28;
  score += Math.min(0.32, gap * 0.035);
  score += Math.max(-0.20, Math.min(0.20, lateRate - earlyRate)) * 0.70;
  if (lastSet.has(n)) score -= 0.12;
  return score;
}

function rankNumbers(draws, columns, type, endIndex) {
  const rows = [];
  for (const col of columns) {
    for (let n = col; n <= 80; n += 10) rows.push({ n, score: numberScore(draws, n, endIndex, type) });
  }
  rows.sort((a, b) => b.score - a.score || a.n - b.n);
  const limit = type === 'sprint' ? 6 : 8;
  const lastSet = new Set(draws[endIndex]?.balls || []);
  const selected = [];
  let repeats = 0;
  for (const row of rows) {
    if (selected.length >= limit) break;
    const repeat = lastSet.has(row.n);
    if (repeat && repeats >= 2) continue;
    selected.push(row.n);
    if (repeat) repeats += 1;
  }
  for (const row of rows) {
    if (selected.length >= limit) break;
    if (!selected.includes(row.n)) selected.push(row.n);
  }
  return selected;
}

function backtest(draws, cache, type, endIndex, tests = 60) {
  const start = Math.max(260, endIndex - tests);
  let n = 0, first = 0, top4 = 0;
  for (let i = start; i < endIndex; i += 1) {
    const p = modelProbabilities(draws, cache, i, type);
    if (!p.columns.length) continue;
    const actual = cache.winnerCache[i + 1];
    n += 1;
    if (p.columns[0] === actual) first += 1;
    if (p.columns.includes(actual)) top4 += 1;
  }
  const top1Rate = n ? first / n : 0;
  const top4Rate = n ? top4 / n : 0;
  const uplift = top4Rate - 0.40;
  const signal = n < 25 ? 'недостаточно данных'
    : top4Rate >= 0.52 && top1Rate >= 0.13 ? 'сильный'
      : top4Rate >= 0.46 ? 'средний' : 'слабый';
  return { tests: n, first, top4, top1Rate, top4Rate, uplift, signal };
}

function makeModel(draws, cache, type, endIndex = draws.length - 1, withBacktest = true) {
  const p = modelProbabilities(draws, cache, endIndex, type);
  const bt = withBacktest ? backtest(draws, cache, type, endIndex) : null;
  const columns = p.columns;
  const numbers = rankNumbers(draws, columns, type, endIndex);
  const currentCounts = cache.countCache[endIndex];
  const regimes = Array.from({ length: 5 }, (_, state) => {
    const cols = [];
    let probability = 0;
    for (let col = 1; col <= 10; col += 1) {
      if (Math.min(4, currentCounts[col]) === state) {
        cols.push(col);
        probability += p.probs[col];
      }
    }
    return { state: state === 4 ? '4+' : String(state), percent: Math.round(probability * 100), columns: cols };
  });
  return {
    algorithmVersion: ALGORITHM_VERSION,
    columns,
    columnProbabilities: columns.map(col => ({ col, percent: Number((p.probs[col] * 100).toFixed(1)) })),
    allColumnProbabilities: Array.from({ length: 10 }, (_, i) => ({ col: i + 1, percent: Number((p.probs[i + 1] * 100).toFixed(1)) })),
    numbers,
    numberCount: numbers.length,
    signal: bt?.signal || 'не проверен',
    signalScore: bt?.top4Rate || 0,
    backtest: bt,
    analogs: p.analogs,
    regimes
  };
}

function stripTags(s) {
  return s.replace(/<script[\s\S]*?<\/script>/gi, ' ').replace(/<style[\s\S]*?<\/style>/gi, ' ').replace(/<[^>]+>/g, ' ').replace(/&nbsp;|&#160;/gi, ' ').replace(/\s+/g, ' ').trim();
}

function parsePage(html) {
  const rows = [];
  const trList = html.match(/<tr\b[\s\S]*?<\/tr>/gi) || [];
  for (const tr of trList) {
    const balls = [];
    const buttonRe = /<button\b[^>]*>\s*(\d{1,2})\s*<\/button>/gi;
    let m;
    while ((m = buttonRe.exec(tr)) && balls.length < 20) {
      const n = Number(m[1]);
      if (n >= 1 && n <= 80) balls.push(n);
    }
    if (balls.length !== 20 || new Set(balls).size !== 20) continue;
    const text = stripTags(tr);
    const dateMatch = text.match(/(\d{2}\.\d{2}\.\d{2,4})\s*,?\s*(\d{2}:\d{2})/);
    if (!dateMatch) continue;
    const beforeDate = text.slice(0, text.indexOf(dateMatch[0]));
    const nums = [...beforeDate.matchAll(/(?:^|\s)(\d[\d\s\u00a0]{4,8})(?=\s|$)/g)]
      .map(x => Number(x[1].replace(/\s|\u00a0/g, '')))
      .filter(n => n >= 100000 && n <= 999999);
    const draw = nums.at(-1);
    if (!draw) continue;
    rows.push({ draw, date: dateMatch[1], time: dateMatch[2], balls });
  }
  const unique = new Map(rows.map(x => [x.draw, x]));
  return [...unique.values()].sort((a, b) => a.draw - b.draw);
}

function parseReaderText(text) {
  const rows = [];
  for (const line of String(text || '').split(/\r?\n/)) {
    const balls = [...line.matchAll(/\[Button:\s*(\d{1,2})\]/gi)].slice(0, 20).map(m => Number(m[1]));
    if (balls.length !== 20 || new Set(balls).size !== 20) continue;
    const dateMatch = line.match(/(\d{2}\.\d{2}\.\d{2,4})\s*,?\s*(\d{2}:\d{2})/);
    if (!dateMatch) continue;
    const beforeDate = line.slice(0, line.indexOf(dateMatch[0]));
    const drawMatches = beforeDate.match(/\b\d{3}[\s\u00a0]?\d{3}\b|\b\d{6}\b/g) || [];
    const raw = drawMatches.at(-1);
    const draw = raw ? Number(raw.replace(/[\s\u00a0]/g, '')) : 0;
    if (draw < 100000 || draw > 999999) continue;
    rows.push({ draw, date: dateMatch[1], time: dateMatch[2], balls });
  }
  const unique = new Map(rows.map(x => [x.draw, x]));
  return [...unique.values()].sort((a, b) => a.draw - b.draw);
}

function validDraw(d) {
  return Number.isInteger(Number(d?.draw)) && Array.isArray(d?.balls) && d.balls.length === 20 && new Set(d.balls.map(Number)).size === 20 && d.balls.every(n => Number(n) >= 1 && Number(n) <= 80);
}

async function fetchFresh() {
  const urls = [
    SOURCE_URL,
    `https://r.jina.ai/${SOURCE_URL}`
  ];
  let lastError;
  for (const url of urls) {
    try {
      const response = await fetch(url, { headers: { 'user-agent': 'Mozilla/5.0 GitHub-Actions Positron-Keno/2.2', accept: 'text/html,text/plain,*/*' }, signal: AbortSignal.timeout(35000) });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const text = await response.text();
      const fresh = parsePage(text);
      if (fresh.length) return fresh;
      const reader = parseReaderText(text);
      if (reader.length) return reader;
      throw new Error('тиражи не распознаны');
    } catch (e) { lastError = e; }
  }
  throw lastError || new Error('Источник недоступен');
}

async function main() {
  const fresh = await fetchFresh();
  const oldHistory = fs.existsSync(HISTORY_FILE) ? JSON.parse(fs.readFileSync(HISTORY_FILE, 'utf8')) : [];
  const map = new Map();
  for (const d of [...oldHistory, ...fresh]) {
    if (!validDraw(d)) continue;
    map.set(Number(d.draw), { draw: Number(d.draw), date: String(d.date), time: String(d.time), balls: d.balls.map(Number) });
  }
  const draws = [...map.values()].sort((a, b) => a.draw - b.draw);
  if (draws.length < 300) throw new Error(`Для честной модели нужно минимум 300 тиражей, сейчас ${draws.length}`);

  const cache = makeCache(draws);
  const previous = fs.existsSync(OUTPUT_FILE) ? JSON.parse(fs.readFileSync(OUTPUT_FILE, 'utf8')) : {};
  const forecasts = Array.isArray(previous.forecasts) ? previous.forecasts : [];
  const byDraw = new Map(draws.map(d => [d.draw, d]));

  for (const row of forecasts) {
    if (row.checked) continue;
    const actual = byDraw.get(Number(row.targetDraw));
    if (!actual) continue;
    const actualWinner = winner(actual);
    const place = Array.isArray(row.columns) ? row.columns.map(Number).indexOf(actualWinner) : -1;
    row.checked = true;
    row.actualWinner = actualWinner;
    row.place = place >= 0 ? place + 1 : 0;
    row.hit = place >= 0 && place < 4;
    row.first = place === 0;
    if (Array.isArray(row.numbers)) {
      const actualNumbers = new Set(actual.balls.map(Number));
      row.numberHits = row.numbers.map(Number).filter(n => actualNumbers.has(n));
      row.numberHitCount = row.numberHits.length;
    }
    row.checkedAt = new Date().toISOString();
  }

  const last = draws.at(-1);
  const sprint = makeModel(draws, cache, 'sprint');
  const marathon = makeModel(draws, cache, 'marathon');
  const current = { sprint, marathon };

  for (const type of ['sprint', 'marathon']) {
    if (!forecasts.some(x => x.type === type && Number(x.afterDraw) === last.draw)) {
      forecasts.push({
        type,
        afterDraw: last.draw,
        targetDraw: last.draw + 1,
        createdAt: new Date().toISOString(),
        columns: current[type].columns,
        columnProbabilities: current[type].columnProbabilities,
        numbers: current[type].numbers,
        algorithmVersion: ALGORITHM_VERSION,
        signal: current[type].signal,
        signalScore: current[type].signalScore,
        backtest: current[type].backtest,
        checked: false
      });
    }
  }

  const output = {
    version: 3,
    algorithmVersion: ALGORITHM_VERSION,
    source: SOURCE_URL,
    updatedAt: new Date().toISOString(),
    latestDraw: last.draw,
    latestDate: last.date,
    latestTime: last.time,
    drawsStored: draws.length,
    current,
    forecasts: forecasts.slice(-2000)
  };

  fs.writeFileSync(HISTORY_FILE, JSON.stringify(draws));
  fs.writeFileSync(OUTPUT_FILE, JSON.stringify(output, null, 2) + '\n');
  console.log(`Готово: тираж №${last.draw}; архив ${draws.length}; алгоритм ${ALGORITHM_VERSION}`);
  console.log(`Спринт: ${sprint.columns.join(', ')}; top4 backtest ${(sprint.backtest.top4Rate * 100).toFixed(1)}%`);
  console.log(`Марафон: ${marathon.columns.join(', ')}; top4 backtest ${(marathon.backtest.top4Rate * 100).toFixed(1)}%`);
}

main().catch(error => {
  console.error(error.stack || error.message || error);
  process.exit(1);
});
