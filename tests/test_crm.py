"""Companies — the CRM layer — against the fake database. Run: python3 tests/test_crm.py
The club hub adds a company and a contact with a title and contact types; a tournament sponsor is picked from the companies and its
contact lands on the directory; the company record shows the sponsorship (level, pledged, received, status), the people and a note;
the MGA hub shares the same list, links a sponsor it already had by name, and the club record then shows both sponsorships; a company
add is one write to the club row; the roster import maps Company and Title; a scoped board login reads the list and cannot change it."""
import asyncio,sys,json
from playwright.async_api import async_playwright
from _harness import FakeDB,cloud,page,seed_from_main
from test_sync import seed_main,open_hub,settled
def club_doc(name,orgs):
    return {'v':2,'id':'club','kind':'club','name':name,'short':name.split()[0],'members':[],'orgs':orgs,'activeSeason':'2026','seasons':{'2026':{}},'tournaments':[],'_rev':3,'_w':'x','_at':1}
def org_doc(id,name,short,kind='association'):
    return {'v':2,'id':id,'kind':kind,'name':name,'short':short,'memberships':[],'activeSeason':'2026','seasons':{'2026':{}},'tournaments':[],'_rev':2,'_w':'x','_at':1}
async def open_page(ctx,q,ready="()=>cloudReady"):
    pg=await ctx.new_page(); errs=[]; pg.on('pageerror',lambda e:errs.append(str(e)))
    await pg.goto(page('index.html')+q)
    try: await pg.wait_for_function(ready,timeout=15000)
    except Exception: pass
    await pg.wait_for_timeout(400); return pg,errs
async def wait_writes(fdb,key,n,timeout=15):
    import time; t0=time.time()
    while time.time()-t0<timeout:
        if fdb.writes.get(key,0)>=n: return True
        await asyncio.sleep(0.2)
    return False
def check(label,ok,r,errs=None):
    print(('OK  ' if ok else 'FAIL'),label,r,errs or ''); return 0 if ok else 1
