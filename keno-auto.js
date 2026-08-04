'use strict';

const fs = require('fs');

const SOURCE_URL = 'https://lucky-numbers.ru/lottery/ru/keno2';
const HISTORY_FILE = 'keno-history.json';
const OUTPUT_FILE = 'keno-auto.json';
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

function currentAvailability(draws) {
  const current = counts(draws.at(-1));
  const byState = Array.from({ length: 5 }, () => []);
  for (let col = 1; col <= 10; col += 1) byState[Math.min(4, current[col])].push(col);
  return byState;
}

function analogForecast(draws, seq, minIndex, maxIndex) {
  const support = Array(5).fill(0);
  const stats = { exact: 0, near: 0, switchCases: 0, weight: 0 };
  addSuffixEvidence(draws, seq, minIndex, maxIndex, support, stats);
  addSwitchEvidence(draws, seq, minIndex, maxIndex, support, stats);
  addHistoricalBaseline(draws, support, minIndex, maxIndex, Math.max(0.35, stats.weight * 0.25));
  const available = currentAvailability(draws);
  const filtered = support.map((v, s) => available[s].length ? Math.max(0, v) : 0);
  const total = filtered.reduce((a, b) => a + b, 0);
  const probs = total ? filtered.map(v => v / total) : available.map(x => x.length ? 1 : 0);
  const norm = probs.reduce((a, b) => a + b, 0) || 1;
  return { probs: probs.map(v => v / norm), available, ...stats };
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

function rankColumns(draws, pred, window) {
  const current = counts(draws.at(-1));
  const rows = [];
  for (let col = 1; col <= 10; col += 1) {
    const state = Math.min(4, current[col]);
    const regime = pred.probs[state] || 0;
    let shape = 0;
    const nums = (draws.at(-1).balls || []).filter(n => colOf(n) === col);
    if (state === 0) shape += 0.20;
    if (state === 1) shape += 0.35;
    if (state === 2) shape += 0.50;
    if (state === 3) shape += 0.45;
    if (state === 4) shape += 0.38;
    if (nums.some(n => nums.includes(n + 10))) shape += 0.30;
    const history = draws.slice(-window).map(d => counts(d)[col]);
    if (history.at(-1) - (history[0] || 0) > 0) shape += 0.20;
    const streak = winnerStreak(draws, col);
    if (streak >= 1) shape += Math.min(0.45, 0.18 + streak * 0.10);
    const preserved = preservedWinnerFrame(draws, col);
    if (preserved > 0 && winner(draws.at(-2)) === col) shape += Math.min(0.35, preserved * 0.12);
    rows.push({ col, state, score: regime * 3 + shape });
  }
  return rows.sort((a, b) => b.score - a.score || b.regime - a.regime || a.col - b.col);
}

const DIRECT_MODEL_VERSION = 'direct-v2-20260804';

function averageRankPoints(values) {
  const rows = values.map((value, index) => ({ value: Number(value) || 0, index }))
    .sort((a, b) => b.value - a.value || a.index - b.index);
  const points = Array(values.length).fill(0);
  let start = 0;
  while (start < rows.length) {
    let end = start + 1;
    while (end < rows.length && Math.abs(rows[end].value - rows[start].value) < 1e-12) end += 1;
    const averageRank = ((start + 1) + end) / 2;
    const point = values.length + 1 - averageRank;
    for (let i = start; i < end; i += 1) points[rows[i].index] = point;
    start = end;
  }
  return points;
}

function recentWinnerExpert(series, end, window) {
  const count = Array(10).fill(0);
  const start = Math.max(0, end - window + 1);
  for (let i = start; i <= end; i += 1) count[series[i] - 1] += 1;
  const used = end - start + 1;
  return {
    key: `recent-${window}`,
    label: `${window} последних тиражей`,
    values: count.map(v => (v + 1) / (used + 10)),
    count,
    support: used
  };
}

function ewmaWinnerExpert(series, end, halfLife) {
  const alpha = 1 - Math.exp(Math.log(0.5) / halfLife);
  const values = Array(10).fill(0.1);
  for (let i = 0; i <= end; i += 1) {
    for (let c = 0; c < 10; c += 1) values[c] *= 1 - alpha;
    values[series[i] - 1] += alpha;
  }
  return { key: `ewma-${halfLife}`, label: `быстрый вес ${halfLife}`, values, support: end + 1 };
}

function pairWinnerExpert(series, end) {
  const values = Array(10).fill(5);
  const first = series[end - 1];
  const second = series[end];
  let support = 0;
  if (end >= 2) {
    for (let i = 2; i <= end; i += 1) {
      if (series[i - 2] !== first || series[i - 1] !== second) continue;
      values[series[i] - 1] += 1;
      support += 1;
    }
  }
  const total = values.reduce((a, b) => a + b, 0) || 1;
  return {
    key: 'exact-pair',
    label: `точная пара ст${first}→ст${second}`,
    values: values.map(v => v / total),
    count: values.map(v => v - 5),
    support,
    context: [first, second]
  };
}

function transitionWinnerExpert(series, end, window) {
  const values = Array(10).fill(2);
  const source = series[end];
  let support = 0;
  const start = Math.max(1, end - window + 2);
  for (let i = start; i <= end; i += 1) {
    if (series[i - 1] !== source) continue;
    values[series[i] - 1] += 1;
    support += 1;
  }
  const total = values.reduce((a, b) => a + b, 0) || 1;
  return {
    key: `transition-${window}`,
    label: `после ст${source} · ${window} переходов`,
    values: values.map(v => v / total),
    count: values.map(v => v - 2),
    support,
    source
  };
}

function gapWinnerExpert(series, end) {
  const last = Array(10).fill(-1);
  for (let i = 0; i <= end; i += 1) last[series[i] - 1] = i;
  const gap = last.map(index => index >= 0 ? end + 1 - index : end + 2);
  return { key: 'winner-gap', label: 'давность выхода столба', values: gap.map(v => Math.log1p(v)), gap, support: end + 1 };
}

function directColumnModel(draws, type, winnerSeries = null, endIndex = draws.length - 1) {
  const series = winnerSeries || draws.slice(0, endIndex + 1).map(winner);
  if (endIndex < 2 || series.length <= endIndex) throw new Error('Для прямого прогноза нужно не меньше трёх тиражей');
  const sprint = type === 'sprint';
  const experts = sprint
    ? [recentWinnerExpert(series, endIndex, 20), ewmaWinnerExpert(series, endIndex, 5), pairWinnerExpert(series, endIndex)]
    : [recentWinnerExpert(series, endIndex, 200), transitionWinnerExpert(series, endIndex, 100), pairWinnerExpert(series, endIndex), gapWinnerExpert(series, endIndex)];

  const rows = Array.from({ length: 10 }, (_, index) => ({ col: index + 1, score: 0, reasons: [] }));
  for (const expert of experts) {
    const points = averageRankPoints(expert.values);
    for (let c = 0; c < 10; c += 1) {
      rows[c].score += points[c];
      if (expert.key.startsWith('recent-')) rows[c].reasons.push(`${expert.label}: ${expert.count[c]}/${expert.support}`);
      else if (expert.key.startsWith('ewma-')) rows[c].reasons.push(`${expert.label}: ${Math.round(expert.values[c] * 100)}%`);
      else if (expert.key === 'exact-pair') rows[c].reasons.push(`${expert.label}: ${expert.count[c]} из ${expert.support}`);
      else if (expert.key.startsWith('transition-')) rows[c].reasons.push(`${expert.label}: ${expert.count[c]} из ${expert.support}`);
      else if (expert.key === 'winner-gap') rows[c].reasons.push(`не выходил ${expert.gap[c]} тир.`);
    }
  }

  const rotation = Number(draws[endIndex]?.draw || endIndex) % 10;
  rows.sort((a, b) => b.score - a.score || ((a.col - 1 - rotation + 10) % 10) - ((b.col - 1 - rotation + 10) % 10));
  const scoreMax = experts.length * 10;
  return {
    modelVersion: DIRECT_MODEL_VERSION,
    type,
    window: sprint ? 20 : 200,
    columns: rows.slice(0, 4).map(row => row.col),
    rows: rows.slice(0, 4).map(row => ({ ...row, scoreMax })),
    experts: experts.map(expert => ({ key: expert.key, label: expert.label, support: expert.support })),
    tieRotation: rotation + 1
  };
}

function makeModel(draws, type, winnerSeries = null) {
  return directColumnModel(draws, type, winnerSeries, draws.length - 1);
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
    row.checkedAt = new Date().toISOString();
  }

  const last = draws.at(-1);
  const winnerSeries = draws.map(winner);
  const current = { sprint: makeModel(draws, 'sprint', winnerSeries), marathon: makeModel(draws, 'marathon', winnerSeries) };
  for (const type of ['sprint', 'marathon']) {
    const nextRecord = {
      type,
      modelVersion: DIRECT_MODEL_VERSION,
      afterDraw: last.draw,
      targetDraw: last.draw + 1,
      createdAt: new Date().toISOString(),
      columns: current[type].columns,
      checked: false
    };
    const existing = forecasts.find(x => x.type === type && Number(x.afterDraw) === last.draw);
    if (!existing) forecasts.push(nextRecord);
    else if (!existing.checked && existing.modelVersion !== DIRECT_MODEL_VERSION) Object.assign(existing, nextRecord);
  }

  const output = {
    version: 2,
    modelVersion: DIRECT_MODEL_VERSION,
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
