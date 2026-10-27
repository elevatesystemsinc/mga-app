/* ============ Settings — white label (branding, outgoing e-mail) and the module setup ============
   Every hub (the club, each association, each small group) has Settings. Branding: the organization's own logo on
   statements, receipts, sheets, PDFs, e-mails and the member portal — an association keeps its own, else the club's,
   else the Flagstick crest. E-mail: the organization's own sender (wcccmga.org for the MGA, the club's domain for the
   club), sent by Flagstick's mailer or through the organization's Microsoft 365 (an Azure app with Mail.Send); the
   settings live in mail_settings (mail-setup.sql), the secret is write-only here. The club's Settings also gathers
   the setup of each module: restaurants and the golf shop (POS outlets), billing, facilities, the game library. */
const MAILS={row:null,loaded:false};
const mailKey=()=>'fs_mail_'+((typeof TENANT!=='undefined'&&TENANT)||'local')+'_'+ORG_ID;
function brandOf(){ if(db&&db.brand&&db.brand.logo) return db.brand; if(CLUB&&CLUB.brand&&CLUB.brand.logo) return CLUB.brand; return null; }
const brandLogo=()=>{ const b=brandOf(); return b?b.logo:null; };
const brandName=()=>(db&&db.name)||(CLUB&&CLUB.name)||CLUB_META.name;
async function mailLoad(force){ if(MAILS.loaded&&!force) return MAILS.row; MAILS.loaded=true;
  if(!acctCloud()){ try{ MAILS.row=JSON.parse(localStorage.getItem(mailKey())||'null'); }catch(_){ MAILS.row=null; } return MAILS.row; }
  const r=await tq(sb.from('mail_settings').select('*').eq('org',ORG_ID)).maybeSingle(); MAILS.row=r.error?null:(r.data||null); return MAILS.row; }
async function mailSave(row){ row=Object.assign({org:ORG_ID,updated_at:new Date().toISOString(),updated_by:whoAmI()},row);
  if(!acctCloud()){ MAILS.row=Object.assign({},MAILS.row||{},row); try{ localStorage.setItem(mailKey(),JSON.stringify(MAILS.row)); }catch(_){} return true; }
  const {error}=await sb.from('mail_settings').upsert(trow(row),{onConflict:'tenant,org'}); if(error){ toast('Couldn’t save: '+error.message); return false; } MAILS.row=Object.assign({},MAILS.row||{},row); return true; }
/* one way out for every e-mail the hub sends: the organization's sender settings travel with the message */
async function sendMail(msg){ if(!acctCloud()||!sb.functions) return {error:'E-mail goes out from the live site'};
  try{ const {data,error}=await sb.functions.invoke('mail',{body:Object.assign({tenant:TENANT,org:ORG_ID},msg)}); if(error) return {error:error.message||'failed'}; return data||{error:'no reply'}; }catch(e){ return {error:e.message||'failed'}; } }
/* a branded HTML e-mail: the logo, the organization's name, the paragraphs, a quiet footer — no Flagstick mark */
function mailHTML(o){ const logo=brandLogo(), name=brandName(), paras=(o.paragraphs||[]).map(p=>`<p style="margin:0 0 12px;font:15px/1.5 -apple-system,Segoe UI,Helvetica,Arial,sans-serif;color:#14222B">${p}</p>`).join('');
  return `<!doctype html><html><body style="margin:0;background:#F4F0E6;padding:24px 12px"><table role="presentation" width="100%" cellspacing="0" cellpadding="0"><tr><td align="center"><table role="presentation" width="560" style="max-width:560px;background:#fff;border:1px solid #E3DCC9;border-radius:12px" cellspacing="0" cellpadding="0">
    <tr><td style="background:#0F2A38;border-radius:12px 12px 0 0;padding:18px 24px;border-bottom:4px solid #C7A13A">${logo?`<img src="${logo}" alt="${esc(name)}" style="height:48px;max-width:220px;object-fit:contain;display:block;margin-bottom:8px">`:''}<div style="font:700 18px Georgia,serif;color:#fff">${esc(name)}</div></td></tr>
    <tr><td style="padding:22px 24px 8px"><h1 style="margin:0 0 14px;font:700 24px Georgia,serif;color:#0F2A38">${esc(o.title||'')}</h1>${paras}${o.cta?`<p style="margin:18px 0 6px"><a href="${esc(o.cta.href)}" style="display:inline-block;background:#0F2A38;color:#fff;text-decoration:none;font:700 14px -apple-system,Segoe UI,Helvetica,Arial,sans-serif;padding:12px 20px;border-radius:10px">${esc(o.cta.label)}</a></p>`:''}</td></tr>
    <tr><td style="padding:10px 24px 20px;font:12.5px -apple-system,Segoe UI,Helvetica,Arial,sans-serif;color:#56626A;border-top:1px solid #E3DCC9">${esc(o.footer||name)}</td></tr></table></td></tr></table></body></html>`; }
