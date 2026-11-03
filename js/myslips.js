// My slips tab: paste a SportPesa slip -> judged against the model; personal ledger; second-opinion tracker (any source).
// Everything you enter stays in THIS browser (localStorage). Nothing is uploaded or committed.
import { parseSlip, checkSlip, LABEL } from '../agent/lib/slipcheck.mjs';
import { Registry } from '../agent/lib/teams.mjs';
import { newBet, settleBet, ledgerStats, ledgerCsv } from '../agent/lib/ledger.mjs';

const esc = (s) => String(s ?? '').replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c])).split(String.fromCharCode(34)).join('&quot;');
const store = {
  get(k, fb) { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : fb; } catch (e) { return fb; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* storage unavailable */ } },
};
const num = (x) => (Number.isFinite(Number(x)) ? Number(x) : null);
const pct = (x, d = 0) => (num(x) == null ? '-' : (x * 100).toFixed(d) + '%');
const kes = (x) => (num(x) == null ? '-' : 'KES ' + Math.round(x).toLocaleString('en-KE'));
const MAX_SAFE_STAKE = 100; // house rule: KES 100 or less until ~100 settled bets show a profit

let env = null;
async function loadEnv() {
  if (env) return env;
  const get = (f, fb) => fetch('data/' + f + '?t=' + Date.now()).then((r) => (r.ok ? r.json() : fb)).catch(() => fb);
  const [preds, teams, aliases, cal] = await Promise.all([get('predictions.json', []), get('teams.json', {}), get('aliases.json', {}), get('calibration.json', null)]);
  env = { preds, registry: new Registry(teams, aliases), cal };
  return env;
}

