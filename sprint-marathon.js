'use strict';
/* Спринт / Марафон · В5 · ровно ПЯТЬ столбцов. Показывается только прогноз варианта PRIMARY из серверного журнала. */
(()=>{
const $=id=>document.getElementById(id);
const PRIMARY='A';
const esc=s=>String(s??'').replace(/[&<>]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;'}[c]));
const chip=(c,main)=>'<span class="b5-chip" style="display:inline-block;min-width:44px;text-align:center;margin:3px;padding:8px 6px;border:1px solid #62dc99;border-radius:8px;'+(main?'background:#245b47;color:#a4ffcc;font-weight:700':'color:#f4f8ff')+'">ст'+c+'</span>';
let data=null;
function valid(cols){return Array.isArray(cols)&&cols.length===5&&new Set(cols).size===5&&cols.every(c=>Number.isInteger(c)&&c>=1&&c<=10)}
function fiveOf(r){const cols=r.forecast?r.forecast.columns:(r.five&&r.five[PRIMARY]);return valid(cols)?{cols,main:(r.mainColumns||[]).filter(c=>cols.includes(c))}:null}
function hitOf(r){if(!r.result)return null;return typeof r.result.forecast==='boolean'?r.result.forecast:r.result[PRIMARY]}
function wilson(h,n){if(!n)return '—';const z=1.96,p=h/n,q=z*z,d=1+q/n,c=(p+q/(2*n))/d,m=z*Math.sqrt((p*(1-p)+q/(4*n))/n)/d;return (100*(c-m)).toFixed(1)+'–'+(100*(c+m)).toFixed(1)+'%'}
function stat(done,get){const n=done.length,h=done.filter(get).length;let run=0,mx=0;done.forEach(r=>{run=get(r)?0:run+1;mx=Math.max(mx,run)});return{n,h,miss:n-h,rate:n?(100*h/n).toFixed(1)+'%':'—',ci:wilson(h,n),excess:(h-n/2).toFixed(1),z:n?((h-n/2)/Math.sqrt(n/4)).toFixed(2):'—',mx}}
function render(){
 const box=$('sprintMarathonResult');if(!box)return;
 const sectionStates=Array.from(box.querySelectorAll('details'),x=>x.open);
 if(!data){box.textContent='Серверный журнал В5 ещё не создан. Прогноз задним числом не формируется.';return}
 const recs=data.records||[],next=recs.filter(r=>!r.result).at(-1);
 let h='<h3>В5 · пять столбцов (эксперимент)</h3><div class="small">Ровно пять столбцов на тираж. Заливка — столбцы основной группы В5, контур — дополнительные (дозаполнение по возрастанию номера).</div>';
 if(next){
  const f=fiveOf(next);
  h+='<p>Следующий №'+next.draw+' · '+esc(next.date)+' '+esc(next.time)+'</p>';
  if(!f)h+='<p>Ошибка журнала: прогноз не состоит из пяти разных столбцов, он не показан.</p>';
  else{
   h+='<div>'+f.cols.map(c=>chip(c,f.main.includes(c))).join('')+'</div>';
   const gn=['ГР0','ГР1','ГР2','ГР3','ГР4+'];
   h+='<p>'+(next.signal?'Сигнал В5: '+esc(next.b5Group)+' · '+next.votes[next.b5Index]+' голосов · столбцов в группе '+(next.mainColumns||[]).length+((next.mainColumns||[]).length>5?' (показаны 5 первых)':'')+((next.mainColumns||[]).length===0?' (группа пуста)':''):'Нет сигнала В5 (макс. голосов '+next.maxVotes+(next.uniqueLeader?'':', ничья')+', нужно ≥4 и один лидер): пятёрка из запасного порядка')+'</p><div class="small">Голоса '+gn.join('/')+': '+next.votes.join('/')+'</div>';
  }
 }else h+='<p>Ожидающего прогноза нет. Сервер запишет следующий при обновлении архива.</p>';
 const done=recs.filter(r=>r.result&&r.result.source==='official'&&fiveOf(r)),s=stat(done,hitOf);
 h+='<details open><summary>📊 Проверка · '+s.h+' попаданий / '+s.n+' тиражей</summary><p>'+s.rate+' · 95% ДИ '+s.ci+' · случайный уровень 50% · избыток '+s.excess+' · z '+s.z+' · макс. серия промахов '+s.mx+'</p><p>Накоплено '+s.n+' из 800 тиражей. До 800 выводы предварительные.</p></details>';
 h+='<details><summary>📋 Архив</summary>';
 for(const r of recs.slice(-150).reverse()){const f=fiveOf(r);h+='<div style="border-bottom:1px solid #30435b;padding:8px 0"><b>№'+r.draw+' · '+esc(r.date)+' '+esc(r.time)+'</b><div>'+(r.result?'Официальный ст'+r.result.winner:'⏳ Ожидаем факт')+'</div>'+(f?'<div>'+f.cols.map(c=>(r.result&&Number(c)===Number(r.result.winner)?'✅ ст'+c:'ст'+c)).join(' · ')+' · '+(!r.result?'⏳':hitOf(r)?'ПОПАЛ':'❌ МИМО')+'</div>':'<div>прогноз не из пяти столбцов</div>')+'</div>'}
 h+='</details>';
 const sh=['B','V','G'].map(k=>{const t=stat(recs.filter(r=>r.result&&r.result.source==='official'&&r.five&&valid(r.five[k])),r=>r.result[k]);return 'вариант '+k+': '+t.h+'/'+t.n+' ('+t.rate+')'});
 const ct=stat(recs.filter(r=>r.result&&r.result.source==='official'&&valid(r.control)),r=>r.control.includes(r.result.winner));
 h+='<details><summary>🧪 Теневая проверка (это не прогноз)</summary><p>Эти пятёрки не показываются как прогноз. Они считаются только для независимой проверки после 800 тиражей.</p><p>'+sh.join(' · ')+' · контроль 1–5: '+ct.h+'/'+ct.n+' ('+ct.rate+')</p></details>';
 box.innerHTML=h;
 Array.from(box.querySelectorAll('details')).forEach((x,i)=>{if(i<sectionStates.length)x.open=sectionStates[i]});
}
async function refresh(){try{const r=await fetch('b5-journal.json?fresh='+Date.now(),{cache:'no-store'});if(!r.ok)throw Error(r.status);data=await r.json()}catch(e){console.warn('B5 journal',e)}render()}
function start(){for(const id of ['sprintBtn','marathonBtn']){const b=$(id);if(b)b.onclick=()=>{$('sprintMarathonPanel')?.classList.add('show');render()}}refresh();setInterval(refresh,60000)}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',start,{once:true});else start();
})();