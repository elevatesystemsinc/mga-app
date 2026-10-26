"""Tenants, the portal and login scope against the fake database (tenants-setup.sql + portal-setup.sql semantics).
Run: python3 tests/test_tenants.py
Checks: the host picks the tenant and the club's name; each tenant reads and writes only its own rows; an unknown
address, a suspended / inactive tenant and a login from another club are refused; the portal (admins only) lists
clients by status, keeps a client record (contacts, staff logins through the admin-users function and without it,
modules, status), creates a client with its first staff login, and manages the team; a staff login manages board
logins from the club hub; a board login (role org) lands on its own hub, sees a cut-down club document, no club hub,
and a board administrator invites its own board; an invite link asks for a password on arrival."""
import asyncio,sys,json,uuid
from playwright.async_api import async_playwright
from _harness import FakeDB,cloud,page
def U(): return str(uuid.uuid4())
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
async def main():
  bad=0
  fdb=FakeDB()
  fdb.seed_tenant('wccc','Walnut Creek Country Club',{'golf':True},hosts=['app.wcccmga.org'],login_email='pro@wccc.org',plan='golf')
  fdb.seed_tenant('pines','The Pines Golf Club',{'golf':True,'club':True,'billing':True},login_email='gm@pines.org',plan='club')
  fdb.seed('mga_hub','club',club_doc('Walnut Creek Country Club',[{'id':'mga','kind':'association','name':'Men’s Golf Association','short':'MGA'},{'id':'misfits','kind':'group','name':'The Misfits','short':'Misfits'}]))
  fdb.seed('mga_hub','mga',org_doc('mga','Men’s Golf Association','MGA')); fdb.seed('mga_hub','misfits',org_doc('misfits','The Misfits','Misfits','group'))
  fdb.seed('mga_hub','club',club_doc('The Pines Golf Club',[{'id':'mga','kind':'association','name':'Pines Men’s Club','short':'PMC'}]),tenant='pines')
  fdb.seed_login('pro@wccc.org','wccc','staff',name='Head Pro'); fdb.seed_login('gm@pines.org','pines','staff',name='GM')
  fdb.seed_login('mgaboard@x.org','wccc','org',['mga'],manage=True,name='MGA President'); fdb.seed_login('member@x.org','wccc','org',['mga'],name='MGA Treasurer')
  fdb.seed_login('zach@flagstick.test',admin=True,name='Zach')
  async with async_playwright() as pw:
    b=await pw.chromium.launch()
    # ---- 1. staff logins: two tenants, two club documents, separate writes
    fdb.me='u-pro@wccc.org'
    c1=await b.new_context(); await cloud(c1,fdb)
    p1,e1=await open_page(c1,'?org=club&tenant=app.wcccmga.org')
    r1=await p1.evaluate("()=>({t:TENANT,name:CLUB.name,nav:[...document.querySelectorAll('#nav [data-go]')].map(b=>b.dataset.go),orgs:CLUB.orgs.map(o=>o.id),scoped:SCOPED})")
    bad+=check('staff login: host → tenant, whole club, Logins page in the nav',r1['t']=='wccc' and r1['name']=='Walnut Creek Country Club' and 'collections' in r1['nav'] and 'logins' in r1['nav'] and r1['orgs']==['mga','misfits'] and not r1['scoped'] and not e1,r1,e1)
    fdb.me='u-gm@pines.org'
    c2=await b.new_context(); await cloud(c2,fdb)
    p2,e2=await open_page(c2,'?org=club&tenant=pines')
    r2=await p2.evaluate("()=>({t:TENANT,name:CLUB.name,orgs:CLUB.orgs.map(o=>o.id),mods:[hasModule('associations'),hasModule('groups'),hasModule('club'),hasModule('pos')]})")
    bad+=check('golf management includes associations and groups; Club management includes point of sale',r2['t']=='pines' and r2['name']=='The Pines Golf Club' and r2['orgs']==['mga'] and r2['mods']==[True,True,True,True] and not e2,r2,e2)
    before=dict(fdb.writes)
    await p2.evaluate("()=>{ CLUB.name='The Pines Golf & Country Club'; persist(); }")
    await p2.wait_for_function("()=>openDocs().every(D=>D.st==='synced'&&!D.pushing&&!D.saveT)",timeout=10000); await p2.wait_for_timeout(300)
    w={k:v-before.get(k,0) for k,v in fdb.writes.items() if v-before.get(k,0)}
    srv=(fdb.get('mga_hub','club','pines') or {}).get('name'), (fdb.get('mga_hub','club') or {}).get('name')
    bad+=check('a save goes to the tenant’s own row',w=={'pines/club':1} and srv==('The Pines Golf & Country Club','Walnut Creek Country Club'),(w,srv))
    p3,e3=await open_page(c1,'?org=misfits&tenant=app.wcccmga.org')
    r=await p3.evaluate("()=>({name:db&&db.name,h1:document.querySelector('#main h1').textContent})")
    bad+=check('a small group’s hub opens on the golf plan',r['name']=='The Misfits' and r['h1']!='Not included in your plan' and not e3,r,e3)
    # ---- 2. the club hub's Logins page (staff): staff list, board logins per organization, invite a board member
    fdb.me='u-pro@wccc.org'
    r=await p1.evaluate("""()=>{ go('logins'); return new Promise(res=>setTimeout(()=>res({h1:document.querySelector('#main h1').textContent, rows:[...document.querySelectorAll('[data-lu]')].map(r=>r.querySelector('small').textContent), cards:[...document.querySelectorAll('#main h2')].map(h=>h.textContent)}),800)); }""")
    bad+=check('Logins page: staff, then each organization’s board logins',r['h1']=='Logins' and r['rows']==['pro@wccc.org','mgaboard@x.org','member@x.org'] and r['cards'][:2]==['Staff','MGA · board logins'] and any('Misfits' in c for c in r['cards']),r)
    await p1.evaluate("""()=>{ document.getElementById('lgInv_misfits').click(); document.getElementById('lgE').value='dave@x.org'; document.getElementById('lgN').value='Dave'; document.getElementById('lgMan').checked=true; document.getElementById('dSave').click(); }""")
    await p1.wait_for_function("()=>document.getElementById('dTitle').textContent==='Invite sent'",timeout=8000)
    u=next((x for x in fdb._rows('tenant_users') if x['email']=='dave@x.org'),None)
    bad+=check('staff invite a board administrator for a small group through the function',u and u['role']=='org' and u['orgs']==['misfits'] and u['manage'] and u['tenant']=='wccc' and any(a['email']=='dave@x.org' and a.get('invited') for a in fdb.auth_users),u)
    await p1.evaluate("()=>closeDrawer()")
    # ---- 3. a board login: lands on its own hub, cut-down club document, no club hub, the Board page invites
    fdb.me='u-mgaboard@x.org'
    c3=await b.new_context(); await cloud(c3,fdb)
    p4,e4=await open_page(c3,'?org=club&tenant=app.wcccmga.org',ready="()=>cloudReady&&db&&db.id==='mga'")
    r=await p4.evaluate("()=>({org:db&&db.id,scoped:SCOPED,orgs:CLUB.orgs.map(o=>o.id),members:CLUB.members.length,nav:[...document.querySelectorAll('#nav [data-go]')].map(b=>b.dataset.go),sw:document.getElementById('btnSwitch').hidden,url:location.search})")
    bad+=check('board login lands on the MGA with a cut-down club document and no club hub',r['org']=='mga' and r['scoped'] and r['orgs']==['mga'] and r['members']==1 and 'logins' not in r['nav'] and 'board' in r['nav'] and r['sw'] and 'org=mga' in r['url'] and not e4,r,e4)
    r=await p4.evaluate("""()=>{ const keep=db; db=null; render(); const r=[...document.querySelectorAll('[data-org]')].map(b=>b.dataset.org); db=keep; render(); return r; }""")
    bad+=check('the picker offers only its organization',r==['mga'],r)
    p5,e5=await open_page(c3,'?org=misfits&tenant=app.wcccmga.org',ready="()=>cloudReady")
    r=await p5.evaluate("()=>({h1:document.querySelector('#main h1').textContent,db:!!db})")
    bad+=check('another organization’s hub is not theirs',r['h1']=='Not your hub' and not r['db'] and not e5,r,e5)
    before=dict(fdb.writes)
    await p4.evaluate("()=>{ const p=upsertMember(null,{first:'New',last:'Person',email:'new@x.org',status:'Active'}); persist(); }")
    await p4.wait_for_function("()=>openDocs().every(D=>D.st==='synced'&&!D.pushing&&!D.saveT)",timeout=10000); await p4.wait_for_timeout(300)
    w={k:v-before.get(k,0) for k,v in fdb.writes.items() if v-before.get(k,0)}
    bad+=check('a board login adds a person through scoped_people and saves its own row directly',w.get('club')==1 and w.get('mga')==1 and len(fdb.get('mga_hub','club')['members'])==2,w)
    r=await p4.evaluate("""()=>{ go('board'); return new Promise(res=>setTimeout(()=>res({cards:[...document.querySelectorAll('#main h2')].map(h=>h.textContent), rows:[...document.querySelectorAll('[data-lu]')].map(r=>r.querySelector('small').textContent)}),800)); }""")
    bad+=check('the Board page shows the board’s logins to a board administrator','Board logins' in r['cards'] and r['rows']==['mgaboard@x.org','member@x.org'],r)
    await p4.evaluate("""()=>{ document.getElementById('lgInv_mga').click(); document.getElementById('lgE').value='sec@x.org'; document.getElementById('lgN').value='Secretary'; document.querySelector('#lgMode [data-v=set]').click(); document.getElementById('lgPw').value='Secret-Pass-1'; document.getElementById('dSave').click(); }""")
    await p4.wait_for_function("()=>document.getElementById('dTitle').textContent==='Login created'",timeout=8000)
    u=next((x for x in fdb._rows('tenant_users') if x['email']=='sec@x.org'),None); au=next((a for a in fdb.auth_users if a['email']=='sec@x.org'),None)
    bad+=check('a board administrator creates a board login with a password',u and u['role']=='org' and u['orgs']==['mga'] and not u['manage'] and au and au['password']=='Secret-Pass-1',u)
    fdb.me='u-member@x.org'
    c4=await b.new_context(); await cloud(c4,fdb)
    p6,e6=await open_page(c4,'?org=mga&tenant=app.wcccmga.org')
    r=await p6.evaluate("""()=>{ go('board'); return new Promise(res=>setTimeout(()=>res({cards:[...document.querySelectorAll('#main h2')].map(h=>h.textContent), can:canManageLogins('mga')}),600)); }""")
    bad+=check('a plain board member sees no login management','Board logins' not in r['cards'] and not r['can'] and not e6,r,e6)
    # ---- 4. refusals: unknown address, suspended, inactive, another club's login
    p7,e7=await open_page(c1,'?org=club&tenant=nowhere.flagstickhub.com',ready="()=>document.querySelector('#main h1')")
    r=await p7.evaluate("()=>document.querySelector('#main h1').textContent")
    bad+=check('unknown address',r=='No club at this address' and not e7,r,e7)
    fdb.me='u-gm@pines.org'
    for st in ('suspended','inactive'):
        for t in fdb._rows('tenants'):
            if t['slug']=='pines': t['status']=st
        p8,e8=await open_page(c2,'?org=club&tenant=pines')
        r=await p8.evaluate("()=>document.querySelector('#main').textContent")
        bad+=check(st+' tenant shows the paused notice','paused' in r and not e8,st)
    for t in fdb._rows('tenants'):
        if t['slug']=='pines': t['status']='active'
    fdb.me='u-gm@pines.org'
    c5=await b.new_context(); await cloud(c5,fdb)
    p9,e9=await open_page(c5,'?org=club&tenant=app.wcccmga.org',ready="()=>document.getElementById('login').classList.contains('show')")
    r=await p9.evaluate("()=>({login:document.getElementById('login').classList.contains('show'), err:document.getElementById('loginErr').textContent, email:document.getElementById('loginEmail').value, club:document.getElementById('loginClub').textContent})")
    bad+=check('a login from another club is refused; the card names the tenant and its e-mail',r['login'] and 'does not belong' in r['err'] and r['email']=='pro@wccc.org' and r['club']=='Walnut Creek Country Club' and not e9,r,e9)
    # ---- 5. the portal
    p10,e10=await open_page(c5,'?portal=1',ready="()=>document.getElementById('login').classList.contains('show')")
    r=await p10.evaluate("()=>({login:document.getElementById('login').classList.contains('show'), err:document.getElementById('loginErr').textContent, sub:document.getElementById('loginSub').textContent})")
    bad+=check('portal refuses a club login',r['login'] and 'administrator' in r['err'] and r['sub']=='Administrator sign-in' and not e10,r,e10)
    fdb.me='u-zach@flagstick.test'; fdb.admin=True
    c6=await b.new_context(); await cloud(c6,fdb)
    pp,ep=await open_page(c6,'?portal=1',ready="()=>PS.tenants&&PS.tenants.length")
    r=await pp.evaluate("()=>({rows:[...document.querySelectorAll('[data-t]')].map(r=>r.dataset.t), title:document.querySelector('#main h1').textContent, chips:[...document.querySelectorAll('[data-t=\"pines\"] .chip')].map(c=>c.textContent), nav:[...document.querySelectorAll('#nav [data-pv]')].map(b=>b.dataset.pv), sync:document.getElementById('syncTxt').textContent})")
    bad+=check('portal lists the active clients with their modules',r['rows']==['pines','wccc'] and r['title']=='Clients' and r['chips']==['Golf management','Club management','Active'] and r['nav']==['clients','team','activity'] and r['sync']=='Signed in as board@test' and not ep,r,ep)
    await pp.evaluate("()=>{ document.querySelector('[data-t=\"wccc\"]').click(); }"); await pp.wait_for_timeout(300)
    r=await pp.evaluate("()=>({h1:document.querySelector('#main h1').textContent, cards:[...document.querySelectorAll('#main h2')].map(h=>h.textContent.trim()), staff:[...document.querySelectorAll('[data-u]')].map(x=>x.querySelector('small').textContent), board:[...document.querySelectorAll('.card .tr')].filter(x=>x.textContent.includes('Board')).length})")
    bad+=check('client record: subscription, details, contacts, staff logins, board logins, activity',r['h1']=='Walnut Creek Country Club' and r['cards'][:5]==['Subscription','Club details','Points of contact','Staff logins','Board logins · managed by the club'] and r['staff']==['pro@wccc.org'] and r['board']>=4,r)
    await pp.evaluate("""()=>{ document.getElementById('ptAddC').click(); document.getElementById('pcN').value='Jane Doe'; document.getElementById('pcT').value='Head Golf Professional'; document.getElementById('pcE').value='jane@wccc.org'; document.getElementById('pcPri').checked=true; document.getElementById('dSave').click(); }""")
    await pp.wait_for_timeout(500)
    r=await pp.evaluate("()=>[...document.querySelectorAll('[data-c] b')].map(b=>b.textContent.trim())")
    bad+=check('add a point of contact',r==['Jane Doe Primary'] and any(c['name']=='Jane Doe' and c['is_primary'] for c in fdb._rows('tenant_contacts')),r)
    await pp.evaluate("""()=>{ document.getElementById('ptAddU').click(); document.getElementById('puE').value='asst@wccc.org'; document.getElementById('puN').value='Assistant Pro'; document.getElementById('puPw').value='Chosen-Pass-9'; document.getElementById('dSave').click(); }""")
    await pp.wait_for_function("()=>document.getElementById('dTitle').textContent==='Login created'",timeout=8000)
    r=await pp.evaluate("()=>document.getElementById('dBody').textContent")
    u=next((x for x in fdb._rows('tenant_users') if x['email']=='asst@wccc.org'),None); au=next((a for a in fdb.auth_users if a['email']=='asst@wccc.org'),None)
    bad+=check('create a staff login with a password Flagstick sets','Chosen-Pass-9' in r and u and u['role']=='staff' and au and au['password']=='Chosen-Pass-9' and au['confirmed'],u)
    await pp.evaluate("()=>closeDrawer()")
    await pp.evaluate("""()=>{ document.querySelector('[data-u=\"u-asst@wccc.org\"]').click(); document.getElementById('puPw').value='Another-Pass-7'; document.getElementById('puSet').click(); }""")
    await pp.wait_for_function("()=>document.getElementById('puMsg').textContent.includes('Password set')",timeout=8000)
    au=next((a for a in fdb.auth_users if a['email']=='asst@wccc.org'),None)
    bad+=check('set a staff password later',au and au['password']=='Another-Pass-7',au and au['password'])
    await pp.evaluate("()=>closeDrawer()")
    await pp.evaluate("()=>{ document.querySelector('[data-mod=club]').checked=true; document.getElementById('ptModSave').click(); }"); await pp.wait_for_timeout(500)
    t=next(t for t in fdb._rows('tenants') if t['slug']=='wccc')
    bad+=check('modules saved from the record page',t['modules']=={'golf':True,'club':True,'pos':True,'billing':True} and any(e['kind']=='modules' and e['tenant']=='wccc' for e in fdb._rows('tenant_events')),t['modules'])
    await pp.evaluate("""()=>{ document.getElementById('ptStatus').click(); document.querySelector('#ptSt [data-v=inactive]').click(); document.getElementById('ptWhy').value='moved on'; document.getElementById('dSave').click(); }"""); await pp.wait_for_timeout(500)
    await pp.evaluate("()=>{ document.getElementById('ptBack').click(); }"); await pp.wait_for_timeout(300)
    r=await pp.evaluate("()=>[...document.querySelectorAll('[data-t]')].map(r=>r.dataset.t)")
    await pp.evaluate("()=>{ document.querySelector('#ptFilter [data-v=inactive]').click(); }"); await pp.wait_for_timeout(200)
    r2=await pp.evaluate("()=>[...document.querySelectorAll('[data-t]')].map(r=>r.dataset.t)")
    t=next(t for t in fdb._rows('tenants') if t['slug']=='wccc')
    bad+=check('status → inactive moves the client to the Inactive list with an effective date',r==['pines'] and r2==['wccc'] and t['status']=='inactive' and t['ended_on'] and any('moved on' in e['text'] for e in fdb._rows('tenant_events')),(r,r2,t['status']))
    # fallback without the function: a login is still created by sign-up and the note shows
    fdb.fn=False
    await pp.evaluate("()=>{ document.querySelector('#ptFilter [data-v=active]').click(); document.querySelector('[data-t=\"pines\"]').click(); }"); await pp.wait_for_timeout(300)
    await pp.evaluate("""()=>{ document.getElementById('ptAddU').click(); document.getElementById('puE').value='fb@pines.org'; document.getElementById('dSave').click(); }""")
    await pp.wait_for_function("()=>document.getElementById('dTitle').textContent==='Login created'",timeout=8000)
    r=await pp.evaluate("()=>document.getElementById('dBody').textContent")
    u=next((x for x in fdb._rows('tenant_users') if x['email']=='fb@pines.org'),None)
    bad+=check('without the function a login is still created (sign-up) and the deploy note shows','Password:' in r and 'not deployed' in r and u and u['role']=='staff' and u['tenant']=='pines',u)
    fdb.fn=True; await pp.evaluate("()=>closeDrawer()")
    # new client with its first staff login
    await pp.evaluate("""()=>{ PS.view='clients'; vPortal(document.getElementById('main')); document.getElementById('ptNew').click(); document.getElementById('ptN').value='Oak Ridge Golf Club'; document.getElementById('ptS').value='ORGC'; document.getElementById('ptSlug').value='oakridge';
      document.getElementById('ptCity').value='Tulsa'; document.getElementById('ptState').value='OK'; document.getElementById('ptLE').value='pro@oakridge.org'; document.getElementById('ptLN').value='Oak Pro'; document.getElementById('dSave').click(); }""")
    await pp.wait_for_function("()=>document.getElementById('dTitle').textContent==='Login created'",timeout=10000)
    t=next((t for t in fdb._rows('tenants') if t.get('slug')=='oakridge'),None); u=next((x for x in fdb._rows('tenant_users') if x['tenant']=='oakridge'),None); club=fdb.get('mga_hub','club','oakridge')
    r={'tenant':t and (t['plan'],t['modules'],t['status'],t['address'].get('city')),'user':u and (u['email'],u['role']),'club':club and (club.get('name'),club.get('orgs'))}
    bad+=check('new client: tenant row, club document, first staff login, record page open',r['tenant']==('golf',{'golf':True},'active','Tulsa') and r['user']==('pro@oakridge.org','staff') and r['club']==('Oak Ridge Golf Club',[]) and await pp.evaluate("()=>PS.view==='client'&&PS.slug==='oakridge'"),r)
    await pp.evaluate("()=>closeDrawer()")
    r=await pp.evaluate("""()=>{ document.querySelector('[data-pv=team]').click(); return [...document.querySelectorAll('[data-rm]')].length; }""")
    bad+=check('team page lists the Flagstick administrators',r==1,r)
    await pp.evaluate("""()=>{ document.getElementById('ptAddA').click(); document.getElementById('paE').value='ops@flagstick.test'; document.getElementById('paN').value='Ops'; document.getElementById('dSave').click(); }""")
    await pp.wait_for_function("()=>document.getElementById('dTitle').textContent==='Login created'",timeout=8000)
    bad+=check('add a Flagstick administrator',any(a['email']=='ops@flagstick.test' for a in fdb._rows('flagstick_admins')),[a['email'] for a in fdb._rows('flagstick_admins')])
    # ---- 6. arriving by an invite link: the password screen comes first
    fdb.me='u-pro@wccc.org'; fdb.admin=False
    c7=await b.new_context(); await cloud(c7,fdb)
    pl,el=await open_page(c7,'?org=club&tenant=app.wcccmga.org',ready="()=>document.getElementById('login').classList.contains('show')",hash='#access_token=abc&type=invite')
    r=await pl.evaluate("()=>({sub:document.getElementById('loginSub').textContent, pw2:document.getElementById('loginPw2').hidden, btn:document.getElementById('loginBtn').textContent})")
    bad+=check('an invite link asks for a password first',r['sub'].startswith('Welcome') and not r['pw2'] and r['btn']=='Save password' and not el,r,el)
    await pl.evaluate("()=>{ document.getElementById('loginPw').value='Fresh-Pass-22'; document.getElementById('loginPw2').value='Fresh-Pass-22'; document.getElementById('loginBtn').click(); }")
    await pl.wait_for_function("()=>cloudReady",timeout=10000)
    r=await pl.evaluate("()=>({shown:document.getElementById('login').classList.contains('show'), name:CLUB&&CLUB.name})")
    bad+=check('after saving the password the hub opens',not r['shown'] and r['name']=='Walnut Creek Country Club',r)
    await b.close()
  print('ALL OK' if not bad else f'{bad} FAILED'); sys.exit(1 if bad else 0)
asyncio.run(main())
