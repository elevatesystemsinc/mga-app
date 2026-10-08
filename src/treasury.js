/* =====================================================================
   MGA Hub — Treasury: one ledger for the season, budget vs actual across
   every tournament, and bank reconciliation against uploaded statements.
   Book entries = ledger transactions + sponsor payments + dues payments.
   Bank lines are matched to book entries (one-to-one, or several checks
   to one deposit). Nothing is ever matched without the treasurer's OK.
   ===================================================================== */
I.bank=svg('<path d="M3 10l9-6 9 6"/><path d="M5 10v8M9.5 10v8M14.5 10v8M19 10v8"/><path d="M3 20h18"/>');
NAV.splice(4,0,['treasury','Treasury',I.bank]);
view.xtab=view.xtab||'ledger'; view.lfilter='All'; view.lq=''; view.showMatched=false;

/* ---------- dates + money ---------- */
function isoDate(s,year){
  s=String(s??'').trim(); if(!s) return '';
  let m;
  if((m=/^(\d{4})-(\d{1,2})-(\d{1,2})/.exec(s))) return `${m[1]}-${m[2].padStart(2,'0')}-${m[3].padStart(2,'0')}`;
  if((m=/^(\d{4})(\d{2})(\d{2})/.exec(s))) return `${m[1]}-${m[2]}-${m[3]}`;
  if((m=/^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{2,4})/.exec(s))){ let y=+m[3]; if(y<100) y+=2000; return `${y}-${m[1].padStart(2,'0')}-${m[2].padStart(2,'0')}`; }
  if((m=/^(\d{1,2})\/(\d{1,2})$/.exec(s))&&year) return `${year}-${m[1].padStart(2,'0')}-${m[2].padStart(2,'0')}`;
  const d=new Date(s); if(!isNaN(d)) return d.toISOString().slice(0,10);
  return '';
}
const dayDiff=(a,b)=>(a&&b)?Math.round((new Date(a)-new Date(b))/864e5):null;
const shortD=s=>{ if(!s) return '—'; const [y,mo,d]=s.split('-'); return `${+mo}/${+d}/${y.slice(2)}`; };
function money(s){ s=String(s??'').trim(); if(!s) return null; let neg=/^\(.*\)$/.test(s)||/-\s*$/.test(s)||/^-/.test(s.replace(/[$\s]/g,''))||/\bDR\b/i.test(s);
  const v=parseFloat(s.replace(/[^0-9.]/g,'')); if(!isFinite(v)) return null; return neg?-v:v; }
