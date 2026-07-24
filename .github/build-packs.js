// Rebuild packs.json from the live Supabase `pack` table.
// Run by .github/workflows/refresh-packs.yml on a schedule — which ALSO keeps the free-tier Supabase
// project awake (the DB read counts as activity, so it never auto-pauses after ~7 idle days).
// Only rewrites the file when the slug:version signature actually changes, so the repo isn't spammed
// with no-op commits. Reads the PUBLIC anon key straight from index.html (it's already public there).
const fs=require('fs'),https=require('https');
const root=process.cwd();
const html=fs.readFileSync(root+'/index.html','utf8');
const SUPA_URL=(html.match(/SUPA_URL='([^']+)'/)||[])[1];
const ANON=(html.match(/SUPA_ANON='([^']+)'/)||[])[1];
if(!SUPA_URL||!ANON){console.error('could not read SUPA_URL/SUPA_ANON from index.html');process.exit(1);}
function get(url,headers){return new Promise((res,rej)=>{https.get(url,{headers:headers||{}},r=>{let s='';r.on('data',d=>s+=d);r.on('end',()=>res({status:r.statusCode,body:s}));}).on('error',rej);});}
(async()=>{
  const r=await get(SUPA_URL+'/rest/v1/pack?select=slug,position,data,version,paid,free_hands,price_rub,hands_total&order=position.asc',{apikey:ANON,Authorization:'Bearer '+ANON});
  if(r.status!==200){console.error('DB fetch failed',r.status,r.body.slice(0,200));process.exit(1);}   // keepalive ping already happened; never clobber the good file on an error
  const rows=JSON.parse(r.body);
  if(rows.length<3){console.error('refusing to write: only '+rows.length+' packs from DB');process.exit(1);}   // partial/broken read — keep the good file
  // Hidden packs are drafts: they never reach a player, so they have no business sitting in a public
  // repo. Paid hands need no filter here at all — they live in `pack_locked`, which this anon key
  // cannot read, so the DB physically cannot hand them over.
  const pub=rows.filter(x=>x.data&&!x.data.hidden);
  const cols=pub.map(x=>x.data);
  const sig=pub.map(x=>x.slug+':'+x.version).join('|');
  // paywall config lives in the pack row's own columns, not inside data — carry it so the offline fallback
  // still draws the lock and the price instead of silently showing a pack as fully free
  const meta={};pub.forEach(x=>{meta[x.slug]={paid:!!x.paid,freeHands:x.free_hands|0,priceRub:x.price_rub|0,handsTotal:x.hands_total|0};});
  if(!cols.length){console.error('refusing to write: no visible packs');process.exit(1);}
  let cur=null;try{cur=JSON.parse(fs.readFileSync(root+'/packs.json','utf8'));}catch(e){}
  if(cur&&cur.sig===sig){console.log('no change (sig '+sig+') — keepalive ping only, nothing to commit');return;}
  fs.writeFileSync(root+'/packs.json',JSON.stringify({cols,meta,publishedAt:Date.now(),sig}));
  console.log('updated packs.json: '+((cur&&cur.sig)||'none')+' -> '+sig);
})();
