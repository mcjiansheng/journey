// Rebuild PNG install icons from the existing vector with local Chrome.
import {chromium} from '@playwright/test';
import {readFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
const browser=await chromium.launch({channel:'chrome',headless:true,chromiumSandbox:true,ignoreDefaultArgs:['--use-mock-keychain','--password-store=basic']});
try {
 const page=await browser.newPage({deviceScaleFactor:1});
 const svg=await readFile(new URL('../public/icon-maskable.svg',import.meta.url),'utf8');
 await page.setContent('<style>html,body{margin:0;width:100%;height:100%}svg{width:100%;height:100%;display:block}</style>'+svg);
 for(const [size,name] of [[180,'apple-touch-icon.png'],[192,'icon-192.png'],[512,'icon-512.png']]) {
  await page.setViewportSize({width:size,height:size});
  await page.screenshot({path:fileURLToPath(new URL('../public/'+name,import.meta.url))});
 }
}finally{await browser.close();}
