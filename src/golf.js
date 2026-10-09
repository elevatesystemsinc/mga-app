/* =====================================================================
   MGA Hub — Golf: courses, live-scoring events, groups with custom IDs,
   share link for the public scoring page, and live leaderboards.
   Event setup lives in the hub's data; when an event is saved it's published
   to golf_events (public info + group IDs). Scores live in golf_scores.
   ===================================================================== */
I.golf=svg('<path d="M12 21V3l7 3.5-7 3.5"/><ellipse cx="12" cy="21" rx="6" ry="1.5"/>');
NAV.splice(2,0,['golf','Golf',I.golf]);
view.gtab='events'; view.geid=null; view.getab='groups'; view.gcourse='oak';

/* ---------- data ---------- */
function golfData(){
  if(!db.golf) db.golf={courses:clone(WCCC_COURSES),events:[],localScores:{}};
  const g=db.golf; g.courses=g.courses&&g.courses.length?g.courses:clone(WCCC_COURSES); g.events=g.events||[]; g.localScores=g.localScores||{};
  if((g.ratingsVersion||0)<RATINGS_VERSION){ for(const c of g.courses){ const seed=WCCC_COURSES.find(x=>x.id===c.id); if(!seed) continue;
      c.tees=seed.tees.map(st=>{ const old=c.tees.find(t=>t.name===st.name); return Object.assign({},clone(st),old&&old.yards&&!st.yards?{yards:old.yards}:{}); }); }
    g.ratingsVersion=RATINGS_VERSION; }
  for(const c of g.courses) for(const t of c.tees) if(!t.rating) t.rating={};
  for(const e of g.events){ migrateAllow(e); if(!e.scoring) e.scoring='gross'; if(!e.format) e.format='stroke'; e.flights=e.flights||{count:0,names:[]}; e.pool=e.pool||[]; }
  return g;
}
const courseById=id=>golfData().courses.find(c=>c.id===id);
/* formats + allowances per event (USGA defaults; an older single allowance carries over to its format) */
function migrateAllow(e){ if(!e.allow){ e.allow={}; if(e.allowance!=null&&e.allowance!==100&&(e.format==='stroke'||e.format==='bestball')) e.allow[e.format]=+e.allowance; }
  for(const k of Object.keys(e.allow)){ const d=USGA_ALLOW[k]; if(d!=null&&JSON.stringify(d)===JSON.stringify(e.allow[k])) delete e.allow[k]; }   // older events saved every default
  if(!e.front) e.front='scramble'; if(!e.back) e.back='shamble'; if(!e.teamSize) e.teamSize=isTeamEvent(e)?Math.max(2,...e.groups.map(g=>Math.max(0,...groupTeams(g).map(t=>t.members.length)))):1; if(!e.count) e.count=1; }
const evFormats=ev=>eventFormats(ev);
const evTeam=ev=>isTeamEvent(ev)||(ev.format==='match'&&teamSizeOf(ev)>=2);
const evPlayerFmt=ev=>playerFormatOf(ev);
const evSummary=ev=>formatSummary(ev);
const evOneBall=ev=>evFormats(ev).some(f=>FORMATS[f]&&FORMATS[f].entry==='team');   // scramble / foursomes / greensome: one score per team
const GEV=()=>golfData().events.find(e=>e.id===view.geid);
const FORMAT_GROUPS=[['Individual',['stroke','stableford','modstable','quota','parbogey','match']],['Team — everyone plays their own ball',['bestball','aggregate','shamble','teamstable']],['Team — one ball',['scramble','foursomes','greensome']],['Mixed',['split']]];
/* the game picker: the club's enabled catalog (main games only), grouped; value = catalog id */
function gameOptions(selectedId){ const gs=enabledGames().filter(g=>!g.side&&!g.tool); const groups=[...new Set(gs.map(g=>g.group))];
  return groups.map(gr=>`<optgroup label="${esc(gr)}">${gs.filter(g=>g.group===gr).map(g=>`<option value="${g.id}"${g.id===selectedId?' selected':''}>${esc(g.name)}</option>`).join('')}</optgroup>`).join(''); }
/* an event's format fields from a catalog entry + the editor's team size / balls that count */
function engineFrom(C,teamSize,count){ const e=C.engine, F=FORMATS[e.format]||FORMATS.stroke; const sizes=C.sizes||null; let ts=sizes?Math.min(Math.max(+teamSize||e.teamSize||sizes[0],sizes[0]),sizes[sizes.length-1]):(e.teamSize||1); if(e.format==='match'&&!e.teamSize&&!sizes) ts=1;
  return {game:C.id,format:e.format,teamSize:ts,count:C.count?Math.max(1,Math.min(ts-1,+count||1)):1,countPattern:e.countPattern||'',quotaBase:e.quotaBase||36,cap:e.cap||'',matchScoring:e.matchScoring||'holes',matchForm:e.matchForm||'',matchBy:e.matchBy||'holes'}; }
const EV_GAME_KEYS=['game','format','teamSize','count','countPattern','quotaBase','cap','matchScoring','matchForm','matchBy'];
const CODE_CHARS='ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
function newCode(ev){ let c; do{ c=Array.from({length:5},()=>CODE_CHARS[Math.floor(Math.random()*CODE_CHARS.length)]).join(''); }while(ev.groups.some(g=>g.code===c)); return c; }
const slugify=s=>String(s||'').toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'').slice(0,40)||'event';
function scoringLink(ev){ return SITE_BASE+'score.html?e='+encodeURIComponent(ev.slug); }
function playerIndex(p){ const own=p.index!=null&&String(p.index).trim()!==''?p.index:null; const m=p.memberId?memberById(p.memberId):null; return parseIndex(own!=null?own:(m?m.hcp:null)); }
/* the index a player plays off in an event: the tournament's partner differential cap (e.g. 10 strokes) pulls the
   higher partner's index down to the lowest partner's index + cap before the course handicap is worked out */
function effIndex(ev,p){ const raw=playerIndex(p); const t=ev&&ev.tournamentId?db.tournaments.find(x=>x.id===ev.tournamentId):null, cap=t?+t.hcpDiff||0:0;
  if(!cap||raw==null||!p.team) return {idx:raw,raw,capped:false,cap};
  const mates=evPlayers(ev).map(x=>x.p).filter(x=>x.team===p.team&&x.id!==p.id).map(playerIndex).filter(v=>v!=null); if(!mates.length) return {idx:raw,raw,capped:false,cap};
  const low=Math.min(raw,...mates), idx=raw>low+cap?Math.round((low+cap)*10)/10:raw; return {idx,raw,capped:idx!==raw,cap}; }
function playerHcp(ev,grp,p){ const c=courseById(grp.course); const e=effIndex(ev,p), idx=e.idx; const ch=c?courseHcp(idx,c,p.tee||ev.defaultTee||'White',p.set||'M'):null;
  return {idx,raw:e.raw,capped:e.capped,cap:e.cap,ch,ph:phFromCH(ev,ch),missing:idx==null?'index':ch==null?'rating':''}; }
/* every player in the event: in a group, or on the roster waiting for one */
function evPlayers(ev){ return ev.groups.flatMap(grp=>grp.players.map(p=>({p,grp}))).concat((ev.pool||[]).map(p=>({p,grp:null}))); }
function courseFor(ev,p,grp){ if(grp) return grp.course; const F=ev.flights||{}; return (F.courseOf&&F.courseOf[p.flight])||(F.courses&&F.courses!=='split'?F.courses:'')||ev.defaultCourse||'oak'; }
const hcpOf=(ev,p,grp)=>playerHcp(ev,{course:courseFor(ev,p,grp)},p);
function publicEvent(ev){
  const courses={}; const tt=db.tournaments.find(x=>x.id===ev.tournamentId); const ftm=new Map(tt?tt.field.map(p=>[p.memberId,'T'+(p.team||0)]):[]);
  for(const g of ev.groups){ if(!courses[g.course]){ const c=courseById(g.course); if(c) courses[g.course]={name:c.name,par:c.par,hcp:c.hcp,tees:Object.fromEntries(c.tees.map(t=>[t.name,t.yards||null]))}; } }
  return {slug:ev.slug,name:ev.name,date:ev.date,status:ev.status,club:'Walnut Creek Country Club',org:ORG_ID,courses,
    groups:ev.groups.map(g=>({id:g.id,label:g.label||'',course:g.course,startHole:+g.startHole||1,teeTime:g.teeTime||'',players:g.players.map(p=>{ const h=playerHcp(ev,g,p); return {id:p.id,name:p.name,tee:p.tee||ev.defaultTee||'White',set:p.set||'M',ch:h.ch,ph:h.ph,flight:p.flight||'',team:evTeam(ev)?(p.team||ftm.get(p.memberId)||''):''}; })})),
    format:ev.format||'stroke',front:ev.front,back:ev.back,teamSize:ev.teamSize||(isTeamEvent(ev)||ev.format==='match'&&ev.teamSize>=2?2:1),count:ev.count||1,countPattern:ev.countPattern||'',quotaBase:ev.quotaBase||36,cap:ev.cap||'',matchScoring:ev.matchScoring||'holes',matchForm:ev.matchForm||'',matchBy:ev.matchBy||'holes',game:ev.game||'',allow:Object.assign({},ev.allow||{}),scoring:ev.scoring||'gross',flights:(ev.flights&&ev.flights.names)||[],
    comps:ev.gameId&&typeof gameComps==='function'?gameComps(ev):[]};
}

/* ---------- publishing + scores ---------- */
const golfScores={}; let golfSub=null;
async function publishEvent(ev){
  if(!CLOUD||!sessionOK) return;
  const codes=Object.fromEntries(ev.groups.map(g=>[String(g.code).toUpperCase(),g.id]));
  const {error}=KEYMODE?await keyRPC('hub_key_golf_event',{p_id:ev.id,p_slug:ev.slug.toLowerCase(),p_public:publicEvent(ev),p_codes:codes})
    :await sb.from('golf_events').upsert({id:ev.id,slug:ev.slug.toLowerCase(),public:publicEvent(ev),codes,updated_at:new Date().toISOString()});
  if(error) toast(/duplicate|unique/i.test(error.message)?'That link is already used by another event — pick a different one':/relation|does not exist/i.test(error.message)?'Run golf-setup.sql in Supabase to turn on live scoring':'Couldn’t publish the event: '+error.message);
}
function golfSave(ev){ persist(); publishEvent(ev); }
/* A player who is deleted leaves the leaderboard and live scoring with them: their scores go too (board session: one
   delete; admin link: hub_key_score per hole; local mode: the local map). The caller republishes with golfSave. */
function dropPlayerScores(ev,pid){ if(!ev||!pid) return;
  if(CLOUD&&sessionOK){ const m=golfScores[ev.id]; const holes=m?Object.keys(m[pid]||{}).map(Number):Array.from({length:18},(_,i)=>i+1); if(m) delete m[pid];
    if(KEYMODE) holes.forEach(h=>keyRPC('hub_key_score',{p_event:ev.id,p_player:pid,p_hole:h,p_strokes:null}).then(()=>{},()=>{}));
    else sb.from('golf_scores').delete().eq('event_id',ev.id).eq('player_id',pid).then(r=>{ if(r&&r.error) toast('Couldn’t clear their scores: '+r.error.message); },()=>{});
  } else { const L=golfData().localScores; if(L[ev.id]) delete L[ev.id][pid]; } }
function removeEventPlayer(ev,pid){ let found=false;
  ev.groups.forEach(grp=>{ const n=grp.players.length; grp.players=grp.players.filter(x=>x.id!==pid); found=found||grp.players.length<n; });
  const n=(ev.pool||[]).length; ev.pool=(ev.pool||[]).filter(x=>x.id!==pid); found=found||ev.pool.length<n;
  if(found) dropPlayerScores(ev,pid); return found; }
function deleteEventRow(id){ return KEYMODE?keyRPC('hub_key_golf_delete',{p_id:id}):sb.from('golf_events').delete().eq('id',id); }
function scoresFor(ev){ return CLOUD&&sessionOK?(golfScores[ev.id]||{}):(golfData().localScores[ev.id]||{}); }
async function loadScores(ev){
  if(!CLOUD||!sessionOK) return;
  const {data,error}=await sb.from('golf_scores').select('player_id,hole,strokes').eq('event_id',ev.id);
  if(error) return;
  const m={}; for(const r of data||[]) (m[r.player_id]=m[r.player_id]||{})[r.hole]=r.strokes; golfScores[ev.id]=m;
  if(!golfSub){ golfSub=sb.channel('golf-scores').on('postgres_changes',{event:'*',schema:'public',table:'golf_scores'},p=>{
      const r=p.new&&p.new.event_id?p.new:p.old; if(!r||!golfScores[r.event_id]) return;
      const m2=golfScores[r.event_id]; if(p.eventType==='DELETE'){ if(m2[r.player_id]) delete m2[r.player_id][r.hole]; } else (m2[r.player_id]=m2[r.player_id]||{})[r.hole]=r.strokes;
      if(!drawerOpen()&&['golf','dash'].includes(view.page)) render(); }).subscribe(); }
  if(!drawerOpen()) render();
}
async function setScore(ev,pid,hole,strokes){
  if(CLOUD&&sessionOK){
    const q=KEYMODE?keyRPC('hub_key_score',{p_event:ev.id,p_player:pid,p_hole:hole,p_strokes:strokes||null})
      :strokes?sb.from('golf_scores').upsert({event_id:ev.id,player_id:pid,hole,strokes,updated_at:new Date().toISOString()}):sb.from('golf_scores').delete().eq('event_id',ev.id).eq('player_id',pid).eq('hole',hole);
    const {error}=await q; if(error){ toast('Couldn’t save score: '+error.message); return false; }
    const m=(golfScores[ev.id]=golfScores[ev.id]||{}); m[pid]=m[pid]||{}; if(strokes) m[pid][hole]=strokes; else delete m[pid][hole]; return true;
  }
  const L=golfData().localScores, m=(L[ev.id]=L[ev.id]||{}); m[pid]=m[pid]||{}; if(strokes) m[pid][hole]=strokes; else delete m[pid][hole]; persist(); return true;
}
/* open events on the day (yesterday → tomorrow, or undated): what the nav and dashboards call live */
const isLiveNow=e=>{ if(e.status!=='live') return false; if(!e.date) return true; const d=parseD(e.date); if(!d) return true; const now=new Date(); now.setHours(0,0,0,0); const diff=Math.round((d-now)/864e5); return diff>=-1&&diff<=1; };
const liveEvents=()=>golfData().events.filter(isLiveNow);

