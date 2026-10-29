/* ============ Staff across departments (module 'club' — the club hub, staff only) ============
   One staff list for the whole club: CLUB.staff = [{id, name, role, depts:['golf','racket','aquatics','fnb','club'],
   outlets ([] = every register of the department), pin (sha256 of tenant:pin — the same PIN unlocks a register and
   clocks in), email (their hub login, if any), active}]. The old CLUB.pos.staff is folded in on first read.
   The schedule builder: CLUB.shifts = [{id, staffId, dept, date, start, end, where, note}] — a week per department,
   copied forward, printed. The time clock: rows in staff_clock (staff-setup.sql), written from a clock kiosk
   (clock.html?k=TOKEN — a pos_stations row of kind 'clock' bound to a department) or a register's lock screen through
   staff_clock(key, pin, action); the hub reads them for who is on now and the hours of the week. */
const ST={dept:'',week:'',clock:null,loading:false,at:0}; CACHE_RESETS.push(()=>{ if(!ST.loading) ST.clock=null; });
const STAFF_ROLES=[['server','Server'],['bartender','Bartender'],['manager','Manager — can leave a station and void checks'],['pro','Pro / instructor'],['attendant','Attendant'],['lifeguard','Lifeguard'],['staff','Staff']];
/* a nonprofit's people are board and committee members, staff and volunteers — "users", under Settings (the owner, Oct 29) */
const NP_ROLES=[['board','Board member'],['committee','Committee member'],['staff','Staff'],['volunteer','Volunteer'],['manager','Manager — can leave a register and void checks']];
const staffRoles=()=>typeof isNonprofit==='function'&&isNonprofit()?NP_ROLES:STAFF_ROLES;
const ROLE_NAME=Object.fromEntries(STAFF_ROLES.concat(NP_ROLES).map(([k,l])=>[k,l.split(' — ')[0]]));
const npUsers=()=>typeof isNonprofit==='function'&&isNonprofit();
const staffOn=()=>!!CLUB&&isClub()&&(hasModule('club')||hasModule('pos'))&&!KEYMODE&&!SCOPED;
const deptName=k=>k?((DEPTS.find(d=>d[0]===k)||[])[1]||k):'Every department';
/* the list, with the old restaurant-only list folded in once */
function clubStaff(){ if(!CLUB) return []; CLUB.staff=Array.isArray(CLUB.staff)?CLUB.staff:[]; const P=CLUB.pos;
  if(P&&Array.isArray(P.staff)&&P.staff.length){ P.staff.forEach(x=>{ if(!CLUB.staff.some(y=>y.id===x.id)) CLUB.staff.push(Object.assign({depts:['fnb']},x)); }); P.staff=[]; }
  CLUB.staff.forEach(x=>{ x.depts=(x.depts||[]).map(d=>d==='tennis'?'racket':d==='pool'?'aquatics':d); x.outlets=x.outlets||[]; if(x.active==null) x.active=true; });
  return CLUB.staff; }
const staffOf=dept=>clubStaff().filter(x=>!dept||!x.depts.length||x.depts.includes(dept));
const staffById=id=>clubStaff().find(x=>x.id===id);
function clubShifts(){ CLUB.shifts=Array.isArray(CLUB.shifts)?CLUB.shifts:[]; return CLUB.shifts; }
/* ---- weeks ---- */
const weekStart=iso=>{ const d=new Date((iso||todayISO())+'T12:00'); const wd=(d.getDay()+6)%7; d.setDate(d.getDate()-wd); return d.toISOString().slice(0,10); };
const weekDays=ws=>Array.from({length:7},(_,i)=>isoPlus(ws,i));
const shiftHours=s=>Math.max(0,(mins(s.end)-mins(s.start))/60);
const hoursTxt=h=>(Math.round(h*100)/100).toFixed(2).replace(/\.?0+$/,'')+' h';
const clockHours=r=>Math.max(0,(new Date(r.out_at||Date.now())-new Date(r.in_at))/36e5);
/* ---- the time clock rows ---- */
const clkKey=()=>'fs_clock_'+((typeof TENANT!=='undefined'&&TENANT)||'local');
async function clockLoad(force){ if(ST.loading) return PENDING; if(ST.clock&&!force) return; ST.loading=true;
  try{ if(!acctCloud()){ try{ ST.clock=JSON.parse(localStorage.getItem(clkKey())||'[]'); }catch(_){ ST.clock=[]; } } else { const r=await tq(sb.from('staff_clock').select('*').gte('in_at',new Date(Date.now()-45*864e5).toISOString())); ST.clock=r.error?[]:(r.data||[]); } ST.at=Date.now(); } finally{ ST.loading=false; } }
