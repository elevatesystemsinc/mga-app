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


// ---------- formats ----------
const ev=(o,players,extraGroups)=>Object.assign({courses:{t:course},groups:[{id:'g',course:'t',startHole:1,players}].concat(extraGroups||[]),scoring:'net',format:'stroke'},o);
const R=x=>Math.sign(x)*Math.floor(Math.abs(x)+0.5);
const PC=(id,ch,team)=>({id,name:id,set:'M',ch,ph:null,team:team||''});
// allowances & playing handicaps
check('USGA defaults by key',[pctFor({},'stroke'),pctFor({},'bestball1of2'),pctFor({},'bestball2of4'),pctFor({},'bestball3of4'),pctFor({},'bestball1of5'),pctFor({},'bestball4of6'),pctFor({},'match4'),JSON.stringify(pctFor({},'scramble5'))].join()==='95,85,85,100,75,100,90,[20,15,10,5,5]');
check('allow key follows team size and count',[allowKey({format:'bestball',teamSize:4,count:2},'bestball'),allowKey({format:'scramble',teamSize:3},'scramble'),allowKey({format:'match',teamSize:2},'match'),allowKey({format:'stroke'},'stroke')].join()==='bestball2of4,scramble3,match4,stroke');
check('older events: allow.bestball still applies to best 1 of 2',pctFor({format:'bestball',allow:{bestball:80}},'bestball1of2')===80);
check('scramble team PH 4/9/15/22 at 25/20/15/10 = 7',teamPH({format:'scramble',teamSize:4},'scramble',[PC('a',4),PC('b',9),PC('c',15),PC('d',22)])===7);
check('scramble 5-player club default',teamPH({format:'scramble',teamSize:5},'scramble',[PC('a',4),PC('b',9),PC('c',15),PC('d',22),PC('e',30)])===R(4*.2+9*.15+15*.1+22*.05+30*.05));
check('foursomes 8+14 → 11; greensome 60/40 → 10',teamPH({},'foursomes',[PC('a',8),PC('b',14)])===11&&teamPH({},'greensome',[PC('a',14),PC('b',8)])===10);
check('segPH: four-ball 85% of CH 20 = 17; stroke 95% of 6 = 6',segPH({format:'bestball',teamSize:2,count:1},PC('a',20),'bestball')===17&&segPH({format:'stroke'},PC('a',6),'stroke')===6);
// stableford / modified / quota / par-bogey
const net1=p=>Object.assign({},p,{ph:p.ch});   // play with PH = CH for simplicity
const scA={A:fill(4)}; scA.A[1]=3; scA.A[2]=2; scA.A[3]=5; scA.A[4]=7;   // birdie, eagle, bogey, triple on stroke indexes 1-4
let lb=leaderboard(ev({format:'stableford',scoring:'gross'},[net1(PC('A',0))]),scA,{});
check('stableford gross: 14 pars·2 + birdie 3 + eagle 4 + bogey 1 + 0 = 36',lb[0].pts===36&&lb[0].unit==='points',lb[0].pts);
lb=leaderboard(ev({format:'stableford'},[net1(PC('A',2))]),scA,{});
check('stableford net with 2 strokes (holes 1–2): 3→2 = 4 pts, 2→1 = 5 pts → 38',lb[0].pts===38,lb[0].pts);
lb=leaderboard(ev({format:'modstable',scoring:'gross'},[net1(PC('A',0))]),scA,{});
check('modified stableford: pars 0, birdie 2, eagle 5, bogey −1, triple −3 = 3',lb[0].pts===3,lb[0].pts);
lb=leaderboard(ev({format:'quota'},[net1(PC('A',10))]),scA,{});
check('quota: points 28+4+8+1+0 = 41 vs quota 26 → +15',lb[0].pts===15,lb[0].pts);
lb=leaderboard(ev({format:'parbogey'},[net1(PC('A',0))]),scA,{});
check('par/bogey: 2 holes won, 2 lost, 14 halved → 0; ranked by holes',lb[0].holesUp===0&&lb[0].unit==='holes');
lb=leaderboard(ev({format:'stableford'},[net1(PC('A',0)),net1(PC('B',0))]),{A:fill(4),B:Object.assign(fill(4),{1:3})},{});
check('points rank descending: B (37) ahead of A (36)',lb[0].id==='B'&&lb[1].id==='A'&&lb[0].posTxt==='1');
// best ball 2 of 4, aggregate, 1-2-3
const four=[PC('a',0,'T'),PC('b',0,'T'),PC('c',0,'T'),PC('d',0,'T')].map(net1);
const sc4={a:fill(4),b:fill(5),c:fill(3),d:fill(6)};
let tb=teamBoard(ev({format:'bestball',teamSize:4,count:2,scoring:'gross'},four),sc4,{sort:'gross'});
check('best 2 of 4: 3+4 per hole → 126, to par −18',tb[0].gross===126&&tb[0].toPar===-18,tb[0]);
tb=teamBoard(ev({format:'aggregate',teamSize:4,scoring:'gross'},four),sc4,{sort:'gross'});
check('aggregate: 18 per hole → 324',tb[0].gross===324);
tb=teamBoard(ev({format:'bestball',teamSize:4,countPattern:'123',scoring:'gross'},four),sc4,{sort:'gross'});
check('1-2-3: 6×3 + 6×7 + 6×12 = 132',tb[0].gross===132,tb[0].gross);
tb=teamBoard(ev({format:'teamstable',teamSize:4,count:2,scoring:'gross'},four),sc4,{sort:'gross'});
check('team stableford best 2 of 4: (3 + 2) × 18 = 90 points',tb[0].pts===90&&tb[0].unit==='points',tb[0].pts);
// scramble / foursomes: one score per team, team strokes
const two=[Object.assign(PC('a',8,'T'),{ph:null}),Object.assign(PC('b',14,'T'),{ph:null})];
tb=teamBoard(ev({format:'foursomes',teamSize:2,scoring:'net'},two),{a:fill(4)},{sort:'net'});
check('foursomes: captain’s 18 × 4 = 72 gross, team PH 11 → net 61',tb[0].gross===72&&tb[0].net===61,tb[0]);
// match play: singles, A (PH 5) v B (PH 12): B gets 7 strokes on indexes 1–7
const mA=Object.assign(PC('A',5,'S1'),{ch:5}), mB=Object.assign(PC('B',12,'S2'),{ch:12});
let scm={A:fill(4),B:fill(4)};
let mb=matchBoard(ev({format:'match',teamSize:1,scoring:'net'},[mA,mB]),scm,{});
let rowB=mb.find(r=>r.id==='S2');
check('singles: B wins holes 1–7 with strokes → 7 up with 11 to play = 7&6... decided: 7 up after 7, 11 left → not yet; after hole 11 B is 7 up with 7 left → dormie; wins 8&7? no—stays 7 up: match ends 7&6 when up > left',rowB.over===true&&rowB.status==='7&6'&&rowB.pts===1,rowB.status);
scm={A:fill(4),B:fill(4)}; for(let h=1;h<=18;h++) scm.A[h]=h%2?3:4;   // A birdies odd holes: wins 11 odd holes... with B's strokes on 1–7 (odd 1,3,5,7 halved) → A wins 9,11,13,15,17 (5), B wins 2,4,6 (3): A 2 up
mb=matchBoard(ev({format:'match',teamSize:1,scoring:'net'},[mA,mB]),scm,{});
check('singles: A closes it out 2&1 (2 up with one to play after 17)',mb.find(r=>r.id==='S1').status==='2&1'&&mb.find(r=>r.id==='S2').status==='lost 2&1'&&mb.find(r=>r.id==='S1').pts===1,mb.map(r=>[r.id,r.status]));
scm={A:fill(4),B:fill(4)}; delete scm.A[13]; delete scm.B[13];
mb=matchBoard(ev({format:'match',teamSize:1,scoring:'net'},[mA,mB]),scm,{});
check('in progress: 7 up thru 12 is decided (7 up, 6 to play → 7&6)',mb.find(r=>r.id==='S2').status==='7&6',mb.find(r=>r.id==='S2').status);
scm={A:fill(4),B:fill(4)}; mb=matchBoard(ev({format:'match',teamSize:1,scoring:'net'},[Object.assign(PC('A',5,'S1'),{ch:5}),Object.assign(PC('B',5,'S2'),{ch:5})]),scm,{});
check('all square after 18 → AS, half a point each',mb.every(r=>r.status==='AS'&&r.pts===0.5));
// four-ball match: sides of two
const fb=[Object.assign(PC('A',4,'X'),{}),Object.assign(PC('B',10,'X'),{}),Object.assign(PC('C',6,'Y'),{}),Object.assign(PC('D',20,'Y'),{})];
scm={A:fill(4),B:fill(5),C:fill(4),D:fill(6)}; scm.A[18]=3;
mb=matchBoard(ev({format:'match',teamSize:2,scoring:'net'},fb),scm,{});
check('four-ball: 90% then off the low man (A 4, B 9, C 5, D 18 → C gets 1, D 14): C’s stroke wins hole 1 for Y, A’s birdie on 18 squares it → AS',mb.every(r=>r.status==='AS'&&r.pts===0.5),mb.map(r=>[r.id,r.status]));
check('format summary text',[formatSummary({format:'bestball',teamSize:4,count:2}),formatSummary({format:'scramble',teamSize:5}),formatSummary({format:'match',teamSize:2}),formatSummary({format:'split',front:'scramble',back:'shamble',teamSize:2,count:1})].join(' | '),null);
check('unitOf / isTeamEvent / isMatchEvent',[unitOf({format:'quota'}),unitOf({format:'parbogey'}),unitOf({format:'match'}),unitOf({format:'teamstable',teamSize:2}),isTeamEvent({format:'split',front:'scramble',back:'shamble'}),isMatchEvent({format:'match'})].join()==='points,holes,match,points,true,true');