/* ---------- page ---------- */
function vGolf(m){
  golfData();
  if(view.geid&&GEV()) return vGolfEvent(m,GEV());
  view.geid=null;
  m.innerHTML=head('Golf','Live scoring and leaderboards for Walnut Creek’s Oak and Pecan courses.',btn('New scoring event','gNew','pri',I.plus))+
    `<div class="tabs">${[['events','Scoring events'],['courses','Courses']].map(([k,l])=>`<button class="tab${view.gtab===k?' on':''}" data-gt="${k}">${l}</button>`).join('')}</div><div id="gbody" style="display:flex;flex-direction:column;gap:20px"></div>`;
  m.querySelectorAll('[data-gt]').forEach(b=>b.onclick=()=>{ view.gtab=b.dataset.gt; render(); });
  $('gNew').onclick=()=>editEvent(null);
  (view.gtab==='courses'?gCourses:gEvents)($('gbody'));
}
function evStatusChip(e){ return e.status==='live'?'<span class="chip ok">● Live</span>':e.status==='final'?'<span class="chip navy">Final</span>':'<span class="chip">Draft</span>'; }
function gEvents(el){
  const evs=golfData().events.slice().sort((a,b)=>(b.date||'').localeCompare(a.date||''));
  const cols='grid-template-columns:minmax(0,1.6fr) 110px minmax(0,1fr) 110px 100px';
  el.innerHTML=`<div class="card" style="overflow:hidden">${evs.length?`<div class="tw"><div class="t" style="min-width:720px"><div class="tr th" style="${cols}"><span>Event</span><span>Date</span><span>Courses</span><span>Field</span><span>Status</span></div>
    ${evs.map(e=>`<div class="tr click" data-ge="${e.id}" style="${cols}"><div class="cell2"><b class="trunc" style="color:var(--navy)">${esc(e.name)}</b><small class="trunc">${esc(scoringLink(e).replace(/^https?:\/\//,''))}</small></div><span class="num">${e.date?shortDate(e.date):'—'}</span><span class="muted trunc">${[...new Set(e.groups.map(g=>courseById(g.course)?.name.replace(' Course','')))].join(' + ')||'—'}</span><span class="num">${e.groups.length} group${e.groups.length===1?'':'s'} · ${sum(e.groups,g=>g.players.length)}</span><span>${evStatusChip(e)}</span></div>`).join('')}</div></div>`
    :`<div class="empty"><b>No scoring events yet</b><span>Create one, add groups with their own group IDs, then share the link. Players open it on their phones and enter their group ID to keep score.</span><button class="btn pri" id="gNew2">${I.plus}New scoring event</button></div>`}</div>`;
  el.querySelectorAll('[data-ge]').forEach(r=>r.onclick=()=>{ view.geid=r.dataset.ge; view.getab='field'; render(); loadScores(GEV()); });
  const n2=$('gNew2'); if(n2) n2.onclick=()=>editEvent(null);
}
const shortDate=s=>{ const d=parseD(s); return d?MONTHS[d.getMonth()]+' '+d.getDate()+', '+d.getFullYear():s; };

/* Courses: scorecards */
function gCourses(el){
  const g=golfData(), c=courseById(view.gcourse)||g.courses[0];
  const nine=(arr,a,b)=>arr.slice(a,b);
  const rowH=(label,vals,cls='',tot=true)=>`<tr class="${cls}"><th scope="row">${label}</th>${nine(vals,0,9).map(v=>`<td>${v}</td>`).join('')}<td class="st">${tot?G_SUM(nine(vals,0,9)):''}</td>${nine(vals,9,18).map(v=>`<td>${v}</td>`).join('')}<td class="st">${tot?G_SUM(nine(vals,9,18)):''}</td><td class="st">${tot?G_SUM(vals):''}</td></tr>`;
  el.innerHTML=`<div class="seg">${g.courses.map(x=>`<button class="${x.id===c.id?'on':''}" data-gc="${x.id}">${esc(x.name)}</button>`).join('')}</div>
  <div class="card" style="overflow:hidden"><div class="cardhead"><div><h2 class="h2">${esc(c.name)}</h2><span class="muted">Men’s par ${G_SUM(c.par.M)} · women’s par ${G_SUM(c.par.W)} · ${c.tees.map(t=>t.name+' '+(t.yards?G_SUM(t.yards):G_SUM(t.total||[])).toLocaleString()).join(' · ')}</span></div></div>
   <div class="tw"><table class="scard num"><thead><tr><th scope="col">Hole</th>${[1,2,3,4,5,6,7,8,9].map(h=>`<th scope="col">${h}</th>`).join('')}<th scope="col" class="st">Out</th>${[10,11,12,13,14,15,16,17,18].map(h=>`<th scope="col">${h}</th>`).join('')}<th scope="col" class="st">In</th><th scope="col" class="st">Tot</th></tr></thead><tbody>
   ${c.tees.map(t=>t.yards?rowH(t.name,t.yards,'tee tee-'+t.name.toLowerCase().replace('/','-')):`<tr class="tee"><th scope="row">${esc(t.name)}</th>${'<td class="muted">·</td>'.repeat(9)}<td class="st">${t.total?t.total[0]:''}</td>${'<td class="muted">·</td>'.repeat(9)}<td class="st">${t.total?t.total[1]:''}</td><td class="st">${t.total?G_SUM(t.total):''}</td></tr>`).join('')}
   ${rowH('Par',c.par.M,'par')}${rowH('Men’s hcp',c.hcp.M,'hcp',false)}${rowH('Women’s par',c.par.W,'par2')}${rowH('Women’s hcp',c.hcp.W,'hcp',false)}
   </tbody></table></div></div>
   <p class="hint">Transcribed from the club’s printed scorecards. Oak White/Red hole yardages aren’t printed, so only its nine totals show.</p>
  <div class="card" style="overflow:hidden"><div class="cardhead"><div><h2 class="h2">Course rating &amp; slope</h2><span class="muted">From the club’s printed rating card. Used for course handicaps and flights.</span></div><button class="btn sm pri" id="crSave">Save ratings</button></div>
   <div class="tw"><table class="scard num" style="min-width:560px"><thead><tr><th scope="col">Tee</th><th scope="col">Men · rating</th><th scope="col">Men · slope</th><th scope="col">Women · rating</th><th scope="col">Women · slope</th></tr></thead><tbody>
   ${c.tees.map((t,ti)=>`<tr class="tee tee-${t.name.toLowerCase()}"><th scope="row">${esc(t.name)}</th>${['M','W'].map(s=>`<td><input class="inp r" style="height:34px;width:84px" inputmode="decimal" data-cr="${ti}|${s}|cr" value="${(t.rating&&t.rating[s]&&t.rating[s].cr)||''}" aria-label="${t.name} ${s==='M'?'men':'women'} course rating"></td><td><input class="inp r" style="height:34px;width:70px" inputmode="numeric" data-cr="${ti}|${s}|slope" value="${(t.rating&&t.rating[s]&&t.rating[s].slope)||''}" aria-label="${t.name} ${s==='M'?'men':'women'} slope"></td>`).join('')}</tr>`).join('')}
   </tbody></table></div></div>
`;
  $('crSave').onclick=()=>{ let bad=0; el.querySelectorAll('[data-cr]').forEach(i=>{ const [ti,s,k]=i.dataset.cr.split('|'); const t=c.tees[+ti]; t.rating=t.rating||{}; t.rating[s]=t.rating[s]||{};
      const v=i.value.trim(); if(!v){ delete t.rating[s][k]; return; } const n=parseFloat(v); if(!isFinite(n)||(k==='slope'&&(n<55||n>155))||(k==='cr'&&(n<50||n>85))){ bad++; return; } t.rating[s][k]=n; });
    if(bad){ toast(bad+' value'+(bad>1?'s look':' looks')+' off — slope is 55–155, rating 50–85'); return; }
    persist(); golfData().events.forEach(e=>{ if(e.groups.some(gr=>gr.course===c.id)) publishEvent(e); }); toast('Ratings saved'); render(); };
  el.querySelectorAll('[data-gc]').forEach(b=>b.onclick=()=>{ view.gcourse=b.dataset.gc; render(); });
}

/* Event editor */
function editEvent(ev){
  const g=golfData(), ts=seasonTournaments(Y());
  openDrawer({kicker:'Golf · Scoring event',title:ev?'Event details':'New scoring event',saveLabel:ev?'Save':'Create event',
    body:field('Name','geN',ev?.name||'',{ph:'e.g. Member-Member · Saturday'})+pair(field('Date','geD',ev?.date||'',{type:'date'}),field('Default tee','geT',ev?.defaultTee||'White',{type:'select',options:['Gold','Blue','White','Red','Green']}))+
      `<div class="fld"><span class="lbl">Game</span><select class="inp" id="geF">${gameOptions(ev?(ev.game||catalogOf(ev).id):'stroke')}</select></div>
       <div id="geTeamRow" style="display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px">${field('Team size','geTS',ev?.teamSize||2,{type:'select',options:[2,3,4,5,6].map(n=>[n,n+' players'])})}${field('Balls that count','geCnt',ev?.count||1,{type:'select',options:[1,2,3,4,5].map(n=>[n,'Best '+n])})}</div>
       <div id="geSplit" style="display:${(ev?.format)==='split'?'grid':'none'};grid-template-columns:repeat(2,minmax(0,1fr));gap:12px">${field('Front nine (1–9)','geFr',ev?.front||'scramble',{type:'select',options:TEAM_FORMATS.map(f=>[f,FORMAT_LABEL[f]])})}${field('Back nine (10–18)','geBk',ev?.back||'shamble',{type:'select',options:TEAM_FORMATS.map(f=>[f,FORMAT_LABEL[f]])})}</div>
       <p class="hint" id="geFmtHint"></p>`+
      field('Leaderboard ranks by','geSc',ev?.scoring||'gross',{type:'select',options:[['gross','Gross'],['net','Net']]})+
      `<div class="fld"><div style="display:flex;justify-content:space-between;align-items:center"><span class="lbl">Handicap allowances</span><button class="btn sm" type="button" id="geUsga">Reset to defaults</button></div><div class="mini" id="geAllow"></div><p class="hint">Defaults follow the USGA Rules of Handicapping (Appendix C); where the USGA publishes none (5- and 6-player scrambles, 3-player best ball, shamble, quota) a common club setting is used. See docs/formats.md for every format’s math.</p></div>`+
      field('Custom link','geS',ev?.slug||'',{ph:'e.g. mm2026-sat',hint:'Players open <b>…/score.html?e=</b><i>this</i>. Letters, numbers and dashes.'})+
      field('Tournament (optional)','geTour',ev?.tournamentId||'',{type:'select',options:[['','— Not linked —']].concat(ts.map(t=>[t.id,t.name+' · '+dateRange(t)])),hint:'Linking lets you build groups straight from that tournament’s field.'}),
    wire:r=>{ const n=r.querySelector('#geN'), s=r.querySelector('#geS'); let touched=!!ev; s.oninput=()=>touched=true; n.oninput=()=>{ if(!touched) s.value=slugify(n.value); };
      const A=clone(ev?.allow||{});   // overrides only; anything not set falls back to the default for its key
      const cur=()=>{ const C=catalogById(r.querySelector('#geF').value)||catalogById('stroke'); return Object.assign(engineFrom(C,+r.querySelector('#geTS').value,+r.querySelector('#geCnt').value),{C,front:r.querySelector('#geFr').value,back:r.querySelector('#geBk').value,allow:A}); };
      const drawAllow=()=>{ const P=cur(), C=P.C, F=FORMATS[P.format]||FORMATS.stroke, sizes=C.sizes||null, team=!!sizes||P.format==='split'; const fixed=C.engine.teamSize||F.size;
        r.querySelector('#geTeamRow').style.display=team?'grid':'none'; const tsSel=r.querySelector('#geTS'); tsSel.disabled=!!fixed||(sizes&&sizes.length===1); [...tsSel.options].forEach(o=>{ o.hidden=sizes?!sizes.includes(+o.value):false; }); if(fixed) tsSel.value=fixed; else if(sizes&&!sizes.includes(+tsSel.value)) tsSel.value=sizes[0];
        const ts=fixed||+tsSel.value; r.querySelector('#geCnt').parentElement.style.display=C.count?'':'none';
        [...r.querySelector('#geCnt').options].forEach(o=>{ o.disabled=+o.value>=ts; }); if(+r.querySelector('#geCnt').value>=ts) r.querySelector('#geCnt').value=1;
        const P2=cur(); const rows=[]; const fs=[...new Set(eventFormats(P2))];
        fs.forEach(f=>{ const key=allowKey(P2,f), v=pctFor(P2,key), usga=USGA_ALLOW[key]!=null&&!/^(scramble[56]|bestball[12]of3|shamble|teamstable|quota|match)$/.test(key.replace(/\dof\d$/,'')) , custom=A[key]!=null;
          const label=`${f==='match'?(teamSizeOf(P2)>=2?'Four-ball match play':'Singles match play'):FORMAT_LABEL[f]}${/of/.test(key)?' · '+key.replace(/^\D+/,'best ').replace('of',' of '):f==='scramble'?' · '+teamSizeOf(P2)+' players (low → high)':''} <span class="muted">${custom?'(set for this event)':usga?'(USGA)':'(club default)'}</span>`;
          if(Array.isArray(v)) rows.push(`<div class="mr num" style="grid-template-columns:minmax(0,1fr) auto"><span>${label}</span><span style="display:flex;gap:6px;flex-wrap:wrap">${v.map((x,i)=>`<input class="inp r" style="width:52px;height:32px" data-al="${key}|${i}" value="${x}" inputmode="decimal" aria-label="${key} ${i+1} %">`).join('')}<span class="muted" style="align-self:center">%</span></span></div>`);
          else rows.push(`<div class="mr num" style="grid-template-columns:minmax(0,1fr) auto"><span>${label}</span><span style="display:flex;gap:6px"><input class="inp r" style="width:64px;height:32px" data-al="${key}" value="${v}" inputmode="decimal" aria-label="${key} allowance %"><span class="muted" style="align-self:center">%</span></span></div>`); });
        r.querySelector('#geAllow').innerHTML=rows.join('');
        r.querySelectorAll('[data-al]').forEach(inp=>inp.oninput=()=>{ const [k,i]=inp.dataset.al.split('|'); const v=parseFloat(inp.value); if(!isFinite(v)) return; if(i!=null){ if(!Array.isArray(A[k])) A[k]=clone(pctFor(P2,k)); A[k][+i]=v; } else A[k]=v; });
        r.querySelector('#geSplit').style.display=P.format==='split'?'grid':'none';
        const hints={scramble:'One team score per hole; the team plays off a handicap built from everyone’s course handicaps.',foursomes:'Partners alternate shots on one ball; team handicap is 50% of the combined course handicaps.',greensome:'Both drive, pick one, then alternate; team handicap 60% of the low course handicap + 40% of the high.',bestball:'Everyone plays their own ball; the best balls that count are added each hole.',shamble:'Team drive, then own ball in; the best balls that count are added each hole.',aggregate:'Every player’s net score counts each hole.',teamstable:'Each player’s Stableford points; the best that count are added each hole.',stableford:'Points per hole: albatross 5, eagle 4, birdie 3, par 2, bogey 1.',modstable:'Points per hole: albatross 8, eagle 5, birdie 2, par 0, bogey −1, double or worse −3.',quota:'Gross points (eagle 8, birdie 4, par 2, bogey 1) against a quota of 36 − playing handicap.',parbogey:'Each hole won, halved or lost against net par.',match:'The two sides in a group play hole by hole; everyone plays off the lowest handicap in the match.',stroke:''};
        r.querySelector('#geFmtHint').textContent=P.format==='split'?(hints[P.front]||'')+' Back: '+(hints[P.back]||''):(C.desc||hints[P.format]||''); };
      ['#geF','#geFr','#geBk','#geTS','#geCnt'].forEach(id=>{ r.querySelector(id).onchange=drawAllow; });
      r.querySelector('#geUsga').onclick=()=>{ Object.keys(A).forEach(k=>delete A[k]); drawAllow(); toast('Default allowances restored'); };
      r._allow=A; drawAllow(); },
    save:()=>{ const name=fv('geN'); if(!name){ toast('Name the event'); return false; }
      const slug=slugify(fv('geS')||name);
      if(g.events.some(e=>e!==ev&&e.slug===slug)){ toast('Another event already uses that link'); return false; }
      const C=catalogById(fv('geF'))||catalogById('stroke'), E=engineFrom(C,+fv('geTS'),+fv('geCnt')); if(E.format==='split'&&fv('geFr')===fv('geBk')){ toast('Front and back use the same format — pick it as the game instead'); return false; }
      if(E.format==='split') E.teamSize=+fv('geTS')||2;
      const data=Object.assign({name,date:fv('geD'),defaultTee:fv('geT'),slug,tournamentId:fv('geTour'),front:fv('geFr'),back:fv('geBk'),scoring:fv('geSc'),allow:clone($('dBody')._allow||{})},E);
      if(ev) Object.assign(ev,data); else { const e=Object.assign({id:uid(),status:'live',groups:[],pool:[],flights:{count:0,names:[]},createdAt:new Date().toISOString()},data); g.events.push(e); view.geid=e.id; view.getab='field'; ev=e; }
      golfSave(ev); toast('Saved'); return undefined; },
    del:ev?()=>{ const game=ev.gameId&&typeof gamesData==='function'?gamesData().find(x=>x.id===ev.gameId):null, tt=ev.tournamentId?db.tournaments.find(x=>x.id===ev.tournamentId):null, rnd=tt&&ev.roundId?(tt.rounds||[]).find(x=>x.id===ev.roundId):null;
      const what=game?`This is ${game.name||'a game'}’s scoring event — deleting it deletes the game and its money record too.`:rnd?`This is a round of ${tt.name} — deleting it removes that round from the tournament too.`:'Its groups and scores are removed.';
      if(!confirm(`Delete ${ev.name}? ${what}`)) return false;
      if(game) db.games=db.games.filter(x=>x!==game); if(rnd) tt.rounds=tt.rounds.filter(x=>x!==rnd);
      g.events=g.events.filter(x=>x!==ev); view.geid=null; if(CLOUD&&sessionOK) deleteEventRow(ev.id); }:null,delLabel:'Delete event'});
}

