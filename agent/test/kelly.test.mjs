import test from 'node:test';
import assert from 'node:assert/strict';
import { valueBet, stakeFor } from '../lib/kelly.mjs';

const mk = (x12, x12p, odds) => ({ pk: { x12, x12p }, ctx: odds ? { odds } : {} });

test('no bookmaker odds -> no value bet', () => {
  assert.equal(valueBet(mk('H', 0.5, null)), null);
  assert.equal(valueBet({ pk: { x12: 'H', x12p: 0.5 } }), null);
});

test('positive edge uses the picked outcome odds and quarter Kelly', () => {
  const v = valueBet(mk('A', 0.5, [2.0, 3.2, 2.4]));
  assert.equal(v.odds, 2.4);
  assert.ok(Math.abs(v.edge - 0.2) < 1e-9);
  assert.ok(Math.abs(v.full - 0.2 / 1.4) < 1e-9);
  assert.ok(Math.abs(v.f - Math.min(0.05, (0.2 / 1.4) * 0.25)) < 1e-9);
  assert.equal(v.value, true);
});

test('negative or tiny edge is not value and stakes zero', () => {
  const v = valueBet(mk('H', 0.4, [2.0, 3.3, 3.8]));
  assert.equal(v.value, false);
  assert.equal(v.f, 0);
});

test('stake is capped at 5% of bankroll', () => {
  const v = valueBet(mk('H', 0.9, [3.0, 3.3, 3.8]));
  assert.equal(v.f, 0.05);
  assert.equal(stakeFor(10000, v.f), 500);
});

test('stakeFor handles bad input', () => {
  assert.equal(stakeFor('', 0.05), 0);
  assert.equal(stakeFor(1000, 0), 0);
});
