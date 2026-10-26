"""Member accounts & billing against the fake database (billing-setup.sql semantics). Run: python3 tests/test_billing.py
A staff login of a club with the billing module posts charges, records a payment, voids an item with a reason, puts
dues on account from Dues collection (once, however often it is clicked), runs statements and gets the PDF; a second
staff device reads the same ledger; a board login never sees Member accounts; a club without the module has no nav
item and the page sends them to the dashboard."""
import asyncio,sys,json,os
from playwright.async_api import async_playwright
from _harness import FakeDB,cloud,page,JSPDF
def club_doc(name,orgs):
    return {'v':2,'id':'club','kind':'club','name':name,'short':name.split()[0],'members':[{'id':'p1','first':'Ann','last':'Able','email':'ann@x.org','status':'Active'}],'orgs':orgs,'activeSeason':'2026','seasons':{'2026':{}},'tournaments':[],'_rev':3,'_w':'x','_at':1}
def org_doc(id,name,short,kind='association'):
    return {'v':2,'id':id,'kind':kind,'name':name,'short':short,'memberships':[],'activeSeason':'2026','seasons':{'2026':{}},'tournaments':[],'_rev':2,'_w':'x','_at':1}
async def open_page(ctx,q,ready="()=>cloudReady",hash=''):
    pg=await ctx.new_page(); errs=[]; pg.on('pageerror',lambda e:errs.append(str(e)))
    await pg.goto(page('index.html')+q+hash)
    try: await pg.wait_for_function(ready,timeout=15000)
    except Exception: pass
    await pg.wait_for_timeout(400); return pg,errs
def check(label,ok,r,errs=None):
    print(('OK  ' if ok else 'FAIL'),label,r,errs or ''); return 0 if ok else 1
