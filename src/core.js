/* =====================================================================
   Club Hub — core: data model, calculations, storage + collaborative cloud save
   Data lives in public.mga_hub, ONE jsonb row per organization: `club` (the member directory, the list of
   organizations and the club's own hub) plus one row per association (`mga`, `lga`, `smga`) and per small
   group. Two rows are open at a time: the club's (CLUB) and the selected organization's (db — the same object
   as CLUB when the club itself is selected). The `main` row is the frozen MGA Hub (Hub branch): read-only here.
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

/* ---------- model ----------
   Organization document (one per row): { v, id, kind:'club'|'association'|'group', name, short, crest?, activeSeason,
     memberships:[{id:<person id>, status, joined, notes}], board, seasons, tournaments, golf?, ... }
   The club's document also carries members:[person] (the master directory — first, last, email, phone, hcp, ghin,
   memberNo, address…, status = club status) and orgs:[{id, kind, name, short, crest?, archived?}].
   A person is one record club-wide; each organization's membership adds its own status / joined / notes. */
const HUB_VERSION=2;
const ORG_KINDS={club:'Club',association:'Association',group:'Small group'};
const CLUB_META={id:'club',kind:'club',name:'Walnut Creek Country Club',short:'Club'};
const DEFAULT_ORGS=[{id:'mga',kind:'association',name:'Men’s Golf Association',short:'MGA',crest:'mga-crest.png'},
                    {id:'lga',kind:'association',name:'Ladies’ Golf Association',short:'LGA'},
                    {id:'smga',kind:'association',name:'Senior Men’s Golf Association',short:'SMGA'}];
