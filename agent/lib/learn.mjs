// Online tuning: coordinate descent on walk-forward log-loss over ALL stored history.
import { DEFAULT_PARAMS, PARAM_BOUNDS, replay } from './model.mjs';

const GRID = (name, cur) => {
  const [lo, hi] = PARAM_BOUNDS[name];
  const step = (hi - lo) / 12;
  const vals = new Set([cur]);
  for (const f of [-3, -2, -1, 1, 2, 3]) vals.add(Math.min(hi, Math.max(lo, cur + f * step * 0.5)));
  return [...vals];
};

const objective = (r) => r.logloss + 0.3 * r.ouLogloss;

export function tune(matches, startParams, { passes = 2, minGain = 0.0004 } = {}) {
  const warmup = Math.min(Math.floor(matches.length * 0.25), 400);
  let best = { ...DEFAULT_PARAMS, ...startParams };
  const base = replay(matches, best, { warmup });
  let bestScore = objective(base);
  const startScore = bestScore;
  for (let p = 0; p < passes; p++) {
    for (const name of Object.keys(PARAM_BOUNDS)) {
      for (const v of GRID(name, best[name])) {
        if (v === best[name]) continue;
        const cand = { ...best, [name]: +v.toFixed(4) };
        const sc = objective(replay(matches, cand, { warmup }));
        if (sc < bestScore - minGain) { bestScore = sc; best = cand; }
      }
    }
  }
  const final = replay(matches, best, { warmup });
  return {
    params: best, improved: bestScore < startScore - minGain,
    before: { logloss: base.logloss, acc: base.acc },
    after: { logloss: final.logloss, acc: final.acc }, evaluated: final.n,
  };
}
