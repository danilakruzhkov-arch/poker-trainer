// Exercise the 4 new editor UI features headlessly (browser scroll is flaky).
const fs=require('fs');const {JSDOM}=require('jsdom');
const html=fs.readFileSync(__dirname+'/poker-trainer.html','utf8');
let pass=0,fail=0;
function ok(name,cond){if(cond){pass++;console.log('  ok  '+name);}else{fail++;console.log('  FAIL '+name);}}
function boot(){const dom=new JSDOM(html,{runScripts:'dangerously',url:'https://danilakruzhkov-arch.github.io/poker-trainer/',pretendToBeVisual:true});return dom.window;}

// ---- Feature 4: size helpers + action dropdown mapping ----
{
  const W=boot();const ev=c=>W.eval(c);
  ok('normSizeBB bare number -> bb (not chips)', ev("normSizeBB('10')")==='10 bb');
  ok('normSizeBB comma decimal', ev("normSizeBB('8,5')")==='8.5 bb');
  ok('normSizeBB percent passthrough', ev("normSizeBB('50%')")==='50%');
  ok('normSizeBB multiplier passthrough', ev("normSizeBB('3x')")==='3x');
  ok('normSizeBB all-in', ev("normSizeBB('олл‑ин')")===ev('ALLIN'));
  ok('optActVal Пас->fold', ev("optActVal({label:'Пас',type:'fold'})")==='fold');
  ok('optActVal legacy Фолд->fold', ev("optActVal({label:'Фолд',type:'fold'})")==='fold');
  ok('optActVal Бет->bet', ev("optActVal({label:'Бет',type:'bet',size:'33%'})")==='bet');
  ok('optActVal 3-бет preserved', ev("optActVal({label:'3-бет',type:'raise',size:'8 bb'})")==='3bet');
  ok('optActVal all-in by size', ev("optActVal({label:'Рейз',type:'raise',size:'олл‑ин'})")==='allin');
  ok('optActMeta bet is sized', ev("optActMeta('bet').sized")===true);
  ok('optActMeta check not sized', ev("!optActMeta('check').sized")===true);
  ok('optActMeta fold not sized', ev("!optActMeta('fold').sized")===true);
}

// ---- Feature 4: optRow renders a dropdown; size field only for sized actions ----
{
  const W=boot();const ev=c=>W.eval(c);
  const rowRaise=ev("optRow(0,{id:'o1',label:'Рейз',type:'raise',size:'8 bb',grade:'best',hero:false},'preflop',10)");
  ok('optRow raise has op-act select', /class="op-act"/.test(rowRaise));
  ok('optRow raise has op-size input', /class="op-size"/.test(rowRaise));
  ok('optRow raise value shows 8 bb', /value="8 bb"/.test(rowRaise));
  const rowFold=ev("optRow(1,{id:'o2',label:'Пас',type:'fold',size:'',grade:'mistake',hero:false},'preflop',10)");
  ok('optRow fold has NO size input', !/class="op-size"/.test(rowFold));
  ok('optRow fold marked noSize', /optline noSize/.test(rowFold));
  const rowHero=ev("optRow(2,{id:'o3',label:'Колл',type:'call',size:'7 bb',grade:'ok',hero:true},'preflop',10)");
  ok('optRow hero stays static (no dropdown)', !/class="op-act"/.test(rowHero)&&/op-static/.test(rowHero));
}

// ---- Feature 4: numeric bb round-trips through readForm even in chips mode (the reported bug) ----
{
  const W=boot();const ev=c=>W.eval(c);
  ev("switchView('admin')");
  // build a hand in CHIPS mode with a raise question, then simulate typing '10' into an option size
  ev("F=blankHand();F.unit='chips';F.bbChips='1500';F.heroPos='CO';F.players=9;F.cards={CO:['Ad','Kh']};F.heroCards=['Ad','Kh'];");
  ev("F.actions=[{street:'preflop',pos:'CO',action:'raise',size:'3 bb',q:{options:[O('o1','Рейз','raise','best','3 bb',true),O('o2','Рейз','raise','ok','8 bb',false),O('o3','Пас','fold','mistake','',false)],vStart:10,vEnd:20,depth:'коротко',explain:'',joinPrev:false,contPrev:false}}];F.curQ=0;");
  ev("buildForm()");
  // hand = [hero-raise, raise, fold]: only the non-hero raise gets a size input (hero is static, fold is noSize)
  const sizes=ev("[...document.querySelectorAll('#f-options .op-size')].length");
  ok('chips-mode: the non-hero raise renders exactly one size input', sizes===1);
  // type '10' into the 2nd option's size input (index 1 among sized rows) and read back
  ev("(function(){var inp=document.querySelectorAll('#f-options .optline')[1].querySelector('.op-size');inp.value='10';})()");
  ev("readForm()");
  ok('chips-mode: typing 10 -> "10 bb" (NOT 0 bb)', ev("curQEntry().q.options[1].size")==='10 bb');
}

