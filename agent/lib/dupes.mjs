// The same fixture can arrive under two team spellings from different sources (e.g. "SV Elversberg" vs "SV 07 Elversberg").
// Detects such pairs by kickoff time plus a shared distinctive word in BOTH team names, so slips and the site never count one match twice.
const GENERIC = new Set(['united', 'city', 'real', 'club', 'sporting', 'athletic', 'borussia', 'union', 'sport', 'town', 'rovers', 'wanderers', 'inter', 'deportivo', 'atletico']);
const words = (s) => new Set(String(s || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z ]/g, ' ').split(/\s+/).filter((w) => w.length >= 4 && !GENERIC.has(w)));
const share = (a, b) => { const B = words(b); for (const w of words(a)) if (B.has(w)) return true; return false; };
export function sameFixture(a, b) {
  if (a === b) return false;
  if (Math.abs(+new Date(a.kickoff) - +new Date(b.kickoff)) > 36 * 3600e3) return false; // same fixture can carry a placeholder date in one source
  return share(a.home, b.home) && share(a.away, b.away);
}
/** Keep one prediction per real fixture among the pending ones (more history first, then earlier-created). Settled ones are never touched. */
export function dropDuplicatePending(preds) {
  const pend = preds.filter((p) => p.status === 'pending'), drop = new Set();
  for (let i = 0; i < pend.length; i++) for (let j = i + 1; j < pend.length; j++) {
    const a = pend[i], b = pend[j];
    if (drop.has(a) || drop.has(b) || !sameFixture(a, b)) continue;
    const oa = a.ctx?.odds ? 1 : 0, ob = b.ctx?.odds ? 1 : 0; // prefer the entry backed by real bookmaker odds (authoritative schedule)
    const keepA = oa !== ob ? oa > ob : (a.games ?? 0) !== (b.games ?? 0) ? (a.games ?? 0) > (b.games ?? 0) : String(a.created) <= String(b.created);
    drop.add(keepA ? b : a);
  }
  return drop.size ? preds.filter((p) => !drop.has(p)) : preds;
}
