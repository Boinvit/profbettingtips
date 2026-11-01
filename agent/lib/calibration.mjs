// Self-awareness: how often are the model's own confident picks actually right?
// Replays the model walk-forward over stored history (predict BEFORE learning each match), bins each published pick by its
// stated probability, and records the real hit rate per market. `calibrate` then corrects a leg's probability by that measured gap.
import { newState, predict, learn, picks, grade } from './model.mjs';

const MK = { x12: 'x12p', dc: 'dcp', ou: 'oup', bt: 'btp' };
const EDGES = [0.5, 0.55, 0.6, 0.65, 0.7, 0.75, 0.8, 0.85, 0.9, 0.95, 1.0001];
export const PROB_CAP = 0.93; // no single leg is ever treated as more than 93% certain, whatever the model says
export const SHRINK_K = 40;   // pseudo-games pulling a thin bin back toward the model's stated probability
const r3 = (x) => Math.round(x * 1000) / 1000;

export function buildCalibration(matches, params, { warmupFrac = 0.4, now = new Date() } = {}) {
  const s = newState(), warm = Math.floor(matches.length * warmupFrac);
  const bins = {};
  for (const k of Object.keys(MK)) bins[k] = EDGES.slice(0, -1).map((lo, i) => ({ lo, hi: EDGES[i + 1], n: 0, hit: 0, sp: 0 }));
  let evaluated = 0;
  for (let i = 0; i < matches.length; i++) {
    const m = matches[i];
    if (i >= warm) {
      const pk = picks(predict(s, params, m.c, m.h, m.a, m.o ? { odds: m.o } : {}));
      const g = grade(pk, m.hg, m.ag);
      for (const [k, pf] of Object.entries(MK)) {
        const p = pk[pf], b = bins[k].find((x) => p >= x.lo && p < x.hi);
        if (!b) continue;
        b.n++; b.sp += p; if (g[k]) b.hit++;
      }
      evaluated++;
    }
    learn(s, params, m);
  }
  const markets = {};
  for (const [k, bs] of Object.entries(bins)) markets[k] = bs.map((b) => ({ lo: b.lo, hi: Math.min(b.hi, 1), n: b.n, pred: b.n ? r3(b.sp / b.n) : null, real: b.n ? r3(b.hit / b.n) : null }));
  return { updated: now.toISOString(), n: matches.length, evaluated, markets };
}

/** Corrected probability for one leg. With no calibration data the raw probability is returned untouched. */
export function calibrate(cal, mkt, p) {
  const bs = cal && cal.markets && cal.markets[mkt];
  if (!bs) return p;
  let q = p;
  const b = bs.find((x) => p >= x.lo && (p < x.hi || x.hi >= 1));
  if (b && b.n > 0 && b.pred != null) {
    const rate = (b.real * b.n + SHRINK_K * b.pred) / (b.n + SHRINK_K); // shrink toward stated prob when the bin is thin
    q = p + (rate - b.pred);
  }
  return Math.min(PROB_CAP, Math.max(0.01, q));
}
