'use strict';
const fs=require('fs');

let h=fs.readFileSync('index.html','utf8');

function money(v){return Number(v||0).toLocaleString('ru-RU')+' ₽'}

// ---------- VERSION v7.2.2 ----------
h=h.replace(/<title>ПОЗИТРОН КЕНО v7\.2(?:\.\d+)?<\/title>/,'<title>ПОЗИТРОН КЕНО v7.2.2</title>');

if(/<div class="brand">🎯 ПОЗИТРОН КЕНО v7\.2(?:\.\d+)?<\/div>/.test(h)){
  h=h.replace(
    /<div class="brand">🎯 ПОЗИТРОН КЕНО v7\.2(?:\.\d+)?<\/div>/,
    '<div class="brand">🎯 ПОЗИТРОН КЕНО</div>\n      <span id="appVersionBadge" class="version-badge">v7.2.2</span>'
  );
} else {
  h=h.replace(
    /(<div class="brand">🎯 ПОЗИТРОН КЕНО<\/div>)\s*(?:<span[^>]*id="appVersionBadge"[^>]*>[^<]*<\/span>)?/,
    '$1\n      <span id="appVersionBadge" class="version-badge">v7.2.2</span>'
  );
}

h=h.replace(/\s*<div class="sub">сборка <span id="appBuildBadge">[^<]*<\/span><\/div>\s*/i,'\n');
h=h.replace(/(<span[^>]*id="appVersionBadge"[^>]*>)[^<]*(<\/span>)/i,'$1v7.2.2$2');
h=h.replace(/v7\.2(?:\.\d+)? · AI переходов и ретропоиск/g,'v7.2.2 · AI переходов и ретропоиск');
h=h.replace(/<b>v7\.2(?:\.\d+)?:<\/b>/g,'<b>v7.2.2:</b>');
h=h.replace(/Версия v7\.2(?:\.\d+)?:/g,'Версия v7.2.2:');

// Version badge CSS.
if(!h.includes('.version-badge{')){
  h=h.replace('</style>',`
.version-badge{
 display:inline-flex;align-items:center;justify-content:center;
 margin-top:5px;padding:3px 8px;border-radius:999px;
 border:1px solid rgba(99,169,255,.38);
 background:rgba(99,169,255,.08);color:#8fc3ff;
 font-size:11px;line-height:1.2;font-weight:950;letter-spacing:.04em
}
</style>`);
}

// ---------- PAYOUT TABLE ----------
// Remove older injected payout constant if any.
h=h.replace(/const KENO_PAYOUTS_V1=\{[\s\S]*?\};\nfunction kenoPrize[\s\S]*?\n\}\n/,'');
const payoutBlock=`const KENO_PAYOUTS_V1={"version":"1.0.0","currency":"RUB","source":"Таблица выигрышей КЕНО — скриншоты пользователя 16.08.2026","combination":{"10":{"0":200,"4":100,"5":250,"6":750,"7":5000,"8":50000,"9":1000000,"10":10000000},"9":{"0":150,"4":150,"5":300,"6":1000,"7":10000,"8":210000,"9":4000000},"8":{"0":150,"4":200,"5":500,"6":2500,"7":53300,"8":1500000},"7":{"0":150,"3":100,"4":200,"5":1200,"6":10000,"7":250000},"6":{"3":200,"4":750,"5":4180,"6":75000},"5":{"3":400,"4":1920,"5":20000},"4":{"2":100,"3":300,"4":3300},"3":{"2":300,"3":1500},"2":{"1":100,"2":300},"1":{"1":280}},"extraBets":{"parity":{"moreEven":170,"moreOdd":170,"equal":340},"column":{"payout":700,"rule":"В выбранном столбце больше чисел из выигрышной комбинации, чем в других"}}};
function kenoPrize(size,hits){
 return Number(KENO_PAYOUTS_V1?.combination?.[String(size)]?.[String(hits)]||0);
}
`;
const anchor='const analysisCache=new WeakMap();';
if(!h.includes(anchor))throw new Error('analysisCache anchor not found');
h=h.replace(anchor,anchor+'\n'+payoutBlock);

