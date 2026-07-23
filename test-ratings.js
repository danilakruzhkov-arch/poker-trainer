// #2 question rating (👍/👎): anonymous insert-only rows into the `ratings` table, one localStorage flag per
// question mirrors the choice and blocks a duplicate same-direction send. Graceful when Supabase is unreachable.
const fs=require('fs');const {JSDOM}=require('jsdom');
const html=fs.readFileSync(__dirname+'/poker-trainer.html','utf8');
let pass=0,fail=0;
function ok(n,c){if(c){pass++;console.log('  ok  '+n);}else{fail++;console.log('  FAIL '+n);}}
function boot(){const dom=new JSDOM(html,{runScripts:'dangerously',url:'https://danilakruzhkov-arch.github.io/poker-trainer/',pretendToBeVisual:true});return dom.window;}

console.log('== static wiring ==');
ok('rate row rendered above «Сообщить об ошибке»', /<div class="rateq" id="rateRow"><span class="rateq-l">Оцени вопрос:<\/span>/.test(html));
ok('👍 and 👎 buttons present',                    /id="rateUp" data-dir="up"/.test(html)&&/id="rateDown" data-dir="down"/.test(html));
ok('rateQuestion inserts into the ratings table',   /await supaInsert\('ratings',\[ratingRow\(dir\)\]\)/.test(html));
ok('same vote twice is ignored',                    /if\(ratedGet\(\)===dir\)return;/.test(html));
ok('one localStorage flag per pack\\|hand\\|q',      /'pk_rated:'\+c\.pack\+'\|'\+c\.hand\+'\|'\+c\.q_index/.test(html));
ok('ratingRow carries rating + full question context',/rating:dir,app_ver:APP_VER/.test(html)&&/pack:c\.pack,pack_title:c\.pack_title,hand:c\.hand,street:c\.street,q_index:c\.q_index,q_total:c\.q_total/.test(html));
ok('wireRating bound in showSheet',                 /wireFeedback\(\);wireRating\(\);/.test(html));
ok('collapsed hides the rate row (inside .fbwrap)', /\.sheet\.collapsed[^{]*\.fbwrap/.test(html));

console.log('== behavior with a mocked Supabase sink ==');
(async()=>{
  const W=boot();const ev=c=>W.eval(c);
  ev(`fbContext=()=>({pack:'wsopme',pack_title:'WSOP Main',hand:'Гановер',street:'river',q_index:2,q_total:3,pick_label:'Фолд',pick_grade:'mistake',hero_label:'Колл'});
      window.__ins=[]; supaInsert=async(table,rows)=>{window.__ins.push({table,rows});return {ok:true,status:201};};
      window.toast=()=>{};
      document.body.insertAdjacentHTML('beforeend','<button class="rateb up" id="rateUp"></button><button class="rateb down" id="rateDown"></button><span id="rateDone"></span>');
      try{localStorage.clear();}catch(e){}
      wireRating();`);

  await W.eval("rateQuestion('up')");
  ok('👍 sends exactly one row',                 ev('window.__ins.length')===1);
  ok('row goes to the ratings table',            ev("window.__ins[0].table")==='ratings');
  ok("row carries rating:'up'",                  ev("window.__ins[0].rows[0].rating")==='up');
  ok('row carries the question context',         ev("window.__ins[0].rows[0].pack")==='wsopme'&&ev("window.__ins[0].rows[0].q_index")===2&&ev("window.__ins[0].rows[0].hand")==='Гановер');
  ok('row stamps app_ver + client_ts',           ev("window.__ins[0].rows[0].app_ver")===ev('APP_VER')&&typeof ev("window.__ins[0].rows[0].client_ts")==='string');
  ok('localStorage remembers the up vote',       ev("ratedGet()")==='up');
  ok('👍 button marked selected',                ev("document.getElementById('rateUp').classList.contains('on')")===true);

  await W.eval("rateQuestion('up')");
  ok('re-clicking 👍 does NOT resend',            ev('window.__ins.length')===1);

  await W.eval("rateQuestion('down')");
  ok('switching to 👎 sends a new row',           ev('window.__ins.length')===2&&ev("window.__ins[1].rows[0].rating")==='down');
  ok('localStorage flips to down',               ev("ratedGet()")==='down');
  ok('👎 selected, 👍 cleared',                   ev("document.getElementById('rateDown').classList.contains('on')")===true&&ev("document.getElementById('rateUp').classList.contains('on')")===false);

  // graceful when the DB is unreachable: intent still recorded locally + UI painted, no throw
  ev(`window.__ins=[];supaEnabled=()=>false;fbContext=()=>({pack:'wsopme',pack_title:'WSOP Main',hand:'ДругаяРука',street:'flop',q_index:1,q_total:2,pick_label:'',pick_grade:'',hero_label:''});`);
  await W.eval("rateQuestion('up')");
  ok('no network row attempted when Supabase is off', ev('window.__ins.length')===0);
  ok('vote intent still saved locally when DB is off', ev("ratedGet()")==='up');

  console.log('\n'+pass+' passed, '+fail+' failed');
  process.exit(fail?1:0);
})();
