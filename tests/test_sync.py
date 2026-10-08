"""Multi-device, multi-document saving against a shared fake database. Run: python3 tests/test_sync.py
Checks: migration from the MGA Hub row (and re-run), browsing writes nothing, one edit = one write to the right row,
a person edit from an association writes the club row only, and overlapping edits from two devices all survive."""
import asyncio,sys,json,uuid,time
from playwright.async_api import async_playwright
from _harness import FakeDB,cloud,page
def U(): return str(uuid.uuid4())
def seed_main():
    y='2026'; ms=[{'id':U(),'first':f,'last':l,'email':f'{f}@x.org'.lower(),'hcp':h,'status':st,'joined':'2024-01-01','notes':f'{f} note'} for f,l,h,st in [('Ann','Able','4.1','Active'),('Bo','Baker','12.0','Active'),('Cy','Cole','20.3','Inactive')]]
    t={'id':U(),'season':y,'name':'Member-Member','startDate':'2026-10-02','days':3,'venue':'WCCC','status':'Planning','budgetBasis':'planned','entryFee':250,'skinsFee':20,'plannedPlayers':150,'teamSize':2,
       'field':[{'id':U(),'memberId':ms[0]['id'],'team':1,'paid':True,'skins':False,'answers':{}}],'sponsors':[],'tiers':[],'goal':0,'dayItems':[[],[],[]],'income':[],'perPlayer':[],'lines':[],'actuals':{'entryFees':0,'skins':0,'skinsPaid':0},'schedule':[],'decisions':[],'notes':''}
    return {'v':1,'activeSeason':y,'members':ms,'board':[{'id':U(),'role':'President','memberId':ms[0]['id'],'term':''}],
            'seasons':{y:{'dues':{'amount':90,'installments':2},'duesPayments':[{'id':U(),'memberId':ms[0]['id'],'amount':90,'date':'1/5'}],'lines':[],'txns':[],'bank':[],'bankBatches':[],'bankOpening':{'amount':0,'date':''}}},
            'tournaments':[t],'_rev':7,'_w':'hub-device','_at':1}
async def open_hub(ctx,org):
    pg=await ctx.new_page(); errs=[]; pg.on('pageerror',lambda e:errs.append(str(e)))
    await pg.goto(page('index.html')+'?org='+org)
    await pg.wait_for_function("()=>cloudReady",timeout=15000); await pg.wait_for_timeout(300)
    return pg,errs
async def settled(pgs,timeout=30):
    t0=time.time()
    while time.time()-t0<timeout:
        ok=[await pg.evaluate("()=>openDocs().every(D=>D.st==='synced'&&!D.pushing&&!D.saveT)||openDocs().every(D=>D.st==='synced'&&!D.pushing)") for pg in pgs]
        if all(ok):
            sigs=[await pg.evaluate("()=>openDocs().map(D=>D.id+':'+bare(D.db)).sort().join('|')") for pg in pgs]
            if len(set(sigs))==1: return sigs[0]
        await asyncio.sleep(0.3)
    raise AssertionError('devices did not settle: '+json.dumps([await pg.evaluate("()=>openDocs().map(D=>[D.id,D.st,D.pushing])") for pg in pgs]))
