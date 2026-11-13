"""A cart game: five players, nothing in the pots, one group — the side game is set up on the phones. Run: python3 tests/test_cartgame.py
The hub (local mode) makes the game through the quick setup's "Just a cart game"; the five land in one group; the game page and the
share step say what a cart game is; the sheet PDF still builds; Same as last time makes another cart game. The phone (against the fake)
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
    # --- the quick setup: five players → Just a cart game → create
    r=await hub.evaluate("""()=>{ quickGame(); QG.picked={}; QG.guests=[]; render(); ['p0','p1','p2','p3','p4'].forEach(id=>document.querySelector('[data-qp="'+id+'"]').click());
      document.getElementById('qgNext').click(); const before=document.getElementById('qgCreate').disabled, cartOpt=document.querySelector('[data-qs="cart"]'), optText=cartOpt&&cartOpt.textContent;
      cartOpt.click(); const after=document.getElementById('qgCreate').disabled, summary=document.querySelector('.qbar').previousElementSibling.previousElementSibling.textContent;
      document.getElementById('qgCreate').click(); const g=gamesData().find(x=>x.id===QG.gameId), ev=gameEvent(g);
      return {before, optText, after, summary, cart:g.cart, pots:g.pots.length, players:g.players.length, groups:ev.groups.map(x=>x.players.length), live:ev.status, share:document.body.innerText.includes('The cart game:')&&document.body.innerText.includes('a cart game — no pots'), sub:document.querySelector('.qstep .sub').textContent}; }""")
    check('step 2: Create is off until something is picked, the cart option says one group for five, Create comes on',r['before'] and 'Everyone plays as one group' in r['optText'] and not r['after'] and 'A cart game' in r['summary'] and 'one group' in r['summary'],json.dumps(r)[:300])
    check('the game: cart, no pots, five players in ONE group, scoring live, the share step explains the cart game',r['cart'] and r['pots']==0 and r['players']==5 and r['groups']==[5] and r['live']=='live' and r['share'],json.dumps(r)[:300])
    r2=await hub.evaluate("""async()=>{ document.getElementById('qgOpen').click(); const g=GAME(), t=document.body.innerText; const chip=[...document.querySelectorAll('.chip')].some(c=>c.textContent==='Cart game · no pots');
      const doc=await gameSheetPDF(g,{returnDoc:true}); const pages=doc?doc.getNumberOfPages():0;
      const list=(()=>{ view.gameId=null; render(); const row=document.querySelector('[data-game="'+g.id+'"]'); return row&&row.textContent; })();
      designGame(g); const des={cart:GD.draft.cart, empty:document.body.innerText.includes('A cart game — nothing in the pots')}; GD=null; view.gdesign=null;
      const n=gamesData().length; quickGame(true); const g2=gamesData().find(x=>x.id===QG.gameId), ev2=gameEvent(g2); QG=null; view.gquick=null; render();
      return {chip, cartCard:t.includes('A cart game')&&t.includes('Side games in the carts'), noKpi:!t.includes('In the pots'), pages, list, des, again:{n:gamesData().length-n, cart:!!g2.cart, pots:g2.pots.length, groups:ev2.groups.map(x=>x.players.length)}}; }""")
    check('the game page: the Cart game chip, the explainer, no pot KPIs; the sheet PDF builds; the list says cart game',r2['chip'] and r2['cartCard'] and r2['noKpi'] and r2['pages']>=1 and 'Cart game' in (r2['list'] or ''),json.dumps(r2)[:400])
    check('Design opens on a cart game; Same as last time makes another cart game of five in one group',r2['des']['cart'] and r2['des']['empty'] and r2['again']=={'n':1,'cart':True,'pots':0,'groups':[5]},json.dumps(r2['again']))
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
