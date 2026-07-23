// Verify the batch-2 UI fixes headlessly (sizes, table pills, face-down cards, feedback, pack hide, video timer helpers).
const fs=require('fs');const {JSDOM}=require('jsdom');
const html=fs.readFileSync(__dirname+'/poker-trainer.html','utf8');
let pass=0,fail=0;
function ok(name,cond){if(cond){pass++;console.log('  ok  '+name);}else{fail++;console.log('  FAIL '+name);}}
function boot(){const dom=new JSDOM(html,{runScripts:'dangerously',url:'https://danilakruzhkov-arch.github.io/poker-trainer/',pretendToBeVisual:true});return dom.window;}

// ---- #1 size display: bb primary, % of pot in parens, postflop only; Nx -> bb; all-in label ----
{
  const W=boot();const ev=c=>W.eval(c);
  ok('sizeBBpct bb+% postflop', ev("sizeBBpct('9 bb',12,true)")==='9 bb <span class="pct">(75%)</span>');
  ok('sizeBBpct % -> bb+%', ev("sizeBBpct('50%',12,true)")==='6 bb <span class="pct">(50%)</span>');
  ok('sizeBBpct Nx -> bb (no %) preflop', ev("sizeBBpct('3x',1.5,false)")==='3 bb');
  ok('sizeBBpct preflop hides %', ev("sizeBBpct('8 bb',1.5,false)")==='8 bb');
  ok('sizeBBpct all-in label', ev("sizeBBpct('олл‑ин',20,true)")==='олл‑ин');
  ok('sizeBBpct empty -> empty', ev("sizeBBpct('',12,true)")==='');
  ok('optSizeHTML wraps with num span', /class="u num"/.test(ev("optSizeHTML({size:'9 bb'},{street:'flop',history:{preflop:[],flop:[],turn:[],river:[]}})")));
}

// ---- #4 recap row: no «Тренер» chip; size uses bb+% ----
{
  const W=boot();const ev=c=>W.eval(c);
  const row=ev("optRecapRow({id:'o1',label:'Бет',type:'bet',size:'50%',grade:'best'},'o1','o2',12,'flop')");
  ok('recap row omits Тренер chip', !/Тренер/.test(row));
  ok('recap row keeps Ты chip when picked', /qc you/.test(row));
  ok('recap row shows bb+% size', /6 bb/.test(row)&&/50%/.test(row));
  ok('recap picked row has picked class (grade-coloured via CSS)', /qr-opt g-best picked/.test(row));
}

// ---- #2 table pill: only the CURRENT street's action shows; prior-street check does NOT ----
{
  const W=boot();const ev=c=>W.eval(c);
  // BTN checked on the flop; hero (UTG) is first to act on the river -> BTN must have NO pill on river
  const v="({players:6,heroPos:'UTG',street:'river',stacks:{},profiles:{},history:{preflop:[{pos:'UTG',action:'raise',size:'2 bb'},{pos:'BTN',action:'call',size:'2 bb'}],flop:[{pos:'UTG',action:'check'},{pos:'BTN',action:'check'}],turn:[{pos:'UTG',action:'check'},{pos:'BTN',action:'check'}],river:[]}})";
  ok('BTN pill is null on river (first to act)', ev("seatState("+v+").BTN.act")===null);
  ok('BTN not folded (still live)', ev("seatState("+v+").BTN.folded")===false);
  // now BTN bets the river -> pill should appear
  const v2="({players:6,heroPos:'UTG',street:'river',stacks:{},profiles:{},history:{preflop:[{pos:'UTG',action:'raise',size:'2 bb'},{pos:'BTN',action:'call',size:'2 bb'}],flop:[],turn:[],river:[{pos:'BTN',action:'bet',size:'4 bb'}]}})";
  ok('BTN pill shows river bet', ev("(seatState("+v2+").BTN.act||{}).action")==='bet');
}

// ---- #3 face-down cards: live villain gets .cback backs; folded villain does not ----
{
  const W=boot();const ev=c=>W.eval(c);
  ev("switchView('train')");
  ev("(function(){var c=document.createElement('div');c.id='__t';document.body.appendChild(c);var v={players:6,heroPos:'UTG',street:'river',stacks:{},profiles:{},board:['9h','5s','2d','Jc','Qs'],heroCards:['Ah','Kh'],cards:{},contrib:{},history:{preflop:[{pos:'UTG',action:'raise',size:'2 bb'},{pos:'BTN',action:'call',size:'2 bb'},{pos:'CO',action:'fold'}],flop:[],turn:[],river:[]}};renderTable(c,v,false);})()");
  ok('live BTN villain shows face-down backs', ev("document.querySelectorAll('#__t .cback').length")>=2);
}

// ---- #8 pack hide: hidden col drops from home library, stays in COLS/editor ----
{
  const W=boot();const ev=c=>W.eval(c);
  const before=ev("allPacks().filter(p=>!p.hidden).length");
  ev("(function(){var c=findCol('wsop');c.hidden=true;})()");
  ok('hiding a pack removes it from the visible library', ev("allPacks().filter(p=>!p.hidden).length")===before-1);
  ok('hidden pack still present in COLS', ev("!!findCol('wsop')"));
  ev("renderHome()");
  ok('renderHome omits the hidden pack button', ev("!document.querySelector('#homeScreen [data-pack=\"wsop\"]')"));
}

// ---- #6 video timer helpers ----
{
  const W=boot();const ev=c=>W.eval(c);
  ok('fmtCountdown mm:ss', ev("fmtCountdown(125)")==='2:05');
  ok('fmtCountdown clamps at 0', ev("fmtCountdown(-3)")==='0:00');
  ok('TIMERON defaults on', ev("TIMERON")===true);
  ok('embed URL adds modestbranding', /modestbranding=1/.test(html)&&/iv_load_policy=3/.test(html));
}

console.log('\nRESULT: '+pass+' passed, '+fail+' failed');
process.exit(fail?1:0);
