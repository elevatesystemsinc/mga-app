"""The course library against the fake (courses-setup.sql semantics).
Run: python3 tests/test_courses.py
Checks: a client's default courses seed a new club document from the library (not Walnut Creek's cards); a club with
no defaults gets a stand-in card and the Courses tab says so; "Other course…" on a game's course select opens the
library, and picking a course copies it into the document (its id, tees and ratings) so the game and its scoring event
use it; the published event carries the course's hole lines; Golf → Courses adds from the library and removes; the
portal lists the library, saves a course and sets a client's defaults; an event may name a library course the document
never copied and still resolves it."""
import asyncio,sys,json,uuid
from playwright.async_api import async_playwright
from _harness import FakeDB,cloud,page
def U(): return str(uuid.uuid4())
PAR=[4,4,5,4,4,3,5,4,3, 4,5,4,4,4,3,4,3,5]; HCP=[9,13,3,5,11,17,1,7,15, 8,2,14,4,6,16,12,18,10]
def lib(id,name,club,city,state,tenant=None,geo=None,verified=True):
    return {'id':id,'tenant':tenant,'name':name,'club':club,'city':city,'state':state,'country':'US','holes':18,'status':'live','verified':verified,'source':'scorecard','notes':None,'geo':geo,
            'data':{'par':{'M':PAR,'W':PAR},'hcp':{'M':HCP,'W':HCP},'tees':[{'name':'Blue','rating':{'M':{'cr':72.1,'slope':135},'W':{'cr':78.0,'slope':140}},'yards':[400]*18},{'name':'White','rating':{'M':{'cr':70.0,'slope':128},'W':{'cr':75.5,'slope':134}},'yards':[370]*18}]}}
def club_doc(name,orgs):
    return {'v':2,'id':'club','kind':'club','name':name,'short':name.split()[0],'members':[{'id':'p1','first':'Ann','last':'Able','email':'ann@x.org','status':'Active','hcp':'8.0'},{'id':'p2','first':'Bo','last':'Baker','status':'Active','hcp':'12.0'},{'id':'p3','first':'Cy','last':'Cole','status':'Active','hcp':'15.0'},{'id':'p4','first':'Di','last':'Dunn','status':'Active','hcp':'20.0'}],'orgs':orgs,'activeSeason':'2026','seasons':{'2026':{}},'tournaments':[],'_rev':2,'_w':'x','_at':1}
def org_doc(id,name,short,kind='group'):
    return {'v':2,'id':id,'kind':kind,'name':name,'short':short,'memberships':[{'id':'p1','status':'Active'},{'id':'p2','status':'Active'},{'id':'p3','status':'Active'},{'id':'p4','status':'Active'}],'activeSeason':'2026','seasons':{'2026':{}},'tournaments':[],'_rev':2,'_w':'x','_at':1}
async def open_page(ctx,q,ready="()=>cloudReady&&!!db"):
    pg=await ctx.new_page(); errs=[]; pg.on('pageerror',lambda e:errs.append(str(e)))
    await pg.goto(page('index.html')+q)
    try: await pg.wait_for_function(ready,timeout=15000)
    except Exception: pass
    await pg.wait_for_timeout(400); return pg,errs
def check(label,ok,r,errs=None):
    print(('OK  ' if ok else 'FAIL'),label,r,errs or ''); return 0 if ok else 1
