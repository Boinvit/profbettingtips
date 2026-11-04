import test from 'node:test';
import assert from 'node:assert/strict';
import { dataGaps, isTrusted, marketProb, marketCapped } from '../lib/sure.mjs';
import { legsFor } from '../lib/accas.mjs';
import { dayMatches } from '../lib/longshots.mjs';

const base = { id: 'a', home: 'Alpha', away: 'Beta', kickoff: '2026-11-04T16:00:00.000Z', status: 'pending', listed: true, games: 60, form: ['WDLWW', 'LLDWD'] };

test('data gaps: youth, thin data and missing recent form are flagged; missing fields are not held against old records', () => {
  assert.deepEqual(dataGaps(base), []);
  assert.ok(dataGaps({ ...base, home: 'Roma U20' }).length === 1);
  assert.ok(dataGaps({ ...base, games: 7 })[0].includes('thin data'));
  assert.ok(dataGaps({ ...base, form: ['WDLWW', 'WD'] })[0].includes('recent form'));
  assert.ok(isTrusted({ id: 'old', home: 'A', away: 'B' }));
});

test('market probability is de-vigged; double chance is the sum of its two outcomes', () => {
  const p = { ctx: { odds: [2, 4, 4] } };
  assert.ok(Math.abs(marketProb(p, { mkt: 'x12', sel: 'H' }) - 0.5) < 1e-9);
  assert.ok(Math.abs(marketProb(p, { mkt: 'dc', sel: '1X' }) - 0.75) < 1e-9);
  assert.equal(marketProb({}, { mkt: 'x12', sel: 'H' }), null);
  assert.equal(marketProb(p, { mkt: 'ou', sel: 'O' }), null);
});

test('when the market is less sure than the model, the lower number is used; otherwise nothing changes', () => {
  const p = { ctx: { odds: [2, 4, 4] } };
  const hi = marketCapped(p, { mkt: 'x12', sel: 'H', p: 0.8 });
  assert.equal(hi.capped, true); assert.ok(Math.abs(hi.p - 0.5) < 1e-9); assert.equal(hi.pm, 0.8);
  const lo = marketCapped(p, { mkt: 'x12', sel: 'H', p: 0.4 });
  assert.equal(lo.p, 0.4); assert.equal(lo.capped, undefined);
});

test('legsFor with sure: true never reports a probability above the market', () => {
  const p = { ...base, home: 'A', away: 'B', ctx: { odds: [2.2, 3.4, 3.6] }, pk: { x12: 'H', x12p: 0.8, dc: '1X', dcp: 0.95, ou: 'O', oup: 0.6, bt: 'Y', btp: 0.6 } };
  const plain = legsFor(p, null), sure = legsFor(p, null, { sure: true });
  const h = (ls) => ls.find((l) => l.mkt === 'x12');
  assert.ok(h(sure).p < h(plain).p);
  assert.equal(sure.find((l) => l.mkt === 'ou').p, plain.find((l) => l.mkt === 'ou').p);
});

test('long shots skip matches without recent form for either team', () => {
  const now = new Date('2026-11-04T06:00:00Z');
  const pk = { x12: 'H', x12p: 0.5, dc: '1X', dcp: 0.8, ou: 'O', oup: 0.56, bt: 'Y', btp: 0.52 };
  const ok = { ...base, id: 'ok', pk }, bad = { ...base, id: 'bad', pk, form: ['WDLWW', ''] };
  const ids = dayMatches([ok, bad], '2026-11-04', now).map((c) => c.p.id);
  assert.deepEqual(ids, ['ok']);
});
