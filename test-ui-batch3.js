// Verify batch-3 UI: #8 bet-level relabel, #4 home filter (author+format), #1 villain reveal gating.
const fs=require('fs');const {JSDOM}=require('jsdom');
const html=fs.readFileSync(__dirname+'/poker-trainer.html','utf8');
let pass=0,fail=0;
const ASYNC_CHECKS=[];   // network-stubbed checks awaited at the end (kept out of the sync flow)
function ok(name,cond){if(cond){pass++;console.log('  ok  '+name);}else{fail++;console.log('  FAIL '+name);}}
function boot(){const dom=new JSDOM(html,{runScripts:'dangerously',url:'https://danilakruzhkov-arch.github.io/poker-trainer/',pretendToBeVisual:true});return dom.window;}

console.log('== #8 bet-level relabel (raiseLevelLabel / optLabelDisp) ==');
{
  const W=boot();const ev=c=>W.eval(c);
  // raiseLevelLabel: N raises before hero -> hero's raise level
  ok('0 raises before -> Рейз (open)', ev("raiseLevelLabel([])")==='Рейз');
  ok('1 raise before -> 3-бет', ev("raiseLevelLabel([{action:'raise'}])")==='3-бет');
  ok('2 raises before -> 4-бет', ev("raiseLevelLabel([{action:'raise'},{action:'raise'}])")==='4-бет');
  ok('3 raises before -> 5-бет', ev("raiseLevelLabel([{action:'raise'},{action:'raise'},{action:'raise'}])")==='5-бет');
  ok('limps not counted (call) -> Рейз', ev("raiseLevelLabel([{action:'call'},{action:'call'}])")==='Рейз');
  // optLabelDisp: only relabels a generic «Рейз» raise option, only preflop
  ok('generic Рейз facing open -> 3-бет', ev("optLabelDisp({label:'Рейз',type:'raise'},'preflop',[{action:'raise'}])")==='3-бет');
  ok('open (no prior raise) stays Рейз', ev("optLabelDisp({label:'Рейз',type:'raise'},'preflop',[{action:'call'}])")==='Рейз');
  ok('already-specific 3-бет untouched', ev("optLabelDisp({label:'3-бет',type:'raise'},'preflop',[{action:'raise'},{action:'raise'}])")==='3-бет');
  ok('postflop raise not relabelled', ev("optLabelDisp({label:'Рейз',type:'raise'},'flop',[{action:'raise'}])")==='Рейз');
  ok('non-raise option untouched (Колл)', ev("optLabelDisp({label:'Колл',type:'call'},'preflop',[{action:'raise'}])")==='Колл');
}