async def main():
  bad=0; fdb=FakeDB()
  GEO={str(h):[[33.0+h*0.001,-97.0],[33.0+h*0.001,-97.003]] for h in range(1,19)}
  for r in [lib('tx-dallas-brook-hollow','Brook Hollow','Brook Hollow Golf Club','Dallas','TX',geo=GEO),lib('tx-fort-worth-colonial','Colonial','Colonial Country Club','Fort Worth','TX'),lib('va-aldie-creighton-farms','Creighton Farms','The Club at Creighton Farms','Aldie','VA'),lib('pines-nine','The Nine','The Pines Golf Club','Tyler','TX',tenant='pines',verified=False)]:
      fdb._rows('courses').append(r)
  fdb.seed_tenant('pines','The Pines Golf Club',{'golf':True},login_email='gm@pines.org',plan='golf'); fdb.seed_tenant('dco','Data Center Open',{'golf':True,'events':True,'pos':True},plan='golf',kind='nonprofit')
  t=next(x for x in fdb._rows('tenants') if x['slug']=='pines'); t['courses']=['pines-nine','tx-fort-worth-colonial']
  fdb.seed('mga_hub','club',club_doc('The Pines Golf Club',[{'id':'crew','kind':'group','name':'The Crew','short':'Crew'}]),tenant='pines'); fdb.seed('mga_hub','crew',org_doc('crew','The Crew','Crew'),tenant='pines')
  fdb.seed('mga_hub','club',club_doc('Data Center Open',[]),tenant='dco')
  fdb.seed_login('gm@pines.org','pines','staff',name='GM'); fdb.seed_login('ops@dco.org','dco','staff',name='Ops'); fdb.seed_login('zach@flagstick.test',admin=True,name='Zach')
  async with async_playwright() as pw:
    b=await pw.chromium.launch()
    # ---- 1. a club with defaults: the group's new document starts with them, in the tenant's order
    fdb.me='u-gm@pines.org'; c1=await b.new_context(); await cloud(c1,fdb)
    p1,e1=await open_page(c1,'?org=crew&tenant=pines')
    r=await p1.evaluate("()=>({lib:libraryCourses().map(c=>c.id).sort(),courses:golfData().courses.map(c=>[c.id,c.name,c.lib,c.tees.length]),home:homeCourseId()})")
    bad+=check('defaults from the library seed the document (the club’s own first); Walnut Creek’s cards nowhere',r['courses']==[['pines-nine','The Nine','pines-nine',2],['tx-fort-worth-colonial','Colonial','tx-fort-worth-colonial',2]] and r['home']=='pines-nine' and r['lib']==['pines-nine','tx-dallas-brook-hollow','tx-fort-worth-colonial','va-aldie-creighton-farms'],r,e1)
    # ---- 2. the designer's course select: Other course… → the library → the pick lands in the document and the game
    await p1.evaluate("()=>{ designGame(null); }"); await p1.wait_for_selector('#gdCourse')
    r=await p1.evaluate("()=>{ const s=$('gdCourse'); const opts=[...s.options].map(o=>o.value); s.value='__lib__'; s.dispatchEvent(new Event('change',{bubbles:true})); const box=s.parentElement.querySelector('.cpick'); return {opts,box:!!box,stillValue:s.value,rows:box?[...box.querySelectorAll('[data-cp]')].map(x=>x.dataset.cp):[]}; }")
    bad+=check('"Other course…" opens the library under the select (the document’s own courses are not offered twice)',r['opts']==['pines-nine','tx-fort-worth-colonial','__lib__'] and r['box'] and r['stillValue']=='pines-nine' and sorted(r['rows'])==['tx-dallas-brook-hollow','va-aldie-creighton-farms'],r)
    await p1.evaluate("()=>{ const box=$('gdCourse').parentElement.querySelector('.cpick'); box.querySelector('input').value='creigh'; box.querySelector('input').dispatchEvent(new Event('input')); }")
    r=await p1.evaluate("()=>{ const box=$('gdCourse').parentElement.querySelector('.cpick'); const rows=[...box.querySelectorAll('[data-cp]')].map(x=>x.dataset.cp); box.querySelector('[data-cp]').click(); return {rows,value:$('gdCourse').value,tee:[...$('gdTee').options].map(o=>o.value),doc:golfData().courses.map(c=>c.id),gone:!$('gdCourse').parentElement.querySelector('.cpick')}; }")
    bad+=check('search narrows it; a tap copies the course into the document and selects it, the tee list follows',r['rows']==['va-aldie-creighton-farms'] and r['value']=='va-aldie-creighton-farms' and r['tee']==['Blue','White'] and r['doc']==['pines-nine','tx-fort-worth-colonial','va-aldie-creighton-farms'] and r['gone'],r)
    await p1.evaluate("()=>{ $('gdName').value='Away day'; ['p1','p2','p3','p4'].forEach(id=>addPlayer(GD.draft,{memberId:id})); }")
    await p1.evaluate("()=>$('gdSave').click()"); await p1.wait_for_timeout(600)
    r=await p1.evaluate("()=>{ const g=gamesData()[0]; const ev=gameEvent(g); const pub=publicEvent(ev); return {course:g.course,evCourse:ev.defaultCourse,groups:ev.groups.map(x=>x.course),pubCourses:Object.keys(pub.courses),par:pub.courses['va-aldie-creighton-farms']&&pub.courses['va-aldie-creighton-farms'].par.M.reduce((a,b)=>a+b,0),ch:pub.groups[0].players.map(p=>p.ch)}; }")
    bad+=check('the game and its scoring event play the library course; the published copy carries its card and handicaps',r['course']=='va-aldie-creighton-farms' and r['evCourse']=='va-aldie-creighton-farms' and r['groups']==['va-aldie-creighton-farms'] and r['pubCourses']==['va-aldie-creighton-farms'] and r['par']==72 and all(isinstance(x,int) for x in r['ch']),r)
    # the hole lines ride along for GameCast when the library row has them
    r=await p1.evaluate("()=>{ const row=libCourse('tx-dallas-brook-hollow'); const c=adoptCourse(courseFromLib(row)); const g=gamesData()[0], ev=gameEvent(g); ev.groups[0].course=c.id; const pub=publicEvent(ev); return {geo:Object.keys(pub.courses[c.id].geo||{}).length,noGeo:!(pub.courses['va-aldie-creighton-farms']||{}).geo}; }")
    bad+=check('a course with hole lines publishes them (a course without stays light)',r['geo']==18,r)
    # ---- 3. Golf → Courses: the list, add from the library, remove an unused one, the stand-in on a club with no defaults
    await p1.evaluate("()=>{ view.gameId=null; go('golf'); view.gtab='courses'; render(); }"); await p1.wait_for_timeout(300)
    r=await p1.evaluate("()=>({seg:[...document.querySelectorAll('[data-gc]')].map(b=>b.textContent),add:!!$('gcAdd'),nw:!!$('gcNew')})")
    bad+=check('the Courses tab lists the document’s courses with Add from the library and New course',len(r['seg'])==4 and r['add'] and r['nw'],r)
    r=await p1.evaluate("()=>{ view.gcourse='tx-fort-worth-colonial'; render(); return new Promise(res=>setTimeout(()=>{ const b=$('gcRemove'); const dis=b.disabled; b.click(); setTimeout(()=>res({dis,after:golfData().courses.map(c=>c.id)}),200); },150)); }")
    bad+=check('an unused course can be removed from this hub; one in use cannot',not r['dis'] and r['after']==['pines-nine','va-aldie-creighton-farms','tx-dallas-brook-hollow'],r)
    r=await p1.evaluate("()=>{ view.gcourse='tx-dallas-brook-hollow'; render(); return new Promise(res=>setTimeout(()=>res({dis:$('gcRemove').disabled}),150)); }")
    bad+=check('the course a game plays stays',r['dis'],r)
    fdb.me='u-ops@dco.org'; c2=await b.new_context(); await cloud(c2,fdb)
    p2,e2=await open_page(c2,'?org=club&tenant=dco')
    r=await p2.evaluate("()=>{ go('golf'); view.gtab='courses'; render(); return new Promise(res=>setTimeout(()=>res({courses:golfData().courses.map(c=>[c.id,!!c.placeholder]),banner:!!document.querySelector('#main .banner'),opts:[...document.querySelectorAll('#main .cpick')].length}),200)); }")
    bad+=check('a client with no defaults gets a stand-in card, and the Courses tab says to pick a real one',r['courses']==[['home',True]] and r['banner'],r,e2)
    r=await p2.evaluate("()=>{ $('gcAdd').click(); const box=document.querySelector('.cpick'); const rows=[...box.querySelectorAll('[data-cp]')].map(x=>x.dataset.cp); box.querySelector('[data-cp=\"va-aldie-creighton-farms\"]').click(); return new Promise(res=>setTimeout(()=>res({rows,courses:golfData().courses.map(c=>c.id),home:homeCourseId()}),250)); }")
    bad+=check('Add from the library replaces the stand-in; a club’s private course never shows to another client',sorted(r['rows'])==['tx-dallas-brook-hollow','tx-fort-worth-colonial','va-aldie-creighton-farms'] and r['courses']==['va-aldie-creighton-farms'] and r['home']=='va-aldie-creighton-farms',r)
    # a tournament names the course; its round events and flight plan start there
    r=await p2.evaluate("""()=>{ const t=newTournament({season:Y(),name:'Charity Classic',startDate:'2027-06-05',days:1,teamSize:1,entryFee:100}); t.course='va-aldie-creighton-farms'; t.field=[{id:uid(),memberId:'p1',team:0},{id:uid(),memberId:'p2',team:0}]; db.tournaments.push(t); ensureTournamentScoring(t); const ev=roundEvent(t.rounds[0]); return {ev:ev.defaultCourse}; }""")
    bad+=check('a tournament’s course becomes its round events’ default',r['ev']=='va-aldie-creighton-farms',r)
    # an event may reference a library course the document never copied — it still resolves
    r=await p2.evaluate("()=>{ const c=courseById('tx-fort-worth-colonial'); return {name:c&&c.name,inDoc:golfData().courses.some(x=>x.id==='tx-fort-worth-colonial')}; }")
    bad+=check('courseById falls back to the library for an id the document has not copied',r['name']=='Colonial' and not r['inDoc'],r)
    # ---- 4. the portal: the Courses page, a new course, a client's defaults
    fdb.me='u-zach@flagstick.test'; fdb.admin=True; c3=await b.new_context(); await cloud(c3,fdb)
    p3,e3=await open_page(c3,'?portal=1',ready="()=>typeof PS!=='undefined'&&!!PS.tenants")
    await p3.evaluate("()=>{ PS.view='courses'; portalNav(); vPortal($('main')); }"); await p3.wait_for_timeout(200)
    r=await p3.evaluate("()=>({rows:[...document.querySelectorAll('[data-crow]')].map(x=>x.dataset.crow),nav:[...document.querySelectorAll('#nav [data-pv]')].map(b=>b.dataset.pv),owners:[...document.querySelectorAll('[data-crow] .chip')].map(x=>x.textContent)})")
    bad+=check('the portal’s Courses page lists the library and the clubs’ own courses','courses' in r['nav'] and sorted(r['rows'])==['pines-nine','tx-dallas-brook-hollow','tx-fort-worth-colonial','va-aldie-creighton-farms'] and 'PINES' in r['owners'] and 'Library' in r['owners'],r,e3)
    await p3.evaluate("()=>{ $('pcNew').click(); }"); await p3.wait_for_selector('#cName')
    await p3.evaluate("()=>{ $('cName').value='Pecan'; $('cClub').value='Walnut Creek Country Club'; $('cCity').value='Mansfield'; $('cState').value='tx'; $('cId').value='tx-mansfield-walnut-creek-pecan'; const P=[5,4,4,3,4,4,4,3,4,4,4,4,3,4,4,3,4,5], H=[17,15,1,9,5,13,7,11,3,12,2,14,10,4,8,16,6,18]; P.forEach((v,i)=>{ document.querySelector(`[data-cr=\"Par (men)|${i}\"]`).value=v; }); H.forEach((v,i)=>{ document.querySelector(`[data-cr=\"Hcp (men)|${i}\"]`).value=v; }); $('ctN0').value='Gold'; $('ctMC0').value='73.1'; $('ctMS0').value='133'; $('ctWC0').value='80.4'; $('ctWS0').value='146'; $('ctY0').value='457 391 434 153 373 339 381 200 404 432 446 366 213 445 450 191 412 531'; $('cVer').checked=true; $('dSave').click(); }")
    await p3.wait_for_timeout(600)
    row=next((r for r in fdb._rows('courses') if r['id']=='tx-mansfield-walnut-creek-pecan'),None)
    bad+=check('a new library course saves the card, the tee and its ratings, verified',bool(row) and row['tenant'] is None and row['verified'] and row['state']=='TX' and row['data']['par']['M'][17]==5 and row['data']['par']['W']==row['data']['par']['M'] and row['data']['tees'][0]['rating']=={'M':{'cr':73.1,'slope':133},'W':{'cr':80.4,'slope':146}} and sum(row['data']['tees'][0]['yards'])==6618,row and {k:row[k] for k in ('id','tenant','verified','state')} | {'tee0':row['data']['tees'][0],'parW17':row['data']['par']['W'][17]})
    r=await p3.evaluate("()=>{ $('pcNew').click(); return new Promise(res=>setTimeout(()=>{ $('cName').value='Bad'; document.querySelector('[data-cr=\"Hcp (men)|3\"]').value='1'; $('ctN0').value='Blue'; $('dSave').click(); setTimeout(()=>res({open:$('drawer').classList.contains('show'),toast:$('toast').textContent}),150); },150)); }")
    bad+=check('a card with a repeated stroke index is refused',r['open'] and 'each once' in r['toast'],r)
    await p3.evaluate("()=>{ closeDrawer(); openClient('dco'); }"); await p3.wait_for_timeout(300)
    await p3.evaluate("()=>{ $('ptCourses').click(); }"); await p3.wait_for_selector('#pccL')
    r=await p3.evaluate("()=>{ const ids=[...document.querySelectorAll('[data-cc]')].map(x=>x.dataset.cc); document.querySelector('[data-cc=\"va-aldie-creighton-farms\"]').click(); document.querySelector('[data-cc=\"tx-mansfield-walnut-creek-pecan\"]').click(); $('dSave').click(); return new Promise(res=>setTimeout(()=>res({ids}),500)); }")
    t2=next(x for x in fdb._rows('tenants') if x['slug']=='dco')
    bad+=check('a client’s default courses are picked from the library (never another club’s own) and saved on the tenant','pines-nine' not in r['ids'] and sorted(t2.get('courses') or [])==['tx-mansfield-walnut-creek-pecan','va-aldie-creighton-farms'],{'ids':r['ids'],'saved':t2.get('courses')})
    errs=e1+e2+e3
    bad+=check('no script errors',not errs,errs[:3])
    await b.close()
  print('ALL OK' if not bad else f'{bad} FAILED'); sys.exit(1 if bad else 0)
asyncio.run(main())
