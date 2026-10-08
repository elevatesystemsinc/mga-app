/* =====================================================================
   Club Hub — Tournament rounds & results. A tournament declares its rounds (one or more per day, each with a
   format: e.g. Saturday scramble/shamble split, Sunday best ball); one button builds the scoring events from the
   field (teams come across as the teams, flights copy from the first round); results total the rounds to decide
   the winners overall and per flight, and can be sent to the Calcutta as finishes.
   t.rounds=[{id,day,name,format,front,back,teamSize,count,countPattern,scoring,eventId}], t.resultsBasis
   ===================================================================== */
TT.splice((TT.findIndex(x=>x[0]==='checkin')>=0?TT.findIndex(x=>x[0]==='checkin'):TT.findIndex(x=>x[0]==='field'))+1,0,['rounds','Rounds & results']);
view.rflight='';
const tournamentRounds=t=>{ t.rounds=t.rounds||[]; return t.rounds; };
const roundEvent=r=>r&&r.eventId?golfData().events.find(e=>e.id===r.eventId):null;
const roundDate=(t,day)=>{ const d=parseD(t.startDate); if(!d) return ''; const x=addDays(d,day); return `${x.getFullYear()}-${String(x.getMonth()+1).padStart(2,'0')}-${String(x.getDate()).padStart(2,'0')}`; };
const roundLabel=(t,r)=>r.name||`${dayLabel(t,r.day).split(' · ')[0]} · ${formatSummary(r)}`;
function defaultRounds(t){ const n=Math.max(1,t.days||1), ts=t.teamSize||1;
  return Array.from({length:n},(_,day)=>({id:uid(),day,name:'',format:ts>=2?'bestball':'stroke',front:'scramble',back:'shamble',teamSize:ts,count:1,countPattern:'',scoring:'net',eventId:''})); }
/* the round's format fields, pushed onto its event */
const ROUND_KEYS=['format','front','back','teamSize','count','countPattern','scoring'];
function roundToEvent(r,ev){ ROUND_KEYS.forEach(k=>{ ev[k]=r[k]; }); if(!ev.allow) ev.allow={}; }

