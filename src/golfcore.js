/* =====================================================================
   Golf core — shared by the hub and the public scoring page.
   Walnut Creek CC course data transcribed from the Oak and Pecan scorecards
   (every nine and total checked against the printed card).
   ===================================================================== */
const WCCC_COURSES=[
  {id:'oak',name:'Oak Course',
   par:{M:[5,4,5,3,4,3,4,4,4, 4,3,5,4,3,4,4,4,4], W:[5,4,5,3,4,3,4,4,5, 4,3,5,4,3,4,4,4,4]},
   hcp:{M:[17,1,9,13,11,15,5,7,3, 6,18,16,12,14,8,2,10,4], W:[17,3,9,15,1,11,7,5,13, 6,14,16,4,18,12,2,8,10]},
   tees:[{name:'Gold',rating:{M:{cr:73.8,slope:138},W:{cr:80.6,slope:152}},yards:[525,379,523,174,462,142,398,428,439, 375,138,546,339,180,411,433,408,453]},
         {name:'Blue',rating:{M:{cr:71.5,slope:131},W:{cr:78.0,slope:144}},yards:[468,369,506,155,431,133,373,369,406, 363,138,464,327,168,391,394,374,444]},
         {name:'Blue/White',rating:{M:{cr:70.3,slope:129},W:{cr:76.3,slope:142}},yards:[468,369,506,155,402,133,373,369,371, 328,138,464,327,168,332,356,374,385]},
         {name:'White',rating:{M:{cr:68.3,slope:127},W:{cr:74.2,slope:138}},yards:[402,339,482,140,402,121,321,330,371, 328,124,440,315,153,332,356,347,385]},
         {name:'White/Red',rating:{M:{cr:67.2,slope:123},W:{cr:72.5,slope:131}},yards:null,total:[2737,2621]},
         {name:'Red',rating:{M:{cr:64.8,slope:113},W:{cr:69.7,slope:120}},yards:[347,297,381,109,327,104,267,294,371, 251,122,386,245,98,285,336,320,325]}]},
  {id:'pecan',name:'Pecan Course',
   par:{M:[5,4,4,3,4,4,4,3,4, 4,4,4,3,4,4,3,4,5], W:[5,4,4,3,4,4,4,3,4, 4,5,4,3,4,4,3,4,5]},
   hcp:{M:[17,15,1,9,5,13,7,11,3, 12,2,14,10,4,8,16,6,18], W:[9,7,1,17,5,13,11,15,3, 6,14,10,16,2,8,12,4,18]},
   tees:[{name:'Gold',rating:{M:{cr:73.1,slope:133},W:{cr:80.4,slope:146}},yards:[457,391,434,153,373,339,381,200,404, 432,446,366,213,445,450,191,412,531]},
         {name:'Blue',rating:{M:{cr:71.3,slope:132},W:{cr:78.2,slope:142}},yards:[448,367,415,141,352,318,375,169,388, 414,437,346,197,418,402,186,398,496]},
         {name:'Blue/White',rating:{M:{cr:70.3,slope:131},W:{cr:77.0,slope:141}},yards:[448,367,380,141,352,318,356,169,355, 394,428,346,182,365,391,186,374,496]},
         {name:'White',rating:{M:{cr:69.5,slope:127},W:{cr:75.6,slope:139}},yards:[433,344,380,122,310,292,356,146,355, 394,428,330,182,365,391,176,374,478]},
         {name:'White/Red',rating:{M:{cr:67.9,slope:120},W:{cr:72.9,slope:134}},yards:[433,344,353,122,310,292,304,146,355, 343,428,330,152,365,305,159,324,392]},
         {name:'Red',rating:{M:{cr:66.7,slope:115},W:{cr:71.7,slope:127}},yards:[410,324,353,107,288,259,304,124,328, 343,407,319,152,301,305,159,324,392]},
         {name:'Green',rating:{M:{cr:60.9,slope:103},W:{cr:63.2,slope:108}},yards:[316,220,219,80,208,176,184,85,221, 260,243,200,96,226,222,98,229,336]}]}
];
const RATINGS_VERSION=2; // ratings from the club's printed rating card
const G_SUM=a=>a.reduce((x,y)=>x+(+y||0),0);
/* holes in playing order for a group (shotgun starts wrap around) */
function playOrder(start){ const s=Math.min(18,Math.max(1,+start||1)); return Array.from({length:18},(_,i)=>((s-1+i)%18)+1); }
function toParTxt(v){ return v===0?'E':(v>0?'+'+v:'−'+Math.abs(v)); }
/* stroke-play leaderboard. pub = public event, scores = {playerId:{hole:strokes}} */
function leaderboard(pub,scores,opt){ opt=opt||{};
  const rows=[];
  for(const g of pub.groups||[]){ const c=pub.courses[g.course]; if(!c) continue;
    for(const p of g.players||[]){ const par=c.par[p.set||'M']||c.par.M, sc=scores[p.id]||{};
      const hc=c.hcp[p.set||'M']||c.hcp.M, ph=typeof p.ph==='number'?p.ph:null;
      let n=0,gross=0,parPlayed=0,out=0,inn=0,got=0;
      for(let h=1;h<=18;h++){ const s=+sc[h]; if(!s) continue; n++; gross+=s; parPlayed+=par[h-1]; if(h<=9) out+=s; else inn+=s; if(ph!=null) got+=strokesOn(ph,hc[h-1]); }
      rows.push({id:p.id,name:p.name,group:g.label||'',groupId:g.id,course:g.course,courseName:c.name,tee:p.tee,n,gross,toPar:gross-parPlayed,out,inn,thru:n===18?'F':String(n),par,ph,flight:p.flight||'',net:ph==null?null:gross-got,netToPar:ph==null?null:gross-got-parPlayed});
    } }
  const byNet=opt.sort==='net';
  const key=r=>byNet?(r.netToPar==null?9999:r.netToPar):r.toPar;
  const pool=opt.flight?rows.filter(r=>r.flight===opt.flight):rows;
  const played=pool.filter(r=>r.n>0).sort((a,b)=>key(a)-key(b)||b.n-a.n||a.gross-b.gross||a.name.localeCompare(b.name));
  const idle=pool.filter(r=>!r.n).sort((a,b)=>a.name.localeCompare(b.name));
  let pos=0,prev=null; played.forEach((r,i)=>{ const k=key(r); if(prev===null||k!==prev){ pos=i+1; prev=k; } r.pos=pos; });
  played.forEach(r=>{ r.posTxt=(played.filter(x=>x.pos===r.pos).length>1?'T':'')+r.pos; });
  idle.forEach(r=>{ r.posTxt='—'; });
  return played.concat(idle);
}

