// Post-splice gate: load the real app and validate EVERY pack's hands resolve with valid questions.
const fs=require('fs'),path=require('path');const {JSDOM}=require('jsdom');
const html=fs.readFileSync(path.join(__dirname,'poker-trainer.html'),'utf8');
const doc=`<!doctype html><html><head><meta charset="utf-8"></head><body>${html}</body></html>`;
const A=(c,m)=>{console.log((c?'  ok  ':'  XX  ')+m);if(!c)process.exitCode=1;};
const errors=[];
const dom=new JSDOM(doc,{runScripts:'dangerously',pretendToBeVisual:true,
  url:'https://danilakruzhkov-arch.github.io/poker-trainer/',
  beforeParse(w){w.localStorage.setItem('pk_autoplay','0');w.sessionStorage.setItem('pk_editor_ok','1');
    w.onerror=(m,s,l,c,e)=>errors.push(e&&e.stack||m);w.scrollTo=()=>{};w.HTMLElement.prototype.scrollIntoView=()=>{};}});
setTimeout(()=>{
 try{
  const {window}=dom;
  A(errors.length===0,'app loaded without error'+(errors[0]?': '+errors[0]:''));
  const cols=window.eval('defaultCols().map(c=>c.id)');
  let grand=0;
  cols.forEach(id=>{
    if(id==='mine')return;
    const rep=window.eval(`(()=>{const hs=packHands('${id}');return JSON.stringify(hs.map(h=>{
      let err=null,q=0;try{resolve(h);q=questionsOf(h).length;}catch(e){err=String(e);}
      const bad=[];try{questionsOf(h).forEach(qq=>{if(!qq.q.options.some(o=>o.grade==='best'))bad.push('noBest');if(!qq.q.options.some(o=>o.hero))bad.push('noHero');});}catch(e){}
      return {title:h.title,cards:(h.heroCards||[]).join(''),q,err,bad};}));})()`);
    const hs=JSON.parse(rep);
    const packQ=hs.reduce((a,h)=>a+h.q,0);grand+=packQ;
    console.log(`\n== ${id}: ${hs.length} hands, ${packQ} questions ==`);
    hs.forEach((h,i)=>{
      if(h.err)A(false,`  ${id}[${i}] "${h.title}" THREW: ${h.err}`);
      else if(h.q===0)A(false,`  ${id}[${i}] "${h.title}" yields 0 questions`);
      else if(h.bad.length)A(false,`  ${id}[${i}] "${h.title}" ${h.bad.join(',')}`);
      else console.log(`   ok ${id}[${i}] ${h.cards.padEnd(6)} Q=${h.q} ${h.title}`);
    });
  });
  A(errors.length===0,'no runtime errors after enumerating all packs');
  console.log('\nGRAND TOTAL questions:',grand);
  console.log('RESULT exitCode='+(process.exitCode||0)+(process.exitCode?'  — FIX ABOVE':'  — ALL GREEN'));
 }catch(e){console.log('THREW:',e.stack);process.exit(1);}
},1000);
