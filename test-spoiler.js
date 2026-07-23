// Verify C: video spoiler guard — the IFrame API builds the player (host=nocookie), a watchdog snaps the
// scrubber back inside [start,end], scrubbing ahead pauses+warns, and everything is torn down on stop.
const fs=require('fs');const {JSDOM}=require('jsdom');
const html=fs.readFileSync(__dirname+'/poker-trainer.html','utf8');
let pass=0,fail=0;
function ok(name,cond){if(cond){pass++;console.log('  ok  '+name);}else{fail++;console.log('  FAIL '+name);}}
function boot(){const dom=new JSDOM(html,{runScripts:'dangerously',url:'https://danilakruzhkov-arch.github.io/poker-trainer/',pretendToBeVisual:true});return dom.window;}

console.log('== static wiring ==');
{
  ok('loadYTAPI pulls the IFrame API', /function loadYTAPI\(\)/.test(html)&&/www\.youtube\.com\/iframe_api/.test(html));
  ok('embedFacade seeds a placeholder div for the API', /const wrap=fac\.parentElement,slot='ytf'\+\(\+\+_ytSeq\);/.test(html)&&/wrap\.innerHTML=`<div id="\$\{slot\}"/.test(html));
  ok('countdown renders into the row slot under the video (#3)', /const scope=wrap\.closest\('#sheet,#introScreen'\);const timerSlot=scope\?scope\.querySelector\('\.clip-slot'\):null;/.test(html)&&/startClipTimer\(wrap,en-s,timerSlot\)/.test(html));
  ok('startClipTimer prefers the slot, captions «до конца отрезка»', /function startClipTimer\(wrap,dur,slot\)\{/.test(html)&&/const host=slot\|\|wrap;/.test(html)&&/slot\?'<span class="vt-cap">до конца отрезка<\/span>':''/.test(html));
  ok('bindTimerToPlayer finds the timer globally (sibling slot)', /const el=document\.querySelector\('\.vtimer'\);/.test(html));
  ok('player is built with the nocookie host', /new YT\.Player\(slot,\{host:'https:\/\/www\.youtube-nocookie\.com',videoId:id,playerVars:pv,/.test(html));
  ok('playerVars carry start/end/origin', /start:s\|\|0,origin:location\.origin\}/.test(html)&&/if\(en>s\)pv\.end=en;/.test(html));
  ok('watchdog + player-driven timer arm on ready', /onReady:\(\)=>\{if\(en>s\)\{armWatchdog\(player,s,en\);bindTimerToPlayer\(wrap,player,en\);\}if\(auto\)armAutoplayFallback\(player\);\}/.test(html));
  ok('armWatchdog registers the interval for cleanup', /const iv=setInterval\(\(\)=>clipTick\(player,s,en,lo\),500\);\s*\n?\s*VTIMERS\.push\(iv\);/.test(html));
  ok('plainEmbed fallback exists for no-API环境', /function plainEmbed\(slot,id,s,en,play\)/.test(html)&&/plainEmbed\(slot,id,s,en,wantPlay\);return;/.test(html));
  ok('stopVideos destroys the players', /_ytPlayers\.forEach\(p=>\{try\{p&&p\.destroy&&p\.destroy\(\);\}catch\(e\)\{\}\}\);_ytPlayers=\[\];/.test(html));
  ok('persistent replay bar replaces the toast', /function showReplayBar\(wrap,player,s,en,txt\)/.test(html)&&/onStateChange:\(e\)=>\{onClipState\(e,wrap,player,s,en\)/.test(html));
  ok('countdown is driven by the player clock (#4)', /function bindTimerToPlayer\(wrap,player,en\)/.test(html)&&/const left=dur\?Math\.min\(en-t,dur\):en-t;/.test(html));
  ok('replay button re-runs the segment from s (#5)', /player\.seekTo\(s,true\);player\.playVideo\(\);/.test(html));
}

console.log('== clipTick boundary logic (stub player) ==');
{
  const W=boot();const ev=c=>W.eval(c);
  ev("window._vw=document.createElement('div');_vw.className='video';window._ifr=document.createElement('iframe');_vw.appendChild(_ifr);document.body.appendChild(_vw);");
  ev("window._p={ct:0,paused:0,played:0,seeks:[],getCurrentTime(){return this.ct},pauseVideo(){this.paused++},seekTo(x){this.seeks.push(x)},playVideo(){this.played++},getIframe(){return window._ifr}};");
  ev("_p.ct=45;_p.paused=0;_p.seeks=[];");
  ok("in-range tick returns 'in'", ev("clipTick(_p,20,77,18.8)")==='in');
  ok('in-range does not pause', ev("_p.paused")===0);
  ok('in-range does not seek', ev("_p.seeks.length")===0);
  ev("_p.ct=95;_p.paused=0;_p.seeks=[];");
  ok("past-end tick returns 'ahead'", ev("clipTick(_p,20,77,18.8)")==='ahead');
  ok('past-end pauses the clip', ev("_p.paused")===1);
  ok('past-end snaps back to the end (77)', ev("_p.seeks[0]")===77);
  ok('past-end shows a persistent replay bar', /следующего решения/.test((W._vw.querySelector('.vreplay.show .vr-txt')||{}).textContent||''));
  ev("_p.seeks=[];_p.played=0;_vw.querySelector('.vreplay .vr-btn').click();");
  ok('replay button seeks back to start (20) and plays', ev("_p.seeks[0]")===20&&ev("_p.played")>=1);
  ok('replay hides the bar', ev("_vw.querySelector('.vreplay').classList.contains('show')")===false);
  ev("_p.ct=5;_p.paused=0;_p.seeks=[];");
  ok("before-start tick returns 'behind'", ev("clipTick(_p,20,77,18.8)")==='behind');
  ok('before-start does not pause', ev("_p.paused")===0);
  ok('before-start seeks to start (20)', ev("_p.seeks[0]")===20);
  ev("_p.ct=99999;_p.paused=0;_p.seeks=[];");
  ok("open-ended clip stays 'in' even far ahead", ev("clipTick(_p,0,0,0)")==='in');
}

console.log('== embedFacade builds the player via the API (stub YT) ==');
{
  const W=boot();const ev=c=>W.eval(c);
  ev("window.__opts=null;window.__ready=0;window.__destroyed=0;window.YT={Player:function(el,opts){window.__opts=opts;this.getCurrentTime=function(){return 0;};this.pauseVideo=function(){};this.seekTo=function(){};this.destroy=function(){window.__destroyed++;};if(opts.events&&opts.events.onReady){window.__ready++;opts.events.onReady();}}};_ytApi=null;");
  ev("var w=document.createElement('div');w.className='video';var f=document.createElement('div');f.className='vfacade';f.dataset.embed='abc123XYZ';f.dataset.s='20';f.dataset.e='77';w.appendChild(f);document.body.appendChild(w);");
  const vbefore=ev("VTIMERS.length");
  ev("embedFacade(f);");
  return (async()=>{
    await new Promise(r=>setTimeout(r,15));
    ok('a placeholder div is seeded first', /ytf\d+/.test(ev("document.querySelector('.video').innerHTML"))||ev("__opts")!==null);
    ok('YT.Player was constructed', ev("__opts")!==null);
    ok('uses the youtube-nocookie host', ev("__opts.host")==='https://www.youtube-nocookie.com');
    ok('passes the video id', ev("__opts.videoId")==='abc123XYZ');
    ok('playerVars carry the [start,end] window', ev("__opts.playerVars.start")===20&&ev("__opts.playerVars.end")===77);
    ok('playerVars carry a non-empty origin', typeof ev("__opts.playerVars.origin")==='string'&&ev("__opts.playerVars.origin").length>0);
    ok('onReady fired', ev("__ready")===1);
    ok('watchdog + countdown both registered', ev("VTIMERS.length")>=vbefore+2);
    ok('player registered for cleanup', ev("_ytPlayers.length")>=1);
    ev("stopVideos();");
    ok('stopVideos destroys the player', ev("__destroyed")>=1);
    ok('stopVideos empties the player list', ev("_ytPlayers.length")===0);

    // fallback path: no API → a plain nocookie iframe with the same window
    ev("document.body.insertAdjacentHTML('beforeend','<div id=\"slotP\"></div>');plainEmbed('slotP','vidABC',20,77);");
    const src=ev("(document.querySelector('iframe')||{}).src||''");
    ok('fallback embeds youtube-nocookie', /youtube-nocookie\.com\/embed\/vidABC/.test(src));
    ok('fallback keeps the start & end window', /start=20/.test(src)&&/end=77/.test(src));

    console.log('\n'+pass+' passed, '+fail+' failed');
    process.exit(fail?1:0);
  })();
}
