/* ============ Flagstick's back office — the portal's sales and billing side (flagstick-office-setup.sql) ============
   The pipeline (fs_leads), estimates (fs_estimates), contracts that bill themselves (fs_contracts), invoices and
   payments (fs_invoices, fs_payments), the catalog of what Flagstick sells (fs_catalog) and the settings (fs_settings).
   The shape is the Elevate PSA's (the owner: guidelines, not a copy); the words and the fields are this industry's — a lead is a club with
   a current system, holes and members and the modules it is after; the motion is demo → a trial hub → the subscription, and an
   active subscription switches the club's modules on in `tenants`; a proposal is built from the product's modules.
   Modelled on the Elevate PSA: a lead becomes a client; an estimate's recurring lines become a contract and its
   one-time lines an invoice; an active contract generates one invoice per service period (billing day, frequency,
   advance or arrears, Net terms, a lead of n days, an escalator on the anniversary) — idempotent per period: a period
   is covered once a non-void invoice exists for it or the contract's last_period has moved past it. Billing mode
   'auto' generates when the portal loads and on Run billing; 'review' lists what is due and waits for Generate.
   Every table is Flagstick's own (RLS is_flagstick_admin()); `tenant` on a row is the client. Portal only. */
const OF={leads:[],catalog:[],estimates:[],contracts:[],invoices:[],payments:[],settings:{},loaded:false,id:null,pseg:'',eseg:'open',cseg:'active',iseg:'open',q:'',pendingLead:null};
const STAGES=[['new','New'],['contacted','Contacted'],['demo','Demo given'],['proposal','Proposal sent'],['trial','Trial hub'],['won','Won'],['lost','Lost']];
const SYSTEMS=['Golf Genius','Club Essentials','Jonas','ForeTees','Northstar','Chronogolf / Lightspeed','foreUP','GolfNow / EZLinks','Spreadsheets and paper','Nothing yet','Other'];
const CONTACT_ROLES=['Head golf professional','Director of golf','General manager','Assistant professional','Controller / bookkeeper','Board president','MGA / LGA president','Tournament chair','Executive director','Event chair','Other'];
const HOLES=[['','—'],['9','9 holes'],['18','18 holes'],['27','27 holes'],['36','36 holes'],['45','45+ holes']];
const moduleName=id=>{ const m=MODULE_CATALOG.find(x=>x.id===id); return m?m.name:id; };
const leadMods=l=>Object.keys((l&&l.modules)||{}).filter(k=>l.modules[k]&&k!=='golf');
const offerPrice=(c,bill)=>bill==='year'?ofN(c.price_year||(parseFloat(c.unit_price)||0)*12):ofN(c.unit_price);
const STAGE_LABEL=Object.fromEntries(STAGES);
const EST_STATUS={draft:'Draft',sent:'Sent',accepted:'Accepted',declined:'Declined',expired:'Expired',converted:'Subscribed'};
const CT_STATUS={draft:'Draft',active:'Active',paused:'Paused',ended:'Ended'};
const INV_STATUS={draft:'Draft',sent:'Sent',partial:'Partly paid',paid:'Paid',void:'Void'};
const FREQ=[['monthly','Monthly'],['quarterly','Quarterly'],['semiannual','Every six months'],['annual','Annual']];
const FREQ_LABEL=Object.fromEntries(FREQ);
const OF_METHODS=[['check','Check'],['ach','ACH / bank'],['card','Card'],['cash','Cash'],['other','Other']];
const CAT_KINDS=[['subscription','Subscription'],['addon','Add-on'],['setup','Set-up'],['service','Service']];
const ofN=v=>Math.round((parseFloat(v)||0)*100)/100;
const ofMoney=v=>bcFmt(v);
const ofToday=()=>{ const d=new Date(); return new Date(d.getTime()-d.getTimezoneOffset()*60000).toISOString().slice(0,10); };
const ofAddDays=(iso,n)=>{ const d=new Date(String(iso).slice(0,10)+'T12:00:00Z'); d.setUTCDate(d.getUTCDate()+n); return d.toISOString().slice(0,10); };
const ofPct=v=>Math.min(100,Math.max(0,parseFloat(v)||0));
const effPct=(it,wide)=>Math.round(100*(1-(1-ofPct(it.discount_pct)/100)*(1-ofPct(wide)/100))*100)/100;
const lineGross=it=>ofN((parseFloat(it.qty)||0)*(parseFloat(it.unit_price)||0));
const lineNet=(it,wide)=>ofN(lineGross(it)*(1-effPct(it,wide)/100));
const ofSettings=()=>OF.settings||{};
const taxRate=()=>parseFloat((ofSettings().billing||{}).tax_rate)||0;
/* the money on a document: subtotal (list), discount (lines + the document-wide %), tax on taxable lines, total */
function docTotals(items,wide){ let sub=0,net=0,tax=0; (items||[]).forEach(it=>{ const g=lineGross(it), n=lineNet(it,wide); sub+=g; net+=n; if(it.taxable) tax+=n*taxRate()/100; }); return {subtotal:ofN(sub),discount:ofN(sub-net),tax:ofN(tax),total:ofN(net+tax)}; }
/* an estimate's recurring money per month and its one-time money */
function estSplit(e){ const items=e.items||[]; const rec=items.filter(it=>it.recurring), one=items.filter(it=>!it.recurring); const mo=rec.reduce((a,it)=>a+lineNet(it,e.discount_pct)*(it.every==='year'?1/12:1),0); return {monthly:ofN(mo),recurring:rec,onetime:one,once:docTotals(one,e.discount_pct).total}; }
const ctMRR=c=>ofN((c.items||[]).reduce((a,it)=>a+lineNet(it,c.discount_pct),0)*12/freqMonths(c.frequency)/12*(c.frequency==='monthly'?1:1));
const ctPerCycle=c=>ofN((c.items||[]).reduce((a,it)=>a+lineNet(it,c.discount_pct),0));
const ctMonthly=c=>ofN(ctPerCycle(c)/freqMonths(c.frequency));
const invBalance=i=>ofN((parseFloat(i.total)||0)-(parseFloat(i.paid)||0));
const invOverdue=i=>(i.status==='sent'||i.status==='partial')&&!!i.due_on&&i.due_on<ofToday();
const tenantName=slug=>{ const t=slug?tenantOf(slug):null; return t?t.name:(slug||''); };
const ofWho=()=>(ACCESS&&ACCESS.email)||'';
const leadNo=l=>l.number?'L-'+l.number:'';
const estNo=e=>e.number?'P-'+e.number:'Draft';
const ctNo=c=>c.number?'C-'+c.number:'';
const invNo=i=>i.number?'INV-'+i.number:'Draft';
const estChip=s=>`<span class="chip ${s==='accepted'||s==='converted'?'ok':s==='sent'?'gold':s==='declined'||s==='expired'?'warn':''}">${esc(EST_STATUS[s]||s)}</span>`;
const ctChip=s=>`<span class="chip ${s==='active'?'ok':s==='paused'?'warn':s==='ended'?'inact':''}">${esc(CT_STATUS[s]||s)}</span>`;
const invChip=i=>invOverdue(i)?'<span class="chip warn">Overdue</span>':`<span class="chip ${i.status==='paid'?'ok':i.status==='sent'||i.status==='partial'?'gold':i.status==='void'?'inact':''}">${esc(INV_STATUS[i.status]||i.status)}</span>`;
const stageChip=s=>`<span class="chip ${s==='won'?'ok':s==='lost'?'warn':s==='proposal'||s==='trial'?'gold':''}">${esc(STAGE_LABEL[s]||s)}</span>`;

/* ---------- data ---------- */
async function loadOffice(){
  const q=async t=>{ const {data,error}=await sb.from(t).select('*'); if(error){ PS.err=(PS.err?PS.err+' · ':'')+t+': '+error.message; return []; } return data||[]; };
  const [leads,catalog,estimates,contracts,invoices,payments,settings]=await Promise.all([q('fs_leads'),q('fs_catalog'),q('fs_estimates'),q('fs_contracts'),q('fs_invoices'),q('fs_payments'),q('fs_settings')]);
  const by=(a,b)=>new Date(b.created_at||0)-new Date(a.created_at||0);
  OF.leads=leads.sort(by); OF.catalog=catalog.sort((a,b)=>(a.sort||0)-(b.sort||0)||a.name.localeCompare(b.name)); OF.estimates=estimates.sort(by); OF.contracts=contracts.sort(by); OF.invoices=invoices.sort(by); OF.payments=payments.sort(by);
  OF.settings={}; settings.forEach(s=>OF.settings[s.key]=s.value||{}); OF.loaded=true;
  await ofRunBilling({quiet:true});
}
async function nextNo(kind){ try{ const {data,error}=await sb.rpc('fs_next_number',{p_kind:kind}); if(!error&&data) return +data; }catch(_){} const base={lead:2000,estimate:1000,contract:7000,invoice:9000}[kind]||1; const list={lead:OF.leads,estimate:OF.estimates,contract:OF.contracts,invoice:OF.invoices}[kind]||[]; return Math.max(base-1,...list.map(x=>+x.number||0))+1; }
async function ofInsert(table,list,row){ row.id=row.id||uid(); row.created_at=row.created_at||new Date().toISOString(); row.updated_at=new Date().toISOString(); const {error}=await sb.from(table).insert(row); if(error) throw error; list.unshift(row); return row; }
async function ofUpdate(table,row,patch){ patch.updated_at=new Date().toISOString(); const {error}=await sb.from(table).update(patch).eq('id',row.id); if(error) throw error; Object.assign(row,patch); return row; }
async function ofDelete(table,list,row){ const {error}=await sb.from(table).delete().eq('id',row.id); if(error) throw error; const i=list.indexOf(row); if(i>=0) list.splice(i,1); }
async function saveSetting(key,value){ const {error}=await sb.from('fs_settings').upsert({key,value,updated_at:new Date().toISOString()},{onConflict:'key'}); if(error) throw error; OF.settings[key]=value; }
const ofGo=(view,id)=>{ PS.view=view; PS.slug=null; OF.id=id||null; portalNav(); vPortal($('main')); window.scrollTo(0,0); };
const ofErr=e=>toast((e&&e.message)||'That did not save');