async function clockFix(row,patch){ if(acctCloud()){ const {error}=await sb.from('staff_clock').update(patch).eq('id',row.id); if(error){ toast(error.message); return false; } } Object.assign(row,patch); if(!acctCloud()){ try{ localStorage.setItem(clkKey(),JSON.stringify(ST.clock)); }catch(_){} } return true; }
/* ---- the page: a department's people, their week, who is on the clock ---- */
function vStaff(m){ if(!staffOn()){ go('dash'); return; } if(STN.rows==null){ if(!STN.loading) stnLoad().then(()=>render()); } if(ST.clock==null){ if(!ST.loading) clockLoad().then(()=>render()); } else if(acctCloud()&&Date.now()-ST.at>30000&&!ST.loading) clockLoad(true).then(()=>{ if(view.page==='staff') render(); });
  const dept=ST.dept||'', people=staffOf(dept).sort((a,b)=>a.name.localeCompare(b.name)), ws=ST.week||weekStart(), days=weekDays(ws), SH=clubShifts().filter(s=>!dept||s.dept===dept), CL=ST.clock||[];
  const wk=SH.filter(s=>days.includes(s.date)), onNow=CL.filter(r=>!r.out_at&&(!dept||r.dept===dept)), weekClock=CL.filter(r=>r.in_at.slice(0,10)>=ws&&r.in_at.slice(0,10)<=days[6]&&(!dept||r.dept===dept));
  const shiftsOf=(p,d)=>wk.filter(s=>s.staffId===p.id&&s.date===d).sort((a,b)=>a.start.localeCompare(b.start));
  const whereTxt=s=>s.where?` · ${esc(s.where)}`:'';
  const cols=`grid-template-columns:minmax(150px,1.2fr) repeat(7,minmax(118px,1fr)) 70px`;
  const clockStations=(STN.rows||[]).filter(s=>s.kind==='clock'&&!s.revoked_at&&(!dept||(s.dept||'')===dept));
  m.innerHTML=head(dept?`${deptName(dept)} · staff`:'Staff',dept?'Who works here, the week’s schedule and the time clock.':'Everyone who works at the club, which departments they belong to, their PINs, the schedule and the time clock.',
      btn('Time clock link','sfClock','',I.shield)+btn('Print the week','sfPdf','',I.down)+btn('New person','sfNew','pri',I.plus))+`
    ${dept?'':`<div class="toolbar" style="margin-bottom:14px"><div class="seg">${[['','Everyone']].concat(DEPTS).map(([k,l])=>`<button class="${(ST.dept||'')===k?'on':''}" data-sd="${k}">${l}</button>`).join('')}</div></div>`}
    <div class="grid g3">${kpi('On the clock now',onNow.length,onNow.map(r=>esc(r.name)).join(', ')||'nobody clocked in')}${kpi('Scheduled this week',hoursTxt(sum(wk,shiftHours)),`${wk.length} shift${wk.length===1?'':'s'} · ${new Set(wk.map(s=>s.staffId)).size} people`)}${kpi('Worked this week',hoursTxt(sum(weekClock,clockHours)),`${weekClock.length} clock-in${weekClock.length===1?'':'s'}`)}</div>
    <div class="card" style="overflow:hidden"><div class="cardhead"><div><h2 class="h2">Schedule</h2><span class="muted">Week of ${dateTxt(ws)} — tap a day to add a shift, a shift to change it</span></div><div class="actions"><div class="seg"><button id="wkPrev">‹</button><button id="wkNow">This week</button><button id="wkNext">›</button></div><button class="btn sm" id="wkCopy">Copy last week</button></div></div>
      <div class="tw"><div class="t keep" style="min-width:1120px"><div class="tr th" style="${cols}"><span>Person</span>${days.map(d=>`<span>${new Date(d+'T12:00').toLocaleDateString('en-US',{weekday:'short',month:'numeric',day:'numeric'})}</span>`).join('')}<span class="r">Hours</span></div>
        ${people.map(p=>`<div class="tr" style="${cols};align-items:stretch"><div class="cell2" style="justify-content:center"><b>${esc(p.name)}</b><small>${esc(ROLE_NAME[p.role]||p.role||'')}${p.depts.length&&!dept?' · '+p.depts.map(deptName).join(', '):''}</small></div>
          ${days.map(d=>`<div class="shc" data-sday="${p.id}|${d}">${shiftsOf(p,d).map(s=>`<button class="shift" data-sh="${s.id}"><b>${t12s(s.start)}–${t12s(s.end)}</b><small>${dept?'':esc(deptName(s.dept))}${whereTxt(s)}</small></button>`).join('')}</div>`).join('')}
          <span class="r num" style="align-self:center"><b>${hoursTxt(sum(wk.filter(s=>s.staffId===p.id),shiftHours))}</b></span></div>`).join('')||`<div class="empty"><b>Nobody here yet</b><span>Add the people who work ${dept?'in '+deptName(dept).toLowerCase():'at the club'} and build the week.</span></div>`}
      </div></div></div>
    <div class="grid g2">
      <div class="card" style="overflow:hidden"><div class="cardhead"><div><h2 class="h2">Time clock</h2><span class="muted">${clockStations.length?clockStations.map(s=>esc(s.name)).join(' · '):'No clock kiosk yet — make a link, or clock in at any register'}</span></div><div class="actions"><button class="btn sm" id="sfCsv">Timesheet CSV</button></div></div>
        <div class="t fit"><div class="tr th" style="grid-template-columns:1fr 190px 90px"><span>Person</span><span>Now</span><span class="r">This week</span></div>
        ${people.map(p=>{ const open=onNow.find(r=>r.staff_id===p.id), h=sum(weekClock.filter(r=>r.staff_id===p.id),clockHours); return `<div class="tr num" style="grid-template-columns:1fr 190px 90px"><span>${esc(p.name)}</span><span style="white-space:nowrap">${open?`<span class="pos">in since ${new Date(open.in_at).toLocaleTimeString('en-US',{hour:'numeric',minute:'2-digit'})}</span> <button class="lnk" data-cout="${open.id}">out</button>`:'<span class="muted">—</span>'}</span><b class="r">${h?hoursTxt(h):'—'}</b></div>`; }).join('')}
        ${weekClock.filter(r=>!people.some(p=>p.id===r.staff_id)).length?`<p class="hint" style="padding:10px 22px">Also on the clock: ${[...new Set(weekClock.filter(r=>!people.some(p=>p.id===r.staff_id)).map(r=>esc(r.name)))].join(', ')}</p>`:''}</div></div>
      <div class="card" style="overflow:hidden"><div class="cardhead"><div><h2 class="h2">People</h2><span class="muted">PINs unlock registers and the time clock</span></div></div>
        <div class="t fit"><div class="tr th" style="grid-template-columns:minmax(120px,1.3fr) 100px minmax(100px,1.4fr) 50px"><span>Name</span><span>Role</span><span>${dept?'Also in':'Departments'}</span><span>PIN</span></div>
        ${people.map(x=>`<button class="tr${x.active===false?' void':''}" data-se="${x.id}" style="grid-template-columns:minmax(120px,1.3fr) 100px minmax(100px,1.4fr) 50px;text-align:left;background:none;border-left:none;border-right:none;width:100%"><div class="cell2"><b>${esc(x.name)}</b>${x.email?`<small>${esc(x.email)}</small>`:''}</div><span>${esc(ROLE_NAME[x.role]||x.role||'')}</span><span class="muted" style="font-size:12.5px">${x.depts.length?x.depts.filter(d=>d!==dept).map(deptName).join(', ')||'—':'every department'}</span><span>${x.pin?'<span class="pos">set</span>':'<span class="neg">none</span>'}</span></button>`).join('')}</div></div>
    </div>`;
  m.querySelectorAll('[data-sd]').forEach(b=>b.onclick=()=>{ ST.dept=b.dataset.sd; render(); });
  $('wkPrev').onclick=()=>{ ST.week=isoPlus(ws,-7); render(); }; $('wkNext').onclick=()=>{ ST.week=isoPlus(ws,7); render(); }; $('wkNow').onclick=()=>{ ST.week=''; render(); };
  $('wkCopy').onclick=()=>copyLastWeek(ws,dept); $('sfNew').onclick=()=>staffMemberDrawer(null,dept); $('sfPdf').onclick=()=>schedulePDF(ws,dept); $('sfCsv').onclick=()=>timesheetCSV(ws,dept); $('sfClock').onclick=()=>clockLinkDrawer(dept);
  m.querySelectorAll('[data-sday]').forEach(c=>c.onclick=e=>{ if(e.target.closest('[data-sh]')) return; const [pid,d]=c.dataset.sday.split('|'); shiftDrawer(null,{staffId:pid,date:d,dept:dept||(staffById(pid)||{depts:[]}).depts[0]||'club'}); });
  m.querySelectorAll('[data-sh]').forEach(b=>b.onclick=()=>shiftDrawer(clubShifts().find(s=>s.id===b.dataset.sh)));
  m.querySelectorAll('[data-se]').forEach(b=>b.onclick=()=>staffMemberDrawer(staffById(b.dataset.se),dept));
  m.querySelectorAll('[data-cout]').forEach(b=>b.onclick=async()=>{ const r=(ST.clock||[]).find(x=>x.id===b.dataset.cout); if(!r||!confirm(`Clock ${r.name} out now?`)) return; if(await clockFix(r,{out_at:new Date().toISOString(),note:'clocked out from the hub'})){ toast('Clocked out'); render(); } });
}
const t12s=t=>t12(t).replace(':00','').replace(' ','');
/* ---- a person ---- */
function staffMemberDrawer(x,dept){ const outs=posOn()?posSettings().outlets:[]; const logins=typeof LOGINS!=='undefined'&&LOGINS&&Array.isArray(LOGINS.rows)?LOGINS.rows:[]; const np=npUsers();
  const dsel=x?x.depts:(dept?[dept]:[]);
  openDrawer({kicker:np?'Users':'Staff',title:x?x.name:np?'New user':'New person',wide:true,
    body:pair(field('Name','sfN',x?x.name:'',{ph:np?'Full name':'First name, as the kitchen and the schedule see it'}),field('Role','sfR',x?x.role:np?'board':(dept==='fnb'||!dept?'server':dept==='golf'||dept==='racket'?'pro':dept==='aquatics'?'lifeguard':'staff'),{type:'select',options:staffRoles()}))+
      (np?field('Title or committee','sfT',x?x.title||'':'',{ph:'Treasurer · Gala committee · Tournament chair'}):'')+
      (np?'':`<div class="fld"><span class="lbl">Departments</span><div class="chips">${DEPTS.map(([k,l])=>`<label class="check" style="margin:0"><input type="checkbox" data-sdp="${k}"${dsel.includes(k)?' checked':''}>${l}</label>`).join('')}</div><p class="hint">Their schedule, time clock and registers follow these. Nothing ticked = everywhere.</p></div>`)+
      (outs.length>1?`<div class="fld"><span class="lbl">Registers they may unlock</span><div class="chips">${outs.map(o=>`<label class="check" style="margin:0"><input type="checkbox" data-so="${o.id}"${!x||!x.outlets.length||x.outlets.includes(o.id)?' checked':''}>${esc(o.name)}</label>`).join('')}</div></div>`:'')+
      pair(field(np?'Register PIN (optional)':'PIN','sfP','',{type:'password',ph:x&&x.pin?'•••• (set — enter to change)':'4 to 6 digits',hint:np?'Only needed to unlock the register at an event. Stored hashed; nobody can read it back.':'Unlocks a register and clocks in. Stored hashed; nobody can read it back.'}),field(np?'Login e-mail':'Hub login e-mail (optional)','sfE',x?x.email||'':'',{ph:np?'pat@foundation.org':'sam@club.com',hint:np?'Their sign-in to this hub, if they have one — logins are below on this page.':logins.length?'Ties this person to their staff login.':''}))+
      `<label class="check"><input type="checkbox" id="sfA"${!x||x.active!==false?' checked':''}>Active</label>`,
    save:async()=>{ const name=fv('sfN'); if(!name){ toast('Name them'); return false; } const pin=fv('sfP'); if(pin&&!/^\d{4,6}$/.test(pin)){ toast('PIN: 4 to 6 digits'); return false; } if(!x&&!pin&&!np){ toast('Set a PIN'); return false; }
      const depts=[...$('dBody').querySelectorAll('[data-sdp]')].filter(c=>c.checked).map(c=>c.dataset.sdp), soBoxes=[...$('dBody').querySelectorAll('[data-so]')], picked=soBoxes.filter(c=>c.checked).map(c=>c.dataset.so);
      const d={name,role:fv('sfR'),depts,outlets:!soBoxes.length||picked.length===outs.length?[]:picked,email:fv('sfE').trim().toLowerCase()||null,active:$('sfA').checked}; if(np) d.title=fv('sfT').trim();
      if(pin){ const h=await pinHash(pin); if(clubStaff().some(y=>y!==x&&y.pin===h)){ toast('That PIN is already in use — pick another'); return false; } d.pin=h; }
      if(x) Object.assign(x,d); else clubStaff().push(Object.assign({id:uid()},d)); persist(); },
    del:x?()=>{ if(!confirm(`Remove ${x.name}? Their shifts and clock-ins stay on record.`)) return false; const S=clubStaff(); S.splice(S.indexOf(x),1); persist(); }:null}); }
