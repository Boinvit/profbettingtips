// Long shots tab: up to 24 matches a day as five slips (1st, 2nd, 3rd, 4th most likely outcome of each match, then a mix). Entertainment only.
const esc = (s) => String(s ?? '').replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
const pct = (x, d = 0) => (Number.isFinite(x) ? (x * 100).toFixed(d) + '%' : '-');
const chance = (p) => (p >= 0.01 ? pct(p, 1) : p > 0 ? 'about 1 in ' + Math.round(1 / p).toLocaleString('en-KE') : '-');
const kes = (x) => 'KES ' + Math.round(x).toLocaleString('en-KE');
const eat = (iso) => new Date(Date.parse(iso) + 3 * 3600e3).toISOString().slice(11, 16);
const TITLES = { '1': 'Slip 1: the most likely outcome of every match', '2': 'Slip 2: the second most likely outcome', '3': 'Slip 3: the third most likely outcome', '4': 'Slip 4: the fourth most likely outcome', mix: 'Slip 5: a mix of outcomes' };
const RANKS = { 1: '1st', 2: '2nd', 3: '3rd', 4: '4th' };

export async function mountLongShots(root) {
  if (!root) return;
  root.innerHTML = `<p class='muted'>Loading long shots...</p>`;
  let d = null;
  try { const r = await fetch('data/longshots.json?t=' + Date.now()); d = r.ok ? await r.json() : null; } catch (e) { d = null; }
  const items = (d && d.items) || [];
  const open = items.filter((a) => a.status === 'pending').sort((a, b) => a.day.localeCompare(b.day) || a.n - b.n);
  const st = (d && d.stats) || {};
  const card = (a) => {
    const rows = a.legs.map((l) => `<tr><td>${eat(l.kickoff)}</td><td>${esc(l.home)} v ${esc(l.away)}</td><td>${esc(l.label)}</td><td>${RANKS[l.rank] || ''}</td><td>${pct(l.p)}</td><td>${esc(l.odds)}${l.src === 'model' ? ' est.' : ''}</td></tr>`).join('');
    return `<div class='card' style='margin:1em 0'>
      <h3>${esc(a.day)} - ${esc(TITLES[a.key] || 'Long shot ' + a.n)} (${a.legs.length} legs, total odds ${esc(a.odds)})</h3>
      <p>Chance every leg wins (model): <strong>${chance(a.pAll)}</strong>. KES 10 would pay about <strong>${kes(10 * a.odds)}</strong>. Expected result per KES 10: <strong>${a.ev10 >= 0 ? '+' : ''}${a.ev10} KES</strong>.</p>
      <div style='overflow-x:auto'><table><thead><tr><th>EAT</th><th>Match</th><th>Pick</th><th>Rank</th><th>Chance</th><th>Odds</th></tr></thead><tbody>${rows}</tbody></table></div>
      ${a.modelPriced ? `<p class='muted'>${a.modelPriced} of ${a.legs.length} odds are the model's own estimate (marked est.). Real SportPesa odds differ: paste the slip into My slips to see the true figures.</p>` : ''}</div>`;
  };
  const days = [...new Set(open.map((a) => a.day))];
  const sums = days.map((day) => { const own = open.filter((a) => a.day === day), cost = 10 * own.length, back = cost + own.reduce((s, a) => s + a.ev10, 0); return `<p>${esc(day)}: staking KES 10 on each of its ${own.length} slips costs ${kes(cost)} and is expected, on the model's numbers, to return about <strong>${kes(back)}</strong>.</p>`; }).join('');
  const rk = st.byRank || {};
  const rankRows = Object.keys(rk).filter((k) => RANKS[k]).map((k) => `<li>${RANKS[k]} outcome: ${rk[k].won} of ${rk[k].n} won, against ${pct(rk[k].claimed)} claimed</li>`).join('');
  const hist = st.legsSettled
    ? `<h3>Track record</h3><p>${st.won} of ${st.settled} settled slips won (the model expected about ${st.expectedWins}). Single legs: ${st.legsWon} of ${st.legsSettled} won, against ${pct(st.legClaimed)} claimed on average.</p>${rankRows ? `<ul>${rankRows}</ul>` : ''}`
    : `<p class='muted'>No settled long shots yet. Once some have, this shows how often each outcome rank really wins compared with what the model claims.</p>`;
  root.innerHTML = `<h2>Long shots</h2>
  <p><strong>For fun, tiny stakes only.</strong> Up to 24 of the day's most likely matches (60% or better for the top outcome; youth, reserve and thin-data games are left out), laid out as five slips: the most likely outcome of every match, then the second, third and fourth most likely, then a mix. Stake them in that order, as you plan. The slips share the same matches, so one surprise result can sink several at once. A 24-leg slip almost never lands, and on the model's own numbers the set loses money on average, so keep the total across all five small.</p>
  ${open.length ? sums + open.map(card).join('') : `<div class='empty'>No long shots yet. They are built when at least 4 matches clear 60%, so check back after the next agent run.</div>`}
  ${hist}`;
}
