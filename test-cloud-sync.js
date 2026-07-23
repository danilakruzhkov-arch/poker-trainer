// Smoke-test the GitHub-source-of-truth persistence logic without a network.
const fs=require('fs');const {JSDOM}=require('jsdom');
const html=fs.readFileSync(__dirname+'/poker-trainer.html','utf8');

let pass=0,fail=0;
function ok(name,cond){ if(cond){pass++;console.log('  ok  '+name);} else {fail++;console.log('  FAIL '+name);} }

function boot(){
  const dom=new JSDOM(html,{runScripts:'dangerously',url:'https://danilakruzhkov-arch.github.io/poker-trainer/',
    pretendToBeVisual:true});
  return dom.window;
}

// ---- 1. fresh browser: COLS = seed, pubCols excludes 'mine', pubStr matches ----
{
  const W=boot();
  const ev=c=>W.eval(c);
  ok('eval reaches global let COLS', typeof ev('COLS.length')==='number' && ev('COLS.length')>0);
  const total=ev('COLS.length'), pub=ev('pubCols().length');
  ok('pubCols excludes exactly the mine pack', ev("COLS.some(c=>c.id==='mine')") ? pub===total-1 : pub===total);
  ok('pubStr === JSON of pubCols', ev('pubStr()===JSON.stringify(pubCols())'));
  ok('fresh browser is not dirty', ev('_dirty')===false);
}

// ---- 2. adoptFromCloud preserves a personal 'mine' with custom hands, replaces built-ins ----
{
  const W=boot();const ev=c=>W.eval(c);
  // give this browser a custom 'mine' with 2 hands
  ev("(function(){var m=COLS.find(c=>c.id==='mine'); if(!m){m={id:'mine',name:'Мой набор',hands:[]};COLS.push(m);} m.hands=[{title:'моя раздача 1'},{title:'моя раздача 2'}];})()");
  const mineTitlesBefore=ev("JSON.stringify(COLS.find(c=>c.id==='mine').hands.map(h=>h.title))");
  // cloud has DIFFERENT built-ins (rename ft10k) + an empty 'mine' that must NOT overwrite ours
  ev("globalThis.__cloud=[{id:'ft10k',name:'CLOUD-RENAMED',emoji:'x',accent:'#111',hands:[{title:'c1'}]},{id:'mine',name:'server-mine',hands:[]}]");
  ev("adoptFromCloud(globalThis.__cloud)");
  ok('adopt: ft10k took the cloud name', ev("COLS.find(c=>c.id==='ft10k').name")==='CLOUD-RENAMED');
  ok('adopt: personal mine hands survived (by title, count)', ev("JSON.stringify(COLS.find(c=>c.id==='mine').hands.map(h=>h.title))")===mineTitlesBefore);
  ok('adopt: mine still has 2 hands (not wiped by empty server-mine)', ev("COLS.find(c=>c.id==='mine').hands.length")===2);
  ok('adopt: exactly one mine pack after merge', ev("COLS.filter(c=>c.id==='mine').length")===1);
  ok('adopt: mine is last', ev("COLS[COLS.length-1].id")==='mine');
}

// ---- 3. persist() dirty detection: built-in edit dirties; mine-only edit does NOT ----
{
  const W=boot();const ev=c=>W.eval(c);
  ev("persist(true)");                                  // establish clean baseline
  ok('persist(true) clears dirty', ev('_dirty')===false);
  // edit a built-in pack -> should become dirty
  ev("COLS.find(c=>c.id!=='mine').name='EDITED'; persist();");
  ok('editing a built-in marks dirty', ev('_dirty')===true);
  ev("persist(true)");                                  // clean again
  // edit ONLY the mine pack -> pubStr unchanged -> must stay clean (no cloud commit)
  ev("(function(){var m=COLS.find(c=>c.id==='mine'); if(!m){m={id:'mine',name:'Мой набор',hands:[]};COLS.push(m);persist(true);} m.hands.push({title:'scratch'});})(); persist();");
  ok('editing only mine does NOT mark dirty (no cloud noise)', ev('_dirty')===false);
}

// ---- 4. restore() reads the dirty flag out of localStorage ----
{
  const W=boot();const ev=c=>W.eval(c);
  ev("localStorage.setItem('pokerTrainerV4', JSON.stringify({cols:COLS.map(c=>({id:c.id,name:c.name,hands:c.hands||[]})),curCol:0,dirty:true}))");
  ev("restore()");
  ok('restore() rehydrates dirty=true', ev('_dirty')===true);
  ev("localStorage.setItem('pokerTrainerV4', JSON.stringify({cols:COLS.map(c=>({id:c.id,name:c.name,hands:c.hands||[]})),curCol:0,dirty:false}))");
  ev("restore()");
  ok('restore() rehydrates dirty=false', ev('_dirty')===false);
  ok('clean restore sets _syncedStr to current pubStr', ev('_syncedStr===pubStr()'));
}

// ---- 5. schedulePublish with no token surfaces "unpushed", never throws ----
{
  const W=boot();const ev=c=>W.eval(c);
  ev("try{localStorage.removeItem('pk_gh_token')}catch(e){}");
  let threw=false; try{ ev("schedulePublish()"); }catch(e){ threw=true; }
  ok('schedulePublish() without token does not throw', threw===false);
}

console.log('\nRESULT: '+pass+' passed, '+fail+' failed');
process.exit(fail?1:0);
