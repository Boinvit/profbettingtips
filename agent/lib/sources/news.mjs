// Team news from Google News RSS (headlines only). Converted to a SMALL Elo adjustment; every prediction stores
// the no-news baseline too, so the Accuracy tab can show whether news actually helps.
const NEG = /(ruled out|out for|injur|doubt|suspend|sidelined|will miss|to miss|misses|hamstring|knock|setback|blow|banned|sacked|crisis|absent|unavailable)/i;
const POS = /(returns?|back in training|boost|fit again|cleared|recovered|available)/i;
const decode = (s) => s.replace(/<!\[CDATA\[|\]\]>/g, '').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'");

export function parseRss(xml) {
  return [...xml.matchAll(/<item>([\s\S]*?)<\/item>/g)].map((m) => ({
    title: decode((m[1].match(/<title>([\s\S]*?)<\/title>/) || [])[1] || '').trim(),
    date: (m[1].match(/<pubDate>([\s\S]*?)<\/pubDate>/) || [])[1] || '',
  })).filter((x) => x.title);
}
/** Score headlines about one team -> {adj (Elo points), flags, headlines}. Pure & tested. */
export function scoreHeadlines(items, teamName, now = new Date(), maxAgeDays = 3) {
  const key = teamName.toLowerCase().split(/\s+/).filter((w) => w.length > 3)[0] || teamName.toLowerCase();
  const seen = []; let neg = 0, pos = 0; const flags = [], headlines = [];
  const words = (t) => new Set(t.toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length > 3));
  const isDup = (ws) => seen.some((o) => { let i = 0; for (const w of ws) if (o.has(w)) i++; return i / new Set([...ws, ...o]).size >= 0.6; });
  for (const it of items) {
    const t = it.title.replace(/\s+-\s+[^-]+$/, ''); // strip " - Publisher"
    const ws = words(t);
    if (!t.toLowerCase().includes(key) || isDup(ws)) continue;
    const age = it.date ? (now - new Date(it.date)) / 86400000 : 0;
    if (age > maxAgeDays) continue;
    seen.push(ws);
    if (NEG.test(t)) { neg++; flags.push('−'); headlines.push(t); }
    else if (POS.test(t)) { pos++; flags.push('+'); headlines.push(t); }
  }
  const adj = -Math.min(24, neg * 8) + Math.min(10, pos * 4);
  return { adj, flags: flags.slice(0, 4), headlines: headlines.slice(0, 3) };
}
export async function fetchTeamNews(teamName, { fetchText, now = new Date() } = {}) {
  const q = encodeURIComponent(`"${teamName}" football (injury OR injured OR suspended OR doubtful OR "ruled out" OR returns OR sacked) when:3d`);
  const get = fetchText || (async (u) => { const r = await fetch(u, { headers: { 'User-Agent': 'pbt-prediction-lab (personal research)' } }); if (!r.ok) throw new Error('HTTP ' + r.status); return r.text(); });
  return scoreHeadlines(parseRss(await get(`https://news.google.com/rss/search?q=${q}&hl=en&gl=KE&ceid=KE:en`)), teamName, now);
}
