// Self-learning football model: Elo + attack/defence strengths -> Poisson score grid.
// Everything is a pure function of (match history, params), so state can always be
// rebuilt by replaying history. Params are tuned by walk-forward log-loss (see learn.mjs).

export const DEFAULT_PARAMS = {
  k: 22,            // Elo K-factor
  homeAdv: 65,      // home advantage in Elo points
  eloScale: 600,    // Elo points per unit of log goal-supremacy
  wAD: 0.5,         // weight of attack/defence multipliers (0..1)
  adAlpha: 0.08,    // EMA speed of attack/defence ratings
  drawBoost: 0.10,  // inflate P(draw) (Poisson under-counts draws)
  temp: 1.0,        // probability sharpening (calibration)
  wOdds: 0.6,       // weight of bookmaker-implied probabilities when odds are known (0..1)
};

export const W_CLUB = 0.35; // weight of ClubElo rating gap in live predictions (not tuned: no history)

export const PARAM_BOUNDS = {
  k: [8, 45], homeAdv: [20, 120], eloScale: [350, 1000],
  wAD: [0, 1], adAlpha: [0.03, 0.2], drawBoost: [0, 0.35], temp: [0.75, 1.35], wOdds: [0, 1],
};

const MAXG = 9;
const clamp = (x, a, b) => Math.min(b, Math.max(a, x));

export function newState() {
  return { elo: {}, att: {}, def: {}, n: {}, lg: {}, form: {} };
}

function ensure(s, id) {
  if (!(id in s.elo)) { s.elo[id] = 1500; s.att[id] = 1; s.def[id] = 1; s.n[id] = 0; s.form[id] = ''; }
}
const lgAvg = (s, comp) => (s.lg[comp] ? s.lg[comp].avg : 1.35);

function pois(lam) {
  const p = new Array(MAXG + 1);
  p[0] = Math.exp(-lam);
  for (let i = 1; i <= MAXG; i++) p[i] = (p[i - 1] * lam) / i;
  return p;
}

/**
 * Predict a fixture from the current state. `ctx` carries optional live-only context:
 *   odds [H,D,A] decimal bookmaker odds, clubDiff (ClubElo home-minus-away), newsH/newsA Elo adjustments.
 */
export function predict(s, params, comp, homeId, awayId, ctx = {}) {
  const P = { ...DEFAULT_PARAMS, ...params };
  ensure(s, homeId); ensure(s, awayId);
  let dElo = s.elo[homeId] - s.elo[awayId] + P.homeAdv;
  if (Number.isFinite(ctx.clubDiff)) dElo = (1 - W_CLUB) * dElo + W_CLUB * (ctx.clubDiff + P.homeAdv);
  dElo += (ctx.newsH || 0) - (ctx.newsA || 0);
  const x = dElo / P.eloScale;
  const base = lgAvg(s, comp);
  let lh = base * Math.exp(x), la = base * Math.exp(-x);
  lh *= Math.pow(s.att[homeId] * s.def[awayId], P.wAD);
  la *= Math.pow(s.att[awayId] * s.def[homeId], P.wAD);
  lh = clamp(lh, 0.15, 4.5); la = clamp(la, 0.15, 4.5);

  const ph = pois(lh), pa = pois(la);
  let H = 0, D = 0, A = 0, over = 0, btts = 0, tot = 0;
  for (let i = 0; i <= MAXG; i++) for (let j = 0; j <= MAXG; j++) {
    let p = ph[i] * pa[j];
    if (i === j) p *= 1 + P.drawBoost;
    tot += p;
    if (i > j) H += p; else if (i === j) D += p; else A += p;
    if (i + j >= 3) over += p;
    if (i > 0 && j > 0) btts += p;
  }
  H /= tot; D /= tot; A /= tot; over /= tot; btts /= tot;
  // temperature (sharpen / soften)
  const t = [H, D, A].map((p) => Math.pow(p, P.temp));
  const z = t[0] + t[1] + t[2];
  let pH = t[0] / z, pD = t[1] / z, pA = t[2] / z;
  let usedOdds = false;
  if (ctx.odds && ctx.odds.every((o) => o > 1.01) && P.wOdds > 0) {
    const imp = ctx.odds.map((o) => 1 / o); const iz = imp[0] + imp[1] + imp[2];
    const w = P.wOdds, m = [pH ** (1 - w) * (imp[0] / iz) ** w, pD ** (1 - w) * (imp[1] / iz) ** w, pA ** (1 - w) * (imp[2] / iz) ** w];
    const mz = m[0] + m[1] + m[2]; pH = m[0] / mz; pD = m[1] / mz; pA = m[2] / mz; usedOdds = true;
  }
  return {
    pH, pD, pA, over25: over, btts, xgH: lh, xgA: la,
    games: Math.min(s.n[homeId], s.n[awayId]), usedOdds, form: [s.form[homeId], s.form[awayId]],
  };
}

