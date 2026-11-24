/* ---------- The guided demo ----------
   The portal's Demo button (next to Open hub on a client's record) opens the client's hub with ?demo=1, and this runs a
   guided, interactive walk through the whole product on that club's own seeded data: a chapter at a time, a step at a
   time, Next / Back / the arrow keys. Each step opens the real page, scrolls to the card, spotlights it and shows the
   talking point. The page stays live — the presenter can click anything, answer "can it do X?", and pick the tour
   back up where it was (the position is remembered per hub). "Hand them a phone" steps show a QR code: the register on
   an iPad, the kitchen screen, a member's portal, the registration page, live scoring in the game being played today.
   A step may live on another organization's hub (the MGA's tournaments, the Thursday game): the tour hops there with
   ?demo=go and resumes. The owner, Nov 24, 2026: "a guided, interactive walkthrough of the entire software… this is how
   we're going to sell and demo this software to each club we show it to." The chapters follow what changes a club's
   day: the floor and the month-end, the member portal, golf out of Golf Genius, one directory, staff, reports. */
const TOUR={on:false,i:0,steps:[],chapters:[],open:false,raf:0,target:null,ready:false};
const TOUR_KEY=()=>'fs_tour_'+(typeof TENANT!=='undefined'&&TENANT?TENANT:'local');
const tourWanted=()=>/[?&]demo=(1|go|resume)\b/.test(location.search);
const tourMode=()=>{ const m=location.search.match(/[?&]demo=(\w+)/); return m?m[1]:''; };

/* ---- the script: chapters of steps. go() opens the page (after the organization hop, when `org` differs), at() finds the
   element to light up (an element, a selector, or null = the page), say is the talking point, qr() a link worth scanning. */