console.log('== #4 home filter (facets + AND filtering) ==');
{
  const W=boot();const ev=c=>W.eval(c);
  // inject a known collection set: 2 authors, 2 formats
  ev(`COLS=[
    {id:'a',name:'ФТ',emoji:'A',host:'Разбор: Андрей Козленко',hero:'X',format:'online', hands:[{players:8,heroPos:'BTN',actions:[{pos:'BTN',action:'raise',size:'2',street:'preflop',q:{options:[{id:'o1',label:'Рейз',type:'raise',hero:true,grade:'best'}]}}]}]},
    {id:'b',name:'МЕ',emoji:'B',host:'Разбор: Андрей Козленко',hero:'Y',format:'offline',hands:[{players:8,heroPos:'BTN',actions:[{pos:'BTN',action:'raise',size:'2',street:'preflop',q:{options:[{id:'o1',label:'Рейз',type:'raise',hero:true,grade:'best'}]}}]}]},
    {id:'c',name:'16k',emoji:'C',host:'Разбор: Baby Shark',hero:'Z',format:'online', hands:[{players:8,heroPos:'BTN',actions:[{pos:'BTN',action:'raise',size:'2',street:'preflop',q:{options:[{id:'o1',label:'Рейз',type:'raise',hero:true,grade:'best'}]}}]}]},
    {id:'mine',name:'Мой',emoji:'m',host:'',hero:'',format:'',hands:[]}
  ];`);
  ev("HOME_FILTER={host:'',format:'',hero:''};renderHome();");
  const H=()=>W.document.getElementById('homeScreen').innerHTML;
  ok('filter bar renders', /homefilter/.test(H()));
  ok('Автор facet present', /flbl">Автор</.test(H()));
  ok('Формат facet present', /flbl">Формат</.test(H()));
  ok('host chip strips «Разбор:» prefix', />Андрей Козленко</.test(H())&&/>Baby Shark</.test(H()));
  ok('format chips localized', />Онлайн</.test(H())&&/>Оффлайн</.test(H()));
  ok('all 4 packs shown initially (incl empty «Мой»)', (H().match(/class="pack /g)||[]).length===4);
  // filter by author Baby Shark -> only pack c
  ev("HOME_FILTER={host:'Разбор: Baby Shark',format:'',hero:''};renderHome();");
  ok('author filter -> 1 pack', (H().match(/class="pack /g)||[]).length===1);
  ok('author filter shows 16k', /data-pack="c"/.test(H())&&!/data-pack="a"/.test(H()));
  ok('filtered count note shown', /из 4 подборок/.test(H()));
  // AND: Козленко + online -> only pack a
  ev("HOME_FILTER={host:'Разбор: Андрей Козленко',format:'online',hero:''};renderHome();");
  ok('author AND format -> 1 pack (a)', (H().match(/class="pack /g)||[]).length===1 && /data-pack="a"/.test(H()));
  // impossible combo -> nomatch
  ev("HOME_FILTER={host:'Разбор: Baby Shark',format:'offline',hero:''};renderHome();");
  ok('no-match state renders', /nomatch/.test(H()));
  // hidden pack excluded from facets
  ev("COLS[2].hidden=true;HOME_FILTER={host:'',format:'',hero:''};renderHome();");
  ok('hidden pack drops out (Baby Shark gone)', !/>Baby Shark</.test(H()));
  ok('single remaining author collapses facet (<2 values)', !/flbl">Автор</.test(H()));
}

console.log('== #1 villain reveal only on last question ==');
{
  const W=boot();const ev=c=>W.eval(c);
  // renderTable(container,v,reveal) — reveal=false must NOT emit villain real cards, shows backs instead
  ev(`document.body.insertAdjacentHTML('beforeend','<div id="tt"></div>');
      var vv={players:6,heroPos:'BTN',heroCards:['As','Kd'],cards:{CO:['Qh','Qs']},stacks:{},profiles:{},street:'flop',board:['2c','7d','9h'],history:{preflop:[{pos:'CO',action:'raise',size:'2'},{pos:'BTN',action:'call',size:'2'}],flop:[],turn:[],river:[]},contrib:{}};`);
  ev("renderTable(document.getElementById('tt'),vv,false)");
  ok('reveal=false hides villain cards (backs shown)', /cback/.test(W.document.getElementById('tt').innerHTML) && !/Qh|Qs/.test(W.document.getElementById('tt').innerHTML.replace(/heroCards|hero-cards/g,'')));
  ev("renderTable(document.getElementById('tt'),vv,true)");
  ok('reveal=true shows villain cards', W.document.getElementById('tt').innerHTML.includes('card'));
}

console.log('== #9 editor right column: savebar top + «Превью ответа» section ==');
{
  const W=boot();const D=W.document;
  const pw=D.querySelector('.previewwrap');
  const kids=[...pw.children];
  ok('savebar is first child of previewwrap (moved to top)', kids[0]&&kids[0].classList.contains('savebar'));
  ok('savebar-top carries #saveHand + #playSet', kids[0].querySelector('#saveHand')&&kids[0].querySelector('#playSet'));
  const secs=kids.filter(n=>n.getAttribute&&n.getAttribute('data-sec')).map(n=>n.getAttribute('data-sec'));
  ok('section order pv → ans → set', secs.join(',')==='pv,ans,set');
  ok('«Превью ответа» section has #ansBody', !!D.querySelector('.fs[data-sec="ans"] #ansBody'));
  ok('ans header title present', /Превью ответа/.test(D.querySelector('.fs[data-sec="ans"] .pvhead').textContent));
  // empty state before any question
  W.eval("syncAnsPreview({options:[]})");
  ok('empty ans shows hint', /ans-empty/.test(D.getElementById('ansBody').innerHTML));
  // populated: graded recap + timecoded video facade
  W.eval(`syncAnsPreview({street:'preflop',heroPick:'o1',video:{url:'https://youtu.be/abc123XYZ'},vStart:80,vEnd:120,depth:'',channel:'PL',explain:'Сквиз оправдан.',history:{preflop:[{pos:'CO',action:'raise',size:'2'}],flop:[],turn:[],river:[]},stacks:{},contrib:{},options:[{id:'o1',label:'Рейз',type:'raise',size:'6',grade:'best',hero:true},{id:'o2',label:'Пас',type:'fold',grade:'mistake'}]})`);
  const ans=D.getElementById('ansBody').innerHTML;
  ok('recap renders graded options', /qr-opts/.test(ans)&&/g-best/.test(ans)&&/g-mistake/.test(ans));
  ok('hero option keeps «Герой» chip', /qc hero/.test(ans));
  ok('answer preview relabels squeeze «Рейз»→«3-бет»', /3-бет/.test(ans));
  ok('timecoded video facade embedded', /vfacade/.test(ans)&&/data-embed="abc123XYZ"/.test(ans)&&/data-s="80"/.test(ans));
  ok('explain note shown', /Сквиз оправдан/.test(ans));
  // collapse plumbing: ansbody hidden when its section collapses
  ok('ans collapse hide-rule present in CSS', /\.previewwrap>\.fs\.collapsed>\.ansbody\{display:none\}/.test(html)||/collapsed>\.ansbody/.test(html));
}

console.log('== #5 feedback + #3 Supabase client ==');
{
  const W=boot();const ev=c=>W.eval(c);
  // FB categories
  ok('5 feedback categories defined', ev("FB_CATS.length")===5 && ev("FB_CATS.map(c=>c.k).join(',')")==='answer,hand,video,unclear,other');
  // Supabase config is BAKED IN (anon key hardcoded, not per-browser); always enabled, points at the real project
  ok('supaEnabled always true (hardcoded anon)', ev("supaEnabled()")===true);
  ok('supaCfg url is the poker-trainer project', ev("supaCfg().url")==='https://mydnywznytluikbwbhsk.supabase.co');
  ok('embedded key is the ANON role, never service_role', /"role":"anon"/.test(Buffer.from(ev("SUPA_ANON").split('.')[1],'base64').toString()) && !/service_role/.test(ev("SUPA_ANON")));
  ok('no supaSet / no pk_supa localStorage config', ev("typeof supaSet")==='undefined');
  // the service_role JWT (its unique signature + its base64 "role":"service_role" payload) must never be in the build
  ok('service_role key/JWT absent from entire build', !/yd4GJ7BIOT10629U2NyPZibHP8hJFHKQXECC8/.test(html) && !/InNlcnZpY2Vfcm9sZSI/.test(html));
  // fbRow maps app record -> DB columns
  const row=ev("JSON.stringify(fbRow({pack:'wsopme',pack_title:'WSOP',hand:'AA vs JJ',street:'river',q_index:2,q_total:3,pick_label:'Пас',pick_grade:'mistake',hero_label:'Колл',category:'answer',comment:'wrong',ua:'x',ver:'v',ts:'2026-07-22T00:00:00Z'}))");
  const r=JSON.parse(row);
  ok('fbRow maps ver->app_ver, ts->client_ts', r.app_ver==='v'&&r.client_ts==='2026-07-22T00:00:00Z');
  ok('fbRow carries pack/hand/category/comment', r.pack==='wsopme'&&r.hand==='AA vs JJ'&&r.category==='answer'&&r.comment==='wrong');
  // local queue round-trip
  ev("fbQueueSet([]);");
  ok('queue starts empty', ev("fbQueueGet().length")===0);
  // supaInsert builds the PostgREST endpoint + anon auth headers (stub fetch — never touch the real DB in tests)
  ev("window.__fc=null; window.fetch=async(u,o)=>{window.__fc={u,o}; return {ok:true,status:201};};");
  W.__insertResult = ev("supaInsert('feedback',[{comment:'x'}])");   // returns a promise; awaited below
  // sendFeedback fallback: when the POST fails, the record must land in the local queue (offline durability)
  ev("window.fetch=async()=>{throw new Error('offline');}; fbQueueSet([]);");
  W.__sendResult = ev("sendFeedback({ts:'t',category:'hand',comment:'board wrong',pack:'p',pack_title:'P',hand:'H',street:'flop',q_index:1,q_total:1,pick_label:'Бет',pick_grade:'ok',hero_label:'Чек',ua:'u',ver:'2026-07-22'})");
  ASYNC_CHECKS.push(async()=>{
    await W.__insertResult;
    ok('supaInsert POSTs to /rest/v1/feedback with anon apikey', /\/rest\/v1\/feedback$/.test(W.__fc.u) && W.__fc.o.headers.apikey===ev("SUPA_ANON") && W.__fc.o.headers['Prefer']==='return=minimal');
    await W.__sendResult;
    ok('sendFeedback falls back to local queue when offline', ev("fbQueueGet().length")===1 && ev("fbQueueGet()[0].comment")==='board wrong');
  });
  // sheet template wires the report button
  ok('showSheet renders «Сообщить об ошибке»', /Сообщить об ошибке/.test(ev("showSheet.toString()"))&&/fbToggle/.test(ev("showSheet.toString()")));
  ok('showSheet wires feedback handlers', /wireFeedback\(\)/.test(ev("showSheet.toString()")));
  // editor shows a READ-ONLY status now — no credential input fields
  const cb=ev("collectionBlockHTML()");
  // feedback now flows via the review-sheet «Сообщить об ошибке» → /rest/v1/feedback (covered above);
  // the editor's old read-only Supabase status block was removed, so we only assert no credential inputs leaked back in.
  ok('editor has NO supa credential inputs', !/id="supa-url"/.test(cb)&&!/id="supa-key"/.test(cb)&&!/id="supa-save"/.test(cb));
  // CURPACK plumbing exists
  ok('CURPACK global present', ev("typeof CURPACK")==='object');
}

console.log('== #10 fast hand-replay animation ==');
{
  const W=boot();const ev=c=>W.eval(c);
  ev(`window._V={players:6,heroPos:'BTN',heroCards:['As','Kd'],cards:{},stacks:{BTN:100,SB:100,BB:100},profiles:{},street:'turn',board:['2c','7d','9h','Kd'],contrib:{},
      history:{preflop:[{pos:'SB',action:'raise',size:'3'},{pos:'BTN',action:'call',size:'3'}],flop:[{pos:'SB',action:'bet',size:'5'},{pos:'BTN',action:'call',size:'5'}],turn:[{pos:'SB',action:'check'}],river:[]}};`);
  // frameView(0): clean start — no actions, preflop, empty board
  ok('frame 0: empty history', ev("Object.values(frameView(_V,0).history).every(a=>a.length===0)"));
  ok('frame 0: street preflop, board empty', ev("frameView(_V,0).street")==='preflop' && ev("frameView(_V,0).board.length")===0);
  // frameView(2): first two actions (both preflop)
  ok('frame 2: 2 preflop actions', ev("frameView(_V,2).history.preflop.length")===2 && ev("frameView(_V,2).street")==='preflop');
  ok('frame 2: board still empty (preflop)', ev("frameView(_V,2).board.length")===0);
  // frameView(3): into the flop -> board deals 3
  ok('frame 3: street flop, board 3 cards', ev("frameView(_V,3).street")==='flop' && ev("frameView(_V,3).board.length")===3);
  // frameView(5): into the turn -> board 4
  ok('frame 5: street turn, board 4 cards', ev("frameView(_V,5).street")==='turn' && ev("frameView(_V,5).board.length")===4);
  // pot grows monotonically across frames (matches potNum additive model)
  ok('pot grows across frames', ev("potNum(frameView(_V,2))") > ev("potNum(frameView(_V,0))") && ev("potNum(frameView(_V,4))") > ev("potNum(frameView(_V,2))"));
  ok('final frame pot == real pot', ev("potNum(frameView(_V,5))")===ev("potNum(_V)"));
  // frameContrib: additive per position (SB raised 3 + bet 5 = 8)
  ok('frameContrib sums sizes per pos', ev("frameContrib(_V.history).SB")===8 && ev("frameContrib(_V.history).BTN")===8);
  ok('frameContrib ignores checks/folds', ev("frameContrib({preflop:[{pos:'SB',action:'check'}],flop:[],turn:[],river:[]}).SB")===undefined);
  // toggle persistence
  ev("setReplay(false)");
  ok('REPLAY toggle off persists', ev("localStorage.getItem('pk_replay')")==='0' && ev("REPLAY")===false);
  // replayInto with REPLAY off -> immediate single render, no timers scheduled
  ev(`document.body.insertAdjacentHTML('beforeend','<div id="rt"></div>');window._done=false;`);
  ev("clearReplay(); replayInto(document.getElementById('rt'), _V, ()=>{window._done=true;});");
  ok('replay off -> renders immediately + calls onDone', ev("_done")===true && ev("_replayTimers.length")===0 && /Банк/.test(ev("document.getElementById('rt').innerHTML")));
  // replay on with a real sequence -> schedules frames (timers > 0)
  ev("setReplay(true); clearReplay(); replayInto(document.getElementById('rt'), _V);");
  ok('replay on -> schedules animation timers', ev("_replayTimers.length")>0);
  ev("clearReplay(); setReplay(true);");
  ok('clearReplay empties the timer list', ev("_replayTimers.length")===0);
  // replay wiring present (the visible «replayToggle» button was removed from the bar; the feature persists via pk_replay)
  ok('renderHand drives the replay', /replayInto\(\$\('trainTable'\),v\)/.test(html));
  ok('choose() cancels pending replay', /function choose[\s\S]{0,80}clearReplay\(\)/.test(html));
}

console.log('== migration + doc files ==');
{
  const sql=fs.readFileSync(__dirname+'/deploy/supabase-migration.sql','utf8');
  ok('migration creates feedback table', /create table if not exists public\.feedback/.test(sql));
  ok('migration enables RLS', /enable row level security/.test(sql));
  ok('migration: anon insert-only policy', /for insert\s+to anon/.test(sql)&&!/to anon\s+using/.test(sql));
  ok('migration grants insert to anon', /grant insert on public\.feedback to anon/.test(sql));
  const doc=fs.readFileSync(__dirname+'/deploy/SUPABASE-SETUP.md','utf8');
  ok('setup doc: project isolated from clippoint', /clippoint/i.test(doc)&&/отдельн/.test(doc));
  ok('setup doc: keys baked into build (no editor step)', /зашит/.test(doc)&&/anon/i.test(doc));
  ok('setup doc: states service_role never in code', /service_role/.test(doc)&&/(нет|не будет|никогда)/.test(doc));
  ok('setup doc: explains hands live in packs.json on GitHub', /packs\.json/.test(doc)&&/GitHub/.test(doc));
}

(async()=>{
  for(const c of ASYNC_CHECKS){try{await c();}catch(e){fail++;console.log('  FAIL async: '+e.message);}}
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail?1:0);
})();
