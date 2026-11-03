// Result reconciliation with source trust tiers. A stored score is only replaced by a more trusted source.
// tier 1: authoritative (football-data.co.uk, football-data.org, API-Football)
// tier 2: supplemental, finished-only (OpenLigaDB, openfootball)
// tier 3: anything else. tier 0 (ex.s absent): legacy record with no provenance.
export const TIER = { fduk: 1, fdorg: 1, apif: 1, oldb: 2, ofb: 2 };
export const tierOf = (src) => TIER[src] || 3;

/** Compare an incoming finished result `f` with stored match `ex`. Mutates ex only on an allowed overwrite.
 *  Returns null when nothing differs, else a correction record {id, old, new, src, action, at}. */
export function reconcile(ex, f, at = new Date().toISOString()) {
  if (!Number.isInteger(f.hg) || !Number.isInteger(f.ag)) return null;
  const t = tierOf(f.src), cur = ex.s || 0;
  if (ex.hg === f.hg && ex.ag === f.ag) { if (!cur || t < cur) ex.s = t; return null; }
  const rec = { id: ex.id, old: `${ex.hg}-${ex.ag}`, new: `${f.hg}-${f.ag}`, src: f.src || 'unknown', at };
  const win = cur === 0 ? t === 1 : t < cur;
  if (win) { ex.hg = f.hg; ex.ag = f.ag; ex.s = t; return { ...rec, action: 'overwrite' }; }
  return { ...rec, action: t === cur ? 'conflict' : 'ignored-lower-tier' };
}

/** Append new corrections to the stored log, skipping exact repeats, keeping the last 500. */
export function mergeCorrections(old, fresh) {
  const key = (c) => `${c.id}|${c.new}|${c.src}|${c.action}`;
  const seen = new Set((old || []).map(key));
  const add = fresh.filter((c) => !seen.has(key(c)));
  return { list: [...(old || []), ...add].slice(-500), added: add.length };
}
