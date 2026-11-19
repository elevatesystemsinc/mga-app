"""A tournament's schedule spans any number of days (local mode). Run: python3 tests/test_schedule.py
The reception the evening before, the golf, the awards dinner the night after — on a one-day tournament, through the drawer's date
box; the Overview groups them by day in date order with the items sorted by time; the registration copy carries the same days."""
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
    r=await pg.evaluate("""()=>{ const t=newTournament({season:Y(),name:'Open',days:1,startDate:Y()+'-04-20',venue:'',teamSize:4}); db.tournaments.push(t); go('tournament',{tid:t.id,ttab:'overview'});
      const add=(date,time,ev)=>{ document.getElementById('schAdd').click(); document.getElementById('sDate').value=date; document.getElementById('sTime').value=time; document.getElementById('sEvent').value=ev; document.getElementById('dSave').click(); };
      add(Y()+'-04-20','4:00pm','Awards reception'); add(Y()+'-04-19','6:00pm','Welcome dinner'); add(Y()+'-04-20','8:00am','Registration'); add(Y()+'-04-21','7:30pm','Sponsor dinner'); add(Y()+'-04-20','10:00am','Shotgun start');
      const txt=document.getElementById('main').textContent.replace(/\\s+/g,' ');
      const order=['Welcome dinner','Registration','Shotgun start','Awards reception','Sponsor dinner'].map(x=>txt.indexOf(x));
      const heads=[...document.querySelectorAll('.gh b')].map(x=>x.textContent);
      const pub=signupPub(t).schedule.map(d=>[d.day,d.label,d.items.map(i=>i.time)]);
      return {days:t.schedule.map(d=>d.day).sort(), order, sorted:order.every((v,i)=>i===0||v>order[i-1]), heads, pub}; }""")
    check('five items on three dates around a one-day tournament: days −1, 0, 1; the card reads Day before · Day 1 · Day after in date order, items by time',
      r['days']==[-1,0,1] and r['sorted'] and r['heads'][0].endswith('Day before') and r['heads'][1].endswith('Day 1') and r['heads'][2].endswith('Day after'),json.dumps(r)[:500])
    check('the registration copy carries the three days with the items in time order',r['pub']==[[-1,r['heads'][0],['6:00pm']],[0,r['heads'][1],['8:00am','10:00am','4:00pm']],[1,r['heads'][2],['7:30pm']]],json.dumps(r['pub']))
    r=await pg.evaluate("""()=>{ const t=db.tournaments.find(x=>x.name==='Open'); const row=[...document.querySelectorAll('[data-sch]')].find(x=>x.textContent.includes('Welcome dinner')); row.click(); const was=document.getElementById('sDate').value; document.getElementById('sDate').value=Y()+'-04-18'; document.getElementById('dSave').click();
      const heads=[...document.querySelectorAll('.gh b')].map(x=>x.textContent); return {was, heads, days:t.schedule.filter(d=>d.items.length).map(d=>d.day).sort()}; }""")
    check('editing an item moves it to another date: the drawer opens on its date and the card reads "2 days before"',r['was'].endswith('-04-19') and r['heads'][0].endswith('2 days before') and r['days']==[-2,0,1],json.dumps(r))
    check('no page errors',not errs,str(errs)[:300])
    await b.close()
  sys.exit(1 if bad else 0)
asyncio.run(main())
