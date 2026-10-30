import test from 'node:test';
import assert from 'node:assert/strict';
import { parseOpenFootball, zonedToUtc, fetchOpenFootball } from '../lib/sources/openfootball.mjs';
import { fetchApiFootball } from '../lib/sources/api-football.mjs';

const SAMPLE = `= English Premier League 2026/27
# Date       Fri Aug 21 2026 - Sun May 30 2027 (282d)

▪ Matchday 1
  Fri Aug 21 2026
    20:00  Arsenal FC              v Coventry City FC         3-0 (2-0)
  Sat Aug 22
    12:30  Hull City AFC           v Manchester United FC     2-0 (2-0)

▪ Matchday 11
  Sat Oct 31
    15:00  Chelsea FC              v Brentford FC
  Sun Nov 1
           Crystal Palace FC       v Leeds United FC
  Sat Jan 2
    15:00  Everton FC v Fulham FC
`;

test('zonedToUtc handles BST and GMT (UK clocks change 25 Oct 2026)', () => {
  assert.equal(zonedToUtc(2026, 7, 21, 20, 0, 'Europe/London').toISOString(), '2026-08-21T19:00:00.000Z');
  assert.equal(zonedToUtc(2026, 9, 31, 15, 0, 'Europe/London').toISOString(), '2026-10-31T15:00:00.000Z');
  assert.equal(zonedToUtc(2026, 9, 31, 15, 0, 'Europe/Madrid').toISOString(), '2026-10-31T14:00:00.000Z');
});

test('openfootball parser: scores, default time, year inference', () => {
  const r = parseOpenFootball(SAMPLE, { tz: 'Europe/London', startYear: 2026 });
  assert.equal(r.length, 5);
  assert.deepEqual(r[0], { d: '2026-08-21T19:00:00.000Z', hn: 'Arsenal FC', an: 'Coventry City FC', hg: 3, ag: 0 });
  assert.equal(r[1].d, '2026-08-22T11:30:00.000Z');
  assert.equal(r[2].hg, undefined);
  assert.equal(r[3].d, '2026-11-01T15:00:00.000Z');
  assert.equal(r[4].d, '2027-01-02T15:00:00.000Z');
});

test('fetchOpenFootball: results vs upcoming window', async () => {
  const health = [];
  const f = await fetchOpenFootball({ now: new Date('2026-10-29T12:00:00Z'), leagues: [{ c: 'E0', repo: 'england', file: 'x', tz: 'Europe/London' }], fetchText: async () => SAMPLE, health, log: () => {} });
  assert.equal(f.finished.length, 2);
  assert.deepEqual(f.upcoming.map((u) => u.hn), ['Chelsea FC', 'Crystal Palace FC']);
  assert.equal(f.upcoming[0].c, 'E0');
  assert.equal(health[0].ok, true);
  const bad = []; await fetchOpenFootball({ leagues: [{ c: 'E0', repo: 'a', file: 'b', tz: 'UTC' }], fetchText: async () => { throw new Error('HTTP 404'); }, health: bad, log: () => {} });
  assert.equal(bad[0].ok, false);
});

const fx = (id, st, d, hg, ag, hn, an) => ({ league: { id }, fixture: { date: d, status: { short: st } }, teams: { home: { name: hn }, away: { name: an } }, goals: { home: hg, away: ag } });
test('API-Football: one date request per day, mapped leagues only, FT vs NS', async () => {
  const calls = [];
  const request = async (url) => { calls.push(url); return calls.length > 1 ? [] : [
    fx(39, 'FT', '2026-10-29T19:00:00+00:00', 2, 1, 'Arsenal', 'Chelsea'), fx(39, 'NS', '2026-10-31T15:00:00+00:00', null, null, 'Spurs', 'Villa'),
    fx(99999, 'NS', '2026-10-31T15:00:00+00:00', null, null, 'X', 'Y'), fx(39, 'PST', '2026-10-31T15:00:00+00:00', null, null, 'P', 'Q'),
    fx(2, 'NS', '2026-10-31T19:00:00+00:00', null, null, 'Inter', 'Ajax')]; };
  const health = [];
  const r = await fetchApiFootball({ key: 'k', now: new Date('2026-10-30T10:00:00Z'), request, health, log: () => {} });
  assert.equal(calls.length, 3);
  assert.ok(calls.every((u) => /fixtures\?date=\d{4}-\d{2}-\d{2}$/.test(u)));
  assert.deepEqual(r.finished, [{ c: 'E0', d: '2026-10-29T19:00:00+00:00', hn: 'Arsenal', an: 'Chelsea', hg: 2, ag: 1 }]);
  assert.deepEqual(r.upcoming.map((u) => u.c + ':' + u.hn), ['E0:Spurs', 'CL:Inter']);
  assert.equal(health[0].ok, true);
  const h2 = []; const none = await fetchApiFootball({ key: '', health: h2 });
  assert.equal(none.upcoming.length, 0); assert.equal(h2[0].ok, false);
  const h3 = []; await fetchApiFootball({ key: 'k', request: async () => { throw new Error('{"requests":"limit reached"}'); }, health: h3, log: () => {} });
  assert.equal(h3[0].ok, false);
});