/* ---------- the billing cycle (the PSA's engine) ---------- */
const DAY_MS=86400000, MONTHS_S=['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
const freqMonths=f=>f==='annual'?12:f==='semiannual'?6:f==='quarterly'?3:1;
const monthIx=d=>d.getUTCFullYear()*12+d.getUTCMonth();
const dateFromMonthIx=(m,day)=>new Date(Date.UTC(Math.floor(m/12),m%12,Math.min(28,Math.max(1,day)),12));
const isoOf=d=>d.toISOString().slice(0,10);
const periodOf=mi=>`${Math.floor(mi/12)}-${String((mi%12)+1).padStart(2,'0')}`;
function serviceLabel(startMi,step){ const sY=Math.floor(startMi/12), sM=startMi%12; if(step===1) return `${MONTHS_S[sM]} ${sY}`; const e=startMi+step-1; return `${MONTHS_S[sM]} ${sY} – ${MONTHS_S[e%12]} ${Math.floor(e/12)}`; }
const anchorOf=c=>new Date(String(c.start_on||c.created_at||ofToday()).slice(0,10)+'T12:00:00Z');
/* everything about the cycle at index k (0 = the one that starts in the contract's first month) */
function cycleFor(c,k){ const step=freqMonths(c.frequency), day=+c.billing_day||1, startMi=monthIx(anchorOf(c))+k*step, endMi=startMi+step;
  const invoiceMi=c.timing==='arrears'?endMi:startMi, invoiceDate=dateFromMonthIx(invoiceMi,day), generateDate=new Date(invoiceDate.getTime()-(+c.lead_days||0)*DAY_MS), dueDate=new Date(invoiceDate.getTime()+(+c.terms_days||0)*DAY_MS);
  const years=Math.floor(k*step/12), factor=Math.pow(1+(parseFloat(c.escalator_pct)||0)/100,years);
  return {k,step,startMi,endMi,period:periodOf(startMi),invoiceDate,generateDate,dueDate,serviceStart:dateFromMonthIx(startMi,1),periodStart:isoOf(dateFromMonthIx(startMi,day)),periodEnd:isoOf(new Date(dateFromMonthIx(endMi,day).getTime()-DAY_MS)),label:serviceLabel(startMi,step),factor,years}; }
const kForNow=(c,now)=>Math.floor((monthIx(now)-monthIx(anchorOf(c)))/freqMonths(c.frequency));
const pastEnd=(c,cy)=>!!c.end_on&&cy.serviceStart.getTime()>new Date(c.end_on+'T12:00:00Z').getTime();
/* the cycle due to be billed now: its generate date has come, it is not past the end, not yet billed */
function billableCycle(c,now){ now=now||new Date(); const k0=kForNow(c,now), cands=[]; for(const k of [k0+1,k0,k0-1,k0-2]){ if(k<0) continue; const cy=cycleFor(c,k); if(cy.generateDate.getTime()>now.getTime()) continue; if(pastEnd(c,cy)) continue; cands.push(cy); } cands.sort((a,b)=>b.startMi-a.startMi); return cands[0]||null; }
const invoicedPeriods=c=>new Set(OF.invoices.filter(i=>i.contract_id===c.id&&i.status!=='void'&&i.period).map(i=>i.period));
function periodCovered(c,period){ if(invoicedPeriods(c).has(period)) return true; const lip=c.last_period?String(c.last_period):null; return !!lip&&period<=lip; }
/* the next invoice for the record, skipping covered periods */
function nextCycle(c,now){ now=now||new Date(); const k0=kForNow(c,now); const done=p=>periodCovered(c,p);
  for(const k of [k0-1,k0,k0+1,k0+2,k0+3,k0+4]){ if(k<0) continue; const cy=cycleFor(c,k); if(done(cy.period)) continue; if(cy.invoiceDate.getTime()>=now.getTime()-DAY_MS){ if(pastEnd(c,cy)) return null; return cy; } }
  for(const k of [k0,k0+1,k0+2,k0+3,k0+4,k0+5,k0+6]){ if(k<0) continue; const cy=cycleFor(c,k); if(done(cy.period)) continue; if(pastEnd(c,cy)) return null; return cy; }
  return cycleFor(c,k0+1); }
const billableNow=c=>{ if(c.status!=='active') return null; const cy=billableCycle(c); return cy&&!periodCovered(c,cy.period)?cy:null; };
/* generate the invoice for a contract's cycle — idempotent per period */
async function genInvoice(c,cy,o={}){
  if(periodCovered(c,cy.period)&&!o.force){ const ex=OF.invoices.find(i=>i.contract_id===c.id&&i.period===cy.period&&i.status!=='void'); return {already:true,invoice:ex||null}; }
  const t=tenantOf(c.tenant);
  const items=(c.items||[]).map(it=>Object.assign({},it,{id:uid(),unit_price:ofN((parseFloat(it.unit_price)||0)*cy.factor),detail:[it.detail,cy.label].filter(Boolean).join(' · ')}));
  const tot=docTotals(items,c.discount_pct);
  const issued=cy.invoiceDate.getTime()>Date.now()?isoOf(cy.invoiceDate):ofToday();
  const inv={id:uid(),number:await nextNo('invoice'),tenant:c.tenant,company:t?t.name:c.tenant,contract_id:c.id,period:cy.period,period_start:cy.periodStart,period_end:cy.periodEnd,status:'draft',issued_on:issued,due_on:ofAddDays(issued,+c.terms_days||0),terms_days:+c.terms_days||0,discount_pct:ofN(c.discount_pct),items,subtotal:tot.subtotal,discount:tot.discount,tax:tot.tax,total:tot.total,paid:0,notes:c.title?'Recurring service · '+c.title:'Recurring service'};
  await ofInsert('fs_invoices',OF.invoices,inv);
  if(!c.last_period||cy.period>c.last_period) await ofUpdate('fs_contracts',c,{last_period:cy.period});
  logEvent(c.tenant,'invoice','Invoice '+invNo(inv)+' generated for '+cy.label+' · '+ofMoney(inv.total));
  const b=ofSettings().billing||{};
  if(b.autosend&&o.auto){ try{ await sendInvoice(inv,{quiet:true}); }catch(_){} }
  return {invoice:inv};
}
/* every active contract whose cycle is due: generate (auto) or leave for the Contracts page (review) */
async function ofRunBilling(o={}){
  const mode=(ofSettings().billing||{}).mode||'auto'; let made=0, due=0; const now=new Date();
  for(const c of OF.contracts.slice()){ const cy=billableNow(c); if(!cy) continue; due++;
    if(mode==='auto'&&now.getTime()>=cy.invoiceDate.getTime()){ try{ const r=await genInvoice(c,cy,{auto:true}); if(r&&!r.already) made++; }catch(e){ if(!o.quiet) ofErr(e); } } }
  if(!o.quiet) toast(made?made+' invoice'+(made===1?'':'s')+' generated':due?due+' due — in review mode they wait for Generate':'Nothing to bill');
  return {made,due};
}

/* ---------- the portal's pages ---------- */
function ofSearchBar(id,ph){ return `<div class="search" style="margin-bottom:14px">${I.search}<input class="inp" id="${id}" placeholder="${esc(ph)}" value="${esc(OF.q)}" aria-label="${esc(ph)}"></div>`; }
function ofWireSearch(m,id,rerender){ const qi=$(id); if(!qi) return; qi.oninput=()=>{ OF.q=qi.value; const pos=qi.selectionStart; rerender(); const n=$(id); if(n){ n.focus(); n.setSelectionRange(pos,pos); } }; }
const ofHit=(q,...parts)=>!q||parts.join(' ').toLowerCase().includes(q);
const ofCard=(title,body,actions='')=>`<div class="card" style="overflow:hidden"><div class="cardhead"><h2 class="h2">${title}</h2><div class="actions">${actions}</div></div>${body}</div>`;
const ofKV=(k,v)=>`<div class="kv"><span class="muted">${k}</span><span>${v||'<span class="muted">—</span>'}</span></div>`;
const ofBack=(label,view)=>`<p style="margin:0 0 4px;font-size:12px;letter-spacing:.1em;text-transform:uppercase;color:var(--gold-dk,#7E5F1A);font-weight:700"><a href="#" data-ofback="${view}" style="color:inherit;text-decoration:none">${esc(label)}</a></p>`;
function wireBack(m){ m.querySelectorAll('[data-ofback]').forEach(a=>a.onclick=e=>{ e.preventDefault(); ofGo(a.dataset.ofback); }); }
const daysAgo=iso=>Math.max(0,Math.round((Date.now()-new Date(iso||Date.now()).getTime())/DAY_MS));

/* ----- Pipeline ----- */
function vPipeline(m){
  const q=OF.q.trim().toLowerCase(), L=OF.leads.filter(l=>ofHit(q,l.company,l.title,l.contact_name,l.contact_email,l.owner,l.city,l.state));
  const open=L.filter(l=>l.stage!=='won'&&l.stage!=='lost'), yr=String(new Date().getFullYear());
  const won=OF.leads.filter(l=>l.stage==='won'&&String(l.won_at||'').startsWith(yr)), lost=OF.leads.filter(l=>l.stage==='lost'&&String(l.lost_at||'').startsWith(yr));
  const mrr=open.reduce((a,l)=>a+(parseFloat(l.value_recurring)||0),0), once=open.reduce((a,l)=>a+(parseFloat(l.value_onetime)||0),0);
  const facts=l=>[l.holes?l.holes+' holes':'',l.members_n?l.members_n.toLocaleString()+(l.kind==='muni'?' rounds':' members'):'',l.current_system?'on '+l.current_system:''].filter(Boolean).join(' · ');
  const card=l=>`<div class="card pad click" data-lead="${esc(l.id)}" style="padding:12px 14px;cursor:pointer"><div style="display:flex;justify-content:space-between;gap:8px;align-items:flex-start"><b style="min-width:0">${esc(l.company)}</b><span class="muted" style="font-size:11.5px;white-space:nowrap">${esc(leadNo(l))}</span></div>
    <div class="muted" style="font-size:12.5px;margin-top:2px">${esc(kindLabel(l.kind))}${facts(l)?' · '+esc(facts(l)):''}</div>
    ${leadMods(l).length?`<div class="chips" style="margin-top:6px">${leadMods(l).map(k=>`<span class="chip gold" style="min-height:20px;font-size:11px">${esc(moduleName(k))}</span>`).join('')}</div>`:''}
    <div style="display:flex;justify-content:space-between;gap:8px;margin-top:8px;font-size:12.5px"><span class="num">${parseFloat(l.value_recurring)?ofMoney(l.value_recurring)+'/mo':''}${parseFloat(l.value_onetime)?(parseFloat(l.value_recurring)?' + ':'')+ofMoney(l.value_onetime):''}</span><span class="muted">${esc(l.owner?l.owner.split('@')[0]:'')}${l.live_by?' · live by '+fdate(l.live_by):l.expected_close?' · '+fdate(l.expected_close):''}</span></div>
    <div class="muted" style="font-size:11.5px;margin-top:4px">${esc(l.contact_name||'')}${l.contact_title?', '+esc(l.contact_title):''}${l.city?' · '+esc([l.city,l.state].filter(Boolean).join(', ')):''} · ${daysAgo(l.updated_at)}d</div></div>`;
  const col=([k,label])=>{ const xs=open.filter(l=>l.stage===k); return `<div class="card" style="background:var(--ivory);padding:10px;min-height:120px"><div style="display:flex;justify-content:space-between;align-items:baseline;padding:2px 4px 8px"><b style="font-size:13px">${esc(label)}</b><span class="muted" style="font-size:12px">${xs.length}${xs.length?' · '+ofMoney(xs.reduce((a,l)=>a+(parseFloat(l.value_recurring)||0),0))+'/mo':''}</span></div><div class="stack" style="gap:8px">${xs.map(card).join('')||'<p class="hint" style="padding:4px">Nothing here.</p>'}</div></div>`; };
  const closed=L.filter(l=>l.stage==='won'||l.stage==='lost').sort((a,b)=>new Date(b.won_at||b.lost_at||0)-new Date(a.won_at||a.lost_at||0));
  const crow=l=>`<div class="tr click" data-lead="${esc(l.id)}" style="grid-template-columns:minmax(0,1.6fr) minmax(0,1.2fr) 120px 130px 100px 32px"><div class="cell2"><b>${esc(l.company)}</b><small>${esc(l.title||'')}</small></div><span class="muted" style="font-size:13px">${esc(l.contact_name||'')}</span><span class="num">${ofMoney(l.value_recurring)}/mo</span><span class="muted" style="font-size:12.5px">${fdate(l.won_at||l.lost_at)}${l.stage==='lost'&&l.lost_reason?' · '+esc(l.lost_reason):''}</span><span>${stageChip(l.stage)}${l.tenant?' <span class="chip">client</span>':''}</span><span class="ib">${I.chev}</span></div>`;
  const demos=open.filter(l=>l.stage==='demo').length, trials=open.filter(l=>l.stage==='trial').length, sys={}; open.forEach(l=>{ if(l.current_system) sys[l.current_system]=(sys[l.current_system]||0)+1; }); const topSys=Object.entries(sys).sort((a,b)=>b[1]-a[1]).slice(0,2).map(([k,n])=>n+' on '+k).join(' · ');
  m.innerHTML=head('Pipeline','Every club Flagstick is talking to, by stage: a conversation, a demo, a proposal, a trial hub, a subscription.',btn('Run billing','ofRun','')+btn('New lead','ofNewLead','pri',I.plus))+
    (PS.err?`<div class="banner">${esc(PS.err)}</div>`:'')+
    `<div class="grid g4" style="margin-bottom:16px">${kpi('Clubs in the pipeline',open.length,topSys||'in the pipeline')}${kpi('Pipeline MRR',ofMoney(mrr),once?'+ '+ofMoney(once)+' set-up and training':'recurring, per month')}${kpi('Demos & trials',demos+trials,demos+' demoed · '+trials+' on a trial hub')}${kpi('Won this year',won.length,(won.length+lost.length)?ofMoney(won.reduce((a,l)=>a+(parseFloat(l.value_recurring)||0),0))+'/mo · '+Math.round(100*won.length/(won.length+lost.length))+'% win rate':'no closed deals yet')}</div>`+
    ofSearchBar('ofQ','Search leads — club, contact, owner')+
    `<div class="grid" style="grid-template-columns:repeat(5,minmax(0,1fr));align-items:start;margin-bottom:16px">${STAGES.slice(0,5).map(col).join('')}</div>`+
    ofCard('Closed <span class="muted" style="font-size:13px;font-weight:400">· won and lost</span>',`<div class="t">${closed.length?closed.slice(0,60).map(crow).join(''):'<div class="tr"><span class="muted">No closed deals yet.</span></div>'}</div>`);
  $('ofNewLead').onclick=()=>leadDrawer(null); $('ofRun').onclick=()=>ofRunBilling().then(()=>vPortal(m));
  ofWireSearch(m,'ofQ',()=>vPipeline(m));
  m.querySelectorAll('[data-lead]').forEach(x=>x.onclick=()=>leadDrawer(OF.leads.find(l=>l.id===x.dataset.lead)));
}
function leadDrawer(l){
  const est=l?OF.estimates.filter(e=>e.lead_id===l.id):[], log=(l&&l.log||[]).slice().reverse();
  openDrawer({kicker:l?leadNo(l)+' · '+STAGE_LABEL[l.stage]:'New lead',title:l?l.company:'New lead',wide:true,saveLabel:l?'Save':'Add lead',
    body:pair(field('Club / organization','olC',l?.company||'',{ph:'e.g. Shady Valley Country Club'}),field('Type of club','olK',l?.kind||'private',{type:'select',options:CLIENT_KINDS.map(k=>[k.id,k.name])}))+
      `<div class="frow2" style="grid-template-columns:1fr 1fr 1.4fr">${field('Holes','olH',l?.holes||'',{type:'select',options:HOLES})}${field('Members','olM',l?.members_n||'',{type:'number',ph:'e.g. 450'})}${field('Runs on today','olSys',l?.current_system||'',{type:'select',options:[['','—']].concat(SYSTEMS.map(x=>[x,x]))})}</div>`+
      `<div class="fld"><span class="lbl">What they are after</span><div class="chips" id="olMods">${MODULE_CATALOG.filter(x=>!x.base).map(x=>`<label class="check" style="font-size:13px"><input type="checkbox" data-olm="${x.id}"${l&&l.modules&&l.modules[x.id]?' checked':''}>${esc(x.name)}</label>`).join('')}</div><p class="hint">Golf management is always in; tick the rest. The proposal starts from these.</p></div>`+
      field('The deal','olT',l?.title||'',{ph:'e.g. Club management for the 2027 season'})+
      `<div class="fld"><span class="lbl">Stage</span>${seg('olS',STAGES,l?.stage||'new')}<p class="hint">Contacted → a demo (the portal’s Demo button on their hub, or ours) → a proposal → a trial hub they run a real event on → the subscription.</p></div>`+
      `<div id="olLost" style="${l?.stage==='lost'?'':'display:none'}">${field('Why it was lost','olWhy',l?.lost_reason||'',{ph:'e.g. stayed with Golf Genius, price, timing, the board said no'})}</div>`+
      `<div class="frow2" style="grid-template-columns:1.2fr 1fr">${field('Contact','olN',l?.contact_name||'',{ph:'Name'})}${field('Their role','olTitle',l?.contact_title||'',{type:'select',options:[['','—']].concat(CONTACT_ROLES.map(x=>[x,x]))})}</div>`+
      pair(field('E-mail','olE',l?.contact_email||'',{type:'email'}),field('Phone','olP',l?.contact_phone||'',{type:'tel'}))+
      `<div class="frow2" style="grid-template-columns:2fr 1fr 1.4fr">${field('City','olCity',l?.city||'')}${field('State','olSt',l?.state||'')}${field('Owner (Flagstick)','olO',l?.owner||ofWho(),{ph:'who is selling it'})}</div>`+
      pair(field('Subscription value, per month','olR',l?.value_recurring||'',{type:'number',ph:'0.00'}),field('Set-up and training','olOne',l?.value_onetime||'',{type:'number',ph:'0.00'}))+
      `<div class="frow2" style="grid-template-columns:1fr 1fr 1fr">${field('Wants to be live by','olLive',l?.live_by||'',{type:'date'})}${field('Expected close','olX',l?.expected_close||'',{type:'date'})}${field('Source','olSrc',l?.source||'',{ph:'referral, website, PGA show…'})}</div>`+
      field('Notes','olNo',l?.notes||'',{type:'textarea'})+
      (l?`<div class="fld" style="margin-top:6px"><span class="lbl">Activity</span><div style="display:flex;gap:8px"><input class="inp" id="olLog" placeholder="Log a call, a meeting, a next step…" style="flex:1"><button class="btn" id="olLogAdd">Add</button></div>
          <div class="mini" style="margin-top:8px;max-height:220px;overflow:auto" id="olLogList">${log.length?log.map(x=>`<div class="mr" style="grid-template-columns:1fr;gap:2px"><span style="font-size:13px">${esc(x.text)}</span><span class="muted" style="font-size:11.5px">${fwhen(x.at)} · ${esc(x.by||'')}</span></div>`).join(''):'<div class="mr"><span class="muted" style="font-size:12.5px">Nothing logged yet.</span></div>'}</div></div>
        <div class="fld" style="margin-top:6px"><span class="lbl">Estimates</span><div class="actions">${est.map(e=>`<button class="btn sm" data-ole="${esc(e.id)}">${esc(estNo(e))} · ${esc(EST_STATUS[e.status])} · ${ofMoney(estSplit(e).monthly)}/mo</button>`).join('')}<button class="btn sm" id="olEst">${I.plus}New proposal</button></div></div>
        <div class="fld" style="margin-top:6px"><span class="lbl">Their hub</span><div class="actions">${l.tenant?`<button class="btn sm" id="olOpenT">Open ${esc(tenantName(l.tenant))}${(tenantOf(l.tenant)||{}).status==='trial'?' (trial)':''}</button>`:`<button class="btn sm" id="olTrial">Set up a trial hub</button><button class="btn sm" id="olWin">Won — set the club up as a client</button><button class="btn sm" id="olLinkT">Link an existing client</button>`}</div><p class="hint">A trial hub is the club’s own address with their roster and courses — they run a real event on it (status Trial, nothing billed). Winning makes it a paying client; a subscription switches the modules on.</p></div>`:''),
    wire:r=>{ wireSeg(r,'olS',v=>{ r.querySelector('#olLost').style.display=v==='lost'?'':'none'; });
      if(!l) return;
      r.querySelector('#olLogAdd').onclick=async()=>{ const text=r.querySelector('#olLog').value.trim(); if(!text) return; const log=(l.log||[]).concat([{id:uid(),at:new Date().toISOString(),by:ofWho(),text}]); try{ await ofUpdate('fs_leads',l,{log}); r.querySelector('#olLog').value=''; r.querySelector('#olLogList').innerHTML=log.slice().reverse().map(x=>`<div class="mr" style="grid-template-columns:1fr;gap:2px"><span style="font-size:13px">${esc(x.text)}</span><span class="muted" style="font-size:11.5px">${fwhen(x.at)} · ${esc(x.by||'')}</span></div>`).join(''); }catch(e){ ofErr(e); } };
      r.querySelectorAll('[data-ole]').forEach(b=>b.onclick=()=>{ closeDrawer(); ofGo('estimate',b.dataset.ole); });
      r.querySelector('#olEst').onclick=()=>{ closeDrawer(); estimateDrawer(null,{lead:l}); };
      const ot=r.querySelector('#olOpenT'); if(ot) ot.onclick=()=>{ closeDrawer(); openClient(l.tenant); };
      const fromLead=status=>{ closeDrawer(); OF.pendingLead=l.id; const mods=Object.assign({golf:true},l.modules||{}); if(mods.club){ mods.pos=true; mods.billing=true; } editClient(null,{name:l.company,kind:l.kind,status,modules:mods,plan:mods.club?'club':'golf',address:{city:l.city,state:l.state},billing_email:l.contact_email,phone:l.contact_phone,notes:l.notes,contact:{name:l.contact_name,title:l.contact_title,email:l.contact_email,phone:l.contact_phone}}); };
      const w=r.querySelector('#olWin'); if(w) w.onclick=()=>fromLead('active');
      const tr=r.querySelector('#olTrial'); if(tr) tr.onclick=()=>fromLead('trial');
      const lt=r.querySelector('#olLinkT'); if(lt) lt.onclick=()=>{ closeDrawer(); pickClientDrawer('Link '+l.company+' to a client',async slug=>{ await ofUpdate('fs_leads',l,{tenant:slug,stage:'won',won_at:l.won_at||new Date().toISOString()}); logEvent(slug,'lead','Lead '+leadNo(l)+' ('+l.company+') won — linked to this client'); toast('Linked'); vPortal($('main')); }); }; },
    del:l?()=>{ if(!confirm('Delete this lead? Its estimates stay.')) return; ofDelete('fs_leads',OF.leads,l).then(()=>vPortal($('main'))).catch(ofErr); }:null,
    save:()=>{ const company=fv('olC'); if(!company){ toast('Name the club'); return false; }
      const stage=$('dBody').querySelector('#olS').dataset.val;
      const mods={}; $('dBody').querySelectorAll('[data-olm]').forEach(c=>{ if(c.checked) mods[c.dataset.olm]=true; });
      const rec={company,kind:fv('olK')||'private',title:fv('olT'),stage,lost_reason:stage==='lost'?fv('olWhy'):'',holes:parseInt(fv('olH'))||null,members_n:parseInt(fv('olM'))||null,current_system:fv('olSys'),modules:mods,contact_name:fv('olN'),contact_title:fv('olTitle'),contact_email:fv('olE'),contact_phone:fv('olP'),owner:fv('olO'),city:fv('olCity'),state:fv('olSt'),value_recurring:ofN(fv('olR')),value_onetime:ofN(fv('olOne')),live_by:fv('olLive')||null,expected_close:fv('olX')||null,source:fv('olSrc'),notes:fv('olNo')};
      if(stage==='won'&&!(l&&l.won_at)) rec.won_at=new Date().toISOString(); if(stage==='lost'&&!(l&&l.lost_at)) rec.lost_at=new Date().toISOString(); if(stage==='demo'&&!(l&&l.demo_at)) rec.demo_at=new Date().toISOString();
      (async()=>{ try{ if(l){ const was=l.stage; await ofUpdate('fs_leads',l,rec); if(was!==stage){ const log=(l.log||[]).concat([{id:uid(),at:new Date().toISOString(),by:ofWho(),text:'Stage → '+STAGE_LABEL[stage]+(stage==='lost'&&rec.lost_reason?' — '+rec.lost_reason:'')}]); await ofUpdate('fs_leads',l,{log}); logEvent(l.tenant,'lead','Lead '+leadNo(l)+' ('+company+') → '+STAGE_LABEL[stage]); } }
          else { rec.number=await nextNo('lead'); rec.log=[{id:uid(),at:new Date().toISOString(),by:ofWho(),text:'Lead created'}]; const row=await ofInsert('fs_leads',OF.leads,rec); logEvent(null,'lead','New lead '+leadNo(row)+': '+company); }
          toast('Saved'); vPortal($('main')); }catch(e){ ofErr(e); } })(); }});
}
/* pick one of the clients (an active, trial or prospect tenant) */
function pickClientDrawer(title,onPick){
  const T=(PS.tenants||[]).filter(t=>t.status!=='inactive');
  openDrawer({kicker:'Client',title,saveLabel:'Choose',body:field('Client','opT','',{type:'select',options:[['','— choose —']].concat(T.map(t=>[t.slug,t.name+' ('+STATUS_LABEL[t.status]+')']))}),
    save:()=>{ const slug=fv('opT'); if(!slug){ toast('Choose a client'); return false; } Promise.resolve(onPick(slug)).catch(ofErr); }});
}
/* after saveClient made a tenant from a lead: link the lead, mark it won */
async function officeClientCreated(slug,rec,preset){
  if(OF.pendingLead){ const l=OF.leads.find(x=>x.id===OF.pendingLead); OF.pendingLead=null; const trial=preset&&preset.status==='trial'; if(l){ try{ await ofUpdate('fs_leads',l,Object.assign({tenant:slug,stage:trial?'trial':'won',log:(l.log||[]).concat([{id:uid(),at:new Date().toISOString(),by:ofWho(),text:trial?'Trial hub set up ('+slug+'.'+BASE_DOMAIN+')':'Won — set up as a client ('+slug+')'}])},trial?{}:{won_at:l.won_at||new Date().toISOString()})); logEvent(slug,'lead','Lead '+leadNo(l)+(trial?' — trial hub set up':' won — client created')); }catch(_){} } }
  if(preset&&preset.contact&&preset.contact.name){ try{ const c={tenant:slug,name:preset.contact.name,title:preset.contact.title||'',email:preset.contact.email||'',phone:preset.contact.phone||'',is_primary:true,notes:''}; const {data}=await sb.from('tenant_contacts').insert(c).select('*'); PS.contacts.push((data&&data[0])||Object.assign({id:uid()},c)); }catch(_){} }
}

/* ----- the items editor shared by estimates, contracts and invoices ----- */
function itemsEditor(items,o={}){
  const cat=OF.catalog.filter(c=>c.active!==false);
  const row=(it,i)=>`<div class="mr oi" data-i="${i}" data-cat="${esc(it.catalog_id||'')}"${it.taxable?' data-tax="1"':''} style="grid-template-columns:minmax(0,2fr) 60px 100px 70px ${o.recurring?'92px ':''}30px"><div style="display:flex;flex-direction:column;gap:4px;min-width:0"><input class="inp" data-k="descr" value="${esc(it.descr||'')}" placeholder="Description" list="ofCat"><input class="inp" data-k="detail" value="${esc(it.detail||'')}" placeholder="Detail (optional)" style="font-size:12px"></div>
      <input class="inp num" data-k="qty" value="${esc(it.qty??1)}" inputmode="decimal" aria-label="Qty"><input class="inp num" data-k="unit_price" value="${esc(it.unit_price??'')}" inputmode="decimal" placeholder="0.00" aria-label="Unit price"><input class="inp num" data-k="discount_pct" value="${esc(it.discount_pct||'')}" inputmode="decimal" placeholder="%" aria-label="Discount %">
      ${o.recurring?`<select class="inp" data-k="every" aria-label="Billed"><option value="once"${it.recurring?'':' selected'}>One-time</option><option value="month"${it.recurring&&it.every!=='year'?' selected':''}>Monthly</option><option value="year"${it.recurring&&it.every==='year'?' selected':''}>Yearly</option></select>`:''}
      <button class="ib" data-rm="${i}" aria-label="Remove line">${I.trash}</button></div>`;
  return `<div class="fld"><span class="lbl">Lines</span><datalist id="ofCat">${cat.map(c=>`<option value="${esc(c.name)}">`).join('')}</datalist>
    <div class="mini" id="oiList"><div class="mr h" style="grid-template-columns:minmax(0,2fr) 60px 100px 70px ${o.recurring?'92px ':''}30px"><span>Item</span><span>Qty</span><span>Unit price</span><span>Disc %</span>${o.recurring?'<span>Billed</span>':''}<span></span></div>${(items||[]).map(row).join('')}</div>
    <div class="actions" style="margin-top:8px"><select class="inp" id="oiPick" style="width:auto;max-width:320px"><option value="">Add from the catalog…</option>${cat.map(c=>`<option value="${esc(c.id)}">${esc(c.name)} · ${ofMoney(c.unit_price)}${c.recurring?'/'+(c.every==='year'?'yr':'mo'):''}</option>`).join('')}</select><button class="btn sm" id="oiAdd">${I.plus}Blank line</button></div>
    <div style="display:flex;gap:12px;align-items:center;margin-top:8px">${field('Discount on the whole document, %','oiWide',o.wide||'',{type:'number',ph:'0'})}<span class="muted" style="font-size:12.5px" id="oiTot"></span></div></div>`;
}
function ofWireItems(r,o={}){
  const list=r.querySelector('#oiList'), tot=r.querySelector('#oiTot');
  const sum=()=>{ const items=readItems(r,o); if(o.recurring){ const s=estSplit({items,discount_pct:fv('oiWide')}); tot.textContent=`${ofMoney(s.monthly)} / month recurring · ${ofMoney(s.once)} one-time`; } else { const t=docTotals(items,fv('oiWide')); tot.textContent=`Subtotal ${ofMoney(t.subtotal)}${t.discount?' · discount '+ofMoney(t.discount):''}${t.tax?' · tax '+ofMoney(t.tax):''} · total ${ofMoney(t.total)}`; } };
  const add=it=>{ const n=list.querySelectorAll('.oi').length; const tmp=document.createElement('div'); tmp.innerHTML=itemsEditor([it],o); const row=tmp.querySelector('.oi'); row.dataset.i=String(n); list.appendChild(row); wireRow(row); sum(); };
  const wireRow=row=>{ row.querySelectorAll('input,select').forEach(x=>x.oninput=sum); row.querySelector('[data-rm]').onclick=()=>{ row.remove(); sum(); };
    const d=row.querySelector('[data-k=descr]'); d.onchange=()=>{ const c=OF.catalog.find(x=>x.name===d.value); if(c&&!row.querySelector('[data-k=unit_price]').value){ row.querySelector('[data-k=unit_price]').value=c.unit_price; row.dataset.cat=c.id; row.dataset.tax=c.taxable?'1':''; const ev=row.querySelector('[data-k=every]'); if(ev) ev.value=c.recurring?(c.every==='year'?'year':'month'):'once'; sum(); } }; };
  list.querySelectorAll('.oi').forEach(wireRow);
  r.querySelector('#oiAdd').onclick=()=>add({qty:1,recurring:!!o.recurring});
  r.querySelector('#oiPick').onchange=()=>{ const c=OF.catalog.find(x=>x.id===r.querySelector('#oiPick').value); if(!c) return; add({catalog_id:c.id,descr:c.name,detail:'',qty:1,unit_price:c.unit_price,taxable:!!c.taxable,recurring:!!c.recurring,every:c.every}); r.querySelector('#oiPick').value=''; };
  r.querySelector('#oiWide').oninput=sum; sum();
  r._oi={add,sum,remove:catId=>{ list.querySelectorAll('.oi').forEach(x=>{ if(x.dataset.cat===catId) x.remove(); }); sum(); }};
}
function readItems(r,o={}){ return [...r.querySelectorAll('#oiList .oi')].map(row=>{ const g=k=>{ const x=row.querySelector('[data-k='+k+']'); return x?x.value.trim():''; }; const descr=g('descr'); if(!descr) return null; const c=OF.catalog.find(x=>x.name===descr); const ev=g('every');
  return {id:uid(),catalog_id:row.dataset.cat||(c?c.id:null),descr,detail:g('detail'),qty:parseFloat(g('qty'))||1,unit_price:ofN(g('unit_price')),discount_pct:ofPct(g('discount_pct')),taxable:row.dataset.tax==='1'||!!(c&&c.taxable),recurring:o.recurring?ev!=='once':!!(c&&c.recurring)&&o.keepRecurring,every:ev==='year'?'year':'month'}; }).filter(Boolean); }

/* ----- Proposals (fs_estimates): built from the product's modules, then set-up and training ----- */
function offeringsBlock(e){ const offers=OF.catalog.filter(c=>c.module&&c.active!==false), on=new Set((e.items||[]).map(it=>it.catalog_id));
  return `<div class="fld"><span class="lbl">The product</span><div style="display:flex;gap:12px;align-items:center;flex-wrap:wrap;margin-bottom:8px"><span class="muted" style="font-size:12.5px">Subscription billed</span>${seg('oeBill',[['month','Monthly'],['year','Yearly']],e.billing||'month')}</div>
    <div class="mini">${offers.map(c=>`<label class="mr" style="grid-template-columns:28px minmax(0,1fr) 120px;cursor:pointer"><input type="checkbox" data-offer="${esc(c.id)}"${on.has(c.id)?' checked':''}><span><b>${esc(c.name)}</b><br><span class="muted" style="font-size:12.5px">${esc(c.descr)}</span></span><span class="num muted" style="font-size:12.5px;text-align:right">${ofMoney(c.unit_price)}/mo${c.price_year?'<br>'+ofMoney(c.price_year)+'/yr':''}</span></label>`).join('')||'<div class="mr"><span class="muted">No module items in the catalog yet — give a catalog item a module.</span></div>'}</div>
    <p class="hint">Tick what the club is buying; each is a line below, priced per club. Set-up, the roster import, course cards and training come from the catalog under the lines.</p></div>`; }
function wireOfferings(r){ const bill=()=>r.querySelector('#oeBill').dataset.val;
  r.querySelectorAll('[data-offer]').forEach(cb=>cb.onchange=()=>{ const c=OF.catalog.find(x=>x.id===cb.dataset.offer); if(!c) return; if(cb.checked) r._oi.add({catalog_id:c.id,descr:c.name,detail:(MODULE_CATALOG.find(m=>m.id===c.module)||{}).desc||c.descr,qty:1,unit_price:offerPrice(c,bill()),taxable:!!c.taxable,recurring:true,every:bill()}); else r._oi.remove(c.id); });
  wireSeg(r,'oeBill',v=>{ r.querySelectorAll('#oiList .oi').forEach(row=>{ const c=OF.catalog.find(x=>x.id===row.dataset.cat); if(!c||!c.module) return; row.querySelector('[data-k=unit_price]').value=offerPrice(c,v); const ev=row.querySelector('[data-k=every]'); if(ev) ev.value=v; }); r._oi.sum(); }); }
/* ----- Estimates ----- */
function vEstimates(m){
  const q=OF.q.trim().toLowerCase(), segs=[['open','Open'],['accepted','Accepted'],['closed','Declined / expired'],['converted','Converted'],['all','All']];
  const inSeg=e=>OF.eseg==='all'||(OF.eseg==='open'?(e.status==='draft'||e.status==='sent'):OF.eseg==='closed'?(e.status==='declined'||e.status==='expired'):e.status===OF.eseg);
  const L=OF.estimates.filter(inSeg).filter(e=>ofHit(q,e.company,e.title,e.contact_name,estNo(e)));
  const open=OF.estimates.filter(e=>e.status==='sent'), yr=String(new Date().getFullYear()), acc=OF.estimates.filter(e=>(e.status==='accepted'||e.status==='converted')&&String(e.accepted_at||'').startsWith(yr));
  const cols='110px minmax(0,1.6fr) minmax(0,1.1fr) 120px 110px 110px 32px';
  const row=e=>{ const s=estSplit(e); return `<div class="tr click" data-est="${esc(e.id)}" style="grid-template-columns:${cols}"><span style="font-weight:600;font-size:12.5px;color:var(--navy)">${esc(estNo(e))}</span><div class="cell2"><b>${esc(e.company)}</b><small>${esc(e.title||'')}</small></div><span class="muted" style="font-size:13px">${esc(e.contact_name||'')}</span><span class="num">${ofMoney(s.monthly)}/mo${s.once?`<br><small class="muted">+ ${ofMoney(s.once)}</small>`:''}</span><span class="muted" style="font-size:12.5px">${fdate(e.issued_on||e.created_at)}</span><span>${estChip(e.status)}</span><span class="ib">${I.chev}</span></div>`; };
  m.innerHTML=head('Proposals','What Flagstick proposes to a club: the modules as a subscription, plus set-up, the roster import, course cards and training. Accepted, the subscription becomes the contract and the rest the first invoice.',btn('New proposal','ofNewEst','pri',I.plus))+
    `<div class="grid g4" style="margin-bottom:16px">${kpi('Out for decision',open.length,ofMoney(open.reduce((a,e)=>a+estSplit(e).monthly,0))+'/mo proposed')}${kpi('Accepted this year',acc.length,ofMoney(acc.reduce((a,e)=>a+estSplit(e).monthly,0))+'/mo')}${kpi('Drafts',OF.estimates.filter(e=>e.status==='draft').length,'not sent yet')}${kpi('Catalog',OF.catalog.filter(c=>c.active!==false).length,'items to propose from')}</div>`+
    `<div style="display:flex;justify-content:space-between;align-items:center;gap:12px;flex-wrap:wrap;margin-bottom:14px"><div class="seg" id="oeSeg">${segs.map(([k,l])=>`<button type="button" data-v="${k}" class="${OF.eseg===k?'on':''}">${l}</button>`).join('')}</div><div class="search">${I.search}<input class="inp" id="ofQ" placeholder="Search proposals" value="${esc(OF.q)}" aria-label="Search proposals"></div></div>`+
    `<div class="card" style="overflow:hidden"><div class="tw"><div class="t" style="min-width:820px"><div class="tr th" style="grid-template-columns:${cols}"><span>Number</span><span>Club</span><span>Contact</span><span>Value</span><span>Issued</span><span>Status</span><span></span></div>${L.length?L.map(row).join(''):'<div class="tr"><span class="muted">No proposals here.</span></div>'}</div></div></div>`;
  $('ofNewEst').onclick=()=>estimateDrawer(null,{});
  m.querySelectorAll('#oeSeg button').forEach(b=>b.onclick=()=>{ OF.eseg=b.dataset.v; vEstimates(m); });
  ofWireSearch(m,'ofQ',()=>vEstimates(m));
  m.querySelectorAll('[data-est]').forEach(x=>x.onclick=()=>ofGo('estimate',x.dataset.est));
}
function estimateDrawer(e,o={}){
  const lead=o.lead||(e&&e.lead_id?OF.leads.find(l=>l.id===e.lead_id):null), t=e&&e.tenant?tenantOf(e.tenant):(o.tenant?tenantOf(o.tenant):null);
  const d=e||{company:(lead&&lead.company)||(t&&t.name)||'',contact_name:(lead&&lead.contact_name)||'',contact_email:(lead&&lead.contact_email)||(t&&t.billing_email)||'',title:(lead&&lead.title)||'',issued_on:ofToday(),expires_on:ofAddDays(ofToday(),30),terms:(ofSettings().billing||{}).estimate_terms||'',items:[],discount_pct:0,billing:'month'};
  // a new proposal starts from the modules the lead asked for (or the client already has), as monthly lines
  if(!e){ const want=lead?Object.assign({golf:true},lead.modules||{}):(t?modulesOf(t):{golf:true}); OF.catalog.filter(c=>c.module&&c.active!==false&&want[c.module]).forEach(c=>d.items.push({id:uid(),catalog_id:c.id,descr:c.name,detail:(MODULE_CATALOG.find(m=>m.id===c.module)||{}).desc||c.descr,qty:1,unit_price:offerPrice(c,'month'),taxable:!!c.taxable,recurring:true,every:'month'})); }
  const T=(PS.tenants||[]).filter(x=>x.status!=='inactive');
  openDrawer({kicker:e?estNo(e):'New proposal',title:e?e.company:'New proposal',wide:true,saveLabel:e?'Save':'Create proposal',
    body:pair(field('Club / organization','oeC',d.company),field('Client (if already set up)','oeT',(e?e.tenant:o.tenant)||'',{type:'select',options:[['','— not a client yet —']].concat(T.map(x=>[x.slug,x.name]))}))+
      field('What it is for','oeTitle',d.title,{ph:'e.g. Club management for the 2027 season'})+
      pair(field('Contact','oeN',d.contact_name),field('E-mail','oeE',d.contact_email,{type:'email'}))+
      pair(field('Issued','oeI',d.issued_on||'',{type:'date'}),field('Valid until','oeX',d.expires_on||'',{type:'date'}))+
      offeringsBlock(d)+
      itemsEditor(d.items,{recurring:true,wide:d.discount_pct||''})+
      field('Terms','oeTerms',d.terms,{type:'textarea'})+field('Notes to the club','oeNo',d.notes||'',{type:'textarea'}),
    wire:r=>{ ofWireItems(r,{recurring:true}); wireOfferings(r); const ts=r.querySelector('#oeT'); ts.onchange=()=>{ const x=tenantOf(ts.value); if(x){ if(!fv('oeC')||e==null) r.querySelector('#oeC').value=x.name; if(!fv('oeE')&&x.billing_email) r.querySelector('#oeE').value=x.billing_email; } }; },
    del:e&&e.status==='draft'?()=>{ if(!confirm('Delete this draft proposal?')) return; ofDelete('fs_estimates',OF.estimates,e).then(()=>ofGo('estimates')).catch(ofErr); }:null,
    save:()=>{ const company=fv('oeC'); if(!company){ toast('Name the club'); return false; } const items=readItems($('dBody'),{recurring:true}); if(!items.length){ toast('Add at least one line'); return false; }
      const rec={company,tenant:fv('oeT')||null,lead_id:lead?lead.id:(e?e.lead_id:null),title:fv('oeTitle'),contact_name:fv('oeN'),contact_email:fv('oeE'),issued_on:fv('oeI')||null,expires_on:fv('oeX')||null,items,billing:$('dBody').querySelector('#oeBill').dataset.val,discount_pct:ofPct(fv('oiWide')),terms:fv('oeTerms'),notes:fv('oeNo')};
      (async()=>{ try{ let row=e; if(e) await ofUpdate('fs_estimates',e,rec); else { rec.number=await nextNo('estimate'); rec.status='draft'; row=await ofInsert('fs_estimates',OF.estimates,rec); logEvent(rec.tenant,'estimate','Proposal '+estNo(row)+' drafted for '+company+' · '+ofMoney(estSplit(row).monthly)+'/mo'); if(lead&&(parseFloat(lead.value_recurring)||0)===0){ try{ await ofUpdate('fs_leads',lead,{value_recurring:estSplit(row).monthly,value_onetime:estSplit(row).once}); }catch(_){} } }
          toast('Saved'); ofGo('estimate',row.id); }catch(x){ ofErr(x); } })(); }});
}
function vEstimate(m,id){
  const e=OF.estimates.find(x=>x.id===id); if(!e) return vEstimates(m);
  const s=estSplit(e), lead=e.lead_id?OF.leads.find(l=>l.id===e.lead_id):null, ct=e.contract_id?OF.contracts.find(c=>c.id===e.contract_id):null, inv=e.invoice_id?OF.invoices.find(i=>i.id===e.invoice_id):null;
  const cols='minmax(0,1.6fr) 40px 86px 56px 92px';
  const row=it=>`<div class="tr" style="grid-template-columns:${cols};min-height:44px"><div class="cell2"><b style="font-weight:600">${esc(it.descr)}</b>${it.detail?`<small>${esc(it.detail)}</small>`:''}</div><span class="num muted">${esc(it.qty)}</span><span class="num">${ofMoney(it.unit_price)}${it.recurring?'<span class="muted">/'+(it.every==='year'?'yr':'mo')+'</span>':''}</span><span class="num muted">${effPct(it,e.discount_pct)?'−'+effPct(it,e.discount_pct)+'%':''}</span><span class="num">${ofMoney(lineNet(it,e.discount_pct))}${it.recurring?'<span class="muted">/'+(it.every==='year'?'yr':'mo')+'</span>':''}</span></div>`;
  const table=(title,items,foot)=>items.length?`<div class="t fit"><div class="tr th" style="grid-template-columns:${cols}"><span>${title}</span><span>Qty</span><span>Unit</span><span>Disc.</span><span>Amount</span></div>${items.map(row).join('')}<div class="tr tot" style="grid-template-columns:${cols};min-height:44px"><span></span><span></span><span></span><span></span><span class="num">${foot}</span></div></div>`:'';
  const can=e.status==='draft'||e.status==='sent';
  m.innerHTML=`<div class="phead"><div>${ofBack('Proposals','estimates')}<h1 class="h1">${esc(estNo(e))} · ${esc(e.company)}</h1><p class="sub">${esc(e.title||'')}${e.title?' · ':''}${estChip(e.status)} · issued ${fdate(e.issued_on||e.created_at)}${e.expires_on?' · valid until '+fdate(e.expires_on):''}${e.sent_at?' · sent '+fwhen(e.sent_at)+(e.contact_email?' to '+esc(e.contact_email):''):''}${e.accepted_at?' · accepted '+fdate(e.accepted_at)+(e.accepted_by?' by '+esc(e.accepted_by):''):''}</p></div>
      <div class="actions">${btn('PDF','oePDF','')}${can?btn(e.status==='sent'?'Send again':'Send','oeSend',''):''}${can?btn('Edit','oeEdit','',I.edit):''}${e.status==='sent'||e.status==='draft'?btn('Accepted','oeAcc','pri'):''}${e.status==='accepted'?btn('Subscribe — the contract and the first invoice','oeConv','pri'):''}${can?btn('Declined','oeDec',''):''}</div></div><div class="rule"></div>
    <div class="grid g2" style="align-items:start">
      ${ofCard('The proposal',`${table('Subscription',s.recurring,ofMoney(s.monthly)+'<span class="muted">/mo</span>')}${table('Set-up & training',s.onetime,ofMoney(s.once))}${!e.items||!e.items.length?'<div class="t fit"><div class="tr"><span class="muted">No lines yet.</span></div></div>':''}
        <div style="padding:14px 22px 18px"><div style="display:flex;gap:24px;flex-wrap:wrap"><div><span class="lbl">Per month</span><div class="num" style="font-family:var(--serif);font-size:26px;color:var(--navy)">${ofMoney(s.monthly)}</div></div><div><span class="lbl">Per year</span><div class="num" style="font-family:var(--serif);font-size:26px;color:var(--navy)">${ofMoney(s.monthly*12)}</div></div><div><span class="lbl">One-time</span><div class="num" style="font-family:var(--serif);font-size:26px;color:var(--navy)">${ofMoney(s.once)}</div></div></div>${e.discount_pct?`<p class="hint" style="margin-top:8px">${e.discount_pct}% off the whole proposal is in these figures.</p>`:''}${e.billing==='year'?'<p class="hint" style="margin-top:8px">The subscription is billed yearly.</p>':''}</div>`)}
      <div class="stack">${ofCard('The club',`<div style="padding:0 22px 18px">${ofKV('Club',esc(e.company)+(lead?' <span class="muted">· '+esc(kindLabel(lead.kind))+(lead.holes?' · '+lead.holes+' holes':'')+(lead.members_n?' · '+lead.members_n+' members':'')+(lead.current_system?' · on '+esc(lead.current_system):'')+'</span>':''))}${ofKV('Their hub',e.tenant?`<a href="#" id="oeOpenT">${esc(tenantName(e.tenant))}</a> <span class="muted">· ${esc(e.tenant)}.${esc(BASE_DOMAIN)} · ${esc(STATUS_LABEL[(tenantOf(e.tenant)||{}).status]||'')}</span>`:'<span class="muted">not set up yet — a trial hub or the subscription makes one</span>')}${ofKV('Contact',esc(e.contact_name||''))}${ofKV('E-mail',e.contact_email?`<a href="mailto:${esc(e.contact_email)}">${esc(e.contact_email)}</a>`:'')}${ofKV('Lead',lead?`<a href="#" id="oeLead">${esc(leadNo(lead))} · ${esc(STAGE_LABEL[lead.stage])}</a>`:'')}${ofKV('Contract',ct?`<a href="#" id="oeCt">${esc(ctNo(ct))} · ${esc(CT_STATUS[ct.status])}</a>`:'')}${ofKV('Invoice',inv?`<a href="#" id="oeInv">${esc(invNo(inv))} · ${esc(INV_STATUS[inv.status])}</a>`:'')}</div>`)}
      ${e.terms||e.notes?ofCard('Terms & notes',`<div style="padding:0 22px 18px;font-size:13.5px;white-space:pre-wrap">${esc(e.terms||'')}${e.terms&&e.notes?'\n\n':''}${esc(e.notes||'')}</div>`):''}</div></div>`;
  wireBack(m);
  $('oePDF').onclick=()=>estimatePDF(e).then(doc=>doc.save(estNo(e)+'-'+e.company.replace(/[^\w]+/g,'-')+'.pdf')).catch(ofErr);
  const b=id=>$(id);
  if(b('oeEdit')) b('oeEdit').onclick=()=>estimateDrawer(e);
  if(b('oeSend')) b('oeSend').onclick=()=>sendEstimate(e);
  if(b('oeAcc')) b('oeAcc').onclick=()=>openDrawer({kicker:estNo(e),title:'Mark accepted',saveLabel:'Accepted',body:field('Accepted by','oaBy',e.contact_name||'')+field('On','oaOn',ofToday(),{type:'date'})+'<p class="hint">Then convert it: the recurring lines become the contract, the one-time lines the first invoice.</p>',
    save:()=>{ ofUpdate('fs_estimates',e,{status:'accepted',accepted_at:(fv('oaOn')||ofToday())+'T12:00:00Z',accepted_by:fv('oaBy')}).then(()=>{ logEvent(e.tenant,'estimate','Proposal '+estNo(e)+' accepted'+(e.accepted_by?' by '+e.accepted_by:'')); if(e.lead_id){ const l=OF.leads.find(x=>x.id===e.lead_id); if(l&&l.stage!=='won') ofUpdate('fs_leads',l,{stage:'proposal'}).catch(()=>{}); } vEstimate(m,id); }).catch(ofErr); }});
  if(b('oeDec')) b('oeDec').onclick=()=>openDrawer({kicker:estNo(e),title:'Declined',saveLabel:'Declined',body:field('Why','odWhy','',{ph:'price, timing, stayed put…'}),save:()=>{ ofUpdate('fs_estimates',e,{status:'declined',notes:[e.notes,fv('odWhy')?'Declined: '+fv('odWhy'):''].filter(Boolean).join('\n')}).then(()=>{ logEvent(e.tenant,'estimate','Proposal '+estNo(e)+' declined'); vEstimate(m,id); }).catch(ofErr); }});
  if(b('oeConv')) b('oeConv').onclick=()=>convertDrawer(e);
  if(b('oeOpenT')) b('oeOpenT').onclick=x=>{ x.preventDefault(); openClient(e.tenant); };
  if(b('oeLead')) b('oeLead').onclick=x=>{ x.preventDefault(); leadDrawer(lead); };
  if(b('oeCt')) b('oeCt').onclick=x=>{ x.preventDefault(); ofGo('contract',ct.id); };
  if(b('oeInv')) b('oeInv').onclick=x=>{ x.preventDefault(); ofGo('invoice',inv.id); };
}
/* accepted → a contract from the recurring lines and an invoice from the one-time lines */
function convertDrawer(e){
  const s=estSplit(e), T=(PS.tenants||[]).filter(x=>x.status!=='inactive');
  const mods=[...new Set(s.recurring.map(it=>{ const c=OF.catalog.find(x=>x.id===it.catalog_id); return c&&c.module; }).filter(Boolean))];
  openDrawer({kicker:estNo(e),title:'Subscribe '+e.company,wide:true,saveLabel:'Subscribe',
    body:field('Their hub (the client)','ocT',e.tenant||'',{type:'select',options:[['','— choose the club —']].concat(T.map(x=>[x.slug,x.name+' · '+STATUS_LABEL[x.status]]))})+'<p class="hint">The subscription belongs to a club with a hub. Not in the list? Set it up as a client (or a trial hub) from the lead first.</p>'+
      (s.recurring.length?`<div class="fld" style="margin-top:6px"><span class="lbl">Subscription · ${ofMoney(s.monthly)}/mo${mods.length?' · switches on '+mods.map(moduleName).join(', '):''}</span>${pair(field('Starts','ocStart',ofToday(),{type:'date'}),field('Billing day of the month','ocDay',1,{type:'number'}))}${pair(field('Frequency','ocFreq',e.billing==='year'?'annual':'monthly',{type:'select',options:FREQ}),field('Billed','ocTiming','advance',{type:'select',options:[['advance','In advance'],['arrears','In arrears']]}))}${pair(field('Payment terms, Net days','ocTerms',(ofSettings().billing||{}).terms_days??30,{type:'number'}),field('Price rise per year, %','ocEsc','',{type:'number',ph:'0'}))}<label class="check"><input type="checkbox" id="ocActive" checked>Activate now — the hub gets the modules, billing starts on its cycle, a trial hub becomes a client</label></div>`:'<p class="hint">No subscription lines — no contract.</p>')+
      (s.onetime.length?`<div class="fld" style="margin-top:6px"><span class="lbl">First invoice · ${ofMoney(s.once)} of set-up and training (${s.onetime.length} line${s.onetime.length===1?'':'s'})</span>${pair(field('Issued','ocInvOn',ofToday(),{type:'date'}),field('Due, Net days','ocInvTerms',(ofSettings().billing||{}).terms_days??30,{type:'number'}))}</div>`:'<p class="hint">No set-up or training lines — no first invoice.</p>'),
    save:()=>{ const slug=fv('ocT'); if(!slug){ toast('Choose the client'); return false; } const t=tenantOf(slug);
      (async()=>{ try{ const patch={status:'converted',tenant:slug}; let ct=null, inv=null;
          if(s.recurring.length){ const items=s.recurring.map(it=>({id:uid(),catalog_id:it.catalog_id||null,descr:it.descr,detail:it.detail||'',qty:it.qty,unit_price:it.every==='year'?it.unit_price:it.unit_price,discount_pct:it.discount_pct||0,taxable:!!it.taxable,every:it.every}));
            // a yearly line on a monthly contract is billed as one twelfth each cycle; the contract's own frequency decides the cycle
            const freq=fv('ocFreq'), per=freqMonths(freq); items.forEach(it=>{ if(it.every==='year'&&per<12) it.unit_price=ofN(it.unit_price*per/12); else if(it.every!=='year'&&per>1) it.unit_price=ofN(it.unit_price*per); delete it.every; });
            ct={id:uid(),number:await nextNo('contract'),tenant:slug,estimate_id:e.id,title:e.title||(mods.length?mods.map(moduleName).join(' + '):'Flagstick subscription'),status:$('ocActive').checked?'active':'draft',start_on:fv('ocStart')||ofToday(),end_on:null,billing_day:Math.min(28,Math.max(1,parseInt(fv('ocDay'))||1)),frequency:freq,timing:fv('ocTiming')||'advance',lead_days:0,terms_days:parseInt(fv('ocTerms'))||0,auto_renew:true,escalator_pct:ofN(fv('ocEsc')),discount_pct:ofN(e.discount_pct),items,last_period:null,notes:''};
            await ofInsert('fs_contracts',OF.contracts,ct); patch.contract_id=ct.id; logEvent(slug,'contract','Contract '+ctNo(ct)+' from estimate '+estNo(e)+' · '+ofMoney(ctMonthly(ct))+'/mo'); }
          if(s.onetime.length){ const items=s.onetime.map(it=>({id:uid(),catalog_id:it.catalog_id||null,descr:it.descr,detail:it.detail||'',qty:it.qty,unit_price:it.unit_price,discount_pct:it.discount_pct||0,taxable:!!it.taxable})); const tot=docTotals(items,e.discount_pct), issued=fv('ocInvOn')||ofToday(), terms=parseInt(fv('ocInvTerms'))||0;
            inv={id:uid(),number:await nextNo('invoice'),tenant:slug,company:t?t.name:e.company,contract_id:null,estimate_id:e.id,period:null,status:'draft',issued_on:issued,due_on:ofAddDays(issued,terms),terms_days:terms,discount_pct:ofN(e.discount_pct),items,subtotal:tot.subtotal,discount:tot.discount,tax:tot.tax,total:tot.total,paid:0,notes:'Set-up and training · proposal '+estNo(e)+(e.title?' · '+e.title:'')};
            await ofInsert('fs_invoices',OF.invoices,inv); patch.invoice_id=inv.id; logEvent(slug,'invoice','Invoice '+invNo(inv)+' (set-up and training) from proposal '+estNo(e)+' · '+ofMoney(inv.total)); }
          await ofUpdate('fs_estimates',e,patch);
          if(e.lead_id){ const l=OF.leads.find(x=>x.id===e.lead_id); if(l) await ofUpdate('fs_leads',l,{tenant:slug,stage:'won',won_at:l.won_at||new Date().toISOString()}).catch(()=>{}); }
          if(ct&&ct.status==='active'){ await applySubscription(ct); await ofRunBilling({quiet:true}); }
          toast('Subscribed'); if(ct) ofGo('contract',ct.id); else if(inv) ofGo('invoice',inv.id); else vPortal($('main')); }catch(x){ ofErr(x); } })(); }});
}

/* the subscription is the club's modules: an active contract switches them on in tenants (plan, modules, dates, status) */
const ctModules=c=>[...new Set((c.items||[]).map(it=>{ const cat=it.catalog_id?OF.catalog.find(x=>x.id===it.catalog_id):null; return cat&&cat.module; }).filter(Boolean))];
async function applySubscription(c){
  const t=tenantOf(c.tenant), mods=ctModules(c); if(!t||!mods.length) return null;
  const m=Object.assign({},t.modules||{},{golf:true}); mods.forEach(k=>{ m[k]=true; if(k==='club'){ m.pos=true; m.billing=true; } });
  const start=c.start_on||ofToday(), a=new Date(start+'T12:00:00Z'); a.setUTCFullYear(a.getUTCFullYear()+1);
  const rec={modules:m,plan:m.club?'club':'golf',started_on:t.started_on||start,renews_on:isoOf(a),updated_at:new Date().toISOString()}; if(t.status==='prospect'||t.status==='trial'||t.status==='suspended') { rec.status='active'; rec.ended_on=null; }
  const {error}=await sb.from('tenants').update(rec).eq('slug',t.slug); if(error) throw error; Object.assign(t,rec);
  logEvent(t.slug,'modules','Subscription '+ctNo(c)+' active: '+mods.map(moduleName).join(', ')+' on · renews '+fdate(rec.renews_on)+' — the hub picks it up on its next load'); return mods;
}
async function pauseHub(slug,why){ const t=tenantOf(slug); if(!t) return; const rec={status:'suspended',ended_on:ofToday(),updated_at:new Date().toISOString()}; const {error}=await sb.from('tenants').update(rec).eq('slug',slug); if(error) throw error; Object.assign(t,rec); logEvent(slug,'status','Status → Suspended — '+why+' (the hub shows the paused notice)'); }
/* ----- Contracts ----- */
function vContracts(m){
  const q=OF.q.trim().toLowerCase(), segs=[['active','Active'],['draft','Draft'],['paused','Paused'],['ended','Ended'],['all','All']];
  const L=OF.contracts.filter(c=>OF.cseg==='all'||c.status===OF.cseg).filter(c=>ofHit(q,tenantName(c.tenant),c.title,ctNo(c)));
  const act=OF.contracts.filter(c=>c.status==='active'), mrr=act.reduce((a,c)=>a+ctMonthly(c),0), due=OF.contracts.map(c=>[c,billableNow(c)]).filter(x=>x[1]);
  const soon=act.map(c=>nextCycle(c)).filter(cy=>cy&&cy.invoiceDate.getTime()-Date.now()<30*DAY_MS);
  const mode=(ofSettings().billing||{}).mode||'auto';
  const cols='90px minmax(0,1.6fr) minmax(0,1.2fr) 110px 120px 130px 100px 32px';
  const row=c=>{ const nx=c.status==='active'?nextCycle(c):null; return `<div class="tr click" data-ct="${esc(c.id)}" style="grid-template-columns:${cols}"><span style="font-weight:600;font-size:12.5px;color:var(--navy)">${esc(ctNo(c))}</span><div class="cell2"><b>${esc(tenantName(c.tenant))}</b><small>${esc(c.title||'')}</small></div><span class="muted" style="font-size:13px">${(ctModules(c).length?ctModules(c).map(moduleName):(c.items||[]).map(it=>it.descr)).map(esc).join(', ')}</span><span class="num">${ofMoney(ctMonthly(c))}/mo</span><span class="muted" style="font-size:12.5px">${esc(FREQ_LABEL[c.frequency]||'')} · day ${esc(c.billing_day)}</span><span class="muted" style="font-size:12.5px">${nx?fdate(isoOf(nx.invoiceDate))+'<br><small>'+esc(nx.label)+'</small>':c.status==='ended'?'—':''}</span><span>${ctChip(c.status)}</span><span class="ib">${I.chev}</span></div>`; };
  const drow=([c,cy])=>`<div class="tr" style="grid-template-columns:minmax(0,1.5fr) minmax(0,1fr) 110px 130px 120px;min-height:44px"><div class="cell2"><b>${esc(tenantName(c.tenant))}</b><small>${esc(ctNo(c))} · ${esc(c.title||'')}</small></div><span class="muted" style="font-size:13px">${esc(cy.label)}</span><span class="num">${ofMoney(ctPerCycle(c)*cy.factor)}</span><span class="muted" style="font-size:12.5px">invoice ${fdate(isoOf(cy.invoiceDate))}</span><span><button class="btn sm" data-gen="${esc(c.id)}">Generate</button></span></div>`;
  m.innerHTML=head('Contracts','Each club’s subscription — the modules it has, what it pays, on what day and how often. Invoices come out of these on their own; a trial hub becomes a client the day its subscription is activated.',btn('Run billing','ofRun','')+btn('New contract','ofNewCt','pri',I.plus))+
    `<div class="grid g4" style="margin-bottom:16px">${kpi('Active contracts',act.length,OF.contracts.filter(c=>c.status==='draft').length+' draft')}${kpi('MRR',ofMoney(mrr),'per month, net of discounts')}${kpi('ARR',ofMoney(mrr*12),'per year')}${kpi('Invoicing in 30 days',soon.length,ofMoney(soon.reduce((a,cy,i)=>a,0)||act.filter(c=>{ const cy=nextCycle(c); return cy&&cy.invoiceDate.getTime()-Date.now()<30*DAY_MS; }).reduce((a,c)=>a+ctPerCycle(c),0)))}</div>`+
    (due.length?ofCard(`Due to bill <span class="muted" style="font-size:13px;font-weight:400">· ${mode==='review'?'review mode — nothing goes out until you generate it':'waiting for their invoice date'}</span>`,`<div class="t">${due.map(drow).join('')}</div>`,btn('Generate all','ofGenAll','')):'')+
    `<div style="display:flex;justify-content:space-between;align-items:center;gap:12px;flex-wrap:wrap;margin:${due.length?16:0}px 0 14px"><div class="seg" id="ocSeg">${segs.map(([k,l])=>`<button type="button" data-v="${k}" class="${OF.cseg===k?'on':''}">${l}</button>`).join('')}</div><div class="search">${I.search}<input class="inp" id="ofQ" placeholder="Search contracts" value="${esc(OF.q)}" aria-label="Search contracts"></div></div>`+
    `<div class="card" style="overflow:hidden"><div class="tw"><div class="t" style="min-width:900px"><div class="tr th" style="grid-template-columns:${cols}"><span>Number</span><span>Client</span><span>Lines</span><span>Monthly</span><span>Cycle</span><span>Next invoice</span><span>Status</span><span></span></div>${L.length?L.map(row).join(''):'<div class="tr"><span class="muted">No contracts here.</span></div>'}</div></div></div>`;
  $('ofNewCt').onclick=()=>contractDrawer(null,{}); $('ofRun').onclick=()=>ofRunBilling().then(()=>vPortal(m));
  const ga=$('ofGenAll'); if(ga) ga.onclick=async()=>{ for(const [c,cy] of due){ try{ await genInvoice(c,cy); }catch(e){ ofErr(e); } } toast(due.length+' generated'); vContracts(m); };
  m.querySelectorAll('[data-gen]').forEach(b=>b.onclick=async ev=>{ ev.stopPropagation(); const c=OF.contracts.find(x=>x.id===b.dataset.gen); const cy=billableNow(c); if(!cy) return; try{ const r=await genInvoice(c,cy); toast(r.already?'Already billed':'Invoice '+invNo(r.invoice)+' generated'); vContracts(m); }catch(e){ ofErr(e); } });
  m.querySelectorAll('#ocSeg button').forEach(b=>b.onclick=()=>{ OF.cseg=b.dataset.v; vContracts(m); });
  ofWireSearch(m,'ofQ',()=>vContracts(m));
  m.querySelectorAll('[data-ct]').forEach(x=>x.onclick=()=>ofGo('contract',x.dataset.ct));
}
function contractDrawer(c,o={}){
  const T=(PS.tenants||[]).filter(x=>x.status!=='inactive'), b=ofSettings().billing||{};
  const d=c||{tenant:o.tenant||'',title:'Flagstick subscription',status:'draft',start_on:ofToday(),end_on:'',billing_day:1,frequency:'monthly',timing:'advance',lead_days:0,terms_days:b.terms_days??30,auto_renew:true,escalator_pct:0,discount_pct:0,items:[],notes:''};
  openDrawer({kicker:c?ctNo(c):'New contract',title:c?tenantName(c.tenant):'New contract',wide:true,saveLabel:c?'Save':'Create contract',
    body:pair(field('Client','ocT',d.tenant,{type:'select',options:[['','— choose —']].concat(T.map(x=>[x.slug,x.name]))}),field('Title','ocTitle',d.title))+
      pair(field('Starts','ocStart',d.start_on||'',{type:'date'}),field('Ends (blank = open-ended)','ocEnd',d.end_on||'',{type:'date'}))+
      `<div class="frow2" style="grid-template-columns:1fr 1fr 1fr">${field('Frequency','ocFreq',d.frequency,{type:'select',options:FREQ})}${field('Billing day (1–28)','ocDay',d.billing_day,{type:'number'})}${field('Billed','ocTiming',d.timing,{type:'select',options:[['advance','In advance'],['arrears','In arrears']]})}</div>`+
      `<div class="frow2" style="grid-template-columns:1fr 1fr 1fr">${field('Payment terms, Net days','ocTerms',d.terms_days,{type:'number'})}${field('Generate n days early','ocLead',d.lead_days||'',{type:'number',ph:'0'})}${field('Escalator per year, %','ocEsc',d.escalator_pct||'',{type:'number',ph:'0'})}</div>`+
      '<p class="hint">In advance bills on the billing day of the period’s first month; in arrears on the billing day after it ends. Many clubs want the year billed before the season — annual, in advance, on the 1st of the month the season opens. The price rise applies on each anniversary of the start.</p>'+
      itemsEditor(d.items,{wide:d.discount_pct||''})+'<p class="hint">Pick the modules from the catalog — activating the contract switches them on for the club’s hub. Each line is what the club pays <b>per cycle</b>: a monthly contract’s lines are monthly amounts, an annual contract’s are yearly.</p>'+
      field('Notes','ocNo',d.notes||'',{type:'textarea'}),
    wire:r=>ofWireItems(r,{}),
    del:c&&c.status==='draft'?()=>{ if(!confirm('Delete this draft contract?')) return; ofDelete('fs_contracts',OF.contracts,c).then(()=>ofGo('contracts')).catch(ofErr); }:null,
    save:()=>{ const slug=fv('ocT'); if(!slug){ toast('Choose the client'); return false; } const items=readItems($('dBody'),{}); if(!items.length){ toast('Add at least one line'); return false; }
      const rec={tenant:slug,title:fv('ocTitle'),start_on:fv('ocStart')||ofToday(),end_on:fv('ocEnd')||null,frequency:fv('ocFreq'),billing_day:Math.min(28,Math.max(1,parseInt(fv('ocDay'))||1)),timing:fv('ocTiming'),terms_days:parseInt(fv('ocTerms'))||0,lead_days:parseInt(fv('ocLead'))||0,escalator_pct:ofN(fv('ocEsc')),discount_pct:ofPct(fv('oiWide')),items,notes:fv('ocNo')};
      (async()=>{ try{ let row=c; if(c) await ofUpdate('fs_contracts',c,rec); else { rec.number=await nextNo('contract'); rec.status='draft'; rec.auto_renew=true; row=await ofInsert('fs_contracts',OF.contracts,rec); logEvent(slug,'contract','Contract '+ctNo(row)+' drafted · '+ofMoney(ctMonthly(row))+'/mo'); } toast('Saved'); ofGo('contract',row.id); }catch(x){ ofErr(x); } })(); }});
}
function vContract(m,id){
  const c=OF.contracts.find(x=>x.id===id); if(!c) return vContracts(m);
  const t=tenantOf(c.tenant), invs=OF.invoices.filter(i=>i.contract_id===c.id).sort((a,b)=>(b.period||'').localeCompare(a.period||'')||new Date(b.created_at)-new Date(a.created_at)), nx=c.status==='active'?nextCycle(c):null, due=billableNow(c), est=c.estimate_id?OF.estimates.find(e=>e.id===c.estimate_id):null;
  const cols='minmax(0,1.6fr) 40px 86px 56px 92px';
  const row=it=>`<div class="tr" style="grid-template-columns:${cols};min-height:44px"><div class="cell2"><b style="font-weight:600">${esc(it.descr)}</b>${it.detail?`<small>${esc(it.detail)}</small>`:''}</div><span class="num muted">${esc(it.qty)}</span><span class="num">${ofMoney(it.unit_price)}</span><span class="num muted">${effPct(it,c.discount_pct)?'−'+effPct(it,c.discount_pct)+'%':''}</span><span class="num">${ofMoney(lineNet(it,c.discount_pct))}</span></div>`;
  const irow=i=>`<div class="tr click" data-inv="${esc(i.id)}" style="grid-template-columns:84px minmax(0,1fr) 92px 90px 28px;min-height:44px"><span style="font-weight:600;font-size:12.5px;color:var(--navy)">${esc(invNo(i))}</span><div class="cell2"><span style="font-size:13px">${esc(i.items&&i.items[0]&&i.items[0].detail?i.items[0].detail.split(' · ').pop():i.period||'')}</span><small>${fdate(i.issued_on)}</small></div><span class="num">${ofMoney(i.total)}</span><span>${invChip(i)}</span><span class="ib">${I.chev}</span></div>`;
  m.innerHTML=`<div class="phead"><div>${ofBack('Contracts','contracts')}<h1 class="h1">${esc(ctNo(c))} · ${esc(t?t.name:c.tenant)}</h1><p class="sub">${esc(c.title||'')} · ${ctChip(c.status)} · ${esc(FREQ_LABEL[c.frequency])}, ${c.timing==='arrears'?'in arrears':'in advance'} on day ${esc(c.billing_day)} · Net ${esc(c.terms_days)} · from ${fdate(c.start_on)}${c.end_on?' to '+fdate(c.end_on):''}</p></div>
      <div class="actions">${btn('Open client','ocOpenT','')}${c.status==='active'?btn('Run next invoice','ocRunNext',''):''}${c.status==='draft'||c.status==='paused'?btn('Activate','ocAct','pri'):''}${c.status==='active'?btn('Pause','ocPause',''):''}${c.status!=='ended'?btn('End','ocEnd',''):''}${btn('Edit','ocEdit','',I.edit)}</div></div><div class="rule"></div>
    <div class="grid g2" style="align-items:start">
      ${ofCard('The lines <span class="muted" style="font-size:13px;font-weight:400">· per cycle</span>',`<div class="t fit"><div class="tr th" style="grid-template-columns:${cols}"><span>Item</span><span>Qty</span><span>Unit</span><span>Disc.</span><span>Amount</span></div>${(c.items||[]).map(row).join('')}<div class="tr tot" style="grid-template-columns:${cols};min-height:44px"><span>Per cycle${c.escalator_pct?' · +'+c.escalator_pct+'% a year':''}</span><span></span><span></span><span></span><span class="num">${ofMoney(ctPerCycle(c))}</span></div></div><div style="padding:12px 22px 18px"><span class="muted" style="font-size:13px">${ofMoney(ctMonthly(c))} per month · ${ofMoney(ctMonthly(c)*12)} per year</span></div>`)}
      <div class="stack">${ofCard('Billing',`<div style="padding:0 22px 18px">${ofKV('Next invoice',nx?fdate(isoOf(nx.invoiceDate))+' <span class="muted">· '+esc(nx.label)+(nx.factor>1?' · ×'+nx.factor.toFixed(3):'')+'</span>':c.status==='active'?'<span class="muted">nothing further (past the end date)</span>':'')}${ofKV('Modules',ctModules(c).length?ctModules(c).map(k=>`<span class="chip gold">${esc(moduleName(k))}</span>`).join(' ')+(t?' <span class="muted" style="font-size:12.5px">· the hub has '+esc(MODULE_CATALOG.filter(x=>modulesOf(t)[x.id]&&!x.base).map(x=>x.name).join(', ')||'golf management only')+'</span>':''):'<span class="muted">no module lines — the hub’s modules are set by hand</span>')}${ofKV('Hub',t?`<a href="${esc(tenantURL(t.slug))}" target="_blank" rel="noopener">${esc(t.slug)}.${esc(BASE_DOMAIN)}</a> · ${tStatusChip(t.status)}${t.renews_on?' · renews '+fdate(t.renews_on):''}`:'')}${ofKV('Last period billed',esc(c.last_period||''))}${ofKV('Due now',due?`<span class="chip gold">${esc(due.label)}</span> <button class="btn sm" id="ocGen">Generate</button>`:'')}${ofKV('Invoices',invs.length?invs.length+' · '+ofMoney(invs.filter(i=>i.status!=='void').reduce((a,i)=>a+(parseFloat(i.total)||0),0))+' billed · '+ofMoney(invs.reduce((a,i)=>a+(parseFloat(i.paid)||0),0))+' received':'')}${ofKV('Proposal',est?`<a href="#" id="ocEst">${esc(estNo(est))}</a>`:'')}${ofKV('Notes',esc(c.notes||'').replace(/\n/g,'<br>'))}</div>`)}
      ${ofCard('Invoices',`<div class="t fit">${invs.length?invs.map(irow).join(''):'<div class="tr"><span class="muted">None yet — the first comes on the billing day.</span></div>'}</div>`)}</div></div>`;
  wireBack(m);
  const b=id=>$(id);
  b('ocOpenT').onclick=()=>openClient(c.tenant); b('ocEdit').onclick=()=>contractDrawer(c);
  if(b('ocEst')) b('ocEst').onclick=x=>{ x.preventDefault(); ofGo('estimate',est.id); };
  const setSt=(st,extra,after)=>ofUpdate('fs_contracts',c,Object.assign({status:st},extra||{})).then(async()=>{ logEvent(c.tenant,'contract','Contract '+ctNo(c)+' → '+CT_STATUS[st]); if(st==='active'){ await applySubscription(c); await ofRunBilling({quiet:true}); } if(after) await after(); }).then(()=>vContract(m,id)).catch(ofErr);
  if(b('ocAct')) b('ocAct').onclick=()=>setSt('active');
  if(b('ocPause')) b('ocPause').onclick=()=>openDrawer({kicker:ctNo(c),title:'Pause the subscription',saveLabel:'Pause',body:'<p style="margin:0 0 10px">No invoices come out until it is activated again.</p><label class="check"><input type="checkbox" id="opHub">Pause the club’s hub too (the paused notice, data kept)</label>'+field('Why','opWhy','',{ph:'non-payment, off-season, on hold'}),save:()=>{ const hub=$('opHub').checked, why=fv('opWhy'); setSt('paused',null,hub?()=>pauseHub(c.tenant,why||'subscription paused'):null); }});
  if(b('ocEnd')) b('ocEnd').onclick=()=>openDrawer({kicker:ctNo(c),title:'End the subscription',saveLabel:'End it',body:field('Last day of service','oeEndOn',ofToday(),{type:'date'})+'<p class="hint">Periods starting after that day are never billed.</p><label class="check"><input type="checkbox" id="oeInact">Mark the club inactive on that day (a former client; the hub shows the paused notice)</label>',save:()=>{ const end=fv('oeEndOn')||ofToday(), inact=$('oeInact').checked; setSt('ended',{end_on:end},inact?async()=>{ const t=tenantOf(c.tenant); if(!t) return; const rec={status:'inactive',ended_on:end,updated_at:new Date().toISOString()}; const {error}=await sb.from('tenants').update(rec).eq('slug',t.slug); if(error) throw error; Object.assign(t,rec); logEvent(t.slug,'status','Status → Inactive — subscription '+ctNo(c)+' ended'); }:null); }});
  if(b('ocRunNext')) b('ocRunNext').onclick=async()=>{ const cy=billableNow(c)||nextCycle(c); if(!cy){ toast('Nothing further to bill'); return; } if(!confirm('Generate the invoice for '+cy.label+' now ('+ofMoney(ctPerCycle(c)*cy.factor)+')?')) return; try{ const r=await genInvoice(c,cy); toast(r.already?'Already billed':'Invoice '+invNo(r.invoice)+' generated'); vContract(m,id); }catch(e){ ofErr(e); } };
  if(b('ocGen')) b('ocGen').onclick=async()=>{ try{ const r=await genInvoice(c,due); toast(r.already?'Already billed':'Invoice '+invNo(r.invoice)+' generated'); vContract(m,id); }catch(e){ ofErr(e); } };
  m.querySelectorAll('[data-inv]').forEach(x=>x.onclick=()=>ofGo('invoice',x.dataset.inv));
}

/* ----- Invoices ----- */
function vInvoices(m){
  const q=OF.q.trim().toLowerCase(), segs=[['open','Open'],['overdue','Overdue'],['paid','Paid'],['draft','Draft'],['void','Void'],['all','All']];
  const inSeg=i=>OF.iseg==='all'||(OF.iseg==='open'?(i.status==='sent'||i.status==='partial'):OF.iseg==='overdue'?invOverdue(i):i.status===OF.iseg);
  const L=OF.invoices.filter(inSeg).filter(i=>ofHit(q,i.company,tenantName(i.tenant),invNo(i),i.period,i.notes)).sort((a,b)=>(b.issued_on||'').localeCompare(a.issued_on||'')||(b.number||0)-(a.number||0));
  const open=OF.invoices.filter(i=>i.status==='sent'||i.status==='partial'), od=open.filter(invOverdue), ym=ofToday().slice(0,7), rec=OF.payments.filter(p=>String(p.paid_on||'').startsWith(ym));
  const cols='100px minmax(0,1.6fr) minmax(0,1fr) 100px 100px 110px 110px 32px';
  const row=i=>`<div class="tr click" data-inv="${esc(i.id)}" style="grid-template-columns:${cols}"><span style="font-weight:600;font-size:12.5px;color:var(--navy)">${esc(invNo(i))}</span><div class="cell2"><b>${esc(i.company||tenantName(i.tenant))}</b><small>${esc(i.notes||'')}</small></div><span class="muted" style="font-size:13px">${esc(i.items&&i.items[0]?i.items[0].descr+(i.items.length>1?' +'+(i.items.length-1):''):'')}</span><span class="muted" style="font-size:12.5px">${fdate(i.issued_on)}</span><span class="muted" style="font-size:12.5px">${i.due_on?fdate(i.due_on):''}</span><span class="num">${ofMoney(i.total)}${invBalance(i)>0&&i.status!=='void'&&i.status!=='draft'&&invBalance(i)!==ofN(i.total)?`<br><small class="muted">${ofMoney(invBalance(i))} open</small>`:''}</span><span>${invChip(i)}</span><span class="ib">${I.chev}</span></div>`;
  m.innerHTML=head('Invoices','What Flagstick has billed its clubs: the subscriptions on their cycle, set-up and training from a proposal, or written by hand.',btn('Run billing','ofRun','')+btn('New invoice','ofNewInv','pri',I.plus))+
    `<div class="grid g4" style="margin-bottom:16px">${kpi('Outstanding',ofMoney(open.reduce((a,i)=>a+invBalance(i),0)),open.length+' open invoice'+(open.length===1?'':'s'))}${kpi('Overdue',ofMoney(od.reduce((a,i)=>a+invBalance(i),0)),od.length?od.length+' past due':'nothing past due','neg')}${kpi('Received this month',ofMoney(rec.reduce((a,p)=>a+(parseFloat(p.amount)||0),0)),rec.length+' payment'+(rec.length===1?'':'s'))}${kpi('Drafts',OF.invoices.filter(i=>i.status==='draft').length,'not sent yet')}</div>`+
    `<div style="display:flex;justify-content:space-between;align-items:center;gap:12px;flex-wrap:wrap;margin-bottom:14px"><div class="seg" id="oiSeg">${segs.map(([k,l])=>`<button type="button" data-v="${k}" class="${OF.iseg===k?'on':''}">${l}</button>`).join('')}</div><div class="search">${I.search}<input class="inp" id="ofQ" placeholder="Search invoices" value="${esc(OF.q)}" aria-label="Search invoices"></div></div>`+
    `<div class="card" style="overflow:hidden"><div class="tw"><div class="t" style="min-width:900px"><div class="tr th" style="grid-template-columns:${cols}"><span>Number</span><span>Client</span><span>Lines</span><span>Issued</span><span>Due</span><span>Total</span><span>Status</span><span></span></div>${L.length?L.map(row).join(''):'<div class="tr"><span class="muted">No invoices here.</span></div>'}</div></div></div>`;
  $('ofNewInv').onclick=()=>invoiceDrawer(null,{}); $('ofRun').onclick=()=>ofRunBilling().then(()=>vPortal(m));
  m.querySelectorAll('#oiSeg button').forEach(b=>b.onclick=()=>{ OF.iseg=b.dataset.v; vInvoices(m); });
  ofWireSearch(m,'ofQ',()=>vInvoices(m));
  m.querySelectorAll('[data-inv]').forEach(x=>x.onclick=()=>ofGo('invoice',x.dataset.inv));
}
function invoiceDrawer(i,o={}){
  const T=(PS.tenants||[]).filter(x=>x.status!=='inactive'), b=ofSettings().billing||{};
  const d=i||{tenant:o.tenant||'',company:o.tenant?tenantName(o.tenant):'',issued_on:ofToday(),terms_days:b.terms_days??30,items:[],discount_pct:0,notes:''};
  openDrawer({kicker:i?invNo(i):'New invoice',title:i?i.company:'New invoice',wide:true,saveLabel:i?'Save':'Create invoice',
    body:pair(field('Client','oiT',d.tenant||'',{type:'select',options:[['','— not a client —']].concat(T.map(x=>[x.slug,x.name]))}),field('Bill to (name on the invoice)','oiC',d.company))+
      pair(field('Issued','oiI',d.issued_on||'',{type:'date'}),field('Payment terms, Net days','oiTerms',d.terms_days,{type:'number'}))+
      itemsEditor(d.items,{wide:d.discount_pct||''})+field('Note on the invoice','oiNo',d.notes||'',{type:'textarea'}),
    wire:r=>{ ofWireItems(r,{}); const ts=r.querySelector('#oiT'); ts.onchange=()=>{ const x=tenantOf(ts.value); if(x) r.querySelector('#oiC').value=x.name; }; },
    del:i&&i.status==='draft'?()=>{ if(!confirm('Delete this draft invoice?')) return; ofDelete('fs_invoices',OF.invoices,i).then(()=>ofGo('invoices')).catch(ofErr); }:null,
    save:()=>{ const items=readItems($('dBody'),{}); if(!items.length){ toast('Add at least one line'); return false; } const company=fv('oiC')||tenantName(fv('oiT')); if(!company){ toast('Who is it to?'); return false; }
      const wide=ofPct(fv('oiWide')), tot=docTotals(items,wide), issued=fv('oiI')||ofToday(), terms=parseInt(fv('oiTerms'))||0;
      const rec={tenant:fv('oiT')||null,company,issued_on:issued,terms_days:terms,due_on:ofAddDays(issued,terms),items,discount_pct:wide,subtotal:tot.subtotal,discount:tot.discount,tax:tot.tax,total:tot.total,notes:fv('oiNo')};
      (async()=>{ try{ let row=i; if(i){ await ofUpdate('fs_invoices',i,rec); } else { rec.number=await nextNo('invoice'); rec.status='draft'; rec.paid=0; row=await ofInsert('fs_invoices',OF.invoices,rec); logEvent(rec.tenant,'invoice','Invoice '+invNo(row)+' drafted for '+company+' · '+ofMoney(row.total)); } toast('Saved'); ofGo('invoice',row.id); }catch(x){ ofErr(x); } })(); }});
}
function invPaidStatus(i){ const bal=invBalance(i); return bal<=0.004?'paid':(parseFloat(i.paid)||0)>0.004?'partial':(i.status==='draft'?'draft':'sent'); }
function vInvoice(m,id){
  const i=OF.invoices.find(x=>x.id===id); if(!i) return vInvoices(m);
  const t=i.tenant?tenantOf(i.tenant):null, pays=OF.payments.filter(p=>p.invoice_id===i.id).sort((a,b)=>(b.paid_on||'').localeCompare(a.paid_on||'')), ct=i.contract_id?OF.contracts.find(c=>c.id===i.contract_id):null, est=i.estimate_id?OF.estimates.find(e=>e.id===i.estimate_id):null;
  const cols='minmax(0,1.6fr) 40px 86px 56px 92px', bal=invBalance(i), live=i.status!=='void';
  const row=it=>`<div class="tr" style="grid-template-columns:${cols};min-height:44px"><div class="cell2"><b style="font-weight:600">${esc(it.descr)}</b>${it.detail?`<small>${esc(it.detail)}</small>`:''}</div><span class="num muted">${esc(it.qty)}</span><span class="num">${ofMoney(it.unit_price)}</span><span class="num muted">${effPct(it,i.discount_pct)?'−'+effPct(it,i.discount_pct)+'%':''}</span><span class="num">${ofMoney(lineNet(it,i.discount_pct))}</span></div>`;
  const prow=p=>`<div class="tr" style="grid-template-columns:110px minmax(0,1fr) 110px 32px;min-height:44px"><span class="muted" style="font-size:12.5px">${fdate(p.paid_on)}</span><span style="font-size:13px">${esc((OF_METHODS.find(x=>x[0]===p.method)||[])[1]||p.method)}${p.reference?' · '+esc(p.reference):''}${p.note?' <span class="muted">· '+esc(p.note)+'</span>':''}</span><span class="num">${ofMoney(p.amount)}</span><span><button class="ib" data-rmp="${esc(p.id)}" aria-label="Remove payment">${I.trash}</button></span></div>`;
  const addr=t?addrLine(t.address):[];
  m.innerHTML=`<div class="phead"><div>${ofBack('Invoices','invoices')}<h1 class="h1">${esc(invNo(i))} · ${esc(i.company||tenantName(i.tenant))}</h1><p class="sub">${invChip(i)} · issued ${fdate(i.issued_on)}${i.due_on?' · due '+fdate(i.due_on)+' (Net '+esc(i.terms_days)+')':''}${i.sent_at?' · sent '+fwhen(i.sent_at)+(i.sent_to?' to '+esc(i.sent_to):''):''}${i.void_at?' · voided '+fdate(i.void_at)+(i.void_reason?' — '+esc(i.void_reason):''):''}</p></div>
      <div class="actions">${btn('PDF','oiPDF','')}${live?btn(i.sent_at?'Send again':'Send','oiSend',i.status==='draft'?'pri':''):''}${live&&i.status!=='paid'?btn('Record payment','oiPay',i.status==='draft'?'':'pri'):''}${i.status==='draft'?btn('Edit','oiEdit','',I.edit):''}${live&&i.status!=='draft'?btn('Void','oiVoid',''):''}${invOverdue(i)&&t&&t.status==='active'?btn('Pause the hub','oiPauseHub',''):''}</div></div><div class="rule"></div>
    <div class="grid g2" style="align-items:start">
      ${ofCard('The invoice',`<div class="t fit"><div class="tr th" style="grid-template-columns:${cols}"><span>Item</span><span>Qty</span><span>Unit</span><span>Disc.</span><span>Amount</span></div>${(i.items||[]).map(row).join('')}
        <div class="tr" style="grid-template-columns:${cols};min-height:36px"><span class="muted">Subtotal</span><span></span><span></span><span></span><span class="num">${ofMoney(i.subtotal)}</span></div>${parseFloat(i.discount)?`<div class="tr" style="grid-template-columns:${cols};min-height:36px"><span class="muted">Discount</span><span></span><span></span><span></span><span class="num">−${ofMoney(i.discount)}</span></div>`:''}${parseFloat(i.tax)?`<div class="tr" style="grid-template-columns:${cols};min-height:36px"><span class="muted">Tax</span><span></span><span></span><span></span><span class="num">${ofMoney(i.tax)}</span></div>`:''}
        <div class="tr tot" style="grid-template-columns:${cols};min-height:44px"><span>Total</span><span></span><span></span><span></span><span class="num">${ofMoney(i.total)}</span></div>${parseFloat(i.paid)?`<div class="tr" style="grid-template-columns:${cols};min-height:36px"><span class="muted">Paid</span><span></span><span></span><span></span><span class="num">−${ofMoney(i.paid)}</span></div><div class="tr tot" style="grid-template-columns:${cols};min-height:44px"><span>Balance due</span><span></span><span></span><span></span><span class="num ${bal>0?'neg':''}">${ofMoney(bal)}</span></div>`:''}</div>${i.notes?`<div style="padding:12px 22px 18px;font-size:13.5px;white-space:pre-wrap">${esc(i.notes)}</div>`:''}`)}
      <div class="stack">${ofCard('Bill to',`<div style="padding:0 22px 18px">${ofKV('Club',t?`<a href="#" id="oiOpenT">${esc(t.name)}</a> <span class="muted">· ${esc(t.slug)}.${esc(BASE_DOMAIN)} · ${esc(STATUS_LABEL[t.status]||'')}</span>`:esc(i.company))}${ofKV('Address',addr.length?addr.map(esc).join('<br>'):'')}${ofKV('Billing e-mail',t&&t.billing_email?`<a href="mailto:${esc(t.billing_email)}">${esc(t.billing_email)}</a>`:'')}${ofKV('Service period',i.period_start?fdate(i.period_start)+' – '+fdate(i.period_end):'')}${ofKV('Contract',ct?`<a href="#" id="oiCt">${esc(ctNo(ct))} · ${esc(ct.title||'')}</a>`:'')}${ofKV('Proposal',est?`<a href="#" id="oiEst">${esc(estNo(est))}</a>`:'')}</div>`)}
      ${ofCard('Payments',`<div class="t fit">${pays.length?pays.map(prow).join(''):'<div class="tr"><span class="muted">Nothing received yet.</span></div>'}</div>`,live&&i.status!=='paid'?btn('Record payment','oiPay2','',I.plus):'')}</div></div>`;
  wireBack(m);
  const b=id=>$(id);
  b('oiPDF').onclick=()=>invoicePDF(i).then(doc=>doc.save(invNo(i)+'-'+(i.company||'').replace(/[^\w]+/g,'-')+'.pdf')).catch(ofErr);
  if(b('oiEdit')) b('oiEdit').onclick=()=>invoiceDrawer(i);
  if(b('oiSend')) b('oiSend').onclick=()=>sendInvoice(i).then(()=>vInvoice(m,id)).catch(ofErr);
  const pay=()=>paymentDrawer(i,()=>vInvoice(m,id)); if(b('oiPay')) b('oiPay').onclick=pay; if(b('oiPay2')) b('oiPay2').onclick=pay;
  if(b('oiVoid')) b('oiVoid').onclick=()=>openDrawer({kicker:invNo(i),title:'Void the invoice',saveLabel:'Void it',body:field('Why','ovWhy','',{ph:'duplicate, re-billed, cancelled…'})+'<p class="hint">A void stays on the list; the period can be billed again.</p>',save:()=>{ const why=fv('ovWhy'); if(!why){ toast('Say why'); return false; } ofUpdate('fs_invoices',i,{status:'void',void_at:new Date().toISOString(),void_reason:why}).then(()=>{ logEvent(i.tenant,'invoice','Invoice '+invNo(i)+' voided — '+why); vInvoice(m,id); }).catch(ofErr); }});
  if(b('oiOpenT')) b('oiOpenT').onclick=x=>{ x.preventDefault(); openClient(i.tenant); };
  if(b('oiPauseHub')) b('oiPauseHub').onclick=()=>{ if(!confirm('Pause '+t.name+'’s hub for non-payment? Everyone there sees the paused notice until it is reactivated (Status on the client record, or activating the subscription). Data is kept.')) return; pauseHub(t.slug,'non-payment · '+invNo(i)+' overdue').then(()=>{ toast('Hub paused'); vInvoice(m,id); }).catch(ofErr); };
  if(b('oiCt')) b('oiCt').onclick=x=>{ x.preventDefault(); ofGo('contract',ct.id); };
  if(b('oiEst')) b('oiEst').onclick=x=>{ x.preventDefault(); ofGo('estimate',est.id); };
  m.querySelectorAll('[data-rmp]').forEach(x=>x.onclick=async()=>{ const p=OF.payments.find(y=>y.id===x.dataset.rmp); if(!p||!confirm('Remove this payment of '+ofMoney(p.amount)+'?')) return; try{ await ofDelete('fs_payments',OF.payments,p); await recalcPaid(i); vInvoice(m,id); }catch(e){ ofErr(e); } });
}
async function recalcPaid(i){ const paid=ofN(OF.payments.filter(p=>p.invoice_id===i.id).reduce((a,p)=>a+(parseFloat(p.amount)||0),0)); const st=i.status==='void'?'void':i.status==='draft'&&paid<=0?'draft':invPaidStatus(Object.assign({},i,{paid})); await ofUpdate('fs_invoices',i,{paid,status:st,paid_at:st==='paid'?(i.paid_at||new Date().toISOString()):null}); }
function paymentDrawer(i,done){
  openDrawer({kicker:invNo(i),title:'Record a payment',saveLabel:'Record',
    body:pair(field('Amount','opA',invBalance(i)>0?invBalance(i).toFixed(2):'',{type:'number'}),field('Received on','opOn',ofToday(),{type:'date'}))+pair(field('Method','opM','check',{type:'select',options:OF_METHODS}),field('Reference','opR','',{ph:'check number, transaction id'}))+field('Note','opN',''),
    save:()=>{ const amount=ofN(fv('opA')); if(!(amount>0)){ toast('Enter the amount'); return false; }
      (async()=>{ try{ await ofInsert('fs_payments',OF.payments,{invoice_id:i.id,tenant:i.tenant,amount,method:fv('opM'),reference:fv('opR'),paid_on:fv('opOn')||ofToday(),note:fv('opN'),by:ofWho()}); await recalcPaid(i); logEvent(i.tenant,'payment','Payment '+ofMoney(amount)+' on '+invNo(i)+' ('+fv('opM')+(fv('opR')?' '+fv('opR'):'')+')'+(i.status==='paid'?' — paid in full':'')); toast('Recorded'); done&&done(); }catch(e){ ofErr(e); } })(); }});
}

/* ----- e-mail ----- */
async function ofMail(msg){ if(!sb||!sb.functions) return {error:'E-mail goes out from the live site'}; try{ const {data,error}=await sb.functions.invoke('mail',{body:Object.assign({tenant:'',org:'club'},msg)}); if(error) return {error:error.message||'failed'}; return data||{error:'no reply'}; }catch(e){ return {error:e.message||'failed'}; } }
function remitTo(){ const c=ofSettings().company||{}; return {name:c.name||'Flagstick',lines:[c.line1,c.line2,[c.city,c.state].filter(Boolean).join(', ')+(c.zip?' '+c.zip:''),c.email,c.phone].map(x=>String(x||'').trim()).filter(Boolean),pay:c.pay||'',email:c.email||''}; }
function ofMailHTML(o){ const r=remitTo(); return `<!doctype html><html><body style="margin:0;background:#F4F0E6;padding:24px 12px"><table role="presentation" width="100%" cellspacing="0" cellpadding="0"><tr><td align="center"><table role="presentation" width="560" style="max-width:560px;background:#fff;border:1px solid #E3DCC9;border-radius:12px" cellspacing="0" cellpadding="0"><tr><td style="background:#0F2A38;border-radius:12px 12px 0 0;padding:18px 24px;color:#fff;font:800 15px/1.2 -apple-system,Segoe UI,Helvetica,Arial,sans-serif;letter-spacing:.12em">FLAGSTICK <span style="color:#C7A13A;font-size:10px;letter-spacing:.18em">GOLF SOFTWARE</span></td></tr><tr><td style="padding:22px 24px 8px"><h1 style="margin:0 0 12px;font:600 22px/1.2 Georgia,serif;color:#0F2A38">${esc(o.title)}</h1>${(o.paragraphs||[]).map(p=>`<p style="margin:0 0 12px;font:15px/1.5 -apple-system,Segoe UI,Helvetica,Arial,sans-serif;color:#14222B">${p}</p>`).join('')}</td></tr><tr><td style="padding:8px 24px 22px;font:12.5px/1.5 -apple-system,Segoe UI,Helvetica,Arial,sans-serif;color:#6B6B5E;border-top:1px solid #E3DCC9">${esc(r.name)}${r.lines.length?' · '+r.lines.map(esc).join(' · '):''}</td></tr></table></td></tr></table></body></html>`; }
async function sendInvoice(i,o={}){
  const t=i.tenant?tenantOf(i.tenant):null, to=(o.to||(t&&t.billing_email)||'').trim();
  if(!to){ if(!o.quiet) openDrawer({kicker:invNo(i),title:'Send the invoice',saveLabel:'Send',body:field('To','osTo',(t&&t.billing_email)||'',{type:'email'})+'<p class="hint">The client has no billing e-mail on its record yet — add one there to send without asking.</p>',save:()=>{ const to2=fv('osTo'); if(!to2){ toast('An address is needed'); return false; } sendInvoice(i,{to:to2}).then(()=>vPortal($('main'))).catch(ofErr); }}); return; }
  const doc=await invoicePDF(i), pdf=doc.output('datauristring').split(',')[1], r=remitTo();
  const paras=[`Please find invoice <b>${esc(invNo(i))}</b> for <b>${ofMoney(i.total)}</b>${i.period_start?', covering '+esc(fdate(i.period_start))+' – '+esc(fdate(i.period_end)):''}, attached.`,`It is due ${esc(fdate(i.due_on))}.${r.pay?' '+esc(r.pay):''}`,'Thank you for running your club on Flagstick.'];
  const res=await ofMail({to,subject:'Flagstick invoice '+invNo(i)+' · '+ofMoney(i.total),text:paras.map(p=>p.replace(/<[^>]+>/g,'')).join('\n\n'),html:ofMailHTML({title:'Invoice '+invNo(i),paragraphs:paras}),attachments:[{filename:invNo(i)+'.pdf',content:pdf}]});
  if(res.error){ if(!o.quiet) toast('Not sent: '+res.error); throw new Error(res.error); }
  await ofUpdate('fs_invoices',i,{status:i.status==='draft'?'sent':i.status,sent_at:new Date().toISOString(),sent_to:to});
  logEvent(i.tenant,'invoice','Invoice '+invNo(i)+' sent to '+to); if(!o.quiet) toast('Sent to '+to);
}
async function sendEstimate(e){
  const to=(e.contact_email||'').trim(); if(!to){ toast('Add the contact’s e-mail first'); return; }
  try{ const doc=await estimatePDF(e), pdf=doc.output('datauristring').split(',')[1], s=estSplit(e);
    const paras=[`Here is Flagstick’s proposal for <b>${esc(e.company)}</b>${e.title?' — '+esc(e.title):''}: <b>${e.billing==='year'?ofMoney(s.monthly*12)+' per year':ofMoney(s.monthly)+' per month'}</b> for the subscription${s.once?', plus '+ofMoney(s.once)+' of set-up and training':''}. What is included, and what we do to get the club live, is in the attached PDF.`,e.expires_on?`It is good through ${esc(fdate(e.expires_on))}.`:'','Reply to this e-mail with any questions — we would love to have you on Flagstick.'].filter(Boolean);
    const res=await ofMail({to,subject:'Flagstick proposal '+estNo(e)+' for '+e.company,text:paras.map(p=>p.replace(/<[^>]+>/g,'')).join('\n\n'),html:ofMailHTML({title:'Proposal '+estNo(e),paragraphs:paras}),attachments:[{filename:estNo(e)+'.pdf',content:pdf}]});
    if(res.error){ toast('Not sent: '+res.error); return; }
    await ofUpdate('fs_estimates',e,{status:e.status==='draft'?'sent':e.status,sent_at:new Date().toISOString()}); logEvent(e.tenant,'estimate','Estimate '+estNo(e)+' sent to '+to); toast('Sent to '+to); vPortal($('main')); }catch(x){ ofErr(x); }
}

/* ----- PDFs (jsPDF, the brand band like the member statement) ----- */
async function ofDoc(){ await loadJsPDF(); const doc=new jspdf.jsPDF({unit:'pt',format:'letter'}); bcFonts(doc); let crest=null; try{ crest=await crestPNG(); }catch(_){} return {doc,crest}; }
function ofBand(doc,crest,title,sub){ const L=40,R2=572,W=612,H=792; doc.setFillColor(...BC_IVORY); doc.rect(0,0,W,H,'F'); doc.setFillColor(...BC_GOLD); doc.roundedRect(L,32,R2-L,82,8,8,'F'); doc.setFillColor(...BC_NAVY); doc.roundedRect(L,32,R2-L,78,8,8,'F'); doc.rect(L,32+66,R2-L,8,'F');
  const cw=drawCrest(doc,crest,L+16,42,54), TX=L+16+(cw||45)+15; doc.setFont('PublicSansXB','normal'); doc.setFontSize(6.8); doc.setTextColor(...BC_GOLDL); doc.text('FLAGSTICK · GOLF SOFTWARE',TX,56,{charSpace:1.2});
  doc.setFont('Cormorant','bold'); doc.setFontSize(24); doc.setTextColor(255,255,255); doc.text(title,TX,80); doc.setFont('PublicSans','normal'); doc.setFontSize(8.4); doc.setTextColor(214,218,220); doc.text(sub,TX,96); return {L,R2,W,H}; }
function ofBlocks(doc,L,R2,y,left,right){ const font=(f,st,z,col)=>{ doc.setFont(f,st); doc.setFontSize(z); doc.setTextColor(...col); };
  font('PublicSansXB','normal',7.4,BC_GOLDDK); doc.text(left.head,L,y,{charSpace:1.1}); doc.text(right.head,R2,y,{align:'right',charSpace:1.1}); y+=6; doc.setDrawColor(...BC_GOLD); doc.setLineWidth(1); doc.line(L,y,R2,y); y+=16;
  font('PublicSans','bold',11,BC_INK); doc.text(left.name,L,y); doc.text(right.name,R2,y,{align:'right'}); font('PublicSans','normal',8.6,BC_MUTED);
  const n=Math.max(left.lines.length,right.lines.length); for(let k=0;k<n;k++){ if(left.lines[k]) doc.text(String(left.lines[k]),L,y+14+k*11); if(right.lines[k]) doc.text(String(right.lines[k]),R2,y+14+k*11,{align:'right'}); }
  return y+14+Math.max(n,1)*11+18; }
function ofTable(doc,L,R2,y,items,wide,o={}){ const H=792, font=(f,st,z,col)=>{ doc.setFont(f,st); doc.setFontSize(z); doc.setTextColor(...col); }; const X={qty:R2-200,unit:R2-130,disc:R2-72,amt:R2};
  font('PublicSansXB','normal',7.4,BC_GOLDDK); doc.text(o.title||'LINES',L,y,{charSpace:1.1}); y+=6; doc.setDrawColor(...BC_GOLD); doc.setLineWidth(1); doc.line(L,y,R2,y); y+=12;
  font('PublicSans','bold',7.6,BC_MUTED); doc.text('DESCRIPTION',L,y); doc.text('QTY',X.qty,y,{align:'right'}); doc.text('UNIT',X.unit,y,{align:'right'}); doc.text('DISC.',X.disc,y,{align:'right'}); doc.text('AMOUNT',X.amt,y,{align:'right'}); y+=12;
  items.forEach(it=>{ if(y>H-140){ doc.addPage(); doc.setFillColor(...BC_IVORY); doc.rect(0,0,612,H,'F'); y=60; } font('PublicSans','bold',9,BC_INK); doc.text(doc.splitTextToSize(it.descr||'',X.qty-30-L)[0]||'',L,y); font('PublicSans','normal',9,BC_INK); doc.text(String(it.qty??1),X.qty,y,{align:'right'}); doc.text(ofMoney(it.unit_price)+(it.recurring?'/'+(it.every==='year'?'yr':'mo'):''),X.unit,y,{align:'right'}); doc.text(effPct(it,wide)?effPct(it,wide)+'%':'',X.disc,y,{align:'right'}); doc.text(ofMoney(lineNet(it,wide))+(it.recurring?'/'+(it.every==='year'?'yr':'mo'):''),X.amt,y,{align:'right'});
    if(it.detail){ y+=10; font('PublicSans','normal',7.8,BC_MUTED); doc.splitTextToSize(it.detail,X.qty-30-L).slice(0,2).forEach((t,k)=>doc.text(t,L,y+k*9)); y+=(Math.min(2,doc.splitTextToSize(it.detail,X.qty-30-L).length)-1)*9; } y+=14; });
  return y; }
function ofTotals(doc,L,R2,y,rows){ const font=(f,st,z,col)=>{ doc.setFont(f,st); doc.setFontSize(z); doc.setTextColor(...col); }; y+=2; doc.setDrawColor(...BC_GOLD); doc.setLineWidth(1); doc.line(R2-220,y,R2,y); y+=14;
  rows.forEach(([k,v,big])=>{ if(big){ font('PublicSans','bold',9.5,BC_INK); doc.text(k,R2-220,y); font('Cormorant','bold',18,BC_NAVY); doc.text(v,R2,y+2,{align:'right'}); y+=20; } else { font('PublicSans','normal',9,BC_INK); doc.text(k,R2-220,y); doc.text(v,R2,y,{align:'right'}); y+=13; } }); return y; }
function ofFoot(doc,text){ doc.setFont('PublicSans','normal'); doc.setFontSize(7); doc.setTextColor(...(BC_MUTED)); const n=doc.getNumberOfPages(); for(let p=1;p<=n;p++){ doc.setPage(p); doc.text(`${text} · page ${p} of ${n}`,306,792-28,{align:'center'}); } }
async function invoicePDF(i){
  const {doc,crest}=await ofDoc(), t=i.tenant?tenantOf(i.tenant):null, r=remitTo();
  const {L,R2}=ofBand(doc,crest,(i.contract_id?'Subscription invoice ':'Invoice ')+invNo(i),`Issued ${fdate(i.issued_on)} · due ${fdate(i.due_on)} (Net ${i.terms_days||0})${i.period_start?' · service '+fdate(i.period_start)+' – '+fdate(i.period_end):''}`);
  let y=ofBlocks(doc,L,R2,140,{head:'BILL TO',name:i.company||(t?t.name:''),lines:(t?addrLine(t.address):[]).concat(t&&t.billing_email?[t.billing_email]:[]).concat(t?[t.slug+'.'+BASE_DOMAIN]:[])},{head:'FROM',name:r.name,lines:r.lines});
  y=ofTable(doc,L,R2,y,i.items||[],i.discount_pct);
  const rows=[['Subtotal',ofMoney(i.subtotal)]]; if(parseFloat(i.discount)) rows.push(['Discount','−'+ofMoney(i.discount)]); if(parseFloat(i.tax)) rows.push(['Tax',ofMoney(i.tax)]); rows.push(['Total',ofMoney(i.total),true]); if(parseFloat(i.paid)){ rows.push(['Paid','−'+ofMoney(i.paid)]); rows.push(['Balance due',ofMoney(invBalance(i)),true]); }
  y=ofTotals(doc,L,R2,y,rows);
  doc.setFont('PublicSans','normal'); doc.setFontSize(8.6); doc.setTextColor(...(BC_MUTED)); y+=10; const notes=[i.notes,r.pay,i.status==='void'?'VOID'+(i.void_reason?' — '+i.void_reason:''):''].filter(Boolean).join('\n\n'); if(notes) doc.splitTextToSize(notes,R2-L).forEach(tx=>{ doc.text(tx,L,y); y+=11; });
  ofFoot(doc,`${r.name} · invoice ${invNo(i)}`); return doc;
}
async function estimatePDF(e){
  const {doc,crest}=await ofDoc(), s=estSplit(e), r=remitTo();
  const {L,R2}=ofBand(doc,crest,'Proposal '+estNo(e),`${e.title||'Flagstick for '+e.company} · ${fdate(e.issued_on||e.created_at)}${e.expires_on?' · valid through '+fdate(e.expires_on):''}`);
  let y=ofBlocks(doc,L,R2,140,{head:'PREPARED FOR',name:e.company,lines:[e.contact_name,e.contact_email].filter(Boolean)},{head:'FROM',name:r.name,lines:r.lines});
  if(s.recurring.length){ y=ofTable(doc,L,R2,y,s.recurring,e.discount_pct,{title:'THE SUBSCRIPTION · '+(e.billing==='year'?'BILLED YEARLY':'BILLED MONTHLY')}); y=ofTotals(doc,L,R2,y,e.billing==='year'?[['Per year',ofMoney(s.monthly*12),true],['Per month',ofMoney(s.monthly)]]:[['Per month',ofMoney(s.monthly),true],['Per year',ofMoney(s.monthly*12)]]); y+=10; }
  if(s.onetime.length){ y=ofTable(doc,L,R2,y,s.onetime,e.discount_pct,{title:'SET-UP & TRAINING · ONE-TIME'}); y=ofTotals(doc,L,R2,y,[['One-time total',ofMoney(s.once),true]]); y+=10; }
  doc.setFont('PublicSans','normal'); doc.setFontSize(8.6); doc.setTextColor(...(BC_MUTED)); const notes=[e.notes,e.terms].filter(Boolean).join('\n\n'); if(notes) doc.splitTextToSize(notes,R2-L).forEach(tx=>{ if(y>792-60){ doc.addPage(); doc.setFillColor(...BC_IVORY); doc.rect(0,0,612,792,'F'); y=60; } doc.text(tx,L,y); y+=11; });
  ofFoot(doc,`${r.name} · proposal ${estNo(e)}`); return doc;
}

/* ----- Catalog & billing settings ----- */
function vCatalog(m){
  const b=ofSettings().billing||{}, co=ofSettings().company||{};
  const cols='minmax(0,1.6fr) minmax(0,1.6fr) 110px 110px 90px 32px';
  const row=c=>`<div class="tr click" data-cat="${esc(c.id)}" style="grid-template-columns:${cols}${c.active===false?';opacity:.55':''}"><div class="cell2"><b>${esc(c.name)}</b><small>${esc((CAT_KINDS.find(x=>x[0]===c.kind)||[])[1]||c.kind)}${c.unit?' · per '+esc(c.unit):''}</small></div><span class="muted" style="font-size:13px">${esc(c.descr||'')}</span><span class="num">${ofMoney(c.unit_price)}</span><span class="muted" style="font-size:12.5px">${c.recurring?(c.every==='year'?'Yearly':'Monthly')+(c.price_year?'<br>'+ofMoney(c.price_year)+'/yr':''):'One-time'}${c.taxable?' · taxable':''}</span><span>${c.module?`<span class="chip gold">${esc(moduleName(c.module))}</span>`:c.active===false?'<span class="chip inact">Retired</span>':''}</span><span class="ib">${I.edit}</span></div>`;
  m.innerHTML=head('Catalog & billing','What Flagstick sells and how it bills: the product’s modules as subscriptions, set-up and training as one-time items, the remit-to block on every PDF, the billing mode.',btn('New item','ofNewCat','pri',I.plus))+
    ofCard('Catalog',`<div class="tw"><div class="t"><div class="tr th" style="grid-template-columns:${cols}"><span>Item</span><span>Description</span><span>Price</span><span>Billed</span><span></span><span></span></div>${OF.catalog.length?OF.catalog.map(row).join(''):'<div class="tr"><span class="muted">Nothing yet — add the subscriptions and services you sell.</span></div>'}</div></div>`)+
    `<div class="grid g2" style="align-items:start;margin-top:16px">
      ${ofCard('Billing',`<div style="padding:0 22px 18px">${ofKV('Mode',b.mode==='review'?'<b>Review</b> — invoices wait on the Contracts page until you generate them':'<b>Automatic</b> — an invoice is generated on its date whenever the portal is open, or on Run billing')}${ofKV('Send on generation',b.autosend?'Yes — e-mailed to the client’s billing address with the PDF':'No — generated as a draft, sent by hand')}${ofKV('Default terms','Net '+(b.terms_days??30))}${ofKV('Sales tax',(parseFloat(b.tax_rate)||0)+'% on taxable items')}${ofKV('Estimate terms',esc(b.estimate_terms||'').replace(/\n/g,'<br>'))}</div>`,btn('Edit','ofBillEdit','',I.edit))}
      ${ofCard('Remit to <span class="muted" style="font-size:13px;font-weight:400">· on every invoice and proposal</span>',`<div style="padding:0 22px 18px">${ofKV('Name',esc(co.name||'Flagstick'))}${ofKV('Address',[co.line1,co.line2,[co.city,co.state].filter(Boolean).join(', ')+(co.zip?' '+co.zip:'')].filter(x=>String(x||'').trim()).map(esc).join('<br>'))}${ofKV('E-mail',esc(co.email||''))}${ofKV('Phone',esc(co.phone||''))}${ofKV('How to pay',esc(co.pay||'').replace(/\n/g,'<br>'))}</div>`,btn('Edit','ofCoEdit','',I.edit))}</div>`;
  $('ofNewCat').onclick=()=>catalogDrawer(null);
  m.querySelectorAll('[data-cat]').forEach(x=>x.onclick=()=>catalogDrawer(OF.catalog.find(c=>c.id===x.dataset.cat)));
  $('ofBillEdit').onclick=()=>openDrawer({kicker:'Billing',title:'How Flagstick bills',saveLabel:'Save',
    body:`<div class="fld"><span class="lbl">Mode</span>${seg('obMode',[['auto','Automatic'],['review','Review first']],b.mode||'auto')}<p class="hint">Automatic generates each contract’s invoice on its date (when the portal loads, or on Run billing). Review lists what is due and waits for Generate.</p></div><label class="check"><input type="checkbox" id="obSend"${b.autosend?' checked':''}>E-mail each generated invoice to the client’s billing address at once</label>`+pair(field('Default payment terms, Net days','obTerms',b.terms_days??30,{type:'number'}),field('Sales tax rate, %','obTax',b.tax_rate||'',{type:'number',ph:'0'}))+field('Standard terms on estimates','obEst',b.estimate_terms||'',{type:'textarea'}),
    wire:r=>wireSeg(r,'obMode'),
    save:()=>{ const v={mode:$('dBody').querySelector('#obMode').dataset.val,autosend:$('obSend').checked,terms_days:parseInt(fv('obTerms'))||0,tax_rate:ofN(fv('obTax')),estimate_terms:fv('obEst')}; saveSetting('billing',v).then(()=>{ toast('Saved'); vCatalog(m); }).catch(ofErr); }});
  $('ofCoEdit').onclick=()=>openDrawer({kicker:'Remit to',title:'Flagstick on paper',saveLabel:'Save',
    body:field('Name','ocoN',co.name||'Flagstick')+field('Street','ocoA1',co.line1||'')+field('','ocoA2',co.line2||'',{ph:'Suite (optional)'})+`<div class="frow2" style="grid-template-columns:2fr 1fr 1fr">${field('','ocoCity',co.city||'',{ph:'City'})}${field('','ocoSt',co.state||'',{ph:'State'})}${field('','ocoZip',co.zip||'',{ph:'ZIP'})}</div>`+pair(field('E-mail','ocoE',co.email||'',{type:'email'}),field('Phone','ocoP',co.phone||'',{type:'tel'}))+field('How to pay (printed under the total)','ocoPay',co.pay||'',{type:'textarea'}),
    save:()=>{ const v={name:fv('ocoN'),line1:fv('ocoA1'),line2:fv('ocoA2'),city:fv('ocoCity'),state:fv('ocoSt'),zip:fv('ocoZip'),email:fv('ocoE'),phone:fv('ocoP'),pay:fv('ocoPay')}; saveSetting('company',v).then(()=>{ toast('Saved'); vCatalog(m); }).catch(ofErr); }});
}
function catalogDrawer(c){
  openDrawer({kicker:'Catalog',title:c?c.name:'New item',saveLabel:c?'Save':'Add item',
    body:field('Name','okN',c?.name||'')+field('Description','okD',c?.descr||'',{type:'textarea'})+pair(field('Kind','okK',c?.kind||'subscription',{type:'select',options:CAT_KINDS}),field('Unit (per…)','okU',c?.unit||'',{ph:'club, course, day'}))+
      pair(field('Price','okP',c?.unit_price??'',{type:'number'}),field('Billed','okR',c?(c.recurring?(c.every==='year'?'year':'month'):'once'):'month',{type:'select',options:[['month','Monthly'],['year','Yearly'],['once','One-time']]}))+
      pair(field('Module it switches on','okMod',c?.module||'',{type:'select',options:[['','— not a module —']].concat(MODULE_CATALOG.map(x=>[x.id,x.name]))}),field('Yearly price (when billed annually)','okPY',c?.price_year??'',{type:'number',ph:'blank = 12 × monthly'}))+'<p class="hint">A module item is what a proposal’s product block offers; activating a contract that carries it switches that module on for the club’s hub.</p>'+
      `<label class="check"><input type="checkbox" id="okT"${c?.taxable?' checked':''}>Taxable</label>`+(c?`<label class="check"><input type="checkbox" id="okA"${c.active===false?'':' checked'}>Offered (untick to retire it)</label>`:'')+field('GL code','okG',c?.gl||'',{ph:'optional'}),
    del:c?()=>{ if(!confirm('Remove '+c.name+' from the catalog? Documents that used it keep their lines.')) return; ofDelete('fs_catalog',OF.catalog,c).then(()=>vPortal($('main'))).catch(ofErr); }:null,
    save:()=>{ const name=fv('okN'); if(!name){ toast('Name the item'); return false; } const r=fv('okR');
      const rec={name,descr:fv('okD'),kind:fv('okK'),unit:fv('okU'),unit_price:ofN(fv('okP')),recurring:r!=='once',every:r==='year'?'year':'month',module:fv('okMod'),price_year:fv('okPY')?ofN(fv('okPY')):null,taxable:$('okT').checked,active:c?$('okA').checked:true,gl:fv('okG')};
      (async()=>{ try{ if(c) await ofUpdate('fs_catalog',c,rec); else { rec.sort=OF.catalog.length+1; await ofInsert('fs_catalog',OF.catalog,rec); OF.catalog.sort((a,b)=>(a.sort||0)-(b.sort||0)); } toast('Saved'); vPortal($('main')); }catch(e){ ofErr(e); } })(); }});
}

/* ----- the client record's Billing card (vClient) ----- */
function officeClientCard(t){
  if(!OF.loaded) return '';
  const cts=OF.contracts.filter(c=>c.tenant===t.slug), invs=OF.invoices.filter(i=>i.tenant===t.slug).sort((a,b)=>(b.issued_on||'').localeCompare(a.issued_on||'')), open=invs.filter(i=>i.status==='sent'||i.status==='partial'), ests=OF.estimates.filter(e=>e.tenant===t.slug), lead=OF.leads.find(l=>l.tenant===t.slug);
  const crow=c=>{ const nx=c.status==='active'?nextCycle(c):null; return `<div class="tr click" data-oct="${esc(c.id)}" style="grid-template-columns:90px minmax(0,1.4fr) 110px minmax(0,1fr) 100px 32px;min-height:44px"><span style="font-weight:600;font-size:12.5px;color:var(--navy)">${esc(ctNo(c))}</span><div class="cell2"><b>${esc(c.title||'')}</b><small>${esc(FREQ_LABEL[c.frequency])} · day ${esc(c.billing_day)} · Net ${esc(c.terms_days)}</small></div><span class="num">${ofMoney(ctMonthly(c))}/mo</span><span class="muted" style="font-size:12.5px">${nx?'next '+fdate(isoOf(nx.invoiceDate)):''}</span><span>${ctChip(c.status)}</span><span class="ib">${I.chev}</span></div>`; };
  const irow=i=>`<div class="tr click" data-oinv="${esc(i.id)}" style="grid-template-columns:90px minmax(0,1.4fr) 110px 110px 100px 32px;min-height:44px"><span style="font-weight:600;font-size:12.5px;color:var(--navy)">${esc(invNo(i))}</span><span style="font-size:13px">${esc(i.notes||(i.items&&i.items[0]?i.items[0].descr:''))}</span><span class="muted" style="font-size:12.5px">${fdate(i.issued_on)}${i.due_on?' · due '+fdate(i.due_on):''}</span><span class="num">${ofMoney(i.total)}${invBalance(i)>0&&i.status!=='draft'&&i.status!=='void'?'<br><small class="muted">'+ofMoney(invBalance(i))+' open</small>':''}</span><span>${invChip(i)}</span><span class="ib">${I.chev}</span></div>`;
  const erow=e=>`<div class="tr click" data-oest="${esc(e.id)}" style="grid-template-columns:90px minmax(0,1.4fr) 110px 100px 32px;min-height:44px"><span style="font-weight:600;font-size:12.5px;color:var(--navy)">${esc(estNo(e))}</span><span style="font-size:13px">${esc(e.title||'')}</span><span class="num">${ofMoney(estSplit(e).monthly)}/mo</span><span>${estChip(e.status)}</span><span class="ib">${I.chev}</span></div>`;
  const mrr=cts.filter(c=>c.status==='active').reduce((a,c)=>a+ctMonthly(c),0), bal=open.reduce((a,i)=>a+invBalance(i),0), od=open.filter(invOverdue);
  return `<div class="card" style="overflow:hidden" id="ptBilling"><div class="cardhead"><h2 class="h2">Billing <span class="muted" style="font-size:13px;font-weight:400">· ${ofMoney(mrr)}/mo${bal?' · '+ofMoney(bal)+' outstanding':''}${od.length?' · <span class="chip warn">'+od.length+' overdue</span>':''}${lead?' · from lead '+esc(leadNo(lead)):''}</span></h2><div class="actions">${btn('New proposal','ptOfEst','',I.plus)}${btn('New contract','ptOfCt','',I.plus)}${btn('New invoice','ptOfInv','',I.plus)}</div></div>
    <div class="t">${cts.length?cts.map(crow).join(''):`<div class="tr"><span class="muted">No subscription yet${t.status==='trial'?' — a trial hub: the subscription makes it a client':''}. A contract bills itself on its cycle and switches the modules on.</span></div>`}</div>
    ${invs.length?`<div class="cardhead" style="padding-top:8px"><h2 class="h2" style="font-size:15px">Invoices</h2></div><div class="t">${invs.slice(0,12).map(irow).join('')}</div>`:''}
    ${ests.length?`<div class="cardhead" style="padding-top:8px"><h2 class="h2" style="font-size:15px">Proposals</h2></div><div class="t">${ests.map(erow).join('')}</div>`:''}</div>`;
}
function wireOfficeClientCard(m,t){
  if(!$('ptBilling')) return;
  $('ptOfEst').onclick=()=>estimateDrawer(null,{tenant:t.slug}); $('ptOfCt').onclick=()=>contractDrawer(null,{tenant:t.slug}); $('ptOfInv').onclick=()=>invoiceDrawer(null,{tenant:t.slug});
  m.querySelectorAll('[data-oct]').forEach(x=>x.onclick=()=>ofGo('contract',x.dataset.oct)); m.querySelectorAll('[data-oinv]').forEach(x=>x.onclick=()=>ofGo('invoice',x.dataset.oinv)); m.querySelectorAll('[data-oest]').forEach(x=>x.onclick=()=>ofGo('estimate',x.dataset.oest));
}
/* the portal's dispatcher asks here first */
function vOffice(m){
  switch(PS.view){ case 'pipeline': return vPipeline(m),true; case 'estimates': return vEstimates(m),true; case 'estimate': return vEstimate(m,OF.id),true; case 'contracts': return vContracts(m),true; case 'contract': return vContract(m,OF.id),true; case 'invoices': return vInvoices(m),true; case 'invoice': return vInvoice(m,OF.id),true; case 'catalog': return vCatalog(m),true; }
  return false;
}
