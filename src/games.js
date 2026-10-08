/* =====================================================================
   Club Hub — Games (small groups). The regular game: who played, live scoring through the Golf module, and any
   number of pots running at once — the main game paid by finish, skins, dots, a side pot scored another way
   (low net, a blind-draw best ball…) or hand-entered winners (closest to the pin). The season Ledger totals it all.
   Data (group document):
     db.games=[{id,season,date,time,name,course,net,game,format…(engine fields),status:'open'|'settled',notes,golfEventId,
                players:[{id,memberId,name,paid,extraIn,gpid}],          gpid = the player's id in the scoring event
                pots:[{id,kind:'finish'|'skins'|'dots'|'format'|'manual',name,entry,inn:{pid:true},rules:{…},
                       payouts:[{id,pid,amount,note}],teams:{gpid:'S1'},tally:{pid:{Sandy:1}}}]}]
     db.ledgerAdj=[{id,season,date,memberId,amount,desc}]                 side bets, settle-ups, corrections
   A player's in = Σ entries of the pots they are in (+ extras); out = Σ payouts; net = out − in (+ adjustments).
   ===================================================================== */
I.trophy=svg('<path d="M8 4h8v5a4 4 0 01-8 0z"/><path d="M8 6H5a3 3 0 003 3M16 6h3a3 3 0 01-3 3"/><path d="M12 13v4M9 20h6"/>');
I.cash=svg('<rect x="3" y="6" width="18" height="12" rx="2"/><circle cx="12" cy="12" r="2.5"/><path d="M7 12h.01M17 12h.01"/>');
NAV.splice(1,0,['games','Games',I.trophy],['ledger','Ledger',I.cash]);
ORG_NAV.group=['dash','games','ledger','tournaments','golf','members'];   // small groups run their own tournaments too
view.gameId=null; view.lrange='season';
const isGroup=()=>!!db&&db.kind==='group';
const POT_KINDS={finish:'By finish',skins:'Skins',dots:'Dots / doodah',format:'Side game',manual:'Winners by hand'};
function gamesData(){
  db.games=db.games||[]; db.ledgerAdj=db.ledgerAdj||[];
  for(const g of db.games){ g.players=g.players||[];
    if(!g.pots){   // games from before pots: entry → the main pot, skins entry → a skins pot, old payouts by kind
      g.pots=[]; const inAll=Object.fromEntries(g.players.map(p=>[p.id,true]));
      g.pots.push({id:uid(),kind:'finish',name:'Main game',entry:n0(g.entry),inn:inAll,rules:{},payouts:(g.payouts||[]).filter(x=>x.kind==='places').map(x=>({id:x.id,pid:x.pid,amount:x.amount,note:x.note}))});
      if(n0(g.skinsEntry)||(g.payouts||[]).some(x=>x.kind==='skins')) g.pots.push({id:uid(),kind:'skins',name:'Skins',entry:n0(g.skinsEntry),inn:Object.fromEntries(g.players.filter(p=>p.inSkins!==false).map(p=>[p.id,true])),rules:g.skinsRules||{},payouts:(g.payouts||[]).filter(x=>x.kind==='skins').map(x=>({id:x.id,pid:x.pid,amount:x.amount,note:x.note}))});
      const man=(g.payouts||[]).filter(x=>x.kind==='manual'); if(man.length) g.pots.push({id:uid(),kind:'manual',name:'Other payouts',entry:0,inn:{},rules:{},payouts:man.map(x=>({id:x.id,pid:x.pid,amount:x.amount,note:x.note}))});
      delete g.payouts; }
    g.pots.forEach(p=>{ p.inn=p.inn||{}; p.payouts=p.payouts||[]; p.rules=p.rules||{}; }); }
  return db.games;
}
const seasonGames=()=>gamesData().filter(g=>g.season===Y()).sort((a,b)=>(b.date||'').localeCompare(a.date||'')||(b.time||'').localeCompare(a.time||''));
const GAME=()=>gamesData().find(g=>g.id===view.gameId);
const gMoney=v=>Math.abs(n0(v)-Math.round(n0(v)))<0.005?fmt(v):fmt2(v);
const gSigned=v=>n0(v)>0.004?'+'+gMoney(v):n0(v)<-0.004?'−'+gMoney(Math.abs(v)):gMoney(0);
const gpName=p=>p.memberId?(memberName(memberById(p.memberId))||p.name||'Member'):(p.name||'Guest');
const potIn=(pot,p)=>!!pot.inn[p.id];
const potTotal=(g,pot)=>sum(g.players.filter(p=>potIn(pot,p)),()=>n0(pot.entry));
const potPaid=pot=>sum(pot.payouts,x=>x.amount);
const gpIn=(g,p)=>sum(g.pots.filter(pot=>potIn(pot,p)),pot=>n0(pot.entry))+n0(p.extraIn);
const gpOut=(g,p)=>sum(g.pots,pot=>sum(pot.payouts.filter(x=>x.pid===p.id),x=>x.amount));
const mainPot=g=>g.pots.find(p=>p.kind==='finish')||g.pots[0];
function gameMoney(g){ const total=sum(g.pots,pot=>potTotal(g,pot))+sum(g.players,p=>n0(p.extraIn)), paid=sum(g.pots,potPaid);
  return {total,paid,left:total-paid,unpaid:g.players.filter(p=>!p.paid&&gpIn(g,p)>0).length,entry:n0((mainPot(g)||{}).entry)}; }
const gameEvent=g=>g&&g.golfEventId?golfData().events.find(e=>e.id===g.golfEventId):null;
const gameTitle=g=>g.name||(orgShort()+' game');
const gameName=g=>(catalogById(g.game)||{}).name||FORMAT_LABEL[g.format||'stroke']||'Stroke play';
const gameWhen=g=>(g.date?shortDate(g.date):'Date TBD')+(g.time?' · '+fmtTime(g.time):'');
const isUpcoming=g=>{ const d=parseD(g.date); if(!d) return true; const now=new Date(); now.setHours(0,0,0,0); return d>=now; };
function newPot(kind,name,entry,g,extra){ return Object.assign({id:uid(),kind,name:name||POT_KINDS[kind],entry:n0(entry),inn:Object.fromEntries((g?g.players:[]).map(p=>[p.id,true])),rules:{},payouts:[]},extra||{}); }

/* ---------- season ledger ---------- */
const QUARTERS=[['season','Season'],['q1','Q1'],['q2','Q2'],['q3','Q3'],['q4','Q4']];
function inRange(dateStr,range){ if(!range||range==='season') return true; const d=parseD(dateStr); if(!d) return false; return 'q'+(Math.floor(d.getMonth()/3)+1)===range; }
function ledgerRows(range){
  const R=new Map(); const row=(k,name)=>{ let r=R.get(k); if(!r){ r={key:k,name,games:0,inn:0,out:0,adj:0,last:''}; R.set(k,r); } if(!r.name&&name) r.name=name; return r; };
  for(const g of seasonGames()){ if(!inRange(g.date,range)) continue;
    for(const p of g.players){ const r=row(p.memberId||('guest:'+(p.name||'').trim().toLowerCase()),gpName(p)); r.memberId=p.memberId||''; r.games++; r.inn+=gpIn(g,p); r.out+=gpOut(g,p); if((g.date||'')>r.last) r.last=g.date||''; } }
  for(const a of db.ledgerAdj||[]){ if(a.season!==Y()||!inRange(a.date,range)) continue; const r=row(a.memberId,memberName(memberById(a.memberId))); r.memberId=a.memberId; r.adj+=n0(a.amount); }
  return [...R.values()].map(r=>Object.assign(r,{net:r.out-r.inn+r.adj})).sort((a,b)=>b.net-a.net||a.name.localeCompare(b.name));
}

