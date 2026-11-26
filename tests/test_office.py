"""Flagstick's back office in the portal against the fake (flagstick-office-setup.sql semantics).
Run: python3 tests/test_office.py
Checks: the portal's rail carries Pipeline · Estimates · Contracts · Invoices · Catalog; a lead lands on the board and
moves stage with a log line; an estimate from the lead (recurring + one-time lines, the discount) is numbered, PDF'd,
sent (the mail function records the attachment), accepted and converted — the recurring lines become an active contract,
the one-time line an invoice, the lead is won; the contract's cycle: in advance on the billing day, an invoice per
period, a second run makes no second invoice (idempotent), a payment moves the invoice to paid, a void frees the period;
the client record's Billing card; the catalog item editor and the billing settings; review mode waits for Generate."""
import asyncio,sys,json,datetime
from playwright.async_api import async_playwright
from _harness import FakeDB,cloud,page
def check(label,ok,r,errs=None):
    print(('OK  ' if ok else 'FAIL'),label,r,errs or ''); return 0 if ok else 1
async def main():
  bad=0
  fdb=FakeDB(); fdb.fn=True
  fdb.seed_tenant('pines','The Pines Golf Club',{'golf':True,'club':True,'billing':True},login_email='gm@pines.org',plan='club')
  for t in fdb._rows('tenants'):
      t['billing_email']='ap@pines.org'; t['address']={'line1':'1 Pine Way','city':'Dallas','state':'TX','zip':'75001'}
  fdb.seed('mga_hub','club',{'v':2,'id':'club','kind':'club','name':'The Pines Golf Club','short':'Pines','members':[],'orgs':[],'activeSeason':'2026','seasons':{'2026':{}},'tournaments':[],'_rev':2,'_w':'x','_at':1},tenant='pines')
  fdb.seed_login('zach@flagstick.test',admin=True,name='Zach'); fdb.me='u-zach@flagstick.test'; fdb.admin=True
  fdb._rows('fs_catalog').extend([{'id':'cat-club','name':'Club management','descr':'The full club','kind':'subscription','recurring':True,'every':'month','unit_price':799,'unit':'club','taxable':False,'active':True,'sort':1},
                                  {'id':'cat-setup','name':'Set-up and data migration','descr':'','kind':'setup','recurring':False,'every':'month','unit_price':1500,'unit':'','taxable':False,'active':True,'sort':2}])
  async with async_playwright() as pw:
    b=await pw.chromium.launch(); c=await b.new_context(); await cloud(c,fdb)
    pg=await c.new_page(); errs=[]; pg.on('pageerror',lambda e:errs.append(str(e)))
    await pg.goto(page('index.html')+'?portal=1'); await pg.wait_for_function("()=>PS.tenants&&PS.tenants.length&&OF.loaded",timeout=15000); await pg.wait_for_timeout(300)
    r=await pg.evaluate("()=>({nav:[...document.querySelectorAll('#nav [data-pv]')].map(b=>b.dataset.pv),secs:[...document.querySelectorAll('#nav .navsec span')].map(s=>s.textContent),cat:OF.catalog.length})")
    bad+=check('the rail: Sales · Clients · Library · Flagstick, the office loaded with the catalog',r['nav']==['pipeline','estimates','clients','contracts','invoices','courses','catalog','team','activity'] and r['secs']==['Sales','Clients','Library','Flagstick'] and r['cat']==2 and not errs,r,errs)
    # ---- 1. the pipeline
    await pg.evaluate("()=>{ document.querySelector('[data-pv=pipeline]').click(); }"); await pg.wait_for_timeout(200)
    await pg.evaluate("""()=>{ document.getElementById('ofNewLead').click(); olC.value='Shady Valley Country Club'; olT.value='Club management for 2027'; olN.value='Pat Pro'; olE.value='pat@shadyvalley.org'; olCity.value='Arlington'; olSt.value='TX'; olR.value='799'; olOne.value='1500'; document.getElementById('dSave').click(); }""")
    await pg.wait_for_timeout(500)
    r=await pg.evaluate("()=>({h1:document.querySelector('#main h1').textContent,cards:[...document.querySelectorAll('[data-lead]')].map(x=>x.querySelector('b').textContent),no:OF.leads[0].number,kpi:[...document.querySelectorAll('.kpi .v')].map(x=>x.textContent)})")
    bad+=check('a new lead: numbered from 2000, on the New column, the pipeline KPIs',r['h1']=='Pipeline' and r['cards']==['Shady Valley Country Club'] and r['no']==2000 and r['kpi'][0]=='1' and r['kpi'][1]=='$799.00',r)
    await pg.evaluate("""()=>{ document.querySelector('[data-lead]').click(); document.querySelector('#olS [data-v=qualified]').click(); document.getElementById('dSave').click(); }"""); await pg.wait_for_timeout(400)
    l=fdb._rows('fs_leads')[0]
    bad+=check('stage → Qualified, logged on the lead',l['stage']=='qualified' and any('Qualified' in x['text'] for x in l['log']) and any(e['kind']=='lead' for e in fdb._rows('tenant_events')),[l['stage'],[x['text'] for x in l['log']]])
    # ---- 2. an estimate from the lead: a recurring line from the catalog, a one-time line, 10% off
    await pg.evaluate("""()=>{ document.querySelector('[data-lead]').click(); document.getElementById('olEst').click(); }"""); await pg.wait_for_timeout(300)
    r=await pg.evaluate("()=>({title:document.getElementById('dTitle').textContent,company:oeC.value,contact:oeN.value,email:oeE.value})")
    bad+=check('New estimate from the lead is prefilled',r['company']=='Shady Valley Country Club' and r['contact']=='Pat Pro' and r['email']=='pat@shadyvalley.org',r)
    await pg.evaluate("""()=>{ const p=document.getElementById('oiPick'); p.value='cat-club'; p.dispatchEvent(new Event('change')); p.value='cat-setup'; p.dispatchEvent(new Event('change')); document.getElementById('oiWide').value='10'; document.getElementById('oiWide').dispatchEvent(new Event('input')); }""")
    r=await pg.evaluate("()=>({rows:document.querySelectorAll('#oiList .oi').length,tot:document.getElementById('oiTot').textContent})")
    bad+=check('the lines editor: two catalog lines, the running total with 10% off',r['rows']==2 and r['tot']=='$719.10 / month recurring · $1,350.00 one-time',r)
    await pg.evaluate("()=>document.getElementById('dSave').click()"); await pg.wait_for_timeout(500)
    e=fdb._rows('fs_estimates')[0]
    r=await pg.evaluate("()=>({view:PS.view,h1:document.querySelector('#main h1').textContent,chips:[...document.querySelectorAll('#main .sub .chip')].map(x=>x.textContent),lead:OF.leads[0].value_recurring})")
    bad+=check('estimate Q-1000 saved, drafted, on its page; the lead keeps its own value',e['number']==1000 and e['status']=='draft' and e['lead_id']==l['id'] and len(e['items'])==2 and e['discount_pct']==10 and r['view']=='estimate' and r['h1']=='Q-1000 · Shady Valley Country Club' and r['chips']==['Draft'],(e['number'],e['status'],r))
    # the PDF and the e-mail (the fake's mail function records what it got)
    r=await pg.evaluate("async()=>{ const d=await estimatePDF(OF.estimates[0]); return {pages:d.getNumberOfPages(),len:d.output('datauristring').length}; }")
    bad+=check('the proposal PDF renders',r['pages']==1 and r['len']>20000,r)
    await pg.evaluate("()=>document.getElementById('oeSend').click()"); await pg.wait_for_function("()=>OF.estimates[0].status==='sent'",timeout=8000); await pg.wait_for_timeout(200)
    m=fdb.mails[-1]
    bad+=check('Send: the mail function got the PDF, the estimate is Sent',m['to']=='pat@shadyvalley.org' and 'Q-1000' in m['subject'] and m['attachments'][0]['filename']=='Q-1000.pdf' and len(m['attachments'][0]['content'])>10000 and m['tenant']=='' and e['status']=='sent',(m['to'],m['subject'],e['status']))
    # accepted, then converted — needs a client; link the lead's club to the Pines tenant through the convert drawer
    await pg.evaluate("()=>{ document.getElementById('oeAcc').click(); document.getElementById('dSave').click(); }"); await pg.wait_for_function("()=>OF.estimates[0].status==='accepted'",timeout=8000); await pg.wait_for_timeout(200)
    await pg.evaluate("""()=>{ document.getElementById('oeConv').click(); ocT.value='pines'; ocStart.value='2026-11-01'; ocDay.value='1'; ocTerms.value='15'; ocInvTerms.value='15'; document.getElementById('dSave').click(); }""")
    await pg.wait_for_function("()=>PS.view==='contract'",timeout=8000); await pg.wait_for_timeout(500)
    ct=fdb._rows('fs_contracts')[0]; invs=fdb._rows('fs_invoices'); e=fdb._rows('fs_estimates')[0]; l=fdb._rows('fs_leads')[0]
    bad+=check('convert: an active contract from the recurring line, an invoice from the one-time line, the estimate converted, the lead won',ct['number']==7000 and ct['status']=='active' and ct['tenant']=='pines' and len(ct['items'])==1 and ct['items'][0]['unit_price']==799 and ct['discount_pct']==10 and ct['terms_days']==15 and e['status']=='converted' and e['contract_id']==ct['id'] and l['stage']=='won' and l['tenant']=='pines',(ct['status'],e['status'],l['stage'],[ (i['number'],i['period'],i['total']) for i in invs]))
    one=[i for i in invs if not i['contract_id']][0]
    bad+=check('the one-time invoice: numbered from 9000, 10% off, due Net 15',one['number']==9000 and one['total']==1350 and one['discount']==150 and one['status']=='draft' and one['due_on']==(datetime.date.today()+datetime.timedelta(days=15)).isoformat(),(one['number'],one['total'],one['due_on']))
    # ---- 3. the billing cycle: the contract started 2026-11-01, billed in advance on the 1st → every period up to now has an invoice
    today=datetime.date.today(); months=(today.year-2026)*12+today.month-11+1
    rec=[i for i in invs if i['contract_id']==ct['id']]
    bad+=check('activating the contract billed every period from its start (%d) once each, $719.10 after the discount, Net 15'%months,len(rec)==months and sorted(i['period'] for i in rec)==sorted({i['period'] for i in rec}) and all(i['total']==719.1 and i['status']=='draft' and i['terms_days']==15 for i in rec) and ct['last_period']==max(i['period'] for i in rec),(len(rec),[(i['period'],i['total']) for i in rec],ct['last_period']))
    n0=len(fdb._rows('fs_invoices'))
    r=await pg.evaluate("async()=>{ const r=await ofRunBilling({quiet:true}); return r; }")
    bad+=check('a second billing run makes nothing (idempotent per period)',r['made']==0 and len(fdb._rows('fs_invoices'))==n0,(r,len(fdb._rows('fs_invoices'))))
    r=await pg.evaluate("()=>({h1:document.querySelector('#main h1').textContent,next:[...document.querySelectorAll('.kv')].find(k=>k.textContent.startsWith('Next invoice')).textContent,rows:document.querySelectorAll('[data-inv]').length})")
    nxt=(today.replace(day=1)+datetime.timedelta(days=32)).replace(day=1)
    bad+=check('the contract page: the next invoice is next month’s 1st, the invoices listed',r['h1'].startswith('C-7000 · The Pines') and nxt.strftime('%b %-d, %Y') in r['next'] and r['rows']==months,r)
    # a payment on the latest recurring invoice → paid; a void frees its period
    latest=max(rec,key=lambda i:i['period'])
    await pg.evaluate("(id)=>ofGo('invoice',id)",latest['id']); await pg.wait_for_timeout(200)
    await pg.evaluate("()=>{ document.getElementById('oiSend').click(); }"); await pg.wait_for_function("(id)=>OF.invoices.find(i=>i.id===id).status==='sent'",arg=latest['id'],timeout=8000); await pg.wait_for_timeout(200)
    m=fdb.mails[-1]
    bad+=check('Send the invoice: to the client’s billing e-mail with the PDF, status Sent',m['to']=='ap@pines.org' and 'INV-' in m['subject'] and m['attachments'][0]['filename'].startswith('INV-') and latest['status']=='sent' and latest['sent_to']=='ap@pines.org',(m['to'],m['subject'],latest['status']))
    await pg.evaluate("()=>{ document.getElementById('oiPay').click(); opR.value='chk 4471'; document.getElementById('dSave').click(); }"); await pg.wait_for_function("(id)=>OF.invoices.find(i=>i.id===id).status==='paid'",arg=latest['id'],timeout=8000); await pg.wait_for_timeout(300)
    p=fdb._rows('fs_payments')[0]
    r=await pg.evaluate("()=>({chips:[...document.querySelectorAll('#main .sub .chip')].map(x=>x.textContent),pays:document.querySelectorAll('[data-rmp]').length,bal:[...document.querySelectorAll('.tr.tot')].map(x=>x.textContent.replace(/\\s+/g,' ').trim())})")
    bad+=check('a payment for the balance: recorded, the invoice paid in full',p['amount']==719.1 and p['reference']=='chk 4471' and latest['paid']==719.1 and latest['status']=='paid' and r['chips']==['Paid'] and r['pays']==1 and any('Balance due' in x and '$0.00' in x for x in r['bal']),(p['amount'],latest['status'],r))
    r=await pg.evaluate("async()=>{ const d=await invoicePDF(OF.invoices.find(i=>i.status==='paid')); return {pages:d.getNumberOfPages(),len:d.output('datauristring').length}; }")
    bad+=check('the invoice PDF renders',r['pages']==1 and r['len']>20000,r)
    first=one
    await pg.evaluate("(id)=>ofGo('invoice',id)",first['id']); await pg.wait_for_timeout(200)
    await pg.evaluate("()=>{ document.getElementById('oiSend').click(); }"); await pg.wait_for_function("(id)=>OF.invoices.find(i=>i.id===id).status==='sent'",arg=first['id'],timeout=8000)
    await pg.evaluate("()=>{ document.getElementById('oiVoid').click(); ovWhy.value='re-billed'; document.getElementById('dSave').click(); }"); await pg.wait_for_function("(id)=>OF.invoices.find(i=>i.id===id).status==='void'",arg=first['id'],timeout=8000); await pg.wait_for_timeout(200)
    r=await pg.evaluate("(cid)=>{ const c=OF.contracts.find(x=>x.id===cid); const keep=c.last_period; c.last_period=null; const free=!periodCovered(c,'2026-11'); c.last_period=keep; return {free,covered:periodCovered(c,'2026-11'),lastp:c.last_period}; }",ct['id'])
    bad+=check('a void keeps the row; a voided period is free again unless the pointer covers it',first['status']=='void' and first['void_reason']=='re-billed' and not r['free'] and r['covered'],(first['status'],r))
    # overdue: a sent invoice past its due date
    await pg.evaluate("(id)=>{ const i=OF.invoices.find(x=>x.id===id); i.due_on='2026-01-01'; i.status='sent'; i.void_at=null; }",first['id'])
    r=await pg.evaluate("()=>{ ofGo('invoices'); OF.iseg='overdue'; vInvoices(document.getElementById('main')); return {rows:document.querySelectorAll('[data-inv]').length,chips:[...document.querySelectorAll('[data-inv] .chip')].map(x=>x.textContent),kpi:document.querySelectorAll('.kpi .v')[1].textContent}; }")
    bad+=check('Invoices page: the Overdue filter and KPI',r['rows']==1 and r['chips']==['Overdue'] and r['kpi']=='$1,350.00',r)
    # ---- 4. the client record's Billing card
    await pg.evaluate("()=>openClient('pines')"); await pg.wait_for_timeout(300)
    r=await pg.evaluate("()=>({cards:[...document.querySelectorAll('#main h2')].map(h=>h.textContent.trim()),ct:document.querySelectorAll('[data-oct]').length,inv:document.querySelectorAll('[data-oinv]').length,est:document.querySelectorAll('[data-oest]').length,head:document.querySelector('#ptBilling h2').textContent.replace(/\\s+/g,' ')})")
    bad+=check('the client record carries Billing: its contract, invoices and estimate, MRR in the heading',any(h.startswith('Billing') for h in r['cards']) and r['ct']==1 and r['inv']==months+1 and r['est']==1 and '$719.10/mo' in r['head'],r)
    # ---- 5. catalog & billing settings; review mode waits
    await pg.evaluate("()=>{ document.querySelector('[data-pv=catalog]').click(); }"); await pg.wait_for_timeout(200)
    await pg.evaluate("""()=>{ document.getElementById('ofNewCat').click(); okN.value='On-site training day'; okP.value='950'; okR.value='once'; okU.value='day'; document.getElementById('dSave').click(); }"""); await pg.wait_for_timeout(400)
    await pg.evaluate("""()=>{ document.getElementById('ofBillEdit').click(); document.querySelector('#obMode [data-v=review]').click(); obTerms.value='20'; document.getElementById('dSave').click(); }"""); await pg.wait_for_timeout(400)
    await pg.evaluate("""()=>{ document.getElementById('ofCoEdit').click(); ocoA1.value='100 Main St'; ocoCity.value='Fort Worth'; ocoSt.value='TX'; ocoE.value='billing@flagstickhub.com'; ocoPay.value='ACH to account 123'; document.getElementById('dSave').click(); }"""); await pg.wait_for_timeout(400)
    S={s['key']:s['value'] for s in fdb._rows('fs_settings')}
    r=await pg.evaluate("()=>({cat:OF.catalog.map(c=>c.name),rows:document.querySelectorAll('[data-cat]').length,txt:document.querySelector('#main').textContent})")
    bad+=check('catalog item added; billing mode review, Net 20; the remit-to block saved',len(fdb._rows('fs_catalog'))==3 and r['rows']==3 and S['billing']['mode']=='review' and S['billing']['terms_days']==20 and S['company']['city']=='Fort Worth' and 'Review' in r['txt'] and 'Fort Worth' in r['txt'],(S,r['cat']))
    # a second contract in review mode: nothing generated until Generate
    r=await pg.evaluate("""async()=>{ const c={id:'ct-2',number:7001,tenant:'pines',title:'Point of sale add-on',status:'active',start_on:'2026-10-15',end_on:null,billing_day:15,frequency:'monthly',timing:'advance',lead_days:0,terms_days:20,auto_renew:true,escalator_pct:0,discount_pct:0,items:[{id:'x',descr:'Point of sale',qty:1,unit_price:99,discount_pct:0}],last_period:null,notes:''}; await ofInsert('fs_contracts',OF.contracts,c); const before=OF.invoices.length; const r=await ofRunBilling({quiet:true}); ofGo('contracts'); return {made:r.made,due:r.due,before,after:OF.invoices.length,dueRows:document.querySelectorAll('[data-gen]').length}; }""")
    bad+=check('review mode: a due contract waits on the Contracts page',r['made']==0 and r['due']>=1 and r['after']==r['before'] and r['dueRows']>=1,r)
    await pg.evaluate("()=>document.querySelector('[data-gen=\"ct-2\"]').click()"); await pg.wait_for_function("()=>OF.invoices.some(i=>i.contract_id==='ct-2')",timeout=8000); await pg.wait_for_timeout(200)
    gen=[i for i in fdb._rows('fs_invoices') if i['contract_id']=='ct-2']
    bad+=check('Generate makes that one invoice, Net 20 from the contract, the period marked',len(gen)==1 and gen[0]['total']==99 and gen[0]['terms_days']==20 and gen[0]['period'] and next(c for c in fdb._rows('fs_contracts') if c['id']=='ct-2')['last_period']==gen[0]['period'],[(i['period'],i['total']) for i in gen])
    # the cycle maths on their own: quarterly in arrears, escalator, end date
    r=await pg.evaluate("""()=>{ const c={start_on:'2026-01-10',billing_day:10,frequency:'quarterly',timing:'arrears',terms_days:30,escalator_pct:5,end_on:'2026-12-31',items:[{qty:1,unit_price:300}]}; const a=cycleFor(c,0), b=cycleFor(c,4), n=nextCycle(c,new Date('2026-05-01T12:00:00Z')); return {aPeriod:a.period,aInv:isoOf(a.invoiceDate),aDue:isoOf(a.dueDate),aLabel:a.label,bFactor:b.factor,bYears:b.years,n:n?n.period:null,past:pastEnd(c,b),monthly:ctMonthly(c)}; }""")
    bad+=check('cycle maths: quarterly in arrears bills after the quarter, Net 30; +5% on the anniversary; nothing past the end',r['aPeriod']=='2026-01' and r['aInv']=='2026-04-10' and r['aDue']=='2026-05-10' and r['aLabel']=='Jan 2026 – Mar 2026' and abs(r['bFactor']-1.05)<1e-9 and r['bYears']==1 and r['n']=='2026-04' and r['past'] and r['monthly']==100,r)
    bad+=check('no script errors',not errs,errs)
    await b.close()
  print('ALL OK' if not bad else '%d FAILED'%bad); sys.exit(1 if bad else 0)
asyncio.run(main())
