/* ============ Bookings (module 'club' — the club hub, staff only; members book from the portal) ============
   One sheet per facility: the tee sheet (per course), tennis and pickleball courts, the pool, lessons (per instructor),
   rooms. CLUB.booking.facilities holds each facility's rules (hours, slot length, how many per slot, how far ahead
   members may book, a fee); bookings are rows in `bookings` (booking-setup.sql). Staff book on the sheet, check people
   in, cancel; a facility fee lands on the member's account (ref bk:<booking>). The portal's Book card and the
   member_* functions let members do it themselves inside the same rules. */
const BK={rows:null,loading:false,at:0,fac:'',date:''};
const bookOn=()=>!!CLUB&&isClub()&&hasModule('club')&&!KEYMODE&&!SCOPED;
const bkKey=()=>'fs_book_'+((typeof TENANT!=='undefined'&&TENANT)||'local');
const FAC_KINDS=[['tee','Tee sheet'],['court','Courts'],['pool','Pool'],['lesson','Lessons'],['room','Rooms & dining']];
function bookSettings(){ CLUB.booking=CLUB.booking||{}; const b=CLUB.booking;
  if(!Array.isArray(b.facilities)||!b.facilities.length) b.facilities=[
    {id:'tee',name:'Tee sheet',kind:'tee',units:2,unitNames:['Oak','Pecan'],open:'07:00',close:'17:00',slot:10,cap:4,lead:7,members:true,onePerDay:true,fee:null},
    {id:'tennis',name:'Tennis',kind:'court',units:4,open:'07:00',close:'21:00',slot:60,cap:4,lead:7,members:true,onePerDay:true,fee:null},
    {id:'pickle',name:'Pickleball',kind:'court',units:4,open:'07:00',close:'21:00',slot:60,cap:4,lead:7,members:true,onePerDay:true,fee:null},
    {id:'pool',name:'Pool',kind:'pool',units:1,open:'09:00',close:'20:00',slot:60,cap:30,lead:3,members:true,onePerDay:false,fee:null},
    {id:'lessons',name:'Lessons',kind:'lesson',units:1,unitNames:['Pro'],open:'08:00',close:'18:00',slot:30,cap:1,lead:14,members:false,onePerDay:true,fee:{item:'lesson',amount:0,per:'booking'}}];
  b.facilities.forEach(f=>{ f.units=Math.max(1,n0(f.units)||1); f.slot=Math.max(5,n0(f.slot)||60); f.cap=Math.max(1,n0(f.cap)||1); if(f.lead==null) f.lead=7; if(f.members==null) f.members=true; if(f.onePerDay==null) f.onePerDay=true; f.unitNames=f.unitNames||[]; });
  return b; }
const facOf=id=>bookSettings().facilities.find(f=>f.id===id);
const unitName=(f,u)=>f.unitNames[u-1]||(f.kind==='court'?'Court '+u:f.kind==='lesson'?'Instructor '+u:f.units>1?f.name+' '+u:f.name);
const mins=t=>{ const [h,m]=String(t||'00:00').split(':').map(Number); return h*60+(m||0); };
const hhmm=n=>String(Math.floor(n/60)).padStart(2,'0')+':'+String(n%60).padStart(2,'0');
const t12=t=>{ const n=mins(t), h=Math.floor(n/60), m=n%60; return `${((h+11)%12)+1}:${String(m).padStart(2,'0')} ${h<12?'am':'pm'}`; };
function slotsOf(f){ const out=[]; for(let n=mins(f.open); n<mins(f.close); n+=f.slot) out.push(hhmm(n)); return out; }
async function bkLoad(force){ if(BK.loading||(BK.rows&&!force)) return; BK.loading=true;
  try{ if(!acctCloud()){ try{ BK.rows=JSON.parse(localStorage.getItem(bkKey())||'[]'); }catch(_){ BK.rows=[]; } } else { const r=await tq(sb.from('bookings').select('*')); BK.rows=r.error?[]:(r.data||[]); } BK.at=Date.now(); } finally{ BK.loading=false; } }
