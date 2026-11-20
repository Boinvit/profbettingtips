import { legWins as _legWins } from './accas.mjs';
// Long shots: up to MAX_LEGS (6) matches a day, the most probable first; short slips so the whole-slip chance stays meaningful, laid out as FIVE slips built from the SAME matches:
// slips 1-4 use every match's 1st, 2nd, 3rd and 4th most probable outcome; slip 5 mixes ranks across matches.
// Entertainment tier: tiny stakes only. The honest whole-slip chance and expected result are always stored beside the payout.
import { legsFor, dayKey, settleAcca } from './accas.mjs';
import { isTrusted } from './sure.mjs';

export const MIN_MATCH_P = 0.60, MAX_LEGS = 6, MIN_LEGS = 4, MIN_GAMES = 20, LEAD_MS = 45 * 60e3;
const YOUTH = /\b(U-?(1[5-9]|2[0-3])|youth|reserves?)\b|[ ](II|III)$/i; // squads rotate, little reliable history
const r2 = (x) => Math.round(x * 100) / 100, r4 = (x) => Math.round(x * 10000) / 10000, sig = (x) => Number(x.toPrecision(3));

/** Matches for one EAT day whose most probable outcome is at least MIN_MATCH_P. Excludes started games, youth/reserve sides, thin-data and unlisted matches. Best first, capped at MAX_LEGS. */
export function dayMatches(preds, day, now, cal = null, { requireListed = true, learned = null } = {}) {
  const out = [];
  for (const p of preds) {
    if (p.status !== 'pending' || !p.pk) continue;
    if (dayKey(p.kickoff) !== day || Date.parse(p.kickoff) < now.getTime() + LEAD_MS) continue;
    if ((requireListed && p.listed === false) || !isTrusted(p)) continue;
    const legs = legsFor(p, cal, { sure: true }).map((l) => ({ ...l, pRaw: l.p, p: adjustP(l.p, learned) })).sort((a, b) => b.p - a.p);
    if (legs.length && legs[0].p >= MIN_MATCH_P) out.push({ p, legs });
  }
  return out.sort((a, b) => (b.legs[0].p - a.legs[0].p) || ((b.legs[0].pRaw || 0) - (a.legs[0].pRaw || 0))).slice(0, MAX_LEGS * MAX_SLIPS);
}

function mk(day, key, picks, now) {
  const legs = picks.map(({ c, l, r }) => ({ pid: c.p.id, home: c.p.home, away: c.p.away, comp: c.p.comp, kickoff: c.p.kickoff, mkt: l.mkt, sel: l.sel, label: l.label, p: r4(l.p), pRaw: l.pRaw === undefined ? undefined : r4(l.pRaw), odds: l.odds, src: l.src, rank: r })).sort((a, b) => a.kickoff.localeCompare(b.kickoff));
  const odds = legs.reduce((a, l) => a * l.odds, 1), pAll = legs.reduce((a, l) => a * l.p, 1);
  return { id: `ls:${day}:${key}`, kind: 'longshot', day, key, n: legs.length, status: 'pending', created: now.toISOString(), legs, odds: r2(odds), pAll: sig(pAll), ev10: r2(10 * (pAll * odds - 1)), modelPriced: legs.filter((l) => l.src === 'model').length, unconfirmed: picks.some(({ c }) => c.p.listed === false) };
}

/** One slip per group of the day's most reliable matches: only each match's most likely outcome, at most MAX_LEGS legs, up to MAX_SLIPS slips from separate matches (A is the surest). */
export function buildDay(preds, day, now, cal = null, opts = {}) {
  const ms = dayMatches(preds, day, now, cal, opts).slice().sort((a, b) => (b.legs[0].p - a.legs[0].p) || ((b.legs[0].pRaw || 0) - (a.legs[0].pRaw || 0)));
  const slips = [];
  for (let k = 0; k < MAX_SLIPS; k++) {
    const part = ms.slice(k * MAX_LEGS, (k + 1) * MAX_LEGS);
    if (part.length < MIN_LEGS) break;
    slips.push(mk(day, 'ABC'[k], part.map((c) => ({ c, l: c.legs[0], r: 1 })), now));
  }
  return slips;
}

export const MAX_SLIPS = 3, STAKE = 10, MIN_REAL = 15, PRIOR_N = 30;
export const BANDS = [[0.5, 0.6], [0.6, 0.65], [0.65, 0.7], [0.7, 0.75], [0.75, 0.8], [0.8, 0.9], [0.9, 1.01]];
const bandOf = (p) => BANDS.findIndex(([lo, hi]) => p >= lo && p < hi);

