/* ============ poscore — the money on a check, shared by the hub's register and the station page ============
   checkTotals(lines, tip, rates): service charge on lines marked for it, tax on taxable lines (and their service charge),
   the tip on top. A line = {qty, price, taxable, svc}. rates = {tax, svc} in percent. Pure. */
function checkTotals(lines,tip,rates){ const r=rates||{tax:0,svc:0}; let sub=0, svcBase=0, taxBase=0; const n=v=>{ const x=parseFloat(v); return isFinite(x)?x:0; };
  for(const l of lines||[]){ const v=Math.round(n(l.qty)*n(l.price)*100)/100; sub+=v; if(l.svc) svcBase+=v; if(l.taxable) taxBase+=v+(l.svc?v*n(r.svc)/100:0); }
  const svc=Math.round(svcBase*n(r.svc))/100, tax=Math.round(taxBase*n(r.tax))/100, tp=Math.round(n(tip)*100)/100;
  return {subtotal:Math.round(sub*100)/100,svc,tax,tip:tp,total:Math.round((sub+svc+tax+tp)*100)/100}; }
const pcFmt=v=>{ const x=parseFloat(v)||0; return (x<0?'−$':'$')+Math.abs(x).toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2}); };
const checkText=lines=>(lines||[]).map(l=>((parseFloat(l.qty)||1)>1?l.qty+'× ':'')+l.name).join(', ');
/* tables typed as "1-12, Patio 1-4, Bar" → ['1',…,'12','Patio 1',…,'Patio 4','Bar'] */
function parseTables(txt){ const out=[]; String(txt||'').split(/[,\n]+/).map(s=>s.trim()).filter(Boolean).forEach(s=>{ const m=s.match(/^(.*?)\s*(\d+)\s*-\s*(\d+)$/); if(m){ const a=+m[2], b=+m[3]; for(let i=Math.min(a,b); i<=Math.max(a,b); i++) out.push((m[1]?m[1].trim()+' ':'')+i); } else out.push(s); }); return [...new Set(out)]; }
