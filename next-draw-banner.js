'use strict';

/*
  ПОЗИТРОН КЕНО v7.2.4 — HOTFIX баннера следующего тиража.
  Источник №/времени теперь тот же экранный ПОСЛЕДНИЙ ТИРАЖ (#cards),
  localStorage используется только как резерв.
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

  function safeJson(raw, fallback) { try { return JSON.parse(raw); } catch { return fallback; } }
  function normTime(v) { return String(v || '').match(/\b([01]?\d|2[0-3]):[0-5]\d\b/)?.[0]?.padStart(5,'0') || ''; }

  // Главный источник: реально показанная карточка «ПОСЛЕДНИЙ ТИРАЖ».
  function latestFromScreen() {
    const cards = document.getElementById('cards');
    if (!cards) return null;

    const candidates = [...cards.querySelectorAll('.card')];
    for (const card of candidates) {
      const text = String(card.innerText || card.textContent || '');
      if (!/ПОСЛЕДНИЙ\s+ТИРАЖ/i.test(text)) continue;
      const drawMatch = text.match(/№\s*(\d{4,})/);
      const timeMatch = text.match(/\b([01]?\d|2[0-3]):[0-5]\d\b/);
      if (!drawMatch || !timeMatch) continue;
      return { draw: Number(drawMatch[1]), time: normTime(timeMatch[0]), source: 'screen' };
    }

    // Резерв на случай изменения разметки: первая карточка с № и временем.
    for (const card of candidates) {
      const text = String(card.innerText || card.textContent || '');
      const drawMatch = text.match(/№\s*(\d{4,})/);
      const timeMatch = text.match(/\b([01]?\d|2[0-3]):[0-5]\d\b/);
      if (drawMatch && timeMatch) return { draw: Number(drawMatch[1]), time: normTime(timeMatch[0]), source: 'screen-fallback' };
    }
    return null;
  }

  function latestFromStorage() {
    const a = safeJson(localStorage.getItem(STORAGE_KEY) || '[]', []);
    if (!Array.isArray(a) || !a.length) return null;
    const latest = a.filter(x => Number.isFinite(Number(x?.draw)))
      .sort((x, y) => Number(x.draw) - Number(y.draw)).at(-1) || null;
    return latest ? { draw: Number(latest.draw), time: normTime(latest.time), source: 'storage' } : null;
  }

  function latestDraw() { return latestFromScreen() || latestFromStorage(); }

  function nextTarget(latest) {
    if (!latest) return null;
    const draw = Number(latest.draw) + 1;
    const m = normTime(latest.time).match(/(\d{2}):(\d{2})/);
    if (!m) return { draw, time: '—' };
    const current = Number(m[1]) * 60 + Number(m[2]);
    const schedule = SCHEDULE.map(time => {
      const [h, min] = time.split(':').map(Number);
      return { time, minutes: h * 60 + min };
    });
    const next = schedule.find(x => x.minutes > current) || schedule[0];
    return { draw, time: next.time };
  }

  function ensureStyle() {
    if (document.getElementById('nextDrawBannerStyle')) return;
    const style = document.createElement('style');
    style.id = 'nextDrawBannerStyle';
    style.textContent = `
      #nextDrawBannerV72{width:100%;margin:0 0 10px;padding:15px 16px;border:2px solid #4ade80;border-radius:14px;background:rgba(14,27,45,.98);box-shadow:0 5px 18px rgba(0,0,0,.18);color:#f4f8ff;text-align:center;font-weight:950;font-size:20px;line-height:1.2;letter-spacing:.2px}
      #nextDrawBannerV72 .nd-label{color:#9eafc4;margin-right:6px}
      #nextDrawBannerV72 .nd-draw{color:#fff}
      #nextDrawBannerV72 .nd-time{color:#72df95}
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
      banner.innerHTML = '<span class="nd-label">СЛЕД ТИРАЖ</span><span class="nd-draw">—</span>';
      return;
    }
    banner.innerHTML = `<span class="nd-label">СЛЕД ТИРАЖ</span><span class="nd-draw">№${target.draw} · </span><span class="nd-time">${target.time}</span>`;
  }

  function afterUpdate() {
    // Карточки могут перерисоваться чуть позже status — несколько коротких повторов.
    [50, 250, 700, 1500, 2600].forEach(ms => setTimeout(render, ms));
  }

  function boot() {
    render();
    const status = document.getElementById('status');
    if (status) new MutationObserver(afterUpdate).observe(status, { childList:true, characterData:true, subtree:true });
    const cards = document.getElementById('cards');
    if (cards) new MutationObserver(afterUpdate).observe(cards, { childList:true, subtree:true });
    document.getElementById('sync')?.addEventListener('click', afterUpdate);
    document.getElementById('sync2')?.addEventListener('click', afterUpdate);
    window.addEventListener('pageshow', afterUpdate);
    window.addEventListener('focus', afterUpdate);
    document.addEventListener('visibilitychange', () => { if (!document.hidden) afterUpdate(); });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot, { once:true });
  else boot();
})();
