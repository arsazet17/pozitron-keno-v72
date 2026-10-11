'use strict';
/* B5-frozen-2026-10-11 · independent voting rules; UI adapter v7.2.5 */
(()=>{
const $=id=>document.getElementById(id), col=n=>n%10||10;
const POOL=['Вчера, слот 0','Вчера, слот −1','Вчера, слот +1','Позавчера, слот 0','3 дня назад, слот 0','Мода 7 дней','Волна 0','Волна +1','Волна −1','Сегмент 3 → вчера','Разворот → возврат','Остановка → повтор'];
const GN=['ГР0','ГР1','ГР2','ГР3','ГР4+'], KEY='pozitron_b5_five_v1', VERSION='7.2.7 · B5 experimental';
let selectedDate='', selected='all';
function validOfficial(d){return Number.isInteger(d?.column)&&d.column>=1&&d.column<=10}
function normDate(s){const m=String(s||'').match(/^(\d{4})-(\d\d)-(\d\d)$/);return m?m[3]+'.'+m[2]+'.'+m[1].slice(-2):s}
function engine(history){
 const H=history.slice().sort((a,b)=>a.draw-b.draw).map(d=>({...d,date:normDate(d.date)})),N=H.length;
 const counts=H.map(d=>{const c=Array(10).fill(0);d.balls.forEach(n=>c[col(n)-1]++);return c});
 const G=Array(N).fill(-1);for(let i=1;i<N;i++)if(validOfficial(H[i])&&H[i].draw===H[i-1].draw+1)G[i]=Math.min(counts[i-1][H[i].column-1],4);
 const dates=[...new Set(H.map(d=>d.date))].sort((a,b)=>{const v=x=>x.split('.').reverse().join('');return v(a).localeCompare(v(b))}),di=new Map(dates.map((d,i)=>[d,i]));
 const days=dates.map(()=>[]);H.forEach((d,i)=>days[di.get(d.date)].push(i));days.forEach(a=>a.sort((i,j)=>H[i].time.localeCompare(H[j].time)));
 const pos=days.map(a=>new Map(a.map((i,p)=>[H[i].time,p]))),dayOf=H.map(d=>di.get(d.date));
 return {H,N,counts,G,dates,days,pos,dayOf};
}
function nextTarget(e){const last=e.H.at(-1),di=e.dayOf.at(-1),ref=e.days[Math.max(di-1,0)].map(i=>e.H[i].time),nx=ref.find(t=>t>last.time);if(nx)return {dayIdx:di,date:last.date,time:nx,draw:last.draw+1};const [d,m,y]=last.date.split('.').map(Number),dt=new Date(Date.UTC(2000+y,m-1,d+1));return {dayIdx:di+1,date:String(dt.getUTCDate()).padStart(2,'0')+'.'+String(dt.getUTCMonth()+1).padStart(2,'0')+'.'+String(dt.getUTCFullYear()).slice(-2),time:ref[0]||'00:02',draw:last.draw+1}}
function predict(e,t,target){
 const tg=target||(t===e.N?nextTarget(e):{dayIdx:e.dayOf[t],date:e.H[t].date,time:e.H[t].time,draw:e.H[t].draw});
 const gx=i=>i>=0&&i<t?e.G[i]:-1;
 const cell=(lag,s)=>{const dd=tg.dayIdx-lag;if(dd<0||dd>=e.dates.length)return -1;const q=e.pos[dd].get(tg.time);if(q===undefined)return -1;const p=q+s;return p<0||p>=e.days[dd].length?-1:e.days[dd][p]};
 const D=(lag,s)=>gx(cell(lag,s)),g1=gx(t-1),g2=gx(t-2),g3=gx(t-3),pr=[],src=[];
 const ct=(lag,s)=>{const i=cell(lag,s);return i>=0&&i<t?'№'+e.H[i].draw+' '+e.H[i].date+' '+e.H[i].time+' → '+(e.G[i]<0?'нет данных':GN[e.G[i]]):'ячейки нет'};
 const push=(g,s)=>{pr.push(g);src.push(s)};
 push(D(1,0),ct(1,0));push(D(1,-1),ct(1,-1));push(D(1,1),ct(1,1));push(D(2,0),ct(2,0));push(D(3,0),ct(3,0));
 const cnt=[0,0,0,0,0];for(let l=1;l<=7;l++){const v=D(l,0);if(v>=0)cnt[v]++}const mxm=Math.max(...cnt),um=cnt.filter(c=>c===mxm).length===1;
 push(mxm>=4&&um?cnt.indexOf(mxm):-1,'группы за 7 дней: '+cnt.map((c,g)=>GN[g]+'×'+c).join(' '));
 for(const s of [0,1,-1]){const a=D(1,-s),b=D(2,-2*s);push(a>=0&&a===b?a:-1,'вчера '+(a<0?'—':GN[a])+', позавчера '+(b<0?'—':GN[b]))}
 const y1=D(1,-1),y2=D(1,-2),y3=D(1,-3);
 push(g1>=0&&g1===y1&&g2===y2&&g3===y3?D(1,0):-1,'последние 3: '+[g3,g2,g1].join('')+'; вчера: '+[y3,y2,y1].join(''));
 const v3=g1>=0&&g2>=0&&g3>=0,d1=g2-g3,d2=g1-g2;
 push(v3&&d1*d2<0?g2:-1,'последние 3 группы: '+[g3,g2,g1].join(''));
 push(v3&&d2===0?g1:-1,'последние 3 группы: '+[g3,g2,g1].join(''));
 const votes=[0,0,0,0,0];pr.forEach(g=>{if(g>=0)votes[g]++});
 const mx=Math.max(...votes),uniq=votes.filter(v=>v===mx).length===1,b5=mx>=4&&uniq?votes.indexOf(mx):-1;
 const prev=e.counts[t-1],cb=[[],[],[],[],[]];prev.forEach((c,i)=>cb[Math.min(c,4)].push(i+1));
 const m7=pr[5],y=pr[0],F=[1,2,3,4,5,6,7,8,9,10],colsOf=g=>g<0?[]:cb[g];
 const build=seq=>[...new Set(seq.concat(F))].slice(0,5);
 const gord=[0,1,2,3,4].sort((a,b)=>votes[b]-votes[a]||cb[b].length-cb[a].length||a-b),gof={};cb.forEach((list,g)=>list.forEach(c=>gof[c]=g));
 const A=build(colsOf(b5).concat(colsOf(m7))),B=build(colsOf(b5).concat(colsOf(y))),V=build(colsOf(b5).concat(...gord.map(g=>cb[g])));
 const sc=c=>[2*(b5>=0&&gof[c]===b5?1:0)+(m7>=0&&gof[c]===m7?1:0)+(y>=0&&gof[c]===y?1:0),votes[gof[c]],-(c-1)];
 const G=F.slice().sort((a,b)=>{const x=sc(a),z=sc(b);return z[0]-x[0]||z[1]-x[1]||z[2]-x[2]}).slice(0,5);
 return {target:{draw:tg.draw,date:tg.date,time:tg.time},votes,maxVotes:mx,uniqueLeader:uniq,signal:b5>=0,b5Index:b5,b5Group:b5>=0?GN[b5]:null,mainColumns:b5>=0?cb[b5]:[],emptyMainGroup:b5>=0&&cb[b5].length===0,groups:cb,five:{A,B,V,G},reasons:pr.map((g,i)=>({rule:POOL[i],group:g<0?null:GN[g],source:src[i]}))};
}
function log(){try{const a=JSON.parse(localStorage.getItem(KEY)||'[]');return Array.isArray(a)?a:[]}catch{return []}}
function write(a){try{localStorage.setItem(KEY,JSON.stringify(a))}catch(e){console.warn('B5 journal write',e)}}
function record(p){const a=log();if(a.some(r=>r.draw===p.target.draw))return false;const now=Date.now();a.push({draw:p.target.draw,date:p.target.date,time:p.target.time,savedAt:new Date(now).toISOString(),votes:p.votes,b5Group:p.b5Group,mainColumns:p.mainColumns,five:p.five,winner:null,result:null,control:control(p.target.draw)});write(a);return true}
function control(seed){let x=(Number(seed)>>>0)||1;const a=[1,2,3,4,5,6,7,8,9,10];for(let i=9;i>0;i--){x=(Math.imul(x,1664525)+1013904223)>>>0;const j=x%(i+1);[a[i],a[j]]=[a[j],a[i]]}return a.slice(0,5)}
function calculatedColumn(d){
 if(!Array.isArray(d?.balls)||d.balls.length!==20)return null;
 const counts=Array(11).fill(0),reached=Array(11).fill(999);
 for(let i=0;i<20;i++)counts[col(d.balls[i])]++;
 const max=Math.max(...counts.slice(1));
 for(let k=1;k<=10;k++)if(counts[k]===max){let n=0;for(let i=0;i<20;i++)if(col(d.balls[i])===k&&++n===max){reached[k]=i;break}}
 let win=1;for(let k=2;k<=10;k++)if(counts[k]>counts[win]||(counts[k]===counts[win]&&reached[k]<reached[win]))win=k;
 return win
}
function settle(H){
 const a=log(),by=new Map(H.map(d=>[Number(d.draw),d]));let changed=false;
 for(const r of a){
  const d=by.get(r.draw);if(!d)continue;
  const official=validOfficial(d),winner=official?d.column:calculatedColumn(d);
  if(winner===null)continue;
  const source=official?'official':'calculated';
  const previousSource=r.winnerSource||'unknown';
  if(r.winner!==null&&r.winner!==undefined&&previousSource==='official')continue;
  if(r.winner===winner&&previousSource===source)continue;
  r.winner=winner;r.winnerSource=source;
  const drawDate=String(d.date).includes('.')?String(d.date).split('.').reverse().map((v,i)=>i===0&&v.length===2?'20'+v:v).join('-'):d.date;
  const ts=Date.parse(r.savedAt),dt=Date.parse(drawDate+'T'+d.time+':00');
  r.late=Number.isFinite(ts)&&Number.isFinite(dt)&&ts>=dt;
  r.result={};for(const k of ['A','B','V','G'])r.result[k]=r.five[k].includes(winner);
  r.result.control=r.control.includes(winner);r.result.b5Group=r.b5Group?r.mainColumns.includes(winner):null;changed=true
 }
 if(changed)write(a);return a
}
function wilson(h,n){if(!n)return '—';const z=1.96,p=h/n,q=z*z,den=1+q/n,c=(p+q/(2*n))/den,m=z*Math.sqrt((p*(1-p)+q/(4*n))/n)/den;return (100*(c-m)).toFixed(1)+'–'+(100*(c+m)).toFixed(1)+'%'}
function summary(a,k){const done=a.filter(r=>r.result&&r.winnerSource==='official'&&!r.late),n=done.length,h=done.filter(r=>r.result[k]).length;let streak=0,max=0;for(const r of done){streak=r.result[k]?0:streak+1;max=Math.max(max,streak)}return {n,h,miss:n-h,rate:n?(100*h/n).toFixed(1)+'%':'—',ci:wilson(h,n),excess:(h-n*.5).toFixed(1),max}}
function escape(s){return String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]))}
function fiveHtml(label,arr,p){return '<div class="sm-line"><b>'+label+': </b>'+arr.map(c=>'<span style="display:inline-block;border:1px solid #62dc99;border-radius:7px;margin:2px;padding:5px 9px;'+(p.mainColumns.includes(c)?'background:#245b47;color:#a4ffcc':'color:#f4f8ff')+'">ст'+c+'</span>').join('')+'</div>'}
function modelHtml(name,key,p){const arr=p.five[key];return '<div class="sm-head">'+name+'</div><div class="small">В5 экспериментальный · '+(p.signal?'сигнал '+p.b5Group+' · '+p.maxVotes+' голосов': 'нет сигнала')+(p.emptyMainGroup?' · пустая группа':'')+'</div>'+fiveHtml('Пять столбов',arr,p)}
function historyRows(a,keys){
 const rows=a.slice().sort((x,y)=>y.draw-x.draw);
 if(!rows.length)return '<div class="small">Пока нет сохранённых прогнозов.</div>';
 return rows.map(r=>{
  const has=r.winner!==null&&r.winner!==undefined;
  const label=has?'🔴 Вышел ст'+r.winner+(r.winnerSource==='official'?' · официальный':' · рассчитан по 20 числам'):'⏳ ФАКТА НЕТ';
  const status=k=>!has?'⏳ ОЖИДАНИЕ':(r.result?.[k]?'✅ ПОПАЛ':'❌ МИМО')+(r.winnerSource!=='official'?' · предварительно':'')+(r.late?' · записано после времени тиража':'');
  return '<div class="sm-line" style="border-bottom:1px solid #30435b;padding:12px 0"><b>№'+r.draw+' · '+escape(r.date)+' '+escape(r.time)+'</b><div style="margin:5px 0;font-weight:700">'+label+'</div>'+keys.map(([k,name])=>'<div style="margin-top:7px">'+name+': '+r.five[k].map(v=>'ст'+v).join(' · ')+'<div style="font-weight:700">'+status(k)+'</div></div>').join('')+'</div>'
 }).join('')
}
function journalHtml(a,which){
 const sprint=which!=='marathon',marathon=which!=='sprint';
 let h='<div class="sm-archive" style="margin-top:12px">';
 if(sprint){const s=summary(a,'A');h+='<details class="sm-archive" open><summary>🏃 Архив Спринта · '+s.h+' попаданий / '+s.n+' проверено</summary>'+historyRows(a,[['A','Основной А'],['B','Доп. Б']])+'</details>'}
 if(marathon){const s=summary(a,'G');h+='<details class="sm-archive" open><summary>🐢 Архив Марафона · '+s.h+' попаданий / '+s.n+' проверено</summary>'+historyRows(a,[['G','Основной Г'],['V','Доп. В']])+'</details>'}
 h+='<details class="sm-archive"><summary>📊 Подробная статистика и экспорт CSV</summary><div class="small">В архиве показывается расчётный победитель, если официальный отсутствует. В статистику включаются только официально подтверждённые факты и своевременно сохранённые прогнозы.</div>';
 for(const [k,name] of [['A','Спринт А'],['B','Спринт Б'],['G','Марафон Г'],['V','Марафон В'],['control','Контроль']]){const s=summary(a,k);h+='<div class="sm-line"><b>'+name+'</b> · '+s.h+'/'+s.n+' ('+s.rate+') · ДИ '+s.ci+' · избыток '+s.excess+' · макс. MISS '+s.max+'</div>'}
 h+='<button id="b5Export" class="tool" type="button">⬇️ Экспорт журнала CSV</button></details></div>';return h
}
function exportCsv(){const rows=[['draw','date','time','savedAt','winner','b5Group','main','A','B','V','G','control','hitA','hitB','hitV','hitG','hitControl']];for(const r of log())rows.push([r.draw,r.date,r.time,r.savedAt,r.winner??'',r.b5Group||'',r.mainColumns.join(' '),...['A','B','V','G'].map(k=>r.five[k].join(' ')),r.control.join(' '),...['A','B','V','G','control'].map(k=>r.result?(r.result[k]?1:0):'')]);const csv=rows.map(a=>a.map(v=>'"'+String(v).replace(/"/g,'""')+'"').join(';')).join('\r\n');const u=URL.createObjectURL(new Blob(['\ufeff'+csv],{type:'text/csv;charset=utf-8'}));const a=document.createElement('a');a.href=u;a.download='B5_five_journal.csv';a.click();setTimeout(()=>URL.revokeObjectURL(u),1000)}
function render(which='all'){const box=$('sprintMarathonResult');if(!box)return;const H=typeof draws!=='undefined'&&Array.isArray(draws)?draws:[];if(!H.length){box.textContent='Нет архива тиражей';return}const e=engine(H);if(e.N<2){box.textContent='Недостаточно тиражей';return}const p=predict(e,e.N),latest=H.at(-1),live=selectedDate===''||selectedDate===latest.date;const a=settle(H);if(live)record(p);const journal=journalHtml(settle(H),which);const dateOptions=[...new Set(H.map(d=>d.date))].reverse();if(!selectedDate||!dateOptions.includes(selectedDate))selectedDate=latest.date;const dateSelect='<div class="sm-date-row"><b>День анализа</b><select id="smDateSelect">'+dateOptions.map(d=>'<option value="'+escape(d)+'"'+(d===selectedDate?' selected':'')+'>'+escape(d)+'</option>').join('')+'</select></div>';let body='';if(selectedDate===latest.date){body='<div class="small">Следующий №'+p.target.draw+' · '+p.target.date+' '+p.target.time+' · версия '+VERSION+'</div>';body+=(which==='sprint'?modelHtml('🏃 СПРИНТ · вариант А','A',p)+modelHtml('🏃 Дополнительный вариант Б','B',p):which==='marathon'?modelHtml('🐢 МАРАФОН · вариант Г','G',p)+modelHtml('🐢 Дополнительный вариант В','V',p):modelHtml('🏃 СПРИНТ · А','A',p)+modelHtml('🏃 Доп. Б','B',p)+modelHtml('🐢 МАРАФОН · Г','G',p)+modelHtml('🐢 Доп. В','V',p));body+='<details><summary>12 правил и источники · голоса '+p.votes.join('/')+'</summary>'+p.reasons.map((r,i)=>'<div class="sm-line">'+(i+1)+'. '+escape(r.rule)+' → '+(r.group||'—')+' · '+escape(r.source)+'</div>').join('')+'</details>';body+='<div class="small">Главная группа: '+(p.b5Group||'нет сигнала')+' · '+(p.mainColumns.join(', ')||'пустая')+'; голосов: '+p.votes.join('/')+'</div>'}else{body='<div class="small">Исторический день: новый движок не выдаёт задним числом прогнозы. Для проверки используйте журнал заранее сохранённых пятёрок.</div>'}box.innerHTML=dateSelect+body+journal;const s=$('smDateSelect');if(s)s.onchange=ev=>{selectedDate=ev.target.value;render(which)};const b=$('b5Export');if(b)b.onclick=exportCsv}
function start(){const a=$('sprintBtn'),b=$('marathonBtn');if(a)a.onclick=()=>{$('sprintMarathonPanel')?.classList.add('show');render('sprint')};if(b)b.onclick=()=>{$('sprintMarathonPanel')?.classList.add('show');render('marathon')};render('all');window.addEventListener('focus',()=>render('all'));document.addEventListener('visibilitychange',()=>{if(!document.hidden)render('all')});setInterval(()=>render('all'),60000)}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',start,{once:true});else start();
})();