/* ---------- the page ---------- */
function vSettings(m){
  if(KEYMODE){ go('dash'); return; } const club=isClub(), b=brandOf(), own=db.brand&&db.brand.logo, mine=MAILS.row;
  if(!MAILS.loaded){ mailLoad().then(()=>render()); }
  const prov=(mine&&mine.provider)||'resend';
  const tabs=club&&posOn()?[['general','General'],['fnb','Food & beverage'],['shop','Shops']]:[['general','General']]; if(!tabs.some(([k])=>k===view.stab)) view.stab='general';
  if(view.stab!=='general'){ if(STN.rows==null){ stnLoad().then(()=>render()); } m.innerHTML=head('Settings',`${esc(db.name)} — ${view.stab==='fnb'?'restaurants, their stations, tables and menus, and who works the floor':'the golf shop, the tennis shop and their registers'}.`)+`<div class="tabs">${tabs.map(([k,l])=>`<button class="tab${view.stab===k?' on':''}" data-st="${k}">${l}</button>`).join('')}</div>`+fnbSetupHTML(view.stab==='fnb'?'fnb':'proshop');
    m.querySelectorAll('[data-st]').forEach(x=>x.onclick=()=>{ view.stab=x.dataset.st; render(); }); wireFnbSetup(m,view.stab==='fnb'?'fnb':'proshop'); return; }
  m.innerHTML=head('Settings',`${esc(db.name)} — branding, outgoing e-mail${club?' and the setup of each module':''}.`)+(tabs.length>1?`<div class="tabs">${tabs.map(([k,l])=>`<button class="tab${view.stab===k?' on':''}" data-st="${k}">${l}</button>`).join('')}</div>`:'')+`
    <div class="grid g2" style="align-items:start">
      <div class="card"><div class="cardhead"><div><h2 class="h2">Branding</h2><span class="muted">Your logo on statements, receipts, sheets, PDFs, e-mails${club?' and the member portal':''}</span></div></div>
        <div style="padding:0 22px 18px"><div class="brandbox">${b?`<img src="${b.logo}" alt="">`:`<img src="${SITE_BASE}flagstick-crest-light.png" alt="" style="opacity:.6">`}<div class="cell2"><b>${b?(own?'Your logo':club?'Your logo':'The club’s logo'):'No logo yet'}</b><small>${b?`${b.w}×${b.h}${own?'':club?'':' · from the club — add your own to replace it on this organization’s output'}`:'Until you add one, output carries the Flagstick crest.'}</small></div></div>
          <div class="actions" style="margin-top:12px"><label class="btn pri" style="cursor:pointer">${I.plus}${own?'Replace logo':'Upload logo'}<input type="file" id="stLogo" accept="image/png,image/jpeg,image/svg+xml,image/webp" hidden></label>${own?`<button class="btn" id="stLogoX">Remove</button>`:''}</div>
          <p class="hint">PNG or JPG, ideally on a transparent or white background; it is resized to 600 px and stored with ${club?'the club':'this organization'}. The app itself stays Flagstick; what goes out to members carries ${club?'the club':'you'}.</p></div></div>
      <div class="card"><div class="cardhead"><div><h2 class="h2">Outgoing e-mail</h2><span class="muted">Statements, receipts and notices come from ${esc(db.name)}, not from Flagstick</span></div></div>
        <div style="padding:0 22px 18px">${!MAILS.loaded?'<p class="muted">Loading…</p>':`
          <div class="kv"><span class="muted">Sender</span><span>${mine&&mine.from_email?`<b>${esc(mine.from_name||db.name)}</b> &lt;${esc(mine.from_email)}&gt;`:'<span class="muted">Not set — mail goes out as Flagstick</span>'}</span></div>
          <div class="kv"><span class="muted">Replies to</span><span>${esc((mine&&mine.reply_to)||'—')}</span></div>
          <div class="kv"><span class="muted">Sent through</span><span>${prov==='m365'?`Microsoft 365${mine&&mine.mailbox?' · '+esc(mine.mailbox):''}${mine&&mine.m365_client?' · app registered':' · <span class="neg">app not registered yet</span>'}`:'Flagstick’s mailer'+(mine&&mine.from_email?' · the domain must be verified with Flagstick':'')}</span></div>
          <div class="actions" style="margin-top:12px"><button class="btn pri" id="stMail">${I.edit}E-mail settings</button><button class="btn" id="stTest">Send a test</button></div>
          <p class="hint">${prov==='m365'?'Microsoft 365: an Azure app registration with the Graph permission Mail.Send (application), admin-consented; its tenant id, client id and secret go in E-mail settings and the secret is never shown again.':'Flagstick’s mailer sends from your address once your domain is verified with Flagstick (SPF/DKIM records we give you). Or switch to Microsoft 365 to send straight from your own mailbox.'}</p>`}</div></div>
    </div>
    ${club?`<div class="card"><div class="cardhead"><div><h2 class="h2">Module setup</h2><span class="muted">Where each part of the club is set up</span></div></div><div class="grid g3" style="padding:0 22px 20px">
      ${posOn()?`<div class="setupcard"><b>Food &amp; beverage</b><span class="muted">${posSettings().outlets.filter(o=>o.kind==='fnb').map(o=>esc(o.name)).join(' · ')||'No restaurants yet'}</span><div class="actions"><button class="btn sm" data-stab="fnb">Restaurants, stations &amp; menus</button></div></div>
      <div class="setupcard"><b>Shops</b><span class="muted">${posSettings().outlets.filter(o=>o.kind==='proshop').map(o=>esc(o.name)).join(' · ')||'No shop outlet yet'}</span><div class="actions"><button class="btn sm" data-stab="shop">Shop &amp; registers</button><button class="btn sm" data-go2="possetup">Products &amp; stock</button></div></div>`:''}
      ${acctOn()?`<div class="setupcard"><b>Member billing</b><span class="muted">${acctSettings().classes.length} membership class${acctSettings().classes.length===1?'':'es'} · tax ${n0(acctSettings().tax.rate)}% · service ${n0(acctSettings().svc.rate)}%</span><div class="actions"><button class="btn sm" data-go2="billsetup">Billing setup</button></div></div>`:''}
      ${bookOn()?`<div class="setupcard"><b>Bookings</b><span class="muted">${bookSettings().facilities.map(f=>esc(f.name)).join(' · ')}</span><div class="actions"><button class="btn sm" data-go2="booksetup">Facilities</button></div></div>`:''}
      ${typeof staffOn==='function'&&staffOn()?`<div class="setupcard"><b>Staff</b><span class="muted">${clubStaff().length} people · PINs, departments, the schedule, the time clock</span><div class="actions"><button class="btn sm" data-go2="staff">Staff &amp; schedule</button></div></div>`:''}
      <div class="setupcard"><b>Golf</b><span class="muted">The games the club plays, courses and tees</span><div class="actions"><button class="btn sm" data-go2="library">Game library</button><button class="btn sm" data-go2="golf">Events &amp; courses</button></div></div>
      <div class="setupcard"><b>Organizations &amp; logins</b><span class="muted">${(CLUB.orgs||[]).filter(o=>!o.archived).length} organizations</span><div class="actions"><button class="btn sm" data-go2="orgs">Organizations</button>${canManageLogins()?`<button class="btn sm" data-go2="logins">Logins</button>`:''}</div></div>
    </div></div>`:''}
    ${club?'':`<div class="card pad"><b>Restaurants, the shop, billing and facilities</b> are set up by the club on its own hub; this organization’s Settings cover its own branding and e-mail.</div>`}`;
  m.querySelectorAll('[data-st]').forEach(x=>x.onclick=()=>{ view.stab=x.dataset.st; render(); });
  const up=$('stLogo'); if(up) up.onchange=()=>{ const f=up.files[0]; if(!f) return; logoFromFile(f).then(br=>{ db.brand=Object.assign(db.brand||{},br); persist(); toast('Logo saved'); render(); }).catch(e=>toast(e.message||'Couldn’t read that image')); };
  const lx=$('stLogoX'); if(lx) lx.onclick=()=>{ if(!confirm('Remove the logo?')) return; delete db.brand.logo; delete db.brand.w; delete db.brand.h; persist(); render(); };
  const sm=$('stMail'); if(sm) sm.onclick=mailDrawer; const st=$('stTest'); if(st) st.onclick=async()=>{ const to=prompt('Send a test e-mail to',(typeof ACCESS!=='undefined'&&ACCESS&&ACCESS.email)||''); if(!to) return; const r=await sendMail({to,subject:`${db.name} — test e-mail`,text:`This is a test from ${db.name}’s hub. If you can read it, outgoing e-mail is working.`,html:mailHTML({title:'Test e-mail',paragraphs:[`This is a test from ${esc(db.name)}’s hub. If you can read it, outgoing e-mail is working.`]})}); toast(r.error?stripeMsgLike(r.error):'Sent — check the inbox'); };
  m.querySelectorAll('[data-stab]').forEach(x=>x.onclick=()=>{ view.stab=x.dataset.stab; render(); });
  m.querySelectorAll('[data-go2]').forEach(x=>x.onclick=()=>go(x.dataset.go2));
}
const stripeMsgLike=e=>/not configured|Failed to send a request|404|not found/i.test(e||'')?'The mail function isn’t deployed or has no key yet (docs/tenancy.md)':e;
/* a logo file → a PNG data URL no larger than 600 px on its long side, with its size */
function logoFromFile(file){ return new Promise((res,rej)=>{ if(file.size>6e6) return rej(new Error('That file is over 6 MB')); const url=URL.createObjectURL(file), img=new Image();
  img.onload=()=>{ const k=Math.min(1,600/Math.max(img.naturalWidth,img.naturalHeight)); const w=Math.max(1,Math.round(img.naturalWidth*k)), h=Math.max(1,Math.round(img.naturalHeight*k)); const c=document.createElement('canvas'); c.width=w; c.height=h; c.getContext('2d').drawImage(img,0,0,w,h); URL.revokeObjectURL(url); res({logo:c.toDataURL('image/png'),w,h,at:new Date().toISOString()}); };
  img.onerror=()=>{ URL.revokeObjectURL(url); rej(new Error('Couldn’t read that image')); }; img.src=url; }); }
