/* =====================================================================
   Calcutta core — pure logic shared by the hub and the cashier page.
   ===================================================================== */
const c0=v=>{ const x=parseFloat(v); return isFinite(x)?x:0; };
const flightName=f=>/^\d+$/.test(String(f))?'Flight '+f:String(f||'—');
const idxTxt2=v=>v==null||v===''?'—':(+v<0?'+'+Math.abs(+v).toFixed(1):(+v).toFixed(1));
const teamName=l=>l&&l.isPool?`The Pool (${l.count} team${l.count===1?'':'s'})`:`${l.p1} & ${l.p2}`;
/* teams that didn't reach the minimum; sold together as one extra lot after the last one */
/* team buy-in: every team owns a share of itself (default 25% for $300) before the auction;
   a team can pre-buy the rest (default $900 more) and then isn't auctioned at all */
const BUYIN_DEFAULT={on:false,pct:25,amount:300,prebuyExtra:900};   // off unless turned on for this Calcutta
const buyInOf=c=>Object.assign({},BUYIN_DEFAULT,c.buyIn||{});
function teamDue(c,l){ const bi=buyInOf(c); if(!bi.on) return 0; return c0(bi.amount)+(l.prebuy?c0(bi.prebuyExtra):0); }
/* a team's own payments, kept apart: the buy-in (its 25%) and, if pre-bought, the pre-buy (the rest) */
function teamParts(c,l){ const bi=buyInOf(c); if(!bi.on) return [];
  const ps=teamPlayers(l), each=c0(bi.amount)/(ps.length||1);
  const out=ps.map((name,i)=>({kind:'buyin',label:`${name} · buy-in`,player:i,name,amount:each,pay:(l.buyInP||[])[i]||{}}));
  if(l.prebuy){ const pe=c0(bi.prebuyExtra)/(ps.length||1); ps.forEach((name,i)=>out.push({kind:'prebuy',label:`${name} · pre-buy`,player:i,name,amount:pe,pay:(l.prebuyP||[])[i]||{}})); }
  return out; }
/* older data kept the whole $1,200 on the buy-in; split it once */
const teamPlayers=l=>[l.p1,l.p2].filter(Boolean);
/* per-player buy-in payment: set one player's, keeping the other's */
function setBuyInPay(l,i,pay){ const n=teamPlayers(l).length||1; l.buyInP=Array.from({length:n},(_,k)=>(l.buyInP||[])[k]||{paid:false,method:''}); l.buyInP[i]={paid:!!pay.paid,method:pay.paid?(pay.method||''):''}; }
function calcNormalize(c){ for(const l of c.lots||[]){
    if(l.buyIn&&!l.buyInP){ const n=teamPlayers(l).length||1; l.buyInP=Array.from({length:n},()=>({paid:!!l.buyIn.paid,method:l.buyIn.paid?(l.buyIn.method||''):''})); }   // older data: one team payment → each player
    if(l.prebuy&&l.buyIn&&l.buyIn.paid&&!l.prebuyPay&&!l.prebuyP) l.prebuyPay={paid:true,method:l.buyIn.method||''};
    if(l.prebuyPay&&!l.prebuyP){ const n=teamPlayers(l).length||1; l.prebuyP=Array.from({length:n},()=>({paid:!!l.prebuyPay.paid,method:l.prebuyPay.paid?(l.prebuyPay.method||''):''})); }   // one team payment → each player
    delete l.prebuyPay; } return c; }
