import test from 'node:test';
import assert from 'node:assert/strict';
import { Registry } from '../lib/teams.mjs';
import { buildIndex, findTeam } from '../lib/names.mjs';

const M = (h, a) => ({ d: '2026-10-01T15:00:00.000Z', h, a, hg: 1, ag: 0 });
const base = { 't:salzburg': 'Salzburg', 't:a-lustenau': 'A. Lustenau', 't:sheffield-weds': 'Sheffield Weds', 't:oud-heverlee-leuven': 'Oud-Heverlee Leuven', 't:sk-rapid': 'SK Rapid', 't:buyuksehyr': 'Buyuksehyr', 't:x': 'X', 't:y': 'Y' };
const played = [M('t:salzburg', 't:a-lustenau'), M('t:sheffield-weds', 't:oud-heverlee-leuven'), M('t:sk-rapid', 't:buyuksehyr'), M('t:x', 't:y')];

test('bookmaker spellings resolve to the id that holds the history', () => {
  const idx = buildIndex(base);
  for (const [name, id] of [['RB Salzburg', 't:salzburg'], ['Austria Lustenau', 't:a-lustenau'], ['Sheffield Wednesday', 't:sheffield-weds'], ['OH Leuven', 't:oud-heverlee-leuven'], ['Rapid Vienna', 't:sk-rapid'], ['Basaksehir', 't:buyuksehyr']])
    assert.equal(findTeam(idx, name), id, name);
});

test('prune removes empty twins that shadow a real club, keeps genuinely new teams', () => {
  const r = new Registry({ ...base, 't:red-bull-salzburg': 'Red Bull Salzburg', 't:oh-leuven': 'OH Leuven', 't:rapid-vienna': 'Rapid Vienna', 't:brand-new-fc': 'Brand New Town' });
  const removed = r.prune(played);
  assert.deepEqual(removed.map(([a]) => a).sort(), ['t:oh-leuven', 't:rapid-vienna', 't:red-bull-salzburg']);
  assert.ok(r.names['t:brand-new-fc'], 'a genuinely new team must survive');
  assert.equal(r.resolve('Red Bull Salzburg', false), 't:salzburg');
  assert.equal(r.resolve('OH Leuven', false), 't:oud-heverlee-leuven');
});

test('prune never touches ids that have played matches', () => {
  const r = new Registry(base);
  assert.deepEqual(r.prune(played), []);
  assert.equal(Object.keys(r.names).length, Object.keys(base).length);
});
