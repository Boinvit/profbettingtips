#!/usr/bin/env node
// Prediction agent: ingest (many sources) -> settle -> learn -> predict -> publish JSON for the static site.
import fs from 'node:fs';
import path from 'node:path';
import { load, save, DATA } from './lib/store.mjs';
import { DEFAULT_PARAMS, replay, predict, picks, grade, outcome1x2 } from './lib/model.mjs';
import { tune } from './lib/learn.mjs';
import { computeStats } from './lib/stats.mjs';
import { Registry } from './lib/teams.mjs';
import { parseInbox, buildJackpots } from './lib/jackpot.mjs';
import { updateAccas } from './lib/accas.mjs';
import { dropDuplicatePending } from './lib/dupes.mjs';
import { splitHistory, parseBackfill } from './lib/history.mjs';

const MIN_TUNE_MATCHES = 150, RETUNE_EVERY = 30, DAY = 86400000;
const dayOf = (iso) => iso.slice(0, 10);
const pairKey = (h, a) => `${h}|${a}`;
const near = (list, iso, tol) => (list || []).find((m) => Math.abs(+new Date(m.d) - +new Date(iso)) <= tol);

/**
 * feed = { finished:[{c,d,hn,an,hg,ag,o?}], upcoming:[{c,d,hn,an,o?}], listed:[{home,away,kickoff,league}],
 *          scrapedJackpots:[{name,closes,prize,games}], clubelo:[{name,elo}], news:(teamName)=>Promise<{adj,flags,headlines}>, health:[] }
 */
