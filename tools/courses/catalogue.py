#!/usr/bin/env python3
"""The whole GolfCourseAPI catalogue into the Flagstick course library.

The API has no list endpoint: /v1/search matches a substring of the club or course name and returns at most 25 hits with no
paging. So the catalogue is enumerated by refinement — every query that comes back full (25) is extended by one more
character until every query comes back short — then each course is fetched once and turned into a library row
(import_courses.row_from_gca), and the rows go up in batches through the `courses-import` Edge Function, which writes the
library with the service role and never touches a verified row or a club's own course.

  export GCA_KEY=…          # GolfCourseAPI
  export IMPORT_KEY=…       # the Edge Function's secret
  python3 tools/courses/catalogue.py enumerate     # → catalogue/ids.json      (resumable: known queries are kept)
  python3 tools/courses/catalogue.py fetch         # → catalogue/details.jsonl (resumable: fetched ids are skipped)
  python3 tools/courses/catalogue.py rows          # → catalogue/rows.jsonl + a report of what was skipped
  python3 tools/courses/catalogue.py push          # → the library, 200 rows a call; catalogue/pushed.json remembers what went up
  python3 tools/courses/catalogue.py all           # the four in a row

Everything lands unverified. Non-US rows get the country code in front of the id (gb-…, ca-…); US ids stay as before
(tx-dallas-…), so the DFW rows loaded by hand are updated in place rather than duplicated.
"""
import json, os, re, sys, time, urllib.request, urllib.parse, threading, queue
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from import_courses import row_from_gca, slug, DailyLimit

GCA='https://api.golfcourseapi.com/v1'
KEY=os.environ.get('GCA_KEY',''); IMPORT_KEY=os.environ.get('IMPORT_KEY','')
FN=os.environ.get('IMPORT_URL','https://yofqgrualjziexkfumkb.supabase.co/functions/v1/courses-import')
OUT=os.path.join(os.path.dirname(os.path.abspath(__file__)),'catalogue'); os.makedirs(OUT,exist_ok=True)
ALPHA=list('abcdefghijklmnopqrstuvwxyz0123456789-&.')   # the API answers 500 to a trailing space or an apostrophe; a space is extended as ' '+letter below
WORKERS=int(os.environ.get('WORKERS','16'))
COUNTRY={'united states':'US','usa':'US','united states of america':'US','canada':'CA','united kingdom':'GB','uk':'GB','england':'GB','scotland':'GB','wales':'GB','northern ireland':'GB','ireland':'IE','australia':'AU','new zealand':'NZ','mexico':'MX','south africa':'ZA','france':'FR','spain':'ES','portugal':'PT','italy':'IT','germany':'DE','austria':'AT','switzerland':'CH','netherlands':'NL','belgium':'BE','denmark':'DK','sweden':'SE','norway':'NO','finland':'FI','iceland':'IS','japan':'JP','south korea':'KR','korea':'KR','china':'CN','thailand':'TH','malaysia':'MY','singapore':'SG','indonesia':'ID','philippines':'PH','vietnam':'VN','india':'IN','united arab emirates':'AE','qatar':'QA','turkey':'TR','greece':'GR','cyprus':'CY','czech republic':'CZ','czechia':'CZ','poland':'PL','hungary':'HU','croatia':'HR','slovenia':'SI','slovakia':'SK','estonia':'EE','latvia':'LV','lithuania':'LT','argentina':'AR','brazil':'BR','chile':'CL','colombia':'CO','peru':'PE','uruguay':'UY','costa rica':'CR','panama':'PA','dominican republic':'DO','puerto rico':'PR','jamaica':'JM','bahamas':'BS','bermuda':'BM','cayman islands':'KY','morocco':'MA','kenya':'KE','egypt':'EG','mauritius':'MU','israel':'IL','taiwan':'TW','hong kong':'HK','luxembourg':'LU','monaco':'MC','malta':'MT','bulgaria':'BG','romania':'RO','serbia':'RS','ukraine':'UA','russia':'RU','guam':'GU','fiji':'FJ'}

