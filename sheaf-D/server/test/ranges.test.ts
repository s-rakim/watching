import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseRanges, safeName, stem, toRangeString } from '../src/lib.js';

test('empty input means every page', () => {
  assert.deepEqual(parseRanges('', 4), [1, 2, 3, 4]);
  assert.deepEqual(parseRanges(undefined, 2), [1, 2]);
  assert.deepEqual(parseRanges('all', 3), [1, 2, 3]);
});

test('ranges, single pages and "end"', () => {
  assert.deepEqual(parseRanges('1-3, 5', 6), [1, 2, 3, 5]);
  assert.deepEqual(parseRanges('4-end', 6), [4, 5, 6]);
  assert.deepEqual(parseRanges('2-', 4), [2, 3, 4]);
  assert.deepEqual(parseRanges('-2', 4), [1, 2]);
});

test('order is kept, including backwards ranges', () => {
  assert.deepEqual(parseRanges('3,1', 3), [3, 1]);
  assert.deepEqual(parseRanges('3-1', 3), [3, 2, 1]);
});

test('out of bounds and nonsense are rejected', () => {
  assert.throws(() => parseRanges('9', 4), /outside this document/);
  assert.throws(() => parseRanges('0-2', 4), /outside this document/);
  assert.throws(() => parseRanges('one', 4), /isn't a page range/);
});

test('page lists collapse back into ranges', () => {
  assert.equal(toRangeString([1, 2, 3, 5, 7, 8]), '1-3,5,7-8');
  assert.equal(toRangeString([4]), '4');
});

test('file names are made safe without losing the name', () => {
  assert.equal(safeName('../../etc/passwd'), 'passwd');
  assert.equal(safeName('report: final?.pdf'), 'report_ final_.pdf');
  assert.equal(stem('archive.tar.pdf'), 'archive.tar');
});
