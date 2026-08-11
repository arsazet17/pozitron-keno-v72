import fs from 'node:fs/promises';
import process from 'node:process';
import { chromium } from 'playwright';

const LOGIN_URL = 'https://oauth.stoloto.ru/login';
const ARCHIVE_URL = 'https://m.stoloto.ru/keno2/archive/';
const HISTORY_FILE = 'keno-history.json';

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

function normalizeSpace(s) {
  return String(s ?? '').replace(/\u00a0/g, ' ').replace(/[ \t]+/g, ' ').trim();
}

function moscowTodayParts() {
  const f = new Intl.DateTimeFormat('ru-RU', {
    timeZone: 'Europe/Moscow', year: 'numeric', month: '2-digit', day: '2-digit'
  });
  const parts = Object.fromEntries(f.formatToParts(new Date()).map(x => [x.type, x.value]));
  return { y: Number(parts.year), m: Number(parts.month), d: Number(parts.day) };
}

function shiftDate({y,m,d}, deltaDays) {
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + deltaDays);
  return { y: dt.getUTCFullYear(), m: dt.getUTCMonth() + 1, d: dt.getUTCDate() };
}

function normalizeDateLabel(label) {
  const raw = normalizeSpace(label).toLowerCase();
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
        // На границе года декабрь в январе должен относиться к прошлому году.
        if (!m[3] && p.m > today.m + 6) p.y -= 1;
      }
    }
  }

  if (!p) return null;
  return `${pad2(p.d)}.${pad2(p.m)}.${String(p.y).slice(-2)}`;
}

function normalizeTime(t) {
  const m = String(t ?? '').match(/(\d{1,2}):(\d{2})(?::(\d{2}))?/);
  if (!m) return null;
  const hh = Number(m[1]), mm = Number(m[2]), ss = Number(m[3] || 0);
  if (hh > 23 || mm > 59 || ss > 59) return null;
  return {
    full: `${pad2(hh)}:${pad2(mm)}:${pad2(ss)}`,
    short: `${pad2(hh)}:${pad2(mm)}`
  };
}

function parseParity(text) {
  const s = normalizeSpace(text).toLowerCase();
  if (s.includes('больше нечётных') || s.includes('больше нечетных')) return 'Больше нечётных';
  if (s.includes('больше чётных') || s.includes('больше четных')) return 'Больше чётных';
  if (s.includes('поровну')) return 'Поровну';
  return null;
}

function parseColumn(text) {
  const m = normalizeSpace(text).match(/столбец\s*([1-9]|10)\b/i);
  return m ? Number(m[1]) : null;
}

function parseDraw(text) {
  const m = String(text).match(/№\s*([0-9]{4,})/);
  return m ? Number(m[1]) : null;
}

function parseTime(text) {
  const m = String(text).match(/\b([01]?\d|2[0-3]):[0-5]\d(?::[0-5]\d)?\b/);
  return m ? normalizeTime(m[0]) : null;
}

function findDateLabel(text) {
  const s = String(text);
  const direct = s.match(/(?:^|\n)\s*(Сегодня|Вчера)\s*(?:\n|$)/i);
  if (direct) return normalizeSpace(direct[1]);

  const numeric = s.match(/(?:^|\n)\s*(\d{1,2}[.\-/]\d{1,2}[.\-/]\d{2,4})\s*(?:\n|$)/);
  if (numeric) return normalizeSpace(numeric[1]);

  const words = s.match(/(?:^|\n)\s*(\d{1,2}\s+(?:января|февраля|марта|апреля|мая|июня|июля|августа|сентября|октября|ноября|декабря)(?:\s+\d{4})?)\s*(?:\n|$)/i);
  if (words) return normalizeSpace(words[1]);

  return null;
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

  let login = null;
  for (const sel of loginSelectors) {
    const loc = page.locator(sel).first();
    if (await loc.count()) { login = loc; break; }
  }
  let pass = null;
  for (const sel of passSelectors) {
    const loc = page.locator(sel).first();
    if (await loc.count()) { pass = loc; break; }
  }
  if (!login || !pass) throw new Error('FAIL: не найдены поля OAuth Столото');

  await login.fill(EMAIL);
  await pass.fill(PASSWORD);

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
  await page.waitForTimeout(2500);
}


