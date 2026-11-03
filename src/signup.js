/* =====================================================================
   Player registration — a tournament's public sign-up page (register.html?k=TOKEN, signup-setup.sql).
   The board opens registration from the Field tab. A member finds their own name, adds their partners — or ticks
   "need help finding a partner" for an open spot — and enters; every spot is a person or a request for one.
   Entries land in signup_entries; the hub takes each one into the field as a team (the golf shop fills the open
   spots) and clears it. The page shows the tournament the way it runs: date, venue, schedule, entry fee, the
   format in words, the points table, the handicap allowance and the differential cap, places paid, the rule sheet.
   t.reg = {token, status:'open'|'closed', openedAt}; SG_ST (link status) and SG_SIG (what was last published)
   are device-local.
   ===================================================================== */
const SG_ST={}, SG_SIG={}, SG_AT={}, SG_BUSY={};
const sgCloud=()=>CLOUD&&(sessionOK||KEYMODE);
const signupLink=t=>SITE_BASE+'register.html?k='+encodeURIComponent((t.reg&&t.reg.token)||'');
const sgOrgName=()=>{ const o=curOrg(); return o?(o.name||o.short):''; };
/* who may enter: the organization's members (a club tournament: the directory), never the inactive */
function signupPool(){ const list=isClub()?persons():members(); return list.filter(m=>m.status!=='Inactive').map(m=>({id:m.id,name:memberName(m)})).sort((a,b)=>a.name.localeCompare(b.name)); }
function sgLines(s){ return String(s||'').split('\n').map(x=>x.trim()).filter(Boolean); }
/* the handicap allowance of a round in words */
function sgAllowText(r){ const fmts=r.format==='split'?[r.front,r.back]:[r.format||'stroke']; const parts=fmts.map(f=>{ const F=FORMATS[f]||FORMATS.stroke; const a=pctFor(r,allowKey(r,f)); const txt=Array.isArray(a)?a.map(x=>x+'%').join(' / ')+' of course handicap (by order of handicap)':a+'% of course handicap'; return fmts.length>1?F.label+': '+txt:txt; }); return parts.join(' · '); }
function sgRound(t,r){ const n=teamSizeOf(r), k=countOf(r), F=FORMATS[r.format]||FORMATS.stroke;
  const fmt=r.format==='teamstable'?'stableford':r.format, pts=POINT_FORMATS.includes(fmt)?PTS_ROWS.map(([key,label])=>[label,+pointsTable(r,fmt)[key]||0]):null;
  return {day:r.day,label:dayLabel(t,r.day),name:(r.name||'').trim(),format:formatSummary(r),scoring:r.scoring==='gross'?'gross':'net',unit:unitOf(r),teamSize:n,count:F.count?k:0,points:pts,allowance:sgAllowText(r),noPar3:!!r.noPar3}; }
/* what the public page gets: names only — no e-mail, GHIN, index or anything about who enters */
function signupPub(t){ const qs=(t.fieldQuestions||[]).map(q=>({key:q.key,label:q.label,short:q.short||qShort(q.label)}));
  const teams={}; t.field.forEach(p=>{ (teams[p.team||0]=teams[p.team||0]||[]).push(p); });
  const size=t.teamSize||1, rounds=(typeof tournamentRounds==='function'?tournamentRounds(t):[]).slice().sort((a,b)=>a.day-b.day);
  return {tid:t.id,name:t.name,org:orgShort(),orgName:sgOrgName(),club:CLUB&&CLUB.name||'',date:t.startDate||'',days:t.days||1,venue:t.venue||'',entryFee:n0(t.entryFee),skinsFee:n0(t.skinsFee),teamSize:size,
    schedule:[0,1,2].slice(0,t.days||1).map(di=>{ const d=(t.schedule||[]).find(s=>s.day===di)||{items:[]}; return {day:di,label:dayLabel(t,di),items:(d.items||[]).map(i=>({time:i.time||'',event:i.event||'',notes:i.notes||''}))}; }),
    notes:t.notes||'',rules:sgLines(t.rules),placesPaid:+t.placesPaid||0,payoutNote:t.payoutNote||'',hcpDiff:+t.hcpDiff||0,
    rounds:rounds.map(r=>sgRound(t,r)),qs,pool:signupPool(),taken:t.field.map(p=>p.memberId).filter(Boolean),
    teams:Object.keys(teams).map(Number).sort((a,b)=>a-b).map(n=>({n,names:teams[n].map(p=>{ const m=memberById(p.memberId)||personById(p.memberId); return m?memberName(m):(p.name||'Player'); }),open:Math.max(0,size-teams[n].length),shop:teams[n].some(p=>p.reg&&p.reg.need)})),
    brand:(typeof brandLogo==='function'&&brandLogo())||null,at:new Date().toISOString()}; }
