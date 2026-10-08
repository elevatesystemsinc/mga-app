/* =====================================================================
   Two-way sync with the current Member-Member app.
   Each imported tournament remembers the current app's year as it was at the
   last sync (t.source.raw). On every check:
     hub changed, app didn't   → push the hub's version
     app changed, hub didn't   → pull it into the hub (hub-only data kept)
     both changed              → conflict: nothing is overwritten; you choose
   Checks run a moment after hub edits, when the current app changes (live),
   when the tab comes back into view, and every minute.
   ===================================================================== */
const SYNC_IDS={carry:'mm-carry',mga:'mm-mga',raffle:'mm-raffle',pp:'mm-proshop',flight:'mm-flight'};
const isSynced=t=>!(typeof legacyRetired==='function'&&legacyRetired())&&t&&t.source&&t.source.kind==='mm-app'&&!(t.sync&&t.sync.off);
/* bring the current app's year into a hub tournament, keeping what only the hub knows */
function mergeFromMM(t,live){
  const fresh=convertMM(live,t.source.year);
  const hubInc={carry:t.income.find(i=>/carry/i.test(i.desc||'')),mga:t.income.find(i=>/mga|donation/i.test(i.desc||'')),raffle:t.income.find(i=>i.source==='raffle'||/50\/50|raffle/i.test(i.desc||''))};
  const hubFlight=t.lines.find(l=>/flight prize/i.test(l.desc||''))||t.lines.find(l=>(l.group||'')==='Prizes');
  // the hub's ids for the lines the current app keeps as plain fields (so ledger links survive)
  fresh.income.forEach(i=>{ for(const k of ['carry','mga','raffle']) if(i.id===SYNC_IDS[k]&&hubInc[k]){ i.id=hubInc[k].id; i.desc=hubInc[k].desc; i.notes=hubInc[k].notes||i.notes; } });
  if(fresh.perPlayer[0]&&t.perPlayer[0]){ fresh.perPlayer[0].id=t.perPlayer[0].id; fresh.perPlayer[0].desc=t.perPlayer[0].desc; }
  const fl=fresh.lines.find(l=>l.id===SYNC_IDS.flight); if(fl&&hubFlight){ fl.id=hubFlight.id; fl.desc=hubFlight.desc; fl.group=hubFlight.group||'Prizes'; }
  // hub-only lines the current app can't hold
  t.income.filter(i=>![hubInc.carry,hubInc.mga,hubInc.raffle].includes(i)).forEach(i=>fresh.income.push(i));
  const players=playersUsed(t), extraPP=t.perPlayer.slice(1);
  extraPP.forEach(p=>{ const m=fresh.lines.find(l=>l.id===p.id); const q=clone(p);
    if(m){ if(players&&Math.abs(n0(m.budget)-players*n0(p.perPlayer))>=0.01) q.perPlayer=Math.round(n0(m.budget)/players*100)/100; q.actual=n0(m.actual); fresh.lines=fresh.lines.filter(l=>l!==m); }
    fresh.perPlayer.push(q); });
  // lines in the hub keep their group; items keep their type, quantity links and extra catered menus
  const hubLine=new Map(t.lines.map(l=>[l.id,l])); fresh.lines.forEach(l=>{ const h=hubLine.get(l.id); if(h&&h.group) l.group=h.group; });
  [0,1,2].forEach(di=>{ const hubItems=new Map((t.dayItems[di]||[]).map(i=>[i.id,i]));
    fresh.dayItems[di]=(fresh.dayItems[di]||[]).map(it=>{ const h=hubItems.get(it.id); if(!h) return it;
      if(h.menu&&!it.menu&&n0(it.qty)===1&&Math.abs(n0(it.unitCost)-Math.round(menuTotal(h.menu)*100)/100)<0.01) return Object.assign(clone(h),{actual:it.actual,notes:it.notes,item:it.item});
      if(h.kind) it.kind=h.kind;
      if(h.qtyLink==='players'&&n0(it.qty)===players){ it.qtyLink='players'; }
      if(it.menu&&h.menu) it.menu.guests=n0(it.menu.guests);
      return it; }); });
  // hub-only settings and the field stay as they are
  const keep=['id','season','name','startDate','days','venue','status','budgetBasis','teamSize','ggEvent','notes','field','fieldQuestions','rosterFile','rosterImportedAt','sync','calcutta','checklist','checkinShare','raffle'];
  const saved={}; keep.forEach(k=>{ if(t[k]!==undefined) saved[k]=t[k]; });
  if(t.budgetBasis==='field') saved.plannedPlayers=t.plannedPlayers;
  const src=Object.assign({},fresh.source,{pushedAt:t.source.pushedAt||'',importedAt:t.source.importedAt});
  Object.keys(fresh).forEach(k=>{ if(!keep.includes(k)) t[k]=fresh[k]; });
  Object.assign(t,saved); t.source=src; t.source.raw=clone(live);
}
let syncBusy=false, syncTimer=null, syncSuppress=false, syncStarted=false;
/* "last checked", "in sync", conflicts… are this device's view, not shared data — keeping them out of the
   record means a background check never counts as an edit (and never pings everyone else) */
