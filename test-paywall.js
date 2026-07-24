// Verify P1a: free/paid split — locked hands come from a separate RLS'd table, never leak into the
// anon-readable row, splice back in the right order, and gate the drill with a paywall step.
const fs=require('fs');const {JSDOM}=require('jsdom');
const html=fs.readFileSync(__dirname+'/poker-trainer.html','utf8');
let pass=0,fail=0;
function ok(name,cond){if(cond){pass++;console.log('  ok  '+name);}else{fail++;console.log('  FAIL '+name);}}
function boot(){const dom=new JSDOM(html,{runScripts:'dangerously',url:'https://danilakruzhkov-arch.github.io/poker-trainer/',pretendToBeVisual:true});return dom.window;}

console.log('== static wiring ==');
{
  ok('paywall state is declared outside COLS',      /let PAYWALL=\{\},\s*\/\/[^\n]*\n\s*OWNED=\{\},[^\n]*\n\s*LOCKED=\{\};/.test(html));
  ok('paid hands are read with the USER jwt',       /const tok=await authToken\(\);if\(!tok\)return done\(\);/.test(html)&&/Authorization:'Bearer '\+tok/.test(html));
  ok('loadLocked swaps maps in atomically',         /const gen=\+\+_lockGen;/.test(html)&&/if\(gen!==_lockGen\)return false;/.test(html));   // overlapping calls must not share a map — see the incident regression below
  ok('pack_locked is never fetched with the anon key', !/pack_locked[^\n]*packHeaders\(\)/.test(html));
  ok('entitlement + pack_locked both fetched',      /rest\/v1\/entitlement\?select=pack_slug/.test(html)&&/rest\/v1\/pack_locked\?select=slug,idx,hand/.test(html));
  ok('buildPlay appends a terminal paywall step',   /if\(lk>0\)PLAY\.push\(\{hi:-1,k:0,stepNo:1,stepCount:1,order:\[\],locked:lk\}\);/.test(html));
  ok('renderHand checks p.locked before the hand',  html.indexOf("if(p.locked){showPaywall(")<html.indexOf("if(handLocked(CURPACK.id,p.hi))"));
  ok('showEnd does not score the paywall step',     /const qn=PLAY\.filter\(p=>!p\.locked\)\.length;/.test(html)&&/if\(p\.locked\)return n;/.test(html));
  ok('pack row select carries the paywall columns', /select=slug,position,data,version,paid,free_hands,price_rub,hands_total/.test(html));
}

console.log('== leak guard: publish must never write paid hands back into pack.data ==');
{
  // publishPacks() upserts the whole col object into the anon-readable `data` column. If locked hands were
  // merged into COLS, an admin publish would republish every paid hand in the clear. So the publish path
  // must not know about LOCKED / fullHands at all.
  const pub=html.slice(html.indexOf('async function publishPacks'),html.indexOf('function restore()'));
  ok('publishPacks does not touch LOCKED',          !/LOCKED/.test(pub));
  ok('publishPacks does not use fullHands',         !/fullHands/.test(pub));
  ok('publish still writes plain cols',             /changed\.push\(\{slug:p\.id,position:i,data:p\}\)/.test(pub));
  const adopt=html.slice(html.indexOf('function adoptCols'),html.indexOf('async function loadPublished'));
  ok('cloud adoption does not inject locked hands', !/LOCKED/.test(adopt));
}