/* Event detail */
function vGolfEvent(m,ev){
  const pub=publicEvent(ev), lb=leaderboard(pub,scoresFor(ev)), link=scoringLink(ev);
  const t=db.tournaments.find(x=>x.id===ev.tournamentId);
  m.innerHTML=`<div class="crumb"><button id="gBack">Golf</button><span class="muted">/</span><span class="muted">${esc(ev.name)}</span></div>
  <div class="phead"><div><h1 class="h1">${esc(ev.name)}</h1><div style="display:flex;gap:8px;margin-top:12px;flex-wrap:wrap">${evStatusChip(ev)}<span class="chip">${ev.date?shortDate(ev.date):'Date TBD'}</span><span class="chip">${evSummary(ev)} · ${ev.scoring==='net'?'net':'gross'}</span>${ev.flights.count?`<span class="chip gold">${ev.flights.count} flights</span>`:''}<span class="chip">${evPlayers(ev).length} players · ${ev.groups.length} groups</span>${t?`<span class="chip">${esc(t.name)}</span>`:''}</div></div>
    <div class="actions">${ev.status==='live'?`<button class="btn" id="gClose">Close scoring</button>`:`<button class="btn pri" id="gOpen">${ev.status==='final'?'Reopen scoring':'Open scoring'}</button>`}<button class="btn" id="gEdit">${I.edit}Details</button></div></div>
  <div class="card pad" style="display:flex;gap:12px 20px;align-items:center;flex-wrap:wrap"><div class="cell2" style="flex:1 1 320px;min-width:0"><span class="lbl">Scoring link</span><a href="${esc(link)}" target="_blank" rel="noopener" class="trunc" style="font-weight:600;font-size:15px">${esc(link)}</a><small class="muted">${ev.status==='live'?'Open — groups can enter scores now.':ev.status==='final'?'Closed — the leaderboard is final. Scorers can still view it.':'Draft — the link shows the event but scoring is off until you open it.'}</small></div>
    <div class="actions"><button class="btn sm" id="gCopy">Copy link</button><a class="btn sm" href="${esc(link)}" target="_blank" rel="noopener">Open scoring page</a><a class="btn sm" href="${esc(link)}&view=board" target="_blank" rel="noopener">Leaderboard screen</a></div></div>
  ${!CLOUD||!sessionOK?`<div class="banner">This device isn’t signed in to the cloud, so the public scoring page can’t see this event. Scores you enter here stay on this device.</div>`:''}
  <div class="tabs">${[['field','1 · Field'],['flights','2 · Flights'],['groups','3 · Groups'],['board','Leaderboard']].map(([k,l])=>`<button class="tab${view.getab===k?' on':''}" data-get="${k}">${l}</button>`).join('')}</div><div id="gebody" style="display:flex;flex-direction:column;gap:16px"></div>`;
  $('gBack').onclick=()=>{ view.geid=null; render(); };
  $('gEdit').onclick=()=>editEvent(ev);
  const op=$('gOpen'); if(op) op.onclick=()=>{ if(!ev.groups.length){ toast('Add at least one group first'); return; } ev.status='live'; golfSave(ev); render(); toast('Scoring is open'); };
  const cl=$('gClose'); if(cl) cl.onclick=()=>{ ev.status='final'; golfSave(ev); render(); toast('Scoring closed — leaderboard is final'); };
  $('gCopy').onclick=async()=>{ try{ await navigator.clipboard.writeText(link); toast('Link copied'); }catch(_){ prompt('Copy this link:',link); } };
  m.querySelectorAll('[data-get]').forEach(b=>b.onclick=()=>{ view.getab=b.dataset.get; render(); });
  ({field:gField,board:gBoard,flights:gFlights,groups:gGroups}[view.getab]||gField)($('gebody'),ev,lb);
}
function editGroup(ev,grp){
  const g=golfData(), t=db.tournaments.find(x=>x.id===ev.tournamentId);
  const players=grp?clone(grp.players):[];
  const inOther=new Set(ev.groups.filter(x=>x!==grp).flatMap(x=>x.players.map(p=>p.memberId).filter(Boolean)));
  const fieldIds=new Set(t?t.field.map(p=>p.memberId):[]);
  const pool=members().sort((a,b)=>(fieldIds.has(b.id)-fieldIds.has(a.id))||memberName(a).localeCompare(memberName(b)));
  const opts=`<option value="">— Add a member —</option>`+(t?`<optgroup label="${esc(t.name)} field">${pool.filter(m=>fieldIds.has(m.id)).map(m=>`<option value="${m.id}">${esc(memberName(m))}${inOther.has(m.id)?' (in another group)':''}</option>`).join('')}</optgroup><optgroup label="All members">`:'')+pool.filter(m=>!t||!fieldIds.has(m.id)).map(m=>`<option value="${m.id}">${esc(memberName(m))}${inOther.has(m.id)?' (in another group)':''}</option>`).join('')+(t?'</optgroup>':'');
  const tees=c=>(courseById(c)||g.courses[0]).tees.map(x=>x.name);
  const chTxt=p=>{ const c=courseById(($('ggC')&&$('ggC').value)||grp?.course||'oak'); const idx=parseIndex(p.index!=null&&String(p.index).trim()!==''?p.index:(memberById(p.memberId)||{}).hcp); const ch=c?courseHcp(idx,c,p.tee||ev.defaultTee,p.set||'M'):null; return ch==null?(idx==null?'no index':'no rating'):'CH '+ch; };
  const rows=()=>players.map((p,i)=>`<div class="mr" style="grid-template-columns:minmax(0,1fr) 64px 84px 66px 64px 28px"><input class="inp" data-pi="${i}" data-k="name" value="${esc(p.name)}" aria-label="Player name"><input class="inp r" data-pi="${i}" data-k="index" value="${esc(p.index!=null&&p.index!==''?p.index:((memberById(p.memberId)||{}).hcp||''))}" placeholder="Index" aria-label="${esc(p.name)} handicap index" inputmode="decimal"><span class="muted" style="font-size:12px" data-ch="${i}">${chTxt(p)}</span><select class="inp" data-pi="${i}" data-k="tee" aria-label="Tee">${tees(fv('ggC')||grp?.course||'oak').map(x=>`<option${x===(p.tee||ev.defaultTee)?' selected':''}>${x}</option>`).join('')}</select><select class="inp" data-pi="${i}" data-k="set" aria-label="Par set"><option value="M"${p.set!=='W'?' selected':''}>Men</option><option value="W"${p.set==='W'?' selected':''}>Women</option></select><button class="ib" type="button" data-pdel="${i}" aria-label="Remove ${esc(p.name)}">${I.x}</button></div>`).join('')||'<div class="mr"><span class="muted">No players yet.</span></div>';
  const rowsHead='<div class="mr h" style="grid-template-columns:minmax(0,1fr) 64px 84px 66px 64px 28px"><span>Player</span><span class="r">Index</span><span>Course hcp</span><span>Tee</span><span>Par</span><span></span></div>';
  const BB=evTeam(ev), fieldTeam=new Map(t?t.field.map(p=>[p.memberId,'T'+(p.team||0)]):[]);
  const tsz=ev.format==='match'?Math.max(1,teamSizeOf(ev)):teamSizeOf(ev);
  const teamOpts=()=>{ const ks=[...new Set(players.map(p=>p.team).filter(Boolean))]; while(ks.length<Math.max(ev.format==='match'?2:1,Math.ceil(players.length/Math.max(1,tsz)))) ks.push('G'+(ks.length+1)+'-'+uid().slice(0,4)); return ks; };
  const teamLabel=(k,ks)=>'Team '+(ks.indexOf(k)+1)+(k.startsWith('T')&&t?' (field team '+k.slice(1)+')':'');
  const teamsHTML=()=>{ if(!BB) return ''; players.forEach((p,i)=>{ if(!p.team) p.team=fieldTeam.get(p.memberId)||teamOpts()[Math.floor(i/Math.max(1,tsz))]; }); const ks=teamOpts();
    return `<div class="fld"><span class="lbl">${ev.format==='match'?'Sides (first two teams play each other)':`Teams of ${tsz} · ${esc(evSummary(ev))}`}</span><div class="mini">${players.map((p,i)=>`<div class="mr" style="grid-template-columns:minmax(0,1fr) 200px"><span class="trunc">${esc(p.name||'(new player)')}</span><select class="inp" data-team="${i}" aria-label="${esc(p.name)} team">${ks.map(k=>`<option value="${esc(k)}"${k===p.team?' selected':''}>${esc(teamLabel(k,ks))}</option>`).join('')}</select></div>`).join('')||'<div class="mr"><span class="muted">Add players first.</span></div>'}</div></div>`; };
  openDrawer({kicker:ev.name+' · Group',title:grp?'Group '+grp.code:'Add group',wide:true,
    body:pair(field('Group ID','ggCode',grp?.code||newCode(ev),{hint:'What players type on the scoring page. Make it anything unique — a tee time, a cart number, or leave the random one.'}),field('Label (optional)','ggL',grp?.label||'',{ph:'e.g. 8:10 · Oak 1'}))+
      pair(field('Course','ggC',grp?.course||'oak',{type:'select',options:g.courses.map(c=>[c.id,c.name])}),field('Starting hole','ggS',grp?.startHole||1,{type:'select',options:Array.from({length:18},(_,i)=>[i+1,'Hole '+(i+1)])}))+
      field('Tee time (optional)','ggTT',grp?.teeTime||'',{type:'time',hint:'Leave blank for a shotgun start.'})+
      `<div class="fld"><span class="lbl">Players</span><div class="mini">${rowsHead}<div id="ggRows">${rows()}</div></div><p class="hint">Index comes from the member’s profile (Golf Genius import). Type over it for a guest or a one-off change.</p></div><div id="ggTeams">${teamsHTML()}
       <div style="display:grid;grid-template-columns:minmax(0,1fr) auto;gap:8px"><select class="inp" id="ggPick" aria-label="Add a member">${opts}</select><button class="btn" type="button" id="ggGuest">+ Guest</button></div></div>
      ${grp?`<div class="actions"><button class="btn" type="button" id="ggCard">View scorecard</button><button class="btn" type="button" id="ggScores">Enter or correct scores</button></div>`:''}`,
    wire:r=>{ const bind=()=>{ r.querySelectorAll('[data-pi]').forEach(e=>e.oninput=e.onchange=()=>{ const i=+e.dataset.pi; players[i][e.dataset.k]=e.value; const s=r.querySelector(`[data-ch="${i}"]`); if(s) s.textContent=chTxt(players[i]); }); r.querySelectorAll('[data-pdel]').forEach(b=>b.onclick=()=>{ players.splice(+b.dataset.pdel,1); redraw(); });
        r.querySelectorAll('[data-team]').forEach(s=>s.onchange=()=>{ players[+s.dataset.team].team=s.value; }); };
      const redraw=()=>{ r.querySelector('#ggRows').innerHTML=rows(); r.querySelector('#ggTeams').innerHTML=teamsHTML(); bind(); }; bind();
      r.querySelector('#ggPick').onchange=e=>{ const m=memberById(e.target.value); e.target.value=''; if(!m) return; if(players.some(p=>p.memberId===m.id)) return;
        players.push({id:uid(),memberId:m.id,name:memberName(m),tee:ev.defaultTee||'White',set:'M',team:fieldTeam.get(m.id)||''}); redraw(); };
      r.querySelector('#ggGuest').onclick=()=>{ players.push({id:uid(),memberId:'',name:'',tee:ev.defaultTee||'White',set:'M'}); redraw(); const ins=r.querySelectorAll('[data-k=name]'); ins[ins.length-1].focus(); };
      r.querySelector('#ggC').onchange=redraw;
      const sc=r.querySelector('#ggScores'); if(sc) sc.onclick=()=>{ closeDrawer(); scoreSheet(ev,grp); };
      const vc=r.querySelector('#ggCard'); if(vc) vc.onclick=()=>{ closeDrawer(); setTimeout(()=>viewCard(ev,grp),0); }; },
    save:()=>{ const code=fv('ggCode').toUpperCase().replace(/\s+/g,''); if(!code){ toast('Give the group an ID'); return false; }
      if(!/^[A-Z0-9-]{2,20}$/.test(code)){ toast('Group ID: 2–20 letters, numbers or dashes'); return false; }
      if(ev.groups.some(x=>x!==grp&&x.code===code)){ toast('Another group already uses '+code); return false; }
      const ps=players.filter(p=>p.name.trim()).map(p=>{ const prof=(memberById(p.memberId)||{}).hcp; const idx=String(p.index??'').trim(); return {...p,name:p.name.trim(),index:idx&&idx!==String(prof??'')?idx:''}; });
      if(!ps.length){ toast('Add at least one player'); return false; }
      const data={code,label:fv('ggL'),course:fv('ggC'),startHole:+fv('ggS')||1,teeTime:fv('ggTT'),players:ps};
      if(grp){ const keep=new Set(ps.map(p=>p.id)); grp.players.filter(p=>!keep.has(p.id)).forEach(p=>dropPlayerScores(ev,p.id)); Object.assign(grp,data); } else ev.groups.push(Object.assign({id:uid()},data));
      const inG=new Set(ps.map(p=>p.id)), inM=new Set(ps.map(p=>p.memberId).filter(Boolean)); ev.pool=(ev.pool||[]).filter(p=>!inG.has(p.id)&&!(p.memberId&&inM.has(p.memberId)));
      golfSave(ev); toast(grp?'Group saved':'Group '+code+' added'); return undefined; },
    del:grp?()=>{ ev.pool=(ev.pool||[]).concat(grp.players); ev.groups=ev.groups.filter(x=>x!==grp); golfSave(ev); toast('Group removed — its players are back on the Field'); }:null,delLabel:'Remove group'});
}
/* Board scorecard editor (corrections, or scoring from the hub) */
function scoreSheet(ev,grp){
  const pub=publicEvent(ev), c=pub.courses[grp.course], sc=scoresFor(ev), order=playOrder(grp.startHole);
  const par=p=>c.par[p.set||'M']||c.par.M;
  openDrawer({kicker:ev.name+' · Group '+grp.code,title:'Scores',saveLabel:'Save scores',
    body:`<p class="hint">${esc(c.name)} · starts on hole ${grp.startHole}. Leave a hole blank if it hasn’t been played.</p><div class="tw"><table class="scard sheet num"><thead><tr><th>Hole</th>${grp.players.map(p=>`<th>${esc(p.name.split(' ')[0])}</th>`).join('')}<th>Par</th></tr></thead><tbody>
      ${order.map(h=>`<tr><th scope="row">${h}</th>${grp.players.map(p=>`<td><input class="inp r" inputmode="numeric" data-sp="${p.id}" data-h="${h}" value="${(sc[p.id]||{})[h]||''}" aria-label="${esc(p.name)} hole ${h}"></td>`).join('')}<td class="muted">${par(grp.players[0]||{})[h-1]}</td></tr>`).join('')}
      </tbody></table></div>`,
    save:()=>{ const jobs=[];
      document.querySelectorAll('[data-sp]').forEach(i=>{ const v=parseInt(i.value,10)||0, pid=i.dataset.sp, h=+i.dataset.h, was=+((sc[pid]||{})[h]||0);
        if(v!==was&&(v===0||(v>=1&&v<=20))) jobs.push(setScore(ev,pid,h,v||null)); });
      Promise.all(jobs).then(()=>{ render(); if(jobs.length) toast(jobs.length+' score'+(jobs.length===1?'':'s')+' saved'); }); }});
}
function gBoard(el,ev){
  view.gflight=view.gflight||''; view.gsort=view.gsort||ev.scoring||'gross';
  const names=(ev.flights&&ev.flights.names)||[], net=view.gsort==='net';
  const BB=evTeam(ev), noPl=evFormats(ev).includes('scramble'); view.gview=BB?(noPl?'teams':(view.gview||'teams')):'players';
  const pubB=publicEvent(ev), unit=unitOf(pubB), MATCH=unit==='match', lb=eventBoard(pubB,scoresFor(ev),{flight:view.gflight,sort:view.gsort,view:view.gview});
  const cols='grid-template-columns:52px minmax(0,1.5fr) minmax(0,1fr) 44px 60px 60px 64px 64px 40px';
  const valCols=r=>MATCH?`<span class="r"></span><b class="r" style="font-size:14px;grid-column:span 2;white-space:nowrap">${esc(r.status)}</b>`
    :unit==='points'?`<span class="r">${r.n?r.gross:'—'}</span><b class="r" style="font-size:15px">${r.n?r.pts:'—'}</b><span></span>`
    :unit==='holes'?`<span class="r">${r.n?r.gross:'—'}</span><b class="r ${r.n&&r.holesUp>0?'pos':''}" style="font-size:15px">${r.n?(r.holesUp>0?'+':'')+r.holesUp:'—'}</b><span class="r muted">holes</span>`:null;
  const courses=[...new Set(ev.groups.map(g=>g.course))];
  el.innerHTML=`<div class="toolbar">${BB&&!noPl&&!MATCH?`<div class="seg">${[['teams','Teams'],['players','Players']].map(([k,l])=>`<button class="${view.gview===k?'on':''}" data-gvw="${k}">${l}</button>`).join('')}</div>`:''}${MATCH||unit==='points'||unit==='holes'?'':`<div class="seg">${['gross','net'].map(s=>`<button class="${view.gsort===s?'on':''}" data-gs="${s}">${s==='net'?'Net':'Gross'}</button>`).join('')}</div>`}
    ${names.length?`<div class="seg">${['',...names].map(n=>`<button class="${view.gflight===n?'on':''}" data-gf="${n}">${n?'Flight '+n:'All flights'}</button>`).join('')}</div>`:''}
    <span class="muted" style="font-size:13px">${ev.status==='final'?'Final · click any row for the scorecard':(MATCH?'Match status':unit==='points'?'Points for holes played':unit==='holes'?'Holes up or down':'To par for holes played')+(courses.length>1?' · both courses':'')+' · live · click a row for the scorecard'}</span><button class="btn sm" id="gbRef" style="margin-left:auto">${I.refresh}Refresh</button></div>
  <div class="card" style="overflow:hidden">${lb.length?`<div class="tw"><div class="t" style="min-width:860px"><div class="tr th" style="${cols}"><span>Pos</span><span>${BB&&view.gview==='teams'?'Team':'Player'}</span><span>Group</span><span class="r">Flt</span><span class="r">Thru</span>${MATCH?'<span class="r"></span><span class="r" style="grid-column:span 2">Match</span>':unit!=='strokes'?`<span class="r">Gross</span><span class="r">${unit==='points'?'Points':'Holes'}</span><span></span>`:`<span class="r">Gross</span><span class="r">${net?'Net':'To par'}</span><span class="r">${net?'Net to par':'Net'}</span>`}<span></span></div>
    ${lb.map(r=>`<div class="tr num click" data-lbg="${r.groupId}" data-lbp="${esc(r.team?(r.members||[])[0]:r.id)}" style="${cols}"><b>${r.posTxt}</b><b class="trunc">${esc(r.name)}</b><span class="trunc muted">${esc(r.group||'')} · ${esc(r.courseName.replace(' Course',''))}</span><span class="r muted">${esc(r.flight||'')}</span><span class="r">${r.n?r.thru:'—'}</span>${valCols(r)!==null?valCols(r):`<span class="r">${r.n?r.gross+' <small class="muted">('+toParTxt(r.toPar)+')</small>':'—'}</span>`+(net?`<span class="r">${r.n&&r.net!=null?r.net:'—'}</span><b class="r ${r.n&&r.netToPar<0?'pos':''}" style="font-size:15px">${r.n&&r.netToPar!=null?toParTxt(r.netToPar):'—'}</b>`:`<b class="r ${r.n&&r.toPar<0?'pos':''}" style="font-size:15px">${r.n?toParTxt(r.toPar):'—'}</b><span class="r muted">${r.n&&r.netToPar!=null?toParTxt(r.netToPar):'—'}</span>`)}<span class="ib">${I.edit}</span></div>`).join('')}</div></div>`
    :'<div class="empty"><b>No players yet</b><span>Add groups to see the leaderboard.</span></div>'}</div>`;
  $('gbRef').onclick=()=>loadScores(ev);
  el.querySelectorAll('[data-gs]').forEach(b=>b.onclick=()=>{ view.gsort=b.dataset.gs; render(); });
  el.querySelectorAll('[data-gvw]').forEach(b=>b.onclick=()=>{ view.gview=b.dataset.gvw; render(); });
  el.querySelectorAll('[data-gf]').forEach(b=>b.onclick=()=>{ view.gflight=b.dataset.gf; render(); });
  el.querySelectorAll('[data-lbg]').forEach(r=>r.onclick=()=>viewCard(ev,ev.groups.find(g=>g.id===r.dataset.lbg),r.dataset.lbp));
}
/* Leaderboard card for the dashboard + sidebar live link */
function liveBoardCard(){
  const evs=liveEvents(); if(!evs.length) return '';
  const ev=evs[0], net=ev.scoring==='net', lb=eventBoard(publicEvent(ev),scoresFor(ev),{sort:ev.scoring}).filter(r=>r.n).slice(0,8);
  if(!golfScores[ev.id]&&CLOUD&&sessionOK) setTimeout(()=>loadScores(ev),0);
  return `<div class="card pad" style="display:flex;flex-direction:column;gap:10px"><div style="display:flex;justify-content:space-between;align-items:center"><h2 class="h2">Leaderboard</h2><span class="chip ok">● Live</span></div><span class="muted" style="font-size:13px">${esc(ev.name)} · ${evTeam(ev)?evSummary(ev).toLowerCase()+', ':''}${net?'net':'gross'}</span>
    ${lb.length?lb.map(r=>`<div class="num" style="display:grid;grid-template-columns:34px minmax(0,1fr) 36px 42px;gap:8px;font-size:13.5px;align-items:center"><b>${r.posTxt}</b><span class="trunc">${esc(r.name)}</span><span class="muted r">${r.thru}</span><b class="r">${toParTxt(net&&r.netToPar!=null?r.netToPar:r.toPar)}</b></div>`).join(''):'<span class="muted">No scores yet.</span>'}
    <button class="btn sm" data-golfev="${ev.id}">Full leaderboard</button></div>`;
}
document.addEventListener('click',e=>{ const b=e.target.closest('[data-golfev]'); if(b){ view.geid=b.dataset.golfev; view.getab='board'; go('golf'); loadScores(GEV()); } });