function bkLocalWrite(){ if(!acctCloud()){ try{ localStorage.setItem(bkKey(),JSON.stringify(BK.rows||[])); }catch(_){} } }
const bkLive=(fid,date)=>(BK.rows||[]).filter(b=>b.facility===fid&&b.date===date&&b.status!=='cancelled');
const bkName=b=>b.member_id?memberName(personById(b.member_id)||{})||b.name||'Member':b.name||'Guest';
const bkCount=b=>Math.max(1,(b.players||[]).length);
/* a staff booking: the row, and the fee on the member's account when the facility charges one */
async function bkSave(b,isNew){ const f=facOf(b.facility); const row=Object.assign({},b);
  if(isNew&&f.fee&&n0(f.fee.amount)>0&&b.member_id&&acctOn()){ const it=itemOf(f.fee.item)||{id:'facility',source:'facility',gl:''}; const amt=f.fee.per==='player'?n0(f.fee.amount)*bkCount(b):n0(f.fee.amount);
    const a=await acctPost({member_id:b.member_id,kind:'charge',source:it.source,item:it.id,gl:it.gl,ref:'bk:'+b.id,descr:`${f.name} · ${dateTxt(b.date)} ${t12(b.time)}${f.fee.per==='player'?' · '+bkCount(b)+' players':''}`,amount:amt,posted:todayISO()}); if(a){ b.acct_item=a.id; row.acct_item=a.id; } }
  if(acctCloud()){ const {error}=await (isNew?sb.from('bookings').insert(trow(row)):sb.from('bookings').update(row).eq('id',b.id)); if(error){ toast('Couldn’t save: '+error.message); return false; } }
  BK.rows=(BK.rows||[]).filter(x=>x.id!==b.id).concat([row]); bkLocalWrite(); return true; }
