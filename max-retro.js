'use strict';
(() => {
  const $ = id => document.getElementById(id);
  const MODULE_ID = 'maxRetroPanel';
  const BUTTON_ID = 'maxRetroToolBtn';
  const RESULT_ID = 'maxRetroResult';
  const RUN_ID = 'runMaxRetroBtn';
  const LIMIT_ID = 'maxRetroLimit';
  const WINDOW_ID = 'maxRetroWindow';
  const HISTORY_KEY = 'pozitronMaxRetroForecastsV72';
  const pad2 = n => String(n).padStart(2, '0');
  const colOf = n => n % 10 || 10;
  const rangeOf = n => Math.floor((n - 1) / 4);
  const rangeLabel = r => `${r * 4 + 1}–${r * 4 + 4}`;
  const clamp01 = v => Math.max(0, Math.min(1, Number(v) || 0));
  const simPct = v => `${Math.round(clamp01(v) * 100)}%`;

  function safeAnalysis(d) {
    try { return typeof analysis === 'function' ? analysis(d) : {}; }
    catch (_) { return {}; }
  }
  function realWinner(d) {
    const a = safeAnalysis(d);
    if (Number(a?.winner) >= 1 && Number(a?.winner) <= 10) return Number(a.winner);
    const count = Array(11).fill(0), reach = Array(11).fill(999);
    (d?.balls || []).forEach(n => count[colOf(Number(n))]++);
    const max = Math.max(...count.slice(1));
    for (let c = 1; c <= 10; c++) if (count[c] === max) {
      let seen = 0;
      for (let i = 0; i < (d?.balls || []).length; i++) {
        if (colOf(Number(d.balls[i])) === c) seen++;
        if (seen === max) { reach[c] = i; break; }
      }
    }
    let w = 1;
    for (let c = 2; c <= 10; c++) if (count[c] > count[w] || (count[c] === count[w] && reach[c] < reach[w])) w = c;
    return w;
  }

  function transitionSet(index) {
    if (index <= 0) return new Set();
    if (typeof transitions === 'function') return transitions(index);
    const prev = new Set(draws[index - 1]?.balls || []);
    return new Set((draws[index]?.balls || []).filter(n => prev.has(n)));
  }
  function occupancy(index) {
    const out = Array(20).fill(0);
    (draws[index]?.balls || []).forEach(n => out[rangeOf(Number(n))]++);
    return out;
  }
  function movement(index) {
    if (index <= 0) return Array(20).fill(0);
    const a = occupancy(index - 1), b = occupancy(index);
    return b.map((v, i) => Math.sign(v - a[i]));
  }
  function pattern(index) {
    const out = Array(20).fill(0);
    (draws[index]?.balls || []).forEach(n => { const x = Number(n); out[rangeOf(x)] |= 1 << ((x - 1) % 4); });
    return out;
  }
  function vectorSimilarity(a, b) {
    const len = Math.max(a.length, b.length); let diff = 0, max = 0;
    for (let i = 0; i < len; i++) { diff += Math.abs((a[i] || 0) - (b[i] || 0)); max += Math.max(1, Math.abs(a[i] || 0), Math.abs(b[i] || 0)); }
    return max ? clamp01(1 - diff / max) : 1;
  }
  function setSimilarity(a, b) {
    const A = new Set(a || []), B = new Set(b || []), U = new Set([...A, ...B]);
    if (!U.size) return 1; let hit = 0; A.forEach(x => { if (B.has(x)) hit++; }); return hit / U.size;
  }
  function patternSimilarity(a, b) {
    let score = 0;
    const bits = x => (x >>> 0).toString(2).split('1').length - 1;
    for (let i = 0; i < 20; i++) {
      if (a[i] === b[i]) score += 1;
      else { const inter = a[i] & b[i], union = a[i] | b[i]; score += union ? bits(inter) / bits(union) : 1; }
    }
    return score / 20;
  }
  function windowFeatures(endIndex, windowSize) {
    const start = Math.max(1, endIndex - windowSize + 1);
    const transitionCounts = [], allTransitions = [], columns = [], rangeFlow = Array(20).fill(0), move = Array(20).fill(0);
    for (let i = start; i <= endIndex; i++) {
      const pass = [...transitionSet(i)]; transitionCounts.push(pass.length); allTransitions.push(...pass); columns.push(...pass.map(colOf));
      pass.forEach(n => rangeFlow[rangeOf(n)]++); movement(i).forEach((v, r) => move[r] += v);
    }
    const info = safeAnalysis(draws[endIndex]);
    return { endIndex, transitionCounts, currentPass: [...transitionSet(endIndex)], allTransitions, columns, rangeFlow, occupancy: occupancy(endIndex), movement: move, pattern: pattern(endIndex), single: info.single || [], empty: info.empty || [] };
  }
  function compare(a, b) {
    const currentTransitions = setSimilarity(a.currentPass, b.currentPass);
    const rhythm = vectorSimilarity(a.transitionCounts, b.transitionCounts);
    const columns = setSimilarity(a.columns, b.columns);
    const ranges = vectorSimilarity(a.rangeFlow, b.rangeFlow);
    const occ = vectorSimilarity(a.occupancy, b.occupancy);
    const move = vectorSimilarity(a.movement, b.movement);
    const pat = patternSimilarity(a.pattern, b.pattern);
    const shape = (setSimilarity(a.single, b.single) + setSimilarity(a.empty, b.empty)) / 2;
    const score = currentTransitions * .27 + occ * .22 + rhythm * .16 + columns * .12 + ranges * .10 + move * .06 + pat * .04 + shape * .03;
    return { score, currentTransitions, rhythm, columns, ranges, occ, move, pat, shape };
  }

  function buildForecast(rows, targetIndex) {
    const currentBalls = new Set(draws[targetIndex]?.balls || []);
    const numberCases = Array(81).fill(0), numberWeight = Array(81).fill(0), rangeCases = Array(20).fill(0), rangeWeight = Array(20).fill(0);
    rows.forEach((row, rank) => {
      const source = new Set(draws[row.index]?.balls || []), next = draws[row.nextIndex];
      const nextTransitions = (next?.balls || []).filter(n => source.has(n));
      const before = occupancy(row.index), after = occupancy(row.nextIndex);
      const rankWeight = Math.max(.45, 1 - rank / Math.max(20, rows.length * 1.2));
      const weight = Math.pow(row.score, 3) * rankWeight;
      nextTransitions.forEach(n => { numberCases[n]++; numberWeight[n] += weight; });
      for (let r = 0; r < 20; r++) if (after[r] > before[r]) { rangeCases[r]++; rangeWeight[r] += weight; }
    });
    const numbers = [...currentBalls].sort((a, b) => numberCases[b] - numberCases[a] || numberWeight[b] - numberWeight[a] || a - b).slice(0, 12);
    const ranges = Array.from({ length: 20 }, (_, i) => i).sort((a, b) => rangeCases[b] - rangeCases[a] || rangeWeight[b] - rangeWeight[a] || a - b).slice(0, 6);
    return { numbers, ranges, numberCases, rangeCases };
  }

  function loadHistory() { try { const x = JSON.parse(localStorage.getItem(HISTORY_KEY) || '[]'); return Array.isArray(x) ? x : []; } catch (_) { return []; } }
  function saveHistory(x) { try { localStorage.setItem(HISTORY_KEY, JSON.stringify(x.slice(-50))); } catch (_) {} }
  function remember(baseDraw, forecast, windowSize, limit) {
    const history = loadHistory(), targetDraw = Number(baseDraw) + 1;
    const item = { baseDraw: Number(baseDraw), targetDraw, numbers: forecast.numbers.slice(), ranges: forecast.ranges.slice(), windowSize, limit, savedAt: new Date().toISOString() };
    const i = history.findIndex(x => Number(x.baseDraw) === Number(baseDraw)); if (i >= 0) history[i] = item; else history.push(item); saveHistory(history);
  }
  function verificationHtml() {
    const rows = loadHistory().map(saved => {
      const baseIndex = draws.findIndex(d => Number(d.draw) === Number(saved.baseDraw));
      const actualIndex = draws.findIndex(d => Number(d.draw) === Number(saved.targetDraw));
      if (baseIndex < 0 || actualIndex < 0) return null;
      const base = new Set(draws[baseIndex].balls || []), actual = new Set(draws[actualIndex].balls || []);
      const transitions = [...actual].filter(n => base.has(n));
      const hits = (saved.numbers || []).filter(n => transitions.includes(n));
      return { saved, transitions, hits };
    }).filter(Boolean).sort((a, b) => b.saved.baseDraw - a.saved.baseDraw);
    if (!rows.length) return '';
    const x = rows[0];
    return `<div class="section"><span>Проверка прошлого прогноза</span></div><div class="row"><b>№${x.saved.baseDraw} → №${x.saved.targetDraw}</b><div class="small">Факт переходов: ${x.transitions.length ? x.transitions.map(pad2).join(' ') : 'нет'}</div><div><b>Совпало ${x.hits.length}/${x.saved.numbers.length}</b></div></div>`;
  }

  function renderRetro() {
    const box = $(RESULT_ID); if (!box) return;
    if (!Array.isArray(draws) || draws.length < 80) { box.innerHTML = '<div class="row small">Нужно минимум 80 тиражей.</div>'; return; }
    const limit = Math.max(8, Math.min(40, Number($(LIMIT_ID)?.value || 16)));
    const windowSize = Math.max(2, Math.min(8, Number($(WINDOW_ID)?.value || 5)));
    const targetIndex = draws.length - 1, target = windowFeatures(targetIndex, windowSize), rows = [];
    for (let i = windowSize; i < targetIndex; i++) {
      if (targetIndex - i < windowSize + 1) continue;
      const r = compare(target, windowFeatures(i, windowSize)); rows.push({ index: i, nextIndex: i + 1, ...r });
    }
    rows.sort((a, b) => b.score - a.score || b.index - a.index);
    const top = rows.slice(0, limit); if (!top.length) { box.innerHTML = '<div class="row">Аналоги не найдены.</div>'; return; }
    const forecast = buildForecast(top, targetIndex); remember(draws[targetIndex].draw, forecast, windowSize, limit);
    const cards = forecast.numbers.map((n, i) => {
      const p = (forecast.numberCases[n] + 1) / (top.length + 2);
      return `<div class="tr-number-card"><div class="small">${i + 1} место · ${forecast.numberCases[n]} из ${top.length} аналогов</div><div class="tr-number">${pad2(n)}</div><div><b>${Math.round(p * 100)}%</b> архивной доли</div></div>`;
    }).join('');
    const rangeCards = forecast.ranges.map(r => `<span><b>${rangeLabel(r)}</b> · ${Math.round((forecast.rangeCases[r] + 1) / (top.length + 2) * 100)}%</span>`).join('');
    const analogs = top.slice(0, 12).map((row, rank) => {
      const old = draws[row.index], next = draws[row.nextIndex];
      return `<div class="tr-analog"><div class="tr-analog-head"><b>${rank + 1}. №${old.draw} 🔴 ст${realWinner(old)}</b><strong>${simPct(row.score)} сходство</strong></div><div class="small">Переходы тогда: ${[...transitionSet(row.index)].map(pad2).join(' ') || 'нет'}</div><div class="tr-next">➡ №${next.draw}: 🔴 ст${realWinner(next)} · переходы ${[...transitionSet(row.nextIndex)].map(pad2).join(' ') || 'нет'}</div></div>`;
    }).join('');
    box.innerHTML = `<div class="row"><b>Текущий №${draws[targetIndex].draw}</b><br><span class="small">Сравнено ${rows.length.toLocaleString('ru-RU')} ситуаций · взято ${top.length}. Красный столб теперь всегда настоящий победивший столб.</span></div>${verificationHtml()}<div class="section"><span>🧠 Продолжение переходов</span></div><div class="tr-grid">${cards}</div><div class="row small"><b>Важно:</b> процент — доля исторических аналогов, где число реально перешло дальше. Это не относительный вес от лидера и не гарантия.</div><div class="section"><span>Диапазоны заполнения</span></div><div class="freq">${rangeCards}</div><div class="section"><span>Лучшие ретроаналоги</span></div>${analogs}`;
  }

  function plusColumnProbabilities(calculated) {
    const n = calculated?.top?.length || 0;
    const denom = n + 10;
    const out = Array(11).fill(0);
    for (let c = 1; c <= 10; c++) out[c] = ((calculated?.support?.[c]?.count || 0) + 1) / denom;
    return out;
  }
  function honestRunPlus() {
    const box = $('plusResult'); if (!box) return;
    if (!Array.isArray(draws) || draws.length < 50 || typeof buildPlusPrediction !== 'function') { box.innerHTML = '<div class="row">Недостаточно данных.</div>'; return; }
    const targetEnd = draws.length - 1, calculated = buildPlusPrediction(targetEnd); if (!calculated) { box.innerHTML = '<div class="row">Группа аналогов не найдена.</div>'; return; }
    const latest = draws[targetEnd], targetDraw = Number(latest.draw) + 1;
    const saved = typeof savePlusPrediction === 'function' ? savePlusPrediction(targetDraw, calculated, latest.draw) : { record: calculated, created: true };
    const p = saved.record, probs = plusColumnProbabilities(calculated), top4mass = p.columns.reduce((s, c) => s + probs[c], 0);
    box.innerHTML = `<div class="row"><b>Прогноз только на №${targetDraw}</b><br><span class="small">${saved.created ? 'Зафиксирован сейчас' : 'Уже был зафиксирован'} · аналогов ${calculated.top.length}. Проценты ниже считаются среди всех 10 столбов.</span></div><div class="section"><span>Четыре основных столба</span></div><div class="tools" style="grid-template-columns:1fr 1fr">${p.columns.map((c, i) => `<div class="tool" style="text-align:center"><div class="small">${i + 1} место</div><div style="font-size:25px;font-weight:950;color:#ffd45b">ст${c}</div><div><b>${(probs[c] * 100).toFixed(1)}%</b></div><div class="small">${calculated.support[c].count} из ${calculated.top.length} аналогов</div></div>`).join('')}</div><div class="row ${top4mass < .46 ? 'check-bad' : ''}"><b>Суммарная архивная доля четвёрки: ${(top4mass * 100).toFixed(1)}%</b><br><span class="small">Случайная база для четырёх из десяти столбов — 40%. Это сравнение полезнее старого «100% уверенности».</span></div><div class="section"><span>Почему выбраны столбы</span></div>${p.columns.map(c => `<div class="row"><b>ст${c}</b> · ${(calculated.reasons?.[c] || []).join(' · ')}</div>`).join('')}<div class="section"><span>Наиболее вероятные числа</span></div><div class="numbers">${p.numbers.map(n => `<div class="ball">${pad2(n)}</div>`).join('')}</div><div class="section"><span>Сборки К5</span></div><div class="row">${p.k1.map(pad2).join(' · ')}</div><div class="row">${p.k2.map(pad2).join(' · ')}</div>`;
    if (typeof renderLivePredictionCheck === 'function') renderLivePredictionCheck();
    if (typeof renderPredictionHistory === 'function') renderPredictionHistory();
  }
  async function honestQualityAudit() {
    const box = $('qualityResult'); if (!box) return;
    if (!Array.isArray(draws) || draws.length < 120 || typeof buildPlusPrediction !== 'function') { box.innerHTML = '<div class="row">Для проверки нужно минимум 120 тиражей.</div>'; return; }
    const btn = $('qualityBtn'); if (btn) { btn.disabled = true; btn.textContent = '⏳ Проверяю…'; }
    box.innerHTML = '<div class="row small">Проверяю без заглядывания в будущее…</div>';
    await new Promise(r => setTimeout(r, 30));
    try {
      const start = Math.max(80, draws.length - 41); let n = 0, first = 0, top4 = 0;
      for (let i = start; i < draws.length - 1; i++) {
        const p = buildPlusPrediction(i); if (!p) continue; const w = realWinner(draws[i + 1]); n++; if (p.columns[0] === w) first++; if (p.columns.includes(w)) top4++;
        if (n % 5 === 0) await new Promise(r => setTimeout(r, 0));
      }
      const p1 = n ? first / n : 0, p4 = n ? top4 / n : 0;
      box.innerHTML = `<div class="section"><span>📊 Честная проверка качества</span></div><div class="row"><b>${n} прошлых прогнозов</b><br>1-е место: ${first}/${n} (${Math.round(p1 * 100)}%) · случайная база 10%<br>В четвёрке: ${top4}/${n} (${Math.round(p4 * 100)}%) · случайная база 40%<br><b>Разница к базе четвёрки: ${p4 >= .4 ? '+' : ''}${Math.round((p4 - .4) * 100)} п.п.</b></div><div class="row small">Это фактическая проверка прошлых прогнозов. Композитный «процент уверенности» больше не показывается как вероятность.</div>`;
    } finally { if (btn) { btn.disabled = false; btn.textContent = '📊 Проверить качество на прошлом'; } }
  }

  function injectStyles() {
    if ($('maxRetroStylesV22')) return;
    const s = document.createElement('style'); s.id = 'maxRetroStylesV22'; s.textContent = `.tr-grid{display:grid;grid-template-columns:repeat(2,1fr);gap:7px}.tr-number-card{border:1px solid #466b48;background:#122c25;border-radius:11px;padding:10px;text-align:center}.tr-number{font-size:27px;font-weight:950;color:#8eedaa}.tr-analog{background:#101f33;border:1px solid #2a4464;border-radius:11px;padding:10px;margin-top:8px}.tr-analog-head{display:flex;justify-content:space-between;gap:8px}.tr-analog-head strong{color:#8eedaa}.tr-next{margin-top:6px;font-weight:900;color:#ffd35c}@media(min-width:620px){.tr-grid{grid-template-columns:repeat(4,1fr)}}`; document.head.appendChild(s);
  }
  function injectInterface() {
    const tools = document.querySelector('.tools.main-tools') || document.querySelector('.tools'); if (!tools) return;
    let button = $(BUTTON_ID); if (!button) { button = document.createElement('button'); button.id = BUTTON_ID; button.className = 'tool'; button.textContent = '🧠 AI Переходов ▶'; tools.appendChild(button); }
    let section = $(MODULE_ID); if (!section) { section = document.createElement('section'); section.id = MODULE_ID; section.className = 'card panel'; section.innerHTML = `<div style="font-size:18px;font-weight:950">🧠 AI Переходов v7.2</div><div class="small">Исправлено: настоящий победивший столб и честные архивные доли вместо относительных 100%.</div><div style="display:grid;grid-template-columns:1fr 1fr auto;gap:7px;margin-top:10px"><select id="${WINDOW_ID}"><option value="3">Окно 3</option><option value="5" selected>Окно 5</option><option value="7">Окно 7</option></select><select id="${LIMIT_ID}"><option value="12">12 аналогов</option><option value="16" selected>16 аналогов</option><option value="24">24 аналога</option><option value="40">40 аналогов</option></select><button id="${RUN_ID}" class="tool">🔎 Анализировать</button></div><div id="${RESULT_ID}"></div>`; const sp = $('searchPanel'); sp?.parentNode?.insertBefore(section, sp); }
    button.onclick = () => { const open = !section.classList.contains('show'); section.classList.toggle('show', open); button.textContent = open ? '🧠 AI Переходов ▼' : '🧠 AI Переходов ▶'; if (open) { renderRetro(); section.scrollIntoView({ behavior: 'smooth', block: 'start' }); } };
    $(RUN_ID).onclick = renderRetro; $(LIMIT_ID).onchange = renderRetro; $(WINDOW_ID).onchange = renderRetro;
    const plus = $('runPlusBtn'); if (plus) plus.onclick = honestRunPlus;
    const quality = $('qualityBtn'); if (quality) quality.onclick = honestQualityAudit;
  }
  function start() { injectStyles(); injectInterface(); }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once: true }); else start();
})();