/* ---------- Flights: evenly filled by handicap ---------- */
const FLIGHT_NAMES='ABCDEFGHIJ'.split('');
function flightUnits(ev,basis,unit,courseOf){
  const t=db.tournaments.find(x=>x.id===ev.tournamentId);
  const teamOf=new Map(t?t.field.map(p=>[p.memberId,p.team||0]):[]);
  const all=[]; for(const {p,grp} of evPlayers(ev)){ const h=playerHcp(ev,{course:(courseOf&&courseOf(p))||courseFor(ev,p,grp)},p); all.push({p,grp,h,val:basis==='index'?h.idx:h.ch}); }
  if(unit==='team'&&(t||evTeam(ev))){ const m=new Map();
    for(const x of all){ const k=x.p.team?'e'+x.p.team:teamOf.has(x.p.memberId)?'t'+teamOf.get(x.p.memberId):'p'+x.p.id; (m.get(k)||m.set(k,[]).get(k)).push(x); }
    return [...m.values()].map(ms=>({members:ms,val:ms.some(x=>x.val==null)?null:ms.reduce((a,x)=>a+x.val,0),label:ms.map(x=>x.p.name).join(' / ')})); }
  return all.map(x=>({members:[x],val:x.val,label:x.p.name}));
}
/* per = units per group (2 teams in a foursome, or 4 players). Flights are sized in whole groups so no
   group mixes flights; group counts differ by at most one, and any leftover units go to the last flight. */
function planFlights(ev,count,basis,unit,per,courseOf){
  per=Math.max(1,per||1);
  const units=flightUnits(ev,basis,unit,courseOf), missing=units.filter(u=>u.val==null);
  const ok=units.filter(u=>u.val!=null).sort((a,b)=>a.val-b.val||a.label.localeCompare(b.label));
  const n=ok.length, G=Math.floor(n/per), left=n%per, k=Math.max(1,Math.min(count,Math.max(1,G))), base=Math.floor(G/k), extra=G%k, flights=[]; let i=0;
  for(let f=0;f<k;f++){ const size=(base+(f<extra?1:0))*per+(f===k-1?left:0); flights.push({name:FLIGHT_NAMES[f],units:ok.slice(i,i+size)}); i+=size; }
  // boundary ties: same handicap on both sides of a split
  const ties=[]; for(let f=0;f<flights.length-1;f++){ const a=flights[f].units, b=flights[f+1].units; if(a.length&&b.length&&a[a.length-1].val===b[0].val) ties.push(`${flights[f].name}/${flights[f+1].name} split at ${fmtH(a[a.length-1].val,basis)}`); }
  return {flights,missing,ties};
}
/* each flight: which course, and shotgun or tee times (first time + gap, off hole 1 or 10) */
function flightPlan(ev){ const F=ev.flights||{}; F.plan=F.plan||{};
  (F.names||[]).forEach(n=>{ const p=F.plan[n]=F.plan[n]||{}; if(!p.course) p.course=(F.courseOf&&F.courseOf[n])||'oak'; if(!p.start) p.start='shotgun'; if(!p.first) p.first='08:30'; if(p.gap==null) p.gap=8; if(!p.hole) p.hole=1; });
  F.courseOf=Object.fromEntries((F.names||[]).map(n=>[n,F.plan[n].course])); return F.plan; }
const fmtTime=t=>{ const [h,m]=String(t||'').split(':').map(Number); if(!isFinite(h)) return t||''; const ap=h>=12?'PM':'AM'; return ((h%12)||12)+':'+String(m||0).padStart(2,'0')+' '+ap; };
const addMin=(t,min)=>{ const [h,m]=String(t).split(':').map(Number); const x=(h*60+(m||0)+min)%1440; return String(Math.floor(x/60)).padStart(2,'0')+':'+String(x%60).padStart(2,'0'); };
function buildFlightGroups(ev,plan,per,mode,start,startOf){
  const groups=[];
  plan.flights.forEach(f=>{ for(let i=0;i<f.units.length;i+=per){ const us=f.units.slice(i,i+per);
    groups.push({flight:f.name,units:us,sum:us.reduce((a,u)=>a+u.val,0)}); } });
  // courses: whole flights go to one course, filling Oak first up to half the groups
  const byFlight=plan.flights.map(f=>({name:f.name,n:groups.filter(x=>x.flight===f.name).length}));
  const courseOf={}; if(mode&&typeof mode==='object'){ byFlight.forEach(f=>{ courseOf[f.name]=mode[f.name]||'oak'; }); } else if(mode==='split'){ const half=groups.length/2; let acc=0; byFlight.forEach(f=>{ courseOf[f.name]=acc<half&&(acc+f.n<=half+f.n/2)?'oak':'pecan'; if(courseOf[f.name]==='oak') acc+=f.n; }); }
  else byFlight.forEach(f=>{ courseOf[f.name]=mode; });
  const out=[];
  // tee-time flights: groups off the tee in order of combined handicap
  if(startOf) for(const f of plan.flights){ const sp=startOf[f.name]; if(!sp||sp.start!=='tee') continue;
    groups.filter(x=>x.flight===f.name).sort((a,b)=>a.sum-b.sum).forEach((x,i)=>{ const cid=courseOf[f.name], tt=addMin(sp.first||'08:30',i*(+sp.gap||8));
      out.push({id:uid(),code:newCode({groups:out}),course:cid,startHole:+sp.hole||1,teeTime:tt,flight:x.flight,label:`${cid==='oak'?'Oak':'Pecan'} ${fmtTime(tt)} · Flight ${x.flight}`,
        players:x.units.flatMap(u=>u.members.map(m=>({...m.p,flight:x.flight})))}); }); }
  for(const cid of ['oak','pecan']){
    const gs=groups.filter(x=>courseOf[x.flight]===cid&&!(startOf&&startOf[x.flight]&&startOf[x.flight].start==='tee')).sort((a,b)=>a.sum-b.sum);
    const c=courseById(cid); const par5=c?c.par.M.map((p,i)=>p>=5?i+1:0).filter(Boolean):[];
    gs.forEach((x,i)=>{ let hole=1, tag='';
      const st=startOf&&startOf[x.flight]?'shotgun':start;
      if(st==='shotgun'){ if(i<18) hole=i+1; else { const j=i-18; hole=par5.length?par5[j%par5.length]:(j%18)+1; tag=' B'; } }
      out.push({id:uid(),code:newCode({groups:out}),course:cid,startHole:hole,flight:x.flight,
        label:`${cid==='oak'?'Oak':'Pecan'} ${st==='shotgun'?hole+tag:'#'+(i+1)} · Flight ${x.flight}`,
        players:x.units.flatMap(u=>u.members.map(m=>({...m.p,flight:x.flight})))}); });
  }
  out.courseOf=courseOf; return out;
}
const fmtH=(v,basis)=>v==null?'—':basis==='index'?idxTxt(Math.round(v*10)/10):(v<0?'+'+Math.abs(v):String(v));

