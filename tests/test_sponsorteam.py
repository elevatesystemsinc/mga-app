"""Sponsorship packages that include a team: TBD seats in the field (local mode). Run: python3 tests/test_sponsorteam.py
A tier says how many players it includes; a sponsor on it gets a team in the field with TBD in every seat — counted in the field and
the budget, shown as TBD with the sponsor's name, kept out of check-in and the registration page's open spots; naming a player fills a
seat, a smaller package drops only the unnamed seats, removing the sponsor removes its TBD seats."""
import asyncio,sys,json
from playwright.async_api import async_playwright
from _harness import local,page
async def main():
  bad=0
  def check(name,cond,info=''):
    nonlocal bad; print(('OK   ' if cond else 'FAIL ')+name,info); bad+=(not cond)
  async with async_playwright() as p:
    b=await p.chromium.launch(); pg=await b.new_page(); errs=[]; pg.on('pageerror',lambda e:errs.append(str(e)))
    await local(pg); await pg.goto(page('index.html')+'?org=mga'); await pg.wait_for_timeout(600)
    r=await pg.evaluate("""()=>{ try{ const t=newTournament({season:Y(),name:'Charity Open',days:1,startDate:Y()+'-06-01',venue:'',teamSize:4}); t.budgetBasis='field'; t.entryFee=0; t.features=Object.assign({},t.features,{sponsors:true}); t.tiers=[{id:'t1',name:'Title',amt:50000,spots:4},{id:'t2',name:'Hole',amt:1000,spots:0}]; db.tournaments.push(t);
      editSponsor(t,null); document.getElementById('sCo').value='Forgent Power'; document.getElementById('sTier').value='Title'; document.getElementById('sTier').dispatchEvent(new Event('change')); const hint=document.getElementById('sSpots').textContent; document.getElementById('dSave').click();
      const s=t.sponsors[0], team=t.field.filter(p=>p.sponsorId===s.id); view.tid=t.id; view.ttab='field'; go('tournament',{tid:t.id,ttab:'field'});
      const txt=document.getElementById('main').textContent.replace(/\\s+/g,' '); return {hint, n:t.field.length, tbd:team.filter(p=>p.tbd).length, teamNo:team[0]&&team[0].team, paid:team.every(p=>p.paid), players:playersUsed(t), tbdShown:(txt.match(/TBD/g)||[]).length, spName:txt.includes('Forgent Power'), kpi:txt.includes('0 named · 4 TBD'), rev:tcalc(t).pledged}; }catch(e){ return {err:String(e),stack:String(e.stack).slice(0,500)}; } }""")
    check('a Title sponsor (4 players) gets a team of four TBD seats at once: counted as players, no entry owed, shown as TBD with the sponsor’s name on the Field tab',r['n']==4 and r['tbd']==4 and r['teamNo']==1 and r['paid'] and r['players']==4 and r['tbdShown']>=4 and r['spName'] and r['kpi'] and 'includes 4 players' in r['hint'],json.dumps(r))
    r=await pg.evaluate("""()=>{ const t=db.tournaments.find(x=>x.name==='Charity Open'); const mid=upsertMember(null,{first:'Pat',last:'Pike',status:'Active'},{noBill:true}); const m=memberById(mid)||members()[0]; editTeam(t,1); const banner=document.getElementById('dBody').textContent.includes('package includes 4 players'); document.getElementById('tmM0').value=m.id; document.getElementById('tmM0').dispatchEvent(new Event('change')); document.getElementById('dSave').click();
      const team=t.field.filter(p=>(p.team||0)===1); view.ttab='sponsors'; render(); const sp=document.getElementById('main').textContent.replace(/\\s+/g,' ');
      return {banner, n:team.length, named:team.filter(p=>!p.tbd).length, tbd:team.filter(p=>p.tbd).length, sponsorKept:team.every(p=>p.sponsorId===t.sponsors[0].id), chip:/Team 1 · 1 of 4 named/.test(sp), pub:signupPub(t).teams.map(x=>[x.names.filter(n=>n==='TBD').length,x.open]), checkin:typeof ckRows==='function'?ckRows(t).length:null}; }""")
    check('naming one player from the team editor fills a seat and keeps the other three TBD; the Sponsors tab reads "Team 1 · 1 of 4 named"; the registration copy shows TBD seats with no open spots',r['banner'] and r['n']==4 and r['named']==1 and r['tbd']==3 and r['sponsorKept'] and r['chip'] and r['pub']==[[3,0]],json.dumps(r)[:400])
    r=await pg.evaluate("""()=>{ const t=db.tournaments.find(x=>x.name==='Charity Open'); t.tiers[0].spots=2; sponsorTeamSync(t,t.sponsors[0]); const after2=t.field.filter(p=>(p.team||0)===1).map(p=>!!p.tbd);
      t.tiers[0].spots=4; sponsorTeamSync(t,t.sponsors[0]); const back=t.field.length; const rows=(t.field||[]).filter(p=>!p.tbd).length;
      editSponsor(t,t.sponsors[0]); document.getElementById('dDel').click(); const gone=t.sponsors.length===0, left=t.field.map(p=>[!!p.tbd,!!p.memberId]); return {after2, back, rows, gone, left}; }""")
    check('a smaller package drops only the TBD seats (the named player stays); back to four refills; removing the sponsor removes its TBD seats and keeps the person',r['after2']==[False,True] and r['back']==4 and r['rows']==1 and r['gone'] and r['left']==[[False,True]],json.dumps(r))
    # teams sold whole (Tournament details → Open seats: TBD): every open seat counts, reads TBD, and the registration copy offers no open spots
    r=await pg.evaluate("""()=>{ const t=db.tournaments.find(x=>x.name==='Charity Open'); const m=members()[0]; t.field=[{id:'x1',memberId:m.id,team:5,paid:false,skins:false,answers:{}}]; t.tbdSeats=false; const off={seats:fieldSeats(t),players:playersUsed(t),open:signupPub(t).teams[0].open};
      t.tbdSeats=true; view.ttab='field'; render(); const txt=document.getElementById('main').textContent.replace(/\\s+/g,' '); const pub=signupPub(t).teams[0];
      editTournament(t); const sel=document.getElementById('eTbd').value; closeDrawer(); return {off, seats:fieldSeats(t), players:playersUsed(t), tbdShown:(txt.match(/TBD/g)||[]).length, kpi:/1 named · 3 TBD/.test(txt), pub:[pub.open,pub.tbd], sel}; }""")
    check('a team of one with Open seats = TBD counts four players (one named, three TBD), shows TBD in the seats and no open spots on the registration page; Open leaves one',r['off']=={'seats':1,'players':1,'open':3} and r['seats']==4 and r['players']==4 and r['tbdShown']>=3 and r['kpi'] and r['pub']==[0,3] and r['sel']=='tbd',json.dumps(r))
    check('no page errors',not errs,str(errs)[:300])
    await b.close()
  sys.exit(1 if bad else 0)
asyncio.run(main())
