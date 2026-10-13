import {spawnSync} from 'node:child_process';
import {createRequire} from 'node:module';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {assertBrowserLaunchAllowed,prepareBrowserEnvironment,preparePlaywrightTest} from './browser-runtime.mjs';

const args=process.argv.slice(2);
try{
 let command,cwd;
 if(args[0]==='--script'){
  if(!args[1])throw new Error('用法：npm run test:browser -- <脚本路径> [脚本参数]');
  assertBrowserLaunchAllowed();
  prepareBrowserEnvironment();
  command=[resolve(args[1]),...args.slice(2)];
  cwd=process.cwd();
 }else{
  preparePlaywrightTest(args);
  const require=createRequire(import.meta.url);
  command=[require.resolve('@playwright/test/cli'),'test',...args];
  cwd=fileURLToPath(new URL('../',import.meta.url));
 }
 const result=spawnSync(process.execPath,command,{cwd,env:process.env,stdio:'inherit'});
 if(result.error)throw result.error;
 if(result.signal)process.kill(process.pid,result.signal);
 else process.exitCode=result.status;
}catch(error){
 console.error(error.code==='JOURNEY_BROWSER_SANDBOX'?error.message:`${error.code??'BROWSER_TEST_ERROR'}: ${error.message}`);
 process.exitCode=1;
}
