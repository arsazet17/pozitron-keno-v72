'use strict';
(()=>{
const $=id=>document.getElementById(id);
const keys=['A','B','V','G'];
const esc=s=>String(s??'').replace(/[&<>]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;'}[c]));
let data=null;
function render(){
 const box=$('sprintMarathonResult');if(!box)return;
 if(!data){box.textContent='Серверный журнал В5 ещё не создан. Прогноз задним числом не формируется.';return}
 const records=data.records||[],next=records.filter(r=>!r.result).at(-1);
 let html='<h3>В5 Claude · эксперимент</h3><div class="small">Четыре независимых варианта по пять столбов. Объединять их нельзя.</div>';
 if(next){html+='<p>Следующий №'+next.draw+' · '+esc(next.date)+' '+esc(next.time)+'</p>';for(const k of keys)html+='<b>Вариант '+k+'</b><div style="display:grid;grid-template-columns:repeat(5,1fr);gap:4px;margin:7px 0 14px">'+next.five[k].map(c=>'<span style="border:1px solid #62dc99;border-radius:6px;text-align:center;padding:8px 0">ст'+c+'</span>').join('')+'</div>';html+='<p>'+(next.signal?'Сигнал '+esc(next.b5Group):'Нет сигнала В5; резервные пятёрки')+'</p>'}else html+='<p>Ожидающего прогноза нет. Сервер запишет следующий при обновлении.</p>';
 html+='<details open><summary>📊 Проверка · '+records.length+' прогнозов</summary>';
 for(const k of keys){const done=records.filter(r=>r.result&&r.result.source==='official'),hits=done.filter(r=>r.result[k]).length;html+='<p>Вариант '+k+': '+hits+'/'+done.length+' · '+(done.length?(100*hits/done.length).toFixed(1)+'%':'нет данных')+' · случайный уровень 50%</p>'}
 html+='<p>До 800 новых подряд тиражей выводы предварительные.</p></details><details><summary>📋 Архив</summary>';
 for(const r of records.slice(-150).reverse()){html+='<div style="border-bottom:1px solid #30435b;padding:8px 0"><b>№'+r.draw+' · '+esc(r.date)+' '+esc(r.time)+'</b><div>'+(r.result?'Официальный ст'+r.result.winner:'⏳ Ожидаем факт')+'</div>';for(const k of keys)html+='<div>'+k+': '+r.five[k].map(c=>'ст'+c).join(' · ')+' · '+(!r.result?'⏳':r.result[k]?'✅ ПОПАЛ':'❌ МИМО')+'</div>';html+='</div>'}
 html+='</details>';box.innerHTML=html;
}
async function refresh(){try{const r=await fetch('b5-journal.json?fresh='+Date.now(),{cache:'no-store'});if(!r.ok)throw Error(r.status);data=await r.json()}catch(e){console.warn('B5 journal',e)}render()}
function start(){for(const id of ['sprintBtn','marathonBtn']){const b=$(id);if(b)b.onclick=()=>{$('sprintMarathonPanel')?.classList.add('show');render()}}refresh();setInterval(refresh,60000)}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',start,{once:true});else start();
})();