console.log('== fullHands: splice back at the original index ==');
{
  const W=boot();const ev=c=>W.eval(c);
  ev("COLS.push({id:'tst',name:'T',emoji:'x',accent:'#000',hands:[{title:'a'},{title:'b'},{title:'c'}]});");
  ev("LOCKED={};");
  ok('no locked rows -> array untouched', ev("fullHands(findCol('tst')).map(h=>h.title).join(',')")==='a,b,c');
  ev("LOCKED={tst:[{idx:2,hand:{title:'X'}}]};");
  ok('single locked hand lands at its 1-based slot', ev("fullHands(findCol('tst')).map(h=>h.title).join(',')")==='a,X,b,c');
  ev("LOCKED={tst:[{idx:4,hand:{title:'Y'}},{idx:2,hand:{title:'X'}}]};");
  ok('several locked hands restore original order', ev("fullHands(findCol('tst')).map(h=>h.title).join(',')")==='a,X,b,Y,c');
  ev("LOCKED={tst:[{idx:99,hand:{title:'Z'}}]};");
  ok('out-of-range idx clamps instead of throwing', ev("fullHands(findCol('tst')).map(h=>h.title).join(',')")==='a,b,c,Z');
}

console.log('== lockedCount / ownsPack ==');
{
  const W=boot();const ev=c=>W.eval(c);
  ev("COLS.push({id:'tst',name:'T',emoji:'x',accent:'#000',hands:[{title:'a'},{title:'b'}]});");
  ev("PAYWALL={tst:{paid:true,freeHands:2,priceRub:49,handsTotal:3}};LOCKED={};OWNED={};CURUSER=null;");
  ok('anon sees the paid tail as locked', ev("lockedCount('tst')")===1);
  ev("OWNED={tst:true};LOCKED={tst:[{idx:3,hand:{title:'c'}}]};CURUSER={id:'u1',email:'x@y.z'};");
  ok('owner has nothing locked', ev("lockedCount('tst')")===0);
  ok('owner plays the paid hand too', ev("packHands('tst').length")===3);
  ev("OWNED={};CURUSER={id:'u1',email:'daanilka@gmail.com'};");
  ok('admin counts as owner (reads every locked row)', ev("ownsPack('tst')")===true&&ev("lockedCount('tst')")===0);
  ev("PAYWALL={tst:{paid:false,freeHands:0,priceRub:0,handsTotal:2}};OWNED={};CURUSER=null;LOCKED={};");
  ok('free pack never locks', ev("lockedCount('tst')")===0);
  ok('unknown pack is safe', ev("lockedCount('nope')")===0);
}

console.log('== paywall panel ==');
{
  const W=boot();const ev=c=>W.eval(c);
  ev("COLS.push({id:'tst',name:'T',emoji:'x',accent:'#000',hands:[{title:'a'},{title:'b'}]});");
  ev("PAYWALL={tst:{paid:true,freeHands:2,priceRub:49,handsTotal:3}};CURPACK={id:'tst',title:'T'};");
  const t=()=>W.document.getElementById('trainTable').innerHTML;
  ev("CURUSER=null;showPaywall('tst',1);");
  ok('anon is asked to sign in first', /id="gateIn"/.test(t())&&/Войти через Google/.test(t()));
  ok('anon copy explains the account requirement', /привязан к аккаунту/.test(t()));
  ok('the count agrees with its noun', /Осталось 1 раздача: доступ пока ограничен/.test(t()));
  ok('anon wall leads with the sign-in ask',       /Залогинься, чтобы открыть бесплатно/.test(t()));
  ok('prototype copy says «ограничен», not «платный»', /ограничен/i.test(t())&&!/платн(ая|ые|ых|ой|ую)/i.test(t().replace(/бесплатн\w*/gi,'')));   // «бесплатные» is fine — that is the offer, not a charge
  ok('price is shown to anon', /49 ₽/.test(t()));
  ok('progress is named honestly', /Сыграно 2 из 3 раздач/.test(t()));
  ev("CURUSER={id:'u1',email:'x@y.z'};showPaywall('tst',1);");
  ok('signed-in user gets the unlock button', /id="payBtn"/.test(t())&&/Разблокировать за 49 ₽/.test(t()));
  ok('result stays reachable from the wall', /id="paySkip"/.test(t())&&W.document.getElementById('paySkip')!==null);
  ok('paywall clears the answer buttons', W.document.getElementById('acts').innerHTML==='');
}