/* Settings → Users for a nonprofit: the people (board, committees, staff, volunteers), then who can sign in */
function usersCards(m){ const people=clubStaff().slice().sort((a,b)=>a.name.localeCompare(b.name)), logins=(typeof HL!=='undefined'&&HL.rows)||[];
  const box=document.createElement('div'); box.className='card'; box.style.overflow='hidden';
  box.innerHTML=`<div class="cardhead"><div><h2 class="h2">Users</h2><span class="muted">Board and committee members, staff and volunteers — who they are, their role, and whether they sign in</span></div><div class="actions">${btn('New user','usNew','pri',I.plus)}</div></div>
    <div class="t fit"><div class="tr th" style="grid-template-columns:minmax(140px,1.4fr) 130px minmax(120px,1.2fr) 110px 70px"><span>Name</span><span>Role</span><span>Title / committee</span><span>Signs in</span><span>PIN</span></div>
    ${people.map(x=>{ const lg=x.email&&logins.find(u=>(u.email||'').toLowerCase()===x.email); return `<button class="tr${x.active===false?' void':''}" data-us="${x.id}" style="grid-template-columns:minmax(140px,1.4fr) 130px minmax(120px,1.2fr) 110px 70px;text-align:left;background:none;border-left:none;border-right:none;width:100%"><div class="cell2"><b>${esc(x.name)}</b>${x.email?`<small>${esc(x.email)}</small>`:''}</div><span>${esc(ROLE_NAME[x.role]||x.role||'')}</span><span class="muted trunc">${esc(x.title||'')}</span><span>${lg?'<span class="pos">yes</span>':x.email&&typeof iAmStaff==='function'&&iAmStaff()?`<span role="button" data-mklogin="${x.id}" style="color:var(--gold-dk,#7E5F1A);font-weight:700;text-decoration:underline;cursor:pointer">Create login</span>`:x.email?'<span class="muted">no login yet</span>':'<span class="muted">—</span>'}</span><span>${x.pin?'<span class="pos">set</span>':'<span class="muted">—</span>'}</span></button>`; }).join('')||'<div class="empty"><b>No users yet</b><span>Add the board, the committee chairs and anyone who works the events.</span></div>'}</div>`;
  m.appendChild(box); box.querySelector('#usNew').onclick=()=>staffMemberDrawer(null,''); box.querySelectorAll('[data-us]').forEach(b=>b.onclick=()=>staffMemberDrawer(staffById(b.dataset.us),''));
  box.querySelectorAll('[data-mklogin]').forEach(l=>l.onclick=ev=>{ ev.stopPropagation(); const x=staffById(l.dataset.mklogin); staffLoginDrawer(null,{email:x.email,name:x.name}); });
  if(typeof staffLoginsCard==='function'&&canManageLogins()) staffLoginsCard(m,{title:'Logins',note:'Who can sign in to this hub. New login: set the e-mail and a password, or e-mail an invite. A user above with the same e-mail is tied to their login.'}); }