function mailDrawer(){ const r=MAILS.row||{};
  openDrawer({kicker:'Settings',title:'Outgoing e-mail',wide:true,
    body:pair(field('From name','mlN',r.from_name||db.name),field('From address','mlF',r.from_email||'',{ph:'statements@wcccmga.org'}))+field('Replies go to','mlR',r.reply_to||'',{ph:'office@wcccmga.org'})+
      field('Sent through','mlP',r.provider||'resend',{type:'select',options:[['resend','Flagstick’s mailer (your domain verified with Flagstick)'],['m365','Microsoft 365 — straight from your own mailbox']]})+
      `<div id="mlM" ${(r.provider||'resend')==='m365'?'':'hidden'}>${field('Mailbox that sends','mlBox',r.mailbox||'',{ph:'statements@wcccmga.org'})}${pair(field('Azure tenant id','mlT',r.m365_tenant||''),field('App (client) id','mlC',r.m365_client||''))}${field('Client secret','mlS','',{type:'password',ph:r.m365_secret?'•••••• (saved — enter to replace)':'from the app registration'})}
      <p class="hint">In Azure: App registrations → New → API permissions → Microsoft Graph → Application → <b>Mail.Send</b> → grant admin consent → Certificates &amp; secrets → new client secret. Optionally limit the app to this mailbox with an Exchange application access policy. The hub stores the ids here and the secret write-only; only the mail function reads it.</p></div>`,
    wire:x=>{ x.querySelector('#mlP').onchange=()=>{ x.querySelector('#mlM').hidden=fv('mlP')!=='m365'; }; },
    save:async()=>{ const from=fv('mlF'); if(from&&!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(from)){ toast('Check the from address'); return false; }
      const row={provider:fv('mlP'),from_name:fv('mlN'),from_email:from||null,reply_to:fv('mlR')||null,mailbox:fv('mlBox')||null,m365_tenant:fv('mlT')||null,m365_client:fv('mlC')||null}; if(fv('mlS')) row.m365_secret=fv('mlS');
      if(!(await mailSave(row))) return false; toast('E-mail settings saved'); }}); }
