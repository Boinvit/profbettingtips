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
      const result=(x.matchResults||[]).find(r=>r.resultTypeID===2) || (x.matchResults||[]).at(-1);
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
