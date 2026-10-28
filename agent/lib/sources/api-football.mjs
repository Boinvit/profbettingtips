// API-Football (API-Sports). Requires API_FOOTBALL_KEY; coverage and history depend on plan.
const BASE = 'https://v3.football.api-sports.io';
const day = (d) => d.toISOString().slice(0, 10);
async function request(url, key) {
  const res = await fetch(url, { headers: { 'x-apisports-key': key }, signal: AbortSignal.timeout(20000) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const json = await res.json();
  if (json.errors && Object.keys(json.errors).length) throw new Error(JSON.stringify(json.errors));
  return json.response || [];
}
export async function fetchApiFootball({ key, now = new Date(), from = day(new Date(now.getTime()-2*86400000)), to = day(new Date(now.getTime()+7*86400000)), health = [], log = console.log } = {}) {
  if (!key) { health.push({ source: 'API-Football', ok: false, detail: 'no API_FOOTBALL_KEY (optional)' }); return { finished: [], upcoming: [] }; }
  try {
    const rows = await request(`${BASE}/fixtures?from=${from}&to=${to}&timezone=UTC`, key);
    const finished = [], upcoming = [];
    for (const x of rows) {
      const hn=x.teams?.home?.name, an=x.teams?.away?.name, d=x.fixture?.date;
      if (!hn || !an || !d) continue;
      const c = x.league?.name || 'API-Football';
      const status = x.fixture?.status?.short;
      if (['FT','AET','PEN'].includes(status) && Number.isInteger(x.goals?.home) && Number.isInteger(x.goals?.away))
        finished.push({ c, d, hn, an, hg:x.goals.home, ag:x.goals.away });
      else if (['NS','TBD','PST'].includes(status) && new Date(d) > now)
        upcoming.push({ c, d, hn, an });
    }
    health.push({ source:'API-Football', ok:true, detail:`${finished.length} results, ${upcoming.length} fixtures` });
    log(`  API-Football: ${finished.length} results, ${upcoming.length} fixtures`);
    return { finished, upcoming };
  } catch(e) {
    health.push({ source:'API-Football', ok:false, detail:e.message });
    return { finished:[], upcoming:[] };
  }
}