function tourScript(){
  const club=()=>typeof CLUB!=='undefined'?CLUB:null;
  const person=()=>{ const ps=persons(); return ps.find(p=>p.first==='Ty'&&p.last==='Webb')||ps.find(p=>p.email&&p.status==='Active'&&typeof pBilling==='function'&&pBilling(p).class)||ps[0]; };
  const card=txt=>[...document.querySelectorAll('#main .card')].find(c=>{ const h=c.querySelector('h2,.h2,.lbl,h1'); return h&&h.textContent.toLowerCase().includes(txt.toLowerCase()); })||null;
  const first=sel=>document.querySelector('#main '+sel);
  const station=name=>(STN.rows||[]).find(s=>(s.name||'').toLowerCase().includes(name.toLowerCase())&&s.token);
  const stationQR=name=>{ const s=station(name); return s?stationURL(s,s.token):null; };
  const mmT=()=>db.tournaments.find(t=>/member-member/i.test(t.name))||db.tournaments.find(t=>t.calcutta)||db.tournaments[0];
  const regT=()=>db.tournaments.find(t=>t.reg&&t.reg.token)||mmT();
  const liveGame=()=>{ const gs=gamesData(); return gs.find(g=>g.date===today())||gs.filter(g=>g.status!=='settled').sort((a,b)=>a.date.localeCompare(b.date))[0]||gs[gs.length-1]; };
  const today=()=>new Date().toISOString().slice(0,10);
  const CH=[];
  const ch=(title,org,steps)=>CH.push({title,org:org||'club',steps});

  ch('Welcome','club',[
    {t:'One system for the whole club',say:'This is Shady Valley on Flagstick: every department on one screen, one directory, one set of books. What you are seeing is six months of a club’s real activity — tournaments, the registers, bookings, statements — so everything we open today is live, not a mock-up.',go:()=>go('dash'),at:()=>first('.grid')},
    {t:'The rail is the club',say:'Golf, racket sports, aquatics, food & beverage, membership and the club office each have their own section. A manager only opens theirs. Everything else today is one tap away on this rail.',go:()=>go('dash'),at:()=>document.getElementById('nav')},
  ]);
  ch('Membership and the month-end','club',[
    {t:'One directory',say:'Every member once. The club owns the roster; the MGA, the LGA and every member game read from it. No more three copies of the same person in three systems.',go:()=>go('members'),at:()=>first('.tw')||first('.card')},
    {t:'A member’s account',say:'Everything a member does lands on one ledger: dues, the grill, the golf shop, a lesson, a guest fee. Tax and service charge are broken out on every line, and a charge from the register links back to its ticket.',go:()=>{ const p=person(); go('account',{acctId:p.id}); },at:()=>first('.grid')},
    {t:'The ledger and the statement',say:'Each charge has its receipt and can be adjusted with a reason; the original line is never edited. Statements are built here — a page per member, e-mailed in one run.',go:()=>{ const p=person(); go('account',{acctId:p.id}); },at:()=>card('Statements')||card('Account')||first('.tw')},
    {t:'The member portal',say:'Hand them a phone. The member signs in with a one-time e-mail link, sees the balance and every month’s statement, pays by card or bank, keeps a card on file and turns on autopay. This is a staff view of Ty Webb’s portal — every control is live.',go:()=>{ const p=person(); go('account',{acctId:p.id}); },at:()=>document.getElementById('acPortal')||first('.actions'),qr:()=>portalLink()+'?as='+encodeURIComponent(person().id),link:'Open the portal as this member'},
    {t:'Month-end in two buttons',say:'Run monthly billing posts every class charge, prorated for mid-month joins, plus unspent F&B minimums. Run statements posts finance charges and late fees, builds the PDFs, e-mails them and charges autopay cards. Aging is live on this page.',go:()=>go('accounts'),at:()=>first('.phead .actions')||first('.grid')},
    {t:'Online payments on the club’s own merchant account',say:'Cards and bank accounts run through Deluxe on the club’s own merchant account — card data never touches Flagstick. Refunds, cards on file and autopay are all here; every processor call is logged.',go:()=>go('billsetup'),at:()=>card('Online payments')||first('.card')},
    {t:'Dues the associations bill, the club collects',say:'The MGA bills its dues in its own hub; the club puts them on the member’s account and marks them collected. Both sides stay in step without anyone re-keying.',go:()=>go('collections'),at:()=>first('.tw')||first('.card')},
  ]);
  ch('Food & beverage','club',[
    {t:'A register on the floor',say:'This is the Grill Room register as the server sees it on an iPad: a PIN, their tables, the check, Send to the kitchen, Pay. Scan it and ring a check yourself — the PIN is 1010.',go:()=>{ navGo('pos'); if(STN.rows==null&&!STN.loading) stnLoad().then(()=>render()); },at:()=>first('.card'),qr:()=>stationQR('Grill Room'),link:'Open the Grill Room register'},
    {t:'The kitchen screen',say:'A salad fires to the pantry and the steak to the grill; drinks rung at the bar fire nowhere. The expo bumps each course as it goes out. Everything a product needs — modifiers, courses, where it fires — is set once in the menu.',go:()=>{ navGo('posmenu'); },at:()=>card('Products')||first('.card'),qr:()=>stationQR('Kitchen'),link:'Open the kitchen screen'},
    {t:'Charge to the account, sign the slip',say:'A check paid to the account becomes a signed slip with its own check number and QR. The service charge is mandatory, the tip is written on the slip, and the server closes it out from their phone. The charge is already on the member’s ledger.',go:()=>go('postickets'),at:()=>card('Shift')||first('.tw')},
    {t:'The daily close-out',say:'Drop the scanner’s PDF of the day’s slips here: each one is matched to its ticket by the QR, tips are read off the paper, the drawer is counted against cash sales, and the day is closed and locked. The accountant gets a PDF.',go:()=>go('closeout'),at:()=>card('Scan the signed slips')||first('.card')},
  ]);
  ch('Golf','club',[
    {t:'The tee sheet',say:'Two courses, every ten minutes, four players a time. Staff book here; members book from the portal under the club’s rules — how far ahead, how many a day. Block times and close the course for aerification from the same sheet.',go:()=>navGo('teesheet'),at:()=>document.getElementById('bkSheet')||first('.card')},
    {t:'Every organization’s golf, on the club calendar',say:'The club sees every tournament the MGA and the LGA run, with their fields, without touching their money. Each association runs its own hub on the same roster.',go:()=>go('tournaments'),at:()=>card('Association and small-group tournaments')||first('.card')},
  ]);
  ch('A tournament, start to finish','assoc',[
    {t:'The MGA’s hub',say:'This is the Men’s Golf Association’s own hub — its board signs in here and sees only its own tournaments, members and money. Same roster as the club.',go:()=>go('tournaments'),at:()=>first('.tw')||first('.card')},
    {t:'The Member-Member',say:'The main event of the year: three days, two-man teams, flights, the Calcutta, the 50/50, the dinner. Every tab is one tournament’s file.',go:()=>{ const t=mmT(); go('tournament',{tid:t.id,ttab:'overview'}); },at:()=>first('.tabs')},
    {t:'Player registration',say:'A public page branded with the association’s crest: the format, the payouts, the rule sheet, who is in. A member finds their name, adds their partner or asks the shop to pair them. Entries land in the field here with nothing to re-type.',go:()=>{ const t=regT(); go('tournament',{tid:t.id,ttab:'field'}); },at:()=>card('Player registration')||first('.card'),qr:()=>{ const t=regT(); return t.reg&&t.reg.token?SITE_BASE+'register.html?k='+encodeURIComponent(t.reg.token):null; },link:'Open the registration page'},
    {t:'Rounds, pairings, cards',say:'Flights by combined handicap, pairings by standings on day two, printed scorecards with every stroke marked. Results across the rounds are totaled per flight, and the finishes feed the Calcutta.',go:()=>{ const t=mmT(); go('tournament',{tid:t.id,ttab:'rounds'}); },at:()=>first('.card')},
    {t:'The Calcutta',say:'Lots, bidders, buy-ins, the cashier link for the auction night, payouts to the cent with ties shared — and a winners sheet with no dollar figure on it for posting.',go:()=>{ const t=mmT(); go('tournament',{tid:t.id,ttab:'calcutta'}); },at:()=>first('.grid')||first('.tabs')},
    {t:'The association’s money',say:'Budget against actual for the season, every tournament a program of its own, the treasury with the bank import. The treasurer never opens a spreadsheet.',go:()=>go('budget'),at:()=>first('.card')},
  ]);
  ch('Member games and live scoring','group',[
    {t:'A member game, today',say:'This is the Tuesday Shootout, in progress right now. Skins, a quota, the pots — set up in a minute, every competition scored from one round of own-ball golf.',go:()=>{ const g=liveGame(); go('games',{gameId:g.id}); },at:()=>first('.phead')},
    {t:'Live scoring on the players’ phones',say:'No app to install. The group opens the link, types its ID, and every score reaches every phone and the board within seconds. Scan it and join a group.',go:()=>{ const g=liveGame(); go('games',{gameId:g.id}); },at:()=>card('Live scoring'),qr:()=>{ const g=liveGame(), ev=gameEvent(g); const gr=ev&&ev.groups.find(x=>x.players.length); return ev?scoringLink(ev)+(gr?'&g='+encodeURIComponent(gr.code):''):null; },link:'Open the scoring page'},
    {t:'GameCast on the bar TV',say:'The course from the air, every group on the hole it is playing, a live feed of birdies and lead changes, the board per competition. Read-only — it cannot disturb the game.',go:()=>{ const g=liveGame(); go('games',{gameId:g.id}); },at:()=>card('Live scoring'),qr:()=>{ const g=liveGame(), ev=gameEvent(g); return ev?gamecastLink(ev):null; },link:'Open GameCast'},
    {t:'Groups, handicaps and the QR sheets',say:'Drag players between groups, type a tee time, correct an index mid-round — the phones follow in half a minute. Each group gets a printed sheet with the rules and its own QR.',go:()=>{ const g=liveGame(); go('games',{gameId:g.id}); },at:()=>card('Groups')||first('.card')},
    {t:'The season ledger',say:'Who is up and who is down for the year, every game’s money, and the fewest payments that square it.',go:()=>go('ledger'),at:()=>first('.card')},
  ]);
  ch('Pro shops, courts and the pool','club',[
    {t:'The golf shop register',say:'The same register with the shop’s library: balls, gloves with sizes, green fees and carts, club repair. Charge to the account or take a card.',go:()=>navGo('proshop'),at:()=>first('.card')},
    {t:'Courts',say:'Tennis and pickleball on the same sheet as the tee times, with lessons and the racquet shop under the racket pro.',go:()=>navGo('racketbook'),at:()=>document.getElementById('bkSheet')||first('.card')},
    {t:'The pool and cabanas',say:'Cabanas in four-hour slots, swim lessons, the lifeguards on the schedule.',go:()=>navGo('aquabook'),at:()=>document.getElementById('bkSheet')||first('.card')},
  ]);
  ch('Staff and the calendar','club',[
    {t:'Staff, schedule, time clock',say:'One staff list across departments. The PIN that unlocks a register clocks them in. Build the week, copy last week, print it, read the timesheet.',go:()=>navGo('staff'),at:()=>card('Schedule')||first('.card')},
    {t:'The time clock',say:'Who is on now, hours this week, a forgotten clock-out fixed in one tap, a CSV for payroll.',go:()=>navGo('staff'),at:()=>card('Time clock')||first('.card')},
    {t:'The club calendar',say:'Every sheet, every event, every closure and every shift on one month, by department. Public events reach the member portal.',go:()=>go('calendar'),at:()=>first('.card')},
  ]);
  ch('Reports and the office','club',[
    {t:'Reports',say:'The year or the quarter: billed, received, receivable, revenue by item with tax and service, receipts by method, the registers by outlet, the budget. CSV or a branded PDF.',go:()=>go('reports'),at:()=>first('.grid')||first('.card')},
    {t:'The GL export',say:'A month’s journal — AR, revenue by item, service charge, sales tax, cash — ready for the accountant’s system.',go:()=>go('accounts'),at:()=>first('.phead .actions')},
    {t:'Organizations and logins',say:'Associations and member groups each get their own hub and board logins; a group organizer gets an admin link with no password at all.',go:()=>go('orgs'),at:()=>first('.card')},
    {t:'Your club’s own mark',say:'The club’s logo goes on every statement, receipt, scorecard and e-mail, and outgoing mail is sent from the club’s own domain.',go:()=>go('settings'),at:()=>card('Branding')||first('.card')},
  ]);
  ch('Wrap-up','club',[
    {t:'What changes tomorrow',say:'The floor and the month-end on one system. A portal members will use. Golf out of Golf Genius. One roster. The schedule and the time clock on the same PINs. Reports the accountant takes as they are.',go:()=>go('dash'),at:()=>first('.grid')},
  ]);
  return CH;
}

