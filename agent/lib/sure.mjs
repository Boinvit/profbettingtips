// 'Only sure, well-researched matches': data checks plus a bookmaker cross-check, shared by the accumulator and long-shot builders.
export const MIN_GAMES = 20, MIN_FORM = 5;
const YOUTH = /\b(U-?(1[5-9]|2[0-3])|youth|reserves?)\b|[ ](II|III)$/i; // squads rotate, little reliable history
export const isYouth = (p) => YOUTH.test(p.home || '') || YOUTH.test(p.away || '');

/** Reasons this match must not be listed (empty = fine). Fields missing on old records are not held against them. */
export function dataGaps(p) {
  const out = [];
  if (isYouth(p)) out.push('youth or reserve side');
  if (p.games != null && p.games < MIN_GAMES) out.push(`thin data (${p.games} games for the less-known team)`);
  if (Array.isArray(p.form) && p.form.some((f) => String(f || '').length < MIN_FORM)) out.push('no recent form for one team');
  return out;
}
export const isTrusted = (p) => dataGaps(p).length === 0;

/** De-vigged bookmaker probability for 1X2 and double-chance legs; null when there are no three-way odds. */
export function marketProb(p, l) {
  const o = p.ctx && p.ctx.odds;
  if (!Array.isArray(o) || o.length !== 3 || !o.every((x) => Number(x) > 1)) return null;
  const q = o.map((x) => 1 / Number(x)), s = q[0] + q[1] + q[2], pr = q.map((x) => x / s);
  if (l.mkt === 'x12') return { H: pr[0], D: pr[1], A: pr[2] }[l.sel] ?? null;
  if (l.mkt === 'dc') return l.sel === '1X' ? pr[0] + pr[1] : l.sel === 'X2' ? pr[1] + pr[2] : pr[0] + pr[2];
  return null;
}

/** When the market is less sure than the model, believe the market: take the lower of the two. */
export function marketCapped(p, l) {
  const m = marketProb(p, l);
  return m != null && m < l.p ? { ...l, pm: l.p, p: m, capped: true } : l;
}
