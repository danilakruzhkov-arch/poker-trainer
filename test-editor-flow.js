// Verify item (2): deleting/editing an action in the editor no longer freezes the hand with auto-passives.
// - deleting the last authored action reopens the «＋ ход» frontier (does not insert a passive in its place)
// - deleting a middle action peels the now-trailing authored passives so the add-move point re-appears
// - trimming only removes passives the engine reproduces on its own → the RESOLVED hand is unchanged
// - turning a seat into a raise drops the stale passives behind it so following seats re-face the new bet
const fs=require('fs');const {JSDOM}=require('jsdom');
const html=fs.readFileSync(__dirname+'/poker-trainer.html','utf8');
let pass=0,fail=0;
function ok(name,cond){if(cond){pass++;console.log('  ok  '+name);}else{fail++;console.log('  FAIL '+name);}}
function boot(){const dom=new JSDOM(html,{runScripts:'dangerously',url:'https://danilakruzhkov-arch.github.io/poker-trainer/',pretendToBeVisual:true});return dom.window;}

// resolved fingerprint: the ordered list of (street,pos,action) for every seat that acts (authored or auto).
// If trimming authored passives leaves this unchanged, we've only removed redundant explicit rows.
function fp(W,hand){return W.eval('resolve('+JSON.stringify(hand)+').rows.map(r=>r.street[0]+":"+r.pos+"="+r.action).join(" ")');}
function frontier(W,hand){return W.eval('(function(){var r=resolve('+JSON.stringify(hand)+');return r.frontier?(r.frontier.street+"/"+r.frontier.nextToAct):(r.handOver?"OVER":"NONE");})()');}
function addBtn(W,hand){return W.eval('(function(){var r=resolve('+JSON.stringify(hand)+');return !!(r.frontier&&!r.handOver);})()');}

console.log('== static wiring ==');
{
  ok('delete handler peels trailing passives', /F\.actions\.splice\(\+b\.dataset\.delact,1\);trimTrailingPassives\(F\);/.test(html));
  ok('ta-act raise drops stale passives behind the seat', /if\(a\.action==='raise'\)dropPassivesAfter\(F,a\);/.test(html));
  ok('trimTrailingPassives protects question rows', /\(last\.action==='check'\|\|last\.action==='fold'\)&&!last\.ref\.q/.test(html));
  ok('dropPassivesAfter protects question rows', /\(x\.action==='check'\|\|x\.action==='fold'\)&&!x\.q/.test(html));
}

console.log('== delete the LAST authored action → frontier reopens (user\'s exact ask) ==');
{
  const W=boot();
  // 6-max, hero BB. UTG raise, MP call, CO call — all active, CO is last.
  const base={players:6,heroPos:'BB',heroCards:['Ah','Kh'],cards:{},stacks:{},profiles:{},board:['','','','',''],video:{url:''},
    actions:[{street:'preflop',pos:'UTG',action:'raise',size:'2.5'},{street:'preflop',pos:'MP',action:'call'},{street:'preflop',pos:'CO',action:'call'}]};
  ok('baseline already has a frontier (nobody frozen)', addBtn(W,base)===true);
  // delete CO call (index 2) — the real handler: splice then trim
  const h=JSON.parse(JSON.stringify(base));h.actions.splice(2,1);W.eval('trimTrailingPassives('+JSON.stringify(h)+')'); // trim is a no-op here (last is active MP call)
  // emulate handler mutation locally too
  const h2=JSON.parse(JSON.stringify(base));h2.actions.splice(2,1);
  ok('after deleting the last active action, add-move is available', addBtn(W,h2)===true);
  ok('no passive was inserted in its place (only 2 authored rows remain)', W.eval('resolve('+JSON.stringify(h2)+').rows.filter(r=>r.ref).length')===2);
}

console.log('== delete a MIDDLE action from a completed fold-out → un-freezes ==');
{
  const W=boot();
  // complete 3-bet fold-out: UTG raise, MP call, hero BB 3-bet(Q), UTG fold, MP fold → BB wins (handOver)
  const C={players:6,heroPos:'BB',heroCards:['Ah','Kh'],cards:{},stacks:{},profiles:{},board:['','','','',''],video:{url:''},
    actions:[{street:'preflop',pos:'UTG',action:'raise',size:'2.5'},{street:'preflop',pos:'MP',action:'call'},
      {street:'preflop',pos:'BB',action:'raise',size:'11',q:{options:[{hero:true,type:'raise',size:'11',grade:'best'}]}},
      {street:'preflop',pos:'UTG',action:'fold'},{street:'preflop',pos:'MP',action:'fold'}]};
  ok('baseline fold-out is over (no frontier)', frontier(W,C)==='OVER');
  // BUG BEFORE FIX: deleting MP call (index 1) with the trailing folds still authored keeps it frozen.
  const buggy=JSON.parse(JSON.stringify(C));buggy.actions.splice(1,1);
  ok('deleting middle WITHOUT trim stays frozen (the old bug)', addBtn(W,buggy)===false);
  // WITH the fix: splice then trim peels the now-trailing authored folds → a frontier returns.
  const fixed=JSON.parse(JSON.stringify(C));fixed.actions.splice(1,1);W.eval('window.__h='+JSON.stringify(fixed)+';trimTrailingPassives(window.__h);');
  ok('deleting middle WITH trim reopens the add-move point', W.eval('(function(){var r=resolve(window.__h);return !!(r.frontier&&!r.handOver);})()')===true);
  ok('the hero 3-bet question survived the trim', W.eval('resolve(window.__h).questions.length')===1);
}

