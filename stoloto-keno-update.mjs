import fs from 'node:fs/promises';
import process from 'node:process';
import { chromium } from 'playwright';

const LOGIN_URL = 'https://oauth.stoloto.ru/login';
const ARCHIVE_URL = 'https://m.stoloto.ru/keno2/archive/';
const HISTORY_FILE = 'keno-history.json';
const TAIL_SIZE = 10;

const EMAIL = process.env.STOLOTO_EMAIL || '';
const PASSWORD = process.env.STOLOTO_PASSWORD || '';

if (!EMAIL || !PASSWORD) {
  throw new Error('FAIL: нет GitHub Secrets STOLOTO_EMAIL / STOLOTO_PASSWORD');
}

const MONTHS = {
  'января': 1, 'февраля': 2, 'марта': 3, 'апреля': 4,
  'мая': 5, 'июня': 6, 'июля': 7, 'августа': 8,
  'сентября': 9, 'октября': 10, 'ноября': 11, 'декабря': 12
};

const pad2 = n => String(n).padStart(2, '0');
const norm = s => String(s ?? '').replace(/\u00a0/g, ' ').replace(/[ \t]+/g, ' ').trim();

function moscowTodayParts() {
  const f = new Intl.DateTimeFormat('ru-RU', {
    timeZone: 'Europe/Moscow',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  });
  const p = Object.fromEntries(f.formatToParts(new Date()).map(x => [x.type, x.value]));
  return { y: Number(p.year), m: Number(p.month), d: Number(p.day) };
}

function shiftDate({ y, m, d }, delta) {
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + delta);
  return { y: dt.getUTCFullYear(), m: dt.getUTCMonth() + 1, d: dt.getUTCDate() };
}

function normalizeDateLabel(label) {
  const raw = norm(label).toLowerCase();
  const today = moscowTodayParts();
  let p = null;

  if (raw === 'сегодня') p = today;
  else if (raw === 'вчера') p = shiftDate(today, -1);
  else {
    let m = raw.match(/^(\d{1,2})[.\-/](\d{1,2})[.\-/](\d{2,4})$/);
    if (m) {
      let y = Number(m[3]);
      if (y < 100) y += 2000;
      p = { d: Number(m[1]), m: Number(m[2]), y };
    } else {
      m = raw.match(/^(\d{1,2})\s+([а-яё]+)(?:\s+(\d{4}))?$/i);
      if (m && MONTHS[m[2]]) {
        let y = m[3] ? Number(m[3]) : today.y;
        p = { d: Number(m[1]), m: MONTHS[m[2]], y };
        if (!m[3] && p.m > today.m + 6) p.y -= 1;
      }
    }
  }

  return p ? `${pad2(p.d)}.${pad2(p.m)}.${String(p.y).slice(-2)}` : null;
}

function normalizeTime(v) {
  const m = String(v ?? '').match(/(\d{1,2}):(\d{2})(?::(\d{2}))?/);
  if (!m) return null;
  const hh = Number(m[1]), mm = Number(m[2]), ss = Number(m[3] || 0);
  if (hh > 23 || mm > 59 || ss > 59) return null;
  return { short: `${pad2(hh)}:${pad2(mm)}`, full: `${pad2(hh)}:${pad2(mm)}:${pad2(ss)}` };
}

function parseDraw(text) {
  const m = String(text).match(/№\s*([0-9]{4,})/);
  return m ? Number(m[1]) : null;
}

function parseTime(text) {
  const m = String(text).match(/\b([01]?\d|2[0-3]):[0-5]\d(?::[0-5]\d)?\b/);
  return m ? normalizeTime(m[0]) : null;
}

function parseParity(text) {
  const s = norm(text).toLowerCase();
  if (s.includes('больше нечётных') || s.includes('больше нечетных')) return 'Больше нечётных';
  if (s.includes('больше чётных') || s.includes('больше четных')) return 'Больше чётных';
  if (s.includes('поровну')) return 'Поровну';
  return null;
}

function parseColumn(text) {
  const m = norm(text).match(/столбец\s*([1-9]|10)\b/i);
  return m ? Number(m[1]) : null;
}

function findDateLabel(text) {
  const s = String(text);
  let m = s.match(/(?:^|\n)\s*(Сегодня|Вчера)\s*(?:\n|$)/i);
  if (m) return norm(m[1]);

  m = s.match(/(?:^|\n)\s*(\d{1,2}[.\-/]\d{1,2}[.\-/]\d{2,4})\s*(?:\n|$)/);
  if (m) return norm(m[1]);

  m = s.match(/(?:^|\n)\s*(\d{1,2}\s+(?:января|февраля|марта|апреля|мая|июня|июля|августа|сентября|октября|ноября|декабря)(?:\s+\d{4})?)\s*(?:\n|$)/i);
  return m ? norm(m[1]) : null;
}

