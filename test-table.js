// Game-table chips: #1 preflop blinds always visible (even after a fold), #3 layered street actions,
// 3-бет/4-бет/5-бет labels, and the hero «?» decision marker gated on a live question.
const fs=require('fs');const {JSDOM}=require('jsdom');
const html=fs.readFileSync(__dirname+'/poker-trainer.html','utf8');
let pass=0,fail=0;
function ok(n,c){if(c){pass++;console.log('  ok  '+n);}else{fail++;console.log('  FAIL '+n);}}
function boot(){const dom=new JSDOM(html,{runScripts:'dangerously',url:'https://danilakruzhkov-arch.github.io/poker-trainer/',pretendToBeVisual:true});return dom.window;}

console.log('== static wiring ==');
ok('streetChips helper present',                 /function streetChips\(v,pos,isHero\)/.test(html));
ok('betLabelFor names preflop 3/4/5-бет',        /street==='preflop'\?\(aggN<=1\?'Рейз':\(aggN\+1\)\+'-бет'\)/.test(html));
ok('preflop blinds pushed without a commit',      /if\(blind>0&&!committed\)chips\.push/.test(html));
ok('hero «?» chip gated on a live question',      /if\(isHero&&v\.options&&v\.options\.length\)chips\.push\(\{cls:'ask'/.test(html));
ok('profile tags moved above the plate (hero)',   /\)\.join\(''\)}<\/div>\$\{tagsHtml\}<div class="plate">/.test(html));
ok('profile tags moved above the plate (villain)',/\$\{vcHtml\}\$\{tagsHtml\}<div class="plate /.test(html));
ok('bet/raise/call share one money chip class',   /cls:money\?'bet':m\.action/.test(html));

console.log('== betLabelFor ==');
const W=boot();const ev=c=>W.eval(c);
ok("preflop open → Рейз",        ev("betLabelFor('raise',1,'preflop')")==='Рейз');
ok("preflop 2nd raise → 3-бет",  ev("betLabelFor('raise',2,'preflop')")==='3-бет');
ok("preflop 3rd raise → 4-бет",  ev("betLabelFor('raise',3,'preflop')")==='4-бет');
ok("preflop 4th raise → 5-бет",  ev("betLabelFor('raise',4,'preflop')")==='5-бет');
ok("postflop first agg → Бет",   ev("betLabelFor('bet',1,'flop')")==='Бет');
ok("postflop raise → Рейз",      ev("betLabelFor('raise',2,'flop')")==='Рейз');
ok("postflop re-raise → 3-бет",  ev("betLabelFor('raise',3,'flop')")==='3-бет');
ok("check/call/fold labels",     ev("betLabelFor('check',0,'flop')")==='Чек'&&ev("betLabelFor('call',0,'preflop')")==='Колл'&&ev("betLabelFor('fold',0,'flop')")==='Пас');

console.log('== streetChips ==');
function chips(v,pos,hero){return JSON.parse(ev(`JSON.stringify(streetChips(${JSON.stringify(v)},${JSON.stringify(pos)},${hero?'true':'false'}))`));}
const H=(rows)=>({preflop:[],flop:[],turn:[],river:[],...rows});

// #1a folded SB still shows the 0.5 blind
{ const v={players:6,street:'preflop',options:[],history:H({preflop:[{pos:'SB',action:'fold',size:''}]})};
  const c=chips(v,'SB',false);
  ok('folded SB keeps its 0.5 blind chip', c.length===1&&c[0].cls==='bet'&&/0\.5/.test(c[0].size)); }

// #1b + #3b hero BB (no action yet) facing a raise → blind 1bb then «?»
{ const v={players:6,street:'preflop',options:[{id:'o1'}],history:H({preflop:[{pos:'BTN',action:'raise',size:'2.5 bb'}]})};
  const c=chips(v,'BB',true);
  ok('hero BB shows 1bb blind then «?»', c.length===2&&/1 bb/.test(c[0].size)&&c[1].cls==='ask'&&c[1].label==='?'); }

// blind subsumed once the blind player commits (SB completes) → no extra 0.5 chip
{ const v={players:6,street:'preflop',options:[],history:H({preflop:[{pos:'SB',action:'call',size:'1 bb'}]})};
  const c=chips(v,'SB',false);
  ok('SB that completes shows only Колл (blind subsumed)', c.length===1&&c[0].label==='Колл'); }

// #3a layered actions: BB check-raises on the flop → [Чек, Рейз 9bb]
{ const v={players:6,street:'flop',options:[],history:H({flop:[{pos:'BB',action:'check',size:''},{pos:'SB',action:'bet',size:'3 bb'},{pos:'BB',action:'raise',size:'9 bb'}]})};
  const c=chips(v,'BB',false);
  ok('BB check-raise layers Чек then Рейз', c.length===2&&c[0].label==='Чек'&&c[1].label==='Рейз'&&/9 bb/.test(c[1].size)); }

// #3a 3-бет label in a preflop war; hero opened then faces the 3-bet → [Рейз 2.2, ?]
{ const v={players:6,street:'preflop',options:[{id:'o1'}],history:H({preflop:[{pos:'CO',action:'raise',size:'2.2 bb'},{pos:'BTN',action:'raise',size:'6.5 bb'}]})};
  ok('villain BTN raise labelled 3-бет', chips(v,'BTN',false)[0].label==='3-бет');
  const hc=chips(v,'CO',true);
  ok('hero CO shows its open (Рейз 2.2) then «?»', hc.length===2&&hc[0].label==='Рейз'&&/2\.2/.test(hc[0].size)&&hc[1].label==='?'); }

// preflop opener (not a blind) → single Рейз chip, no blind chip
{ const v={players:6,street:'preflop',options:[],history:H({preflop:[{pos:'CO',action:'raise',size:'2.2 bb'}]})};
  const c=chips(v,'CO',false);
  ok('non-blind opener shows a single Рейз chip', c.length===1&&c[0].label==='Рейз'); }

// no question (fullView, options:[]) → hero gets NO «?»
{ const v={players:6,street:'river',options:[],history:H({river:[{pos:'BB',action:'check',size:''}]})};
  const c=chips(v,'BB',true);
  ok('hero without a live question has no «?» chip', !c.some(x=>x.cls==='ask')); }

console.log('== «Ход розыгрыша» log reuses the same labels ==');
ok('action log calls betLabelFor', /lbl\.set\(a,betLabelFor\(a\.action,isAgg\?agg:0,st\)\)/.test(html));
{ const v={players:6,street:'preflop',options:[],history:H({preflop:[{pos:'CO',action:'raise',size:'2.2 bb'},{pos:'BTN',action:'raise',size:'6.5 bb'}]})};
  ev(`document.body.insertAdjacentHTML('beforeend','<div id="tlog"></div>');renderActionLog(${JSON.stringify(v)},'tlog');`);
  const txt=ev("document.getElementById('tlog').textContent");
  ok('log labels the 2nd preflop raise 3-бет (not Рейз)', /3-бет/.test(txt)&&/CO/.test(txt)); }

console.log('== #4 collapse/minimise the result sheet ==');
ok('minimise button lives in the verdict header', /<button class="sheetmin" id="sheetMin"/.test(html));
ok('toggle only flips a class (video never torn down)', /const c=sh\.classList\.toggle\('collapsed'\);smin\.textContent=c\?'▴':'▾';/.test(html));
ok('showSheet resets the collapsed state on each render', /sh\.classList\.remove\('collapsed'\);/.test(html));
ok('collapsed hides result + feedback, keeps the Next button', /\.sheet\.collapsed \.vtext,\.sheet\.collapsed \.vpts,\.sheet\.collapsed \.qrecap,.*\.sheet\.collapsed \.fbwrap/.test(html)&&!/\.sheet\.collapsed \.next/.test(html));
ok('collapsed shrinks the player to 0 height (audio keeps playing, not display:none)', /\.sheet\.collapsed \.expl\{height:0;min-height:0;margin:0;border:0\}/.test(html)&&!/\.sheet\.collapsed \.expl\{[^}]*display:none/.test(html));

console.log('\n'+pass+' passed, '+fail+' failed');
process.exit(fail?1:0);
