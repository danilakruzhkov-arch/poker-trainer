// Autoplay in browsers that refuse AUDIBLE autoplay (iOS WebKit, Chrome Android — Telegram's WebView is the exception).
// We no longer guess "mobile" from the UA and we never force a muted pre-roll. The clip attempts audible autoplay; if the
// browser refuses (not PLAYING/BUFFERING ~1.4s after ready) we remember that browser (pk_noautosound), drop Автовидео to
// «выкл» and explain once — from then on clips stay paused and ONE tap plays them WITH sound. The pill survives only for
// the other case: the browser DID autoplay but muted itself. Toggle lives under the video (review sheet + intro) only.
const fs=require('fs');const {JSDOM}=require('jsdom');
const html=fs.readFileSync(__dirname+'/poker-trainer.html','utf8');
let pass=0,fail=0;
function ok(n,c){if(c){pass++;console.log('  ok  '+n);}else{fail++;console.log('  FAIL '+n);}}
function boot(pre){const dom=new JSDOM(html,{runScripts:'dangerously',url:'https://danilakruzhkov-arch.github.io/poker-trainer/',pretendToBeVisual:true,
  beforeParse(window){window.matchMedia=function(q){return {matches:false,media:q,addListener(){},removeListener(){},addEventListener(){},removeEventListener(){}};};
    if(pre)try{Object.keys(pre).forEach(k=>window.localStorage.setItem(k,pre[k]));}catch(e){}}});
  return dom.window;}

