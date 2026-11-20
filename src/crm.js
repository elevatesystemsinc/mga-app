/* ============ Companies — the CRM layer (crm.js) ============
   The owner, Nov 2026: "associations, golf shops and even course management have the need for some level of CRM functionality…
   in the world of nonprofits they have companies, those companies purchase sponsorships, those companies also have contacts
   within their company that should have different contact types — golfer, decision maker, their titles… DCO needs the ability
   to see the company, its contacts within the company, the type of sponsorship level that company has paid for."
   One list of companies on the club document (CLUB.companies, club-wide like the directory): a company has its details and a
   dated log of notes; a PERSON in the directory carries `company` (the company's id), `title` and `ctypes` (contact types);
   a SPONSORSHIP (a tournament's t.sponsors[] entry, or a fundraising event's e.sponsors[]) carries `companyId` and `contactId`,
   so the company record shows every sponsorship the company has bought — the tier or level, pledged, received, paid — across
   every tournament and event the hub can see. Older sponsor rows without `companyId` still match by name, so the record is
   complete before anyone links a thing; the Companies page offers to link them in one tap. Nothing here is a new table: the
   documents merge element by element (§3), the companies sit beside the people in the club row and a board login's cut-down
   copy carries them too (crm-setup.sql). */
const CONTACT_TYPES=['Decision maker','Golfer','Billing','Marketing','Assistant','Owner','Volunteer','Sponsor contact'];
/* who gets the Companies page: every club hub (a club, a nonprofit, a course) and an association; never an admin link (the club
   document is read-only there) — a scoped board login reads the list but cannot change it (the club keeps the companies) */
const crmOn=()=>!!CLUB&&!!db&&!KEYMODE&&(isClub()||db.kind==='association');
const crmEdit=()=>crmOn()&&!SCOPED;
/* read without touching the document (browsing writes nothing); writers call companiesW() */
const companies=()=>CLUB&&Array.isArray(CLUB.companies)?CLUB.companies:[];
function companiesW(){ CLUB.companies=Array.isArray(CLUB.companies)?CLUB.companies:[]; return CLUB.companies; }
const companyById=id=>id?companies().find(c=>c.id===id)||null:null;
const companyName=id=>{ const c=companyById(id); return c?c.name:''; };
const sameName=(a,b)=>String(a||'').trim().toLowerCase()===String(b||'').trim().toLowerCase()&&!!String(a||'').trim();
const companyByName=name=>companies().find(c=>sameName(c.name,name))||null;
function newCompany(name){ return {id:uid(),name:String(name||'').trim(),website:'',phone:'',email:'',address1:'',city:'',state:'',zip:'',industry:'',notes:'',log:[],createdAt:new Date().toISOString()}; }
/* the company called `name`, made on the spot when asked for */
function companyFor(name,opt){ name=String(name||'').trim(); if(!name) return null; let c=companyByName(name); if(!c&&opt&&opt.create){ c=newCompany(name); companiesW().push(c); } return c; }
const companyContacts=cid=>persons().filter(p=>p.company===cid).sort((a,b)=>(a.last||'').localeCompare(b.last||'')||(a.first||'').localeCompare(b.first||''));
const personTypes=p=>Array.isArray(p&&p.ctypes)?p.ctypes:[];
const contactLine=p=>[p.title,personTypes(p).join(', ')].filter(Boolean).join(' · ');
/* ---------- sponsorships: what a company has bought, across everything this hub can see ----------
   A row per sponsor entry: a tournament's (tier, pledged, payments) or a fundraising event's (level, amount, payments). The club
   hub reads its own tournaments, every organization's tournaments (read-only, like the club calendar) and the fundraising events;
   an association reads its own tournaments. `linked` says whether the row carries the company's id or only matched by name. */
const spYear=t=>(t.startDate&&/^\d{4}/.test(t.startDate))?t.startDate.slice(0,4):String(t.season||'');
const spMatch=(s,c,nameKey)=>s.companyId?s.companyId===c.id:sameName(s[nameKey],c.name);
function sponsorSources(){ const out=[]; const own=db?db.tournaments||[]:[]; out.push({org:db?db.short||db.name||'':'',orgId:db?db.id:'',own:true,ts:own});
  if(isClub()) orgDocs().forEach(({meta,db:d})=>{ if(d!==db) out.push({org:meta.short||meta.name||meta.id,orgId:meta.id,own:false,ts:d.tournaments||[]}); });
  return out; }
