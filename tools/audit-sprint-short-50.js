'use strict';

const fs = require('fs');
const path = require('path');

const HISTORY = path.join(process.cwd(), 'keno-history.json');
const OUTPUT_DIR = path.join(process.cwd(), 'outputs', 'sprint-short-independent50');
const OUTPUT_JSON = path.join(OUTPUT_DIR, 'result.json');
const OUTPUT_CSV = path.join(OUTPUT_DIR, 'rows.csv');

const colOf = n => Number(n) % 10 || 10;

function counts(draw) {
  const out = Array(11).fill(0);
  for (const n of draw?.balls || []) out[colOf(n)] += 1;
  return out;
}

function fallbackWinner(draw) {
  const final = counts(draw);
  const max = Math.max(...final.slice(1));
  const running = Array(11).fill(0);
  for (const n of draw?.balls || []) {
    const c = colOf(n);
    running[c] += 1;
    if (running[c] === max) return c;
  }
  return 1;
}

function winner(draw) {
  const c = Number(draw?.column);
  return Number.isInteger(c) && c >= 1 && c <= 10 ? c : fallbackWinner(draw);
}

function buildCaches(draws) {
  const winnerCache = draws.map(winner);
  const drawCounts = draws.map(counts);
  const stateCache = new Array(draws.length).fill(null);
  for (let i = 1; i < draws.length; i += 1) {
    stateCache[i] = Math.min(4, drawCounts[i - 1][winnerCache[i]] || 0);
  }
  return { winnerCache, drawCounts, stateCache };
}

function stateBeforeWinner(stateCache, i) {
  if (i <= 0) return null;
  return stateCache[i] ?? null;
}

function sequence(stateCache, end, len) {
  const out = [];
  for (let i = Math.max(1, end - len + 1); i <= end; i += 1) {
    const s = stateBeforeWinner(stateCache, i);
    if (s !== null) out.push(s);
  }
  return out;
}

function weightedSimilarity(a, b) {
  const n = Math.min(a.length, b.length);
  if (!n) return 0;
  let score = 0, total = 0;
  for (let i = 0; i < n; i += 1) {
    const w = i + 1;
    const av = a[a.length - n + i];
    const bv = b[b.length - n + i];
    total += w;
    score += w * (1 - Math.min(1, Math.abs(av - bv) / 4));
  }
  return total ? score / total : 0;
}

function addHistoricalBaseline(stateCache, support, minIndex, maxIndex, weight) {
  const cs = Array(5).fill(0);
  let total = 0;
  for (let i = Math.max(1, minIndex); i <= maxIndex; i += 1) {
    const s = stateBeforeWinner(stateCache, i);
    if (s === null) continue;
    cs[s] += 1;
    total += 1;
  }
  if (!total) return;
  cs.forEach((v, s) => support[s] += weight * v / total);
}

function addSuffixEvidence(stateCache, seq, minIndex, maxIndex, support, stats) {
  const lengths = [5, 4, 3, 2].filter(n => n <= seq.length);
  for (const len of lengths) {
    const target = seq.slice(-len);
    const lengthWeight = ({5:1.00,4:0.78,3:0.56,2:0.36})[len] || 0.25;
    for (let end = minIndex + len - 1; end < maxIndex; end += 1) {
      const cand = sequence(stateCache, end, len);
      if (cand.length !== len) continue;
      const sim = weightedSimilarity(target, cand);
      const threshold = len >= 5 ? 0.72 : len === 4 ? 0.76 : len === 3 ? 0.82 : 0.94;
      if (sim < threshold) continue;
      const next = stateBeforeWinner(stateCache, end + 1);
      if (next === null) continue;
      const weight = lengthWeight * Math.pow(sim, 5);
      support[next] += weight;
      stats.weight += weight;
      if (len === 5 && sim > 0.999) stats.exact += 1;
      else stats.near += 1;
    }
  }
}

