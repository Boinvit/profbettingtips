// Best matches: the only matches the platform leads with. A match qualifies when its data is complete (sure.mjs: enough games, five-result form, not youth or reserve) and the corrected chance of its most likely outcome reaches BEST_MIN_P. Chances are corrected by what settled results showed for that confidence band (longshots.mjs).
import { legsFor, legWins } from './accas.mjs';
import { dataGaps } from './sure.mjs';
import { adjustP } from './longshots.mjs';

export const BEST_MIN_P = 0.80;

export function bestInfo(p, learned = null, cal = null) {
  const gaps = dataGaps(p);
  if (gaps.length) return { best: false, why: gaps.join(', ') };
  let legs = [];
  try { legs = legsFor(p, cal, { sure: true }) || []; } catch (e) { legs = []; }
  if (!legs.length) return { best: false, why: 'no sure outcome' };
  const top = legs.reduce((a, b) => (b.p > a.p ? b : a));
  const q = adjustP(top.p, learned);
  const pick = { mkt: top.mkt, sel: top.sel, label: top.label, odds: top.odds, p: Math.round(q * 1000) / 1000 };
  return q >= BEST_MIN_P ? { best: true, q, pick } : { best: false, q, pick, why: 'chance below ' + BEST_MIN_P };
}

/** Did the best pick of a settled match land? undefined when there is no pick or no result. */
export const bestWon = (p) => (p.bestPick && p.result ? !!legWins(p.bestPick.mkt, p.bestPick.sel, p.result.hg, p.result.ag) : undefined);