async function expandArchive(page, targetRows = 150) {
  let lastCount = 0;
  let stableRounds = 0;

  for (let round = 0; round < 20; round += 1) {
    const currentCount = await page.locator('tr').evaluateAll(list =>
      list.filter(el => /№\s*\d{4,}/.test(el.innerText || '')).length
    );

    if (currentCount >= targetRows) break;

    if (currentCount === lastCount) stableRounds += 1;
    else stableRounds = 0;
    lastCount = currentCount;

    // 1) Пробуем явные кнопки "Показать ещё / Ещё / Загрузить".
    const more = page.getByRole('button', {
      name: /показать\s*(ещё|еще)|загрузить\s*(ещё|еще)|^(ещё|еще)$/i
    }).last();

    if (await more.count()) {
      try {
        if (await more.isVisible()) {
          await more.click({ timeout: 5000 });
          await page.waitForTimeout(1800);
          continue;
        }
      } catch (_) {}
    }

    // 2) Иногда это ссылка, а не button.
    const moreLink = page.getByRole('link', {
      name: /показать\s*(ещё|еще)|загрузить\s*(ещё|еще)|^(ещё|еще)$/i
    }).last();

    if (await moreLink.count()) {
      try {
        if (await moreLink.isVisible()) {
          await moreLink.click({ timeout: 5000 });
          await page.waitForTimeout(1800);
          continue;
        }
      } catch (_) {}
    }

    // 3) Резерв: прокрутка вниз для lazy-load / infinite scroll.
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await page.waitForTimeout(1800);

    if (stableRounds >= 3) break;
  }

  await page.evaluate(() => window.scrollTo(0, 0));
  await page.waitForTimeout(400);
}

