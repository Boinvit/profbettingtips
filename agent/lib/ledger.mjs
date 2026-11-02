// Results ledger: the user's real bets, stored in their own browser. Pure helpers so they can be tested.
const num = (x) => (Number.isFinite(Number(x)) ? Number(x) : 0);

export function newBet({ stake, odds, legs = 0, modelProb = null, label = '', source = 'slip', now = new Date() }) {
  return { id: `b${now.getTime().toString(36)}${Math.random().toString(36).slice(2, 6)}`, ts: now.toISOString(), label, source, stake: num(stake), odds: num(odds), legs, modelProb, status: 'open', returned: null };
}

/** status: 'won' | 'lost' | 'cashed'. A lost bet always returns 0. */
export function settleBet(list, id, status, returned) {
  return list.map((b) => (b.id === id ? { ...b, status, returned: status === 'lost' ? 0 : num(returned) } : b));
}

export function ledgerStats(list) {
  const done = list.filter((b) => b.status !== 'open');
  const staked = done.reduce((s, b) => s + b.stake, 0), returned = done.reduce((s, b) => s + num(b.returned), 0);
  const wins = done.filter((b) => num(b.returned) > b.stake);
  const fullWins = done.filter((b) => b.status === 'won').length, cashed = done.filter((b) => b.status === 'cashed');
  const modelled = done.filter((b) => b.modelProb != null);
  return {
    n: list.length, open: list.length - done.length, settled: done.length, staked, returned, profit: returned - staked, roi: staked ? (returned - staked) / staked : null,
    profitable: wins.length, fullWins, cashed: cashed.length, cashedProfit: cashed.reduce((s, b) => s + num(b.returned) - b.stake, 0),
    expectedFullWins: modelled.reduce((s, b) => s + b.modelProb, 0), modelled: modelled.length, enough: done.length >= 100,
  };
}

const q = (v) => `"${String(v ?? '').split('"').join('""')}"`;
export function ledgerCsv(list) {
  const head = ['date', 'label', 'legs', 'odds', 'stake', 'status', 'returned', 'profit', 'model_chance'];
  const rows = list.map((b) => [b.ts.slice(0, 10), b.label, b.legs, b.odds, b.stake, b.status, b.returned ?? '', b.returned == null ? '' : num(b.returned) - b.stake, b.modelProb ?? '']);
  return [head, ...rows].map((r) => r.map(q).join(',')).join('\n');
}
