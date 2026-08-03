'use strict';

const fs = require('fs');

const SOURCE_URL = 'https://lucky-numbers.ru/lottery/ru/keno2';
const HISTORY_FILE = 'keno-history.json';
const OUTPUT_FILE = 'keno-auto.json';
const ALGORITHM_VERSION = '2.1.0';
const colOf = n => n % 10 || 10;

function counts(draw) {
  const out = Array(11).fill(0);
  for (const n of draw?.balls || []) out[colOf(Number(n))] += 1;
  return out;
}

// Победитель: максимальное количество чисел; при равенстве — столбец,
// который первым достиг этого максимума в порядке выпадения шаров.
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

function stateBeforeWinner(draws, i) {
  if (i <= 0) return null;
  return Math.min(4, counts(draws[i - 1])[winner(draws[i])] || 0);
}

function sequence(draws, end, len) {
  const out = [];
  for (let i = Math.max(1, end - len + 1); i <= end; i += 1) {
    const state = stateBeforeWinner(draws, i);
    if (state !== null) out.push(state);
  }
  return out;
}

function weightedSimilarity(a, b) {
  const n = Math.min(a.length, b.length);
  if (!n) return 0;
  let score = 0, total = 0;
  for (let i = 0; i < n; i += 1) {
    const weight = i + 1;
    const av = a[a.length - n + i];
    const bv = b[b.length - n + i];
    total += weight;
    score += weight * (1 - Math.min(1, Math.abs(av - bv) / 4));
  }
  return total ? score / total : 0;
}

function addHistoricalBaseline(draws, support, minIndex, maxIndex, weight) {
  const freq = Array(5).fill(0);
  for (let i = Math.max(1, minIndex); i <= maxIndex; i += 1) {
    const s = stateBeforeWinner(draws, i);
    if (s !== null) freq[s] += 1;
  }
  const total = freq.reduce((a, b) => a + b, 0) || 1;
  freq.forEach((v, i) => { support[i] += weight * v / total; });
}

function addSuffixEvidence(draws, seq, minIndex, maxIndex, support, stats) {
  const lengths = [5, 4, 3, 2];
  for (const len of lengths) {
    if (seq.length < len) continue;
    const target = seq.slice(-len);
    for (let i = Math.max(minIndex + len - 1, len); i < maxIndex; i += 1) {
      const candidate = [];
      for (let j = i - len + 1; j <= i; j += 1) candidate.push(stateBeforeWinner(draws, j));
      if (candidate.some(v => v === null)) continue;
      const next = stateBeforeWinner(draws, i + 1);
      if (next === null) continue;
      const exact = candidate.every((v, j) => v === target[j]);
      const sim = exact ? 1 : weightedSimilarity(target, candidate);
      if (!exact && sim < 0.72) continue;
      const recency = 0.55 + 0.45 * (i / Math.max(1, maxIndex));
      const lengthWeight = { 5: 4.8, 4: 3.0, 3: 1.8, 2: 0.8 }[len];
      const weight = lengthWeight * recency * Math.pow(sim, 4);
      support[next] += weight;
      stats.weight += weight;
      if (exact && len === 5) stats.exact += 1;
      else stats.near += 1;
    }
  }
}

function addSwitchEvidence(draws, seq, minIndex, maxIndex, support, stats) {
  if (seq.length < 3) return;
  const last = seq.at(-1), prev = seq.at(-2), prev2 = seq.at(-3);
  const targetChanged = last !== prev;
  const targetChangedTwice = prev !== prev2;
  for (let i = Math.max(3, minIndex); i < maxIndex; i += 1) {
    const a = stateBeforeWinner(draws, i - 2);
    const b = stateBeforeWinner(draws, i - 1);
    const c = stateBeforeWinner(draws, i);
    const next = stateBeforeWinner(draws, i + 1);
    if ([a, b, c, next].some(v => v === null)) continue;
    let match = 0;
    if (b === prev && c === last) match += 0.48;
    if ((c !== b) === targetChanged) match += 0.24;
    if ((b !== a) === targetChangedTwice) match += 0.14;
    if (Math.sign(c - b) === Math.sign(last - prev)) match += 0.14;
    if (match < 0.60) continue;
    const weight = 0.9 * Math.pow(match, 3);
    support[next] += weight;
    stats.weight += weight;
    stats.switchCases += 1;
  }
}

function currentAvailability(draws, endIndex = draws.length - 1) {
  const current = counts(draws[endIndex]);
  const byState = Array.from({ length: 5 }, () => []);
  for (let col = 1; col <= 10; col += 1) byState[Math.min(4, current[col])].push(col);
  return byState;
}

