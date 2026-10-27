/* ============ poscore — the money on a check, shared by the hub's register and the station page ============
   checkTotals(lines, tip, rates): service charge on lines marked for it, tax on taxable lines (and their service charge),
   the tip on top. A line = {qty, price, taxable, svc}. rates = {tax, svc} in percent. Pure. */
const pcFmt=v=>{ const x=parseFloat(v)||0; return (x<0?'−$':'$')+Math.abs(x).toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2}); };
const checkText=lines=>(lines||[]).map(l=>((parseFloat(l.qty)||1)>1?l.qty+'× ':'')+l.name).join(', ');
/* tables typed as "1-12, Patio 1-4, Bar" → ['1',…,'12','Patio 1',…,'Patio 4','Bar'] */
function parseTables(txt){ const out=[]; String(txt||'').split(/[,\n]+/).map(s=>s.trim()).filter(Boolean).forEach(s=>{ const m=s.match(/^(.*?)\s*(\d+)\s*-\s*(\d+)$/); if(m){ const a=+m[2], b=+m[3]; for(let i=Math.min(a,b); i<=Math.max(a,b); i++) out.push((m[1]?m[1].trim()+' ':'')+i); } else out.push(s); }); return [...new Set(out)]; }
/* ---- modifiers, courses, seats, split payments ---- */
/* a product's modifier groups typed one per line: "Temperature*: Rare, Medium, Well"  (* = one must be picked)
   "Add-ons+: Bacon +2, Avocado +1.50"  (+ = several may be picked); an option's price delta follows a +/− */
function parseMods(txt){ const out=[]; String(txt||'').split(/\n+/).map(s=>s.trim()).filter(Boolean).forEach(line=>{ const m=line.match(/^([^:]+?)([*+]{0,2}):\s*(.+)$/); if(!m) return; const flags=m[2]||'';
  const options=m[3].split(',').map(s=>s.trim()).filter(Boolean).map(s=>{ const pm=s.match(/^(.*?)\s*([+\-−]\s*\d+(?:\.\d+)?)$/); const price=pm?parseFloat(pm[2].replace(/[−\s]/g,m2=>m2==='−'?'-':''))||0:0; return {name:pm?pm[1].trim():s,price:Math.round(price*100)/100}; });
  out.push({name:m[1].trim(),required:flags.includes('*'),multi:flags.includes('+'),options}); }); return out; }
const modsText=mods=>(mods||[]).map(g=>`${g.name}${g.required?'*':''}${g.multi?'+':''}: ${(g.options||[]).map(o=>o.name+(o.price?(o.price>0?' +':' −')+Math.abs(o.price):'')).join(', ')}`).join('\n');
const modsLabel=l=>(l.mods||[]).map(m=>m.name).join(', ');
const lineUnit=l=>Math.round(((parseFloat(l.price)||0)+(l.mods||[]).reduce((t,m)=>t+(parseFloat(m.price)||0),0))*100)/100;   // the price on the line already carries its modifiers' deltas? no: price = base, mods add
const lineTotal=l=>Math.round((parseFloat(l.qty)||0)*lineUnit(l)*100)/100;
const COURSES=['With the order','Starters','Mains','Dessert'];
const courseName=c=>COURSES[c]||('Course '+c);
/* checkTotals counts modifiers through lineUnit */
function checkTotals(lines,tip,rates){ const r=rates||{tax:0,svc:0}; let sub=0, svcBase=0, taxBase=0; const n=v=>{ const x=parseFloat(v); return isFinite(x)?x:0; };
  for(const l of lines||[]){ const v=lineTotal(l); sub+=v; if(l.svc) svcBase+=v; if(l.taxable) taxBase+=v+(l.svc?v*n(r.svc)/100:0); }
  const svc=Math.round(svcBase*n(r.svc))/100, tax=Math.round(taxBase*n(r.tax))/100, tp=Math.round(n(tip)*100)/100;
  return {subtotal:Math.round(sub*100)/100,svc,tax,tip:tp,total:Math.round((sub+svc+tax+tp)*100)/100}; }
/* a portion of a check: the lines picked (by seat or by hand), with their share of service and tax — tip is added by the payer */
function portionTotals(lines,rates){ return checkTotals(lines,0,rates); }
const paidSoFar=c=>Math.round((c.payments||[]).reduce((t,p)=>t+(parseFloat(p.amount)||0)-(parseFloat(p.tip)||0),0)*100)/100;   // tips ride on the payments, not on the check
/* what is still owed on a check after the payments so far (tips ride on each payment, not on the check) */
const balanceDue=(c,rates)=>Math.round((checkTotals(c.lines,0,rates).total-paidSoFar(c))*100)/100;
/* shift numbers from closed tickets: by payment type, tips by server, voids, items sold */
function shiftStats(tickets){ const S={sales:0,n:0,tax:0,svc:0,tips:0,by:{account:0,cash:0,card:0},servers:{},voids:0,voidAmt:0,items:{},guests:0};
  for(const t of tickets){ if(t.status==='void'){ S.voids++; S.voidAmt+=parseFloat(t.total)||0; continue; } if(t.status!=='closed') continue; S.n++; S.guests+=parseInt(t.guests)||0; const pays=(t.payments&&t.payments.length)?t.payments:[{method:t.paid||'cash',amount:(parseFloat(t.total)||0)-(parseFloat(t.tip)||0),tip:parseFloat(t.tip)||0}];
    const net=(parseFloat(t.total)||0)-(parseFloat(t.tip)||0); S.sales+=net; S.tax+=parseFloat(t.tax)||0; S.svc+=parseFloat(t.svc)||0; const sv=t.server||'—'; S.servers[sv]=S.servers[sv]||{sales:0,tips:0,n:0}; S.servers[sv].sales+=net; S.servers[sv].n++;
    for(const p of pays){ const tip=parseFloat(p.tip)||0; S.tips+=tip; S.servers[sv].tips+=tip; const k=p.method==='account'?'account':p.method==='card'?'card':'cash'; S.by[k]+=(parseFloat(p.amount)||0)-tip; }
    for(const l of t.lines||[]){ const k=l.name; S.items[k]=S.items[k]||{qty:0,amount:0}; S.items[k].qty+=parseFloat(l.qty)||0; S.items[k].amount+=lineTotal(l); } }
  const r2=v=>Math.round(v*100)/100; ['sales','tax','svc','tips','voidAmt'].forEach(k=>S[k]=r2(S[k])); Object.keys(S.by).forEach(k=>S.by[k]=r2(S.by[k])); Object.values(S.servers).forEach(s=>{ s.sales=r2(s.sales); s.tips=r2(s.tips); }); S.avg=S.n?r2(S.sales/S.n):0; return S; }
