"""Family accounts (family-setup.sql, core.js acctHolderId / familyOf, billing.js membershipFields / acctPost, the portal), against the fake.
Zach Walls is the account holder; Kelsey (spouse, may pay) and Beckham (child, may not) are sub-accounts. A charge to Beckham lands on
Zach's account with Beckham's name on the line; Member accounts lists Zach alone, "family of 3"; Beckham's account page is Zach's; the
register finds Beckham as family and charges the family account; the editor makes a new person a family member; Kelsey's portal is
Zach's account with a Pay button, Beckham's has none and the payments function refuses him. Run: python3 tests/test_family.py"""
import asyncio,sys,json
from playwright.async_api import async_playwright
from _harness import FakeDB,cloud,page
def club_doc():
    return {'v':2,'id':'club','kind':'club','name':'Walnut Creek Country Club','short':'Walnut Creek','members':[
        {'id':'zw','first':'Zach','last':'Walls','email':'zach@x.org','memberNo':'1500','status':'Active','billing':{'class':'full','status':'active','since':'2015-03-01','until':''}},
        {'id':'kw','first':'Kelsey','last':'Walls','email':'kelsey@x.org','memberNo':'1500-1','status':'Active','account':{'of':'zw','rel':'spouse','pay':True}},
        {'id':'bw','first':'Beckham','last':'Walls','email':'beckham@x.org','memberNo':'1500-3','status':'Active','account':{'of':'zw','rel':'child','pay':False}},
        {'id':'tw','first':'Ty','last':'Webb','email':'ty@x.org','memberNo':'1012','status':'Active','billing':{'class':'full','status':'active','since':'2004-06-01','until':''}}],
        'orgs':[],'activeSeason':'2026','seasons':{},'board':[],'tournaments':[],'billing':{'classes':[{'id':'full','name':'Full Golf','charges':[{'id':'c1','itemId':'dues','amount':750,'every':'month','month':1}],'minimum':{'amount':0,'every':'quarter'}}],'tax':{'rate':0},'svc':{'rate':18}},
        'pos':{'outlets':[{'id':'grill','name':'Grill','kind':'fnb','item':'fnb','dept':'fnb','expos':[],'tables':[],'menus':[]}],'products':[{'id':'pr1','outlet':'grill','cat':'Lunch','name':'Club sandwich','price':14,'sku':'','taxable':None,'svc':None,'track':False,'stock':0,'active':True}]}}
async def open_page(ctx,q,ready="()=>cloudReady"):
    pg=await ctx.new_page(); errs=[]; pg.on('pageerror',lambda e:errs.append(str(e)))
    await pg.goto(page('index.html')+q)
    try: await pg.wait_for_function(ready,timeout=15000)
    except Exception: pass
    await pg.wait_for_timeout(400); return pg,errs
def check(label,ok,r,errs=None):
    print(('OK  ' if ok else 'FAIL'),label,r,errs or ''); return 0 if ok else 1