function setPrebuyPay(l,i,pay){ const n=teamPlayers(l).length||1; l.prebuyP=Array.from({length:n},(_,k)=>(l.prebuyP||[])[k]||{paid:false,method:''}); l.prebuyP[i]={paid:!!pay.paid,method:pay.paid?(pay.method||''):''}; }
const ownership=(c,l)=>{ const bi=buyInOf(c); return l.prebuy?{team:100,buyer:0}:(bi.on?{team:c0(bi.pct),buyer:100-c0(bi.pct)}:{team:0,buyer:100}); };
const poolTeams=c=>c.lots.filter(l=>l.pooled&&!l.prebuy);
const poolLotNum=c=>c.lots.reduce((a,l)=>Math.max(a,+l.lot||0),0)+1;
function poolLot(c){ const ts=poolTeams(c); return ts.length?{id:'__pool',isPool:true,lot:poolLotNum(c),count:ts.length,teams:ts,bidderId:c.pool.bidderId,price:c0(c.pool.price),flight:'Pool'}:null; }
const auctionSeq=c=>{ const p=poolLot(c); return c.lots.filter(l=>!l.prebuy).concat(p?[p]:[]); };
function setPooled(c,l,on){ l.pooled=!!on; if(on){ l.price=0; l.bidderId=''; l.prebuy=false; } if(!poolTeams(c).length) c.pool={bidderId:'',price:0}; }
function setPrebuy(c,l,on){ l.prebuy=!!on; if(on){ l.price=0; l.bidderId=''; l.pooled=false; if(!l.prebuyP) l.prebuyP=teamPlayers(l).map(()=>({paid:false,method:''})); } if(!poolTeams(c).length) c.pool={bidderId:'',price:0}; }
function calcTotalsC(c){
  const flights=[...new Set(c.lots.map(l=>flightName(l.flight)))].sort((a,b)=>a.localeCompare(b,undefined,{numeric:true}));
  const exp=c.expenses.reduce((a,e)=>a+c0(e.amount),0), share=flights.length?exp/flights.length:0;
  const pt=poolTeams(c), pp=c0(c.pool.price), perPoolTeam=pt.length&&pp>0?pp/pt.length:0;   // pool price shared by its teams' flights
  const byF=flights.map(f=>{ const ls=c.lots.filter(l=>flightName(l.flight)===f);
    const sold=ls.filter(l=>!l.pooled&&!l.prebuy&&c0(l.price)>0), inPool=ls.filter(l=>l.pooled&&!l.prebuy), pre=ls.filter(l=>l.prebuy);
    const fromPool=inPool.length*perPoolTeam, auction=sold.reduce((a,l)=>a+c0(l.price),0), buyIns=ls.reduce((a,l)=>a+teamDue(c,l),0);
    const gross=auction+fromPool+buyIns, net=gross-share;
    return {flight:f,teams:ls.length,sold:sold.length,pooled:inPool.length,prebuy:pre.length,fromPool,auction,buyIns,gross,share,net,places:c.payout.map(p=>Math.max(0,net)*c0(p)/100)}; });
  const pot=byF.reduce((a,f)=>a+f.gross,0), soldLots=c.lots.filter(l=>!l.pooled&&!l.prebuy&&c0(l.price)>0), pre=c.lots.filter(l=>l.prebuy).length;
  const buyIns=byF.reduce((a,f)=>a+f.buyIns,0), auctionTotal=byF.reduce((a,f)=>a+f.auction,0)+pp;
  const prices=soldLots.map(l=>c0(l.price)).concat(pp>0?[pp]:[]);
  return {flights,byF,exp,share,pot,net:pot-exp,sold:soldLots.length+(pp>0?pt.length:0),auctionLots:c.lots.length-pre,prebuy:pre,buyIns,auctionTotal,lots:c.lots.length,pooled:pt.length,poolPrice:pp,poolLot:pt.length?poolLotNum(c):null,
          top:prices.reduce((a,v)=>Math.max(a,v),0),avg:prices.length?prices.reduce((a,v)=>a+v,0)/prices.length:0,payPct:c.payout.reduce((a,p)=>a+c0(p),0)};
}
const bidderById=(c,id)=>c.bidders.find(b=>b.id===id);
const bidderByNum=(c,n)=>c.bidders.find(b=>String(b.num)===String(n).trim());
const bidderLabel=b=>b?`#${b.num} ${b.name}`:'—';
function bidderOwes(c,b){ const ls=c.lots.filter(l=>!l.pooled&&l.bidderId===b.id&&c0(l.price)>0); const p=poolLot(c); if(p&&p.bidderId===b.id&&p.price>0) ls.push(p); return {lots:ls,total:ls.reduce((a,l)=>a+c0(l.price),0)}; }


