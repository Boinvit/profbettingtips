// Long shots: up to MAX_LEGS matches a day (the most probable first), laid out as FIVE slips built from the SAME matches:
// slips 1-4 use every match's 1st, 2nd, 3rd and 4th most probable outcome; slip 5 mixes ranks across matches.
// Entertainment tier: tiny stakes only. The honest whole-slip chance and expected result are always stored beside the payout.
import { legsFor, dayKey, settleAcca } from './accas.mjs';
import { isTrusted } from './sure.mjs';

export const MIN_MATCH_P = 0.60, MAX_LEGS = 24, MIN_LEGS = 4, MIN_GAMES = 20, LEAD_MS = 45 * 60e3;
const YOUTH = /\b(U-?(1[5-9]|2[0-3])|youth|reserves?)\b|[ ](II|III)$/i; // squads rotate, little reliable history
const r2 = (x) => Math.round(x * 100) / 100, r4 = (x) => Math.round(x * 10000) / 10000, sig = (x) => Number(x.toPrecision(3));

/** Matches for one EAT day whose most probable outcome is at least MIN_MATCH_P. Excludes started games, youth/reserve sides, thin-data and unlisted matches. Best first, capped at MAX_LEGS. */
export function dayMatches(preds, day, now, cal = null, { requireListed = true } = {}) {
  const out = [];
  for (const p of preds) {
    if (p.status !== 'pending' || !p.pk) continue;
    if (dayKey(p.kickoff) !== day || Date.parse(p.kickoff) < now.getTime() + LEAD_MS) continue;
    if ((requireListed && p.listed === false) || !isTrusted(p)) continue;
    const legs = legsFor(p, cal, { sure: true }).sort((a, b) => b.p - a.p);
    if (legs.length && legs[0].p >= MIN_MATCH_P) out.push({ p, legs });
  }
  return out.sort((a, b) => b.legs[0].p - a.legs[0].p).slice(0, MAX_LEGS);
}

function mk(day, key, picks, now) {
  const legs = picks.map(({ c, l, r }) => ({ pid: c.p.id, home: c.p.home, away: c.p.away, comp: c.p.comp, kickoff: c.p.kickoff, mkt: l.mkt, sel: l.sel, label: l.label, p: r4(l.p), odds: l.odds, src: l.src, rank: r })).sort((a, b) => a.kickoff.localeCompare(b.kickoff));
  const odds = legs.reduce((a, l) => a * l.odds, 1), pAll = legs.reduce((a, l) => a * l.p, 1);
  return { id: `ls:${day}:${key}`, kind: 'longshot', day, key, n: key === 'mix' ? 5 : Number(key), status: 'pending', created: now.toISOString(), legs, odds: r2(odds), pAll: sig(pAll), ev10: r2(10 * (pAll * odds - 1)), modelPriced: legs.filter((l) => l.src === 'model').length, unconfirmed: picks.some(({ c }) => c.p.listed === false) };
}

/** Slips 1-4: the k-th most probable outcome of each match. Slip 5: outcome rank cycles 1,2,3,4 down the kickoff order. */
export function buildDay(preds, day, now, cal = null, opts = {}) {
  const ms = dayMatches(preds, day, now, cal, opts);
  if (ms.length < MIN_LEGS) return [];
  const slips = [];
  for (let r = 0; r < 4; r++) {
    const picks = ms.filter((c) => c.legs[r]).map((c) => ({ c, l: c.legs[r], r: r + 1 }));
    if (picks.length >= MIN_LEGS) slips.push(mk(day, String(r + 1), picks, now));
  }
  const mix = [...ms].sort((a, b) => a.p.kickoff.localeCompare(b.p.kickoff)).map((c, i) => { const r = i % 4, ok = !!c.legs[r]; return { c, l: ok ? c.legs[r] : c.legs[0], r: ok ? r + 1 : 1 }; });
  slips.push(mk(day, 'mix', mix, now));
  return slips;
}

export function longShotStats(items) {
  const done = items.filter((a) => a.status === 'won' || a.status === 'lost');
  const legs = items.flatMap((a) => a.legs).filter((l) => typeof l.ok === 'boolean');
  const byRank = {};
  for (const a of items) { // slips 1-4 only, so mix legs are not counted twice
    if (a.key === 'mix') continue;
    for (const l of a.legs) { if (typeof l.ok !== 'boolean') continue; const b = byRank[l.rank || 0] || (byRank[l.rank || 0] = { n: 0, won: 0, claimed: 0 }); b.n++; b.won += l.ok ? 1 : 0; b.claimed += l.p; }
  }
  for (const b of Object.values(byRank)) b.claimed = r4(b.claimed / b.n);
  return {
    n: items.length, pending: items.filter((a) => a.status === 'pending').length, settled: done.length, won: done.filter((a) => a.status === 'won').length,
    expectedWins: sig(done.reduce((s, a) => s + a.pAll, 0)),
    legsSettled: legs.length, legsWon: legs.filter((l) => l.ok).length, legClaimed: legs.length ? r4(legs.reduce((s, l) => s + l.p, 0) / legs.length) : null, byRank,
  };
}

/** Settle existing slips, then build the day's five slips for today and tomorrow (EAT). A set that is untouched (nothing settled, nothing kicked off) is rebuilt only when it can get longer; a started set never changes. */
export function updateLongShots(prev, preds, now = new Date(), { cal = null, requireListed = true } = {}) {
  const items = [...(prev.items || [])], byId = new Map(preds.map((p) => [p.id, p]));
  for (const a of items) settleAcca(a, byId, now);
  const today = dayKey(now.toISOString());
  for (const day of [today, dayKey(new Date(now.getTime() + 864e5).toISOString())]) {
    const have = items.filter((i) => i.day === day);
    const untouched = have.every((a) => a.status === 'pending' && a.legs.every((l) => Date.parse(l.kickoff) > now.getTime() + LEAD_MS));
    if (have.length && !untouched) continue;
    const built = buildDay(preds, day, now, cal, { requireListed });
    if (!built.length) continue;
    const modern = have.length > 0 && have.every((a) => a.key);
    const oldLen = have.length ? Math.max(...have.map((a) => a.legs.length)) : 0, newLen = Math.max(...built.map((a) => a.legs.length));
    if (modern && newLen <= oldLen) continue;
    for (const a of have) items.splice(items.indexOf(a), 1);
    items.push(...built);
  }
  const kept = items.slice(-300);
  return { items: kept, stats: longShotStats(kept), generated: now.toISOString() };
}
