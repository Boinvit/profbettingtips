// SportPesa pages are rendered client-side from JSON APIs. The scraper (agent/scrape-sportpesa.mjs) loads a page in a
// real browser, records every JSON response plus the visible text, and these pure functions pull out fixtures.
// They are deliberately tolerant of shape changes (walk any JSON for "team A vs team B" structures).
const PAIR_KEYS = [['homeTeam', 'awayTeam'], ['home', 'awayTeam'], ['homeTeamName', 'awayTeamName'], ['home_team', 'away_team'], ['team1', 'team2'], ['competitor1', 'competitor2'], ['homeName', 'awayName'], ['home', 'away']];
const DATE_KEYS = ['startTime', 'start_time', 'kickoff', 'kickOff', 'kickoffTime', 'date', 'startDate', 'eventDate', 'dateTime', 'matchTime', 'time'];
const CLOSE_KEYS = ['closeTime', 'closeDate', 'closingTime', 'endDate', 'endTime', 'deadline', 'expiry', 'closesAt'];
const SEP = /^(.{2,40}?)\s+(?:vs\.?|v|-|–|—)\s+(.{2,40})$/i;
const nameOf = (v) => (typeof v === 'string' ? v : v && typeof v === 'object' ? v.name || v.shortName || v.title || v.teamName : null);
const asIso = (v) => {
  if (v == null) return null;
  const d = typeof v === 'number' ? new Date(v < 1e12 ? v * 1000 : v) : new Date(v);
  return !isNaN(d) && d.getUTCFullYear() > 2020 && d.getUTCFullYear() < 2100 ? d.toISOString() : null;
};

export function extractFromJson(root) {
  const out = [], seen = new Set(); let closes = null, prize = null;
  const push = (home, away, o, league) => {
    home = String(home).trim(); away = String(away).trim();
    if (!home || !away || home === away || home.length > 45 || away.length > 45) return;
    const k = `${home}|${away}`.toLowerCase(); if (seen.has(k)) return; seen.add(k);
    let kickoff = null; for (const dk of DATE_KEYS) if ((kickoff = asIso(o[dk]))) break;
    out.push({ home, away, kickoff, league: league || null });
  };
  const walk = (o, league, depth = 0) => {
    if (!o || typeof o !== 'object' || depth > 12) return;
    if (Array.isArray(o)) { for (const x of o) walk(x, league, depth + 1); return; }
    for (const ck of CLOSE_KEYS) if (!closes && asIso(o[ck])) closes = asIso(o[ck]);
    if (!prize) for (const pk of ['prize', 'jackpotAmount', 'amount', 'jackpot']) if (typeof o[pk] === 'number' && o[pk] > 100000) prize = 'KES ' + o[pk].toLocaleString('en-US');
    const lg = nameOf(o.league) || nameOf(o.competition) || nameOf(o.tournament) || league;
    let matched = false;
    for (const [a, b] of PAIR_KEYS) { const h = nameOf(o[a]), w = nameOf(o[b]); if (h && w) { push(h, w, o, lg); matched = true; break; } }
    if (!matched && Array.isArray(o.competitors) && o.competitors.length === 2 && nameOf(o.competitors[0]) && nameOf(o.competitors[1])) { push(nameOf(o.competitors[0]), nameOf(o.competitors[1]), o, lg); matched = true; }
    if (!matched) for (const nk of ['name', 'eventName', 'title', 'matchName', 'fixture']) {
      const m = typeof o[nk] === 'string' && o[nk].match(SEP);
      if (m && (o.id != null || o.eventId != null || o.markets || o.startTime || o.date)) { push(m[1], m[2], o, lg); matched = true; break; }
    }
    for (const v of Object.values(o)) if (v && typeof v === 'object') walk(v, lg, depth + 1);
  };
  walk(root);
  return { matches: out, closes, prize };
}

/** Fallback: page text lines like "Arsenal - Chelsea" or "Arsenal v Chelsea" (also 2-line "Home\nAway" is NOT guessed). */
export function extractFromText(text) {
  const out = [], seen = new Set();
  for (const raw of String(text).split(/\r?\n/)) {
    const m = raw.trim().replace(/^\d{1,2}[.)]\s*/, '').match(SEP);
    if (!m || /\d{2}:\d{2}|http|bet|odds|%/i.test(raw)) continue;
    const k = (m[1] + m[2]).toLowerCase(); if (seen.has(k)) continue; seen.add(k);
    out.push({ home: m[1].trim(), away: m[2].trim(), kickoff: null, league: null });
  }
  return { matches: out };
}

/** Combine captured JSON responses + page text into the best fixture list for one page. */
export function bestFixtures(jsonBodies, text) {
  let best = { matches: [], closes: null, prize: null };
  for (const b of jsonBodies) { const r = extractFromJson(b); if (r.matches.length > best.matches.length) best = { ...r, source: 'json' }; }
  if (best.matches.length < 3) { const t = extractFromText(text); if (t.matches.length > best.matches.length) best = { ...t, closes: best.closes, prize: best.prize, source: 'text' }; }
  if (!best.prize) { const m = String(text).match(/KES\s?([\d,]{9,})/); if (m) best.prize = 'KES ' + m[1]; }
  return best;
}
