import {test,expect} from '@playwright/test';
import {launchWebKit} from '../../scripts/browser-runtime.mjs';

test('Chrome fixture starts and renders without an application server',async({page})=>{
 await page.setContent('<button onclick="this.textContent=\'已点击\'">启动检查</button>');
 await page.getByRole('button',{name:'启动检查'}).click();
 await expect(page.getByRole('button')).toHaveText('已点击');
});

test('shared WebKit launcher starts and renders without an application server',async()=>{
 const browser=await launchWebKit();
 try{
  const page=await browser.newPage();
  await page.setContent('<h1>WebKit 启动检查</h1>');
  await expect(page.getByRole('heading')).toHaveText('WebKit 启动检查');
 }finally{await browser.close();}
});
