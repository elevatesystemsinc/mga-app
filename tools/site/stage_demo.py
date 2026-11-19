"""Stage a fictional charity scramble (the Bushwood Caddie Classic) on the fake and capture every screen for the website — no real club or client appears."""
import asyncio,json,random,datetime,subprocess,os,sys
sys.path.insert(0,os.path.join(os.path.dirname(os.path.abspath(__file__)),'..','..','tests'))
from playwright.async_api import async_playwright
from _harness import FakeDB,cloud,page
OUT=os.environ.get('OUT','/tmp/site-shots/'); os.makedirs(OUT,exist_ok=True)
random.seed(11)
FIRST='James Michael Robert David William Richard Joseph Thomas Daniel Matthew Anthony Mark Steven Paul Andrew Kevin Brian George Timothy Ronald Jason Ryan Jacob Gary Nicholas Eric Jonathan Stephen Larry Justin Scott Brandon Benjamin Samuel Gregory Alexander Patrick Jack Dennis Jerry Tyler Aaron Jose Adam Nathan Henry Zachary Douglas Peter Kyle Noah Ethan Jeremy Christian Walter Keith Austin Roger Terry Sean Gerald Carl Harold Jordan Jesse Bryan Lawrence Arthur Gabriel Bruce Logan Vicki Sue Liz Dana'.split()
LAST='Abbott Archer Bannister Beck Bishop Blake Booth Bowen Brennan Briggs Caldwell Carver Chambers Chandler Clarke Conway Crane Dalton Dawson Dixon Donnelly Doyle Drake Ellis Emerson Farley Fletcher Foster Gallagher Garrett Gibson Granger Hanley Harmon Hayes Hendricks Holland Hooper Hughes Ingram Jennings Keane Keller Kirby Lambert Lennox Lowell Marsh Mason Maxwell Mercer Monroe Nolan Norris Osborne Parker Pierce Prescott Quigley Randall Reeve Rhodes Sawyer Sheridan Sinclair Sutton Thatcher Tierney Underwood Vaughn Walsh Whitfield Winslow Yates'.split()
COS=['Czervik Construction','Smails Holdings','Webb Industries','Noonan & Sons','Spaulding Capital','Gopher Pest Control','Lakeside Lumber','Harbor Point Bank','Fairway Insurance','Greenside Landscaping','Bluff Creek Realty','Northgate Title','Caddyshack Outfitters','Pinehurst Dental','Linksview Motors','Riverbend Brewing','Oakmont Orthopedics','Clubhouse Catering','Meadowlark Foods','Summit Roofing','Birdie Bakery','Shoreline Marine','Highland Printing','Eastgate Logistics','Sandtrap Software','Parkside Pediatrics','Ridgeway Electric','Timberline Homes','Quail Run Vineyards','Fox Hollow Farms']
TIERS=[('Title Sponsor',25000,4),('Presenting Sponsor',15000,4),('Eagle Sponsor',10000,4),('Birdie Sponsor',7500,4),('Par Sponsor',5000,4),('Foursome Sponsor',2500,4),('Beverage Cart Sponsor',2000,0),('Hole-in-One Sponsor',1500,0)]
PAR=[4,5,4,3,4,4,3,5,4,4,4,3,5,4,4,3,4,5]; HCP=[7,3,11,17,1,9,15,13,5,8,2,16,12,4,10,18,6,14]
Y=[412,538,398,176,441,387,164,551,409,433,372,191,527,446,418,158,401,544]
def course():
    return {'id':'bushwood','tenant':None,'name':'Bushwood Course','club':'Bushwood Country Club','city':'Bushwood','state':'IL','country':'US','holes':18,'status':'live','verified':True,'source':'scorecard','notes':None,'geo':None,
      'data':{'par':{'M':PAR,'W':PAR},'hcp':{'M':HCP,'W':HCP},'tees':[{'name':'Black','rating':{'M':{'cr':74.3,'slope':139}},'yards':Y},{'name':'Blue','rating':{'M':{'cr':72.0,'slope':133}},'yards':[int(y*0.955) for y in Y]},{'name':'White','rating':{'M':{'cr':69.9,'slope':128},'W':{'cr':75.6,'slope':137}},'yards':[int(y*0.905) for y in Y]}]}}