function addSwitchEvidence(stateCache, seq, minIndex, maxIndex, support, stats) {
  if (seq.length < 3) return;
  const last = seq.at(-1), prev = seq.at(-2), before = seq.at(-3);
  const targetChanged = last !== prev;
  const targetChangedTwice = prev !== before;
  for (let i = Math.max(3, minIndex); i < maxIndex; i += 1) {
    const a = stateBeforeWinner(stateCache, i - 2);
    const b = stateBeforeWinner(stateCache, i - 1);
    const c = stateBeforeWinner(stateCache, i);
    const next = stateBeforeWinner(stateCache, i + 1);
    if ([a,b,c,next].some(v => v === null)) continue;
    let match = 0;
    if (b === prev && c === last) match += 0.48;
    if ((c !== b) === targetChanged) match += 0.24;
    if ((b !== a) === targetChangedTwice) match += 0.14;
    if (Math.sign(c - b) === Math.sign(last - prev)) match += 0.14;
    if (match < 0.60) continue;
    const weight = 0.9 * Math.pow(match, 3);
    support[next] += weight;
    stats.weight += weight;
    stats.switchCases += 1;
  }
}

function currentAvailability(drawCounts, endIndex) {
  const current = drawCounts[endIndex];
  const byState = Array.from({length:5}, () => []);
  for (let col = 1; col <= 10; col += 1) byState[Math.min(4, current[col])].push(col);
  return byState;
}

function profileKey(available) { return available.map(x => x.length).join('-'); }

function densityProfileForecast(stateCache, drawCounts, endIndex, maxIndex) {
  const available = currentAvailability(drawCounts, endIndex);
  const baseProbs = available.map(cols => cols.length / 10);
  const targetKey = profileKey(available);
  const countsNext = Array(5).fill(0);
  let matches = 0;
  for (let currentIndex = 0; currentIndex <= maxIndex; currentIndex += 1) {
    const historicalAvailable = currentAvailability(drawCounts, currentIndex);
    if (profileKey(historicalAvailable) !== targetKey) continue;
    const nextState = stateBeforeWinner(stateCache, currentIndex + 1);
    if (nextState === null) continue;
    countsNext[nextState] += 1;
    matches += 1;
  }
  const alpha = 20;
  const profileProbs = countsNext.map((count, state) =>
    (count + alpha * baseProbs[state]) / (matches + alpha)
  );
  return {available, baseProbs, profileProbs, profileMatches: matches};
}

function analogForecast(stateCache, drawCounts, seq, minIndex, maxIndex, endIndex) {
  const support = Array(5).fill(0);
  const stats = {exact:0, near:0, switchCases:0, weight:0};
  addSuffixEvidence(stateCache, seq, minIndex, maxIndex, support, stats);
  addSwitchEvidence(stateCache, seq, minIndex, maxIndex, support, stats);
  addHistoricalBaseline(stateCache, support, minIndex, maxIndex, Math.max(0.35, stats.weight * 0.25));
  const density = densityProfileForecast(stateCache, drawCounts, endIndex, maxIndex);
  const supportTotal = support.reduce((a,b) => a+b, 0);
  const chainProbs = supportTotal ? support.map(v => v/supportTotal) : density.baseProbs.slice();
  const mixed = density.profileProbs.map((v, state) =>
    density.available[state].length ? 0.30*v + 0.70*chainProbs[state] : 0
  );
  const total = mixed.reduce((a,b)=>a+b,0) || 1;
  const probs = mixed.map(v => v/total);
  return {...stats, probs, available:density.available};
}

function recentWinnerRate(winnerCache, col, endIndex, window) {
  const start = Math.max(0, endIndex - window + 1);
  let hits = 0;
  for (let i = start; i <= endIndex; i += 1) if (winnerCache[i] === col) hits += 1;
  return hits / Math.max(1, endIndex - start + 1);
}

function densityMomentum(drawCounts, col, endIndex) {
  if (endIndex < 2) return 0;
  const recentStart = Math.max(0, endIndex - 3);
  const previousEnd = recentStart - 1;
  const previousStart = Math.max(0, previousEnd - 3);
  let rs=0,rn=0,ps=0,pn=0;
  for (let i=recentStart;i<=endIndex;i+=1){rs+=drawCounts[i][col];rn+=1;}
  for (let i=previousStart;i<=previousEnd;i+=1){ps+=drawCounts[i][col];pn+=1;}
  return rs/Math.max(1,rn)-ps/Math.max(1,pn);
}

function transitionWinnerRate(winnerCache, col, endIndex, window) {
  if (endIndex < 2) return 0.10;
  const previousWinner = winnerCache[endIndex];
  const start = Math.max(1, endIndex - window + 1);
  let cases=0,hits=0;
  for (let i=start;i<=endIndex;i+=1){
    if (winnerCache[i-1] !== previousWinner) continue;
    cases += 1;
    if (winnerCache[i] === col) hits += 1;
  }
  return (hits+2)/(cases+20);
}

