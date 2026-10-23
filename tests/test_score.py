"""The public scoring page against the fake database. Run: python3 tests/test_score.py
Checks that a change made in the hub mid-round — a player's index corrected, a group removed — reaches an open
scoring page / leaderboard on its next refresh without a reload, and that a scorer mid-entry is left alone."""
import asyncio,sys,json,copy
from playwright.async_api import async_playwright
from _harness import FakeDB,cloud,page
async def main():
  bad=0
  def check(name,cond,info=''):
    nonlocal bad; print(('OK   ' if cond else 'FAIL ')+name,info); bad+=(not cond)
  fdb=FakeDB()
  async with async_playwright() as p:
    b=await p.chromium.launch()
    # a published event, built by the hub itself in local mode so the shape is the real one
    L=await b.new_context(); hub=await L.new_page(); errs=[]; hub.on('pageerror',lambda e:errs.append(str(e)))
    await hub.route('**/config.js',lambda r:r.fulfill(body="window.MM_CONFIG={};",content_type='text/javascript'))
    await hub.route('**/fonts.googleapis.com/**',lambda r:r.fulfill(body='',content_type='text/css'))
    await hub.goto(page('index.html')+'?org=mga'); await hub.wait_for_function("()=>typeof publicEvent==='function'&&!!db")
    pub=await hub.evaluate("""()=>{ const g=golfData(); const ev={id:'ev1',slug:'test-day',name:'Test day',date:new Date().toISOString().slice(0,10),status:'live',format:'stroke',scoring:'net',defaultCourse:'oak',defaultTee:'White',teamSize:1,count:1,allow:{},pool:[],flights:{count:0,names:[]},
        groups:[{id:'g1',code:'ABC12',label:'Group 1',course:'oak',startHole:1,teeTime:'',players:[{id:'p1',name:'Ann Able',index:'4.0',tee:'White',set:'M'},{id:'p2',name:'Bo Baker',index:'18.0',tee:'White',set:'M'}]},
                {id:'g2',code:'DEF34',label:'Group 2',course:'oak',startHole:2,teeTime:'',players:[{id:'p3',name:'Cy Cole',index:'10.0',tee:'White',set:'M'}]}]};
      g.events.push(ev); return publicEvent(ev); }""")
    check('hub built the event with handicaps',pub['groups'][0]['players'][1]['ph']>pub['groups'][0]['players'][0]['ph'],json.dumps([(q['name'],q['ch'],q['ph']) for q in pub['groups'][0]['players']]))
    row={'id':'ev1','slug':'test-day','public':pub,'codes':{'ABC12':'g1','DEF34':'g2'}}
    fdb._rows('golf_events').append(copy.deepcopy(row))
    for pid,strokes in [('p1',[4,4,4,4,4,4,4,4,4]),('p2',[5,5,5,5,5,5,5,5,5]),('p3',[4,5,4,5,4,5,4,5,4])]:
        for h,s in enumerate(strokes,1): fdb._rows('golf_scores').append({'event_id':'ev1','player_id':pid,'hole':h,'strokes':s})
    # --- 1. the board on a TV: net standings follow a mid-round index correction on the next refresh
    B=await b.new_context(); await cloud(B,fdb,no_session=True)
    tv=await B.new_page(); tverr=[]; tv.on('pageerror',lambda e:tverr.append(str(e)))
    await tv.goto(page('score.html')+'?e=test-day&view=board'); await tv.wait_for_function("()=>!!pub&&document.querySelectorAll('.lb').length>1")
    await tv.evaluate("()=>{ lbSort='net'; render(); }")
    def net_of(rows,name): return next((r for r in rows if r[0].startswith(name)),None)
    rows=await tv.evaluate("()=>[...document.querySelectorAll('.lb.num')].map(r=>[r.children[1].textContent,r.lastElementChild.textContent])")
    before=net_of(rows,'Bo Baker'); check('board shows Bo net before the change',before is not None,json.dumps(rows))
    # the hub corrects Bo's index from 18.0 to 8.0 → republishes the event (what golfSave does)
    pub2=await hub.evaluate("""()=>{ const ev=golfData().events.find(e=>e.id==='ev1'); ev.groups[0].players[1].index='8.0'; return publicEvent(ev); }""")
    fdb._rows('golf_events')[0]['public']=copy.deepcopy(pub2)
    changed=await tv.evaluate("()=>refresh().then(()=>pub.groups[0].players[1].ph)")
    rows2=await tv.evaluate("()=>[...document.querySelectorAll('.lb.num')].map(r=>[r.children[1].textContent,r.lastElementChild.textContent])")
    after=net_of(rows2,'Bo Baker')
    check('board picked up the new playing handicap without a reload',changed==pub2['groups'][0]['players'][1]['ph'] and changed<pub['groups'][0]['players'][1]['ph'],f'ph {pub["groups"][0]["players"][1]["ph"]} → {changed}')
    check('Bo net total moved with the index',before and after and before[1]!=after[1],f'{before} → {after}')
    # --- 2. a scorer's phone: the group joins, and a change arrives while a score box has focus → no re-render
    ph=await B.new_page(); pherr=[]; ph.on('pageerror',lambda e:pherr.append(str(e)))
    await ph.goto(page('score.html')+'?e=test-day'); await ph.wait_for_function("()=>!!pub&&!!document.getElementById('code')")
    await ph.fill('#code','ABC12'); await ph.click('#joinBtn'); await ph.wait_for_function("()=>groupId==='g1'&&tab==='score'")
    marker=await ph.evaluate("()=>{ const i=document.querySelector('input,select,button'); const first=document.querySelector('input'); if(first) first.focus(); document.body.dataset.mark='1'; return !!first; }")
    pub3=copy.deepcopy(pub2); pub3['name']='Test day (renamed)'; fdb._rows('golf_events')[0]['public']=pub3
    r=await ph.evaluate("()=>refresh().then(()=>({name:pub.name,typing:typing(),mark:document.body.dataset.mark}))")
    check('scorer mid-entry keeps the screen, data still updated',r['name']=='Test day (renamed)' and (not marker or r['typing']),json.dumps(r))
    await ph.evaluate("()=>{ document.activeElement&&document.activeElement.blur(); }")
    # --- 3. the scorer's group is removed from the event → back to the join screen, not a dead page
    pub4=copy.deepcopy(pub3); pub4['groups']=[g for g in pub4['groups'] if g['id']!='g1']; fdb._rows('golf_events')[0]['public']=pub4
    r=await ph.evaluate("()=>refresh().then(()=>({groupId,join:!!document.getElementById('code')}))")
    check('a removed group sends the phone back to the join screen',r['groupId'] is None and r['join'],json.dumps(r))
    # --- 4. score entry: moving on from a hole without touching anyone records par for them — by the arrow, not only the Save button
    D=await b.new_context(); await cloud(D,fdb,no_session=True)
    fdb._rows('golf_events')[0]['public']=copy.deepcopy(pub2)
    sc=await D.new_page(); scerr=[]; sc.on('pageerror',lambda e:scerr.append(str(e)))
    await sc.goto(page('score.html')+'?e=test-day'); await sc.wait_for_function("()=>!!pub&&!!document.getElementById('code')")
    await sc.fill('#code','DEF34'); await sc.click('#joinBtn'); await sc.wait_for_function("()=>groupId==='g2'&&tab==='score'")
    r=await sc.evaluate("""async()=>{ const g=group(), order=playOrder(g.startHole); holeIdx=9; renderHole(); const h=order[9], par=pub.courses[g.course].par.M[h-1]; const before=(scores.p3||{})[h]||null;
      document.getElementById('next').click(); await new Promise(r=>setTimeout(r,400)); return {h, par, before, after:(scores.p3||{})[h]||null, hole:holeIdx, queued:queue.length}; }""")
    srv=[x for x in fdb._rows('golf_scores') if x['player_id']=='p3' and x['hole']==r['h']]
    check('the › arrow records par for an untouched hole and it reaches the server',r['before'] is None and r['after']==r['par'] and r['hole']==10 and len(srv)==1 and srv[0]['strokes']==r['par'],json.dumps(r))
    r=await sc.evaluate("""async()=>{ const g=group(), order=playOrder(g.startHole); holeIdx=10; renderHole(); const h=order[10]; document.getElementById('prev').click(); return {h, left:(scores.p3||{})[h]||null, hole:holeIdx}; }""")
    check('going back leaves the hole alone',r['left'] is None and r['hole']==9,json.dumps(r))
    check('no script errors',not errs and not tverr and not pherr and not scerr,json.dumps(errs+tverr+pherr+scerr))
    await b.close()
  print('ALL OK' if not bad else f'{bad} FAILED'); sys.exit(1 if bad else 0)
asyncio.run(main())
