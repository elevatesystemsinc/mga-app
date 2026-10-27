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
    def __init__(self): self.rows={}; self.writes=collections.Counter(); self.reads=0; self.tenancy=False; self.admin=False; self.user_tenants=['wccc']; self.grants=None; self.me='u-board'; self.auth_users=[]; self.fn=True; self.mails=[]
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
        if fn=='member_me':
            me=next((u for u in self.auth_users if u['id']==self.me),None); em=(me or {}).get('email','').lower()
            club=self.get('mga_hub','club',a['p_tenant']) or {}
            m=next((x for x in club.get('members',[]) if str(x.get('email','')).lower()==em),None)
            if not em or not m: return json.dumps({'data':{'member':None,'reason':'not a member' if em else 'not signed in','club':club.get('name')},'error':None})
            rows=self._rows('member_users'); u=next((r for r in rows if r['tenant']==a['p_tenant'] and r['member_id']==m['id']),None)
            if not u: u={'tenant':a['p_tenant'],'member_id':m['id'],'email':em,'user_id':self.me,'autopay':False,'stripe_customer':None,'stripe_pm':None,'pm_label':None,'created_at':'2026-10-26T00:00:00Z','last_seen':None}; rows.append(u)
            u['last_seen']='2026-10-26T12:00:00Z'
            items=sorted([i for i in self._rows('acct_items') if i.get('tenant','wccc')==a['p_tenant'] and i['member_id']==m['id'] and not i.get('void_at')],key=lambda i:(i.get('posted',''),i.get('created_at','')))
            st=sorted([x for x in self._rows('acct_statements') if x.get('tenant','wccc')==a['p_tenant'] and x['member_id']==m['id']],key=lambda x:x['period_end'],reverse=True)
            t=next((t for t in self._rows('tenants') if t['slug']==a['p_tenant']),{})
            facs=[f for f in ((club.get('booking') or {}).get('facilities') or []) if f.get('members',True)]
            bks=sorted([b for b in self._rows('bookings') if b.get('tenant','wccc')==a['p_tenant'] and b['member_id']==m['id'] and b['status'] in ('booked','checked_in') and b['date']>=datetime.date.today().isoformat()],key=lambda b:(b['date'],b['time']))
            return json.dumps({'data':{'member':{k:m.get(k) for k in ('id','first','last','memberNo','email','address1','city','state','zip','status')},'club':club.get('name'),'message':(club.get('billing') or {}).get('message'),'items':items,'statements':st,'facilities':facs,'bookings':bks,'events':sorted([e for e in (club.get('events') or []) if e.get('public',True) and (e.get('end') or e['date'])>=datetime.date.today().isoformat()],key=lambda e:(e['date'],e.get('start') or '')),'brand':(club.get('brand') or {}).get('logo'),'autopay':u['autopay'],'pm_label':u['pm_label'],'online':bool(t.get('stripe_account')) and bool((t.get('stripe_status') or {}).get('charges_enabled'))},'error':None})
        if fn.startswith('pos_') or fn=='staff_clock':
            key=a.get('p_key') or ''; h=hashlib.sha256(key.encode()).hexdigest() if key else None
            st=next((r for r in self._rows('pos_stations') if r['key_hash']==h and not r.get('revoked_at')),None) if len(key)>=16 else None
            if not st: return json.dumps({'data':None,'error':{'message':'This station link is not valid','code':'42501'}})
            tn=st.get('tenant','wccc'); club=self.get('mga_hub','club',tn) or {}; pos=club.get('pos') or {}; outlet=next((o for o in pos.get('outlets',[]) if o['id']==st.get('outlet')),None) or {}
            tix=self._rows('pos_tickets'); fires=self._rows('pos_fires'); now=datetime.datetime.utcnow().isoformat()+'Z'
            STAFF=club.get('staff') or pos.get('staff') or []; DEPT=st.get('dept') or (('fnb' if outlet.get('kind')=='fnb' else (outlet.get('dept') or 'golf')) if outlet else None)
            fits=lambda x:x.get('active',True) and (not st.get('outlet') or not x.get('outlets') or st['outlet'] in x['outlets']) and (not DEPT or not x.get('depts') or DEPT in x['depts'])
            if fn=='staff_clock':
                pin=str(a.get('p_pin') or ''); hh=hashlib.sha256((tn+':'+pin).encode()).hexdigest() if len(pin)>=4 else None
                x=next((x for x in STAFF if x.get('pin')==hh and fits(x)),None)
                if not x: return json.dumps({'data':None,'error':None})
                CK=self._rows('staff_clock'); r=next((c for c in sorted(CK,key=lambda c:c['in_at'],reverse=True) if c['staff_id']==x['id'] and not c.get('out_at')),None)
                if a.get('p_action')=='in' and not r: r={'id':str(uuid.uuid4()),'tenant':tn,'staff_id':x['id'],'name':x['name'],'dept':DEPT,'in_at':now,'out_at':None,'station':st['id'],'note':None}; CK.append(r)
                elif a.get('p_action')=='out' and r: r['out_at']=now
                return json.dumps({'data':{'id':x['id'],'name':x['name'],'role':x.get('role','staff'),'dept':DEPT,'open':({'id':r['id'],'in_at':r['in_at']} if r and not r.get('out_at') else None),'last':({'id':r['id'],'in_at':r['in_at'],'out_at':r['out_at']} if r and r.get('out_at') else None)},'error':None})
            if fn=='pos_boot':
                st['last_seen']=now; t=next((t for t in self._rows('tenants') if t['slug']==tn),{}); mods=t.get('modules') or {}
                staff=[{'id':x['id'],'name':x['name'],'role':x.get('role','server')} for x in STAFF if fits(x)]
                items=(club.get('billing') or {}).get('items') or []; it=next((x for x in items if x['id']==outlet.get('item')),None)
                return json.dumps({'data':{'station':{'id':st['id'],'name':st['name'],'kind':st['kind'],'expo':st.get('expo'),'outlet':st.get('outlet'),'dept':DEPT},'club':club.get('name'),'brand':(club.get('brand') or {}).get('logo'),'tenant':tn,'outlet':outlet,'products':[x for x in pos.get('products',[]) if x['outlet']==st['outlet'] and x.get('active',True)],'staff':staff,'rates':{'tax':((club.get('billing') or {}).get('tax') or {}).get('rate',0),'svc':((club.get('billing') or {}).get('svc') or {}).get('rate',0)},'item':it,'billing':bool(mods.get('billing') or mods.get('club'))},'error':None})
            if fn=='pos_pin':
                pin=str(a.get('p_pin') or ''); hh=hashlib.sha256((tn+':'+pin).encode()).hexdigest() if len(pin)>=4 else None
                x=next((x for x in STAFF if x.get('pin')==hh and fits(x)),None)
                return json.dumps({'data':{'id':x['id'],'name':x['name'],'role':x.get('role','server')} if x else None,'error':None})
            if fn=='pos_members':
                q=str(a.get('p_q') or '').lower(); L=[m for m in club.get('members',[]) if m.get('status','Active')!='Inactive' and len(q)>=2 and (q in (m.get('first','')+' '+m.get('last','')).lower() or m.get('memberNo','')==q)][:8]
                return json.dumps({'data':[{'id':m['id'],'name':(m.get('first','')+' '+m.get('last','')).strip(),'memberNo':m.get('memberNo'),'suspended':(m.get('billing') or {}).get('status')=='suspended'} for m in L],'error':None})
            if fn=='pos_checks': return json.dumps({'data':[t for t in tix if t.get('tenant','wccc')==tn and t['outlet']==st['outlet'] and t['status']=='open'],'error':None})
            if fn=='pos_check_put':
                c=dict(a['p_check']); cid=c.get('id') or str(uuid.uuid4()); ex=next((t for t in tix if t['id']==cid),None)
                row={'id':cid,'tenant':tn,'outlet':st['outlet'],'station':st['id'],'table_no':c.get('table_no'),'server':c.get('server'),'server_id':c.get('server_id'),'guests':c.get('guests') or 0,'member_id':c.get('member_id'),'guest':c.get('guest'),'lines':c.get('lines') or [],'note':c.get('note'),'subtotal':c.get('subtotal') or 0,'svc':c.get('svc') or 0,'tax':c.get('tax') or 0,'tip':c.get('tip') or 0,'total':c.get('total') or 0,'status':'open','paid':None,'acct_item':None,'created_at':(ex or {}).get('created_at') or now,'created_by':c.get('server') or 'station','updated_at':now,'closed_at':None,'void_at':None,'void_reason':None}
                if ex:
                    if ex['status']!='open': return json.dumps({'data':ex,'error':None})
                    ex.update({k:row[k] for k in ('table_no','server','server_id','guests','member_id','guest','lines','note','subtotal','svc','tax','tip','total','updated_at')}); row=ex
                else: tix.append(row)
                return json.dumps({'data':row,'error':None})
            r=next((t for t in tix if t['id']==a.get('p_ticket') and t.get('tenant','wccc')==tn and t['outlet']==st['outlet']),None)
            if fn=='pos_fire':
                if not r or r['status']!='open': return err('Check not open')
                co=a.get('p_course'); ok=lambda l:l.get('route') and not l.get('fired') and (co is None or int(l.get('course') or 0) in (0,co))
                routes=sorted({l.get('route') for l in r['lines'] if ok(l)})
                for e in routes: fires.append({'id':str(uuid.uuid4()),'tenant':tn,'outlet':st['outlet'],'expo':e,'station':st['id'],'ticket':r['id'],'table_no':r.get('table_no'),'server':r.get('server'),'lines':[l for l in r['lines'] if ok(l) and l.get('route')==e],'note':('Course %s'%co) if co and co>1 else None,'fired_at':now,'done_at':None})
                for l in r['lines']:
                    if ok(l): l['fired']=True; l['fired_at']=now
                return json.dumps({'data':{'fired':len(routes),'lines':r['lines']},'error':None})
            if fn=='pos_pay':
                if not r or r['status']!='open': return err('Check not open')
                d=a.get('p_pay') or {}
                if d.get('totals'): r['subtotal']=d['totals']['subtotal']; r['svc']=d['totals']['svc']; r['tax']=d['totals']['tax']; r['lines']=d.get('lines') or r['lines']
                method=d.get('method') or 'cash'; amt=round(float(d.get('amount') or 0),2); tip=round(float(d.get('tip') or 0),2); net=round(amt-tip,2); mid=d.get('member_id')
                if net<=0: return err('Nothing to pay')
                owed=round(r['subtotal']+r['svc']+r['tax'],2); paid=round(sum(float(p['amount'])-float(p.get('tip') or 0) for p in r.get('payments') or []),2)
                if net>owed-paid+0.01: return err('That is more than what is owed')
                pay={'id':str(uuid.uuid4()),'method':method,'amount':amt,'tip':tip,'member_id':mid,'label':d.get('label'),'at':now,'by':r.get('server')}
                if method=='account':
                    if not mid: return err('Pick the member first')
                    m=next((x for x in club.get('members',[]) if x['id']==mid),None)
                    if not m: return err('Unknown member')
                    if (m.get('billing') or {}).get('status')=='suspended': return err('This member is suspended — no charges to the account')
                    items=(club.get('billing') or {}).get('items') or []; it=next((x for x in items if x['id']==outlet.get('item','fnb')),{'id':outlet.get('item','fnb'),'source':'fnb','gl':''}); share=net/owed if owed else 1
                    aid=str(uuid.uuid4()); self._rows('acct_items').append({'id':aid,'tenant':tn,'member_id':mid,'kind':'charge','source':it.get('source','fnb'),'item':it['id'],'gl':it.get('gl',''),'ref':'pos:%s:%s'%(r['id'],pay['id']),'descr':(outlet.get('name') or st['outlet'])+' · '+(d.get('label') or ', '.join(l['name'] for l in r['lines']))+((' · tip %s'%tip) if tip else ''),'amount':amt,'tax':round(r['tax']*share,2),'svc':round(r['svc']*share,2),'method':None,'reference':None,'posted':datetime.date.today().isoformat(),'void_at':None,'void_reason':None,'created_at':now,'created_by':r.get('server') or 'station'}); pay['acct_item']=aid
                r['payments']=(r.get('payments') or [])+[pay]; paid=round(paid+net,2)
                if paid>=owed-0.005:
                    tips=round(sum(float(p.get('tip') or 0) for p in r['payments']),2); r.update({'tip':tips,'total':round(owed+tips,2),'paid':'split' if len(r['payments'])>1 else method,'member_id':mid or r.get('member_id'),'acct_item':pay.get('acct_item') or r.get('acct_item'),'status':'closed','closed_at':now,'updated_at':now})
                else: r.update({'member_id':mid or r.get('member_id'),'updated_at':now})
                return json.dumps({'data':r,'error':None})
            if fn=='pos_shift':
                day=str(a.get('p_date') or datetime.date.today().isoformat())
                return json.dumps({'data':[t for t in tix if t.get('tenant','wccc')==tn and t['outlet']==st['outlet'] and t['status'] in ('closed','void') and str(t.get('closed_at') or t.get('void_at') or '')[:10]==day],'error':None})
            if fn=='pos_close':
                if not r or r['status']!='open': return err('Check not open')
                d=a.get('p_data') or {}; paid=d.get('paid') or 'cash'
                for k in ('lines','tip','subtotal','svc','tax','total','member_id','guest'):
                    if d.get(k) is not None: r[k]=d[k]
                r.update({'paid':paid,'status':'closed','closed_at':now,'updated_at':now})
                if paid=='account':
                    if not r.get('member_id'): return err('Pick the member first')
                    m=next((x for x in club.get('members',[]) if x['id']==r['member_id']),None)
                    if not m: return err('Unknown member')
                    if (m.get('billing') or {}).get('status')=='suspended': return err('This member is suspended — no charges to the account')
                    items=(club.get('billing') or {}).get('items') or []; it=next((x for x in items if x['id']==outlet.get('item','fnb')),{'id':outlet.get('item','fnb'),'source':'fnb','gl':''})
                    aid=str(uuid.uuid4()); self._rows('acct_items').append({'id':aid,'tenant':tn,'member_id':r['member_id'],'kind':'charge','source':it.get('source','fnb'),'item':it['id'],'gl':it.get('gl',''),'ref':'pos:'+r['id'],'descr':(outlet.get('name') or st['outlet'])+' · '+', '.join((str(l['qty'])+'× ' if l['qty']>1 else '')+l['name'] for l in r['lines']),'amount':r['total'],'tax':r['tax'],'svc':r['svc'],'method':None,'reference':None,'posted':datetime.date.today().isoformat(),'void_at':None,'void_reason':None,'created_at':now,'created_by':r.get('server') or 'station'}); r['acct_item']=aid
                return json.dumps({'data':r,'error':None})
            if fn=='pos_void':
                if not r: return err('Unknown check')
                r.update({'status':'void','void_at':now,'void_reason':a.get('p_reason') or '','updated_at':now})
                for i in self._rows('acct_items'):
                    if (i['id']==r.get('acct_item') or str(i.get('ref','')).startswith('pos:'+r['id'])) and not i.get('void_at'): i['void_at']=now; i['void_reason']='Check voided at the station: '+(a.get('p_reason') or '')
                return json.dumps({'data':True,'error':None})
            if fn=='pos_expo':
                if st['kind']!='expo': return json.dumps({'data':None,'error':None})
                mine=[f for f in fires if f.get('tenant','wccc')==tn and f['expo']==st.get('expo')]
                return json.dumps({'data':{'station':{'id':st['id'],'name':st['name'],'outlet':st['outlet'],'expo':st.get('expo')},'open':sorted([f for f in mine if not f['done_at']],key=lambda f:f['fired_at']),'done':sorted([f for f in mine if f['done_at']],key=lambda f:f['done_at'],reverse=True)[:12]},'error':None})
            if fn=='pos_bump':
                for f in fires:
                    if f['id']==a.get('p_fire') and f['expo']==st.get('expo'): f['done_at']=None if a.get('p_undo') else now
                return json.dumps({'data':True,'error':None})
        if fn in ('member_slots','member_book','member_cancel'):   # booking-setup.sql, in miniature
            me=next((u for u in self.auth_users if u['id']==self.me),None); em=(me or {}).get('email','').lower()
            club=self.get('mga_hub','club',a['p_tenant']) or {}; m=next((x for x in club.get('members',[]) if str(x.get('email','')).lower()==em),None)
            mid=m and m['id']; rows=self._rows('bookings'); live=lambda b:b.get('tenant','wccc')==a['p_tenant'] and b['status'] in ('booked','checked_in')
            if fn=='member_slots':
                day=str(a['p_date']); taken=[{'time':b['time'],'unit':b['unit'],'n':max(1,len(b.get('players') or [])),'mine':b['member_id']==mid} for b in rows if live(b) and b['facility']==a['p_facility'] and b['date']==day]
                mine=sorted([b for b in rows if live(b) and b['member_id']==mid and b['date']>=datetime.date.today().isoformat()],key=lambda b:(b['date'],b['time']))
                blocked=[{'from':k['from_t'],'to':k['to_t'],'units':k.get('units'),'reason':k.get('reason')} for k in self._rows('booking_blocks') if k.get('tenant','wccc')==a['p_tenant'] and k['facility']==a['p_facility'] and k['date']==day]
                return json.dumps({'data':{'taken':taken,'mine':mine,'blocked':blocked},'error':None})
            if fn=='member_book':
                if not mid: return err('Your e-mail is not on the club directory')
                f=next((f for f in ((club.get('booking') or {}).get('facilities') or []) if f['id']==a['p_facility']),None)
                if not f: return err('Unknown facility')
                if not f.get('members',True): return err('This facility is booked by the club office')
                if (m.get('billing') or {}).get('status')=='suspended': return err('Your account is suspended — please see the club office')
                day=str(a['p_date']); today=datetime.date.today()
                if day<today.isoformat(): return err('That day has passed')
                if day>(today+datetime.timedelta(days=int(f.get('lead',7)))).isoformat(): return err('Members may book up to %s days ahead'%f.get('lead',7))
                t=a['p_time']; mins=lambda x:int(x[:2])*60+int(x[3:5])
                if t<f.get('open','00:00') or t>=f.get('close','24:00') or (mins(t)-mins(f.get('open','00:00')))%max(1,int(f.get('slot',60))): return err('Not a bookable time')
                blk=next((k for k in self._rows('booking_blocks') if k.get('tenant','wccc')==a['p_tenant'] and k['facility']==f['id'] and k['date']==day and k['from_t']<=t<k['to_t'] and (not k.get('units') or a['p_unit'] in k['units'])),None)
                if blk: return err('That time is not available — %s'%(blk.get('reason') or 'closed'))
                players=a.get('p_players') or []; n=max(1,len(players)); cap=max(1,int(f.get('cap',1)))
                if n>cap: return err('At most %s per booking'%cap)
                same=[b for b in rows if live(b) and b['facility']==f['id'] and b['date']==day and b['time']==t and b['unit']==a['p_unit']]; used=sum(max(1,len(b.get('players') or [])) for b in same)
                if f.get('kind')=='tee':
                    if used+n>cap: return err('That tee time is full')
                elif same: return err('That time is taken')
                if f.get('onePerDay',True) and any(b for b in rows if live(b) and b['facility']==f['id'] and b['date']==day and b['member_id']==mid): return err('You already have a booking here that day')
                bid=str(uuid.uuid4()); aid=None; fee=float((f.get('fee') or {}).get('amount') or 0)
                if fee>0:
                    per=(f.get('fee') or {}).get('per','booking'); it=next((x for x in ((club.get('billing') or {}).get('items') or []) if x['id']==(f.get('fee') or {}).get('item','facility')),{'id':'facility','source':'facility','gl':''})
                    aid=str(uuid.uuid4()); self._rows('acct_items').append({'id':aid,'tenant':a['p_tenant'],'member_id':mid,'kind':'charge','source':it.get('source','facility'),'item':it['id'],'gl':it.get('gl',''),'ref':'bk:'+bid,'descr':f['name']+' · '+day+' '+t,'amount':round(fee*n if per=='player' else fee,2),'tax':0,'svc':0,'method':None,'reference':None,'posted':today.isoformat(),'void_at':None,'void_reason':None,'created_at':datetime.datetime.utcnow().isoformat()+'Z','created_by':'member'})
                rows.append({'id':bid,'tenant':a['p_tenant'],'facility':f['id'],'date':day,'time':t,'unit':a['p_unit'],'member_id':mid,'name':(m.get('first','')+' '+m.get('last','')).strip(),'players':players,'note':a.get('p_note') or '','status':'booked','source':'member','acct_item':aid,'created_by':'member','created_at':datetime.datetime.utcnow().isoformat()+'Z','cancelled_at':None})
                return json.dumps({'data':{'ok':True,'id':bid},'error':None})
            b=next((b for b in rows if b['id']==a['p_id'] and b.get('tenant','wccc')==a['p_tenant'] and b['member_id']==mid),None)
            if not b: return err('Not your booking')
            if b['status']!='booked': return err('This booking can no longer be cancelled')
            b['status']='cancelled'; b['cancelled_at']=datetime.datetime.utcnow().isoformat()+'Z'
            if b.get('acct_item'):
                for i in self._rows('acct_items'):
                    if i['id']==b['acct_item'] and not i.get('void_at'): i['void_at']=b['cancelled_at']; i['void_reason']='Booking cancelled by the member'
            return json.dumps({'data':True,'error':None})
        if fn=='member_autopay_off':
            for r in self._rows('member_users'):
                if r['tenant']==a['p_tenant'] and r.get('user_id')==self.me: r['autopay']=False; r['stripe_pm']=None; r['pm_label']=None
            return json.dumps({'data':True,'error':None})
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
            return json.dumps({'data':dict(copy.deepcopy(r['public']),id=r['id'],wrap=copy.deepcopy(r.get('wrap'))) if r else None,'error':None})
        # wrap-setup.sql: the wrap-up from the course, compare-and-swap on wrap.v
        if fn=='golf_wrap':
            e=next((r for r in self._rows('golf_events') if r['id']==a.get('p_event')),None)
            if not e: return json.dumps({'data':None,'error':{'message':'Unknown event','code':'P0001'}})
            who=str(a.get('p_code','')).strip().upper()
            if who not in (e.get('codes') or {}): return json.dumps({'data':None,'error':{'message':'Unknown group ID','code':'P0001'}})
            w=copy.deepcopy(e.get('wrap') or {}); cur=int(w.get('v') or 0)
            if cur!=(a.get('p_rev') if a.get('p_rev') is not None else -1): return json.dumps({'data':None,'error':{'message':'conflict','code':'P0001'}})
            act=a.get('p_action'); d=a.get('p_data'); now=datetime.datetime.utcnow().isoformat()+'Z'
            closed=('closedAt' in w) or e['public'].get('status')=='final'
            if act=='close':
                if 'closedAt' in w: return json.dumps({'data':None,'error':{'message':'conflict','code':'P0001'}})
                w['closedAt']=now; w['closedBy']=who; e['public']['status']='final'
            elif act in ('draw','callout'):
                if not closed: return json.dumps({'data':None,'error':{'message':'Close scoring first','code':'P0001'}})
                k=(d or {}).get('comp')
                if not k: return json.dumps({'data':None,'error':{'message':'Which competition?','code':'P0001'}})
                if act=='draw': x=dict((d or {})); x.pop('comp',None); x.update(at=now,by=who); w.setdefault('draws',{})[k]=x
                else: w.setdefault('callouts',{})[k]={'at':now,'by':who}
            elif act=='payouts':
                if not closed: return json.dumps({'data':None,'error':{'message':'Close scoring first','code':'P0001'}})
                if 'payouts' in w: return json.dumps({'data':None,'error':{'message':'conflict','code':'P0001'}})
                if not isinstance((d or {}).get('comps'),dict): return json.dumps({'data':None,'error':{'message':'Nothing to record','code':'P0001'}})
                w['payouts']=dict(copy.deepcopy(d),at=now,by=who)
            else: return json.dumps({'data':None,'error':{'message':'Unknown action','code':'P0001'}})
            w['v']=cur+1; e['wrap']=w; self.writes['wrap:'+e['id']]+=1
            return json.dumps({'data':copy.deepcopy(w),'error':None})
        if fn=='golf_join':
            r=next((r for r in self._rows('golf_events') if str(r.get('slug','')).lower()==str(a.get('p_slug','')).strip().lower()),None)
            return json.dumps({'data':(r or {}).get('codes',{}).get(str(a.get('p_code','')).upper()),'error':None})
        if fn=='golf_submit':
            e=next((r for r in self._rows('golf_events') if r['id']==a.get('p_event')),None)
            if e and (e['public'].get('status')!='live' or 'closedAt' in (e.get('wrap') or {})): return json.dumps({'data':None,'error':{'message':'Scoring is closed for this event','code':'P0001'}})
            rows=self._rows('golf_scores'); rows[:]=[r for r in rows if not(r['event_id']==a['p_event'] and r['player_id']==a['p_player'] and r['hole']==a['p_hole'])]
            if a.get('p_strokes'): rows.append({'event_id':a['p_event'],'player_id':a['p_player'],'hole':a['p_hole'],'strokes':a['p_strokes']})
            return json.dumps({'data':True,'error':None})
        # survey-setup.sql: the public survey page's two functions (anonymous: answers + the day only)
        if fn=='survey_get':
            r=next((r for r in self._rows('survey_share') if r.get('token') and r['token']==a.get('p_token')),None)
            return json.dumps({'data':({'sid':r['sid'],'status':r.get('status','draft'),'doc':copy.deepcopy(r['doc'])} if r else None),'error':None})
        if fn=='survey_submit':
            r=next((r for r in self._rows('survey_share') if r.get('token') and r['token']==a.get('p_token')),None)
            if not r: return json.dumps({'data':None,'error':{'message':'Invalid link','code':'P0001'}})
            if r.get('status')!='open': return json.dumps({'data':None,'error':{'message':'closed','code':'P0001'}})
            ans=a.get('p_answers')
            if not isinstance(ans,dict) or not ans: return json.dumps({'data':None,'error':{'message':'Nothing to send','code':'P0001'}})
            self._rows('survey_responses').append({'id':str(uuid.uuid4()),'tenant':r.get('tenant','wccc'),'org':r['org'],'sid':r['sid'],'answers':copy.deepcopy(ans),'day':datetime.date.today().isoformat()})
            return json.dumps({'data':True,'error':None})
        org=self._key_org(a.get('p_key')); tn=self._key_tenant(a.get('p_key'))
        if fn=='hub_key_survey':
            if org is None: return err('invalid key')
            rows=self._rows('survey_share')
            if a.get('p_doc') is None:
                rows[:]=[r for r in rows if not(r['sid']==a['p_sid'] and r['org']==org)]; rr=self._rows('survey_responses'); rr[:]=[r for r in rr if not(r['sid']==a['p_sid'] and r['org']==org)]; return json.dumps({'data':True,'error':None})
            old=next((r for r in rows if r['sid']==a['p_sid']),None)
            if old and old['org']!=org: return err('not allowed')
            row={'sid':a['p_sid'],'tenant':tn,'org':org,'token':a.get('p_token'),'status':a.get('p_status') or 'draft','doc':copy.deepcopy(a['p_doc'])}
            if old: old.update(row)
            else: rows.append(row)
            return json.dumps({'data':True,'error':None})
        if fn=='hub_key_survey_results':
            if org is None: return err('invalid key')
            return json.dumps({'data':[{'answers':copy.deepcopy(r['answers']),'day':r['day']} for r in self._rows('survey_responses') if r['sid']==a['p_sid'] and r['org']==org],'error':None})
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
        if fn=='hub_key_wrap':
            e=next((r for r in self._rows('golf_events') if r['id']==a.get('p_event')),None)
            if e: e['wrap']=copy.deepcopy(a.get('p_wrap'))
            return json.dumps({'data':True,'error':None})
        if fn in('hub_key_golf_event','hub_key_golf_delete','hub_key_score','hub_key_share'): return json.dumps({'data':True,'error':None})
        return err('unknown function '+fn)
    def _fn(self,name,b):   # supabase/functions/admin-users, in miniature; mail records what was sent; stripe is never configured here
        if name=='mail' and self.fn:
            self.mails.append(b); return json.dumps({'data':{'ok':True,'id':'m-'+str(len(self.mails))},'error':None})
        if name=='stripe' and self.fn: return json.dumps({'data':{'error':'not configured: set STRIPE_SECRET_KEY'},'error':None})
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
                row=dict(a['payload']); key=('user_id','tenant') if 'user_id' in row and 'tenant' in row else ('user_id',) if 'user_id' in row else ('slug',) if 'slug' in row else ('sid',) if 'sid' in row else ('tenant','org') if 'org' in row and 'id' not in row else ('id',)
                old=next((r for r in rows if all(r.get(k)==row.get(k) for k in key)),None)
                if old: old.update(copy.deepcopy(row))
                else: row.setdefault('created_at',datetime.datetime.utcnow().isoformat()+'Z'); rows.append(copy.deepcopy(row))
                return json.dumps({'data':None,'error':None})
            if op=='insert':   # one row or a list of rows, as supabase-js takes them
                for row in ([dict(x) for x in a['payload']] if isinstance(a['payload'],list) else [dict(a['payload'])]):
                    row.setdefault('id',str(uuid.uuid4())); row.setdefault('created_at',datetime.datetime.utcnow().isoformat()+'Z'); row.setdefault('at',row['created_at']); row.setdefault('revoked_at',None); rows.append(row)
                return json.dumps({'data':None,'error':None})
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