function stableTie(draws, col, endIndex, salt) {
  let x=(Number(draws[endIndex]?.draw)||endIndex+1)^Math.imul(col+salt,0x9e3779b1);
  x^=x>>>16;x=Math.imul(x,0x85ebca6b);x^=x>>>13;
  return (x>>>0)/4294967296;
}

const GROUP_MOVEMENT_CONFIG = {
  p2:{minN:1200,minHalf:500,edge:0.0040,alpha:400,sprint:0.28},
  p3:{minN:700,minHalf:250,edge:0.0050,alpha:300,sprint:0.25},
  p4:{minN:450,minHalf:180,edge:0.0060,alpha:220,sprint:0.20},
  p5:{minN:350,minHalf:140,edge:0.0065,alpha:180,sprint:0.12},
  nbr:{minN:900,minHalf:350,edge:0.0045,alpha:350,sprint:0.12},
  empty:{minN:200,minHalf:75,edge:0.0060,alpha:250,sprint:0.08}
};

function gmNewBook(){return {all:new Map(),first:new Map(),second:new Map()};}
function gmBump(map,key,hit){const r=map.get(key)||{n:0,wins:0};r.n+=1;if(hit)r.wins+=1;map.set(key,r);}
function gmAdd(book,key,hit,firstHalf){gmBump(book.all,key,hit);gmBump(firstHalf?book.first:book.second,key,hit);}
function gmStateAt(drawCounts,index,col){return Math.min(4,drawCounts[index]?.[col]||0);}
function gmPathKey(drawCounts,endIndex,col,len){const a=[];for(let i=endIndex-len+1;i<=endIndex;i+=1)a.push(gmStateAt(drawCounts,i,col));return a.join('>');}
function gmNeighborKey(drawCounts,index,col){const l=col===1?10:col-1,r=col===10?1:col+1;const sides=[gmStateAt(drawCounts,index,l),gmStateAt(drawCounts,index,r)].sort((a,b)=>a-b);return `${gmStateAt(drawCounts,index,col)}|${sides[0]}|${sides[1]}`;}
function gmEmptyBucket(drawCounts,index,col){if(gmStateAt(drawCounts,index,col)!==0)return null;let streak=0;for(let i=index;i>=0&&streak<4;i-=1){if(gmStateAt(drawCounts,i,col)!==0)break;streak+=1;}return String(Math.min(4,streak));}

function buildGroupMovementStats(winnerCache, drawCounts, endIndex) {
  const books={p2:gmNewBook(),p3:gmNewBook(),p4:gmNewBook(),p5:gmNewBook(),nbr:gmNewBook(),empty:gmNewBook()};
  const zeroStreak=Array(11).fill(0);
  const split=Math.floor(endIndex/2);
  for(let t=0;t<endIndex;t+=1){
    const nextWinner=winnerCache[t+1],firstHalf=t<split;
    for(let col=1;col<=10;col+=1){
      const hit=col===nextWinner,state=gmStateAt(drawCounts,t,col);
      zeroStreak[col]=state===0?Math.min(4,zeroStreak[col]+1):0;
      for(const len of [2,3,4,5]){if(t<len-1)continue;gmAdd(books[`p${len}`],gmPathKey(drawCounts,t,col,len),hit,firstHalf);}
      gmAdd(books.nbr,gmNeighborKey(drawCounts,t,col),hit,firstHalf);
      if(state===0)gmAdd(books.empty,String(zeroStreak[col]),hit,firstHalf);
    }
  }
  return {books};
}

function gmStableSignal(stats, feature, key) {
  const cfg=GROUP_MOVEMENT_CONFIG[feature],book=stats.books[feature];
  const all=book.all.get(key),first=book.first.get(key),second=book.second.get(key);
  if(!all||!first||!second)return null;
  if(all.n<cfg.minN||first.n<cfg.minHalf||second.n<cfg.minHalf)return null;
  const posterior=(all.wins+0.10*cfg.alpha)/(all.n+cfg.alpha);
  const halfAlpha=cfg.alpha/2;
  const r1=(first.wins+0.10*halfAlpha)/(first.n+halfAlpha);
  const r2=(second.wins+0.10*halfAlpha)/(second.n+halfAlpha);
  if(Math.abs(posterior-0.10)<cfg.edge)return null;
  if((r1-0.10)*(r2-0.10)<=0)return null;
  if(Math.abs(r1-r2)>0.025)return null;
  const normalized=Math.max(-1,Math.min(1,(posterior-0.10)/0.02));
  return {weight:cfg.sprint,effect:normalized*cfg.sprint};
}

