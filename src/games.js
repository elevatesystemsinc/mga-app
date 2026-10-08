/* =====================================================================
   Club Hub — Games (small groups). The regular game: who played, entry money, payouts by finish and
   skins, live scoring through the Golf module, and a season ledger of who is up or down.
   Data (group document):
     db.games=[{id,season,date,time,name,course,entry,skinsEntry,net,status:'open'|'settled',notes,golfEventId,
                players:[{id,memberId,name,paid,inSkins,extraIn,gpid}],          gpid = the player's id in the scoring event
                payouts:[{id,kind:'places'|'skins'|'manual',pid,amount,note}]}]
     db.ledgerAdj=[{id,season,date,memberId,amount,desc}]                       side bets, settle-ups, corrections
   Money is a record of what changed hands at the game; net = paid out − paid in (+ adjustments).
   ===================================================================== */
I.trophy=svg('<path d="M8 4h8v5a4 4 0 01-8 0z"/><path d="M8 6H5a3 3 0 003 3M16 6h3a3 3 0 01-3 3"/><path d="M12 13v4M9 20h6"/>');
I.cash=svg('<rect x="3" y="6" width="18" height="12" rx="2"/><circle cx="12" cy="12" r="2.5"/><path d="M7 12h.01M17 12h.01"/>');
NAV.splice(1,0,['games','Games',I.trophy],['ledger','Ledger',I.cash]);
ORG_NAV.group=['dash','games','ledger','golf','members'];
view.gameId=null; view.lrange='season'; view.gsortBy='net';
const isGroup=()=>!!db&&db.kind==='group';
function gamesData(){ db.games=db.games||[]; db.ledgerAdj=db.ledgerAdj||[]; for(const g of db.games){ g.players=g.players||[]; g.payouts=g.payouts||[]; } return db.games; }
const seasonGames=()=>gamesData().filter(g=>g.season===Y()).sort((a,b)=>(b.date||'').localeCompare(a.date||'')||(b.time||'').localeCompare(a.time||''));
const GAME=()=>gamesData().find(g=>g.id===view.gameId);
const gMoney=v=>Math.abs(n0(v)-Math.round(n0(v)))<0.005?fmt(v):fmt2(v);
const gSigned=v=>n0(v)>0.004?'+'+gMoney(v):n0(v)<-0.004?'−'+gMoney(Math.abs(v)):gMoney(0);
const gpName=p=>p.memberId?(memberName(memberById(p.memberId))||p.name||'Member'):(p.name||'Guest');
const gpIn=(g,p)=>n0(g.entry)+(p.inSkins?n0(g.skinsEntry):0)+n0(p.extraIn);
const gpOut=(g,p)=>sum(g.payouts.filter(x=>x.pid===p.id),x=>x.amount);
function gameMoney(g){
  const pot=sum(g.players,p=>n0(g.entry)+n0(p.extraIn)), skins=sum(g.players.filter(p=>p.inSkins),()=>n0(g.skinsEntry)), paid=sum(g.payouts,x=>x.amount);
  return {pot,skins,total:pot+skins,paid,left:pot+skins-paid,unpaid:g.players.filter(p=>!p.paid).length};
}
const gameEvent=g=>g&&g.golfEventId?golfData().events.find(e=>e.id===g.golfEventId):null;
const gameTitle=g=>g.name||(orgShort()+' game');
const gameWhen=g=>(g.date?shortDate(g.date):'Date TBD')+(g.time?' · '+fmtTime(g.time):'');
const isUpcoming=g=>{ const d=parseD(g.date); if(!d) return true; const now=new Date(); now.setHours(0,0,0,0); return d>=now; };

