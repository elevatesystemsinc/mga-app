/* =====================================================================
   Club Hub — Games (small groups). The regular game: who played, live scoring through the Golf module, and any
   number of competitions ("pots") running at once on the same scores — stroke play paying three places, a best ball
   with partners drawn after the round, skins, dots, closest to the pin… each with its own entry, its own players and
   its own payout. The season Ledger totals it all.
   Data (group document):
     db.games=[{id,season,date,time,name,course,notes,status:'open'|'settled',payWhen:'after'|'before',settle:'pot'|'net',
                golfEventId,players:[{id,memberId,name,paid,extraIn,gpid}],          gpid = the player's id in the scoring event
                pots:[{id,kind:'format'|'skins'|'dots'|'manual',name,entry,inn:{pid:true},
                       rules:{game,scoring:'gross'|'net',teamSize,count,teamsBy:'hand'|'before'|'after',places:[60,30,10],skins:{…},dots:{…}},
                       teams:{gpid:'S1'},draw:{at,method,size,log:[{at,reason}]},tally:{pid:{Sandy:1}},payouts:[{id,pid,amount,note}]}]}]
     db.ledgerAdj=[{id,season,date,memberId,amount,desc}]                 side bets, settle-ups, corrections
   A player's in = Σ entries of the pots they are in (+ extras); out = Σ payouts; net = out − in (+ adjustments).
   Everyone plays their own ball once; every competition is scored from those scores (potPub). Only a one-ball game
   (scramble, foursomes, greensome) changes how the round is played, and then it is the event's format.
   ===================================================================== */
I.trophy=svg('<path d="M8 4h8v5a4 4 0 01-8 0z"/><path d="M8 6H5a3 3 0 003 3M16 6h3a3 3 0 01-3 3"/><path d="M12 13v4M9 20h6"/>');
I.cash=svg('<rect x="3" y="6" width="18" height="12" rx="2"/><circle cx="12" cy="12" r="2.5"/><path d="M7 12h.01M17 12h.01"/>');
NAV.splice(1,0,['games','Games',I.trophy],['ledger','Ledger',I.cash]);
ORG_NAV.group=['dash','games','ledger','tournaments','golf','members'];   // small groups run their own tournaments too
view.gameId=null; view.lrange='season'; view.gdesign=null;
const isGroup=()=>!!db&&db.kind==='group';
const POT_KINDS={format:'Competition',skins:'Skins',dots:'Dots / doodah',manual:'Winners by hand'};
const TEAMS_BY={hand:'picked by hand',before:'drawn before the round',after:'drawn after the round'};
function gamesData(){
  db.games=db.games||[]; db.ledgerAdj=db.ledgerAdj||[];
  for(const g of db.games){ g.players=g.players||[];
    if(!g.pots){   // games from before pots: entry → the main pot, skins entry → a skins pot, old payouts by kind
      g.pots=[]; const inAll=Object.fromEntries(g.players.map(p=>[p.id,true]));
      g.pots.push({id:uid(),kind:'finish',name:'Main game',entry:n0(g.entry),inn:inAll,rules:{},payouts:(g.payouts||[]).filter(x=>x.kind==='places').map(x=>({id:x.id,pid:x.pid,amount:x.amount,note:x.note}))});
      if(n0(g.skinsEntry)||(g.payouts||[]).some(x=>x.kind==='skins')) g.pots.push({id:uid(),kind:'skins',name:'Skins',entry:n0(g.skinsEntry),inn:Object.fromEntries(g.players.filter(p=>p.inSkins!==false).map(p=>[p.id,true])),rules:g.skinsRules||{},payouts:(g.payouts||[]).filter(x=>x.kind==='skins').map(x=>({id:x.id,pid:x.pid,amount:x.amount,note:x.note}))});
      const man=(g.payouts||[]).filter(x=>x.kind==='manual'); if(man.length) g.pots.push({id:uid(),kind:'manual',name:'Other payouts',entry:0,inn:{},rules:{},payouts:man.map(x=>({id:x.id,pid:x.pid,amount:x.amount,note:x.note}))});
      delete g.payouts; }
    if(!g.payWhen) g.payWhen='after'; if(!g.settle) g.settle='pot';
    g.pots.forEach(p=>{ p.inn=p.inn||{}; p.payouts=p.payouts||[]; p.rules=p.rules||{};
      if(p.kind==='finish'){   // the old "main game" becomes an ordinary competition with the game's format
        p.kind='format'; const C=catalogById(g.game||g.format||'stroke')||catalogById('stroke');
        Object.assign(p.rules,{game:C.id,scoring:g.net?'net':'gross',teamSize:g.teamSize||(C.sizes?C.sizes[0]:1),count:g.count||1,teamsBy:p.rules.teamsBy||'hand'}); }
      if(p.kind==='skins'){ p.rules.game='skins'; const sk=p.rules.skins=p.rules.skins||{}; if(sk.validate==='gross') sk.validate='par'; if(sk.validate==='net') sk.validate='netpar'; if(!sk.mode) sk.mode='pot'; }
      if(p.kind==='dots') p.rules.game='dots';
      if(p.kind==='format'){ if(!p.rules.game) p.rules.game='stroke'; if(!p.rules.scoring) p.rules.scoring=g.net?'net':'gross'; if(!p.rules.teamsBy) p.rules.teamsBy='hand'; } }); }
  return db.games;
}
const seasonGames=()=>gamesData().filter(g=>g.season===Y()).sort((a,b)=>(b.date||'').localeCompare(a.date||'')||(b.time||'').localeCompare(a.time||''));
const GAME=()=>gamesData().find(g=>g.id===view.gameId);
const gMoney=v=>Math.abs(n0(v)-Math.round(n0(v)))<0.005?fmt(v):fmt2(v);
const gSigned=v=>n0(v)>0.004?'+'+gMoney(v):n0(v)<-0.004?'−'+gMoney(Math.abs(v)):gMoney(0);
const gpName=p=>p.memberId?(memberName(memberById(p.memberId))||p.name||'Member'):(p.name||'Guest');
const potIn=(pot,p)=>!!pot.inn[p.id];
const potPlayers=(g,pot)=>g.players.filter(p=>potIn(pot,p));
const potTotal=(g,pot)=>sum(potPlayers(g,pot),()=>n0(pot.entry));
const potPaid=pot=>sum(pot.payouts,x=>x.amount);
const gpIn=(g,p)=>sum(g.pots.filter(pot=>potIn(pot,p)),pot=>n0(pot.entry))+n0(p.extraIn);
const gpOut=(g,p)=>sum(g.pots,pot=>sum(pot.payouts.filter(x=>x.pid===p.id),x=>x.amount));
function gameMoney(g){ const total=sum(g.pots,pot=>potTotal(g,pot))+sum(g.players,p=>n0(p.extraIn)), paid=sum(g.pots,potPaid);
  return {total,paid,left:total-paid,unpaid:g.players.filter(p=>!p.paid&&gpIn(g,p)>0).length,entry:sum(g.pots.filter(p=>p.kind!=='manual'),p=>n0(p.entry))}; }