function groupMovementScore(stats, drawCounts, endIndex, col) {
  const signals=[];
  for(const len of [2,3,4,5]){const f=`p${len}`;const s=gmStableSignal(stats,f,gmPathKey(drawCounts,endIndex,col,len));if(s)signals.push(s);}
  const n=gmStableSignal(stats,'nbr',gmNeighborKey(drawCounts,endIndex,col));if(n)signals.push(n);
  const ek=gmEmptyBucket(drawCounts,endIndex,col);if(ek!==null){const e=gmStableSignal(stats,'empty',ek);if(e)signals.push(e);}
  const weightedSum=signals.reduce((s,x)=>s+x.effect,0);
  const weightSum=signals.reduce((s,x)=>s+x.weight,0);
  const quality=weightedSum/Math.max(0.25,weightSum);
  const coverage=Math.min(1,weightSum/0.35);
  return Math.max(-0.85,Math.min(0.85,quality*coverage*1.10));
}

function drawStamp(d){
  const dm=String(d?.date||'').match(/(\d{1,2})[.\/-](\d{1,2})[.\/-](\d{4}|\d{2})(?!\d)/);
  const tm=String(d?.time||'').match(/(\d{1,2}):(\d{2})/);
  if(!dm||!tm)return null;
  const y=dm[3].length===2?2000+Number(dm[3]):Number(dm[3]);
  return new Date(y,Number(dm[2])-1,Number(dm[1]),Number(tm[1]),Number(tm[2])).getTime();
}

function splitIntoCycles(draws,indices){
  const cycles=[];let current=[];
  for(const index of indices){
    if(!current.length){current.push(index);continue;}
    const prevIndex=current.at(-1),ps=drawStamp(draws[prevIndex]),cs=drawStamp(draws[index]);
    const gap=ps!==null&&cs!==null?Math.round((cs-ps)/60000):30;
    const newCycle=gap>35||draws[index]?.date!==draws[prevIndex]?.date||current.length>=5;
    if(newCycle){cycles.push(current);current=[index];}else current.push(index);
  }
  if(current.length)cycles.push(current);return cycles;
}

function sprintPred(draws,caches,endIndex,noShort=false){
  const {winnerCache,drawCounts,stateCache}=caches;
  const date=draws[endIndex].date;
  const day=[];for(let i=0;i<=endIndex;i+=1)if(draws[i]?.date===date)day.push(i);
  const cycles=splitIntoCycles(draws,day);
  const chosen=cycles.slice(-2).flat();
  const seq=chosen.map(i=>stateBeforeWinner(stateCache,i)).filter(v=>v!==null);
  const pred=analogForecast(stateCache,drawCounts,seq,1,endIndex-1,endIndex);
  const movementStats=buildGroupMovementStats(winnerCache,drawCounts,endIndex);
  const rows=[];
  for(let col=1;col<=10;col+=1){
    const state=Math.min(4,drawCounts[endIndex][col]);
    const groupSize=Math.max(1,pred.available[state]?.length||0);
    const perColumnRegime=(pred.probs[state]||0)/groupSize;
    const rate12=recentWinnerRate(winnerCache,col,endIndex,12);
    const rate30=recentWinnerRate(winnerCache,col,endIndex,30);
    const transition=transitionWinnerRate(winnerCache,col,endIndex,160);
    const momentum=Math.max(-2,Math.min(2,densityMomentum(drawCounts,col,endIndex)));
    const activity=noShort?rate30:(0.65*rate12+0.35*rate30);
    const movement=groupMovementScore(movementStats,drawCounts,endIndex,col);
    const score=activity*55+transition*25+perColumnRegime*12+momentum*1.5+movement+stableTie(draws,col,endIndex,17)*0.0001;
    rows.push({col,score,rate12,rate30});
  }
  rows.sort((a,b)=>b.score-a.score||stableTie(draws,b.col,endIndex,91)-stableTie(draws,a.col,endIndex,91));
  return rows;
}

