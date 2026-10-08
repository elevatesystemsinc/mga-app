// Pure scoring-engine checks (run by tests/test_formats.py through node): skins rules.
const fs=require('fs'); eval(fs.readFileSync(__dirname+'/../src/golfcore.js','utf8'));
let bad=0; const check=(name,cond,info)=>{ console.log((cond?'OK   ':'FAIL ')+name,info!==undefined?JSON.stringify(info):''); if(!cond) bad++; };
const par=Array(18).fill(4), hcp=Array.from({length:18},(_,i)=>i+1);   // hole 1 is the hardest
const course={name:'Test',par:{M:par},hcp:{M:hcp}};
const P=(id,ph)=>({id,name:id,set:'M',ph});
const pub=(players,startHole=1)=>({courses:{t:course},groups:[{id:'g',course:'t',startHole,players}]});
const S=(obj)=>obj;   // scores: {pid:{hole:strokes}}
const fill=(v)=>Object.fromEntries(Array.from({length:18},(_,i)=>[i+1,v]));

// 1. gross skins with carry: A birdies 2 (after a tied hole 1) → 2 skins; all other holes tie
let sc={A:Object.assign(fill(4),{2:3}),B:fill(4)};
let r=skinsResult(pub([P('A',0),P('B',0)]),sc,{net:false,carry:true,validate:'none'});
check('gross skins carry: A wins 2 on hole 2',r.wins.map(w=>[w.hole,w.pid,w.count,w.status])[0]+''=='2,A,2,won'&&r.total===2&&r.carried===16,r);
// 2. no carry: same, 1 skin
r=skinsResult(pub([P('A',0),P('B',0)]),sc,{net:false,carry:false,validate:'none'});
check('no carry-overs: 1 skin, nothing carried',r.total===1&&r.carried===0);
// 3. net skins: B gets a stroke on hole 1 (ph 1) → B net 3 vs A gross 4 → B wins hole 1; hole 2 A gross 3 vs B net 4 → A
sc={A:Object.assign(fill(4),{2:3}),B:fill(4)};
r=skinsResult(pub([P('A',0),P('B',1)]),sc,{net:false,carry:true,validate:'none'});
check('gross: strokes ignored',r.wins.length===1&&r.wins[0].pid==='A');
r=skinsResult(pub([P('A',0),P('B',1)]),sc,{net:true,carry:true,validate:'none'});
check('net: B takes hole 1 with a stroke, A takes hole 2',r.wins.map(w=>w.hole+w.pid).join()==='1B,2A');
// 4. gross beats net: hole 1 A gross 3 vs B net 3 (4 with a stroke) → tie on net; with the rule A wins
sc={A:Object.assign(fill(4),{1:3}),B:fill(4)};
let r1=skinsResult(pub([P('A',0),P('B',1)]),sc,{net:true,carry:true,validate:'none'});
let r2=skinsResult(pub([P('A',0),P('B',1)]),sc,{net:true,grossBeatsNet:true,carry:true,validate:'none'});
check('net tie without the rule: no skin (carried)',r1.wins.length===0&&r1.carried===18);
check('gross beats net: A wins hole 1',r2.wins.length===1&&r2.wins[0].pid==='A'&&r2.wins[0].count===1);
// 5. validation (gross par on the next hole): A birdies 5, bogeys 6 → void, carried into the pool; A birdies 9, pars 10 → stands with the carry
sc={A:Object.assign(fill(4),{5:3,6:5,9:3}),B:Object.assign(fill(4),{6:5})};   // hole 6 is a tie of bogeys, so it carries
r=skinsResult(pub([P('A',0),P('B',0)]),sc,{net:false,carry:true,validate:'gross'});
check('validation: hole 5 void (bogey on 6), hole 9 stands with everything carried',r.wins.map(w=>[w.hole,w.status,w.count]).join('|')==='5,void,5|9,won,9'&&r.total===9&&r.lost===0,r.wins);
r=skinsResult(pub([P('A',0),P('B',0)]),sc,{net:false,carry:false,validate:'gross'});
check('validation without carry: the void skin is lost',r.total===1&&r.lost===1);
// 6. net validation: B (stroke on hole 1 only) wins hole 18? no — B wins hole 1 net, then bogeys 2 but gets no stroke there → void under net; under gross also void
sc={A:fill(4),B:Object.assign(fill(4),{1:4,2:5})}; // hole 1: A 4, B net 3 → B; hole 2: B 5 (net 5) → void
r=skinsResult(pub([P('A',0),P('B',1)]),sc,{net:true,carry:true,validate:'net'});
check('net validation: B’s hole-1 skin is void after a net bogey on 2',r.wins[0].status==='void');
sc={A:fill(4),B:Object.assign(fill(4),{1:4,2:5})};
r=skinsResult(pub([P('A',0),P('B',2)]),sc,{net:true,carry:true,validate:'net'});
check('net validation passes when the stroke on the next hole makes it net par',r.wins[0].status==='won'&&r.wins[0].hole===1,r.wins[0]);
// 7. pending: next hole not scored yet; last hole needs no validation; shotgun start uses play order
sc={A:Object.assign({},fill(4),{3:3}),B:fill(4)}; delete sc.A[4]; delete sc.B[4];
r=skinsResult(pub([P('A',0),P('B',0)]),sc,{net:false,carry:false,validate:'gross'});
check('pending until the next hole is in',r.wins[0].status==='pending'&&r.pending===1&&r.total===0);
sc={A:Object.assign(fill(4),{18:3}),B:fill(4)};
r=skinsResult(pub([P('A',0),P('B',0)]),sc,{net:false,carry:false,validate:'gross'});
check('a skin on the 18th stands without validation',r.wins[0].status==='won');
sc={A:Object.assign(fill(4),{18:3,1:5}),B:Object.assign(fill(4),{1:5})};
r=skinsResult(pub([P('A',0),P('B',0)],10),sc,{net:false,carry:false,validate:'gross'});   // starts on 10: after 18 comes 1
const w18=r.wins.find(w=>w.hole===18);
check('shotgun start: the next hole after 18 is hole 1, where A bogeyed → void',w18&&w18.status==='void'&&w18.checkHole===1,r.wins);
process.exit(bad?1:0);