function tRounds(el,t){
  const rs=tournamentRounds(t).slice().sort((a,b)=>a.day-b.day), missing=rs.filter(r=>!roundEvent(r));
  const R=tournamentResults(t,t.resultsBasis||'net');
  rs.forEach(r=>{ const ev=roundEvent(r); if(ev&&CLOUD&&sessionOK&&!golfScores[ev.id]) setTimeout(()=>loadScores(ev),0); });
  const rrow=r=>{ const ev=roundEvent(r), n=ev?evPlayers(ev).length:0;
    return `<div class="tr click" data-rnd="${r.id}" style="grid-template-columns:110px minmax(0,1.6fr) minmax(0,1fr) 120px 40px"><span><b>${esc(dayLabel(t,r.day).split(' · ')[0])}</b><br><small class="muted">${esc(dayShort(t,r.day))}</small></span><div class="cell2"><b class="trunc">${esc(roundLabel(t,r))}</b><small>${esc(formatSummary(r))} · ${r.scoring==='net'?'net':'gross'}</small></div>
      <span class="muted" style="font-size:13px">${ev?`${n} players · ${ev.groups.length} groups${ev.flights&&ev.flights.count?' · '+ev.flights.count+' flights':''}`:'No scoring event yet'}</span><span>${ev?evStatusChip(ev):'<span class="chip">Not built</span>'}</span><span class="ib">${I.edit}</span></div>`; };
  const act=r=>{ const ev=roundEvent(r); if(!ev) return ''; const first=rs.find(x=>roundEvent(x)&&x!==r); return `<div class="tr" style="grid-template-columns:110px minmax(0,1fr)"><span></span><div class="actions"><button class="btn sm" data-rgo="${r.id}">Open event</button>${first&&roundEvent(first).flights.count&&!ev.flights.count?`<button class="btn sm" data-rcf="${r.id}">Copy flights from ${esc(dayLabel(t,first.day).split(' · ')[0])}</button>`:''}${first&&roundEvent(first).groups.length&&!ev.groups.length?`<button class="btn sm" data-rcg="${r.id}">Copy groups from ${esc(dayLabel(t,first.day).split(' · ')[0])}</button>`:''}</div></div>`; };
  const flights=[...new Set(R.list.map(u=>u.flight).filter(Boolean))].sort();
  if(view.rflight&&!flights.includes(view.rflight)) view.rflight='';
  const shown=view.rflight?R.list.filter(u=>u.flight===view.rflight):R.list;
  const cols=`grid-template-columns:48px minmax(0,1.8fr) 60px repeat(${R.rounds.length},88px) 96px`;
  const cell=(u,r)=>{ const x=u.rounds[r.id]; if(!x||!x.n) return '<span class="r muted">—</span>'; return `<span class="r">${esc(x.txt)}${x.complete?'':`<br><small class="muted">thru ${esc(x.thru)}</small>`}</span>`; };
  el.innerHTML=`<div class="card" style="overflow:hidden"><div class="cardhead"><div><h2 class="h2">Rounds</h2><span class="muted">${t.days} day${t.days>1?'s':''} · ${t.teamSize>1?t.teamSize+'-player teams':'individual'} · the field’s ${t.field.length} players</span></div>
      <div class="actions">${rs.length?'':`<button class="btn" id="rndSuggest">Suggest rounds</button>`}<button class="btn" id="rndAdd">${I.plus}Add round</button>${missing.length?`<button class="btn pri" id="rndBuild"${t.field.length?'':' disabled'}>Create scoring event${missing.length>1?'s':''} (${missing.length})</button>`:''}</div></div>
    ${rs.length?`<div class="tw"><div class="t" style="min-width:680px">${rs.map(r=>rrow(r)+act(r)).join('')}</div></div>`:`<div class="empty"><b>No rounds yet</b><span>Declare each day’s format — for example Saturday front nine scramble / back nine shamble, Sunday best ball — then create the scoring events in one click. Results below total the rounds.</span></div>`}
    ${!t.field.length&&rs.length?'<div class="banner">Import or add the field first — the scoring events are built from it.</div>':''}</div>
  <div class="card" style="overflow:hidden"><div class="cardhead"><div><h2 class="h2">Results</h2><span class="muted">${R.rounds.length?`${R.rounds.length} round${R.rounds.length>1?'s':''} totalled${R.unit==='strokes'?' by '+(t.resultsBasis||'net')+' score to par':R.unit==='points'?' by points':R.unit==='holes'?' by holes up':R.unit==='match'?' by match points':''}${R.final?' · <b>Final</b>':R.rounds.length?' · live':''}`:'Results appear once scoring events exist.'}</span></div>
      <div class="actions">${R.unit==='strokes'?`<div class="seg">${['gross','net'].map(b=>`<button class="${(t.resultsBasis||'net')===b?'on':''}" data-rb="${b}">${b==='net'?'Net':'Gross'}</button>`).join('')}</div>`:''}${flights.length?`<div class="seg">${['',...flights].map(f=>`<button class="${view.rflight===f?'on':''}" data-rf="${f}">${f?'Flight '+f:'All'}</button>`).join('')}</div>`:''}${R.list.length&&t.calcutta&&(t.calcutta.lots||[]).length?`<button class="btn sm" id="rndCalc">Send finishes to Calcutta</button>`:''}</div></div>
    ${R.mixed?'<div class="banner">These rounds use different scoring units (strokes, points…), so there is no combined total — each round is shown on its own.</div>':''}
    ${R.list.length?`<div class="tw"><div class="t" style="min-width:${520+R.rounds.length*88}px"><div class="tr th" style="${cols}"><span>Pos</span><span>${R.list[0].isTeam?'Team':'Player'}</span><span>Flt</span>${R.rounds.map(r=>`<span class="r">${esc(dayLabel(t,r.day).split(' · ')[0].slice(0,3))}${rs.filter(x=>x.day===r.day).length>1?' '+(rs.filter(x=>x.day===r.day).indexOf(r)+1):''}</span>`).join('')}<span class="r">Total</span></div>
      ${shown.map(u=>`<div class="tr num" style="${cols}"><b>${view.rflight?u.flightPosTxt:u.posTxt}</b><div class="cell2"><b class="trunc">${esc(u.name)}</b>${u.complete?'':`<small>${u.played} of ${R.rounds.length} rounds</small>`}</div><span class="muted">${esc(u.flight||'')}</span>${R.rounds.map(r=>cell(u,r)).join('')}<b class="r ${R.unit==='strokes'&&u.total<0?'pos':''}" style="font-size:15px">${R.mixed?'—':esc(u.totalTxt)}</b></div>`).join('')}</div></div>`
    :R.rounds.length?'<div class="empty"><span>No scores yet.</span></div>':''}</div>`;
  const sg=$('rndSuggest'); if(sg) sg.onclick=()=>{ t.rounds=defaultRounds(t); persist(); render(); toast(`${t.rounds.length} round${t.rounds.length>1?'s':''} suggested — adjust the formats, then create the events`); };
  $('rndAdd').onclick=()=>editRound(t,null); const bd=$('rndBuild'); if(bd) bd.onclick=()=>createRoundEvents(t);
  el.querySelectorAll('[data-rnd]').forEach(x=>x.onclick=()=>editRound(t,tournamentRounds(t).find(r=>r.id===x.dataset.rnd)));
  el.querySelectorAll('[data-rgo]').forEach(b=>b.onclick=e=>{ e.stopPropagation(); view.geid=roundEvent(tournamentRounds(t).find(r=>r.id===b.dataset.rgo)).id; view.getab='groups'; go('golf'); loadScores(GEV()); });
  el.querySelectorAll('[data-rcf]').forEach(b=>b.onclick=e=>{ e.stopPropagation(); copyRoundSetup(t,tournamentRounds(t).find(r=>r.id===b.dataset.rcf),false); });
  el.querySelectorAll('[data-rcg]').forEach(b=>b.onclick=e=>{ e.stopPropagation(); copyRoundSetup(t,tournamentRounds(t).find(r=>r.id===b.dataset.rcg),true); });
  el.querySelectorAll('[data-rb]').forEach(b=>b.onclick=()=>{ t.resultsBasis=b.dataset.rb; persist(); render(); });
  el.querySelectorAll('[data-rf]').forEach(b=>b.onclick=()=>{ view.rflight=b.dataset.rf; render(); });
  const sc=$('rndCalc'); if(sc) sc.onclick=()=>sendFinishesToCalcutta(t,R);
}
function editRound(t,r){
  const days=Array.from({length:t.days||1},(_,i)=>[i,dayLabel(t,i)]), ts=t.teamSize||1, ev=roundEvent(r);
  const cur=r||{day:tournamentRounds(t).length%(t.days||1),name:'',format:ts>=2?'bestball':'stroke',front:'scramble',back:'shamble',teamSize:ts,count:1,countPattern:'',scoring:'net'};
  openDrawer({kicker:t.name,title:r?'Round':'Add round',
    body:pair(field('Day','rdD',cur.day,{type:'select',options:days}),field('Name (optional)','rdN',cur.name,{ph:'e.g. Saturday · Scramble / Shamble'}))+
      `<div class="fld"><span class="lbl">Format</span><select class="inp" id="rdF">${FORMAT_GROUPS.map(([g,fs])=>`<optgroup label="${g}">${fs.map(f=>`<option value="${f}"${cur.format===f?' selected':''}>${FORMAT_LABEL[f]}</option>`).join('')}</optgroup>`).join('')}</select></div>
       <div id="rdSplit" style="display:${cur.format==='split'?'grid':'none'};grid-template-columns:repeat(2,minmax(0,1fr));gap:12px">${field('Front nine (1–9)','rdFr',cur.front,{type:'select',options:TEAM_FORMATS.map(f=>[f,FORMAT_LABEL[f]])})}${field('Back nine (10–18)','rdBk',cur.back,{type:'select',options:TEAM_FORMATS.map(f=>[f,FORMAT_LABEL[f]])})}</div>
       <div id="rdTeam" style="display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:12px">${field('Team size','rdTS',cur.teamSize||ts,{type:'select',options:[2,3,4,5,6].map(n=>[n,n+' players'])})}${field('Balls that count','rdCnt',cur.count||1,{type:'select',options:[1,2,3,4,5].map(n=>[n,'Best '+n])})}${field('Pattern','rdCP',cur.countPattern||'',{type:'select',options:[['','Same all holes'],['123','1-2-3 by six holes']]})}</div>
       <p class="hint" id="rdHint"></p>`+field('Scored','rdSc',cur.scoring||'net',{type:'select',options:[['net','Net (handicaps)'],['gross','Gross']]})+
      (ev?`<p class="hint">Changes apply to its scoring event too (${esc(ev.name)}). Allowances are edited on the event.</p>`:`<p class="hint">${ts>=2?`Teams come from the field (${ts} players).`:'An individual tournament: team formats form teams in the groups.'}</p>`),
    wire:x=>{ const upd=()=>{ const f=x.querySelector('#rdF').value, F=FORMATS[f]||FORMATS.stroke, team=F.team===true||f==='split'||f==='match'; x.querySelector('#rdSplit').style.display=f==='split'?'grid':'none'; x.querySelector('#rdTeam').style.display=team?'grid':'none';
        const tsSel=x.querySelector('#rdTS'); if(ts>=2&&!F.size){ tsSel.value=ts; tsSel.disabled=true; } else if(F.size){ tsSel.value=F.size; tsSel.disabled=true; } else tsSel.disabled=false;
        const n=+tsSel.value; x.querySelector('#rdCnt').parentElement.style.display=F.count||f==='split'?'':'none'; x.querySelector('#rdCP').parentElement.style.display=F.count&&n===4?'':'none'; [...x.querySelector('#rdCnt').options].forEach(o=>{ o.disabled=+o.value>=n; }); if(+x.querySelector('#rdCnt').value>=n) x.querySelector('#rdCnt').value=1;
        x.querySelector('#rdHint').textContent=f==='split'?'Front nine and back nine are scored with different team formats; both count toward the round.':F.team===true?`${F.label}: ${f==='scramble'||f==='foursomes'||f==='greensome'?'one team score per hole':'everyone plays their own ball'}.`:''; };
      ['#rdF','#rdTS','#rdFr','#rdBk'].forEach(id=>x.querySelector(id).onchange=upd); upd(); },
    save:()=>{ const f=fv('rdF'), F=FORMATS[f]||FORMATS.stroke; if(f==='split'&&fv('rdFr')===fv('rdBk')){ toast('Front and back use the same format — pick it as the format instead'); return false; }
      const tsz=F.size||(F.team===true||f==='split'||f==='match'?+fv('rdTS')||2:1);
      const d={day:+fv('rdD')||0,name:fv('rdN'),format:f,front:fv('rdFr'),back:fv('rdBk'),teamSize:tsz,count:Math.min(tsz-1,+fv('rdCnt')||1)||1,countPattern:tsz===4?fv('rdCP'):'',scoring:fv('rdSc')};
      if(r){ Object.assign(r,d); const e=roundEvent(r); if(e){ roundToEvent(r,e); e.date=roundDate(t,r.day)||e.date; golfSave(e); } } else tournamentRounds(t).push(Object.assign({id:uid(),eventId:''},d)); },
    del:r?()=>{ const e=roundEvent(r); if(e&&!confirm(`Remove this round? Its scoring event (${e.name}) stays in Golf.`)) return false; t.rounds=t.rounds.filter(x=>x!==r); }:null,delLabel:'Remove round'});
}
/* build the scoring events: one per round without one, field imported with its teams, later days copying the first day's flights */
function createRoundEvents(t){
  const G=golfData(), rs=tournamentRounds(t).slice().sort((a,b)=>a.day-b.day), made=[];
  if(!t.field.length){ toast('Import or add the field first'); return; }
  for(const r of rs){ if(roundEvent(r)) continue;
    let slug=slugify(`${t.name}-${t.season}-d${r.day+1}`), n=2; while(G.events.some(e=>e.slug===slug)) slug=slugify(`${t.name}-${t.season}-d${r.day+1}`)+'-'+(n++);
    const ev={id:uid(),status:'draft',name:`${t.name} · ${dayLabel(t,r.day).split(' · ')[0]}${rs.filter(x=>x.day===r.day).length>1?' · '+formatSummary(r):''}`,date:roundDate(t,r.day),defaultTee:'White',defaultCourse:'oak',slug,tournamentId:t.id,allow:{},groups:[],pool:[],flights:{count:0,names:[]},createdAt:new Date().toISOString(),roundId:r.id};
    roundToEvent(r,ev);
    ev.pool=t.field.map(fp=>{ const m=memberById(fp.memberId); return {id:uid(),memberId:fp.memberId,name:m?memberName(m):(fp.name||'Player'),tee:ev.defaultTee,set:'M',team:(t.teamSize||1)>1?'T'+(fp.team||0):'',index:'',flight:''}; });
    G.events.push(ev); r.eventId=ev.id; made.push(ev);
    const first=rs.map(roundEvent).find(e=>e&&e!==ev&&e.flights&&e.flights.count); if(first) copyFlightsInto(first,ev);
    publishEvent(ev); }
  persist(); render();
  toast(made.length?`${made.length} scoring event${made.length===1?'':'s'} created — set flights and groups in Golf`:'Every round already has its event');
}
function copyFlightsInto(from,to){
  to.flights=clone(from.flights); const fl=new Map(evPlayers(from).map(x=>[x.p.memberId,x.p.flight])); evPlayers(to).forEach(x=>{ if(x.p.memberId&&fl.has(x.p.memberId)) x.p.flight=fl.get(x.p.memberId)||''; });
}
function copyRoundSetup(t,r,groups){
  const ev=roundEvent(r), from=tournamentRounds(t).slice().sort((a,b)=>a.day-b.day).map(roundEvent).find(e=>e&&e!==ev&&(groups?e.groups.length:e.flights.count)); if(!ev||!from) return;
  if(groups&&ev.groups.length&&!confirm('Replace this round’s groups with the earlier round’s pairings?')) return;
  copyFlightsInto(from,ev);
  if(groups){ const byM=new Map(evPlayers(ev).map(x=>[x.p.memberId,x.p])); const used=new Set();
    ev.groups=from.groups.map(g=>({id:uid(),code:newCode({groups:[]}),label:g.label,course:g.course,startHole:g.startHole,teeTime:g.teeTime||'',players:g.players.map(p=>byM.get(p.memberId)).filter(p=>p&&!used.has(p.id)&&used.add(p.id)).map(p=>({...p}))})).filter(g=>g.players.length);
    const inG=new Set(ev.groups.flatMap(g=>g.players.map(p=>p.id))); ev.pool=ev.pool.filter(p=>!inG.has(p.id)); }
  golfSave(ev); render(); toast(groups?'Flights and groups copied':'Flights copied');
}
/* total the rounds: per team (or player) the per-round value in the rounds' unit, ranked overall and per flight */
function tournamentResults(t,basis){
  const rs=tournamentRounds(t).filter(roundEvent).sort((a,b)=>a.day-b.day), units=new Map(), kinds=[];
  rs.forEach(r=>{ const ev=roundEvent(r), pub=publicEvent(ev), unit=unitOf(pub); kinds.push(unit);
    const rows=eventBoard(pub,scoresFor(ev),{sort:basis}), pl=new Map(evPlayers(ev).map(x=>[x.p.id,x.p]));
    rows.forEach(row=>{ const key=row.team?row.id:((pl.get(row.id)||{}).memberId||row.id); let u=units.get(key); if(!u){ u={key,name:row.name,flight:row.flight||'',isTeam:!!row.team,rounds:{}}; units.set(key,u); } if(row.flight&&!u.flight) u.flight=row.flight;
      const val=unit==='strokes'?(basis==='net'&&row.netToPar!=null?row.netToPar:row.toPar):unit==='points'?row.pts:unit==='holes'?row.holesUp:row.pts;
      u.rounds[r.id]={unit,val,n:row.n,thru:row.thru,complete:row.thru==='F'||!!row.over,gross:row.gross,net:row.net,txt:unit==='strokes'?toParTxt(val):unit==='match'?row.status:((unit==='holes'&&val>0?'+':'')+val)}; }); });
  const unit=kinds.length?(new Set(kinds).size>1?'mixed':kinds[0]):'', mixed=unit==='mixed';
  const list=[...units.values()].map(u=>{ const played=rs.filter(r=>u.rounds[r.id]&&u.rounds[r.id].n>0); const total=played.reduce((a,r)=>a+u.rounds[r.id].val,0);
    return Object.assign(u,{played:played.length,total,complete:played.length===rs.length&&played.every(r=>u.rounds[r.id].complete),totalTxt:unit==='strokes'?toParTxt(total):unit==='holes'&&total>0?'+'+total:String(total)}); }).filter(u=>u.played);
  const key=u=>mixed?0:unit==='strokes'?u.total:-u.total;
  list.sort((a,b)=>key(a)-key(b)||b.played-a.played||a.name.localeCompare(b.name));
  const rank=(arr,prop)=>{ let pos=0,prev=null; arr.forEach((u,i)=>{ const k=key(u)*1000+(rs.length-u.played); if(prev===null||k!==prev){ pos=i+1; prev=k; } u[prop]=pos; }); arr.forEach(u=>{ u[prop+'Txt']=(arr.filter(x=>x[prop]===u[prop]).length>1?'T':'')+u[prop]; }); };
  rank(list,'pos'); [...new Set(list.map(u=>u.flight))].forEach(f=>rank(list.filter(u=>u.flight===f),'flightPos'));
  return {rounds:rs,unit,mixed,list,final:rs.length>0&&rs.every(r=>roundEvent(r).status==='final')};
}
/* finishes per flight → the Calcutta lots' places (teams matched by member) */
function sendFinishesToCalcutta(t,R){
  const c=t.calcutta; if(!c||!(c.lots||[]).length){ toast('No Calcutta lots to send to'); return; }
  const byTeam=new Map(); t.field.forEach(p=>{ const a=byTeam.get('T'+(p.team||0))||[]; a.push(p.memberId); byTeam.set('T'+(p.team||0),a); });
  const lotFor=u=>{ const ids=new Set(u.isTeam?(byTeam.get(u.key)||[]):[u.key]); const names=new Set([...ids].map(id=>nameKey(memberName(memberById(id)))));
    return c.lots.find(l=>[l.m1,l.m2].some(id=>id&&ids.has(id))||[l.p1,l.p2].some(n=>n&&names.has(nameKey(n)))); };
  let set=0, miss=[]; R.list.forEach(u=>{ const l=lotFor(u); if(!l){ miss.push(u.name); return; } l.place=u.flightPos; set++; });
  if(!confirm(`Set finishes for ${set} lot${set===1?'':'s'} from the results${miss.length?` (${miss.length} not matched to a lot: ${miss.slice(0,3).join(', ')}${miss.length>3?'…':''})`:''}? Positions are within each flight${R.final?'':' — results are not final yet'}.`)) return;
  persist(); view.ttab='calcutta'; view.ctab='payouts'; render(); toast(`${set} finishes sent to the Calcutta`);
}
