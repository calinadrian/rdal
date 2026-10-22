// Preserve instance recipe arrays that the compact world scan intentionally summarizes.
const fs=require('fs'),path=require('path'),{spawnSync}=require('child_process');
const out=path.join(__dirname,'Extractor/out');
const world=JSON.parse(fs.readFileSync(path.join(out,'world_actors.json')));
const survey=spawnSync(path.join(__dirname,'Extractor/bin/out/Extractor.exe'),['survey',out],{encoding:'utf8'});
if(survey.error||survey.status!==0)throw survey.error||Error(survey.stderr);
const actors=world.filter(a=>/RecipeDispenser/.test(a.cls));
const levels=new Set(actors.map(a=>a.level));
const files=fs.readFileSync(path.join(out,'files.txt'),'utf8').split(/\r?\n/).filter(p=>levels.has(path.basename(p,'.umap'))&&p.endsWith('.umap'));
const dir=path.join(out,'raw/acquisition-world');fs.mkdirSync(dir,{recursive:true});
const result=spawnSync(path.join(__dirname,'Extractor/bin/out/Extractor.exe'),['json',dir,...files],{encoding:'utf8',maxBuffer:8*1024*1024});
if(result.error||result.status!==0)throw result.error||Error(result.stderr);
const ids=new Set(actors.map(a=>a.name));const data={};
for(const file of files){const json=path.join(dir,path.basename(file,'.umap')+'.json');if(!fs.existsSync(json))continue;
 for(const e of JSON.parse(fs.readFileSync(json)))if(ids.has(e.Name))data[e.Name]=e.Properties || {};}
fs.writeFileSync(path.join(out,'raw/acquisition-world.json'),JSON.stringify(data));
fs.rmSync(dir,{recursive:true,force:true}); // the full level dumps (~160 MB) are only needed for the summary above
console.log(`Acquisition world: ${Object.keys(data).length}/${actors.length} placed recipe objects from ${files.length} levels`);
