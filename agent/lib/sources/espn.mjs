// ESPN public scoreboards: fast, free results for any league, used ONLY to settle matches we already have overdue predictions on.
// One 'all soccer' scoreboard per day. Full-time scores only, so live or extra-time scores are never stored.
const UA = 'Mozilla/5.0 (compatible; prediction-agent)';
const FINAL = new Set(['STATUS_FULL_TIME', 'STATUS_FINAL']);
const HOUR = 3600e3, DAY = 864e5;
const ymd = (t) => new Date(t).toISOString().slice(0, 10).split('-').join('');

/** Pending predictions whose kickoff was over 2.5 hours ago (and under 14 days ago). */
export function overdueFor(preds, now) {
  return preds.filter((p) => p.status === 'pending' && Date.parse(p.kickoff) < now.getTime() - 2.5 * HOUR && Date.parse(p.kickoff) > now.getTime() - 14 * DAY);
}

/** The scoreboard days to read: each overdue kickoff day and its neighbours (US-evening games fall on the next UTC day). Newest first, capped. */
export function datesFor(overdue, cap = 24) {
  const s = new Set();
  for (const p of overdue) { const k = Date.parse(p.kickoff); for (const off of [-1, 0, 1]) s.add(ymd(k + off * DAY)); }
  return [...s].sort().reverse().slice(0, cap);
}

/** Finished ESPN events that match an overdue prediction (same teams, same orientation, within 2 days). Emits our own team names so ids line up.
 *  partial = ESPN names to alias: one side matched a team we have an overdue prediction on, the other did not. */
export function matchEvents(events, overdue, resolve) {
  const byPair = new Map();
  for (const p of overdue) { const k = p.h + '|' + p.a; if (!byPair.has(k)) byPair.set(k, []); byPair.get(k).push(p); }
  const teams = new Set(overdue.flatMap((p) => [p.h, p.a]));
  const finished = [], seen = new Set(), partial = new Set();
  for (const e of events) {
    const c = e.competitions && e.competitions[0];
    if (!c || !c.status || !c.status.type || !c.status.type.completed || !FINAL.has(c.status.type.name)) continue;
    const h = (c.competitors || []).find((x) => x.homeAway === 'home'), a = (c.competitors || []).find((x) => x.homeAway === 'away');
    if (!h || !a) continue;
    const hg = Number(h.score), ag = Number(a.score);
    if (!Number.isInteger(hg) || !Number.isInteger(ag)) continue;
    const hn = h.team.displayName, an = a.team.displayName, hId = resolve(hn), aId = resolve(an);
    if (hId && aId) {
      for (const p of byPair.get(hId + '|' + aId) || []) {
        if (seen.has(p.id) || Math.abs(Date.parse(e.date) - Date.parse(p.kickoff)) > 2 * DAY) continue;
        seen.add(p.id); finished.push({ c: p.comp, d: e.date, hn: p.home, an: p.away, hg, ag });
      }
    } else if ((hId && teams.has(hId)) || (aId && teams.has(aId))) partial.add(hId ? an : hn);
  }
  return { finished, partial: [...partial] };
}

export async function fetchEspn({ now = new Date(), preds = [], registry, health = [], log = console.log, fetchImpl = globalThis.fetch } = {}) {
  const overdue = overdueFor(preds, now);
  if (!overdue.length) { health.push({ source: 'ESPN', ok: true, detail: 'nothing overdue' }); return { finished: [], upcoming: [] }; }
  const dates = datesFor(overdue), events = []; let failed = 0;
  for (const d of dates) {
    try {
      const r = await fetchImpl(`https://site.api.espn.com/apis/site/v2/sports/soccer/all/scoreboard?dates=${d}&limit=1000`, { headers: { 'user-agent': UA } });
      if (!r.ok) { failed++; continue; }
      events.push(...((await r.json()).events || []));
    } catch (e) { failed++; }
    await new Promise((res) => setTimeout(res, 120));
  }
  const { finished, partial } = matchEvents(events, overdue, (n) => registry.resolve(n, false));
  const detail = `${finished.length} of ${overdue.length} overdue settled; ${dates.length - failed}/${dates.length} days read; names to alias: ${partial.slice(0, 12).join(' | ') || 'none'}`;
  health.push({ source: 'ESPN', ok: failed < dates.length, detail }); log('  ESPN: ' + detail);
  return { finished, upcoming: [] };
}
