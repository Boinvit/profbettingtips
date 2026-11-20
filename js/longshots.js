// Long shots tab: each day up to 3 slips built from the most reliable matches (most likely outcome only, at most 6 legs). The agent learns from settled results; this tab shows the track record and whether staking looks worthwhile. Entertainment only.
const esc = (s) => String(s ?? '').replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
const pct = (x, d = 0) => (Number.isFinite(x) ? (x * 100).toFixed(d) + '%' : '-');
const sgn = (x) => (Number.isFinite(x) ? (x >= 0 ? '+' : '') + (x * 100).toFixed(0) + '%' : '-');
const chance = (p) => (p >= 0.01 ? pct(p, 1) : p > 0 ? 'about 1 in ' + Math.round(1 / p).toLocaleString('en-KE') : '-');
const kes = (x) => 'KES ' + Math.round(x).toLocaleString('en-KE');
const TZ = 'Africa/Nairobi';
const hhmm = (iso) => new Date(iso).toLocaleTimeString('en-KE', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: TZ });
const dayName = (d) => new Date(d + 'T12:00:00Z').toLocaleDateString('en-KE', { weekday: 'short', day: 'numeric', month: 'short', timeZone: TZ });
const VERDICT = { no: ['no', 'Do not stake'], wait: ['main', 'Wait for more results'], tiny: ['ok', 'Small stake only'] };

const legRow = (l) => `<div class='row'><div class='t'>${esc(hhmm(l.kickoff))}<small>${esc(l.comp)}</small></div><div class='m'>${esc(l.home)} vs ${esc(l.away)}<small>${esc(l.label)}</small></div><div class='pick'><span class='chip ${l.ok === undefined ? '' : l.ok ? 'ok' : 'no'}'>@${Number(l.odds).toFixed(2)} · ${pct(l.p, 0)}${l.res ? ` · ${l.res.hg}–${l.res.ag}` : ''}${l.ok === undefined ? '' : l.ok ? ' ✓' : ' ✗'}</span></div></div>`;

const slipCard = (a) => `<div class='panel acca ${a.status}'><h3>Slip ${esc(a.key)} · ${a.legs.length} legs · ${Number(a.odds).toFixed(2)} odds ${a.status === 'won' ? '✅ Won' : a.status === 'lost' ? '❌ Lost' : ''}</h3>
  <p class='note'>Chance every leg lands: <b>${chance(a.pAll)}</b>${a.status === 'pending' ? ` · on average KES 10 would return about ${kes(10 + a.ev10)}` : ''}</p>
  ${a.unconfirmed ? `<p class='muted'><strong>Not confirmed on SportPesa:</strong> check each match is offered before betting.</p>` : ''}
  ${a.legs.map(legRow).join('')}</div>`;

const row = (label, s) => `<tr><td>${label}</td><td>${s.slips ? s.won + ' / ' + s.slips : '-'}</td><td>${s.slips ? s.expectedWins : '-'}</td><td>${s.slips ? sgn(s.roi) : '-'}</td><td>${s.legs ? s.legsWon + ' / ' + s.legs + ' (' + pct(s.legsWon / s.legs, 0) + ', claimed ' + pct(s.legClaimed, 0) + ')' : '-'}</td></tr>`;

export async function mountLongShots(root) {
  if (!root) return;
  root.innerHTML = `<p class='muted'>Loading long shots...</p>`;
  let d = null;
  try { const r = await fetch('data/longshots.json?t=' + Date.now()); d = r.ok ? await r.json() : null; } catch (e) { d = null; }
  const items = (d && d.items) || [], S = d && d.summary;
  const mine = (a) => 'ABC1'.includes(a.key);
  const open = items.filter((a) => a.status === 'pending' && mine(a)).sort((a, b) => a.day.localeCompare(b.day) || a.key.localeCompare(b.key));
  const past = items.filter((a) => (a.status === 'won' || a.status === 'lost') && mine(a)).sort((a, b) => b.day.localeCompare(a.day) || a.key.localeCompare(b.key));
  let out = '';
  if (S && S.advice) {
    const v = VERDICT[S.advice.verdict] || VERDICT.wait, P = S.periods || {}, L = S.learned, B = S.backtest;
    out += `<div class='panel'><h3>Should I stake? <span class='chip ${v[0]}'>${v[1]}</span></h3><p><b>${esc(S.advice.headline)}</b></p><ul>${S.advice.lines.map((x) => `<li>${esc(x)}</li>`).join('')}</ul>${S.form ? `<p class='note'>Latest slips, newest first: <b>${esc(S.form)}</b> (W won, L lost)</p>` : ''}</div>`;
    out += `<div class='panel'><h3>Results of past long shots</h3><div style='overflow-x:auto'><table class='tbl'><thead><tr><th>Period</th><th>Slips won</th><th>Expected</th><th>Return on KES 10 a slip</th><th>Single matches landed</th></tr></thead><tbody>${row('Last 7 days', P.d7 || {})}${row('Last 30 days', P.d30 || {})}${row('All', P.all || {})}</tbody></table></div><p class='note'>Expected is how many slips the model thought would win. Return counts every settled slip staked at KES 10.</p></div>`;
    if (B && B.slips) out += `<div class='panel'><h3>Replay on past matches</h3><p class='note'>Applying today's rule to ${B.days} past days, each judged only on what was known before it and with odds estimated by the model: ${B.won} of ${B.slips} slips would have won, expected about ${B.expected}. The single top outcome landed ${pct(B.legsWon / B.legsN, 0)} of the time over ${B.legsN} matches.</p></div>`;
    if (L && L.bands && L.bands.length) out += `<div class='panel'><h3>What the agent has learned</h3><p class='note'>It compares each claimed chance with what really happened, corrects future chances, and drops matches that fall below the floor.</p>${L.bands.map((b) => `<div class='row'><div class='m'>Claimed ${pct(b.lo, 0)} to ${pct(b.hi, 0)}<small>${b.n} matches</small></div><div class='pick'><span class='chip ${b.rate + 0.03 >= b.claimed ? 'ok' : 'no'}'>landed ${pct(b.rate, 0)}</span></div></div>`).join('')}</div>`;
  }
  if (!open.length) out += `<div class='empty'>No long shot slips for the coming matches yet. The agent builds them when at least 4 reliable matches are available in a day.</div>`;
  else { let day = ''; for (const a of open) { if (a.day !== day) { day = a.day; out += `<div class='day'>${esc(dayName(day))}</div>`; } out += slipCard(a); } }
  if (past.length) { out += `<div class='day'>Past long shots</div>`; let day = ''; for (const a of past.slice(0, 30)) { if (a.day !== day) { day = a.day; out += `<p class='note'><b>${esc(dayName(day))}</b></p>`; } out += slipCard(a); } }
  out += `<p class='note'>Entertainment only. No slip is guaranteed, and the model's own numbers say a long slip loses more often than it wins. Stake only what you can afford to lose.</p>`;
  root.innerHTML = out;
}