/* ---------- season ledger ---------- */
const QUARTERS=[['season','Season'],['q1','Q1'],['q2','Q2'],['q3','Q3'],['q4','Q4']];
function inRange(dateStr,range){ if(!range||range==='season') return true; const d=parseD(dateStr); if(!d) return false; return 'q'+(Math.floor(d.getMonth()/3)+1)===range; }
/* one row per person for the season (or quarter): games, money in, money out, adjustments, net */
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
  const tot=gs.reduce((a,g)=>{ const mo=gameMoney(g); a.money+=mo.total; a.players+=g.players.length; return a; },{money:0,players:0});
  const cols='grid-template-columns:120px minmax(0,1.5fr) minmax(0,1fr) 80px 100px 110px 40px';
  const row=g=>{ const mo=gameMoney(g), ev=gameEvent(g); return `<div class="tr num click" data-game="${g.id}" style="${cols}"><span>${g.date?shortDate(g.date).replace(/, \d{4}$/,''):'TBD'}${g.time?`<br><small class="muted">${fmtTime(g.time)}</small>`:''}</span><div class="cell2"><b class="trunc" style="color:var(--navy)">${esc(gameTitle(g))}</b><small class="trunc">${esc(courseById(g.course)?.name||'')}${g.net?' · net':''}${ev&&ev.status==='live'?' · <span class="pos">● live scoring</span>':''}</small></div><span class="muted">${g.players.length} player${g.players.length===1?'':'s'}${mo.unpaid?` · <span class="neg">${mo.unpaid} unpaid</span>`:''}</span><span class="r">${gMoney(g.entry)}</span><span class="r">${gMoney(mo.total)}</span><span>${g.status==='settled'?'<span class="chip navy">Settled</span>':Math.abs(mo.left)>0.004&&!isUpcoming(g)?`<span class="chip warn">${gMoney(mo.left)} to pay out</span>`:isUpcoming(g)?'<span class="chip">Upcoming</span>':'<span class="chip ok">Paid out</span>'}</span><span class="ib">${I.chev}</span></div>`; };
  m.innerHTML=head('Games',`The ${esc(orgShort())}’s ${Y()} season: who played, what went in, what was paid out.`,btn('New game','gmNew','pri',I.plus))+`
  <div class="grid g3">${kpi('Games this season',String(gs.length),`${past.length} played · ${up.length} upcoming`)}${kpi('Money through the group',gMoney(tot.money),'entries and skins, all games')}${kpi('Player-games',String(tot.players),gs.length?`${(tot.players/gs.length).toFixed(1)} players a game`:'')}</div>
  <div class="card" style="overflow:hidden">${gs.length?`<div class="tw"><div class="t" style="min-width:760px"><div class="tr th" style="${cols}"><span>Date</span><span>Game</span><span>Players</span><span class="r">Entry</span><span class="r">Pot</span><span>Status</span><span></span></div>${up.concat(past).map(row).join('')}</div></div>`
  :`<div class="empty"><b>No games yet</b><span>Set up the regular game: date, course, entry money. Add who’s playing, open live scoring, then pay out by finish or skins.</span><button class="btn pri" id="gmNew2">${I.plus}New game</button></div>`}</div>`;
  $('gmNew').onclick=()=>editGame(null); const n2=$('gmNew2'); if(n2) n2.onclick=()=>editGame(null);
  m.querySelectorAll('[data-game]').forEach(r=>r.onclick=()=>{ view.gameId=r.dataset.game; render(); });
}
function editGame(g){
  const last=seasonGames().find(x=>x!==g), courses=golfData().courses, today=new Date().toISOString().slice(0,10);
  openDrawer({kicker:orgShort()+' · Game',title:g?'Game details':'New game',saveLabel:g?'Save':'Create game',
    body:field('Name','gmN',g?g.name:(last?last.name:''),{ph:'e.g. Friday game'})+pair(field('Date','gmD',g?g.date:today,{type:'date'}),field('Tee time','gmT',g?g.time:(last?last.time||'':''),{type:'time'}))+
      pair(field('Course','gmC',g?g.course:(last?last.course:'oak'),{type:'select',options:courses.map(c=>[c.id,c.name])}),field('Scored','gmNet',g?(g.net?'net':'gross'):(last&&last.net?'net':'gross'),{type:'select',options:[['gross','Gross'],['net','Net (handicaps)']]}))+
      `<div class="fld"><label class="lbl" for="gmF">Game</label><select class="inp" id="gmF">${gameOptions(g?(g.game||g.format||'stroke'):(last?(last.game||last.format||'stroke'):'stroke'))}</select><p class="hint">Payouts by finish follow this game’s leaderboard; skins always come from the hole scores. Team games need partners — draw them from the game once scoring is open.</p></div>`+
      pair(field('Entry per player $','gmE',g?g.entry:(last?last.entry:20),{type:'number'}),field('Skins per player $ (0 = no skins)','gmS',g?g.skinsEntry:(last?last.skinsEntry:0),{type:'number'}))+
      '<p class="hint">Entries make the pot, paid out by finish. Skins money is a separate pot paid out per skin. Both are recorded per player, so the season ledger knows who is up or down.</p>'+
      field('Notes','gmNt',g?.notes||'',{type:'textarea'}),
    save:()=>{ const C=catalogById(fv('gmF'))||catalogById('stroke'), E=engineFrom(C,C.sizes?C.sizes[0]:1,1);
      const data=Object.assign({name:fv('gmN'),date:fv('gmD'),time:fv('gmT'),course:fv('gmC'),net:fv('gmNet')==='net',entry:fnum('gmE'),skinsEntry:fnum('gmS'),notes:fv('gmNt')},E);
      if(g){ Object.assign(g,data); const ev=gameEvent(g); if(ev){ ev.date=g.date; ev.scoring=g.net?'net':'gross'; EV_GAME_KEYS.forEach(k=>{ ev[k]=g[k]; }); golfSave(ev); } }
      else { const n=Object.assign({id:uid(),season:Y(),status:'open',players:[],payouts:[],golfEventId:''},data); gamesData().push(n); view.gameId=n.id;
        if(last&&last.players.length) setTimeout(()=>{ if(confirm(`Start with the ${last.players.length} players from ${gameTitle(last)} on ${shortDate(last.date)}?`)){ last.players.forEach(p=>n.players.push({id:uid(),memberId:p.memberId,name:p.name,paid:false,inSkins:!!n.skinsEntry&&p.inSkins!==false,extraIn:0,gpid:''})); persist(); render(); } },50); } },
    del:g?()=>{ if(!confirm(`Delete ${gameTitle(g)} on ${shortDate(g.date)}? Its money record goes with it.`)) return false; const ev=gameEvent(g); if(ev&&confirm('Also delete its scoring event and scores?')){ golfData().events=golfData().events.filter(e=>e!==ev); if(CLOUD&&sessionOK) sb.from('golf_events').delete().eq('id',ev.id); }
      db.games=db.games.filter(x=>x!==g); view.gameId=null; }:null,delLabel:'Delete game'});
}

