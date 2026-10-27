/* ============ Member accounts & billing (module 'billing' — the club hub, staff only) ============
   Each club bills its own members; Flagstick bills the club. So this is the club's ledger: every member has an
   account, every source of money (dues, food & beverage, the pro shop, tee times, facilities, lessons, fees) posts a
   charge to it, the club records payments and credits as they come in (its own terminal, checks, ACH, cash), and
   Run statements closes a period for everyone. Rows live in acct_items / acct_statements (billing-setup.sql), not in
   the organization documents — many staff, many rows. Local mode (tests, file://) keeps the same shapes in
   localStorage. Board logins and admin links never see any of it. */
const ACCT={items:null,stmts:null,users:[],loading:false,err:'',at:0};
const SOURCES=[['dues','Dues'],['fnb','Food & beverage'],['proshop','Pro shop'],['tee','Tee time'],['facility','Facility'],['lesson','Lesson'],['fee','Fee'],['manual','Other']];
const SOURCE_NAME=Object.fromEntries(SOURCES);
const METHODS=[['card','Card'],['check','Check'],['ach','ACH / bank'],['cash','Cash'],['other','Other']];
const METHOD_NAME=Object.fromEntries(METHODS);
const acctOn=()=>!!CLUB&&isClub()&&hasModule('billing')&&!KEYMODE&&!SCOPED;
const acctCloud=()=>CLOUD&&sessionOK;
const acctKey=()=>'fs_acct_'+((typeof TENANT!=='undefined'&&TENANT)||'local');
const whoAmI=()=>(typeof ACCESS!=='undefined'&&ACCESS&&ACCESS.email)||'board';
function acctLocalRead(){ try{ return JSON.parse(localStorage.getItem(acctKey())||'null')||{items:[],stmts:[]}; }catch(_){ return {items:[],stmts:[]}; } }
function acctLocalWrite(){ try{ localStorage.setItem(acctKey(),JSON.stringify({items:ACCT.items||[],stmts:ACCT.stmts||[]})); }catch(_){} }
/* the whole ledger once per visit; the pages read ACCT.items / ACCT.stmts */
async function acctLoad(force){
  if(ACCT.loading) return; if(ACCT.items&&!force) return; ACCT.loading=true; ACCT.err='';
  try{
    if(!acctCloud()){ const L=acctLocalRead(); ACCT.items=L.items; ACCT.stmts=L.stmts; }
    else { const a=await tq(sb.from('acct_items').select('*')); const b=await tq(sb.from('acct_statements').select('*'));
      if(a.error) throw a.error; if(b.error) throw b.error; ACCT.items=a.data||[]; ACCT.stmts=b.data||[];
      const u=await tq(sb.from('member_users').select('*')); ACCT.users=u.error?[]:(u.data||[]); }
    ACCT.at=Date.now();
  }catch(e){ ACCT.err=/relation|does not exist|schema cache/i.test(e.message||'')?'Run billing-setup.sql in Supabase to turn on member accounts.':(e.message||'Couldn’t load the accounts'); ACCT.items=ACCT.items||[]; ACCT.stmts=ACCT.stmts||[]; }
  ACCT.loading=false;
}
const itemSign=i=>i.kind==='charge'?n0(i.amount):-n0(i.amount);
const liveItems=()=>(ACCT.items||[]).filter(i=>!i.void_at);
const byDate=(a,b)=>String(a.posted||'').localeCompare(String(b.posted||''))||String(a.created_at||'').localeCompare(String(b.created_at||''));
/* per member: balance, last activity, counts */
function acctBalances(){ const M=new Map(); for(const i of liveItems()){ const r=M.get(i.member_id)||{bal:0,last:'',n:0,lastPay:''}; r.bal=Math.round((r.bal+itemSign(i))*100)/100; r.n++; if((i.posted||'')>r.last) r.last=i.posted; if(i.kind==='payment'&&(i.posted||'')>r.lastPay) r.lastPay=i.posted; M.set(i.member_id,r); } return M; }
const balanceOf=id=>Math.round(liveItems().filter(i=>i.member_id===id).reduce((t,i)=>t+itemSign(i),0)*100)/100;
/* post one item (a charge, a payment or a credit) — the one way anything lands on an account */
async function acctPost(o){
  const item=Object.assign({id:uid(),kind:'charge',source:'manual',ref:null,descr:'',amount:0,method:null,reference:null,posted:todayISO(),void_at:null,void_reason:null,created_at:new Date().toISOString(),created_by:whoAmI()},o);
  item.amount=Math.round(Math.abs(n0(item.amount))*100)/100; if(!item.member_id||!item.amount) return null;
  if(acctCloud()){ const {error}=await sb.from('acct_items').insert(trow(item)); if(error){ toast('Couldn’t post: '+error.message); return null; } }
  ACCT.items=ACCT.items||[]; ACCT.items.push(item); if(!acctCloud()) acctLocalWrite(); return item;
}
async function acctVoid(item,reason){
  const patch={void_at:new Date().toISOString(),void_reason:reason||''};
  if(acctCloud()){ const {error}=await sb.from('acct_items').update(patch).eq('id',item.id); if(error){ toast('Couldn’t void: '+error.message); return false; } }
  Object.assign(item,patch); if(!acctCloud()) acctLocalWrite(); return true;
}
const isoPlus=(iso,n)=>{ const d=new Date(iso+"T12:00"); d.setDate(d.getDate()+n); return d.toISOString().slice(0,10); };
const lastDayOfPrevMonth=()=>{ const d=new Date(); d.setDate(0); return d.toISOString().slice(0,10); };
const dateTxt=iso=>iso?new Date(iso+'T12:00').toLocaleDateString('en-US',{month:'short',day:'numeric',year:'numeric'}):'—';
const amtCls=v=>v>0.004?'neg':v<-0.004?'pos':'muted';   // on an account, owing is the bad number
const balTxt=v=>v>0.004?fmt2(v)+' owing':v<-0.004?fmt2(-v)+' credit':'$0.00';
/* dues collection → the account: "Put on account" posts the association's charge once (ref = the dues charge id) */
/* dues collection marks a charge collected → the club has the money: a matching payment on the account (once) */
async function acctCollectDues(r){ if(!acctOn()) return; await acctLoad(); const L=ACCT.items||[]; if(!L.some(i=>i.source==='dues'&&i.ref===r.c.id&&i.kind==='charge')||L.some(i=>i.source==='dues'&&i.ref===r.c.id&&i.kind==='payment')) return;
  await acctPost({member_id:r.c.memberId,kind:'payment',source:'dues',ref:r.c.id,method:'other',descr:`Dues collected — ${r.org.short||r.org.name}`,amount:r.c.amount,posted:todayISO()}); }
async function acctPostDues(r){ if(!acctOn()) return; await acctLoad(); if((ACCT.items||[]).some(i=>i.source==='dues'&&i.ref===r.c.id)) return;
  await acctPost({member_id:r.c.memberId,kind:'charge',source:'dues',ref:r.c.id,descr:`${r.org.short||r.org.name} — ${r.c.desc||'dues'}`,amount:r.c.amount,posted:r.c.date||todayISO()}); }
/* ============ the billing engine: classes, recurring charges, tax & service charge, minimums, finance charges, aging, GL ============
   CLUB.billing holds the setup (small, in the club document); every posted row is an acct_item. */
const EVERY=[['month','Every month'],['quarter','Every quarter'],['year','Once a year']];
const MONTHS_LONG=['January','February','March','April','May','June','July','August','September','October','November','December'];
const BSTATUS=[['active','Active'],['loa','Leave of absence'],['suspended','Suspended'],['resigned','Resigned']];
const BSTATUS_NAME=Object.fromEntries(BSTATUS);
const DEFAULT_ITEMS=[
  {id:'dues',    name:'Dues',               source:'dues',     gl:'4000'},
  {id:'cart',    name:'Cart plan',          source:'fee',      gl:'4010'},
  {id:'locker',  name:'Locker',             source:'fee',      gl:'4020'},
  {id:'trail',   name:'Trail fee',          source:'fee',      gl:'4030'},
  {id:'capital', name:'Capital assessment', source:'fee',      gl:'4040'},
  {id:'fnb',     name:'Food & beverage',    source:'fnb',      gl:'4100', taxable:true, svc:true},
  {id:'min',     name:'Unspent minimum',    source:'fnb',      gl:'4120'},
  {id:'proshop', name:'Pro shop',           source:'proshop',  gl:'4200', taxable:true},
  {id:'guest',   name:'Guest fee',          source:'fee',      gl:'4300'},
  {id:'tee',     name:'Tee time',           source:'tee',      gl:'4310'},
  {id:'facility',name:'Facility',           source:'facility', gl:'4320'},
  {id:'lesson',  name:'Lesson',             source:'lesson',   gl:'4330'},
  {id:'finance', name:'Finance charge',     source:'fee',      gl:'4900'},
  {id:'late',    name:'Late fee',           source:'fee',      gl:'4910'},
  {id:'other',   name:'Other',              source:'manual',   gl:'4990'},
];
function acctSettings(){
  CLUB.billing=CLUB.billing||{}; const b=CLUB.billing;
  if(b.dueDays==null) b.dueDays=25; if(b.message==null) b.message='Thank you — payment is due by the date shown. Questions about your statement: the club office.';
  if(!Array.isArray(b.items)||!b.items.length) b.items=DEFAULT_ITEMS.map(x=>Object.assign({taxable:false,svc:false},x));
  b.items.forEach(x=>{ if(!x.source) x.source='manual'; if(x.gl==null) x.gl=''; });
  b.classes=b.classes||[]; b.classes.forEach(c=>{ c.charges=c.charges||[]; c.minimum=c.minimum||{amount:0,every:'month'}; });
  b.tax=b.tax||{rate:0}; b.svc=b.svc||{rate:0}; b.finance=b.finance||{pct:0,min:0}; b.lateFee=b.lateFee||{amount:0};
  b.gl=Object.assign({ar:'1200',cash:'1000',tax:'2300',svc:'4150',credit:'4950'},b.gl||{}); b.runs=b.runs||[]; b.online=b.online||{connected:false,charges_enabled:false,at:''};
  return b;
}
const itemOf=id=>acctSettings().items.find(x=>x.id===id);
const classOf=id=>acctSettings().classes.find(c=>c.id===id);
const pBilling=p=>{ p.billing=p.billing||{}; const x=p.billing; if(!x.status) x.status='active'; if(x.class==null) x.class=''; if(x.since==null) x.since=''; if(x.until==null) x.until=''; return x; };
/* an item's money: the base plus tax and service charge where the item carries them → {amount, tax, svc} (cent-exact) */
function chargeFor(itemId,base){ const b=acctSettings(), it=itemOf(itemId)||{}; const net=Math.round(Math.abs(n0(base))*100)/100;
  const svc=it.svc?Math.round(net*n0(b.svc.rate))/100:0, tax=it.taxable?Math.round((net+svc)*n0(b.tax.rate))/100:0;   // service charge is taxed where it is charged
  return {amount:Math.round((net+svc+tax)*100)/100,tax,svc,net}; }
