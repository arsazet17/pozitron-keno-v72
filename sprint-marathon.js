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
  const FORECAST_ARCHIVE_KEY = 'pozitron_sm_number_archive_v2';
  const FORECAST_ARCHIVE_LIMIT = 2000;

  function rebuildStateCache() {
    const list = Array.isArray(draws) ? draws : [];
    winnerCache = new Array(list.length);
    stateCache = new Array(list.length).fill(null);
    const drawCounts = new Array(list.length);
    for (let i = 0; i < list.length; i += 1) {
      drawCounts[i] = counts(list[i]);
      winnerCache[i] = Number(safeAnalysis(list[i]).winner) || 1;
    }
    for (let i = 1; i < list.length; i += 1) {
      stateCache[i] = Math.min(4, drawCounts[i - 1][winnerCache[i]] || 0);
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

  function normalizeByAvailability(raw, endIndex) {
    const available = currentAvailability(endIndex);
    const filtered = raw.map((v, state) => available[state].length ? Math.max(0, v) : 0);
    const total = filtered.reduce((a, b) => a + b, 0);
    const probs = total
      ? filtered.map(v => v / total)
      : available.map(cols => cols.length ? 1 : 0);
    const fallbackTotal = probs.reduce((a, b) => a + b, 0);
    const finalProbs = fallbackTotal ? probs.map(v => v / fallbackTotal) : Array(5).fill(0);
    return { probs: finalProbs, available };
  }

  function analogForecast(seq, minIndex, maxIndex, endIndex) {
    const support = Array(5).fill(0);
    const stats = { exact: 0, near: 0, switchCases: 0, weight: 0 };

    // 80% — текущая цепочка и переключения; 20% — общая архивная частота.
    addSuffixEvidence(seq, minIndex, maxIndex, support, stats);
    addSwitchEvidence(seq, minIndex, maxIndex, support, stats);
    addHistoricalBaseline(support, minIndex, maxIndex, Math.max(0.35, stats.weight * 0.25));

    const rawTotal = support.reduce((a, b) => a + b, 0);
    const rawProbs = support.map(v => rawTotal ? v / rawTotal : 0);
    const feasible = normalizeByAvailability(rawProbs, endIndex);
    const order = [0, 1, 2, 3, 4].sort((a, b) => feasible.probs[b] - feasible.probs[a] || a - b);

    return {
      support,
      rawProbs,
      probs: feasible.probs,
      available: feasible.available,
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

  function marathonNumberScore(n, col, window, endIndex, sprintSet) {
    const lastSet = new Set(draws[endIndex]?.balls || []);
    const start = Math.max(0, endIndex - window + 1);
    const recent = draws.slice(start, endIndex + 1);
    const hits = recent.filter(d => (d?.balls || []).includes(n)).length;
    const gap = recentGap(n, endIndex, Math.max(12, window));
    const half = Math.max(1, Math.floor(recent.length / 2));
    const earlyHits = recent.slice(0, half).filter(d => (d?.balls || []).includes(n)).length;
    const lateHits = recent.slice(half).filter(d => (d?.balls || []).includes(n)).length;
    let freshReturns = 0;

    for (let i = Math.max(start + 1, 1); i <= endIndex; i += 1) {
      const before = new Set(draws[i - 1]?.balls || []);
      const current = new Set(draws[i]?.balls || []);
      if (!before.has(n) && current.has(n)) freshReturns += 1;
    }

    let score = 0;
    // Марафон смотрит длинную историю, возвраты и пропуски, а не копирует Спринт.
    score += (hits / Math.max(1, recent.length)) * 0.90;
    score += Math.min(1.20, gap / 10);
    score += Math.min(0.75, freshReturns * 0.12);
    if (lateHits > earlyHits) score += 0.30;
    if (lastSet.has(n)) score -= 0.28;
    if (sprintSet.has(n)) score -= 0.65;

    return { score, reasons: [] };
  }

  function rankColumns(pred, window, endIndex) {
    const current = counts(draws[endIndex]);
    const rows = [];

    for (let col = 1; col <= 10; col += 1) {
      const state = Math.min(4, current[col]);
      const regime = pred.probs[state] || 0;
      let shape = 0;
      const reasons = [];
      const nums = (draws[endIndex].balls || []).filter(n => colOf(n) === col);

      if (state === 0) { shape += 0.20; reasons.push('столб сейчас в пустоте'); }
      if (state === 1) { shape += 0.35; reasons.push('одиночный каркас'); }
      if (state === 2) { shape += 0.50; reasons.push('двойной каркас'); }
      if (state === 3) { shape += 0.45; reasons.push('тройной каркас'); }
      if (state === 4) { shape += 0.38; reasons.push('плотный каркас'); }
      if (nums.some(n => nums.includes(n + 10))) { shape += 0.30; reasons.push('вертикальная связка'); }

      const history = draws.slice(Math.max(0, endIndex - window + 1), endIndex + 1).map(d => counts(d)[col]);
      const trend = history.at(-1) - (history[0] || 0);
      if (trend > 0) { shape += 0.20; reasons.push('набор плотности'); }

      const streak = winnerStreak(col, endIndex);
      if (streak >= 1) {
        shape += Math.min(0.45, 0.18 + streak * 0.10);
        reasons.push(streak > 1 ? `серия побед ${streak}` : 'победитель прошлого тиража');
      }

      const preserved = preservedWinnerFrame(col, endIndex);
      if (preserved > 0 && endIndex > 0 && winnerAt(endIndex - 1) === col) {
        shape += Math.min(0.35, preserved * 0.12);
        reasons.push(`сохранён каркас ${preserved}`);
      }

      rows.push({ col, state, score: regime * 3 + shape, reasons, regime });
    }

    return rows.sort((a, b) => b.score - a.score || b.regime - a.regime || a.col - b.col);
  }

  function pickNumbers(rows, limit, options = {}) {
    const lastSet = new Set(draws[options.endIndex]?.balls || []);
    const avoidSet = options.avoidSet || new Set();
    const maxRepeats = Number.isFinite(options.maxRepeats) ? options.maxRepeats : limit;
    const maxOverlap = Number.isFinite(options.maxOverlap) ? options.maxOverlap : limit;
    const selected = [];
    let repeats = 0;
    let overlaps = 0;

    for (const row of rows) {
      if (selected.length >= limit) break;
      const isRepeat = lastSet.has(row.n);
      const isOverlap = avoidSet.has(row.n);
      if (isRepeat && repeats >= maxRepeats) continue;
      if (isOverlap && overlaps >= maxOverlap) continue;
      selected.push(row);
      if (isRepeat) repeats += 1;
      if (isOverlap) overlaps += 1;
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

  function rankMarathonNumbers(cols, window, endIndex, sprintNums = []) {
    const sprintSet = new Set(sprintNums.map(x => Number(x?.n ?? x)));
    const rows = [];
    for (const col of cols) {
      for (let n = col; n <= 80; n += 10) rows.push({ n, col, ...marathonNumberScore(n, col, window, endIndex, sprintSet) });
    }
    rows.sort((a, b) => b.score - a.score || a.n - b.n);
    return pickNumbers(rows, 8, { endIndex, maxRepeats: 2, avoidSet: sprintSet, maxOverlap: 2 });
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
    const ranked = rankColumns(pred, 8, end);
    const cols = ranked.slice(0, 4);
    const nums = rankSprintNumbers(cols.map(x => x.col), end);
    return {
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

  function marathonModel(dayIndices, sprintNums = []) {
    const chosen = dayIndices.slice(-40);
    const end = chosen.at(-1);
    const start = chosen[0];
    const seq = chosen.map(i => stateBeforeWinner(i)).filter(v => v !== null);
    const tail = seq.slice(-10);
    const pred = analogForecast(tail, 1, end - 1, end);
    const ranked = rankColumns(pred, Math.min(40, chosen.length), end);
    const cols = ranked.slice(0, 6);
    const nums = rankMarathonNumbers(cols.map(x => x.col), Math.min(40, chosen.length), end, sprintNums);
    return { name: 'МАРАФОН', seq, pred, cols, nums, type: classify(seq), window: chosen.length, startIndex: start, endIndex: end, typeKey: 'marathon' };
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
    const dm = String(d?.date || '').match(/(\d{1,2})[.\/-](\d{1,2})[.\/-](\d{4})/);
    const tm = String(d?.time || '').match(/(\d{1,2}):(\d{2})/);
    if (!dm || !tm) return null;
    return new Date(Number(dm[3]), Number(dm[2]) - 1, Number(dm[1]), Number(tm[1]), Number(tm[2])).getTime();
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
      const marathon = marathonModel(day, sprint.nums);
      saveForecastPair(sprint, marathon);
    } catch (_) {
      // Не мешаем основному приложению, если архив временно не смог обновиться.
    }
  }

  function modelHtml(model, icon) {
    const changes = model.seq.slice(1).filter((x, i) => x !== model.seq[i]).length;
    return `<div class="sm-card">
      <div class="sm-head">${icon} ${model.name}</div>
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
      const marathon = marathonModel(day, sprint.nums);
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
    if ($('sprintMarathonPanel')) return;
    const info = document.querySelector('button[data-panel="infoPanel"]');
    if (!info) return;

    const holder = document.createElement('div');
    holder.className = 'sm-split';
    holder.innerHTML = '<button id="sprintBtn" class="tool" type="button" aria-label="Спринт">🏃</button><button id="marathonBtn" class="tool" type="button" aria-label="Марафон">🐢</button>';
    info.replaceWith(holder);

    const panel = document.createElement('section');
    panel.id = 'sprintMarathonPanel';
    panel.className = 'card panel';
    panel.innerHTML = '<div class="sm-title">🏃 Спринт / 🐢 Марафон</div><div id="sprintMarathonResult"></div>';
    const search = $('searchPanel');
    search?.parentNode?.insertBefore(panel, search);

    const toggle = which => {
      const open = !panel.classList.contains('show') || panel.dataset.which !== which;
      panel.classList.toggle('show', open);
      panel.dataset.which = open ? which : '';
      if (open) {
        render(which);
        panel.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }
    };

    $('sprintBtn').onclick = () => toggle('sprint');
    $('marathonBtn').onclick = () => toggle('marathon');
  }

  function styles() {
    if ($('sprintMarathonStyles')) return;
    const style = document.createElement('style');
    style.id = 'sprintMarathonStyles';
    style.textContent = `
      .sm-split{display:grid;grid-template-columns:1fr 1fr;gap:6px}.sm-split .tool{font-size:28px;padding:10px 4px;min-width:0}
      .sm-title,.sm-head{font-size:20px;font-weight:950}.sm-date-row{display:flex;align-items:center;justify-content:space-between;gap:10px;margin:10px 0}.sm-date-row select{background:#102238;color:#fff;border:1px solid #355275;border-radius:10px;padding:10px 12px;font-weight:900;font-size:16px;max-width:58%}.sm-day-count{margin:6px 0 10px;color:#9fb0c6}.sm-card{border:1px solid #2b4668;border-radius:14px;padding:12px;margin-top:10px;background:#0e1d30}
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