const SYNC_ST={};
function syncState(t,state,extra){ SYNC_ST[t.id]=Object.assign(SYNC_ST[t.id]||{},{state,at:new Date().toISOString()},extra||{}); }
const syncSt=t=>Object.assign({},SYNC_ST[t.id]||{},{off:!!(t.sync&&t.sync.off)});
async function syncTournament(t,depth){
  if(!CLOUD||!sessionOK||!isSynced(t)) return;
  const yr=t.source.year; let st;
  try{ st=await fetchMMState(); }catch(e){ syncState(t,'error',{msg:'Couldn’t reach the current app'}); return; }
  const live=st.years&&st.years[yr]; if(!live){ syncState(t,'error',{msg:`The current app has no ${yr} season`}); return; }
  const raw=t.source.raw;
  const local=stable(hubToMM(t,raw).year)!==stable(raw), remote=stable(live)!==stable(raw);
  if(!local&&!remote){ syncState(t,'synced'); return; }
  if(local&&remote){ syncState(t,'conflict',{appChanges:mmDrift(raw,live),hubChanges:mmDrift(raw,hubToMM(t,raw).year)}); return; }
  if(remote){
    if(drawerOpen()){ setTimeout(syncSoon,2500); return; }      // never swap records out from under an open editor
    mergeFromMM(t,live); syncState(t,'synced',{last:'pulled'});
    if(!depth) return syncTournament(t,1);                       // settle any tidy-up (e.g. numbers stored as text) once
    return;
  }
  const next=hubToMM(t,live).year, data=clone(st); data.years[yr]=next;
  const {error}=await sb.from('mm_tournament').update({data,updated_at:new Date().toISOString()}).eq('id','main');
  if(error){ syncState(t,'error',{msg:'Push failed: '+error.message}); return; }
  t.source.raw=clone(next); t.source.pushedAt=new Date().toISOString(); syncState(t,'synced',{last:'pushed'});
}
async function syncAll(){
  if(syncBusy){ syncSoon(); return; } syncBusy=true;
  db.tournaments.forEach(t=>{ if(t.sync&&Object.keys(t.sync).some(k=>k!=='off')) t.sync={off:!!t.sync.off}; });   // drop status saved by older versions
  const dataBefore=stable(db), before=stable(db.tournaments.filter(isSynced).map(t=>[t.id,(SYNC_ST[t.id]||{}).state]));
  try{ for(const t of db.tournaments.filter(isSynced)) await syncTournament(t); }
  finally{ syncBusy=false; }
  if(stable(db)!==dataBefore){ syncSuppress=true; persist(); syncSuppress=false; }   // save only if a check actually brought in a change
  const after=stable(db.tournaments.filter(isSynced).map(t=>[t.id,(SYNC_ST[t.id]||{}).state]));
  if(!drawerOpen()&&(before!==after||view.page==='tournament'||view.page==='dash')) render();
}
function syncSoon(ms){ clearTimeout(syncTimer); syncTimer=setTimeout(syncAll,ms||2500); }
function afterPersist(){ if(!syncSuppress&&typeof calcAfterPersist==='function') calcAfterPersist(); if(syncSuppress||!CLOUD||!sessionOK) return; if(db.tournaments.some(isSynced)) syncSoon(2500); startSyncWatch(); }
function startSyncWatch(){
  if(syncStarted||!CLOUD||!sessionOK) return; syncStarted=true;
  sb.channel('mm-sync').on('postgres_changes',{event:'*',schema:'public',table:'mm_tournament',filter:'id=eq.main'},()=>{ if(db.tournaments.some(isSynced)) syncSoon(800); }).subscribe();
  document.addEventListener('visibilitychange',()=>{ if(document.visibilityState==='visible'&&db.tournaments.some(isSynced)) syncSoon(500); });
  setInterval(()=>{ if(document.visibilityState==='visible'&&db.tournaments.some(isSynced)) syncAll(); },60000);
  if(db.tournaments.some(isSynced)) syncSoon(1000);
}
/* header chip + conflict resolver */
function syncChip(t){
  if(typeof legacyRetired==='function'&&legacyRetired()) return '';
  if(!t.source||t.source.kind!=='mm-app') return '';
  if(t.sync&&t.sync.off) return '<button class="chip" data-sync="1" style="cursor:pointer">Sync off</button>';
  if(!CLOUD||!sessionOK) return '<span class="chip">Sync needs the cloud sign-in</span>';
  const s=syncSt(t), when=s.at?new Date(s.at).toLocaleTimeString([], {hour:'numeric',minute:'2-digit'}):'';
  if(s.state==='conflict') return '<button class="chip warn" data-sync="1" style="cursor:pointer">⇄ Conflict — choose a version</button>';
  if(s.state==='error') return `<button class="chip warn" data-sync="1" style="cursor:pointer" title="${esc(s.msg||'')}">⇄ Sync problem — retry</button>`;
  if(s.state==='synced') return `<button class="chip ok" data-sync="1" style="cursor:pointer" title="In sync with the current Member-Member app">⇄ In sync · ${when}</button>`;
  return '<span class="chip">⇄ Checking…</span>';
}
function openSync(t){
  const s=syncSt(t);
  if(s.state==='conflict'){
    openDrawer({kicker:t.name,title:'Both versions changed',saveLabel:'Keep the hub’s',delPlain:true,
      body:`<p style="margin:0">Since the last sync, this tournament was edited in <b>both</b> the hub and the current Member-Member app. Nothing has been overwritten. Pick which version wins — the other side’s recent edits will be replaced.</p>
        <div class="fld"><span class="lbl">Changed in the current app</span><div class="mini">${(s.appChanges||[]).map(x=>`<div class="mr"><span style="font-size:13px">${esc(x)}</span></div>`).join('')}</div></div>
        <div class="fld"><span class="lbl">Changed in the hub</span><div class="mini">${(s.hubChanges||[]).map(x=>`<div class="mr"><span style="font-size:13px">${esc(x)}</span></div>`).join('')}</div></div>
        <p class="hint"><b>Keep the hub’s</b> sends the hub’s version to the current app (a backup of the current app’s data downloads first). <b>Use the app’s</b> brings the current app’s version into the hub; the hub’s field, flights and ledger stay.</p>`,
      del:()=>{ (async()=>{ const st=await fetchMMState(); mergeFromMM(t,st.years[t.source.year]); syncState(t,'synced',{last:'pulled'}); syncSuppress=true; persist(); syncSuppress=false; render(); toast('Took the current app’s version'); })(); return undefined; },delLabel:'Use the app’s',
      save:()=>{ (async()=>{ const st=await fetchMMState(); dl(JSON.stringify(st,null,2),'application/json',`member-member_backup_before_sync_${new Date().toISOString().slice(0,16).replace(/[:T]/g,'-')}.json`);
        t.source.raw=clone(st.years[t.source.year]); await syncTournament(t); syncSuppress=true; persist(); syncSuppress=false; render(); toast('Kept the hub’s version · backup saved'); })(); return undefined; }});
    return;
  }
  openDrawer({kicker:t.name,title:'Sync with the current app',saveLabel:'Save',wire:r=>{ const x=r.querySelector('#syRetire'); if(x) x.onclick=()=>{ closeDrawer(); retireLegacy(); }; },
    body:`<label class="check" style="align-items:flex-start"><input type="checkbox" id="syOn"${t.sync&&t.sync.off?'':' checked'}><span>Keep this tournament in sync with the current Member-Member app <span class="muted">(${esc(t.source.year)})</span></span></label>
      <p class="hint">Hub edits go to the current app a couple of seconds after you make them; edits made there show up here live. The field, flights and anything the current app can’t hold stay in the hub only. If both sides change at once, you’ll be asked which version to keep.</p>
      <p class="hint" style="border-top:1px solid var(--line);padding-top:12px">Moving to the hub for good? <button class="btn sm" type="button" id="syRetire">Retire the current app</button></p>
      <p class="hint">${s.state==='error'?esc(s.msg||''):s.at?'Last checked '+new Date(s.at).toLocaleString()+(s.last?` · last ${s.last==='pushed'?'sent to':'received from'} the current app`:''):''}</p>`,
    save:()=>{ t.sync=Object.assign(t.sync||{},{off:!$('syOn').checked}); if(!t.sync.off) syncSoon(300); }});
}
document.addEventListener('click',e=>{ const b=e.target.closest('[data-sync]'); if(!b) return; const t=T(); if(t) openSync(t); });

