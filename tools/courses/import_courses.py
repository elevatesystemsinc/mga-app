#!/usr/bin/env python3
"""Build course-library rows for Flagstick (the `courses` table / the portal's Import JSON).

Sources
  GolfCourseAPI   scorecards: par, handicap and yardage per hole per tee, course rating and slope (GCA_KEY in the
                  environment; https://golfcourseapi.com). Searched by name — the API has no browse-by-place.
  OpenStreetMap   the list of courses in an area (Overpass, leisure=golf_course) and, where mappers drew them, the
                  hole centerlines (golf=hole ways) GameCast draws the map from. © OpenStreetMap contributors, ODbL.

Usage
  python3 import_courses.py search "Walnut Creek Country Club" "Dallas Athletic Club"  > rows.json
  python3 import_courses.py area dfw > dfw.json          # every OSM golf course in the DFW box, matched to the API
  python3 import_courses.py area 32.55,-97.55,33.25,-96.45 > rows.json   # any south,west,north,east box
  python3 import_courses.py ids wyprnm6v 0ad9mavs > rows.json           # straight by API id
  python3 import_courses.py names dfw_names.txt dfw > dfw.json          # a file of club names, kept when inside the box

Every row comes out unverified with source 'golfcourseapi' (+ ' osm' when the hole lines were found); check the
cards that matter against the printed scorecard or the USGA rating database and tick Verified in the portal.
"""
import json, os, re, sys, time, math, urllib.request, urllib.parse

GCA='https://api.golfcourseapi.com/v1'
OVERPASS='https://overpass-api.de/api/interpreter'
AREAS={'dfw':(32.45,-97.60,33.35,-96.35)}   # south, west, north, east
KEY=os.environ.get('GCA_KEY','')

class DailyLimit(Exception): pass
CACHE=os.path.join(os.path.dirname(os.path.abspath(__file__)),'.cache')   # fetched API records, so a re-run costs no requests
def get(url, headers=None, data=None, tries=4):
    for i in range(tries):
        try:
            r=urllib.request.Request(url, data=data, headers=headers or {})
            with urllib.request.urlopen(r, timeout=120) as resp: return json.loads(resp.read().decode())
        except urllib.error.HTTPError as e:
            body=''
            try: body=e.read().decode()
            except Exception: pass
            if e.code==429 and 'daily' in body.lower(): raise DailyLimit(body.strip())
            if e.code==429: time.sleep(3*(i+1)); continue
            if e.code==404: return None
            raise
        except Exception:
            if i==tries-1: raise
            time.sleep(2*(i+1))
def gca(path):
    if not KEY: sys.exit('GCA_KEY is not set')
    return get(GCA+path, {'Authorization':'Bearer '+KEY})

def slug(*parts):
    s='-'.join(str(p) for p in parts if p); s=re.sub(r"[’'`]","",s).lower(); s=re.sub(r'[^a-z0-9]+','-',s).strip('-'); return s[:80]
def tee_row(mt, ft):
    """one of our tees from the API's male tee (and the female tee of the same name when it exists)"""
    holes=mt.get('holes') or []
    yards=[h.get('yardage') for h in holes]
    t={'name':mt.get('tee_name') or 'Tee','rating':{'M':{},'W':{}},'yards':yards if len(yards)==18 and all(isinstance(y,(int,float)) and y>0 for y in yards) else None}
    if mt.get('course_rating'): t['rating']['M']={'cr':float(mt['course_rating']),'slope':int(mt['slope_rating'] or 0) or None}
    if ft and ft.get('course_rating'): t['rating']['W']={'cr':float(ft['course_rating']),'slope':int(ft['slope_rating'] or 0) or None}
    for s in ('M','W'):
        if t['rating'][s].get('slope') is None: t['rating'][s].pop('slope',None)
        if not t['rating'][s]: t['rating'].pop(s)
    if not t['rating']: t['rating']={}
    return t
