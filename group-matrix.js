'use strict';
/*
  ПОЗИТРОН КЕНО · Матрица групп (этап 1)
  Группа столба в тираже = сколько чисел этого тиража попало в столб: ГР0, ГР1, ГР2, ГР3, ГР4+.
  Строка — тираж, колонки — группы. В клетке — столбы группы или (по нажатию) её числа.
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

  const state = { count: 50, reverse: false, modes: { 0: 'cols', 1: 'cols', 2: 'cols', 3: 'cols', 4: 'cols' }, marks: [] };
  try { Object.assign(state, JSON.parse(localStorage.getItem(KEY) || '{}')); } catch (_) {}
  const marks = new Set((state.marks || []).map(Number));
  function save() {
    state.marks = [...marks];
    try { localStorage.setItem(KEY, JSON.stringify(state)); } catch (_) {}
  }

  // У ГР0 чисел нет, поэтому у неё только столбы / чёт / нечёт
  const modesFor = g => g === 0 ? ['cols', 'even', 'odd'] : MODES;
  function modeOf(g) { const m = state.modes[g] || 'cols'; return modesFor(g).includes(m) ? m : 'cols'; }
  function list() { try { return Array.isArray(draws) ? draws : []; } catch (_) { return []; } }

  // Разбивка тиража на группы: { g: { cols:[...], nums:[...] } }
  const cache = new WeakMap();
  function groupsOf(d) {
    if (cache.has(d)) return cache.get(d);
    const byCol = Array.from({ length: 11 }, () => []);
    for (const n of d.balls) byCol[col(Number(n))].push(Number(n));
    const out = {};
    for (const g of GROUPS) out[g] = { cols: [], nums: [] };
    for (let c = 1; c <= 10; c++) {
      const g = Math.min(4, byCol[c].length);
      out[g].cols.push(c);
      out[g].nums.push(...byCol[c]);
    }
    for (const g of GROUPS) out[g].nums.sort((a, b) => a - b);
    cache.set(d, out);
    return out;
  }
  function winnerOf(d) {
    try { if (typeof analysis === 'function') return analysis(d).winner; } catch (_) {}
    return Number(d.column) || 0;
  }

  function cellHtml(d, g) {
    const grp = groupsOf(d)[g], mode = modeOf(g), win = winnerOf(d);
    const hasWin = grp.cols.includes(win);
    const parity = x => mode === 'even' ? x % 2 === 0 : mode === 'odd' ? x % 2 === 1 : true;
    let inner = '';
    if (mode === 'cols' || g === 0) {
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
    const shown = all.slice(-state.count);
    const rows = (state.reverse ? [...shown].reverse() : shown).map(d =>
      `<tr><td class="gm-draw">№${String(d.draw).slice(-3)}</td>${GROUPS.map(g => cellHtml(d, g)).join('')}<td class="gm-time">${String(d.time || '').slice(0, 5)}</td></tr>`
    ).join('');
    const scroller = panel.querySelector('.gm-scroll');
    const atEnd = !scroller || scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight < 40;
    const prevTop = scroller ? scroller.scrollTop : 0;
    panel.innerHTML = `
      <div class="gm-bar">
        <b>🔢 Матрица групп</b>
        <select id="gmCount" aria-label="Сколько тиражей">${[20, 50, 100, 200].map(n => `<option value="${n}"${state.count === n ? ' selected' : ''}>${n}</option>`).join('')}</select>
        <button type="button" class="gm-btn" data-gm-action="reverse">↑↓</button>
        <button type="button" class="gm-btn" data-gm-action="all-nums">Все числа</button>
        <button type="button" class="gm-btn" data-gm-action="all-cols">Все столбы</button>
        ${marks.size ? `<button type="button" class="gm-btn gm-clear" data-gm-action="clear">✕ отметки (${marks.size})</button>` : ''}
      </div>
      <div class="gm-note">Группа — сколько чисел выпало в столбе: ГР1 — одно, ГР2 — два… ГР0 — пусто. Нажми на группу: столбы → числа → чёт → нечёт. Нажми на число — оно отметится во всех тиражах. Жёлтым — выигравший столб.</div>
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
    if (a === 'all-nums') GROUPS.forEach(g => { if (g !== 0) state.modes[g] = 'nums'; });
    if (a === 'all-cols') GROUPS.forEach(g => { state.modes[g] = 'cols'; });
    if (a === 'clear') marks.clear();
    save(); render();
  });
  document.addEventListener('change', e => {
    if (e.target.id === 'gmCount') { state.count = Number(e.target.value) || 50; save(); render(); }
  });
  window.addEventListener('keno:draws', render);
})();
