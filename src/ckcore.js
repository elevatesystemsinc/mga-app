/* =====================================================================
   Check-in core — shared by the hub and the registration page.
   doc = { name, players:[{id,last,first,partner,team,par3,in,at,u}], _del:[] }
   Each player carries u (last changed); copies merge player by player, newest wins.
   ===================================================================== */
const ckStable=x=>{ if(Array.isArray(x)) return '['+x.map(ckStable).join(',')+']'; if(x&&typeof x==='object') return '{'+Object.keys(x).filter(k=>x[k]!==undefined).sort().map(k=>JSON.stringify(k)+':'+ckStable(x[k])).join(',')+'}'; return JSON.stringify(x===undefined?null:x); };
const ckStrip=p=>{ const o=Object.assign({},p); delete o.u; return o; };
function ckStamp(doc,base,now){ now=now||Date.now(); const bm=new Map(((base&&base.players)||[]).map(p=>[p.id,{s:ckStable(ckStrip(p)),u:p.u||0}]));
  for(const p of doc.players||[]){ const b=bm.get(p.id); if(!b||b.s!==ckStable(ckStrip(p))){ if(!((p.u||0)>(b?b.u:0))) p.u=now; } } }
function ckMerge(r,l){ r=r||{}; l=l||{}; const m=new Map(); for(const p of r.players||[]) m.set(p.id,p);
  for(const p of l.players||[]){ const c=m.get(p.id); if(!c||(p.u||0)>=(c.u||0)) m.set(p.id,p); }
  return {name:l.name||r.name, players:[...m.values()].sort((a,b)=>(a.last+' '+a.first).localeCompare(b.last+' '+b.first))}; }
async function ckSyncOnce(get,put,local){
  for(let n=0;n<4;n++){ const rem=await get(); const merged=ckMerge(rem.doc,local);
    if(ckStable(merged)===ckStable(rem.doc)) return {doc:rem.doc,version:rem.version,wrote:false};
    try{ const v=await put(merged,rem.version); return {doc:merged,version:v,wrote:true}; }catch(e){ if(!/conflict/i.test(e.message||'')) throw e; } }
  throw new Error('Too many people saving at once — try again'); }
const ckCounts=doc=>{ const ps=doc.players||[], inn=ps.filter(p=>p.in).length, teams=new Map();
  ps.forEach(p=>{ const t=teams.get(p.team)||[0,0]; t[0]++; if(p.in) t[1]++; teams.set(p.team,t); });
  return {total:ps.length,in:inn,left:ps.length-inn,teams:teams.size,teamsDone:[...teams.values()].filter(([a,b])=>a===b).length}; };

