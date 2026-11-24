"""Player registration against the fake database. Run: python3 tests/test_signup.py
The board opens registration on a 3-player tournament; a member finds their name on the public page, adds a partner and
asks the shop for a third; a full team enters from another phone; nobody can be entered twice and no spot may be left
blank; the hub takes the entries into the field; closing the page stops entries; turning it off keeps the field."""
import asyncio,sys,json
from playwright.async_api import async_playwright
from _harness import seed_from_main, FakeDB,cloud,page
from test_sync import seed_main,open_hub,settled
async def main():
  bad=0
  def check(name,cond,info=''):
    nonlocal bad; print(('OK   ' if cond else 'FAIL ')+name,info); bad+=(not cond)
  fdb=FakeDB(); seed_from_main(fdb,seed_main())
  async with async_playwright() as p:
    b=await p.chromium.launch()
    A=await b.new_context(); await cloud(A,fdb)
    hub,herr=await open_hub(A,'mga'); await settled([hub])
    # --- 1. a 3-player Stableford tournament with places paid and a rule sheet; registration opened from the Field tab
    r=await hub.evaluate("""async()=>{ [['Pat','Quinn'],['Lee','Rivera'],['Sam','Osei'],['Kim','Takahashi']].forEach(([f,l])=>upsertMember(null,{first:f,last:l,email:'',status:'Active'},{noBill:true}));
      const t=newTournament({season:Y(),name:'Turkey Shoot',startDate:'2026-11-21',days:1,teamSize:3,entryFee:50,hcpDiff:10}); t.venue='Pecan Course'; t.placesPaid=2; t.payoutNote='1st and 2nd net'; t.rules='Ten-shot rule applies\\nPlay it as it lies';
      t.schedule=[{day:0,label:'',items:[{id:'s1',time:'9:00 AM',event:'Players meeting',notes:''},{id:'s2',time:'10:00 AM',event:'Shotgun start',notes:'Weather permitting'}]}];
      db.tournaments.push(t); persist(); view.tid=t.id; view.page='tournament'; view.ttab='field'; render();
      Object.assign(t.rounds[0],{game:'teamstable',format:'teamstable',count:2,scoring:'net',points:{stableford:{'-3':8,'-2':6,'-1':4,'0':2,'1':1,'2':0}}}); persist(); render();
      const before=!!document.getElementById('sgOpen'); document.getElementById('sgOpen').click(); await new Promise(r=>setTimeout(r,500));
      return {before, token:t.reg&&t.reg.token, status:t.reg&&t.reg.status, tstatus:t.status, link:document.querySelector('#sgCard a')&&document.querySelector('#sgCard a').href, pool:signupPool().length, names:members().map(memberName)}; }""")
    tok=r['token']; share=fdb._rows('signup_share')
    check('open registration: token, link, the tournament open for signups',r['before'] and tok and len(tok)>=20 and r['status']=='open' and r['tstatus']=='Open for signups' and r['link'].endswith('register.html?k='+tok),json.dumps({k:v for k,v in r.items() if k!='names'}))
    doc=share[0]['doc'] if share else {}
    check('share row: the pool, the round with its points, the payouts and the rules',len(share)==1 and share[0]['org']=='mga' and len(doc.get('pool',[]))==r['pool'] and r['pool']>=6 and doc['rounds'][0]['points'][0]==['Albatross',8] and doc['rounds'][0]['count']==2 and doc['placesPaid']==2 and doc['rules']==['Ten-shot rule applies','Play it as it lies'] and doc['hcpDiff']==10 and doc['teamSize']==3,json.dumps({k:doc.get(k) for k in ('placesPaid','rules','hcpDiff','teamSize')})+' pool %d/%s'%(len(doc.get('pool',[])),r['pool']))
    check('share row: names only',all(set(p.keys())=={'id','name'} for p in doc.get('pool',[])) and 'email' not in json.dumps(doc).lower() and 'ghin' not in json.dumps(doc).lower())
    names=[x['name'] for x in doc['pool']]; await settled([hub])   # the eligible names, as the page lists them (an inactive member is not among them)
    # --- 2. the public page: branded, the details, how it's played, the payouts, the rules
    M=await b.new_context(); await cloud(M,fdb,no_session=True)
    ph=await M.new_page(); perr=[]; ph.on('pageerror',lambda e:perr.append(str(e)))
    await ph.goto(page('register.html')+'?k='+tok); await ph.wait_for_function("()=>!!D&&!!document.getElementById('enter')")
    txt=await ph.evaluate("()=>document.body.innerText")
    for needle in ['Turkey Shoot','Saturday, November 21, 2026','Pecan Course','$50','3-player','Team Stableford (best 2 of 3)','Players meeting','Shotgun start','Weather permitting','best 2 of 3 net scores count','Albatross','90% of course handicap','Partner differential cap: 10 strokes','2 places paid','1st and 2nd net','Ten-shot rule applies','Play it as it lies','Nobody yet']:
      check('page shows: '+needle,needle in txt)
    check('page: header carries the organization, the Enter button waits',await ph.evaluate("()=>document.getElementById('hTitle').textContent")!='Registration' and await ph.evaluate("()=>document.getElementById('go').disabled"))
    # --- 3. me + a partner + "need help finding a third"
    async def pick(pg,i,name):
      await pg.fill(f'input[data-q="{i}"]',name[:4]); await pg.wait_for_selector(f'[data-pick="{i}"]')
      await pg.click(f'[data-pick="{i}"][data-id]:not([disabled]):has-text("{name}")')
    await pick(ph,0,names[0]); await pick(ph,1,names[1])
    st=await ph.evaluate("()=>({go:document.getElementById('go').disabled, cnt:document.getElementById('cnt').textContent})")
    check('two picked, third blank: cannot enter yet',st['go'] and 'Player 3' in st['cnt'],json.dumps(st))
    # the same person cannot be picked for two spots
    await ph.fill('input[data-q="2"]',names[0][:4]); await ph.wait_for_selector('[data-pick="2"]')
    check('a teammate already on this team is greyed out',await ph.evaluate("()=>{ const b=document.querySelector('[data-pick=\"2\"]'); return b.disabled&&/on this team/.test(b.textContent); }"))
    await ph.check('[data-help="2"]')
    st=await ph.evaluate("()=>({go:document.getElementById('go').disabled, cnt:document.getElementById('cnt').textContent})")
    check('third spot asked for: ready to enter',not st['go'] and '1 open spot' in st['cnt'],json.dumps(st))
    await ph.fill('#note','We can play early'); await ph.click('#go'); await ph.wait_for_function("()=>/You're in/.test(document.body.innerText)")
    txt=await ph.evaluate("()=>document.body.innerText")
    ents=fdb._rows('signup_entries')
    check('entered: the two names, one open spot for the shop, the note kept',names[0] in txt and names[1] in txt and '1 open spot' in txt and len(ents)==1 and [p['memberId'] for p in ents[0]['players']]==[doc['pool'][[x['name'] for x in doc['pool']].index(names[0])]['id'],doc['pool'][[x['name'] for x in doc['pool']].index(names[1])]['id']] and ents[0]['need']==1 and ents[0]['note']=='We can play early',txt[:200])
    # --- 4. another phone: the first player is already entered; a full team of three enters; a short entry is refused by the database
    p2=await M.new_page(); await p2.goto(page('register.html')+'?k='+tok); await p2.wait_for_function("()=>!!D&&!!document.getElementById('enter')")
    check('second phone: the pending entry shows under Who\'s in',await p2.evaluate("()=>/Team 1/.test(document.getElementById('who').textContent)&&/1 open spot/.test(document.getElementById('who').textContent)"))
    await p2.fill('input[data-q="0"]',names[0][:4]); await p2.wait_for_selector('[data-pick="0"]')
    check('second phone: someone already entered is greyed out',await p2.evaluate("()=>{ const b=document.querySelector('[data-pick=\"0\"]'); return b.disabled&&/already entered/.test(b.textContent); }"))
    ids={x['name']:x['id'] for x in doc['pool']}
    r=await p2.evaluate("async(ids)=>{ const r=await sb.rpc('signup_submit',{p_token:TOKEN,p_players:[{memberId:ids[0],name:'x'},{memberId:ids[1],name:'y'}],p_need:0,p_answers:{},p_note:''}); const r2=await sb.rpc('signup_submit',{p_token:TOKEN,p_players:[{memberId:ids[0],name:'x'},{memberId:ids[0],name:'x'},{memberId:ids[1],name:'y'}],p_need:0,p_answers:{},p_note:''}); const r3=await sb.rpc('signup_submit',{p_token:TOKEN,p_players:[{memberId:'nobody',name:'x'},{memberId:ids[0],name:'x'},{memberId:ids[1],name:'y'}],p_need:0,p_answers:{},p_note:''}); return [r.error&&r.error.message,r2.error&&r2.error.message,r3.error&&r3.error.message]; }",[ids[names[2]],ids[names[3]]])
    check('database refuses a blank spot, the same player twice, a name off the list',r[0] and 'Every spot' in r[0] and r[1] and 'twice' in r[1] and r[2] and 'eligible' in r[2],json.dumps(r))
    await pick(p2,0,names[2]); await pick(p2,1,names[3]); await pick(p2,2,names[4]); await p2.click('#go'); await p2.wait_for_function("()=>/You're in/.test(document.body.innerText)")
    check('a full team of three entered',len(fdb._rows('signup_entries'))==2 and fdb._rows('signup_entries')[1]['need']==0)
    # --- 5. the hub takes both entries into the field
    r=await hub.evaluate("""async()=>{ delete SG_AT[db.tournaments.find(x=>x.name==='Turkey Shoot').id]; render(); await new Promise(r=>setTimeout(r,900)); const t=db.tournaments.find(x=>x.name==='Turkey Shoot'); const teams={}; t.field.forEach(p=>{ (teams[p.team]=teams[p.team]||[]).push(p); });
      return {n:t.field.length, teams:Object.values(teams).map(tm=>({n:tm.length,need:tm[0].reg&&tm[0].reg.need,note:tm[0].reg&&tm[0].reg.note,names:tm.map(p=>memberName(memberById(p.memberId)))})), chip:/Shop pairing/.test(document.body.innerText), card:document.getElementById('sgCard').textContent}; }""")
    check('hub: 5 players in 2 teams, the short team flagged for shop pairing with its note',r['n']==5 and sorted(x['n'] for x in r['teams'])==[2,3] and any(x['need']==1 and x['note']=='We can play early' and x['names']==[names[0],names[1]] for x in r['teams']) and r['chip'] and '5 players entered from the link' in r['card'] and '1 open spot for the golf shop' in r['card'],json.dumps({'chip':r['chip'],'card':r['card']}))
    check('entries cleared once taken in; the page now knows who is in',len(fdb._rows('signup_entries'))==0 and len(fdb._rows('signup_share')[0]['doc']['taken'])==5 and len(fdb._rows('signup_share')[0]['doc']['teams'])==2)
    await settled([hub])
    await ph.goto(page('register.html')+'?k='+tok); await ph.wait_for_function("()=>!!D&&!!document.getElementById('enter')")
    check('page: Who\'s in lists the field with the open spot',await ph.evaluate("()=>{ const w=document.getElementById('who').textContent; return /5 players/.test(w)&&/2 teams/.test(w)&&/1 open spot/.test(w); }"))
    # --- 6. close registration: the page still tells, takes no entries; turn off: rows gone, the field stays
    await hub.evaluate("async()=>{ view.ttab='field'; render(); document.getElementById('sgToggle').click(); await new Promise(r=>setTimeout(r,400)); }")
    await ph.goto(page('register.html')+'?k='+tok); await ph.wait_for_function("()=>!!D")
    r=await ph.evaluate("async(ids)=>{ const r=await sb.rpc('signup_submit',{p_token:TOKEN,p_players:[{memberId:ids,name:'x'}],p_need:2,p_answers:{},p_note:''}); return {closed:/Registration has closed/.test(document.body.innerText), details:/2 places paid/.test(document.body.innerText), enter:!!document.getElementById('enter'), err:r.error&&r.error.message}; }",ids[names[5]])
    check('closed: the page says so, keeps the details, refuses an entry',r['closed'] and r['details'] and not r['enter'] and r['err']=='closed',json.dumps(r))
    r=await hub.evaluate("async()=>{ document.getElementById('sgOff').click(); await new Promise(r=>setTimeout(r,200)); document.getElementById('dSave').click(); await new Promise(r=>setTimeout(r,500)); const t=db.tournaments.find(x=>x.name==='Turkey Shoot'); return {reg:!!t.reg, field:t.field.length, again:!!document.getElementById('sgOpen')}; }")
    check('turned off: no link, the field kept, can open again',not r['reg'] and r['field']==5 and r['again'] and len(fdb._rows('signup_share'))==0,json.dumps(r))
    await ph.goto(page('register.html')+'?k='+tok); await ph.wait_for_function("()=>/not valid/.test(document.body.innerText)")
    check('old link is dead',True)
    check('no script errors (hub / phones)',not herr and not perr,json.dumps(herr+perr))
    await b.close()
  print('ALL OK' if not bad else f'{bad} FAILED'); sys.exit(1 if bad else 0)
asyncio.run(main())