/* ============ Step 1 · Field ============ */
function gField(el,ev){
  const t=db.tournaments.find(x=>x.id===ev.tournamentId), all=evPlayers(ev), BB=evTeam(ev);
  const teamN=new Map(); all.forEach(({p})=>{ if(p.team&&!teamN.has(p.team)) teamN.set(p.team,teamN.size+1); });
  const rows=all.slice().sort((a,b)=>(a.p.flight||'~').localeCompare(b.p.flight||'~')||((a.p.team&&teamN.get(a.p.team))||999)-((b.p.team&&teamN.get(b.p.team))||999)||a.p.name.localeCompare(b.p.name));
  const noIdx=all.filter(x=>hcpOf(ev,x.p,x.grp).idx==null).length;
  const cols='grid-template-columns:minmax(0,1.5fr) 90px 64px 56px 70px 60px 90px 40px';
  el.innerHTML=`<div class="toolbar"><div class="actions">${t?`<button class="btn pri" id="gfImp">${I.down}Import field from ${esc(t.name)}</button>`:''}<button class="btn" id="gfAdd">${I.plus}Add player</button>${all.length>=2&&enabledGames().some(g=>g.tool)?`<button class="btn" id="gfDraw">Draw partners</button>`:''}</div>
    <span class="muted" style="margin-left:auto;font-size:13px">${all.length} players${BB||t?` · ${new Set(all.map(x=>x.p.team).filter(Boolean)).size} teams`:''}${noIdx?` · <span class="neg">${noIdx} without an index</span>`:''}</span></div>
  ${!t&&!all.length?'<div class="banner">Link this event to a tournament in Details to import its field, or add players one at a time.</div>':''}
  <div class="card" style="overflow:hidden">${all.length?`<div class="tw"><div class="t" style="min-width:860px"><div class="tr th" style="${cols}"><span>Player</span><span>Team</span><span class="r">Index</span><span class="r">CH</span><span>Tee</span><span>Flight</span><span>Group</span><span></span></div>
    ${rows.map(({p,grp})=>{ const h=hcpOf(ev,p,grp); return `<div class="tr num click" data-fp="${p.id}" style="${cols}"><div class="cell2"><b class="trunc">${esc(p.name)}</b>${p.memberId?'':'<small>Guest</small>'}</div><span class="muted">${p.team?'Team '+(/^T\d+$/.test(p.team)?p.team.slice(1):teamN.get(p.team)):'—'}</span><span class="r">${h.idx==null?'<span class="neg">—</span>':idxTxt(h.idx)}${h.capped?`<small class="muted" title="Capped from ${idxTxt(h.raw)}: the tournament’s ${h.cap}-stroke partner differential rule"> ↓${idxTxt(h.raw)}</small>`:''}</span><span class="r">${fmtH(h.ch,'course')}</span><span class="muted">${esc(p.tee||ev.defaultTee)}</span><span>${p.flight?`<span class="chip gold">${esc(p.flight)}</span>`:'<span class="muted">—</span>'}</span><span class="muted">${grp?esc(grp.code):'—'}</span><span class="ib">${I.edit}</span></div>`; }).join('')}</div></div>`
    :`<div class="empty"><b>No players yet</b><span>${t?`Import the ${esc(t.name)} field — teams and handicaps come with it.`:'Add players, or link a tournament to import its field.'}</span></div>`}</div>
  ${all.length?`<div style="display:flex;justify-content:flex-end"><button class="btn" id="gfNext">Next: set flights ${I.chev}</button></div>`:''}`;
  const imp=$('gfImp'); if(imp) imp.onclick=()=>importFieldToEvent(ev,t);
  const dr=$('gfDraw'); if(dr) dr.onclick=()=>drawPartners(ev);
  $('gfAdd').onclick=()=>editFieldPlayer(ev,null);
  const nx=$('gfNext'); if(nx) nx.onclick=()=>{ view.getab='flights'; render(); };
  el.querySelectorAll('[data-fp]').forEach(r=>r.onclick=()=>editFieldPlayer(ev,all.find(x=>x.p.id===r.dataset.fp)));
}
function importFieldToEvent(ev,t){
  const inEv=new Map(evPlayers(ev).filter(x=>x.p.memberId).map(x=>[x.p.memberId,x]));
  const fieldIds=new Set(t.field.map(p=>p.memberId));
  const add=t.field.filter(p=>!inEv.has(p.memberId));
  const gone=evPlayers(ev).filter(x=>x.p.memberId&&!fieldIds.has(x.p.memberId));
  const teamChange=t.field.filter(p=>inEv.has(p.memberId)&&inEv.get(p.memberId).p.team!=='T'+(p.team||0)).length;
  openDrawer({kicker:ev.name+' · Field',title:'Import field',saveLabel:add.length||gone.length||teamChange?'Import':'Close',
    body:`<div class="grid g3" style="gap:10px">${[['In '+t.name,t.field.length],['New to this event',add.length],['Already here',t.field.length-add.length]].map(([l,v])=>`<div class="card pad kpi" style="padding:14px"><span class="lbl">${esc(l)}</span><span class="v num" style="font-size:30px">${v}</span></div>`).join('')}</div>
      <p class="hint">Players come in with their ${esc(t.name)} team and the Handicap Index on their member profile, on the ${esc(ev.defaultTee||'White')} tees (change any player afterward).${teamChange?` ${teamChange} player${teamChange===1?'’s':'s’'} team changed and will be updated.`:''}</p>
      ${gone.length?`<label class="check" style="align-items:flex-start"><input type="checkbox" id="ifRm" checked><span>Remove the ${gone.length} player${gone.length===1?'':'s'} no longer in the ${esc(t.name)} field <span class="muted">(${esc(gone.slice(0,5).map(x=>x.p.name).join(', '))}${gone.length>5?'…':''})</span></span></label>`:''}
      ${ev.flights.count&&add.length?'<div class="banner">Flights are already set. New players come in without a flight — re-run flights afterward.</div>':''}`,
    save:()=>{ if(!add.length&&!gone.length&&!teamChange) return;
      add.forEach(fp=>{ const m=memberById(fp.memberId); ev.pool.push({id:uid(),memberId:fp.memberId,name:m?memberName(m):'Player',tee:ev.defaultTee||'White',set:'M',team:'T'+(fp.team||0),index:'',flight:''}); });
      t.field.forEach(fp=>{ const x=inEv.get(fp.memberId); if(x) x.p.team='T'+(fp.team||0); });
      if(gone.length&&$('ifRm').checked){ const rm=new Set(gone.map(x=>x.p.id)); ev.pool=ev.pool.filter(p=>!rm.has(p.id)); ev.groups.forEach(grp=>{ grp.players=grp.players.filter(p=>!rm.has(p.id)); }); }
      golfSave(ev); toast(`${add.length} player${add.length===1?'':'s'} imported`); }});
}
function editFieldPlayer(ev,x){
  const p=x?x.p:{id:uid(),memberId:'',name:'',tee:ev.defaultTee||'White',set:'M',team:'',index:'',flight:''};
  const teams=[...new Set(evPlayers(ev).map(y=>y.p.team).filter(Boolean))];
  const m=p.memberId?memberById(p.memberId):null, c=courseById(courseFor(ev,p,x&&x.grp))||golfData().courses[0];
  const memOpts=[['','— Guest (not a member) —']].concat(members().sort((a,b)=>memberName(a).localeCompare(memberName(b))).map(mm=>[mm.id,memberName(mm)]));
  openDrawer({kicker:ev.name+' · Field',title:x?p.name:'Add player',
    body:(x?'':field('Member','fpM','',{type:'select',options:memOpts}))+field('Name','fpN',p.name,{ph:'Guest name'})+
      pair(field('Handicap Index','fpI',p.index||(m?m.hcp:'')||'',{hint:m?'From the member profile'+(m.hcp?' ('+esc(m.hcp)+')':'')+'. Type over it for this event only.':'Use + for plus handicaps, e.g. +1.2'}),field('Tee','fpT',p.tee||ev.defaultTee,{type:'select',options:c.tees.map(tt=>tt.name)}))+
      pair(field('Par & handicap set','fpS',p.set||'M',{type:'select',options:[['M','Men'],['W','Women']]}),field('Team','fpTm',p.team||'',{type:'select',options:[['','— No team —']].concat(teams.map((k,i)=>[k,'Team '+(i+1)+(k.startsWith('T')?' (field team '+k.slice(1)+')':'')])).concat([['__new','+ New team']])}))+
      (ev.flights.count?field('Flight','fpF',p.flight||'',{type:'select',options:[['','— None —']].concat(ev.flights.names.map(n=>[n,'Flight '+n]))}):'')+
      (x&&x.grp?`<p class="hint">In group ${esc(x.grp.code)} (${esc(x.grp.label||'')}).</p>`:''),
    wire:r=>{ const mm=r.querySelector('#fpM'); if(mm) mm.onchange=()=>{ const a=memberById(mm.value); if(a){ r.querySelector('#fpN').value=memberName(a); r.querySelector('#fpI').value=a.hcp||''; } }; },
    save:()=>{ const name=fv('fpN'); if(!name){ toast('Enter a name'); return false; }
      const mid=x?p.memberId:fv('fpM'); const prof=mid?(memberById(mid)||{}).hcp:''; const idx=fv('fpI');
      if(!x&&mid&&evPlayers(ev).some(y=>y.p.memberId===mid)){ toast('That member is already in this event'); return false; }
      let team=fv('fpTm'); if(team==='__new') team='G'+uid().slice(0,6);
      Object.assign(p,{memberId:mid,name,index:idx&&idx!==String(prof??'')?idx:'',tee:fv('fpT'),set:fv('fpS'),team});
      if(ev.flights.count) p.flight=fv('fpF');
      if(!x) ev.pool.push(p); golfSave(ev); },
    del:x?()=>{ if(x.grp) x.grp.players=x.grp.players.filter(y=>y!==p); else ev.pool=ev.pool.filter(y=>y!==p); golfSave(ev); toast(p.name+' removed from the event'); }:null,delLabel:'Remove from event'});
}

/* ---------- partner draws ----------
   Teams drawn across the event's players: at random, ABCD (one from each handicap tier), or balanced (snake by
   handicap). Before the round the groups are then built around the teams; after it, the draw is scored from the
   individual rounds (teams may span groups). Re-draw any time; the draw is remembered on the event. */
function shuffled(a){ a=a.slice(); for(let i=a.length-1;i>0;i--){ const j=secureInt(i+1); [a[i],a[j]]=[a[j],a[i]]; } return a; }
function drawTeams(players,size,method,idxOf){
  size=Math.max(2,+size||2); const n=Math.ceil(players.length/size), teams=Array.from({length:n},()=>[]);
  if(method==='random'){ shuffled(players).forEach((p,i)=>teams[i%n].push(p)); return teams; }
  const sorted=players.slice().sort((a,b)=>(idxOf(a)??99)-(idxOf(b)??99)||a.name.localeCompare(b.name));
  if(method==='abcd'){ const tiers=Array.from({length:size},(_,k)=>shuffled(sorted.slice(Math.round(k*sorted.length/size),Math.round((k+1)*sorted.length/size)))); let ti=0;
    tiers.forEach(tier=>tier.forEach((p,i)=>teams[(i+ti)%n].push(p))); return teams.map(t=>t.slice(0,size+1)); }
  // snake: 1..n then n..1, repeat
  sorted.forEach((p,i)=>{ const round=Math.floor(i/n), k=i%n; teams[round%2?n-1-k:k].push(p); }); return teams;
}
function drawPartners(ev){
  const all=evPlayers(ev).map(x=>x.p), idxOf=p=>effIndex(ev,p).idx, hasScores=Object.keys(scoresFor(ev)||{}).length>0, tools=enabledGames().filter(g=>g.tool);
  const prev=ev.draw;
  openDrawer({kicker:ev.name,title:'Draw partners',saveLabel:prev?'Re-draw':'Draw',
    body:pair(field('Team size','dpN',ev.teamSize>=2?ev.teamSize:2,{type:'select',options:[2,3,4,5,6].map(n=>[n,n+' players'])}),field('How','dpM',prev?prev.method:'random',{type:'select',options:tools.map(g=>[g.id.replace('draw',''),g.name])}))+
      `<p class="hint">${all.length} players${hasScores?' · scores are already in: this is a post-round draw and the teams will be scored from everyone’s own round':' · before the round: build the groups from the field afterwards and the teams stay together'}.</p>
       ${prev?`<p class="hint">Last drawn ${new Date(prev.at).toLocaleString()} (${esc(prev.method)}).</p>`:''}
       <div class="fld"><span class="lbl">Preview</span><div class="mini" id="dpPrev"></div></div>`,
    wire:r=>{ let teams=[]; const run=()=>{ teams=drawTeams(all,+r.querySelector('#dpN').value,r.querySelector('#dpM').value,idxOf); r.querySelector('#dpPrev').innerHTML=teams.map((t,i)=>`<div class="mr" style="grid-template-columns:70px minmax(0,1fr) 70px"><b>Team ${i+1}</b><span>${esc(t.map(p=>p.name).join(' / '))}</span><span class="r muted">${t.every(p=>idxOf(p)!=null)?idxTxt(Math.round(t.reduce((a,p)=>a+idxOf(p),0)*10)/10):'—'}</span></div>`).join(''); r._teams=teams; };
      r.querySelector('#dpN').onchange=run; r.querySelector('#dpM').onchange=run; const again=document.createElement('button'); again.type='button'; again.className='btn sm'; again.textContent='Shuffle again'; again.onclick=run; r.querySelector('#dpPrev').parentElement.appendChild(again); run(); },
    save:()=>{ const teams=$('dBody')._teams||[]; if(!teams.length) return false; const size=+fv('dpN');
      teams.forEach((t,i)=>t.forEach(p=>{ p.team='D'+(i+1); }));
      ev.draw={method:fv('dpM'),at:new Date().toISOString(),size};
      if(!(FORMATS[ev.format]||{}).team&&ev.format!=='split'){ Object.assign(ev,{game:'bestball',format:'bestball',teamSize:size,count:1}); toast(`Partners drawn — the event is now best ball (1 of ${size}); change the game in Details if you want another team format`); }
      else { ev.teamSize=size; toast('Partners drawn'); }
      golfSave(ev); return undefined; }});
}