function profileKey(available) {
  return available.map(cols => cols.length).join('-');
}

function densityProfileForecast(draws, endIndex, maxIndex) {
  const available = currentAvailability(draws, endIndex);
  const baseProbs = available.map(cols => cols.length / 10);
  const targetKey = profileKey(available);
  const countsNext = Array(5).fill(0);
  let matches = 0;

  for (let currentIndex = 0; currentIndex <= maxIndex; currentIndex += 1) {
    const historicalAvailable = currentAvailability(draws, currentIndex);
    if (profileKey(historicalAvailable) !== targetKey) continue;
    const nextState = stateBeforeWinner(draws, currentIndex + 1);
    if (nextState === null) continue;
    countsNext[nextState] += 1;
    matches += 1;
  }

  // Точное распределение плотности сглаживаем базой:
  // если в режиме 3 находятся 4 столбца, его естественная база — 40%.
  const alpha = 20;
  const profileProbs = countsNext.map((count, state) =>
    (count + alpha * baseProbs[state]) / (matches + alpha)
  );

  return { available, baseProbs, profileProbs, profileMatches: matches };
}

function analogForecast(draws, seq, minIndex, maxIndex, endIndex = draws.length - 1) {
  const support = Array(5).fill(0);
  const stats = { exact: 0, near: 0, switchCases: 0, weight: 0 };
  addSuffixEvidence(draws, seq, minIndex, maxIndex, support, stats);
  addSwitchEvidence(draws, seq, minIndex, maxIndex, support, stats);
  addHistoricalBaseline(draws, support, minIndex, maxIndex, Math.max(0.35, stats.weight * 0.25));

  const density = densityProfileForecast(draws, endIndex, maxIndex);
  const supportTotal = support.reduce((a, b) => a + b, 0);
  const chainProbs = supportTotal
    ? support.map(v => v / supportTotal)
    : density.baseProbs.slice();

  // Плотность последнего тиража — только небольшая поправка. Основной вес
  // получают повторяющиеся цепочки и переключения, найденные в архиве.
  const mixed = density.profileProbs.map((v, state) =>
    density.available[state].length ? 0.30 * v + 0.70 * chainProbs[state] : 0
  );
  const total = mixed.reduce((a, b) => a + b, 0) || 1;
  const probs = mixed.map(v => v / total);

  return {
    probs,
    available: density.available,
    baseProbs: density.baseProbs,
    profileProbs: density.profileProbs,
    profileMatches: density.profileMatches,
    ...stats
  };
}

function winnerStreak(draws, col) {
  let streak = 0;
  for (let i = draws.length - 1; i >= 0; i -= 1) {
    if (winner(draws[i]) === col) streak += 1; else break;
  }
  return streak;
}

function preservedWinnerFrame(draws, col) {
  if (draws.length < 2) return 0;
  const last = new Set(draws.at(-1).balls || []);
  const prev = (draws.at(-2).balls || []).filter(n => colOf(n) === col);
  return prev.filter(n => last.has(n)).length;
}

function recentWinnerRate(draws, col, endIndex, window) {
  const start = Math.max(0, endIndex - window + 1);
  let hits = 0;
  for (let i = start; i <= endIndex; i += 1) if (winner(draws[i]) === col) hits += 1;
  return hits / Math.max(1, endIndex - start + 1);
}

function densityMomentum(draws, col, endIndex) {
  if (endIndex < 2) return 0;
  const recentStart = Math.max(0, endIndex - 3);
  const previousEnd = recentStart - 1;
  const previousStart = Math.max(0, previousEnd - 3);
  let recentSum = 0, recentN = 0, previousSum = 0, previousN = 0;
  for (let i = recentStart; i <= endIndex; i += 1) {
    recentSum += counts(draws[i])[col];
    recentN += 1;
  }
  for (let i = previousStart; i <= previousEnd; i += 1) {
    previousSum += counts(draws[i])[col];
    previousN += 1;
  }
  return recentSum / Math.max(1, recentN) - previousSum / Math.max(1, previousN);
}

function recentGap(draws, n, endIndex, maxWindow = 40) {
  const start = Math.max(0, endIndex - maxWindow + 1);
  for (let i = endIndex; i >= start; i -= 1) {
    if ((draws[i]?.balls || []).includes(n)) return endIndex - i;
  }
  return maxWindow;
}