/* ---------- Games list ---------- */
function vGames(m){
  gamesData();
  if(view.gameId&&GAME()) return vGame(m,GAME());
  view.gameId=null;
  const gs=seasonGames(), up=gs.filter(isUpcoming).reverse(), past=gs.filter(g=>!isUpcoming(g));
  const tot=gs.reduce((a,g)=>{ a.money+=gameMoney(g).total; a.players+=g.players.length; return a; },{money:0,players:0});
  const cols='grid-template-columns:120px minmax(0,1.5fr) minmax(0,1fr) 80px 100px 110px 40px';
  const row=g=>{ const mo=gameMoney(g), ev=gameEvent(g); return `<div class="tr num click" data-game="${g.id}" style="${cols}"><span>${g.date?shortDate(g.date).replace(/, \d{4}$/,''):'TBD'}${g.time?`<br><small class="muted">${fmtTime(g.time)}</small>`:''}</span><div class="cell2"><b class="trunc" style="color:var(--navy)">${esc(gameTitle(g))}</b><small class="trunc">${esc(gameName(g))}${g.pots.length>1?' + '+g.pots.slice(1).map(p=>p.name.toLowerCase()).join(', '):''}${ev&&ev.status==='live'?' · <span class="pos">● live</span>':''}</small></div><span class="muted">${g.players.length} player${g.players.length===1?'':'s'}${mo.unpaid?` · <span class="neg">${mo.unpaid} unpaid</span>`:''}</span><span class="r">${gMoney(mo.entry)}</span><span class="r">${gMoney(mo.total)}</span><span>${g.status==='settled'?'<span class="chip navy">Settled</span>':Math.abs(mo.left)>0.004&&!isUpcoming(g)?`<span class="chip warn">${gMoney(mo.left)} to pay out</span>`:isUpcoming(g)?'<span class="chip">Upcoming</span>':'<span class="chip ok">Paid out</span>'}</span><span class="ib">${I.chev}</span></div>`; };
  m.innerHTML=head('Games',`The ${esc(orgShort())}’s ${Y()} season: who played, what went in, what was paid out.`,btn('New game','gmNew','pri',I.plus))+`
  <div class="grid g3">${kpi('Games this season',String(gs.length),`${past.length} played · ${up.length} upcoming`)}${kpi('Money through the group',gMoney(tot.money),'every pot, all games')}${kpi('Player-games',String(tot.players),gs.length?`${(tot.players/gs.length).toFixed(1)} players a game`:'')}</div>
  <div class="card" style="overflow:hidden">${gs.length?`<div class="tw"><div class="t" style="min-width:760px"><div class="tr th" style="${cols}"><span>Date</span><span>Game</span><span>Players</span><span class="r">Entry</span><span class="r">Pots</span><span>Status</span><span></span></div>${up.concat(past).map(row).join('')}</div></div>`
  :`<div class="empty"><b>No games yet</b><span>Set up the regular game: date, course, the game and the entry. Add who’s playing, open live scoring, add skins or dots alongside, then pay out.</span><button class="btn pri" id="gmNew2">${I.plus}New game</button></div>`}</div>`;
  $('gmNew').onclick=()=>editGame(null); const n2=$('gmNew2'); if(n2) n2.onclick=()=>editGame(null);
  m.querySelectorAll('[data-game]').forEach(r=>r.onclick=()=>{ view.gameId=r.dataset.game; render(); });
}
function editGame(g){
  const last=seasonGames().find(x=>x!==g), courses=golfData().courses, today=new Date().toISOString().slice(0,10), mp=g?mainPot(g):null, lastMp=last?mainPot(last):null, lastSk=last?last.pots.find(p=>p.kind==='skins'):null;
  openDrawer({kicker:orgShort()+' · Game',title:g?'Game details':'New game',saveLabel:g?'Save':'Create game',
    body:field('Name','gmN',g?g.name:(last?last.name:''),{ph:'e.g. Friday game'})+pair(field('Date','gmD',g?g.date:today,{type:'date'}),field('Tee time','gmT',g?g.time:(last?last.time||'':''),{type:'time'}))+
      pair(field('Course','gmC',g?g.course:(last?last.course:'oak'),{type:'select',options:courses.map(c=>[c.id,c.name])}),field('Scored','gmNet',g?(g.net?'net':'gross'):(last&&last.net?'net':'gross'),{type:'select',options:[['gross','Gross'],['net','Net (handicaps)']]}))+
      `<div class="fld"><label class="lbl" for="gmF">Game</label><select class="inp" id="gmF">${gameOptions(g?(g.game||g.format||'stroke'):(last?(last.game||last.format||'stroke'):'stroke'))}</select><p class="hint">The main game — paid by finish from its leaderboard. Team games need partners: draw them from the game once scoring is open. Skins, dots and other pots are added on the game.</p></div>`+
      pair(field('Entry per player $ (main pot)','gmE',mp?mp.entry:(lastMp?lastMp.entry:20),{type:'number'}),g?'':field('Skins per player $ (0 = none)','gmS',lastSk?lastSk.entry:0,{type:'number'}))+
      field('Notes','gmNt',g?.notes||'',{type:'textarea'}),
    save:()=>{ const C=catalogById(fv('gmF'))||catalogById('stroke'), E=engineFrom(C,C.sizes?C.sizes[0]:1,1);
      const data=Object.assign({name:fv('gmN'),date:fv('gmD'),time:fv('gmT'),course:fv('gmC'),net:fv('gmNet')==='net',notes:fv('gmNt')},E);
      if(g){ Object.assign(g,data); if(mp) mp.entry=fnum('gmE'); const ev=gameEvent(g); if(ev){ ev.date=g.date; ev.scoring=g.net?'net':'gross'; EV_GAME_KEYS.forEach(k=>{ ev[k]=g[k]; }); golfSave(ev); } }
      else { const n=Object.assign({id:uid(),season:Y(),status:'open',players:[],pots:[],golfEventId:''},data); n.pots.push(newPot('finish','Main game',fnum('gmE'),n)); if(fnum('gmS')>0) n.pots.push(newPot('skins','Skins',fnum('gmS'),n)); gamesData().push(n); view.gameId=n.id; publishEvent(ensureGameEvent(n));
        if(last&&last.players.length) setTimeout(()=>{ if(confirm(`Start with the ${last.players.length} players from ${gameTitle(last)} on ${shortDate(last.date)}?`)){ last.players.forEach(p=>addPlayer(n,{memberId:p.memberId,name:p.name})); persist(); render(); } },50); } },
    del:g?()=>{ if(!confirm(`Delete ${gameTitle(g)} on ${shortDate(g.date)}? Its money record goes with it.`)) return false; const ev=gameEvent(g); if(ev&&confirm('Also delete its scoring event and scores?')){ golfData().events=golfData().events.filter(e=>e!==ev); if(CLOUD&&sessionOK) deleteEventRow(ev.id); }
      db.games=db.games.filter(x=>x!==g); view.gameId=null; }:null,delLabel:'Delete game'});
}
function addPlayer(g,o){ const p={id:uid(),memberId:o.memberId||'',name:o.name||'',paid:false,extraIn:0,gpid:''}; g.players.push(p); g.pots.forEach(pot=>{ if(pot.kind!=='manual') pot.inn[p.id]=true; }); return p; }