// ---------- ARCHIVE CSS ----------
const archiveCss=`
.analog-history-head{
 display:grid;grid-template-columns:1.15fr 1.05fr .72fr .58fr .52fr 18px;
 gap:6px;align-items:center;padding:3px 8px 8px;
 color:#7895a8;font-size:8px;font-weight:900;letter-spacing:.07em
}
.analog-history-list{display:grid;gap:7px}
.analog-history-item{
 border:1px solid #29415f;border-radius:14px;background:#091726;overflow:hidden;
 box-shadow:0 5px 16px rgba(0,0,0,.13)
}
.analog-history-item summary{
 list-style:none;display:grid;
 grid-template-columns:1.15fr 1.05fr .72fr .58fr .52fr 18px;
 gap:6px;align-items:center;padding:11px 8px;cursor:pointer
}
.analog-history-item summary::-webkit-details-marker{display:none}
.ah-draw{font-size:11px;font-weight:950;color:#63a9ff}
.ah-date,.ah-time,.ah-column{font-size:11px;font-weight:850}
.ah-date{color:#cfe1eb}.ah-time{color:#fff}.ah-column{color:#ffd35c;text-align:center}
.ah-result{font-size:16px;line-height:1;text-align:center;color:#ffd35c;white-space:nowrap}
.analog-history-item.is-no-prize .ah-result{color:#607889}
.ah-chevron{font-size:14px;color:#94b2c2;text-align:center;transition:transform .18s ease}
.analog-history-item[open] .ah-chevron{transform:rotate(180deg)}
.ah-body{padding:4px 10px 12px;border-top:1px solid rgba(55,126,161,.16)}
.ah-topline{display:grid;grid-template-columns:1fr auto;gap:8px;align-items:center;padding:9px 0 3px}
.ah-factbox{font-size:12px;color:#91a8ba}.ah-factbox b{color:#ffd35c;font-size:14px}
.ah-total-prize{
 display:inline-flex;align-items:center;justify-content:center;
 padding:6px 9px;border-radius:999px;border:1px solid #7b5a17;
 background:#2b220d;color:#ffd35c;font-size:12px;font-weight:950
}
.ah-total-prize.none{border-color:#29415f;background:#101f33;color:#7f96aa}
.ah-label{margin-top:9px;font-size:10px;color:#8097aa;font-weight:900;text-transform:uppercase;letter-spacing:.06em}
.ah-colchips{display:flex;flex-wrap:wrap;gap:6px;margin-top:6px}
.ah-colchip{
 display:inline-flex;align-items:center;justify-content:center;min-width:54px;
 padding:7px 9px;border-radius:10px;border:1px solid #355273;
 background:#152a43;color:#dcecff;font-size:12px;font-weight:950
}
.ah-colchip.hit{border-color:#43d77b;background:#123a28;color:#c9ffda}
.ah-krow{
 margin-top:9px;padding:9px;border:1px solid #304b6d;background:#101f33;border-radius:12px
}
.ah-khead{display:flex;justify-content:space-between;gap:8px;align-items:center;margin-bottom:8px}
.ah-kname{font-size:12px;font-weight:950;color:#e7f2ff}
.ah-kright{display:flex;align-items:center;gap:7px}
.ah-khits{
 padding:3px 7px;border-radius:999px;background:#172a43;border:1px solid #304b6d;
 font-size:11px;font-weight:900;color:#b8c9d9
}
.ah-prize{
 padding:4px 7px;border-radius:999px;border:1px solid #7b5a17;
 background:#2b220d;color:#ffd35c;font-size:11px;font-weight:950;white-space:nowrap
}
.ah-prize.none{border-color:#304b6d;background:#172a43;color:#667e92}
.ah-balls{display:grid;grid-template-columns:repeat(5,minmax(0,1fr));gap:5px}
.ah-ball{
 min-width:0;text-align:center;border:1px solid #304b6d;background:#172a43;
 border-radius:9px;padding:8px 2px;font-family:ui-monospace,Consolas,monospace;
 font-weight:950;font-size:13px;color:#eaf4ff
}
.ah-ball.hit{
 border-color:#43d77b;background:linear-gradient(180deg,#1b6139,#123a28);
 color:#d8ffe5;box-shadow:inset 0 0 0 1px rgba(114,223,149,.35)
}
.ah-resultline{
 margin-top:9px;padding:8px 9px;border:1px solid #263e5b;background:#0d1d30;
 border-radius:10px;font-size:12px;line-height:1.45
}
.ah-win{color:#72df95;font-weight:950}.ah-miss{color:#ff9ca4;font-weight:900}
`;