/* ---------- handicaps (World Handicap System) ----------
   Course Handicap = Index × Slope ÷ 113 + (Course Rating − Par), rounded (.5 up).
   Playing Handicap = Course Handicap × allowance %, rounded. */
function parseIndex(v){ if(v==null) return null; const s=String(v).trim(); if(!s) return null; const plus=/^\+/.test(s); const n=parseFloat(s.replace('+','')); if(!isFinite(n)) return null; return plus?-Math.abs(n):n; }
const idxTxt=n=>n==null?'—':(n<0?'+'+Math.abs(n).toFixed(1):n.toFixed(1));
const whsRound=x=>Math.sign(x)*Math.floor(Math.abs(x)+0.5);
function teeRating(course,teeName,set){ const t=(course.tees||[]).find(x=>x.name===teeName); const r=t&&t.rating&&t.rating[set||'M']; return r&&+r.cr&&+r.slope?{cr:+r.cr,slope:+r.slope}:null; }
function courseHcp(index,course,teeName,set){ if(index==null) return null; const r=teeRating(course,teeName,set); if(!r) return null;
  const par=G_SUM(course.par[set||'M']||course.par.M); return whsRound(index*r.slope/113+(r.cr-par)); }
/* strokes a player gets on one hole from a playing handicap (plus handicaps give strokes back, from hcp 18 up) */
function strokesOn(ph,holeHcp){ if(!ph) return 0; if(ph>0) return Math.floor(ph/18)+(holeHcp<=ph%18?1:0); const g=-ph; return -(Math.floor(g/18)+(holeHcp>18-(g%18)?1:0)); }

/* ---------- best ball ----------
   Each player plays their own ball; the team's score on a hole is the best (lowest) score among
   its players who've posted that hole — gross, or net after each player's strokes. */