/* ============ Step 2 · Flights ============ */
function gFlights(el,ev){
  const t=db.tournaments.find(x=>x.id===ev.tournamentId), all=evPlayers(ev);
  const teams=all.some(x=>x.p.team)||evTeam(ev);
  const F=ev.flights||{count:0,names:[]};
  if(!all.length){ el.innerHTML=`<div class="card"><div class="empty"><b>No players yet</b><span>Import or add the field first.</span><button class="btn pri" id="flToField">Go to Field</button></div></div>`; $('flToField').onclick=()=>{ view.getab='field'; render(); }; return; }
  const withH=all.map(x=>({...x,h:hcpOf(ev,x.p,x.grp)}));
  const noIdx=withH.filter(x=>x.h.idx==null), noRate=withH.filter(x=>x.h.idx!=null&&x.h.ch==null);
  const missingTees=[...new Set(noRate.map(x=>`${courseById(courseFor(ev,x.p,x.grp))?.name.replace(' Course','')} ${x.p.tee||ev.defaultTee} (${(x.p.set||'M')==='W'?'women':'men'})`))];
  const cur=F.count?F.names.map(n=>({n,ps:withH.filter(x=>x.p.flight===n)})):[];
  const val=x=>F.basis==='index'?x.h.idx:x.h.ch;
  const tF=t&&t.flights&&t.flights.count?t.flights:null;
  el.innerHTML=`${tF?`<div class="banner" style="display:flex;align-items:center;gap:12px;flex-wrap:wrap"><span style="flex:1 1 280px">This event belongs to <b>${esc(t.name)}</b>, whose flights are set once for the whole tournament (${tF.count} flights by combined index) on its Rounds &amp; results tab.</span><button class="btn sm" id="flUseT">${F.count?'Re-apply':'Use'} tournament flights</button></div>`:''}<div class="card pad" style="display:flex;flex-direction:column;gap:14px">
    <div style="display:flex;gap:16px;flex-wrap:wrap;align-items:flex-end">
      <div class="fld" style="width:130px"><label class="lbl" for="flN">Number of flights</label><input class="inp num" id="flN" inputmode="numeric" value="${F.count||''}" placeholder="e.g. 4"></div>
      <div class="fld" style="width:230px"><label class="lbl" for="flB">Fill by</label><select class="inp" id="flB"><option value="course"${F.basis!=='index'?' selected':''}>Course handicap (rating & slope)</option><option value="index"${F.basis==='index'?' selected':''}>Handicap Index</option></select></div>
      ${teams?`<div class="fld" style="width:220px"><label class="lbl" for="flU">Flight</label><select class="inp" id="flU"><option value="team"${F.unit!=='player'?' selected':''}>Teams (combined handicap)</option><option value="player"${F.unit==='player'?' selected':''}>Individual players</option></select></div>`:''}
      <div class="fld" style="width:120px"><label class="lbl" for="flG">Players per group</label><select class="inp" id="flG">${[4,3,2,5].map(n=>`<option value="${n}"${(F.groupSize||4)===n?' selected':''}>${n}</option>`).join('')}</select></div>
      <div class="fld" style="width:230px"><label class="lbl" for="flC">Courses</label><select class="inp" id="flC">${[['split','Split flights between Oak and Pecan'],['oak','All on Oak'],['pecan','All on Pecan']].map(([v,l])=>`<option value="${v}"${(F.courses||'split')===v?' selected':''}>${l}</option>`).join('')}</select></div>
      <button class="btn pri" id="flGo">${F.count?'Re-flight':'Set flights'}</button>${F.count?`<button class="btn" id="flClear">Remove flights</button>`:''}
    </div>
    <p class="hint" style="margin:0">Lowest handicaps go to Flight A. Flights are sized in whole groups${teams?' — an even number of teams, two per foursome':''} — so groups never mix flights; group counts differ by at most one. Each flight is placed on one course, and everyone is rated on the course they’ll play. Course handicap = Index × Slope ÷ 113 + (Course Rating − Par), with the event’s handicap allowances for net.</p>
    ${noIdx.length?`<div class="banner">${noIdx.length} player${noIdx.length===1?' has':'s have'} no Handicap Index: ${esc(noIdx.slice(0,8).map(x=>x.p.name).join(', '))}${noIdx.length>8?'…':''}. Add it on the Field tab, or they won’t be flighted.</div>`:''}
    ${noRate.length&&F.basis!=='index'?`<div class="banner">No course rating/slope for ${esc(missingTees.join(', '))}. Enter it on Golf → Courses, or fill by Handicap Index.</div>`:''}
  </div>
  ${cur.length?`${(()=>{ const P=flightPlan(ev); const byC={}; F.names.forEach(n=>{ const p=P[n]; (byC[p.course]=byC[p.course]||[]).push(p.start); });
      const clash=Object.entries(byC).filter(([,s])=>s.includes('tee')&&s.includes('shotgun')).map(([c])=>courseById(c).name);
      return `<div class="card" style="overflow:hidden"><div class="cardhead"><div><h2 class="h2">Course &amp; start by flight</h2><span class="muted">Pick where each flight plays and how it starts. Changes apply when you build groups.</span></div></div>
      <div class="tw"><div class="t" style="min-width:760px"><div class="tr th" style="grid-template-columns:84px 150px 150px 140px 90px 80px minmax(0,1fr)"><span>Flight</span><span>Course</span><span>Start</span><span>First tee time</span><span>Gap (min)</span><span>Off hole</span><span></span></div>
      ${F.names.map(n=>{ const p=P[n], ng=Math.ceil(withH.filter(x=>x.p.flight===n).length/(F.groupSize||4)), tee=p.start==='tee';
        return `<div class="tr num" style="grid-template-columns:84px 150px 150px 140px 90px 80px minmax(0,1fr)"><b>Flight ${n}</b>
          <select class="inp" data-fp="${n}|course" aria-label="Flight ${n} course">${golfData().courses.map(c=>`<option value="${c.id}"${c.id===p.course?' selected':''}>${esc(c.name)}</option>`).join('')}</select>
          <select class="inp" data-fp="${n}|start" aria-label="Flight ${n} start"><option value="shotgun"${!tee?' selected':''}>Shotgun</option><option value="tee"${tee?' selected':''}>Tee times</option></select>
          <input class="inp num" type="time" data-fp="${n}|first" value="${esc(p.first)}" aria-label="Flight ${n} first tee time"${tee?'':' disabled'}>
          <input class="inp num r" data-fp="${n}|gap" value="${esc(p.gap)}" inputmode="numeric" aria-label="Flight ${n} minutes between groups"${tee?'':' disabled'}>
          <select class="inp" data-fp="${n}|hole" aria-label="Flight ${n} starting hole"${tee?'':' disabled'}><option value="1"${+p.hole!==10?' selected':''}>1</option><option value="10"${+p.hole===10?' selected':''}>10</option></select>
          <span class="muted" style="font-size:12.5px">${tee?`${ng} groups · ${fmtTime(p.first)}–${fmtTime(addMin(p.first,Math.max(0,ng-1)*(+p.gap||8)))}`:`${ng} groups on holes by combined handicap`}</span></div>`; }).join('')}</div></div>
      ${clash.length?`<div class="banner" style="margin:12px 22px 18px">${esc(clash.join(' and '))} has both a shotgun and tee times — make sure the tee times go off after the shotgun groups clear the first tee.</div>`:''}</div>`; })()}`:''}
  ${cur.length?`<div class="grid ${cur.length>=4?'g4':cur.length===3?'g3':'g2'}">${cur.map(f=>{ const vs=f.ps.map(val).filter(v=>v!=null).sort((a,b)=>a-b); const cs=[...new Set(f.ps.map(x=>courseFor(ev,x.p,x.grp)))];
    return `<div class="card" style="overflow:hidden"><div class="cardhead" style="padding-bottom:10px"><div><h2 class="h2">Flight ${f.n}</h2><span class="muted">${f.ps.length} players${teams?' · '+new Set(f.ps.map(x=>x.p.team||x.p.id)).size+' teams':''}${vs.length?` · ${F.basis==='index'?'Index':'CH'} ${fmtH(vs[0],F.basis)}–${fmtH(vs[vs.length-1],F.basis)}`:''} · ${cs.map(c=>courseById(c)?.name.replace(' Course','')).join(' + ')}</span></div></div>
      ${f.ps.sort((a,b)=>(val(a)??99)-(val(b)??99)).map(x=>`<div class="tr num" style="grid-template-columns:minmax(0,1fr) 44px 58px;min-height:40px;font-size:13px"><span class="trunc">${esc(x.p.name)}</span><span class="r muted">${fmtH(val(x),F.basis)}</span><select class="inp" data-mv="${x.p.id}" aria-label="Move ${esc(x.p.name)}" style="height:30px;padding:0 4px;font-size:12px">${F.names.map(n=>`<option${n===f.n?' selected':''}>${n}</option>`).join('')}</select></div>`).join('')}</div>`; }).join('')}</div>
   ${withH.some(x=>!x.p.flight)?`<p class="hint">${withH.filter(x=>!x.p.flight).length} players aren’t in a flight (no handicap). Add their index and re-flight.</p>`:''}
   <div style="display:flex;justify-content:flex-end"><button class="btn pri" id="flNext">Next: build groups from flights ${I.chev}</button></div>`:''}`;
  const useT=$('flUseT'); if(useT) useT.onclick=()=>{ applyFlights(t,ev); golfSave(ev); render(); toast('Tournament flights applied to this event'); };
  $('flGo').onclick=()=>{ const n=parseInt(fv('flN'),10); if(!(n>=1&&n<=10)){ toast('Enter 1–10 flights'); return; }
    const basis=fv('flB'), unit=teams?fv('flU'):'player', gsize=+fv('flG')||4, cmode=fv('flC');
    const us0=flightUnits(ev,basis,unit), sz={}; us0.forEach(u=>sz[u.members.length]=(sz[u.members.length]||0)+1); const tsz=+Object.entries(sz).sort((a,b)=>b[1]-a[1])[0]?.[0]||1;
    const per=Math.max(1,Math.round(gsize/tsz));
    let plan=planFlights(ev,n,basis,unit,per,p=>cmode==='split'?'':cmode), groups=buildFlightGroups(ev,plan,per,cmode,'shotgun');
    if(basis==='course'){ for(let pass=0;pass<3;pass++){ const cmap=new Map(groups.flatMap(x=>x.players.map(p=>[p.id,x.course])));
      const next=planFlights(ev,n,basis,unit,per,p=>cmap.get(p.id)); const ng=buildFlightGroups(ev,next,per,cmode,'shotgun');
      const same=ng.every(x=>x.players.every(p=>cmap.get(p.id)===x.course)); plan=next; groups=ng; if(same) break; } }
    const courseOf=groups.courseOf;
    const flat=plan.flights.map(f=>`<div class="mr num" style="grid-template-columns:70px minmax(0,1fr) 110px"><b>Flight ${f.name}</b><div class="cell2"><span>${f.units.length} ${unit==='team'?'teams':'players'} · ${f.units.reduce((a,u)=>a+u.members.length,0)} players</span><small>${Math.ceil(f.units.length/per)} group${Math.ceil(f.units.length/per)===1?'':'s'} · ${courseById(courseOf[f.name])?.name||''}</small></div><span class="r muted">${fmtH(f.units[0]?.val,basis)} – ${fmtH(f.units[f.units.length-1]?.val,basis)}</span></div>`).join('');
    openDrawer({kicker:ev.name+' · Flights',title:`${plan.flights.length} flights`,saveLabel:'Set flights',
      body:`<p style="margin:0">Filled by ${basis==='index'?'Handicap Index':'course handicap'}${unit==='team'?', teams kept together (combined handicap)':''}, lowest in Flight A.</p><div class="mini">${flat}</div>
        ${plan.ties.length?`<div class="banner">Tied handicaps sit on both sides of a split: ${esc(plan.ties.join('; '))}. Broken alphabetically — move anyone by hand after.</div>`:''}
        ${plan.missing.length?`<div class="banner">${plan.missing.length} ${unit==='team'?'team':'player'}${plan.missing.length===1?'':'s'} without a handicap won’t be flighted: ${esc(plan.missing.slice(0,6).map(u=>u.label).join(', '))}${plan.missing.length>6?'…':''}.</div>`:''}
        ${ev.groups.length?'<p class="hint">Flights don’t move anyone between groups — build groups from flights on the next step.</p>':''}`,
      save:()=>{ evPlayers(ev).forEach(({p})=>{ p.flight=''; }); plan.flights.forEach(f=>f.units.forEach(u=>u.members.forEach(x=>{ x.p.flight=f.name; })));
        const old=(ev.flights&&ev.flights.plan)||{};
        ev.flights={count:plan.flights.length,names:plan.flights.map(f=>f.name),basis,unit,groupSize:gsize,perGroup:per,courses:cmode,courseOf,at:new Date().toISOString(),
          plan:Object.fromEntries(plan.flights.map(f=>[f.name,Object.assign({start:'shotgun',first:'08:30',gap:8,hole:1},old[f.name]||{},{course:courseOf[f.name]})]))};
        if(ev.scoring!=='net'&&confirm('Rank the leaderboard by net score? (Flighted events usually do.)')) ev.scoring='net';
        golfSave(ev); toast(`${plan.flights.length} flights set`); }}); };
  const clr=$('flClear'); if(clr) clr.onclick=()=>{ if(!confirm('Remove all flights?')) return; evPlayers(ev).forEach(({p})=>{ p.flight=''; }); ev.flights={count:0,names:[]}; golfSave(ev); render(); };
  const nx=$('flNext'); if(nx) nx.onclick=()=>{ view.getab='groups'; render(); buildGroupsFromFlights(ev); };
  el.querySelectorAll('[data-fp]').forEach(inp=>inp.onchange=()=>{ const [n,k]=inp.dataset.fp.split('|'); const P=flightPlan(ev);
    let v=inp.value; if(k==='gap'){ v=Math.max(1,Math.min(30,parseInt(v,10)||8)); } if(k==='hole') v=+v; P[n][k]=v; flightPlan(ev); golfSave(ev); render(); });
  el.querySelectorAll('[data-mv]').forEach(s=>s.onchange=()=>{ const x=all.find(y=>y.p.id===s.dataset.mv); const mates=F.unit==='team'&&x.p.team?all.filter(y=>y.p.team===x.p.team):[x];
    mates.forEach(y=>{ y.p.flight=s.value; }); golfSave(ev); render(); if(mates.length>1) toast(mates.map(y=>y.p.name).join(' & ')+' moved to Flight '+s.value); });
}

