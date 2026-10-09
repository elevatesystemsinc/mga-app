/* ---------- payouts ----------
   Each team gets a finish (l.place) within its flight; equal numbers are ties. There is no tie-breaker:
   tied teams share the combined money for every place they cover (two tied for 1st split 1st + 2nd). */
const ordinal=n=>{ const s=['th','st','nd','rd'], v=n%100; return n+(s[(v-20)%10]||s[v]||s[0]); };
function calcPayouts(c){
  const T=calcTotalsC(c), stakes=calcStakes(c), byLot=new Map(); stakes.forEach(s=>{ const a=byLot.get(s.lot.id)||[]; a.push(s); byLot.set(s.lot.id,a); });
  const cents=v=>Math.round(v*100)/100, flights=[], people=new Map();
  for(const f of T.byF){
    const ls=c.lots.filter(l=>flightName(l.flight)===f.flight), placed=ls.filter(l=>c0(l.place)>0).sort((a,b)=>c0(a.place)-c0(b.place));
    const money=c.payout.map(p=>Math.max(0,f.net)*c0(p)/100), rows=[]; let i=0;
    while(i<placed.length){ const grp=placed.filter(l=>c0(l.place)===c0(placed[i].place)), start=i, end=i+grp.length-1;
      const pot=money.slice(start,end+1).reduce((a,v)=>a+v,0), potC=Math.round(pot*100), base=Math.floor(potC/grp.length), extra=potC-base*grp.length;
      grp.sort((a,b)=>a.lot-b.lot);
      const label=(grp.length>1?'T':'')+ordinal(start+1);
      grp.forEach((l,gi)=>rows.push({lot:l,pos:start+1,label,tie:grp.length,covers:[start+1,Math.min(end+1,money.length)],amount:start<money.length?(base+(gi<extra?1:0))/100:0}));
      i+=grp.length; }
    const covered=new Set(); rows.forEach(r=>{ for(let p=r.pos;p<r.pos+r.tie;p++) covered.add(p); });
    const unplaced=money.map((m,k)=>({place:k+1,m})).filter(x=>x.m>0&&!covered.has(x.place)), allPlaced=ls.length>0&&ls.every(l=>c0(l.place)>0);
    flights.push({flight:f.flight,net:f.net,money,rows,unplaced,allPlaced,paid:cents(rows.reduce((a,r)=>a+r.amount,0)),teams:ls});
    for(const r of rows){ if(!(r.amount>0)) continue;
      const ss=byLot.get(r.lot.id)||[], teamC=Math.round(r.amount*100); let given=0;
      for(const [si,s] of ss.entries()){ const o=s.owner, k=o.key, amtC=si===ss.length-1?teamC-given:Math.round(teamC*s.pct/100); given+=amtC; const amt=amtC/100;
        if(!people.has(k)) people.set(k,{key:k,name:o.name,num:o.num||'',bidderId:o.bidderId||'',total:0,items:[]});
        const p=people.get(k); if(o.num&&!p.num){ p.num=o.num; p.bidderId=o.bidderId; }
        p.items.push({lot:r.lot,flight:f.flight,label:r.label,pct:s.pct,kind:s.kind,teamPays:r.amount,amount:amt}); p.total=cents(p.total+amt); } }
  }
  return {flights,people:[...people.values()].sort((a,b)=>b.total-a.total||a.name.localeCompare(b.name)),total:cents(flights.reduce((a,f)=>a+f.paid,0))};
}


