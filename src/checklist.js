/* =====================================================================
   Checklist — per tournament. t.checklist = { sections:[{id,title,sub}], tasks:[{id,section,group,
   text,tag,memberId,notes,done,doneAt,doneBy}] }. Tasks are assigned to MGA members (board first).
   ===================================================================== */
TT.splice(TT.findIndex(x=>x[0]==='budget')+1,0,['checklist','Checklist']);
view.ckF='all'; view.ckWho=''; view.ckQ='';
const CK_MM2026=[
 ['Pre-event','Complete by Wed 30 Sep',[
  ['Printing',[['Calcutta rules proofed and printed — 130 copies'],['Par 3 rules printed — 60 copies'],['Schedule of Events printed — 135 copies'],['Calcutta spreadsheet of bought teams to Dan Cavallo','FIX'],['Friday-night Zelle collection sheet for Calcutta'],['Closest to the Pin list to the Pro Shop — Fri, Sat and Sun','FIX']]],
  ['Signage',[['All signs and banners complete; tee-box placement list written'],['Signage inventory finalized and placement decided for every sign, banner and flag','FIX'],['Signage package to Paul by Thursday 1 Oct','FIX'],['Hole signs and 10′×8′ sponsor board received and checked against the sponsor list','NEW']]],
  ['Close out before the weekend',[['F&B pricing confirmed with Haley (WCCC) — close in Open Decisions','NEW'],['50/50 handling and carry-forward confirmed with Dan C.','NEW'],['Final golfer count (150) and Saturday headcount (225) confirmed with the club','NEW'],['Pro Shop Spree vendor confirmations and placement confirmed with Reese','FIX'],['Hole-in-one gift confirmed in effect Fri–Sun','NEW'],['Player gifts received and counted — sunglasses, towel, custom coin','NEW'],['Long-drive simulator, net and mat booked for Friday setup','NEW'],['Board speech honoring all sponsors drafted for Saturday dinner','NEW']]]]],
 ['Thursday 1 October','Set-up day',[
  ['',[['Finalize flights and pairings'],['Banner and pop-up board placements marked','FIX'],['F&B walk-through with the club for changes'],['GUR marked on both courses'],['Bank run — cash for Calcutta, plus change boxes for 50/50, chipping and long drive','FIX'],['Signs, banners and flags delivered to Paul','FIX'],['IV station and Stretch Lab arrival times confirmed for Sat and Sun','NEW'],['Brad Thompson acoustic set and Saturday band load-in confirmed','NEW']]]]],
 ['Friday 2 October','Day 1 · Par 3 + Calcutta',[
  ['Morning set-up',[['Beverage cart signs installed'],['Banners, flags and tee-box signs installed'],['F&B and frozen margarita machine checked'],['Water and Gatorade coolers verified on course'],['Closest to the Pin signs ready','FIX'],['Pecan marked for the 9-hole Par 3 contest; flights set','FIX'],['Chipping contest set on the practice chipping area by the cocktail hour space — net, signage, cash box','NEW'],['Long-drive simulator, net and mat set next to the chipping contest','NEW'],['Calcutta slide order checked'],['All audio/visual for the Calcutta preflighted'],['Ballroom set for sign-up and Pro Shop'],['Member-Member pairings and tee times verified']]],
  ['Registration & Pro Shop · 12:00 – 3:00 pm',[['Registration table staffed; packets and handouts out'],['Par 3 registration table run — player gifts (sunglasses, towel, custom coin) picked up here','FIX'],['Pro Shop open in person; online orders staged for pickup','NEW']]],
  ['Par 3 contest — 9 holes, flighted · 3:30 – 5:30 pm',[['Par 3 rules distributed; contest run and scored by flight','FIX'],['Hole-in-one gift in effect — witness assigned','NEW']]],
  ['Side contests — during cocktail hour · 5:00 – 7:00 pm',[['Chipping contest run — $20 a turn, 3 turns max, cash only','NEW'],['Long-drive contest run on the simulator — $20 for two drives, 3 turns max','NEW'],['Both cash boxes reconciled at close','NEW']]],
  ['Hors d’oeuvres & cocktail hour · 5:00 – 7:00 pm',[['Two bars set outside by the putting green','NEW'],['Brad Thompson acoustic show — sound check by 4:30','NEW']]],
  ['Calcutta & dinner · 7:00 – 10:00 pm',[['Hot dog and hamburger service running'],['Auctioneer briefed; slides run'],['Money collected and results recorded','NEW'],['Friday 50/50 drawing run — proceeds back to the membership'],['Coordinate with the Pro Shop for changes']]]]],
 ['Saturday 3 October','Day 2 · Round 1',[
  ['Registration & breakfast · 7:00 – 9:00 am',[['Banners, flags and tee-box signs installed'],['Lobby tables set'],['Registration and handouts run'],['Breakfast buffet set; Martha’s window open','NEW'],['Bloody Mary bar set up correctly'],['IV station set up — runs until 5:00 pm','NEW'],['Stretch Lab set up on the driving range for pre-round stretching','NEW'],['Water and Gatorade coolers verified'],['Pairings posted on tee boxes on time'],['Closest to the Pin signs on the correct holes','FIX']]],
  ['Golf · 9:00 am – 2:00 pm',[['On-course food stocked — sausage wraps and hot dogs at Oak 12 and Pecan 10','NEW'],['Kegs stocked on both courses','NEW'],['Beverage carts running both courses']]],
  ['Afternoon & evening',[['Day 1 scoring completed'],['Closest to the Pin cards collected; winners figured'],['Ballroom set — tablecloths and centerpieces','NEW'],['Band load-in and sound check','NEW'],['Board speech honoring all sponsors — delivered before the concert','NEW'],['Dinner served as contracted'],['Saturday 50/50 drawing run — open to everyone who played 50/50 during the year','NEW'],['Open bar supervised and behavior kept in line'],['Flags and banners pulled for the night']]]]],
 ['Sunday 4 October','Day 3 · Round 2 + awards',[
  ['Registration & breakfast · 7:00 – 9:00 am',[['Banners, flags and tee-box signs installed'],['Score cards handed out'],['Bloody Mary bar set up correctly'],['Martha’s window open; golfers checked off the list as they come through','FIX'],['Martha paid per head once the count is closed','NEW'],['IV station set up','NEW'],['Stretch Lab set up on the driving range for pre-round stretching','NEW'],['Water and Gatorade coolers verified'],['Pairings on tee boxes on time'],['Closest to the Pin signs on the correct holes','FIX']]],
  ['Golf · 9:30 am – 2:00 pm',[['On-course food at Oak 12 and Pecan 10; kegs stocked','NEW']]],
  ['Lunch & scoring · 2:00 – 3:00 pm',[['Fajita lunch served; keg set in the ballroom','NEW'],['Final scoring with Pro Shop staff and Board'],['Closest to the Pin signs collected; winners figured']]],
  ['Flight shootout & awards · 3:00 pm – TBD',[['Flight Shootout run — holes 4, 5 and 6','FIX'],['Calcutta and tournament winners announced'],['Calcutta payout settlements made in the ballroom','NEW'],['All flags, banners and tee signs removed and inventoried for storage'],['Sponsor board taken down and stored','NEW'],['All cash boxes reconciled and returned']]]]]
];
function ckData(t){ if(!t.checklist) t.checklist={sections:[],tasks:[]}; const k=t.checklist; k.sections=k.sections||[]; k.tasks=k.tasks||[]; return k; }
function ckFromTemplate(tpl){ const sections=[], tasks=[];
  tpl.forEach(([title,sub,groups])=>{ const sid=uid(); sections.push({id:sid,title,sub});
    groups.forEach(([g,items])=>items.forEach(([text,tag])=>tasks.push({id:uid(),section:sid,group:g,text,tag:tag||'',memberId:'',notes:'',done:false}))); });
  return {sections,tasks}; }