/* ============ Step 3 · Groups ============ */
function gGroups(el,ev){
  const cols='grid-template-columns:100px minmax(0,1.1fr) 110px 70px minmax(0,2fr) 40px';
  const F=ev.flights||{}, pool=ev.pool||[];
  el.innerHTML=`<div class="toolbar"><div class="actions">${F.count?`<button class="btn pri" id="ggFl">Build groups from flights</button>`:`<button class="btn pri" id="ggFld"${evPlayers(ev).length?'':' disabled'}>Build groups from field</button>`}<button class="btn" id="ggAdd">${I.plus}Add group</button>${ev.groups.length?`<button class="btn" id="ggPrint">Print scorecards</button>`:''}</div><span class="muted" style="margin-left:auto;font-size:13px">Each group gets its own group ID. Players enter it on the scoring page.</span></div>
  ${pool.length?`<div class="banner">${pool.length} player${pool.length===1?' isn’t':'s aren’t'} in a group yet. ${F.count?'Build groups from flights':'Build groups from the field'} to place them.</div>`:''}
  <div class="card" style="overflow:hidden">${ev.groups.length?`<div class="tw"><div class="t" style="min-width:820px"><div class="tr th" style="${cols}"><span>Group ID</span><span>Group</span><span>Course</span><span>Starts</span><span>Players</span><span></span></div>
   ${ev.groups.slice().sort((a,b)=>(a.teeTime?1:0)-(b.teeTime?1:0)||a.course.localeCompare(b.course)||(a.teeTime||'').localeCompare(b.teeTime||'')||(+a.startHole-+b.startHole)).map(g=>`<div class="tr click" data-gg="${g.id}" style="${cols}"><b style="letter-spacing:.06em;color:var(--navy)">${esc(g.code)}</b>${(()=>{ const hs=g.players.map(p=>playerHcp(ev,g,p).ch); const tot=hs.every(v=>v!=null)&&hs.length?hs.reduce((a,v)=>a+v,0):null; return `<div class="cell2"><span class="trunc">${esc(g.label||'—')}</span>${tot!=null?`<small>Combined ${fmtH(tot,'course')}</small>`:''}</div>`; })()}<span class="muted">${esc(courseById(g.course)?.name||'')}</span><span class="num">${g.teeTime?fmtTime(g.teeTime):'Hole '+(+g.startHole||1)}</span><span class="trunc">${g.players.map(p=>{ const h=playerHcp(ev,g,p); return esc(p.name)+(h.ch!=null?` <span class="muted">(${fmtH(h.ch,'course')})</span>`:''); }).join(', ')||'<span class="muted">No players</span>'}</span><span class="ib">${I.edit}</span></div>`).join('')}</div></div>`
   :`<div class="empty"><b>No groups yet</b><span>${F.count?'Build groups from the flights — groups stay inside each flight, and starting holes follow combined handicap.':'Build groups from the field, or add them by hand.'}</span></div>`}</div>`;
  $('ggAdd').onclick=()=>editGroup(ev,null);
  const pr=$('ggPrint'); if(pr) pr.onclick=()=>printScorecards(ev);
  const a=$('ggFl'); if(a) a.onclick=()=>buildGroupsFromFlights(ev);
  const b=$('ggFld'); if(b) b.onclick=()=>buildGroupsFromField(ev);
  el.querySelectorAll('[data-gg]').forEach(r=>r.onclick=()=>editGroup(ev,ev.groups.find(g=>g.id===r.dataset.gg)));
}
function groupsConfirmNote(ev){ const hasScores=Object.keys(scoresFor(ev)||{}).length>0;
  return ev.groups.length?`<div class="banner">This replaces the ${ev.groups.length} current groups and their group IDs.${hasScores?' Scores already entered stay with each player.':''}${ev.status==='live'?' Scoring is open — re-share group IDs with players.':''}</div>`:''; }
function buildGroupsFromFlights(ev){
  const F=ev.flights; if(!F||!F.count){ toast('Set flights first'); return; }
  const basis=F.basis||'course', unit=F.unit||'player', per=F.perGroup||Math.max(1,Math.round((F.groupSize||4)/(unit==='team'?2:1)));
  const units=flightUnits(ev,basis,unit);
  const plan={flights:F.names.map(n=>({name:n,units:units.filter(u=>u.members.every(m=>m.p.flight===n)&&u.val!=null).sort((a,b)=>a.val-b.val||a.label.localeCompare(b.label))}))};
  const loose=units.filter(u=>!plan.flights.some(f=>f.units.includes(u)));
  const P=flightPlan(ev);
  const preview=start=>{ const gs=buildFlightGroups(ev,plan,per,F.courseOf||F.courses||'split',start,P);
    for(let i=0;i<loose.length;i+=per){ const us=loose.slice(i,i+per); gs.push({id:uid(),code:newCode({groups:gs}),course:ev.defaultCourse||'oak',startHole:1,label:'Not flighted',players:us.flatMap(u=>u.members.map(m=>({...m.p})))}); }
    return gs; };
  const summary=gs=>F.names.map(n=>{ const fg=gs.filter(x=>x.flight===n); const tee=P[n]&&P[n].start==='tee'; return `<div class="mr num" style="grid-template-columns:70px minmax(0,1fr)"><b>Flight ${n}</b><div class="cell2"><span>${fg.length} groups · ${courseById(fg[0]?.course)?.name||''} · ${tee?'tee times off hole '+P[n].hole:'shotgun'}</span><small>${tee?fg.map(x=>fmtTime(x.teeTime)).join(', '):'Holes '+fg.map(x=>x.startHole+(/ B /.test(x.label)?'B':'')).join(', ')}</small></div></div>`; }).join('');
  const odd=gs=>gs.filter(x=>x.players.length!==(F.groupSize||4));
  openDrawer({kicker:ev.name+' · Groups',title:'Build groups from flights',saveLabel:'Build groups',
    body:`<p style="margin:0">Groups of ${F.groupSize||4}${unit==='team'?`, ${per} teams each`:''}, formed inside each flight from lowest handicap up, on each flight’s course and start from the Flights tab. Shotgun flights get holes 1, 2, 3… by combined handicap; tee-time flights go off in the same order.</p><input type="hidden" id="bgS" value="shotgun">`+
      `<div class="mini" id="bgSum">${summary(preview('shotgun'))}</div><div id="bgOdd"></div>${groupsConfirmNote(ev)}`,
    wire:r=>{ const upd=()=>{ const gs=preview('shotgun'); r.querySelector('#bgSum').innerHTML=summary(gs); const o=odd(gs); r.querySelector('#bgOdd').innerHTML=o.length?`<div class="banner">${o.length} group${o.length>1?'s':''} won’t be full: ${esc(o.map(x=>x.players.length+' players · '+(x.flight?'Flight '+x.flight:x.label)).join('; '))}.</div>`:''; }; upd(); },
    save:()=>{ const gs=preview('shotgun'); ev.groups=gs.map(({flight,...grp})=>grp); ev.pool=[]; golfSave(ev); toast(`${ev.groups.length} groups built`); }});
}
function buildGroupsFromField(ev){
  const all=evPlayers(ev); if(!all.length){ toast('Import or add the field first'); return; }
  const units=[], seen=new Map(); all.forEach(({p})=>{ const k=p.team||('p'+p.id); if(!seen.has(k)){ seen.set(k,[]); units.push(seen.get(k)); } seen.get(k).push(p); });
  openDrawer({kicker:ev.name+' · Groups',title:'Build groups from the field',saveLabel:'Build groups',
    body:`<p style="margin:0">${all.length} players${units.some(u=>u.length>1)?` in ${units.length} teams — teams stay together`:''}. No flights are set, so groups follow field order.</p>`+
      pair(field('Players per group','bgN',Math.max(2,Math.min(6,teamSizeOf(ev)>=3?teamSizeOf(ev):4)),{type:'select',options:[[2,'2'],[3,'3'],[4,'4'],[5,'5'],[6,'6']]}),field('Courses','bgC','split',{type:'select',options:[['oak','All on Oak'],['pecan','All on Pecan'],['split','Split between Oak and Pecan']]}))+
      field('Start','bgS','shotgun',{type:'select',options:[['shotgun','Shotgun — groups spread across holes 1–18'],['one','Everyone off hole 1']]})+groupsConfirmNote(ev),
    save:()=>{ const size=+fv('bgN'), mode=fv('bgC'), start=fv('bgS'); const groups=[]; let cur=[];
      for(const u of units){ if(cur.length&&cur.length+u.length>size){ groups.push(cur); cur=[]; } cur=cur.concat(u); } if(cur.length) groups.push(cur);
      const half=Math.ceil(groups.length/2); const out=[];
      groups.forEach((ps,i)=>{ const course=mode==='split'?(i<half?'oak':'pecan'):mode; const idx=mode==='split'?(i<half?i:i-half):i;
        const startHole=start==='shotgun'?(idx%18)+1:1; const dbl=start==='shotgun'&&idx>=18?' B':'';
        out.push({id:uid(),code:newCode({groups:out}),label:`${course==='oak'?'Oak':'Pecan'} ${start==='shotgun'?startHole+dbl:'#'+(i+1)}`,course,startHole,players:ps.map(p=>({...p}))}); });
      ev.groups=out; ev.pool=[]; golfSave(ev); toast(`${ev.groups.length} groups built`); }});
}

/* ---------- scorecard viewer ---------- */
function viewCard(ev,grp,highlight){
  const pub=publicEvent(ev), pg=pub.groups.find(x=>x.id===grp.id);
  openDrawer({kicker:ev.name+' · Group '+grp.code,title:'Scorecard',wide:'x',saveLabel:'Correct scores',
    body:scorecardHTML(pub,pg,scoresFor(ev),{highlight})+`<div class="actions" style="justify-content:flex-end"><button class="btn sm" type="button" id="vcPrint">Print</button></div>`,
    wire:r=>{ r.querySelector('#vcPrint').onclick=()=>{ const html=(`<!doctype html><html><head><meta charset="utf-8"><title>${esc(ev.name)} · ${esc(grp.code)}</title><style>${WC_CSS} body{margin:24px} .wc th:first-child,.wc td:first-child{position:static} @page{size:landscape;margin:12mm}</style></head><body>${scorecardHTML(pub,pg,scoresFor(ev),{})}<script>setTimeout(()=>print(),400)<\/script></body></html>`); const w=window.open(URL.createObjectURL(new Blob([html],{type:'text/html'})),'_blank'); if(!w) toast('Allow pop-ups to print'); }; },
    save:()=>{ setTimeout(()=>scoreSheet(ev,grp),0); }});
}

/* ============ Printed tournament scorecards (one per group, QR for live scoring) ============ */
const QR_SRC=['https://cdnjs.cloudflare.com/ajax/libs/qrcode-generator/1.4.4/qrcode.min.js','https://cdn.jsdelivr.net/npm/qrcode-generator@1.4.4/qrcode.js'];
const groupLink=(ev,grp)=>scoringLink(ev)+'&g='+encodeURIComponent(grp.code);
/* the crest embedded as data so the print page never depends on loading a file */
let CREST_DATA='';
function crestSrc(){ if(CREST_DATA) return CREST_DATA; const abs=SITE_BASE+'crest.png?v=2';
  try{ const im=document.querySelector('.brand img'); if(im&&im.complete&&im.naturalWidth){ const c=document.createElement('canvas'); c.width=im.naturalWidth; c.height=im.naturalHeight; c.getContext('2d').drawImage(im,0,0); CREST_DATA=c.toDataURL('image/png'); return CREST_DATA; } }catch(_){}
  return abs; }
