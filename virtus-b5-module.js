/* Virtus-Dei · модуль В5 (ЭКСПЕРИМЕНТАЛЬНЫЙ). Самостоятельный, без зависимостей и без DOM.
   Вход: history = [{draw, date:'ДД.ММ.ГГ', time:'ЧЧ:ММ', balls:[20 чисел в порядке выпадения], column?:1..10}]
   Правила заморожены: 12 голосующих правил, порог ≥4 голосов, единственный лидер, порядок заполнения «номер по возрастанию». */
(function (root) {
  'use strict';
  const VERSION = 'B5-frozen-2026-10-11';
  const POOL = ['Д вчера, слот 0', 'Д вчера, слот −1', 'Д вчера, слот +1', 'Д позавчера, слот 0', 'Д 3 дня назад, слот 0',
    'Мода 7 дней', 'Волна 2т, сдвиг 0', 'Волна 2т, сдвиг +1', 'Волна 2т, сдвиг −1', 'Сегмент 3 → вчера', 'Разворот → возврат', 'Остановка → повтор'];
  const GN = ['ГР0', 'ГР1', 'ГР2', 'ГР3', 'ГР4+'];
  const colOf = n => (n % 10) || 10;
  const parseDate = s => { const [d, m, y] = s.split('.').map(Number); return new Date(Date.UTC(2000 + y, m - 1, d)); };
  const fmtDate = dt => String(dt.getUTCDate()).padStart(2, '0') + '.' + String(dt.getUTCMonth() + 1).padStart(2, '0') + '.' + String(dt.getUTCFullYear() % 100).padStart(2, '0');

  function createEngine(history) {
    const H = history.slice().sort((a, b) => a.draw - b.draw), N = H.length;
    const counts = H.map(d => { const c = new Array(10).fill(0); d.balls.forEach(b => c[colOf(b) - 1]++); return c; });
    const win = H.map(d => (typeof d.column === 'number' && d.column >= 1 && d.column <= 10) ? d.column : 0); // только официальный столбец
    const G = new Array(N).fill(-1);
    for (let i = 1; i < N; i++) if (win[i]) G[i] = Math.min(counts[i - 1][win[i] - 1], 4);
    const dates = [...new Set(H.map(d => d.date))].sort((a, b) => parseDate(a) - parseDate(b)), dIdx = new Map(dates.map((d, i) => [d, i]));
    const dayList = dates.map(() => []);
    H.forEach((d, i) => dayList[dIdx.get(d.date)].push(i));
    dayList.forEach(l => l.sort((a, b) => (H[a].time < H[b].time ? -1 : H[a].time > H[b].time ? 1 : 0)));
    const posOf = dayList.map(l => new Map(l.map((i, p) => [H[i].time, p])));
    const dayOf = H.map(d => dIdx.get(d.date));
    return { H, N, counts, win, G, dates, dayList, posOf, dayOf };
  }

  // следующий слот: ближайшее позднее время из списка предыдущего дня; иначе первый слот следующих суток
  function nextTarget(e) {
    const last = e.H[e.N - 1], di = e.dayOf[e.N - 1], ref = e.dayList[Math.max(di - 1, 0)].map(i => e.H[i].time);
    const nx = ref.find(t => t > last.time);
    if (nx) return { dayIdx: di, date: last.date, time: nx, draw: last.draw + 1 };
    const dt = parseDate(last.date); dt.setUTCDate(dt.getUTCDate() + 1);
    return { dayIdx: di + 1, date: fmtDate(dt), time: ref[0] || '00:02', draw: last.draw + 1 };
  }

  // Прогноз на тираж с индексом t (t = N — следующий). Используются только данные с индексами < t.
  function predictAt(e, t, target) {
    const tg = target || (t === e.N ? nextTarget(e) : { dayIdx: e.dayOf[t], time: e.H[t].time, date: e.H[t].date, draw: e.H[t].draw });
    const Gx = i => (i >= 0 && i < t) ? e.G[i] : -1;
    const cell = (lag, s) => { const dd = tg.dayIdx - lag; if (dd < 0 || dd >= e.dates.length) return -1; const q = e.posOf[dd].get(tg.time); if (q === undefined) return -1; const p = q + s; return (p < 0 || p >= e.dayList[dd].length) ? -1 : e.dayList[dd][p]; };
    const D = (lag, s) => Gx(cell(lag, s));
    const g1 = Gx(t - 1), g2 = Gx(t - 2), g3 = Gx(t - 3);
    const pr = [], src = [];
    const push = (g, text) => { pr.push(g); src.push(text); };
    const cellTxt = (lag, s) => { const c = cell(lag, s); return c >= 0 && c < t ? '№' + e.H[c].draw + ' ' + e.H[c].date + ' ' + e.H[c].time + ' → ' + (e.G[c] < 0 ? 'нет данных' : GN[e.G[c]]) : 'ячейки нет'; };
    push(D(1, 0), cellTxt(1, 0)); push(D(1, -1), cellTxt(1, -1)); push(D(1, 1), cellTxt(1, 1)); push(D(2, 0), cellTxt(2, 0)); push(D(3, 0), cellTxt(3, 0));
    // мода 7 дней
    const cnt = [0, 0, 0, 0, 0]; for (let l = 1; l <= 7; l++) { const v = D(l, 0); if (v >= 0) cnt[v]++; }
    const mxm = Math.max(...cnt), um = cnt.filter(c => c === mxm).length === 1;
    push(mxm >= 4 && um ? cnt.indexOf(mxm) : -1, 'группы за 7 дней: ' + cnt.map((c, g) => GN[g] + '×' + c).join(' '));
    // волны
    for (const s of [0, 1, -1]) { const a = D(1, -s), b = D(2, -2 * s); push(a >= 0 && a === b ? a : -1, 'вчера ' + (a < 0 ? '—' : GN[a]) + ', позавчера ' + (b < 0 ? '—' : GN[b])); }
    // сегмент из трёх прошлых групп повторился вчера
    const y1 = D(1, -1), y2 = D(1, -2), y3 = D(1, -3);
    push(g1 >= 0 && g1 === y1 && g2 === y2 && g3 === y3 ? D(1, 0) : -1, 'последние 3: ' + [g3, g2, g1].join('') + '; вчера: ' + [y3, y2, y1].join(''));
    // торможение/разворот по хронологии
    const v3 = g1 >= 0 && g2 >= 0 && g3 >= 0, d1 = g2 - g3, d2 = g1 - g2;
    push(v3 && d1 * d2 < 0 ? g2 : -1, 'последние 3 группы: ' + [g3, g2, g1].join(''));
    push(v3 && d2 === 0 ? g1 : -1, 'последние 3 группы: ' + [g3, g2, g1].join(''));
    const votes = [0, 0, 0, 0, 0]; pr.forEach(g => { if (g >= 0) votes[g]++; });
    const mx = Math.max(...votes), uniq = votes.filter(v => v === mx).length === 1;
    const b5 = (mx >= 4 && uniq) ? votes.indexOf(mx) : -1;
    // группы столбцов по ПРОШЛОМУ тиражу (t-1): группа = число шаров столбца
    const prev = e.counts[t - 1], cb = [[], [], [], [], []]; prev.forEach((c, i) => cb[Math.min(c, 4)].push(i + 1));
    const m7 = pr[5], y = pr[0], F = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];           // порядок заполнения: номер по возрастанию
    const colsOf = g => (g === null || g === undefined || g < 0) ? [] : cb[g];
    const build = seq => { const o = []; seq.concat(F).forEach(c => { if (!o.includes(c)) o.push(c); }); return o.slice(0, 5); };
    const gord = [0, 1, 2, 3, 4].sort((a, b) => (votes[b] - votes[a]) || (cb[b].length - cb[a].length) || (a - b));
    const gof = {}; cb.forEach((l, g) => l.forEach(c => gof[c] = g));
    const A = build(colsOf(b5).concat(colsOf(m7))), B = build(colsOf(b5).concat(colsOf(y)));
    const V = build(colsOf(b5).concat(...gord.map(g => cb[g])));
    const sc = c => [2 * (b5 >= 0 && gof[c] === b5 ? 1 : 0) + (m7 >= 0 && gof[c] === m7 ? 1 : 0) + (y >= 0 && gof[c] === y ? 1 : 0), votes[gof[c]], -(c - 1)];
    const Gg = F.slice().sort((a, b) => { const x = sc(a), z = sc(b); return (z[0] - x[0]) || (z[1] - x[1]) || (z[2] - x[2]); }).slice(0, 5);
    const main = b5 >= 0 ? cb[b5].slice() : [];
    const reasons = pr.map((g, i) => ({ rule: POOL[i], group: g < 0 ? null : GN[g], source: src[i] }));
    return { version: VERSION, target: { draw: tg.draw, date: tg.date, time: tg.time }, votes, maxVotes: mx, uniqueLeader: uniq,
      signal: b5 >= 0, b5Group: b5 >= 0 ? GN[b5] : null, b5Index: b5, mainColumns: main, emptyMainGroup: b5 >= 0 && main.length === 0,
      groups: cb, five: { A, B, V, G: Gg }, reasons,
      note: b5 >= 0 ? 'Сигнал В5: ' + votes[b5] + ' голосов за ' + GN[b5] : 'Сигнала В5 нет (макс. голосов ' + mx + (uniq ? '' : ', ничья') + ' < 4 или ничья); пятёрка строится из запасных правил' };
  }

  // ---------- журнал прогнозов: сохраняется ДО тиража, затем автоматически проверяется ----------
  const KEY = 'virtus_b5_predictions_v1';
  const mem = {}; const defaultStore = { get: k => (typeof localStorage !== 'undefined' ? JSON.parse(localStorage.getItem(k) || 'null') : mem[k] || null), set: (k, v) => { if (typeof localStorage !== 'undefined') localStorage.setItem(k, JSON.stringify(v)); else mem[k] = v; } };
  function savePrediction(pred, store) {
    store = store || defaultStore; const log = store.get(KEY) || [];
    if (log.some(r => r.draw === pred.target.draw)) return false;                 // не перезаписывать уже сохранённый прогноз
    log.push({ draw: pred.target.draw, date: pred.target.date, time: pred.target.time, savedAt: new Date().toISOString(), votes: pred.votes, b5Group: pred.b5Group, mainColumns: pred.mainColumns, five: pred.five, winner: null, result: null });
    store.set(KEY, log); return true;
  }
  function settle(history, store) {                                              // проверка HIT/MISS по официальному столбцу
    store = store || defaultStore; const log = store.get(KEY) || [], byDraw = new Map(history.map(d => [d.draw, d]));
    log.forEach(r => { const d = byDraw.get(r.draw); if (d && typeof d.column === 'number' && r.winner === null) { r.winner = d.column; r.result = { A: r.five.A.includes(d.column), B: r.five.B.includes(d.column), V: r.five.V.includes(d.column), G: r.five.G.includes(d.column), b5Group: r.b5Group ? r.mainColumns.includes(d.column) : null }; } });
    store.set(KEY, log); return log;
  }
  function summary(store) {
    const log = (store || defaultStore).get(KEY) || [], done = log.filter(r => r.winner !== null), out = { predictions: log.length, settled: done.length };
    ['A', 'B', 'V', 'G'].forEach(k => { const h = done.filter(r => r.result[k]).length; out[k] = { hits: h, misses: done.length - h, rate: done.length ? h / done.length : null, randomLevel: 0.5 }; });
    const sg = done.filter(r => r.b5Group && r.mainColumns.length); out.b5Group = { signals: sg.length, hits: sg.filter(r => r.result.b5Group).length, expected: sg.reduce((s, r) => s + r.mainColumns.length / 10, 0) };
    return out;
  }
  const api = { VERSION, POOL, createEngine, predictAt, nextTarget, predictNext: history => { const e = createEngine(history); return predictAt(e, e.N); }, savePrediction, settle, summary };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.VirtusB5 = api;
})(typeof window !== 'undefined' ? window : globalThis);