// Team dossiers + match briefs. Pure functions over stored results (matches + history) and stored news signals.
// Every line in a brief is computed from numbers, never generated: if the data is thin, the brief says so.
const DAY = 86400000;
const r2 = (x) => Math.round(x * 100) / 100;

export function indexMatches(matches) {
  const by = new Map();
  const push = (t, rec) => { let a = by.get(t); if (!a) by.set(t, (a = [])); a.push(rec); };
  for (const m of matches) {
    const t = Date.parse(m.d);
    if (!Number.isFinite(t) || !Number.isInteger(m.hg) || !Number.isInteger(m.ag)) continue;
    push(m.h, { t, opp: m.a, home: true, gf: m.hg, ga: m.ag });
    push(m.a, { t, opp: m.h, home: false, gf: m.ag, ga: m.hg });
  }
  for (const a of by.values()) a.sort((x, y) => x.t - y.t);
  return by;
}

const pts = (r) => (r.gf > r.ga ? 3 : r.gf === r.ga ? 1 : 0);
const letter = (r) => (r.gf > r.ga ? 'W' : r.gf === r.ga ? 'D' : 'L');

export function summarize(rs) {
  const n = rs.length;
  if (!n) return { n: 0 };
  const sum = (f) => rs.reduce((s, r) => s + f(r), 0);
  return {
    n, form: rs.map(letter).join(''), ppg: r2(sum(pts) / n), gf: r2(sum((r) => r.gf) / n), ga: r2(sum((r) => r.ga) / n),
    cs: r2(sum((r) => (r.ga === 0 ? 1 : 0)) / n), fts: r2(sum((r) => (r.gf === 0 ? 1 : 0)) / n),
    btts: r2(sum((r) => (r.gf > 0 && r.ga > 0 ? 1 : 0)) / n), o25: r2(sum((r) => (r.gf + r.ga > 2.5 ? 1 : 0)) / n),
  };
}

/** Everything known about one team before `asOf`; `venue` ('home'|'away') adds the venue-specific split. */
export function dossier(by, team, asOf, venue) {
  const all = (by.get(team) || []).filter((r) => r.t < asOf);
  const l5 = all.slice(-5), p5 = all.slice(-10, -5);
  const vr = venue ? all.filter((r) => r.home === (venue === 'home')).slice(-8) : [];
  return {
    games: all.length, last10: summarize(all.slice(-10)), last5: summarize(l5),
    trend: l5.length >= 4 && p5.length >= 3 ? r2(summarize(l5).ppg - summarize(p5).ppg) : null,
    venue: summarize(vr), restDays: all.length ? Math.floor((asOf - all[all.length - 1].t) / DAY) : null,
  };
}

/** Meetings between a and b before asOf, from a's point of view, newest first. */
export function headToHead(by, a, b, asOf, n = 6) {
  const rs = (by.get(a) || []).filter((r) => r.opp === b && r.t < asOf).slice(-n).reverse();
  const w = rs.filter((r) => r.gf > r.ga).length, l = rs.filter((r) => r.gf < r.ga).length;
  return { n: rs.length, w, d: rs.length - w - l, l, gf: rs.reduce((s, r) => s + r.gf, 0), ga: rs.reduce((s, r) => s + r.ga, 0) };
}

// news.json flags are '+' / '\u2212' signs and `adj` is the net rating adjustment (Elo points). Headlines are matched by
// team-name keyword, so some belong to other clubs: we use only the net adjustment, and only when it is large.
export function newsOf(news, team) {
  const e = news && news[team];
  if (!e) return { adj: 0, flags: [] };
  return { adj: Number.isFinite(e.adj) ? e.adj : 0, flags: Array.isArray(e.flags) ? e.flags.map(String) : [] };
}