const boardRoles=id=>db.board.filter(b=>b.memberId===id).map(b=>b.role);
const ckWho=id=>{ const m=memberById(id); return m?tidyName(memberName(m)):''; };
/* type-ahead for assignees: board members first, then everyone */
function ckMatches(q){ const base=memberMatches({field:[]},q,30);
  return base.map(h=>({...h,board:boardRoles(h.m.id)})).sort((a,b)=>(b.board.length?1:0)-(a.board.length?1:0)||b.sc-a.sc).slice(0,7); }
function ckPicker(r,initialId){ // wires #ckA input + #ckAList; returns ()=>memberId
  let linked=initialId||'', hits=[], cur=0; const inp=r.querySelector('#ckA'), list=r.querySelector('#ckAList'), who=r.querySelector('#ckAWho');
  const show=()=>{ who.innerHTML=linked?`Assigned to <b>${esc(ckWho(linked))}</b>${boardRoles(linked).length?' · '+esc(boardRoles(linked).join(', ')):''}`:(inp.value.trim()?'<span class="neg">No member matches — pick from the list</span>':'Unassigned'); };
  const close=()=>{ list.style.display='none'; };
  const pick=h=>{ linked=h.m.id; inp.value=h.name; close(); show(); };
  const draw=()=>{ const q=inp.value.trim(); hits=q?ckMatches(q):db.board.filter(b=>b.memberId).map(b=>({m:memberById(b.memberId),name:ckWho(b.memberId),board:boardRoles(b.memberId)})).filter((h,i,a)=>h.m&&a.findIndex(x=>x.m.id===h.m.id)===i); cur=0;
    if(!hits.length){ close(); return; }
    list.innerHTML=(q?'':'<div class="muted" style="padding:6px 12px;font-size:11.5px;font-weight:700;letter-spacing:.06em">BOARD</div>')+hits.map((h,k)=>`<div data-k="${k}" style="padding:9px 12px;cursor:pointer;display:flex;justify-content:space-between;gap:10px;${k===cur?'background:#F6ECCF':''}"><span>${esc(h.name)}</span><span class="muted" style="font-size:12px">${esc(h.board.join(', '))}</span></div>`).join('');
    list.style.display='block'; list.querySelectorAll('[data-k]').forEach(d=>d.onmousedown=e=>{ e.preventDefault(); pick(hits[+d.dataset.k]); }); };
  inp.oninput=()=>{ linked=''; draw(); show(); }; inp.onfocus=()=>{ if(!inp.value.trim()) draw(); };
  inp.onkeydown=e=>{ if(list.style.display==='none') return; if(e.key==='ArrowDown'||e.key==='ArrowUp'){ cur=(cur+(e.key==='ArrowDown'?1:-1)+hits.length)%hits.length; list.querySelectorAll('[data-k]').forEach((d,k)=>d.style.background=k===cur?'#F6ECCF':''); e.preventDefault(); }
    else if(e.key==='Enter'||e.key==='Tab'){ if(hits[cur]){ pick(hits[cur]); if(e.key==='Enter') e.preventDefault(); } } else if(e.key==='Escape'){ close(); e.stopPropagation(); } };
  inp.onblur=()=>setTimeout(close,120); show();
  return ()=>linked;
}
const pickerHTML=(id)=>`<div class="fld" style="position:relative"><label class="lbl" for="ckA">Assigned to</label><input class="inp" id="ckA" value="${esc(id?ckWho(id):'')}" placeholder="Type a name — board members come first" autocomplete="off">
  <div id="ckAList" class="card" style="position:absolute;left:0;right:0;top:100%;margin-top:4px;z-index:5;overflow:hidden;display:none;box-shadow:0 12px 30px rgba(10,28,39,.18)"></div><span class="hint" id="ckAWho"></span></div>`;
