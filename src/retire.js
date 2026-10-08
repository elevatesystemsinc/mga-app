/* =====================================================================
   Retiring the current Member-Member app (app.wcccmga.org). One-time, board-wide:
   a last sync so nothing entered there is lost, an archive download of its data, then the hub
   stops talking to it — no sync checks, pushes, Verify tab or import button. Its table in
   Supabase is left untouched as an archive.
   ===================================================================== */
const legacyRetired=()=>!!(db.legacy&&db.legacy.retired);
function retireLegacy(){
  const linked=db.tournaments.filter(t=>t.source&&t.source.kind==='mm-app');
  openDrawer({kicker:'Member-Member app',title:'Retire the current app',saveLabel:'Retire it',
    body:`<p style="margin:0">The hub takes over from <b>app.wcccmga.org</b> for good. This will:</p>
      <div class="mini">${[['1','Run one last sync, so anything entered in the current app reaches the hub'],['2','Download an archive copy of the current app’s data (its table in Supabase is also left as is)'],['3','Stop all syncing with it — no checks, no pushes; the Verify tab, sync chip and import buttons go away']].map(([n,t])=>`<div class="mr" style="grid-template-columns:24px minmax(0,1fr)"><b>${n}</b><span>${t}</span></div>`).join('')}</div>
      <p class="hint">${linked.length?`Linked tournament${linked.length===1?'':'s'}: ${linked.map(t=>esc(t.name)).join(', ')}.`:'No tournaments are linked to it.'} Then upload the forwarding page to app.wcccmga.org so old bookmarks land in the hub.</p>
      ${!CLOUD||!sessionOK?'<div class="banner">Sign in to the cloud first — the last sync needs it.</div>':''}`,
    save:()=>{ if(!CLOUD||!sessionOK){ toast('Sign in to the cloud first'); return false; }
      (async()=>{
        toast('Running the last sync…');
        for(const t of linked){ if(t.sync&&t.sync.off) continue; await syncTournament(t);
          const st=syncSt(t).state;
          if(st==='conflict'){ toast(`${t.name}: both versions changed — choose one, then retire again`); openSync(t); return; }
          if(st==='error'){ toast(`${t.name}: ${(syncSt(t).msg)||'couldn’t reach the current app'} — nothing retired`); return; } }
        try{ const st=await fetchMMState(); dl(JSON.stringify(st,null,2),'application/json',`member-member-app-archive-${new Date().toISOString().slice(0,10)}.json`); }
        catch(e){ toast('Couldn’t download the archive: '+e.message+' — nothing retired'); return; }
        db.legacy={retired:true,at:new Date().toISOString()}; linked.forEach(t=>{ t.sync={off:true}; });
        persist(); view.ttab=view.ttab==='verify'?'overview':view.ttab; render(); toast('Current app retired · archive downloaded');
      })(); }});
}

