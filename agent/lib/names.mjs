// Team-name normalisation and matching across sources (SportPesa, football-data.org,
// football-data.co.uk, ClubElo all spell teams differently).
const STOP = new Set(['fc', 'afc', 'cf', 'sc', 'ac', 'as', 'ss', 'us', 'club', 'de', 'the', 'calcio', 'cd', 'ud', 'sv', 'vfl', 'vfb', 'fk', 'bk', 'if', '1', '04', '05', '1899', 'and']);
export const ALIASES = {
  'man utd': 'manchester united', 'man united': 'manchester united', 'manchester utd': 'manchester united', 'man city': 'manchester city',
  'spurs': 'tottenham hotspur', 'tottenham': 'tottenham hotspur', 'wolves': 'wolverhampton wanderers', 'wolverhampton': 'wolverhampton wanderers',
  'nottm forest': 'nottingham forest', "nott'm forest": 'nottingham forest', 'newcastle': 'newcastle united', 'west ham': 'west ham united',
  'brighton': 'brighton hove albion', 'leeds': 'leeds united', 'sheff utd': 'sheffield united', 'sheffield utd': 'sheffield united',
  'sheff wed': 'sheffield wednesday', 'qpr': 'queens park rangers', 'west brom': 'west bromwich albion', 'leicester': 'leicester city',
  'norwich': 'norwich city', 'cardiff': 'cardiff city', 'swansea': 'swansea city', 'stoke': 'stoke city', 'hull': 'hull city', 'coventry': 'coventry city',
  'inter': 'internazionale', 'inter milan': 'internazionale', 'milan': 'ac milan', 'atl madrid': 'atletico madrid', 'ath madrid': 'atletico madrid',
  'atletico': 'atletico madrid', 'ath bilbao': 'athletic club', 'athletic bilbao': 'athletic club', 'betis': 'real betis', 'sociedad': 'real sociedad',
  'vallecano': 'rayo vallecano', 'espanol': 'espanyol', 'celta': 'celta vigo', 'alaves': 'deportivo alaves',
  'bayern': 'bayern munchen', 'bayern munich': 'bayern munchen', 'dortmund': 'borussia dortmund', 'leverkusen': 'bayer leverkusen',
  'gladbach': 'borussia monchengladbach', 'mgladbach': 'borussia monchengladbach', "m'gladbach": 'borussia monchengladbach', 'b monchengladbach': 'borussia monchengladbach',
  'rb leipzig': 'leipzig', 'rb leipzig ': 'leipzig', 'ein frankfurt': 'eintracht frankfurt', 'frankfurt': 'eintracht frankfurt', 'mainz': 'mainz 05', 'koln': 'cologne', 'fc koln': 'cologne',
  'psg': 'paris saint germain', 'paris sg': 'paris saint germain', 'paris saint-germain': 'paris saint germain', 'marseille': 'olympique marseille', 'lyon': 'olympique lyonnais', 'st etienne': 'saint etienne',
  'sporting cp': 'sporting lisbon', 'sp lisbon': 'sporting lisbon', 'sp braga': 'braga', 'benfica': 'sl benfica', 'porto': 'fc porto', 'psv': 'psv eindhoven', 'ajax': 'ajax amsterdam',
  'gor mahia': 'gor mahia', 'afc leopards': 'afc leopards', 'tusker': 'tusker',
};
export const norm = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
  .replace(/[.'’`]/g, '').replace(/&/g, ' and ').replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim();
const tokens = (s) => norm(s).split(' ').filter((t) => t && !STOP.has(t));
export const canon = (s, extra = {}) => {
  const n = norm(s), t = tokens(s).join(' ');
  const a = extra[n] || extra[t] || ALIASES[n] || ALIASES[t] || n;
  return tokens(a).join(' ') || n;
};
export const slugId = (name, extra) => `t:${canon(name, extra).replace(/ /g, '-')}`;

/** index: {list:[{id,n,k,t}], byCanon:Map, alias} built from {id:name}. */
export function buildIndex(names, extra = {}) {
  const list = Object.entries(names).map(([id, n]) => ({ id, n, k: canon(n, extra), t: new Set(tokens(n)) }));
  return { list, byCanon: new Map(list.map((c) => [c.k, c.id])), alias: extra };
}

/** Find an existing team: exact canonical -> unique token-subset -> strong Jaccard. Else null. Deliberately conservative. */
export function findTeam(index, raw) {
  const k = canon(raw, index.alias);
  if (index.byCanon.has(k)) return index.byCanon.get(k);
  const qt = new Set(tokens(k));
  if (!qt.size) return null;
  const sub = index.list.filter((c) => [...qt].every((t) => c.t.has(t)));
  if (sub.length === 1 && qt.size >= 1 && k.length >= 4) return sub[0].id;
  let best = null, bs = 0, second = 0;
  for (const c of index.list) {
    let inter = 0; for (const t of qt) if (c.t.has(t)) inter++;
    const sc = inter / new Set([...qt, ...c.t]).size;
    if (sc > bs) { second = bs; bs = sc; best = c.id; } else if (sc > second) second = sc;
  }
  return bs >= 0.67 && bs - second >= 0.15 ? best : null;
}
