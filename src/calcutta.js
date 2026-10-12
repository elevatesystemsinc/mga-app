/* =====================================================================
   Calcutta (players auction) — per tournament.
   t.calcutta = { lots:[{id,lot,p1,i1,p2,i2,flight,idx,fun,bidderId,price}],
                  bidders:[{id,num,name,memberId,paid,method}],
                  expenses:[{id,desc,amount,notes}], payout:[40,30,20,10], file, importedAt }
   Expenses come out of the pot evenly across every flight.
   ===================================================================== */
TT.splice(TT.findIndex(x=>x[0]==='budget')+1,0,['calcutta','Calcutta']);
const CALC_PAYOUT=[40,30,20,10];
function calc(t){ if(!t.calcutta) t.calcutta={lots:[],bidders:[],expenses:[],payout:CALC_PAYOUT.slice(),minBid:250}; const c=t.calcutta;
  if(c.minBid==null) c.minBid=250; c.pool=c.pool||{bidderId:'',price:0}; calcNormalize(c); resolveCaptains(t,c);
  c.lots=c.lots||[]; c.bidders=c.bidders||[]; c.expenses=c.expenses||[]; c.payout=c.payout&&c.payout.length?c.payout:CALC_PAYOUT.slice(); return c; }
const calcTotals=t=>calcTotalsC(calc(t));
/* link each lot's two players to member records, then pick the captain (lower Handicap Index) unless set by hand */
function resolveCaptains(t,c){
  const pool=((t.field||[]).map(p=>memberById(p.memberId)).filter(Boolean)).concat(members());
  const byKey=new Map(); for(const m of pool){ const k=nameKey(memberName(m)); if(k&&!byKey.has(k)) byKey.set(k,m); }
  const idx=(given,m)=>{ if(given!=null&&given!=='') return +given; const v=m&&typeof parseIndex==='function'?parseIndex(m.hcp):null; return v==null?null:v; };
  for(const l of c.lots){
    const a=l.m1?memberById(l.m1):byKey.get(nameKey(l.p1)), b=l.m2?memberById(l.m2):byKey.get(nameKey(l.p2));
    if(a&&l.m1!==a.id) l.m1=a.id; if(b&&l.m2!==b.id) l.m2=b.id;
    if(l.capSet) continue;
    const i1=idx(l.i1,a), i2=idx(l.i2,b); let cap=0, flag=true;
    if(i1!=null&&i2!=null&&i1!==i2){ cap=i2<i1?1:0; flag=false; }
    if(l.cap!==cap) l.cap=cap; if(!!l.capFlag!==flag) l.capFlag=flag;
  }
}
const capIndexTxt=(l,k)=>{ const id=[l.m1,l.m2][k], m=id&&memberById(id), v=[l.i1,l.i2][k]!=null&&[l.i1,l.i2][k]!==''?+[l.i1,l.i2][k]:(m&&typeof parseIndex==='function'?parseIndex(m.hcp):null); return v==null?'no index':(v<0?'+'+Math.abs(v).toFixed(1):v.toFixed(1)); };
/* ---------- import (the auction-order sheet or the fun-team sheet) ---------- */
function parseCalcSheet(rows){
  const low=r=>r.map(c=>String(c||'').trim().toLowerCase());
  const hi=rows.findIndex(r=>{ const h=low(r); return (h.includes('team')&&h.includes('flight'))||(h.includes('player 1')&&h.includes('flight')); });
  if(hi<0) throw new Error('Couldn’t find the header row — expected columns like Lot, Team, Flight (or Player 1, Player 2, Flight).');
  const h=low(rows[hi]), col=re=>h.findIndex(x=>re.test(x));
  const cLot=col(/^lot$/), cNum=col(/^#$/), cTeam=col(/^team$/), cP1=col(/^player 1$/), cP2=col(/^player 2$/), cFl=col(/^flight$/), cTi=col(/^team index$/),
        cBuyer=col(/^(buyer|bidder|bought by|purchaser)$/), cPrice=col(/^(price|sold for|amount|bid)$/), cFun=col(/^fun team$/);
  const idxCols=h.map((x,i)=>/^index$/.test(x)?i:-1).filter(i=>i>=0);
  const num=v=>{ const s=String(v||'').replace(/[$,\s]/g,''); if(!s) return null; if(/^\+/.test(s)) return -parseFloat(s.slice(1)); const n=parseFloat(s); return isFinite(n)?n:null; };
  const out=[];
  for(const r of rows.slice(hi+1)){
    let p1='',p2='';
    if(cTeam>=0&&r[cTeam]){ [p1,p2]=String(r[cTeam]).split(/\s*&\s*|\s*\/\s*|\s+and\s+/i); }
    else if(cP1>=0){ p1=r[cP1]; p2=cP2>=0?r[cP2]:''; }
    p1=String(p1||'').trim(); p2=String(p2||'').trim(); if(!p1) continue;
    const fl=String(r[cFl]||'').replace(/^flight\s*/i,'').trim();
    out.push({lot:cLot>=0?parseInt(r[cLot],10)||null:(cNum>=0?parseInt(r[cNum],10)||null:null),p1,p2,flight:fl,
      i1:idxCols[0]!=null?num(r[idxCols[0]]):null,i2:idxCols[1]!=null?num(r[idxCols[1]]):null,idx:cTi>=0?num(r[cTi]):null,
      fun:cFun>=0?/^y/i.test(r[cFun]):(cLot>=0&&r[1]==='★'),buyer:cBuyer>=0?String(r[cBuyer]||'').trim():'',price:cPrice>=0?num(r[cPrice]):null});
  }
  if(!out.length) throw new Error('No teams found under the header row.');
  out.forEach((x,i)=>{ if(x.lot==null) x.lot=i+1; if(x.idx==null&&x.i1!=null&&x.i2!=null) x.idx=Math.round((x.i1+x.i2)*10)/10; });
  return out;
}
function importCalcutta(t){
  const c=calc(t);
  openDrawer({kicker:t.name+' · Calcutta',title:'Upload the team sheet',saveLabel:'Import',
    body:`<p style="margin:0">Upload the auction-order spreadsheet (Lot, Team, Flight…) or the team sheet (Player 1, Player 2, Flight…). The lot order, flights and handicap indexes come in; any buyers and prices already filled in come too.</p>
      <label class="btn" style="justify-content:center"><input type="file" id="ccF" accept=".xlsx,.xls,.csv" hidden>Choose file</label><div id="ccPrev"></div>
      ${c.lots.length?'<p class="hint">Re-importing keeps every sale already recorded: teams are matched by their players, and only the order, flights and indexes update.</p>':''}`,
    wire:r=>{ r.querySelector('#ccF').onchange=async e=>{ const f=e.target.files[0]; if(!f) return;
      try{ const rows=await readRosterFile(f); const got=parseCalcSheet(rows); r._got=got; r._file=f.name;
        const fl=[...new Set(got.map(x=>flightName(x.flight)))], wSale=got.filter(x=>x.price>0).length;
        r.querySelector('#ccPrev').innerHTML=`<div class="mini">${[['Teams',got.length],['Flights',fl.join(', ')],['With a sale already',wSale]].map(([a,b])=>`<div class="mr" style="grid-template-columns:150px minmax(0,1fr)"><span class="muted">${a}</span><b>${esc(String(b))}</b></div>`).join('')}</div>`;
      }catch(err){ r.querySelector('#ccPrev').innerHTML=`<div class="banner">${esc(err.message)}</div>`; } }; },
    save:()=>{ const r=$('dBody'), got=r._got; if(!got){ toast('Choose a file first'); return false; }
      const key=x=>[x.p1,x.p2].map(s=>s.toLowerCase().replace(/[^a-z]/g,'')).sort().join('|');
      const old=new Map(c.lots.map(l=>[key(l),l]));
      c.lots=got.map(x=>{ const o=old.get(key(x));
        let bidderId=o?o.bidderId:'', price=o?n0(o.price):0;
        if(!price&&x.price>0){ price=x.price; if(x.buyer){ let b=c.bidders.find(b=>b.name.toLowerCase()===x.buyer.toLowerCase()); if(!b){ b={id:uid(),num:nextBidderNum(c),name:x.buyer,memberId:'',paid:false,method:''}; c.bidders.push(b); } bidderId=b.id; } }
        return {id:o?o.id:uid(),lot:x.lot,p1:x.p1,p2:x.p2,i1:x.i1,i2:x.i2,flight:x.flight,idx:x.idx,fun:!!x.fun,bidderId,price}; }).sort((a,b)=>a.lot-b.lot);
      c.file=r._file; c.importedAt=new Date().toISOString(); toast(`${c.lots.length} teams imported`); }});
}
/* member names from Golf Genius are sometimes all lowercase or oddly capitalized */
function tidyName(n){ n=String(n||'').trim(); if(!n) return n;
  const cap=w=>w?w[0].toUpperCase()+w.slice(1):w;
  return n.split(/\s+/).map(w=>{
    if(w===w.toLowerCase()) w=w.split(/([-'])/).map(cap).join('');           // all lowercase → capitalize each part
    w=w.replace(/-([a-z])/g,(m,c)=>'-'+c.toUpperCase());                      // Cauley-stein → Cauley-Stein
    if(/^([A-Za-z]\.){2,}$/.test(w)) w=w.toUpperCase();                        // R.d. → R.D.
    return w; }).join(' '); }
const nextBidderNum=c=>c.bidders.reduce((a,b)=>Math.max(a,parseInt(b.num,10)||0),0)+1;

/* ---------- bidders ---------- */
/* type-ahead: members ranked by how closely they match what's typed (field players first) */
function memberMatches(t,q,limit){
  q=String(q||'').trim().toLowerCase().replace(/\s+/g,' '); if(!q) return [];
  if(q.includes(',')){ const [a,b]=q.split(',').map(x=>x.trim()); q=(b+' '+a).trim(); }       // "Last, First"
  const inField=new Set((t.field||[]).map(p=>p.memberId));
  const lev=(a,b)=>{ const d=Array.from({length:a.length+1},(_,i)=>[i]); for(let j=1;j<=b.length;j++) d[0][j]=j;
    for(let i=1;i<=a.length;i++) for(let j=1;j<=b.length;j++) d[i][j]=Math.min(d[i-1][j]+1,d[i][j-1]+1,d[i-1][j-1]+(a[i-1]===b[j-1]?0:1)); return d[a.length][b.length]; };
  const qt=q.split(' ');
  return members().map(m=>{ const name=tidyName(memberName(m)), n=name.toLowerCase(), toks=n.split(/[\s-]+/);
      let sc=0;
      if(n.startsWith(q)) sc=100;
      else if(qt.every(w=>toks.some(x=>x.startsWith(w)))) sc=90;
      else if(n.includes(q)) sc=75;
      else { const best=Math.min(...qt.map(w=>Math.min(...toks.map(x=>lev(w,x.slice(0,Math.max(w.length,1)))))));   // typo-tolerant
        const tol=q.length<=3?0:q.length<=4?1:2; if(best<=tol) sc=60-best*10+(qt.some(w=>toks.some(x=>x[0]===w[0]))?5:0); }
      if(sc&&inField.has(m.id)) sc+=5;
      return {m,name,sc}; }).filter(x=>x.sc>0).sort((a,b)=>b.sc-a.sc||a.name.localeCompare(b.name)).slice(0,limit||6);
}
function editBidder(t,b){
  const c=calc(t), isNew=!b; b=b||{id:uid(),num:nextBidderNum(c),name:'',memberId:'',paid:false,method:''};
  const owed=isNew?{lots:[],total:0}:bidderOwes(c,b);
  let linked=b.memberId||'';
  openDrawer({kicker:t.name+' · Calcutta',title:isNew?'Add bidder':`Bidder #${b.num}`,
    body:`<div class="fld" style="position:relative"><label class="lbl" for="cbName">Name</label>
        <input class="inp" id="cbName" value="${esc(b.name)}" placeholder="Start typing a name…" autocomplete="off" role="combobox" aria-autocomplete="list" aria-controls="cbList" aria-expanded="false">
        <div id="cbList" role="listbox" class="card" style="position:absolute;left:0;right:0;top:100%;margin-top:4px;z-index:5;overflow:hidden;display:none;box-shadow:0 12px 30px rgba(10,28,39,.18)"></div>
        <span class="hint" id="cbWho"></span></div>`+
      field('Bidder number','cbN',b.num,{type:'number'})+
      (()=>{ if(isNew) return ''; const h=calcHoldings(c).find(x=>x.bidderId===b.id); const caps=h?h.stakes.filter(s=>s.kind==='prebuy'||s.kind==='team'):[];
        return caps.length?`<div class="fld"><span class="lbl">Also owns as team captain</span><div class="mini">${caps.map(s=>`<div class="mr num" style="grid-template-columns:50px minmax(0,1fr) 120px"><span class="muted">Lot ${s.lot.lot}</span><span class="trunc">${esc(teamName(s.lot))}</span><b class="r">${s.pct}% · ${s.kind==='prebuy'?'pre-bought':'own team'}</b></div>`).join('')}</div></div>`:''; })()+
      (owed.lots.length?`<div class="fld"><span class="lbl">Bought</span><div class="mini">${owed.lots.map(l=>`<div class="mr num" style="grid-template-columns:50px minmax(0,1fr) 90px"><span class="muted">Lot ${l.lot}</span><span class="trunc">${esc(teamName(l))}</span><b class="r">${fmt(l.price)}</b></div>`).join('')}<div class="mr num" style="grid-template-columns:minmax(0,1fr) 90px"><b>Owes</b><b class="r">${fmt(owed.total)}</b></div></div></div>`:'')+
      pair(field('Paid','cbPaid',b.paid?'yes':'',{type:'select',options:[['','Not yet'],['yes','Paid']]}),field('Paid by','cbMeth',b.method||'',{type:'select',options:[['','—'],['Cash','Cash'],['Zelle','Zelle'],['Credit card','Credit card'],['Check','Check']]})),
    wire:r=>{ const inp=r.querySelector('#cbName'), list=r.querySelector('#cbList'), who=r.querySelector('#cbWho');
      let hits=[], cur=0;
      const other=id=>c.bidders.find(x=>x!==b&&x.memberId&&x.memberId===id);
      const showWho=()=>{ const m=linked&&memberById(linked); const o=m&&other(m.id);
        who.innerHTML=m?`Member: <b>${esc(tidyName(memberName(m)))}</b>${(t.field||[]).some(p=>p.memberId===m.id)?' · in this tournament':''}${o?` · <span class="neg">already bidder #${esc(o.num)}</span>`:''}`:(inp.value.trim()?'Guest — not matched to a member':''); };
      const close=()=>{ list.style.display='none'; inp.setAttribute('aria-expanded','false'); };
      const pick=h=>{ linked=h.m.id; inp.value=h.name; close(); showWho(); };
      const draw=()=>{ hits=memberMatches(t,inp.value,6); cur=0;
        if(!hits.length){ close(); return; }
        list.innerHTML=hits.map((h,k)=>{ const o=other(h.m.id); return `<div role="option" data-k="${k}" aria-selected="${k===cur}" style="padding:9px 12px;cursor:pointer;display:flex;justify-content:space-between;gap:10px;${k===cur?'background:#F6ECCF':''}"><span>${esc(h.name)}</span><span class="muted" style="font-size:12px">${o?'#'+esc(o.num):(t.field||[]).some(p=>p.memberId===h.m.id)?'in field':''}</span></div>`; }).join('');
        list.style.display='block'; inp.setAttribute('aria-expanded','true');
        list.querySelectorAll('[data-k]').forEach(d=>d.onmousedown=e=>{ e.preventDefault(); pick(hits[+d.dataset.k]); }); };
      inp.oninput=()=>{ linked=''; draw(); showWho(); };
      inp.onkeydown=e=>{ if(list.style.display==='none'){ if(e.key==='ArrowDown'){ draw(); e.preventDefault(); } return; }
        if(e.key==='ArrowDown'||e.key==='ArrowUp'){ cur=(cur+(e.key==='ArrowDown'?1:-1)+hits.length)%hits.length; list.querySelectorAll('[data-k]').forEach((d,k)=>{ d.style.background=k===cur?'#F6ECCF':''; d.setAttribute('aria-selected',k===cur); }); e.preventDefault(); }
        else if(e.key==='Enter'||e.key==='Tab'){ if(hits[cur]){ pick(hits[cur]); if(e.key==='Enter') e.preventDefault(); } }
        else if(e.key==='Escape'){ close(); e.stopPropagation(); } };
      inp.onblur=()=>setTimeout(close,120);
      showWho(); },
    save:()=>{ const num=String(fv('cbN')).trim(), name=tidyName(fv('cbName'));
      if(!num){ toast('Give the bidder a number'); return false; } if(!name){ toast('Enter a name'); return false; }
      if(c.bidders.some(x=>x!==b&&String(x.num)===num)){ toast(`Bidder #${num} is already taken`); return false; }
      const dup=linked&&c.bidders.find(x=>x!==b&&x.memberId===linked); if(dup){ toast(`${name} is already bidder #${dup.num}`); return false; }
      Object.assign(b,{num,name,memberId:linked,paid:fv('cbPaid')==='yes',method:fv('cbMeth')}); if(isNew) c.bidders.push(b); c.bidders.sort((a,z)=>(+a.num||0)-(+z.num||0)); },
    del:isNew?null:()=>{ if(owed.lots.length&&!confirm(`Bidder #${b.num} bought ${owed.lots.length} team${owed.lots.length>1?'s':''}. Remove them anyway? Those sales will show no buyer.`)) return false;
      c.lots.forEach(l=>{ if(l.bidderId===b.id) l.bidderId=''; }); c.bidders=c.bidders.filter(x=>x!==b); },delLabel:'Remove bidder'});
}
/* clear every bidder number (confirmed; warns when any of them already bought a team) */
function clearBidders(t){
  const c=calc(t); if(!c.bidders.length){ toast('There are no bidder numbers to remove'); return; }
  const buyers=c.bidders.filter(b=>bidderOwes(c,b).lots.length), sales=c.lots.filter(l=>l.bidderId&&n0(l.price)>0);
  openDrawer({kicker:t.name+' · Calcutta',title:'Remove all bidder numbers?',saveLabel:`Remove all ${c.bidders.length}`,
    body:`<p style="margin:0">This removes all <b>${c.bidders.length}</b> bidder numbers so you can start numbering again. It can’t be undone.</p>
      ${buyers.length?`<div class="banner" style="background:#F8E6DF;border-color:#EBC2B3;color:#6E2A1B"><b>${buyers.length} of these bidders already bought teams</b> (${sales.length} sale${sales.length===1?'':'s'}). The prices stay recorded, but those lots will show no buyer until you assign one again.</div>`
        :'<p class="hint">No sales are recorded against these bidders.</p>'}
      <label class="check"><input type="checkbox" id="clrOk"> Yes, remove every bidder number</label>`,
    save:()=>{ if(!$('clrOk').checked){ toast('Tick the box to confirm'); return false; }
      const n=c.bidders.length; c.lots.forEach(l=>{ l.bidderId=''; }); c.bidders=[]; toast(`${n} bidder numbers removed`); }});
}
function bulkBidders(t){
  const c=calc(t), players=(t.field||[]).map(p=>memberById(p.memberId)).filter(Boolean);
  const have=new Set(c.bidders.map(b=>b.memberId).filter(Boolean)), add=players.filter(m=>!have.has(m.id)).sort((a,z)=>(a.last||'').localeCompare(z.last||'')||memberName(a).localeCompare(memberName(z)));
  openDrawer({kicker:t.name+' · Calcutta',title:'Number the players',saveLabel:add.length?`Add ${add.length} bidders`:'Close',
    body:`<p style="margin:0">Gives every player in this tournament’s field a bidder number, in last-name order. Players who already have a number keep it.</p>`+
      field('Start numbering at','cbStart',nextBidderNum(c),{type:'number'})+`<p class="hint">${add.length} players to add · ${have.size} already numbered${!(t.field||[]).length?' · this tournament has no field yet — import it on the Field tab':''}.</p>`,
    save:()=>{ if(!add.length) return; let n=Math.max(1,parseInt(fv('cbStart'),10)||nextBidderNum(c)); const taken=new Set(c.bidders.map(b=>String(b.num)));
      add.forEach(m=>{ while(taken.has(String(n))) n++; c.bidders.push({id:uid(),num:String(n),name:tidyName(memberName(m)),memberId:m.id,paid:false,method:''}); taken.add(String(n)); n++; });
      c.bidders.sort((a,z)=>(+a.num||0)-(+z.num||0)); toast(`${add.length} bidders numbered`); }});
}

/* ---------- selling ---------- */
function editLot(t,l){
  const c=calc(t); if(l&&l.isPool) return editPool(t);
  const st=l.prebuy?'prebuy':l.pooled?'pool':(n0(l.price)>0?'sold':'open'), bi=buyInOf(c), own=ownership(c,Object.assign({},l,{prebuy:false}));
  openDrawer({kicker:`${t.name} · Lot ${l.lot}`,title:teamName(l),
    body:`<p class="muted" style="margin:0">${esc(flightName(l.flight))} · team index ${idxTxt2(l.idx)}${l.i1!=null&&l.i2!=null?` · ${esc(l.p1)} ${idxTxt2(l.i1)} · ${esc(l.p2)} ${idxTxt2(l.i2)}`:''}</p>`+
      `<div class="fld"><span class="lbl">Result</span>${seg('clS',[['sold','Sold'],['pool','Into the pool'],['open','Not sold yet']].concat(bi.on?[['prebuy','Pre-bought']]:[]),st)}</div>`+
      `<div id="clSold">${pair(field('Bidder number','clB',(bidderById(c,l.bidderId)||{}).num||'',{ph:'e.g. 27',hint:'<span id="clBn"></span>'}),field('Sold for','clP',n0(l.price)||'',{type:'number',ph:'0',hint:c.minBid?`Minimum bid ${fmt(c.minBid)}`:''}))}</div>`+
      `<p class="hint" id="clPoolNote">Goes into the pool — auctioned with the other unsold teams as Lot ${poolLot(c)&&l.pooled?poolLot(c).lot:poolLotNum(c)}.</p>`+
      (bi.on?`<div class="fld"><span class="lbl">Team captain — the team’s buyer, paid its ${bi.pct}% (100% if pre-bought)</span>${seg('clCap',[['0',`${esc(l.p1)} · ${capIndexTxt(l,0)}`],['1',`${esc(l.p2)} · ${capIndexTxt(l,1)}`]],String(capIdx(l)))}<span class="hint">${l.capSet?'Set by hand.':l.capFlag?'<span class="neg">Couldn’t tell from the handicap indexes — check this.</span>':'Lower Handicap Index.'}${(()=>{ const cb=captainBidder(c,l); return cb?` Paddle #${esc(cb.num)}.`:' No paddle — the team’s share stays with the captain by name.'; })()}</span></div>
      <p class="hint" id="clPreNote">The team buys the rest of itself for ${fmt(bi.prebuyExtra)} more (${fmt(n0(bi.amount)+n0(bi.prebuyExtra))} in all), owns 100%, and is skipped in the auction.</p>
      <p class="hint" id="clOwnNote">The buyer gets ${own.buyer}% · the team keeps ${own.team}% (its ${fmt(bi.amount)} buy-in).</p>
      <div class="fld" id="clAuc"><span class="lbl">Auction purchase — paid by the buyer</span><div class="mini"><div class="mr" style="grid-template-columns:minmax(0,1fr) auto"><span id="clAucTxt">${(()=>{ const bb=bidderById(c,l.bidderId); if(l.pooled) return `In the pool — paid by the pool’s buyer${c.pool&&c.pool.bidderId?' ('+esc(bidderLabel(bidderById(c,c.pool.bidderId)))+')':''}`; if(!(n0(l.price)>0)||!bb) return 'Not sold yet'; return `${esc(bidderLabel(bb))} · ${fmt(l.price)} · ${bb.paid?'<b class="pos">paid'+(bb.method?' by '+esc(bb.method):'')+'</b>':'<b class="neg">not paid</b>'}`; })()}</span><span class="muted" style="font-size:12px">marked on the bidder</span></div></div></div>
      <div class="fld"><span class="lbl">Team buy-in · ${fmt(bi.amount)} — ${fmt(n0(bi.amount)/(teamPlayers(l).length||1))} collected from each player; the team’s share (${l.prebuy?'100%':bi.pct+'%'}) pays out to the captain</span>
        <div class="mini">${teamPlayers(l).map((nm,k)=>{ const pp=(l.buyInP||[])[k]||{}; return `<div class="mr" style="grid-template-columns:minmax(0,1fr) 150px"><span class="trunc"><b>${esc(nm)}</b> <span class="muted">· ${fmt(n0(bi.amount)/(teamPlayers(l).length||1))}</span></span><select class="inp" id="clBi${k}" aria-label="${esc(nm)} buy-in payment" style="height:34px"><option value="">Not paid</option>${PAY_METHODS.map(m=>`<option${pp.paid&&pp.method===m?' selected':''}>${m}</option>`).join('')}</select></div>`; }).join('')}</div></div>
      <div class="fld" id="clPb"><span class="lbl">Pre-buy · ${fmt(bi.prebuyExtra)} — ${fmt(n0(bi.prebuyExtra)/(teamPlayers(l).length||1))} collected from each player</span>
        <div class="mini">${teamPlayers(l).map((nm,k2)=>{ const pp=(l.prebuyP||[])[k2]||{}; return `<div class="mr" style="grid-template-columns:minmax(0,1fr) 150px"><span class="trunc"><b>${esc(nm)}</b> <span class="muted">· ${fmt(n0(bi.prebuyExtra)/(teamPlayers(l).length||1))}</span></span><select class="inp" id="clPb${k2}" aria-label="${esc(nm)} pre-buy payment" style="height:34px"><option value="">Not paid</option>${PAY_METHODS.map(m=>`<option${pp.paid&&pp.method===m?' selected':''}>${m}</option>`).join('')}</select></div>`; }).join('')}</div></div>`:'')+
      pair(field('Lot number','clL',l.lot,{type:'number'}),field('Flight','clF',l.flight)),
    wire:r=>{ const upd=()=>{ const b=bidderByNum(c,r.querySelector('#clB').value); r.querySelector('#clBn').textContent=r.querySelector('#clB').value?(b?b.name:'No bidder with that number yet — it will be added'):''; }; r.querySelector('#clB').oninput=upd; upd();
      const mode=()=>{ const v=r.querySelector('#clS').dataset.val; r.querySelector('#clSold').style.display=v==='sold'?'':'none'; r.querySelector('#clPoolNote').style.display=v==='pool'?'':'none';
        const pn=r.querySelector('#clPreNote'); if(pn){ pn.style.display=v==='prebuy'?'':'none'; r.querySelector('#clOwnNote').style.display=v==='sold'||v==='pool'?'':'none'; r.querySelector('#clPb').style.display=v==='prebuy'?'':'none'; r.querySelector('#clAuc').style.display=v==='prebuy'?'none':''; } };
      wireSeg(r,'clS',mode); mode(); },
    save:()=>{ const mode=$('clS').dataset.val, lotNo=parseInt(fv('clL'),10)||l.lot, fl=fv('clF');
      if(mode==='prebuy'){ setPrebuy(c,l,true); }
      else if(mode==='pool'){ setPrebuy(c,l,false); setPooled(c,l,true); }
      else if(mode==='open'){ setPrebuy(c,l,false); setPooled(c,l,false); l.price=0; l.bidderId=''; }
      else { const num=String(fv('clB')).trim(), price=fnum('clP');
        if(!(price>0)){ toast('Enter the price, or choose Into the pool / Not sold yet'); return false; }
        if(!num){ toast('Enter the bidder number'); return false; }
        if(c.minBid&&price<c.minBid&&!confirm(`${fmt(price)} is under the ${fmt(c.minBid)} minimum. Record it as sold anyway?\n\nCancel, then choose “Into the pool” to send the team to the pool instead.`)) return false;
        let b=bidderByNum(c,num); if(!b){ b={id:uid(),num,name:'Bidder '+num,memberId:'',paid:false,method:''}; c.bidders.push(b); c.bidders.sort((a,z)=>(+a.num||0)-(+z.num||0)); }
        setPrebuy(c,l,false); setPooled(c,l,false); l.bidderId=b.id; l.price=price; }
      teamPlayers(l).forEach((_,k)=>{ const el=$('clBi'+k); if(el) setBuyInPay(l,k,{paid:!!el.value,method:el.value}); }); delete l.buyIn;
      if(l.prebuy) teamPlayers(l).forEach((_,k2)=>{ const el=$('clPb'+k2); if(el) setPrebuyPay(l,k2,{paid:!!el.value,method:el.value}); });
      const capEl=$('clCap'); if(capEl&&+capEl.dataset.val!==capIdx(l)){ l.cap=+capEl.dataset.val; l.capSet=true; l.capFlag=false; }
      l.lot=lotNo; l.flight=fl; c.lots.sort((a,z)=>a.lot-z.lot); }});
}
function editPool(t){
  const c=calc(t), p=poolLot(c); if(!p){ toast('No teams are in the pool'); return; }
  openDrawer({kicker:`${t.name} · Lot ${p.lot}`,title:`The Pool — ${p.count} team${p.count===1?'':'s'}`,
    body:`<p style="margin:0">Teams that didn’t reach the ${fmt(c.minBid)} minimum, sold together to one bidder. The price is shared by the flights in proportion to their teams in the pool.</p>
      <div class="mini">${p.teams.map(l=>`<div class="mr num" style="grid-template-columns:minmax(0,1fr) auto"><div class="cell2" style="min-width:0"><b style="white-space:normal">${esc(teamName(l))}</b><small class="muted">Lot ${l.lot} · ${esc(flightName(l.flight))}</small></div><button class="btn sm" type="button" data-unpool="${l.id}">Take out</button></div>`).join('')}</div>`+
      pair(field('Bidder number','cpB',(bidderById(c,c.pool.bidderId)||{}).num||'',{ph:'e.g. 27',hint:'<span id="cpBn"></span>'}),field('Sold for','cpP',n0(c.pool.price)||'',{type:'number',ph:'0'})),
    wire:r=>{ const upd=()=>{ const b=bidderByNum(c,r.querySelector('#cpB').value); r.querySelector('#cpBn').textContent=r.querySelector('#cpB').value?(b?b.name:'No bidder with that number yet — it will be added'):''; }; r.querySelector('#cpB').oninput=upd; upd();
      r.querySelectorAll('[data-unpool]').forEach(bt=>bt.onclick=()=>{ const l=c.lots.find(x=>x.id===bt.dataset.unpool); if(!l) return;
        if(n0(c.pool.price)>0&&poolTeams(c).length>1&&!confirm(`The pool already sold for ${fmt(c.pool.price)}. Taking this team out leaves that price with ${poolTeams(c).length-1} team${poolTeams(c).length-1===1?'':'s'}. Continue?`)) return;
        setPooled(c,l,false); persist(); closeDrawer(); render(); toast(`${teamName(l)} taken out of the pool — record its sale from the Lots list`); }); },
    save:()=>{ const num=String(fv('cpB')).trim(), price=fnum('cpP');
      if(price>0&&!num){ toast('Enter the bidder number'); return false; }
      let b=num?bidderByNum(c,num):null; if(num&&!b){ b={id:uid(),num,name:'Bidder '+num,memberId:'',paid:false,method:''}; c.bidders.push(b); c.bidders.sort((a,z)=>(+a.num||0)-(+z.num||0)); }
      c.pool={bidderId:price>0&&b?b.id:'',price:price>0?price:0}; }});
}
function editBuyIn(t){
  const c=calc(t), bi=buyInOf(c);
  openDrawer({kicker:t.name+' · Calcutta',title:'Team buy-in & pre-buy',
    body:`<p style="margin:0">Not every Calcutta does this — turn it on only for the ones that do.</p><label class="check"><input type="checkbox" id="biOn"${bi.on?' checked':''}> Teams own part of themselves before the auction</label>
      <div id="biOpts">`+pair(field('Team owns','biPct',bi.pct,{type:'number',hint:'% of its own team'}),field('Buy-in per team','biAmt',bi.amount,{type:'number',hint:'e.g. $300 ($150 a player)'}))+
      field('Pre-buy the rest for','biX',bi.prebuyExtra,{type:'number',hint:'Extra at registration; the team then owns 100% and isn’t auctioned.'})+
      `<p class="hint" id="biSum"></p></div>`,
    wire:r=>{ const u=()=>{ const a=parseFloat(r.querySelector('#biAmt').value)||0, x=parseFloat(r.querySelector('#biX').value)||0, p=parseFloat(r.querySelector('#biPct').value)||0;
      r.querySelector('#biSum').textContent=`Auctioned teams: the buyer gets ${100-p}%, the team keeps ${p}% for ${fmt(a)}. Pre-bought teams pay ${fmt(a+x)} in all. Buy-ins go into each team’s flight pot.`;
      r.querySelector('#biOpts').style.opacity=r.querySelector('#biOn').checked?'1':'.45'; };
      ['#biAmt','#biX','#biPct'].forEach(k=>r.querySelector(k).oninput=u); r.querySelector('#biOn').onchange=u; u(); },
    save:()=>{ const on=$('biOn').checked;
      if(!on&&c.lots.some(l=>l.prebuy)&&!confirm(`${c.lots.filter(l=>l.prebuy).length} teams are marked pre-bought. Turning the buy-in off puts them back into the auction. Continue?`)) return false;
      if(!on) c.lots.forEach(l=>{ l.prebuy=false; });
      c.buyIn={on,pct:fnum('biPct'),amount:fnum('biAmt'),prebuyExtra:fnum('biX')}; }});
}
function editMinBid(t){
  const c=calc(t);
  openDrawer({kicker:t.name+' · Calcutta',title:'Minimum bid',
    body:field('Minimum bid','cmB',c.minBid||'',{type:'number',hint:'Teams that don’t reach it go into the pool, auctioned together as one lot after the last team. Leave blank for no minimum.'}),
    save:()=>{ c.minBid=fnum('cmB')||0; }});
}
function runAuction(t,startId){
  const c=calc(t); if(!c.lots.length){ toast('Import the team sheet first'); return; }
  let seq=auctionSeq(c), i=startId?seq.findIndex(l=>l.id===startId):seq.findIndex(l=>!l.pooled&&!(n0(l.price)>0)&&!(l.isPool&&l.price>0)); if(i<0) i=0;
  const addBidder=num=>{ let x=bidderByNum(c,num); if(!x){ x={id:uid(),num,name:'Bidder '+num,memberId:'',paid:false,method:''}; c.bidders.push(x); c.bidders.sort((a,z)=>(+a.num||0)-(+z.num||0)); } return x; };
  const draw=r=>{ seq=auctionSeq(c); if(i>=seq.length) i=seq.length-1; const l=seq[i], nx=seq[i+1], tot=calcTotals(t), b=bidderById(c,l.bidderId), P=!!l.isPool;
    const status=l.pooled?`<b style="color:#E8A08A">in the pool (Lot ${poolLotNum(c)})</b>`:(n0(l.price)>0?`<b style="color:#D8B75F">sold ${fmt(l.price)} to ${esc(bidderLabel(b))}</b>`:'');
    r.innerHTML=`<div class="card pad" style="display:flex;gap:18px;align-items:center;background:var(--navy);color:#fff;border-color:var(--navy)">
        <div style="text-align:center;min-width:92px"><div style="font-size:11px;font-weight:800;letter-spacing:.14em;color:#D8B75F">LOT</div><div style="font-family:var(--serif,Georgia);font-size:52px;font-weight:700;line-height:1">${l.lot}</div><div style="font-size:12px;color:#AEB8BE">${P?'the pool':'of '+c.lots.length}</div></div>
        <div style="min-width:0">${P?`<div style="font-family:var(--serif,Georgia);font-size:26px;font-weight:700;line-height:1.15">The Pool</div><div style="margin-top:6px;color:#C9CFD2;font-size:13.5px">${l.count} team${l.count===1?'':'s'} that didn’t reach ${fmt(c.minBid)}, sold together${l.price>0?` · <b style="color:#D8B75F">sold ${fmt(l.price)} to ${esc(bidderLabel(b))}</b>`:''}</div>`
          :`<div style="font-family:var(--serif,Georgia);font-size:26px;font-weight:700;line-height:1.15">${esc(l.p1)}<br>${esc(l.p2)}</div><div style="margin-top:6px;color:#C9CFD2;font-size:13.5px">${esc(flightName(l.flight))} · team index ${idxTxt2(l.idx)}${status?' · '+status:''}</div>`}</div></div>
      ${P?`<div class="mini" style="max-height:220px;overflow:auto">${l.teams.map(x=>`<div class="mr num" style="grid-template-columns:60px minmax(0,1fr) 80px"><span class="muted">Lot ${x.lot}</span><span class="trunc">${esc(teamName(x))}</span><span class="muted">${esc(flightName(x.flight))}</span></div>`).join('')}</div>`:''}
      ${pair(field('Bidder number','raB',b?b.num:'',{ph:'e.g. 27',hint:'<span id="raBn"></span>'}),field('Price','raP',n0(l.price)||'',{type:'number',ph:'0',hint:!P&&c.minBid?`Minimum ${fmt(c.minBid)}`:''}))}
      <div class="actions"><button class="btn pri" type="button" id="raSold" style="flex:1">${P?'Sold':'Sold — next lot'}</button>${P?'':`<button class="btn" type="button" id="raPool">No sale → pool</button>`}<button class="btn" type="button" id="raPrev"${i===0?' disabled':''}>‹ Back</button><button class="btn" type="button" id="raSkip"${i>=seq.length-1?' disabled':''}>Skip</button></div>
      <div class="mini">${[['Pot',fmt(tot.pot)],['Sold',`${tot.sold} of ${tot.auctionLots}${tot.prebuy?` · ${tot.prebuy} pre-bought`:''}`],['In the pool',tot.pooled?`${tot.pooled} team${tot.pooled===1?'':'s'} · Lot ${tot.poolLot}`:'none'],['Top price',fmt(tot.top)]].map(([a,v])=>`<div class="mr num" style="grid-template-columns:minmax(0,1fr) auto"><span class="muted">${a}</span><b>${v}</b></div>`).join('')}</div>
      ${nx?`<p class="hint">Up next: Lot ${nx.lot} · ${esc(teamName(nx))}${nx.isPool?'':' · '+esc(flightName(nx.flight))}</p>`:(P?'<p class="hint">The pool is the final lot.</p>':`<p class="hint">Last team.${poolTeams(c).length?` The pool (Lot ${poolLotNum(c)}) comes up next.`:''}</p>`)}`;
    const bIn=r.querySelector('#raB'), pIn=r.querySelector('#raP'), bn=r.querySelector('#raBn');
    const upd=()=>{ const x=bidderByNum(c,bIn.value); bn.textContent=bIn.value?(x?x.name:'New bidder number — it will be added'):''; }; bIn.oninput=upd; upd();
    const next=()=>{ seq=auctionSeq(c); if(i<seq.length-1) i++; draw(r); };
    const toPool=()=>{ setPooled(c,l,true); persist(); toast(`${teamName(l)} → the pool (Lot ${poolLotNum(c)})`); next(); };
    const sell=()=>{ const num=String(bIn.value).trim(), price=parseFloat(String(pIn.value).replace(/[$,]/g,''))||0;
      if(!P&&!(price>0)){ if(confirm('No price entered. Send this team to the pool?')) toPool(); else pIn.focus(); return; }
      if(price>0&&!num){ toast('Enter the bidder number'); bIn.focus(); return; }
      if(!P&&c.minBid&&price<c.minBid){ if(confirm(`${fmt(price)} is under the ${fmt(c.minBid)} minimum.\n\nOK sends the team to the pool. Cancel lets you change the price.`)) toPool(); else pIn.focus(); return; }
      const x=num?addBidder(num):null;
      if(P) c.pool={bidderId:price>0&&x?x.id:'',price:price>0?price:0};
      else { setPooled(c,l,false); l.bidderId=price>0&&x?x.id:''; l.price=price>0?price:0; }
      persist(); if(P){ toast('The pool is sold'); draw(r); } else next(); };
    r.querySelector('#raSold').onclick=sell;
    const pb=r.querySelector('#raPool'); if(pb) pb.onclick=toPool;
    [bIn,pIn].forEach(e=>e.onkeydown=ev=>{ if(ev.key==='Enter'){ ev.preventDefault(); if(e===bIn) pIn.focus(); else sell(); } });
    r.querySelector('#raPrev').onclick=()=>{ i=Math.max(0,i-1); draw(r); };
    r.querySelector('#raSkip').onclick=next;
    setTimeout(()=>bIn.focus(),30);
  };
  openDrawer({kicker:t.name+' · Calcutta',title:'Run the auction',saveLabel:'Done',wide:true,body:'<div id="raBody" style="display:flex;flex-direction:column;gap:14px"></div>',wire:r=>draw(r.querySelector('#raBody')),save:()=>{}});
}

/* ---------- expenses + payout ---------- */
function editCalcExpense(t,e){
  const c=calc(t), isNew=!e; e=e||{id:uid(),desc:'',amount:0,notes:''}; const n=calcTotals(t).flights.length||1;
  openDrawer({kicker:t.name+' · Calcutta',title:isNew?'Add expense':e.desc,
    body:field('What','ceD',e.desc,{ph:'e.g. Players Auction dinner'})+field('Amount','ceA',e.amount||'',{type:'number'})+field('Notes','ceN',e.notes||'')+
      `<p class="hint">Comes out of the pot evenly: <b id="ceS"></b> from each of the ${n} flights.</p>`,
    wire:r=>{ const u=()=>{ r.querySelector('#ceS').textContent=fmt((parseFloat(r.querySelector('#ceA').value)||0)/n); }; r.querySelector('#ceA').oninput=u; u(); },
    save:()=>{ const d=fv('ceD'); if(!d){ toast('Describe the expense'); return false; } Object.assign(e,{desc:d,amount:fnum('ceA'),notes:fv('ceN')}); if(isNew) c.expenses.push(e); },
    del:isNew?null:()=>{ c.expenses=c.expenses.filter(x=>x!==e); },delLabel:'Remove expense'});
}
function editPayout(t){
  const c=calc(t);
  openDrawer({kicker:t.name+' · Calcutta',title:'Payout by place',
    body:`<p style="margin:0">Each flight’s net pot (after its share of expenses) pays these places.</p><div class="mini" id="cpRows">${c.payout.map((p,i)=>`<div class="mr num" style="grid-template-columns:90px 110px 28px"><span>${['1st','2nd','3rd','4th','5th','6th','7th','8th'][i]||(i+1)+'th'}</span><input class="inp r" data-cp="${i}" value="${p}" inputmode="decimal" aria-label="Place ${i+1} percent"><span class="muted">%</span></div>`).join('')}</div>
      <div class="actions"><button class="btn sm" type="button" id="cpAdd">+ Place</button><button class="btn sm" type="button" id="cpRm"${c.payout.length<2?' disabled':''}>− Place</button></div><p class="hint" id="cpSum"></p>`,
    wire:r=>{ let P=c.payout.slice(); const sum=()=>{ const s=P.reduce((a,p)=>a+n0(p),0); r.querySelector('#cpSum').innerHTML=Math.abs(s-100)<0.01?'Adds up to 100%.':`<span class="neg">Adds up to ${s}% — usually 100%.</span>`; };
      const bind=()=>r.querySelectorAll('[data-cp]').forEach(i=>i.oninput=()=>{ P[+i.dataset.cp]=parseFloat(i.value)||0; sum(); }); bind(); sum();
      const redraw=()=>{ r.querySelector('#cpRows').innerHTML=P.map((p,i)=>`<div class="mr num" style="grid-template-columns:90px 110px 28px"><span>${['1st','2nd','3rd','4th','5th','6th','7th','8th'][i]||(i+1)+'th'}</span><input class="inp r" data-cp="${i}" value="${p}" inputmode="decimal"><span class="muted">%</span></div>`).join(''); bind(); sum(); };
      r.querySelector('#cpAdd').onclick=()=>{ P.push(0); redraw(); }; r.querySelector('#cpRm').onclick=()=>{ if(P.length>1){ P.pop(); redraw(); } }; r._P=()=>P; },
    save:()=>{ c.payout=$('dBody')._P().map(n0); }});
}

/* ---------- the tab ---------- */
function tCalcutta(el,t){
  const c=calc(t), T2=calcTotals(t);
  if(!c.lots.length){ el.innerHTML=`<div class="card"><div class="empty"><b>No Calcutta teams yet</b><span>Upload the auction-order spreadsheet (or the team sheet). The lot order, flights and indexes come in, ready for bidder numbers and sales.</span><button class="btn pri" id="ccImp">${I.down}Upload team sheet</button></div></div>`; $('ccImp').onclick=()=>importCalcutta(t); return; }
  view.cclot=view.cclot||'all'; view.ccTab=view.ccTab||'lots';
  const allSeq=c.lots.concat(poolLot(c)?[poolLot(c)]:[]);
  view.ccLQ=view.ccLQ||''; view.ccBQ=view.ccBQ||'';
  const lots=allSeq.filter(l=>lotMatches(c,l,view.ccLQ)).filter(l=>{ const v=view.cclot; if(l.isPool) return v==='all'||v==='pool';
    if(v==='all') return true; if(v==='open') return !l.prebuy&&!l.pooled&&!(n0(l.price)>0); if(v==='pool') return l.pooled&&!l.prebuy;
    if(v==='prebuy') return l.prebuy; if(v==='due') return teamParts(c,l).some(p=>!p.pay.paid); return flightName(l.flight)===v; });
  const plc=['1st','2nd','3rd','4th','5th','6th','7th','8th'];
  const BI=buyInOf(c).on, fcols=`grid-template-columns:minmax(86px,1fr) 70px ${BI?'100px 100px ':''}100px 100px 100px ${c.payout.map(()=>'86px').join(' ')}`;
  const lcols='grid-template-columns:54px minmax(0,1.6fr) 84px 70px minmax(0,1fr) 100px 40px';
  el.innerHTML=`
  <div class="grid g4">${kpi('Pot',fmt(T2.pot),`${T2.sold} of ${T2.auctionLots} auctioned sold${T2.prebuy?` · ${T2.prebuy} pre-bought`:''}`)}${kpi('Expenses',fmt(T2.exp),`${fmt(T2.share)} from each of ${T2.flights.length} flights`)}${kpi('Net to flights',fmt(T2.net),'after expenses',T2.net>=0?'pos':'neg')}${kpi('Top price',fmt(T2.top),T2.sold?`average ${fmt(T2.avg)}`:'no sales yet')}</div>
  <div class="toolbar"><div class="actions"><button class="btn pri" id="ccRun">Run the auction</button><button class="btn" id="ccExp">${I.down}Export results</button></div>
    <span class="muted" style="margin-left:auto;font-size:13px">${c.file?esc(c.file)+' · ':''}${c.bidders.length} bidders</span></div>
  ${(()=>{ const n=(k,l,x)=>`<button class="${view.ccTab===k?'on':''}" data-cctab="${k}">${l}${x!=null&&x!==''?` <span class="cnt">${x}</span>`:''}</button>`;
    return `<div class="subtabs" role="tablist">${n('lots','Lots',c.lots.length)}${n('bidders','Bidders',c.bidders.length)}${n('buyers','Buyers &amp; shares',calcHoldings(c).length)}${n('money','Money','')}${n('results','Results',c.lots.some(l=>c0(l.place)>0)?'✓':'')}${n('payouts','Payouts',(()=>{ const PP=calcPayouts(c), owe=PP.people.filter(p=>!((c.paidOut||{})[p.key]||{}).paid).length; return PP.people.length?(owe?owe+' to pay':'✓'):''; })())}${n('setup','Setup','')}</div>`; })()}
  <div class="cc-pane" data-pane="lots"${view.ccTab!=='lots'?' hidden':''}>
  ${missingTeamsBanner(t)}
  <div class="actions" style="justify-content:flex-end"><button class="btn" id="ccOrd">${I.down}Download order (Excel)</button><button class="btn" id="ccSheet">${I.down}Bidder sheet (PDF)</button></div>
  <div class="card cc-card cc-lots" style="overflow:hidden"><div class="cardhead"><div><h2 class="h2">Lots</h2><span class="muted">Click a lot to record or change a sale</span></div>
    <div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap;justify-content:flex-end">${searchBox('ccLQ',view.ccLQ,'Find a lot, player or paddle #')}<div class="seg">${[['all','All'],['open','Unsold']].concat(poolTeams(c).length?[['pool','Pool']]:[]).concat(buyInOf(c).on?[['prebuy','Pre-bought'],['due','Team payment due']]:[]).concat(T2.flights.map(f=>[f,f.replace('Flight ','F')])).map(([k,l])=>`<button class="${view.cclot===k?'on':''}" data-ccf="${esc(k)}">${esc(l)}</button>`).join('')}</div></div></div>
    <div class="tw"><div class="t keep" style="min-width:760px"><div class="tr th" style="${lcols}"><span>Lot</span><span>Team</span><span>Flight</span><span class="r">Index</span><span>Bought by</span><span class="r">Price</span><span></span></div>
    ${lots.map(l=>{ const b=bidderById(c,l.bidderId);
      if(l.isPool) return `<div class="tr num click cc-lot" data-cl="__pool" style="${lcols};background:#F6ECCF"><b class="l-n">${l.lot}</b><span class="trunc l-t"><b>The Pool</b> · ${l.count} team${l.count===1?'':'s'} under ${fmt(c.minBid)}</span><span class="muted l-f">Mixed</span><span class="l-i"></span><span class="trunc l-b">${l.price>0?esc(bidderLabel(b)):'<span class="muted">—</span>'}</span><b class="r l-p">${l.price>0?fmt(l.price):''}</b><span class="ib l-e">${I.edit}</span></div>`;
      return `<div class="tr num click cc-lot" data-cl="${l.id}" style="${lcols}${l.pooled?';opacity:.72':''}"><b class="l-n">${l.lot}</b><span class="trunc l-t">${l.fun?'<span style="color:var(--gold)" title="Fun team">★</span> ':''}${esc(teamName(l))}</span><span class="muted l-f">${esc(flightName(l.flight))}</span><span class="r muted l-i">${idxTxt2(l.idx)}</span><span class="trunc l-b">${l.prebuy?`<span class="chip ok">Pre-bought · ${esc(captainName(l))}${(()=>{ const cb=captainBidder(c,l); return cb?' #'+esc(cb.num):''; })()}</span>`:l.pooled?`<span class="chip">In the pool · Lot ${poolLotNum(c)}</span>`:n0(l.price)>0?esc(bidderLabel(b)):'<span class="muted">—</span>'}${(()=>{ const due=teamParts(c,l).filter(p=>!p.pay.paid), bd=due.filter(p=>p.kind==='buyin'), n=teamPlayers(l).length; return (bd.length?` <span class="chip warn" title="${esc(bd.map(p=>p.name).join(', '))} not paid">buy-in due${bd.length<n?' · '+esc(bd.map(p=>p.name.split(' ')[0]).join(', ')):''}</span>`:'')+(()=>{ const pd=due.filter(p=>p.kind==='prebuy'); return pd.length?` <span class="chip warn" title="${esc(pd.map(p=>p.name).join(', '))} not paid">pre-buy due${pd.length<n?' · '+esc(pd.map(p=>p.name.split(' ')[0]).join(', ')):''}</span>`:''; })(); })()}</span><b class="r l-p">${l.prebuy?fmt(teamDue(c,l)):!l.pooled&&n0(l.price)>0?fmt(l.price):''}</b><span class="ib l-e">${I.edit}</span></div>`; }).join('')||`<div class="empty" style="padding:22px"><span>No lots match${view.ccLQ?` “${esc(view.ccLQ)}”`:''}.</span></div>`}
    </div></div></div>
  </div>
  <div class="cc-pane" data-pane="bidders"${view.ccTab!=='bidders'?' hidden':''}>
    <div class="card cc-card" style="overflow:hidden"><div class="cardhead"><div><h2 class="h2">Bidders</h2><span class="muted">${c.bidders.filter(b=>b.paid&&bidderOwes(c,b).total>0).length} of ${c.bidders.filter(b=>bidderOwes(c,b).total>0).length} buyers paid · ${fmt(c.bidders.filter(b=>!b.paid).reduce((a,b)=>a+bidderOwes(c,b).total,0))} still owed</span></div>${searchBox('ccBQ',view.ccBQ,'Find a paddle #, name or lot')}<div class="actions">${c.bidders.length?`<button class="btn sm" id="ccClr">Remove all numbers</button>`:''}<button class="btn sm" id="ccBulk">Number the players</button><button class="btn sm" id="ccAddB">${I.plus}Add</button></div></div>
      ${bidderListHTML(t)}</div>
  
  </div>
  <div class="cc-pane" data-pane="buyers"${view.ccTab!=='buyers'?' hidden':''}>
  ${holdingsCard(t)}

  </div>
  <div class="cc-pane" data-pane="money"${view.ccTab!=='money'?' hidden':''}>
  <div class="card cc-card" style="overflow:hidden"><div class="cardhead"><div><h2 class="h2">By flight</h2><span class="muted">Expenses come out evenly across all ${T2.flights.length} flights${T2.pooled?'; the pool’s price is shared by its teams’ flights':''}. Payout by place is from each flight’s net.</span></div><button class="btn sm" id="ccPay">Payout ${c.payout.join(' / ')}%</button></div>
    <div class="ccf-cards">${T2.byF.map(f=>`<div class="ccf"><div class="ccf1"><b>${esc(f.flight)}</b><b class="num ${f.net<0?'neg':''}">${fmt(f.net)} <small class="muted">net</small></b></div><div class="ccf2 num muted">${fmt(f.gross)} gross${f.buyIns?` (${fmt(f.auction+f.fromPool)} auction · ${fmt(f.buyIns)} buy-ins)`:''} · −${fmt(f.share)} expenses · ${f.sold}/${f.teams-f.prebuy} sold${f.pooled?` · ${f.pooled} in pool`:''}${f.prebuy?` · ${f.prebuy} pre-bought`:''}</div><div class="ccf3 num">${c.payout.map((p,i)=>`<span><small class="muted">${plc[i]||i+1}</small> ${fmt(f.places[i])}</span>`).join('')}</div></div>`).join('')}
      <div class="ccf" style="background:var(--ivory)"><div class="ccf1"><b>Total</b><b class="num">${fmt(T2.net)} <small class="muted">net</small></b></div><div class="ccf2 num muted">${fmt(T2.pot)} gross · −${fmt(T2.exp)} expenses · ${T2.sold}/${T2.lots} sold</div></div></div>
    <div class="tw ccf-table"><div class="t" style="min-width:${(BI?760:560)+c.payout.length*86}px"><div class="tr th" style="${fcols}"><span>Flight</span><span class="r">Sold</span>${BI?'<span class="r">Auction</span><span class="r">Buy-ins</span>':''}<span class="r">Gross</span><span class="r">Expenses</span><span class="r">Net pot</span>${c.payout.map((p,i)=>`<span class="r">${plc[i]||i+1} · ${p}%</span>`).join('')}</div>
    ${T2.byF.map(f=>`<div class="tr num" style="${fcols}"><b>${esc(f.flight)}</b><span class="r muted">${f.sold}/${f.teams-f.prebuy}${f.pooled?` <small title="In the pool">+${f.pooled}P</small>`:''}${f.prebuy?` <small title="Pre-bought">+${f.prebuy}PB</small>`:''}</span>${BI?`<span class="r">${fmt(f.auction+f.fromPool)}</span><span class="r">${fmt(f.buyIns)}</span>`:''}<span class="r">${fmt(f.gross)}</span><span class="r neg">−${fmt(f.share).replace('$','$')}</span><b class="r ${f.net<0?'neg':''}">${fmt(f.net)}</b>${f.places.map(v=>`<span class="r">${fmt(v)}</span>`).join('')}</div>`).join('')}
    <div class="tr num tot" style="${fcols}"><b>Total</b><span class="r">${T2.sold}/${T2.auctionLots}</span>${BI?`<b class="r">${fmt(T2.auctionTotal)}</b><b class="r">${fmt(T2.buyIns)}</b>`:''}<b class="r">${fmt(T2.pot)}</b><b class="r neg">−${fmt(T2.exp)}</b><b class="r">${fmt(T2.net)}</b>${c.payout.map((p,i)=>`<b class="r">${fmt(T2.byF.reduce((a,f)=>a+f.places[i],0))}</b>`).join('')}</div></div></div>
    ${Math.abs(T2.payPct-100)>0.01?`<div class="banner" style="margin:12px 22px 18px">Payout adds up to ${T2.payPct}% of each flight’s net pot.</div>`:''}</div>
  <div class="grid g2" style="align-items:start">
    <div style="display:flex;flex-direction:column;gap:20px">${paymentsCard(t)}
    <div class="card cc-card" style="overflow:hidden"><div class="cardhead"><div><h2 class="h2">Expenses</h2><span class="muted">Paid out of the Calcutta, split evenly by flight</span></div><button class="btn sm" id="ccAddE">${I.plus}Add</button></div>
      ${c.expenses.length?c.expenses.map(e=>`<div class="tr num click cc-exp" data-ce="${e.id}" style="grid-template-columns:minmax(0,1fr) 100px 100px 40px"><div class="cell2"><b class="trunc">${esc(e.desc)}</b>${e.notes?`<small class="trunc">${esc(e.notes)}</small>`:''}</div><span class="r">${fmt(e.amount)}</span><span class="r muted cc-pf">${fmt(n0(e.amount)/(T2.flights.length||1))}/flight</span><span class="ib">${I.edit}</span></div>`).join('')+
        `<div class="tr num tot cc-exp" style="grid-template-columns:minmax(0,1fr) 100px 100px 40px"><b>Total</b><b class="r">${fmt(T2.exp)}</b><b class="r cc-pf">${fmt(T2.share)}/flight</b><span></span></div>`
        :'<div class="empty" style="padding:22px"><span>No expenses yet — for example, the auction dinner.</span></div>'}</div></div>
  </div>
  </div>
  ${(()=>{ const PP=payoutsPane(t); return `<div class="cc-pane" data-pane="results"${view.ccTab!=='results'?' hidden':''}>\n${PP.results}\n  </div>\n  <div class="cc-pane" data-pane="payouts"${view.ccTab!=='payouts'?' hidden':''}>\n${PP.payouts}\n  </div>`; })()}
  <div class="cc-pane" data-pane="setup"${view.ccTab!=='setup'?' hidden':''}>
  ${cashierCard(t)}
  <div class="card pad" style="display:flex;gap:14px 24px;align-items:center;flex-wrap:wrap"><div class="cell2" style="flex:1 1 320px"><span class="lbl">Minimum bid</span><b style="font-size:18px">${c.minBid?fmt(c.minBid):'None'}</b><small class="muted">${c.minBid?`Teams that don’t reach it go into the pool, auctioned together as Lot ${T2.poolLot||poolLotNum(c)}.`:'Every team sells for whatever it brings.'}${T2.pooled?` <b>${T2.pooled} team${T2.pooled===1?'':'s'} in the pool${T2.poolPrice?` · sold ${fmt(T2.poolPrice)}`:''}.</b>`:''}</small></div><div class="actions">${T2.pooled?`<button class="btn sm" id="ccPool">The pool</button>`:''}<button class="btn sm" id="ccMin">Change minimum</button></div>
    <div class="cell2" style="flex:1 1 320px;border-top:1px solid var(--line);padding-top:12px"><span class="lbl">Team buy-in</span>${(()=>{ const bi=buyInOf(c), PP=calcPayments(c); return bi.on?`<b style="font-size:16px">Each team owns ${bi.pct}% for ${fmt(bi.amount)} (${fmt(n0(bi.amount)/2)} a player) · pre-buy the rest for ${fmt(bi.prebuyExtra)} more (${fmt(n0(bi.amount)+n0(bi.prebuyExtra))})</b><small class="muted">${T2.prebuy} team${T2.prebuy===1?'':'s'} pre-bought — skipped in the auction. Buy-ins: ${PP.g.buyin.countPaid} of ${PP.g.buyin.count} players paid; ${fmt(PP.biPaid)} of ${fmt(PP.biDue)} in.</small>`:'<b style="font-size:16px">Off for this Calcutta</b><small class="muted">Buyers get 100% of the teams they buy. Turn it on if teams own part of themselves or can pre-buy.</small>'; })()}</div>
    <div class="actions" style="border-top:1px solid var(--line);padding-top:12px"><button class="btn sm" id="ccBi">${buyInOf(c).on?'Buy-in settings':'Turn on buy-in'}</button></div></div>
  <div class="card pad" style="display:flex;gap:14px 24px;align-items:center;flex-wrap:wrap"><div class="cell2" style="flex:1 1 320px"><span class="lbl">Team sheet</span><b>${c.file?esc(c.file):'Uploaded team sheet'}</b><small class="muted">${c.lots.length} teams${c.importedAt?' · imported '+new Date(c.importedAt).toLocaleString([], {month:'short',day:'numeric',hour:'numeric',minute:'2-digit'}):''}. Re-uploading keeps every sale already recorded.</small></div><div class="actions"><button class="btn" id="ccAddF2">${I.plus}Add teams from the field${fieldTeamsMissing(t).length?` (${fieldTeamsMissing(t).length})`:''}</button><button class="btn" id="ccImp">${I.down}Upload team sheet</button></div></div>

  </div>
`;
  el.querySelectorAll('[data-cctab]').forEach(b=>b.onclick=()=>{ view.ccTab=b.dataset.cctab; el.querySelectorAll('.cc-pane').forEach(p=>p.hidden=p.dataset.pane!==view.ccTab); el.querySelectorAll('[data-cctab]').forEach(x=>x.classList.toggle('on',x===b)); });
  $('ccRun').onclick=()=>runAuction(t); wirePayouts(el,t); const af=$('ccAddF'); if(af) af.onclick=()=>addFieldTeams(t); const af2=$('ccAddF2'); if(af2) af2.onclick=()=>addFieldTeams(t); const co=$('ccOrd'); if(co) co.onclick=()=>exportOrder(t); const cs=$('ccSheet'); if(cs) cs.onclick=()=>downloadBidSheet(t); $('ccImp').onclick=()=>importCalcutta(t); $('ccExp').onclick=()=>exportCalcutta(t);
  $('ccPay').onclick=()=>editPayout(t); $('ccCash').onclick=()=>editCash(t);
  const sh=$('ccShare'); if(sh) sh.onclick=()=>startCashierLink(t);
  const cp=$('ccCopy'); if(cp) cp.onclick=async()=>{ const l=cashierLink(t); try{ await navigator.clipboard.writeText(l); toast('Link copied'); }catch(_){ prompt('Copy this link:',l); } };
  const st=$('ccStop'); if(st) st.onclick=()=>stopCashierLink(t); $('ccMin').onclick=()=>editMinBid(t); $('ccBi').onclick=()=>editBuyIn(t); const pbn=$('ccPool'); if(pbn) pbn.onclick=()=>editPool(t); $('ccAddE').onclick=()=>editCalcExpense(t,null); $('ccAddB').onclick=()=>editBidder(t,null); $('ccBulk').onclick=()=>bulkBidders(t);
  const cl=$('ccClr'); if(cl) cl.onclick=()=>clearBidders(t);
  el.querySelectorAll('[data-ce]').forEach(r=>r.onclick=()=>editCalcExpense(t,c.expenses.find(e=>e.id===r.dataset.ce)));
  el.querySelectorAll('[data-cbx]').forEach(r=>r.onclick=e=>{ if(e.target.closest('[data-cbe]')) return; const id=r.dataset.cbx; view.ccOpen=view.ccOpen||{}; view.ccOpen[id]=!view.ccOpen[id]; render(); });
  el.querySelectorAll('[data-cbe]').forEach(b=>b.onclick=e=>{ e.stopPropagation(); editBidder(t,c.bidders.find(x=>x.id===b.dataset.cbe)); });
  el.querySelectorAll('[data-cbf]').forEach(b=>b.onclick=()=>{ view.ccBF=b.dataset.cbf; render(); });
  const ea=$('ccExpAll'); if(ea) ea.onclick=()=>{ const ids=bidderRows(t).map(x=>x.b.id); view.ccOpen=view.ccOpen||{}; const open=!ids.every(id=>view.ccOpen[id]); ids.forEach(id=>view.ccOpen[id]=open); render(); };
  el.querySelectorAll('[data-cl]').forEach(r=>r.onclick=()=>r.dataset.cl==='__pool'?editPool(t):editLot(t,c.lots.find(l=>l.id===r.dataset.cl)));
  el.querySelectorAll('[data-ccf]').forEach(b=>b.onclick=()=>{ view.cclot=b.dataset.ccf; render(); });
  wireSearch('ccLQ','ccLQ'); wireSearch('ccBQ','ccBQ'); wireSearch('ccHq','ccH');
}
/* results workbook: lots, bidders (what each owes), flights with expenses and payouts */
async function exportCalcutta(t){
  const c=calc(t), T2=calcTotals(t); try{ await loadXLSX(); }catch(e){ toast(e.message); return; }
  const wb=XLSX.utils.book_new();
  const pl=poolLot(c);
  const lots=[['Lot','Team','Flight','Team index','Bidder #','Bought by','Price','Result','Buyer paid','Buyer paid by','Player 1 buy-in','Player 1 paid','Player 1 paid by','Player 2 buy-in','Player 2 paid','Player 2 paid by','Player 1 pre-buy','Player 1 pre-buy paid','Player 1 pre-buy paid by','Player 2 pre-buy','Player 2 pre-buy paid','Player 2 pre-buy paid by']].concat(c.lots.map(l=>{ const b=bidderById(c,l.bidderId); return [l.lot,teamName(l),flightName(l.flight),l.idx,l.pooled?'':(b?b.num:''),l.pooled?'':(b?b.name:''),l.pooled?'':(n0(l.price)||''),l.prebuy?'Pre-bought':l.pooled?`In the pool (Lot ${pl.lot})`:(n0(l.price)>0?'Sold':''),b&&!l.pooled&&n0(l.price)>0?(b.paid?'Yes':'No'):'',b&&b.paid&&!l.pooled?b.method||'':'',
      ...[0,1].flatMap(k=>{ const pp=(l.buyInP||[])[k]||{}, nm=teamPlayers(l)[k]; return buyInOf(c).on&&nm?[n0(buyInOf(c).amount)/(teamPlayers(l).length||1),pp.paid?'Yes':'No',pp.paid?pp.method||'':'']:['','','']; }),...[0,1].flatMap(k2=>{ const pp=(l.prebuyP||[])[k2]||{}, nm=teamPlayers(l)[k2]; return l.prebuy&&nm?[n0(buyInOf(c).prebuyExtra)/(teamPlayers(l).length||1),pp.paid?'Yes':'No',pp.paid?pp.method||'':'']:['','','']; })]; }))
    .concat(pl?[[pl.lot,`The Pool: ${pl.teams.map(teamName).join('; ')}`,'Mixed','',(bidderById(c,pl.bidderId)||{}).num||'',(bidderById(c,pl.bidderId)||{}).name||'',pl.price||'','Pool']]:[]);
  XLSX.utils.book_append_sheet(wb,XLSX.utils.aoa_to_sheet(lots),'Lots');
  const bid=[['Bidder #','Name','Teams','Owes','Paid','Paid by']].concat(c.bidders.map(b=>{ const o=bidderOwes(c,b); return [b.num,b.name,o.lots.map(l=>'Lot '+l.lot).join(', '),o.total,b.paid?'Yes':'',b.method||'']; }));
  XLSX.utils.book_append_sheet(wb,XLSX.utils.aoa_to_sheet(bid),'Bidders');
  { const PO=calcPayouts(c);
    XLSX.utils.book_append_sheet(wb,XLSX.utils.aoa_to_sheet([['Flight','Finish','Lot','Team','Team payout']].concat(PO.flights.flatMap(f=>f.rows.map(r=>[f.flight,r.label,r.lot.lot,teamName(r.lot),r.amount])))),'Payouts by flight');
    XLSX.utils.book_append_sheet(wb,XLSX.utils.aoa_to_sheet([['Person','Paddle','Lot','Team','Finish','Share %','Amount','Paid out','Method']].concat(PO.people.flatMap(p=>p.items.map(it=>[p.name,p.num,it.lot.lot,teamName(it.lot),it.label,it.pct,it.amount,((c.paidOut||{})[p.key]||{}).paid?'Yes':'',((c.paidOut||{})[p.key]||{}).method||''])).concat([['Total','','','','','',PO.total,'','']]))),'Payouts by person'); }
  XLSX.utils.book_append_sheet(wb,XLSX.utils.aoa_to_sheet([['Buyer','Paddle','Lot','Team','Flight','Share %','How']].concat(calcHoldings(c).flatMap(h=>h.stakes.map(s=>[h.name,h.num||'',s.lot.lot,teamName(s.lot),flightName(s.lot.flight),s.pct,{prebuy:'Pre-bought (captain)',team:'Own team (captain)',auction:'Bought at auction',pool:'Bought the pool'}[s.kind]])))),'Buyers & shares');
  const plc=['1st','2nd','3rd','4th','5th','6th','7th','8th'];
  const fl=[['Flight','Teams sold','Teams in pool','Pre-bought','Pool share','Auction','Buy-ins','Gross','Expense share','Net pot'].concat(c.payout.map((p,i)=>`${plc[i]||i+1} (${p}%)`))].concat(T2.byF.map(f=>[f.flight,f.sold,f.pooled,f.prebuy,f.fromPool,f.auction,f.buyIns,f.gross,f.share,f.net].concat(f.places)))
    .concat([['Total',T2.sold,T2.pooled,T2.prebuy,T2.poolPrice,T2.auctionTotal,T2.buyIns,T2.pot,T2.exp,T2.net].concat(c.payout.map((p,i)=>T2.byF.reduce((a,f)=>a+f.places[i],0)))]);
  XLSX.utils.book_append_sheet(wb,XLSX.utils.aoa_to_sheet(fl),'By flight');
  const P=calcPayments(c); const PK=[['auction','Auction purchases'],['buyin','Team buy-ins'],['prebuy','Pre-buys']];
  XLSX.utils.book_append_sheet(wb,XLSX.utils.aoa_to_sheet([['Method'].concat(PK.map(x=>x[1])).concat(['Total'])].concat(PAY_METHODS.map(m=>[m].concat(PK.map(([k])=>P.g[k].by[m])).concat([P.by[m]]))).concat(P.notRecorded?[['Method not recorded'].concat(PK.map(([k])=>P.g[k].by.notRecorded)).concat([P.notRecorded])]:[]).concat([['Collected'].concat(PK.map(([k])=>P.g[k].paid)).concat([P.collected]),['Still owed'].concat(PK.map(([k])=>P.g[k].owed)).concat([P.outstanding]),[],['Starting cash',c0(c.cashFloat)],['Should be in the drawer',P.expectedCash],['Cash counted',P.cashCount==null?'':P.cashCount],['Over (+) / short (−)',P.overShort==null?'':P.overShort]])),'Payments');
  XLSX.utils.book_append_sheet(wb,XLSX.utils.aoa_to_sheet([['Expense','Amount','Per flight','Notes']].concat(c.expenses.map(e=>[e.desc,n0(e.amount),n0(e.amount)/(T2.flights.length||1),e.notes||'']))),'Expenses');
  XLSX.writeFile(wb,`${(t.name||'Tournament').replace(/[^\w]+/g,'-')}-Calcutta-${new Date().toISOString().slice(0,10)}.xlsx`);
}

/* ============ Cashier link: share this Calcutta with the cashiers' laptops ============ */
const cashierLink=t=>SITE_BASE+'cashier.html?k='+encodeURIComponent(calc(t).share.token);
const newToken=()=>Array.from(crypto.getRandomValues(new Uint8Array(24)),b=>'abcdefghijkmnpqrstuvwxyz23456789'[b%32]).join('');
/* create, replace or (token null) turn off a shared cashier / check-in row; admin links go through the database function */
function shareRow(tid,token,name,doc){ return KEYMODE?keyRPC('hub_key_share',{p_tid:tid,p_token:token,p_name:name,p_doc:doc})
  :token?sb.from('calcutta_share').upsert({tid,token,name,doc,version:1,updated_at:new Date().toISOString()}):sb.from('calcutta_share').update({token:null}).eq('tid',tid); }
function calcPeople(t){ return (t.field||[]).map(p=>{ const m=memberById(p.memberId); return m?{id:m.id,name:tidyName(memberName(m))}:null; }).filter(Boolean).sort((a,b)=>a.name.localeCompare(b.name)); }
const SHARE_ST={};
/* the last cashier copy this device merged with — needed to tell what changed here; kept per device */
const shareBase={ get(t){ const c=calc(t); if(c._base){ this.set(t,c._base,c._ver); delete c._base; delete c._ver; }   // move older shared copies here
    try{ return JSON.parse(localStorage.getItem('mga_cbase_'+t.id)||'null'); }catch(_){ return null; } },
  set(t,doc,ver){ try{ localStorage.setItem('mga_cbase_'+t.id,JSON.stringify({doc,ver})); }catch(_){} } };
const shareSt=t=>Object.assign({},calc(t).share||{},SHARE_ST[t.id]||{});
async function calcShareSync(t){
  const c=calc(t); if(!c.share||!c.share.token||!CLOUD||!sessionOK) return false;
  c.people=calcPeople(t); c.name=t.name;
  const sb0=shareBase.get(t); calcStamp(c,sb0&&sb0.doc);
  const token=c.share.token;
  const get=async()=>{ const {data,error}=await sb.rpc('calcutta_get',{p_token:token}); if(error) throw new Error(error.message); if(!data) throw new Error('The cashier link is off'); return data; };
  const put=async(doc,ver)=>{ const {data,error}=await sb.rpc('calcutta_put',{p_token:token,p_doc:doc,p_version:ver}); if(error) throw new Error(error.message); return data; };
  try{
    const before=calcStable(calcDoc(c));
    const res=await calcSyncOnce(get,put,calcDoc(c));
    const d=JSON.parse(JSON.stringify(res.doc)); CALC_KINDS.forEach(k=>{ c[k]=c[k]||[]; syncArr(c[k],d[k]||[]); }); CALC_SET.forEach(k=>{ if(d[k]!==undefined&&!sameJ(c[k],d[k])) c[k]=isObj(c[k])&&isObj(d[k])?syncTo(c[k],d[k]):d[k]; }); c._su=d._su||0; c._del=d._del||[];
    shareBase.set(t,JSON.parse(JSON.stringify(res.doc)),res.version); SHARE_ST[t.id]={state:'live',at:new Date().toISOString(),msg:''};
    return calcStable(calcDoc(c))!==before;
  }catch(e){ SHARE_ST[t.id]={state:'error',msg:e.message,at:(SHARE_ST[t.id]||{}).at}; return false; }
}
let calcShareTimer=null, calcShareBusy=false;
async function calcShareAll(){
  if(calcShareBusy) return; const ts=db.tournaments.filter(t=>t.calcutta&&t.calcutta.share&&t.calcutta.share.token); if(!ts.length) return;
  db.tournaments.forEach(x=>{ const sh=x.calcutta&&x.calcutta.share; if(sh&&('state' in sh||'at' in sh||'msg' in sh)) x.calcutta.share={token:sh.token,created:sh.created}; if(x.calcutta&&x.calcutta._base) shareBase.get(x); });
  const dataBefore=stable(db);
  calcShareBusy=true; let changed=false;
  try{ for(const t of ts) changed=(await calcShareSync(t))||changed; } finally{ calcShareBusy=false; }
  if(stable(db)!==dataBefore){ if(typeof syncSuppress!=='undefined'){ syncSuppress=true; persist(); syncSuppress=false; } else persist(); }
  if(changed&&view.page==='tournament'&&view.ttab==='calcutta') render();
}
function calcStampNow(){ for(const t of db.tournaments){ const c=t.calcutta; if(!(c&&c.share&&c.share.token)) continue; const b0=shareBase.get(t); if(b0&&b0.doc) calcStamp(c,b0.doc); } }
function calcAfterPersist(){ if(calcShareBusy||!CLOUD||!sessionOK) return; if(!db.tournaments.some(t=>t.calcutta&&t.calcutta.share&&t.calcutta.share.token)) return; clearTimeout(calcShareTimer); calcShareTimer=setTimeout(calcShareAll,700); }
setInterval(()=>{ if(document.visibilityState==='visible'&&!calcShareBusy&&db.tournaments.some(t=>t.calcutta&&t.calcutta.share&&t.calcutta.share.token)) calcShareAll(); },view&&view.ttab==='calcutta'?3000:4000);
async function startCashierLink(t){
  const c=calc(t); if(!CLOUD||!sessionOK){ toast('The cashier link needs the cloud sign-in'); return; }
  const token=newToken(); c.people=calcPeople(t); c.name=t.name; c._del=c._del||[];
  const doc=calcDoc(c);
  const {error}=await shareRow(t.id,token,t.name,doc);
  if(error){ toast(/relation|does not exist/i.test(error.message)?'Run calcutta-setup.sql in Supabase to turn on cashier links':'Couldn’t create the link: '+error.message); return; }
  c.share={token,created:new Date().toISOString()}; SHARE_ST[t.id]={state:'live',at:new Date().toISOString()}; shareBase.set(t,JSON.parse(JSON.stringify(doc)),1);
  persist(); render(); toast('Cashier link ready');
}
function stopCashierLink(t){
  const c=calc(t);
  openDrawer({kicker:t.name+' · Calcutta',title:'Turn off the cashier link?',saveLabel:'Turn it off',
    body:'<p style="margin:0">Anyone with the link loses access right away. Everything they recorded stays in the hub. You can create a new link later — it will have a different address.</p>',
    save:()=>{ (async()=>{ await calcShareAll(); await shareRow(t.id,null,t.name,null); delete c.share; persist(); render(); toast('Cashier link turned off'); })(); }});
}
function editCash(t){
  const c=calc(t), P=calcPayments(c);
  openDrawer({kicker:t.name+' · Calcutta',title:'Cash drawer',
    body:field('Starting cash in the drawer','ccFl',c.cashFloat??'',{type:'number',hint:'Change the cashiers started with, if any.'})+
      field('Cash counted','ccCt',c.cashCount??'',{type:'number',hint:`Expected: ${fmt(P.expectedCash)} (starting cash + ${fmt(P.by.Cash)} cash payments). Leave blank until you count.`}),
    save:()=>{ const f=fv('ccFl'), k=fv('ccCt'); c.cashFloat=f===''?null:fnum('ccFl'); c.cashCount=k===''?null:fnum('ccCt'); }});
}
function paymentsCard(t){
  const c=calc(t), P=calcPayments(c), T2=calcTotalsC(c), BI=buyInOf(c).on;
  const K=BI?[['auction','Auction'],['buyin','Buy-ins'],['prebuy','Pre-buys']]:[['auction','Auction']];
  const cols=`grid-template-columns:minmax(0,1fr) ${K.map(()=>'86px').join(' ')}${BI?' 92px':''}`;
  const line=(label,vals,tot,cls='')=>`<div class="tr num ${cls}" style="${cols}"><span>${label}</span>${vals.map(v=>`<span class="r">${v}</span>`).join('')}${BI?`<b class="r">${tot}</b>`:''}</div>`;
  const rows=PAY_METHODS.map(m=>line(m,K.map(([k])=>fmt(P.g[k].by[m])),fmt(P.by[m])))
    .concat(P.notRecorded?[line('<span class="neg">Paid, method not recorded</span>',K.map(([k])=>fmt(P.g[k].by.notRecorded)),fmt(P.notRecorded))]:[]);
  return `<div class="card cc-card" style="overflow:hidden"><div class="cardhead"><div><h2 class="h2">Payments</h2><span class="muted">${BI?'Auction purchases are paid by the buyer; buy-ins and pre-buys are paid by the team.':`${P.paid} of ${P.buyers} buyers paid`}</span></div><button class="btn sm" id="ccCash">Count cash</button></div>
    <div class="tw"><div class="t" style="min-width:${BI?420:260}px"><div class="tr th" style="${cols}"><span>Method</span>${K.map(([,l])=>`<span class="r">${l}</span>`).join('')}${BI?'<span class="r">Total</span>':''}</div>
    ${rows.join('')}
    ${line('<b>Collected</b>',K.map(([k])=>`<b>${fmt(P.g[k].paid)}</b>`),fmt(P.collected),'tot')}
    ${line('Still owed',K.map(([k])=>P.g[k].owed?`<span class="neg">${fmt(P.g[k].owed)}</span>`:fmt(0)),P.outstanding?`<span class="neg">${fmt(P.outstanding)}</span>`:fmt(0))}
    ${BI?line('<span class="muted">Paid</span>',K.map(([k])=>`<span class="muted">${P.g[k].countPaid} of ${P.g[k].count}${k==='buyin'?' players':k==='prebuy'?' teams':' buyers'}</span>`),''):''}</div></div>
    <div class="tr num" style="grid-template-columns:minmax(0,1fr) 110px"><span class="muted">Pot</span><span class="r muted">${fmt(T2.pot)}</span></div>
    <div style="padding:12px 22px 16px;border-top:1px solid var(--line);display:flex;flex-direction:column;gap:6px">
      <span class="lbl">Cash drawer</span>
      <div class="mini">${[['Starting cash',fmt(c0(c.cashFloat))],['+ Cash payments (all kinds)',fmt(P.by.Cash)],['Should be in the drawer',fmt(P.expectedCash)],['Counted',P.cashCount==null?'—':fmt(P.cashCount)]].map(([a,v])=>`<div class="mr num" style="grid-template-columns:minmax(0,1fr) auto"><span class="muted">${a}</span><b>${v}</b></div>`).join('')}
      ${P.overShort==null?'':`<div class="mr num" style="grid-template-columns:minmax(0,1fr) auto"><b>${Math.abs(P.overShort)<0.005?'Balanced':P.overShort>0?'Over':'Short'}</b><b class="${Math.abs(P.overShort)<0.005?'pos':'neg'}">${Math.abs(P.overShort)<0.005?'✓':fmt(Math.abs(P.overShort))}</b></div>`}</div></div></div>`;
}
function cashierCard(t){
  const c=calc(t);
  if(!c.share) return `<div class="card pad" style="display:flex;gap:14px 24px;align-items:center;flex-wrap:wrap"><div class="cell2" style="flex:1 1 340px"><span class="lbl">Cashier link</span><b>Let the cashiers record sales and payments from their laptops</b><small class="muted">A private link — no board password. Sales, bidders and payments they enter show up here within seconds, and yours show up for them.${!CLOUD||!sessionOK?' Needs the cloud sign-in.':''}</small></div><button class="btn pri" id="ccShare"${!CLOUD||!sessionOK?' disabled':''}>Create cashier link</button></div>`;
  const link=cashierLink(t), s=shareSt(t);
  return `<div class="card pad" style="display:flex;gap:14px 24px;align-items:center;flex-wrap:wrap;border-color:${s.state==='error'?'#EBC2B3':'#BCD9C7'}"><div class="cell2" style="flex:1 1 340px;min-width:0"><span class="lbl">Cashier link · ${s.state==='error'?'<span class="neg">problem</span>':'<span class="pos">● live</span>'}</span><a href="${esc(link)}" target="_blank" rel="noopener" class="trunc" style="font-weight:600">${esc(link)}</a><small class="muted">${s.state==='error'?esc(s.msg||''):'In sync'+(s.at?' · '+new Date(s.at).toLocaleTimeString([], {hour:'numeric',minute:'2-digit',second:'2-digit'}):'')} · anyone with this link can record sales and payments for this Calcutta.</small></div>
    <div class="actions"><button class="btn sm" id="ccCopy">Copy link</button><a class="btn sm" href="${esc(link)}" target="_blank" rel="noopener">Open</a><button class="btn sm" id="ccStop">Turn off</button></div></div>`;
}

/* search: a lot matches its number, either player, the captain, the buyer's name or paddle */
function lotMatches(c,l,q){ q=String(q||'').trim().toLowerCase().replace(/^#/,''); if(!q) return true;
  if(l.isPool){ const b=bidderById(c,l.bidderId); return /pool/.test(q)||String(l.lot)===q||(b&&(String(b.num)===q||b.name.toLowerCase().includes(q)))||l.teams.some(x=>lotMatches(c,x,q)); }
  if(String(l.lot)===q) return true;
  const b=bidderById(c,l.bidderId), cb=l.prebuy?captainBidder(c,l):null, pb=l.pooled&&c.pool&&bidderById(c,c.pool.bidderId);
  if(/^\d+$/.test(q)) return [b,cb,pb].some(x=>x&&String(x.num)===q);   // a bare number is a lot or a paddle, exactly
  const hay=[l.p1,l.p2,flightName(l.flight),b&&b.name,pb&&pb.name,cb&&cb.name].filter(Boolean).join(' ').toLowerCase();
  if(hay.includes(q)) return true;
  return [b,cb,pb].some(x=>x&&String(x.num)===q);
}
function bidderMatches(c,b,q){ q=String(q||'').trim().toLowerCase().replace(/^#/,''); if(!q) return true;
  if(String(b.num)===q||b.name.toLowerCase().includes(q)) return true;
  return bidderOwes(c,b).lots.some(l=>String(l.lot)===q||(!l.isPool&&teamName(l).toLowerCase().includes(q))); }
const searchBox=(id,val,ph)=>`<input class="inp cc-search" id="${id}" type="search" placeholder="${ph}" value="${esc(val||'')}" autocomplete="off" aria-label="${ph}">`;
/* re-render after typing, keeping the cursor in the box */
function wireSearch(id,key){ const i=$(id); if(!i) return; i.oninput=e=>{ view[key]=e.target.value; clearTimeout(window['__s'+id]); window['__s'+id]=setTimeout(()=>{ render(); const n=$(id); if(n){ n.focus(); const L=(view[key]||'').length; try{ n.setSelectionRange(L,L); }catch(_){} } },200); }; }
/* everyone who'll be paid out, paddle or not */
function holdingsCard(t){
  const c=calc(t), H=calcHoldings(c); if(!H.length) return '';
  const flagged=c.lots.filter(l=>l.capFlag&&!l.capSet&&buyInOf(c).on).length;
  view.ccH=view.ccH||'';
  const q=view.ccH.trim().toLowerCase().replace(/^#/,''), rows=H.filter(h=>!q||h.name.toLowerCase().includes(q)||String(h.num||'')===q||h.stakes.some(st=>String(st.lot.lot)===q||teamName(st.lot).toLowerCase().includes(q)));
  return `<div class="card cc-card" style="overflow:hidden"><div class="cardhead"><div><h2 class="h2">Buyers &amp; shares</h2><span class="muted">Everyone who owns part of a team — the people to pay out. Captains own their team’s share with or without a paddle.${flagged?` <span class="neg">${flagged} team${flagged===1?'':'s'} need a captain check.</span>`:''}</span></div>${searchBox('ccHq',view.ccH,'Find a buyer or paddle #')}</div>
    <div style="max-height:460px;overflow:auto">${rows.map(h=>`<div class="tr" style="grid-template-columns:70px minmax(0,1fr) minmax(0,2fr);align-items:start"><b class="num">${h.num?'#'+esc(h.num):'<span class="muted" style="font-weight:500;font-size:12px">no paddle</span>'}</b><b class="trunc">${esc(h.name)}</b>
      <span style="display:flex;flex-wrap:wrap;gap:6px">${h.stakes.map(s=>`<span class="chip ${s.kind==='prebuy'?'ok':s.kind==='team'?'':'gold'}" title="${esc(teamName(s.lot))}">Lot ${s.lot.lot} · ${s.pct}%${s.kind==='prebuy'?' · pre-bought':s.kind==='team'?' · own team':s.kind==='pool'?' · pool':''}</span>`).join('')}</span></div>`).join('')||'<div class="tr"><span class="muted">No one matches.</span></div>'}</div></div>`;
}

/* ============ Auction order export + printable bidder sheets ============ */
async function exportOrder(t){
  const c=calc(t); try{ await loadXLSX(); }catch(e){ toast(e.message); return; }
  const pl=poolLot(c), cap=l=>captainName(l);
  const rows=[['Lot','Team','Player 1','Player 2','Flight','Team index','Captain','Status']].concat(c.lots.map(l=>[l.lot,teamName(l),l.p1,l.p2,flightName(l.flight),l.idx??'',cap(l),l.prebuy?'Pre-bought — not auctioned':l.pooled?`In the pool (Lot ${pl.lot})`:'']));
  if(pl) rows.push([pl.lot,`The Pool — ${pl.teams.map(teamName).join('; ')}`,'','','Mixed','','','Pool']);
  const ws=XLSX.utils.aoa_to_sheet(rows); ws['!cols']=[{wch:5},{wch:38},{wch:20},{wch:20},{wch:9},{wch:10},{wch:20},{wch:26}];
  const wb=XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb,ws,'Auction order');
  XLSX.writeFile(wb,`${(t.name||'Tournament').replace(/[^\w]+/g,'-')}-Calcutta-Order.xlsx`);
}
/* Calcutta bidder sheet — a real PDF file, built in the browser and downloaded. Always blank: every lot
   gets an empty Bought by / Price line (the slideshow shows pre-buys; bettors fill it in themselves). */
function loadJsPDF(){ if(window.jspdf) return Promise.resolve();
  return new Promise((res,rej)=>{ const sc=document.createElement('script'); sc.src='https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js'; sc.onload=()=>res(); sc.onerror=()=>rej(new Error('Couldn’t load the PDF maker — check the connection')); document.head.appendChild(sc); }); }
async function crestPNG(){ const s=typeof crestSrc==='function'?crestSrc():''; if(s&&s.startsWith('data:')) return s;
  const r=await fetch(SITE_BASE+'crest.png'); const b=await r.blob(); return await new Promise(ok=>{ const fr=new FileReader(); fr.onload=()=>ok(fr.result); fr.readAsDataURL(b); }); }
async function downloadBidSheet(t){
  const c=calc(t);
  try{ await loadJsPDF(); }catch(e){ toast(e.message); return; }
  toast('Building the bidder sheet…');
  const crest=await crestPNG().catch(()=>null);
  const doc=new window.jspdf.jsPDF({unit:'pt',format:'letter'});
  [['ps400','PS-400.ttf','PublicSans','normal'],['ps700','PS-700.ttf','PublicSans','bold'],['ps800','PS-800.ttf','PublicSansXB','normal'],['cg700','CG-700.ttf','Cormorant','bold']]
    .forEach(([k,f,fam,st])=>{ doc.addFileToVFS(f,PDF_FONTS[k]); doc.addFont(f,fam,st); });
  const NAVY=[15,42,56], GOLD=[199,161,58], GOLDL=[216,183,95], GOLDDK=[126,95,26], IVORY=[251,250,245], LINE=[225,217,198], INK=[20,34,43], MUTED=[86,98,106], FOOT=[139,149,160], POOL=[246,236,207], SUB=[214,218,220];
  const W=612, H=792, L=36, R=576, CW=R-L, BOTTOM=740;
  const font=(fam,st,size,col)=>{ doc.setFont(fam,st); doc.setFontSize(size); doc.setTextColor(...col); };
  const yr=String(t.season||'').trim();
  const kicker=`${(t.name||'Tournament').toUpperCase()}${yr?' · '+yr:''} · PLAYERS AUCTION`;
  const T2=calcTotalsC(c), pl=poolLotNum(c);
  let pageNo=0; const pages=[];
  function newPage(){ if(pageNo>0) doc.addPage(); pageNo++; doc.setFillColor(...IVORY); doc.rect(0,0,W,H,'F'); pages.push(pageNo); }
  function band(title,sub,compact){
    const y=32, h=compact?46:76;
    doc.setFillColor(...GOLD); doc.roundedRect(L,y,CW,h,8,8,'F');
    doc.setFillColor(...NAVY); doc.roundedRect(L,y,CW,h-4,8,8,'F'); doc.rect(L,y+h-12,CW,8,'F');
    const ch=compact?30:52, cw=ch*914/1180, cx=L+16, cy=y+(h-4-ch)/2;
    if(crest) doc.addImage(crest,'PNG',cx,cy,cw,ch);
    const tx=cx+cw+14;
    font('PublicSansXB','normal',compact?6:6.6,GOLDL); doc.text(kicker,tx,y+(compact?17:22),{charSpace:1.25});
    font('Cormorant','bold',compact?16:25,[255,255,255]); doc.text(title,tx,y+(compact?35:48));
    if(sub&&!compact){ font('PublicSans','normal',8.4,SUB); doc.text(sub,tx,y+63); }
    return y+h+12;
  }
  function table(y,cols,rows,rowH,opt){
    const headH=20, totalH=headH+rows.reduce((a,r)=>a+(r.h||rowH),0);
    doc.setFillColor(255,255,255); doc.setDrawColor(...LINE); doc.setLineWidth(.8); doc.roundedRect(L,y,CW,totalH,8,8,'FD');
    doc.setFillColor(...NAVY); doc.roundedRect(L,y,CW,headH,8,8,'F'); doc.rect(L,y+10,CW,headH-10,'F');
    let x=L; font('PublicSansXB','normal',6.4,[255,255,255]);
    cols.forEach(cl=>{ const tx=cl.align==='center'?x+cl.w/2:cl.align==='right'?x+cl.w-9:x+9; doc.text(cl.h.toUpperCase(),tx,y+13,{align:cl.align||'left',charSpace:.9}); x+=cl.w; });
    let ry=y+headH;
    rows.forEach((r,k)=>{ const rh=r.h||rowH;
      if(r.fill){ doc.setFillColor(...r.fill); if(k===rows.length-1){ doc.roundedRect(L+.4,ry,CW-.8,rh-.4,7,7,'F'); doc.rect(L+.4,ry,CW-.8,rh-8,'F'); } else doc.rect(L+.4,ry,CW-.8,rh,'F'); }
      if(k>0){ doc.setDrawColor(...LINE); doc.setLineWidth(.6); doc.line(L,ry,R,ry); }
      let cx=L; cols.forEach((cl,ci)=>{ const v=r.cells[ci]; if(v){ const mid=ry+(r.top?12:rh/2+3.2);
          if(cl.key==='lot'){ font('PublicSansXB','normal',opt.big?11:9,NAVY); } else if(cl.key==='flight'){ font('PublicSans','bold',8.6,MUTED); } else { font('PublicSans','bold',opt.big?10.6:9,INK); }
          const tx=cl.align==='center'?cx+cl.w/2:cl.align==='right'?cx+cl.w-9:cx+9;
          if(v.label){ font('PublicSansXB','normal',6.2,GOLDDK); doc.text(v.label.toUpperCase(),tx,ry+(r.top?13:rh/2+2.4),{charSpace:.7}); }
          else { const label=String(v.t!=null?v.t:v); doc.text(label,tx,mid,{align:cl.align||'left'}); if(v.sub){ const wd=doc.getTextWidth(label); font('PublicSans','normal',6.8,GOLDDK); doc.text(v.sub,tx+wd+8,mid); } } }
        cx+=cl.w; });
      ry+=rh; });
    // write-in columns get their own rules
    let x2=L; cols.forEach((cl,ci)=>{ if(cl.rule&&ci>0){ doc.setDrawColor(...LINE); doc.setLineWidth(.6); doc.line(x2,y+headH,x2,y+totalH); doc.setDrawColor(46,77,94); doc.line(x2,y+3,x2,y+headH-3); } x2+=cl.w; });
    return y+totalH;
  }
  // ----- auction order: every lot, blank, split evenly over two pages -----
  const orderRows=c.lots.slice().sort((a,b)=>a.lot-b.lot).map(l=>({cells:[{t:l.lot},teamName(l),flightName(l.flight).replace('Flight ',''),'','']}));
  orderRows.push({fill:POOL,cells:[{t:pl},{t:'The Pool',sub:c.minBid?`Teams under the ${fmt(c.minBid)} minimum, sold together`:'Teams sold together'},'—','','']});
  const OC=[{h:'Lot',w:38,align:'center',key:'lot'},{h:'Team',w:228,key:'team'},{h:'Flight',w:44,align:'center',key:'flight'},{h:'Bought by',w:156,key:'buy',rule:true},{h:'Price',w:74,align:'right',key:'price',rule:true}];
  const firstCap=Math.floor((BOTTOM-(32+76+12)-20)/15.5), nextCap=Math.floor((BOTTOM-(32+46+12)-20)/15.5);
  const nOrderPages=orderRows.length<=firstCap?1:1+Math.ceil((orderRows.length-firstCap)/nextCap);
  const per=Math.ceil(orderRows.length/nOrderPages);
  for(let k=0;k<nOrderPages;k++){ newPage();
    const y=k===0?band('Auction Order',`${c.lots.length} teams in auction order${c.minBid?` · minimum bid ${fmt(c.minBid)}`:''}`):band('Auction Order — continued','',true);
    table(y,OC,orderRows.slice(k*per,(k+1)*per),15.5,{}); }
  // ----- one page per flight -----
  const FC=[{h:'Lot',w:46,align:'center',key:'lot'},{h:'Team',w:240,key:'team'},{h:'Bought by',w:170,key:'buy',rule:true},{h:'Price',w:84,align:'right',key:'price',rule:true}];
  T2.flights.forEach(f=>{ newPage();
    const ls=c.lots.filter(l=>flightName(l.flight)===f).sort((a,b)=>a.lot-b.lot);
    const y=band(f,`${ls.length} teams · write in the buyer and price as each team sells`);
    const rows=ls.map(l=>({cells:[{t:l.lot},teamName(l),'','']})).concat([{h:50,top:true,cells:['',{label:'Pool teams from this flight · notes'},'','']}]);
    table(y,FC,rows,31,{big:true});
    // flight total
    const bw=150,bh=44,bx=R-bw,by=BOTTOM-bh;
    doc.setFillColor(255,255,255); doc.setDrawColor(...NAVY); doc.setLineWidth(1.6); doc.roundedRect(bx,by,bw,bh,6,6,'FD');
    font('PublicSansXB','normal',7.4,GOLDDK); doc.text(`${f.toUpperCase()} TOTAL`,bx-14,by+bh/2-1,{align:'right',charSpace:1.1});
    font('PublicSans','normal',7,MUTED); doc.text('Auction prices for this flight’s teams',bx-14,by+bh/2+9,{align:'right'}); });
  // footers
  const N=pages.length;
  for(let p=1;p<=N;p++){ doc.setPage(p); doc.setDrawColor(...LINE); doc.setLineWidth(.6); doc.line(L,H-34,R,H-34);
    font('PublicSansXB','normal',6.4,FOOT); doc.text(`${(t.name||'').toUpperCase()}${yr?' '+yr:''} · CALCUTTA BIDDER SHEET`,L,H-23,{charSpace:.9}); doc.text(`PAGE ${p} OF ${N}`,R,H-23,{align:'right',charSpace:.9}); }
  doc.setProperties({title:`${t.name} — Calcutta Bidder Sheet`,subject:'Players Auction',creator:'MGA Hub'});
  doc.save(`${(t.name||'Tournament').replace(/[^\w]+/g,'-')}-Calcutta-Bidder-Sheet.pdf`);
}

/* ============ Teams in the field that aren't in the Calcutta yet ============ */
function fieldTeamsMissing(t){
  const c=calc(t), byTeam=new Map();
  for(const p of t.field||[]){ if(!p.memberId) continue; const a=byTeam.get(p.team)||[]; a.push(p); byTeam.set(p.team,a); }
  const have=new Set(), haveNames=new Set();
  c.lots.forEach(l=>{ [l.m1,l.m2].filter(Boolean).forEach(id=>have.add(id)); [l.p1,l.p2].forEach(n=>haveNames.add(nameKey(n))); });
  const out=[];
  for(const [team,ps] of byTeam){ if(ps.length<1) continue;
    const ms=ps.map(p=>memberById(p.memberId)).filter(Boolean); if(!ms.length) continue;
    if(ms.some(m=>have.has(m.id)||haveNames.has(nameKey(memberName(m))))) continue;      // already a lot
    const idx=ms.map(m=>typeof parseIndex==='function'?parseIndex(m.hcp):null);
    out.push({team,members:ms,names:ms.map(m=>tidyName(memberName(m))),i:idx,idx:idx.every(v=>v!=null)?Math.round(idx.reduce((a,v)=>a+v,0)*10)/10:null}); }
  return out.sort((a,b)=>a.team-b.team);
}
/* suggest a flight from where the team index falls among the existing flights */
function suggestFlight(c,idx){
  const F=new Map(); c.lots.forEach(l=>{ if(l.idx==null||l.idx==='') return; const f=String(l.flight); const r=F.get(f)||[Infinity,-Infinity]; r[0]=Math.min(r[0],+l.idx); r[1]=Math.max(r[1],+l.idx); F.set(f,r); });
  if(idx==null||!F.size) return [...F.keys()][0]||'';
  let best='',d=Infinity; for(const [f,[lo,hi]] of F){ const dist=idx<lo?lo-idx:idx>hi?idx-hi:0; if(dist<d){ d=dist; best=f; } } return best; }
function addFieldTeams(t){
  const c=calc(t), miss=fieldTeamsMissing(t);
  if(!miss.length){ toast('Every team in the field is already in the Calcutta'); return; }
  const flights=[...new Set(c.lots.map(l=>String(l.flight)))].sort((a,b)=>a.localeCompare(b,undefined,{numeric:true}));
  const next=c.lots.reduce((a,l)=>Math.max(a,+l.lot||0),0)+1;
  openDrawer({kicker:t.name+' · Calcutta',title:`Add ${miss.length===1?'a team':miss.length+' teams'} from the field`,saveLabel:miss.length===1?'Add to the Calcutta':`Add ${miss.length} teams`,
    body:`<p style="margin:0">${miss.length===1?'This team is':'These teams are'} in the tournament field but not in the Calcutta. Pick a flight and a lot number for each; the pool moves to the next number automatically.</p>
      ${miss.map((m,k)=>{ const sug=suggestFlight(c,m.idx); return `<div class="card pad" style="display:flex;flex-direction:column;gap:10px">
        <label class="check" style="font-size:15px"><input type="checkbox" id="afOn${k}" checked> <b>${esc(m.names.join(' & '))}</b> <span class="muted">· Team ${esc(m.team)}${m.idx!=null?` · team index ${idxTxt2(m.idx)}`:''}</span></label>
        ${pair(field('Flight','afF'+k,sug,{type:'select',options:flights.map(f=>[f,flightName(f)]),hint:m.idx!=null&&sug?`Suggested from the team index (${idxTxt2(m.idx)}).`:''}),field('Lot number','afL'+k,next+k,{type:'number',hint:'Defaults to the end of the order. A number already in use moves that lot and the ones after it down one.'}))}</div>`; }).join('')}`,
    save:()=>{ let added=0;
      miss.forEach((m,k)=>{ if(!$('afOn'+k).checked) return;
        const lot=Math.max(1,parseInt(fv('afL'+k),10)||next+k), flight=fv('afF'+k);
        if(c.lots.some(l=>+l.lot===lot)) c.lots.forEach(l=>{ if(+l.lot>=lot) l.lot=+l.lot+1; });   // make room
        c.lots.push({id:uid(),lot,p1:m.names[0],p2:m.names[1]||'',i1:m.i[0],i2:m.i[1]??null,idx:m.idx,flight,fun:false,bidderId:'',price:0,m1:m.members[0].id,m2:(m.members[1]||{}).id||''});
        added++; });
      if(!added){ toast('Nothing selected'); return false; }
      c.lots.sort((a,b)=>a.lot-b.lot); toast(`${added} team${added===1?'':'s'} added to the Calcutta`); }});
}
function missingTeamsBanner(t){ const n=fieldTeamsMissing(t).length; if(!n) return '';
  return `<div class="banner" style="display:flex;align-items:center;gap:12px;flex-wrap:wrap"><span style="flex:1 1 260px"><b>${n} team${n===1?'':'s'} in the field ${n===1?'isn’t':'aren’t'} in the Calcutta yet.</b> ${esc(fieldTeamsMissing(t).map(m=>m.names.join(' & ')).join('; '))}</span><button class="btn sm pri" id="ccAddF">Add to the Calcutta</button></div>`; }

/* ---------- bidders: what each owes, expandable to the lots they bought ---------- */
function bidderRows(t){ const c=calc(t), f=view.ccBF||'all';
  return c.bidders.filter(b=>bidderMatches(c,b,view.ccBQ)).map(b=>({b,o:bidderOwes(c,b)}))
    .filter(({b,o})=>f==='all'||(f==='buyers'?o.total>0:o.total>0&&!b.paid)); }
function bidderListHTML(t){
  const c=calc(t), f=view.ccBF||'all', open=view.ccOpen||{}, rows=bidderRows(t);
  if(!c.bidders.length) return '<div class="empty" style="padding:22px"><span>Add bidders one at a time, or number every player in the field.</span></div>';
  const head=`<div class="bid-bar"><div class="seg">${[['all','All'],['buyers','Buyers'],['unpaid','Unpaid']].map(([k,l])=>`<button class="${f===k?'on':''}" data-cbf="${k}">${l}</button>`).join('')}</div>
    ${rows.some(r=>r.o.lots.length)?`<button class="btn sm" id="ccExpAll">${rows.filter(r=>r.o.lots.length).every(r=>open[r.b.id])?'Collapse all':'Expand all'}</button>`:''}</div>`;
  const body=rows.map(({b,o})=>{ const isOpen=!!open[b.id]&&o.lots.length;
    const lines=o.lots.map(l=>l.isPool
      ?`<div class="bl-row"><span class="bl-n">${l.lot}</span><span class="bl-t"><b>The Pool</b><small>${esc(l.teams.map(x=>'Lot '+x.lot+' '+teamName(x)).join(' · '))}</small></span><span class="bl-f">Pool</span><b class="bl-p">${fmt(l.price)}</b></div>`
      :`<div class="bl-row"><span class="bl-n">${l.lot}</span><span class="bl-t">${esc(teamName(l))}${buyInOf(c).on?`<small>buyer owns ${ownership(c,l).buyer}%</small>`:''}</span><span class="bl-f">${esc(flightName(l.flight))}</span><b class="bl-p">${fmt(l.price)}</b></div>`).join('');
    return `<div class="bid-item${isOpen?' open':''}">
      <div class="tr num click cc-bid" data-cbx="${b.id}" style="grid-template-columns:22px 56px minmax(0,1fr) 70px 104px 74px 40px" aria-expanded="${isOpen}">
        <span class="chev">${o.lots.length?(isOpen?'▾':'▸'):''}</span><b>#${esc(b.num)}</b><span class="trunc">${esc(b.name)}</span>
        <span class="r muted cc-n">${o.lots.length?`${o.lots.length} lot${o.lots.length===1?'':'s'}`:''}</span>
        <b class="r">${o.total?fmt(o.total):'<span class="muted" style="font-weight:500">—</span>'}</b>
        <span class="r">${o.total?(b.paid?`<span class="chip ok">Paid</span>`:'<span class="chip warn">Owes</span>'):''}</span>
        <span class="ib" data-cbe="${b.id}" title="Edit bidder" role="button">${I.edit}</span></div>
      ${isOpen?`<div class="bid-detail">${lines}<div class="bl-row tot"><span class="bl-n"></span><span class="bl-t"><b>Total owed</b><small>${b.paid?`Paid${b.method?' by '+esc(b.method):''}`:'Not paid yet'}</small></span><span class="bl-f"></span><b class="bl-p">${fmt(o.total)}</b></div></div>`:''}</div>`; }).join('');
  return head+(body||`<div class="tr"><span class="muted">No bidders match${view.ccBQ?` “${esc(view.ccBQ)}”`:''}.</span></div>`);
}

