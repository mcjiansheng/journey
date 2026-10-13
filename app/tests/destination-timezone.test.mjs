import test from 'node:test';
import assert from 'node:assert/strict';
import {timezoneFromAdcode,timezoneFromGeocodes,migrateTimezoneChoice,validTimezone,timezoneLabel} from '../src/destination-timezone.js';

test('valid mainland administrative prefixes use Beijing time, including Xinjiang',()=>{
 const prefixes=['11','12','13','14','15','21','22','23','31','32','33','34','35','36','37','41','42','43','44','45','46','50','51','52','53','54','61','62','63','64','65'];
 for(const province of prefixes)assert.equal(timezoneFromAdcode(province+'0000'),'Asia/Shanghai');
 assert.equal(timezoneFromAdcode('320100'),'Asia/Shanghai');
 assert.equal(timezoneFromAdcode('650100'),'Asia/Shanghai');
});
test('Taiwan, Hong Kong and Macau have their own IANA identities',()=>{
 assert.equal(timezoneFromAdcode('710000'),'Asia/Taipei');
 assert.equal(timezoneFromAdcode('810000'),'Asia/Hong_Kong');
 assert.equal(timezoneFromAdcode('820000'),'Asia/Macau');
});
test('unknown prefixes and malformed administrative codes require manual selection',()=>{
 for(const value of [null,undefined,'',110000,'11000','1100000','11abcd',' 110000 ','000000','200000','240000','380000','470000','550000','600000','990000'])assert.equal(timezoneFromAdcode(value),null,String(value));
});
test('only the actual first geocoder administrative code determines automatic civil time',()=>{
 assert.equal(timezoneFromGeocodes([{adcode:'320100',formattedAddress:'江苏省南京市'}]),'Asia/Shanghai');
 assert.equal(timezoneFromGeocodes([{adcode:'810000',formattedAddress:'香港'}]),'Asia/Hong_Kong');
 assert.equal(timezoneFromGeocodes([{formattedAddress:'南京',city:'南京市'}]),null);
 assert.equal(timezoneFromGeocodes([{adcode:'990000'},{adcode:'320100'}]),null);
 for(const value of [null,undefined,[],{}])assert.equal(timezoneFromGeocodes(value),null);
});
test('legacy device and hardcoded defaults migrate to destination while explicit manual choices survive',()=>{
 assert.equal(migrateTimezoneChoice({}),'destination');
 assert.equal(migrateTimezoneChoice({timezoneChoice:'device'}),'destination');
 assert.equal(migrateTimezoneChoice({timezone:'Asia/Shanghai'}),'destination');
 assert.equal(migrateTimezoneChoice({timezone:'America/Los_Angeles'}),'America/Los_Angeles');
 assert.equal(migrateTimezoneChoice({timezoneChoice:'Asia/Shanghai'}),'Asia/Shanghai');
 assert.equal(migrateTimezoneChoice({timezoneChoice:'Asia/Tokyo',timezone:'Asia/Shanghai'}),'Asia/Tokyo');
 assert.equal(migrateTimezoneChoice({timezoneChoice:'destination',timezone:'America/Los_Angeles'}),'destination');
});
test('Beijing display name and offset are independent of daylight saving at the device location',()=>{
 for(const date of ['2026-01-15T12:00:00Z','2026-07-15T12:00:00Z'])assert.equal(timezoneLabel('Asia/Shanghai',new Date(date)),'北京时间（UTC+08:00）');
 assert.match(timezoneLabel('America/Los_Angeles',new Date('2026-01-15T12:00:00Z')),/UTC-08:00/);
 assert.match(timezoneLabel('America/Los_Angeles',new Date('2026-07-15T12:00:00Z')),/UTC-07:00/);
});
test('manual selections must be actual IANA zones, not a device or destination sentinel',()=>{
 for(const zone of ['Asia/Shanghai','Asia/Taipei','Asia/Hong_Kong','Asia/Macau','America/Los_Angeles','UTC'])assert.equal(validTimezone(zone),true);
 for(const zone of ['',null,undefined,'device','destination','nanjing','Unknown/Zone'])assert.equal(validTimezone(zone),false);
});
