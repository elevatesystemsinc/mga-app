/* ============================================================================================
   Surveys — the board asks its members, members answer anonymously on their phones.
   A survey lives in the organization's document (db.surveys); opening it writes the questions to the
   survey_share row and mints a private link (survey.html?k=TOKEN). Responses go to survey_responses through
   survey_submit — no user, no e-mail, no device, only the answers and the day (survey-setup.sql). The hub reads
   them back here for the results. Nothing identifying is ever asked for or stored; keep it that way.
   ============================================================================================ */
const SURVEY_TYPES=[['rating','Rate 0–10'],['slider','Trade-off slider'],['choice','Pick one'],['multi','Pick any'],['yesno','Yes / no'],['text','Written answer']];
const SURVEY_TYPE_NAME=Object.fromEntries(SURVEY_TYPES);
const SV_R={};                      // responses per survey id, loaded from the cloud; device-local, never in the document
function surveysData(){ db.surveys=db.surveys||[]; return db.surveys; }
const surveyById=id=>surveysData().find(s=>s.id===id);
const surveyLink=s=>SITE_BASE+'survey.html?k='+encodeURIComponent(s.token||'');
const svOrgName=()=>{ const o=curOrg(); return o?(o.name||o.short):''; };
/* what the public page gets: questions only, never anything about who answers */
function surveyPub(s){ return {id:s.id,title:s.title,intro:s.intro||'',org:orgShort(),orgName:svOrgName(),club:CLUB&&CLUB.name||'',
  sections:(s.sections||[]).map(sec=>({id:sec.id,title:sec.title,intro:sec.intro||'',comments:!!sec.comments,
    questions:(sec.questions||[]).map(q=>({id:q.id,type:q.type,text:q.text,help:q.help||'',options:q.options||[],left:q.left||'',right:q.right||'',comment:!!q.comment}))}))}; }
const svCloud=()=>CLOUD&&(sessionOK||KEYMODE);
async function pushSurvey(s){ if(!svCloud()) return false;
  const doc=surveyPub(s);
  const {error}=KEYMODE?await keyRPC('hub_key_survey',{p_sid:s.id,p_token:s.token||null,p_status:s.status,p_doc:doc})
    :await sb.from('survey_share').upsert(trow({sid:s.id,org:ORG_ID,token:s.token||null,status:s.status,doc,updated_at:new Date().toISOString()}));
  if(error){ toast('Could not publish the survey: '+error.message); return false; } return true; }
async function dropSurveyCloud(s){ if(!svCloud()) return;
  if(KEYMODE){ await keyRPC('hub_key_survey',{p_sid:s.id,p_token:null,p_status:'closed',p_doc:null}); return; }
  await tq(sb.from('survey_responses').delete()).eq('sid',s.id); await tq(sb.from('survey_share').delete()).eq('sid',s.id); }
const SV_AT={};                     // when each survey's responses were last fetched
async function loadResponses(s){ if(!CLOUD) return SV_R[s.id]=SV_R[s.id]||[]; if(!svCloud()) return SV_R[s.id]||null;   // before the sign-in has settled: not loaded yet, not "none"
  SV_AT[s.id]=Date.now();
  const r=KEYMODE?await keyRPC('hub_key_survey_results',{p_sid:s.id}):await tq(sb.from('survey_responses').select('answers,day')).eq('sid',s.id);
  if(r.error){ toast('Could not load responses: '+r.error.message); return SV_R[s.id]=SV_R[s.id]||[]; }
  SV_R[s.id]=(r.data||[]).map(x=>({answers:x.answers||{},day:x.day||''})); return SV_R[s.id]; }
const newSection=(title)=>({id:uid(),title:title||'New section',intro:'',comments:true,questions:[]});
const newQuestion=(type,text,o={})=>Object.assign({id:uid(),type:type||'rating',text:text||'',help:'',options:[],left:'',right:'',comment:false},o);
const newSurvey=(title)=>({id:uid(),title:title||'New survey',intro:'',status:'draft',anonymous:true,createdAt:new Date().toISOString(),sections:[newSection('Questions')]});
const svQuestions=s=>(s.sections||[]).flatMap(sec=>sec.questions||[]);
const svStatusChip=s=>s.status==='open'?'<span class="chip ok">Open</span>':s.status==='closed'?'<span class="chip">Closed</span>':'<span class="chip gold">Draft</span>';
const svDay=d=>d?new Date(d+'T12:00:00').toLocaleDateString('en-US',{month:'short',day:'numeric'}):'';

