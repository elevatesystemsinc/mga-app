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
      document.getElementById('acCharge').click(); document.getElementById('apM').value='p2'; document.getElementById('apA').value='48.50'; document.getElementById('apI').value='proshop'; document.getElementById('apN').value='Dozen Pro V1'; document.getElementById('dSave').click(); await new Promise(r=>setTimeout(r,400));
      const onAccount=view.page==='account'&&view.acctId==='p2'; const bal1=document.querySelector('#main .kpi .v').textContent;
      document.getElementById('acCharge2').click(); document.getElementById('apA').value='30'; document.getElementById('apI').value='fnb'; document.getElementById('apN').value='Grill · Oct 12'; document.getElementById('dSave').click(); await new Promise(r=>setTimeout(r,400));
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
    bad+=check('balances CSV',d.suggested_filename.startswith('member-balances-') and '"1042","Baker","Bo","","","Active","118.50","118.50"' in csv and '"Able","Ann","ann@x.org","","Active","0.00"' in csv,csv.splitlines()[:3])
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
    # ---- 5b. the engine on the first staff device: a class with monthly dues + cart, a quarterly locker, a yearly assessment, an F&B minimum; rates; two members
    r=await p1.evaluate("""async()=>{ go('billsetup'); await new Promise(r=>setTimeout(r,200)); const b=acctSettings();
      document.getElementById('bsRates').click(); document.getElementById('brT').value='8'; document.getElementById('brS').value='20'; document.getElementById('dSave').click(); await new Promise(r=>setTimeout(r,200));
      document.getElementById('bsNewC').click(); document.getElementById('bcN').value='Full'; const amt=(i,v)=>{ const e=document.querySelector('[data-ci="'+i+'"][data-k="amount"]'); e.value=v; e.dispatchEvent(new Event('input')); }; amt(0,'500');
      document.getElementById('bcAdd').click(); const r1=document.querySelector('[data-ci="1"][data-k="itemId"]'); r1.value='cart'; r1.dispatchEvent(new Event('change')); amt(1,'120');
      document.getElementById('bcAdd').click(); let e2=document.querySelector('[data-ci="2"][data-k="itemId"]'); e2.value='locker'; e2.dispatchEvent(new Event('change')); amt(2,'90'); let ev=document.querySelector('[data-ci="2"][data-k="every"]'); ev.value='quarter'; ev.dispatchEvent(new Event('change'));
      ev=document.querySelector('[data-ci="2"][data-k="every"]'); ev.value='m1'; ev.dispatchEvent(new Event('change'));
      document.getElementById('bcAdd').click(); let e3=document.querySelector('[data-ci="3"][data-k="itemId"]'); e3.value='capital'; e3.dispatchEvent(new Event('change')); amt(3,'1200'); ev=document.querySelector('[data-ci="3"][data-k="every"]'); ev.value='year'; ev.dispatchEvent(new Event('change')); ev=document.querySelector('[data-ci="3"][data-k="every"]'); ev.value='m10'; ev.dispatchEvent(new Event('change'));
      document.getElementById('bcMin').value='150'; document.getElementById('bcMinE').value='month'; document.getElementById('dSave').click(); await new Promise(r=>setTimeout(r,200));
      const c=b.classes[0]; const bm=personById('p1').billing={class:c.id,status:'active',since:'',until:''}; personById('p2').billing={class:c.id,status:'active',since:'2026-10-16',until:''}; personById('p3').billing={class:c.id,status:'loa',since:'',until:''}; persist();
      return {rates:[b.tax.rate,b.svc.rate], cls:[c.name,c.charges.map(x=>[x.itemId,x.amount,x.every,x.month]),c.minimum], cards:[...document.querySelectorAll('[data-ec]')].length}; }""")
    bad+=check('billing setup: rates, a class with four charges on three schedules and a minimum',r['rates']==[8,20] and r['cls'][0]=='Full' and r['cls'][1]==[['dues',500,'month',None],['cart',120,'month',None],['locker',90,'quarter',1],['capital',1200,'year',10]] and r['cls'][2]=={'amount':150,'every':'month'} and r['cards']==1,r)
    # a taxed F&B charge with the service charge; the plan for October: Ann full (dues, cart, locker (Oct = quarter from Jan), capital (Oct)), Bo prorated 16/31, Cy on leave nothing; then the run; running twice posts nothing
    r=await p1.evaluate("""async()=>{ go('account',{acctId:'p1'}); await new Promise(r=>setTimeout(r,200)); document.getElementById('acCharge2').click(); document.getElementById('apA').value='100'; document.getElementById('apI').value='fnb'; document.getElementById('apI').dispatchEvent(new Event('change')); document.getElementById('apD').value='2026-09-20'; const hint=document.getElementById('apTot').textContent; document.getElementById('dSave').click(); await new Promise(r=>setTimeout(r,400));
      const fnb=ACCT.items.find(i=>i.item==='fnb'&&i.member_id==='p1'); const plan=billingPlan('2026-10').map(x=>[x.member_id,x.item,x.amount,x.tax,x.descr]).sort();
      const n1=await runBilling('2026-10'); const n2=await runBilling('2026-10'); go('accounts'); await new Promise(r=>setTimeout(r,200));
      return {hint, fnb:[fnb.amount,fnb.svc,fnb.tax,netOf(fnb)], plan, n1, n2, runs:acctSettings().runs.map(x=>[x.month,x.n,x.total]), kpi:document.querySelectorAll('#main .kpi')[2].textContent.includes('billing run through October 2026')}; }""")
    bad+=check('F&B charge: 20% service charge, 8% tax on both, net kept',r['hint']=='$100.00 + $20.00 service charge (20%) + $9.60 tax (8%) = $129.60 on the account' and r['fnb']==[129.6,20,9.6,100],r['fnb'])
    bad+=check('the October plan: four charges for Ann, Bo prorated 16/31 days, nothing for a leave of absence; unspent September minimum $50 for Ann',r['plan']==[['p1','capital',1200,0,'Capital assessment · October 2026'],['p1','cart',120,0,'Cart plan · October 2026'],['p1','dues',500,0,'Dues · October 2026'],['p1','locker',90,0,'Locker · October 2026'],['p1','min',50,0,'Unspent minimum · September 2026 (spent $100.00 of $150.00)'],['p2','capital',619.35,0,'Capital assessment · October 2026 (prorated)'],['p2','cart',61.94,0,'Cart plan · October 2026 (prorated)'],['p2','dues',258.06,0,'Dues · October 2026 (prorated)'],['p2','locker',46.45,0,'Locker · October 2026 (prorated)']],r['plan'])
    bad+=check('the run posts once; a second run posts nothing; the KPI names the month',r['n1']==9 and r['n2']==0 and r['runs']==[['2026-10',9,2945.8]] and r['kpi'],r)
    rows=[x for x in ledger(fdb) if str(x.get('ref','')).startswith('run:')]
    bad+=check('run rows in the database carry item, GL account and the idempotent ref',len(rows)==8 and all(x['gl'] and x['item'] and x['ref'].startswith('run:2026-10:') for x in rows),[(x['item'],x['gl']) for x in rows][:3])
    # November: monthly only (locker is quarterly from January, capital yearly in October); Bo now a full month; the October minimum for Bo is short (spent nothing) and Ann's too
    r=await p1.evaluate("()=>billingPlan('2026-11').map(x=>[x.member_id,x.item,x.amount]).sort()")
    bad+=check('November: monthly charges only, full months, unspent October minimums',r==[['p1','cart',120],['p1','dues',500],['p1','min',150],['p2','cart',120],['p2','dues',500],['p2','min',77.42]],r)
    # resigned mid-month: billed through the last day, then nothing
    r=await p1.evaluate("()=>{ personById('p2').billing={class:acctSettings().classes[0].id,status:'resigned',since:'2026-10-16',until:'2026-11-10'}; const nov=billingPlan('2026-11').filter(x=>x.member_id==='p2').map(x=>[x.item,x.amount]).sort(); const dec=billingPlan('2026-12').filter(x=>x.member_id==='p2').length; personById('p2').billing.status='active'; personById('p2').billing.until=''; return {nov,dec}; }")
    bad+=check('resigned Nov 10: November prorated 10/30, December nothing',r['nov']==[['cart',40],['dues',166.67],['min',77.42]] and r['dec']==0,r)
    # finance charges: Ann's October statement (closing 120 → paid off) carries none; set 1.5% + $10 late fee, run statements for November 30: Ann's Oct 31 statement was paid; Bo's $118.50 from Oct 31 is still owed past Nov 25 → finance charge + late fee on the November statement
    r=await p1.evaluate("""async()=>{ const b=acctSettings(); b.finance={pct:1.5,min:1}; b.lateFee={amount:10}; persist(); await acctLoad(true); const bo=ACCT.items.filter(i=>i.member_id==='p2'&&i.kind==='payment'&&i.descr==='Statement payment'); for(const i of bo) await acctVoid(i,'test: unpaid');
      const late=lateCharges('p2','2026-11-30').map(x=>[x.item,x.amount,x.descr]); const ag=agingOf('p2','2026-12-01'); return {late, ag, bal:balanceOf('p2')}; }""")
    bad+=check('finance charge 1.5% on the $118.50 still past due and a $10 late fee; aging buckets it',r['late']==[['finance',1.78,'Finance charge · 1.5% on $118.50 past due'],['late',10,'Late fee · statement of Oct 31, 2026 unpaid']] and r['ag']['cur']==0 and r['ag']['d60']>1000 and abs(r['ag']['total']-r['bal'])<0.01,r)
    # the GL journal for October balances: debits = credits, tax and service charge on their own accounts
    r=await p1.evaluate("()=>{ const L=glJournal('2026-10'), S=glJournal('2026-09'); const d=Math.round(sum(L,l=>l[3])*100)/100, c=Math.round(sum(L,l=>l[4])*100)/100; const accts=[...new Set(L.concat(S).map(l=>l[1]))].sort(); return {d,c,accts,n:L.length,sep:S.filter(l=>l[1]==='2300'||l[1]==='4150').map(l=>[l[1],l[4]])}; }")
    bad+=check('GL journal for October balances across receivables, revenue, tax, service charge and cash',r['d']==r['c'] and r['d']>0 and '1200' in r['accts'] and '4000' in r['accts'] and r['sep']==[['4150',20],['2300',9.6]],r)
    async with p1.expect_download() as dl: await p1.evaluate("()=>glExportCSV('2026-10')")
    d=await dl.value; csv=open(await d.path()).read()
    bad+=check('GL export CSV with a summary by account',d.suggested_filename=='gl-journal-2026-10.csv' and '"Summary"' in csv and '"1200","Accounts receivable"' in csv,csv.splitlines()[:2])
    # the Directory editor carries the billing membership
    r=await p1.evaluate("""async()=>{ go('members'); await new Promise(r=>setTimeout(r,200)); editMember(personById('p3')); const has=!!document.getElementById('bmC'); document.getElementById('bmS').value='active'; document.getElementById('dSave').click(); await new Promise(r=>setTimeout(r,200)); return {has, st:personById('p3').billing.status, cls:personById('p3').billing.class===acctSettings().classes[0].id}; }""")
    bad+=check('Directory editor: class and billing status saved on the person',r['has'] and r['st']=='active' and r['cls'],r)
    # ---- 5c. statements by e-mail (the mail function, in miniature) and the member portal
    r=await p1.evaluate("""async()=>{ go('account',{acctId:'p1'}); await new Promise(r=>setTimeout(r,200)); const n=await mailStatements([stmtsOf('p1')[0]]); return {n, sent:!!stmtsOf('p1')[0].sent_at, chip:[...document.querySelectorAll('#main .kpi .muted')][2].textContent}; }""")
    bad+=check('a statement e-mailed through the mail function; marked sent',r['n']==1 and r['sent'] and len(fdb.mails)==1 and fdb.mails[0]['to']=='ann@x.org' and fdb.mails[0]['attachments'][0]['filename'].startswith('statement-') and len(fdb.mails[0]['attachments'][0]['content'])>1000,r)
    st=[x for x in fdb._rows('acct_statements') if x['member_id']=='p1']
    bad+=check('sent_at written on the statement row',all(x.get('sent_at') for x in st),[x.get('sent_at') for x in st])
    # the portal: Ann signs in (her e-mail is on the directory) → her balance, statements, activity; no Pay without Stripe; a PDF
    fdb.seed_login('ann@x.org',name='Ann'); fdb.me='u-ann@x.org'
    c5=await b.new_context(accept_downloads=True); await cloud(c5,fdb)
    p5=await c5.new_page(); e5=[]; p5.on('pageerror',lambda e:e5.append(str(e)))
    await p5.goto(page('member.html')+'?tenant=app.wcccmga.org'); await p5.wait_for_function("()=>!!ME",timeout=10000); await p5.wait_for_timeout(300)
    r=await p5.evaluate("()=>({title:document.getElementById('hTitle').textContent, sub:document.getElementById('hSub').textContent, bal:document.querySelector('.bal .v').textContent, lbl:document.querySelector('.bal .lbl').textContent, pay:!!document.getElementById('pay'), auto:!!document.getElementById('autoOn'), stmts:document.querySelectorAll('[data-stmt]').length, rows:document.querySelectorAll('.row:not(.s)').length, online:ME.online, mine:ME.items.every(i=>i.member_id==='p1')})")
    bad+=check('member portal: Ann sees her own account, no Pay button without Stripe',r['title']=='Ann Able' and 'Walnut Creek Country Club' in r['sub'] and r['stmts']>=1 and r['rows']>=3 and not r['pay'] and not r['auto'] and not r['online'] and r['mine'] and not e5,r,e5)
    if os.path.exists(JSPDF):
      async with p5.expect_download() as dl: await p5.click('[data-stmt]')
      d=await dl.value; pdf=open(await d.path(),'rb').read()
      bad+=check('the member downloads a statement PDF from the portal',d.suggested_filename.startswith('statement-') and pdf[:4]==b'%PDF',d.suggested_filename)
    # someone whose e-mail is not on the directory
    fdb.seed_login('stranger@x.org'); fdb.me='u-stranger@x.org'
    c6=await b.new_context(); await cloud(c6,fdb); p6=await c6.new_page(); e6=[]; p6.on('pageerror',lambda e:e6.append(str(e)))
    await p6.goto(page('member.html')+'?tenant=app.wcccmga.org'); await p6.wait_for_timeout(1200)
    r=await p6.evaluate("()=>({h1:document.querySelector('#main h1')?.textContent, txt:document.querySelector('#main p')?.textContent, me:ME})")
    bad+=check('an e-mail not on the directory is told so, sees nothing',r['h1']=='We couldn’t find your account' and 'Walnut Creek Country Club' in (r['txt'] or '') and r['me'] is None and not e6,r,e6)
    # the hub: Billing setup names the portal link and offers Connect with Stripe; the stripe function is not configured
    fdb.me='u-pro@wccc.org'
    r=await p1.evaluate("""async()=>{ go('billsetup'); await new Promise(r=>setTimeout(r,200)); const link=document.querySelector('#main .cardhead .muted b')?.textContent; const con=document.getElementById('bsCon')?.textContent; document.getElementById('bsSt').click(); await new Promise(r=>setTimeout(r,400)); return {link, con, toast:document.getElementById('toast').textContent, online:acctSettings().online}; }""")
    bad+=check('Billing setup: the portal link, Connect with Stripe, a clear message while the function has no key',r['link'].endswith('member.html') and r['con']=='Connect with Stripe' and 'aren’t switched on' in r['toast'] and not r['online']['connected'],r)
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