function sprintNumberScore(draws, n, endIndex) {
  const lastSet = new Set(draws[endIndex]?.balls || []);
  const prevSet = new Set(draws[endIndex - 1]?.balls || []);
  const recent = draws.slice(Math.max(0, endIndex - 7), endIndex + 1);
  const hits = recent.filter(d => (d?.balls || []).includes(n)).length;
  const has = value => value >= 1 && value <= 80 && lastSet.has(value);
  let score = lastSet.has(n) ? 0.30 : 0.62;
  score += hits / Math.max(1, recent.length) * 0.95;
  if (!lastSet.has(n) && prevSet.has(n)) score += 0.45;
  if (has(n - 1) || has(n + 1)) score += 0.40;
  if (has(n - 10) || has(n + 10)) score += 0.48;
  if (has(n - 2) || has(n + 2)) score += 0.20;
  if (recentGap(draws, n, endIndex, 12) >= 3) score += 0.28;
  return score;
}

function marathonNumberScore(draws, n, endIndex) {
  const lastSet = new Set(draws[endIndex]?.balls || []);
  const recent80 = draws.slice(Math.max(0, endIndex - 79), endIndex + 1);
  const long240 = draws.slice(Math.max(0, endIndex - 239), endIndex + 1);
  const rate80 = recent80.filter(d => (d?.balls || []).includes(n)).length / Math.max(1, recent80.length);
  const rate240 = long240.filter(d => (d?.balls || []).includes(n)).length / Math.max(1, long240.length);
  const gap = recentGap(draws, n, endIndex, 60);
  const half = Math.max(1, Math.floor(recent80.length / 2));
  const earlyRate = recent80.slice(0, half).filter(d => (d?.balls || []).includes(n)).length / half;
  const latePart = recent80.slice(half);
  const lateRate = latePart.filter(d => (d?.balls || []).includes(n)).length / Math.max(1, latePart.length);
  let freshReturns = 0;
  for (let i = Math.max(1, endIndex - 79); i <= endIndex; i += 1) {
    const before = new Set(draws[i - 1]?.balls || []);
    const current = new Set(draws[i]?.balls || []);
    if (!before.has(n) && current.has(n)) freshReturns += 1;
  }

  const stability = 1 - Math.min(1, Math.abs(rate80 - rate240) * 5);
  const trend = Math.max(-0.20, Math.min(0.20, lateRate - earlyRate));
  let score = rate80 * 1.45 + rate240 * 1.25 + stability * 0.28;
  score += Math.min(0.32, gap * 0.035);
  score += Math.min(0.24, freshReturns * 0.025);
  score += trend * 0.70;
  if (lastSet.has(n)) score -= 0.12;
  return score;
}

function pickNumbers(draws, rows, limit, endIndex) {
  const lastSet = new Set(draws[endIndex]?.balls || []);
  const selected = [];
  let repeats = 0;
  for (const row of rows) {
    if (selected.length >= limit) break;
    const repeat = lastSet.has(row.n);
    if (repeat && repeats >= 2) continue;
    selected.push(row);
    if (repeat) repeats += 1;
  }
  if (selected.length < limit) {
    const used = new Set(selected.map(row => row.n));
    for (const row of rows) {
      if (selected.length >= limit) break;
      if (used.has(row.n)) continue;
      selected.push(row);
      used.add(row.n);
    }
  }
  return selected.map(row => row.n);
}

function rankNumbers(draws, columns, type, endIndex) {
  const rows = [];
  for (const col of columns) {
    for (let n = col; n <= 80; n += 10) {
      const score = type === 'sprint'
        ? sprintNumberScore(draws, n, endIndex)
        : marathonNumberScore(draws, n, endIndex);
      rows.push({ n, score });
    }
  }
  rows.sort((a, b) => b.score - a.score || a.n - b.n);
  return pickNumbers(draws, rows, type === 'sprint' ? 6 : 8, endIndex);
}

function transitionWinnerRate(draws, col, endIndex, window) {
  if (endIndex < 2) return 0.10;
  const previousWinner = winner(draws[endIndex]);
  const start = Math.max(1, endIndex - window + 1);
  let cases = 0, hits = 0;
  for (let i = start; i <= endIndex; i += 1) {
    if (winner(draws[i - 1]) !== previousWinner) continue;
    cases += 1;
    if (winner(draws[i]) === col) hits += 1;
  }
  // Сглаживание к естественной базе 10% не даёт редкому переходу
  // получить чрезмерный вес.
  return (hits + 2) / (cases + 20);
}

function stableTie(draws, col, endIndex, salt) {
  let x = (Number(draws[endIndex]?.draw) || endIndex + 1) ^ Math.imul(col + salt, 0x9e3779b1);
  x ^= x >>> 16;
  x = Math.imul(x, 0x85ebca6b);
  x ^= x >>> 13;
  return (x >>> 0) / 4294967296;
}

