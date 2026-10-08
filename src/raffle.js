/* =====================================================================
   50/50 Drawing — per tournament (t.raffle). Built to be verifiable:
   · tickets are tournament + ticket number (numbers restart each tournament)
   · players are identified by name (email/phone were often the seller's); the board confirms
     look-alike names before the list is locked
   · locking computes a SHA-256 fingerprint of the full ticket list; the list can't change after
   · each draw uses crypto.getRandomValues with rejection sampling (every eligible ticket equally likely),
     is saved the instant it's drawn, and records the random value, the eligible count and the winning ticket
   · once someone wins, all of their tickets leave the drum; voids need a reason and stay in the log
   ===================================================================== */
TT.splice(TT.findIndex(x=>x[0]==='calcutta')+1,0,['raffle','50/50 Drawing']);
const rfKey=(f,l)=>(String(f||'').trim()+' '+String(l||'').trim()).toLowerCase().replace(/\s+/g,' ');
function rfData(t){ return t.raffle; }
/* tickets are stored compactly: [tournamentIdx, ticketNo, nameIdx, rowNo] */
const tkLabel=(tour,no)=>String(no).startsWith('M')?`${tour} · manual ticket, row ${String(no).slice(1)}`:`${tour} · ticket #${no}`;
function rfTickets(R){ return R.tickets.map(([ti,no,ni,row])=>({tour:R.tours[ti],no,first:R.names[ni][0],last:R.names[ni][1],row,key:rfPlayerKey(R,R.names[ni])})); }
function rfPlayerKey(R,[f,l]){ let k=rfKey(f,l); const seen=new Set(); while(R.merges&&R.merges[k]&&!seen.has(k)){ seen.add(k); k=R.merges[k]; } return k; }
function rfPlayerName(R,key){ const n=R.names.find(n=>rfKey(n[0],n[1])===key); return n?`${n[0]} ${n[1]}`:key; }
function rfCanon(R){ return rfTickets(R).map(x=>`${x.tour}|${x.no}|${x.first}|${x.last}|${x.row}`).sort().join('\n'); }
async function rfFingerprint(R){ const buf=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(rfCanon(R)+'\n#merges:'+JSON.stringify(Object.entries(R.merges||{}).sort())));
  return [...new Uint8Array(buf)].map(b=>b.toString(16).padStart(2,'0')).join('').toUpperCase(); }
