/* ============ Flagstick client portal (app.flagstickhub.com) + the screens a tenant shows instead of a hub ============
   Flagstick's back office, on the same static site. PORTAL (core.js) is true on app.<domain> only (www and the bare
   domain are the marketing website), or with ?portal=1. Only a Flagstick admin (flagstick_admins) gets past the
   sign-in; row level security enforces the same thing on every table, the screens just mirror it.
   Pages: Clients (every tenant, by status, with search) → a client record (subscription + modules, club details,
   points of contact, STAFF logins, the board logins the club manages itself, hosts, notes, activity) · Team
   (Flagstick's own administrators) · Activity (the log the portal writes to tenant_events).
   Flagstick administers a client's staff logins only (role 'staff' = the whole club); the club's staff invite
   board logins for their associations from the club hub, and board administrators manage their own board's
   (logins.js). Account actions that need the service role go through the Edge Function admin-users; without it
   the portal falls back to what the browser can do alone and says so. Tables: tenants-setup.sql, portal-setup.sql. */
const PS={view:'clients',slug:null,filter:'active',q:'',tenants:null,users:[],contacts:[],events:[],admins:[],auth:{},clubs:{},err:null};
const PORTAL_STATE=PS;
const STATUS_LABEL={prospect:'Prospect',trial:'Trial',active:'Active',suspended:'Suspended',inactive:'Inactive'};
const STATUS_CHIP={prospect:'',trial:'gold',active:'ok',suspended:'warn',inactive:'inact'};
const tStatusChip=s=>`<span class="chip ${STATUS_CHIP[s]||''}">${esc(STATUS_LABEL[s]||s||'')}</span>`;
const planLabel=p=>({club:'Club management',golf:'Golf management'}[p]||p||'—');
const tenantURL=slug=>'https://'+slug+'.'+BASE_DOMAIN+'/';
const modulesOf=t=>Object.assign({},(t&&t.modules)||{},{golf:true});
const modChips=t=>{ const m=modulesOf(t); return MODULE_CATALOG.filter(x=>m[x.id]).map(x=>`<span class="chip${x.id==='golf'?'':' gold'}">${esc(x.name)}</span>`).join(' '); };
const addrLine=a=>{ a=a||{}; return [a.line1,a.line2,[a.city,a.state].filter(Boolean).join(', ')+(a.zip?' '+a.zip:''),a.country].map(x=>String(x||'').trim()).filter(Boolean); };
const tenantOf=slug=>(PS.tenants||[]).find(t=>t.slug===slug)||null;
const usersOf=slug=>PS.users.filter(u=>u.tenant===slug);
const contactsOf=slug=>PS.contacts.filter(c=>c.tenant===slug).sort((a,b)=>(b.is_primary?1:0)-(a.is_primary?1:0)||a.name.localeCompare(b.name));
const eventsOf=slug=>PS.events.filter(e=>e.tenant===slug);
const orgsOf=slug=>((PS.clubs[slug]||{}).orgs||[]).filter(o=>!o.archived);
const orgNames=(slug,ids)=>(ids||[]).map(id=>{ const o=orgsOf(slug).find(x=>x.id===id); return o?(o.short||o.name):id; }).join(', ');

/* ---------- boot / data ---------- */
function portalBoot(){
  $('side').classList.add('portal'); $('seasonBox').hidden=true; $('btnSwitch').hidden=true; $('btnBackup').hidden=true; $('btnRestore').hidden=true;
  $('brandName').textContent='Flagstick'; $('brandSub').textContent='Client portal'; $('topName').textContent='Flagstick'; document.title='Portal · Flagstick';
  const lc=$('loginClub'); if(lc) lc.textContent='Flagstick'; const ls=$('loginSub'); if(ls) ls.textContent='Administrator sign-in';
  if(!TENANCY){ $('nav').innerHTML=''; $('main').innerHTML=head('Flagstick portal','')+`<div class="banner">The database has not been prepared for tenants yet — run <b>tenants-setup.sql</b> and <b>portal-setup.sql</b> in the Supabase SQL editor, then reload.</div>`; return; }
  if(!sessionOK){ $('nav').innerHTML=''; $('login').classList.add('show'); setTimeout(()=>{ const e=$('loginEmail'); if(e&&!e.value) e.focus(); else $('loginPw').focus(); },100); return; }
  $('btnSignOut').hidden=false; paintSync('synced'); portalNav(); vPortal($('main')); loadPortal();
}
function portalNav(){
  const items=[['clients','Clients',I.org],['team','Team',I.shield],['activity','Activity',I.ledger]];
  $('nav').innerHTML=items.map(([k,l,ic])=>`<button class="nav${PS.view===k||(k==='clients'&&PS.view==='client')?' on':''}" data-pv="${k}">${ic}<span>${l}</span></button>`).join('');
  $('nav').querySelectorAll('[data-pv]').forEach(b=>b.onclick=()=>{ PS.view=b.dataset.pv; PS.slug=null; $('side').classList.remove('open'); portalNav(); vPortal($('main')); window.scrollTo(0,0); });
}
async function loadPortal(){
  PS.err=null;
  const q=async t=>{ const {data,error}=await sb.from(t).select('*'); if(error){ PS.err=(PS.err?PS.err+' · ':'')+t+': '+error.message; return []; } return data||[]; };
  const [tenants,users,contacts,admins,events]=await Promise.all([q('tenants'),q('tenant_users'),q('tenant_contacts'),q('flagstick_admins'),q('tenant_events')]);
  PS.tenants=tenants.sort((a,b)=>a.name.localeCompare(b.name)); PS.users=users; PS.contacts=contacts; PS.admins=admins; PS.events=events.sort((a,b)=>new Date(b.at)-new Date(a.at));
  const ids=[...new Set([...users.map(u=>u.user_id),...admins.map(a=>a.user_id)])].filter(Boolean);
  if(ids.length){ try{ const {data}=await sb.rpc('admin_users_info',{p_ids:ids}); PS.auth={}; (data||[]).forEach(x=>PS.auth[x.id]=x); }catch(_){} }
  try{ const {data}=await sb.from('mga_hub').select('tenant,id,data').eq('id','club'); (data||[]).forEach(r=>{ if(r.tenant) PS.clubs[r.tenant]={orgs:(r.data&&r.data.orgs)||[],name:r.data&&r.data.name}; }); }catch(_){}
  vPortal($('main'));
}
async function logEvent(tenant,kind,text){
  const ev={tenant:tenant||null,actor:(ACCESS&&ACCESS.email)||'',kind,text,at:new Date().toISOString()};
  PS.events.unshift(ev);
  try{ await sb.from('tenant_events').insert({tenant:ev.tenant,actor:ev.actor,kind,text}); }catch(_){}
}
/* the admin's one-click sign-in into a client's hub: a one-time token the hub verifies on arrival */
async function openHub(t,path){
  const url=tenantURL(t.slug)+(path||'');
  const w=window.open('about:blank','_blank');
  try{ const r=await adminFn('sso',{redirect:url}); const u=url+'#sso='+encodeURIComponent(r.token_hash); if(w) w.location=u; else location.href=u; }
  catch(e){ if(w) w.location=url; else location.href=url; if(e.message!=='FN_MISSING') toast(e.message); else toast('Opened without one-click sign-in (deploy admin-users) — sign in with your Flagstick login'); }
}