function printCardHTML(ev,pub,grp,teamKeyOnly){
  const pg0=pub.groups.find(x=>x.id===grp.id), c=pub.courses[grp.course]; if(!pg0||!c) return '';
  const allTeams=isTeamEvent(pub)?groupTeams(pg0):[], mine=teamKeyOnly?allTeams.find(t=>t.key===teamKeyOnly):null;
  const pg=mine?{...pg0,players:mine.members}:pg0, markers=mine?allTeams.filter(t=>t!==mine):[];
  const TEAM=isTeamEvent(pub)||isMatchEvent(pub)&&teamSizeOf(pub)>=2, net=pub.scoring==='net', start=+grp.startHole||1, split=pub.format==='split';
  const hc=p=>c.hcp[p.set||'M']||c.hcp.M;
  const tees=[...new Set(pg.players.map(p=>p.tee))].filter(t=>c.tees&&c.tees[t]);
  const holes=Array.from({length:18},(_,i)=>i+1), scr=h=>(FORMATS[holeFormat(pub,h)]||{}).entry==='team';
  const cells=(fn,cls='')=>holes.slice(0,9).map(h=>`<td class="${cls}${h===start?' st':''}${typeof cls==='function'?'':''}">${fn(h)}</td>`).join('')+`<td class="sum">${fn('out')}</td>`+holes.slice(9).map(h=>`<td class="${cls}${h===start?' st':''}">${fn(h)}</td>`).join('')+`<td class="sum">${fn('in')}</td><td class="sum">${fn('tot')}</td>`;
  const cellsX=fn=>holes.slice(0,9).map(h=>fn(h,h===start)).join('')+'<td class="sum"></td>'+holes.slice(9).map(h=>fn(h,h===start)).join('')+'<td class="sum"></td><td class="sum"></td>';
  const sumP=(arr,k)=>k==='out'?arr.slice(0,9).reduce((a,b)=>a+b,0):k==='in'?arr.slice(9).reduce((a,b)=>a+b,0):arr.reduce((a,b)=>a+b,0);
  const phTxt=v=>typeof v==='number'?(v<0?'+'+(-v):v):'';
  const plFmt=eventFormats(pub).find(f=>(FORMATS[f]||{}).entry==='player');
  const plPH=p=>plFmt?segPH(pub,p,plFmt):null;
  const anyW=pg.players.some(p=>p.set==='W');
  const dots=k=>k>0?'<i></i>'.repeat(Math.min(k,2)):k<0?'<i class="plus">+</i>':'';
  const pRow=p=>`<tr class="pr"><th><b>${esc(p.name)}</b><span>${esc(p.tee)}${p.flight?' · Flight '+esc(p.flight):''}</span></th>${cellsX((h,st)=>{ if(scr(h)) return `<td class="x${st?' st':''}"></td>`;
      const f=holeFormat(pub,h), ph=segPH(pub,p,f); return `<td class="${st?'st':''}">${typeof ph==='number'?dots(strokesOn(ph,hc(p)[h-1])):''}</td>`; })}<td class="sum hc">${phTxt(plPH(p))}</td><td class="sum"></td></tr>`;
  const teams=TEAM?groupTeams(pg):[];
  const oneBallFmt=eventFormats(pub).find(f=>(FORMATS[f]||{}).entry==='team');
  const tRow=(t,i)=>{ const tph=oneBallFmt?teamPH(pub,oneBallFmt,t.members):null;
    const what=split?`${FORMAT_LABEL[pub.front]} front · ${FORMAT_LABEL[pub.back]} back`:(oneBallFmt?'One team score each hole':unitOf(pub)==='points'?'Best points each hole':(net?'Lowest net score each hole':'Lowest score each hole'));
    return `<tr class="tb"><th><b>${mine?'Team':'Team '+(i+1)}</b><span>${esc(split?what:formatSummary(pub)+' · '+what)}</span></th>${cellsX((h,st)=>`<td class="${st?'st':''}">${scr(h)&&tph!=null?dots(strokesOn(tph,hc(t.captain)[h-1])):''}</td>`)}<td class="sum hc">${tph!=null?phTxt(tph):''}</td><td class="sum"></td></tr>`; };
  const fmtRow=split?`<tr class="fm"><th>Format</th><td colspan="10">${esc(FORMAT_LABEL[pub.front])}${(FORMATS[pub.front]||{}).entry==='team'?' — one team score':''}</td><td colspan="11">${esc(FORMAT_LABEL[pub.back])}${(FORMATS[pub.back]||{}).entry==='team'?' — one team score':' — everyone plays their own ball'}</td><td colspan="2"></td></tr>`:'';
  const allowTxt=eventFormats(pub).map(f=>{ const k=allowKey(pub,f), v=pctFor(pub,k); return `${FORMAT_LABEL[f].toLowerCase()} ${Array.isArray(v)?v.join('/'):v}%`; }).join(' · ');
  const startBig=grp.teeTime?fmtTime(grp.teeTime):'Hole '+start+(grp.label&&/ B /.test(grp.label)?'B':'');
  const startSub=grp.teeTime?(start!==1?'Tee time · off hole '+start:'Tee time'):'Shotgun start';
  return `<section class="pc${mine?' team':''}">
  <header><img src="${crestSrc()}" alt=""><div class="ttl"><b>${esc(pub.name)}</b><span>${esc([pub.date?new Date(pub.date+'T12:00').toLocaleDateString('en-US',{weekday:'long',month:'long',day:'numeric',year:'numeric'}):'',c.name].filter(Boolean).join(' · '))}</span><span>${esc(formatSummary(pub))} · ${net?'Net':'Gross'}${pg.players[0]&&pg.players[0].flight?' · Flight '+esc(pg.players[0].flight):''}</span></div>
    <div class="grp"><span>${esc(startSub)}</span><b class="when">${esc(startBig)}</b><em>Group ${esc(grp.code)}</em></div></header>
  ${mine?`<div class="who"><div><span>Team</span><b>${esc(mine.members.map(p=>p.name).join(' & '))}</b></div><div><span>Marker — keeps this card</span><b>${esc(markers.map(t=>t.members.map(p=>p.name).join(' & ')).join(' · ')||'—')}</b></div></div>`:''}
  <table>
    ${fmtRow}
    <tr class="hd"><th>Hole</th>${cells(h=>typeof h==='number'?h:h==='out'?'Out':h==='in'?'In':'Tot')}<td class="sum">Hcp</td><td class="sum">Net</td></tr>
    ${tees.map(t=>`<tr class="yd"><th>${esc(t)}</th>${cells(h=>typeof h==='number'?c.tees[t][h-1]:sumP(c.tees[t],h))}<td class="sum"></td><td class="sum"></td></tr>`).join('')}
    <tr class="pa"><th>Par</th>${cells(h=>typeof h==='number'?(anyW&&c.par.W[h-1]!==c.par.M[h-1]?c.par.M[h-1]+'/'+c.par.W[h-1]:c.par.M[h-1]):sumP(c.par.M,h))}<td class="sum"></td><td class="sum"></td></tr>
    <tr class="si"><th>Handicap</th>${cells(h=>typeof h==='number'?c.hcp.M[h-1]:'')}<td class="sum"></td><td class="sum"></td></tr>
    ${TEAM&&!isMatchEvent(pub)?teams.map((t,i)=>t.members.map(pRow).join('')+tRow(t,i)).join(''):pg.players.map(pRow).join('')}
    ${anyW?`<tr class="si"><th>Women’s hcp</th>${cells(h=>typeof h==='number'?c.hcp.W[h-1]:'')}<td class="sum"></td><td class="sum"></td></tr>`:''}
  </table>
  <footer><div class="notes"><span><i></i> Stroke received${pg.players.some(p=>typeof p.ph==='number'&&p.ph<0)?' · <i class="plus">+</i> stroke given back':''}${oneBallFmt?' · <b class="xk"></b> team-score hole — one score per team':''} · <b class="stk">▌</b> first hole${net?` · Allowances: ${esc(allowTxt)}`:''}</span>
      <div class="sig">${mine?mine.members.map(p=>`<span>${esc(p.name)}</span>`).join('')+'<span>Marker</span>':'<span>Scorer</span><span>Attest</span>'}</div></div>
    <div class="qr"><div class="qrc" data-qr="${esc(groupLink(ev,grp))}"></div><div><b>Live scoring</b><span>Scan with your phone camera — opens group ${esc(grp.code)} ready to score.</span></div></div></footer>
</section>`;
}

const PRINT_CSS=`
@page{size:letter portrait;margin:.3in}
*{box-sizing:border-box} body{margin:0;font-family:'Public Sans',Arial,sans-serif;color:#14222B;-webkit-print-color-adjust:exact;print-color-adjust:exact}
.sheet{display:flex;flex-direction:column}
.pc{height:4.98in;border:1.5px solid #0F2A38;border-radius:6px;overflow:hidden;display:flex;flex-direction:column;break-inside:avoid;page-break-inside:avoid;margin-bottom:.2in}
.one .pc{height:auto;min-height:7.4in} .one .pc{break-after:page;page-break-after:always;margin:0}
.two .pc:nth-of-type(2n){break-after:page;page-break-after:always}
.pc header{display:flex;align-items:center;gap:10px;background:#0F2A38;color:#fff;padding:7px 12px;border-bottom:3px solid #C7A13A}
.pc header img{width:30px;height:39px;object-fit:contain;background:#fff;border-radius:3px;padding:1px}
.pc .ttl{flex:1;min-width:0;display:flex;flex-direction:column;line-height:1.2}
.pc .ttl b{font-family:'Cormorant Garamond',Georgia,serif;font-size:20px;font-weight:700;letter-spacing:.01em}
.pc .ttl span{font-size:9.5px;color:#D8C79A}
.pc .grp{display:flex;flex-direction:column;align-items:center;background:#fff;color:#0F2A38;border-radius:4px;padding:3px 10px;min-width:112px}
.pc .grp span{font-size:8px;font-weight:700;letter-spacing:.14em;text-transform:uppercase;color:#8C6A1F}
.pc .grp b{font-size:20px;letter-spacing:.12em;line-height:1.05}
.pc .grp b.when{letter-spacing:.02em;font-size:21px}
.pc .who{display:flex;gap:18px;padding:5px 12px;border-bottom:1px solid #9AA3A8;background:#FBFAF5}
.pc .who div{display:flex;flex-direction:column;min-width:0}.pc .who span{font-size:7.5px;font-weight:700;letter-spacing:.1em;text-transform:uppercase;color:#8C6A1F}.pc .who b{font-size:11px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.pc .grp em{font-style:normal;font-size:8.5px;font-weight:600}
.pc table{border-collapse:collapse;width:100%;table-layout:fixed;font-variant-numeric:tabular-nums;flex:1}
.pc th,.pc td{border:1px solid #9AA3A8;text-align:center;font-size:9px;padding:0}
.pc th{width:1.22in;text-align:left;padding:0 5px;font-weight:600}
.pc td.sum{background:#F2EEE3;font-weight:700;width:.34in}
.pc tr.hd th,.pc tr.hd td{background:#0F2A38;color:#fff;font-weight:700;height:15px}
.pc tr.hd td.sum{background:#1F3F55}
.pc tr.yd td,.pc tr.yd th{height:13px;font-size:8px;color:#56626A}
.pc tr.pa td,.pc tr.pa th{height:14px;font-weight:700;background:#E8EDF0}
.pc tr.si td,.pc tr.si th{height:12px;font-size:7.5px;color:#56626A}
.pc tr.pr th{height:31px;line-height:1.15}
.pc.team tr.pr th,.pc.team tr.pr td{height:44px}.pc.team tr.tb th,.pc.team tr.tb td{height:34px}
.pc tr.pr th b{display:block;font-size:9.5px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.pc tr.pr th span,.pc tr.tb th span{display:block;font-size:7px;color:#56626A;font-weight:500}
.pc tr.pr td{position:relative;height:31px}
.pc tr.pr td i,.pc tr.tb td i{position:absolute;top:2px;width:4.5px;height:4.5px;border-radius:50%;background:#14222B;left:2px}
.pc tr.pr td i+i,.pc tr.tb td i+i{left:8px}
.pc tr.tb td{position:relative}
.pc tr.pr td i.plus,.pc tr.tb td i.plus{background:none;font-style:normal;font-size:8px;font-weight:800;width:auto;height:auto;top:0}
.pc tr.pr td.hc{font-size:11px}
.pc tr.tb th,.pc tr.tb td{height:24px;background:#FBF4E0}
.pc tr.tb th b{font-size:8.5px}
.pc td.st{box-shadow:inset 3px 0 0 #C7A13A}
.pc tr.hd td.st{background:#C7A13A;color:#0F2A38}
.pc tr.fm th,.pc tr.fm td{background:#F6ECCF;color:#6B4F12;font-weight:800;font-size:8.5px;height:14px;letter-spacing:.03em}
.pc td.x{background:repeating-linear-gradient(135deg,#F4F1EA 0 5px,#E4DFD3 5px 6px)}
.pc .notes .xk{display:inline-block;width:12px;height:8px;background:repeating-linear-gradient(135deg,#F4F1EA 0 3px,#E4DFD3 3px 4px);border:1px solid #9AA3A8;vertical-align:0}
.pc footer{display:flex;gap:12px;align-items:stretch;padding:6px 10px;border-top:1px solid #9AA3A8}
.pc .notes{flex:1;display:flex;flex-direction:column;justify-content:space-between;font-size:8px;color:#56626A}
.pc .notes i{display:inline-block;width:5px;height:5px;border-radius:50%;background:#14222B;vertical-align:1px}
.pc .notes i.plus{background:none;font-style:normal;font-weight:800;color:#14222B;width:auto;height:auto}
.pc .notes .stk{color:#C7A13A}
.pc .sig{display:flex;gap:18px}.pc .sig span{flex:1;border-top:1px solid #14222B;padding-top:2px;font-size:8px;margin-top:14px}
.pc .qr{display:flex;align-items:center;gap:7px;width:2.1in}
.pc .qrc{width:.78in;height:.78in;flex-shrink:0}.pc .qrc svg,.pc .qrc img{width:100%;height:100%;display:block}
.pc .qr b{display:block;font-size:9.5px;color:#0F2A38}.pc .qr span{font-size:7.5px;color:#56626A;line-height:1.25;display:block}
.one .pc th,.one .pc td{font-size:11px}.one .pc tr.pr td,.one .pc tr.pr th{height:44px}.one .pc .qrc{width:1in;height:1in}
@media screen{ body{background:#E9E4D6;padding:20px} .sheet{max-width:8.1in;margin:0 auto} .pc{background:#fff} .bar{max-width:8.1in;margin:0 auto 14px;display:flex;gap:10px;align-items:center;font:14px 'Public Sans',sans-serif} .bar button{height:38px;padding:0 16px;border-radius:8px;border:1px solid #0F2A38;background:#0F2A38;color:#fff;font-weight:700;cursor:pointer} }
@media print{ .bar{display:none} }
`;
function printScorecards(ev){
  if(!ev.groups.length){ toast('Build groups first'); return; }
  if(ev.status==='draft') toast('Tip: open scoring before the round so the QR codes work on the course');
  const flights=(ev.flights&&ev.flights.names)||[];
  openDrawer({kicker:ev.name,title:'Print scorecards',saveLabel:'Open print preview',
    body:`<p style="margin:0">Tournament cards with the event, flight, tee time or starting hole and group ID up top; each player’s playing handicap with dots on the holes they get strokes${ev.format==='bestball'?'; a blank best-ball line per team':''}; and a QR code that opens live scoring with that group already joined.</p>`+
      (evTeam(ev)?field('Cards','pcU','team',{type:'select',options:[['team','One per team — teams swap cards and keep each other’s score'],['group','One per group']],hint:'Team cards print in group order, two to a page, so each page is one group.'}):'')+
      field('Layout','pcL','two',{type:'select',options:[['two','Two cards per letter page (cart size, cut in half)'],['one','One large card per page']]})+
      (flights.length?field('Groups','pcF','',{type:'select',options:[['','All '+ev.groups.length+' groups']].concat(flights.map(f=>[f,'Flight '+f+' only']))}):'')+
      field('Order','pcO','hole',{type:'select',options:[['hole','By course and starting hole'],['flight','By flight'],['code','By group ID']]})+
      `<p class="hint">Printing uses your browser’s print dialog — choose “Save as PDF” to send it to the pro shop. The QR codes point to ${esc(scoringLink(ev).replace(/^https?:\/\//,''))}.</p>`,
    save:()=>{
      const fsel=$('pcF')?fv('pcF'):'', order=fv('pcO'), layout=fv('pcL'), pub=publicEvent(ev);
      let gs=ev.groups.filter(g=>!fsel||g.players.some(p=>p.flight===fsel));
      gs=gs.slice().sort(order==='code'?(a,b)=>a.code.localeCompare(b.code):order==='flight'?(a,b)=>((a.players[0]||{}).flight||'~').localeCompare((b.players[0]||{}).flight||'~')||(a.course+a.startHole).localeCompare(b.course+b.startHole,undefined,{numeric:true}):(a,b)=>a.course.localeCompare(b.course)||(+a.startHole-+b.startHole)||a.label.localeCompare(b.label));
      const base=SITE_BASE;
      const team=isTeamEvent(pub)&&fv('pcU')!=='group';
      const cards=gs.flatMap(g=>{ const pg=pub.groups.find(x=>x.id===g.id); return team&&pg?groupTeams(pg).map(t=>printCardHTML(ev,pub,g,t.key)):[printCardHTML(ev,pub,g)]; });
      const html=(`<!doctype html><html><head><meta charset="utf-8"><base href="${base}"><title>${esc(ev.name)} · Scorecards</title>
        <style>${PRINT_CSS}</style></head>
        <body><div class="bar"><button onclick="print()">Print</button><span id="st">Preparing ${cards.length} cards…</span></div><div class="sheet ${layout}">${cards.join('')}</div>
        <script>
        (function(){ var srcs=${JSON.stringify(QR_SRC)}, i=0;
          var fl=document.createElement('link'); fl.rel='stylesheet'; fl.href='https://fonts.googleapis.com/css2?family=Cormorant+Garamond:wght@700&family=Public+Sans:wght@400;600;700;800&display=swap'; document.head.appendChild(fl);
          function draw(){ document.querySelectorAll('[data-qr]').forEach(function(el){ var q=qrcode(0,'M'); q.addData(el.getAttribute('data-qr')); q.make(); el.innerHTML=q.createSvgTag({cellSize:4,margin:0,scalable:true}); });
            document.getElementById('st').textContent='${cards.length} cards ready'; setTimeout(function(){ print(); },500); }
          function load(){ if(i>=srcs.length){ document.getElementById('st').textContent='QR codes couldn’t load — check the connection, then reload'; return; }
            var s=document.createElement('script'); s.src=srcs[i++]; s.onload=draw; s.onerror=load; document.head.appendChild(s); }
          var go=false; function once(){ if(go) return; go=true; load(); }
          if(document.fonts&&document.fonts.ready) document.fonts.ready.then(once); setTimeout(once,1200);
        })();
        <\/script></body></html>`);
      const w=window.open(URL.createObjectURL(new Blob([html],{type:'text/html'})),'_blank'); if(!w){ toast('Allow pop-ups for this site to print'); return false; }
      return undefined; }});
}

