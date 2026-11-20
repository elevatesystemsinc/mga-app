"""A cart game: five players, nothing in the pots, one group — the side game is set up on the phones. Run: python3 tests/test_cartgame.py
The hub (local mode) makes the game in the designer with no competitions; the five land in one group; the game page says
what a cart game is; the sheet PDF still builds; the next New game starts empty of players. The phone (against the fake)
joins the cart: no Finish tab (nothing to pay out), the side-game prompt, Banker allowed for five, the robin not; and moving ahead over
an untouched hole writes no scores (the Misfits' phantom pars, Nov 13) while a hole with one score entered still fills the rest with
par, and Save & next fills an untouched hole on purpose."""
import asyncio,sys,json,copy
from playwright.async_api import async_playwright
from _harness import FakeDB,cloud,page,local
async def main():
  bad=0
  def check(name,cond,info=''):
    nonlocal bad; print(('OK   ' if cond else 'FAIL ')+name,info); bad+=(not cond)
  fdb=FakeDB()
  async with async_playwright() as p:
    b=await p.chromium.launch()
    L=await b.new_context(viewport={'width':390,'height':844}); hub=await L.new_page(); errs=[]; hub.on('pageerror',lambda e:errs.append(str(e)))
    await local(hub); await hub.goto(page('index.html')+'?org=club'); await hub.wait_for_timeout(500)
    await hub.evaluate("()=>{ CLUB.orgs.push({id:'misfits',kind:'group',name:'The Misfits',short:'Misfits'}); ['Ann Able 4.1','Bo Baker 12.0','Cy Cole 20.3','Di Dunn 8.8','Ed Eng 15.0','Flo Fox 9.0'].forEach((x,i)=>{ const [f,l,h]=x.split(' '); CLUB.members.push({id:'p'+i,first:f,last:l,hcp:h,status:'Active'}); }); persist(); }")
    await hub.goto(page('index.html')+'?org=misfits'); await hub.wait_for_timeout(500)
    await hub.evaluate("()=>{ ['p0','p1','p2','p3','p4','p5'].forEach(id=>upsertMember(id,{status:'Active'},{noBill:true})); go('games'); }")
    # --- the designer: five players, no competitions → Save → a cart game
    hub.on('dialog',lambda d:asyncio.ensure_future(d.accept()))
    r=await hub.evaluate("""()=>{ designGame(null); GD.draft.players=[]; GD.draft.pots=[]; ['p0','p1','p2','p3','p4'].forEach(id=>addPlayer(GD.draft,{memberId:id})); render();
      const rows=document.querySelectorAll('[data-gdpx]').length, empty=/A cart game — nothing in the pots|No competitions — a cart game/.test(document.body.innerText); document.getElementById('gdName').value='Cart Thursday'; document.getElementById('gdSave').click();
      const g=gamesData().find(x=>x.name==='Cart Thursday'), ev=g&&gameEvent(g);
      return {rows, empty, cart:g&&g.cart, pots:g&&g.pots.length, players:g&&g.players.length, groups:ev&&ev.groups.map(x=>x.players.length), live:ev&&ev.status, onGame:view.gameId===(g&&g.id)}; }""")
    check('the designer with five players and no competitions says cart game; Save makes it one',r['rows']==5 and r['empty'] and r['cart'] and r['pots']==0,json.dumps(r)[:300])
    check('the game: cart, no pots, five players in ONE group, scoring live, the game page opens',r['players']==5 and r['groups']==[5] and r['live']=='live' and r['onGame'],json.dumps(r)[:300])
    r2=await hub.evaluate("""async()=>{ const g=GAME(), t=document.body.innerText; const chip=[...document.querySelectorAll('.chip')].some(c=>c.textContent==='Cart game · no pots');
      const doc=await gameSheetPDF(g,{returnDoc:true}); const pages=doc?doc.getNumberOfPages():0;
      const list=(()=>{ view.gameId=null; render(); const row=document.querySelector('[data-game="'+g.id+'"]'); return row&&row.textContent; })();
      designGame(g); const des={cart:GD.draft.cart, empty:document.body.innerText.includes('A cart game — nothing in the pots')}; GD=null; view.gdesign=null;
      designGame(null); const next={players:GD.draft.players.length, pots:GD.draft.pots.length, course:GD.draft.course===g.course}; GD=null; view.gdesign=null; render();
      return {chip, cartCard:t.includes('A cart game')&&t.includes('Side games in the carts'), noKpi:!t.includes('In the pots'), pages, list, des, next}; }""")
    check('the game page: the Cart game chip, the explainer, no pot KPIs; the sheet PDF builds; the list says cart game',r2['chip'] and r2['cartCard'] and r2['noKpi'] and r2['pages']>=1 and 'Cart game' in (r2['list'] or ''),json.dumps(r2)[:400])
    check('Design opens on a cart game; the next New game starts from its day with nobody in it and no pots',r2['des']['cart'] and r2['des']['empty'] and r2['next']=={'players':0,'pots':0,'course':True},json.dumps(r2['next']))
    # --- the phone: the event published to the fake
    pub=await hub.evaluate("()=>{ const g=seasonGames()[0], ev=gameEvent(g); return {id:ev.id, slug:ev.slug, pub:publicEvent(ev), codes:Object.fromEntries(ev.groups.map(x=>[x.code,x.id]))}; }")
    fdb._rows('golf_events').append(copy.deepcopy({'id':pub['id'],'slug':pub['slug'],'public':pub['pub'],'codes':pub['codes']}))
    code=list(pub['codes'].keys())[0]; pars=pub['pub']['courses'][list(pub['pub']['courses'].keys())[0]]['par']['M']
    M=await b.new_context(viewport={'width':390,'height':844}); await cloud(M,fdb,no_session=True)
    A=await M.new_page(); aerr=[]; A.on('pageerror',lambda e:aerr.append(str(e))); A.on('dialog',lambda d:asyncio.ensure_future(d.accept()))
    await A.goto(page('score.html')+'?e='+pub['slug']); await A.wait_for_function("()=>!!pub")
    await A.fill('#code',code); await A.click('#joinBtn'); await A.wait_for_function("()=>!!groupId&&!!document.getElementById('sgGo')")
    ph=await A.evaluate("()=>({finish:document.getElementById('tabFinish').hidden, side:!document.getElementById('tabSide').hidden, n:group().players.length, comps:(pub.comps||[]).length})")
    check('the phone: five in the group, no Finish tab (no competitions), the side-game tab on',ph['finish'] and ph['side'] and ph['n']==5 and ph['comps']==0,json.dumps(ph))
    await A.click('#sgGo'); await A.wait_for_selector('#sgStart')
    chips=await A.evaluate("()=>Object.fromEntries([...document.querySelectorAll('[data-game]')].map(b=>[b.dataset.game,b.disabled]))")
    check('five in the cart: Wolf, Hammer, Banker and Flip allowed, the robin not',chips=={'wolf':False,'hammer':False,'banker':False,'robin':True,'flip':False},json.dumps(chips))
    await A.click('[data-game="banker"]'); await A.wait_for_selector('#sgMin'); await A.click('[data-me="'+pub['pub']['groups'][0]['players'][0]['id']+'"]'); await A.click('#sgStart'); await A.wait_for_function("()=>!!side&&side.game==='banker'&&tab==='score'")
    # --- phantom pars: › over an untouched hole writes nothing; one score entered and › fills the rest; Save & next fills an untouched hole
    await A.click('#next'); await A.wait_for_timeout(200)
    r3=await A.evaluate("()=>({h:holeIdx, scored:Object.values(scores).filter(s=>s[1]).length, q:queue.length})")
    check('› over hole 1 with nobody scored: hole 2 on screen and NO scores written',r3['h']==1 and r3['scored']==0 and r3['q']==0,json.dumps(r3))
    await A.click('[data-go="0"]'); await A.wait_for_timeout(100)
    await A.click('.pl [data-p]'); await A.wait_for_timeout(100); await A.click('#next'); await A.wait_for_timeout(300)
    r4=await A.evaluate("(par)=>{ const v=Object.values(scores).map(s=>s[1]); return {n:v.filter(Boolean).length, pars:v.filter(x=>x===par).length, over:v.filter(x=>x===par+1).length}; }",pars[0])
    check('one player bumped to a bogey, then ›: the other four get par on hole 1',r4['n']==5 and r4['over']==1 and r4['pars']==4,json.dumps(r4))
    await A.click('#nextBtn'); await A.wait_for_timeout(300)
    r5=await A.evaluate("(par)=>({h:holeIdx, n:Object.values(scores).filter(s=>s[2]===par).length})",pars[1])
    check('Save & next hole on untouched hole 2 still records par for all five (an explicit save)',r5['h']==2 and r5['n']==5,json.dumps(r5))
    await A.wait_for_function("()=>queue.length===0")
    check('the banker settled hole 1 from those scores: net zero, the bogey loses to the banker or pushes',await A.evaluate("()=>{ const L=sideLedger(pub,group(),scores,side), x=L.holes[0]; return !x.pending&&Math.abs(Object.values(x.money).reduce((a,b)=>a+b,0))<0.005; }"))
    check('no page errors',not errs and not aerr,str(errs+aerr)[:300])
    await b.close()
  sys.exit(1 if bad else 0)
asyncio.run(main())
