// Verify Stage 3b progress log: per-user attempts write via SDK client, anon skip, durable queue.
const fs=require('fs');const {JSDOM}=require('jsdom');
const html=fs.readFileSync(__dirname+'/poker-trainer.html','utf8');
let pass=0,fail=0;
function ok(name,cond){if(cond){pass++;console.log('  ok  '+name);}else{fail++;console.log('  FAIL '+name);}}
function boot(){const dom=new JSDOM(html,{runScripts:'dangerously',url:'https://danilakruzhkov-arch.github.io/poker-trainer/',pretendToBeVisual:true});return dom.window;}

console.log('== attempts wiring (static) ==');
{
  ok('logs each answer from choose()', /showSheet\(v,\{grade,id,pts\}\);\s*\n?\s*logAttempt\(\)/.test(html));
  ok('writes via SDK client, not the anon-key path', /c\.from\('attempts'\)\.insert/.test(html)&&!/supaInsert\('attempts'/.test(html));
  ok('anonymous plays are not recorded', /async function logAttempt\(\)\{\s*if\(!CURUSER\)return;/.test(html));
  ok('durable local queue on failure', /pk_attempts/.test(html)&&/atQueueGet\(\)/.test(html));
  ok('queue capped', /while\(q\.length>500\)q\.shift\(\)/.test(html));
  ok('flushes queue on sign-in', /if\(CURUSER\)flushAttempts\(\)/.test(html));
}

console.log('== migration ==');
{
  const sql=fs.readFileSync(__dirname+'/deploy/supabase-attempts-migration.sql','utf8');
  ok('attempts table created', /create table if not exists public\.attempts/.test(sql));
  ok('user_id defaults to auth.uid()', /user_id\s+uuid not null default auth\.uid\(\)/.test(sql));
  ok('RLS enabled', /alter table public\.attempts enable row level security/.test(sql));
  ok('insert policy checks ownership', /for insert to authenticated with check \(auth\.uid\(\) = user_id\)/.test(sql));
  ok('read policy checks ownership', /for select to authenticated using \(auth\.uid\(\) = user_id\)/.test(sql));
  ok('no update/delete policy (append-only)', !/for (update|delete)/.test(sql));
  ok('per-user stats index', /attempts_user_created_idx/.test(sql));
}

console.log('== logAttempt behaviour (stubbed SDK) ==');
{
  const W=boot();const ev=c=>W.eval(c);
  ev("window.__ins=[];window.__ok=true;window.supabase={createClient:()=>({from:(t)=>({insert:async(row)=>{if(!window.__ok)return {error:{message:'x'}};window.__ins.push({t,row});return {error:null};}}),auth:{getSession:async()=>({data:{session:null}}),onAuthStateChange:()=>{},signInWithOAuth:async()=>{},signOut:async()=>{}}})};_sb=null;");
  ev("fbContext=()=>({pack:'ft10k',pack_title:'Финалка',hand:'AKs',street:'flop',q_index:2,q_total:3,pick_label:'Колл',pick_grade:'best',hero_label:'Колл'});");
  return (async()=>{
    // anon -> nothing written, nothing queued
    ev("CURUSER=null;try{localStorage.removeItem('pk_attempts')}catch(e){}");
    await ev("logAttempt()");
    ok('anon: no DB write', ev("window.__ins.length")===0);
    ok('anon: no queue', ev("JSON.parse(localStorage.getItem('pk_attempts')||'[]').length")===0);

    // signed-in, online -> one row inserted into 'attempts' with the right shape
    ev("CURUSER={id:'u1'};window.__ins=[];");
    await ev("logAttempt()");
    ok('signed-in: one insert', ev("window.__ins.length")===1);
    ok('insert targets attempts table', ev("window.__ins[0].t")==='attempts');
    ok('row carries grade', ev("window.__ins[0].row.grade")==='best');
    ok('row carries pack + hand', ev("window.__ins[0].row.pack")==='ft10k'&&ev("window.__ins[0].row.hand")==='AKs');
    ok('row has no user_id (server default auth.uid())', ev("window.__ins[0].row.user_id===undefined"));

    // signed-in, offline (insert errors) -> row goes to the durable queue
    ev("window.__ok=false;window.__ins=[];try{localStorage.removeItem('pk_attempts')}catch(e){}");
    await ev("logAttempt()");
    ok('offline: queued locally', ev("JSON.parse(localStorage.getItem('pk_attempts')||'[]').length")===1);

    // back online -> flushAttempts drains the queue
    ev("window.__ok=true;window.__ins=[];");
    await ev("flushAttempts()");
    ok('flush drains the queue', ev("JSON.parse(localStorage.getItem('pk_attempts')||'[]').length")===0);
    ok('flush wrote the queued row', ev("window.__ins.length")===1);

    console.log('\n'+pass+' passed, '+fail+' failed');
    process.exit(fail?1:0);
  })();
}