console.log('== static wiring ==');
ok('NO UA/pointer sniffing left (IS_MOBILE gone)',      !/IS_MOBILE/.test(html));
ok('NO pre-mute — audible autoplay is attempted',       !/pv\.mute/.test(html));
ok('plainEmbed takes `play`, not `mute`',               /function plainEmbed\(slot,id,s,en,play\)/.test(html)&&/autoplay='\+\(play\?1:0\)/.test(html)&&!/[?&]mute=/.test(html));
ok('armAutoplayFallback takes just the player',         /function armAutoplayFallback\(player\)\{/.test(html));
ok('refused autoplay → markNoAutoSound (no mute/play)', /if\(st!==1&&st!==3\)markNoAutoSound\(\);/.test(html)&&!/player\.mute\(\);player\.playVideo\(\)/.test(html));
ok('onReady arms the fallback only when auto',          /if\(auto\)armAutoplayFallback\(player\)/.test(html));
ok('NOAUTOSOUND is remembered in localStorage',         /let NOAUTOSOUND=\(\(\)=>\{try\{return localStorage\.getItem\('pk_noautosound'\)==='1';/.test(html));
ok('markNoAutoSound persists + turns autoplay off',     /function markNoAutoSound\(\)\{if\(NOAUTOSOUND\)return;NOAUTOSOUND=true;[\s\S]{0,140}setItem\('pk_noautosound','1'\)[\s\S]{0,60}setAutoplay\(false\);toast\(NOSOUND_MSG\)/.test(html));
ok('toggle explains instead of enabling when blocked',  /function toggleAutoplay\(\)\{if\(NOAUTOSOUND&&!AUTOPLAY\)\{toast\(NOSOUND_MSG\);return;\}/.test(html));
ok('message names Telegram + ПК (his wording)',         /В этом браузере Автовидео недоступно/.test(html)&&/Telegram браузере \(открыть ссылку в чате\), либо на любом ПК\./.test(html));
ok('toggle repaints sheetAuto + introAuto only',        /\['sheetAuto','introAuto'\]\.forEach\(id=>\{const b=\$\(id\);if\(!b\)return;/.test(html));
ok('backrow «Автовидео» toggle is GONE',                !/autoToggle/.test(html));
ok('review-sheet keeps its toggle under the video',     /<div class="cliprow"><span class="clip-slot" id="clipSlot"><\/span><button class="vauto [^>]*id="sheetAuto"/.test(html));
ok('intro keeps its toggle under the video',            /<div class="cliprow"><span class="clip-slot"><\/span><button class="vauto [^>]*id="introAuto"/.test(html));
ok('both toggles share one handler',                    /sa\.onclick=toggleAutoplay/.test(html)&&/ia\.onclick=toggleAutoplay/.test(html));
ok('embedFacade separates `auto` from `play`',          /function embedFacade\(fac,auto,play\)\{/.test(html)&&/const wantPlay=\(play===undefined\?!!auto:!!play\);/.test(html)&&/autoplay:wantPlay\?1:0/.test(html));
// ONE TAP: the player is always swapped in — Автовидео off just means it sits PAUSED, so the tap lands on YouTube's own
// button INSIDE the iframe. Tapping our own facade could never start it (an iOS gesture doesn't carry into a freshly
// created cross-origin iframe) — that is exactly what made it two taps.
ok('review-sheet embeds either way, autoplay=AUTOPLAY', /if\(!v\.deferred&&canAutoEmbed\(\)\)setTimeout\(\(\)=>\{if\(sh\.classList\.contains\('up'\)\)embedFacade\(fac,AUTOPLAY\);\},420\)/.test(html));
ok('intro embeds either way, autoplay=AUTOPLAY',        /if\(canAutoEmbed\(\)\)setTimeout\([\s\S]{0,140}embedFacade\(fac,AUTOPLAY\);\},420\)/.test(html));
ok('facade tap (embeds blocked) asks to PLAY',          (html.match(/embedFacade\(fac,false,true\)/g)||[]).length===3);
ok('no «нажми play» hint under the video',              !/Нажми play, чтобы посмотреть разбор/.test(html));
ok('toast can use the full width (not a column)',       /\.toast\{[^}]*width:max-content;max-width:min\(92vw,560px\)/.test(html));
ok('pill kept ONLY for playing-but-muted',              /if\(auto\)maybeShowUnmute\(wrap,player,e&&e\.data\)/.test(html)&&/if\(player\.isMuted&&player\.isMuted\(\)\)showUnmute/.test(html));

console.log('== behavior ==');
async function embed(auto,opts){
  opts=opts||{};
  const W=boot(opts.ls);
  W.eval(`
    window.__state=${('state'in opts)?opts.state:1};
    window.__muted=${opts.muted?'true':'false'};
    window.__flags={};
    window.YT={Player:function(slot,cfg){
      window.__pv=cfg.playerVars; window.__cfg=cfg;
      this.getIframe=function(){return document.createElement('iframe');};
      this.getPlayerState=function(){return window.__state;};
      this.isMuted=function(){return window.__muted;};
      this.mute=function(){window.__muted=true;window.__flags.mute=true;};
      this.unMute=function(){window.__muted=false;};
      this.setVolume=function(){};
      this.playVideo=function(){window.__state=1;window.__flags.play=true;};
      this.pauseVideo=function(){};
      if(cfg.events&&cfg.events.onReady)setTimeout(function(){cfg.events.onReady();},0);
    }};
    _ytApi=null;
    var wrap=document.createElement('div');wrap.className='video';
    var fac=document.createElement('div');fac.className='vfacade';fac.setAttribute('data-embed','abc123');fac.dataset.s='0';fac.dataset.e='0';
    wrap.appendChild(fac);document.body.appendChild(wrap);window.__wrap=wrap;
  `);
  const playArg=('play'in opts)?(opts.play?',true':',false'):'';
  W.eval(`embedFacade(window.__wrap.querySelector('.vfacade'),${auto?'true':'false'}${playArg});`);
  await new Promise(r=>setTimeout(r,25));
  return W;
}
const toastTxt=W=>W.eval("(document.getElementById('toast')||{}).textContent||''");
(async()=>{
  // 1. browser allows audible autoplay (desktop / Telegram WebView): nothing changes, nothing is remembered
  { const W=await embed(true,{state:1,muted:false});
    await new Promise(r=>setTimeout(r,1500));
    ok('audible OK → autoplay stays ON',                W.eval('AUTOPLAY')===true);
    ok('audible OK → browser NOT flagged',              W.eval("localStorage.getItem('pk_noautosound')")===null);
    ok('audible OK → no pill',                          W.eval("!document.querySelector('.vunmute')"));
    ok('audible OK → never force-muted',                !W.eval('window.__flags.mute')); }

  // 2. browser refuses audible autoplay: remember it, flip the toggle off, explain — and DON'T mute/play/pill
  { const W=await embed(true,{state:-1,muted:false});
    await new Promise(r=>setTimeout(r,1500));
    ok('refused → autoplay flipped OFF',                W.eval('AUTOPLAY')===false);
    ok('refused → NOAUTOSOUND remembered',              W.eval("localStorage.getItem('pk_noautosound')")==='1');
    ok('refused → pk_autoplay persisted off',           W.eval("localStorage.getItem('pk_autoplay')")==='0');
    ok('refused → explained once (toast)',              /Автовидео недоступно/.test(toastTxt(W))&&/Telegram/.test(toastTxt(W)));
    ok('refused → NO muted pre-roll',                   !W.eval('window.__flags.mute'));
    ok('refused → NOT force-played',                    !W.eval('window.__flags.play'));
    ok('refused → NO pill (clip waits for a tap)',      W.eval("!document.querySelector('.vunmute')")); }

  // 3. the other case survives: it DID autoplay, but muted itself → one-tap pill
  { const W=await embed(true,{state:1,muted:true});
    W.eval("window.__cfg.events.onStateChange({data:1});");
    ok('playing-but-muted → pill shown',                W.eval("!!document.querySelector('.vunmute')"));
    W.eval('window.__muted=false;window.__cfg.events.onStateChange({data:1});');
    ok('pill dropped the instant sound is on',          W.eval("!document.querySelector('.vunmute')")); }

  // 4. Автовидео off: the player is still built, just PAUSED — no probe, no pill, and one tap on YouTube's own button plays it
  { const W=await embed(false,{state:-1,muted:true});
    await new Promise(r=>setTimeout(r,1500));
    ok('off → player is embedded, not left as a facade', W.eval('!!window.__pv'));
    ok('off → embedded PAUSED (autoplay=0)',            W.eval('window.__pv.autoplay')===0);
    ok('off → NOT force-played',                        !W.eval('window.__flags.play'));
    ok('off → browser NOT flagged',                     W.eval("localStorage.getItem('pk_noautosound')")===null);
    ok('off → no pill',                                 W.eval("!document.querySelector('.vunmute')")); }

  // 4b. the facade tap that survives where embeds are blocked still asks for an audible start
  { const W=await embed(false,{state:-1,muted:false,play:true});
    ok('explicit play=true → autoplay=1',               W.eval('window.__pv.autoplay')===1);
    ok('explicit play=true → still no probe (auto=false)', W.eval("localStorage.getItem('pk_noautosound')")===null); }

  // 4c. Автовидео on → the player starts on its own
  { const W=await embed(true,{state:1,muted:false});
    ok('on → autoplay=1',                               W.eval('window.__pv.autoplay')===1); }

  // 5. second visit on a flagged browser: toggle refuses to switch on and explains
  { const W=boot({pk_noautosound:'1',pk_autoplay:'0'});
    ok('flagged browser boots with autoplay OFF',       W.eval('AUTOPLAY')===false&&W.eval('NOAUTOSOUND')===true);
    W.eval('toggleAutoplay();');
    ok('tapping the toggle does NOT switch it on',      W.eval('AUTOPLAY')===false);
    ok('tapping the toggle explains why',               /Автовидео недоступно/.test(toastTxt(W))&&/на любом ПК/.test(toastTxt(W))); }

  // 6. normal browser: the toggle still just toggles
  { const W=boot();
    ok('normal browser boots with autoplay ON',         W.eval('AUTOPLAY')===true);
    W.eval('toggleAutoplay();');
    ok('toggle switches off + says so',                 W.eval('AUTOPLAY')===false&&/выключено/.test(toastTxt(W)));
    W.eval('toggleAutoplay();');
    ok('toggle switches back on',                       W.eval('AUTOPLAY')===true&&/включено/.test(toastTxt(W))); }

  console.log('\n'+pass+' passed, '+fail+' failed');
  process.exit(fail?1:0);
})();
