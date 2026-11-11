import assert from 'node:assert/strict';
import { test } from 'node:test';
import { pickEngine } from '../src/tools/text.js';

test('an explicit choice wins, whatever is set up', () => {
  assert.equal(pickEngine('deepl', false), 'deepl');
  assert.equal(pickEngine('argos', true), 'argos');
});

test('automatic prefers DeepL when there is a key, otherwise offline', () => {
  assert.equal(pickEngine('auto', true), 'deepl');
  assert.equal(pickEngine('auto', false), 'argos');
  assert.equal(pickEngine(undefined, true), 'deepl');
  assert.equal(pickEngine('nonsense', false), 'argos');
});