/** How often each claimed-chance band really landed, from settled matches (the top outcome of each). */
export function learnCalibration(samples) {
  const bands = BANDS.map(([lo, hi]) => ({ lo, hi: Math.min(hi, 1), n: 0, won: 0, claimed: 0 }));
  for (const s of samples) { const i = bandOf(s.p); if (i < 0) continue; bands[i].n++; bands[i].won += s.ok ? 1 : 0; bands[i].claimed += s.p; }
  for (const b of bands) { b.rate = b.n ? r4(b.won / b.n) : null; b.claimed = b.n ? r4(b.claimed / b.n) : null; }
  return { n: samples.length, bands };
}

/** A claimed chance moved toward what really happened in its band, with more weight as results accumulate. A claim above every band that has results is capped just above the best evidenced band: the model is not trusted beyond what it has shown. */
export function adjustP(p, learned) {
  if (!learned) return p;
  const i = bandOf(p);
  let top = -1;
  learned.bands.forEach((b, j) => { if (b.n >= 20) top = j; });
  if (top >= 0 && i > top) { const t = learned.bands[top], w = t.n / (t.n + PRIOR_N); return r4(Math.min(p, t.claimed + w * (t.rate - t.claimed) + 0.03)); }
  const b = i >= 0 ? learned.bands[i] : null;
  if (!b || !b.n) return p;
  const w = b.n / (b.n + PRIOR_N);
  return r4(Math.min(0.99, Math.max(0.01, p + w * (b.rate - b.claimed))));
}

/** The top outcome of every settled, trusted match as it was claimed before kickoff, and whether it landed. */
export function topLegSamples(preds, cal = null) {
  const out = [];
  for (const p of preds) {
    if (p.status !== 'settled' || !p.result || !p.pk || !isTrusted(p)) continue;
    let legs = [];
    try { legs = legsFor(p, cal, { sure: true }) || []; } catch (e) { legs = []; }
    if (!legs.length) continue;
    const top = legs.reduce((a, b) => (b.p > a.p ? b : a));
    if (!(top.p >= 0.5) || !Number.isFinite(top.odds)) continue;
    out.push({ id: p.id, day: dayKey(p.kickoff), p: top.p, odds: top.odds, ok: !!_legWins(top.mkt, top.sel, p.result.hg, p.result.ag) });
  }
  return out;
}

/** Replays the rule day by day on past matches. Each day is judged only with what was learned before it. */
export function backtest(samples) {
  const byDay = {};
  for (const s of samples) (byDay[s.day] ||= []).push(s);
  const days = Object.keys(byDay).sort(), log = [];
  let won = 0, expected = 0, stake = 0, returned = 0;
  for (const d of days) {
    const train = samples.filter((s) => s.day < d);
    const learned = train.length >= 60 ? learnCalibration(train) : null;
    const cands = byDay[d].map((s) => ({ ...s, q: adjustP(s.p, learned) })).filter((s) => s.q >= MIN_MATCH_P).sort((a, b) => b.q - a.q);
    for (let k = 0; k < MAX_SLIPS; k++) {
      const pick = cands.slice(k * MAX_LEGS, (k + 1) * MAX_LEGS);
      if (pick.length < MIN_LEGS) break;
      const all = pick.every((s) => s.ok), odds = pick.reduce((a, s) => a * s.odds, 1);
      won += all ? 1 : 0; expected += pick.reduce((a, s) => a * s.q, 1); stake += STAKE; returned += all ? STAKE * odds : 0;
      log.push({ day: d, n: pick.length, won: all, odds: r2(odds) });
    }
  }
  return { days: new Set(log.map((x) => x.day)).size, slips: log.length, won, expected: r2(expected), stake, returned: r2(returned), roi: stake ? r4((returned - stake) / stake) : null, legsN: samples.length, legsWon: samples.filter((s) => s.ok).length, recent: log.slice(-10) };
}

