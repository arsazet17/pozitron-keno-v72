'use strict';
// B5 server journal, experimental. Never fabricate predictions for already drawn draws.
// Run after keno-history.json update, BEFORE committing updated history and journal.
// Modes: default = update the journal | --verify [--against=<backup.json>] = validate only, change nothing.
const fs = require('node:fs');
const HISTORY = process.env.B5_HISTORY_FILE || 'keno-history.json';
const FILE = process.env.B5_JOURNAL_FILE || 'b5-journal.json';
// ЕДИНСТВЕННЫЙ показываемый прогноз = ровно пять столбцов варианта PRIMARY.
// Выбран только по старому архиву (32 706 тиражей до №329287): A z=+0.67, B +0.55, V +0.42, G -0.62.
// Значимых различий нет (порог |z|>=2.58), поэтому по заранее заданному правилу взят простейший вариант A.
// Остальные варианты пишутся в журнал как теневые (для независимой проверки), но не показываются как прогноз.
const PRIMARY = 'A';
const VARIANTS = ['A', 'B', 'V', 'G'];
function fail(message) { throw new Error('[B5 journal] ' + message); }
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
function isFive(five) { return Array.isArray(five) && five.length === 5 && new Set(five).size === 5 && five.every(c => Number.isInteger(c) && c >= 1 && c <= 10); }
function exactFive(five, name) { if (!isFive(five)) fail('forecast ' + name + ' is not exactly five different columns'); }

// Структура журнала: схема, порядок номеров, ровно пять столбцов, согласованность результатов, пропуски.
function validateJournal(j) {
  if (!j || typeof j !== 'object' || j.schema !== 1) fail('invalid journal schema');
  if (!Array.isArray(j.records)) fail('records is not an array');
  if (!Array.isArray(j.gaps)) fail('gaps is not an array');
  let prev = 0; const seen = new Set();
  for (const r of j.records) {
    if (!Number.isInteger(r.draw) || r.draw <= prev) fail('records are not strictly increasing at draw ' + r.draw);
    prev = r.draw; seen.add(r.draw);
    if (!r.five || VARIANTS.some(k => !isFive(r.five[k]))) fail('record ' + r.draw + ': bad five');
    if (!isFive(r.control)) fail('record ' + r.draw + ': bad control');
    if (!Array.isArray(r.votes) || r.votes.length !== 5) fail('record ' + r.draw + ': bad votes');
    if (r.forecast !== undefined && (!r.forecast || !isFive(r.forecast.columns) || !same(r.forecast.columns, r.five[r.forecast.variant]))) fail('record ' + r.draw + ': forecast does not match five');
    if (r.result !== null && r.result !== undefined) {
      const w = r.result.winner;
      if (!Number.isInteger(w) || w < 1 || w > 10) fail('record ' + r.draw + ': bad winner');
      for (const k of VARIANTS) if (r.result[k] !== r.five[k].includes(w)) fail('record ' + r.draw + ': result.' + k + ' mismatch');
      if (r.result.forecast !== undefined && r.forecast && r.result.forecast !== r.forecast.columns.includes(w)) fail('record ' + r.draw + ': result.forecast mismatch');
    }
  }
  const gaps = new Set();
  for (const g of j.gaps) {
    if (!g || !Number.isInteger(g.draw) || typeof g.reason !== 'string' || gaps.has(g.draw) || seen.has(g.draw)) fail('bad gap ' + (g && g.draw));
    gaps.add(g.draw);
  }
}
// Уже сохранённые прогнозы и результаты менять нельзя: допускается только закрыть незакрытую запись.
function assertImmutable(before, after) {
  const idx = new Map(after.records.map(r => [r.draw, r]));
  if (after.records.length < before.records.length) fail('records were removed');
  for (const o of before.records) {
    const n = idx.get(o.draw);
    if (!n) fail('record ' + o.draw + ' disappeared');
    for (const k of new Set([...Object.keys(o), ...Object.keys(n)])) {
      if (k === 'result' || k === 'settledAt') { if (o.result !== null && o.result !== undefined && !same(o[k], n[k])) fail('settled record ' + o.draw + ' changed (' + k + ')'); continue; }
      if (!same(o[k], n[k])) fail('saved forecast ' + o.draw + ' changed (' + k + ')');
    }
  }
  const ng = new Map(after.gaps.map(g => [g.draw, g]));
  for (const g of (before.gaps || [])) if (!ng.has(g.draw) || !same(g, ng.get(g.draw))) fail('gap ' + g.draw + ' changed');
}
function writeAtomic(file, text) {
  const tmp = file + '.tmp-' + process.pid;
  fs.writeFileSync(tmp, text);
  JSON.parse(fs.readFileSync(tmp, 'utf8'));
  fs.renameSync(tmp, file);
}

if (process.argv.includes('--verify')) {
  try {
    const j = JSON.parse(fs.readFileSync(FILE, 'utf8'));
    validateJournal(j);
    const a = process.argv.find(x => x.startsWith('--against='));
    if (a) { const before = JSON.parse(fs.readFileSync(a.slice(10), 'utf8')); before.gaps = before.gaps || []; assertImmutable(before, j); }
    console.log('[B5 journal] verify OK records=' + j.records.length + ' gaps=' + j.gaps.length);
    process.exit(0);
  } catch (e) { console.error(String(e && e.message || e)); process.exit(1); }
}