// ---------- catalog & new variants ----------
const c4=[PC('a',0,'T'),PC('b',0,'T'),PC('c',0,'T'),PC('d',0,'T')].map(net1), sc4b={a:fill(4),b:fill(5),c:fill(3),d:fill(6)};
tb=teamBoard(ev({format:'bestball',teamSize:4,countPattern:'123rot',scoring:'gross'},c4),sc4b,{sort:'gross'});
check('cha-cha-cha: 6×(3) + 6×(3+4) + 6×(3+4+5) = 18+42+72 = 132',tb[0].gross===132,tb[0].gross);
tb=teamBoard(ev({format:'bestball',teamSize:4,countPattern:'yellow',scoring:'gross'},c4),sc4b,{sort:'gross'});
// yellow rotates a,b,c,d: hole1 a(4)+best other c(3)=7; hole2 b(5)+3=8; hole3 c(3)+a(4)=7; hole4 d(6)+3=9 → 31 per 4 holes; 18 holes = 4 cycles (124) + holes 17,18 = a,b → 7+8
check('yellow ball: designated ball + best of the rest = 139',tb[0].gross===139,tb[0].gross);
const course345={name:'Mixed',par:{M:[3,4,5,4,4,3,5,4,4,4,4,3,5,4,4,3,4,5]},hcp:{M:hcp}};
let pub345={courses:{t:course345},groups:[{id:'g',course:'t',startHole:1,players:c4}],scoring:'gross',format:'bestball',teamSize:4,countPattern:'par345'};
tb=teamBoard(pub345,sc4b,{sort:'gross'});
check('1-2-3 by par: par3s 1 ball (3), par4s 2 balls (7), par5s 3 balls (12)',tb[0].gross===4*3+10*7+4*12,tb[0].gross);
lb=leaderboard(ev({format:'quota',quotaBase:39},[net1(PC('A',10))]),scA,{});
check('Chicago: same points (41) vs quota 29 → +12',lb[0].pts===12,lb[0].pts);
lb=leaderboard(ev({format:'stroke',cap:'nddb',scoring:'gross'},[net1(PC('A',0))]),{A:Object.assign(fill(4),{4:9,5:8})},{});
check('maximum score: 9 and 8 capped at net double bogey (6) → 76',lb[0].gross===76,lb[0].gross);
// post-round draw: partners in different groups still score as a team
let pubX={courses:{t:course},groups:[{id:'g1',course:'t',startHole:1,players:[PC('a',0,'D1'),PC('b',0,'D2')].map(net1)},{id:'g2',course:'t',startHole:1,players:[PC('c',0,'D1'),PC('d',0,'D2')].map(net1)}],scoring:'gross',format:'bestball',teamSize:2,count:1};
tb=teamBoard(pubX,{a:fill(4),b:fill(5),c:fill(3),d:fill(6)},{sort:'gross'});
check('teams across groups: D1 = a+c best 3 → 54; D2 = b+d best 5 → 90',tb.map(r=>r.id+':'+r.gross).join()==='D1:54,D2:90',tb.map(r=>[r.id,r.gross,r.group]));
// nassau: A wins front by 2 (holes 1,2), B wins back by 1 (hole 10), A 18 by 1 → A 2 points, B 1
scm={A:Object.assign(fill(4),{1:3,2:3}),B:Object.assign(fill(4),{10:3})};
mb=matchBoard(ev({format:'match',teamSize:1,matchScoring:'nassau',scoring:'net'},[Object.assign(PC('A',5,'S1'),{ch:5}),Object.assign(PC('B',5,'S2'),{ch:5})]),scm,{});
check('nassau: A takes front and 18 (2 pts), B the back (1 pt)',mb.find(r=>r.id==='S1').pts===2&&mb.find(r=>r.id==='S2').pts===1,mb.map(r=>[r.id,r.status,r.pts]));
// hi-lo: X = A 3s & B 5s; Y = C 4s & D 4s → low: X wins each hole, high: Y wins each hole → AS
mb=matchBoard(ev({format:'match',teamSize:2,matchScoring:'hilo',scoring:'net'},[Object.assign(PC('A',0,'X'),{ch:0}),Object.assign(PC('B',0,'X'),{ch:0}),Object.assign(PC('C',0,'Y'),{ch:0}),Object.assign(PC('D',0,'Y'),{ch:0})]),{A:fill(3),B:fill(5),C:fill(4),D:fill(4)},{});
check('hi-lo: low ball to X, high ball to Y every hole → AS',mb.every(r=>r.status==='AS'&&r.pts===0.5),mb.map(r=>[r.id,r.status]));
// foursomes match: one ball per side, team handicaps 50% combined; sides X (CH 8+14 → 11) and Y (CH 4+6 → 5): X gets 6 strokes
mb=matchBoard(ev({format:'match',teamSize:2,matchForm:'foursomes',scoring:'net'},[Object.assign(PC('A',8,'X'),{ch:8}),Object.assign(PC('B',14,'X'),{ch:14}),Object.assign(PC('C',4,'Y'),{ch:4}),Object.assign(PC('D',6,'Y'),{ch:6})]),{A:fill(4),C:fill(4)},{});
check('foursomes match: X wins holes 1–6 with its 6 strokes → 6&5? no: 6 up after 6, 12 left … after 12 halves, 6 up with 6 left → dormie; ends 6 up at 18? 6 up with 0 left = "6 up"',mb.find(r=>r.id==='X').pts===1&&/6/.test(mb.find(r=>r.id==='X').status),mb.map(r=>[r.id,r.status]));
check('catalog: lookups and summaries',[catalogOf({format:'quota',quotaBase:39}).id,catalogOf({format:'bestball',countPattern:'yellow'}).id,catalogOf({format:'match',teamSize:2,matchScoring:'hilo'}).id,formatSummary({format:'match',matchScoring:'nassau'}),formatSummary({format:'bestball',teamSize:4,countPattern:'123rot'}),gameCatalog().length].join(' | '),null);
check('catalog ids are unique',new Set(gameCatalog().map(g=>g.id)).size===gameCatalog().length);
process.exit(bad?1:0);