// ---- Feature 3: 2-option mode keeps hero + shrinks correctly ----
{
  const W=boot();const ev=c=>W.eval(c);
  ev("switchView('admin')");
  ev("F=blankHand();F.heroPos='CO';F.players=9;F.cards={CO:['Ad','Kh']};F.heroCards=['Ad','Kh'];F.actions=[{street:'preflop',pos:'CO',action:'raise',size:'2 bb',q:{options:[O('o1','Рейз','raise','best','2 bb',true),O('o2','Колл','call','ok','',false),O('o3','Пас','fold','mistake','',false)],vStart:5,vEnd:9,depth:'коротко',explain:'',joinPrev:false,contPrev:false}}];F.curQ=0;buildForm();");
  ok('optcount seg has a "2" button', ev("!!document.querySelector('#f-optcount button[data-c=\"2\"]')"));
  ev("document.querySelector('#f-optcount button[data-c=\"2\"]').click()");
  ok('shrink to 2 leaves exactly 2 options', ev("curQEntry().q.options.length")===2);
  ok('shrink to 2 keeps the hero option', ev("curQEntry().q.options.some(o=>o.hero)"));
}

// ---- Feature 2: hidden hands drop from the drill but stay in the set ----
{
  const W=boot();const ev=c=>W.eval(c);
  const before=ev("packHands('ft10k').length");
  ok('ft10k has hands', before>0);
  ev("(function(){var c=findCol('ft10k');c.hands[0].hidden=true;})()");
  const after=ev("packHands('ft10k').length");
  ok('hiding one hand removes exactly one from the drill', after===before-1);
  ok('hidden hand still present in the collection', ev("findCol('ft10k').hands.length")===before);
}

// ---- Feature 2: renderSet shows hide button + pale row + header count ----
{
  const W=boot();const ev=c=>W.eval(c);
  ev("switchView('admin');useCol(COLS.findIndex(c=>c.id==='ft10k'));SET[0].hidden=true;renderSet();");
  ok('renderSet emits sethdr', ev("!!document.querySelector('#setList .sethdr')"));
  ok('renderSet emits a hide button', ev("!!document.querySelector('#setList [data-hide]')"));
  ok('hidden row gets hidden-h class', ev("!!document.querySelector('#setList .setrow.hidden-h')"));
  ok('header reports the hidden count', /скрыто/.test(ev("document.querySelector('#setList .sethdr').textContent")));
}

// ---- Feature 1: collapse state persists across buildForm + reload ----
{
  const W=boot();const ev=c=>W.eval(c);
  ev("switchView('admin');buildForm();");
  ok('block 0 has data-sec=col', ev("!!document.querySelector('#adForm [data-sec=\"col\"]')"));
  ok('preview has data-sec=pv', ev("!!document.querySelector('#view-admin [data-sec=\"pv\"]')"));
  ok('setList has data-sec=set', ev("document.getElementById('setList').getAttribute('data-sec')")==='set');
  // collapse the "col" section via the persisted state + rebuild
  ev("_ui.collapsed.col=true;saveUI();buildForm();");
  ok('collapsed class applied to col after rebuild', ev("document.querySelector('#adForm [data-sec=\"col\"]').classList.contains('collapsed')"));
  ok('collapse state written to localStorage', /"col":true/.test(ev("localStorage.getItem('pk_ui')||''")));
  // switching hands (buildForm again) must keep it collapsed
  ev("buildForm()");
  ok('collapse survives a hand switch', ev("document.querySelector('#adForm [data-sec=\"col\"]').classList.contains('collapsed')"));
}

console.log('\nRESULT: '+pass+' passed, '+fail+' failed');
process.exit(fail?1:0);
