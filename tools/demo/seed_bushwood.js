/* Bushwood Country Club — demo tenant seed. Runs inside the hub (local mode, ?org=club) and uses the app's own
   functions so every document has the shape the app expects. Returns everything the SQL loader needs. */
(async()=>{
  // ---- silence the app's side effects
  persist=()=>{}; render=()=>{}; toast=()=>{}; publishEvent=async()=>{}; openDrawer=o=>{ if(o&&o.save) o.save(); }; window.confirm=()=>true;
  // ---- deterministic randomness
  let S=20261110; const R=()=>{ S|=0; S=S+0x6D2B79F5|0; let t=Math.imul(S^S>>>15,1|S); t=t+Math.imul(t^t>>>7,61|t)^t; return ((t^t>>>14)>>>0)/4294967296; };
  const pick=a=>a[Math.floor(R()*a.length)], rint=(a,b)=>a+Math.floor(R()*(b-a+1)), chance=p=>R()<p, r2=v=>Math.round(v*100)/100;
  const shuffle=a=>{ a=a.slice(); for(let i=a.length-1;i>0;i--){ const j=Math.floor(R()*(i+1)); [a[i],a[j]]=[a[j],a[i]]; } return a; };
  const TODAY='2026-11-10', TENANT_SLUG='bushwood', STAFF_EMAIL='demo@bushwoodcc.com';
  const addD=(d,n)=>{ const x=new Date(d+'T12:00:00Z'); x.setUTCDate(x.getUTCDate()+n); return x.toISOString().slice(0,10); };
  const dow=d=>new Date(d+'T12:00:00Z').getUTCDay();   // 0 Sun … 6 Sat
  const ts=(d,hm)=>new Date(d+'T'+(hm||'12:00')+':00-06:00').toISOString();
  const hm=(h,m)=>String(h).padStart(2,'0')+':'+String(m).padStart(2,'0');
  const daysBetween=(a,b)=>{ const out=[]; for(let d=a; d<=b; d=addD(d,1)) out.push(d); return out; };
  const ymOf=d=>d.slice(0,7); const monthsBetween=(a,b)=>{ const out=[]; let ym=a; while(ym<=b){ out.push(ym); ym=ymAdd(ym,1); } return out; };
  const uuid=()=>crypto.randomUUID();
  const OUT={};

  // ================= courses =================
  const yardsFor=(pars,scale)=>pars.map(p=>Math.round((p===3?rint(140,215):p===4?rint(335,455):rint(495,565))*scale));
  const mkCourse=(id,name,parM,hcpM,ratings)=>{ const base=yardsFor(parM,1); const tees=ratings.map(([tn,cr,sl,wcr,wsl,sc])=>({name:tn,rating:{M:{cr,slope:sl},W:{cr:wcr,slope:wsl}},yards:base.map(y=>Math.round(y*sc))}));
    return {id,name,par:{M:parM,W:parM.map((p,i)=>i===8&&p===4?5:p)},hcp:{M:hcpM,W:hcpM.slice().reverse().map((_,i)=>hcpM[(i*7)%18]).map((v,i,a)=>a.indexOf(v)===i?v:0).map((v,i,a)=>v||([...Array(19).keys()].slice(1).find(n=>!a.includes(n))))},tees}; };
  const BUSHWOOD=[
    mkCourse('bushwood','Bushwood Course',[4,5,4,3,4,4,3,5,4, 4,4,3,5,4,4,3,4,5],[7,3,11,17,1,9,15,13,5, 8,2,16,12,4,10,18,6,14],
      [['Black',74.3,139,80.9,150,1],['Blue',72.0,133,78.4,144,.955],['White',69.9,128,75.6,137,.905],['Gold',67.6,122,72.9,131,.845],['Red',65.2,117,70.3,124,.78]]),
    mkCourse('glen','The Glen',[4,4,3,5,4,3,4,4,5, 4,3,4,4,5,3,4,4,4],[5,9,17,3,1,15,11,7,13, 6,16,2,10,8,18,4,12,14],
      [['Blue',70.4,129,76.8,139,1],['White',68.6,124,74.5,133,.94],['Gold',66.5,118,71.9,127,.87],['Red',64.1,113,69.0,120,.8]])];
  BUSHWOOD.forEach(c=>{ c.hcp.W=c.hcp.M.slice(); });   // one allocation for both cards
  const freshGolf=()=>({courses:JSON.parse(JSON.stringify(BUSHWOOD)),events:[],localScores:{},ratingsVersion:RATINGS_VERSION});

  // ================= the club document =================
  CLUB.name='Bushwood Country Club'; CLUB.short='Bushwood'; CLUB.kind='club'; CLUB.members=[]; CLUB.orgs=[]; CLUB.tournaments=[]; CLUB.golf=freshGolf(); CLUB.activeSeason='2026'; CLUB.seasons={}; CLUB.board=[]; CLUB.surveys=[]; CLUB.games={disabled:{}};
  delete CLUB.migratedAt; delete CLUB.rosterFile; delete CLUB.rosterImportedAt; CLUB.memberships=[];
  normalize(CLUB,{id:'club',kind:'club',name:CLUB.name,short:CLUB.short});
  // the crest: a simple green-and-gold roundel drawn on a canvas
  const logo=(()=>{ const cv=document.createElement('canvas'); cv.width=cv.height=480; const x=cv.getContext('2d');
    x.fillStyle='#1F4D2E'; x.beginPath(); x.arc(240,240,232,0,Math.PI*2); x.fill(); x.lineWidth=14; x.strokeStyle='#C7A13A'; x.beginPath(); x.arc(240,240,214,0,Math.PI*2); x.stroke();
    x.fillStyle='#FBFAF5'; x.font='bold 54px Georgia'; x.textAlign='center'; x.fillText('BUSHWOOD',240,150); x.font='22px Georgia'; x.fillStyle='#C7A13A'; x.fillText('COUNTRY CLUB · EST. 1927',240,186);
    x.strokeStyle='#FBFAF5'; x.lineWidth=8; x.beginPath(); x.moveTo(240,220); x.lineTo(240,370); x.stroke(); x.fillStyle='#C7A13A'; x.beginPath(); x.moveTo(246,222); x.lineTo(330,250); x.lineTo(246,282); x.fill();
    x.fillStyle='#FBFAF5'; x.beginPath(); x.ellipse(240,380,60,14,0,0,Math.PI*2); x.fill(); x.fillStyle='#1F4D2E'; x.beginPath(); x.ellipse(240,378,22,6,0,0,Math.PI*2); x.fill();
    return {logo:cv.toDataURL('image/png'),w:480,h:480,at:ts('2026-04-15','10:00')}; })();
  CLUB.brand=logo;

  // ---- people
  const CAST=[
    ['Elihu','Smails','M','14.2','full',{board:'President',org:'mga',no:'1001',since:'1998-03-01'}],
    ['Ty','Webb','M','+2.1','full',{board:'Tournament Chair',org:'mga',no:'1012',since:'2004-06-01'}],
    ['Al','Czervik','M','18.6','full',{board:'Member at Large',org:'mga',no:'1455',since:'2019-05-01',group:true}],
    ['Danny','Noonan','M','4.8','junior',{no:'1602',since:'2024-01-01',group:true}],
    ['Lacey','Underall','F','12.4','full',{board:'President',org:'lga',no:'1480',since:'2021-04-01'}],
    ['Fred','Pickering','M','9.7','full',{board:'Vice President',org:'mga',no:'1030',since:'2001-05-01'}],
    ['Walter','Beeper','M','8.9','full',{board:'Treasurer',org:'mga',no:'1041',since:'2003-09-01'}],
    ['Spalding','Smails','M','22.0','junior',{no:'1603',since:'2025-06-01'}],
    ['Chuck','Schick','M','6.3','full',{board:'Secretary',org:'mga',no:'1120',since:'2010-02-01',group:true}],
    ['Drew','Scott','M','11.0','full',{no:'1133',since:'2011-07-01',group:true}],
    ['Jimmy','Wang','M','15.5','full',{no:'1456',since:'2019-05-01',group:true}],
    ['Judith','Smails','F','24.0','full',{board:'Treasurer',org:'lga',no:'1002',since:'1998-03-01'}],
    ['Gloria','Havercamp','F','30.1','senior',{board:'Member at Large',org:'lga',no:'1003',since:'1996-04-01'}],
    ['Harold','Havercamp','M','27.4','senior',{no:'1004',since:'1996-04-01'}],
    ['Maggie','Shaughnessy','F','16.8','full',{board:'Vice President',org:'lga',no:'1210',since:'2014-05-01'}],
    ['Carla','Gatsby','F','20.3','social',{board:'Secretary',org:'lga',no:'1311',since:'2016-08-01'}],
  ];
  const FIRST_M=['James','Michael','Robert','David','William','Richard','Thomas','Mark','Steven','Paul','Kevin','Brian','George','Edward','Ronald','Timothy','Jason','Jeffrey','Ryan','Gary','Nicholas','Eric','Jonathan','Stephen','Scott','Brandon','Frank','Patrick','Raymond','Jack','Dennis','Jerry','Tyler','Aaron','Henry','Douglas','Peter','Adam','Nathan','Zachary','Walter','Kyle','Harold','Carl','Arthur','Lawrence','Dylan','Bruce','Russell','Wayne'];
  const FIRST_F=['Mary','Patricia','Jennifer','Linda','Elizabeth','Barbara','Susan','Jessica','Karen','Lisa','Nancy','Sandra','Ashley','Emily','Donna','Michelle','Carol','Amanda','Melissa','Deborah','Rebecca','Sharon','Laura','Cynthia','Kathleen','Amy','Angela','Shirley','Anna','Brenda','Pamela','Nicole','Samantha','Katherine','Christine','Helen','Debra','Rachel','Carolyn','Janet','Catherine','Maria','Heather','Diane','Ruth','Julie','Olivia','Joyce','Virginia','Victoria'];
  const LAST=['Anderson','Baxter','Caldwell','Delaney','Ellison','Fairbanks','Gallagher','Hutchins','Ingram','Jamison','Kowalski','Lindqvist','Marchetti','Nakamura','Oakes','Pemberton','Quigley','Rasmussen','Sutherland','Thornton','Underhill','Vandermeer','Whitaker','Yarbrough','Zimmerman','Abernathy','Billingsley','Covington','Dunleavy','Everhart','Fitzgerald','Goldsmith','Hollister','Iverson','Jennings','Kirkpatrick','Lockhart','McAllister','Northrup','Ostrowski','Prescott','Reinholt','Sinclair','Tolliver','Ulrich','Vanderbilt','Wentworth','Yates','Abbott','Brennan','Castellano','Donovan','Eberhardt','Fontaine','Gregorian','Halvorsen','Isley','Kaplan','Lombardi','Montgomery','Nevins','O\'Rourke','Pruitt','Rutherford','Stanfield','Tremaine','Van Buren','Westbrook','Ziegler'];
  const STREETS=['Fairway Lane','Clubhouse Drive','Gopher Hill Road','Spruce Court','Lakeside Terrace','Old Mill Road','Bunker Way','Country Club Lane','Hawthorne Avenue','Ridge Road','Willow Creek Drive','Pine Valley Court'];
  const persons=[]; const usedNames=new Set();
  const mkPerson=(first,last,sex,hcp,cls,o)=>{ o=o||{}; const id=uuid(); const email=(first+'.'+last).toLowerCase().replace(/[^a-z.]/g,'')+'@example.com';
    const p={id,first,last,email,phone:'312-555-'+String(rint(100,999)).padStart(3,'0')+String(rint(0,9)),hcp,hcpAt:new Date('2026-11-0'+rint(1,9)).getTime(),ghin:String(rint(1000000,9999999)),memberNo:o.no||String(1700+persons.length),ggId:'',address1:rint(1,999)+' '+pick(STREETS),address2:'',city:'Bushwood',state:'IL',zip:'60045',dob:'',source:'roster',status:o.status||'Active',memberType:cls==='social'?'S':cls==='junior'?'J':cls==='senior'?'SR':'R',sex,
      billing:{class:cls,status:o.bstatus||'active',since:o.since||('20'+rint(12,25)+'-'+String(rint(1,12)).padStart(2,'0')+'-01'),until:o.until||''}};
    persons.push(p); usedNames.add(first+' '+last); return p; };
  const cast={}; CAST.forEach(([f,l,s,h,c,o])=>{ cast[f+' '+l]=mkPerson(f,l,s,h,c,o); cast[f+' '+l]._o=o; });
  // generated members: 160 more
  const clsPick=()=>{ const r=R(); return r<.55?'full':r<.75?'social':r<.87?'junior':'senior'; };
  for(let i=0;i<160;i++){ const sex=R()<.64?'M':'F'; let f,l,k=0; do{ f=pick(sex==='M'?FIRST_M:FIRST_F); l=pick(LAST); k++; }while(usedNames.has(f+' '+l)&&k<50); if(usedNames.has(f+' '+l)) continue;
    const cls=clsPick(); const base=sex==='M'?(cls==='junior'?8:14):22; const hcp=Math.max(-1.5,base+(R()+R()+R()-1.5)*14); const hs=hcp<0?'+'+(-hcp).toFixed(1):hcp.toFixed(1);
    const o={}; if(i<4) o.status='Inactive'; else if(i<6){ o.bstatus='loa'; } else if(i<9){ o.bstatus='resigned'; o.until='2026-0'+rint(6,9)+'-30'; }
    mkPerson(f,l,sex,hs,cls,o); }
  CLUB.members=persons;
  const men=persons.filter(p=>p.sex==='M'&&p.status==='Active'), women=persons.filter(p=>p.sex==='F'&&p.status==='Active');
  const pname=p=>p.first+' '+p.last;

  // ---- organizations
  CLUB.orgs=[{id:'mga',kind:'association',name:'Bushwood Men’s Golf Association',short:'MGA',archived:false},{id:'lga',kind:'association',name:'Bushwood Ladies’ Golf Association',short:'LGA',archived:false},{id:'czerviks',kind:'group',name:'Czervik’s Thursday Game',short:'Czervik’s',archived:false}];

  CLUB.board=[['President',cast['Elihu Smails']],['Vice President',cast['Fred Pickering']],['Treasurer',cast['Walter Beeper']],['Secretary',cast['Judith Smails']],['Golf Chair',cast['Ty Webb']],['House Chair',cast['Maggie Shaughnessy']],['Membership Chair',cast['Lacey Underall']],['Governor',cast['Al Czervik']]].map(([role,p])=>({id:uuid(),role,term:'2026',memberId:p.id}));
  // ---- staff
  const STAFF=[['Carl','Spackler','attendant',['golf'],[],'1927',''],['Lou','Loomis','manager',['golf'],['proshop'],'4411','lloomis@bushwoodcc.com'],['Tony','D’Annunzio','attendant',['golf'],[],'7711',''],['Sandy','McFiddish','manager',['golf'],[],'2201','smcfiddish@bushwoodcc.com'],['Smoke','Porterhouse','attendant',['golf'],[],'3344',''],
    ['Maggie','O’Hooligan','server',['fnb'],[],'1010',''],['Dana','Whitfield','server',['fnb'],['grill'],'2020',''],['Kyle','Brennan','server',['fnb'],['grill'],'3030',''],['Priya','Natarajan','server',['fnb'],['turn','grill'],'4040',''],['Marcus','Bell','bartender',['fnb'],['grill'],'5050',''],['Renee','Alvarez','manager',['fnb'],[],'6060','ralvarez@bushwoodcc.com'],
    ['Jack','Hartigan','pro',['golf'],['proshop'],'8181','jhartigan@bushwoodcc.com'],['Elena','Rossi','pro',['racket'],['racket'],'9191','erossi@bushwoodcc.com'],['Owen','Marsh','attendant',['racket'],['racket'],'1212',''],['Noah','Kim','lifeguard',['aquatics'],[],'1313',''],['Sophie','Grant','lifeguard',['aquatics'],[],'1414',''],['Hannah','Lee','manager',[],[],'0007',STAFF_EMAIL]];
  const staff=[]; for(const [f,l,role,depts,outlets,pin,email] of STAFF){ staff.push({id:uuid(),name:f+' '+l,role,depts,outlets,pin:await pinHash(pin),email,active:true}); }
  CLUB.staff=staff; const staffByName=n=>staff.find(s=>s.name===n);

  // ---- point of sale
  const expoIds={kitchen:uuid(),grill:uuid(),bar:uuid()}, turnGrill=uuid();
  CLUB.pos={outlets:[
      {id:'grill',name:'The Grill Room',kind:'fnb',item:'fnb',dept:'fnb',expos:[{id:expoIds.kitchen,name:'Kitchen'},{id:expoIds.grill,name:'Grill'},{id:expoIds.bar,name:'Bar'}],tables:parseTables('1-16, Patio 1-8, Bar'),menus:[{id:uuid(),name:'All day',active:true},{id:uuid(),name:'Sunday brunch',active:true}]},
      {id:'turn',name:'The Turn',kind:'fnb',item:'fnb',dept:'fnb',expos:[{id:turnGrill,name:'Grill'}],tables:[],menus:[]},
      {id:'proshop',name:'Golf Shop',kind:'proshop',item:'proshop',dept:'golf',expos:[],tables:[],menus:[]},
      {id:'racket',name:'Racquet Shop',kind:'proshop',item:'proshop',dept:'racket',expos:[],tables:[],menus:[]}],
    products:[],staff:[],tipFlag:{pct:30,amount:50},closeoutTo:'fnb@bushwoodcc.com'};
  const addLib=(lib,outlet,routeOf,filter)=>{ lib.forEach(c=>{ if(filter&&!filter(c)) return; c.items.forEach(it=>{ CLUB.pos.products.push({id:uuid(),outlet,cat:c.cat,name:it[0],price:it[1],sku:'',taxable:c.taxable===false?false:null,svc:c.taxable===false?false:null,track:false,stock:0,active:true,route:routeOf?(c.route?routeOf[c.route]||null:null):null,menus:[],mods:it[2]?parseMods(it[2]):[],course:c.course||0}); }); }); };
  addLib(FNB_LIBRARY,'grill',expoIds); addLib(FNB_LIBRARY,'turn',{kitchen:turnGrill,grill:turnGrill,bar:null},c=>/turn|beer|non-alcoholic|sandwich/i.test(c.cat)); addLib(SHOP_LIBRARY,'proshop',null); addLib(RACKET_LIBRARY,'racket',null);
  const prodsOf=o=>CLUB.pos.products.filter(p=>p.outlet===o);

  // ---- bookings
  CLUB.booking={v2:true,facilities:[
    {id:'tee',name:'Tee sheet',kind:'tee',dept:'golf',units:2,unitNames:['Bushwood','The Glen'],open:'07:00',close:'17:00',slot:10,cap:4,lead:7,members:true,onePerDay:true,fee:null},
    {id:'tennis',name:'Tennis',kind:'court',dept:'racket',units:6,unitNames:[],open:'07:00',close:'21:00',slot:60,cap:4,lead:7,members:true,onePerDay:true,fee:null},
    {id:'pickle',name:'Pickleball',kind:'court',dept:'racket',units:4,unitNames:[],open:'07:00',close:'21:00',slot:60,cap:4,lead:7,members:true,onePerDay:true,fee:null},
    {id:'pool',name:'Pool',kind:'pool',dept:'aquatics',units:1,unitNames:[],open:'09:00',close:'20:00',slot:60,cap:40,lead:3,members:true,onePerDay:false,fee:null},
    {id:'lessons',name:'Golf lessons',kind:'lesson',dept:'golf',units:2,unitNames:['Jack Hartigan','Sandy McFiddish'],open:'08:00',close:'18:00',slot:30,cap:1,lead:14,members:true,onePerDay:true,fee:{item:'lesson',amount:90,per:'booking'}},
    {id:'rlessons',name:'Tennis & pickleball lessons',kind:'lesson',dept:'racket',units:1,unitNames:['Elena Rossi'],open:'08:00',close:'19:00',slot:60,cap:1,lead:14,members:true,onePerDay:true,fee:{item:'lesson',amount:75,per:'booking'}},
    {id:'cabanas',name:'Cabanas',kind:'cabana',dept:'aquatics',units:6,unitNames:[],open:'10:00',close:'18:00',slot:240,cap:8,lead:7,members:true,onePerDay:true,fee:{item:'facility',amount:60,per:'booking'}},
    {id:'slessons',name:'Swim lessons',kind:'lesson',dept:'aquatics',units:1,unitNames:['Noah Kim'],open:'09:00',close:'18:00',slot:30,cap:1,lead:14,members:true,onePerDay:true,fee:{item:'lesson',amount:50,per:'booking'}}]};
  bookSettings();

  // ---- billing set-up
  CLUB.billing={}; const B=acctSettings(); B.tax={rate:0}; B.svc={rate:18}; B.finance={pct:1.5,min:25}; B.lateFee={amount:25}; B.dueDays=25; B.message='Thank you — payment is due by the date shown. Questions about your statement: the Bushwood business office, 312-555-0100.';
  const chId={}; const ch=(k,itemId,amount,every,month)=>{ chId[k]=chId[k]||uuid(); return {id:chId[k],itemId,amount,every,month:month||1}; };
  B.classes=[{id:'full',name:'Full Golf',charges:[ch('full-dues','dues',750,'month'),ch('full-cap','capital',85,'month'),ch('full-locker','locker',300,'year',1)],minimum:{amount:300,every:'quarter'}},
    {id:'social',name:'Social',charges:[ch('social-dues','dues',250,'month')],minimum:{amount:150,every:'quarter'}},
    {id:'junior',name:'Junior Executive',charges:[ch('junior-dues','dues',400,'month'),ch('junior-cap','capital',85,'month')],minimum:{amount:300,every:'quarter'}},
    {id:'senior',name:'Senior',charges:[ch('senior-dues','dues',550,'month'),ch('senior-cap','capital',85,'month'),ch('senior-locker','locker',300,'year',1)],minimum:{amount:300,every:'quarter'}}];
  const itemIds=new Set(B.items.map(i=>i.id)); for(const id of ['dues','capital','locker','fnb','min','proshop','lesson','facility','finance','late']) if(!itemIds.has(id)) B.items.push({id,name:id[0].toUpperCase()+id.slice(1),source:id==='fnb'||id==='min'?'fnb':id==='proshop'?'proshop':id==='finance'||id==='late'?'fee':'fee',gl:'4900',taxable:false,svc:false});

  // ---- events, shifts
  CLUB.events=[['Caddy Day at the Pool','aquatics','2026-07-11','','13:00','17:00','Main pool','Caddies and their families: the pool is theirs for the afternoon. Hot dogs and the diving contest at 3.',true],
    ['Fourth of July Fireworks & BBQ','club','2026-07-04','','18:00','22:00','The lawn','Barbecue on the lawn, the band at 7, fireworks over the 18th green at dark.',true],
    ['Member-Member Calcutta & Dinner','fnb','2026-06-13','','18:30','22:00','Grill Room & Patio','Dinner, the auction, and the 50/50 drawing.',false],
    ['Labor Day Pool Party','aquatics','2026-09-07','','12:00','17:00','Main pool','Last big splash of the season.',true],
    ['Oktoberfest on the Patio','fnb','2026-10-17','','17:00','21:00','Patio','Brats, pretzels, a keg from Munich and the oompah trio.',true],
    ['Halloween Family Night','club','2026-10-30','','17:30','20:00','Grill Room','Costume parade at 6, trick-or-treat through the clubhouse.',true],
    ['Turkey Shoot','golf','2026-11-21','','10:00','15:00','Bushwood Course','The MGA’s Thanksgiving tournament — three-man teams, Stableford.',true],
    ['Thanksgiving Buffet','fnb','2026-11-26','','11:00','15:00','Grill Room','Reservations through the Grill Room.',true],
    ['Jingle Mingle Pickleball Social','racket','2026-12-04','','17:00','20:00','Courts 1–4','Round robin and mulled wine.',true],
    ['Holiday Gala','club','2026-12-12','','19:00','23:30','Ballroom','Black tie. Dancing. The Judge’s annual toast.',true],
    ['Yoga on the Lawn','club','2026-11-14','','08:30','09:30','East lawn','Bring a mat. Coffee after at the Turn.',true]
  ].map(([name,dept,date,end,start,finish,where,descr,pub])=>({id:uuid(),name,dept,date,end,start,finish,where,descr,public:pub}));
  const SHIFT_PLAN={fnb:[['Maggie O’Hooligan','10:30','19:00','The Grill Room',[1,2,3,4,5]],['Dana Whitfield','15:00','22:00','The Grill Room',[2,3,4,5,6]],['Kyle Brennan','10:30','18:30','The Grill Room',[0,3,4,5,6]],['Priya Natarajan','07:00','15:00','The Turn',[0,2,3,5,6]],['Marcus Bell','15:00','23:00','Bar',[0,3,4,5,6]],['Renee Alvarez','09:00','18:00','The Grill Room',[1,2,3,4,5]]],
    golf:[['Lou Loomis','07:00','16:00','Golf Shop',[1,2,3,4,5,6]],['Jack Hartigan','08:00','17:00','Golf Shop',[2,3,4,5,6,0]],['Carl Spackler','05:30','14:00','Grounds',[1,2,3,4,5,6]],['Tony D’Annunzio','06:30','15:00','Bag room',[0,3,4,5,6]],['Smoke Porterhouse','06:30','15:00','Bag room',[1,2,5,6,0]],['Sandy McFiddish','06:00','15:00','Grounds',[1,2,3,4,5]]],
    racket:[['Elena Rossi','09:00','18:00','Courts',[1,2,3,4,5,6]],['Owen Marsh','10:00','19:00','Racquet Shop',[0,2,3,5,6]]],aquatics:[['Noah Kim','10:00','18:00','Pool',[3,4,5,6,0]],['Sophie Grant','12:00','20:00','Pool',[1,2,5,6,0]]],club:[['Hannah Lee','08:00','17:00','Clubhouse',[1,2,3,4,5]]]};
  CLUB.shifts=[]; for(const d of daysBetween(addD(TODAY,-14),addD(TODAY,13))){ const wd=dow(d); for(const [dept,rows] of Object.entries(SHIFT_PLAN)) for(const [name,start,end,where,days] of rows){ if(!days.includes(wd)) continue; if(dept==='aquatics'&&d>'2026-09-30'&&!/Noah/.test(name)) continue; const s=staffByName(name); if(!s) continue; CLUB.shifts.push({id:uuid(),staffId:s.id,dept,date:d,start,end,where,note:''}); } }
  const clock=[]; for(const d of daysBetween(addD(TODAY,-44),TODAY)){ const wd=dow(d); for(const [dept,rows] of Object.entries(SHIFT_PLAN)) for(const [name,start,end,where,days] of rows){ if(!days.includes(wd)||dept==='club') continue; if(dept==='aquatics'&&d>'2026-09-30') continue; const s=staffByName(name); if(!s||chance(.08)) continue;
    const [sh,sm]=start.split(':').map(Number), [eh,em]=end.split(':').map(Number); const inAt=ts(d,hm(sh,Math.min(59,Math.max(0,sm+rint(-8,6))))); const open=d===TODAY&&(eh>14); const outAt=open?null:ts(d,hm(Math.min(23,eh),Math.min(59,Math.max(0,em+rint(-10,25)))));
    clock.push({id:uuid(),staff_id:s.id,name:s.name,dept,in_at:inAt,out_at:outAt,station:null,note:''}); } }

  // ---- club year: budget lines and treasury
  const S26=CLUB.seasons['2026']; S26.bankOpening={date:'2026-01-01',amount:184250.33}; S26.dues={amount:0,installments:1};
  const L=(desc,type,budget,actual)=>({id:uuid(),desc,type,budget,actual});
  S26.lines=[L('Membership dues (accounts)','Income',1740000,1512600),L('Capital assessments','Income',165000,143900),L('Food & beverage sales','Income',620000,548300),L('Golf & racquet shop sales','Income',310000,276400),L('Golf operations payroll','Expense',620000,517400),L('Grounds & agronomy','Expense',480000,412900),L('Food & beverage cost of goods','Expense',390000,338200),L('Clubhouse maintenance','Expense',165000,141300),L('Insurance','Expense',96000,96000),L('Utilities','Expense',148000,129800),L('Capital reserve transfer','Expense',240000,200000),L('Initiation fees','Income',310000,262500),L('Guest fees & outings','Income',185000,171900),L('Cart revenue','Income',142000,131600),L('Tennis & pickleball programs','Income',58000,54100),L('Pool & cabanas','Income',41000,43800)];
  const TX=(dir,date,amount,payee,desc,method,memo)=>({id:uuid(),dir,date,amount,payee,desc:desc||payee,link:null,method:method||'ACH / transfer',checkNo:'',memo:memo||''});
  S26.txns=[]; for(const ym of monthsBetween('2026-01','2026-10')){ S26.txns.push(TX('out',ym+'-05',r2(43000+R()*9000),'Payroll — golf operations','Golf operations payroll'),TX('out',ym+'-05',r2(31000+R()*8000),'Payroll — grounds','Grounds & agronomy payroll'),TX('out',ym+'-12',r2(26000+R()*9000),'Sysco Chicago','F&B purchasing','ACH / transfer'),TX('out',ym+'-20',r2(9800+R()*3500),'ComEd / Nicor','Utilities'),TX('in',ym+'-15',r2(10500+R()*6000),'Guest fees','Guest fees & outings','Deposit'),TX('in',ym+'-28',r2(9000+R()*5500),'Cart revenue','Cart revenue','Deposit')); }
  S26.txns.push(TX('in','2026-03-14',45000,'Initiation — Harrington family','Initiation fee','Check'),TX('in','2026-06-02',45000,'Initiation — Vanderbilt','Initiation fee','Check'),TX('out','2026-04-08',96000,'Lakeshore Insurance Group','Annual premium','Check'),TX('out','2026-10-12',18400,'Midwest Turf Services','Fall aerification, both courses','Check'));

  // ---- the club survey
  const Q=(type,text,o)=>Object.assign({id:uuid(),type,text,help:'',options:[],left:'',right:'',comment:false},o||{});
  CLUB.surveys=[{id:uuid(),title:'2026 Member Experience Survey',intro:'Five minutes, anonymous, and it shapes next year’s budget. Thank you.',status:'open',token:newToken(),openedAt:ts('2026-10-20','09:00'),createdAt:ts('2026-10-18','14:00'),anonymous:true,
    sections:[{id:uuid(),title:'Dining',intro:'',comments:true,questions:[Q('rating','How would you rate the Grill Room overall?'),Q('rating','Speed of service at the Turn on a weekend morning'),Q('slider','Where should the kitchen lean next year?',{left:'More casual, faster',right:'More refined, slower'}),Q('choice','How often do you dine at the club?',{options:['Weekly or more','Two or three times a month','Monthly','Rarely']})]},
      {id:uuid(),title:'Golf course',intro:'',comments:true,questions:[Q('rating','Condition of the greens this season'),Q('rating','Pace of play on weekends'),Q('yesno','Should the Glen keep its Monday closure for maintenance?'),Q('multi','Which would you use?',{options:['Earlier weekend tee times','A par-3 course','A short-game practice area','Lighted range']})]},
      {id:uuid(),title:'Facilities & communication',intro:'',comments:true,questions:[Q('rating','The new tennis and pickleball complex'),Q('rating','The pool and cabanas'),Q('rating','How well does the club keep you informed?'),Q('text','One thing you would change about Bushwood')]}]}];

  // ================= the associations =================
  const mkOrg=(id,kind,name,short)=>{ const d=normalize({id,kind,name,short,v:HUB_VERSION,memberships:[],board:[],seasons:{},tournaments:[],activeSeason:'2026'},{id,kind,name,short}); d.golf=freshGolf(); d.surveys=[]; return d; };
  const mga=mkOrg('mga','association','Bushwood Men’s Golf Association','MGA'), lga=mkOrg('lga','association','Bushwood Ladies’ Golf Association','LGA'), grp=mkOrg('czerviks','group','Czervik’s Thursday Game','Czervik’s');
  mga.brand=null; const mgaMen=shuffle(men.filter(p=>p.billing.class!=='social')).slice(0,96); const lgaWomen=shuffle(women.filter(p=>p.billing.class!=='social')).slice(0,48);
  [cast['Elihu Smails'],cast['Ty Webb'],cast['Al Czervik'],cast['Danny Noonan'],cast['Fred Pickering'],cast['Walter Beeper'],cast['Chuck Schick'],cast['Drew Scott'],cast['Jimmy Wang'],cast['Harold Havercamp'],cast['Spalding Smails']].forEach(p=>{ if(!mgaMen.includes(p)) mgaMen.push(p); });
  [cast['Lacey Underall'],cast['Judith Smails'],cast['Gloria Havercamp'],cast['Maggie Shaughnessy'],cast['Carla Gatsby']].forEach(p=>{ if(!lgaWomen.includes(p)) lgaWomen.push(p); });
  mga.memberships=mgaMen.map(p=>({id:p.id,status:'Active',joined:p.billing.since,notes:''})); lga.memberships=lgaWomen.map(p=>({id:p.id,status:'Active',joined:p.billing.since,notes:''}));
  const boardOf=(org,roles)=>roles.map(([role,p])=>({id:uuid(),role,term:'2026',memberId:p?p.id:''}));
  mga.board=boardOf(mga,[['President',cast['Elihu Smails']],['Vice President',cast['Fred Pickering']],['Treasurer',cast['Walter Beeper']],['Secretary',cast['Chuck Schick']],['Tournament Chair',cast['Ty Webb']],['Member at Large',cast['Al Czervik']],['Member at Large',mgaMen.find(p=>!p._o)]]);
  lga.board=boardOf(lga,[['President',cast['Lacey Underall']],['Vice President',cast['Maggie Shaughnessy']],['Treasurer',cast['Judith Smails']],['Secretary',cast['Carla Gatsby']],['Member at Large',cast['Gloria Havercamp']]]);
  // dues
  const duesFor=(org,amount,inst,ms,collectedPct)=>{ const s=org.seasons['2026']; s.dues={amount,installments:inst,autoBill:true}; s.duesCharges=[]; s.duesPayments=[];
    ms.forEach(m=>{ for(let k=0;k<inst;k++){ const c=addDuesCharge(s,m.id,r2(amount/inst),duesDesc('2026',org.short)+(inst>1?` · ${k+1} of ${inst}`:'')); c.date=k===0?'2026-02-0'+rint(1,9):'2026-07-0'+rint(1,9); const r=R();
      if(r<collectedPct){ c.status='collected'; c.chargedAt=addD(c.date,2); c.collectedAt=addD(c.date,rint(10,35)); s.duesPayments.push({id:uuid(),memberId:m.id,amount:c.amount,date:c.collectedAt,method:'Club account',chargeId:c.id}); }
      else if(r<collectedPct+.1){ c.status='charged'; c.chargedAt=addD(c.date,2); } } }); return s; };
  const sMGA=duesFor(mga,150,2,mgaMen,.82), sLGA=duesFor(lga,120,1,lgaWomen,.85);
  sMGA.bankOpening={date:'2026-01-01',amount:12840.5}; sMGA.lines=[L('Member-Member prizes & gifts','Expense',9000,8650),L('Year-end banquet','Expense',6500,0),L('Trophies & engraving','Expense',900,742),L('Hole-in-one insurance','Expense',850,850),L('Website & software','Expense',1200,1140),L('Dues','Income',14400,12300),L('Tournament entries','Income',21000,19325),L('Sponsorships','Income',16000,16500)];
  sMGA.txns=[TX('in','2026-02-18',6150,'Dues deposit — February','Dues, first installment','Deposit'),TX('in','2026-07-21',6150,'Dues deposit — July','Dues, second installment','Deposit'),TX('in','2026-04-27',3200,'Spring Opener entries','Tournament entries','Deposit'),TX('in','2026-06-15',6840,'Member-Member entries','Tournament entries','Deposit'),TX('in','2026-06-15',16500,'Member-Member sponsors','Sponsorships','Deposit'),TX('out','2026-06-16',8650,'Bushwood Golf Shop','Member-Member prizes & tee gifts','Check'),TX('out','2026-06-16',742,'Lakeshore Trophy Co.','Trophies & engraving','Check'),TX('out','2026-03-02',850,'Hole-In-One International','Hole-in-one insurance','Check'),TX('in','2026-08-25',2400,'Club Championship entries','Tournament entries','Deposit'),TX('in','2026-09-21',2800,'Fall Classic entries','Tournament entries','Deposit'),TX('out','2026-01-15',1140,'Flagstick Golf','Website & software','ACH / transfer')];
  sLGA.bankOpening={date:'2026-01-01',amount:6410}; sLGA.lines=[L('Member-Guest prizes','Expense',3200,3050),L('Holiday luncheon','Expense',2800,0),L('Dues','Income',5760,4920),L('Tournament entries','Income',5400,4100)];
  sLGA.txns=[TX('in','2026-03-03',4920,'Dues deposit','Dues','Deposit'),TX('in','2026-07-20',2600,'Member-Guest entries','Tournament entries','Deposit'),TX('out','2026-07-21',3050,'Bushwood Golf Shop','Member-Guest prizes','Check'),TX('in','2026-10-07',1500,'Fall Invitational entries','Tournament entries','Deposit')];
  // the MGA's member survey from the template, closed
  db=mga; { const sv=memberSurveyTemplate(); sv.status='closed'; sv.token=newToken(); sv.openedAt=ts('2026-09-28','09:00'); sv.closedAt=ts('2026-10-19','17:00'); sv.createdAt=ts('2026-09-27','09:00'); sv.anonymous=true; mga.surveys=[sv]; } db=CLUB;

  // ================= scores & tournaments =================
  const idxOf=p=>{ const v=String(p.hcp||'0').trim(); return v.startsWith('+')?-parseFloat(v.slice(1)):parseFloat(v)||0; };
  const holeScore=(par,H)=>{ const h=Math.max(-2,Math.min(30,H)); const pb=Math.max(.03,.2-.008*h), pp=Math.max(.15,.5-.012*h), pbo=.3+.004*h; const r=R(); return par+(r<pb?-1:r<pb+pp?0:r<pb+pp+pbo?1:r<pb+pp+pbo+.12?2:3); };
  const scoreRound=(ev,c,holes)=>{ const Lc=golfData().localScores, m=(Lc[ev.id]=Lc[ev.id]||{}); evPlayers(ev).forEach(({p,grp})=>{ if(!grp) return; const H=idxOf(personById(p.memberId)||{hcp:p.index||'12'}); const cc=courseById(grp.course)||c; m[p.id]=m[p.id]||{}; (holes||[...Array(18).keys()].map(i=>i+1)).forEach(h=>{ m[p.id][h]=Math.max(1,holeScore(cc.par.M[h-1],H)); }); }); };
  const scoreRows=(ev,upd)=>{ const m=golfData().localScores[ev.id]||{}, out=[]; evPlayers(ev).forEach(({p,grp})=>{ const s=m[p.id]||{}; for(const h in s) out.push({event_id:ev.id,player_id:p.id,hole:+h,strokes:s[h],group_id:grp?grp.id:null,updated_at:upd}); }); return out; };
  const scores=[], golfEvents=[];
  const finishEvent=(ev,status,when)=>{ ev.status=status; const pub=publicEvent(ev); golfEvents.push({id:ev.id,slug:ev.slug,public:pub,codes:Object.fromEntries(ev.groups.map(g=>[String(g.code).toUpperCase(),g.id])),updated_at:when,wrap:null}); scores.push(...scoreRows(ev,when)); };

  const mkTournament=(org,o)=>{ db=org; const t=newTournament(Object.assign({season:'2026'},o)); t.venue='Bushwood Country Club'; Object.assign(t,{status:o.status||'Complete',entryFee:o.entryFee,skinsFee:o.skinsFee||0,plannedPlayers:o.players.length,notes:o.notes||'',rules:o.rules||'',placesPaid:o.placesPaid||0,payoutNote:o.payoutNote||'',hcpDiff:o.hcpDiff||0});
    if(o.fieldQuestions) t.fieldQuestions=o.fieldQuestions;
    const ts_=t.teamSize||1; o.players.forEach((p,i)=>{ const answers={}; (t.fieldQuestions||[]).forEach(q=>{ answers[q.key]=chance(.6)?'Yes':'No'; }); t.field.push({id:uuid(),memberId:p.id,team:ts_>1?Math.floor(i/ts_)+1:0,paid:o.status==='Open for signups'?chance(.5):true,skins:!!o.skinsFee&&chance(.7),answers}); });
    t.actuals={entryFees:t.field.filter(p=>p.paid).length*t.entryFee,skins:t.field.filter(p=>p.skins).length*(t.skinsFee||0),skinsPaid:o.status==='Complete'?t.field.filter(p=>p.skins).length*(t.skinsFee||0):0};
    org.tournaments.push(t); t.rounds=defaultRounds(t); t.rounds.forEach((r,i)=>{ const C=catalogById(o.game||(ts_>1?'bestball':'stroke')); Object.assign(r,engineFrom(C,ts_,o.count||1)); r.scoring=o.scoring||'net'; r.front=r.back=r.format; if(o.points) r.points=o.points; if(o.quotaBase) r.quotaBase=o.quotaBase; });
    ensureTournamentScoring(t); const evs=tournamentRounds(t).map(roundEvent); evs.forEach(ev=>{ ev.defaultCourse='bushwood'; ev.name=ev.name.replace(/Walnut Creek/g,'Bushwood'); });
    if(o.flights){ setTournamentFlights(t,o.flights); const plan=tFlightPlan(t); t.flights.names.forEach((n,i)=>{ plan[n].course=i%2===0?'bushwood':'glen'; plan[n].start=o.start||'shotgun'; plan[n].first='08:30'; plan[n].hole=1+i*6; }); evs.forEach(ev=>applyFlights(t,ev)); }
    else { evs.forEach(ev=>{ ev.flights={count:0,names:[]}; }); }
    if(t.status==='Complete'){ evs.forEach((ev,i)=>{ if(i===0) buildGroupsFromFlights(ev); else pairByStandings(t,tournamentRounds(t)[i]); if(!ev.groups.length) throw new Error('no groups for '+ev.name); scoreRound(ev,courseById('bushwood')); finishEvent(ev,'final',ts(ev.date,'16:30')); }); }
    else { evs.forEach(ev=>{ if(o.groups) buildGroupsFromFlights(ev); finishEvent(ev,'live',ts(TODAY,'08:00')); }); }
    db=CLUB; return t; };
  const engFix=(t)=>t;   // (engine fields come from the catalog)

  // --- MGA tournaments
  const stbl={stableford:{'-3':8,'-2':6,'-1':4,'0':2,'1':1,'2':0}};
  const spring=mkTournament(mga,{name:'Spring Opener',startDate:'2026-04-25',days:1,teamSize:1,entryFee:50,skinsFee:20,players:shuffle(mgaMen).slice(0,64),flights:2,game:'stroke',scoring:'net',rules:'Full handicaps.\nWhite tees; seniors 70+ may play Gold.\nTies for places split the money.',placesPaid:12,payoutNote:'Shop credit to six places in each flight.'});
  const mm=mkTournament(mga,{name:'Bushwood Member-Member',startDate:'2026-06-12',days:3,teamSize:2,entryFee:175,skinsFee:40,players:shuffle(mgaMen).slice(0,72),flights:3,game:'bestball',scoring:'net',hcpDiff:10,
    fieldQuestions:[{key:uuid(),label:'Shirt size',short:'Shirt',kind:'text'},{key:uuid(),label:'Bringing a guest to Saturday dinner?',short:'Dinner guest',kind:'yesno'}].map(q=>Object.assign(q,{label:q.label})),
    rules:'Two-man teams, best ball net, three rounds.\nPartner differential cap of 10.\nFlights by combined index after the cap.\nCalcutta Saturday night; team buy-in optional.\nTies share the places.',placesPaid:12,payoutNote:'Four places per flight, 40 / 30 / 20 / 10.',notes:'The big one. 36 teams, three days, the Calcutta on Saturday night.'});
  const cc=mkTournament(mga,{name:'Club Championship',startDate:'2026-08-22',days:2,teamSize:1,entryFee:60,players:shuffle(mgaMen).slice(0,48),flights:3,game:'stroke',scoring:'gross',rules:'Gross stroke play, 36 holes.\nChampionship flight from the Black tees.\nPlayoff: sudden death from 18.',placesPaid:9,payoutNote:'The cup and the plaque; shop credit to three places per flight.'});
  const fall=mkTournament(mga,{name:'Fall Classic',startDate:'2026-09-19',days:1,teamSize:2,entryFee:70,skinsFee:20,players:shuffle(mgaMen).slice(0,56),flights:2,game:'bestball',scoring:'net',rules:'Two-man best ball, net.\nShotgun at 9.',placesPaid:8,payoutNote:'Four places per flight.'});
  const turkey=mkTournament(mga,{name:'Turkey Shoot',startDate:'2026-11-21',days:1,teamSize:3,entryFee:50,players:shuffle(mgaMen.filter(p=>!spring.field.some(x=>x.memberId===p.id)||chance(.4))).slice(0,27),game:'teamstable',count:2,scoring:'net',points:stbl,status:'Open for signups',
    rules:'Three-man teams, best two Stableford points count on every hole.\nFull handicaps off the White tees.\nShotgun at 10; a turkey to every player on the winning team.',placesPaid:9,payoutNote:'Three places; turkeys to the winners, shop credit to second and third.',notes:'Registration is open on the website link.'});
  turkey.reg={token:newToken(),status:'open',openedAt:ts('2026-11-02','09:00')}; turkey.schedule=[{day:0,label:'',items:[{id:uuid(),time:'9:00 AM',event:'Players meeting',notes:''},{id:uuid(),time:'10:00 AM',event:'Shotgun start',notes:'Weather permitting'},{id:uuid(),time:'3:00 PM',event:'Turkeys & awards at the Turn',notes:''}]}];
  // --- Member-Member: the whole package
  db=mga; { const t=mm; t.features={meals:true,sponsors:true,budget:true,checklist:true,calcutta:true,raffle:true};
    t.tiers=[{id:uuid(),name:'Title',amt:5000},{id:uuid(),name:'Gold',amt:2500},{id:uuid(),name:'Silver',amt:1000},{id:uuid(),name:'Hole',amt:500}];
    const SP=[['Czervik Construction','Title',5000,'Al Czervik'],['Smails & Pickering, Attorneys','Gold',2500,'Elihu Smails'],['Bushwood Lincoln-Mercury','Gold',2500,'Mel Ostrowski'],['Lakeshore Insurance Group','Silver',1000,'Pam Hutchins'],['Noonan Plumbing & Heating','Silver',1000,'Jim Noonan'],['Beeper Medical Associates','Silver',1000,'Walter Beeper'],['The Webb Family Foundation','Hole',500,'Ty Webb'],['Wang Imports','Hole',500,'Jimmy Wang'],['Havercamp Realty','Hole',500,'Harold Havercamp'],['Gopher Pest Control','Hole',500,'Carl Spackler']];
    t.sponsors=SP.map(([company,tier,pledged,contact],i)=>({id:uuid(),company,tier,pledged,contact,committee:pick(['Ty Webb','Chuck Schick','Al Czervik']),phone:'312-555-0'+String(100+i),email:'',notes:'',payments:i<9?[{id:uuid(),amount:pledged,method:pick(['Check','Zelle','Credit card']),date:'5/'+rint(2,28),checkNo:''}]:[]}));
    const M=(item,guests,items,actual)=>({id:uuid(),item,kind:'Meal',menu:{items:items.map(([n,q,c])=>({id:uuid(),item:n,qty:q,unitCost:c,notes:''})),guests,svcPct:0},qty:guests,unitCost:0,qtyLink:'',actual,notes:''});
    t.dayItems=[[M('Friday welcome reception',80,[['Heavy hors d’oeuvres',80,28],['Open bar (2 hrs)',80,22]],3960),{id:uuid(),item:'Tee gifts — Bushwood quarter-zip',kind:'Golf',qty:0,unitCost:68,qtyLink:'players',actual:4896,notes:'Golf Shop'}],
      [M('Saturday Calcutta dinner',140,[['Prime rib dinner',140,54],['Wine service',140,14]],9520),{id:uuid(),item:'Auctioneer',kind:'Entertainment',qty:1,unitCost:300,qtyLink:'',actual:300,notes:'Bishop Pickering, as always'}],
      [M('Sunday awards lunch',90,[['Buffet lunch',90,32]],2880),{id:uuid(),item:'Trophies & engraving',kind:'Prizes',qty:1,unitCost:742,qtyLink:'',actual:742,notes:''}]];
    t.perPlayer=[{id:uuid(),desc:'Prize fund',perPlayer:45,actual:3240,notes:'Shop credit by flight'},{id:uuid(),desc:'Range balls & carts',perPlayer:18,actual:1296,notes:''}];
    t.lines=[L('Skins pool (pass-through)','Income',2880,2880),L('Skins paid out','Expense',2880,2880),L('Signage & printing','Expense',650,612)];
    t.schedule=[{day:0,label:'Friday',items:[{id:uuid(),time:'12:30 PM',event:'Shotgun — Round 1',notes:''},{id:uuid(),time:'6:00 PM',event:'Welcome reception',notes:'Patio'}]},{day:1,label:'Saturday',items:[{id:uuid(),time:'8:30 AM',event:'Shotgun — Round 2',notes:''},{id:uuid(),time:'6:30 PM',event:'Dinner & the Calcutta',notes:'Grill Room'}]},{day:2,label:'Sunday',items:[{id:uuid(),time:'8:30 AM',event:'Shotgun — Final round',notes:''},{id:uuid(),time:'1:30 PM',event:'Awards lunch',notes:''}]}];
    t.decisions=[{id:uuid(),text:'Keep the 10-shot differential cap for 2027',done:true},{id:uuid(),text:'Move the Calcutta to the ballroom next year',done:false},{id:uuid(),text:'Add a Friday night skins game',done:false}];
    t.checklist=ckFromTemplate(CK_MM2026); t.checklist.tasks.forEach((k,i)=>{ if(chance(.72)) k.done=true; k.memberId=pick(mga.board).memberId||''; if(chance(.15)) k.notes='Confirmed with the shop.'; });
    // Calcutta: lots by team, bidders, prices; places from the results
    const c=calc(t); const teams=new Map(); t.field.forEach(p=>{ const a=teams.get(p.team)||[]; a.push(p); teams.set(p.team,a); });
    const bidderPool=shuffle(mgaMen).slice(0,26).map((p,i)=>({id:uuid(),num:String(i+1),name:pname(p),memberId:p.id,paid:chance(.85),method:pick(['Check','Zelle','Credit card','Cash'])})); c.bidders=bidderPool;
    const flightOf=team=>t.flights.of['T'+team]||''; let lotNo=1;
    c.lots=[...teams.entries()].sort((a,b)=>a[0]-b[0]).map(([team,ps])=>{ const [a,b]=ps.map(x=>personById(x.memberId)); const idx=r2(idxOf(a)+idxOf(b)); const price=chance(.15)?rint(120,240):rint(260,2400)-rint(0,9)*10; return {id:uuid(),lot:lotNo++,p1:pname(a),p2:pname(b),i1:a.hcp,i2:b.hcp,m1:a.id,m2:b.id,flight:flightOf(team),idx,fun:false,bidderId:pick(bidderPool).id,price:Math.max(100,price)}; });
    c.expenses=[{id:uuid(),desc:'Auctioneer',amount:300,notes:''}]; c.minBid=250; c.payout=[40,30,20,10]; c.paidOut={};
    const Rz=tournamentResults(t,'net'); const byTeam=new Map(); t.field.forEach(p=>{ const a=byTeam.get('T'+(p.team||0))||[]; a.push(p.memberId); byTeam.set('T'+(p.team||0),a); });
    Rz.list.forEach(u=>{ const ids=new Set(u.isTeam?(byTeam.get(u.key)||[]):[u.key]); const l=c.lots.find(l=>[l.m1,l.m2].some(id=>ids.has(id))); if(l) l.place=u.flightPos; });
    // the 50/50
    const names=shuffle(mgaMen).slice(0,70).map(p=>[p.first,p.last]); const tickets=[]; let no=1; names.forEach((n,ni)=>{ const k=rint(1,6); for(let j=0;j<k;j++){ tickets.push([0,no,ni,no]); no++; } });
    const Rf={file:'5050-member-member.xlsx',importedAt:ts('2026-06-13','17:40'),tours:['Member-Member 2026'],names,tickets,merges:{},rulings:{},prizes:[Math.round((tickets.length*20)/4/10)*10,Math.round((tickets.length*20)/4/10)*10],draws:[]};
    Rf.locked={at:ts('2026-06-13','20:05'),fp:await rfFingerprint(Rf)};
    const elig=rfTickets(Rf); for(let d=0; d<2; d++){ const pool=elig.filter(x=>!Rf.draws.some(z=>z.playerKey===x.key)); const i=Math.floor(R()*pool.length), w=pool[i];
      Rf.draws.push({id:uuid(),no:d+1,prize:Rf.prizes[d],at:ts('2026-06-13',d?'21:12':'20:58'),eligibleTickets:pool.length,eligiblePlayers:new Set(pool.map(x=>x.key)).size,removedTickets:elig.length-pool.length,rand:Math.floor(R()*4294967296),index:i,ticket:{tour:w.tour,no:w.no,row:w.row,first:w.first,last:w.last},playerKey:w.key,winner:rfPlayerName(Rf,w.key),winnerTickets:elig.filter(x=>x.key===w.key).length,fp:Rf.locked.fp}); }
    t.raffle=Rf; }
  db=CLUB;
  // --- LGA
  const lmg=mkTournament(lga,{name:'Ladies’ Member-Guest',startDate:'2026-07-17',days:2,teamSize:2,entryFee:90,players:shuffle(lgaWomen).slice(0,36),flights:2,game:'bestball',scoring:'net',rules:'Two-lady best ball, net, two days.\nGuests play to their verified index.',placesPaid:8,payoutNote:'Four places per flight.'});
  lmg.features={meals:true,sponsors:false,budget:true,checklist:false,calcutta:false,raffle:false};
  const linv=mkTournament(lga,{name:'Fall Ladies’ Invitational',startDate:'2026-10-06',days:1,teamSize:1,entryFee:45,players:shuffle(lgaWomen).slice(0,30),flights:2,game:'stableford',scoring:'net',points:stbl,rules:'Individual Stableford, full handicaps, Red tees.',placesPaid:6,payoutNote:'Three places per flight.'});
  const lhol=mkTournament(lga,{name:'Holiday Scramble',startDate:'2026-12-05',days:1,teamSize:4,entryFee:40,players:shuffle(lgaWomen).slice(0,32),game:'bestball',scoring:'net',status:'Planning',rules:'Four-lady best ball — festive attire encouraged.',placesPaid:3,payoutNote:'Gift cards to the winning team.'});

  // ================= the small group: Czervik's Thursday Game =================
  const groupMen=[cast['Al Czervik'],cast['Danny Noonan'],cast['Chuck Schick'],cast['Drew Scott'],cast['Jimmy Wang'],cast['Ty Webb'],cast['Spalding Smails']].concat(shuffle(mgaMen.filter(p=>!p._o)).slice(0,15));
  grp.memberships=groupMen.map(p=>({id:p.id,status:'Active',joined:'2026-04-01',notes:''}));
  const GAMES=[]; db=grp; gamesData();
  const mkGame=(date,players,o)=>{ o=o||{}; const g={id:uuid(),season:'2026',status:o.status||'settled',name:o.name||'Thursday Game',date,time:o.time||'15:30',course:o.course||'bushwood',tee:'White',notes:'',rules:'Gross beats net on skins.\nPay the Turn before the round.',hcp:'full',payWhen:'after',settle:'pot',golfEventId:'',players:[],pots:[],failWord:'NOPE!'};
    players.forEach(p=>{ const x=addPlayer(g,{memberId:p.id}); x.paid=o.status==='open'?chance(.5):true; });
    const sk=newPot('skins',g); sk.entry=20; sk.rules.skins.live=false; sk.rules.noPar3=true; const st=newPot('stroke',g); st.entry=10; st.rules.places=[60,40]; const bb=newPot('bestball',g); bb.entry=10; bb.rules.teamsBy='after'; bb.rules.teamSize=2;
    g.pots=[sk,st,bb]; if(o.waltz){ const w=newPot('waltz123',g); w.entry=20; g.pots.push(w); }
    gamesData().push(g); const ev=ensureGameEvent(g); ev.date=g.date; ev.defaultCourse=g.course; applyGameDefaults(g,ev,{course:true,tee:true}); ev.groups.forEach((gr,i)=>{ gr.teeTime=hm(15,30+i*10); gr.course=g.course; gr.startHole=o.shotgun?1+i*2:1; });
    return {g,ev}; };
  const settleGame=(g,ev,holes)=>{ scoreRound(ev,courseById(g.course),holes);
    const bb=g.pots.find(p=>p.rules.game==='bestball'); if(bb){ const ps=evPlayers(ev).map(x=>x.p); const teams=drawTeams(ps,2,'random',p=>effIndex(ev,p).idx); bb.teams={}; teams.forEach((t,i)=>t.forEach(p=>{ bb.teams[p.id]='S'+(i+1); })); const used=new Set(teams.flat().map(p=>p.id)); bb.sitOut=ps.filter(p=>!used.has(p.id)).map(p=>p.id); bb.draw={at:ts(g.date,'19:05'),method:'random',size:2,by:'',log:[]}; }
    if(!holes){ const pub=publicEvent(ev), sc=scoresFor(ev); g.pots.forEach(pot=>{ if(pot.kind==='manual'||pot.kind==='dots') return; const comp=potComp(g,pot); const r=compPayouts(pub,comp,sc); pot.payouts=(r.rows||[]).map(x=>{ const gp=g.players.find(p=>p.gpid===x.pid); return gp?{id:uuid(),pid:gp.id,amount:r2(x.amount),note:x.note||''}:null; }).filter(Boolean); if(pot.kind==='skins') pot.calledOut=true; }); g.status='settled'; g.wrap={closedAt:ts(g.date,'19:20'),closedBy:ev.groups[0]&&ev.groups[0].code,paidAt:ts(g.date,'19:30'),paidBy:ev.groups[0]&&ev.groups[0].code}; } };
  let thu='2026-05-14'; let k=0; while(thu<TODAY){ if(!['2026-07-02','2026-09-03'].includes(thu)){ const n=rint(11,16); const ps=shuffle(groupMen).slice(0,n); const {g,ev}=mkGame(thu,ps,{waltz:k%4===3,course:k%3===2?'glen':'bushwood'}); settleGame(g,ev); finishEvent(ev,'final',ts(thu,'19:10')); GAMES.push(g); } thu=addD(thu,7); k++; }
  // today: a live game mid-round, and Thursday's game set up
  const live=mkGame(TODAY,shuffle(groupMen).slice(0,12),{status:'open',name:'Tuesday Shootout',time:'09:00'}); live.g.players.forEach(p=>{ p.paid=true; });
  settleGame(live.g,live.ev,null); { const Lc=golfData().localScores, m=Lc[live.ev.id]={}; live.ev.groups.forEach((gr,gi)=>{ const thru=[11,10,8][gi]||8; gr.players.forEach(p=>{ const H=idxOf(personById(p.memberId)||{hcp:'12'}); m[p.id]={}; for(let h=1;h<=thru;h++) m[p.id][h]=Math.max(1,holeScore(courseById('bushwood').par.M[h-1],H)); }); }); live.g.status='open'; delete live.g.wrap; live.g.pots.forEach(p=>{ p.payouts=[]; delete p.calledOut; }); }
  finishEvent(live.ev,'live',ts(TODAY,'11:40')); GAMES.push(live.g);
  const next=mkGame(addD(TODAY,2),shuffle(groupMen).slice(0,14),{status:'open'}); next.g.players.forEach(p=>{ p.paid=false; }); finishEvent(next.ev,'live',ts(TODAY,'08:05')); GAMES.push(next.g);
  grp.ledgerAdj=[{id:uuid(),season:'2026',date:'2026-08-20',memberId:cast['Al Czervik'].id,amount:-40,desc:'Bought the Turn a round — a side bet with Smails'},{id:uuid(),season:'2026',date:'2026-10-01',memberId:cast['Danny Noonan'].id,amount:25,desc:'Closest-to-the-pin, Labor Day'}];
  // the cart's wolf on today's game, group 1
  const side=(()=>{ const gr=live.ev.groups[0]; const ids=gr.players.map(p=>p.id); const holes={}; for(let h=1;h<=10;h++){ const wolf=ids[(h-1)%ids.length]; const others=ids.filter(x=>x!==wolf); holes[h]={pick:h%4===0?'lone':pick(others),mult:h%4===0?(h===8?2:1):1,at:ts(TODAY,hm(9+Math.floor(h/3),(h*17)%60)),by:gr.code}; }
    return {event_id:live.ev.id,group_id:gr.id,data:{game:'wolf',stakes:{small:5,large:5},order:ids,scoring:'net',birdies:'gross',holes,setBy:ids[0],at:ts(TODAY,'08:58')},v:11,by:gr.code,updated_at:ts(TODAY,'11:38')}; })();
  db=CLUB;

  // ================= tables: tickets, accounts, bookings =================
  const FIRST_DAY='2026-05-11', DAYS=daysBetween(FIRST_DAY,TODAY);
  const billableMembers=persons.filter(p=>p.status!=='Inactive'&&p.billing.class);
  const itemOfId=id=>B.items.find(i=>i.id===id)||{};
  const stations=[{id:uuid(),outlet:'grill',kind:'register',expo:null,name:'Grill Room 1',dept:null},{id:uuid(),outlet:'grill',kind:'register',expo:null,name:'Bar',dept:null},{id:uuid(),outlet:'grill',kind:'expo',expo:expoIds.kitchen,name:'Kitchen screen',dept:null},{id:uuid(),outlet:'turn',kind:'register',expo:null,name:'The Turn',dept:null},{id:uuid(),outlet:'proshop',kind:'register',expo:null,name:'Golf Shop counter',dept:null},{id:uuid(),outlet:'racket',kind:'register',expo:null,name:'Racquet Shop',dept:null},{id:uuid(),outlet:null,kind:'clock',expo:null,name:'Staff entrance clock',dept:'fnb'}];
  for(const s of stations){ s.token=newToken(); s.key_hash=await sha256hex(s.token); s.created_at=ts('2026-05-01','10:00'); s.revoked_at=null; s.last_seen=ts(TODAY,'10:12'); }
  const stationOf=o=>stations.find(s=>s.outlet===o&&s.kind==='register');
  const acct=[], tickets=[], counters={}, posDays=[], bookings=[], blocks=[];
  const acctRow=(o)=>{ const row=Object.assign({id:uuid(),kind:'charge',source:'manual',ref:null,descr:'',amount:0,tax:0,svc:0,tip:null,item:null,gl:null,method:null,reference:null,posted:TODAY,void_at:null,void_reason:null,created_at:ts(TODAY,'12:00'),created_by:STAFF_EMAIL,slip:null},o); row.amount=r2(row.amount); acct.push(row); return row; };
  const servers={grill:['Maggie O’Hooligan','Dana Whitfield','Kyle Brennan','Marcus Bell'],turn:['Priya Natarajan','Kyle Brennan'],proshop:['Lou Loomis','Jack Hartigan','Tony D’Annunzio'],racket:['Owen Marsh','Elena Rossi']};
  const WEIGHT={grill:{'Entrées':3,'Sandwiches & burgers':4,'Salads':2,'Starters':2,'Beer':4,'Wine':2,'Cocktails':3,'Non-alcoholic':2,'Desserts':1,'Sides':1,'Kids':1,'Breakfast':2},turn:{'The turn':5,'Beer':4,'Non-alcoholic':3,'Sandwiches & burgers':2}};
  const prodPick=(o)=>{ const ps=prodsOf(o); const W=WEIGHT[o]; if(!W) return pick(ps); const pool=[]; ps.forEach(p=>{ const w=W[p.cat]||0; for(let i=0;i<w;i++) pool.push(p); }); return pool.length?pick(pool):pick(ps); };
  const lineOf=(p,fnb)=>{ const mods=[]; (p.mods||[]).forEach(m=>{ if(m.required||chance(.3)){ const o=pick(m.options||[]); if(o) mods.push({name:o.name,price:o.price||0}); } }); return {id:uuid(),pid:p.id,qty:chance(.2)?2:1,svc:fnb,mods,name:p.name,seat:0,fired:fnb,price:p.price,route:p.route||null,course:p.course||0,taxable:true}; };
  const memberPool=billableMembers.filter(p=>p.billing.status==='active');
  let acctFnbByMember={};
  for(const d of DAYS){ const wd=dow(d), wknd=wd===0||wd===6;
    for(const o of ['grill','turn','proshop','racket']){ let n=o==='grill'?rint(5,9)+(wknd?3:0):o==='turn'?(wknd?rint(5,9):rint(2,5)):o==='proshop'?rint(1,3)+(wknd?2:0):(chance(.5)?1:0); if(o==='turn'&&(d<'2026-05-15'||d>'2026-11-02')) n=Math.max(0,n-3);
      for(let i=0;i<n;i++){ counters[o+'|'+d]=(counters[o+'|'+d]||0)+1; const num=counters[o+'|'+d]; const fnb=o==='grill'||o==='turn'; const h=o==='turn'?rint(7,14):o==='grill'?(chance(.4)?rint(11,14):rint(17,20)):rint(8,16), mi=rint(0,59); const created=ts(d,hm(h,mi)); const closed=ts(d,hm(Math.min(23,h+(fnb&&o==='grill'?1:0)),Math.min(59,mi+rint(8,40)%60)));
        const lines=Array.from({length:o==='grill'?rint(1,4):rint(1,2)},()=>lineOf(prodPick(o),fnb)); const subtotal=r2(lines.reduce((a,l)=>a+l.qty*(l.price+l.mods.reduce((x,m)=>x+m.price,0)),0)); const svc=fnb?r2(subtotal*.18):0, tax=0;
        const payR=R(), method=payR<.62?'account':payR<.9?'card':'cash'; const recent=d>=addD(TODAY,-1); const slip=fnb&&method!=='cash'&&recent&&chance(.5); const tip=slip?null:(fnb&&method!=='cash'?Math.round(subtotal*pick([0,.1,.15,.2])):0);
        const total=r2(subtotal+svc+tax+(tip||0)); const member=method==='account'?pick(memberPool):(chance(.5)?pick(memberPool):null); const server=pick(servers[o]); const sid=(staffByName(server)||{}).id||null;
        const pay={id:uuid(),at:closed,by:server,tip,label:null,amount:total,method,acct_item:null,member_id:method==='account'?member.id:null};
        const t={id:uuid(),outlet:o,member_id:member?member.id:null,guest:member?null:pick(['Walk-in','Guest of member','Outing','']),lines,subtotal,svc,tax,tip:tip||0,total,paid:method,status:slip?'slip':'closed',acct_item:null,note:'',created_at:created,closed_at:closed,created_by:server,void_at:null,void_reason:null,station:(stationOf(o)||{}).id||null,table_no:o==='grill'?pick(CLUB.pos.outlets[0].tables):null,server,server_id:sid,guests:fnb?rint(1,4):0,updated_at:closed,payments:[pay],check_no:checkNoFor(d,num),day:d};
        if(method==='account'){ const descr=`${CLUB.pos.outlets.find(x=>x.id===o).name} · ${lines.map(l=>(l.qty>1?l.qty+'× ':'')+l.name).join(', ')}${tip?' · tip '+tip.toFixed(2):''}`; const it=itemOfId(fnb?'fnb':'proshop'); const a=acctRow({member_id:member.id,kind:'charge',source:fnb?'fnb':'proshop',item:it.id,gl:it.gl||(fnb?'4100':'4200'),ref:`pos:${t.id}:${pay.id}`,descr,amount:total,tax,svc,tip:tip||null,posted:d,created_at:closed,created_by:server}); pay.acct_item=a.id; t.acct_item=a.id; if(fnb){ acctFnbByMember[member.id]=(acctFnbByMember[member.id]||0); } }
        if(chance(.012)&&!slip){ t.status='void'; t.void_at=closed; t.void_reason=pick(['Rang on the wrong table','Guest left','Manager comp']); if(t.acct_item){ const a=acct.find(x=>x.id===t.acct_item); a.void_at=closed; a.void_reason='Ticket voided · '+t.void_reason; } }
        tickets.push(t); } }
    // the day closed at the Grill Room (except the last two days)
    if(d<addD(TODAY,-1)){ const dayT=tickets.filter(t=>t.outlet==='grill'&&t.day===d); const cash=r2(dayT.filter(t=>t.paid==='cash'&&t.status!=='void').reduce((a,t)=>a+t.total,0)); posDays.push({id:uuid(),outlet:'grill',day:d,closed_at:ts(d,'22:40'),closed_by:'Renee Alvarez',cash_sales:cash,cash_counted:r2(cash+(chance(.2)?pick([-5,-2,3,10]):0)),notes:chance(.1)?'Short a bar tab — see Marcus.':'',totals:shiftStats(dayT)}); } }
  // ---- member accounts: the monthly runs, minimums, dues from the associations, statements, payments, late charges
  const MONTHS=monthsBetween('2026-05','2026-11'); const runs=[];
  for(const ym of MONTHS){ let n=0,total=0; for(const p of billableMembers){ const x=p.billing; if(x.status==='loa') continue; if(x.status==='resigned'&&x.until<ym+'-01') continue; const c=B.classes.find(c=>c.id===x.class); if(!c) continue;
      for(const chg of c.charges){ if(!dueThisMonth(chg,ym)) continue; const it=itemOfId(chg.itemId); const m=chargeFor(it.id,chg.amount); acctRow(Object.assign({member_id:p.id,kind:'charge',source:it.source,item:it.id,gl:it.gl,ref:`run:${ym}:${chg.id}:${p.id}`,descr:`${it.name} · ${ymTxt(ym)}`,posted:ym+'-01',created_at:ts(ym+'-01','06:05')},m)); n++; total+=m.amount; }
      // unspent minimum for the quarter that closed last month
      const prev=ymAdd(ym,-1), pm=+prev.slice(5,7); if(pm%3===0&&n0(c.minimum.amount)>0){ const from=ymAdd(prev,-2)+'-01', to=monthEnd(prev); if(from>='2026-04-01'){ const spent=r2(acct.filter(i=>i.member_id===p.id&&i.kind==='charge'&&i.source==='fnb'&&i.item!=='min'&&!i.void_at&&i.posted>=from&&i.posted<=to).reduce((a,i)=>a+(i.amount-(i.tip||0)),0)); const short=r2(c.minimum.amount-spent); if(short>0.004){ const it=itemOfId('min'); acctRow(Object.assign({member_id:p.id,kind:'charge',source:'fnb',item:'min',gl:it.gl||'4100',ref:`min:${from.slice(0,7)}:${p.id}`,descr:`Unspent minimum · ${dateTxt(from)} – ${dateTxt(to)} (spent ${fmt2(spent)} of ${fmt2(c.minimum.amount)})`,posted:monthEnd(ym),created_at:ts(monthEnd(ym),'23:10')},chargeFor('min',short))); n++; total+=short; } } } }
    runs.push({month:ym,at:ts(ym+'-01','06:05'),by:STAFF_EMAIL,n,total:r2(total)}); }
  B.runs=runs;
  // dues put on account by the associations (Dues collection)
  [[mga,sMGA],[lga,sLGA]].forEach(([org,s])=>{ s.duesCharges.forEach(c=>{ if(c.status==='open') return; const it=itemOfId('dues'); acctRow({member_id:c.memberId,kind:'charge',source:'dues',item:'dues',gl:it.gl,ref:c.id,descr:`${c.desc} — ${org.short}`,amount:c.amount,posted:c.chargedAt,created_at:ts(c.chargedAt,'09:30')}); }); });
  // lessons and cabanas post a fee from the booking; bookings themselves
  const slotsFor=f=>slotsOf(f);
  const bkRow=(f,d,time,unit,players,o)=>{ o=o||{}; const lead=players[0]; const b={id:uuid(),facility:f.id,date:d,time,unit,member_id:lead?lead.id:null,name:o.name||'',players:players.map(p=>({name:pname(p),member_id:p.id})),note:o.note||'',status:o.status||'booked',source:o.source||'staff',acct_item:null,created_by:o.source==='member'?(lead?lead.email:STAFF_EMAIL):pick(['Lou Loomis','Jack Hartigan',STAFF_EMAIL]),created_at:ts(addD(d,-rint(1,6)),hm(rint(7,20),rint(0,59))),cancelled_at:o.status==='cancelled'?ts(addD(d,-1),'18:20'):null};
    if(f.fee&&f.fee.amount&&b.status!=='cancelled'&&lead){ const it=itemOfId(f.fee.item); const a=acctRow(Object.assign({member_id:lead.id,kind:'charge',source:'facility',item:it.id,gl:it.gl||'4300',ref:`bk:${b.id}`,descr:`${f.name} · ${unitName(f,unit)} · ${dateTxt(d)} ${t12(time)}`,posted:d,created_at:b.created_at,created_by:b.created_by},chargeFor(it.id,f.fee.amount))); b.acct_item=a.id; }
    bookings.push(b); return b; };
  const F=id=>CLUB.booking.facilities.find(f=>f.id===id);
  for(const d of daysBetween(addD(TODAY,-45),addD(TODAY,10))){ const past=d<TODAY, wd=dow(d), wknd=wd===0||wd===6; if(wd===1&&chance(.5)) {}
    const tee=F('tee'); const used=new Set(); const nT=wknd?rint(16,24):rint(7,13); for(let i=0;i<nT;i++){ const slot=pick(slotsFor(tee).filter(s=>s<'15:10')), unit=rint(1,2); if(used.has(slot+unit)) continue; used.add(slot+unit); const ps=shuffle(memberPool).slice(0,pick([2,3,4,4])); const st=past?(chance(.86)?'checked_in':chance(.6)?'booked':'cancelled'):'booked'; bkRow(tee,d,slot,unit,ps,{status:st,source:chance(.45)?'member':'staff'}); }
    for(const cid of ['tennis','pickle']){ const f=F(cid); const n=cid==='tennis'?rint(3,7):rint(2,5); const u2=new Set(); for(let i=0;i<n;i++){ const slot=pick(slotsFor(f).filter(s=>s>='08:00'&&s<='19:00')), unit=rint(1,f.units); if(u2.has(slot+unit)) continue; u2.add(slot+unit); bkRow(f,d,slot,unit,shuffle(memberPool).slice(0,pick([2,2,4])),{status:past?(chance(.8)?'checked_in':'booked'):'booked',source:chance(.6)?'member':'staff'}); } }
    if(d<='2026-09-13'&&wknd){ const f=F('cabanas'); shuffle([1,2,3,4,5,6]).slice(0,rint(2,5)).forEach(u=>bkRow(f,d,pick(['10:00','14:00']),u,shuffle(memberPool).slice(0,1),{status:'checked_in',source:'member'})); }
    if([2,4,6].includes(wd)){ const f=F('lessons'); shuffle(slotsFor(f).filter(s=>s>='09:00'&&s<='16:00')).slice(0,rint(1,3)).forEach(s=>bkRow(f,d,s,rint(1,2),shuffle(memberPool).slice(0,1),{status:past?'checked_in':'booked',source:'staff',note:pick(['Driver','Short game','Playing lesson, 3 holes',''])})); }
    if([1,3,5].includes(wd)){ const f=F('rlessons'); shuffle(slotsFor(f).filter(s=>s>='09:00'&&s<='17:00')).slice(0,rint(0,2)).forEach(s=>bkRow(f,d,s,1,shuffle(memberPool).slice(0,1),{status:past?'checked_in':'booked',source:'member'})); } }
  blocks.push({id:uuid(),facility:'tee',date:'2026-10-12',from_t:'07:00',to_t:'17:00',units:[1],reason:'Aerification — Bushwood Course',created_by:'Sandy McFiddish',created_at:ts('2026-09-30','09:00')},{id:uuid(),facility:'tee',date:'2026-10-13',from_t:'07:00',to_t:'17:00',units:[1],reason:'Aerification — Bushwood Course',created_by:'Sandy McFiddish',created_at:ts('2026-09-30','09:00')},{id:uuid(),facility:'tee',date:'2026-10-19',from_t:'07:00',to_t:'17:00',units:[2],reason:'Aerification — The Glen',created_by:'Sandy McFiddish',created_at:ts('2026-09-30','09:00')},{id:uuid(),facility:'tee',date:addD(TODAY,6),from_t:'07:00',to_t:'09:00',units:null,reason:'Frost delay — greens crew',created_by:'Carl Spackler',created_at:ts(TODAY,'06:40')},{id:uuid(),facility:'tennis',date:addD(TODAY,3),from_t:'12:00',to_t:'16:00',units:[1,2],reason:'Junior clinic',created_by:'Elena Rossi',created_at:ts(addD(TODAY,-2),'11:00')});
  // statements at every month end May–Oct, payments afterwards, late charges where a statement went unpaid
  const stmts=[]; const live_=i=>!i.void_at; const sign=i=>i.kind==='charge'?i.amount:-i.amount;
  const payerKind={}; billableMembers.forEach(p=>{ const r=R(); payerKind[p.id]=r<.8?'full':r<.92?'partial':'late'; });
  for(const ym of monthsBetween('2026-05','2026-10')){ const end=monthEnd(ym), runId=uuid(), issued=ts(addD(end,1),'03:20');
    for(const p of billableMembers){ const its=acct.filter(i=>i.member_id===p.id&&live_(i)&&i.posted<=end); if(!its.length) continue; const prev=stmts.filter(s=>s.member_id===p.id).sort((a,b)=>b.period_end.localeCompare(a.period_end))[0]; const start=prev?addD(prev.period_end,1):its.map(i=>i.posted).sort()[0];
      // late charges on the previous statement
      if(prev&&prev.closing>0.004&&prev.due<end){ const paidSince=acct.filter(i=>i.member_id===p.id&&live_(i)&&i.kind!=='charge'&&i.posted>prev.period_end&&i.posted<=end).reduce((a,i)=>a+i.amount,0); const owed=r2(prev.closing-paidSince); if(owed>=25){ acctRow(Object.assign({member_id:p.id,kind:'charge',source:'fee',item:'finance',gl:itemOfId('finance').gl||'4800',ref:'fc:'+prev.id,descr:`Finance charge · 1.5% on ${fmt2(owed)} past due`,posted:end,created_at:issued},chargeFor('finance',r2(owed*.015)))); acctRow(Object.assign({member_id:p.id,kind:'charge',source:'fee',item:'late',gl:itemOfId('late').gl||'4800',ref:'lf:'+prev.id,descr:`Late fee · statement of ${dateTxt(prev.period_end)} unpaid`,posted:end,created_at:issued},chargeFor('late',25))); } }
      const all=acct.filter(i=>i.member_id===p.id&&live_(i)); const before=all.filter(i=>i.posted<start), inP=all.filter(i=>i.posted>=start&&i.posted<=end); const opening=r2(before.reduce((t,i)=>t+sign(i),0)), charges=r2(inP.filter(i=>i.kind==='charge').reduce((t,i)=>t+i.amount,0)), payments=r2(inP.filter(i=>i.kind!=='charge').reduce((t,i)=>t+i.amount,0)); if(!inP.length&&Math.abs(opening)<0.004) continue;
      const st={id:uuid(),member_id:p.id,period_start:start,period_end:end,opening,charges,payments,closing:r2(opening+charges-payments),due:addD(end,25),run_id:runId,issued_at:issued,created_by:STAFF_EMAIL,sent_at:chance(.75)?ts(addD(end,1),'08:15'):null}; stmts.push(st);
      // the member pays
      if(st.closing>0.004){ const kind=payerKind[p.id]; const when=addD(end,rint(6,22)); if(when<=TODAY){ const amt=kind==='full'?st.closing:kind==='partial'?r2(st.closing*pick([.5,.6,.75])):(chance(.35)?st.closing:0); if(amt>0.004){ const method=pick(['ACH / transfer','Check','Online card','Check']); acctRow({member_id:p.id,kind:'payment',source:'payment',item:null,gl:null,ref:null,descr:`Payment — ${method}${method==='Check'?' #'+rint(1000,9999):''}`,amount:amt,method,reference:method==='Check'?String(rint(1000,9999)):null,posted:when,created_at:ts(when,hm(rint(9,16),rint(0,59))),created_by:method==='Online card'?'member portal':'Hannah Lee'}); } } } } }
  // this month's run has gone out; a few members have already paid toward November
  // ---- registration page copy and two pending entries for the Turkey Shoot
  db=mga; const signupShare={tid:turkey.id,org:'mga',token:turkey.reg.token,status:'open',doc:signupPub(turkey),updated_at:ts(TODAY,'07:55')}; db=CLUB;
  const notIn=mgaMen.filter(p=>!turkey.field.some(f=>f.memberId===p.id)); const e1=shuffle(notIn).slice(0,3), e2=shuffle(notIn.filter(p=>!e1.includes(p))).slice(0,2);
  const signupEntries=[{id:uuid(),org:'mga',tid:turkey.id,players:e1.map(p=>({memberId:p.id,name:pname(p)})),need:0,answers:{},note:'',at:ts(addD(TODAY,-2),'19:42')},{id:uuid(),org:'mga',tid:turkey.id,players:e2.map(p=>({memberId:p.id,name:pname(p)})),need:1,answers:{},note:'Pair us with anyone who can putt.',at:ts(addD(TODAY,-1),'12:10')}];
  // ---- surveys: the shares and anonymous responses
  const surveyShares=[], surveyResponses=[];
  const respond=(org,sv,n,days)=>{ surveyShares.push({sid:sv.id,org,token:sv.token,status:sv.status,doc:surveyPub(sv),updated_at:sv.closedAt||sv.openedAt}); for(let i=0;i<n;i++){ const ans={}; sv.sections.forEach(sec=>{ sec.questions.forEach(q=>{ if(q.type==='rating') ans[q.id]=String(rint(2,5)); else if(q.type==='slider') ans[q.id]=String(rint(2,8)); else if(q.type==='choice') ans[q.id]=pick(q.options); else if(q.type==='multi') ans[q.id]=shuffle(q.options).slice(0,rint(1,2)); else if(q.type==='yesno') ans[q.id]=pick(['Yes','No','Yes']); else if(q.type==='text'&&chance(.6)) ans[q.id]=pick(['Faster service at the Turn on Saturdays.','Lights on the range.','More member-guest events.','Keep doing what you’re doing.','Fix the drainage on 11.','A kids’ menu that isn’t just chicken fingers.']); if(q.comment&&chance(.2)) ans[q.id+':c']=pick(['Great staff.','Took 25 minutes for a burger last week.','Love the new greens.']); }); if(sec.comments&&chance(.25)) ans['sec:'+sec.id]=pick(['The patio is the best thing about the club.','Thank you to the grounds crew.','The gopher problem is back.']); }); surveyResponses.push({id:uuid(),org,sid:sv.id,answers:ans,day:pick(days)}); } };
  db=CLUB; respond('club',CLUB.surveys[0],44,daysBetween('2026-10-20',TODAY)); db=mga; respond('mga',mga.surveys[0],38,daysBetween('2026-09-28','2026-10-19')); db=CLUB;

  // ================= finish the documents =================
  const stamp=d=>{ d._rev=1; d._w=CLIENT; d._at=Date.now(); return d; };
  [CLUB,mga,lga,grp].forEach(d=>{ normalize(d,{id:d.id,kind:d.kind,name:d.name,short:d.short}); if(d.golf){ d.golf.localScores={}; } });   // scores live in golf_scores
  OUT.docs={club:stamp(CLUB),mga:stamp(mga),lga:stamp(lga),czerviks:stamp(grp)};
  OUT.golfEvents=golfEvents; OUT.scores=scores; OUT.acct=acct; OUT.stmts=stmts; OUT.tickets=tickets; OUT.stations=stations;
  OUT.counters=Object.entries(counters).map(([k,n])=>{ const [outlet,day]=k.split('|'); return {outlet,day,n}; }); OUT.posDays=posDays; OUT.bookings=bookings; OUT.blocks=blocks; OUT.clock=clock;
  OUT.signupShare=signupShare; OUT.signupEntries=signupEntries; OUT.surveyShares=surveyShares; OUT.surveyResponses=surveyResponses; OUT.side=side;
  OUT.summary={members:persons.length,staff:staff.length,products:CLUB.pos.products.length,games:GAMES.length,events:golfEvents.length,scores:scores.length,acct:acct.length,stmts:stmts.length,tickets:tickets.length,bookings:bookings.length,clock:clock.length,tournaments:{mga:mga.tournaments.length,lga:lga.tournaments.length}};
  return OUT;
})()
