'use strict';
(() => {
  const $ = id => document.getElementById(id);
  const pad = n => String(n).padStart(2, '0');
  const colOf = n => n % 10 || 10;
  const pct = v => `${Math.round((Number(v) || 0) * 100)}%`;
  let selectedDate = '';
  let autoForecastData = null;
  let winnerCache = [];
  let stateCache = [];
  let drawCountCache = [];
  let groupMovementCache = { endIndex: -1, stats: null };
  const ALGORITHM_VERSION = '2.3.1-group45';
  const FORECAST_ARCHIVE_KEY = 'pozitron_sm_number_archive_v2';
  const FORECAST_ARCHIVE_LIMIT = 2000;

  function rebuildStateCache() {
    const list = Array.isArray(draws) ? draws : [];
    winnerCache = new Array(list.length);
    stateCache = new Array(list.length).fill(null);
    drawCountCache = new Array(list.length);
    groupMovementCache = { endIndex: -1, stats: null };
    for (let i = 0; i < list.length; i += 1) {
      drawCountCache[i] = counts(list[i]);
      const official = Number(list[i]?.column);
      winnerCache[i] = Number.isInteger(official) && official >= 1 && official <= 10
        ? official
        : (Number(safeAnalysis(list[i]).winner) || 1);
    }
    for (let i = 1; i < list.length; i += 1) {
      stateCache[i] = Math.min(4, drawCountCache[i - 1][winnerCache[i]] || 0);
    }
  }

  function safeAnalysis(d) {
    try { return typeof analysis === 'function' ? analysis(d) : {}; }
    catch (_) { return {}; }
  }

  function counts(d) {
    const out = Array(11).fill(0);
    (d?.balls || []).forEach(n => { out[colOf(n)] += 1; });
    return out;
  }

  function winnerAt(i) {
    if (winnerCache.length !== (Array.isArray(draws) ? draws.length : 0)) rebuildStateCache();
    return winnerCache[i] || 1;
  }

  function stateBeforeWinner(i) {
    if (i <= 0) return null;
    if (stateCache.length !== (Array.isArray(draws) ? draws.length : 0)) rebuildStateCache();
    return stateCache[i] ?? null;
  }

  function stateLabel(s) {
    return s === 4 ? '4+' : String(s);
  }

  function stateShort(s) {
    return s === 4 ? '4+' : String(s);
  }

  function sequence(end, len) {
    const out = [];
    for (let i = Math.max(1, end - len + 1); i <= end; i += 1) {
      const state = stateBeforeWinner(i);
      if (state !== null) out.push(state);
    }
    return out;
  }


  function parseStatePattern(value) {
    return String(value || '')
      .replace(/4\s*\+/gi, '4')
      .split(/[^0-4]+/)
      .filter(Boolean)
      .map(Number)
      .filter(n => Number.isInteger(n) && n >= 0 && n <= 4);
  }

  function statePatternStats(pattern, maxIndex) {
    const countsNext = Array(5).fill(0);
    const examples = [];
    if (!Array.isArray(pattern) || pattern.length < 1) return { total: 0, countsNext, examples };

    for (let end = Math.max(pattern.length, 1); end < maxIndex; end += 1) {
      const candidate = sequence(end, pattern.length);
      if (candidate.length !== pattern.length) continue;
      if (!candidate.every((v, i) => v === pattern[i])) continue;
      const next = stateBeforeWinner(end + 1);
      if (next === null) continue;
      countsNext[next] += 1;
      if (examples.length < 5) examples.push({
        fromDraw: draws[end - pattern.length + 1]?.draw,
        toDraw: draws[end]?.draw,
        nextDraw: draws[end + 1]?.draw,
        next
      });
    }
    return { total: countsNext.reduce((a, b) => a + b, 0), countsNext, examples };
  }

  function patternResultHtml(pattern, maxIndex) {
    if (!pattern.length) return '<div class="small">Введите цепочку: например 3 2 2 2, 2 2 или 4+ 2 1.</div>';
    const stats = statePatternStats(pattern, maxIndex);
    if (!stats.total) return `<div class="small">После цепочки <b>${pattern.map(stateShort).join('→')}</b> точных случаев в архиве не найдено.</div>`;
    const rows = stats.countsNext
      .map((count, state) => ({ state, count, percent: Math.round(count * 100 / stats.total) }))
      .filter(x => x.count)
      .sort((a, b) => b.count - a.count || a.state - b.state);
    return `<div class="sm-pattern-summary">После <b>${pattern.map(stateShort).join('→')}</b> · найдено ${stats.total}</div>
      <div class="sm-pattern-results">${rows.map(x => `<div class="sm-pattern-chip"><b>${stateShort(x.state)}</b><strong>${x.percent}%</strong><small>${x.count} раз</small></div>`).join('')}</div>`;
  }

  function patternFinderHtml(model) {
    const initial = model.seq.slice(-4);
    return `<div class="section"><span>Поиск выхода после цепочки</span></div>
      <div class="sm-pattern-box">
        <div class="small">Любая цепочка режимов: 3 2 2 2, 2 2, 4+ 2 1</div>
        <div class="sm-pattern-row">
          <input id="smPattern_${model.typeKey}" value="${initial.map(stateShort).join(' ')}" inputmode="text" aria-label="Цепочка режимов">
          <button id="smPatternBtn_${model.typeKey}" type="button">Найти</button>
        </div>
        <div id="smPatternResult_${model.typeKey}"><div class="small">Нажмите «Найти», чтобы проверить эту цепочку по архиву.</div></div>
      </div>`;
  }

  function bindPatternFinder(model) {
    const input = $(`smPattern_${model.typeKey}`);
    const button = $(`smPatternBtn_${model.typeKey}`);
    const result = $(`smPatternResult_${model.typeKey}`);
    if (!input || !button || !result) return;
    const run = () => { result.innerHTML = patternResultHtml(parseStatePattern(input.value), model.endIndex); };
    button.onclick = run;
    input.onkeydown = e => { if (e.key === 'Enter') run(); };
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

  function classify(seq) {
    if (seq.length < 3) return 'недостаточно данных';
    let changes = 0;
    let rises = 0;
    let falls = 0;
    const freq = Array(5).fill(0);
    seq.forEach(x => { freq[x] += 1; });
    for (let i = 1; i < seq.length; i += 1) {
      if (seq[i] !== seq[i - 1]) changes += 1;
      if (seq[i] > seq[i - 1]) rises += 1;
      if (seq[i] < seq[i - 1]) falls += 1;
    }
    const rate = changes / Math.max(1, seq.length - 1);
    const max = Math.max(...freq);
    const dominant = freq.indexOf(max);
    const last = seq.at(-1);
    const prev = seq.at(-2);

    if (rate >= 0.88) return 'почти непрерывная смена';
    if (rate >= 0.70) return 'частая переменная смена';
    if (max >= Math.ceil(seq.length * 0.60)) return `удержание режима ${stateLabel(dominant)}`;
    if (rises >= seq.length - 2) return 'уплотнение';
    if (falls >= seq.length - 2) return 'разрежение';
    if (last === 0 && prev >= 2) return 'резкий сброс в пустоту';
    if (new Set(seq).size === 2 && rate >= 0.65) return 'качели двух режимов';
    return 'переменная смена';
  }

  function addHistoricalBaseline(support, minIndex, maxIndex, weight) {
    const countsByState = Array(5).fill(0);
    let total = 0;
    for (let i = Math.max(1, minIndex); i <= maxIndex; i += 1) {
      const state = stateBeforeWinner(i);
      if (state === null) continue;
      countsByState[state] += 1;
      total += 1;
    }
    if (!total) return;
    countsByState.forEach((v, s) => { support[s] += weight * (v / total); });
  }

  function addSuffixEvidence(seq, minIndex, maxIndex, support, stats) {
    const suffixLengths = [5, 4, 3, 2].filter(n => n <= seq.length);
    for (const len of suffixLengths) {
      const target = seq.slice(-len);
      const lengthWeight = ({ 5: 1.00, 4: 0.78, 3: 0.56, 2: 0.36 })[len] || 0.25;
      for (let end = minIndex + len - 1; end < maxIndex; end += 1) {
        const cand = sequence(end, len);
        if (cand.length !== len) continue;
        const sim = weightedSimilarity(target, cand);
        const threshold = len >= 5 ? 0.72 : len === 4 ? 0.76 : len === 3 ? 0.82 : 0.94;
        if (sim < threshold) continue;
        const next = stateBeforeWinner(end + 1);
        if (next === null) continue;
        const weight = lengthWeight * Math.pow(sim, 5);
        support[next] += weight;
        stats.weight += weight;
        if (len === 5 && sim > 0.999) stats.exact += 1;
        else stats.near += 1;
      }
    }
  }

  function addSwitchEvidence(seq, minIndex, maxIndex, support, stats) {
    if (seq.length < 3) return;
    const last = seq.at(-1);
    const prev = seq.at(-2);
    const before = seq.at(-3);
    const targetChanged = last !== prev;
    const targetChangedTwice = prev !== before;

    for (let i = Math.max(3, minIndex); i < maxIndex; i += 1) {
      const a = stateBeforeWinner(i - 2);
      const b = stateBeforeWinner(i - 1);
      const c = stateBeforeWinner(i);
      const next = stateBeforeWinner(i + 1);
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

function currentAvailability(endIndex) {
    const currentCounts = counts(draws[endIndex]);
    const byState = Array.from({ length: 5 }, () => []);
    for (let col = 1; col <= 10; col += 1) {
      byState[Math.min(4, currentCounts[col])].push(col);
    }
    return byState;
  }

  function profileKey(available) {
    return available.map(cols => cols.length).join('-');
  }

  function densityProfileForecast(endIndex, maxIndex) {
    const available = currentAvailability(endIndex);
    const baseProbs = available.map(cols => cols.length / 10);
    const targetKey = profileKey(available);
    const countsNext = Array(5).fill(0);
    let matches = 0;

    for (let currentIndex = 0; currentIndex <= maxIndex; currentIndex += 1) {
      const historicalAvailable = currentAvailability(currentIndex);
      if (profileKey(historicalAvailable) !== targetKey) continue;
      const nextState = stateBeforeWinner(currentIndex + 1);
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

  function analogForecast(seq, minIndex, maxIndex, endIndex) {
    const support = Array(5).fill(0);
    const stats = { exact: 0, near: 0, switchCases: 0, weight: 0 };

    addSuffixEvidence(seq, minIndex, maxIndex, support, stats);
    addSwitchEvidence(seq, minIndex, maxIndex, support, stats);
    addHistoricalBaseline(support, minIndex, maxIndex, Math.max(0.35, stats.weight * 0.25));

    const density = densityProfileForecast(endIndex, maxIndex);
    const supportTotal = support.reduce((a, b) => a + b, 0);
    const chainProbs = supportTotal
      ? support.map(v => v / supportTotal)
      : density.baseProbs.slice();

    // Плотность последнего тиража — только небольшая поправка. Основной вес
    // получают повторяющиеся цепочки и переключения из архива.
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

  function winnerStreak(col, endIndex) {
    let streak = 0;
    for (let i = endIndex; i >= 0; i -= 1) {
      if (winnerAt(i) === col) streak += 1;
      else break;
    }
    return streak;
  }

  function preservedWinnerFrame(col, endIndex) {
    if (endIndex < 1) return 0;
    const last = new Set(draws[endIndex].balls || []);
    const prev = (draws[endIndex - 1].balls || []).filter(n => colOf(n) === col);
    return prev.filter(n => last.has(n)).length;
  }

  function recentGap(n, endIndex, maxWindow = 40) {
    const start = Math.max(0, endIndex - maxWindow + 1);
    for (let i = endIndex; i >= start; i -= 1) {
      if ((draws[i]?.balls || []).includes(n)) return endIndex - i;
    }
    return maxWindow;
  }

  function sprintNumberScore(n, col, endIndex) {
    const lastSet = new Set(draws[endIndex]?.balls || []);
    const prevSet = new Set(draws[endIndex - 1]?.balls || []);
    const recent = draws.slice(Math.max(0, endIndex - 7), endIndex + 1);
    const hits = recent.filter(d => (d?.balls || []).includes(n)).length;
    const has = x => x >= 1 && x <= 80 && lastSet.has(x);
    let score = 0;

    // Спринт ищет короткое движение. Повтор больше не получает огромного преимущества.
    score += lastSet.has(n) ? 0.30 : 0.62;
    score += (hits / Math.max(1, recent.length)) * 0.95;
    if (!lastSet.has(n) && prevSet.has(n)) score += 0.45;
    if (has(n - 1) || has(n + 1)) score += 0.40;
    if (has(n - 10) || has(n + 10)) score += 0.48;
    if (has(n - 2) || has(n + 2)) score += 0.20;
    if (recentGap(n, endIndex, 12) >= 3) score += 0.28;

    return { score, reasons: [] };
  }

  function marathonNumberScore(n, col, endIndex) {
    const lastSet = new Set(draws[endIndex]?.balls || []);
    const recent80 = draws.slice(Math.max(0, endIndex - 79), endIndex + 1);
    const long240 = draws.slice(Math.max(0, endIndex - 239), endIndex + 1);
    const rate80 = recent80.filter(d => (d?.balls || []).includes(n)).length / Math.max(1, recent80.length);
    const rate240 = long240.filter(d => (d?.balls || []).includes(n)).length / Math.max(1, long240.length);
    const gap = recentGap(n, endIndex, 60);
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

    // Марафон оценивает устойчивость на длинных окнах. Пропуск остаётся
    // небольшой поправкой и не может вытеснить частоту и стабильность.
    const stability = 1 - Math.min(1, Math.abs(rate80 - rate240) * 5);
    const trend = Math.max(-0.20, Math.min(0.20, lateRate - earlyRate));
    let score = rate80 * 1.45 + rate240 * 1.25 + stability * 0.28;
    score += Math.min(0.32, gap * 0.035);
    score += Math.min(0.24, freshReturns * 0.025);
    score += trend * 0.70;
    if (lastSet.has(n)) score -= 0.12;

    return { score, reasons: [] };
  }

function recentWinnerRate(col, endIndex, window) {
    const start = Math.max(0, endIndex - window + 1);
    let hits = 0;
    for (let i = start; i <= endIndex; i += 1) if (winnerAt(i) === col) hits += 1;
    return hits / Math.max(1, endIndex - start + 1);
  }

  function densityMomentum(col, endIndex) {
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

  function transitionWinnerRate(col, endIndex, window) {
    if (endIndex < 2) return 0.10;
    const previousWinner = winnerAt(endIndex);
    const start = Math.max(1, endIndex - window + 1);
    let cases = 0;
    let hits = 0;
    for (let i = start; i <= endIndex; i += 1) {
      if (winnerAt(i - 1) !== previousWinner) continue;
      cases += 1;
      if (winnerAt(i) === col) hits += 1;
    }
    return (hits + 2) / (cases + 20);
  }

  function stableTie(col, endIndex, salt) {
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


  // GROUP_MOVEMENT_V230
  const GROUP_MOVEMENT_CONFIG = {
    p2:    { minN: 1200, minHalf: 500, edge: 0.0040, alpha: 400, sprint: 0.28, marathon: 0.12 },
    p3:    { minN:  700, minHalf: 250, edge: 0.0050, alpha: 300, sprint: 0.25, marathon: 0.18 },
    p4:    { minN:  450, minHalf: 180, edge: 0.0060, alpha: 220, sprint: 0.20, marathon: 0.25 },
    p5:    { minN:  350, minHalf: 140, edge: 0.0065, alpha: 180, sprint: 0.12, marathon: 0.25 },
    nbr:   { minN:  900, minHalf: 350, edge: 0.0045, alpha: 350, sprint: 0.12, marathon: 0.12 },
    empty: { minN:  200, minHalf:  75, edge: 0.0060, alpha: 250, sprint: 0.08, marathon: 0.08 }
  };

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

  function gmStateAt(index, col) {
    if (drawCountCache.length !== (Array.isArray(draws) ? draws.length : 0)) rebuildStateCache();
    return Math.min(4, drawCountCache[index]?.[col] || 0);
  }

  function gmStateText(value) {
    return Number(value) === 4 ? '4+' : String(value);
  }

  function gmPathKey(endIndex, col, len) {
    const out = [];
    for (let i = endIndex - len + 1; i <= endIndex; i += 1) out.push(gmStateAt(i, col));
    return out.join('>');
  }

  function gmNeighborKey(index, col) {
    const left = col === 1 ? 10 : col - 1;
    const right = col === 10 ? 1 : col + 1;
    const sides = [gmStateAt(index, left), gmStateAt(index, right)].sort((a, b) => a - b);
    return `${gmStateAt(index, col)}|${sides[0]}|${sides[1]}`;
  }

  function gmEmptyBucket(index, col) {
    if (gmStateAt(index, col) !== 0) return null;
    let streak = 0;
    for (let i = index; i >= 0 && streak < 4; i -= 1) {
      if (gmStateAt(i, col) !== 0) break;
      streak += 1;
    }
    return String(Math.min(4, streak));
  }

  function buildGroupMovementStats(endIndex) {
    if (groupMovementCache.endIndex === endIndex && groupMovementCache.stats) {
      return groupMovementCache.stats;
    }

    const books = {
      p2: gmNewBook(), p3: gmNewBook(), p4: gmNewBook(),
      p5: gmNewBook(), nbr: gmNewBook(), empty: gmNewBook()
    };
    const zeroStreak = Array(11).fill(0);
    const split = Math.floor(endIndex / 2);

    for (let t = 0; t < endIndex; t += 1) {
      const nextWinner = winnerAt(t + 1);
      const firstHalf = t < split;

      for (let col = 1; col <= 10; col += 1) {
        const hit = col === nextWinner;
        const state = gmStateAt(t, col);
        zeroStreak[col] = state === 0 ? Math.min(4, zeroStreak[col] + 1) : 0;

        for (const len of [2, 3, 4, 5]) {
          if (t < len - 1) continue;
          gmAdd(books[`p${len}`], gmPathKey(t, col, len), hit, firstHalf);
        }

        gmAdd(books.nbr, gmNeighborKey(t, col), hit, firstHalf);
        if (state === 0) gmAdd(books.empty, String(zeroStreak[col]), hit, firstHalf);
      }
    }

    const stats = { books };
    groupMovementCache = { endIndex, stats };
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

  function groupMovementScore(endIndex, col, typeKey) {
    const stats = buildGroupMovementStats(endIndex);
    const signals = [];

    for (const len of [2, 3, 4, 5]) {
      const feature = `p${len}`;
      const signal = gmStableSignal(stats, feature, gmPathKey(endIndex, col, len), typeKey);
      if (signal) signals.push(signal);
    }

    const neighbor = gmStableSignal(stats, 'nbr', gmNeighborKey(endIndex, col), typeKey);
    if (neighbor) signals.push(neighbor);

    const emptyKey = gmEmptyBucket(endIndex, col);
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


  // GROUP 4-OF-5 v1: frozen logistic model.
  // Trained only on history preceding the final 1000-draw validation window.
  // Validation: 947/1000 (94.7%) actual winner-state covered by selected 4 states.
  const GROUP45_MEAN=[1.9823895879595361,1.982420429311621,1.9824512706637059,1.9824512706637059,1.9823895879595361,1.9824512706637059,1.9824821120157907,1.9824821120157907,1.9824821120157907,1.9824821120157907,1.9824821120157907,1.9825437947199605,1.9824821120157907,1.982420429311621,1.9823895879595361,1.9823895879595361,1.9824512706637059,1.9823587466074513,1.9823587466074513,1.9822970639032815,1.9823279052553664,1.9823587466074513,1.9823279052553664,1.9823895879595361,1.982420429311621,1.982420429311621,1.9823895879595361,1.9824512706637059,1.982420429311621,1.982420429311621,0.08712681963976719,0.2649518874906883,0.3296755489760535,0.2148655317048442,0.10338021218848828,0.08711139896370794,0.26494263508512905,0.3297125585985513,0.21485319516408508,0.10338021218847193,0.08710368862571119,0.2649395509499096,0.3297387737478432,0.21485627929927575,0.10336170737725726,0.0870890389834657,0.2649727054034036,0.32972720824081037,0.21484240069084487,0.10336864668146654,0.08706552245250385,0.2650158832963203,0.3297391592647383,0.2148238958795931,0.10335553910683495,0.08709173760177687,0.26502802707870543,0.32979024025413384,0.21475662318035704,0.10333337188502241,0.08641373711279021,0.2632984208660519,0.3295431128527296,0.21412427057163363,0.10295033769865727,0.08647982560477566,0.2650349863920857,0.32991950797723185,0.2148479049016137,0.10371777512423735,0.08690584712321706,0.264683990187613,0.3298822517252248,0.21508737501097813,0.10344053595290381,0.08707653271625615,0.26493829515314515,0.32953645567112316,0.21507351773728192,0.10337519872215833,0.08874290648899152,0.2660066617320455,0.32813039723659665,0.21456020231927314,0.10255983222300559];
  const GROUP45_SCALE=[1.1142614584510016,1.1142481060087288,1.1142347525525738,1.1142347525525738,1.1142337793682184,1.114179392372501,1.1141660372392694,1.1141660372392694,1.1141660372392692,1.1141660372392694,1.1141660372392694,1.1141670053605741,1.1141660372392694,1.1141097020595372,1.1140676904300586,1.1140676904300586,1.114124029441613,1.11408104418094,1.1140810441809397,1.114080065739436,1.1140943969179544,1.1141364092478232,1.1141220794635345,1.114178419139791,1.1141927464921408,1.1141927464921408,1.1142060995978318,1.1141517112509347,1.1141650657023539,1.1141650657023536,0.1259440950536194,0.1970366546636224,0.21053593998389064,0.1832986879640279,0.13592687099803266,0.08917194763817149,0.13963492340337044,0.14865285778284404,0.12930314628638193,0.09584405137674355,0.06309026901297646,0.09905849678767217,0.10540855616355302,0.09126069122742926,0.06803514051341034,0.04432531615645728,0.06895497187259465,0.07611658790473554,0.06420169080142413,0.04766925594337587,0.03076243660349701,0.04847717371946021,0.053702128019593454,0.04630189919730991,0.03411883127152377,0.021162688366592443,0.03475110282393949,0.038835708812789756,0.03252455100758232,0.024047806318375584,0.10674361621767321,0.1722216792454518,0.18354044567595107,0.15848430335078206,0.11573614181796468,0.07240895455923999,0.11841011895344183,0.12525246541197657,0.10718162304829407,0.07958592683135651,0.04955859672433194,0.08251875099095007,0.08693110528205429,0.0737537762647944,0.0536430679402128,0.03439325531476599,0.05783301295231782,0.061120117193091385,0.04996407373838235,0.036716975762702414,0.07768373810007986,0.11987489141988025,0.15126249937449865,0.11674455409392802,0.07548828099546503];
  const GROUP45_COEF=[[-0.021365539042353297,0.010589978120230286,0.004563860829973165,0.02362638979501293,-0.026487538942311855,0.01611741224242935,0.008957627720148343,0.018306369946550494,-0.022776834728088457,-0.0227597022154176,-0.008392012969024396,-0.026759989970243096,0.0014564511879770312,-0.013043280141543693,-0.002123990387241565,0.012232382784046519,-0.010977203528408582,0.027735604554241473,-0.01944746581469028,0.005679404403698115,0.004538692022803597,-0.02531473758915152,-0.00915410013836704,-0.02306938777103589,-0.007012261395038871,-0.00018240319946169584,-0.004677262367517829,0.01587309867888904,-0.016720811421436506,-0.005149718673014425,0.0058136045233106995,-0.00098669617273115,0.017868057985215673,-0.042811599435967566,0.026099826685712382,0.0033986731451509495,-0.01453636107042816,0.020901100837570744,-0.00066407370668497,-0.013505524559878971,0.016926841007780594,0.0038014557966262593,-0.022324091773948385,0.019773475173173162,-0.013167844932736757,-0.02748075794333391,-0.021312898929583293,0.03405940936335867,-0.014037701106679228,0.020904076008165653,-0.010639457829965481,0.01686843680396777,-0.019507678126206046,0.025220774281953316,-0.017896404770041986,-0.0035324118260139335,0.00982257527913025,0.01023235365603937,-0.0059328548925502555,-0.019586287917976532,-0.0036083080039116247,0.021990910195118892,0.023289950269337525,-0.00765519961845591,-0.006154538656985779,0.03699538263372903,0.006371870957429317,-0.034160573841321866,0.007142969137024049,0.0010028166176962166,-0.02741042743380196,-0.020420939214085207,0.015384331672148205,0.017806963788865704,0.007322939436350463,-0.0054490205637478875,-0.01420496283679577,0.0036053233701012904,0.0031691658908801156,0.017164352916710247,0.6667274413202092,-0.1745602627311691,-0.10797739409617875,-0.06455151415227481,-0.09272325531214373],[0.0042700481322900915,0.007217132612440829,-0.008430666232612717,-0.004906581232903387,0.006687736541651723,-0.0070855197187473596,-0.00922308704718516,0.002703932496598066,0.0011984208295244753,-0.0011328581261876708,0.007067639334888698,-0.0020042800411655915,0.007298606668667227,0.014724751535789648,0.0051955780005416155,-0.007999940814017293,-0.01624921222366175,0.018180748564059924,0.004493991933702205,0.00015025710919454056,0.009544121913684006,0.008519038144513708,0.005411691635949205,0.006797438791839758,-0.01657213805899585,0.006057953530193867,0.00915639618284964,-0.0033887027275865816,-0.0033492416654364605,-0.0136210918357807,0.009718185668809397,-0.011929648599025882,-0.011952978385462859,0.03333850425166982,-0.018154928295236062,-0.005661516136113205,0.023095881896446437,-0.01219583311679509,-0.023667247826204448,0.022464114816709613,-0.017726050816599122,-0.0011273692622869296,0.015381231724441525,0.0036326861744871456,-0.010624187073443455,0.01254544029410394,-0.007631666886352869,-0.012535875002518557,0.008866109964404371,0.007449865582125121,0.004826144988295428,-0.016963201456781672,0.023578499343709074,-0.014126280537252485,0.0018090335899751987,0.0050556403642113504,0.011424639425261018,-0.03455429315994925,0.021752593398585814,0.005424086139523061,0.014128922591710667,-0.013252529206156898,-0.004113262096168715,0.017757234600425647,-0.007592807711754813,-0.015065586244585328,0.029154039160320836,-0.01772842794277831,-0.0032979707173849183,0.0026733528814517904,-0.00014783990152351787,-0.015377800259851067,0.025573464131445393,-0.015143672148116183,0.0031701600901761673,0.01647526701256131,0.013932865353649954,-0.00786619274510783,-0.011720676951408156,-0.008334625903520135,-0.2736426640273691,0.34109970595645145,-0.07014253507369521,-0.03914010770588965,-0.058981016944980834],[0.003714268925963768,0.006022797489963987,-0.004790319783304816,-0.006988356170338335,-0.0007180033203566218,-0.010708395023245403,0.007914398205517124,-0.001096348141561592,0.012457570719084037,-0.007591692477110863,0.014563577429009697,0.019829979655739637,-0.005962470383240386,0.007326716173380887,-0.017581428370518386,-0.003262595288831481,0.011408125035890612,-0.013074636409832854,-0.0009355170725812339,0.013574301442851221,0.016364487174554444,0.0029814964388590955,0.005724369293306508,0.0013223232876517156,0.008591569192162671,-0.004592809182145295,-0.0005076568292168522,-0.011981980694492822,-0.005239547220770089,0.01568906331699791,-0.01174805766548156,0.007210900331509271,0.00439665296516881,0.002289090291363173,-0.009464308929483219,0.02378335994555993,-0.006983450246473653,-0.026311276368917114,0.01905174582594076,0.0031522118984874023,0.004273286513818942,-0.009218406306086552,0.009535047591962508,-0.01853821554553268,0.019553034371399713,-0.009035867669991295,0.012566484629922412,0.010861175361089284,-0.004332909750000324,-0.021282886841337178,0.015731148994427468,0.021520734306904998,-0.017683487587518934,-0.021390964642115495,0.01210153860072114,-0.005865455398211095,-0.0021249646610882983,0.01197500843420146,-0.001609217611882573,-0.00892992846343838,-0.050348344314279724,-0.03683392020495179,-0.05221392419425872,-0.01540608221058158,-0.024728345397966513,-0.01167852094895523,-0.02196579899494549,0.029745999866727803,-0.0016582382275195046,-0.0012744060947354145,0.037692634899008017,-0.007593686753247256,-0.026152087549874494,0.009956377278468195,0.005550333327968617,-0.021010248640010894,0.002208255768316856,0.008442863433473682,-0.004544042609752415,0.008331591380427335,-0.17730841433492156,-0.10467952848613055,0.3578846790778249,-0.12329036295321462,-0.1777577246142896],[0.0025129316021998893,-0.011694869613022189,-0.010673217638596839,0.018359122444009786,0.010690841810770181,-0.01502971693185589,-0.005903783389420705,-0.013872199132833812,0.010343509991708069,0.010131752769885443,-0.0019288490421755582,0.0012076324999042382,-0.003381755448651816,0.000356568021391417,-0.0019180058553553542,-0.006447719336347609,-0.015772834562339154,0.0019647772465797857,0.030439370814242004,0.00415871752883357,0.0006622133338033249,0.002835224378851165,-0.009326842338686213,0.0030981758694618145,0.008336020310360685,0.0027047618573886227,0.025406537937244164,-0.0003001590621380202,0.020904444206934627,0.003918880675755503,-0.007513430731890908,0.017773809238958133,-0.01588194493605052,-0.011362664836837103,0.021119165492330685,0.003344776080528534,-0.013847483983865646,0.01116703098144494,0.014383835958069836,-0.019662713735609502,-0.026174505654116036,0.015818095275387477,0.011356028808819417,-0.007523911731378611,-0.006260666898889725,0.0399335486833858,-0.018548105916799874,-0.014219650817833936,-0.007873141046487541,0.023007223376815936,-0.02903558444499654,0.019891720714533687,0.008472059977296734,0.0005277353567297576,-0.016134546618022452,-0.007058812905886505,-0.0026667492664940546,0.001053256256376112,-0.001791007815157103,0.01078700086228425,-0.021073958236512556,-0.042168427824102274,-0.06051013771217687,-0.06365804231592412,-0.03039701941126941,0.0028846167116678536,-0.03307889035174099,0.0021506831987201974,0.044713102107898924,-0.017010519589381663,-0.015125952169171132,0.033233652976438634,-0.014774694865923898,-0.03882477526378797,0.04017435719341417,0.014540403837351688,-0.007670277913575772,0.01672444750423882,-0.006450657108421097,-0.020600706020650356,-0.1931005247898183,-0.1031316247255601,-0.09327272425859545,0.46421445832529934,-0.16853187631051064],[0.010868290381898833,-0.012135038609614164,0.01933034282454115,-0.03009057483578124,0.009826963910245706,0.016706219431419797,-0.001745155489059423,-0.00604175516875424,-0.001222666812227206,0.021352500048831154,-0.011310354752699337,0.007726657855764548,0.000589167975248634,-0.009364755589017207,0.016427846612574064,0.005477872655149924,0.03159112527851837,-0.034806493955048125,-0.014550379860672126,-0.023562680484577606,-0.031109514444844978,0.01097897862692741,0.007344881547797545,0.01185144982208202,0.0066568099515114595,-0.003987503005975589,-0.029378014923358082,-0.00020225619467238262,0.004405156100707708,-0.0008371334839577702,0.0037296982052535694,-0.012068364798710537,0.005570212371129087,0.018546669729772185,-0.0195997549533239,-0.02486529303512574,0.012271413404320556,0.00643897766669613,-0.00910426025112229,0.00755191158029089,0.022700428949115985,-0.009273775503640357,-0.013948216351275541,0.0026559659292513986,0.010499664533670674,-0.01596236336416477,0.034926187102812686,-0.018165058904094238,0.01737764193876222,-0.03007827812576999,0.01911774829224026,-0.04131769036862492,0.005140606392720098,0.00976873554068496,0.020120379197368247,0.01140103976590018,-0.01645550077680834,0.011293674813332497,-0.012419513078996752,0.012305129379607168,0.060901687962993147,0.07026396704009241,0.09354737373326649,0.06896208954453595,0.06887271117797661,-0.013135892151856322,0.019518779228936724,0.019992318718652417,-0.04689986230001713,0.014608756184969754,0.004991584605488544,0.010158773250745191,-3.101338779538392e-05,0.0262051063445693,-0.05621779004790879,-0.004556401646154534,0.005734119628405634,-0.020906441562706962,0.01954621077870148,0.0034393876270333596,-0.022675838168099944,0.04127170998640821,-0.08649202564935543,-0.237232473513922,0.49799387318192606]];
  const GROUP45_INTERCEPT=[-0.18789117054565135,0.10643793094235139,0.11133373141878819,0.059902830227048835,-0.08978332204253907];

  function group45Features(stateCacheLocal, drawCountsLocal, endIndex) {
    const f=[];
    for(let lag=0;lag<30;lag++) f.push(Number(stateCacheLocal[endIndex-lag] ?? 0));
    for(const W of [5,10,20,40,80,160]) {
      const start=Math.max(1,endIndex-W+1);
      const vals=[];
      for(let i=start;i<=endIndex;i++) if(stateCacheLocal[i]!==null && stateCacheLocal[i]!==undefined) vals.push(Number(stateCacheLocal[i]));
      for(let k=0;k<5;k++) f.push(vals.length?vals.filter(v=>v===k).length/vals.length:0);
    }
    const last=Number(stateCacheLocal[endIndex] ?? 0);
    for(const W of [40,80,160,320]) {
      const start=Math.max(1,endIndex-W+1);
      const next=[0,0,0,0,0]; let den=0;
      for(let i=start;i<endIndex;i++) {
        if(Number(stateCacheLocal[i])===last) {
          const n=Number(stateCacheLocal[i+1]);
          if(n>=0&&n<=4){next[n]++;den++;}
        }
      }
      for(let k=0;k<5;k++) f.push(den?next[k]/den:0);
    }
    const current=drawCountsLocal[endIndex] || Array(11).fill(0);
    for(let k=0;k<5;k++) {
      let n=0;
      for(let col=1;col<=10;col++) if(Math.min(4,Number(current[col]||0))===k)n++;
      f.push(n/10);
    }
    return f;
  }

  function group45Probabilities(stateCacheLocal, drawCountsLocal, endIndex) {
    if(endIndex<320) return [0.2,0.2,0.2,0.2,0.2];
    const f=group45Features(stateCacheLocal,drawCountsLocal,endIndex);
    const logits=GROUP45_COEF.map((row,k)=>{
      let z=GROUP45_INTERCEPT[k];
      for(let j=0;j<85;j++) z += row[j]*((f[j]-GROUP45_MEAN[j])/(GROUP45_SCALE[j]||1));
      return z;
    });
    const mx=Math.max(...logits);
    const e=logits.map(v=>Math.exp(v-mx)); const s=e.reduce((a,b)=>a+b,0)||1;
    return e.map(v=>v/s);
  }

  function group45SelectRows(ranked, probs) {
    const byState=[0,1,2,3,4].map(s=>ranked.filter(r=>Number(r.state)===s));
    const available=[0,1,2,3,4].filter(s=>byState[s].length);
    // Four distinct states are impossible when fewer than four states currently contain columns.
    if(available.length<4) return ranked.slice(0,4);
    const states=available.slice().sort((a,b)=>(probs[b]||0)-(probs[a]||0)).slice(0,4);
    const chosen=states.map(s=>byState[s][0]).filter(Boolean);
    return chosen.sort((a,b)=>(b.score||0)-(a.score||0));
  }

  function rankColumns(pred, endIndex, typeKey) {
    const current = drawCountCache.length === draws.length ? drawCountCache[endIndex] : counts(draws[endIndex]);
    const rows = [];
    const sprint = typeKey === 'sprint';

    for (let col = 1; col <= 10; col += 1) {
      const state = Math.min(4, current[col]);
      const groupSize = Math.max(1, pred.available[state]?.length || 0);
      const perColumnRegime = (pred.probs[state] || 0) / groupSize;
      const rate12 = recentWinnerRate(col, endIndex, 12);
      const rate30 = recentWinnerRate(col, endIndex, 30);
      const rate80 = recentWinnerRate(col, endIndex, 80);
      const rate240 = recentWinnerRate(col, endIndex, 240);
      const transition = transitionWinnerRate(col, endIndex, sprint ? 160 : 600);
      const momentum = Math.max(-2, Math.min(2, densityMomentum(col, endIndex)));
      const stability = 1 - Math.min(1, Math.abs(rate80 - rate240) * 8);
      const activity = sprint ? 0.65 * rate12 + 0.35 * rate30 : 0.55 * rate80 + 0.45 * rate240;
      const movement = groupMovementScore(endIndex, col, typeKey);
      const baseScore = sprint
        ? activity * 55 + transition * 25 + perColumnRegime * 12 + momentum * 1.5
        : activity * 60 + transition * 20 + stability * 3 + perColumnRegime * 5;
      const score = baseScore + movement.points;

      const reasons = [];
      reasons.push(sprint ? 'короткий горизонт 12–30 тир.' : 'длинный горизонт 80–240 тир.');
      reasons.push(`переход ${Math.round(transition * 100)}%`);
      reasons.push(`режим ${stateLabel(state)} — малый вес`);
      reasons.push(movement.signals.length ? `движение групп ${movement.points >= 0 ? '+' : ''}${movement.points.toFixed(2)} · ${movement.summary}` : 'движение групп: устойчивого сигнала нет');
      rows.push({
        col, state, score: score + stableTie(col, endIndex, sprint ? 17 : 53) * 0.0001,
        reasons, regime: pred.probs[state] || 0, perColumnRegime, activity, transition, momentum, stability,
        baseScore, movementPoints: movement.points, movementSignals: movement.signals
      });
    }
    rows.sort((a, b) => b.score - a.score || stableTie(b.col, endIndex, 91) - stableTie(a.col, endIndex, 91));
    return rows;
  }

  function pickNumbers(rows, limit, options = {}) {
    const lastSet = new Set(draws[options.endIndex]?.balls || []);
    const maxRepeats = Number.isFinite(options.maxRepeats) ? options.maxRepeats : limit;
    const selected = [];
    let repeats = 0;

    for (const row of rows) {
      if (selected.length >= limit) break;
      const isRepeat = lastSet.has(row.n);
      if (isRepeat && repeats >= maxRepeats) continue;
      selected.push(row);
      if (isRepeat) repeats += 1;
    }

    // Защитное заполнение: комбинация всегда должна иметь нужную длину.
    if (selected.length < limit) {
      const used = new Set(selected.map(x => x.n));
      for (const row of rows) {
        if (selected.length >= limit) break;
        if (used.has(row.n)) continue;
        selected.push(row);
        used.add(row.n);
      }
    }
    return selected;
  }

  function rankSprintNumbers(cols, endIndex) {
    const rows = [];
    for (const col of cols) {
      for (let n = col; n <= 80; n += 10) rows.push({ n, col, ...sprintNumberScore(n, col, endIndex) });
    }
    rows.sort((a, b) => b.score - a.score || a.n - b.n);
    return pickNumbers(rows, 6, { endIndex, maxRepeats: 2 });
  }

  function rankMarathonNumbers(cols, endIndex) {
    const rows = [];
    for (const col of cols) {
      for (let n = col; n <= 80; n += 10) rows.push({ n, col, ...marathonNumberScore(n, col, endIndex) });
    }
    rows.sort((a, b) => b.score - a.score || a.n - b.n);
    return pickNumbers(rows, 8, { endIndex, maxRepeats: 2 });
  }

  async function loadAutoForecastData() {
    try {
      const response = await fetch(`keno-auto.json?ts=${Date.now()}`, { cache: 'no-store' });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      autoForecastData = await response.json();
    } catch (_) {
      autoForecastData = null;
    }
  }

  function forecastMark(type, drawNumber, winnerColumn) {
    const forecasts = Array.isArray(autoForecastData?.forecasts) ? autoForecastData.forecasts : [];
    const forecast = forecasts.find(item =>
      item?.type === type && Number(item?.targetDraw) === Number(drawNumber)
    );
    if (!forecast || !Array.isArray(forecast.columns)) return '';

    const place = forecast.columns.map(Number).indexOf(Number(winnerColumn));
    if (place === 0) return '<span class="sm-hit sm-hit-first" title="Первый прогноз">✓</span>';
    if (place > 0 && place < 4) return '<span class="sm-hit sm-hit-other" title="Прогноз 2–4">✓</span>';
    return '<span class="sm-hit sm-hit-miss" title="Не угадали ни один из 4 столбцов">✕</span>';
  }

  function dateIndices(date) {
    const out = [];
    for (let i = 0; i < draws.length; i += 1) if (draws[i]?.date === date) out.push(i);
    return out;
  }

  function availableDates() {
    return [...new Set(draws.map(d => d?.date).filter(Boolean))].reverse();
  }

  function splitIntoCycles(indices) {
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

  function sprintModel(dayIndices) {
    const cycles = splitIntoCycles(dayIndices);
    const chosenCycles = cycles.slice(-2);
    const chosen = chosenCycles.flat();
    const end = chosen.at(-1);
    const start = chosen[0];
    const seq = chosen.map(i => stateBeforeWinner(i)).filter(v => v !== null);
    const pred = analogForecast(seq, 1, end - 1, end);
    const ranked = rankColumns(pred, end, 'sprint');
    const cols = group45SelectRows(ranked, group45Probabilities(stateCache, drawCountCache, end));
    const nums = rankSprintNumbers(cols.map(x => x.col), end);
    const signal = signalFromRows(ranked);
    return {
      algorithmVersion: ALGORITHM_VERSION,
      ...signal,
      name: 'СПРИНТ',
      seq,
      pred,
      cols,
      nums,
      type: classify(seq),
      window: chosen.length,
      startIndex: start,
      endIndex: end,
      cycles: chosenCycles,
      typeKey: 'sprint'
    };
  }

  function marathonModel(dayIndices) {
    const chosen = dayIndices.slice(-40);
    const end = chosen.at(-1);
    const start = chosen[0];
    const seq = chosen.map(i => stateBeforeWinner(i)).filter(v => v !== null);
    const tail = seq.slice(-10);
    const pred = analogForecast(tail, 1, end - 1, end);
    const ranked = rankColumns(pred, end, 'marathon');
    const cols = group45SelectRows(ranked, group45Probabilities(stateCache, drawCountCache, end));
    const nums = rankMarathonNumbers(cols.map(x => x.col), end);
    return {
      name: 'МАРАФОН', algorithmVersion: ALGORITHM_VERSION, ...signalFromRows(ranked),
      seq, pred, cols, nums, type: classify(seq), window: chosen.length,
      startIndex: start, endIndex: end, typeKey: 'marathon'
    };
  }

  function regimeBars(pred) {
    return pred.order.map(state => {
      const available = pred.available[state] || [];
      const impossible = !available.length;
      return `<div class="sm-reg${impossible ? ' sm-off' : ''}">
        <b>${stateShort(state)}</b>
        <span>${impossible ? '0%' : pct(pred.probs[state] || 0)}</span>
        <small>${available.length ? `${available.length} ст. (${available.map(c => `ст${c}`).join(', ')})` : 'нет'}</small>
      </div>`;
    }).join('');
  }

  function predictedState(pred) {
    return (pred?.order || []).find(state => (pred.available?.[state] || []).length) ?? null;
  }

  function drawBlockHtml(startIndex, endIndex, typeKey, nextState = null) {
    const start = draws[startIndex];
    const end = draws[endIndex];
    const cols = [];
    const states = [];
    for (let i = startIndex; i <= endIndex; i += 1) {
      const winner = winnerAt(i);
      const mark = forecastMark(typeKey, draws[i]?.draw, winner);
      cols.push(`ст${winner}${mark}`);
      states.push(stateBeforeWinner(i));
    }
    return `<div class="sm-chain-block">
      <b>№${start.draw}–№${end.draw} · ${start.date} · ${start.time}–${end.time}</b>
      <div><span>Столбцы:</span> ${cols.join(' → ')}</div>
      <div><span>Выход:</span> ${states.map(stateLabel).join(' → ')}</div>
    </div>`;
  }

  function drawStamp(d) {
    const dm = String(d?.date || '').match(/(\d{1,2})[.\/-](\d{1,2})[.\/-](\d{4}|\d{2})(?!\d)/);
    const tm = String(d?.time || '').match(/(\d{1,2}):(\d{2})/);
    if (!dm || !tm) return null;
    const year = dm[3].length === 2 ? 2000 + Number(dm[3]) : Number(dm[3]);
    return new Date(year, Number(dm[2]) - 1, Number(dm[1]), Number(tm[1]), Number(tm[2])).getTime();
  }

  function chainBlocksHtml(model) {
    if (Array.isArray(model.cycles) && model.cycles.length) {
      const cycles = model.cycles.filter(cycle => cycle.length);
      return cycles
        .map((cycle, index) => drawBlockHtml(
          cycle[0],
          cycle.at(-1),
          model.typeKey
        ))
        .join('');
    }

    const blocks = [];
    let start = model.startIndex;

    for (let i = model.startIndex + 1; i <= model.endIndex; i += 1) {
      const prevStamp = drawStamp(draws[i - 1]);
      const curStamp = drawStamp(draws[i]);
      const gapMinutes = prevStamp !== null && curStamp !== null
        ? Math.round((curStamp - prevStamp) / 60000)
        : 30;

      const reachedFive = i - start >= 5;
      const newCycle = gapMinutes > 35 || draws[i]?.date !== draws[i - 1]?.date;

      if (reachedFive || newCycle) {
        blocks.push(drawBlockHtml(start, i - 1, model.typeKey));
        start = i;
      }
    }

    if (start <= model.endIndex) blocks.push(drawBlockHtml(start, model.endIndex, model.typeKey));
    return blocks.join('');
  }

  function readNumberArchive() {
    try {
      const parsed = JSON.parse(localStorage.getItem(FORECAST_ARCHIVE_KEY) || '[]');
      return Array.isArray(parsed) ? parsed : [];
    } catch (_) {
      return [];
    }
  }

  function writeNumberArchive(records) {
    try {
      localStorage.setItem(FORECAST_ARCHIVE_KEY, JSON.stringify(records.slice(-FORECAST_ARCHIVE_LIMIT)));
    } catch (_) {
      // Архив не должен ломать основной анализ при запрете локального хранилища.
    }
  }

  function saveForecastPair(sprint, marathon) {
    if (!sprint || !marathon || sprint.endIndex !== draws.length - 1 || marathon.endIndex !== draws.length - 1) return;
    const source = draws[sprint.endIndex];
    const targetDraw = Number(source?.draw || 0) + 1;
    if (!targetDraw) return;

    const records = readNumberArchive();
    if (records.some(r => Number(r?.targetDraw) === targetDraw)) return;
    records.push({
      targetDraw,
      sourceDraw: Number(source.draw),
      sourceDate: source.date || '',
      createdAt: new Date().toISOString(),
      algorithmVersion: ALGORITHM_VERSION,
      sprintColumns: sprint.cols.map(x => Number(x.col)),
      marathonColumns: marathon.cols.map(x => Number(x.col)),
      sprintSignal: sprint.signal,
      marathonSignal: marathon.signal,
      sprint: sprint.nums.map(x => Number(x.n)),
      marathon: marathon.nums.map(x => Number(x.n))
    });
    writeNumberArchive(records);
  }

  function actualDrawByNumber(drawNumber) {
    const index = draws.findIndex(d => Number(d?.draw) === Number(drawNumber));
    return index >= 0 ? { index, draw: draws[index] } : null;
  }

  function archiveNumbersHtml(nums, actualSet) {
    return nums.map(n => {
      const hit = actualSet?.has(Number(n));
      return `<span class="sm-archive-num${hit ? ' sm-archive-hit' : ''}">${pad(n)}${hit ? '<b>✓</b>' : ''}</span>`;
    }).join('');
  }

  function archiveRowHtml(record) {
    const actual = actualDrawByNumber(record.targetDraw);
    const actualSet = actual ? new Set(actual.draw?.balls || []) : null;
    const winner = actual ? winnerAt(actual.index) : null;
    const time = actual?.draw?.time ? String(actual.draw.time).slice(0, 5) : '';
    const head = actual
      ? `№${record.targetDraw} · ст${winner} · ${time}`
      : `№${record.targetDraw} · ожидается`;
    return `<div class="sm-archive-row">
      <b>${head}</b>
      <div><span>🏃</span>${archiveNumbersHtml(record.sprint || [], actualSet)}</div>
      <div><span>🐢</span>${archiveNumbersHtml(record.marathon || [], actualSet)}</div>
    </div>`;
  }

  function forecastArchiveHtml() {
    const records = readNumberArchive();
    if (!records.length) {
      return `<details class="sm-archive"><summary>Архив комбинаций</summary><div class="small">Первая запись появится после фиксации прогноза на следующий тираж.</div></details>`;
    }

    const groups = new Map();
    for (const record of records) {
      const actual = actualDrawByNumber(record.targetDraw);
      const date = actual?.draw?.date || record.sourceDate || 'Без даты';
      if (!groups.has(date)) groups.set(date, []);
      groups.get(date).push(record);
    }

    const dates = [...groups.keys()].sort((a, b) => {
      const ai = groups.get(a).at(-1)?.targetDraw || 0;
      const bi = groups.get(b).at(-1)?.targetDraw || 0;
      return bi - ai;
    });

    return `<details class="sm-archive"><summary>Архив комбинаций</summary>
      <div class="sm-archive-days">${dates.map((date, index) => {
        const rows = groups.get(date).slice().sort((a, b) => Number(a.targetDraw) - Number(b.targetDraw));
        return `<details class="sm-archive-day"${index === 0 ? ' open' : ''}><summary>${date}</summary>${rows.map(archiveRowHtml).join('')}</details>`;
      }).join('')}</div>
    </details>`;
  }

  function captureLatestForecast() {
    try {
      if (!Array.isArray(draws) || draws.length < 2) return;
      const latestDate = draws.at(-1)?.date;
      const day = dateIndices(latestDate);
      if (!day.length) return;
      const sprint = sprintModel(day);
      const marathon = marathonModel(day);
      saveForecastPair(sprint, marathon);
    } catch (_) {
      // Не мешаем основному приложению, если архив временно не смог обновиться.
    }
  }

  function modelHtml(model, icon) {
    const changes = model.seq.slice(1).filter((x, i) => x !== model.seq[i]).length;
    const weakSignal = model.signal === 'слабый'
      ? '<div class="row sm-weak"><b>Слабый сигнал.</b> Четвёрка сохранена, но преимущество над следующими столбами небольшое.</div>'
      : '';
    return `<div class="sm-card">
      <div class="sm-head">${icon} ${model.name}</div>
      <div class="small">Алгоритм ${model.algorithmVersion} · сигнал: <b>${model.signal}</b> (${Math.round(model.signalScore * 100)}%)</div>
      ${weakSignal}
      <div class="sm-seq">${model.seq.map(stateShort).join('→')}</div>
      <div class="small"><b>Цикл:</b> ${model.type} · смен ${changes}/${Math.max(1, model.seq.length - 1)}</div>
      ${patternFinderHtml(model)}
      <div class="section"><span>Цепочки тиражей</span></div>
      <div class="sm-chain-list">${chainBlocksHtml(model)}</div>
      <div class="section"><span>Вероятное продолжение режима</span></div>
      <div class="sm-regs">${regimeBars(model.pred)}</div>
      <div class="row small">Точных пятёрок: ${model.pred.exact} · близких фрагментов: ${model.pred.near} · переключений учтено: ${model.pred.switchCases}</div>
      <div class="section"><span>Выход №${Number(draws[model.endIndex]?.draw || 0) + 1}</span></div>
      ${model.cols.map((x, i) => `<div class="sm-line"><b>${i + 1}. ст${x.col}</b> · сейчас ${stateLabel(x.state)} · ${Math.round(x.score * 100)} баллов<br><span class="small">${x.reasons.join(' · ') || 'по режиму цепочки'}</span></div>`).join('')}
      <div class="section"><span>Комбинация чисел</span></div>
      <div class="sm-balls">${model.nums.map(x => `<div class="sm-ball"><b>${pad(x.n)}</b><small>ст${x.col}</small></div>`).join('')}</div>
    </div>`;
  }

  function agreementHtml(sprint, marathon) {
    const sprintNums = new Set(sprint.nums.map(x => x.n));
    const marathonNums = new Set(marathon.nums.map(x => x.n));
    const nums = [...sprintNums].filter(n => marathonNums.has(n));
    const sprintCols = new Set(sprint.cols.map(x => x.col));
    const marathonCols = new Set(marathon.cols.map(x => x.col));
    const cols = [...sprintCols].filter(c => marathonCols.has(c));
    return `<div class="sm-agree"><b>Совпадение Спринта и Марафона</b><br>
      Столбцы: ${cols.length ? cols.map(c => `ст${c}`).join(' · ') : 'нет общего сигнала'}<br>
      Числа: ${nums.length ? nums.map(pad).join(' · ') : 'нет общего сигнала'}<br>
      <span class="small">При расхождении вывод считается экспериментальным.</span></div>`;
  }

  function render(which) {
    const box = $('sprintMarathonResult');
    if (!box) return;
    if (!Array.isArray(draws) || draws.length < 60) {
      box.innerHTML = '<div class="row">Нужно не меньше 60 тиражей.</div>';
      return;
    }
    const dates = availableDates();
    if (!selectedDate || !dates.includes(selectedDate)) selectedDate = dates[0] || '';
    const day = dateIndices(selectedDate);
    const selector = `<div class="sm-date-row"><b>День анализа</b><select id="smDateSelect">${dates.map(d => `<option value="${d}"${d === selectedDate ? ' selected' : ''}>${d}</option>`).join('')}</select></div>`;
    if (!day.length) { box.innerHTML = selector + '<div class="row">За выбранный день тиражей нет.</div>'; return; }
    box.innerHTML = selector + '<div class="row">⏳ Анализирую выбранный день…</div>';
    const select = $('smDateSelect');
    if (select) select.onchange = e => { selectedDate = e.target.value; render(which); };
    setTimeout(async () => {
      await loadAutoForecastData();
      const sprint = sprintModel(day);
      const marathon = marathonModel(day);
      saveForecastPair(sprint, marathon);
      const content = which === 'sprint'
        ? modelHtml(sprint, '🏃')
        : which === 'marathon'
          ? modelHtml(marathon, '🐢')
          : modelHtml(sprint, '🏃') + modelHtml(marathon, '🐢') + agreementHtml(sprint, marathon);
      box.innerHTML = selector + `<div class="small sm-day-count">За ${selectedDate}: ${day.length} тиражей. Спринт — 2 последних цикла (${sprint.window} тиражей), Марафон — ${Math.min(40, day.length)}.</div>` + content + forecastArchiveHtml();
      const select2 = $('smDateSelect');
      if (select2) select2.onchange = e => { selectedDate = e.target.value; render(which); };
      if (which === 'sprint') bindPatternFinder(sprint);
      else if (which === 'marathon') bindPatternFinder(marathon);
      else { bindPatternFinder(sprint); bindPatternFinder(marathon); }
    }, 20);
  }

  function inject() {
    const sprintButton = $('sprintBtn');
    const marathonButton = $('marathonBtn');
    const panel = $('sprintMarathonPanel');
    if (!sprintButton || !marathonButton || !panel) return;

    const toggle = which => {
      const open = !panel.classList.contains('show') || panel.dataset.which !== which;
      panel.classList.toggle('show', open);
      panel.dataset.which = open ? which : '';
      if (open) {
        render(which);
        panel.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }
    };

    sprintButton.onclick = () => toggle('sprint');
    marathonButton.onclick = () => toggle('marathon');
  }

  function styles() {
    if ($('sprintMarathonStyles')) return;
    const style = document.createElement('style');
    style.id = 'sprintMarathonStyles';
    style.textContent = `
      .sm-split{display:grid;grid-template-columns:1fr 1fr;gap:6px;min-width:0}.sm-split .tool{font-size:28px;padding:8px 3px;min-width:0;white-space:nowrap}
      .sm-title,.sm-head{font-size:20px;font-weight:950}.sm-date-row{display:flex;align-items:center;justify-content:space-between;gap:10px;margin:10px 0}.sm-date-row select{background:#102238;color:#fff;border:1px solid #355275;border-radius:10px;padding:10px 12px;font-weight:900;font-size:16px;max-width:58%}.sm-day-count{margin:6px 0 10px;color:#9fb0c6}.sm-card{border:1px solid #2b4668;border-radius:14px;padding:12px;margin-top:10px;background:#0e1d30}.sm-weak{border:1px solid #8a642d;background:#30230f;color:#ffd98a}
      .sm-seq{font-size:25px;font-weight:950;color:#83e6a5;letter-spacing:1px;overflow-wrap:anywhere;margin:8px 0}
      .sm-regs{display:grid;grid-template-columns:repeat(5,1fr);gap:5px}.sm-reg{border:1px solid #355275;border-radius:9px;padding:7px 3px;text-align:center}.sm-reg b,.sm-reg span,.sm-reg small{display:block}.sm-reg span{color:#ffd764;font-weight:900}.sm-reg small{color:#9fb0c6;margin-top:2px}.sm-reg.sm-off{opacity:.48}.sm-reg.sm-off span{color:#9fb0c6}
      .sm-chain-list{display:grid;gap:7px}.sm-chain-block{border:1px solid #2a4464;border-radius:10px;padding:9px;background:#101f33}.sm-chain-block b{display:block;margin-bottom:5px}.sm-chain-block span{color:#9fb0c6;font-weight:800}.sm-chain-block .sm-hit{display:inline;font-weight:950;margin-left:2px}.sm-chain-block .sm-hit-first{color:#54e58a}.sm-chain-block .sm-hit-other{color:#63c7ff}.sm-chain-block .sm-hit-miss{color:#ff6b6b}
      .sm-pattern-box{border:1px solid #2b4668;border-radius:12px;padding:10px;background:#0a1728}.sm-pattern-row{display:flex;gap:8px;margin:8px 0}.sm-pattern-row input{min-width:0;flex:1;background:#102238;color:#fff;border:1px solid #355275;border-radius:9px;padding:10px;font-size:17px;font-weight:800}.sm-pattern-row button{background:#244d78;color:#fff;border:1px solid #4b78a8;border-radius:9px;padding:8px 14px;font-weight:900}.sm-pattern-summary{margin:8px 0;color:#c7d3e3}.sm-pattern-results{display:grid;grid-template-columns:repeat(5,minmax(0,1fr));gap:6px}.sm-pattern-chip{border:1px solid #355275;border-radius:9px;text-align:center;padding:7px 3px;background:#102238}.sm-pattern-chip b,.sm-pattern-chip strong,.sm-pattern-chip small{display:block}.sm-pattern-chip b{font-size:18px}.sm-pattern-chip strong{color:#ffd75e}.sm-pattern-chip small{color:#9fb0c6;font-size:11px}.sm-line{border-bottom:1px solid #263c58;padding:8px 2px}.sm-balls{display:grid;grid-template-columns:repeat(4,1fr);gap:7px}.sm-ball{border:1px solid #466b48;background:#122c25;border-radius:10px;text-align:center;padding:8px}.sm-ball b{display:block;font-size:24px;color:#8eedaa}.sm-ball small{color:#9fb0c6}.sm-agree{margin-top:12px;border:1px solid #6a6036;background:#2b2712;border-radius:12px;padding:11px;color:#ffe18b}
      .sm-archive{margin-top:12px;border:1px solid #355275;border-radius:12px;background:#0a1728;padding:9px}.sm-archive>summary,.sm-archive-day>summary{cursor:pointer;font-weight:950}.sm-archive-days{display:grid;gap:7px;margin-top:8px}.sm-archive-day{border:1px solid #2b4668;border-radius:10px;padding:8px;background:#101f33}.sm-archive-row{padding:8px 0;border-top:1px solid #263c58}.sm-archive-row:first-of-type{border-top:0}.sm-archive-row>div{display:flex;align-items:center;gap:5px;flex-wrap:wrap;margin-top:5px}.sm-archive-row>div>span:first-child{width:24px}.sm-archive-num{display:inline-flex;align-items:center;gap:2px;border:1px solid #355275;border-radius:8px;padding:4px 6px;background:#102238;font-weight:900}.sm-archive-hit{border-color:#3f8d5a;background:#123023;color:#9af0b3}.sm-archive-hit b{color:#54e58a}
      @media(max-width:420px){.sm-regs{grid-template-columns:repeat(5,1fr)}.sm-reg{font-size:11px}.sm-balls{grid-template-columns:repeat(3,1fr)}}`;
    document.head.appendChild(style);
  }

  let historySyncBusy = false;
  let lastKnownDraw = 0;

  async function syncHistoryFromGithub(forceRender = false) {
    if (historySyncBusy) return;
    historySyncBusy = true;
    try {
      const response = await fetch(`keno-history.json?ts=${Date.now()}`, { cache: 'no-store' });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const fresh = await response.json();
      if (!Array.isArray(fresh) || !fresh.length) return;

      fresh.sort((a, b) => Number(a.draw) - Number(b.draw));
      const freshLast = Number(fresh.at(-1)?.draw || 0);
      const currentLast = Number(Array.isArray(draws) ? draws.at(-1)?.draw : 0) || 0;
      const changed = freshLast > currentLast || fresh.length !== (Array.isArray(draws) ? draws.length : 0);

      if (changed && Array.isArray(draws)) {
        draws.splice(0, draws.length, ...fresh);
        rebuildStateCache();
        lastKnownDraw = freshLast;
        autoForecastData = null;
        await loadAutoForecastData();
        captureLatestForecast();

        if (typeof window.render === 'function') window.render();

        const panel = $('sprintMarathonPanel');
        if (panel?.classList.contains('show')) render(panel.dataset.which || 'marathon');
      } else if (forceRender) {
        const panel = $('sprintMarathonPanel');
        if (panel?.classList.contains('show')) render(panel.dataset.which || 'marathon');
      }
    } catch (_) {
      // Не ломаем приложение при кратком сбое сети: повторим на следующем цикле.
    } finally {
      historySyncBusy = false;
    }
  }

  function startAutoRefresh() {
    if (window.__pozitronSprintMarathonRefresh) clearInterval(window.__pozitronSprintMarathonRefresh);
    lastKnownDraw = Number(Array.isArray(draws) ? draws.at(-1)?.draw : 0) || 0;
    window.__pozitronSprintMarathonRefresh = setInterval(() => syncHistoryFromGithub(false), 60000);

    document.addEventListener('visibilitychange', () => {
      if (!document.hidden) syncHistoryFromGithub(true);
    });
    window.addEventListener('focus', () => syncHistoryFromGithub(true));
    window.addEventListener('online', () => syncHistoryFromGithub(true));
  }

  function start() {
    rebuildStateCache();
    styles();
    inject();
    startAutoRefresh();
    captureLatestForecast();
    setTimeout(() => syncHistoryFromGithub(false), 1500);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once: true });
  else start();
})();
