"""Banker and the round robin inside one group on the scoring page, against the fake database. Run: python3 tests/test_sidegames.py
A cart of four picks a game on the set-up (Wolf, Banker, Round robin — the robin only for four): Banker — the first in the order
banks, each of the others names a bet between the minimum and the maximum, the banker doubles, the money settles one-on-one and
net zero, the hole's outright winner takes the bank and a tie leaves it; a second phone picks the same game up. Round robin —
partners drawn with no pairing twice in a row, every pairing once in a 6-hole robin and twice in a 3-hole one, best ball (and the
low total when asked) paid pair to pair; the hub's game page shows both from the same math."""
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
    pub=await hub.evaluate("""()=>{ const g=golfData(); const ev={id:'ev1',slug:'bank-day',name:'Bank day',date:new Date().toISOString().slice(0,10),status:'live',format:'stroke',scoring:'net',defaultCourse:'oak',defaultTee:'White',teamSize:1,count:1,allow:{'*':100},
        groups:[{id:'g1',code:'BNK12',label:'Group 1',course:'oak',startHole:1,teeTime:'',players:[{id:'p1',name:'Ann Able',index:'0.0',tee:'White',set:'M'},{id:'p2',name:'Bo Baker',index:'0.0',tee:'White',set:'M'},{id:'p3',name:'Cy Cole',index:'0.0',tee:'White',set:'M'},{id:'p4',name:'Di Dunn',index:'0.0',tee:'White',set:'M'}]}]};
      g.events.push(ev); window.EV=ev; return publicEvent(ev); }""")
    fdb._rows('golf_events').append(copy.deepcopy({'id':'ev1','slug':'bank-day','public':pub,'codes':{'BNK12':'g1'}}))
    M=await b.new_context(viewport={'width':390,'height':844}); await cloud(M,fdb,no_session=True)
    A=await M.new_page(); aerr=[]; A.on('pageerror',lambda e:aerr.append(str(e))); A.on('dialog',lambda d:asyncio.ensure_future(d.accept()))
    await A.goto(page('score.html')+'?e=bank-day'); await A.wait_for_function("()=>!!pub")
    await A.fill('#code','BNK12'); await A.click('#joinBtn'); await A.wait_for_function("()=>!!groupId&&!!document.getElementById('sgGo')")
    check('the hole screen names the three games',await A.evaluate("()=>/Wolf, Banker or a round robin/.test(document.body.innerText)"))
    await A.click('#sgGo'); await A.wait_for_selector('#sgStart')
    chips=await A.evaluate("()=>[...document.querySelectorAll('[data-game]')].map(b=>[b.dataset.game,b.disabled,b.classList.contains('on')])")
    check('set-up: Wolf, Banker and Round robin on offer, Wolf on, the robin allowed for four',chips==[['wolf',False,True],['banker',False,False],['robin',False,False]],chips)
    # --- 1. Banker: Ann banks first, bets $1–$5, the bank to the winner
    await A.click('[data-game="banker"]'); await A.wait_for_selector('#sgMin')
    txt=await A.evaluate("()=>document.body.innerText")
    check('banker set-up: bets min / max, the bank to the winner or rotating, the tee order, the preview',all(x in txt for x in ['smallest bet a player may name','largest','The hole\'s winner takes it','Rotates with the tee order','Tee order','A bet, doubled by the banker','$1–$5 → $2–$10','biggest swing','$30']),txt[:300])
    await A.click('[data-me="p2"]'); await A.click('#sgStart'); await A.wait_for_function("()=>!!side&&side.game==='banker'&&tab==='score'")
    row=fdb._rows('golf_side')[0]
    check('the banker is on: one row, stakes 1–5, the bank to the winner, the order, Bo set it',row['data']['stakes']=={'min':1,'max':5} and row['data']['bank']=='winner' and row['data']['order']==['p1','p2','p3','p4'] and row['data']['setBy']=='p2',json.dumps(row['data']))
    st=await A.evaluate("()=>document.querySelector('.sgbar').innerText")
    check('hole 1: Ann banks (first up); Bo, Cy, Di each at the $1 minimum with − / +; Double it; the tab reads Banker','BANKER · HOLE 1' in st and 'Banker: Ann' in st and 'first up' in st and st.count('$1')>=3 and 'Double it' in st and await A.evaluate("()=>document.getElementById('tabSide').textContent==='Banker'"),st)
    # Bo bets $3 (two taps), Cy $5 (four taps — and the + stops at the max), Di stays at $1
    for _ in range(2): await A.click('[data-bet="p2"][data-d="1"]'); await A.wait_for_timeout(150)
    for _ in range(5):
      ok=await A.evaluate("()=>{ const b=document.querySelector('[data-bet=\"p3\"][data-d=\"1\"]'); if(b&&!b.disabled){ b.click(); return true; } return false; }")
      await A.wait_for_timeout(150)
    await A.wait_for_function("()=>side.holes&&side.holes[1]&&side.holes[1].bets&&side.holes[1].bets.p2===3&&side.holes[1].bets.p3===5")
    check('bets named: Bo $3, Cy $5 (the + is disabled at the max), Di unnamed = $1',await A.evaluate("()=>document.querySelector('[data-bet=\"p3\"][data-d=\"1\"]').disabled&&!document.querySelector('[data-bet=\"p3\"][data-d=\"-1\"]').disabled&&document.querySelector('[data-bet=\"p4\"][data-d=\"-1\"]').disabled"))
    await A.click('#sgDouble'); await A.wait_for_function("()=>side.holes[1].double===true")
    st=await A.evaluate("()=>document.querySelector('.sgbar').innerText")
    check('the banker doubled: every bet ×2, change offered','Doubled' in st and '×2' in st and 'change' in st,st)
    # scores: Ann 5, Bo 4 (wins $6), Cy 6 (loses $10), Di 5 (push)
    await A.evaluate("()=>{ setStroke('p1',1,5); setStroke('p2',1,4); setStroke('p3',1,6); setStroke('p4',1,5); renderHole(); }")
    st=await A.evaluate("()=>document.querySelector('.sgbar').innerText")
    check('hole 1 settles one-on-one: Bo +$6, Cy −$10, Di push, the banker +$4; net zero','+$6' in st and '−$10' in st and 'push' in st and 'Ann +$4' in st and 'Bo +$6' in st and 'Cy −$10' in st and 'Di $0' in st,st)
    await A.wait_for_function("()=>queue.length===0")
    await A.evaluate("()=>{ holeIdx=1; renderHole(); }")
    st=await A.evaluate("()=>document.querySelector('.sgbar').innerText")
    check('hole 2: Bo won hole 1 outright, so Bo banks (took the bank); the bets start again at $1','Banker: Bo' in st and 'took the bank' in st and 'Ann' in st and not 'Doubled' in st,st)
    # --- 2. phone B joins: same banker, only asked who it is; a tie on hole 2 leaves the bank with Bo
    N=await b.new_context(viewport={'width':390,'height':844}); await cloud(N,fdb,no_session=True)
    B=await N.new_page(); berr=[]; B.on('pageerror',lambda e:berr.append(str(e))); B.on('dialog',lambda d:asyncio.ensure_future(d.accept()))
    await B.goto(page('score.html')+'?e=bank-day'); await B.wait_for_function("()=>!!pub")
    await B.fill('#code','BNK12'); await B.click('#joinBtn'); await B.wait_for_function("()=>!!groupId&&!!side")
    st=await B.evaluate("()=>({strip:document.querySelector('.sgbar').innerText, ask:!!document.getElementById('sgGo'), h:holeIdx})")
    check('phone B: no second set-up — the same banker on hole 2, Bo banks, totals carried, asked who it is',not st['ask'] and st['h']==1 and 'Banker: Bo' in st['strip'] and 'Ann +$4' in st['strip'] and 'Who are you?' in st['strip'],st)
    await B.click('[data-iam="p3"]'); await B.wait_for_function("()=>ME==='p3'")
    await B.click('[data-bet="p3"][data-d="1"]'); await B.wait_for_function("()=>side.holes[2]&&side.holes[2].bets&&side.holes[2].bets.p3===2")
    await B.evaluate("()=>{ ['p1','p2','p3','p4'].forEach(id=>setStroke(id,2,4)); renderHole(); }")
    st=await B.evaluate("()=>document.querySelector('.sgbar').innerText")
    check('hole 2 all square: three pushes, $0 banker',st.count('push')==3 and 'Banker Bo' in st and '$0' in st,st)
    await B.wait_for_function("()=>queue.length===0")
    await B.evaluate("()=>{ holeIdx=2; renderHole(); }")
    st=await B.evaluate("()=>document.querySelector('.sgbar').innerText")
    check('hole 3: a tie leaves the bank with Bo','Banker: Bo' in st and 'took the bank' in st,st)
    # the cart hands the bank to someone else by hand
    await B.click('#sgBankChg'); await B.wait_for_selector('[data-bank="p4"]'); await B.click('[data-bank="p4"]'); await B.wait_for_function("()=>side.holes[3]&&side.holes[3].banker==='p4'")
    st=await B.evaluate("()=>document.querySelector('.sgbar').innerText")
    check('the banker can be chosen by hand','Banker: Di' in st and '(chosen)' in st,st)
    # the ledger tab
    await B.click('#sgTab'); await B.wait_for_selector('#sgEdit')
    txt=await B.evaluate("()=>document.body.innerText")
    check('banker ledger: bets 1–5, the bank to the winner, per player and per hole with the double marked',all(x in txt for x in ['Banker','bets of $1 to $5','Ann Able','+$4','Bo Baker','+$6','Cy Cole','−$10','×2','Bo $3','Cy $5','2 of 18 holes settled']),txt[:400])
    # the hub card from the same row
    sd=fdb._rows('golf_side')[0]['data']; sc={'p1':{1:5,2:4},'p2':{1:4,2:4},'p3':{1:6,2:4},'p4':{1:5,2:4}}
    r=await hub.evaluate("""()=>{ const sd=%s; SIDE['ev1']={sig:'x',rows:[{group_id:'g1',data:sd}]}; golfScores['ev1']=%s; const d=document.createElement('div'); d.innerHTML=sideGamesCard(window.EV); return d.innerText; }"""%(json.dumps(sd),json.dumps(sc)))
    check('hub card: Banker, the bets line, the money per player',all(x in r for x in ['Group BNK12 · Banker','bets of $1 to $5','the banker may double','Ann Able','+$4','Cy Cole','−$10','2 of 18 holes settled']),r)
    # --- 3. switch the cart to a round robin: partners drawn, no pairing twice running, every pairing once (6) / twice (3)
    await B.click('#sgEdit'); await B.wait_for_selector('[data-game="robin"]'); await B.click('[data-game="robin"]'); await B.wait_for_selector('#sgRedraw')
    txt=await B.evaluate("()=>document.body.innerText")
    check('robin set-up: switch every 6 / 3, the stake, best ball or best ball + low total, the drawn schedule',all(x in txt for x in ['Switch partners every','6 holes','3 holes','each player of the winning pair','Best ball + low total','Holes 1–6','Holes 7–12','Holes 13–18','Draw again']),txt[:400])
    def key(pr): return '|'.join(sorted(''.join(sorted(x)) for x in pr))
    sched=await B.evaluate("()=>sgUI.pairs")
    check('6-hole robin: three segments, the three pairings each once',len(sched)==3 and len({key(pr) for pr in sched})==3 and all(sorted(sum(pr,[]))==['p1','p2','p3','p4'] for pr in sched),sched)
    await B.click('[data-seg="3"]'); await B.wait_for_function("()=>sgUI.pairs&&sgUI.pairs.length===6")
    sched=await B.evaluate("()=>sgUI.pairs"); ks=[key(pr) for pr in sched]
    check('3-hole robin: six segments, each pairing twice, never the same partners in two running segments',len(sched)==6 and all(ks.count(k)==2 for k in set(ks)) and all(ks[i]!=ks[i-1] for i in range(1,6)),ks)
    before=await B.evaluate("()=>JSON.stringify(sgUI.pairs)")
    for _ in range(6):
      await B.click('#sgRedraw'); await B.wait_for_timeout(60)
      if await B.evaluate("()=>JSON.stringify(sgUI.pairs)")!=before: break
    check('Draw again changes the schedule',await B.evaluate("()=>JSON.stringify(sgUI.pairs)")!=before)
    await B.click('[data-pts="both"]'); await B.fill('#sgStake','2'); await B.click('#sgStart'); await B.wait_for_function("()=>!!side&&side.game==='robin'&&tab==='score'")
    row=fdb._rows('golf_side')[0]['data']
    check('the robin is on: 3-hole, $2, best ball + low total, the pairs saved, the banker\'s holes gone',row['seg']==3 and row['stakes']=={'hole':2} and row['points']=='both' and len(row['pairs'])==6 and row['holes']=={} and row['drawnBy']=='p3',json.dumps({k:v for k,v in row.items() if k!='pairs'}))
    st=await B.evaluate("()=>({strip:document.querySelector('.sgbar').innerText, tab:document.getElementById('tabSide').textContent})")
    pr=row['pairs'][0]; names={'p1':'Ann','p2':'Bo','p3':'Cy','p4':'Di'}
    check('hole 3 (holes 1–3): the first pairing on the strip, new partners on 4, the tab reads Round robin','ROUND ROBIN · HOLE 3 · HOLES 1–3' in st['strip'] and ' & '.join(names[x] for x in pr[0]) in st['strip'] and 'new partners on 4' in st['strip'] and st['tab']=='Round robin',st)
    # scores on hole 3 (already 4,4,4,4 from the banker hole? no — hole 3 is open): the first pair wins the ball and the total
    a,bb=pr[0]; c,d=pr[1]
    await B.evaluate("(x)=>{ setStroke(x.a,3,3); setStroke(x.b,3,5); setStroke(x.c,3,4); setStroke(x.d,3,5); renderHole(); }",{'a':a,'b':bb,'c':c,'d':d})
    st=await B.evaluate("()=>document.querySelector('.sgbar').innerText")
    m=await B.evaluate("()=>{ const L=sideLedger(pub,group(),scores,side); const x=L.holes.find(y=>y.h===3); return {money:x.money, sum:Object.values(L.net).reduce((a,b)=>a+b,0)}; }")
    check('hole 3: best ball 3 v 4 and total 8 v 9 to the first pair: +$4 each, −$4 each, net zero (holes 1–2 settle from the banker\'s scores too)','Best ball 3 v 4' in st and 'total 8 v 9' in st and '+$4 each' in st and m['money'][a]==4 and m['money'][bb]==4 and m['money'][c]==-4 and m['money'][d]==-4 and abs(m['sum'])<0.005,(st,m))
    await B.wait_for_function("()=>queue.length===0")
    # hole 4: the second pairing; the ball to one side, the total to the other = a push
    pr2=row['pairs'][1]; a2,b2=pr2[0]; c2,d2=pr2[1]
    await B.evaluate("(x)=>{ holeIdx=3; setStroke(x.a,4,3); setStroke(x.b,4,7); setStroke(x.c,4,4); setStroke(x.d,4,4); renderHole(); }",{'a':a2,'b':b2,'c':c2,'d':d2})
    st=await B.evaluate("()=>document.querySelector('.sgbar').innerText")
    check('hole 4: new partners; the ball one way (3 v 4), the total the other (10 v 8) — a push','HOLES 4–6' in st and ' & '.join(names[x] for x in pr2[0]) in st and 'Best ball 3 v 4' in st and 'total 10 v 8' in st and 'Push' in st,st)
    await B.wait_for_function("()=>queue.length===0")
    await B.click('#sgTab'); await B.wait_for_selector('#sgEdit')
    txt=await B.evaluate("()=>document.body.innerText")
    check('robin ledger: the stakes line, per player, per hole with partners and results',all(x in txt for x in ['Round robin','$2 a hole on the best ball and $2 on the low total','partners switch every 3 holes','+$4 each','push','4 of 18 holes settled']),txt[:400])
    await A.evaluate("async()=>{ await loadSide(); await loadScores(); render(); }")
    st=await A.evaluate("()=>({game:side.game, tab:document.getElementById('tabSide').textContent})")
    check('phone A picks up the switch to the round robin',st['game']=='robin' and st['tab']=='Round robin',st)
    sd=fdb._rows('golf_side')[0]['data']; sc={a:{3:3,4:3 if a==a2 else 0},}
    r=await hub.evaluate("""()=>{ const sd=%s; SIDE['ev1']={sig:'y',rows:[{group_id:'g1',data:sd}]}; golfScores['ev1']=%s; const d=document.createElement('div'); d.innerHTML=sideGamesCard(window.EV); return d.innerText; }"""%(json.dumps(sd),json.dumps({a:{3:3},bb:{3:5},c:{3:4},d:{3:5}})))
    check('hub card: Round robin, the stakes line, the money',all(x in r for x in ['Group BNK12 · Round robin','$2 a hole on the best ball and the low total','switched every 3 holes','+$4','−$4','1 of 18 holes settled']),r)
    check('no script errors (hub / phones)',not errs and not aerr and not berr,json.dumps(errs+aerr+berr))
    await b.close()
  print('ALL OK' if not bad else f'{bad} FAILED'); sys.exit(1 if bad else 0)
asyncio.run(main())