const fpShort=fp=>fp?fp.slice(0,4)+' '+fp.slice(4,8)+' '+fp.slice(8,12)+' '+fp.slice(12,16):'';
/* look-alike names the board must rule on before locking */
function rfSuspects(R){
  const nick={chris:'christopher',mike:'michael',bob:'robert',dan:'daniel',jim:'james',tom:'thomas',matt:'matthew',ben:'benjamin',andy:'andrew',rick:'richard',bill:'william',jeff:'jeffrey',tim:'timothy',ken:'kenneth',nick:'nicholas',pete:'peter',steve:'stephen',greg:'gregory',tony:'anthony'};
  const fn=s=>nick[s.toLowerCase()]||s.toLowerCase();
  const lev=(a,b)=>{ const d=Array.from({length:a.length+1},(_,i)=>[i]); for(let j=1;j<=b.length;j++) d[0][j]=j; for(let i=1;i<=a.length;i++) for(let j=1;j<=b.length;j++) d[i][j]=Math.min(d[i-1][j]+1,d[i][j-1]+1,d[i-1][j-1]+(a[i-1]===b[j-1]?0:1)); return d[a.length][b.length]; };
  const counts=new Map(); for(const [,,ni] of R.tickets){ const k=rfKey(...R.names[ni]); counts.set(k,(counts.get(k)||0)+1); }
  const ppl=[...new Map(R.names.map(n=>[rfKey(n[0],n[1]),n])).values()], out=[];
  for(let i=0;i<ppl.length;i++) for(let j=i+1;j<ppl.length;j++){ const [a1,b1]=ppl[i], [a2,b2]=ppl[j];
    const fsame=fn(a1)===fn(a2)||a1.toLowerCase().startsWith(a2.toLowerCase())||a2.toLowerCase().startsWith(a1.toLowerCase());
    const l1=b1.toLowerCase(), l2=b2.toLowerCase(), lclose=(l1.length>2&&l2.length>2&&lev(l1,l2)<=Math.max(1,Math.floor(Math.min(l1.length,l2.length)/5)))||((l1.length<=2||l2.length<=2)&&(l1.startsWith(l2.replace('.',''))||l2.startsWith(l1.replace('.',''))));
    if(fsame&&lclose&&rfKey(a1,b1)!==rfKey(a2,b2)){ const k1=rfKey(a1,b1), k2=rfKey(a2,b2), id=[k1,k2].sort().join('~');
      out.push({id,a:{key:k1,name:`${a1} ${b1}`,n:counts.get(k1)||0},b:{key:k2,name:`${a2} ${b2}`,n:counts.get(k2)||0},decided:(R.rulings||{})[id]}); } }
  return out;
}
function rfEligible(R){ const winners=new Set(R.draws.filter(d=>!d.void).map(d=>d.playerKey)); return rfTickets(R).filter(x=>!winners.has(x.key)).sort((a,b)=>(a.tour+'|'+String(a.no).padStart(6,'0')+'|'+a.row).localeCompare(b.tour+'|'+String(b.no).padStart(6,'0')+'|'+b.row)); }
/* unbiased secure pick: reject values that would favour low indexes */
function secureIndex(n){ const lim=Math.floor(0x100000000/n)*n, a=new Uint32Array(1); let r; do{ crypto.getRandomValues(a); r=a[0]; }while(r>=lim); return {r,index:r%n}; }
const rfMoney=v=>'$'+Math.round(+v||0).toLocaleString('en-US');
/* ---------- upload ---------- */
function rfImport(t){
  if(t.raffle&&t.raffle.locked){ toast('The ticket list is locked'); return; }
  openDrawer({kicker:t.name+' · 50/50 Drawing',title:'Upload the ticket list',saveLabel:'Import tickets',
    body:`<p style="margin:0">Upload the “All tickets sold” export (CSV or Excel) with Tournament, Ticket #, First Name and Last Name columns. Email and phone are ignored — they were often the seller’s.</p>
      <label class="btn" style="justify-content:center"><input type="file" id="rfF" accept=".csv,.xlsx,.xls" hidden>Choose file</label><div id="rfPrev"></div>`,
    wire:r=>{ r.querySelector('#rfF').onchange=async e=>{ const f=e.target.files[0]; if(!f) return;
      try{ const rows=await readRosterFile(f); const hi=rows.findIndex(x=>x.some(c=>/ticket\s*#/i.test(String(c)))); if(hi<0) throw new Error('Couldn’t find a “Ticket #” column.');
        const h=rows[hi].map(c=>String(c).trim().toLowerCase()), col=re=>h.findIndex(x=>re.test(x));
        const cT=col(/^tournament$/), cN=col(/^ticket\s*#$/), cF=col(/^first/), cL=col(/^last/), cR=col(/^row/);
        if(cN<0||cF<0||cL<0) throw new Error('Expected Ticket #, First Name and Last Name columns.');
        const tours=[], names=[], ti=new Map(), ni=new Map(), tickets=[]; let skipped=0, manual=0;
        rows.slice(hi+1).forEach((x,k)=>{ let no=String(x[cN]||'').trim(); const f=String(x[cF]||'').trim(), l=String(x[cL]||'').trim(); if(!f&&!l){ if(x.some(c=>String(c).trim())) skipped++; return; }
          if(!no){ no='M'+(cR>=0&&String(x[cR]).trim()?String(x[cR]).trim():String(k+1)); manual++; }   // sold by hand without a number: identified by its row
          const tour=cT>=0?String(x[cT]||'').trim()||'—':'—'; if(!ti.has(tour)){ ti.set(tour,tours.length); tours.push(tour); }
          const nk=f+'\u0001'+l; if(!ni.has(nk)){ ni.set(nk,names.length); names.push([f,l]); }
          tickets.push([ti.get(tour),isNaN(+no)?no:+no,ni.get(nk),cR>=0?+x[cR]||k+1:k+1]); });
        const dup=new Set(), dups=[]; tickets.forEach(([a,n])=>{ const kk=a+'#'+n; if(dup.has(kk)) dups.push(tours[a]+' #'+n); dup.add(kk); });
        r._got={file:f.name,tours,names,tickets};
        const ppl=new Set(names.map(n=>rfKey(...n)));
        r.querySelector('#rfPrev').innerHTML=`<div class="mini">${[['Tickets',tickets.length.toLocaleString()],['Players (by name)',ppl.size],['Tournaments',tours.map(x=>`${x} (${tickets.filter(q=>tours[q[0]]===x).length})`).join(' · ')]].map(([a,b])=>`<div class="mr" style="grid-template-columns:150px minmax(0,1fr)"><span class="muted">${a}</span><b>${esc(String(b))}</b></div>`).join('')}</div>
          ${dups.length?`<div class="banner">${dups.length} ticket number${dups.length===1?' appears':'s appear'} twice in the same tournament: ${esc(dups.slice(0,6).join(', '))}${dups.length>6?'…':''}. Check the sheet before locking.</div>`:''}${manual?`<p class="hint"><b>${manual} manually sold ticket${manual===1?'':'s'}</b> have no ticket number; each is included and identified by its row in the sheet (shown as “manual ticket, row N”).</p>`:''}${skipped?`<div class="banner">${skipped} row${skipped===1?' has':'s have'} no name and ${skipped===1?'was':'were'} left out — check the sheet.</div>`:''}<p class="hint">Rows in the file: <b>${(tickets.length+skipped).toLocaleString()}</b> · tickets imported: <b>${tickets.length.toLocaleString()}</b></p>`;
      }catch(err){ r.querySelector('#rfPrev').innerHTML=`<div class="banner">${esc(err.message)}</div>`; } }; },
    save:()=>{ const g=$('dBody')._got; if(!g){ toast('Choose a file first'); return false; }
      const prev=t.raffle||{}; t.raffle={file:g.file,importedAt:new Date().toISOString(),tours:g.tours,names:g.names,tickets:g.tickets,merges:{},rulings:{},prizes:prev.prizes||[2000,2000],draws:[]};
      toast(`${g.tickets.length.toLocaleString()} tickets imported`); }});
}
function rfPrizes(t){ const R=t.raffle;
  openDrawer({kicker:t.name+' · 50/50 Drawing',title:'Drawings and prizes',
    body:`<p style="margin:0">One drawing per line, in order. A winner can’t win a later drawing.</p>`+R.prizes.map((p,i)=>field(`Drawing ${i+1} prize`,'rfP'+i,p,{type:'number'})).join('')+`<div class="actions"><button class="btn sm" type="button" id="rfAdd">+ Drawing</button>${R.prizes.length>1?'<button class="btn sm" type="button" id="rfRm">− Drawing</button>':''}</div>`,
    wire:r=>{ r.querySelector('#rfAdd').onclick=()=>{ R.prizes.push(R.prizes[R.prizes.length-1]||0); closeDrawer(); rfPrizes(t); }; const rm=r.querySelector('#rfRm'); if(rm) rm.onclick=()=>{ R.prizes.pop(); closeDrawer(); rfPrizes(t); }; },
    save:()=>{ R.prizes=R.prizes.map((_,i)=>fnum('rfP'+i)); }}); }
async function rfLock(t){ const R=t.raffle, open=rfSuspects(R).filter(s=>!s.decided);
  if(open.length){ toast('Decide the look-alike names first'); return; }
  const fp=await rfFingerprint(R);
  openDrawer({kicker:t.name+' · 50/50 Drawing',title:'Lock the ticket list?',saveLabel:'Lock it',
    body:`<p style="margin:0">After locking, the list can’t be changed. Its fingerprint — calculated from every ticket — goes on the screen and the official record. If anything in the list changed, the fingerprint would too.</p>
      <div class="card pad" style="text-align:center"><span class="lbl">Fingerprint</span><div style="font-family:ui-monospace,Menlo,monospace;font-size:22px;font-weight:700;letter-spacing:.06em;margin-top:6px">${fpShort(fp)}</div><small class="muted" style="word-break:break-all">${fp}</small></div>`,
    save:()=>{ R.locked={at:new Date().toISOString(),fp}; toast('Ticket list locked'); }}); }
/* ---------- the draw ---------- */
async function rfDraw(t){
  // pull in anything saved elsewhere first, so two screens can't draw the same drawing
  try{ if(typeof fetchHub==='function'&&CLOUD&&sessionOK){ const r=await fetchHub(); if(r) applyRemote(r); } }catch(_){}
  const R=t.raffle; if(!R||!R.locked) return null;
  const done=R.draws.filter(d=>!d.void).length; if(done>=R.prizes.length) return null;
  const elig=rfEligible(R); if(!elig.length){ toast('No eligible tickets left'); return null; }
  const fp=await rfFingerprint(R); if(fp!==R.locked.fp){ toast('The ticket list no longer matches its fingerprint — drawing stopped'); return null; }
  const {r,index}=secureIndex(elig.length), w=elig[index];
  const removed=rfTickets(R).length-elig.length;
  const d={id:uid(),no:done+1,prize:R.prizes[done],at:new Date().toISOString(),eligibleTickets:elig.length,eligiblePlayers:new Set(elig.map(x=>x.key)).size,removedTickets:removed,
    rand:r,index,ticket:{tour:w.tour,no:w.no,row:w.row,first:w.first,last:w.last},playerKey:w.key,winner:rfPlayerName(R,w.key)||`${w.first} ${w.last}`,
    winnerTickets:rfTickets(R).filter(x=>x.key===w.key).length,fp};
  R.draws.push(d); persist();                     // saved before anything is shown
  return d;
}
function rfVoid(t,d){
  openDrawer({kicker:t.name+' · 50/50 Drawing',title:`Void drawing ${d.no}?`,saveLabel:'Void it',
    body:`<p style="margin:0">${esc(d.winner)} (${esc(tkLabel(d.ticket.tour,d.ticket.no))}) stays in the record, marked void with your reason. The drawing can then be held again; the voided winner goes back in the drum.</p>`+field('Reason (required)','rfVr','',{type:'textarea'}),
    save:()=>{ const why=fv('rfVr'); if(!why){ toast('A reason is required'); return false; } d.void={reason:why,at:new Date().toISOString()}; }}); }
/* ---------- reset ---------- */
function rfReset(t,full){
  const R=t.raffle, live=R.draws.filter(d=>!d.void);
  openDrawer({kicker:t.name+' · 50/50 Drawing',title:full?'Start over?':'Reset the drawings?',saveLabel:full?'Start over':'Reset drawings',
    body:(full?`<p style="margin:0">Removes everything — the ticket list, name rulings, lock and all drawings — so you can upload a new list. Use this after a practice run or to load a corrected file.</p>`
      :`<p style="margin:0">Clears the ${R.draws.length} drawing${R.draws.length===1?'':'s'} so far${live.length?` (${esc(live.map(d=>d.winner).join(', '))})`:''}. The locked ticket list and fingerprint stay. The reset is <b>logged on the official record</b> with your reason and who had been drawn.</p>`)+
      field('Reason (required)','rfRr','',{type:'textarea',ph:full?'e.g. practice run before dinner':'e.g. drawings run as a test before the room was ready'})+
      field('Type RESET to confirm','rfRc','',{ph:'RESET'}),
    save:()=>{ const why=fv('rfRr'); if(!why){ toast('A reason is required'); return false; } if(fv('rfRc').trim().toUpperCase()!=='RESET'){ toast('Type RESET to confirm'); return false; }
      if(full){ delete t.raffle; toast('50/50 drawing cleared'); }
      else { R.resets=R.resets||[]; R.resets.push({at:new Date().toISOString(),reason:why,draws:R.draws.map(d=>({no:d.no,winner:d.winner,ticket:d.ticket,at:d.at,void:!!d.void}))}); R.draws=[]; toast('Drawings reset — logged on the record'); } }});
}
/* ---------- the tab ---------- */
function tRaffle(el,t){
  const R=t.raffle;
  if(!R){ el.innerHTML=`<div class="card"><div class="empty"><b>No tickets yet</b><span>Upload the “All tickets sold” export. You’ll confirm look-alike names, lock the list (which fingerprints it), then run the drawings on the big screen.</span><button class="btn pri" id="rfImp">${I.down}Upload ticket list</button></div></div>`; $('rfImp').onclick=()=>rfImport(t); return; }
  const all=rfTickets(R), players=new Map(); all.forEach(x=>players.set(x.key,(players.get(x.key)||0)+1));
  const sus=rfSuspects(R), live=R.draws.filter(d=>!d.void), left=R.prizes.length-live.length;
  const step=(n,title,state,body)=>`<div class="card pad rf-step ${state}"><div class="rf-n">${state==='done'?'✓':n}</div><div style="flex:1;min-width:0"><b class="rf-t">${title}</b>${body}</div></div>`;
  el.innerHTML=`<div class="grid g4">${kpi('Tickets',all.length.toLocaleString(),`${R.tours.length} tournaments`)}${kpi('Players',players.size,'by name')}${kpi('Drawings',`${live.length} / ${R.prizes.length}`,R.prizes.map(rfMoney).join(' + '))}${kpi('Fingerprint',R.locked?fpShort(R.locked.fp).split(' ').slice(0,2).join(' '):'—',R.locked?'list locked':'not locked yet')}</div>
    ${step(1,'Ticket list','done',`<div class="muted" style="font-size:13.5px">${esc(R.file)} · imported ${new Date(R.importedAt).toLocaleString([], {month:'short',day:'numeric',hour:'numeric',minute:'2-digit'})} · ${R.tours.map(x=>`${esc(x)} ${all.filter(q=>q.tour===x).length}`).join(' · ')}</div><div class="actions" style="margin-top:8px">${R.locked?'':`<button class="btn sm" id="rfImp">Replace the list</button><button class="btn sm" id="rfPz">Drawings &amp; prizes</button>`}<button class="btn sm" id="rfStart">Start over</button></div>`)}
    ${step(2,'Look-alike names',sus.every(s=>s.decided)?'done':'todo',sus.length?`<div class="muted" style="font-size:13.5px;margin-bottom:6px">Decide whether these are the same person. Same person = one entry in the drum and can only win once.</div>${sus.map(s=>`<div class="rf-sus"><span><b>${esc(s.a.name)}</b> (${s.a.n}) and <b>${esc(s.b.name)}</b> (${s.b.n})</span>${s.decided?`<span class="chip ${s.decided==='same'?'gold':''}">${s.decided==='same'?'Same person':'Different people'}</span>${R.locked?'':`<button class="btn sm" data-rfu="${esc(s.id)}">Change</button>`}`:`<span class="actions"><button class="btn sm" data-rfs="${esc(s.id)}">Same person</button><button class="btn sm" data-rfd="${esc(s.id)}">Different people</button></span>`}</div>`).join('')}`:'<div class="muted" style="font-size:13.5px">None found — every name is distinct.</div>')}
    ${step(3,'Lock the ticket list',R.locked?'done':'todo',R.locked?`<div style="font-size:13.5px">Locked ${new Date(R.locked.at).toLocaleString([], {month:'short',day:'numeric',hour:'numeric',minute:'2-digit'})} · fingerprint <b style="font-family:ui-monospace,Menlo,monospace;letter-spacing:.04em">${fpShort(R.locked.fp)}</b></div>`:`<div class="muted" style="font-size:13.5px;margin-bottom:8px">Prizes: ${R.prizes.map((p,i)=>`drawing ${i+1} ${rfMoney(p)}`).join(', ')}. Locking fingerprints every ticket; the list can’t change after.</div><button class="btn pri" id="rfLock"${sus.every(s=>s.decided)?'':' disabled'}>Lock the ticket list</button>`)}
    ${step(4,'Drawings',live.length===R.prizes.length?'done':R.locked?'todo':'wait',`${R.locked?`<div class="actions" style="margin:4px 0 10px"><button class="btn pri" id="rfShow">Open the drawing screen</button><button class="btn" id="rfRec">${I.down}Official record (PDF)</button>${R.draws.length?'<button class="btn" id="rfRst">Reset drawings</button>':''}</div>${(R.resets||[]).length?`<div class="muted" style="font-size:12.5px;margin-bottom:6px">Reset ${R.resets.length} time${R.resets.length===1?'':'s'} — ${esc(R.resets.map(x=>new Date(x.at).toLocaleTimeString([], {hour:'numeric',minute:'2-digit'})+': '+x.reason).join(' · '))}</div>`:''}`:'<div class="muted" style="font-size:13.5px">Available once the list is locked.</div>'}
      ${R.draws.map(d=>`<div class="rf-draw${d.void?' void':''}"><div><span class="lbl">Drawing ${d.no} · ${rfMoney(d.prize)}${d.void?' · VOID':''}</span><b style="font-size:17px">${esc(d.winner)}</b><small class="muted">${esc(tkLabel(d.ticket.tour,d.ticket.no))} (sheet row ${d.ticket.row}) · ${new Date(d.at).toLocaleTimeString([], {hour:'numeric',minute:'2-digit',second:'2-digit'})} · 1 of ${d.eligibleTickets.toLocaleString()} eligible tickets · random ${d.rand}${d.void?` · void: ${esc(d.void.reason)}`:''}</small></div>${d.void?'':`<button class="btn sm" data-rfv="${d.id}">Void</button>`}</div>`).join('')}`)}
    <div class="card" style="overflow:hidden"><div class="cardhead"><div><h2 class="h2">Tickets by player</h2><span class="muted">How many chances each player has — the same table is on the official record.</span></div></div>
      <div class="rf-ppl">${[...players.entries()].sort((a,b)=>b[1]-a[1]||rfPlayerName(R,a[0]).localeCompare(rfPlayerName(R,b[0]))).map(([k,n])=>`<div><span class="trunc">${esc(rfPlayerName(R,k))}${live.some(d=>d.playerKey===k)?' <span class="chip gold">winner</span>':''}</span><b class="num">${n}</b></div>`).join('')}</div></div>`;
  const on=(id,f)=>{ const e=$(id); if(e) e.onclick=f; };
  on('rfImp',()=>rfImport(t)); on('rfPz',()=>rfPrizes(t)); on('rfLock',()=>rfLock(t)); on('rfShow',()=>rfShow(t)); on('rfRec',()=>rfRecord(t)); on('rfRst',()=>rfReset(t,false)); on('rfStart',()=>rfReset(t,true));
  const rule=(id,v)=>{ R.rulings=R.rulings||{}; R.merges=R.merges||{}; const s=sus.find(x=>x.id===id); if(v) R.rulings[id]=v; else delete R.rulings[id];
    delete R.merges[s.a.key]; delete R.merges[s.b.key]; if(v==='same'){ const [keep,drop]=s.a.n>=s.b.n?[s.a,s.b]:[s.b,s.a]; R.merges[drop.key]=keep.key; } persist(); render(); };
  el.querySelectorAll('[data-rfs]').forEach(b=>b.onclick=()=>rule(b.dataset.rfs,'same'));
  el.querySelectorAll('[data-rfd]').forEach(b=>b.onclick=()=>rule(b.dataset.rfd,'different'));
  el.querySelectorAll('[data-rfu]').forEach(b=>b.onclick=()=>rule(b.dataset.rfu,null));
  el.querySelectorAll('[data-rfv]').forEach(b=>b.onclick=()=>rfVoid(t,R.draws.find(d=>d.id===b.dataset.rfv)));
}
/* ---------- full-screen drawing for the projector ---------- */
function rfShow(t){
  const R=t.raffle; let ov=document.getElementById('rfShow'); if(ov) ov.remove();
  ov=document.createElement('div'); ov.id='rfShow'; ov.className='rf-show'; document.body.appendChild(ov);
  try{ ov.requestFullscreen&&ov.requestFullscreen(); }catch(_){}
  let anim=null;
  const close=()=>{ clearTimeout(anim); clearInterval(anim); running=false; if(document.fullscreenElement) document.exitFullscreen().catch(()=>{}); ov.remove(); document.removeEventListener('keydown',key); render(); };
  const draw=()=>{
    const live=R.draws.filter(d=>!d.void), no=live.length+1, elig=rfEligible(R), last=live[live.length-1];
    const header=`<div class="rf-top"><img src="${typeof crestSrc==='function'?crestSrc():'crest.png'}" alt=""><div><div class="rf-k">${esc(t.name)} · ${esc(String(t.season||''))} MGA 50/50</div><div class="rf-h">Final Drawing</div></div><button class="rf-x rf-snd" title="Sound on/off">${window.__rfSound?'🔊':'🔈'}</button><button class="rf-x" id="rfClose" title="Close (Esc)">✕</button></div>`;
    const facts=`<div class="rf-facts"><span><b>${elig.length.toLocaleString()}</b> tickets in the drum</span><span><b>${new Set(elig.map(x=>x.key)).size}</b> players</span><span>List fingerprint <b class="mono">${fpShort(R.locked.fp)}</b></span>${live.length?`<span>Previous winners’ tickets removed</span>`:''}</div>`;
    const done=live.length>=R.prizes.length;
    ov.innerHTML=header+`<div class="rf-stage">
      ${done?`<div class="rf-lbl">All drawings complete</div>${live.map(d=>`<div class="rf-sum"><span>Drawing ${d.no} · ${rfMoney(d.prize)}</span><b>${esc(d.winner)}</b><small>${esc(tkLabel(d.ticket.tour,d.ticket.no))}</small></div>`).join('')}`
      :`<div class="rf-lbl">Drawing ${no} of ${R.prizes.length}</div><div class="rf-prize">${rfMoney(R.prizes[no-1])}</div>
        <div class="rf-ticket" id="rfTicket"><div class="rf-tk-top">${last&&live.length?`Last winner: ${esc(last.winner)}`:'Ready to draw'}</div><div class="rf-tk-name" id="rfName">${elig.length.toLocaleString()} tickets</div><div class="rf-tk-no" id="rfNo">in the drum</div></div>
        <button class="rf-go" id="rfGo">Draw ticket</button><div class="rf-hint">or press the space bar</div>`}
      </div>`+facts;
    ov.querySelector('#rfClose').onclick=close; ov.querySelector('.rf-snd').onclick=e=>{ window.__rfSound=!window.__rfSound; e.currentTarget.textContent=window.__rfSound?'🔊':'🔈'; if(window.__rfSound) ac(); };
    const go=ov.querySelector('#rfGo'); if(go) go.onclick=run;
  };
  let running=false;
  /* sound (optional): ticks that slow with the spin, a drumroll in the pause, a chime on the winner */
  let AC=null; const snd=()=>window.__rfSound;
  const ac=()=>{ if(!AC) try{ AC=new (window.AudioContext||window.webkitAudioContext)(); }catch(_){} return AC; };
  const tick=(v=0.15)=>{ if(!snd()||!ac()) return; const o=AC.createOscillator(), g=AC.createGain(); o.type='square'; o.frequency.value=1800; g.gain.setValueAtTime(v,AC.currentTime); g.gain.exponentialRampToValueAtTime(0.0001,AC.currentTime+0.04); o.connect(g).connect(AC.destination); o.start(); o.stop(AC.currentTime+0.05); };
  const roll=(sec)=>{ if(!snd()||!ac()) return; const n=Math.floor(AC.sampleRate*sec), b=AC.createBuffer(1,n,AC.sampleRate), d=b.getChannelData(0);
    for(let i=0;i<n;i++){ const tt=i/AC.sampleRate; d[i]=(Math.random()*2-1)*(0.25+0.75*tt/sec)*(0.55+0.45*Math.abs(Math.sin(tt*Math.PI*28))); }
    const src=AC.createBufferSource(), f=AC.createBiquadFilter(), g=AC.createGain(); f.type='bandpass'; f.frequency.value=1600; g.gain.value=0.22; src.buffer=b; src.connect(f).connect(g).connect(AC.destination); src.start(); };
  const chime=()=>{ if(!snd()||!ac()) return; [523.25,659.25,783.99,1046.5].forEach((fq,k)=>{ const o=AC.createOscillator(), g=AC.createGain(), t0=AC.currentTime+k*0.11; o.type='triangle'; o.frequency.value=fq; g.gain.setValueAtTime(0.0001,t0); g.gain.exponentialRampToValueAtTime(0.22,t0+0.02); g.gain.exponentialRampToValueAtTime(0.0001,t0+1.4); o.connect(g).connect(AC.destination); o.start(t0); o.stop(t0+1.5); }); };
  const confetti=()=>{ const box=document.createElement('div'); box.className='rf-confetti'; ov.appendChild(box); const cols=['#D8B75F','#C7A13A','#FFFFFF','#F6ECCF','#9FC3D5'];
    for(let k=0;k<140;k++){ const p=document.createElement('i'); p.style.left=(50+(Math.random()-0.5)*30)+'%'; p.style.background=cols[k%cols.length]; p.style.setProperty('--dx',((Math.random()-0.5)*1200)+'px'); p.style.setProperty('--dy',(-200-Math.random()*520)+'px'); p.style.setProperty('--r',(Math.random()*900-450)+'deg'); p.style.animationDelay=(Math.random()*0.25)+'s'; box.appendChild(p); }
    setTimeout(()=>box.remove(),4200); };
  const wait=ms=>new Promise(r=>{ anim=setTimeout(r,ms); });
  /* the pace: fast spin → slowing → a crawl (about 13 s), then a pause and a two-step reveal */
  function schedule(){ const d=[]; for(let k=0;k<70;k++) d.push(55);                       // ~4 s fast
    for(let k=0;k<28;k++){ const x=k/27; d.push(Math.round(60+x*x*440)); }                    // ~5.5 s slowing
    [620,760,900,1080,1300].forEach(v=>d.push(v)); return d; }                                 // ~4.7 s crawl
  async function run(){ if(running) return; running=true; const go=ov.querySelector('#rfGo'); if(go){ go.disabled=true; go.textContent='Drawing…'; }
    const pool=rfEligible(R); const d=await rfDraw(t);           // the winner is chosen and saved first; the rest is theatre
    if(!d){ running=false; draw(); return; }
    const nm=ov.querySelector('#rfName'), tn=ov.querySelector('#rfNo'), tk=ov.querySelector('#rfTicket'), top=ov.querySelector('.rf-tk-top');
    tk.classList.add('rolling'); top.textContent='Drawing…';
    const steps=schedule(); let prev=null;
    for(let k=0;k<steps.length;k++){ let x; do{ x=pool[Math.floor(Math.random()*pool.length)]; }while(pool.length>1&&prev&&x.key===prev.key); prev=x;
      nm.textContent=`${x.first} ${x.last}`; tn.textContent=tkLabel(x.tour,x.no); tk.classList.toggle('slow',steps[k]>300); tick(steps[k]>300?0.22:0.08); await wait(steps[k]); }
    // the pause
    tk.classList.remove('rolling','slow'); tk.classList.add('hush'); top.textContent='And the winning ticket is…'; nm.textContent='• • •'; tn.textContent=''; roll(2.4); await wait(2400);
    // ticket first …
    tk.classList.remove('hush'); tk.classList.add('ticket'); tn.textContent=tkLabel(d.ticket.tour,d.ticket.no); top.textContent='Winning ticket'; tick(0.25); await wait(2200);
    // … then the name
    tk.classList.remove('ticket'); tk.classList.add('won'); nm.textContent=d.winner; top.textContent=`Winner · ${rfMoney(d.prize)}`; chime(); confetti();
    const left=rfEligible(R); ov.querySelector('.rf-facts').innerHTML=`<span>Drawn from <b>${d.eligibleTickets.toLocaleString()}</b> tickets</span><span><b>${esc(d.winner)}</b>’s ${d.winnerTickets} ticket${d.winnerTickets===1?'':'s'} now out of the drum</span><span><b>${left.length.toLocaleString()}</b> tickets remain</span><span>List fingerprint <b class="mono">${fpShort(R.locked.fp)}</b></span>`;
    const go2=ov.querySelector('#rfGo'); if(go2){ const more=R.draws.filter(z=>!z.void).length<R.prizes.length; go2.disabled=false; go2.textContent=more?'Next drawing':'Finish'; go2.onclick=()=>{ running=false; draw(); }; }
    running=false; }
  const key=e=>{ if(e.key==='Escape') close(); if(e.code==='Space'){ e.preventDefault(); const g=ov.querySelector('#rfGo'); if(g&&!g.disabled) g.click(); } };
  document.addEventListener('keydown',key); draw();
}
/* ---------- the official record ---------- */
async function rfRecord(t){
  const R=t.raffle; try{ await loadJsPDF(); }catch(e){ toast(e.message); return; }
  const crest=await crestPNG().catch(()=>null), doc=new window.jspdf.jsPDF({unit:'pt',format:'letter'});
  [['ps400','PS-400.ttf','PublicSans','normal'],['ps700','PS-700.ttf','PublicSans','bold'],['ps800','PS-800.ttf','PublicSansXB','normal'],['cg700','CG-700.ttf','Cormorant','bold']].forEach(([k,f,fam,st])=>{ doc.addFileToVFS(f,PDF_FONTS[k]); doc.addFont(f,fam,st); });
  const NAVY=[15,42,56],GOLD=[199,161,58],GOLDL=[216,183,95],GOLDDK=[126,95,26],IVORY=[251,250,245],LINE=[225,217,198],INK=[20,34,43],MUTED=[86,98,106],FOOT=[139,149,160];
  const L=40,R2=572,W=612,H=792; const font=(f,s,z,c)=>{ doc.setFont(f,s); doc.setFontSize(z); doc.setTextColor(...c); };
  const all=rfTickets(R), ppl=new Map(); all.forEach(x=>ppl.set(x.key,(ppl.get(x.key)||0)+1));
  const page=()=>{ doc.setFillColor(...IVORY); doc.rect(0,0,W,H,'F'); };
  page();
  doc.setFillColor(...GOLD); doc.roundedRect(L,32,R2-L,78,8,8,'F'); doc.setFillColor(...NAVY); doc.roundedRect(L,32,R2-L,74,8,8,'F'); doc.rect(L,94,R2-L,8,'F');
  if(crest) doc.addImage(crest,'PNG',L+16,42,54*914/1180,54);
  font('PublicSansXB','normal',6.8,GOLDL); doc.text(`${(t.name||'').toUpperCase()} · ${t.season||''} · MGA 50/50`,L+76,56,{charSpace:1.2});
  font('Cormorant','bold',24,[255,255,255]); doc.text('Final Drawing — Official Record',L+76,80);
  font('PublicSans','normal',8.4,[214,218,220]); doc.text(`Generated ${new Date().toLocaleString()}`,L+76,96);
  let y=130; const sec=s=>{ font('PublicSansXB','normal',7.4,GOLDDK); doc.text(s.toUpperCase(),L,y,{charSpace:1.1}); y+=6; doc.setDrawColor(...GOLD); doc.setLineWidth(1); doc.line(L,y,R2,y); y+=14; };
  const kv=(k,v,mono)=>{ font('PublicSans','bold',9,MUTED); doc.text(k,L,y); font(mono?'PublicSans':'PublicSans',mono?'bold':'normal',9.4,INK); const lines=doc.splitTextToSize(String(v),R2-L-150); doc.text(lines,L+150,y); y+=13*lines.length+1; };
  sec('Ticket list');
  kv('Source file',R.file); kv('Imported',new Date(R.importedAt).toLocaleString()); kv('Tickets',`${all.length.toLocaleString()} (each identified by tournament + ticket number; ${all.filter(x=>String(x.no).startsWith('M')).length} sold by hand without a number are identified by sheet row)`);
  kv('Tournaments',R.tours.map(x=>`${x} ${all.filter(q=>q.tour===x).length}`).join(' · ')); kv('Players',`${ppl.size} (identified by name; email and phone not used)`);
  const rul=rfSuspects(R).filter(s=>s.decided); kv('Name rulings',rul.length?rul.map(s=>`${s.a.name} / ${s.b.name}: ${s.decided==='same'?'same person':'different people'}`).join('; '):'None needed');
  kv('Locked',R.locked?new Date(R.locked.at).toLocaleString():'Not locked'); kv('Fingerprint (SHA-256)',R.locked?R.locked.fp.match(/.{1,8}/g).join(' '):'—',true);
  y+=6; sec('Method');
  font('PublicSans','normal',9,INK); const m=doc.splitTextToSize('Each drawing selects one ticket from the tickets still eligible, using the browser’s cryptographic random number generator (crypto.getRandomValues) with rejection sampling so every eligible ticket has exactly the same chance. Eligible tickets are ordered by tournament, ticket number and row; the winning ticket is the one at position (random value mod eligible count). Once a player wins, all of that player’s tickets are removed before the next drawing. Each result is saved the moment it is drawn.',R2-L); doc.text(m,L,y); y+=12*m.length+8;
  sec('Drawings');
  R.draws.forEach(d=>{ const w=R2-L-24;
    font('PublicSans','normal',8.4,MUTED);
    const l1=doc.splitTextToSize(`${tkLabel(d.ticket.tour,d.ticket.no)} (sheet row ${d.ticket.row}) · drawn ${new Date(d.at).toLocaleString()}`,w);
    const l2=doc.splitTextToSize(`1 of ${d.eligibleTickets.toLocaleString()} eligible tickets (${d.eligiblePlayers} players${d.removedTickets?`; ${d.removedTickets} previous-winner tickets removed`:''}) · random value ${d.rand} gives position ${d.index} · winner held ${d.winnerTickets} tickets`,w);
    const l3=d.void?doc.splitTextToSize(`Voided ${new Date(d.void.at).toLocaleString()}: ${d.void.reason}`,w):[];
    const h=40+11*(l1.length+l2.length+l3.length)+6;
    doc.setFillColor(255,255,255); doc.setDrawColor(...LINE); doc.roundedRect(L,y-10,R2-L,h,6,6,'FD');
    font('PublicSansXB','normal',7,d.void?[161,64,43]:GOLDDK); doc.text(`DRAWING ${d.no} · ${rfMoney(d.prize)}${d.void?' · VOID':''}`,L+12,y+4,{charSpace:.9});
    font('Cormorant','bold',17,NAVY); doc.text(d.winner,L+12,y+24);
    font('PublicSans','normal',8.4,MUTED); let yy=y+38; doc.text(l1,L+12,yy); yy+=11*l1.length; doc.text(l2,L+12,yy); yy+=11*l2.length;
    if(l3.length){ doc.setTextColor(161,64,43); doc.text(l3,L+12,yy); }
    y+=h+10; });
  if(!R.draws.length){ font('PublicSans','normal',9,MUTED); doc.text('No drawings yet.',L,y); y+=16; }
  if((R.resets||[]).length){ y+=4; sec('Resets');
    R.resets.forEach(x=>{ font('PublicSans','bold',8.8,INK); doc.text(`Reset ${new Date(x.at).toLocaleString()}`,L,y); font('PublicSans','normal',8.4,MUTED);
      const ln=doc.splitTextToSize(`Reason: ${x.reason}. Drawings cleared: ${x.draws.length?x.draws.map(d=>`#${d.no} ${d.winner} (${tkLabel(d.ticket.tour,d.ticket.no)})${d.void?' [void]':''}`).join('; '):'none'}.`,R2-L); doc.text(ln,L,y+11); y+=13+11*ln.length; }); }
  y+=8; sec('Witnesses');
  [0,1].forEach(i=>{ const x=L+i*((R2-L)/2); doc.setDrawColor(...INK); doc.setLineWidth(.6); doc.line(x,y+22,x+(R2-L)/2-24,y+22); font('PublicSans','normal',7.6,MUTED); doc.text('Signature · printed name · date',x,y+33); });
  // appendix: tickets per player
  doc.addPage(); page(); y=48; font('Cormorant','bold',20,NAVY); doc.text('Tickets by player',L,y); font('PublicSans','normal',8.4,MUTED); doc.text(`${ppl.size} players · ${all.length.toLocaleString()} tickets · fingerprint ${R.locked?fpShort(R.locked.fp):'—'}`,L,y+14); y+=30;
  const list=[...ppl.entries()].sort((a,b)=>rfPlayerName(R,a[0]).split(' ').slice(-1)[0].localeCompare(rfPlayerName(R,b[0]).split(' ').slice(-1)[0])||rfPlayerName(R,a[0]).localeCompare(rfPlayerName(R,b[0])));
  const colW=(R2-L)/3, rowsPer=Math.ceil(list.length/3); let top=y;
  list.forEach(([k,n],i)=>{ const col=Math.floor(i/rowsPer), row=i%rowsPer, x=L+col*colW, yy=top+row*13.2;
    if(yy>H-50){ return; } font('PublicSans','normal',8.4,INK); doc.text(rfPlayerName(R,k),x,yy,{maxWidth:colW-40}); font('PublicSans','bold',8.4,NAVY); doc.text(String(n),x+colW-14,yy,{align:'right'}); });
  const N=doc.getNumberOfPages();
  for(let p=1;p<=N;p++){ doc.setPage(p); doc.setDrawColor(...LINE); doc.setLineWidth(.6); doc.line(L,H-34,R2,H-34); font('PublicSansXB','normal',6.4,FOOT); doc.text(`${(t.name||'').toUpperCase()} · 50/50 FINAL DRAWING · OFFICIAL RECORD`,L,H-23,{charSpace:.9}); doc.text(`PAGE ${p} OF ${N}`,R2,H-23,{align:'right',charSpace:.9}); }
  doc.setProperties({title:`${t.name} — 50/50 Final Drawing Record`});
  doc.save(`${(t.name||'Tournament').replace(/[^\w]+/g,'-')}-50-50-Drawing-Record.pdf`);
}

