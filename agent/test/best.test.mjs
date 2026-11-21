import test from 'node:test';
import assert from 'node:assert/strict';
import { bestInfo, bestWon, BEST_MIN_P } from '../lib/best.mjs';
import { MIN_MATCH_P } from '../lib/longshots.mjs';

const mk = (over = {}) => ({
  id: 'x', h: 't:h', a: 't:a', home: 'Home', away: 'Away', comp: 'X', kickoff: '2026-11-04T16:00:00.000Z', status: 'pending', listed: true, games: 60,
  pk: { x12: 'H', x12p: 0.5, dc: '1X', dcp: 0.85, ou: 'O', oup: 0.56, bt: 'Y', btp: 0.52 }, ...over,
});

test('the Best list and the Long shots floor use the same bar', () => { assert.equal(MIN_MATCH_P, BEST_MIN_P); });

test('a complete-data match with a strong top outcome is a best match', () => {
  const b = bestInfo(mk());
  assert.equal(b.best, true);
  assert.ok(b.q >= BEST_MIN_P);
  assert.equal(b.pick.sel, '1X');
});

test('a weak top outcome or incomplete data is not a best match', () => {
  assert.equal(bestInfo(mk({ pk: { x12: 'H', x12p: 0.4, dc: '1X', dcp: 0.62, ou: 'O', oup: 0.56, bt: 'Y', btp: 0.52 } })).best, false);
  assert.equal(bestInfo(mk({ games: 8 })).best, false);
});

test('a claim above anything the results have shown is capped before it can qualify', () => {
  const learned = { n: 100, bands: [{ lo: 0.7, hi: 0.75, n: 100, won: 60, claimed: 0.72, rate: 0.6 }] };
  assert.equal(bestInfo(mk(), learned).best, false);
});

test('bestWon says whether the pick landed', () => {
  const b = bestInfo(mk());
  assert.equal(bestWon({ bestPick: b.pick, result: { hg: 2, ag: 0 } }), true);
  assert.equal(bestWon({ bestPick: b.pick, result: { hg: 0, ag: 2 } }), false);
  assert.equal(bestWon({ result: { hg: 0, ag: 2 } }), undefined);
});
