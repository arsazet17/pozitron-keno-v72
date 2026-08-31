'use strict';

const fs = require('fs');

const INDEX = 'index.html';
let h = fs.readFileSync(INDEX, 'utf8');

function ensureAfter(needle, insert, label) {
  if (h.includes(insert.trim().slice(0, 40))) return;
  const i = h.indexOf(needle);
  if (i < 0) throw new Error('Не найден фрагмент: ' + label);
  h = h.slice(0, i + needle.length) + insert + h.slice(i + needle.length);
}

// CSS архива — в стиле карточек результата.
if (!h.includes('.ap-archive-card{')) {
  const css = `
.ap-archive-card{margin-top:10px;border:1px solid #2a4464;border-radius:14px;background:#0b1727;overflow:hidden}
.ap-archive-head{width:100%;border:0;background:#12243a;color:#f4f8ff;padding:12px 13px;display:flex;justify-content:space-between;gap:10px;align-items:center;text-align:left;font:inherit;cursor:pointer}
.ap-archive-head:active{background:#182c46}
.ap-archive-head-main{min-width:0}
.ap-archive-title{font-size:16px;font-weight:950}
.ap-archive-sub{font-size:11px;color:#96a9c1;margin-top:3px}
.ap-archive-status{font-size:13px;font-weight:950;white-space:nowrap}
.ap-archive-body{padding:12px;border-top:1px solid #2a4464}
.ap-archive-body[hidden]{display:none!important}
.ap-section-title{margin:10px 0 7px;font-size:14px;font-weight:950}
.ap-cols{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:6px}
.ap-col{border:1px solid #355273;background:#152a43;border-radius:10px;padding:9px 3px;text-align:center;font-weight:950;color:#ffd35c}
.ap-krow{border:1px solid #304b6d;background:#101f33;border-radius:12px;padding:10px;margin-top:8px}
.ap-khead{display:flex;justify-content:space-between;gap:8px;align-items:center;font-weight:950;margin-bottom:8px}
.ap-balls{display:flex;flex-wrap:wrap;gap:6px}
.ap-ball{min-width:46px;text-align:center;border:1px solid #304b6d;background:#172a43;border-radius:9px;padding:8px 7px;font-family:ui-monospace,Consolas,monospace;font-weight:950}
.ap-ball.hit{border-color:#43d77b;background:#123a28;color:#c9ffda;box-shadow:inset 0 0 0 1px #43d77b}
.ap-fact{margin-top:9px;padding:9px;border-radius:10px;background:#101f33;border:1px solid #263e5b;font-size:13px;line-height:1.45}
.ap-good{color:#72df95;font-weight:950}
.ap-bad{color:#ff8f98;font-weight:950}
`;
  h = h.replace('</style>', css + '\n</style>');
}

// Заголовок верхнего блока — без "5 тир".
h = h.replace(/📋 Прогнозы 5 тир [▶▼]/g, '📋 Архив прогнозов ▶');
h = h.replace(/📋 История прогнозов по 5 тиражей/g, '📋 Архив прогнозов');

// Полностью заменяем renderPredictionHistory() на архив ВСЕХ сохранённых прогнозов.
const start = h.indexOf('function renderPredictionHistory(){');
const end = h.indexOf('\nfunction runAnalogsPlus(){', start);
if (start < 0 || end < 0) {
  throw new Error('Не найден renderPredictionHistory');
}

