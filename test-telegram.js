// P2.1: Telegram Mini App — initData HMAC validation (security-critical) + client wiring.
// The HMAC block below MUST stay identical in logic to deploy/edge/_shared/initdata.ts.
const fs=require('fs');const {JSDOM}=require('jsdom');
const {webcrypto}=require('crypto');const subtle=webcrypto.subtle;
const html=fs.readFileSync(__dirname+'/poker-trainer.html','utf8');
let pass=0,fail=0;
function ok(n,c){if(c){pass++;console.log('  ok  '+n);}else{fail++;console.log('  FAIL '+n);}}

// ---- reference impl of the Telegram Web App HMAC (mirror of _shared/initdata.ts) ----
async function hmac(keyBytes,msg){
  const k=await subtle.importKey('raw',keyBytes,{name:'HMAC',hash:'SHA-256'},false,['sign']);
  const s=await subtle.sign('HMAC',k,new TextEncoder().encode(msg));return new Uint8Array(s);}
const hex=b=>[...b].map(x=>x.toString(16).padStart(2,'0')).join('');
async function signInitData(params,botToken){                       // build a VALID initData string
  const pairs=Object.keys(params).map(k=>`${k}=${params[k]}`).sort();
  const dcs=pairs.join('\n');
  const secret=await hmac(new TextEncoder().encode('WebAppData'),botToken);
  const h=hex(await hmac(secret,dcs));
  const usp=new URLSearchParams(params);usp.set('hash',h);return usp.toString();}
async function validate(initData,botToken,maxAgeSec=86400){          // mirror of validateInitData()
  const p=new URLSearchParams(initData);const hash=p.get('hash');if(!hash)return {ok:false,reason:'no hash'};
  p.delete('hash');const pairs=[];for(const [k,v] of p)pairs.push(`${k}=${v}`);pairs.sort();
  const secret=await hmac(new TextEncoder().encode('WebAppData'),botToken);
  const calc=hex(await hmac(secret,pairs.join('\n')));
  if(calc!==hash)return {ok:false,reason:'bad hash'};
  const ad=parseInt(p.get('auth_date')||'0',10);const now=Math.floor(Date.now()/1000);
  if(!ad||now-ad>maxAgeSec)return {ok:false,reason:'stale'};
  let user;try{user=JSON.parse(p.get('user')||'null');}catch(e){}
  if(!user||!user.id)return {ok:false,reason:'no user'};
  return {ok:true,user};}

