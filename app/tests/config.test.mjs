import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdirSync,mkdtempSync,rmSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {loadConfig} from '../server/config.mjs';

function withConfigFiles(run) {
 const directory=mkdtempSync(join(tmpdir(),'journey-config-'));
 const cwd=process.cwd(),keys=['AMAP_CONFIG_FILE','AMAP_KEY','AMAP_SECURITY_JS_CODE'];
 const previous=Object.fromEntries(keys.map(key=>[key,process.env[key]]));
 try {
  process.chdir(directory);
  for(const key of keys)delete process.env[key];
  return run(directory);
 } finally {
  process.chdir(cwd);
  for(const key of keys){if(previous[key]===undefined)delete process.env[key];else process.env[key]=previous[key];}
  rmSync(directory,{recursive:true,force:true});
 }
}

test('an explicitly configured map file must exist',()=>withConfigFiles(directory=>{
 const path=join(directory,'missing.json');
 process.env.AMAP_CONFIG_FILE=path;
 assert.throws(()=>loadConfig(),error=>error.code==='ENOENT'&&error.path===path);
}));

test('the optional default map file may be absent',()=>withConfigFiles(()=>{
 const config=loadConfig();
 assert.equal(config.amapKey,'');
 assert.equal(config.amapSecurityJsCode,'');
}));

test('the default map file loads its JSON values',()=>withConfigFiles(()=>{
 mkdirSync('.local');
 writeFileSync('.local/amap.json',JSON.stringify({key:'default-test-key',securityJsCode:'default-test-secret'}));
 const config=loadConfig();
 assert.equal(config.amapKey,'default-test-key');
 assert.equal(config.amapSecurityJsCode,'default-test-secret');
}));

test('an explicit map file loads JSON and environment values take precedence',()=>withConfigFiles(directory=>{
 const path=join(directory,'explicit.json');
 writeFileSync(path,JSON.stringify({key:'file-test-key',securityJsCode:'file-test-secret'}));
 process.env.AMAP_CONFIG_FILE=path;
 assert.equal(loadConfig().amapKey,'file-test-key');
 assert.equal(loadConfig().amapSecurityJsCode,'file-test-secret');
 process.env.AMAP_KEY='env-test-key';
 assert.equal(loadConfig().amapKey,'env-test-key');
 assert.equal(loadConfig().amapSecurityJsCode,'file-test-secret');
 process.env.AMAP_SECURITY_JS_CODE='env-test-secret';
 assert.equal(loadConfig().amapSecurityJsCode,'env-test-secret');
}));

test('invalid JSON in an explicit map file retains its parse error',()=>withConfigFiles(directory=>{
 const path=join(directory,'invalid.json');
 writeFileSync(path,'{');
 process.env.AMAP_CONFIG_FILE=path;
 assert.throws(()=>loadConfig(),SyntaxError);
}));
