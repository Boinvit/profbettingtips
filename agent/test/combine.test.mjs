import test from 'node:test';
import assert from 'node:assert/strict';
import { combineSlips } from '../lib/combine.mjs';

const L = (pid, odds, p, t) => ({ pid, odds, p, kickoff: `2026-11-02T${t}:00:00.000Z` });
const A = { id: 'a', legs: [L('1', 1.2, 0.85, '10'), L('2', 1.5, 0.7, '14')] };
const B = { id: 'b', legs: [L('3', 1.1, 0.9, '12'), L('4', 1.3, 0.78, '16')] };

test('odds and chance multiply across slips; payout and expected return follow from the stake', () => {
  const c = combineSlips([A, B], 100);
  assert.equal(c.slips, 2); assert.equal(c.legs, 4);
  assert.ok(Math.abs(c.odds - 1.2 * 1.5 * 1.1 * 1.3) < 0.002);
  assert.ok(Math.abs(c.prob - 0.85 * 0.7 * 0.9 * 0.78) < 0.002);
  assert.ok(Math.abs(c.payout - 100 * 2.574) < 0.5);
  assert.ok(c.expected < c.payout && c.expected > 0);
  assert.deepEqual(c.overlaps, []);
});

test('a match shared by two ticked slips is flagged', () => {
  const C = { id: 'c', legs: [L('2', 1.4, 0.8, '14'), L('9', 1.2, 0.9, '18')] };
  assert.deepEqual(combineSlips([A, C], 50).overlaps, ['2']);
  assert.deepEqual(combineSlips([A], 50).overlaps, []);
});

test('cash-out ladder is in kick-off order, shrinking chance, rising value', () => {
  const c = combineSlips([A, B], 100);
  assert.ok(c.ladder.length >= 2);
  for (let i = 1; i < c.ladder.length; i++) { assert.ok(c.ladder[i].k > c.ladder[i - 1].k); assert.ok(c.ladder[i].prob <= c.ladder[i - 1].prob); assert.ok(c.ladder[i].value >= c.ladder[i - 1].value); }
  assert.ok(Math.abs(c.ladder[0].multiple - 1.2 * 0.95) < 0.01 || c.ladder[0].k > 1); // first checkpoint uses the earliest legs
});

test('no stake gives no money figures but still a multiple; bad stake is ignored', () => {
  const c = combineSlips([A, B], 0);
  assert.equal(c.payout, 0); assert.ok(c.ladder[0].multiple > 0);
  assert.equal(combineSlips([A], 'abc').stake, 0);
});
