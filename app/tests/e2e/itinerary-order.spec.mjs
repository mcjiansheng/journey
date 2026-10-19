import {test,expect} from '@playwright/test';
import {fileURLToPath} from 'node:url';
import {createApp,shutdownServer} from '../../server/index.mjs';

let app,server,base;
test.beforeAll(async()=>{
 app=createApp({distPath:fileURLToPath(new URL('../../dist/',import.meta.url)),databasePath:':memory:',securityPath:':memory:',config:{amapKey:''}});
 server=await new Promise(resolve=>{const listener=app.listen(0,'127.0.0.1',()=>resolve(listener))});
 base=`http://127.0.0.1:${server.address().port}`;app.locals.config.appOrigin=base;
});
test.afterAll(async()=>{if(server)await shutdownServer(server,app)});

async function setup(page,{mixed=true}={}){
 await page.setViewportSize({width:1440,height:1000});await page.goto(base);
 await page.getByRole('button',{name:'创建账号',exact:true}).click();
 await page.getByLabel('手机号或邮箱').fill(`order-${crypto.randomUUID()}@example.test`);
 await page.getByLabel('你的称呼').fill('排序验收');
 await page.getByLabel('密码',{exact:true}).fill('JourneyOrder2026!');
 await page.getByLabel('确认密码',{exact:true}).fill('JourneyOrder2026!');
 await page.getByRole('button',{name:'创建账号并继续'}).click();
 await page.getByRole('button',{name:'创建旅程',exact:true}).click();
 await page.getByLabel('旅程名称').fill('混合时间排序');await page.getByLabel('目的地',{exact:true}).fill('南京');
 await page.getByLabel('出发日期').fill('2026-11-01');await page.getByLabel('结束日期').fill('2026-11-01');
 await page.getByText('更多设置',{exact:true}).click();await page.getByLabel('旅程时区').selectOption('Asia/Shanghai');
 await page.getByRole('dialog').getByRole('button',{name:'创建旅程',exact:true}).click();
 for(const [title,time] of [['晚间活动','18:00'],['灵活活动',null],['早间活动','09:00']]){
  await page.getByRole('button',{name:'添加活动',exact:true}).click();await page.getByLabel('活动名称').fill(title);
  if(mixed&&time){await page.getByRole('button',{name:'具体时间',exact:true}).click();await page.getByLabel('开始时间',{exact:true}).fill(time)}
  await page.getByRole('dialog').getByRole('button',{name:'完成',exact:true}).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);await expect(page.locator('.sync-status.synced')).toBeVisible();
 }
 await expect(page.locator('.activity-card h3')).toHaveText(mixed?['早间活动','灵活活动','晚间活动']:['晚间活动','灵活活动','早间活动']);
}

test('keyboard reorder crosses precise-time slots and survives reload',async({page})=>{
 await setup(page);
 const handle=page.getByRole('button',{name:'拖动排序：灵活活动'});
 await handle.focus();await handle.press('ArrowDown');
 await expect(page.locator('.activity-card h3')).toHaveText(['早间活动','晚间活动','灵活活动']);
 await handle.press('ArrowUp');await handle.press('ArrowUp');
 await expect(page.locator('.activity-card h3')).toHaveText(['灵活活动','早间活动','晚间活动']);
 await expect(page.locator('.sync-status.synced')).toBeVisible();await page.reload();
 await page.getByRole('button',{name:/继续旅程/}).click();
 await expect(page.locator('.activity-card h3')).toHaveText(['灵活活动','早间活动','晚间活动']);
});

async function dragAboveFirst(page){
 const handle=page.getByRole('button',{name:'拖动排序：灵活活动'});
 const source=await handle.boundingBox(),target=await page.locator('.activity-card').first().boundingBox();
 await page.mouse.move(source.x+source.width/2,source.y+source.height/2);await page.mouse.down();
 await page.mouse.move(target.x+target.width/2,target.y+4,{steps:8});
 await expect(page.locator('.activity-card').first()).toHaveClass(/drop-before/);
}

test('pointer reorder crosses the first precise-time slot',async({page})=>{
 await setup(page);await dragAboveFirst(page);await page.mouse.up();
 await expect(page.locator('.activity-card h3')).toHaveText(['灵活活动','早间活动','晚间活动']);
});

test('cancelled pointer drag preserves the saved order',async({page})=>{
 await setup(page,{mixed:false});await dragAboveFirst(page);
 await page.getByRole('button',{name:'拖动排序：灵活活动'}).dispatchEvent('pointercancel',{pointerId:1,pointerType:'mouse'});
 await page.mouse.up();await expect(page.locator('.activity-card.dragging')).toHaveCount(0);
 await expect(page.locator('.activity-card h3')).toHaveText(['晚间活动','灵活活动','早间活动']);
 await expect(page.locator('.sync-status.synced')).toBeVisible();await page.reload();
 await page.getByRole('button',{name:/继续旅程/}).click();
 await expect(page.locator('.activity-card h3')).toHaveText(['晚间活动','灵活活动','早间活动']);
});

for(const width of [1440,390])test(`activity controls share one aligned row at ${width}px`,async({page},testInfo)=>{
 await setup(page);await page.setViewportSize({width,height:900});
 const card=page.locator('.activity-card').filter({hasText:'灵活活动'});
 const handle=card.getByRole('button',{name:'拖动排序：灵活活动'});
 const more=card.locator('.activity-more>summary');
 const edit=card.getByRole('button',{name:'编辑',exact:true});
 await card.scrollIntoViewIfNeeded();
 const [dragBox,moreBox,editBox]=await Promise.all([handle.boundingBox(),more.boundingBox(),edit.boundingBox()]);
 expect(dragBox.width).toBe(44);expect(moreBox.width).toBe(44);
 expect(dragBox.height).toBe(44);expect(moreBox.height).toBe(44);
 expect(Math.abs(dragBox.y-moreBox.y)).toBeLessThan(1);
 expect(moreBox.x-(dragBox.x+dragBox.width)).toBe(4);
 expect(Math.abs(editBox.y+editBox.height/2-dragBox.y-dragBox.height/2)).toBeLessThan(1);
 await more.click();await expect(card.locator('.activity-more-panel')).toBeVisible();
 const menu=await card.locator('.activity-more-panel').boundingBox();
 expect(menu.x).toBeGreaterThanOrEqual(0);expect(menu.x+menu.width).toBeLessThanOrEqual(width);
 expect(menu.y).toBeGreaterThanOrEqual(moreBox.y+moreBox.height);
 await more.click();
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
 await page.screenshot({path:testInfo.outputPath(`activity-controls-${width}.png`),scale:'css'});
});
