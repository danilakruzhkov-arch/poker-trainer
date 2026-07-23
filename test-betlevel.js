// #8: verify the 3-bet/4-bet relabel fires correctly on real pack data.
// Mirrors qView's preflop-history build + raiseLevelLabel/optLabelDisp from the app.
const fs=require('fs');
const j=JSON.parse(fs.readFileSync(__dirname+'/deploy/packs.json','utf8'));
const ACT_RU={fold:'Пас',check:'Чек',call:'Колл',bet:'Бет',raise:'Рейз'};
function raiseLevelLabel(pf){const raises=(pf||[]).filter(a=>a.action==='raise').length;const lvl=raises+1;return lvl>=4?'5-бет':lvl===3?'4-бет':lvl===2?'3-бет':'Рейз';}
function optLabelDisp(o,street,pf){const L=(o&&(o.label||ACT_RU[o.type]))||'—';if(street==='preflop'&&o&&o.type==='raise'&&L==='Рейз'){const r=raiseLevelLabel(pf);if(r&&r!==L)return r;}return L;}
// resolve rows: hand.actions is already the flat ordered row list with {pos,action,size,street,q?}
let changed=[],kept=[],total=0,heroChanged=0;
j.cols.forEach(c=>c.hands.forEach(h=>{
  const rows=h.actions||[];
  rows.forEach((entry,idx)=>{
    if(!entry.q||!entry.q.options)return;   // only question rows have options
    // build preflop history = rows before this question row, preflop only
    const pf=[];for(let jx=0;jx<idx;jx++){const r=rows[jx];if(r.pos&&r.street==='preflop')pf.push({pos:r.pos,action:r.action,size:r.size});}
    entry.q.options.forEach(o=>{
      if(o.type!=='raise'||entry.street!=='preflop')return;
      total++;
      const before=(o.label||ACT_RU[o.type]||'').trim();
      const after=optLabelDisp(o,entry.street,pf);
      if(after!==before){changed.push(`${c.id} / ${h.title} / "${before}"→"${after}"${o.hero?' [hero]':''}`);if(o.hero)heroChanged++;}
      else kept.push(`${c.id} / ${h.title} / "${before}"`);
    });
  });
}));
console.log('=== #8 bet-level relabel audit ===');
console.log('preflop raise options total:',total);
console.log('relabelled:',changed.length,'(hero options:',heroChanged+')');
changed.forEach(x=>console.log('  '+x));
console.log('\nunchanged (stay «Рейз»/open or already specific):',kept.length);
// show a few kept for sanity
[...new Set(kept)].slice(0,12).forEach(x=>console.log('  '+x));
