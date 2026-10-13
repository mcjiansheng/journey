import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {assertBrowserLaunchAllowed,isTestDiscovery} from '../scripts/browser-runtime.mjs';

const runner=fileURLToPath(new URL('../scripts/run-browser-tests.mjs',import.meta.url));
const appDir=fileURLToPath(new URL('../',import.meta.url));
const restricted={...process.env,CODEX_SANDBOX:'seatbelt'};

test('only the known macOS Codex launch restriction blocks execution',()=>{
 assert.throws(()=>assertBrowserLaunchAllowed({platform:'darwin',env:{CODEX_SANDBOX:'seatbelt'}}),{code:'JOURNEY_BROWSER_SANDBOX'});
 for(const [platform,env] of [['darwin',{}],['linux',{CODEX_SANDBOX:'seatbelt'}],['win32',{}]]){
  assert.doesNotThrow(()=>assertBrowserLaunchAllowed({platform,env}));
 }
 assert.equal(isTestDiscovery(['--list']),true);
 for(const args of [[],['--list','--ui'],['--list','--ui-port=8080'],['--list','--ui-host','127.0.0.1']])assert.equal(isTestDiscovery(args),false);
});

test('restricted standalone runner exits before evaluating a script, even with --list', {skip:process.platform!=='darwin'},async()=>{
 const dir=await mkdtemp(join(tmpdir(),'journey-browser-guard-'));
 try{
  const script=join(dir,'sentinel.mjs');
  await writeFile(script,"console.log('SCRIPT_WAS_EXECUTED');process.exitCode=42;\n");
  const result=spawnSync(process.execPath,[runner,'--script',script,'--list'],{env:restricted,encoding:'utf8',timeout:10000});
  assert.equal(result.status,1,result.stderr);
  assert.match(result.stderr,/JOURNEY_BROWSER_SANDBOX.*require_escalated/);
  assert.doesNotMatch(result.stdout,/SCRIPT_WAS_EXECUTED/);
 }finally{await rm(dir,{recursive:true,force:true});}
});

test('direct config loading rejects a restricted run before loading tests', {skip:process.platform!=='darwin'},()=>{
 const config=new URL('../playwright.config.mjs',import.meta.url).href;
 const result=spawnSync(process.execPath,['--input-type=module','-e',`await import(${JSON.stringify(config)})`],{env:restricted,encoding:'utf8',timeout:10000});
 assert.equal(result.status,1,result.stderr);
 assert.match(result.stderr,/JOURNEY_BROWSER_SANDBOX/);
});


test('parsed grep value cannot bypass global setup or execute a test', {skip:process.platform!=='darwin'},async()=>{
 const dir=await mkdtemp(join(tmpdir(),'journey-browser-global-'));
 try{
  const config=new URL('../playwright.config.mjs',import.meta.url).href;
  const playwright=new URL('../node_modules/@playwright/test/index.mjs',import.meta.url).href;
  await writeFile(join(dir,'playwright.config.mjs'),`import config from ${JSON.stringify(config)};import {resolve} from 'node:path';export default {...config,testDir:${JSON.stringify(dir)},globalSetup:config.globalSetup?resolve(${JSON.stringify(appDir)},config.globalSetup):undefined,reporter:'list'};`);
  await writeFile(join(dir,'sentinel.spec.mjs'),`import {test} from ${JSON.stringify(playwright)};test('sentinel --list',()=>{console.log('TEST_WAS_EXECUTED')});`);
  const result=spawnSync(process.execPath,[runner,'--config',join(dir,'playwright.config.mjs'),'--grep','--list'],{cwd:appDir,env:restricted,encoding:'utf8',timeout:15000});
  assert.equal(result.status,1,result.stderr);
  assert.match(result.stdout+result.stderr,/JOURNEY_BROWSER_SANDBOX/);
  assert.doesNotMatch(result.stdout,/TEST_WAS_EXECUTED/);
 }finally{await rm(dir,{recursive:true,force:true});}
});

test('test discovery remains available in a restricted environment',()=>{
 const result=spawnSync(process.execPath,[runner,'browser-startup.spec.mjs','--list'],{cwd:appDir,env:restricted,encoding:'utf8',timeout:15000});
 assert.equal(result.status,0,result.stderr);
 assert.match(result.stdout,/Total: 2 tests in 1 file/);
});

test('standalone runner preserves script arguments and failure status', {skip:process.platform==='darwin'&&process.env.CODEX_SANDBOX==='seatbelt'},async()=>{
 const dir=await mkdtemp(join(tmpdir(),'journey-browser-runner-'));
 try{
  const script=join(dir,'exit.mjs');
  await writeFile(script,"console.log(JSON.stringify(process.argv.slice(2)));process.exitCode=7;\n");
  const result=spawnSync(process.execPath,[runner,'--script',script,'argument with spaces'],{encoding:'utf8',timeout:10000});
  assert.equal(result.status,7,result.stderr);
  assert.deepEqual(JSON.parse(result.stdout),['argument with spaces']);
 }finally{await rm(dir,{recursive:true,force:true});}
});
