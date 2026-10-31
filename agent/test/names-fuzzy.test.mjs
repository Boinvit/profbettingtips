import test from 'node:test';
import assert from 'node:assert/strict';
import { buildIndex, findTeam } from '../lib/names.mjs';

const idx = buildIndex({
  't:oxford': 'Oxford', 't:brest': 'Brest', 't:west-bromwich-albion': 'West Brom', 't:valerenga': 'Valerenga',
  't:tromso': 'Tromso', 't:sp-gijon': 'Sp Gijon', 't:ceuta': 'Ceuta', 't:santa-clara': 'Santa Clara',
  't:bristol-city': 'Bristol City', 't:bristol-rovers': 'Bristol Rovers', 't:inter': 'Inter',
  't:manchester-city': 'Manchester City', 't:manchester-united': 'Manchester United',
});

test('longer SportPesa spellings resolve to the shorter known team', () => {
  assert.equal(findTeam(idx, 'Oxford Utd'), 't:oxford');
  assert.equal(findTeam(idx, 'Stade Brest 29'), 't:brest');
  assert.equal(findTeam(idx, 'Santa Clara Azores'), 't:santa-clara');
  assert.equal(findTeam(idx, 'AD Ceuta'), 't:ceuta');
});

test('alias targets reached via canonical tokens', () => {
  assert.equal(findTeam(idx, 'West Bromwich'), 't:west-bromwich-albion');
  assert.equal(findTeam(idx, 'Sporting Gijon'), 't:sp-gijon');
});

test('transliteration folds (aa/oe) match', () => {
  assert.equal(findTeam(idx, 'Vaalerenga IF'), 't:valerenga');
  assert.equal(findTeam(idx, 'Tromsoe IL'), 't:tromso');
});

test('does not merge distinct clubs sharing a word', () => {
  assert.equal(findTeam(idx, 'Bristol Rovers'), 't:bristol-rovers');
  assert.equal(findTeam(idx, 'Bristol City'), 't:bristol-city');
  assert.equal(findTeam(idx, 'Manchester City'), 't:manchester-city');
  assert.equal(findTeam(idx, 'Panaitolikos Agrinio'), null);
});

test('ambiguous reverse containment returns null instead of guessing', () => {
  const amb = buildIndex({ 't:a': 'Dynamo', 't:b': 'Dynamo Dresden Reserves' });
  assert.equal(findTeam(amb, 'Dynamo Dresden Reserves XI') === 't:a', false);
});
