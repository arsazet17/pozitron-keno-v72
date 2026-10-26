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
const line=(name,s)=>name+': '+s.h+'/'+s.n+' · '+s.rate+' · 95% ДИ '+s.ci+' · избыток над 50%: '+s.excess+' · z '+s.z+' · макс. серия промахов '+s.mx;
// Группа В5: ожидание считается по размеру группы (столбцов в группе / 10), а не по 50%.
function groupStat(recs){const g=recs.filter(r=>r.signal===true&&(r.mainColumns||[]).length>0&&r.result&&typeof r.result.group==='boolean');let e=0,v=0,h=0;g.forEach(r=>{const p=r.mainColumns.length/10;e+=p;v+=p*(1-p);if(r.result.group)h++});return{n:g.length,h,e:e.toFixed(1),z:v>0?((h-e)/Math.sqrt(v)).toFixed(2):'—',empty:recs.filter(r=>r.signal===true&&(r.mainColumns||[]).length===0).length}}
function signature(d){const r=(d&&d.records)||[],last=r.at(-1);return [d&&d.updatedAt,r.length,last&&last.draw,r.filter(x=>x.result).length,(d&&d.gaps||[]).length].join('|')}
function render(force){
 const box=$('sprintMarathonResult');if(!box)return;
 const sig=data?signature(data):'none';
 if(!force&&box.dataset.sig===sig)return; // данных не прибавилось: экран не перерисовываем (без дёргания и без сворачивания)
 const first=box.dataset.sig===undefined;
 const opened=new Set(Array.from(box.querySelectorAll('details'),x=>x.open?x.dataset.key:null).filter(Boolean));
 const scrollY=typeof window!=='undefined'?window.scrollY:0;
 if(!data){box.textContent='Серверный журнал В5 ещё не создан. Прогноз задним числом не формируется.';box.dataset.sig=sig;return}
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
 const official=recs.filter(r=>r.result&&r.result.source==='official'),done=official.filter(r=>fiveOf(r)),bad=official.length-done.length;
 const withSig=done.filter(r=>r.signal===true),noSig=done.filter(r=>r.signal!==true),all=stat(done,hitOf),gs=groupStat(done);
 h+='<details data-key="stats"><summary>📊 Проверка · '+all.h+' попаданий / '+all.n+' тиражей</summary>'+
  '<p>'+line('Все тиражи',all)+'</p>'+
  '<p>'+line('С сигналом В5',stat(withSig,hitOf))+'</p>'+
  '<p>Группа В5 (ожидание по размеру группы): '+gs.h+'/'+gs.n+' · ожидалось '+gs.e+' · z '+gs.z+(gs.empty?' · пустых групп '+gs.empty:'')+'</p>'+
  '<p>'+line('Без сигнала',stat(noSig,hitOf))+'</p>'+
  '<div class="small">Без сигнала прогноз берётся из запасного порядка (чаще всего 1–2–3–4–5), это не оценка В5. Накоплено '+all.n+' из 800 тиражей, до 800 выводы предварительные.'+(bad?' Исключено записей с некорректной пятёркой: '+bad+'.':'')+((data.gaps||[]).length?' Пропущенных прогнозов: '+data.gaps.length+'.':'')+'</div></details>';
 h+='<details data-key="archive"><summary>📋 Архив</summary>';
 for(const r of recs.slice(-150).reverse()){const f=fiveOf(r);h+='<div style="border-bottom:1px solid #30435b;padding:8px 0"><b>№'+r.draw+' · '+esc(r.date)+' '+esc(r.time)+'</b> <span class="small">'+(r.signal===true?'сигнал '+esc(r.b5Group):'без сигнала')+'</span><div>'+(r.result?'Официальный ст'+r.result.winner:'⏳ Ожидаем факт')+'</div>'+(f?'<div>'+f.cols.map(c=>(r.result&&Number(c)===Number(r.result.winner)?'✅ ст'+c:'ст'+c)).join(' · ')+' · '+(!r.result?'⏳':hitOf(r)?'ПОПАЛ':'❌ МИМО')+'</div>':'<div>прогноз не из пяти столбцов</div>')+'</div>'}
 h+='</details>';
 const sh=['B','V','G'].map(k=>{const t=stat(done.filter(r=>r.five&&valid(r.five[k])),r=>r.result[k]);return 'вариант '+k+': '+t.h+'/'+t.n+' ('+t.rate+')'});
 const ct=stat(official.filter(r=>valid(r.control)),r=>r.control.includes(r.result.winner));
 h+='<details data-key="shadow"><summary>🧪 Теневая проверка (это не прогноз)</summary><p>Эти пятёрки не показываются как прогноз. Они считаются только для независимой проверки после 800 тиражей.</p><p>'+sh.join(' · ')+'</p><p>Контрольная пятёрка 1–5: '+ct.h+'/'+ct.n+' ('+ct.rate+'). Это не доказательство эффективности В5: без сигнала основной прогноз совпадает с контролем.</p></details>';
 box.innerHTML=h;box.dataset.sig=sig;
 Array.from(box.querySelectorAll('details')).forEach(x=>{x.open=first?x.dataset.key==='stats':opened.has(x.dataset.key)});
 if(typeof window!=='undefined'&&Math.abs(window.scrollY-scrollY)>1)window.scrollTo(0,scrollY);
}
/* v7.2.9: журнал В5 (1,6 МБ) скачивается только когда панель Спринт/Марафон открыта, а не каждую минуту в фоне. */
let loading=false,lastLoad=0;
function panelOpen(){const p=$('sprintMarathonPanel');return !!p&&p.classList.contains('show')}
async function refresh(){if(loading)return;loading=true;lastLoad=Date.now();try{const r=await fetch('b5-journal.json?fresh='+Date.now(),{cache:'no-store'});if(!r.ok)throw Error(r.status);data=await r.json()}catch(e){console.warn('B5 journal',e)}finally{loading=false}render()}
function tick(){if(panelOpen()&&!document.hidden&&Date.now()-lastLoad>=60000)refresh()}
function start(){
 document.addEventListener('click',e=>{if(e.target.closest('#sprintBtn, #marathonBtn'))setTimeout(()=>{if(panelOpen()&&(!data||Date.now()-lastLoad>=60000))refresh()},0)});
 document.addEventListener('visibilitychange',tick);
 setInterval(tick,15000);
}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',start,{once:true});else start();
})();