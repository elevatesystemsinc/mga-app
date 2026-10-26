/* ============ Member accounts & billing (module 'billing' — the club hub, staff only) ============
   Each club bills its own members; Flagstick bills the club. So this is the club's ledger: every member has an
   account, every source of money (dues, food & beverage, the pro shop, tee times, facilities, lessons, fees) posts a
   charge to it, the club records payments and credits as they come in (its own terminal, checks, ACH, cash), and
   Run statements closes a period for everyone. Rows live in acct_items / acct_statements (billing-setup.sql), not in
   the organization documents — many staff, many rows. Local mode (tests, file://) keeps the same shapes in
   localStorage. Board logins and admin links never see any of it. */
const ACCT={items:null,stmts:null,loading:false,err:'',at:0};
const SOURCES=[['dues','Dues'],['fnb','Food & beverage'],['proshop','Pro shop'],['tee','Tee time'],['facility','Facility'],['lesson','Lesson'],['fee','Fee'],['manual','Other']];
const SOURCE_NAME=Object.fromEntries(SOURCES);
const METHODS=[['card','Card'],['check','Check'],['ach','ACH / bank'],['cash','Cash'],['other','Other']];
const METHOD_NAME=Object.fromEntries(METHODS);
const acctOn=()=>!!CLUB&&isClub()&&hasModule('billing')&&!KEYMODE&&!SCOPED;
const acctCloud=()=>CLOUD&&sessionOK;
const acctKey=()=>'fs_acct_'+((typeof TENANT!=='undefined'&&TENANT)||'local');
const acctSettings=()=>{ CLUB.billing=CLUB.billing||{}; const b=CLUB.billing; if(b.dueDays==null) b.dueDays=25; if(b.message==null) b.message='Thank you — payment is due by the date shown. Questions about your statement: the club office.'; return b; };
const whoAmI=()=>(typeof ACCESS!=='undefined'&&ACCESS&&ACCESS.email)||'board';
function acctLocalRead(){ try{ return JSON.parse(localStorage.getItem(acctKey())||'null')||{items:[],stmts:[]}; }catch(_){ return {items:[],stmts:[]}; } }
function acctLocalWrite(){ try{ localStorage.setItem(acctKey(),JSON.stringify({items:ACCT.items||[],stmts:ACCT.stmts||[]})); }catch(_){} }
/* the whole ledger once per visit; the pages read ACCT.items / ACCT.stmts */
async function acctLoad(force){
  if(ACCT.loading) return; if(ACCT.items&&!force) return; ACCT.loading=true; ACCT.err='';
  try{
    if(!acctCloud()){ const L=acctLocalRead(); ACCT.items=L.items; ACCT.stmts=L.stmts; }
    else { const a=await tq(sb.from('acct_items').select('*')); const b=await tq(sb.from('acct_statements').select('*'));
      if(a.error) throw a.error; if(b.error) throw b.error; ACCT.items=a.data||[]; ACCT.stmts=b.data||[]; }
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

/* ---------- pages ---------- */
function vAccounts(m){
  if(!acctOn()){ go('dash'); return; }
  if(ACCT.items==null){ acctLoad().then(()=>render()); m.innerHTML=head('Member accounts','Loading the ledger…'); return; }
  if(acctCloud()&&Date.now()-ACCT.at>20000&&!ACCT.loading) acctLoad(true).then(()=>{ if(view.page==='accounts') render(); });   // other staff post too
  const B=acctBalances(), P=persons().filter(p=>p.status!=='Inactive'||B.has(p.id)), q=(view.aq||'').toLowerCase().trim();
  let rows=P.map(p=>Object.assign({p,name:memberName(p),no:p.memberNo||''},B.get(p.id)||{bal:0,last:'',n:0,lastPay:''}));
  const F=[['owing','Owing'],['credit','In credit'],['active','With activity'],['all','Everyone']]; if(!F.some(([k])=>k===view.afilter)) view.afilter='owing';
  const owing=rows.filter(r=>r.bal>0.004), credit=rows.filter(r=>r.bal<-0.004), active=rows.filter(r=>r.n);
  let show=view.afilter==='owing'?owing:view.afilter==='credit'?credit:view.afilter==='active'?active:rows;
  if(q) show=rows.filter(r=>[r.name,r.no,r.p.email].join(' ').toLowerCase().includes(q));
  show=show.slice().sort((a,b)=>q?a.name.localeCompare(b.name):(b.bal-a.bal)||a.name.localeCompare(b.name));
  const month=todayISO().slice(0,7), monthItems=liveItems().filter(i=>(i.posted||'').startsWith(month)), lastRun=(ACCT.stmts||[]).slice().sort((a,b)=>String(b.period_end).localeCompare(String(a.period_end)))[0];
  m.innerHTML=head('Member accounts',`Every member’s account: what the club has charged, what has come in, who owes what. Statements close a period for everyone.`,
      btn('Settings','acSet','')+btn('Export balances','acCsv','',I.down)+btn('Run statements','acRun','')+btn('Record payment','acPay','')+btn('Post charge','acCharge','pri',I.plus))+`
    ${ACCT.err?`<div class="banner">${esc(ACCT.err)}</div>`:''}
    <div class="grid g4">${kpi('Outstanding',fmt2(sum(owing,r=>r.bal)),`${owing.length} member${owing.length===1?'':'s'} owing`,'neg')}${kpi('Credits held',fmt2(-sum(credit,r=>r.bal)),`${credit.length} in credit`)}${kpi('Charged this month',fmt2(sum(monthItems.filter(i=>i.kind==='charge'),i=>i.amount)),`${monthItems.filter(i=>i.kind==='charge').length} charges`)}${kpi('Received this month',fmt2(sum(monthItems.filter(i=>i.kind!=='charge'),i=>i.amount)),lastRun?`last statements ${dateTxt(lastRun.period_end)}`:'no statements yet')}</div>
    <div class="toolbar"><div class="seg">${F.map(([k,l])=>`<button class="${view.afilter===k&&!q?'on':''}" data-af="${k}">${l}${k==='all'?'':' · '+(k==='owing'?owing:k==='credit'?credit:active).length}</button>`).join('')}</div><input class="inp" id="acQ" placeholder="Find a member…" value="${esc(view.aq||'')}" style="margin-left:auto;height:38px;width:240px;max-width:100%" autocomplete="off"></div>
    <div class="card lg" style="overflow:hidden">${show.length?show.slice(0,300).map(r=>`<div class="lr click" data-acct="${r.p.id}"><div class="cell2"><span class="ln">${esc(r.name)}</span><span class="ls">${r.no?'#'+esc(r.no)+' · ':''}${r.n?`${r.n} item${r.n===1?'':'s'} · last ${dateTxt(r.last)}`:'no activity'}${r.lastPay?' · paid '+dateTxt(r.lastPay):''}</span></div><div class="lm"></div><b class="lnet ${amtCls(r.bal)}">${balTxt(r.bal)}</b><span class="lact">${I.chev}</span></div>`).join('')+(show.length>300?`<div class="lr"><span class="muted">Showing 300 of ${show.length} — search to narrow it down.</span></div>`:'')
      :`<div class="empty"><b>${q?'Nobody matches':'Nothing here'}</b><span>${q?'Try another name or member number.':view.afilter==='owing'?'No member owes the club anything.':'Post a charge or record a payment to start an account.'}</span></div>`}</div>`;
  m.querySelectorAll('[data-af]').forEach(b=>b.onclick=()=>{ view.afilter=b.dataset.af; view.aq=''; render(); });
  const qi=$('acQ'); qi.oninput=()=>{ view.aq=qi.value; render(); };
  m.querySelectorAll('[data-acct]').forEach(r=>r.onclick=()=>go('account',{acctId:r.dataset.acct}));
  $('acCharge').onclick=()=>postDrawer('charge',null); $('acPay').onclick=()=>postDrawer('payment',null); $('acRun').onclick=()=>runStatementsDrawer(); $('acSet').onclick=()=>acctSettingsDrawer();
  $('acCsv').onclick=()=>{ const qq=v=>'"'+String(v??'').replace(/"/g,'""')+'"'; const l=rows.filter(r=>r.n).sort((a,b)=>a.name.localeCompare(b.name));
    dl([['Member #','Last','First','Email','Balance','Last activity','Last payment'].map(qq).join(',')].concat(l.map(r=>[r.no,r.p.last,r.p.first,r.p.email||'',r.bal.toFixed(2),r.last,r.lastPay].map(qq).join(','))).join('\n'),'text/csv','member-balances-'+todayISO()+'.csv'); };
}
function vAccount(m){
  if(!acctOn()){ go('dash'); return; } const p=personById(view.acctId); if(!p){ go('accounts'); return; }
  if(ACCT.items==null){ acctLoad().then(()=>render()); m.innerHTML=head(memberName(p),'Loading…'); return; }
  const items=(ACCT.items||[]).filter(i=>i.member_id===p.id).sort(byDate), stmts=(ACCT.stmts||[]).filter(s=>s.member_id===p.id).sort((a,b)=>String(b.period_end).localeCompare(String(a.period_end)));
  let run=0; const ledger=items.map(i=>{ if(!i.void_at) run=Math.round((run+itemSign(i))*100)/100; return Object.assign({},i,{run}); }).reverse();
  const bal=balanceOf(p.id), lastStmt=stmts[0], since=lastStmt?items.filter(i=>!i.void_at&&(i.posted||'')>lastStmt.period_end):items.filter(i=>!i.void_at);
  m.innerHTML=`<div class="crumb"><button id="acBack">Member accounts</button><span class="muted">/</span><span class="muted">${esc(memberName(p))}</span></div>
    <div class="phead"><div><h1 class="h1">${esc(memberName(p))}</h1><div style="display:flex;gap:8px;margin-top:12px;flex-wrap:wrap">${p.memberNo?`<span class="chip navy">#${esc(p.memberNo)}</span>`:''}${p.email?`<span class="chip">${esc(p.email)}</span>`:''}${p.phone?`<span class="chip">${esc(p.phone)}</span>`:''}<span class="chip">${esc(p.status||'Active')}</span></div></div>
      <div class="actions"><button class="btn" id="acStmt">${I.down}Statement PDF</button><button class="btn" id="acCredit">Credit</button><button class="btn" id="acPay2">Record payment</button><button class="btn pri" id="acCharge2">${I.plus}Post charge</button></div></div><div class="rule"></div>
    <div class="grid g3">${kpi('Balance',balTxt(bal),bal>0.004?'owed to the club':bal<-0.004?'the club owes the member':'settled',amtCls(bal))}${kpi('Since last statement',fmt2(sum(since.filter(i=>i.kind==='charge'),i=>i.amount)),`${since.filter(i=>i.kind==='charge').length} charges · ${fmt2(sum(since.filter(i=>i.kind!=='charge'),i=>i.amount))} received`)}${kpi('Last statement',lastStmt?fmt2(lastStmt.closing):'—',lastStmt?`${dateTxt(lastStmt.period_end)} · due ${dateTxt(lastStmt.due)}`:'none yet')}</div>
    <div class="card lg" style="overflow:hidden"><div class="cardhead"><div><h2 class="h2">Account</h2><span class="muted">Newest first · running balance on the right</span></div></div>
      ${ledger.length?ledger.map(i=>`<div class="lr${i.void_at?' void':''}"><div class="cell2"><span class="ln" style="font-size:15px">${esc(i.descr||SOURCE_NAME[i.source]||'')}${i.void_at?' <span class="chip warn">void</span>':''}</span><span class="ls">${dateTxt(i.posted)} · <span class="chip" style="height:18px;font-size:11px">${esc(SOURCE_NAME[i.source]||i.source)}</span>${i.kind!=='charge'?` · ${i.kind==='credit'?'credit':METHOD_NAME[i.method]||'payment'}${i.reference?' · '+esc(i.reference):''}`:''}${i.void_at?` · ${esc(i.void_reason||'')}`:''}</span></div>
        <div class="lm"><span class="${i.kind==='charge'?'':'pos'}">${i.kind==='charge'?'':'−'}${fmt2(i.amount)}</span></div><b class="lnet ${amtCls(i.run)}">${fmt2(i.run)}</b><span class="lact">${i.void_at?'':`<button class="ib" data-void="${i.id}" aria-label="Void">${I.x}</button>`}</span></div>`).join('')
      :'<div class="empty"><b>Nothing on this account yet</b><span>Charges from dues, the shop and bookings land here; post one by hand with the buttons above.</span></div>'}</div>
    ${stmts.length?`<div class="card lg" style="overflow:hidden"><div class="cardhead"><div><h2 class="h2">Statements</h2></div></div>${stmts.map(s=>`<div class="lr la click" data-stmt="${s.id}"><div class="cell2"><span class="ln">${dateTxt(s.period_start)} – ${dateTxt(s.period_end)}</span><span class="ls">opening ${fmt2(s.opening)} · charges ${fmt2(s.charges)} · received ${fmt2(s.payments)} · due ${dateTxt(s.due)}</span></div><b class="lnet ${amtCls(s.closing)}">${fmt2(s.closing)}</b><span class="lact ib">${I.down}</span></div>`).join('')}</div>`:''}`;
  $('acBack').onclick=()=>go('accounts'); $('acCharge2').onclick=()=>postDrawer('charge',p); $('acPay2').onclick=()=>postDrawer('payment',p); $('acCredit').onclick=()=>postDrawer('credit',p);
  $('acStmt').onclick=()=>{ const s=stmts[0]||currentStatement(p.id); statementsPDF([s]); };
  m.querySelectorAll('[data-stmt]').forEach(r=>r.onclick=()=>statementsPDF([stmts.find(s=>s.id===r.dataset.stmt)]));
  m.querySelectorAll('[data-void]').forEach(b=>b.onclick=async()=>{ const i=items.find(x=>x.id===b.dataset.void); const reason=prompt(`Void ${fmt2(i.amount)} — ${i.descr}? Say why; it stays on the record.`); if(reason==null) return; if(!reason.trim()){ toast('A reason is needed'); return; } if(await acctVoid(i,reason.trim())) render(); });
}
/* post a charge, a payment or a credit — to one member, or pick the member first */
function postDrawer(kind,p){
  const title=kind==='charge'?'Post a charge':kind==='payment'?'Record a payment':'Give a credit';
  const ppl=persons().filter(x=>x.status!=='Inactive').sort((a,b)=>memberName(a).localeCompare(memberName(b)));
  openDrawer({kicker:'Member accounts',title,saveLabel:title.split(' ')[0],
    body:(p?`<p class="hint" style="margin:0 0 10px"><b>${esc(memberName(p))}</b>${p.memberNo?' · #'+esc(p.memberNo):''} · balance ${balTxt(balanceOf(p.id))}</p>`:field('Member','apM','',{type:'select',options:[['','— Member —']].concat(ppl.map(x=>[x.id,memberName(x)+(x.memberNo?' · #'+x.memberNo:'')]))}))+
      pair(field('Amount $','apA','',{type:'number'}),field('Date','apD',todayISO(),{type:'date'}))+
      (kind==='charge'?field('For','apS','manual',{type:'select',options:SOURCES}):kind==='payment'?pair(field('How','apS','card',{type:'select',options:METHODS}),field('Reference','apR','',{ph:'check #, last four, confirmation'})):'')+
      field('Description','apN','',{ph:kind==='charge'?'e.g. Guest fee · Oct 12':kind==='payment'?'e.g. Statement payment':'e.g. Rain check'}),
    save:async()=>{ const mid=p?p.id:fv('apM'), amt=fnum('apA'); if(!mid||!(amt>0)){ toast('Pick a member and an amount'); return false; }
      const o={member_id:mid,kind,amount:amt,posted:fv('apD')||todayISO(),descr:fv('apN')||(kind==='charge'?SOURCE_NAME[fv('apS')]:kind==='payment'?'Payment':'Credit')};
      if(kind==='charge') o.source=fv('apS')||'manual'; if(kind==='payment'){ o.source='manual'; o.method=fv('apS')||'other'; o.reference=fv('apR')||null; } if(kind==='credit') o.source='manual';
      const it=await acctPost(o); if(!it) return false; toast(`${title.split(' ')[0]}ed — ${fmt2(amt)}`); if(view.page!=='account'){ view.acctId=mid; view.page='account'; } }});
}
function acctSettingsDrawer(){ const b=acctSettings();
  openDrawer({kicker:'Member accounts',title:'Billing settings',body:field('Payment due, days after the statement','bsDue',b.dueDays,{type:'number'})+field('Message on every statement','bsMsg',b.message,{type:'textarea'})+'<p class="hint">Statements are produced here as PDFs for the club to send; members pay the club the way they always have and the office records it.</p>',
    save:()=>{ b.dueDays=Math.max(0,Math.round(fnum('bsDue'))); b.message=fv('bsMsg'); persist(); }}); }
/* ---------- statements ---------- */
/* a member's statement for a period from the ledger: opening = everything before the period, then the period's items */
function buildStatement(mid,start,end){
  const its=liveItems().filter(i=>i.member_id===mid), before=its.filter(i=>(i.posted||'')<start), inP=its.filter(i=>(i.posted||'')>=start&&(i.posted||'')<=end);
  const opening=Math.round(before.reduce((t,i)=>t+itemSign(i),0)*100)/100, charges=Math.round(sum(inP.filter(i=>i.kind==='charge'),i=>i.amount)*100)/100, payments=Math.round(sum(inP.filter(i=>i.kind!=='charge'),i=>i.amount)*100)/100;
  return {id:uid(),member_id:mid,period_start:start,period_end:end,opening,charges,payments,closing:Math.round((opening+charges-payments)*100)/100,due:isoPlus(end,acctSettings().dueDays),issued_at:new Date().toISOString(),created_by:whoAmI(),items:inP.sort(byDate)}; }
/* the open period for one member (since their last statement) — for a statement on demand */
function currentStatement(mid){ const last=(ACCT.stmts||[]).filter(s=>s.member_id===mid).sort((a,b)=>String(b.period_end).localeCompare(String(a.period_end)))[0]; const its=liveItems().filter(i=>i.member_id===mid).sort(byDate);
  const start=last?isoPlus(last.period_end,1):(its[0]&&its[0].posted)||todayISO(); return buildStatement(mid,start,todayISO()); }
function runStatementsDrawer(){
  const last=(ACCT.stmts||[]).slice().sort((a,b)=>String(b.period_end).localeCompare(String(a.period_end)))[0], defEnd=lastDayOfPrevMonth();
  openDrawer({kicker:'Member accounts',title:'Run statements',saveLabel:'Run statements',
    body:field('Period ends','rsEnd',last&&last.period_end>=defEnd?todayISO():defEnd,{type:'date',hint:last?`The last run closed ${dateTxt(last.period_end)}; this run starts the day after for everyone it covered.`:'The first run: each member’s statement starts at their first item.'})+
      `<label class="check"><input type="checkbox" id="rsZero">Include members with no activity and a zero balance</label><p class="hint">One statement per member with a balance or activity in the period, saved to their account, and one PDF with a page per member for the office to send. Due ${acctSettings().dueDays} days after the period ends (Settings).</p>`,
    save:async()=>{ const end=fv('rsEnd'); if(!end){ toast('Pick the period end'); return false; }
      const B=acctBalances(), lastOf=new Map(); (ACCT.stmts||[]).forEach(s=>{ const l=lastOf.get(s.member_id); if(!l||s.period_end>l) lastOf.set(s.member_id,s.period_end); });
      const out=[]; for(const [mid,r] of B){ const prev=lastOf.get(mid); if(prev&&prev>=end) continue; const its=liveItems().filter(i=>i.member_id===mid).sort(byDate); const start=prev?isoPlus(prev,1):its[0].posted;
        const s=buildStatement(mid,start,end); if(!$('rsZero').checked&&!s.items.length&&Math.abs(s.closing)<0.005) continue; out.push(s); }
      if(!out.length){ toast('Nothing to close for that period'); return false; }
      const runId=uid(), rows=out.map(s=>{ const {items,...rest}=s; return Object.assign(rest,{run_id:runId}); });
      if(acctCloud()){ const {error}=await sb.from('acct_statements').insert(rows.map(trow)); if(error){ toast('Couldn’t save statements: '+error.message); return false; } }
      ACCT.stmts=(ACCT.stmts||[]).concat(rows); if(!acctCloud()) acctLocalWrite();
      toast(`${out.length} statement${out.length===1?'':'s'} run · ${fmt2(sum(out,s=>s.closing))} outstanding`); statementsPDF(out); }});
}
/* the branded statement: one page per member (the band, the account block, the period's items, the totals, the message) */
async function statementsPDF(list){
  list=(list||[]).filter(Boolean); if(!list.length){ toast('No statement to print'); return; }
  try{ await loadJsPDF(); }catch(e){ toast(e.message); return; }
  const crest=await crestPNG().catch(()=>null), doc=new window.jspdf.jsPDF({unit:'pt',format:'letter'});
  [['ps400','PS-400.ttf','PublicSans','normal'],['ps700','PS-700.ttf','PublicSans','bold'],['ps800','PS-800.ttf','PublicSansXB','normal'],['cg700','CG-700.ttf','Cormorant','bold']].forEach(([k,f,fam,st])=>{ doc.addFileToVFS(f,PDF_FONTS[k]); doc.addFont(f,fam,st); });
  const NAVY=[15,42,56],GOLD=[199,161,58],GOLDL=[216,183,95],GOLDDK=[126,95,26],IVORY=[251,250,245],INK=[20,34,43],MUTED=[86,98,106],RED=[161,64,43],GREEN=[31,107,74];
  const L=40,R2=572,W=612,H=792, font=(f,s,z,col)=>{ doc.setFont(f,s); doc.setFontSize(z); doc.setTextColor(...col); };
  const club=(CLUB&&CLUB.name)||CLUB_META.name, msg=acctSettings().message||'';
  list.forEach((s,idx)=>{ if(idx) doc.addPage(); doc.setFillColor(...IVORY); doc.rect(0,0,W,H,'F');
    const p=personById(s.member_id)||{}, items=s.items||liveItems().filter(i=>i.member_id===s.member_id&&(i.posted||'')>=s.period_start&&(i.posted||'')<=s.period_end).sort(byDate);
    doc.setFillColor(...GOLD); doc.roundedRect(L,32,R2-L,82,8,8,'F'); doc.setFillColor(...NAVY); doc.roundedRect(L,32,R2-L,78,8,8,'F'); doc.rect(L,32+66,R2-L,8,'F');
    if(crest) doc.addImage(crest,'PNG',L+16,42,54*850/1024,54);
    font('PublicSansXB','normal',6.8,GOLDL); doc.text(String(club).toUpperCase(),L+76,56,{charSpace:1.2});
    font('Cormorant','bold',24,[255,255,255]); doc.text('Member statement',L+76,80);
    font('PublicSans','normal',8.4,[214,218,220]); doc.text(`${dateTxt(s.period_start)} – ${dateTxt(s.period_end)} · due ${dateTxt(s.due)}`,L+76,96);
    let y=140; font('PublicSansXB','normal',7.4,GOLDDK); doc.text('ACCOUNT',L,y,{charSpace:1.1}); doc.text('BALANCE DUE',R2,y,{align:'right',charSpace:1.1}); y+=6; doc.setDrawColor(...GOLD); doc.setLineWidth(1); doc.line(L,y,R2,y); y+=16;
    font('PublicSans','bold',12,INK); doc.text(memberName(p)||'Member',L,y); font('Cormorant','bold',26,s.closing>0.004?RED:INK); doc.text(fmt2(Math.max(0,s.closing)),R2,y+4,{align:'right'});
    font('PublicSans','normal',8.6,MUTED); const lines=[p.memberNo?'Member #'+p.memberNo:'',p.address1||'',[p.city,p.state,p.zip].filter(Boolean).join(', '),p.email||''].filter(Boolean); lines.forEach((t,i)=>doc.text(t,L,y+14+i*11));
    if(s.closing<-0.004){ font('PublicSans','normal',8.6,GREEN); doc.text(`Credit on account ${fmt2(-s.closing)} — nothing due`,R2,y+16,{align:'right'}); }
    y+=14+Math.max(lines.length,2)*11+18;
    font('PublicSansXB','normal',7.4,GOLDDK); doc.text('THIS PERIOD',L,y,{charSpace:1.1}); y+=6; doc.line(L,y,R2,y); y+=12;
    const col=(txt,x,al)=>doc.text(txt,x,y,{align:al||'left'}); font('PublicSans','bold',7.6,MUTED); col('DATE',L); col('DESCRIPTION',L+64); col('CHARGES',R2-110,'right'); col('PAYMENTS',R2-36,'right'); col('BALANCE',R2,'right'); y+=10;
    const row=(d,t,c,pm,b,bold)=>{ if(y>H-120){ doc.addPage(); doc.setFillColor(...IVORY); doc.rect(0,0,W,H,'F'); y=60; } font('PublicSans',bold?'bold':'normal',9,INK); doc.text(d,L,y); doc.text(doc.splitTextToSize(t,R2-150-(L+64))[0],L+64,y); doc.text(c,R2-110,y,{align:'right'}); doc.text(pm,R2-36,y,{align:'right'}); font('PublicSans','bold',9,INK); doc.text(b,R2,y,{align:'right'}); y+=14; };
    let run=s.opening; row('',`Balance forward`,'','',fmt2(run),true);
    items.forEach(i=>{ run=Math.round((run+itemSign(i))*100)/100; row(new Date(i.posted+'T12:00').toLocaleDateString('en-US',{month:'short',day:'numeric'}),`${i.descr||SOURCE_NAME[i.source]||''}${i.kind==='payment'&&i.method?' · '+(METHOD_NAME[i.method]||'')+(i.reference?' '+i.reference:''):''}`,i.kind==='charge'?fmt2(i.amount):'',i.kind!=='charge'?fmt2(i.amount):'',fmt2(run)); });
    y+=4; doc.setDrawColor(...GOLD); doc.line(L,y,R2,y); y+=14; font('PublicSans','bold',9.5,INK); doc.text(`Charges ${fmt2(s.charges)} · Payments & credits ${fmt2(s.payments)}`,L,y); doc.text(`Closing balance ${fmt2(s.closing)}`,R2,y,{align:'right'}); y+=24;
    if(msg){ font('PublicSans','normal',8.6,MUTED); doc.splitTextToSize(msg,R2-L).forEach(t=>{ doc.text(t,L,y); y+=11; }); }
    font('PublicSans','normal',7,MUTED); doc.text(`${club} · statement issued ${dateTxt((s.issued_at||'').slice(0,10))} · page ${idx+1} of ${list.length}`,W/2,H-28,{align:'center'});
  });
  const name=list.length===1?`statement-${(memberName(personById(list[0].member_id)||{})||'member').replace(/\s+/g,'-').toLowerCase()}-${list[0].period_end}.pdf`:`statements-${list[0].period_end}.pdf`;
  if(typeof deliverFile==='function'){ const blob=doc.output('blob'); await deliverFile(blob,name,'Statements'); } else doc.save(name);
}