async function pushSignup(t){ if(!t.reg||!sgCloud()) return false;
  const doc=signupPub(t), sig=JSON.stringify(Object.assign({},doc,{at:null,status:t.reg.status,token:t.reg.token}));
  const {error}=KEYMODE?await keyRPC('hub_key_signup',{p_tid:t.id,p_token:t.reg.token||null,p_status:t.reg.status,p_doc:doc})
    :await sb.from('signup_share').upsert(trow({tid:t.id,org:ORG_ID,token:t.reg.token||null,status:t.reg.status,doc,updated_at:doc.at}));
  SG_ST[t.id]=error?{state:'error',msg:error.message}:{state:'live',at:Date.now()}; if(!error) SG_SIG[t.id]=sig;
  if(error){ toast('Could not publish the registration page: '+error.message); return false; } return true; }
/* republish when the published copy would differ (the field changed, a rule was edited, a new build) */
function signupPublishIfChanged(t){ if(!t.reg||!sgCloud()||SG_BUSY[t.id]) return; const doc=signupPub(t), sig=JSON.stringify(Object.assign({},doc,{at:null,status:t.reg.status,token:t.reg.token})); if(sig===SG_SIG[t.id]) return; SG_SIG[t.id]=sig; pushSignup(t).then(()=>paintSignupCard(t)); }
async function dropSignupCloud(t){ if(!sgCloud()) return;
  if(KEYMODE){ await keyRPC('hub_key_signup',{p_tid:t.id,p_token:null,p_status:'closed',p_doc:null}); return; }
  await tq(sb.from('signup_entries').delete()).eq('tid',t.id); await tq(sb.from('signup_share').delete()).eq('tid',t.id); }
/* the entries the page has filed → teams in the field; each entry is cleared once it is in */
function absorbSignups(t,rows){ const qs=t.fieldQuestions||[], taken=new Set(t.field.map(p=>p.memberId)); let changed=false; const ids=[];
  rows.forEach(e=>{ const next=Math.max(0,...t.field.map(p=>p.team||0))+1; let any=false;
    (e.players||[]).forEach(pl=>{ if(!pl||!pl.memberId||taken.has(pl.memberId)) return; const m=memberById(pl.memberId)||personById(pl.memberId); if(!m) return;
      const answers={}; qs.forEach(q=>{ answers[q.key]=yes((((e.answers||{})[pl.memberId])||{})[q.key])?'Yes':'No'; });
      t.field.push({id:uid(),memberId:pl.memberId,team:next,paid:false,skins:false,answers,reg:{id:e.id,at:e.at||'',need:+e.need||0,note:e.note||''}}); taken.add(pl.memberId); any=true; });
    ids.push(e.id); if(any) changed=true; });
  return {changed,ids}; }
async function loadSignups(t){ if(!t.reg||!sgCloud()||SG_BUSY[t.id]) return; SG_BUSY[t.id]=true; SG_AT[t.id]=Date.now();
  try{ const r=KEYMODE?await keyRPC('hub_key_signup_entries',{p_tid:t.id,p_clear:null}):await tq(sb.from('signup_entries').select('*')).eq('tid',t.id);
    if(r.error){ SG_ST[t.id]={state:'error',msg:r.error.message}; return; }
    const rows=r.data||[]; if(!rows.length){ if(!SG_ST[t.id]||SG_ST[t.id].state!=='error') SG_ST[t.id]={state:'live',at:Date.now()}; return; }
    const {changed,ids}=absorbSignups(t,rows);
    if(changed){ persist(); await pushSignup(t); }
    if(KEYMODE) await keyRPC('hub_key_signup_entries',{p_tid:t.id,p_clear:ids}); else for(const id of ids) await tq(sb.from('signup_entries').delete()).eq('id',id);
    SG_ST[t.id]={state:'live',at:Date.now(),took:(SG_ST[t.id]&&SG_ST[t.id].took||0)+rows.length};
    if(changed&&view.page==='tournament'&&view.tid===t.id) render(); }
  finally{ SG_BUSY[t.id]=false; } }
