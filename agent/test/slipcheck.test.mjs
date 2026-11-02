import test from 'node:test';
import assert from 'node:assert/strict';
import { parseSlip, checkSlip, outcomeOf } from '../lib/slipcheck.mjs';
import { newBet, settleBet, ledgerStats, ledgerCsv } from '../lib/ledger.mjs';

const WRAPPED = `Description: Multi Bet (4) Date of bet: 31/10/26 09:25:29 Bet amount: KSH 55.00
N\u00b0 ID DATE GAME ODDS MARKET PICK RESULTS
1 4479 31/10/26 20:30 Betis \u2013 Malaga 1.32 1X2 Home 2:1 (2:0) \u2713
2 1529 31/10/26 20:45
PSV Eindhoven \u2013
Willem II
1.08 1X2 Home 7:0 (2:0) \u2713
3 5532 31/10/26 20:30
Bayern Munchen \u2013
Borussia
Dortmund
1.29
Total Goals Over/Under
- Full Time
OVER 2.50 2:2 (1:0) \u2713
4 5832 01/11/26 16:00
Trabzonspor \u2013
Gaziantep BB
1.34 1X2 Home`;
const ONELINE = `Description: Multi Bet (3) Bet amount: KSH 100.00
1 5026 01/11/26 18:15 Racing Santander \u2013 Real Madrid 1.20 1X2 Away
2 2334 01/11/26 17:00 Sheffi eld Wed \u2013 Blackpool 1.23 Double Chance 1 OR X
3 2558 01/11/26 21:15 Charleroi \u2013 Raal La Louviere 1.72 Total Goals Over/Under - Full Time OVER 3.50`;

test('parses a slip whose names and market wrap across lines', () => {
  const s = parseSlip(WRAPPED);
  assert.equal(s.stake, 55); assert.equal(s.declared, 4); assert.equal(s.legs.length, 4);
  assert.deepEqual(s.legs.map((l) => l.code), ['H', 'H', 'O', 'H']);
  assert.equal(s.legs[1].home, 'PSV Eindhoven'); assert.equal(s.legs[1].away, 'Willem II');
  assert.equal(s.legs[2].home, 'Bayern Munchen'); assert.equal(s.legs[2].away, 'Borussia Dortmund');
  assert.equal(s.legs[0].kickoff, '2026-10-31T17:30:00.000Z'); // 20:30 East Africa Time = 17:30 UTC
});

test('parses one-line rows, repairs PDF ligature gaps, flags markets it does not model', () => {
  const s = parseSlip(ONELINE);
  assert.equal(s.legs.length, 3); assert.equal(s.stake, 100);
  assert.equal(s.legs[1].home, 'Sheffield Wed'); assert.equal(s.legs[1].code, 'D1X');
  assert.equal(s.legs[0].code, 'A');
  assert.equal(s.legs[2].code, null); assert.match(s.legs[2].label, /not modelled/);
  assert.equal(parseSlip('nothing here').legs.length, 0);
});

test('outcomeOf grades every modelled market from a final score', () => {
  const r = { hg: 2, ag: 1 };
  assert.equal(outcomeOf('H', r), true); assert.equal(outcomeOf('A', r), false); assert.equal(outcomeOf('D1X', r), true); assert.equal(outcomeOf('DX2', r), false);
  assert.equal(outcomeOf('D12', { hg: 1, ag: 1 }), false); assert.equal(outcomeOf('O', r), true); assert.equal(outcomeOf('U', r), false);
  assert.equal(outcomeOf('B', r), true); assert.equal(outcomeOf('N', { hg: 2, ag: 0 }), true); assert.equal(outcomeOf('H', null), null);
});

const ids = { Betis: 't:betis', Malaga: 't:malaga', 'PSV Eindhoven': 't:psv', 'Willem II': 't:willem', 'Bayern Munchen': 't:bayern', 'Borussia Dortmund': 't:bvb' };
const resolve = (n) => ids[n] || null;
const P = (h, a, kickoff, extra) => ({ h, a, kickoff, p: { h: 0.5, d: 0.25, a: 0.25, o: 0.7, b: 0.5 }, status: 'pending', ...extra });
const preds = [
  P('t:betis', 't:malaga', '2026-10-31T17:30:00.000Z', { status: 'settled', result: { hg: 2, ag: 1, o: 'H' } }),
  P('t:psv', 't:willem', '2026-10-31T17:45:00.000Z', { status: 'settled', result: { hg: 7, ag: 0, o: 'H' } }),
  P('t:bayern', 't:bvb', '2026-10-31T17:30:00.000Z'),
];
const NOW = new Date('2026-11-01T10:00:00Z');

