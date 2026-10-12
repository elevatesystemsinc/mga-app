/* Stand-in for supabase-js used by the tests: every query goes to a shared in-memory Postgres stand-in on the
   Python side (window.__fdb), so two browser contexts see one database. Realtime is a 250 ms poll per channel. */
(function(){
  const call=(op,args)=>window.__fdb(JSON.stringify({op,args})).then(r=>JSON.parse(r));
  class Q{ constructor(t){ this.t=t; this.op='select'; this.filters=[]; this.single=false; this.payload=null; }
    select(){ return this; } update(o){ this.op='update'; this.payload=o; return this; } upsert(o){ this.op='upsert'; this.payload=o; return this; } insert(o){ this.op='insert'; this.payload=o; return this; } delete(){ this.op='delete'; return this; }
    eq(k,v){ this.filters.push(['eq',k,v]); return this; } is(k,v){ this.filters.push(['is',k,v]); return this; } maybeSingle(){ this.single=true; return this; } single(){ this.single=true; return this; }
    then(ok,bad){ return call(this.op,{table:this.t,payload:this.payload,filters:this.filters,single:this.single}).then(ok,bad); } }
  window.supabase={createClient(){ return {
    auth:{getSession:async()=>({data:{session:(window.MM_CONFIG||{}).noSession?null:{user:{email:'board@test'}}}}),signInWithPassword:async()=>({error:null}),signOut:async()=>({})},
    from(t){ return new Q(t); },
    rpc(fn,args){ return call('rpc',{fn,args:args||{}}); },
    channel(){ const subs=[]; const ch={on(ev,opts,cb){ subs.push({opts,cb}); return ch; },
      subscribe(){ const seen={}; ch._iv=setInterval(async()=>{ for(const s of subs){ const id=(s.opts.filter||'').replace('id=eq.',''); const r=await call('poll',{table:s.opts.table,id});
        if(r&&r.data){ const rev=r.data._rev; if(seen[id]!==rev){ seen[id]=rev; s.cb({new:{data:r.data}}); } } } },250); return ch; },
      unsubscribe(){ clearInterval(ch._iv); } }; return ch; },
    removeChannel(c){ c&&c.unsubscribe&&c.unsubscribe(); } }; } };
})();
