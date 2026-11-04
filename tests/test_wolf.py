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
    check('set-up: who am I, Wolf, net/gross, the money, the tee order, the preview per configuration, 2x/3x, Big Lou',all(x in txt for x in ['Who are you?','Wolf','Net (full handicaps)','each player on the smaller side','each player on the larger side','Tee order','Wolf + partner v 3','each $6 · each $4 · $12 a side','Lone wolf v 4','wolf $16 · each $4 · $16 a side','Lone wolf 2x / 3x','$32 / $48','names the bet each hole','1. Ann Able','5. Ed Eng']),txt[:400])
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
    check('a regular hole has no bet boxes — the game\'s stakes stand',not await B.evaluate("()=>!!document.getElementById('sgBS')"))
    await B.click('#sgLone'); await B.wait_for_selector('[data-lone="1"]')
    st=await B.evaluate("()=>document.querySelector('.sgbar').innerText")
    check('lone wolf asks 1x / 2x / 3x with the money',all(x in st for x in ['1x · wolf $16, each $4','2x · wolf $32, each $8','3x · wolf $48, each $12']),st)
    await B.click('[data-lone="1"]'); await B.wait_for_function("()=>side.holes[2]&&side.holes[2].pick==='lone'&&side.holes[2].mult===1")
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
    await A.evaluate("async()=>{ await loadSide(); holeIdx=4; renderHole(); }"); await A.click('#sgLone'); await A.click('[data-lone="3"]'); await A.wait_for_function("()=>side.holes[5]&&side.holes[5].mult===3")
    await A.evaluate("()=>{ setStroke('p5',5,3); ['p1','p2','p3','p4'].forEach(id=>setStroke(id,5,4)); renderHole(); }")
    st=await A.evaluate("()=>document.querySelector('.sgbar').innerText")
    check('3x lone wolf: Ed +$48, −$12 each; totals Ann +10, Bo −10, Cy −20, Di −20, Ed +40','×3' in st and '+$48' in st and 'Ann +$10' in st and 'Bo −$10' in st and 'Cy −$20' in st and 'Ed +$40' in st,st)
    await A.wait_for_function("()=>queue.length===0")
    # --- 6. the 16th hole asks about Big Lou; the player most down is the wolf, with a new bet
    await A.evaluate("()=>{ holeIdx=15; renderHole(); }")
    st=await A.evaluate("()=>document.querySelector('.sgbar').innerText")
    check('hole 16 asks about Big Lou','Big Lou from here?' in st and 'wolf on 16, 17 and 18' in st and 'names the bet on each hole' in st,st)
    await A.click('#sgLouYes'); await A.wait_for_function("()=>!!side.bigLou")
    st=await A.evaluate("()=>document.querySelector('.sgbar').innerText")
    check('Big Lou on, but Cy and Di are tied at −20: no Big Lou yet, a draw is offered','BIG LOU' in st.upper() and 'Big Lou is tied' in st and 'Cy & Di' in st and 'Big Lou:' not in st and not await A.evaluate("()=>!!document.getElementById('sgBS')"),st)
    await A.click('#sgDraw'); await A.wait_for_function("()=>side.holes[16]&&side.holes[16].wolf&&side.holes[16].draw",timeout=10000)
    W=await A.evaluate("()=>side.holes[16].wolf"); P='p4' if W=='p3' else 'p3'; WN='Cy' if W=='p3' else 'Di'
    st=await A.evaluate("()=>({t:document.querySelector('.sgbar').innerText, s:document.getElementById('sgBS').value, l:document.getElementById('sgBL').value, d:side.holes[16].draw})")
    check('drawn: one of the two is Big Lou, marked as drawn from both, saved for the cart; the bet boxes start at 6 / 4',W in ('p3','p4') and ('Big Lou: '+WN) in st['t'] and '(drawn from Cy & Di)' in st['t'] and sorted(st['d']['from'])==['p3','p4'] and st['s']=='6' and st['l']=='4',st['t'])
    await A.fill('#sgBS','12'); await A.fill('#sgBL','8')
    check('the named bet previews its worth',await A.evaluate("()=>/partner: \\$12 \\/ \\$8 each · alone: wolf \\$32, each \\$8/.test(document.getElementById('sgBetLine').textContent)"))
    await A.click('[data-pick="%s"]'.replace('%s',P)); await A.wait_for_function("()=>side.holes[16]&&side.holes[16].pick&&side.holes[16].stakes&&side.holes[16].stakes.large===8")
    await A.evaluate("(W)=>{ setStroke(W,16,3); ['p1','p2','p3','p4','p5'].filter(id=>id!==W).forEach(id=>setStroke(id,16,4)); renderHole(); }",W)
    st=await A.evaluate("()=>document.querySelector('.sgbar').innerText")
    check('hole 16 at the named 12/8: Cy & Di +$12 each, the others −$8; Ann +2, Bo −18, Cy −8, Di −8, Ed +32','$12 / $8' in st and '+$12' in st and 'Ann +$2' in st and 'Bo −$18' in st and 'Cy −$8' in st and 'Ed +$32' in st,st)
    await A.evaluate("()=>{ holeIdx=16; renderHole(); }")
    st=await A.evaluate("()=>({t:document.querySelector('.sgbar').innerText, s:document.getElementById('sgBS').value, l:document.getElementById('sgBL').value})")
    check('hole 17: Bo, now the most down, is Big Lou; the boxes carry 12 / 8 for him to change','Big Lou: Bo' in st['t'] and '(most down)' in st['t'] and st['s']=='12' and st['l']=='8',st['t'])
    await A.fill('#sgBS','20'); await A.fill('#sgBL','10'); await A.click('#sgLone'); await A.wait_for_selector('[data-lone="2"]')
    st=await A.evaluate("()=>document.querySelector('.sgbar').innerText")
    check('a lone Big Lou at the named 20/10: 1x $40, 2x $80, 3x $120','1x · wolf $40, each $10' in st and '2x · wolf $80, each $20' in st and '3x · wolf $120, each $30' in st,st)
    await A.click('[data-lone="2"]'); await A.wait_for_function("()=>side.holes[17]&&side.holes[17].mult===2&&side.holes[17].stakes.large===10")
    await A.evaluate("()=>{ setStroke('p2',17,3); ['p1','p3','p4','p5'].forEach(id=>setStroke(id,17,4)); renderHole(); }")
    st=await A.evaluate("()=>document.querySelector('.sgbar').innerText")
    check('hole 17: Bo alone at 2x of 20/10 wins $80, −$20 each; Ann −18, Bo +62, Cy −28, Di −28, Ed +12','+$80' in st and 'Ann −$18' in st and 'Bo +$62' in st and 'Cy −$28' in st and 'Ed +$12' in st,st)
    await A.wait_for_function("()=>queue.length===0")
    # --- 7. the ledger tab
    await A.evaluate("()=>{ tab='side'; render(); }")
    txt=await A.evaluate("()=>document.body.innerText")
    check('ledger: per player and per hole, multipliers and Big Lou marked, net zero',all(x in txt for x in ['Ann Able','−$18','Bo Baker','+$62','Ed Eng','+$12','6 of 18 holes settled','Bo + Ann','Ann alone','Ed alone ×3','BIG LOU','(drawn)','+ '+('Di' if W=='p3' else 'Cy')+' at $12 / $8','Bo alone ×2 at $20 / $10','push','Big Lou from hole 16, the bet named hole by hole','(2x $32, 3x $48)']) and abs(sum(r['net'] for r in (await A.evaluate("()=>sideLedger(pub,group(),scores,side).rows"))))<0.001,repr(txt[:1500]))
    await A.evaluate("()=>{ tab='score'; holeIdx=0; render(); }"); await A.click('#sgUndo'); await A.wait_for_function("()=>!side.holes[1].pick")
    check('the wolf\'s call on a hole can be changed',await A.evaluate("()=>!!document.getElementById('sgLone')"))
    await A.click('[data-pick="p1"]'); await A.wait_for_function("()=>side.holes[1].pick==='p1'")
    # --- 8. the hub's game page shows the cart's ledger from the same math
    r=await hub.evaluate("""()=>{ const sd=%s; SIDE['ev1']={sig:'x',rows:[{group_id:'g1',data:sd}]}; golfScores['ev1']=%s; const h=sideGamesCard(window.EV); const d=document.createElement('div'); d.innerHTML=h; return d.innerText; }""" % (json.dumps(fdb._rows('golf_side')[0]['data']),json.dumps({pid:{int(h):s for h,s in v.items()} for pid,v in (await A.evaluate("()=>scores")).items()})))
    check('hub card: Side games in the carts, the stakes line, the money per player',all(x in r for x in ['Side games in the carts','Group ABC12 · Wolf','$4 a player on the big side','lone wolf for $16','$6 each as a pair','Ann Able','−$18','Ed Eng','+$12','6 of 18 holes settled']),repr(r[:600]))
    # --- 9. end it
    await A.evaluate("()=>{ tab='side'; render(); }"); await A.click('#sgEdit'); await A.wait_for_selector('#sgEnd'); await A.click('#sgEnd'); await A.wait_for_function("()=>!side&&tab==='score'")
    check('ended: the row is gone, the hole screen asks again',len(fdb._rows('golf_side'))==0 and await A.evaluate("()=>!!document.getElementById('sgGo')"))
    check('no script errors (hub / phones)',not errs and not aerr and not berr,json.dumps(errs+aerr+berr))
    await b.close()
  print('ALL OK' if not bad else f'{bad} FAILED'); sys.exit(1 if bad else 0)
asyncio.run(main())
