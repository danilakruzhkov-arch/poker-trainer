// P1б: editor role (DB-gated, graceful fallback) + moderation screen.
const fs=require('fs');const {JSDOM}=require('jsdom');
const html=fs.readFileSync(__dirname+'/poker-trainer.html','utf8');
let pass=0,fail=0;
function ok(name,cond){if(cond){pass++;console.log('  ok  '+name);}else{fail++;console.log('  FAIL '+name);}}
function boot(){const dom=new JSDOM(html,{runScripts:'dangerously',url:'https://danilakruzhkov-arch.github.io/poker-trainer/',pretendToBeVisual:true});return dom.window;}

console.log('== role resolution + fallback ==');
(async()=>{
{
  const W=boot();const ev=c=>W.eval(c);
  ev("loadSupaSDK=async()=>({});");   // the CDN script never loads under JSDOM
  // signed in as admin, RPC missing (migration not applied) → fallback, role not "ready"
  ev("CURUSER={id:'u1',email:'daanilka@gmail.com'};authClient=()=>({rpc:async()=>({data:null,error:{message:'function my_role() does not exist'}})});");
  await ev("fetchRole()");
  ok('admin fallback without migration', ev("MYROLE")==='admin'&&ev("_rolesReady")===false);
  ok('admin can still edit (hardcoded)', ev("canEdit()")===true);
  ok('moderation stays off until migration', ev("canModerate()")===false);   // needs the DB RLS, so gate on _rolesReady

  // non-admin, RPC missing → player, nothing unlocked
  ev("CURUSER={id:'u2',email:'someone@else.com'};");
  await ev("fetchRole()");
  ok('stranger is a player on fallback', ev("MYROLE")==='player'&&ev("canEdit()")===false&&ev("canModerate()")===false);

  // migration live: RPC answers 'editor'
  ev("authClient=()=>({rpc:async(fn)=>({data:'editor',error:null})});");
  await ev("fetchRole()");
  ok('editor role from the DB', ev("MYROLE")==='editor'&&ev("_rolesReady")===true);
  ok('editor may edit', ev("canEdit()")===true);
  ok('editor may moderate', ev("canModerate()")===true);

  // migration live: RPC answers 'player' for a normal user
  ev("authClient=()=>({rpc:async()=>({data:'player',error:null})});");
  await ev("fetchRole()");
  ok('player unlocks nothing even with migration', ev("canEdit()")===false&&ev("canModerate()")===false);

  // sign-out resets the role
  ev("CURUSER=null;MYROLE='editor';_rolesReady=true;");
  ok('sign-out helper clears role', /CURUSER=null;MYROLE='player';_rolesReady=false;/.test(html));
}

console.log('== tab visibility ==');
{
  const W=boot();const ev=c=>W.eval(c);
  ev("CURUSER={id:'u1',email:'daanilka@gmail.com'};MYROLE='admin';_rolesReady=true;renderAdminAccess();");
  ok('admin sees editor tab', W.document.getElementById('tab-admin').style.display==='');
  ok('admin sees moderation tab', W.document.getElementById('tab-mod').style.display==='');
  ev("CURUSER={id:'u2',email:'ed@x.com'};MYROLE='editor';_rolesReady=true;renderAdminAccess();");
  ok('editor sees both tabs', W.document.getElementById('tab-admin').style.display===''&&W.document.getElementById('tab-mod').style.display==='');
  ev("CURUSER={id:'u3',email:'p@x.com'};MYROLE='player';_rolesReady=true;renderAdminAccess();");
  ok('player sees neither', W.document.getElementById('tab-admin').style.display==='none'&&W.document.getElementById('tab-mod').style.display==='none');
  // fallback (no migration): admin keeps editor tab, moderation stays hidden
  ev("CURUSER={id:'u1',email:'daanilka@gmail.com'};MYROLE='admin';_rolesReady=false;renderAdminAccess();");
  ok('admin editor tab shows on fallback', W.document.getElementById('tab-admin').style.display==='');
  ok('moderation tab hidden on fallback', W.document.getElementById('tab-mod').style.display==='none');
}

console.log('== moderation render + resolve ==');
{
  const W=boot();const ev=c=>W.eval(c);
  ev("loadSupaSDK=async()=>({});CURUSER={id:'u1',email:'daanilka@gmail.com'};MYROLE='admin';_rolesReady=true;authToken=async()=>'tok';");
  const calls=[];
  W.fetch=(u,o)=>{calls.push({u,o});
    if(/method/i.test(JSON.stringify(o||{}))&&o&&o.method==='PATCH')return Promise.resolve({ok:true,status:204,json:async()=>[]});
    return Promise.resolve({ok:true,status:200,json:async()=>[
      {id:'f1',created_at:'2026-07-24T02:00:00Z',pack:'mtt16k',pack_title:'MTT 16k',hand:'AKs',street:'flop',q_index:0,q_total:2,pick_label:'Рейз',pick_grade:'mistake',category:'ошибка в разборе',comment:'тут колл лучше',app_ver:'2026-07-24.29',resolved:false},
      {id:'f2',created_at:'2026-07-24T01:00:00Z',pack:'ft10k',pack_title:'FT 10k',hand:'QQ',category:'непонятно',comment:'',resolved:true,resolved_by:'daanilka@gmail.com'}]});
  };
  await ev("renderModeration()");
  const h=W.document.getElementById('modList').innerHTML;
  ok('renders one card per feedback row', (h.match(/modcard/g)||[]).length===2);
  ok('shows pack + hand location', /MTT 16k/.test(h)&&/AKs/.test(h));
  ok('translates the grade', /ошибка/.test(h));
  ok('unresolved row offers a resolve button', /modresolve/.test(h)&&/data-fid="f1"/.test(h));
  ok('resolved row shows who closed it', /обработано/.test(h)&&/daanilka@gmail.com/.test(h));
  ok('unresolved filter hits the correct query', calls.some(c=>/resolved=is\.false/.test(c.u)));
  // resolve → PATCH with the right body
  await ev("resolveFeedback('f1')");
  const patch=calls.find(c=>c.o&&c.o.method==='PATCH');
  ok('resolve PATCHes the row', !!patch&&/id=eq\.f1/.test(patch.u));
  ok('resolve marks resolved=true + who', patch&&/"resolved":true/.test(patch.o.body)&&/daanilka@gmail.com/.test(patch.o.body));

  // a non-moderator gets a message, not a fetch
  ev("_rolesReady=false;");W.document.getElementById('modList').innerHTML='';
  await ev("renderModeration()");
  ok('non-moderator sees an explanation', /миграция ролей/.test(W.document.getElementById('modList').innerHTML));
}

console.log('\n'+pass+' passed, '+fail+' failed');
process.exit(fail?1:0);
})();