/* ---------- Calcutta payouts: finishes by flight, ties split, who gets paid ---------- */
function payoutsPane(t){
  const fmt=v=>{ const n=+v||0; return '$'+n.toLocaleString('en-US',{minimumFractionDigits:Number.isInteger(Math.round(n*100)/100)?0:2,maximumFractionDigits:2}); };
  const c=calc(t), P=calcPayouts(c), paid=c.paidOut||{}, open=view.poOpen||{};
  const placeOpts=n=>`<option value="">—</option>`+Array.from({length:n},(_,k)=>`<option value="${k+1}">${ordinal(k+1)}</option>`).join('');
  const flightsHTML=P.flights.map(f=>{
    const rowOf=new Map(f.rows.map(r=>[r.lot.id,r]));
    const teams=f.teams.slice().sort((a,b)=>(c0(a.place)||999)-(c0(b.place)||999)||a.lot-b.lot);
    return `<div class="card cc-card" style="overflow:hidden"><div class="cardhead"><div><h2 class="h2">${esc(f.flight)}</h2><span class="muted">Net pot ${fmt(f.net)} · ${c.payout.map((p,k)=>`${ordinal(k+1)} ${fmt(f.money[k])}`).join(' · ')}</span></div>
      <span class="${f.unplaced.length?'chip warn':'chip ok'}">${f.unplaced.length?(f.allPlaced?`${f.unplaced.map(x=>ordinal(x.place)).join(', ')} money (${fmt(f.unplaced.reduce((a,x)=>a+x.m,0))}) not claimed — fewer teams than paid places`:`${f.unplaced.map(x=>ordinal(x.place)).join(', ')} not entered`):`${fmt(f.paid)} paid out`}</span></div>
      ${teams.map(l=>{ const r=rowOf.get(l.id); return `<div class="tr po-row${r&&r.amount>0?' win':''}" style="grid-template-columns:52px minmax(0,1fr) 92px 70px 110px"><b class="num">${l.lot}</b><span class="trunc">${esc(teamName(l))}</span>
        <select class="inp po-sel" data-po="${l.id}" aria-label="Finish for lot ${l.lot}">${placeOpts(f.teams.length).replace(`value="${c0(l.place)||''}"`,`value="${c0(l.place)||''}" selected`)}</select>
        <span class="r"><b>${r?esc(r.label):''}</b></span><b class="r num">${r&&r.amount>0?fmt(r.amount):''}</b></div>`; }).join('')}
      ${f.rows.some(r=>r.tie>1&&r.amount>0)?`<div class="po-note">${[...new Set(f.rows.filter(r=>r.tie>1&&r.amount>0).map(r=>r.pos))].map(pos=>{ const g=f.rows.filter(r=>r.pos===pos); const cov=g[0].covers; return `${g.length} teams tied for ${ordinal(pos)} split ${cov[0]===cov[1]?ordinal(cov[0]):ordinal(cov[0])+'–'+ordinal(cov[1])} money (${fmt(f.money.slice(cov[0]-1,cov[1]).reduce((a,v)=>a+v,0))}) — ${(()=>{ const a=g.map(r=>r.amount), lo=Math.min(...a), hi=Math.max(...a); return lo===hi?`${fmt(lo)} each`:`${fmt(hi)} to ${g.filter(r=>r.amount===hi).map(r=>'Lot '+r.lot.lot).join(', ')} and ${fmt(lo)} to the others (the odd cent goes to the lowest lot)`; })()}`; }).join('<br>')}</div>`:''}
    </div>`; }).join('');
  const due=P.people.filter(p=>!(paid[p.key]&&paid[p.key].paid)), outstanding=due.reduce((a,p)=>a+p.total,0);
  const peopleHTML=P.people.length?P.people.map(p=>{ const po=paid[p.key]||{}, isOpen=!!open[p.key];
      return `<div class="bid-item${isOpen?' open':''}"><div class="tr num click" data-pox="${esc(p.key)}" style="grid-template-columns:22px 70px minmax(0,1fr) 110px 150px">
        <span class="chev">${isOpen?'▾':'▸'}</span><b>${p.num?'#'+esc(p.num):'<span class="muted" style="font-weight:500;font-size:12px">no paddle</span>'}</b><span class="trunc">${esc(p.name)}</span><b class="r">${fmt(p.total)}</b>
        <select class="inp po-pay${po.paid?' paid':''}" data-pop="${esc(p.key)}" aria-label="Paid out to ${esc(p.name)}"><option value="">Not paid out</option>${['Cash','Check','Zelle','Venmo'].map(m=>`<option${po.paid&&po.method===m?' selected':''}>${m}</option>`).join('')}</select></div>
        ${isOpen?`<div class="bid-detail">${p.items.map(i=>`<div class="bl-row"><span class="bl-n">${i.lot.lot}</span><span class="bl-t">${esc(teamName(i.lot))}<small>${esc(i.flight)} · ${esc(i.label)} · team paid ${fmt(i.teamPays)} · ${i.pct}% ${i.kind==='prebuy'?'(pre-bought, captain)':i.kind==='team'?'(captain’s team share)':i.kind==='pool'?'(bought the pool)':'(bought at auction)'}</small></span><span class="bl-f"></span><b class="bl-p">${fmt(i.amount)}</b></div>`).join('')}
          <div class="bl-row tot"><span class="bl-n"></span><span class="bl-t"><b>Total to ${esc(p.name)}</b><small>${po.paid?`Paid out by ${esc(po.method)}${po.at?' · '+new Date(po.at).toLocaleString([], {month:'short',day:'numeric',hour:'numeric',minute:'2-digit'}):''}`:'Not paid out yet'}</small></span><span class="bl-f"></span><b class="bl-p">${fmt(p.total)}</b></div></div>`:''}</div>`; }).join('')
    :'<div class="empty" style="padding:22px"><span>Enter finishes above — the people to pay show up here.</span></div>';
  const results=`<div class="card pad" style="display:flex;gap:10px 24px;flex-wrap:wrap;align-items:center"><div class="cell2" style="flex:1 1 360px"><span class="lbl">How payouts work</span><b>Enter each team’s finish in its flight. Tied teams get the same number.</b><small class="muted">No tie-breaker: tied teams share the money for every place they cover — two tied for 1st split 1st + 2nd money, and the next team is 3rd. Each team’s money goes to its owners: ${buyInOf(c).on?`the buyer ${100-c0(buyInOf(c).pct)}% and the captain ${c0(buyInOf(c).pct)}% (100% if pre-bought)`:'the buyer'}.</small></div>
      <div class="actions"><button class="btn sm" id="poClear">Clear finishes</button></div></div>
    ${flightsHTML}`;
  const entered=P.flights.filter(f=>!f.unplaced.length||f.allPlaced).length;
  const payouts=`<div class="grid g4">${kpi('Paying out',fmt(P.total),`${P.people.length} ${P.people.length===1?'person':'people'}`)}${kpi('Still to pay out',fmt(outstanding),`${due.length} ${due.length===1?'person':'people'}`)}${kpi('Paid out',fmt(P.total-outstanding),`${P.people.length-due.length} done`)}${kpi('Results entered',`${entered} / ${P.flights.length}`,'flights')}</div>
    ${entered<P.flights.length?`<div class="banner" style="display:flex;align-items:center;gap:12px;flex-wrap:wrap"><span style="flex:1 1 260px">Results aren’t complete for ${P.flights.filter(f=>f.unplaced.length&&!f.allPlaced).map(f=>esc(f.flight)).join(', ')} — these payouts will change as finishes are entered.</span><button class="btn sm" data-cctab-go="results">Enter results</button></div>`:''}
    <div class="card cc-card" style="overflow:hidden"><div class="cardhead"><div><h2 class="h2">Payouts by person</h2><span class="muted">${fmt(P.total)} to ${P.people.length} ${P.people.length===1?'person':'people'} · ${due.length?`${fmt(outstanding)} still to pay out`:'all paid out'} · click a name for the teams behind it</span></div>
      <div class="actions"><button class="btn sm" id="poXlsx"${P.people.length?'':' disabled'}>${I.down}Spreadsheet</button><button class="btn sm" id="poPdf"${P.people.length?'':' disabled'}>${I.down}Payouts PDF</button><button class="btn sm" id="poPdfNames"${P.people.length?'':' disabled'}>${I.down}Winners PDF (no amounts)</button></div></div>${peopleHTML}</div>`;
  return {results,payouts};
}
function wirePayouts(el,t){
  const c=calc(t);
  el.querySelectorAll('[data-po]').forEach(s=>s.onchange=()=>{ const l=c.lots.find(x=>x.id===s.dataset.po); const v=parseInt(s.value,10); if(v>0) l.place=v; else delete l.place; persist(); render(); });
  el.querySelectorAll('[data-pox]').forEach(r=>r.onclick=e=>{ if(e.target.closest('select')) return; view.poOpen=view.poOpen||{}; view.poOpen[r.dataset.pox]=!view.poOpen[r.dataset.pox]; render(); });
  el.querySelectorAll('[data-pop]').forEach(s=>s.onchange=()=>{ c.paidOut=Object.assign({},c.paidOut||{}); const k=s.dataset.pop; if(s.value) c.paidOut[k]={paid:true,method:s.value,at:new Date().toISOString()}; else delete c.paidOut[k]; persist(); render(); });
  el.querySelectorAll('[data-cctab-go]').forEach(b=>b.onclick=()=>{ const tb=el.querySelector(`[data-cctab="${b.dataset.cctabGo}"]`); if(tb) tb.click(); });
  const cl=$('poClear'); if(cl) cl.onclick=()=>{ if(!confirm('Clear every finish in every flight?')) return; c.lots.forEach(l=>{ delete l.place; }); persist(); render(); };
  const px=$('poXlsx'); if(px) px.onclick=()=>exportPayoutsXLSX(t);
  const pp=$('poPdf'); if(pp) pp.onclick=()=>payoutsPDF(t,{amounts:true});
  const pn=$('poPdfNames'); if(pn) pn.onclick=()=>payoutsPDF(t,{amounts:false});
}

