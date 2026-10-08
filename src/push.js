/* =====================================================================
   Push to the current app — sends an imported tournament's edits back to
   the Member-Member app (public.mm_tournament), so the board can keep using
   it while the hub takes over. Safety:
   - refuses (unless you insist) when the current app changed since the hub's
     copy was taken, so nobody's edits get overwritten silently;
   - previews every total before and after, and checks the result against the hub;
   - downloads a backup of the current app's data before writing;
   - only that year is replaced; other years and anything the hub doesn't manage
     (outreach, event info, flight calculator) are kept as they are.
   ===================================================================== */
function mmStatus(pledged,paid){ return paid<=0?'Pledged':(paid>=(+pledged||0)?'Deposited':'Partial'); }
/* hub tournament → one year of the old app's data, built on top of that year as it is now */
function hubToMM(t,base){
  const A=(k,id,m)=>tA(t,k,id,m), y=clone(base||{}), notCarried=[];
  const players=playersUsed(t);
  // sponsors keep their old ids where the company matches, so the old app sees edits, not new rows
  const oldByName=new Map((base&&base.sponsors||[]).map(s=>[(s.company||'').trim().toLowerCase(),s]));
  y.goal=n0(t.goal);
  y.tiers=t.tiers.map(x=>({id:x.id,name:x.name,amt:n0(x.amt)}));
  y.sponsors=t.sponsors.map(s=>{ const old=oldByName.get((s.company||'').trim().toLowerCase()); const pays=(s.payments||[]).map(p=>({id:p.id,amount:n0(p.amount),method:p.method||'',date:p.date||''}));
    const paid=pays.reduce((a,p)=>a+p.amount,0);
    return Object.assign({},old||{},{id:(old&&old.id)||s.id,tier:s.tier||'',company:s.company||'',contact:s.contact||'',phone:s.phone||'',email:s.email||'',pledged:n0(s.pledged),committee:s.committee||'',notes:s.notes||'',payments:pays,deposited:paid,status:mmStatus(s.pledged,paid)}); });
  // the dinner menu: the old app holds one catered menu, on the Saturday dinner line
  const menus=t.dayItems.flatMap((d,di)=>d.filter(it=>it.menu).map(it=>({it,di})));
  const main=menus.find(m=>m.di===1)||menus[0];
  const pp0=t.perPlayer[0];
  y.inputs=Object.assign({},y.inputs||{},{golfers:players,entryFee:n0(t.entryFee),skins:n0(t.skinsFee),proCredit:pp0?n0(pp0.perPlayer):0});
  if(main){ y.dinner=main.it.menu.items.map(x=>({id:x.id,qty:n0(x.qty),item:x.item,unitCost:n0(x.unitCost),notes:x.notes||''})); y.dinnerSvc=0; y.inputs.satHeadcount=n0(main.it.menu.guests); }
  else { y.dinner=[]; }
  const DAYS=['Friday','Saturday','Sunday'];
  y.fb={Friday:[],Saturday:[],Sunday:[]};
  [0,1,2].forEach(di=>{ if(di>=t.days) return; y.fb[DAYS[di]]=t.dayItems[di].map(it=>{
      const base={id:it.id,item:it.item,actual:A('item',it.id,it.actual),notes:it.notes||'',qtyLink:''};
      if(it.menu&&main&&it===main.it) return Object.assign(base,{qty:n0(it.menu.guests),unitCost:0,costLink:'dinner'});
      if(it.menu){ notCarried.push(`${it.item}: sent as one line (${fmt(menuTotal(it.menu))}) — the current app holds one catered menu`); return Object.assign(base,{qty:1,unitCost:Math.round(menuTotal(it.menu)*100)/100,costLink:''}); }
      return Object.assign(base,{qty:itemQty(t,it),unitCost:n0(it.unitCost),costLink:''}); }); });
  // income: the old app has carry forward, MGA donation and the 50/50 raffle
  const carry=t.income.find(i=>/carry/i.test(i.desc||'')), mga=t.income.find(i=>/mga|donation/i.test(i.desc||'')), raf=t.income.find(i=>i.source==='raffle'||/50\/50|raffle/i.test(i.desc||''));
  t.income.filter(i=>i!==carry&&i!==mga&&i!==raf).forEach(i=>notCarried.push(`Income “${i.desc}” (${fmt(i.budget)}) — the current app has no place for other income`));
  y.rev=Object.assign({},y.rev||{},{carry:carry?n0(carry.budget):0,mga:mga?n0(mga.budget):0,raffles:raf?n0(raf.budget):0});
  // expenses: flight prizes has its own field; everything else is a misc line
  const flight=t.lines.find(l=>/flight prize/i.test(l.desc||''))||t.lines.find(l=>(l.group||'')==='Prizes');
  y.flightPrizeBudget=flight?n0(flight.budget):0;
  y.misc=t.lines.filter(l=>l!==flight).map(l=>({id:l.id,desc:l.desc,budget:n0(l.budget),actual:A('line',l.id,l.actual),notes:l.notes||''}));
  t.perPlayer.slice(1).forEach(p=>y.misc.push({id:p.id,desc:p.desc,budget:players*n0(p.perPlayer),actual:A('pp',p.id,p.actual),notes:`${players} × ${fmt(p.perPlayer)} per player`}));
  y.actuals=Object.assign({},y.actuals||{},{entryFees:A('entry','',t.actuals.entryFees),skins:A('skins','',t.actuals.skins),skinsPay:A('skinsPaid','',t.actuals.skinsPaid),
    carry:carry?A('inc',carry.id,carry.actual):0,mga:mga?A('inc',mga.id,mga.actual):0,raffles:raf?A('inc',raf.id,raf.actual):0,flight:flight?A('line',flight.id,flight.actual):0,proShop:pp0?A('pp',pp0.id,pp0.actual):0});
  y.schedule=t.schedule.slice().sort((a,b)=>a.day-b.day).map(d=>({day:d.label||((base&&base.schedule&&base.schedule[d.day]||{}).day)||dayLabel(t,d.day),items:d.items.map(i=>({id:i.id,time:i.time||'',event:i.event||'',notes:i.notes||''}))}));
  y.decisions=t.decisions.map(d=>({id:d.id,text:d.text,done:!!d.done}));
  return {year:y,notCarried};
}
/* what changed in the current app since the hub's copy was taken */
function mmDrift(raw,live){
  if(stable(raw)===stable(live)) return [];
  const a=oldCalc(raw), b=oldCalc(live), out=[];
  const L={totalRev:'Total revenue',totalExp:'Total expenses',net:'Net',deposited:'Sponsor money received',pledged:'Sponsor pledges',totalRevA:'Actual revenue',totalExpA:'Actual expenses',dinnerTot:'Saturday dinner'};
  for(const k of Object.keys(L)) if(Math.abs(n0(a[k])-n0(b[k]))>=0.005) out.push(`${L[k]}: ${fmt2(a[k])} → ${fmt2(b[k])}`);
  if((raw.sponsors||[]).length!==(live.sponsors||[]).length) out.push(`Sponsors: ${(raw.sponsors||[]).length} → ${(live.sponsors||[]).length}`);
  return out.length?out:['Details changed (notes, contacts, schedule or outreach) — totals are the same'];
}
async function pushToMM(t){
  if(!t.source||t.source.kind!=='mm-app'){ toast('Only tournaments imported from the current app can be pushed back'); return; }
  let state;
  try{ state=await fetchMMState(); }catch(e){ toast(e.message+' — pushing needs the cloud sign-in'); return; }
  const yr=t.source.year, live=state.years&&state.years[yr];
  if(!live){ toast(`The current app has no ${yr} season to update`); return; }
  const {year:next,notCarried}=hubToMM(t,live);
  const drift=mmDrift(t.source.raw,live);
  const before=oldCalc(live), after=oldCalc(next), check=verifyRows(t,next).filter(r=>r[1]!==null);
  const bad=check.filter(r=>Math.abs(n0(r[2])-n0(r[1]))>=0.005);
  const same=stable(live)===stable(next);
  const L=[['Total revenue','totalRev'],['Total expenses','totalExp'],['Net','net'],['Sponsor pledges','pledged'],['Sponsor money received','deposited'],['Saturday dinner','dinnerTot'],['Actual revenue','totalRevA'],['Actual expenses','totalExpA']];
  const rows=L.map(([l,k])=>{ const d=n0(after[k])-n0(before[k]); return `<div class="mr num" style="grid-template-columns:minmax(0,1fr) 100px 100px 90px"><span>${l}</span><span class="r muted">${fmt(before[k])}</span><b class="r">${fmt(after[k])}</b><span class="r ${Math.abs(d)<0.5?'muted':d>0?'pos':'neg'}">${Math.abs(d)<0.5?'—':(d>0?'+':'−')+fmt(Math.abs(d)).replace('$','$')}</span></div>`; }).join('');
  const counts=`${next.sponsors.length} sponsors · ${next.sponsors.reduce((a,s)=>a+s.payments.length,0)} payments · ${['Friday','Saturday','Sunday'].reduce((a,d)=>a+next.fb[d].length,0)} food & beverage lines · ${next.misc.length} misc lines · ${next.schedule.reduce((a,d)=>a+d.items.length,0)} schedule items`;
  openDrawer({kicker:t.name+' · '+yr,title:'Push to the current app',saveLabel:drift.length?'Push anyway':'Push changes',wide:true,
    body:(same?'<div class="banner" style="background:#E3F0E8;border-color:#BCD9C7;color:#174F37">The current app already matches the hub — nothing to push.</div>':'')+
      (drift.length?`<div class="banner" style="background:#F8E6DF;border-color:#EBC2B3;color:#6E2A1B;flex-direction:column;align-items:flex-start;gap:6px"><b>Someone changed ${yr} in the current app since the hub’s copy was taken.</b><span>Pushing replaces those edits with the hub’s version:</span><span>${drift.map(esc).join('<br>')}</span><span>To keep both, cancel, re-import from the current app (Verify tab), redo your hub edits, then push.</span></div>`:'')+
      `<p style="margin:0">Replaces the <b>${esc(yr)}</b> Member-Member data in the current app with the hub’s version. Other years, outreach and event info there stay as they are. A backup of the current app’s data downloads first.</p>
      <div class="fld"><span class="lbl">Current app totals</span><div class="mini"><div class="mr h num" style="grid-template-columns:minmax(0,1fr) 100px 100px 90px"><span>Line</span><span class="r">Now</span><span class="r">After push</span><span class="r">Change</span></div>${rows}</div></div>
      <p class="hint">${counts}.</p>
      ${bad.length?`<div class="banner">After the push, ${bad.length} line${bad.length>1?'s':''} won’t match the hub exactly: ${esc(bad.map(r=>r[0]).join(', '))}. See the notes below.</div>`:'<div class="banner" style="background:#E3F0E8;border-color:#BCD9C7;color:#174F37">After the push, every budget and actual total in the current app matches the hub.</div>'}
      ${notCarried.length?`<div class="fld"><span class="lbl">Can’t be sent as-is</span><div class="mini">${notCarried.map(x=>`<div class="mr"><span style="font-size:13px">${esc(x)}</span></div>`).join('')}</div></div>`:''}`,
    save:()=>{ if(same) return;
      if(drift.length&&!confirm(`Overwrite the edits made in the current app since the hub’s copy was taken?`)) return false;
      (async()=>{
        dl(JSON.stringify(state,null,2),'application/json',`member-member_backup_before_push_${new Date().toISOString().slice(0,16).replace(/[:T]/g,'-')}.json`);
        const data=clone(state); data.years[yr]=next;
        const {error}=await sb.from('mm_tournament').update({data,updated_at:new Date().toISOString()}).eq('id','main');
        if(error){ toast('Push failed — nothing changed in the current app: '+error.message); return; }
        t.source.raw=clone(next); t.source.importedAt=new Date().toISOString(); t.source.pushedAt=t.source.importedAt;
        persist(); render(); toast(`Pushed to the current app · backup saved`);
      })();
    }});
}

