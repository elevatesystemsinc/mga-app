/* =====================================================================
   Club Hub — Tournament rounds & results. A tournament declares its rounds (one or more per day, each with a
   format: e.g. Saturday scramble/shamble split, Sunday best ball); one button builds the scoring events from the
   field (teams come across as the teams, flights copy from the first round); results total the rounds to decide
   the winners overall and per flight, and can be sent to the Calcutta as finishes.
   Flights are set once per tournament (combined Handicap Index, the partner cap applied) and pushed to every
   round's event; day-one groups are built by combined handicap, later days are paired by the standings so far.
   t.rounds=[{id,day,name,format,front,back,teamSize,count,countPattern,scoring,eventId}], t.resultsBasis,
   t.flights={count,names,of:{unitKey:flight},basis:'index',unit,groupSize,perGroup,plan:{flight:{course,start,first,gap,hole}}}
   ===================================================================== */
TT.splice((TT.findIndex(x=>x[0]==='checkin')>=0?TT.findIndex(x=>x[0]==='checkin'):TT.findIndex(x=>x[0]==='field'))+1,0,['rounds','Rounds & results']);
view.rflight='';
const tournamentRounds=t=>{ t.rounds=t.rounds||[]; return t.rounds; };
const roundEvent=r=>r&&r.eventId?golfData().events.find(e=>e.id===r.eventId):null;
const roundDate=(t,day)=>{ const d=parseD(t.startDate); if(!d) return ''; const x=addDays(d,day); return `${x.getFullYear()}-${String(x.getMonth()+1).padStart(2,'0')}-${String(x.getDate()).padStart(2,'0')}`; };
const roundLabel=(t,r)=>r.name||`${dayLabel(t,r.day).split(' · ')[0]} · ${formatSummary(r)}`;
function defaultRounds(t){ const n=Math.max(1,t.days||1), ts=t.teamSize||1;
  return Array.from({length:n},(_,day)=>Object.assign({id:uid(),day,name:'',front:'scramble',back:'shamble',scoring:'net',eventId:''},engineFrom(catalogById(ts>=2?'bestball':'stroke'),ts,1))); }
/* the round's format fields, pushed onto its event */
const ROUND_KEYS=['game','format','front','back','teamSize','count','countPattern','quotaBase','cap','matchScoring','matchForm','matchBy','scoring'];
function roundToEvent(r,ev){ ROUND_KEYS.forEach(k=>{ ev[k]=r[k]; }); if(!ev.allow) ev.allow={}; }