def row_from_gca(c, geo=None):
    tees=c.get('tees') or {}; male=tees.get('male') or []; female=tees.get('female') or []
    if not male and not female: return None
    base=(male or female)[0]; holes=base.get('holes') or []
    if len(holes)!=18: return None            # nine-holers and odd cards: by hand
    par=[h.get('par') for h in holes]; hcp=[h.get('handicap') for h in holes]
    fbase=female[0] if female else None; fholes=(fbase or {}).get('holes') or []
    parW=[h.get('par') for h in fholes] if len(fholes)==18 else par; hcpW=[h.get('handicap') for h in fholes] if len(fholes)==18 else hcp
    ok=lambda a,lo,hi: all(isinstance(v,(int,float)) and lo<=v<=hi for v in a)
    if not ok(par,3,6): return None
    if not ok(hcp,1,18) or len(set(hcp))!=18: hcp=list(range(1,19)); note='stroke index missing from the source — 1–18 placeholder, fix from the card'
    else: note=''
    if not ok(hcpW,1,18) or len(set(hcpW))!=18: hcpW=hcp
    if not ok(parW,3,6): parW=par
    fby={(t.get('tee_name') or '').strip().lower():t for t in female}
    tlist=[tee_row(mt, fby.get((mt.get('tee_name') or '').strip().lower())) for mt in male] or [tee_row(ft,ft) for ft in female]
    loc=c.get('location') or {}; club=c.get('club_name') or ''; name=c.get('course_name') or club
    if name==club: name=re.sub(r'\b(golf|country) club\b.*$','',club,flags=re.I).strip() and club   # one-course clubs: the course is the club
    rid=slug(loc.get('state'),loc.get('city'),club,'' if name==club else name)
    return {'id':rid,'tenant':None,'name':name if name!=club else club,'club':club,'city':loc.get('city') or '','state':loc.get('state') or '','country':'US','holes':18,
            'data':{'par':{'M':par,'W':parW},'hcp':{'M':hcp,'W':hcpW},'tees':tlist},'geo':geo,'source':'golfcourseapi'+(' osm' if geo else ''),'verified':False,
            'notes':(note+(' · ' if note else '')+'GolfCourseAPI id '+c.get('id','')+(' · %s, %s'%(loc.get('latitude'),loc.get('longitude')) if loc.get('latitude') else '')).strip(' ·')}

# ---- OpenStreetMap: the courses in a box, and hole lines
def overpass(q):
    return get(OVERPASS, {'Content-Type':'application/x-www-form-urlencoded'}, urllib.parse.urlencode({'data':q}).encode())
def osm_courses(box):
    s,w,n,e=box
    q=f'[out:json][timeout:180];(way["leisure"="golf_course"]({s},{w},{n},{e});relation["leisure"="golf_course"]({s},{w},{n},{e}););out center tags;'
    out=[]
    for el in (overpass(q) or {}).get('elements',[]):
        t=el.get('tags') or {}; c=el.get('center') or {}
        if not t.get('name') or not c: continue
        out.append({'osm':f"{el['type']}/{el['id']}",'name':t['name'],'lat':c['lat'],'lon':c['lon'],'holes':t.get('holes'),'access':t.get('access')})
    return out
def osm_holes(lat,lon,radius=1800):
    """golf=hole ways within reach of a point → {"1":[[lat,lng],…]}; several courses at one club come back mixed, so
    only kept when exactly 18 distinct refs are found"""
    q=f'[out:json][timeout:120];way["golf"="hole"](around:{radius},{lat},{lon});out geom tags;'
    els=(overpass(q) or {}).get('elements',[]); geo={}
    for el in els:
        ref=str((el.get('tags') or {}).get('ref') or '').strip(); pts=[[round(p['lat'],6),round(p['lon'],6)] for p in el.get('geometry') or []]
        if ref.isdigit() and 1<=int(ref)<=18 and len(pts)>=2 and ref not in geo: geo[ref]=pts
    return geo if len(geo)==18 else None
