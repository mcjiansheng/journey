import test from 'node:test';
import assert from 'node:assert/strict';
import {normalizeActivityUrl} from '../src/activity-url.js';

test('activity links trim whitespace and complete bare domains before saving', () => {
  for (const [input, expected] of [
    ['ehall.nju.edu.cn', 'https://ehall.nju.edu.cn'],
    ['  https://a.com  ', 'https://a.com'],
    ['www.a.com/path?x=1', 'https://www.a.com/path?x=1'],
    ['http://a.com/path', 'http://a.com/path'],
    ['HTTPS://a.com', 'https://a.com'],
    ['example.com:8443/path', 'https://example.com:8443/path'],
    ['例子.中国', 'https://例子.中国'],
    ['https://a.com/my trip', 'https://a.com/my trip'],
    ['  ', ''],
  ]) assert.equal(normalizeActivityUrl(input), expected);
});
test('activity links reject invalid addresses and unsupported protocols', () => {
  for (const input of ['去东南大学', 'a b.com', 'https://', 'https://a b.com'])
    assert.throws(() => normalizeActivityUrl(input), /链接格式不对/);
  for (const input of ['javascript:alert(1)', 'ftp://a.com'])
    assert.throws(() => normalizeActivityUrl(input), /请输入 http 或 https 链接/);
});
