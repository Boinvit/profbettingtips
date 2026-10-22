// Accuracy statistics from settled predictions (all predictions were frozen pre-kickoff).
const MK = ['x12', 'dc', 'ou', 'bt'];
const band = (p) => (p < 0.45 ? '<45%' : p < 0.55 ? '45–55%' : p < 0.65 ? '55–65%' : '65%+');
const rate = (c, n) => (n ? +(c / n).toFixed(4) : null);

export function computeStats(preds, jackpots) {
  const settled = preds.filter((p) => p.status === 'settled').sort((a, b) => a.kickoff.localeCompare(b.kickoff));
  const pending = preds.length - settled.length;
  const markets = {};
  for (const m of MK) {
    const c = settled.filter((p) => p.ok[m]).length;
    markets[m] = { n: settled.length, correct: c, acc: rate(c, settled.length) };
  }
  // baselines & proper scoring for 1X2
  let ll = 0, brier = 0, homeHits = 0;
  for (const p of settled) {
    const o = p.result.o;
    const pr = { H: p.p.h, D: p.p.d, A: p.p.a };
    ll -= Math.log(Math.max(pr[o], 1e-6));
    for (const k of ['H', 'D', 'A']) brier += (pr[k] - (k === o ? 1 : 0)) ** 2;
    if (o === 'H') homeHits++;
  }
  const n = settled.length;
  const scoring = { logloss: n ? +(ll / n).toFixed(4) : null, brier: n ? +(brier / n).toFixed(4) : null,
    baselineLogloss: +Math.log(3).toFixed(4), baselineAlwaysHome: rate(homeHits, n) };

  const groupBy = (keyFn) => {
    const g = {};
    for (const p of settled) { const k = keyFn(p); (g[k] ||= { n: 0, x12: 0, ou: 0, bt: 0 }); g[k].n++; for (const m of ['x12', 'ou', 'bt']) if (p.ok[m]) g[k][m]++; }
    return Object.entries(g).map(([k, v]) => ({ key: k, n: v.n, x12: rate(v.x12, v.n), ou: rate(v.ou, v.n), bt: rate(v.bt, v.n) }))
      .sort((a, b) => b.n - a.n);
  };
  const byComp = groupBy((p) => p.comp);
  const byConf = ['<45%', '45–55%', '55–65%', '65%+'].map((b) => {
    const xs = settled.filter((p) => band(p.pk.x12p) === b);
    const avgP = xs.length ? xs.reduce((s, p) => s + p.pk.x12p, 0) / xs.length : null;
    return { key: b, n: xs.length, predicted: avgP && +avgP.toFixed(3), actual: rate(xs.filter((p) => p.ok.x12).length, xs.length) };
  });
  const byModel = groupBy((p) => `v${p.modelV}`);

  // cumulative accuracy over time (by day)
  const series = []; let c = 0, i = 0;
  const days = {};
  for (const p of settled) {
    i++; if (p.ok.x12) c++;
    days[p.kickoff.slice(0, 10)] = { date: p.kickoff.slice(0, 10), n: i, acc: +(c / i).toFixed(4) };
  }
  series.push(...Object.values(days));
  const last = (k) => { const xs = settled.slice(-k); return { n: xs.length, x12: rate(xs.filter((p) => p.ok.x12).length, xs.length) }; };

  const jp = (jackpots || []).map((j) => {
    const done = j.games.filter((g) => g.result);
    const hit = done.filter((g) => g.ok?.x12).length;
    const hitDc = done.filter((g) => g.ok?.dc).length;
    return { id: j.id, name: j.name, total: j.games.length, settled: done.length, correct: hit, correctDC: hitDc, closes: j.closes };
  });

  // does the extra data (odds, ClubElo, news) beat the plain model? Same matches, both variants stored pre-kickoff.
  const ab = settled.filter((p) => p.p0);
  const abll = (get) => { let l = 0; for (const p of ab) { const q = get(p); l -= Math.log(Math.max(q[p.result.o.toLowerCase()], 1e-6)); } return ab.length ? +(l / ab.length).toFixed(4) : null; };
  const enhanced = { n: ab.length,
    full: { acc: rate(ab.filter((p) => p.ok.x12).length, ab.length), logloss: abll((p) => p.p) },
    base: { acc: rate(ab.filter((p) => p.ok0?.x12).length, ab.length), logloss: abll((p) => p.p0) },
    withOdds: (() => { const x = ab.filter((p) => p.ctx?.odds); return { n: x.length, acc: rate(x.filter((p) => p.ok.x12).length, x.length), baseAcc: rate(x.filter((p) => p.ok0?.x12).length, x.length) }; })(),
    withNews: (() => { const x = ab.filter((p) => p.ctx?.news); return { n: x.length, acc: rate(x.filter((p) => p.ok.x12).length, x.length), baseAcc: rate(x.filter((p) => p.ok0?.x12).length, x.length) }; })() };
  const split = (f) => { const x = settled.filter(f); return { n: x.length, x12: rate(x.filter((p) => p.ok.x12).length, x.length) }; };
  const listed = { sportpesa: split((p) => p.listed), other: split((p) => !p.listed) };

  return { updated: new Date().toISOString(), settled: n, enhanced, listed, pending, markets, scoring, byComp, byConf, byModel, series,
    rolling: { last50: last(50), last200: last(200) }, jackpots: jp };
}
