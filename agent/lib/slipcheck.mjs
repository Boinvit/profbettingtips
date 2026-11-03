// Slip checker: parse the text of a pasted SportPesa slip and judge every leg with the model.
// Pure functions (no DOM, no network) so they run in the browser and in tests.
import { calibrate } from './calibration.mjs';

export const CASHOUT_ETA = 0.95; // SportPesa paid ~96% of fair value on the 31 Oct cash-out (one sample): an estimate, not a promise
const r3 = (x) => Math.round(x * 1000) / 1000;
const YOUTH = /\b(U-?(1[5-9]|2[0-3])|youth|reserves?)\b|[ ](II|III)$/i; // youth/reserve sides: squads rotate, little reliable history
const EAT_MS = 3 * 3600e3; // slips show East Africa Time; data is stored in UTC
const PICKS = {
  '1x2': { home: 'H', away: 'A', draw: 'D' },
  'double chance': { '1 or x': 'D1X', 'x or 2': 'DX2', '1 or 2': 'D12' },
  'both teams to score': { 'yes (gg)': 'B', 'no (ng)': 'N' },
};
export const LABEL = { H: 'Home win', A: 'Away win', D: 'Draw', D1X: 'Home or draw', DX2: 'Draw or away', D12: 'Home or away', B: 'Both teams score', N: 'Not both score', O: 'Over 2.5 goals', U: 'Under 2.5 goals' };
const MKT = { H: 'x12', A: 'x12', D: 'x12', D1X: 'dc', DX2: 'dc', D12: 'dc', O: 'ou', U: 'ou', B: 'bt', N: 'bt' };

const DATE = '[0-9]{1,2}/[0-9]{2}/[0-9]{2} [0-9]{1,2}:[0-9]{2} ';
const NAME = `((?:(?!${DATE}).){2,60}?)`;
const MARKET = '(1X2|Double Chance|Both Teams To Score|Total Goals Over/Under - Full Time)';
const PICK = '(Home|Away|Draw|1 OR X|X OR 2|1 OR 2|YES [(]GG[)]|NO [(]NG[)]|OVER [0-9][.][0-9]{2}|UNDER [0-9][.][0-9]{2})';
const LEG_RE = `([0-9]{1,2})/([0-9]{2})/([0-9]{2}) ([0-9]{1,2}):([0-9]{2}) ${NAME} [\u2013\u2014-] ${NAME} ([0-9]{1,3}[.][0-9]{2}) ${MARKET} ${PICK}`;

function codeFor(market, pick) {
  const m = market.toLowerCase(), p = pick.toLowerCase();
  if (PICKS[m]) return PICKS[m][p] || null;
  if (m.startsWith('total goals')) return p === 'over 2.50' ? 'O' : p === 'under 2.50' ? 'U' : null; // only the 2.5 line is modelled
  return null;
}

/** An UNPLACED betslip (SportPesa slip page: 'Your Pick: Home', no dates or results). Legs carry no kickoff; checkSlip matches them to upcoming fixtures by team names. */
export function parseBetslip(text) {
  let t = String(text || '').split(String.fromCharCode(160)).join(' ').replace(/[[]([^\u005d]*)][(][^)]*[)]/g, ' $1 ');
  t = t.split(String.fromCharCode(215)).join(' ').split('*').join(' ').split(/\s+/).join(' ').trim();
  const declared = Number((t.match(/MULTI BET [(]([0-9]+)[)]/i) || [])[1]) || null;
  const stake = (t.match(/BET AMOUNT [(](?:KSH|KES)[)]:? ([0-9][0-9,]*(?:[.][0-9]+)?)/i) || [])[1];
  const totalOdds = Number((t.match(/TOTAL ODDS:? ([0-9]+[.][0-9]+)/i) || [])[1]) || null;
  t = t.replace(/MULTI BET [(][0-9]+[)]/i, ' ').replace(/Share/, ' ').split(/\s+/).join(' ').trim();
  const N = '((?:(?!Your Pick).){2,60}?)';
  const re = new RegExp(N + ' [\u2013\u2014-] ' + N + ' (1X2|Double Chance|Both Teams To Score|Total Goals Over/Under - Full Time) Your Pick: ' + PICK + ' ([0-9]{1,3}[.][0-9]{2})', 'gi');
  const legs = [];
  for (const m of t.matchAll(re)) {
    const [, home, away, market, pick, odds] = m, code = codeFor(market.trim(), pick.trim());
    legs.push({ home: home.trim(), away: away.trim(), odds: Number(odds), market: market.trim(), pick: pick.trim(), code, label: code ? LABEL[code] : market.trim() + ': ' + pick.trim(), kickoff: null });
  }
  return { stake: stake ? Number(stake.split(',').join('')) : null, declared, legs, totalOdds, placed: false };
}

