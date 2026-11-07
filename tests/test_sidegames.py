"""Banker, Flip and the round robin inside one group on the scoring page, against the fake database. Run: python3 tests/test_sidegames.py
A cart of four picks a game on the set-up (Wolf, Banker, Flip, Round robin — the robin only for four). Banker — the first in the order
banks, names the hole's range inside the game's allowable one ($1–$100, $5 steps), each of the others steps their bet through the amounts
in it, the money settles one-on-one and net zero, the hole's outright winner takes the bank and a tie leaves it, the range carries until
the next banker names theirs; a second phone picks the same game up. Flip — heads v tails from the coins called on the tee, the smaller
side shares the larger side's stakes, all the same coin is everyone for themselves, one tie all tie; gross birdies double the hole.
Round robin — partners drawn with no pairing twice in a row, every pairing once in a 6-hole robin and twice in a 3-hole one, best ball
(and the low total when asked) paid pair to pair. The hub's game page shows each from the same math."""
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
    pars=pub['courses']['oak']['par']['M']
    M=await b.new_context(viewport={'width':390,'height':844}); await cloud(M,fdb,no_session=True)
    A=await M.new_page(); aerr=[]; A.on('pageerror',lambda e:aerr.append(str(e))); A.on('dialog',lambda d:asyncio.ensure_future(d.accept()))
    await A.goto(page('score.html')+'?e=bank-day'); await A.wait_for_function("()=>!!pub")
    await A.fill('#code','BNK12'); await A.click('#joinBtn'); await A.wait_for_function("()=>!!groupId&&!!document.getElementById('sgGo')")
    check('the hole screen names the four games',await A.evaluate("()=>/Wolf, Banker, Flip or a round robin/.test(document.body.innerText)"))
    await A.click('#sgGo'); await A.wait_for_selector('#sgStart')
    chips=await A.evaluate("()=>[...document.querySelectorAll('[data-game]')].map(b=>[b.dataset.game,b.disabled,b.classList.contains('on')])")
    check('set-up: Wolf, Banker, Round robin and Flip on offer, Wolf on, the robin allowed for four',chips==[['wolf',False,True],['banker',False,False],['robin',False,False],['flip',False,False]],chips)
    check('every game has net / gross and the birdie switch',await A.evaluate("()=>!!document.querySelector('[data-sc=\"gross\"]')&&[...document.querySelectorAll('[data-bd]')].map(b=>b.dataset.bd).join()==='off,gross,net'"))
    # --- 1. Banker: Ann banks first; the game allows $1–$100 in $5 steps, starting at $5–$20; the bank to the winner
    await A.click('[data-game="banker"]'); await A.wait_for_selector('#sgMin')
    txt=await A.evaluate("()=>document.body.innerText")
    check('banker set-up: the allowable range, the step, the starting range, the bank rule, the tee order, the preview of the bets',all(x in txt for x in ['Allowable range','smallest bet the game allows','Bets move in steps of','The range to start with','The hole\'s winner takes it','Rotates with the tee order','Tee order','$5 · $10 · $15 · $20','biggest swing','$300']),txt[:300])
    await A.click('[data-me="p2"]'); await A.click('#sgStart'); await A.wait_for_function("()=>!!side&&side.game==='banker'&&tab==='score'")
    row=fdb._rows('golf_side')[0]
    check('the banker is on: $1–$100 in $5 steps starting $5–$20, the bank to the winner, the order, Bo set it, no birdie bonus',row['data']['stakes']=={'min':1,'max':100,'step':5,'start':{'min':5,'max':20}} and row['data']['bank']=='winner' and row['data']['order']==['p1','p2','p3','p4'] and row['data']['setBy']=='p2' and row['data']['birdies']=='off',json.dumps(row['data']))
    st=await A.evaluate("()=>document.querySelector('.sgbar').innerText")
    check('hole 1: Ann banks (first up) and is asked to name the range, $5–$20 carried until she does; the bets sit at $5; the tab reads Banker','BANKER · HOLE 1' in st and 'Banker: Ann' in st and 'ANN NAMES THE RANGE FOR HOLE 1' in st and 'carrying $5–$20' in st and st.count('$5')>=3 and 'Double' not in st and await A.evaluate("()=>document.getElementById('tabSide').textContent==='Banker'&&document.getElementById('sgRMin').value==='5'&&document.getElementById('sgRMax').value==='20'"),st)
    await A.fill('#sgRMin','10'); await A.fill('#sgRMax','500'); await A.click('#sgRangeSet'); await A.wait_for_timeout(300)
    check('a range outside the allowable one is refused',await A.evaluate("()=>!(side.holes&&side.holes[1]&&side.holes[1].range)"))
    await A.fill('#sgRMax','50'); await A.click('#sgRangeSet'); await A.wait_for_function("()=>side.holes&&side.holes[1]&&side.holes[1].range&&side.holes[1].range.max===50")
    st=await A.evaluate("()=>document.querySelector('.sgbar').innerText")
    check('Ann names $10–$50: the range line with change, every bet now at the bottom, $10','THE RANGE $10 to $50' in st and 'named by Bo' in st and st.count('$10')>=3,st)
    # Bo steps up twice ($20), Cy to the top ($50, + disabled), Di stays at $10
    for _ in range(2): await A.click('[data-bet="p2"][data-d="1"]'); await A.wait_for_timeout(150)
    for _ in range(9):
      await A.evaluate("()=>{ const b=document.querySelector('[data-bet=\"p3\"][data-d=\"1\"]'); if(b&&!b.disabled) b.click(); }"); await A.wait_for_timeout(150)
    await A.wait_for_function("()=>side.holes[1].bets&&side.holes[1].bets.p2===20&&side.holes[1].bets.p3===50")
    check('bets step by $5: Bo $20, Cy $50 (the + is disabled at the top), Di unnamed = $10',await A.evaluate("()=>document.querySelector('[data-bet=\"p3\"][data-d=\"1\"]').disabled&&!document.querySelector('[data-bet=\"p3\"][data-d=\"-1\"]').disabled&&document.querySelector('[data-bet=\"p4\"][data-d=\"-1\"]').disabled"))
    # scores: Ann 5, Bo 4 (wins $20), Cy 6 (loses $50), Di 5 (push)
    await A.evaluate("()=>{ setStroke('p1',1,5); setStroke('p2',1,4); setStroke('p3',1,6); setStroke('p4',1,5); renderHole(); }")
    st=await A.evaluate("()=>document.querySelector('.sgbar').innerText")
    check('hole 1 settles one-on-one: Bo +$20, Cy −$50, Di push, the banker +$30; net zero','+$20' in st and '−$50' in st and 'push' in st and 'Banker Ann\n+$30' in st and 'Ann +$30' in st and 'Bo +$20' in st and 'Cy −$50' in st and 'Di $0' in st,st)
    await A.wait_for_function("()=>queue.length===0")
    await A.evaluate("()=>{ holeIdx=1; renderHole(); }")
    st=await A.evaluate("()=>document.querySelector('.sgbar').innerText")
    check('hole 2: Bo won hole 1 outright, so Bo banks (took the bank) and is asked for his range; $10–$50 carries; bets back at $10','Banker: Bo' in st and 'took the bank' in st and 'BO NAMES THE RANGE FOR HOLE 2' in st and 'carrying $10–$50' in st,st)
    # --- 2. phone B joins: same banker, only asked who it is; a tie on hole 2 leaves the bank with Bo
    N=await b.new_context(viewport={'width':390,'height':844}); await cloud(N,fdb,no_session=True)
    B=await N.new_page(); berr=[]; B.on('pageerror',lambda e:berr.append(str(e))); B.on('dialog',lambda d:asyncio.ensure_future(d.accept()))
    await B.goto(page('score.html')+'?e=bank-day'); await B.wait_for_function("()=>!!pub")
    await B.fill('#code','BNK12'); await B.click('#joinBtn'); await B.wait_for_function("()=>!!groupId&&!!side")
    st=await B.evaluate("()=>({strip:document.querySelector('.sgbar').innerText, ask:!!document.getElementById('sgGo'), h:holeIdx})")
    check('phone B: no second set-up — the same banker on hole 2, Bo banks, totals carried, asked who it is',not st['ask'] and st['h']==1 and 'Banker: Bo' in st['strip'] and 'Ann +$30' in st['strip'] and 'Who are you?' in st['strip'],st)
    await B.click('[data-iam="p3"]'); await B.wait_for_function("()=>ME==='p3'")
    await B.click('[data-bet="p3"][data-d="1"]'); await B.wait_for_function("()=>side.holes[2]&&side.holes[2].bets&&side.holes[2].bets.p3===15")
    await B.evaluate("()=>{ ['p1','p2','p3','p4'].forEach(id=>setStroke(id,2,4)); renderHole(); }")
    st=await B.evaluate("()=>document.querySelector('.sgbar').innerText")
    check('hole 2 all square: three pushes, the banker $0',st.count('push')==3 and 'Banker Bo\n$0' in st,st)
    await B.wait_for_function("()=>queue.length===0")
    await B.evaluate("()=>{ holeIdx=2; renderHole(); }")
    st=await B.evaluate("()=>document.querySelector('.sgbar').innerText")
    check('hole 3: a tie leaves the bank with Bo','Banker: Bo' in st and 'took the bank' in st,st)
    await B.click('#sgBankChg'); await B.wait_for_selector('[data-bank="p4"]'); await B.click('[data-bank="p4"]'); await B.wait_for_function("()=>side.holes[3]&&side.holes[3].banker==='p4'")
    st=await B.evaluate("()=>document.querySelector('.sgbar').innerText")
    check('the banker can be chosen by hand','Banker: Di' in st and '(chosen)' in st,st)
    # hole 3: Ann and Bo both beat Di with the same score → the bank is tied on hole 4; the cart draws for it, as for Big Lou
    await B.evaluate("()=>{ setStroke('p1',3,4); setStroke('p2',3,4); setStroke('p3',3,6); setStroke('p4',3,5); renderHole(); }")
    await B.wait_for_function("()=>queue.length===0")
    await B.evaluate("()=>{ holeIdx=3; renderHole(); }")
    st=await B.evaluate("()=>document.querySelector('.sgbar').innerText")
    check('hole 4: the bank is tied — Ann & Bo both beat the banker; Draw who banks, or tap a name; no bets until it is settled','The bank is tied' in st and 'Ann & Bo' in st and 'Draw who banks' in st and not await B.evaluate("()=>!!document.querySelector('[data-bet]')") and await B.evaluate("()=>!!document.querySelector('[data-bankpick=\"p1\"]')&&!!document.querySelector('[data-bankpick=\"p2\"]')&&!document.querySelector('[data-bankpick=\"p3\"]')"),st)
    await B.click('#sgBankDraw'); await B.wait_for_function("()=>side.holes[4]&&side.holes[4].banker&&side.holes[4].draw",timeout=8000)
    st=await B.evaluate("()=>({strip:document.querySelector('.sgbar').innerText, banker:side.holes[4].banker, from:side.holes[4].draw.from})")
    check('drawn: one of the two banks hole 4, marked drawn from Ann & Bo, saved for every phone',st['banker'] in ('p1','p2') and st['from']==['p1','p2'] and 'drawn from Ann & Bo' in st['strip'] and 'NAMES THE RANGE FOR HOLE 4' in st['strip'],st)
    await A.evaluate("async()=>{ await loadSide(); await loadScores(); holeIdx=3; renderHole(); }")
    check('phone A lands on the same banker',await A.evaluate("()=>side.holes[4].banker")==st['banker'])
    await B.click('#sgTab'); await B.wait_for_selector('#sgEdit')
    txt=await B.evaluate("()=>document.body.innerText")
    check('banker ledger: the range rule, per player and per hole with the range (carried) marked',all(x in txt for x in ['Banker','names the range on every tee, inside $1 to $100, bets in $5 steps','Ann Able','+$30','Bo Baker','+$20','Cy Cole','−$50','$10–$50','(carried)','Bo $20','Cy $50','(drawn)','3 of 18 holes settled']),txt[:400])
    sd=fdb._rows('golf_side')[0]['data']; sc={'p1':{1:5,2:4},'p2':{1:4,2:4},'p3':{1:6,2:4},'p4':{1:5,2:4}}
    r=await hub.evaluate("""()=>{ const sd=%s; SIDE['ev1']={sig:'x',rows:[{group_id:'g1',data:sd}]}; golfScores['ev1']=%s; const d=document.createElement('div'); d.innerHTML=sideGamesCard(window.EV); return d.innerText; }"""%(json.dumps(sd),json.dumps(sc)))
    check('hub card: Banker, the range line, the money per player',all(x in r for x in ['Group BNK12 · Banker','names the range on every tee inside $1–$100','Ann Able','+$30','Cy Cole','−$50','2 of 18 holes settled']),r)
    # --- 3. Flip, gross birdies double: heads v tails from the coins on the tee
    await B.click('#sgEdit'); await B.wait_for_selector('[data-game="flip"]'); await B.click('[data-game="flip"]'); await B.wait_for_selector('#sgStake')
    txt=await B.evaluate("()=>document.body.innerText")
    check('flip set-up: the money per hole, the preview per split and for all the same coin',all(x in txt for x in ['Flip','each player on the larger side','1 v 3','the one $15','2 v 2','All the same coin','low ball takes $5 from each','one tie, all tie']),txt[:400])
    await B.click('[data-bd="gross"]'); await B.click('#sgStart'); await B.wait_for_function("()=>!!side&&side.game==='flip'&&tab==='score'")
    row=fdb._rows('golf_side')[0]['data']
    check('the flip is on: $5 a hole, gross birdies double, the banker\'s holes gone',row['stakes']=={'hole':5} and row['birdies']=='gross' and row['holes']=={},json.dumps(row))
    await B.evaluate("()=>{ holeIdx=4; renderHole(); }")
    st=await B.evaluate("()=>document.querySelector('.sgbar').innerText")
    check('hole 5: a Heads / Tails call per player, nothing settled yet; the tab reads Flip','FLIP · HOLE 5' in st and st.count('Heads')>=4 and st.count('Tails')>=4 and '0 of 4 coins called' in st and await B.evaluate("()=>document.getElementById('tabSide').textContent==='Flip'"),st)
    for pid,cn in [('p1','H'),('p2','H'),('p3','T'),('p4','T')]:
      await B.click(f'[data-coin="{pid}"][data-c="{cn}"]'); await B.wait_for_function(f"()=>side.holes[5]&&side.holes[5].flip&&side.holes[5].flip.{pid}==='{cn}'")
    st=await B.evaluate("()=>document.querySelector('.sgbar').innerText")
    check('all four coins called: Heads Ann & Bo v Tails Cy & Di, waiting for the scores','Heads Ann & Bo' in st and 'Tails Cy & Di' in st and 'waiting for the scores' in st,st)
    par5=pars[4]
    await B.evaluate("(p)=>{ setStroke('p1',5,p-1); setStroke('p2',5,p); setStroke('p3',5,p); setStroke('p4',5,p+1); renderHole(); }",par5)
    st=await B.evaluate("()=>document.querySelector('.sgbar').innerText")
    check('hole 5: Ann\'s gross birdie wins it for heads and doubles the hole: +$10 each, −$10 each','Heads win' in st and 'birdie ×2' in st and '+$10 each' in st and 'Ann +$10' in st and 'Cy −$10' in st,st)
    await B.wait_for_function("()=>queue.length===0")
    # hole 6: a lone tail against three heads; the one wins without a birdie → $15
    await B.evaluate("()=>{ holeIdx=5; renderHole(); }")
    for pid,cn in [('p1','H'),('p2','H'),('p3','H'),('p4','T')]:
      await B.click(f'[data-coin="{pid}"][data-c="{cn}"]'); await B.wait_for_function(f"()=>side.holes[6]&&side.holes[6].flip&&side.holes[6].flip.{pid}==='{cn}'")
    par6=pars[5]
    await B.evaluate("(p)=>{ setStroke('p1',6,p+1); setStroke('p2',6,p+1); setStroke('p3',6,p+2); setStroke('p4',6,p); renderHole(); }",par6)
    st=await B.evaluate("()=>document.querySelector('.sgbar').innerText")
    check('hole 6: one against three, the one wins: +$15, −$5 each','Tails win' in st and '+$15' in st and 'Di +$5' in st and 'Ann +$5' in st and 'Cy −$15' in st,st)
    await B.wait_for_function("()=>queue.length===0")
    # hole 7: all heads, Cy low with a birdie → $30; then a tie for low on hole 8 → one tie, all tie
    await B.evaluate("()=>{ holeIdx=6; renderHole(); }")
    for pid in ['p1','p2','p3','p4']:
      await B.click(f'[data-coin="{pid}"][data-c="H"]'); await B.wait_for_function(f"()=>side.holes[7]&&side.holes[7].flip&&side.holes[7].flip.{pid}==='H'")
    par7=pars[6]
    await B.evaluate("(p)=>{ setStroke('p1',7,p); setStroke('p2',7,p); setStroke('p3',7,p-1); setStroke('p4',7,p); renderHole(); }",par7)
    st=await B.evaluate("()=>document.querySelector('.sgbar').innerText")
    check('hole 7: all heads — everyone for themselves, Cy low with a birdie: +$30, −$10 each','All heads' in st and 'Cy low' in st and 'birdie ×2' in st and '+$30' in st and 'Cy +$15' in st and 'Ann −$5' in st,st)
    await B.wait_for_function("()=>queue.length===0")
    await B.evaluate("()=>{ holeIdx=7; renderHole(); }")
    for pid in ['p1','p2','p3','p4']:
      await B.click(f'[data-coin="{pid}"][data-c="T"]'); await B.wait_for_function(f"()=>side.holes[8]&&side.holes[8].flip&&side.holes[8].flip.{pid}==='T'")
    await B.evaluate("()=>{ ['p1','p2','p3','p4'].forEach(id=>setStroke(id,8,4)); renderHole(); }")
    st=await B.evaluate("()=>document.querySelector('.sgbar').innerText")
    check('hole 8: all tails, all square — one tie, all tie','One tie, all tie' in st,st)
    await B.wait_for_function("()=>queue.length===0")
    m=await B.evaluate("()=>{ const L=sideLedger(pub,group(),scores,side); return {sum:Object.values(L.net).reduce((a,b)=>a+b,0), played:L.played}; }")
    check('the flip nets to zero over the round',abs(m['sum'])<0.005 and m['played']==4,m)
    await B.click('#sgTab'); await B.wait_for_selector('#sgEdit')
    txt=await B.evaluate("()=>document.body.innerText")
    check('flip ledger: the rule line with gross birdies, per hole heads v tails and the result',all(x in txt for x in ['Flip','$5 a player on the larger side','gross birdies double','H Ann & Bo v T Cy & Di','Heads win','all heads','Cy low','one tie, all tie','4 of 18 holes settled']),txt[:500])
    sd=fdb._rows('golf_side')[0]['data']
    r=await hub.evaluate("""()=>{ const sd=%s; SIDE['ev1']={sig:'f',rows:[{group_id:'g1',data:sd}]}; golfScores['ev1']={p1:{5:%d},p2:{5:%d},p3:{5:%d},p4:{5:%d}}; const d=document.createElement('div'); d.innerHTML=sideGamesCard(window.EV); return d.innerText; }"""%(json.dumps(sd),par5-1,par5,par5,par5+1))
    check('hub card: Flip, the rule line, the birdie switch, the money',all(x in r for x in ['Group BNK12 · Flip','heads v tails for $5','gross birdies double','+$10','−$10','1 of 18 holes settled']),r)
    # --- 4. the round robin: partners drawn, no pairing twice running, every pairing once (6) / twice (3)
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
    check('the robin is on: 3-hole, $2, best ball + low total, the pairs saved, the flip\'s holes gone',row['seg']==3 and row['stakes']=={'hole':2} and row['points']=='both' and len(row['pairs'])==6 and row['holes']=={} and row['drawnBy']=='p3',json.dumps({k:v for k,v in row.items() if k!='pairs'}))
    await B.evaluate("()=>{ holeIdx=2; renderHole(); }")
    st=await B.evaluate("()=>({strip:document.querySelector('.sgbar').innerText, tab:document.getElementById('tabSide').textContent})")
    pr=row['pairs'][0]; names={'p1':'Ann','p2':'Bo','p3':'Cy','p4':'Di'}
    check('hole 3 (holes 1–3): the first pairing on the strip, new partners on 4, the tab reads Round robin','ROUND ROBIN · HOLE 3 · HOLES 1–3' in st['strip'] and ' & '.join(names[x] for x in pr[0]) in st['strip'] and 'new partners on 4' in st['strip'] and st['tab']=='Round robin',st)
    a,bb=pr[0]; c,d=pr[1]
    await B.evaluate("(x)=>{ setStroke(x.a,3,3); setStroke(x.b,3,5); setStroke(x.c,3,4); setStroke(x.d,3,5); renderHole(); }",{'a':a,'b':bb,'c':c,'d':d})
    st=await B.evaluate("()=>document.querySelector('.sgbar').innerText")
    m=await B.evaluate("()=>{ const L=sideLedger(pub,group(),scores,side); const x=L.holes.find(y=>y.h===3); return {money:x.money, sum:Object.values(L.net).reduce((a,b)=>a+b,0)}; }")
    check('hole 3: best ball 3 v 4 and total 8 v 9 to the first pair: +$4 each, −$4 each, net zero','Best ball 3 v 4' in st and 'total 8 v 9' in st and '+$4 each' in st and m['money'][a]==4 and m['money'][bb]==4 and m['money'][c]==-4 and m['money'][d]==-4 and abs(m['sum'])<0.005,(st,m))
    await B.wait_for_function("()=>queue.length===0")
    pr2=row['pairs'][1]; a2,b2=pr2[0]; c2,d2=pr2[1]
    await B.evaluate("(x)=>{ holeIdx=3; setStroke(x.a,4,3); setStroke(x.b,4,7); setStroke(x.c,4,4); setStroke(x.d,4,4); renderHole(); }",{'a':a2,'b':b2,'c':c2,'d':d2})
    st=await B.evaluate("()=>document.querySelector('.sgbar').innerText")
    check('hole 4: new partners; the ball one way (3 v 4), the total the other (10 v 8) — a push','HOLES 4–6' in st and ' & '.join(names[x] for x in pr2[0]) in st and 'Best ball 3 v 4' in st and 'total 10 v 8' in st and 'Push' in st,st)
    await B.wait_for_function("()=>queue.length===0")
    await B.click('#sgTab'); await B.wait_for_selector('#sgEdit')
    txt=await B.evaluate("()=>document.body.innerText")
    check('robin ledger: the stakes line, per player, per hole with partners and results',all(x in txt for x in ['Round robin','$2 a hole on the best ball and $2 on the low total','partners switch every 3 holes','+$4 each','push','8 of 18 holes settled']),txt[:400])
    # --- 5. each robin a match: holes are points, the money moves once at the end of the stretch
    await B.click('#sgEdit'); await B.wait_for_selector('[data-pay="match"]'); await B.click('[data-pay="match"]')
    check('the stake label follows the mode',await B.evaluate("()=>document.getElementById('sgStakeLbl').textContent==='What a robin is worth'"))
    await B.click('#sgStart'); await B.wait_for_function("()=>!!side&&side.pay==='match'&&tab==='score'")
    m=await B.evaluate("()=>{ const L=sideLedger(pub,group(),scores,side); const hs=L.holes.slice(0,3); const t=hs[2].match; return {money:hs.map(x=>Object.keys(x.money).length), tally:t.tally, done:t.done, result:t.result, last:t.last, sum:Object.values(L.net).reduce((a,b)=>a+b,0), pay:hs[2].pairs&&t.result!=='push'?hs[2].money[hs[2].pairs[t.result][0]]:null}; }")
    check('holes 1–3 are one match: no money on 1 and 2, the tally decides it on 3, $2 each to the pair ahead, net zero',m['money'][:2]==[0,0] and m['done'] and m['last'] and (m['result']=='push' and m['money'][2]==0 or m['pay']==2) and abs(m['sum'])<0.005,m)
    await B.evaluate("()=>{ holeIdx=2; renderHole(); }")
    st=await B.evaluate("()=>document.querySelector('.sgbar').innerText")
    check('the strip shows the match: the score and who wins it, or halved','The match' in st and ('win' in st and '+$2 each' in st or 'Halved' in st) and 'take the hole' in st or 'Push' in st,st)
    await B.click('#sgTab'); await B.wait_for_selector('#sgEdit')
    txt=await B.evaluate("()=>document.body.innerText")
    check('match-mode ledger: the rule line and the match line on the last hole of the stretch','each 3-hole robin a match for $2' in txt and 'match ' in txt and ('–' in txt),txt[:300])
    await A.evaluate("async()=>{ await loadSide(); await loadScores(); render(); }")
    st=await A.evaluate("()=>({game:side.game, tab:document.getElementById('tabSide').textContent})")
    check('phone A picks up the switch to the round robin',st['game']=='robin' and st['tab']=='Round robin',st)
    sd=fdb._rows('golf_side')[0]['data']
    r=await hub.evaluate("""()=>{ const sd=%s; SIDE['ev1']={sig:'y',rows:[{group_id:'g1',data:sd}]}; golfScores['ev1']=%s; const d=document.createElement('div'); d.innerHTML=sideGamesCard(window.EV); return d.innerText; }"""%(json.dumps(sd),json.dumps({a:{3:3},bb:{3:5},c:{3:4},d:{3:5}})))
    check('hub card: Round robin as a match, the stakes line',all(x in r for x in ['Group BNK12 · Round robin','each 3-hole robin a match for $2','switched every 3 holes','1 of 18 holes settled']),r)
    check('no script errors (hub / phones)',not errs and not aerr and not berr,json.dumps(errs+aerr+berr))
    await b.close()
  print('ALL OK' if not bad else f'{bad} FAILED'); sys.exit(1 if bad else 0)
asyncio.run(main())
