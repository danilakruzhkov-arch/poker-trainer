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
  const r=await get(SUPA_URL+'/rest/v1/pack?select=slug,position,data,version&order=position.asc',{apikey:ANON,Authorization:'Bearer '+ANON});
  if(r.status!==200){console.error('DB fetch failed',r.status,r.body.slice(0,200));process.exit(1);}   // keepalive ping already happened; never clobber the good file on an error
  const rows=JSON.parse(r.body);
  const cols=rows.map(x=>x.data).filter(Boolean);
  const sig=rows.map(x=>x.slug+':'+x.version).join('|');
  if(cols.length<3){console.error('refusing to write: only '+cols.length+' packs from DB');process.exit(1);}
  let cur=null;try{cur=JSON.parse(fs.readFileSync(root+'/packs.json','utf8'));}catch(e){}
  if(cur&&cur.sig===sig){console.log('no change (sig '+sig+') — keepalive ping only, nothing to commit');return;}
  fs.writeFileSync(root+'/packs.json',JSON.stringify({cols,publishedAt:Date.now(),sig}));
  console.log('updated packs.json: '+((cur&&cur.sig)||'none')+' -> '+sig);
})();
