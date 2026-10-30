// API-Football (API-Sports). Needs API_FOOTBALL_KEY (kept in a GitHub Actions secret, never in the repo).
// The free plan rejects from/to ranges, so we make one `date=` request per day (3 per run: the free plan only serves yesterday-today-tomorrow, and allows 100/day).
// Only mapped leagues are kept, labelled with the same codes the model already uses, so league statistics stay unified.
const BASE = 'https://v3.football.api-sports.io';
export const AF_LEAGUES = {
  39: 'E0', 40: 'E1', 41: 'E2', 42: 'E3', 43: 'EC', 179: 'SC0', 180: 'SC1', 78: 'D1', 79: 'D2', 135: 'I1', 136: 'I2',
  140: 'SP1', 141: 'SP2', 61: 'F1', 62: 'F2', 88: 'N1', 144: 'B1', 94: 'P1', 203: 'T1', 197: 'G1',
  128: 'ARG', 218: 'AUT', 71: 'BRA', 169: 'CHN', 119: 'DNK', 244: 'FIN', 357: 'IRL', 98: 'JPN', 262: 'MEX', 103: 'NOR',
  106: 'POL', 283: 'ROU', 235: 'RUS', 113: 'SWE', 207: 'SWZ', 253: 'USA', 2: 'CL', 3: 'EL', 848: 'ECL',
};
const DAY = 86400000;
const iso = (d) => d.toISOString().slice(0, 10);
async function request(url, key) {
  const res = await fetch(url, { headers: { 'x-apisports-key': key }, signal: AbortSignal.timeout(20000) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const json = await res.json();
  if (json.errors && Object.keys(json.errors).length) throw new Error(JSON.stringify(json.errors));
  return json.response || [];
}
export async function fetchApiFootball({ key, now = new Date(), daysBack = 1, daysAhead = 1, leagues = AF_LEAGUES, health = [], log = console.log, request: req = request } = {}) {
  if (!key) { health.push({ source: 'API-Football', ok: false, detail: 'no API_FOOTBALL_KEY (optional)' }); return { finished: [], upcoming: [] }; }
  const finished = [], upcoming = [], bad = [];
  for (let i = -daysBack; i <= daysAhead; i++) {
    const date = iso(new Date(now.getTime() + i * DAY));
    try {
      for (const x of await req(`${BASE}/fixtures?date=${date}`, key)) {
        const c = leagues[x.league?.id], hn = x.teams?.home?.name, an = x.teams?.away?.name, d = x.fixture?.date;
        if (!c || !hn || !an || !d) continue;
        const st = x.fixture?.status?.short;
        if (['FT', 'AET', 'PEN'].includes(st) && Number.isInteger(x.goals?.home) && Number.isInteger(x.goals?.away)) finished.push({ c, d, hn, an, hg: x.goals.home, ag: x.goals.away });
        else if (['NS', 'TBD'].includes(st) && new Date(d) > now) upcoming.push({ c, d, hn, an });
      }
    } catch (e) { bad.push(`${date}: ${e.message}`); if (/request|limit|rate/i.test(e.message)) break; }
  }
  const ok = bad.length === 0 || finished.length + upcoming.length > 0;
  const detail = `${finished.length} results, ${upcoming.length} fixtures` + (bad.length ? ` (issues: ${bad.slice(0, 2).join('; ').slice(0, 160)})` : '');
  health.push({ source: 'API-Football', ok, detail });
  log(`  API-Football: ${detail}`);
  return { finished, upcoming };
}
