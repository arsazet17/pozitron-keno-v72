'use strict';

/*
  ПОЗИТРОН КЕНО v7.2
  Широкая рамка "СЛЕД ТИРАЖ №... · HH:MM"
  Вставляется между зелёным информационным блоком и ПОСЛЕДНИМ ТИРАЖОМ.
*/

(() => {
  const STORAGE_KEY = 'pozitron_v5_draws';

  const SCHEDULE = [
    '00:02','00:17','00:32','01:02','01:17','01:32',
    '02:02','02:17','02:32','03:02','03:32','04:02',
    '04:17','04:32','05:02','05:17','05:32','06:02',
    '06:17','06:32','07:02','07:32','08:02','08:17',
    '08:32','09:02','09:17','09:32','10:02','10:17',
    '10:32','11:02','11:32','12:02','12:17','12:32',
    '13:02','13:17','13:32','14:02','14:17','14:32',
    '15:02','15:32','16:02','16:17','16:32','17:02',
    '17:17','17:32','18:02','18:17','18:32','19:02',
    '19:32','20:02','20:17','20:32','21:02','21:17',
    '21:32','22:02','22:17','22:32','23:02','23:32'
  ];

  function safeJson(raw, fallback) {
    try { return JSON.parse(raw); } catch (_) { return fallback; }
  }

  function normTime(v) {
    return String(v || '').match(/\d{1,2}:\d{2}/)?.[0] || '';
  }

  function latestDraw() {
    const a = safeJson(localStorage.getItem(STORAGE_KEY) || '[]', []);
    if (!Array.isArray(a) || !a.length) return null;

    return a
      .filter(x => Number.isFinite(Number(x?.draw)))
      .sort((x, y) => Number(x.draw) - Number(y.draw))
      .at(-1) || null;
  }

  function nextTarget(latest) {
    if (!latest) return null;

    const draw = Number(latest.draw) + 1;
    const m = normTime(latest.time).match(/(\d{1,2}):(\d{2})/);

    if (!m) return { draw, time: '—' };

    const current = Number(m[1]) * 60 + Number(m[2]);

    const schedule = SCHEDULE.map(t => {
      const [h, min] = t.split(':').map(Number);
      return { time: t, minutes: h * 60 + min };
    });

    const next = schedule.find(x => x.minutes > current) || schedule[0];
    return { draw, time: next.time };
  }

  function ensureStyle() {
    if (document.getElementById('nextDrawBannerStyle')) return;

    const style = document.createElement('style');
    style.id = 'nextDrawBannerStyle';
    style.textContent = `
      #nextDrawBannerV72{
        width:100%;
        margin:0 0 10px;
        padding:15px 16px;
        border:2px solid #4ade80;
        border-radius:14px;
        background:rgba(14,27,45,.98);
        box-shadow:0 5px 18px rgba(0,0,0,.18);
        color:#f4f8ff;
        text-align:center;
        font-weight:950;
        font-size:20px;
        line-height:1.2;
        letter-spacing:.2px;
      }
      #nextDrawBannerV72 .nd-label{
        color:#9eafc4;
        margin-right:6px;
      }
      #nextDrawBannerV72 .nd-draw{
        color:#ffffff;
      }
      #nextDrawBannerV72 .nd-time{
        color:#72df95;
      }
    `;
    document.head.appendChild(style);
  }

  function ensureBanner() {
    const cards = document.getElementById('cards');
    if (!cards) return null;

    let banner = document.getElementById('nextDrawBannerV72');
    if (!banner) {
      banner = document.createElement('div');
      banner.id = 'nextDrawBannerV72';
      cards.parentNode.insertBefore(banner, cards);
    }
    return banner;
  }

  function render() {
    ensureStyle();
    const banner = ensureBanner();
    if (!banner) return;

    const latest = latestDraw();
    const target = nextTarget(latest);

    if (!target) {
      banner.innerHTML = `
        <span class="nd-label">СЛЕД ТИРАЖ</span>
        <span class="nd-draw">—</span>
      `;
      return;
    }

    banner.innerHTML = `
      <span class="nd-label">СЛЕД ТИРАЖ</span>
      <span class="nd-draw">№${target.draw} · </span>
      <span class="nd-time">${target.time}</span>
    `;
  }

  function afterUpdate() {
    setTimeout(render, 700);
    setTimeout(render, 1800);
  }

  function boot() {
    render();

    // Когда приложение закончило штатное обновление, status меняется.
    // Слушаем только этот маленький элемент, не весь DOM.
    const status = document.getElementById('status');
    if (status) {
      const observer = new MutationObserver(afterUpdate);
      observer.observe(status, {
        childList: true,
        characterData: true,
        subtree: true
      });
    }

    document.getElementById('sync')?.addEventListener('click', afterUpdate);
    document.getElementById('sync2')?.addEventListener('click', afterUpdate);

    window.addEventListener('pageshow', render);
    window.addEventListener('focus', render);
    document.addEventListener('visibilitychange', () => {
      if (!document.hidden) render();
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot, { once: true });
  } else {
    boot();
  }
})();