function teamKey(p){ return p.team||('solo:'+p.id); }
function bestBallBoard(pub,scores,opt){
  opt=opt||{}; const teams=new Map();
  for(const g of pub.groups||[]){ const c=pub.courses[g.course]; if(!c) continue;
    for(const p of g.players||[]){ const k=teamKey(p); if(!teams.has(k)) teams.set(k,{id:k,members:[],group:g.label||'',groupId:g.id,course:g.course,courseName:c.name}); teams.get(k).members.push({p,c}); } }
  const rows=[];
  for(const t of teams.values()){
    let n=0,gross=0,toPar=0,net=0,netToPar=0,netOK=t.members.every(m=>typeof m.p.ph==='number');
    for(let h=1;h<=18;h++){ let bg=null,bgp=null,bn=null,bnp=null;
      for(const {p,c} of t.members){ const s=+((scores[p.id]||{})[h]); if(!s) continue; const par=(c.par[p.set||'M']||c.par.M)[h-1];
        if(bg===null||s-par<bgp){ bg=s; bgp=s-par; }
        if(netOK){ const k=strokesOn(p.ph,(c.hcp[p.set||'M']||c.hcp.M)[h-1]); if(bn===null||s-k-par<bnp){ bn=s-k; bnp=s-k-par; } } }
      if(bg===null) continue; n++; gross+=bg; toPar+=bgp; if(netOK){ net+=bn; netToPar+=bnp; } }
    const flights=[...new Set(t.members.map(m=>m.p.flight).filter(Boolean))];
    rows.push({id:t.id,name:t.members.map(m=>m.p.name).join(' / '),members:t.members.map(m=>m.p.id),group:t.group,groupId:t.groupId,course:t.course,courseName:t.courseName,
      n,gross,toPar,thru:n===18?'F':String(n),net:netOK?net:null,netToPar:netOK?netToPar:null,flight:flights.length===1?flights[0]:flights.join('/'),team:true});
  }
  const byNet=opt.sort==='net', key=r=>byNet?(r.netToPar==null?9999:r.netToPar):r.toPar;
  const pool=opt.flight?rows.filter(r=>r.flight===opt.flight):rows;
  const played=pool.filter(r=>r.n>0).sort((a,b)=>key(a)-key(b)||b.n-a.n||a.gross-b.gross||a.name.localeCompare(b.name));
  const idle=pool.filter(r=>!r.n).sort((a,b)=>a.name.localeCompare(b.name));
  let pos=0,prev=null; played.forEach((r,i)=>{ const k=key(r); if(prev===null||k!==prev){ pos=i+1; prev=k; } r.pos=pos; });
  played.forEach(r=>{ r.posTxt=(played.filter(x=>x.pos===r.pos).length>1?'T':'')+r.pos; }); idle.forEach(r=>{ r.posTxt='—'; });
  return played.concat(idle);
}
/* the board for an event: teams for best ball (unless players are asked for), players for stroke play */
function eventBoard(pub,scores,opt){ opt=opt||{}; return pub.format==='bestball'&&opt.view!=='players'?bestBallBoard(pub,scores,opt):leaderboard(pub,scores,opt); }
const FORMAT_LABEL={stroke:'Stroke play',bestball:'Best ball'};

/* ---------- WCCC-style scorecard ----------
   Styled after the club's printed card: course header, tee rows in their colors, par and
   handicap rows, then players. Gross in every cell; where a player gets a stroke the net
   score sits small in the corner. Totals end with HCP and NET like the printed card.
   Best ball adds a team row per team (the counting score each hole, on the event's basis),
   and the ball that counted is underlined in gold. */