let cssStart=-1;
for(const marker of ['.analog-history-head{','.ap-archive-card{']){
  const i=h.indexOf(marker);
  if(i>=0 && (cssStart<0||i<cssStart))cssStart=i;
}
if(cssStart>=0){
  const cssEnd=h.indexOf('\n</style>',cssStart);
  if(cssEnd<0)throw new Error('style end not found');
  h=h.slice(0,cssStart)+archiveCss+h.slice(cssEnd);
} else {
  h=h.replace('</style>',archiveCss+'\n</style>');
}

// ---------- ARCHIVE RENDER ----------
const start=h.indexOf('function analogArchiveStatus(rec){');
const end=h.indexOf('\nfunction runAnalogsPlus(){',start);
if(start<0||end<0)throw new Error('Analog archive renderer not found');

const renderer=`function analogArchiveStatus(rec){
 const actual=draws.find(d=>Number(d.draw)===Number(rec.targetDraw));
 if(!actual)return {
  actual:null,winner:null,rank:0,k1Hits:null,k2Hits:null,k1Prize:0,k2Prize:0,totalPrize:0,
  prizeCount:0,status:'⏳'
 };
 const set=new Set(actual.balls||[]);
 const winner=analysis(actual).winner;
 const rank=Array.isArray(rec.columns)?rec.columns.map(Number).indexOf(Number(winner))+1:0;
 const k1Hits=Array.isArray(rec.k1)?rec.k1.filter(n=>set.has(Number(n))).length:0;
 const k2Hits=Array.isArray(rec.k2)?rec.k2.filter(n=>set.has(Number(n))).length:0;
 const k1Prize=kenoPrize(5,k1Hits),k2Prize=kenoPrize(5,k2Hits);
 const totalPrize=k1Prize+k2Prize;
 const prizeCount=(k1Prize>0?1:0)+(k2Prize>0?1:0);
 return {
  actual,winner,rank,k1Hits,k2Hits,k1Prize,k2Prize,totalPrize,prizeCount,
  status:prizeCount===2?'🔥🔥':prizeCount===1?'🔥':'—'
 };
}
function analogArchiveBalls(values,actual){
 const set=actual?new Set(actual.balls||[]):new Set();
 return (Array.isArray(values)?values:[]).map(n=>{
  const hit=set.has(Number(n));
  return '<span class="ah-ball '+(hit?'hit':'')+'">'+pad(n)+'</span>';
 }).join('');
}
function analogPrizeBadge(prize){
 return prize>0
  ? '<span class="ah-prize">🔥 '+money(prize)+'</span>'
  : '<span class="ah-prize none">—</span>';
}
function renderPredictionHistory(){
 const box=$('predictionHistory');if(!box)return;
 const opened=new Set([...box.querySelectorAll('details.analog-history-item[open]')].map(x=>x.dataset.key).filter(Boolean));
 const predictions=loadPlusPredictions().slice().sort((a,b)=>Number(b.targetDraw)-Number(a.targetDraw));
 if(!predictions.length){box.innerHTML='<div class="row small">Сохранённых frozen-прогнозов пока нет.</div>';return}

 const rows=predictions.map(rec=>{
  const s=analogArchiveStatus(rec),d=s.actual;
  const date=d?showDate(d.date):'—',time=d?normTime(d.time):'—';
  const cols=Array.isArray(rec.columns)?rec.columns.map(Number):[];
  const colResult=s.actual
   ? (s.rank?'<span class="ah-win">ст'+s.winner+' · '+s.rank+'-е место ✅</span>'
            :'<span class="ah-miss">ст'+s.winner+' · мимо</span>')
   :'<span class="small">ожидаем факт</span>';

  const colChips=cols.length
   ? cols.map((c,i)=>'<span class="ah-colchip '+(s.actual&&Number(c)===Number(s.winner)?'hit':'')+'">'+(i+1)+'. ст'+c+'</span>').join('')
   :'—';

  const totalPrize=s.totalPrize>0
   ? '<span class="ah-total-prize">🔥 '+money(s.totalPrize)+'</span>'
   : '<span class="ah-total-prize none">выигрыша нет</span>';

  return '<details class="analog-history-item '+(s.totalPrize>0?'is-prize':'is-no-prize')+'" data-key="'+rec.targetDraw+'">'+
    '<summary>'+
      '<span class="ah-draw">№'+rec.targetDraw+'</span>'+
      '<span class="ah-date">'+date+'</span>'+
      '<span class="ah-time">'+time+'</span>'+
      '<span class="ah-column">'+(s.actual?'ст'+s.winner:'—')+'</span>'+
      '<span class="ah-result">'+s.status+'</span>'+
      '<span class="ah-chevron">▾</span>'+
    '</summary>'+
    '<div class="ah-body">'+
      '<div class="ah-topline">'+
        '<div class="ah-factbox">Факт: <b>'+(s.actual?'ст'+s.winner:'—')+'</b></div>'+
        totalPrize+
      '</div>'+
      '<div class="ah-label">Прогноз столбов</div>'+
      '<div class="ah-colchips">'+colChips+'</div>'+
      '<div class="ah-resultline">Результат столба: '+colResult+'</div>'+
      '<div class="ah-krow">'+
        '<div class="ah-khead"><span class="ah-kname">К5 №1</span><span class="ah-kright"><span class="ah-khits">'+(s.actual?s.k1Hits+'/5':'—')+'</span>'+analogPrizeBadge(s.k1Prize)+'</span></div>'+
        '<div class="ah-balls">'+analogArchiveBalls(rec.k1,s.actual)+'</div>'+
      '</div>'+
      '<div class="ah-krow">'+
        '<div class="ah-khead"><span class="ah-kname">К5 №2</span><span class="ah-kright"><span class="ah-khits">'+(s.actual?s.k2Hits+'/5':'—')+'</span>'+analogPrizeBadge(s.k2Prize)+'</span></div>'+
        '<div class="ah-balls">'+analogArchiveBalls(rec.k2,s.actual)+'</div>'+
      '</div>'+
    '</div>'+
  '</details>';
 }).join('');

 box.innerHTML='<div class="analog-history-head"><span>ТИРАЖ</span><span>ДАТА</span><span>ВРЕМЯ</span><span>СТОЛБ</span><span>ИТОГ</span><span></span></div>'+
  '<div class="analog-history-list">'+rows+'</div>';

 for(const d of box.querySelectorAll('details.analog-history-item'))if(opened.has(d.dataset.key))d.open=true;
}`;

h=h.slice(0,start)+renderer+h.slice(end);

// Render status semantic version.
h=h.replace(/`v7\.2(?:\.\d+)? · база:/g,'`v7.2.2 · база:');
h=h.replace(/'Версия v7\.2(?:\.\d+)? · база: 0'/g,"'Версия v7.2.2 · база: 0'");

// Ensure app-version file is the visible semantic version source.
fs.writeFileSync('app-version.json',JSON.stringify({version:'7.2.2'},null,2)+'\n','utf8');

fs.writeFileSync('index.html',h,'utf8');
console.log('PASS v7.2.2 payout archive UI');