def get(url, tries=5):
    for i in range(tries):
        try:
            r=urllib.request.Request(url, headers={'Authorization':'Key '+KEY})
            with urllib.request.urlopen(r, timeout=60) as resp: return json.loads(resp.read().decode())
        except urllib.error.HTTPError as e:
            body=''
            try: body=e.read().decode()
            except Exception: pass
            if e.code==429 and 'daily' in body.lower(): raise DailyLimit(body.strip())
            if e.code==429: time.sleep(2*(i+1)); continue
            if e.code==404: return None
            if i==tries-1: raise
            time.sleep(1+i)
        except Exception:
            if i==tries-1: raise
            time.sleep(1+i)
def search(q): r=get(GCA+'/search?search_query='+urllib.parse.quote(q)); return (r or {}).get('courses') or []

def pool(items, fn, workers=WORKERS):
    """run fn over items on a few threads; yields (item, result | Exception) as they finish"""
    qin=queue.Queue(); qout=queue.Queue()
    for it in items: qin.put(it)
    def work():
        while True:
            try: it=qin.get_nowait()
            except queue.Empty: return
            try: qout.put((it, fn(it)))
            except Exception as e: qout.put((it, e))
    ts=[threading.Thread(target=work,daemon=True) for _ in range(workers)]
    for t in ts: t.start()
    n=len(items)
    for _ in range(n): yield qout.get()

# ---- 1. enumerate: refine every full query until every query is short
def enumerate_ids():
    f=os.path.join(OUT,'queries.json'); Q=json.load(open(f)) if os.path.exists(f) else {}   # query → [ids] (25 = full)
    ids=os.path.join(OUT,'ids.json'); known=json.load(open(ids)) if os.path.exists(ids) else {}   # id → {club, course, city, state, country}
    kids=lambda q:[q+c for c in ALPHA if len(q)<10]+[q+' '+c for c in ALPHA[:26] if len(q)<9]   # one more character; a space counts with the letter after it
    rounds=0
    while True:
        # the frontier is rebuilt from what is saved, so a stopped run picks up where it was: every root and every child of a full query not asked yet
        todo=[q for q in ALPHA if q not in Q]+[k for q,v in Q.items() if len(v)>=25 for k in kids(q) if k not in Q]
        if not todo: break
        rounds+=1; stop=False; full=0; n=0
        save=lambda: (json.dump(Q,open(f+'.tmp','w')), os.replace(f+'.tmp',f), json.dump(known,open(ids+'.tmp','w')), os.replace(ids+'.tmp',ids))
        for q,res in pool(todo, search):
            if isinstance(res,DailyLimit): print('daily limit:',res,file=sys.stderr); stop=True; break
            if isinstance(res,Exception): print('failed',repr(q),res,file=sys.stderr); Q[q]=[]; continue   # a query the API rejects is a dead end, not a retry
            Q[q]=[c['id'] for c in res]
            for c in res:
                loc=c.get('location') or {}
                known[c['id']]={'club':c.get('club_name') or '','course':c.get('course_name') or '','city':loc.get('city') or '','state':loc.get('state') or '','country':loc.get('country') or ''}
            if len(res)>=25: full+=1
            n+=1
            if n%1500==0: save(); print(f'  … {n}/{len(todo)} · {len(known)} known',file=sys.stderr)   # a checkpoint every so often: a killed run loses minutes, not the round
        save()
        print(f'round {rounds}: {len(todo)} queries · {full} came back full · {len(known)} courses known',file=sys.stderr)
        if stop: sys.exit(2)
    print(len(known),'courses in the catalogue',file=sys.stderr); return known

# ---- 2. fetch every card once
def fetch_details():
    ids=json.load(open(os.path.join(OUT,'ids.json'))); f=os.path.join(OUT,'details.jsonl'); have=set()
    if os.path.exists(f):
        for line in open(f):
            try: have.add(json.loads(line)['id'])
            except Exception: pass
    todo=[i for i in ids if i not in have]; print(len(todo),'cards to fetch,',len(have),'already here',file=sys.stderr)
    out=open(f,'a'); n=0; bad=0
    for cid,res in pool(todo, lambda i: get(GCA+'/courses/'+i)):
        if isinstance(res,DailyLimit): print('daily limit:',res,file=sys.stderr); out.close(); sys.exit(2)
        if isinstance(res,Exception) or not res or not res.get('course'): bad+=1; continue
        c=res['course']; c['id']=c.get('id') or cid; out.write(json.dumps(c,separators=(',',':'))+'\n'); n+=1
        if n%500==0: out.flush(); print(n,'fetched',file=sys.stderr)
    out.close(); print(n,'fetched,',bad,'failed or empty',file=sys.stderr)

