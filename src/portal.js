/* ============ Flagstick portal (app.flagstickhub.com) + the module gates every hub honours ============
   The portal is Flagstick's own back office: the list of tenants (clients), a new tenant in one form (name, slug =
   subdomain, plan preset, the module boxes, the first board login), and per tenant: the switches, status, extra
   hosts, more board logins. It runs on the same static site: PORTAL (core.js) is true on app.<domain> only (www and the
   bare domain are the marketing website), or with ?portal=1. Only a Flagstick admin (flagstick_admins) gets in; row level security enforces
   it (tenants-setup.sql), the screens just mirror it.
   Creating a board login needs no server: a second supabase-js client with no persisted session signs the new user
   up (email + a generated password), and the admin's own session is untouched; the user is then linked to the tenant
   in tenant_users. Supabase → Authentication → Providers → Email → "Confirm email" must be OFF for this (or the
   new login waits for a confirmation mail). */
const PORTAL_STATE={tenants:null,loading:false,err:null};
const planLabel=p=>({club:'Club management',golf:'Golf management'}[p]||p||'—');
const tenantURL=slug=>'https://'+slug+'.'+BASE_DOMAIN+'/';
const modulesOf=t=>Object.assign({},(t&&t.modules)||{},{golf:true});
const modChips=t=>{ const m=modulesOf(t); return MODULE_CATALOG.filter(x=>m[x.id]).map(x=>`<span class="chip${x.id==='club'?' gold':''}">${esc(x.name)}</span>`).join(' '); };
function portalBoot(){
  $('side').classList.add('portal'); $('nav').innerHTML=''; $('seasonBox').hidden=true; $('btnSwitch').hidden=true;
  $('brandName').textContent='Flagstick'; $('brandSub').textContent='Client portal'; $('topName').textContent='Flagstick'; document.title='Portal · Flagstick';
  const lc=$('loginClub'); if(lc) lc.textContent='Flagstick'; const ls=$('loginSub'); if(ls) ls.textContent='Administrator sign-in';
  $('btnBackup').hidden=true; $('btnRestore').hidden=true;
  if(!TENANCY){ $('main').innerHTML=head('Flagstick portal','')+`<div class="banner">The database has not been prepared for tenants yet — run <b>tenants-setup.sql</b> in the Supabase SQL editor, then reload.</div>`; return; }
  if(!sessionOK){ $('login').classList.add('show'); setTimeout(()=>{ const e=$('loginEmail'); if(e&&!e.value) e.focus(); else $('loginPw').focus(); },100); return; }
  $('btnSignOut').hidden=false; paintSync('synced'); vPortal($('main')); loadTenants();
}
async function loadTenants(){
  PORTAL_STATE.loading=true; PORTAL_STATE.err=null; vPortal($('main'));
  const {data,error}=await sb.from('tenants').select('*').order('created_at');
  PORTAL_STATE.loading=false; if(error) PORTAL_STATE.err=error.message; else PORTAL_STATE.tenants=data||[];
  if(PORTAL_STATE.tenants){ const {data:u}=await sb.from('tenant_users').select('tenant,email,role,created_at'); PORTAL_STATE.users=u||[]; }
  vPortal($('main'));
}
function vPortal(m){
  const T=PORTAL_STATE.tenants, U=PORTAL_STATE.users||[];
  const st=s=>s==='active'?'<span class="chip ok">Active</span>':s==='trial'?'<span class="chip gold">Trial</span>':'<span class="chip warn">Suspended</span>';
  const row=t=>`<div class="tr click" data-t="${esc(t.slug)}" style="grid-template-columns:minmax(0,1.6fr) 150px minmax(0,2fr) 110px 40px">
      <div class="cell2"><b>${esc(t.name)}</b><small>${esc(t.slug)}.${esc(BASE_DOMAIN)}${(t.hosts||[]).length?' · '+(t.hosts||[]).map(esc).join(', '):''}</small></div>
      <span>${esc(planLabel(t.plan))}</span><span style="display:flex;flex-wrap:wrap;gap:4px">${modChips(t)}</span><span>${st(t.status)}</span><span class="ib">${I.edit}</span></div>`;
  m.innerHTML=head('Clients',`Every club on Flagstick. A client is a tenant: its own address, its own board logins, and the modules its subscription turns on. ${T?T.length+' client'+(T.length===1?'':'s'):''}`,
      btn('New client','ptNew','pri',I.plus))+
    (PORTAL_STATE.err?`<div class="banner">${esc(PORTAL_STATE.err)}</div>`:'')+
    `<div class="card" style="overflow:hidden"><div class="t">${T?(T.map(row).join('')||'<div class="tr"><span class="muted">No clients yet.</span></div>'):'<div class="tr"><span class="muted">Loading…</span></div>'}</div></div>
    <div class="card pad" style="display:flex;flex-direction:column;gap:8px"><h2 class="h2">Modules</h2>
      ${MODULE_CATALOG.map(x=>`<div style="display:flex;gap:10px;align-items:baseline"><b style="min-width:150px">${esc(x.name)}</b><span class="muted" style="font-size:13.5px">${esc(x.desc)}${x.base?' · every client has it':''}${x.soon?' · not built yet; the box is here so plans can be set up ahead of it':''}</span></div>`).join('')}
      <p class="hint" style="margin:0">Presets: <b>Club management</b> turns everything on; <b>Golf management</b> is golf + associations + small groups (the course keeps its directory). Boxes can be changed any time; the club's hub picks it up on its next load.</p></div>
    <div class="card pad" style="display:flex;flex-direction:column;gap:6px"><h2 class="h2">Board logins</h2>
      ${U.length?`<div class="mini">${U.map(u=>`<div class="mr" style="grid-template-columns:minmax(0,1fr) 120px 110px"><span>${esc(u.email||'')}</span><span class="muted">${esc(u.tenant)}</span><span class="muted">${esc(u.role||'')}</span></div>`).join('')}</div>`:'<p class="muted" style="margin:0">None listed yet.</p>'}
      <p class="hint" style="margin:0">A board login opens one club's hubs only. Passwords are set when a login is created; to change one later, use Supabase → Authentication → Users → Reset password.</p></div>`;
  $('ptNew').onclick=()=>editTenant(null);
  m.querySelectorAll('[data-t]').forEach(r=>r.onclick=()=>editTenant((T||[]).find(t=>t.slug===r.dataset.t)));
}
const genPassword=()=>{ const a='abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789'; const u=new Uint32Array(14); crypto.getRandomValues(u); return [...u].map(n=>a[n%a.length]).join('').replace(/(.{5})(?=.)/g,'$1-'); };
function moduleBoxes(m){ return `<div class="fld"><span class="lbl">Modules</span><div class="mini" id="ptMods">${MODULE_CATALOG.map(x=>`<label class="mr" style="grid-template-columns:28px minmax(0,1fr);cursor:pointer"><input type="checkbox" data-mod="${x.id}"${m[x.id]||x.base?' checked':''}${x.base?' disabled':''}><span><b>${esc(x.name)}</b>${x.soon?' <span class="chip inact">soon</span>':''}<br><span class="muted" style="font-size:12.5px">${esc(x.desc)}</span></span></label>`).join('')}</div></div>`; }
function readModules(root){ const m={golf:true}; root.querySelectorAll('[data-mod]').forEach(c=>{ if(c.checked) m[c.dataset.mod]=true; }); return m; }
function editTenant(t){
  const m=modulesOf(t), users=(PORTAL_STATE.users||[]).filter(u=>t&&u.tenant===t.slug);
  openDrawer({kicker:t?'Client':'New client',title:t?t.name:'New client',wide:true,saveLabel:t?'Save':'Create client',
    body:pair(field('Club name','ptN',t?.name||'',{ph:'e.g. Walnut Creek Country Club'}),field('Short name','ptS',t?.short||'',{ph:'e.g. WCCC'}))+
      field('Address (subdomain)','ptSlug',t?.slug||'',{ph:'e.g. wccc  →  wccc.'+BASE_DOMAIN,disabled:!!t})+
      (t?'':'<p class="hint">Lower-case letters, digits and dashes. It becomes the club’s address and can’t change later.</p>')+
      `<div class="fld"><span class="lbl">Plan</span>${seg('ptPlan',[['club','Club management'],['golf','Golf management']],t?.plan||'golf')}<p class="hint">A preset for the boxes below — tick or untick anything after.</p></div>`+
      moduleBoxes(m)+
      (t?`<div class="fld"><span class="lbl">Status</span>${seg('ptSt',[['active','Active'],['trial','Trial'],['suspended','Suspended']],t.status||'active')}<p class="hint">Suspended: the club’s hubs show a notice and nothing else; data is kept.</p></div>`:'')+
      field('Extra host names','ptH',(t?.hosts||[]).join(', '),{ph:'e.g. app.wcccmga.org, hub.wcccmga.org'})+
      '<p class="hint">Other addresses that open this club (their own domain). Each needs a CNAME to the site and a custom domain on Render.</p>'+
      field('Notes','ptNo',t?.notes||'',{type:'textarea'})+
      (t?`<div class="fld"><span class="lbl">Board logins</span><div class="mini">${users.length?users.map(u=>`<div class="mr" style="grid-template-columns:minmax(0,1fr) 100px"><span>${esc(u.email||'')}</span><span class="muted">${esc(u.role||'')}</span></div>`).join(''):'<div class="mr"><span class="muted">None yet.</span></div>'}</div>
          <div style="display:flex;gap:8px;align-items:center;margin-top:8px;flex-wrap:wrap"><input class="inp" id="ptUE" type="email" placeholder="board@club.org" aria-label="New login e-mail" style="flex:1;min-width:200px"><button class="btn" id="ptUAdd">Add board login</button></div>
          <div id="ptUNew"></div><p class="hint">The sign-in card at ${esc(tenantURL(t.slug))} shows the primary login below; any login linked here works.</p></div>`+
        field('Primary login e-mail (shown on the sign-in card)','ptLE',t.login_email||'',{type:'email'})
       :field('First board login (e-mail)','ptLE','',{type:'email',ph:'board@club.org'})+'<p class="hint">A password is generated and shown once after the client is created. Leave it blank to add logins later.</p>'),
    wire:r=>{ wireSeg(r,'ptPlan',v=>{ const p=PLAN_PRESETS[v]||{}; r.querySelectorAll('[data-mod]').forEach(c=>{ if(!c.disabled) c.checked=!!p[c.dataset.mod]; }); }); wireSeg(r,'ptSt');
      const add=r.querySelector('#ptUAdd'); if(add) add.onclick=async()=>{ const em=fv('ptUE'); if(!em||!/@/.test(em)){ toast('Enter the e-mail address'); return; } add.disabled=true;
        try{ const pw=await addBoardLogin(t.slug,em); r.querySelector('#ptUNew').innerHTML=`<div class="banner" style="margin-top:8px"><b>Login created.</b> ${esc(em)} · password <code>${esc(pw)}</code> — copy it now; it is not shown again.</div>`; toast('Board login added'); loadTenants(); }
        catch(e){ toast(e.message||'Could not add the login'); } add.disabled=false; }; },
    save:()=>{ const name=fv('ptN'); if(!name){ toast('Give the club a name'); return false; }
      const slug=(t?t.slug:fv('ptSlug')).toLowerCase(); if(!/^[a-z0-9][a-z0-9-]{1,30}$/.test(slug)||['app','portal','www','api','admin','mail'].includes(slug)){ toast('Choose a different address: letters, digits and dashes'); return false; }
      const body=$('dBody'), rec={name,short:fv('ptS'),plan:body.querySelector('#ptPlan').dataset.val,modules:readModules(body),hosts:fv('ptH').split(/[,\s]+/).map(h=>h.trim().toLowerCase()).filter(Boolean),notes:fv('ptNo'),login_email:fv('ptLE')||null,updated_at:new Date().toISOString()};
      if(t) rec.status=body.querySelector('#ptSt').dataset.val;
      saveTenant(t,slug,rec); }});
}
async function saveTenant(t,slug,rec){
  try{
    if(t){ const {error}=await sb.from('tenants').update(rec).eq('slug',slug); if(error) throw error; toast('Saved'); }
    else {
      const {error}=await sb.from('tenants').insert(Object.assign({slug,status:'active'},rec)); if(error) throw error;
      // the club's own document, so the hub opens straight onto an empty directory rather than first-run set-up
      const club=normalize(null,{id:'club',kind:'club',name:rec.name,short:rec.short||''}); club.name=rec.name; club.short=rec.short||''; club.orgs=[];
      const {error:e2}=await sb.from('mga_hub').insert({tenant:slug,id:'club',data:Object.assign(club,{_rev:1,_w:CLIENT,_at:Date.now()}),updated_at:new Date().toISOString()}); if(e2) throw e2;
      let pw=null; if(rec.login_email){ pw=await addBoardLogin(slug,rec.login_email); }
      toast(rec.name+' created');
      if(pw) setTimeout(()=>openDrawer({kicker:'New client',title:rec.name+' is ready',body:`<p>Address: <a href="${esc(tenantURL(slug))}" target="_blank" rel="noopener">${esc(tenantURL(slug))}</a></p><div class="banner"><b>Board login</b><br>${esc(rec.login_email)}<br>password <code>${esc(pw)}</code><br><small>Copy it now — it is not shown again. The club can change it from Supabase → Authentication, or you can add another login any time.</small></div>`}),50);
    }
  }catch(e){ toast(e.message||'That did not save'); }
  loadTenants();
}
/* a new board login: sign the user up on a side client (the admin stays signed in), then link them to the tenant */
async function addBoardLogin(slug,email){
  const side=window.supabase.createClient(CFG.url,CFG.anonKey,{auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false}});
  const password=genPassword();
  const {data,error}=await side.auth.signUp({email,password,options:{data:{tenant:slug}}});
  if(error) throw new Error(error.message);
  const uid=data&&data.user&&data.user.id; if(!uid) throw new Error('Supabase did not return the new user — is e-mail confirmation off?');
  const {error:e2}=await sb.from('tenant_users').insert({user_id:uid,tenant:slug,role:'board',email});
  if(e2) throw new Error(e2.message);
  try{ await side.auth.signOut(); }catch(_){}
  return password;
}
/* ---------- the screens a tenant's hub shows instead of a hub ---------- */
function vNoTenant(m){
  $('nav').innerHTML=''; $('seasonBox').hidden=true; $('btnSwitch').hidden=true;
  m.innerHTML=head('No club at this address','')+`<div class="card pad" style="max-width:640px"><p style="margin:0 0 8px">Nothing is set up at <b>${esc(HOSTNAME||TENANT_HINT)}</b>.</p><p class="hint" style="margin:0">A club’s hub lives at <i>club</i>.${esc(BASE_DOMAIN)}. If this is your club’s address, ask Flagstick to add it under the client’s host names.</p></div>`;
}
function vSuspended(m){
  $('nav').innerHTML=''; $('seasonBox').hidden=true; $('btnSwitch').hidden=true;
  m.innerHTML=head(TENANT_INFO&&TENANT_INFO.name||'This club','')+`<div class="card pad" style="max-width:640px"><p style="margin:0 0 8px"><b>This hub is paused.</b></p><p class="hint" style="margin:0">Your data is safe. Please contact Flagstick to reactivate the subscription.</p></div>`;
}
/* an organization whose kind the subscription does not include */
function vLocked(m,kind){
  const mod=kind==='group'?'groups':'associations', name=(MODULE_CATALOG.find(x=>x.id===mod)||{}).name||mod;
  m.innerHTML=head('Not included in your plan','')+`<div class="card pad" style="max-width:640px"><p style="margin:0 0 8px"><b>${esc(name)}</b> is not part of ${esc(CLUB&&CLUB.name||CLUB_META.name)}’s Flagstick subscription.</p><p class="hint" style="margin:0">Its data is kept. Contact Flagstick to add the module.</p><div class="actions" style="margin-top:12px"><button class="btn" id="lkBack">Back to the club hub</button></div></div>`;
  $('lkBack').onclick=()=>chooseOrg('club');
}
