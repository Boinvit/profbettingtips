import test from 'node:test';
import assert from 'node:assert/strict';
import { buildDay, updateLongShots, dayMatches, MIN_MATCH_P, MAX_LEGS, MAX_SLIPS, learnCalibration, adjustP, topLegSamples, backtest, adviceFor } from '../lib/longshots.mjs';

const now = new Date('2026-11-04T06:00:00Z');
const mkp = (i, over = {}) => ({
  id: 'm' + i, h: 't:h' + i, a: 't:a' + i, home: 'Home ' + i, away: 'Away ' + i, comp: 'X', kickoff: '2026-11-04T16:00:00.000Z', status: 'pending', listed: true, games: 60,
  pk: { x12: 'H', x12p: 0.5, dc: '1X', dcp: 0.85 - i * 0.004, ou: 'O', oup: 0.56, bt: 'Y', btp: 0.52 }, ...over,
});
const pool = (n) => Array.from({ length: n }, (_, i) => mkp(i));

test('dayMatches keeps only trusted, listed matches at or above the floor, most reliable first', () => {
  const ms = dayMatches([...pool(5), mkp(90, { listed: false }), mkp(91, { games: 8 })], '2026-11-04', now);
  assert.equal(ms.length, 5);
  assert.ok(ms.every((c) => c.legs[0].p >= MIN_MATCH_P));
  assert.ok(ms.every((c, i) => i === 0 || ms[i - 1].legs[0].p >= c.legs[0].p));
});

test('one slip of the most reliable matches, capped, with extra slips from separate matches', () => {
  const few = buildDay(pool(6), '2026-11-04', now);
  assert.equal(few.length, 1);
  assert.equal(few[0].key, 'A');
  assert.equal(few[0].legs.length, 6);
  const many = buildDay(pool(20), '2026-11-04', now);
  assert.equal(many.length, MAX_SLIPS);
  assert.ok(many.every((s) => s.legs.length <= MAX_LEGS && s.legs.length >= 4));
  const ids = many.flatMap((s) => s.legs.map((l) => l.pid));
  assert.equal(new Set(ids).size, ids.length);
  assert.ok(many[0].pAll >= many[1].pAll);
  assert.deepEqual(buildDay(pool(3), '2026-11-04', now), []);
});

test('an untouched set can grow; a started set never changes', () => {
  const a = updateLongShots({ items: [] }, pool(4), now);
  assert.equal(a.items.length, 1);
  assert.equal(updateLongShots(a, pool(4), now).items[0].legs.length, 4);
  assert.equal(updateLongShots(a, pool(10), now).items.length, 2);
  assert.equal(updateLongShots(a, pool(10), new Date('2026-11-04T16:30:00Z')).items.length, 1);
});

test('slips never exceed MAX_LEGS legs even with many matches', () => {
  assert.equal(MAX_LEGS, 6);
  const r = updateLongShots({ items: [] }, pool(30), now);
  assert.equal(r.items.length, MAX_SLIPS);
  assert.ok(r.items.every((s) => s.legs.length <= MAX_LEGS));
});

test('a stale SportPesa list: unlisted matches still make a slip, flagged unconfirmed; a fresh list keeps the strict rule', () => {
  const unl = Array.from({ length: 8 }, (_, i) => mkp(i, { listed: false }));
  assert.equal(updateLongShots({ items: [] }, unl, now).items.length, 0);
  const r = updateLongShots({ items: [] }, unl, now, { requireListed: false });
  assert.equal(r.items.length, 1);
  assert.ok(r.items.every((s) => s.unconfirmed === true));
  assert.ok(updateLongShots({ items: [] }, pool(8), now, { requireListed: false }).items.every((s) => s.unconfirmed === false));
});

test('learnCalibration and adjustP pull a claim toward what really happened, in proportion to the evidence', () => {
  const s = Array.from({ length: 60 }, (_, i) => ({ p: 0.72, ok: i < 30 }));
  const L = learnCalibration(s);
  assert.equal(adjustP(0.72, null), 0.72);
  const adj = adjustP(0.72, L);
  assert.ok(adj < 0.72 && adj > 0.5);
  const capped = adjustP(0.9, L);
  assert.ok(capped > 0.5 && capped <= 0.61);
  assert.equal(adjustP(0.55, L), 0.55);
  const thin = learnCalibration(Array.from({ length: 6 }, (_, i) => ({ p: 0.72, ok: i < 3 })));
  assert.ok(adjustP(0.72, thin) > adj);
});

test('topLegSamples records the top outcome of settled trusted matches and whether it landed', () => {
  const s = topLegSamples([mkp(1, { status: 'settled', result: { hg: 2, ag: 0 } }), mkp(2, { status: 'settled', result: { hg: 0, ag: 3 } }), mkp(3)]);
  assert.equal(s.length, 2);
  assert.equal(s[0].ok, true);
  assert.equal(s[1].ok, false);
});

test('backtest replays the rule day by day and prices it at the odds', () => {
  const day = (d, ok) => Array.from({ length: 4 }, () => ({ day: d, p: 0.8, odds: 1.3, ok }));
  const bt = backtest([...day('2026-10-01', true), ...day('2026-10-02', false), ...day('2026-10-03', true)]);
  assert.equal(bt.slips, 3);
  assert.equal(bt.won, 2);
  assert.equal(bt.stake, 30);
  assert.ok(Math.abs(bt.returned - 2 * 10 * 1.3 ** 4) < 0.1);
});

test('adviceFor: wait without evidence, no when it loses, small stake only with a proven edge', () => {
  assert.equal(adviceFor({ slips: 0 }, null).verdict, 'wait');
  assert.equal(adviceFor({ slips: 20, won: 1, expectedWins: 4, roi: -0.6 }, null).verdict, 'no');
  assert.equal(adviceFor({ slips: 40, won: 12, expectedWins: 9, roi: 0.2 }, null).verdict, 'tiny');
  assert.equal(adviceFor({ slips: 3, won: 0, expectedWins: 1 }, { slips: 40, won: 3, expected: 9, roi: -0.5 }).verdict, 'no');
  assert.equal(adviceFor({ slips: 20, won: 6, expectedWins: 6, roi: 0.05 }, null).verdict, 'wait');
});

test('slips settle, and the summary counts them with an honest verdict', () => {
  const a = updateLongShots({ items: [] }, pool(4), now);
  assert.equal(a.items.length, 1);
  const later = new Date('2026-11-05T06:00:00Z');
  const won = updateLongShots(a, pool(4).map((p) => ({ ...p, status: 'settled', result: { hg: 2, ag: 0 } })), later);
  assert.equal(won.items[0].status, 'won');
  assert.equal(won.summary.periods.all.won, 1);
  assert.equal(won.summary.advice.verdict, 'wait');
  const a2 = updateLongShots({ items: [] }, pool(4), now);
  const lost = updateLongShots(a2, pool(4).map((p, i) => ({ ...p, status: 'settled', result: i ? { hg: 2, ag: 0 } : { hg: 0, ag: 2 } })), later);
  assert.equal(lost.items[0].status, 'lost');
  assert.equal(lost.summary.form, 'L');
});