/* ---- the engine ---- */
/* the chapters name the kind of hub they run on; the club's first association and first member group are the ones shown */
function tourOrgs(){ const os=(typeof CLUB!=='undefined'&&CLUB&&CLUB.orgs||[]).filter(o=>!o.archived); const a=os.find(o=>o.kind==='association'), g=os.find(o=>o.kind==='group'); return {club:'club',assoc:a?a.id:null,group:g?g.id:null}; }
function tourStart(at){
  const orgs=tourOrgs(); TOUR.chapters=tourScript().map(c=>Object.assign({},c,{org:orgs[c.org]||c.org})).filter(c=>c.org); TOUR.steps=[]; TOUR.chapters.forEach((c,ci)=>c.steps.forEach((s,si)=>TOUR.steps.push(Object.assign({ch:c.title,ci,si,org:c.org},s))));
  TOUR.on=true; document.body.classList.add('touring'); tourUI(); tourGo(at==null?0:at);
}
function tourEnd(){ TOUR.on=false; document.body.classList.remove('touring'); const b=document.getElementById('tourBox'); if(b) b.remove(); const c=document.getElementById('tourCard'); if(c) c.remove(); cancelAnimationFrame(TOUR.raf); try{ localStorage.removeItem(TOUR_KEY()); }catch(_){} window.removeEventListener('keydown',tourKeys); }
function tourSave(){ try{ localStorage.setItem(TOUR_KEY(),JSON.stringify({i:TOUR.i,at:Date.now()})); }catch(_){} }
function tourOrgURL(org){
  if(typeof HTTP!=='undefined'&&HTTP) return SITE_BASE+(org==='club'?'':org+'/')+'?demo=go';
  const u=new URL(location.href); u.searchParams.set('org',org); u.searchParams.set('demo','go'); u.hash=''; return u.toString();
}
function tourGo(i){
  i=Math.max(0,Math.min(TOUR.steps.length-1,i)); const st=TOUR.steps[i]; if(!st) return; TOUR.i=i; tourSave();
  const here=typeof ORG_ID!=='undefined'?(ORG_ID||'club'):'club';
  if(st.org!==here){ TOUR.on=false; location.href=tourOrgURL(st.org); return; }   // the step lives on another organization's hub: hop, and resume there
  try{ st.go(); }catch(e){ console.warn('tour step',e); }
  tourPaint(true);
}
/* find the step's element once the page has rendered (a loader may still be in flight — try for a few seconds), scroll to it, light it */
function tourPaint(fresh){
  if(!TOUR.on) return; const st=TOUR.steps[TOUR.i]; if(!st) return;
  let tries=fresh?0:40;
  const find=()=>{ let el=null; try{ el=typeof st.at==='function'?st.at():st.at; if(typeof el==='string') el=document.querySelector(el); }catch(_){ el=null; }
    if(el&&el.getBoundingClientRect().height>0){ TOUR.target=el; if(fresh) el.scrollIntoView({block:el.getBoundingClientRect().height>innerHeight*0.7?'start':'center',behavior:'smooth'}); tourFrame(); return; }
    if(tries++<40){ setTimeout(find,150); return; } TOUR.target=null; tourFrame(); };
  tourCard(st); find();
}
function tourFrame(){ cancelAnimationFrame(TOUR.raf); const tick=()=>{ if(!TOUR.on) return; const b=document.getElementById('tourBox'); if(b){ const el=TOUR.target; if(el&&document.contains(el)){ const r=el.getBoundingClientRect(); b.style.display=''; b.style.left=(r.left-8)+'px'; b.style.top=(r.top-8)+'px'; b.style.width=(r.width+16)+'px'; b.style.height=(r.height+16)+'px'; } else b.style.display='none'; } TOUR.raf=requestAnimationFrame(tick); }; tick(); }
function tourUI(){
  if(!document.getElementById('tourBox')){ const b=document.createElement('div'); b.id='tourBox'; b.className='tour-box'; document.body.appendChild(b); }
  if(!document.getElementById('tourCard')){ const c=document.createElement('div'); c.id='tourCard'; c.className='tour-card'; document.body.appendChild(c); }
  window.removeEventListener('keydown',tourKeys); window.addEventListener('keydown',tourKeys);
}
function tourKeys(e){ if(!TOUR.on) return; const tag=(document.activeElement||{}).tagName; if(/INPUT|TEXTAREA|SELECT/.test(tag||'')) return; if(e.key==='ArrowRight'||e.key==='PageDown'||(e.key===' '&&!e.shiftKey)){ e.preventDefault(); tourGo(TOUR.i+1); } else if(e.key==='ArrowLeft'||e.key==='PageUp'||(e.key===' '&&e.shiftKey)){ e.preventDefault(); tourGo(TOUR.i-1); } else if(e.key==='Escape'){ if(TOUR.open){ TOUR.open=false; tourCard(TOUR.steps[TOUR.i]); } } }
function tourCard(st){
  const c=document.getElementById('tourCard'); if(!c) return; const n=TOUR.steps.length, i=TOUR.i, chN=TOUR.chapters.length;
  let qr=null; try{ qr=st.qr?st.qr():null; }catch(_){ qr=null; }
  const chapters=`<div class="tour-ch">${TOUR.chapters.map((ch,ci)=>`<button class="tour-chb${ci===st.ci?' on':''}" data-tch="${ci}"><span class="n">${ci+1}</span><span>${esc(ch.title)}</span><small>${ch.steps.length} step${ch.steps.length===1?'':'s'}</small></button>`).join('')}</div>`;
  c.innerHTML=`<div class="tour-head"><button class="tour-chapters" id="tourChapters" title="Chapters">${esc(st.ch)} <span class="muted">· ${st.si+1}/${TOUR.chapters[st.ci].steps.length}</span> ▾</button><span class="tour-count">${i+1} of ${n}</span><button class="tour-x" id="tourEnd" title="End the demo (Esc twice)">✕</button></div>
    ${TOUR.open?chapters:''}
    <div class="tour-body"><div class="tour-text"><b>${esc(st.t)}</b><p>${esc(st.say)}</p></div>${qr?`<a class="tour-qr" href="${esc(qr)}" target="_blank" rel="noopener" title="${esc(st.link||'Open')}"><div id="tourQR"></div><span>${esc(st.link||'Open')} ↗</span></a>`:''}</div>
    <div class="tour-nav"><button class="btn sm" id="tourBack"${i===0?' disabled':''}>‹ Back</button><span class="tour-hint">← → keys · the page stays live</span><button class="btn sm pri" id="tourNext">${i===n-1?'Finish':'Next ›'}</button></div>`;
  c.querySelector('#tourNext').onclick=()=>{ if(i===n-1) tourEnd(); else tourGo(i+1); };
  c.querySelector('#tourBack').onclick=()=>tourGo(i-1);
  c.querySelector('#tourEnd').onclick=()=>{ if(confirm('End the demo?')) tourEnd(); };
  c.querySelector('#tourChapters').onclick=()=>{ TOUR.open=!TOUR.open; tourCard(st); };
  c.querySelectorAll('[data-tch]').forEach(b=>b.onclick=()=>{ TOUR.open=false; const ci=+b.dataset.tch; tourGo(TOUR.steps.findIndex(s=>s.ci===ci)); });
  if(qr&&typeof loadQR==='function') loadQR().then(()=>{ const el=document.getElementById('tourQR'); if(!el||typeof qrcode!=='function') return; const q=qrcode(0,'M'); q.addData(qr); q.make(); el.innerHTML=q.createSvgTag({cellSize:3,margin:0,scalable:true}); },()=>{});
}
/* after every render the spotlight finds its element again (the page was rebuilt); a hub opened with ?demo=… starts the tour
   once the document is open — fresh at 1, or where it left off at go / resume */
function tourAfterRender(){ if(TOUR.on) tourPaint(false); }
function tourAuto(){
  if(TOUR.ready||!tourWanted()) return; if(typeof db==='undefined'||!db||typeof view==='undefined'||view.page==='pick'||!document.getElementById('main')) return;
  TOUR.ready=true; const mode=tourMode(); let at=0;
  if(mode!=='1'){ try{ const s=JSON.parse(localStorage.getItem(TOUR_KEY())||'null'); if(s&&Date.now()-s.at<6*3600*1000) at=s.i; }catch(_){} }
  else { try{ localStorage.removeItem(TOUR_KEY()); }catch(_){} }
  setTimeout(()=>tourStart(at),400);
}
if(tourWanted()) setInterval(tourAuto,500);
