// football-data.co.uk: free CSVs with results AND bookmaker odds, 20+ leagues incl. lower divisions.
// Main leagues:  /mmz4281/<season>/<DIV>.csv   (columns Div,Date,Time,HomeTeam,AwayTeam,FTHG,FTAG,...,AvgH,AvgD,AvgA,B365H..)
// Extra leagues: /new/<CODE>.csv               (columns Country,League,Season,Date,Time,Home,Away,HG,AG,Res,PH,PD,PA,AvgH..)
// Upcoming:      /fixtures.csv and /new_league_fixtures.csv (with odds)
import { parseCsv } from './csv.mjs';
const BASE = 'https://www.football-data.co.uk';
export const MAIN_DIVS = ['E0', 'E1', 'E2', 'E3', 'EC', 'SC0', 'SC1', 'SC2', 'SC3', 'D1', 'D2', 'I1', 'I2', 'SP1', 'SP2', 'F1', 'F2', 'N1', 'B1', 'P1', 'T1', 'G1'];
export const EXTRA = ['ARG', 'AUT', 'BRA', 'CHN', 'DNK', 'FIN', 'IRL', 'JPN', 'MEX', 'NOR', 'POL', 'ROU', 'RUS', 'SWE', 'SWZ', 'USA'];

const num = (x) => { const n = parseFloat(x); return Number.isFinite(n) ? n : null; };
export function parseDate(d, t) {
  const m = String(d).match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/); if (!m) return null;
  const y = m[3].length === 2 ? 2000 + +m[3] : +m[3];
  const [hh, mm] = /^\d{1,2}:\d{2}$/.test(t || '') ? t.split(':').map(Number) : [15, 0];
  return new Date(Date.UTC(y, +m[2] - 1, +m[1], hh, mm)).toISOString(); // source is UK time; <=1h skew is harmless here
}
export function pickOdds(r) {
  for (const p of ['Avg', 'B365', 'PS', 'P', 'Max', 'BW', 'WH']) {
    const o = [num(r[p + 'H']), num(r[p + 'D']), num(r[p + 'A'])];
    if (o.every((x) => x && x > 1.01)) return o.map((x) => +x.toFixed(3));
  }
  return null;
}
export function rowsToMatches(rows, comp) {
  const finished = [], upcoming = [];
  for (const r of rows) {
    const hn = r.HomeTeam || r.Home, an = r.AwayTeam || r.Away; if (!hn || !an) continue;
    const d = parseDate(r.Date, r.Time); if (!d) continue;
    const c = comp || r.Div || r.League || 'X';
    const hg = r.FTHG ?? r.HG, ag = r.FTAG ?? r.AG;
    const o = pickOdds(r);
    if (hg !== '' && hg != null && ag !== '' && ag != null && Number.isInteger(+hg) && Number.isInteger(+ag))
      finished.push({ c, d, hn, an, hg: +hg, ag: +ag, ...(o ? { o } : {}) });
    else upcoming.push({ c, d, hn, an, ...(o ? { o } : {}) });
  }
  return { finished, upcoming };
}

/** season code like '2526' for the season that started in `startYear`. */
export const seasonCode = (startYear) => String(startYear).slice(2) + String(startYear + 1).slice(2);

export async function fetchFduk({ now = new Date(), seasons = 1, backfill = false, log = console.log, health = [], fetchText = defaultFetch } = {}) {
  const startYear = now.getUTCMonth() >= 6 ? now.getUTCFullYear() : now.getUTCFullYear() - 1;
  const yrs = Array.from({ length: backfill ? 3 : seasons }, (_, i) => startYear - i);
  const out = { finished: [], upcoming: [] };
  const add = (r) => { out.finished.push(...r.finished); out.upcoming.push(...r.upcoming); };
  let ok = 0, fail = 0;
  const tryGet = async (url, comp, keepUpcoming = true, minDate) => {
    try {
      const rows = parseCsv(await fetchText(url));
      const r = rowsToMatches(rows, comp);
      if (minDate) r.finished = r.finished.filter((m) => m.d >= minDate), r.upcoming = r.upcoming.filter((m) => m.d >= minDate);
      if (!keepUpcoming) r.upcoming = [];
      add(r); ok++;
    } catch (e) { fail++; log(`  fduk ${url.replace(BASE, '')}: ${e.message}`); }
  };
  for (const y of yrs) for (const div of MAIN_DIVS) await tryGet(`${BASE}/mmz4281/${seasonCode(y)}/${div}.csv`, div, false);
  const minExtra = new Date(Date.UTC(startYear - (backfill ? 2 : 0), 6, 1)).toISOString();
  for (const code of EXTRA) await tryGet(`${BASE}/new/${code}.csv`, code, false, minExtra);
  await tryGet(`${BASE}/fixtures.csv`, null); await tryGet(`${BASE}/new_league_fixtures.csv`, null);
  health.push({ source: 'football-data.co.uk', ok: ok > 0, detail: `${ok} files ok, ${fail} failed; ${out.finished.length} results, ${out.upcoming.length} fixtures` });
  return out;
}
async function defaultFetch(url) {
  const res = await fetch(url, { headers: { 'User-Agent': 'pbt-prediction-lab (personal research)' } });
  if (!res.ok) throw new Error('HTTP ' + res.status);
  return res.text();
}