function sponsorshipsOf(c){ const rows=[];
  sponsorSources().forEach(src=>src.ts.forEach(t=>(t.sponsors||[]).forEach(s=>{ if(!spMatch(s,c,'company')) return; const pl=n0(s.pledged), rc=spPaid(s);
    rows.push({kind:'tournament',org:src.org,orgId:src.orgId,own:src.own,year:spYear(t),name:t.name,id:t.id,tier:s.tier||'',pledged:pl,received:rc,status:spStatus(pl,rc),linked:!!s.companyId,contact:s.contact||'',contactId:s.contactId||'',s,t}); })));
  if(isClub()&&typeof fundOn==='function'&&fundOn()) fundData().events.forEach(e=>(e.sponsors||[]).forEach(s=>{ if(!spMatch(s,c,'name')) return; const pl=n0(s.amount), rc=fspPaid(s), lv=fundLevels(e).find(l=>l.id===s.level);
    rows.push({kind:'event',org:db.short||db.name||'',orgId:db.id,own:true,year:String(e.date||'').slice(0,4)||'',name:e.name,id:e.id,tier:lv?lv.name:(s.level||''),pledged:pl,received:rc,status:spStatus(pl,rc),linked:!!s.companyId,contact:s.contact||'',contactId:s.contactId||'',s,e}); }));
  return rows.sort((a,b)=>(b.year||'').localeCompare(a.year||'')||a.name.localeCompare(b.name)); }
const spStatus=(pl,rc)=>rc<=0?(pl>0?['Pledged','']:['—','']):rc>=pl-0.004?['Paid','ok']:['Partial','gold'];
function companyStats(c,y){ const rows=sponsorshipsOf(c), yr=rows.filter(r=>r.year===String(y)); return {rows,yr,pledged:r2(sum(rows,r=>r.pledged)),received:r2(sum(rows,r=>r.received)),yrPledged:r2(sum(yr,r=>r.pledged)),yrReceived:r2(sum(yr,r=>r.received)),contacts:companyContacts(c.id)}; }
/* sponsor rows in this hub's own documents that carry no company yet (the club's own tournaments and events, an association's tournaments) */
function unlinkedSponsors(){ const out=[]; (db.tournaments||[]).forEach(t=>(t.sponsors||[]).forEach(s=>{ if(!s.companyId&&String(s.company||'').trim()) out.push({s,name:s.company,t}); }));
  if(isClub()&&typeof fundOn==='function'&&fundOn()) fundData().events.forEach(e=>(e.sponsors||[]).forEach(s=>{ if(!s.companyId&&String(s.name||'').trim()) out.push({s,name:s.name,e}); })); return out; }
function linkSponsors(){ const list=unlinkedSponsors(); let made=0; const before=companies().length; list.forEach(x=>{ const c=companyFor(x.name,{create:true}); x.s.companyId=c.id; sponsorContactSync(x.s,c); }); made=companies().length-before; persist(); render(); toast(`${list.length} sponsorship${list.length===1?'':'s'} linked · ${made} new compan${made===1?'y':'ies'}`); }
/* the sponsor's contact becomes a person of the company: matched by name among the company's people, then the directory; else added
   (a nonprofit's "Donors & guests" is exactly this list; on a club it is a directory person typed Contact, never a member) */
function sponsorContactSync(s,c){ if(!c) return; const name=String(s.contact||'').trim(); if(!name){ s.contactId=''; return; }
  let p=s.contactId?personById(s.contactId):null; if(p&&!sameName(memberName(p),name)) p=null;
  if(!p) p=companyContacts(c.id).find(x=>sameName(memberName(x),name))||persons().find(x=>sameName(memberName(x),name))||null;
  if(!p){ const parts=name.split(/\s+/); const first=parts.shift()||'', last=parts.join(' '); p={id:uid(),first,last,email:s.email||'',phone:s.phone||'',status:'Active',memberType:'Contact',source:'sponsor',company:c.id,title:'',ctypes:['Sponsor contact']}; CLUB.members.push(p); }
  else { if(!p.company) p.company=c.id; if(!personTypes(p).includes('Sponsor contact')) p.ctypes=personTypes(p).concat('Sponsor contact'); if(s.email&&!p.email) p.email=s.email; if(s.phone&&!p.phone) p.phone=s.phone; }
  s.contactId=p.id; }
