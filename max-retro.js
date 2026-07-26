'use strict';

/*
  ПОЗИТРОН КЕНО v7.2 — AI Переходов
  Локальный ретропоиск по всей базе. Главные признаки:
  переходы чисел, длины цепочек, диапазоны по 4 числа,
  шаговость/чередование, одиночные и пустые столбы.
*/
(() => {
  const MODULE_ID = 'maxRetroPanel';
  const BUTTON_ID = 'maxRetroToolBtn';
  const RESULT_ID = 'maxRetroResult';
  const RUN_ID = 'runMaxRetroBtn';
  const LIMIT_ID = 'maxRetroLimit';
  const WINDOW_ID = 'maxRetroWindow';

  const $ = id => document.getElementById(id);
  const clamp01 = v => Math.max(0, Math.min(1, Number(v) || 0));
  const pct = v => `${Math.round(clamp01(v) * 100)}%`;
  const pad2 = n => String(n).padStart(2, '0');
  const columnOf = n => n % 10 || 10;
  const rangeOf = n => Math.floor((n - 1) / 4); // 0..19
  const rangeLabel = r => `${r * 4 + 1}–${r * 4 + 4}`;

  function setSimilarity(a, b) {
    const A = new Set(a || []), B = new Set(b || []);
    const union = new Set([...A, ...B]);
    if (!union.size) return 1;
    let same = 0;
    A.forEach(v => { if (B.has(v)) same += 1; });
    return same / union.size;
  }

  function vectorSimilarity(a, b) {
    const len = Math.max(a.length, b.length);
    if (!len) return 1;
    let diff = 0, max = 0;
    for (let i = 0; i < len; i += 1) {
      diff += Math.abs((a[i] || 0) - (b[i] || 0));
      max += Math.max(1, a[i] || 0, b[i] || 0);
    }
    return clamp01(1 - diff / max);
  }

  function safeAnalysis(draw) {
    try { return typeof analysis === 'function' ? analysis(draw) : {}; }
    catch (_) { return {}; }
  }

  function transitionSet(index) {
    if (index <= 0) return new Set();
    if (typeof transitions === 'function') return transitions(index);
    const previous = new Set(draws[index - 1].balls || []);
    return new Set((draws[index].balls || []).filter(n => previous.has(n)));
  }

  function chainLength(index, number) {
    let length = 1;
    for (let i = index; i > 0; i -= 1) {
      const now = new Set(draws[i].balls || []);
      const prev = new Set(draws[i - 1].balls || []);
      if (now.has(number) && prev.has(number)) length += 1;
      else break;
    }
    return length;
  }

  function occupancy(index) {
    const counts = Array(20).fill(0);
    (draws[index]?.balls || []).forEach(n => { counts[rangeOf(n)] += 1; });
    return counts;
  }

  function movementSignature(index) {
    if (index <= 0) return Array(20).fill(0);
    const before = occupancy(index - 1), now = occupancy(index);
    return now.map((v, i) => Math.sign(v - before[i])); // -1, 0, +1
  }

  function innerRangePattern(index) {
    const out = [];
    for (let r = 0; r < 20; r += 1) {
      let mask = 0;
      (draws[index]?.balls || []).forEach(n => {
        if (rangeOf(n) === r) mask |= 1 << ((n - 1) % 4);
      });
      out.push(mask);
    }
    return out;
  }

  function alternationScore(index) {
    if (index < 1) return 0;
    const a = innerRangePattern(index - 1), b = innerRangePattern(index);
    let alternating = 0, active = 0;
    for (let r = 0; r < 20; r += 1) {
      if (a[r] || b[r]) {
        active += 1;
        if ((a[r] & b[r]) === 0 && a[r] !== b[r]) alternating += 1;
      }
    }
    return active ? alternating / active : 0;
  }

  function windowFeatures(endIndex, windowSize) {
    const start = Math.max(1, endIndex - windowSize + 1);
    const transitionCounts = [];
    const rangeFlow = Array(20).fill(0);
    const movement = Array(20).fill(0);
    const allTransitionNumbers = [];
    const transitionColumns = [];
    const chainHistogram = Array(6).fill(0);
    let alternation = 0;

    for (let i = start; i <= endIndex; i += 1) {
      const pass = [...transitionSet(i)];
      transitionCounts.push(pass.length);
      allTransitionNumbers.push(...pass);
      transitionColumns.push(...pass.map(columnOf));
      pass.forEach(n => { rangeFlow[rangeOf(n)] += 1; });
      movementSignature(i).forEach((v, r) => { movement[r] += v; });
      pass.forEach(n => {
        const len = Math.min(5, chainLength(i, n));
        chainHistogram[len] += 1;
      });
      alternation += alternationScore(i);
    }

    const info = safeAnalysis(draws[endIndex]);
    const currentPass = [...transitionSet(endIndex)];
    return {
      endIndex,
      transitionCounts,
      currentPass,
      allTransitionNumbers,
      transitionColumns,
      rangeFlow,
      occupancy: occupancy(endIndex),
      movement,
      pattern: innerRangePattern(endIndex),
      chainHistogram,
      alternation: alternation / Math.max(1, endIndex - start + 1),
      single: info.single || [],
      empty: info.empty || [],
      even: info.even || 0,
      sum: info.sum || 0
    };
  }

  function patternSimilarity(a, b) {
    let score = 0;
    for (let i = 0; i < 20; i += 1) {
      const A = a[i], B = b[i];
      if (A === B) score += 1;
      else {
        const inter = A & B;
        const union = A | B;
        const bits = x => x.toString(2).split('1').length - 1;
        score += union ? bits(inter) / bits(union) : 1;
      }
    }
    return score / 20;
  }

  function compare(target, candidate) {
    const transitionRhythm = vectorSimilarity(target.transitionCounts, candidate.transitionCounts);
    const currentTransitions = setSimilarity(target.currentPass, candidate.currentPass);
    const transitionColumns = setSimilarity(target.transitionColumns, candidate.transitionColumns);
    const rangeFlow = vectorSimilarity(target.rangeFlow, candidate.rangeFlow);
    const occupancyScore = vectorSimilarity(target.occupancy, candidate.occupancy);
    const movement = vectorSimilarity(target.movement, candidate.movement);
    const pattern = patternSimilarity(target.pattern, candidate.pattern);
    const chains = vectorSimilarity(target.chainHistogram, candidate.chainHistogram);
    const shape = (setSimilarity(target.single, candidate.single) + setSimilarity(target.empty, candidate.empty)) / 2;
    const alternation = 1 - Math.min(1, Math.abs(target.alternation - candidate.alternation));

    const score =
      transitionRhythm * 0.17 +
      currentTransitions * 0.10 +
      transitionColumns * 0.08 +
      rangeFlow * 0.16 +
      occupancyScore * 0.10 +
      movement * 0.11 +
      pattern * 0.10 +
      chains * 0.08 +
      alternation * 0.06 +
      shape * 0.04;

    return { score, transitionRhythm, currentTransitions, rangeFlow, movement, pattern, chains, alternation, shape };
  }

  function buildForecast(rows) {
    const numberScores = Array(81).fill(0);
    const numberCases = Array(81).fill(0);
    const rangeScores = Array(20).fill(0);
    const currentBalls = new Set(draws.at(-1).balls || []);

    rows.forEach((row, rank) => {
      const next = draws[row.nextIndex];
      const source = new Set(draws[row.index].balls || []);
      const nextTransitions = (next.balls || []).filter(n => source.has(n));
      const rankWeight = Math.max(0.25, 1 - rank / Math.max(10, rows.length));
      const weight = (0.35 + row.score * 0.65) * rankWeight;
      nextTransitions.forEach(n => {
        numberScores[n] += weight;
        numberCases[n] += 1;
        rangeScores[rangeOf(n)] += weight;
      });
    });

    const numbers = [...currentBalls]
      .sort((a, b) => numberScores[b] - numberScores[a] || numberCases[b] - numberCases[a] || a - b)
      .slice(0, 12);
    const ranges = Array.from({ length: 20 }, (_, r) => r)
      .sort((a, b) => rangeScores[b] - rangeScores[a] || a - b)
      .slice(0, 6);
    return { numbers, ranges, numberScores, numberCases, rangeScores };
  }

  function render() {
    const box = $(RESULT_ID);
    if (!box) return;
    if (typeof draws === 'undefined' || !Array.isArray(draws) || draws.length < 50) {
      box.innerHTML = '<div class="row small">Для AI Переходов нужно хотя бы 50 сохранённых тиражей.</div>';
      return;
    }

    const limit = Math.max(8, Math.min(40, Number($(LIMIT_ID)?.value || 16)));
    const windowSize = Math.max(2, Math.min(8, Number($(WINDOW_ID)?.value || 5)));
    const targetIndex = draws.length - 1;
    const target = windowFeatures(targetIndex, windowSize);
    const rows = [];

    for (let index = windowSize; index < targetIndex; index += 1) {
      if (targetIndex - index < windowSize + 1) continue;
      const result = compare(target, windowFeatures(index, windowSize));
      rows.push({ index, nextIndex: index + 1, ...result });
    }
    rows.sort((a, b) => b.score - a.score || draws[b.index].draw - draws[a.index].draw);
    const top = rows.slice(0, limit);
    if (!top.length) {
      box.innerHTML = '<div class="row small">Завершённых исторических аналогов пока не найдено.</div>';
      return;
    }

    const forecast = buildForecast(top);
    const maxScore = Math.max(...forecast.numberScores, 0.0001);
    const transitionCards = forecast.numbers.map((n, place) => {
      const confidence = Math.round(forecast.numberScores[n] / maxScore * 100);
      const chain = chainLength(targetIndex, n);
      return `<div class="tr-number-card">
        <div class="small">${place + 1} место · ${forecast.numberCases[n]} аналогов</div>
        <div class="tr-number">${pad2(n)}</div>
        <div>${confidence}% веса · цепь ст${chain}</div>
      </div>`;
    }).join('');

    const maxRange = Math.max(...forecast.rangeScores, 0.0001);
    const rangeCards = forecast.ranges.map(r => `<span><b>${rangeLabel(r)}</b> · ${Math.round(forecast.rangeScores[r] / maxRange * 100)}%</span>`).join('');

    const currentPass = target.currentPass.length
      ? target.currentPass.map(n => `${pad2(n)}<small>ст${chainLength(targetIndex, n)}</small>`).join(' ')
      : 'нет';

    const analogs = top.slice(0, 12).map((row, rank) => {
      const old = draws[row.index], next = draws[row.nextIndex];
      const oldPass = [...transitionSet(row.index)];
      const nextPass = [...transitionSet(row.nextIndex)];
      return `<div class="tr-analog">
        <div class="tr-analog-head"><b>${rank + 1}. №${old.draw}</b><strong>${pct(row.score)}</strong></div>
        <div class="small">Переходы тогда: ${oldPass.length ? oldPass.map(pad2).join(' ') : 'нет'}</div>
        <div class="tr-next">➡ №${next.draw}: ${nextPass.length ? nextPass.map(pad2).join(' ') : 'без переходов'}</div>
        <div class="breakdown">
          <span>ритм ${pct(row.transitionRhythm)}</span><span>диапазоны ${pct(row.rangeFlow)}</span>
          <span>шаговость ${pct(row.movement)}</span><span>рисунок ${pct(row.pattern)}</span>
          <span>цепочки ${pct(row.chains)}</span><span>чередование ${pct(row.alternation)}</span>
        </div>
      </div>`;
    }).join('');

    box.innerHTML = `
      <div class="row tr-summary">
        <b>Текущий тираж №${draws[targetIndex].draw}</b><br>
        <span class="small">Окно анализа: ${windowSize} тиражей · сравнено ${rows.length.toLocaleString('ru-RU')} завершённых ситуаций.</span>
        <div class="tr-current">Переходы: ${currentPass}</div>
      </div>
      <div class="section"><span>🧠 Прогноз продолжения переходов</span></div>
      <div class="tr-grid">${transitionCards}</div>
      <div class="section"><span>Диапазоны вероятного заполнения</span></div>
      <div class="freq">${rangeCards}</div>
      <div class="row small"><b>Как читать:</b> в прогноз входят только числа последнего тиража — именно они физически могут перейти в следующий. Процент является относительным весом среди найденных аналогов, а не гарантией.</div>
      <div class="section"><span>Лучшие ретроаналоги</span></div>
      ${analogs}`;
  }

  function injectStyles() {
    if ($('maxRetroStyles')) return;
    const style = document.createElement('style');
    style.id = 'maxRetroStyles';
    style.textContent = `
      .tr-title{font-size:18px;font-weight:950}.tr-controls{display:grid;grid-template-columns:1fr 1fr auto;gap:7px;margin-top:10px}
      .tr-grid{display:grid;grid-template-columns:repeat(2,1fr);gap:7px}.tr-number-card{border:1px solid #466b48;background:#122c25;border-radius:11px;padding:10px;text-align:center}
      .tr-number{font-size:27px;font-weight:950;color:#8eedaa}.tr-summary{border-color:#4f744d}.tr-current{margin-top:7px;font-weight:900;color:#ffe18b}
      .tr-current small{color:#96a9c1;margin-left:2px;margin-right:7px}.tr-analog{background:#101f33;border:1px solid #2a4464;border-radius:11px;padding:10px;margin-top:8px}
      .tr-analog-head{display:flex;justify-content:space-between;gap:8px}.tr-analog-head strong{font-size:20px;color:#8eedaa}.tr-next{margin-top:6px;font-weight:900;color:#ffd35c}
      @media(max-width:480px){.tr-controls{grid-template-columns:1fr 1fr}.tr-controls button{grid-column:1/-1}}
      @media(min-width:620px){.tr-grid{grid-template-columns:repeat(4,1fr)}}`;
    document.head.appendChild(style);
  }

  function injectInterface() {
    if ($(BUTTON_ID) || $(MODULE_ID)) return;
    const tools = document.querySelector('.tools');
    if (!tools) return;
    const button = document.createElement('button');
    button.id = BUTTON_ID;
    button.className = 'tool';
    button.type = 'button';
    button.textContent = '🧠 AI Переходов ▶';
    tools.appendChild(button);

    const section = document.createElement('section');
    section.id = MODULE_ID;
    section.className = 'card panel';
    section.innerHTML = `
      <div class="tr-title">🧠 AI Переходов v7.2</div>
      <div class="small" style="margin-top:5px">Ретропоиск по всей базе: переходы, цепочки, диапазоны 1–4, 5–8… 77–80, шаговость, чередование, одиночные и пустые столбы.</div>
      <div class="tr-controls">
        <select id="${WINDOW_ID}"><option value="3">Окно 3 тиража</option><option value="5" selected>Окно 5 тиражей</option><option value="7">Окно 7 тиражей</option></select>
        <select id="${LIMIT_ID}"><option value="12">12 аналогов</option><option value="16" selected>16 аналогов</option><option value="24">24 аналога</option><option value="40">40 аналогов</option></select>
        <button id="${RUN_ID}" class="tool" type="button">🔎 Анализировать</button>
      </div>
      <div id="${RESULT_ID}"></div>`;
    const searchPanel = $('searchPanel');
    searchPanel?.parentNode?.insertBefore(section, searchPanel);

    button.addEventListener('click', () => {
      const open = !section.classList.contains('show');
      section.classList.toggle('show', open);
      button.textContent = open ? '🧠 AI Переходов ▼' : '🧠 AI Переходов ▶';
      if (open && !$(RESULT_ID).innerHTML.trim()) render();
      if (open) section.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
    $(RUN_ID)?.addEventListener('click', render);
    $(LIMIT_ID)?.addEventListener('change', render);
    $(WINDOW_ID)?.addEventListener('change', render);
  }

  function start() { injectStyles(); injectInterface(); }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once: true });
  else start();
})();