const DEFAULT_ROLES=['President','Vice President','Treasurer','Secretary','Tournament Chair','Member at Large','Member at Large'];
const ITEM_KINDS=['Meal','Drinks','Event','Other'];
function newSeason(){ return {dues:{amount:90,installments:2},duesPayments:[],lines:[],txns:[],bank:[],bankBatches:[],bankOpening:{amount:0,date:''}}; }
function emptyOrg(meta){
  meta=meta||CLUB_META; const y=String(new Date().getFullYear());
  const d={v:HUB_VERSION,id:meta.id,kind:meta.kind||'association',name:meta.name||'',short:meta.short||'',activeSeason:y,memberships:[],
           board:DEFAULT_ROLES.map(r=>({id:uid(),role:r,memberId:'',term:''})),seasons:{[y]:newSeason()},tournaments:[]};
  if(d.kind==='club'){ d.members=[]; d.orgs=[]; }
  return d;
}
const emptyHub=()=>emptyOrg(CLUB_META);
function newTournament(o){
  const days=Math.min(3,Math.max(1,+o.days||1));
  return {id:uid(),season:o.season,name:o.name||'New tournament',startDate:o.startDate||'',days,venue:o.venue||'Walnut Creek Country Club',
    status:'Planning',budgetBasis:'planned',entryFee:n0(o.entryFee),skinsFee:n0(o.skinsFee),plannedPlayers:n0(o.plannedPlayers),teamSize:+o.teamSize||2,ggEvent:o.ggEvent||'',
    field:[],sponsors:[],tiers:[],goal:0,
    dayItems:[[],[],[]].slice(0,3),income:[],perPlayer:[],lines:[],
    actuals:{entryFees:0,skins:0,skinsPaid:0},schedule:[],decisions:[],notes:'',source:null};
}
function normalize(d,meta){
  if(!d||typeof d!=='object') return emptyOrg(meta);
  d.v=d.v||HUB_VERSION; if(meta){ d.id=d.id||meta.id; d.kind=d.kind||meta.kind; if(!d.name) d.name=meta.name||''; if(!d.short) d.short=meta.short||''; }
  d.kind=d.kind||'association'; d.memberships=d.memberships||[]; d.board=d.board||[]; d.seasons=d.seasons||{}; d.tournaments=d.tournaments||[];
  if(d.kind==='club'){ d.members=d.members||[]; d.orgs=d.orgs||[]; d.members.forEach(p=>{ if(!p.status) p.status='Active'; }); }
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
  const active=members().filter(m=>m.status!=='Inactive').length;
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

/* ---------- members: the club directory + this organization's memberships ----------
   People live once, in CLUB.members. An association or small group lists who belongs in db.memberships
   (status / joined / notes are per organization). members() returns read-only views that combine the two;
   every write goes through upsertMember / removeMember so both documents are kept right. */
const isClub=()=>!!db&&db===CLUB;
const persons=()=>CLUB?CLUB.members:[];
const personById=id=>persons().find(p=>p.id===id);
const PERSON_KEYS=['first','last','email','phone','hcp','hcpAt','ghin','memberNo','ggId','address1','address2','city','state','zip','dob','memberType','gender','source'];
function memberView(p,ms){
  const v=Object.assign({},p);
  if(!isClub()) Object.assign(v,{status:ms?(ms.status||'Active'):'Inactive',joined:ms?(ms.joined||''):'',notes:ms?(ms.notes||''):''});
  Object.defineProperty(v,'_p',{value:p}); Object.defineProperty(v,'_ms',{value:ms||null}); return v;
}
function members(){
  if(!db) return [];
  if(isClub()) return persons().map(p=>memberView(p,null));
  const by=new Map(persons().map(p=>[p.id,p]));
  return (db.memberships||[]).map(ms=>{ const p=by.get(ms.id); return p?memberView(p,ms):null; }).filter(Boolean);
}
const membershipOf=id=>isClub()||!db?null:(db.memberships||[]).find(m=>m.id===id)||null;
function memberById(id){ const p=personById(id); return p?memberView(p,membershipOf(id)):undefined; }
/* create or update a person (club directory) and, in an association / group, their membership here.
   `data` mixes person fields and status / joined / notes; in the club the latter are the person's club status. */
function upsertMember(id,data){
  const pf={}, mf={};
  for(const k of Object.keys(data||{})){ if(isClub()||PERSON_KEYS.includes(k)) pf[k]=data[k]; else mf[k]=data[k]; }
  let p=id?personById(id):null;
  if(!p){ p=Object.assign({id:id||uid(),status:'Active'},pf); CLUB.members.push(p); } else Object.assign(p,pf);
  if(!isClub()){ let m=membershipOf(p.id); if(!m){ m={id:p.id,status:'Active',joined:'',notes:''}; db.memberships.push(m); } Object.assign(m,mf); }
  return p;
}
/* in an association / group this only ends the membership; the person stays in the club directory */
function removeMember(id){
  if(isClub()) CLUB.members=CLUB.members.filter(p=>p.id!==id); else db.memberships=db.memberships.filter(m=>m.id!==id);
  db.board.forEach(b=>{ if(b.memberId===id) b.memberId=''; }); db.tournaments.forEach(t=>t.field=t.field.filter(p=>p.memberId!==id));
  for(const ss of Object.values(db.seasons)) ss.duesPayments=ss.duesPayments.filter(p=>p.memberId!==id);
}
const memberSnapshot=()=>({persons:clone(CLUB.members),ms:isClub()?null:clone(db.memberships)});
function memberRestore(sn){ CLUB.members=sn.persons; if(sn.ms) db.memberships=sn.ms; }

/* ---------- storage + cloud sync ----------
   Per-row engine. Each open document (DOCS[id]) has its own server copy (base), compare-and-swap save and
   realtime subscription; persist() saves whichever open documents changed. */
const LS_KEY='club_hub_v1';
const store={ load(id){ try{ return JSON.parse(localStorage.getItem(LS_KEY+':'+id)); }catch(_){ return null; } },
              save(id,d){ try{ localStorage.setItem(LS_KEY+':'+id,JSON.stringify(d)); }catch(_){} } };
const CFG=window.MM_CONFIG||{};
const CLOUD=!!(CFG.url&&CFG.anonKey&&window.supabase);
const sb=CLOUD?window.supabase.createClient(CFG.url,CFG.anonKey):null;
const CLIENT=uid();
/* The site root (app.wcccmga.org/). Links to the cashier, check-in and scoring pages and to crest.png are built from
   it, so they work from any organization's path. */
const HTTP=/^https?:/.test(location.protocol);
const SITE_BASE=HTTP?location.origin+'/':location.href.split('#')[0].split('?')[0].replace(/[^/]*$/,'');
/* Which organization this page is: the first path segment — app.wcccmga.org/ is the club, /mga the MGA, /lga, /smga,
   /<group id> a small group (Render rewrites every path to index.html). ?org= is the fallback for file:// testing. */
let ORG_ID=(()=>{ const q=new URLSearchParams(location.search).get('org');
  if(HTTP){ const seg=location.pathname.split('/').filter(s=>s&&!/\.html?$/i.test(s)); return (seg[0]||q||'club').toLowerCase(); }
  return q!=null?q:''; })();
const DOCS={};   // id → {id, meta, db, base, pushing, pushAgain, saveT, st, err, chan}
function docState(id,meta){ const D=DOCS[id]||(DOCS[id]={id,meta:null,db:null,base:null,pushing:false,pushAgain:false,saveT:null,st:'local',err:null,chan:null}); if(meta) D.meta=meta; return D; }
const openDocs=()=>Object.values(DOCS).filter(D=>D.db);
function orgMeta(id){ id=id||ORG_ID; if(id==='club') return CLUB_META; return (CLUB&&CLUB.orgs||[]).find(o=>o.id===id)||null; }
let CLUB=null, db=null;
/* local mode (no cloud, or before sign-in): open the device's copies */
function openLocal(){
  const C=docState('club',CLUB_META); if(!C.db) C.db=normalize(store.load('club'),CLUB_META); CLUB=C.db;
  if(!CLOUD){ if(!CLUB.orgs.length) CLUB.orgs=clone(DEFAULT_ORGS); if(!ORG_ID) ORG_ID='mga'; }
  if(ORG_ID==='club') db=CLUB;
  else if(ORG_ID){ const meta=orgMeta(ORG_ID); if(meta){ const D=docState(ORG_ID,meta); if(!D.db) D.db=normalize(store.load(ORG_ID),meta); db=D.db; } else db=null; }   // unknown here until the club document loads
  else db=null;
}
openLocal();
/* choose an organization (reload keeps every module's state clean) */
function chooseOrg(id){ if(HTTP){ location.href=SITE_BASE+(id&&id!=='club'?encodeURIComponent(id):''); return; } const u=new URL(location.href); if(id) u.searchParams.set('org',id); else u.searchParams.delete('org'); location.href=u.toString(); }
const orgURL=id=>HTTP?SITE_BASE.replace(/^https?:\/\//,'')+(id==='club'?'':id):'?org='+id;

/* Stable stringify: Postgres jsonb reorders keys, so plain JSON.stringify can't tell "same data" apart. */
function stable(o){ if(Array.isArray(o)) return '['+o.map(stable).join(',')+']';
  if(o&&typeof o==='object') return '{'+Object.keys(o).filter(k=>k!=='_w'&&k!=='_at'&&o[k]!==undefined).sort().map(k=>JSON.stringify(k)+':'+stable(o[k])).join(',')+'}';
  return JSON.stringify(o); }
let lastSyncErr='';
/* the status line shows the worst state across the open documents */
function setSyncD(D,s,err){ D.st=s; D.err=err||null; showSync(); }
function showSync(){ const ds=openDocs(); const off=ds.find(D=>D.st==='offline'); paintSync(off?'offline':ds.some(D=>D.st==='saving')?'saving':ds.some(D=>D.st==='local')?'local':'synced',off&&off.err); }
function setSync(s,err){ openDocs().forEach(D=>{ D.st=s; D.err=err||null; }); paintSync(s,err); }
function paintSync(s,err){
  const d=$('syncDot'), t=$('syncTxt'); if(!d||!t) return; d.className='dot '+s;
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
const bare=x=>stable(Object.assign({},x,{_w:0,_at:0,_rev:0}));
const docChanged=D=>!D.base||bare(D.db)!==bare(D.base);
function persist(){
  if(typeof calcStampNow==='function') calcStampNow();   // mark what changed in shared Calcuttas before this save goes out
  for(const D of openDocs()){ D.db._w=CLIENT; D.db._at=Date.now(); store.save(D.id,D.db); }
  if(typeof afterPersist==='function') afterPersist();
  if(!CLOUD||!sessionOK){ setSync('local'); return; }
  for(const D of openDocs()){ if(!docChanged(D)) continue; setSyncD(D,'saving'); clearTimeout(D.saveT); D.saveT=setTimeout(()=>pushCloud(D),300); }
}
function pushAll(){ openDocs().forEach(D=>pushCloud(D)); }
/* safe to reload for an update: nothing unsaved, not mid-save, no editor open */
window.__canReload=()=>!(typeof drawerOpen==='function'&&drawerOpen())&&openDocs().every(D=>!D.pushing&&(!CLOUD||!sessionOK||!D.base||!docChanged(D)));
async function fetchRow(id){ const {data:row,error}=await sb.from('mga_hub').select('data').eq('id',id).maybeSingle(); if(error) throw error; return row&&row.data; }
async function pushCloud(D){
  if(D.pushing){ D.pushAgain=true; return; }
  if(D.base&&!docChanged(D)){ setSyncD(D,'synced'); return; }        // nothing actually changed: don't write (or ping anyone)
  D.pushing=true;
  try{
    for(let n=0;n<6;n++){
      const rev=D.base&&D.base._rev!=null?+D.base._rev:null;
      // a frozen copy of exactly what we send — edits made while it's in flight must not be mistaken for saved
      const next=JSON.parse(JSON.stringify(Object.assign({},D.db,{_rev:(rev||0)+1,_w:CLIENT,_at:Date.now()})));
      let q=sb.from('mga_hub').update({data:next,updated_at:new Date().toISOString()}).eq('id',D.id);
      q=rev==null?q.is('data->>_rev',null):q.eq('data->>_rev',String(rev));
      const {data:rows,error}=await q.select('id');
      if(error){ setSyncD(D,'offline',error); return; }
      if(rows&&rows.length){ D.base=next; D.db._rev=next._rev; store.save(D.id,D.db);
        if(bare(D.db)!==bare(next)){ D.pushAgain=true; setSyncD(D,'saving'); } else setSyncD(D,'synced'); return; }
      // someone saved since we last looked (or the row doesn't exist yet): merge theirs into ours and try again
      const remote=await fetchRow(D.id);
      if(!remote){ const {error:e2}=await sb.from('mga_hub').upsert({id:D.id,data:next,updated_at:new Date().toISOString()}); if(e2){ setSyncD(D,'offline',e2); return; }
        D.base=JSON.parse(JSON.stringify(next)); D.db._rev=next._rev; store.save(D.id,D.db); setSyncD(D,'synced'); return; }
      mergeIn(D,remote,{quiet:true});
    }
    setSyncD(D,'offline',{message:'Too many people saving at once — retrying'}); setTimeout(()=>pushCloud(D),1500);
  }catch(e){ setSyncD(D,'offline',e); }
  finally{ D.pushing=false; if(D.pushAgain){ D.pushAgain=false; setTimeout(()=>pushCloud(D),50); } }
}
/* bring someone else's saved copy into ours */
function mergeIn(D,remote,opt){
  const before=stable(D.db);
  const merged=normalize(JSON.parse(JSON.stringify(merge3(D.base||remote,D.db,remote))),D.meta);
  D.base=JSON.parse(JSON.stringify(remote));
  syncTo(D.db,merged); D.db._rev=remote._rev; store.save(D.id,D.db);          // same objects, new values
  const changed=stable(D.db)!==before;
  if(changed){ lastRemoteAt=Date.now(); if(!(opt&&opt.noRender)) render(); if(!(opt&&opt.quiet)) noteRemote(); }
  return changed;
}
function noteRemote(){ const t=$('syncTxt'); if(!t) return; t.dataset.upd=new Date().toLocaleTimeString([], {hour:'numeric',minute:'2-digit'}); showSync(); }
function applyRemote(D,remote){
  if(D.base&&remote._rev!=null&&D.base._rev!=null&&+remote._rev<=+D.base._rev) return;   // already have it — or it's an older copy arriving late
  // merged in place, so it's safe even with an editor open: the editor keeps the live record
  const hadLocal=D.base&&stable(D.db)!==stable(Object.assign({},D.base,{_w:D.db._w,_at:D.db._at}));
  mergeIn(D,remote);
  if(hadLocal) persist();                                            // our unsaved edits still need to go up
}
let sessionOK=false, cloudReady=false, setupNeeded=false;
/* open one row: server copy wins over the device's; the row is created when `create` is set */
async function loadDoc(id,meta,opt){
  const D=docState(id,meta);
  const remote=await fetchRow(id);
  if(remote){ D.base=JSON.parse(JSON.stringify(remote)); D.db=normalize(remote,meta); store.save(id,D.db); setSyncD(D,'synced'); }
  else if(opt&&opt.create){ D.db=normalize(null,meta); D.base=null; await pushCloud(D); }
  else return null;
  watchDoc(D); return D.db;
}
function watchDoc(D){
  if(D.chan||!CLOUD) return;
  D.chan=sb.channel('hub-'+D.id).on('postgres_changes',{event:'*',schema:'public',table:'mga_hub',filter:'id=eq.'+D.id},p=>{
    const r=p.new&&p.new.data; if(!r||r._w===CLIENT&&D.base&&r._rev===D.base._rev) return; applyRemote(D,r);
  }).subscribe();
}
let pollStarted=false;
function startPoll(){
  if(pollStarted) return; pollStarted=true;
  const check=async()=>{ for(const D of openDocs()){ if(D.pushing||!D.chan) continue; try{ const r=await fetchRow(D.id); if(r&&(!D.base||r._rev!==D.base._rev)) applyRemote(D,r); }catch(_){} } };
  document.addEventListener('visibilitychange',()=>{ if(document.visibilityState==='visible') check(); });
  setInterval(()=>{ if(document.visibilityState==='visible') check(); },15000);   // a safety net if a live update is missed
}
async function startCloud(){
  paintSync('saving');
  try{
    const club=await loadDoc('club',CLUB_META);
    cloudReady=true;
    if(!club){ setupNeeded=true; CLUB=null; db=null; render(); return; }          // first run: the club hasn't been set up yet
    setupNeeded=false; CLUB=club;
    if(ORG_ID==='club') db=CLUB;
    else if(ORG_ID){ const meta=orgMeta(ORG_ID); if(meta&&!meta.archived) db=await loadDoc(ORG_ID,meta,{create:true}); else db=null; }
    else db=null;
    render(); startPoll();
  }catch(error){ setSync('offline',/relation|does not exist/i.test(error.message||'')?{message:'The mga_hub table is missing — run hub-setup.sql in Supabase'}:error); render(); }
}
/* ---------- one-time set-up / re-import from the MGA Hub (the `main` row) ----------
   Builds the club directory from the MGA's member list (same ids, so fields, boards and Calcuttas keep working),
   registers the default organizations, and copies the MGA Hub's document to the `mga` row with its members turned
   into memberships. Re-running updates the directory and REPLACES the mga row with the Hub's current data. */
async function putDoc(id,data){
  for(let n=0;n<6;n++){
    const cur=await fetchRow(id), rev=cur&&cur._rev!=null?+cur._rev:null;
    const next=Object.assign({},data,{_rev:(rev||0)+1,_w:CLIENT,_at:Date.now()}), stamp=new Date().toISOString();
    if(!cur){ const {error}=await sb.from('mga_hub').upsert({id,data:next,updated_at:stamp}); if(error) throw error; }
    else { let q=sb.from('mga_hub').update({data:next,updated_at:stamp}).eq('id',id); q=rev==null?q.is('data->>_rev',null):q.eq('data->>_rev',String(rev));
      const {data:rows,error}=await q.select('id'); if(error) throw error; if(!rows||!rows.length) continue; }
    const D=DOCS[id]; if(D&&D.db){ D.base=JSON.parse(JSON.stringify(next)); syncTo(D.db,normalize(JSON.parse(JSON.stringify(next)),D.meta)); D.db._rev=next._rev; store.save(id,D.db); }
    return next;
  }
  throw new Error('Could not save '+id+' — try again');
}
function hubToClub(main,club){
  const by=new Map(club.members.map(p=>[p.id,p]));
  for(const m of main.members||[]){ const person={}; for(const k of Object.keys(m)) if(!['status','joined','notes'].includes(k)) person[k]=m[k];
    const p=by.get(m.id); if(p) Object.assign(p,person); else club.members.push(Object.assign({status:'Active'},person)); }
  for(const o of DEFAULT_ORGS) if(!club.orgs.some(x=>x.id===o.id)) club.orgs.push(clone(o));
  club.migratedAt=new Date().toISOString();
}
function hubToOrg(main,meta){
  const d={}; for(const k of Object.keys(main)) if(!['members','_rev','_w','_at'].includes(k)) d[k]=main[k];
  d.id=meta.id; d.kind=meta.kind; d.name=meta.name; d.short=meta.short;
  d.memberships=(main.members||[]).map(m=>({id:m.id,status:m.status||'Active',joined:m.joined||'',notes:m.notes||''}));
  return normalize(JSON.parse(JSON.stringify(d)),meta);
}
async function migrateFromHub(){
  const main=await fetchRow('main'); if(!main||!main.tournaments) throw new Error('The MGA Hub’s data (row “main”) was not found');
  const C=docState('club',CLUB_META);
  if(!C.db){ const remote=await fetchRow('club'); C.base=remote?JSON.parse(JSON.stringify(remote)):null; C.db=normalize(remote,CLUB_META); }
  hubToClub(main,C.db); CLUB=C.db; if(ORG_ID==='club') db=CLUB;
  await putDoc('club',JSON.parse(JSON.stringify(C.db)));
  await putDoc('mga',hubToOrg(main,DEFAULT_ORGS[0]));
  setupNeeded=false; watchDoc(C); startPoll();
  return {people:main.members.length,tournaments:main.tournaments.length};
}