/** Text of a slip (copied from the PDF or the bet page) -> stake, declared leg count and legs. Wrapped names and PDF ligature gaps are handled. */
export function parseSlip(text) {
  if (/Your Pick:/i.test(String(text || ''))) return parseBetslip(text);
  const t = String(text || '').replace(new RegExp(String.fromCharCode(160), 'g'), ' ').split(/\s+/).join(' ').replace(/(ffi|ffl|fi|fl) (?=[a-z]{2})/g, '$1').trim();
  const stake = (t.match(/Bet amount:?[ ]*(?:KSH|KES)?[ ]*([0-9,]+(?:[.][0-9]+)?)/i) || [])[1];
  const declared = Number((t.match(/Multi Bet [(]([0-9]+)[)]/i) || [])[1]) || null;
  const legs = [];
  for (const m of t.matchAll(new RegExp(LEG_RE, 'gi'))) {
    const [, dd, mm, yy, hh, mi, home, away, odds, market, pick] = m;
    const code = codeFor(market, pick);
    legs.push({ home: home.trim(), away: away.trim(), odds: Number(odds), market, pick, code, label: code ? LABEL[code] : `${market}: ${pick} (not modelled)`,
      kickoff: new Date(Date.UTC(2000 + Number(yy), Number(mm) - 1, Number(dd), Number(hh), Number(mi)) - EAT_MS).toISOString() });
  }
  return { stake: stake ? Number(stake.split(',').join('')) : null, declared, legs };
}

const probOf = (P, code) => {
  if (!P) return null;
  const { h, d, a, o, b } = P;
  const v = { H: h, A: a, D: d, D1X: h + d, DX2: d + a, D12: h + a, O: o, U: 1 - o, B: b, N: 1 - b }[code];
  return Number.isFinite(v) ? v : null;
};

/** Did a leg win, given the final score? null when the market is not modelled or there is no score. */
export function outcomeOf(code, r) {
  if (!r || !Number.isInteger(r.hg) || !Number.isInteger(r.ag)) return null;
  const { hg, ag } = r, o = hg > ag ? 'H' : hg < ag ? 'A' : 'D';
  switch (code) {
    case 'H': case 'A': case 'D': return o === code;
    case 'D1X': return o !== 'A';
    case 'DX2': return o !== 'H';
    case 'D12': return o !== 'D';
    case 'O': return hg + ag > 2.5;
    case 'U': return hg + ag < 2.5;
    case 'B': return hg > 0 && ag > 0;
    case 'N': return !(hg > 0 && ag > 0);
    default: return null;
  }
}

const prod = (xs) => xs.reduce((a, x) => a * x, 1);