/* ---- a shift ---- */
function shiftDrawer(s,init){ const d=s?clone(s):Object.assign({id:uid(),staffId:'',dept:'club',date:todayISO(),start:'09:00',end:'17:00',where:'',note:''},init||{}); const people=clubStaff().filter(x=>x.active!==false).sort((a,b)=>a.name.localeCompare(b.name)); const p=staffById(d.staffId);
  const places=[].concat(posOn()?posSettings().outlets.filter(o=>d.dept==='fnb'?o.kind==='fnb':o.kind==='proshop'&&outletDept(o)===d.dept).map(o=>o.name):[],bookOn()?bookSettings().facilities.filter(f=>facDept(f)===d.dept).map(f=>f.name):[]);
  openDrawer({kicker:'Schedule',title:s?`${(p||{}).name||'Shift'} · ${dateTxt(d.date)}`:'New shift',
    body:pair(field('Who','shP',d.staffId,{type:'select',options:people.map(x=>[x.id,x.name])}),field('Department','shD',d.dept,{type:'select',options:DEPTS}))+pair(field('Date','shDt',d.date,{type:'date'}),field('Where (optional)','shW',d.where||'',{ph:places.slice(0,3).join(' · ')||'Grill · Pro shop · Pool deck',list:places}))+
      pair(field('Starts','shS',d.start,{type:'time'}),field('Ends','shE',d.end,{type:'time'}))+field('Note','shN',d.note||'',{ph:'Opening · closing · covering for Mia'})+
      `<div class="fld"><span class="lbl">Repeat</span><div class="chips">${[['','Just this day'],['wk','Same day for the next 4 weeks'],['mf','Monday to Friday this week']].map(([k,l],i)=>`<label class="check" style="margin:0"><input type="radio" name="shRep" value="${k}"${i===0?' checked':''}>${l}</label>`).join('')}</div></div>`,
    save:()=>{ d.staffId=fv('shP'); d.dept=fv('shD'); d.date=fv('shDt')||d.date; d.start=fv('shS')||'09:00'; d.end=fv('shE')||'17:00'; d.where=fv('shW'); d.note=fv('shN'); if(!d.staffId){ toast('Who is working?'); return false; } if(mins(d.end)<=mins(d.start)){ toast('It has to end after it starts'); return false; }
      const rep=($('dBody').querySelector('[name=shRep]:checked')||{}).value||''; const L=clubShifts(); if(s) Object.assign(s,d); else L.push(d);
      if(rep==='wk') for(let k=1;k<=4;k++) L.push(Object.assign({},d,{id:uid(),date:isoPlus(d.date,7*k)}));
      if(rep==='mf'){ const ws=weekStart(d.date); for(let k=0;k<5;k++){ const dd=isoPlus(ws,k); if(dd!==d.date&&!L.some(x=>x.staffId===d.staffId&&x.date===dd&&x.start===d.start)) L.push(Object.assign({},d,{id:uid(),date:dd})); } }
      persist(); },
    del:s?()=>{ const L=clubShifts(); L.splice(L.indexOf(s),1); persist(); }:null}); }