function tRounds(el,t){
  const rs=tournamentRounds(t).slice().sort((a,b)=>a.day-b.day), missing=rs.filter(r=>!roundEvent(r));
  const R=tournamentResults(t,t.resultsBasis||'net');
  rs.forEach(r=>{ const ev=roundEvent(r); if(ev&&CLOUD&&sessionOK&&!golfScores[ev.id]) setTimeout(()=>loadScores(ev),0); publishIfChanged(ev); });
  const rrow=r=>{ const ev=roundEvent(r), n=ev?evPlayers(ev).length:0;
    return `<div class="tr click" data-rnd="${r.id}" style="grid-template-columns:110px minmax(0,1.6fr) minmax(0,1fr) 120px 40px"><span><b>${esc(dayLabel(t,r.day).split(' · ')[0])}</b><br><small class="muted">${esc(dayShort(t,r.day))}</small></span><div class="cell2"><b class="trunc">${esc(roundLabel(t,r))}</b><small>${esc(formatSummary(r))} · ${r.scoring==='net'?'net':'gross'}</small></div>
      <span class="muted" style="font-size:13px">${ev?`${n} players · ${ev.groups.length} groups${ev.flights&&ev.flights.count?' · '+ev.flights.count+' flights':''}`:'Building the scoring event…'}</span><span>${ev?evStatusChip(ev):'<span class="chip">Building…</span>'}</span><span class="ib">${I.edit}</span></div>`; };
  const firstDay=rs.length?Math.min(...rs.map(x=>x.day)):0;
  const act=r=>{ const ev=roundEvent(r); if(!ev) return ''; const first=rs.find(x=>roundEvent(x)&&x!==r), earlier=rs.some(x=>x.day<r.day&&roundEvent(x)), hasF=t.flights&&t.flights.count;
    return `<div class="tr" style="grid-template-columns:110px minmax(0,1fr)"><span></span><div class="actions"><button class="btn sm" data-rgo="${r.id}">Open event</button>
      ${hasF&&!ev.flights.count?`<button class="btn sm" data-raf="${r.id}">Apply flights</button>`:''}
      ${r.day===firstDay||!earlier?`<button class="btn sm${ev.groups.length?'':' pri'}" data-rbh="${r.id}">${ev.groups.length?'Rebuild groups by handicap':'Build groups by handicap'}</button>`:`<button class="btn sm${ev.groups.length?'':' pri'}" data-rbs="${r.id}">${ev.groups.length?'Re-pair by standings':'Pair by standings'}</button>`}
      ${first&&roundEvent(first).groups.length&&!ev.groups.length?`<button class="btn sm" data-rcg="${r.id}">Copy groups from ${esc(dayLabel(t,first.day).split(' · ')[0])}</button>`:''}</div></div>`; };
  const flights=[...new Set(R.list.map(u=>u.flight).filter(Boolean))].sort();
  if(view.rflight&&!flights.includes(view.rflight)) view.rflight='';
  const shown=view.rflight?R.list.filter(u=>u.flight===view.rflight):R.list;
  const cols=`grid-template-columns:48px minmax(0,1.8fr) 60px repeat(${R.rounds.length},88px) 96px`;
  const cell=(u,r)=>{ const x=u.rounds[r.id]; if(!x||!x.n) return '<span class="r muted">—</span>'; return `<span class="r">${esc(x.txt)}${x.complete?'':`<br><small class="muted">thru ${esc(x.thru)}</small>`}</span>`; };
  el.innerHTML=`<div class="card" style="overflow:hidden"><div class="cardhead"><div><h2 class="h2">Rounds</h2><span class="muted">${t.days} day${t.days>1?'s':''} · ${t.teamSize>1?t.teamSize+'-player teams':'individual'} · the field’s ${t.field.length} players</span></div>
      <div class="actions">${rs.length?'':`<button class="btn" id="rndSuggest">Suggest rounds</button>`}<button class="btn" id="rndAdd">${I.plus}Add round</button>${missing.length?`<button class="btn pri" id="rndBuild"${t.field.length?'':' disabled'}>Create scoring event${missing.length>1?'s':''} (${missing.length})</button>`:''}</div></div>
    ${rs.length?`<div class="tw"><div class="t" style="min-width:680px">${rs.map(r=>rrow(r)+act(r)).join('')}</div></div>`:`<div class="empty"><b>No rounds yet</b><span>Declare each day’s format — for example Saturday front nine scramble / back nine shamble, Sunday best ball — each gets a live scoring event the moment it exists. Results below total the rounds.</span></div>`}
    ${!t.field.length&&rs.length?'<div class="banner">Every round has its scoring event, open now. Add the field and the players flow into it as they sign up.</div>':''}</div>
  ${flightsCard(t)}
  <div class="card" style="overflow:hidden"><div class="cardhead"><div><h2 class="h2">Results</h2><span class="muted">${R.rounds.length?`${R.rounds.length} round${R.rounds.length>1?'s':''} totalled${R.unit==='strokes'?' by '+(t.resultsBasis||'net')+' score to par':R.unit==='points'?' by points':R.unit==='holes'?' by holes up':R.unit==='match'?' by match points':''}${R.final?' · <b>Final</b>':R.rounds.length?' · live':''}`:'Results appear once scoring events exist.'}</span></div>
      <div class="actions">${R.unit==='strokes'?`<div class="seg">${['gross','net'].map(b=>`<button class="${(t.resultsBasis||'net')===b?'on':''}" data-rb="${b}">${b==='net'?'Net':'Gross'}</button>`).join('')}</div>`:''}${flights.length?`<div class="seg">${['',...flights].map(f=>`<button class="${view.rflight===f?'on':''}" data-rf="${f}">${f?'Flight '+f:'All'}</button>`).join('')}</div>`:''}${R.list.length?`<button class="btn sm" id="rndPdf">Results sheet (PDF)</button>`:''}${R.list.length&&t.calcutta&&(t.calcutta.lots||[]).length?`<button class="btn sm" id="rndCalc">Send finishes to Calcutta</button>`:''}</div></div>
    ${R.mixed?'<div class="banner">These rounds use different scoring units (strokes, points…), so there is no combined total — each round is shown on its own.</div>':''}
    ${R.list.length?`<div class="tw"><div class="t" style="min-width:${520+R.rounds.length*88}px"><div class="tr th" style="${cols}"><span>Pos</span><span>${R.list[0].isTeam?'Team':'Player'}</span><span>Flt</span>${R.rounds.map(r=>`<span class="r">${esc(dayLabel(t,r.day).split(' · ')[0].slice(0,3))}${rs.filter(x=>x.day===r.day).length>1?' '+(rs.filter(x=>x.day===r.day).indexOf(r)+1):''}</span>`).join('')}<span class="r">Total</span></div>
      ${shown.map(u=>`<div class="tr num" style="${cols}"><b>${view.rflight?u.flightPosTxt:u.posTxt}</b><div class="cell2"><b class="trunc">${esc(u.name)}</b>${u.complete?'':`<small>${u.played} of ${R.rounds.length} rounds</small>`}</div><span class="muted">${esc(u.flight||'')}</span>${R.rounds.map(r=>cell(u,r)).join('')}<b class="r ${R.unit==='strokes'&&u.total<0?'pos':''}" style="font-size:15px">${R.mixed?'—':esc(u.totalTxt)}</b></div>`).join('')}</div></div>`
    :R.rounds.length?'<div class="empty"><span>No scores yet.</span></div>':''}</div>`;
  const sg=$('rndSuggest'); if(sg) sg.onclick=()=>{ t.rounds=defaultRounds(t); persist(); render(); toast(`${t.rounds.length} round${t.rounds.length>1?'s':''} suggested — adjust the formats, then create the events`); };
  $('rndAdd').onclick=()=>editRound(t,null); const bd=$('rndBuild'); if(bd) bd.onclick=()=>createRoundEvents(t);
  el.querySelectorAll('[data-rnd]').forEach(x=>x.onclick=()=>editRound(t,tournamentRounds(t).find(r=>r.id===x.dataset.rnd)));
  el.querySelectorAll('[data-rgo]').forEach(b=>b.onclick=e=>{ e.stopPropagation(); view.geid=roundEvent(tournamentRounds(t).find(r=>r.id===b.dataset.rgo)).id; view.getab='groups'; go('golf'); loadScores(GEV()); });
  el.querySelectorAll('[data-raf]').forEach(b=>b.onclick=e=>{ e.stopPropagation(); const ev=roundEvent(tournamentRounds(t).find(r=>r.id===b.dataset.raf)); applyFlights(t,ev); golfSave(ev); render(); toast('Flights applied'); });
  el.querySelectorAll('[data-rbh]').forEach(b=>b.onclick=e=>{ e.stopPropagation(); const ev=roundEvent(tournamentRounds(t).find(r=>r.id===b.dataset.rbh)); if(!ev.flights.count){ if(t.flights&&t.flights.count){ applyFlights(t,ev); golfSave(ev); } else { toast('Set the tournament’s flights first'); return; } } view.geid=ev.id; buildGroupsFromFlights(ev); });
  el.querySelectorAll('[data-rbs]').forEach(b=>b.onclick=e=>{ e.stopPropagation(); pairByStandings(t,tournamentRounds(t).find(r=>r.id===b.dataset.rbs)); });
  wireFlightsCard(el,t);
  const pdf=$('rndPdf'); if(pdf) pdf.onclick=()=>resultsPDF(t);
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
      `<div class="fld"><span class="lbl">Game</span><select class="inp" id="rdF">${gameOptions(cur.game||catalogOf(cur).id)}</select></div>
       <div id="rdSplit" style="display:${cur.format==='split'?'grid':'none'};grid-template-columns:repeat(2,minmax(0,1fr));gap:12px">${field('Front nine (1–9)','rdFr',cur.front,{type:'select',options:TEAM_FORMATS.map(f=>[f,FORMAT_LABEL[f]])})}${field('Back nine (10–18)','rdBk',cur.back,{type:'select',options:TEAM_FORMATS.map(f=>[f,FORMAT_LABEL[f]])})}</div>
       <div id="rdTeam" style="display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px">${field('Team size','rdTS',cur.teamSize||ts,{type:'select',options:[2,3,4,5,6].map(n=>[n,n+' players'])})}${field('Balls that count','rdCnt',cur.count||1,{type:'select',options:[1,2,3,4,5].map(n=>[n,'Best '+n])})}</div>
       <p class="hint" id="rdHint"></p>`+field('Scored','rdSc',cur.scoring||'net',{type:'select',options:[['net','Net (handicaps)'],['gross','Gross']]})+
      (ev?`<p class="hint">Changes apply to its scoring event too (${esc(ev.name)}). Allowances are edited on the event.</p>`:`<p class="hint">${ts>=2?`Teams come from the field (${ts} players).`:'An individual tournament: team formats form teams in the groups.'}</p>`),
    wire:x=>{ const upd=()=>{ const C=catalogById(x.querySelector('#rdF').value)||catalogById('stroke'), f=C.engine.format, sizes=C.sizes||null, team=!!sizes||f==='split'; x.querySelector('#rdSplit').style.display=f==='split'?'grid':'none'; x.querySelector('#rdTeam').style.display=team?'grid':'none';
        const tsSel=x.querySelector('#rdTS'); [...tsSel.options].forEach(o=>{ o.hidden=sizes?!sizes.includes(+o.value):false; });
        if(C.engine.teamSize){ tsSel.value=C.engine.teamSize; tsSel.disabled=true; } else if(ts>=2&&sizes&&sizes.includes(ts)){ tsSel.value=ts; tsSel.disabled=true; } else { tsSel.disabled=false; if(sizes&&!sizes.includes(+tsSel.value)) tsSel.value=sizes[0]; }
        const n=+tsSel.value; x.querySelector('#rdCnt').parentElement.style.display=C.count?'':'none'; [...x.querySelector('#rdCnt').options].forEach(o=>{ o.disabled=+o.value>=n; }); if(+x.querySelector('#rdCnt').value>=n) x.querySelector('#rdCnt').value=1;
        x.querySelector('#rdHint').textContent=f==='split'?'Front nine and back nine are scored with different team formats; both count toward the round.':(C.desc||''); };
      ['#rdF','#rdTS','#rdFr','#rdBk'].forEach(id=>x.querySelector(id).onchange=upd); upd(); },
    save:()=>{ const C=catalogById(fv('rdF'))||catalogById('stroke'), E=engineFrom(C,+fv('rdTS'),+fv('rdCnt')); if(E.format==='split'){ if(fv('rdFr')===fv('rdBk')){ toast('Front and back use the same format — pick it as the game instead'); return false; } E.teamSize=+fv('rdTS')||2; }
      const d=Object.assign({day:+fv('rdD')||0,name:fv('rdN'),front:fv('rdFr'),back:fv('rdBk'),scoring:fv('rdSc')},E);
      if(r){ Object.assign(r,d); const e=roundEvent(r); if(e){ roundToEvent(r,e); e.date=roundDate(t,r.day)||e.date; golfSave(e); } } else tournamentRounds(t).push(Object.assign({id:uid(),eventId:''},d)); },
    del:r?()=>{ const e=roundEvent(r); if(e&&!confirm(`Remove this round? Its scoring event (${e.name}) stays in Golf.`)) return false; t.rounds=t.rounds.filter(x=>x!==r); }:null,delLabel:'Remove round'});
}
/* build the scoring events: one per round without one, field imported with its teams, later days copying the first day's flights */
/* Every tournament has live scoring from the start: rounds exist as soon as the tournament does, each round has its
   scoring event (open), and the field flows into the events as it changes. ensureTournamentScoring runs on every
   render of a tournament and returns true when it changed something (the caller persists). */
