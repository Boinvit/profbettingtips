import test from 'node:test';
import assert from 'node:assert/strict';
import { parseSlip, checkSlip } from '../lib/slipcheck.mjs';

const L = 'https://www.ke.sportpesa.com/#';
const SLIP = ['MULTI BET (2)', 'Share', `* [QPR \u2013 Burnley](${L})`, `[\u00d7](${L})`, '1X2', 'Your Pick: Home', '1.96', `* [Manchester Utd Youth \u2013 AS Roma U20](${L})`, `[\u00d7](${L})`, '1X2', 'Your Pick: Home', '1.96', '', 'TOTAL ODDS:', '3.84', 'BET AMOUNT (KSH):', '-+', 'POSSIBLE WIN', 'KSH 38.41.'].join('\n');
const ID = { QPR: 't:qpr', Burnley: 't:burnley' };
const P = { h: 0.5, d: 0.25, a: 0.25, o: 0.5, b: 0.5 };
const now = new Date('2026-11-04T10:00:00Z');

test('parses an unplaced betslip (no dates, no results, empty stake)', () => {
  const p = parseSlip(SLIP);
  assert.equal(p.legs.length, 2); assert.equal(p.declared, 2); assert.equal(p.stake, null); assert.equal(p.totalOdds, 3.84);
  assert.deepEqual([p.legs[0].home, p.legs[0].away, p.legs[0].code, p.legs[0].odds, p.legs[0].kickoff], ['QPR', 'Burnley', 'H', 1.96, null]);
  assert.deepEqual([p.legs[1].home, p.legs[1].away], ['Manchester Utd Youth', 'AS Roma U20']);
});

test('checks a betslip without kickoffs: matches upcoming fixtures by team, flags youth sides', () => {
  const preds = [{ h: 't:qpr', a: 't:burnley', kickoff: '2026-11-04T19:45:00Z', status: 'pending', p: P }];
  const r = checkSlip(parseSlip(SLIP), { preds, resolve: (n) => ID[n] || null, now, stake: 50 });
  assert.equal(r.rows[0].matched, true); assert.equal(r.rows[0].status, 'pending'); assert.ok(r.rows[0].p > 0.4 && r.rows[0].p < 0.6);
  assert.equal(r.rows[1].matched, false); assert.equal(r.rows[1].youth, true); assert.equal(r.rows[0].youth, false);
  assert.ok(Math.abs(r.odds - 3.842) < 0.01); assert.equal(r.stake, 50);
});

test('a stale settled prediction is not used for an unplaced slip', () => {
  const preds = [{ h: 't:qpr', a: 't:burnley', kickoff: '2026-11-03T19:45:00Z', status: 'settled', result: { hg: 0, ag: 1 }, p: P }];
  const r = checkSlip(parseSlip(SLIP), { preds, resolve: (n) => ID[n] || null, now });
  assert.equal(r.rows[0].matched, false);
});
