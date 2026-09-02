/*
 KENO v7.2.x — Analog+ sync guard
 Purpose: prevent Analog+ from lagging behind the latest draw.
 Does NOT change prediction/scoring logic. It only guarantees that Analog+
 is recalculated/refreshed after a new draw appears.

 Integration:
   <script src="./analog-sync-fix.js?v=1"></script>
 Place AFTER the existing app scripts, before </body>.

 Behavior:
   latest draw = N
   expected Analog+ "Выход" = N + 1
   If Analog+ still shows <= N, the guard:
     1) emits keno:analog-sync-needed
     2) clicks the existing "Обновить" control once
     3) waits
     4) if still stale, performs one cache-busted reload
   Loop protection is stored in sessionStorage.
*/
(() => {
  'use strict';

  const CFG = {
    checkEveryMs: 4000,
    afterRefreshWaitMs: 5000,
    hardReloadAfterMs: 9000,
    sessionKey: 'keno-v72-analog-sync-last-fixed-draw'
  };

  const norm = s => String(s || '').replace(/\s+/g, ' ').trim();

  function bodyText() {
    return norm(document.body?.innerText || '');
  }

  function parseLatestDraw() {
    const t = bodyText();

    // Prefer the explicit "ПОСЛЕДНИЙ ТИРАЖ" card.
    let m = t.match(/ПОСЛЕДНИЙ\s+ТИРАЖ\s*№\s*(\d+)/i);
    if (m) return Number(m[1]);

    // Fallback: all draw numbers, use max.
    const nums = [...t.matchAll(/№\s*(\d{5,})/g)].map(x => Number(x[1]));
    return nums.length ? Math.max(...nums) : null;
  }

  function parseAnalogOutput() {
    const t = bodyText();

    // Exact Analog+ heading.
    const matches = [...t.matchAll(/ВЫХОД\s*№\s*(\d+)/gi)].map(x => Number(x[1]));
    if (!matches.length) return null;

    // In normal state the current Analog+ output is the greatest "Выход №".
    return Math.max(...matches);
  }

  function onAnalogPage() {
    const t = bodyText();
    return /АНАЛОГ\+|ВЕРОЯТНОЕ\s+ПРОДОЛЖЕНИЕ\s+РЕЖИМА|ВЫХОД\s*№/i.test(t);
  }

  function findRefreshControl() {
    const els = [...document.querySelectorAll('button, a, [role="button"], nav *')];
    return els.find(el => /^обновить$/i.test(norm(el.textContent))) ||
           els.find(el => /обновить/i.test(norm(el.textContent)));
  }

  function emit(detail) {
    try {
      window.dispatchEvent(new CustomEvent('keno:analog-sync-needed', { detail }));
    } catch (_) {}
  }

  let busy = false;

  async function fixIfNeeded() {
    if (busy || !onAnalogPage()) return;

    const latest = parseLatestDraw();
    const output = parseAnalogOutput();
    if (!latest || !output) return;

    const expected = latest + 1;

    // Correct: Analog+ is already calculating the next draw.
    if (output === expected) return;

    // If it somehow ran ahead, do not interfere.
    if (output > expected) return;

    // Stale state: Analog+ output is current/past draw.
    const alreadyFixed = Number(sessionStorage.getItem(CFG.sessionKey) || 0);
    if (alreadyFixed === latest) return;

    busy = true;
    emit({ latestDraw: latest, analogOutput: output, expectedOutput: expected });

    // First try the app's own refresh route.
    const refresh = findRefreshControl();
    if (refresh) {
      try { refresh.click(); } catch (_) {}
      await new Promise(r => setTimeout(r, CFG.afterRefreshWaitMs));
    }

    const latest2 = parseLatestDraw();
    const output2 = parseAnalogOutput();
    const expected2 = latest2 ? latest2 + 1 : expected;

    if (latest2 && output2 === expected2) {
      sessionStorage.setItem(CFG.sessionKey, String(latest2));
      busy = false;
      return;
    }

    // Mark before reload to prevent reload loops.
    sessionStorage.setItem(CFG.sessionKey, String(latest2 || latest));

    // One cache-busted reload so stale JS/data cannot survive.
    setTimeout(() => {
      try {
        const u = new URL(location.href);
        u.searchParams.set('_analog_sync', String(Date.now()));
        location.replace(u.toString());
      } catch (_) {
        location.reload();
      }
    }, Math.max(0, CFG.hardReloadAfterMs - CFG.afterRefreshWaitMs));
  }

  // Run on load, tab return, and periodically.
  window.addEventListener('load', () => setTimeout(fixIfNeeded, 1200));
  window.addEventListener('focus', () => setTimeout(fixIfNeeded, 300));
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) setTimeout(fixIfNeeded, 300);
  });

  // Allow the main update pipeline to explicitly trigger the guard:
  // window.dispatchEvent(new Event('keno:draw-updated'))
  window.addEventListener('keno:draw-updated', () => setTimeout(fixIfNeeded, 300));

  setInterval(fixIfNeeded, CFG.checkEveryMs);
})();
