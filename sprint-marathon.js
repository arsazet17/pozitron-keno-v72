'use strict';
(() => {
  const $ = id => document.getElementById(id);
  const pad = n => String(n).padStart(2, '0');
  const colOf = n => n % 10 || 10;
  const pct = v => `${Math.round((Number(v) || 0) * 100)}%`;
  const FORECAST_KEY = 'pozitronSprintMarathonForecastsV1';

  function loadForecasts() {
    try {
      const value = JSON.parse(localStorage.getItem(FORECAST_KEY) || '[]');
      return Array.isArray(value) ? value : [];
    } catch (_) { return []; }
  }

  function saveForecasts(rows) {
    try { localStorage.setItem(FORECAST_KEY, JSON.stringify(rows.slice(-120))); }
    catch (_) {}
  }

  function forecastIdentity(model, sourceDraw) {
    return `${model.name}:${sourceDraw}`;
  }

  function checkSavedForecast(model) {
    const last = draws.at(-1);
    const history = loadForecasts();
    const completed = history
      .filter(x => x && x.model === model.name && Number(x.targetDraw) <= Number(last.draw))
      .sort((a, b) => Number(b.targetDraw) - Number(a.targetDraw));
    const row = completed[0];
    if (!row || Number(row.targetDraw) !== Number(last.draw)) return null;
    const actual = new Set(last.balls || []);
    const hits = (row.numbers || []).filter(n => actual.has(n));
    return { ...row, hits, misses: (row.numbers || []).filter(n => !actual.has(n)), actualDraw: last.draw };
  }

  function rememberForecast(model) {
    const source = draws.at(-1);
    if (!source || !model?.nums?.length) return null;
    const targetDraw = Number(source.draw) + 1;
    const history = loadForecasts();
    const id = forecastIdentity(model, source.draw);
    const existing = history.find(x => x.id === id);
    if (existing) return existing;
    const row = {
      id,
      model: model.name,
      sourceDraw: Number(source.draw),
      targetDraw,
      savedAt: new Date().toISOString(),
      numbers: model.nums.map(x => Number(x.n)),
      columns: model.cols.map(x => Number(x.col)),
      regime: model.pred?.order?.[0] ?? null
    };
    history.push(row);
    saveForecasts(history);
    return row;
  }

  function forecastCheckHtml(model) {
    const checked = checkSavedForecast(model);
    const saved = rememberForecast(model);
    if (checked) {
      const hitText = checked.hits.length ? checked.hits.map(pad).join(' · ') : 'нет';
      return `<div class="sm-check sm-checked"><b>✅ Проверка на №${checked.actualDraw}</b><br>
        Попало: <b>${checked.hits.length} из ${(checked.numbers || []).length}</b> · ${hitText}<br>
        <span class="small">Сохранено заранее после №${checked.sourceDraw}: ${(checked.numbers || []).map(pad).join(' · ')}</span></div>`;
    }
    return `<div class="sm-check"><b>💾 Сохранено на следующий тираж №${saved?.targetDraw || (Number(draws.at(-1)?.draw || 0) + 1)}</b><br>
      <span class="small">После появления результата строка сама покажет, сколько чисел комбинации вышло.</span></div>`;
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
    return Number(safeAnalysis(draws[i]).winner) || 1;
  }

  function stateBeforeWinner(i) {
    if (i <= 0) return null;
    return Math.min(4, counts(draws[i - 1])[winnerAt(i)] || 0);
  }

  function stateLabel(s) {
    return s === 4 ? '4 и более' : String(s);
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

  function currentAvailability() {
    const currentCounts = counts(draws.at(-1));
    const byState = Array.from({ length: 5 }, () => []);
    for (let col = 1; col <= 10; col += 1) {
      byState[Math.min(4, currentCounts[col])].push(col);
    }
    return byState;
  }

  function normalizeByAvailability(raw) {
    const available = currentAvailability();
    const filtered = raw.map((v, state) => available[state].length ? Math.max(0, v) : 0);
    const total = filtered.reduce((a, b) => a + b, 0);
    const probs = total
      ? filtered.map(v => v / total)
      : available.map(cols => cols.length ? 1 : 0);
    const fallbackTotal = probs.reduce((a, b) => a + b, 0);
    const finalProbs = fallbackTotal ? probs.map(v => v / fallbackTotal) : Array(5).fill(0);
    return { probs: finalProbs, available };
  }

  function analogForecast(seq, minIndex, maxIndex) {
    const support = Array(5).fill(0);
    const stats = { exact: 0, near: 0, switchCases: 0, weight: 0 };

    // 80% — текущая цепочка и переключения; 20% — общая архивная частота.
    addSuffixEvidence(seq, minIndex, maxIndex, support, stats);
    addSwitchEvidence(seq, minIndex, maxIndex, support, stats);
    addHistoricalBaseline(support, minIndex, maxIndex, Math.max(0.35, stats.weight * 0.25));

    const rawTotal = support.reduce((a, b) => a + b, 0);
    const rawProbs = support.map(v => rawTotal ? v / rawTotal : 0);
    const feasible = normalizeByAvailability(rawProbs);
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

  function winnerStreak(col) {
    let streak = 0;
    for (let i = draws.length - 1; i >= 0; i -= 1) {
      if (winnerAt(i) === col) streak += 1;
      else break;
    }
    return streak;
  }

  function preservedWinnerFrame(col) {
    if (draws.length < 2) return 0;
    const last = new Set(draws.at(-1).balls || []);
    const prev = (draws.at(-2).balls || []).filter(n => colOf(n) === col);
    return prev.filter(n => last.has(n)).length;
  }

  function numberScore(n, col, window) {
    const last = draws.at(-1);
    const set = new Set(last.balls || []);
    let score = 0;
    const reasons = [];
    if (colOf(n) !== col) return { score: -99, reasons };

    const recent = draws.slice(-window);
    const hits = recent.filter(d => (d.balls || []).includes(n)).length;
    if (set.has(n)) { score += 1.55; reasons.push('повтор'); }
    score += (hits / Math.max(1, window)) * 1.25;
    if (hits >= 2) reasons.push(`частота ${hits}/${window}`);

    const has = x => x >= 1 && x <= 80 && set.has(x);
    if (has(n - 1) && has(n + 1)) { score += 1.55; reasons.push('центр последовательности'); }
    if (has(n - 2) && has(n + 2)) { score += 1.25; reasons.push('сходящаяся сборка'); }
    if (has(n - 10) && has(n + 10)) { score += 1.55; reasons.push('вертикальный центр'); }
    if (has(n - 20) && has(n + 20)) { score += 0.80; reasons.push('вертикаль ±20'); }
    if (has(n - 1) || has(n + 1)) { score += 0.35; reasons.push('соседство ±1'); }
    if (has(n - 2) || has(n + 2)) { score += 0.25; reasons.push('соседство ±2'); }
    if (has(n - 10) || has(n + 10)) { score += 0.35; reasons.push('вертикальная связь'); }
    if (!set.has(n)) score += 0.15;

    return { score, reasons: [...new Set(reasons)] };
  }

  function rankColumns(pred, window) {
    const current = counts(draws.at(-1));
    const rows = [];

    for (let col = 1; col <= 10; col += 1) {
      const state = Math.min(4, current[col]);
      const regime = pred.probs[state] || 0;
      let shape = 0;
      const reasons = [];
      const nums = (draws.at(-1).balls || []).filter(n => colOf(n) === col);

      if (state === 0) { shape += 0.20; reasons.push('столб сейчас в пустоте'); }
      if (state === 1) { shape += 0.35; reasons.push('одиночный каркас'); }
      if (state === 2) { shape += 0.50; reasons.push('двойной каркас'); }
      if (state === 3) { shape += 0.45; reasons.push('тройной каркас'); }
      if (state === 4) { shape += 0.38; reasons.push('плотный каркас'); }
      if (nums.some(n => nums.includes(n + 10))) { shape += 0.30; reasons.push('вертикальная связка'); }

      const history = draws.slice(-window).map(d => counts(d)[col]);
      const trend = history.at(-1) - (history[0] || 0);
      if (trend > 0) { shape += 0.20; reasons.push('набор плотности'); }

      const streak = winnerStreak(col);
      if (streak >= 1) {
        shape += Math.min(0.45, 0.18 + streak * 0.10);
        reasons.push(streak > 1 ? `серия побед ${streak}` : 'победитель прошлого тиража');
      }

      const preserved = preservedWinnerFrame(col);
      if (preserved > 0 && winnerAt(draws.length - 2) === col) {
        shape += Math.min(0.35, preserved * 0.12);
        reasons.push(`сохранён каркас ${preserved}`);
      }

      rows.push({ col, state, score: regime * 3 + shape, reasons, regime });
    }

    return rows.sort((a, b) => b.score - a.score || b.regime - a.regime || a.col - b.col);
  }

  function rankNumbers(cols, window, limit) {
    const arr = [];
    for (const col of cols) {
      for (let n = col; n <= 80; n += 10) {
        const ranked = numberScore(n, col, window);
        arr.push({ n, col, ...ranked });
      }
    }
    return arr.sort((a, b) => b.score - a.score || a.n - b.n).slice(0, limit);
  }

  function sprintModel() {
    const end = draws.length - 1;
    const seq = sequence(end, 5);
    const pred = analogForecast(seq, 1, end - 1);
    const ranked = rankColumns(pred, 8);
    const cols = ranked.slice(0, 4);
    const nums = rankNumbers(cols.map(x => x.col), 8, 6);
    return { name: 'СПРИНТ', seq, pred, cols, nums, type: classify(seq), window: 5, startIndex: Math.max(1, end - 4), endIndex: end };
  }

  function marathonModel() {
    const end = draws.length - 1;
    const seq = sequence(end, 25);
    const tail = seq.slice(-10);
    const pred = analogForecast(tail, 1, end - 1);
    const ranked = rankColumns(pred, 30);
    const cols = ranked.slice(0, 6);
    const nums = rankNumbers(cols.map(x => x.col), 30, 8);
    return { name: 'МАРАФОН', seq, pred, cols, nums, type: classify(seq), window: 25, startIndex: Math.max(1, end - 24), endIndex: end };
  }

  function regimeBars(pred) {
    return pred.order.map(state => {
      const available = pred.available[state] || [];
      const impossible = !available.length;
      return `<div class="sm-reg${impossible ? ' sm-off' : ''}">
        <b>${stateLabel(state)}</b>
        <span>${impossible ? '0%' : pct(pred.probs[state] || 0)}</span>
        <small>${available.length ? `${available.length} ст.` : 'нет'}</small>
      </div>`;
    }).join('');
  }

  function drawBlockHtml(startIndex, endIndex) {
    const start = draws[startIndex];
    const end = draws[endIndex];
    const cols = [];
    const states = [];
    for (let i = startIndex; i <= endIndex; i += 1) {
      cols.push(winnerAt(i));
      states.push(stateBeforeWinner(i));
    }
    return `<div class="sm-chain-block">
      <b>№${start.draw}–№${end.draw} · ${start.date} · ${start.time}–${end.time}</b>
      <div><span>Столбцы:</span> ${cols.map(c => `ст${c}`).join(' → ')}</div>
      <div><span>Выход:</span> ${states.map(stateLabel).join(' → ')}</div>
    </div>`;
  }

  function chainBlocksHtml(model) {
    const blocks = [];
    for (let start = model.startIndex; start <= model.endIndex; start += 5) {
      blocks.push(drawBlockHtml(start, Math.min(model.endIndex, start + 4)));
    }
    return blocks.join('');
  }

  function modelHtml(model, icon) {
    const changes = model.seq.slice(1).filter((x, i) => x !== model.seq[i]).length;
    return `<div class="sm-card">
      <div class="sm-head">${icon} ${model.name}</div>
      <div class="sm-seq">${model.seq.map(stateShort).join('→')}</div>
      <div class="small"><b>Цикл:</b> ${model.type} · смен ${changes}/${Math.max(1, model.seq.length - 1)}</div>
      <div class="section"><span>Цепочки тиражей</span></div>
      <div class="sm-chain-list">${chainBlocksHtml(model)}</div>
      <div class="section"><span>Вероятное продолжение режима</span></div>
      <div class="sm-regs">${regimeBars(model.pred)}</div>
      <div class="row small">Точных пятёрок: ${model.pred.exact} · близких фрагментов: ${model.pred.near} · переключений учтено: ${model.pred.switchCases}</div>
      <div class="section"><span>Подготовленные столбцы</span></div>
      ${model.cols.map((x, i) => `<div class="sm-line"><b>${i + 1}. ст${x.col}</b> · сейчас ${stateLabel(x.state)} · ${Math.round(x.score * 100)} баллов<br><span class="small">${x.reasons.join(' · ') || 'по режиму цепочки'}</span></div>`).join('')}
      <div class="section"><span>Комбинация чисел</span></div>
      <div class="sm-balls">${model.nums.map(x => `<div class="sm-ball"><b>${pad(x.n)}</b><small>ст${x.col}</small></div>`).join('')}</div>
      ${model.nums.map(x => `<div class="small sm-why"><b>${pad(x.n)}</b> — ${x.reasons.join(' · ') || 'поддержка столбца'}</div>`).join('')}
      ${forecastCheckHtml(model)}
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
    box.innerHTML = '<div class="row">⏳ Анализирую цепочки и переключения…</div>';
    setTimeout(() => {
      const sprint = sprintModel();
      const marathon = marathonModel();
      box.innerHTML = which === 'sprint'
        ? modelHtml(sprint, '🏃')
        : which === 'marathon'
          ? modelHtml(marathon, '🐢')
          : modelHtml(sprint, '🏃') + modelHtml(marathon, '🐢') + agreementHtml(sprint, marathon);
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
      .sm-title,.sm-head{font-size:20px;font-weight:950}.sm-card{border:1px solid #2b4668;border-radius:14px;padding:12px;margin-top:10px;background:#0e1d30}
      .sm-seq{font-size:25px;font-weight:950;color:#83e6a5;letter-spacing:1px;overflow-wrap:anywhere;margin:8px 0}
      .sm-regs{display:grid;grid-template-columns:repeat(5,1fr);gap:5px}.sm-reg{border:1px solid #355275;border-radius:9px;padding:7px 3px;text-align:center}.sm-reg b,.sm-reg span,.sm-reg small{display:block}.sm-reg span{color:#ffd764;font-weight:900}.sm-reg small{color:#9fb0c6;margin-top:2px}.sm-reg.sm-off{opacity:.48}.sm-reg.sm-off span{color:#9fb0c6}
      .sm-chain-list{display:grid;gap:7px}.sm-chain-block{border:1px solid #2a4464;border-radius:10px;padding:9px;background:#101f33}.sm-chain-block b{display:block;margin-bottom:5px}.sm-chain-block span{color:#9fb0c6;font-weight:800}
      .sm-line{border-bottom:1px solid #263c58;padding:8px 2px}.sm-balls{display:grid;grid-template-columns:repeat(4,1fr);gap:7px}.sm-ball{border:1px solid #466b48;background:#122c25;border-radius:10px;text-align:center;padding:8px}.sm-ball b{display:block;font-size:24px;color:#8eedaa}.sm-ball small{color:#9fb0c6}.sm-why{margin-top:5px}.sm-check{margin-top:12px;border:1px solid #365979;background:#10253b;border-radius:11px;padding:10px;line-height:1.5}.sm-check.sm-checked{border-color:#4f744d;background:#122c25}.sm-agree{margin-top:12px;border:1px solid #6a6036;background:#2b2712;border-radius:12px;padding:11px;color:#ffe18b}
      @media(max-width:420px){.sm-regs{grid-template-columns:repeat(5,1fr)}.sm-reg{font-size:11px}.sm-balls{grid-template-columns:repeat(3,1fr)}}`;
    document.head.appendChild(style);
  }

  function start() { styles(); inject(); }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once: true });
  else start();
})();
