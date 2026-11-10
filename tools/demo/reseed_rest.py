"""Replace the Bushwood rows through the REST API as the demo staff login: documents updated in place, tables cleared and
reloaded, the wolf row replaced through its compare-and-swap function. No SQL console needed."""
import json, os, re, sys, urllib.request
HERE=os.path.dirname(os.path.abspath(__file__)); d=json.load(open(os.path.join(HERE,'seed.json')))
cfg=open(os.path.join(HERE,'..','..','config.js')).read(); URL=re.search(r'url:\s*"([^"]+)"',cfg).group(1); KEY=re.search(r'anonKey:\s*"([^"]+)"',cfg).group(1)
T='bushwood'
def req(path, body, headers, method='POST'):
    r=urllib.request.Request(URL+path, data=json.dumps(body,ensure_ascii=False).encode() if body is not None else None, headers=dict(headers, **{'Content-Type':'application/json'}), method=method)
    try:
        with urllib.request.urlopen(r, timeout=180) as resp: return resp.status, resp.read().decode()
    except urllib.error.HTTPError as e: return e.code, e.read().decode()
st,body=req('/auth/v1/token?grant_type=password',{'email':os.environ.get('DEMO_EMAIL','demo@bushwoodcc.com'),'password':os.environ['DEMO_PW']},{'apikey':KEY}); assert st==200,(st,body[:200]); JWT=json.loads(body)['access_token']
A={'apikey':KEY,'Authorization':'Bearer '+KEY}; S={'apikey':KEY,'Authorization':'Bearer '+JWT,'Prefer':'return=minimal'}; SC={'apikey':KEY,'Authorization':'Bearer '+JWT,'Prefer':'count=exact','Range-Unit':'items','Range':'0-0'}
def count(table):
    r=urllib.request.Request(f'{URL}/rest/v1/{table}?tenant=eq.{T}&select=id', headers=dict(SC,**{'Content-Type':'application/json'})); 
    try:
        with urllib.request.urlopen(r,timeout=60) as resp: return int(resp.headers.get('Content-Range','0/0').split('/')[1])
    except urllib.error.HTTPError as e: return -1
def clear(table):
    st,b=req(f'/rest/v1/{table}?tenant=eq.{T}',None,S,'DELETE'); assert st in (200,204),(table,st,b[:200]); print('cleared',table)
def load(table, items, chunk=400):
    n=0
    for i in range(0,len(items),chunk):
        rows=[dict(r, tenant=T) for r in items[i:i+chunk]]
        st,b=req('/rest/v1/'+table, rows, S)
        if st not in (200,201): print('FAIL',table,i,st,b[:400]); sys.exit(1)
        n+=len(rows)
    print(table, n)
# 1. documents, updated in place (the doc's _rev restarts at 1: every open hub reloads)
for oid,doc in d['docs'].items():
    for p in doc.get('members',[]): p.pop('_o',None)
    st,b=req(f'/rest/v1/mga_hub?tenant=eq.{T}&id=eq.{oid}',{'data':doc},S,'PATCH'); print('mga_hub',oid,st,b[:160] if st not in (200,204) else '')
    if st not in (200,204): sys.exit(1)
# 2. the tables: clear, then load (scores before events are deleted would be orphaned — events first on load, scores first on clear)
for t in ['golf_scores','golf_events','acct_items','acct_statements','pos_tickets','pos_days','pos_stations','bookings','booking_blocks','staff_clock','signup_entries','signup_share','survey_responses','survey_share']: clear(t)
load('golf_events', d['golfEvents'], 20); load('golf_scores', d['scores'], 2000)
load('acct_items', [dict({k:v for k,v in a.items() if k!='net'}, tip=(a.get('tip') or 0)) for a in d['acct']], 600)
load('acct_statements', d['stmts'], 500); load('pos_tickets', d['tickets'], 250); load('pos_days', d['posDays'], 300); load('pos_stations', d['stations'], 50)
load('bookings', d['bookings'], 500); load('booking_blocks', d['blocks'], 50); load('staff_clock', d['clock'], 500); load('signup_share', [d['signupShare']]); load('survey_share', d['surveyShares'])
# 3. survey answers and sign-ups through the public functions
shares={s['sid']:s for s in d['surveyShares']}; counts={}
for sid,s in shares.items():
    if s['status']!='open': st,b=req(f'/rest/v1/survey_share?tenant=eq.{T}&sid=eq.{sid}',{'status':'open'},S,'PATCH'); assert st in (200,204),(st,b)
    for r in d['surveyResponses']:
        if r['sid']!=sid: continue
        st,b=req('/rest/v1/rpc/survey_submit',{'p_token':s['token'],'p_answers':r['answers']},A)
        if st!=200: print('survey fail',st,b[:200]); sys.exit(1)
        counts[sid]=counts.get(sid,0)+1
    if s['status']!='open': st,b=req(f'/rest/v1/survey_share?tenant=eq.{T}&sid=eq.{sid}',{'status':s['status']},S,'PATCH'); assert st in (200,204),(st,b)
print('survey responses', counts)
tok=d['signupShare']['token']
for e in d['signupEntries']:
    st,b=req('/rest/v1/rpc/signup_submit',{'p_token':tok,'p_players':e['players'],'p_need':e['need'],'p_answers':e['answers'],'p_note':e['note']},A); print('signup',st,b[:100])
# 4. the wolf: the old row belongs to an event that no longer exists; put the new one (rev 0 → a fresh row)
side=d['side']; ev=next(e for e in d['golfEvents'] if e['id']==side['event_id']); code=next(c for c,g in ev['codes'].items() if g==side['group_id'])
st,b=req('/rest/v1/rpc/golf_side_put',{'p_event':side['event_id'],'p_code':code,'p_data':side['data'],'p_rev':0},A); print('side',st,b[:80])
# 5. what the SQL console still has to do: spread the response days, drop the orphaned wolf row
days={sid:[r['day'] for r in d['surveyResponses'] if r['sid']==sid] for sid in shares}
sql=[]
for sid,ds in days.items():
    arr=','.join("'"+x+"'" for x in ds)
    sql.append(f"with r as (select id, row_number() over (order by id) rn from survey_responses where tenant='{T}' and sid='{sid}'), dd as (select unnest(array[{arr}]::date[]) as dy, generate_series(1,{len(ds)}) as rn) update survey_responses s set day=dd.dy from r join dd using (rn) where s.id=r.id;")
sql.append(f"delete from golf_side where tenant='{T}' and event_id not in (select id from golf_events where tenant='{T}');")
open(os.path.join(HERE,'fixup2.sql'),'w').write('\n'.join(sql)); print('fixup2.sql written')
print({t:count(t) for t in ['golf_events','golf_scores','acct_items','acct_statements','pos_tickets','bookings','staff_clock','survey_responses','signup_entries']})
