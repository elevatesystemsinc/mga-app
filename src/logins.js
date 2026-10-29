/* ============ Logins: who may sign in to a club, and what they see ============
   tenant_users rows (portal-setup.sql). role 'staff' = the club's staff — the whole club; Flagstick creates these
   from the portal. role 'org' = a board login that opens only the organizations in `orgs`; `manage` makes it a
   board administrator who may invite / remove that board's logins. Staff manage every board login of their club
   (club hub → Logins); a board administrator manages their own board's (association hub → Board).
   Privileged steps (a login with a password someone sets, an invite e-mail, a password reset, deleting) run in the
   Edge Function admin-users with the caller's own session; without it the browser falls back to a side-client
   sign-up (needs "Confirm email" off in Supabase) and reset e-mails. Shared by the hub pages here and portal.js. */
let FN_STATE=null;   // null unknown · true deployed · false missing
const genPassword=()=>{ const a='abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789'; const u=new Uint32Array(14); crypto.getRandomValues(u); return [...u].map(n=>a[n%a.length]).join('').replace(/(.{5})(?=.)/g,'$1-'); };
const fwhen=d=>d?new Date(d).toLocaleString('en-US',{month:'short',day:'numeric',hour:'numeric',minute:'2-digit'}):'—';
const fdate=d=>d?new Date(String(d).length===10?d+'T12:00':d).toLocaleDateString('en-US',{month:'short',day:'numeric',year:'numeric'}):'—';
/* the Edge Function; FN_MISSING when it is not deployed (callers fall back where they can) */
async function adminFn(action,body){
  if(!sb||!sb.functions||typeof sb.functions.invoke!=='function'){ FN_STATE=false; throw new Error('FN_MISSING'); }
  let res; try{ res=await sb.functions.invoke('admin-users',{body:Object.assign({action},body||{})}); }catch(e){ FN_STATE=false; throw new Error('FN_MISSING'); }
  const {data,error}=res;
  if(error){ let msg=error.message||String(error), status=0;
    try{ if(error.context){ status=error.context.status||0; const j=await error.context.json(); if(j&&j.error) msg=j.error; } }catch(_){}
    if(status===404||/FunctionsFetchError|Failed to send a request|not found/i.test((error.name||'')+' '+msg)){ FN_STATE=false; throw new Error('FN_MISSING'); }
    throw new Error(msg); }
  if(data&&data.error) throw new Error(data.error);
  FN_STATE=true; return data&&data.data;
}
const fnNote=()=>FN_STATE===false?`<div class="banner" style="margin-top:8px">The <b>admin-users</b> function is not deployed yet: passwords can’t be set from here and invites go out as password-reset e-mails. Deploy <code>supabase/functions/admin-users</code> (docs/tenancy.md) to unlock the rest.</div>`:'';
/* link a login to a club (or the Flagstick team) straight from the browser — row level security decides who may */
async function linkUser(userId,o){
  if(o.tenant){ const {error}=await sb.from('tenant_users').upsert({user_id:userId,tenant:o.tenant,role:o.role==='org'?'org':'staff',orgs:o.orgs||[],manage:o.role==='org'&&!!o.manage,email:o.email,name:o.name||''},{onConflict:'user_id,tenant'}); if(error) throw new Error(error.message); }
  if(o.admin){ const {error}=await sb.from('flagstick_admins').upsert({user_id:userId,email:o.email}); if(error) throw new Error(error.message); }
}
/* sign a new user up on a side client (the caller's own session is untouched) */
async function signUpSide(email,password,name){
  const side=window.supabase.createClient(CFG.url,CFG.anonKey,{auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false}});
  const {data,error}=await side.auth.signUp({email,password,options:{data:{name:name||''}}});
  if(error) throw new Error(error.message);
  const id=data&&data.user&&data.user.id; if(!id) throw new Error('Supabase did not return the new user — is e-mail confirmation off?');
  try{ await side.auth.signOut(); }catch(_){}
  return {id,email};
}
/* create a login: with a password we set, or by invite (they set their own). Returns {id,email,password?,invited?} */
async function createLogin(o){
  const email=String(o.email||'').trim().toLowerCase(); if(!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw new Error('Enter a valid e-mail address');
  const base={email,name:o.name||'',tenant:o.tenant||null,role:o.role||'staff',orgs:o.orgs||[],manage:!!o.manage,admin:!!o.admin};
  if(o.mode==='invite'){
    try{ const r=await adminFn('invite',Object.assign({redirect:o.redirect},base)); return Object.assign({},r,{invited:true}); }
    catch(e){ if(e.message!=='FN_MISSING') throw e;
      const u=await signUpSide(email,genPassword(),o.name); await linkUser(u.id,base);
      try{ await sb.auth.resetPasswordForEmail(email,{redirectTo:o.redirect}); }catch(_){}
      return Object.assign(u,{invited:true,fallback:true}); }
  }
  const password=o.password||genPassword(); if(password.length<8) throw new Error('The password needs at least 8 characters');
  try{ const r=await adminFn('create',Object.assign({password},base)); return Object.assign({},r,{password}); }
  catch(e){ if(e.message!=='FN_MISSING') throw e; const u=await signUpSide(email,password,o.name); await linkUser(u.id,base); return Object.assign(u,{password,fallback:true}); }
}
function loginResult(r,url){
  openDrawer({kicker:'Login',title:r.invited?'Invite sent':'Login created',body:r.invited
    ?`<p>${esc(r.email)} will receive an e-mail${r.fallback?' to set a password':' with an invitation'}; the link opens ${esc(url)} where they choose their password.</p>`
    :`<div class="banner" style="flex-direction:column;align-items:flex-start"><b>${esc(r.email)}</b><span>Password: <code style="font-size:15px">${esc(r.password)}</code></span><small>Copy it now — it is not shown again. They sign in at ${esc(url)}.</small></div>${r.fallback?fnNote():''}`});
}
/* ---------- the hub side: staff manage board logins; a board administrator manages their own board's ---------- */
const HL={rows:null,auth:{},busy:false};
async function loadLogins(){
  if(!CLOUD||!sessionOK||!TENANCY) return [];
  const {data,error}=await sb.from('tenant_users').select('*').eq('tenant',TENANT); if(error){ toast(error.message); return []; }
  HL.rows=data||[];
  const ids=HL.rows.map(u=>u.user_id);
  if(ids.length){ try{ const {data:ai}=await sb.rpc('admin_users_info',{p_ids:ids}); HL.auth={}; (ai||[]).forEach(x=>HL.auth[x.id]=x); }catch(_){} }
  return HL.rows;
}
const loginsForOrg=id=>(HL.rows||[]).filter(u=>u.role==='org'&&(u.orgs||[]).includes(id));
const loginLine=u=>{ const a=HL.auth[u.user_id]||{}; return `<div class="tr click" data-lu="${esc(u.user_id)}" style="grid-template-columns:minmax(0,1.6fr) minmax(0,1fr) 130px 32px"><div class="cell2"><b>${esc(u.name||a.name||u.email||'')}</b><small>${esc(u.email||a.email||'')}</small></div><span class="muted" style="font-size:13px">${a.last_sign_in_at?'Signed in '+fwhen(a.last_sign_in_at):u.invited_at?'Invited '+fdate(u.invited_at):'Never signed in'}</span><span>${u.role==='staff'?'<span class="chip gold">Staff</span>':u.manage?'<span class="chip navy">Board admin</span>':'<span class="chip">Board</span>'}</span><span class="ib">${I.edit}</span></div>`; };
/* one organization's board logins, as a card appended to a page */
function loginsCard(m,orgId,opt){
  const o=orgMeta(orgId); if(!o||!canManageLogins(orgId)) return;
  const box=document.createElement('div'); box.className='card'; box.style.overflow='hidden'; m.appendChild(box);
  const paint=()=>{ const rows=loginsForOrg(orgId);
    box.innerHTML=`<div class="cardhead"><h2 class="h2">${esc(opt&&opt.title||'Board logins')}</h2><div class="actions">${btn('Invite','lgInv_'+orgId,'pri',I.plus)}</div></div>
      <div class="t">${HL.rows?(rows.length?rows.map(loginLine).join(''):'<div class="tr"><span class="muted">No board logins yet. Invite the board: each login opens this hub and nothing else.</span></div>'):'<div class="tr"><span class="muted">Loading…</span></div>'}</div>
      <div style="padding:10px 22px 16px"><p class="hint" style="margin:0">A board login sees ${esc(o.short||o.name)} only: its tournaments, money and members, the club directory read-only. Tick <b>board administrator</b> to let someone invite and remove the board’s logins themselves.</p>${fnNote()}</div>`;
    box.querySelector('#lgInv_'+orgId).onclick=()=>loginEditor(null,orgId,paintAll);
    box.querySelectorAll('[data-lu]').forEach(r=>r.onclick=()=>loginEditor(HL.rows.find(u=>u.user_id===r.dataset.lu),orgId,paintAll)); };
  const paintAll=async()=>{ await loadLogins(); paint(); };
  paint(); if(!HL.rows) paintAll();
}
/* the club hub's Logins page (staff): the staff list, then every organization's board logins */
/* the staff logins as a card appended to a page (the Logins page; a nonprofit's Settings → Users) */
function staffLoginsCard(m,opt){ opt=opt||{}; const staff=(HL.rows||[]).filter(u=>u.role==='staff'), box=document.createElement('div'); box.className='card'; box.style.overflow='hidden';
  box.innerHTML=`<div class="cardhead"><div><h2 class="h2">${esc(opt.title||'Staff')}</h2>${opt.note?`<span class="muted">${esc(opt.note)}</span>`:''}</div><span class="muted" style="font-size:13px">Managed by Flagstick — ask them to add or remove ${opt.title?'logins':'staff'}</span></div>
      <div class="t">${HL.rows?(staff.length?staff.map(loginLine).join(''):'<div class="tr"><span class="muted">No logins listed.</span></div>'):'<div class="tr"><span class="muted">Loading…</span></div>'}</div>`;
  m.appendChild(box); box.querySelectorAll('[data-lu]').forEach(r=>{ const u=(HL.rows||[]).find(x=>x.user_id===r.dataset.lu); if(u&&u.role==='staff') r.onclick=()=>loginEditor(u,null,()=>loadLogins().then(()=>render())); });
  if(!HL.rows) loadLogins().then(()=>render()); }
function vLogins(m){
  if(!isClub()||!canManageLogins()){ go('dash'); return; }
  m.innerHTML=head('Logins','Who can sign in to '+esc(CLUB.name)+' and what they see. Staff see the whole club; a board login sees its own organization only.');
  staffLoginsCard(m);
  for(const o of CLUB.orgs.filter(x=>!x.archived)) loginsCard(m,o.id,{title:(o.short||o.name)+' · board logins'});
}
/* invite / edit one login for one organization (staff may also edit a staff row's name) */
function loginEditor(u,orgId,done){
  const o=orgId?orgMeta(orgId):null, a=u?(HL.auth[u.user_id]||{}):{}, isStaff=u&&u.role==='staff';
  const iAmStaff=!!(ACCESS&&(ACCESS.admin||(GRANT&&GRANT.role==='staff')));
  const otherOrgs=u?(u.orgs||[]).filter(x=>x!==orgId):[];
  openDrawer({kicker:o?(o.short||o.name):CLUB.name,title:u?(u.name||u.email||'Login'):'Invite to the '+(o?(o.short||o.name):'club')+' board',saveLabel:u?'Save':'Invite',
    body:(u?`<p class="muted" style="margin:0 0 10px">${esc(u.email||a.email||'')} · ${a.last_sign_in_at?'last signed in '+fwhen(a.last_sign_in_at):'never signed in'}</p>`+field('Name','lgN',u.name||a.name||'')
       :pair(field('E-mail','lgE','',{type:'email',ph:'name@example.com'}),field('Name','lgN','')))+
      (isStaff?'<p class="hint">A staff login sees the whole club. Flagstick manages staff; only the name can be changed here.</p>':
        `<label class="check"><input type="checkbox" id="lgMan"${u&&u.manage?' checked':''}>Board administrator — may invite and remove ${esc(o?(o.short||o.name):'this board')}’s logins</label>`+
        (otherOrgs.length?`<p class="hint">Also has: ${otherOrgs.map(esc).join(', ')}.</p>`:'')+
        (u?'':`<div class="fld" style="margin-top:6px"><span class="lbl">How they get in</span>${seg('lgMode',[['invite','E-mail an invite'],['set','Set a password now']],'invite')}<div id="lgSetBox" style="display:none;gap:8px;align-items:center;margin-top:8px"><input class="inp" id="lgPw" placeholder="Leave blank to generate one" style="flex:1" autocomplete="new-password"><button class="btn" id="lgGen">Generate</button></div><p class="hint">Invite: they get an e-mail with a link to ${esc(SITE_BASE)} and choose their password. Set now: the password is shown once and you hand it over.</p>${fnNote()}</div>`)+
        (u?`<div class="fld" style="margin-top:6px"><span class="lbl">Password</span><div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center"><input class="inp" id="lgPw" placeholder="New password (8+ characters)" style="flex:1;min-width:200px" autocomplete="new-password"><button class="btn" id="lgGen">Generate</button><button class="btn" id="lgSet">Set password</button></div><div class="actions" style="margin-top:8px"><button class="btn" id="lgReset">E-mail a reset link</button></div><div id="lgMsg"></div>${fnNote()}</div>`:'')),
    del:u&&!isStaff?()=>{ (async()=>{ const rest=(u.orgs||[]).filter(x=>x!==orgId);
        const r=rest.length?await sb.from('tenant_users').update({orgs:rest}).eq('user_id',u.user_id).eq('tenant',TENANT):await sb.from('tenant_users').delete().eq('user_id',u.user_id).eq('tenant',TENANT);
        if(r.error){ toast(r.error.message); return; } toast('Removed from '+(o?(o.short||o.name):'the board')); done&&done(); })(); }:null, delLabel:'Remove from this board',
    wire:r=>{ wireSeg(r,'lgMode',v=>{ r.querySelector('#lgSetBox').style.display=v==='set'?'flex':'none'; }); const g=r.querySelector('#lgGen'); if(g) g.onclick=()=>{ r.querySelector('#lgPw').value=genPassword(); };
      if(u&&!isStaff){ const msg=r.querySelector('#lgMsg');
        r.querySelector('#lgSet').onclick=async()=>{ const pw=r.querySelector('#lgPw').value; if(pw.length<8){ toast('8 characters or more'); return; } try{ await adminFn('set_password',{user_id:u.user_id,password:pw,tenant:TENANT}); msg.innerHTML=`<div class="banner" style="margin-top:8px">Password set for ${esc(u.email||'')}: <code>${esc(pw)}</code> — copy it now.</div>`; }catch(e){ msg.innerHTML=e.message==='FN_MISSING'?fnNote():`<p class="hint" style="color:var(--neg)">${esc(e.message)}</p>`; } };
        r.querySelector('#lgReset').onclick=async()=>{ const {error}=await sb.auth.resetPasswordForEmail(u.email||a.email,{redirectTo:SITE_BASE}); msg.innerHTML=error?`<p class="hint" style="color:var(--neg)">${esc(error.message)}</p>`:`<div class="banner" style="margin-top:8px">Reset e-mail sent to ${esc(u.email||a.email||'')}.</div>`; }; } },
    save:()=>{ const name=fv('lgN');
      if(u){ (async()=>{ const rec=isStaff?{name}:{name,manage:$('lgMan').checked}; const {error}=await sb.from('tenant_users').update(rec).eq('user_id',u.user_id).eq('tenant',TENANT); if(error){ toast(error.message); return; } toast('Saved'); done&&done(); })(); return; }
      const email=fv('lgE'), mode=$('dBody').querySelector('#lgMode').dataset.val, pw=$('dBody').querySelector('#lgPw').value, manage=$('lgMan').checked; if(!email){ toast('Enter the e-mail address'); return false; }
      (async()=>{ try{
          // an existing login of this club gains this organization instead of a second account
          const have=(HL.rows||[]).find(x=>(x.email||'').toLowerCase()===email.toLowerCase());
          if(have&&have.role==='org'){ const {error}=await sb.from('tenant_users').update({orgs:[...new Set([...(have.orgs||[]),orgId])],manage:have.manage||manage}).eq('user_id',have.user_id).eq('tenant',TENANT); if(error) throw new Error(error.message); toast(email+' now also opens '+(o?(o.short||o.name):'this board')); done&&done(); return; }
          if(have&&have.role==='staff'){ toast(email+' is staff and already sees the whole club'); return; }
          const r=await createLogin({tenant:TENANT,email,name,role:'org',orgs:[orgId],manage,mode,password:pw||undefined,redirect:SITE_BASE});
          done&&done(); loginResult(r,SITE_BASE); }catch(e){ toast(e.message); } })(); }});
}
/* ---------- arriving by link: one-click sign-in (Flagstick), invites and resets (set a password) ---------- */
async function authLanding(){
  const m=AUTH_HASH.match(/[#&]sso=([A-Za-z0-9_.-]+)/);
  if(m){ try{ history.replaceState(null,'',location.href.split('#')[0]); }catch(_){}
    const {error}=await sb.auth.verifyOtp({token_hash:decodeURIComponent(m[1]),type:'magiclink'}); if(error) $('loginErr').textContent='That sign-in link is no longer valid — sign in below.'; return; }
  if(/type=(invite|recovery|signup|magiclink)/.test(AUTH_HASH)||/[#&]access_token=/.test(AUTH_HASH)){
    // supabase-js consumes the hash itself; wait for the session it creates, then ask for a password
    let s=null; for(let i=0;i<24&&!s;i++){ s=(await sb.auth.getSession()).data.session; if(!s) await new Promise(r=>setTimeout(r,250)); }
    if(!s){ $('loginErr').textContent='That link has expired — ask for a new one.'; return; }
    if(/type=(invite|recovery)/.test(AUTH_HASH)) await setPasswordScreen();
  }
}
function setPasswordScreen(){
  return new Promise(done=>{
    const card=$('login'), sub=$('loginSub'), em=$('loginEmail'), pw=$('loginPw'), pw2=$('loginPw2'), b=$('loginBtn'), err=$('loginErr');
    const was={sub:sub.textContent,ph:pw.placeholder,btn:b.textContent,em:em.hidden,click:b.onclick,key:pw.onkeydown};
    sub.textContent='Welcome — choose your password'; em.hidden=true; pw.placeholder='New password (8+ characters)'; pw.value=''; pw2.hidden=false; pw2.value=''; b.textContent='Save password'; err.textContent='';
    card.classList.add('show'); setTimeout(()=>pw.focus(),80);
    const go=async()=>{ if(pw.value.length<8){ err.textContent='Use at least 8 characters.'; return; } if(pw.value!==pw2.value){ err.textContent='The two passwords differ.'; return; } b.disabled=true;
      const {error}=await sb.auth.updateUser({password:pw.value}); b.disabled=false; if(error){ err.textContent=error.message; return; }
      sub.textContent=was.sub; pw.placeholder=was.ph; pw.value=''; pw2.hidden=true; b.textContent=was.btn; em.hidden=was.em; b.onclick=was.click; pw.onkeydown=was.key; card.classList.remove('show'); toast('Password saved'); done(); };
    b.onclick=go; pw.onkeydown=e=>{ if(e.key==='Enter') pw2.focus(); }; pw2.onkeydown=e=>{ if(e.key==='Enter') go(); };
  });
}