console.log('== drill: paywall step is appended, not scored ==');
{
  const W=boot();const ev=c=>W.eval(c);
  ev("COLS.push({id:'tst',name:'T',emoji:'x',accent:'#000',hands:[]});");
  ev("PAYWALL={tst:{paid:true,freeHands:0,priceRub:49,handsTotal:2}};OWNED={};LOCKED={};CURUSER=null;");
  ev("CURPACK={id:'tst',title:'T'};HANDS=[];buildPlay();");
  ok('a pack with only paid hands still gets a wall step', ev("PLAY.length")===1&&ev("PLAY[0].locked")===2);
  ok('the wall step never indexes HANDS', ev("PLAY[0].hi")===-1);
  ev("PAYWALL={tst:{paid:false,freeHands:0,priceRub:0,handsTotal:0}};buildPlay();");
  ok('free pack gets no wall step', ev("PLAY.length")===0);
}

console.log('== pack card ==');
{
  const W=boot();const ev=c=>W.eval(c);
  // a real pack: the "+N платн." chip only makes sense next to a real free-question count
  const id=ev("COLS.find(c=>c.id!=='mine'&&c.hands&&c.hands.some(h=>!h.hidden)).id"),J=JSON.stringify(id);
  ev(`LOCKED={};OWNED={};CURUSER=null;PAYWALL={};PAYWALL[${J}]={paid:true,freeHands:1,priceRub:49,handsTotal:packStats(${J}).hands+1};`);
  const card=ev(`packCardHTML({id:${J},emoji:'A',title:'T',accent:'#000',gate:'free'})`);
  // a pack with a free part keeps a stable badge — a price tag would misread as "this whole set costs money"
  ok('partly-free pack badges «демо», not a price', /pbadge pro/.test(card)&&/демо/.test(card)&&!/49 ₽/.test(card));
  ok('card counts the locked tail', /\+1 огранич\./.test(card));
  ev("PAYWALL={};");
  const plain=ev(`packCardHTML({id:${J},emoji:'A',title:'T',accent:'#000',gate:'free'})`);
  ok('free pack card gets a «Free» badge', /pbadge free/.test(plain)&&/Free/.test(plain)&&!/платн\./.test(plain));
  const mineCard=ev("packCardHTML({id:'mine',emoji:'A',title:'Мой',accent:'#000',gate:'free',isUser:true})");
  ok('«Мой набор» is never badged Free', !/pbadge/.test(mineCard));
}

console.log('== fully-paid pack stays reachable ==');
{
  // regression: a pack whose every hand is paid has zero free questions. The card used to fall into the
  // "empty" branch — rendered disabled — so the player could never even reach the paywall.
  const W=boot();const ev=c=>W.eval(c);
  ev("COLS.push({id:'allpaid',name:'AP',emoji:'x',accent:'#000',hands:[]});");
  ev("PAYWALL={allpaid:{paid:true,freeHands:0,priceRub:49,handsTotal:2}};OWNED={};LOCKED={};CURUSER=null;");
  const ap=ev("packCardHTML({id:'allpaid',emoji:'A',title:'AP',accent:'#000',gate:'free'})");
  ok('card is not disabled',            !/disabled/.test(ap));
  ok('card is not marked empty/locked', !/class="pack locked"/.test(ap));
  ok('card names the restricted set',   /2 разд\. — по входу/.test(ap));
  ok('a wholly-paid pack may show its price', /pbadge pro/.test(ap)&&/49 ₽/.test(ap));   // nothing here is playable without buying, so a number is honest
  ev("PAYWALL.allpaid.priceRub=0;");
  ok('…and falls back to «демо» while free', /демо/.test(ev("packCardHTML({id:'allpaid',emoji:'A',title:'AP',accent:'#000',gate:'free'})")));
  ev("PAYWALL.allpaid.priceRub=49;");
  ev("CURPACK=null;playPack('allpaid');");
  ok('playPack opens it instead of bailing', ev("CURPACK&&CURPACK.id")==='allpaid');
  ok('drill lands on the paywall', /class="gate"/.test(W.document.getElementById('trainTable').innerHTML)&&/Дальше — ограниченная часть|Залогинься/.test(W.document.getElementById('trainTable').innerHTML));
}