/* ---------- the company picker (sponsor drawers, the person editor): type a name, pick a company or make a new one on Save ---------- */
function companyPickHTML(id,cur,label){ const c=companyById(cur&&cur.companyId), name=c?c.name:(cur&&cur.name||'');
  return `<div class="fld"><span class="lbl">${esc(label||'Company')}</span><input class="inp" id="${id}" value="${esc(name)}" autocomplete="off" placeholder="Search companies or type a new one" aria-label="${esc(label||'Company')}"><input type="hidden" id="${id}Id" value="${esc(c?c.id:'')}"><div class="pick" id="${id}L" style="max-height:220px;display:none"></div><p class="hint" id="${id}H" style="margin:0"></p></div>`; }
function wireCompanyPick(r,id,onPick){ const inp=r.querySelector('#'+id), hid=r.querySelector('#'+id+'Id'), L=r.querySelector('#'+id+'L'), H=r.querySelector('#'+id+'H'); if(!inp) return;
  const hint=()=>{ const v=inp.value.trim(); const c=companyById(hid.value); H.innerHTML=!v?'':c&&sameName(c.name,v)?`<b>${esc(c.name)}</b> · ${companyContacts(c.id).length} contact${companyContacts(c.id).length===1?'':'s'}`:companyByName(v)?`Matches <b>${esc(companyByName(v).name)}</b> in Companies`:crmEdit()?`New company — <b>${esc(v)}</b> is added to Companies on Save`:''; };
  const show=()=>{ const q=inp.value.trim().toLowerCase(); const hits=companies().filter(c=>!q||c.name.toLowerCase().includes(q)).sort((a,b)=>a.name.localeCompare(b.name)).slice(0,8);
    L.innerHTML=hits.map(c=>`<button type="button" data-cp="${c.id}"><b>${esc(c.name)}</b><span class="muted" style="margin-left:auto;font-size:12.5px">${esc([c.city,companyContacts(c.id).length?companyContacts(c.id).length+' contacts':''].filter(Boolean).join(' · '))}</span></button>`).join('');
    L.style.display=hits.length?'':'none'; L.querySelectorAll('[data-cp]').forEach(b=>b.onclick=()=>{ const c=companyById(b.dataset.cp); inp.value=c.name; hid.value=c.id; L.style.display='none'; hint(); if(onPick) onPick(c); }); };
  inp.oninput=()=>{ const c=companyByName(inp.value); hid.value=c?c.id:''; show(); hint(); if(onPick) onPick(c); }; inp.onfocus=show; inp.onblur=()=>setTimeout(()=>{ L.style.display='none'; },150); hint(); }
