// ClubElo (http://clubelo.com/API): global club ratings as CSV, one request per day. Free.
import { parseCsv } from './csv.mjs';
export const clubEloUrl = (d) => `http://api.clubelo.com/${d}`;
export function parseClubElo(text) {
  return parseCsv(text).map((r) => ({ name: r.Club, country: r.Country, elo: parseFloat(r.Elo) })).filter((r) => r.name && Number.isFinite(r.elo));
}
export async function fetchClubElo({ now = new Date(), health = [], log = console.log, fetchText } = {}) {
  const get = fetchText || (async (u) => { const r = await fetch(u); if (!r.ok) throw new Error('HTTP ' + r.status); return r.text(); });
  try {
    const rows = parseClubElo(await get(clubEloUrl(now.toISOString().slice(0, 10))));
    health.push({ source: 'ClubElo', ok: rows.length > 0, detail: `${rows.length} club ratings` });
    return rows;
  } catch (e) { log(`  clubelo: ${e.message}`); health.push({ source: 'ClubElo', ok: false, detail: e.message }); return []; }
}
