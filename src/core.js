/* =====================================================================
   MGA Hub — core: data model, calculations, storage + collaborative cloud save
   Data lives in ONE jsonb row: public.mga_hub (id 'main').
   ===================================================================== */
const $=id=>document.getElementById(id);
const uid=()=>(crypto.randomUUID?crypto.randomUUID():Date.now().toString(36)+Math.random().toString(36).slice(2));
const n0=v=>{const x=parseFloat(v);return isFinite(x)?x:0;};
const fmt=v=>{const x=Math.round(n0(v));return (x<0?'−$':'$')+Math.abs(x).toLocaleString('en-US');};
const fmtS=v=>{const x=Math.round(n0(v));return x>0?'+'+fmt(x):fmt(x);};
const fmt2=v=>{const x=n0(v);return (x<0?'−$':'$')+Math.abs(x).toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2});};
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const clone=o=>JSON.parse(JSON.stringify(o));
const sum=(a,f)=>(a||[]).reduce((t,x)=>t+n0(f(x)),0);
const MONTHS=['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
function parseD(s){ if(!s) return null; const m=/^(\d{4})-(\d{2})-(\d{2})$/.exec(s); return m?new Date(+m[1],+m[2]-1,+m[3]):null; }
function addDays(d,k){ const x=new Date(d); x.setDate(x.getDate()+k); return x; }
function dateRange(t){
  const d=parseD(t.startDate); if(!d) return 'Date TBD';
  const e=addDays(d,(t.days||1)-1);
  if(t.days<=1) return MONTHS[d.getMonth()]+' '+d.getDate()+', '+d.getFullYear();
  return MONTHS[d.getMonth()]+' '+d.getDate()+'–'+(e.getMonth()!==d.getMonth()?MONTHS[e.getMonth()]+' ':'')+e.getDate()+', '+e.getFullYear();
}
function dayLabel(t,i){
  const d=parseD(t.startDate); const nm=['Day 1','Day 2','Day 3'][i];
  if(!d) return nm;
  const x=addDays(d,i); return x.toLocaleDateString('en-US',{weekday:'long'})+' · '+nm;
}
function dayShort(t,i){ const d=parseD(t.startDate); if(!d) return ''; const x=addDays(d,i); return MONTHS[x.getMonth()]+' '+x.getDate(); }
function daysOut(t){ const d=parseD(t.startDate); if(!d) return null; const now=new Date(); now.setHours(0,0,0,0); return Math.round((d-now)/864e5); }

/* ---------- model ---------- */
const HUB_VERSION=1;
const DEFAULT_ROLES=['President','Vice President','Treasurer','Secretary','Tournament Chair','Member at Large','Member at Large'];
const ITEM_KINDS=['Meal','Drinks','Event','Other'];
function newSeason(){ return {dues:{amount:90,installments:2},duesPayments:[],lines:[],txns:[],bank:[],bankBatches:[],bankOpening:{amount:0,date:''}}; }
function emptyHub(){
  const y=String(new Date().getFullYear());
  return {v:HUB_VERSION,activeSeason:y,members:[],board:DEFAULT_ROLES.map(r=>({id:uid(),role:r,memberId:'',term:''})),
          seasons:{[y]:newSeason()},tournaments:[]};
}
function newTournament(o){
  const days=Math.min(3,Math.max(1,+o.days||1));
  return {id:uid(),season:o.season,name:o.name||'New tournament',startDate:o.startDate||'',days,venue:o.venue||'Walnut Creek Country Club',
    status:'Planning',budgetBasis:'planned',entryFee:n0(o.entryFee),skinsFee:n0(o.skinsFee),plannedPlayers:n0(o.plannedPlayers),teamSize:+o.teamSize||2,ggEvent:o.ggEvent||'',
    field:[],sponsors:[],tiers:[],goal:0,
    dayItems:[[],[],[]].slice(0,3),income:[],perPlayer:[],lines:[],
    actuals:{entryFees:0,skins:0,skinsPaid:0},schedule:[],decisions:[],notes:'',source:null};
}
function normalize(d){
  if(!d||typeof d!=='object') return emptyHub();
  d.v=d.v||HUB_VERSION; d.members=d.members||[]; d.board=d.board||[]; d.seasons=d.seasons||{}; d.tournaments=d.tournaments||[];
  if(!d.activeSeason) d.activeSeason=String(new Date().getFullYear());
  if(!d.seasons[d.activeSeason]) d.seasons[d.activeSeason]=newSeason();
  for(const s of Object.values(d.seasons)){ s.dues=s.dues||{amount:90,installments:2}; s.duesPayments=s.duesPayments||[]; s.lines=s.lines||[]; s.txns=s.txns||[]; s.bank=s.bank||[]; s.bankBatches=s.bankBatches||[]; s.bankOpening=s.bankOpening||{amount:0,date:''}; }
  for(const t of d.tournaments){
    t.dayItems=t.dayItems||[[],[],[]]; while(t.dayItems.length<3) t.dayItems.push([]);
    for(const k of ['field','sponsors','tiers','income','perPlayer','lines','schedule','decisions','fieldQuestions']) t[k]=t[k]||[];
    t.actuals=Object.assign({entryFees:0,skins:0,skinsPaid:0},t.actuals||{}); if(!t.budgetBasis) t.budgetBasis='planned';
    (t.dayItems||[]).forEach(d=>(d||[]).forEach(it=>{ if(it.menu) it.menu.svcPct=0; }));
    if(!d.seasons[t.season]) d.seasons[t.season]=newSeason();
  }
  return d;
}

/* ---------- calculations (single source of truth for every number on screen) ---------- */
function menuSubtotal(m){ return sum(m&&m.items,i=>n0(i.qty)*n0(i.unitCost)); }
/* catered menus use the club's all-in prices — nothing is added on top */
function menuCharge(m){ return 0; }
function menuTotal(m){ return menuSubtotal(m); }
/* Budget uses the planned player count unless the board switches it to the field (so a half-filled field doesn't sink the budget). */
function playersUsed(t){ return t.budgetBasis==='field'?t.field.length:n0(t.plannedPlayers); }
function itemQty(t,it){ return it.qtyLink==='players'?playersUsed(t):n0(it.qty); }
function itemTotal(t,it){ return it.menu?menuTotal(it.menu):itemQty(t,it)*n0(it.unitCost); }
function spPaid(s){ return sum(s.payments,p=>p.amount); }
/* ---------- ledger-driven actuals ----------
   A budget line's actual comes from the Treasury ledger once any entry is linked to it;
   until then it uses the number typed on the line. Link = {t: tournament id ('' = MGA), k: kind, id}. */
const INCOME_KINDS=new Set(['inc','entry','skins','mgaInc']);
function ledgerIndex(season){ const s=db.seasons[season], idx={}; if(!s) return idx;
  for(const x of s.txns||[]){ const L=x.link; if(!L||!L.k) continue; const key=(L.t||'')+'|'+L.k+'|'+(L.id||'');
    const signed=n0(x.amount)*((x.dir==='in')===INCOME_KINDS.has(L.k)?1:-1);
    const r=idx[key]||(idx[key]={sum:0,n:0}); r.sum+=signed; r.n++; }
  return idx; }
function linkInfo(season,tid,k,id){ return ledgerIndex(season)[(tid||'')+'|'+k+'|'+(id||'')]||null; }
function actualOf(IX,tid,k,id,manual){ const r=IX[(tid||'')+'|'+k+'|'+(id||'')]; return r?r.sum:n0(manual); }
function tcalc(t){
  const players=playersUsed(t), days=t.days||1;
  const entryFees=players*n0(t.entryFee), skins=players*n0(t.skinsFee);
  const pledged=sum(t.sponsors,s=>s.pledged), received=sum(t.sponsors,spPaid);
  const otherInc=sum(t.income,i=>i.budget);
  const revenue=entryFees+skins+pledged+otherInc;
  const dayTot=[0,1,2].map(i=>i<days?sum(t.dayItems[i],it=>itemTotal(t,it)):0);
  const IX=ledgerIndex(t.season), A=(k,id,m)=>actualOf(IX,t.id,k,id,m);
  const dayAct=[0,1,2].map(i=>i<days?sum(t.dayItems[i],it=>A('item',it.id,it.actual)):0);
  const perPlayer=sum(t.perPlayer,p=>players*n0(p.perPlayer));
  const lineTot=sum(t.lines,l=>l.budget);
  const skinsPayout=skins;
  const expenses=dayTot[0]+dayTot[1]+dayTot[2]+perPlayer+skinsPayout+lineTot;
  const a=t.actuals;
  const revenueA=A('entry','',a.entryFees)+A('skins','',a.skins)+received+sum(t.income,i=>A('inc',i.id,i.actual));
  const expensesA=dayAct[0]+dayAct[1]+dayAct[2]+sum(t.perPlayer,p=>A('pp',p.id,p.actual))+A('skinsPaid','',a.skinsPaid)+sum(t.lines,l=>A('line',l.id,l.actual));
  return {players,entryFees,skins,pledged,received,otherInc,revenue,dayTot,dayAct,perPlayer,lineTot,skinsPayout,expenses,
          net:revenue-expenses,revenueA,expensesA,netA:revenueA-expensesA};
}
/* A tournament counts as past once it's marked Complete or its last day is behind us. */
function tEnd(t){ const d=parseD(t.startDate); return d?addDays(d,(t.days||1)-1):null; }
function isPast(t){ if(t.status==='Complete') return true; const e=tEnd(t); if(!e) return false; const now=new Date(); now.setHours(0,0,0,0); return e<now; }
function seasonTournaments(y){ return db.tournaments.filter(t=>t.season===y).sort((a,b)=>(a.startDate||'9').localeCompare(b.startDate||'9')); }
function scalc(y){
  const s=db.seasons[y]||newSeason(), ts=seasonTournaments(y).map(t=>({t,c:tcalc(t)}));
  const active=db.members.filter(m=>m.status!=='Inactive').length;
  const duesBudget=active*n0(s.dues.amount), duesActual=sum(s.duesPayments,p=>p.amount);
  const incLines=s.lines.filter(l=>l.type==='Income'), expLines=s.lines.filter(l=>l.type!=='Income');
  const tRev=sum(ts,x=>x.c.revenue), tExp=sum(ts,x=>x.c.expenses), tRevA=sum(ts,x=>x.c.revenueA), tExpA=sum(ts,x=>x.c.expensesA);
  const revenue=tRev+duesBudget+sum(incLines,l=>l.budget), expenses=tExp+sum(expLines,l=>l.budget);
  const IX=ledgerIndex(y), mA=l=>actualOf(IX,'',l.type==='Income'?'mgaInc':'mgaExp',l.id,l.actual);
  const revenueA=tRevA+duesActual+sum(incLines,mA), expensesA=tExpA+sum(expLines,mA);
  const raffle=sum(ts,x=>sum(x.t.income.filter(i=>i.source==='raffle'),i=>i.budget));
  const raffleA=sum(ts,x=>sum(x.t.income.filter(i=>i.source==='raffle'),i=>actualOf(IX,x.t.id,'inc',i.id,i.actual)));
  /* Projected season net: actuals for tournaments that are over, budget for the rest, plus MGA-level money
     (dues and MGA lines use actuals once the season's tournaments are all past, budget otherwise). */
  const past=ts.filter(x=>isPast(x.t)), upcoming=ts.filter(x=>!isPast(x.t));
  const tProj=sum(past,x=>x.c.netA)+sum(upcoming,x=>x.c.net);
  const mgaBud=duesBudget+sum(incLines,l=>l.budget)-sum(expLines,l=>l.budget);
  const projected=tProj+mgaBud;
  return {s,ts,active,duesBudget,duesActual,tRev,tExp,revenue,expenses,net:revenue-expenses,past,upcoming,tProj,projected,revenueA,expensesA,netA:revenueA-expensesA,raffle,raffleA,
          pledged:sum(ts,x=>x.c.pledged),received:sum(ts,x=>x.c.received)};
}
function memberDues(y,mid){ const s=db.seasons[y]; return s?sum(s.duesPayments.filter(p=>p.memberId===mid),p=>p.amount):0; }
const memberName=m=>m?[m.first,m.last].filter(Boolean).join(' ')||'(no name)':'';
const initials=m=>m?((m.first||'?')[0]+((m.last||'')[0]||'')).toUpperCase():'—';
const memberById=id=>db.members.find(m=>m.id===id);

/* ---------- storage + cloud sync ---------- */
const LS_KEY='mga_hub_v1';
const store={ load(){ try{ return JSON.parse(localStorage.getItem(LS_KEY)); }catch(_){ return null; } },
              save(d){ try{ localStorage.setItem(LS_KEY,JSON.stringify(d)); }catch(_){} } };
const CFG=window.MM_CONFIG||{};
const CLOUD=!!(CFG.url&&CFG.anonKey&&window.supabase);
const sb=CLOUD?window.supabase.createClient(CFG.url,CFG.anonKey):null;
const CLIENT=uid();
let db=normalize(store.load()||emptyHub());
let saveT=null, pendingRemote=null, lastPushed='';
/* Stable stringify: Postgres jsonb reorders keys, so plain JSON.stringify can't tell "same data" apart. */
function stable(o){ if(Array.isArray(o)) return '['+o.map(stable).join(',')+']';
  if(o&&typeof o==='object') return '{'+Object.keys(o).filter(k=>k!=='_w'&&k!=='_at'&&o[k]!==undefined).sort().map(k=>JSON.stringify(k)+':'+stable(o[k])).join(',')+'}';
  return JSON.stringify(o); }
let lastSyncErr='';
function setSync(s,err){
  const d=$('syncDot'), t=$('syncTxt'); d.className='dot '+s;
  t.textContent=({synced:'All changes saved',saving:'Saving…',offline:'Not saving to cloud — tap to retry',local:'This device only'}[s]||s)+(t.dataset.upd&&s!=='offline'?` · updated ${t.dataset.upd}`:'');
  if(s==='offline'){ const m=err?(err.message||String(err))+(err.code?' ('+err.code+')':''):'Cloud unreachable';
    if(m!==lastSyncErr) toast('Cloud save failed: '+m); lastSyncErr=m; $('syncErr').textContent=m; $('syncErr').hidden=false; }
  else { lastSyncErr=''; $('syncErr').hidden=true; }
}
/* ---------- collaborative saving ----------
   Several board members can work at once. Each save is a compare-and-swap on a revision number
   kept inside the record (_rev): it only lands if nobody saved since we last saw the server copy.
   If someone did, we fetch theirs, three-way merge (their copy, ours, and the last copy we both
   shared) and try again. Merging works item by item — tournaments, lots, bidders, members, ledger
   lines are matched by id — so edits to different things never collide; when two people change
   the very same field, the later edit wins. Incoming changes merge into ours the same way, so
   unsaved local edits survive. */
let base=null;   // the last server copy we know about
const SKIP_KEYS={_w:1,_at:1,_rev:1};
const isObj=x=>x&&typeof x==='object'&&!Array.isArray(x);
const sameJ=(a,b)=>a===b||stable(a)===stable(b);
function byIdList(...arrs){ return arrs.every(a=>a===undefined||(Array.isArray(a)&&a.length>0&&a.every(e=>isObj(e)&&e.id!=null))); }
function merge3(b,l,r){
  if(sameJ(l,r)) return l; if(sameJ(b,l)) return r; if(sameJ(b,r)) return l;
  if(isObj(l)&&isObj(r)){ const out={}, bb=isObj(b)?b:{};
    for(const k of new Set(Object.keys(l).concat(Object.keys(r)))){ if(SKIP_KEYS[k]) continue; const v=merge3(bb[k],l[k],r[k]); if(v!==undefined) out[k]=v; }
    return out; }
  if(Array.isArray(l)&&Array.isArray(r)&&(l.length||r.length)&&byIdList(l.length?l:undefined,r.length?r:undefined,Array.isArray(b)&&b.length?b:undefined)){
    const bm=new Map((Array.isArray(b)?b:[]).map(e=>[e.id,e])), lm=new Map(l.map(e=>[e.id,e])), rm=new Map(r.map(e=>[e.id,e])), out=[];
    const pick=id=>{ const B=bm.get(id), L=lm.get(id), R=rm.get(id);
      if(L&&R) return merge3(B,L,R);
      if(L&&!R) return B&&sameJ(B,L)?undefined:L;           // they deleted it: gone, unless we changed it since
      if(R&&!L) return B&&sameJ(B,R)?undefined:R;           // we deleted it: gone, unless they changed it since
      return undefined; };
    const seen=new Set();
    for(const e of l){ seen.add(e.id); const v=pick(e.id); if(v!==undefined) out.push(v); }
    for(const e of r){ if(seen.has(e.id)) continue; seen.add(e.id); const v=pick(e.id); if(v!==undefined) out.push(v); }
    return out; }
  if(l===undefined) return r; if(r===undefined) return l;   // keep data rather than lose it
  return l;                                                  // same field changed on both sides: ours is the later edit
}
/* Bring `t` to match `s` without replacing objects that already exist: open editors and pending
   saves keep pointing at the live records, so nothing they save goes astray. */
function syncTo(t,s){
  if(t===s) return t;
  for(const k of Object.keys(t)) if(!(k in s)&&!SKIP_KEYS[k]) delete t[k];
  for(const k of Object.keys(s)){ const a=t[k], b=s[k];
    if(Array.isArray(a)&&Array.isArray(b)) syncArr(a,b);
    else if(isObj(a)&&isObj(b)) syncTo(a,b);
    else if(!sameJ(a,b)) t[k]=b; }
  return t;
}
function syncArr(ta,sa){
  if(ta===sa) return ta;
  if(sa.length&&sa.every(e=>isObj(e)&&e.id!=null)){ const m=new Map(ta.filter(e=>isObj(e)&&e.id!=null).map(e=>[e.id,e]));
    const out=sa.map(e=>{ const o=m.get(e.id); return o?syncTo(o,e):e; }); ta.splice(0,ta.length,...out); return ta; }
  if(!sameJ(ta,sa)) ta.splice(0,ta.length,...sa); return ta;
}
/* runs after every local save; the Calcutta cashier link and check-in link modules chain onto it */
function afterPersist(){ if(typeof calcAfterPersist==='function') calcAfterPersist(); }
let lastRemoteAt=0;
function persist(){
  if(typeof calcStampNow==='function') calcStampNow();   // mark what changed in shared Calcuttas before this save goes out
  db._w=CLIENT; db._at=Date.now(); store.save(db); if(typeof afterPersist==='function') afterPersist();
  if(!CLOUD||!sessionOK){ setSync('local'); return; }
  setSync('saving'); clearTimeout(saveT); saveT=setTimeout(pushCloud,300);
}
let pushing=false, pushAgain=false;
/* safe to reload for an update: nothing unsaved, not mid-save, no editor open */
window.__canReload=()=>!pushing&&!(typeof drawerOpen==='function'&&drawerOpen())&&(!CLOUD||!sessionOK||!base||stable(Object.assign({},db,{_w:0,_at:0,_rev:0}))===stable(Object.assign({},base,{_w:0,_at:0,_rev:0})));
async function fetchHub(){ const {data:row,error}=await sb.from('mga_hub').select('data').eq('id','main').maybeSingle(); if(error) throw error; return row&&row.data; }
async function pushCloud(){
  if(pushing){ pushAgain=true; return; }
  const bare=x=>stable(Object.assign({},x,{_w:0,_at:0,_rev:0}));
  if(base&&bare(db)===bare(base)){ setSync('synced'); return; }        // nothing actually changed: don't write (or ping anyone)
  pushing=true;
  try{
    for(let n=0;n<6;n++){
      const rev=base&&base._rev!=null?+base._rev:null;
      // a frozen copy of exactly what we send — edits made while it's in flight must not be mistaken for saved
      const next=JSON.parse(JSON.stringify(Object.assign({},db,{_rev:(rev||0)+1,_w:CLIENT,_at:Date.now()})));
      let q=sb.from('mga_hub').update({data:next,updated_at:new Date().toISOString()}).eq('id','main');
      q=rev==null?q.is('data->>_rev',null):q.eq('data->>_rev',String(rev));
      const {data:rows,error}=await q.select('id');
      if(error){ setSync('offline',error); return; }
      if(rows&&rows.length){ base=next; db._rev=next._rev; store.save(db); lastPushed=stable(next);
        const pendingEdits=stable(Object.assign({},db,{_w:0,_at:0,_rev:0}))!==stable(Object.assign({},next,{_w:0,_at:0,_rev:0}));
        if(pendingEdits){ pushAgain=true; setSync('saving'); } else setSync('synced'); return; }
      // someone saved since we last looked: merge theirs into ours and try again
      const remote=await fetchHub();
      if(!remote){ const {error:e2}=await sb.from('mga_hub').upsert({id:'main',data:next,updated_at:new Date().toISOString()}); if(e2){ setSync('offline',e2); return; } base=JSON.parse(JSON.stringify(next)); setSync('synced'); return; }
      mergeIn(remote,{quiet:true});
    }
    setSync('offline',{message:'Too many people saving at once — retrying'}); setTimeout(pushCloud,1500);
  }catch(e){ setSync('offline',e); }
  finally{ pushing=false; if(pushAgain){ pushAgain=false; setTimeout(pushCloud,50); } }
}
/* bring someone else's saved copy into ours */
function mergeIn(remote,opt){
  const before=stable(db);
  const merged=normalize(JSON.parse(JSON.stringify(merge3(base||remote,db,remote))));
  base=JSON.parse(JSON.stringify(remote));
  syncTo(db,merged); db._rev=remote._rev; store.save(db);          // same objects, new values
  const changed=stable(db)!==before;
  if(changed){ lastRemoteAt=Date.now(); if(!(opt&&opt.noRender)) render(); if(!(opt&&opt.quiet)) noteRemote(); }
  return changed;
}
function noteRemote(){ const t=$('syncTxt'); if(!t) return; t.dataset.upd=new Date().toLocaleTimeString([], {hour:'numeric',minute:'2-digit'}); setSync(pushing?'saving':'synced'); }
function applyRemote(remote){
  if(base&&remote._rev!=null&&base._rev!=null&&+remote._rev<=+base._rev) return;   // already have it — or it's an older copy arriving late
  // merged in place, so it's safe even with an editor open: the editor keeps the live record
  const hadLocal=base&&stable(db)!==stable(Object.assign({},base,{_w:db._w,_at:db._at}));
  mergeIn(remote);
  if(hadLocal) persist();                                            // our unsaved edits still need to go up
}
let sessionOK=false, cloudReady=false;
async function startCloud(){
  setSync('saving');
  const {data:row,error}=await sb.from('mga_hub').select('data').eq('id','main').maybeSingle();
  if(error){ setSync('offline',/relation|does not exist/i.test(error.message)?{message:'The mga_hub table is missing — run hub-setup.sql in Supabase'}:error); render(); return; }
  cloudReady=true;
  if(row&&row.data){ const local=db; base=JSON.parse(JSON.stringify(row.data)); db=normalize(row.data);
    // edits made on this device while it was offline: merge them in and save
    if(local&&local._w===CLIENT&&local._rev===row.data._rev&&stable(local)!==stable(db)){ db=normalize(merge3(row.data,local,row.data)); }
    store.save(db); setSync('synced'); }
  else { base=null; await pushCloud(); }
  render();
  sb.channel('mga-hub').on('postgres_changes',{event:'*',schema:'public',table:'mga_hub',filter:'id=eq.main'},p=>{
    const r=p.new&&p.new.data; if(!r||r._w===CLIENT&&base&&r._rev===base._rev) return; applyRemote(r);
  }).subscribe();
  const check=async()=>{ try{ const r=await fetchHub(); if(r&&(!base||r._rev!==base._rev)) applyRemote(r); }catch(_){} };
  document.addEventListener('visibilitychange',()=>{ if(document.visibilityState==='visible') check(); });
  setInterval(()=>{ if(document.visibilityState==='visible'&&!pushing) check(); },15000);   // a safety net if a live update is missed
}

