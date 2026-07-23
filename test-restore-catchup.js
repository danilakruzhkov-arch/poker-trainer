// KNOWN RED as of 2026-07-24 (also red on .23 — not a regression from the video work).
// This guards the PRE-CLOUD catch-up: built-in packs shipped inside the HTML surfacing into an old
// localStorage save. Packs now come from Supabase and syncPacks() adopts the cloud on a `sig` change
// (the .21 fix), which is what actually keeps returning visitors current — that path is covered green by
// test-cloud-sync.js + test-autoupdate.js. Open decision: restore the seenBuiltins catch-up, or retire
// this file. Do NOT delete it silently — it sits on the data-loss-adjacent path.
//
// Verifies restore() behavior for returning visitors:
//  (a) seenBuiltins catch-up: a genuinely-new built-in pack surfaces once; a pack the user deleted stays gone.
//  (b) built-in re-sync: a pack already in localStorage gets its hands refreshed to the shipped code
//      (e.g. ft10k grown 9→22), while 'Мой набор' and user-created packs pass through untouched.
const fs=require('fs'),path=require('path');const {JSDOM}=require('jsdom');
const html=fs.readFileSync(path.join(__dirname,'poker-trainer.html'),'utf8');
const doc=`<!doctype html><html><head><meta charset="utf-8"></head><body>${html}</body></html>`;
const A=(c,m)=>{console.log((c?'✅':'❌')+' '+m);if(!c)process.exitCode=1;};

function boot(lsSave){
  return new Promise(res=>{
    const errors=[];
    const dom=new JSDOM(doc,{runScripts:'dangerously',pretendToBeVisual:true,
      url:'https://danilakruzhkov-arch.github.io/poker-trainer/',
      beforeParse(w){
        if(lsSave)w.localStorage.setItem('pokerTrainerV4',JSON.stringify(lsSave));
        w.localStorage.setItem('pk_autoplay','0');w.sessionStorage.setItem('pk_editor_ok','1');
        w.onerror=(m,s,l,c,e)=>errors.push(e&&e.stack||m);w.scrollTo=()=>{};w.HTMLElement.prototype.scrollIntoView=()=>{};
      }});
    setTimeout(()=>{
      const w=dom.window;
      const ids=w.eval('COLS.map(c=>c.id)');
      const handsOf=id=>w.eval('(()=>{const c=COLS.find(c=>c.id==="'+id+'");return c?c.hands.length:null})()');
      const codeCount=id=>w.eval('(()=>{const c=defaultCols().find(c=>c.id==="'+id+'");return c?c.hands.length:null})()');
      const mineNames=w.eval('(()=>{const c=COLS.find(c=>c.id==="mine");return c?c.hands.map(h=>h&&h.title):null})()');
      w.eval('persist()');
      const persisted=JSON.parse(w.localStorage.getItem('pokerTrainerV4'));
      res({ids,errors,handsOf,codeCount,mineNames,persistedSeen:persisted.seenBuiltins,persistedIds:persisted.cols.map(c=>c.id),
           persistedFt:(persisted.cols.find(c=>c.id==='ft10k')||{}).hands});
    },900);
  });
}