const todayISO=()=>{ const d=new Date(); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`; };

/* ---------- budget lines a ledger entry can be linked to ---------- */
function budgetLines(y){
  const out=[];
  for(const t of seasonTournaments(y)){
    const g=t.name+(t.startDate?' ('+dayShort(t,0)+')':'');
    out.push({g,v:`${t.id}|entry|`,l:'Entry fees',dir:'in'});
    if(n0(t.skinsFee)) out.push({g,v:`${t.id}|skins|`,l:'Skins / day money collected',dir:'in'});
    t.income.forEach(i=>out.push({g,v:`${t.id}|inc|${i.id}`,l:i.desc,dir:'in'}));
    [0,1,2].slice(0,t.days).forEach(di=>t.dayItems[di].forEach(it=>out.push({g,v:`${t.id}|item|${it.id}`,l:`${dayLabel(t,di).split(' · ')[0]}: ${it.item}`,dir:'out'})));
    t.perPlayer.forEach(p=>out.push({g,v:`${t.id}|pp|${p.id}`,l:p.desc,dir:'out'}));
    if(n0(t.skinsFee)) out.push({g,v:`${t.id}|skinsPaid|`,l:'Skins / day money paid out',dir:'out'});
    t.lines.forEach(l=>out.push({g,v:`${t.id}|line|${l.id}`,l:(l.group?l.group+': ':'')+l.desc,dir:'out'}));
  }
  (db.seasons[y].lines||[]).forEach(l=>out.push({g:'MGA-level',v:`|${l.type==='Income'?'mgaInc':'mgaExp'}|${l.id}`,l:l.desc,dir:l.type==='Income'?'in':'out'}));
  return out;
}
function linkLabel(y,L){
  if(!L||!L.k) return 'Uncategorized';
  const hit=budgetLines(y).find(o=>o.v===`${L.t||''}|${L.k}|${L.id||''}`);
  return hit?`${hit.g.replace(/ \(.*\)$/,'')} · ${hit.l}`:'Line no longer exists';
}

/* ---------- book entries (everything the MGA's books say happened) ---------- */
function bookEntries(y){
  const s=db.seasons[y], out=[];
  for(const x of s.txns) out.push({key:'tx:'+x.id,src:'ledger',ref:x,date:x.date,amount:n0(x.amount),dir:x.dir,desc:x.desc||'(no description)',payee:x.payee||'',method:x.method||'',checkNo:x.checkNo||'',line:linkLabel(y,x.link)});
  for(const t of seasonTournaments(y)) for(const sp of t.sponsors) for(const p of sp.payments||[])
    out.push({key:'sp:'+p.id,src:'sponsor',ref:{t,sp,p},date:isoDate(p.date,y),amount:n0(p.amount),dir:'in',desc:sp.company,payee:'',method:p.method||'',checkNo:p.checkNo||'',line:`${t.name} · Sponsors`});
  for(const p of s.duesPayments){ const m=memberById(p.memberId);
    out.push({key:'du:'+p.id,src:'dues',ref:{p,m},date:isoDate(p.date,y),amount:n0(p.amount),dir:'in',desc:(m?memberName(m):'Member')+' — dues',payee:'',method:p.method||'',checkNo:'',line:'MGA · Dues'}); }
  return out;
}
function matchedKeys(y){ const set=new Map(); for(const b of db.seasons[y].bank) if(b.status==='matched') for(const k of b.matched||[]) set.set(k,b); return set; }

/* ---------- ledger entry editor ---------- */
function editTxn(x,prefill,onSaved){
  const y=Y(), s=db.seasons[y], p=Object.assign({},prefill||{}), cur=x||p;
  const dir=cur.dir||'out', lines=budgetLines(y);
  const curLink=cur.link?`${cur.link.t||''}|${cur.link.k}|${cur.link.id||''}`:'';
  const optHTML=d=>{ const groups=[...new Set(lines.map(o=>o.g))];
    return `<option value="">Uncategorized</option>`+groups.map(g=>`<optgroup label="${esc(g)}">${lines.filter(o=>o.g===g&&(o.dir===d||o.v===curLink)).map(o=>`<option value="${esc(o.v)}"${o.v===curLink?' selected':''}>${esc(o.l)}</option>`).join('')}</optgroup>`).join(''); };
  const bankMatch=x&&matchedKeys(y).get('tx:'+x.id);
  openDrawer({kicker:y+' season · Treasury',title:x?(x.dir==='in'?'Edit income':'Edit expense'):(dir==='in'?'Record income':'Record expense'),
    body:`<div class="fld"><span class="lbl">Type</span>${seg('xDir',[['out','Money out'],['in','Money in']],dir)}</div>`+
      pair(field('Date','xDate',cur.date||todayISO(),{type:'date'}),field('Amount $','xAmt',cur.amount??'',{type:'number'}))+
      field(dir==='in'?'Received from':'Paid to','xPayee',cur.payee||'',{ph:dir==='in'?'e.g. WCCC, Calcutta':'e.g. WCCC, Backroads band'})+
      field('Description','xDesc',cur.desc||'',{ph:'What it was for'})+
      `<div class="fld"><label class="lbl" for="xLink">Budget line</label><select class="inp" id="xLink">${optHTML(dir)}</select><p class="hint">Linking it here makes it that line’s actual.</p></div>`+
      pair(field('Method','xMeth',cur.method||'Check',{type:'select',options:['Check','Debit card','Credit card','ACH / transfer','Zelle','Cash','Other']}),field('Check #','xChk',cur.checkNo||''))+
      field('Notes','xMemo',cur.memo||'',{type:'textarea'})+
      (bankMatch?`<div class="banner" style="background:#E3F0E8;border-color:#BCD9C7;color:#174F37">Cleared the bank ${shortD(bankMatch.date)} · ${esc(bankMatch.desc)}</div>`:''),
    wire:r=>wireSeg(r,'xDir',d=>{ r.querySelector('#xLink').innerHTML=optHTML(d); r.querySelector('label[for=xPayee]').textContent=d==='in'?'Received from':'Paid to'; }),
    save:()=>{ const amt=Math.abs(fnum('xAmt')); if(!amt){ toast('Enter an amount'); return false; }
      const lv=fv('xLink').split('|'); const link=fv('xLink')?{t:lv[0],k:lv[1],id:lv[2]}:null;
      const data={dir:$('xDir').dataset.val,date:fv('xDate'),amount:amt,payee:fv('xPayee'),desc:fv('xDesc')||fv('xPayee'),link,method:fv('xMeth'),checkNo:fv('xChk'),memo:fv('xMemo')};
      let rec=x; if(x) Object.assign(x,data); else { rec=Object.assign({id:uid()},data); s.txns.push(rec); }
      if(onSaved) onSaved(rec); toast(x?'Saved':'Recorded'); },
    del:x?()=>{ const i=s.txns.indexOf(x); s.txns.splice(i,1); s.bank.forEach(b=>{ if((b.matched||[]).includes('tx:'+x.id)){ b.matched=[]; b.status='open'; } });
      toast('Entry deleted',()=>{ s.txns.splice(i,0,x); persist(); render(); }); }:null});
}

/* ---------- Treasury page ---------- */
function vTreasury(m){
  const tabs=[['ledger','Ledger'],['bva','Budget vs actual'],['rec','Reconcile']];
  m.innerHTML=head('Treasury',`Every dollar in and out for the ${Y()} season, checked against the bank.`,btn('Record income','xIn','',I.plus)+btn('Record expense','xOut','pri',I.plus))+
    `<div class="tabs">${tabs.map(([k,l])=>`<button class="tab${view.xtab===k?' on':''}" data-x="${k}">${l}</button>`).join('')}</div><div id="xbody" style="display:flex;flex-direction:column;gap:20px"></div>`;
  m.querySelectorAll('[data-x]').forEach(b=>b.onclick=()=>{ view.xtab=b.dataset.x; render(); });
  $('xIn').onclick=()=>editTxn(null,{dir:'in'}); $('xOut').onclick=()=>editTxn(null,{dir:'out'});
  ({ledger:xLedger,bva:xBva,rec:xRec}[view.xtab]||xLedger)($('xbody'));
}

/* Ledger */
function xLedger(el){
  const y=Y(), all=bookEntries(y), mk=matchedKeys(y);
  const inT=sum(all.filter(e=>e.dir==='in'),e=>e.amount), outT=sum(all.filter(e=>e.dir==='out'),e=>e.amount);
  let list=all;
  const f=view.lfilter, q=view.lq.toLowerCase();
  if(f==='Money in') list=list.filter(e=>e.dir==='in'); if(f==='Money out') list=list.filter(e=>e.dir==='out');
  if(f==='Not cleared') list=list.filter(e=>!mk.has(e.key)); if(f==='Uncategorized') list=list.filter(e=>e.src==='ledger'&&!e.ref.link);
  if(q) list=list.filter(e=>[e.desc,e.payee,e.line,e.checkNo,e.method,String(e.amount)].join(' ').toLowerCase().includes(q));
  list.sort((a,b)=>(b.date||'').localeCompare(a.date||''));
  const cols='grid-template-columns:88px minmax(0,1.4fr) minmax(0,1.4fr) 110px 110px 96px';
  el.innerHTML=`<div class="grid g4">${kpi('Money in',fmt(inT),`${all.filter(e=>e.dir==='in').length} entries incl. sponsor payments and dues`,'pos')}${kpi('Money out',fmt(outT),`${all.filter(e=>e.dir==='out').length} entries`)}${kpi('Net',fmtS(inT-outT),'in − out, all recorded',netCls(inT-outT))}${kpi('Not yet cleared',String(all.filter(e=>!mk.has(e.key)).length),'not matched to a bank line')}</div>
  <div class="toolbar"><div class="search">${I.search}<input class="inp" id="lq" placeholder="Search payee, description, line, check #" value="${esc(view.lq)}" aria-label="Search ledger"></div>
    <div class="seg">${['All','Money in','Money out','Not cleared','Uncategorized'].map(x=>`<button class="${f===x?'on':''}" data-lf="${x}">${x}</button>`).join('')}</div>
    <button class="btn sm" id="lCsv" style="margin-left:auto">${I.down}Export CSV</button></div>
  <div class="card" style="overflow:hidden">${list.length?`<div class="tw"><div class="t" style="min-width:860px"><div class="tr th" style="${cols}"><span>Date</span><span>Description</span><span>Budget line</span><span>Method</span><span class="r">Amount</span><span>Bank</span></div>
    ${list.map(e=>`<div class="tr num click" data-le="${e.key}" style="${cols}"><span class="muted">${shortD(e.date)}</span><div class="cell2"><b class="trunc">${esc(e.payee||e.desc)}</b><small class="trunc">${esc(e.payee&&e.desc!==e.payee?e.desc:'')}${e.src!=='ledger'?(e.payee?' · ':'')+(e.src==='sponsor'?'Sponsor payment':'Dues payment'):''}</small></div><span class="trunc ${e.line==='Uncategorized'?'neg':'muted'}">${esc(e.line)}</span><span class="muted trunc">${esc(e.method)}${e.checkNo?' #'+esc(e.checkNo):''}</span><b class="r ${e.dir==='in'?'pos':''}">${e.dir==='in'?'+':'−'}${fmt2(e.amount).replace('$','$')}</b><span>${mk.has(e.key)?'<span class="chip ok">Cleared</span>':'<span class="chip">Open</span>'}</span></div>`).join('')}</div></div>`
    :`<div class="empty"><b>${all.length?'Nothing matches':'No money recorded yet'}</b><span>${all.length?'Try another filter.':'Record expenses and income here, or from any line on Budget vs actual. Sponsor payments and dues show up automatically.'}</span></div>`}</div>`;
  const qi=$('lq'); qi.oninput=()=>{ view.lq=qi.value; const p=qi.selectionStart; render(); const n=$('lq'); n.focus(); n.setSelectionRange(p,p); };
  el.querySelectorAll('[data-lf]').forEach(b=>b.onclick=()=>{ view.lfilter=b.dataset.lf; render(); });
  el.querySelectorAll('[data-le]').forEach(r=>r.onclick=()=>{ const e=all.find(x=>x.key===r.dataset.le); openBook(e); });
  $('lCsv').onclick=()=>{ const rows=[['Date','Direction','Amount','Payee','Description','Budget line','Method','Check #','Source','Cleared bank','Bank date','Bank description']];
    all.sort((a,b)=>(a.date||'').localeCompare(b.date||'')).forEach(e=>{ const b=mk.get(e.key); rows.push([e.date,e.dir==='in'?'In':'Out',(e.dir==='in'?1:-1)*e.amount,e.payee,e.desc,e.line,e.method,e.checkNo,e.src,b?'Yes':'No',b?b.date:'',b?b.desc:'']); });
    const csv=rows.map(r=>r.map(v=>{v=String(v??'');return /[",\n]/.test(v)?'"'+v.replace(/"/g,'""')+'"':v;}).join(',')).join('\r\n');
    dl(csv,'text/csv',`mga_ledger_${y}.csv`); toast('Ledger exported'); };
}
function openBook(e){
  if(e.src==='ledger') return editTxn(e.ref);
  if(e.src==='sponsor') return editSponsor(e.ref.t,e.ref.sp);
  if(e.src==='dues'&&e.ref.m) return editMember(e.ref.m);
}

/* Budget vs actual — every line, every tournament; add money straight from a line */
function xBva(el){
  const y=Y(), sc=scalc(y), IX=ledgerIndex(y);
  const cols='grid-template-columns:minmax(0,1.6fr) 110px 110px 110px 70px 40px';
  const row=(name,sub,bud,act,isInc,v,count)=>{ const variance=isInc?act-bud:bud-act;
    return `<div class="tr num" style="${cols}"><div class="cell2"><span class="trunc" style="font-weight:500">${esc(name)}</span>${sub?`<small class="trunc">${esc(sub)}</small>`:''}</div><span class="r">${fmt(bud)}</span><span class="r">${act?fmt(act):'—'}</span><b class="r ${act?(variance>=0?'pos':'neg'):'muted'}">${act?fmtS(variance):''}</b><span class="r muted" style="font-size:12px">${count?count+' entr'+(count===1?'y':'ies'):''}</span>${v?`<button class="ib" data-bx="${esc(v)}" data-bd="${isInc?'in':'out'}" aria-label="Record money for ${esc(name)}">${I.plus}</button>`:'<span></span>'}</div>`; };
  const cnt=(tid,k,id)=>(IX[(tid||'')+'|'+k+'|'+(id||'')]||{}).n||0;
  const card=(title,sub,net,netA,body)=>`<div class="card" style="overflow:hidden"><div class="cardhead"><div><h2 class="h2">${title}</h2><span class="muted">${sub}</span></div><div class="num" style="text-align:right"><div class="lbl">Budget net / actual net</div><b>${fmtS(net)}</b> <span class="muted">/</span> <b class="${netCls(netA)}">${fmtS(netA)}</b></div></div><div class="tw"><div class="t" style="min-width:720px"><div class="tr th" style="${cols}"><span>Line</span><span class="r">Budget</span><span class="r">Actual</span><span class="r">Variance</span><span></span><span></span></div>${body}</div></div></div>`;
  const gh=t=>`<div class="gh"><b>${t}</b><span></span></div>`;
  el.innerHTML=`<p class="hint" style="margin:0">Green variance is good (under budget on spending, over budget on income). Use <b>+</b> on any line to record money against it — the entry becomes that line’s actual.</p>`+
  sc.ts.map(({t,c})=>{ const A=(k,id,m)=>actualOf(IX,t.id,k,id,m);
    const inc=[row('Entry fees',`${c.players} × ${fmt(t.entryFee)}`,c.entryFees,A('entry','',t.actuals.entryFees),true,`${t.id}|entry|`,cnt(t.id,'entry'))]
      .concat(c.skins?[row('Skins / day money collected','',c.skins,A('skins','',t.actuals.skins),true,`${t.id}|skins|`,cnt(t.id,'skins'))]:[])
      .concat([row('Sponsors',`${t.sponsors.length} sponsors · payments logged on the Sponsors tab`,c.pledged,c.received,true,'',0)])
      .concat(t.income.map(i=>row(i.desc,i.source==='raffle'?'Season 50/50 raffle':'',i.budget,A('inc',i.id,i.actual),true,`${t.id}|inc|${i.id}`,cnt(t.id,'inc',i.id))));
    const exp=[0,1,2].slice(0,t.days).flatMap(di=>t.dayItems[di].map(it=>row(it.item,dayLabel(t,di).split(' · ')[0],itemTotal(t,it),A('item',it.id,it.actual),false,`${t.id}|item|${it.id}`,cnt(t.id,'item',it.id))))
      .concat(t.perPlayer.map(p=>row(p.desc,`${c.players} × ${fmt(p.perPlayer)}`,c.players*n0(p.perPlayer),A('pp',p.id,p.actual),false,`${t.id}|pp|${p.id}`,cnt(t.id,'pp',p.id))))
      .concat(c.skinsPayout?[row('Skins / day money paid out','',c.skinsPayout,A('skinsPaid','',t.actuals.skinsPaid),false,`${t.id}|skinsPaid|`,cnt(t.id,'skinsPaid'))]:[])
      .concat(t.lines.map(l=>row(l.desc,l.group||'',l.budget,A('line',l.id,l.actual),false,`${t.id}|line|${l.id}`,cnt(t.id,'line',l.id))));
    return card(esc(t.name),`${dateRange(t)}${isPast(t)?' · complete — actuals count in the season projection':''}`,c.net,c.netA,gh('Income')+inc.join('')+gh('Expenses')+exp.join(''));
  }).join('')+
  card('MGA-level',`Dues and anything not tied to a tournament`,sc.duesBudget+sum(sc.s.lines,l=>(l.type==='Income'?1:-1)*n0(l.budget)),sc.duesActual+sum(sc.s.lines,l=>(l.type==='Income'?1:-1)*actualOf(IX,'',l.type==='Income'?'mgaInc':'mgaExp',l.id,l.actual)),
    row('Annual dues',`${sc.active} active × ${fmt(sc.s.dues.amount)} · recorded on each member`,sc.duesBudget,sc.duesActual,true,'',0)+
    sc.s.lines.map(l=>{ const k=l.type==='Income'?'mgaInc':'mgaExp'; return row(l.desc,l.type,l.budget,actualOf(IX,'',k,l.id,l.actual),l.type==='Income',`|${k}|${l.id}`,cnt('',k,l.id)); }).join('')+
    `<div class="tr"><button class="btn sm" id="bvaMga">${I.plus}Add MGA-level line</button></div>`);
  el.querySelectorAll('[data-bx]').forEach(b=>b.onclick=()=>{ const [t,k,id]=b.dataset.bx.split('|'); editTxn(null,{dir:b.dataset.bd,link:{t,k,id}}); });
  $('bvaMga').onclick=()=>editSeasonLine(null);
}

/* ---------- bank statement import ---------- */
const BANK_COLS={date:/^(post(ing|ed)? ?date|trans(action)?\.? ?date|date( posted)?|effective date)$/, desc:/^(description|payee|name|transaction|merchant|narrative)( description)?$/, memo:/^(memo|notes?|extended description|additional info)$/,
  amount:/^(amount|transaction amount|amt|net amount)$/, debit:/^(debit|debits|withdrawal|withdrawals|money out|payments?|charge|debit amount)$/, credit:/^(credit|credits|deposit|deposits|money in|credit amount)$/,
  check:/^(check|chk|cheque|check ?(no|number|#)|ref(erence)?( no)?)$/, balance:/^(running )?balance$/, type:/^(type|transaction type|details|dr\/cr|debit\/credit)$/};
function parseBankTable(rows,year){
  let hi=-1,map={};
  for(let i=0;i<Math.min(rows.length,40)&&hi<0;i++){ const m={}; rows[i].forEach((h,ci)=>{ const k=String(h).toLowerCase().replace(/\s+/g,' ').trim(); for(const [key,re] of Object.entries(BANK_COLS)) if(m[key]===undefined&&re.test(k)){ m[key]=ci; break; } });
    if(m.date!==undefined&&(m.amount!==undefined||m.debit!==undefined||m.credit!==undefined)){ hi=i; map=m; } }
  if(hi<0) throw new Error('Couldn’t find the statement columns — it needs a Date column and either Amount or Debit/Credit columns');
  const out=[];
  for(const r of rows.slice(hi+1)){ const g=k=>map[k]!==undefined?String(r[map[k]]??'').trim():'';
    const date=isoDate(g('date'),year); if(!date) continue;
    let amt=null;
    if(map.amount!==undefined){ amt=money(g('amount')); const ty=g('type').toLowerCase(); if(amt!=null&&amt>0&&/^debit|withdraw|\bdr\b|payment|check_paid|^check/.test(ty)) amt=-amt; }
    if(amt==null){ const d=money(g('debit')), c=money(g('credit')); if(d==null&&c==null) continue; amt=(c?Math.abs(c):0)-(d?Math.abs(d):0); }
    if(!amt) continue;
    const desc=[g('desc'),g('memo')].filter(Boolean).join(' — ');
    let chk=g('check'); if(!chk){ const mm=/\bche?c?k\s*#?\s*(\d{3,})/i.exec(desc); if(mm) chk=mm[1]; }
    out.push({date,amount:Math.round(amt*100)/100,desc:desc||'(no description)',checkNo:chk.replace(/^0+/,''),balance:money(g('balance'))});
  }
  return out;
}
function parseOFX(txt){
  const out=[]; const blocks=txt.split(/<STMTTRN>/i).slice(1);
  const tag=(b,t)=>{ const m=new RegExp('<'+t+'>([^<\\r\\n]*)','i').exec(b); return m?m[1].trim():''; };
  for(const b of blocks){ const amt=money(tag(b,'TRNAMT')); if(!amt) continue;
    out.push({date:isoDate(tag(b,'DTPOSTED').slice(0,8)),amount:Math.round(amt*100)/100,desc:[tag(b,'NAME'),tag(b,'MEMO')].filter(Boolean).join(' — ')||'(no description)',checkNo:tag(b,'CHECKNUM').replace(/^0+/,''),fitid:tag(b,'FITID'),balance:null}); }
  const bal=/<LEDGERBAL>[\s\S]*?<BALAMT>([^<\r\n]+)/i.exec(txt); if(bal&&out.length){ const last=out.reduce((a,b)=>a.date>=b.date?a:b); last.balance=money(bal[1]); }
  return out;
}
async function readBankFile(f,year){
  const ext=(f.name.split('.').pop()||'').toLowerCase();
  if(ext==='ofx'||ext==='qfx'){ const txt=await f.text(); const r=parseOFX(txt); if(!r.length) throw new Error('No transactions found in that OFX/QFX file'); return r; }
  return parseBankTable(await readRosterFile(f),year);
}
const bankKey=b=>b.fitid?'fit:'+b.fitid:`${b.date}|${b.amount.toFixed(2)}|${b.desc.toLowerCase().replace(/\s+/g,' ').slice(0,60)}`;
function importBank(){
  const y=Y(), s=db.seasons[y];
  openDrawer({kicker:y+' season · Reconcile',title:'Upload bank statement',
    body:`<p style="margin:0">Download the account activity from the bank’s website as <b>CSV</b>, <b>Excel</b>, or <b>OFX/QFX</b> (Quicken) and choose it here.</p>
      <p class="hint">Needs a date and either an amount column or separate debit/credit columns — the usual bank export. Lines already uploaded are skipped, so overlapping statements are fine. You’ll see a summary before anything is saved.</p>
      <input type="file" id="bankF" accept=".csv,.xlsx,.xls,.ofx,.qfx,text/csv" class="inp" style="padding-top:8px"><p class="hint" id="bankMsg" aria-live="polite"></p>`,
    wire:r=>{ r.querySelector('#bankF').onchange=async e=>{ const f=e.target.files[0]; if(!f) return; const msg=r.querySelector('#bankMsg'); msg.style.color=''; msg.textContent='Reading '+f.name+'…';
      try{ const lines=await readBankFile(f,y); if(!lines.length) throw new Error('No transactions found');
        // de-duplicate against earlier uploads (same date, amount, description — counting repeats)
        const have={}; s.bank.forEach(b=>{ have[b.key]=(have[b.key]||0)+1; }); const seen={}; const fresh=[];
        for(const l of lines){ const k=bankKey(l); seen[k]=(seen[k]||0)+1; if(seen[k]>(have[k]||0)) fresh.push(Object.assign(l,{key:k})); }
        closeDrawer(); previewBank(f.name,lines,fresh); }
      catch(err){ msg.style.color='var(--neg)'; msg.textContent=err.message||'Couldn’t read that file'; } }; }});
}
function previewBank(fname,lines,fresh){
  const y=Y(), s=db.seasons[y];
  const dates=lines.map(l=>l.date).sort(), inn=sum(fresh.filter(l=>l.amount>0),l=>l.amount), out=sum(fresh.filter(l=>l.amount<0),l=>-l.amount);
  openDrawer({kicker:'Statement · '+fname,title:'Review statement',saveLabel:fresh.length?`Add ${fresh.length} bank line${fresh.length===1?'':'s'}`:'Close',
    body:`<div class="grid g3" style="gap:10px">${[['Lines',lines.length],['New',fresh.length],['Already uploaded',lines.length-fresh.length]].map(([l,v])=>`<div class="card pad kpi" style="padding:14px"><span class="lbl">${l}</span><span class="v num" style="font-size:30px">${v}</span></div>`).join('')}</div>
      <div class="sumrows num"><div><span class="muted">Dates</span><span>${shortD(dates[0])} – ${shortD(dates[dates.length-1])}</span></div><div><span class="muted">Deposits (new)</span><span class="pos">+${fmt2(inn)}</span></div><div><span class="muted">Withdrawals (new)</span><span>−${fmt2(out)}</span></div></div>
      ${fresh.length?`<div class="mini">${fresh.slice(0,8).map(l=>`<div class="mr num" style="grid-template-columns:70px minmax(0,1fr) 100px"><span class="muted">${shortD(l.date)}</span><span class="trunc">${esc(l.desc)}</span><b class="r ${l.amount>0?'pos':''}">${l.amount>0?'+':'−'}${fmt2(Math.abs(l.amount))}</b></div>`).join('')}${fresh.length>8?`<div class="mr"><span class="muted">+ ${fresh.length-8} more</span></div>`:''}</div>`:'<p class="hint">Every line in this file was already uploaded.</p>'}
      ${!s.bank.length&&!n0(s.bankOpening.amount)?`<div class="banner">Set the account’s opening balance on the Reconcile tab so the running balance matches the bank.</div>`:''}`,
    save:()=>{ if(!fresh.length) return;
      const batch={id:uid(),file:fname,importedAt:new Date().toISOString(),from:dates[0],to:dates[dates.length-1],count:fresh.length};
      s.bankBatches.push(batch);
      fresh.forEach(l=>s.bank.push({id:uid(),batch:batch.id,date:l.date,amount:l.amount,desc:l.desc,checkNo:l.checkNo||'',balance:l.balance,fitid:l.fitid||'',key:l.key,matched:[],status:'open',note:''}));
      view.xtab='rec'; toast(`${fresh.length} bank line${fresh.length===1?'':'s'} added — review the suggested matches`); }});
}

/* ---------- matching ---------- */
function subsetSum(cands,target,maxN){
  cands=cands.slice().sort((a,b)=>b.amount-a.amount); const T=Math.round(target*100), vals=cands.map(c=>Math.round(c.amount*100));
  let best=null, steps=0;
  (function dfs(i,sumC,pick){ if(best||steps++>20000) return; if(sumC===T&&pick.length>1){ best=pick.slice(); return; }
    if(pick.length>=maxN) return;
    for(let j=i;j<cands.length;j++){ if(sumC+vals[j]>T) continue; pick.push(j); dfs(j+1,sumC+vals[j],pick); pick.pop(); if(best) return; } })(0,0,[]);
  return best?best.map(j=>cands[j]):null;
}
function suggestMatches(y){
  const s=db.seasons[y], mk=matchedKeys(y), used=new Set(mk.keys());
  const book=bookEntries(y).filter(e=>!used.has(e.key));
  const sugg=new Map();
  const open=s.bank.filter(b=>b.status==='open').sort((a,b)=>a.date.localeCompare(b.date));
  const words=s2=>new Set(String(s2||'').toLowerCase().replace(/[^a-z0-9 ]/g,' ').split(/\s+/).filter(w=>w.length>2&&!/^(the|and|llc|inc|from|for|payment|deposit|check|zelle|online|services?|group|company|co)$/.test(w)));
  const nameHit=(b,e)=>{ const bw=words(b.desc); for(const w of words((e.payee||'')+' '+e.desc)) if(bw.has(w)) return 1; return 0; };
  const isTransfer=b=>/\b(transfer|xfer|trnsfr)\b/i.test(b.desc);
  const single=(b,dated)=>{ if(isTransfer(b)) return null; const dir=b.amount>0?'in':'out', amt=Math.abs(b.amount), win=dir==='out'?60:30;
    const c=book.filter(e=>!used.has(e.key)&&e.dir===dir&&Math.abs(e.amount-amt)<0.005&&(dated?(e.date&&Math.abs(dayDiff(b.date,e.date))<=win):!e.date));
    if(!c.length) return null;
    c.sort((p,q)=>((q.checkNo&&q.checkNo===b.checkNo)-(p.checkNo&&p.checkNo===b.checkNo))||(nameHit(b,q)-nameHit(b,p))||(Math.abs(dayDiff(b.date,p.date)??99)-Math.abs(dayDiff(b.date,q.date)??99)));
    return c[0]; };
  // 1) same amount, dated within the window (same check # wins)
  for(const b of open){ const e=single(b,true); if(!e) continue; used.add(e.key); const d=Math.abs(dayDiff(b.date,e.date));
    sugg.set(b.id,{keys:[e.key],entries:[e],why:e.checkNo&&e.checkNo===b.checkNo?'Same check # and amount':(nameHit(b,e)?'Same amount and name, ':'Same amount, ')+`${d} day${d===1?'':'s'} apart`}); }
  // 2) one deposit made up of several payments received in the weeks before it
  for(const b of open){ if(sugg.has(b.id)||b.amount<=0||isTransfer(b)) continue;
    const c=book.filter(e=>!used.has(e.key)&&e.dir==='in'&&e.date&&e.amount<b.amount&&dayDiff(b.date,e.date)>=-3&&dayDiff(b.date,e.date)<=30).slice(0,30);
    const combo=subsetSum(c,b.amount,8);
    if(combo){ combo.forEach(e=>used.add(e.key)); sugg.set(b.id,{keys:combo.map(e=>e.key),entries:combo,why:`${combo.length} payments add up to this deposit`}); } }
  // 3) same amount but the entry has no date — shown as a possibility, never auto-accepted
  for(const b of open){ if(sugg.has(b.id)) continue; const e=single(b,false); if(!e) continue; used.add(e.key);
    sugg.set(b.id,{keys:[e.key],entries:[e],why:'Same amount — the entry has no date, so check it',weak:true}); }
  return sugg;
}
function recTotals(y){
  const s=db.seasons[y], mk=matchedKeys(y), book=bookEntries(y);
  const open=n0(s.bankOpening.amount);
  const bankNet=sum(s.bank,b=>b.amount), bankBal=open+bankNet;
  const outstanding=book.filter(e=>!mk.has(e.key));
  const dit=sum(outstanding.filter(e=>e.dir==='in'),e=>e.amount), oc=sum(outstanding.filter(e=>e.dir==='out'),e=>e.amount);
  const bookBal=open+sum(book,e=>(e.dir==='in'?1:-1)*e.amount);
  const bankOnly=sum(s.bank.filter(b=>b.status!=='matched'),b=>b.amount);
  const last=[...s.bank].filter(b=>b.balance!=null).sort((a,b)=>a.date.localeCompare(b.date)).pop();
  return {open,bankBal,dit,oc,adjBank:bankBal+dit-oc,bookBal,bankOnly,adjBook:bookBal+bankOnly,outstanding,
    needs:s.bank.filter(b=>b.status==='open').length, matched:s.bank.filter(b=>b.status==='matched').length, ignored:s.bank.filter(b=>b.status==='ignored').length,
    stmtBal:last?last.balance:null, stmtDate:last?last.date:null, lastDate:[...s.bank].map(b=>b.date).sort().pop()||''};
}
function xRec(el){
  const y=Y(), s=db.seasons[y], R=recTotals(y), sugg=suggestMatches(y), book=bookEntries(y), byKey=new Map(book.map(e=>[e.key,e]));
  const open=s.bank.filter(b=>b.status==='open').sort((a,b)=>a.date.localeCompare(b.date));
  const done=s.bank.filter(b=>b.status!=='open').sort((a,b)=>b.date.localeCompare(a.date));
  const cols='grid-template-columns:76px minmax(0,1.3fr) 110px minmax(0,1.5fr) auto';
  const amt=v=>`<b class="r num ${v>0?'pos':''}">${v>0?'+':'−'}${fmt2(Math.abs(v))}</b>`;
  const reconciled=s.bank.length&&R.needs===0&&Math.abs(R.adjBank-R.adjBook)<0.005;
  const stmtCheck=R.stmtBal!=null?Math.abs((n0(s.bankOpening.amount)+sum(s.bank.filter(b=>b.date<=R.stmtDate),b=>b.amount))-R.stmtBal)<0.005:null;
  el.innerHTML=`${!s.bank.length?`<div class="card"><div class="empty"><b>Upload a bank statement to start</b><span>Each bank line gets matched to what’s recorded in the hub — ledger entries, sponsor payments and dues. Anything left over is either missing from the books or hasn’t cleared the bank yet.</span><div class="actions"><button class="btn pri" id="rUp">${I.down}Upload bank statement</button><button class="btn" id="rOpen">Set opening balance</button></div></div></div>`:''}
  ${s.bank.length?`<div class="grid g4">${kpi('Bank lines',String(s.bank.length),`${shortD(s.bank.map(b=>b.date).sort()[0])} – ${shortD(R.lastDate)}`)}${kpi('Matched',String(R.matched),R.ignored?`${R.ignored} set aside`:'to entries in the hub','pos')}${kpi('Need attention',String(R.needs),R.needs?'bank lines not in the books yet':'every bank line accounted for',R.needs?'neg':'pos')}${kpi('Not yet cleared',String(R.outstanding.length),'in the books, not on a statement yet')}</div>
  <div class="split">
   <div style="display:flex;flex-direction:column;gap:20px;min-width:0">
    <div class="card" style="overflow:hidden"><div class="cardhead"><div><h2 class="h2">Needs a match</h2><span class="muted">${open.length?'Accept a suggestion, pick the matching entries, or add what’s missing to the books.':'Nothing waiting.'}</span></div>
      <div class="actions">${[...sugg.values()].filter(x=>!x.weak).length?`<button class="btn pri sm" id="rAll">${I.check}Accept ${[...sugg.values()].filter(x=>!x.weak).length} confident match${[...sugg.values()].filter(x=>!x.weak).length===1?'':'es'}</button>`:''}<button class="btn sm" id="rUp">${I.down}Upload statement</button></div></div>
      ${open.length?open.map(b=>{ const sg=sugg.get(b.id);
        return `<div class="rrow"><div class="rtop"><span class="muted num">${shortD(b.date)}</span><div class="cell2"><b class="trunc" title="${esc(b.desc)}">${esc(b.desc)}</b>${b.checkNo?`<small>Check #${esc(b.checkNo)}</small>`:''}</div>${amt(b.amount)}</div>
          <div class="rbot"><div class="cell2" style="font-size:13px;flex:1 1 260px;min-width:0">${sg?`<span class="trunc"><span class="chip ${sg.weak?'':'gold'}" style="height:20px;font-size:11px;margin-right:6px">${sg.weak?'Possible':'Suggested'}</span>${esc(sg.entries.map(e=>e.payee||e.desc).join(' + '))}</span><small class="trunc">${esc(sg.why)}${sg.entries.length===1?' · '+esc(sg.entries[0].line):''}</small>`:(/\b(transfer|xfer|trnsfr)\b/i.test(b.desc)?'<span class="muted">Looks like a transfer — set it aside if it’s between MGA accounts</span>':'<span class="muted">Nothing in the books matches — add it, or find it</span>')}</div>
          <div class="actions" style="gap:6px">${sg?`<button class="btn sm pri" data-acc="${b.id}">Accept</button>`:''}<button class="btn sm" data-find="${b.id}">Find</button><button class="btn sm" data-add="${b.id}">Add to books</button><button class="btn sm" data-ign="${b.id}" title="Transfers and other money that isn’t MGA income or spending">Set aside</button></div></div></div>`; }).join(''):''}
    </div>
    <div class="card" style="overflow:hidden"><div class="cardhead"><div><h2 class="h2">In the books, not on a statement</h2><span class="muted">Checks not cashed yet, deposits not made yet — or entries recorded twice.</span></div></div>
      ${R.outstanding.length?`<div class="tw"><div class="t" style="min-width:640px">${R.outstanding.sort((a,b)=>(a.date||'').localeCompare(b.date||'')).map(e=>`<div class="tr num click" data-ob="${e.key}" style="grid-template-columns:76px minmax(0,1.3fr) minmax(0,1.2fr) 110px"><span class="muted">${shortD(e.date)}</span><div class="cell2"><b class="trunc">${esc(e.payee||e.desc)}</b><small class="trunc">${esc(e.method)}${e.checkNo?' #'+esc(e.checkNo):''}</small></div><span class="trunc muted">${esc(e.line)}</span>${amt(e.dir==='in'?e.amount:-e.amount)}</div>`).join('')}</div></div>`:'<div class="tr"><span class="muted">Everything in the books has cleared.</span></div>'}
    </div>
    <details class="card" ${view.showMatched?'open':''} id="rDone" style="overflow:hidden"><summary class="cardhead" style="cursor:pointer;list-style:none"><div><h2 class="h2">Matched &amp; set aside</h2><span class="muted">${done.length} bank line${done.length===1?'':'s'} — open to review or undo</span></div><span class="ib" aria-hidden="true">${I.chev}</span></summary>
      ${done.length?`<div class="tw"><div class="t" style="min-width:760px">${done.map(b=>`<div class="tr" style="${cols};padding-top:8px;padding-bottom:8px"><span class="muted num">${shortD(b.date)}</span><span class="trunc">${esc(b.desc)}</span>${amt(b.amount)}<span class="trunc muted" style="font-size:13px">${b.status==='ignored'?'Set aside'+(b.note?' — '+esc(b.note):''):(b.matched||[]).map(k=>{const e=byKey.get(k);return e?esc((e.payee||e.desc)+' · '+e.line):'(entry deleted)';}).join(' + ')}</span><div class="actions" style="justify-content:flex-end"><button class="btn sm" data-un="${b.id}">Undo</button></div></div>`).join('')}</div></div>`:''}
    </details>
   </div>
   <div style="display:flex;flex-direction:column;gap:16px">
    <div class="card pad" style="display:flex;flex-direction:column;gap:12px">
      <div style="display:flex;justify-content:space-between;align-items:center"><span class="lbl">Reconciliation</span>${reconciled?'<span class="chip ok">Reconciled</span>':`<span class="chip ${R.needs?'warn':'gold'}">${R.needs?R.needs+' to resolve':'Check balances'}</span>`}</div>
      <div class="sumrows num" style="border-top:none;padding-top:0">
        <div><span class="muted">Opening balance</span><button class="linkbtn" id="rOpen" style="color:var(--gold);text-decoration:none;font-weight:600">${fmt2(R.open)}</button></div>
        <div><span>Bank balance${R.lastDate?' '+shortD(R.lastDate):''}</span><b>${fmt2(R.bankBal)}</b></div>
        <div><span class="muted">+ Deposits not yet made</span><span>${fmt2(R.dit)}</span></div>
        <div><span class="muted">− Checks not yet cleared</span><span>${fmt2(R.oc)}</span></div>
        <div class="big"><span>Adjusted bank</span><span>${fmt2(R.adjBank)}</span></div>
      </div>
      <div class="sumrows num">
        <div><span>Book balance</span><b>${fmt2(R.bookBal)}</b></div>
        <div><span class="muted">± Bank lines not in the books</span><span>${fmt2(R.bankOnly)}</span></div>
        <div class="big"><span>Adjusted books</span><span>${fmt2(R.adjBook)}</span></div>
      </div>
      <p class="hint">${reconciled?'Every bank line is accounted for and both sides agree.':R.needs?'Resolve the bank lines under “Needs a match” — each one is either a missing entry, a match to pick, or something to set aside.':'Balances should agree once every line is matched.'}</p>
      ${stmtCheck!=null?`<div class="banner" style="${stmtCheck?'background:#E3F0E8;border-color:#BCD9C7;color:#174F37':'background:#F8E6DF;border-color:#EBC2B3;color:#6E2A1B'}">${stmtCheck?`Opening balance + uploaded lines = the bank’s own balance of ${fmt2(R.stmtBal)} on ${shortD(R.stmtDate)}.`:`The bank shows ${fmt2(R.stmtBal)} on ${shortD(R.stmtDate)}, but opening balance + uploaded lines gives ${fmt2(n0(s.bankOpening.amount)+sum(s.bank.filter(b=>b.date<=R.stmtDate),b=>b.amount))}. Check the opening balance, or upload the missing dates.`}</div>`:''}
    </div>
    <div class="card pad" style="display:flex;flex-direction:column;gap:10px"><span class="lbl">Uploaded statements</span>
      ${s.bankBatches.map(bt=>`<div style="display:flex;justify-content:space-between;gap:10px;font-size:13px"><div class="cell2"><span class="trunc">${esc(bt.file)}</span><small>${shortD(bt.from)} – ${shortD(bt.to)} · ${bt.count} lines</small></div><button class="ib" data-rmb="${bt.id}" aria-label="Remove ${esc(bt.file)}">${I.trash}</button></div>`).join('')}
    </div>
   </div>
  </div>`:''}`;
  const on=(sel,fn)=>el.querySelectorAll(sel).forEach(b=>b.onclick=()=>fn(b));
  el.querySelectorAll('#rUp').forEach(b=>b.onclick=importBank);
  el.querySelectorAll('#rOpen').forEach(b=>b.onclick=editOpening);
  const all=$('rAll'); if(all) all.onclick=()=>{ const before=clone(s.bank); let n=0; for(const [id,sg] of sugg){ if(sg.weak) continue; const b=s.bank.find(x=>x.id===id); b.matched=sg.keys; b.status='matched'; n++; } persist(); render(); toast(n+' matches accepted',()=>{ s.bank=before; persist(); render(); }); };
  on('[data-acc]',b=>{ const bl=s.bank.find(x=>x.id===b.dataset.acc), sg=sugg.get(bl.id); bl.matched=sg.keys; bl.status='matched'; persist(); render(); });
  on('[data-find]',b=>findMatch(s.bank.find(x=>x.id===b.dataset.find)));
  on('[data-add]',b=>{ const bl=s.bank.find(x=>x.id===b.dataset.add);
    editTxn(null,{dir:bl.amount>0?'in':'out',date:bl.date,amount:Math.abs(bl.amount),desc:bl.desc,payee:bl.desc.split(' — ')[0].slice(0,60),checkNo:bl.checkNo,method:bl.checkNo?'Check':/zelle/i.test(bl.desc)?'Zelle':/card|pos|purchase/i.test(bl.desc)?'Debit card':'ACH / transfer'},rec=>{ bl.matched=['tx:'+rec.id]; bl.status='matched'; }); });
  on('[data-ign]',b=>{ const bl=s.bank.find(x=>x.id===b.dataset.ign);
    openDrawer({kicker:'Reconcile',title:'Set aside bank line',body:`<p style="margin:0">${shortD(bl.date)} · ${esc(bl.desc)} · <b>${fmt2(bl.amount)}</b></p><p class="hint">For money that isn’t MGA income or spending — a transfer between accounts, a returned deposit, an opening deposit. If it’s a real expense (a bank fee, say), use “Add to books” instead so it lands in the budget.</p>`+field('Reason','ignNote','',{ph:'e.g. Transfer from savings'}),
      save:()=>{ bl.status='ignored'; bl.note=fv('ignNote'); }}); });
  on('[data-un]',b=>{ const bl=s.bank.find(x=>x.id===b.dataset.un); bl.status='open'; bl.matched=[]; bl.note=''; view.showMatched=true; persist(); render(); });
  on('[data-ob]',b=>{ const e=book.find(x=>x.key===b.dataset.ob); openBook(e); });
  on('[data-rmb]',b=>{ const bt=s.bankBatches.find(x=>x.id===b.dataset.rmb); const n=s.bank.filter(x=>x.batch===bt.id).length;
    if(!confirm(`Remove ${bt.file} and its ${n} bank lines? Any matches on those lines are undone; entries in the books stay.`)) return;
    s.bank=s.bank.filter(x=>x.batch!==bt.id); s.bankBatches=s.bankBatches.filter(x=>x!==bt); persist(); render(); toast('Statement removed'); });
  const det=$('rDone'); if(det) det.ontoggle=()=>{ view.showMatched=det.open; };
}
function editOpening(){
  const s=db.seasons[Y()];
  openDrawer({kicker:Y()+' season · Reconcile',title:'Opening balance',body:pair(field('Balance $','obA',s.bankOpening.amount||'',{type:'number'}),field('As of','obD',s.bankOpening.date||'',{type:'date'}))+'<p class="hint">The account balance right before the first uploaded statement line — the “beginning balance” on that statement.</p>',
    save:()=>{ s.bankOpening={amount:fnum('obA'),date:fv('obD')}; }});
}
function findMatch(bl){
  const y=Y(), s=db.seasons[y], mk=matchedKeys(y), dir=bl.amount>0?'in':'out', target=Math.abs(bl.amount);
  const cands=bookEntries(y).filter(e=>e.dir===dir&&!mk.has(e.key))
    .sort((a,b)=>Math.abs(a.amount-target)-Math.abs(b.amount-target)||Math.abs(dayDiff(bl.date,a.date)??999)-Math.abs(dayDiff(bl.date,b.date)??999));
  const picked=new Set();
  const rowsHTML=q=>cands.filter(e=>!q||[e.payee,e.desc,e.line,String(e.amount)].join(' ').toLowerCase().includes(q.toLowerCase())).slice(0,60).map(e=>`<label class="mr num" style="grid-template-columns:22px 70px minmax(0,1fr) 90px;cursor:pointer"><input type="checkbox" data-pk="${e.key}"${picked.has(e.key)?' checked':''} style="width:18px;height:18px;accent-color:var(--navy)"><span class="muted">${shortD(e.date)}</span><div class="cell2"><b class="trunc">${esc(e.payee||e.desc)}</b><small class="trunc">${esc(e.line)}</small></div><b class="r">${fmt2(e.amount)}</b></label>`).join('')||'<div class="mr"><span class="muted">No open entries in that direction.</span></div>';
  const total=()=>sum(cands.filter(e=>picked.has(e.key)),e=>e.amount);
  openDrawer({kicker:'Reconcile · '+shortD(bl.date),title:'Find the match',saveLabel:'Match',
    body:`<div class="banner" style="justify-content:space-between"><span class="trunc">${esc(bl.desc)}</span><b class="num">${fmt2(bl.amount)}</b></div>
      <p class="hint">Tick the entry — or several, when one deposit covers multiple checks. The picked total has to equal the bank amount.</p>
      <input class="inp" id="fmQ" placeholder="Search entries" aria-label="Search entries"><div class="mini" id="fmL" style="max-height:48vh;overflow-y:auto">${rowsHTML('')}</div>
      <div class="sumrows num"><div><span class="muted">Picked</span><span id="fmT">$0.00</span></div><div><span class="muted">Bank line</span><span>${fmt2(target)}</span></div><div class="big"><span>Difference</span><span id="fmD">${fmt2(target)}</span></div></div>`,
    wire:r=>{ const bind=()=>r.querySelectorAll('[data-pk]').forEach(cb=>cb.onchange=()=>{ cb.checked?picked.add(cb.dataset.pk):picked.delete(cb.dataset.pk); const t=total(); r.querySelector('#fmT').textContent=fmt2(t); const d=target-t; const el2=r.querySelector('#fmD'); el2.textContent=fmt2(d); el2.style.color=Math.abs(d)<0.005?'var(--pos)':''; });
      bind(); r.querySelector('#fmQ').oninput=e=>{ r.querySelector('#fmL').innerHTML=rowsHTML(e.target.value); bind(); }; },
    save:()=>{ if(!picked.size){ toast('Tick at least one entry'); return false; }
      if(Math.abs(total()-target)>=0.005){ toast(`Picked ${fmt2(total())} — needs to equal ${fmt2(target)}. For a difference like a fee, add it to the books.`); return false; }
      bl.matched=[...picked]; bl.status='matched'; toast('Matched'); }});
}