T1="""()=>{ db.tournaments.push(Object.assign({id:'T1',name:'Data Center Open',season:Y(),startDate:Y()+'-05-04',days:1,teamSize:4,field:[],sponsors:[],tiers:[{name:'Gold',amt:5000,spots:0},{name:'Silver',amt:2500,spots:0}],income:[],perPlayer:[],lines:[],dayItems:[[],[],[]],actuals:{},schedule:[],decisions:[],fieldQuestions:[],features:{meals:false,sponsors:true,budget:true,checklist:false,calcutta:false,raffle:false}})); normalize(db); }"""
async def main():
    bad=0; fdb=FakeDB(); main=seed_main(); seed_from_main(fdb,main)
    async with async_playwright() as p:
        b=await p.chromium.launch()
        A=await b.new_context(); await cloud(A,fdb); pg,errs=await open_hub(A,'club')
        # ---- 1. the rail and an empty Companies page
        r=await pg.evaluate("()=>{ go('companies'); return {on:crmOn(), edit:crmEdit(), nav:navItems().some(x=>x[0]==='companies'), sec:[...document.querySelectorAll('#nav .navsec')].map(b=>b.textContent.trim()), after:(()=>{ const ks=[...document.querySelectorAll('#nav .nav[data-go]')].map(b=>b.dataset.go); return ks[ks.indexOf('members')+1]; })(), h1:document.querySelector('#main h1').textContent, empty:!!document.querySelector('#main .empty'), add:!!document.getElementById('coAdd')}; }")
        bad+=check('the club hub: Companies on the rail right after the Directory, an empty page with Add company',r['on'] and r['edit'] and r['nav'] and r['after']=='companies' and r['h1']=='Companies' and r['empty'] and r['add'],r,errs)
        # ---- 2. a company from the drawer = one write to the club row, none to the MGA
        await pg.evaluate("()=>persist()"); await pg.wait_for_timeout(2500); w0=dict(fdb.writes)   # the first save flushes normalize's defaults for every open document; count from there
        r=await pg.evaluate("""async()=>{ document.getElementById('coAdd').click(); await new Promise(r=>setTimeout(r,50)); document.getElementById('cdN').value='Acme Bank'; document.getElementById('cdI').value='Bank'; document.getElementById('cdC').value='Walnut Creek'; document.getElementById('cdW').value='acmebank.com'; document.getElementById('dSave').click(); await new Promise(r=>setTimeout(r,100));
          const c=companies()[0]; return {n:companies().length, page:view.page, id:view.companyId===c.id, name:c.name, h1:document.querySelector('#main h1').textContent, chips:[...document.querySelectorAll('#main .phead .chip')].map(x=>x.textContent)}; }""")
        landed=await wait_writes(fdb,'club',w0.get('club',0)+1)
        bad+=check('Add company → the company record opens; one company',r['n']==1 and r['page']=='company' and r['id'] and r['h1']=='Acme Bank' and 'Bank' in r['chips'] and 'acmebank.com' in r['chips'] and r['chips'][0].startswith(str(2026)) is False,r)
        bad+=check('one write to the club row, none to the MGA row',landed and fdb.writes['club']-w0.get('club',0)==1 and fdb.writes['mga']-w0.get('mga',0)==0,{k:fdb.writes[k]-w0.get(k,0) for k in fdb.writes})
        # ---- 3. a contact with a title and contact types
        r=await pg.evaluate("""async()=>{ document.getElementById('coCon').click(); await new Promise(r=>setTimeout(r,50)); document.getElementById('ctF').value='Dana'; document.getElementById('ctL').value='Decides'; document.getElementById('ctT').value='President'; document.getElementById('ctE').value='dana@acme.test';
          const co=document.getElementById('ctCo').value; [...document.querySelectorAll('#ctCT [data-ct]')].filter(b=>['Decision maker','Golfer'].includes(b.dataset.ct)).forEach(b=>b.click()); document.getElementById('dSave').click(); await new Promise(r=>setTimeout(r,100));
          const p=persons().find(x=>x.last==='Decides'); const c=companies()[0]; return {co, p:p&&{company:p.company===c.id,title:p.title,ctypes:p.ctypes,type:p.memberType,status:p.status}, rows:[...document.querySelectorAll('#main [data-ct]')].map(r=>r.textContent.replace(/\\s+/g,' ').trim()), kpi:[...document.querySelectorAll('#main .kpi .v')].map(x=>x.textContent)}; }""")
        bad+=check('Add contact: the company is prefilled, the person lands on the directory with company, title and two contact types; the People card lists them',r['co']=='Acme Bank' and r['p'] and r['p']['company'] and r['p']['title']=='President' and r['p']['ctypes']==['Decision maker','Golfer'] and r['p']['type']=='Contact' and len(r['rows'])==1 and 'Dana Decides' in r['rows'][0] and 'President' in r['rows'][0] and 'Decision maker' in r['rows'][0] and r['kpi'][2]=='1',r)
        # ---- 4. a tournament sponsor picked from the companies; its contact from the company's people; a second sponsor typed new
        await pg.evaluate(T1)
        r=await pg.evaluate("""async()=>{ go('tournament',{tid:'T1'}); view.ttab='sponsors'; render(); await new Promise(r=>setTimeout(r,50)); document.getElementById('spAdd').click(); await new Promise(r=>setTimeout(r,50));
          const inp=document.getElementById('sCo'); inp.value='acm'; inp.dispatchEvent(new Event('input')); await new Promise(r=>setTimeout(r,50)); const hits=[...document.querySelectorAll('#sCoL [data-cp]')].map(b=>b.textContent); document.querySelector('#sCoL [data-cp]').click(); await new Promise(r=>setTimeout(r,50));
          const id=document.getElementById('sCoId').value, hint=document.getElementById('sCoH').textContent, dl=[...document.querySelectorAll('#sCtDL option')].map(o=>o.value);
          const tier=document.getElementById('sTier'); tier.value='Gold'; tier.dispatchEvent(new Event('change')); document.getElementById('sCt').value='Dana Decides'; document.getElementById('pAdd').click(); await new Promise(r=>setTimeout(r,30)); document.querySelector('[data-pi="0"][data-k="amount"]').value='2500'; document.querySelector('[data-pi="0"][data-k="amount"]').dispatchEvent(new Event('input'));
          document.getElementById('dSave').click(); await new Promise(r=>setTimeout(r,100));
          const t=db.tournaments.find(x=>x.id==='T1'), s=t.sponsors[0], dana=persons().find(x=>x.last==='Decides'); return {hits, id:id===companies()[0].id, hint, dl, s:{company:s.company,companyId:s.companyId===companies()[0].id,contact:s.contact,contactId:s.contactId===dana.id,tier:s.tier,pledged:s.pledged,paid:spPaid(s)}, row:document.querySelector('#main [data-sp] .cell2').textContent}; }""")
        bad+=check('the sponsor drawer: typing finds the company, picking it fills the id and the contact suggestions; Save links the sponsorship to the company and its contact to Dana',r['hits']==['Acme BankWalnut Creek · 1 contacts'] and r['id'] and r['hint'].startswith('Acme Bank') and r['dl']==['Dana Decides'] and r['s']=={'company':'Acme Bank','companyId':True,'contact':'Dana Decides','contactId':True,'tier':'Gold','pledged':5000,'paid':2500} and 'Acme Bank' in r['row'],r)
        r=await pg.evaluate("""async()=>{ document.getElementById('spAdd').click(); await new Promise(r=>setTimeout(r,50)); const inp=document.getElementById('sCo'); inp.value='Bluebonnet Builders'; inp.dispatchEvent(new Event('input')); await new Promise(r=>setTimeout(r,50)); const hint=document.getElementById('sCoH').textContent;
          const tier=document.getElementById('sTier'); tier.value='Silver'; tier.dispatchEvent(new Event('change')); document.getElementById('sCt').value='Rae Roofer'; document.getElementById('sEm').value='rae@bluebonnet.test'; document.getElementById('dSave').click(); await new Promise(r=>setTimeout(r,100));
          const c=companyByName('Bluebonnet Builders'), rae=persons().find(x=>x.last==='Roofer'), s=db.tournaments.find(x=>x.id==='T1').sponsors[1]; return {hint, made:!!c, link:s.companyId===c.id, rae:rae&&{company:rae.company===c.id,email:rae.email,ctypes:rae.ctypes,type:rae.memberType}, contactId:s.contactId===rae.id, n:companies().length}; }""")
        bad+=check('a sponsor typed as a new name: the hint says so, Save makes the company and puts its contact on the directory as a Sponsor contact',r['hint'].startswith('New company') and r['made'] and r['link'] and r['rae']=={'company':True,'email':'rae@bluebonnet.test','ctypes':['Sponsor contact'],'type':'Contact'} and r['contactId'] and r['n']==2,r)
        # ---- 5. the company record: the sponsorship with level, pledged, received, status; the list's chips, filters and people search
        r=await pg.evaluate("""async()=>{ go('company',{companyId:companies()[0].id}); await new Promise(r=>setTimeout(r,50)); const rows=[...document.querySelectorAll('#main [data-sp]')].map(r=>[...r.querySelectorAll(':scope > span, :scope > div')].map(x=>x.textContent.replace(/\\s+/g,' ').trim()));
          const chips=[...document.querySelectorAll('#main .phead .chip')].map(x=>x.textContent), kpi=[...document.querySelectorAll('#main .kpi .v')].map(x=>x.textContent);
          document.getElementById('coNote').click(); await new Promise(r=>setTimeout(r,50)); document.getElementById('cnT').value='Called Dana — wants the foursome on Sunday.'; document.getElementById('cnB').value='Zach'; document.getElementById('dSave').click(); await new Promise(r=>setTimeout(r,100));
          const note=document.querySelector('#main [data-ndel]').closest('.lr').querySelector('.ln').textContent, log=companies()[0].log;
          go('companies'); await new Promise(r=>setTimeout(r,50)); const list=[...document.querySelectorAll('#main [data-co]')].map(r=>r.textContent.replace(/\\s+/g,' ').trim());
          document.querySelector('[data-cf="Sponsoring '+Y()+'"]').click(); await new Promise(r=>setTimeout(r,50)); const nYr=document.querySelectorAll('#main [data-co]').length;
          const q=document.getElementById('cq'); q.value='rae'; q.dispatchEvent(new Event('input')); await new Promise(r=>setTimeout(r,50)); const found=[...document.querySelectorAll('#main [data-co]')].map(r=>r.querySelector('b').textContent);
          return {rows, chips, kpi, note, log:log.length===1&&log[0].by, list, nYr, found}; }""")
        y=str(2026)
        bad+=check('the company record: the sponsorship row reads year · tournament · Gold · $5,000 · $2,500 · Partial; the chips and KPIs agree; a note is logged with who wrote it',len(r['rows'])==1 and r['rows'][0][0]==y and r['rows'][0][1].startswith('Data Center Open') and 'contact Dana Decides' in r['rows'][0][1] and r['rows'][0][2]=='Gold' and r['rows'][0][3]=='$5,000' and r['rows'][0][4]=='$2,500' and r['rows'][0][5]=='Partial' and r['chips'][0]==y+' · Gold · Partial' and r['kpi'][0]=='$2,500' and r['kpi'][1]=='$2,500' and r['note'].startswith('Called Dana') and r['log']=='Zach',r)
        bad+=check('the Companies list: Acme with its chip, Bluebonnet pledged; the year filter keeps both; a search by a contact’s name finds the company',len(r['list'])==2 and 'Gold · Partial' in r['list'][0] and 'Silver · Pledged' in r['list'][1] and r['nYr']==2 and r['found']==['Bluebonnet Builders'],r)
        # ---- 6. the directory shows company · title and searches on it; the roster import maps Company and Title
        r=await pg.evaluate("""()=>{ go('members'); view.mq='acme'; render(); const rows=[...document.querySelectorAll('#main [data-m]')].map(r=>r.querySelector('.cell2').textContent.replace(/\\s+/g,' ').trim()); view.mq='';
          const res=mapRoster([['First Name','Last Name','Email','Company','Job Title'],['Pat','Payer','pat@acme.test','Acme Bank','CFO'],['New','Face','new@z.test','Zeta Co','']]); const plan=planRoster(res.people,Date.now());
          const d={}; rosterSet(d,'company','Acme Bank'); rosterSet(d,'title','CFO'); const d2={}; rosterSet(d2,'company','Zeta Co');
          return {rows, cols:res.columns, p:res.people.map(p=>[p.company,p.title]), add:plan.add.length, d:[d.company===companies()[0].id,d.title], zeta:!!companyByName('Zeta Co')&&d2.company===companyByName('Zeta Co').id, n:companies().length}; }""")
        bad+=check('the directory: Dana reads “Acme Bank · President” and a search for the company finds her; a file’s Company and Title columns are read, and a company named in a file is made on import',len(r['rows'])==1 and 'Dana Decides' in r['rows'][0] and 'Acme Bank · President' in r['rows'][0] and 'company' in r['cols'] and 'title' in r['cols'] and r['p']==[['Acme Bank','CFO'],['Zeta Co','']] and r['add']==2 and r['d']==[True,'CFO'] and r['zeta'] and r['n']==3,r)
        await pg.evaluate("()=>{ CLUB.companies=companies().filter(c=>c.name!=='Zeta Co'); persist(); }"); await settled([pg])
        # ---- 7. the MGA hub: the same companies; its own sponsor by name gets linked in one tap; the club's record then shows both
        B=await b.new_context(); await cloud(B,fdb); mg,me=await open_hub(B,'mga')
        r=await mg.evaluate("""async()=>{ const t=db.tournaments[0]; t.sponsors.push({id:uid(),company:'acme bank',tier:'',pledged:1000,contact:'',payments:[{id:uid(),amount:1000,method:'Check',date:''}]}); persist(); go('companies'); await new Promise(r=>setTimeout(r,50));
          const banner=(document.querySelector('#main .banner')||{}).textContent||''; const before=companies().length; document.getElementById('coLink').click(); await new Promise(r=>setTimeout(r,100));
          const c=companyByName('Acme Bank'); go('company',{companyId:c.id}); await new Promise(r=>setTimeout(r,50)); const rows=[...document.querySelectorAll('#main [data-sp]')].map(r=>r.querySelector('.cell2 b').textContent);
          return {on:crmOn(), edit:crmEdit(), n:before, banner, linked:t.sponsors[0].companyId===c.id, same:companies().length===before, rows, people:document.querySelectorAll('#main [data-ct]').length, noBanner:(()=>{ go('companies'); return !document.querySelector('#main .banner'); })()}; }""")
        await settled([mg]); await settled([pg]); await pg.wait_for_function("()=>sponsorshipsOf(companyByName('Acme Bank')).length===2",timeout=15000)
        bad+=check('the MGA hub: the shared list (2 companies); “1 sponsorship … not linked” → Link them links it to Acme without a new company; Acme’s record on the MGA shows its own sponsorship and the contact',r['on'] and r['edit'] and r['n']==2 and '1 sponsorship' in r['banner'] and r['linked'] and r['same'] and r['rows']==['Member-Member'] and r['people']==1 and r['noBanner'],r,me)
        r=await pg.evaluate("()=>{ const c=companyByName('Acme Bank'); const rows=sponsorshipsOf(c); return rows.map(x=>[x.org,x.name,x.pledged,x.received,x.own,x.linked]); }")
        bad+=check('the club hub sees both sponsorships: its own tournament and the MGA’s (read-only, named by organization)',sorted(r)==sorted([['WCCC','Data Center Open',5000,2500,True,True],['MGA','Member-Member',1000,1000,False,True]]),r)
        await A.close(); await B.close()
        # ---- 8. a scoped board login: the list arrives in the cut-down club document, read-only
        f2=FakeDB(); f2.seed_tenant('wccc','Walnut Creek Country Club',{'golf':True},hosts=['app.wcccmga.org'],login_email='pro@wccc.org',plan='golf')
        cd=club_doc('Walnut Creek Country Club',[{'id':'mga','kind':'association','name':'Men’s Golf Association','short':'MGA'}]); cd['companies']=[{'id':'c1','name':'Acme Bank','city':'Walnut Creek','log':[]}]; cd['members']=[{'id':'p1','first':'Dana','last':'Decides','company':'c1','title':'President','ctypes':['Golfer'],'status':'Active'}]
        f2.seed('mga_hub','club',cd); f2.seed('mga_hub','mga',org_doc('mga','Men’s Golf Association','MGA'))
        f2.seed_login('pro@wccc.org','wccc','staff',name='Head Pro'); f2.seed_login('mgaboard@x.org','wccc','org',['mga'],manage=True,name='MGA President'); f2.me='u-mgaboard@x.org'
        C=await b.new_context(); await cloud(C,f2); sp,se=await open_page(C,'?org=mga&tenant=app.wcccmga.org',ready="()=>cloudReady&&db&&db.id==='mga'")
        r=await sp.evaluate("""async()=>{ go('companies'); await new Promise(r=>setTimeout(r,50)); const list=[...document.querySelectorAll('#main [data-co]')].map(r=>r.querySelector('b').textContent); const add=!!document.getElementById('coAdd'); go('company',{companyId:'c1'}); await new Promise(r=>setTimeout(r,50));
          return {scoped:SCOPED, on:crmOn(), edit:crmEdit(), n:companies().length, list, add, actions:document.querySelectorAll('#main .phead .actions button').length, people:[...document.querySelectorAll('#main [data-ct] .ln')].map(x=>x.textContent.replace(/\\s+/g,' ').trim())}; }""")
        bad+=check('a scoped board login: the companies ride the cut-down club document; the page lists them and the record its people, with no Add / Edit / Log buttons',r['scoped'] and r['on'] and not r['edit'] and r['n']==1 and r['list']==['Acme Bank'] and not r['add'] and r['actions']==0 and r['people']==['DDDana Decides · President'],r,se)
        await C.close(); await b.close()
    print('ALL OK' if not bad else f'{bad} FAILED'); sys.exit(1 if bad else 0)
asyncio.run(main())