/* called on every render of a tournament: keep the page current, take in new entries (10 s throttle) */
function signupSync(t){ if(!t||!t.reg) return; signupPublishIfChanged(t); if(t.reg.status==='open'&&Date.now()-(SG_AT[t.id]||0)>10000) loadSignups(t); }
/* the Field tab's card */
function signupCard(t){ const on=!!t.reg, s=SG_ST[t.id]||{}, cloud=sgCloud();
  const byTeam={}; t.field.forEach(p=>{ if(p.reg&&p.reg.need) byTeam[p.team||0]=+p.reg.need; }); const shop=Object.values(byTeam).reduce((a,b)=>a+b,0), fromLink=t.field.filter(p=>p.reg).length;
  if(!on) return `<div class="card pad" id="sgCard" style="display:flex;gap:14px 24px;align-items:center;flex-wrap:wrap"><div class="cell2" style="flex:1 1 340px"><span class="lbl">Player registration</span><b>Let ${isClub()?'members':orgShort()+' members'} enter themselves and their partners from a link</b><small class="muted">A page with the details, the format, the handicap rules, the payouts and the rule sheet. A player who needs a partner ticks a box and the golf shop pairs them. Entries land here as teams.${cloud?'':' Needs the cloud sign-in.'}</small></div><button class="btn pri" id="sgOpen"${cloud?'':' disabled'}>Open registration</button></div>`;
  const link=signupLink(t), closed=t.reg.status!=='open';
  return `<div class="card pad" id="sgCard" style="display:flex;gap:14px 24px;align-items:center;flex-wrap:wrap;border-color:${s.state==='error'?'#EBC2B3':closed?'var(--line)':'#BCD9C7'}"><div class="cell2" style="flex:1 1 340px;min-width:0"><span class="lbl">Player registration · ${s.state==='error'?'<span class="neg">problem</span>':closed?'closed':'<span class="pos">● open</span>'}</span><a href="${esc(link)}" target="_blank" rel="noopener" class="trunc" style="font-weight:600">${esc(link)}</a><small class="muted">${s.state==='error'?esc(s.msg||''):(closed?'The page shows the details but takes no more entries.':'Anyone with this link enters from the member list.')}${fromLink?` · ${fromLink} player${fromLink===1?'':'s'} entered from the link`:''}${shop?` · <b>${shop}</b> open spot${shop===1?'':'s'} for the golf shop to fill`:''}</small></div>
    <div class="actions"><button class="btn sm" id="sgCopy">Copy link</button><a class="btn sm" href="${esc(link)}" target="_blank" rel="noopener">Open</a><button class="btn sm" id="sgToggle">${closed?'Reopen':'Close registration'}</button><button class="btn sm" id="sgOff">Turn off</button></div></div>`; }
function paintSignupCard(t){ const el=$('sgCard'); if(!el||view.page!=='tournament'||view.tid!==t.id||view.ttab!=='field') return; const d=document.createElement('div'); d.innerHTML=signupCard(t); el.replaceWith(d.firstElementChild); wireSignupCard(t); }
function wireSignupCard(t){
  const op=$('sgOpen'); if(op) op.onclick=async()=>{ if(!sgCloud()){ toast('Registration needs the cloud sign-in'); return; } t.reg={token:newToken(),status:'open',openedAt:new Date().toISOString()}; if(t.status==='Planning') t.status='Open for signups'; persist(); const ok=await pushSignup(t); if(!ok){ delete t.reg; persist(); } render(); if(ok) toast('Registration is open — share the link'); };
  const cp=$('sgCopy'); if(cp) cp.onclick=async()=>{ const l=signupLink(t); try{ await navigator.clipboard.writeText(l); toast('Link copied'); }catch(_){ prompt('Copy this link:',l); } };
  const tg=$('sgToggle'); if(tg) tg.onclick=async()=>{ t.reg.status=t.reg.status==='open'?'closed':'open'; persist(); await pushSignup(t); render(); };
  const off=$('sgOff'); if(off) off.onclick=()=>openDrawer({kicker:t.name+' · Field',title:'Turn off the registration page?',saveLabel:'Turn it off',
    body:'<p class="hint">The link stops working and any entry not yet taken in is dropped. The field stays as it is. Opening registration again makes a new link.</p>',
    save:async()=>{ await loadSignups(t); await dropSignupCloud(t); delete t.reg; delete SG_SIG[t.id]; delete SG_ST[t.id]; persist(); toast('Registration page turned off'); }});
}
