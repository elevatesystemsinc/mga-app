/* ============ billcore — the member statement PDF, shared by the hub and the member portal ============
   statementPage(doc, ctx) draws one statement on the current page. ctx = {club, name, lines:[address lines], s:{period_start,
   period_end, due, opening, charges, payments, closing, issued_at}, items:[{posted, descr, kind, amount, method, reference}],
   msg, crest (PNG data URL or null), idx, n}. bcFonts(doc) registers the brand fonts from PDF_FONTS. Pure: no app globals. */
const BC_NAVY=[15,42,56],BC_GOLD=[199,161,58],BC_GOLDL=[216,183,95],BC_GOLDDK=[126,95,26],BC_IVORY=[251,250,245],BC_INK=[20,34,43],BC_MUTED=[86,98,106],BC_RED=[161,64,43],BC_GREEN=[31,107,74];
const BC_METHOD={card:'Card',check:'Check',ach:'ACH / bank',cash:'Cash',other:'Other'};
const bcFmt=v=>{ const x=parseFloat(v)||0; return (x<0?'−$':'$')+Math.abs(x).toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2}); };
const bcDate=iso=>iso?new Date(String(iso).slice(0,10)+'T12:00').toLocaleDateString('en-US',{month:'short',day:'numeric',year:'numeric'}):'—';
const bcSign=i=>i.kind==='charge'?(parseFloat(i.amount)||0):-(parseFloat(i.amount)||0);
function bcFonts(doc){ [['ps400','PS-400.ttf','PublicSans','normal'],['ps700','PS-700.ttf','PublicSans','bold'],['ps800','PS-800.ttf','PublicSansXB','normal'],['cg700','CG-700.ttf','Cormorant','bold']].forEach(([k,f,fam,st])=>{ doc.addFileToVFS(f,PDF_FONTS[k]); doc.addFont(f,fam,st); }); }
function statementPage(doc,ctx){
  const L=40,R2=572,W=612,H=792, s=ctx.s, font=(f,st,z,col)=>{ doc.setFont(f,st); doc.setFontSize(z); doc.setTextColor(...col); };
  doc.setFillColor(...BC_IVORY); doc.rect(0,0,W,H,'F');
  doc.setFillColor(...BC_GOLD); doc.roundedRect(L,32,R2-L,82,8,8,'F'); doc.setFillColor(...BC_NAVY); doc.roundedRect(L,32,R2-L,78,8,8,'F'); doc.rect(L,32+66,R2-L,8,'F');
  if(ctx.crest) doc.addImage(ctx.crest,'PNG',L+16,42,54*850/1024,54);
  font('PublicSansXB','normal',6.8,BC_GOLDL); doc.text(String(ctx.club||'').toUpperCase(),L+76,56,{charSpace:1.2});
  font('Cormorant','bold',24,[255,255,255]); doc.text('Member statement',L+76,80);
  font('PublicSans','normal',8.4,[214,218,220]); doc.text(`${bcDate(s.period_start)} – ${bcDate(s.period_end)} · due ${bcDate(s.due)}`,L+76,96);
  let y=140; font('PublicSansXB','normal',7.4,BC_GOLDDK); doc.text('ACCOUNT',L,y,{charSpace:1.1}); doc.text('BALANCE DUE',R2,y,{align:'right',charSpace:1.1}); y+=6; doc.setDrawColor(...BC_GOLD); doc.setLineWidth(1); doc.line(L,y,R2,y); y+=16;
  font('PublicSans','bold',12,BC_INK); doc.text(ctx.name||'Member',L,y); font('Cormorant','bold',26,s.closing>0.004?BC_RED:BC_INK); doc.text(bcFmt(Math.max(0,s.closing)),R2,y+4,{align:'right'});
  font('PublicSans','normal',8.6,BC_MUTED); const lines=(ctx.lines||[]).filter(Boolean); lines.forEach((t,i)=>doc.text(t,L,y+14+i*11));
  if(s.closing<-0.004){ font('PublicSans','normal',8.6,BC_GREEN); doc.text(`Credit on account ${bcFmt(-s.closing)} — nothing due`,R2,y+16,{align:'right'}); }
  y+=14+Math.max(lines.length,2)*11+18;
  font('PublicSansXB','normal',7.4,BC_GOLDDK); doc.text('THIS PERIOD',L,y,{charSpace:1.1}); y+=6; doc.line(L,y,R2,y); y+=12;
  const col=(txt,x,al)=>doc.text(txt,x,y,{align:al||'left'}); font('PublicSans','bold',7.6,BC_MUTED); col('DATE',L); col('DESCRIPTION',L+64); col('CHARGES',R2-110,'right'); col('PAYMENTS',R2-36,'right'); col('BALANCE',R2,'right'); y+=10;
  const row=(d,t,c,pm,b,bold)=>{ if(y>H-120){ doc.addPage(); doc.setFillColor(...BC_IVORY); doc.rect(0,0,W,H,'F'); y=60; } font('PublicSans',bold?'bold':'normal',9,BC_INK); doc.text(d,L,y); doc.text(doc.splitTextToSize(t,R2-150-(L+64))[0]||'',L+64,y); doc.text(c,R2-110,y,{align:'right'}); doc.text(pm,R2-36,y,{align:'right'}); font('PublicSans','bold',9,BC_INK); doc.text(b,R2,y,{align:'right'}); y+=14; };
  let run=parseFloat(s.opening)||0; row('','Balance forward','','',bcFmt(run),true);
  (ctx.items||[]).forEach(i=>{ run=Math.round((run+bcSign(i))*100)/100; row(new Date(String(i.posted).slice(0,10)+'T12:00').toLocaleDateString('en-US',{month:'short',day:'numeric'}),`${i.descr||''}${i.kind==='payment'&&i.method?' · '+(BC_METHOD[i.method]||i.method)+(i.reference?' '+i.reference:''):''}`,i.kind==='charge'?bcFmt(i.amount):'',i.kind!=='charge'?bcFmt(i.amount):'',bcFmt(run)); });
  y+=4; doc.setDrawColor(...BC_GOLD); doc.line(L,y,R2,y); y+=14; font('PublicSans','bold',9.5,BC_INK); doc.text(`Charges ${bcFmt(s.charges)} · Payments & credits ${bcFmt(s.payments)}`,L,y); doc.text(`Closing balance ${bcFmt(s.closing)}`,R2,y,{align:'right'}); y+=24;
  if(ctx.msg){ font('PublicSans','normal',8.6,BC_MUTED); doc.splitTextToSize(ctx.msg,R2-L).forEach(t=>{ doc.text(t,L,y); y+=11; }); }
  font('PublicSans','normal',7,BC_MUTED); doc.text(`${ctx.club||''} · statement issued ${bcDate(s.issued_at)} · page ${(ctx.idx||0)+1} of ${ctx.n||1}`,W/2,H-28,{align:'center'});
}
