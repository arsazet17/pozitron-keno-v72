'use strict';
(() => {
  const $ = id => document.getElementById(id);
  const pad = n => String(n).padStart(2, '0');
  const colOf = n => n % 10 || 10;
  const ALGORITHM_VERSION = '2.2.0';
  const FORECAST_ARCHIVE_KEY = 'pozitron_sm_number_archive_v2';
  const FORECAST_ARCHIVE_LIMIT = 2000;
  let selectedDate = '';
  let autoForecastData = null;
  let cacheKey = '';
  let cache = null;

  function safeAnalysis(d) {
    try { return typeof analysis === 'function' ? analysis(d) : {}; }
    catch (_) { return {}; }
  }

  function counts(d) {
    const out = Array(11).fill(0);
    (d?.balls || []).forEach(n => { out[colOf(Number(n))] += 1; });
    return out;
  }

  function winnerLocal(d) {
    const a = safeAnalysis(d);
    if (Number(a?.winner) >= 1 && Number(a?.winner) <= 10) return Number(a.winner);
    const final = counts(d);
    const max = Math.max(...final.slice(1));
    const running = Array(11).fill(0);
    for (const n of d?.balls || []) {
      const c = colOf(Number(n));
      running[c] += 1;
      if (running[c] === max) return c;
    }
    return 1;
  }

  function ensureCache() {
    const list = Array.isArray(draws) ? draws : [];
    const key = `${list.length}:${list.at(-1)?.draw || 0}`;
    if (cache && cacheKey === key) return cache;
    const countCache = list.map(counts);
    const winnerCache = list.map(winnerLocal);
    const stateCache = Array(list.length).fill(null);
    for (let i = 1; i < list.length; i += 1) stateCache[i] = Math.min(4, countCache[i - 1][winnerCache[i]] || 0);
    cache = { countCache, winnerCache, stateCache };
    cacheKey = key;
    return cache;
  }

  function stateBeforeWinner(i) { return ensureCache().stateCache[i] ?? null; }
  function winnerAt(i) { return ensureCache().winnerCache[i] || 1; }
  function stateLabel(s) { return s === 4 ? '4+' : String(s ?? '—'); }

  function sequence(end, len) {
    const out = [];
    for (let i = Math.max(1, end - len + 1); i <= end; i += 1) {
      const s = stateBeforeWinner(i);
      if (s !== null) out.push(s);
    }
    return out;
  }

  function seqSimilarity(aEnd, bEnd, len) {
    const c = ensureCache();
    let score = 0, total = 0, used = 0;
    for (let k = len - 1; k >= 0; k -= 1) {
      const av = c.stateCache[aEnd - k], bv = c.stateCache[bEnd - k];
      if (av === null || bv === null || av === undefined || bv === undefined) continue;
      const w = len - k;
      total += w;
      score += w * (1 - Math.min(1, Math.abs(av - bv) / 4));
      used += 1;
    }
    return used && total ? score / total : 0;
  }

  function countVectorSimilarity(a, b) {
    let diff = 0;
    for (let col = 1; col <= 10; col += 1) diff += Math.abs((a[col] || 0) - (b[col] || 0));
    return Math.max(0, Math.min(1, 1 - diff / 24));
  }

  function recentWinnerRate(col, endIndex, window) {
    const c = ensureCache();
    const start = Math.max(0, endIndex - window + 1);
    let hits = 0;
    for (let i = start; i <= endIndex; i += 1) if (c.winnerCache[i] === col) hits += 1;
    return hits / Math.max(1, endIndex - start + 1);
  }

  function transitionWinnerRate(col, endIndex, window) {
    const c = ensureCache();
    if (endIndex < 2) return 0.10;
    const currentWinner = c.winnerCache[endIndex];
    const start = Math.max(1, endIndex - window + 1);
    let cases = 0, hits = 0;
    for (let i = start; i <= endIndex; i += 1) {
      if (c.winnerCache[i - 1] !== currentWinner) continue;
      cases += 1;
      if (c.winnerCache[i] === col) hits += 1;
    }
    return (hits + 2) / (cases + 20);
  }

  function analogRows(endIndex, typeKey) {
    const c = ensureCache();
    const sprint = typeKey === 'sprint';
    const seqLen = sprint ? 4 : 7;
    const maxLookback = sprint ? 5000 : 12000;
    const start = Math.max(seqLen, endIndex - maxLookback);
    const targetCounts = c.countCache[endIndex];
    const targetWinner = c.winnerCache[endIndex];
    const rows = [];
    for (let i = start; i < endIndex; i += 1) {
      if (endIndex - i <= seqLen + 1) continue;
      const vec = countVectorSimilarity(targetCounts, c.countCache[i]);
      const seq = seqSimilarity(endIndex, i, seqLen);
      const sameWinner = c.winnerCache[i] === targetWinner ? 1 : 0;
      const score = sprint
        ? vec * 0.50 + seq * 0.30 + sameWinner * 0.20
        : vec * 0.42 + seq * 0.43 + sameWinner * 0.15;
      if (score >= (sprint ? 0.48 : 0.52)) rows.push({ index: i, nextIndex: i + 1, score });
    }
    rows.sort((a, b) => b.score - a.score || b.index - a.index);
    return rows.slice(0, sprint ? 90 : 180);
  }

  function modelProbabilities(endIndex, typeKey) {
    const c = ensureCache();
    const sprint = typeKey === 'sprint';
    const rows = analogRows(endIndex, typeKey);
    const hits = Array(11).fill(0);
    let totalWeight = 0;
    rows.forEach((row, rank) => {
      const recency = 0.72 + 0.28 * ((row.index + 1) / Math.max(1, endIndex));
      const rankWeight = Math.max(0.45, 1 - rank / Math.max(100, rows.length * 1.4));
      const weight = Math.pow(row.score, 4) * recency * rankWeight;
      hits[c.winnerCache[row.nextIndex]] += weight;
      totalWeight += weight;
    });
    const prior = 14;
    const probs = Array(11).fill(0);
    for (let col = 1; col <= 10; col += 1) {
      const analogP = (hits[col] + prior * 0.10) / (totalWeight + prior);
      const transitionP = transitionWinnerRate(col, endIndex, sprint ? 220 : 700);
      const recentP = recentWinnerRate(col, endIndex, sprint ? 30 : 240);
      probs[col] = sprint
        ? analogP * 0.74 + transitionP * 0.16 + recentP * 0.10
        : analogP * 0.80 + transitionP * 0.10 + recentP * 0.10;
    }
    const total = probs.slice(1).reduce((a, b) => a + b, 0) || 1;
    for (let col = 1; col <= 10; col += 1) probs[col] /= total;
    const columns = Array.from({ length: 10 }, (_, i) => i + 1).sort((a, b) => probs[b] - probs[a] || a - b);
    return { probs, columns, analogs: rows.length };
  }

  function recentGap(n, endIndex, maxWindow = 40) {
    const start = Math.max(0, endIndex - maxWindow + 1);
    for (let i = endIndex; i >= start; i -= 1) if ((draws[i]?.balls || []).includes(n)) return endIndex - i;
    return maxWindow;
  }

  function numberScore(n, endIndex, typeKey) {
    const lastSet = new Set(draws[endIndex]?.balls || []);
    if (typeKey === 'sprint') {
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
      if (recentGap(n, endIndex, 12) >= 3) score += 0.28;
      return score;
    }
    const r80 = draws.slice(Math.max(0, endIndex - 79), endIndex + 1);
    const r240 = draws.slice(Math.max(0, endIndex - 239), endIndex + 1);
    const rate80 = r80.filter(d => (d?.balls || []).includes(n)).length / Math.max(1, r80.length);
    const rate240 = r240.filter(d => (d?.balls || []).includes(n)).length / Math.max(1, r240.length);
    const half = Math.max(1, Math.floor(r80.length / 2));
    const early = r80.slice(0, half).filter(d => (d?.balls || []).includes(n)).length / half;
    const latePart = r80.slice(half);
    const late = latePart.filter(d => (d?.balls || []).includes(n)).length / Math.max(1, latePart.length);
    const stability = 1 - Math.min(1, Math.abs(rate80 - rate240) * 5);
    let score = rate80 * 1.45 + rate240 * 1.25 + stability * 0.28;
    score += Math.min(0.32, recentGap(n, endIndex, 60) * 0.035);
    score += Math.max(-0.20, Math.min(0.20, late - early)) * 0.70;
    if (lastSet.has(n)) score -= 0.12;
    return score;
  }

  function rankNumbers(columns, endIndex, typeKey) {
    const rows = [];
    for (const col of columns) for (let n = col; n <= 80; n += 10) rows.push({ n, col, score: numberScore(n, endIndex, typeKey) });
    rows.sort((a, b) => b.score - a.score || a.n - b.n);
    const limit = typeKey === 'sprint' ? 6 : 8;
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
    for (const row of rows) {
      if (selected.length >= limit) break;
      if (!selected.some(x => x.n === row.n)) selected.push(row);
    }
    return selected;
  }

  function quickBacktest(endIndex, typeKey, tests = 40) {
    const start = Math.max(260, endIndex - tests);
    let n = 0, first = 0, top4 = 0;
    for (let i = start; i < endIndex; i += 1) {
      const p = modelProbabilities(i, typeKey);
      const cols = p.columns.slice(0, 4);
      const actual = winnerAt(i + 1);
      n += 1;
      if (cols[0] === actual) first += 1;
      if (cols.includes(actual)) top4 += 1;
    }
    const top1Rate = n ? first / n : 0;
    const top4Rate = n ? top4 / n : 0;
    const signal = n < 20 ? 'недостаточно данных' : top4Rate >= 0.52 && top1Rate >= 0.13 ? 'сильный' : top4Rate >= 0.46 ? 'средний' : 'слабый';
    return { tests: n, first, top4, top1Rate, top4Rate, uplift: top4Rate - 0.40, signal };
  }

  function makeModel(endIndex, typeKey, startIndex, cycles) {
    const p = modelProbabilities(endIndex, typeKey);
    const columns = p.columns.slice(0, 4);
    const nums = rankNumbers(columns, endIndex, typeKey);
    const bt = quickBacktest(endIndex, typeKey);
    return {
      algorithmVersion: ALGORITHM_VERSION,
      typeKey,
      name: typeKey === 'sprint' ? 'СПРИНТ' : 'МАРАФОН',
      startIndex,
      endIndex,
      cycles,
      seq: sequence(endIndex, typeKey === 'sprint' ? Math.min(10, endIndex - startIndex + 1) : 10),
      cols: columns.map(col => ({ col, probability: p.probs[col] })),
      nums,
      analogs: p.analogs,
      backtest: bt,
      signal: bt.signal
    };
  }

  function drawStamp(d) {
    const dm = String(d?.date || '').match(/(\d{1,2})[.\/-](\d{1,2})[.\/-](\d{2,4})/);
    const tm = String(d?.time || '').match(/(\d{1,2}):(\d{2})/);
    if (!dm || !tm) return null;
    const y = Number(dm[3]) < 100 ? 2000 + Number(dm[3]) : Number(dm[3]);
    return new Date(y, Number(dm[2]) - 1, Number(dm[1]), Number(tm[1]), Number(tm[2])).getTime();
  }

  function splitIntoCycles(indices) {
    const cycles = [];
    let current = [];
    for (const index of indices) {
      if (!current.length) { current = [index]; continue; }
      const prev = current.at(-1);
      const a = drawStamp(draws[prev]), b = drawStamp(draws[index]);
      const gap = a !== null && b !== null ? Math.round((b - a) / 60000) : 30;
      if (gap > 35 || draws[index]?.date !== draws[prev]?.date || current.length >= 5) {
        cycles.push(current); current = [index];
      } else current.push(index);
    }
    if (current.length) cycles.push(current);
    return cycles;
  }

  function dateIndices(date) {
    const out = [];
    for (let i = 0; i < draws.length; i += 1) if (draws[i]?.date === date) out.push(i);
    return out;
  }
  function availableDates() { return [...new Set(draws.map(d => d?.date).filter(Boolean))].reverse(); }

  function sprintModel(day) {
    const cycles = splitIntoCycles(day);
    const chosenCycles = cycles.slice(-2);
    const chosen = chosenCycles.flat();
    return makeModel(chosen.at(-1), 'sprint', chosen[0], chosenCycles);
  }
  function marathonModel(day) {
    const chosen = day.slice(-40);
    return makeModel(chosen.at(-1), 'marathon', chosen[0], splitIntoCycles(chosen));
  }

  function parseStatePattern(value) {
    return String(value || '').replace(/4\s*\+/gi, '4').split(/[^0-4]+/).filter(Boolean).map(Number).filter(n => n >= 0 && n <= 4);
  }
  function patternStats(pattern, maxIndex) {
    const next = Array(5).fill(0);
    if (!pattern.length) return { total: 0, next };
    for (let end = pattern.length; end < maxIndex; end += 1) {
      const s = sequence(end, pattern.length);
      if (s.length !== pattern.length || !s.every((v, i) => v === pattern[i])) continue;
      const n = stateBeforeWinner(end + 1);
      if (n !== null) next[n] += 1;
    }
    return { total: next.reduce((a, b) => a + b, 0), next };
  }
  function patternHtml(pattern, maxIndex) {
    if (!pattern.length) return '<div class="small">Введите цепочку, например 3 2 2 2.</div>';
    const s = patternStats(pattern, maxIndex);
    if (!s.total) return `<div class="small">Точных случаев после <b>${pattern.map(stateLabel).join('→')}</b> не найдено.</div>`;
    return `<div class="sm-pattern-summary">После <b>${pattern.map(stateLabel).join('→')}</b> · ${s.total} случаев</div><div class="sm-pattern-results">${s.next.map((count, state) => count ? `<div class="sm-pattern-chip"><b>${stateLabel(state)}</b><strong>${Math.round(count * 100 / s.total)}%</strong><small>${count} раз</small></div>` : '').join('')}</div>`;
  }

  function patternFinderHtml(model) {
    return `<div class="section"><span>Поиск выхода после цепочки</span></div><div class="sm-pattern-box"><div class="sm-pattern-row"><input id="smPattern_${model.typeKey}" value="${model.seq.slice(-4).map(stateLabel).join(' ')}"><button id="smPatternBtn_${model.typeKey}" type="button">Найти</button></div><div id="smPatternResult_${model.typeKey}" class="small">Нажмите «Найти».</div></div>`;
  }
  function bindPattern(model) {
    const input = $(`smPattern_${model.typeKey}`), btn = $(`smPatternBtn_${model.typeKey}`), box = $(`smPatternResult_${model.typeKey}`);
    if (!input || !btn || !box) return;
    const run = () => { box.innerHTML = patternHtml(parseStatePattern(input.value), model.endIndex); };
    btn.onclick = run; input.onkeydown = e => { if (e.key === 'Enter') run(); };
  }

  async function loadAutoForecastData() {
    try {
      const r = await fetch(`keno-auto.json?ts=${Date.now()}`, { cache: 'no-store' });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      autoForecastData = await r.json();
    } catch (_) { autoForecastData = null; }
  }

  function forecastMark(type, drawNumber, winnerColumn) {
    const forecasts = Array.isArray(autoForecastData?.forecasts) ? autoForecastData.forecasts : [];
    const f = forecasts.find(x => x?.type === type && Number(x?.targetDraw) === Number(drawNumber));
    if (!f || !Array.isArray(f.columns)) return '';
    const place = f.columns.map(Number).indexOf(Number(winnerColumn));
    if (place === 0) return '<span class="sm-hit sm-hit-first">✓</span>';
    if (place > 0 && place < 4) return '<span class="sm-hit sm-hit-other">✓</span>';
    return '<span class="sm-hit sm-hit-miss">✕</span>';
  }

  function chainBlocksHtml(model) {
    const cycles = model.cycles?.length ? model.cycles : [Array.from({ length: model.endIndex - model.startIndex + 1 }, (_, i) => model.startIndex + i)];
    return cycles.filter(x => x.length).map(cycle => {
      const start = draws[cycle[0]], end = draws[cycle.at(-1)];
      const cols = cycle.map(i => `ст${winnerAt(i)}${forecastMark(model.typeKey, draws[i]?.draw, winnerAt(i))}`).join(' → ');
      const states = cycle.map(i => stateLabel(stateBeforeWinner(i))).join(' → ');
      return `<div class="sm-chain-block"><b>№${start.draw}–№${end.draw} · ${start.time}–${end.time}</b><div><span>Столбцы:</span> ${cols}</div><div><span>Выход:</span> ${states}</div></div>`;
    }).join('');
  }

  function readArchive() {
    try { const x = JSON.parse(localStorage.getItem(FORECAST_ARCHIVE_KEY) || '[]'); return Array.isArray(x) ? x : []; }
    catch (_) { return []; }
  }
  function writeArchive(items) { try { localStorage.setItem(FORECAST_ARCHIVE_KEY, JSON.stringify(items.slice(-FORECAST_ARCHIVE_LIMIT))); } catch (_) {} }
  function saveForecastPair(sprint, marathon) {
    if (!sprint || !marathon || sprint.endIndex !== draws.length - 1 || marathon.endIndex !== draws.length - 1) return;
    const source = draws.at(-1), targetDraw = Number(source?.draw || 0) + 1;
    if (!targetDraw) return;
    const items = readArchive();
    if (items.some(x => Number(x?.targetDraw) === targetDraw)) return;
    items.push({ targetDraw, sourceDraw: Number(source.draw), sourceDate: source.date || '', createdAt: new Date().toISOString(), algorithmVersion: ALGORITHM_VERSION,
      sprintColumns: sprint.cols.map(x => x.col), marathonColumns: marathon.cols.map(x => x.col),
      sprintProbabilities: sprint.cols.map(x => Number((x.probability * 100).toFixed(1))), marathonProbabilities: marathon.cols.map(x => Number((x.probability * 100).toFixed(1))),
      sprintSignal: sprint.signal, marathonSignal: marathon.signal, sprint: sprint.nums.map(x => x.n), marathon: marathon.nums.map(x => x.n) });
    writeArchive(items);
  }
  function actualByDraw(n) { const i = draws.findIndex(d => Number(d?.draw) === Number(n)); return i >= 0 ? { index: i, draw: draws[i] } : null; }
  function archiveNums(nums, set) { return (nums || []).map(n => `<span class="sm-archive-num${set?.has(Number(n)) ? ' sm-archive-hit' : ''}">${pad(n)}${set?.has(Number(n)) ? '<b>✓</b>' : ''}</span>`).join(''); }
  function forecastArchiveHtml() {
    const items = readArchive();
    if (!items.length) return '<details class="sm-archive"><summary>Архив комбинаций</summary><div class="small">Первая запись появится после фиксации прогноза.</div></details>';
    return `<details class="sm-archive"><summary>Архив комбинаций</summary>${items.slice(-40).reverse().map(r => {
      const actual = actualByDraw(r.targetDraw), set = actual ? new Set(actual.draw.balls || []) : null, w = actual ? winnerAt(actual.index) : null;
      const srank = w ? (r.sprintColumns || []).map(Number).indexOf(w) + 1 : 0;
      const mrank = w ? (r.marathonColumns || []).map(Number).indexOf(w) + 1 : 0;
      return `<div class="sm-archive-row"><b>№${r.targetDraw} · ${actual ? `ст${w}` : 'ожидается'}</b><div class="small">🏃 столб: ${srank ? `${srank}-е место ✓` : actual ? 'мимо ✕' : 'ожидается'} · 🐢 столб: ${mrank ? `${mrank}-е место ✓` : actual ? 'мимо ✕' : 'ожидается'}</div><div><span>🏃</span>${archiveNums(r.sprint, set)}</div><div><span>🐢</span>${archiveNums(r.marathon, set)}</div></div>`;
    }).join('')}</details>`;
  }

  function modelHtml(model, icon) {
    const bt = model.backtest;
    const uplift = bt ? Math.round(bt.uplift * 100) : 0;
    const warning = bt && bt.top4Rate < 0.46 ? '<div class="row sm-weak"><b>Слабое подтверждение.</b> По закрытой проверке преимущество над случайной четвёркой небольшое или отсутствует.</div>' : '';
    return `<div class="sm-card"><div class="sm-head">${icon} ${model.name}</div>
      <div class="small">Алгоритм ${model.algorithmVersion} · <b>${model.signal}</b> · аналогов ${model.analogs}</div>
      <div class="row"><b>Честная проверка:</b> 1-е место ${bt.first}/${bt.tests} (${Math.round(bt.top1Rate * 100)}%) · в четвёрке ${bt.top4}/${bt.tests} (${Math.round(bt.top4Rate * 100)}%) · случайная база четвёрки 40% · разница ${uplift >= 0 ? '+' : ''}${uplift} п.п.</div>
      ${warning}<div class="sm-seq">${model.seq.map(stateLabel).join('→')}</div>${patternFinderHtml(model)}
      <div class="section"><span>Цепочки тиражей</span></div><div class="sm-chain-list">${chainBlocksHtml(model)}</div>
      <div class="section"><span>Выход №${Number(draws[model.endIndex]?.draw || 0) + 1}</span></div>
      ${model.cols.map((x, i) => `<div class="sm-line"><b>${i + 1}. ст${x.col}</b> · <b>${(x.probability * 100).toFixed(1)}%</b><br><span class="small">процент среди всех 10 столбов; четыре показанных процента не обязаны давать 100%</span></div>`).join('')}
      <div class="section"><span>Комбинация чисел</span></div><div class="sm-balls">${model.nums.map(x => `<div class="sm-ball"><b>${pad(x.n)}</b><small>ст${x.col}</small></div>`).join('')}</div></div>`;
  }

  function agreementHtml(a, b) {
    const ac = new Set(a.cols.map(x => x.col)), bc = new Set(b.cols.map(x => x.col));
    const cols = [...ac].filter(x => bc.has(x));
    const an = new Set(a.nums.map(x => x.n)), bn = new Set(b.nums.map(x => x.n));
    const nums = [...an].filter(x => bn.has(x));
    return `<div class="sm-agree"><b>Совпадение Спринта и Марафона</b><br>Столбцы: ${cols.length ? cols.map(c => `ст${c}`).join(' · ') : 'нет'}<br>Числа: ${nums.length ? nums.map(pad).join(' · ') : 'нет'}<br><span class="small">Проценты теперь считаются по всем 10 столбам и не являются внутренними баллами.</span></div>`;
  }

  function render(which) {
    const box = $('sprintMarathonResult');
    if (!box) return;
    if (!Array.isArray(draws) || draws.length < 300) { box.innerHTML = '<div class="row">Для честной модели нужно минимум 300 тиражей.</div>'; return; }
    const dates = availableDates();
    if (!selectedDate || !dates.includes(selectedDate)) selectedDate = dates[0] || '';
    const day = dateIndices(selectedDate);
    const selector = `<div class="sm-date-row"><b>День анализа</b><select id="smDateSelect">${dates.map(d => `<option value="${d}"${d === selectedDate ? ' selected' : ''}>${d}</option>`).join('')}</select></div>`;
    if (!day.length) { box.innerHTML = selector + '<div class="row">За выбранный день тиражей нет.</div>'; return; }
    box.innerHTML = selector + '<div class="row">⏳ Пересчитываю честные вероятности…</div>';
    setTimeout(async () => {
      await loadAutoForecastData();
      const sprint = sprintModel(day), marathon = marathonModel(day);
      saveForecastPair(sprint, marathon);
      const content = which === 'sprint' ? modelHtml(sprint, '🏃') : which === 'marathon' ? modelHtml(marathon, '🐢') : modelHtml(sprint, '🏃') + modelHtml(marathon, '🐢') + agreementHtml(sprint, marathon);
      box.innerHTML = selector + `<div class="small sm-day-count">За ${selectedDate}: ${day.length} тиражей.</div>` + content + forecastArchiveHtml();
      const sel = $('smDateSelect'); if (sel) sel.onchange = e => { selectedDate = e.target.value; render(which); };
      if (which === 'sprint') bindPattern(sprint); else if (which === 'marathon') bindPattern(marathon); else { bindPattern(sprint); bindPattern(marathon); }
    }, 20);
  }

  function inject() {
    const sprintButton = $('sprintBtn'), marathonButton = $('marathonBtn'), panel = $('sprintMarathonPanel');
    if (!sprintButton || !marathonButton || !panel) return;
    const toggle = which => {
      const open = !panel.classList.contains('show') || panel.dataset.which !== which;
      panel.classList.toggle('show', open); panel.dataset.which = open ? which : '';
      if (open) { render(which); panel.scrollIntoView({ behavior: 'smooth', block: 'start' }); }
    };
    sprintButton.onclick = () => toggle('sprint'); marathonButton.onclick = () => toggle('marathon');
  }

  function styles() {
    if ($('sprintMarathonStylesV22')) return;
    const style = document.createElement('style'); style.id = 'sprintMarathonStylesV22';
    style.textContent = `.sm-title,.sm-head{font-size:20px;font-weight:950}.sm-date-row{display:flex;align-items:center;justify-content:space-between;gap:10px;margin:10px 0}.sm-date-row select{background:#102238;color:#fff;border:1px solid #355275;border-radius:10px;padding:10px 12px;font-weight:900;max-width:58%}.sm-card{border:1px solid #2b4668;border-radius:14px;padding:12px;margin-top:10px;background:#0e1d30}.sm-weak{border:1px solid #8a642d;background:#30230f;color:#ffd98a}.sm-seq{font-size:25px;font-weight:950;color:#83e6a5;letter-spacing:1px;overflow-wrap:anywhere;margin:8px 0}.sm-chain-list{display:grid;gap:7px}.sm-chain-block{border:1px solid #2a4464;border-radius:10px;padding:9px;background:#101f33}.sm-chain-block span{color:#9fb0c6;font-weight:800}.sm-line{border:1px solid #355275;border-radius:10px;padding:9px;margin:6px 0;background:#102238}.sm-balls{display:flex;flex-wrap:wrap;gap:7px}.sm-ball{min-width:52px;text-align:center;border:1px solid #466b48;background:#122c25;border-radius:10px;padding:7px}.sm-ball b,.sm-ball small{display:block}.sm-agree{border:1px solid #4b6f46;background:#12291e;border-radius:12px;padding:10px;margin-top:10px}.sm-hit{margin-left:2px}.sm-hit-first,.sm-hit-other{color:#72df95}.sm-hit-miss{color:#ff8f98}.sm-pattern-row{display:grid;grid-template-columns:1fr auto;gap:6px}.sm-pattern-results{display:flex;flex-wrap:wrap;gap:6px;margin-top:7px}.sm-pattern-chip{border:1px solid #355275;border-radius:9px;padding:6px 9px}.sm-pattern-chip b,.sm-pattern-chip strong,.sm-pattern-chip small{display:block}.sm-archive{margin-top:12px}.sm-archive-row{border:1px solid #2a4464;border-radius:10px;padding:9px;margin-top:7px}.sm-archive-num{display:inline-block;margin:3px;padding:4px 6px;border:1px solid #355275;border-radius:7px}.sm-archive-hit{border-color:#43d77b;background:#123a28;color:#c9ffda}`;
    document.head.appendChild(style);
  }

  function start() { styles(); inject(); }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once: true }); else start();
})();