/** Plain advice on staking, from real results first and the replay while real results are few. */
export function adviceFor(all, bt) {
  const lines = [];
  const real = all.slips >= MIN_REAL;
  const src = real ? { slips: all.slips, won: all.won, expected: all.expectedWins, roi: all.roi, label: 'your real long shots' } : (bt && bt.slips >= 30 ? { slips: bt.slips, won: bt.won, expected: bt.expected, roi: bt.roi, label: 'a replay of the rule on past matches (odds estimated by the model)' } : null);
  lines.push(all.slips ? 'Real slips so far: ' + all.won + ' of ' + all.slips + ' won (the model expected about ' + all.expectedWins + ').' : 'No real long shot has settled yet under the single-slip rule.');
  if (bt && bt.slips) lines.push('Replay over ' + bt.days + ' past days: ' + bt.won + ' of ' + bt.slips + ' slips would have won (expected about ' + bt.expected + '). Flat KES ' + STAKE + ' per slip would have returned ' + Math.round((bt.roi || 0) * 100) + '% over the stake.');
  let verdict, headline;
  if (!src || src.roi === null || src.roi === undefined) { verdict = 'wait'; headline = 'Not enough results yet to judge. Do not stake on long shots for now.'; }
  else if (src.roi < 0) { verdict = 'no'; headline = 'Do not stake: ' + src.label + ' lose money on average (' + Math.round(src.roi * 100) + '% per KES staked).'; }
  else if (src.slips < 30) { verdict = 'wait'; headline = 'Break-even so far but too few results. Skip it, or stake at most KES ' + STAKE + ' for fun.'; }
  else { verdict = 'tiny'; headline = 'A small edge shows (' + Math.round(src.roi * 100) + '% per KES staked) but it may be luck. Stake at most KES ' + STAKE * 2 + ' per slip.'; }
  if (src && src.won < src.expected - 2 * Math.sqrt(src.expected)) lines.push('Slips are winning clearly less often than the model claimed, so its chances are too optimistic.');
  lines.push('A slip can lose even when the advice is positive. Never stake money you need.');
  return { verdict, headline, lines, basis: src ? src.label : null };
}

/** Track record of the single-slip long shots (and legacy slip 1), over 7 days, 30 days and everything. */
export function longShotSummary(items, bt, learned, now = new Date()) {
  const mine = items.filter((a) => 'ABC1'.includes(a.key));
  const settled = mine.filter((a) => a.status === 'won' || a.status === 'lost');
  const stat = (list) => {
    const n = list.length, won = list.filter((a) => a.status === 'won').length, stake = n * STAKE;
    const returned = list.reduce((t, a) => t + (a.status === 'won' ? STAKE * a.odds : 0), 0);
    const legs = list.flatMap((a) => a.legs).filter((l) => typeof l.ok === 'boolean');
    return { slips: n, won, expectedWins: r2(list.reduce((t, a) => t + a.pAll, 0)), stake, returned: r2(returned), roi: stake ? r4((returned - stake) / stake) : null, legs: legs.length, legsWon: legs.filter((l) => l.ok).length, legClaimed: legs.length ? r4(legs.reduce((t, l) => t + (l.pRaw === undefined ? l.p : l.pRaw), 0) / legs.length) : null };
  };
  const since = (days) => { const from = dayKey(new Date(now.getTime() - days * 864e5).toISOString()); return settled.filter((a) => a.day >= from); };
  const periods = { d7: stat(since(7)), d30: stat(since(30)), all: stat(settled) };
  const recent = settled.slice().sort((a, b) => b.day.localeCompare(a.day) || a.key.localeCompare(b.key)).slice(0, 10);
  return { generated: now.toISOString(), stake: STAKE, periods, form: recent.map((a) => (a.status === 'won' ? 'W' : 'L')).join(''), backtest: bt, learned: learned ? { n: learned.n, bands: learned.bands.filter((b) => b.n) } : null, advice: adviceFor(periods.all, bt) };
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
  const samples = topLegSamples(preds, cal), learned = samples.length >= 60 ? learnCalibration(samples) : null;
  for (const a of items) settleAcca(a, byId, now);
  const today = dayKey(now.toISOString());
  for (const day of [today, dayKey(new Date(now.getTime() + 864e5).toISOString())]) {
    const have = items.filter((i) => i.day === day);
    const untouched = have.every((a) => a.status === 'pending' && a.legs.every((l) => Date.parse(l.kickoff) > now.getTime() + LEAD_MS));
    if (have.length && !untouched) continue;
    const built = buildDay(preds, day, now, cal, { requireListed, learned });
    if (!built.length) continue;
    const modern = have.length > 0 && have.every((a) => 'ABC'.includes(a.key));
    const oldLen = have.reduce((t, a) => t + a.legs.length, 0), newLen = built.reduce((t, a) => t + a.legs.length, 0);
    if (modern && newLen <= oldLen) continue;
    for (const a of have) items.splice(items.indexOf(a), 1);
    items.push(...built);
  }
  const kept = items.slice(-300);
  return { items: kept, stats: longShotStats(kept), summary: longShotSummary(kept, backtest(samples), learned, now), generated: now.toISOString() };
}