console.log('== editor: per-hand paid flag, server-side split on publish ==');
{
  ok('set list has a per-hand lock toggle',   /data-paid="\$\{k\}"/.test(html)&&/SET\[k\]\.paid\)delete SET\[k\]\.paid;else SET\[k\]\.paid=true/.test(html));
  ok('publish goes through the split RPC',    /c\.rpc\('pack_apply_split',args\)/.test(html));
  ok('paid-ness is derived server-side',      /p_paid:null/.test(html));
  ok('publish no longer upserts pack rows',   !/from\('pack'\)\.upsert/.test(html));
  ok('the data-loss guard is surfaced, not swallowed', /refusing to drop all/i.test(html)&&/p_force:true/.test(html));
  // price used to live in a side map that persist() never saved and _dirty never noticed, so it silently
  // reverted on reload and a price-only edit was never published
  // price lives in PRICE_LOCAL (out of COLS, so opening the editor never fakes dirty), but — unlike the first
  // attempt — it is now persisted to localStorage and counted in _dirty, so it survives reload and publishes
  ok('a price edit is tracked apart from COLS', /PRICE_LOCAL\[c\.id\]=v;else delete PRICE_LOCAL\[c\.id\]/.test(html));
  ok('unpublished price is persisted',         /price:PRICE_LOCAL/.test(html)&&/PRICE_LOCAL=\(s\.price/.test(html));
  ok('a price-only edit counts as dirty',      /priceDirty\(\)/.test(html));
  ok('publish sends the edited price',         /p_price:colPrice\(ch\.slug\)/.test(html));
  ok('publishing is explicit, not debounced',  /function schedulePublish\(\)\{updSync\(CURUSER\?'pending':'unpushed'\);\}/.test(html)&&/id="pubNow"/.test(html)&&/id="pubRevert"/.test(html));
  ok('the felt decoration cannot eat gate clicks', /\.table::after\{[^}]*pointer-events:none/.test(html));
  ok('bulk "first N free" stamps the flag',   /col-applyn/.test(html)&&/if\(seen<=n\)delete h\.paid;else h\.paid=true;/.test(html));
  ok('demo price 0 offers a free unlock',     /id="freeBtn"/.test(html)&&/c\.rpc\('claim_free_pack',\{p_slug:id\}\)/.test(html));
  ok('merge happens before the sync baseline', html.indexOf('mergeLockedIntoCols();setSyncBaseline(pub.sig)')>0);
}

console.log('== mergeLockedIntoCols ==');
{
  const W=boot();const ev=c=>W.eval(c);
  ev("COLS.push({id:'tst',name:'T',emoji:'x',accent:'#000',hands:[{title:'a'},{title:'b'}]});");
  ev("LOCKED={tst:[{idx:2,hand:{title:'X'}}]};OWNED={};");
  ev("CURUSER={id:'u1',email:'someone@else.com'};mergeLockedIntoCols();");
  ok('a player never gets paid hands folded into COLS', ev("findCol('tst').hands.map(h=>h.title).join(',')")==='a,b'&&ev("_colsMerged")===false);
  ok('but still plays what they own', ev("packHands('tst').map(h=>h.title).join(',')")==='a,X,b');
  ev("CURUSER={id:'u1',email:'daanilka@gmail.com'};mergeLockedIntoCols();");
  ok('admin sees one complete set', ev("findCol('tst').hands.map(h=>h.title).join(',')")==='a,X,b');
  ok('folded hands carry the paid marker', ev("findCol('tst').hands.filter(h=>h.paid).map(h=>h.title).join(',')")==='X');
  ok('fullHands does not splice twice', ev("fullHands(findCol('tst')).map(h=>h.title).join(',')")==='a,X,b');
  ev("mergeLockedIntoCols();mergeLockedIntoCols();");
  ok('merging repeatedly does not duplicate', ev("findCol('tst').hands.map(h=>h.title).join(',')")==='a,X,b');
  ev("LOCKED={};mergeLockedIntoCols();");
  ok('losing access drops the folded hands', ev("findCol('tst').hands.map(h=>h.title).join(',')")==='a,b');
  // regression: signing out used to leave the folded hands in COLS (and in localStorage), so the admin
  // still played the whole paid pack with no session — exactly what you'd sign out to check
  ev("LOCKED={tst:[{idx:2,hand:{title:'X'}}]};CURUSER={id:'u1',email:'daanilka@gmail.com'};mergeLockedIntoCols();");
  ok('admin merged again', ev("findCol('tst').hands.map(h=>h.title).join(',')")==='a,X,b');
  ev("CURUSER=null;LOCKED={};OWNED={};mergeLockedIntoCols();");
  ok('sign-out takes paid hands back out of COLS', ev("findCol('tst').hands.map(h=>h.title).join(',')")==='a,b');
  ok('and they stop being playable', ev("packHands('tst').map(h=>h.title).join(',')")==='a,b');
}