/* ---------- pages ---------- */
function vPortal(m){
  if(!m) return;
  if(PS.view==='client'&&PS.slug) return vClient(m,PS.slug);
  if(PS.view==='team') return vTeam(m);
  if(PS.view==='activity') return vActivity(m);
  return vClients(m);
}
const openClient=slug=>{ PS.view='client'; PS.slug=slug; portalNav(); vPortal($('main')); window.scrollTo(0,0); };
function vClients(m){
  const T=PS.tenants, counts={all:0};
  (T||[]).forEach(t=>{ counts.all++; counts[t.status]=(counts[t.status]||0)+1; });
  const q=PS.q.trim().toLowerCase();
  const list=(T||[]).filter(t=>PS.filter==='all'||t.status===PS.filter).filter(t=>!q||[t.name,t.short,t.slug,(t.hosts||[]).join(' '),...contactsOf(t.slug).map(c=>c.name+' '+c.email)].join(' ').toLowerCase().includes(q));
  const tabs=[['active','Active'],['trial','Trial'],['prospect','Prospect'],['suspended','Suspended'],['inactive','Inactive'],['all','All']];
  const cols='grid-template-columns:minmax(0,1.7fr) 140px minmax(0,1.2fr) minmax(0,1.3fr) 70px 110px 32px';
  const row=t=>{ const pc=contactsOf(t.slug)[0], n=usersOf(t.slug).filter(u=>u.role==='staff').length;
    return `<div class="tr click" data-t="${esc(t.slug)}" style="${cols}">
      <div class="cell2"><b>${esc(t.name)}</b><small>${esc(t.slug)}.${esc(BASE_DOMAIN)}${addrLine(t.address)[2]?' · '+esc(addrLine(t.address)[2]):''}</small></div>
      <span>${esc(planLabel(t.plan))}</span><span style="display:flex;flex-wrap:wrap;gap:4px">${modChips(t)}</span>
      <div class="cell2">${pc?`<span>${esc(pc.name)}</span><small>${esc(pc.email||pc.phone||'')}</small>`:'<span class="muted">No contact yet</span>'}</div>
      <span class="num">${n}</span><span>${tStatusChip(t.status)}</span><span class="ib">${I.chev}</span></div>`; };
  m.innerHTML=head('Clients','Every club on Flagstick. A client is a tenant: its own address, its own staff logins, and the modules its subscription turns on.',btn('New client','ptNew','pri',I.plus))+
    (PS.err?`<div class="banner">${esc(PS.err)}</div>`:'')+
    `<div style="display:flex;justify-content:space-between;align-items:center;gap:12px;flex-wrap:wrap;margin-bottom:14px">
      <div class="seg" id="ptFilter">${tabs.map(([k,l])=>`<button type="button" data-v="${k}" class="${PS.filter===k?'on':''}">${l}${counts[k]?' · '+counts[k]:''}</button>`).join('')}</div>
      <div class="search">${I.search}<input class="inp" id="ptQ" placeholder="Search clients, contacts, hosts" value="${esc(PS.q)}" aria-label="Search clients"></div></div>
    <div class="card" style="overflow:hidden"><div class="t">
      <div class="tr th" style="${cols}"><span>Client</span><span>Plan</span><span>Modules</span><span>Primary contact</span><span>Staff</span><span>Status</span><span></span></div>
      ${T?(list.map(row).join('')||`<div class="tr"><span class="muted">${q?'Nothing matches.':'No '+(STATUS_LABEL[PS.filter]||'').toLowerCase()+' clients.'}</span></div>`):'<div class="tr"><span class="muted">Loading…</span></div>'}</div></div>`;
  $('ptNew').onclick=()=>editClient(null);
  m.querySelectorAll('#ptFilter button').forEach(b=>b.onclick=()=>{ PS.filter=b.dataset.v; vClients(m); });
  const qi=$('ptQ'); qi.oninput=()=>{ PS.q=qi.value; const pos=qi.selectionStart; vClients(m); const n=$('ptQ'); n.focus(); n.setSelectionRange(pos,pos); };
  m.querySelectorAll('[data-t]').forEach(r=>r.onclick=()=>openClient(r.dataset.t));
}
function vClient(m,slug){
  const t=tenantOf(slug); if(!t){ PS.view='clients'; return vClients(m); }
  const mods=modulesOf(t), users=usersOf(slug), staff=users.filter(u=>u.role==='staff'), board=users.filter(u=>u.role!=='staff'), contacts=contactsOf(slug), events=eventsOf(slug).slice(0,30), orgs=orgsOf(slug);
  const card=(title,body,actions='')=>`<div class="card" style="overflow:hidden"><div class="cardhead"><h2 class="h2">${title}</h2><div class="actions">${actions}</div></div>${body}</div>`;
  const kv=(k,v)=>`<div style="display:flex;gap:12px;padding:6px 0;border-top:1px solid var(--line)"><span class="muted" style="min-width:130px;font-size:13px">${k}</span><span style="min-width:0">${v||'<span class="muted">—</span>'}</span></div>`;
  const urow=u=>{ const a=PS.auth[u.user_id]||{}; return `<div class="tr click" data-u="${esc(u.user_id)}" style="grid-template-columns:minmax(0,1.6fr) minmax(0,1.2fr) 130px 32px">
      <div class="cell2"><b>${esc(u.name||a.name||u.email||'')}</b><small>${esc(u.email||a.email||'')}</small></div>
      <span class="muted" style="font-size:13px">${a.last_sign_in_at?'Signed in '+fwhen(a.last_sign_in_at):u.invited_at?'Invited '+fdate(u.invited_at):'Never signed in'}</span>
      <span>${a.confirmed===false?'<span class="chip warn">Unconfirmed</span>':'<span class="chip gold">Staff</span>'}</span><span class="ib">${I.edit}</span></div>`; };
  const brow=u=>{ const a=PS.auth[u.user_id]||{}; return `<div class="tr" style="grid-template-columns:minmax(0,1.6fr) minmax(0,1.2fr) 130px;min-height:42px"><div class="cell2"><b>${esc(u.name||a.name||u.email||'')}</b><small>${esc(u.email||a.email||'')}</small></div><span style="font-size:13px">${esc(orgNames(slug,u.orgs))||'<span class="muted">no organization</span>'}</span><span>${u.manage?'<span class="chip navy">Board admin</span>':'<span class="chip">Board</span>'}</span></div>`; };
  const crow=c=>`<div class="tr click" data-c="${esc(c.id)}" style="grid-template-columns:minmax(0,1.4fr) minmax(0,1fr) minmax(0,1.4fr) 130px 32px">
      <div class="cell2"><b>${esc(c.name)}${c.is_primary?' <span class="chip gold" style="margin-left:6px">Primary</span>':''}</b><small>${esc(c.title||'')}</small></div>
      <span>${esc(c.phone||'')}</span><span style="min-width:0;overflow:hidden;text-overflow:ellipsis">${c.email?`<a href="mailto:${esc(c.email)}">${esc(c.email)}</a>`:''}</span><span class="muted" style="font-size:12.5px">${esc(c.notes||'')}</span><span class="ib">${I.edit}</span></div>`;
  const erow=e=>`<div class="tr" style="grid-template-columns:150px minmax(0,1fr) 160px;min-height:40px"><span class="muted" style="font-size:12.5px">${fwhen(e.at)}</span><span style="font-size:13.5px">${esc(e.text)}</span><span class="muted" style="font-size:12.5px;text-align:right">${esc(e.actor||'')}</span></div>`;
  const addr=addrLine(t.address);
  m.innerHTML=`<div class="phead"><div><p style="margin:0 0 4px;font-size:12px;letter-spacing:.1em;text-transform:uppercase;color:var(--gold-dk,#7E5F1A);font-weight:700"><a href="#" id="ptBack" style="color:inherit;text-decoration:none">Clients</a> › ${esc(planLabel(t.plan))}</p><h1 class="h1">${esc(t.name)}</h1>
      <p class="sub"><a href="${esc(tenantURL(t.slug))}" target="_blank" rel="noopener">${esc(t.slug)}.${esc(BASE_DOMAIN)}</a>${(t.hosts||[]).length?' · '+(t.hosts||[]).map(esc).join(', '):''} · ${tStatusChip(t.status)}${t.started_on?' · client since '+fdate(t.started_on):''}</p></div>
      <div class="actions">${btn('Open hub','ptOpen','',I.chev)}${btn('Status','ptStatus','')}${btn('Edit client','ptEdit','pri',I.edit)}</div></div><div class="rule"></div>
    ${PS.err?`<div class="banner">${esc(PS.err)}</div>`:''}
    <div style="display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:18px;align-items:start" class="g2">
      ${card('Subscription',`<div style="padding:0 22px 18px">${kv('Plan',esc(planLabel(t.plan)))}${kv('Status',tStatusChip(t.status)+(t.ended_on?' <span class="muted" style="font-size:13px">since '+fdate(t.ended_on)+'</span>':''))}${kv('Client since',fdate(t.started_on))}${kv('Renews',fdate(t.renews_on))}${kv('Billing e-mail',t.billing_email?`<a href="mailto:${esc(t.billing_email)}">${esc(t.billing_email)}</a>`:'')}
        <div style="border-top:1px solid var(--line);padding-top:10px;margin-top:4px"><span class="muted" style="font-size:13px">Modules</span>
        <div class="mini" style="margin-top:8px" id="ptMods">${MODULE_CATALOG.map(x=>`<label class="mr" style="grid-template-columns:28px minmax(0,1fr);cursor:pointer"><input type="checkbox" data-mod="${x.id}"${mods[x.id]||x.base?' checked':''}${x.base?' disabled':''}><span><b>${esc(x.name)}</b>${x.soon?' <span class="chip inact">coming</span>':''}<br><span class="muted" style="font-size:12.5px">${esc(x.desc)}</span></span></label>`).join('')}</div>
        <div class="actions" style="margin-top:10px"><button class="btn" id="ptModSave">Save modules</button><span class="hint" style="margin-left:8px">The club’s hub picks changes up on its next load.</span></div></div></div>`)}
      ${card('Club details',`<div style="padding:0 22px 18px">${kv('Address',addr.length?addr.map(esc).join('<br>'):'')}${kv('Phone',esc(t.phone||''))}${kv('Website',t.website?`<a href="${esc(/^https?:/.test(t.website)?t.website:'https://'+t.website)}" target="_blank" rel="noopener">${esc(t.website)}</a>`:'')}${kv('Time zone',esc(t.timezone||''))}${kv('Short name',esc(t.short||''))}${kv('Other hosts',(t.hosts||[]).map(esc).join('<br>'))}${kv('Organizations',orgs.length?orgs.map(o=>esc(o.short||o.name)).join(', '):'')}${kv('Notes',esc(t.notes||'').replace(/\n/g,'<br>'))}</div>`,btn('Edit','ptEdit2','',I.edit))}
    </div>
    ${card('Points of contact',`<div class="t">${contacts.length?contacts.map(crow).join(''):'<div class="tr"><span class="muted">No contacts yet — add the head pro, the GM, the billing contact.</span></div>'}</div>`,btn('Add contact','ptAddC','',I.plus))}
    ${card('Staff logins',`<div class="t"><div class="tr th" style="grid-template-columns:minmax(0,1.6fr) minmax(0,1.2fr) 130px 32px"><span>Login</span><span>Last activity</span><span></span><span></span></div>${staff.length?staff.map(urow).join(''):'<div class="tr"><span class="muted">No staff logins yet.</span></div>'}</div>
      <div style="padding:12px 22px 18px"><p class="hint" style="margin:0">Staff see the whole club and manage their own board logins from the club hub (Logins). Flagstick creates staff logins; the club does the rest.</p>${fnNote()}</div>`,
      btn('Link existing login','ptLink','')+btn('Create staff login','ptAddU','pri',I.plus))}
    ${card('Board logins <span class="muted" style="font-size:13px;font-weight:400">· managed by the club</span>',`<div class="t">${board.length?board.map(brow).join(''):'<div class="tr"><span class="muted">None yet — the club invites its boards from its hub.</span></div>'}</div>`)}
    ${card('Activity',`<div class="t">${events.length?events.map(erow).join(''):'<div class="tr"><span class="muted">Nothing yet.</span></div>'}</div>`)}`;
  $('ptBack').onclick=e=>{ e.preventDefault(); PS.view='clients'; PS.slug=null; portalNav(); vPortal(m); };
  $('ptOpen').onclick=()=>openHub(t); $('ptStatus').onclick=()=>statusDrawer(t); $('ptEdit').onclick=()=>editClient(t); $('ptEdit2').onclick=()=>editClient(t);
  $('ptAddC').onclick=()=>editContact(t,null); $('ptAddU').onclick=()=>staffDrawer(t,null); $('ptLink').onclick=()=>linkDrawer(t);
  $('ptModSave').onclick=async()=>{ const nm={golf:true}; m.querySelectorAll('[data-mod]').forEach(c=>{ if(c.checked) nm[c.dataset.mod]=true; }); const b=$('ptModSave'); b.disabled=true;
    const {error}=await sb.from('tenants').update({modules:nm,updated_at:new Date().toISOString()}).eq('slug',t.slug); b.disabled=false;
    if(error){ toast(error.message); return; } t.modules=nm; toast('Modules saved');
    const on=MODULE_CATALOG.filter(x=>nm[x.id]&&!x.base).map(x=>x.name).join(', ')||'Golf management only'; logEvent(t.slug,'modules','Modules: '+on); vClient(m,slug); };
  m.querySelectorAll('[data-c]').forEach(r=>r.onclick=()=>editContact(t,contacts.find(c=>c.id===r.dataset.c)));
  m.querySelectorAll('[data-u]').forEach(r=>r.onclick=()=>staffDrawer(t,users.find(u=>u.user_id===r.dataset.u)));
}
/* ---------- drawers ---------- */
function moduleBoxes(m){ return `<div class="fld"><span class="lbl">Modules</span><div class="mini" id="ptModsD">${MODULE_CATALOG.map(x=>`<label class="mr" style="grid-template-columns:28px minmax(0,1fr);cursor:pointer"><input type="checkbox" data-modd="${x.id}"${m[x.id]||x.base?' checked':''}${x.base?' disabled':''}><span><b>${esc(x.name)}</b>${x.soon?' <span class="chip inact">coming</span>':''}<br><span class="muted" style="font-size:12.5px">${esc(x.desc)}</span></span></label>`).join('')}</div></div>`; }
function readModulesD(root){ const m={golf:true}; root.querySelectorAll('[data-modd]').forEach(c=>{ if(c.checked) m[c.dataset.modd]=true; }); return m; }
function editClient(t){
  const a=(t&&t.address)||{};
  openDrawer({kicker:t?'Client':'New client',title:t?t.name:'New client',wide:true,saveLabel:t?'Save':'Create client',
    body:pair(field('Club name','ptN',t?.name||'',{ph:'e.g. Walnut Creek Country Club'}),field('Short name','ptS',t?.short||'',{ph:'e.g. WCCC'}))+
      (t?'':field('Address (subdomain)','ptSlug','',{ph:'e.g. wccc  →  wccc.'+BASE_DOMAIN})+'<p class="hint">Lower-case letters, digits and dashes. It becomes the club’s address and can’t change later.</p>')+
      `<div class="fld"><span class="lbl">Plan</span>${seg('ptPlan',[['golf','Golf management'],['club','Club management']],t?.plan||'golf')}<p class="hint">Golf management is the package (everything built today). Club management adds running the whole club, with its toggles below.</p></div>`+moduleBoxes(modulesOf(t))+
      (t?'':`<div class="fld"><span class="lbl">Status</span>${seg('ptSt0',[['prospect','Prospect'],['trial','Trial'],['active','Active']],'active')}</div>`)+
      pair(field('Client since','ptFrom',t?.started_on||'',{type:'date'}),field('Renews on','ptRen',t?.renews_on||'',{type:'date'}))+
      '<div class="fld"><span class="lbl">Address</span></div>'+field('','ptA1',a.line1||'',{ph:'Street'})+field('','ptA2',a.line2||'',{ph:'Suite, building (optional)'})+
      `<div class="frow2" style="grid-template-columns:2fr 1fr 1fr">${field('','ptCity',a.city||'',{ph:'City'})}${field('','ptState',a.state||'',{ph:'State'})}${field('','ptZip',a.zip||'',{ph:'ZIP'})}</div>`+
      pair(field('Phone','ptPh',t?.phone||'',{type:'tel'}),field('Website','ptWeb',t?.website||'',{ph:'club.org'}))+
      pair(field('Billing e-mail','ptBE',t?.billing_email||'',{type:'email'}),field('Time zone','ptTz',t?.timezone||'',{ph:'e.g. America/Chicago'}))+
      field('Other host names','ptH',(t?.hosts||[]).join(', '),{ph:'e.g. app.wcccmga.org, hub.wcccmga.org'})+'<p class="hint">Other addresses that open this club (their own domain). Each needs a CNAME to the site and a custom domain on Render.</p>'+
      field('Notes','ptNo',t?.notes||'',{type:'textarea'})+
      (t?'':`<div class="fld" style="margin-top:6px"><span class="lbl">First staff login (optional)</span>${pair(field('','ptLE','',{type:'email',ph:'head.pro@club.org'}),field('','ptLN','',{ph:'Name'}))}${seg('ptLMode',[['set','Set a password now'],['invite','E-mail an invite']],'set')}<p class="hint">A staff login for the whole club. With “set a password” the password is generated and shown once; an invite e-mails them a link to choose their own.</p></div>`),
    wire:r=>{ wireSeg(r,'ptPlan',v=>{ const p=PLAN_PRESETS[v]||{}; r.querySelectorAll('[data-modd]').forEach(c=>{ if(!c.disabled) c.checked=!!p[c.dataset.modd]; }); }); wireSeg(r,'ptSt0'); wireSeg(r,'ptLMode'); },
    save:()=>{ const name=fv('ptN'); if(!name){ toast('Give the club a name'); return false; }
      const slug=(t?t.slug:fv('ptSlug')).toLowerCase(); if(!/^[a-z0-9][a-z0-9-]{1,30}$/.test(slug)||['app','portal','www','api','admin','mail'].includes(slug)){ toast('Choose a different address: letters, digits and dashes'); return false; }
      const body=$('dBody');
      const rec={name,short:fv('ptS'),plan:body.querySelector('#ptPlan').dataset.val,modules:readModulesD(body),started_on:fv('ptFrom')||null,renews_on:fv('ptRen')||null,
        address:{line1:fv('ptA1'),line2:fv('ptA2'),city:fv('ptCity'),state:fv('ptState'),zip:fv('ptZip')},phone:fv('ptPh'),website:fv('ptWeb'),billing_email:fv('ptBE'),timezone:fv('ptTz'),
        hosts:fv('ptH').split(/[,\s]+/).map(h=>h.trim().toLowerCase()).filter(Boolean),notes:fv('ptNo'),updated_at:new Date().toISOString()};
      const first=t?null:{email:fv('ptLE'),name:fv('ptLN'),mode:body.querySelector('#ptLMode').dataset.val,status:body.querySelector('#ptSt0').dataset.val};
      saveClient(t,slug,rec,first); }});
}
async function saveClient(t,slug,rec,first){
  try{
    if(t){ const {error}=await sb.from('tenants').update(rec).eq('slug',slug); if(error) throw error; Object.assign(t,rec); toast('Saved'); logEvent(slug,'edit','Client details updated'); }
    else {
      const {error}=await sb.from('tenants').insert(Object.assign({slug,status:first.status||'active',login_email:first.email||null},rec)); if(error) throw error;
      // the club's own document, so the hub opens straight onto an empty directory rather than first-run set-up
      const club=normalize(null,{id:'club',kind:'club',name:rec.name,short:rec.short||''}); club.name=rec.name; club.short=rec.short||''; club.orgs=[];
      const {error:e2}=await sb.from('mga_hub').insert({tenant:slug,id:'club',data:Object.assign(club,{_rev:1,_w:CLIENT,_at:Date.now()}),updated_at:new Date().toISOString()}); if(e2) throw e2;
      await logEvent(slug,'created','Client created on the '+planLabel(rec.plan)+' plan');
      let made=null; if(first.email){ try{ made=await createLogin({tenant:slug,email:first.email,name:first.name,role:'staff',mode:first.mode,redirect:tenantURL(slug)}); logEvent(slug,'login',(first.mode==='invite'?'Invited staff ':'Created staff login ')+first.email); }catch(e){ toast('Client created, but the login failed: '+e.message); } }
      toast(rec.name+' created');
      await loadPortal(); openClient(slug);
      if(made) setTimeout(()=>loginResult(made,tenantURL(slug)),80);
      return;
    }
  }catch(e){ toast(e.message||'That did not save'); }
  loadPortal();
}
function statusDrawer(t){
  openDrawer({kicker:'Client',title:'Status · '+t.name,
    body:`<div class="fld"><span class="lbl">Status</span>${seg('ptSt',[['prospect','Prospect'],['trial','Trial'],['active','Active'],['suspended','Suspended'],['inactive','Inactive']],t.status||'active')}
      <p class="hint"><b>Suspended</b>: the club’s hubs show a paused notice and nothing else; data is kept. <b>Inactive</b>: a former client — same notice, listed under Inactive.</p></div>`+
      field('Effective date','ptEnd',t.ended_on||'',{type:'date'})+field('Reason / note','ptWhy','',{ph:'e.g. non-payment, moved to another system'}),
    wire:r=>wireSeg(r,'ptSt'),
    save:()=>{ const st=$('dBody').querySelector('#ptSt').dataset.val, ended=fv('ptEnd'), why=fv('ptWhy');
      (async()=>{ const rec={status:st,ended_on:(st==='suspended'||st==='inactive')?(ended||new Date().toISOString().slice(0,10)):null,updated_at:new Date().toISOString()};
        const {error}=await sb.from('tenants').update(rec).eq('slug',t.slug); if(error){ toast(error.message); return; }
        Object.assign(t,rec); logEvent(t.slug,'status','Status → '+STATUS_LABEL[st]+(why?' — '+why:'')); toast('Status: '+STATUS_LABEL[st]); vPortal($('main')); })(); }});
}
function editContact(t,c){
  openDrawer({kicker:t.name,title:c?c.name:'New contact',
    body:pair(field('Name','pcN',c?.name||''),field('Title / role','pcT',c?.title||'',{ph:'e.g. Head Golf Professional'}))+pair(field('E-mail','pcE',c?.email||'',{type:'email'}),field('Phone','pcP',c?.phone||'',{type:'tel'}))+
      `<label class="check"><input type="checkbox" id="pcPri"${c?.is_primary?' checked':''}>Primary contact</label>`+field('Notes','pcNo',c?.notes||'',{type:'textarea'}),
    del:c?()=>{ (async()=>{ const {error}=await sb.from('tenant_contacts').delete().eq('id',c.id); if(error){ toast(error.message); return; } PS.contacts=PS.contacts.filter(x=>x.id!==c.id); logEvent(t.slug,'contact','Removed contact '+c.name); vPortal($('main')); })(); }:null,
    save:()=>{ const name=fv('pcN'); if(!name){ toast('Give the contact a name'); return false; }
      const rec={tenant:t.slug,name,title:fv('pcT'),email:fv('pcE'),phone:fv('pcP'),is_primary:$('pcPri').checked,notes:fv('pcNo'),updated_at:new Date().toISOString()};
      (async()=>{ if(rec.is_primary){ for(const o of contactsOf(t.slug)) if(o.is_primary&&(!c||o.id!==c.id)){ o.is_primary=false; await sb.from('tenant_contacts').update({is_primary:false}).eq('id',o.id); } }
        if(c){ const {error}=await sb.from('tenant_contacts').update(rec).eq('id',c.id); if(error){ toast(error.message); return; } Object.assign(c,rec); }
        else { const {data,error}=await sb.from('tenant_contacts').insert(rec).select('*'); if(error){ toast(error.message); return; } PS.contacts.push((data&&data[0])||Object.assign({id:uid()},rec)); logEvent(t.slug,'contact','Added contact '+name+(rec.title?' ('+rec.title+')':'')); }
        toast('Saved'); vPortal($('main')); })(); }});
}
/* a staff login: create (password we set, or invite) or manage (name, password, remove) */
function staffDrawer(t,u){
  const a=u?(PS.auth[u.user_id]||{}):{};
  openDrawer({kicker:t.name,title:u?(u.name||u.email||'Staff login'):'New staff login',wide:true,saveLabel:u?'Save':'Create login',
    body:(u?`<p class="muted" style="margin:0 0 10px">${esc(u.email||a.email||'')} · ${a.last_sign_in_at?'last signed in '+fwhen(a.last_sign_in_at):'never signed in'}${a.confirmed===false?' · <span class="chip warn">e-mail unconfirmed</span>':''}</p>`+field('Name','puN',u.name||a.name||'')
       :pair(field('E-mail','puE','',{type:'email',ph:'head.pro@club.org'}),field('Name','puN','')))+
      '<p class="hint">Staff see the whole club: the club hub, every organization, and the Logins page where they invite their boards.</p>'+
      (u?`<div class="fld" style="margin-top:6px"><span class="lbl">Password</span><div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center"><input class="inp" id="puPw" placeholder="New password (8+ characters)" style="flex:1;min-width:200px" autocomplete="new-password"><button class="btn" id="puGen">Generate</button><button class="btn" id="puSet">Set password</button></div>
          <div class="actions" style="margin-top:8px"><button class="btn" id="puReset">E-mail a reset link</button></div><div id="puMsg"></div>${fnNote()}</div>
          <div class="fld" style="margin-top:6px"><span class="lbl">Remove</span><div class="actions"><button class="btn" id="puUnlink">Remove from ${esc(t.short||t.name)}</button><button class="btn danger" id="puDel">Delete the login entirely</button></div><p class="hint">Remove keeps the account (it may belong to another client); delete erases it everywhere.</p></div>`
        :`<div class="fld"><span class="lbl">Password</span>${seg('puMode',[['set','Set a password now'],['invite','E-mail an invite']],'set')}
          <div id="puSetBox" style="display:flex;gap:8px;align-items:center;margin-top:8px"><input class="inp" id="puPw" placeholder="Leave blank to generate one" style="flex:1" autocomplete="new-password"><button class="btn" id="puGen">Generate</button></div>
          <p class="hint">Set now: the password is shown once after creation and you hand it over. Invite: they get an e-mail with a link to ${esc(tenantURL(t.slug))} and choose their own.</p>${fnNote()}</div>`),
    wire:r=>{ wireSeg(r,'puMode',v=>{ r.querySelector('#puSetBox').style.display=v==='set'?'flex':'none'; });
      const g=r.querySelector('#puGen'); if(g) g.onclick=()=>{ r.querySelector('#puPw').value=genPassword(); };
      if(u){ const msg=r.querySelector('#puMsg');
        r.querySelector('#puSet').onclick=async()=>{ const pw=r.querySelector('#puPw').value; if(pw.length<8){ toast('8 characters or more'); return; } try{ await adminFn('set_password',{user_id:u.user_id,password:pw}); msg.innerHTML=`<div class="banner" style="margin-top:8px">Password set for ${esc(u.email||'')}: <code>${esc(pw)}</code> — copy it now.</div>`; logEvent(t.slug,'login','Password set for '+(u.email||'')); }catch(e){ if(e.message==='FN_MISSING'){ msg.innerHTML=fnNote(); } else toast(e.message); } };
        r.querySelector('#puReset').onclick=async()=>{ const {error}=await sb.auth.resetPasswordForEmail(u.email||a.email,{redirectTo:tenantURL(t.slug)}); if(error){ toast(error.message); return; } msg.innerHTML=`<div class="banner" style="margin-top:8px">Reset e-mail sent to ${esc(u.email||a.email||'')}.</div>`; logEvent(t.slug,'login','Password reset e-mailed to '+(u.email||'')); };
        r.querySelector('#puUnlink').onclick=async()=>{ if(!confirm('Remove this login from '+t.name+'?')) return; const {error}=await sb.from('tenant_users').delete().eq('user_id',u.user_id).eq('tenant',t.slug); if(error){ toast(error.message); return; } PS.users=PS.users.filter(x=>!(x.user_id===u.user_id&&x.tenant===t.slug)); logEvent(t.slug,'login','Removed staff login '+(u.email||'')); closeDrawer(); vPortal($('main')); };
        r.querySelector('#puDel').onclick=async()=>{ if(!confirm('Delete '+(u.email||'this login')+' everywhere? This cannot be undone.')) return; try{ await adminFn('delete',{user_id:u.user_id}); PS.users=PS.users.filter(x=>x.user_id!==u.user_id); logEvent(t.slug,'login','Deleted login '+(u.email||'')); closeDrawer(); vPortal($('main')); }catch(e){ if(e.message==='FN_MISSING') msg.innerHTML=fnNote(); else toast(e.message); } }; } },
    save:()=>{ const name=fv('puN');
      if(u){ (async()=>{ const {error}=await sb.from('tenant_users').update({name}).eq('user_id',u.user_id).eq('tenant',t.slug); if(error){ toast(error.message); return; } u.name=name; toast('Saved'); vPortal($('main')); })(); return; }
      const body=$('dBody'), email=fv('puE'), mode=body.querySelector('#puMode').dataset.val, pw=body.querySelector('#puPw').value;
      (async()=>{ try{ const r=await createLogin({tenant:t.slug,email,name,role:'staff',mode,password:pw||undefined,redirect:tenantURL(t.slug)});
          logEvent(t.slug,'login',(mode==='invite'?'Invited staff ':'Created staff login ')+email);
          await loadPortal(); loginResult(r,tenantURL(t.slug)); }catch(e){ toast(e.message); } })(); }});
}
/* attach a login that already exists (another client's staff, a Flagstick person) as staff here */
function linkDrawer(t){
  openDrawer({kicker:t.name,title:'Link an existing login as staff',saveLabel:'Link',
    body:field('E-mail of the existing login','plE','',{type:'email'})+'<p class="hint">The login keeps its password; it gains staff access to '+esc(t.name)+'.</p>',
    save:()=>{ const email=fv('plE'); if(!email) return false;
      (async()=>{ const {data,error}=await sb.rpc('admin_user_by_email',{p_email:email}); if(error||!data){ toast(error?error.message:'No login with that e-mail — create one instead'); return; }
        try{ await linkUser(data.id,{tenant:t.slug,role:'staff',email:data.email}); logEvent(t.slug,'login','Linked existing login '+data.email+' as staff'); await loadPortal(); toast('Linked'); }catch(e){ toast(e.message); } })(); }});
}
/* ---------- Team ---------- */
function vTeam(m){
  const row=a=>{ const x=PS.auth[a.user_id]||{}; return `<div class="tr" style="grid-template-columns:minmax(0,1.6fr) minmax(0,1fr) 150px 40px"><div class="cell2"><b>${esc(x.name||a.email||'')}</b><small>${esc(a.email||x.email||'')}</small></div><span class="muted" style="font-size:13px">${x.last_sign_in_at?'Signed in '+fwhen(x.last_sign_in_at):'Never signed in'}</span><span class="muted" style="font-size:13px">Added ${fdate(a.created_at)}</span><button class="ib" data-rm="${esc(a.user_id)}" title="Remove from the team">${I.trash}</button></div>`; };
  m.innerHTML=head('Team','Flagstick’s own administrators: everyone here can open the portal and any client’s hub.',btn('Add administrator','ptAddA','pri',I.plus))+
    `<div class="card" style="overflow:hidden"><div class="t">${PS.admins.length?PS.admins.map(row).join(''):'<div class="tr"><span class="muted">Loading…</span></div>'}</div></div>${fnNote()}`;
  $('ptAddA').onclick=()=>openDrawer({kicker:'Team',title:'Add a Flagstick administrator',saveLabel:'Add',
    body:pair(field('E-mail','paE','',{type:'email'}),field('Name','paN',''))+`<div class="fld"><span class="lbl">Account</span>${seg('paMode',[['set','New login, set a password'],['invite','New login, e-mail an invite'],['link','Existing login']],'set')}<div id="paSetBox" style="display:flex;gap:8px;align-items:center;margin-top:8px"><input class="inp" id="paPw" placeholder="Leave blank to generate one" style="flex:1" autocomplete="new-password"><button class="btn" id="paGen">Generate</button></div></div>`,
    wire:r=>{ wireSeg(r,'paMode',v=>{ r.querySelector('#paSetBox').style.display=v==='set'?'flex':'none'; }); r.querySelector('#paGen').onclick=()=>{ r.querySelector('#paPw').value=genPassword(); }; },
    save:()=>{ const email=fv('paE'), name=fv('paN'), body=$('dBody'), mode=body.querySelector('#paMode').dataset.val, pw=body.querySelector('#paPw').value; if(!email) return false;
      (async()=>{ try{
          if(mode==='link'){ const {data,error}=await sb.rpc('admin_user_by_email',{p_email:email}); if(error||!data){ toast('No login with that e-mail'); return; } await linkUser(data.id,{admin:true,email:data.email}); logEvent(null,'team','Added '+data.email+' to the Flagstick team'); await loadPortal(); toast('Added'); return; }
          const r=await createLogin({admin:true,email,name,mode,password:pw||undefined,redirect:'https://app.'+BASE_DOMAIN+'/'}); logEvent(null,'team',(mode==='invite'?'Invited ':'Created ')+email+' as a Flagstick administrator'); await loadPortal(); loginResult(r,'https://app.'+BASE_DOMAIN+'/');
        }catch(e){ toast(e.message); } })(); }});
  m.querySelectorAll('[data-rm]').forEach(b=>b.onclick=async()=>{ const a=PS.admins.find(x=>x.user_id===b.dataset.rm); if(!a) return; if(a.user_id===(ACCESS&&ACCESS.user_id)){ toast('You cannot remove yourself'); return; } if(!confirm('Remove '+(a.email||'this person')+' from the Flagstick team? Their login stays.')) return;
    const {error}=await sb.from('flagstick_admins').delete().eq('user_id',a.user_id); if(error){ toast(error.message); return; } PS.admins=PS.admins.filter(x=>x.user_id!==a.user_id); logEvent(null,'team','Removed '+(a.email||'')+' from the Flagstick team'); vTeam(m); });
}
function vActivity(m){
  const erow=e=>{ const t=e.tenant?tenantOf(e.tenant):null; return `<div class="tr" style="grid-template-columns:150px 180px minmax(0,1fr) 160px;min-height:40px"><span class="muted" style="font-size:12.5px">${fwhen(e.at)}</span><span>${t?`<a href="#" data-go-t="${esc(t.slug)}">${esc(t.name)}</a>`:'<span class="muted">Flagstick</span>'}</span><span style="font-size:13.5px">${esc(e.text)}</span><span class="muted" style="font-size:12.5px;text-align:right">${esc(e.actor||'')}</span></div>`; };
  m.innerHTML=head('Activity','Everything done from the portal, newest first.')+`<div class="card" style="overflow:hidden"><div class="t">${PS.events.length?PS.events.slice(0,200).map(erow).join(''):'<div class="tr"><span class="muted">Nothing yet.</span></div>'}</div></div>`;
  m.querySelectorAll('[data-go-t]').forEach(a=>a.onclick=e=>{ e.preventDefault(); openClient(a.dataset.goT); });
}
/* ---------- what a tenant's address shows instead of a hub ---------- */
function vNoTenant(m){
  $('nav').innerHTML=''; $('seasonBox').hidden=true; $('btnSwitch').hidden=true;
  m.innerHTML=head('No club at this address','')+`<div class="card pad" style="max-width:640px"><p style="margin:0 0 8px">Nothing is set up at <b>${esc(HOSTNAME||TENANT_HINT)}</b>.</p><p class="hint" style="margin:0">A club’s hub lives at <i>club</i>.${esc(BASE_DOMAIN)}. If this is your club’s address, ask Flagstick to add it under the client’s host names.</p></div>`;
}
function vSuspended(m){
  $('nav').innerHTML=''; $('seasonBox').hidden=true; $('btnSwitch').hidden=true;
  m.innerHTML=head(TENANT_INFO&&TENANT_INFO.name||'This club','')+`<div class="card pad" style="max-width:640px"><p style="margin:0 0 8px"><b>This hub is paused.</b></p><p class="hint" style="margin:0">Your data is safe. Please contact Flagstick to reactivate the subscription.</p></div>`;
}
function vLocked(m,kind){
  const mod=kind==='group'?'groups':'associations', name=(MODULE_CATALOG.find(x=>x.id===mod)||{}).name||mod;
  m.innerHTML=head('Not included in your plan','')+`<div class="card pad" style="max-width:640px"><p style="margin:0 0 8px"><b>${esc(name)}</b> is not part of ${esc(CLUB&&CLUB.name||CLUB_META.name)}’s Flagstick subscription.</p><p class="hint" style="margin:0">Its data is kept. Contact Flagstick to add the module.</p><div class="actions" style="margin-top:12px"><button class="btn" id="lkBack">Back to the club hub</button></div></div>`;
  $('lkBack').onclick=()=>chooseOrg('club');
}
/* a board login landed on a hub it may not open */
function vNotYours(m){
  $('nav').innerHTML=''; $('seasonBox').hidden=true;
  const mine=SCOPE_ORGS.map(id=>(CLUB&&CLUB.orgs||[]).find(o=>o.id===id)).filter(Boolean);
  m.innerHTML=head('Not your hub','')+`<div class="card pad" style="max-width:640px"><p style="margin:0 0 8px">Your login opens ${mine.length?mine.map(o=>'<b>'+esc(o.name)+'</b>').join(', '):'no organizations yet'}.</p>${mine.length?`<div class="actions">${mine.map(o=>`<button class="btn" data-go-org="${esc(o.id)}">Open ${esc(o.short||o.name)}</button>`).join('')}</div>`:'<p class="hint" style="margin:0">Ask the club to give your login an organization.</p>'}</div>`;
  m.querySelectorAll('[data-go-org]').forEach(b=>b.onclick=()=>chooseOrg(b.dataset.goOrg));
}
