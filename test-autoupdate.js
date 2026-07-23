// Verify auto-update: version.json generation, version-check banner, live packs re-adopt.
const fs=require('fs');const {execSync}=require('child_process');const {JSDOM}=require('jsdom');
const html=fs.readFileSync(__dirname+'/poker-trainer.html','utf8');
let pass=0,fail=0;
function ok(name,cond){if(cond){pass++;console.log('  ok  '+name);}else{fail++;console.log('  FAIL '+name);}}
function boot(url){const dom=new JSDOM(html,{runScripts:'dangerously',url:url||'https://danilakruzhkov-arch.github.io/poker-trainer/',pretendToBeVisual:true});return dom.window;}

console.log('== version.json generated from APP_VER by wrap.js ==');
{
  execSync('node "'+__dirname+'/wrap.js"',{stdio:'ignore'});   // quoted: the project path contains a space ("Claude Code")
  const vjson=JSON.parse(fs.readFileSync(__dirname+'/deploy/version.json','utf8'));
  const appver=(html.match(/APP_VER\s*=\s*'([^']+)'/)||[])[1];
  ok('version.json has a ver field', !!vjson.ver);
  ok('version.json ver === APP_VER in source', vjson.ver===appver);
  const built=fs.readFileSync(__dirname+'/deploy/index.html','utf8');
  ok('built index.html carries the same APP_VER', built.indexOf("APP_VER='"+appver+"'")>=0);
}

console.log('== version-check wiring (static) ==');
{
  ok('checkAppVersion fetches version.json cache-busted', /fetch\('version\.json\?_='\+Date\.now\(\)/.test(html));
  ok('version fetch uses cache:no-store', /version\.json[\s\S]{0,40}no-store/.test(html));
  ok('only shows when cloud !== APP_VER', /cloud&&cloud!==APP_VER/.test(html));
  ok('update button busts the CDN with a fresh ?v=', /location\.pathname\+'\?v='\+Date\.now\(\)/.test(html));
  ok('strips ?v= from the address bar on load', /history\.replaceState/.test(html)&&/location\.search/.test(html));
  ok('re-checks on visibilitychange', /addEventListener\('visibilitychange'/.test(html));
  ok('visibility re-sync is throttled (20s)', /_lastSync<20000/.test(html));
  ok('packs re-adopt guarded by sig + dirty/non-admin gate', /const changed=pub\.sig!==_syncedSig/.test(html)&&/if\(!_dirty\|\|\(_authReady&&!isAdmin\(\)\)\)\{/.test(html));
  ok('service worker still NOT introduced', !/serviceWorker|navigator\.serviceWorker/.test(html));
}

console.log('== update banner behaviour (unit) ==');
{
  const W=boot();
  W.eval("showUpdateBanner('2999-01-01')");
  const b=W.document.getElementById('verBanner');
  ok('banner element created for a newer version', !!b);
  ok('banner offers «Обновить»', !!b&&/Обновить/.test(b.innerHTML));
  ok('banner offers a dismiss (×)', !!b&&/vbx/.test(b.innerHTML));
  W.eval("showUpdateBanner('2999-01-01')");
  ok('banner not duplicated on second call', W.document.querySelectorAll('#verBanner').length===1);
}
{
  const W=boot();
  W.eval("try{sessionStorage.setItem('pk_ver_skip','2999-01-01')}catch(e){};showUpdateBanner('2999-01-01')");
  ok('dismissed version stays suppressed this session', !W.document.getElementById('verBanner'));
}

console.log('== packs re-adopt keeps unpublished local edits ==');
{
  const W=boot();const ev=c=>W.eval(c);
  // simulate a dirty browser, then a syncPacks with fresher cloud — local edits must survive (no adopt)
  ev("_dirty=true;COLS=[{id:'x',name:'МОЁ-ЧЕРНОВИК',emoji:'x',hands:[]},{id:'mine',name:'Мой',emoji:'m',hands:[]}];PUBLISHED={publishedAt:1};");
  ev("loadPublished=async()=>({cols:[{id:'y',name:'ОБЛАКО',emoji:'y',hands:[]}],publishedAt:999});");
  return (async()=>{
    await ev("syncPacks()");
    ok('dirty browser keeps local draft (cloud not adopted)', ev("COLS.some(c=>c.name==='МОЁ-ЧЕРНОВИК')"));
    // clean browser adopts fresher cloud
    ev("_dirty=false;PUBLISHED={publishedAt:1};COLS=[{id:'mine',name:'Мой',emoji:'m',hands:[]}];");
    await ev("syncPacks()");
    ok('clean browser adopts fresher cloud packs', ev("COLS.some(c=>c.name==='ОБЛАКО')"));
    ok('personal «Мой набор» preserved through adopt', ev("COLS.some(c=>c.id==='mine')"));
    console.log('\n'+pass+' passed, '+fail+' failed');
    process.exit(fail?1:0);
  })();
}