const netOf=i=>Math.round((n0(i.amount)-n0(i.tax)-n0(i.svc))*100)/100;
/* ---- the monthly billing run ---- */
const monthStart=ym=>ym+'-01', monthEnd=ym=>{ const [y,m]=ym.split('-').map(Number); return new Date(Date.UTC(y,m,0)).toISOString().slice(0,10); };
const daysIn=ym=>+monthEnd(ym).slice(8,10);
const ymAdd=(ym,n)=>{ const [y,m]=ym.split('-').map(Number); const d=new Date(Date.UTC(y,m-1+n,1)); return d.toISOString().slice(0,7); };
const ymTxt=ym=>MONTHS_LONG[+ym.slice(5,7)-1]+' '+ym.slice(0,4);
/* which months a class charge falls in: every month; quarters from its month (default January); once a year in its month */
function dueThisMonth(ch,ym){ const m=+ym.slice(5,7), from=+(ch.month||1); if(ch.every==='month') return true; if(ch.every==='quarter') return ((m-from)%3+3)%3===0; return m===from; }
/* a member's share of a period: 1, or the days they were billable in the month over the month's days (joined / resigned mid-month) */
function prorate(p,ym){ const x=pBilling(p), s=monthStart(ym), e=monthEnd(ym), n=daysIn(ym); let from=s, to=e;
  if(x.since&&x.since>s) from=x.since>e?null:x.since; if(x.status==='resigned'&&x.until&&x.until<e) to=x.until<s?null:x.until;
  if(from===null||to===null) return 0; if(from===s&&to===e) return 1; const d=Math.round((new Date(to+'T12:00')-new Date(from+'T12:00'))/86400000)+1; return Math.max(0,Math.min(1,d/n)); }
/* who is billable in a month: a class, and active or suspended (a leave of absence pays nothing; a resigned member only to their last day) */
function billable(p,ym){ const x=pBilling(p); if(!x.class||!classOf(x.class)) return false; if(p.status==='Inactive') return false; if(x.status==='loa') return false;
  if(x.status==='resigned'&&(!x.until||x.until<monthStart(ym))) return false; return prorate(p,ym)>0; }
/* the plan for a month: every recurring charge due, prorated, plus unspent minimums for periods that ended last month; already-posted refs are skipped */
function billingPlan(ym){ const b=acctSettings(), have=new Set((ACCT.items||[]).filter(i=>i.ref).map(i=>i.ref)), rows=[], end=monthEnd(ym);
  for(const p of persons()){ if(!billable(p,ym)) continue; const x=pBilling(p), c=classOf(x.class), share=prorate(p,ym);
    for(const ch of c.charges){ if(!dueThisMonth(ch,ym)) continue; const it=itemOf(ch.itemId); if(!it) continue; const ref=`run:${ym}:${ch.id}:${p.id}`; if(have.has(ref)) continue;
      const base=Math.round(n0(ch.amount)*share*100)/100; if(!base) continue; const m=chargeFor(it.id,base);
      rows.push(Object.assign({member_id:p.id,kind:'charge',source:it.source,item:it.id,gl:it.gl,ref,descr:`${it.name} · ${ymTxt(ym)}${share<1?' (prorated)':''}`,posted:monthStart(ym)},m)); }
    const mn=c.minimum; if(n0(mn.amount)>0){ const prev=ymAdd(ym,-1), pm=+prev.slice(5,7), len=mn.every==='month'?1:mn.every==='quarter'?3:12; const closes=len===1||(pm%len===0);
      if(closes){ const from=monthStart(ymAdd(prev,-(len-1))), to=monthEnd(prev), ref=`min:${from.slice(0,7)}:${p.id}`;
        const share=Array.from({length:len},(_,k)=>prorate(p,ymAdd(prev,-k))).reduce((t,v)=>t+v,0)/len;   // a member for part of the period owes that part of the minimum
        if(!have.has(ref)&&share>0){ const spent=sum(liveItems().filter(i=>i.member_id===p.id&&i.kind==='charge'&&i.source==='fnb'&&i.item!=='min'&&i.posted>=from&&i.posted<=to),netOf);
          const short=Math.round((Math.round(n0(mn.amount)*share*100)/100-spent)*100)/100; if(short>0.004) rows.push(Object.assign({member_id:p.id,kind:'charge',source:'fnb',item:'min',gl:(itemOf('min')||{}).gl||'',ref,descr:`Unspent minimum · ${len===1?ymTxt(prev):dateTxt(from)+' – '+dateTxt(to)} (spent ${fmt2(spent)} of ${fmt2(Math.round(n0(mn.amount)*share*100)/100)}${share<1?', prorated':''})`,posted:end},chargeFor('min',short))); } } }
  }
  return rows; }
async function runBilling(ym){ const rows=billingPlan(ym); if(!rows.length) return 0; const b=acctSettings();
  const items=rows.map(o=>Object.assign({id:uid(),method:null,reference:null,void_at:null,void_reason:null,created_at:new Date().toISOString(),created_by:whoAmI()},o));
  if(acctCloud()){ const {error}=await sb.from('acct_items').insert(items.map(trow)); if(error){ toast('Couldn’t post the run: '+error.message); return -1; } }
  ACCT.items=(ACCT.items||[]).concat(items); if(!acctCloud()) acctLocalWrite();
  b.runs.push({month:ym,at:new Date().toISOString(),by:whoAmI(),n:items.length,total:Math.round(sum(items,i=>i.amount)*100)/100}); persist(); return items.length; }
function runBillingDrawer(){ const b=acctSettings(); const done=new Set(b.runs.map(r=>r.month)); const cur=todayISO().slice(0,7); let def=cur; while(done.has(def)) def=ymAdd(def,1);
  const opts=[]; for(let k=-2;k<=3;k++){ const ym=ymAdd(cur,k); opts.push([ym,ymTxt(ym)+(done.has(ym)?' · run':'')]); }
  const preview=ym=>{ const rows=billingPlan(ym); const byItem={}; rows.forEach(r=>{ const k=r.descr.split(' · ')[0]; byItem[k]=(byItem[k]||0)+r.amount; });
    return rows.length?`<p class="hint"><b>${rows.length} charge${rows.length===1?'':'s'} · ${fmt2(sum(rows,r=>r.amount))}</b> to ${new Set(rows.map(r=>r.member_id)).size} members${Object.keys(byItem).map(k=>`<br>${esc(k)} ${fmt2(byItem[k])}`).join('')}</p>`:`<p class="hint">Nothing to post for ${ymTxt(ym)} — ${done.has(ym)?'it has been run; anything new since is posted by the next run':'no class charges fall in it, or no member carries a class'}.</p>`; };
  openDrawer({kicker:'Member accounts',title:'Run monthly billing',saveLabel:'Post the charges',
    body:field('Month','rbM',def,{type:'select',options:opts})+`<div id="rbPrev">${preview(def)}</div><p class="hint">Posts every class charge due in the month to every billable member (prorated for a mid-month join or resignation), and unspent food & beverage minimums for periods that closed the month before. Running a month twice posts nothing twice.</p>`,
    wire:r=>{ r.querySelector('#rbM').onchange=()=>{ r.querySelector('#rbPrev').innerHTML=preview(fv('rbM')); }; },
    save:async()=>{ const ym=fv('rbM'); const n=await runBilling(ym); if(n<0) return false; toast(n?`${n} charge${n===1?'':'s'} posted for ${ymTxt(ym)}`:'Nothing to post'); }}); }
/* ---- aging: payments and credits settle the oldest charges first; what is left is bucketed by the charge's age ---- */
function agingOf(mid,asOf){ asOf=asOf||todayISO(); const its=liveItems().filter(i=>i.member_id===mid&&i.posted<=asOf).sort(byDate); let paid=sum(its.filter(i=>i.kind!=='charge'),i=>i.amount);
  const A={cur:0,d30:0,d60:0,d90:0,total:0,credit:0}; for(const c of its.filter(i=>i.kind==='charge')){ const left=Math.max(0,n0(c.amount)-paid); paid=Math.max(0,paid-n0(c.amount)); if(left<0.004) continue;
    const age=Math.round((new Date(asOf+'T12:00')-new Date(c.posted+'T12:00'))/86400000); A[age<=30?'cur':age<=60?'d30':age<=90?'d60':'d90']+=left; A.total+=left; }
  if(paid>0.004) A.credit=paid; ['cur','d30','d60','d90','total','credit'].forEach(k=>A[k]=Math.round(A[k]*100)/100); return A; }
const pastDueOf=mid=>{ const a=agingOf(mid); return Math.round((a.d30+a.d60+a.d90)*100)/100; };
/* ---- finance charges and late fees at statement time: on what was still owed from the previous statement after its due date ---- */
function lateCharges(mid,end){ const b=acctSettings(), out=[], prev=(ACCT.stmts||[]).filter(s=>s.member_id===mid&&s.period_end<end).sort((a,b2)=>String(b2.period_end).localeCompare(String(a.period_end)))[0]; if(!prev||!(prev.closing>0.004)||!prev.due) return out;
  const paidSince=sum(liveItems().filter(i=>i.member_id===mid&&i.kind!=='charge'&&i.posted>prev.period_end&&i.posted<=end),i=>i.amount), owed=Math.round((n0(prev.closing)-paidSince)*100)/100; if(owed<=0.004||prev.due>end) return out;
  const have=new Set(liveItems().filter(i=>i.ref).map(i=>i.ref));
  if(n0(b.finance.pct)>0&&owed>=n0(b.finance.min)&&!have.has('fc:'+prev.id)){ const amt=Math.round(owed*n0(b.finance.pct))/100; if(amt>=0.01) out.push(Object.assign({member_id:mid,kind:'charge',source:'fee',item:'finance',gl:(itemOf('finance')||{}).gl||'',ref:'fc:'+prev.id,descr:`Finance charge · ${n0(b.finance.pct)}% on ${fmt2(owed)} past due`,posted:end},chargeFor('finance',amt))); }
  if(n0(b.lateFee.amount)>0&&!have.has('lf:'+prev.id)) out.push(Object.assign({member_id:mid,kind:'charge',source:'fee',item:'late',gl:(itemOf('late')||{}).gl||'',ref:'lf:'+prev.id,descr:`Late fee · statement of ${dateTxt(prev.period_end)} unpaid`,posted:end},chargeFor('late',b.lateFee.amount)));
  return out; }
