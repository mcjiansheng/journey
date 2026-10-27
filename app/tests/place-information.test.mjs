import test from 'node:test';
import assert from 'node:assert/strict';
import {normalizePlaceInformation,safePlaceUrl} from '../src/place-information.js';

test('normalizes the current JSAPI all-details shape without inventing missing facts',()=>{
 const result=normalizePlaceInformation({id:'B00190BBCZ',type:'风景名胜;风景名胜;国家级景点',tel:'025-83614286',website:[],open_time:'24小时营业',opentime2:'周一至周日 00:00-24:00',photos:[{title:'夏季',url:'http://store.is.autonavi.com/showpic/example'}],rating:'4.8'});
 assert.equal(result.type,'国家级景点');
 assert.equal(result.openingHours,'周一至周日 00:00-24:00');
 assert.equal(result.telephoneUrl,'tel:02583614286');
 assert.equal(result.photo.title,'夏季');
 assert.equal(result.photo.url,'https://store.is.autonavi.com/showpic/example');
 assert.equal(result.website,'');assert.equal(result.introduction,'');assert.equal(result.rating,undefined);
 assert.equal(result.detailUrl,'https://www.amap.com/place/B00190BBCZ');
});

test('preserves documented deep information and skips unsafe or empty photos',()=>{
 const result=normalizePlaceInformation({id:'a/b',tel:'400-123-4567;025-12345678',website:'https://example.com',photos:[{url:'javascript:alert(1)'}],scenic:{intro:' 景区简介 ',opentime:'09:00–17:00',photos:[{url:'https://example.com/photo.jpg',title:'景区'}]}});
 assert.equal(result.photo.url,'https://example.com/photo.jpg');assert.equal(result.introduction,'景区简介');assert.equal(result.openingHours,'09:00–17:00');
 assert.equal(result.telephoneUrl,'tel:4001234567');assert.equal(result.detailUrl,'https://www.amap.com/place/a%2Fb');
});

test('empty provider values create no placeholder or callable invalid telephone',()=>{
 const empty=normalizePlaceInformation({type:[],photos:[],tel:[],website:[]});
 assert.deepEqual(empty,{type:'',photo:null,openingHours:'',telephone:'',telephoneUrl:'',website:'',introduction:'',detailUrl:''});
 assert.equal(normalizePlaceInformation({tel:'请到现场咨询'}).telephoneUrl,'');
 assert.equal(normalizePlaceInformation({cinema:{openingtime:'10:00–22:00'}}).openingHours,'10:00–22:00');
});

test('provider links accept only absolute http(s) URLs without credentials',()=>{
 for(const value of ['javascript:alert(1)','data:image/png;base64,a','//example.com','https://user:password@example.com','/place/1',[],null])assert.equal(safePlaceUrl(value),'');
 assert.equal(safePlaceUrl(' https://example.com/info '),'https://example.com/info');
 assert.equal(normalizePlaceInformation({photos:[{url:'http://example.com/photo.jpg'}]}).photo.url,'http://example.com/photo.jpg');
 assert.equal(normalizePlaceInformation({photos:[{url:'http://autonavi.com.evil.test/photo.jpg'}]}).photo.url,'http://autonavi.com.evil.test/photo.jpg');
});
