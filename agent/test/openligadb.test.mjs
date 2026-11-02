import test from 'node:test';
import assert from 'node:assert/strict';
import { finalScore } from '../lib/sources/openligadb.mjs';

const HT = { resultTypeID: 1, pointsTeam1: 1, pointsTeam2: 0 };
const FT = { resultTypeID: 2, pointsTeam1: 2, pointsTeam2: 2 };

test('a match in progress (half-time score only) has no final score', () => {
  assert.equal(finalScore({ matchIsFinished: false, matchResults: [HT] }), null);
  assert.equal(finalScore({ matchIsFinished: false, matchResults: [HT, FT] }), null);
});

test('a finished match without a full-time entry is not guessed from the half-time score', () => {
  assert.equal(finalScore({ matchIsFinished: true, matchResults: [HT] }), null);
  assert.equal(finalScore({ matchIsFinished: true, matchResults: [] }), null);
});

test('a finished match returns the full-time score, not the half-time one', () => {
  assert.deepEqual(finalScore({ matchIsFinished: true, matchResults: [HT, FT] }), FT);
  assert.equal(finalScore(null), null);
});
