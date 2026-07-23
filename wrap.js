// Wrap the Artifact-fragment HTML into a standalone document for GitHub Pages.
const fs=require('fs'),path=require('path');
const dir=__dirname;
const src=fs.readFileSync(path.join(dir,'poker-trainer.html'),'utf8');
const out=`<!doctype html>
<html lang="ru">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="theme-color" content="#0a0e0d">
<meta name="description" content="Покер-тренажёр: разбор раздач по вердикту стримера, с редактором собственных подборок.">
<title>Покер-тренажёр</title>
</head>
<body>
${src}
</body>
</html>`;
fs.mkdirSync(path.join(dir,'deploy'),{recursive:true});
fs.writeFileSync(path.join(dir,'deploy','index.html'),out);
fs.writeFileSync(path.join(dir,'deploy','.nojekyll'),'');
// version.json — the running build reads this (cache-busted) to detect a newer deploy. Keep it in sync with APP_VER automatically.
const verM=src.match(/APP_VER\s*=\s*'([^']+)'/);
const ver=verM?verM[1]:'';
fs.writeFileSync(path.join(dir,'deploy','version.json'),JSON.stringify({ver}));
console.log('wrote deploy/index.html',out.length,'bytes; deploy/.nojekyll; deploy/version.json ver='+ver);