/* ---------- one game ---------- */
function vGame(m,g){
  const mo=gameMoney(g), ev=gameEvent(g), live=ev&&ev.status==='live';
  if(ev&&CLOUD&&sessionOK&&!golfScores[ev.id]) setTimeout(()=>loadScores(ev),0);
  const lb=ev?eventBoard(publicEvent(ev),scoresFor(ev),{sort:g.net?'net':'gross'}):[];
  const byG=new Map(lb.map(r=>[r.id,r]));
  const pcols='grid-template-columns:minmax(0,1.6fr) 70px 80px 90px 90px 90px 40px';
  const prow=p=>{ const r=byG.get(p.gpid), inn=gpIn(g,p), out=gpOut(g,p); return `<div class="tr num click" data-gp="${p.id}" style="${pcols}"><div class="cell2"><b class="trunc">${esc(gpName(p))}</b><small>${p.memberId?'':'Guest · '}${p.inSkins&&n0(g.skinsEntry)?'in skins':''}</small></div><span>${r&&r.n?`<b>${r.posTxt}</b> <small class="muted">${r.thru==='F'?'F':'thru '+r.thru}</small>`:'<span class="muted">—</span>'}</span><span class="r">${r&&r.n?(r.unit==='points'?r.pts+' <small class="muted">pts</small>':r.unit==='holes'?(r.holesUp>0?'+':'')+r.holesUp:(g.net&&r.net!=null?r.net+' <small class="muted">net</small>':r.gross)):'<span class="muted">—</span>'}</span><span>${p.paid?'<span class="chip ok">Paid</span>':`<span class="chip warn">Owes ${gMoney(inn)}</span>`}</span><span class="r">${gMoney(inn)}</span><span class="r ${out>0?'pos':''}">${out?gMoney(out):'—'}</span><span class="ib">${I.edit}</span></div>`; };
  const payRows=g.payouts.slice().sort((a,b)=>b.amount-a.amount).map(x=>{ const p=g.players.find(y=>y.id===x.pid); return `<div class="mr num" style="grid-template-columns:minmax(0,1fr) 90px 90px"><div class="cell2"><b>${esc(p?gpName(p):'—')}</b><small>${esc(x.note||x.kind)}</small></div><span class="muted">${x.kind==='places'?'Finish':x.kind==='skins'?'Skins':'Manual'}</span><b class="r">${gMoney(x.amount)}</b></div>`; }).join('');
  const link=ev?scoringLink(ev):'';
  m.innerHTML=`<div class="crumb"><button id="gmBack">Games</button><span class="muted">/</span><span class="muted">${esc(gameTitle(g))}</span></div>
  <div class="phead"><div><h1 class="h1">${esc(gameTitle(g))}</h1><div style="display:flex;gap:8px;margin-top:12px;flex-wrap:wrap"><span class="chip navy">${esc(gameWhen(g))}</span><span class="chip">${esc(courseById(g.course)?.name||'Course TBD')}</span><span class="chip">${esc((catalogById(g.game)||{}).name||FORMAT_LABEL[g.format||'stroke'])} · ${g.net?'net':'gross'}</span><span class="chip">${gMoney(g.entry)} entry${n0(g.skinsEntry)?' · '+gMoney(g.skinsEntry)+' skins':''}</span>${g.status==='settled'?'<span class="chip navy">Settled</span>':''}${live?'<span class="chip ok">● Live scoring</span>':''}</div></div>
    <div class="actions">${g.status==='settled'?'<button class="btn" id="gmReopen">Reopen</button>':'<button class="btn" id="gmSettle" title="Everything is paid out and recorded">Mark settled</button>'}<button class="btn" id="gmEdit">${I.edit}Details</button></div></div>
  <div class="grid g4">${kpi('Players',String(g.players.length),mo.unpaid?`<span class="neg">${mo.unpaid} still owe entry</span>`:g.players.length?'all paid in':'add who’s playing')}${kpi('Pot',gMoney(mo.pot),`${g.players.length} × ${gMoney(g.entry)}${sum(g.players,p=>p.extraIn)?' + extras':''}`)}${n0(g.skinsEntry)?kpi('Skins pot',gMoney(mo.skins),`${g.players.filter(p=>p.inSkins).length} in × ${gMoney(g.skinsEntry)}`):kpi('Skins','—','no skins game')}${kpi(mo.left>0.004?'Still to pay out':mo.left<-0.004?'Paid out over the pot':'Paid out',gMoney(Math.abs(mo.left>0.004||mo.left<-0.004?mo.left:mo.paid)),mo.left>0.004?`${gMoney(mo.paid)} paid so far`:mo.left<-0.004?'check the payouts':'pot fully paid out',mo.left<-0.004?'neg':mo.left>0.004?'':'pos')}</div>
  <div class="card" style="overflow:hidden"><div class="cardhead"><h2 class="h2">Players</h2><div class="actions"><button class="btn sm" id="gmAllPaid">Mark all paid</button><button class="btn sm pri" id="gmAdd">${I.plus}Add players</button></div></div>
    ${g.players.length?`<div class="tw"><div class="t" style="min-width:720px"><div class="tr th" style="${pcols}"><span>Player</span><span>Finish</span><span class="r">Score</span><span>Entry</span><span class="r">In</span><span class="r">Won</span><span></span></div>${g.players.slice().sort((a,b)=>((byG.get(a.gpid)||{}).pos||99)-((byG.get(b.gpid)||{}).pos||99)||gpName(a).localeCompare(gpName(b))).map(prow).join('')}</div></div>`:'<div class="empty"><b>Nobody in yet</b><span>Add the regulars from the member list, or a guest by name.</span></div>'}</div>
  <div class="split">
    <div class="card pad" style="display:flex;flex-direction:column;gap:12px"><div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px"><h2 class="h2">Live scoring</h2>${ev?(live?'<button class="btn sm" id="gmClose">Close scoring</button>':'<button class="btn sm" id="gmOpen">Reopen scoring</button>'):''}</div>
      ${ev?`<div class="cell2"><span class="lbl">Scoring link — players enter their group ID</span><a href="${esc(link)}" target="_blank" rel="noopener" class="trunc" style="font-weight:600">${esc(link)}</a></div>
        <div class="actions"><button class="btn sm" id="gmCopy">Copy link</button><a class="btn sm" href="${esc(link)}&view=board" target="_blank" rel="noopener">Leaderboard screen</a><button class="btn sm" id="gmSync">Update groups</button>${enabledGames().some(x=>x.tool)?`<button class="btn sm" id="gmDraw">Draw partners</button>`:''}</div>
        <div class="mini">${ev.groups.map(grp=>`<div class="mr" style="grid-template-columns:minmax(0,1fr) auto"><div class="cell2"><b>Group ${esc(grp.code)}</b><small>${esc(grp.players.map(p=>p.name.split(' ')[0]).join(', '))}</small></div><button class="btn sm" data-gsheet="${grp.id}">Enter scores</button></div>`).join('')}</div>
        <p class="hint">Players in groups of four; each group types its ID on the scoring page. Enter scores here for anyone who doesn’t.</p>`
      :`<p class="muted" style="margin:0">Open live scoring and every player gets a group ID for the scoring page on their phone. Finish and skins payouts then come straight from the scores.</p><div class="actions"><button class="btn pri" id="gmOpen"${g.players.length?'':' disabled'}>Open live scoring</button></div>`}</div>
    <div class="card pad" style="display:flex;flex-direction:column;gap:12px"><div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px"><h2 class="h2">Payouts</h2><div class="actions"><button class="btn sm" id="gmPlaces">By finish</button>${n0(g.skinsEntry)?'<button class="btn sm" id="gmSkins">Skins</button>':''}<button class="btn sm" id="gmManual">${I.plus}Payout</button></div></div>
      ${payRows?`<div class="mini">${payRows}<div class="mr num" style="grid-template-columns:minmax(0,1fr) 90px"><b>Paid out</b><b class="r">${gMoney(mo.paid)}</b></div></div>`:'<p class="muted" style="margin:0">Nothing paid out yet. Split the pot by finish, pay the skins, or add a payout by hand.</p>'}
      ${Math.abs(mo.left)>0.004&&mo.paid?`<p class="hint ${mo.left<0?'neg':''}">${mo.left>0?gMoney(mo.left)+' of the pot is not allocated.':gMoney(-mo.left)+' more than the pot has been paid out.'}</p>`:''}</div>
  </div>
  ${g.notes?`<div class="card pad"><span class="lbl">Notes</span><p style="margin:6px 0 0;white-space:pre-wrap">${esc(g.notes)}</p></div>`:''}`;
  $('gmBack').onclick=()=>{ view.gameId=null; render(); }; $('gmEdit').onclick=()=>editGame(g);
  $('gmAdd').onclick=()=>addGamePlayers(g); $('gmAllPaid').onclick=()=>{ g.players.forEach(p=>p.paid=true); persist(); render(); toast('Everyone marked paid'); };
  const st=$('gmSettle'); if(st) st.onclick=()=>{ if(Math.abs(mo.left)>0.004&&!confirm(`${gMoney(Math.abs(mo.left))} ${mo.left>0?'is still unallocated':'over the pot'}. Mark settled anyway?`)) return; g.status='settled'; persist(); render(); };
  const ro=$('gmReopen'); if(ro) ro.onclick=()=>{ g.status='open'; persist(); render(); };
  const op=$('gmOpen'); if(op) op.onclick=()=>openScoring(g);
  const cl=$('gmClose'); if(cl) cl.onclick=()=>{ ev.status='final'; golfSave(ev); render(); toast('Scoring closed'); };
  const cp=$('gmCopy'); if(cp) cp.onclick=async()=>{ try{ await navigator.clipboard.writeText(link); toast('Link copied'); }catch(_){ prompt('Copy this link:',link); } };
  const sy=$('gmSync'); if(sy) sy.onclick=()=>{ syncGameEvent(g,ev); golfSave(ev); render(); toast('Groups updated'); };
  const dw=$('gmDraw'); if(dw) dw.onclick=()=>drawPartners(ev);
  m.querySelectorAll('[data-gsheet]').forEach(b=>b.onclick=()=>scoreSheet(ev,ev.groups.find(x=>x.id===b.dataset.gsheet)));
  m.querySelectorAll('[data-gp]').forEach(r=>r.onclick=()=>editGamePlayer(g,g.players.find(p=>p.id===r.dataset.gp)));
  $('gmPlaces').onclick=()=>payPlaces(g); const sk=$('gmSkins'); if(sk) sk.onclick=()=>paySkins(g); $('gmManual').onclick=()=>payManual(g,null);
}
function addGamePlayers(g){
  const inG=new Set(g.players.map(p=>p.memberId).filter(Boolean));
  const pool=members().filter(x=>x.status!=='Inactive'&&!inG.has(x.id)).sort((a,b)=>memberName(a).localeCompare(memberName(b)));
  const picked=new Set(); let guests=[];
  const list=q=>{ q=q.toLowerCase(); return pool.filter(x=>!q||memberName(x).toLowerCase().includes(q)).map(x=>`<label class="check" style="padding:6px 0;border-bottom:1px solid var(--line)"><input type="checkbox" data-pk="${x.id}"${picked.has(x.id)?' checked':''}><span class="av" style="margin:0 8px">${initials(x)}</span>${esc(memberName(x))}<span class="muted" style="margin-left:auto;font-size:12.5px">${x.hcp?'Index '+esc(x.hcp):''}</span></label>`).join('')||'<span class="muted">No one left to add.</span>'; };
  openDrawer({kicker:gameTitle(g),title:'Add players',saveLabel:'Add',
    body:`<input class="inp" id="apQ" placeholder="Search members" aria-label="Search members"><div id="apL" style="max-height:320px;overflow:auto">${list('')}</div>
      <div class="fld"><span class="lbl">Guest</span><div style="display:grid;grid-template-columns:minmax(0,1fr) auto;gap:8px"><input class="inp" id="apG" placeholder="Guest name"><button class="btn" type="button" id="apGAdd">Add guest</button></div><p class="hint" id="apGList" style="margin:0"></p></div>`,
    wire:r=>{ const bind=()=>r.querySelectorAll('[data-pk]').forEach(c=>c.onchange=()=>{ if(c.checked) picked.add(c.dataset.pk); else picked.delete(c.dataset.pk); });
      bind(); r.querySelector('#apQ').oninput=e=>{ r.querySelector('#apL').innerHTML=list(e.target.value); bind(); };
      r.querySelector('#apGAdd').onclick=()=>{ const n=r.querySelector('#apG').value.trim(); if(!n) return; guests.push(n); r.querySelector('#apG').value=''; r.querySelector('#apGList').textContent='Guests: '+guests.join(', '); }; },
    save:()=>{ if(!picked.size&&!guests.length){ toast('Pick someone'); return false; }
      [...picked].forEach(id=>g.players.push({id:uid(),memberId:id,name:'',paid:false,inSkins:!!n0(g.skinsEntry),extraIn:0,gpid:''}));
      guests.forEach(n=>g.players.push({id:uid(),memberId:'',name:n,paid:false,inSkins:!!n0(g.skinsEntry),extraIn:0,gpid:''}));
      const ev=gameEvent(g); if(ev){ syncGameEvent(g,ev); golfSave(ev); }
      toast(`${picked.size+guests.length} added`); }});
}
function editGamePlayer(g,p){
  const out=gpOut(g,p);
  openDrawer({kicker:gameTitle(g),title:gpName(p),
    body:`<label class="check"><input type="checkbox" id="gpPaid"${p.paid?' checked':''}>Entry paid (${gMoney(gpIn(g,p))})</label>`+(n0(g.skinsEntry)?`<label class="check"><input type="checkbox" id="gpSk"${p.inSkins?' checked':''}>In the skins game (${gMoney(g.skinsEntry)})</label>`:'')+
      field('Extra money in $','gpX',p.extraIn||0,{type:'number',hint:'Side action put through the group, e.g. a double entry.'})+(out?`<p class="hint">Won ${gMoney(out)} in this game — change it under Payouts.</p>`:''),
    save:()=>{ p.paid=$('gpPaid').checked; if($('gpSk')) p.inSkins=$('gpSk').checked; p.extraIn=fnum('gpX'); },
    del:()=>{ if(out&&!confirm(`${gpName(p)} has ${gMoney(out)} in payouts recorded. Remove anyway?`)) return false; g.players=g.players.filter(x=>x!==p); g.payouts=g.payouts.filter(x=>x.pid!==p.id); const ev=gameEvent(g); if(ev){ syncGameEvent(g,ev); golfSave(ev); } },delLabel:'Remove from game'});
}