const B5 = require('./virtus-b5-module.js');
const now = new Date();
function dateOf(s) {
  if (/^\d{2}\.\d{2}\.\d{2}$/.test(s)) return s;
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s.slice(8,10)+'.'+s.slice(5,7)+'.'+s.slice(2,4);
  if (s.length===10 && s[2]==='.' && s[5]==='.') return s.slice(0,6)+s.slice(-2);
  fail('unsupported date ' + s);
}
function drawTimeUtc(date,time) {
  const [dd,mm,yy] = date.split('.').map(Number);
  if (!/^\d\d:\d\d$/.test(time)) fail('unsupported time ' + time);
  const [h,m] = time.split(':').map(Number);
  return Date.UTC(2000+yy,mm-1,dd,h-3,m); // draw clock is Moscow UTC+3
}
const raw = JSON.parse(fs.readFileSync(HISTORY,'utf8'));
if (!Array.isArray(raw) || raw.length < 2) fail('history is missing or too short');
const H = raw.map(d=>({
  draw:Number(d.draw),date:dateOf(String(d.date)),time:String(d.time).slice(0,5),
  balls:d.balls, column: Number.isInteger(Number(d.column)) && Number(d.column)>=1 && Number(d.column)<=10 ? Number(d.column):undefined
})).sort((a,b)=>a.draw-b.draw);
for (let i=0;i<H.length;i++) {
  if (!Number.isInteger(H[i].draw) || !Array.isArray(H[i].balls) || H[i].balls.length!==20) fail('invalid draw '+H[i].draw);
  if(i && H[i].draw===H[i-1].draw) fail('duplicate draw '+H[i].draw);
}
let journal=fs.existsSync(FILE)?JSON.parse(fs.readFileSync(FILE,'utf8')):{schema:1,engine:B5.VERSION,records:[],gaps:[]};
if(!Array.isArray(journal.records)) fail('invalid journal');
if(!Array.isArray(journal.gaps)) journal.gaps=[];
const before=JSON.parse(JSON.stringify(journal));
const byDraw=new Map(H.map(d=>[d.draw,d]));
const known=new Set(journal.records.map(r=>r.draw));
let settled=0,created=0,gapsAdded=0;
for(const r of journal.records){
  const fact=byDraw.get(r.draw);
  if(fact && fact.column && !r.result){
    r.result={winner:fact.column,source:'official',A:r.five.A.includes(fact.column),B:r.five.B.includes(fact.column),V:r.five.V.includes(fact.column),G:r.five.G.includes(fact.column),group:r.b5Group?r.mainColumns.includes(fact.column):null};
    r.result.forecast=(r.forecast?r.forecast.columns:r.five[PRIMARY]).includes(fact.column);
    r.settledAt=now.toISOString();settled++;
  }
}
// Пропуск фиксируется только как факт (тираж, время, причина). Прогноз задним числом не создаётся.
const gapKnown=new Set(journal.gaps.map(g=>g.draw));
function addGap(draw,date,time,reason,detail){
  if(gapKnown.has(draw)||known.has(draw))return;
  journal.gaps.push({draw,date,time,reason,detail,detectedAt:now.toISOString()});
  gapKnown.add(draw);gapsAdded++;
  console.warn('[B5 journal] GAP draw='+draw+' '+date+' '+time+' reason='+reason);
}
const latest=H.at(-1);
const predicted=B5.predictNext(H);
const target=predicted.target;
if(target.draw!==latest.draw+1) fail('target draw mismatch');
for(const [name,five] of Object.entries(predicted.five))if(five.length!==5||new Set(five).size!==5)fail('bad five '+name);
exactFive(predicted.five[PRIMARY], PRIMARY);
const primary=predicted.five[PRIMARY].slice();
const targetUtc=drawTimeUtc(target.date,target.time);
const validFuture=now.getTime()<targetUtc;
if(!known.has(target.draw)&&validFuture){
  journal.records.push({
    draw:target.draw,date:target.date,time:target.time,savedAt:now.toISOString(),
    engine:B5.VERSION,signal:predicted.signal,b5Group:predicted.b5Group,
    b5Index:predicted.b5Index,maxVotes:predicted.maxVotes,uniqueLeader:predicted.uniqueLeader,
    votes:predicted.votes,mainColumns:predicted.mainColumns,
    groups:predicted.groups,five:predicted.five,
    forecast:{variant:PRIMARY,columns:primary,main:primary.filter(c=>predicted.mainColumns.includes(c)),extra:primary.filter(c=>!predicted.mainColumns.includes(c))},
    control:[1,2,3,4,5],
    result:null
  });created++;
} else if(!known.has(target.draw)) {
  const minutes=Math.round((now.getTime()-targetUtc)/60000);
  console.warn('[B5 journal] target time has passed, no retrospective forecast',target.draw,target.date,target.time);
  addGap(target.draw,target.date,target.time,'target_time_passed','Время тиража наступило до запуска журнала (на '+minutes+' мин раньше запуска). Прогноз задним числом не создан.');
}
// Тиражи после первой записи журнала, для которых прогноза до тиража нет.
if(journal.records.length){
  const firstDraw=journal.records[0].draw;
  for(const d of H){
    if(d.draw>firstDraw&&d.draw<=latest.draw&&!known.has(d.draw))
      addGap(d.draw,d.date,d.time,'no_pre_draw_forecast','В журнале нет прогноза, сохранённого до этого тиража (журнал не был запущен вовремя или запуск завершился ошибкой). Прогноз задним числом не создан.');
  }
}
journal.updatedAt=now.toISOString();
journal.engine=B5.VERSION;
validateJournal(journal);
assertImmutable(before,journal);
if(!fs.existsSync(FILE)||settled||created||gapsAdded)writeAtomic(FILE,JSON.stringify(journal,null,2)+'\n');
console.log('[B5 journal] records='+journal.records.length+' new='+created+' settled='+settled+' gaps+='+gapsAdded+' next='+target.draw+' future='+validFuture);