// openfootball (public domain, https://github.com/openfootball): full-season fixtures + results.
// Fills the coverage gap left by sources that only list the next round or two (e.g. EPL, La Liga, Serie A).
// Text format:  "▪ Matchday 1" / "  Fri Aug 21 2026" / "    20:00  Arsenal FC   v Coventry City FC   3-0 (2-0)"
const BASE = 'https://raw.githubusercontent.com/openfootball';
const DAY = 86400000;
export const OF_LEAGUES = [
  { c: 'E0',  repo: 'england', file: '1-premierleague.txt', tz: 'Europe/London' },
  { c: 'E1',  repo: 'england', file: '2-championship.txt',  tz: 'Europe/London' },
  { c: 'SP1', repo: 'espana',  file: '1-liga.txt',          tz: 'Europe/Madrid' },
  { c: 'I1',  repo: 'italy',   file: '1-seriea.txt',        tz: 'Europe/Rome' },
];
const MON = { jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5, jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11 };

/** Local wall-clock time in an IANA zone -> UTC Date (DST-safe). */
export function zonedToUtc(y, m, d, hh, mm, tz) {
  const wall = Date.UTC(y, m, d, hh, mm);
  let t = wall;
  for (let i = 0; i < 2; i++) {
    const parts = new Intl.DateTimeFormat('en-GB', { timeZone: tz, hourCycle: 'h23', year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric' }).formatToParts(new Date(t));
    const g = (k) => +parts.find((p) => p.type === k).value;
    t += wall - Date.UTC(g('year'), g('month') - 1, g('day'), g('hour'), g('minute'));
  }
  return new Date(t);
}

/** Parse one league file -> [{ d(ISO UTC), hn, an, hg?, ag? }]. Matches with no listed time default to 15:00 local. */
export function parseOpenFootball(text, { tz, startYear, defaultTime = [15, 0] }) {
  const out = []; let y = null, mo = null, d = null;
  for (const raw of String(text).split(/\r?\n/)) {
    const line = raw.replace(/#.*$/, '').replace(/\[[^\]]*\]/g, '').trimEnd();
    if (!line.trim()) continue;
    const dm = line.match(/^\s*(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun)\s+([A-Za-z]{3})\s+(\d{1,2})(?:\s+(\d{4}))?\s*$/);
    if (dm) { mo = MON[dm[1].toLowerCase()]; d = +dm[2]; y = dm[3] ? +dm[3] : (mo >= 6 ? startYear : startYear + 1); continue; }
    const m = line.match(/^\s+(?:(\d{1,2})[:.](\d{2})\s+)?(.+?)\s+v\s+(.+?)(?:\s+(\d+)-(\d+)(?:\s*\(.*?\))?)?\s*$/);
    if (!m || d === null || mo === undefined) continue;
    const [hh, mm] = m[1] ? [+m[1], +m[2]] : defaultTime;
    const rec = { d: zonedToUtc(y, mo, d, hh, mm, tz).toISOString(), hn: m[3].trim(), an: m[4].trim() };
    if (m[5] !== undefined) { rec.hg = +m[5]; rec.ag = +m[6]; }
    out.push(rec);
  }
  return out;
}

export async function fetchOpenFootball({ now = new Date(), leagues = OF_LEAGUES, horizonDays = 14, health = [], log = console.log, fetchText } = {}) {
  const startYear = now.getUTCMonth() >= 6 ? now.getUTCFullYear() : now.getUTCFullYear() - 1;
  const season = `${startYear}-${String(startYear + 1).slice(2)}`;
  const get = fetchText || (async (u) => {
    const r = await fetch(u, { signal: AbortSignal.timeout(20000), headers: { 'user-agent': 'ProfBettingTipsBot/1.0' } });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return r.text();
  });
  const finished = [], upcoming = [], bad = [];
  for (const L of leagues) {
    try {
      const rows = parseOpenFootball(await get(`${BASE}/${L.repo}/master/${season}/${L.file}`), { tz: L.tz, startYear });
      for (const x of rows) {
        const t = new Date(x.d), scored = Number.isInteger(x.hg) && Number.isInteger(x.ag);
        if (scored && t <= now) finished.push({ c: L.c, d: x.d, hn: x.hn, an: x.an, hg: x.hg, ag: x.ag });
        else if (!scored && t > now && t - now <= horizonDays * DAY) upcoming.push({ c: L.c, d: x.d, hn: x.hn, an: x.an });
      }
    } catch (e) { bad.push(`${L.c}: ${e.message}`); }
  }
  const ok = bad.length < leagues.length && finished.length + upcoming.length > 0;
  const detail = `${finished.length} results, ${upcoming.length} fixtures next ${horizonDays}d` + (bad.length ? ` (failed: ${bad.join('; ')})` : '');
  health.push({ source: 'openfootball', ok, detail });
  log(`  openfootball: ${detail}`);
  return { finished, upcoming };
}
