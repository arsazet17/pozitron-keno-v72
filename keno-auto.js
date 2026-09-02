'use strict';

const fs = require('fs');

const SOURCE_NAME = 'Официальный Столото · OAuth · тройная проверка';
const HISTORY_FILE = 'keno-history.json';
const OUTPUT_FILE = 'keno-auto.json';

const ALGORITHM_VERSION = '2.3.0';
const MODEL_VERSION = 'screen-sm-2.3.0';

const colOf = n => n % 10 || 10;

function counts(draw) {
  const out = Array(11).fill(0);
  for (const n of draw?.balls || []) out[colOf(Number(n))] += 1;
  return out;
}

// Для новых тиражей Столото используем официальный «Столбец N».
// Старый расчёт оставлен только для исторических строк без поля column.
function winner(draw) {
  const official = Number(draw?.column);
  if (Number.isInteger(official) && official >= 1 && official <= 10) {
    return official;
  }

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

function buildWinnerCache(draws) {
  return draws.map(winner);
}

function buildStateCache(draws, winnerCache) {
  const stateCache = new Array(draws.length).fill(null);
  const drawCounts = draws.map(counts);

  for (let i = 1; i < draws.length; i += 1) {
    stateCache[i] = Math.min(4, drawCounts[i - 1][winnerCache[i]] || 0);
  }
  return { stateCache, drawCounts };
}

function stateBeforeWinner(stateCache, i) {
  if (i <= 0) return null;
  return stateCache[i] ?? null;
}

function sequence(stateCache, end, len) {
  const out = [];
  for (let i = Math.max(1, end - len + 1); i <= end; i += 1) {
    const state = stateBeforeWinner(stateCache, i);
    if (state !== null) out.push(state);
  }
  return out;
}

function weightedSimilarity(a, b) {
  const n = Math.min(a.length, b.length);
  if (!n) return 0;

  let score = 0;
  let total = 0;

  for (let i = 0; i < n; i += 1) {
    const weight = i + 1;
    const av = a[a.length - n + i];
    const bv = b[b.length - n + i];

    total += weight;
    score += weight * (1 - Math.min(1, Math.abs(av - bv) / 4));
  }

  return total ? score / total : 0;
}

function addHistoricalBaseline(stateCache, support, minIndex, maxIndex, weight) {
  const countsByState = Array(5).fill(0);
  let total = 0;

  for (let i = Math.max(1, minIndex); i <= maxIndex; i += 1) {
    const state = stateBeforeWinner(stateCache, i);
    if (state === null) continue;
    countsByState[state] += 1;
    total += 1;
  }

  if (!total) return;
  countsByState.forEach((v, s) => {
    support[s] += weight * (v / total);
  });
}

function addSuffixEvidence(stateCache, seq, minIndex, maxIndex, support, stats) {
  const suffixLengths = [5, 4, 3, 2].filter(n => n <= seq.length);

  for (const len of suffixLengths) {
    const target = seq.slice(-len);
    const lengthWeight = ({ 5: 1.00, 4: 0.78, 3: 0.56, 2: 0.36 })[len] || 0.25;

    for (let end = minIndex + len - 1; end < maxIndex; end += 1) {
      const cand = sequence(stateCache, end, len);
      if (cand.length !== len) continue;

      const sim = weightedSimilarity(target, cand);
      const threshold = len >= 5 ? 0.72 : len === 4 ? 0.76 : len === 3 ? 0.82 : 0.94;
      if (sim < threshold) continue;

      const next = stateBeforeWinner(stateCache, end + 1);
      if (next === null) continue;

      const weight = lengthWeight * Math.pow(sim, 5);
      support[next] += weight;
      stats.weight += weight;

      if (len === 5 && sim > 0.999) stats.exact += 1;
      else stats.near += 1;
    }
  }
}

function addSwitchEvidence(stateCache, seq, minIndex, maxIndex, support, stats) {
  if (seq.length < 3) return;

  const last = seq.at(-1);
  const prev = seq.at(-2);
  const before = seq.at(-3);

  const targetChanged = last !== prev;
  const targetChangedTwice = prev !== before;

  for (let i = Math.max(3, minIndex); i < maxIndex; i += 1) {
    const a = stateBeforeWinner(stateCache, i - 2);
    const b = stateBeforeWinner(stateCache, i - 1);
    const c = stateBeforeWinner(stateCache, i);
    const next = stateBeforeWinner(stateCache, i + 1);

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

function currentAvailability(drawCounts, endIndex) {
  const currentCounts = drawCounts[endIndex];
  const byState = Array.from({ length: 5 }, () => []);

  for (let col = 1; col <= 10; col += 1) {
    byState[Math.min(4, currentCounts[col])].push(col);
  }

  return byState;
}

function profileKey(available) {
  return available.map(cols => cols.length).join('-');
}

function densityProfileForecast(stateCache, drawCounts, endIndex, maxIndex) {
  const available = currentAvailability(drawCounts, endIndex);
  const baseProbs = available.map(cols => cols.length / 10);
  const targetKey = profileKey(available);

  const countsNext = Array(5).fill(0);
  let matches = 0;

  for (let currentIndex = 0; currentIndex <= maxIndex; currentIndex += 1) {
    const historicalAvailable = currentAvailability(drawCounts, currentIndex);
    if (profileKey(historicalAvailable) !== targetKey) continue;

    const nextState = stateBeforeWinner(stateCache, currentIndex + 1);
    if (nextState === null) continue;

    countsNext[nextState] += 1;
    matches += 1;
  }

  const alpha = 20;
  const profileProbs = countsNext.map((count, state) =>
    (count + alpha * baseProbs[state]) / (matches + alpha)
  );

  return { available, baseProbs, profileProbs, profileMatches: matches };
}

function analogForecast(stateCache, drawCounts, seq, minIndex, maxIndex, endIndex) {
  const support = Array(5).fill(0);
  const stats = { exact: 0, near: 0, switchCases: 0, weight: 0 };

  addSuffixEvidence(stateCache, seq, minIndex, maxIndex, support, stats);
  addSwitchEvidence(stateCache, seq, minIndex, maxIndex, support, stats);
  addHistoricalBaseline(
    stateCache,
    support,
    minIndex,
    maxIndex,
    Math.max(0.35, stats.weight * 0.25)
  );

  const density = densityProfileForecast(stateCache, drawCounts, endIndex, maxIndex);
  const supportTotal = support.reduce((a, b) => a + b, 0);

  const chainProbs = supportTotal
    ? support.map(v => v / supportTotal)
    : density.baseProbs.slice();

  // Точно как на экране: 70% цепочная часть, 30% профиль плотности.
  const mixed = density.profileProbs.map((v, state) =>
    density.available[state].length ? 0.30 * v + 0.70 * chainProbs[state] : 0
  );

  const total = mixed.reduce((a, b) => a + b, 0) || 1;
  const probs = mixed.map(v => v / total);

  const order = [0, 1, 2, 3, 4].sort((a, b) => probs[b] - probs[a] || a - b);

  return {
    support,
    probs,
    available: density.available,
    baseProbs: density.baseProbs,
    profileProbs: density.profileProbs,
    profileMatches: density.profileMatches,
    order,
    exact: stats.exact,
    near: stats.near,
    switchCases: stats.switchCases
  };
}

function recentWinnerRate(winnerCache, col, endIndex, window) {
  const start = Math.max(0, endIndex - window + 1);
  let hits = 0;

  for (let i = start; i <= endIndex; i += 1) {
    if (winnerCache[i] === col) hits += 1;
  }

  return hits / Math.max(1, endIndex - start + 1);
}

function densityMomentum(drawCounts, col, endIndex) {
  if (endIndex < 2) return 0;

  const recentStart = Math.max(0, endIndex - 3);
  const previousEnd = recentStart - 1;
  const previousStart = Math.max(0, previousEnd - 3);

  let recentSum = 0;
  let recentN = 0;
  let previousSum = 0;
  let previousN = 0;

  for (let i = recentStart; i <= endIndex; i += 1) {
    recentSum += drawCounts[i][col];
    recentN += 1;
  }

  for (let i = previousStart; i <= previousEnd; i += 1) {
    previousSum += drawCounts[i][col];
    previousN += 1;
  }

  return recentSum / Math.max(1, recentN)
    - previousSum / Math.max(1, previousN);
}

function transitionWinnerRate(winnerCache, col, endIndex, window) {
  if (endIndex < 2) return 0.10;

  const previousWinner = winnerCache[endIndex];
  const start = Math.max(1, endIndex - window + 1);

  let cases = 0;
  let hits = 0;

  for (let i = start; i <= endIndex; i += 1) {
    if (winnerCache[i - 1] !== previousWinner) continue;
    cases += 1;
    if (winnerCache[i] === col) hits += 1;
  }

  return (hits + 2) / (cases + 20);
}

function stableTie(draws, col, endIndex, salt) {
  let x = (Number(draws[endIndex]?.draw) || endIndex + 1)
    ^ Math.imul(col + salt, 0x9e3779b1);

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
  const score = Math.max(
    0,
    Math.min(1, margin / 1.5 * 0.65 + spread / 5 * 0.35)
  );

  return {
    signal: score >= 0.62 ? 'сильный' : score >= 0.34 ? 'средний' : 'слабый',
    signalScore: Number(score.toFixed(3)),
    margin: Number(margin.toFixed(4))
  };
}


// GROUP_MOVEMENT_V230
const GROUP_MOVEMENT_CONFIG = {
  p2:    { minN: 1200, minHalf: 500, edge: 0.0040, alpha: 400, sprint: 0.28, marathon: 0.12 },
  p3:    { minN:  700, minHalf: 250, edge: 0.0050, alpha: 300, sprint: 0.25, marathon: 0.18 },
  p4:    { minN:  450, minHalf: 180, edge: 0.0060, alpha: 220, sprint: 0.20, marathon: 0.25 },
  p5:    { minN:  350, minHalf: 140, edge: 0.0065, alpha: 180, sprint: 0.12, marathon: 0.25 },
  nbr:   { minN:  900, minHalf: 350, edge: 0.0045, alpha: 350, sprint: 0.12, marathon: 0.12 },
  empty: { minN:  200, minHalf:  75, edge: 0.0060, alpha: 250, sprint: 0.08, marathon: 0.08 }
};

const GROUP_MOVEMENT_CACHE = new Map();

function gmNewBook() {
  return { all: new Map(), first: new Map(), second: new Map() };
}

function gmBump(map, key, hit) {
  const row = map.get(key) || { n: 0, wins: 0 };
  row.n += 1;
  if (hit) row.wins += 1;
  map.set(key, row);
}

function gmAdd(book, key, hit, firstHalf) {
  gmBump(book.all, key, hit);
  gmBump(firstHalf ? book.first : book.second, key, hit);
}

function gmStateAt(drawCounts, index, col) {
  return Math.min(4, drawCounts[index]?.[col] || 0);
}

function gmStateText(value) {
  return Number(value) === 4 ? '4+' : String(value);
}

function gmPathKey(drawCounts, endIndex, col, len) {
  const out = [];
  for (let i = endIndex - len + 1; i <= endIndex; i += 1) {
    out.push(gmStateAt(drawCounts, i, col));
  }
  return out.join('>');
}

function gmNeighborKey(drawCounts, index, col) {
  const left = col === 1 ? 10 : col - 1;
  const right = col === 10 ? 1 : col + 1;
  const sides = [
    gmStateAt(drawCounts, index, left),
    gmStateAt(drawCounts, index, right)
  ].sort((a, b) => a - b);
  return `${gmStateAt(drawCounts, index, col)}|${sides[0]}|${sides[1]}`;
}

function gmEmptyBucket(drawCounts, index, col) {
  if (gmStateAt(drawCounts, index, col) !== 0) return null;
  let streak = 0;
  for (let i = index; i >= 0 && streak < 4; i -= 1) {
    if (gmStateAt(drawCounts, i, col) !== 0) break;
    streak += 1;
  }
  return String(Math.min(4, streak));
}

function buildGroupMovementStats(draws, winnerCache, drawCounts, endIndex) {
  const cacheKey = `${draws.length}:${endIndex}:${Number(draws[endIndex]?.draw || 0)}`;
  if (GROUP_MOVEMENT_CACHE.has(cacheKey)) return GROUP_MOVEMENT_CACHE.get(cacheKey);

  const books = {
    p2: gmNewBook(), p3: gmNewBook(), p4: gmNewBook(),
    p5: gmNewBook(), nbr: gmNewBook(), empty: gmNewBook()
  };
  const zeroStreak = Array(11).fill(0);
  const split = Math.floor(endIndex / 2);

  for (let t = 0; t < endIndex; t += 1) {
    const nextWinner = winnerCache[t + 1];
    const firstHalf = t < split;

    for (let col = 1; col <= 10; col += 1) {
      const hit = col === nextWinner;
      const state = gmStateAt(drawCounts, t, col);
      zeroStreak[col] = state === 0 ? Math.min(4, zeroStreak[col] + 1) : 0;

      for (const len of [2, 3, 4, 5]) {
        if (t < len - 1) continue;
        gmAdd(books[`p${len}`], gmPathKey(drawCounts, t, col, len), hit, firstHalf);
      }

      gmAdd(books.nbr, gmNeighborKey(drawCounts, t, col), hit, firstHalf);
      if (state === 0) gmAdd(books.empty, String(zeroStreak[col]), hit, firstHalf);
    }
  }

  const stats = { books };
  GROUP_MOVEMENT_CACHE.set(cacheKey, stats);
  return stats;
}

function gmFeatureLabel(feature, key) {
  if (feature[0] === 'p') return key.split('>').map(gmStateText).join('→');
  if (feature === 'nbr') {
    const [self, a, b] = key.split('|');
    return `${gmStateText(self)} · соседи ${gmStateText(a)}/${gmStateText(b)}`;
  }
  return `пусто ×${key === '4' ? '4+' : key}`;
}

function gmStableSignal(stats, feature, key, typeKey) {
  const cfg = GROUP_MOVEMENT_CONFIG[feature];
  const book = stats.books[feature];
  const all = book.all.get(key);
  const first = book.first.get(key);
  const second = book.second.get(key);

  if (!all || !first || !second) return null;
  if (all.n < cfg.minN || first.n < cfg.minHalf || second.n < cfg.minHalf) return null;

  const posterior = (all.wins + 0.10 * cfg.alpha) / (all.n + cfg.alpha);
  const halfAlpha = cfg.alpha / 2;
  const r1 = (first.wins + 0.10 * halfAlpha) / (first.n + halfAlpha);
  const r2 = (second.wins + 0.10 * halfAlpha) / (second.n + halfAlpha);

  if (Math.abs(posterior - 0.10) < cfg.edge) return null;
  if ((r1 - 0.10) * (r2 - 0.10) <= 0) return null;
  if (Math.abs(r1 - r2) > 0.025) return null;

  const normalized = Math.max(-1, Math.min(1, (posterior - 0.10) / 0.02));
  const weight = typeKey === 'sprint' ? cfg.sprint : cfg.marathon;

  return {
    feature,
    key,
    n: all.n,
    rate: all.wins / all.n,
    posterior,
    weight,
    effect: normalized * weight,
    label: gmFeatureLabel(feature, key)
  };
}

function groupMovementScore(draws, winnerCache, drawCounts, endIndex, col, typeKey) {
  const stats = buildGroupMovementStats(draws, winnerCache, drawCounts, endIndex);
  const signals = [];

  for (const len of [2, 3, 4, 5]) {
    const feature = `p${len}`;
    const signal = gmStableSignal(
      stats,
      feature,
      gmPathKey(drawCounts, endIndex, col, len),
      typeKey
    );
    if (signal) signals.push(signal);
  }

  const neighbor = gmStableSignal(
    stats,
    'nbr',
    gmNeighborKey(drawCounts, endIndex, col),
    typeKey
  );
  if (neighbor) signals.push(neighbor);

  const emptyKey = gmEmptyBucket(drawCounts, endIndex, col);
  if (emptyKey !== null) {
    const empty = gmStableSignal(stats, 'empty', emptyKey, typeKey);
    if (empty) signals.push(empty);
  }

  const weightedSum = signals.reduce((sum, s) => sum + s.effect, 0);
  const weightSum = signals.reduce((sum, s) => sum + s.weight, 0);
  const quality = weightedSum / Math.max(0.25, weightSum);
  const coverage = Math.min(1, weightSum / 0.35);
  const scale = typeKey === 'sprint' ? 1.10 : 1.00;
  const points = Math.max(-0.85, Math.min(0.85, quality * coverage * scale));

  signals.sort((a, b) => Math.abs(b.effect) - Math.abs(a.effect) || b.n - a.n);

  return {
    points,
    activeWeight: weightSum,
    signals,
    summary: signals.slice(0, 2).map(s =>
      `${s.label} ${Math.round(s.rate * 1000) / 10}% N${s.n}`
    ).join('; ')
  };
}

function rankColumns(draws, winnerCache, drawCounts, pred, endIndex, typeKey) {
  const current = drawCounts[endIndex];
  const rows = [];
  const sprint = typeKey === 'sprint';

  for (let col = 1; col <= 10; col += 1) {
    const state = Math.min(4, current[col]);
    const groupSize = Math.max(1, pred.available[state]?.length || 0);
    const perColumnRegime = (pred.probs[state] || 0) / groupSize;

    const rate12 = recentWinnerRate(winnerCache, col, endIndex, 12);
    const rate30 = recentWinnerRate(winnerCache, col, endIndex, 30);
    const rate80 = recentWinnerRate(winnerCache, col, endIndex, 80);
    const rate240 = recentWinnerRate(winnerCache, col, endIndex, 240);

    const transition = transitionWinnerRate(
      winnerCache,
      col,
      endIndex,
      sprint ? 160 : 600
    );

    const momentum = Math.max(
      -2,
      Math.min(2, densityMomentum(drawCounts, col, endIndex))
    );

    const stability = 1 - Math.min(1, Math.abs(rate80 - rate240) * 8);

    const activity = sprint
      ? 0.65 * rate12 + 0.35 * rate30
      : 0.55 * rate80 + 0.45 * rate240;

    const movement = groupMovementScore(
      draws,
      winnerCache,
      drawCounts,
      endIndex,
      col,
      typeKey
    );

    const baseScore = sprint
      ? activity * 55
        + transition * 25
        + perColumnRegime * 12
        + momentum * 1.5
      : activity * 60
        + transition * 20
        + stability * 3
        + perColumnRegime * 5;

    const score = baseScore + movement.points;

    const reasons = [];
    reasons.push(
      sprint
        ? 'короткий горизонт 12–30 тир.'
        : 'длинный горизонт 80–240 тир.'
    );
    reasons.push(`переход ${Math.round(transition * 100)}%`);
    reasons.push(`режим ${state === 4 ? '4+' : state} — малый вес`);
    reasons.push(movement.signals.length ? `движение групп ${movement.points >= 0 ? '+' : ''}${movement.points.toFixed(2)} · ${movement.summary}` : 'движение групп: устойчивого сигнала нет');

    rows.push({
      col,
      state,
      score: score + stableTie(draws, col, endIndex, sprint ? 17 : 53) * 0.0001,
      reasons,
      regime: pred.probs[state] || 0,
      perColumnRegime,
      activity,
      transition,
      momentum,
      stability,
      baseScore,
      movementPoints: movement.points,
      movementSignals: movement.signals
    });
  }

  rows.sort(
    (a, b) =>
      b.score - a.score
      || stableTie(draws, b.col, endIndex, 91)
        - stableTie(draws, a.col, endIndex, 91)
  );

  return rows;
}

function drawStamp(d) {
  const dm = String(d?.date || '').match(/(\d{1,2})[.\/-](\d{1,2})[.\/-](\d{4}|\d{2})(?!\d)/);
  const tm = String(d?.time || '').match(/(\d{1,2}):(\d{2})/);

  if (!dm || !tm) return null;

  const year = dm[3].length === 2 ? 2000 + Number(dm[3]) : Number(dm[3]);
  return new Date(
    year,
    Number(dm[2]) - 1,
    Number(dm[1]),
    Number(tm[1]),
    Number(tm[2])
  ).getTime();
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

    const newCycle =
      gapMinutes > 35
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

function dateIndices(draws, date) {
  const out = [];
  for (let i = 0; i < draws.length; i += 1) {
    if (draws[i]?.date === date) out.push(i);
  }
  return out;
}

function groupForecastSnapshot(pred, ranked) {
  const label = state => state === 4 ? '4+' : String(state);
  const availableOrder = pred.order.filter(state => (pred.available[state] || []).length);
  const topState = availableOrder.length ? availableOrder[0] : null;
  const selectedStates = ranked.slice(0, 4).map(row => Number(row.state));
  const slotCounts = Array(5).fill(0);
  selectedStates.forEach(state => {
    if (state >= 0 && state <= 4) slotCounts[state] += 1;
  });

  const probabilities = {};
  const available = {};
  const slots = {};
  for (let state = 0; state <= 4; state += 1) {
    const key = label(state);
    probabilities[key] = Number((pred.probs[state] || 0).toFixed(6));
    available[key] = (pred.available[state] || []).map(Number);
    slots[key] = slotCounts[state];
  }

  return {
    topState,
    topGroup: topState === null ? null : label(topState),
    orderStates: availableOrder,
    orderGroups: availableOrder.map(label),
    probabilities,
    available,
    selectedStates,
    selectedGroups: [...new Set(selectedStates.map(label))],
    slots
  };
}

function makeSprintModel(draws, winnerCache, stateCache, drawCounts, dayIndices) {
  const cycles = splitIntoCycles(draws, dayIndices);
  const chosenCycles = cycles.slice(-2);
  const chosen = chosenCycles.flat();

  const endIndex = chosen.at(-1);
  const seq = chosen
    .map(i => stateBeforeWinner(stateCache, i))
    .filter(v => v !== null);

  const pred = analogForecast(
    stateCache,
    drawCounts,
    seq,
    1,
    endIndex - 1,
    endIndex
  );

  const ranked = rankColumns(
    draws,
    winnerCache,
    drawCounts,
    pred,
    endIndex,
    'sprint'
  );

  const signal = signalFromRows(ranked);

  return {
    modelVersion: MODEL_VERSION,
    algorithmVersion: ALGORITHM_VERSION,
    type: 'sprint',
    window: chosen.length,
    columns: ranked.slice(0, 4).map(row => row.col),
    rows: ranked.slice(0, 4),
    groupForecast: groupForecastSnapshot(pred, ranked),
    signal: signal.signal,
    signalScore: signal.signalScore,
    exact: pred.exact,
    near: pred.near,
    switchCases: pred.switchCases
  };
}

function makeMarathonModel(draws, winnerCache, stateCache, drawCounts, dayIndices) {
  const chosen = dayIndices.slice(-40);
  const endIndex = chosen.at(-1);

  const seq = chosen
    .map(i => stateBeforeWinner(stateCache, i))
    .filter(v => v !== null);

  // На экране Марафон показывает до 40 состояний,
  // но аналоговый прогноз считает по хвосту последних 10.
  const tail = seq.slice(-10);

  const pred = analogForecast(
    stateCache,
    drawCounts,
    tail,
    1,
    endIndex - 1,
    endIndex
  );

  const ranked = rankColumns(
    draws,
    winnerCache,
    drawCounts,
    pred,
    endIndex,
    'marathon'
  );

  const signal = signalFromRows(ranked);

  return {
    modelVersion: MODEL_VERSION,
    algorithmVersion: ALGORITHM_VERSION,
    type: 'marathon',
    window: chosen.length,
    columns: ranked.slice(0, 4).map(row => row.col),
    rows: ranked.slice(0, 4),
    groupForecast: groupForecastSnapshot(pred, ranked),
    signal: signal.signal,
    signalScore: signal.signalScore,
    exact: pred.exact,
    near: pred.near,
    switchCases: pred.switchCases
  };
}

function stripTags(s) {
  return s
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;|&#160;/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
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
    const nums = [
      ...beforeDate.matchAll(/(?:^|\s)(\d[\d\s\u00a0]{4,8})(?=\s|$)/g)
    ]
      .map(x => Number(x[1].replace(/\s|\u00a0/g, '')))
      .filter(n => n >= 100000 && n <= 999999);

    const draw = nums.at(-1);
    if (!draw) continue;

    rows.push({
      draw,
      date: dateMatch[1],
      time: dateMatch[2],
      balls
    });
  }

  const unique = new Map(rows.map(x => [x.draw, x]));
  return [...unique.values()].sort((a, b) => a.draw - b.draw);
}

function validDraw(d) {
  return Number.isInteger(Number(d?.draw))
    && Array.isArray(d?.balls)
    && d.balls.length === 20
    && d.balls.every(n => Number(n) >= 1 && Number(n) <= 80);
}

async function main() {
  if (!fs.existsSync(HISTORY_FILE)) {
    throw new Error('Нет keno-history.json');
  }

  const oldHistory = JSON.parse(fs.readFileSync(HISTORY_FILE, 'utf8'));
  if (!Array.isArray(oldHistory)) {
    throw new Error('keno-history.json должен быть массивом');
  }

  const map = new Map();
  for (const d of oldHistory) {
    if (!validDraw(d)) continue;
    const officialColumn = Number(d?.column);
    map.set(Number(d.draw), {
      draw: Number(d.draw),
      date: String(d.date),
      time: String(d.time),
      balls: d.balls.map(Number),
      column: Number.isInteger(officialColumn) && officialColumn >= 1 && officialColumn <= 10
        ? officialColumn
        : null
    });
  }

  const draws = [...map.values()].sort((a, b) => a.draw - b.draw);

  if (draws.length < 60) {
    throw new Error(`Для расчёта нужно 60 тиражей, сейчас ${draws.length}`);
  }

  const previous = fs.existsSync(OUTPUT_FILE)
    ? JSON.parse(fs.readFileSync(OUTPUT_FILE, 'utf8'))
    : {};

  const forecasts = Array.isArray(previous.forecasts)
    ? previous.forecasts
    : [];

  const byDraw = new Map(draws.map(d => [d.draw, d]));
  const drawIndexByNumber = new Map(draws.map((d, i) => [Number(d.draw), i]));

  // Старые прогнозы не переписываем.
  // Только закрываем ожидающие записи по фактически вышедшему тиражу.
  for (const row of forecasts) {
    if (row.checked) continue;

    const actual = byDraw.get(Number(row.targetDraw));
    if (!actual) continue;

    const actualWinner = winner(actual);
    const place = Array.isArray(row.columns)
      ? row.columns.map(Number).indexOf(actualWinner)
      : -1;

    row.checked = true;
    row.actualWinner = actualWinner;
    row.place = place >= 0 ? place + 1 : 0;
    row.hit = place >= 0 && place < 4;
    row.first = place === 0;

    // Закрываем группу только если её прогноз был frozen заранее.
    // Уже закрытые старые строки задним числом не обогащаем.
    if (row.groupForecast && typeof row.groupForecast === 'object') {
      const actualIndex = drawIndexByNumber.get(Number(row.targetDraw));
      const prev = Number.isInteger(actualIndex) && actualIndex > 0
        ? draws[actualIndex - 1]
        : null;
      const actualCounts = prev ? counts(prev) : null;
      const actualGroupState = actualCounts
        ? Math.min(4, actualCounts[actualWinner] || 0)
        : null;
      const actualGroup = actualGroupState === 4
        ? '4+'
        : (actualGroupState === null ? null : String(actualGroupState));

      const selectedStates = Array.isArray(row.groupForecast.selectedStates)
        ? row.groupForecast.selectedStates.map(Number)
        : [];

      row.actualGroupState = actualGroupState;
      row.actualGroup = actualGroup;
      row.groupTopHit = actualGroupState !== null
        && Number(row.groupForecast.topState) === actualGroupState;
      row.groupCovered = actualGroupState !== null
        && selectedStates.includes(actualGroupState);
    }

    row.checkedAt = new Date().toISOString();
  }

  const last = draws.at(-1);
  const latestDate = last.date;
  const day = dateIndices(draws, latestDate);

  if (!day.length) {
    throw new Error(`Нет тиражей за последний день ${latestDate}`);
  }

  const winnerCache = buildWinnerCache(draws);
  const { stateCache, drawCounts } = buildStateCache(draws, winnerCache);

  const current = {
    sprint: makeSprintModel(
      draws,
      winnerCache,
      stateCache,
      drawCounts,
      day
    ),
    marathon: makeMarathonModel(
      draws,
      winnerCache,
      stateCache,
      drawCounts,
      day
    )
  };

  for (const type of ['sprint', 'marathon']) {
    const nextRecord = {
      type,
      modelVersion: MODEL_VERSION,
      algorithmVersion: ALGORITHM_VERSION,
      afterDraw: last.draw,
      targetDraw: last.draw + 1,
      createdAt: new Date().toISOString(),
      columns: current[type].columns.slice(),
      groupForecast: JSON.parse(JSON.stringify(current[type].groupForecast || null)),
      checked: false
    };

    const existing = forecasts.find(
      x => x.type === type && Number(x.afterDraw) === last.draw
    );

    if (!existing) {
      forecasts.push(nextRecord);
    } else if (!existing.checked && existing.modelVersion !== MODEL_VERSION) {
      // Если для ещё не вышедшего тиража успел сохраниться прогноз старого
      // direct-v2, заменяем только эту незакрытую запись экранным 2.1.0.
      Object.assign(existing, nextRecord);
    } else if (!existing.checked && !existing.groupForecast) {
      // Для текущего ещё не вышедшего frozen-прогноза столбцы не меняем.
      // Дописываем только снимок групп из того же состояния архива.
      existing.groupForecast = nextRecord.groupForecast;
    }
  }

  const output = {
    version: 4,
    modelVersion: MODEL_VERSION,
    algorithmVersion: ALGORITHM_VERSION,
    source: SOURCE_NAME,
    updatedAt: new Date().toISOString(),
    latestDraw: last.draw,
    latestDate: last.date,
    latestTime: last.time,
    drawsStored: draws.length,
    current,
    forecasts: forecasts.slice(-2000)
  };

  fs.writeFileSync(OUTPUT_FILE, JSON.stringify(output, null, 2) + '\n');

  console.log(
    `Готово: тираж №${last.draw}; архив ${draws.length}; прогнозы ${output.forecasts.length}`
  );
  console.log(
    `Алгоритм: ${MODEL_VERSION}; ` +
    `Спринт: ${current.sprint.columns.join(', ')}; ` +
    `Марафон: ${current.marathon.columns.join(', ')}`
  );
}

main().catch(error => {
  console.error(error.stack || error.message || error);
  process.exit(1);
});