/* payments: what's been collected, by method, and what's still owed */
const PAY_METHODS=['Cash','Zelle','Credit card','Check'];
function calcPayments(c){
  /* three kinds of money, never mixed: auction purchases (paid by the buyer), team buy-ins and pre-buys (paid by the team) */
  const KINDS=['auction','buyin','prebuy'], zero=()=>{ const o={}; PAY_METHODS.forEach(m=>o[m]=0); o.notRecorded=0; return o; };
  const g={}; KINDS.forEach(k=>g[k]={by:zero(),due:0,paid:0,owed:0,count:0,countPaid:0});
  let buyers=0, paid=0;
  const add=(k,amt,pay)=>{ const G=g[k]; G.due+=amt; G.count++; if(pay&&pay.paid){ G.paid+=amt; G.countPaid++; if(pay.method&&G.by[pay.method]!=null) G.by[pay.method]+=amt; else G.by.notRecorded+=amt; } else G.owed+=amt; };
  for(const b of c.bidders){ const o=bidderOwes(c,b); if(!(o.total>0)) continue; buyers++; if(b.paid) paid++; add('auction',o.total,b.paid?{paid:true,method:b.method}:null); }
  for(const l of c.lots) for(const p of teamParts(c,l)) if(p.amount>0) add(p.kind,p.amount,p.pay);
  const by={}; PAY_METHODS.forEach(m=>by[m]=KINDS.reduce((a,k)=>a+g[k].by[m],0));
  const notRecorded=KINDS.reduce((a,k)=>a+g[k].by.notRecorded,0), collected=KINDS.reduce((a,k)=>a+g[k].paid,0), outstanding=KINDS.reduce((a,k)=>a+g[k].owed,0);
  const hasCount=c.cashCount!=null&&c.cashCount!=='', expectedCash=c0(c.cashFloat)+by.Cash;
  return {by,g,notRecorded,collected,outstanding,buyers,paid,bidPaid:g.auction.paid,
    biDue:g.buyin.due+g.prebuy.due,biPaid:g.buyin.paid+g.prebuy.paid,biOwed:g.buyin.owed+g.prebuy.owed,biTeams:g.buyin.count,biTeamsPaid:g.buyin.countPaid,
    expectedCash,cashCount:hasCount?c0(c.cashCount):null,overShort:hasCount?c0(c.cashCount)-expectedCash:null};
}
/* ---------- shared editing (hub + cashiers) ----------
   Each team, bidder and expense carries a last-changed time (u). Before saving, anything that changed
   since the last sync is stamped; when two copies meet, the newer version of each item wins, deletes
   travel as tombstones, and settings (minimum, payout, pool, cash counts) merge as one unit. */
const CALC_KINDS=['lots','bidders','expenses'];
const CALC_SET=['minBid','payout','pool','cashCount','cashFloat','file','importedAt','buyIn','paidOut'];
function calcStable(x){ if(Array.isArray(x)) return '['+x.map(calcStable).join(',')+']'; if(x&&typeof x==='object') return '{'+Object.keys(x).filter(k=>x[k]!==undefined).sort().map(k=>JSON.stringify(k)+':'+calcStable(x[k])).join(',')+'}'; return JSON.stringify(x===undefined?null:x); }
const calcStrip=e=>{ const o=Object.assign({},e); delete o.u; return o; };
const calcSettings=c=>{ const o={}; CALC_SET.forEach(k=>{ o[k]=c[k]===undefined?null:c[k]; }); return o; };
function calcDoc(c){ const d={}; CALC_KINDS.forEach(k=>d[k]=JSON.parse(JSON.stringify(c[k]||[]))); CALC_SET.forEach(k=>{ if(c[k]!==undefined) d[k]=JSON.parse(JSON.stringify(c[k])); });
  d._su=c._su||0; d._del=JSON.parse(JSON.stringify(c._del||[])); if(c.people) d.people=c.people; if(c.name) d.name=c.name; return d; }
