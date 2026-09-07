import fs from 'node:fs/promises';
import process from 'node:process';
import { chromium } from 'playwright';

const LOGIN_URL = 'https://oauth.stoloto.ru/login';
const ARCHIVE_URL = 'https://m.stoloto.ru/keno2/archive/';
const HISTORY_FILE = 'keno-history.json';
const TAIL_SIZE = 10;
const PAGE_READ_ATTEMPTS = 3;
const EMAIL = process.env.STOLOTO_EMAIL || '';
const PASSWORD = process.env.STOLOTO_PASSWORD || '';

if (!EMAIL || !PASSWORD) throw new Error('FAIL: нет GitHub Secrets STOLOTO_EMAIL / STOLOTO_PASSWORD');

const MONTHS = {
  'января':1,'февраля':2,'марта':3,'апреля':4,'мая':5,'июня':6,
  'июля':7,'августа':8,'сентября':9,'октября':10,'ноября':11,'декабря':12
};
const pad2 = n => String(n).padStart(2,'0');
const norm = s => String(s ?? '').replace(/\u00a0/g,' ').replace(/[ \t]+/g,' ').trim();

function moscowTodayParts(){
  const f = new Intl.DateTimeFormat('ru-RU',{timeZone:'Europe/Moscow',year:'numeric',month:'2-digit',day:'2-digit'});
  const p = Object.fromEntries(f.formatToParts(new Date()).map(x=>[x.type,x.value]));
  return {y:Number(p.year),m:Number(p.month),d:Number(p.day)};
}
function shiftDate({y,m,d},delta){
  const dt=new Date(Date.UTC(y,m-1,d)); dt.setUTCDate(dt.getUTCDate()+delta);
  return {y:dt.getUTCFullYear(),m:dt.getUTCMonth()+1,d:dt.getUTCDate()};
}
function normalizeDateLabel(label){
  const raw=norm(label).toLowerCase(); const today=moscowTodayParts(); let p=null;
  if(raw==='сегодня') p=today;
  else if(raw==='вчера') p=shiftDate(today,-1);
  else {
    let m=raw.match(/^(\d{1,2})[.\-/](\d{1,2})[.\-/](\d{2,4})$/);
    if(m){let y=Number(m[3]); if(y<100)y+=2000; p={d:Number(m[1]),m:Number(m[2]),y};}
    else {
      m=raw.match(/^(\d{1,2})\s+([а-яё]+)(?:\s+(\d{4}))?$/i);
      if(m&&MONTHS[m[2]]){let y=m[3]?Number(m[3]):today.y; p={d:Number(m[1]),m:MONTHS[m[2]],y}; if(!m[3]&&p.m>today.m+6)p.y-=1;}
    }
  }
  return p?`${pad2(p.d)}.${pad2(p.m)}.${String(p.y).slice(-2)}`:null;
}
function normalizeTime(v){
  const m=String(v??'').match(/(\d{1,2}):(\d{2})(?::(\d{2}))?/); if(!m)return null;
  const hh=Number(m[1]),mm=Number(m[2]),ss=Number(m[3]||0); if(hh>23||mm>59||ss>59)return null;
  return {short:`${pad2(hh)}:${pad2(mm)}`,full:`${pad2(hh)}:${pad2(mm)}:${pad2(ss)}`};
}
const parseDraw=text=>{const m=String(text).match(/№\s*([0-9]{4,})/); return m?Number(m[1]):null;};
const parseTime=text=>{const m=String(text).match(/\b([01]?\d|2[0-3]):[0-5]\d(?::[0-5]\d)?\b/); return m?normalizeTime(m[0]):null;};
function parseParity(text){
  const s=norm(text).toLowerCase();
  if(s.includes('больше нечётных')||s.includes('больше нечетных'))return 'Больше нечётных';
  if(s.includes('больше чётных')||s.includes('больше четных'))return 'Больше чётных';
  if(s.includes('поровну'))return 'Поровну';
  return null;
}
function parseColumn(text){
  const m=norm(text).match(/столб(?:ец)?\s*[:№#-]?\s*([1-9]|10)\b/i); return m?Number(m[1]):null;
}
function findDateLabel(text){
  const s=String(text);
  let m=s.match(/(?:^|\n)\s*(Сегодня|Вчера)\s*(?:\n|$)/i); if(m)return norm(m[1]);
  m=s.match(/(?:^|\n)\s*(\d{1,2}[.\-/]\d{1,2}[.\-/]\d{2,4})\s*(?:\n|$)/); if(m)return norm(m[1]);
  m=s.match(/(?:^|\n)\s*(\d{1,2}\s+(?:января|февраля|марта|апреля|мая|июня|июля|августа|сентября|октября|ноября|декабря)(?:\s+\d{4})?)\s*(?:\n|$)/i);
  return m?norm(m[1]):null;
}

async function firstVisible(scope,selectors){
  for(const sel of selectors){const loc=scope.locator(sel).first(); try{if(await loc.count()&&await loc.isVisible())return loc;}catch{}}
  return null;
}
async function login(page){
  await page.goto(LOGIN_URL,{waitUntil:'domcontentloaded',timeout:60000});
  const loginSelectors=['input[type="email"]','input[name*="email" i]','input[name*="login" i]','input[autocomplete="username"]','input[type="text"]'];
  const passSelectors=['input[type="password"]','input[name*="password" i]','input[autocomplete="current-password"]'];
  const deadline=Date.now()+15000; let scope=null,loginField=null,passField=null;
  while(Date.now()<deadline&&!loginField){
    for(const frame of page.frames()){const l=await firstVisible(frame,loginSelectors); const p=await firstVisible(frame,passSelectors); if(l&&p){scope=frame;loginField=l;passField=p;break;}}
    if(!loginField)await page.waitForTimeout(250);
  }
  if(!loginField||!passField)throw new Error(`FAIL: OAuth-поля не видны; url=${page.url()}`);
  await loginField.fill(EMAIL); await passField.fill(PASSWORD);
  const buttons=[scope.getByRole('button',{name:/войти/i}).first(),scope.locator('button[type="submit"]').first(),scope.locator('input[type="submit"]').first()];
  let clicked=false; for(const btn of buttons){try{if(await btn.count()&&await btn.isVisible()){await btn.click();clicked=true;break;}}catch{}}
  if(!clicked)throw new Error('FAIL: не найдена кнопка «Войти»');
  await page.waitForLoadState('domcontentloaded',{timeout:20000}).catch(()=>{}); await page.waitForTimeout(3500);
}

async function collectRows(page){
  let lastDiag=null;
  for(let attempt=1;attempt<=PAGE_READ_ATTEMPTS;attempt++){
    await page.goto(ARCHIVE_URL,{waitUntil:'domcontentloaded',timeout:60000}).catch(()=>{});
    await page.waitForLoadState('networkidle',{timeout:12000}).catch(()=>{});
    await page.waitForTimeout(2500+attempt*1000);

    const raw=await page.locator('body').evaluate(() => {
      const drawRx=/№\s*\d{4,}/;
      const dateRx=/^(Сегодня|Вчера|\d{1,2}[.\/-]\d{1,2}[.\/-]\d{2,4}|\d{1,2}\s+(?:января|февраля|марта|апреля|мая|июня|июля|августа|сентября|октября|ноября|декабря)(?:\s+\d{4})?)$/i;
      const n=s=>String(s||'').replace(/\u00a0/g,' ').replace(/[ \t]+/g,' ').trim();
      const all=[...document.querySelectorAll('body *')];
      function nearestDateLabel(el){
        let best=null;
        for(const node of all){
          if(node===el||el.contains(node))continue;
          const pos=node.compareDocumentPosition(el); if(!(pos&Node.DOCUMENT_POSITION_FOLLOWING))continue;
          const t=n(node.innerText||node.textContent||''); if(!t||t.length>40||!dateRx.test(t))continue;
          if(node.children&&node.children.length>3)continue; best=t;
        }
        return best;
      }
      function numericLeaves(el){
        const nodes=[...el.querySelectorAll('*')]; const vals=[];
        for(const node of nodes){
          const t=n(node.innerText||node.textContent||''); if(!/^\d{1,2}$/.test(t))continue;
          const v=Number(t); if(v<1||v>80)continue;
          const sameChild=[...node.children].some(ch=>n(ch.innerText||ch.textContent||'')===t); if(sameChild)continue;
          vals.push(v);
        }
        return vals;
      }
      let rows=[...document.querySelectorAll('tr')].filter(el=>drawRx.test(el.innerText||''));
      if(!rows.length){
        rows=all.filter(el=>{
          const text=n(el.innerText||''); if(!drawRx.test(text))return false;
          return ![...el.children].some(ch=>drawRx.test(n(ch.innerText||'')));
        });
      }
      return rows.map(el=>({text:el.innerText||'',dateLabel:nearestDateLabel(el),numeric:numericLeaves(el)}));
    });

    const parsed=[]; let carryDate=null;
    for(const row of raw){
      const text=String(row.text||''); const localDate=norm(row.dateLabel||'')||findDateLabel(text); if(localDate)carryDate=localDate;
      const draw=parseDraw(text); if(!draw)continue;
      const time=parseTime(text); const parity=parseParity(text); const column=parseColumn(text); const date=normalizeDateLabel(localDate||carryDate);
      let balls=Array.isArray(row.numeric)?row.numeric.filter(v=>Number.isInteger(v)&&v>=1&&v<=80):[];
      // Keep document order, collapse repeated DOM mirrors while retaining genuine values only once.
      const unique=[]; for(const v of balls){if(!unique.includes(v))unique.push(v);} balls=unique;
      if(balls.length>20) balls=balls.slice(-20);
      if(time&&date&&parity&&column&&balls.length===20) parsed.push({draw,date,time:time.short,parity,column,balls});
    }

    const uniq=[...new Map(parsed.map(d=>[d.draw,d])).values()].sort((a,b)=>a.draw-b.draw);
    let bodyHead=''; try{bodyHead=norm(await page.locator('body').innerText({timeout:5000})).slice(0,500);}catch{}
    lastDiag={attempt,url:page.url(),raw:raw.length,parsed:uniq.length,bodyHead};
    console.log(`Stoloto DOM attempt ${attempt}/${PAGE_READ_ATTEMPTS}: raw=${raw.length} parsed=${uniq.length} url=${page.url()}`);
    if(uniq.length>=TAIL_SIZE)return uniq.slice(-TAIL_SIZE);
    await page.reload({waitUntil:'domcontentloaded',timeout:60000}).catch(()=>{}); await page.waitForTimeout(1500);
  }
  throw new Error(`FAIL: получено ${(lastDiag||{}).parsed||0} из ${TAIL_SIZE}; diagnostics=${JSON.stringify(lastDiag)}`);
}

function core(d){return JSON.stringify({draw:d.draw,date:d.date,time:d.time,parity:d.parity,column:d.column,balls:d.balls});}
async function readTailThreeTimes(page){
  const reads=[];
  for(let i=1;i<=3;i++){
    const parsed=await collectRows(page); if(parsed.length<TAIL_SIZE)throw new Error(`FAIL: чтение ${i}: получено ${parsed.length} из ${TAIL_SIZE} последних тиражей`);
    reads.push(parsed); console.log(`Чтение ${i}: последние ${TAIL_SIZE}, №${parsed[0].draw}–№${parsed.at(-1).draw}`); if(i<3)await page.waitForTimeout(900);
  }
  const first=reads[0].map(core);
  for(let i=1;i<reads.length;i++){const cur=reads[i].map(core); if(cur.length!==first.length||cur.some((x,k)=>x!==first[k]))throw new Error('SAFE RETRY: последние 10 изменились между тремя чтениями; следующий запуск проверит снова');}
  console.log(`Тройная проверка PASS: ${TAIL_SIZE}/${TAIL_SIZE}`); return reads[0];
}

async function readTrustedHistory(){
  const raw=await fs.readFile(HISTORY_FILE,'utf8'); const parsed=JSON.parse(raw); const rows=Array.isArray(parsed)?parsed:parsed?.draws;
  if(!Array.isArray(rows)||rows.length<60)throw new Error(`FAIL: keno-history.json не является доверенным полным архивом (${Array.isArray(rows)?rows.length:0})`);
  return rows;
}
function normalizeHistoryDraw(d){return {draw:Number(d?.draw??d?.number??d?.id),date:norm(d?.date),time:normalizeTime(d?.time)?.short||norm(d?.time),balls:Array.isArray(d?.balls)?d.balls.map(Number):Array.isArray(d?.numbers)?d.numbers.map(Number):[]};}
function scheduleMinutesFromHistory(history){const set=new Set(); for(const d of history.slice(-5000)){const m=String(d.time??'').match(/^\d{2}:(\d{2})$/); if(m)set.add(m[1]);} return set;}
function validateAndFindFresh(stoloto,historyRaw){
  const history=historyRaw.map(d=>({original:d,...normalizeHistoryDraw(d)})).filter(d=>Number.isInteger(d.draw)&&/^\d{2}\.\d{2}\.\d{2,4}$/.test(d.date)&&/^\d{2}:\d{2}$/.test(d.time)&&d.balls.length===20).sort((a,b)=>a.draw-b.draw);
  if(history.length!==historyRaw.length)throw new Error(`FAIL: в keno-history.json есть некорректные строки (${history.length}/${historyRaw.length})`);
  const last=history.at(-1),oldest=stoloto[0],newest=stoloto.at(-1); if(!oldest||!newest)throw new Error('FAIL: последние 10 Столото пусты');
  for(let i=1;i<stoloto.length;i++)if(stoloto[i].draw!==stoloto[i-1].draw+1)throw new Error(`FAIL: официальный tail10 имеет разрыв №${stoloto[i-1].draw} → №${stoloto[i].draw}`);
  const officialMap=new Map(stoloto.map(d=>[d.draw,d])); const anchor=officialMap.get(last.draw);
  if(anchor){if(anchor.date!==last.date)throw new Error(`FAIL: anchor №${last.draw}: дата отличается`); if(anchor.time!==last.time)throw new Error(`FAIL: anchor №${last.draw}: время отличается`); if(JSON.stringify(anchor.balls)!==JSON.stringify(last.balls))throw new Error(`FAIL: anchor №${last.draw}: 20 чисел отличаются`);}
  else if(oldest.draw!==last.draw+1)throw new Error(`FAIL SAFE: локальная база слишком отстала для tail10. Локальный последний №${last.draw}, официальный tail начинается с №${oldest.draw}`);
  const fresh=stoloto.filter(d=>d.draw>last.draw); let expected=last.draw+1; const allowedParity=new Set(['Больше чётных','Больше нечётных','Поровну']); const allowedMinutes=scheduleMinutesFromHistory(history);
  for(const d of fresh){
    if(d.draw!==expected)throw new Error(`FAIL: пропуск тиража: ожидался №${expected}, получен №${d.draw}`); expected++;
    if(!/^\d{2}\.\d{2}\.\d{2}$/.test(d.date))throw new Error(`FAIL: №${d.draw}: неверная дата ${d.date}`);
    if(!/^\d{2}:\d{2}$/.test(d.time))throw new Error(`FAIL: №${d.draw}: неверное время ${d.time}`);
    if(allowedMinutes.size&&!allowedMinutes.has(d.time.slice(3,5)))throw new Error(`FAIL: №${d.draw}: минута ${d.time.slice(3,5)} не соответствует расписанию архива`);
    if(!allowedParity.has(d.parity))throw new Error(`FAIL: №${d.draw}: нет официальной метки чёт/нечёт`);
    if(!Number.isInteger(d.column)||d.column<1||d.column>10)throw new Error(`FAIL: №${d.draw}: нет официального «Столбец N»`);
    if(d.balls.length!==20||new Set(d.balls).size!==20)throw new Error(`FAIL: №${d.draw}: 20 чисел повреждены`);
  }
  console.log(`Anchor PASS: локальный №${last.draw}; официальный tail №${oldest.draw}–№${newest.draw}; новых ${fresh.length}`); return {last,fresh,newest};
}
function mergeHistory(historyRaw,fresh){
  const source='Официальный Столото · OAuth · tail10 · DOM v2 · тройная проверка';
  const additions=fresh.map(d=>({draw:d.draw,date:d.date,time:d.time,balls:d.balls,parity:d.parity,column:d.column,source}));
  return [...historyRaw,...additions].sort((a,b)=>Number(a.draw)-Number(b.draw));
}

const browser=await chromium.launch({headless:true});
try{
  const context=await browser.newContext({locale:'ru-RU',timezoneId:'Europe/Moscow',viewport:{width:390,height:844},userAgent:'Mozilla/5.0 (Linux; Android 10) AppleWebKit/537.36 Chrome/131 Mobile Safari/537.36'});
  const page=await context.newPage(); await login(page);
  const officialTail=await readTailThreeTimes(page); const historyRaw=await readTrustedHistory(); const {last,fresh,newest}=validateAndFindFresh(officialTail,historyRaw);
  if(!fresh.length)console.log(`KENO v7.2 TAIL10 PASS: новых тиражей нет; локальный №${last.draw}; официальный №${newest.draw}`);
  else {const merged=mergeHistory(historyRaw,fresh); await fs.writeFile(HISTORY_FILE,JSON.stringify(merged)+'\n'); const finalLast=merged.at(-1); console.log(`KENO v7.2 TAIL10 PASS: добавлено ${fresh.length}; новый последний №${finalLast.draw}; ${finalLast.parity}; Столбец ${finalLast.column}`);}
} finally {await browser.close();}
