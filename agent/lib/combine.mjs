// Combine several accumulator slips into one bet. Slips are built from disjoint fixtures, so their chances multiply;
// the function still checks for a shared match (legacy slips) and says so, because a bookmaker will not take the same match twice.
const r3 = (x) => Math.round(x * 1000) / 1000;
export const CASHOUT_EFFICIENCY = 0.95; // SportPesa paid ~96% of fair value on the 31 Oct cash-out (one sample): an estimate, not a promise

export function combineSlips(slips, stake = 0, { eta = CASHOUT_EFFICIENCY } = {}) {
  const legs = slips.flatMap((s) => (s.legs || []).map((l) => ({ ...l, slip: s.id })));
  const owner = new Map(), shared = new Set();
  for (const l of legs) { if (owner.has(l.pid) && owner.get(l.pid) !== l.slip) shared.add(l.pid); owner.set(l.pid, l.slip); }
  const odds = legs.reduce((a, l) => a * l.odds, 1);
  const prob = legs.reduce((a, l) => a * (l.p > 0 ? l.p : 1), 1);
  const st = Number(stake) > 0 ? Number(stake) : 0;
  const byTime = [...legs].sort((a, b) => String(a.kickoff).localeCompare(String(b.kickoff)));
  const n = byTime.length, ks = [...new Set([0.25, 0.5, 0.75].map((f) => Math.max(1, Math.round(n * f))).filter((k) => k < n))];
  const ladder = ks.map((k) => {
    const head = byTime.slice(0, k), m = head.reduce((a, l) => a * l.odds, 1) * eta;
    return { k, prob: r3(head.reduce((a, l) => a * (l.p > 0 ? l.p : 1), 1)), multiple: r3(m), value: st * m };
  });
  return { slips: slips.length, legs: n, odds: r3(odds), prob: r3(prob), stake: st, payout: st * odds, expected: st * odds * prob, overlaps: [...shared], ladder };
}
