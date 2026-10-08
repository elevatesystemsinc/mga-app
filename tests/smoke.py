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
        # a member added in the association lands in the club directory + this organization's memberships; the drawer opens on the view
        r=await pg.evaluate("""()=>{ const p=upsertMember(null,{first:'Ada',last:'Lovelace',email:'ada@x.org',status:'Active',joined:'2026-01-01',notes:'hi'}); persist();
          const v=memberById(p.id); go('members'); editMember(v); const open=drawerOpen(); closeDrawer();
          return {inDir:!!CLUB.members.find(x=>x.id===p.id), personHasNotes:'notes' in CLUB.members.find(x=>x.id===p.id), ms:db.memberships.find(m=>m.id===p.id), view:[v.first,v.status,v.notes], count:members().length, open}; }""")
        ok=r['inDir'] and not r['personHasNotes'] and r['ms']['status']=='Active' and r['view']==['Ada','Active','hi'] and r['count']==1 and r['open']
        print('member add via association', r, 'OK' if ok else 'FAIL'); bad+=not ok
        r=await pg.evaluate("()=>{ removeMember(members()[0].id); return {dir:CLUB.members.length, ms:db.memberships.length}; }")
        ok=r=={'dir':1,'ms':0}; print('remove from association keeps the person', r, 'OK' if ok else 'FAIL'); bad+=not ok
      if org=='club':
        r=await pg.evaluate("""()=>{ go('orgs'); editOrg(null,'group'); document.getElementById('ogN').value='The Misfits'; document.getElementById('ogS').value='Misfits'; document.getElementById('dSave').click();
          const o=CLUB.orgs.find(x=>x.id==='misfits'); db=null; render(); const cards=[...document.querySelectorAll('[data-org]')].map(b=>b.dataset.org); return {o, cards}; }""")
        ok=r['o'] and r['o']['kind']=='group' and r['cards']==['club','mga','lga','smga','misfits']
        print('new small group + picker', r, 'OK' if ok else 'FAIL'); bad+=not ok
      print('  errors after checks', errs); bad+=bool(errs)
    await b.close()
  sys.exit(1 if bad else 0)
asyncio.run(main())
