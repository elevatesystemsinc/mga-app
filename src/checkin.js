/* =====================================================================
   Check-in — per tournament, per player. Lives on each field entry as p.checkin = {at} (absent = not yet).
   A private registration link lets the person at the table check players in without the board login;
   it reuses the cashier-link storage (row id = tournament id + ':checkin') and RPCs.
   ===================================================================== */
TT.splice(TT.findIndex(x=>x[0]==='field')+1,0,['checkin','Check-in']);
view.ckiQ=''; view.ckiF='all';
function ckPlayers(t){
  const par3q=(t.fieldQuestions||[]).find(q=>q.kind==='par3');
  const rows=(t.field||[]).map(p=>{ const m=memberById(p.memberId); const full=tidyName(m?memberName(m):(p.name||'')); const parts=full.split(' ');
    return {p,id:p.id,first:m&&m.first?tidyName(m.first):parts.slice(0,-1).join(' '),last:m&&m.last?tidyName(m.last):parts.slice(-1)[0]||'',team:p.team,par3:!!(par3q&&String((p.answers||{})[par3q.key]||'').toLowerCase().startsWith('y'))}; });
  // the hub's member records sometimes have first/last swapped (e.g. "andy, sauter"); keep display sane
  rows.forEach(r=>{ if(r.last.toLowerCase()==='andy'&&r.first.toLowerCase()==='sauter'){ r.last='Sauter'; r.first='Andy'; } });
  const byTeam=new Map(); rows.forEach(r=>{ const a=byTeam.get(r.team)||[]; a.push(r); byTeam.set(r.team,a); });
  rows.forEach(r=>{ const mate=(byTeam.get(r.team)||[]).find(x=>x!==r); r.partner=mate?`${mate.first} ${mate.last}`:''; r.mate=mate; });
  return rows.sort((a,b)=>a.last.localeCompare(b.last)||a.first.localeCompare(b.first));
}
/* search: a player's own name first; partners only if no one matches by name; a number is a team */
function ckFilter(rows,q,get){ q=String(q||'').trim().toLowerCase().replace(/^#/,''); if(!q) return rows;
  if(/^\d+$/.test(q)) return rows.filter(r=>String(get(r).team)===q);
  const words=q.replace(/,/g,' ').split(/\s+/).filter(Boolean);
  const own=rows.filter(r=>{ const x=get(r), h=`${x.first} ${x.last}`.toLowerCase(); return words.every(w=>h.includes(w)); });
  return own.length?own:rows.filter(r=>{ const x=get(r), h=`${x.first} ${x.last} ${x.partner}`.toLowerCase(); return words.every(w=>h.includes(w)); }); }
const ckTime=iso=>iso?new Date(iso).toLocaleTimeString([], {hour:'numeric',minute:'2-digit'}):'';
function tCheckin(el,t){
  if(!(t.field||[]).length){ el.innerHTML=`<div class="card"><div class="empty"><b>No players yet</b><span>Import the Golf Genius roster on the Field tab first — every player in the field shows up here for check-in.</span></div></div>`; return; }
  const rows=ckPlayers(t), q=view.ckiQ, f=view.ckiF;
  const inn=rows.filter(r=>r.p.checkin).length, teams=new Map(); rows.forEach(r=>{ const a=teams.get(r.team)||[0,0]; a[0]++; if(r.p.checkin) a[1]++; teams.set(r.team,a); });
  const done=[...teams.values()].filter(([a,b])=>a===b).length;
  const vis=ckFilter(rows,q,r=>r).filter(r=>f==='all'||(f==='open'?!r.p.checkin:f==='in'?!!r.p.checkin:r.par3));
  let letter='', list='';
  for(const r of vis){ const L=(r.last[0]||'#').toUpperCase(); if(L!==letter&&!q){ letter=L; list+=`<div class="ck-letter">${esc(L)}</div>`; }
    list+=`<div class="ci-row${r.p.checkin?' in':''}"><div class="ci-who"><b>${esc(r.last)},</b> ${esc(r.first)}<small>with ${esc(r.partner)} · Team ${esc(r.team)}${r.par3?' · <span class="ci-p3">Par 3</span>':''}${r.mate&&r.mate.p.checkin?' · partner here':''}</small></div>
      <button class="btn ${r.p.checkin?'ci-done':'pri'}" data-ci="${r.id}">${r.p.checkin?`✓ ${ckTime(r.p.checkin.at)}`:'Check in'}</button></div>`; }
  el.innerHTML=`<div class="grid g4">${kpi('Checked in',`${inn} / ${rows.length}`,`${Math.round(inn/rows.length*100)}%`)}${kpi('Still to arrive',rows.length-inn,'players')}${kpi('Teams complete',`${done} / ${teams.size}`,'both players here')}${kpi('Par 3',rows.filter(r=>r.par3&&r.p.checkin).length+' / '+rows.filter(r=>r.par3).length,'checked in')}</div>
    ${ckLinkCard(t)}
    <div class="card" style="overflow:hidden"><div class="cardhead" style="flex-wrap:wrap;gap:10px"><input class="inp ci-search" id="ciQ" type="search" placeholder="Search a name, partner or team #" value="${esc(q)}" autocomplete="off" aria-label="Search players">
      <div class="seg">${[['all','All'],['open','Not yet'],['in','Checked in'],['par3','Par 3']].map(([k,l])=>`<button class="${f===k?'on':''}" data-cif="${k}">${l}</button>`).join('')}</div></div>
      <div>${list||`<div class="empty" style="padding:22px"><span>No players match${q?` “${esc(q)}”`:''}.</span></div>`}</div></div>`;
  wireSearch('ciQ','ckiQ');
  el.querySelectorAll('[data-cif]').forEach(b=>b.onclick=()=>{ view.ckiF=b.dataset.cif; render(); });
  el.querySelectorAll('[data-ci]').forEach(b=>b.onclick=()=>{ const r=rows.find(x=>x.id===b.dataset.ci); if(!r) return;
    if(r.p.checkin){ if(!confirm(`Undo check-in for ${r.first} ${r.last}?`)) return; delete r.p.checkin; }
    else r.p.checkin={at:new Date().toISOString()};
    persist(); render(); });
  const sh=$('ciShare'); if(sh) sh.onclick=()=>startCheckinLink(t);
  const cp=$('ciCopy'); if(cp) cp.onclick=async()=>{ const l=checkinLink(t); try{ await navigator.clipboard.writeText(l); toast('Link copied'); }catch(_){ prompt('Copy this link:',l); } };
  const st=$('ciStop'); if(st) st.onclick=()=>stopCheckinLink(t);
}
/* ---------- registration link ---------- */
const CKI_ST={};
const checkinLink=t=>SITE_BASE+'checkin.html?k='+encodeURIComponent(t.checkinShare.token);
const ckBase={ get(t){ try{ return JSON.parse(localStorage.getItem('mga_ckibase_'+t.id)||'null'); }catch(_){ return null; } }, set(t,doc){ try{ localStorage.setItem('mga_ckibase_'+t.id,JSON.stringify(doc)); }catch(_){} } };
function ckDocFromField(t){ const prev=ckBase.get(t), um=new Map(((prev&&prev.players)||[]).map(p=>[p.id,p]));
  const doc={name:t.name,players:ckPlayers(t).map(r=>{ const o={id:r.id,last:r.last,first:r.first,partner:r.partner,team:r.team,par3:r.par3,in:!!r.p.checkin,at:r.p.checkin?r.p.checkin.at:''}; const b=um.get(r.id); if(b&&b.u) o.u=b.u; return o; })};
  ckStamp(doc,prev); return doc; }
async function ckShareSync(t){
  const sh=t.checkinShare; if(!sh||!sh.token||!CLOUD||!sessionOK) return false;
  const token=sh.token;
  const get=async()=>{ const {data,error}=await sb.rpc('calcutta_get',{p_token:token}); if(error) throw new Error(error.message); if(!data) throw new Error('The registration link is off'); return data; };
  const put=async(doc,ver)=>{ const {data,error}=await sb.rpc('calcutta_put',{p_token:token,p_doc:doc,p_version:ver}); if(error) throw new Error(error.message); return data; };
  try{ const res=await ckSyncOnce(get,put,ckDocFromField(t)); ckBase.set(t,JSON.parse(JSON.stringify(res.doc)));
    let changed=false; const byId=new Map((t.field||[]).map(p=>[p.id,p]));
    for(const x of res.doc.players||[]){ const p=byId.get(x.id); if(!p) continue;
      if(x.in&&(!p.checkin||p.checkin.at!==x.at)){ p.checkin={at:x.at||new Date().toISOString()}; changed=true; }
      if(!x.in&&p.checkin){ delete p.checkin; changed=true; } }
    CKI_ST[t.id]={state:'live',at:new Date().toISOString()}; return changed;
  }catch(e){ CKI_ST[t.id]={state:'error',msg:e.message}; return false; }
}
let ckiBusy=false;
async function ckShareAll(){ if(ckiBusy) return; const ts=db.tournaments.filter(t=>t.checkinShare&&t.checkinShare.token); if(!ts.length) return; ckiBusy=true; let ch=false;
  try{ for(const t of ts) ch=(await ckShareSync(t))||ch; } finally{ ckiBusy=false; }
  if(ch){ persist(); if(view.page==='tournament'&&view.ttab==='checkin') render(); } }
setInterval(()=>{ if(document.visibilityState==='visible'&&db.tournaments.some(t=>t.checkinShare&&t.checkinShare.token)) ckShareAll(); },3500);
const _ckAfter=window.afterPersist; window.afterPersist=function(){ if(typeof _ckAfter==='function') _ckAfter.apply(this,arguments); if(!ckiBusy&&db.tournaments.some(t=>t.checkinShare&&t.checkinShare.token)) setTimeout(ckShareAll,500); };
async function startCheckinLink(t){
  if(!CLOUD||!sessionOK){ toast('The registration link needs the cloud sign-in'); return; }
  const token=newToken(); const doc=ckDocFromField(t);
  const {error}=await shareRow(t.id+':checkin',token,t.name+' · Check-in',doc);
  if(error){ toast(/relation|does not exist/i.test(error.message)?'Run calcutta-setup.sql in Supabase to turn on shared links':'Couldn’t create the link: '+error.message); return; }
  t.checkinShare={token,created:new Date().toISOString()}; ckBase.set(t,doc); CKI_ST[t.id]={state:'live',at:new Date().toISOString()}; persist(); render(); toast('Registration link ready'); }
function stopCheckinLink(t){
  openDrawer({kicker:t.name+' · Check-in',title:'Turn off the registration link?',saveLabel:'Turn it off',
    body:'<p style="margin:0">Anyone with the link loses access right away. Every check-in stays in the hub.</p>',
    save:()=>{ (async()=>{ await ckShareAll(); await shareRow(t.id+':checkin',null,t.name+' · Check-in',null); delete t.checkinShare; persist(); render(); toast('Registration link turned off'); })(); }}); }
function ckLinkCard(t){
  if(!t.checkinShare) return `<div class="card pad" style="display:flex;gap:14px 24px;align-items:center;flex-wrap:wrap"><div class="cell2" style="flex:1 1 340px"><span class="lbl">Registration link</span><b>Let the registration table check players in from a phone or tablet</b><small class="muted">A private link — no board password. Check-ins there show up here within seconds, and yours show up for them.${!CLOUD||!sessionOK?' Needs the cloud sign-in.':''}</small></div><button class="btn pri" id="ciShare"${!CLOUD||!sessionOK?' disabled':''}>Create registration link</button></div>`;
  const s=CKI_ST[t.id]||{}, link=checkinLink(t);
  return `<div class="card pad" style="display:flex;gap:14px 24px;align-items:center;flex-wrap:wrap;border-color:${s.state==='error'?'#EBC2B3':'#BCD9C7'}"><div class="cell2" style="flex:1 1 340px;min-width:0"><span class="lbl">Registration link · ${s.state==='error'?'<span class="neg">problem</span>':'<span class="pos">● live</span>'}</span><a href="${esc(link)}" target="_blank" rel="noopener" class="trunc" style="font-weight:600">${esc(link)}</a><small class="muted">${s.state==='error'?esc(s.msg||''):'In sync'+(s.at?' · '+ckTime(s.at):'')} · anyone with this link can check players in.</small></div>
    <div class="actions"><button class="btn sm" id="ciCopy">Copy link</button><a class="btn sm" href="${esc(link)}" target="_blank" rel="noopener">Open</a><button class="btn sm" id="ciStop">Turn off</button></div></div>`; }