function signalFromRows(rows) {
  const fourth = rows[3]?.score ?? 0;
  const fifth = rows[4]?.score ?? fourth;
  const first = rows[0]?.score ?? fourth;
  const margin = Math.max(0, fourth - fifth);
  const spread = Math.max(0, first - fifth);
  const score = Math.max(0, Math.min(1, margin / 1.5 * 0.65 + spread / 5 * 0.35));
  return {
    signal: score >= 0.62 ? 'сильный' : score >= 0.34 ? 'средний' : 'слабый',
    signalScore: Number(score.toFixed(3)),
    margin: Number(margin.toFixed(4))
  };
}

function allocateStateSlots(pred, slots = 4) {
  const availableCounts = pred.available.map(cols => cols.length);
  const raw = pred.probs.map(p => p * slots);
  const quota = raw.map((v, state) => Math.min(availableCounts[state], Math.floor(v)));
  let left = slots - quota.reduce((a, b) => a + b, 0);

  const order = [0, 1, 2, 3, 4].sort((a, b) =>
    (raw[b] - Math.floor(raw[b])) - (raw[a] - Math.floor(raw[a]))
    || pred.probs[b] - pred.probs[a]
    || availableCounts[b] - availableCounts[a]
    || a - b
  );

  while (left > 0) {
    let added = false;
    for (const state of order) {
      if (quota[state] >= availableCounts[state]) continue;
      quota[state] += 1;
      left -= 1;
      added = true;
      if (!left) break;
    }
    if (!added) break;
  }
  return quota;
}

function rankColumns(draws, pred, type, endIndex = draws.length - 1) {
  const current = counts(draws[endIndex]);
  const rows = [];
  const sprint = type === 'sprint';

  for (let col = 1; col <= 10; col += 1) {
    const state = Math.min(4, current[col]);
    const groupSize = Math.max(1, pred.available[state]?.length || 0);
    const perColumnRegime = (pred.probs[state] || 0) / groupSize;

    const rate12 = recentWinnerRate(draws, col, endIndex, 12);
    const rate30 = recentWinnerRate(draws, col, endIndex, 30);
    const rate80 = recentWinnerRate(draws, col, endIndex, 80);
    const rate240 = recentWinnerRate(draws, col, endIndex, 240);
    const transition = transitionWinnerRate(draws, col, endIndex, sprint ? 160 : 600);
    const momentum = Math.max(-2, Math.min(2, densityMomentum(draws, col, endIndex)));
    const stability = 1 - Math.min(1, Math.abs(rate80 - rate240) * 8);
    const activity = sprint ? 0.65 * rate12 + 0.35 * rate30 : 0.55 * rate80 + 0.45 * rate240;
    const score = sprint
      ? activity * 55 + transition * 25 + perColumnRegime * 12 + momentum * 1.5
      : activity * 60 + transition * 20 + stability * 3 + perColumnRegime * 5;
    rows.push({
      col, state, score: score + stableTie(draws, col, endIndex, sprint ? 17 : 53) * 0.0001,
      regime: pred.probs[state] || 0, perColumnRegime, activity, transition, momentum, stability
    });
  }
  rows.sort((a, b) => b.score - a.score || stableTie(draws, b.col, endIndex, 91) - stableTie(draws, a.col, endIndex, 91));
  return rows;
}

function drawStamp(draw) {
  const dm = String(draw?.date || '').match(/(\d{1,2})[.\/-](\d{1,2})[.\/-](\d{2,4})/);
  const tm = String(draw?.time || '').match(/(\d{1,2}):(\d{2})/);
  if (!dm || !tm) return null;
  const year = Number(dm[3]) < 100 ? 2000 + Number(dm[3]) : Number(dm[3]);
  return new Date(year, Number(dm[2]) - 1, Number(dm[1]), Number(tm[1]), Number(tm[2])).getTime();
}

function splitIntoCycles(draws, indices) {
  const cycles = [];
  let current = [];
  for (const index of indices) {
    if (!current.length) {
      current.push(index);
      continue;
    }
    const prevIndex = current.at(-1);
    const prevStamp = drawStamp(draws[prevIndex]);
    const curStamp = drawStamp(draws[index]);
    const gapMinutes = prevStamp !== null && curStamp !== null
      ? Math.round((curStamp - prevStamp) / 60000)
      : 30;
    const newCycle = gapMinutes > 35
      || draws[index]?.date !== draws[prevIndex]?.date
      || current.length >= 5;
    if (newCycle) {
      cycles.push(current);
      current = [index];
    } else {
      current.push(index);
    }
  }
  if (current.length) cycles.push(current);
  return cycles;
}

