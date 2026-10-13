import {fileURLToPath} from 'node:url';

export const browserCachePath=fileURLToPath(new URL('../../.local/browsers/',import.meta.url));
export const chromeLaunchOptions={
 channel:'chrome',headless:true,chromiumSandbox:true,
 ignoreDefaultArgs:['--use-mock-keychain','--password-store=basic']
};

export function assertBrowserLaunchAllowed({platform=process.platform,env=process.env}={}){
 // Codex removes this marker for an approved, unsandboxed command. In Seatbelt,
 // Chrome aborts while registering with LaunchServices, before Playwright connects.
 if(platform==='darwin'&&env.CODEX_SANDBOX==='seatbelt'){
  const error=new Error('JOURNEY_BROWSER_SANDBOX: 浏览器尚未启动：当前命令处于 Codex macOS Seatbelt 沙箱。请对同一测试命令使用 sandbox_permissions="require_escalated" 申请单次执行授权，或在普通终端运行。保留 Chrome 自身沙箱；不要删除 CODEX_SANDBOX 或反复重试当前命令。');
  error.code='JOURNEY_BROWSER_SANDBOX';
  throw error;
 }
}

export function prepareBrowserEnvironment(){
 process.env.PLAYWRIGHT_BROWSERS_PATH??=browserCachePath;
}

export function isTestDiscovery(args){
 // UI mode can open a browser even alongside --list.
 return !args.some(arg=>/^--ui(?:$|[=-])/.test(arg))&&
  args.some(arg=>['--list','--help','-h'].includes(arg));
}

export function preparePlaywrightTest(args=process.argv.slice(2)){
 if(!isTestDiscovery(args))assertBrowserLaunchAllowed();
 prepareBrowserEnvironment();
}

export async function launchChrome(){
 assertBrowserLaunchAllowed();
 prepareBrowserEnvironment();
 const {chromium}=await import('playwright');
 return chromium.launch({...chromeLaunchOptions});
}

export async function launchWebKit(){
 assertBrowserLaunchAllowed();
 prepareBrowserEnvironment();
 const {webkit}=await import('playwright');
 // Playwright Test injects the Chromium fixture options into explicit launches.
 return webkit.launch({headless:true,channel:'',ignoreDefaultArgs:[]});
}

// Run again after Playwright has parsed CLI flags, even if a flag-looking value
// (for example a grep pattern) passed the early discovery check.
export default function browserGlobalSetup(){
 assertBrowserLaunchAllowed();
}
