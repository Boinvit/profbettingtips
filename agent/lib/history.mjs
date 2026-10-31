// Deep history lives in data/history.json (agent-only). data/matches.json stays a rolling recent window
// because the browser downloads it. The model replays BOTH, so depth improves ratings, tuning and backtests.
export const BROWSER_WINDOW_DAYS = 860; // about 2.3 seasons: keeps the browser-facing matches.json at roughly its previous size (~4 MB)
export function splitHistory(matches, now = new Date(), days = BROWSER_WINDOW_DAYS) {
  const cut = new Date(now.getTime() - days * 86400000).toISOString();
  const recent = [], older = [];
  for (const m of matches) (m.d >= cut ? recent : older).push(m);
  return { recent, older };
}
export function parseBackfill(args) {
  const a = [...args].find((x) => x === '--backfill' || x.startsWith('--backfill='));
  if (!a) return 0;
  if (a === '--backfill') return 3;
  const n = parseInt(a.split('=')[1], 10);
  return Number.isFinite(n) && n >= 1 ? Math.min(n, 12) : 3;
}
