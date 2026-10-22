"""Surveys against the fake database. Run: python3 tests/test_survey.py
The board builds the member survey from the template and opens it; a member answers on the public page without a
sign-in; the hub reads the results; the response holds nothing about who sent it; closing the survey closes the link."""
import asyncio,sys,json
from playwright.async_api import async_playwright
from _harness import FakeDB,cloud,page
from test_sync import seed_main,open_hub,settled
async def main():
  bad=0
  def check(name,cond,info=''):
    nonlocal bad; print(('OK   ' if cond else 'FAIL ')+name,info); bad+=(not cond)
  fdb=FakeDB(); fdb.seed('mga_hub','main',seed_main())
  async with async_playwright() as p:
    b=await p.chromium.launch()
    A=await b.new_context(); await cloud(A,fdb)
    pg,errs=await open_hub(A,'club'); await pg.evaluate("()=>migrateFromHub()"); await pg.close()
    hub,herr=await open_hub(A,'mga'); await settled([hub])
    # --- 1. the template → a draft with three sections, every answer type, comment boxes; nothing identifying asked
    r=await hub.evaluate("""()=>{ go('surveys'); document.getElementById('svTpl').click(); const s=db.surveys[0];
      return {nav:navItems().map(x=>x[0]).includes('surveys'), secs:s.sections.map(x=>[x.title,x.questions.length,x.comments]), types:[...new Set(svQuestions(s).map(q=>q.type))].sort(),
        sliders:svQuestions(s).filter(q=>q.type==='slider').map(q=>q.left+'/'+q.right), comments:svQuestions(s).filter(q=>q.comment).length, status:s.status, page:view.sid===s.id&&view.stab==='questions',
        asksWho:/your name|e-?mail address|phone number|member number|ghin/i.test(svQuestions(s).map(q=>q.text).join(' '))}; }""")
    check('template: four sections with comment boxes',[x[0] for x in r['secs']]==['Thursday night golf','Weekend tournaments','The Member-Member','Membership'] and all(x[2] for x in r['secs']) and all(x[1]>=8 for x in r['secs']),json.dumps(r['secs']))
    check('template: every answer type, food-vs-payouts slider in both golf sections',r['types']==['choice','multi','rating','slider','text','yesno'] and r['sliders']==['Better food/Higher payouts','Better food/Higher payouts','Better food & events/Higher payouts'] and r['comments']>=6,json.dumps(r))
    check('template: draft, opens on the questions tab, asks nothing identifying',r['status']=='draft' and r['page'] and not r['asksWho'])
    # editing: add a question with a comment box, move it up, edit a section
    r=await hub.evaluate("""()=>{ const s=db.surveys[0], sec=s.sections[2]; const n=sec.questions.length;
      editQuestion(s,sec,null); document.getElementById('sqT').value='Should the board hold a members’ meeting each spring?'; document.querySelector('#sqK [data-v=yesno]').click(); document.getElementById('sqC').checked=true; document.getElementById('dSave').click();
      const q=sec.questions[sec.questions.length-1]; document.querySelector(`[data-qup="${q.id}"]`).click();
      return {added:sec.questions.length===n+1, type:q.type, comment:q.comment, pos:sec.questions.indexOf(q)===n-1}; }""")
    check('edit: add a yes/no question with a comment box and move it up',r['added'] and r['type']=='yesno' and r['comment'] and r['pos'],json.dumps(r))
    await settled([hub]); clubW=fdb.writes['club']
    # --- 2. open it → a link; the share row carries the questions and the open status, no responses yet
    r=await hub.evaluate("""async()=>{ const s=db.surveys[0]; document.getElementById('svOpen').click(); await new Promise(r=>setTimeout(r,400));
      return {status:s.status, token:s.token, link:document.getElementById('svUrl')&&document.getElementById('svUrl').value, tab:view.stab}; }""")
    share=fdb._rows('survey_share'); tok=r['token']
    check('open: link minted, share row written',r['status']=='open' and tok and len(tok)>=20 and r['link'].endswith('survey.html?k='+tok) and len(share)==1 and share[0]['status']=='open' and share[0]['org']=='mga' and len(share[0]['doc']['sections'])==4,json.dumps([r['status'],r['tab'],len(share)]))
    await settled([hub])
    check('open: no writes to the club row, one survey in the MGA row',fdb.writes['club']==clubW and len(fdb.get('mga_hub','mga')['surveys'])==1)
    # --- 3. a member answers on the public page: no sign-in, no name asked
    M=await b.new_context(); await cloud(M,fdb,no_session=True)
    ph=await M.new_page(); perr=[]; ph.on('pageerror',lambda e:perr.append(str(e)))
    await ph.goto(page('survey.html')+'?k='+tok); await ph.wait_for_function("()=>!!S&&document.querySelectorAll('.scale').length>0")
    r=await ph.evaluate("""()=>{ const txt=document.body.innerText; return {title:S.title, scales:document.querySelectorAll('.scale').length, sliders:document.querySelectorAll('.sl').length, anon:/Anonymous/.test(txt), inputs:[...document.querySelectorAll('input')].map(i=>i.type), secC:document.querySelectorAll('textarea[data-t^="sec:"]').length}; }""")
    check('page: renders the survey, says it is anonymous, the only inputs are the sliders',r['scales']>=10 and r['sliders']==3 and r['anon'] and set(r['inputs'])=={'range'} and r['secC']==4,json.dumps(r))
    # answer: a 9 on the first rating, slide the first trade-off toward payouts, pick a choice, two multi options, a comment, a section comment, a written answer
    r=await ph.evaluate("""()=>{ const sc=document.querySelector('.scale'); sc.querySelector('[data-v="9"]').click();
      const sl=document.querySelector('.sl input'); sl.value='8'; sl.dispatchEvent(new Event('input'));
      const ch=document.querySelector('.opts[data-k=choice] button'); ch.click();
      const mu=document.querySelector('.opts[data-k=multi]'); mu.children[0].click(); mu.children[2].click();
      const cm=document.querySelector('details.cm textarea'); cm.value='More tacos'; cm.dispatchEvent(new Event('input'));
      const sec=document.querySelector('textarea[data-t^="sec:"]'); sec.value='Start at 5:30'; sec.dispatchEvent(new Event('input'));
      const tx=document.querySelector('textarea[data-t]:not([data-t*=":"])'); tx.value='A shorter format'; tx.dispatchEvent(new Event('input'));
      return {cap:document.querySelector('.sl .cap').textContent, cnt:document.getElementById('cnt').textContent, keys:Object.keys(A).length}; }""")
    check('page: answers register, slider caption reads the lean',r['cap'].startswith('Strongly toward higher payouts') and r['keys']==7 and r['cnt'].startswith('5 answered'),json.dumps(r))
    await ph.click('#go'); await ph.wait_for_function("()=>/Thank you/.test(document.body.innerText)")
    rows=fdb._rows('survey_responses')
    check('submit: one anonymous row — answers + day, nothing about the sender',len(rows)==1 and set(rows[0].keys())=={'id','tenant','org','sid','answers','day'} and rows[0]['org']=='mga' and rows[0]['answers']['sec:'+share[0]['doc']['sections'][0]['id']]=='Start at 5:30',json.dumps(sorted(rows[0].keys()) if rows else rows))
    ans=rows[0]['answers']; q0=share[0]['doc']['sections'][0]['questions']
    check('submit: values as entered (9, slider 8, a choice, two picks, the comment)',ans[q0[2]['id']]==9 and ans[q0[6]['id']]==8 and ans[q0[0]['id']]==q0[0]['options'][0] and ans[q0[1]['id']]==[q0[1]['options'][0],q0[1]['options'][2]] and ans[q0[1]['id']+':c']=='More tacos',json.dumps(ans))
    # the same phone again → "already answered", with a way for someone else to start fresh
    await ph.reload(); await ph.wait_for_function("()=>/already answered/.test(document.body.innerText)")
    await ph.click('#again'); await ph.wait_for_function("()=>document.querySelectorAll('.scale').length>0")
    # a second response, ratings only
    await ph.evaluate("""()=>{ const scs=document.querySelectorAll('.scale'); scs[0].querySelector('[data-v="5"]').click(); scs[1].querySelector('[data-v="7"]').click(); }""")
    await ph.click('#go'); await ph.wait_for_function("()=>/Thank you/.test(document.body.innerText)")
    check('second response filed',len(fdb._rows('survey_responses'))==2)
    # --- 4. the hub reads the results: counts, averages, distribution, the lean, comments, CSV
    r=await hub.evaluate("""async()=>{ const s=db.surveys[0]; view.stab='results'; await loadResponses(s); render(); const R=SV_R[s.id];
      const q0=s.sections[0].questions; const st=svStats(q0[2],R), sl=svStats(q0[6],R), mu=svStats(q0[1],R);
      const txt=document.getElementById('svBody').textContent;
      return {n:R.length, avg:st.avg, dist:st.dist, slAvg:sl.avg, lean:[sl.left,sl.mid,sl.right], multi:mu.counts, kpi:document.querySelector('.kpi .v').textContent, hasComment:/More tacos/.test(txt), hasSec:/Start at 5:30/.test(txt), lean70:/100% lean higher payouts/.test(txt)}; }""")
    check('results: 2 responses, average 7.0 of two, distribution, slider lean, multi counts, comments shown',r['n']==2 and abs(r['avg']-7)<1e-9 and r['dist'][5]==1 and r['dist'][9]==1 and r['slAvg']==8 and r['lean']==[0,0,1] and list(r['multi'].values())[0]==1 and r['kpi']=='2' and r['hasComment'] and r['hasSec'] and r['lean70'],json.dumps(r))
    # a reload draws the results tab before the sign-in has settled (cached document, sessionOK still false): it must say
    # "loading", not "0", and fill in once the session is confirmed
    r=await hub.evaluate("""async()=>{ const s=db.surveys[0]; delete SV_R[s.id]; delete SV_AT[s.id]; const was=sessionOK; sessionOK=false; render(); const early=document.getElementById('svBody').textContent;
      const cached=SV_R[s.id]; sessionOK=was; render(); await new Promise(r=>setTimeout(r,300)); return {early, cachedEmpty:Array.isArray(cached), n:(SV_R[s.id]||[]).length, kpi:document.querySelector('.kpi .v').textContent}; }""")
    check('results before the session settles: loading, then the real count','Loading' in r['early'] and not r['cachedEmpty'] and r['n']==2 and r['kpi']=='2',json.dumps(r))
    async with hub.expect_download() as dl: await hub.click('#svCsv')
    d=await dl.value; path=await d.path(); csv=open(path,encoding='utf-8-sig').read().splitlines()
    check('csv: header + one row per response, no identity column',len(csv)==3 and csv[0].startswith('"Day","Thursday night golf') and 'More tacos' in csv[1] and not __import__('re').search(r'\b(name|e-?mail|phone|ghin)\b',csv[0].lower()) ,csv[0][:120])
    # --- 5. editing an open survey republishes; closing it closes the link
    r=await hub.evaluate("""async()=>{ const s=db.surveys[0]; s.title='2026 MGA Member Survey — final'; await pushSurvey(s); document.getElementById('svClose').click(); await new Promise(r=>setTimeout(r,400)); return s.status; }""")
    share=fdb._rows('survey_share')
    check('close: share row follows (title + status)',r=='closed' and share[0]['status']=='closed' and share[0]['doc']['title'].endswith('final'))
    await ph.evaluate("()=>localStorage.removeItem(DONE_KEY)"); await ph.reload(); await ph.wait_for_function("()=>/has closed/.test(document.body.innerText)")
    check('closed link shows the closed screen, no questions',await ph.evaluate("()=>document.querySelectorAll('.scale').length===0"))
    sub=fdb._rpc('survey_submit',{'p_token':tok,'p_answers':{'x':1}})
    check('closed survey refuses a submission',json.loads(sub)['error'] is not None)
    # a bad link
    await ph.goto(page('survey.html')+'?k=nope'); await ph.wait_for_function("()=>/not valid/.test(document.body.innerText)")
    check('unknown token → not valid',True)
    # --- 6. delete removes the survey, its share row and its responses
    r=await hub.evaluate("""async()=>{ const s=db.surveys[0]; view.stab='questions'; render(); document.getElementById('svDel').click(); document.getElementById('dDel').click(); await new Promise(r=>setTimeout(r,400)); return {left:db.surveys.length, sid:view.sid}; }""")
    check('delete: gone from the document, the share row and the responses',r['left']==0 and not fdb._rows('survey_share') and not fdb._rows('survey_responses'),json.dumps(r))
    check('no script errors',not herr and not perr and not errs,json.dumps(herr+perr+errs))
    await b.close()
  print('ALL OK' if not bad else f'{bad} FAILED'); sys.exit(1 if bad else 0)
asyncio.run(main())
