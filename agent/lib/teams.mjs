// Team registry: one canonical id per team across every data source. Persisted in data/teams.json.
import { buildIndex, findTeam, slugId } from './names.mjs';

export class Registry {
  constructor(saved = {}, aliases = {}) {
    this.names = { ...saved }; this.aliases = aliases; this.cache = new Map(); this.index = buildIndex(this.names, aliases);
  }
  /** Resolve a source's team name to a canonical id; create it when `create` and nothing matches. */
  resolve(name, create = true) {
    const key = String(name);
    if (this.cache.has(key)) return this.cache.get(key);
    let id = findTeam(this.index, name);
    if (!id && create) {
      id = slugId(name, this.aliases);
      if (!this.names[id]) { this.names[id] = String(name).trim(); this.index = buildIndex(this.names, this.aliases); }
    }
    if (id) this.cache.set(key, id);
    return id;
  }
  /** Drop empty twin ids (no match ever recorded) that resolve to a club which has history. They appear when a source's spelling was not
   *  recognised at the moment a team was first registered, and they then shadow the real id (no predictions, no ratings). Returns [[dropped, kept], ...]. */
  prune(matches) {
    const used = new Set();
    for (const m of matches) { used.add(m.h); used.add(m.a); }
    const known = {};
    for (const [id, n] of Object.entries(this.names)) if (used.has(id)) known[id] = n;
    const idx = buildIndex(known, this.aliases);
    const removed = [];
    for (const [id, n] of Object.entries(this.names)) {
      if (used.has(id)) continue;
      const t = findTeam(idx, n);
      if (t && t !== id) { delete this.names[id]; removed.push([id, t]); }
    }
    if (removed.length) { this.index = buildIndex(this.names, this.aliases); this.cache.clear(); }
    return removed;
  }
}
