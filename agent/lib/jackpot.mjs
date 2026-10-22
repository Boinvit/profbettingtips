// Jackpot lists are pasted into data/jackpots/inbox.txt (SportPesa's page is JS-rendered and
// not scrapable reliably). Format:
//   # Mega Jackpot Pro | closes 2026-10-24 18:00 | prize KES 300,000,000
//   1. Arsenal vs Chelsea
//   2. Man City - Liverpool | 2-1        <- optional manual result after a pipe
import { predict, picks, grade, outcome1x2 } from './model.mjs';
import { norm } from './names.mjs';

const SEP = /\s+(?:vs\.?|v|-|–|—)\s+/i;
const slug = (s) => norm(s).replace(/ /g, '-').slice(0, 60);
const hash = (s) => { let h = 2166136261; for (const c of s) { h ^= c.charCodeAt(0); h = Math.imul(h, 16777619); } return (h >>> 0).toString(36).slice(0, 6); };
const gameKey = (games) => hash(games.map((g) => norm(g.home) + '|' + norm(g.away)).join(';'));

export function parseInbox(text) {
  const out = []; let cur = null;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('//')) continue;
    if (line.startsWith('#')) {
      const parts = line.replace(/^#+\s*/, '').split('|').map((x) => x.trim());
      const closes = (parts.find((x) => /^closes/i.test(x)) || '').replace(/^closes\s*/i, '');
      const prize = (parts.find((x) => /^prize/i.test(x)) || '').replace(/^prize\s*/i, '');
      const d = closes ? new Date(closes.replace(' ', 'T') + (closes.length <= 10 ? 'T23:59:00' : '') + '+03:00') : null;
      cur = { name: parts[0], closes: d && !isNaN(d) ? d.toISOString() : null, prize, games: [] };
      out.push(cur);
      continue;
    }
    if (!cur) continue;
    const [fx, res] = line.replace(/^\d+[.)]\s*/, '').split('|').map((x) => x.trim());
    const teams = fx.split(SEP);
    if (teams.length !== 2) continue;
    const g = { home: teams[0].trim(), away: teams[1].trim() };
    const m = res && res.match(/^(\d+)\s*[-:]\s*(\d+)$/);
    if (m) g.manual = { hg: +m[1], ag: +m[2] };
    cur.games.push(g);
  }
  return out.filter((j) => j.games.length);
}

/**
 * lists: [{name, closes, prize, games:[{home,away,manual?}]}] from the inbox and the SportPesa scrape.
 * ctxFor(hId,aId) -> {ctx, meta} live context (ClubElo gap, news adjustments).
 */
export function buildJackpots({ lists, existing, state, params, registry, pairIndex, now, modelV, leagueOf, ctxFor = () => ({ ctx: {}, meta: {} }) }) {
  const prev = new Map((existing || []).map((j) => [j.id, j]));
  const result = [];
  for (const j of lists) {
    const id = `${slug(j.name)}-${gameKey(j.games)}`;
    const old = prev.get(id);
    const closed = j.closes && new Date(j.closes) <= now;
    const created = old?.created || now.toISOString();
    const games = j.games.map((g, i) => {
      const oldG = old?.games?.[i];
      const frozen = oldG && oldG.home === g.home && oldG.away === g.away && (closed || oldG.result);
      let game = frozen ? { ...oldG } : null;
      if (!game) {
        const hId = registry.resolve(g.home, false) || `unk:${norm(g.home)}`;
        const aId = registry.resolve(g.away, false) || `unk:${norm(g.away)}`;
        const known = !hId.startsWith('unk:') && !aId.startsWith('unk:');
        const comp = leagueOf.get(hId) || 'X';
        const { ctx, meta } = known ? ctxFor(hId, aId) : { ctx: {}, meta: {} };
        const p = predict(state, params, comp, hId, aId, ctx), p0 = predict(state, params, comp, hId, aId);
        game = { n: i + 1, home: g.home, away: g.away, hId, aId, known, games: p.games, modelV, form: p.form,
          p: { h: +p.pH.toFixed(4), d: +p.pD.toFixed(4), a: +p.pA.toFixed(4), o: +p.over25.toFixed(4), b: +p.btts.toFixed(4) },
          xg: [+p.xgH.toFixed(2), +p.xgA.toFixed(2)], pk: picks(p), pk0: { x12: picks(p0).x12 }, meta };
      }
      if (!game.result) {
        let r = g.manual && { ...g.manual, src: 'manual' };
        if (!r && game.known) {
          const lo = new Date(created).getTime() - 86400000;
          const hi = (j.closes ? new Date(j.closes).getTime() : new Date(created).getTime()) + 7 * 86400000;
          const m = (pairIndex.get(`${game.hId}|${game.aId}`) || []).find((x) => +new Date(x.d) >= lo && +new Date(x.d) <= hi);
          if (m) r = { hg: m.hg, ag: m.ag, src: 'feed' };
        }
        if (r) { game.result = { ...r, o: outcome1x2(r.hg, r.ag) }; game.ok = grade(game.pk, r.hg, r.ag); game.ok0 = { x12: game.pk0.x12 === game.result.o }; }
      }
      return game;
    });
    const ps = games.map((g) => g.pk.x12p);
    result.push({ id, name: j.name, closes: j.closes, prize: j.prize, source: j.source || 'inbox', created, games,
      summary: { expectedCorrect: +ps.reduce((a, b) => a + b, 0).toFixed(2), pAllCorrect: ps.reduce((a, b) => a * b, 1),
        unknownTeams: games.filter((g) => !g.known).length } });
  }
  // keep jackpots that are no longer listed (history)
  for (const old of existing || []) if (!result.find((r) => r.id === old.id)) result.push(old);
  return result;
}