/* ---------- exports: the payout spreadsheet, the branded payouts sheet, and a winners list without money ---------- */
const poKind=k=>k==='prebuy'?'Pre-bought (captain)':k==='team'?'Team share (captain)':k==='pool'?'Bought the pool':'Bought at auction';
async function exportPayoutsXLSX(t){
  const c=calc(t), P=calcPayouts(c), paid=c.paidOut||{};
  try{ await loadXLSX(); }catch(e){ toast(e.message||'Could not load the spreadsheet library'); return; }
  const wb=XLSX.utils.book_new(), money=v=>Math.round((+v||0)*100)/100;
  const people=[['Paddle','Person','Total','Paid out','Method','When']].concat(P.people.map(p=>{ const po=paid[p.key]||{}; return [p.num||'',p.name,money(p.total),po.paid?'Yes':'No',po.method||'',po.at?new Date(po.at).toLocaleString():'']; }))
    .concat([[],['','Total',money(P.total)]]);
  const ws1=XLSX.utils.aoa_to_sheet(people); ws1['!cols']=[{wch:8},{wch:32},{wch:12},{wch:10},{wch:10},{wch:20}]; XLSX.utils.book_append_sheet(wb,ws1,'Payouts by person');
  const detail=[['Paddle','Person','Flight','Finish','Lot','Team','Team payout','Share %','How','Amount']].concat(P.people.flatMap(p=>p.items.map(i=>[p.num||'',p.name,i.flight,i.label,i.lot.lot,teamName(i.lot),money(i.teamPays),i.pct,poKind(i.kind),money(i.amount)])));
  const ws2=XLSX.utils.aoa_to_sheet(detail); ws2['!cols']=[{wch:8},{wch:28},{wch:10},{wch:8},{wch:6},{wch:36},{wch:12},{wch:9},{wch:22},{wch:12}]; XLSX.utils.book_append_sheet(wb,ws2,'Detail');
  const flights=[['Flight','Net pot'].concat(c.payout.map((p,k)=>`${ordinal(k+1)} (${p}%)`)).concat(['Paid out','Not claimed'])].concat(P.flights.map(f=>[f.flight,money(f.net)].concat(f.money.map(money)).concat([money(f.paid),money(f.unplaced.reduce((a,x)=>a+x.m,0))])))
    .concat([[],['Flight','Finish','Lot','Team','Team payout','Tied']]).concat(P.flights.flatMap(f=>f.rows.map(r=>[f.flight,r.label,r.lot.lot,teamName(r.lot),money(r.amount),r.tie>1?`${r.tie} tied, split ${ordinal(r.covers[0])}${r.covers[1]>r.covers[0]?'–'+ordinal(r.covers[1]):''} money`:''])));
  const ws3=XLSX.utils.aoa_to_sheet(flights); ws3['!cols']=[{wch:12},{wch:12},{wch:12},{wch:12},{wch:12},{wch:12},{wch:36},{wch:12},{wch:30}]; XLSX.utils.book_append_sheet(wb,ws3,'By flight');
  XLSX.writeFile(wb,`${(t.name||'Tournament').replace(/[^\w]+/g,'-')}-Calcutta-payouts-${new Date().toISOString().slice(0,10)}.xlsx`); toast('Payout spreadsheet downloaded');
}
/* opt.amounts true → the payouts sheet (team payouts by flight, then every person and what they are owed);
   false → the winners list for posting: who finished where and who to see the cashier, no money anywhere */
