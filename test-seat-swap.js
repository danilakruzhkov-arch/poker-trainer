// Verify item (3): reseat players with the ▲▼ arrows — the whole occupant (cards, stack, profile, every action,
// the hero mark) travels with the seat; an illegal resulting order (a raiser landing behind a caller) lights up as
// a row error via resolve, and the hand is never frozen by the move. The swap is its own inverse.
const fs=require('fs');const {JSDOM}=require('jsdom');
const html=fs.readFileSync(__dirname+'/poker-trainer.html','utf8');
let pass=0,fail=0;
function ok(name,cond){if(cond){pass++;console.log('  ok  '+name);}else{fail++;console.log('  FAIL '+name);}}
function boot(){const dom=new JSDOM(html,{runScripts:'dangerously',url:'https://danilakruzhkov-arch.github.io/poker-trainer/',pretendToBeVisual:true});return dom.window;}

console.log('== static wiring ==');
{
  ok('swapSeats function defined', /function swapSeats\(hand,a,b\)\{/.test(html));
  ok('swapSeats moves cards/stacks/profiles', /sw\(hand\.cards\);sw\(hand\.stacks\);sw\(hand\.profiles\);/.test(html));
  ok('swapSeats relabels every action', /\(hand\.actions\|\|\[\]\)\.forEach\(x=>\{if\(x\.pos===a\)x\.pos=b;else if\(x\.pos===b\)x\.pos=a;\}\);/.test(html));
  ok('swapSeats carries the hero mark', /if\(hand\.heroPos===a\)hand\.heroPos=b;else if\(hand\.heroPos===b\)hand\.heroPos=a;/.test(html));
  ok('swapSeats re-syncs the hero-cards mirror', /hand\.heroCards=\(hc&&\(hc\[0\]\|\|hc\[1\]\)\)\?hc\.slice\(\):\['',''\];/.test(html));
  ok('player row renders ▲▼ reseat arrows', /class="smv" data-mv="up"/.test(html)&&/class="smv" data-mv="dn"/.test(html));
  ok('first row up-arrow disabled, last row down-arrow disabled', /data-mv="up" data-pos="\$\{p\}" \$\{idx===0\?'disabled':''\}/.test(html)&&/data-mv="dn" data-pos="\$\{p\}" \$\{idx===last\?'disabled':''\}/.test(html));
  ok('arrows wired to swapSeats + rebuild', /\.smv'\)\.forEach\(b=>b\.onclick=\(\)=>\{readForm\(\);const ord=dispOrder\(F\.players\)/.test(html)&&/swapSeats\(F,ord\[i\],ord\[j\]\);buildForm\(\);/.test(html));
  ok('reseat arrow CSS present', /\.seatmv \.smv\{/.test(html));
}

function res(W,h){return W.eval('resolve('+JSON.stringify(h)+')');}
const HAND={players:6,heroPos:'BTN',heroCards:['Ah','Kh'],cards:{BTN:['Ah','Kh'],CO:['Qs','Qd']},
  stacks:{UTG:50,CO:55,BTN:60},profiles:{CO:{status:'reg',style:'aggr'}},board:['2c','7d','Ts','',''],video:{url:''},
  actions:[{street:'preflop',pos:'UTG',action:'raise',size:'2.5'},{street:'preflop',pos:'CO',action:'call'},{street:'preflop',pos:'BTN',action:'call'},
    {street:'flop',pos:'UTG',action:'check'},{street:'flop',pos:'CO',action:'bet',size:'3 bb'},{street:'flop',pos:'BTN',action:'call'}]};

console.log('== the occupant travels with the seat ==');
{
  const W=boot();
  W.eval('window.__h='+JSON.stringify(HAND)+';swapSeats(window.__h,"CO","BTN");');
  const h=W.eval('JSON.parse(JSON.stringify(window.__h))');
  ok('cards swapped (BTN gets Qs/Qd, CO gets Ah/Kh)', h.cards.BTN[0]==='Qs'&&h.cards.CO[0]==='Ah');
  ok('stacks swapped (BTN 55, CO 60)', h.stacks.BTN===55&&h.stacks.CO===60);
  ok('profile travelled to BTN', h.profiles.BTN&&h.profiles.BTN.status==='reg'&&!h.profiles.CO);
  ok('every CO action became BTN and vice-versa', h.actions.filter(a=>a.pos==='CO').length===2&&h.actions.filter(a=>a.pos==='BTN').length===2&&h.actions.filter(a=>a.pos==='UTG').length===2);
  ok('the hero mark followed the player (BTN → CO)', h.heroPos==='CO');
  ok('hero-cards mirror re-synced to the new hero seat', h.heroCards[0]==='Ah'&&h.heroCards[1]==='Kh');
}

console.log('== illegal order lights up, hand stays live ("не стопорит") ==');
{
  const W=boot();
  const before=res(W,HAND);
  ok('legal starting hand has zero errors', before.rows.filter(r=>r.error).length===0);
  ok('legal starting hand is not over', before.handOver===false);
  W.eval('window.__h='+JSON.stringify(HAND)+';swapSeats(window.__h,"CO","BTN");');
  const after=res(W,W.eval('window.__h'));
  const errRows=after.rows.filter(r=>r.error);
  ok('reseat that puts the bettor behind the caller flags an error', errRows.length===1);
  ok('the flagged error is the "call with no bet" case', /ставки нет/.test(errRows[0].error));
  ok('the error sits on the caller row (CO)', errRows[0].pos==='CO');
  ok('the hand is NOT frozen after the reseat (still has a frontier)', !!after.frontier&&after.handOver===false);
  ok('resolve still throws no exception and yields rows', after.rows.length>0);
}

console.log('== the reseat is reversible ==');
{
  const W=boot();
  W.eval('window.__h='+JSON.stringify(HAND)+';swapSeats(window.__h,"CO","BTN");swapSeats(window.__h,"CO","BTN");');
  const back=W.eval('JSON.parse(JSON.stringify(window.__h))');
  ok('two swaps restore heroPos', back.heroPos==='BTN');
  ok('two swaps restore cards', back.cards.BTN[0]==='Ah'&&back.cards.CO[0]==='Qs');
  ok('two swaps restore stacks', back.stacks.CO===55&&back.stacks.BTN===60);
  ok('two swaps restore a clean (error-free) replay', res(W,back).rows.filter(r=>r.error).length===0);
}

console.log('== timeline renders the error highlight the reseat produces ==');
{
  const W=boot();
  // drive the real editor: load the hand into F, swap via the seat-move helper, rebuild the form, read the DOM.
  W.eval('F='+JSON.stringify(HAND)+';swapSeats(F,"CO","BTN");buildForm();');
  const tl=W.document.querySelector('#adForm .tl');
  ok('a timeline row carries the .bad error class', /class="tlrow[^"]*\bbad\b/.test(W.eval("document.querySelector('#adForm').innerHTML")));
  ok('the ⚠ error note text is shown to the user', /ставки нет/.test(tl?tl.textContent:'')&&/поправь действие или размер/.test(tl?tl.textContent:''));
  ok('the reseat did not empty the timeline (players not stopped)', tl&&tl.querySelectorAll('.tlrow').length>=3);
}

console.log('\n'+pass+' passed, '+fail+' failed');
process.exit(fail?1:0);
