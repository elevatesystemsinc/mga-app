"""Hammer inside one group on the scoring page, against the fake database. Run: python3 tests/test_hammer.py
Wolf's machinery plus the hammer: once the sides are set either side can throw it; accepted, the hole doubles and the hammer passes;
hammered back, it doubles again; declined, the side that declined forfeits the hole at the bet before it — and the winners' birdie
still doubles that unless the forfeiting side birdied too (the layer is shaved). Birdies double, eagles triple on every game. Wolf,
Hammer, Banker and Flip take 3 to 5 players, never 6; the robin four only."""
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
    L=await b.new_context(); hub=await L.new_page(); errs=[]; hub.on('pageerror',lambda e:errs.append(str(e)))
    await hub.route('**/config.js',lambda r:r.fulfill(body="window.MM_CONFIG={};",content_type='text/javascript'))
    await hub.route('**/fonts.googleapis.com/**',lambda r:r.fulfill(body='',content_type='text/css'))
    await hub.goto(page('index.html')+'?org=mga'); await hub.wait_for_function("()=>typeof publicEvent==='function'&&!!db")
    pl=lambda n:[{'id':'p%d'%i,'name':nm,'index':'0.0','tee':'White','set':'M'} for i,nm in enumerate(['Ann Able','Bo Baker','Cy Cole','Di Dunn','Ed Eng','Flo Fox'][:n],1)]
    pub=await hub.evaluate("""(pl)=>{ const g=golfData(); const ev={id:'ev1',slug:'hammer-day',name:'Hammer day',date:new Date().toISOString().slice(0,10),status:'live',format:'stroke',scoring:'net',defaultCourse:'oak',defaultTee:'White',teamSize:1,count:1,allow:{'*':100},
        groups:[{id:'g1',code:'HAM12',label:'Group 1',course:'oak',startHole:1,teeTime:'',players:pl.four},{id:'g2',code:'SIX12',label:'Group 2',course:'oak',startHole:10,teeTime:'',players:pl.six}]};
      g.events.push(ev); window.EV=ev; return publicEvent(ev); }""",{'four':pl(4),'six':pl(6)})
    fdb._rows('golf_events').append(copy.deepcopy({'id':'ev1','slug':'hammer-day','public':pub,'codes':{'HAM12':'g1','SIX12':'g2'}}))
    pars=pub['courses']['oak']['par']['M']
    M=await b.new_context(viewport={'width':390,'height':844}); await cloud(M,fdb,no_session=True)
    A=await M.new_page(); aerr=[]; A.on('pageerror',lambda e:aerr.append(str(e))); A.on('dialog',lambda d:asyncio.ensure_future(d.accept()))
    # a six-man cart is not offered a side game yet
    await A.goto(page('score.html')+'?e=hammer-day'); await A.wait_for_function("()=>!!pub")
    await A.fill('#code','SIX12'); await A.click('#joinBtn'); await A.wait_for_function("()=>!!groupId")
    check('six players: no side game offered, no Side tab',await A.evaluate("()=>!document.getElementById('sgGo')&&document.getElementById('tabSide').hidden"))
    await A.evaluate("()=>{ localStorage.clear(); }"); await A.goto(page('score.html')+'?e=hammer-day'); await A.wait_for_function("()=>!!pub")
    await A.fill('#code','HAM12'); await A.click('#joinBtn'); await A.wait_for_function("()=>!!groupId&&!!document.getElementById('sgGo')")
    check('four players: the ask names Hammer',await A.evaluate("()=>/Wolf, Hammer, Banker, Flip or a round robin/.test(document.body.innerText)"))
    await A.click('#sgGo'); await A.wait_for_selector('#sgStart'); await A.click('[data-game="hammer"]'); await A.wait_for_function("()=>document.querySelector('[data-game=\"hammer\"]').classList.contains('on')")
    txt=await A.evaluate("()=>document.body.innerText")
    check('hammer set-up: the wolf\'s page with the hammer line and Start the hammer',all(x in txt for x in ['Hammer','each player — two against two','Tee order','The hammer','accepted, the hole doubles','Start the hammer']),txt[:300])
    await A.click('[data-me="p1"]'); await A.click('[data-bd="gross"]'); await A.click('#sgStart'); await A.wait_for_function("()=>!!side&&side.game==='hammer'&&tab==='score'")
    row=fdb._rows('golf_side')[0]['data']
    check('the hammer is on: $5 a player in a four-man cart, the order, gross birdies',row['game']=='hammer' and row['stakes']=={'small':5,'large':5} and row['birdies']=='gross',json.dumps(row))
    # --- hole 1: Ann wolf + Bo; the others hammer, accepted; the wolf side hammer back, accepted; wolf side win 4 v 5 → ×4
    check('no hammer before the pick',not await A.evaluate("()=>!!document.querySelector('[data-hm]')"))
    await A.click('[data-pick="p2"]'); await A.wait_for_function("()=>side.holes[1]&&side.holes[1].pick==='p2'")
    st=await A.evaluate("()=>[...document.querySelectorAll('[data-hm]')].map(b=>b.dataset.hm+':'+b.textContent)")
    check('sides set: either side may hammer, each button says what the hole would be worth',len(st)==2 and st[0].startswith('S:Wolf side hammer · $10 each') and st[1].startswith('L:The others hammer · $10 each'),st)
    await A.click('[data-hm="L"]'); await A.wait_for_function("()=>side.holes[1].hammers&&side.holes[1].hammers.length===1&&!side.holes[1].hammers[0].resp")
    st=await A.evaluate("()=>document.querySelector('.sgbar').innerText")
    check('a hammer in the air: thrown by the others, the wolf side to answer — Accept $10 each or Decline and forfeit at $5 each; no hammer buttons','Hammer! thrown by the others' in st and 'the wolf side to answer' in st and 'Accept · $10 each' in st and 'Decline · forfeit at $5 each' in st and not await A.evaluate("()=>!!document.querySelector('[data-hm]')"),st)
    par1=pars[0]
    await A.evaluate("(p)=>{ setStroke('p1',1,p); setStroke('p2',1,p+1); setStroke('p3',1,p+1); setStroke('p4',1,p+1); renderHole(); }",par1)
    money=lambda P,h:P.evaluate("(h)=>{ const L=sideLedger(pub,group(),scores,side); const x=L.holes.find(y=>y.h===h); return {money:x.money, hx:x.hx, bonus:x.bonus&&x.bonus.txt, pending:x.pending, forfeit:!!x.forfeit}; }",h)
    st=await A.evaluate("()=>document.querySelector('.sgbar').innerText")
    check('scores in but the hammer unanswered: nothing settles','a hammer in the air' in st and 'Ann $0' in st,st)
    await A.click('#sgHmAcc'); await A.wait_for_function("()=>side.holes[1].hammers[0].resp==='accept'")
    st=await A.evaluate("()=>({t:document.querySelector('.sgbar').innerText, hm:[...document.querySelectorAll('[data-hm]')].map(b=>b.dataset.hm)})")
    m=await money(A,1)
    check('accepted: ×2 hammer, the wolf side win $10 each; only the wolf side may hammer back','×2 hammer' in st['t'] and 'Wolf side wins' in st['t'] and m['money']=={'p1':10,'p2':10,'p3':-10,'p4':-10} and st['hm']==['S'],(st,m))
    await A.click('[data-hm="S"]'); await A.wait_for_function("()=>side.holes[1].hammers.length===2")
    await A.click('#sgHmAcc'); await A.wait_for_function("()=>side.holes[1].hammers[1].resp==='accept'")
    st=await A.evaluate("()=>({t:document.querySelector('.sgbar').innerText, hm:[...document.querySelectorAll('[data-hm]')].map(b=>b.dataset.hm)})")
    m=await money(A,1)
    check('hammered back and accepted: ×4, $20 each, the others hold the hammer','×4 hammer' in st['t'] and m['money']=={'p1':20,'p2':20,'p3':-20,'p4':-20} and 'Ann +$20' in st['t'] and st['hm']==['L'],(st,m))
    await A.wait_for_function("()=>queue.length===0")
    # --- hole 2: Bo wolf + Ann; the others hammer; the wolf side decline → the others take it at $4 / $4; Cy birdies → $8 / $8
    N=await b.new_context(viewport={'width':390,'height':844}); await cloud(N,fdb,no_session=True)
    B=await N.new_page(); berr=[]; B.on('pageerror',lambda e:berr.append(str(e))); B.on('dialog',lambda d:asyncio.ensure_future(d.accept()))
    await B.goto(page('score.html')+'?e=hammer-day'); await B.wait_for_function("()=>!!pub")
    await B.fill('#code','HAM12'); await B.click('#joinBtn'); await B.wait_for_function("()=>!!groupId&&!!side")
    st=await B.evaluate("()=>({strip:document.querySelector('.sgbar').innerText, tab:document.getElementById('tabSide').textContent, h:holeIdx})")
    check('phone B: the same hammer on hole 2, Bo the wolf, totals carried, the tab reads Hammer',st['h']==1 and 'Wolf: Bo' in st['strip'] and 'Ann +$20' in st['strip'] and st['tab']=='Hammer',st)
    await B.click('[data-iam="p3"]'); await B.wait_for_function("()=>ME==='p3'")
    await B.click('[data-pick="p1"]'); await B.wait_for_function("()=>side.holes[2]&&side.holes[2].pick==='p1'")
    await B.click('[data-hm="L"]'); await B.wait_for_function("()=>side.holes[2].hammers&&side.holes[2].hammers.length===1")
    await B.click('#sgHmDec'); await B.wait_for_function("()=>side.holes[2].hammers[0].resp==='decline'")
    st=await B.evaluate("()=>document.querySelector('.sgbar').innerText")
    check('declined: the wolf side forfeit the hole at $5 each; the scores still decide any birdie','Hammer declined' in st and 'the wolf side forfeit the hole at $5 each' in st and 'the scores decide any birdie' in st and not await B.evaluate("()=>!!document.querySelector('[data-hm]')"),st)
    par2=pars[1]
    await B.evaluate("(p)=>{ setStroke('p1',2,p); setStroke('p2',2,p); setStroke('p3',2,p-1); setStroke('p4',2,p+1); renderHole(); }",par2)
    st=await B.evaluate("()=>document.querySelector('.sgbar').innerText")
    m=await money(B,2)
    check('the others take it, Cy\'s birdie doubles the forfeited hole: $10 each','The others take it' in st and 'forfeited' in st and 'birdie ×2' in st and m['forfeit'] and m['money']=={'p1':-10,'p2':-10,'p3':10,'p4':10},(st,m))
    await B.wait_for_function("()=>queue.length===0")
    # --- hole 3: Cy wolf + Di; the others hammer, declined; both sides birdie → the layer is shaved, $4 / $4
    await B.evaluate("()=>{ holeIdx=2; renderHole(); }")
    await B.click('[data-pick="p4"]'); await B.wait_for_function("()=>side.holes[3]&&side.holes[3].pick==='p4'")
    await B.click('[data-hm="L"]'); await B.wait_for_function("()=>side.holes[3].hammers&&side.holes[3].hammers.length===1")
    await B.click('#sgHmDec'); await B.wait_for_function("()=>side.holes[3].hammers[0].resp==='decline'")
    par3=pars[2]
    await B.evaluate("(p)=>{ setStroke('p1',3,p-1); setStroke('p2',3,p+1); setStroke('p3',3,p-1); setStroke('p4',3,p); renderHole(); }",par3)
    st=await B.evaluate("()=>document.querySelector('.sgbar').innerText")
    m=await money(B,3)
    check('both sides birdie after the forfeit: the birdie layer is shaved — $5 each, no ×2','The others take it' in st and m['forfeit'] and m['bonus']=='' and m['money']=={'p3':-5,'p4':-5,'p1':5,'p2':5},(st,m))
    await B.wait_for_function("()=>queue.length===0")
    # --- hole 4: Di wolf alone 2x; the others eagle → eagle ×3 on top of the lone wolf's 2x
    await B.evaluate("()=>{ holeIdx=3; renderHole(); }")
    await B.click('#sgLone'); await B.wait_for_selector('[data-lone="2"]'); await B.click('[data-lone="2"]'); await B.wait_for_function("()=>side.holes[4]&&side.holes[4].pick==='lone'&&side.holes[4].mult===2")
    st=await B.evaluate("()=>[...document.querySelectorAll('[data-hm]')].map(b=>b.textContent)")
    check('a lone wolf keeps 2x ($30 against $10 each) and the hammer sits on top: a hammer would make it $60 / $20',len(st)==2 and '$60 / $20' in st[0],st)
    par4=pars[3]
    await B.evaluate("(p)=>{ setStroke('p4',4,p); setStroke('p1',4,p-2); setStroke('p2',4,p); setStroke('p3',4,p+1); renderHole(); }",par4)
    st=await B.evaluate("()=>document.querySelector('.sgbar').innerText")
    m=await money(B,4)
    check('an eagle triples: the others win the lone wolf\'s 2x × 3 = $30 each, the lone wolf −$90','The others win' in st and 'eagle ×3' in st and m['money']=={'p4':-90,'p1':30,'p2':30,'p3':30},(st,m))
    await B.click('#sgTab'); await B.wait_for_selector('#sgEdit')
    txt=await B.evaluate("()=>document.body.innerText")
    check('hammer ledger: the hammer rule, ×4 hammer, the forfeit, the shaved birdie, eagle ×3',all(x in txt for x in ['Hammer','the hammer doubles the hole each time it is accepted','×4 hammer','declined, the wolf side forfeit','birdie ×2','eagle ×3','4 of 18 holes settled']),txt[:400])
    sd=fdb._rows('golf_side')[0]['data']; sc={'p1':{1:par1},'p2':{1:par1+1},'p3':{1:par1+1},'p4':{1:par1+1}}
    r=await hub.evaluate("""()=>{ const sd=%s; SIDE['ev1']={sig:'h',rows:[{group_id:'g1',data:sd}]}; golfScores['ev1']=%s; const d=document.createElement('div'); d.innerHTML=sideGamesCard(window.EV); return d.innerText; }"""%(json.dumps(sd),json.dumps(sc)))
    check('hub card: Hammer, the wolf line with the hammer, birdies double eagles triple, the money',all(x in r for x in ['Group HAM12 · Hammer','$5 a player','the hammer doubles the hole','gross birdies double, eagles triple','+$20','−$20','1 of 18 holes settled']),r)
    check('no script errors (hub / phones)',not errs and not aerr and not berr,json.dumps(errs+aerr+berr))
    await b.close()
  print('ALL OK' if not bad else f'{bad} FAILED'); sys.exit(1 if bad else 0)
asyncio.run(main())
