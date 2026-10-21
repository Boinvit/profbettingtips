// football-data.org v4 (free tier: 12 competitions, 10 req/min). Needs FOOTBALL_DATA_API_KEY.
const BASE = 'https://api.football-data.org/v4';
export const COMPETITIONS = ['PL', 'ELC', 'BL1', 'SA', 'PD', 'FL1', 'DED', 'PPL', 'CL', 'BSA', 'EC', 'WC'];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function get(pathAndQuery, key) {
  for (let attempt = 0; attempt < 3; attempt++) {
    const res = await fetch(BASE + pathAndQuery, { headers: { 'X-Auth-Token': key } });
    if (res.status === 429) { await sleep(65000); continue; }
    if (!res.ok) return { error: res.status };
    return res.json();
  }
  return { error: 429 };
}

const toMatch = (m, comp) => ({
  c: comp, d: m.utcDate,
  hn: m.homeTeam.name, an: m.awayTeam.name,
  hg: m.score?.fullTime?.home, ag: m.score?.fullTime?.away, status: m.status,
});

/** Fetch all matches for competitions in a date window (or a season). Returns {finished, upcoming}. */
export async function fetchWindow({ key, comps = COMPETITIONS, from, to, season, log = console.log }) {
  const finished = [], upcoming = [];
  for (const c of comps) {
    const q = season ? `?season=${season}` : `?dateFrom=${from}&dateTo=${to}`;
    const data = await get(`/competitions/${c}/matches${q}`, key);
    await sleep(6500); // stay under 10 requests/minute
    if (data.error) { log(`  ${c}: skipped (HTTP ${data.error})`); continue; }
    let f = 0, u = 0;
    for (const m of data.matches || []) {
      const x = toMatch(m, c);
      if (m.status === 'FINISHED' && Number.isInteger(x.hg) && Number.isInteger(x.ag)) { finished.push(x); f++; }
      else if (['SCHEDULED', 'TIMED'].includes(m.status)) { upcoming.push(x); u++; }
    }
    log(`  ${c}: ${f} finished, ${u} upcoming`);
  }
  return { finished, upcoming };
}
