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
        # partner cap, tournament flights → events, pairing by standings, results PDF
        r=await pg.evaluate("""async()=>{ const t=db.tournaments.find(x=>x.id==='T1'); t.hcpDiff=10; const evs=t.rounds.map(roundEvent);
          const cy=evPlayers(evs[0]).find(x=>x.p.memberId==='q2'); const h=hcpOf(evs[0],cy.p,cy.grp);
          const fl=setTournamentFlights(t,1); applyFlights(t,evs[0]); applyFlights(t,evs[1]);
          t.flights.plan.A.start='shotgun'; const ps=evPlayers(evs[1]).map(x=>x.p); evs[1].groups=[]; evs[1].pool=ps; pairByStandings(t,t.rounds[1]); document.getElementById('dSave').click();
          const g=evs[1].groups; const pdf=await resultsPDF(t,{returnDoc:true}); window.__pdf=pdf.output('datauristring');
          return {capped:[h.capped,h.raw,h.idx], units:fl.units.map(u=>[u.key,u.val]), of:t.flights.of, flights:evPlayers(evs[0]).map(x=>x.p.flight).join(''), groups:g.map(x=>[x.startHole,x.players.map(p=>p.team).join('')]), pdfLen:window.__pdf.length}; }""")
        # Di 8.8 + Cy 20.3 → Cy capped to 18.8; T1 (4.1+12.0=16.1) and T2 (8.8+18.8=27.6) in one flight; after R1 T1 leads → hole 1 on the shotgun
        ok=r['capped']==[True,20.3,18.8] and r['units']==[['T1',16.1],['T2',27.6]] and r['of']=={'T1':'A','T2':'A'} and r['flights']=='AAAA' and r['groups']==[[1,'T1T1T2T2']] and r['pdfLen']>20000
        print('partner cap, flights, pairing, pdf', r, 'OK' if ok else 'FAIL'); bad+=not ok
        import base64; open('/tmp/claude-0/-home-user-mga-app/63b75e30-a124-565b-b1a4-06911e16cfbc/scratchpad/results.pdf','wb').write(base64.b64decode((await pg.evaluate("()=>window.__pdf")).split(',',1)[1]))
        # a member added in the association lands in the club directory + this organization's memberships; the drawer opens on the view
        r=await pg.evaluate("""()=>{ const p=upsertMember(null,{first:'Ada',last:'Lovelace',email:'ada@x.org',status:'Active',joined:'2026-01-01',notes:'hi'}); persist();
          const v=memberById(p.id); go('members'); editMember(v); const open=drawerOpen(); closeDrawer();
          return {inDir:!!CLUB.members.find(x=>x.id===p.id), personHasNotes:'notes' in CLUB.members.find(x=>x.id===p.id), ms:db.memberships.find(m=>m.id===p.id), view:[v.first,v.status,v.notes], count:members().length, open}; }""")
        ok=r['inDir'] and not r['personHasNotes'] and r['ms']['status']=='Active' and r['view']==['Ada','Active','hi'] and r['count']==5 and r['open']
        print('member add via association', r, 'OK' if ok else 'FAIL'); bad+=not ok
        r=await pg.evaluate("()=>{ removeMember(members()[0].id); return {dir:CLUB.members.length, ms:db.memberships.length}; }")
        ok=r=={'dir':5,'ms':4}; print('remove from association keeps the person', r, 'OK' if ok else 'FAIL'); bad+=not ok
        # dues billed through the club: Ada was billed automatically on joining; Bill dues covers the rest who owe
        r=await pg.evaluate("""()=>{ const s=db.seasons[Y()]; const auto=s.duesCharges.length; billDues(); const n=document.querySelectorAll('#dBody .mr').length; document.getElementById('dSave').click();
          return {auto, listed:n, charges:s.duesCharges.map(c=>[c.amount,c.status,c.desc]), owing:members().filter(m=>m.status!=='Inactive'&&memberDues(Y(),m.id)<n0(s.dues.amount)).length}; }""")
        ok=r['auto']==1 and r['charges'] and all(c[1]=='open' and c[2]==f"{2026} MGA dues" for c in r['charges']) and len(r['charges'])==r['owing']+0 and r['listed']==r['owing']-1
        print('bill dues through the club', r, 'OK' if ok else 'FAIL'); bad+=not ok
      if org=='club':
        r=await pg.evaluate("""()=>{ go('orgs'); editOrg(null,'group'); document.getElementById('ogN').value='The Misfits'; document.getElementById('ogS').value='Misfits'; document.getElementById('dSave').click();
          const o=CLUB.orgs.find(x=>x.id==='misfits'); db=null; render(); const cards=[...document.querySelectorAll('[data-org]')].map(b=>b.dataset.org); return {o, cards}; }""")
        ok=r['o'] and r['o']['kind']=='group' and r['cards']==['club','mga','lga','smga','misfits']
        print('new small group + picker', r, 'OK' if ok else 'FAIL'); bad+=not ok
        pg.on('dialog',lambda d:asyncio.ensure_future(d.accept()))
        # each page is its own browser context, so bill from the MGA in this page, then come back to the club
        await pg.goto(page('index.html')+'?org=mga'); await pg.wait_for_timeout(400)
        await pg.evaluate("()=>{ ['Ann Able 4.1','Bo Baker 12.0','Cy Cole 20.3'].forEach((x,i)=>{ const [f,l,h]=x.split(' '); CLUB.members.push({id:'c'+i,first:f,last:l,hcp:h,status:'Active'}); db.memberships.push({id:'c'+i,status:'Active',joined:'',notes:''}); }); db.tournaments.push(newTournament({name:'MGA Open',season:Y(),startDate:'2026-11-01',days:1})); billDues(); document.getElementById('dSave').click(); }")
        await pg.goto(page('index.html')+'?org=club'); await pg.wait_for_timeout(400)
        r=await pg.evaluate("""()=>{ go('collections'); const open=document.querySelectorAll('[data-ch]').length; document.getElementById('clCharge').click(); view.cfilter='charged'; render();
          const first=document.querySelector('[data-co]'); const id=first.dataset.co; first.click(); view.cfilter='all'; render();
          const mga=DOCS.mga.db, s=mga.seasons[Y()], c=s.duesCharges.find(x=>x.id===id), pay=s.duesPayments.find(p=>p.chargeId===id);
          go('tournaments'); const orgRows=document.querySelectorAll('[data-org]').length; go('budget'); const noDues=!document.getElementById('sbDues')&&!document.getElementById('main').textContent.includes('50/50 raffle');
          return {open, statuses:s.duesCharges.map(x=>x.status), c:[c.status,!!c.chargedAt,!!c.collectedAt], pay:pay&&[pay.amount,pay.method], orgRows, noDues, raffleOff:!featuresHTML('x',{}).includes('50/50')}; }""")
        ok=r['open']>=2 and r['statuses'].count('collected')==1 and r['statuses'].count('charged')==r['open']-1 and r['c']==['collected',True,True] and r['pay']==[r['pay'][0],'Club account'] and r['orgRows']>=1 and r['noDues'] and r['raffleOff']
        print('club collects dues + sees the calendar, no club dues/raffle', r, 'OK' if ok else 'FAIL'); bad+=not ok
      print('  errors after checks', errs); bad+=bool(errs)
    # --- small group: games, live scoring, payouts by finish + skins, ledger
    pg=await b.new_page(); errs=[]; pg.on('pageerror',lambda e,errs=errs:errs.append(str(e))); await local(pg); await pg.goto(page('index.html')+'?org=club'); await pg.wait_for_timeout(500)
    await pg.evaluate("()=>{ CLUB.orgs.push({id:'misfits',kind:'group',name:'The Misfits',short:'Misfits'}); ['Ann Able 4.1','Bo Baker 12.0','Cy Cole 20.3','Di Dunn 8.8','Ed Eng 15.0'].forEach((x,i)=>{ const [f,l,h]=x.split(' '); CLUB.members.push({id:'p'+i,first:f,last:l,hcp:h,status:'Active'}); }); persist(); }")
    await pg.goto(page('index.html')+'?org=misfits'); await pg.wait_for_timeout(500)
    pages=await pg.evaluate("()=>{ ['p0','p1','p2','p3','p4'].forEach(id=>db.memberships.push({id,status:'Active',joined:'',notes:''})); persist(); return navItems().map(x=>x[0]); }")
    for v in pages: await pg.evaluate(f"()=>go('{v}')"); await pg.wait_for_timeout(60)
    r=await pg.evaluate("""()=>{ go('games'); editGame(null); document.getElementById('gmN').value='Friday game'; document.getElementById('gmD').value='2026-05-01'; document.getElementById('gmE').value='20'; document.getElementById('gmS').value='5'; document.getElementById('dSave').click();
      const g=GAME(); ['p0','p1','p2','p3','p4'].forEach(id=>{ const p=addPlayer(g,{memberId:id}); p.id='gp_'+id; g.pots.forEach(pot=>{ delete pot.inn[p.id]; }); }); const gu=addPlayer(g,{name:'Guest Gus'}); gu.id='gp_guest';
      g.players.forEach(p=>{ g.pots[0].inn[p.id]=true; if(!['gp_p4','gp_guest'].includes(p.id)) g.pots[1].inn[p.id]=true; }); g.players.forEach(p=>{ p.paid=p.id!=='gp_guest'; });
      // a dots pot for everyone and a blind-draw side pot for four
      g.pots.push(newPot('dots','Dots',2,g,{rules:{game:'dots'}})); const bd=newPot('format','Blind draw',5,null,{rules:{game:'blinddraw'}}); ['gp_p0','gp_p1','gp_p2','gp_p3'].forEach(id=>bd.inn[id]=true); g.pots.push(bd);
      openScoring(g); const ev=gameEvent(g); return {nav:navItems().map(x=>x[0]), groups:ev.groups.map(x=>x.players.length), live:ev.status, pots:g.pots.map(p=>[p.kind,potTotal(g,p)]), total:gameMoney(g).total}; }""")
    ok=r['nav']==['dash','games','ledger','tournaments','golf','members'] and r['groups']==[4,2] and r['live']=='live' and r['pots']==[['finish',120],['skins',20],['dots',12],['format',20]] and r['total']==172
    print('group game + pots + scoring event', r, 'OK' if ok else 'FAIL'); bad+=not ok
    # scores: Ann 4s everywhere; Bo 4s but a 3 on hole 2 (outright skin) ; Cy/Di/Ed 5s; hole 7: Ann 3, Bo 3 (tie → carry), hole 8: Cy 3 outright → 2 skins with carry
    r=await pg.evaluate("""async()=>{ const g=GAME(), ev=gameEvent(g); const gp=id=>g.players.find(p=>p.id===id).gpid; const S=async(id,h,v)=>setScore(ev,gp(id),h,v);
      for(let h=1;h<=18;h++){ await S('gp_p0',h,h===7?3:4); await S('gp_p1',h,h===2?3:h===7?3:4); await S('gp_p2',h,h===8?3:5); await S('gp_p3',h,5); await S('gp_p4',h,5); await S('gp_guest',h,6); }
      const sk=skinsCalc(g,g.pots[1],{net:false,carry:true,validate:'none'}); const lb=eventBoard(publicEvent(ev),scoresFor(ev),{sort:'gross'}).map(r=>[r.name,r.pos,r.gross]);
      const dots=dotsAuto(g,g.pots[2],dotsRules(g.pots[2])); return {skins:sk.wins.map(w=>[w.hole,w.name,w.count]), total:sk.total, lb, dots:['gp_p0','gp_p1','gp_p2','gp_p3'].map(id=>dots[id].birdies+'/'+dots[id].eagles)}; }""")
    # hole 1 ties (carry 1) → Bo wins 2 on hole 2; holes 3–7 tie (carry 5) → Cy wins 6 on hole 8; the rest carry unpaid. Oak par 5-4-5-3…: Ann birdies 1, 3, 7, 12; Bo adds hole 2; Cy hole 8
    ok=r['skins']==[[2,'Bo Baker',2],[8,'Cy Cole',6]] and r['total']==8 and r['lb'][0]==['Bo Baker',1,70] and r['lb'][1]==['Ann Able',2,71] and r['dots']==['4/0','5/0','1/0','0/0']
    print('skins + leaderboard + dots', r, 'OK' if ok else 'FAIL'); bad+=not ok
    r=await pg.evaluate("""async()=>{ const g=GAME(); const S=()=>document.getElementById('dSave').click(); payPlaces(g,g.pots[0]); const pcts=document.getElementById('pfP').value; S(); paySkins(g,g.pots[1]); S();
      payDots(g,g.pots[2]); const di=document.querySelector('[data-dt="gp_p3|Sandy"]'); di.value='2'; di.dispatchEvent(new Event('input')); S();
      payFormat(g,g.pots[3]); document.getElementById('sdN').value='2'; S(); await new Promise(r=>setTimeout(r,250)); const drawn=Object.assign({},g.pots[3].teams); closeDrawer();
      const gpid=id=>g.players.find(p=>p.id===id).gpid; g.pots[3].teams={[gpid('gp_p0')]:'S1',[gpid('gp_p3')]:'S1',[gpid('gp_p1')]:'S2',[gpid('gp_p2')]:'S2'}; payFormat(g,g.pots[3]); const bdAmt=document.getElementById('pfAmt').value; S();
      const bd=g.pots[3], dv=Object.values(drawn);
      const by=id=>Math.round(gpOut(g,g.players.find(p=>p.id===id))*100)/100; go('ledger'); const rows=ledgerRows('season').map(r=>[r.name,r.games,r.inn,Math.round(r.out*100)/100,Math.round(r.net*100)/100]);
      return {pcts, ann:by('gp_p0'), bo:by('gp_p1'), cy:by('gp_p2'), di:by('gp_p3'), bdAmt, drawn:dv.length, drawnSides:new Set(dv).size, bdPay:bd.payouts.map(x=>[x.pid,x.amount]), left:Math.round(gameMoney(g).left*100)/100, rows}; }""")
    # main 120 at 60/40: Bo 72, Ann 48; skins 20 over 8: Bo 5, Cy 15; dots 12 over 12 dots (Ann 4, Bo 5, Cy 1, Di 2 sandies) at $1; blind draw 20: Bo/Cy best ball 70 beats Ann/Di 71 → 10 each
    ok=(r['pcts']=='60 / 40' and r['ann']==52 and r['bo']==92 and r['cy']==26 and r['di']==2 and r['bdAmt']=='20' and r['drawn']==4 and r['drawnSides']==2 and sorted(r['bdPay'])==[['gp_p1',10],['gp_p2',10]]
        and r['left']==0 and r['rows'][0]==['Bo Baker',1,32,92,60] and r['rows'][-1]==['Di Dunn',1,32,2,-30])
    print('payouts + ledger', r, 'OK' if ok else 'FAIL'); bad+=not ok
    print('  group errors', errs); bad+=bool(errs)
    await b.close()
  sys.exit(1 if bad else 0)
asyncio.run(main())
