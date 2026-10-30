import test from 'node:test';
import assert from 'node:assert/strict';
import { dayKey, windows, legsFor, legWins, buildWindow, updateAccas, accaStats } from '../lib/accas.mjs';
import { sameFixture, dropDuplicatePending } from '../lib/dupes.mjs';
const mk = (id, home, away, kickoff, pk, extra = {}) => ({ id, h: 't:' + home, a: 't:' + away, home, away, comp: 'E0', kickoff, status: 'pending', games: 20, created: '2026-10-29T00:00:00Z', pk, ...extra });
const PK = (dcp, o = {}) => ({ x12: 'H', x12p: Math.max(0.4, dcp - 0.25), dc: '1X', dcp, ou: 'U', oup: 0.58, bt: 'N', btp: 0.57, ...o });
const NOW = new Date('2026-10-30T06:00:00Z');
test('dayKey uses Nairobi time (EAT, UTC+3)', () => { assert.equal(dayKey('2026-10-31T21:30:00Z'), '2026-11-01'); assert.equal(dayKey('2026-10-31T20:59:00Z'), '2026-10-31'); });
test('windows: today+tomorrow always, weekend only from Thursday', () => {
  const fri = windows(new Date('2026-10-30T06:00:00Z'));
  assert.deepEqual(fri.map((w) => w.id), ['daily:2026-10-30', 'daily:2026-10-31', 'weekend:2026-10-31']);
  assert.deepEqual(fri[2].days, ['2026-10-31', '2026-11-01']);
  assert.equal(windows(new Date('2026-11-02T06:00:00Z')).length, 2);
  assert.deepEqual(windows(new Date('2026-11-01T06:00:00Z')).at(-1).days, ['2026-11-01']);
});
test('legs: bookmaker odds when present, model-priced with margin otherwise', () => {
  const wb = legsFor(mk('a', 'A', 'B', '2026-10-30T15:00:00Z', PK(0.8), { ctx: { odds: [1.5, 4, 6] } }));
  assert.equal(wb.find((l) => l.mkt === 'x12').odds, 1.5);
  assert.equal(wb.find((l) => l.mkt === 'dc').odds, +(1 / (1 / 1.5 + 1 / 4)).toFixed(2));
  const mo = legsFor(mk('b', 'A', 'B', '2026-10-30T15:00:00Z', PK(0.8)));
  assert.equal(mo.find((l) => l.mkt === 'dc').odds, +(0.93 / 0.8).toFixed(2)); assert.ok(mo.every((l) => l.src === 'model'));
});
test('legWins grades every market from the final score', () => {
  assert.equal(legWins('x12', 'H', 2, 1), true); assert.equal(legWins('x12', 'H', 1, 1), false);
  assert.equal(legWins('dc', '1X', 1, 1), true); assert.equal(legWins('dc', 'X2', 2, 0), false); assert.equal(legWins('dc', '12', 0, 0), false);
  assert.equal(legWins('ou', 'O', 2, 1), true); assert.equal(legWins('ou', 'U', 2, 1), false);
  assert.equal(legWins('bt', 'Y', 1, 1), true); assert.equal(legWins('bt', 'N', 1, 1), false);
});
test('duplicates: collapsed across spellings, other fixtures kept, settled untouched', () => {
  const a = mk('1', 'SV Elversberg', 'Mainz', '2026-10-30T19:30:00Z', PK(0.8), { games: 30 });
  const b = mk('2', 'SV 07 Elversberg', '1. FSV Mainz 05', '2026-10-30T19:30:00Z', PK(0.8), { games: 12 });
  const c = mk('3', 'Bayern Munich', 'Mainz', '2026-10-30T19:30:00Z', PK(0.8));
  assert.equal(sameFixture(a, b), true); assert.equal(sameFixture(a, c), false);
  assert.deepEqual(dropDuplicatePending([a, b, c]).map((p) => p.id), ['1', '3']);
  assert.equal(dropDuplicatePending([a, { ...b, status: 'settled' }]).length, 2);
});
test('slips: one leg per match, odds in band, probability is the product', () => {
  const pool = [0.88, 0.85, 0.82, 0.8, 0.78, 0.76, 0.74, 0.72].map((q, i) => mk('m' + i, 'H' + i, 'A' + i, '2026-10-30T' + String(12 + i).padStart(2, '0') + ':00:00Z', PK(q)));
  const slips = buildWindow(windows(NOW)[0], pool, NOW);
  assert.ok(slips.length >= 4);
  for (const s of slips) {
    assert.equal(new Set(s.legs.map((l) => l.pid)).size, s.legs.length);
    assert.ok(Math.abs(s.prob - s.legs.reduce((x, l) => x * l.p, 1)) < 0.01);
    assert.ok(Math.abs(s.odds - s.legs.reduce((x, l) => x * l.odds, 1)) < 0.05 * s.odds);
    assert.equal(s.status, 'pending'); assert.ok(['banker', 'solid', 'risky'].includes(s.grade));
  }
  const two = slips.find((s) => s.type === 'fold2'); assert.equal(two.n, 2); assert.ok(two.odds >= 1.4);
  const a3 = slips.find((s) => s.type === 'odds3'); if (a3) assert.ok(a3.odds >= 2.5 && a3.odds <= 3.6);
});
test('thin or weak pools produce nothing', () => {
  assert.deepEqual(buildWindow(windows(NOW)[0], [mk('x', 'A', 'B', '2026-10-30T15:00:00Z', PK(0.8))], NOW), []);
  const weak = [0, 1, 2, 3].map((i) => mk('w' + i, 'H' + i, 'A' + i, '2026-10-30T15:00:00Z', { x12: 'H', x12p: 0.4, dc: '1X', dcp: 0.5, ou: 'O', oup: 0.5, bt: 'Y', btp: 0.5 }));
  assert.deepEqual(buildWindow(windows(NOW)[0], weak, NOW), []);
});
test('lifecycle: rebuild before kickoff, freeze after, settle won/lost, void stale', () => {
  const mkPool = (q) => [0, 1, 2, 3, 4].map((i) => mk('m' + i, 'H' + i, 'A' + i, '2026-10-30T' + String(14 + i) + ':00:00Z', PK(q - i * 0.01)));
  const r1 = updateAccas({ items: [] }, mkPool(0.85), NOW), id = 'daily:2026-10-30|fold2';
  assert.ok(r1.items.find((a) => a.id === id));
  const r2 = updateAccas(r1, mkPool(0.9), new Date('2026-10-30T07:00:00Z'));
  const r3 = updateAccas(r2, mkPool(0.99), new Date('2026-10-30T14:30:00Z'));
  const frozen = r3.items.find((a) => a.id === id);
  assert.deepEqual(frozen.legs.map((l) => l.p), r2.items.find((a) => a.id === id).legs.map((l) => l.p));
  const settled = (bad) => mkPool(0.85).map((p) => ({ ...p, status: 'settled', result: { hg: 2, ag: p.id === bad ? 3 : 0 } }));
  const end = new Date('2026-10-31T00:00:00Z');
  assert.equal(updateAccas(r3, settled(null), end).items.find((a) => a.id === id).status, 'won');
  const badId = frozen.legs[0].pid, ls = updateAccas(r3, settled(badId), end).items.find((a) => a.id === id);
  assert.equal(ls.status, 'lost'); assert.equal(ls.legs.find((l) => l.pid === badId).ok, false);
  assert.equal(updateAccas(r3, [], new Date('2026-11-05T00:00:00Z')).items.find((a) => a.id === id).status, 'void');
  const st = accaStats(updateAccas(r3, settled(null), end).items); assert.ok(st.settled >= 1 && st.overall.rate === 1);
});
