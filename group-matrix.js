'use strict';
/*
  ПОЗИТРОН КЕНО · Матрица групп (этап 1)
  Группа столба для тиража N = сколько чисел было в этом столбе в ПРЕДЫДУЩЕМ тираже N−1
  (так же, как «(гр…)» в цепочках столбов): ГР0, ГР1, ГР2, ГР3, ГР4+.
  Строка — тираж N, колонки — группы. В клетке — столбы группы или (по нажатию)
  числа тиража N, которые выпали в этих столбах.
  Нажатие на группу: столбы → числа → только чёт → только нечёт → столбы.
  Нажатие на число отмечает его во всей матрице.
*/
(() => {
  const $ = id => document.getElementById(id);
  const GROUPS = [1, 2, 3, 4, 0];
  const GNAME = g => g === 4 ? 'ГР4+' : 'ГР' + g;
  const MODES = ['cols', 'nums', 'even', 'odd'];
  const MODE_LABEL = { cols: 'столбы', nums: 'числа', even: 'чёт', odd: 'нечёт' };
  const KEY = 'pozitron_group_matrix_v1';
  const col = n => n % 10 === 0 ? 10 : n % 10;
  const pad = n => String(n).padStart(2, '0');

  const state = { count: 50, reverse: false, tir: false, modes: { 0: 'cols', 1: 'cols', 2: 'cols', 3: 'cols', 4: 'cols' }, marks: [] };
  try { Object.assign(state, JSON.parse(localStorage.getItem(KEY) || '{}')); } catch (_) {}
  const marks = new Set((state.marks || []).map(Number));
  function save() {
    state.marks = [...marks];
    try { localStorage.setItem(KEY, JSON.stringify(state)); } catch (_) {}
  }

  const modesFor = () => MODES;
  function modeOf(g) { const m = state.modes[g] || 'cols'; return modesFor(g).includes(m) ? m : 'cols'; }
  function list() { try { return Array.isArray(draws) ? draws : []; } catch (_) { return []; } }

  // Разбивка тиража d на группы по предыдущему тиражу prev: { g: { cols:[...], nums:[...] } }
  // Два режима: обычный — группа по предыдущему тиражу (откуда вышел столб, как в цепочках);
  // ТИР — настоящие группы самого тиража (сколько чисел выпало в столбе в этом же тираже).
  const cache = new WeakMap(), cacheTir = new WeakMap();
  function byColumn(d) {
    const out = Array.from({ length: 11 }, () => []);
    for (const n of d.balls) out[col(Number(n))].push(Number(n));
    return out;
  }
  function groupsOf(d, prev) {
    const store = state.tir ? cacheTir : cache;
    if (store.has(d)) return store.get(d);
    const out = {};
    for (const g of GROUPS) out[g] = { cols: [], nums: [] };
    if (!state.tir && !prev) return out;
    const now = byColumn(d), before = state.tir ? now : byColumn(prev);
    for (let c = 1; c <= 10; c++) {
      const g = Math.min(4, before[c].length);
      out[g].cols.push(c);
      out[g].nums.push(...now[c]);
    }
    for (const g of GROUPS) out[g].nums.sort((a, b) => a - b);
    store.set(d, out);
    return out;
  }
  function winnerOf(d) {
    try { if (typeof analysis === 'function') return analysis(d).winner; } catch (_) {}
    return Number(d.column) || 0;
  }

  function cellHtml(d, prev, g) {
    const grp = groupsOf(d, prev)[g], mode = modeOf(g), win = winnerOf(d);
    const hasWin = grp.cols.includes(win);
    const parity = x => mode === 'even' ? x % 2 === 0 : mode === 'odd' ? x % 2 === 1 : true;
    let inner = '';
    // В режиме ТИР у ГР0 чисел нет — показываем её пустые столбы
    if (mode === 'cols' || (state.tir && g === 0)) {
      inner = grp.cols.filter(parity).map(c => `<span class="gm-c${c === win ? ' gm-win' : ''}">${c}</span>`).join('');
    } else {
      inner = grp.nums.filter(parity).map(n => `<span class="gm-n${marks.has(n) ? ' gm-mark' : ''}${col(n) === win ? ' gm-winn' : ''}" data-gm-num="${n}">${pad(n)}</span>`).join('');
    }
    const empty = !inner;
    return `<td class="gm-cell${empty ? ' gm-empty' : ''}${hasWin ? ' gm-has-win' : ''}">${inner}</td>`;
  }

  function headHtml() {
    return '<tr><th class="gm-draw">Тираж</th>' + GROUPS.map(g => {
      const m = modeOf(g);
      return `<th><button type="button" class="gm-head gm-m-${m}" data-gm-group="${g}">${GNAME(g)}<small>${MODE_LABEL[m]}</small></button></th>`;
    }).join('') + '<th class="gm-time">Время</th></tr>';
  }

  function render() {
    const panel = $('groupMatrixPanel');
    if (!panel || !panel.classList.contains('show')) return;
    const all = list();
    const start = Math.max(0, all.length - state.count);
    const shown = all.slice(start).map((d, k) => {
      const p = all[start + k - 1];
      return [d, p && Number(p.draw) === Number(d.draw) - 1 ? p : null];
    });
    const rows = (state.reverse ? [...shown].reverse() : shown).map(([d, prev]) =>
      `<tr><td class="gm-draw">№${String(d.draw).slice(-3)}</td>${GROUPS.map(g => cellHtml(d, prev, g)).join('')}<td class="gm-time">${String(d.time || '').slice(0, 5)}</td></tr>`
    ).join('');
    const scroller = panel.querySelector('.gm-scroll');
    const atEnd = !scroller || scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight < 40;
    const prevTop = scroller ? scroller.scrollTop : 0;
    panel.innerHTML = `
      <div class="gm-bar">
        <b>🔢 Матрица групп</b>
        <label class="gm-count">Тир. <input id="gmCount" type="tel" inputmode="numeric" maxlength="4" value="${state.count}" aria-label="Сколько тиражей показать"></label>
        <button type="button" class="gm-btn" data-gm-action="reverse">↑↓</button>
        <button type="button" class="gm-btn" data-gm-action="all-nums">Все числа</button>
        <button type="button" class="gm-btn" data-gm-action="all-cols">Все столбы</button>
        <button type="button" class="gm-btn gm-tir${state.tir ? ' on' : ''}" data-gm-action="tir" aria-pressed="${state.tir}" title="Настоящие группы самого тиража">ТИР</button>
        ${marks.size ? `<button type="button" class="gm-btn gm-clear" data-gm-action="clear">✕ отметки (${marks.size})</button>` : ''}
      </div>
      <div class="gm-note">${state.tir
        ? '<b>ТИР включён:</b> настоящие группы тиража — сколько чисел выпало в столбе в этом же тираже: ГР0 — пусто, ГР1 — одно, ГР2 — два… Жёлтая рамка — группа выигравшего столба, зелёным — сам столб.'
        : 'Группа столба — сколько чисел было в нём в <b>предыдущем</b> тираже (как «гр» в цепочках): ГР0 — ни одного, ГР1 — одно, ГР2 — два… Жёлтая рамка — из какой группы вышел выигравший столб, зелёным — сам столб. Кнопка <b>ТИР</b> — настоящие группы самого тиража.'} Нажми на группу: столбы → числа → чёт → нечёт. Нажми на число — отметится синим везде.</div>
      <div class="gm-scroll"><table class="gm-table"><thead>${headHtml()}</thead><tbody>${rows}</tbody></table></div>`;
    const sc = panel.querySelector('.gm-scroll');
    if (sc) sc.scrollTop = state.reverse ? (atEnd ? 0 : prevTop) : (atEnd ? sc.scrollHeight : prevTop);
  }

  function toggleOpen(button) {
    const panel = $('groupMatrixPanel');
    if (!panel) return;
    const open = !panel.classList.contains('show');
    panel.classList.toggle('show', open);
    button.classList.toggle('on', open);
    button.setAttribute('aria-expanded', String(open));
    if (open) { render(); panel.scrollIntoView({ behavior: 'smooth', block: 'start' }); }
  }

  document.addEventListener('click', e => {
    const opener = e.target.closest('#groupMatrixBtn');
    if (opener) { e.preventDefault(); toggleOpen(opener); return; }
    const panel = $('groupMatrixPanel');
    if (!panel || !panel.contains(e.target)) return;
    const head = e.target.closest('[data-gm-group]');
    if (head) {
      const g = Number(head.dataset.gmGroup), list = modesFor(g), m = modeOf(g);
      state.modes[g] = list[(list.indexOf(m) + 1) % list.length];
      save(); render(); return;
    }
    const num = e.target.closest('[data-gm-num]');
    if (num) {
      const n = Number(num.dataset.gmNum);
      if (marks.has(n)) marks.delete(n); else marks.add(n);
      save(); render(); return;
    }
    const act = e.target.closest('[data-gm-action]');
    if (!act) return;
    const a = act.dataset.gmAction;
    if (a === 'reverse') state.reverse = !state.reverse;
    if (a === 'all-nums') GROUPS.forEach(g => { state.modes[g] = 'nums'; });
    if (a === 'all-cols') GROUPS.forEach(g => { state.modes[g] = 'cols'; });
    if (a === 'tir') state.tir = !state.tir;
    if (a === 'clear') marks.clear();
    save(); render();
  });
  document.addEventListener('change', e => {
    if (e.target.id === 'gmCount') applyCount(e.target);
  });
  // Любое количество тиражей: от 1 до MAX_ROWS (больше телефон рисует слишком долго)
  const MAX_ROWS = 2000;
  function applyCount(input) {
    const n = Math.round(Number(String(input.value).replace(/\D/g, '')));
    state.count = Math.min(MAX_ROWS, Math.max(1, n || state.count || 50));
    input.value = state.count;
    save(); render();
  }
  document.addEventListener('keydown', e => {
    if (e.target.id === 'gmCount' && e.key === 'Enter') { e.preventDefault(); e.target.blur(); }
  });
  window.addEventListener('keno:draws', render);
})();