export async function runOnce({ feed = {}, now = new Date(), log = console.log, forceTune = false } = {}) {
  const health = [...(feed.health || [])];
  const registry = new Registry(load('teams.json', {}), load('aliases.json', {}));
  let matches = [...load('history.json', []), ...load('matches.json', [])]; // deep history + recent window
  let preds = load('predictions.json', []);
  let model = load('model.json', { v: 1, params: { ...DEFAULT_PARAMS }, tunedOn: 0, history: [] });

  // 1. ingest results from every source; de-duplicate by (home, away, ±1 day), merging odds
  const pairs = new Map();
  for (const m of matches) { const k = pairKey(m.h, m.a); (pairs.get(k) || pairs.set(k, []).get(k)).push(m); }
  let added = 0;
  for (const f of feed.finished || []) {
    const h = registry.resolve(f.hn), a = registry.resolve(f.an);
    const ex = near(pairs.get(pairKey(h, a)), f.d, DAY * 1.2);
    if (ex) { if (!ex.o && f.o) ex.o = f.o; continue; }
    const m = { id: `${dayOf(f.d)}|${h}|${a}`, c: f.c, d: f.d, h, a, hg: f.hg, ag: f.ag, ...(f.o ? { o: f.o } : {}) };
    (pairs.get(pairKey(h, a)) || pairs.set(pairKey(h, a), []).get(pairKey(h, a))).push(m); matches.push(m); added++;
  }
  matches.sort((x, y) => x.d.localeCompare(y.d) || x.id.localeCompare(y.id));
  log(`history: ${matches.length} finished matches (+${added} new), ${Object.keys(registry.names).length} teams`);

  // 2. settle frozen predictions against real results
  let settledNow = 0;
  for (const p of preds) {
    if (p.status !== 'pending') continue;
    const m = near(pairs.get(pairKey(p.h, p.a)), p.kickoff, DAY * 2);
    if (!m) continue;
    p.status = 'settled'; p.result = { hg: m.hg, ag: m.ag, o: outcome1x2(m.hg, m.ag) };
    p.ok = grade(p.pk, m.hg, m.ag); if (p.pk0) p.ok0 = { x12: p.pk0.x12 === p.result.o };
    settledNow++;
  }
  log(`settled ${settledNow} predictions`);

  // 3. learn: re-tune parameters when enough new evidence has arrived
  if (matches.length >= MIN_TUNE_MATCHES && (forceTune || matches.length - (model.tunedOn || 0) >= RETUNE_EVERY)) {
    const t = tune(matches, model.params);
    model.tunedOn = matches.length;
    if (t.improved) { model.v += 1; model.params = t.params; }
    model.history = [...(model.history || []), { at: now.toISOString(), n: matches.length, adopted: t.improved, v: model.v,
      logloss: [+t.before.logloss.toFixed(4), +t.after.logloss.toFixed(4)], acc: [+t.before.acc.toFixed(4), +t.after.acc.toFixed(4)], params: t.params }].slice(-60);
    log(`tuned: ${t.improved ? 'adopted' : 'kept'} v${model.v} logloss ${t.before.logloss.toFixed(4)} -> ${t.after.logloss.toFixed(4)}`);
  }
  const { state } = replay(matches, model.params);
  const leagueOf = new Map(); for (const m of matches) for (const t of [m.h, m.a]) if (!leagueOf.has(t) || !['CL', 'EC', 'WC'].includes(m.c)) leagueOf.set(t, m.c);

  // 4. live context: ClubElo ratings + team news (news cached 5h in data/news.json)
  const club = new Map();
  for (const r of feed.clubelo || []) { const id = registry.resolve(r.name, false); if (id) club.set(id, r.elo); }
  const newsCache = load('news.json', {});
  const newsFor = async (id) => {
    const c = newsCache[id];
    if (c && now - new Date(c.at) < 5 * 3600000) return c;
    if (!feed.news) return null;
    try { const r = await feed.news(registry.names[id]); newsCache[id] = { at: now.toISOString(), ...r }; return newsCache[id]; }
    catch (e) { newsCache.__err = (newsCache.__err || 0) + 1; return c || null; }
  };
  const ctxCache = new Map();
  const ctxFor = (h, a) => ctxCache.get(pairKey(h, a)) || { ctx: {}, meta: {} };
  const buildCtx = async (h, a, odds) => {
    const ctx = {}, meta = {};
    if (odds) { ctx.odds = odds; meta.odds = odds; }
    if (club.has(h) && club.has(a)) { ctx.clubDiff = club.get(h) - club.get(a); meta.club = [Math.round(club.get(h)), Math.round(club.get(a))]; }
    const [nh, na] = [await newsFor(h), await newsFor(a)];
    if (nh || na) { ctx.newsH = nh?.adj || 0; ctx.newsA = na?.adj || 0; meta.news = { h: nh ? { adj: nh.adj, headlines: nh.headlines } : null, a: na ? { adj: na.adj, headlines: na.headlines } : null }; }
    const r = { ctx, meta }; ctxCache.set(pairKey(h, a), r); return r;
  };

  // 5. fixtures to predict: SportPesa-listed games (primary) + other upcoming fixtures from data feeds
  const feedUp = []; // resolve feed fixtures to ids
  for (const f of feed.upcoming || []) if (new Date(f.d) > now) feedUp.push({ ...f, h: registry.resolve(f.hn), a: registry.resolve(f.an) });
  const upIdx = new Map(); for (const f of feedUp) (upIdx.get(pairKey(f.h, f.a)) || upIdx.set(pairKey(f.h, f.a), []).get(pairKey(f.h, f.a))).push(f);
  const targets = new Map(); const unmatched = [];
  for (const l of feed.listed || []) {
    const h = registry.resolve(l.home, false), a = registry.resolve(l.away, false);
    if (!h || !a || state.n[h] == null || state.n[a] == null || Math.min(state.n[h], state.n[a]) < 5) { unmatched.push(`${l.home} vs ${l.away}`); continue; }
    const kickoff = l.kickoff || near(upIdx.get(pairKey(h, a)), now.toISOString(), 10 * DAY)?.d;
    if (!kickoff || new Date(kickoff) <= now) continue;
    const fx = near(upIdx.get(pairKey(h, a)), kickoff, DAY * 1.5);
    targets.set(`${dayOf(kickoff)}|${h}|${a}`, { h, a, kickoff, home: l.home, away: l.away, comp: fx?.c || leagueOf.get(h) || 'X', odds: fx?.o, listed: true });
  }
  for (const f of feedUp) {
    const id = `${dayOf(f.d)}|${f.h}|${f.a}`;
    if (state.n[f.h] == null || state.n[f.a] == null) continue;
    const dup = [...targets.values()].find((t) => t.h === f.h && t.a === f.a && Math.abs(+new Date(t.kickoff) - +new Date(f.d)) <= DAY * 1.5);
    if (dup) continue;
    targets.set(id, { h: f.h, a: f.a, kickoff: f.d, home: registry.names[f.h], away: registry.names[f.a], comp: f.c, odds: f.o, listed: false });
  }

  // 6. predict (never touch a prediction once kickoff has passed)
  const existing = new Map(preds.map((p) => [p.id, p]));
  let made = 0;
  for (const [id, t] of targets) {
    const old = existing.get(id);
    if (old && old.status !== 'pending') continue;
    const near48 = new Date(t.kickoff) - now < 3 * DAY;
    const { ctx, meta } = near48 ? await buildCtx(t.h, t.a, t.odds) : { ctx: t.odds ? { odds: t.odds } : {}, meta: t.odds ? { odds: t.odds } : {} };
    const p = predict(state, model.params, t.comp, t.h, t.a, ctx), p0 = predict(state, model.params, t.comp, t.h, t.a);
    const rec = { id, h: t.h, a: t.a, comp: t.comp, kickoff: t.kickoff, home: t.home, away: t.away, listed: t.listed,
      created: old?.created || now.toISOString(), updated: now.toISOString(), modelV: model.v, games: p.games, form: p.form,
      p: { h: +p.pH.toFixed(4), d: +p.pD.toFixed(4), a: +p.pA.toFixed(4), o: +p.over25.toFixed(4), b: +p.btts.toFixed(4) },
      xg: [+p.xgH.toFixed(2), +p.xgA.toFixed(2)], pk: picks(p), pk0: { x12: picks(p0).x12 }, p0: { h: +p0.pH.toFixed(4), d: +p0.pD.toFixed(4), a: +p0.pA.toFixed(4) },
      ctx: meta, status: 'pending' };
    if (old) Object.assign(old, rec); else { preds.push(rec); existing.set(id, rec); }
    made++;
  }
  log(`predicted/refreshed ${made} fixtures (${[...targets.values()].filter((t) => t.listed).length} SportPesa-listed, ${unmatched.length} listed games skipped: unknown teams)`);

  // 7. jackpots: scraped from SportPesa + pasted in data/jackpots/inbox.txt (inbox wins when both exist)
  let inbox = ''; try { inbox = fs.readFileSync(path.join(DATA, 'jackpots', 'inbox.txt'), 'utf8'); } catch {}
  const lists = [...parseInbox(inbox).map((j) => ({ ...j, source: 'inbox' })), ...(feed.scrapedJackpots || []).map((j) => ({ ...j, source: 'sportpesa' }))];
  for (const j of lists) for (const g of j.games) {
    const h = registry.resolve(g.home, false), a = registry.resolve(g.away, false);
    if (h && a) await buildCtx(h, a, null);
  }
  const pairIndex = pairs;
  const jackpots = buildJackpots({ lists, existing: load('jackpots.json', []), state, params: model.params, registry, pairIndex, now, modelV: model.v, leagueOf, ctxFor });
  const jpUnknown = [...new Set(jackpots.flatMap((j) => j.games.filter((g) => !g.known).flatMap((g) => [g.hId.startsWith('unk:') ? g.home : null, g.aId.startsWith('unk:') ? g.away : null]).filter(Boolean)))];

  // 8. publish
  { const kept = dropDuplicatePending(preds); if (kept.length !== preds.length) { log(`removed ${preds.length - kept.length} duplicate pending prediction(s)`); preds = kept; } }
  preds.sort((a, b) => a.kickoff.localeCompare(b.kickoff));
  const stats = computeStats(preds, jackpots);
  // 7. accumulators: daily / weekend slips from the safest selections, frozen at kickoff and settled from real scores
  const accas = updateAccas(load('accas.json', { items: [] }), preds, now); save('accas.json', accas);
  log(`accumulators: ${accas.items.length} (${accas.stats.pending} pending, ${accas.stats.settled} settled, hit rate ${accas.stats.overall.rate ?? 'n/a'})`);
  const recent = preds.filter((p) => p.status === 'pending' || p.kickoff >= new Date(now - 21 * DAY).toISOString());
  const top = Object.entries(state.elo).filter(([id]) => state.n[id] >= 8).sort((a, b) => b[1] - a[1]).slice(0, 25)
    .map(([id, r]) => ({ team: registry.names[id], elo: Math.round(r), att: +state.att[id].toFixed(2), def: +state.def[id].toFixed(2) }));
  model.updated = now.toISOString(); model.top = top; model.matches = matches.length;
  delete newsCache.__err;
  for (const k of Object.keys(newsCache)) if (now - new Date(newsCache[k].at) > 3 * DAY) delete newsCache[k];
  const sp = feed.sportpesaMeta || {};
  health.push({ source: 'SportPesa', ok: (feed.listed?.length || 0) + (feed.scrapedJackpots?.length || 0) > 0,
    detail: `${feed.listed?.length || 0} listed games, ${feed.scrapedJackpots?.length || 0} jackpot(s)${sp.scrapedAt ? `, scraped ${sp.scrapedAt}` : ''}` });
  const sources = { updated: now.toISOString(), health, unmatchedListed: unmatched.slice(0, 40), unknownJackpotTeams: jpUnknown.slice(0, 40) };
  // ratings snapshot so the browser can run the same model for ANY two teams (Matchup tab)
  const last = {}; for (let i = matches.length - 1; i >= 0; i--) { const m = matches[i]; for (const [t, o, gf, ga, home] of [[m.h, m.a, m.hg, m.ag, 1], [m.a, m.h, m.ag, m.hg, 0]]) { const l = (last[t] ||= []); if (l.length < 6) l.push({ d: m.d.slice(0, 10), o: registry.names[o], gf, ga, home }); } }
  const teamsOut = {}; for (const id of Object.keys(state.elo)) if (state.n[id] >= 3) teamsOut[id] = { n: registry.names[id], e: Math.round(state.elo[id]), a: +state.att[id].toFixed(3), d: +state.def[id].toFixed(3), g: state.n[id], f: state.form[id], c: leagueOf.get(id), ce: club.has(id) ? Math.round(club.get(id)) : undefined, l: last[id] || [] };
  save('ratings.json', { updated: now.toISOString(), v: model.v, params: model.params, lg: state.lg, teams: teamsOut });
  save('teams.json', registry.names); { const { recent, older } = splitHistory(matches, now); save('matches.json', recent); save('history.json', older); } save('predictions.json', preds); save('recent.json', recent);
  save('jackpots.json', jackpots, true); save('stats.json', stats, true); save('model.json', model, true); save('sources.json', sources, true); save('news.json', newsCache);
  log(`stats: ${stats.settled} settled, 1X2 accuracy ${stats.markets.x12.acc ?? 'n/a'}`);
  for (const h of health) log(`  source ${h.source}: ${h.ok ? 'OK' : 'FAILED'} - ${h.detail}`);
  return { stats, model, sources };
}