/** Judge a parsed slip. ctx: { preds, resolve(name)->id|null, cal, now, eta } */
export function checkSlip(parsed, { preds = [], resolve = () => null, cal = null, now = new Date(), eta = CASHOUT_ETA, stake } = {}) {
  const st = Number(stake ?? parsed.stake) > 0 ? Number(stake ?? parsed.stake) : 0;
  const rows = parsed.legs.map((l) => {
    const hid = resolve(l.home), aid = resolve(l.away), t0 = l.kickoff ? Date.parse(l.kickoff) : NaN;
    let pr = null, best = Infinity;
    if (hid && aid) for (const p of preds) {
      if (p.h !== hid || p.a !== aid) continue;
      if (!Number.isFinite(t0) && p.status !== 'pending') continue; // unplaced slip: only upcoming fixtures
      const dt = Math.abs(Date.parse(p.kickoff) - (Number.isFinite(t0) ? t0 : now.getTime()));
      if (dt < best && dt <= (Number.isFinite(t0) ? 48 : 7 * 24) * 3600e3) { best = dt; pr = p; }
    }
    const row = { ...l, kickoff: l.kickoff || (pr ? pr.kickoff : ''), youth: YOUTH.test(l.home) || YOUTH.test(l.away), implied: r3(1 / l.odds), matched: !!pr, status: 'unjudged', p: null, praw: null, edge: null, played: t0 <= now.getTime() };
    if (!pr || !l.code) return row;
    const raw = probOf(pr.p, l.code);
    if (raw != null) { row.praw = r3(raw); row.p = r3(calibrate(cal, MKT[l.code], raw)); row.edge = r3(row.p * l.odds - 1); row.status = 'pending'; }
    if (pr.status === 'settled' && pr.result) {
      const w = outcomeOf(l.code, pr.result);
      if (w != null) { row.status = w ? 'won' : 'lost'; row.score = `${pr.result.hg}-${pr.result.ag}`; }
    }
    return row;
  });
  const cnt = (s) => rows.filter((r) => r.status === s).length;
  const counts = { won: cnt('won'), lost: cnt('lost'), pending: cnt('pending'), unjudged: cnt('unjudged') };
  const dead = counts.lost > 0, odds = prod(rows.map((r) => r.odds));
  const pf = (r) => (r.p != null ? r.p : r.implied);
  const open = rows.filter((r) => r.status === 'pending' || r.status === 'unjudged');
  const pRem = dead ? 0 : prod(open.map(pf)), pRemBook = dead ? 0 : prod(open.map((r) => r.implied));
  const pScratch = prod(rows.map(pf)), pScratchBook = prod(rows.map((r) => r.implied));
  const wonOdds = prod(rows.filter((r) => r.status === 'won').map((r) => r.odds));
  const judged = rows.filter((r) => r.status === 'pending' && r.p != null);
  const byEdge = [...judged].sort((a, b) => a.edge - b.edge);
  const trims = [1, 3].filter((k) => judged.length > k + 1 && !dead).map((k) => {
    const drop = new Set(byEdge.slice(0, k)), keep = rows.filter((r) => !drop.has(r));
    return { drop: k, legs: keep.length, odds: r3(prod(keep.map((r) => r.odds))), p: r3(prod(keep.map(pf))) };
  });
  const pend = [...judged].sort((a, b) => a.kickoff.localeCompare(b.kickoff)), n = pend.length;
  const ladder = dead ? [] : [...new Set([0.25, 0.5, 0.75].map((f) => Math.max(1, Math.round(n * f))).filter((k) => k < n))].map((k) => {
    const head = pend.slice(0, k);
    return { k, p: r3(prod(head.map((r) => r.p))), value: st * wonOdds * prod(head.map((r) => r.odds)) * eta };
  });
  return {
    stake: st, odds: r3(odds), payout: st * odds, legsN: rows.length, declared: parsed.declared, rows, counts, dead,
    firstLoss: dead ? (() => { const r = rows.find((x) => x.status === 'lost'); return `${r.home} v ${r.away}${r.score ? ` (${r.score})` : ''}`; })() : null,
    pScratch: r3(pScratch), pScratchBook: r3(pScratchBook), pRem: r3(pRem), pRemBook: r3(pRemBook), ev: st ? st * odds * pScratch - st : null,
    cash: !dead && counts.won > 0 && counts.pending + counts.unjudged > 0 && st ? { offer: st * wonOdds * eta, hold: st * odds * pRem } : null,
    weakest: byEdge.slice(0, 4), trims, ladder, unjudged: rows.filter((r) => r.status === 'unjudged').map((r) => `${r.home} v ${r.away}`),
  };
}