/* what the picker holds on Save: the company picked or named (made now when it is new and this login may add one) */
function readCompanyPick(id,opt){ const name=fv(id), hid=$(id+'Id'); let c=companyById(hid?hid.value:''); if(c&&!sameName(c.name,name)) c=null; if(!c&&name) c=companyFor(name,{create:crmEdit()&&!(opt&&opt.noCreate)}); return {company:c,name:c?c.name:name,companyId:c?c.id:''}; }
/* the sponsor's contact: a text box with the company's people as suggestions */
function contactPickHTML(id,cur,cid,label){ return `<div class="fld"><span class="lbl">${esc(label||'Contact')}</span><input class="inp" id="${id}" list="${id}DL" value="${esc(cur||'')}" autocomplete="off" aria-label="${esc(label||'Contact')}"><datalist id="${id}DL">${contactOptions(cid)}</datalist></div>`; }
const contactOptions=cid=>(cid?companyContacts(cid):[]).map(p=>`<option value="${esc(memberName(p))}">${esc(contactLine(p))}</option>`).join('');
function contactTypesHTML(id,sel){ sel=sel||[]; const all=CONTACT_TYPES.concat(sel.filter(x=>!CONTACT_TYPES.includes(x))); return `<div class="fld"><span class="lbl">Contact type</span><div class="seg" id="${id}">${all.map(x=>`<button type="button" class="${sel.includes(x)?'on':''}" data-ct="${esc(x)}">${esc(x)}</button>`).join('')}</div></div>`; }
function wireContactTypes(r,id){ const box=r.querySelector('#'+id); if(box) box.querySelectorAll('[data-ct]').forEach(b=>b.onclick=()=>b.classList.toggle('on')); }
const readContactTypes=id=>{ const box=$(id); return box?[...box.querySelectorAll('[data-ct].on')].map(b=>b.dataset.ct):[]; };
/* the person editor's CRM fields (ui.js editMember calls these) */
function crmPersonFields(mm){ if(!crmOn()) return ''; return companyPickHTML('mfCo',{companyId:mm&&mm.company||'',name:''})+field('Title','mfTi',mm&&mm.title||'',{ph:'Owner, Director of Marketing…'})+contactTypesHTML('mfCT',mm?personTypes(mm):[]); }
function wireCrmPersonFields(r){ if(!crmOn()) return; wireCompanyPick(r,'mfCo'); wireContactTypes(r,'mfCT'); }
function readCrmPersonFields(){ if(!crmOn()||!$('mfCo')) return {}; const pk=readCompanyPick('mfCo'); return {company:pk.companyId,title:fv('mfTi'),ctypes:readContactTypes('mfCT')}; }
/* ---------- the Companies page ---------- */
function vCompanies(m){ if(!crmOn()){ go('dash'); return; } const y=String(Y()), list=companies().slice(), q=(view.cq||'').toLowerCase().trim(), f=view.cfilter||'All';
  const stats=new Map(list.map(c=>[c.id,companyStats(c,y)]));
  let rows=list.map(c=>({c,S:stats.get(c.id)}));
  if(q) rows=rows.filter(({c,S})=>[c.name,c.city,c.industry,c.email,c.phone].concat(S.contacts.map(memberName)).join(' ').toLowerCase().includes(q));
  if(f==='Sponsoring '+y) rows=rows.filter(({S})=>S.yr.length); if(f==='Past sponsors') rows=rows.filter(({S})=>S.rows.length&&!S.yr.length); if(f==='Not yet') rows=rows.filter(({S})=>!S.rows.length);
  rows.sort((a,b)=>a.c.name.localeCompare(b.c.name));
  const nYr=list.filter(c=>stats.get(c.id).yr.length).length, plYr=r2(sum(list,c=>stats.get(c.id).yrPledged)), rcYr=r2(sum(list,c=>stats.get(c.id).yrReceived)), nCon=persons().filter(p=>p.company&&companyById(p.company)).length;
  const un=crmEdit()?unlinkedSponsors():[], filters=['All','Sponsoring '+y,'Past sponsors','Not yet'];
  const cols='grid-template-columns:minmax(0,1.6fr) minmax(0,1.4fr) minmax(0,1.4fr) 120px 120px 40px';
  m.innerHTML=head('Companies',`The companies ${esc(CLUB.name||CLUB_META.name)} works with — sponsors, vendors, partners — with their people and every sponsorship they have bought${isClub()?' across the club':''}.`,(crmEdit()?btn('Add company','coAdd','pri',I.plus):''))+
    `<div class="grid g4">${kpi('Companies',String(list.length),`${nCon} contact${nCon===1?'':'s'} on the list`)}${kpi('Sponsoring in '+y,String(nYr),nYr?`${fmt(plYr)} pledged`:'none yet')}${kpi('Received in '+y,fmt(rcYr),plYr>rcYr+0.004?`${fmt(r2(plYr-rcYr))} still to come`:'all in')}${kpi('Lifetime',fmt(r2(sum(list,c=>stats.get(c.id).received))),'received from sponsorships')}</div>
    ${un.length?`<div class="banner">${un.length} sponsorship${un.length===1?'':'s'} on ${isClub()?'tournament and event':'tournament'} lists ${un.length===1?'is':'are'} not linked to a company yet (${esc([...new Set(un.map(x=>x.name))].slice(0,4).join(', '))}${new Set(un.map(x=>x.name)).size>4?'…':''}). <a href="#" id="coLink">Link them</a> — each becomes a company here, with its contact on the list.</div>`:''}
    <div class="toolbar"><div class="search">${I.search}<input class="inp" id="cq" placeholder="Search companies, cities or people" value="${esc(view.cq||'')}" aria-label="Search companies"></div><div class="seg">${filters.map(x=>`<button class="${f===x?'on':''}" data-cf="${x}">${x}</button>`).join('')}</div></div>
    <div class="card" style="overflow:hidden">${rows.length?`<div class="tw"><div class="t" style="min-width:900px"><div class="tr th" style="${cols}"><span>Company</span><span>Contacts</span><span>${y}</span><span class="r">Pledged</span><span class="r">Received</span><span></span></div>
    ${rows.map(({c,S})=>`<div class="tr num click" data-co="${c.id}" style="${cols}"><div class="cell2"><b class="trunc">${esc(c.name)}</b><small class="trunc">${esc([c.industry,c.city].filter(Boolean).join(' · '))}</small></div><div class="cell2"><b class="trunc" style="font-weight:500">${S.contacts.length?esc(S.contacts.slice(0,2).map(memberName).join(', '))+(S.contacts.length>2?' +'+(S.contacts.length-2):''):'<span class="muted">—</span>'}</b>${S.contacts.length?`<small class="trunc">${esc(contactLine(S.contacts[0]))}</small>`:''}</div><span style="display:flex;gap:6px;flex-wrap:wrap">${S.yr.length?S.yr.map(r=>`<span class="chip ${r.status[1]}" title="${esc(r.name)}">${esc(r.tier||'Sponsor')} · ${r.status[0]}</span>`).join(''):S.rows.length?`<span class="muted">last ${esc(S.rows[0].year||'')}</span>`:'<span class="muted">—</span>'}</span><span class="r">${fmt(S.pledged)}</span><span class="r">${fmt(S.received)}</span><span class="ib">${I.chev}</span></div>`).join('')}</div></div>`
    :`<div class="empty"><b>${list.length?'No companies match':'No companies yet'}</b><span>${list.length?'Try a different search or filter.':un.length?'Link the sponsors already on your lists with the button above, or add a company.':'Add the companies that sponsor you, sell to you or play with you; their people go on the directory with a company, a title and a contact type.'}</span></div>`}</div>`;
  const qi=$('cq'); qi.oninput=()=>{ view.cq=qi.value; const pos=qi.selectionStart; render(); const n=$('cq'); n.focus(); n.setSelectionRange(pos,pos); };
  m.querySelectorAll('[data-cf]').forEach(b=>b.onclick=()=>{ view.cfilter=b.dataset.cf; render(); });
  m.querySelectorAll('[data-co]').forEach(r=>r.onclick=()=>go('company',{companyId:r.dataset.co}));
  const add=$('coAdd'); if(add) add.onclick=()=>companyDrawer(null); const lk=$('coLink'); if(lk) lk.onclick=e=>{ e.preventDefault(); linkSponsors(); }; }
