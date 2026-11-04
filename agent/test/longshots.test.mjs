import test from 'node:test';
import assert from 'node:assert/strict';
import { buildDay, updateLongShots, dayMatches, MIN_MATCH_P, MAX_LEGS } from '../lib/longshots.mjs';

const now = new Date('2026-11-04T06:00:00Z');
const mkp = (i, over = {}) => ({
  id: 'm' + i, h: 't:h' + i, a: 't:a' + i, home: 'Home ' + i, away: 'Away ' + i, comp: 'X', kickoff: '2026-11-04T16:00:00.000Z', status: 'pending', listed: true, games: 60,
  pk: { x12: 'H', x12p: 0.5, dc: '1X', dcp: 0.85 - i * 0.004, ou: 'O', oup: 0.56, bt: 'Y', btp: 0.52 }, ...over,
});
const pool = (n) => Array.from({ length: n }, (_, i) => mkp(i));

test('up to 24 matches, five slips from the same matches; rank k uses each match k-th best outcome', () => {
  const slips = buildDay(pool(30), '2026-11-04', now);
  assert.ok(slips.length >= 3 && slips.some((s) => s.key === 'mix'));
  const first = slips.find((s) => s.key === '1');
  assert.equal(first.legs.length, MAX_LEGS);
  const ids = (s) => new Set(s.legs.map((l) => l.pid));
  for (const s of slips) for (const id of ids(s)) assert.ok(ids(first).has(id));
  const second = slips.find((s) => s.key === '2');
  for (const l of first.legs) assert.equal(l.rank, 1);
  for (const l of second.legs) { assert.equal(l.rank, 2); const f = first.legs.find((x) => x.pid === l.pid); assert.ok(l.p <= f.p); }
  assert.ok(first.legs.every((l) => l.p >= MIN_MATCH_P));
  assert.ok(first.pAll > 0 && first.pAll < 1 && first.odds > 1);
});

test('the mix slip cycles outcome ranks down the kickoff order', () => {
  const mix = buildDay(pool(12), '2026-11-04', now).find((s) => s.key === 'mix');
  assert.equal(mix.legs.length, 12);
  assert.ok(new Set(mix.legs.map((l) => l.rank)).size >= 2);
});

test('youth, thin-data, unlisted and started matches are never used', () => {
  const bad = [mkp(100, { home: 'Roma U20' }), mkp(101, { games: 5 }), mkp(102, { listed: false }), mkp(103, { away: 'Lille Youth' }), mkp(104, { kickoff: '2026-11-04T06:10:00.000Z' })];
  const ids = new Set(dayMatches([...bad, ...pool(10)], '2026-11-04', now).map((c) => c.p.id));
  for (const b of bad) assert.ok(!ids.has(b.id));
});

test('too few qualifying matches: nothing is built', () => {
  assert.equal(buildDay(pool(3), '2026-11-04', now).length, 0);
  const weak = Array.from({ length: 10 }, (_, i) => mkp(i, { pk: { x12: 'H', x12p: 0.4, dc: '1X', dcp: 0.55, ou: 'O', oup: 0.5, bt: 'Y', btp: 0.5 } }));
  assert.equal(buildDay(weak, '2026-11-04', now).length, 0);
});

test('a started set is never changed; an untouched set only grows; settling fills the track record by rank', () => {
  const a = updateLongShots({ items: [] }, pool(6), now);
  const len = (r) => Math.max(...r.items.map((s) => s.legs.length));
  assert.equal(len(a), 6);
  assert.equal(len(updateLongShots(a, pool(6), now)), 6);
  assert.equal(len(updateLongShots(a, pool(10), now)), 10);
  assert.equal(len(updateLongShots(a, pool(10), new Date('2026-11-04T16:30:00Z'))), 6);
  const done = pool(6).map((p) => ({ ...p, status: 'settled', result: { hg: 3, ag: 0 } }));
  const c = updateLongShots(a, done, new Date('2026-11-04T23:00:00Z'));
  assert.ok(c.stats.settled >= 3 && c.stats.legsSettled > 0);
  assert.ok(c.items.every((s) => s.status === 'won' || s.status === 'lost'));
  assert.ok(c.stats.byRank[1] && c.stats.byRank[1].n === 6);
});

test('an old-format untouched day is replaced by the new five-slip layout', () => {
  const legacy = { items: [{ id: 'ls:2026-11-04:1', day: '2026-11-04', status: 'pending', pAll: 0.3, legs: [{ pid: 'zz', mkt: 'x12', sel: 'H', kickoff: '2026-11-04T16:00:00Z', p: 0.8 }] }] };
  const r = updateLongShots(legacy, pool(8), now);
  assert.ok(r.items.length >= 4 && r.items.every((s) => s.key));
});