async function login(page) {
  await page.goto(LOGIN_URL, { waitUntil: 'domcontentloaded', timeout: 60000 });

  const loginSelectors = [
    'input[type="email"]',
    'input[name*="email" i]',
    'input[name*="login" i]',
    'input[autocomplete="username"]',
    'input[type="text"]'
  ];
  const passSelectors = [
    'input[type="password"]',
    'input[name*="password" i]',
    'input[autocomplete="current-password"]'
  ];

  let loginField = null;
  let passField = null;

  for (const sel of loginSelectors) {
    const loc = page.locator(sel).first();
    if (await loc.count()) { loginField = loc; break; }
  }
  for (const sel of passSelectors) {
    const loc = page.locator(sel).first();
    if (await loc.count()) { passField = loc; break; }
  }

  if (!loginField || !passField) throw new Error('FAIL: не найдены поля OAuth Столото');

  await loginField.fill(EMAIL);
  await passField.fill(PASSWORD);

  const buttons = [
    page.getByRole('button', { name: /войти/i }).first(),
    page.locator('button[type="submit"]').first(),
    page.locator('input[type="submit"]').first()
  ];

  let clicked = false;
  for (const btn of buttons) {
    if (await btn.count()) {
      await btn.click();
      clicked = true;
      break;
    }
  }
  if (!clicked) throw new Error('FAIL: не найдена кнопка «Войти»');

  await page.waitForLoadState('domcontentloaded', { timeout: 60000 }).catch(() => {});
  await page.waitForTimeout(1800);
}

async function expandArchive(page, targetRows = TAIL_SIZE) {
  let lastCount = -1;
  let stableRounds = 0;

  for (let round = 0; round < 6; round += 1) {
    const currentCount = await page.locator('tr').evaluateAll(list =>
      list.filter(el => /№\s*\d{4,}/.test(el.innerText || '')).length
    );

    if (currentCount >= targetRows) break;

    if (currentCount === lastCount) stableRounds += 1;
    else stableRounds = 0;
    lastCount = currentCount;

    const more = page.getByRole('button', {
      name: /показать\s*(ещё|еще)|загрузить\s*(ещё|еще)|^(ещё|еще)$/i
    }).last();

    try {
      if (await more.count() && await more.isVisible()) {
        await more.click({ timeout: 3500 });
        await page.waitForTimeout(700);
        continue;
      }
    } catch {}

    const moreLink = page.getByRole('link', {
      name: /показать\s*(ещё|еще)|загрузить\s*(ещё|еще)|^(ещё|еще)$/i
    }).last();

    try {
      if (await moreLink.count() && await moreLink.isVisible()) {
        await moreLink.click({ timeout: 3500 });
        await page.waitForTimeout(700);
        continue;
      }
    } catch {}

    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await page.waitForTimeout(700);

    if (stableRounds >= 2) break;
  }

  await page.evaluate(() => window.scrollTo(0, 0));
}

