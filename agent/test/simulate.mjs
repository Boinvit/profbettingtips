// End-to-end test on a synthetic world with hidden team strengths and a fake clock.
// Usage: node agent/test/simulate.mjs     (writes only to a temp data dir)
import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path';
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pbt-sim-'));
process.env.PBT_DATA_DIR = tmp;
fs.mkdirSync(path.join(tmp, 'jackpots'), { recursive: true });
const { runOnce } = await import('../run.mjs');

let seed = 42; const rnd = () => ((seed = (seed * 1664525 + 1013904223) % 4294967296) / 4294967296);
const poisson = (l) => { let L = Math.exp(-l), k = 0, p = 1; do { k++; p *= rnd(); } while (p > L); return k - 1; };
const mkTeams = (pfx, n) => Array.from({ length: n }, (_, i) => ({ name: `Club ${pfx}${String(i).padStart(2, '0')}`, s: (rnd() - 0.5) * 1.1 }));
const leagues = { E0: mkTeams('P', 20), I1: mkTeams('S', 20) };
const trueP = (hs, as) => { const lh = 1.45 * Math.exp(0.5 * (hs - as) + 0.12), la = 1.2 * Math.exp(-0.5 * (hs - as)); return [lh, la]; };

// schedule: 3 seasons of double round-robin, 3 matches/team... simplified: random pairings, 1 matchday every 3 days
const start = new Date('2024-08-01T15:00:00Z'); const all = []; let id = 1;
for (let day = 0; day < 3 * 300; day += 3) {
  for (const [comp, teams] of Object.entries(leagues)) {
    const idx = teams.map((_, i) => i).sort(() => rnd() - 0.5);
    for (let i = 0; i < idx.length; i += 2) {
      const H = teams[idx[i]], A = teams[idx[i + 1]]; const [lh, la] = trueP(H.s, A.s);
      // bookmaker odds: true probabilities + noise + 6% margin, available for ~60% of matches
      const pp = (() => { const pois = (l) => Array.from({ length: 10 }, (_, k) => Math.exp(-l) * l ** k / [1,1,2,6,24,120,720,5040,40320,362880][k]); const a = pois(lh), b = pois(la); let h = 0, d = 0, w = 0; for (let i = 0; i < 10; i++) for (let j = 0; j < 10; j++) { const q = a[i] * b[j]; if (i > j) h += q; else if (i === j) d += q; else w += q; } return [h, d, w]; })();
      const noisy = pp.map((x) => x * Math.exp((rnd() - 0.5) * 0.16)); const nz = noisy[0] + noisy[1] + noisy[2];
      const o = rnd() < 0.6 ? noisy.map((x) => +(1 / ((x / nz) * 1.06)).toFixed(2)) : undefined;
      all.push({ c: comp, d: new Date(start.getTime() + day * 86400000).toISOString(), hn: H.name, an: A.name, hg: poisson(lh), ag: poisson(la), lh, la, o, hs: H.s, as: A.s });
    }
  }
}
const liveStart = new Date(start.getTime() + 600 * 86400000); // last ~300 days are "live"
const hist = all.filter((m) => new Date(m.d) < liveStart);
console.log(`world: ${all.length} matches, ${hist.length} history`);
await runOnce({ feed: { finished: hist, upcoming: [] }, now: liveStart, log: () => {}, forceTune: true });

// oracle accuracy for the live period (best possible with true probabilities)
let oracle = 0, live = 0;
for (const m of all.filter((x) => new Date(x.d) >= liveStart)) {
  const pois = (l) => Array.from({ length: 10 }, (_, k) => Math.exp(-l) * l ** k / [1,1,2,6,24,120,720,5040,40320,362880][k]);
  const ph = pois(m.lh), pa = pois(m.la); let H = 0, D = 0, A = 0;
  for (let i = 0; i < 10; i++) for (let j = 0; j < 10; j++) { const p = ph[i] * pa[j]; if (i > j) H += p; else if (i === j) D += p; else A += p; }
  const best = H >= D && H >= A ? 'H' : D >= A ? 'D' : 'A';
  const o = m.hg > m.ag ? 'H' : m.hg === m.ag ? 'D' : 'A'; if (best === o) oracle++; live++;
}