async def main():
    bad=0; fdb=FakeDB()
    fdb.seed_tenant('wccc','Walnut Creek Country Club',{'golf':True,'billing':True,'pos':True,'club':True},hosts=['app.wcccmga.org'],login_email='pro@wccc.org',plan='club')
    fdb.seed('mga_hub','club',club_doc())
    fdb.seed_login('pro@wccc.org','wccc','staff',name='Head Pro'); fdb.seed_login('kelsey@x.org',name='Kelsey'); fdb.seed_login('beckham@x.org',name='Beckham')
    async with async_playwright() as p:
        b=await p.chromium.launch()
        fdb.me='u-pro@wccc.org'; c1=await b.new_context(); await cloud(c1,fdb); hub,e1=await open_page(c1,'?org=club&tenant=app.wcccmga.org')
        # 1. the model and the directory
        r=await hub.evaluate("""()=>{ go('members'); const row=[...document.querySelectorAll('[data-m]')].find(x=>x.textContent.includes('Kelsey')); return {holder:acctHolderId('kw'), own:acctHolderId('zw'), sub:isSubAccount(personById('bw')), fam:familyOf('zw').map(p=>p.first).sort(), label:familyLabel(personById('bw')), row:row&&row.textContent.includes('Spouse of Zach Walls'), billable:[billable(personById('zw'),'2026-11'),billable(personById('kw'),'2026-11')]}; }""")
        bad+=check('the model: the holder, the family, the labels; a family member is not billed on their own',r['holder']=='zw' and r['own']=='zw' and r['sub'] and r['fam']==['Beckham','Kelsey'] and r['label']=='Child of Zach Walls' and r['row'] and r['billable']==[True,False],r,e1)
        # 2. a charge to Beckham lands on Zach, named; Member accounts lists Zach alone; Beckham's page is Zach's, with the Family card
        r=await hub.evaluate("""async()=>{ go('accounts'); await new Promise(r=>setTimeout(r,500)); const it=await acctPost({member_id:'bw',kind:'charge',source:'fnb',item:'fnb',ref:'t:1',descr:'Grill · Club sandwich',amount:16.52,tax:0,svc:2.52});
          render(); await new Promise(r=>setTimeout(r,300)); const names=[...document.querySelectorAll('[data-acct] .ln')].map(x=>x.textContent); const sub=[...document.querySelectorAll('[data-acct] .ls')].map(x=>x.textContent).find(x=>x.includes('family'));
          document.getElementById('acQ').value='beckham'; document.getElementById('acQ').dispatchEvent(new Event('input')); await new Promise(r=>setTimeout(r,200)); const found=[...document.querySelectorAll('[data-acct] .ln')].map(x=>x.textContent);
          go('account',{acctId:'bw'}); await new Promise(r=>setTimeout(r,400)); const title=document.querySelector('#main .h1').textContent, famCard=document.querySelector('#main [data-fam]'), famRows=document.querySelectorAll('#main [data-fam]').length, ledger=document.body.textContent.includes('Beckham Walls · Grill · Club sandwich');
          return {member:it.member_id, by:it.by_member, descr:it.descr, names, sub, found, title, famRows, ledger, bal:balanceOf('zw')}; }""")
        bad+=check('a charge to the child posts on the holder with the child\'s name; Member accounts lists the holder alone, found by a family name; the child\'s page is the holder\'s with the Family card',r['member']=='zw' and r['by']=='bw' and r['descr']=='Beckham Walls · Grill · Club sandwich' and r['names']==['Zach Walls'] and 'family of 3' in (r['sub'] or '') and r['found']==['Zach Walls'] and r['title']=='Zach Walls' and r['famRows']==2 and r['ledger'] and r['bal']==16.52,r,e1)
        # 3. the register finds the family member and charges the family account
        r=await hub.evaluate("""async()=>{ navGo('pos'); await new Promise(r=>setTimeout(r,500)); const q=document.getElementById('psM'); q.value='beck'; q.dispatchEvent(new Event('input')); await new Promise(r=>setTimeout(r,100)); const hit=document.querySelector('#psML [data-pk]'); const label=hit&&hit.textContent; hit.click(); await new Promise(r=>setTimeout(r,200));
          document.querySelector('[data-pp]').click(); await new Promise(r=>setTimeout(r,200)); const before=(ACCT.items||[]).length; document.getElementById('psAcct').click(); await new Promise(r=>setTimeout(r,800)); const it=(ACCT.items||[]).filter(i=>i.ref&&i.ref.startsWith('pos:')).pop();
          return {label, posted:(ACCT.items||[]).length-before, member:it&&it.member_id, by:it&&it.by_member, descr:it&&it.descr}; }""")
        bad+=check('the register: the child shows as family, the check charges the family account, named',r['label'] and 'Child of Zach Walls' in r['label'] and r['posted']==1 and r['member']=='zw' and r['by']=='bw' and (r['descr'] or '').startswith('Beckham Walls · Grill'),r,e1)
        # 4. the editor: a new person becomes a family member of Zach; Kelsey's editor shows the family fields
        r=await hub.evaluate("""async()=>{ go('members'); await new Promise(r=>setTimeout(r,200)); editMember(null); await new Promise(r=>setTimeout(r,200)); document.getElementById('mfF').value='Camden'; document.getElementById('mfL').value='Walls'; const sel=document.getElementById('bmAcc'); sel.value='sub'; sel.dispatchEvent(new Event('change'));
          const q=document.getElementById('bmHq'); q.value='zach'; q.dispatchEvent(new Event('input')); await new Promise(r=>setTimeout(r,100)); document.querySelector('#bmHl [data-hk]').click(); document.getElementById('bmRel').value='child'; document.getElementById('dSave').click(); await new Promise(r=>setTimeout(r,400));
          const c=persons().find(p=>p.first==='Camden'); editMember(memberById('kw')); await new Promise(r=>setTimeout(r,200)); const k={acc:document.getElementById('bmAcc').value, holder:document.getElementById('bmHq').value, pay:document.getElementById('bmPay').checked, ownHidden:document.getElementById('bmOwn').hidden}; closeDrawer();
          return {camden:c&&c.account, cls:c&&(c.billing||{}).class, fam:familyOf('zw').length, k}; }""")
        bad+=check('the editor: a new person attached to the holder as a child; the spouse\'s editor shows the family fields',r['camden'] and r['camden']['of']=='zw' and r['camden']['rel']=='child' and r['camden']['pay']==False and not r['cls'] and r['fam']==3 and r['k']=={'acc':'sub','holder':'Zach Walls','pay':True,'ownHidden':True},r,e1)
        # 5. the portal: Kelsey sees the family account and may pay; Beckham sees it and may not
        async def portal(email):
            fdb.me='u-'+email; c=await b.new_context(); await cloud(c,fdb); pt=await c.new_page(); e=[]; pt.on('pageerror',lambda x:e.append(str(x)))
            await pt.goto(page('member.html')+'?tenant=app.wcccmga.org'); await pt.wait_for_function("()=>!!ME",timeout=10000); await pt.wait_for_timeout(300)
            r=await pt.evaluate("""async()=>{ await fn({action:'autopay_on'}); const r={error:LASTERR}; return {member:ME.member.id, sub:ME.sub&&ME.sub.first, holder:ME.holderName, canPay:ME.canPay, family:ME.family, title:document.getElementById('hTitle').textContent, banner:(document.querySelector('.pv')||{}).textContent||'', pay:!!document.getElementById('payOther'), hint:[...document.querySelectorAll('.hint')].map(x=>x.textContent).find(x=>x.includes('made by'))||'', items:(ME.items||[]).length, fnErr:r&&r.error}; }""")
            await c.close(); return r,e
        fdb.payaccts['wccc']={'env':'sandbox','client_id':'0oaia0u0c0qpG7R4C1d7','client_secret':'s','partner_token':'pt','hpf_token':'h','webhook_secret':'','status':{'ok':True,'at':'2026-11-20T00:00:00Z','message':'Connected'}}
        T=next(t for t in fdb._rows('tenants') if t['slug']=='wccc'); T['pay_status']={'ok':True,'env':'sandbox'}
        rk,ek=await portal('kelsey@x.org'); rb,eb=await portal('beckham@x.org')
        bad+=check('the portal: the spouse signs in to the family account and may pay',rk['member']=='zw' and rk['sub']=='Kelsey' and rk['holder']=='Zach Walls' and rk['canPay'] is True and sorted(rk['family'])==['Beckham Walls','Camden Walls','Kelsey Walls'] and rk['title']=='Zach Walls' and 'signed in as Kelsey Walls' in rk['banner'] and rk['pay'] and rk['items']==2 and 'account holder' not in (rk['fnErr'] or ''),rk,ek)
        bad+=check('the portal: the child sees the family account, cannot pay, and the payments function refuses him',rb['member']=='zw' and rb['sub']=='Beckham' and rb['canPay'] is False and not rb['pay'] and 'made by Zach Walls' in rb['hint'] and rb['items']==2 and 'account holder' in (rb['fnErr'] or ''),rb,eb)
        # 6. gender and charge privileges (the owner, Nov 24): the editor's Gender select; Beckham loses his charge privileges — the hub register and a
        #    booking fee refuse him, the account page and the Family card say so, a legacy `sex` reads as gender
        r=await hub.evaluate("""async()=>{ go('members'); await new Promise(r=>setTimeout(r,200)); editMember(memberById('bw')); await new Promise(r=>setTimeout(r,200)); const g=document.getElementById('mfSex'); const opts=[...g.options].map(o=>o.value); g.value='M'; document.getElementById('mfDob').value='2018-11-30'; const cb=document.getElementById('bmCharge'); const was=cb.checked; cb.checked=false; document.getElementById('dSave').click(); await new Promise(r=>setTimeout(r,400));
          const bw=personById('bw'); personById('tw').sex='F';
          navGo('pos'); await new Promise(r=>setTimeout(r,500)); const q=document.getElementById('psM'); q.value='beck'; q.dispatchEvent(new Event('input')); await new Promise(r=>setTimeout(r,100)); const hit=document.querySelector('#psML [data-pk]'); const label=hit&&hit.textContent; hit.click(); await new Promise(r=>setTimeout(r,200));
          document.querySelector('[data-pp]').click(); await new Promise(r=>setTimeout(r,200)); const before=(ACCT.items||[]).length; document.getElementById('psAcct').click(); await new Promise(r=>setTimeout(r,800)); const t=POS.cur&&POS.cur.member_id==='bw'&&POS.cur.status==='open'&&POS.cur.lines.length===1;
          bookSettings(); const f=CLUB.booking.facilities[0]; f.fee={item:'tee',amount:25,per:'booking'}; const bk=await bkSave({id:'bk1',facility:f.id,date:'2027-01-05',time:'09:00',unit:1,member_id:'bw',players:[],status:'booked'},true);
          go('account',{acctId:'zw'}); await new Promise(r=>setTimeout(r,400)); const chips=[...document.querySelectorAll('#main .chip')].map(x=>x.textContent); const famTxt=[...document.querySelectorAll('#main [data-fam]')].map(x=>x.textContent).find(x=>x.includes('Beckham'))||''; const born=famTxt.includes('born Nov 30, 2018');
          go('members'); view.mfilter='No birthday'; render(); await new Promise(r=>setTimeout(r,200)); const noDob=[...document.querySelectorAll('[data-m]')].map(x=>x.querySelector('b')?x.querySelector('b').textContent:x.textContent.slice(0,20)); return {opts, gender:bw.gender, dob:bw.dob, age:ageOf('2018-11-30','2026-11-24'), noDob:noDob.length, was, charge:bw.account&&bw.account.charge, can:[canCharge('bw'),canCharge('zw'),canCharge('kw')], label, posted:(ACCT.items||[]).length-before, open:!!t, bk, chips:chips.filter(c=>c.includes('charge')), fam:famTxt.includes('no charge privileges'), born, set:personSet(personById('tw')), set2:personSet(bw)}; }""")
        bad+=check('gender and charge privileges: the editor saves gender; the child without privileges is refused at the hub register and for a booking fee, the Family card says so, the family keeps theirs',r['opts']==['','M','F','X'] and r['gender']=='M' and r['dob']=='2018-11-30' and r['age']==7 and r['noDob']==4 and r['was'] is True and r['charge'] is False and r['can']==[False,True,True] and 'no charging' in (r['label'] or '') and r['posted']==0 and r['open'] and r['bk'] is False and r['chips']==[] and r['fam'] and r['born'] and r['set']=='W' and r['set2']=='M',r,e1)
        # 7. the holder's switch takes the whole family off; the fake's station and portal paths refuse the same way
        r=await hub.evaluate("""async()=>{ personById('bw').account.charge=true; personById('zw').account={charge:false}; persist(); await new Promise(r=>setTimeout(r,600)); go('account',{acctId:'zw'}); await new Promise(r=>setTimeout(r,400)); const chips=[...document.querySelectorAll('#main .chip')].map(x=>x.textContent);
          return {can:[canCharge('bw'),canCharge('zw'),canCharge('kw')], chip:chips.some(c=>c==='No charge privileges')}; }""")
        bad+=check('the holder without privileges takes the family off',r['can']==[False,False,False] and r['chip'],r,e1)
        bad+=bool(e1); print('hub errors',e1)
        await b.close()
    print('ALL OK' if not bad else f'{bad} FAILED'); sys.exit(1 if bad else 0)
asyncio.run(main())