async function payoutsPDF(t,opt){
  opt=opt||{}; const AM=opt.amounts!==false, c=calc(t), P=calcPayouts(c);
  if(!P.people.length){ toast('Enter finishes first'); return; }
  try{ await loadJsPDF(); }catch(e){ toast(e.message); return; }
  const crest=await crestPNG().catch(()=>null), doc=new window.jspdf.jsPDF({unit:'pt',format:'letter'});
  [['ps400','PS-400.ttf','PublicSans','normal'],['ps700','PS-700.ttf','PublicSans','bold'],['ps800','PS-800.ttf','PublicSansXB','normal'],['cg700','CG-700.ttf','Cormorant','bold']].forEach(([k,f,fam,st])=>{ doc.addFileToVFS(f,PDF_FONTS[k]); doc.addFont(f,fam,st); });
  const NAVY=[15,42,56],GOLD=[199,161,58],GOLDL=[216,183,95],GOLDDK=[126,95,26],IVORY=[251,250,245],INK=[20,34,43],MUTED=[86,98,106];
  const L=40,R2=572,W=612,H=792, fmt=v=>{ const n=+v||0; return '$'+n.toLocaleString('en-US',{minimumFractionDigits:Number.isInteger(Math.round(n*100)/100)?0:2,maximumFractionDigits:2}); };
  const font=(f,s,z,col)=>{ doc.setFont(f,s); doc.setFontSize(z); doc.setTextColor(...col); };
  const page=()=>{ doc.setFillColor(...IVORY); doc.rect(0,0,W,H,'F'); };
  const complete=P.flights.every(f=>!f.unplaced.length||f.allPlaced);
  page();
  const title=AM?'Calcutta Payouts':'Calcutta Winners';
  const subTxt=`${dateRange(t)}${AM?` · ${fmt(P.total)} to ${P.people.length} ${P.people.length===1?'person':'people'}`:''}${complete?'':' · results not complete — as of '+new Date().toLocaleString()}`;
  font('PublicSans','normal',8.4,[214,218,220]); const sub=doc.splitTextToSize(subTxt,R2-L-90); const bandH=74+Math.max(0,sub.length-1)*11;
  doc.setFillColor(...GOLD); doc.roundedRect(L,32,R2-L,bandH+4,8,8,'F'); doc.setFillColor(...NAVY); doc.roundedRect(L,32,R2-L,bandH,8,8,'F'); doc.rect(L,32+bandH-12,R2-L,8,'F');
  if(crest) doc.addImage(crest,'PNG',L+16,42,54*914/1180,54);
  font('PublicSansXB','normal',6.8,GOLDL); doc.text(`${(orgName()||'').toUpperCase()} · ${t.season||''}`,L+76,56,{charSpace:1.2});
  font('Cormorant','bold',24,[255,255,255]); doc.text(`${t.name} — ${title}`,L+76,80);
  font('PublicSans','normal',8.4,[214,218,220]); doc.text(sub,L+76,96);
  let y=32+bandH+26;
  const need=h=>{ if(y+h>H-44){ doc.addPage(); page(); y=48; } };
  const section=(label,note)=>{ need(40); font('PublicSansXB','normal',7.4,GOLDDK); doc.text(label.toUpperCase(),L,y,{charSpace:1.1}); if(note){ font('PublicSans','normal',8,MUTED); doc.text(note,R2,y,{align:'right'}); } y+=6; doc.setDrawColor(...GOLD); doc.setLineWidth(1); doc.line(L,y,R2,y); y+=12; };
  const cols=label=>{ font('PublicSans','bold',7.6,MUTED); label.forEach(([txt,x,al])=>doc.text(txt,x,y,{align:al||'left'})); y+=10; };
  const zebra=i=>{ if(i%2===0){ doc.setFillColor(255,255,255); doc.rect(L-4,y-9,R2-L+8,15,'F'); } };
  // finishes by flight
  for(const f of P.flights){
    const rows=f.rows.filter(r=>AM?r.amount>0:(r.pos<=c.payout.length)); if(!rows.length) continue;
    section(f.flight,AM?`Net pot ${fmt(f.net)} · ${c.payout.map((p,k)=>`${ordinal(k+1)} ${fmt(f.money[k])}`).join(' · ')}`:'');
    cols(AM?[['FINISH',L],['LOT',L+54],['TEAM',L+90],['TEAM PAYOUT',R2,'right']]:[['FINISH',L],['LOT',L+54],['TEAM',L+90]]);
    rows.forEach((r,i)=>{ need(16); zebra(i); font('PublicSans','bold',9.4,r.pos===1?GOLDDK:INK); doc.text(r.label,L,y); font('PublicSans','normal',9.4,INK); doc.text(String(r.lot.lot),L+54,y); doc.text(doc.splitTextToSize(teamName(r.lot),(AM?R2-100:R2)-(L+90))[0],L+90,y);
      if(AM){ font('PublicSans','bold',10,INK); doc.text(fmt(r.amount),R2,y,{align:'right'}); } y+=15; });
    const ties=[...new Set(f.rows.filter(r=>r.tie>1&&r.amount>0).map(r=>r.pos))];
    if(ties.length){ font('PublicSans','normal',7.6,MUTED); ties.forEach(pos=>{ const g=f.rows.filter(r=>r.pos===pos), cov=g[0].covers; need(12); doc.text(`${g.length} teams tied for ${ordinal(pos)}${AM?` share ${cov[0]===cov[1]?ordinal(cov[0]):ordinal(cov[0])+'–'+ordinal(cov[1])} money`:''}.`,L,y); y+=11; }); }
    y+=8;
  }
  // people
  section(AM?'Payouts by person':'Please see the cashier',AM?`${fmt(P.total)} total`:'');
  cols(AM?[['PADDLE',L],['NAME',L+54],['TEAMS',L+230],['AMOUNT',R2,'right']]:[['PADDLE',L],['NAME',L+54],['TEAMS',L+230]]);
  const ppl=AM?P.people:P.people.slice().sort((a,b)=>a.name.localeCompare(b.name));
  ppl.forEach((p,i)=>{ const teams=p.items.map(it=>`Lot ${it.lot.lot}${it.kind==='team'||it.kind==='prebuy'?' (own team)':''}`).join(', '), tl=doc.splitTextToSize(teams,(AM?R2-80:R2)-(L+230)); need(4+tl.length*11);
    zebra(i); font('PublicSans','normal',9,INK); doc.text(p.num?'#'+p.num:'—',L,y); font('PublicSans','bold',9.4,INK); doc.text(doc.splitTextToSize(p.name,166)[0],L+54,y); font('PublicSans','normal',8.4,MUTED); doc.text(tl,L+230,y);
    if(AM){ font('PublicSans','bold',10,INK); doc.text(fmt(p.total),R2,y,{align:'right'}); } y+=Math.max(15,4+tl.length*11); });
  font('PublicSans','normal',7.6,MUTED);
  const foot=AM?`No tie-breaker: tied teams share the money for every place they cover. Each team’s payout goes to its owners${buyInOf(c).on?` — the buyer ${100-c0(buyInOf(c).pct)}% and the captain ${c0(buyInOf(c).pct)}% (100% if pre-bought)`:''}. Payouts are not netted against auction purchases. Generated by the ${orgShort()} hub, ${new Date().toLocaleString()}.`
    :`Listed people hold a share of a team that finished in the money. Amounts are settled with the cashier. Generated by the ${orgShort()} hub, ${new Date().toLocaleString()}.`;
  need(30); doc.text(doc.splitTextToSize(foot,R2-L),L,Math.max(y+8,H-40));
  if(opt.returnDoc) return doc;
  doc.save(`${(t.name||'Tournament').replace(/[^\w]+/g,'-')}-calcutta-${AM?'payouts':'winners'}.pdf`); toast(AM?'Payouts PDF downloaded':'Winners PDF downloaded');
}