function makeModel(draws, type) {
  const end = draws.length - 1;
  const latestDate = draws[end]?.date;
  const dayIndices = [];
  for (let i = 0; i <= end; i += 1) if (draws[i]?.date === latestDate) dayIndices.push(i);

  const sprint = type === 'sprint';
  const chosen = sprint
    ? splitIntoCycles(draws, dayIndices).slice(-2).flat()
    : dayIndices.slice(-40);
  const usable = chosen.length ? chosen : [end];
  const seq = usable.map(i => stateBeforeWinner(draws, i)).filter(v => v !== null);
  const analysisSeq = sprint ? seq : seq.slice(-10);
  const pred = analogForecast(draws, analysisSeq, 1, end - 1, end);
  const ranked = rankColumns(draws, pred, type, end);
  const signal = signalFromRows(ranked);
  const columns = ranked.slice(0, 4).map(x => x.col);
  const numbers = rankNumbers(draws, columns, type, end);

  return {
    algorithmVersion: ALGORITHM_VERSION,
    columns,
    numbers,
    numberCount: numbers.length,
    ...signal,
    regimes: pred.probs.map((p, state) => ({
      state: state === 4 ? '4+' : String(state),
      percent: Math.round(p * 100),
      columns: pred.available[state]
    })),
    exact: pred.exact,
    near: pred.near,
    switchCases: pred.switchCases,
    profileMatches: pred.profileMatches
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
    if (balls.length !== 20) continue;
    const text = stripTags(tr);
    const dateMatch = text.match(/(\d{2}\.\d{2}\.\d{2,4})\s*,\s*(\d{2}:\d{2})/);
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

function validDraw(d) {
  return Number.isInteger(Number(d?.draw)) && Array.isArray(d?.balls) && d.balls.length === 20 && d.balls.every(n => Number(n) >= 1 && Number(n) <= 80);
}

async function main() {
  const response = await fetch(SOURCE_URL, { headers: { 'user-agent': 'Mozilla/5.0 GitHub-Actions Positron-Keno/1.0', accept: 'text/html' } });
  if (!response.ok) throw new Error(`Lucky Numbers HTTP ${response.status}`);
  const html = await response.text();
  const fresh = parsePage(html);
  if (!fresh.length) throw new Error('Не удалось распознать ни одного тиража на странице Lucky Numbers');

  const oldHistory = fs.existsSync(HISTORY_FILE) ? JSON.parse(fs.readFileSync(HISTORY_FILE, 'utf8')) : [];
  const map = new Map();
  for (const d of [...oldHistory, ...fresh]) if (validDraw(d)) map.set(Number(d.draw), { draw: Number(d.draw), date: String(d.date), time: String(d.time), balls: d.balls.map(Number) });
  const draws = [...map.values()].sort((a, b) => a.draw - b.draw);
  if (draws.length < 60) throw new Error(`Для расчёта нужно 60 тиражей, сейчас ${draws.length}`);

  const previous = fs.existsSync(OUTPUT_FILE) ? JSON.parse(fs.readFileSync(OUTPUT_FILE, 'utf8')) : {};
  const forecasts = Array.isArray(previous.forecasts) ? previous.forecasts : [];
  const byDraw = new Map(draws.map(d => [d.draw, d]));

  for (const row of forecasts) {
    if (row.checked) continue;
    const actual = byDraw.get(Number(row.targetDraw));
    if (!actual) continue;
    const actualWinner = winner(actual);
    const place = Array.isArray(row.columns) ? row.columns.indexOf(actualWinner) : -1;
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
  const sprint = makeModel(draws, 'sprint');
  const marathon = makeModel(draws, 'marathon');
  const current = { sprint, marathon };
  for (const type of ['sprint', 'marathon']) {
    if (!forecasts.some(x => x.type === type && Number(x.afterDraw) === last.draw)) {
      forecasts.push({
        type,
        afterDraw: last.draw,
        targetDraw: last.draw + 1,
        createdAt: new Date().toISOString(),
        columns: current[type].columns,
        numbers: current[type].numbers,
        algorithmVersion: ALGORITHM_VERSION,
        signal: current[type].signal,
        signalScore: current[type].signalScore,
        checked: false
      });
    }
  }

  const output = {
    version: 2,
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
  console.log(`Готово: тираж №${last.draw}; архив ${draws.length}; прогнозы ${output.forecasts.length}`);
  console.log(`Спринт: ${current.sprint.columns.join(', ')}; Марафон: ${current.marathon.columns.join(', ')}`);
}

main().catch(error => {
  console.error(error.stack || error.message || error);
  process.exit(1);
});