/* ---- the general ledger: one journal line per side, by month, for the club's bookkeeping ---- */
function glJournal(ym){ const b=acctSettings(), L=[], from=monthStart(ym), to=monthEnd(ym);
  for(const i of liveItems().filter(i=>i.posted>=from&&i.posted<=to).sort(byDate)){ const p=personById(i.member_id), who=p?memberName(p):i.member_id, it=itemOf(i.item)||{}, gl=i.gl||it.gl||'', memo=i.descr||'';
    if(i.kind==='charge'){ L.push([i.posted,b.gl.ar,'Accounts receivable',i.amount,0,memo,who]); L.push([i.posted,gl,it.name||SOURCE_NAME[i.source]||i.source,0,netOf(i),memo,who]); if(n0(i.svc)) L.push([i.posted,b.gl.svc,'Service charge',0,n0(i.svc),memo,who]); if(n0(i.tax)) L.push([i.posted,b.gl.tax,'Sales tax payable',0,n0(i.tax),memo,who]); }
    else if(i.kind==='payment'){ L.push([i.posted,b.gl.cash,'Cash / undeposited funds',i.amount,0,`${memo}${i.method?' · '+(METHOD_NAME[i.method]||i.method):''}${i.reference?' '+i.reference:''}`,who]); L.push([i.posted,b.gl.ar,'Accounts receivable',0,i.amount,memo,who]); }
    else { L.push([i.posted,b.gl.credit,'Credits & adjustments',i.amount,0,memo,who]); L.push([i.posted,b.gl.ar,'Accounts receivable',0,i.amount,memo,who]); } }
  return L; }
