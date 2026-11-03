import test from 'node:test';
import assert from 'node:assert/strict';
import { buildDay, buildDayAdaptive, updateLongShots, MIN_LEG_P } from '../lib/longshots.mjs';

const now = new Date('2026-11-04T06:00:00Z');
const mkp = (i, over = {}) => {
  const t = i % 3;
  const pk = t === 0 ? { x12: 'H', x12p: 0.5, dc: '1X', dcp: 0.8, ou: 'O', oup: 0.5, bt: 'Y', btp: 0.5 }
    : t === 1 ? { x12: 'A', x12p: 0.45, dc: 'X2', dcp: 0.75, ou: 'U', oup: 0.52, bt: 'N', btp: 0.52 }
      : { x12: 'H', x12p: 0.7, dc: '1X', dcp: 0.9, ou: 'O', oup: 0.5, bt: 'Y', btp: 0.5 };
  return { id: 'm' + i, h: 't:h' + i, a: 't:a' + i, home: 'Home ' + i, away: 'Away ' + i, comp: 'X', kickoff: '2026-11-04T16:00:00.000Z', status: 'pending', listed: true, games: 60, pk, ...over };
};
const pool = (n) => Array.from({ length: n }, (_, i) => mkp(i));

test('three slips, every leg >= 66%, no match twice, no pick type over half a slip', () => {
  const slips = buildDay(pool(45), '2026-11-04', now);
  assert.equal(slips.length, 3);
  const seen = new Set();
  for (const s of slips) {
    assert.ok(s.legs.length >= 6 && s.legs.length <= 12);
    const cnt = {};
    for (const l of s.legs) { assert.ok(l.p >= MIN_LEG_P); assert.ok(!seen.has(l.pid)); seen.add(l.pid); cnt[l.mkt + l.sel] = (cnt[l.mkt + l.sel] || 0) + 1; }
    assert.ok(Math.max(...Object.values(cnt)) <= 6);
    assert.ok(s.pAll < 1 && s.odds > 1);
  }
});

test('youth, thin-data and unlisted matches are never used', () => {
  const bad = [mkp(100, { home: 'Roma U20' }), mkp(101, { games: 5 }), mkp(102, { listed: false }), mkp(103, { away: 'Lille Youth' })];
  const slips = buildDay([...bad, ...pool(45)], '2026-11-04', now);
  const ids = new Set(slips.flatMap((s) => s.legs.map((l) => l.pid)));
  for (const b of bad) assert.ok(!ids.has(b.id));
});

test('supply decides the count: matches are shared evenly, tomorrow waits for a full set', () => {
  assert.equal(updateLongShots({ items: [] }, pool(3), now).items.length, 0);
  assert.equal(updateLongShots({ items: [] }, pool(10), now).items.length, 2);
  const tomorrow = pool(10).map((p) => ({ ...p, kickoff: '2026-11-05T16:00:00.000Z' }));
  assert.equal(updateLongShots({ items: [] }, tomorrow, now).items.length, 0);
});

test('a day is frozen once created, and slips settle against results', () => {
  const preds = pool(45);
  const a = updateLongShots({ items: [] }, preds, now);
  assert.equal(a.items.length, 3);
  const b = updateLongShots(a, preds, now);
  assert.equal(b.items.length, 3);
  const done = preds.map((p) => ({ ...p, status: 'settled', result: { hg: 3, ag: 0 } }));
  const c = updateLongShots(b, done, new Date('2026-11-04T23:00:00Z'));
  assert.equal(c.stats.settled, 3); assert.ok(c.stats.legsSettled >= 18);
  assert.ok(c.items.every((s) => s.status === 'won' || s.status === 'lost'));
});

test('quiet day: floor drops to 60% only when 66% cannot fill 3 slips; busy day keeps 66%', () => {
  const weak = (i) => mkp(i, { pk: { x12: 'H', x12p: 0.4, dc: i % 2 ? '1X' : 'X2', dcp: 0.62, ou: 'O', oup: 0.5, bt: 'Y', btp: 0.5 } });
  const quiet = Array.from({ length: 30 }, (_, i) => weak(i));
  assert.equal(buildDay(quiet, '2026-11-04', now).length, 0);
  const slips = buildDayAdaptive(quiet, '2026-11-04', now);
  assert.equal(slips.length, 3);
  for (const s of slips) { assert.equal(s.floor, 0.6); assert.ok(s.legs.every((l) => l.p >= 0.6)); }
  assert.ok(buildDayAdaptive(pool(45), '2026-11-04', now).every((s) => s.floor === MIN_LEG_P));
});

test('a short untouched set is rebuilt when more matches qualify; a started one is left alone', () => {
  const first = updateLongShots({ items: [] }, pool(10), now);
  assert.equal(first.items.length, 2);
  const more = updateLongShots(first, pool(45), now);
  assert.equal(more.items.length, 3);
  const later = new Date('2026-11-04T16:30:00Z');
  assert.equal(updateLongShots(first, pool(45), later).items.length, 2);
});

test('same-type supply still makes two slips (pick-type cap is relaxed rather than dropping a slip)', () => {
  const same = Array.from({ length: 10 }, (_, i) => mkp(i * 3));
  const r = updateLongShots({ items: [] }, same, now);
  assert.equal(r.items.length, 2);
  const ids = r.items.flatMap((x) => x.legs.map((l) => l.pid));
  assert.equal(new Set(ids).size, ids.length);
});