async function bkCancel(b){ b.status='cancelled'; b.cancelled_at=new Date().toISOString(); if(b.acct_item){ await acctLoad(); const it=(ACCT.items||[]).find(i=>i.id===b.acct_item); if(it&&!it.void_at) await acctVoid(it,'Booking cancelled'); } return bkSave(b,false); }
/* ---------- the sheet ---------- */
function vBookings(m){
  if(!bookOn()){ go('dash'); return; } const S=bookSettings();
  if(BK.rows==null){ bkLoad().then(()=>render()); m.innerHTML=head('Bookings','Loading…'); return; }
  if(acctCloud()&&Date.now()-BK.at>20000&&!BK.loading) bkLoad(true).then(()=>{ if(view.page==='bookings') render(); });
  if(!facOf(BK.fac)) BK.fac=S.facilities[0].id; const f=facOf(BK.fac); if(!BK.date) BK.date=todayISO(); const day=BK.date, rows=bkLive(f.id,day), slots=slotsOf(f);
  const at=(t,u)=>rows.filter(b=>b.time===t&&b.unit===u), units=Array.from({length:f.units},(_,i)=>i+1);
  const cell=(t,u)=>{ const L=at(t,u); const used=sum(L,bkCount), full=f.kind==='tee'?used>=f.cap:L.length>0;
    return `<div class="bc${L.length?' has':''}${full?' full':''}" data-bt="${t}" data-bu="${u}">${L.map(b=>`<button class="bb${b.status==='checked_in'?' in':''}${b.source==='member'?' mem':''}" data-bk="${b.id}"><b>${esc(bkName(b))}</b>${f.kind==='tee'||f.cap>1?`<small>${bkCount(b)}${f.kind==='tee'?' · '+(b.players||[]).slice(1).map(p=>esc((p.name||'').split(' ')[0])).join(', '):''}</small>`:b.note?`<small>${esc(b.note)}</small>`:''}</button>`).join('')}${full?'':`<button class="ba" data-add="${t}|${u}">${L.length?'+':''}</button>`}</div>`; };
  const dayRows=rows.length, people=sum(rows,bkCount), ins=rows.filter(b=>b.status==='checked_in').length;
  m.innerHTML=head('Bookings',`${esc(f.name)} · ${new Date(day+'T12:00').toLocaleDateString('en-US',{weekday:'long',month:'long',day:'numeric'})} — tap a time to book, a name to check in or change it.`,btn('Facilities','bkSet','')+btn('Print the sheet','bkPdf','',I.down)+btn('New booking','bkNew','pri',I.plus))+`
    <div class="toolbar"><div class="seg">${S.facilities.map(x=>`<button class="${x.id===f.id?'on':''}" data-bf="${x.id}">${esc(x.name)}</button>`).join('')}</div><div class="seg" style="margin-left:auto"><button id="bkPrev">‹</button><button id="bkToday">Today</button><button id="bkNext">›</button></div><input class="inp" type="date" id="bkDate" value="${day}" style="height:38px;width:160px"></div>
    <div class="grid g3">${kpi('Booked',dayRows,`${people} ${f.kind==='tee'?'players':'people'}`)}${kpi('Checked in',ins,`${dayRows-ins} to come`)}${kpi('Open',slots.length*f.units-(f.kind==='tee'?0:rows.length),`${f.kind==='tee'?`${slots.length*f.units*f.cap-people} spots`:`of ${slots.length*f.units} ${f.kind==='lesson'?'lesson':'slot'}s`} · ${t12(f.open)}–${t12(f.close)}`)}</div>
    <div class="card sheetwrap" style="--units:${f.units}"><div class="sheet" style="grid-template-columns:84px repeat(${f.units},minmax(150px,1fr))"><div class="sh"></div>${units.map(u=>`<div class="sh">${esc(unitName(f,u))}</div>`).join('')}${slots.map(t=>`<div class="st">${t12(t)}</div>${units.map(u=>cell(t,u)).join('')}`).join('')}</div></div>`;
  m.querySelectorAll('[data-bf]').forEach(x=>x.onclick=()=>{ BK.fac=x.dataset.bf; render(); });
  const shift=n=>{ BK.date=isoPlus(day,n); render(); }; $('bkPrev').onclick=()=>shift(-1); $('bkNext').onclick=()=>shift(1); $('bkToday').onclick=()=>{ BK.date=todayISO(); render(); }; $('bkDate').onchange=()=>{ BK.date=$('bkDate').value||todayISO(); render(); };
  m.querySelectorAll('[data-add]').forEach(x=>x.onclick=()=>{ const [t,u]=x.dataset.add.split('|'); bookingDrawer(null,f,day,t,+u); });
  m.querySelectorAll('[data-bk]').forEach(x=>x.onclick=e=>{ e.stopPropagation(); bookingDrawer(rows.find(b=>b.id===x.dataset.bk),f,day); });
  $('bkNew').onclick=()=>bookingDrawer(null,f,day,slots[0],1); $('bkSet').onclick=()=>go('booksetup'); $('bkPdf').onclick=()=>sheetPDF(f,day);
}
function bookingDrawer(b,f,day,time,unit){
  const isNew=!b; const d=b?clone(b):{id:uid(),facility:f.id,date:day,time:time||slotsOf(f)[0],unit:unit||1,member_id:null,name:'',players:[],note:'',status:'booked',source:'staff',created_by:whoAmI(),created_at:new Date().toISOString()};
  if(!d.players.length&&d.member_id) d.players=[{member_id:d.member_id,name:bkName(d)}];
  const ppl=persons().filter(p=>p.status!=='Inactive').sort((a,c)=>memberName(a).localeCompare(memberName(c)));
  const rowsHTML=()=>d.players.map((p,i)=>`<div class="mr" style="grid-template-columns:minmax(0,1fr) 28px"><span>${esc(p.name||(p.member_id?memberName(personById(p.member_id)||{}):''))}${p.member_id?'':' <span class="muted">· guest</span>'}</span><button class="ib" data-pdel="${i}" type="button" aria-label="Remove">${I.x}</button></div>`).join('')||'<div class="mr muted">Nobody yet</div>';
  openDrawer({kicker:f.name,title:isNew?'New booking':bkName(d)+' · '+t12(d.time),saveLabel:isNew?'Book':'Save',
    body:pair(field('Date','bdD',d.date,{type:'date'}),field('Time','bdT',d.time,{type:'select',options:slotsOf(f).map(t=>[t,t12(t)])}))+(f.units>1?field(f.kind==='lesson'?'Instructor':f.kind==='tee'?'Course':'Unit','bdU',d.unit,{type:'select',options:Array.from({length:f.units},(_,i)=>[i+1,unitName(f,i+1)])}):'')+
      field('Booked by','bdM',d.member_id||'',{type:'select',options:[['','— A guest / the club —']].concat(ppl.map(p=>[p.id,memberName(p)+(p.memberNo?' · #'+p.memberNo:'')]))})+field('Name (when not a member)','bdN',d.name||'',{ph:'Outing · Guest name'})+
      (f.cap>1?`<div class="fld"><div style="display:flex;justify-content:space-between;align-items:center"><span class="lbl">${f.kind==='tee'?'Players':'People'} · up to ${f.cap}</span><span style="display:flex;gap:6px"><input class="inp" id="bdAdd" placeholder="Add a member or guest…" style="height:34px;width:200px" autocomplete="off"></span></div><div class="pick" id="bdAddL" style="display:none;max-height:180px"></div><div class="mini" id="bdRows">${rowsHTML()}</div></div>`:'')+
      field('Note','bdNt',d.note||'',{ph:'Cart · walking · birthday'})+(isNew&&f.fee&&n0(f.fee.amount)>0?`<p class="hint">Fee: ${fmt2(f.fee.amount)} ${f.fee.per==='player'?'per player':'per booking'}, posted to the member’s account when booked.</p>`:'')+(!isNew&&d.source==='member'?'<p class="hint">Booked by the member in the portal.</p>':''),
    wire:r=>{ const bind=()=>r.querySelectorAll('[data-pdel]').forEach(x=>x.onclick=()=>{ d.players.splice(+x.dataset.pdel,1); r.querySelector('#bdRows').innerHTML=rowsHTML(); bind(); }); bind();
      const a=r.querySelector('#bdAdd'); if(a){ const L=r.querySelector('#bdAddL'); a.oninput=()=>{ const s=a.value.toLowerCase().trim(); if(!s){ L.style.display='none'; return; } const hits=ppl.filter(p=>[memberName(p),p.memberNo||''].join(' ').toLowerCase().includes(s)).slice(0,6);
        L.innerHTML=hits.map(p=>`<button type="button" data-pk="${p.id}"><span class="av">${initials(p)}</span><b>${esc(memberName(p))}</b></button>`).join('')+`<button type="button" data-pg="1"><span class="av">G</span><b>Guest: “${esc(a.value.trim())}”</b></button>`; L.style.display='';
        const add=p=>{ if(d.players.length>=f.cap){ toast(`At most ${f.cap}`); return; } d.players.push(p); if(!d.member_id&&p.member_id){ d.member_id=p.member_id; r.querySelector('#bdM').value=p.member_id; } a.value=''; L.style.display='none'; r.querySelector('#bdRows').innerHTML=rowsHTML(); bind(); };
        L.querySelectorAll('[data-pk]').forEach(x=>x.onclick=()=>add({member_id:x.dataset.pk,name:memberName(personById(x.dataset.pk))})); L.querySelector('[data-pg]').onclick=()=>add({name:a.value.trim()}); }; }
      r.querySelector('#bdM').onchange=()=>{ const id=r.querySelector('#bdM').value; d.member_id=id||null; if(id&&!d.players.some(p=>p.member_id===id)){ d.players.unshift({member_id:id,name:memberName(personById(id))}); if(d.players.length>f.cap) d.players.length=f.cap; const rr=r.querySelector('#bdRows'); if(rr){ rr.innerHTML=rowsHTML(); bind(); } } }; },
    save:async()=>{ d.date=fv('bdD')||day; d.time=fv('bdT'); d.unit=f.units>1?+fv('bdU')||1:1; d.member_id=fv('bdM')||null; d.name=fv('bdN'); d.note=fv('bdNt'); if(!d.member_id&&!d.name&&!d.players.length){ toast('Who is it for?'); return false; }
      if(!d.players.length) d.players=[{member_id:d.member_id,name:d.member_id?memberName(personById(d.member_id)):d.name}]; if(!d.name&&!d.member_id) d.name=d.players[0].name;
      const others=bkLive(f.id,d.date).filter(x=>x.id!==d.id&&x.time===d.time&&x.unit===d.unit); const used=sum(others,bkCount); if(f.kind==='tee'?used+bkCount(d)>f.cap:others.length){ toast(f.kind==='tee'?`Only ${f.cap-used} spot${f.cap-used===1?'':'s'} left at ${t12(d.time)}`:`${t12(d.time)} is taken`); return false; }
      if(!(await bkSave(d,isNew))) return false; if(b) Object.assign(b,d); toast(isNew?'Booked':'Saved'); },
    del:b?async()=>{ if(b.status==='checked_in'){ if(!confirm('Cancel a checked-in booking?')) return false; } await bkCancel(b); toast('Cancelled'); }:null,delLabel:'Cancel booking',delPlain:true});
  if(b&&b.status!=='checked_in'){ const foot=$('dFoot').querySelector('.actions'); const ci=document.createElement('button'); ci.className='btn'; ci.textContent='Check in'; ci.onclick=async()=>{ b.status='checked_in'; if(await bkSave(b,false)){ closeDrawer(); render(); toast('Checked in'); } }; foot.prepend(ci); }
}
/* ---------- facilities setup ---------- */
function vBookSetup(m){ if(!bookOn()){ go('dash'); return; } const S=bookSettings();
  m.innerHTML=`<div class="crumb"><button id="bsBk">Bookings</button><span class="muted">/</span><span class="muted">Facilities</span></div>`+head('Facilities','What can be booked, when, by how many, how far ahead members may book, and what it costs.',btn('New facility','fxNew','pri',I.plus))+`
    <div class="grid g2">${S.facilities.map(f=>`<div class="card pad"><div style="display:flex;justify-content:space-between;gap:10px;align-items:flex-start"><div><b style="font-size:17px;color:var(--navy)">${esc(f.name)}</b><div class="muted" style="font-size:12.5px">${esc((FAC_KINDS.find(k=>k[0]===f.kind)||[])[1]||f.kind)} · ${f.units>1?f.units+' ('+Array.from({length:f.units},(_,i)=>unitName(f,i+1)).join(', ')+') · ':''}${t12(f.open)}–${t12(f.close)} every ${f.slot} min · up to ${f.cap} per ${f.kind==='tee'?'tee time':'slot'}</div><div class="muted" style="font-size:12.5px">${f.members?`Members book up to ${f.lead} days ahead${f.onePerDay?', one a day':''}`:'Booked by the office only'}${f.fee&&n0(f.fee.amount)?` · ${fmt2(f.fee.amount)} ${f.fee.per==='player'?'per player':'per booking'}`:''}</div></div><button class="btn sm" data-ef="${f.id}">Edit</button></div></div>`).join('')}</div>`;
  $('bsBk').onclick=()=>go('bookings'); $('fxNew').onclick=()=>facilityDrawer(null); m.querySelectorAll('[data-ef]').forEach(x=>x.onclick=()=>facilityDrawer(facOf(x.dataset.ef)));
}
function facilityDrawer(f){ const S=bookSettings(), b=acctSettings();
  openDrawer({kicker:'Bookings',title:f?f.name:'New facility',wide:true,body:pair(field('Name','fN',f?f.name:''),field('Kind','fK',f?f.kind:'court',{type:'select',options:FAC_KINDS}))+pair(field('How many (courses, courts, lanes, instructors)','fU',f?f.units:1,{type:'number'}),field('Their names, comma-separated','fUN',f?f.unitNames.join(', '):'',{ph:'Oak, Pecan'}))+
      `<div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:12px">${field('Opens','fO',f?f.open:'07:00',{type:'time'})}${field('Closes','fC',f?f.close:'19:00',{type:'time'})}${field('Slot, minutes','fS',f?f.slot:60,{type:'number'})}</div>`+pair(field('Up to … per slot (players per tee time)','fCap',f?f.cap:4,{type:'number'}),field('Members may book … days ahead','fL',f?f.lead:7,{type:'number'}))+
      `<label class="check"><input type="checkbox" id="fM"${!f||f.members?' checked':''}>Members can book it in the portal</label><label class="check"><input type="checkbox" id="fOne"${!f||f.onePerDay?' checked':''}>One booking per member per day</label>`+pair(field('Fee $','fF',f&&f.fee?f.fee.amount:'',{type:'number'}),field('Fee per','fFP',f&&f.fee?f.fee.per:'booking',{type:'select',options:[['booking','Booking'],['player','Player']]}))+field('Fee bills as','fFI',f&&f.fee?f.fee.item:'facility',{type:'select',options:b.items.filter(x=>!['finance','late','min'].includes(x.id)).map(x=>[x.id,x.name])}),
    save:()=>{ const name=fv('fN'); if(!name){ toast('Name it'); return false; } const d={name,kind:fv('fK'),units:Math.max(1,Math.round(fnum('fU'))||1),unitNames:fv('fUN').split(',').map(s=>s.trim()).filter(Boolean),open:fv('fO')||'07:00',close:fv('fC')||'19:00',slot:Math.max(5,Math.round(fnum('fS'))||60),cap:Math.max(1,Math.round(fnum('fCap'))||1),lead:Math.max(0,Math.round(fnum('fL'))),members:$('fM').checked,onePerDay:$('fOne').checked,fee:fnum('fF')>0?{item:fv('fFI'),amount:fnum('fF'),per:fv('fFP')}:null};
      if(f) Object.assign(f,d); else S.facilities.push(Object.assign({id:uid()},d)); persist(); },
    del:f&&S.facilities.length>1?()=>{ if(!confirm(`Remove ${f.name}? Its bookings stay on record.`)) return false; S.facilities=S.facilities.filter(x=>x!==f); if(BK.fac===f.id) BK.fac=''; persist(); }:null}); }
