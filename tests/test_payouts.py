import asyncio,json,sys,os
sys.path.insert(0,os.path.dirname(os.path.abspath(__file__)))
from _harness import local,page
from playwright.async_api import async_playwright
async def main():
  async with async_playwright() as p:
    b=await p.chromium.launch(); ctx=await b.new_context(viewport={'width':1400,'height':950},accept_downloads=True); errs=[]
    pg=await ctx.new_page(); pg.on('pageerror',lambda e:errs.append(str(e))); pg.on('dialog',lambda d: asyncio.ensure_future(d.accept()))
    
    
    
    await local(pg)
    await pg.goto(page('index.html')); await pg.wait_for_timeout(800)
    # a tournament with a Calcutta: Flight 1 has 6 teams, Flight 2 has 3; buy-in on (team owns 25%)
    await pg.evaluate("""()=>{
      const t=normalize({tournaments:[{id:'T1',name:'Member-Member',season:'2026',days:3}]}).tournaments?.[0]||{id:'T1',name:'Member-Member',season:'2026',days:3};
      db.tournaments.push(Object.assign({field:[],sponsors:[],tiers:[],income:[],perPlayer:[],lines:[],dayItems:[[],[],[]],actuals:{},schedule:[],decisions:[]},t));
      const tt=db.tournaments.at(-1);
      tt.calcutta={minBid:250,payout:[40,30,20,10],pool:{bidderId:'',price:0},buyIn:{on:true,pct:25,amount:300,prebuyExtra:900},expenses:[],
        bidders:[{id:'B1',num:'101',name:'Shane Hensley',memberId:''},{id:'B2',num:'102',name:'Jacob Addie',memberId:''}],lots:[]};
      const L=(lot,p1,p2,fl,extra)=>tt.calcutta.lots.push(Object.assign({id:'L'+lot,lot,p1,p2,flight:fl,price:0,bidderId:'',cap:0,capSet:true},extra||{}));
      // Flight 1: 6 × 300 buy-in = 1,800 + auction 8,200 = net 10,000
      L(1,'Ann Able','Bo Able','1',{price:3000,bidderId:'B1'}); L(2,'Cy Cole','Di Cole','1',{price:2000,bidderId:'B2'});
      L(3,'Ed Eng','Flo Eng','1',{price:1200,bidderId:'B1'}); L(4,'Gus Gee','Hal Gee','1',{price:1000,bidderId:'B2'});
      L(5,'Ike Ito','Jo Ito','1',{price:1000,bidderId:'B1'}); L(6,'Kay Kim','Lu Kim','1',{prebuy:true});
      // Flight 2: 3 × 300 = 900 + 4,100 = 5,000 (lot 9 pre-bought: +900 → 5,900)
      L(7,'Mo Moe','Ned Moe','2',{price:2600,bidderId:'B1'}); L(8,'Oz Orr','Pat Orr','2',{price:1500,bidderId:'B2'}); L(9,'Quin Qi','Ray Qi','2',{prebuy:true});
      persist(); go('tournament',{tid:tt.id,ttab:'calcutta'}); view.ccTab='payouts'; render(); }""")
    print('payouts tab before any results:',(await pg.inner_text('.cc-pane[data-pane="payouts"]')).replace('\n',' | ')[:260])
    await pg.click('[data-cctab-go="results"]'); await pg.wait_for_timeout(200); print('button jumps to:',await pg.evaluate("()=>[...document.querySelectorAll('.cc-pane')].filter(p=>!p.hidden).map(p=>p.dataset.pane)"))
    print('sub-tabs:',await pg.eval_on_selector_all('[data-cctab]','e=>e.map(x=>x.innerText.replace(/\\s+/g," "))'))
    print('flight nets:',await pg.evaluate("()=>calcPayouts(calc(T())).flights.map(f=>[f.flight,f.net,f.money])"))
    async def setp(lot,place):
        await pg.select_option(f'[data-po="L{lot}"]',str(place)); await pg.wait_for_timeout(120)
    # Flight 1: two tied for 1st, one 3rd, three tied for 4th (4th is the last paid place)
    for lot,pl in [(1,1),(2,1),(3,3),(4,4),(5,4),(6,4)]: await setp(lot,pl)
    # Flight 2: three-way tie for 1st
    for lot in (7,8,9): await setp(lot,1)
    print('results tab: finish boxes',await pg.evaluate("()=>document.querySelectorAll('.cc-pane[data-pane=\"results\"] [data-po]').length"),'| none on payouts tab:',await pg.evaluate("()=>!document.querySelector('.cc-pane[data-pane=\"payouts\"] [data-po]')"))
    await pg.screenshot(path=os.devnull+'.png' if False else '/tmp/'+'po.png',full_page=True)
    await pg.click('[data-cctab="payouts"]'); await pg.wait_for_timeout(200)
    print('payouts tab now:',(await pg.inner_text('.cc-pane[data-pane="payouts"] .grid')).replace('\n',' | '),'| tabs:',await pg.eval_on_selector_all('[data-cctab]','e=>e.map(x=>x.innerText.replace(/\\s+/g," "))'))
    P=await pg.evaluate("()=>{ const P=calcPayouts(calc(T())); return {f:P.flights.map(f=>({flight:f.flight,rows:f.rows.map(r=>[r.lot.lot,r.label,r.amount]),paid:f.paid,unplaced:f.unplaced.map(x=>x.place)})),people:P.people.map(p=>[p.name,p.num,p.total,p.items.map(i=>`L${i.lot.lot} ${i.pct}% ${i.amount}`)]),total:P.total}; }")
    for f in P['f']: print(f"{f['flight']}:",f['rows'],'| paid',f['paid'],'| unentered',f['unplaced'])
    for p in P['people']: print('  ',p)
    print('total paid out:',P['total'])
    print('tie notes:',(await pg.evaluate("()=>[...document.querySelectorAll('.po-note')].map(x=>x.innerText)")))
    await pg.screenshot(path=os.devnull+'.png' if False else '/tmp/'+'po.png',full_page=True)
    # payouts by person: expand, mark paid
    await pg.click('[data-pox]'); await pg.wait_for_timeout(150)
    print('expanded:',(await pg.inner_text('.bid-item.open .bid-detail')).replace('\n',' | ')[:300])
    k=await pg.evaluate("()=>document.querySelector('[data-pop]').dataset.pop"); await pg.select_option(f'[data-pop="{k}"]','Check'); await pg.wait_for_timeout(150)
    print('paid out:',await pg.evaluate("()=>calc(T()).paidOut"),'| header:',await pg.evaluate("()=>[...document.querySelectorAll('.cardhead .muted')].pop().innerText"))
    await pg.screenshot(path=os.devnull+'.png' if False else '/tmp/'+'po.png',full_page=True)
    async with pg.expect_download() as dl: await pg.click('#ccExp')
    await (await dl.value).save_as('/tmp/po_test.xlsx'); print('export saved')
    print('errors',errs); await b.close()
asyncio.run(main())
