"""A side game inside one group on the scoring page, against the fake database. Run: python3 tests/test_wolf.py
A cart of five sets up a 6-4 wolf from a phone (who am I, the stakes, the tee order); the wolf picks a partner or goes
alone for 1x, 2x or 3x; the money settles from the scores hole by hole, net zero every hole; a second phone in the cart
picks up the same wolf and only has to say who it is; a stale phone is told to look again; at the 16th hole the cart
is asked about Big Lou (the player most down is the wolf, with its own bet); the hub's game page shows the ledger."""
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
    pub=await hub.evaluate("""()=>{ const g=golfData(); const ev={id:'ev1',slug:'wolf-day',name:'Wolf day',date:new Date().toISOString().slice(0,10),status:'live',format:'stroke',scoring:'net',defaultCourse:'oak',defaultTee:'White',teamSize:1,count:1,allow:{'*':100},
        groups:[{id:'g1',code:'ABC12',label:'Group 1',course:'oak',startHole:1,teeTime:'',players:[{id:'p1',name:'Ann Able',index:'0.0',tee:'White',set:'M'},{id:'p2',name:'Bo Baker',index:'0.0',tee:'White',set:'M'},{id:'p3',name:'Cy Cole',index:'0.0',tee:'White',set:'M'},{id:'p4',name:'Di Dunn',index:'0.0',tee:'White',set:'M'},{id:'p5',name:'Ed Eng',index:'0.0',tee:'White',set:'M'}]}]};
      g.events.push(ev); window.EV=ev; return publicEvent(ev); }""")
    row={'id':'ev1','slug':'wolf-day','public':pub,'codes':{'ABC12':'g1'}}
    fdb._rows('golf_events').append(copy.deepcopy(row))
    # --- 1. phone A joins, is asked about a side game, sets up the 6-4 wolf
    M=await b.new_context(viewport={'width':390,'height':844}); await cloud(M,fdb,no_session=True)
    A=await M.new_page(); aerr=[]; A.on('pageerror',lambda e:aerr.append(str(e))); A.on('dialog',lambda d:asyncio.ensure_future(d.accept()))
    await A.goto(page('score.html')+'?e=wolf-day'); await A.wait_for_function("()=>!!pub")
    await A.fill('#code','ABC12'); await A.click('#joinBtn'); await A.wait_for_function("()=>!!groupId&&!!document.getElementById('sgGo')")
    check('phone A: the hole screen asks about a side game',await A.evaluate("()=>/Playing a game in your cart/.test(document.body.innerText)&&document.getElementById('tabSide').textContent==='Side game'"))
    await A.click('#sgGo'); await A.wait_for_selector('#sgStart')
    txt=await A.evaluate("()=>document.body.innerText")
    check('set-up: who am I, Wolf, net/gross, the money, the tee order, the preview per configuration, 2x/3x, Big Lou',all(x in txt for x in ['Who are you?','Wolf','Net (full handicaps)','each player on the smaller side','each player on the larger side','Tee order','Wolf + partner v 3','each $6 · each $4 · $12 a side','Lone wolf v 4','wolf $16 · each $4 · $16 a side','Lone wolf 2x / 3x','$32 / $48','the wolf sets the bet','Big Lou','1. Ann Able','5. Ed Eng']),txt[:400])
    await A.click('#sgStart')   # without a name
    check('set-up refuses without "who are you"',await A.evaluate("()=>!!document.getElementById('sgStart')&&!side"))
    await A.click('[data-me="p1"]')
    await A.click('[data-up="1"]')   # Bo to the top: order Bo, Ann, Cy, Di, Ed
    await A.click('#sgStart'); await A.wait_for_function("()=>!!side&&tab==='score'")
    rows=fdb._rows('golf_side')
    check('the wolf is on: one row for the group, v 1, the stakes, the order, who set it',len(rows)==1 and rows[0]['group_id']=='g1' and rows[0]['v']==1 and rows[0]['data']['stakes']=={'small':6,'large':4} and rows[0]['data']['order']==['p2','p1','p3','p4','p5'] and rows[0]['data']['setBy']=='p1' and rows[0]['data']['scoring']=='net',json.dumps(rows[0]['data']))
    st=await A.evaluate("()=>({strip:document.querySelector('.sgbar').innerText, tab:document.getElementById('tabSide').textContent, me:localStorage.getItem('mga_me_wolf-day')})")
    check('hole 1: the strip names the wolf from the tee order (Bo), offers the partners and Lone wolf; the tab reads Wolf',st['strip'].startswith('WOLF · HOLE 1') and 'Wolf: Bo' in st['strip'] and all(n in st['strip'] for n in ['Ann','Cy','Di','Ed','Lone wolf']) and 'Who are you' not in st['strip'] and st['tab']=='Wolf' and st['me']=='p1',st['strip'])
    # --- 2. the pick, then the scores: wolf + partner win → +6 each, −4 each
    await A.click('[data-pick="p1"]'); await A.wait_for_function("()=>side.holes&&side.holes[1]&&side.holes[1].pick==='p1'")
    st=await A.evaluate("()=>document.querySelector('.sgbar').innerText")
    check('partner picked: Bo & Ann v Cy & Di & Ed, waiting for the scores',('Bo & Ann' in st) and ('Cy & Di & Ed' in st) and 'waiting for the scores' in st,st)
    await A.evaluate("()=>{ setStroke('p2',1,4); setStroke('p1',1,5); setStroke('p3',1,5); setStroke('p4',1,5); setStroke('p5',1,5); renderHole(); }")
    st=await A.evaluate("()=>document.querySelector('.sgbar').innerText")
    check('hole 1 settles: wolf side wins, +$6 the wolf side; totals Bo +6, Ann +6, Cy −4, Di −4, Ed −4','Wolf side wins' in st and '+$6' in st and 'Cy −$4' in st and 'Ed −$4' in st and 'Ann +$6' in st,st)
    await A.wait_for_function("()=>queue.length===0")
    # --- 3. phone B joins the same cart: the same wolf, it only has to say who it is; on hole 2 the wolf (Ann) goes alone for 1x
    N=await b.new_context(viewport={'width':390,'height':844}); await cloud(N,fdb,no_session=True)
    B=await N.new_page(); berr=[]; B.on('pageerror',lambda e:berr.append(str(e))); B.on('dialog',lambda d:asyncio.ensure_future(d.accept()))
    await B.goto(page('score.html')+'?e=wolf-day'); await B.wait_for_function("()=>!!pub")
    await B.fill('#code','ABC12'); await B.click('#joinBtn'); await B.wait_for_function("()=>!!groupId&&!!side")
    st=await B.evaluate("()=>({h:holeIdx, strip:document.querySelector('.sgbar').innerText, ask:!!document.getElementById('sgGo')})")
    check('phone B: no second set-up — the same wolf, hole 2, Ann is the wolf, totals carried, asked who it is',st['h']==1 and not st['ask'] and 'HOLE 2' in st['strip'] and 'Wolf: Ann' in st['strip'] and 'Bo +$6' in st['strip'] and 'Who are you?' in st['strip'],st['strip'])
    await B.click('[data-iam="p2"]'); await B.wait_for_function("()=>ME==='p2'&&!/Who are you/.test(document.querySelector('.sgbar').innerText)")
    st=await B.evaluate("()=>document.querySelector('.sgbar').innerText")
    check('every hole: the wolf sets the bet — 1x / 2x / 3x / Other, with what each pick is worth',all(x in st for x in ['THE BET','1x','2x','3x','Other','partner: $6 / $4 each','alone: wolf $16, each $4']),st)
    await B.click('[data-bet="2"]'); await B.wait_for_function("()=>/alone: wolf \\$32, each \\$8/.test(document.getElementById('sgBetLine').textContent)")
    check('2x previews $12 / $8 as a pair, $32 alone',await B.evaluate("()=>/partner: \\$12 \\/ \\$8 each/.test(document.getElementById('sgBetLine').textContent)"))
    await B.click('[data-bet="1"]'); await B.click('[data-pick="lone"]'); await B.wait_for_function("()=>side.holes[2]&&side.holes[2].pick==='lone'&&side.holes[2].mult===1")
    await B.evaluate("()=>{ setStroke('p1',2,3); setStroke('p2',2,4); setStroke('p3',2,4); setStroke('p4',2,4); setStroke('p5',2,4); renderHole(); }")
    st=await B.evaluate("()=>document.querySelector('.sgbar').innerText")
    check('lone wolf wins hole 2 at 1x: +$16 to Ann, −$4 each; totals Ann +22, Bo +2, the others −8','Lone wolf wins' in st and '+$16' in st and 'Ann +$22' in st and 'Bo +$2' in st and 'Cy −$8' in st,st)
    await B.wait_for_function("()=>queue.length===0")
    await A.evaluate("async()=>{ await loadScores(); await loadSide(); holeIdx=1; renderHole(); }")
    st=await A.evaluate("()=>document.querySelector('.sgbar').innerText")
    check('phone A sees B\'s call and the money',('Lone wolf wins' in st) and 'Ann +$22' in st,st)
    # --- 4. a push pays nothing; a stale phone is told to look again and nothing is lost
    await A.evaluate("()=>{ holeIdx=2; renderHole(); }"); await A.click('[data-pick="p4"]'); await A.wait_for_function("()=>side.holes[3]&&side.holes[3].pick==='p4'")
    await A.evaluate("()=>{ ['p1','p2','p3','p4','p5'].forEach(id=>setStroke(id,3,4)); renderHole(); }")
    st=await A.evaluate("()=>document.querySelector('.sgbar').innerText")
    check('hole 3 all square: push, totals unchanged','Push' in st and 'Ann +$22' in st,st)
    v=fdb._rows('golf_side')[0]['v']
    await B.evaluate("()=>{ sideV=sideV-1; holeIdx=3; renderHole(); }"); await B.click('[data-pick="p5"]'); await B.wait_for_timeout(500)
    check('a stale phone cannot overwrite: the row is untouched and the phone reloaded it',fdb._rows('golf_side')[0]['v']==v and 'pick' not in (fdb._rows('golf_side')[0]['data']['holes'].get('4') or {}) and await B.evaluate("()=>sideV")==v)
    # --- 5. hole 5: Ed alone for 3x → +$48, −$12 each
    await A.evaluate("async()=>{ await loadSide(); holeIdx=4; renderHole(); }"); await A.click('[data-bet="3"]'); await A.click('[data-pick="lone"]'); await A.wait_for_function("()=>side.holes[5]&&side.holes[5].mult===3")
    await A.evaluate("()=>{ setStroke('p5',5,3); ['p1','p2','p3','p4'].forEach(id=>setStroke(id,5,4)); renderHole(); }")
    st=await A.evaluate("()=>document.querySelector('.sgbar').innerText")
    check('3x lone wolf: Ed +$48, −$12 each; totals Ann +10, Bo −10, Cy −20, Di −20, Ed +40','×3' in st and '+$48' in st and 'Ann +$10' in st and 'Bo −$10' in st and 'Cy −$20' in st and 'Ed +$40' in st,st)
    await A.wait_for_function("()=>queue.length===0")
    # hole 6: Bo takes Ann at 2x → +$12 each, −$8 each; hole 7: Ann names her own bet, $9 / $6, and takes Cy → +$9 each, −$6 each
    await A.evaluate("()=>{ holeIdx=5; renderHole(); }"); await A.click('[data-bet="2"]'); await A.click('[data-pick="p1"]'); await A.wait_for_function("()=>side.holes[6]&&side.holes[6].pick==='p1'&&side.holes[6].mult===2")
    await A.evaluate("()=>{ setStroke('p2',6,3); ['p1','p3','p4','p5'].forEach(id=>setStroke(id,6,4)); renderHole(); }")
    st=await A.evaluate("()=>document.querySelector('.sgbar').innerText")
    check('a partner hole at 2x: Bo & Ann +$12 each, −$8 each; totals Ann +22, Bo +2, Cy −28, Di −28, Ed +32','×2' in st and '+$12' in st and 'Ann +$22' in st and 'Bo +$2' in st and 'Cy −$28' in st and 'Ed +$32' in st,st)
    await A.evaluate("()=>{ holeIdx=6; renderHole(); }"); await A.click('[data-bet="x"]'); await A.wait_for_selector('#sgBS'); await A.fill('#sgBS','9'); await A.fill('#sgBL','6')
    check('a typed bet previews its worth',await A.evaluate("()=>/partner: \\$9 \\/ \\$6 each · alone: wolf \\$24, each \\$6/.test(document.getElementById('sgBetLine').textContent)"))
    await A.click('[data-pick="p3"]'); await A.wait_for_function("()=>side.holes[7]&&side.holes[7].pick==='p3'&&side.holes[7].stakes&&side.holes[7].stakes.small===9")
    await A.evaluate("()=>{ setStroke('p1',7,3); ['p2','p3','p4','p5'].forEach(id=>setStroke(id,7,4)); renderHole(); }")
    st=await A.evaluate("()=>document.querySelector('.sgbar').innerText")
    check('a hole at its own bet 9/6: Ann & Cy +$9 each, −$6 each; totals Ann +31, Bo −4, Cy −19, Di −34, Ed +26','$9 / $6' in st and '+$9' in st and 'Ann +$31' in st and 'Bo −$4' in st and 'Cy −$19' in st and 'Di −$34' in st and 'Ed +$26' in st,st)
    await A.wait_for_function("()=>queue.length===0")
    # --- 6. the 16th hole asks about Big Lou; the player most down is the wolf, with a new bet
    await A.evaluate("()=>{ holeIdx=15; renderHole(); }")
    st=await A.evaluate("()=>document.querySelector('.sgbar').innerText")
    check('hole 16 asks about Big Lou','Big Lou from here?' in st and 'wolf on 16, 17 and 18' in st,st)
    await A.click('#sgLouYes'); await A.wait_for_selector('#sgLouGo'); await A.fill('#sgLS','12'); await A.fill('#sgLL','8'); await A.click('#sgLouGo')
    await A.wait_for_function("()=>side.bigLou&&side.bigLou.stakes&&side.bigLou.stakes.large===8")
    st=await A.evaluate("()=>document.querySelector('.sgbar').innerText")
    check('Big Lou on: Di (most down at −34) is the wolf on 16','BIG LOU' in st.upper() and 'Wolf: Di' in st and '(most down)' in st,st)
    await A.click('[data-pick="p2"]'); await A.wait_for_function("()=>side.holes[16]&&side.holes[16].pick==='p2'")
    await A.evaluate("()=>{ setStroke('p4',16,3); ['p1','p2','p3','p5'].forEach(id=>setStroke(id,16,4)); renderHole(); }")
    st=await A.evaluate("()=>document.querySelector('.sgbar').innerText")
    check('hole 16 at the Big Lou bet 12/8: Di & Bo +$12 each, the others −$8; Ann +23, Bo +8, Cy −27, Di −22, Ed +18','+$12' in st and 'Ann +$23' in st and 'Bo +$8' in st and 'Cy −$27' in st and 'Di −$22' in st and 'Ed +$18' in st,st)
    await A.evaluate("()=>{ holeIdx=16; renderHole(); }")
    st=await A.evaluate("()=>document.querySelector('.sgbar').innerText")
    check('hole 17: the wolf moves to Cy, now the most down','Wolf: Cy' in st and '(most down)' in st,st)
    # --- 7. the ledger tab
    await A.evaluate("()=>{ tab='side'; render(); }")
    txt=await A.evaluate("()=>document.body.innerText")
    check('ledger: per player and per hole, multipliers and Big Lou marked, net zero',all(x in txt for x in ['Ann Able','+$23','Bo Baker','+$8','Ed Eng','+$18','7 of 18 holes settled','Bo + Ann','Ann alone','Ed alone ×3','Bo + Ann ×2','Ann + Cy at $9 / $6','BIG LOU','Di + Bo','push','Big Lou from hole 16 at $12 / $8','(2x $32, 3x $48)']) and abs(sum(r['net'] for r in (await A.evaluate("()=>sideLedger(pub,group(),scores,side).rows"))))<0.001,repr(txt[:1500]))
    await A.evaluate("()=>{ tab='score'; holeIdx=0; render(); }"); await A.click('#sgUndo'); await A.wait_for_function("()=>!side.holes[1].pick")
    check('the wolf\'s call on a hole can be changed',await A.evaluate("()=>!!document.querySelector('[data-pick=\"lone\"]')"))
    await A.click('[data-pick="p1"]'); await A.wait_for_function("()=>side.holes[1].pick==='p1'")
    # --- 8. the hub's game page shows the cart's ledger from the same math
    r=await hub.evaluate("""()=>{ const sd=%s; SIDE['ev1']={sig:'x',rows:[{group_id:'g1',data:sd}]}; golfScores['ev1']=%s; const h=sideGamesCard(window.EV); const d=document.createElement('div'); d.innerHTML=h; return d.innerText; }""" % (json.dumps(fdb._rows('golf_side')[0]['data']),json.dumps({pid:{int(h):s for h,s in v.items()} for pid,v in (await A.evaluate("()=>scores")).items()})))
    check('hub card: Side games in the carts, the stakes line, the money per player',all(x in r for x in ['Side games in the carts','Group ABC12 · Wolf','$4 a player on the big side','lone wolf for $16','$6 each as a pair','Ann Able','+$23','Ed Eng','+$18','7 of 18 holes settled']),repr(r[:600]))
    # --- 9. end it
    await A.evaluate("()=>{ tab='side'; render(); }"); await A.click('#sgEdit'); await A.wait_for_selector('#sgEnd'); await A.click('#sgEnd'); await A.wait_for_function("()=>!side&&tab==='score'")
    check('ended: the row is gone, the hole screen asks again',len(fdb._rows('golf_side'))==0 and await A.evaluate("()=>!!document.getElementById('sgGo')"))
    check('no script errors (hub / phones)',not errs and not aerr and not berr,json.dumps(errs+aerr+berr))
    await b.close()
  print('ALL OK' if not bad else f'{bad} FAILED'); sys.exit(1 if bad else 0)
asyncio.run(main())
