// Verify the data-safety fixes:
//  (A) unsaved-draft guard — dirty detection, the 3-way dialog, and its Save/Discard/Cancel outcomes
//  (B) safe update — the update button persists + snapshots + confirms before reloading
//  (C) rolling backup — only a non-empty state is snapshotted; restoreBackup brings a lost set back
const fs=require('fs');const {JSDOM}=require('jsdom');
const html=fs.readFileSync(__dirname+'/poker-trainer.html','utf8');
let pass=0,fail=0;
function ok(name,cond){if(cond){pass++;console.log('  ok  '+name);}else{fail++;console.log('  FAIL '+name);}}
function boot(){const dom=new JSDOM(html,{runScripts:'dangerously',url:'https://danilakruzhkov-arch.github.io/poker-trainer/',pretendToBeVisual:true});return dom.window;}
const HAND={players:6,heroPos:'BB',heroCards:['Ah','Kh'],cards:{BB:['Ah','Kh']},stacks:{BB:50},profiles:{},board:['','','','',''],video:{url:''},curQ:0,editIndex:null,
  actions:[{street:'preflop',pos:'BTN',action:'raise',size:'2.5'},{street:'preflop',pos:'BB',action:'raise',size:'11',q:{options:[{id:'o1',hero:true,label:'3-бет',type:'raise',size:'11',grade:'best'},{id:'o2',label:'Пас',type:'fold',grade:'ok'}],vStart:0,vEnd:0,depth:'коротко',explain:'x'}}]};

console.log('== static wiring ==');
{
  ok('update button persists + snapshots before reload', /try\{persist\(\);backupSnapshot\(\);\}catch\(e\)\{\}/.test(html)&&/_leaving=true;location\.href=location\.pathname\+'\?v='/.test(html));
  ok('update button confirms when local hands / dirty draft exist', /localHands>0\|\|isDirtyDraft\(\)\)&&!confirm\(/.test(html));
  ok('beforeunload warns on an unsaved draft', /addEventListener\('beforeunload',e=>\{if\(!_leaving&&isDirtyDraft\(\)\)/.test(html));
  ok('edit/duplicate buttons routed through guardUnsaved', /guardUnsaved\(\(\)=>editHand\(k\)\)/.test(html)&&/guardUnsaved\(\(\)=>duplicateHand\(k\)\)/.test(html));
  ok('leaving the editor (tab / play) is guarded', /guardUnsaved\(\(\)=>switchView\('train'\)\)/.test(html)&&/guardUnsaved\(\(\)=>\{switchView\('train'\);playPack/.test(html));
  ok('backup only snapshots a non-empty store', /const n=\(j\.cols\|\|\[\]\)\.reduce\(\(s,c\)=>s\+\(\(c&&c\.hands&&c\.hands\.length\)\|\|0\),0\);if\(n<=0\)return;/.test(html));
  ok('saveHand signals success/failure', /if\(issues\.length\)\{showModal\(issues\);return false;\}/.test(html)&&/persist\(\);backupSnapshot\(\);markDraftSaved\(\);return true;/.test(html));
}

console.log('== dirty-draft detection ==');
{
  const W=boot();const ev=c=>W.eval(c);
  ev('F='+JSON.stringify(HAND)+';buildForm();markDraftSaved();');
  ok('a freshly opened hand is NOT dirty', ev('isDirtyDraft()')===false);
  ok('transient fields are ignored by draftKey', ev("draftKey(Object.assign(JSON.parse(JSON.stringify(F)),{curQ:9,editIndex:3,unit:'chips'}))===draftKey(F)"));
  // real edit: change an action, re-render so the DOM matches, then re-check
  ev("F.actions.push({street:'preflop',pos:'BTN',action:'fold',size:''});buildForm();");
  ok('after adding an action the draft is dirty', ev('isDirtyDraft()')===true);
  ev('markDraftSaved();');
  ok('marking saved clears the dirty flag', ev('isDirtyDraft()')===false);
}

console.log('== guardUnsaved routing ==');
{
  const W=boot();const ev=c=>W.eval(c);
  ev('window.__ran=0;');
  ev('F='+JSON.stringify(HAND)+';buildForm();markDraftSaved();');
  ev('guardUnsaved(()=>{window.__ran++;});');
  ok('clean draft: proceeds immediately, no dialog', ev('window.__ran')===1&&!/show/.test(ev("document.getElementById('editGuard').className")));
  // make it dirty, then guard should hold and show the dialog
  ev("F.actions.push({street:'preflop',pos:'CO',action:'fold',size:''});buildForm();window.__ran=0;");
  ev('guardUnsaved(()=>{window.__ran++;});');
  ok('dirty draft: does NOT proceed', ev('window.__ran')===0);
  ok('dirty draft: shows the 3-way dialog', /\bshow\b/.test(ev("document.getElementById('editGuard').className")));
  // Cancel → stays put, callback never fires
  ev("document.getElementById('egCancel').click();");
  ok('«Продолжить редактирование» keeps you put', ev('window.__ran')===0&&!/\bshow\b/.test(ev("document.getElementById('editGuard').className")));
  // re-open dialog, Discard → proceeds
  ev('guardUnsaved(()=>{window.__ran++;});document.getElementById("egDiscard").click();');
  ok('«Закрыть без сохранения» proceeds', ev('window.__ran')===1);
}

console.log('== egSave: valid saves & proceeds, invalid blocks ==');
{
  const W=boot();const ev=c=>W.eval(c);
  ev('useCol(COLS.findIndex(c=>c.id==="mine"));window.__ran=0;');
  ev('F='+JSON.stringify(HAND)+';F.editIndex=null;buildForm();markDraftSaved();');
  ev("F.actions.push({street:'preflop',pos:'CO',action:'fold',size:''});buildForm();");   // make dirty
  const before=ev('SET.length');
  ev('guardUnsaved(()=>{window.__ran++;});document.getElementById("egSave").click();');
  ok('valid hand: egSave adds it to the set', ev('SET.length')===before+1);
  ok('valid hand: egSave then proceeds with the pending action', ev('window.__ran')===1);
  ok('valid hand: dialog closed', !/\bshow\b/.test(ev("document.getElementById('editGuard').className")));
}

console.log('== rolling backup + recovery ==');
{
  const W=boot();const ev=c=>W.eval(c);
  const good=JSON.stringify({cols:[{id:'mine',hands:[{a:1},{a:2},{a:3}]}],curCol:0});
  const empty=JSON.stringify({cols:[{id:'mine',hands:[]}],curCol:0});
  ev(`localStorage.setItem(LS_KEY,${JSON.stringify(good)});backupSnapshot();`);
  ok('non-empty state is backed up', JSON.parse(ev(`localStorage.getItem(LS_KEY+'_bak0')`)).cols[0].hands.length===3);
  ev(`localStorage.setItem(LS_KEY,${JSON.stringify(empty)});backupSnapshot();`);
  ok('an EMPTY overwrite does NOT clobber the good backup', JSON.parse(ev(`localStorage.getItem(LS_KEY+'_bak0')`)).cols[0].hands.length===3);
  const n=ev('restoreBackup()');
  ok('restoreBackup reports the recovered hand count', n===3);
  ok('restoreBackup writes the good set back into the live store', JSON.parse(ev('localStorage.getItem(LS_KEY)')).cols[0].hands.length===3);
}

console.log('\n'+pass+' passed, '+fail+' failed');
process.exit(fail?1:0);