# ---- 3. rows
def country_code(name):
    n=str(name or '').strip().lower()
    if not n: return 'US'
    if n in COUNTRY: return COUNTRY[n]
    if len(n)==2 and n.isalpha(): return n.upper()
    return 'XX'
def build_rows():
    f=os.path.join(OUT,'details.jsonl'); rows=[]; seen={}; skipped={'no18':0,'nocard':0}; by_country={}
    for line in open(f):
        c=json.loads(line); loc=c.get('location') or {}; cc=country_code(loc.get('country'))
        r=row_from_gca(c)
        if not r:
            tees=c.get('tees') or {}; base=((tees.get('male') or tees.get('female') or [{}])[0]); skipped['no18' if base.get('holes') else 'nocard']+=1; continue
        r['country']=cc
        if cc!='US': r['id']=slug(cc.lower(),loc.get('state'),loc.get('city'),c.get('club_name'),'' if r['name']==r['club'] else r['name'])
        if r['id'] in seen and seen[r['id']]!=c['id']: r['id']=(r['id'][:70]+'-'+c['id'])[:80]   # two different cards, one slug
        seen[r['id']]=c['id']; rows.append(r); by_country[cc]=by_country.get(cc,0)+1
    with open(os.path.join(OUT,'rows.jsonl'),'w') as o:
        for r in rows: o.write(json.dumps(r,separators=(',',':'))+'\n')
    rep={'rows':len(rows),'skipped':skipped,'by_country':dict(sorted(by_country.items(),key=lambda x:-x[1]))}
    json.dump(rep,open(os.path.join(OUT,'report.json'),'w'),indent=1); print(json.dumps(rep),file=sys.stderr); return rows

# ---- 4. push
def push_rows():
    if not IMPORT_KEY: sys.exit('IMPORT_KEY is not set')
    f=os.path.join(OUT,'pushed.json'); pushed=set(json.load(open(f))) if os.path.exists(f) else set()
    rows=[json.loads(l) for l in open(os.path.join(OUT,'rows.jsonl'))]; todo=[r for r in rows if r['id'] not in pushed]
    print(len(todo),'rows to push,',len(pushed),'already up',file=sys.stderr); tot={'upserted':0,'verified':0,'owned':0}
    for i in range(0,len(todo),200):
        chunk=todo[i:i+200]; body=json.dumps({'rows':chunk}).encode()
        for t in range(4):
            try:
                req=urllib.request.Request(FN,data=body,headers={'Content-Type':'application/json','x-import-key':IMPORT_KEY},method='POST')
                with urllib.request.urlopen(req,timeout=180) as resp: res=json.loads(resp.read().decode())
                break
            except Exception as e:
                print('push failed',e,file=sys.stderr); time.sleep(3*(t+1)); res=None
        if not res or res.get('error') or res.get('errors'): print('stopped:',res,file=sys.stderr); break
        tot['upserted']+=res['upserted']; tot['verified']+=res['skipped']['verified']; tot['owned']+=res['skipped']['owned']
        pushed.update(r['id'] for r in chunk); json.dump(sorted(pushed),open(f,'w'))
        print(f"{i+len(chunk)}/{len(todo)} · {tot}",file=sys.stderr)
    print('done',tot,file=sys.stderr)

if __name__=='__main__':
    mode=sys.argv[1] if len(sys.argv)>1 else ''
    if mode in ('enumerate','all'): enumerate_ids()
    if mode in ('fetch','all'): fetch_details()
    if mode in ('rows','all'): build_rows()
    if mode in ('push','all'): push_rows()
    if mode not in ('enumerate','fetch','rows','push','all'): sys.exit(__doc__)