// Regression for the 2026-07-24 duplication incident. loadLocked() used to reset LOCKED={} synchronously and
// push after the await, so the two calls that always overlap on boot (refreshOwned + onAuthStateChange) both
// landed in the same object. Every paid hand was counted twice, mergeLockedIntoCols spliced the duplicates
// into COLS, persist() saved them and auto-publish wrote them to the DB — compounding on each page load until
// mtt16k held 108 rows in pack_locked (3 hands x 36 rounds). Before the fix this block reports 3 / 6 / true.
console.log('== loadLocked concurrency (incident regression) ==');
(async()=>{
  const W=boot();const ev=c=>W.eval(c);
  ev(`CURUSER={id:'u1',email:'daanilka@gmail.com'};authToken=async()=>'tok';
     window.fetch=u=>new Promise(r=>setTimeout(()=>r({ok:true,json:async()=>(/pack_locked/.test(u)?[{slug:'tst',idx:2,hand:{title:'X'}}]:[])}),
       /pack_locked/.test(u)?(window.__d=(window.__d||0)+30):5));`);   // stagger the responses so the calls interleave
  await Promise.all([ev("loadLocked()"),ev("loadLocked()"),ev("loadLocked()")]);
  ok('three overlapping loads leave one entry', ev("(LOCKED.tst||[]).length")===1);
  ev("COLS=[{id:'tst',name:'T',emoji:'x',accent:'#000',hands:[{title:'a'},{title:'b'}]}];useCol(0);mergeLockedIntoCols();");
  ok('merge does not multiply hands', ev("findCol('tst').hands.map(h=>h.title).join(',')")==='a,X,b');
  ok('SET follows the rebuilt array', ev("SET===findCol('tst').hands")===true);   // stale SET = editor renders a pre-merge list (lock icons never update)
  ev("persist();");
  const ls=JSON.parse(ev("localStorage.getItem(LS_KEY)"));
  ok('an unpublished paid mark survives the save', ls.cols[0].hands.filter(h=>h.paid).length===1);   // stripping it here would silently lose «сделать платной» on every reload
  ok('localStorage carries the schema stamp', ls.v===ev("LS_V"));
  // a save from before the fix must lose its folded hands and stop claiming to be dirty
  ev(`localStorage.setItem(LS_KEY,JSON.stringify({cols:[{id:'tst',name:'T',emoji:'x',accent:'#000',
     hands:[{title:'a'},{title:'X',paid:true},{title:'X',paid:true},{title:'b'}]}],curCol:0,dirty:true}));restore();`);
  ok('stale save is healed on restore', ev("findCol('tst').hands.map(h=>h.title).join(',')")==='a,b');
  ok('stale save no longer blocks cloud adoption', ev("_dirty")===false);

  console.log('\n'+pass+' passed, '+fail+' failed');
  process.exit(fail?1:0);
})();
