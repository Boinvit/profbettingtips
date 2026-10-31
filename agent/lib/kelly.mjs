// Fractional-Kelly helper. Only meaningful where REAL bookmaker odds exist (ctx.odds).
// Edge is measured on the model's top 1X2 pick. The model already blends bookmaker odds,
// so edges are usually small; treat this as a staking guide, never a guarantee.
const IDX = { H: 0, D: 1, A: 2 };

export function valueBet(pred, { fraction = 0.25, cap = 0.05, minEdge = 0.03 } = {}) {
  const o = pred && pred.ctx && pred.ctx.odds;
  const pk = pred && pred.pk;
  if (!Array.isArray(o) || !pk || !(pk.x12 in IDX)) return null;
  const odds = o[IDX[pk.x12]];
  const prob = pk.x12p;
  if (!(odds > 1.01) || !(prob > 0 && prob < 1)) return null;
  const edge = prob * odds - 1;
  const full = edge / (odds - 1);
  const f = Math.min(Math.max(full * fraction, 0), cap);
  return { pick: pk.x12, odds, prob, edge, full, f, value: edge >= minEdge };
}

export function stakeFor(bankroll, f) {
  const b = Number(bankroll);
  if (!(b > 0) || !(f > 0)) return 0;
  return Math.round(b * f);
}