(async()=>{
console.log('== initData HMAC validation (security-critical) ==');
{
  const TOKEN='123456:TEST_bot_token_ABCdef';
  const now=Math.floor(Date.now()/1000);
  const good=await signInitData({auth_date:now,query_id:'AAH',user:JSON.stringify({id:777,first_name:'Дан',username:'dan'})},TOKEN);
  const v=await validate(good,TOKEN);
  ok('valid initData passes',v.ok===true&&v.user&&v.user.id===777);

  const tampered=good.replace(/query_id=[^&]*/,'query_id=HACKED');   // change a signed top-level field
  ok('tampered field is rejected',tampered!==good&&(await validate(tampered,TOKEN)).ok===false);

  ok('wrong bot token is rejected',(await validate(good,'999:WRONG')).ok===false);

  const forgedHash=good.replace(/hash=[^&]*/,'hash=deadbeef');
  ok('forged hash is rejected',(await validate(forgedHash,TOKEN)).ok===false);

  const stale=await signInitData({auth_date:now-90000,user:JSON.stringify({id:1})},TOKEN);
  ok('stale auth_date is rejected',(await validate(stale,TOKEN)).ok===false);

  const noUser=await signInitData({auth_date:now},TOKEN);
  ok('missing user is rejected',(await validate(noUser,TOKEN)).ok===false);
}

console.log('== the deployed Edge validator keeps the critical invariants ==');
{
  const edge=fs.readFileSync(__dirname+'/deploy/edge/_shared/initdata.ts','utf8');
  ok('derives secret from "WebAppData" key',/encode\("WebAppData"\)/.test(edge));
  ok('sorts the data_check_string',/pairs\.sort\(\)/.test(edge));
  ok('constant-time hash compare',/timingSafeEqual/.test(edge));
  ok('enforces auth_date freshness',/maxAgeSec/.test(edge)&&/stale auth_date/.test(edge));
  const auth=fs.readFileSync(__dirname+'/deploy/edge/tg-auth/index.ts','utf8');
  ok('tg-auth validates initData before issuing a link',/validateInitData/.test(auth)&&auth.indexOf('validateInitData')<auth.indexOf('generateLink'));
  ok('tg-auth never sends email (OTP handed back)',/email_otp/.test(auth));
  const wh=fs.readFileSync(__dirname+'/deploy/edge/tg-webhook/index.ts','utf8');
  ok('webhook checks the secret header',/x-telegram-bot-api-secret-token/.test(wh));
  ok('webhook grant is idempotent',/ignoreDuplicates:\s*true/.test(wh)&&/onConflict:\s*"user_id,pack_slug"/.test(wh));
  const inv=fs.readFileSync(__dirname+'/deploy/edge/tg-invoice/index.ts','utf8');
  ok('invoice uses Stars currency XTR',/currency:\s*"XTR"/.test(inv));
  ok('invoice refuses a free pack',/free:\s*true/.test(inv));
  ok('invoice binds payment to (pack,user)',/\$\{pack_slug\}:\$\{link\.user_id\}/.test(inv));
}

console.log('== client: dormant & graceful outside Telegram ==');
function boot(){const dom=new JSDOM(html,{runScripts:'dangerously',url:'https://danilakruzhkov-arch.github.io/poker-trainer/',pretendToBeVisual:true});return dom.window;}
{
  const W=boot();const ev=c=>W.eval(c);
  ok('EDGE_BASE points at functions/v1',ev("EDGE_BASE")==='https://mydnywznytluikbwbhsk.supabase.co/functions/v1');
  ok('not a Telegram shell in a normal browser',ev("inTelegramShell()")===false);
  ok('isTelegram() false without WebApp',ev("isTelegram()")===false);
  // the Telegram SDK is NEVER injected outside a Telegram shell
  await ev("(async()=>{await tgWA();})()");
  ok('SDK not loaded outside Telegram',!W.document.querySelector('script[src*="telegram-web-app"]'));
  // tgBuy outside a shell just tells the user where to pay — no throw, no fetch
  let fetched=false;W.fetch=()=>{fetched=true;return Promise.resolve({ok:true,json:async()=>({})});};
  await ev("tgBuy('mtt16k')");
  ok('tgBuy is inert outside Telegram (no invoice call)',fetched===false);
}

console.log('== client: Telegram shell detection + one-tap login (mocked) ==');
{
  const W=boot();const ev=c=>W.eval(c);
  W.TelegramWebviewProxy={};                                         // pretend we are inside Telegram
  ok('shell detected via TelegramWebviewProxy',ev("inTelegramShell()")===true);
  // stub the SDK + the two network hops so we can drive the happy path
  W.Telegram={WebApp:{initData:'auth_date=1&user=%7B%22id%22%3A5%7D&hash=x',ready(){},expand(){},openInvoice(link,cb){W.__lastInvoice=link;cb('paid');}}};
  ev("loadSupaSDK=async()=>({});");
  ev("authClient=()=>({auth:{verifyOtp:async()=>({data:{user:{id:'u-tg',email:'tg5@telegram.local'}},error:null})}});");
  W.fetch=(u,o)=>{
    if(/tg-auth/.test(u))return Promise.resolve({ok:true,json:async()=>({email:'tg5@telegram.local',otp:'123456',user_id:'u-tg'})});
    if(/tg-invoice/.test(u))return Promise.resolve({ok:true,json:async()=>({invoice_link:'https://t.me/invoice/abc',stars:377})});
    return Promise.resolve({ok:true,json:async()=>({})});
  };
  const okLogin=await ev("tgSignIn()");
  ok('tgSignIn returns true and sets the user',okLogin===true&&ev("CURUSER&&CURUSER.id")==='u-tg');
  // tgBuy → invoice link opened via WebApp.openInvoice, 'paid' triggers a re-fetch of entitlements
  let refreshed=false;ev("refreshOwned=async()=>{globalThis.__ref=true;};");W.__ref=false;ev("refreshGate=()=>{};");
  await ev("tgBuy('mtt16k')");
  ok('tgBuy opened the Stars invoice',W.__lastInvoice==='https://t.me/invoice/abc');
  ok('paid callback re-reads entitlements',await ev("new Promise(r=>setTimeout(()=>r(globalThis.__ref),1600))")===true);
}

console.log('\n'+pass+' passed, '+fail+' failed');
process.exit(fail?1:0);
})();
