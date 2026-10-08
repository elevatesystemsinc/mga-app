"""Opens every page and every hub screen (club hub + an association) and fails on any script error. Run: python3 tests/smoke.py"""
import asyncio,sys
from playwright.async_api import async_playwright
from _harness import local,page
T1="()=>{ db.tournaments.push(Object.assign({id:'T1',name:'Member-Member',season:Y(),days:3,field:[],sponsors:[],tiers:[],income:[],perPlayer:[],lines:[],dayItems:[[],[],[]],actuals:{},schedule:[],decisions:[]})); persist(); }"
async def main():
  bad=0
  async with async_playwright() as p:
    b=await p.chromium.launch()
    for name,check in [('index.html',"()=>!!document.getElementById('nav')"),('cashier.html',"()=>!!document.getElementById('main')"),('checkin.html',"()=>!!document.getElementById('main')"),('score.html',"()=>document.body.innerText.length>0")]:
      pg=await b.new_page(); errs=[]; pg.on('pageerror',lambda e,errs=errs:errs.append(str(e))); await local(pg)
      await pg.goto(page(name)); await pg.wait_for_timeout(700); ok=await pg.evaluate(check)
      print(f'{name:14} rendered={ok} errors={errs}'); bad+= (not ok) or bool(errs)
    # every hub page and tournament tab renders — in the club hub and in an association
    for org in ['mga','club']:
      pg=await b.new_page(); errs=[]; pg.on('pageerror',lambda e,errs=errs:errs.append(str(e))); await local(pg); await pg.goto(page('index.html')+'?org='+org); await pg.wait_for_timeout(700)
      await pg.evaluate(T1)
      pages=await pg.evaluate("()=>navItems().map(x=>x[0])")
      for v in pages: await pg.evaluate(f"()=>go('{v}')"); await pg.wait_for_timeout(60)
      tabs=await pg.evaluate("()=>{ go('tournament',{tid:'T1'}); return TT.map(x=>x[0]); }")
      for tb in tabs: await pg.evaluate(f"()=>{{ view.ttab='{tb}'; render(); }}"); await pg.wait_for_timeout(60)
      brand=await pg.evaluate("()=>[document.getElementById('brandName').textContent, isClub(), db.id]")
      print(f'{org:5} pages {pages} tabs {len(tabs)} brand {brand} errors {errs}'); bad+=bool(errs)
      if org=='mga':
        # rounds → scoring events from the field → combined results; tab toggles
        r=await pg.evaluate("""async()=>{ const t=db.tournaments.find(x=>x.id==='T1'); t.teamSize=2; t.days=2; t.startDate='2026-10-03';
          ['Ann Able 4.1','Bo Baker 12.0','Cy Cole 20.3','Di Dunn 8.8'].forEach((x,i)=>{ const [f,l,h]=x.split(' '); CLUB.members.push({id:'q'+i,first:f,last:l,hcp:h,status:'Active'}); db.memberships.push({id:'q'+i,status:'Active',joined:'',notes:''}); t.field.push({id:uid(),memberId:'q'+i,team:i<2?1:2,paid:true,skins:false,answers:{}}); });
          t.rounds=defaultRounds(t); t.rounds[0]=Object.assign(t.rounds[0],{format:'split',front:'scramble',back:'shamble',count:1}); createRoundEvents(t);
          const evs=t.rounds.map(roundEvent); for(const ev of evs){ ev.groups=[{id:uid(),code:newCode(ev),label:'Oak 1',course:'oak',startHole:1,teeTime:'',players:ev.pool}]; ev.pool=[]; }
          for(const ev of evs) for(const p of ev.groups[0].players) for(let h=1;h<=18;h++) await setScore(ev,p.id,h,4+(p.team==='T2'&&h%3===0?1:0)+(ev===evs[1]&&p.memberId==='q0'&&h%2===0?-1:0));
          const R=tournamentResults(t,'gross'); view.ttab='rounds'; render(); const tabsAll=tournamentTabs(t).map(x=>x[0]);
          t.features={meals:false,sponsors:false,budget:true,checklist:false,calcutta:false,raffle:false}; render(); const tabsFew=tournamentTabs(t).map(x=>x[0]);
          return {events:evs.map(e=>[e.format,e.front,e.back,e.teamSize,e.pool.length+e.groups[0].players.length,e.groups[0].players.map(p=>p.team).join('')]), rows:R.list.map(u=>[u.name,u.posTxt,u.totalTxt,u.rounds[t.rounds[0].id].txt,u.rounds[t.rounds[1].id].txt]), unit:R.unit, tabsAll, tabsFew, rowsShown:document.querySelectorAll('#tbody .tr.num').length}; }""")
        # Oak par 36/35. R1 split: scramble front (captain's 4s → E; T2 +3) + shamble back (T1 4s → +1; T2 +4) → T1 +1, T2 +7. R2 best ball: Ann's even-hole birdies → 63 (−8); T2 78 (+7). Totals −7 / +14
        ok=(r['events']==[['split','scramble','shamble',2,4,'T1T1T2T2'],['bestball','scramble','shamble',2,4,'T1T1T2T2']] and r['unit']=='strokes'
            and r['rows'][0][0].startswith('Ann Able') and r['rows'][0][1]=='1' and r['rows'][0][2]=='−7' and r['rows'][0][3]=='+1' and r['rows'][0][4]=='−8'
            and r['rows'][1][1]=='2' and r['rows'][1][2]=='+14' and r['rows'][1][3]=='+7' and r['rows'][1][4]=='+7'
            and r['tabsAll']==['overview','meals','field','checkin','rounds','sponsors','budget','checklist','calcutta','raffle'] and r['tabsFew']==['overview','field','checkin','rounds','budget'] and r['rowsShown']==2)
        print('rounds → events → results; tab toggles', r, 'OK' if ok else 'FAIL'); bad+=not ok
        # a member added in the association lands in the club directory + this organization's memberships; the drawer opens on the view
        r=await pg.evaluate("""()=>{ const p=upsertMember(null,{first:'Ada',last:'Lovelace',email:'ada@x.org',status:'Active',joined:'2026-01-01',notes:'hi'}); persist();
          const v=memberById(p.id); go('members'); editMember(v); const open=drawerOpen(); closeDrawer();
          return {inDir:!!CLUB.members.find(x=>x.id===p.id), personHasNotes:'notes' in CLUB.members.find(x=>x.id===p.id), ms:db.memberships.find(m=>m.id===p.id), view:[v.first,v.status,v.notes], count:members().length, open}; }""")
        ok=r['inDir'] and not r['personHasNotes'] and r['ms']['status']=='Active' and r['view']==['Ada','Active','hi'] and r['count']==5 and r['open']
        print('member add via association', r, 'OK' if ok else 'FAIL'); bad+=not ok
        r=await pg.evaluate("()=>{ removeMember(members()[0].id); return {dir:CLUB.members.length, ms:db.memberships.length}; }")
        ok=r=={'dir':5,'ms':4}; print('remove from association keeps the person', r, 'OK' if ok else 'FAIL'); bad+=not ok
      if org=='club':
        r=await pg.evaluate("""()=>{ go('orgs'); editOrg(null,'group'); document.getElementById('ogN').value='The Misfits'; document.getElementById('ogS').value='Misfits'; document.getElementById('dSave').click();
          const o=CLUB.orgs.find(x=>x.id==='misfits'); db=null; render(); const cards=[...document.querySelectorAll('[data-org]')].map(b=>b.dataset.org); return {o, cards}; }""")
        ok=r['o'] and r['o']['kind']=='group' and r['cards']==['club','mga','lga','smga','misfits']
        print('new small group + picker', r, 'OK' if ok else 'FAIL'); bad+=not ok
      print('  errors after checks', errs); bad+=bool(errs)
    # --- small group: games, live scoring, payouts by finish + skins, ledger
    pg=await b.new_page(); errs=[]; pg.on('pageerror',lambda e,errs=errs:errs.append(str(e))); await local(pg); await pg.goto(page('index.html')+'?org=club'); await pg.wait_for_timeout(500)
    await pg.evaluate("()=>{ CLUB.orgs.push({id:'misfits',kind:'group',name:'The Misfits',short:'Misfits'}); ['Ann Able 4.1','Bo Baker 12.0','Cy Cole 20.3','Di Dunn 8.8','Ed Eng 15.0'].forEach((x,i)=>{ const [f,l,h]=x.split(' '); CLUB.members.push({id:'p'+i,first:f,last:l,hcp:h,status:'Active'}); }); persist(); }")
    await pg.goto(page('index.html')+'?org=misfits'); await pg.wait_for_timeout(500)
    pages=await pg.evaluate("()=>{ ['p0','p1','p2','p3','p4'].forEach(id=>db.memberships.push({id,status:'Active',joined:'',notes:''})); persist(); return navItems().map(x=>x[0]); }")
    for v in pages: await pg.evaluate(f"()=>go('{v}')"); await pg.wait_for_timeout(60)
    r=await pg.evaluate("""()=>{ go('games'); editGame(null); document.getElementById('gmN').value='Friday game'; document.getElementById('gmD').value='2026-05-01'; document.getElementById('gmE').value='20'; document.getElementById('gmS').value='5'; document.getElementById('dSave').click();
      const g=GAME(); ['p0','p1','p2','p3','p4'].forEach(id=>g.players.push({id:'gp_'+id,memberId:id,name:'',paid:true,inSkins:id!=='p4',extraIn:0,gpid:''})); g.players.push({id:'gp_guest',memberId:'',name:'Guest Gus',paid:false,inSkins:false,extraIn:0,gpid:''});
      openScoring(g); const ev=gameEvent(g); return {nav:navItems().map(x=>x[0]), groups:ev.groups.map(x=>x.players.length), live:ev.status, money:gameMoney(g)}; }""")
    ok=r['nav']==['dash','games','ledger','golf','members'] and r['groups']==[4,2] and r['live']=='live' and r['money']['pot']==120 and r['money']['skins']==20
    print('group game + scoring event', r, 'OK' if ok else 'FAIL'); bad+=not ok
    # scores: Ann 4s everywhere; Bo 4s but a 3 on hole 2 (outright skin) ; Cy/Di/Ed 5s; hole 7: Ann 3, Bo 3 (tie → carry), hole 8: Cy 3 outright → 2 skins with carry
    r=await pg.evaluate("""async()=>{ const g=GAME(), ev=gameEvent(g); const gp=id=>g.players.find(p=>p.id===id).gpid; const S=async(id,h,v)=>setScore(ev,gp(id),h,v);
      for(let h=1;h<=18;h++){ await S('gp_p0',h,h===7?3:4); await S('gp_p1',h,h===2?3:h===7?3:4); await S('gp_p2',h,h===8?3:5); await S('gp_p3',h,5); await S('gp_p4',h,5); await S('gp_guest',h,6); }
      const sk=skinsCalc(g,{net:false,carry:true,validate:'none'}); const lb=eventBoard(publicEvent(ev),scoresFor(ev),{sort:'gross'}).map(r=>[r.name,r.pos,r.gross]);
      return {skins:sk.wins.map(w=>[w.hole,w.name,w.count]), total:sk.total, lb}; }""")
    # hole 1 ties (carry 1) → Bo wins 2 on hole 2; holes 3–7 tie (carry 5) → Cy wins 6 on hole 8; the rest carry unpaid
    ok=r['skins']==[[2,'Bo Baker',2],[8,'Cy Cole',6]] and r['total']==8 and r['lb'][0]==['Bo Baker',1,70] and r['lb'][1]==['Ann Able',2,71]
    print('skins + leaderboard', r, 'OK' if ok else 'FAIL'); bad+=not ok
    r=await pg.evaluate("""()=>{ const g=GAME(); payPlaces(g); const pcts=document.getElementById('pfP').value; document.getElementById('dSave').click(); paySkins(g); document.getElementById('dSave').click();
      const by=id=>Math.round(gpOut(g,g.players.find(p=>p.id===id))*100)/100; go('ledger'); const rows=ledgerRows('season').map(r=>[r.name,r.games,r.inn,Math.round(r.out*100)/100,Math.round(r.net*100)/100]);
      return {pcts, ann:by('gp_p0'), bo:by('gp_p1'), cy:by('gp_p2'), left:Math.round(gameMoney(g).left*100)/100, rows}; }""")
    # pot 120 at 60/40: Bo 72, Ann 48; skins pot 20 over 8 skins: Bo 2 → 5, Cy 6 → 15; Bo paid in 20 + 5 skins
    ok=r['pcts']=='60 / 40' and r['ann']==48 and r['bo']==77 and r['cy']==15 and r['left']==0 and r['rows'][0]==['Bo Baker',1,25,77,52] and r['rows'][-1]==['Di Dunn',1,25,0,-25]
    print('payouts + ledger', r, 'OK' if ok else 'FAIL'); bad+=not ok
    print('  group errors', errs); bad+=bool(errs)
    await b.close()
  sys.exit(1 if bad else 0)
asyncio.run(main())