async function collectRows(page) {
  await page.goto(ARCHIVE_URL, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForTimeout(2200);
  await expandArchive(page, TAIL_SIZE);

  return await page.locator('body').evaluate(() => {
    const drawRx = /№\s*\d{4,}/;
    const dateRx = /^(Сегодня|Вчера|\d{1,2}[.\/-]\d{1,2}[.\/-]\d{2,4}|\d{1,2}\s+(?:января|февраля|марта|апреля|мая|июня|июля|августа|сентября|октября|ноября|декабря)(?:\s+\d{4})?)$/i;
    const n = s => String(s || '').replace(/\u00a0/g, ' ').replace(/[ \t]+/g, ' ').trim();
    const all = [...document.querySelectorAll('body *')];

    function nearestDateLabel(el) {
      let best = null;
      for (const node of all) {
        if (node === el || el.contains(node)) continue;
        const pos = node.compareDocumentPosition(el);
        if (!(pos & Node.DOCUMENT_POSITION_FOLLOWING)) continue;

        const t = n(node.innerText || node.textContent || '');
        if (!t || t.length > 40 || !dateRx.test(t)) continue;
        if (node.children && node.children.length > 3) continue;
        best = t;
      }
      return best;
    }

    let candidates = [...document.querySelectorAll('tr')].filter(el => drawRx.test(el.innerText || ''));

    if (!candidates.length) {
      candidates = all.filter(el => {
        const text = n(el.innerText || '');
        if (!drawRx.test(text) || el.querySelectorAll('button').length < 20) return false;
        return ![...el.children].some(ch =>
          drawRx.test(n(ch.innerText || '')) && ch.querySelectorAll('button').length >= 20
        );
      });
    }

    return candidates.map(el => ({
      text: el.innerText || '',
      dateLabel: nearestDateLabel(el),
      buttons: [...el.querySelectorAll('button')].map(b => n(b.innerText || ''))
    }));
  });
}

function parseRows(rawRows) {
  const out = [];
  let carryDate = null;

  for (const row of rawRows) {
    const text = String(row.text || '');
    const localDate = norm(row.dateLabel || '') || findDateLabel(text);
    if (localDate) carryDate = localDate;

    const draw = parseDraw(text);
    if (!draw) continue;

    const time = parseTime(text);
    const parity = parseParity(text);
    const column = parseColumn(text);
    const date = normalizeDateLabel(localDate || carryDate);

    if (!time) throw new Error(`FAIL: №${draw}: не найдено корректное время`);
    if (!date) throw new Error(`FAIL: №${draw}: не распознана дата`);
    if (!parity) throw new Error(`FAIL: №${draw}: Столото не отдал метку чёт/нечёт`);
    if (!column) throw new Error(`FAIL: №${draw}: Столото не отдал «Столбец N»`);

    let balls = (row.buttons || [])
      .map(x => Number(norm(x)))
      .filter(n => Number.isInteger(n) && n >= 1 && n <= 80);

    if (balls.length > 20) balls = balls.slice(-20);
    if (balls.length !== 20) throw new Error(`FAIL: №${draw}: найдено ${balls.length} чисел вместо 20`);
    if (new Set(balls).size !== 20) throw new Error(`FAIL: №${draw}: числа должны быть без повторов`);

    out.push({
      draw,
      date,
      time: time.short,
      parity,
      column,
      balls
    });
  }

  return [...new Map(out.map(d => [d.draw, d])).values()]
    .sort((a, b) => a.draw - b.draw)
    .slice(-TAIL_SIZE);
}

function core(d) {
  return JSON.stringify({
    draw: d.draw,
    date: d.date,
    time: d.time,
    parity: d.parity,
    column: d.column,
    balls: d.balls
  });
}

async function readTailThreeTimes(page) {
  const reads = [];

  for (let i = 1; i <= 3; i += 1) {
    const parsed = parseRows(await collectRows(page));

    if (parsed.length < TAIL_SIZE) {
      throw new Error(`FAIL: чтение ${i}: получено ${parsed.length} из ${TAIL_SIZE} последних тиражей`);
    }

    reads.push(parsed);
    console.log(`Чтение ${i}: последние ${TAIL_SIZE}, №${parsed[0].draw}–№${parsed.at(-1).draw}`);

    if (i < 3) await page.waitForTimeout(900);
  }

  const first = reads[0].map(core);

  for (let i = 1; i < reads.length; i += 1) {
    const current = reads[i].map(core);
    if (current.length !== first.length || current.some((x, k) => x !== first[k])) {
      throw new Error(
        'SAFE RETRY: последние 10 изменились между тремя чтениями; следующий автоматический запуск проверит их снова'
      );
    }
  }

  console.log(`Тройная проверка PASS: ${TAIL_SIZE}/${TAIL_SIZE}`);
  return reads[0];
}

async function readTrustedHistory() {
  const raw = await fs.readFile(HISTORY_FILE, 'utf8');
  const parsed = JSON.parse(raw);
  const rows = Array.isArray(parsed) ? parsed : parsed?.draws;

  if (!Array.isArray(rows) || rows.length < 60) {
    throw new Error(`FAIL: keno-history.json не является доверенным полным архивом (${Array.isArray(rows) ? rows.length : 0})`);
  }

  return rows;
}

function normalizeHistoryDraw(d) {
  return {
    draw: Number(d?.draw ?? d?.number ?? d?.id),
    date: norm(d?.date),
    time: normalizeTime(d?.time)?.short || norm(d?.time),
    balls: Array.isArray(d?.balls) ? d.balls.map(Number) :
           Array.isArray(d?.numbers) ? d.numbers.map(Number) : []
  };
}

function scheduleMinutesFromHistory(history) {
  const set = new Set();
  for (const d of history.slice(-5000)) {
    const m = String(d.time ?? '').match(/^\d{2}:(\d{2})$/);
    if (m) set.add(m[1]);
  }
  return set;
}

function validateAndFindFresh(stoloto, historyRaw) {
  const history = historyRaw
    .map(d => ({ original: d, ...normalizeHistoryDraw(d) }))
    .filter(d =>
      Number.isInteger(d.draw) &&
      /^\d{2}\.\d{2}\.\d{2,4}$/.test(d.date) &&
      /^\d{2}:\d{2}$/.test(d.time) &&
      d.balls.length === 20
    )
    .sort((a, b) => a.draw - b.draw);

  if (history.length !== historyRaw.length) {
    throw new Error(`FAIL: в keno-history.json есть некорректные строки (${history.length}/${historyRaw.length})`);
  }

  const last = history.at(-1);
  const oldest = stoloto[0];
  const newest = stoloto.at(-1);

  if (!oldest || !newest) throw new Error('FAIL: последние 10 Столото пусты');

  // Последние 10 официальных номеров должны идти подряд.
  for (let i = 1; i < stoloto.length; i += 1) {
    if (stoloto[i].draw !== stoloto[i - 1].draw + 1) {
      throw new Error(`FAIL: официальный tail10 имеет разрыв №${stoloto[i - 1].draw} → №${stoloto[i].draw}`);
    }
  }

  const officialMap = new Map(stoloto.map(d => [d.draw, d]));
  const anchor = officialMap.get(last.draw);

  if (anchor) {
    if (anchor.date !== last.date) throw new Error(`FAIL: anchor №${last.draw}: дата отличается`);
    if (anchor.time !== last.time) throw new Error(`FAIL: anchor №${last.draw}: время отличается`);
    if (JSON.stringify(anchor.balls) !== JSON.stringify(last.balls)) {
      throw new Error(`FAIL: anchor №${last.draw}: 20 чисел отличаются`);
    }
  } else if (oldest.draw !== last.draw + 1) {
    throw new Error(
      `FAIL SAFE: локальная база слишком отстала для tail10. ` +
      `Локальный последний №${last.draw}, официальный tail начинается с №${oldest.draw}`
    );
  }

  const fresh = stoloto.filter(d => d.draw > last.draw);

  let expected = last.draw + 1;
  const allowedParity = new Set(['Больше чётных', 'Больше нечётных', 'Поровну']);
  const allowedMinutes = scheduleMinutesFromHistory(history);

  for (const d of fresh) {
    if (d.draw !== expected) {
      throw new Error(`FAIL: пропуск тиража: ожидался №${expected}, получен №${d.draw}`);
    }
    expected += 1;

    if (!/^\d{2}\.\d{2}\.\d{2}$/.test(d.date)) {
      throw new Error(`FAIL: №${d.draw}: неверная дата ${d.date}`);
    }
    if (!/^\d{2}:\d{2}$/.test(d.time)) {
      throw new Error(`FAIL: №${d.draw}: неверное время ${d.time}`);
    }
    if (allowedMinutes.size && !allowedMinutes.has(d.time.slice(3, 5))) {
      throw new Error(`FAIL: №${d.draw}: минута ${d.time.slice(3, 5)} не соответствует расписанию архива`);
    }
    if (!allowedParity.has(d.parity)) {
      throw new Error(`FAIL: №${d.draw}: нет официальной метки чёт/нечёт`);
    }
    if (!Number.isInteger(d.column) || d.column < 1 || d.column > 10) {
      throw new Error(`FAIL: №${d.draw}: нет официального «Столбец N»`);
    }
  }

  console.log(
    `Anchor PASS: локальный №${last.draw}; официальный tail №${oldest.draw}–№${newest.draw}; новых ${fresh.length}`
  );

  return { last, fresh, newest };
}

function mergeHistory(historyRaw, fresh) {
  const source = 'Официальный Столото · OAuth · tail10 · тройная проверка';
  const additions = fresh.map(d => ({
    draw: d.draw,
    date: d.date,
    time: d.time,
    balls: d.balls,
    parity: d.parity,
    column: d.column,
    source
  }));

  return [...historyRaw, ...additions]
    .sort((a, b) => Number(a.draw) - Number(b.draw));
}

const browser = await chromium.launch({ headless: true });

try {
  const context = await browser.newContext({
    locale: 'ru-RU',
    timezoneId: 'Europe/Moscow',
    viewport: { width: 390, height: 844 },
    userAgent: 'Mozilla/5.0 (Linux; Android 10) AppleWebKit/537.36 Chrome/131 Mobile Safari/537.36'
  });

  const page = await context.newPage();

  await login(page);

  const officialTail = await readTailThreeTimes(page);
  const historyRaw = await readTrustedHistory();
  const { last, fresh, newest } = validateAndFindFresh(officialTail, historyRaw);

  if (!fresh.length) {
    console.log(`KENO v7.2 TAIL10 PASS: новых тиражей нет; локальный №${last.draw}; официальный №${newest.draw}`);
  } else {
    const merged = mergeHistory(historyRaw, fresh);
    await fs.writeFile(HISTORY_FILE, JSON.stringify(merged) + '\n');

    const finalLast = merged.at(-1);
    console.log(
      `KENO v7.2 TAIL10 PASS: добавлено ${fresh.length}; новый последний №${finalLast.draw}; ` +
      `${finalLast.parity}; Столбец ${finalLast.column}`
    );
  }
} finally {
  await browser.close();
}
