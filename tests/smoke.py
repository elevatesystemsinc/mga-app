"""Opens every page and fails on any script error. Run: python3 tests/smoke.py"""
import asyncio,sys
from playwright.async_api import async_playwright
from _harness import local,page
async def main():
  bad=0
  async with async_playwright() as p:
    b=await p.chromium.launch()
    for name,check in [('index.html',"()=>!!document.getElementById('nav')"),('cashier.html',"()=>!!document.getElementById('main')"),('checkin.html',"()=>!!document.getElementById('main')"),('score.html',"()=>document.body.innerText.length>0")]:
      pg=await b.new_page(); errs=[]; pg.on('pageerror',lambda e,errs=errs:errs.append(str(e))); await local(pg)
      await pg.goto(page(name)); await pg.wait_for_timeout(700); ok=await pg.evaluate(check)
      print(f'{name:14} rendered={ok} errors={errs}'); bad+= (not ok) or bool(errs)
    # every hub page and tournament tab renders
    pg=await b.new_page(); errs=[]; pg.on('pageerror',lambda e:errs.append(str(e))); await local(pg); await pg.goto(page('index.html')); await pg.wait_for_timeout(700)
    await pg.evaluate("""()=>{ db.tournaments.push(Object.assign({id:'T1',name:'Member-Member',season:Y(),days:3,field:[],sponsors:[],tiers:[],income:[],perPlayer:[],lines:[],dayItems:[[],[],[]],actuals:{},schedule:[],decisions:[]})); persist(); }""")
    for v in ['dashboard','tournaments','golf','members','board','treasury','season']: await pg.evaluate(f"()=>go('{v}')"); await pg.wait_for_timeout(80)
    tabs=await pg.evaluate("()=>{ go('tournament',{tid:'T1'}); return TT.map(x=>x[0]); }")
    for tb in tabs: await pg.evaluate(f"()=>{{ view.ttab='{tb}'; render(); }}"); await pg.wait_for_timeout(80)
    print('hub pages + tournament tabs',tabs,'errors',errs); bad+=bool(errs)
    await b.close()
  sys.exit(1 if bad else 0)
asyncio.run(main())