function editTask(t,task,sectionId,group){
  const k=ckData(t), isNew=!task; task=task||{id:uid(),section:sectionId||(k.sections[0]||{}).id,group:group||'',text:'',tag:'',memberId:'',notes:'',done:false};
  const groups=sid=>[...new Set(k.tasks.filter(x=>x.section===sid).map(x=>x.group))];
  let getWho;
  openDrawer({kicker:`${t.name} · Checklist`,title:isNew?'Add task':'Task',
    body:field('Task','ckT',task.text,{type:'textarea'})+pickerHTML(task.memberId)+
      field('Notes','ckN',task.notes||'',{type:'textarea'})+
      pair(field('Day / section','ckS',task.section,{type:'select',options:k.sections.map(s=>[s.id,s.title])}),field('Group','ckG',task.group||'',{ph:'e.g. Morning set-up'}))+
      `<label class="check"><input type="checkbox" id="ckD"${task.done?' checked':''}> Done${task.done&&task.doneAt?` <span class="muted">· ${new Date(task.doneAt).toLocaleString([], {month:'short',day:'numeric',hour:'numeric',minute:'2-digit'})}${task.doneBy?' by '+esc(ckWho(task.doneBy)||task.doneBy):''}</span>`:''}</label>`+
      (task.tag?`<p class="hint">Marked <b>${esc(task.tag)}</b> on the original checklist (${task.tag==='NEW'?'new this year':'corrected'}).</p>`:''),
    wire:r=>{ getWho=ckPicker(r,task.memberId); const ta=r.querySelector('#ckT'); ta.rows=2; r.querySelector('#ckN').rows=4; if(isNew) setTimeout(()=>ta.focus(),60); },
    save:()=>{ const text=fv('ckT'); if(!text){ toast('Describe the task'); return false; }
      const nowDone=$('ckD').checked;
      Object.assign(task,{text,memberId:getWho(),notes:fv('ckN'),section:fv('ckS'),group:fv('ckG'),done:nowDone,doneAt:nowDone?(task.done?task.doneAt:new Date().toISOString()):'',doneBy:nowDone?(task.done?task.doneBy:''):''});
      if(isNew){ const i=k.tasks.map(x=>x.section===task.section&&x.group===task.group).lastIndexOf(true); if(i>=0) k.tasks.splice(i+1,0,task); else k.tasks.push(task); } },
    del:isNew?null:()=>{ k.tasks=k.tasks.filter(x=>x!==task); },delLabel:'Delete task'});
}
function editSection(t,s){
  const k=ckData(t), isNew=!s; s=s||{id:uid(),title:'',sub:''};
  openDrawer({kicker:`${t.name} · Checklist`,title:isNew?'Add day or section':'Section',
    body:field('Title','csT',s.title,{ph:'e.g. Friday 2 October'})+field('Subtitle','csS',s.sub||'',{ph:'e.g. Day 1 · Par 3 + Calcutta'}),
    save:()=>{ const ti=fv('csT'); if(!ti){ toast('Give it a title'); return false; } Object.assign(s,{title:ti,sub:fv('csS')}); if(isNew) k.sections.push(s); },
    del:isNew?null:()=>{ const n=k.tasks.filter(x=>x.section===s.id).length; if(n&&!confirm(`Delete “${s.title}” and its ${n} task${n===1?'':'s'}?`)) return false; k.sections=k.sections.filter(x=>x!==s); k.tasks=k.tasks.filter(x=>x.section!==s.id); },delLabel:'Delete section'});
}
function startChecklist(t){
  const others=db.tournaments.filter(x=>x!==t&&x.checklist&&x.checklist.tasks&&x.checklist.tasks.length);
  openDrawer({kicker:`${t.name} · Checklist`,title:'Start a checklist',saveLabel:'Create checklist',
    body:field('Start from','ckFrom','mm2026',{type:'select',options:[['mm2026','2026 Member-Member weekend checklist (from Frosty’s copy)']].concat(others.map(x=>[x.id,`Copy ${x.name} (${x.checklist.tasks.length} tasks)`])).concat([['blank','A blank checklist']])})+
      '<p class="hint">Copies come in with every task open and unassigned; notes are left behind.</p>',
    save:()=>{ const v=fv('ckFrom');
      if(v==='mm2026') t.checklist=ckFromTemplate(CK_MM2026);
      else if(v==='blank') t.checklist={sections:[{id:uid(),title:'Before the event',sub:''}],tasks:[]};
      else { const src=db.tournaments.find(x=>x.id===v).checklist, map={}; const sections=src.sections.map(s=>{ const id=uid(); map[s.id]=id; return {...s,id}; });
        t.checklist={sections,tasks:src.tasks.map(x=>({id:uid(),section:map[x.section],group:x.group,text:x.text,tag:'',memberId:'',notes:'',done:false}))}; }
      toast(`${t.checklist.tasks.length} tasks ready`); }});
}
function ckMatch(task){ const f=view.ckF, q=view.ckQ.trim().toLowerCase();
  if(f==='open'&&task.done) return false; if(f==='done'&&!task.done) return false; if(f==='unassigned'&&task.memberId) return false;
  if(view.ckWho&&task.memberId!==view.ckWho) return false;
  if(q&&!(task.text.toLowerCase().includes(q)||(task.notes||'').toLowerCase().includes(q)||ckWho(task.memberId).toLowerCase().includes(q))) return false; return true; }