def dist_km(a,b,c,d):
    p=math.pi/180; x=(c-a)*p; y=(d-b)*p*math.cos((a+c)/2*p); return 6371*math.hypot(x,y)

def cached(key, fetch):
    os.makedirs(CACHE, exist_ok=True); f=os.path.join(CACHE, re.sub(r'[^a-z0-9]+','-',key.lower()).strip('-')[:120]+'.json')
    if os.path.exists(f): return json.load(open(f))
    v=fetch(); json.dump(v, open(f,'w')); return v
def search_name(name):
    r=cached('search '+name, lambda: gca('/search?search_query='+urllib.parse.quote(name))); return (r or {}).get('courses') or []
def course(cid): r=cached('course '+cid, lambda: gca('/courses/'+cid)); return (r or {}).get('course')

def main():
    if len(sys.argv)<3: sys.exit(__doc__)
    mode, args=sys.argv[1], sys.argv[2:]; rows=[]; seen=set()
    def add(c, geo=None):
        r=row_from_gca(c, geo)
        if r and r['id'] not in seen: seen.add(r['id']); rows.append(r)
        elif not r: print('skipped (no 18-hole card):',c.get('club_name'),c.get('course_name'),file=sys.stderr)
    try: run(mode,args,add)
    except DailyLimit as e: print('GolfCourseAPI daily limit reached ('+str(e)+') — writing what was gathered; run again tomorrow, the cache skips what is done',file=sys.stderr)
    json.dump(rows, sys.stdout, indent=1); print(file=sys.stdout); print(len(rows),'rows',file=sys.stderr)
def run(mode,args,add):
    if mode=='ids':
        for cid in args:
            c=course(cid)
            if c: add(c)
    elif mode=='search':
        for name in args:
            hits=search_name(name)
            if not hits: print('no match:',name,file=sys.stderr)
            for h in hits: 
                c=course(h['id']); 
                if c: add(c); time.sleep(0.3)
    elif mode=='area':
        box=AREAS.get(args[0]) or tuple(float(x) for x in args[0].split(','))
        found=osm_courses(box); print(len(found),'golf courses in OpenStreetMap for that box',file=sys.stderr)
        for f in found:
            hits=search_name(f['name']); best=None
            for h in hits:
                loc=h.get('location') or {}
                if loc.get('latitude') and dist_km(f['lat'],f['lon'],loc['latitude'],loc['longitude'])<6: best=hits if False else h; break
            if not best: print('not in GolfCourseAPI:',f['name'],file=sys.stderr); continue
            geo=None
            try: geo=osm_holes(f['lat'],f['lon'])
            except Exception as e: print('osm holes failed for',f['name'],e,file=sys.stderr)
            # a club with several courses in the API: take every course at that location
            for h in hits:
                loc=h.get('location') or {}
                if loc.get('latitude') and dist_km(f['lat'],f['lon'],loc['latitude'],loc['longitude'])<6:
                    c=course(h['id'])
                    if c: add(c, geo if len(hits)==1 else None)
                    time.sleep(0.3)
            time.sleep(1)
    elif mode=='names':
        # a file of club names (one per line, # comments), each looked up by name; an optional box keeps only courses inside it
        box=AREAS.get(args[1]) if len(args)>1 else None
        if len(args)>1 and not box: box=tuple(float(x) for x in args[1].split(','))
        names=[l.strip() for l in open(args[0]) if l.strip() and not l.startswith('#')]
        for name in names:
            hits=search_name(name); kept=0
            for h in hits:
                loc=h.get('location') or {}
                if box and not (loc.get('latitude') and box[0]<=loc['latitude']<=box[2] and box[1]<=loc['longitude']<=box[3]): continue
                c=course(h['id'])
                if c: add(c); kept+=1
                time.sleep(0.3)
            if not kept: print('no match in the box:',name,file=sys.stderr)
    else: sys.exit(__doc__)
if __name__=='__main__': main()