const replacement = `function analogArchiveStatus(rec){
 const actual=draws.find(d=>Number(d.draw)===Number(rec.targetDraw));
 if(!actual){
   return {actual:null,winner:null,rank:0,k1Hits:null,k2Hits:null,text:'⏳ ожидает',cls:'pred-none'};
 }
 const set=new Set(actual.balls||[]);
 const winner=analysis(actual).winner;
 const rank=Array.isArray(rec.columns)?rec.columns.map(Number).indexOf(Number(winner))+1:0;
 const k1Hits=Array.isArray(rec.k1)?rec.k1.filter(n=>set.has(Number(n))).length:0;
 const k2Hits=Array.isArray(rec.k2)?rec.k2.filter(n=>set.has(Number(n))).length:0;
 if(rank===1)return {actual,winner,rank,k1Hits,k2Hits,text:'✅ 1-е место',cls:'pred-first'};
 if(rank>=2&&rank<=4)return {actual,winner,rank,k1Hits,k2Hits,text:'☑️ '+rank+'-е место',cls:'pred-top4'};
 return {actual,winner,rank:0,k1Hits,k2Hits,text:'❌ мимо',cls:'pred-miss'};
}

function analogArchiveBalls(values,actual){
 const set=actual?new Set(actual.balls||[]):new Set();
 return (Array.isArray(values)?values:[]).map(n=>{
   const hit=set.has(Number(n));
   return '<span class="ap-ball '+(hit?'hit':'')+'">'+pad(n)+(hit?' ✓':'')+'</span>';
 }).join('');
}

function renderPredictionHistory(){
 const box=$('predictionHistory');if(!box)return;
 const predictions=loadPlusPredictions()
   .slice()
   .sort((a,b)=>Number(b.targetDraw)-Number(a.targetDraw));

 if(!predictions.length){
   box.innerHTML='<div class="row small">Сохранённых frozen-прогнозов пока нет.</div>';
   return;
 }

 const cards=predictions.map((rec,i)=>{
   const s=analogArchiveStatus(rec);
   const d=s.actual;
   const dt=d?(showDate(d.date)+' · '+normTime(d.time)):'ожидаем результат';
   const bodyId='analogArchiveBody'+i;
   const cols=Array.isArray(rec.columns)&&rec.columns.length
     ? rec.columns.map((c,idx)=>'<div class="ap-col">'+(idx+1)+'. ст'+c+'</div>').join('')
     : '<div class="small">Нет сохранённых столбов</div>';

   const fact=s.actual
     ? (s.rank
       ? '<span class="ap-good">Факт: ст'+s.winner+' · '+s.rank+'-е место прогноза</span>'
       : '<span class="ap-bad">Факт: ст'+s.winner+' · мимо прогнозной четвёрки</span>')
     : '<span class="small">Факт ещё не вышел.</span>';

   const k1Title=s.actual?'К5 №1 · '+s.k1Hits+'/5':'К5 №1';
   const k2Title=s.actual?'К5 №2 · '+s.k2Hits+'/5':'К5 №2';

   return '<div class="ap-archive-card">'+
     '<button type="button" class="ap-archive-head" data-ap-archive="'+bodyId+'" aria-expanded="false">'+
       '<div class="ap-archive-head-main">'+
         '<div class="ap-archive-title">№'+rec.targetDraw+'</div>'+
         '<div class="ap-archive-sub">'+dt+' · frozen после №'+rec.sourceDraw+'</div>'+
       '</div>'+
       '<div class="ap-archive-status '+s.cls+'">'+s.text+' ▶</div>'+
     '</button>'+
     '<div class="ap-archive-body" id="'+bodyId+'" hidden>'+
       '<div class="ap-section-title">Прогноз столбов</div>'+
       '<div class="ap-cols">'+cols+'</div>'+
       '<div class="ap-krow">'+
         '<div class="ap-khead"><span>'+k1Title+'</span></div>'+
         '<div class="ap-balls">'+analogArchiveBalls(rec.k1,s.actual)+'</div>'+
       '</div>'+
       '<div class="ap-krow">'+
         '<div class="ap-khead"><span>'+k2Title+'</span></div>'+
         '<div class="ap-balls">'+analogArchiveBalls(rec.k2,s.actual)+'</div>'+
       '</div>'+
       '<div class="ap-fact">'+fact+'</div>'+
     '</div>'+
   '</div>';
 }).join('');

 box.innerHTML='<div class="section"><span>📋 Архив всех frozen-прогнозов</span></div>'+
   '<div class="row small">Каждый прогноз хранится отдельно: 4 столба · К5 №1 · К5 №2 · после выхода — факт и попадания. Нажмите запись, чтобы открыть или закрыть.</div>'+
   cards;

 box.querySelectorAll('[data-ap-archive]').forEach(btn=>{
   btn.onclick=()=>{
     const body=document.getElementById(btn.dataset.apArchive);
     if(!body)return;
     const open=body.hidden;
     body.hidden=!open;
     btn.setAttribute('aria-expanded',String(open));
     const status=btn.querySelector('.ap-archive-status');
     if(status){
       const base=status.textContent.replace(/[▶▼]$/,'').trim();
       status.textContent=base+' '+(open?'▼':'▶');
     }
   };
 });
}`;

h = h.slice(0, start) + replacement + h.slice(end);

// Верхний toggle должен менять стрелку и не возвращать старое название.
const oldToggle = `forecastHistoryToggle.textContent=isOpen?'📋 Прогнозы 5 тир ▶':'📋 Прогнозы 5 тир ▼';`;
if (h.includes(oldToggle)) {
  h = h.replace(
    oldToggle,
    `forecastHistoryToggle.textContent=isOpen?'📋 Архив прогнозов ▶':'📋 Архив прогнозов ▼';`
  );
}
const oldToggle2 = `forecastHistoryToggle.textContent=isOpen?'📋 Архив прогнозов ▶':'📋 Архив прогнозов ▼';`;
if (!h.includes(oldToggle2)) {
  // На случай другой формулировки — точечно заменяем строку присваивания.
  h = h.replace(
    /forecastHistoryToggle\.textContent=isOpen\?[^;]+;/,
    `forecastHistoryToggle.textContent=isOpen?'📋 Архив прогнозов ▶':'📋 Архив прогнозов ▼';`
  );
}

fs.writeFileSync(INDEX, h, 'utf8');
console.log('PASS: full Analog+ archive installed');
