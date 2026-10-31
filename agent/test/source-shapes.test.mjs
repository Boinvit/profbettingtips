import test from 'node:test';
import assert from 'node:assert/strict';
import { fetchOddsApi } from '../lib/sources/odds-api.mjs';

// run.mjs merges every source with feed.finished.push(...r.finished); a missing array throws.
test('Odds API without a key returns both finished and upcoming arrays', async () => {
  const health = [];
  const r = await fetchOddsApi({ key: '', health });
  assert.ok(Array.isArray(r.finished));
  assert.ok(Array.isArray(r.upcoming));
  assert.equal(health.length, 1);
});
