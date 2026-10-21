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
}
