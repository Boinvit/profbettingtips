import test from 'node:test';
import assert from 'node:assert/strict';
import { splitHistory, parseBackfill } from '../lib/history.mjs';

test('splitHistory keeps recent matches for the browser and moves older ones to history', () => {
  const now = new Date('2026-10-31T00:00:00Z');
  const ms = [{ id: 'a', d: '2015-08-01T00:00:00.000Z' }, { id: 'b', d: '2023-10-01T00:00:00.000Z' }, { id: 'c', d: '2026-10-30T00:00:00.000Z' }];
  const { recent, older } = splitHistory(ms, now, 1100);
  assert.deepEqual(recent.map((m) => m.id), ['c']);
  assert.deepEqual(older.map((m) => m.id), ['a', 'b']);
  assert.equal(recent.length + older.length, ms.length);
});

test('parseBackfill: none, bare flag, explicit depth, clamped and invalid', () => {
  assert.equal(parseBackfill(new Set([])), 0);
  assert.equal(parseBackfill(new Set(['--tune'])), 0);
  assert.equal(parseBackfill(new Set(['--backfill'])), 3);
  assert.equal(parseBackfill(new Set(['--backfill=8'])), 8);
  assert.equal(parseBackfill(new Set(['--backfill=99'])), 12);
  assert.equal(parseBackfill(new Set(['--backfill=abc'])), 3);
});