function glExportCSV(ym){ const L=glJournal(ym); if(!L.length){ toast('Nothing posted in '+ymTxt(ym)); return; } const qq=v=>'"'+String(v??'').replace(/"/g,'""')+'"';
  const by={}; L.forEach(l=>{ const k=l[1]+'|'+l[2]; by[k]=by[k]||[l[1],l[2],0,0]; by[k][2]+=l[3]; by[k][3]+=l[4]; });
  const csv=[['Date','Account','Account name','Debit','Credit','Memo','Member'].map(qq).join(',')].concat(L.map(l=>[l[0],l[1],l[2],l[3]?l[3].toFixed(2):'',l[4]?l[4].toFixed(2):'',l[5],l[6]].map(qq).join(',')))
    .concat(['',['Summary','Account','Account name','Debit','Credit'].map(qq).join(',')],Object.values(by).map(s=>['',s[0],s[1],s[2].toFixed(2),s[3].toFixed(2)].map(qq).join(','))).join('\n');
  dl(csv,'text/csv',`gl-journal-${ym}.csv`); }
function glExportDrawer(){ const cur=todayISO().slice(0,7), opts=[]; for(let k=-11;k<=0;k++){ const ym=ymAdd(cur,k); opts.push([ym,ymTxt(ym)]); }
  openDrawer({kicker:'Member accounts',title:'General ledger export',saveLabel:'Download CSV',body:field('Month','glM',ymAdd(cur,-1),{type:'select',options:opts.reverse()})+'<p class="hint">A journal of the month: every charge as a debit to accounts receivable and credits to the item’s revenue account, service charge and sales tax; every payment as cash against receivables; credits as adjustments. Account numbers come from Billing setup. Imports into QuickBooks and the rest.</p>',
    save:()=>{ glExportCSV(fv('glM')); }}); }
/* ---- statements by e-mail: the Edge Function `mail` (Resend) sends each member their PDF; without it, the PDFs are downloaded ---- */
async function mailStatements(list){ list=(list||[]).filter(s=>{ const p=personById(s.member_id); return p&&p.email; }); if(!list.length){ toast('None of these members has an e-mail address'); return 0; }
  if(!acctCloud()){ toast('E-mail goes out from the live site — downloading the PDFs instead'); await statementsPDF(list); return 0; }
  const club=(CLUB&&CLUB.name)||CLUB_META.name; let sent=0, fail='';
  for(const s of list){ const p=personById(s.member_id); const doc=await statementsPDF([s],{returnDoc:true}); if(!doc) break; const b64=doc.output('datauristring').split(',')[1];
    const text=`Your ${club} statement for ${dateTxt(s.period_start)} – ${dateTxt(s.period_end)} is attached. Balance due: ${fmt2(Math.max(0,s.closing))}${s.closing>0.004?', by '+dateTxt(s.due):''}.\n\n${acctSettings().message||''}`;
    const data=await sendMail({to:p.email,subject:`${club} — statement through ${dateTxt(s.period_end)}`,text,html:mailHTML({title:'Your statement',paragraphs:[`Your statement for <b>${dateTxt(s.period_start)} – ${dateTxt(s.period_end)}</b> is attached.`,`Balance due: <b>${fmt2(Math.max(0,s.closing))}</b>${s.closing>0.004?', by '+dateTxt(s.due):''}.`,esc(acctSettings().message||'')].filter(Boolean),cta:acctSettings().online&&acctSettings().online.charges_enabled?{href:portalLink(),label:'View & pay online'}:null}),attachments:[{filename:`statement-${s.period_end}.pdf`,content:b64}]});
    if(data.error){ fail=data.error; break; }
    const patch={sent_at:new Date().toISOString()}; await sb.from('acct_statements').update(patch).eq('id',s.id); Object.assign(s,patch); sent++; }
  if(fail){ toast(/not found|404|Failed to send a request|not configured/i.test(fail)?'The mail function isn’t deployed or has no key (docs/tenancy.md) — download the PDFs instead':'E-mail stopped: '+fail); }
  else toast(`${sent} statement${sent===1?'':'s'} e-mailed`); return sent; }
/* ---- online payments (Stripe Connect through the `stripe` Edge Function; the member portal takes the payments) ---- */
async function stripeFn(body){ if(!acctCloud()||!sb.functions) return {error:'Online payments work from the live site'}; try{ const {data,error}=await sb.functions.invoke('stripe',{body:Object.assign({tenant:TENANT,return:location.href.split('#')[0]},body)}); if(error) return {error:error.message||'failed'}; return data||{error:'no reply'}; }catch(e){ return {error:e.message||'failed'}; } }
const stripeMsg=e=>/not configured|Failed to send a request|404|not found/i.test(e||'')?'Online payments aren’t switched on: Flagstick deploys the stripe function and sets its key (docs/tenancy.md).':e;
async function stripeConnect(){ const r=await stripeFn({action:'connect'}); if(r.error){ toast(stripeMsg(r.error)); return; } if(r.url) location.href=r.url; }
async function stripeStatus(quiet){ const b=acctSettings(); const r=await stripeFn({action:'status'}); if(r.error){ if(!quiet) toast(stripeMsg(r.error)); return; }
  b.online={connected:!!r.connected,charges_enabled:!!(r.status&&r.status.charges_enabled),details_submitted:!!(r.status&&r.status.details_submitted),at:new Date().toISOString()}; persist(); if(!quiet) toast(b.online.charges_enabled?'Stripe is connected — members can pay online':b.online.connected?'Stripe account made — finish the onboarding to take payments':'Not connected'); render(); }
async function autopayRun(){ const r=await stripeFn({action:'autopay_run'}); if(r.error){ toast(stripeMsg(r.error)); return null; } const res=r.results||[], ok=res.filter(x=>x.ok), bad=res.filter(x=>!x.ok);
  toast(res.length?`Autopay: ${ok.length} charged (${fmt2(sum(ok,x=>x.amount))})${bad.length?' · '+bad.length+' failed':''}`:'No autopay member has a balance due'); await acctLoad(true); return res; }
const portalLink=()=>(typeof SITE_BASE!=='undefined'&&SITE_BASE?SITE_BASE:location.origin+'/')+'member.html';
/* ---------- pages ---------- */
const stmtsOf=mid=>(ACCT.stmts||[]).filter(s=>s.member_id===mid).sort((a,b)=>String(b.period_end).localeCompare(String(a.period_end)));
function vAccounts(m){
  if(!acctOn()){ go('dash'); return; }
  if(ACCT.items==null){ acctLoad().then(()=>render()); m.innerHTML=head('Member accounts','Loading the ledger…'); return; }
  if(acctCloud()&&Date.now()-ACCT.at>20000&&!ACCT.loading) acctLoad(true).then(()=>{ if(view.page==='accounts') render(); });   // other staff post too
  const b=acctSettings(), B=acctBalances(), P=persons().filter(p=>p.status!=='Inactive'||B.has(p.id)), q=(view.aq||'').toLowerCase().trim();
  let rows=P.map(p=>Object.assign({p,name:memberName(p),no:p.memberNo||'',cls:(classOf(pBilling(p).class)||{}).name||'',bst:pBilling(p).status},B.get(p.id)||{bal:0,last:'',n:0,lastPay:''}));
  rows.forEach(r=>{ r.aging=r.bal>0.004?agingOf(r.p.id):null; r.past=r.aging?Math.round((r.aging.d30+r.aging.d60+r.aging.d90)*100)/100:0; });
  const F=[['owing','Owing'],['past','Past due'],['credit','In credit'],['active','With activity'],['all','Everyone']]; if(!F.some(([k])=>k===view.afilter)) view.afilter='owing';
  const owing=rows.filter(r=>r.bal>0.004), past=rows.filter(r=>r.past>0.004), credit=rows.filter(r=>r.bal<-0.004), active=rows.filter(r=>r.n);
  const sets={owing,past,credit,active,all:rows}; let show=sets[view.afilter];
  if(q) show=rows.filter(r=>[r.name,r.no,r.p.email].join(' ').toLowerCase().includes(q));
  show=show.slice().sort((a,b2)=>q?a.name.localeCompare(b2.name):(b2.bal-a.bal)||a.name.localeCompare(b2.name));
  const month=todayISO().slice(0,7), monthItems=liveItems().filter(i=>(i.posted||'').startsWith(month)), lastRun=(ACCT.stmts||[]).slice().sort((a,b2)=>String(b2.period_end).localeCompare(String(a.period_end)))[0], lastBill=b.runs[b.runs.length-1];
  const A={d30:sum(owing,r=>r.aging.d30),d60:sum(owing,r=>r.aging.d60),d90:sum(owing,r=>r.aging.d90)};
  m.innerHTML=head('Member accounts',`Every member’s account: what the club has charged, what has come in, who owes what. Monthly billing posts the class charges; statements close the period.`,
      btn('Billing setup','acSet','')+btn('GL export','acGl','',I.down)+btn('Export balances','acCsv','',I.down)+btn('Run statements','acRun','')+btn('Run monthly billing','acBill','')+btn('Record payment','acPay','')+btn('Post charge','acCharge','pri',I.plus))+`
    ${ACCT.err?`<div class="banner">${esc(ACCT.err)}</div>`:''}${b.classes.length?'':`<div class="banner">No membership classes yet — set up classes and their monthly charges in <b>Billing setup</b> to run monthly billing.</div>`}
    <div class="grid g4">${kpi('Outstanding',fmt2(sum(owing,r=>r.bal)),`${owing.length} member${owing.length===1?'':'s'} owing · ${fmt2(-sum(credit,r=>r.bal))} in credits`,'neg')}${kpi('Past due',fmt2(A.d30+A.d60+A.d90),`31–60 ${fmt2(A.d30)} · 61–90 ${fmt2(A.d60)} · 90+ ${fmt2(A.d90)}`,A.d30+A.d60+A.d90>0.004?'neg':'')}${kpi('Charged this month',fmt2(sum(monthItems.filter(i=>i.kind==='charge'),i=>i.amount)),lastBill?`billing run through ${ymTxt(lastBill.month)}`:'no billing run yet')}${kpi('Received this month',fmt2(sum(monthItems.filter(i=>i.kind!=='charge'),i=>i.amount)),lastRun?`last statements ${dateTxt(lastRun.period_end)}`:'no statements yet')}</div>
    <div class="toolbar"><div class="seg">${F.map(([k,l])=>`<button class="${view.afilter===k&&!q?'on':''}" data-af="${k}">${l}${k==='all'?'':' · '+sets[k].length}</button>`).join('')}</div><input class="inp" id="acQ" placeholder="Find a member…" value="${esc(view.aq||'')}" style="margin-left:auto;height:38px;width:240px;max-width:100%" autocomplete="off"></div>
    <div class="card lg" style="overflow:hidden">${show.length?show.slice(0,300).map(r=>`<div class="lr click" data-acct="${r.p.id}"><div class="cell2"><span class="ln">${esc(r.name)}</span><span class="ls">${r.no?'#'+esc(r.no)+' · ':''}${r.cls?esc(r.cls)+' · ':''}${r.bst!=='active'?esc(BSTATUS_NAME[r.bst]||r.bst)+' · ':''}${r.n?`${r.n} item${r.n===1?'':'s'} · last ${dateTxt(r.last)}`:'no activity'}${r.lastPay?' · paid '+dateTxt(r.lastPay):''}</span></div><div class="lm">${r.past>0.004?`<span class="neg">${fmt2(r.past)} past due</span>`:''}</div><b class="lnet ${amtCls(r.bal)}">${balTxt(r.bal)}</b><span class="lact">${I.chev}</span></div>`).join('')+(show.length>300?`<div class="lr"><span class="muted">Showing 300 of ${show.length} — search to narrow it down.</span></div>`:'')
      :`<div class="empty"><b>${q?'Nobody matches':'Nothing here'}</b><span>${q?'Try another name or member number.':view.afilter==='owing'?'No member owes the club anything.':view.afilter==='past'?'Nobody is past due.':'Post a charge or record a payment to start an account.'}</span></div>`}</div>`;
  m.querySelectorAll('[data-af]').forEach(x=>x.onclick=()=>{ view.afilter=x.dataset.af; view.aq=''; render(); });
  const qi=$('acQ'); qi.oninput=()=>{ view.aq=qi.value; render(); };
  m.querySelectorAll('[data-acct]').forEach(r=>r.onclick=()=>go('account',{acctId:r.dataset.acct}));
  $('acCharge').onclick=()=>postDrawer('charge',null); $('acPay').onclick=()=>postDrawer('payment',null); $('acRun').onclick=()=>runStatementsDrawer(); $('acSet').onclick=()=>go('billsetup'); $('acBill').onclick=()=>runBillingDrawer(); $('acGl').onclick=()=>glExportDrawer();
  $('acCsv').onclick=()=>{ const qq=v=>'"'+String(v??'').replace(/"/g,'""')+'"'; const l=rows.filter(r=>r.n).sort((a,b2)=>a.name.localeCompare(b2.name));
    dl([['Member #','Last','First','Email','Class','Status','Balance','Current','31–60','61–90','90+','Last activity','Last payment'].map(qq).join(',')].concat(l.map(r=>{ const a=r.aging||{cur:0,d30:0,d60:0,d90:0}; return [r.no,r.p.last,r.p.first,r.p.email||'',r.cls,BSTATUS_NAME[r.bst]||'',r.bal.toFixed(2),a.cur.toFixed(2),a.d30.toFixed(2),a.d60.toFixed(2),a.d90.toFixed(2),r.last,r.lastPay].map(qq).join(','); })).join('\n'),'text/csv','member-balances-'+todayISO()+'.csv'); };
}
function vAccount(m){
  if(!acctOn()){ go('dash'); return; } const p=personById(view.acctId); if(!p){ go('accounts'); return; }
  if(ACCT.items==null){ acctLoad().then(()=>render()); m.innerHTML=head(memberName(p),'Loading…'); return; }
  const items=(ACCT.items||[]).filter(i=>i.member_id===p.id).sort(byDate), stmts=stmtsOf(p.id), x=pBilling(p), cls=classOf(x.class);
  let run=0; const ledger=items.map(i=>{ if(!i.void_at) run=Math.round((run+itemSign(i))*100)/100; return Object.assign({},i,{run}); }).reverse();
  const bal=balanceOf(p.id), lastStmt=stmts[0], since=lastStmt?items.filter(i=>!i.void_at&&(i.posted||'')>lastStmt.period_end):items.filter(i=>!i.void_at), ag=agingOf(p.id);
  m.innerHTML=`<div class="crumb"><button id="acBack">Member accounts</button><span class="muted">/</span><span class="muted">${esc(memberName(p))}</span></div>
    <div class="phead"><div><h1 class="h1">${esc(memberName(p))}</h1><div style="display:flex;gap:8px;margin-top:12px;flex-wrap:wrap">${p.memberNo?`<span class="chip navy">#${esc(p.memberNo)}</span>`:''}<span class="chip ${x.status==='active'?'ok':'warn'}">${cls?esc(cls.name):'No class'} · ${esc(BSTATUS_NAME[x.status]||x.status)}</span>${p.email?`<span class="chip">${esc(p.email)}</span>`:''}${p.phone?`<span class="chip">${esc(p.phone)}</span>`:''}${(u=>u?`<span class="chip ${u.autopay?'ok':''}">${u.autopay?'Autopay · '+esc(u.pm_label||'card on file'):'Portal · signed in'}</span>`:'')((ACCT.users||[]).find(u=>u.member_id===p.id))}</div></div>
      <div class="actions"><button class="btn" id="acEdit">Membership</button><button class="btn" id="acStmt">${I.down}Statement PDF</button><button class="btn" id="acCredit">Credit</button><button class="btn" id="acPay2">Record payment</button><button class="btn pri" id="acCharge2">${I.plus}Post charge</button></div></div><div class="rule"></div>
    <div class="grid g3">${kpi('Balance',balTxt(bal),bal>0.004?`current ${fmt2(ag.cur)} · 31–60 ${fmt2(ag.d30)} · 61–90 ${fmt2(ag.d60)} · 90+ ${fmt2(ag.d90)}`:bal<-0.004?'the club owes the member':'settled',amtCls(bal))}${kpi('Since last statement',fmt2(sum(since.filter(i=>i.kind==='charge'),i=>i.amount)),`${since.filter(i=>i.kind==='charge').length} charges · ${fmt2(sum(since.filter(i=>i.kind!=='charge'),i=>i.amount))} received`)}${kpi('Last statement',lastStmt?fmt2(lastStmt.closing):'—',lastStmt?`${dateTxt(lastStmt.period_end)} · due ${dateTxt(lastStmt.due)}${lastStmt.sent_at?' · e-mailed':''}`:'none yet')}</div>
    <div class="card lg" style="overflow:hidden"><div class="cardhead"><div><h2 class="h2">Account</h2><span class="muted">Newest first · running balance on the right</span></div></div>
      ${ledger.length?ledger.map(i=>`<div class="lr${i.void_at?' void':''}"><div class="cell2"><span class="ln" style="font-size:15px">${esc(i.descr||SOURCE_NAME[i.source]||'')}${i.void_at?' <span class="chip warn">void</span>':''}</span><span class="ls">${dateTxt(i.posted)} · <span class="chip" style="height:18px;font-size:11px">${esc((itemOf(i.item)||{}).name||SOURCE_NAME[i.source]||i.source)}</span>${i.kind==='charge'&&(n0(i.tax)||n0(i.svc))?` · ${fmt2(netOf(i))}${n0(i.svc)?' + '+fmt2(i.svc)+' service':''}${n0(i.tax)?' + '+fmt2(i.tax)+' tax':''}`:''}${i.kind!=='charge'?` · ${i.kind==='credit'?'credit':METHOD_NAME[i.method]||'payment'}${i.reference?' · '+esc(i.reference):''}`:''}${i.void_at?` · ${esc(i.void_reason||'')}`:''}</span></div>
        <div class="lm"><span class="${i.kind==='charge'?'':'pos'}">${i.kind==='charge'?'':'−'}${fmt2(i.amount)}</span></div><b class="lnet ${amtCls(i.run)}">${fmt2(i.run)}</b><span class="lact">${i.void_at?'':`<button class="ib" data-void="${i.id}" aria-label="Void">${I.x}</button>`}</span></div>`).join('')
      :'<div class="empty"><b>Nothing on this account yet</b><span>Monthly billing, the shop and bookings post here; post something by hand with the buttons above.</span></div>'}</div>
    ${stmts.length?`<div class="card lg" style="overflow:hidden"><div class="cardhead"><div><h2 class="h2">Statements</h2></div><div class="actions"><button class="btn sm" id="acMail">E-mail the latest</button></div></div>${stmts.map(s=>`<div class="lr la click" data-stmt="${s.id}"><div class="cell2"><span class="ln">${dateTxt(s.period_start)} – ${dateTxt(s.period_end)}</span><span class="ls">opening ${fmt2(s.opening)} · charges ${fmt2(s.charges)} · received ${fmt2(s.payments)} · due ${dateTxt(s.due)}${s.sent_at?' · e-mailed '+dateTxt(s.sent_at.slice(0,10)):''}</span></div><b class="lnet ${amtCls(s.closing)}">${fmt2(s.closing)}</b><span class="lact ib">${I.down}</span></div>`).join('')}</div>`:''}`;
  $('acBack').onclick=()=>go('accounts'); $('acCharge2').onclick=()=>postDrawer('charge',p); $('acPay2').onclick=()=>postDrawer('payment',p); $('acCredit').onclick=()=>postDrawer('credit',p); $('acEdit').onclick=()=>membershipDrawer(p);
  $('acStmt').onclick=()=>{ const s=stmts[0]||currentStatement(p.id); statementsPDF([s]); }; const am=$('acMail'); if(am) am.onclick=async()=>{ await mailStatements([stmts[0]]); render(); };
  m.querySelectorAll('[data-stmt]').forEach(r=>r.onclick=()=>statementsPDF([stmts.find(s=>s.id===r.dataset.stmt)]));
  m.querySelectorAll('[data-void]').forEach(x2=>x2.onclick=async()=>{ const i=items.find(y=>y.id===x2.dataset.void); const reason=prompt(`Void ${fmt2(i.amount)} — ${i.descr}? Say why; it stays on the record.`); if(reason==null) return; if(!reason.trim()){ toast('A reason is needed'); return; } if(await acctVoid(i,reason.trim())) render(); });
}
/* the member's billing membership: class, status, dates — the same fields the Directory editor carries */
const membershipFields=(p)=>{ const b=acctSettings(), x=pBilling(p); return pair(field('Membership class','bmC',x.class,{type:'select',options:[['','— No class (not billed) —']].concat(b.classes.map(c=>[c.id,c.name]))}),field('Billing status','bmS',x.status,{type:'select',options:BSTATUS}))+pair(field('Billed from','bmF',x.since,{type:'date',hint:'A mid-month start is prorated by days.'}),field('Resigned through','bmU',x.until,{type:'date',hint:'The last billable day of a resigned member.'})); };
const readMembership=p=>{ const x=pBilling(p); x.class=fv('bmC'); x.status=fv('bmS')||'active'; x.since=fv('bmF'); x.until=fv('bmU'); if(x.status!=='resigned') x.until=''; };
function membershipDrawer(p){ openDrawer({kicker:'Member accounts',title:memberName(p)+' — membership',body:membershipFields(p)+'<p class="hint">Active and suspended members are billed their class charges every run; a leave of absence pays nothing; a resigned member is billed through their last day and then no more.</p>',save:()=>{ readMembership(p); persist(); }}); }
/* post a charge, a payment or a credit — to one member, or pick the member first; a charge picks an item and gets its tax / service charge */
function postDrawer(kind,p){
  const b=acctSettings(), title=kind==='charge'?'Post a charge':kind==='payment'?'Record a payment':'Give a credit';
  const ppl=persons().filter(x=>x.status!=='Inactive').sort((a,b2)=>memberName(a).localeCompare(memberName(b2)));
  const tot=()=>{ const it=itemOf(fv('apI')), m=chargeFor(fv('apI'),fnum('apA')); const h=$('apTot'); if(!h) return; h.textContent=m.net?`${fmt2(m.net)}${m.svc?' + '+fmt2(m.svc)+' service charge ('+n0(b.svc.rate)+'%)':''}${m.tax?' + '+fmt2(m.tax)+' tax ('+n0(b.tax.rate)+'%)':''} = ${fmt2(m.amount)} on the account`:it?`${it.taxable?'Taxed':'No tax'}${it.svc?' · service charge':''}`:''; };
  openDrawer({kicker:'Member accounts',title,saveLabel:title.split(' ')[0],
    body:(p?`<p class="hint" style="margin:0 0 10px"><b>${esc(memberName(p))}</b>${p.memberNo?' · #'+esc(p.memberNo):''} · balance ${balTxt(balanceOf(p.id))}</p>`:field('Member','apM','',{type:'select',options:[['','— Member —']].concat(ppl.map(x=>[x.id,memberName(x)+(x.memberNo?' · #'+x.memberNo:'')]))}))+
      pair(field(kind==='charge'?'Amount $ (before tax)':'Amount $','apA','',{type:'number'}),field('Date','apD',todayISO(),{type:'date'}))+
      (kind==='charge'?field('Item','apI','other',{type:'select',options:b.items.filter(x=>!['finance','late','min'].includes(x.id)).map(x=>[x.id,x.name])})+'<p class="hint" id="apTot"></p>':kind==='payment'?pair(field('How','apS','card',{type:'select',options:METHODS}),field('Reference','apR','',{ph:'check #, last four, confirmation'})):'')+
      field('Description','apN','',{ph:kind==='charge'?'e.g. Guest fee · Oct 12':kind==='payment'?'e.g. Statement payment':'e.g. Rain check'}),
    wire:r=>{ if(kind==='charge'){ r.querySelector('#apA').oninput=tot; r.querySelector('#apI').onchange=tot; tot(); } },
    save:async()=>{ const mid=p?p.id:fv('apM'), amt=fnum('apA'); if(!mid||!(amt>0)){ toast('Pick a member and an amount'); return false; }
      const o={member_id:mid,kind,amount:amt,posted:fv('apD')||todayISO(),descr:fv('apN')||(kind==='charge'?(itemOf(fv('apI'))||{}).name||'Charge':kind==='payment'?'Payment':'Credit')};
      if(kind==='charge'){ const it=itemOf(fv('apI'))||{id:'other',source:'manual',gl:''}; Object.assign(o,chargeFor(it.id,amt),{source:it.source,item:it.id,gl:it.gl}); delete o.net; }
      if(kind==='payment'){ o.source='manual'; o.method=fv('apS')||'other'; o.reference=fv('apR')||null; } if(kind==='credit'){ o.source='manual'; o.item='credit'; }
      const it=await acctPost(o); if(!it) return false; toast(`${title.split(' ')[0]}ed — ${fmt2(o.amount)}`); if(view.page!=='account'){ view.acctId=mid; view.page='account'; } }});
}
/* ---------- Billing setup: classes and their charges, items with tax / service charge / GL, rates, finance charges, statements ---------- */
function vBillSetup(m){
  if(!acctOn()){ go('dash'); return; } const b=acctSettings(); const n=cid=>persons().filter(p=>pBilling(p).class===cid&&p.status!=='Inactive').length;
  m.innerHTML=`<div class="crumb"><button id="bsBack">Member accounts</button><span class="muted">/</span><span class="muted">Billing setup</span></div>`+head('Billing setup','Membership classes and what each one is charged, the items the club bills with their tax, service charge and ledger accounts, and the rules for statements.',btn('Statement rules','bsRules','')+btn('Rates & accounts','bsRates','')+btn('New class','bsNewC','pri',I.plus))+`
    <div class="grid g3">${kpi('Classes',b.classes.length,`${persons().filter(p=>pBilling(p).class&&p.status!=='Inactive').length} members in a class`)}${kpi('Sales tax',n0(b.tax.rate)+'%',`service charge ${n0(b.svc.rate)}% on F&B`)}${kpi('Finance charge',n0(b.finance.pct)+'% / month',`${n0(b.lateFee.amount)?fmt2(b.lateFee.amount)+' late fee · ':''}due ${b.dueDays} days after the statement`)}</div>
    <div class="card"><div class="cardhead"><div><h2 class="h2">Online payments &amp; the member portal</h2><span class="muted">Members sign in with their e-mail at <b>${esc(portalLink())}</b> to see their account, statements and pay</span></div><div class="actions">${b.online.charges_enabled?'<button class="btn sm" id="bsSt">Refresh status</button>':b.online.connected?'<button class="btn sm pri" id="bsCon">Finish Stripe onboarding</button><button class="btn sm" id="bsSt">Refresh status</button>':'<button class="btn sm pri" id="bsCon">Connect with Stripe</button><button class="btn sm" id="bsSt">Check</button>'}</div></div>
      <p class="hint" style="margin:0">${b.online.charges_enabled?`<span class="chip ok">Connected</span> Payments by card or bank account go straight to the club’s own Stripe account; each one lands on the member’s account here within seconds. ${(ACCT.users||[]).filter(u=>u.autopay).length} member${(ACCT.users||[]).filter(u=>u.autopay).length===1?'':'s'} on autopay — Run statements can charge their balance due.`:b.online.connected?'The Stripe account exists but onboarding isn’t finished — the club’s owner completes it (business details, bank account), then refresh.':'Connect the club’s Stripe account and members can pay their statements online, with autopay if they like. The club keeps its own merchant account; Flagstick never holds the money.'}</p></div>
    <div class="card"><div class="cardhead"><div><h2 class="h2">Membership classes</h2><span class="muted">What a member of each class is billed, and when</span></div></div>
      ${b.classes.length?`<div class="grid g2">${b.classes.map(c=>`<div class="card pad" style="box-shadow:none;border:1px solid var(--line)"><div style="display:flex;justify-content:space-between;align-items:flex-start;gap:10px"><div><b style="font-size:17px;color:var(--navy)">${esc(c.name)}</b><div class="muted" style="font-size:12.5px">${n(c.id)} member${n(c.id)===1?'':'s'} · ${fmt2(sum(c.charges.filter(ch=>ch.every==='month'),ch=>ch.amount))} a month</div></div><button class="btn sm" data-ec="${c.id}">Edit</button></div>
        <div style="margin-top:10px;font-size:13.5px">${c.charges.length?c.charges.map(ch=>`<div style="display:flex;justify-content:space-between;gap:10px;padding:4px 0;border-top:1px solid var(--line)"><span>${esc((itemOf(ch.itemId)||{}).name||ch.itemId)} <span class="muted">· ${ch.every==='month'?'monthly':ch.every==='quarter'?'quarterly from '+MONTHS_LONG[(ch.month||1)-1]:'yearly in '+MONTHS_LONG[(ch.month||1)-1]}</span></span><b>${fmt2(ch.amount)}</b></div>`).join(''):'<span class="muted">No charges yet</span>'}${n0(c.minimum.amount)?`<div style="display:flex;justify-content:space-between;gap:10px;padding:4px 0;border-top:1px solid var(--line)"><span>F&amp;B minimum <span class="muted">· ${c.minimum.every==='month'?'monthly':c.minimum.every==='quarter'?'quarterly':'yearly'}, unspent part billed</span></span><b>${fmt2(c.minimum.amount)}</b></div>`:''}</div></div>`).join('')}</div>`
      :'<div class="empty"><b>No classes yet</b><span>Add Full, Social, Junior, Corporate… and what each one pays. Then give each member a class (the Directory, or Membership on their account).</span></div>'}</div>
    <div class="card" style="overflow:hidden"><div class="cardhead"><div><h2 class="h2">Items the club bills</h2><span class="muted">Each with its revenue account, and whether tax and the service charge apply</span></div><div class="actions"><button class="btn sm" id="bsNewI">${I.plus}Item</button></div></div>
      <div class="t"><div class="tr th" style="grid-template-columns:minmax(140px,1.4fr) 130px 90px 70px 90px 60px"><span>Item</span><span>Kind</span><span>GL account</span><span>Tax</span><span>Service</span><span></span></div>
      ${b.items.map(x=>`<div class="tr" style="grid-template-columns:minmax(140px,1.4fr) 130px 90px 70px 90px 60px"><div class="cell2"><b>${esc(x.name)}</b></div><span class="muted">${esc(SOURCE_NAME[x.source]||x.source)}</span><span class="num">${esc(x.gl||'—')}</span><span>${x.taxable?'yes':'—'}</span><span>${x.svc?'yes':'—'}</span><span class="actions"><button class="ib" data-ei="${x.id}" aria-label="Edit">${I.edit}</button></span></div>`).join('')}</div></div>`;
  $('bsBack').onclick=()=>go('accounts'); const bc=$('bsCon'); if(bc) bc.onclick=stripeConnect; const bst=$('bsSt'); if(bst) bst.onclick=()=>stripeStatus(false); $('bsNewC').onclick=()=>classDrawer(null); $('bsNewI').onclick=()=>itemDrawer(null); $('bsRules').onclick=()=>statementRulesDrawer(); $('bsRates').onclick=()=>ratesDrawer();
  m.querySelectorAll('[data-ec]').forEach(x=>x.onclick=()=>classDrawer(classOf(x.dataset.ec))); m.querySelectorAll('[data-ei]').forEach(x=>x.onclick=()=>itemDrawer(itemOf(x.dataset.ei)));
}
function classDrawer(c){ const b=acctSettings(); const d=c?clone(c):{id:uid(),name:'',charges:[],minimum:{amount:0,every:'month'}}; if(!d.charges.length&&!c) d.charges.push({id:uid(),itemId:'dues',amount:'',every:'month',month:1});
  const rows=()=>d.charges.map((ch,i)=>`<div class="mr" style="grid-template-columns:minmax(0,1.4fr) 90px minmax(0,1fr) 28px"><select class="inp" data-ci="${i}" data-k="itemId">${b.items.filter(x=>!['finance','late','min'].includes(x.id)).map(x=>`<option value="${x.id}"${x.id===ch.itemId?' selected':''}>${esc(x.name)}</option>`).join('')}</select><input class="inp r" data-ci="${i}" data-k="amount" inputmode="decimal" value="${esc(ch.amount)}" placeholder="$" aria-label="Amount"><select class="inp" data-ci="${i}" data-k="every">${EVERY.map(([v,l])=>`<option value="${v}"${v===ch.every?' selected':''}>${l}</option>`).join('')}${ch.every!=='month'?MONTHS_LONG.map((mn,j)=>`<option value="m${j+1}"${(ch.month||1)===j+1?' selected':''}>— in ${mn}</option>`).join(''):''}</select><button class="ib" data-cdel="${i}" type="button" aria-label="Remove">${I.x}</button></div>`).join('');
  openDrawer({kicker:'Billing setup',title:c?c.name:'New membership class',wide:true,
    body:field('Class name','bcN',d.name,{ph:'Full · Social · Junior · Corporate'})+`<div class="fld"><div style="display:flex;justify-content:space-between;align-items:center"><span class="lbl">Charges</span><button class="btn sm" id="bcAdd" type="button">${I.plus}Charge</button></div><div class="mini"><div id="bcRows">${rows()}</div></div><p class="hint">Monthly charges post every run; quarterly ones every third month from the month chosen; yearly ones once, in that month. A member who joins or resigns mid-month pays that month by the day.</p></div>`+
      pair(field('Food & beverage minimum $','bcMin',d.minimum.amount||'',{type:'number'}),field('Minimum period','bcMinE',d.minimum.every,{type:'select',options:EVERY.map(([v,l])=>[v,v==='month'?'Each month':v==='quarter'?'Each quarter':'Each year'])}))+'<p class="hint">When a period closes, a member who spent less than the minimum on food & beverage (before tax and service) is billed the difference.</p>',
    wire:r=>{ const bind=()=>{ r.querySelectorAll('[data-ci]').forEach(e=>e.onchange=e.oninput=()=>{ const ch=d.charges[+e.dataset.ci], k=e.dataset.k; if(k==='every'){ if(e.value.startsWith('m')){ ch.month=+e.value.slice(1); } else { ch.every=e.value; if(ch.every!=='month'&&!ch.month) ch.month=1; } r.querySelector('#bcRows').innerHTML=rows(); bind(); } else ch[k]=e.value; }); r.querySelectorAll('[data-cdel]').forEach(x=>x.onclick=()=>{ d.charges.splice(+x.dataset.cdel,1); r.querySelector('#bcRows').innerHTML=rows(); bind(); }); }; bind();
      r.querySelector('#bcAdd').onclick=()=>{ d.charges.push({id:uid(),itemId:'cart',amount:'',every:'month',month:1}); r.querySelector('#bcRows').innerHTML=rows(); bind(); }; },
    save:()=>{ d.name=fv('bcN'); if(!d.name){ toast('Name the class'); return false; } d.charges=d.charges.filter(ch=>n0(ch.amount)>0).map(ch=>({id:ch.id,itemId:ch.itemId,amount:n0(ch.amount),every:ch.every||'month',month:ch.every==='month'?undefined:(+ch.month||1)}));
      d.minimum={amount:fnum('bcMin'),every:fv('bcMinE')||'month'}; if(c) Object.assign(c,d); else b.classes.push(d); persist(); },
    del:c?()=>{ if(n0(persons().filter(p=>pBilling(p).class===c.id).length)&&!confirm(`${persons().filter(p=>pBilling(p).class===c.id).length} members carry this class; they will have no class. Delete it?`)) return false; b.classes=b.classes.filter(x=>x!==c); persons().forEach(p=>{ if(pBilling(p).class===c.id) p.billing.class=''; }); persist(); }:null}); }
function itemDrawer(x){ const b=acctSettings(); const fixed=x&&['finance','late','min','credit'].includes(x.id);
  openDrawer({kicker:'Billing setup',title:x?x.name:'New item',body:field('Name','biN',x?x.name:'')+pair(field('Kind','biS',x?x.source:'fee',{type:'select',options:SOURCES}),field('GL revenue account','biG',x?x.gl:'',{ph:'4000'}))+`<label class="check"><input type="checkbox" id="biT"${x&&x.taxable?' checked':''}>Sales tax applies</label><label class="check"><input type="checkbox" id="biV"${x&&x.svc?' checked':''}>Service charge applies</label>`,
    save:()=>{ const name=fv('biN'); if(!name){ toast('Name the item'); return false; } const d={name,source:fv('biS')||'manual',gl:fv('biG'),taxable:$('biT').checked,svc:$('biV').checked}; if(x) Object.assign(x,d); else b.items.push(Object.assign({id:uid()},d)); persist(); },
    del:x&&!fixed&&!DEFAULT_ITEMS.some(y=>y.id===x.id)?()=>{ b.items=b.items.filter(y=>y!==x); persist(); }:null}); }
function ratesDrawer(){ const b=acctSettings(); openDrawer({kicker:'Billing setup',title:'Rates & ledger accounts',
    body:pair(field('Sales tax %','brT',b.tax.rate,{type:'number'}),field('Service charge %','brS',b.svc.rate,{type:'number',hint:'On items marked for it (food & beverage). It is taxed where tax applies.'}))+'<p class="lbl" style="margin-top:6px">General ledger accounts</p>'+pair(field('Accounts receivable','brAr',b.gl.ar),field('Cash / undeposited funds','brCash',b.gl.cash))+pair(field('Sales tax payable','brTax',b.gl.tax),field('Service charge revenue','brSvc',b.gl.svc))+field('Credits & adjustments','brCr',b.gl.credit),
    save:()=>{ b.tax.rate=Math.max(0,fnum('brT')); b.svc.rate=Math.max(0,fnum('brS')); b.gl={ar:fv('brAr'),cash:fv('brCash'),tax:fv('brTax'),svc:fv('brSvc'),credit:fv('brCr')}; persist(); }}); }
function statementRulesDrawer(){ const b=acctSettings(); openDrawer({kicker:'Billing setup',title:'Statement rules',
    body:pair(field('Payment due, days after the statement','bsDue',b.dueDays,{type:'number'}),field('Finance charge % per month','bsFc',b.finance.pct,{type:'number',hint:'On what is still owed from the previous statement after its due date. 0 = none.'}))+pair(field('Only when past due is at least $','bsFm',b.finance.min,{type:'number'}),field('Late fee $','bsLf',b.lateFee.amount,{type:'number',hint:'A flat fee on top, 0 = none.'}))+field('Message on every statement','bsMsg',b.message,{type:'textarea'})+'<p class="hint">Finance charges and late fees are posted by Run statements, dated the period end, and appear on that statement.</p>',
    save:()=>{ b.dueDays=Math.max(0,Math.round(fnum('bsDue'))); b.finance={pct:Math.max(0,fnum('bsFc')),min:Math.max(0,fnum('bsFm'))}; b.lateFee={amount:Math.max(0,fnum('bsLf'))}; b.message=fv('bsMsg'); persist(); }}); }
/* ---------- statements ---------- */
/* a member's statement for a period from the ledger: opening = everything before the period, then the period's items */
function buildStatement(mid,start,end){
  const its=liveItems().filter(i=>i.member_id===mid), before=its.filter(i=>(i.posted||'')<start), inP=its.filter(i=>(i.posted||'')>=start&&(i.posted||'')<=end);
  const opening=Math.round(before.reduce((t,i)=>t+itemSign(i),0)*100)/100, charges=Math.round(sum(inP.filter(i=>i.kind==='charge'),i=>i.amount)*100)/100, payments=Math.round(sum(inP.filter(i=>i.kind!=='charge'),i=>i.amount)*100)/100;
  return {id:uid(),member_id:mid,period_start:start,period_end:end,opening,charges,payments,closing:Math.round((opening+charges-payments)*100)/100,due:isoPlus(end,acctSettings().dueDays),issued_at:new Date().toISOString(),created_by:whoAmI(),items:inP.sort(byDate)}; }
/* the open period for one member (since their last statement) — for a statement on demand */
function currentStatement(mid){ const last=stmtsOf(mid)[0], its=liveItems().filter(i=>i.member_id===mid).sort(byDate);
  const start=last?isoPlus(last.period_end,1):(its[0]&&its[0].posted)||todayISO(); return buildStatement(mid,start,todayISO()); }
function runStatementsDrawer(){
  const b=acctSettings(), last=(ACCT.stmts||[]).slice().sort((a,b2)=>String(b2.period_end).localeCompare(String(a.period_end)))[0], defEnd=lastDayOfPrevMonth();
  openDrawer({kicker:'Member accounts',title:'Run statements',saveLabel:'Run statements',
    body:field('Period ends','rsEnd',last&&last.period_end>=defEnd?todayISO():defEnd,{type:'date',hint:last?`The last run closed ${dateTxt(last.period_end)}; this run starts the day after for everyone it covered.`:'The first run: each member’s statement starts at their first item.'})+
      `<label class="check"><input type="checkbox" id="rsZero">Include members with no activity and a zero balance</label>${acctCloud()?`<label class="check"><input type="checkbox" id="rsMail">E-mail each statement to the member (those with an e-mail address)</label>`:''}${acctCloud()&&b.online.charges_enabled&&(ACCT.users||[]).some(u=>u.autopay)?`<label class="check"><input type="checkbox" id="rsAuto" checked>Charge autopay members’ cards on file for their balance due (${(ACCT.users||[]).filter(u=>u.autopay).length})</label>`:''}<p class="hint">One statement per member with a balance or activity in the period, saved to their account, and one PDF with a page per member. ${n0(b.finance.pct)||n0(b.lateFee.amount)?`Past-due balances from the previous statement get ${n0(b.finance.pct)?n0(b.finance.pct)+'% finance charge':''}${n0(b.finance.pct)&&n0(b.lateFee.amount)?' and ':''}${n0(b.lateFee.amount)?'a '+fmt2(b.lateFee.amount)+' late fee':''} first. `:''}Due ${b.dueDays} days after the period ends (Billing setup → Statement rules).</p>`,
    save:async()=>{ const end=fv('rsEnd'); if(!end){ toast('Pick the period end'); return false; }
      // 1. finance charges and late fees on what is still past due, so they land on this statement
      const B=acctBalances(), late=[]; for(const [mid] of B) late.push(...lateCharges(mid,end));
      if(late.length){ const items=late.map(o=>Object.assign({id:uid(),method:null,reference:null,void_at:null,void_reason:null,created_at:new Date().toISOString(),created_by:whoAmI()},o));
        if(acctCloud()){ const {error}=await sb.from('acct_items').insert(items.map(trow)); if(error){ toast('Couldn’t post finance charges: '+error.message); return false; } } ACCT.items=(ACCT.items||[]).concat(items); }
      // 2. the statements
      const B2=acctBalances(), lastOf=new Map(); (ACCT.stmts||[]).forEach(s=>{ const l=lastOf.get(s.member_id); if(!l||s.period_end>l) lastOf.set(s.member_id,s.period_end); });
      const out=[]; for(const [mid] of B2){ const prev=lastOf.get(mid); if(prev&&prev>=end) continue; const its=liveItems().filter(i=>i.member_id===mid).sort(byDate); const start=prev?isoPlus(prev,1):its[0].posted; if(start>end) continue;
        const s=buildStatement(mid,start,end); if(!$('rsZero').checked&&!s.items.length&&Math.abs(s.closing)<0.005) continue; out.push(s); }
      if(!out.length){ if(!acctCloud()) acctLocalWrite(); toast('Nothing to close for that period'); return false; }
      const runId=uid(), rows=out.map(s=>{ const {items,...rest}=s; return Object.assign(rest,{run_id:runId}); });
      if(acctCloud()){ const {error}=await sb.from('acct_statements').insert(rows.map(trow)); if(error){ toast('Couldn’t save statements: '+error.message); return false; } }
      ACCT.stmts=(ACCT.stmts||[]).concat(rows); if(!acctCloud()) acctLocalWrite();
      toast(`${out.length} statement${out.length===1?'':'s'} run · ${fmt2(sum(out,s=>s.closing))} outstanding${late.length?' · '+late.length+' finance charge'+(late.length===1?'':'s'):''}`);
      const mail=$('rsMail')&&$('rsMail').checked, auto=$('rsAuto')&&$('rsAuto').checked; await statementsPDF(out); if(mail) await mailStatements(rows); if(auto) await autopayRun(); }});
}
async function statementsPDF(list,opt){ opt=opt||{};
  list=(list||[]).filter(Boolean); if(!list.length){ toast('No statement to print'); return null; }
  try{ await loadJsPDF(); }catch(e){ toast(e.message); return null; }
  const crest=await crestPNG().catch(()=>null), doc=new window.jspdf.jsPDF({unit:'pt',format:'letter'}); bcFonts(doc);
  const club=(CLUB&&CLUB.name)||CLUB_META.name, msg=acctSettings().message||'';
  list.forEach((s,idx)=>{ if(idx) doc.addPage(); const p=personById(s.member_id)||{}, items=s.items||liveItems().filter(i=>i.member_id===s.member_id&&(i.posted||'')>=s.period_start&&(i.posted||'')<=s.period_end).sort(byDate);
    statementPage(doc,{club,name:memberName(p)||'Member',lines:[p.memberNo?'Member #'+p.memberNo:'',p.address1||'',[p.city,p.state,p.zip].filter(Boolean).join(', '),p.email||''],s,items,msg,crest,idx,n:list.length}); });
  const name=list.length===1?`statement-${(memberName(personById(list[0].member_id)||{})||'member').replace(/\s+/g,'-').toLowerCase()}-${list[0].period_end}.pdf`:`statements-${list[0].period_end}.pdf`;
  if(opt.returnDoc) return doc;
  if(typeof deliverFile==='function'){ const blob=doc.output('blob'); await deliverFile(blob,name,'Statements'); } else doc.save(name); return doc;
}

/* ============ Reports — the club's year and quarters (the club runs on the calendar year, not seasons) ============
   Revenue by billing item from the accounts, receipts by method, outstanding receivables at the period end, the registers
   by outlet from the tickets, and the club's own budget lines — for the year on the bar or one quarter of it. */
function reportRange(y,q){ y=+y; const q1=q?+q:0; const from=q1?`${y}-${String((q1-1)*3+1).padStart(2,'0')}-01`:`${y}-01-01`; const to=q1?new Date(Date.UTC(y,q1*3,0)).toISOString().slice(0,10):`${y}-12-31`; return {from,to,label:q1?`Q${q1} ${y}`:String(y)}; }
function clubReport(y,q){ const R=reportRange(y,q), inR=d=>d>=R.from&&d<=R.to, L=liveItems(); const rep={range:R,items:{},sources:{},methods:{},charges:0,net:0,tax:0,svc:0,payments:0,credits:0,ar:0,arOpen:0,outlets:{},pos:null,byMonth:{}};
  for(const i of L){ if(i.posted<=R.to&&i.kind==='charge') rep.ar+=n0(i.amount); if(i.posted<=R.to&&i.kind!=='charge') rep.ar-=n0(i.amount); if(!inR(i.posted)) continue; const mo=i.posted.slice(0,7); const M=rep.byMonth[mo]=rep.byMonth[mo]||{charges:0,payments:0};
    if(i.kind==='charge'){ const it=itemOf(i.item)||{}, k=i.item||i.source||'other', name=it.name||SOURCE_NAME[i.source]||'Other'; const r=rep.items[k]=rep.items[k]||{name,source:it.source||i.source,n:0,net:0,tax:0,svc:0,amount:0}; r.n++; r.net+=netOf(i); r.tax+=n0(i.tax); r.svc+=n0(i.svc); r.amount+=n0(i.amount);
      const sk=it.source||i.source||'manual'; rep.sources[sk]=(rep.sources[sk]||0)+netOf(i); rep.charges+=n0(i.amount); rep.net+=netOf(i); rep.tax+=n0(i.tax); rep.svc+=n0(i.svc); M.charges+=n0(i.amount); }
    else if(i.kind==='payment'){ rep.payments+=n0(i.amount); rep.methods[i.method||'other']=(rep.methods[i.method||'other']||0)+n0(i.amount); M.payments+=n0(i.amount); }
    else rep.credits+=n0(i.amount); }
  rep.ar=Math.round(rep.ar*100)/100;
  if(typeof POS!=='undefined'&&POS.tickets){ const T=POS.tickets.filter(t=>t.status!=='open'&&inR(String(t.closed_at||t.created_at).slice(0,10))); rep.pos=shiftStats(T); for(const o of posSettings().outlets) rep.outlets[o.id]=Object.assign({name:o.name,kind:o.kind},shiftStats(T.filter(t=>t.outlet===o.id))); }
  const r2=o=>{ for(const k in o) if(typeof o[k]==='number') o[k]=Math.round(o[k]*100)/100; }; r2(rep); Object.values(rep.items).forEach(r2); r2(rep.sources); r2(rep.methods); Object.values(rep.byMonth).forEach(r2); return rep; }
function vReports(m){ if(!acctOn()){ go('dash'); return; } if(ACCT.items==null){ acctLoad().then(()=>render()); m.innerHTML=head('Reports','Loading…'); return; }
  if(typeof posOn==='function'&&posOn()&&POS.tickets==null) posLoad().then(()=>render());
  const y=Y(), q=view.q||'', rep=clubReport(y,q), R=rep.range, sc=scalc(y);
  const items=Object.values(rep.items).sort((a,b)=>b.net-a.net), months=Object.keys(rep.byMonth).sort();
  const row=(k,v,cls='')=>`<div class="tr num ${cls}" style="grid-template-columns:1fr 140px"><span>${k}</span><b class="r">${v}</b></div>`;
  m.innerHTML=head('Reports',`${esc(CLUB.name||CLUB_META.name)} · ${R.label} · ${dateTxt(R.from)} – ${dateTxt(R.to)}`,yearBar(true)+btn('CSV','rpCSV','',I.down)+btn('Report (PDF)','rpPDF','pri',I.down))+`
  <div class="grid g4">${kpi('Billed',fmt(rep.charges),'charges to member accounts, incl. tax & service')}${kpi('Revenue (net)',fmt(rep.net),'before tax and service charge')}${kpi('Received',fmt(rep.payments),'payments recorded')}${kpi('Receivable',fmt(rep.ar),'owed by members at '+dateTxt(R.to),rep.ar>0?'neg':'')}</div>
  <div class="card" style="overflow:hidden"><div class="cardhead"><h2 class="h2">Revenue by item</h2><span class="muted">${items.length} item${items.length===1?'':'s'}</span></div><div class="t fit">
      <div class="tr th" style="grid-template-columns:minmax(140px,1fr) 70px 120px 110px 110px"><span>Item</span><span class="r">Count</span><span class="r">Net</span><span class="r">Tax</span><span class="r">Service</span></div>
      ${items.map(r=>`<div class="tr num" style="grid-template-columns:minmax(140px,1fr) 70px 120px 110px 110px"><span style="font-weight:600;color:var(--navy)">${esc(r.name)}<small class="muted" style="display:block">${esc(SOURCE_NAME[r.source]||r.source||'')}</small></span><span class="r">${r.n}</span><b class="r">${fmt2(r.net)}</b><span class="r muted">${fmt2(r.tax)}</span><span class="r muted">${fmt2(r.svc)}</span></div>`).join('')||'<p class="muted" style="padding:14px">Nothing billed in this period.</p>'}
      ${items.length?`<div class="tr num" style="grid-template-columns:minmax(140px,1fr) 70px 120px 110px 110px;border-top:2px solid var(--line)"><b>Total</b><span></span><b class="r">${fmt2(rep.net)}</b><b class="r">${fmt2(rep.tax)}</b><b class="r">${fmt2(rep.svc)}</b></div>`:''}
    </div></div>
  <div class="grid g2">
    <div>
      <div class="card" style="overflow:hidden"><div class="cardhead"><h2 class="h2">Receipts by method</h2></div><div class="t fit">${METHODS.map(([k,l])=>rep.methods[k]?row(l,fmt2(rep.methods[k])):'').join('')||'<p class="muted" style="padding:14px">No payments in this period.</p>'}${rep.credits?row('Credits & adjustments',fmt2(rep.credits),'muted'):''}</div></div>
      <div class="card" style="overflow:hidden"><div class="cardhead"><h2 class="h2">Registers</h2><span class="muted">${rep.pos?'from the tickets':'point of sale is off'}</span></div><div class="t fit">${rep.pos?Object.values(rep.outlets).filter(o=>o.n).map(o=>row(`${esc(o.name)} <small class="muted">· ${o.n} ticket${o.n===1?'':'s'}</small>`,fmt2(o.sales))).join('')+row('Service charge',fmt2(rep.pos.svc),'muted')+row('Sales tax',fmt2(rep.pos.tax),'muted')+row('Tips',fmt2(rep.pos.tips),'muted'):''}</div></div>
    </div>
    <div>
    <div class="card" style="overflow:hidden"><div class="cardhead"><h2 class="h2">By month</h2></div><div class="t fit"><div class="tr th" style="grid-template-columns:1fr 130px 130px"><span>Month</span><span class="r">Billed</span><span class="r">Received</span></div>${months.map(mo=>`<div class="tr num" style="grid-template-columns:1fr 130px 130px"><span>${esc(ymTxt(mo))}</span><span class="r">${fmt2(rep.byMonth[mo].charges)}</span><span class="r">${fmt2(rep.byMonth[mo].payments)}</span></div>`).join('')||'<p class="muted" style="padding:14px">No activity yet.</p>'}</div></div>
    <div class="card" style="overflow:hidden"><div class="cardhead"><h2 class="h2">${esc(String(y))} budget</h2><a class="lnk" data-go="budget">Open the budget</a></div><div class="t fit">${row('Budgeted revenue',fmt(sc.revenue))}${row('Budgeted expenses',fmt(sc.expenses))}${row('Projected net',fmtS(sc.projected))}${row('Actual net to date',fmtS(sc.netA))}</div></div>
    </div>
  </div>`;
  m.querySelectorAll('[data-go]').forEach(a=>a.onclick=()=>go(a.dataset.go)); wireYearBar(m);
  $('rpCSV').onclick=()=>reportCSV(rep); $('rpPDF').onclick=()=>reportPDF(rep,sc); }
function reportCSV(rep){ const qq=v=>'"'+String(v??'').replace(/"/g,'""')+'"', L=[['Flagstick report',rep.range.label,rep.range.from,rep.range.to],[],['Revenue by item','Source','Count','Net','Tax','Service','Billed']];
  Object.values(rep.items).sort((a,b)=>b.net-a.net).forEach(r=>L.push([r.name,SOURCE_NAME[r.source]||r.source||'',r.n,r.net.toFixed(2),r.tax.toFixed(2),r.svc.toFixed(2),r.amount.toFixed(2)])); L.push(['Total','','',rep.net.toFixed(2),rep.tax.toFixed(2),rep.svc.toFixed(2),rep.charges.toFixed(2)],[]);
  L.push(['Receipts by method','Amount']); Object.entries(rep.methods).forEach(([k,v])=>L.push([METHOD_NAME[k]||k,v.toFixed(2)])); L.push(['Payments',rep.payments.toFixed(2)],['Credits & adjustments',rep.credits.toFixed(2)],['Receivable at '+rep.range.to,rep.ar.toFixed(2)],[]);
  if(rep.pos){ L.push(['Registers','Tickets','Net sales','Service','Tax','Tips']); Object.values(rep.outlets).forEach(o=>L.push([o.name,o.n,o.sales.toFixed(2),o.svc.toFixed(2),o.tax.toFixed(2),o.tips.toFixed(2)])); L.push([]); }
  L.push(['Month','Billed','Received']); Object.keys(rep.byMonth).sort().forEach(mo=>L.push([mo,rep.byMonth[mo].charges.toFixed(2),rep.byMonth[mo].payments.toFixed(2)]));
  dl(L.map(r=>r.map(qq).join(',')).join('\n'),'text/csv',`report-${rep.range.label.replace(/\s+/g,'-').toLowerCase()}.csv`); }
async function reportPDF(rep,sc){ try{ await loadJsPDF(); }catch(e){ toast(e.message); return; } const crest=await crestPNG().catch(()=>null), doc=new window.jspdf.jsPDF({unit:'pt',format:'letter'}); bcFonts(doc);
  const NAVY=[15,42,56],GOLD=[199,161,58],GOLDL=[216,183,95],GOLDDK=[126,95,26],IVORY=[251,250,245],INK=[20,34,43],MUTED=[86,98,106]; const L=40,R=572,W=612,H=792, font=(f,s,z,c)=>{ doc.setFont(f,s); doc.setFontSize(z); doc.setTextColor(...c); };
  doc.setFillColor(...IVORY); doc.rect(0,0,W,H,'F'); doc.setFillColor(...GOLD); doc.roundedRect(L,32,R-L,82,8,8,'F'); doc.setFillColor(...NAVY); doc.roundedRect(L,32,R-L,78,8,8,'F'); doc.rect(L,98,R-L,8,'F'); const lw=drawCrest(doc,crest,L+16,42,54), TX=L+16+(lw||45)+15;
  font('PublicSansXB','normal',6.8,GOLDL); doc.text(String(brandName()).toUpperCase(),TX,56,{charSpace:1.2}); font('Cormorant','bold',24,[255,255,255]); doc.text(`${rep.range.label} — the club's numbers`,TX,80); font('PublicSans','normal',8.4,[214,218,220]); doc.text(`${dateTxt(rep.range.from)} – ${dateTxt(rep.range.to)}`,TX,94);
  let y=136; const page=()=>{ if(y>H-70){ doc.addPage(); doc.setFillColor(...IVORY); doc.rect(0,0,W,H,'F'); y=60; } }; const sec=t=>{ page(); font('PublicSansXB','normal',7.4,GOLDDK); doc.text(t.toUpperCase(),L,y,{charSpace:1.1}); y+=6; doc.setDrawColor(...GOLD); doc.setLineWidth(1); doc.line(L,y,R,y); y+=14; }; const row=(k,v,b)=>{ page(); font('PublicSans',b?'bold':'normal',b?10.5:9.5,INK); doc.text(k,L,y); doc.text(v,R,y,{align:'right'}); y+=14; };
  sec('The period'); row('Billed to member accounts',fmt2(rep.charges)); row('Revenue before tax & service',fmt2(rep.net),true); row('Sales tax collected',fmt2(rep.tax)); row('Service charge',fmt2(rep.svc)); row('Payments received',fmt2(rep.payments),true); row('Credits & adjustments',fmt2(rep.credits)); row(`Receivable at ${dateTxt(rep.range.to)}`,fmt2(rep.ar),true); y+=10;
  sec('Revenue by item'); Object.values(rep.items).sort((a,b)=>b.net-a.net).forEach(r=>row(`${r.name} · ${r.n}`,fmt2(r.net))); y+=10;
  sec('Receipts by method'); Object.entries(rep.methods).forEach(([k,v])=>row(METHOD_NAME[k]||k,fmt2(v))); y+=10;
  if(rep.pos){ sec('Registers'); Object.values(rep.outlets).filter(o=>o.n).forEach(o=>row(`${o.name} · ${o.n} tickets`,fmt2(o.sales))); row('Tips',fmt2(rep.pos.tips)); y+=10; }
  sec('By month'); Object.keys(rep.byMonth).sort().forEach(mo=>row(ymTxt(mo),`${fmt2(rep.byMonth[mo].charges)} billed · ${fmt2(rep.byMonth[mo].payments)} received`)); y+=10;
  if(sc){ sec(`${rep.range.label.slice(-4)} budget`); row('Budgeted revenue',fmt(sc.revenue)); row('Budgeted expenses',fmt(sc.expenses)); row('Projected net',fmtS(sc.projected),true); }
  font('PublicSans','normal',7,MUTED); doc.text(`${brandName()} · printed ${new Date().toLocaleString('en-US',{month:'short',day:'numeric',hour:'numeric',minute:'2-digit'})}`,W/2,H-28,{align:'center'});
  doc.save(`report-${rep.range.label.replace(/\s+/g,'-').toLowerCase()}.pdf`); }