def ledger(fdb): return [r for r in fdb._rows('acct_items')]
async def main():
  bad=0
  fdb=FakeDB()
  fdb.seed_tenant('wccc','Walnut Creek Country Club',{'golf':True,'billing':True},hosts=['app.wcccmga.org'],login_email='pro@wccc.org',plan='club')
  fdb.seed_tenant('pines','The Pines Golf Club',{'golf':True},login_email='gm@pines.org',plan='golf')
  club=club_doc('Walnut Creek Country Club',[{'id':'mga','kind':'association','name':'Men’s Golf Association','short':'MGA'}])
  club['members']+=[{'id':'p2','first':'Bo','last':'Baker','memberNo':'1042','status':'Active'},{'id':'p3','first':'Cy','last':'Cole','status':'Active'}]
  fdb.seed('mga_hub','club',club)
  mga=org_doc('mga','Men’s Golf Association','MGA'); mga['memberships']=[{'id':'p1','status':'Active','joined':'','notes':''},{'id':'p2','status':'Active','joined':'','notes':''}]
  mga['seasons']['2026']={'dues':{'amount':120,'installments':1,'autoBill':True},'duesCharges':[{'id':'dc1','memberId':'p1','amount':120,'desc':'2026 dues','date':'2026-10-01','status':'open'},{'id':'dc2','memberId':'p2','amount':120,'desc':'2026 dues','date':'2026-10-01','status':'open'}],'duesPayments':[]}
  fdb.seed('mga_hub','mga',mga)
  fdb.seed('mga_hub','club',club_doc('The Pines Golf Club',[]),tenant='pines')
  fdb.seed_login('pro@wccc.org','wccc','staff',name='Head Pro'); fdb.seed_login('office@wccc.org','wccc','staff',name='Office')
  fdb.seed_login('mgaboard@x.org','wccc','org',['mga'],manage=True,name='MGA President'); fdb.seed_login('gm@pines.org','pines','staff',name='GM')
  async with async_playwright() as pw:
    b=await pw.chromium.launch()
    # ---- 1. staff: the nav item, the empty page, post a charge and a payment, the account page with a running balance
    fdb.me='u-pro@wccc.org'
    c1=await b.new_context(accept_downloads=True); await cloud(c1,fdb)
    p1,e1=await open_page(c1,'?org=club&tenant=app.wcccmga.org')
    r=await p1.evaluate("""async()=>{ const nav=[...document.querySelectorAll('#nav [data-go]')].map(b=>b.dataset.go); go('accounts'); await new Promise(r=>setTimeout(r,600));
      const empty=document.querySelector('#main .empty b')?.textContent; const kpis=[...document.querySelectorAll('#main .kpi .v')].map(x=>x.textContent);
      document.getElementById('acCharge').click(); document.getElementById('apM').value='p2'; document.getElementById('apA').value='48.50'; document.getElementById('apS').value='proshop'; document.getElementById('apN').value='Dozen Pro V1'; document.getElementById('dSave').click(); await new Promise(r=>setTimeout(r,400));
      const onAccount=view.page==='account'&&view.acctId==='p2'; const bal1=document.querySelector('#main .kpi .v').textContent;
      document.getElementById('acCharge2').click(); document.getElementById('apA').value='30'; document.getElementById('apS').value='fnb'; document.getElementById('apN').value='Grill · Oct 12'; document.getElementById('dSave').click(); await new Promise(r=>setTimeout(r,400));
      document.getElementById('acPay2').click(); document.getElementById('apA').value='50'; document.getElementById('apS').value='check'; document.getElementById('apR').value='#4471'; document.getElementById('dSave').click(); await new Promise(r=>setTimeout(r,400));
      const rows=[...document.querySelectorAll('#main .lg .lr')].map(r=>[r.querySelector('.ln').textContent.trim(), r.querySelector('.lnet').textContent]);
      return {nav, empty, kpis, onAccount, bal1, rows, bal:document.querySelector('#main .kpi .v').textContent}; }""")
    bad+=check('staff: Member accounts in the nav, empty page, a charge lands on the member’s account',r['nav'].index('accounts')>r['nav'].index('collections') and r['empty']=='Nothing here' and r['kpis'][0]=='$0.00' and r['onAccount'] and r['bal1']=='$48.50 owing' and not e1,r,e1)
    bad+=check('account page: newest first with a running balance, the payment with its check number',r['rows']==[['Payment','$28.50'],['Grill · Oct 12','$78.50'],['Dozen Pro V1','$48.50']] and r['bal']=='$28.50 owing',r['rows'])
    rows=ledger(fdb)
    bad+=check('rows in acct_items carry the tenant, the kind, the method and who posted',len(rows)==3 and all(x['tenant']=='wccc' and x['member_id']=='p2' and x['created_by']=='board@test' for x in rows) and sorted(x['kind'] for x in rows)==['charge','charge','payment'] and next(x for x in rows if x['kind']=='payment')['method']=='check' and next(x for x in rows if x['kind']=='payment')['reference']=='#4471',[(x['kind'],x['source'],x['amount']) for x in rows])
    # ---- 2. void needs a reason and stays on the record; the balance moves
    p1.on('dialog',lambda d:asyncio.ensure_future(d.accept('Charged twice')))
    r=await p1.evaluate("""async()=>{ const b=[...document.querySelectorAll('[data-void]')].find(x=>document.querySelectorAll('[data-void]').length&&x); const grill=[...document.querySelectorAll('#main .lr')].find(r=>r.textContent.includes('Grill')); grill.querySelector('[data-void]').click(); await new Promise(r=>setTimeout(r,400));
      const v=[...document.querySelectorAll('#main .lr.void')].map(r=>r.querySelector('.ls').textContent); return {v, bal:document.querySelector('#main .kpi .v').textContent, left:document.querySelectorAll('[data-void]').length}; }""")
    row=next(x for x in ledger(fdb) if 'Grill' in x['descr'])
    bad+=check('void: a reason, the row stays struck through, the balance moves, the database row keeps it',len(r['v'])==1 and 'Charged twice' in r['v'][0] and r['bal']=='$1.50 credit' and r['left']==2 and row['void_at'] and row['void_reason']=='Charged twice',r)
    # ---- 3. dues collection → the account, once
    r=await p1.evaluate("""async()=>{ go('collections'); await new Promise(r=>setTimeout(r,300)); document.querySelector('[data-ch="dc1"]').click(); await new Promise(r=>setTimeout(r,500));
      document.getElementById('clCharge').click(); await new Promise(r=>setTimeout(r,800)); view.cfilter='charged'; render(); document.querySelector('[data-co="dc1"]').click(); await new Promise(r=>setTimeout(r,500)); document.querySelector('[data-co="dc1"]')?.click(); await new Promise(r=>setTimeout(r,300)); go('accounts'); await new Promise(r=>setTimeout(r,300));
      return {owing:[...document.querySelectorAll('#main .lg .lr')].map(r=>[r.querySelector('.ln').textContent,r.querySelector('.lnet').textContent]), dues:ACCT.items.filter(i=>i.source==='dues').map(i=>[i.member_id,i.ref,i.amount,i.descr])}; }""")
    dues=[x for x in ledger(fdb) if x['source']=='dues']
    bad+=check('dues put on account post once per charge with the association named; collected = a payment on the account',sorted((x['member_id'],x['ref'],x['amount'],x['kind']) for x in dues)==[('p1','dc1',120,'charge'),('p1','dc1',120,'payment'),('p2','dc2',120,'charge')] and all(x['descr'] in('MGA — 2026 dues','Dues collected — MGA') for x in dues) and r['owing']==[['Bo Baker','$118.50 owing']],r)
    # ---- 4. a second staff device reads the same ledger; the search; the balances CSV
    fdb.me='u-office@wccc.org'
    c2=await b.new_context(accept_downloads=True); await cloud(c2,fdb)
    p2,e2=await open_page(c2,'?org=club&tenant=app.wcccmga.org')
    r=await p2.evaluate("""async()=>{ go('accounts'); await new Promise(r=>setTimeout(r,600)); const kpi=[...document.querySelectorAll('#main .kpi .v')].map(x=>x.textContent);
      const q=document.getElementById('acQ'); q.value='1042'; q.dispatchEvent(new Event('input')); await new Promise(r=>setTimeout(r,100));
      return {kpi, found:[...document.querySelectorAll('#main .lg .lr .ln')].map(x=>x.textContent), filter:[...document.querySelectorAll('[data-af]')].map(b=>b.textContent)}; }""")
    bad+=check('second staff device: the same balances, search by member number',r['kpi'][0]=='$118.50' and r['found']==['Bo Baker'] and r['filter'][0]=='Owing · 1' and not e2,r,e2)
    async with p2.expect_download() as dl: await p2.evaluate("()=>{ view.aq=''; render(); document.getElementById('acCsv').click(); }")
    d=await dl.value; csv=open(await d.path()).read()
    bad+=check('balances CSV',d.suggested_filename.startswith('member-balances-') and '"1042","Baker","Bo","","118.50"' in csv and '"Able","Ann","ann@x.org","0.00"' in csv,csv.splitlines()[:3])
    # ---- 5. statements: one per member with a balance, saved, the PDF with a page per member; the second run starts the day after
    if os.path.exists(JSPDF):
      async with p2.expect_download() as dl:
        await p2.evaluate("""()=>{ document.getElementById('acRun').click(); document.getElementById('rsEnd').value='2026-10-31'; document.getElementById('dSave').click(); }""")
      d=await dl.value; pdf=open(await d.path(),'rb').read()
      st=fdb._rows('acct_statements')
      bad+=check('statements run: two rows, closing balances, due 25 days on, one run id; the PDF',d.suggested_filename=='statements-2026-10-31.pdf' and pdf[:4]==b'%PDF' and pdf.count(b'/Type /Page\n')>=2 and sorted((s['member_id'],s['opening'],s['charges'],s['payments'],s['closing'],s['due']) for s in st)==[('p1',0,120,120,0,'2026-11-25'),('p2',0,168.5,50,118.5,'2026-11-25')] and len({s['run_id'] for s in st})==1,[(s['member_id'],s['closing'],s['due']) for s in st])
      r=await p2.evaluate("""async()=>{ go('account',{acctId:'p2'}); await new Promise(r=>setTimeout(r,200)); const k=[...document.querySelectorAll('#main .kpi')].map(x=>x.querySelector('.v').textContent+' | '+x.querySelector('.muted').textContent);
        await acctPost({member_id:'p2',kind:'payment',amount:118.5,method:'ach',descr:'Statement payment',posted:'2026-11-05'}); go('accounts'); await new Promise(r=>setTimeout(r,200)); document.getElementById('acRun').click(); const end=document.getElementById('rsEnd').value; document.getElementById('rsEnd').value='2026-11-30'; document.getElementById('dSave').click(); await new Promise(r=>setTimeout(r,800));
        return {k, end, stmts:ACCT.stmts.filter(s=>s.member_id==='p2').map(s=>[s.period_start,s.period_end,s.opening,s.closing]).sort()}; }""")
      s2=[s for s in fdb._rows('acct_statements') if s['member_id']=='p2']
      bad+=check('account page shows the statement; the next run starts the day after and carries the opening balance',r['k'][2].startswith('$118.50 | Oct 31, 2026') and len(s2)==2 and r['stmts'][1][0]=='2026-11-01' and r['stmts'][1][1]=='2026-11-30' and r['stmts'][1][2]==118.5 and r['stmts'][1][3]==0,r)
    else: print('skip statements PDF (no jspdf in tests/node_modules)')
    # ---- 6. a board login: no nav item, the page redirects; a club without the module: locked page, no nav item
    fdb.me='u-mgaboard@x.org'
    c3=await b.new_context(); await cloud(c3,fdb)
    p3,e3=await open_page(c3,'?org=club&tenant=app.wcccmga.org')
    r=await p3.evaluate("async()=>{ const nav=[...document.querySelectorAll('#nav [data-go]')].map(b=>b.dataset.go); view.page='accounts'; render(); await new Promise(r=>setTimeout(r,200)); return {nav, page:view.page, scoped:SCOPED, items:ACCT.items}; }")
    bad+=check('board login: no Member accounts, the page sends them away, nothing loaded','accounts' not in r['nav'] and r['page']!='accounts' and r['items'] is None,r)
    fdb.me='u-gm@pines.org'
    c4=await b.new_context(); await cloud(c4,fdb)
    p4,e4=await open_page(c4,'?org=club&tenant=pines.flagstickhub.com')
    r=await p4.evaluate("async()=>{ const nav=[...document.querySelectorAll('#nav [data-go]')].map(b=>b.dataset.go); go('accounts'); await new Promise(r=>setTimeout(r,200)); return {nav, t:TENANT, page:view.page, items:ACCT.items}; }")
    bad+=check('a club without the module: no nav item, the page sends them away, no reads',r['t']=='pines' and 'accounts' not in r['nav'] and r['page']=='dash' and r['items'] is None and not e4,r,e4)
    await b.close()
  print('ALL OK' if not bad else f'{bad} FAILED'); sys.exit(1 if bad else 0)
asyncio.run(main())
