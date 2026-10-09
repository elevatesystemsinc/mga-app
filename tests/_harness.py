"""Shared test setup. local(): run a page with no Supabase. FakeDB + cloud(): a shared in-memory stand-in for
Postgres (atomic compare-and-swap, write counts per row) behind a fake supabase-js, for multi-device tests."""
import os,json,copy,collections,hashlib,uuid,datetime
ROOT=os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
XLSX=os.path.join(ROOT,'tests','node_modules','xlsx','dist','xlsx.full.min.js')
FAKE=os.path.join(ROOT,'tests','fake_supabase.js')
JSPDF=os.path.join(ROOT,'tests','node_modules','jspdf','dist','jspdf.umd.min.js')
async def _common(pg):
    await pg.route('**/fonts.googleapis.com/**',lambda r:r.fulfill(body='',content_type='text/css'))
    if os.path.exists(XLSX): await pg.route('**/xlsx.full.min.js',lambda r:r.fulfill(path=XLSX,content_type='text/javascript'))
    if os.path.exists(JSPDF): await pg.route('**/jspdf.umd.min.js',lambda r:r.fulfill(path=JSPDF,content_type='text/javascript'))
async def local(pg):
    await pg.route('**/config.js',lambda r:r.fulfill(body="window.MM_CONFIG={};",content_type='text/javascript'))
    await pg.route('**/supabase.min.js',lambda r:r.fulfill(body="",content_type='text/javascript'))
    await _common(pg)
def page(name): return 'file://'+os.path.join(ROOT,name)

