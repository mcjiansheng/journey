import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import {createAmapRouter} from '../server/amap.mjs';

test('map proxy accepts actual SDK repeated scalar parameters and retains host, key and callback boundaries',async()=>{
 const nativeFetch=globalThis.fetch,requests=[];
 globalThis.fetch=async(url,options)=>{const u=new URL(url);if(u.hostname==='restapi.amap.com'){requests.push(u);return new Response('jsonp_valid({"status":"1"})',{status:200});}return nativeFetch(url,options);};
 const app=express();app.use(createAmapRouter({amapKey:'server-key',amapSecurityJsCode:'server-secret'}));const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));const root=`http://127.0.0.1:${server.address().port}`;
 try{
 const ok=await nativeFetch(root+'/v3/place/text?s=rsv3&s=rsv3&children=&type_=KEYWORD&antiCrab=true&language=zh_cn&key=untrusted&callback=jsonp_valid');assert.equal(ok.status,200);assert.equal(requests.length,1);assert.equal(requests[0].searchParams.get('key'),'server-key');assert.equal(requests[0].searchParams.get('jscode'),'server-secret');assert.deepEqual(requests[0].searchParams.getAll('s'),['rsv3']);
 for(const path of ['/v3/place/text?s=a&s=b','/v3/place/text?callback=alert(1)','/v3/place/text?url=https://example.com','/other/path']){const r=await nativeFetch(root+path);assert.ok([400,404].includes(r.status));}assert.equal(requests.length,1);
 const route=await nativeFetch(root+'/v3/direction/walking?origin=118.8,32.1&destination=118.9,32.2&multipath=0&alternative_route=2&isindoor=1&callback=jsonp_valid');assert.equal(route.status,200);assert.equal(requests.at(-1).searchParams.get('multipath'),'0');assert.equal(requests.at(-1).searchParams.get('alternative_route'),'2');assert.equal(requests.at(-1).searchParams.get('isindoor'),'1');
 const v5=await nativeFetch(root+'/v5/place/text?keywords=museum&region=320100&city_limit=true&page_size=20&page_num=1&show_fields=children,business');assert.equal(v5.status,200);assert.equal(requests.at(-1).searchParams.get('region'),'320100');assert.equal(requests.at(-1).searchParams.get('page_size'),'20');
 for(const bad of ['/v3/place/text?jscode=leak','/v3/place/text?sig=forged','/v3/place/text?securityJsCode=leak','/v3/place/text?redirect=https://evil.example','/v3/place/text?constructor=1',`/v3/place/text?keywords=${'a'.repeat(3001)}`]){const r=await nativeFetch(root+bad);assert.equal(r.status,400);}
 }finally{globalThis.fetch=nativeFetch;await new Promise(r=>server.close(r));}
});