async function collectRows(page) {
  await page.goto(ARCHIVE_URL, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForTimeout(3500);

  // Мобильный архив сначала показывает только часть свежих тиражей.
  // Догружаем глубже, чтобы обязательно был шанс найти старый доверенный anchor.
  await expandArchive(page, 150);

  // Дата в мобильном архиве Столото часто является ОТДЕЛЬНЫМ заголовком
  // перед строками тиражей. Поэтому для каждой строки заранее находим
  // ближайший предыдущий заголовок даты в DOM.
  const rows = await page.locator('body').evaluate(() => {
    const drawRx = /№\s*\d{4,}/;
    const dateRx = /^(Сегодня|Вчера|\d{1,2}[.\/-]\d{1,2}[.\/-]\d{2,4}|\d{1,2}\s+(?:января|февраля|марта|апреля|мая|июня|июля|августа|сентября|октября|ноября|декабря)(?:\s+\d{4})?)$/i;
    const norm = s => String(s || '').replace(/\u00a0/g, ' ').replace(/[ \t]+/g, ' ').trim();

    const all = [...document.querySelectorAll('body *')];

    function nearestDateLabel(el) {
      let best = null;
      for (const node of all) {
        if (node === el || el.contains(node)) continue;

        // node должен находиться ДО строки тиража.
        const pos = node.compareDocumentPosition(el);
        if (!(pos & Node.DOCUMENT_POSITION_FOLLOWING)) continue;

        const t = norm(node.innerText || node.textContent || '');
        if (!t || t.length > 40 || !dateRx.test(t)) continue;

        // Избегаем больших контейнеров: дата должна быть компактным элементом.
        if (node.children && node.children.length > 3) continue;
        best = t;
      }
      return best;
    }

    // Сначала пробуем реальные строки таблицы.
    let candidates = [...document.querySelectorAll('tr')].filter(el => drawRx.test(el.innerText || ''));

    // Резерв: минимальные контейнеры с номером тиража и >=20 кнопками.
    if (!candidates.length) {
      candidates = all.filter(el => {
        const text = norm(el.innerText || '');
        if (!drawRx.test(text)) return false;
        if (el.querySelectorAll('button').length < 20) return false;
        return ![...el.children].some(ch =>
          drawRx.test(norm(ch.innerText || '')) && ch.querySelectorAll('button').length >= 20
        );
      });
    }

    return candidates.map(el => ({
      text: el.innerText || '',
      dateLabel: nearestDateLabel(el),
      buttons: [...el.querySelectorAll('button')].map(b => norm(b.innerText || ''))
    }));
  });

  return rows;
}

function parseRows(rawRows) {
  const parsed = [];
  let carryDateLabel = null;

  for (const row of rawRows) {
    const text = String(row.text || '');
    // Сначала используем дату, найденную в DOM перед строкой тиража.
    // Если она всё-таки находится внутри строки — старый способ тоже остаётся.
    const localDate = normalizeSpace(row.dateLabel || '') || findDateLabel(text);
    if (localDate) carryDateLabel = localDate;

    const draw = parseDraw(text);
    if (!draw) continue;

    const time = parseTime(text);
    const parity = parseParity(text);
    const column = parseColumn(text);

    // Не пересчитываем ни столбец, ни чётность.
    // Берём официальные метки Столото как есть.
    if (!parity) throw new Error(`FAIL: тираж ${draw}: Столото не отдал метку чёт/нечёт`);
    if (!column) throw new Error(`FAIL: тираж ${draw}: Столото не отдал «Столбец N»`);
    if (!time) throw new Error(`FAIL: тираж ${draw}: не найдено корректное время`);

    // Берём числа только из кнопок результата, чтобы не захватить 9 цифр «Тур 1».
    const buttonNumbers = (row.buttons || [])
      .map(x => Number(normalizeSpace(x)))
      .filter(n => Number.isInteger(n) && n >= 1 && n <= 80);

    let balls = buttonNumbers;
    // Если в контейнере есть посторонние кнопки, 20 шаров обычно последние 20
    // числовых кнопок строки архива.
    if (balls.length > 20) balls = balls.slice(-20);

    if (balls.length !== 20) {
      throw new Error(`FAIL: тираж ${draw}: ожидалось 20 чисел, найдено ${balls.length}`);
    }
    if (new Set(balls).size !== 20) {
      throw new Error(`FAIL: тираж ${draw}: 20 чисел должны быть без повторов`);
    }

    const dateLabel = localDate || carryDateLabel;
    const date = dateLabel ? normalizeDateLabel(dateLabel) : null;
    if (!date) {
      throw new Error(`FAIL: тираж ${draw}: не распознана дата; dateLabel=${JSON.stringify(dateLabel)}`);
    }

    parsed.push({
      draw,
      date,
      time: time.short,
      timeFull: time.full,
      parity,
      column,
      balls
    });
  }

  const map = new Map();
  for (const d of parsed) map.set(d.draw, d);
  return [...map.values()].sort((a, b) => a.draw - b.draw);
}

function canonical(draws) {
  return JSON.stringify(draws.map(d => ({
    draw: d.draw,
    date: d.date,
    time: d.time,
    timeFull: d.timeFull,
    parity: d.parity,
    column: d.column,
    balls: d.balls
  })));
}

async function readArchiveThreeTimes(page) {
  const reads = [];
  for (let i = 1; i <= 3; i += 1) {
    const rawRows = await collectRows(page);
    const parsed = parseRows(rawRows);
    if (!parsed.length) throw new Error(`FAIL: чтение ${i}: архив пуст`);
    reads.push(parsed);
    console.log(`Чтение ${i}: ${parsed.length} тиражей, диапазон №${parsed[0].draw}–№${parsed.at(-1).draw}`);
    if (i < 3) await page.waitForTimeout(1500);
  }

  const c1 = canonical(reads[0]);
  const c2 = canonical(reads[1]);
  const c3 = canonical(reads[2]);
  if (c1 !== c2 || c1 !== c3) {
    throw new Error('FAIL: три независимых чтения архива НЕ совпали');
  }
  return reads[0];
}

async function readTrustedHistory() {
  try {
    const raw = await fs.readFile(HISTORY_FILE, 'utf8');
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) return parsed;
    if (Array.isArray(parsed?.draws)) return parsed.draws;
    return [];
  } catch {
    return [];
  }
}

