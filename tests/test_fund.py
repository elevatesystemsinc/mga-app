"""The nonprofit feature set against the fake: the portal creates a nonprofit client (type → plan + modules), its hub opens on
Fundraising, an event is built (tickets, a guest with a paddle, silent items, a lot, a raffle), the event page is published,
two phones join and bid (minimum raise, outbid, buy now, an RSVP), bidding closes, the hub records the live sale, a gift and a
raffle draw, checkout settles a paddle and prints the acknowledgement, and the money adds up."""
import asyncio,sys,json,os,re,datetime
from playwright.async_api import async_playwright
from _harness import FakeDB,cloud,page,JSPDF
def check(label,ok,r,errs=None):
    print(('OK  ' if ok else 'FAIL'),label,r,errs or ''); return 0 if ok else 1
async def open_page(ctx,q,ready="()=>cloudReady"):
    pg=await ctx.new_page(); errs=[]; pg.on('pageerror',lambda e:errs.append(str(e)))
    await pg.goto(page('index.html')+q)
    try: await pg.wait_for_function(ready,timeout=15000)
    except Exception: pass
    await pg.wait_for_timeout(400); return pg,errs
async def main():
    bad=0; fdb=FakeDB()
    fdb.seed_tenant('wccc','Walnut Creek Country Club',modules={'golf':True,'club':True},plan='club',kind='private')
    fdb.seed('mga_hub','club',{'v':2,'id':'club','kind':'club','name':'Walnut Creek Country Club','short':'WCCC','members':[],'orgs':[],'activeSeason':'2026','seasons':{'2026':{}},'tournaments':[],'_rev':2,'_w':'x','_at':1})
    fdb.seed_login('zach@flagstick.test',admin=True,name='Zach'); fdb.me='u-zach@flagstick.test'; fdb.admin=True
    async with async_playwright() as p:
        b=await p.chromium.launch()
        # ---- 1. the portal: a new client of type nonprofit
        c1=await b.new_context(); await cloud(c1,fdb); pp,ep=await open_page(c1,'?portal=1',ready="()=>PS.tenants&&PS.tenants.length")
        r=await pp.evaluate("""async()=>{ PS.view='clients'; vPortal(document.getElementById('main')); document.getElementById('ptNew').click(); await new Promise(r=>setTimeout(r,100)); const kinds=[...document.getElementById('ptKind').options].map(o=>o.textContent);
          const k=document.getElementById('ptKind'); k.value='nonprofit'; k.dispatchEvent(new Event('change')); await new Promise(r=>setTimeout(r,50)); const boxes={}; document.querySelectorAll('[data-modd]').forEach(c=>boxes[c.dataset.modd]=c.checked); const plan=document.getElementById('ptPlan').dataset.val, hint=k.closest('.fld').querySelector('.hint').textContent;
          document.getElementById('ptN').value='Hope Foundation'; document.getElementById('ptS').value='Hope'; document.getElementById('ptSlug').value='hope'; document.getElementById('dSave').click(); await new Promise(r=>setTimeout(r,700)); return {kinds, boxes, plan, hint}; }""")
        T=next((t for t in fdb._rows('tenants') if t['slug']=='hope'),None); club=fdb.get('mga_hub','club',tenant='hope')
        bad+=check('portal: New client asks the type; nonprofit sets Golf management + Fundraising events; the tenant row carries kind and modules, the club document exists',r['kinds'][:5]==['Private country club','Country club','Semi-private golf club','Municipal course','Nonprofit organization'] and r['boxes']=={'golf':True,'pos':False,'club':False,'events':True} and r['plan']=='golf' and 'Galas' in r['hint'] and T and T['kind']=='nonprofit' and T['modules']=={'golf':True,'events':True} and club and club['name']=='Hope Foundation' and not ep,(r,T and T['modules']),ep)
        await c1.close()
        # the directory the gala draws on, and a staff login for the foundation
        club['members']=[{'id':'p1','first':'Ann','last':'Able','email':'ann@x.org','phone':'555-0001','status':'Active'},{'id':'p2','first':'Bo','last':'Baker','email':'bo@x.org','status':'Active'}]; fdb.seed('mga_hub','club',club,tenant='hope')
        fdb.seed_login('dir@hope.org','hope','staff',name='Director'); fdb.me='u-dir@hope.org'; fdb.admin=False; fdb.user_tenants=['hope']
        # ---- 2. the hub: Fundraising first, Donors & guests; an event built end to end
        c2=await b.new_context(); await cloud(c2,fdb); p1,e1=await open_page(c2,'?org=club&tenant=hope.flagstickhub.com')
        r=await p1.evaluate("()=>({kind:clientKind(), np:isNonprofit(), nav:navItems().map(x=>x[0]), label:navItems().find(x=>x[0]==='members')[1], secs:[...document.querySelectorAll('#nav .navsec')].map(b=>b.textContent.trim()).slice(0,2), fund:fundOn(), billing:acctOn()})")
        bad+=check('the foundation’s hub: nonprofit kind, Fundraising first on the rail, Directory reads Donors & guests, no member billing',r['kind']=='nonprofit' and r['np'] and 'fund' in r['nav'] and r['label']=='Donors & guests' and r['secs'][0]=='Fundraising' and r['fund'] and not r['billing'] and not e1,r,e1)
        today=datetime.date.today().isoformat()
        r=await p1.evaluate("""async(today)=>{ go('fund'); await new Promise(r=>setTimeout(r,200)); document.getElementById('fdNew').click(); await new Promise(r=>setTimeout(r,100)); document.getElementById('feN').value='Harvest Gala'; document.getElementById('feD').value=today; document.getElementById('feG').value='50000'; document.getElementById('feV').value='The ballroom'; document.getElementById('dSave').click(); await new Promise(r=>setTimeout(r,300));
          const e=fundEvent(view.fid); ticketTypeDrawer(e,null); document.getElementById('ttN').value='Seat'; document.getElementById('ttP').value='150'; document.getElementById('ttF').value='60'; document.getElementById('dSave').click(); await new Promise(r=>setTimeout(r,200));
          guestDrawer(e,null); const q=document.getElementById('guQ'); q.value='Ann'; q.dispatchEvent(new Event('input')); await new Promise(r=>setTimeout(r,50)); document.querySelector('[data-pp="p1"]').click(); document.getElementById('dSave').click(); await new Promise(r=>setTimeout(r,200));
          itemDrawer(e,null); document.getElementById('siN').value='A week in Cabo'; document.getElementById('siV').value='2000'; document.getElementById('siS').value='500'; document.getElementById('dSave').click(); await new Promise(r=>setTimeout(r,200));
          itemDrawer(e,null); document.getElementById('siN').value='Signed ball'; document.getElementById('siV').value='300'; document.getElementById('siS').value='100'; document.getElementById('siB').value='400'; document.getElementById('dSave').click(); await new Promise(r=>setTimeout(r,200));
          silentSettingsDrawer(e); document.getElementById('ssR').value='25'; document.getElementById('dSave').click(); await new Promise(r=>setTimeout(r,200));
          lotDrawer(e,null); document.getElementById('ltN').value='Dinner for eight'; document.getElementById('ltV').value='1000'; document.getElementById('dSave').click(); await new Promise(r=>setTimeout(r,200));
          raffleDrawer(e,null); document.getElementById('rfN').value='Wine pull'; document.getElementById('rfP').value='20'; document.getElementById('rfZ').value='Case of wine × $300'; document.getElementById('dSave').click(); await new Promise(r=>setTimeout(r,200));
          await fundPublish(e); await new Promise(r=>setTimeout(r,400)); return {page:view.page, name:e.name, tickets:e.tickets.map(t=>[t.name,t.price,t.fmv]), guest:e.guests.map(g=>[guestName(g),g.paddle,g.email]), items:e.silent.items.map(i=>[i.no,i.name,i.start,i.buyNow]), minRaise:e.silent.minRaise, lots:e.lots.length, raffles:e.raffles.map(r=>[r.name,r.price,r.prizes.map(p=>[p.name,p.value])]), token:!!e.token, link:fundLink(e)}; }""",today)
        sh=[s for s in fdb._rows('fund_share') if s['fid']];
        bad+=check('an event with a ticket type, Ann as guest #101, two silent items, a lot, a raffle; published to the event page',r['page']=='fundev' and r['tickets']==[['Seat',150,60]] and r['guest']==[['Ann Able',101,'ann@x.org']] and r['items']==[[1,'A week in Cabo',500,0],[2,'Signed ball',100,400]] and r['minRaise']==25 and r['lots']==1 and r['raffles']==[['Wine pull',20,[['Case of wine',300]]]] and r['token'] and 'auction.html?k=' in r['link'] and len(sh)==1 and sh[0]['tenant']=='hope' and sh[0]['doc']['silent']['items'][0]['name']=='A week in Cabo',(r,len(sh)))
        TOKEN=r['link'].split('k=')[1]; FID=sh[0]['fid']; IT1=sh[0]['doc']['silent']['items'][0]['id']; IT2=sh[0]['doc']['silent']['items'][1]['id']
        # ---- 3. two phones on the event page
        async def phone():
            c=await b.new_context(viewport={'width':390,'height':800}); await cloud(c,fdb); pg=await c.new_page(); errs=[]; pg.on('pageerror',lambda e:errs.append(str(e))); pg.on('dialog',lambda d:asyncio.ensure_future(d.accept()))
            await pg.goto(page('auction.html')+'?k='+TOKEN); await pg.wait_for_function("()=>!!E",timeout=10000); await pg.wait_for_timeout(200); return c,pg,errs
        ca,pa,ea=await phone(); cb,pb,eb=await phone()
        r=await pa.evaluate("""async(it)=>{ const title=document.getElementById('hTitle').textContent, tabs=[...document.querySelectorAll('[data-tab]')].map(b=>b.textContent); document.querySelector('[data-tab="silent"]').click(); document.getElementById('jnN').value='Pat Pike'; document.getElementById('jnP').value='555-0101'; document.getElementById('jnE').value='pat@x.org'; document.getElementById('jnGo').click(); await new Promise(r=>setTimeout(r,500));
          const me=document.getElementById('hMe').textContent; const inp=document.querySelector('[data-bi="'+it+'"]'); const min=inp.value; inp.value='500'; document.querySelector('[data-bb="'+it+'"]').click(); await new Promise(r=>setTimeout(r,500)); const cur=document.querySelector('#it-'+it+' .cur').textContent; return {title, tabs, me, min, cur, paddle:ME.paddle}; }""",IT1)
        bad+=check('phone A: the evening, tickets, the silent auction; joins as paddle #500, the opening bid is pre-filled, bids $500 on Cabo',r['title']=='Harvest Gala' and r['tabs'][0]=='The evening' and 'Tickets' in r['tabs'][1] and r['me']=='Pat Pike · paddle #500' and r['min']=='500' and r['cur']=='$500' and r['paddle']==500 and not ea,r,ea)
        r=await pb.evaluate("""async(a)=>{ document.querySelector('[data-tab="silent"]').click(); document.getElementById('jnN').value='Quinn Quist'; document.getElementById('jnP').value='555-0102'; document.getElementById('jnGo').click(); await new Promise(r=>setTimeout(r,500)); const paddle=ME.paddle;
          let inp=document.querySelector('[data-bi="'+a.it1+'"]'); const min=inp.value; inp.value='510'; document.querySelector('[data-bb="'+a.it1+'"]').click(); await new Promise(r=>setTimeout(r,500)); const low=[...document.querySelectorAll('.toast')].map(t=>t.textContent).join(' ');
          inp=document.querySelector('[data-bi="'+a.it1+'"]'); inp.value='525'; document.querySelector('[data-bb="'+a.it1+'"]').click(); await new Promise(r=>setTimeout(r,500)); const cur=document.querySelector('#it-'+a.it1+' .cur').textContent, lead=document.querySelector('#it-'+a.it1+' .chip.ok')&&document.querySelector('#it-'+a.it1+' .chip.ok').textContent;
          document.querySelector('[data-bn="'+a.it2+'"]').click(); await new Promise(r=>setTimeout(r,600)); const bought=document.querySelector('#it-'+a.it2).textContent.includes('Sold at buy now'); return {paddle, min, low, cur, lead, bought}; }""",{'it1':IT1,'it2':IT2})
        bad+=check('phone B: paddle #501; $510 is refused (minimum raise $25 → at least $525); $525 takes the lead; buys the signed ball at $400',r['paddle']==501 and r['min']=='525' and 'at least $525' in r['low'] and r['cur']=='$525' and r['lead']=='You are the high bidder' and r['bought'] and not eb,r,eb)
        r=await pa.evaluate("""async(it)=>{ await load(); document.querySelector('[data-tab="mine"]').click(); const out=document.querySelector('.item.out')&&document.querySelector('.item.out .chip').textContent; document.querySelector('[data-tab="tickets"]').click(); document.getElementById('rvN').value='Pat Pike'; document.getElementById('rvE').value='pat@x.org'; document.getElementById('rvQ').value='2'; document.getElementById('rvGo').click(); await new Promise(r=>setTimeout(r,500)); return {out, thanks:document.querySelector('#main .card').textContent.slice(0,40)}; }""",IT1)
        rs=[x for x in fdb._rows('fund_rsvps') if x['fid']==FID]
        bad+=check('phone A sees it has been outbid, and reserves two seats from the Tickets tab',r['out']=='Outbid' and r['thanks'].startswith('Thank you, Pat Pike') and len(rs)==1 and rs[0]['qty']==2 and rs[0]['status']=='pending',(r,rs and rs[0]['name']))
        # ---- 4. the hub: the RSVP accepted, the live sale, a gift, the raffle draw, bidding closed
        r=await p1.evaluate("""async()=>{ const e=fundEvent(view.fid); await fundLoad(e,true); view.ftab='guests'; render(); await new Promise(r=>setTimeout(r,200)); const rsvpRow=!!document.querySelector('[data-ra]'); document.querySelector('[data-ra]').click(); await new Promise(r=>setTimeout(r,400));
          const pat=e.guests.find(g=>g.name==='Pat Pike'); window.confirm=()=>true; soldDrawer(e,e.lots[0]); document.getElementById('sdP').value='101'; document.getElementById('sdA').value='1500'; document.getElementById('dSave').click(); await new Promise(r=>setTimeout(r,200));
          donationDrawer(e); document.getElementById('dnP').value='101'; document.getElementById('dnA').value='250'; document.getElementById('dSave').click(); await new Promise(r=>setTimeout(r,200));
          raffleSellDrawer(e,e.raffles[0]); document.getElementById('rsP').value='500'; document.getElementById('rsN').value='5'; document.getElementById('dSave').click(); await new Promise(r=>setTimeout(r,200)); await raffleDraw(e,e.raffles[0]); await new Promise(r=>setTimeout(r,2600)); const ov=document.querySelector('.rf-show'); const ovTxt=ov&&ov.textContent; if(ov) ov.remove();
          view.ftab='silent'; render(); await new Promise(r=>setTimeout(r,200)); const highs=[...document.querySelectorAll('[data-si] .lnet')].map(x=>x.textContent); document.getElementById('saClose').click(); await new Promise(r=>setTimeout(r,600));
          const w=silentWins(e); return {rsvpRow, pat:pat&&[pat.paddle,pat.qty,pat.ticketId===e.tickets[0].id], lot:e.lots[0].sold, don:e.donations.map(d=>[d.paddle,d.amount]), tix:e.raffles[0].tickets.map(t=>[t.paddle,t.from,t.to]), winner:e.raffles[0].prizes[0].winner, log:e.raffles[0].log.length, ovTxt:(ovTxt||'').slice(0,60), highs, closed:e.silent.closed, wins:w.map(x=>[x.item.name,x.amount,x.paddle])}; }""")
        bad+=check('hub: the RSVP becomes guest #102 with two seats; the lot sold to #101 for $1,500; a $250 paddle raise; five raffle tickets to #500 and the drawing picks one of them; bidding closed with Cabo to #501 at $525 and the ball at $400',r['rsvpRow'] and r['pat']==[102,2,True] and r['lot']['paddle']==101 and r['lot']['amount']==1500 and r['don']==[[101,250]] and r['tix']==[[500,1,5]] and r['winner'] and r['winner']['paddle']==500 and 1<=r['winner']['ticket']<=5 and r['log']==1 and 'Wine pull' in r['ovTxt'] and r['highs']==['$525.00','$400.00'] and r['closed'] and r['wins']==[['A week in Cabo',525,501],['Signed ball',400,501]],r)
        r=await pb.evaluate("""async(it)=>{ await load(); let err=''; try{ await rpc('fund_bid',{p_bidder:ME.id,p_item:it,p_amount:600}); }catch(e){ err=e.message; } document.querySelector('[data-tab="mine"]').click(); const chips=[...document.querySelectorAll('.item .chip')].map(c=>c.textContent); return {err, chips, note:document.querySelector('#main .card').textContent.includes('Congratulations')}; }""",IT1)
        bad+=check('after close a bid is refused and phone B sees both items as won',r['err']=='Bidding is closed' and r['chips']==['Won','Won'] and r['note'],r)
        # ---- 5. checkout and the money
        r=await p1.evaluate("""async()=>{ const e=fundEvent(view.fid); view.ftab='checkout'; render(); await new Promise(r=>setTimeout(r,200)); const rows=[...document.querySelectorAll('[data-cp]')].map(x=>[+x.dataset.cp,x.querySelector('.lnet').textContent]); const t501=paddleTotals(e,501), t101=paddleTotals(e,101), t500=paddleTotals(e,500), t102=paddleTotals(e,102);
          checkoutDrawer(e,501); document.getElementById('cpA').value='925'; document.getElementById('cpM').value='Credit card'; document.getElementById('dSave').click(); await new Promise(r=>setTimeout(r,300)); const after=paddleTotals(e,501);
          expenseDrawer(e,null); document.getElementById('exN').value='Catering'; document.getElementById('exA').value='500'; document.getElementById('dSave').click(); await new Promise(r=>setTimeout(r,200)); const S=fundTotals(e);
          return {rows, t501:[t501.owed,t501.fmv,t501.lines.map(l=>l.kind)], t101:[t101.owed,t101.lines.map(l=>l.kind)], t500:[t500.owed], t102:[t102.owed], after:[after.paid,after.due], S}; }""")
        S=r['S']
        bad+=check('checkout: #501 owes $925 (Cabo + the ball, FMV $2,300), #101 owes $1,900 (seat, the lot, the gift), #500 owes $100 of raffle tickets, #102 owes two seats; $925 on a card settles #501; the money: tickets 450, silent 925, live 1,500, raffles 100, gifts 250 = 3,225 raised, net 2,725 after catering',r['t501']==[925,2300,['silent','silent']] and r['t101']==[1900,['ticket','live','donation']] and r['t500']==[100] and r['t102']==[300] and r['after']==[925,0] and S['tickets']==450 and S['silent']==925 and S['live']==1500 and S['raffles']==100 and S['donations']==250 and S['raised']==3225 and S['expenses']==500 and S['net']==2725 and S['paid']==925,r)
        if os.path.exists(JSPDF):
            async with p1.expect_download() as dl: await p1.evaluate("()=>fundReceiptPDF(fundEvent(view.fid),101)")
            d=await dl.value; pdf=open(await d.path(),'rb').read()
            bad+=check('the acknowledgement PDF for paddle #101',d.suggested_filename.startswith('acknowledgement-') and pdf[:4]==b'%PDF',d.suggested_filename)
        r=await p1.evaluate("()=>{ const e=fundEvent(view.fid); return {page:fundPub(e).silent.closed, raffleWinnerOnPage:fundPub(e).raffles[0].prizes[0].winner.paddle}; }")
        bad+=check('the page’s copy carries the closed auction and the raffle winner',r['page'] and r['raffleWinnerOnPage']==500,r)
        await ca.close(); await cb.close(); await c2.close(); await b.close()
    print('ALL OK' if not bad else f'{bad} FAILED'); sys.exit(1 if bad else 0)
asyncio.run(main())