async def main():
  bad=0
  def check(name,cond,info=''):
    nonlocal bad; print(('OK   ' if cond else 'FAIL ')+name,info); bad+= (not cond)
  fdb=FakeDB(); main=seed_main(); fdb.seed('mga_hub','main',main)
  async with async_playwright() as p:
    b=await p.chromium.launch()
    A=await b.new_context(); await cloud(A,fdb)
    # --- 1. first run: no club row → set-up screen → migrate from the Hub's row
    pg,errs=await open_hub(A,'club')
    check('first run shows set-up',await pg.evaluate("()=>setupNeeded&&!!document.getElementById('suGo')"))
    r=await pg.evaluate("()=>migrateFromHub()")
    club=fdb.get('mga_hub','club'); mga=fdb.get('mga_hub','mga'); main_after=fdb.get('mga_hub','main')
    check('migration result',r=={'people':3,'tournaments':1},r)
    check('club row: 3 persons, no org-only fields, status Active',len(club['members'])==3 and all('notes' not in m and 'joined' not in m and m['status']=='Active' for m in club['members']),[list(m.keys()) for m in club['members']][:1])
    check('club row: default orgs',[o['id'] for o in club['orgs']]==['mga','lga','smga'])
    check('mga row: memberships carry status/joined/notes',[(m['status'],m['notes']) for m in mga['memberships']]==[('Active','Ann note'),('Active','Bo note'),('Inactive','Cy note')] and 'members' not in mga)
    check('mga row: tournaments, board, dues copied',len(mga['tournaments'])==1 and mga['board'][0]['memberId']==club['members'][0]['id'] and len(mga['seasons']['2026']['duesPayments'])==1)
    check('main row untouched',main_after==main and fdb.writes['main']==0)
    # re-run: idempotent on the directory, replaces the mga row
    fdb.rows[('mga_hub','main')]['data']['tournaments'][0]['name']='Member-Member (renamed on Hub)'
    r=await pg.evaluate("()=>migrateFromHub()")
    club2=fdb.get('mga_hub','club'); mga2=fdb.get('mga_hub','mga')
    check('re-run keeps 3 persons and picks up the Hub change',len(club2['members'])==3 and mga2['tournaments'][0]['name']=='Member-Member (renamed on Hub)' and mga2['_rev']==mga['_rev']+1)
    check('no page errors so far',not errs,errs); await pg.close()
    # --- 2. two devices on the MGA
    B=await b.new_context(); await cloud(B,fdb)
    a,ea=await open_hub(A,'mga'); bpg,eb=await open_hub(B,'mga')
    check('both devices loaded club + mga',await a.evaluate("()=>[isClub(),CLUB.members.length,members().length,db.tournaments.length]")==[False,3,3,1])
    w0=dict(fdb.writes)
    for v in ['dash','tournaments','golf','members','board','treasury','budget']: await a.evaluate(f"()=>go('{v}')"); await a.wait_for_timeout(40)
    await a.evaluate("()=>{ go('tournament',{tid:db.tournaments[0].id}); for(const [k] of TT){ view.ttab=k; render(); } go('members'); editMember(members()[0]); closeDrawer(); view.mq='an'; render(); }")
    await a.wait_for_timeout(1500)
    check('browsing = 0 writes',dict(fdb.writes)==w0,(w0,dict(fdb.writes)))
    # one edit → one write to mga, none to club; the other device sees it
    await a.evaluate("()=>{ db.tournaments[0].name='Member-Member 2026'; persist(); }")
    await settled([a,bpg])
    check('one edit = 1 write to mga only',fdb.writes['mga']==w0.get('mga',0)+1 and fdb.writes['club']==w0.get('club',0),dict(fdb.writes))
    check('device B received the edit',await bpg.evaluate("()=>db.tournaments[0].name")=='Member-Member 2026')
    w1=dict(fdb.writes)
    # a person edit from the association → club row only
    await a.evaluate("()=>{ upsertMember(members()[1].id,{email:'bo@new.org'}); persist(); }")
    await settled([a,bpg])
    check('person edit = 1 write to club only',fdb.writes['club']==w1['club']+1 and fdb.writes['mga']==w1['mga'],dict(fdb.writes))
    check('device B sees the new email in the directory and the view',await bpg.evaluate("()=>[CLUB.members[1].email,members()[1].email]")==['bo@new.org','bo@new.org'])
    # --- 3. overlapping edits from both devices: 20 sponsors + 10 new members each, interleaved
    async def burst(pg,tag):
        for i in range(20):
            await pg.evaluate(f"()=>{{ const t=db.tournaments[0]; t.sponsors.push({{id:uid(),company:'{tag}-co-'+{i},pledged:100+{i},payments:[]}}); if({i}%2==0) upsertMember(null,{{first:'{tag}',last:'New'+{i},email:'{tag}{i}@x.org',status:'Active'}}); persist(); }}")
            await asyncio.sleep(0.05)
    await asyncio.gather(burst(a,'A'),burst(bpg,'B'))
    sig=await settled([a,bpg],timeout=60)
    parts=[]
    for id in ['club','mga']: parts.append(f"{id}:"+await a.evaluate("(d)=>bare(d)",fdb.get('mga_hub',id)))
    srv='|'.join(sorted(parts))
    check('server rows equal both devices after the burst',srv==sig)
    counts=await a.evaluate("()=>[db.tournaments[0].sponsors.length,CLUB.members.length,db.memberships.length]")
    check('all 40 sponsors and 20 new people kept on both documents',counts==[40,23,23],counts)
    check('no page errors',not ea and not eb,(ea,eb))
    # --- 3. admin link: the club makes a small group and a link; a device with no board sign-in runs that hub only
    cpg,ec=await open_hub(A,'club')
    await cpg.evaluate("()=>{ CLUB.orgs.push({id:'misfits',kind:'group',name:'The Misfits',short:'Misfits'}); persist(); }")
    await settled([cpg],timeout=30); await a.wait_for_function("()=>CLUB.orgs.some(o=>o.id==='misfits')",timeout=15000)
    link=await cpg.evaluate("()=>newAdminLink(CLUB.orgs.find(o=>o.id==='misfits'),'Dave')")
    keys=fdb._rows('hub_keys')
    check('link created: hashed key stored, group row created',len(keys)==1 and keys[0]['org_id']=='misfits' and keys[0]['label']=='Dave' and fdb.get('mga_hub','misfits') is not None and link['token'] not in json.dumps(keys),link['url'])
    C=await b.new_context(); await cloud(C,fdb,no_session=True)
    k=await C.new_page(); ek=[]; k.on('pageerror',lambda e:ek.append(str(e)))
    await k.goto(page('index.html')+'?org=misfits#key='+link['token']); await k.wait_for_function("()=>cloudReady",timeout=15000); await k.wait_for_timeout(300)
    st=await k.evaluate("()=>({key:KEYMODE,kind:db&&db.kind,people:CLUB.members.length,clubSubset:!('tournaments' in DOCS.club.base)&&!('seasons' in DOCS.club.base),orgs:CLUB.orgs.map(o=>o.id),nav:navItems().map(x=>x[0]),switchHidden:document.getElementById('btnSwitch').hidden,login:document.getElementById('login').classList.contains('show'),leave:document.getElementById('btnSignOut').textContent,hash:location.hash})")
    check('key device: group hub, directory only, no switching, no sign-in',st['key'] and st['kind']=='group' and st['people']==23 and st['clubSubset'] and st['orgs']==['misfits'] and 'games' in st['nav'] and st['switchHidden'] and not st['login'] and st['leave']=='Leave this hub' and st['hash']=='',st)
    denied=await k.evaluate("async()=>{ const a=await keyRPC('hub_key_read',{p_id:'mga'}); const b=await keyRPC('hub_key_write',{p_id:'club',p_data:{},p_rev:null}); return [!!a.error,!!b.error]; }")
    check('key device cannot read the MGA or write the club',denied==[True,True],denied)
    w1=dict(fdb.writes)
    await k.evaluate("()=>{ const p=upsertMember(null,{first:'Guest',last:'Gus',email:'gus@x.org',status:'Active'}); db.games=db.games||[]; db.games.push({id:'g1',season:Y(),name:'Friday game',date:'2026-05-01',players:[],pots:[]}); persist(); }")
    await settled([k],timeout=30)
    mis=fdb.get('mga_hub','misfits'); clubrow=fdb.get('mga_hub','club')
    check('key device saved its game to the group row and the new person to the directory',len(mis.get('games',[]))==1 and len(clubrow['members'])==24 and len(mis.get('memberships',[]))==1,(fdb.writes['misfits']-w1.get('misfits',0),fdb.writes['club']-w1.get('club',0)))
    await a.wait_for_function("()=>CLUB.members.length===24",timeout=15000)
    check('board device sees the person the group added',await a.evaluate("()=>CLUB.members.some(p=>p.email==='gus@x.org')"))
    # the group may not change directory details: an edit to an existing person is dropped on save
    locked=await k.evaluate("()=>{ go('members'); editMember(members()[0]); const d=document.getElementById('mfF').disabled; closeDrawer(); return d; }")
    check('key device: existing people are read-only',locked)
    # revoke → the next load falls back to the board sign-in
    await cpg.evaluate("()=>sb.from('hub_keys').update({revoked_at:new Date().toISOString()}).eq('org_id','misfits')")
    await k.reload(); await k.wait_for_timeout(1200)
    rej=await k.evaluate("()=>({login:document.getElementById('login').classList.contains('show'),msg:document.getElementById('loginErr').textContent,key:KEYMODE,stored:localStorage.getItem('club_hub_key')})")
    check('revoked link: sign-in shown, key forgotten',rej['login'] and 'no longer valid' in rej['msg'] and not rej['key'] and rej['stored'] is None,rej)
    check('no page errors on the key device',not ek,ek)
    await b.close()
  print('writes per row',dict(fdb.writes),'reads',fdb.reads)
  sys.exit(1 if bad else 0)
asyncio.run(main())
