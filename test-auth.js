// Verify Stage 3a auth: Google sign-in wiring, session handling, renderAuth states, XSS-safety.
const fs=require('fs');const {JSDOM}=require('jsdom');
const html=fs.readFileSync(__dirname+'/poker-trainer.html','utf8');
let pass=0,fail=0;
function ok(name,cond){if(cond){pass++;console.log('  ok  '+name);}else{fail++;console.log('  FAIL '+name);}}
function boot(){const dom=new JSDOM(html,{runScripts:'dangerously',url:'https://danilakruzhkov-arch.github.io/poker-trainer/',pretendToBeVisual:true});return dom.window;}

console.log('== auth wiring (static) ==');
{
  ok('loads supabase-js SDK on demand', /cdn\.jsdelivr\.net\/npm\/@supabase\/supabase-js@2/.test(html));
  ok('SDK loaded lazily (not a blocking <script src> in head)', !/<script src=.*supabase-js/.test(html));
  ok('signs in with Google OAuth provider', /signInWithOAuth\(\{provider:'google'/.test(html));
  ok('OAuth redirects back to the current page', /redirectTo:location\.origin\+location\.pathname/.test(html));
  ok('reads existing session on load', /auth\.getSession\(\)/.test(html));
  ok('subscribes to auth state changes', /onAuthStateChange/.test(html));
  ok('persists session + auto-refresh + detect callback', /persistSession:true[\s\S]{0,60}autoRefreshToken:true[\s\S]{0,60}detectSessionInUrl:true/.test(html));
  ok('avatar uses no-referrer (Google 403 guard)', /referrerpolicy="no-referrer"/.test(html));
  ok('auth control markup slot present', /id="authSlot"/.test(html));
  ok('initAuth called at boot', /initAuth\(\);syncPacks\(\)/.test(html));
}

console.log('== migration + setup docs ==');
{
  const sql=fs.readFileSync(__dirname+'/deploy/supabase-auth-migration.sql','utf8');
  ok('profiles table created', /create table if not exists public\.profiles/.test(sql));
  ok('profiles RLS enabled', /alter table public\.profiles enable row level security/.test(sql));
  ok('own-profile read policy (authenticated)', /for select to authenticated using \(auth\.uid\(\) = id\)/.test(sql));
  ok('auto-create profile trigger on signup', /create trigger on_auth_user_created[\s\S]{0,80}on auth\.users/.test(sql));
  ok('trigger fn is SECURITY DEFINER', /security definer/.test(sql));
  const doc=fs.readFileSync(__dirname+'/deploy/GOOGLE-AUTH-SETUP.md','utf8');
  ok('setup doc has the exact Supabase callback URL', /mydnywznytluikbwbhsk\.supabase\.co\/auth\/v1\/callback/.test(doc));
  ok('setup doc keeps secrets off the client', /Client Secret/.test(doc)&&/Supabase/.test(doc));
}

console.log('== renderAuth states (stubbed SDK) ==');
{
  const W=boot();const ev=c=>W.eval(c);
  // stub the SDK so authClient() returns a fake client
  ev("window.supabase={createClient:()=>({auth:{getSession:async()=>({data:{session:null}}),onAuthStateChange:()=>{},signInWithOAuth:async()=>{},signOut:async()=>{}}})};_sb=null;");
  ev("CURUSER=null;renderAuth();");
  let s=()=>W.document.getElementById('authSlot').innerHTML;
  ok('logged out -> «Войти» button', /authIn/.test(s())&&/Войти/.test(s()));
  ok('login button carries the Google icon', /class="gic"/.test(s()));
  ev("CURUSER={email:'x@y.com',user_metadata:{full_name:'Данила К',avatar_url:'https://a/b.png'}};renderAuth();");
  ok('logged in -> shows display name', /Данила К/.test(s()));
  ok('logged in -> shows avatar', /b\.png/.test(s())&&/no-referrer/.test(s()));
  ok('logged in -> offers «Выйти»', /authOut/.test(s())&&/Выйти/.test(s()));
  // helpers
  ok('userName prefers full_name', ev("userName({email:'x@y.com',user_metadata:{full_name:'Про Игрок'}})")==='Про Игрок');
  ok('userName falls back to email local-part', ev("userName({email:'grinder@mail.com',user_metadata:{}})")==='grinder');
  ok('userAvatar reads picture fallback', ev("userAvatar({user_metadata:{picture:'https://p/ic.jpg'}})")==='https://p/ic.jpg');
  // XSS: a malicious display name must be escaped
  ev("CURUSER={email:'x@y.com',user_metadata:{full_name:'<img src=x onerror=alert(1)>'}};renderAuth();");
  ok('display name is HTML-escaped (no raw <img>)', /&lt;img/.test(s())&&s().indexOf('<img src=x')<0);
}

console.log('\n'+pass+' passed, '+fail+' failed');
process.exit(fail?1:0);
