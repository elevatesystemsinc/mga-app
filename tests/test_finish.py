"""The Finish tab: a small group's game wrapped up by the players on the scoring page, against the fake database.
Run: python3 tests/test_finish.py
One phone closes scoring, calls out the skins, draws the partners and records the payouts; a second phone can no
longer score, sees every step done and gets 'conflict' if it tries a step again; the hub then takes the wrap into the
game (final event, teams, called-out skins, payouts) and Reopen scoring clears it."""
import asyncio,sys,json,copy
from playwright.async_api import async_playwright
from _harness import FakeDB,cloud,local,page
PAR=[5,4,5,3,4,3,4,4,4, 4,3,5,4,3,4,4,4,4]   # Oak, men
def card(changes):
    s=PAR[:]
    for h,v in changes.items(): s[h-1]=v
    return s
SCORES={'gp_p0':card({2:3,7:3}),'gp_p1':card({12:4,13:5}),'gp_p2':card({17:3}),'gp_p3':card({5:3})}
async def main():
  bad=0
  def check(name,cond,info=''):
    nonlocal bad; print(('OK   ' if cond else 'FAIL ')+name,info); bad+=(not cond)
  fdb=FakeDB()
  async with async_playwright() as p:
    b=await p.chromium.launch()
    # --- the hub in local mode builds the group, the game (three competitions) and its event, so every shape is the real one
    L=await b.new_context(); hub=await L.new_page(); errs=[]; hub.on('pageerror',lambda e:errs.append(str(e))); await local(hub)
    await hub.goto(page('index.html')+'?org=club'); await hub.wait_for_function("()=>typeof publicEvent==='function'&&!!db")
    await hub.evaluate("()=>{ CLUB.orgs.push({id:'misfits',kind:'group',name:'The Misfits',short:'Misfits'}); ['Ann Able 4.1','Bo Baker 12.0','Cy Cole 20.3','Di Dunn 8.8'].forEach((x,i)=>{ const [f,l,h]=x.split(' '); CLUB.members.push({id:'p'+i,first:f,last:l,hcp:h,status:'Active'}); }); persist(); }")
    await hub.goto(page('index.html')+'?org=misfits'); await hub.wait_for_function("()=>typeof publicEvent==='function'&&!!db&&db.id==='misfits'")
    built=await hub.evaluate("""()=>{ ['p0','p1','p2','p3'].forEach(id=>db.memberships.push({id,status:'Active',joined:'',notes:''})); persist(); go('games'); designGame(null); const d=GD.draft; d.name='Thursday game'; d.date=new Date().toISOString().slice(0,10); d.pots[0].entry=20; d.pots[0].rules.scoring='net';
      const sk=newPot('skins',d,{entry:5}); sk.rules.skins={net:true,grossBeatsNet:true,validate:'netpar',mode:'pot',live:false}; d.pots.push(sk);
      const bd=newPot('blinddraw',null,{entry:10}); d.pots.push(bd); render(); document.getElementById('gdSave').click();
      const g=GAME(); ['p0','p1','p2','p3'].forEach(id=>{ const p=addPlayer(g,{memberId:id}); p.id='gp_'+id; p.paid=true; }); g.pots.forEach(pot=>{ g.players.forEach(p=>{ pot.inn[p.id]=true; }); });
      openScoring(g); const ev=gameEvent(g); g.players.forEach(p=>{ const q=evPlayers(ev).find(x=>x.p.id===p.gpid); q.p.id=p.id; p.gpid=p.id; });   // event player ids = game player ids, for readable scores
      ev.groups=[{id:'g1',code:'ABC12',label:'Group 1',course:'oak',startHole:1,teeTime:'',players:evPlayers(ev).map(x=>x.p).slice(0,2)},{id:'g2',code:'DEF34',label:'Group 2',course:'oak',startHole:1,teeTime:'',players:evPlayers(ev).map(x=>x.p).slice(2)}]; ev.pool=[];
      persist(); const pub=publicEvent(ev); return {pub, slug:ev.slug, evId:ev.id, gameId:g.id, pots:g.pots.map(p=>[p.id,p.kind,p.name,potTotal(g,p)]), docs:{club:JSON.parse(JSON.stringify(CLUB)), misfits:JSON.parse(JSON.stringify(db))}}; }""")
    pub=built['pub']; comps=pub['comps']
    check('event carries the three competitions, the quiet skins flagged, money per competition',[c['kind'] for c in comps]==['format','skins','format'] and comps[1]['live'] is False and comps[0]['live'] is True and [c['total'] for c in comps]==[80,20,40] and pub['game']['settle']=='pot',json.dumps([(c['name'],c['live'],c['total'],c.get('teamsBy')) for c in comps]))
    for k in ('club','misfits'): d=built['docs'][k]; d['_rev']=1; fdb.seed('mga_hub',k,d)
    fdb._rows('golf_events').append({'id':built['evId'],'slug':built['slug'],'public':copy.deepcopy(pub),'codes':{'ABC12':'g1','DEF34':'g2'}})
    for pid,strokes in SCORES.items():
        for h,s in enumerate(strokes,1): fdb._rows('golf_scores').append({'event_id':built['evId'],'player_id':pid,'hole':h,'strokes':s})
    # --- two phones, one per group
    async def phone(codeTxt):   # each phone its own context (its own localStorage: the remembered group ID)
        P=await b.new_context(viewport={'width':390,'height':800},is_mobile=True,has_touch=True); await cloud(P,fdb,no_session=True)
        pg=await P.new_page(); e=[]; pg.on('pageerror',lambda x:e.append(str(x))); pg.on('dialog',lambda d:asyncio.ensure_future(d.accept()))
        await pg.goto(page('score.html')+'?e='+built['slug']); await pg.wait_for_function("()=>!!pub&&!!document.getElementById('code')")
        await pg.fill('#code',codeTxt); await pg.click('#joinBtn'); await pg.wait_for_function("()=>!!groupId&&tab==='score'"); return pg,e
    A,ea=await phone('ABC12'); B,eb=await phone('DEF34')
    r=await A.evaluate("()=>{ const f=document.getElementById('tabFinish'); return {shown:!f.hidden, chips:[...document.querySelectorAll('[data-comp]')].map(x=>x.textContent)}; }")
    check('Finish tab offered for a game; the quiet skins stay off the board chips',r['shown'] and 'Skins' not in r['chips'],json.dumps(r))
    await A.evaluate("()=>{ tab='finish'; return loadScores().then(render); }"); await A.wait_for_function("()=>!!document.getElementById('wfClose')")
    r=await A.evaluate("()=>{ const S=wrapSteps().steps; return {steps:S.map(s=>[s.k,s.state]), cards:document.querySelector('.wstep.now .ln').textContent}; }")
    check('steps in order, close scoring first, every card complete',r['steps']==[['close','now'],['skins','later'],['draw','later'],['winners','later'],['money','later']] and '4 of 4' in r['cards'],json.dumps(r))
    # 1. close scoring
    await A.click('#wfClose'); await A.wait_for_function("()=>wrap&&wrap.closedAt&&!!document.getElementById('wfCall')")
    row=next(x for x in fdb._rows('golf_events') if x['id']==built['evId'])
    check('closed: wrap says who and when, the event is final',row['wrap']['closedBy']=='ABC12' and row['public']['status']=='final' and row['wrap']['v']==1,json.dumps(row['wrap']))
    await B.evaluate("()=>{ const g=group(); setStroke(g.players[0].id,1,6); }"); await B.wait_for_function("()=>queue.length===0&&pub.status==='final'",timeout=5000)
    r=await B.evaluate("()=>({status:pub.status, queued:queue.length, banner:!!document.querySelector('.banner')})")
    srv=[x for x in fdb._rows('golf_scores') if x['player_id']=='gp_p2' and x['hole']==1]
    check('the other phone can no longer score',r['status']=='final' and r['queued']==0 and srv[0]['strokes']==PAR[0],json.dumps(r))
    # 2. the skins call-out, hole by hole
    await A.click('#wfCall'); await A.wait_for_selector('.ov')
    r=await A.evaluate("""async()=>{ let taps=0, flashes=0, verdictEarly=false; while(taps<60){ const go=document.getElementById('ovGo'); if(!go) break; if(go.textContent==='Done'){ go.click(); break; }
        if(document.querySelector('.flash')) flashes++;
        else { const lines=[...document.querySelectorAll('.skl')]; if(lines.some(l=>/validated on/.test(l.textContent)&&l.classList.contains('won')&&!document.querySelector('.flash'))) { /* fine: shown after its flash */ } }
        const r=go.getBoundingClientRect(); if(r.bottom>innerHeight||r.top<0) return {offscreen:true,taps}; go.click(); taps++; await new Promise(r=>setTimeout(r,20)); }
      await new Promise(r=>setTimeout(r,300)); return {taps, flashes, overlay:!!document.querySelector('.ov'), called:!!(wrap.callouts&&Object.keys(wrap.callouts).length), skinsDone:wrapSteps().steps.find(s=>s.k==='skins').state}; }""")
    check('call-out: 18 holes with the validation flashes, button always on screen, recorded at the end',not r.get('offscreen') and r['taps']>=18 and r['flashes']>=1 and not r['overlay'] and r['called'] and r['skinsDone']=='done',json.dumps(r))
    # 3. the draw (A-B by handicap), saved before the reveal
    await A.wait_for_function("()=>!!document.getElementById('wfDraw')"); await A.select_option('#wfMethod','abcd'); await A.click('#wfDraw')
    await A.wait_for_function("()=>wrap&&wrap.draws&&Object.keys(wrap.draws).length===1",timeout=5000)
    savedFirst=await A.evaluate("()=>!!document.querySelector('.ov')")
    await A.wait_for_function("()=>{ const g=document.getElementById('ovGo'); return g&&!g.hidden; }",timeout=40000); await A.click('#ovGo')
    d=list(row['wrap']['draws'].values())[0]
    teams={}
    for pid,t in d['teams'].items(): teams.setdefault(t,[]).append(pid)
    check('draw recorded: two teams of two, one low and one high handicap each',savedFirst and d['method']=='abcd' and sorted(len(v) for v in teams.values())==[2,2] and all(len({x in ('gp_p0','gp_p3') for x in v})==2 for v in teams.values()) and d['by']=='ABC12',json.dumps(d))
    # 4. the winners and the money
    await A.wait_for_function("()=>!!document.getElementById('wfPay')")
    r=await A.evaluate("()=>{ const lines=[...document.querySelectorAll('.wstep.now .ln')].map(l=>l.textContent.trim()); return {lines, total:document.querySelector('.wstep.now .ln.tot .amt').textContent}; }")
    check('winners shown per competition with amounts',any('1st' in l for l in r['lines']) and any('skin' in l for l in r['lines']) and r['total'].startswith('$'),json.dumps(r))
    await A.click('#wfPay'); await A.wait_for_function("()=>wrap&&wrap.payouts")
    W=row['wrap']['payouts']; tot=sum(x['total'] for x in W['comps'].values()); byPid={}
    for c in W['comps'].values():
        for x in c['rows']: byPid[x['pid']]=byPid.get(x['pid'],0)+x['amount']
    check('payouts recorded for all three competitions, cent-exact, the whole pot paid',set(W['comps'])=={c['id'] for c in comps} and abs(tot-140)<0.005 and abs(sum(byPid.values())-140)<0.005 and W['by']=='ABC12',json.dumps({k:(v['kind'],v['total'],len(v['rows'])) for k,v in W['comps'].items()}))
    r=await A.evaluate("()=>{ const M=wrapMoney(pub,wrap.payouts.comps); return {rows:M.rows.map(r=>[r.name,r.inn,r.out,r.net]), inn:M.inn, out:M.out, money:[...document.querySelectorAll('.wstep')].pop().classList.contains('done')}; }")
    check('who’s owed what: in 35 each, out as recorded, nets to zero',all(x[1]==35 for x in r['rows']) and r['inn']==140 and abs(r['out']-140)<0.005 and abs(sum(x[3] for x in r['rows']))<0.005 and r['money'],json.dumps(r))
    # the second phone: sees it all done; a stale step is refused
    r=await B.evaluate("""async()=>{ tab='finish'; await refresh(); const S=wrapSteps().steps.map(s=>[s.k,s.state]); const v=wrap.v; wrap.v=0; const again=await wrapCall('callout',{comp:pub.comps[1].id}); return {S, v, again, back:wrap.v}; }""")
    check('second phone: every step done, a stale step gets conflict and reloads',all(s[1]=='done' for s in r['S']) and r['again']=='conflict' and r['back']==r['v'],json.dumps(r))
    # --- the hub takes the wrap into the game
    H=await b.new_context(); await cloud(H,fdb); h=await H.new_page(); herr=[]; h.on('pageerror',lambda e:herr.append(str(e)))
    await h.goto(page('index.html')+'?org=misfits'); await h.wait_for_function("()=>cloudReady",timeout=15000)
    await h.evaluate("(gid)=>{ view.gameId=gid; go('games'); }",built['gameId']); await h.wait_for_function("()=>GAME()&&GAME().wrapV>=4",timeout=15000)
    r=await h.evaluate("""()=>{ const g=GAME(), ev=gameEvent(g); const sk=g.pots.find(p=>p.kind==='skins'), bd=g.pots.find(p=>p.rules.game==='blinddraw'); const S=settlement(g);
      return {status:ev.status, calledOut:!!sk.calledOut, teams:Object.keys(bd.teams||{}).length, drawBy:bd.draw&&bd.draw.by, pays:g.pots.map(p=>[p.payouts.length,Math.round(p.payouts.reduce((a,x)=>a+x.amount,0)*100)/100]), out:S.out, wrap:g.wrap&&g.wrap.closedBy, text:document.getElementById('main').textContent.includes('from the course by Group ABC12')}; }""")
    check('hub: event final, skins called out, teams from the draw, payouts in the game and the ledger',r['status']=='final' and r['calledOut'] and r['teams']==4 and r['drawBy']=='ABC12' and abs(r['out']-140)<0.005 and r['wrap']=='ABC12' and r['text'],json.dumps(r))
    hubPays={}
    for pot,c in zip(built['pots'],[W['comps'][c['id']] for c in comps]): pass
    r2=await h.evaluate("""()=>{ const g=GAME(); const m={}; g.pots.forEach(p=>p.payouts.forEach(x=>{ m[x.pid]=(m[x.pid]||0)+x.amount; })); return m; }""")
    check('the same money per player as the phones recorded',all(abs(r2.get(k,0)-v)<0.005 for k,v in byPid.items()) and len(r2)==len(byPid),json.dumps([r2,byPid]))
    r=await h.evaluate("""async()=>{ openScoring(GAME()); await new Promise(r=>setTimeout(r,300)); return {status:gameEvent(GAME()).status, wrapV:GAME().wrapV}; }""")
    check('reopen scoring clears the wrap',r['status']=='live' and r['wrapV'] is None and row.get('wrap') is None,json.dumps([r,row.get('wrap')]))
    check('no script errors',not errs and not ea and not eb and not herr,json.dumps(errs+ea+eb+herr))
    await b.close()
  print('ALL OK' if not bad else f'{bad} FAILED'); sys.exit(1 if bad else 0)
asyncio.run(main())
