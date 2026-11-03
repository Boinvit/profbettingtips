// Long-shot accumulators: many legs, EVERY leg at least MIN_LEG_P by the calibrated model, no match used twice across the day's slips.
// Entertainment tier: tiny stakes only. The honest whole-slip chance and expected result are always stored beside the payout.
import { legsFor, dayKey, settleAcca } from './accas.mjs';

export const MIN_LEG_P = 0.66, SLIPS_PER_DAY = 3, MIN_LEGS = 5, MAX_LEGS = 12, MIN_GAMES = 20, LEAD_MS = 45 * 60e3;
const YOUTH = /\b(U-?(1[5-9]|2[0-3])|youth|reserves?)\b|[ ](II|III)$/i; // squads rotate, little reliable history
const r2 = (x) => Math.round(x * 100) / 100, r4 = (x) => Math.round(x * 10000) / 10000;

/** Per match: legs at or above MIN_LEG_P (best first). Excludes started games, youth/reserve sides, thin-data and unlisted matches. */
export function dayCandidates(preds, day, now, cal = null, minP = MIN_LEG_P) {
  const out = [];
  for (const p of preds) {
    if (p.status !== 'pending' || !p.pk) continue;
    if (dayKey(p.kickoff) !== day || Date.parse(p.kickoff) < now.getTime() + LEAD_MS) continue;
    if (p.listed === false || (p.games != null && p.games < MIN_GAMES)) continue;
    if (YOUTH.test(p.home) || YOUTH.test(p.away)) continue;
    const legs = legsFor(p, cal).filter((l) => l.p >= minP).sort((a, b) => b.p - a.p);
    if (legs.length) out.push({ p, legs });
  }
  return out;
}

function mk(day, n, picks, now, floor = MIN_LEG_P) {
  const legs = picks.map(({ c, l }) => ({ pid: c.p.id, home: c.p.home, away: c.p.away, comp: c.p.comp, kickoff: c.p.kickoff, mkt: l.mkt, sel: l.sel, label: l.label, p: r4(l.p), odds: l.odds, src: l.src })).sort((a, b) => a.kickoff.localeCompare(b.kickoff));
  const odds = legs.reduce((a, l) => a * l.odds, 1), pAll = legs.reduce((a, l) => a * l.p, 1);
  return { id: `ls:${day}:${n}`, kind: 'longshot', floor, day, n, status: 'pending', created: now.toISOString(), legs, odds: r2(odds), pAll: r4(pAll), ev10: r2(10 * (pAll * odds - 1)), modelPriced: legs.filter((l) => l.src === 'model').length };
}

/** Up to SLIPS_PER_DAY slips for one EAT day. Qualifying matches are shared evenly (slip 1 gets the most probable legs). No match twice; no pick type over half a slip. */
export function buildDay(preds, day, now, cal = null, minP = MIN_LEG_P) {
  const cands = dayCandidates(preds, day, now, cal, minP).sort((a, b) => b.legs[0].p - a.legs[0].p);
  const k = Math.min(SLIPS_PER_DAY, Math.floor(cands.length / MIN_LEGS));
  if (!k) return [];
  const size = Math.min(MAX_LEGS, Math.floor(cands.length / k)), cap = Math.ceil(size / 2);
  const used = new Set(), slips = [];
  for (let s = 0; s < k; s++) {
    const cnt = {}, picks = [];
    for (const c of cands) {
      if (picks.length >= size) break;
      if (used.has(c.p.id)) continue;
      const l = c.legs.find((x) => (cnt[x.mkt + x.sel] || 0) < cap);
      if (!l) continue;
      cnt[l.mkt + l.sel] = (cnt[l.mkt + l.sel] || 0) + 1; picks.push({ c, l });
    }
    if (picks.length < MIN_LEGS) break;
    picks.forEach((x) => used.add(x.c.p.id));
    slips.push(picks);
  }
  return slips.map((picks, i) => mk(day, i + 1, picks, now, minP));
}

export const FALLBACK_P = 0.60;
/** 66% floor by default; on a day where fewer than 3 slips can be built at 66%, allow legs down to 60% if that yields more slips. */
export function buildDayAdaptive(preds, day, now, cal = null) {
  const a = buildDay(preds, day, now, cal, MIN_LEG_P);
  if (a.length >= SLIPS_PER_DAY) return a;
  const b = buildDay(preds, day, now, cal, FALLBACK_P);
  return b.length > a.length ? b : a;
}

export function longShotStats(items) {
  const done = items.filter((a) => a.status === 'won' || a.status === 'lost');
  const legs = items.flatMap((a) => a.legs).filter((l) => typeof l.ok === 'boolean');
  return {
    n: items.length, pending: items.filter((a) => a.status === 'pending').length, settled: done.length, won: done.filter((a) => a.status === 'won').length,
    expectedWins: r2(done.reduce((s, a) => s + a.pAll, 0)),
    legsSettled: legs.length, legsWon: legs.filter((l) => l.ok).length, legClaimed: legs.length ? r4(legs.reduce((s, l) => s + l.p, 0) / legs.length) : null,
  };
}

/** Settle existing slips, then freeze new ones for today and tomorrow (EAT) once a full set of slips can be built. A day's slips never change after creation. */
export function updateLongShots(prev, preds, now = new Date(), { cal = null } = {}) {
  const items = [...(prev.items || [])], byId = new Map(preds.map((p) => [p.id, p]));
  for (const a of items) settleAcca(a, byId, now);
  const today = dayKey(now.toISOString());
  for (const day of [today, dayKey(new Date(now.getTime() + 864e5).toISOString())]) {
    const have = items.filter((i) => i.day === day);
    if (have.length >= SLIPS_PER_DAY) continue; // a full set never changes
    // a short set that is still untouched (nothing settled, nothing kicked off) may be rebuilt when more qualifying matches appear
    const untouched = have.every((a) => a.status === 'pending' && a.legs.every((l) => Date.parse(l.kickoff) > now.getTime() + LEAD_MS));
    if (have.length && !untouched) continue;
    const built = buildDayAdaptive(preds, day, now, cal);
    if (built.length <= have.length) continue;
    if (built.length === SLIPS_PER_DAY || day === today) { for (const a of have) items.splice(items.indexOf(a), 1); items.push(...built); } // tomorrow waits for a full set; today can only shrink
  }
  const kept = items.slice(-300);
  return { items: kept, stats: longShotStats(kept), generated: now.toISOString() };
}
