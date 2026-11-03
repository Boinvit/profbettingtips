// Long shots tab: daily many-leg slips, every leg at least 66% by the calibrated model. Entertainment only.
const esc = (s) => String(s ?? '').replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
const pct = (x, d = 0) => (Number.isFinite(x) ? (x * 100).toFixed(d) + '%' : '-');
const kes = (x) => 'KES ' + Math.round(x).toLocaleString('en-KE');
const eat = (iso) => new Date(Date.parse(iso) + 3 * 3600e3).toISOString().slice(11, 16);

export async function mountLongShots(root) {
  if (!root) return;
  root.innerHTML = `<p class='muted'>Loading long shots...</p>`;
  let d = null;
  try { const r = await fetch('data/longshots.json?t=' + Date.now()); d = r.ok ? await r.json() : null; } catch (e) { d = null; }
  const items = (d && d.items) || [];
  const open = items.filter((a) => a.status === 'pending').sort((a, b) => a.day.localeCompare(b.day) || a.n - b.n);
  const st = (d && d.stats) || {};
  const perDay = {};
  for (const a of open) perDay[a.day] = (perDay[a.day] || 0) + 1;
  const short = Object.entries(perDay).filter(([, n]) => n < 3).map(([day, n]) => `<p class='muted'>${esc(day)}: only ${n} slip${n === 1 ? '' : 's'}, because not enough matches clear 66% that day.</p>`).join('');
  const card = (a) => {
    const rows = a.legs.map((l) => `<tr><td>${eat(l.kickoff)}</td><td>${esc(l.home)} v ${esc(l.away)}</td><td>${esc(l.label)}</td><td>${pct(l.p)}</td><td>${esc(l.odds)}${l.src === 'model' ? ' est.' : ''}</td></tr>`).join('');
    return `<div class='card' style='margin:1em 0'>
      <h3>${esc(a.day)} - Long shot ${esc(a.n)}: ${a.legs.length} legs, total odds ${esc(a.odds)}</h3>
      <p>Chance every leg wins (model): <strong>${pct(a.pAll, 1)}</strong>. KES 10 would pay about <strong>${kes(10 * a.odds)}</strong>. Expected result per KES 10: <strong>${a.ev10 >= 0 ? '+' : ''}${a.ev10} KES</strong>.</p>
      <div style='overflow-x:auto'><table><thead><tr><th>EAT</th><th>Match</th><th>Pick</th><th>Chance</th><th>Odds</th></tr></thead><tbody>${rows}</tbody></table></div>
      ${a.modelPriced ? `<p class='muted'>${a.modelPriced} of ${a.legs.length} odds are the model's own estimate (marked est.). Real SportPesa odds differ: paste the slip into My slips to see the true figures.</p>` : ''}</div>`;
  };
  const hist = st.settled
    ? `<h3>Track record</h3><p>${st.won} of ${st.settled} settled slips won (the model expected about ${st.expectedWins}). Single legs: ${st.legsWon} of ${st.legsSettled} won, against ${pct(st.legClaimed)} claimed on average.</p>`
    : `<p class='muted'>No settled long shots yet. Once some have, this shows whether the 66% legs really win about two thirds of the time.</p>`;
  root.innerHTML = `<h2>Long shots</h2>
  <p><strong>For fun, tiny stakes only (KES 10 to 20).</strong> Every leg is at least 66% by the calibrated model, no match is used twice, and youth, reserve and thin-data games are left out. But chaining many legs multiplies the risk: each card shows the whole-slip chance, and on the model's own numbers these slips lose money on average. Keep them out of your serious betting budget.</p>
  ${short}${open.length ? open.map(card).join('') : `<div class='empty'>No long shots yet. They are created when enough matches clear 66%, so check back after the next agent run.</div>`}
  ${hist}`;
}