/* ---------- the first survey: the season review an association's board sends after elections ---------- */
function memberSurveyTemplate(){
  const R=(text,o)=>newQuestion('rating',text,o), C=(text,options,o)=>newQuestion('choice',text,Object.assign({options},o)), M=(text,options,o)=>newQuestion('multi',text,Object.assign({options},o)),
        T=text=>newQuestion('text',text), S=(text,left,right,help)=>newQuestion('slider',text,{left,right,help:help||''});
  const org=orgShort()||'the association', year=Y();
  const s=newSurvey(`${year} ${org} Member Survey`);
  s.intro=`Help the incoming board plan next season. This takes about five minutes and it is completely anonymous — we do not record who answers, only what you tell us.`;
  s.sections=[
    Object.assign(newSection('Thursday night golf'),{intro:'The weekly games and the evenings after.',questions:[
      C('How often did you play on Thursday nights this season?',['Most weeks','About half the time','A few times','Never']),
      M('When you did not come, what was usually the reason?',['Work schedule','The start time','Family commitments','The games or formats','The cost','Did not know about it','Prefer not to play in the evening','Other'],{comment:true}),
      R('The Thursday night experience overall',{help:'0 = poor, 10 = could not be better'}),
      R('The games and formats we play on Thursdays',{comment:true}),
      R('Food and drinks after golf',{comment:true}),
      R('Value for what a Thursday costs'),
      S('If Thursday money has to go one way or the other, which would you rather have?','Better food','Higher payouts','Slide toward the one that matters more to you.'),
      C('What start time works best for you?',['Earlier than now','The current time is right','Later than now','Depends on the season']),
      T('What would get you out on more Thursday nights?')]}),
    Object.assign(newSection('Weekend tournaments'),{intro:'The Turkey Shoot and the other weekend events — the Member-Member has its own section below.',questions:[
      C('How many weekend tournaments did you play this year?',['All of them','Most of them','One or two','None']),
      M('What kept you from playing more of them?',['The dates','The cost','The formats','Needed a partner','Skill level or handicap worries','Pace of play','Nothing — I played what I wanted'],{comment:true}),
      R('The food experience at tournaments',{comment:true}),
      R('The tournament formats',{comment:true}),
      R('Course set-up and pace of play'),
      R('Organization on the day — check-in, pairings, scoring'),
      R('Prizes and payouts'),
      R('Value for the entry fee'),
      S('If tournament money has to go one way or the other, which would you rather have?','Better food','Higher payouts','Slide toward the one that matters more to you.'),
      M('Which formats would you like to see more of?',['Scramble','Best ball','Shamble','Individual stroke play','Match play','Stableford or points','Alternate shot','Keep the mix as it is']),
      C('How do you feel about the number of weekend events?',['More would be better','About right','Fewer, but bigger']),
      T('What would make you play more weekend tournaments?')]}),
    Object.assign(newSection('The Member-Member'),{intro:'Our biggest weekend: three days, the party, the Calcutta and the golf. Rate each piece on its own.',questions:[
      C('Did you play in this year’s Member-Member?',['Yes','No — I wanted to but could not','No — it is not for me'],{comment:true}),
      R('Registration and check-in',{help:'Signing up, paying, picking up your package',comment:true}),
      R('The Friday night party and the Calcutta evening',{comment:true}),
      R('How the Calcutta was run',{help:'The auction itself — pace, the auctioneer, the pool, the buy-in',comment:true}),
      R('Food availability during play',{help:'Breakfast, the turn, on the course',comment:true}),
      R('Food quality and execution at the dinners',{comment:true}),
      R('Drinks — bar service, beverage carts, selection',{comment:true}),
      R('Live music and entertainment',{comment:true}),
      R('The formats — Saturday’s scramble and shamble, Sunday’s best ball',{comment:true}),
      R('Flights, pairings and tee times'),
      R('Pace of play'),
      R('Live scoring and the leaderboards'),
      R('The awards and payouts'),
      R('Value for the entry fee'),
      S('If Member-Member money has to go one way or the other, which would you rather have?','Better food & events','Higher payouts','Slide toward the one that matters more to you.'),
      M('Which parts of the weekend matter most to you?',['The golf','The Calcutta','The Friday party','The dinners','The live music','Time with my partner and friends','The payouts']),
      C('Would you play again next year?',['Yes','Probably','Not sure','No'],{comment:true}),
      T('What is the one thing you would change about the Member-Member?')]}),
    Object.assign(newSection('Membership'),{intro:`Being a member of the ${org}.`,questions:[
      C(`How long have you been a member of the ${org}?`,['This is my first year','2–5 years','6–10 years','More than 10 years']),
      R('Communication from the board',{help:'Schedules, results, changes, reminders',comment:true}),
      M(`How do you prefer to hear from the ${org}?`,['E-mail','BAND','Text message','Through the pro shop','Posted at the club']),
      newQuestion('yesno',`Do you feel you get your money's worth from ${org} dues?`,{comment:true}),
      R(`Your ${org} experience this year, overall`),
      R(`How likely are you to recommend the ${org} to another member?`,{help:'0 = not at all, 10 = already have'}),
      C('Would you consider volunteering or serving on the board?',['Yes — reach out','Maybe, tell me more','Not right now']),
      T('If the incoming board changes one thing first, what should it be?')]})];
  return s;
}

/* ---------- the list ---------- */
function vSurveys(m){
  surveysData();
  if(view.sid&&surveyById(view.sid)) return vSurvey(m,surveyById(view.sid));
  view.sid=null;
  const list=surveysData().slice().sort((a,b)=>(b.createdAt||'').localeCompare(a.createdAt||''));
  m.innerHTML=head('Surveys','Ask the members and read what comes back. Every survey is anonymous — nobody can see who answered.',
    btn('From the member survey template','svTpl','',I.lib)+btn('New survey','svNew','pri',I.plus))+
    (list.length?`<div class="grid g3">${list.map(s=>{ const R=SV_R[s.id]; return `<button class="card pad svcard" data-sv="${s.id}">
      <div style="display:flex;justify-content:space-between;gap:10px;align-items:flex-start"><b class="h2" style="margin:0">${esc(s.title)}</b>${svStatusChip(s)}</div>
      <small class="muted">${(s.sections||[]).length} section${(s.sections||[]).length===1?'':'s'} · ${svQuestions(s).length} questions${R?` · ${R.length} response${R.length===1?'':'s'}`:''}</small>
      <small class="muted">${s.status==='draft'?'Not open yet':s.status==='open'?'Taking responses since '+svDay((s.openedAt||'').slice(0,10)):'Closed '+svDay((s.closedAt||'').slice(0,10))}</small></button>`; }).join('')}</div>`
    :`<div class="card pad" style="max-width:640px"><b>No surveys yet.</b><p class="muted" style="margin:6px 0 0">Start from the member survey template — Thursday nights, weekend tournaments and membership, with ratings, trade-offs and room for comments — or build one from a blank page. Open it when it is ready and share the link.</p></div>`);
  $('svNew').onclick=()=>{ const s=newSurvey(); surveysData().push(s); persist(); editSurvey(s,true); };
  $('svTpl').onclick=()=>{ const s=memberSurveyTemplate(); surveysData().push(s); persist(); go('surveys',{sid:s.id,stab:'questions'}); toast('Survey created from the template — edit anything, then open it'); };
  m.querySelectorAll('[data-sv]').forEach(b=>b.onclick=()=>go('surveys',{sid:b.dataset.sv,stab:null}));
  if(svCloud()) list.forEach(s=>{ if(!SV_R[s.id]&&s.status!=='draft') loadResponses(s).then(()=>{ if(view.page==='surveys'&&!view.sid) render(); }); });
}