// ---- CLI ----
if (import.meta.url === `file://${process.argv[1]}`) {
  const args = new Set(process.argv.slice(2));
  const backfillN = parseBackfill(args);
  const now = new Date(), health = [];
  const feed = { finished: [], upcoming: [], listed: [], scrapedJackpots: [], clubelo: [], health };
  if (!args.has('--offline')) {
    const merge = (r) => { feed.finished.push(...r.finished); feed.upcoming.push(...r.upcoming); };
    // a) football-data.co.uk: results + odds, 22 divisions + 16 extra leagues
    try { const { fetchFduk } = await import('./lib/sources/fduk.mjs'); merge(await fetchFduk({ now, backfill: backfillN || false, health })); }
    catch (e) { health.push({ source: 'football-data.co.uk', ok: false, detail: e.message }); }
    // b) football-data.org API (optional key): fresher results
    if (process.env.FOOTBALL_DATA_API_KEY) {
      try {
        const { fetchWindow } = await import('./lib/sources/footballdata.mjs');
        const day = (n) => new Date(Date.now() + n * DAY).toISOString().slice(0, 10);
        const r = await fetchWindow({ key: process.env.FOOTBALL_DATA_API_KEY, from: day(-2), to: day(7) });
        merge(r); health.push({ source: 'football-data.org', ok: true, detail: `${r.finished.length} results, ${r.upcoming.length} fixtures` });
      } catch (e) { health.push({ source: 'football-data.org', ok: false, detail: e.message }); }
    } else health.push({ source: 'football-data.org', ok: false, detail: 'no API key (optional)' });
    // c) API-Football: broad fixture/results coverage when an API-Sports key is configured
    try {
      const { fetchApiFootball } = await import('./lib/sources/api-football.mjs');
      merge(await fetchApiFootball({ key: process.env.API_FOOTBALL_KEY, now, health }));
    } catch (e) { health.push({ source: 'API-Football', ok: false, detail: e.message }); }
    // d) OpenLigaDB: free supplemental German Bundesliga feed
    try {
      const { fetchOpenLigaDB } = await import('./lib/sources/openligadb.mjs');
      merge(await fetchOpenLigaDB({ now, health }));
    } catch (e) { health.push({ source: 'OpenLigaDB', ok: false, detail: e.message }); }
    // d2) openfootball: public-domain full-season fixtures/results for EPL, Championship, La Liga, Serie A
    try {
      const { fetchOpenFootball } = await import('./lib/sources/openfootball.mjs');
      merge(await fetchOpenFootball({ now, health }));
    } catch (e) { health.push({ source: 'openfootball', ok: false, detail: e.message }); }
    // e) The Odds API: bookmaker 1X2 odds; merges into matching fixtures by team pair/date
    try {
      const { fetchOddsApi } = await import('./lib/sources/odds-api.mjs');
      merge(await fetchOddsApi({ key: process.env.THE_ODDS_API_KEY, now, health }));
    } catch (e) { health.push({ source: 'The Odds API', ok: false, detail: e.message }); }
    // f) ClubElo ratings
    const { fetchClubElo } = await import('./lib/sources/clubelo.mjs'); feed.clubelo = await fetchClubElo({ now, health });
    // d) team news
    const { fetchTeamNews } = await import('./lib/sources/news.mjs'); let newsOk = 0, newsFail = 0;
    feed.news = async (name) => { try { const r = await fetchTeamNews(name, { now }); newsOk++; await new Promise((r) => setTimeout(r, 400)); return r; } catch (e) { newsFail++; throw e; } };
    process.on('exit', () => {});
    feed.__newsStats = () => ({ newsOk, newsFail });
  }
  // e) SportPesa (written by agent/scrape-sportpesa.mjs earlier in the workflow)
  const sp = load('sportpesa.json', null);
  if (sp) { feed.listed = sp.matches || []; feed.scrapedJackpots = sp.jackpots || []; feed.sportpesaMeta = sp;
    if (sp.scrapedAt && now - new Date(sp.scrapedAt) > 3 * DAY) feed.sportpesaMeta.stale = true; }
  const res = await runOnce({ feed, now, forceTune: args.has('--tune') || backfillN > 0 });
  if (feed.__newsStats) { const n = feed.__newsStats(); const s = res.sources; s.health.push({ source: 'Google News RSS', ok: n.newsOk > 0 || n.newsFail === 0, detail: `${n.newsOk} teams fetched, ${n.newsFail} failed` }); save('sources.json', s, true); }
}
