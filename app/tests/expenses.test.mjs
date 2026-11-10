import test from 'node:test';
import assert from 'node:assert/strict';
import { expenseDate, expenseTitle, expenseDateLabel, linkedExpenseActivity } from '../src/expenses.js';
import { currencyFactor, money } from '../src/domain.js';
const day = { id: 'day', kind: 'day', state: 'active', payload: { date: '2026-11-04', ordinal: 6 } };
const activity = { id: 'activity', kind: 'activity', state: 'active', payload: { title: '午餐', dayId: 'day' } };
const snapshot = () => ({ trip: { startDate: '2026-10-30', dayCount: 9 }, objects: structuredClone([day, activity]) });
const expense = (patch = {}) => ({ payload: { title: '', date: null, activityId: 'activity', payment: { status: 'paid' }, ...patch } });
test('linked expense follows moved activity date; explicit payment date stays fixed', () => {
  const s = snapshot(), following = expense(), fixed = expense({ date: '2026-11-03' });
  assert.equal(expenseDate(s, following), '2026-11-04');
  assert.equal(expenseTitle(s, following), '午餐');
  s.objects[0].payload.date = '2026-11-05';
  assert.equal(expenseDate(s, following), '2026-11-05');
  assert.equal(expenseDate(s, fixed), '2026-11-03');
});
test('deleted activity or day detaches following expense without losing explicit date', () => {
  for (const target of [0, 1]) {
    const s = snapshot(); s.objects[target].state = 'deleted';
    assert.equal(linkedExpenseActivity(s, expense()), null);
    assert.equal(expenseDate(s, expense()), null);
    assert.equal(expenseTitle(s, expense()), '已支付');
    assert.equal(expenseTitle(s, expense({ payment: { status: 'estimated' } })), '预计');
    assert.equal(expenseDate(s, expense({ date: '2026-11-03' })), '2026-11-03');
  }
  assert.equal(expenseDate(snapshot(), expense({ activityId: null })), null);
});
test('expense headings show itinerary ordinal or pre/post journey payment', () => {
  assert.match(expenseDateLabel(snapshot(), '2026-11-04'), /^第 6 天 · 11\/04/);
  assert.match(expenseDateLabel(snapshot(), '2026-10-29'), /^行前支付/);
  assert.match(expenseDateLabel(snapshot(), '2026-11-08'), /^行后支付/);
  assert.equal(expenseDateLabel(snapshot(), null), '未记录日期');
});
test('currencyFactor and money convert from each currency minor unit', () => {
  // Factor = 10 ^ currency maximumFractionDigits, same rule as ui.jsx.
  assert.equal(currencyFactor('KRW'), 1);
  assert.equal(currencyFactor('JPY'), 1);
  assert.equal(currencyFactor('CNY'), 100);
  assert.equal(currencyFactor('USD'), 100);
  assert.equal(currencyFactor('KWD'), 1000);
  // KRW has no minor unit: 150000 minor is ₩150,000 (previously shown as ₩1,500).
  assert.equal(money(150000, 'KRW'), '₩150,000');
  assert.equal(money(0, 'KRW'), '₩0');
  // JPY regression.
  assert.ok(money(1000, 'JPY').endsWith('¥1,000'));
  // CNY has 2 decimals.
  assert.equal(money(12000, 'CNY'), '¥120.00');
  // KWD has 3 decimals: 1500 minor is 1.500 KWD.
  assert.match(money(1500, 'KWD'), /^KWD\s1\.500$/u);
  assert.equal(money(null, 'CNY'), '');
});
