"""Shared test setup. local(): run a page with no Supabase. FakeDB + cloud(): a shared in-memory stand-in for
Postgres (atomic compare-and-swap, write counts per row) behind a fake supabase-js, for multi-device tests."""
import os,json,copy,collections
ROOT=os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
XLSX=os.path.join(ROOT,'tests','node_modules','xlsx','dist','xlsx.full.min.js')
FAKE=os.path.join(ROOT,'tests','fake_supabase.js')
async def _common(pg):
    await pg.route('**/fonts.googleapis.com/**',lambda r:r.fulfill(body='',content_type='text/css'))
    if os.path.exists(XLSX): await pg.route('**/xlsx.full.min.js',lambda r:r.fulfill(path=XLSX,content_type='text/javascript'))
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
    async def handle(self,source,payload):   # one synchronous step per call → atomic like a Postgres statement
        d=json.loads(payload); op=d['op']; a=d['args']; t=a.get('table')
        if op=='poll': r=self.rows.get((t,a['id'])); return json.dumps({'data':copy.deepcopy(r['data']) if r else None})
        if t!='mga_hub': return json.dumps({'data':None,'error':None})
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

async def cloud(ctx,fdb):
    """a browser context whose pages talk to `fdb` as if it were Supabase (already signed in)"""
    await ctx.expose_binding('__fdb',fdb.handle)
    await ctx.route('**/config.js',lambda r:r.fulfill(body="window.MM_CONFIG={url:'https://fake.local',anonKey:'k',boardEmail:'board@test'};",content_type='text/javascript'))
    await ctx.route('**/supabase.min.js',lambda r:r.fulfill(path=FAKE,content_type='text/javascript'))
    await ctx.route('**/fonts.googleapis.com/**',lambda r:r.fulfill(body='',content_type='text/css'))
    if os.path.exists(XLSX): await ctx.route('**/xlsx.full.min.js',lambda r:r.fulfill(path=XLSX,content_type='text/javascript'))
