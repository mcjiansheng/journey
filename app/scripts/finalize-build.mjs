import {readdir,readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
async function filesAt(directory,prefix='') {
 const files=[];
 for(const entry of await readdir(directory,{withFileTypes:true})) {
  const relative=prefix+entry.name;
  if(entry.isDirectory()) files.push(...await filesAt(directory+'/'+entry.name,relative+'/'));
  else if(!['sw.js','build.json'].includes(relative))files.push(relative);
 }
 return files.sort();
}
const files=await filesAt('dist'),assets=files.filter(p=>p!=='index.html');
const source=await readFile('public/sw.js','utf8');
const hash=createHash('sha256').update(source);
for(const p of files)hash.update(p).update(await readFile('dist/'+p));
const id=hash.digest('hex').slice(0,16);
await writeFile('dist/sw.js',source.replace('__BUILD_ID__',id).replace('/*__PRECACHE__*/[]',JSON.stringify(assets)));
await writeFile('dist/build.json',JSON.stringify({version:'1.0.0',buildId:id,assets},null,2)+'\n');
console.log(`Offline application shell: ${assets.length} assets, build ${id}`);
