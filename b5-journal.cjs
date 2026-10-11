'use strict';
// B5 server journal, experimental. Never fabricate predictions for already drawn draws.
// Run after keno-history.json update, BEFORE committing updated history and journal.
const fs = require('node:fs');
const B5 = require('./virtus-b5-module.js');
const HISTORY = 'keno-history.json';
const FILE = 'b5-journal.json';
// ЕДИНСТВЕННЫЙ показываемый прогноз = ровно пять столбцов варианта PRIMARY.
// Выбран только по старому архиву (32 706 тиражей до №329287): A z=+0.67, B +0.55, V +0.42, G -0.62.
// Значимых различий нет (порог |z|>=2.58), поэтому по заранее заданному правилу взят простейший вариант A.
// Остальные варианты пишутся в журнал как теневые (для независимой проверки), но не показываются как прогноз.
const PRIMARY = 'A';
function exactFive(five, name) { if (!Array.isArray(five) || five.length !== 5 || new Set(five).size !== 5 || five.some(c => !Number.isInteger(c) || c < 1 || c > 10)) fail('forecast ' + name + ' is not exactly five different columns'); }
const now = new Date();
function fail(message) { throw new Error('[B5 journal] ' + message); }
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
const byDraw=new Map(H.map(d=>[d.draw,d]));
const known=new Set(journal.records.map(r=>r.draw));
let settled=0,created=0;
for(const r of journal.records){
  const fact=byDraw.get(r.draw);
  if(fact && fact.column && !r.result){
    r.result={winner:fact.column,source:'official',A:r.five.A.includes(fact.column),B:r.five.B.includes(fact.column),V:r.five.V.includes(fact.column),G:r.five.G.includes(fact.column),group:r.b5Group?r.mainColumns.includes(fact.column):null};
    r.result.forecast=(r.forecast?r.forecast.columns:r.five[PRIMARY]).includes(fact.column);
    r.settledAt=now.toISOString();settled++;
  }
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
  console.warn('[B5 journal] target time has passed, no retrospective forecast',target.draw,target.date,target.time);
}
journal.updatedAt=now.toISOString();
journal.engine=B5.VERSION;
if(!fs.existsSync(FILE)||settled||created)fs.writeFileSync(FILE,JSON.stringify(journal,null,2)+'\n');
console.log('[B5 journal] records='+journal.records.length+' new='+created+' settled='+settled+' next='+target.draw+' future='+validFuture);