const gameEvent=g=>g&&g.golfEventId?golfData().events.find(e=>e.id===g.golfEventId):null;
const gameTitle=g=>g.name||(orgShort()+' game');
const gameName=g=>g.pots.filter(p=>p.kind!=='manual').map(p=>p.name).join(' · ')||'No competitions yet';
const gameWhen=g=>(g.date?shortDate(g.date):'Date TBD')+(g.time?' · '+fmtTime(g.time):'');
const isUpcoming=g=>{ const d=parseD(g.date); if(!d) return true; const now=new Date(); now.setHours(0,0,0,0); return d>=now; };
/* the catalog entry behind a pot and what it implies */
const potCat=pot=>catalogById(pot.rules.game)||catalogById(pot.kind==='skins'?'skins':pot.kind==='dots'?'dots':'stroke');
const potEngine=pot=>{ const C=potCat(pot); return engineFrom(C,pot.rules.teamSize||(C.sizes?C.sizes[0]:(C.engine.teamSize||1)),pot.rules.count||1); };
const potIsTeam=pot=>pot.kind==='format'&&(()=>{ const E=potEngine(pot); return !!((FORMATS[E.format]||{}).team)&&E.teamSize>=2; })();
const potOneBall=pot=>pot.kind==='format'&&(FORMATS[potEngine(pot).format]||{}).entry==='team';
const potTeamsKnown=pot=>!!(pot.teams&&Object.keys(pot.teams).length);
const kindOfGame=id=>{ const C=catalogById(id); return !C?'manual':C.id==='skins'?'skins':C.id==='dots'?'dots':C.manual?'manual':'format'; };
function potSummary(pot){
  if(pot.kind==='skins') return 'Skins · '+skinsRuleText(skinsRulesOf(pot));
  if(pot.kind==='dots') return 'Dots · '+dotsRuleText(pot);
  if(pot.kind==='manual') return (potCat(pot).name||'Winners entered by hand');
  const E=potEngine(pot), C=potCat(pot); let s=C.name+(potIsTeam(pot)?` · ${E.teamSize}-player teams`:'')+' · '+(pot.rules.scoring||'gross');
  if(potIsTeam(pot)) s+=' · partners '+TEAMS_BY[pot.rules.teamsBy||'hand'];
  if(pot.rules.nassau){ const ns=nassauStakes(pot); s+=` · front ${gMoney(ns.front)} · back ${gMoney(ns.back)} · 18 ${gMoney(ns.total)}`; }
  else if(pot.rules.places&&pot.rules.places.length) s+=' · pays '+pot.rules.places.join(' / ')+'%';
  return s;
}
const nassauStakes=pot=>Object.assign({front:5,back:5,total:10},pot.rules.nassau||{});
function newPot(game,g,extra){
  const kind=kindOfGame(game), C=catalogById(game)||catalogById('stroke');
  const pot={id:uid(),kind,name:C.name.replace(/ \(.*$/,''),entry:kind==='manual'?0:5,inn:Object.fromEntries((g&&kind!=='manual'?g.players:[]).map(p=>[p.id,true])),rules:{game},payouts:[]};
  if(kind==='format'){ Object.assign(pot.rules,{scoring:'net',teamSize:C.engine.teamSize||(C.sizes?C.sizes[0]:1),count:1,teamsBy:(C.engine.draw==='after'?'after':'hand'),places:[]}); pot.entry=20;
    if(C.engine.format==='match'&&C.engine.matchScoring==='nassau'&&(C.engine.teamSize||1)>1){ pot.rules.nassau={front:5,back:5,total:10}; pot.entry=20; } }
  if(kind==='skins'){ pot.rules.skins={net:true,grossBeatsNet:true,validate:'netpar',mode:'pot',live:false}; }
  if(kind==='dots'){ pot.rules.dots=Object.assign({},DOTS_DEFAULT); pot.entry=2; }
  return Object.assign(pot,extra||{});
}
/* a game and its scoring event go together */
function deleteGame(g){ const ev=gameEvent(g); if(ev){ golfData().events=golfData().events.filter(e=>e!==ev); if(CLOUD&&sessionOK) deleteEventRow(ev.id); } db.games=db.games.filter(x=>x!==g); }
function addPlayer(g,o){ const p={id:uid(),memberId:o.memberId||'',name:o.name||'',paid:false,extraIn:0,gpid:''}; g.players.push(p); g.pots.forEach(pot=>{ if(pot.kind!=='manual') pot.inn[p.id]=true; }); return p; }
function removePlayer(g,p){ g.players=g.players.filter(x=>x!==p); g.pots.forEach(pot=>{ delete pot.inn[p.id]; pot.payouts=pot.payouts.filter(x=>x.pid!==p.id); if(pot.teams&&p.gpid) delete pot.teams[p.gpid]; });
  const ev=gameEvent(g); if(ev&&p.gpid){ ev.groups.forEach(grp=>{ grp.players=grp.players.filter(x=>x.id!==p.gpid); }); ev.pool=(ev.pool||[]).filter(x=>x.id!==p.gpid); } }

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
/* settlement for one game: what each player put in, took out and nets; and, for net settlement, who pays whom */
function settlement(g){
  const rows=g.players.map(p=>({p,name:gpName(p),inn:gpIn(g,p),out:gpOut(g,p)})).map(r=>Object.assign(r,{net:Math.round((r.out-r.inn)*100)/100})).sort((a,b)=>b.net-a.net||a.name.localeCompare(b.name));
  return {rows,inn:sum(rows,r=>r.inn),out:sum(rows,r=>r.out),transfers:settleUp(rows)};
}
/* the fewest payments that square everyone up: biggest debtor pays biggest creditor, and so on */
function settleUp(rows){
  const cr=rows.filter(r=>r.net>0.004).map(r=>({name:r.name,left:Math.round(r.net*100)})).sort((a,b)=>b.left-a.left), de=rows.filter(r=>r.net<-0.004).map(r=>({name:r.name,left:Math.round(-r.net*100)})).sort((a,b)=>b.left-a.left), out=[];
  let i=0,j=0; while(i<de.length&&j<cr.length){ const x=Math.min(de[i].left,cr[j].left); if(x>0) out.push({from:de[i].name,to:cr[j].name,amount:x/100}); de[i].left-=x; cr[j].left-=x; if(!de[i].left) i++; if(!cr[j].left) j++; }
  return out;
}

/* ---------- Games list ---------- */
function vGames(m){
  gamesData();
  if(view.gdesign) return vGameDesign(m);
  if(view.gameId&&GAME()) return vGame(m,GAME());
  view.gameId=null;
  const gs=seasonGames(), up=gs.filter(isUpcoming).reverse(), past=gs.filter(g=>!isUpcoming(g));
  const tot=gs.reduce((a,g)=>{ a.money+=gameMoney(g).total; a.players+=g.players.length; return a; },{money:0,players:0});
  const cols='grid-template-columns:120px minmax(0,1.5fr) minmax(0,1fr) 80px 100px 110px 40px';
  const row=g=>{ const mo=gameMoney(g), ev=gameEvent(g); return `<div class="tr num click" data-game="${g.id}" style="${cols}"><span>${g.date?shortDate(g.date).replace(/, \d{4}$/,''):'TBD'}${g.time?`<br><small class="muted">${fmtTime(g.time)}</small>`:''}</span><div class="cell2"><b class="trunc" style="color:var(--navy)">${esc(gameTitle(g))}</b><small class="trunc">${esc(gameName(g))}${ev&&isLiveNow(ev)?' · <span class="pos">● live</span>':''}</small></div><span class="muted">${g.players.length} player${g.players.length===1?'':'s'}${mo.unpaid&&!isUpcoming(g)?` · <span class="neg">${mo.unpaid} unpaid</span>`:''}</span><span class="r">${gMoney(mo.entry)}</span><span class="r">${gMoney(mo.total)}</span><span>${g.status==='settled'?'<span class="chip navy">Settled</span>':Math.abs(mo.left)>0.004&&!isUpcoming(g)?`<span class="chip warn">${gMoney(mo.left)} to pay out</span>`:isUpcoming(g)?'<span class="chip">Upcoming</span>':'<span class="chip ok">Paid out</span>'}</span><span class="ib">${I.chev}</span></div>`; };
  m.innerHTML=head('Games',`The ${esc(orgShort())}’s ${Y()} season: who played, what went in, what was paid out.`,btn('New game','gmNew','pri',I.plus))+`
  <div class="grid g3">${kpi('Games this season',String(gs.length),`${past.length} played · ${up.length} upcoming`)}${kpi('Money through the group',gMoney(tot.money),'every pot, all games')}${kpi('Player-games',String(tot.players),gs.length?`${(tot.players/gs.length).toFixed(1)} players a game`:'')}</div>
  <div class="card" style="overflow:hidden">${gs.length?`<div class="tw"><div class="t" style="min-width:760px"><div class="tr th" style="${cols}"><span>Date</span><span>Game</span><span>Players</span><span class="r">All in</span><span class="r">Pots</span><span>Status</span><span></span></div>${up.concat(past).map(row).join('')}</div></div>`
  :`<div class="empty"><b>No games yet</b><span>Design the regular game: who plays, the competitions (stroke play, a best ball with a blind draw, skins, dots…), the entries and how it pays. Then score it live and settle up.</span><button class="btn pri" id="gmNew2">${I.plus}New game</button></div>`}</div>`;
  $('gmNew').onclick=()=>designGame(null); const n2=$('gmNew2'); if(n2) n2.onclick=()=>designGame(null);
  m.querySelectorAll('[data-game]').forEach(r=>r.onclick=()=>{ view.gameId=r.dataset.game; render(); });
}

/* ---------- the game designer: one screen for everything about a game ----------
   Works on a draft (GD) so nothing is saved until "Save game". For a new game the draft starts from the last game:
   same players, same competitions, today's date. */
let GD=null;
function designGame(g){
  const last=seasonGames()[0], today=new Date().toISOString().slice(0,10);
  if(g) GD={id:g.id,draft:JSON.parse(JSON.stringify(g))};
  else { const d={id:uid(),season:Y(),status:'open',name:last?last.name:'',date:today,time:last?last.time||'':'',course:last?last.course:'oak',notes:'',payWhen:last?last.payWhen||'after':'after',settle:last?last.settle||'pot':'pot',golfEventId:'',players:[],pots:[]};
    if(last){ last.players.forEach(p=>d.players.push({id:uid(),memberId:p.memberId||'',name:p.name||'',paid:false,extraIn:0,gpid:''}));
      last.pots.forEach(p=>{ const np=JSON.parse(JSON.stringify(p)); np.id=uid(); np.payouts=[]; delete np.teams; delete np.draw; delete np.tally; np.inn=Object.fromEntries(d.players.map(x=>[x.id,true])); d.pots.push(np); }); }
    else { d.pots.push(newPot('stroke',d)); }
    GD={id:null,draft:d}; }
  view.gdesign=GD.id||'new'; view.gameId=null; go('games');
}
function vGameDesign(m){
  if(!GD){ view.gdesign=null; render(); return; }
  const d=GD.draft, courses=golfData().courses, isNew=!GD.id;
  const lib=enabledGames().filter(x=>!x.tool), groups=[...new Set(lib.map(x=>x.group))];
  const inG=new Set(d.players.map(p=>p.memberId).filter(Boolean));
  const pool=members().filter(x=>x.status!=='Inactive').sort((a,b)=>memberName(a).localeCompare(memberName(b)));
  const pots=d.pots.filter(p=>p.kind!=='manual'), allIn=p=>sum(pots.filter(pot=>potIn(pot,p)),pot=>n0(pot.entry));
  const potCard=(pot,i)=>{ const C=potCat(pot), E=potEngine(pot), team=potIsTeam(pot), sk=pot.kind==='skins'?skinsRulesOf(pot):null, dr=pot.kind==='dots'?dotsRules(pot):null;
    return `<div class="card pad gd-pot" data-pot="${pot.id}" style="display:flex;flex-direction:column;gap:12px"><div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap"><span class="chip navy">${i+1}</span><b style="font-size:15px">${esc(pot.name)}</b><span class="muted" style="font-size:13px">${esc(POT_KINDS[pot.kind])}</span><button class="ib" style="margin-left:auto" data-gdrm="${pot.id}" aria-label="Remove">${I.x}</button></div>
      <div class="frow2">${field('Competition','gdG_'+pot.id,pot.rules.game,{type:'select',options:[]}).replace('</select>',groups.map(gr=>`<optgroup label="${esc(gr)}">${lib.filter(x=>x.group===gr).map(x=>`<option value="${x.id}"${x.id===pot.rules.game?' selected':''}>${esc(x.name)}</option>`).join('')}</optgroup>`).join('')+'</select>')}${field('Name on the sheet','gdN_'+pot.id,pot.name)}</div>
      <p class="hint" style="margin:-6px 0 0">${esc(C.desc||'')}</p>
      ${pot.kind==='format'?`<label class="check"><input type="checkbox" id="gdLive_${pot.id}"${pot.rules.live!==false?' checked':''}>Show on the live leaderboard</label>`:pot.kind==='dots'?'<p class="hint" style="margin:0">Dots are tallied by hand, so they never show on the live leaderboard.</p>':''}
      <div class="frow2">${pot.kind==='manual'?'<div></div>':field('Entry per player $','gdE_'+pot.id,pot.entry,{type:'number'})}
        ${pot.kind==='format'?`<div class="fld"><span class="lbl">Scored</span>${seg('gdS_'+pot.id,[['gross','Gross'],['net','Net']],pot.rules.scoring||'gross')}</div>`:pot.kind==='skins'?`<div class="fld"><span class="lbl">Scored</span>${seg('gdS_'+pot.id,[['gross','Gross'],['net','Net']],sk.net?'net':'gross')}</div>`:pot.kind==='dots'?`<div class="fld"><span class="lbl">Birdies &amp; eagles</span>${seg('gdS_'+pot.id,[['gross','Gross'],['net','Net']],dr.net?'net':'gross')}</div>`:'<div></div>'}</div>
      ${pot.kind==='format'?`<div class="frow2">${team||C.sizes?field('Players per team','gdT_'+pot.id,E.teamSize,{type:'select',options:(C.sizes||[E.teamSize]).map(n=>[n,n+' players'])}):field('Pays','gdP_'+pot.id,(pot.rules.places||[]).join(' / '),{ph:'e.g. 60 / 30 / 10',hint:'Percent per place, 1st / 2nd / 3rd… Blank = the usual split for the field.'})}
          ${team?field('Partners','gdB_'+pot.id,pot.rules.teamsBy||'hand',{type:'select',options:[['hand','Picked by hand'],['before','Drawn before the round'],['after','Drawn after the round (blind draw)']]}):(C.count&&E.teamSize>1?field('Balls that count','gdC_'+pot.id,E.count,{type:'select',options:Array.from({length:Math.max(1,E.teamSize-1)},(_,k)=>[k+1,(k+1)+' of '+E.teamSize])}):'<div></div>')}</div>
        ${team&&E.format==='match'&&E.matchScoring==='nassau'?(()=>{ const ns=nassauStakes(pot); return `<div style="display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:12px">${field('Front worth $','gdNF_'+pot.id,ns.front,{type:'number'})}${field('Back worth $','gdNB_'+pot.id,ns.back,{type:'number'})}${field('18 worth $','gdNT_'+pot.id,ns.total,{type:'number'})}</div><p class="hint" style="margin:-6px 0 0">Per player, each segment: the losing side pays the winning side; a halved segment is a push. The entry above is what each player has at stake in all three.</p>`; })()
          :team?`<div class="frow2">${field('Pays','gdP_'+pot.id,(pot.rules.places||[]).join(' / '),{ph:'e.g. 70 / 30',hint:'Percent per place. Blank = the usual split for the number of teams.'})}${C.count&&E.teamSize>1?field('Balls that count','gdC_'+pot.id,E.count,{type:'select',options:Array.from({length:Math.max(1,E.teamSize-1)},(_,k)=>[k+1,(k+1)+' of '+E.teamSize])}):'<div></div>'}</div>`:''}`:''}
      ${pot.kind==='skins'?`<div class="frow2">${field('Format','gdMode_'+pot.id,sk.mode,{type:'select',options:[['pot','Skins pot — divided by the skins won'],['hole','Per hole — the pot split over 18 holes, ties carry over']]})}${field('Validation on the next hole','gdV_'+pot.id,sk.validate||'none',{type:'select',options:Object.entries(SKIN_VALID_LABEL)})}</div>
          <div class="fld"><span class="lbl">Rules</span><label class="check"><input type="checkbox" id="gdGBN_${pot.id}"${sk.grossBeatsNet?' checked':''}${sk.net?'':' disabled'}>Gross beats net on a tied hole</label><label class="check"><input type="checkbox" id="gdLive_${pot.id}"${sk.live?' checked':''}>Show skins on the live leaderboard during the round</label></div>
          <p class="hint" style="margin:-6px 0 0">${sk.mode==='hole'?'Each hole is worth a share of the pot; a tied hole carries its share to the next, and holes unwon at the end are not paid.':'One pot for the day, divided by the skins won. A tied hole is nobody’s; a skin that fails validation is lost.'} A hole counts once everyone in the pot has scored it. Left quiet, skins stay off the game page during the round and are called out from the cards afterwards.</p>`:''}
      ${pot.kind==='dots'?`<div class="frow2">${field('Points for a birdie','gdDb_'+pot.id,dr.birdie,{type:'number'})}${field('Points for an eagle','gdDe_'+pot.id,dr.eagle,{type:'number'})}</div>${field('Hand-tallied dots','gdDk_'+pot.id,dr.kinds.join(', '),{hint:'Comma-separated: sandies, greenies, chip-ins, polies…'})}`:''}
    </div>`; };
  m.innerHTML=`<div class="crumb"><button id="gdBack">Games</button><span class="muted">/</span><span class="muted">${isNew?'New game':esc(gameTitle(d))}</span></div>
  <div class="phead"><div><h1 class="h1">${isNew?'Design the game':'Game design'}</h1><p class="sub">Who plays, which competitions run on the day’s scores, what goes in each and how it pays.</p></div><div class="actions">${isNew?'':`<button class="btn danger" id="gdDelete">${I.trash}Delete game</button>`}<button class="btn" id="gdCancel">Cancel</button><button class="btn pri" id="gdSave">${isNew?'Create game':'Save game'}</button></div></div><div class="rule"></div>
  <div class="card pad" style="display:flex;flex-direction:column;gap:14px"><h2 class="h2">The day</h2>
    <div class="frow2">${field('Name','gdName',d.name,{ph:'e.g. Friday game'})}${field('Course','gdCourse',d.course,{type:'select',options:courses.map(c=>[c.id,c.name])})}</div>
    <div class="frow2">${field('Date','gdDate',d.date,{type:'date'})}${field('Tee time','gdTime',d.time||'',{type:'time'})}</div>
    <div class="frow2"><div class="fld"><span class="lbl">Money changes hands</span>${seg('gdWhen',[['after','After the round'],['before','Before the round']],d.payWhen||'after')}<p class="hint">After: the sheet leads with results and the settlement. Before: it leads with who has paid in.</p></div>
      <div class="fld"><span class="lbl">Settlement</span>${seg('gdSettle',[['pot','Pot — everyone puts in, winners pull out'],['net','Net — one figure per player']],d.settle||'pot')}</div></div>
    ${field('Notes','gdNotes',d.notes||'',{type:'textarea'})}</div>
  <div class="card pad" style="display:flex;flex-direction:column;gap:14px"><div class="cardhead" style="padding:0;border:0"><div><h2 class="h2">Competitions</h2><span class="muted">Each runs on the same scores with its own entry, players and payout.</span></div>
      <div class="actions"><select class="inp" id="gdAddSel" style="height:38px;width:auto"><option value="">Add a competition…</option>${groups.map(gr=>`<optgroup label="${esc(gr)}">${lib.filter(x=>x.group===gr).map(x=>`<option value="${x.id}">${esc(x.name)}</option>`).join('')}</optgroup>`).join('')}</select></div></div>
    ${d.pots.length?d.pots.map(potCard).join(''):'<div class="empty"><b>No competitions yet</b><span>Add stroke play, a best ball, skins — as many as the group wants.</span></div>'}
    ${d.pots.filter(potOneBall).length&&d.pots.some(p=>p.kind==='format'&&!potOneBall(p))?'<div class="banner">A scramble, foursomes or greensome is one ball per team — it can’t share a round with own-ball competitions. Keep one or the other.</div>':''}</div>
  <div class="card pad" style="display:flex;flex-direction:column;gap:14px"><div class="cardhead" style="padding:0;border:0"><div><h2 class="h2">Who’s in</h2><span class="muted">${d.players.length} playing · tick who is in each competition</span></div>
      <div class="actions"><input class="inp" id="gdQ" placeholder="Add a member…" style="height:38px;width:220px" autocomplete="off"><div class="pick" id="gdPick" style="display:none;position:absolute;z-index:5;max-height:260px;width:300px"></div><input class="inp" id="gdGuest" placeholder="Guest name" style="height:38px;width:160px"><button class="btn sm" id="gdGuestAdd" type="button">Add guest</button></div></div>
    ${d.players.length?`<div class="tw"><div class="t gd-grid" style="min-width:${360+pots.length*96}px"><div class="tr th" style="grid-template-columns:minmax(160px,1fr) ${pots.map(()=>'90px').join(' ')} 80px 40px"><span>Player</span>${pots.map(pot=>`<span class="r" title="${esc(pot.name)}">${esc(pot.name.length>11?pot.name.slice(0,10)+'…':pot.name)}<br><small class="muted">${gMoney(pot.entry)}</small></span>`).join('')}<span class="r">All in</span><span></span></div>
      ${d.players.slice().sort((a,b)=>gpName(a).localeCompare(gpName(b))).map(p=>`<div class="tr num" style="grid-template-columns:minmax(160px,1fr) ${pots.map(()=>'90px').join(' ')} 80px 40px"><div class="cell2"><b class="trunc">${esc(gpName(p))}</b>${p.memberId?'':'<small>Guest</small>'}</div>${pots.map(pot=>`<span class="r"><input type="checkbox" data-gdin="${pot.id}|${p.id}"${potIn(pot,p)?' checked':''} aria-label="${esc(gpName(p))} in ${esc(pot.name)}"></span>`).join('')}<b class="r">${gMoney(allIn(p))}</b><button class="ib" data-gdpx="${p.id}" aria-label="Remove">${I.x}</button></div>`).join('')}
      <div class="tr tot num" style="grid-template-columns:minmax(160px,1fr) ${pots.map(()=>'90px').join(' ')} 80px 40px"><span>In the pot</span>${pots.map(pot=>`<span class="r">${gMoney(potTotal(d,pot))}</span>`).join('')}<b class="r">${gMoney(sum(pots,pot=>potTotal(d,pot)))}</b><span></span></div></div></div>`
      :'<div class="empty"><b>Nobody in yet</b><span>Add members from the list, or a guest by name.</span></div>'}</div>`;
  // wiring: every field writes straight to the draft; structural changes re-render
  const rerender=()=>render();
  $('gdBack').onclick=$('gdCancel').onclick=()=>{ if(!confirm('Leave without saving?')) return; GD=null; view.gdesign=null; render(); };
  const del=$('gdDelete'); if(del) del.onclick=()=>{ const g=gamesData().find(x=>x.id===GD.id); if(!g) return; if(!confirm(`Delete ${gameTitle(g)} on ${shortDate(g.date)}? Its scoring event, scores and money record go with it.`)) return; deleteGame(g); GD=null; view.gdesign=null; view.gameId=null; persist(); render(); toast('Game deleted'); };
  const readAll=()=>{ d.name=fv('gdName'); d.course=fv('gdCourse'); d.date=fv('gdDate'); d.time=fv('gdTime'); d.notes=fv('gdNotes'); d.payWhen=$('gdWhen').dataset.val; d.settle=$('gdSettle').dataset.val;
    for(const pot of d.pots){ const v=id=>fv(id+'_'+pot.id); pot.name=v('gdN')||pot.name; if(pot.kind!=='manual') pot.entry=n0(v('gdE'));
      const S=$('gdS_'+pot.id); if(S){ const sc=S.dataset.val; if(pot.kind==='format') pot.rules.scoring=sc; if(pot.kind==='skins'){ skinsRulesOf(pot).net=sc==='net'; if(sc!=='net') skinsRulesOf(pot).grossBeatsNet=false; } if(pot.kind==='dots') dotsRules(pot).net=sc==='net'; }
      if(pot.kind==='format'){ pot.rules.live=$('gdLive_'+pot.id)?$('gdLive_'+pot.id).checked:pot.rules.live!==false; if($('gdT_'+pot.id)) pot.rules.teamSize=+v('gdT'); if($('gdC_'+pot.id)) pot.rules.count=+v('gdC'); if($('gdB_'+pot.id)) pot.rules.teamsBy=v('gdB'); if($('gdP_'+pot.id)) pot.rules.places=v('gdP').split(/[\/,\s]+/).map(Number).filter(x=>x>0);
        if($('gdNF_'+pot.id)){ pot.rules.nassau={front:n0(v('gdNF')),back:n0(v('gdNB')),total:n0(v('gdNT'))}; pot.entry=pot.rules.nassau.front+pot.rules.nassau.back+pot.rules.nassau.total; } }
      if(pot.kind==='skins'){ const sk=skinsRulesOf(pot); sk.grossBeatsNet=$('gdGBN_'+pot.id).checked&&sk.net; sk.mode=v('gdMode')==='hole'?'hole':'pot'; sk.carry=sk.mode==='hole'; sk.live=$('gdLive_'+pot.id).checked; sk.validate=v('gdV')||'none'; }
      if(pot.kind==='dots'){ const dr=pot.rules.dots=dotsRules(pot); dr.birdie=n0(v('gdDb')); dr.eagle=n0(v('gdDe')); dr.kinds=v('gdDk').split(',').map(s=>s.trim()).filter(Boolean); } } };
  m.querySelectorAll('.gd-pot').forEach(card=>{ const pot=d.pots.find(x=>x.id===card.dataset.pot);
    card.querySelector('#gdG_'+pot.id).onchange=e=>{ readAll(); const np=newPot(e.target.value,null); np.id=pot.id; np.inn=pot.inn; np.entry=pot.entry||np.entry; Object.assign(pot,np); rerender(); };
    wireSeg(card,'gdS_'+pot.id,()=>{ readAll(); if(pot.kind==='skins') rerender(); }); const msel=card.querySelector('#gdMode_'+pot.id); if(msel) msel.onchange=()=>{ readAll(); rerender(); };
    const tsel=card.querySelector('#gdT_'+pot.id); if(tsel) tsel.onchange=()=>{ readAll(); rerender(); };
    const bsel=card.querySelector('#gdB_'+pot.id); if(bsel) bsel.onchange=()=>{ readAll(); };
    card.querySelector('[data-gdrm]').onclick=()=>{ readAll(); if(pot.payouts.length&&!confirm('This competition has payouts recorded. Remove it anyway?')) return; d.pots=d.pots.filter(x=>x!==pot); rerender(); }; });
  wireSeg(m,'gdWhen',()=>{}); wireSeg(m,'gdSettle',()=>{});
  $('gdAddSel').onchange=e=>{ if(!e.target.value) return; readAll(); d.pots.push(newPot(e.target.value,d)); rerender(); };
  m.querySelectorAll('[data-gdin]').forEach(c=>c.onchange=()=>{ readAll(); const [pid,plid]=c.dataset.gdin.split('|'); const pot=d.pots.find(x=>x.id===pid); if(c.checked) pot.inn[plid]=true; else delete pot.inn[plid]; rerender(); });
  m.querySelectorAll('[data-gdpx]').forEach(b=>b.onclick=()=>{ readAll(); const p=d.players.find(x=>x.id===b.dataset.gdpx); if(gpOut(d,p)&&!confirm(`${gpName(p)} has payouts recorded. Remove anyway?`)) return; removePlayer(d,p); rerender(); });
  const q=$('gdQ'), pk=$('gdPick'); q.oninput=()=>{ const s=q.value.toLowerCase().trim(); const hits=s?pool.filter(x=>!inG.has(x.id)&&memberName(x).toLowerCase().includes(s)).slice(0,8):[];
    pk.innerHTML=hits.map(x=>`<button type="button" data-gdadd="${x.id}"><span class="av">${initials(x)}</span><b>${esc(memberName(x))}</b><span class="muted" style="margin-left:auto;font-size:12.5px">${x.hcp?'Index '+esc(x.hcp):''}</span></button>`).join('')||(s?'<span class="muted" style="padding:10px 14px;display:block">No one matches.</span>':''); pk.style.display=pk.innerHTML?'':'none';
    pk.querySelectorAll('[data-gdadd]').forEach(b=>b.onclick=()=>{ readAll(); addPlayer(d,{memberId:b.dataset.gdadd}); rerender(); setTimeout(()=>{ const n=$('gdQ'); if(n) n.focus(); },0); }); };
  $('gdGuestAdd').onclick=()=>{ const n=fv('gdGuest'); if(!n) return; readAll(); addPlayer(d,{name:n}); rerender(); };
  $('gdSave').onclick=()=>{ readAll(); if(!d.pots.length){ toast('Add at least one competition'); return; }
    if(d.pots.filter(potOneBall).length&&d.pots.some(p=>p.kind==='format'&&!potOneBall(p))){ toast('A one-ball game can’t share the round with own-ball competitions'); return; }
    if(d.pots.filter(potOneBall).length>1){ toast('Only one one-ball game per round'); return; }
    let g=GD.id?gamesData().find(x=>x.id===GD.id):null;
    if(g){ syncTo(g,d); } else { g=d; gamesData().push(g); }
    GD=null; view.gdesign=null; view.gameId=g.id;
    const ev=ensureGameEvent(g); ev.date=g.date; ev.defaultCourse=g.course||'oak'; ev.groups.forEach(gr=>{ if(!gr.teeTime&&g.time) gr.teeTime=g.time; }); publishEvent(ev);
    persist(); render(); toast(GD?'Saved':'Game saved'); };
}

/* ---------- one game (the day's sheet) ---------- */
function vGame(m,g){
  let ev=gameEvent(g); if(!ev){ ev=ensureGameEvent(g); golfSave(ev); }
  const mo=gameMoney(g), live=ev.status==='live', after=(g.payWhen||'after')==='after', S=settlement(g), scored=Object.keys(scoresFor(ev)||{}).length>0;
  if(CLOUD&&sessionOK&&!golfScores[ev.id]) setTimeout(()=>loadScores(ev),0);
  const pots=g.pots.filter(p=>p.kind!=='manual'), link=scoringLink(ev);
  const gridCols=`grid-template-columns:minmax(150px,1fr) ${pots.map(()=>'84px').join(' ')} 76px 90px 40px`;
  const grid=`<div class="card" style="overflow:hidden"><div class="cardhead"><div><h2 class="h2">Who’s in</h2><span class="muted">${g.players.length} playing · ${mo.unpaid?`<span class="neg">${mo.unpaid} still to pay in</span>`:g.players.length?'everyone has paid in':''}</span></div><div class="actions"><button class="btn sm" id="gmAllPaid">Mark all paid</button><button class="btn sm pri" id="gmAdd">${I.plus}Add players</button></div></div>
    ${g.players.length?`<div class="tw"><div class="t" style="min-width:${340+pots.length*84}px"><div class="tr th" style="${gridCols}"><span>Player</span>${pots.map(pot=>`<span class="r" title="${esc(pot.name)}">${esc(pot.name.length>10?pot.name.slice(0,9)+'…':pot.name)}<br><small class="muted">${gMoney(pot.entry)}</small></span>`).join('')}<span class="r">In</span><span>Paid</span><span></span></div>
      ${g.players.slice().sort((a,b)=>gpName(a).localeCompare(gpName(b))).map(p=>{ const inn=gpIn(g,p); return `<div class="tr num" style="${gridCols}"><div class="cell2 click" data-gp="${p.id}"><b class="trunc">${esc(gpName(p))}</b>${p.memberId?'':'<small>Guest</small>'}${n0(p.extraIn)?`<small>+ ${gMoney(p.extraIn)} extra</small>`:''}</div>${pots.map(pot=>`<span class="r"><input type="checkbox" data-gin="${pot.id}|${p.id}"${potIn(pot,p)?' checked':''} aria-label="${esc(gpName(p))} in ${esc(pot.name)}"></span>`).join('')}<b class="r">${gMoney(inn)}</b><span><label class="check" style="font-weight:400;margin:0"><input type="checkbox" data-gpaid="${p.id}"${p.paid?' checked':''}>${p.paid?'<span class="pos">Paid</span>':inn?'<span class="muted">owes</span>':''}</label></span><span style="display:flex;gap:2px"><button class="ib" data-gp="${p.id}" aria-label="Edit">${I.edit}</button><button class="ib" data-gprm="${p.id}" aria-label="Remove">${I.x}</button></span></div>`; }).join('')}
      <div class="tr tot num" style="${gridCols}"><span>In the pot</span>${pots.map(pot=>`<span class="r">${gMoney(potTotal(g,pot))}</span>`).join('')}<b class="r">${gMoney(mo.total)}</b><span></span><span></span></div></div></div>`
    :'<div class="empty"><b>Nobody in yet</b><span>Add the regulars from the member list, or a guest by name.</span></div>'}</div>`;
  const potCard=pot=>{ const tot=potTotal(g,pot), paid=potPaid(pot), inN=potPlayers(g,pot).length, team=potIsTeam(pot), known=potTeamsKnown(pot), by=pot.rules.teamsBy||'hand';
    const act=pot.kind==='skins'?'Pay skins':pot.kind==='dots'?'Tally & pay':pot.kind==='manual'?'Add winner':(pot.rules.nassau?'Settle the match':'Pay out');
    const quiet=pot.kind==='skins'&&!skinsRulesOf(pot).live?(pot.calledOut?`<button class="btn sm" data-callout="${pot.id}">Call out again</button>`:''):'';
    const liveChip=pot.kind==='dots'||pot.kind==='manual'?'':potLive(pot)?'<span class="chip ok" title="Shown on the live leaderboard">● live board</span>':'<span class="chip" title="Not on the live leaderboard">off the live board</span>';
    const teamBtn=team?(known?`<button class="btn sm" data-teams="${pot.id}">${by==='hand'?'Change teams':'Re-draw'}</button>`:by==='hand'?`<button class="btn sm pri" data-teams="${pot.id}">Pick teams</button>`:`<button class="btn sm pri" data-teams="${pot.id}">Draw partners</button>`):'';
    const payoutsTxt=pot.payouts.length?pot.payouts.slice().sort((a,b)=>b.amount-a.amount).map(x=>{ const p=g.players.find(y=>y.id===x.pid); return `<span class="chip ok">${esc(p?gpName(p):'—')} ${gMoney(x.amount)}</span>`; }).join(' '):'';
    return `<div class="card" style="overflow:hidden"><div class="cardhead"><div class="cell2" style="min-width:0"><h2 class="h2">${esc(pot.name)}</h2><span class="muted">${esc(potSummary(pot))}${pot.kind==='manual'?'':` · ${inN} in${pot.entry?' × '+gMoney(pot.entry)+' = '+gMoney(tot):''}`}${paid?` · <b class="pos">${gMoney(paid)} paid out</b>`:''}</span></div>
        <div class="actions">${liveChip}${teamBtn}${quiet}<button class="btn sm${pot.payouts.length?'':' pri'}" data-pay="${pot.id}">${act}</button><button class="btn sm" data-potedit="${pot.id}">${I.edit}</button></div></div>
      ${team&&!known?`<div class="banner" style="border-radius:0;border-left:0;border-right:0">${by==='after'?'Partners are drawn after the round. Until then everyone is on their own ball — the standings below are individual.':by==='before'?'Draw the partners before play; the teams then stay together on the sheet.':'Pick the teams, then the standings show teams.'}</div>`:''}
      ${potStandingsHTML(g,pot,ev)}
      ${payoutsTxt?`<div style="padding:10px 22px;display:flex;gap:6px;flex-wrap:wrap;border-top:1px solid var(--line)">${payoutsTxt}</div>`:''}</div>`; };
  const settleCard=`<div class="card" style="overflow:hidden"><div class="cardhead"><div><h2 class="h2">Settlement</h2><span class="muted">${g.settle==='net'?'Net: one figure per player, and the fewest payments that square it':'Pot: everyone puts in, winners pull out'} · ${gMoney(S.out)} of ${gMoney(S.inn)} paid out${Math.abs(mo.left)>0.004?` · <b class="${mo.left>0?'':'neg'}">${gMoney(Math.abs(mo.left))} ${mo.left>0?'still in the pot':'over the pot'}</b>`:''}</span></div>
      <div class="actions"><button class="btn sm" id="gmSheet">${I.down}Game sheet PDF</button>${g.status==='settled'?'<button class="btn sm" id="gmReopen">Reopen</button>':'<button class="btn sm" id="gmSettle">Mark settled</button>'}</div></div>
    ${g.players.length?`<div class="tw"><div class="t" style="min-width:560px"><div class="tr th" style="grid-template-columns:minmax(160px,1fr) 100px 100px 110px"><span>Player</span><span class="r">Put in</span><span class="r">Pulled out</span><span class="r">Net</span></div>
      ${S.rows.map(r=>`<div class="tr num" style="grid-template-columns:minmax(160px,1fr) 100px 100px 110px"><b class="trunc">${esc(r.name)}</b><span class="r">${gMoney(r.inn)}</span><span class="r ${r.out?'pos':'muted'}">${r.out?gMoney(r.out):'—'}</span><b class="r ${netCls(r.net)}">${gSigned(r.net)}</b></div>`).join('')}</div></div>
      ${g.settle==='net'?`<div style="padding:14px 22px;border-top:1px solid var(--line)"><span class="lbl">Who pays whom</span>${S.transfers.length?`<div class="mini" style="margin-top:6px">${S.transfers.map(t=>`<div class="mr num" style="grid-template-columns:minmax(0,1fr) 90px"><span>${esc(t.from)} <span class="muted">pays</span> ${esc(t.to)}</span><b class="r">${gMoney(t.amount)}</b></div>`).join('')}</div>`:'<p class="muted" style="margin:6px 0 0">Nothing to settle yet.</p>'}</div>`:''}`:''}</div>`;
  const liveCard=`<div class="card pad" style="display:flex;flex-direction:column;gap:12px"><div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px"><h2 class="h2">Live scoring</h2>${live?'<button class="btn sm" id="gmClose">Close scoring</button>':'<button class="btn sm" id="gmOpen">Reopen scoring</button>'}</div>
    <div class="cell2"><span class="lbl">Scoring link — players enter their group ID</span><a href="${esc(link)}" target="_blank" rel="noopener" class="trunc" style="font-weight:600">${esc(link)}</a></div>
    <div class="actions"><button class="btn sm" id="gmCopy">Copy link</button><a class="btn sm" href="${esc(link)}&view=board" target="_blank" rel="noopener">Leaderboard screen</a><button class="btn sm" id="gmGroups">Groups</button></div>
    <div class="mini">${ev.groups.map(grp=>`<div class="mr" style="grid-template-columns:minmax(0,1fr) auto"><div class="cell2"><b>Group ${esc(grp.code)}</b><small>${esc(grp.players.map(p=>p.name.split(' ')[0]).join(', '))}${grp.teeTime?' · '+fmtTime(grp.teeTime):grp.startHole>1?' · hole '+grp.startHole:''}</small></div><button class="btn sm" data-gsheet="${grp.id}">Enter scores</button></div>`).join('')||'<div class="mr"><span class="muted">Groups appear as players are added.</span></div>'}</div>
    <p class="hint">Everyone plays their own ball; every competition is scored from those cards. Enter scores here for anyone who doesn’t use the page.</p></div>`;
  const first=after?[...pots.map(potCard),settleCard]:[grid,...pots.map(potCard),settleCard];
  m.innerHTML=`<div class="crumb"><button id="gmBack">Games</button><span class="muted">/</span><span class="muted">${esc(gameTitle(g))}</span></div>
  <div class="phead"><div><h1 class="h1">${esc(gameTitle(g))}</h1><div style="display:flex;gap:8px;margin-top:12px;flex-wrap:wrap"><span class="chip navy">${esc(gameWhen(g))}</span><span class="chip">${esc(courseById(g.course)?.name||'Course TBD')}</span>${pots.map(p=>`<span class="chip gold">${esc(p.name)} ${gMoney(p.entry)}</span>`).join('')}<span class="chip">${after?'paid after the round':'paid before the round'} · ${g.settle==='net'?'net':'pot'}</span>${g.status==='settled'?'<span class="chip navy">Settled</span>':''}${live?'<span class="chip ok">● Live scoring</span>':''}</div></div>
    <div class="actions"><button class="btn" id="gmDesign">${I.edit}Design</button></div></div>
  <div class="grid g4">${kpi('Players',String(g.players.length),mo.unpaid?`<span class="neg">${mo.unpaid} still owe</span>`:g.players.length?'all paid in':'add who’s playing')}${kpi('In the pots',gMoney(mo.total),pots.map(p=>`${esc(p.name)} ${gMoney(potTotal(g,p))}`).join(' · ')||'no competitions')}${kpi('Paid out',gMoney(mo.paid),`${sum(g.pots,p=>p.payouts.length)} payout${sum(g.pots,p=>p.payouts.length)===1?'':'s'}`)}${kpi(mo.left>0.004?'Still to pay out':mo.left<-0.004?'Paid out over the pots':'Balance',gMoney(Math.abs(mo.left)),mo.left>0.004?'allocate it below':mo.left<-0.004?'check the payouts':'pots fully paid out',mo.left<-0.004?'neg':mo.left>0.004?'':'pos')}</div>
  ${after?first.join('')+grid:first.join('')}${gameGroupsCard(g,ev)}${liveCard}
  ${g.notes?`<div class="card pad"><span class="lbl">Notes</span><p style="margin:6px 0 0;white-space:pre-wrap">${esc(g.notes)}</p></div>`:''}`;
  $('gmBack').onclick=()=>{ view.gameId=null; render(); }; $('gmDesign').onclick=()=>designGame(g);
  $('gmAdd').onclick=()=>addGamePlayers(g); $('gmAllPaid').onclick=()=>{ g.players.forEach(p=>p.paid=true); persist(); render(); toast('Everyone marked paid'); };
  const st=$('gmSettle'); if(st) st.onclick=()=>{ if(Math.abs(mo.left)>0.004&&!confirm(`${gMoney(Math.abs(mo.left))} ${mo.left>0?'is still unallocated':'over the pots'}. Mark settled anyway?`)) return; g.status='settled'; persist(); render(); };
  const ro=$('gmReopen'); if(ro) ro.onclick=()=>{ g.status='open'; persist(); render(); };
  const op=$('gmOpen'); if(op) op.onclick=()=>openScoring(g);
  const cl=$('gmClose'); if(cl) cl.onclick=()=>{ ev.status='final'; golfSave(ev); render(); toast('Scoring closed'); };
  const cp=$('gmCopy'); if(cp) cp.onclick=async()=>{ try{ await navigator.clipboard.writeText(link); toast('Link copied'); }catch(_){ prompt('Copy this link:',link); } };
  $('gmGroups').onclick=()=>{ view.geid=ev.id; view.getab='groups'; go('golf'); };
  wireGameGroups(m,g,ev);
  $('gmSheet').onclick=()=>gameSheetPDF(g);
  m.querySelectorAll('[data-gsheet]').forEach(b=>b.onclick=()=>scoreSheet(ev,ev.groups.find(x=>x.id===b.dataset.gsheet)));
  m.querySelectorAll('[data-gp]').forEach(r=>r.onclick=()=>editGamePlayer(g,g.players.find(p=>p.id===r.dataset.gp)));
  m.querySelectorAll('[data-gin]').forEach(c=>c.onchange=()=>{ const [pid,plid]=c.dataset.gin.split('|'); const pot=g.pots.find(x=>x.id===pid); if(c.checked) pot.inn[plid]=true; else delete pot.inn[plid]; persist(); render(); });
  m.querySelectorAll('[data-gprm]').forEach(b=>b.onclick=()=>{ const p=g.players.find(x=>x.id===b.dataset.gprm); const out=gpOut(g,p); if(!confirm(`Remove ${gpName(p)} from the game${out?` — they have ${gMoney(out)} in payouts recorded`:''}? They leave every competition and the leaderboard.`)) return; removePlayer(g,p); syncGameEvent(g,ev); golfSave(ev); render(); toast(gpName(p)+' removed'); });
  m.querySelectorAll('[data-gpaid]').forEach(c=>c.onchange=()=>{ const p=g.players.find(x=>x.id===c.dataset.gpaid); p.paid=c.checked; persist(); render(); });
  m.querySelectorAll('[data-potedit]').forEach(b=>b.onclick=()=>designGame(g));
  m.querySelectorAll('[data-callout]').forEach(b=>b.onclick=()=>skinsCallout(g,g.pots.find(p=>p.id===b.dataset.callout)));
  m.querySelectorAll('[data-teams]').forEach(b=>b.onclick=()=>{ const pot=g.pots.find(p=>p.id===b.dataset.teams); if((pot.rules.teamsBy||'hand')==='hand') pickTeams(g,pot); else drawStage(g,pot); });
  m.querySelectorAll('[data-pay]').forEach(b=>b.onclick=()=>{ const pot=g.pots.find(p=>p.id===b.dataset.pay); ({skins:paySkins,dots:payDots,format:payFormat,manual:(g,pot)=>payManual(g,pot,null)})[pot.kind](g,pot); });
}
/* ---------- groups & handicaps on the game page ----------
   Who plays with whom, from which tees, and what each player's course and playing handicap come to. An index typed
   here is for this game only; blank means the member's index from the directory. It can change mid-round: golfSave
   republishes the event, and the scoring page re-reads it every 30 s (loadEvent in score_src.html). */
function gameGroupsCard(g,ev){
  const courses=golfData().courses, tees=c=>(c?c.tees:[]).map(t=>t.name);
  const cols='grid-template-columns:minmax(150px,1fr) 88px 110px 54px 54px 150px';
  const row=(grp,p)=>{ const h=playerHcp(ev,grp,p), c=courseById(grp.course), m=p.memberId?memberById(p.memberId):null, dir=m&&m.hcp!=null&&String(m.hcp).trim()!==''?String(m.hcp):'';
    return `<div class="tr num" style="${cols}"><div class="cell2"><b class="trunc">${esc(p.name)}</b>${h.missing?`<small class="neg">no ${h.missing}</small>`:p.index!=null&&String(p.index).trim()!==''&&dir&&String(p.index)!==dir?`<small>directory ${esc(dir)}</small>`:''}</div>
      <input class="inp r" data-gidx="${p.id}" value="${esc(p.index!=null?p.index:'')}" placeholder="${esc(dir||'—')}" inputmode="decimal" aria-label="Index for ${esc(p.name)}">
      <select class="inp" data-gtee="${p.id}" aria-label="Tee for ${esc(p.name)}">${tees(c).map(t=>`<option${(p.tee||ev.defaultTee)===t?' selected':''}>${esc(t)}</option>`).join('')}</select>
      <span class="r">${h.ch!=null?h.ch:'—'}</span><b class="r">${h.ph!=null?h.ph:'—'}</b>
      <select class="inp" data-gmove="${p.id}" aria-label="Group for ${esc(p.name)}">${ev.groups.map((x,i)=>`<option value="${x.id}"${x===grp?' selected':''}>Group ${i+1} · ${esc(x.code)}</option>`).join('')}<option value="__new">+ New group</option></select></div>`; };
  const groupHead=(grp,i)=>`<div class="tr" style="grid-template-columns:minmax(0,1fr) 150px 120px 110px;background:var(--ivory)"><div class="cell2"><b>Group ${i+1} · ${esc(grp.code)}</b><small>${grp.players.length} player${grp.players.length===1?'':'s'}</small></div>
      <select class="inp" data-gcourse="${grp.id}" aria-label="Course">${courses.map(c=>`<option value="${c.id}"${c.id===grp.course?' selected':''}>${esc(c.name)}</option>`).join('')}</select>
      <select class="inp" data-ghole="${grp.id}" aria-label="Starting hole">${Array.from({length:18},(_,k)=>`<option value="${k+1}"${(+grp.startHole||1)===k+1?' selected':''}>Hole ${k+1}</option>`).join('')}</select>
      <input class="inp" type="time" data-gtime="${grp.id}" value="${esc(grp.teeTime||'')}" aria-label="Tee time"></div>`;
  return `<div class="card" style="overflow:hidden"><div class="cardhead"><div><h2 class="h2">Groups &amp; handicaps</h2><span class="muted">Who plays with whom, their tees, and each player’s course (CH) and playing (PH) handicap for today. An index typed here is for this game only, and can be corrected mid-round: the handicaps, the standings and the live leaderboard on everyone’s phone follow within half a minute.</span></div><div class="actions"><button class="btn sm" id="ggAddGroup">${I.plus}New group</button></div></div>
    ${ev.groups.length?`<div class="tw"><div class="t" style="min-width:720px"><div class="tr th" style="${cols}"><span>Player</span><span class="r">Index</span><span>Tee</span><span class="r">CH</span><span class="r">PH</span><span>Group</span></div>
      ${ev.groups.map((grp,i)=>groupHead(grp,i)+grp.players.map(p=>row(grp,p)).join('')).join('')}</div></div>`:'<div class="empty"><b>No groups yet</b><span>Groups appear as players are added.</span></div>'}</div>`;
}
function wireGameGroups(m,g,ev){
  const save=()=>{ golfSave(ev); render(); };
  const find=id=>{ for(const grp of ev.groups){ const p=grp.players.find(x=>x.id===id); if(p) return {grp,p}; } return null; };
  m.querySelectorAll('[data-gidx]').forEach(i=>i.onchange=()=>{ const f=find(i.dataset.gidx); if(!f) return; const v=i.value.trim(); if(v&&parseIndex(v)==null){ toast('Enter an index like 12.4 or +1.2'); i.value=f.p.index||''; return; } f.p.index=v; save(); });
  m.querySelectorAll('[data-gtee]').forEach(s=>s.onchange=()=>{ const f=find(s.dataset.gtee); if(f){ f.p.tee=s.value; save(); } });
  m.querySelectorAll('[data-gmove]').forEach(s=>s.onchange=()=>{ const f=find(s.dataset.gmove); if(!f) return; let to=ev.groups.find(x=>x.id===s.value);
    if(s.value==='__new'){ to={id:uid(),code:newCode(ev),label:'Group '+(ev.groups.length+1),course:f.grp.course,startHole:1,teeTime:f.grp.teeTime||'',players:[]}; ev.groups.push(to); }
    if(!to||to===f.grp) return; f.grp.players=f.grp.players.filter(x=>x!==f.p); to.players.push(f.p); ev.groups=ev.groups.filter(x=>x.players.length); save(); });
  m.querySelectorAll('[data-gcourse]').forEach(s=>s.onchange=()=>{ const grp=ev.groups.find(x=>x.id===s.dataset.gcourse); if(grp){ grp.course=s.value; save(); } });
  m.querySelectorAll('[data-ghole]').forEach(s=>s.onchange=()=>{ const grp=ev.groups.find(x=>x.id===s.dataset.ghole); if(grp){ grp.startHole=+s.value; save(); } });
  m.querySelectorAll('[data-gtime]').forEach(s=>s.onchange=()=>{ const grp=ev.groups.find(x=>x.id===s.dataset.gtime); if(grp){ grp.teeTime=s.value; save(); } });
  const ng=$('ggAddGroup'); if(ng) ng.onclick=()=>{ ev.groups.push({id:uid(),code:newCode(ev),label:'Group '+(ev.groups.length+1),course:g.course||ev.defaultCourse||'oak',startHole:1,teeTime:g.time||'',players:[]}); toast('Move players into it with the Group column'); const grp=ev.groups[ev.groups.length-1];
    // an empty group would be pruned on the next sync; keep it by rendering without one until a player lands in it
    m.querySelector('#ggAddGroup').disabled=true; const card=m.querySelector('#ggAddGroup').closest('.card'); card.querySelectorAll('[data-gmove]').forEach(sel=>{ const o=document.createElement('option'); o.value=grp.id; o.textContent=`Group ${ev.groups.length} · ${grp.code}`; sel.insertBefore(o,sel.lastElementChild); }); };
}
/* live standings for one competition, from the day's scores */
function potStandingsHTML(g,pot,ev){
  const sc=scoresFor(ev); if(!Object.keys(sc||{}).length) return '<div style="padding:12px 22px" class="muted">No scores yet.</div>';
  if(pot.kind==='manual') return '';
  if(pot.kind==='skins'){ const r=skinsCalc(g,pot), rules=skinsRulesOf(pot), val=r&&r.total?potTotal(g,pot)/r.total:0;
    if(!rules.live&&!pot.calledOut) return `<div style="padding:12px 22px;display:flex;gap:12px;align-items:center;flex-wrap:wrap"><span class="muted" style="flex:1 1 260px">Skins are kept quiet during the round and called out from the cards afterwards${r&&r.incomplete?` · ${18-r.incomplete} of 18 holes in`:''}.</span><button class="btn sm pri" data-callout="${pot.id}">Call out the skins</button></div>`;
    const hv=skinValue(rules,potTotal(g,pot),r), per=rules.mode==='hole';
    if(!r||!r.wins.length) return `<div style="padding:12px 22px" class="muted">No skins yet${per&&r&&r.carried?` · ${r.carried} hole${r.carried===1?'':'s'} carried`:''}.</div>`;
    return `<div class="mini" style="margin:10px 22px 14px">${r.wins.map(w=>`<div class="mr num" style="grid-template-columns:62px minmax(0,1fr) 90px"><b>Hole ${w.hole}</b><div class="cell2"><span>${esc(w.name)} <span class="muted">${w.score}${rules.net&&w.net!==w.score?' (net '+w.net+')':''}${per&&w.count>1?' · '+w.count+' holes':''}</span></span>${w.status==='void'?`<small class="neg">Void — missed ${esc((SKIN_VALID_LABEL[rules.validate]||'').replace(' or better on the next hole','').toLowerCase())} on ${w.checkHole}</small>`:w.status==='pending'?`<small class="muted">Validates on hole ${w.checkHole}</small>`:''}</div><b class="r ${w.status==='won'?'':'muted'}">${w.status==='won'?gMoney(hv*w.count):'—'}</b></div>`).join('')}<div class="mr num" style="grid-template-columns:minmax(0,1fr) 90px"><span class="muted">${per?`${r.total} of 18 holes won at ${gMoney(hv)} a hole`:`${r.total} skin${r.total===1?'':'s'}${r.total?' at '+gMoney(hv):''}`}${r.pending?` · ${r.pending} pending`:''}${per&&r.carried?` · ${r.carried} carried`:''}${r.incomplete?` · ${r.incomplete} hole${r.incomplete===1?'':'s'} open`:''}</span><b class="r">${gMoney(per?hv*r.total:(r.total?potTotal(g,pot):0))}</b></div></div>`; }
  if(pot.kind==='dots'){ const rules=dotsRules(pot), auto=dotsAuto(g,pot,rules), T=potPlayers(g,pot).map(p=>{ const a=auto[p.id]||{birdies:0,eagles:0}, t=(pot.tally||{})[p.id]||{}; return {p,dots:a.birdies*rules.birdie+a.eagles*rules.eagle+sum(rules.kinds,k=>t[k]),a}; }).filter(x=>x.dots).sort((a,b)=>b.dots-a.dots);
    return T.length?`<div class="mini" style="margin:10px 22px 14px">${T.map(x=>`<div class="mr num" style="grid-template-columns:minmax(0,1fr) 60px"><span>${esc(gpName(x.p))} <span class="muted">${x.a.birdies}b ${x.a.eagles}e</span></span><b class="r">${x.dots}</b></div>`).join('')}</div>`:'<div style="padding:12px 22px" class="muted">No dots yet.</div>'; }
  const pub=potPub(g,pot), rows=eventBoard(pub,sc,{sort:pub.scoring}).filter(r=>r.n), net=pub.scoring==='net', unit=unitOf(pub);
  if(!rows.length) return '<div style="padding:12px 22px" class="muted">No scores yet.</div>';
  const txt=r=>unit==='points'?r.pts+' pts':unit==='holes'?(r.holesUp>0?'+':'')+r.holesUp:unit==='match'?esc(r.status):(net&&r.netToPar!=null?toParTxt(r.netToPar):toParTxt(r.toPar));
  return `<div class="mini" style="margin:10px 22px 14px">${rows.slice(0,12).map(r=>`<div class="mr num" style="grid-template-columns:36px minmax(0,1fr) 44px 60px"><b>${r.posTxt}</b><span class="trunc">${esc(r.name)}</span><span class="muted r">${r.thru}</span><b class="r">${txt(r)}</b></div>`).join('')}${rows.length>12?`<div class="mr"><span class="muted">… and ${rows.length-12} more</span></div>`:''}</div>`;
}
function addGamePlayers(g){
  const inG=new Set(g.players.map(p=>p.memberId).filter(Boolean));
  const pool=members().filter(x=>x.status!=='Inactive'&&!inG.has(x.id)).sort((a,b)=>memberName(a).localeCompare(memberName(b)));
  const picked=new Set(); let guests=[];
  const list=q=>{ q=q.toLowerCase(); return pool.filter(x=>!q||memberName(x).toLowerCase().includes(q)).map(x=>`<label class="check" style="padding:6px 0;border-bottom:1px solid var(--line)"><input type="checkbox" data-pk="${x.id}"${picked.has(x.id)?' checked':''}><span class="av" style="margin:0 8px">${initials(x)}</span>${esc(memberName(x))}<span class="muted" style="margin-left:auto;font-size:12.5px">${x.hcp?'Index '+esc(x.hcp):''}</span></label>`).join('')||'<span class="muted">No one left to add.</span>'; };
  openDrawer({kicker:gameTitle(g),title:'Add players',saveLabel:'Add',
    body:`<input class="inp" id="apQ" placeholder="Search members" aria-label="Search members"><div id="apL" style="max-height:320px;overflow:auto">${list('')}</div>
      <div class="fld"><span class="lbl">Guest</span><div style="display:grid;grid-template-columns:minmax(0,1fr) auto;gap:8px"><input class="inp" id="apG" placeholder="Guest name"><button class="btn" type="button" id="apGAdd">Add guest</button></div><p class="hint" id="apGList" style="margin:0"></p></div>
      <p class="hint">New players go into every competition; untick any they are sitting out on the game page.</p>`,
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
      <div class="fld"><span class="lbl">In which competitions</span>${g.pots.filter(pot=>pot.kind!=='manual').map(pot=>`<label class="check" style="font-weight:400"><input type="checkbox" data-gpp="${pot.id}"${potIn(pot,p)?' checked':''}>${esc(pot.name)} <span class="muted">· ${gMoney(pot.entry)}</span></label>`).join('')}</div>`+
      field('Extra money in $','gpX',p.extraIn||0,{type:'number',hint:'Side action put through the group, e.g. a double entry.'})+(out?`<p class="hint">Won ${gMoney(out)} in this game — change it under the competition.</p>`:''),
    save:()=>{ p.paid=$('gpPaid').checked; document.querySelectorAll('[data-gpp]').forEach(c=>{ const pot=g.pots.find(x=>x.id===c.dataset.gpp); if(c.checked) pot.inn[p.id]=true; else delete pot.inn[p.id]; }); p.extraIn=fnum('gpX'); },
    del:()=>{ const ev=gameEvent(g), scored=ev&&p.gpid&&Object.keys((scoresFor(ev)||{})[p.gpid]||{}).length; if(out&&!confirm(`${gpName(p)} has ${gMoney(out)} in payouts recorded. Remove anyway?`)) return false;
      if(scored&&!confirm(`${gpName(p)} has scores on the card. Remove them from the game, every competition and the leaderboard?`)) return false; removePlayer(g,p); if(ev){ syncGameEvent(g,ev); golfSave(ev); } },delLabel:'Remove from game'});
}

/* ---------- teams for a competition: picked by hand, or drawn on the stage ---------- */
function pickTeams(g,pot){
  const ev=gameEvent(g), E=potEngine(pot), size=E.teamSize||2, ps=potPlayers(g,pot).filter(p=>p.gpid), n=Math.max(1,Math.ceil(ps.length/size)), cur=pot.teams||{};
  const nTeams=Math.max(n,ev.groups.length);
  openDrawer({kicker:gameTitle(g)+' · '+pot.name,title:'Teams',saveLabel:'Save teams',
    body:`<div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap"><p class="hint" style="margin:0;flex:1 1 200px">${ps.length} players · teams of ${size}.</p><button class="btn sm" type="button" id="ptByGroup">Teams = the groups</button></div><div class="mini">${ps.map(p=>`<div class="mr" style="grid-template-columns:minmax(0,1fr) 120px"><span>${esc(gpName(p))}</span><select class="inp" data-pt="${p.gpid}" style="height:34px"><option value="">—</option>${Array.from({length:nTeams},(_,k)=>`<option value="S${k+1}"${cur[p.gpid]==='S'+(k+1)?' selected':''}>Team ${k+1}</option>`).join('')}</select></div>`).join('')}</div>`,
    wire:r=>{ r.querySelector('#ptByGroup').onclick=()=>{ ev.groups.forEach((grp,i)=>grp.players.forEach(p=>{ const s=r.querySelector(`[data-pt="${p.id}"]`); if(s) s.value='S'+(i+1); })); }; },
    save:()=>{ const t={}; document.querySelectorAll('[data-pt]').forEach(s=>{ if(s.value) t[s.dataset.pt]=s.value; }); pot.teams=t; pot.draw=null; applyPotTeams(g,pot); toast('Teams saved'); }});
}
/* one-ball games carry their teams on the event itself (the scoring page needs them); own-ball games keep them on the pot */
function applyPotTeams(g,pot){ const ev=gameEvent(g); if(!ev) return; if(potOneBall(pot)){ syncGameEvent(g,ev); publishEvent(ev); } }
/* the draw itself: teams from the players in the pot, with real randomness; an odd player joins a team (or sits out) */
function runDraw(g,pot,opt){
  opt=opt||{}; const ev=gameEvent(g), E=potEngine(pot), size=E.teamSize||2;
  const evp=new Map(evPlayers(ev).map(x=>[x.p.id,x.p])), ps=potPlayers(g,pot).filter(p=>p.gpid&&evp.has(p.gpid)).map(p=>evp.get(p.gpid));
  if(ps.length<size) return null;
  let teams=drawTeams(ps,size,opt.method||'random',p=>effIndex(ev,p).idx).filter(t=>t.length);
  const short=teams.filter(t=>t.length<size), full=teams.filter(t=>t.length>=size);
  if(short.length&&full.length){ const left=short.flat(); teams=full; if(opt.odd==='out') pot.sitOut=left.map(p=>p.id); else { left.forEach((p,i)=>teams[secureInt(teams.length)].push(p)); pot.sitOut=[]; } }
  else pot.sitOut=[];
  pot.teams={}; teams.forEach((t,i)=>t.forEach(p=>{ pot.teams[p.id]='S'+(i+1); }));
  const log=(pot.draw&&pot.draw.log)||[]; if(opt.reason) log.push({at:new Date().toISOString(),reason:opt.reason});
  pot.draw={at:new Date().toISOString(),method:opt.method||'random',size,log};
  applyPotTeams(g,pot); persist();
  return teams;
}
/* the drawing, on a stage: the result is drawn and saved first, then revealed one team at a time */
function drawStage(g,pot){
  const ev=gameEvent(g), E=potEngine(pot), size=E.teamSize||2, ps=potPlayers(g,pot).filter(p=>p.gpid), known=potTeamsKnown(pot);
  if(ps.length<size){ toast('Not enough players in this competition to draw'); return; }
  if(known){ const reason=prompt('Re-draw the partners? Say why — it goes on the record.'); if(reason==null) return; if(!reason.trim()){ toast('A reason is needed to re-draw'); return; } pot._redraw=reason.trim(); }
  const ov=document.createElement('div'); ov.className='rf-show'; document.body.appendChild(ov);
  try{ const fs=ov.requestFullscreen&&ov.requestFullscreen(); if(fs&&fs.catch) fs.catch(()=>{}); }catch(_){}
  let timer=null, running=false;
  const close=()=>{ clearTimeout(timer); if(document.fullscreenElement) document.exitFullscreen().catch(()=>{}); ov.remove(); document.removeEventListener('keydown',key); render(); };
  const wait=ms=>new Promise(r=>{ timer=setTimeout(r,ms); });
  const header=`<div class="rf-top"><img src="${typeof crestSrc==='function'?crestSrc():'crest.png'}" alt=""><div><div class="rf-k">${esc(orgName())} · ${esc(gameTitle(g))}</div><div class="rf-h">${esc(pot.name)} — the draw</div></div><button class="rf-x" id="dwClose" aria-label="Close">✕</button></div>`;
  const tools=enabledGames().filter(x=>x.tool);
  const setup=()=>{ ov.innerHTML=header+`<div class="rf-stage"><div class="rf-lbl">${ps.length} players · teams of ${size}</div>
      <div class="dw-opts"><label>How<select class="inp" id="dwM">${tools.map(x=>`<option value="${x.id.replace('draw','')}">${esc(x.name)}</option>`).join('')||'<option value="random">Random</option>'}</select></label>
        ${ps.length%size?`<label>Odd player<select class="inp" id="dwO"><option value="join">Joins a team (one team of ${size+1})</option><option value="out">Sits out of this competition</option></select></label>`:''}</div>
      <button class="rf-go" id="dwGo">Draw the partners</button><div class="rf-hint">The draw is made and saved before the reveal — or press the space bar</div></div>
      <div class="rf-facts"><span><b>${ps.length}</b> players</span><span><b>${Math.floor(ps.length/size)}</b> teams</span>${pot.draw?`<span>Last drawn <b>${new Date(pot.draw.at).toLocaleString()}</b></span>`:''}</div>`;
    ov.querySelector('#dwClose').onclick=close; ov.querySelector('#dwGo').onclick=run; };
  async function run(){ if(running) return; running=true; const method=ov.querySelector('#dwM').value, oddSel=ov.querySelector('#dwO'), odd=oddSel?oddSel.value:'join';
    const teams=runDraw(g,pot,{method,odd,reason:pot._redraw}); delete pot._redraw; if(!teams){ running=false; toast('Could not draw'); close(); return; }
    const names=ps.map(p=>gpName(p).split(' ')[0]+' '+(gpName(p).split(' ')[1]||'').slice(0,1)+'.'), first=p=>gpName(g.players.find(x=>x.gpid===p.id)||{name:p.name});
    ov.innerHTML=header+`<div class="rf-stage"><div class="rf-lbl" id="dwLbl">Team 1</div><div class="dw-team" id="dwTeam">${Array.from({length:Math.max(...teams.map(t=>t.length))},(_,k)=>`<div class="dw-slot" id="dwS${k}">?</div>`).join('')}</div><div class="dw-done" id="dwDone"></div></div><div class="rf-facts" id="dwFacts"><span><b>${teams.length}</b> teams</span><span>Drawn with the browser’s cryptographic random numbers</span></div>`;
    const pool=ps.map(p=>gpName(p)); const slots=k=>ov.querySelector('#dwS'+k), done=ov.querySelector('#dwDone');
    for(let i=0;i<teams.length;i++){ const t=teams[i]; ov.querySelector('#dwLbl').textContent=`Team ${i+1} of ${teams.length}`;
      for(let k=0;k<Math.max(...teams.map(x=>x.length));k++){ const s=slots(k); if(s){ s.textContent=k<t.length?'?':''; s.className='dw-slot'+(k<t.length?'':' empty'); } }
      for(let k=0;k<t.length;k++){ const s=slots(k); s.classList.add('rolling'); const steps=[]; for(let z=0;z<16;z++) steps.push(40+Math.round(z*z*1.2));
        for(const ms of steps){ s.textContent=pool[secureInt(pool.length)]; await wait(ms); }
        s.textContent=first(t[k]); s.classList.remove('rolling'); s.classList.add('won'); await wait(i===teams.length-1&&k===t.length-1?1400:800); }
      done.insertAdjacentHTML('beforeend',`<div class="rf-sum"><span>Team ${i+1}</span><b>${esc(t.map(first).join(' & '))}</b></div>`);
      await wait(i===teams.length-2?1600:900); }
    ov.querySelector('#dwLbl').textContent='The partners'; ov.querySelector('#dwTeam').style.display='none';
    if(pot.sitOut&&pot.sitOut.length) done.insertAdjacentHTML('beforeend',`<div class="rf-sum"><span>Sitting out of ${esc(pot.name)}</span><b>${esc(pot.sitOut.map(id=>first({id,name:''})).join(', '))}</b></div>`);
    ov.querySelector('#dwFacts').innerHTML=`<span><b>${teams.length}</b> teams drawn · ${new Date(pot.draw.at).toLocaleTimeString([],{hour:'numeric',minute:'2-digit'})}</span><button class="rf-go" id="dwFin" style="margin-left:auto">Done</button>`;
    ov.querySelector('#dwFin').onclick=close; running=false; }
  const key=e=>{ if(e.key==='Escape') close(); if(e.code==='Space'){ e.preventDefault(); const b=ov.querySelector('#dwGo'); if(b) b.click(); } };
  document.addEventListener('keydown',key); setup();
}

/* ---------- scoring a competition from the day's cards ---------- */
/* a competition as the scoring page sees it: engine fields, players, teams, and (skins) the rules */
const potLive=pot=>pot.kind==='skins'?!!skinsRulesOf(pot).live:pot.rules.live!==false;
function potComp(g,pot){
  const E=potEngine(pot), c={id:pot.id,name:pot.name,kind:pot.kind,players:potPlayers(g,pot).map(p=>p.gpid).filter(Boolean),teams:potIsTeam(pot)&&potTeamsKnown(pot)?pot.teams:null,sitOut:pot.sitOut||[],scoring:pot.rules.scoring||'gross'};
  COMP_KEYS.forEach(k=>{ if(k!=='scoring'&&E[k]!==undefined) c[k]=E[k]; });
  if(pot.kind==='skins'){ const sk=skinsRulesOf(pot); c.skins={net:sk.net,grossBeatsNet:sk.grossBeatsNet,validate:sk.validate,carry:sk.carry,mode:sk.mode}; c.scoring=sk.net?'net':'gross'; }
  return c;
}
/* the competitions shown on the live leaderboard for a game's event (dots are tallied by hand, so never) */
function gameComps(ev){ const g=gamesData().find(x=>x.id===ev.gameId); if(!g) return []; return g.pots.filter(p=>(p.kind==='format'||p.kind==='skins')&&potLive(p)).map(p=>potComp(g,p)); }
/* the public event cut down to one competition: its players, its format, its teams */
function potPub(g,pot){ const ev=gameEvent(g); if(!ev) return null; return compPub(publicEvent(ev),potComp(g,pot)); }
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
  const byG=new Map(potPlayers(g,pot).filter(p=>p.gpid).map(p=>[p.gpid,p])), out=[];
  rows.filter(r=>r.n).forEach(r=>{ if(r.team){ const ms=(r.members||[]).map(id=>byG.get(id)).filter(Boolean); if(ms.length) out.push({pos:r.pos,team:true,players:ms,name:ms.map(gpName).join(' / ')}); }
    else { const p=byG.get(r.id); if(p) out.push({pos:r.pos,team:false,players:[p],name:gpName(p)}); } });
  return out;
}
function payByFinish(g,pot,rows,title,noteFn){
  const mo=potTotal(g,pot), order=finishOrder(g,pot,rows), manual=!order.length, inP=potPlayers(g,pot);
  let pcts=(pot.rules.places&&pot.rules.places.length)?pot.rules.places.slice():defaultPcts(order.length||inP.length);
  const orderNow=()=>manual?inP.map(p=>({pos:+($('pf_'+p.id)?.value||0),team:false,players:[p],name:gpName(p)})).filter(x=>x.pos>0).sort((a,b)=>a.pos-b.pos):order;
  const preview=()=>{ const o=orderNow(); const res=splitByFinish(fnum('pfAmt'),o.map((x,i)=>({id:i,name:x.name,pos:x.pos})),pcts).map(r=>Object.assign(r,{unit:o[r.id]}));
    const el=$('pfPrev'); if(el) el.innerHTML=res.length?res.map(r=>`<div class="mr num" style="grid-template-columns:40px minmax(0,1fr) 90px"><b>${r.pos}</b><span>${esc(r.name)}${r.unit.team?` <span class="muted">· ${gMoney(r.amount/r.unit.players.length)} each</span>`:''}</span><b class="r">${gMoney(r.amount)}</b></div>`).join('')+`<div class="mr num" style="grid-template-columns:minmax(0,1fr) 90px"><span class="muted">Total</span><b class="r">${gMoney(sum(res,r=>r.amount))}</b></div>`:'<div class="mr"><span class="muted">Nothing to split yet.</span></div>'; return res; };
  openDrawer({kicker:gameTitle(g)+' · '+pot.name,title,saveLabel:'Record payouts',wide:manual,
    body:pair(field('Pot to split $','pfAmt',mo,{type:'number'}),field('Split %','pfP',pcts.join(' / '),{hint:'1st / 2nd / 3rd… Ties share the places they cover.'}))+
      (manual?`<div class="fld"><span class="lbl">Finish positions (no scores — enter them by hand)</span><div class="mini">${inP.map(p=>`<div class="mr" style="grid-template-columns:minmax(0,1fr) 80px"><span>${esc(gpName(p))}</span><input class="inp r" id="pf_${p.id}" inputmode="numeric" placeholder="—" aria-label="${esc(gpName(p))} finish"></div>`).join('')}</div><p class="hint">Same number = tied.</p></div>`
        :`<p class="hint">From the standings: ${esc(order.slice(0,4).map(r=>r.pos+'. '+r.name).join(' · '))}${order.length>4?' …':''}</p>`)+
      `<div class="fld"><span class="lbl">Payouts</span><div class="mini" id="pfPrev"></div></div>`+(pot.payouts.length?'<p class="hint">Replaces the payouts recorded for this competition.</p>':''),
    wire:r=>{ const re=()=>{ pcts=fv('pfP').split(/[\/,\s]+/).map(Number).filter(x=>x>0); if(!pcts.length) pcts=[100]; preview(); }; r.querySelectorAll('input').forEach(i=>i.oninput=re); re(); },
    save:()=>{ const res=preview(); if(!res.length){ toast('Enter finish positions first'); return false; } const tied=pos=>res.filter(x=>x.pos===pos).length>1; pot.rules.places=pcts.slice();
      pot.payouts=[]; res.forEach(r=>{ const ps=r.unit.players, cents=Math.round(r.amount*100), each=Math.floor(cents/ps.length); let odd=cents-each*ps.length; ps.forEach(p=>pot.payouts.push({id:uid(),pid:p.id,amount:(each+(odd-->0?1:0))/100,note:gOrdinal(r.pos)+(tied(r.pos)?' (tied)':'')+(noteFn?' · '+noteFn():'')})); });
      toast(`${pot.payouts.length} payout${pot.payouts.length===1?'':'s'} recorded`); }});
}
function payFormat(g,pot){
  const ev=gameEvent(g); if(!ev){ toast('No scoring event'); return; }
  if(potIsTeam(pot)&&!potTeamsKnown(pot)){ toast((pot.rules.teamsBy||'hand')==='hand'?'Pick the teams first':'Draw the partners first'); if((pot.rules.teamsBy||'hand')==='hand') pickTeams(g,pot); else drawStage(g,pot); return; }
  const pub=potPub(g,pot), rows=eventBoard(pub,scoresFor(ev),{sort:pub.scoring});
  if(pub.format==='match'&&pub.matchScoring==='nassau'&&potIsTeam(pot)) return payNassau(g,pot,rows);
  payByFinish(g,pot,rows,`${pot.name}: pay out`,()=>potCat(pot).name+(pot.draw?' (drawn partners)':''));
}
/* a team Nassau: each segment (front, back, 18) is its own bet — the losing side's stakes go to the winners, a halved
   segment is a push. Payouts are what each player pulls out of the pot: their own stake back on a push or a win,
   plus the opponents' on a win. */
