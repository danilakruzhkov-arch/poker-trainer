// Sync layer (post-redesign): Supabase is the single source of truth.
//  - reads come from the per-pack `pack` table via DIRECT REST (no CDN SDK)
//  - the only read fallback is this browser's localStorage cache (never a static packs.json)
//  - writes are per-pack (only changed rows upserted, removed packs deleted), admin-gated via RLS
//  - freshness is a slug:version signature; a downgrade guard refuses empty/broken reads and empty publishes
const fs=require('fs');const {JSDOM}=require('jsdom');
const html=fs.readFileSync(__dirname+'/poker-trainer.html','utf8');
let pass=0,fail=0;
function ok(n,c){if(c){pass++;console.log('  ok  '+n);}else{fail++;console.log('  FAIL '+n);}}
function boot(){const dom=new JSDOM(html,{runScripts:'dangerously',url:'https://danilakruzhkov-arch.github.io/poker-trainer/',pretendToBeVisual:true});return dom.window;}

console.log('== static wiring ==');
ok('reads the per-pack table via direct REST',      /PACK_EP=SUPA_URL\+'\/rest\/v1\/pack'/.test(html)&&/fetch\(PACK_EP\+'\?select=slug,position,data,version&order=position\.asc'/.test(html));
ok('read uses the anon apikey header',              /function packHeaders\(\)\{return \{apikey:SUPA_ANON,Authorization:'Bearer '\+SUPA_ANON\}/.test(html));
ok('read fallback order: same-origin packs.json, then localStorage cache',/fetch\(PACKS_JSON\+'\?_='/.test(html)&&/localStorage\.getItem\(CACHE_KEY\)/.test(html)&&!/fetch\(GH_FILE/.test(html));
ok('static fallback is same-origin + read-only (never republished)',/const PACKS_JSON='packs\.json'/.test(html)&&/return \{cols,sig,source:'static'\}/.test(html));
ok('read caches the last good snapshot',            /localStorage\.setItem\(CACHE_KEY,JSON\.stringify\(\{cols,sig,ts:Date\.now\(\)\}\)\)/.test(html));
ok('publish is a per-pack upsert by slug',          /c\.from\('pack'\)\.upsert\(changed,\{onConflict:'slug'\}\)/.test(html));
ok('publish deletes packs removed locally',         /c\.from\('pack'\)\.delete\(\)\.eq\('slug',s\)/.test(html));
ok('publish guards against wiping the whole set',   /if\(!cols\.length\)\{if\(!auto\)pubSay\('Пусто/.test(html));
ok('publish requires Google sign-in',               /if\(!CURUSER\)\{if\(!auto\)pubSay\('Войди через Google/.test(html));
ok('schedulePublish gates on CURUSER',              /if\(!CURUSER\)\{updSync\('unpushed'\);return;\}/.test(html));
ok('syncPacks adopts on a version-signature change',/const changed=pub\.sig!==_syncedSig;/.test(html));
ok('syncPacks downgrade guard: empty cloud ignored',/if\(!pub\.cols\|\|!pub\.cols\.length\)\{updSync\('synced'\);return;\}/.test(html));
ok('no id=1 blob write remains',                    !/from\('packs'\)/.test(html));
ok('persist stamps the baseline sig',               /dirty:_dirty,sig:_syncedSig/.test(html));

console.log('== read: direct REST + cache fallback ==');
(async()=>{
  { const W=boot();const ev=c=>W.eval(c);
    ev(`window.__fetched=null;
        window.fetch=async(u,opts)=>{window.__fetched={u:String(u),headers:(opts&&opts.headers)||{}};return {ok:true,json:async()=>[
          {slug:'pA',position:0,version:3,data:{id:'pA',name:'Cloud A',hands:[]}},
          {slug:'pB',position:1,version:7,data:{id:'pB',name:'Cloud B',hands:[]}}]};};
        try{localStorage.removeItem(CACHE_KEY);}catch(e){}`);
    await W.eval('(async()=>{window.__pub=await loadPublished();})()');
    ok('returns cloud cols, in position order', ev('window.__pub.cols.length')===2&&ev("window.__pub.cols[0].id")==='pA'&&ev("window.__pub.cols[1].id")==='pB');
    ok('source is the db',                      ev('window.__pub.source')==='db');
    ok('hits the /rest/v1/pack endpoint',       /\/rest\/v1\/pack\?select=slug,position,data,version&order=position\.asc/.test(ev('window.__fetched.u')));
    ok('sends the anon apikey header',          ev('window.__fetched.headers.apikey')===ev('SUPA_ANON'));
    ok('sig is a slug:version list',            ev('window.__pub.sig')==='pA:3|pB:7');
    ok('caches the snapshot to CACHE_KEY',      ev('JSON.parse(localStorage.getItem(CACHE_KEY)).cols.length')===2&&ev('JSON.parse(localStorage.getItem(CACHE_KEY)).sig')==='pA:3|pB:7');
  }
  { const W=boot();const ev=c=>W.eval(c);   // REST blocked (ad-blocker rubbing supabase.co) → same-origin packs.json
    ev(`try{localStorage.removeItem(CACHE_KEY);}catch(e){}
        window.fetch=async(u)=>{u=String(u);
          if(u.indexOf('/rest/v1/pack')>=0)throw new Error('supabase blocked');
          if(u.indexOf('packs.json')>=0)return {ok:true,json:async()=>({cols:[{id:'sx',name:'StaticPack',hands:[]}],publishedAt:123,sig:'sx:9'})};
          return {ok:false};};`);
    await W.eval('(async()=>{window.__pub=await loadPublished();})()');
    ok('REST blocked → same-origin packs.json adopted', ev('window.__pub.source')==='static'&&ev("window.__pub.cols[0].id")==='sx'&&ev('window.__pub.sig')==='sx:9');
    ok('static read is cached for the next load',        ev('JSON.parse(localStorage.getItem(CACHE_KEY)).sig')==='sx:9');
  }
  { const W=boot();const ev=c=>W.eval(c);   // legacy bare-array packs.json (no wrapper) still readable
    ev(`try{localStorage.removeItem(CACHE_KEY);}catch(e){}
        window.fetch=async(u)=>{u=String(u);
          if(u.indexOf('/rest/v1/pack')>=0)throw new Error('blocked');
          if(u.indexOf('packs.json')>=0)return {ok:true,json:async()=>[{id:'ba',name:'BareArray',hands:[]}]};
          return {ok:false};};`);
    await W.eval('(async()=>{window.__pub=await loadPublished();})()');
    ok('legacy bare-array packs.json still works',        ev('window.__pub.source')==='static'&&ev("window.__pub.cols[0].id")==='ba');
  }
  { const W=boot();const ev=c=>W.eval(c);   // everything down (REST + static) → this browser's cache
    ev(`try{localStorage.setItem(CACHE_KEY,JSON.stringify({cols:[{id:'cx',name:'Cached',hands:[]}],sig:'cx:9',ts:1}));}catch(e){}
        window.fetch=async()=>{throw new Error('network down');};`);
    await W.eval('(async()=>{window.__pub=await loadPublished();})()');
    ok('REST + static both down → falls back to the cache', ev('window.__pub.source')==='cache'&&ev("window.__pub.cols[0].id")==='cx'&&ev('window.__pub.sig')==='cx:9');
  }
  { const W=boot();const ev=c=>W.eval(c);
    ev(`try{localStorage.removeItem(CACHE_KEY);}catch(e){}
        window.fetch=async()=>({ok:true,json:async()=>[]});`);   // DB returns an empty set
    await W.eval('(async()=>{window.__pub=await loadPublished();})()');
    ok('empty DB read + no cache → null (nothing to adopt)', ev('window.__pub')===null);
  }

  console.log('== publish: per-pack, admin-gated ==');
  function mockSink(W){W.eval(`window.__ups=[];window.__dels=[];
    loadSupaSDK=async()=>({});
    _sb={from:function(t){return {
      upsert:async function(rows,opts){window.__ups.push(rows);return {error:null};},
      delete:function(){return {eq:async function(col,val){window.__dels.push(val);return {error:null};}};}
    };}};
    authClient=function(){return _sb;};
    loadPublished=async()=>({cols:[],sig:'refreshed'});`);}   // stub the post-publish sig refresh

  { const W=boot();const ev=c=>W.eval(c);mockSink(W);
    ev(`CURUSER={email:'danilakruzhkov@gmail.com'};
        COLS=[{id:'pA',name:'A',hands:[]},{id:'pB',name:'B',hands:[]},{id:'mine',name:'Мой набор',hands:[]}];useCol(0);
        _syncedMap={};`);   // empty baseline → every shared pack counts as changed
    const okPub=await W.eval('publishPacks(false)');
    ok('publishPacks returns true when signed in', okPub===true);
    ok('a single batched upsert call',             ev('window.__ups.length')===1);
    ok('upsert carries pA + pB, excludes "mine"',  ev('JSON.stringify(window.__ups[0].map(r=>r.slug))')==='["pA","pB"]');
    ok('rows carry slug + position + data',        ev("window.__ups[0][0].slug")==='pA'&&ev('window.__ups[0][0].position')===0&&ev('!!window.__ups[0][0].data')===true);
    ok('freshness sig rebased after publish',      ev('_syncedSig')==='refreshed');
  }

  { const W=boot();const ev=c=>W.eval(c);mockSink(W);
    ev(`CURUSER={email:'daanilka@gmail.com'};
        COLS=[{id:'pA',name:'A2',hands:[]},{id:'pB',name:'B',hands:[]},{id:'mine',name:'m',hands:[]}];useCol(0);
        _syncedMap=colsMap([{id:'pA',name:'A-OLD',hands:[]},{id:'pB',name:'B',hands:[]},{id:'pGONE',name:'G',hands:[]}]);`);
    await W.eval('publishPacks(true)');
    ok('only the changed pack (pA) is upserted',   ev('JSON.stringify(window.__ups[0].map(r=>r.slug))')==='["pA"]');
    ok('the unchanged pack (pB) is NOT rewritten', ev('window.__ups[0].some(r=>r.slug==="pB")')===false);
    ok('the removed pack (pGONE) is deleted',      ev('JSON.stringify(window.__dels)')==='["pGONE"]');
  }

  { const W=boot();const ev=c=>W.eval(c);mockSink(W);
    ev(`CURUSER=null;COLS=[{id:'pA',name:'A',hands:[]}];useCol(0);_syncedMap={};`);
    const noPub=await W.eval('publishPacks(false)');
    ok('publishPacks returns false when signed out', noPub===false);
    ok('no upsert attempted when signed out',        ev('window.__ups.length')===0);
    W.eval('schedulePublish()');
    ok('schedulePublish signed-out does not publish', ev('window.__ups.length')===0);
  }

  { const W=boot();const ev=c=>W.eval(c);mockSink(W);
    ev(`CURUSER={email:'danilakruzhkov@gmail.com'};COLS=[{id:'mine',name:'m',hands:[]}];useCol(0);_syncedMap={};`);   // only the personal pack → nothing shared
    const r=await W.eval('publishPacks(false)');
    ok('publish refuses to wipe (empty shared set → false)', r===false&&ev('window.__ups.length')===0);
  }

  console.log('== syncPacks: sig-gated adoption + guards ==');
  { const W=boot();const ev=c=>W.eval(c);
    ev(`COLS=[{id:'pA',name:'Local A',hands:[]},{id:'mine',name:'m',hands:[]}];useCol(0);_dirty=false;_syncedSig='pA:1';
        loadPublished=async()=>({cols:[{id:'pA',name:'Cloud A NEW',hands:[]}],sig:'pA:2'});`);
    await W.eval('syncPacks()');
    ok('clean + newer sig → adopts cloud', ev("findCol('pA').name")==='Cloud A NEW'&&ev('_syncedSig')==='pA:2');
  }
  { const W=boot();const ev=c=>W.eval(c);
    ev(`COLS=[{id:'pA',name:'Local A',hands:[]},{id:'mine',name:'m',hands:[]}];useCol(0);_dirty=false;_syncedSig='pA:2';
        loadPublished=async()=>({cols:[{id:'pA',name:'Cloud A',hands:[]}],sig:'pA:2'});`);
    await W.eval('syncPacks()');
    ok('clean + same sig → no adopt (local kept)', ev("findCol('pA').name")==='Local A');
  }
  { const W=boot();const ev=c=>W.eval(c);
    ev(`COLS=[{id:'pA',name:'Local A',hands:[{}]},{id:'mine',name:'m',hands:[]}];useCol(0);_dirty=false;_syncedSig='pA:1';
        loadPublished=async()=>({cols:[],sig:'zzz'});`);   // broken/empty cloud read despite a new sig
    await W.eval('syncPacks()');
    ok('downgrade guard: empty cloud not adopted', ev("!!findCol('pA')")===true&&ev("findCol('pA').name")==='Local A');
  }

  console.log('\n'+pass+' passed, '+fail+' failed');
  process.exit(fail?1:0);
})();