/** Learn from one finished match (mutates state). */
export function learn(s, params, m) {
  const P = { ...DEFAULT_PARAMS, ...params };
  ensure(s, m.h); ensure(s, m.a);
  const dElo = s.elo[m.h] - s.elo[m.a] + P.homeAdv;
  const we = 1 / (1 + Math.pow(10, -dElo / 400));
  const S = m.hg > m.ag ? 1 : m.hg === m.ag ? 0.5 : 0;
  const gd = Math.abs(m.hg - m.ag);
  const mult = gd <= 1 ? 1 : gd === 2 ? 1.5 : (11 + gd) / 8;
  s.form[m.h] = (s.form[m.h] + (S === 1 ? 'W' : S === 0.5 ? 'D' : 'L')).slice(-5);
  s.form[m.a] = (s.form[m.a] + (S === 1 ? 'L' : S === 0.5 ? 'D' : 'W')).slice(-5);
  const delta = P.k * mult * (S - we);
  s.elo[m.h] += delta; s.elo[m.a] -= delta;

  const lg = (s.lg[m.c] ||= { avg: 1.35, n: 0 });
  const a = Math.max(1 / (lg.n + 2), 0.01);
  lg.avg += a * ((m.hg + m.ag) / 2 - lg.avg); lg.n++;
  const base = lg.avg;
  for (const [id, gf, ga] of [[m.h, m.hg, m.ag], [m.a, m.ag, m.hg]]) {
    const al = Math.max(1 / (s.n[id] + 2), P.adAlpha);
    s.att[id] = clamp(s.att[id] + al * (gf / base - s.att[id]), 0.4, 2.2);
    s.def[id] = clamp(s.def[id] + al * (ga / base - s.def[id]), 0.4, 2.2);
    s.n[id]++;
  }
}

export const outcome1x2 = (hg, ag) => (hg > ag ? 'H' : hg === ag ? 'D' : 'A');

/** Turn probabilities into the picks we publish for each market. */
export function picks(p) {
  const arr = [['H', p.pH], ['D', p.pD], ['A', p.pA]].sort((a, b) => b[1] - a[1]);
  const dc = [['1X', p.pH + p.pD], ['X2', p.pD + p.pA], ['12', p.pH + p.pA]].sort((a, b) => b[1] - a[1]);
  return {
    x12: arr[0][0], x12p: arr[0][1], alt: arr[1][0], altp: arr[1][1],
    dc: dc[0][0], dcp: dc[0][1],
    ou: p.over25 >= 0.5 ? 'O' : 'U', oup: Math.max(p.over25, 1 - p.over25),
    bt: p.btts >= 0.5 ? 'Y' : 'N', btp: Math.max(p.btts, 1 - p.btts),
  };
}

export function grade(pk, hg, ag) {
  const o = outcome1x2(hg, ag);
  return {
    x12: pk.x12 === o,
    dc: pk.dc.includes(o === 'H' ? '1' : o === 'A' ? '2' : 'X'),
    ou: pk.ou === (hg + ag >= 3 ? 'O' : 'U'),
    bt: pk.bt === (hg > 0 && ag > 0 ? 'Y' : 'N'),
  };
}

/** Walk-forward replay: predict each match BEFORE learning from it. */
export function replay(matches, params, { warmup = 0 } = {}) {
  const s = newState();
  let n = 0, ll = 0, llOu = 0, hit = 0;
  for (let i = 0; i < matches.length; i++) {
    const m = matches[i];
    if (i >= warmup) {
      const p = predict(s, params, m.c, m.h, m.a, m.o ? { odds: m.o } : {});
      const o = outcome1x2(m.hg, m.ag);
      const pr = o === 'H' ? p.pH : o === 'D' ? p.pD : p.pA;
      ll -= Math.log(Math.max(pr, 1e-6));
      const ov = m.hg + m.ag >= 3;
      llOu -= Math.log(Math.max(ov ? p.over25 : 1 - p.over25, 1e-6));
      if (picks(p).x12 === o) hit++;
      n++;
    }
    learn(s, params, m);
  }
  return { state: s, n, logloss: n ? ll / n : NaN, ouLogloss: n ? llOu / n : NaN, acc: n ? hit / n : NaN };
}