/* ---------- one game ---------- */
function vGame(m,g){
  let ev=gameEvent(g); if(!ev){ ev=ensureGameEvent(g); golfSave(ev); }
  const mo=gameMoney(g), live=ev.status==='live';
  if(ev&&CLOUD&&sessionOK&&!golfScores[ev.id]) setTimeout(()=>loadScores(ev),0);
  const lb=ev?eventBoard(publicEvent(ev),scoresFor(ev),{sort:g.net?'net':'gross'}):[];
  const byG=new Map(); lb.forEach(r=>{ if(r.team) (r.members||[]).forEach(id=>byG.set(id,r)); else byG.set(r.id,r); });
  const pcols='grid-template-columns:minmax(0,1.6fr) 90px 80px 90px 90px 90px 40px';
  const scoreTxt=r=>r.unit==='points'?r.pts+' <small class="muted">pts</small>':r.unit==='holes'?(r.holesUp>0?'+':'')+r.holesUp:r.unit==='match'?esc(r.status):(g.net&&r.net!=null?r.net+' <small class="muted">net</small>':r.gross);
  const prow=p=>{ const r=byG.get(p.gpid), inn=gpIn(g,p), out=gpOut(g,p); return `<div class="tr num click" data-gp="${p.id}" style="${pcols}"><div class="cell2"><b class="trunc">${esc(gpName(p))}</b><small>${p.memberId?'':'Guest · '}${g.pots.filter(pot=>pot.kind!=='finish'&&potIn(pot,p)).map(pot=>pot.name.toLowerCase()).join(' · ')}</small></div><span>${r&&r.n?`<b>${r.posTxt}</b> <small class="muted">${r.thru==='F'?'F':'thru '+r.thru}</small>${r.team?'<br><small class="muted">team</small>':''}`:'<span class="muted">—</span>'}</span><span class="r">${r&&r.n?scoreTxt(r):'<span class="muted">—</span>'}</span><span>${inn?(p.paid?'<span class="chip ok">Paid</span>':`<span class="chip warn">Owes ${gMoney(inn)}</span>`):'<span class="muted">—</span>'}</span><span class="r">${gMoney(inn)}</span><span class="r ${out>0?'pos':''}">${out?gMoney(out):'—'}</span><span class="ib">${I.edit}</span></div>`; };
  const link=ev?scoringLink(ev):'';
  const potRow=pot=>{ const tot=potTotal(g,pot), paid=potPaid(pot), inN=g.players.filter(p=>potIn(pot,p)).length, left=tot-paid;
    const payBtn=pot.kind==='finish'?`<button class="btn sm pri" data-pay="${pot.id}">Pay by finish</button>`:pot.kind==='skins'?`<button class="btn sm pri" data-pay="${pot.id}">Pay skins</button>`:pot.kind==='dots'?`<button class="btn sm pri" data-pay="${pot.id}">Tally &amp; pay</button>`:pot.kind==='format'?`<button class="btn sm pri" data-pay="${pot.id}">Score &amp; pay</button>`:`<button class="btn sm pri" data-pay="${pot.id}">${I.plus}Winner</button>`;
    const rules=pot.kind==='skins'?skinsRuleText(SKINS_DEFAULT(g,pot)):pot.kind==='format'?(catalogById(pot.rules.game)||{}).name||'':pot.kind==='dots'?dotsRuleText(pot):'';
    return `<div class="tr" style="grid-template-columns:minmax(0,1.5fr) 90px 90px 90px minmax(0,1.6fr) auto"><div class="cell2"><b>${esc(pot.name)}</b><small>${POT_KINDS[pot.kind]}${rules?' · '+esc(rules):''}${pot.kind==='manual'?'':` · ${inN} in${pot.entry?' × '+gMoney(pot.entry):''}`}</small></div><span class="r num">${pot.kind==='manual'?'—':gMoney(tot)}</span><span class="r num ${paid?'pos':''}">${paid?gMoney(paid):'—'}</span><span class="r num ${left>0.004&&tot?'':left<-0.004?'neg':'muted'}">${pot.kind==='manual'?'':Math.abs(left)>0.004?gMoney(left):'—'}</span>
      <span style="font-size:12.5px">${pot.payouts.length?pot.payouts.slice().sort((a,b)=>b.amount-a.amount).slice(0,3).map(x=>{ const p=g.players.find(y=>y.id===x.pid); return `${esc(p?gpName(p).split(' ')[0]:'—')} ${gMoney(x.amount)}`; }).join(' · ')+(pot.payouts.length>3?' …':''):'<span class="muted">not paid out</span>'}</span>
      <div class="actions" style="gap:6px">${payBtn}<button class="btn sm" data-pot="${pot.id}">${I.edit}</button></div></div>`; };
  m.innerHTML=`<div class="crumb"><button id="gmBack">Games</button><span class="muted">/</span><span class="muted">${esc(gameTitle(g))}</span></div>
  <div class="phead"><div><h1 class="h1">${esc(gameTitle(g))}</h1><div style="display:flex;gap:8px;margin-top:12px;flex-wrap:wrap"><span class="chip navy">${esc(gameWhen(g))}</span><span class="chip">${esc(courseById(g.course)?.name||'Course TBD')}</span><span class="chip">${esc(gameName(g))} · ${g.net?'net':'gross'}</span>${g.pots.filter(p=>p.kind!=='finish').map(p=>`<span class="chip gold">${esc(p.name)}</span>`).join('')}${g.status==='settled'?'<span class="chip navy">Settled</span>':''}${live?'<span class="chip ok">● Live scoring</span>':''}</div></div>
    <div class="actions">${g.status==='settled'?'<button class="btn" id="gmReopen">Reopen</button>':'<button class="btn" id="gmSettle" title="Everything is paid out and recorded">Mark settled</button>'}<button class="btn" id="gmEdit">${I.edit}Details</button></div></div>
  <div class="grid g4">${kpi('Players',String(g.players.length),mo.unpaid?`<span class="neg">${mo.unpaid} still owe</span>`:g.players.length?'all paid in':'add who’s playing')}${kpi('In the pots',gMoney(mo.total),g.pots.filter(p=>p.kind!=='manual').map(p=>`${esc(p.name)} ${gMoney(potTotal(g,p))}`).join(' · ')||'no pots')}${kpi('Paid out',gMoney(mo.paid),`${sum(g.pots,p=>p.payouts.length)} payout${sum(g.pots,p=>p.payouts.length)===1?'':'s'}`)}${kpi(mo.left>0.004?'Still to pay out':mo.left<-0.004?'Paid out over the pots':'Balance',gMoney(Math.abs(mo.left)),mo.left>0.004?'allocate it below':mo.left<-0.004?'check the payouts':'pots fully paid out',mo.left<-0.004?'neg':mo.left>0.004?'':'pos')}</div>
  <div class="card" style="overflow:hidden"><div class="cardhead"><h2 class="h2">Players</h2><div class="actions"><button class="btn sm" id="gmAllPaid">Mark all paid</button><button class="btn sm pri" id="gmAdd">${I.plus}Add players</button></div></div>
    ${g.players.length?`<div class="tw"><div class="t" style="min-width:740px"><div class="tr th" style="${pcols}"><span>Player</span><span>Finish</span><span class="r">Score</span><span>Entry</span><span class="r">In</span><span class="r">Won</span><span></span></div>${g.players.slice().sort((a,b)=>((byG.get(a.gpid)||{}).pos||99)-((byG.get(b.gpid)||{}).pos||99)||gpName(a).localeCompare(gpName(b))).map(prow).join('')}</div></div>`:'<div class="empty"><b>Nobody in yet</b><span>Add the regulars from the member list, or a guest by name.</span></div>'}</div>
  <div class="card" style="overflow:hidden"><div class="cardhead"><div><h2 class="h2">Pots</h2><span class="muted">Each pot has its own entry, players and payouts; the ledger adds them all up.</span></div><div class="actions"><button class="btn sm pri" id="gmAddPot">${I.plus}Add pot</button></div></div>
    <div class="tw"><div class="t" style="min-width:820px"><div class="tr th" style="grid-template-columns:minmax(0,1.5fr) 90px 90px 90px minmax(0,1.6fr) auto"><span>Pot</span><span class="r">In</span><span class="r">Paid out</span><span class="r">Left</span><span>Payouts</span><span></span></div>${g.pots.map(potRow).join('')}</div></div></div>
  <div class="card pad" style="display:flex;flex-direction:column;gap:12px"><div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px"><h2 class="h2">Live scoring</h2>${ev?(live?'<button class="btn sm" id="gmClose">Close scoring</button>':'<button class="btn sm" id="gmOpen">Reopen scoring</button>'):''}</div>
    ${ev?`<div class="cell2"><span class="lbl">Scoring link — players enter their group ID</span><a href="${esc(link)}" target="_blank" rel="noopener" class="trunc" style="font-weight:600">${esc(link)}</a></div>
      <div class="actions"><button class="btn sm" id="gmCopy">Copy link</button><a class="btn sm" href="${esc(link)}&view=board" target="_blank" rel="noopener">Leaderboard screen</a><button class="btn sm" id="gmSync">Update groups</button>${enabledGames().some(x=>x.tool)?`<button class="btn sm" id="gmDraw">Draw partners</button>`:''}</div>
      <div class="mini">${ev.groups.map(grp=>`<div class="mr" style="grid-template-columns:minmax(0,1fr) auto"><div class="cell2"><b>Group ${esc(grp.code)}</b><small>${esc(grp.players.map(p=>p.name.split(' ')[0]).join(', '))}</small></div><button class="btn sm" data-gsheet="${grp.id}">Enter scores</button></div>`).join('')}</div>
      <p class="hint">Players in groups of four; each group types its ID on the scoring page. Enter scores here for anyone who doesn’t.</p>`
    :`<p class="muted" style="margin:0">Open live scoring and every player gets a group ID for the scoring page on their phone. Finish, skins and dots then come straight from the scores.</p><div class="actions"><button class="btn pri" id="gmOpen"${g.players.length?'':' disabled'}>Open live scoring</button></div>`}</div>
  ${g.notes?`<div class="card pad"><span class="lbl">Notes</span><p style="margin:6px 0 0;white-space:pre-wrap">${esc(g.notes)}</p></div>`:''}`;
  $('gmBack').onclick=()=>{ view.gameId=null; render(); }; $('gmEdit').onclick=()=>editGame(g);
  $('gmAdd').onclick=()=>addGamePlayers(g); $('gmAllPaid').onclick=()=>{ g.players.forEach(p=>p.paid=true); persist(); render(); toast('Everyone marked paid'); };
  const st=$('gmSettle'); if(st) st.onclick=()=>{ if(Math.abs(mo.left)>0.004&&!confirm(`${gMoney(Math.abs(mo.left))} ${mo.left>0?'is still unallocated':'over the pots'}. Mark settled anyway?`)) return; g.status='settled'; persist(); render(); };
  const ro=$('gmReopen'); if(ro) ro.onclick=()=>{ g.status='open'; persist(); render(); };
  const op=$('gmOpen'); if(op) op.onclick=()=>openScoring(g);
  const cl=$('gmClose'); if(cl) cl.onclick=()=>{ ev.status='final'; golfSave(ev); render(); toast('Scoring closed'); };
  const cp=$('gmCopy'); if(cp) cp.onclick=async()=>{ try{ await navigator.clipboard.writeText(link); toast('Link copied'); }catch(_){ prompt('Copy this link:',link); } };
  const sy=$('gmSync'); if(sy) sy.onclick=()=>{ syncGameEvent(g,ev); golfSave(ev); render(); toast('Groups updated'); };
  const dw=$('gmDraw'); if(dw) dw.onclick=()=>drawPartners(ev);
  m.querySelectorAll('[data-gsheet]').forEach(b=>b.onclick=()=>scoreSheet(ev,ev.groups.find(x=>x.id===b.dataset.gsheet)));
  m.querySelectorAll('[data-gp]').forEach(r=>r.onclick=()=>editGamePlayer(g,g.players.find(p=>p.id===r.dataset.gp)));
  $('gmAddPot').onclick=()=>editPot(g,null);
  m.querySelectorAll('[data-pot]').forEach(b=>b.onclick=()=>editPot(g,g.pots.find(p=>p.id===b.dataset.pot)));
  m.querySelectorAll('[data-pay]').forEach(b=>b.onclick=()=>{ const pot=g.pots.find(p=>p.id===b.dataset.pay); ({finish:payPlaces,skins:paySkins,dots:payDots,format:payFormat,manual:(g,pot)=>payManual(g,pot,null)})[pot.kind](g,pot); });
}
function addGamePlayers(g){
  const inG=new Set(g.players.map(p=>p.memberId).filter(Boolean));
  const pool=members().filter(x=>x.status!=='Inactive'&&!inG.has(x.id)).sort((a,b)=>memberName(a).localeCompare(memberName(b)));
  const picked=new Set(); let guests=[];
  const list=q=>{ q=q.toLowerCase(); return pool.filter(x=>!q||memberName(x).toLowerCase().includes(q)).map(x=>`<label class="check" style="padding:6px 0;border-bottom:1px solid var(--line)"><input type="checkbox" data-pk="${x.id}"${picked.has(x.id)?' checked':''}><span class="av" style="margin:0 8px">${initials(x)}</span>${esc(memberName(x))}<span class="muted" style="margin-left:auto;font-size:12.5px">${x.hcp?'Index '+esc(x.hcp):''}</span></label>`).join('')||'<span class="muted">No one left to add.</span>'; };
  openDrawer({kicker:gameTitle(g),title:'Add players',saveLabel:'Add',
    body:`<input class="inp" id="apQ" placeholder="Search members" aria-label="Search members"><div id="apL" style="max-height:320px;overflow:auto">${list('')}</div>
      <div class="fld"><span class="lbl">Guest</span><div style="display:grid;grid-template-columns:minmax(0,1fr) auto;gap:8px"><input class="inp" id="apG" placeholder="Guest name"><button class="btn" type="button" id="apGAdd">Add guest</button></div><p class="hint" id="apGList" style="margin:0"></p></div>
      <p class="hint">New players go into every pot except hand-entered ones; change that per player afterwards.</p>`,
    wire:r=>{ const bind=()=>r.querySelectorAll('[data-pk]').forEach(c=>c.onchange=()=>{ if(c.checked) picked.add(c.dataset.pk); else picked.delete(c.dataset.pk); });
      bind(); r.querySelector('#apQ').oninput=e=>{ r.querySelector('#apL').innerHTML=list(e.target.value); bind(); };
      r.querySelector('#apGAdd').onclick=()=>{ const n=r.querySelector('#apG').value.trim(); if(!n) return; guests.push(n); r.querySelector('#apG').value=''; r.querySelector('#apGList').textContent='Guests: '+guests.join(', '); }; },
    save:()=>{ if(!picked.size&&!guests.length){ toast('Pick someone'); return false; }
      [...picked].forEach(id=>addPlayer(g,{memberId:id})); guests.forEach(n=>addPlayer(g,{name:n}));
      publishEvent(ensureGameEvent(g));
      toast(`${picked.size+guests.length} added`); }});
}
function editGamePlayer(g,p){
  const out=gpOut(g,p);
  openDrawer({kicker:gameTitle(g),title:gpName(p),
    body:`<label class="check"><input type="checkbox" id="gpPaid"${p.paid?' checked':''}>Paid in (${gMoney(gpIn(g,p))})</label>
      <div class="fld"><span class="lbl">In which pots</span>${g.pots.filter(pot=>pot.kind!=='manual').map(pot=>`<label class="check" style="font-weight:400"><input type="checkbox" data-gpp="${pot.id}"${potIn(pot,p)?' checked':''}>${esc(pot.name)} <span class="muted">· ${gMoney(pot.entry)}</span></label>`).join('')}</div>`+
      field('Extra money in $','gpX',p.extraIn||0,{type:'number',hint:'Side action put through the group, e.g. a double entry.'})+(out?`<p class="hint">Won ${gMoney(out)} in this game — change it under Pots.</p>`:''),
    save:()=>{ p.paid=$('gpPaid').checked; document.querySelectorAll('[data-gpp]').forEach(c=>{ const pot=g.pots.find(x=>x.id===c.dataset.gpp); if(c.checked) pot.inn[p.id]=true; else delete pot.inn[p.id]; }); p.extraIn=fnum('gpX'); },
    del:()=>{ if(out&&!confirm(`${gpName(p)} has ${gMoney(out)} in payouts recorded. Remove anyway?`)) return false; g.players=g.players.filter(x=>x!==p); g.pots.forEach(pot=>{ delete pot.inn[p.id]; pot.payouts=pot.payouts.filter(x=>x.pid!==p.id); }); const ev=gameEvent(g); if(ev){ syncGameEvent(g,ev); golfSave(ev); } },delLabel:'Remove from game'});
}
/* ---------- pots ---------- */
function editPot(g,pot){
  const sides=enabledGames().filter(x=>x.side), mains=enabledGames().filter(x=>!x.side&&!x.tool);
  const kindOf=id=>{ const C=catalogById(id); return !C?'manual':C.id==='skins'?'skins':C.id==='dots'?'dots':C.manual?'manual':'format'; };
  const cur=pot||{kind:'skins',name:'Skins',entry:5,rules:{game:'skins'}}, curGame=cur.rules.game||(cur.kind==='skins'?'skins':cur.kind==='dots'?'dots':'');
  openDrawer({kicker:gameTitle(g),title:pot?'Pot':'Add pot',saveLabel:pot?'Save':'Add pot',
    body:(pot&&pot.kind==='finish'?'<p class="hint">The main game’s pot — paid by finish on the game’s leaderboard.</p>':`<div class="fld"><label class="lbl" for="ptG">Game</label><select class="inp" id="ptG">${sides.map(C=>`<option value="${C.id}"${curGame===C.id?' selected':''}>${esc(C.name)}</option>`).join('')}<optgroup label="Side pot scored as another game">${mains.map(C=>`<option value="${C.id}"${curGame===C.id?' selected':''}>${esc(C.name)}</option>`).join('')}</optgroup></select><p class="hint" id="ptHint"></p></div>`)+
      pair(field('Name','ptN',cur.name),field('Entry per player $','ptE',cur.entry,{type:'number'}))+
      (pot?'':'<label class="check"><input type="checkbox" id="ptAll" checked>Everyone in the game is in this pot</label>'),
    wire:r=>{ const s=r.querySelector('#ptG'); if(!s) return; const upd=()=>{ const C=catalogById(s.value); r.querySelector('#ptHint').textContent=C?C.desc:''; if(!pot) r.querySelector('#ptN').value=C?C.name.replace(/ \(.*$/,''):''; }; s.onchange=upd; if(!pot) upd(); },
    save:()=>{ const name=fv('ptN')||'Pot', entry=fnum('ptE');
      if(pot){ Object.assign(pot,{name,entry}); if(pot.kind!=='finish'){ const gid=fv('ptG'); if(gid!==pot.rules.game){ pot.kind=kindOf(gid); pot.rules.game=gid; delete pot.teams; } } return; }
      const gid=fv('ptG'), kind=kindOf(gid), np=newPot(kind,name,entry,$('ptAll').checked?g:null,{rules:{game:gid}}); g.pots.push(np); toast(name+' added'); },
    del:pot&&pot.kind!=='finish'?()=>{ if(pot.payouts.length&&!confirm('This pot has payouts recorded. Remove it anyway?')) return false; g.pots=g.pots.filter(x=>x!==pot); }:null,delLabel:'Remove pot'});
}
function defaultPcts(n){ return n<=5?[100]:n<=8?[60,40]:n<=15?[50,30,20]:[40,30,20,10]; }
/* places × percentages, ties share the places they cover, cent-exact */
function splitByFinish(amount,order,pcts){
  const cents=Math.round(n0(amount)*100), placeC=pcts.map(p=>Math.floor(cents*p/100)); let rem=cents-placeC.reduce((a,b)=>a+b,0); for(let i=0;rem>0;i++,rem--) placeC[i%placeC.length]++;
  const out=[]; let i=0;
  while(i<order.length&&i<pcts.length){ const pos=order[i].pos; const tied=order.filter(r=>r.pos===pos); const covered=placeC.slice(i,i+tied.length); const total=covered.reduce((a,b)=>a+b,0);
    if(!total) break; const each=Math.floor(total/tied.length); let odd=total-each*tied.length;
    tied.forEach(r=>{ out.push({id:r.id,name:r.name,pos,amount:(each+(odd-->0?1:0))/100}); }); i+=tied.length; }
  return out;
}
const gOrdinal=n=>n+(['th','st','nd','rd'][(n%100>>3^1&&n%10)||0]||'th');
/* finish order for a pot from a leaderboard: team rows pay each member their share */
function finishOrder(g,pot,rows){
  const byG=new Map(g.players.filter(p=>potIn(pot,p)&&p.gpid).map(p=>[p.gpid,p])), out=[];
  rows.filter(r=>r.n).forEach(r=>{ if(r.team){ const ms=(r.members||[]).map(id=>byG.get(id)).filter(Boolean); if(ms.length) out.push({pos:r.pos,team:true,players:ms,name:ms.map(gpName).join(' / ')}); }
    else { const p=byG.get(r.id); if(p) out.push({pos:r.pos,team:false,players:[p],name:gpName(p)}); } });
  return out;
}
function payByFinish(g,pot,rows,title,noteFn){
  const mo=potTotal(g,pot), order=finishOrder(g,pot,rows), manual=!order.length, inP=g.players.filter(p=>potIn(pot,p));
  let pcts=defaultPcts(order.length||inP.length);
  const orderNow=()=>manual?inP.map(p=>({pos:+($('pf_'+p.id)?.value||0),team:false,players:[p],name:gpName(p)})).filter(x=>x.pos>0).sort((a,b)=>a.pos-b.pos):order;
  const preview=()=>{ const o=orderNow(); const res=splitByFinish(fnum('pfAmt'),o.map((x,i)=>({id:i,name:x.name,pos:x.pos})),pcts).map(r=>Object.assign(r,{unit:o[r.id]}));
    const el=$('pfPrev'); if(el) el.innerHTML=res.length?res.map(r=>`<div class="mr num" style="grid-template-columns:40px minmax(0,1fr) 90px"><b>${r.pos}</b><span>${esc(r.name)}${r.unit.team?` <span class="muted">· ${gMoney(r.amount/r.unit.players.length)} each</span>`:''}</span><b class="r">${gMoney(r.amount)}</b></div>`).join('')+`<div class="mr num" style="grid-template-columns:minmax(0,1fr) 90px"><span class="muted">Total</span><b class="r">${gMoney(sum(res,r=>r.amount))}</b></div>`:'<div class="mr"><span class="muted">Nothing to split yet.</span></div>'; return res; };
  openDrawer({kicker:gameTitle(g)+' · '+pot.name,title,saveLabel:'Record payouts',wide:manual,
    body:pair(field('Pot to split $','pfAmt',mo,{type:'number'}),field('Split %','pfP',pcts.join(' / '),{hint:'1st / 2nd / 3rd… Ties share the places they cover.'}))+
      (manual?`<div class="fld"><span class="lbl">Finish positions (no scores — enter them by hand)</span><div class="mini">${inP.map(p=>`<div class="mr" style="grid-template-columns:minmax(0,1fr) 80px"><span>${esc(gpName(p))}</span><input class="inp r" id="pf_${p.id}" inputmode="numeric" placeholder="—" aria-label="${esc(gpName(p))} finish"></div>`).join('')}</div><p class="hint">Same number = tied.</p></div>`
        :`<p class="hint">From the leaderboard: ${esc(order.slice(0,4).map(r=>r.pos+'. '+r.name).join(' · '))}${order.length>4?' …':''}</p>`)+
      `<div class="fld"><span class="lbl">Payouts</span><div class="mini" id="pfPrev"></div></div>`+(pot.payouts.length?'<p class="hint">Replaces the payouts recorded for this pot.</p>':''),
    wire:r=>{ const re=()=>{ pcts=fv('pfP').split(/[\/,\s]+/).map(Number).filter(x=>x>0); if(!pcts.length) pcts=[100]; preview(); }; r.querySelectorAll('input').forEach(i=>i.oninput=re); re(); },
    save:()=>{ const res=preview(); if(!res.length){ toast('Enter finish positions first'); return false; } const tied=pos=>res.filter(x=>x.pos===pos).length>1;
      pot.payouts=[]; res.forEach(r=>{ const ps=r.unit.players, cents=Math.round(r.amount*100), each=Math.floor(cents/ps.length); let odd=cents-each*ps.length; ps.forEach(p=>pot.payouts.push({id:uid(),pid:p.id,amount:(each+(odd-->0?1:0))/100,note:gOrdinal(r.pos)+(tied(r.pos)?' (tied)':'')+(noteFn?' · '+noteFn():'')})); });
      toast(`${pot.payouts.length} payout${pot.payouts.length===1?'':'s'} recorded`); }});
}
function payPlaces(g,pot){ const ev=gameEvent(g); const rows=ev?eventBoard(publicEvent(ev),scoresFor(ev),{sort:g.net?'net':'gross'}):[]; payByFinish(g,pot,rows,'Pay out by finish'); }
/* a side pot scored as another game on the same scores (low net, blind-draw best ball, Stableford…) */
function sidePub(g,pot){ const ev=gameEvent(g); if(!ev) return null; const C=catalogById(pot.rules.game)||catalogById('stroke'); const pub=publicEvent(ev);
  const E=engineFrom(C,pot.rules.teamSize||(C.sizes?C.sizes[0]:1),pot.rules.count||1); Object.assign(pub,E,{allow:{}});
  const inP=new Set(g.players.filter(p=>potIn(pot,p)).map(p=>p.gpid)), teams=pot.teams||{}, teamy=!!((FORMATS[E.format]||{}).team)||E.format==='match';
  pub.groups=pub.groups.map(gr=>Object.assign({},gr,{players:gr.players.filter(p=>inP.has(p.id)).map(p=>Object.assign({},p,{team:teamy?(teams[p.id]||p.team):''}))})).filter(gr=>gr.players.length);
  return pub; }
function payFormat(g,pot){
  const ev=gameEvent(g); if(!ev){ toast('Open live scoring first'); return; }
  const C=catalogById(pot.rules.game)||catalogById('stroke'); const teamy=!!(C.sizes&&C.sizes.length)||(C.engine.teamSize>=2);
  if(teamy&&!pot.teams){ // draw the side game's partners first
    const ps=g.players.filter(p=>potIn(pot,p)&&p.gpid), evp=new Map(evPlayers(ev).map(x=>[x.p.id,x.p]));
    openDrawer({kicker:gameTitle(g)+' · '+pot.name,title:'Draw partners for '+pot.name,saveLabel:'Draw',
      body:pair(field('Team size','sdN',C.engine.teamSize||(C.sizes?C.sizes[0]:2),{type:'select',options:(C.sizes||[2]).map(n=>[n,n+' players'])}),field('How','sdM','random',{type:'select',options:enabledGames().filter(x=>x.tool).map(x=>[x.id.replace('draw',''),x.name])}))+'<div class="mini" id="sdPrev"></div>',
      wire:r=>{ const run=()=>{ const teams=drawTeams(ps.map(p=>evp.get(p.gpid)).filter(Boolean),+r.querySelector('#sdN').value,r.querySelector('#sdM').value,p=>effIndex(ev,p).idx); r._teams=teams; r.querySelector('#sdPrev').innerHTML=teams.map((t,i)=>`<div class="mr" style="grid-template-columns:70px minmax(0,1fr)"><b>Team ${i+1}</b><span>${esc(t.map(p=>p.name).join(' / '))}</span></div>`).join(''); }; r.querySelector('#sdN').onchange=run; r.querySelector('#sdM').onchange=run; run(); },
      save:()=>{ const teams=$('dBody')._teams||[]; pot.teams={}; teams.forEach((t,i)=>t.forEach(p=>{ pot.teams[p.id]='S'+(i+1); })); pot.rules.teamSize=+fv('sdN'); toast('Partners drawn — now score and pay the pot'); setTimeout(()=>payFormat(g,pot),100); }});
    return; }
  const pub=sidePub(g,pot), rows=eventBoard(pub,scoresFor(ev),{sort:pub.scoring});
  payByFinish(g,pot,rows,`${C.name}: pay out`,()=>C.name+(pot.teams?' (drawn partners)':''));
}
/* ---------- skins ---------- */
const SKINS_DEFAULT=(g,pot)=>Object.assign({net:!!g.net,grossBeatsNet:false,carry:true,validate:'none'},(pot&&pot.rules&&pot.rules.skins)||g.skinsRules||{});
function skinsCalc(g,pot,rules){
  const ev=gameEvent(g); if(!ev) return null;
  const byG=new Map(g.players.filter(p=>potIn(pot,p)&&p.gpid).map(p=>[p.gpid,p]));
  const r=skinsResult(publicEvent(ev),scoresFor(ev),rules||SKINS_DEFAULT(g,pot),[...byG.keys()]);
  r.wins.forEach(w=>{ const p=byG.get(w.pid); w.pid=p.id; w.name=gpName(p); }); r.per=Object.fromEntries(Object.entries(r.per).map(([k,v])=>[byG.get(k).id,v])); return r;
}
const skinsRuleText=r=>[r.net?(r.grossBeatsNet?'net, gross beats net':'net'):'gross',r.carry?'carry-overs':'no carry-overs',r.validate==='gross'?'validated by par on the next hole':r.validate==='net'?'validated by net par on the next hole':''].filter(Boolean).join(' · ');
function paySkins(g,pot){
  const ev=gameEvent(g);
  if(!ev){ toast('Open live scoring first — skins come from the hole-by-hole scores'); return; }
  const rules=SKINS_DEFAULT(g,pot);
  const calc=()=>{ const r=skinsCalc(g,pot,rules), amt=fnum('skAmt'), el=$('skPrev'); if(!el) return r;
    if(!r||!r.wins.length){ el.innerHTML=`<div class="mr"><span class="muted">${r&&r.incomplete===18?'No scores yet':'No skins won yet'+(r&&r.carried?` · ${r.carried} carried`:'')}.</span></div>`; return r; }
    const val=r.total?amt/r.total:0;
    el.innerHTML=r.wins.map(w=>`<div class="mr num" style="grid-template-columns:60px minmax(0,1fr) 90px"><b>Hole ${w.hole}</b><div class="cell2"><span>${esc(w.name)} <span class="muted">${w.score}${rules.net&&w.net!==w.score?' (net '+w.net+')':''}${w.count>1?' · '+w.count+' skins':''}</span></span>${w.status==='void'?`<small class="neg">Void — missed ${rules.validate==='net'?'net ':''}par on hole ${w.checkHole}${rules.carry?', carried':''}</small>`:w.status==='pending'?`<small class="muted">Waiting on hole ${w.checkHole} to validate</small>`:''}</div><b class="r ${w.status==='won'?'':'muted'}">${w.status==='won'?gMoney(val*w.count):'—'}</b></div>`).join('')+
      `<div class="mr num" style="grid-template-columns:minmax(0,1fr) 90px"><span class="muted">${r.total} skin${r.total===1?'':'s'}${r.total?' at '+gMoney(val):''}${r.pending?` · ${r.pending} pending`:''}${r.incomplete?` · ${r.incomplete} hole${r.incomplete===1?'':'s'} not finished by everyone`:''}${r.carried?` · ${r.carried} carried, unpaid`:''}${r.lost?` · ${r.lost} void, unpaid`:''}</span><b class="r">${gMoney(r.total?amt:0)}</b></div>`; return r; };
  openDrawer({kicker:gameTitle(g)+' · '+pot.name,title:'Pay out skins',saveLabel:'Record skins',
    body:pair(field('Skins pot $','skAmt',potTotal(g,pot),{type:'number'}),`<div class="fld"><span class="lbl">Scoring</span>${seg('skNet',[['gross','Gross'],['net','Net'],['gbn','Net · gross beats net']],rules.net?(rules.grossBeatsNet?'gbn':'net'):'gross')}</div>`)+
      pair(field('Validation','skVal',rules.validate,{type:'select',options:[['none','None — a skin stands on its own'],['gross','Par or better on the next hole'],['net','Net par or better on the next hole']]}),`<div class="fld"><span class="lbl">Ties</span><label class="check" style="height:42px"><input type="checkbox" id="skCarry"${rules.carry?' checked':''}>Carry over to the next hole</label></div>`)+
      `<div class="fld"><span class="lbl">Skins</span><div class="mini" id="skPrev"></div></div><p class="hint">Only players in this pot count, and a hole counts once all of them have scored it. Gross beats net: on a net tie, the one player who made that score without a stroke takes the skin. Validation: the winner must make par (or net par) on their next hole or the skin is void — back into the carry, or lost without carry-overs; a skin on the last hole stands. Carried skins with no winner at the end are not paid.</p>`,
    wire:r=>{ wireSeg(r,'skNet',v=>{ rules.net=v!=='gross'; rules.grossBeatsNet=v==='gbn'; calc(); }); r.querySelector('#skVal').onchange=e=>{ rules.validate=e.target.value; calc(); }; r.querySelector('#skCarry').onchange=e=>{ rules.carry=e.target.checked; calc(); }; r.querySelector('#skAmt').oninput=calc; calc(); },
    save:()=>{ const r=skinsCalc(g,pot,rules); pot.rules.skins=Object.assign({},rules); if(!r||!r.total){ toast(r&&r.pending?'Skins are still waiting on validation holes':'No skins to pay yet'); return false; } const amt=fnum('skAmt'), val=amt/r.total;
      const cents=Object.entries(r.per).map(([pid,n])=>({pid,n,c:Math.floor(amt*100*n/r.total)})); let rem=Math.round(amt*100)-cents.reduce((a,x)=>a+x.c,0); for(let i=0;rem>0;i++,rem--) cents[i%cents.length].c++;
      pot.payouts=cents.map(x=>({id:uid(),pid:x.pid,amount:x.c/100,note:`${x.n} skin${x.n===1?'':'s'} · ${skinsRuleText(rules)}`}));
      toast(`${r.total} skins paid at ${gMoney(val)}`); }});
}
/* ---------- dots / doodah ---------- */
const DOTS_DEFAULT={birdie:1,eagle:3,net:false,kinds:['Sandy','Greenie','Chip-in','Polie']};
const dotsRules=pot=>Object.assign({},DOTS_DEFAULT,pot.rules.dots||{});
const dotsRuleText=pot=>{ const r=dotsRules(pot); return `birdie ${r.birdie} · eagle ${r.eagle}${r.net?' (net)':''} · ${r.kinds.join(', ').toLowerCase()}`; };
/* birdies and eagles per player from the scores (gross, or net with each player's strokes) */
function dotsAuto(g,pot,rules){
  const ev=gameEvent(g), out={}; if(!ev) return out; const pub=publicEvent(ev), sc=scoresFor(ev), byG=new Map(g.players.filter(p=>potIn(pot,p)&&p.gpid).map(p=>[p.gpid,p]));
  for(const gr of pub.groups){ const c=pub.courses[gr.course]; if(!c) continue; for(const p of gr.players){ const gp=byG.get(p.id); if(!gp) continue; const par=c.par[p.set||'M']||c.par.M, hc=c.hcp[p.set||'M']||c.hcp.M; let b=0,e=0;
    for(let h=1;h<=18;h++){ const s=+((sc[p.id]||{})[h]); if(!s) continue; const k=rules.net&&typeof p.ph==='number'?strokesOn(p.ph,hc[h-1]):0; const d=s-k-par[h-1]; if(d===-1) b++; else if(d<=-2) e++; }
    out[gp.id]={birdies:b,eagles:e}; } }
  return out;
}
function payDots(g,pot){
  const rules=dotsRules(pot), inP=g.players.filter(p=>potIn(pot,p)), tally=pot.tally=pot.tally||{};
  const auto=dotsAuto(g,pot,rules);
  const totals=()=>inP.map(p=>{ const a=auto[p.id]||{birdies:0,eagles:0}, t=tally[p.id]||{}; const manual=sum(rules.kinds,k=>t[k]); return {p,a,manual,dots:a.birdies*rules.birdie+a.eagles*rules.eagle+manual}; });
  const prev=()=>{ const T=totals(), all=sum(T,x=>x.dots), amt=fnum('dtAmt'), val=all?amt/all:0; const el=$('dtTot'); if(el) el.innerHTML=`${all} dot${all===1?'':'s'}${all?' at '+gMoney(val):''} · ${gMoney(amt)}`; T.forEach(x=>{ const c=$('dtT_'+x.p.id); if(c) c.textContent=x.dots+(x.dots?' → '+gMoney(val*x.dots):''); }); return {T,all,amt}; };
  openDrawer({kicker:gameTitle(g)+' · '+pot.name,title:'Dots: tally & pay',saveLabel:'Record dots',wide:true,
    body:pair(field('Dots pot $','dtAmt',potTotal(g,pot),{type:'number'}),`<div class="fld"><span class="lbl">Birdies & eagles</span>${seg('dtNet',[['gross','Gross'],['net','Net']],rules.net?'net':'gross')}</div>`)+
      `<div class="fld"><div style="display:grid;grid-template-columns:minmax(0,1fr) ${rules.kinds.map(()=>'64px').join(' ')} 110px;gap:6px;align-items:center;font-size:13px"><span class="lbl">Player · birdies ${rules.birdie} · eagles ${rules.eagle}</span>${rules.kinds.map(k=>`<span class="lbl r">${esc(k)}</span>`).join('')}<span class="lbl r">Dots</span>
        ${inP.map(p=>{ const a=auto[p.id]||{birdies:0,eagles:0}, t=tally[p.id]||{}; return `<span class="trunc">${esc(gpName(p))} <small class="muted">${a.birdies}b ${a.eagles}e</small></span>${rules.kinds.map(k=>`<input class="inp r" style="height:32px" inputmode="numeric" data-dt="${p.id}|${k}" value="${t[k]||''}" aria-label="${esc(gpName(p))} ${esc(k)}">`).join('')}<b class="r num" id="dtT_${p.id}"></b>`; }).join('')}</div></div>
      <p class="hint" id="dtTot"></p><p class="hint">Birdies and eagles are counted from the scores; type the sandies, greenies, chip-ins and polies as the group calls them.</p>`,
    wire:r=>{ wireSeg(r,'dtNet',v=>{ rules.net=v==='net'; Object.assign(auto,dotsAuto(g,pot,rules)); prev(); }); r.querySelectorAll('[data-dt]').forEach(i=>i.oninput=()=>{ const [pid,k]=i.dataset.dt.split('|'); (tally[pid]=tally[pid]||{})[k]=+i.value||0; prev(); }); r.querySelector('#dtAmt').oninput=prev; prev(); },
    save:()=>{ const {T,all,amt}=prev(); pot.rules.dots=Object.assign({},rules); if(!all){ toast('No dots yet'); return false; }
      const cents=T.filter(x=>x.dots).map(x=>({pid:x.p.id,n:x.dots,c:Math.floor(amt*100*x.dots/all)})); let rem=Math.round(amt*100)-cents.reduce((a,x)=>a+x.c,0); for(let i=0;rem>0;i++,rem--) cents[i%cents.length].c++;
      pot.payouts=cents.map(x=>({id:uid(),pid:x.pid,amount:x.c/100,note:`${x.n} dot${x.n===1?'':'s'}`})); toast(`${all} dots paid at ${gMoney(amt/all)}`); }});
}
function payManual(g,pot,x){
  openDrawer({kicker:gameTitle(g)+' · '+pot.name,title:x?'Payout':'Add winner',
    body:field('To','pmP',x?x.pid:'',{type:'select',options:[['','— Player —']].concat(g.players.map(p=>[p.id,gpName(p)]))})+pair(field('Amount $','pmA',x?x.amount:(pot.entry?potTotal(g,pot):''),{type:'number'}),field('For','pmN',x?x.note:(pot.name||''),{ph:'e.g. closest to the pin, hole 7'}))+
      (pot.payouts.length&&!x?`<div class="fld"><span class="lbl">Already recorded</span><div class="mini">${pot.payouts.map(y=>{ const p=g.players.find(z=>z.id===y.pid); return `<div class="mr num" style="grid-template-columns:minmax(0,1fr) 90px auto"><span>${esc(p?gpName(p):'—')} <span class="muted">${esc(y.note||'')}</span></span><b class="r">${gMoney(y.amount)}</b><button class="ib" type="button" data-pmdel="${y.id}" aria-label="Remove">${I.x}</button></div>`; }).join('')}</div></div>`:''),
    wire:r=>{ r.querySelectorAll('[data-pmdel]').forEach(b=>b.onclick=()=>{ pot.payouts=pot.payouts.filter(y=>y.id!==b.dataset.pmdel); persist(); closeDrawer(); render(); }); },
    save:()=>{ const pid=fv('pmP'), amt=fnum('pmA'); if(!pid||!amt){ toast('Pick a player and an amount'); return false; }
      if(x) Object.assign(x,{pid,amount:amt,note:fv('pmN')}); else pot.payouts.push({id:uid(),pid,amount:amt,note:fv('pmN')}); },
    del:x?()=>{ pot.payouts=pot.payouts.filter(y=>y!==x); }:null,delLabel:'Remove payout'});
}

/* ---------- live scoring through the Golf module ---------- */
/* every game has live scoring: its event exists from the moment the game does, open, and follows the players */
function ensureGameEvent(g){
  const G=golfData(); let ev=gameEvent(g);
  if(!ev){ let slug=slugify(orgShort()+'-'+(g.date||'game')), n=2; while(G.events.some(e=>e.slug===slug)) slug=slugify(orgShort()+'-'+(g.date||'game'))+'-'+(n++);
    ev=Object.assign({id:uid(),status:'live',name:gameTitle(g)+(g.date?' · '+shortDate(g.date):''),date:g.date,defaultTee:'White',defaultCourse:g.course||'oak',slug,tournamentId:'',front:'scramble',back:'shamble',scoring:g.net?'net':'gross',allow:{},groups:[],pool:[],flights:{count:0,names:[]},createdAt:new Date().toISOString(),gameId:g.id},engineFrom(catalogById(g.game||g.format||'stroke')||catalogById('stroke'),g.teamSize||1,g.count||1));
    G.events.push(ev); g.golfEventId=ev.id; }
  syncGameEvent(g,ev); return ev;
}
function openScoring(g){ const ev=ensureGameEvent(g); ev.status='live'; golfSave(ev); render(); toast('Scoring is open — share the link'); }
/* every game player has a player in the event; newcomers fill groups of four */
function syncGameEvent(g,ev){
  const have=new Set(evPlayers(ev).map(x=>x.p.id));
  for(const p of g.players){ if(p.gpid&&have.has(p.gpid)) continue;
    const gp={id:uid(),memberId:p.memberId||'',name:gpName(p),tee:ev.defaultTee||'White',set:'M',index:'',flight:'',team:''}; p.gpid=gp.id;
    let grp=ev.groups.find(x=>x.players.length<4);
    if(!grp){ grp={id:uid(),code:newCode(ev),label:'Group '+(ev.groups.length+1),course:g.course||ev.defaultCourse||'oak',startHole:1,teeTime:g.time||'',players:[]}; ev.groups.push(grp); }
    grp.players.push(gp); }
  const ids=new Set(g.players.map(p=>p.gpid)), sc=scoresFor(ev);
  ev.groups.forEach(grp=>{ grp.players=grp.players.filter(p=>ids.has(p.id)||Object.keys(sc[p.id]||{}).length); });
  ev.groups=ev.groups.filter(grp=>grp.players.length); ev.pool=(ev.pool||[]).filter(p=>ids.has(p.id));
}

/* ---------- Ledger ---------- */
function vLedger(m){
  gamesData();
  const rows=ledgerRows(view.lrange), up=rows.filter(r=>r.net>0.004), down=rows.filter(r=>r.net<-0.004);
  const cols='grid-template-columns:minmax(0,1.6fr) 70px 100px 100px 110px 110px 90px';
  m.innerHTML=head('Ledger',`Who is up and who is down in the ${esc(orgShort())}, ${Y()}. Net = paid out − paid in, plus any side bets or settle-ups recorded.`,btn('Record adjustment','ldAdj','',I.plus))+`
  <div class="toolbar"><div class="seg">${QUARTERS.map(([k,l])=>`<button class="${view.lrange===k?'on':''}" data-lr="${k}">${l}</button>`).join('')}</div>
    <span class="muted" style="margin-left:auto;font-size:13px">${rows.length} player${rows.length===1?'':'s'} · ${up.length} up · ${down.length} down · ${gMoney(sum(rows,r=>r.inn))} through the group</span></div>
  <div class="card" style="overflow:hidden">${rows.length?`<div class="tw"><div class="t" style="min-width:760px"><div class="tr th" style="${cols}"><span>Player</span><span class="r">Games</span><span class="r">Paid in</span><span class="r">Won</span><span class="r">Adjustments</span><span class="r">Net</span><span></span></div>
    ${rows.map((r,i)=>`<div class="tr num" style="${cols}"><div class="cell2"><b class="trunc">${i<3&&r.net>0.004?['🥇 ','🥈 ','🥉 '][i]:''}${esc(r.name)}</b><small>${r.memberId?'':'Guest · '}last played ${r.last?shortDate(r.last):'—'}</small></div><span class="r">${r.games}</span><span class="r">${gMoney(r.inn)}</span><span class="r">${gMoney(r.out)}</span><span class="r ${r.adj?'':'muted'}">${r.adj?gSigned(r.adj):'—'}</span><b class="r ${netCls(r.net)}" style="font-size:15px">${gSigned(r.net)}</b><span>${r.memberId&&Math.abs(r.net)>0.004?`<button class="btn sm" data-settle="${r.memberId}" data-net="${r.net}">Settle</button>`:''}</span></div>`).join('')}</div></div>`
  :`<div class="empty"><b>Nothing on the books${view.lrange==='season'?'':' this quarter'}</b><span>Money paid in and out at each game shows up here automatically.</span></div>`}</div>
  ${(db.ledgerAdj||[]).some(a=>a.season===Y())?`<div class="card" style="overflow:hidden"><div class="cardhead"><h2 class="h2">Adjustments</h2></div><div class="t">${db.ledgerAdj.filter(a=>a.season===Y()).sort((a,b)=>(b.date||'').localeCompare(a.date||'')).map(a=>`<div class="tr num click" data-adj="${a.id}" style="grid-template-columns:110px minmax(0,1fr) minmax(0,1.4fr) 100px 40px"><span>${a.date?shortDate(a.date).replace(/, \d{4}$/,''):'—'}</span><b class="trunc">${esc(memberName(memberById(a.memberId)))}</b><span class="muted trunc">${esc(a.desc||'')}</span><b class="r ${netCls(a.amount)}">${gSigned(a.amount)}</b><span class="ib">${I.edit}</span></div>`).join('')}</div></div>`:''}`;
  m.querySelectorAll('[data-lr]').forEach(b=>b.onclick=()=>{ view.lrange=b.dataset.lr; render(); });
  $('ldAdj').onclick=()=>editAdj(null);
  m.querySelectorAll('[data-adj]').forEach(r=>r.onclick=()=>editAdj(db.ledgerAdj.find(a=>a.id===r.dataset.adj)));
  m.querySelectorAll('[data-settle]').forEach(b=>b.onclick=()=>editAdj(null,{memberId:b.dataset.settle,amount:-(+b.dataset.net),desc:(+b.dataset.net>0?'Settled up — paid out':'Settled up — paid in')+' '+gMoney(Math.abs(+b.dataset.net))}));
}
function editAdj(a,preset){
  const ms=members().sort((x,y)=>memberName(x).localeCompare(memberName(y))), today=new Date().toISOString().slice(0,10), p=a||preset||{};
  openDrawer({kicker:'Ledger',title:a?'Adjustment':preset?'Settle up':'Record adjustment',
    body:field('Player','adM',p.memberId||'',{type:'select',options:[['','— Player —']].concat(ms.map(x=>[x.id,memberName(x)]))})+pair(field('Amount $ (+ up, − down)','adA',p.amount!=null?Math.round(p.amount*100)/100:'',{type:'number'}),field('Date','adD',p.date||today,{type:'date'}))+
      field('What for','adN',p.desc||'',{ph:'e.g. Nassau with Bo · settled up for Q3'})+'<p class="hint">Positive means money to the player (they are up by it); negative means money from the player. A settle-up zeroes a balance: record the opposite of their net.</p>',
    save:()=>{ const mid=fv('adM'); const v=parseFloat(fv('adA').replace(/[−–]/,'-')); if(!mid||!isFinite(v)||!v){ toast('Pick a player and an amount'); return false; }
      const d={memberId:mid,amount:Math.round(v*100)/100,date:fv('adD'),desc:fv('adN')}; if(a) Object.assign(a,d); else (db.ledgerAdj=db.ledgerAdj||[]).push(Object.assign({id:uid(),season:Y()},d)); },
    del:a?()=>{ db.ledgerAdj=db.ledgerAdj.filter(x=>x!==a); }:null,delLabel:'Remove'});
}

/* ---------- small-group dashboard ---------- */
function vGroupDash(m){
  gamesData();
  const gs=seasonGames(), next=gs.filter(isUpcoming).reverse()[0], last=gs.filter(g=>!isUpcoming(g))[0], rows=ledgerRows('season');
  const through=sum(gs,g=>gameMoney(g).total), leader=rows[0], ts=seasonTournaments(Y());
  m.innerHTML=head(`${Y()} Season`,esc(CLUB.name||CLUB_META.name)+' · '+esc(orgName()),btn('New game','dNewG','pri',I.plus))+`
  <div class="grid g4">
    ${kpi('Next game',next?(next.date?shortDate(next.date).replace(/, \d{4}$/,''):'TBD'):'—',next?`${esc(gameTitle(next))}${next.time?' · '+fmtTime(next.time):''} · ${next.players.length} in`:'nothing scheduled')}
    ${kpi('Games played',String(gs.filter(g=>!isUpcoming(g)).length),last?`last: ${esc(gameTitle(last))} · ${shortDate(last.date)}`:'')}
    ${kpi('Through the group',gMoney(through),'every pot this season')}
    ${kpi('Leading the season',leader&&leader.net>0.004?esc(leader.name.split(' ')[0]):'—',leader&&leader.net>0.004?gSigned(leader.net)+' · '+leader.games+' games':'no money won yet','pos')}
  </div>
  <div class="split">
    <div style="display:flex;flex-direction:column;gap:20px">
    <div class="card" style="overflow:hidden"><div class="cardhead"><h2 class="h2">Games</h2><button class="btn sm" data-go="games">All games</button></div>
      ${gs.length?`<div class="t">${gs.slice(0,6).map(g=>{ const mo=gameMoney(g), ev=gameEvent(g); return `<div class="tr num click" data-game="${g.id}" style="grid-template-columns:100px minmax(0,1fr) 90px 100px"><span>${g.date?shortDate(g.date).replace(/, \d{4}$/,''):'TBD'}</span><div class="cell2"><b class="trunc">${esc(gameTitle(g))}</b><small>${g.players.length} players · ${esc(gameName(g))}${ev&&ev.status==='live'?' · <span class="pos">● live</span>':''}</small></div><span class="r">${gMoney(mo.total)}</span><span>${g.status==='settled'?'<span class="chip navy">Settled</span>':isUpcoming(g)?'<span class="chip">Upcoming</span>':Math.abs(mo.left)>0.004?'<span class="chip warn">Open</span>':'<span class="chip ok">Paid out</span>'}</span></div>`; }).join('')}</div>`
      :`<div class="empty"><b>No games yet</b><span>Set up the regular game to start the season.</span><div class="actions"><button class="btn pri" id="dNewG2">${I.plus}New game</button></div></div>`}</div>
    ${ts.length?`<div class="card" style="overflow:hidden"><div class="cardhead"><h2 class="h2">Tournaments</h2><button class="btn sm" data-go="tournaments">All</button></div><div class="t">${ts.slice(0,4).map(t=>`<div class="tr click" data-open="${t.id}" style="grid-template-columns:minmax(0,1fr) 140px"><b class="trunc">${esc(t.name)}</b><span class="muted">${dateRange(t)}</span></div>`).join('')}</div></div>`:''}
    </div>
    <div style="display:flex;flex-direction:column;gap:20px">
      ${typeof liveBoardCard==='function'?liveBoardCard():''}
      <div class="card pad" style="display:flex;flex-direction:column;gap:10px"><div style="display:flex;justify-content:space-between;align-items:center"><h2 class="h2">Standings</h2><button class="btn sm" data-go="ledger">Ledger</button></div>
        ${rows.length?rows.slice(0,8).map((r,i)=>`<div class="num" style="display:grid;grid-template-columns:28px minmax(0,1fr) 50px 80px;gap:8px;font-size:13.5px;align-items:center"><b>${i+1}</b><span class="trunc">${esc(r.name)}</span><span class="muted r">${r.games}</span><b class="r ${netCls(r.net)}">${gSigned(r.net)}</b></div>`).join(''):'<span class="muted">Nobody on the books yet.</span>'}</div>
    </div>
  </div>`;
  wireCommon(m);
  $('dNewG').onclick=()=>{ go('games'); editGame(null); }; const n2=$('dNewG2'); if(n2) n2.onclick=()=>{ go('games'); editGame(null); };
  m.querySelectorAll('[data-game]').forEach(r=>r.onclick=()=>{ view.gameId=r.dataset.game; go('games'); });
}