function nassauSegments(rows){
  const byId=new Map(rows.map(r=>[r.id,r])); const out=[];
  rows.filter(r=>r.holesUp>=0).forEach(A=>{ const B=rows.find(r=>r!==A&&r.opp===A.name&&r.name===A.opp); if(!B||out.some(m=>m.A===B)) return;
    let f=0,b=0; (A.holes||[]).forEach(x=>{ const d=x.a<x.b?1:x.b<x.a?-1:0; if(x.h<=9) f+=d; else b+=d; }); const n=(A.holes||[]).length;
    out.push({A,B,front:{up:f,done:n>=9},back:{up:b,done:n>=18},total:{up:f+b,done:n>=18}}); });
  return out;
}
function payNassau(g,pot,rows){
  const st=nassauStakes(pot), M=nassauSegments(rows), byG=new Map(potPlayers(g,pot).filter(p=>p.gpid).map(p=>[p.gpid,p]));
  if(!M.length){ toast('No match yet — pick the teams and get some scores in'); return; }
  const segs=[['front','Front nine'],['back','Back nine'],['total','The 18']];
  const calc=()=>{ const pays=new Map(), add=(pid,amt,note)=>{ const x=pays.get(pid)||{amount:0,notes:[]}; x.amount+=amt; x.notes.push(note); pays.set(pid,x); }; const lines=[];
    for(const m of M){ for(const [k,label] of segs){ const s=n0($('pn_'+k)?$('pn_'+k).value:st[k]); if(!s) continue; const seg=m[k], a=m.A.members.map(id=>byG.get(id)).filter(Boolean), b=m.B.members.map(id=>byG.get(id)).filter(Boolean), pool=s*(a.length+b.length);
        if(!seg.done){ lines.push({label,txt:`${m.A.name} vs ${m.B.name} · not finished`,amt:0}); a.concat(b).forEach(p=>add(p.id,s,label+' · open, stake back')); continue; }
        if(seg.up===0){ lines.push({label,txt:'Halved — a push',amt:0}); a.concat(b).forEach(p=>add(p.id,s,label+' · halved')); continue; }
        const W=seg.up>0?a:b, L=seg.up>0?b:a, each=Math.round(pool*100/W.length)/100; lines.push({label,txt:`${(seg.up>0?m.A:m.B).name} ${Math.abs(seg.up)} up`,amt:pool}); W.forEach(p=>add(p.id,each,`${label} · won ${Math.abs(seg.up)} up`)); } }
    const el=$('pnPrev'); if(el) el.innerHTML=lines.map(l=>`<div class="mr num" style="grid-template-columns:100px minmax(0,1fr) 90px"><b>${l.label}</b><span>${esc(l.txt)}</span><b class="r">${l.amt?gMoney(l.amt):'—'}</b></div>`).join('')+[...pays.entries()].map(([pid,x])=>{ const p=g.players.find(y=>y.id===pid); return `<div class="mr num" style="grid-template-columns:minmax(0,1fr) 90px"><span>${esc(p?gpName(p):'—')} <span class="muted">${esc(x.notes.join(' · '))}</span></span><b class="r">${gMoney(x.amount)}</b></div>`; }).join('');
    return pays; };
  openDrawer({kicker:gameTitle(g)+' · '+pot.name,title:'Settle the match',saveLabel:'Record payouts',wide:true,
    body:`<div style="display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:12px">${field('Front $ per player','pn_front',st.front,{type:'number'})}${field('Back $ per player','pn_back',st.back,{type:'number'})}${field('18 $ per player','pn_total',st.total,{type:'number'})}</div>
      <div class="fld"><span class="lbl">Result</span><div class="mini" id="pnPrev"></div></div><p class="hint">Each segment: the losing side's stakes go to the winners; a halved segment is a push and everyone gets that stake back. Payouts replace any recorded for this competition.</p>`,
    wire:r=>{ r.querySelectorAll('input').forEach(i=>i.oninput=calc); calc(); },
    save:()=>{ const pays=calc(); pot.rules.nassau={front:fnum('pn_front'),back:fnum('pn_back'),total:fnum('pn_total')}; pot.entry=pot.rules.nassau.front+pot.rules.nassau.back+pot.rules.nassau.total;
      pot.payouts=[...pays.entries()].filter(([,x])=>x.amount>0).map(([pid,x])=>({id:uid(),pid,amount:Math.round(x.amount*100)/100,note:x.notes.join(' · ')})); toast('Match settled'); }});
}
/* ---------- skins ---------- */
/* skins rules. mode 'pot' (the group's game): one pot divided by the skins won; a tied hole is nobody's, a skin that fails
   validation is lost. mode 'hole': the pot split over 18 holes, a tied hole's money carries to the next. */
