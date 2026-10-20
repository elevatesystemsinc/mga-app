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
    def __init__(self): self.rows={}; self.writes=collections.Counter(); self.reads=0; self.tenancy=False; self.admin=False; self.user_tenants=['wccc']; self.grants=None; self.me='u-board'; self.auth_users=[]; self.fn=True
    # portal-setup.sql: a login (auth user + tenant_users row). role 'staff' | 'org'; orgs; manage
    def seed_login(self,email,tenant=None,role='staff',orgs=(),manage=False,name='',admin=False):
        uid='u-'+email; self.auth_users.append({'id':uid,'email':email,'password':'pw','created_at':'2026-01-01T00:00:00Z','last_sign_in_at':None,'confirmed':True,'name':name})
        if tenant: self._rows('tenant_users').append({'user_id':uid,'tenant':tenant,'role':role,'orgs':list(orgs),'manage':manage,'email':email,'name':name,'created_at':'2026-01-01T00:00:00Z'})
        if admin: self._rows('flagstick_admins').append({'user_id':uid,'email':email,'created_at':'2026-01-01T00:00:00Z'})
        return uid
    def _my_grant(self,tenant):
        return next((g for g in (self.grants if self.grants is not None else [r for r in self._rows('tenant_users') if r['user_id']==self.me]) if g['tenant']==tenant),None)
    def _cut_club(self,d,orgs):
        return {'id':'club','kind':'club','name':d.get('name'),'short':d.get('short'),'members':d.get('members',[]),'games':d.get('games',{}),'_rev':d.get('_rev'),'orgs':[o for o in d.get('orgs',[]) if o.get('id') in orgs]}
    def _k(self,table,id,tenant='wccc'): return (table,id) if tenant=='wccc' else (table,tenant+'/'+id)
    def seed(self,table,id,data,tenant='wccc'): self.rows[self._k(table,id,tenant)]={'table':table,'id':id,'tenant':tenant,'data':copy.deepcopy(data)}
    def get(self,table,id,tenant='wccc'): r=self.rows.get(self._k(table,id,tenant)); return copy.deepcopy(r['data']) if r else None
    # tenants-setup.sql: a tenant row; seeding one switches the fake into tenant mode
    def seed_tenant(self,slug,name,modules=None,hosts=(),login_email=None,status='active',plan='golf'):
        self.tenancy=True; self._rows('tenants').append({'slug':slug,'name':name,'short':slug.upper(),'plan':plan,'modules':modules or {'golf':True},'hosts':list(hosts),'login_email':login_email,'status':status,'notes':'','created_at':'2026-01-01T00:00:00Z'})
    def _match(self,row,filters):
        for kind,k,v in filters:
            if k=='id': val=row['id']
            elif k=='tenant': val=row.get('tenant','wccc')
            elif k=='data->>_rev': val=row['data'].get('_rev'); val=None if val is None else str(val)
            else: return False
            if kind=='eq' and val!=v: return False
            if kind=='is' and not(val is None and v is None): return False
        return True
    # ---- other tables (hub_keys …): plain rows with column filters
    def _rows(self,t): return self.rows.setdefault(('_tbl',t),{'table':t,'id':t,'data':[]})['data']
    def _col_match(self,row,filters): return all(row.get(k,'wccc' if k=='tenant' else None)==v for kind,k,v in filters if kind=='eq')
    # ---- the hub_key_* database functions, as in admin-links-setup.sql
    def _key_org(self,key):
        if not key or len(key)<16: return None
        h=hashlib.sha256(key.encode()).hexdigest()
        for r in self._rows('hub_keys'):
            if r['key_hash']==h and not r.get('revoked_at'): return r['org_id']
        return None
    def _key_tenant(self,key):
        h=hashlib.sha256(key.encode()).hexdigest() if key else None
        for r in self._rows('hub_keys'):
            if r['key_hash']==h and not r.get('revoked_at'): return r.get('tenant','wccc')
        return 'wccc'
    def _rpc(self,fn,a):
        err=lambda m:json.dumps({'data':None,'error':{'message':m,'code':'42501'}})
        if fn in('calcutta_get','calcutta_put'): return json.dumps({'data':None,'error':None})
        if fn=='tenant_lookup':
            if not self.tenancy: return json.dumps({'data':None,'error':{'message':'Could not find the function public.tenant_lookup(p_host) in the schema cache','code':'PGRST202'}})
            h=str(a.get('p_host') or '').lower().split(':')[0]
            t=next((t for t in self._rows('tenants') if h in (t['slug'],t['slug']+'.flagstickhub.com') or h in (t.get('hosts') or [])),None)
            return json.dumps({'data':({k:t[k] for k in ('slug','name','short','plan','modules','status','login_email')} if t else None),'error':None})
        if fn=='my_access':
            grants=self.grants if self.grants is not None else [{'tenant':r['tenant'],'role':r['role'],'orgs':r['orgs'],'manage':r.get('manage',False),'name':r.get('name','')} for r in self._rows('tenant_users') if r['user_id']==self.me]
            tenants=sorted({g['tenant'] for g in grants}|set(self.user_tenants)) if self.grants is None and not self._rows('tenant_users') else sorted({g['tenant'] for g in grants})
            return json.dumps({'data':{'admin':self.admin,'tenants':tenants,'grants':grants,'user_id':self.me,'email':'board@test'},'error':None})
        if fn=='scoped_read':
            g=self._my_grant(a['p_tenant']); d=self.get('mga_hub',a['p_id'],a['p_tenant'])
            if self.admin or (g and (g['role']=='staff' or a['p_id'] in g['orgs'])): self.reads+=1; return json.dumps({'data':d,'error':None})
            if a['p_id']=='club' and g: self.reads+=1; return json.dumps({'data':self._cut_club(d,g['orgs']) if d else None,'error':None})
            return err('not allowed')
        if fn=='scoped_people':
            r=self.rows.get(self._k('mga_hub','club',a['p_tenant']))
            if not r: return json.dumps({'data':False,'error':None})
            have={m.get('id') for m in r['data'].get('members',[])}; add=[p for p in a['p_people'] if isinstance(p,dict) and p.get('id') and p['id'] not in have]
            if add: r['data']['members']=r['data'].get('members',[])+copy.deepcopy(add); r['data']['_rev']=int(r['data'].get('_rev') or 0)+1; self.writes[('club' if a['p_tenant']=='wccc' else a['p_tenant']+'/club')]+=1
            return json.dumps({'data':True,'error':None})
        if fn=='admin_users_info':
            return json.dumps({'data':[{k:u.get(k) for k in ('id','email','created_at','last_sign_in_at','confirmed','name')} for u in self.auth_users if u['id'] in a['p_ids']],'error':None})
        if fn=='admin_user_by_email':
            u=next((u for u in self.auth_users if u['email'].lower()==str(a['p_email']).strip().lower()),None)
            return json.dumps({'data':({k:u.get(k) for k in ('id','email','created_at','last_sign_in_at','confirmed')} if u else None),'error':None})
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
        org=self._key_org(a.get('p_key')); tn=self._key_tenant(a.get('p_key'))
        if org is None: return err('invalid key')
        if fn=='hub_key_read':
            pid=a['p_id']; self.reads+=1
            if pid==org: return json.dumps({'data':self.get('mga_hub',pid,tn),'error':None})
            if pid=='club':
                d=self.get('mga_hub','club',tn)
                if d is None: return json.dumps({'data':None,'error':None})
                return json.dumps({'data':{'id':'club','kind':'club','name':d.get('name'),'short':d.get('short'),'crest':d.get('crest'),'members':d.get('members',[]),'games':d.get('games',{}),'_rev':d.get('_rev'),'orgs':[o for o in d.get('orgs',[]) if o.get('id')==org]},'error':None})
            return err('not allowed')
        if fn=='hub_key_write':
            if a['p_id']!=org: return err('not allowed')
            r=self.rows.get(self._k('mga_hub',org,tn))
            if not r: return json.dumps({'data':False,'error':None})
            cur=r['data'].get('_rev'); want=a.get('p_rev')
            if (want is None and cur is None) or (want is not None and cur is not None and int(cur)==int(want)):
                r['data']=copy.deepcopy(a['p_data']); self.writes[org]+=1; return json.dumps({'data':True,'error':None})
            return json.dumps({'data':False,'error':None})
        if fn=='hub_key_people':
            r=self.rows.get(self._k('mga_hub','club',tn))
            if not r: return json.dumps({'data':False,'error':None})
            have={m.get('id') for m in r['data'].get('members',[])}; add=[p for p in a['p_people'] if isinstance(p,dict) and p.get('id') and p['id'] not in have]
            if add: r['data']['members']=r['data'].get('members',[])+copy.deepcopy(add); r['data']['_rev']=int(r['data'].get('_rev') or 0)+1; self.writes['club']+=1
            return json.dumps({'data':True,'error':None})
        if fn in('hub_key_golf_event','hub_key_golf_delete','hub_key_score','hub_key_share'): return json.dumps({'data':True,'error':None})
        return err('unknown function '+fn)
    def _fn(self,name,b):   # supabase/functions/admin-users, in miniature
        if name!='admin-users' or not self.fn: return json.dumps({'data':None,'error':{'name':'FunctionsFetchError','message':'Failed to send a request to the Edge Function'}})
        act=b.get('action'); email=str(b.get('email','')).strip().lower()
        is_admin=self.admin; g=self._my_grant(b.get('tenant')) if b.get('tenant') else None
        role='org' if b.get('role')=='org' else 'staff'; orgs=[str(x) for x in (b.get('orgs') or [])]
        may=is_admin
        if not may and b.get('tenant') and not b.get('admin') and act in ('create','invite','set_password'):
            if g and g['role']=='staff': may=True
            elif g and g['role']=='org' and g.get('manage') and role=='org' and orgs and set(orgs)<=set(g['orgs']): may=True
        if not may: return json.dumps({'data':{'error':'Your login may not manage these logins'},'error':None})
        def link(uid):
            if b.get('tenant'):
                rows=self._rows('tenant_users'); rows[:]=[r for r in rows if not(r['user_id']==uid and r['tenant']==b['tenant'])]
                rows.append({'user_id':uid,'tenant':b['tenant'],'role':role,'orgs':orgs,'manage':role=='org' and bool(b.get('manage')),'email':email,'name':b.get('name') or '','invited_at':('2026-10-20T00:00:00Z' if act=='invite' else None),'created_at':'2026-10-20T00:00:00Z'})
            if b.get('admin'): self._rows('flagstick_admins').append({'user_id':uid,'email':email,'created_at':'2026-10-20T00:00:00Z'})
        if act in ('create','invite'):
            if any(u['email']==email for u in self.auth_users): return json.dumps({'data':{'error':'A user with this email address has already been registered'},'error':None})
            uid='u-'+email; self.auth_users.append({'id':uid,'email':email,'password':b.get('password'),'created_at':'2026-10-20T00:00:00Z','last_sign_in_at':None,'confirmed':act=='create','name':b.get('name') or '','invited':act=='invite'})
            link(uid); return json.dumps({'data':{'ok':True,'data':{'id':uid,'email':email}},'error':None})
        if act=='set_password':
            u=next((u for u in self.auth_users if u['id']==b.get('user_id')),None)
            if not u: return json.dumps({'data':{'error':'User not found'},'error':None})
            u['password']=b['password']; return json.dumps({'data':{'ok':True},'error':None})
        if act=='delete':
            self.auth_users[:]=[u for u in self.auth_users if u['id']!=b.get('user_id')]; rows=self._rows('tenant_users'); rows[:]=[r for r in rows if r['user_id']!=b.get('user_id')]
            return json.dumps({'data':{'ok':True},'error':None})
        if act=='sso': return json.dumps({'data':{'ok':True,'data':{'token_hash':'tok-'+self.me}},'error':None})
        return json.dumps({'data':{'error':'Unknown action'},'error':None})
    async def handle(self,source,payload):   # one synchronous step per call → atomic like a Postgres statement
        d=json.loads(payload); op=d['op']; a=d['args']; t=a.get('table')
        if op=='rpc': return self._rpc(a['fn'],a['args'])
        if op=='fn': return self._fn(a['name'],a['body'])
        if op=='poll':
            tn=a.get('tenant') or 'wccc'; r=self.rows.get(self._k(t,a['id'],tn)); return json.dumps({'data':copy.deepcopy(r['data']) if r else None,'tenant':tn})
        if t!='mga_hub':
            rows=self._rows(t); hits=[r for r in rows if self._col_match(r,a['filters'])]
            if op=='select': return json.dumps({'data':(copy.deepcopy(hits[0]) if hits else None) if a['single'] else copy.deepcopy(hits),'error':None})
            if op=='upsert':
                row=dict(a['payload']); key=('user_id','tenant') if 'user_id' in row and 'tenant' in row else ('user_id',) if 'user_id' in row else ('slug',) if 'slug' in row else ('id',)
                old=next((r for r in rows if all(r.get(k)==row.get(k) for k in key)),None)
                if old: old.update(copy.deepcopy(row))
                else: row.setdefault('created_at',datetime.datetime.utcnow().isoformat()+'Z'); rows.append(copy.deepcopy(row))
                return json.dumps({'data':None,'error':None})
            if op=='insert': row=dict(a['payload']); row.setdefault('id',str(uuid.uuid4())); row.setdefault('created_at',datetime.datetime.utcnow().isoformat()+'Z'); row.setdefault('at',row['created_at']); row.setdefault('revoked_at',None); rows.append(row); return json.dumps({'data':None,'error':None})
            if op=='update':
                for r in hits: r.update(a['payload'])
                return json.dumps({'data':[{'id':r.get('id')} for r in hits],'error':None})
            if op=='delete':
                rows[:]=[r for r in rows if r not in hits]; return json.dumps({'data':None,'error':None})
            return json.dumps({'data':None,'error':None})
        hits=[r for r in self.rows.values() if r['table']==t and self._match(r,a['filters'])]
        if op=='select':
            self.reads+=1; rows=[{'tenant':r.get('tenant','wccc'),'id':r['id'],'data':copy.deepcopy(r['data'])} for r in hits]
            return json.dumps({'data':(rows[0] if rows else None) if a['single'] else rows,'error':None})
        if op=='update':
            for r in hits: r['data']=copy.deepcopy(a['payload']['data']); self.writes[r['id'] if r.get('tenant','wccc')=='wccc' else r['tenant']+'/'+r['id']]+=1
            return json.dumps({'data':[{'id':r['id']} for r in hits],'error':None})
        if op in('upsert','insert'):
            p=a['payload']; tn=p.get('tenant','wccc'); self.rows[self._k(t,p['id'],tn)]={'table':t,'id':p['id'],'tenant':tn,'data':copy.deepcopy(p['data'])}; self.writes[p['id'] if tn=='wccc' else tn+'/'+p['id']]+=1
            return json.dumps({'data':None,'error':None})
        return json.dumps({'data':None,'error':{'message':'unknown op '+op}})

async def cloud(ctx,fdb,no_session=False):
    """a browser context whose pages talk to `fdb` as if it were Supabase (signed in as the board unless no_session)"""
    await ctx.expose_binding('__fdb',fdb.handle)
    await ctx.route('**/config.js',lambda r:r.fulfill(body="window.MM_CONFIG={url:'https://fake.local',anonKey:'k',boardEmail:'board@test'"+(",noSession:true" if no_session else "")+"};",content_type='text/javascript'))
    await ctx.route('**/supabase.min.js',lambda r:r.fulfill(path=FAKE,content_type='text/javascript'))
    await ctx.route('**/fonts.googleapis.com/**',lambda r:r.fulfill(body='',content_type='text/css'))
    if os.path.exists(XLSX): await ctx.route('**/xlsx.full.min.js',lambda r:r.fulfill(path=XLSX,content_type='text/javascript'))
