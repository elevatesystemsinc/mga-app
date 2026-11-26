"""Handicap allowances per day and per competition (the owner, Nov 25, 2026: "a handicap allowance for that particular day… an
exception… the particular game within the day"): a game at 90% with its skins at 85% — the event carries the day's figure, the skins
competition its own, the hub's standings and the phones' boards give the same playing handicaps, and a game that sets neither reads
exactly as before (100%, no competition allowance). Run: python3 tests/test_allow.py"""
import asyncio,sys,json,copy
from playwright.async_api import async_playwright
from _harness import FakeDB,cloud,local,page
async def main():
  bad=0
  def check(name,cond,info=''):
    nonlocal bad; print(('OK   ' if cond else 'FAIL ')+name,info); bad+=(not cond)
  fdb=FakeDB()
  async with async_playwright() as p:
    b=await p.chromium.launch()
    L=await b.new_context(); hub=await L.new_page(); errs=[]; hub.on('pageerror',lambda e:errs.append(str(e))); await local(hub)
    await hub.goto(page('index.html')+'?org=club'); await hub.wait_for_function("()=>typeof publicEvent==='function'&&!!db")
    await hub.evaluate("()=>{ CLUB.orgs.push({id:'misfits',kind:'group',name:'The Misfits',short:'Misfits'}); ['Ann Able 4.1','Bo Baker 12.0','Cy Cole 20.3','Di Dunn 8.8'].forEach((x,i)=>{ const [f,l,h]=x.split(' '); CLUB.members.push({id:'p'+i,first:f,last:l,hcp:h,status:'Active'}); }); persist(); }")
    await hub.goto(page('index.html')+'?org=misfits'); await hub.wait_for_function("()=>typeof publicEvent==='function'&&!!db&&db.id==='misfits'")
    # 1. a game that sets nothing: 100% on the event, no allowance on any competition (today's games are untouched)
    r=await hub.evaluate("""()=>{ ['p0','p1','p2','p3'].forEach(id=>db.memberships.push({id,status:'Active',joined:'',notes:''})); persist(); go('games'); designGame(null); const d=GD.draft; d.name='Plain'; d.date=new Date().toISOString().slice(0,10); d.pots[0].rules.scoring='net';
      const sk=newPot('skins',d,{entry:5}); sk.rules.skins={net:true,grossBeatsNet:true,validate:'netpar',mode:'pot',live:true}; d.pots.push(sk); render();
      const dayBox=document.getElementById('gdAllow').value, exBox=document.getElementById('gdAl_'+sk.id).value, ph=document.getElementById('gdAl_'+sk.id).placeholder; document.getElementById('gdSave').click();
      const g=GAME(); ['p0','p1'].forEach(id=>{ const p=addPlayer(g,{memberId:id}); }); g.pots.forEach(pot=>g.players.forEach(p=>{ pot.inn[p.id]=true; })); openScoring(g); const ev=gameEvent(g); const pub=publicEvent(ev);
      return {dayBox, exBox, ph, allowPct:g.allowPct, allow:pub.allow, comps:pub.comps.map(c=>[c.kind,c.allow===undefined?null:c.allow]), skinsAllow:g.pots[1].rules.allow===undefined}; }""")
    check('a game that sets nothing: boxes blank (placeholder 100), 100% across the board, no competition allowance',r['dayBox']=='' and r['exBox']=='' and r['ph']=='100' and r['allowPct'] is None and r['allow']=={'*':100} and r['comps']==[['format',None],['skins',None]] and r['skinsAllow'],json.dumps(r))
    # 2. the day at 90%, the skins at 85% — through the designer's boxes
    built=await hub.evaluate("""()=>{ go('games'); designGame(null); const d=GD.draft; d.name='Ninety'; d.date=new Date().toISOString().slice(0,10); d.pots[0].entry=20; d.pots[0].rules.scoring='net';
      const sk=newPot('skins',d,{entry:5}); sk.rules.skins={net:true,grossBeatsNet:true,validate:'netpar',mode:'pot',live:true}; d.pots.push(sk); render();
      document.getElementById('gdAllow').value='90'; document.getElementById('gdAl_'+sk.id).value='85'; document.getElementById('gdSave').click();
      const g=GAME(); ['p0','p1','p2','p3'].forEach(id=>{ const p=addPlayer(g,{memberId:id}); p.id='gp_'+id; }); g.pots.forEach(pot=>g.players.forEach(p=>{ pot.inn[p.id]=true; }));
      openScoring(g); const ev=gameEvent(g); g.players.forEach(p=>{ const q=evPlayers(ev).find(x=>x.p.id===p.gpid); q.p.id=p.id; p.gpid=p.id; });
      ev.groups=[{id:'g1',code:'ABC12',label:'Group 1',course:'oak',startHole:1,teeTime:'',players:evPlayers(ev).map(x=>x.p)}]; ev.pool=[]; persist();
      const pub=publicEvent(ev); const SK=g.pots.find(x=>x.kind==='skins'&&x.rules.allow!=null)||sk; const sp=potPub(g,g.pots[0]), skp=potPub(g,SK); const cy=pub.groups[0].players.find(p=>p.name.startsWith('Cy'));
      const ph=(P,p)=>segPH(P,p,playerFormatOf(P)); const cyS=sp.groups[0].players.find(p=>p.id===cy.id), cySk=skp.groups[0].players.find(p=>p.id===cy.id);
      designGame(g); render(); const again={day:document.getElementById('gdAllow').value, ex:document.getElementById('gdAl_'+SK.id).value, ph:document.getElementById('gdAl_'+g.pots[0].id).placeholder}; closeDrawer&&0; GD=null; view.gdesign=null; render();
      return {pub, slug:ev.slug, evId:ev.id, allowPct:g.allowPct, skinsAllow:SK.rules.allow, allow:pub.allow, comps:pub.comps.filter(c=>c.id===g.pots[0].id||c.id===SK.id).map(c=>[c.kind,c.allow||null]), ch:cy.ch, phDay:ph(sp,cyS), phSkins:ph(skp,cySk), rules:potRulesText(SK), again, docs:{club:JSON.parse(JSON.stringify(CLUB)), misfits:JSON.parse(JSON.stringify(db))}}; }""")
    ch=built['ch']
    check('the day at 90% and the skins at 85%: saved on the game and the competition, the event carries 90, the skins competition 85, the boxes read back',built['allowPct']==90 and built['skinsAllow']==85 and built['allow']=={'*':90} and built['comps']==[['format',None],['skins',{'*':85}]] and built['again']=={'day':'90','ex':'85','ph':'90'} and '85%' in built['rules'],json.dumps({k:built[k] for k in ('allowPct','skinsAllow','allow','comps','again','rules')}))
    check('Cy’s playing handicap: 90% of his course handicap in the stroke play, 85% in the skins',ch>10 and built['phDay']==round(ch*0.9) and built['phSkins']==round(ch*0.85) and built['phDay']!=built['phSkins'],json.dumps({'ch':ch,'day':built['phDay'],'skins':built['phSkins']}))
    # 3. a phone sees the same figures on the skins board and the stroke-play board
    pub=built['pub']
    for k in ('club','misfits'): d=built['docs'][k]; d['_rev']=1; fdb.seed('mga_hub',k,d)
    fdb._rows('golf_events').append({'id':built['evId'],'slug':built['slug'],'public':copy.deepcopy(pub),'codes':{'ABC12':'g1'}})
    P=await b.new_context(viewport={'width':390,'height':800},is_mobile=True,has_touch=True); await cloud(P,fdb,no_session=True)
    pg=await P.new_page(); e=[]; pg.on('pageerror',lambda x:e.append(str(x)))
    await pg.goto(page('score.html')+'?e='+built['slug']); await pg.wait_for_function("()=>!!pub&&!!document.getElementById('code')")
    await pg.fill('#code','ABC12'); await pg.click('#joinBtn'); await pg.wait_for_function("()=>!!groupId&&tab==='score'")
    r=await pg.evaluate("""()=>{ const cy=pub.groups[0].players.find(p=>p.name.startsWith('Cy')); const out={}; for(const c of pub.comps){ if(c.kind==='skins'&&!c.allow) continue; const cp=compPub(pub,c); const q=cp.groups[0].players.find(p=>p.id===cy.id); out[c.kind]=[cp.allow,segPH(cp,q,playerFormatOf(cp))]; } out.round=[pub.allow,segPH(pub,cy,playerFormatOf(pub))]; return out; }""")
    check('the phone: the stroke play and the round at 90%, the skins at 85%, from the published copy alone',r['format']==[{'*':90},round(ch*0.9)] and r['skins']==[{'*':85},round(ch*0.85)] and r['round']==[{'*':90},round(ch*0.9)],json.dumps(r))
    check('no script errors',not errs and not e,json.dumps(errs+e))
    await b.close()
  print('ALL OK' if not bad else f'{bad} FAILED'); sys.exit(1 if bad else 0)
asyncio.run(main())