function normalizeHistoryDraw(d) {
  return {
    draw: Number(d?.draw ?? d?.number ?? d?.id),
    date: normalizeSpace(d?.date),
    time: normalizeTime(d?.time)?.short || normalizeSpace(d?.time),
    balls: Array.isArray(d?.balls) ? d.balls.map(Number) :
           Array.isArray(d?.numbers) ? d.numbers.map(Number) : []
  };
}

function validateAgainstAnchor(stolotoDraws, historyRaw) {
  const history = historyRaw.map(normalizeHistoryDraw).filter(d => Number.isInteger(d.draw));
  if (!history.length) {
    console.log('WARN: локальная история не прочитана — anchor не проверен');
    return;
  }

  const hMap = new Map(history.map(d => [d.draw, d]));
  const overlap = stolotoDraws.filter(d => hMap.has(d.draw));
  if (!overlap.length) {
    const sMin = stolotoDraws.length ? stolotoDraws[0].draw : null;
    const sMax = stolotoDraws.length ? stolotoDraws.at(-1).draw : null;
    const hMax = history.length ? history.reduce((a, b) => a.draw > b.draw ? a : b).draw : null;
    throw new Error(
      `FAIL: нет пересечения официального архива с keno-history.json; ` +
      `Столото диапазон №${sMin}–№${sMax}, локальный последний №${hMax}`
    );
  }

  // Проверяем все пересекающиеся старые тиражи по данным, которые уже есть
  // в текущей истории: номер, дата, время, 20 чисел.
  for (const s of overlap) {
    const h = hMap.get(s.draw);
    if (h.date && s.date && h.date !== s.date) {
      throw new Error(`FAIL: anchor №${s.draw}: дата отличается (${h.date} != ${s.date})`);
    }
    if (h.time && s.time && h.time !== s.time) {
      throw new Error(`FAIL: anchor №${s.draw}: время отличается (${h.time} != ${s.time})`);
    }
    if (h.balls.length === 20 && JSON.stringify(h.balls) !== JSON.stringify(s.balls)) {
      throw new Error(`FAIL: anchor №${s.draw}: 20 чисел отличаются`);
    }
  }

  const lastHistory = history.reduce((a, b) => a.draw > b.draw ? a : b);
  const lastOverlap = overlap.at(-1);
  console.log(`Anchor PASS: пересечений ${overlap.length}, крайний общий №${lastOverlap.draw}`);
  console.log(`Последний доверенный локальный тираж: №${lastHistory.draw}`);
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
  const draws = await readArchiveThreeTimes(page);
  const history = await readTrustedHistory();
  validateAgainstAnchor(draws, history);

  const latest = draws.at(-1);
  const report = {
    ok: true,
    source: 'Официальный Столото · OAuth · тройная проверка',
    archiveUrl: ARCHIVE_URL,
    checkedAt: new Date().toISOString(),
    archiveDrawsSeen: draws.length,
    latest
  };

  await fs.writeFile('stoloto-keno-test-report.json', JSON.stringify(report, null, 2) + '\n');
  console.log('');
  console.log('PASS: Столото КЕНО — три чтения совпали.');
  console.log(`Последний тираж: №${latest.draw} ${latest.date} ${latest.timeFull}`);
  console.log(`Столото: ${latest.parity}; Столбец ${latest.column}`);
  console.log(`Числа: ${latest.balls.join(' ')}`);
  console.log('ВАЖНО: тестовый файл НИЧЕГО не записывает в keno-history.json.');
} finally {
  await browser.close();
}