export async function mountMySlips(root) {
  if (!root) return;
  let ledger = store.get('pbt.ledger', []);
  let ops = store.get('pbt.opinions', []);
  let last = null, slip = null;
  const q = (s) => root.querySelector(s);

  root.innerHTML = `
  <h2>My slips</h2>
  <p class='muted'>Paste a SportPesa slip (copy the text from the bet details). The agent judges each leg against its own numbers. Stays in this browser only.</p>
  <textarea id='ms-text' rows='6' style='width:100%' placeholder='Paste slip text here'></textarea>
  <p><label>Stake (KES, optional if the slip shows it) <input id='ms-stake' type='number' min='0' step='1' style='width:7em'></label>
  <button data-act='check'>Check slip</button> <button data-act='clear'>Clear</button></p>
  <div id='ms-out'></div><div id='ms-ledger'></div><div id='ms-ops'></div>`;

  function outHtml() {
    if (!last) return '';
    if (last.err) return `<div class='empty'>${esc(last.err)}</div>`;
    const r = last.res;
    const GROUPS = [['H', 'D', 'A'], ['D1X', 'DX2', 'D12'], ['O', 'U'], ['B', 'N']];
    const rows = r.rows.map((x, i) => {
      const g = GROUPS.find((a) => a.includes(x.code));
      const pick = g ? `<select data-f='pick' data-i='${i}'>${g.map((c) => `<option value='${c}'${c === x.code ? ' selected' : ''}>${esc(LABEL[c] || c)}</option>`).join('')}</select>` : esc(x.label || x.pick || '');
      return `<tr><td>${esc(x.home)} v ${esc(x.away)}${x.youth ? ' <strong>(youth/reserve)</strong>' : ''}</td><td>${pick}</td><td><input type='number' step='0.01' min='1.01' value='${esc(x.odds)}' data-f='odds' data-i='${i}' style='width:5em'></td><td>${esc(x.status)}${x.score ? ' (' + esc(x.score) + ')' : ''}${x.matched ? '' : ' (no match found)'}</td><td>${pct(x.p)}</td><td><button data-act='rm' data-i='${i}'>x</button></td></tr>`;
    }).join('');
    const youthNote = r.rows.some((x) => x.youth) ? `<p><strong>Youth or reserve sides on this slip.</strong> Squads rotate and there is little reliable history, so any model figure for them is weak.</p>` : '';
    const warn = r.stake > MAX_SAFE_STAKE ? `<p><strong>Stake above KES ${MAX_SAFE_STAKE}.</strong> Your rule: stay at ${MAX_SAFE_STAKE} or less until about 100 settled bets show a profit.</p>` : '';
    const weak = (r.weakest || []).map((x) => `${esc(x.home)} v ${esc(x.away)} (${pct(x.p)})`).join(', ');
    const trims = (r.trims || []).map((t) => `drop ${t.drop} weakest: ${t.legs} legs, odds ${t.odds}, chance ${pct(t.p)}`).join('; ');
    const ladder = (r.ladder || []).map((l) => `first ${l.k}: chance ${pct(l.p)}, worth ~${kes(l.value)}`).join('; ');
    return `<h3>Verdict</h3>
    <p>${r.legsN} legs${r.declared && r.declared !== r.legsN ? ` (slip says ${r.declared}; ${r.declared - r.legsN} not read)` : ''}, total odds <strong>${esc(r.odds)}</strong>, stake ${kes(r.stake)}, payout if all win ${kes(r.payout)}.</p>
    ${r.dead ? `<p><strong>Already lost</strong> on ${esc(r.firstLoss)}.</p>` : `<p>Model chance the whole slip wins: <strong>${pct(r.pScratch, 1)}</strong>${r.pScratchBook != null ? ` (bookmaker prices imply ${pct(r.pScratchBook, 1)})` : ''}. Expected result on this stake: <strong>${r.ev == null ? '-' : kes(r.ev)}</strong>.</p>`}
    ${r.cash ? `<p>Cash-out estimate ~${kes(r.cash.offer)} now versus holding, expected ${kes(r.cash.hold)}.</p>` : ''}
    ${warn}${youthNote}
    <div style='overflow-x:auto'><table><thead><tr><th>Match</th><th>Pick</th><th>Odds</th><th>Status</th><th>Model</th><th></th></tr></thead><tbody>${rows}</tbody></table></div>
    ${weak ? `<p>Weakest legs: ${weak}</p>` : ''}${trims ? `<p>Shorter versions: ${trims}</p>` : ''}${ladder ? `<p>Cash-out ladder: ${ladder}</p>` : ''}
    ${r.unjudged && r.unjudged.length ? `<p class='muted'>Not judged (market or team not matched): ${r.unjudged.map(esc).join(', ')}</p>` : ''}
    ${r.dead ? '' : `<p><button data-act='save'>Save to my ledger</button></p>`}`;
  }

  function ledgerHtml() {
    const s = ledgerStats(ledger);
    const items = [...ledger].reverse().map((b) => {
      const open = b.status === 'open' || !b.status;
      return `<tr><td>${esc((b.ts || '').slice(0, 10))}</td><td>${esc(b.label || b.legs + ' legs')}</td><td>${esc(b.odds)}</td><td>${kes(b.stake)}</td><td>${esc(b.status || 'open')}</td><td>${num(b.returned) == null ? '' : kes(b.returned)}</td>
      <td>${open ? `<button data-act='won' data-id='${esc(b.id)}'>Won</button> <button data-act='lost' data-id='${esc(b.id)}'>Lost</button> <button data-act='cash' data-id='${esc(b.id)}'>Cashed</button> ` : ''}<button data-act='del' data-id='${esc(b.id)}'>x</button></td></tr>`;
    }).join('');
    const verdict = s.enough ? (s.profit > 0 ? 'Profitable over a meaningful sample.' : 'Not profitable over a meaningful sample: do not raise stakes.') : `Only ${s.settled} settled: too few to judge (about 100 needed).`;
    return `<h3>My ledger</h3>
    <p>${s.n} bets, ${s.open} open, ${s.settled} settled. Staked ${kes(s.staked)}, returned ${kes(s.returned)}, profit <strong>${kes(s.profit)}</strong>${s.roi == null ? '' : ` (${pct(s.roi, 1)})`}. Full wins ${s.fullWins}${s.modelled ? ` versus ~${(s.expectedFullWins || 0).toFixed(1)} expected by the model` : ''}.</p>
    <p>${verdict}</p>
    ${items ? `<div style='overflow-x:auto'><table><thead><tr><th>Date</th><th>Slip</th><th>Odds</th><th>Stake</th><th>Status</th><th>Returned</th><th></th></tr></thead><tbody>${items}</tbody></table></div>` : `<div class='empty'>No bets saved yet.</div>`}
    <p><button data-act='csv'>Export CSV</button></p>`;
  }

  function opsHtml() {
    const by = {};
    for (const o of ops) { if (o.hit == null) continue; const k = o.source.toLowerCase(); (by[k] = by[k] || { name: o.source, n: 0, hit: 0, conf: 0 }); by[k].n++; by[k].hit += o.hit ? 1 : 0; by[k].conf += o.conf / 100; }
    const sum = Object.values(by).map((b) => `<li><strong>${esc(b.name)}</strong>: ${b.hit}/${b.n} right (${pct(b.hit / b.n)}) while claiming ${pct(b.conf / b.n)} on average${b.n < 30 ? ' (too few to trust yet)' : ''}</li>`).join('');
    const srcs = [...new Set(ops.map((o) => o.source))].map((s) => `<option value='${esc(s)}'>`).join('');
    const rows = [...ops].reverse().map((o) => `<tr><td>${esc(o.date)}</td><td>${esc(o.source)}</td><td>${esc(o.match)}</td><td>${esc(o.pick)}</td><td>${esc(o.conf)}%</td><td>${o.hit == null ? `<button data-act='hit' data-id='${esc(o.id)}'>Right</button> <button data-act='miss' data-id='${esc(o.id)}'>Wrong</button>` : o.hit ? 'Right' : 'Wrong'}</td><td><button data-act='opdel' data-id='${esc(o.id)}'>x</button></td></tr>`).join('');
    return `<h3>Second opinions</h3>
    <p class='muted'>Log a pick from any source (Forebet, a tipster, a friend). Mark it right or wrong after the game and this shows whether the source really beats what it claims. Type the pick yourself; nothing is fetched.</p>
    <p><input id='op-src' list='op-srcs' placeholder='Source' style='width:8em'><datalist id='op-srcs'>${srcs}</datalist>
    <input id='op-match' placeholder='Home v Away' style='width:12em'> <input id='op-pick' placeholder='Pick, e.g. Home win, Over 2.5' style='width:12em'>
    <input id='op-conf' type='number' min='1' max='99' placeholder='Conf %' style='width:5em'> <button data-act='opadd'>Add</button></p>
    ${sum ? `<ul>${sum}</ul>` : ''}
    ${rows ? `<div style='overflow-x:auto'><table><thead><tr><th>Date</th><th>Source</th><th>Match</th><th>Pick</th><th>Claimed</th><th>Result</th><th></th></tr></thead><tbody>${rows}</tbody></table></div>` : ''}`;
  }

  const paint = () => { q('#ms-out').innerHTML = outHtml(); q('#ms-ledger').innerHTML = ledgerHtml(); q('#ms-ops').innerHTML = opsHtml(); };
  const saveL = () => store.set('pbt.ledger', ledger);
  const saveO = () => store.set('pbt.opinions', ops);

  async function recheck() {
    try {
      const { preds, registry, cal } = await loadEnv();
      const input = { stake: slip.stake, declared: slip.declared, legs: slip.legs };
      const resolve = (n) => registry.resolve(n, false), st = slip.stake || undefined;
      let res;
      try { res = checkSlip(input, { preds, resolve, cal, stake: st }); } catch (err) { res = checkSlip(input, { preds, resolve, cal: null, stake: st }); }
      last = { res };
    } catch (err) { last = { err: 'Could not check this slip: ' + err.message }; }
    paint();
  }
  root.addEventListener('change', async (e) => {
    const t = e.target;
    if (t.id === 'ms-stake') { if (slip) { slip.stake = num(t.value) || null; await recheck(); } return; }
    if (!slip || t.dataset.i === undefined) return;
    const l = slip.legs[Number(t.dataset.i)]; if (!l) return;
    if (t.dataset.f === 'odds') { const v = num(t.value); if (v && v > 1) l.odds = v; }
    if (t.dataset.f === 'pick') { l.code = t.value; l.label = LABEL[t.value] || t.value; }
    await recheck();
  });

  root.addEventListener('click', async (e) => {
    const b = e.target.closest('button[data-act]'); if (!b) return;
    const act = b.dataset.act, id = b.dataset.id;
    if (act === 'clear') { q('#ms-text').value = ''; last = null; paint(); return; }
    if (act === 'check') {
      const parsed = parseSlip(q('#ms-text').value);
      if (!parsed.legs.length) { last = { err: 'No legs found. Paste the slip text (a betslip with Your Pick lines, or a placed bet).' }; slip = null; paint(); return; }
      slip = { stake: num(q('#ms-stake').value) || parsed.stake || null, declared: parsed.declared, legs: parsed.legs };
      if (slip.stake) q('#ms-stake').value = slip.stake;
      await recheck(); return;
    }
    if (act === 'rm' && slip) {
      slip.legs.splice(Number(b.dataset.i), 1); slip.declared = null;
      if (!slip.legs.length) { slip = null; last = null; paint(); return; }
      await recheck(); return;
    }
    if (act === 'save' && last && last.res) {
      const r = last.res;
      ledger = [...ledger, newBet({ stake: r.stake, odds: r.odds, legs: r.legsN, modelProb: r.pScratch, label: r.rows.slice(0, 2).map((x) => x.home).join(', ') + (r.legsN > 2 ? '...' : '') })];
      saveL(); paint(); return;
    }
    if (act === 'csv') {
      const blob = new Blob([ledgerCsv(ledger)], { type: 'text/csv' }), a = document.createElement('a');
      a.href = URL.createObjectURL(blob); a.download = 'my-bets.csv'; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 2000); return;
    }
    const bet = ledger.find((x) => x.id === id);
    if (act === 'del') { ledger = ledger.filter((x) => x.id !== id); saveL(); paint(); return; }
    if (bet && (act === 'won' || act === 'lost' || act === 'cash')) {
      let ret = 0;
      if (act === 'won') { const v = prompt('Amount returned (KES)', String(Math.round(bet.stake * bet.odds))); if (v === null) return; ret = num(v) || 0; }
      if (act === 'cash') { const v = prompt('Cash-out amount received (KES)', String(bet.stake)); if (v === null) return; ret = num(v) || 0; }
      const out = settleBet(ledger, id, act === 'won' ? 'won' : act === 'lost' ? 'lost' : 'cashed', ret);
      if (Array.isArray(out)) ledger = out;
      saveL(); paint(); return;
    }
    if (act === 'opadd') {
      const o = { id: 'o' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5), date: new Date().toISOString().slice(0, 10), source: q('#op-src').value.trim(), match: q('#op-match').value.trim(), pick: q('#op-pick').value.trim(), conf: num(q('#op-conf').value), hit: null };
      if (!o.source || !o.match || !o.pick || !o.conf) return;
      ops = [...ops, o]; saveO(); paint(); return;
    }
    if (act === 'hit' || act === 'miss') { const o = ops.find((x) => x.id === id); if (o) { o.hit = act === 'hit'; saveO(); paint(); } return; }
    if (act === 'opdel') { ops = ops.filter((x) => x.id !== id); saveO(); paint(); }
  });
  paint();
}