/* ---------- one survey: status + link, questions, results ---------- */
function vSurvey(m,s){
  const R=SV_R[s.id];
  if(!view.stab) view.stab=(s.status==='draft'&&!(R&&R.length))?'questions':'results';
  const cloudNote=!svCloud()?'<p class="hint">Sharing needs the cloud sign-in; in local mode you can still build and preview it.</p>':'';
  const link=s.status!=='draft'&&s.token?surveyLink(s):'';
  const statusCard=s.status==='draft'
    ?`<div class="card pad" style="display:flex;gap:14px 24px;align-items:center;flex-wrap:wrap"><div class="cell2" style="flex:1 1 340px"><span class="lbl">Draft</span><b>Open the survey when the questions are ready</b><small class="muted">Opening it creates the private link you send to the members. Answers are anonymous.</small>${cloudNote}</div><div class="actions">${btn('Preview','svPrev')}${btn('Open the survey','svOpen','pri')}</div></div>`
    :`<div class="card pad" style="display:flex;flex-direction:column;gap:10px"><div style="display:flex;gap:14px 24px;align-items:center;flex-wrap:wrap"><div class="cell2" style="flex:1 1 300px"><span class="lbl">${s.status==='open'?'Open — taking responses':'Closed'}</span><b>${s.status==='open'?'Send this link to the members':'The link now tells members the survey has closed'}</b><small class="muted">Anonymous: the hub never learns who answered. ${R?R.length+' response'+(R.length===1?'':'s')+' so far.':''}</small></div>
      <div class="actions">${btn('Preview','svPrev')}${s.status==='open'?btn('Close the survey','svClose'):btn('Reopen','svReopen')}</div></div>
      ${link?`<div class="svlink"><input class="inp" id="svUrl" readonly value="${esc(link)}"><button class="btn pri" id="svCopy">Copy link</button></div>`:''}${cloudNote}</div>`;
  m.innerHTML=head(s.title,`${esc(svOrgName())} · ${svStatusChip(s)} · ${svQuestions(s).length} questions`,btn('Edit title & intro','svEdit','',I.edit))+statusCard+
    `<div class="tabs" style="margin-top:18px"><button class="tab${view.stab==='questions'?' on':''}" data-st="questions">Questions</button><button class="tab${view.stab==='results'?' on':''}" data-st="results">Results${R?` (${R.length})`:''}</button></div><div id="svBody" style="margin-top:14px"></div>`;
  m.querySelectorAll('[data-st]').forEach(b=>b.onclick=()=>{ view.stab=b.dataset.st; render(); });
  $('svEdit').onclick=()=>editSurvey(s);
  $('svPrev').onclick=()=>{ try{ localStorage.setItem('survey_preview_'+s.id,JSON.stringify(surveyPub(s))); }catch(_){ } window.open(SITE_BASE+'survey.html?preview='+encodeURIComponent(s.id),'_blank'); };
  const op=$('svOpen'); if(op) op.onclick=async()=>{ if(!svQuestions(s).length){ toast('Add a question first'); return; } s.status='open'; s.token=s.token||newToken(); s.openedAt=new Date().toISOString(); persist(); await pushSurvey(s); view.stab='results'; render(); toast('The survey is open — copy the link'); };
  const cl=$('svClose'); if(cl) cl.onclick=async()=>{ s.status='closed'; s.closedAt=new Date().toISOString(); persist(); await pushSurvey(s); render(); toast('Survey closed'); };
  const ro=$('svReopen'); if(ro) ro.onclick=async()=>{ s.status='open'; delete s.closedAt; persist(); await pushSurvey(s); render(); toast('Survey reopened'); };
  const cp=$('svCopy'); if(cp) cp.onclick=async()=>{ try{ await navigator.clipboard.writeText(link); toast('Link copied'); }catch(_){ prompt('Copy this link:',link); } };
  if(view.stab==='questions') svQuestionsTab($('svBody'),s); else svResultsTab($('svBody'),s);
}
function svQuestionsTab(el,s){
  el.innerHTML=(s.sections||[]).map((sec,si)=>`<div class="card svsec"><div class="svsec-h"><div class="cell2"><b class="h2" style="margin:0">${esc(sec.title)}</b>${sec.intro?`<small class="muted">${esc(sec.intro)}</small>`:''}</div>
      <div class="actions"><button class="ib" data-secup="${sec.id}" aria-label="Move section up"${si===0?' disabled':''}>${I.chev}</button><button class="ib" data-secdn="${sec.id}" aria-label="Move section down"${si===s.sections.length-1?' disabled':''}>${I.chev}</button><button class="ib" data-sece="${sec.id}" aria-label="Edit section">${I.edit}</button></div></div>
    ${(sec.questions||[]).map((q,qi)=>`<div class="svq-row"><span class="svn">${qi+1}</span><div class="cell2"><b>${esc(q.text)||'<span class="muted">Untitled question</span>'}</b><small class="muted">${esc(SURVEY_TYPE_NAME[q.type]||q.type)}${q.type==='slider'?` · ${esc(q.left)} ↔ ${esc(q.right)}`:''}${(q.type==='choice'||q.type==='multi')?` · ${(q.options||[]).length} options`:''}${q.comment?' · with a comment box':''}${q.help?` · <i>${esc(q.help)}</i>`:''}</small></div>
      <div class="actions"><button class="ib" data-qup="${q.id}" aria-label="Move up"${qi===0?' disabled':''}>${I.chev}</button><button class="ib" data-qdn="${q.id}" aria-label="Move down"${qi===sec.questions.length-1?' disabled':''}>${I.chev}</button><button class="ib" data-qe="${q.id}" aria-label="Edit question">${I.edit}</button></div></div>`).join('')}
    ${sec.comments?`<div class="svq-row muted"><span class="svn">✎</span><div class="cell2"><b style="font-weight:500">Suggestions and comments on ${esc(sec.title.toLowerCase())}</b><small>An open box at the end of the section</small></div></div>`:''}
    <div style="padding:10px 16px 14px"><button class="btn sm" data-qadd="${sec.id}">${I.plus}Add question</button></div></div>`).join('')+
    `<div style="margin-top:12px;display:flex;gap:10px;flex-wrap:wrap">${btn('Add section','svSecAdd','',I.plus)}${btn('Delete survey','svDel','danger',I.trash)}</div>`;
  const findQ=id=>{ for(const sec of s.sections){ const i=(sec.questions||[]).findIndex(q=>q.id===id); if(i>=0) return {sec,i,q:sec.questions[i]}; } return null; };
  const mv=(arr,i,d)=>{ const j=i+d; if(j<0||j>=arr.length) return; [arr[i],arr[j]]=[arr[j],arr[i]]; svSaved(s); };
  el.querySelectorAll('[data-qup]').forEach(b=>b.onclick=()=>{ const f=findQ(b.dataset.qup); mv(f.sec.questions,f.i,-1); });
  el.querySelectorAll('[data-qdn]').forEach(b=>b.onclick=()=>{ const f=findQ(b.dataset.qdn); mv(f.sec.questions,f.i,1); });
  el.querySelectorAll('[data-qe]').forEach(b=>b.onclick=()=>{ const f=findQ(b.dataset.qe); editQuestion(s,f.sec,f.q); });
  el.querySelectorAll('[data-qadd]').forEach(b=>b.onclick=()=>editQuestion(s,s.sections.find(x=>x.id===b.dataset.qadd),null));
  el.querySelectorAll('[data-secup]').forEach(b=>b.onclick=()=>mv(s.sections,s.sections.findIndex(x=>x.id===b.dataset.secup),-1));
  el.querySelectorAll('[data-secdn]').forEach(b=>b.onclick=()=>mv(s.sections,s.sections.findIndex(x=>x.id===b.dataset.secdn),1));
  el.querySelectorAll('[data-sece]').forEach(b=>b.onclick=()=>editSection(s,s.sections.find(x=>x.id===b.dataset.sece)));
  $('svSecAdd').onclick=()=>editSection(s,null);
  $('svDel').onclick=()=>openDrawer({kicker:'Surveys',title:'Delete this survey?',body:`<p style="margin:0">“${esc(s.title)}” and every response to it will be removed. This cannot be undone.</p>`,
    del:()=>{ db.surveys=surveysData().filter(x=>x.id!==s.id); delete SV_R[s.id]; dropSurveyCloud(s); view.sid=null; toast('Survey deleted'); },delLabel:'Delete survey'});
}
/* after any change to an open survey, the public copy follows */
function svSaved(s){ persist(); render(); if(s.status!=='draft') pushSurvey(s); }
function editSurvey(s,isNew){
  openDrawer({kicker:'Survey',title:isNew?'New survey':'Title & introduction',body:field('Title','svT',s.title)+field('Introduction shown at the top','svI',s.intro||'',{type:'textarea'})+
    '<p class="hint">Every survey is anonymous: the page asks for no name, e-mail or sign-in, and a response is stored with the answers and the day only.</p>',
    save:()=>{ if(!fv('svT')){ toast('Give it a title'); return false; } s.title=fv('svT'); s.intro=fv('svI'); if(s.status!=='draft') pushSurvey(s); if(isNew) view.sid=s.id, view.stab='questions'; },
    del:isNew?()=>{ db.surveys=surveysData().filter(x=>x.id!==s.id); }:null,delLabel:'Discard'});
}
function editSection(s,sec){
  const n=!sec; sec=sec||newSection('');
  openDrawer({kicker:'Survey section',title:n?'Add a section':'Edit section',body:field('Section title','ssT',sec.title)+field('A line under the title (optional)','ssI',sec.intro||'')+
    `<label class="check"><input type="checkbox" id="ssC"${sec.comments?' checked':''}>End the section with an open box for suggestions and comments</label>`,
    save:()=>{ if(!fv('ssT')){ toast('Give the section a title'); return false; } sec.title=fv('ssT'); sec.intro=fv('ssI'); sec.comments=$('ssC').checked; if(n) s.sections.push(sec); if(s.status!=='draft') pushSurvey(s); },
    del:n?null:()=>{ if(sec.questions.length&&!confirm(`Delete “${sec.title}” and its ${sec.questions.length} questions?`)) return false; s.sections=s.sections.filter(x=>x!==sec); if(s.status!=='draft') pushSurvey(s); },delLabel:'Delete section'});
}
function editQuestion(s,sec,q){
  const n=!q; q=q||newQuestion('rating','');
  const body=field('Question','sqT',q.text,{ph:'e.g. The food experience at tournaments'})+
    `<div class="fld"><span class="lbl">Answer</span>${seg('sqK',SURVEY_TYPES,q.type)}</div>`+
    `<div id="sqOpt"${(q.type==='choice'||q.type==='multi')?'':' hidden'}>${field('Options — one per line','sqO',(q.options||[]).join('\n'),{type:'textarea'})}</div>`+
    `<div id="sqSl"${q.type==='slider'?'':' hidden'}>${pair(field('Left end','sqL',q.left||'',{ph:'Better food'}),field('Right end','sqR',q.right||'',{ph:'Higher payouts'}))}<p class="hint">The member slides between the two; the middle means “either, evenly”.</p></div>`+
    field('A hint under the question (optional)','sqH',q.help||'',{ph:'0 = poor, 10 = could not be better'})+
    `<label class="check"><input type="checkbox" id="sqC"${q.comment?' checked':''}>Add a comment box under this question</label>`+
    (s.status!=='draft'&&!n?'<p class="hint">The survey is open: the change reaches the page within a minute. Answers already in stay with the question.</p>':'');
  openDrawer({kicker:sec.title,title:n?'Add a question':'Edit question',body,
    wire:r=>wireSeg(r,'sqK',v=>{ r.querySelector('#sqOpt').hidden=!(v==='choice'||v==='multi'); r.querySelector('#sqSl').hidden=v!=='slider'; }),
    save:()=>{ const k=$('sqK').dataset.val; if(!fv('sqT')){ toast('Write the question'); return false; }
      const opts=fv('sqO').split('\n').map(x=>x.trim()).filter(Boolean);
      if((k==='choice'||k==='multi')&&opts.length<2){ toast('Give at least two options'); return false; }
      if(k==='slider'&&(!fv('sqL')||!fv('sqR'))){ toast('Name both ends of the slider'); return false; }
      Object.assign(q,{text:fv('sqT'),type:k,options:(k==='choice'||k==='multi')?opts:[],left:k==='slider'?fv('sqL'):'',right:k==='slider'?fv('sqR'):'',help:fv('sqH'),comment:$('sqC').checked});
      if(n) sec.questions.push(q); if(s.status!=='draft') pushSurvey(s); },
    del:n?null:()=>{ sec.questions=sec.questions.filter(x=>x!==q); if(s.status!=='draft') pushSurvey(s); },delLabel:'Delete question'});
}

