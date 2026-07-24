// Editor access gate: no password; «Редактор раздач» is admin-only by Google email (Supabase RLS is the real write-lock).
const fs=require('fs');const {JSDOM}=require('jsdom');
const html=fs.readFileSync(__dirname+'/poker-trainer.html','utf8');
let pass=0,fail=0;
function ok(n,c){if(c){pass++;console.log('  ok  '+n);}else{fail++;console.log('  FAIL '+n);}}
function boot(){const dom=new JSDOM(html,{runScripts:'dangerously',url:'https://danilakruzhkov-arch.github.io/poker-trainer/',pretendToBeVisual:true});return dom.window;}

console.log('== static wiring ==');
ok('admin allowlist present',          /const ADMIN_EMAILS=\['danilakruzhkov@gmail\.com','daanilka@gmail\.com'\]/.test(html));
ok('password gate removed (no EDITOR_PASS)', !/EDITOR_PASS/.test(html));
ok('no admin123 literal anywhere',     !/admin123/.test(html));
ok('authGate modal removed',           !/id="authGate"/.test(html));
ok('editor tab hidden by default',     /id="tab-admin" style="display:none"/.test(html));
ok('tab bar hidden by default',        /<div class="tabs" id="tabsBar" style="display:none">/.test(html));
ok('openEditor guards on canEdit',     /function openEditor\(\)\{if\(!canEdit\(\)\)/.test(html));   // canEdit = admin OR editor role (P1б)
ok('editor role gated on the DB, with fallback', /let MYROLE='player',_rolesReady=false;/.test(html)&&/function canEdit\(\)\{return isAdmin\(\)\|\|\(_rolesReady&&MYROLE==='editor'\)/.test(html));
ok('moderation tab + gate present',    /id="tab-mod"/.test(html)&&/function canModerate\(\)\{return _rolesReady&&\(isAdmin\(\)\|\|MYROLE==='editor'\)/.test(html));
ok('renderAuth reconciles admin tab',  /function renderAuth\(\)\{\s*renderAdminAccess\(\)/.test(html));
ok('no gh-token UI/handlers remain',   !/id="gh-token"|\$\('gh-save'\)|\$\('gh-clear'\)/.test(html));

console.log('== behavior ==');
(async()=>{
  const W=boot();const ev=c=>W.eval(c);

  ev('CURUSER=null;');
  ok('isAdmin false when logged out',            ev('isAdmin()')===false);
  W.eval('renderAdminAccess()');
  ok('tab hidden when logged out',               ev("document.getElementById('tab-admin').style.display")==='none');
  ok('tab bar hidden when logged out',           ev("document.getElementById('tabsBar').style.display")==='none');
  ev('openEditor()');
  ok('openEditor refused when not admin',        ev("document.getElementById('view-admin').style.display")==='none');

  ev("CURUSER={email:'randomguy@gmail.com'};");
  ok('isAdmin false for a non-admin email',      ev('isAdmin()')===false);
  W.eval('renderAdminAccess()');
  ok('tab hidden for a non-admin email',         ev("document.getElementById('tab-admin').style.display")==='none');

  ev("CURUSER={email:'DaNiLaKruzhkov@gmail.com'};");   // mixed case → must still match
  ok('isAdmin true for admin email (case-insensitive)', ev('isAdmin()')===true);
  W.eval('renderAdminAccess()');
  ok('tab shown for admin',                      ev("document.getElementById('tab-admin').style.display")==='');
  ok('tab bar shown for admin',                  ev("document.getElementById('tabsBar').style.display")==='');
  ev('openEditor()');
  ok('openEditor opens the editor for admin',    ev("document.getElementById('view-admin').style.display")!=='none');

  ev('CURUSER=null;renderAdminAccess();');             // session drops while in editor
  ok('logout while editing returns to trainer',  ev("document.getElementById('view-admin').style.display")==='none');
  ok('tab hidden again after logout',            ev("document.getElementById('tab-admin').style.display")==='none');

  console.log('\n'+pass+' passed, '+fail+' failed');
  process.exit(fail?1:0);
})();
