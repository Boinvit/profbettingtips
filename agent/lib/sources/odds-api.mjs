// The Odds API v4: consensus 1X2 odds from available bookmakers. Requires THE_ODDS_API_KEY.
const BASE = 'https://api.the-odds-api.com/v4';
export async function fetchOddsApi({ key, now = new Date(), health = [], log = console.log } = {}) {
  if (!key) { health.push({ source:'The Odds API', ok:false, detail:'no THE_ODDS_API_KEY (optional)' }); return { upcoming:[] }; }
  try {
    const url = `${BASE}/sports/soccer/odds/?apiKey=${encodeURIComponent(key)}&regions=uk,eu&markets=h2h&oddsFormat=decimal&dateFormat=iso`;
    const res = await fetch(url, { signal: AbortSignal.timeout(20000) });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const events = await res.json(), upcoming=[];
    for (const e of events) {
      if (!e.home_team || !e.away_team || !e.commence_time || new Date(e.commence_time) <= now) continue;
      const values = { H:[], D:[], A:[] };
      for (const b of e.bookmakers || []) for (const m of b.markets || []) if (m.key === 'h2h') {
        for (const o of m.outcomes || []) {
          const k = o.name === e.home_team ? 'H' : o.name === e.away_team ? 'A' : /^draw$/i.test(o.name) ? 'D' : null;
          if (k && Number.isFinite(o.price) && o.price > 1.01) values[k].push(o.price);
        }
      }
      const avg = ['H','D','A'].map(k => values[k].length ? values[k].reduce((a,b)=>a+b,0)/values[k].length : null);
      const odds = avg.every(x => x && x > 1.01) ? avg.map(x=>+x.toFixed(3)) : null;
      upcoming.push({ c:'The Odds API', d:e.commence_time, hn:e.home_team, an:e.away_team, ...(odds ? { o:odds } : {}) });
    }
    health.push({ source:'The Odds API', ok:true, detail:`${events.length} events fetched, ${upcoming.filter(x=>x.o).length} with 1X2 odds` });
    log(`  The Odds API: ${events.length} events, ${upcoming.filter(x=>x.o).length} with odds`);
    return { upcoming };
  } catch(e) {
    health.push({ source:'The Odds API', ok:false, detail:e.message });
    return { upcoming:[] };
  }
}
