import test from 'node:test'; import assert from 'node:assert/strict';
import { parseInbox, buildJackpots } from '../lib/jackpot.mjs';
import { Registry } from '../lib/teams.mjs';
import { newState, learn, DEFAULT_PARAMS } from '../lib/model.mjs';

const txt = `// comment
# Mega Jackpot Pro | closes 2026-10-24 18:00 | prize KES 300,000,000
1. Man City vs Arsenal
2. Spurs - Chelsea | 2-1
3. Nobody FC v Mystery United
bad line
`;
test('parse', () => {
  const [j] = parseInbox(txt);
  assert.equal(j.games.length, 3); assert.equal(j.closes, '2026-10-24T15:00:00.000Z');
  assert.deepEqual(j.games[1].manual, { hg: 2, ag: 1 });
});
test('resolve + settle + freeze + stable id', () => {
  const reg = new Registry();
  const ids = ['Manchester City', 'Arsenal', 'Tottenham Hotspur', 'Chelsea'].map((n) => reg.resolve(n));
  const s = newState(); const matches = [];
  for (let i = 0; i < 5; i++) for (const [h, a] of [[ids[0], ids[1]], [ids[2], ids[3]]]) { const m = { id: 'x' + i + h, c: 'PL', d: '2026-09-01T12:00:00Z', h, a, hg: 2, ag: 0 }; matches.push(m); learn(s, DEFAULT_PARAMS, m); }
  const leagueOf = new Map(matches.flatMap((m) => [[m.h, 'PL'], [m.a, 'PL']]));
  const idx = (extra = []) => { const m = new Map(); for (const x of [...matches, ...extra]) (m.get(x.h + '|' + x.a) || m.set(x.h + '|' + x.a, []).get(x.h + '|' + x.a)).push(x); return m; };
  const lists = parseInbox(txt);
  const mk = (now, extra) => buildJackpots({ lists, existing: mk.prev, state: s, params: DEFAULT_PARAMS, registry: reg, pairIndex: idx(extra), now: new Date(now), modelV: 1, leagueOf });
  let r = mk('2026-10-21T12:00:00Z'); mk.prev = r;
  assert.equal(r[0].games[0].known, true); assert.equal(r[0].games[2].known, false);
  assert.equal(r[0].games[1].result.src, 'manual'); assert.equal(r[0].games[0].result, undefined);
  const id1 = r[0].id;
  r = mk('2026-10-25T12:00:00Z', [{ id: 'r1', c: 'PL', d: '2026-10-23T15:00:00Z', h: ids[0], a: ids[1], hg: 3, ag: 1 }]);
  assert.equal(r.length, 1); assert.equal(r[0].id, id1);
  assert.equal(r[0].games[0].result.o, 'H'); assert.equal(r[0].games[0].ok.x12, r[0].games[0].pk.x12 === 'H');
  assert.equal(typeof r[0].games[0].ok0.x12, 'boolean');
});
