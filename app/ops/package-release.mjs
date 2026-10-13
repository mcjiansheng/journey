import { execFileSync } from 'node:child_process';
import { cp, mkdir, mkdtemp, rm, writeFile, chmod, readdir } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';

const app=resolve(dirname(fileURLToPath(import.meta.url)),'..'), repo=resolve(app,'..');
const id=process.argv[2]||new Date().toISOString().replace(/[:.]/g,'-');
if(!/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,95}$/.test(id))throw new Error('Release id must contain only letters, digits, dot, underscore or hyphen');
const root=join(repo,'.local/releases'), archive=join(root,`${id}.tar.gz`);
await mkdir(root,{recursive:true,mode:0o700});
// Refuse replacing a release with the same immutable identity.
await writeFile(archive,'',{flag:'wx',mode:0o600});
const stage=await mkdtemp(join(root,'.stage-'));
async function digest(path){const hash=createHash('sha256');for await(const chunk of createReadStream(path))hash.update(chunk);return hash.digest('hex');}
try{
 execFileSync('npm',['run','build'],{cwd:app,stdio:'inherit',env:{...process.env,APP_BASE_PATH:'/'}});
 for(const name of ['package.json','package-lock.json','server','dist','ops'])await cp(join(app,name),join(stage,name),{recursive:true});
 await mkdir(join(stage,'src'));await cp(join(app,'src/domain.js'),join(stage,'src/domain.js'));
 execFileSync('npm',['ci','--omit=dev','--ignore-scripts','--cache',join(repo,'.local/npm-cache')],{cwd:stage,stdio:'inherit'});
 const files=[];
 async function inventory(dir,prefix=''){for(const entry of await readdir(dir,{withFileTypes:true})){const name=prefix+entry.name,path=join(dir,entry.name);if(entry.isDirectory())await inventory(path,name+'/');else if(entry.isFile())files.push({path:name,sha256:await digest(path)});else if(entry.isSymbolicLink()) { /* npm executable links are preserved by tar. */ }else throw new Error(`Unsupported release entry: ${name}`);}}
 await inventory(stage);
 const manifest={release:id,createdAt:new Date().toISOString(),runtime:'Node.js 22.22.1',gitCommit:execFileSync('git',['rev-parse','HEAD'],{cwd:repo,encoding:'utf8'}).trim(),files};
 await writeFile(join(stage,'release-manifest.json'),JSON.stringify(manifest,null,2)+'\n');
 execFileSync('tar',['--no-xattrs','-czf',archive,'-C',stage,'.'],{stdio:'inherit',env:{...process.env,COPYFILE_DISABLE:'1'}});
 await chmod(archive,0o600);
 await writeFile(archive+'.sha256',`${await digest(archive)}  ${id}.tar.gz\n`,{flag:'wx',mode:0o600});
 await writeFile(join(root,`${id}.manifest.json`),JSON.stringify(manifest,null,2)+'\n',{flag:'wx',mode:0o600});
 console.log(archive);
}catch(error){await rm(archive,{force:true});throw error;}
finally{await rm(stage,{recursive:true,force:true});}
