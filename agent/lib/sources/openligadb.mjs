// OpenLigaDB public API. Best suited to supported German competitions; supplemental coverage only.
const BASE = 'https://api.openligadb.de';
export async function fetchOpenLigaDB({ now = new Date(), season = now.getUTCMonth() >= 6 ? now.getUTCFullYear() : now.getUTCFullYear()-1, health = [], log = console.log } = {}) {
  try {
    const res = await fetch(`${BASE}/getmatchdata/bl1/${season}`, { signal: AbortSignal.timeout(15000) });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const rows = await res.json(), finished=[], upcoming=[];
    for (const x of rows) {
      const hn=x.team1?.teamName, an=x.team2?.teamName, d=x.matchDateTimeUTC;
      if (!hn || !an || !d) continue;
      const result=finalScore(x); // only a FINISHED match has a final score (a live/half-time match must never be stored as a result)
      if (result && Number.isInteger(result.pointsTeam1) && Number.isInteger(result.pointsTeam2) && new Date(d) <= now)
        finished.push({ c:'D1', d, hn, an, hg:result.pointsTeam1, ag:result.pointsTeam2 });
      else if (new Date(d)>now && new Date(d)-now <= 14*86400000) upcoming.push({ c:'D1', d, hn, an });
    }
    health.push({ source:'OpenLigaDB', ok:true, detail:`${finished.length} results, ${upcoming.length} fixtures (German Bundesliga)` });
    log(`  OpenLigaDB: ${finished.length} results, ${upcoming.length} fixtures`);
    return { finished, upcoming };
  } catch(e) {
    health.push({ source:'OpenLigaDB', ok:false, detail:e.message });
    return { finished:[], upcoming:[] };
  }
}

/** The final (full-time) score of a match, or null while it is not finished. OpenLigaDB lists the half-time score (type 1) before the final (type 2);
 *  the old code fell back to the last listed result, so a match in progress was stored with its half-time score as if it had ended. */
export function finalScore(x) {
  if (!x || x.matchIsFinished !== true) return null;
  return (x.matchResults || []).find((r) => r.resultTypeID === 2) || null;
}