// live loop: every day, feed = results from last 2 days + fixtures for next 7 days
const days = 180; let last;
for (let d = 0; d < days; d++) {
  const now = new Date(liveStart.getTime() + d * 86400000 + 10 * 3600000);
  const fin = all.filter((m) => new Date(m.d) <= now && new Date(m.d) > new Date(now.getTime() - 3 * 86400000)).map((m) => ({ ...m, d: m.d }));
  // results become known 2h after kickoff
  const finished = fin.filter((m) => new Date(m.d).getTime() + 2 * 3600000 <= now.getTime());
  const upcoming = all.filter((m) => new Date(m.d) > now && new Date(m.d) <= new Date(now.getTime() + 7 * 86400000));
  // 30% of upcoming games are "SportPesa listed" (different spelling of the same names, own kickoff)
  const listed = upcoming.filter((_, i) => i % 3 === 0).map((m) => ({ home: m.hn.toUpperCase(), away: m.an.toUpperCase(), kickoff: m.d, league: m.c }));
  const clubelo = Object.values(leagues).flat().map((t) => ({ name: t.name, elo: 1500 + 300 * t.s + (rnd() - 0.5) * 60 }));
  const news = async (name) => (rnd() < 0.15 ? { adj: -8, flags: ['−'], headlines: [`${name} doubt for weekend`] } : { adj: 0, flags: [], headlines: [] });
  last = await runOnce({ feed: { finished, upcoming, listed, clubelo, news }, now, log: () => {} });
}
const s = last.stats;
console.log(`live predictions settled: ${s.settled}`);
console.log(`1X2 accuracy ${(s.markets.x12.acc * 100).toFixed(1)}% | oracle (true probs) ${(oracle / live * 100).toFixed(1)}% | always-home ${(s.scoring.baselineAlwaysHome * 100).toFixed(1)}%`);
console.log(`DC ${(s.markets.dc.acc * 100).toFixed(1)}% | O/U2.5 ${(s.markets.ou.acc * 100).toFixed(1)}% | BTTS ${(s.markets.bt.acc * 100).toFixed(1)}%`);
console.log(`logloss ${s.scoring.logloss} (uniform ${s.scoring.baselineLogloss}) brier ${s.scoring.brier}`);
const e = s.enhanced; console.log(`A/B (n=${e.n}): base acc ${(e.base.acc*100).toFixed(1)}% ll ${e.base.logloss} | full acc ${(e.full.acc*100).toFixed(1)}% ll ${e.full.logloss} | with odds n=${e.withOdds.n} full ${(e.withOdds.acc*100).toFixed(1)}% vs base ${(e.withOdds.baseAcc*100).toFixed(1)}%`);
console.log(`SportPesa-listed: n=${s.listed.sportpesa.n} acc ${(s.listed.sportpesa.x12*100).toFixed(1)}% | other n=${s.listed.other.n}`);
console.log('calibration', s.byConf.map((b) => `${b.key}: pred ${b.predicted} / actual ${b.actual} (n=${b.n})`).join(' | '));
console.log(`model v${last.model.v}, tuning events ${last.model.history.length}, params`, JSON.stringify(last.model.params));
// frozen-prediction invariant: no settled prediction may have been created after kickoff
const preds = JSON.parse(fs.readFileSync(path.join(tmp, 'predictions.json')));
const bad = preds.filter((p) => p.status === 'settled' && p.created > p.kickoff);
const teamsN = Object.keys(JSON.parse(fs.readFileSync(path.join(tmp, 'teams.json')))).length; console.log(`teams in registry: ${teamsN} (expected 40; more means failed name merging)`);
if (teamsN !== 40) process.exit(1);
console.log(`frozen-prediction violations: ${bad.length}`);
if (bad.length || s.settled < 500) process.exit(1);
console.log('SIM OK');
console.log('DATA_DIR', tmp);