test('a live slip: won legs counted, remaining chance and cash-out numbers add up', () => {
  const r = checkSlip(parseSlip(WRAPPED), { preds, resolve, now: NOW });
  assert.deepEqual(r.counts, { won: 2, lost: 0, pending: 1, unjudged: 1 });
  assert.equal(r.dead, false);
  assert.ok(Math.abs(r.pRem - 0.7 * (1 / 1.34)) < 0.002);
  assert.ok(Math.abs(r.cash.offer - 55 * 1.32 * 1.08 * 0.95) < 0.01);
  assert.ok(Math.abs(r.cash.hold - 55 * r.odds * r.pRem) < 0.5);
  assert.deepEqual(r.unjudged, ['Trabzonspor v Gaziantep BB']);
});

test('one lost leg kills the slip and says which', () => {
  const lost = preds.map((p) => (p.h === 't:betis' ? { ...p, result: { hg: 0, ag: 1, o: 'A' } } : p));
  const r = checkSlip(parseSlip(WRAPPED), { preds: lost, resolve, now: NOW });
  assert.equal(r.dead, true); assert.equal(r.pRem, 0); assert.match(r.firstLoss, /Betis/); assert.equal(r.cash, null); assert.deepEqual(r.ladder, []);
});

test('weakest legs, trimmed variants and the cash-out ladder for an unplayed slip', () => {
  const legs = [0.9, 0.85, 0.8, 0.7, 0.6, 0.55].map((p, i) => ({ home: `H${i}`, away: `A${i}`, odds: 1.2 + i * 0.05, code: 'D1X', label: 'x', kickoff: `2026-11-02T${String(10 + i).padStart(2, '0')}:00:00.000Z` }));
  const pr = legs.map((l, i) => ({ h: `h${i}`, a: `a${i}`, kickoff: l.kickoff, status: 'pending', p: { h: [0.6, 0.55, 0.5, 0.45, 0.4, 0.35][i], d: [0.3, 0.3, 0.3, 0.25, 0.2, 0.2][i], a: 0.1, o: 0.5, b: 0.5 } }));
  const res = (n) => ({ H0: 'h0', A0: 'a0', H1: 'h1', A1: 'a1', H2: 'h2', A2: 'a2', H3: 'h3', A3: 'a3', H4: 'h4', A4: 'a4', H5: 'h5', A5: 'a5' }[n] || null);
  const r = checkSlip({ stake: 100, legs }, { preds: pr, resolve: res, now: NOW });
  assert.equal(r.counts.pending, 6); assert.ok(r.weakest[0].edge <= r.weakest[1].edge);
  assert.equal(r.trims.length, 2); assert.ok(r.trims[0].p > r.pScratch); assert.ok(r.trims[1].p > r.trims[0].p); assert.ok(r.trims[1].odds < r.trims[0].odds);
  assert.ok(r.ladder.length >= 2); assert.ok(r.ladder[1].p <= r.ladder[0].p); assert.ok(r.ladder[1].value >= r.ladder[0].value);
});

test('ledger: settle, totals, return on stake, CSV', () => {
  const mk = (stake, p) => newBet({ stake, odds: 2.5, legs: 3, modelProb: p, label: 'test' });
  let l = [mk(100, 0.4), mk(100, 0.4), mk(100, 0.4), mk(100, 0.4)];
  l = settleBet(l, l[0].id, 'won', 250); l = settleBet(l, l[1].id, 'lost', 999); l = settleBet(l, l[2].id, 'cashed', 150);
  const s = ledgerStats(l);
  assert.equal(l[1].returned, 0);
  assert.deepEqual([s.n, s.open, s.settled, s.staked, s.returned, s.profit], [4, 1, 3, 300, 400, 100]);
  assert.ok(Math.abs(s.roi - 1 / 3) < 1e-9); assert.equal(s.profitable, 2); assert.equal(s.fullWins, 1); assert.equal(s.cashed, 1); assert.equal(s.cashedProfit, 50);
  assert.ok(Math.abs(s.expectedFullWins - 1.2) < 1e-9); assert.equal(s.enough, false);
  const csv = ledgerCsv(l).split('\n');
  assert.equal(csv.length, 5); assert.match(csv[0], /^"date","label"/);
});
