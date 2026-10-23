"""Opens every page and every hub screen (club hub + an association) and fails on any script error. Run: python3 tests/smoke.py"""
import asyncio,sys
from playwright.async_api import async_playwright
from _harness import local,page
T1="()=>{ db.tournaments.push(Object.assign({id:'T1',name:'Member-Member',season:Y(),days:3,field:[],sponsors:[],tiers:[],income:[],perPlayer:[],lines:[],dayItems:[[],[],[]],actuals:{},schedule:[],decisions:[]})); persist(); }"
async def main():
  bad=0
  async with async_playwright() as p:
    b=await p.chromium.launch()
    for name,check in [('index.html',"()=>!!document.getElementById('nav')"),('cashier.html',"()=>!!document.getElementById('main')"),('checkin.html',"()=>!!document.getElementById('main')"),('score.html',"()=>document.body.innerText.length>0"),('survey.html',"()=>document.body.innerText.includes('not complete')")]:
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
      # a reload (pull-to-refresh, the auto-update) comes back to the same page, tab and record
      await pg.evaluate("()=>{ go('tournament',{tid:'T1'}); view.ttab='field'; render(); }"); await pg.reload(); await pg.wait_for_timeout(700)
      r=await pg.evaluate("()=>[view.page,view.tid,view.ttab,!!document.querySelector('.crumb')]")
      ok=r==['tournament','T1','field',True]; print(f'{org:5} reload keeps the place', r, 'OK' if ok else 'FAIL'); bad+=not ok
      # …but not a record that no longer exists
      await pg.evaluate("()=>{ localStorage.setItem(VIEW_KEY(),JSON.stringify(Object.assign({},view,{tid:'gone',_at:Date.now()}))); }"); await pg.reload(); await pg.wait_for_timeout(700)
      r=await pg.evaluate("()=>view.page"); ok=r=='tournaments'; print(f'{org:5} reload with a missing record falls back', r, 'OK' if ok else 'FAIL'); bad+=not ok
      await pg.evaluate("()=>go('tournament',{tid:'T1'})")
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
        # a player taken out of the field leaves every round's event, the leaderboard and live scoring, scores and all
        rf=await pg.evaluate("""async()=>{ const t=db.tournaments.find(x=>x.id==='T1'); const evs=t.rounds.map(roundEvent);
          CLUB.members.push({id:'q4',first:'Ed',last:'Eng',hcp:'9.0',status:'Active'}); db.memberships.push({id:'q4',status:'Active',joined:'',notes:''}); t.field.push({id:uid(),memberId:'q4',team:3,paid:true,skins:false,answers:{}}); ensureTournamentScoring(t);
          const gone=evs.map(ev=>evPlayers(ev).find(x=>x.p.memberId==='q4').p.id); for(let i=0;i<evs.length;i++) for(let h=1;h<=18;h++) await setScore(evs[i],gone[i],h,5);
          const had=evs.map((ev,i)=>Object.keys(scoresFor(ev)[gone[i]]||{}).length), lbBefore=evs.map((ev,i)=>eventBoard(publicEvent(ev),scoresFor(ev),{sort:'gross'}).some(r=>r.id===gone[i]||(r.members||[]).includes(gone[i])));
          t.field=t.field.filter(fp=>fp.memberId!=='q4'); ensureTournamentScoring(t); CLUB.members=CLUB.members.filter(m=>m.id!=='q4'); db.memberships=db.memberships.filter(m=>m.id!=='q4');
          return {had, lbBefore, inEv:evs.map((ev,i)=>evPlayers(ev).some(x=>x.p.id===gone[i])), scores:evs.map((ev,i)=>Object.keys(scoresFor(ev)[gone[i]]||{}).length), lb:evs.map((ev,i)=>eventBoard(publicEvent(ev),scoresFor(ev),{sort:'gross'}).some(r=>r.id===gone[i]||(r.members||[]).includes(gone[i]))), players:evs.map(ev=>evPlayers(ev).length)}; }""")
        okf=rf['had']==[18,18] and rf['inEv']==[False,False] and rf['scores']==[0,0] and rf['lb']==[False,False] and rf['players']==[4,4]
        print('field removal → off every round, scores gone', rf, 'OK' if okf else 'FAIL'); bad+=not okf
        # skins: a player with no scores at all (a no-show, a late group) does not hold the holes up; the board says who a hole waits on
        r=await pg.evaluate("""()=>{ const c=courseById('oak'), par=c.par.M; const pub={format:'stroke',scoring:'net',allow:{'*':100},noPar3:false,courses:{oak:{name:c.name,par:c.par,hcp:c.hcp,tees:{}}},
            groups:[{id:'g1',label:'G1',course:'oak',startHole:1,players:[{id:'a',name:'Ann',ph:0,set:'M'},{id:'b',name:'Bo',ph:0,set:'M'},{id:'c',name:'Cy',ph:0,set:'M'},{id:'d',name:'Di',ph:0,set:'M'}]}]};
          const sc={a:{1:par[0]-1,2:par[1],3:par[2]-1},b:{1:par[0],2:par[1],3:par[2]},c:{1:par[0],2:par[1]}};   // Di never scored; Cy has not posted 3; Ann birdied 3 so far
          const rules={net:true,grossBeatsNet:true,validate:'none',carry:false,mode:'pot'}; const r=skinsResult(pub,sc,rules,['a','b','c','d']);
          const before=skinsResult(pub,sc,rules,['a','b','c']);   // the same without Di in the pot
          sc.c[3]=par[2]-1; const after=skinsResult(pub,sc,rules,['a','b','c','d']);   // Cy ties Ann on 3 → the lead disappears
          return {wins:r.wins.map(w=>[w.hole,w.name,w.status,w.open||0]), total:r.total, leading:r.leading, notStarted:r.notStarted, waiting:r.waitingOn, txt:skinsWaitTxt(r), same:JSON.stringify(before.wins)===JSON.stringify(r.wins), after:after.wins.map(w=>[w.hole,w.status])}; }""")
        # hole 1 is won (everyone who started has it); hole 3 Ann LEADS with Cy still to play; total counts won skins only; a tie on 3 later removes the lead
        ok=(r['wins']==[[1,'Ann','won',0],[3,'Ann','lead',1]] and r['total']==1 and r['leading']==1 and r['notStarted']==['Di'] and r['waiting']=={'hole':3,'names':['Cy']}
            and r['txt']=='hole 3 waits on Cy · Di not started' and r['same'] and r['after']==[[1,'won']])
        print('skins: no-shows do not block, waiting line', r, 'OK' if ok else 'FAIL'); bad+=not ok
        # no pops on par 3s: the playing handicap is spread over the non-par-3 holes; a plus handicap gives back from the easiest of them;
        # the switch travels event → published copy → leaderboard / skins; off = the old 18-hole allocation exactly
        r=await pg.evaluate("""()=>{ const c=courseById('oak'), par=c.par.M, hc=c.hcp.M, p3=par.map((p,i)=>p===3?i:-1).filter(i=>i>=0);
          const tot=(pub,ph)=>{ let t=0, on3=0, per=[]; for(let h=1;h<=18;h++){ const k=strokesAt(pub,c,'M',h,ph); t+=k; per.push(k); if(par[h-1]===3&&k) on3++; } return {t,on3,per}; };
          const off={}, on={noPar3:true}; const a=tot(on,20), b=tot(on,-3), d=tot(on,7), e=tot(off,20), f=tot(off,-3);
          const lost=(ph)=>p3.reduce((t,i)=>t+strokesOn(ph,hc[i]),0), same=(x,ph)=>x.per.every((k,i)=>k===(par[i]===3?0:strokesOn(ph,hc[i])));
          const okA=a.on3===0&&a.t===20-lost(20)&&same(a,20), okB=b.on3===0&&b.t===-3-lost(-3)&&same(b,-3), okD=d.on3===0&&d.t===7-lost(7)&&same(d,7);
          const okOff=e.t===20&&f.t===-3&&e.per.every((k,i)=>k===strokesOn(20,hc[i]))&&f.per.every((k,i)=>k===strokesOn(-3,hc[i]));
          const n=18-p3.length;
          // through an event: the published copy carries the switch and the net board changes only by the par-3 strokes
          const g=golfData(); const ev={id:'np3',slug:'np3',name:'NP3',date:'2026-10-23',status:'live',format:'stroke',scoring:'net',defaultTee:'White',defaultCourse:'oak',allow:{},pool:[],flights:{count:0,names:[]},
            groups:[{id:'g',code:'NP3AA',label:'G',course:'oak',startHole:1,teeTime:'',players:[{id:'x1',name:'Ann',index:'18.0',tee:'White',set:'M'}]}]}; g.events.push(ev);
          const sc={x1:Object.fromEntries([...Array(18).keys()].map(i=>[i+1,par[i]+1]))};
          const netOff=eventBoard(publicEvent(ev),sc,{sort:'net'})[0].net; ev.noPar3=true; const pub=publicEvent(ev); const netOn=eventBoard(pub,sc,{sort:'net'})[0].net, ph=pub.groups[0].players[0].ph;
          g.events=g.events.filter(x=>x!==ev);
          return {p3:p3.length,n,okA,okB,okD,okOff,pubFlag:pub.noPar3,netOff,netOn,ph,lostPH:lost(ph)}; }""")
        # the net total rises by exactly the strokes that fell on par 3s
        ok=r['p3']>=3 and r['okA'] and r['okB'] and r['okD'] and r['okOff'] and r['pubFlag'] and r['lostPH']>0 and r['netOn']==r['netOff']+r['lostPH']
        print('no pops on par 3s', r, 'OK' if ok else 'FAIL'); bad+=not ok
        # points per score are adjustable: an event's own quota table (birdie 5, par 3) changes the board; the standard table is not stored
        r=await pg.evaluate("""()=>{ const g=golfData(); const c=courseById('oak'), par=c.par.M;
          const ev={id:'qt',slug:'qt',name:'Quota day',date:'2026-10-23',status:'live',format:'quota',quotaBase:36,scoring:'gross',defaultTee:'White',defaultCourse:'oak',allow:{},pool:[],flights:{count:0,names:[]},
            groups:[{id:'g',code:'QTAAA',label:'G',course:'oak',startHole:1,teeTime:'',players:[{id:'x1',name:'Ann',index:'0.0',tee:'White',set:'M'}]}]}; g.events.push(ev);
          const sc={x1:Object.fromEntries([...Array(18).keys()].map(i=>[i+1,par[i]-(i<2?1:0)]))};   // two birdies, sixteen pars
          const std=eventBoard(publicEvent(ev),sc,{sort:'gross'})[0].pts; ev.points={quota:{'-3':16,'-2':8,'-1':5,'0':3,'1':1,'2':0}}; const pub=publicEvent(ev); const own=eventBoard(pub,sc,{sort:'gross'})[0].pts;
          editEvent(ev); const grid=!!document.getElementById('gePt_-1'), bird=document.getElementById('gePt_-1').value; document.getElementById('gePt_-1').value='4'; document.getElementById('gePt_0').value='2'; document.getElementById('gePt_-1').dispatchEvent(new Event('input')); document.getElementById('gePt_0').dispatchEvent(new Event('input'));
          document.getElementById('dSave').click(); const stored=JSON.stringify(ev.points), custom=pointsCustom(pub,'quota'), label=formatSummary(pub);
          g.events=g.events.filter(x=>x!==ev); return {std,own,grid,bird,stored,custom,label,ph:pub.groups[0].players[0].ph}; }""")
        # quota = 36 − PH (index 0.0 on Oak White plays to +3 → 39). Standard: 2×4 + 16×2 = 40. Own table: 2×5 + 16×3 = 58. Back to standard in the editor → nothing stored.
        q=36-r['ph']; ok=r['std']==40-q and r['own']==58-q and r['grid'] and r['bird']=='5' and r['stored']=='{}' and r['custom'] and 'own point table' in r['label']
        print('adjustable points per score', r, 'OK' if ok else 'FAIL'); bad+=not ok
        # live quota: the owner's example — a 0 through 6 holes should have 12; 5 pars and a bogey = 11 → −1 vs quota
        r=await pg.evaluate("""()=>{ const g=golfData(); const c=courseById('oak'), par=c.par.M;
          const ev={id:'qt2',slug:'qt2',name:'Quota live',date:'2026-10-23',status:'live',format:'quota',quotaBase:36,scoring:'gross',defaultTee:'White',defaultCourse:'oak',allow:{},pool:[],flights:{count:0,names:[]},
            groups:[{id:'g',code:'QTBBB',label:'G',course:'oak',startHole:1,teeTime:'',players:[{id:'x1',name:'Ann',index:'0.0',tee:'White',set:'M'},{id:'x2',name:'Bo',index:'18.0',tee:'White',set:'M'},{id:'x3',name:'Cy',index:'9.0',tee:'White',set:'M'}]}]}; g.events.push(ev);
          const pub=publicEvent(ev); pub.groups[0].players[0].ph=0; pub.groups[0].players[1].ph=18; pub.groups[0].players[2].ph=9;   // the example is for a 0 playing handicap; Bo (quota 18) and Cy (quota 27) are in the same game
          const sc={x1:{1:par[0],2:par[1],3:par[2],4:par[3],5:par[4],6:par[5]+1},            // Ann: 11 pts, needs 12 → −1
                    x2:{1:par[0],2:par[1],3:par[2]+1,4:par[3]+1},                              // Bo thru 4: 6 pts, needs 4 → +2 (fewer points, but ahead of his quota)
                    x3:{1:par[0],2:par[1]+1,3:par[2]+1,4:par[3]+1,5:par[4]+1,6:par[5]+1}};     // Cy thru 6: 7 pts, needs 9 → −2
          const lb=eventBoard(pub,sc,{sort:'gross'}); const r=lb.find(x=>x.id==='x1'); g.events=g.events.filter(x=>x!==ev);
          return {need:r.need,raw:r.ptsRaw,pts:r.pts,txt:ptsTxt(r),line:ptsLine(r),thru:r.thru,order:lb.map(x=>x.name+' '+ptsTxt(x)),pos:lb.map(x=>x.posTxt)}; }""")
        ok=(r['need']==12 and r['raw']==11 and r['pts']==-1 and r['txt']=='−1' and r['line']=='11 pts · 12 needed thru 6 of 36' and r['thru']=='6'
            and r['order']==['Bo +2','Ann −1','Cy −2'] and r['pos']==['1','2','3'])   # ranked by distance from quota, not by raw points
        print('live quota vs pro-rated quota', r, 'OK' if ok else 'FAIL'); bad+=not ok
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
    # a reload mid-design (the auto-update, pull-to-refresh) comes back to the designer with the draft; the auto-update itself holds off while designing
    r=await pg.evaluate("()=>{ go('games'); designGame(null); GD.draft.name='Half-typed name'; render(); return {hold:!window.__canReload(), gd:view.gdesign}; }"); await pg.reload(); await pg.wait_for_timeout(700)
    r2=await pg.evaluate("()=>({gd:view.gdesign, name:GD&&GD.draft.name, shown:!!document.getElementById('gdName'), val:document.getElementById('gdName')&&document.getElementById('gdName').value})")
    ok=r['hold'] and r['gd']=='new' and r2['gd']=='new' and r2['name']=='Half-typed name' and r2['shown'] and r2['val']=='Half-typed name'
    print('designer survives a reload; auto-update waits', r, r2, 'OK' if ok else 'FAIL'); bad+=not ok
    await pg.evaluate("()=>{ GD=null; view.gdesign=null; go('games'); }")
    # a game draws on the whole club directory, the group's members first; a club person who is not in the group can be added and is named
    r=await pg.evaluate("""()=>{ CLUB.members.push({id:'zz1',first:'Zed',last:'Zulu',hcp:'7.4',status:'Active'}); const pool=gamePool(), outsider=pool.find(x=>!x.inGroup); if(!outsider) return {noOutsider:true};
      designGame(null); const d=GD.draft; const q=$('gdQ'); q.value=memberName(outsider).slice(0,4); q.dispatchEvent(new Event('input'));
      const hit=document.querySelector(`[data-gdadd="${outsider.id}"]`), tagged=!!(hit&&hit.querySelector('.chip')); if(hit) hit.click();
      const p=GD.draft.players.find(x=>x.memberId===outsider.id); const name=p?gpName(p):''; const firstInGroup=pool[0].inGroup;
      GD=null; view.gdesign=null; go('games'); return {firstInGroup, tagged, added:!!p, name, expected:memberName(outsider), stillNotMember:!db.memberships.some(m=>m.id===outsider.id)}; }""")
    ok=not r.get('noOutsider') and r['firstInGroup'] and r['tagged'] and r['added'] and r['name']==r['expected'] and r['stillNotMember']
    print('games draw on the club directory', r, 'OK' if ok else 'FAIL'); bad+=not ok
    # a guest's index typed on the game page survives the page redrawing mid-typing (live standings redraw often) and saves on change
    r=await pg.evaluate("""()=>{ designGame(null); addPlayer(GD.draft,{name:'Guest Gus'}); $('gdSave').click(); const g=db.games[db.games.length-1]; if(!g) return {noGame:true}; view.gameId=g.id; view.gdesign=null; go('games'); const ev=ensureGameEvent(g); render();
      const inp=document.querySelector('[data-gidx]'); if(!inp) return {noInput:true}; inp.focus(); inp.value='14.'; render();
      const after=document.getElementById(inp.id); const kept=after&&after.value==='14.'&&document.activeElement===after;
      after.value='+1.6'; after.dispatchEvent(new Event('change')); const p=evPlayers(ev).find(x=>x.p.id===after.dataset.gidx); const idx=p&&p.p.index, ph=p&&playerHcp(ev,p.grp,p.p).ph;
      deleteGame(g); view.gameId=null; go('games');   // leave nothing behind: the next scenario starts from the last game
      return {kept, idx, ph}; }""")
    ok=not r.get('noGame') and not r.get('noInput') and r['kept'] and r['idx']=='+1.6' and isinstance(r['ph'],int) and r['ph']<0
    print('index typed on the game page survives a redraw, plus accepted', r, 'OK' if ok else 'FAIL'); bad+=not ok
    # the game default course and tee: set once, every group and player follows; a single player can still differ afterwards
    r=await pg.evaluate("""()=>{ designGame(null); const d=GD.draft; ['p0','p1','p2','p3','p4'].forEach(id=>addPlayer(d,{memberId:id})); const teeOpts=[...document.getElementById('gdTee').options].map(o=>o.value);
      document.getElementById('gdTee').value='Gold'; $('gdSave').click(); const g=db.games[db.games.length-1]; view.gameId=g.id; go('games'); const ev=ensureGameEvent(g); render();
      const tees0=evPlayers(ev).map(x=>x.p.tee), def=ev.defaultTee, gTee0=g.tee;
      const dc=document.getElementById('ggDefCourse'); dc.value='pecan'; dc.dispatchEvent(new Event('change')); const courses=ev.groups.map(x=>x.course);
      const dt=document.getElementById('ggDefTee'); dt.value='White'; dt.dispatchEvent(new Event('change')); const tees1=evPlayers(ev).map(x=>x.p.tee);
      const one=document.querySelector('[data-gtee]'); one.value='Blue'; one.dispatchEvent(new Event('change')); const tees2=evPlayers(ev).map(x=>x.p.tee);
      const r={hasTee:teeOpts.includes('Gold'), gTee:gTee0, def, tees0, courses, gCourse:g.course, tees1, tees2, groups:ev.groups.length};
      deleteGame(g); view.gameId=null; go('games'); return r; }""")
    ok=(r['hasTee'] and r['gTee']=='Gold' and r['def']=='Gold' and set(r['tees0'])=={'Gold'} and set(r['courses'])=={'pecan'} and r['gCourse']=='pecan'
        and set(r['tees1'])=={'White'} and r['tees2'].count('Blue')==1 and r['tees2'].count('White')==len(r['tees2'])-1 and r['groups']>=2)
    print('game default course & tee', r, 'OK' if ok else 'FAIL'); bad+=not ok
    # placeholder groups: five empty groups added in a row stay (with their own tee times), survive a player moving, and an empty one can be removed
    r=await pg.evaluate("""()=>{ designGame(null); const d=GD.draft; ['p0','p1'].forEach(id=>addPlayer(d,{memberId:id})); $('gdSave').click(); const g=db.games[db.games.length-1]; view.gameId=g.id; go('games'); const ev=ensureGameEvent(g); render();
      const before=ev.groups.length; for(let i=0;i<5;i++) document.getElementById('ggAddGroup').click(); const after=ev.groups.length;
      const t=document.querySelector(`[data-gtime="${ev.groups[1].id}"]`); t.value='08:20'; t.dispatchEvent(new Event('change'));
      const mv=document.querySelector('[data-gmove]'); mv.value=ev.groups[2].id; mv.dispatchEvent(new Event('change')); const afterMove=ev.groups.length, synced=(ensureGameEvent(g),ev.groups.length);
      const time=ev.groups[1].teeTime; const rm=document.querySelector('[data-grm]'); if(rm) rm.click(); const afterRemove=ev.groups.length;
      deleteGame(g); view.gameId=null; go('games'); return {before,after,afterMove,synced,afterRemove,time,hadRemove:!!rm}; }""")
    ok=r['before']==1 and r['after']==6 and r['afterMove']==6 and r['synced']==6 and r['hadRemove'] and r['afterRemove']==5 and r['time']=='08:20'
    print('placeholder groups stay', r, 'OK' if ok else 'FAIL'); bad+=not ok
    # an A-B-C draw for 3-man teams: the field is cut into three even handicap tiers and every team gets one from each, slot 1 = A
    r=await pg.evaluate("""()=>{ const idx={m0:'2.0',m1:'4.0',m2:'6.0',m3:'10.0',m4:'12.0',m5:'14.0',m6:'20.0',m7:'22.0',m8:'24.0'}; Object.entries(idx).forEach(([id,h],i)=>{ if(!personById(id)) CLUB.members.push({id,first:'P'+i,last:'Tier',hcp:h,status:'Active'}); });
      designGame(null); const d=GD.draft; d.pots=[]; const bb=newPot('bestball',d); bb.rules.teamSize=3; bb.rules.teamsBy='after'; d.pots.push(bb); Object.keys(idx).forEach(id=>addPlayer(d,{memberId:id})); render(); $('gdSave').click();
      const g=db.games[db.games.length-1]; view.gameId=g.id; go('games'); const ev=ensureGameEvent(g); const pot=g.pots[0];
      const tiers=drawTiers(evPlayers(ev).map(x=>x.p),3,p=>effIndex(ev,p).idx); const tierOf={}; tiers.forEach(t=>t.players.forEach(p=>{ tierOf[p.id]=t.letter; }));
      drawStage(g,pot); const sel=document.getElementById('dwM'); const opt=[...sel.options].find(o=>o.value==='abcd'); sel.value='abcd'; sel.dispatchEvent(new Event('change')); const shown=document.querySelectorAll('.dw-tier').length, label=opt&&opt.textContent; document.getElementById('dwClose').click();
      const teams=runDraw(g,pot,{method:'abcd',odd:'join'}); const byTeam=teams.map(t=>t.map(p=>tierOf[p.id]).join(''));
      deleteGame(g); view.gameId=null; go('games'); return {tiers:tiers.map(t=>t.letter+':'+t.players.length+':'+t.lo+'-'+t.hi), byTeam, shown, label, method:pot.draw&&pot.draw.method}; }""")
    ok=(r['tiers']==['A:3:2-6','B:3:10-14','C:3:20-24'] and sorted(r['byTeam'])==['ABC','ABC','ABC'] and r['shown']==3 and 'ABC draw' in (r['label'] or ''))
    print('A-B-C draw by handicap tier', r, 'OK' if ok else 'FAIL'); bad+=not ok
    # a big game (64 players, 16 groups) still prints on two pages — rules, then every group on one page; the groups image renders
    r=await pg.evaluate("""async()=>{ for(let i=0;i<64;i++) if(!personById('big'+i)) CLUB.members.push({id:'big'+i,first:'Player',last:'Number'+i,hcp:String(i%30),status:'Active'});
      designGame(null); const d=GD.draft; for(let i=0;i<64;i++) addPlayer(d,{memberId:'big'+i}); render(); $('gdSave').click(); const g=db.games[db.games.length-1]; view.gameId=g.id; go('games'); const ev=ensureGameEvent(g);
      const doc=await gameSheetPDF(g,{returnDoc:true}); const pages=doc.getNumberOfPages(), groups=ev.groups.length;
      let img=null; try{ const cv=await sheetImage(g,2,{returnCanvas:true}); img=cv?[cv.width,cv.height]:null; }catch(e){ img='err:'+e.message; }
      deleteGame(g); view.gameId=null; go('games'); return {pages,groups,img}; }""")
    ok=r['pages']==2 and r['groups']==16 and (isinstance(r['img'],list) and r['img'][0]>1000 or (isinstance(r['img'],str) and 'load' in r['img']))
    print('big game sheet: two pages, groups image', r, 'OK' if ok else 'FAIL'); bad+=not ok
    # pops on par 3s is per competition: the skins pot can switch it on while the stroke pot keeps the classic allocation
    r=await pg.evaluate("""()=>{ designGame(null); const d=GD.draft; d.pots.push(newPot('skins',d)); const sk=d.pots.find(p=>p.kind==='skins'); render();
      const box=document.getElementById('gdNP3_'+sk.id), other=document.getElementById('gdNP3_'+d.pots[0].id); box.checked=true; box.dispatchEvent(new Event('change'));
      $('gdSave').click(); const g=GAME()||db.games[db.games.length-1]; const s2=g.pots.find(p=>p.kind==='skins');
      const r={boxes:!!box&&!!other, skinsFlag:!!s2.rules.noPar3, strokeFlag:!!g.pots[0].rules.noPar3, compSk:potComp(g,s2).noPar3, compSt:potComp(g,g.pots[0]).noPar3, gameLevel:'noPar3' in g};
      deleteGame(g); return r; }""")
    ok=r['boxes'] and r['skinsFlag'] and not r['strokeFlag'] and r['compSk'] and not r['compSt'] and not r['gameLevel']
    print('no pops per competition', r, 'OK' if ok else 'FAIL'); bad+=not ok
    # the Pays editor: usual split by default, a place added from the last place, a dropdown change, back to the usual split; a bad total blocks Save
    r=await pg.evaluate("""()=>{ designGame(null); const d=GD.draft; d.pots.push(newPot('stroke',d)); render(); const pot=d.pots[d.pots.length-1]; const box=()=>document.querySelector(`[data-pays="${pot.id}"]`);
      if(!box()) return {diag:true, cards:document.querySelectorAll('.gd-pot').length, pays:[...document.querySelectorAll('[data-pays]')].map(x=>x.dataset.pays), potId:pot.id, pots:d.pots.map(p=>[p.id,p.kind,p.rules.game]), page:view.page, gdesign:view.gdesign, html:document.getElementById('main').innerText.slice(0,300)};
      const auto0=!!box().querySelector('.pays-auto'), rows0=box().querySelectorAll('[data-pl]').length;
      box().querySelector('[data-pladd]').click(); const afterAdd=pot.rules.places.slice();
      const sel=box().querySelector('[data-pl="0"]'); sel.value='60'; sel.dispatchEvent(new Event('change')); const afterSel=pot.rules.places.slice(), hint=box().querySelector('.hint').textContent;
      $('gdSave').click(); const blocked=!!GD;   // the designer stays open on a bad total
      const sel2=box().querySelector('[data-pl="1"]'); sel2.value=String(100-60-afterSel.slice(2).reduce((a,b)=>a+b,0)); sel2.dispatchEvent(new Event('change')); const fixed=pot.rules.places.slice();
      box().querySelector('[data-plauto]').click(); const backAuto=pot.rules.places.length===0&&!!box().querySelector('.pays-auto');
      GD=null; view.gdesign=null; go('games'); return {auto0,rows0,afterAdd,afterSel,hint,blocked,fixed,backAuto}; }""")
    ok=r['auto0'] and r['rows0']>=1 and len(r['afterAdd'])==r['rows0']+1 and sum(r['afterAdd'])==100 and r['afterSel'][0]==60 and 'make it 100%' in r['hint'] and r['blocked'] and sum(r['fixed'])==100 and r['backAuto']
    print('pays editor', r, 'OK' if ok else 'FAIL'); bad+=not ok
    r=await pg.evaluate("""()=>{ go('games'); designGame(null); const d=GD.draft; d.name='Friday game'; d.date='2026-05-01'; d.pots[0].entry=20; d.pots[0].rules.scoring='gross';
      const sk=newPot('skins',d,{entry:5}); sk.rules.skins={net:false,grossBeatsNet:false,validate:'none',mode:'pot'}; d.pots.push(sk); render(); const designer=!!document.getElementById('gdSave'); document.getElementById('gdSave').click();
      const g=GAME(); ['p0','p1','p2','p3','p4'].forEach(id=>{ const p=addPlayer(g,{memberId:id}); p.id='gp_'+id; g.pots.forEach(pot=>{ delete pot.inn[p.id]; }); }); const gu=addPlayer(g,{name:'Guest Gus'}); gu.id='gp_guest';
      g.players.forEach(p=>{ g.pots[0].inn[p.id]=true; if(!['gp_p4','gp_guest'].includes(p.id)) g.pots[1].inn[p.id]=true; }); g.players.forEach(p=>{ p.paid=p.id!=='gp_guest'; });
      // a dots pot for everyone and a blind-draw best ball for four, partners drawn after the round
      g.pots.push(newPot('dots',g,{entry:2})); const bd=newPot('blinddraw',null,{entry:5}); ['gp_p0','gp_p1','gp_p2','gp_p3'].forEach(id=>bd.inn[id]=true); g.pots.push(bd);
      openScoring(g); const ev=gameEvent(g); return {designer, nav:navItems().map(x=>x[0]), groups:ev.groups.map(x=>x.players.length), live:ev.status, pots:g.pots.map(p=>[p.kind,potTotal(g,p)]), total:gameMoney(g).total, by:bd.rules.teamsBy, evFormat:[ev.format,ev.teamSize], payWhen:g.payWhen, settle:g.settle}; }""")
    ok=r['designer'] and r['nav']==['dash','games','ledger','tournaments','golf','members'] and r['groups']==[4,2] and r['live']=='live' and r['pots']==[['format',120],['skins',20],['dots',12],['format',20]] and r['total']==172 and r['by']=='after' and r['evFormat']==['stroke',1] and r['payWhen']=='after' and r['settle']=='pot'
    print('group game + pots + scoring event', r, 'OK' if ok else 'FAIL'); bad+=not ok
    # scores: Ann 4s everywhere; Bo 4s but a 3 on hole 2 (outright skin) ; Cy/Di/Ed 5s; hole 7: Ann 3, Bo 3 (tie → carry), hole 8: Cy 3 outright → 2 skins with carry
    r=await pg.evaluate("""async()=>{ const g=GAME(), ev=gameEvent(g); const gp=id=>g.players.find(p=>p.id===id).gpid; const S=async(id,h,v)=>setScore(ev,gp(id),h,v);
      for(let h=1;h<=18;h++){ await S('gp_p0',h,h===7?3:4); await S('gp_p1',h,h===2?3:h===7?3:4); await S('gp_p2',h,h===8?3:5); await S('gp_p3',h,5); await S('gp_p4',h,5); await S('gp_guest',h,6); }
      const sk=skinsCalc(g,g.pots[1],{net:false,carry:true,validate:'none'}); const lb=eventBoard(publicEvent(ev),scoresFor(ev),{sort:'gross'}).map(r=>[r.name,r.pos,r.gross]);
      const potSk=skinsCalc(g,g.pots[1],{net:false,carry:false,validate:'none',mode:'pot'}); const potTxt=skinsRuleText(skinsRulesOf(newPot('skins',g)));
      const dots=dotsAuto(g,g.pots[2],dotsRules(g.pots[2])); return {skins:sk.wins.map(w=>[w.hole,w.name,w.count]), total:sk.total, lb, dots:['gp_p0','gp_p1','gp_p2','gp_p3'].map(id=>dots[id].birdies+'/'+dots[id].eagles), pot:[potSk.total,potSk.wins.map(w=>w.count)], potTxt}; }""")
    # hole 1 ties (carry 1) → Bo wins 2 on hole 2; holes 3–7 tie (carry 5) → Cy wins 6 on hole 8; the rest carry unpaid. Oak par 5-4-5-3…: Ann birdies 1, 3, 7, 12; Bo adds hole 2; Cy hole 8
    ok=(r['skins']==[[2,'Bo Baker',2],[8,'Cy Cole',6]] and r['total']==8 and r['lb'][0]==['Bo Baker',1,70] and r['lb'][1]==['Ann Able',2,71] and r['dots']==['4/0','5/0','1/0','0/0']
        and r['pot']==[2,[1,1]] and 'carry' not in r['potTxt'])   # pot skins: a skin is a skin, nothing carries
    print('skins + leaderboard + dots', r, 'OK' if ok else 'FAIL'); bad+=not ok
    # Export cards: one JSON with every card, the handicaps, the competitions' rules and the computed results
    r=await pg.evaluate("""()=>{ const g=seasonGames()[0]; if(!g) return {noGame:true}; const ev=ensureGameEvent(g); let got=null; const real=window.deliverFile; window.deliverFile=(b,n)=>{ got={n,b}; }; try{ exportGameCards(g); } finally { window.deliverFile=real; }
      if(!got) return {none:true}; return got.b.text().then(t=>{ const o=JSON.parse(t); return {name:got.n, cards:o.cards.length, players:g.players.length, comps:o.competitions.map(c=>[c.kind,!!c.computed]), hasCourses:!!o.event.courses, hasHoles:o.cards.some(c=>Object.keys(c.holes).length===18)}; }); }""")
    ok=not r.get('noGame') and not r.get('none') and r['name'].endswith('-cards.json') and r['cards']==r['players'] and all(c[1] for c in r['comps'] if c[0] in ('skins','format')) and r['hasCourses'] and r['hasHoles']
    print('export cards', r, 'OK' if ok else 'FAIL'); bad+=not ok
    r=await pg.evaluate("""async()=>{ const g=GAME(); const S=()=>document.getElementById('dSave').click(); payFormat(g,g.pots[0]); const pcts=document.getElementById('pfP').value; S(); paySkins(g,g.pots[1]); S();
      payDots(g,g.pots[2]); const di=document.querySelector('[data-dt="gp_p3|Sandy"]'); di.value='2'; di.dispatchEvent(new Event('input')); S();
      const beforeDraw=eventBoard(potPub(g,g.pots[3]),scoresFor(gameEvent(g)),{sort:'gross'}).filter(r=>r.n).length;   // individual standings until the draw
      const teams=runDraw(g,g.pots[3],{method:'random'}); const drawn=Object.assign({},g.pots[3].teams); const afterDraw=eventBoard(potPub(g,g.pots[3]),scoresFor(gameEvent(g)),{sort:'gross'}).filter(r=>r.n).length;
      const gpid=id=>g.players.find(p=>p.id===id).gpid; g.pots[3].teams={[gpid('gp_p0')]:'S1',[gpid('gp_p3')]:'S1',[gpid('gp_p1')]:'S2',[gpid('gp_p2')]:'S2'}; payFormat(g,g.pots[3]); const bdAmt=document.getElementById('pfAmt').value; S();
      const bd=g.pots[3], dv=Object.values(drawn), st=settlement(g);
      const by=id=>Math.round(gpOut(g,g.players.find(p=>p.id===id))*100)/100; go('ledger'); const rows=ledgerRows('season').map(r=>[r.name,r.games,r.inn,Math.round(r.out*100)/100,Math.round(r.net*100)/100]);
      return {pcts, ann:by('gp_p0'), bo:by('gp_p1'), cy:by('gp_p2'), di:by('gp_p3'), bdAmt, drawn:dv.length, drawnSides:new Set(dv).size, teams:teams.map(t=>t.length), beforeDraw, afterDraw, bdPay:bd.payouts.map(x=>[x.pid,x.amount]), left:Math.round(gameMoney(g).left*100)/100, rows,
        settle:st.rows.map(r=>[r.name,r.net]), transfers:st.transfers, tSum:Math.round(st.transfers.reduce((a,t)=>a+t.amount,0)*100)/100, draw:!!bd.draw&&bd.draw.method}; }""")
    # main 120 at 60/40: Bo 72, Ann 48; skins pot 20 ÷ 2 skins (Bo hole 2, Cy hole 8): 10 each; dots 12 over 12 dots (Ann 4, Bo 5, Cy 1, Di 2 sandies) at $1; blind draw 20: Bo/Cy best ball 70 beats Ann/Di 71 → 10 each
    ok=(r['pcts']=='60 / 40' and r['ann']==52 and r['bo']==97 and r['cy']==21 and r['di']==2 and r['bdAmt']=='20' and r['drawn']==4 and r['drawnSides']==2 and r['teams']==[2,2] and r['beforeDraw']==4 and r['afterDraw']==2 and r['draw']=='random' and sorted(r['bdPay'])==[['gp_p1',10],['gp_p2',10]]
        and r['left']==0 and r['rows'][0]==['Bo Baker',1,32,97,65] and r['rows'][-1]==['Di Dunn',1,32,2,-30]
        and r['settle'][0]==['Bo Baker',65] and r['settle'][-1]==['Di Dunn',-30] and r['tSum']==sum(x for _,x in r['settle'] if x>0) and all(t['amount']>0 for t in r['transfers']))
    # quiet skins: nothing live on the game page until the call-out, which walks the cards hole by hole
    r3=await pg.evaluate("""()=>{ const g=GAME(), pot=g.pots[1]; delete pot.calledOut; view.gameId=g.id; go('games'); const skinsShown=()=>[...document.querySelectorAll('.mini .mr b')].some(b=>/^Hole \d/.test(b.textContent)); const quiet=!!document.querySelector('[data-callout]')&&!skinsShown(); skinsCallout(g,pot);
      const ov=document.querySelector('.rf-show'); let n=0; while(document.getElementById('skNext')){ document.getElementById('skNext').click(); n++; } const lines=ov.querySelectorAll('.sk-line').length, won=ov.querySelectorAll('.sk-line.won').length, txt=ov.textContent; document.getElementById('skFin').click();
      const after=!!document.querySelector('[data-callout]')&&skinsShown(); return {quiet, n, lines, won, after, called:pot.calledOut, sum:txt.includes('2 skins')}; }""")
    ok=ok and r3['quiet'] and r3['n']==18 and r3['lines']==18 and r3['won']==2 and r3['after'] and r3['called'] and r3['sum']
    print('quiet skins + call-out', r3, 'OK' if r3['quiet'] and r3['lines']==18 and r3['won']==2 and r3['after'] else 'FAIL')
    # validation on the call-out: a won skin whose next hole fails flashes "Didn't validate" before that hole is shown
    r4=await pg.evaluate("""async()=>{ const g=GAME(), ev=gameEvent(g); const pot=newPot('skins',g,{entry:5}); pot.rules.skins={net:false,grossBeatsNet:false,validate:'par',mode:'pot'}; g.pots.push(pot); const gp=id=>g.players.find(p=>p.id===id).gpid;
      await setScore(ev,gp('gp_p1'),3,6);   // Bo bogeys hole 3 (par 5) after his birdie on 2 → the hole-2 skin doesn't validate
      skinsCallout(g,pot); const nxt=()=>document.getElementById('skNext'); nxt().click(); nxt().click();   // holes 1 and 2 shown
      const pend=document.querySelector('.sk-line.pending')&&document.body.textContent.includes('validates on hole 3');
      nxt().click(); const flash=document.querySelector('.sk-flash.bad'); const big=flash?flash.querySelector('.sk-flash-big').textContent:''; nxt().click();
      const after=[...document.querySelectorAll('.sk-line')].map(l=>l.className.replace('sk-line ','')); const voidTxt=document.body.textContent.includes('didn’t validate on hole 3');
      document.getElementById('skClose').click(); g.pots.pop(); await setScore(ev,gp('gp_p1'),3,4); return {pend, big, after, voidTxt}; }""")
    ok=ok and r4['pend'] and r4['big']=='Didn’t validate' and r4['after'][:3]==['muted','void','pending'] and r4['voidTxt']   # hole 3: Ann's 4 on the par 5 is a new skin, pending hole 4
    print('call-out validation flash', r4, 'OK' if r4['big']=='Didn’t validate' and r4['after'][:3]==['muted','void','pending'] else 'FAIL')
    # groups & handicaps on the game page: move a player, change a tee, set an index for the day → CH/PH follow
    r5=await pg.evaluate("""()=>{ const g=GAME(), ev=gameEvent(g); view.gameId=g.id; go('games'); const gp=id=>g.players.find(p=>p.id===id).gpid; const q=sel=>document.querySelector(sel);
      const before=ev.groups.map(x=>x.players.length); const mv=q(`[data-gmove="${gp('gp_p4')}"]`); mv.value=ev.groups[0].id; mv.dispatchEvent(new Event('change'));
      const after=gameEvent(g).groups.map(x=>x.players.length);
      const ix=q(`[data-gidx="${gp('gp_p0')}"]`); ix.value='10.0'; ix.dispatchEvent(new Event('change')); const g1=gameEvent(g).groups.find(x=>x.players.some(p=>p.id===gp('gp_p0'))); const p0=g1.players.find(p=>p.id===gp('gp_p0')); const h1=playerHcp(gameEvent(g),g1,p0);
      const te=q(`[data-gtee="${gp('gp_p0')}"]`); te.value='Gold'; te.dispatchEvent(new Event('change')); const h2=playerHcp(gameEvent(g),g1,g1.players.find(p=>p.id===gp('gp_p0')));
      const shown=q(`[data-gidx="${gp('gp_p0')}"]`).value; return {before, after, idx:p0.index, ch1:h1.ch, ph1:h1.ph, tee:p0.tee, ch2:h2.ch, shown}; }""")
    ok=ok and r5['before']==[4,2] and r5['after']==[5,1] and r5['idx']=='10.0' and r5['ch1'] is not None and r5['ph1'] is not None and r5['tee']=='Gold' and r5['ch2']>r5['ch1'] and r5['shown']=='10.0'
    print('groups & handicaps', r5, 'OK' if r5['after']==[5,1] and r5['tee']=='Gold' and r5['ch2']>r5['ch1'] else 'FAIL')
    # a challenge added mid-round: group v group reverse-waltz Nassau, teams = the groups, stakes 5/5/10, settled by segment
    r6=await pg.evaluate("""()=>{ const g=GAME(), ev=gameEvent(g); const pot=newPot('waltz321',g,{entry:20}); pot.rules.teamSize=3; g.pots.push(pot); const gp=id=>g.players.find(p=>p.id===id).gpid;
      // 3 v 3: Ann, Bo, Cy (group 1) against Di, Ed, Gus (groups 1/2) — teams by hand here, as the drawer's "Teams = the groups" would do by group
      pot.inn={}; ['gp_p0','gp_p1','gp_p2','gp_p3','gp_p4','gp_guest'].forEach(id=>pot.inn[id]=true); pot.teams={[gp('gp_p0')]:'S1',[gp('gp_p1')]:'S1',[gp('gp_p2')]:'S1',[gp('gp_p3')]:'S2',[gp('gp_p4')]:'S2',[gp('gp_guest')]:'S2'};
      const pub=potPub(g,pot), rows=eventBoard(pub,scoresFor(ev),{sort:pub.scoring}); payNassau(g,pot,rows); const prev=document.getElementById('pnPrev').textContent; document.getElementById('dSave').click();
      const out=Object.fromEntries(pot.payouts.map(x=>[x.pid,x.amount])); const sumOut=Math.round(pot.payouts.reduce((a,x)=>a+x.amount,0)*100)/100; g.pots.pop(); render();
      return {sides:rows.length, status:rows[0].status, entry:pot.entry, summary:potSummary(pot), sumOut, out, prev:prev.slice(0,160)}; }""")
    # Ann/Bo/Cy (4s, with birdies) beat Di/Ed/Gus (5s and 6s) on total score in every segment: the winners split 6 × 20 = 120, 40 each
    ok=ok and r6['sides']==2 and r6['entry']==20 and 'front $5' in r6['summary'] and r6['sumOut']==120 and all(abs(r6['out'].get(k,0)-40)<0.01 for k in ['gp_p0','gp_p1','gp_p2']) and __import__('re').match(r'^F [−+E]\S* · B [−+E]\S* · 18 [−+E]', r6['status'])
    print('mid-round team Nassau', r6, 'OK' if r6['sumOut']==120 and r6['sides']==2 else 'FAIL')
    # removing a player mid-round takes them out of every competition and the scoring event, scores and all
    r7=await pg.evaluate("""()=>{ const g=GAME(), ev=gameEvent(g); const p=g.players.find(x=>x.id==='gp_p4'), gpid=p.gpid; const before=evPlayers(ev).length, had=Object.keys(scoresFor(ev)[gpid]||{}).length; removePlayer(g,p); syncGameEvent(g,ev);
      const left=evPlayers(ev).some(x=>x.p.id===gpid), inPots=g.pots.some(pot=>pot.inn['gp_p4']), lb=eventBoard(publicEvent(ev),scoresFor(ev),{sort:'gross'}).some(r=>r.id===gpid), scores=Object.keys(scoresFor(ev)[gpid]||{}).length; view.gameId=g.id; go('games'); const btn=document.querySelectorAll('[data-gprm]').length;
      return {before, after:evPlayers(ev).length, left, inPots, lb, had, scores, players:g.players.length, btn}; }""")
    ok=ok and r7['before']==6 and r7['after']==5 and not r7['left'] and not r7['inPots'] and not r7['lb'] and r7['had']>0 and r7['scores']==0 and r7['players']==5 and r7['btn']==5
    print('remove a player mid-round', r7, 'OK' if r7['after']==5 and not r7['lb'] and r7['scores']==0 else 'FAIL')
    # the same from the designer: Cancel leaves the round alone, Save takes the player out of the event with their scores
    r7b=await pg.evaluate("""()=>{ const g=GAME(), ev=gameEvent(g); const p=g.players.find(x=>x.id==='gp_p3'), gpid=p.gpid; const had=Object.keys(scoresFor(ev)[gpid]||{}).length;
      designGame(g); const d=GD.draft; removePlayer(d,d.players.find(x=>x.id==='gp_p3'),{keepEvent:true}); const stillInEv=evPlayers(ev).some(x=>x.p.id===gpid), stillScored=Object.keys(scoresFor(ev)[gpid]||{}).length; $('gdCancel').click();
      const afterCancel={inGame:g.players.some(x=>x.id==='gp_p3'), inEv:evPlayers(ev).some(x=>x.p.id===gpid), scores:Object.keys(scoresFor(ev)[gpid]||{}).length};
      designGame(g); removePlayer(GD.draft,GD.draft.players.find(x=>x.id==='gp_p3'),{keepEvent:true}); $('gdSave').click();
      const afterSave={inGame:g.players.some(x=>x.id==='gp_p3'), inEv:evPlayers(ev).some(x=>x.p.id===gpid), scores:Object.keys(scoresFor(ev)[gpid]||{}).length, lb:eventBoard(publicEvent(ev),scoresFor(ev),{sort:'gross'}).some(r=>r.id===gpid)};
      return {had, stillInEv, stillScored, afterCancel, afterSave, players:g.players.length}; }""")
    ok7b=r7b['had']>0 and r7b['stillInEv'] and r7b['stillScored']==r7b['had'] and r7b['afterCancel']['inGame'] and r7b['afterCancel']['inEv'] and r7b['afterCancel']['scores']==r7b['had'] and not r7b['afterSave']['inGame'] and not r7b['afterSave']['inEv'] and r7b['afterSave']['scores']==0 and not r7b['afterSave']['lb'] and r7b['players']==4
    ok=ok and ok7b; print('remove a player from the designer', r7b, 'OK' if ok7b else 'FAIL')
    # what the live leaderboard carries: competitions marked live (skins only when switched on), with players and teams
    r8=await pg.evaluate("""()=>{ const g=GAME(), ev=gameEvent(g); const pub=publicEvent(ev); const names=pub.comps.map(c=>c.name); skinsRulesOf(g.pots[1]).live=true; g.pots[0].rules.live=false; const pub2=publicEvent(ev); const names2=pub2.comps.map(c=>c.name);
      const bd=pub2.comps.find(c=>c.format==='bestball'); const cp=compPub(pub2,bd); const rows=eventBoard(cp,scoresFor(ev),{sort:'gross'}).filter(r=>r.n); g.pots[0].rules.live=true; skinsRulesOf(g.pots[1]).live=false;
      return {names, names2, bdTeams:bd&&bd.teams?Object.keys(bd.teams).length:0, rows:rows.length, team:rows[0]&&rows[0].team}; }""")
    ok=ok and r8['names']==['Stroke play','Blind-draw partners'] and r8['names2']==['Skins','Blind-draw partners'] and r8['bdTeams']==3 and r8['rows']==2 and r8['team']
    print('live leaderboard competitions', r8, 'OK' if r8['names2']==['Skins','Blind-draw partners'] and r8['rows']==2 else 'FAIL')
    # the game sheet PDF and the designer round-trip
    r2=await pg.evaluate("""async()=>{ const g=GAME(); const doc=await gameSheetPDF(g,{returnDoc:true}); const n=doc.getNumberOfPages(); designGame(g); const names=GD.draft.pots.map(p=>p.name); const grid=document.querySelectorAll('[data-gdin]').length; document.getElementById('gdSave').click(); return {pages:n, names, grid, back:!!document.getElementById('gmSheet')}; }""")
    ok=ok and r2['pages']>=1 and len(r2['names'])==4 and r2['grid']==4*4 and r2['back']
    print('game sheet + designer', r2, 'OK' if r2['pages']>=1 and r2['grid']==16 else 'FAIL')   # 4 players left × 4 competitions
    print('payouts + ledger', r, 'OK' if ok else 'FAIL'); bad+=not ok
    print('  group errors', errs); bad+=bool(errs)
    await b.close()
  sys.exit(1 if bad else 0)
asyncio.run(main())