const skinsRulesOf=pot=>{ const sk=pot.rules.skins=pot.rules.skins||{net:true,grossBeatsNet:true,validate:'netpar',mode:'pot'}; if(sk.validate==='gross') sk.validate='par'; if(sk.validate==='net') sk.validate='netpar'; if(!sk.validate) sk.validate='none';
  if(sk.mode!=='hole') sk.mode='pot'; sk.carry=sk.mode==='hole'; return sk; };
const SKINS_DEFAULT=(g,pot)=>Object.assign({},skinsRulesOf(pot));
function skinsCalc(g,pot,rules){
  const ev=gameEvent(g); if(!ev) return null;
  const byG=new Map(potPlayers(g,pot).filter(p=>p.gpid).map(p=>[p.gpid,p]));
  const r=skinsResult(publicEvent(ev),scoresFor(ev),rules||skinsRulesOf(pot),[...byG.keys()]);
  r.wins.forEach(w=>{ const p=byG.get(w.pid); w.pid=p.id; w.name=gpName(p); }); r.per=Object.fromEntries(Object.entries(r.per).map(([k,v])=>[byG.get(k).id,v])); return r;
}
const skinsRuleText=r=>[r.mode==='hole'?'per hole, ties carry over':'pot ÷ skins won',r.net?(r.grossBeatsNet?'net, gross beats net':'net'):'gross',r.validate&&r.validate!=='none'?'validated by '+(SKIN_VALID_LABEL[r.validate]||r.validate).replace(' or better on the next hole','').toLowerCase()+' on the next hole':''].filter(Boolean).join(' · ');
/* what one skin is worth: pot ÷ skins won, or (per hole) the pot over 18 holes */
const skinValue=(rules,amt,r)=>rules.mode==='hole'?amt/18:(r&&r.total?amt/r.total:0);
function paySkins(g,pot){
  const ev=gameEvent(g); if(!ev){ toast('No scoring event'); return; }
  const rules=SKINS_DEFAULT(g,pot);
  const calc=()=>{ const r=skinsCalc(g,pot,rules), amt=fnum('skAmt'), el=$('skPrev'), per=rules.mode==='hole'; if(!el) return r;
    if(!r||!r.wins.length){ el.innerHTML=`<div class="mr"><span class="muted">${r&&r.incomplete===18?'No scores yet':'No skins won yet'+(per&&r&&r.carried?` · ${r.carried} carried`:'')}.</span></div>`; return r; }
    const val=skinValue(rules,amt,r);
    el.innerHTML=r.wins.map(w=>`<div class="mr num" style="grid-template-columns:60px minmax(0,1fr) 90px"><b>Hole ${w.hole}</b><div class="cell2"><span>${esc(w.name)} <span class="muted">${w.score}${rules.net&&w.net!==w.score?' (net '+w.net+')':''}${per&&w.count>1?' · '+w.count+' holes':''}</span></span>${w.status==='void'?`<small class="neg">Void — missed it on hole ${w.checkHole}${per?', carried':''}</small>`:w.status==='pending'?`<small class="muted">Waiting on hole ${w.checkHole} to validate</small>`:''}</div><b class="r ${w.status==='won'?'':'muted'}">${w.status==='won'?gMoney(val*w.count):'—'}</b></div>`).join('')+
      `<div class="mr num" style="grid-template-columns:minmax(0,1fr) 90px"><span class="muted">${per?`${r.total} of 18 holes won at ${gMoney(val)} a hole`:`${r.total} skin${r.total===1?'':'s'}${r.total?' at '+gMoney(val):''}`}${r.pending?` · ${r.pending} pending`:''}${r.incomplete?` · ${r.incomplete} hole${r.incomplete===1?'':'s'} not finished by everyone`:''}${per&&r.carried?` · ${r.carried} carried, unpaid`:''}${r.lost?` · ${r.lost} void`:''}</span><b class="r">${gMoney(per?val*r.total:(r.total?amt:0))}</b></div>`; return r; };
  openDrawer({kicker:gameTitle(g)+' · '+pot.name,title:'Pay out skins',saveLabel:'Record skins',
    body:pair(field('Skins pot $','skAmt',potTotal(g,pot),{type:'number'}),`<div class="fld"><span class="lbl">Scoring</span>${seg('skNet',[['gross','Gross'],['net','Net'],['gbn','Net · gross beats net']],rules.net?(rules.grossBeatsNet?'gbn':'net'):'gross')}</div>`)+
      pair(field('Validation','skVal',rules.validate||'none',{type:'select',options:Object.entries(SKIN_VALID_LABEL)}),field('Format','skMode',rules.mode,{type:'select',options:[['pot','Skins pot — divided by the skins won'],['hole','Per hole — pot over 18 holes, ties carry over']]}))+
      `<div class="fld"><span class="lbl">Skins</span><div class="mini" id="skPrev"></div></div><p class="hint">Only players in this pot count, and a hole counts once all of them have scored it. Gross beats net: on a net tie, the one player who made that score without a stroke takes the skin. Validation: the winner must meet the standard on their next hole or the skin is void; a skin on the last hole stands.</p>`,
    wire:r=>{ wireSeg(r,'skNet',v=>{ rules.net=v!=='gross'; rules.grossBeatsNet=v==='gbn'; calc(); }); r.querySelector('#skVal').onchange=e=>{ rules.validate=e.target.value; calc(); }; r.querySelector('#skMode').onchange=e=>{ rules.mode=e.target.value; rules.carry=rules.mode==='hole'; calc(); }; r.querySelector('#skAmt').oninput=calc; calc(); },
    save:()=>{ const r=skinsCalc(g,pot,rules); pot.rules.skins=Object.assign({},rules); if(!r||!r.total){ toast(r&&r.pending?'Skins are still waiting on validation holes':'No skins to pay yet'); return false; } const amt=fnum('skAmt'), val=skinValue(rules,amt,r), paidAmt=rules.mode==='hole'?val*r.total:amt;
      const cents=Object.entries(r.per).map(([pid,n])=>({pid,n,c:Math.floor(paidAmt*100*n/r.total)})); let rem=Math.round(paidAmt*100)-cents.reduce((a,x)=>a+x.c,0); for(let i=0;rem>0;i++,rem--) cents[i%cents.length].c++;
      pot.payouts=cents.map(x=>({id:uid(),pid:x.pid,amount:x.c/100,note:`${x.n} ${rules.mode==='hole'?'hole':'skin'}${x.n===1?'':'s'} · ${skinsRuleText(rules)}`}));
      toast(`${r.total} ${rules.mode==='hole'?'holes':'skins'} paid at ${gMoney(val)}`); }});
}
/* the skins call-out: hole by hole from the cards, read out after the round — one hole per tap, validations shown as
   they fall; opening it marks the pot as called out so the game page shows the standings from then on */
