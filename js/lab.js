/* Prediction Lab — static viewer. Reads /data/*.json written by the agent (no backend). */
import { predict, picks, newState } from '../agent/lib/model.mjs';
(() => {
  const TZ = 'Africa/Nairobi';
  const $ = (s) => document.querySelector(s);
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const pct = (x, d = 0) => (x == null ? '–' : (x * 100).toFixed(d) + '%');
  const COMP = { PL: 'Premier League', ELC: 'Championship', BL1: 'Bundesliga', SA: 'Serie A', PD: 'La Liga', FL1: 'Ligue 1', DED: 'Eredivisie', PPL: 'Primeira Liga', CL: 'Champions League', BSA: 'Brasileirão', EC: 'Euros', WC: 'World Cup', X: '',
    E0: 'Premier League', E1: 'Championship', E2: 'League One', E3: 'League Two', EC: 'National League', SC0: 'Scottish Premiership', SC1: 'Scottish Championship', SC2: 'Scottish League One', SC3: 'Scottish League Two',
    D1: 'Bundesliga', D2: '2. Bundesliga', I1: 'Serie A', I2: 'Serie B', SP1: 'La Liga', SP2: 'La Liga 2', F1: 'Ligue 1', F2: 'Ligue 2', N1: 'Eredivisie', B1: 'Belgian Pro League', P1: 'Primeira Liga', T1: 'Süper Lig', G1: 'Super League Greece',
    ARG: 'Argentina', AUT: 'Austria', BRA: 'Brazil Série A', CHN: 'China', DNK: 'Denmark', FIN: 'Finland', IRL: 'Ireland', JPN: 'Japan', MEX: 'Mexico', NOR: 'Norway', POL: 'Poland', ROU: 'Romania', RUS: 'Russia', SWE: 'Sweden', SWZ: 'Switzerland', USA: 'USA MLS' };
  let filter = 'all';
  const PICK = { H: 'Home', D: 'Draw', A: 'Away' };
  const MKT = { x12: '1X2', dc: 'Double chance', ou: 'Over/Under 2.5', bt: 'Both teams score' };
  const data = {};

  const get = (f, fb) => fetch(`data/${f}?t=${Date.now()}`).then((r) => (r.ok ? r.json() : fb)).catch(() => fb);
  const day = (iso) => new Date(iso).toLocaleDateString('en-KE', { weekday: 'long', day: 'numeric', month: 'long', timeZone: TZ });
  const time = (iso) => new Date(iso).toLocaleTimeString('en-KE', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: TZ });
  const wilson = (c, n) => { if (!n) return null; const z = 1.96, p = c / n, d = 1 + z * z / n, m = p + z * z / (2 * n), r = z * Math.sqrt(p * (1 - p) / n + z * z / (4 * n * n)); return [(m - r) / d, (m + r) / d]; };

  const label = (k, pk) => ({ x12: PICK[pk.x12], dc: pk.dc, ou: pk.ou === 'O' ? 'Over 2.5' : 'Under 2.5', bt: pk.bt === 'Y' ? 'BTTS Yes' : 'BTTS No' }[k]);
  const probBar = (p) => `<div class="probs" role="img" aria-label="Home ${pct(p.h)}, draw ${pct(p.d)}, away ${pct(p.a)}"><i class="h" style="width:${p.h * 100}%"></i><i class="d" style="width:${p.d * 100}%"></i><i class="a" style="width:${p.a * 100}%"></i></div><div class="plabel"><span>H ${pct(p.h)}</span><span>D ${pct(p.d)}</span><span>A ${pct(p.a)}</span></div>`;
  const chip = (k, p, ok) => `<span class="chip ${ok === undefined ? (k === 'x12' ? 'main' : '') : ok ? 'ok' : 'no'}" title="${MKT[k]}">${esc(label(k, p.pk))}${ok === undefined ? '' : ok ? ' ✓' : ' ✗'}</span>`;

  const extras = (p) => {
    const bits = [];
    if (p.form && (p.form[0] || p.form[1])) bits.push(`Form H ${esc(p.form[0] || '–')} · A ${esc(p.form[1] || '–')}`);
    const c = p.ctx || {};
    if (c.odds) bits.push('odds-blended');
    if (c.club) bits.push('ClubElo');
    const n = c.news, adj = (n?.h?.adj || 0) + (n?.a?.adj || 0);
    if (n && (n.h?.adj || n.a?.adj)) bits.push(`<span class="warn" title="${esc([...(n.h?.headlines || []), ...(n.a?.headlines || [])].join(' | '))}">⚠ team news</span>`);
    return bits.length ? `<div class="note x">${bits.join(' · ')}</div>` : '';
  };
  // ---- Matchup: any two teams, same model as the agent, run in the browser ----
  let mu = { home: '', away: '', neutral: false, odds: ['', '', ''], out: '' };
  const idByName = () => Object.fromEntries(Object.entries(data.ratings?.teams || {}).map(([id, t]) => [t.n.toLowerCase(), id]));
  const poissonTop = (lh, la) => { const f = [1, 1, 2, 6, 24, 120, 720, 5040, 40320, 362880]; const pm = (l, k) => Math.exp(-l) * l ** k / f[k]; const r = []; for (let i = 0; i < 7; i++) for (let j = 0; j < 7; j++) r.push([`${i}–${j}`, pm(lh, i) * pm(la, j)]); return r.sort((a, b) => b[1] - a[1]).slice(0, 3); };
  const formDots = (f) => (f || '').split('').map((c) => `<span class="chip ${c === 'W' ? 'ok' : c === 'L' ? 'no' : ''}">${c}</span>`).join('') || '–';
  async function analyse() {
    const R = data.ratings, ids = idByName();
    const hid = ids[mu.home.trim().toLowerCase()], aid = ids[mu.away.trim().toLowerCase()];
    if (!hid || !aid) { mu.out = `<div class="empty">Pick both teams from the suggestions. Teams the model has fewer than 3 matches for aren't listed.</div>`; return; }
    if (hid === aid) { mu.out = `<div class="empty">Choose two different teams.</div>`; return; }
    const H = R.teams[hid], A = R.teams[aid];
    const s = newState();
    for (const [id, t] of [[hid, H], [aid, A]]) { s.elo[id] = t.e; s.att[id] = t.a; s.def[id] = t.d; s.n[id] = t.g; s.form[id] = t.f || ''; }
    s.lg = R.lg;
    const params = { ...R.params, ...(mu.neutral ? { homeAdv: 0 } : {}) };
    const ctx = {};
    const od = mu.odds.map(parseFloat); if (od.every((x) => x > 1.01)) ctx.odds = od;
    if (H.ce && A.ce) ctx.clubDiff = H.ce - A.ce;
    const nw = data.news || {}; ctx.newsH = nw[hid]?.adj || 0; ctx.newsA = nw[aid]?.adj || 0;
    const comp = H.c || 'X';
    const p = predict(s, params, comp, hid, aid, ctx), pk = picks(p), p0 = predict(s, params, comp, hid, aid);
    const top = poissonTop(p.xgH, p.xgA);
    // head to head (lazy-load history)
    if (!data.matches) data.matches = await get('matches.json', []);
    const h2h = data.matches.filter((m) => (m.h === hid && m.a === aid) || (m.h === aid && m.a === hid)).slice(-6).reverse();
    const lastRows = (t) => t.l.map((x) => `<tr><td>${x.d}</td><td style="text-align:left">${x.home ? 'vs' : '@'} ${esc(x.o)}</td><td>${x.gf}–${x.ga}</td><td><span class="chip ${x.gf > x.ga ? 'ok' : x.gf < x.ga ? 'no' : ''}">${x.gf > x.ga ? 'W' : x.gf < x.ga ? 'L' : 'D'}</span></td></tr>`).join('');
    const why = [];
    const dE = H.e - A.e + (mu.neutral ? 0 : params.homeAdv);
    why.push(`Rating gap: ${esc(H.n)} ${H.e} vs ${esc(A.n)} ${A.e}${mu.neutral ? ' (neutral venue)' : ` (+${Math.round(params.homeAdv)} for home advantage → ${dE > 0 ? '+' : ''}${Math.round(dE)} in favour of ${dE >= 0 ? esc(H.n) : esc(A.n)})`}.`);
    why.push(`Scoring strength (1.00 = league average): ${esc(H.n)} attack ${H.a.toFixed(2)} / defence ${H.d.toFixed(2)}; ${esc(A.n)} attack ${A.a.toFixed(2)} / defence ${A.d.toFixed(2)}. Lower defence is better.`);
    why.push(`Expected goals: ${p.xgH.toFixed(2)} – ${p.xgA.toFixed(2)}. Most likely scores: ${top.map((t) => `${t[0]} (${pct(t[1], 0)})`).join(', ')}.`);
    if (ctx.odds) why.push(`Your bookmaker odds were blended in (${pct(R.params.wOdds, 0)} weight, learned from history).`);
    if (ctx.clubDiff != null) why.push(`ClubElo agrees on the direction: ${H.ce} vs ${A.ce}.`);
    for (const [id, t] of [[hid, H], [aid, A]]) { const n = nw[id]; if (n && n.headlines?.length) why.push(`News on ${esc(t.n)}: ${n.headlines.map(esc).join(' | ')} (rating ${n.adj > 0 ? '+' : ''}${n.adj}).`); }
    if (Math.min(H.g, A.g) < 10) why.push('<span class="warn">Limited match history for one team, so treat this with extra caution.</span>');
    if (H.c !== A.c) why.push('<span class="warn">Teams are from different competitions; ratings are less comparable across leagues.</span>');
    mu.out = `<div class="panel"><h3>${esc(H.n)} vs ${esc(A.n)}</h3>${probBar({ h: p.pH, d: p.pD, a: p.pA })}
      <p style="margin:12px 0"><span class="chip main">${esc(label('x12', pk))} ${pct(pk.x12p)}</span> <span class="chip">${esc(label('dc', pk))} ${pct(pk.dcp)}</span> <span class="chip">${esc(label('ou', pk))} ${pct(pk.oup)}</span> <span class="chip">${esc(label('bt', pk))} ${pct(pk.btp)}</span></p>
      <p class="note">Plain model (no odds/news): H ${pct(p0.pH)} · D ${pct(p0.pD)} · A ${pct(p0.pA)}. Confidence is the model's own estimate; check the Accuracy tab for how reliable that has been.</p></div>
      <div class="panel"><h3>Why</h3><ul style="padding-left:18px;color:var(--text-2);line-height:1.7">${why.map((w) => `<li>${w}</li>`).join('')}</ul></div>
      <div class="panel"><h3>Form</h3><p>${esc(H.n)}: ${formDots(H.f)}<br>${esc(A.n)}: ${formDots(A.f)}</p>
        <table class="tbl"><thead><tr><th colspan="4" style="text-align:left">${esc(H.n)} recent</th></tr></thead><tbody>${lastRows(H)}</tbody></table>
        <table class="tbl" style="margin-top:12px"><thead><tr><th colspan="4" style="text-align:left">${esc(A.n)} recent</th></tr></thead><tbody>${lastRows(A)}</tbody></table></div>
      <div class="panel"><h3>Head to head</h3>${h2h.length ? `<table class="tbl"><tbody>${h2h.map((m) => `<tr><td>${m.d.slice(0, 10)}</td><td style="text-align:left">${esc(R.teams[m.h]?.n || '')} ${m.hg}–${m.ag} ${esc(R.teams[m.a]?.n || '')}</td></tr>`).join('')}</tbody></table>` : '<p class="note">No meetings in the stored history.</p>'}</div>`;
  }

  const views = {
    matchup() {
      const R = data.ratings;
      if (!R || !Object.keys(R.teams || {}).length) return `<div class="empty">The model has no team ratings yet. They appear after the agent's first run.</div>`;
      const opts = Object.values(R.teams).sort((a, b) => a.n.localeCompare(b.n)).map((t) => `<option value="${esc(t.n)}">`).join('');
      return `<datalist id="teams">${opts}</datalist>
        <form class="panel mu" id="mu-form"><h3>Compare any two teams</h3>
          <div class="mu-grid"><label>Home team<input list="teams" id="mu-h" value="${esc(mu.home)}" placeholder="e.g. Arsenal" autocomplete="off"></label>
          <label>Away team<input list="teams" id="mu-a" value="${esc(mu.away)}" placeholder="e.g. Chelsea" autocomplete="off"></label></div>
          <div class="mu-grid"><label>Odds 1 (optional)<input id="mu-o1" inputmode="decimal" value="${esc(mu.odds[0])}" placeholder="2.10"></label><label>Odds X<input id="mu-o2" inputmode="decimal" value="${esc(mu.odds[1])}" placeholder="3.40"></label><label>Odds 2<input id="mu-o3" inputmode="decimal" value="${esc(mu.odds[2])}" placeholder="3.60"></label></div>
          <label class="chk"><input type="checkbox" id="mu-n" ${mu.neutral ? 'checked' : ''}> Neutral venue</label>
          <button class="btn btn-gold" type="submit" style="margin-top:10px">Analyse match</button></form>${mu.out}`;
    },
    upcoming() {
      const now = Date.now();
      const all = data.recent.filter((p) => p.status === 'pending' && new Date(p.kickoff) > now);
      const nL = all.filter((p) => p.listed).length;
      const list = filter === 'listed' ? all.filter((p) => p.listed) : all;
      const bar = `<div class="filters" role="group" aria-label="Filter"><button class="chip ${filter === 'all' ? 'main' : ''}" data-filter="all">All (${all.length})</button> <button class="chip ${filter === 'listed' ? 'main' : ''}" data-filter="listed">SportPesa listed (${nL})</button></div>`;
      if (!list.length) return all.length ? bar + `<div class="empty">No SportPesa-listed games with predictions yet. See Accuracy → Data sources.</div>` : `<div class="empty">No upcoming predictions yet. The agent publishes them after each run once fixtures are available.</div>`;
      let out = bar, cur = '';
      for (const p of list) {
        const d = day(p.kickoff);
        if (d !== cur) { out += `<div class="day">${esc(d)}</div>`; cur = d; }
        out += `<div class="row"><div class="t">${time(p.kickoff)}<small>EAT</small></div>
          <div class="m">${esc(p.home)} vs ${esc(p.away)}<small>${esc(COMP[p.comp] || p.comp)}${p.listed ? ' · <span class="tag">SportPesa</span>' : ''}${p.games < 5 ? ' · <span class="warn">limited data</span>' : ''}</small>${extras(p)}</div>
          <div class="pick">${chip('x12', p)} ${chip('dc', p)} ${chip('ou', p)} ${chip('bt', p)}</div>
          ${probBar(p.p)}</div>`;
      }
      return out;
    },
    results() {
      const list = data.recent.filter((p) => p.status === 'settled').sort((a, b) => b.kickoff.localeCompare(a.kickoff));
      if (!list.length) return `<div class="empty">No graded predictions yet. Results appear here after matches finish.</div>`;
      let out = '', cur = '';
      for (const p of list) {
        const d = day(p.kickoff);
        if (d !== cur) { out += `<div class="day">${esc(d)}</div>`; cur = d; }
        out += `<div class="row"><div class="t score">${p.result.hg}–${p.result.ag}</div>
          <div class="m">${esc(p.home)} vs ${esc(p.away)}<small>${esc(COMP[p.comp] || p.comp)}</small></div>
          <div class="pick">${['x12', 'dc', 'ou', 'bt'].map((k) => chip(k, p, p.ok[k])).join(' ')}</div></div>`;
      }
      return out;
    },
    jackpots() {
      const js = [...data.jackpots].sort((a, b) => (b.created || '').localeCompare(a.created || ''));
      if (!js.length) return `<div class="empty">No jackpot loaded. Paste the match list into <code>data/jackpots/inbox.txt</code> in the GitHub repo and the agent will predict every game.</div>`;
      return js.map((j) => {
        const done = j.games.filter((g) => g.result), hit = done.filter((g) => g.ok.x12).length;
        const rows = j.games.map((g) => `<tr><td>${g.n}</td><td style="text-align:left">${esc(g.home)} vs ${esc(g.away)}${g.known ? '' : ' <span class="warn" title="Team not found in model data; low-confidence guess">⚠</span>'}</td>
          <td><span class="chip main">${PICK[g.pk.x12]} ${pct(g.pk.x12p)}</span></td><td><span class="chip dim">${PICK[g.pk.alt]} ${pct(g.pk.altp)}</span></td>
          <td>${pct(g.p.h)} / ${pct(g.p.d)} / ${pct(g.p.a)}</td>
          <td>${g.result ? `${g.result.hg}–${g.result.ag} <span class="chip ${g.ok.x12 ? 'ok' : 'no'}">${g.ok.x12 ? '✓' : '✗'}</span>` : '–'}</td></tr>`).join('');
        const weak = [...j.games].sort((a, b) => a.pk.x12p - b.pk.x12p).slice(0, 3).map((g) => `#${g.n}`).join(', ');
        return `<div class="panel"><div class="jp-head"><h3>${esc(j.name)}</h3>
          <span class="note">${j.closes ? 'Closes ' + day(j.closes) + ' ' + time(j.closes) + ' EAT' : ''}${j.prize ? ' · Prize ' + esc(j.prize) : ''}</span></div>
          <p class="note">Expected correct: <b>${j.summary.expectedCorrect}</b> of ${j.games.length}. Chance of a perfect card: <b>about 1 in ${Math.round(1 / j.summary.pAllCorrect).toLocaleString('en-KE')}</b> (single-pick basis).
          Least certain games: <b>${weak}</b>${j.summary.unknownTeams ? ` · <span class="warn">${j.summary.unknownTeams} game(s) with unknown teams</span>` : ''}.
          ${done.length ? ` Graded so far: <b>${hit}/${done.length}</b>.` : ''}</p>
          <table class="tbl"><thead><tr><th>#</th><th style="text-align:left">Match</th><th>Pick</th><th>Next best</th><th>H / D / A</th><th>Result</th></tr></thead><tbody>${rows}</tbody></table></div>`;
      }).join('');
    },
    accuracy() {
      const s = data.stats;
      if (!s || !s.settled) return `<div class="empty">No graded predictions yet. This tab fills in as results arrive.</div>${(data.sources?.health || []).length ? '<div class="panel" style="margin-top:16px"><h3>Data sources</h3><table class="tbl"><tbody>' + data.sources.health.map((h) => `<tr><td style="text-align:left">${esc(h.source)}</td><td>${h.ok ? 'OK' : 'Problem'}</td><td style="text-align:left">${esc(h.detail)}</td></tr>`).join('') + '</tbody></table></div>' : ''}`;
      const mk = (k) => { const m = s.markets[k], w = wilson(m.correct, m.n); return `<div class="kpi"><div class="l">${MKT[k]}</div><div class="v">${pct(m.acc, 1)}</div><div class="s">${m.correct}/${m.n}${w ? ` · 95% range ${pct(w[0])}–${pct(w[1])}` : ''}</div></div>`; };
      const small = s.settled < 100 ? `<div class="lab-banner"><b>Small sample.</b> ${s.settled} graded predictions is too few to judge. Treat accuracy figures as noise until you have a few hundred.</div>` : '';
      const base = s.scoring;
      const conf = s.byConf.map((b) => `<tr><td>${b.key}</td><td>${b.n}</td><td>${pct(b.predicted, 1)}</td><td>${pct(b.actual, 1)}</td></tr>`).join('');
      const comp = s.byComp.map((b) => `<tr><td>${esc(COMP[b.key] || b.key)}</td><td>${b.n}</td><td>${pct(b.x12, 1)}</td><td>${pct(b.ou, 1)}</td><td>${pct(b.bt, 1)}</td></tr>`).join('');
      const ver = s.byModel.map((b) => `<tr><td>${esc(b.key)}</td><td>${b.n}</td><td>${pct(b.x12, 1)}</td></tr>`).join('');
      const jp = (s.jackpots || []).map((j) => `<tr><td style="text-align:left">${esc(j.name)}</td><td>${j.settled}/${j.total}</td><td>${j.correct}</td><td>${j.correctDC}</td></tr>`).join('');
      const e = s.enhanced || { n: 0 };
      const ab = e.n ? `<div class="panel"><h3>Does the extra data help?</h3><p class="note">Every prediction stores a plain-model version next to the full version (bookmaker odds, ClubElo, team news). Same games, so this is a fair test.</p>
        <table class="tbl"><thead><tr><th></th><th>Games</th><th>1X2 accuracy</th><th>Log-loss</th></tr></thead><tbody>
        <tr><td>Plain model</td><td>${e.n}</td><td>${pct(e.base.acc, 1)}</td><td>${e.base.logloss}</td></tr>
        <tr><td>Full (odds + ClubElo + news)</td><td>${e.n}</td><td>${pct(e.full.acc, 1)}</td><td>${e.full.logloss}</td></tr>
        <tr><td>Games with odds only</td><td>${e.withOdds.n}</td><td>${pct(e.withOdds.acc, 1)} <span class="note">(plain ${pct(e.withOdds.baseAcc, 1)})</span></td><td></td></tr>
        <tr><td>Games with news flags</td><td>${e.withNews.n}</td><td>${pct(e.withNews.acc, 1)} <span class="note">(plain ${pct(e.withNews.baseAcc, 1)})</span></td><td></td></tr></tbody></table></div>` : '';
      const L = s.listed || {};
      const lst = L.sportpesa?.n ? `<p class="note" style="margin:0 0 14px">SportPesa-listed games: ${L.sportpesa.n} graded, ${pct(L.sportpesa.x12, 1)} 1X2 · other fixtures: ${L.other.n} graded, ${pct(L.other.x12, 1)}</p>` : '';
      const src = data.sources || {};
      const srcRows = (src.health || []).map((h) => `<tr><td style="text-align:left">${esc(h.source)}</td><td>${h.ok ? '<span class="chip ok">OK</span>' : '<span class="chip no">Problem</span>'}</td><td style="text-align:left">${esc(h.detail)}</td></tr>`).join('');
      const um = [...(src.unmatchedListed || []), ...(src.unknownJackpotTeams || [])];
      const srcPanel = srcRows ? `<div class="panel"><h3>Data sources</h3><table class="tbl"><thead><tr><th>Source</th><th>Status</th><th style="text-align:left">Detail</th></tr></thead><tbody>${srcRows}</tbody></table>
        ${um.length ? `<p class="note" style="margin-top:10px">Skipped (team not in model data): ${um.slice(0, 12).map(esc).join('; ')}${um.length > 12 ? '…' : ''}. Add spellings in <code>data/aliases.json</code>.</p>` : ''}</div>` : '';
      const hist = (data.model.history || []).slice(-8).reverse().map((h) => `<tr><td>${new Date(h.at).toLocaleDateString('en-KE', { timeZone: TZ })}</td><td>${h.n}</td><td>v${h.v}</td><td>${h.adopted ? 'adopted' : 'kept'}</td><td>${h.logloss[0]} → ${h.logloss[1]}</td></tr>`).join('');
      return `${small}<div class="kpis"><div class="kpi"><div class="l">Graded</div><div class="v">${s.settled}</div><div class="s">${s.pending} pending</div></div>${['x12', 'dc', 'ou', 'bt'].map(mk).join('')}
        <div class="kpi"><div class="l">Last 50 · 1X2</div><div class="v">${pct(s.rolling.last50.x12, 0)}</div><div class="s">always-home: ${pct(base.baselineAlwaysHome, 0)}</div></div>
        <div class="kpi"><div class="l">Log-loss</div><div class="v">${base.logloss}</div><div class="s">coin-flip ${base.baselineLogloss} · lower is better</div></div></div>
        ${lst}${ab}<div class="panel"><h3>Cumulative 1X2 accuracy</h3>${chart(s.series)}<p class="note">Settles toward the true level as the sample grows. Early swings are normal.</p></div>
        <div class="panel"><h3>Is it calibrated?</h3><p class="note">When the model says 60%, it should be right about 60% of the time.</p><table class="tbl"><thead><tr><th>Confidence</th><th>Games</th><th>Said</th><th>Actual</th></tr></thead><tbody>${conf}</tbody></table></div>
        <div class="panel"><h3>By competition</h3><table class="tbl"><thead><tr><th>League</th><th>Games</th><th>1X2</th><th>O/U 2.5</th><th>BTTS</th></tr></thead><tbody>${comp}</tbody></table></div>
        ${jp ? `<div class="panel"><h3>Jackpot record</h3><table class="tbl"><thead><tr><th>Jackpot</th><th>Graded</th><th>Straight picks right</th><th>Double-chance right</th></tr></thead><tbody>${jp}</tbody></table></div>` : ''}
        ${srcPanel}<div class="panel"><h3>How the model is learning</h3><p class="note">Trained on ${data.model.matches || 0} finished matches. It re-tunes itself as new results arrive, and each change is logged.</p>
        <table class="tbl"><thead><tr><th>Version</th><th>Games</th><th>1X2</th></tr></thead><tbody>${ver}</tbody></table>
        ${hist ? `<table class="tbl" style="margin-top:12px"><thead><tr><th>Tuned</th><th>Matches</th><th>Model</th><th>Outcome</th><th>Log-loss</th></tr></thead><tbody>${hist}</tbody></table>` : ''}</div>`;
    },
  };

  function chart(series) {
    if (!series || series.length < 2) return '<p class="note">Needs a few days of results.</p>';
    const W = 640, H = 180, P = 28, xs = (i) => P + (i / (series.length - 1)) * (W - 2 * P);
    const lo = 0.3, hi = 0.8, ys = (v) => H - P - ((Math.min(hi, Math.max(lo, v)) - lo) / (hi - lo)) * (H - 2 * P);
    const pts = series.map((d, i) => `${xs(i).toFixed(1)},${ys(d.acc).toFixed(1)}`).join(' ');
    const grid = [0.33, 0.5, 0.65].map((v) => `<line x1="${P}" x2="${W - P}" y1="${ys(v)}" y2="${ys(v)}" stroke="var(--border)"/><text x="4" y="${ys(v) + 4}" fill="var(--text-3)" font-size="11">${Math.round(v * 100)}%</text>`).join('');
    return `<svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="Cumulative accuracy over time, latest ${pct(series.at(-1).acc, 1)}">${grid}<polyline fill="none" stroke="var(--gold)" stroke-width="2.5" points="${pts}"/><text x="${W - P}" y="${ys(series.at(-1).acc) - 8}" text-anchor="end" fill="var(--gold)" font-size="12">${pct(series.at(-1).acc, 1)}</text></svg>`;
  }

  function show(tab) {
    if (!views[tab]) tab = 'upcoming';
    document.querySelectorAll('.tab').forEach((b) => b.setAttribute('aria-selected', b.dataset.tab === tab));
    $('#view').innerHTML = views[tab]();
    history.replaceState(null, '', '#' + tab);
  }

  document.getElementById('view').addEventListener('submit', async (e) => {
    if (e.target.id !== 'mu-form') return; e.preventDefault();
    mu = { home: $('#mu-h').value, away: $('#mu-a').value, neutral: $('#mu-n').checked, odds: [$('#mu-o1').value, $('#mu-o2').value, $('#mu-o3').value], out: '' };
    await analyse(); show('matchup');
  });
  document.getElementById('view').addEventListener('click', (e) => { const b = e.target.closest('[data-filter]'); if (b) { filter = b.dataset.filter; show('upcoming'); } });
  document.getElementById('tabs').addEventListener('click', (e) => { const b = e.target.closest('.tab'); if (b) show(b.dataset.tab); });
  Promise.all([get('recent.json', []), get('stats.json', null), get('jackpots.json', []), get('model.json', {}), get('sources.json', {}), get('ratings.json', null), get('news.json', {})]).then(([recent, stats, jackpots, model, sources, ratings, news]) => {
    Object.assign(data, { recent, stats, jackpots, model, sources, ratings, news });
    $('#stamp').textContent = model.updated ? `Last agent run: ${new Date(model.updated).toLocaleString('en-KE', { timeZone: TZ })} EAT · model v${model.v}` : 'Agent has not run yet.';
    show(location.hash.slice(1) || 'upcoming');
  });
})();