function buildRoundEvent(t,r,rs){
  const G=golfData();
  let slug=slugify(`${t.name}-${t.season}-d${r.day+1}`), n=2; while(G.events.some(e=>e.slug===slug)) slug=slugify(`${t.name}-${t.season}-d${r.day+1}`)+'-'+(n++);
  const ev={id:uid(),status:'live',name:`${t.name} · ${dayLabel(t,r.day).split(' · ')[0]}${rs.filter(x=>x.day===r.day).length>1?' · '+formatSummary(r):''}`,date:roundDate(t,r.day),defaultTee:'White',defaultCourse:'oak',slug,tournamentId:t.id,allow:{},groups:[],pool:[],flights:{count:0,names:[]},createdAt:new Date().toISOString(),roundId:r.id};
  roundToEvent(r,ev);
  G.events.push(ev); r.eventId=ev.id;
  if(t.flights&&t.flights.count) applyFlights(t,ev); else { const first=rs.map(roundEvent).find(e=>e&&e!==ev&&e.flights&&e.flights.count); if(first) copyFlightsInto(first,ev); }
  return ev;
}
/* field → event: new players join the pool with their team; team codes follow the field; players who left the field
   leave the event unless they already have scores */
function syncRoundEvent(t,ev){
  const inField=new Map(t.field.map(fp=>[fp.memberId,fp])), team=fp=>(t.teamSize||1)>1?'T'+(fp.team||0):''; let changed=false;
  const have=new Set(evPlayers(ev).map(x=>x.p.memberId).filter(Boolean));
  for(const fp of t.field){ if(!fp.memberId||have.has(fp.memberId)) continue; const m=memberById(fp.memberId);
    ev.pool.push({id:uid(),memberId:fp.memberId,name:m?memberName(m):(fp.name||'Player'),tee:ev.defaultTee||'White',set:'M',team:team(fp),index:'',flight:''}); have.add(fp.memberId); changed=true; }
  for(const {p,grp} of evPlayers(ev)){ if(!p.memberId) continue; const fp=inField.get(p.memberId);
    if(fp){ if(p.team!==team(fp)){ p.team=team(fp); changed=true; } }
    else { removeEventPlayer(ev,p.id); changed=true; } }   // left the field → off the leaderboard and live scoring, scores and all
  if(changed) ev.groups=ev.groups.filter(g=>g.players.length||!ev.groups.some(o=>o!==g&&o.players.length));
  return changed;
}
function ensureTournamentScoring(t){
  if(!t.rounds||!t.rounds.length){ if(isPast(t)) return false; t.rounds=defaultRounds(t); }   // finished tournaments without rounds stay as they are
  const rs=tournamentRounds(t).slice().sort((a,b)=>a.day-b.day); let changed=false;
  for(const r of rs){ let ev=roundEvent(r); if(!ev){ ev=buildRoundEvent(t,r,rs); changed=true; }
    if(syncRoundEvent(t,ev)||!ev._pub){ publishEvent(ev); changed=changed||!ev._pub; } }
  return changed;
}
function createRoundEvents(t){
  const before=tournamentRounds(t).filter(r=>roundEvent(r)).length, ch=ensureTournamentScoring(t), made=tournamentRounds(t).filter(r=>roundEvent(r)).length-before;
  if(ch) persist(); render();
  toast(made?`${made} scoring event${made===1?'':'s'} created — set flights and groups in Golf`:'Every round already has its event'+(ch?' · field updated':''));
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

/* ---------- flights, once per tournament ----------
   Units are the field's teams (or players) by combined Handicap Index with the partner cap applied; flights are
   whole groups (two teams a foursome) from lowest combined handicap up, then each flight gets a course and a start. */
function tFlightUnits(t){
  const ts=t.teamSize||1, by=new Map();
  const fake={tournamentId:t.id,groups:[],pool:t.field.map(fp=>({id:'f'+fp.id,memberId:fp.memberId,team:ts>1?'T'+(fp.team||0):'',name:'',index:''}))};
  fake.pool.forEach(p=>{ const e=effIndex(fake,p), k=ts>1?p.team:p.memberId; let u=by.get(k); if(!u){ u={key:k,members:[],val:0,missing:false}; by.set(k,u); }
    u.members.push({memberId:p.memberId,idx:e.idx,raw:e.raw,capped:e.capped}); if(e.idx==null) u.missing=true; else u.val+=e.idx; });
  return [...by.values()].map(u=>Object.assign(u,{val:u.missing?null:Math.round(u.val*10)/10,label:u.members.map(m=>memberName(memberById(m.memberId))||'?').join(' / ')}));
}
const tFlightPer=t=>{ const ts=t.teamSize||1; return ts>=3?1:ts===2?2:4; };   // units per group
function setTournamentFlights(t,count){
  const units=tFlightUnits(t), ok=units.filter(u=>u.val!=null).sort((a,b)=>a.val-b.val||a.label.localeCompare(b.label)), per=tFlightPer(t);
  const n=ok.length, G=Math.floor(n/per), left=n%per, k=Math.max(1,Math.min(count,Math.max(1,G))), base=Math.floor(G/k), extra=G%k, names=[], of={}; let i=0;
  for(let f=0;f<k;f++){ const size=(base+(f<extra?1:0))*per+(f===k-1?left:0); names.push(FLIGHT_NAMES[f]); ok.slice(i,i+size).forEach(u=>{ of[u.key]=FLIGHT_NAMES[f]; }); i+=size; }
  const old=t.flights||{}; t.flights={count:k,names,of,basis:'index',unit:(t.teamSize||1)>1?'team':'player',perGroup:per,groupSize:per*(t.teamSize||1),plan:old.plan||{},setAt:new Date().toISOString()}; tFlightPlan(t);
  return {units,missing:units.filter(u=>u.val==null)};
}
function tFlightPlan(t){ const F=t.flights; F.plan=F.plan||{}; (F.names||[]).forEach((n,i)=>{ const p=F.plan[n]=F.plan[n]||{}; if(!p.course) p.course=i<Math.ceil(F.names.length/2)?'oak':'pecan'; if(!p.start) p.start='shotgun'; if(!p.first) p.first='08:30'; if(p.gap==null) p.gap=8; if(!p.hole) p.hole=1; }); return F.plan; }
/* push the tournament's flights onto a round's event: names, plan, perGroup and each player's flight */
function applyFlights(t,ev){ const F=t.flights; if(!F||!F.count) return; const plan=tFlightPlan(t), ts=t.teamSize||1;
  ev.flights={count:F.count,names:F.names.slice(),basis:'index',unit:F.unit,groupSize:F.groupSize,perGroup:F.perGroup,courseOf:Object.fromEntries(F.names.map(n=>[n,plan[n].course])),plan:clone(plan)};
  evPlayers(ev).forEach(x=>{ const k=ts>1?x.p.team:x.p.memberId; x.p.flight=F.of[k]||''; }); }
function flightsCard(t){
  const F=t.flights, units=t.field.length?tFlightUnits(t):[], has=F&&F.count, ts=t.teamSize||1, byF=n=>units.filter(u=>F.of[u.key]===n);
  const capped=units.flatMap(u=>u.members).filter(m=>m.capped).length, missing=units.filter(u=>u.val==null).length;
  const plan=has?tFlightPlan(t):{};
  const rows=has?F.names.map(n=>{ const us=byF(n).sort((a,b)=>a.val-b.val), p=plan[n], tee=p.start==='tee', ng=Math.ceil(us.length/(F.perGroup||2));
    return `<div class="tr num" style="grid-template-columns:70px minmax(0,1fr) 140px 130px 120px 80px 70px 60px"><b>Flight ${n}</b><div class="cell2"><span>${us.length} ${ts>1?'teams':'players'} · ${us.length?fmtH(us[0].val,'index')+' – '+fmtH(us[us.length-1].val,'index'):'—'}</span><small><button class="linkbtn" data-fview="${n}" style="color:var(--gold);text-decoration:underline;font-size:12px">who’s in it</button></small></div>
      <select class="inp" data-tfp="${n}|course" aria-label="Flight ${n} course">${golfData().courses.map(c=>`<option value="${c.id}"${c.id===p.course?' selected':''}>${esc(c.name)}</option>`).join('')}</select>
      <select class="inp" data-tfp="${n}|start" aria-label="Flight ${n} start"><option value="shotgun"${!tee?' selected':''}>Shotgun</option><option value="tee"${tee?' selected':''}>Tee times</option></select>
      <input class="inp num" type="time" data-tfp="${n}|first" value="${esc(p.first)}" aria-label="Flight ${n} first tee time"${tee?'':' disabled'}>
      <input class="inp num r" data-tfp="${n}|gap" value="${esc(p.gap)}" inputmode="numeric" aria-label="Flight ${n} gap"${tee?'':' disabled'}>
      <select class="inp" data-tfp="${n}|hole" aria-label="Flight ${n} off hole"${tee?'':' disabled'}><option value="1"${+p.hole!==10?' selected':''}>1</option><option value="10"${+p.hole===10?' selected':''}>10</option></select>
      <span class="muted" style="font-size:12px">${ng} grp</span></div>`; }).join(''):'';
  return `<div class="card" style="overflow:hidden"><div class="cardhead"><div><h2 class="h2">Flights</h2><span class="muted">${has?`${F.count} flight${F.count>1?'s':''} by combined Handicap Index${t.hcpDiff?` · ${t.hcpDiff}-stroke partner cap${capped?' ('+capped+' capped)':''}`:''} · set ${new Date(F.setAt||Date.now()).toLocaleDateString()}`:`Set once for the whole tournament, by combined Handicap Index${t.hcpDiff?` with the ${t.hcpDiff}-stroke partner cap`:''}; every round’s event uses them.`}</span></div>
      <div class="actions"><div class="fld" style="width:110px;margin:0"><select class="inp" id="tfN" aria-label="Number of flights">${[1,2,3,4,5,6].map(n=>`<option value="${n}"${(has?F.count:2)===n?' selected':''}>${n} flight${n>1?'s':''}</option>`).join('')}</select></div><button class="btn${has?'':' pri'}" id="tfSet"${t.field.length?'':' disabled'}>${has?'Re-flight':'Set flights'}</button>${has&&tournamentRounds(t).some(roundEvent)?`<button class="btn sm" id="tfApply">Apply to all events</button>`:''}</div></div>
    ${missing?`<div class="banner">${missing} ${ts>1?'team':'player'}${missing===1?'':'s'} without a Handicap Index can’t be flighted: ${esc(units.filter(u=>u.val==null).slice(0,5).map(u=>u.label).join(', '))}.</div>`:''}
    ${has?`<div class="tw"><div class="t" style="min-width:820px"><div class="tr th" style="grid-template-columns:70px minmax(0,1fr) 140px 130px 120px 80px 70px 60px"><span>Flight</span><span>${ts>1?'Teams':'Players'}</span><span>Course</span><span>Start</span><span>First tee time</span><span>Gap (min)</span><span>Off hole</span><span></span></div>${rows}</div></div>
      <p class="hint" style="padding:10px 18px 14px;margin:0">Lowest combined handicaps go to Flight A; flights are whole groups so no group mixes flights. Day one groups are built inside each flight from lowest handicap up (shotgun holes 1, 2, 3… or tee times in that order); later days are paired by the standings — leaders go off last with tee times, or take hole 1 on a shotgun.</p>`:''}</div>`;
}
function wireFlightsCard(el,t){
  const st=$('tfSet'); if(st) st.onclick=()=>{ const n=+$('tfN').value||2; if(t.flights&&t.flights.count&&!confirm('Re-flight the tournament? Flight letters may change; apply to the events afterwards.')) return; const r=setTournamentFlights(t,n); persist(); render(); toast(`${t.flights.count} flight${t.flights.count>1?'s':''} set${r.missing.length?` · ${r.missing.length} without an index left out`:''}`); };
  const ap=$('tfApply'); if(ap) ap.onclick=()=>{ let n=0; tournamentRounds(t).forEach(r=>{ const ev=roundEvent(r); if(ev){ applyFlights(t,ev); publishEvent(ev); n++; } }); persist(); render(); toast(`Flights applied to ${n} event${n===1?'':'s'}`); };
  el.querySelectorAll('[data-tfp]').forEach(i=>i.onchange=()=>{ const [n,k]=i.dataset.tfp.split('|'); const p=tFlightPlan(t)[n]; p[k]=k==='gap'||k==='hole'?+i.value:i.value; persist(); render(); });
  el.querySelectorAll('[data-fview]').forEach(b=>b.onclick=()=>{ const n=b.dataset.fview, us=tFlightUnits(t).filter(u=>t.flights.of[u.key]===n).sort((a,b)=>a.val-b.val);
    openDrawer({kicker:t.name,title:'Flight '+n,body:`<div class="mini">${us.map(u=>`<div class="mr num" style="grid-template-columns:minmax(0,1fr) 90px"><div class="cell2"><b>${esc(u.label)}</b><small>${u.members.map(m=>idxTxt(m.idx)+(m.capped?' <span class="muted">(from '+idxTxt(m.raw)+')</span>':'')).join(' + ')}</small></div><b class="r">${fmtH(u.val,'index')}</b></div>`).join('')}</div>`,saveLabel:'Close',save:()=>{}}); });
}
/* ---------- later days: pair by the standings so far ----------
   Within each flight, teams are ordered by their total over the earlier rounds and paired in that order. With tee
   times the leaders go off last; on a shotgun the leaders take hole 1 (then 2, 3…). Groups stay editable. */
function pairByStandings(t,r){
  const ev=roundEvent(r), earlier=tournamentRounds(t).filter(x=>x.day<r.day&&roundEvent(x)); if(!ev) return;
  if(!earlier.length){ toast('No earlier round to pair from'); return; }
  if(!ev.flights||!ev.flights.count){ if(t.flights&&t.flights.count) applyFlights(t,ev); else { toast('Set the tournament’s flights first'); return; } }
  const Rz=tournamentResults(Object.assign({},t,{rounds:earlier}),t.resultsBasis||'net');
  const F=ev.flights, plan=flightPlan(ev), per=F.perGroup||2, ts=t.teamSize||1, byKey=new Map();
  evPlayers(ev).forEach(x=>{ const k=ts>1?x.p.team:x.p.memberId; let a=byKey.get(k); if(!a){ a=[]; byKey.set(k,a); } a.push(x.p); });
  const flightOf=u=>(t.flights&&t.flights.of&&t.flights.of[u.key])||u.flight||((byKey.get(u.key)||[])[0]||{}).flight||'';
  const flights=F.names.map(n=>({name:n,units:[]}));
  Rz.list.forEach((u,i)=>{ const f=flights.find(x=>x.name===flightOf(u)); const ms=(byKey.get(u.key)||[]).map(p=>({p})); if(!f||!ms.length) return; f.units.push({members:ms,val:plan[f.name].start==='tee'?-i:i,label:u.name,rank:i+1}); });
  const seen=new Set(flights.flatMap(f=>f.units.flatMap(u=>u.members.map(m=>m.p.id))));
  for(const [k,ps] of byKey){ if(ps.every(p=>seen.has(p.id))) continue; const f=flights.find(x=>x.name===ps[0].flight)||flights[flights.length-1]; f.units.push({members:ps.map(p=>({p})),val:plan[f.name].start==='tee'?-(999):999,label:ps.map(p=>p.name).join(' / '),rank:null}); }
  const gs=buildFlightGroups(ev,{flights},per,F.courseOf||'split','shotgun',plan);
  const summary=flights.map(f=>{ const fg=gs.filter(x=>x.flight===f.name), tee=plan[f.name].start==='tee'; return `<div class="mr num" style="grid-template-columns:70px minmax(0,1fr)"><b>Flight ${f.name}</b><div class="cell2"><span>${fg.length} groups · ${courseById(plan[f.name].course)?.name||''} · ${tee?'tee times, leaders last':'shotgun, leaders on hole '+((fg[0]||{}).startHole||1)}</span><small>${esc(f.units.slice(0,3).map(u=>(u.rank?u.rank+'. ':'')+u.label).join(' · '))}${f.units.length>3?' …':''}</small></div></div>`; }).join('');
  openDrawer({kicker:`${t.name} · ${dayLabel(t,r.day).split(' · ')[0]}`,title:'Pair by standings',saveLabel:ev.groups.length?'Replace groups':'Build groups',
    body:`<p style="margin:0">Standings after ${earlier.length} round${earlier.length>1?'s':''} (${t.resultsBasis||'net'}): teams are paired in order inside each flight.</p><div class="mini">${summary}</div><p class="hint">Groups can be edited afterwards on the event’s Groups tab.</p>`,
    save:()=>{ ev.groups=gs.map(({flight,...g})=>g); ev.pool=[]; golfSave(ev); toast(`${ev.groups.length} groups paired by standings`); }});
}
/* ---------- results sheet (PDF) ---------- */
async function resultsPDF(t,opt){
  opt=opt||{}; const R=tournamentResults(t,t.resultsBasis||'net'); if(!R.list.length){ toast('No results yet'); return; }
  try{ await loadJsPDF(); }catch(e){ toast(e.message); return; }
  const crest=await crestPNG().catch(()=>null), doc=new window.jspdf.jsPDF({unit:'pt',format:'letter'});
  [['ps400','PS-400.ttf','PublicSans','normal'],['ps700','PS-700.ttf','PublicSans','bold'],['ps800','PS-800.ttf','PublicSansXB','normal'],['cg700','CG-700.ttf','Cormorant','bold']].forEach(([k,f,fam,st])=>{ doc.addFileToVFS(f,PDF_FONTS[k]); doc.addFont(f,fam,st); });
  const NAVY=[15,42,56],GOLD=[199,161,58],GOLDL=[216,183,95],GOLDDK=[126,95,26],IVORY=[251,250,245],LINE=[225,217,198],INK=[20,34,43],MUTED=[86,98,106],POS=[31,107,74];
  const L=40,R2=572,W=612,H=792, font=(f,s,z,c)=>{ doc.setFont(f,s); doc.setFontSize(z); doc.setTextColor(...c); };
  const page=()=>{ doc.setFillColor(...IVORY); doc.rect(0,0,W,H,'F'); };
  const rounds=R.rounds, rl=r=>dayLabel(t,r.day).split(' · ')[0].slice(0,3)+(rounds.filter(x=>x.day===r.day).length>1?' '+(rounds.filter(x=>x.day===r.day).indexOf(r)+1):'');
  const cw=Math.min(62,Math.floor(170/Math.max(1,rounds.length))), nameW=R2-L-44-40-rounds.length*cw-66;
  page();
  font('PublicSans','normal',8.4,[214,218,220]); const sub=doc.splitTextToSize(`${dateRange(t)} · ${rounds.map(r=>`${dayLabel(t,r.day).split(' · ')[0]}: ${formatSummary(r)}`).join(' · ')} · ${R.unit==='strokes'?(t.resultsBasis||'net')+' to par':R.unit}${R.final?'':' · as of '+new Date().toLocaleString()}`,R2-L-90);
  const bandH=74+Math.max(0,sub.length-1)*11;
  doc.setFillColor(...GOLD); doc.roundedRect(L,32,R2-L,bandH+4,8,8,'F'); doc.setFillColor(...NAVY); doc.roundedRect(L,32,R2-L,bandH,8,8,'F'); doc.rect(L,32+bandH-12,R2-L,8,'F');
  if(crest) doc.addImage(crest,'PNG',L+16,42,54*914/1180,54);
  font('PublicSansXB','normal',6.8,GOLDL); doc.text(`${(orgName()||'').toUpperCase()} · ${t.season||''}`,L+76,56,{charSpace:1.2});
  font('Cormorant','bold',24,[255,255,255]); doc.text(`${t.name} — ${R.final?'Final Results':'Results'}`,L+76,80);
  font('PublicSans','normal',8.4,[214,218,220]); doc.text(sub,L+76,96);
  let y=32+bandH+26;
  const flights=[...new Set(R.list.map(u=>u.flight))].sort((a,b)=>(a||'~').localeCompare(b||'~'));
  const head=label=>{ if(y>H-80){ doc.addPage(); page(); y=48; } font('PublicSansXB','normal',7.4,GOLDDK); doc.text(label.toUpperCase(),L,y,{charSpace:1.1}); y+=6; doc.setDrawColor(...GOLD); doc.setLineWidth(1); doc.line(L,y,R2,y); y+=12;
    font('PublicSans','bold',7.6,MUTED); doc.text('POS',L,y); doc.text(R.list[0].isTeam?'TEAM':'PLAYER',L+30,y); let x=L+30+nameW; rounds.forEach(r=>{ doc.text(rl(r).toUpperCase(),x+cw-2,y,{align:'right'}); x+=cw; }); doc.text('TOTAL',R2-2,y,{align:'right'}); y+=10; };
  const row=(u,pos,i)=>{ if(y>H-40){ doc.addPage(); page(); y=48; head('continued'); }
    if(i%2===0){ doc.setFillColor(255,255,255); doc.rect(L-4,y-9,R2-L+8,15,'F'); }
    font('PublicSans','bold',9.4,pos.startsWith('1')&&!pos.startsWith('1'+'0')&&pos.replace('T','')==='1'?GOLDDK:INK); doc.text(pos,L,y);
    font('PublicSans',pos.replace('T','')==='1'?'bold':'normal',9.4,INK); doc.text(doc.splitTextToSize(u.name,nameW-6)[0],L+30,y);
    let x=L+30+nameW; font('PublicSans','normal',9,u.complete?INK:MUTED); rounds.forEach(r=>{ const c=u.rounds[r.id]; doc.text(c&&c.n?c.txt+(c.complete?'':'*'):'—',x+cw-2,y,{align:'right'}); x+=cw; });
    font('PublicSans','bold',10,R.unit==='strokes'&&u.total<0?POS:INK); doc.text(R.mixed?'—':u.totalTxt,R2-2,y,{align:'right'}); y+=15; };
  flights.forEach(f=>{ const us=R.list.filter(u=>u.flight===f); head(f?`Flight ${f}`:'Results'); us.forEach((u,i)=>row(u,f?u.flightPosTxt:u.posTxt,i)); y+=10; });
  if(flights.length>1){ head('Overall'); R.list.slice(0,Math.min(R.list.length,15)).forEach((u,i)=>row(u,u.posTxt,i)); y+=6; }
  font('PublicSans','normal',7.6,MUTED); doc.text(`${R.list.some(u=>!u.complete)?'* round not finished · ':''}Ties share a position. ${t.hcpDiff?`Partner handicap differential cap: ${t.hcpDiff} strokes. `:''}Generated by the ${orgShort()} hub, ${new Date().toLocaleString()}.`,L,H-28,{maxWidth:R2-L});
  if(opt.returnDoc) return doc;
  doc.save(`${slugify(t.name)}-results${R.final?'-final':''}.pdf`); toast('Results sheet downloaded');
}