/* ---------- the printed sheet ---------- */
async function sheetPDF(f,day){ try{ await loadJsPDF(); }catch(e){ toast(e.message); return; }
  const crest=await crestPNG().catch(()=>null), doc=new window.jspdf.jsPDF({unit:'pt',format:'letter'}); bcFonts(doc);
  const NAVY=[15,42,56],GOLD=[199,161,58],GOLDL=[216,183,95],GOLDDK=[126,95,26],IVORY=[251,250,245],INK=[20,34,43],MUTED=[86,98,106]; const L=40,R=572,W=612,H=792, font=(ff,s,z,c)=>{ doc.setFont(ff,s); doc.setFontSize(z); doc.setTextColor(...c); };
  const club=(CLUB&&CLUB.name)||CLUB_META.name, rows=bkLive(f.id,day), slots=slotsOf(f), units=Array.from({length:f.units},(_,i)=>i+1);
  const page=()=>{ doc.setFillColor(...IVORY); doc.rect(0,0,W,H,'F'); doc.setFillColor(...GOLD); doc.roundedRect(L,32,R-L,82,8,8,'F'); doc.setFillColor(...NAVY); doc.roundedRect(L,32,R-L,78,8,8,'F'); doc.rect(L,98,R-L,8,'F'); if(crest) doc.addImage(crest,'PNG',L+16,42,54*850/1024,54);
    font('PublicSansXB','normal',6.8,GOLDL); doc.text(String(club).toUpperCase(),L+76,56,{charSpace:1.2}); font('Cormorant','bold',24,[255,255,255]); doc.text(f.name,L+76,80); font('PublicSans','normal',8.4,[214,218,220]); doc.text(new Date(day+'T12:00').toLocaleDateString('en-US',{weekday:'long',month:'long',day:'numeric',year:'numeric'}),L+76,96); return 134; };
  let y=page(); const cw=(R-L-64)/f.units;
  font('PublicSansXB','normal',7.4,GOLDDK); doc.text('TIME',L,y,{charSpace:1.1}); units.forEach((u,i)=>doc.text(unitName(f,u).toUpperCase(),L+64+i*cw,y,{charSpace:1.1})); y+=6; doc.setDrawColor(...GOLD); doc.setLineWidth(1); doc.line(L,y,R,y); y+=12;
  for(const t of slots){ const lines=units.map(u=>rows.filter(b=>b.time===t&&b.unit===u).map(b=>(b.players||[]).map(p=>p.name).join(', ')||bkName(b)).join(' · ')); const hts=lines.map((s,i)=>doc.splitTextToSize(s||'',cw-8).length); const h=Math.max(1,...hts)*11+5;
    if(y+h>H-50){ y=page(); } font('PublicSans','bold',9,INK); doc.text(t12(t),L,y); font('PublicSans','normal',9,lines.some(Boolean)?INK:MUTED); lines.forEach((s,i)=>{ doc.text(doc.splitTextToSize(s||'—',cw-8),L+64+i*cw,y); }); y+=h; doc.setDrawColor(225,217,198); doc.setLineWidth(.5); doc.line(L,y-4,R,y-4); }
  font('PublicSans','normal',7,MUTED); doc.text(`${club} · ${f.name} · printed ${new Date().toLocaleString('en-US',{month:'short',day:'numeric',hour:'numeric',minute:'2-digit'})}`,W/2,H-28,{align:'center'});
  const name=`${f.id}-${day}.pdf`; if(typeof deliverFile==='function') await deliverFile(doc.output('blob'),name,f.name); else doc.save(name); }