function calcStamp(c,base,now){
  now=now||Date.now(); base=base||{}; c._del=c._del||[];
  for(const k of CALC_KINDS){ const bm=new Map((base[k]||[]).map(e=>[e.id,{s:calcStable(calcStrip(e)),u:e.u||0}])); const ids=new Set();
    for(const e of c[k]||[]){ ids.add(e.id); const b0=bm.get(e.id);
      if(!b0||b0.s!==calcStable(calcStrip(e))){ if(!((e.u||0)>(b0?b0.u:0))) e.u=now; } }   // stamp once per change, not on every check
    for(const id of bm.keys()) if(!ids.has(id)&&!c._del.some(d=>d.kind===k&&d.id===id)) c._del.push({kind:k,id,u:now}); }
  if(calcStable(calcSettings(c))!==calcStable(calcSettings(base))&&!((c._su||0)>(base._su||0))) c._su=now;
}
function calcMerge(r,l){
  r=r||{}; l=l||{}; const out={};
  const dm=new Map(); for(const d of (r._del||[]).concat(l._del||[])){ const key=d.kind+'|'+d.id; if(!dm.has(key)||dm.get(key).u<d.u) dm.set(key,d); }
  const cutoff=Date.now()-3*864e5; out._del=[...dm.values()].filter(d=>d.u>cutoff);
  for(const k of CALC_KINDS){ const m=new Map(); for(const e of r[k]||[]) m.set(e.id,e);
    for(const e of l[k]||[]){ const cur=m.get(e.id); if(!cur||(e.u||0)>=(cur.u||0)) m.set(e.id,e); }
    out[k]=[...m.values()].filter(e=>{ const d=dm.get(k+'|'+e.id); return !d||d.u<(e.u||0); }); }
  out.lots.sort((a,b)=>(+a.lot||0)-(+b.lot||0)); out.bidders.sort((a,b)=>(+a.num||0)-(+b.num||0));
  const win=(l._su||0)>=(r._su||0)?l:r; CALC_SET.forEach(k=>{ const v=win[k]!==undefined?win[k]:(win===l?r[k]:l[k]); if(v!==undefined) out[k]=v; }); out._su=Math.max(l._su||0,r._su||0);
  out.people=l.people||r.people; out.name=l.name||r.name;
  return out;
}
/* one save round-trip: merge with the latest copy and write it only if nobody saved in between */
async function calcSyncOnce(get,put,local){
  for(let n=0;n<4;n++){
    const rem=await get(); const merged=calcMerge(rem.doc,local);
    if(calcStable(merged)===calcStable(rem.doc)) return {doc:rem.doc,version:rem.version,wrote:false};
    try{ const v=await put(merged,rem.version); return {doc:merged,version:v,wrote:true}; }
    catch(e){ if(!/conflict/i.test(e.message||'')) throw e; }
  }
  throw new Error('Too many people saving at once — try again');
}

/* ---------- captains, buyers and shares ----------
   Each team has a captain: the player with the lower Handicap Index (plus handicaps are lower).
   The captain is the buyer of the team's own share — 100% of a pre-bought team, or the team's
   buy-in share (e.g. 25%) of a team that goes to auction — and is paid that share. Buyers don't
   need bidder numbers; if a captain later takes a paddle, everything they own joins that number. */
const nameKey=n=>String(n||'').toLowerCase().replace(/[^a-z\s]/g,' ').split(/\s+/).filter(Boolean).sort().join(' ');
const capIdx=l=>l.cap===1?1:0;
const captainName=l=>[l.p1,l.p2][capIdx(l)]||l.p1||'';
const captainMember=l=>[l.m1,l.m2][capIdx(l)]||'';
function captainBidder(c,l){ const m=captainMember(l), k=nameKey(captainName(l));
  return (m&&c.bidders.find(b=>b.memberId===m))||c.bidders.find(b=>nameKey(b.name)===k)||null; }
/* every share of every team, and who holds it */
function calcStakes(c){
  const bi=buyInOf(c), teamPct=bi.on?c0(bi.pct):0, out=[], pl=poolLot(c);
  const cap=l=>{ const b=captainBidder(c,l); return b?{key:'b:'+b.id,bidderId:b.id,num:b.num,name:b.name,captainOf:l.id}:{key:'m:'+(captainMember(l)||nameKey(captainName(l))),memberId:captainMember(l),name:captainName(l),captainOf:l.id}; };
  const bid=b=>({key:'b:'+b.id,bidderId:b.id,num:b.num,name:b.name});
  for(const l of c.lots){
    if(l.prebuy){ out.push({lot:l,pct:100,kind:'prebuy',owner:cap(l)}); continue; }
    let buyer=null;
    if(l.pooled&&!l.prebuy){ const pb=pl&&pl.price>0?bidderById(c,c.pool.bidderId):null; if(pb) buyer={owner:bid(pb),kind:'pool'}; }
    else if(c0(l.price)>0){ const b=bidderById(c,l.bidderId); if(b) buyer={owner:bid(b),kind:'auction'}; }
    if(buyer) out.push({lot:l,pct:100-teamPct,kind:buyer.kind,owner:buyer.owner});
    if(teamPct>0) out.push({lot:l,pct:teamPct,kind:'team',owner:cap(l)});
  }
  return out;
}
function calcHoldings(c){
  const m=new Map();
  for(const s of calcStakes(c)){ const k=s.owner.key; if(!m.has(k)) m.set(k,{...s.owner,stakes:[]}); const h=m.get(k); h.stakes.push(s); if(s.owner.num&&!h.num){ h.num=s.owner.num; h.bidderId=s.owner.bidderId; } }
  return [...m.values()].sort((a,b)=>(a.num?0:1)-(b.num?0:1)||(+a.num||0)-(+b.num||0)||a.name.localeCompare(b.name));
}
const STAKE_LABEL={prebuy:'pre-bought, own team',team:'own team',auction:'bought',pool:'in the pool'};