def people():
    out=[]; used=set()
    for i in range(72):
        while True:
            f,l=random.choice(FIRST),random.choice(LAST)
            if (f,l) not in used: used.add((f,l)); break
        out.append({'id':'m%02d'%i,'first':f,'last':l,'email':f.lower()+'@'+random.choice(COS).lower().replace(' ','')+'.com','status':'Active','hcp':str(round(random.uniform(2,22),1)),'city':random.choice(['Bushwood','Lakeview','Elmhurst','Glen Ellyn','Naperville','Oak Park','Evanston','Wheaton'])})
    return out
async def main():
    fdb=FakeDB()
    fdb.seed_tenant('caddies','Bushwood Caddie Scholarship Fund',modules={'golf':True,'pos':True,'events':True},plan='golf',kind='nonprofit')
    fdb._rows('tenants')[-1]['courses']=['bushwood']; fdb._rows('tenants')[-1]['short']='Caddie Fund'
    fdb._rows('courses').append(course())
    ppl=people()
    fdb.seed('mga_hub','club',{'v':2,'id':'club','kind':'club','name':'Bushwood Caddie Scholarship Fund','short':'Caddie Fund','members':ppl,'orgs':[],'activeSeason':'2026','seasons':{'2026':{}},'tournaments':[],'_rev':2,'_w':'x','_at':1},tenant='caddies')
    fdb.seed_login('ops@caddies.test','caddies','staff',name='Ops'); fdb.me='u-ops@caddies.test'; fdb.admin=False; fdb.user_tenants=['caddies']
    today=datetime.date.today().isoformat()
    async with async_playwright() as p:
        b=await p.chromium.launch()
        H=await b.new_context(viewport={'width':1440,'height':900},device_scale_factor=2); await cloud(H,fdb)
        hub=await H.new_page(); herr=[]; hub.on('pageerror',lambda e:herr.append(str(e)))
        await hub.goto(page('index.html')+'?org=club&tenant=caddies.flagstickhub.com'); await hub.wait_for_function("()=>cloudReady&&!!db",timeout=20000); await hub.wait_for_timeout(600)
        info=await hub.evaluate("""async(a)=>{ const [today,TIERS,COS]=a;
          const t=newTournament({season:today.slice(0,4),name:'Bushwood Caddie Classic',days:1,startDate:today,venue:'Bushwood Country Club',teamSize:4,entryFee:0,plannedPlayers:60});
          t.course='bushwood'; t.features=Object.assign({},NONPROFIT_FEATURES); t.status='Open for signups'; t.placesPaid=3; t.payoutNote='Trophies and donated gifts for the top three teams; closest-to-the-pin on 16 and long drive on 13.'; t.rules='Four-player scramble, one ball in play per shot\\nEach player must contribute at least three tee shots\\nMove the ball one club length, no closer to the hole; not out of a hazard\\nMaximum team score of net double bogey\\nShotgun start at 10:00am — be at your cart by 9:40';
          t.schedule=[{day:-1,items:[{id:uid(),time:'6:00pm',event:'Welcome reception',notes:'Sponsor check-in and cocktails at the clubhouse'}]},{day:0,items:[{id:uid(),time:'8:00am',event:'Registration & Breakfast'},{id:uid(),time:'10:00am',event:'Shotgun Start — 4-Man scramble'},{id:uid(),time:'3:30pm',event:'Cocktail Hour'},{id:uid(),time:'4:30pm',event:'Reception Dinner — awards, raffle, scholarship check presentation',notes:'Title and Presenting sponsors present the check to this year’s caddie scholars; dinner seating by tier.'}]}];
          t.tiers=TIERS.map(([name,amt,spots])=>({id:uid(),name,amt,spots}));
          const ms=persons();
          t.sponsors=COS.slice(0,18).map((co,i)=>{ const tier=t.tiers[Math.min(7,Math.floor(i/2.5))]; const paid=i%4!==3; return {id:uid(),company:co,contact:memberName(ms[i]),email:ms[i].email,phone:'',tier:tier.name,pledged:tier.amt,committee:'',notes:'',payments:paid?[{id:uid(),amount:tier.amt,method:i%2?'Check':'Credit card',date:today}]:[]}; });
          t.field=ms.slice(0,60).map((m,i)=>({id:uid(),memberId:m.id,team:Math.floor(i/4)+1,paid:true,skins:false,answers:{}}));
          db.tournaments.push(t); if(typeof fundForTournament==='function'){ const e=fundForTournament(t); e.goal=150000; e.date=today; }
          persist(); ensureTournamentScoring(t); const r=t.rounds[0]; Object.assign(r,engineFrom(catalogById('scramble'),4,1),{scoring:'net',front:'scramble',back:'scramble'}); const ev=roundEvent(r); roundToEvent(r,ev); ev.defaultTee='Blue'; persist(); publishEvent(ev);
          await new Promise(r=>setTimeout(r,400)); return {tid:t.id,evid:ev.id,slug:ev.slug}; }""",[today,TIERS,COS])
        tid,evid,slug=info['tid'],info['evid'],info['slug']
        # groups: the drawer, one team per cart, shotgun
        await hub.evaluate("(id)=>{ view.geid=id; view.getab='groups'; go('golf'); loadScores(GEV()); }",evid); await hub.wait_for_timeout(500)
        await hub.evaluate("(id)=>{ const ev=golfData().events.find(e=>e.id===id); buildGroupsFromField(ev); }",evid); await hub.wait_for_selector('#bgN')
        await hub.evaluate("()=>{ $('bgN').value='4'; $('bgS').value='shotgun'; $('dSave').click(); }"); await hub.wait_for_timeout(800)
        await hub.evaluate("(id)=>{ const ev=golfData().events.find(e=>e.id===id); ev.groups.forEach(g=>{ const t=(g.players[0]||{}).team||''; g.label='Team '+String(t).replace('T',''); }); golfSave(ev); }",evid); await hub.wait_for_timeout(600)
        # open registration + field photo
        await hub.evaluate("(tid)=>{ go('tournament',{tid,ttab:'field'}); }",tid); await hub.wait_for_timeout(500)
        await hub.evaluate("()=>{ const b=$('sgOpen'); if(b) b.click(); }"); await hub.wait_for_timeout(900)
        reg=await hub.evaluate("(tid)=>{ const t=db.tournaments.find(x=>x.id===tid); return t.reg&&t.reg.token; }",tid)
        # scores: the captains of each group, holes in play order, scramble numbers
        caps=await hub.evaluate("(id)=>{ const ev=golfData().events.find(e=>e.id===id); const pub=publicEvent(ev); return ev.groups.map(g=>{ const pg=pub.groups.find(x=>x.id===g.id); return {gid:g.id,code:g.code,start:+g.startHole||1,cap:groupTeams(pg)[0].captain.id,label:g.label}; }); }",evid)
        now=datetime.datetime.utcnow(); rows=fdb._rows('golf_scores')
        for i,g in enumerate(caps):
            n=[9,11,10,12,8,13,10,11,9,12,10,7,11,10,9][i%15]
            order=[((g['start']-1+k)%18)+1 for k in range(18)]
            for k,h in enumerate(order[:n]):
                par=PAR[h-1]; r=random.random(); s=par-1 if r<0.55 else par if r<0.9 else par-2 if r<0.96 else par+1
                rows.append({'event_id':evid,'player_id':g['cap'],'hole':h,'strokes':s,'updated_at':(now-datetime.timedelta(minutes=(n-k)*9)).isoformat()+'Z'})
        # ---- hub captures
        async def shot(name,full=False): await hub.wait_for_timeout(500); await hub.screenshot(path=OUT+name,full_page=full)
        await hub.evaluate("(tid)=>{ go('tournament',{tid,ttab:'overview'}); }",tid); await shot('01-overview.png')
        await hub.evaluate("()=>{ view.ttab='sponsors'; render(); }"); await shot('02-sponsors.png')
        await hub.evaluate("()=>{ view.ttab='field'; render(); }"); await shot('03-field.png')
        await hub.evaluate("()=>{ view.ttab='checkin'; render(); }"); await shot('04-checkin.png')
        await hub.evaluate("(id)=>{ view.geid=id; view.getab='groups'; go('golf'); loadScores(GEV()); }",evid); await hub.wait_for_timeout(800); await shot('05-groups.png')
        await hub.evaluate("()=>{ view.getab='board'; render(); }"); await hub.wait_for_timeout(800); await shot('06-hub-board.png')
        await hub.evaluate("(id)=>{ const ev=golfData().events.find(e=>e.id===id); const lb=document.querySelector('[data-lbg]'); if(lb) lb.click(); }",evid); await hub.wait_for_timeout(600); await shot('07-scorecard.png')
        await hub.evaluate("()=>{ closeDrawer(); }"); await hub.wait_for_timeout(300)
        await hub.evaluate("(tid)=>{ go('tournament',{tid,ttab:'rounds'}); }",tid); await hub.wait_for_timeout(900); await shot('08-rounds.png')
        # printed scorecards: the drawer's html, rendered in a page of its own
        html=await hub.evaluate("(id)=>{ const ev=golfData().events.find(e=>e.id===id), pub=publicEvent(ev); const gs=ev.groups.slice().sort((a,b)=>(+a.startHole-+b.startHole)); const cards=gs.slice(0,2).flatMap(g=>{ const pg=pub.groups.find(x=>x.id===g.id); return groupTeams(pg).map(t=>printCardHTML(ev,pub,g,t.key)); }); return `<!doctype html><html><head><meta charset='utf-8'><base href='${SITE_BASE}'><style>${PRINT_CSS} .bar{display:none}</style></head><body><div class='sheet two'>${cards.join('')}</div></body></html>`; }",evid)
        open(OUT+'cards.html','w').write(html); pr=await H.new_page(); await pr.goto('file://'+OUT+'cards.html'); await pr.wait_for_timeout(1200); await pr.screenshot(path=OUT+'09-cards.png',full_page=True)
        # results PDF
        async with hub.expect_download() as dl: await hub.evaluate("(tid)=>{ const t=db.tournaments.find(x=>x.id===tid); resultsPDF(t); }",tid)
        d=await dl.value; pdf=OUT+'results.pdf'; await d.save_as(pdf); subprocess.run(['pdftoppm','-png','-r','120','-f','1','-l','1',pdf,OUT+'10-results'],check=True)
        await hub.evaluate("()=>{ go('dash'); }"); await shot('11-dash.png')
        await hub.evaluate("()=>{ go('fund'); }"); await hub.wait_for_timeout(600); await shot('12-fund.png')
        # ---- public pages
        P=await b.new_context(viewport={'width':1440,'height':900},device_scale_factor=2); await cloud(P,fdb,no_session=True)
        rp=await P.new_page(); await rp.goto(page('register.html')+'?k='+reg); await rp.wait_for_timeout(1500); await rp.screenshot(path=OUT+'13-register.png'); await rp.screenshot(path=OUT+'13-register-full.png',full_page=True)
        tv=await P.new_page(); await tv.goto(page('score.html')+'?e='+slug+'&view=board'); await tv.wait_for_function("()=>!!pub&&document.querySelectorAll('.lb').length>1",timeout=15000); await tv.wait_for_timeout(600); await tv.screenshot(path=OUT+'14-tv-board.png')
        gc=await P.new_page(); await gc.goto(page('gamecast.html')+'?e='+slug); await gc.wait_for_timeout(5000); await gc.screenshot(path=OUT+'15-gamecast.png')
        try:
            await gc.evaluate("()=>{ const r=document.querySelector('[data-card]'); if(r) r.click(); }"); await gc.wait_for_timeout(600); await gc.screenshot(path=OUT+'16-gamecast-card.png')
        except Exception as e: print('gc card',e)
        # ---- phones
        M=await b.new_context(viewport={'width':390,'height':844},device_scale_factor=3,is_mobile=True,has_touch=True); await cloud(M,fdb,no_session=True)
        ph=await M.new_page(); await ph.goto(page('score.html')+'?e='+slug); await ph.wait_for_function("()=>!!pub&&!!document.getElementById('code')",timeout=15000); await ph.wait_for_timeout(400); await ph.screenshot(path=OUT+'20-phone-join.png')
        g=caps[3]; await ph.fill('#code',g['code']); await ph.click('#joinBtn'); await ph.wait_for_function("()=>groupId&&tab==='score'",timeout=15000); await ph.wait_for_timeout(800); await ph.evaluate("()=>{ const b=[...document.querySelectorAll('button')].find(x=>x.textContent.trim()==='16'); if(b) b.click(); }"); await ph.wait_for_timeout(500); await ph.screenshot(path=OUT+'21-phone-score.png')
        await ph.evaluate("()=>{ tab='card'; render(); }"); await ph.wait_for_timeout(500); await ph.screenshot(path=OUT+'22-phone-card.png',full_page=True)
        await ph.evaluate("()=>{ tab='board'; loadScores().then(render); }"); await ph.wait_for_timeout(1200); await ph.screenshot(path=OUT+'23-phone-board.png')
        print('errors',herr[:3]); print(json.dumps({'slug':slug,'reg':reg,'groups':len(caps)}))
        await b.close()
asyncio.run(main())
