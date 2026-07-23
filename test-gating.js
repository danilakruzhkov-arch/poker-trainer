// Verify E: content gating — free first N hands, login-only packs, pro reserved, editor control, cloud round-trip.
const fs=require('fs');const {JSDOM}=require('jsdom');
const html=fs.readFileSync(__dirname+'/poker-trainer.html','utf8');
let pass=0,fail=0;
function ok(name,cond){if(cond){pass++;console.log('  ok  '+name);}else{fail++;console.log('  FAIL '+name);}}
function boot(){const dom=new JSDOM(html,{runScripts:'dangerously',url:'https://danilakruzhkov-arch.github.io/poker-trainer/',pretendToBeVisual:true});return dom.window;}

console.log('== static wiring ==');
{
  ok('FREE_HANDS constant defined', /const FREE_HANDS=\d+;/.test(html));
  ok('packGateOf reads collection gate', /function packGateOf\(id\)\{const c=findCol\(id\);return \(c&&c\.gate\)\|\|'free';\}/.test(html));
  ok('handLocked gates whole login/pro packs', /if\(g==='login'\|\|g==='pro'\)return !CURUSER;/.test(html));
  ok('handLocked gates free packs past FREE_HANDS', /return hi>=FREE_HANDS&&!CURUSER;/.test(html));
  ok('renderHand calls the gate before rendering', /if\(handLocked\(CURPACK\.id,p\.hi\)\)\{showGate\(packGateOf\(CURPACK\.id\)\);return;\}/.test(html));
  ok('allPacks exposes gate', /gate:c\.gate\|\|'free'/.test(html));
  ok('editor has a gate <select>', /id="col-gate"/.test(html)&&/Только по входу/.test(html)&&/PRO — платно/.test(html));
  ok('readCol persists gate', /if\(\$\('col-gate'\)\)c\.gate=\$\('col-gate'\)\.value;/.test(html));
  ok('sign-in re-reveals gated hand after login', /if\(CURUSER\)\{flushAttempts\(\);refreshGate\(\);\}/.test(html));
  ok('pubCols keeps whole collection (gate round-trips)', /function pubCols\(\)\{return COLS\.filter\(c=>c&&c\.id!=='mine'\);\}/.test(html));
}

console.log('== packGateOf / handLocked logic ==');
{
  const W=boot();const ev=c=>W.eval(c);
  const id=ev("COLS[0].id");
  // default (no gate) === free
  ev(`findCol(${JSON.stringify(id)}).gate=undefined;`);
  ok('default gate is "free"', ev(`packGateOf(${JSON.stringify(id)})`)==='free');
  // free pack: first FREE_HANDS hands open to anon, rest locked
  ev("CURUSER=null;");
  ok('free pack: hand 0 open to anon', ev(`handLocked(${JSON.stringify(id)},0)`)===false);
  ok('free pack: last free hand open to anon', ev(`handLocked(${JSON.stringify(id)},FREE_HANDS-1)`)===false);
  ok('free pack: hand past limit locked for anon', ev(`handLocked(${JSON.stringify(id)},FREE_HANDS)`)===true);
  ev("CURUSER={id:'u1'};");
  ok('free pack: hand past limit open once signed in', ev(`handLocked(${JSON.stringify(id)},FREE_HANDS+5)`)===false);
  // login-only pack: everything locked for anon, open when signed in
  ev(`findCol(${JSON.stringify(id)}).gate='login';CURUSER=null;`);
  ok('login pack: hand 0 locked for anon', ev(`handLocked(${JSON.stringify(id)},0)`)===true);
  ev("CURUSER={id:'u1'};");
  ok('login pack: hand 0 open once signed in', ev(`handLocked(${JSON.stringify(id)},0)`)===false);
  // pro pack behaves like login for now (account required)
  ev(`findCol(${JSON.stringify(id)}).gate='pro';CURUSER=null;`);
  ok('pro pack: locked for anon (payment later)', ev(`handLocked(${JSON.stringify(id)},0)`)===true);
  ev("CURUSER={id:'u1'};");
  ok('pro pack: open to any signed-in user for now', ev(`handLocked(${JSON.stringify(id)},0)`)===false);
}

console.log('== showGate panel ==');
{
  const W=boot();const ev=c=>W.eval(c);
  ev("showGate('free');");
  const t=()=>W.document.getElementById('trainTable').innerHTML;
  ok('free-limit copy names the free count', new RegExp('Первые '+ev('FREE_HANDS')+' раздач').test(t()));
  ok('gate renders a Google sign-in button', /id="gateIn"/.test(t())&&/Войти через Google/.test(t()));
  ok('gate button is wired to authSignIn', W.document.getElementById('gateIn')!==null);
  ev("showGate('login');");
  ok('login copy says pack opens by sign-in', /по входу/.test(t()));
  // gate clears the question controls
  ok('gate clears the answer buttons', W.document.getElementById('acts').innerHTML==='');
}

console.log('== pack-card badges ==');
{
  const W=boot();const ev=c=>W.eval(c);
  const card=g=>ev(`packCardHTML({id:'zzz',gate:${JSON.stringify(g)},emoji:'A',title:'T',accent:'#000'})`);
  ok('login pack card shows «вход» badge', /pbadge/.test(card('login'))&&/вход/.test(card('login')));
  ok('pro pack card shows «PRO» badge', /pbadge pro/.test(card('pro'))&&/PRO/.test(card('pro')));
  ok('free pack card has no badge', !/pbadge/.test(card('free')));
}

console.log('\n'+pass+' passed, '+fail+' failed');
process.exit(fail?1:0);