class FakeDB:
    def __init__(self): self.rows={}; self.writes=collections.Counter(); self.reads=0
    def seed(self,table,id,data): self.rows[(table,id)]={'table':table,'id':id,'data':copy.deepcopy(data)}
    def get(self,table,id): r=self.rows.get((table,id)); return copy.deepcopy(r['data']) if r else None
    def _match(self,row,filters):
        for kind,k,v in filters:
            if k=='id': val=row['id']
            elif k=='data->>_rev': val=row['data'].get('_rev'); val=None if val is None else str(val)
            else: return False
            if kind=='eq' and val!=v: return False
            if kind=='is' and not(val is None and v is None): return False
        return True
    # ---- other tables (hub_keys …): plain rows with column filters
    def _rows(self,t): return self.rows.setdefault(('_tbl',t),{'table':t,'id':t,'data':[]})['data']
    def _col_match(self,row,filters): return all(row.get(k)==v for kind,k,v in filters if kind=='eq')
    # ---- the hub_key_* database functions, as in admin-links-setup.sql
    def _key_org(self,key):
        if not key or len(key)<16: return None
        h=hashlib.sha256(key.encode()).hexdigest()
        for r in self._rows('hub_keys'):
            if r['key_hash']==h and not r.get('revoked_at'): return r['org_id']
        return None
    def _rpc(self,fn,a):
        err=lambda m:json.dumps({'data':None,'error':{'message':m,'code':'42501'}})
        if fn in('calcutta_get','calcutta_put'): return json.dumps({'data':None,'error':None})
        # the public scoring page's functions, as in golf-setup.sql, over the golf_events / golf_scores tables
        if fn=='golf_event':
            r=next((r for r in self._rows('golf_events') if str(r.get('slug','')).lower()==str(a.get('p_slug','')).strip().lower()),None)
            return json.dumps({'data':dict(copy.deepcopy(r['public']),id=r['id']) if r else None,'error':None})
        if fn=='golf_join':
            r=next((r for r in self._rows('golf_events') if str(r.get('slug','')).lower()==str(a.get('p_slug','')).strip().lower()),None)
            return json.dumps({'data':(r or {}).get('codes',{}).get(str(a.get('p_code','')).upper()),'error':None})
        if fn=='golf_submit':
            rows=self._rows('golf_scores'); rows[:]=[r for r in rows if not(r['event_id']==a['p_event'] and r['player_id']==a['p_player'] and r['hole']==a['p_hole'])]
            if a.get('p_strokes'): rows.append({'event_id':a['p_event'],'player_id':a['p_player'],'hole':a['p_hole'],'strokes':a['p_strokes']})
            return json.dumps({'data':True,'error':None})
        org=self._key_org(a.get('p_key'))
        if org is None: return err('invalid key')
        if fn=='hub_key_read':
            pid=a['p_id']; self.reads+=1
            if pid==org: return json.dumps({'data':self.get('mga_hub',pid),'error':None})
            if pid=='club':
                d=self.get('mga_hub','club')
                if d is None: return json.dumps({'data':None,'error':None})
                return json.dumps({'data':{'id':'club','kind':'club','name':d.get('name'),'short':d.get('short'),'crest':d.get('crest'),'members':d.get('members',[]),'games':d.get('games',{}),'_rev':d.get('_rev'),'orgs':[o for o in d.get('orgs',[]) if o.get('id')==org]},'error':None})
            return err('not allowed')
        if fn=='hub_key_write':
            if a['p_id']!=org: return err('not allowed')
            r=self.rows.get(('mga_hub',org))
            if not r: return json.dumps({'data':False,'error':None})
            cur=r['data'].get('_rev'); want=a.get('p_rev')
            if (want is None and cur is None) or (want is not None and cur is not None and int(cur)==int(want)):
                r['data']=copy.deepcopy(a['p_data']); self.writes[org]+=1; return json.dumps({'data':True,'error':None})
            return json.dumps({'data':False,'error':None})
        if fn=='hub_key_people':
            r=self.rows.get(('mga_hub','club'))
            if not r: return json.dumps({'data':False,'error':None})
            have={m.get('id') for m in r['data'].get('members',[])}; add=[p for p in a['p_people'] if isinstance(p,dict) and p.get('id') and p['id'] not in have]
            if add: r['data']['members']=r['data'].get('members',[])+copy.deepcopy(add); r['data']['_rev']=int(r['data'].get('_rev') or 0)+1; self.writes['club']+=1
            return json.dumps({'data':True,'error':None})
        if fn in('hub_key_golf_event','hub_key_golf_delete','hub_key_score','hub_key_share'): return json.dumps({'data':True,'error':None})
        return err('unknown function '+fn)
    async def handle(self,source,payload):   # one synchronous step per call → atomic like a Postgres statement
        d=json.loads(payload); op=d['op']; a=d['args']; t=a.get('table')
        if op=='rpc': return self._rpc(a['fn'],a['args'])
        if op=='poll': r=self.rows.get((t,a['id'])); return json.dumps({'data':copy.deepcopy(r['data']) if r else None})
        if t!='mga_hub':
            rows=self._rows(t); hits=[r for r in rows if self._col_match(r,a['filters'])]
            if op=='select': return json.dumps({'data':(copy.deepcopy(hits[0]) if hits else None) if a['single'] else copy.deepcopy(hits),'error':None})
            if op=='upsert':
                row=dict(a['payload']); rows[:]=[r for r in rows if r.get('id')!=row.get('id')]; rows.append(copy.deepcopy(row)); return json.dumps({'data':None,'error':None})
            if op=='insert': row=dict(a['payload']); row.setdefault('id',str(uuid.uuid4())); row.setdefault('created_at',datetime.datetime.utcnow().isoformat()+'Z'); row.setdefault('revoked_at',None); rows.append(row); return json.dumps({'data':None,'error':None})
            if op=='update':
                for r in hits: r.update(a['payload'])
                return json.dumps({'data':[{'id':r.get('id')} for r in hits],'error':None})
            if op=='delete':
                rows[:]=[r for r in rows if r not in hits]; return json.dumps({'data':None,'error':None})
            return json.dumps({'data':None,'error':None})
        hits=[r for r in self.rows.values() if r['table']==t and self._match(r,a['filters'])]
        if op=='select':
            self.reads+=1; rows=[{'data':copy.deepcopy(r['data'])} for r in hits]
            return json.dumps({'data':(rows[0] if rows else None) if a['single'] else rows,'error':None})
        if op=='update':
            for r in hits: r['data']=copy.deepcopy(a['payload']['data']); self.writes[r['id']]+=1
            return json.dumps({'data':[{'id':r['id']} for r in hits],'error':None})
        if op in('upsert','insert'):
            p=a['payload']; self.rows[(t,p['id'])]={'table':t,'id':p['id'],'data':copy.deepcopy(p['data'])}; self.writes[p['id']]+=1
            return json.dumps({'data':None,'error':None})
        return json.dumps({'data':None,'error':{'message':'unknown op '+op}})

async def cloud(ctx,fdb,no_session=False):
    """a browser context whose pages talk to `fdb` as if it were Supabase (signed in as the board unless no_session)"""
    await ctx.expose_binding('__fdb',fdb.handle)
    await ctx.route('**/config.js',lambda r:r.fulfill(body="window.MM_CONFIG={url:'https://fake.local',anonKey:'k',boardEmail:'board@test'"+(",noSession:true" if no_session else "")+"};",content_type='text/javascript'))
    await ctx.route('**/supabase.min.js',lambda r:r.fulfill(path=FAKE,content_type='text/javascript'))
    await ctx.route('**/fonts.googleapis.com/**',lambda r:r.fulfill(body='',content_type='text/css'))
    if os.path.exists(XLSX): await ctx.route('**/xlsx.full.min.js',lambda r:r.fulfill(path=XLSX,content_type='text/javascript'))