function freq30Pred(draws,caches,endIndex,tieMode='stable'){
  const rows=[];
  for(let col=1;col<=10;col+=1){
    const r=recentWinnerRate(caches.winnerCache,col,endIndex,30);
    rows.push({col,score:r});
  }
  if(tieMode==='col')rows.sort((a,b)=>b.score-a.score||a.col-b.col);
  else rows.sort((a,b)=>b.score-a.score||stableTie(draws,b.col,endIndex,91)-stableTie(draws,a.col,endIndex,91));
  return rows;
}

function metrics(rows,key){
  const out={top1:0,top2:0,top3:0,top5:0,meanRank:0,ranks:Array(10).fill(0)};
  for(const r of rows){const rank=r[`${key}Rank`];if(rank<=1)out.top1++;if(rank<=2)out.top2++;if(rank<=3)out.top3++;if(rank<=5)out.top5++;out.meanRank+=rank;out.ranks[rank-1]++;}
  out.meanRank=Number((out.meanRank/rows.length).toFixed(3));return out;
}

function evalRange(draws,caches,startDraw,endDraw){
  const idx=new Map(draws.map((d,i)=>[Number(d.draw),i]));
  const rows=[];
  for(let target=startDraw;target<=endDraw;target+=1){
    const i=idx.get(target);if(!Number.isInteger(i)||i<1)throw new Error(`Нет тиража ${target}`);
    const endIndex=i-1;
    const actual=caches.winnerCache[i];
    const sprint=sprintPred(draws,caches,endIndex,false).map(x=>x.col);
    const noShort=sprintPred(draws,caches,endIndex,true).map(x=>x.col);
    const freq30=freq30Pred(draws,caches,endIndex,'stable').map(x=>x.col);
    const freq30col=freq30Pred(draws,caches,endIndex,'col').map(x=>x.col);
    const rank=a=>a.indexOf(actual)+1;
    rows.push({target,actual,sprintRank:rank(sprint),noShortRank:rank(noShort),freq30Rank:rank(freq30),freq30colRank:rank(freq30col),sprint:sprint.join('-'),noShort:noShort.join('-'),freq30:freq30.join('-')});
  }
  return {rows,sprint:metrics(rows,'sprint'),noShort:metrics(rows,'noShort'),freq30:metrics(rows,'freq30'),freq30col:metrics(rows,'freq30col')};
}

function csvEscape(v){const s=String(v??'');return /[",\n]/.test(s)?`"${s.replace(/"/g,'""')}"`:s;}

function main(){
  const draws=JSON.parse(fs.readFileSync(HISTORY,'utf8')).map(d=>({...d,draw:Number(d.draw),balls:(d.balls||[]).map(Number),column:d.column==null?null:Number(d.column)})).sort((a,b)=>a.draw-b.draw);
  const caches=buildCaches(draws);
  const validation=evalRange(draws,caches,327698,327747);
  const independent=evalRange(draws,caches,327648,327697);
  const result={generatedAt:new Date().toISOString(),definition:{noShort:'Sprint 2.3.0 with only the 12-draw correction removed: activity=rate30 instead of 0.65*rate12+0.35*rate30; all transitions, regime/group analogs, momentum, movement and tie logic unchanged.'},validationRange:[327698,327747],independentRange:[327648,327697],validation:{sprint:validation.sprint,noShort:validation.noShort,freq30:validation.freq30,freq30col:validation.freq30col},independent:{sprint:independent.sprint,noShort:independent.noShort,freq30:independent.freq30,freq30col:independent.freq30col},rows:[...validation.rows.map(r=>({...r,block:'validation'})),...independent.rows.map(r=>({...r,block:'independent'}))]};
  fs.mkdirSync(OUTPUT_DIR,{recursive:true});
  fs.writeFileSync(OUTPUT_JSON,JSON.stringify(result,null,2)+'\n');
  const headers=['block','target','actual','sprintRank','noShortRank','freq30Rank','freq30colRank','sprint','noShort','freq30'];
  fs.writeFileSync(OUTPUT_CSV,headers.join(',')+'\n'+result.rows.map(r=>headers.map(h=>csvEscape(r[h])).join(',')).join('\n')+'\n');
  console.log('VALIDATION 327698-327747');
  console.log(JSON.stringify(result.validation,null,2));
  console.log('INDEPENDENT 327648-327697');
  console.log(JSON.stringify(result.independent,null,2));
  console.log(`RESULT_JSON=${OUTPUT_JSON}`);
}

main();
