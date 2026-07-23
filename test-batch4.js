// Verify batch-4: A feedback form hidden, B timer always-on, F smart street context, G all-in/call sizes, 3c stats.
const fs=require('fs');const {JSDOM}=require('jsdom');
const html=fs.readFileSync(__dirname+'/poker-trainer.html','utf8');
let pass=0,fail=0;
function ok(name,cond){if(cond){pass++;console.log('  ok  '+name);}else{fail++;console.log('  FAIL '+name);}}
function boot(){const dom=new JSDOM(html,{runScripts:'dangerously',url:'https://danilakruzhkov-arch.github.io/poker-trainer/',pretendToBeVisual:true});return dom.window;}

console.log('== A: feedback form collapsed by default ==');
{
  ok('fbForm carries the hidden attribute', /<div class="fbform" id="fbForm" hidden>/.test(html));
  ok('CSS overrides display for [hidden] (specificity fix)', /\.fbform\[hidden\]\{display:none\}/.test(html));
  ok('toggle reveals it (form.hidden=false)', /tog\.onclick=\(\)=>\{form\.hidden=false/.test(html));
}

console.log('== B: segment timer always on, no toggle ==');
{
  ok('TIMERON is a const true', /const TIMERON=true;/.test(html));
  ok('no «Таймер отрезка» button', !/Таймер отрезка/.test(html));
  ok('no sheetTimer element/handler', !/sheetTimer/.test(html));
  ok('setTimerOn removed', !/setTimerOn/.test(html));
  const W=boot();ok('TIMERON evaluates true', W.eval('TIMERON')===true);
}

console.log('== F: smart street context (ctxText) ==');
{
  const W=boot();const ev=c=>W.eval(c);
  const call=(o)=>ev('ctxText('+JSON.stringify(o)+')');
  // preflop: hero opened, villain 3-bet -> mentions BOTH, names the level
  let t=call({heroPos:'BB',street:'preflop',board:[],heroCards:[],history:{preflop:[{pos:'BB',action:'raise',size:'2.5'},{pos:'BTN',action:'raise',size:'8'}],flop:[],turn:[],river:[]}});
  ok('hero open shown ("Ты открываешь до 2.5")', /Ты открываешь до 2\.5/.test(t));
  ok('villain re-raise named as 3-бет ("BTN 3-бетит до 8")', /BTN 3-бетит до 8/.test(t));
  // preflop: hero 3-bet, villain 4-bet
  t=call({heroPos:'SB',street:'preflop',board:[],heroCards:[],history:{preflop:[{pos:'BTN',action:'raise',size:'2.5'},{pos:'SB',action:'raise',size:'9'},{pos:'BTN',action:'raise',size:'22'}],flop:[],turn:[],river:[]}});
  ok('hero 3-bet shown ("Ты 3-бетишь до 9")', /Ты 3-бетишь до 9/.test(t));
  ok('villain 4-bet named ("BTN 4-бетит до 22")', /BTN 4-бетит до 22/.test(t));
  // postflop: hero checked, villain bets
  t=call({heroPos:'BB',street:'flop',board:[],heroCards:[],history:{preflop:[],flop:[{pos:'BB',action:'check'},{pos:'BTN',action:'bet',size:'5 bb'}],turn:[],river:[]}});
  ok('hero check + villain bet ("Ты чекаешь, BTN ставит 5 bb")', /Ты чекаешь/.test(t)&&/BTN ставит 5 bb/.test(t));
  // plain preflop open (hero not yet acted) still works
  t=call({heroPos:'BB',street:'preflop',board:[],heroCards:[],history:{preflop:[{pos:'BTN',action:'raise',size:'2.5'}],flop:[],turn:[],river:[]}});
  ok('villain open when hero has not acted', /BTN открывает до 2\.5/.test(t));
}

console.log('== G: all-in & call option sizes ==');
{
  const W=boot();const ev=c=>W.eval(c);
  const size=(o,v)=>ev('optSizeHTML('+JSON.stringify(o)+','+JSON.stringify(v)+')');
  // all-in -> hero's remaining stack
  let s=size({type:'raise',allin:true,label:'Олл-ин'},{heroPos:'BTN',stacks:{BTN:40},contrib:{BTN:0},street:'flop',history:{flop:[]}});
  ok('all-in shows remaining stack (40 bb)', /40 bb/.test(s));
  // all-in with chips already in -> stack minus contrib
  s=size({type:'raise',allin:true,label:'Олл-ин'},{heroPos:'BTN',stacks:{BTN:40},contrib:{BTN:6},street:'flop',history:{flop:[]}});
  ok('all-in nets prior contrib (34 bb)', /34 bb/.test(s));
  // call facing a preflop 3-bet -> amount to match
  s=size({type:'call',label:'Колл'},{heroPos:'BB',street:'preflop',stacks:{},contrib:{},history:{preflop:[{pos:'BB',action:'raise',size:'2.5'},{pos:'BTN',action:'raise',size:'8'}]}});
  ok('call shows amount to match (5.5 bb)', /5\.5 bb/.test(s));
  // ordinary bet size untouched
  s=size({type:'bet',size:'5 bb'},{street:'flop',heroPos:'BB',history:{flop:[]}});
  ok('plain bet size preserved', /5/.test(s));
  // check/fold options carry no size
  ok('check has no size', size({type:'check',label:'Чек'},{street:'flop',heroPos:'BB',history:{flop:[]}})==='');
}

console.log('== 3c: stats aggregation (renderStats) ==');
{
  const W=boot();const ev=c=>W.eval(c);
  ev("renderStats([{pack:'a',pack_title:'Пак А',grade:'best'},{pack:'a',pack_title:'Пак А',grade:'best'},{pack:'a',pack_title:'Пак А',grade:'mistake'},{pack:'b',pack_title:'Пак Б',grade:'ok'}])");
  const h=()=>W.document.getElementById('statsBody').innerHTML;
  ok('overall accuracy = 50% (2 best of 4)', /50%/.test(h()));
  ok('best/ok/mistake counts shown', /g-best">2</.test(h())&&/g-ok">1</.test(h())&&/g-mistake">1</.test(h()));
  ok('total shown (4)', /из 4/.test(h()));
  ok('per-pack rows render', /Пак А/.test(h())&&/Пак Б/.test(h()));
  ev("renderStats([])");
  ok('empty state message', /Пока нет ответов/.test(h()));
  // stats button appears only when signed in
  ev("window.supabase={createClient:()=>({auth:{getSession:async()=>({data:{session:null}}),onAuthStateChange:()=>{},signInWithOAuth:async()=>{},signOut:async()=>{}}})};_sb=null;");
  ev("CURUSER={email:'x@y.com',user_metadata:{full_name:'X'}};renderAuth();");
  ok('«Статистика» button shown when signed in', /authStat/.test(W.document.getElementById('authSlot').innerHTML));
  ev("CURUSER=null;renderAuth();");
  ok('no «Статистика» button when signed out', !/authStat/.test(W.document.getElementById('authSlot').innerHTML));
}

console.log('\n'+pass+' passed, '+fail+' failed');
process.exit(fail?1:0);