/** Deterministic factor list: each entry says which outcome it leans toward and shows its numbers. */
export function factors({ hn, an, hd, ad, h2h, nH, nA }) {
  const out = [], add = (k, lean, text) => out.push({ k, lean, text });
  if (hd.last5.n >= 4 && ad.last5.n >= 4) {
    const d = hd.last5.ppg - ad.last5.ppg;
    if (Math.abs(d) >= 0.8) add('Form', d > 0 ? 'H' : 'A', `Last 5: ${hn} ${hd.last5.form} (${hd.last5.ppg} pts/game) vs ${an} ${ad.last5.form} (${ad.last5.ppg})`);
  }
  if (hd.venue.n >= 4 && ad.venue.n >= 4) {
    const d = hd.venue.ppg - ad.venue.ppg;
    if (Math.abs(d) >= 0.7) add('Venue', d > 0 ? 'H' : 'A', `${hn} at home ${hd.venue.ppg} pts/game (${hd.venue.n} games); ${an} away ${ad.venue.ppg} (${ad.venue.n} games)`);
  }
  if (hd.last10.n >= 6 && ad.last10.n >= 6) {
    const g = (hd.last10.gf + hd.last10.ga + ad.last10.gf + ad.last10.ga) / 2;
    if (g >= 3.0) add('Goals', 'O', `Recent games of both sides average ${r2(g)} total goals (last 10 each): leans over 2.5`);
    else if (g <= 2.2) add('Goals', 'U', `Recent games of both sides average ${r2(g)} total goals (last 10 each): leans under 2.5`);
    if (hd.last10.btts >= 0.6 && ad.last10.btts >= 0.6) add('BTTS', 'B', `Both teams scored and conceded in ${Math.round(hd.last10.btts * 100)}% (${hn}) and ${Math.round(ad.last10.btts * 100)}% (${an}) of recent games`);
  }
  if (hd.restDays != null && ad.restDays != null && Math.abs(hd.restDays - ad.restDays) >= 3 && Math.min(hd.restDays, ad.restDays) <= 3) {
    const more = hd.restDays > ad.restDays ? 'H' : 'A';
    add('Rest', more, `${hn} ${hd.restDays} days since last game; ${an} ${ad.restDays}: short turnaround for the less rested side`);
  }
  if (h2h.n >= 3 && (h2h.w >= Math.ceil((2 * h2h.n) / 3) || h2h.l >= Math.ceil((2 * h2h.n) / 3))) {
    add('H2H', h2h.w > h2h.l ? 'H' : 'A', `Last ${h2h.n} meetings: ${hn} W${h2h.w} D${h2h.d} L${h2h.l}, goals ${h2h.gf}-${h2h.ga}`);
  }
  for (const [nm, nw, side] of [[hn, nH, 'H'], [an, nA, 'A']]) {
    if (!nw || !(Math.abs(nw.adj) >= 10)) continue;
    const neg = nw.flags.filter((x) => x === '\u2212' || x === '-').length, pos = nw.flags.filter((x) => x === '+').length;
    add('News', (nw.adj > 0) === (side === 'H') ? 'H' : 'A', `${nm}: headline signal ${nw.adj > 0 ? '+' : ''}${nw.adj} rating points (${neg} negative, ${pos} positive headlines; unverified, headlines can concern other clubs)`);
  }
  return out;
}

export function brief(by, news, p) {
  const asOf = Date.parse(p.kickoff);
  const hd = dossier(by, p.h, asOf, 'home'), ad = dossier(by, p.a, asOf, 'away');
  const h2h = headToHead(by, p.h, p.a, asOf);
  const f = factors({ hn: p.home, an: p.away, hd, ad, h2h, nH: newsOf(news, p.h), nA: newsOf(news, p.a) });
  const thin = Math.min(hd.games, ad.games) < 8;
  const cnt = (l) => f.filter((x) => x.lean === l).length;
  return {
    id: p.id || `${p.kickoff}|${p.h}|${p.a}`, kickoff: p.kickoff, home: p.home, away: p.away, comp: p.comp,
    pick: p.pk && p.pk.x12 ? { x12: p.pk.x12, p: p.pk.x12p } : null,
    for: { H: cnt('H'), A: cnt('A'), over: cnt('O'), under: cnt('U'), btts: cnt('B') },
    factors: f, h2h, home_: hd, away_: ad,
    caveat: thin ? `Limited history (${p.home}: ${hd.games} games, ${p.away}: ${ad.games}); treat this brief with caution` : f.length ? null : 'No strong signals in the recent data: the match looks balanced on these measures',
  };
}

export function buildIntel({ matches, preds, news, now = new Date(), horizonDays = 3, cap = 400 }) {
  const by = indexMatches(matches);
  const t0 = now.getTime(), t1 = t0 + horizonDays * DAY;
  const ps = (preds || []).filter((p) => p.status === 'pending' && p.h && p.a && Date.parse(p.kickoff) >= t0 && Date.parse(p.kickoff) <= t1)
    .sort((x, y) => x.kickoff.localeCompare(y.kickoff)).slice(0, cap);
  return { updated: now.toISOString(), horizonDays, n: ps.length, matches: ps.map((p) => brief(by, news, p)) };
}