/* ---------- live scoring through the Golf module ---------- */
function openScoring(g){
  if(!g.players.length){ toast('Add players first'); return; }
  const G=golfData(); let ev=gameEvent(g);
  if(!ev){ let slug=slugify(orgShort()+'-'+(g.date||'game')), n=2; while(G.events.some(e=>e.slug===slug)) slug=slugify(orgShort()+'-'+(g.date||'game'))+'-'+(n++);
    ev=Object.assign({id:uid(),status:'draft',name:gameTitle(g)+(g.date?' · '+shortDate(g.date):''),date:g.date,defaultTee:'White',defaultCourse:g.course||'oak',slug,tournamentId:'',front:'scramble',back:'shamble',scoring:g.net?'net':'gross',allow:{},groups:[],pool:[],flights:{count:0,names:[]},createdAt:new Date().toISOString(),gameId:g.id},engineFrom(catalogById(g.game||g.format||'stroke')||catalogById('stroke'),g.teamSize||1,g.count||1));
    G.events.push(ev); g.golfEventId=ev.id; }
  syncGameEvent(g,ev); ev.status='live'; golfSave(ev); render(); toast('Scoring is open — share the link');
}
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

/* ---------- payouts ---------- */
function defaultPcts(n){ return n<=5?[100]:n<=8?[60,40]:n<=15?[50,30,20]:[40,30,20,10]; }
/* places × percentages, ties share the places they cover, cent-exact (odd cents to the better-named) */
function splitByFinish(amount,order,pcts){   // order: [{id,name,pos}] sorted by pos
  const cents=Math.round(n0(amount)*100), placeC=pcts.map(p=>Math.floor(cents*p/100)); let rem=cents-placeC.reduce((a,b)=>a+b,0); for(let i=0;rem>0;i++,rem--) placeC[i%placeC.length]++;
  const out=[]; let i=0;
  while(i<order.length&&i<pcts.length){ const pos=order[i].pos; const tied=order.filter(r=>r.pos===pos); const covered=placeC.slice(i,i+tied.length); const total=covered.reduce((a,b)=>a+b,0);
    if(!total) break; const each=Math.floor(total/tied.length); let odd=total-each*tied.length;
    tied.forEach(r=>{ out.push({id:r.id,name:r.name,pos,amount:(each+(odd-->0?1:0))/100}); }); i+=tied.length; }
  return out;
}
function payPlaces(g){
  const ev=gameEvent(g), mo=gameMoney(g);
  const lb=ev?eventBoard(publicEvent(ev),scoresFor(ev),{sort:g.net?'net':'gross'}).filter(r=>r.n):[];
  const byG=new Map(g.players.map(p=>[p.gpid,p]));
  let order=lb.filter(r=>byG.has(r.id)).map(r=>({id:byG.get(r.id).id,name:gpName(byG.get(r.id)),pos:r.pos}));
  const manual=!order.length;
  const existing=g.payouts.filter(x=>x.kind==='places');
  let pcts=defaultPcts(g.players.length);
  const preview=()=>{ const o=manual?g.players.map(p=>({id:p.id,name:gpName(p),pos:+($('pf_'+p.id)?.value||0)})).filter(x=>x.pos>0).sort((a,b)=>a.pos-b.pos):order;
    const res=splitByFinish(fnum('pfAmt'),o,pcts); const el=$('pfPrev'); if(el) el.innerHTML=res.length?res.map(r=>`<div class="mr num" style="grid-template-columns:40px minmax(0,1fr) 90px"><b>${r.pos}</b><span>${esc(r.name)}</span><b class="r">${gMoney(r.amount)}</b></div>`).join('')+`<div class="mr num" style="grid-template-columns:minmax(0,1fr) 90px"><span class="muted">Total</span><b class="r">${gMoney(sum(res,r=>r.amount))}</b></div>`:'<div class="mr"><span class="muted">Nothing to split yet.</span></div>'; return res; };
  openDrawer({kicker:gameTitle(g),title:'Pay out by finish',saveLabel:'Record payouts',wide:manual,
    body:pair(field('Pot to split $','pfAmt',mo.pot,{type:'number'}),field('Split %','pfP',pcts.join(' / '),{hint:'1st / 2nd / 3rd… Ties share the places they cover.'}))+
      (manual?`<div class="fld"><span class="lbl">Finish positions ${ev?'(no scores yet — enter them by hand)':'(no live scoring — enter them by hand)'}</span><div class="mini">${g.players.map(p=>`<div class="mr" style="grid-template-columns:minmax(0,1fr) 80px"><span>${esc(gpName(p))}</span><input class="inp r" id="pf_${p.id}" inputmode="numeric" placeholder="—" aria-label="${esc(gpName(p))} finish"></div>`).join('')}</div><p class="hint">Same number = tied.</p></div>`
        :`<p class="hint">From the ${g.net?'net':'gross'} leaderboard: ${esc(order.slice(0,4).map(r=>r.pos+'. '+r.name).join(' · '))}${order.length>4?' …':''}</p>`)+
      `<div class="fld"><span class="lbl">Payouts</span><div class="mini" id="pfPrev"></div></div>`+(existing.length?'<p class="hint">Replaces the finish payouts recorded earlier for this game.</p>':''),
    wire:r=>{ const re=()=>{ pcts=fv('pfP').split(/[\/,\s]+/).map(Number).filter(x=>x>0); if(!pcts.length) pcts=[100]; preview(); }; r.querySelectorAll('input').forEach(i=>i.oninput=re); re(); },
    save:()=>{ const res=preview(); if(!res.length){ toast('Enter finish positions first'); return false; }
      g.payouts=g.payouts.filter(x=>x.kind!=='places').concat(res.map(r=>({id:uid(),kind:'places',pid:r.id,amount:r.amount,note:gOrdinal(r.pos)+(res.filter(x=>x.pos===r.pos).length>1?' (tied)':'')})));
      toast(`${res.length} finish payout${res.length===1?'':'s'} recorded`); }});
}
const gOrdinal=n=>n+(['th','st','nd','rd'][(n%100>>3^1&&n%10)||0]||'th');
/* skins come from the hole scores of the players marked "in skins" (see skinsResult in golfcore) */
const SKINS_DEFAULT=g=>Object.assign({net:!!g.net,grossBeatsNet:false,carry:true,validate:'none'},g.skinsRules||{});
function skinsCalc(g,rules){
  const ev=gameEvent(g); if(!ev) return null;
  const byG=new Map(g.players.filter(p=>p.inSkins&&p.gpid).map(p=>[p.gpid,p]));
  const r=skinsResult(publicEvent(ev),scoresFor(ev),rules||SKINS_DEFAULT(g),[...byG.keys()]);
  r.wins.forEach(w=>{ const p=byG.get(w.pid); w.pid=p.id; w.name=gpName(p); }); r.per=Object.fromEntries(Object.entries(r.per).map(([k,v])=>[byG.get(k).id,v])); return r;
}
const skinsRuleText=r=>[r.net?(r.grossBeatsNet?'net, gross beats net':'net'):'gross',r.carry?'carry-overs':'no carry-overs',r.validate==='gross'?'validated by par on the next hole':r.validate==='net'?'validated by net par on the next hole':''].filter(Boolean).join(' · ');
function paySkins(g){
  const ev=gameEvent(g), mo=gameMoney(g);
  if(!ev){ toast('Open live scoring first — skins come from the hole-by-hole scores'); return; }
  const rules=SKINS_DEFAULT(g);
  const calc=()=>{ const r=skinsCalc(g,rules), pot=fnum('skAmt'), el=$('skPrev'); if(!el) return r;
    if(!r||!r.wins.length){ el.innerHTML=`<div class="mr"><span class="muted">${r&&r.incomplete===18?'No scores yet':'No skins won yet'+(r&&r.carried?` · ${r.carried} carried`:'')}.</span></div>`; return r; }
    const val=r.total?pot/r.total:0;
    el.innerHTML=r.wins.map(w=>`<div class="mr num" style="grid-template-columns:60px minmax(0,1fr) 90px"><b>Hole ${w.hole}</b><div class="cell2"><span>${esc(w.name)} <span class="muted">${w.score}${rules.net&&w.net!==w.score?' (net '+w.net+')':''}${w.count>1?' · '+w.count+' skins':''}</span></span>${w.status==='void'?`<small class="neg">Void — missed ${rules.validate==='net'?'net ':''}par on hole ${w.checkHole}${rules.carry?', carried':''}</small>`:w.status==='pending'?`<small class="muted">Waiting on hole ${w.checkHole} to validate</small>`:''}</div><b class="r ${w.status==='won'?'':'muted'}">${w.status==='won'?gMoney(val*w.count):'—'}</b></div>`).join('')+
      `<div class="mr num" style="grid-template-columns:minmax(0,1fr) 90px"><span class="muted">${r.total} skin${r.total===1?'':'s'}${r.total?' at '+gMoney(val):''}${r.pending?` · ${r.pending} pending`:''}${r.incomplete?` · ${r.incomplete} hole${r.incomplete===1?'':'s'} not finished by everyone`:''}${r.carried?` · ${r.carried} carried, unpaid`:''}${r.lost?` · ${r.lost} void, unpaid`:''}</span><b class="r">${gMoney(r.total?pot:0)}</b></div>`; return r; };
  openDrawer({kicker:gameTitle(g),title:'Pay out skins',saveLabel:'Record skins',
    body:pair(field('Skins pot $','skAmt',mo.skins,{type:'number'}),`<div class="fld"><span class="lbl">Scoring</span>${seg('skNet',[['gross','Gross'],['net','Net'],['gbn','Net · gross beats net']],rules.net?(rules.grossBeatsNet?'gbn':'net'):'gross')}</div>`)+
      pair(field('Validation','skVal',rules.validate,{type:'select',options:[['none','None — a skin stands on its own'],['gross','Par or better on the next hole'],['net','Net par or better on the next hole']]}),`<div class="fld"><span class="lbl">Ties</span><label class="check" style="height:42px"><input type="checkbox" id="skCarry"${rules.carry?' checked':''}>Carry over to the next hole</label></div>`)+
      `<div class="fld"><span class="lbl">Skins</span><div class="mini" id="skPrev"></div></div><p class="hint">Only players marked “in skins” count, and a hole counts once all of them have scored it. Gross beats net: on a net tie, the one player who made that score without a stroke takes the skin. Validation: the winner must make par (or net par) on their next hole or the skin is void — it goes back into the carry, or is lost without carry-overs; a skin on the last hole stands. Carried skins with no winner at the end are not paid.</p>`,
    wire:r=>{ wireSeg(r,'skNet',v=>{ rules.net=v!=='gross'; rules.grossBeatsNet=v==='gbn'; calc(); }); r.querySelector('#skVal').onchange=e=>{ rules.validate=e.target.value; calc(); }; r.querySelector('#skCarry').onchange=e=>{ rules.carry=e.target.checked; calc(); }; r.querySelector('#skAmt').oninput=calc; calc(); },
    save:()=>{ const r=skinsCalc(g,rules); g.skinsRules=Object.assign({},rules); if(!r||!r.total){ toast(r&&r.pending?'Skins are still waiting on validation holes':'No skins to pay yet'); return false; } const pot=fnum('skAmt'), val=pot/r.total;
      const cents=Object.entries(r.per).map(([pid,n])=>({pid,n,c:Math.floor(pot*100*n/r.total)})); let rem=Math.round(pot*100)-cents.reduce((a,x)=>a+x.c,0); for(let i=0;rem>0;i++,rem--) cents[i%cents.length].c++;
      g.payouts=g.payouts.filter(x=>x.kind!=='skins').concat(cents.map(x=>({id:uid(),kind:'skins',pid:x.pid,amount:x.c/100,note:`${x.n} skin${x.n===1?'':'s'} · ${skinsRuleText(rules)}`})));
      toast(`${r.total} skins paid at ${gMoney(val)}`); }});
}
function payManual(g,x){
  openDrawer({kicker:gameTitle(g),title:x?'Payout':'Add payout',
    body:field('To','pmP',x?x.pid:'',{type:'select',options:[['','— Player —']].concat(g.players.map(p=>[p.id,gpName(p)]))})+pair(field('Amount $','pmA',x?x.amount:'',{type:'number'}),field('For','pmN',x?x.note:'',{ph:'e.g. closest to the pin'})),
    save:()=>{ const pid=fv('pmP'), amt=fnum('pmA'); if(!pid||!amt){ toast('Pick a player and an amount'); return false; }
      if(x) Object.assign(x,{pid,amount:amt,note:fv('pmN')}); else g.payouts.push({id:uid(),kind:'manual',pid,amount:amt,note:fv('pmN')}); },
    del:x?()=>{ g.payouts=g.payouts.filter(y=>y!==x); }:null,delLabel:'Remove payout'});
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
  const through=sum(gs,g=>gameMoney(g).total), leader=rows[0];
  m.innerHTML=head(`${Y()} Season`,esc(CLUB.name||CLUB_META.name)+' · '+esc(orgName()),btn('New game','dNewG','pri',I.plus))+`
  <div class="grid g4">
    ${kpi('Next game',next?(next.date?shortDate(next.date).replace(/, \d{4}$/,''):'TBD'):'—',next?`${esc(gameTitle(next))}${next.time?' · '+fmtTime(next.time):''} · ${next.players.length} in`:'nothing scheduled')}
    ${kpi('Games played',String(gs.filter(g=>!isUpcoming(g)).length),last?`last: ${esc(gameTitle(last))} · ${shortDate(last.date)}`:'')}
    ${kpi('Through the group',gMoney(through),'entries and skins this season')}
    ${kpi('Leading the season',leader&&leader.net>0.004?esc(leader.name.split(' ')[0]):'—',leader&&leader.net>0.004?gSigned(leader.net)+' · '+leader.games+' games':'no money won yet','pos')}
  </div>
  <div class="split">
    <div class="card" style="overflow:hidden"><div class="cardhead"><h2 class="h2">Games</h2><button class="btn sm" data-go="games">All games</button></div>
      ${gs.length?`<div class="t">${gs.slice(0,6).map(g=>{ const mo=gameMoney(g), ev=gameEvent(g); return `<div class="tr num click" data-game="${g.id}" style="grid-template-columns:100px minmax(0,1fr) 90px 100px"><span>${g.date?shortDate(g.date).replace(/, \d{4}$/,''):'TBD'}</span><div class="cell2"><b class="trunc">${esc(gameTitle(g))}</b><small>${g.players.length} players${ev&&ev.status==='live'?' · <span class="pos">● live</span>':''}</small></div><span class="r">${gMoney(mo.total)}</span><span>${g.status==='settled'?'<span class="chip navy">Settled</span>':isUpcoming(g)?'<span class="chip">Upcoming</span>':Math.abs(mo.left)>0.004?'<span class="chip warn">Open</span>':'<span class="chip ok">Paid out</span>'}</span></div>`; }).join('')}</div>`
      :`<div class="empty"><b>No games yet</b><span>Set up the regular game to start the season.</span><div class="actions"><button class="btn pri" id="dNewG2">${I.plus}New game</button></div></div>`}</div>
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
