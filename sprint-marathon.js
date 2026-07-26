'use strict';
(() => {
  const $ = id => document.getElementById(id);
  const pad = n => String(n).padStart(2,'0');
  const colOf = n => n % 10 || 10;
  const clamp = (v,a,b) => Math.max(a,Math.min(b,v));
  const pct = v => `${Math.round(v*100)}%`;

  function safeAnalysis(d){ try{return typeof analysis==='function'?analysis(d):{}}catch(_){return{}} }
  function counts(d){const a=Array(11).fill(0);(d?.balls||[]).forEach(n=>a[colOf(n)]++);return a}
  function stateBeforeWinner(i){
    if(i<=0)return null;
    const w=Number(safeAnalysis(draws[i]).winner)||1;
    return Math.min(4,counts(draws[i-1])[w]||0);
  }
  function stateLabel(s){return s===4?'4+':String(s)}
  function sequence(end,len){const out=[];for(let i=Math.max(1,end-len+1);i<=end;i++){const s=stateBeforeWinner(i);if(s!==null)out.push(s)}return out}
  function hammingWeighted(a,b){
    const n=Math.min(a.length,b.length);let same=0,total=0;
    for(let i=0;i<n;i++){const w=i+1; total+=w; same+=w*(1-Math.min(1,Math.abs(a[a.length-n+i]-b[b.length-n+i])/4));}
    return total?same/total:0;
  }
  function classify(seq){
    if(seq.length<3)return 'недостаточно данных';
    let changes=0,up=0,down=0; const freq=Array(5).fill(0); seq.forEach(x=>freq[x]++);
    for(let i=1;i<seq.length;i++){if(seq[i]!==seq[i-1])changes++; if(seq[i]>seq[i-1])up++; if(seq[i]<seq[i-1])down++;}
    const max=Math.max(...freq), last=seq.at(-1), prev=seq.at(-2);
    if(changes===seq.length-1)return last===0?'постоянная смена · сброс в пустоту':'постоянная смена';
    if(max>=Math.ceil(seq.length*.6))return 'удержание режима '+stateLabel(freq.indexOf(max));
    if(up>=seq.length-2)return 'уплотнение';
    if(down>=seq.length-2)return 'разрежение';
    if(last===0&&prev>=2)return 'резкий сброс в пустоту';
    if(new Set(seq).size===2&&changes>=seq.length-2)return 'качели';
    return 'переменная смена';
  }
  function analogForecast(seq, minIndex, maxIndex){
    const support=Array(5).fill(0); let total=0, exact=0, near=0;
    for(let end=minIndex+seq.length-1;end<maxIndex;end++){
      const cand=sequence(end,seq.length); if(cand.length!==seq.length)continue;
      const sim=hammingWeighted(seq,cand); if(sim<0.62)continue;
      const next=stateBeforeWinner(end+1); if(next===null)continue;
      const w=sim**3; support[next]+=w; total+=w; if(sim===1)exact++; else near++;
    }
    const probs=support.map(x=>total?x/total:0); const order=[0,1,2,3,4].sort((a,b)=>probs[b]-probs[a]);
    return {support,total,probs,order,exact,near};
  }
  function currentColumnsForState(state){
    const c=counts(draws.at(-1)); const out=[]; for(let col=1;col<=10;col++)if(Math.min(4,c[col])===state)out.push(col); return out;
  }
  function numberScore(n,col,window){
    const last=draws.at(-1), set=new Set(last.balls||[]); let score=0; const reasons=[];
    if(colOf(n)!==col)return {score:-99,reasons};
    const recent=draws.slice(-window); const hits=recent.filter(d=>(d.balls||[]).includes(n)).length;
    if(set.has(n)){score+=1.6;reasons.push('повтор')}
    score+=hits/window*1.2; if(hits>=2)reasons.push(`частота ${hits}/${window}`);
    const has=x=>x>=1&&x<=80&&set.has(x);
    if(has(n-1)&&has(n+1)){score+=1.5;reasons.push('центр последовательности')}
    if(has(n-2)&&has(n+2)){score+=1.2;reasons.push('сходящаяся сборка')}
    if(has(n-10)&&has(n+10)){score+=1.5;reasons.push('вертикальный центр')}
    if(has(n-20)&&has(n+20)){score+=.8;reasons.push('вертикаль ±20')}
    if(has(n-1)||has(n+1)){score+=.35;reasons.push('соседство ±1')}
    if(has(n-2)||has(n+2)){score+=.25;reasons.push('соседство ±2')}
    if(has(n-10)||has(n+10)){score+=.35;reasons.push('вертикальная связь')}
    if(!set.has(n))score+=.15;
    return {score,reasons:[...new Set(reasons)]};
  }
  function rankColumns(pred, window){
    const c=counts(draws.at(-1)); const rows=[];
    for(let col=1;col<=10;col++){
      const st=Math.min(4,c[col]); const regime=pred.probs[st]||0; let shape=0; const reasons=[];
      const nums=(draws.at(-1).balls||[]).filter(n=>colOf(n)===col);
      if(st===0){shape+=.2;reasons.push('столб сейчас в пустоте')}
      if(st===1){shape+=.35;reasons.push('одиночный каркас')}
      if(st===2){shape+=.5;reasons.push('двойной каркас')}
      if(st===3){shape+=.45;reasons.push('тройной каркас')}
      if(nums.some(n=>nums.includes(n+10))) {shape+=.3;reasons.push('вертикальная связка')}
      const history=draws.slice(-window).map(d=>counts(d)[col]);
      const trend=history.at(-1)-(history[0]||0); if(trend>0){shape+=.2;reasons.push('набор плотности')}
      rows.push({col,state:st,score:regime*3+shape,reasons,regime});
    }
    return rows.sort((a,b)=>b.score-a.score||a.col-b.col);
  }
  function rankNumbers(cols,window,limit){
    const arr=[]; for(const col of cols){for(let n=col;n<=80;n+=10){const r=numberScore(n,col,window);arr.push({n,col,...r})}}
    return arr.sort((a,b)=>b.score-a.score||a.n-b.n).slice(0,limit);
  }
  function sprintModel(){
    const end=draws.length-1, seq=sequence(end,5), pred=analogForecast(seq,1,end-1), cols=rankColumns(pred,8).slice(0,3), nums=rankNumbers(cols.map(x=>x.col),8,6);
    return {name:'СПРИНТ',seq,pred,cols,nums,type:classify(seq),window:5};
  }
  function marathonModel(){
    const end=draws.length-1, seq=sequence(end,25), tail=seq.slice(-10), pred=analogForecast(tail,1,end-1), cols=rankColumns(pred,30).slice(0,4), nums=rankNumbers(cols.map(x=>x.col),30,8);
    const first=seq.slice(0,12), second=seq.slice(-12); const avg=a=>a.reduce((s,x)=>s+x,0)/Math.max(1,a.length);
    const delta=avg(second)-avg(first); let phase=Math.abs(delta)<.2?'ровная фаза':delta>0?'уплотнение длинного цикла':'разрежение длинного цикла';
    return {name:'МАРАФОН',seq,pred,cols,nums,type:`${classify(tail)} · ${phase}`,window:25};
  }
  function regimeBars(pred){return pred.order.map(s=>`<div class="sm-reg"><b>${stateLabel(s)}</b><span>${pct(pred.probs[s]||0)}</span></div>`).join('')}
  function modelHtml(m,icon){
    const changes=m.seq.slice(1).filter((x,i)=>x!==m.seq[i]).length;
    return `<div class="sm-card"><div class="sm-head">${icon} ${m.name}</div>
      <div class="sm-seq">${m.seq.map(stateLabel).join('→')}</div>
      <div class="small"><b>Цикл:</b> ${m.type} · смен ${changes}/${Math.max(1,m.seq.length-1)}</div>
      <div class="section"><span>Вероятное продолжение режима</span></div><div class="sm-regs">${regimeBars(m.pred)}</div>
      <div class="row small">Точных аналогов: ${m.pred.exact} · близких: ${m.pred.near}</div>
      <div class="section"><span>Подготовленные столбцы</span></div>
      ${m.cols.map((x,i)=>`<div class="sm-line"><b>${i+1}. ст${x.col}</b> · сейчас ${stateLabel(x.state)} · ${Math.round(x.score*100)} баллов<br><span class="small">${x.reasons.join(' · ')||'по режиму цепочки'}</span></div>`).join('')}
      <div class="section"><span>Комбинация чисел</span></div><div class="sm-balls">${m.nums.map(x=>`<div class="sm-ball"><b>${pad(x.n)}</b><small>ст${x.col}</small></div>`).join('')}</div>
      ${m.nums.slice(0,4).map(x=>`<div class="small sm-why"><b>${pad(x.n)}</b> — ${x.reasons.join(' · ')||'поддержка столбца'}</div>`).join('')}
    </div>`;
  }
  function agreementHtml(s,m){
    const sn=new Set(s.nums.map(x=>x.n)), mn=new Set(m.nums.map(x=>x.n)); const nums=[...sn].filter(n=>mn.has(n));
    const sc=new Set(s.cols.map(x=>x.col)), mc=new Set(m.cols.map(x=>x.col)); const cols=[...sc].filter(c=>mc.has(c));
    return `<div class="sm-agree"><b>Совпадение Спринта и Марафона</b><br>
      Столбцы: ${cols.length?cols.map(c=>'ст'+c).join(' · '):'нет общего сигнала'}<br>
      Числа: ${nums.length?nums.map(pad).join(' · '):'нет общего сигнала'}<br>
      <span class="small">При расхождении вывод считается экспериментальным.</span></div>`;
  }
  function render(which){
    const box=$('sprintMarathonResult'); if(!box)return;
    if(!Array.isArray(draws)||draws.length<60){box.innerHTML='<div class="row">Нужно не меньше 60 тиражей.</div>';return}
    box.innerHTML='<div class="row">⏳ Анализирую цепочки…</div>';
    setTimeout(()=>{
      const s=sprintModel(),m=marathonModel();
      box.innerHTML=which==='sprint'?modelHtml(s,'🏃'):which==='marathon'?modelHtml(m,'🐢'):modelHtml(s,'🏃')+modelHtml(m,'🐢')+agreementHtml(s,m);
    },20);
  }
  function inject(){
    if($('sprintMarathonPanel'))return;
    const info=document.querySelector('button[data-panel="infoPanel"]'); if(!info)return;
    const holder=document.createElement('div'); holder.className='sm-split'; holder.innerHTML='<button id="sprintBtn" class="tool" type="button" aria-label="Спринт">🏃</button><button id="marathonBtn" class="tool" type="button" aria-label="Марафон">🐢</button>';
    info.replaceWith(holder);
    const panel=document.createElement('section'); panel.id='sprintMarathonPanel';panel.className='card panel';panel.innerHTML='<div class="sm-title">🏃 Спринт / 🐢 Марафон</div><div id="sprintMarathonResult"></div>';
    const search=$('searchPanel'); search?.parentNode?.insertBefore(panel,search);
    const toggle=which=>{const open=!panel.classList.contains('show')||panel.dataset.which!==which;panel.classList.toggle('show',open);panel.dataset.which=open?which:'';if(open){render(which);panel.scrollIntoView({behavior:'smooth',block:'start'})}};
    $('sprintBtn').onclick=()=>toggle('sprint'); $('marathonBtn').onclick=()=>toggle('marathon');
  }
  function styles(){if($('sprintMarathonStyles'))return;const s=document.createElement('style');s.id='sprintMarathonStyles';s.textContent=`
    .sm-split{display:grid;grid-template-columns:1fr 1fr;gap:6px}.sm-split .tool{font-size:28px;padding:10px 4px;min-width:0}
    .sm-title,.sm-head{font-size:20px;font-weight:950}.sm-card{border:1px solid #2b4668;border-radius:14px;padding:12px;margin-top:10px;background:#0e1d30}
    .sm-seq{font-size:25px;font-weight:950;color:#83e6a5;letter-spacing:1px;overflow-wrap:anywhere;margin:8px 0}.sm-regs{display:grid;grid-template-columns:repeat(5,1fr);gap:5px}.sm-reg{border:1px solid #355275;border-radius:9px;padding:7px 3px;text-align:center}.sm-reg b,.sm-reg span{display:block}.sm-reg span{color:#ffd764;font-weight:900}.sm-line{border-bottom:1px solid #263c58;padding:8px 2px}.sm-balls{display:grid;grid-template-columns:repeat(4,1fr);gap:7px}.sm-ball{border:1px solid #466b48;background:#122c25;border-radius:10px;text-align:center;padding:8px}.sm-ball b{display:block;font-size:24px;color:#8eedaa}.sm-ball small{color:#9fb0c6}.sm-why{margin-top:5px}.sm-agree{margin-top:12px;border:1px solid #6a6036;background:#2b2712;border-radius:12px;padding:11px;color:#ffe18b}
    @media(max-width:420px){.sm-regs{grid-template-columns:repeat(5,1fr)}.sm-reg{font-size:12px}.sm-balls{grid-template-columns:repeat(3,1fr)}}`;
    document.head.appendChild(s)}
  function start(){styles();inject()}
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',start,{once:true});else start();
})();
