// Accumulator builder: daily / weekend slips made of the model's safest selections. Probabilities are the model's own estimates and
// legs from different matches are treated as independent, so the combined probability is an estimate, not a guarantee.
// Slips freeze once any match kicks off and are then settled from real scores.
import { dropDuplicatePending } from './dupes.mjs';
const DAY = 86400000, EAT = 3 * 3600e3;
export const MIN_GAMES = 6, LEG_FLOOR = 0.55, MIN_PROB = 0.10;
const MARGIN = 0.93; // typical bookmaker margin, applied when a leg is priced by the model
const BANDS = [{ t: 2, lo: 1.7, hi: 2.4 }, { t: 3, lo: 2.5, hi: 3.6 }, { t: 5, lo: 4.2, hi: 6.5 }, { t: 10, lo: 8, hi: 13 }];
export const dayKey = (iso) => new Date(+new Date(iso) + EAT).toISOString().slice(0, 10);
const addDays = (k, n) => new Date(+new Date(k + 'T00:00:00Z') + n * DAY).toISOString().slice(0, 10);
const dow = (k) => new Date(k + 'T00:00:00Z').getUTCDay();
const r2 = (x) => Math.round(x * 100) / 100, r3 = (x) => Math.round(x * 1000) / 1000;
export function legLabel(mkt, sel, home, away) {
  if (mkt === 'x12') return sel === 'H' ? `${home} to win` : sel === 'A' ? `${away} to win` : 'Draw';
  if (mkt === 'dc') return sel === '1X' ? `${home} or draw` : sel === 'X2' ? `${away} or draw` : `${home} or ${away} (no draw)`;
  if (mkt === 'ou') return sel === 'O' ? 'Over 2.5 goals' : 'Under 2.5 goals';
  return sel === 'Y' ? 'Both teams to score' : 'Both teams not to score';
}
/** Does a selection win, given the final score? Used for settlement so it never depends on later model changes. */
export function legWins(mkt, sel, hg, ag) {
  const o = hg > ag ? 'H' : hg < ag ? 'A' : 'D';
  if (mkt === 'x12') return sel === o;
  if (mkt === 'dc') return sel.includes(o === 'H' ? '1' : o === 'A' ? '2' : 'X');
  if (mkt === 'ou') return sel === (hg + ag >= 3 ? 'O' : 'U');
  return sel === (hg > 0 && ag > 0 ? 'Y' : 'N');
}
/** Candidate selections for one prediction. Bookmaker odds are used where the agent has them (1X2 and double chance). */
export function legsFor(p) {
  const k = p.pk; if (!k) return [];
  const o = p.ctx?.odds, book = Array.isArray(o) && o.length === 3 && o.every((x) => +x > 1) ? o.map(Number) : null;
  const priced = (q) => Math.max(1.01, r2(MARGIN / q));
  const ix = { H: 0, D: 1, A: 2 }, dci = k.dc === '1X' ? [0, 1] : k.dc === 'X2' ? [1, 2] : [0, 2];
  const legs = [
    { mkt: 'x12', sel: k.x12, p: k.x12p, odds: book ? book[ix[k.x12]] : priced(k.x12p), src: book ? 'book' : 'model' },
    { mkt: 'dc', sel: k.dc, p: k.dcp, odds: book ? r2(1 / (1 / book[dci[0]] + 1 / book[dci[1]])) : priced(k.dcp), src: book ? 'book' : 'model' },
    { mkt: 'ou', sel: k.ou, p: k.oup, odds: priced(k.oup), src: 'model' },
    { mkt: 'bt', sel: k.bt, p: k.btp, odds: priced(k.btp), src: 'model' },
  ];
  return legs.filter((l) => l.p > 0 && l.odds >= 1.05).map((l) => ({ ...l, label: legLabel(l.mkt, l.sel, p.home, p.away) }));
}
/** Highest-probability slip (one selection per match) whose combined odds fall in [lo, hi] with minN..maxN legs. */
export function bestInBand(cands, { lo, hi, minN = 2, maxN = 8 }) {
  const bucket = (x) => Math.round(Math.log(x) / 0.02);
  let states = new Map([['0|0', { prob: 1, odds: 1, picks: [] }]]);
  for (const c of cands) {
    const next = new Map(states);
    for (const s of states.values()) {
      if (s.picks.length >= maxN) continue;
      for (const l of c.legs) {
        const odds = s.odds * l.odds; if (odds > hi * 1.02) continue;
        const key = `${s.picks.length + 1}|${bucket(odds)}`, prob = s.prob * l.p, cur = next.get(key);
        if (!cur || prob > cur.prob) next.set(key, { prob, odds, picks: [...s.picks, { c, l }] });
      }
    }
    states = next;
  }
  let best = null;
  for (const s of states.values()) if (s.picks.length >= minN && s.odds >= lo && s.odds <= hi && (!best || s.prob > best.prob)) best = s;
  return best;
}
/** Windows we publish for: today, tomorrow, and the coming weekend (from Thursday). All in Nairobi time (EAT). */
export function windows(now) {
  const t = dayKey(now.toISOString());
  const ws = [{ kind: 'daily', id: `daily:${t}`, days: [t] }, { kind: 'daily', id: `daily:${addDays(t, 1)}`, days: [addDays(t, 1)] }];
  const w = dow(t);
  if (w >= 4 || w === 0) {
    const sat = w === 0 ? addDays(t, -1) : addDays(t, 6 - w);
    ws.push({ kind: 'weekend', id: `weekend:${sat}`, days: [sat, addDays(sat, 1)].filter((d) => d >= t) });
  }
  return ws;
}
const gradeOf = (legs) => { const m = Math.min(...legs.map((l) => l.p)); return m >= 0.75 ? 'banker' : m >= 0.65 ? 'solid' : 'risky'; };
export function buildWindow(w, pool, now = new Date()) {
  const cands = pool.map((p) => ({ p, legs: legsFor(p).filter((l) => l.p >= LEG_FLOOR) })).filter((c) => c.legs.length)
    .sort((a, b) => Math.max(...b.legs.map((l) => l.p)) - Math.max(...a.legs.map((l) => l.p))).slice(0, 30);
  if (cands.length < 2) return [];
  const out = new Map();
  const push = (type, title, s) => {
    if (!s || s.prob < MIN_PROB) return;
    const sig = s.picks.map((x) => x.c.p.id + x.l.mkt).sort().join(',');
    if (out.has(sig)) return;
    const legs = s.picks.map(({ c, l }) => ({ pid: c.p.id, home: c.p.home, away: c.p.away, comp: c.p.comp, kickoff: c.p.kickoff, mkt: l.mkt, sel: l.sel, label: l.label, p: r3(l.p), odds: l.odds, src: l.src }))
      .sort((a, b) => a.kickoff.localeCompare(b.kickoff));
    out.set(sig, { id: `${w.id}|${type}`, window: w.kind, key: w.id, days: w.days, type, title, n: legs.length, odds: r2(s.odds), prob: r3(s.prob),
      grade: gradeOf(legs), est: legs.some((l) => l.src === 'model'), created: now.toISOString(), status: 'pending', lastKickoff: legs.at(-1).kickoff, legs });
  };
  for (let n = 2; n <= 6; n++) push(`fold${n}`, `${n}-fold`, bestInBand(cands, { lo: 1.4 * 1.12 ** (n - 2), hi: 60, minN: n, maxN: n }));
  for (const b of BANDS) push(`odds${b.t}`, `Around ${b.t}x`, bestInBand(cands, { lo: b.lo, hi: b.hi, minN: 2, maxN: 8 }));
  return [...out.values()].sort((a, b) => a.odds - b.odds);
}
export function settleAcca(a, byId, now) {
  if (a.status !== 'pending') return;
  let allIn = true, lost = false;
  for (const l of a.legs) {
    const p = byId.get(l.pid);
    if (p && p.status === 'settled' && p.result && Number.isInteger(p.result.hg)) {
      l.res = { hg: p.result.hg, ag: p.result.ag }; l.ok = legWins(l.mkt, l.sel, p.result.hg, p.result.ag);
      if (!l.ok) lost = true;
    } else allIn = false;
  }
  if (lost) { a.status = 'lost'; a.settled = now.toISOString(); }
  else if (allIn) { a.status = 'won'; a.settled = now.toISOString(); }
  else if (now - new Date(a.lastKickoff) > 4 * DAY) { a.status = 'void'; a.settled = now.toISOString(); }
}
export function accaStats(items) {
  const done = items.filter((a) => a.status === 'won' || a.status === 'lost');
  const agg = (xs) => { const won = xs.filter((a) => a.status === 'won').length; return { n: xs.length, won, rate: xs.length ? r3(won / xs.length) : null, expected: xs.length ? r3(xs.reduce((s, a) => s + a.prob, 0) / xs.length) : null }; };
  const by = (f) => { const g = {}; for (const a of done) (g[f(a)] ||= []).push(a); return Object.fromEntries(Object.entries(g).map(([k, v]) => [k, agg(v)])); };
  return { settled: done.length, pending: items.filter((a) => a.status === 'pending').length, overall: agg(done), byGrade: by((a) => a.grade), byLegs: by((a) => (a.n >= 5 ? '5+' : String(a.n))), byWindow: by((a) => a.window) };
}
export function updateAccas(prev, preds, now = new Date()) {
  const byId = new Map(preds.map((p) => [p.id, p]));
  const items = new Map((prev?.items || []).map((a) => [a.id, structuredClone(a)])); // clone: never mutate the caller's data
  for (const a of items.values()) settleAcca(a, byId, now);
  const pending = dropDuplicatePending(preds.filter((p) => p.status === 'pending' && p.pk && new Date(p.kickoff) > now && (p.games ?? 0) >= MIN_GAMES));
  for (const w of windows(now)) {
    const pool = pending.filter((p) => w.days.includes(dayKey(p.kickoff)));
    for (const a of buildWindow(w, pool, now)) {
      const ex = items.get(a.id);
      if (ex && (ex.status !== 'pending' || ex.legs.some((l) => new Date(l.kickoff) <= now))) continue; // frozen once a match has started
      items.set(a.id, a);
    }
  }
  const list = [...items.values()].filter((a) => now - new Date(a.lastKickoff) < 45 * DAY).sort((a, b) => a.lastKickoff.localeCompare(b.lastKickoff) || a.odds - b.odds);
  return { updated: now.toISOString(), items: list, stats: accaStats(list) };
}