function copyLastWeek(ws,dept){ const L=clubShifts(), prev=weekDays(isoPlus(ws,-7)), src=L.filter(s=>prev.includes(s.date)&&(!dept||s.dept===dept)); if(!src.length){ toast('Last week is empty'); return; }
  const cur=weekDays(ws); let n=0; src.forEach(s=>{ const date=cur[prev.indexOf(s.date)]; if(L.some(x=>x.staffId===s.staffId&&x.date===date&&x.start===s.start)) return; L.push(Object.assign({},s,{id:uid(),date})); n++; }); persist(); toast(n?`${n} shift${n===1?'':'s'} copied`:'This week already has them'); render(); }
/* ---- the clock kiosk link: a station of kind 'clock' for a department ---- */
function clockLinkDrawer(dept){ openDrawer({kicker:'Time clock',title:'New time clock link',saveLabel:'Create the link',
    body:field('Name','ckN','',{ph:dept?`${deptName(dept)} time clock`:'Back door time clock'})+field('Department','ckD',dept||'',{type:'select',options:[['','Every department']].concat(DEPTS)})+'<p class="hint">Open the link once on a tablet or PC by the door; it stays on. Staff tap in their PIN and clock in or out. Anyone may also clock in from a register’s lock screen.</p>',
    save:async()=>{ const name=fv('ckN'); if(!name){ toast('Name it'); return false; } try{ const r=await newStation({id:null},'clock',name,null,fv('ckD')||null); setTimeout(()=>stationLinkModal(r),50); }catch(e){ toast(e.message); return false; } }}); }