def seed_from_main(fdb,main,tenant='wccc'):
    """the club row (directory) and the MGA row (memberships + everything else) from a document in the old MGA Hub shape"""
    strip=('status','joined','notes')
    persons=[dict({'status':'Active'},**{k:v for k,v in m.items() if k not in strip}) for m in main['members']]
    orgs=[{'id':'mga','kind':'association','name':'Men’s Golf Association','short':'MGA'},{'id':'lga','kind':'association','name':'Ladies’ Golf Association','short':'LGA'},{'id':'smga','kind':'association','name':'Senior Men’s Golf Association','short':'SMGA'}]
    club={'v':2,'id':'club','kind':'club','name':'Walnut Creek Country Club','short':'WCCC','members':persons,'orgs':orgs,'activeSeason':main.get('activeSeason','2026'),'seasons':{main.get('activeSeason','2026'):{}},'tournaments':[],'_rev':1,'_w':'seed','_at':1}
    mga={k:copy.deepcopy(v) for k,v in main.items() if k not in ('members','_rev','_w','_at')}
    mga.update({'v':2,'id':'mga','kind':'association','name':orgs[0]['name'],'short':orgs[0]['short'],'memberships':[{'id':m['id'],'status':m.get('status','Active'),'joined':m.get('joined',''),'notes':m.get('notes','')} for m in main['members']],'_rev':1,'_w':'seed','_at':1})
    fdb.seed('mga_hub','club',club,tenant); fdb.seed('mga_hub','mga',mga,tenant); return club,mga