function skinsCallout(g,pot){
  const ev=gameEvent(g); if(!ev){ toast('No scoring event'); return; }
  const rules=skinsRulesOf(pot), r=skinsCalc(g,pot,rules); if(!r){ toast('No scores yet'); return; }
  const pub=publicEvent(ev), sc=scoresFor(ev), byG=new Map(potPlayers(g,pot).filter(p=>p.gpid).map(p=>[p.gpid,p]));
  const order=(()=>{ const grp=pub.groups[0]; return grp?playOrder(grp.startHole):Array.from({length:18},(_,i)=>i+1); })();
  // every hole in play order: the winner, or why it carried / tied; validation holes point back at the skin they decide
  const winAt=Object.fromEntries(r.wins.map(w=>[w.hole,w]));
  const lowAt=h=>{ const rows=[]; for(const gr of pub.groups){ const c=pub.courses[gr.course]; if(!c) continue; for(const p of gr.players){ if(!byG.has(p.id)) continue; const s=+((sc[p.id]||{})[h]); if(!s) continue; const hc=(c.hcp[p.set||'M']||c.hcp.M)[h-1], k=rules.net&&typeof p.ph==='number'?strokesOn(p.ph,hc):0; rows.push({name:byG.get(p.id)?gpName(byG.get(p.id)):p.name,s,net:s-k}); } }
    if(!rows.length) return null; const key=x=>rules.net?x.net:x.s, low=Math.min(...rows.map(key)); return {low,who:rows.filter(x=>key(x)===low),n:rows.length}; };
  const total=potTotal(g,pot), per=rules.mode==='hole', val=skinValue(rules,total,r), validating=rules.validate&&rules.validate!=='none';
  const idx=h=>order.indexOf(h);
  // the line for each hole; a won skin's verdict is only shown once its validation hole has been called
  const lineFor=(h,upto)=>{ const w=winAt[h], L=lowAt(h); if(!L) return {h,txt:'No scores on this hole yet',cls:'muted'};
    if(w){ const name=`${w.name} · ${w.score}${rules.net&&w.net!==w.score?' (net '+w.net+')':''}`, worth=per?`${w.count>1?w.count+' holes':'1 hole'} · ${gMoney(val*w.count)}`:`skin · ${gMoney(val)}`;
      if(validating&&w.checkHole!=null&&idx(w.checkHole)>=upto) return {h,txt:name,sub:`skin — validates on hole ${w.checkHole}`,cls:'pending'};
      if(w.status==='won') return {h,txt:name,sub:worth+(validating&&w.checkHole!=null?' · validated on hole '+w.checkHole:''),cls:'won'};
      if(w.status==='void') return {h,txt:name,sub:`didn’t validate on hole ${w.checkHole}${per?' — carried on':' — no skin'}`,cls:'void'};
      return {h,txt:name,sub:`waiting on hole ${w.checkHole}`,cls:'pending'}; }
    return {h,txt:L.who.length>1?`${L.who.map(x=>x.name.split(' ')[0]).join(', ')} tied at ${L.low}`:`${L.who[0].name} low, but not outright`,sub:per?'carries over':'no skin',cls:'muted'}; };
  pot.calledOut=true; persist();
  const ov=document.createElement('div'); ov.className='rf-show'; document.body.appendChild(ov);
  try{ const fs=ov.requestFullscreen&&ov.requestFullscreen(); if(fs&&fs.catch) fs.catch(()=>{}); }catch(_){}
  let i=0, flash=null;   // flash: the verdict interstitial shown before the next hole's result
  const close=()=>{ if(document.fullscreenElement) document.exitFullscreen().catch(()=>{}); ov.remove(); document.removeEventListener('keydown',key); render(); };
  const paint=()=>{ const shown=order.slice(0,i).map(h=>lineFor(h,i)); const done=i>=order.length;
    ov.innerHTML=`<div class="rf-top"><img src="${typeof crestSrc==='function'?crestSrc():'crest.png'}" alt=""><div><div class="rf-k">${esc(orgName())} · ${esc(gameTitle(g))}</div><div class="rf-h">${esc(pot.name)} — from the cards</div></div><button class="rf-x" id="skClose" aria-label="Close">✕</button></div>
      ${flash?`<div class="rf-stage sk-flash ${flash.ok?'ok':'bad'}"><div class="sk-flash-h">Hole ${flash.w.hole} · ${esc(flash.w.name)}</div><div class="sk-flash-big">${flash.ok?'Validated':'Didn’t validate'}</div><div class="sk-flash-s">${flash.ok?`${esc((SKIN_VALID_LABEL[rules.validate]||'').replace(' or better on the next hole','').toLowerCase())} or better on hole ${flash.w.checkHole} — the skin stands`:`missed ${esc((SKIN_VALID_LABEL[rules.validate]||'').replace(' or better on the next hole','').toLowerCase())} on hole ${flash.w.checkHole}${per?' — carried on':' — no skin'}`}</div><button class="rf-go" id="skNext">Hole ${flash.w.checkHole}</button><div class="rf-hint">or press the space bar</div></div>`
      :`<div class="rf-stage" style="justify-content:flex-start;padding-top:26px"><div class="rf-lbl">${done?'All 18 holes':'Hole by hole · '+skinsRuleText(rules)}</div>
        <div class="sk-list">${shown.map(l=>`<div class="sk-line ${l.cls}"><b>${l.h}</b><div><span>${esc(l.txt)}</span>${l.sub?`<small>${esc(l.sub)}</small>`:''}</div></div>`).join('')}</div>
        ${done?`<div class="rf-sum" style="margin-top:14px"><span>${per?`${r.total} of 18 holes won`:`${r.total} skin${r.total===1?'':'s'}`} · ${gMoney(total)} pot</span><b>${r.total?gMoney(val)+(per?' a hole':' a skin'):'No skins today'}</b><small>${Object.entries(r.per).map(([pid,n])=>{ const p=g.players.find(x=>x.id===pid); return `${p?gpName(p):'—'} ${n}`; }).join(' · ')}${r.pending?' · '+r.pending+' still pending':''}</small></div>`
          :`<button class="rf-go" id="skNext">${i?'Next hole':'Start at hole '+order[0]}</button><div class="rf-hint">or press the space bar</div>`}</div>`}
      <div class="rf-facts"><span><b>${byG.size}</b> in the skins</span><span><b>${gMoney(total)}</b> pot</span>${done&&!flash?`<button class="rf-go" id="skFin" style="margin-left:auto">Done</button>`:''}</div>`;
    ov.querySelector('#skClose').onclick=close; const nx=ov.querySelector('#skNext'); if(nx) nx.onclick=next; const fin=ov.querySelector('#skFin'); if(fin) fin.onclick=close; };
  const next=()=>{ if(flash){ flash=null; i++; paint(); const el=ov.querySelector('.sk-list'); if(el) el.scrollTop=el.scrollHeight; return; }
    const nh=order[i]; const w=validating&&nh!=null?r.wins.find(x=>x.checkHole===nh&&x.status!=='pending'):null;   // a skin decided by the hole about to be called
    if(w){ flash={w,ok:w.status==='won'}; paint(); return; }
    i++; paint(); const el=ov.querySelector('.sk-list'); if(el) el.scrollTop=el.scrollHeight; };
  const key=e=>{ if(e.key==='Escape') close(); if(e.code==='Space'){ e.preventDefault(); const b=ov.querySelector('#skNext')||ov.querySelector('#skFin'); if(b) b.click(); } };
  document.addEventListener('keydown',key); paint();
}
/* ---------- dots / doodah ---------- */
const DOTS_DEFAULT={birdie:1,eagle:3,net:false,kinds:['Sandy','Greenie','Chip-in','Polie']};
const dotsRules=pot=>{ pot.rules.dots=Object.assign({},DOTS_DEFAULT,pot.rules.dots||{}); return pot.rules.dots; };
const dotsRuleText=pot=>{ const r=dotsRules(pot); return `birdie ${r.birdie} · eagle ${r.eagle}${r.net?' (net)':''} · ${r.kinds.join(', ').toLowerCase()}`; };
/* birdies and eagles per player from the scores (gross, or net with each player's strokes) */
function dotsAuto(g,pot,rules){
  const ev=gameEvent(g), out={}; if(!ev) return out; const pub=publicEvent(ev), sc=scoresFor(ev), byG=new Map(potPlayers(g,pot).filter(p=>p.gpid).map(p=>[p.gpid,p]));
  for(const gr of pub.groups){ const c=pub.courses[gr.course]; if(!c) continue; for(const p of gr.players){ const gp=byG.get(p.id); if(!gp) continue; const par=c.par[p.set||'M']||c.par.M, hc=c.hcp[p.set||'M']||c.hcp.M; let b=0,e=0;
    for(let h=1;h<=18;h++){ const s=+((sc[p.id]||{})[h]); if(!s) continue; const k=rules.net&&typeof p.ph==='number'?strokesOn(p.ph,hc[h-1]):0; const d=s-k-par[h-1]; if(d===-1) b++; else if(d<=-2) e++; }
    out[gp.id]={birdies:b,eagles:e}; } }
  return out;
}
function payDots(g,pot){
  const rules=dotsRules(pot), inP=potPlayers(g,pot), tally=pot.tally=pot.tally||{};
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
/* the event's own format: a one-ball competition (scramble…) sets it; otherwise everyone plays their own ball */
function gameEventEngine(g){
  const ob=g.pots.find(potOneBall); if(ob) return Object.assign(potEngine(ob),{_pot:ob});
  return Object.assign(engineFrom(catalogById('stroke'),1,1),{_pot:null});
}
/* every game has live scoring: its event exists from the moment the game does, open, and follows the players */
function ensureGameEvent(g){
  const G=golfData(); let ev=gameEvent(g);
  if(!ev){ let slug=slugify(orgShort()+'-'+(g.date||'game')), n=2; while(G.events.some(e=>e.slug===slug)) slug=slugify(orgShort()+'-'+(g.date||'game'))+'-'+(n++);
    ev={id:uid(),status:'live',name:gameTitle(g)+(g.date?' · '+shortDate(g.date):''),date:g.date,defaultTee:'White',defaultCourse:g.course||'oak',slug,tournamentId:'',front:'scramble',back:'shamble',scoring:'net',allow:{},groups:[],pool:[],flights:{count:0,names:[]},createdAt:new Date().toISOString(),gameId:g.id};
    G.events.push(ev); g.golfEventId=ev.id; }
  syncGameEvent(g,ev); return ev;
}
function openScoring(g){ const ev=ensureGameEvent(g); ev.status='live'; golfSave(ev); render(); toast('Scoring is open — share the link'); }
/* every game player has a player in the event; newcomers fill groups of four; the event's format follows the game */
function syncGameEvent(g,ev){
  const have=new Set(evPlayers(ev).map(x=>x.p.id));
  for(const p of g.players){ if(p.gpid&&have.has(p.gpid)) continue;
    const gp={id:uid(),memberId:p.memberId||'',name:gpName(p),tee:ev.defaultTee||'White',set:'M',index:'',flight:'',team:''}; p.gpid=gp.id;
    let grp=ev.groups.find(x=>x.players.length<4);
    if(!grp){ grp={id:uid(),code:newCode(ev),label:'Group '+(ev.groups.length+1),course:g.course||ev.defaultCourse||'oak',startHole:1,teeTime:g.time||'',players:[]}; ev.groups.push(grp); }
    grp.players.push(gp); }
  const ids=new Set(g.players.map(p=>p.gpid)), sc=scoresFor(ev);
  ev.groups.forEach(grp=>{ grp.players=grp.players.filter(p=>ids.has(p.id)||Object.keys(sc[p.id]||{}).length); });
  ev.pool=(ev.pool||[]).filter(p=>ids.has(p.id));
  const E=gameEventEngine(g); EV_GAME_KEYS.forEach(k=>{ ev[k]=E[k]; });
  ev.scoring=g.pots.some(p=>p.kind==='format'&&(p.rules.scoring||'gross')==='net')||g.pots.some(p=>p.kind==='skins'&&skinsRulesOf(p).net)?'net':'gross';
  const teams=E._pot&&E._pot.teams||null; evPlayers(ev).forEach(({p})=>{ p.team=teams?(teams[p.id]||''):''; });
  ev.name=gameTitle(g)+(g.date?' · '+shortDate(g.date):''); ev.date=g.date||ev.date;
}

/* ---------- the game sheet: a branded PDF for the first tee ---------- */
async function gameSheetPDF(g,opt){
  opt=opt||{}; const strokes=opt.strokes!==false, ev=gameEvent(g); if(!ev){ toast('No scoring event'); return; }
  try{ await loadJsPDF(); }catch(e){ toast(e.message); return; }
  const crest=await crestPNG().catch(()=>null), doc=new window.jspdf.jsPDF({unit:'pt',format:'letter'});
  [['ps400','PS-400.ttf','PublicSans','normal'],['ps700','PS-700.ttf','PublicSans','bold'],['ps800','PS-800.ttf','PublicSansXB','normal'],['cg700','CG-700.ttf','Cormorant','bold']].forEach(([k,f,fam,st])=>{ doc.addFileToVFS(f,PDF_FONTS[k]); doc.addFont(f,fam,st); });
  const NAVY=[15,42,56],GOLD=[199,161,58],GOLDL=[216,183,95],GOLDDK=[126,95,26],IVORY=[251,250,245],INK=[20,34,43],MUTED=[86,98,106];
  const L=40,R2=572,W=612,H=792, font=(f,s,z,col)=>{ doc.setFont(f,s); doc.setFontSize(z); doc.setTextColor(...col); };
  const page=()=>{ doc.setFillColor(...IVORY); doc.rect(0,0,W,H,'F'); };
  page();
  const pots=g.pots.filter(p=>p.kind!=='manual'), allIn=sum(pots,p=>n0(p.entry)), course=courseById(g.course);
  font('PublicSans','normal',8.4,[214,218,220]); const sub=doc.splitTextToSize(`${gameWhen(g)} · ${course?course.name:''} · ${g.players.length} players · ${allIn?gMoney(allIn)+' all in':''}`,R2-L-90); const bandH=74+Math.max(0,sub.length-1)*11;
  doc.setFillColor(...GOLD); doc.roundedRect(L,32,R2-L,bandH+4,8,8,'F'); doc.setFillColor(...NAVY); doc.roundedRect(L,32,R2-L,bandH,8,8,'F'); doc.rect(L,32+bandH-12,R2-L,8,'F');
  if(crest) doc.addImage(crest,'PNG',L+16,42,54*914/1180,54);
  font('PublicSansXB','normal',6.8,GOLDL); doc.text(`${(orgName()||'').toUpperCase()} · ${g.season||''}`,L+76,56,{charSpace:1.2});
  font('Cormorant','bold',24,[255,255,255]); doc.text(gameTitle(g),L+76,80);
  font('PublicSans','normal',8.4,[214,218,220]); doc.text(sub,L+76,96);
  let y=32+bandH+26;
  const need=h=>{ if(y+h>H-44){ doc.addPage(); page(); y=48; } };
  const section=(label,note)=>{ need(40); font('PublicSansXB','normal',7.4,GOLDDK); doc.text(label.toUpperCase(),L,y,{charSpace:1.1}); if(note){ font('PublicSans','normal',8,MUTED); doc.text(note,R2,y,{align:'right'}); } y+=6; doc.setDrawColor(...GOLD); doc.setLineWidth(1); doc.line(L,y,R2,y); y+=12; };
  const zebra=i=>{ if(i%2===0){ doc.setFillColor(255,255,255); doc.rect(L-4,y-9,R2-L+8,15,'F'); } };
  // the game
  section('The game',g.payWhen==='before'?'money in before the round':'settled after the round'+(g.settle==='net'?' · net':''));
  g.pots.forEach((pot,i)=>{ const team=potIsTeam(pot), lines=doc.splitTextToSize(potSummary(pot).replace(/^[^·]+· /,''),R2-L-200); need(6+lines.length*11);
    zebra(i); font('PublicSans','bold',9.6,INK); doc.text(pot.name,L,y); font('PublicSans','normal',8.4,MUTED); doc.text(lines,L+150,y); font('PublicSans','bold',10,INK); doc.text(pot.kind==='manual'?'—':gMoney(pot.entry),R2,y,{align:'right'}); y+=Math.max(15,4+lines.length*11); });
  if(allIn){ font('PublicSans','bold',9,INK); doc.text('In everything',L,y); doc.text(gMoney(allIn),R2,y,{align:'right'}); y+=14; }
  y+=8;
  // teams, when they are known before play
  const teamPots=g.pots.filter(p=>potIsTeam(p));
  for(const pot of teamPots){ const by=pot.rules.teamsBy||'hand';
    if(!potTeamsKnown(pot)){ section(pot.name+' — teams'); font('PublicSans','normal',9,MUTED); doc.text(by==='after'?'Partners are drawn after the round.':'Teams to be announced.',L,y); y+=20; continue; }
    const byTeam={}; evPlayers(ev).forEach(({p})=>{ const t=pot.teams[p.id]; if(t) (byTeam[t]=byTeam[t]||[]).push(p); });
    section(pot.name+' — teams',pot.draw?'drawn '+new Date(pot.draw.at).toLocaleString():'');
    Object.keys(byTeam).sort((a,b)=>+a.slice(1)-+b.slice(1)).forEach((k,i)=>{ need(16); zebra(i); font('PublicSans','bold',9.4,INK); doc.text('Team '+k.slice(1),L,y); font('PublicSans','normal',9.4,INK); doc.text(byTeam[k].map(p=>p.name).join(' & '),L+70,y); y+=15; });
    y+=8; }
  // groups as they play
  section('Groups',ev.groups.some(gr=>gr.teeTime)?'tee times':'');
  ev.groups.forEach((grp,gi)=>{ need(20+grp.players.length*14);
    font('PublicSans','bold',9.6,GOLDDK); doc.text(`Group ${grp.code}`,L,y); font('PublicSans','normal',8.4,MUTED); doc.text(`${grp.teeTime?fmtTime(grp.teeTime):'hole '+(grp.startHole||1)}${courseById(grp.course)&&courseById(grp.course)!==course?' · '+courseById(grp.course).name:''}`,L+90,y); y+=13;
    grp.players.forEach((p,i)=>{ const h=strokes?playerHcp(ev,grp,p):null; zebra(i); font('PublicSans','normal',9.4,INK); doc.text(p.name,L+16,y); if(h&&h.ph!=null){ font('PublicSans','normal',8.6,MUTED); doc.text(`${h.ph} stroke${h.ph===1?'':'s'}`,R2,y,{align:'right'}); } y+=14; });
    y+=6; });
  font('PublicSans','normal',7.6,MUTED); need(30);
  doc.text(doc.splitTextToSize(`Scoring: ${scoringLink(ev)} — each group enters its group ID. Generated by the ${orgShort()} hub, ${new Date().toLocaleString()}.`,R2-L),L,Math.max(y+8,H-40));
  if(opt.returnDoc) return doc;
  doc.save(`${slugify(gameTitle(g))}-${g.date||'game'}-sheet.pdf`); toast('Game sheet downloaded');
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
      ${gs.length?`<div class="t">${gs.slice(0,6).map(g=>{ const mo=gameMoney(g), ev=gameEvent(g); return `<div class="tr num click" data-game="${g.id}" style="grid-template-columns:100px minmax(0,1fr) 90px 100px"><span>${g.date?shortDate(g.date).replace(/, \d{4}$/,''):'TBD'}</span><div class="cell2"><b class="trunc">${esc(gameTitle(g))}</b><small>${g.players.length} players · ${esc(gameName(g))}${ev&&isLiveNow(ev)?' · <span class="pos">● live</span>':''}</small></div><span class="r">${gMoney(mo.total)}</span><span>${g.status==='settled'?'<span class="chip navy">Settled</span>':isUpcoming(g)?'<span class="chip">Upcoming</span>':Math.abs(mo.left)>0.004?'<span class="chip warn">Open</span>':'<span class="chip ok">Paid out</span>'}</span></div>`; }).join('')}</div>`
      :`<div class="empty"><b>No games yet</b><span>Design the regular game to start the season.</span><div class="actions"><button class="btn pri" id="dNewG2">${I.plus}New game</button></div></div>`}</div>
    ${ts.length?`<div class="card" style="overflow:hidden"><div class="cardhead"><h2 class="h2">Tournaments</h2><button class="btn sm" data-go="tournaments">All</button></div><div class="t">${ts.slice(0,4).map(t=>`<div class="tr click" data-open="${t.id}" style="grid-template-columns:minmax(0,1fr) 140px"><b class="trunc">${esc(t.name)}</b><span class="muted">${dateRange(t)}</span></div>`).join('')}</div></div>`:''}
    </div>
    <div style="display:flex;flex-direction:column;gap:20px">
      ${typeof liveBoardCard==='function'?liveBoardCard():''}
      <div class="card pad" style="display:flex;flex-direction:column;gap:10px"><div style="display:flex;justify-content:space-between;align-items:center"><h2 class="h2">Standings</h2><button class="btn sm" data-go="ledger">Ledger</button></div>
        ${rows.length?rows.slice(0,8).map((r,i)=>`<div class="num" style="display:grid;grid-template-columns:28px minmax(0,1fr) 50px 80px;gap:8px;font-size:13.5px;align-items:center"><b>${i+1}</b><span class="trunc">${esc(r.name)}</span><span class="muted r">${r.games}</span><b class="r ${netCls(r.net)}">${gSigned(r.net)}</b></div>`).join(''):'<span class="muted">Nobody on the books yet.</span>'}</div>
    </div>
  </div>`;
  wireCommon(m);
  $('dNewG').onclick=()=>designGame(null); const n2=$('dNewG2'); if(n2) n2.onclick=()=>designGame(null);
  m.querySelectorAll('[data-game]').forEach(r=>r.onclick=()=>{ view.gameId=r.dataset.game; go('games'); });
}
