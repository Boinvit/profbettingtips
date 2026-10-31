import test from 'node:test';
import assert from 'node:assert/strict';
import { indexMatches, dossier, headToHead, factors, summarize, buildIntel, newsOf } from '../lib/intel.mjs';

const M = (d, h, a, hg, ag) => ({ d: `${d}T15:00:00.000Z`, h, a, hg, ag });
const ASOF = Date.parse('2026-11-01T15:00:00Z');
const NN = { adj: 0, flags: [] };
const mk = (ppg, form, n = 5) => ({ games: 20, restDays: 5, last5: { n, ppg, form }, last10: { n: 10, gf: 1.5, ga: 1.5, btts: 0.5 }, venue: { n: 5, ppg } });
const bare = () => ({ games: 20, restDays: 5, last5: { n: 0 }, last10: { n: 0 }, venue: { n: 0 } });

test('summarize computes form string, ppg, goals and rates', () => {
  const s = summarize([{ gf: 2, ga: 0 }, { gf: 1, ga: 1 }, { gf: 0, ga: 3 }]);
  assert.equal(s.form, 'WDL'); assert.equal(s.ppg, 1.33); assert.equal(s.cs, 0.33); assert.equal(s.btts, 0.33); assert.equal(s.o25, 0.33);
  assert.deepEqual(summarize([]), { n: 0 });
});

test('dossier only uses games before asOf and reports rest days and venue split', () => {
  const by = indexMatches([M('2026-10-01', 'A', 'B', 1, 0), M('2026-10-20', 'C', 'A', 0, 2), M('2026-11-05', 'A', 'D', 9, 9)]);
  const d = dossier(by, 'A', ASOF, 'home');
  assert.equal(d.games, 2); assert.equal(d.restDays, 12); assert.equal(d.venue.n, 1); assert.equal(d.last10.form, 'WW');
});

test('headToHead is oriented from the first team and ignores future games', () => {
  const by = indexMatches([M('2026-01-01', 'A', 'B', 2, 1), M('2026-02-01', 'B', 'A', 0, 0), M('2026-03-01', 'B', 'A', 3, 1), M('2027-01-01', 'A', 'B', 5, 0)]);
  const h = headToHead(by, 'A', 'B', ASOF);
  assert.deepEqual([h.n, h.w, h.d, h.l, h.gf, h.ga], [3, 1, 1, 1, 3, 4]);
});

test('factors fire on clear gaps only and show their numbers', () => {
  const strong = factors({ hn: 'X', an: 'Y', hd: mk(2.4, 'WWWDW'), ad: mk(0.6, 'LLDLL'), h2h: { n: 0 }, nH: NN, nA: NN });
  assert.ok(strong.some((f) => f.k === 'Form' && f.lean === 'H' && /2\.4/.test(f.text)));
  const even = factors({ hn: 'X', an: 'Y', hd: mk(1.5, 'WDLWD'), ad: mk(1.4, 'DWDLW'), h2h: { n: 0 }, nH: NN, nA: NN });
  assert.equal(even.filter((f) => f.k === 'Form' || f.k === 'Venue').length, 0);
});

test('news: only a large net adjustment counts, and it leans the right way', () => {
  const f = factors({ hn: 'X', an: 'Y', hd: bare(), ad: bare(), h2h: { n: 0 }, nH: { adj: -16, flags: ['\u2212', '\u2212', '+'] }, nA: { adj: 14, flags: ['+'] } });
  assert.equal(f.length, 2);
  assert.deepEqual(f.map((x) => x.lean), ['A', 'A']); // home hurt -> away; away boosted -> away
  assert.match(f[0].text, /unverified/);
  const small = factors({ hn: 'X', an: 'Y', hd: bare(), ad: bare(), h2h: { n: 0 }, nH: { adj: -6, flags: ['\u2212'] }, nA: NN });
  assert.equal(small.length, 0);
  assert.deepEqual(newsOf({}, 'Z'), { adj: 0, flags: [] });
  assert.deepEqual(newsOf({ T: { adj: -12, flags: ['\u2212'], headlines: ['x'] } }, 'T'), { adj: -12, flags: ['\u2212'] });
});

test('buildIntel selects pending fixtures in the window and flags thin history', () => {
  const now = new Date('2026-10-31T12:00:00Z');
  const preds = [
    { id: 'p1', status: 'pending', h: 'A', a: 'B', home: 'A', away: 'B', kickoff: '2026-11-01T15:00:00.000Z', pk: { x12: 'H', x12p: 0.5 } },
    { id: 'p2', status: 'pending', h: 'A', a: 'B', home: 'A', away: 'B', kickoff: '2026-12-25T15:00:00.000Z' },
    { id: 'p3', status: 'settled', h: 'A', a: 'B', home: 'A', away: 'B', kickoff: '2026-11-01T18:00:00.000Z' },
  ];
  const out = buildIntel({ matches: [M('2026-10-01', 'A', 'B', 1, 0)], preds, news: {}, now });
  assert.equal(out.n, 1); assert.equal(out.matches[0].id, 'p1'); assert.match(out.matches[0].caveat, /Limited history/);
});
