import test from 'node:test'; import assert from 'node:assert/strict'; import fs from 'node:fs';
import { parseCsv } from '../lib/sources/csv.mjs';
import { rowsToMatches, parseDate, seasonCode } from '../lib/sources/fduk.mjs';
import { parseClubElo } from '../lib/sources/clubelo.mjs';
import { parseRss, scoreHeadlines } from '../lib/sources/news.mjs';
import { extractFromJson, extractFromText, bestFixtures } from '../lib/sources/sportpesa.mjs';
import { Registry } from '../lib/teams.mjs';
const S = (f) => fs.readFileSync(new URL('./samples/' + f, import.meta.url), 'utf8');

test('fduk main CSV: results, odds fallback, fixtures', () => {
  const { finished, upcoming } = rowsToMatches(parseCsv(S('fduk-main.csv')));
  assert.equal(finished.length, 2); assert.equal(upcoming.length, 1);
  assert.deepEqual(finished[0].o, [1.72, 3.85, 4.9]);          // Avg preferred
  assert.deepEqual(finished[1].o, [7.5, 5, 1.4]);              // falls back to B365 when Avg blank
  assert.equal(upcoming[0].an, 'Brighton & Hove Albion');       // quoted field
  assert.equal(finished[0].d, '2026-08-15T12:30:00.000Z'); assert.equal(seasonCode(2026), '2627');
});
test('fduk extra-league CSV', () => {
  const { finished } = rowsToMatches(parseCsv(S('fduk-extra.csv')), 'BRA');
  assert.equal(finished.length, 1); assert.equal(finished[0].c, 'BRA'); assert.equal(finished[0].hg, 2);
});
test('clubelo', () => { const r = parseClubElo(S('clubelo.csv')); assert.equal(r.length, 2); assert.equal(r[0].elo, 2050.5); });
test('news scoring: dedupe, recency, team filter, cap', () => {
  const items = parseRss(S('news.xml')); assert.equal(items.length, 5);
  const now = new Date('2026-10-21T12:00:00Z');
  const a = scoreHeadlines(items, 'Arsenal', now);
  assert.equal(a.adj, -8 + 4);           // one distinct negative (dup removed), one positive, old story ignored
  assert.equal(scoreHeadlines(items, 'Chelsea', now).adj, -8);
  assert.equal(scoreHeadlines(items, 'Everton', now).adj, 0);
});
test('sportpesa JSON walker handles several shapes', () => {
  const a = extractFromJson({ data: { events: [{ id: 1, homeTeam: { name: 'Arsenal' }, awayTeam: { name: 'Chelsea' }, startTime: '2026-10-24T14:00:00Z', league: { name: 'EPL' } },
    { id: 2, competitors: [{ name: 'Liverpool' }, { name: 'Everton' }], date: 1792000000 }, { id: 3, name: 'Spurs - Wolves', startTime: '2026-10-25T16:30:00Z' }], closeTime: '2026-10-24T13:00:00Z' } });
  assert.deepEqual(a.matches.map((m) => m.home + '/' + m.away), ['Arsenal/Chelsea', 'Liverpool/Everton', 'Spurs/Wolves']);
  assert.equal(a.matches[0].league, 'EPL'); assert.equal(a.closes, '2026-10-24T13:00:00.000Z');
  assert.equal(extractFromJson({ menu: [{ name: 'Sports - Live' }] }).matches.length, 0); // nav items without ids are not fixtures
});
test('sportpesa text fallback + best-of', () => {
  const t = extractFromText('1. Arsenal - Chelsea\nMenu\n2) Man City v Liverpool\n14:30 Bet 1.5 - 2.0');
  assert.equal(t.matches.length, 2);
  const b = bestFixtures([{ x: 1 }], 'Jackpot KES 300,000,000\nA FC v B FC\nC FC v D FC\nE FC v F FC'); assert.equal(b.matches.length, 3); assert.equal(b.prize, 'KES 300,000,000');
});
test('registry merges spellings across sources without false merges', () => {
  const r = new Registry();
  const id = (n) => r.resolve(n);
  assert.equal(id('Man United'), id('Manchester Utd')); assert.equal(id('Brighton'), id('Brighton & Hove Albion'));
  assert.notEqual(id('Real Madrid'), id('Atletico Madrid')); assert.notEqual(id('Manchester City'), id('Manchester United'));
  assert.equal(r.resolve('Totally Unknown FC', false), null);
});

test('optional API sources report missing keys without making network requests', async () => {
  const { fetchApiFootball } = await import('../lib/sources/api-football.mjs');
  const { fetchOddsApi } = await import('../lib/sources/odds-api.mjs');
  const health = [];
  const a = await fetchApiFootball({ key: '', health });
  const o = await fetchOddsApi({ key: '', health });
  assert.deepEqual(a, { finished: [], upcoming: [] });
  assert.deepEqual(o, { finished: [], upcoming: [] });
  assert.equal(health.length, 2);
  assert.equal(health.every(x => x.ok === false), true);
});
