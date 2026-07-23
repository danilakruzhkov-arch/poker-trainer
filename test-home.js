// Home library card: hidden hands drop from BOTH counts; the card description is a single source (intro.text).
const fs=require('fs');const {JSDOM}=require('jsdom');
const html=fs.readFileSync(__dirname+'/poker-trainer.html','utf8');
let pass=0,fail=0;
function ok(n,c){if(c){pass++;console.log('  ok  '+n);}else{fail++;console.log('  FAIL '+n);}}
function boot(){const dom=new JSDOM(html,{runScripts:'dangerously',url:'https://danilakruzhkov-arch.github.io/poker-trainer/',pretendToBeVisual:true});return dom.window;}
const Q=lbl=>({options:[{id:'o1',hero:true,label:lbl,type:'raise',size:'11',grade:'best'},{id:'o2',label:'Пас',type:'fold',grade:'ok'}],vStart:0,vEnd:0,depth:'x',explain:'x'});
const HAND=(lbl,hidden)=>({players:6,heroPos:'BB',heroCards:['Ah','Kh'],cards:{BB:['Ah','Kh']},stacks:{BB:50},profiles:{},board:['','','','',''],video:{url:''},hidden:!!hidden,
  actions:[{street:'preflop',pos:'BTN',action:'raise',size:'2.5'},{street:'preflop',pos:'BB',action:'raise',size:'11',q:Q(lbl)}]});

console.log('== static wiring ==');
ok('packStats excludes hidden hands', /function packStats/.test(html) && /c\.hands\.filter\(h=>!h\.hidden\)/.test(html));
ok('card description = intro.text (fallback sub)', /p\.intro&&p\.intro\.text&&p\.intro\.text\.trim\(\)\)\?p\.intro\.text:\(p\.sub/.test(html));
ok('.psub is line-clamped', /-webkit-line-clamp/.test(html));

console.log('== «Автовидео» lives under the video only (intro + review sheet) ==');
ok('intro clip row carries an Автовидео toggle', /<div class="cliprow"><span class="clip-slot"><\/span><button class="vauto \$\{AUTOPLAY\?'on':''\}" id="introAuto"/.test(html));
// the back-row toggle above the table was removed — it duplicated the one under the video on the drill screen
ok('backrow toggle is gone from the drill screen', !/autoToggle/.test(html)&&/<div class="backrow"><button class="backbtn" id="toHome">← Подборки<\/button><div class="bt" id="drillTitle"><\/div><\/div>/.test(html));
ok('introAuto shares the sheet toggle handler', /const ia=\$\('introAuto'\);if\(ia\)ia\.onclick=toggleAutoplay;/.test(html));

console.log('== behavior ==');
{ const W=boot();const ev=c=>W.eval(c);
  ev(`COLS=[{id:'t',name:'T',emoji:'x',accent:'#000',sub:'SUBTEXT',intro:{title:'IT',text:'INTROTEXT',video:{url:''}},
    hands:[${JSON.stringify(HAND('A',false))},${JSON.stringify(HAND('B',false))},${JSON.stringify(HAND('C',true))}]}];useCol(0);`);
  const st=JSON.parse(ev('JSON.stringify(packStats("t"))'));
  ok('packStats counts only 2 visible hands (1 hidden)', st.hands===2);
  ok('packStats questions come from visible hands only', st.questions===2);
  const card=ev(`packCardHTML(allPacks().find(p=>p.id==='t'))`);
  ok('card renders intro.text, not sub', card.indexOf('INTROTEXT')>=0 && card.indexOf('SUBTEXT')<0);
  ok('card meta shows "2 разд."', /2 разд\./.test(card));
}
{ const W=boot();const ev=c=>W.eval(c);
  ev(`COLS=[{id:'u',name:'U',emoji:'x',accent:'#000',sub:'ONLYSUB',intro:{title:'IT',text:'',video:{url:''}},hands:[${JSON.stringify(HAND('A',false))}]}];useCol(0);`);
  const card=ev(`packCardHTML(allPacks().find(p=>p.id==='u'))`);
  ok('card falls back to sub when intro.text is empty', card.indexOf('ONLYSUB')>=0);
}
console.log('\n'+pass+' passed, '+fail+' failed');
process.exit(fail?1:0);
