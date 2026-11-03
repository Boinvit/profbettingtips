import test from 'node:test';
import assert from 'node:assert/strict';
import { reconcile, tierOf, mergeCorrections } from '../lib/results.mjs';
const bay = () => ({ id: '2026-11-01|bayern|dortmund', hg: 1, ag: 0 });

test('tier-1 source corrects a wrong legacy score (Bayern v Dortmund 1-0 -> 2-2)', () => {
  const ex = bay(); const c = reconcile(ex, { hg: 2, ag: 2, src: 'fduk' });
  assert.equal(c.action, 'overwrite'); assert.deepEqual([ex.hg, ex.ag, ex.s], [2, 2, 1]);
});
test('tier-2 source cannot overwrite a record without provenance', () => {
  const ex = bay(); const c = reconcile(ex, { hg: 2, ag: 2, src: 'oldb' });
  assert.equal(c.action, 'ignored-lower-tier'); assert.equal(ex.hg, 1);
});
test('lower tier never overwrites higher tier', () => {
  const ex = { ...bay(), s: 1 }; const c = reconcile(ex, { hg: 3, ag: 3, src: 'ofb' });
  assert.equal(c.action, 'ignored-lower-tier'); assert.deepEqual([ex.hg, ex.ag], [1, 0]);
});
test('higher tier overwrites lower tier', () => {
  const ex = { ...bay(), s: 2 }; assert.equal(reconcile(ex, { hg: 2, ag: 2, src: 'fdorg' }).action, 'overwrite'); assert.equal(ex.ag, 2);
});
test('same-tier disagreement is flagged, score kept', () => {
  const ex = { ...bay(), s: 1 }; const c = reconcile(ex, { hg: 2, ag: 2, src: 'apif' });
  assert.equal(c.action, 'conflict'); assert.equal(ex.hg, 1);
});
test('unknown source is tier 3 and never overwrites', () => {
  assert.equal(tierOf('whatever'), 3); assert.equal(tierOf(undefined), 3);
  const ex = bay(); assert.equal(reconcile(ex, { hg: 9, ag: 9 }).action, 'ignored-lower-tier'); assert.equal(ex.hg, 1);
});
test('agreeing score records provenance and returns null', () => {
  const ex = bay(); assert.equal(reconcile(ex, { hg: 1, ag: 0, src: 'fduk' }), null); assert.equal(ex.s, 1);
});
test('non-integer scores are ignored', () => {
  const ex = bay(); assert.equal(reconcile(ex, { hg: null, ag: 1, src: 'fduk' }), null); assert.equal(ex.hg, 1);
});
test('mergeCorrections skips exact repeats', () => {
  const c = { id: 'x', new: '2-2', src: 'fduk', action: 'overwrite' };
  assert.equal(mergeCorrections([c], [c, { ...c, id: 'y' }]).added, 1);
});