(async()=>{
  console.log('--- Case 1: Danila-like old save (wsop/run/final/mine, demosInit, NO seenBuiltins, NO ft10k) ---');
  const c1=await boot({cols:[
    {id:'wsop',name:'WSOP',hands:[]},
    {id:'run',name:'Run',hands:[]},
    {id:'final',name:'Final',hands:[]},
    {id:'mine',name:'Мой набор',hands:[]}
  ],curCol:0,demosInit:true});
  const ftCode=c1.codeCount('ft10k');
  A(c1.errors.length===0,'no load errors'+(c1.errors[0]?': '+c1.errors[0]:''));
  A(c1.ids.includes('ft10k'),'ft10k surfaced into COLS');
  A(c1.handsOf('ft10k')===ftCode,'ft10k has the shipped hand count '+ftCode+' (got '+c1.handsOf('ft10k')+')');
  A(c1.ids.indexOf('ft10k')>-1&&c1.ids.indexOf('ft10k')<c1.ids.indexOf('mine'),'ft10k placed before "mine" — order: '+c1.ids.join(','));
  A(c1.ids.filter(x=>x==='ft10k').length===1,'ft10k not duplicated');
  A(c1.persistedIds.filter(x=>x==='mine').length===1 && c1.persistedIds.includes('wsop'),'user packs preserved (mine + wsop kept)');
  A(c1.persistedSeen&&c1.persistedSeen.includes('ft10k'),'seenBuiltins now records ft10k → will not re-add next load');

  console.log('\n--- Case 2: user already saw ft10k and deleted it (seenBuiltins has ft10k, cols has none) ---');
  const c2=await boot({cols:[
    {id:'wsop',name:'WSOP',hands:[]},
    {id:'mine',name:'Мой набор',hands:[]}
  ],curCol:0,demosInit:true,seenBuiltins:['wsop','run','final','ft10k']});
  A(c2.errors.length===0,'no load errors'+(c2.errors[0]?': '+c2.errors[0]:''));
  A(!c2.ids.includes('ft10k'),'ft10k NOT re-added (respects deletion)');
  A(!c2.ids.includes('run')&&!c2.ids.includes('final'),'other seen-but-deleted packs also stay gone');

  console.log('\n--- Case 3: RE-SYNC — save has a STALE ft10k (0 hands); code has more → refresh in place ---');
  const c3=await boot({cols:[
    {id:'wsop',name:'WSOP',hands:[]},{id:'run',name:'Run',hands:[]},{id:'final',name:'Final',hands:[]},
    {id:'ft10k',name:'Финалка (старое имя)',hands:[]},
    {id:'mine',name:'Мой набор',hands:[]}
  ],curCol:0,demosInit:true,seenBuiltins:['wsop','run','final','ft10k']});
  A(c3.ids.filter(x=>x==='ft10k').length===1,'ft10k kept exactly once (not duplicated)');
  A(c3.handsOf('ft10k')===c3.codeCount('ft10k'),'stale ft10k re-synced 0 → '+c3.codeCount('ft10k')+' hands (got '+c3.handsOf('ft10k')+')');

  console.log('\n--- Case 4: Danila\'s exact live save (ft10k:9 stale, wsopme:24, mtt16k:32, mine has a user hand) ---');
  const nine=Array.from({length:9},(_,k)=>({title:'stale'+k,players:6,heroPos:'BTN',heroCards:['As','Ks'],stacks:{},profiles:{},board:['','','','',''],actions:[]}));
  const twentyfour=Array.from({length:24},(_,k)=>({title:'w'+k,actions:[]}));
  const thirtytwo=Array.from({length:32},(_,k)=>({title:'m'+k,actions:[]}));
  const c4=await boot({cols:[
    {id:'wsop',name:'WSOP',hands:[]},{id:'run',name:'Run',hands:[]},{id:'final',name:'Final',hands:[]},
    {id:'ft10k',name:'Финалка',hands:nine},
    {id:'wsopme',name:'WSOP Main Event $10K',hands:twentyfour},
    {id:'mtt16k',name:'С $3 до $16 000',hands:thirtytwo},
    {id:'mine',name:'Мой набор',hands:[{title:'моя раздача из истории',players:6,heroPos:'BTN',heroCards:['Ah','Kh'],stacks:{},profiles:{},board:['','','','',''],actions:[]}]}
  ],curCol:6,demosInit:true,seenBuiltins:['wsop','run','final','ft10k','wsopme','mtt16k']});
  A(c4.errors.length===0,'no load errors'+(c4.errors[0]?': '+c4.errors[0]:''));
  A(c4.handsOf('ft10k')===c4.codeCount('ft10k'),'STALE ft10k:9 → re-synced to '+c4.codeCount('ft10k')+' (got '+c4.handsOf('ft10k')+')  ← the live bug fix');
  A(c4.handsOf('wsopme')===c4.codeCount('wsopme'),'wsopme aligned to code '+c4.codeCount('wsopme')+' (got '+c4.handsOf('wsopme')+')');
  A(c4.handsOf('mtt16k')===c4.codeCount('mtt16k'),'mtt16k aligned to code '+c4.codeCount('mtt16k')+' (got '+c4.handsOf('mtt16k')+')');
  A(Array.isArray(c4.mineNames)&&c4.mineNames.length===1&&c4.mineNames[0]==='моя раздача из истории','user "Мой набор" hand preserved intact');
  A(c4.ids.join(',')==='wsop,run,final,ft10k,wsopme,mtt16k,mine','pack order unchanged: '+c4.ids.join(','));

  console.log('\nDONE. exitCode='+(process.exitCode||0));
})();
