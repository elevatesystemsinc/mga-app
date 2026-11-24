"""The guided demo (src/tour.js): a hub opened with ?demo=1 runs every chapter — the steps open their pages and find their
elements, the tour hops to the first association's and the first member group's hubs and back, the QR steps carry a link,
the keys drive it, and the position survives a reload (?demo=go). Local mode, a small club with an MGA and a Thursday game."""
import asyncio, sys, os
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _harness import local, page
from playwright.async_api import async_playwright
async def main():
    bad=0
    async with async_playwright() as p:
        b=await p.chromium.launch(); pg=await b.new_page(viewport={'width':1366,'height':860}); errs=[]; pg.on('pageerror',lambda e:errs.append(str(e)))
        await local(pg); await pg.goto(page('index.html')+'?org=club'); await pg.wait_for_timeout(500)
        await pg.evaluate("""()=>{ CLUB.orgs.push({id:'misfits',kind:'group',name:'The Misfits',short:'Misfits'}); ['Ty Webb 4.1','Bo Baker 12.0','Cy Cole 20.3','Di Dunn 8.8','Ed Eng 15.0','Flo Fox 9.9'].forEach((x,i)=>{ const [f,l,h]=x.split(' '); CLUB.members.push({id:'p'+i,first:f,last:l,hcp:h,email:f.toLowerCase()+'@example.com',status:'Active',billing:{class:'full',status:'active'}}); }); persist(); }""")
        await pg.goto(page('index.html')+'?org=mga'); await pg.wait_for_timeout(400)
        await pg.evaluate("""()=>{ for(let i=0;i<6;i++) db.memberships.push({id:'p'+i,status:'Active',joined:'',notes:''}); const t=newTournament({name:'Member-Member',season:'2026',startDate:'2026-06-12',days:2,teamSize:2}); t.features.calcutta=true; db.tournaments.push(t); persist(); }""")
        await pg.goto(page('index.html')+'?org=misfits'); await pg.wait_for_timeout(400)
        await pg.evaluate("""()=>{ for(let i=0;i<6;i++) db.memberships.push({id:'p'+i,status:'Active',joined:'',notes:''}); designGame(null); const d=GD.draft; d.date=new Date().toISOString().slice(0,10); for(let i=0;i<6;i++) addPlayer(d,{memberId:'p'+i}); $('gdSave').click(); const g=db.games[db.games.length-1]; ensureGameEvent(g); persist(); }""")
        # 1. the whole tour, step by step, with the arrow key
        await pg.goto(page('index.html')+'?org=club&demo=1'); await pg.wait_for_timeout(1500)
        rows=[]; hops=set()
        for n in range(80):
            st=await pg.evaluate("()=>TOUR.on?{i:TOUR.i,n:TOUR.steps.length,t:TOUR.steps[TOUR.i].t,org:TOUR.steps[TOUR.i].org,page:view.page,target:!!(TOUR.target&&document.contains(TOUR.target)),qr:!!document.getElementById('tourQR'),card:!!document.getElementById('tourCard'),here:ORG_ID}:null")
            if st is None:
                await pg.wait_for_timeout(1500)
                st=await pg.evaluate("()=>TOUR.on?{i:TOUR.i,n:TOUR.steps.length,t:TOUR.steps[TOUR.i].t,org:TOUR.steps[TOUR.i].org,page:view.page,target:!!(TOUR.target&&document.contains(TOUR.target)),qr:!!document.getElementById('tourQR'),card:!!document.getElementById('tourCard'),here:ORG_ID}:null")
                if st is None: print('FAIL tour not running at step', n, pg.url); bad+=1; break
            rows.append(st); hops.add(st['here'])
            if st['i']==st['n']-1: break
            await pg.keyboard.press('ArrowRight'); await pg.wait_for_timeout(700)
        n=rows[-1]['n'] if rows else 0
        found=sum(1 for r in rows if r['target']); qrs=[r['t'] for r in rows if r['qr']]
        ok=len(rows)==n and n>=30 and hops=={'club','mga','misfits'} and found>=n-3 and all(r['card'] for r in rows) and any('portal' in t.lower() for t in qrs) and any('scoring' in t.lower() for t in qrs)
        print('the tour: every step, three hubs, targets found, QR steps', {'steps':n,'walked':len(rows),'hubs':sorted(hops),'targets':found,'qr':qrs}, 'OK' if ok else 'FAIL'); bad+=not ok
        # 2. Back, the chapter picker, End
        r=await pg.evaluate("""async()=>{ tourGo(0); await new Promise(r=>setTimeout(r,300)); document.getElementById('tourNext').click(); await new Promise(r=>setTimeout(r,300)); const after=TOUR.i; document.getElementById('tourBack').click(); await new Promise(r=>setTimeout(r,300)); const back=TOUR.i;
          document.getElementById('tourChapters').click(); const chips=document.querySelectorAll('[data-tch]').length; document.querySelector('[data-tch="2"]').click(); await new Promise(r=>setTimeout(r,400)); const ch=TOUR.chapters[TOUR.steps[TOUR.i].ci].title, pg2=view.page;
          const saved=JSON.parse(localStorage.getItem(TOUR_KEY())||'null'); return {after, back, chips, ch, pg2, saved:saved&&saved.i}; }""")
        ok=r['after']==1 and r['back']==0 and r['chips']>=8 and r['ch']=='Food & beverage' and r['pg2']=='pos' and r['saved']==r['saved'] and r['saved']>1
        print('next, back, the chapter picker, the position remembered', r, 'OK' if ok else 'FAIL'); bad+=not ok
        # 3. a reload with ?demo=go resumes where it was; ?demo=1 starts over; no demo = no tour
        await pg.goto(page('index.html')+'?org=club&demo=go'); await pg.wait_for_timeout(1800)
        r1=await pg.evaluate("()=>({on:TOUR.on,i:TOUR.i,page:view.page})")
        await pg.goto(page('index.html')+'?org=club&demo=1'); await pg.wait_for_timeout(1800)
        r2=await pg.evaluate("()=>({on:TOUR.on,i:TOUR.i})")
        await pg.evaluate("()=>{ window.confirm=()=>true; document.getElementById('tourEnd').click(); }"); await pg.wait_for_timeout(200)
        r3=await pg.evaluate("()=>({on:TOUR.on,box:!!document.getElementById('tourBox'),saved:localStorage.getItem(TOUR_KEY())})")
        await pg.goto(page('index.html')+'?org=club'); await pg.wait_for_timeout(1200)
        r4=await pg.evaluate("()=>({on:TOUR.on,card:!!document.getElementById('tourCard')})")
        ok=r1['on'] and r1['i']>1 and r1['page']=='pos' and r2['on'] and r2['i']==0 and not r3['on'] and not r3['box'] and r3['saved'] is None and not r4['on'] and not r4['card']
        print('resume, restart, end, and no tour without ?demo', r1, r2, r3, r4, 'OK' if ok else 'FAIL'); bad+=not ok
        print('errors', errs); bad+=bool(errs)
        await b.close()
    print('ALL OK' if not bad else f'{bad} FAILED'); sys.exit(1 if bad else 0)
asyncio.run(main())
