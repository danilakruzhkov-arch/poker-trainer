// Regression guard for the cross-pack save incident:
// editing a hand in pack A while a background cloud-sync makes pack B active must STILL save into A,
// the editor must be a "do-not-disturb" zone for cloud adoption, and a legit sync must not jump packs.
const fs=require('fs');const {JSDOM}=require('jsdom');
const html=fs.readFileSync(__dirname+'/poker-trainer.html','utf8');
let pass=0,fail=0;
function ok(name,cond){if(cond){pass++;console.log('  ok  '+name);}else{fail++;console.log('  FAIL '+name);}}
function boot(){const dom=new JSDOM(html,{runScripts:'dangerously',url:'https://danilakruzhkov-arch.github.io/poker-trainer/',pretendToBeVisual:true});return dom.window;}
const HAND=q=>({players:6,heroPos:'BB',heroCards:['Ah','Kh'],cards:{BB:['Ah','Kh']},stacks:{BB:50},profiles:{},board:['','','','',''],video:{url:''},
  actions:[{street:'preflop',pos:'BTN',action:'raise',size:'2.5'},{street:'preflop',pos:'BB',action:'raise',size:'11',q:{options:[{id:'o1',hero:true,label:q||'3-бет',type:'raise',size:'11',grade:'best'},{id:'o2',label:'Пас',type:'fold',grade:'ok'}],vStart:0,vEnd:0,depth:'коротко',explain:'x'}}]});
// two shared packs + personal mine, so we can move the "active" pack out from under an edit
function twoPacks(W){W.eval(`COLS=[
  {id:'pA',name:'Pack A',emoji:'x',accent:'#000',intro:blankIntro('A'),hands:[${JSON.stringify(HAND('A0'))},${JSON.stringify(HAND('A1'))}]},
  {id:'pB',name:'Pack B',emoji:'x',accent:'#000',intro:blankIntro('B'),hands:[${JSON.stringify(HAND('B0'))},${JSON.stringify(HAND('B1'))},${JSON.stringify(HAND('B2'))}]},
  {id:'mine',name:'Мой набор',emoji:'✎',accent:'#000',intro:blankIntro('mine'),hands:[]}];useCol(0);`);}

console.log('== static wiring ==');
{
  ok('saveHand binds to the pack the hand was opened from', /const col=\(F\.editColId&&findCol\(F\.editColId\)\)\|\|activeCol\(\);/.test(html));
  ok('saveHand guards a stale/out-of-range editIndex', /F\.editIndex>=0&&F\.editIndex<SET\.length/.test(html));
  ok('editHand records the pack id', /F\.editColId=activeCol\(\)\.id;/.test(html));
  ok('previewHand strips editColId (never stored on a hand)', /delete h\.editColId;/.test(html));
  ok('syncPacks defers cloud adoption while editing', /const editing=\(\$\('view-admin'\)&&\$\('view-admin'\)\.style\.display!=='none'\)\|\|isDirtyDraft\(\);/.test(html)&&/if\(editing\)\{updSync\('synced'\);return;\}/.test(html));
  ok('adoptCols keeps the current pack by id', /const keep=prevId\?COLS\.findIndex\(c=>c\.id===prevId\):-1;curCol=keep>=0\?keep:COLS\.length-1;/.test(html));
}

console.log('== the incident: edit A, background sync flips active pack to B, then save ==');
{
  const W=boot();const ev=c=>W.eval(c);twoPacks(W);
  ev('editHand(0);');                                   // open A[0] for edit → F.editColId='pA', F.editIndex=0
  ok('editColId captured as pA', ev("F.editColId")==='pA');
  ev("F.actions[1].q.options[0].label='A0-EDITED';");   // make a real edit to the hero option label
  ev("useCol(1);");                                     // <-- simulate the rug-pull: SET now points at pack B
  ok('active pack really moved to B before save', ev('curCol')===1&&ev("activeCol().id")==='pB');
  const bBefore=ev("JSON.stringify(findCol('pB').hands.map(h=>h.actions[1].q.options[0].label))");
  ev("saveHand();");
  ok('edit landed in pack A (not B)', ev("findCol('pA').hands[0].actions[1].q.options[0].label")==='A0-EDITED');
  ok('pack B is completely untouched', ev("JSON.stringify(findCol('pB').hands.map(h=>h.actions[1].q.options[0].label))")===bBefore);
  ok('pack B still has all 3 hands (nothing overwritten)', ev("findCol('pB').hands.length")===3);
  ok('pack A still has exactly 2 hands (no stray append)', ev("findCol('pA').hands.length")===2);
  ok('saved hand carries no editColId leak', ev("findCol('pA').hands[0].editColId")===undefined);
}

console.log('== syncPacks is a do-not-disturb zone for the open editor ==');
{
  const W=boot();const ev=c=>W.eval(c);twoPacks(W);
  // cloud is FRESHER and would drop pack B, keeping only a lean pA
  ev(`loadPublished=async()=>({cols:[{id:'pA',name:'Pack A',emoji:'x',accent:'#000',intro:blankIntro('A'),hands:[${JSON.stringify(HAND('CLOUD'))}]}],sig:'pA:2'});`);
  ev("_syncedSig='pA:1';_dirty=false;");
  ev("document.getElementById('view-admin').style.display='block';");   // editor OPEN
  ev("editHand(0);");
  return (async()=>{
    await W.eval("syncPacks()");
    ok('editor open: cloud NOT adopted (B still present)', ev("!!findCol('pB')")===true&&ev("findCol('pA').hands.length")===2);
    ok('editor open: baseline sig left stale so a later sync still adopts', ev("_syncedSig")==='pA:1');
    // close the editor and sync again → now it adopts
    ev("document.getElementById('view-admin').style.display='none';F=blankHand();");
    await W.eval("syncPacks()");
    ok('editor closed: cloud adopted (B gone, pA lean)', ev("!findCol('pB')")===true&&ev("findCol('pA').hands.length")===1);
    ok('mine preserved through adoption', ev("!!findCol('mine')")===true);

    console.log('== adoptCols keeps you on the same pack ==');
    { const W2=boot();const ev2=c=>W2.eval(c);twoPacks(W2);ev2("useCol(1);");   // sit on pack B
      ev2("adoptCols([{id:'pA',name:'A',emoji:'x',accent:'#000',intro:blankIntro('A'),hands:[]},{id:'pB',name:'B',emoji:'x',accent:'#000',intro:blankIntro('B'),hands:[]}]);");
      ok('still on pack B after adopt (no jump to last)', ev2("activeCol().id")==='pB'); }

    console.log('== stale index guard: append, never clobber a foreign slot ==');
    { const W3=boot();const ev3=c=>W3.eval(c);twoPacks(W3);
      ev3("editHand(0);F.editColId='pB';F.editIndex=99;");   // index way out of range for pB (3 hands)
      ev3("saveHand();");
      ok('out-of-range index appended to the bound pack', ev3("findCol('pB').hands.length")===4);
      ok('no foreign pack touched (pA still 2)', ev3("findCol('pA').hands.length")===2); }

    console.log('\n'+pass+' passed, '+fail+' failed');
    process.exit(fail?1:0);
  })();
}
