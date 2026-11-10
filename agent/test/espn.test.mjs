import test from 'node:test';
import assert from 'node:assert/strict';
import { overdueFor, datesFor, matchEvents, fetchEspn } from '../lib/sources/espn.mjs';
import { tierOf } from '../lib/results.mjs';

const now = new Date('2026-11-10T06:00:00Z');
const pred = (id, h, a, kickoff, over = {}) => ({ id, h, a, home: 'Home ' + id, away: 'Away ' + id, comp: 'MLS', kickoff, status: 'pending', ...over });
const ev = (id, date, hn, an, hs, as, name = 'STATUS_FULL_TIME', completed = true) => ({ id, date, competitions: [{ status: { type: { name, completed } }, competitors: [{ homeAway: 'home', score: String(hs), team: { displayName: hn } }, { homeAway: 'away', score: String(as), team: { displayName: an } }] }] });
const IDS = { 'Alpha FC': 't:alpha', 'Beta FC': 't:beta', 'Gamma FC': 't:gamma', 'Delta FC': 't:delta' };
const resolve = (n) => IDS[n] || null;
const overdue = [pred('p1', 't:alpha', 't:beta', '2026-11-07T20:00:00Z'), pred('p2', 't:gamma', 't:delta', '2026-11-08T20:00:00Z')];

test('overdue = pending, kicked off over 2.5h ago, within 14 days', () => {
  const ps = [pred('a', 'x', 'y', '2026-11-10T04:00:00Z'), pred('b', 'x', 'y', '2026-11-10T01:00:00Z'), pred('c', 'x', 'y', '2026-10-01T01:00:00Z'), pred('d', 'x', 'y', '2026-11-09T01:00:00Z', { status: 'settled' })];
  assert.deepEqual(overdueFor(ps, now).map((p) => p.id), ['b']);
});

test('scoreboard days: each kickoff day and its neighbours, newest first, capped', () => {
  const d = datesFor([pred('p', 'x', 'y', '2026-11-07T20:00:00Z')]);
  assert.deepEqual(d, ['20261108', '20261107', '20261106']);
  assert.equal(datesFor(overdue, 2).length, 2);
});

test('only full-time games that match an overdue prediction are emitted, with our own team names', () => {
  const events = [ev(1, '2026-11-07T23:00:00Z', 'Alpha FC', 'Beta FC', 2, 1), ev(2, '2026-11-08T22:00:00Z', 'Gamma FC', 'Delta FC', 0, 0, 'STATUS_FINAL_AET'), ev(3, '2026-11-08T22:00:00Z', 'Gamma FC', 'Delta FC', 1, 1, 'STATUS_IN_PROGRESS', false), ev(4, '2026-11-07T23:00:00Z', 'Zeta FC', 'Eta FC', 3, 3)];
  const r = matchEvents(events, overdue, resolve);
  assert.deepEqual(r.finished, [{ c: 'MLS', d: '2026-11-07T23:00:00Z', hn: 'Home p1', an: 'Away p1', hg: 2, ag: 1 }]);
});

test('orientation and date window are respected; repeats settle a prediction once', () => {
  const flipped = ev(5, '2026-11-07T23:00:00Z', 'Beta FC', 'Alpha FC', 0, 1);
  assert.equal(matchEvents([flipped], overdue, resolve).finished.length, 0);
  const late = ev(6, '2026-11-12T23:00:00Z', 'Alpha FC', 'Beta FC', 1, 0);
  assert.equal(matchEvents([late], overdue, resolve).finished.length, 0);
  const twice = [ev(7, '2026-11-07T23:00:00Z', 'Alpha FC', 'Beta FC', 1, 0), ev(8, '2026-11-07T23:30:00Z', 'Alpha FC', 'Beta FC', 1, 0)];
  assert.equal(matchEvents(twice, overdue, resolve).finished.length, 1);
});

test('names to alias are reported when one side is known and overdue', () => {
  const r = matchEvents([ev(9, '2026-11-07T23:00:00Z', 'Alpha FC', 'Beta Reserves', 1, 0)], overdue, resolve);
  assert.deepEqual(r.partial, ['Beta Reserves']);
});

test('fetchEspn reads each day once, tolerates failures and reports a health line', async () => {
  const urls = [];
  const fetchImpl = async (url) => { urls.push(url); if (url.includes('20261106')) return { ok: false, status: 500 }; return { ok: true, json: async () => ({ events: [ev(1, '2026-11-07T23:00:00Z', 'Alpha FC', 'Beta FC', 2, 1)] }) }; };
  const health = [];
  const r = await fetchEspn({ now, preds: overdue, registry: { resolve }, health, log: () => {}, fetchImpl });
  assert.equal(r.finished.length, 1);
  assert.ok(urls.every((u) => u.includes('/soccer/all/scoreboard?dates=')));
  assert.equal(health[0].source, 'ESPN'); assert.ok(health[0].ok);
  assert.equal((await fetchEspn({ now, preds: [], registry: { resolve }, health: [], log: () => {} })).finished.length, 0);
});

test('espn is a tier-2 (supplemental, finished-only) source', () => { assert.equal(tierOf('espn'), 2); });