console.log('== trim only reopens the tail — the prefix before it is untouched ==');
{
  const W=boot();
  // hero SB open, BB folds (authored passive). Trimming peels BB fold and reopens the decision AT BB,
  // leaving every earlier row identical (it never rewrites history, only re-exposes the last seat).
  const H={players:6,heroPos:'SB',heroCards:['Ah','Kh'],cards:{},stacks:{},profiles:{},board:['','','','',''],video:{url:''},
    actions:[{street:'preflop',pos:'BTN',action:'fold'},{street:'preflop',pos:'SB',action:'raise',size:'3'},{street:'preflop',pos:'BB',action:'fold'}]};
  const before=fp(W,H);                                             // ...=fold p:SB=raise p:BB=fold
  W.eval('window.__t='+JSON.stringify(H)+';trimTrailingPassives(window.__t);');
  const trimmed=W.eval('JSON.parse(JSON.stringify(window.__t))');
  const after=fp(W,trimmed);                                        // ...=fold p:SB=raise   (BB now open)
  ok('every row up to the reopened seat is identical', before.startsWith(after)&&after===before.slice(0,after.length));
  ok('the explicit BB fold row was removed from actions', trimmed.actions.filter(a=>a.pos==='BB').length===0);
  ok('the reopened frontier lands on BB facing the raise', frontier(W,trimmed)==='preflop/BB'&&W.eval('resolve('+JSON.stringify(trimmed)+').frontier.facing')===true);
  ok('and the add-move button is available again', addBtn(W,trimmed)===true);
}

console.log('== edit a seat check→raise drops stale passives behind it ==');
{
  const W=boot();
  // flop, everyone limped to a multiway check-around that was materialized as explicit checks.
  // hero BB check, then CO check, BTN check (all authored). User turns CO's check into a bet.
  const D={players:6,heroPos:'BB',heroCards:['Ah','Kh'],cards:{},stacks:{},profiles:{},board:['2c','7d','Ts','',''],video:{url:''},
    actions:[{street:'preflop',pos:'CO',action:'raise',size:'2.5'},{street:'preflop',pos:'BTN',action:'call'},{street:'preflop',pos:'BB',action:'call'},
      {street:'flop',pos:'BB',action:'check'},{street:'flop',pos:'CO',action:'check'},{street:'flop',pos:'BTN',action:'check'}]};
  // grab the CO flop-check action object, flip to raise (bet), then dropPassivesAfter like the handler does
  W.eval('window.__d='+JSON.stringify(D)+';');
  W.eval('(function(){var a=window.__d.actions.find(x=>x.street==="flop"&&x.pos==="CO");a.action="raise";a.size="5 bb";dropPassivesAfter(window.__d,a);})()');
  const after=W.eval('JSON.parse(JSON.stringify(window.__d))');
  ok('the stale BTN check behind CO was dropped', after.actions.filter(a=>a.street==='flop'&&a.pos==='BTN').length===0);
  ok('CO now resolves as an active flop bet', W.eval('resolve(window.__d).rows.some(r=>r.street==="flop"&&r.pos==="CO"&&(r.action==="bet"||r.action==="raise")&&r.active)')===true);
  ok('BTN now RE-FACES the bet as an open decision (frontier, facing)', W.eval('(function(){var f=resolve(window.__d).frontier;return f&&f.street==="flop"&&f.nextToAct==="BTN"&&f.facing===true;})()')===true);
  ok('so the add-move button is open for BTN', W.eval('(function(){var r=resolve(window.__d);return !!(r.frontier&&!r.handOver);})()')===true);
  ok('hero BB flop check ahead of CO is untouched', after.actions.some(a=>a.street==='flop'&&a.pos==='BB'&&a.action==='check'));
}

console.log('\n'+pass+' passed, '+fail+' failed');
process.exit(fail?1:0);
