"""Tenants against the fake database (tenants-setup.sql semantics). Run: python3 tests/test_tenants.py
Checks: the host picks the tenant and the club's name; each tenant reads and writes only its own rows; module boxes
gate the club-tier pages, the organization kinds and whole hubs; an unknown address, a suspended tenant and a login
that belongs to another club are refused; the portal lists clients and creates one (tenant row, club row, board login)."""
import asyncio,sys,json,uuid
from playwright.async_api import async_playwright
from _harness import FakeDB,cloud,page
def U(): return str(uuid.uuid4())
def club_doc(name,orgs):
    return {'v':2,'id':'club','kind':'club','name':name,'short':name.split()[0],'members':[],'orgs':orgs,'activeSeason':'2026','seasons':{'2026':{}},'tournaments':[],'_rev':3,'_w':'x','_at':1}
async def open_page(ctx,q,ready="()=>cloudReady"):
    pg=await ctx.new_page(); errs=[]; pg.on('pageerror',lambda e:errs.append(str(e)))
    await pg.goto(page('index.html')+q)
    try: await pg.wait_for_function(ready,timeout=15000)
    except Exception: pass
    await pg.wait_for_timeout(400); return pg,errs
async def main():
  bad=0
  fdb=FakeDB()
  fdb.seed_tenant('wccc','Walnut Creek Country Club',{'golf':True,'associations':True,'groups':True,'club':True},hosts=['app.wcccmga.org'],login_email='board@wccc.org',plan='club')
  fdb.seed_tenant('pines','The Pines Golf Club',{'golf':True,'associations':True},login_email='pro@pines.org',plan='golf')
  fdb.seed('mga_hub','club',club_doc('Walnut Creek Country Club',[{'id':'mga','kind':'association','name':'Men’s Golf Association','short':'MGA'},{'id':'misfits','kind':'group','name':'The Misfits','short':'Misfits'}]))
  fdb.seed('mga_hub','club',club_doc('The Pines Golf Club',[{'id':'mga','kind':'association','name':'Pines Men’s Club','short':'PMC'},{'id':'dawn','kind':'group','name':'Dawn Patrol','short':'Dawn'}]),tenant='pines')
  fdb.user_tenants=['wccc','pines']
  async with async_playwright() as pw:
    b=await pw.chromium.launch()
    # ---- 1. two tenants, two club documents, separate writes
    c1=await b.new_context(); await cloud(c1,fdb); c2=await b.new_context(); await cloud(c2,fdb)
    p1,e1=await open_page(c1,'?org=club&tenant=app.wcccmga.org')
    p2,e2=await open_page(c2,'?org=club&tenant=pines')
    r1=await p1.evaluate("()=>({t:TENANT,name:CLUB.name,nav:[...document.querySelectorAll('#nav [data-go]')].map(b=>b.dataset.go),orgs:CLUB.orgs.map(o=>o.id)})")
    r2=await p2.evaluate("()=>({t:TENANT,name:CLUB.name,nav:[...document.querySelectorAll('#nav [data-go]')].map(b=>b.dataset.go),orgs:CLUB.orgs.map(o=>o.id)})")
    ok=r1['t']=='wccc' and r1['name']=='Walnut Creek Country Club' and 'collections' in r1['nav'] and r1['orgs']==['mga','misfits'] \
       and r2['t']=='pines' and r2['name']=='The Pines Golf Club' and 'collections' not in r2['nav'] and 'treasury' not in r2['nav'] and 'budget' not in r2['nav'] and r2['orgs']==['mga','dawn'] and not e1 and not e2
    print('host → tenant, name, club-tier nav', r1, r2, e1+e2, 'OK' if ok else 'FAIL'); bad+=not ok
    before=dict(fdb.writes)
    await p2.evaluate("()=>{ CLUB.name='The Pines Golf & Country Club'; persist(); }")
    await p2.wait_for_function("()=>openDocs().every(D=>D.st==='synced'&&!D.pushing&&!D.saveT)",timeout=10000); await p2.wait_for_timeout(300)
    w={k:v-before.get(k,0) for k,v in fdb.writes.items() if v-before.get(k,0)}
    srv=(fdb.get('mga_hub','club','pines') or {}).get('name'), (fdb.get('mga_hub','club') or {}).get('name')
    ok=w=={'pines/club':1} and srv==('The Pines Golf & Country Club','Walnut Creek Country Club')
    print('a save goes to the tenant’s own row', w, srv, 'OK' if ok else 'FAIL'); bad+=not ok
    # ---- 2. module gates: the Organizations page and a locked hub
    r=await p2.evaluate("()=>{ go('orgs'); return {newGroup:!!document.getElementById('oGrp'), newAssoc:!!document.getElementById('oAssoc'), banner:(document.querySelector('.banner')||{}).textContent||''}; }")
    ok=not r['newGroup'] and r['newAssoc'] and 'Small groups' in r['banner']
    print('organizations page honours the modules', r, 'OK' if ok else 'FAIL'); bad+=not ok
    p3,e3=await open_page(c2,'?org=dawn&tenant=pines')
    r=await p3.evaluate("()=>({h1:document.querySelector('h1').textContent, nav:document.querySelectorAll('#nav button').length})")
    ok=r['h1']=='Not included in your plan' and r['nav']==0 and not e3
    print('a small group’s hub is locked on the golf plan without groups', r, e3, 'OK' if ok else 'FAIL'); bad+=not ok
    p4,e4=await open_page(c2,'?org=mga&tenant=pines')
    r=await p4.evaluate("()=>({name:db&&db.name, h1:document.querySelector('h1').textContent})")
    ok=r['name']=='Pines Men’s Club' and r['h1']!='Not included in your plan' and not e4
    print('an association’s hub opens', r, e4, 'OK' if ok else 'FAIL'); bad+=not ok
    r=await p2.evaluate("()=>{ db=null; render(); return [...document.querySelectorAll('#main h2')].map(h=>h.textContent); }")
    ok='Associations' in r and 'Small groups' not in r
    print('picker shows only the kinds in the plan', r, 'OK' if ok else 'FAIL'); bad+=not ok
    # ---- 3. unknown address, suspended tenant, a login from another club
    p5,e5=await open_page(c1,'?org=club&tenant=nowhere.flagstickhub.com',ready="()=>document.querySelector('#main h1')")
    r=await p5.evaluate("()=>({h1:document.querySelector('#main h1').textContent, login:document.getElementById('login').classList.contains('show')})")
    ok=r['h1']=='No club at this address' and not r['login'] and not e5
    print('unknown address', r, e5, 'OK' if ok else 'FAIL'); bad+=not ok
    for t in fdb._rows('tenants'):
        if t['slug']=='pines': t['status']='suspended'
    p6,e6=await open_page(c2,'?org=club&tenant=pines')
    r=await p6.evaluate("()=>document.querySelector('#main h1').textContent")
    ok=r=='The Pines Golf Club' and 'paused' in await p6.evaluate("()=>document.querySelector('#main').textContent")
    print('suspended tenant shows the notice', r, 'OK' if ok else 'FAIL'); bad+=not ok
    for t in fdb._rows('tenants'):
        if t['slug']=='pines': t['status']='active'
    fdb.user_tenants=['wccc']
    c3=await b.new_context(); await cloud(c3,fdb)
    p7,e7=await open_page(c3,'?org=club&tenant=pines',ready="()=>document.getElementById('login').classList.contains('show')")
    r=await p7.evaluate("()=>({login:document.getElementById('login').classList.contains('show'), err:document.getElementById('loginErr').textContent, email:document.getElementById('loginEmail').value, hidden:document.getElementById('loginEmail').hidden, club:document.getElementById('loginClub').textContent})")
    ok=r['login'] and 'does not belong' in r['err'] and r['email']=='pro@pines.org' and not r['hidden'] and r['club']=='The Pines Golf Club' and not e7
    print('a login from another club is refused; the card shows the tenant’s e-mail', r, e7, 'OK' if ok else 'FAIL'); bad+=not ok
    # ---- 4. the portal: admin only; list; create a client
    p8,e8=await open_page(c3,'?portal=1',ready="()=>document.getElementById('login').classList.contains('show')")
    r=await p8.evaluate("()=>({login:document.getElementById('login').classList.contains('show'), err:document.getElementById('loginErr').textContent, sub:document.getElementById('loginSub').textContent})")
    ok=r['login'] and 'administrator' in r['err'] and r['sub']=='Administrator sign-in' and not e8
    print('portal refuses a board login', r, e8, 'OK' if ok else 'FAIL'); bad+=not ok
    fdb.admin=True
    c4=await b.new_context(); await cloud(c4,fdb)
    p9,e9=await open_page(c4,'?portal=1',ready="()=>PORTAL_STATE.tenants&&PORTAL_STATE.tenants.length")
    r=await p9.evaluate("()=>({rows:[...document.querySelectorAll('[data-t]')].map(r=>r.dataset.t), title:document.querySelector('#main h1').textContent, chips:document.querySelectorAll('[data-t=\"wccc\"] .chip').length, sync:document.getElementById('syncTxt').textContent})")
    ok=r['rows']==['wccc','pines'] and r['title']=='Clients' and r['chips']==5 and r['sync']=='Signed in as board@test' and not e9
    print('portal lists the clients with their modules', r, e9, 'OK' if ok else 'FAIL'); bad+=not ok
    await p9.evaluate("""()=>{ document.getElementById('ptNew').click(); document.getElementById('ptN').value='Oak Ridge Golf Club'; document.getElementById('ptS').value='ORGC'; document.getElementById('ptSlug').value='oakridge';
      document.querySelector('#ptPlan [data-v=club]').click(); document.querySelector('[data-mod=groups]').checked=false; document.getElementById('ptLE').value='board@oakridge.org'; document.getElementById('dSave').click(); }""")
    await p9.wait_for_function("()=>PORTAL_STATE.tenants&&PORTAL_STATE.tenants.length===3",timeout=10000); await p9.wait_for_timeout(300)
    t=next((t for t in fdb._rows('tenants') if t.get('slug')=='oakridge'),None); u=[u for u in fdb._rows('tenant_users') if u.get('tenant')=='oakridge']
    club=fdb.get('mga_hub','club','oakridge')
    r={'tenant':t and {k:t.get(k) for k in ('name','plan','modules','status','login_email')}, 'users':[(x.get('email'),x.get('role')) for x in u], 'club':club and (club.get('name'),club.get('kind'),club.get('orgs')), 'drawer':await p9.evaluate("()=>document.getElementById('dTitle').textContent")}
    ok=t and t['plan']=='club' and t['modules']=={'golf':True,'associations':True,'club':True} and t['status']=='active' and t['login_email']=='board@oakridge.org' \
       and r['users']==[('board@oakridge.org','board')] and r['club']==('Oak Ridge Golf Club','club',[]) and r['drawer']=='Oak Ridge Golf Club is ready' and not e9
    print('portal creates a client: tenant row, club document, board login', r, e9, 'OK' if ok else 'FAIL'); bad+=not ok
    fdb.user_tenants=['oakridge']; fdb.admin=False
    c5=await b.new_context(); await cloud(c5,fdb)
    p10,e10=await open_page(c5,'?org=club&tenant=oakridge.flagstickhub.com')
    r=await p10.evaluate("()=>({name:CLUB.name, setup:setupNeeded, nav:[...document.querySelectorAll('#nav [data-go]')].map(b=>b.dataset.go), title:document.title})")
    ok=r['name']=='Oak Ridge Golf Club' and not r['setup'] and 'collections' in r['nav'] and r['title'].startswith('Oak Ridge Golf Club') and not e10
    print('the new client’s hub opens on its own document', r, e10, 'OK' if ok else 'FAIL'); bad+=not ok
    await b.close()
  print('ALL OK' if not bad else f'{bad} FAILED'); sys.exit(1 if bad else 0)
asyncio.run(main())
