import test from 'node:test';
import assert from 'node:assert/strict';
import { calibrate, buildCalibration, PROB_CAP } from '../lib/calibration.mjs';
import { buildWindow, updateAccas, MIN_TOTAL_ODDS } from '../lib/accas.mjs';

const bins = (rows) => ({ markets: { dc: rows.map(([lo, hi, n, pred, real]) => ({ lo, hi, n, pred, real })) } });

test('calibrate pulls an overconfident bin down by the measured gap', () => {
  const cal = bins([[0.85, 0.9, 1000, 0.87, 0.7]]);
  const q = calibrate(cal, 'dc', 0.87);
  assert.ok(q < 0.71 && q > 0.68, `got ${q}`);
});

test('calibrate never exceeds the probability cap and leaves unknown data alone', () => {
  assert.equal(calibrate(bins([[0.9, 1, 1000, 0.95, 0.99]]), 'dc', 0.95), PROB_CAP);
  assert.equal(calibrate(null, 'dc', 0.97), 0.97);
  assert.equal(calibrate(bins([[0.5, 0.55, 0, null, null]]), 'dc', 0.52), 0.52);
});

test('a thin bin barely moves the probability (shrinks toward the stated value)', () => {
  const q = calibrate(bins([[0.9, 1, 2, 0.91, 0.5]]), 'dc', 0.91);
  assert.ok(q > 0.88, `got ${q}`);
});

test('buildCalibration returns a table with counts and real hit rates', () => {
  const ms = [];
  for (let i = 0; i < 400; i++) ms.push({ id: `m${i}`, c: 'E0', d: new Date(Date.UTC(2024, 0, 1 + i)).toISOString(), h: `t:h${i % 8}`, a: `t:a${i % 8}`, hg: i % 3, ag: i % 2 });
  const cal = buildCalibration(ms, undefined, { now: new Date('2026-11-01T00:00:00Z') });
  assert.equal(cal.n, 400); assert.ok(cal.evaluated > 200);
  assert.deepEqual(Object.keys(cal.markets).sort(), ['bt', 'dc', 'ou', 'x12']);
});

const mkP = (i) => ({ id: `2026-11-01|t:h${i}|t:a${i}`, h: `t:h${i}`, a: `t:a${i}`, home: `H${i}`, away: `A${i}`, comp: 'E0', status: 'pending', games: 20,
  kickoff: `2026-11-01T${String(12 + (i % 6)).padStart(2, '0')}:00:00.000Z`,
  pk: { x12: 'H', x12p: 0.6 + (i % 5) * 0.03, alt: 'D', altp: 0.25, dc: '1X', dcp: 0.82, ou: 'O', oup: 0.6, bt: 'Y', btp: 0.58 } });
const pool = Array.from({ length: 30 }, (_, i) => mkP(i));
const W = { id: 'daily:2026-11-01', kind: 'daily', days: ['2026-11-01'] };
const NOW = new Date('2026-11-01T06:00:00Z');

test('a fixture anchors at most ONE slip per window', () => {
  const slips = buildWindow(W, pool, NOW);
  assert.ok(slips.length >= 3, `only ${slips.length} slips`);
  const pids = slips.flatMap((s) => s.legs.map((l) => l.pid));
  assert.equal(new Set(pids).size, pids.length, 'a fixture appears in more than one slip');
  for (const s of slips) assert.equal(new Set(s.legs.map((l) => l.pid)).size, s.legs.length); // and once within its slip
});

test('with calibration, legs carry the raw and corrected probability', () => {
  const cal = bins([[0.8, 0.85, 1000, 0.82, 0.7]]);
  const slips = buildWindow(W, pool, NOW, { markets: { ...cal.markets } });
  const leg = slips.flatMap((s) => s.legs).find((l) => l.mkt === 'dc');
  if (leg) { assert.ok(leg.praw > leg.p); }
  assert.ok(slips.every((s) => s.cal === true));
});

test('updateAccas drops stale unfrozen slips that were not rebuilt, keeps windows disjoint', () => {
  const stale = { id: 'daily:2026-11-01|odds2', window: 'daily', key: 'daily:2026-11-01', status: 'pending', lastKickoff: '2026-11-01T15:00:00.000Z', odds: 2, prob: 0.4,
    legs: [{ pid: 'x', kickoff: '2026-11-01T15:00:00.000Z', mkt: 'x12', sel: 'H' }] };
  const out = updateAccas({ items: [stale] }, pool, NOW);
  assert.ok(!out.items.some((a) => a.id === stale.id), 'stale slip kept');
  const pids = out.items.filter((a) => a.status === 'pending').flatMap((a) => a.legs.map((l) => l.pid));
  assert.ok(pids.length > 0);
  assert.equal(new Set(pids).size, pids.length, 'a fixture appears in more than one slip across windows (daily and weekend overlap)');
});

test('every slip pays at least the minimum total odds', () => {
  const slips = buildWindow(W, pool, NOW);
  assert.ok(slips.length >= 2);
  for (const sl of slips) assert.ok(sl.odds >= MIN_TOTAL_ODDS - 1e-9, `${sl.id} pays only ${sl.odds}`);
  assert.equal(MIN_TOTAL_ODDS, 2);
});

test('a slip is only called a banker or solid when the whole slip has the chance to back it up', () => {
  for (const sl of buildWindow(W, pool, NOW)) {
    if (sl.grade === 'banker') assert.ok(sl.prob >= 0.5, `banker at ${sl.prob}`);
    if (sl.grade === 'solid') assert.ok(sl.prob >= 0.3, `solid at ${sl.prob}`);
  }
});