function tChecklist(el,t){
  const k=t.checklist;
  if(!k||!(k.tasks&&k.tasks.length)&&!(k.sections&&k.sections.length)){
    el.innerHTML=`<div class="card"><div class="empty"><b>No checklist yet</b><span>Start from the 2026 Member-Member weekend checklist, copy another tournament’s, or build one from scratch. Assign each task to a member and keep notes as you go.</span><button class="btn pri" id="ckStart">${I.plus}Start a checklist</button></div></div>`;
    $('ckStart').onclick=()=>startChecklist(t); return; }
  const all=k.tasks, done=all.filter(x=>x.done).length, pct=all.length?Math.round(done/all.length*100):0;
  const people=[...new Set(all.map(x=>x.memberId).filter(Boolean))].map(id=>({id,name:ckWho(id),n:all.filter(x=>x.memberId===id).length,d:all.filter(x=>x.memberId===id&&x.done).length})).sort((a,b)=>a.name.localeCompare(b.name));
  const unassigned=all.filter(x=>!x.memberId).length;
  el.innerHTML=`<div class="card pad" style="display:flex;gap:14px 26px;align-items:center;flex-wrap:wrap">
      <div style="flex:1 1 260px"><div style="display:flex;justify-content:space-between;align-items:baseline"><b style="font-size:17px">${done} of ${all.length} done</b><span class="muted num">${pct}%</span></div>
        <div style="height:8px;border-radius:999px;background:#EEE8DA;margin-top:8px;overflow:hidden"><div style="height:100%;width:${pct}%;background:var(--pos,#1F6B4A)"></div></div>
        <small class="muted">${people.length} people assigned · ${unassigned} task${unassigned===1?'':'s'} unassigned</small></div>
      <div class="actions"><button class="btn" id="ckPrint">Print</button><button class="btn" id="ckAddS">${I.plus}Day or section</button><button class="btn pri" id="ckAdd">${I.plus}Task</button></div></div>
    <div class="toolbar" style="flex-wrap:wrap;gap:10px"><div class="seg">${[['all','All'],['open','Open'],['done','Done'],['unassigned','Unassigned']].map(([v,l])=>`<button class="${view.ckF===v?'on':''}" data-ckf="${v}">${l}</button>`).join('')}</div>
      <select class="inp" id="ckWhoSel" style="width:auto;min-width:200px;height:38px" aria-label="Show tasks for"><option value="">Everyone</option>${people.map(p=>`<option value="${p.id}"${view.ckWho===p.id?' selected':''}>${esc(p.name)} · ${p.d}/${p.n}</option>`).join('')}</select>
      <input class="inp" id="ckQ" placeholder="Search tasks and notes" value="${esc(view.ckQ)}" style="flex:1 1 200px;height:38px" autocomplete="off"></div>
    ${k.sections.map(s=>{ const ts=all.filter(x=>x.section===s.id), vis=ts.filter(ckMatch); const sd=ts.filter(x=>x.done).length;
      if(!vis.length&&(view.ckF!=='all'||view.ckWho||view.ckQ)) return '';
      const groups=[...new Set(ts.map(x=>x.group))];
      return `<div class="card ck-sec" style="overflow:hidden"><div class="cardhead"><div><h2 class="h2">${esc(s.title)}</h2><span class="muted">${esc(s.sub||'')}${s.sub?' · ':''}${sd} of ${ts.length} done</span></div><div class="actions"><button class="btn sm" data-cks="${s.id}">${I.edit}</button><button class="btn sm" data-ckadd="${s.id}">${I.plus}Task</button></div></div>
        ${groups.map(g=>{ const gt=vis.filter(x=>x.group===g); if(!gt.length) return ''; return `${g?`<div class="ck-g">${esc(g)}</div>`:''}${gt.map(x=>`<div class="ck-row${x.done?' done':''}" data-ckt="${x.id}">
          <label class="ck-box" aria-label="Done"><input type="checkbox" data-ckdone="${x.id}"${x.done?' checked':''}></label>
          <div class="ck-main"><span class="ck-text">${esc(x.text)}${x.tag?` <span class="chip ${x.tag==='NEW'?'gold':''}" style="font-size:10.5px;padding:1px 7px">${esc(x.tag)}</span>`:''}</span>${x.notes?`<span class="ck-note">${esc(x.notes)}</span>`:''}</div>
          <span class="ck-who">${x.memberId?`<span class="av" style="width:24px;height:24px;font-size:10px">${initials(memberById(x.memberId))}</span><span class="trunc">${esc(ckWho(x.memberId))}</span>`:'<span class="muted">Assign</span>'}</span></div>`).join('')}`; }).join('')}
      </div>`; }).join('')||'<div class="card"><div class="empty"><span>No tasks match.</span></div></div>'}`;
  $('ckAdd').onclick=()=>editTask(t,null,(k.sections[0]||{}).id,''); $('ckAddS').onclick=()=>editSection(t,null); $('ckPrint').onclick=()=>printChecklist(t);
  el.querySelectorAll('[data-ckf]').forEach(b=>b.onclick=()=>{ view.ckF=b.dataset.ckf; render(); });
  $('ckWhoSel').onchange=e=>{ view.ckWho=e.target.value; render(); };
  $('ckQ').oninput=e=>{ view.ckQ=e.target.value; clearTimeout(window.__ckq); window.__ckq=setTimeout(()=>{ render(); const i=$('ckQ'); if(i){ i.focus(); i.setSelectionRange(view.ckQ.length,view.ckQ.length); } },250); };
  el.querySelectorAll('[data-cks]').forEach(b=>b.onclick=()=>editSection(t,k.sections.find(s=>s.id===b.dataset.cks)));
  el.querySelectorAll('[data-ckadd]').forEach(b=>b.onclick=()=>editTask(t,null,b.dataset.ckadd,''));
  el.querySelectorAll('[data-ckdone]').forEach(cb=>{ cb.onclick=e=>e.stopPropagation(); cb.onchange=()=>{ const x=all.find(z=>z.id===cb.dataset.ckdone); x.done=cb.checked; x.doneAt=cb.checked?new Date().toISOString():''; x.doneBy=''; persist(); render(); }; });
  el.querySelectorAll('[data-ckt]').forEach(r=>r.onclick=e=>{ if(e.target.closest('.ck-box')) return; editTask(t,all.find(x=>x.id===r.dataset.ckt)); });
}
function printChecklist(t){
  const k=ckData(t), people=[...new Set(k.tasks.map(x=>x.memberId).filter(Boolean))].map(id=>[id,ckWho(id)]).sort((a,b)=>a[1].localeCompare(b[1]));
  openDrawer({kicker:`${t.name} · Checklist`,title:'Print checklist',saveLabel:'Open print preview',
    body:field('Whose tasks','cpW','',{type:'select',options:[['','Everyone — the full checklist']].concat(people.map(([id,n])=>[id,n+' only']))})+`<label class="check"><input type="checkbox" id="cpN" checked> Include notes</label><label class="check"><input type="checkbox" id="cpD"> Leave out tasks already done</label>`,
    save:()=>{ const who=fv('cpW'), notes=$('cpN').checked, hideDone=$('cpD').checked;
      const html=`<!doctype html><html><head><meta charset="utf-8"><title>${esc(t.name)} · Checklist</title><style>
        @page{size:letter;margin:.5in} body{font-family:'Public Sans',Arial,sans-serif;color:#14222B;font-size:10.5pt;margin:0}
        h1{font-family:Georgia,serif;font-size:22pt;margin:0;color:#0F2A38} .sub{color:#56626A;font-size:9.5pt;margin:2px 0 14px}
        h2{font-family:Georgia,serif;font-size:14pt;margin:16px 0 0;padding:6px 10px;background:#0F2A38;color:#fff;break-after:avoid} h2 small{font-family:Arial,sans-serif;font-size:8.5pt;color:#D8B75F;margin-left:8px;letter-spacing:.05em;text-transform:uppercase}
        h3{font-size:8.5pt;letter-spacing:.08em;text-transform:uppercase;color:#7E5F1A;margin:8px 0 2px;break-after:avoid}
        table{width:100%;border-collapse:collapse} td{border-bottom:1px solid #D9D2C0;padding:5px 6px;vertical-align:top} tr{break-inside:avoid}
        td.b{width:18px} .box{display:inline-block;width:11px;height:11px;border:1.4px solid #14222B;border-radius:2px;text-align:center;line-height:11px;font-size:9px}
        td.w{width:1.7in;color:#14222B;font-weight:600;border-left:1px solid #D9D2C0} .n{display:block;color:#56626A;font-size:9pt;margin-top:2px} .tag{font-size:7.5pt;font-weight:700;color:#7E5F1A;margin-left:4px} .done td{color:#8B95A0} .done .t{text-decoration:line-through}
      </style></head><body><h1>${esc(t.name)} · Checklist</h1><div class="sub">${who?'Tasks for '+esc(ckWho(who)):'Full checklist'} · printed ${new Date().toLocaleDateString('en-US',{month:'short',day:'numeric',year:'numeric'})}</div>
      ${k.sections.map(s=>{ const ts=k.tasks.filter(x=>x.section===s.id&&(!who||x.memberId===who)&&(!hideDone||!x.done)); if(!ts.length) return '';
        const gs=[...new Set(ts.map(x=>x.group))];
        return `<h2>${esc(s.title)}<small>${esc(s.sub||'')}</small></h2>${gs.map(g=>`${g?`<h3>${esc(g)}</h3>`:''}<table>${ts.filter(x=>x.group===g).map(x=>`<tr class="${x.done?'done':''}"><td class="b"><span class="box">${x.done?'✓':''}</span></td><td><span class="t">${esc(x.text)}</span>${x.tag?`<span class="tag">${esc(x.tag)}</span>`:''}${notes&&x.notes?`<span class="n">${esc(x.notes)}</span>`:''}</td><td class="w">${esc(ckWho(x.memberId))}</td></tr>`).join('')}</table>`).join('')}`; }).join('')}
      <script>setTimeout(()=>print(),300)<\/script></body></html>`;
      const w=window.open(URL.createObjectURL(new Blob([html],{type:'text/html'})),'_blank'); if(!w){ toast('Allow pop-ups to print'); return false; } }});
}