/* ---------- one company: its people, its sponsorships, its notes ---------- */
function vCompany(m){ if(!crmOn()){ go('dash'); return; } const c=companyById(view.companyId); if(!c){ go('companies'); return; } const y=String(Y()), S=companyStats(c,y), ed=crmEdit();
  const log=(c.log||[]).slice().sort((a,b)=>String(b.at).localeCompare(String(a.at)));
  const when=iso=>iso?new Date(iso).toLocaleDateString('en-US',{month:'short',day:'numeric',year:'numeric'}):'';
  const site=c.website?(/^https?:\/\//i.test(c.website)?c.website:'https://'+c.website):'';
  const cols='grid-template-columns:70px minmax(0,1.6fr) minmax(0,1fr) 110px 110px 100px';
  m.innerHTML=`<div class="crumb"><button id="coBack">Companies</button><span class="muted">/</span><span class="muted">${esc(c.name)}</span></div>
    <div class="phead"><div><h1 class="h1">${esc(c.name)}</h1><div style="display:flex;gap:8px;margin-top:12px;flex-wrap:wrap">${S.yr.length?S.yr.map(r=>`<span class="chip ${r.status[1]}">${y} · ${esc(r.tier||'Sponsor')} · ${r.status[0]}</span>`).join(''):`<span class="chip">Not sponsoring in ${y}</span>`}${c.industry?`<span class="chip">${esc(c.industry)}</span>`:''}${site?`<a class="chip" href="${esc(site)}" target="_blank" rel="noopener">${esc(c.website.replace(/^https?:\/\//i,''))}</a>`:''}${c.phone?`<span class="chip">${esc(c.phone)}</span>`:''}${c.email?`<span class="chip">${esc(c.email)}</span>`:''}${[c.city,c.state].filter(Boolean).length?`<span class="chip">${esc([c.city,c.state].filter(Boolean).join(', '))}</span>`:''}</div></div>
      <div class="actions">${ed?btn('Log a note','coNote','')+btn('Add contact','coCon','')+btn('Edit company','coEdit','pri',I.edit):''}</div></div><div class="rule"></div>
    <div class="grid g3">${kpi('Lifetime',fmt(S.received),`received of ${fmt(S.pledged)} pledged · ${S.rows.length} sponsorship${S.rows.length===1?'':'s'}`)}${kpi(y,S.yr.length?fmt(S.yrReceived):'—',S.yr.length?`of ${fmt(S.yrPledged)} pledged · ${S.yr.map(r=>r.tier||'Sponsor').join(', ')}`:'nothing this year')}${kpi('Contacts',String(S.contacts.length),S.contacts.length?esc([...new Set(S.contacts.flatMap(personTypes))].slice(0,3).join(', ')||'on the directory'):'nobody yet')}</div>
    <div class="grid g2" style="align-items:start">
      <div class="card lg pl" style="overflow:hidden"><div class="cardhead"><div><h2 class="h2">People</h2><span class="muted">The company's contacts on the directory — who decides, who plays, who pays</span></div>${ed?`<div class="actions"><button class="btn sm" id="coCon2">${I.plus}Contact</button></div>`:''}</div>
        ${S.contacts.length?S.contacts.map(p=>`<div class="lr click" data-ct="${p.id}"><div class="cell2"><span class="ln" style="font-size:15px"><span class="av" style="margin-right:8px">${initials(p)}</span>${esc(memberName(p))}${p.title?` <span class="muted">· ${esc(p.title)}</span>`:''}</span><span class="ls">${personTypes(p).map(x=>`<span class="chip navy" style="height:20px;font-size:11px">${esc(x)}</span>`).join(' ')}${personTypes(p).length?' · ':''}${esc([p.email,p.phone].filter(Boolean).join(' · ')||'no e-mail or phone')}</span></div><span class="lact"><span class="ib">${I.edit}</span></span></div>`).join(''):`<div class="empty"><b>No contacts yet</b><span>Add the people you deal with here — a decision maker, the golfers on their team, who handles the invoice.</span></div>`}</div>
      <div class="card lg pl" style="overflow:hidden"><div class="cardhead"><div><h2 class="h2">Notes</h2><span class="muted">Calls, meetings, what they said — newest first</span></div>${ed?`<div class="actions"><button class="btn sm" id="coNote2">${I.plus}Note</button></div>`:''}</div>
        ${c.notes?`<div class="lr"><div class="cell2"><span class="ln" style="white-space:pre-wrap">${esc(c.notes)}</span><span class="ls">About the company</span></div></div>`:''}
        ${log.length?log.map(n=>`<div class="lr"><div class="cell2"><span class="ln" style="white-space:pre-wrap">${esc(n.text)}</span><span class="ls">${esc(when(n.at))}${n.by?' · '+esc(n.by):''}</span></div>${ed?`<span class="lact"><button class="ib" data-ndel="${n.id}" aria-label="Remove note">${I.x}</button></span>`:''}</div>`).join(''):c.notes?'':`<div class="empty"><b>Nothing logged</b><span>Log a note after a call or a meeting so the next person knows where things stand.</span></div>`}</div>
    </div>
    <div class="card" style="overflow:hidden"><div class="cardhead"><div><h2 class="h2">Sponsorships</h2><span class="muted">Every tournament and event this company has sponsored${isClub()?', across the club':''}</span></div></div>
      ${S.rows.length?`<div class="tw"><div class="t" style="min-width:760px"><div class="tr th" style="${cols}"><span>Year</span><span>Tournament / event</span><span>Level</span><span class="r">Pledged</span><span class="r">Received</span><span>Status</span></div>
      ${S.rows.map((r,i)=>`<div class="tr num${r.own?' click':''}" data-sp="${i}" style="${cols}"><span class="muted">${esc(r.year||'—')}</span><div class="cell2"><b class="trunc">${esc(r.name)}</b><small class="trunc">${esc([isClub()&&r.org!==(db.short||db.name)?r.org:'',r.kind==='event'?'Fundraising event':'Tournament',r.contact?'contact '+r.contact:'',r.linked?'':'matched by name'].filter(Boolean).join(' · '))}</small></div><span class="trunc muted">${esc(r.tier||'—')}</span><span class="r">${fmt(r.pledged)}</span><span class="r">${fmt(r.received)}</span><span><span class="chip ${r.status[1]}">${r.status[0]}</span></span></div>`).join('')}
      <div class="tr tot num" style="${cols}"><span>Total</span><span></span><span></span><span class="r">${fmt(S.pledged)}</span><span class="r">${fmt(S.received)}</span><span></span></div></div></div>`:`<div class="empty"><b>No sponsorships yet</b><span>When ${esc(c.name)} is added as a sponsor on a tournament${isClub()?' or a fundraising event':''}, it shows here with the level, what was pledged and what has come in.</span></div>`}</div>`;
  $('coBack').onclick=()=>go('companies'); const E=$('coEdit'); if(E) E.onclick=()=>companyDrawer(c);
  ['coCon','coCon2'].forEach(id=>{ const b=$(id); if(b) b.onclick=()=>contactDrawer(null,c); }); ['coNote','coNote2'].forEach(id=>{ const b=$(id); if(b) b.onclick=()=>companyNoteDrawer(c); });
  m.querySelectorAll('[data-ct]').forEach(r=>r.onclick=()=>contactDrawer(personById(r.dataset.ct),c));
  m.querySelectorAll('[data-ndel]').forEach(b=>b.onclick=e=>{ e.stopPropagation(); const n=(c.log||[]).find(x=>x.id===b.dataset.ndel); if(!n) return; c.log=c.log.filter(x=>x!==n); persist(); render(); toast('Note removed',()=>{ c.log.push(n); persist(); render(); }); });
  m.querySelectorAll('[data-sp].click').forEach(r=>r.onclick=()=>{ const x=S.rows[+r.dataset.sp]; if(x.kind==='event') go('fundev',{fid:x.id,ftab:'sponsors'}); else go('tournament',{tid:x.id,ttab:'sponsors'}); }); }
function companyDrawer(c){ const isNew=!c;
  openDrawer({kicker:'Companies',title:isNew?'Add company':c.name,body:field('Company','cdN',c?c.name:'',{ph:'Acme Bank'})+pair(field('Industry','cdI',c?c.industry||'':'',{ph:'Bank, builder, dealership…'}),field('Website','cdW',c?c.website||'':''))+pair(field('Phone','cdP',c?c.phone||'':''),field('E-mail','cdE',c?c.email||'':'',{type:'email'}))+
      field('Address','cdA',c?c.address1||'':'')+`<div style="display:grid;grid-template-columns:minmax(0,2fr) 70px minmax(0,1fr);gap:12px">${field('City','cdC',c?c.city||'':'')}${field('State','cdS',c?c.state||'':'')}${field('Zip','cdZ',c?c.zip||'':'')}</div>`+field('About','cdNo',c?c.notes||'':'',{type:'textarea',ph:'What they do, who introduced them, what they care about'}),
    save:()=>{ const name=fv('cdN'); if(!name){ toast('Name the company'); return false; } const dup=companyByName(name); if(dup&&dup!==c){ toast('There is already a company called '+dup.name); return false; }
      const data={name,industry:fv('cdI'),website:fv('cdW'),phone:fv('cdP'),email:fv('cdE'),address1:fv('cdA'),city:fv('cdC'),state:fv('cdS'),zip:fv('cdZ'),notes:fv('cdNo')};
      if(isNew){ c=Object.assign(newCompany(name),data); companiesW().push(c); view.page='company'; view.companyId=c.id; }
      else { Object.assign(c,data); (db.tournaments||[]).forEach(t=>(t.sponsors||[]).forEach(s=>{ if(s.companyId===c.id) s.company=name; })); if(isClub()&&typeof fundOn==='function'&&fundOn()) fundData().events.forEach(e=>(e.sponsors||[]).forEach(s=>{ if(s.companyId===c.id) s.name=name; })); } },
    del:isNew?null:()=>{ const n=companyContacts(c.id).length, sp=sponsorshipsOf(c).filter(r=>r.linked&&r.own).length; if(!confirm(`Remove ${c.name}?${n?` Its ${n} contact${n===1?'':'s'} stay on the directory without a company.`:''}${sp?` ${sp} sponsorship${sp===1?'':'s'} keep the name but lose the link.`:''}`)) return false;
      CLUB.companies=companies().filter(x=>x!==c); persons().forEach(p=>{ if(p.company===c.id) p.company=''; }); sponsorshipsOf(c).forEach(r=>{ if(r.own&&r.s.companyId===c.id){ r.s.companyId=''; } }); view.page='companies'; },delLabel:'Remove company'}); }
/* a contact: a directory person with a company, a title and contact types. The club hub writes the person; an association writes the
   same person in the club document (persist saves the club row, as a member edit does) — a new one is a directory person, not a member. */
function contactDrawer(p,c){ const isNew=!p;
  openDrawer({kicker:c?c.name:'Contact',title:isNew?'Add contact':memberName(p),body:pair(field('First name','ctF',p?p.first||'':''),field('Last name','ctL',p?p.last||'':''))+field('Title','ctT',p?p.title||'':'',{ph:'Owner, Director of Marketing…'})+companyPickHTML('ctCo',{companyId:p?p.company:(c?c.id:''),name:''})+contactTypesHTML('ctCT',p?personTypes(p):[])+pair(field('E-mail','ctE',p?p.email||'':'',{type:'email'}),field('Phone','ctP',p?p.phone||'':''))+field('Notes','ctN',p?p.notes||'':'',{type:'textarea'})+(p&&isClub()?`<p class="hint">Everything else about ${esc(memberName(p))} — address, handicap, status — is on the <a href="#" id="ctFull">directory record</a>.</p>`:''),
    wire:r=>{ wireCompanyPick(r,'ctCo'); wireContactTypes(r,'ctCT'); const f=r.querySelector('#ctFull'); if(f) f.onclick=e=>{ e.preventDefault(); closeDrawer(); editMember(memberById(p.id)); }; },
    save:()=>{ const first=fv('ctF'), last=fv('ctL'); if(!first&&!last){ toast('Enter a name'); return false; } const pk=readCompanyPick('ctCo');
      const data={first,last,title:fv('ctT'),company:pk.companyId,ctypes:readContactTypes('ctCT'),email:fv('ctE'),phone:fv('ctP'),notes:fv('ctN')};
      if(p) Object.assign(p,data); else CLUB.members.push(Object.assign({id:uid(),status:'Active',memberType:'Contact',source:'contact'},data)); },
    del:p?()=>{ p.company=''; toast(`${memberName(p)} is no longer a contact of ${c?c.name:'the company'} — still on the directory`); }:null,delLabel:'Take off this company',delPlain:true}); }
function companyNoteDrawer(c){ openDrawer({kicker:c.name,title:'Log a note',saveLabel:'Log it',body:field('Note','cnT','',{type:'textarea',ph:'Called Dana about the Gold package — wants the foursome on Sunday, invoice to Accounts Payable.'})+pair(field('Date','cnD',todayISO(),{type:'date'}),field('By','cnB',(typeof ACCESS!=='undefined'&&ACCESS&&(ACCESS.name||ACCESS.email))||'',{ph:'Your name'})),
  save:()=>{ const text=fv('cnT'); if(!text){ toast('Write the note'); return false; } c.log=Array.isArray(c.log)?c.log:[]; const d=fv('cnD'); c.log.push({id:uid(),at:d?d+'T12:00:00.000Z':new Date().toISOString(),by:fv('cnB'),text}); }}); }
/* ---------- the rail ---------- */
NAV.push(['companies','Companies',I.org]);
ORG_NAV.club.push('companies'); ORG_NAV.association.push('companies');
NAV_OWNS.companies=['companies','company']; NAV_GATE.companies=()=>crmOn();
(function(){ const put=(sec,after)=>{ const i=sec[1].indexOf(after); if(i>=0&&!sec[1].includes('companies')) sec[1].splice(i+1,0,'companies'); };
  NAV_SECTIONS.nonprofit.forEach(s=>{ if(s[0]==='Donors & guests') put(s,'members'); }); NAV_SECTIONS.club.forEach(s=>{ if(s[0]==='Membership') put(s,'members'); }); NAV_SECTIONS.association.forEach(s=>{ if(s[0]==='Membership') put(s,'members'); }); })();