/* ---------- results ---------- */
function svStats(q,R){
  const vals=R.map(r=>r.answers[q.id]).filter(v=>v!==undefined&&v!==null&&v!==''&&!(Array.isArray(v)&&!v.length));
  const comments=R.map(r=>r.answers[q.id+':c']).map(x=>String(x||'').trim()).filter(Boolean);
  const st={n:vals.length,comments};
  if(q.type==='rating'||q.type==='slider'){ const nums=vals.map(Number).filter(x=>isFinite(x)); st.n=nums.length; st.avg=nums.length?nums.reduce((a,b)=>a+b,0)/nums.length:null;
    st.dist=Array.from({length:11},(_,i)=>nums.filter(x=>Math.round(x)===i).length); st.left=nums.filter(x=>x<5).length; st.mid=nums.filter(x=>x===5).length; st.right=nums.filter(x=>x>5).length; }
  else if(q.type==='text') st.texts=vals.map(String);
  else { const opts=q.type==='yesno'?['Yes','No']:(q.options||[]).slice(); const counts={}; opts.forEach(o=>counts[o]=0);
    vals.forEach(v=>(Array.isArray(v)?v:[v]).forEach(o=>{ counts[o]=(counts[o]||0)+1; })); st.counts=counts; st.opts=Object.keys(counts); }
  return st;
}
function svResultsTab(el,s){
  const R=SV_R[s.id];
  if(!R){ el.innerHTML='<div class="card pad muted">Loading responses…</div>'; if(!CLOUD){ SV_R[s.id]=[]; render(); } else if(svCloud()&&!SV_AT[s.id]) loadResponses(s).then(()=>{ if(view.sid===s.id&&view.stab==='results') render(); }); return; }
  if(svCloud()&&Date.now()-(SV_AT[s.id]||0)>20000) loadResponses(s).then(()=>{ if(view.sid===s.id&&view.stab==='results'&&(SV_R[s.id]||[]).length!==R.length) render(); });   // coming back to the tab picks up new answers
  const n=R.length, days=R.map(r=>r.day).filter(Boolean).sort(), qs=svQuestions(s);
  const rated=qs.filter(q=>q.type==='rating').map(q=>({q,st:svStats(q,R)})).filter(x=>x.st.n), best=rated.slice().sort((a,b)=>b.st.avg-a.st.avg);
  el.innerHTML=`<div style="display:flex;justify-content:flex-end;gap:8px;margin-bottom:12px;flex-wrap:wrap">${btn('Refresh','svRef','',I.refresh)}${btn('Export CSV','svCsv')}${btn('Results PDF','svPdf','pri')}</div>
  <div class="grid g4">${kpi('Responses',n,s.status==='open'?'and counting':'')}${kpi('First / last',days.length?`${svDay(days[0])}${days.length>1&&days[days.length-1]!==days[0]?' – '+svDay(days[days.length-1]):''}`:'—','by day only — no times are kept')}
    ${kpi('Highest rated',best.length?best[0].st.avg.toFixed(1):'—',best.length?esc(best[0].q.text):'')}${kpi('Lowest rated',best.length?best[best.length-1].st.avg.toFixed(1):'—',best.length?esc(best[best.length-1].q.text):'')}</div>
  ${n?'':'<div class="card pad" style="margin-top:14px"><b>No responses yet.</b><p class="muted" style="margin:6px 0 0">Share the link above. Results appear here as they come in; press Refresh to check again.</p></div>'}
  ${n?s.sections.map(sec=>`<h2 class="h2" style="margin:22px 0 10px">${esc(sec.title)}</h2><div class="grid g2">${(sec.questions||[]).map(q=>svQuestionCard(q,svStats(q,R),n)).join('')}
    ${sec.comments?svTextCard('Suggestions and comments',R.map(r=>r.answers['sec:'+sec.id]).map(x=>String(x||'').trim()).filter(Boolean)):''}</div>`).join(''):''}`;
  $('svRef').onclick=async()=>{ await loadResponses(s); render(); toast('Results refreshed'); };
  $('svCsv').onclick=()=>svExportCSV(s,R);
  $('svPdf').onclick=()=>{ if(!R.length){ toast('No responses yet'); return; } surveyPDF(s,R); };
}
function svBar(pct,label,val,cls=''){ return `<div class="svb ${cls}"><div class="svb-l"><span class="trunc">${esc(label)}</span><b>${val}</b></div><div class="svb-t"><i style="width:${Math.max(0,Math.min(100,pct)).toFixed(1)}%"></i></div></div>`; }
function svQuestionCard(q,st,n){
  let body='';
  if(q.type==='rating') body=`<div class="svavg"><b>${st.n?st.avg.toFixed(1):'—'}</b><small>average of ${st.n}<br>out of 10</small></div><div class="svdist">${st.dist.map((c,i)=>`<div class="svd" title="${i}: ${c}"><i style="height:${st.n?Math.max(c?6:0,c/Math.max(...st.dist)*100):0}%"></i><span>${i}</span></div>`).join('')}</div>`;
  else if(q.type==='slider'){ const p=st.n?st.avg/10*100:50; body=`<div class="svsl"><div class="svsl-t"><span style="left:${p.toFixed(1)}%"></span></div><div class="svsl-l"><span>${esc(q.left)}</span><span>${esc(q.right)}</span></div>
    <div class="svsl-c">${st.n?`${Math.round(st.left/st.n*100)}% lean <b>${esc(q.left.toLowerCase())}</b> · ${Math.round(st.mid/st.n*100)}% either · ${Math.round(st.right/st.n*100)}% lean <b>${esc(q.right.toLowerCase())}</b>`:'No answers yet'}</div></div>`; }
  else if(q.type==='text') return svTextCard(q.text,st.texts||[]);
  else body=`<div class="svbars">${st.opts.map(o=>svBar(st.n?st.counts[o]/st.n*100:0,o,st.n?`${st.counts[o]} · ${Math.round(st.counts[o]/st.n*100)}%`:'0')).join('')}</div>`;
  return `<div class="card pad svres"><div class="cell2"><b>${esc(q.text)}</b><small class="muted">${esc(SURVEY_TYPE_NAME[q.type]||q.type)} · ${st.n} of ${n} answered${q.type==='multi'?' · more than one allowed':''}</small></div>${body}
    ${st.comments.length?`<details class="svcm"><summary>${st.comments.length} comment${st.comments.length===1?'':'s'}</summary><ul>${st.comments.map(c=>`<li>${esc(c)}</li>`).join('')}</ul></details>`:''}</div>`;
}
function svTextCard(title,texts){ return `<div class="card pad svres"><div class="cell2"><b>${esc(title)}</b><small class="muted">${texts.length} written answer${texts.length===1?'':'s'}</small></div>${texts.length?`<ul class="svlist">${texts.map(t=>`<li>${esc(t)}</li>`).join('')}</ul>`:'<p class="muted" style="margin:0">Nothing written yet.</p>'}</div>`; }
function svExportCSV(s,R){
  const cols=[['Day',r=>r.day||'']];
  for(const sec of s.sections){ for(const q of sec.questions){ cols.push([`${sec.title} — ${q.text}`,r=>{ const v=r.answers[q.id]; return Array.isArray(v)?v.join('; '):(v===undefined||v===null?'':String(v)); }]); if(q.comment) cols.push([`${sec.title} — ${q.text} — comment`,r=>r.answers[q.id+':c']||'']); }
    if(sec.comments) cols.push([`${sec.title} — suggestions`,r=>r.answers['sec:'+sec.id]||'']); }
  const cell=v=>'"'+String(v??'').replace(/"/g,'""')+'"';
  const csv=[cols.map(c=>cell(c[0])).join(',')].concat(R.map(r=>cols.map(c=>cell(c[1](r))).join(','))).join('\r\n');
  const a=document.createElement('a'); a.href=URL.createObjectURL(new Blob(['﻿'+csv],{type:'text/csv'})); a.download=s.title.replace(/[^\w\- ]+/g,'').trim()+' — responses.csv'; a.click(); setTimeout(()=>URL.revokeObjectURL(a.href),4000);
}

/* ---------- the results report: a branded PDF with every number and every written word, for reading or for analysis ---------- */
async function surveyPDF(s,R,opt){
  opt=opt||{};
  try{ await loadJsPDF(); }catch(e){ toast(e.message); return; }
  const crest=await crestPNG().catch(()=>null), doc=new window.jspdf.jsPDF({unit:'pt',format:'letter'});
  [['ps400','PS-400.ttf','PublicSans','normal'],['ps700','PS-700.ttf','PublicSans','bold'],['ps800','PS-800.ttf','PublicSansXB','normal'],['cg700','CG-700.ttf','Cormorant','bold']].forEach(([k,f,fam,st])=>{ doc.addFileToVFS(f,PDF_FONTS[k]); doc.addFont(f,fam,st); });
  const NAVY=[15,42,56],GOLD=[199,161,58],GOLDL=[216,183,95],GOLDDK=[126,95,26],IVORY=[251,250,245],INK=[20,34,43],MUTED=[86,98,106],LINE=[225,217,198],PAPER=[244,240,230];
  const L=40,R2=572,W=612,H=792;
  const font=(f,st,z,col)=>{ doc.setFont(f,st); doc.setFontSize(z); doc.setTextColor(...col); };
  const page=()=>{ doc.setFillColor(...IVORY); doc.rect(0,0,W,H,'F'); };
  const n=R.length, days=R.map(r=>r.day).filter(Boolean).sort(), qs=svQuestions(s);
  page();
  const subTxt=`${n} response${n===1?'':'s'}${days.length?` · ${svDay(days[0])}${days.length>1&&days[days.length-1]!==days[0]?' – '+svDay(days[days.length-1]):''}`:''} · ${s.status==='open'?'still open':'closed'} · anonymous — no respondent is identified anywhere in this report`;
  font('PublicSans','normal',8.4,[214,218,220]); const sub=doc.splitTextToSize(subTxt,R2-L-90); const bandH=74+Math.max(0,sub.length-1)*11;
  doc.setFillColor(...GOLD); doc.roundedRect(L,32,R2-L,bandH+4,8,8,'F'); doc.setFillColor(...NAVY); doc.roundedRect(L,32,R2-L,bandH,8,8,'F'); doc.rect(L,32+bandH-12,R2-L,8,'F');
  if(crest) doc.addImage(crest,'PNG',L+16,42,54*850/1024,54);
  font('PublicSansXB','normal',6.8,GOLDL); doc.text(`${(svOrgName()||'').toUpperCase()} · ${(CLUB&&CLUB.name||'').toUpperCase()}`,L+76,56,{charSpace:1.2});
  font('Cormorant','bold',22,[255,255,255]); doc.text(doc.splitTextToSize(`${s.title} — Results`,R2-L-90)[0],L+76,80);
  font('PublicSans','normal',8.4,[214,218,220]); doc.text(sub,L+76,96);
  let y=32+bandH+26;
  const need=h=>{ if(y+h>H-44){ doc.addPage(); page(); y=48; } };
  const section=(label,note)=>{ need(54); font('PublicSansXB','normal',7.4,GOLDDK); doc.text(label.toUpperCase(),L,y,{charSpace:1.1}); y+=6; doc.setDrawColor(...GOLD); doc.setLineWidth(1); doc.line(L,y,R2,y); y+=14;
    if(note){ font('PublicSans','normal',8,MUTED); const lines=doc.splitTextToSize(note,R2-L); lines.forEach(ln=>{ doc.text(ln,L,y); y+=11; }); y+=4; } };
  const para=(txt,z,col,f,st,x,w)=>{ font(f||'PublicSans',st||'normal',z||8.6,col||INK); const lines=doc.splitTextToSize(String(txt),w||(R2-(x||L))); for(const ln of lines){ need(z*1.5); doc.text(ln,x||L,y); y+=(z||8.6)*1.38; } };
  const bullets=(items,z)=>{ z=z||8.4; for(const t of items){ font('PublicSans','normal',z,INK); const lines=doc.splitTextToSize(String(t),R2-L-14); need(lines.length*z*1.38+2); doc.setFillColor(...GOLD); doc.circle(L+4,y-2.6,1.6,'F'); lines.forEach((ln,i)=>{ doc.text(ln,L+14,y); y+=z*1.38; }); y+=1.5; } };
  const bar=(x,yy,w,h,pct,col)=>{ doc.setFillColor(...PAPER); doc.roundedRect(x,yy,w,h,h/2,h/2,'F'); if(pct>0){ doc.setFillColor(...(col||GOLD)); doc.roundedRect(x,yy,Math.max(h,w*Math.min(1,pct)),h,h/2,h/2,'F'); } };
  const qTitle=(i,q,st)=>{ need(q.type==='rating'||q.type==='slider'?110:60); font('PublicSans','bold',10,INK); const lines=doc.splitTextToSize(`${i}. ${q.text}`,R2-L-110); lines.forEach(ln=>{ doc.text(ln,L,y); y+=13; }); y-=13;
    font('PublicSans','normal',7.6,MUTED); doc.text(`${SURVEY_TYPE_NAME[q.type]||q.type} · ${st.n} of ${n} answered`,R2,y,{align:'right'}); y+=14; if(q.help){ para(q.help,7.8,MUTED); } };
  // summary: the ratings ranked
  const rated=qs.filter(q=>q.type==='rating').map(q=>({q,st:svStats(q,R)})).filter(x=>x.st.n).sort((a,b)=>b.st.avg-a.st.avg);
  if(rated.length){ section('At a glance',`${rated.length} rated questions, highest to lowest`);
    for(const {q,st} of rated){ need(16); font('PublicSans','normal',8.6,INK); const label=doc.splitTextToSize(q.text,300)[0]; doc.text(label,L,y); bar(L+310,y-7,150,7,st.avg/10,st.avg>=7?[31,107,74]:st.avg>=5?GOLD:[181,68,58]); font('PublicSans','bold',9,INK); doc.text(st.avg.toFixed(1),R2,y,{align:'right'}); font('PublicSans','normal',7.4,MUTED); doc.text(`n ${st.n}`,R2-28,y,{align:'right'}); y+=14; } y+=6; }
  // every section, every question
  let qi=0;
  for(const sec of s.sections){ section(sec.title,sec.intro||'');
    for(const q of sec.questions){ qi++; const st=svStats(q,R); qTitle(qi,q,st);
      if(q.type==='rating'){ if(st.n){ need(70); font('Cormorant','bold',26,NAVY); doc.text(st.avg.toFixed(1),L,y+16); font('PublicSans','normal',7.6,MUTED); doc.text('average of 10',L,y+28);
          const bx=L+90, bw=(R2-bx)/11, mx=Math.max(...st.dist,1); st.dist.forEach((c,k)=>{ const h=c?Math.max(3,c/mx*34):0; doc.setFillColor(...NAVY); if(h) doc.rect(bx+k*bw+4,y+34-h,bw-8,h,'F'); font('PublicSans','normal',7,MUTED); doc.text(String(k),bx+k*bw+bw/2,y+44,{align:'center'}); if(c){ font('PublicSans','bold',7,INK); doc.text(String(c),bx+k*bw+bw/2,y+30-h,{align:'center'}); } });
          y+=56; } else { para('No answers.',8,MUTED); } }
      else if(q.type==='slider'){ if(st.n){ need(96); const bx=L, bw=R2-L; doc.setFillColor(...PAPER); doc.roundedRect(bx,y,bw,8,4,4,'F'); const px=bx+bw*st.avg/10; doc.setFillColor(...NAVY); doc.circle(px,y+4,6,'F'); doc.setFillColor(255,255,255); doc.circle(px,y+4,3,'F');
          y+=22; font('PublicSans','bold',8.4,NAVY); doc.text(q.left,bx,y); doc.text(q.right,R2,y,{align:'right'}); y+=13;
          para(`Average ${st.avg.toFixed(1)} on a 0–10 scale from "${q.left}" (0) to "${q.right}" (10). ${Math.round(st.left/st.n*100)}% lean ${q.left.toLowerCase()}, ${Math.round(st.mid/st.n*100)}% either, ${Math.round(st.right/st.n*100)}% lean ${q.right.toLowerCase()}. Spread: ${st.dist.map((c,k)=>c?`${k}:${c}`:null).filter(Boolean).join(' · ')}.`,8.2,INK); } else para('No answers.',8,MUTED); }
      else if(q.type==='text'){ if(st.texts&&st.texts.length) bullets(st.texts); else para('Nothing written.',8,MUTED); }
      else { for(const o of st.opts){ need(14); const c=st.counts[o]||0, pct=st.n?c/st.n:0; font('PublicSans','normal',8.4,INK); doc.text(doc.splitTextToSize(o,250)[0],L,y); bar(L+260,y-7,200,7,pct); font('PublicSans','bold',8.4,INK); doc.text(`${c} · ${Math.round(pct*100)}%`,R2,y,{align:'right'}); y+=13; } if(q.type==='multi'){ font('PublicSans','normal',7.2,MUTED); need(10); doc.text('More than one answer allowed — percentages are of people who answered.',L,y); y+=10; } }
      if(st.comments.length){ y+=4; font('PublicSansXB','normal',6.8,GOLDDK); need(14); doc.text(`COMMENTS (${st.comments.length})`,L,y,{charSpace:1}); y+=11; bullets(st.comments,8); }
      y+=10; }
    if(sec.comments){ const sug=R.map(r=>r.answers['sec:'+sec.id]).map(x=>String(x||'').trim()).filter(Boolean); need(30); font('PublicSans','bold',10,INK); doc.text(`Suggestions and comments on ${sec.title.toLowerCase()}`,L,y); font('PublicSans','normal',7.6,MUTED); doc.text(`${sug.length} written`,R2,y,{align:'right'}); y+=14; if(sug.length) bullets(sug); else para('Nothing written.',8,MUTED); y+=10; } }
  font('PublicSans','normal',7.6,MUTED); need(30);
  doc.text(doc.splitTextToSize(`Anonymous survey: no name, e-mail, sign-in or device was collected; each response is its answers and the day it arrived. Percentages are of the people who answered each question. Generated by the ${orgShort()} hub, ${new Date().toLocaleString()}.`,R2-L),L,Math.max(y+8,H-48));
  const pages=doc.getNumberOfPages(); for(let i=1;i<=pages;i++){ doc.setPage(i); font('PublicSans','normal',7,MUTED); doc.text(`${s.title} · results · page ${i} of ${pages}`,W/2,H-20,{align:'center'}); }
  if(opt.returnDoc) return doc;
  doc.save(`${s.title.replace(/[^\w]+/g,'-')}-results.pdf`); toast('Results PDF downloaded');
}