/* ---- the printed week ---- */
async function schedulePDF(ws,dept){ try{ await loadJsPDF(); }catch(e){ toast(e.message); return; } const crest=await crestPNG().catch(()=>null), doc=new window.jspdf.jsPDF({unit:'pt',format:'letter',orientation:'landscape'}); bcFonts(doc);
  const NAVY=[15,42,56],GOLD=[199,161,58],GOLDL=[216,183,95],GOLDDK=[126,95,26],IVORY=[251,250,245],INK=[20,34,43],MUTED=[86,98,106]; const L=36,W=792,H=612,R=W-36, font=(f,s,z,c)=>{ doc.setFont(f,s); doc.setFontSize(z); doc.setTextColor(...c); };
  const days=weekDays(ws), people=staffOf(dept).sort((a,b)=>a.name.localeCompare(b.name)), SH=clubShifts().filter(s=>days.includes(s.date)&&(!dept||s.dept===dept));
  const page=()=>{ doc.setFillColor(...IVORY); doc.rect(0,0,W,H,'F'); doc.setFillColor(...GOLD); doc.roundedRect(L,24,R-L,70,8,8,'F'); doc.setFillColor(...NAVY); doc.roundedRect(L,24,R-L,66,8,8,'F'); doc.rect(L,80,R-L,8,'F'); const lw=drawCrest(doc,crest,L+14,32,46), TX=L+14+(lw||38)+12;
    font('PublicSansXB','normal',6.8,GOLDL); doc.text(String(brandName()).toUpperCase(),TX,46,{charSpace:1.2}); font('Cormorant','bold',22,[255,255,255]); doc.text(`${dept?deptName(dept)+' — ':''}Schedule · week of ${dateTxt(ws)}`,TX,70); return 112; };
  let y=page(); const nameW=120, cw=(R-L-nameW-50)/7;
  const hdr=()=>{ font('PublicSansXB','normal',7,GOLDDK); doc.text('PERSON',L,y,{charSpace:1}); days.forEach((d,i)=>doc.text(new Date(d+'T12:00').toLocaleDateString('en-US',{weekday:'short',month:'numeric',day:'numeric'}).toUpperCase(),L+nameW+i*cw,y,{charSpace:1})); doc.text('HOURS',R,y,{align:'right',charSpace:1}); y+=5; doc.setDrawColor(...GOLD); doc.setLineWidth(1); doc.line(L,y,R,y); y+=12; };
  hdr();
  for(const p of people){ const cells=days.map(d=>SH.filter(s=>s.staffId===p.id&&s.date===d).sort((a,b)=>a.start.localeCompare(b.start)).map(s=>`${t12s(s.start)}–${t12s(s.end)}${s.where?' '+s.where:''}`)); const h=Math.max(1,...cells.map(c=>c.length))*11+8;
    if(y+h>H-40){ doc.addPage(); y=page(); hdr(); } font('PublicSans','bold',9.5,INK); doc.text(p.name,L,y); font('PublicSans','normal',8.6,INK); cells.forEach((c,i)=>{ c.forEach((t,j)=>doc.text(doc.splitTextToSize(t,cw-6)[0],L+nameW+i*cw,y+j*11)); }); font('PublicSans','bold',9,INK); doc.text(hoursTxt(sum(SH.filter(s=>s.staffId===p.id),shiftHours)),R,y,{align:'right'}); y+=h; doc.setDrawColor(225,217,198); doc.setLineWidth(.5); doc.line(L,y-5,R,y-5); }
  font('PublicSans','normal',7,MUTED); doc.text(`${brandName()} · printed ${new Date().toLocaleString('en-US',{month:'short',day:'numeric',hour:'numeric',minute:'2-digit'})}`,W/2,H-22,{align:'center'});
  doc.save(`schedule-${ws}${dept?'-'+dept:''}.pdf`); }
function timesheetCSV(ws,dept){ const days=weekDays(ws), rows=(ST.clock||[]).filter(r=>r.in_at.slice(0,10)>=ws&&r.in_at.slice(0,10)<=days[6]&&(!dept||r.dept===dept)).sort((a,b)=>a.name.localeCompare(b.name)||a.in_at.localeCompare(b.in_at)); if(!rows.length){ toast('No clock-ins this week'); return; }
  const qq=v=>'"'+String(v??'').replace(/"/g,'""')+'"'; const L=[['Name','Department','In','Out','Hours']].concat(rows.map(r=>[r.name,deptName(r.dept),r.in_at,r.out_at||'',clockHours(r).toFixed(2)]));
  const by={}; rows.forEach(r=>{ by[r.name]=(by[r.name]||0)+clockHours(r); }); L.push([],['Totals','','','','']); Object.entries(by).forEach(([n,h])=>L.push([n,'','','',h.toFixed(2)]));
  dl(L.map(r=>r.map(qq).join(',')).join('\n'),'text/csv',`timesheet-${ws}${dept?'-'+dept:''}.csv`); }