const WC_CSS=`
.wc{--wc-navy:#1F3552;--wc-red:#A2343A;--wc-gold:#C7B350;--wc-teeRed:#B9434A;--wc-green:#444C48;--wc-line:#C9C2B2;
  background:#fff;border:1px solid var(--wc-line);border-radius:12px;overflow:hidden;font-family:'Public Sans',system-ui,sans-serif;color:#14222B}
.wc-top{display:flex;align-items:flex-end;justify-content:space-between;gap:12px;padding:14px 18px 10px;border-bottom:2px solid var(--wc-accent,var(--wc-navy))}
.wc-top .nm{font-family:'Cormorant Garamond',Georgia,serif;font-style:italic;font-weight:700;font-size:30px;line-height:1;color:var(--wc-accent,var(--wc-navy))}
.wc-top small{display:block;font-size:11.5px;color:#56626A;margin-top:4px}
.wc-top .ev{text-align:right;font-size:12.5px;color:#56626A} .wc-top .ev b{display:block;color:#14222B;font-size:14px}
.wc-final{display:inline-block;margin-top:4px;padding:2px 8px;border:1.5px solid #1F6B4A;color:#1F6B4A;border-radius:4px;font-weight:800;font-size:11px;letter-spacing:.08em;transform:rotate(-3deg)}
.wc-wrap{overflow-x:auto}
.wc table{border-collapse:collapse;width:100%;font-variant-numeric:lining-nums tabular-nums;font-size:13px}
.wc th,.wc td{border:1px solid var(--wc-line);text-align:center;padding:0;height:34px;min-width:30px}
.wc th:first-child,.wc td:first-child{text-align:left;padding:0 10px;min-width:128px;white-space:nowrap;position:sticky;left:0;background:inherit;z-index:1}
.wc .wc-h th,.wc .wc-h td{background:var(--wc-accent,var(--wc-navy));color:#fff;font-weight:700}
.wc .wc-tot{font-weight:700;background:#F4F0E6}
.wc .wc-h .wc-tot{background:rgba(0,0,0,.25)}
.wc tr.t-gold td,.wc tr.t-gold th{background:var(--wc-gold);color:#2B2410}
.wc tr.t-blue td,.wc tr.t-blue th,.wc tr.t-blue-white td,.wc tr.t-blue-white th{background:var(--wc-navy);color:#fff}
.wc tr.t-white td,.wc tr.t-white th,.wc tr.t-white-red td,.wc tr.t-white-red th{background:#fff}
.wc tr.t-red td,.wc tr.t-red th{background:var(--wc-teeRed);color:#fff}
.wc tr.t-green td,.wc tr.t-green th{background:var(--wc-green);color:#fff}
.wc tr.t-blue-white th::after{content:'';} 
.wc tr.wc-par td,.wc tr.wc-par th{background:var(--wc-navy);color:#fff;font-weight:700}
.wc tr.wc-hc td,.wc tr.wc-hc th{font-size:11.5px;color:#56626A;background:#FBFAF5}
.wc tr.wc-p th{font-weight:700;background:#fff}
.wc tr.wc-p th small{display:block;font-weight:500;font-size:11px;color:#56626A;margin-top:1px}
.wc tr.wc-p td{background:#fff;position:relative;font-size:15px;font-weight:600}
.wc tr.wc-me th,.wc tr.wc-me td{background:#FBF4E0}
.wc .wc-s{display:inline-flex;align-items:center;justify-content:center;width:24px;height:24px;line-height:1}
.wc .wc-s.b{border:1.5px solid #14222B;border-radius:50%}
.wc .wc-s.e{border:1.5px solid #14222B;border-radius:50%;box-shadow:0 0 0 2px #fff,0 0 0 3.5px #14222B}
.wc .wc-s.o{border:1.5px solid #14222B}
.wc .wc-s.d{border:1.5px solid #14222B;box-shadow:0 0 0 2px #fff,0 0 0 3.5px #14222B}
.wc .wc-n{position:absolute;right:2px;bottom:1px;font-size:10px;font-weight:800;color:#8C6A1F}
.wc .wc-dot{position:absolute;left:3px;top:3px;width:5px;height:5px;border-radius:50%;background:#8C6A1F}
.wc .wc-dot+.wc-dot{left:10px}
.wc td.wc-c::after{content:'';position:absolute;left:5px;right:5px;bottom:2px;height:3px;border-radius:2px;background:#C7A13A}
.wc tr.wc-t th,.wc tr.wc-t td{background:#EEF1F2;font-weight:800;position:relative}
.wc tr.wc-t th small{display:block;font-weight:600;font-size:11px;color:#56626A}
.wc .wc-net{color:#1F6B4A}
.wc-key{display:flex;gap:14px;flex-wrap:wrap;padding:10px 18px 14px;font-size:11.5px;color:#56626A;align-items:center;border-top:1px solid var(--wc-line)}
.wc-key .wc-s{width:18px;height:18px;font-size:11px;margin-right:4px;vertical-align:middle}
.wc-key i{display:inline-block;width:16px;height:3px;background:#C7A13A;border-radius:2px;margin-right:4px;vertical-align:middle}
.wc-key em{font-style:normal;font-weight:800;color:#8C6A1F;margin-right:3px}
.wc .wc-n{right:1px;bottom:0}
@media (max-width:560px){ .wc th,.wc td{min-width:24px;height:32px;font-size:12px} .wc th:first-child,.wc td:first-child{min-width:0;max-width:92px;padding:0 5px;overflow:hidden;text-overflow:ellipsis} .wc th:first-child small{font-size:10px}
  .wc tr.wc-p td{font-size:13.5px} .wc .wc-s{width:21px;height:21px} .wc-top .nm{font-size:24px} .wc-top{flex-wrap:wrap} .wc-top .ev{text-align:left} }
.wc tr.wc-fmt td,.wc tr.wc-fmt th{background:#F6ECCF;color:#6B4F12;font-weight:800;font-size:11.5px;height:24px;letter-spacing:.02em}
.wc tr.wc-p td.wc-x,.wc td.wc-x{background:repeating-linear-gradient(135deg,#F1EEE6 0 6px,#E7E2D6 6px 7px)}
.wc-key .wc-xk{display:inline-block;width:16px;height:12px;margin-right:4px;vertical-align:middle;background:repeating-linear-gradient(135deg,#F1EEE6 0 4px,#E7E2D6 4px 5px);border:1px solid #C9C2B2}
.wc-sign{display:flex;justify-content:space-between;padding:8px 18px 12px;font-size:12px;color:#56626A;border-top:1px solid var(--wc-line)}
`;
function ensureCardCSS(){ if(typeof document==='undefined'||document.getElementById('wc-css')) return; const s=document.createElement('style'); s.id='wc-css'; s.textContent=WC_CSS; document.head.appendChild(s); }
function scorecardHTML(pub,g,scores,opt){
  opt=opt||{}; ensureCardCSS();
  const c=pub.courses[g.course]; if(!c) return '';
  const E=s=>String(s??'').replace(/[&<>"']/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
  const accent=g.course==='pecan'?'#A2343A':'#1F3552';
  const halves=opt.split?[[1,9],[10,18]]:[[1,18]];
  const ps=g.players, TEAM=isTeamEvent(pub), basisNet=(pub.scoring==='net'), split=pub.format==='split';
  const par=p=>c.par[p.set||'M']||c.par.M, hc=p=>c.hcp[p.set||'M']||c.hcp.M;
  const sc=p=>scores[p.id]||{};
  const phFor=(p,h)=>{ const f=holeFormat(pub,h); if(f==='scramble') return null; return f==='stroke'?p.ph:segPH(pub,p,f); };
  const k=(p,h)=>{ const ph=phFor(p,h); return typeof ph==='number'?strokesOn(ph,hc(p)[h-1]):0; };
  const teesUsed=[...new Set(ps.map(p=>p.tee))].filter(t=>c.tees&&t in c.tees);
  const anyW=ps.some(p=>p.set==='W');
  const teams=TEAM?groupTeams(g):[];
  const TH={}, counted=new Set();
  teams.forEach(t=>{ TH[t.key]={}; for(let h=1;h<=18;h++){ const r=teamHole(pub,c,t,h,scores); if(r){ TH[t.key][h]=r; if(r.by) counted.add(r.by+'|'+h); } } });
  const short=n=>{ const w=String(n).trim().split(/\s+/); return opt.split&&w.length>1?w[0][0]+'. '+w.slice(1).join(' '):n; };
  const shape=(s,pr)=>{ const d=s-pr; return d<=-2?'e':d===-1?'b':d===1?'o':d>=2?'d':''; };
  const range=(a,b)=>Array.from({length:b-a+1},(_,i)=>a+i);
  const sumH=(fn,a,b)=>{ let t=0,n=0; for(let h=a;h<=b;h++){ const v=fn(h); if(v!=null){ t+=v; n++; } } return n?t:''; };
  const phTxt=v=>typeof v==='number'?(v<0?'+'+(-v):v):'';
  const plFmt=eventFormats(pub).find(f=>f!=='scramble');
  const tables=halves.map(([a,b])=>{
    const nines=a===1&&b===18?[[1,9,'Out'],[10,18,'In']]:[[a,b,a===1?'Out':'In']];
    const endCols=(a===1&&b===18)||b===18;
    const fmtRow=split?`<tr class="wc-fmt"><th>Format</th>${nines.map(([x,y])=>`<td colspan="${y-x+2}">${E(FORMAT_LABEL[holeFormat(pub,x)])}${holeFormat(pub,x)==='scramble'?' · team score':''}</td>`).join('')}${endCols?'<td colspan="3"></td>':''}</tr>`:'';
    const head=`<tr class="wc-h"><th>Hole</th>${nines.map(([x,y,l])=>range(x,y).map(h=>`<th>${h}</th>`).join('')+`<th class="wc-tot">${l}</th>`).join('')}${endCols?'<th class="wc-tot">Tot</th><th class="wc-tot">Hcp</th><th class="wc-tot">Net</th>':''}</tr>`;
    const lineRow=(cls,label,valFn,totFn)=>`<tr class="${cls}"><th>${label}</th>${nines.map(([x,y])=>range(x,y).map(h=>`<td>${valFn(h)??''}</td>`).join('')+`<td class="wc-tot">${totFn?totFn(x,y):''}</td>`).join('')}${endCols?`<td class="wc-tot">${totFn?totFn(1,18):''}</td><td class="wc-tot"></td><td class="wc-tot"></td>`:''}</tr>`;
    const tees=teesUsed.map(t=>{ const y=c.tees[t]; return lineRow('t-'+t.toLowerCase().replace('/','-'),E(t),h=>y?y[h-1]:'·',(x,z)=>y?sumH(h=>y[h-1],x,z):''); }).join('');
    const hcpM=lineRow('wc-hc','Men’s Handicap',h=>c.hcp.M[h-1]);
    const parRow=lineRow('wc-par','Par',h=>(anyW&&c.par.W[h-1]!==c.par.M[h-1])?c.par.M[h-1]+'/'+c.par.W[h-1]:c.par.M[h-1],(x,z)=>sumH(h=>c.par.M[h-1],x,z));
    const hcpW=anyW?lineRow('wc-hc','Women’s Handicap',h=>c.hcp.W[h-1]):'';
    const pRow=p=>{ const S=sc(p), own=h=>holeFormat(pub,h)!=='scramble'&&S[h]?+S[h]:null;
      const gT=(x,z)=>sumH(own,x,z), nT=(x,z)=>sumH(h=>own(h)!=null?own(h)-k(p,h):null,x,z);
      const cells=nines.map(([x,y])=>range(x,y).map(h=>{ if(holeFormat(pub,h)==='scramble') return '<td class="wc-x"></td>';
        const s=+S[h], kk=k(p,h);
        if(!s) return `<td>${kk>0?'<span class="wc-dot"></span>'.repeat(Math.min(kk,2)):''}</td>`;
        return `<td class="${TEAM&&counted.has(p.id+'|'+h)?'wc-c':''}"><span class="wc-s ${shape(s,par(p)[h-1])}">${s}</span>${kk?`<span class="wc-n" title="Net ${s-kk}">${s-kk}</span>`:''}</td>`; }).join('')+`<td class="wc-tot">${gT(x,y)}</td>`).join('');
      const ph=plFmt?(plFmt==='stroke'?p.ph:segPH(pub,p,plFmt)):null; const allOwn=range(1,18).every(h=>holeFormat(pub,h)==='scramble'||S[h]);
      return `<tr class="wc-p${opt.highlight&&(opt.highlight===p.id||opt.highlight===p.team)?' wc-me':''}"><th title="${E(p.name)}">${E(short(p.name))}<small>${E(p.tee)}${p.flight?' · Flight '+E(p.flight):''}${typeof ph==='number'?' · plays '+phTxt(ph):''}</small></th>${cells}${endCols?`<td class="wc-tot">${gT(1,18)}</td><td class="wc-tot">${phTxt(ph)}</td><td class="wc-tot wc-net">${allOwn&&typeof ph==='number'?nT(1,18):''}</td>`:''}</tr>`; };
    const tRow=t=>{ const T=TH[t.key]; const main=h=>T[h]?(basisNet&&T[h].net!=null?T[h].net:T[h].gross):null, other=h=>T[h]?(basisNet?T[h].gross:T[h].net):null;
      const cells=nines.map(([x,y])=>range(x,y).map(h=>{ const v=main(h); const scr=holeFormat(pub,h)==='scramble';
        if(v==null){ const tph=scr?scrambleTeamPH(pub,t.members):null, kk=tph==null?0:strokesOn(tph,hc(t.captain)[h-1]); return `<td>${kk>0?'<span class="wc-dot"></span>'.repeat(Math.min(kk,2)):''}</td>`; }
        const o=other(h); return `<td><span class="wc-s ${shape(v,T[h].par)}">${v}</span>${o!=null&&o!==v?`<span class="wc-n" title="${basisNet?'Gross':'Net'} ${o}">${o}</span>`:''}</td>`; }).join('')+`<td class="wc-tot">${sumH(main,x,y)}</td>`).join('');
      const gross=sumH(h=>T[h]?T[h].gross:null,1,18), net=sumH(h=>T[h]&&T[h].net!=null?T[h].net:null,1,18);
      const tph=eventFormats(pub).includes('scramble')?scrambleTeamPH(pub,t.members):null;
      const lab=split?'Team':FORMAT_LABEL[holeFormat(pub,1)]==='Scramble'?'Team score':'Best ball';
      return `<tr class="wc-t"><th>${opt.split?'Team':lab}${basisNet?' net':''}<small>${E(t.members.map(p=>p.name.split(' ').slice(-1)[0]).join(' & '))}</small></th>${cells}${endCols?`<td class="wc-tot">${basisNet?net:gross}</td><td class="wc-tot">${tph!=null?phTxt(tph):''}</td><td class="wc-tot wc-net">${net}</td>`:''}</tr>`; };
    const body=TEAM?teams.map(t=>t.members.map(pRow).join('')+tRow(t)).join(''):ps.map(pRow).join('');
    return `<div class="wc-wrap"><table>${fmtRow}${head}${tees}${hcpM}${parRow}${body}${hcpW}</table></div>`;
  }).join(opt.split?'<div style="height:8px"></div>':'');
  const status=pub.status==='final'?'<span class="wc-final">FINAL</span>':'';
  const key=`<div class="wc-key"><span><span class="wc-s b">3</span>Birdie</span><span><span class="wc-s e">2</span>Eagle</span><span><span class="wc-s o">5</span>Bogey</span><span><span class="wc-s d">6</span>Double+</span><span><em>3</em>Net where a stroke is given</span>${TEAM&&eventFormats(pub).some(f=>f!=='scramble')?`<span><i></i>Ball that counted</span>`:''}${eventFormats(pub).includes('scramble')?'<span><b class="wc-xk"></b>Team plays one ball (scramble)</span>':''}</div>`;
  return `<div class="wc" style="--wc-accent:${accent}"><div class="wc-top"><div><div class="nm">${E(c.name)}</div><small>Walnut Creek Country Club · Mansfield, Texas</small></div><div class="ev"><b>${E(pub.name)}</b>${E([pub.date?new Date(pub.date+'T12:00').toLocaleDateString('en-US',{month:'short',day:'numeric',year:'numeric'}):'',g.label,formatSummary(pub)].filter(Boolean).join(' · '))}<br>${status}</div></div>${tables}${key}<div class="wc-sign"><span>Scorer ________________</span><span>Attest ________________</span></div></div>`;
}

/* ---------- formats per nine + USGA handicap allowances ----------
   WHS Appendix C recommendations: individual stroke play 95%; four-ball stroke play 85%;
   2-player scramble 35% low / 15% high; 4-player scramble 25/20/15/10%. Shamble isn't in
   Appendix C — defaulted to 85% (it plays as four-ball after the drive); set it per event. */
const TEAM_FORMATS=['bestball','scramble','shamble'];
const USGA_ALLOW={stroke:95,bestball:85,shamble:85,scramble2:[35,15],scramble3:[30,20,10],scramble4:[25,20,15,10]};
FORMAT_LABEL.scramble='Scramble'; FORMAT_LABEL.shamble='Shamble'; FORMAT_LABEL.split='Split format';
function holeFormat(pub,h){ return pub.format==='split'?(h<=9?pub.front:pub.back):(pub.format||'stroke'); }
function eventFormats(pub){ return pub.format==='split'?[pub.front,pub.back]:[pub.format||'stroke']; }
function isTeamEvent(pub){ return eventFormats(pub).some(f=>TEAM_FORMATS.includes(f)); }
function formatSummary(pub){ return pub.format==='split'?`Front: ${FORMAT_LABEL[pub.front]} · Back: ${FORMAT_LABEL[pub.back]}`:(FORMAT_LABEL[pub.format]||'Stroke play'); }
function allowOf(pub){ return Object.assign({},USGA_ALLOW,pub.allow||{}); }
/* a player's playing handicap for a per-player format (stroke / best ball / shamble) */
function segPH(pub,p,fmt){ if(typeof p.ch!=='number') return typeof p.ph==='number'?p.ph:null; const a=allowOf(pub)[fmt==='stroke'?'stroke':fmt]; return whsRound(p.ch*(+a||100)/100); }
/* a scramble team's handicap: course handicaps low→high, weighted by the scramble percentages */
function scrambleTeamPH(pub,members){ const chs=members.map(p=>p.ch).filter(v=>typeof v==='number').sort((a,b)=>a-b); if(chs.length!==members.length||!chs.length) return null;
  const A=allowOf(pub), pct=A['scramble'+chs.length]||A.scramble4.slice(0,chs.length); return whsRound(chs.reduce((t,ch,i)=>t+ch*(+pct[i]||0)/100,0)); }
/* teams in playing order; the first player listed carries the team's score on scramble holes */
function groupTeams(g){ const m=new Map(); for(const p of g.players||[]){ const k=teamKey(p); if(!m.has(k)) m.set(k,[]); m.get(k).push(p); } return [...m.entries()].map(([k,ms])=>({key:k,members:ms,captain:ms[0]})); }
/* one team's result on one hole: {gross, net, par, by} (by = player whose ball counted, if any) */
function teamHole(pub,c,t,h,scores){
  const fmt=holeFormat(pub,h), hcpOf=p=>(c.hcp[p.set||'M']||c.hcp.M)[h-1], parOf=p=>(c.par[p.set||'M']||c.par.M)[h-1];
  if(fmt==='scramble'){ const s=+((scores[t.captain.id]||{})[h]); if(!s) return null; const tph=scrambleTeamPH(pub,t.members);
    return {gross:s,net:tph==null?null:s-strokesOn(tph,hcpOf(t.captain)),par:parOf(t.captain),by:null,fmt}; }
  let best=null; for(const p of t.members){ const s=+((scores[p.id]||{})[h]); if(!s) continue; const ph=segPH(pub,p,fmt), k=ph==null?0:strokesOn(ph,hcpOf(p)), par=parOf(p);
    const cand={gross:s,net:ph==null?null:s-k,par,by:p.id,fmt}; const key=pub.scoring==='net'&&cand.net!=null?cand.net-par:s-par;
    if(!best||key<best.key) best=Object.assign(cand,{key}); }
  return best;
}
function teamBoard(pub,scores,opt){
  opt=opt||{}; const rows=[];
  for(const g of pub.groups||[]){ const c=pub.courses[g.course]; if(!c) continue;
    for(const t of groupTeams(g)){ let n=0,gross=0,toPar=0,net=0,netToPar=0,netOK=true;
      for(let h=1;h<=18;h++){ const r=teamHole(pub,c,t,h,scores); if(!r) continue; n++; gross+=r.gross; toPar+=r.gross-r.par; if(r.net==null) netOK=false; else { net+=r.net; netToPar+=r.net-r.par; } }
      const fl=[...new Set(t.members.map(p=>p.flight).filter(Boolean))];
      rows.push({id:t.key,name:t.members.map(p=>p.name).join(' / '),members:t.members.map(p=>p.id),group:g.label||'',groupId:g.id,course:g.course,courseName:c.name,
        n,gross,toPar,thru:n===18?'F':String(n),net:netOK?net:null,netToPar:netOK?netToPar:null,flight:fl.join('/'),team:true}); } }
  const byNet=opt.sort==='net', key=r=>byNet?(r.netToPar==null?9999:r.netToPar):r.toPar;
  const pool=opt.flight?rows.filter(r=>r.flight===opt.flight):rows;
  const played=pool.filter(r=>r.n>0).sort((a,b)=>key(a)-key(b)||b.n-a.n||a.gross-b.gross||a.name.localeCompare(b.name)), idle=pool.filter(r=>!r.n).sort((a,b)=>a.name.localeCompare(b.name));
  let pos=0,prev=null; played.forEach((r,i)=>{ const k=key(r); if(prev===null||k!==prev){ pos=i+1; prev=k; } r.pos=pos; });
  played.forEach(r=>{ r.posTxt=(played.filter(x=>x.pos===r.pos).length>1?'T':'')+r.pos; }); idle.forEach(r=>{ r.posTxt='—'; });
  return played.concat(idle);
}
/* team events rank teams (players view only makes sense without scramble holes) */
function eventBoard(pub,scores,opt){ opt=opt||{}; const noPlayers=eventFormats(pub).includes('scramble');
  return isTeamEvent(pub)&&(opt.view!=='players'||noPlayers)?teamBoard(pub,scores,opt):leaderboard(pub,scores,opt); }
function bestBallBoard(pub,scores,opt){ return teamBoard(pub,scores,opt); }

