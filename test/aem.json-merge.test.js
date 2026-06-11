import { test } from 'node:test';
import assert from 'node:assert/strict';
// Imports the compiled output so the suite runs on plain Node (no TS loader).
// `npm test` builds first; CI builds before the test step.
import {
  resolveJsonPointer,
  mergeJsonString,
  JsonMergeError,
} from '../dist/aem/aem.json-merge.js';

// A generic nested shape: [{ component, content: [{ value: {...} }] }]
const nested = () => [
  { component: 'Demo', content: [{ value: { alpha: 'A', beta: 'B' } }] },
];

test('resolveJsonPointer: empty pointer returns the root', () => {
  const root = { a: 1 };
  assert.equal(resolveJsonPointer(root, ''), root);
});

test('resolveJsonPointer: walks objects and array indices', () => {
  const root = nested();
  const target = resolveJsonPointer(root, '/0/content/0/value');
  assert.deepEqual(target, { alpha: 'A', beta: 'B' });
  // must be the live reference, not a copy
  assert.equal(target, root[0].content[0].value);
});

test('resolveJsonPointer: unescapes ~1 (slash) and ~0 (tilde) tokens', () => {
  const root = { 'a/b': { 'c~d': 42 } };
  assert.equal(resolveJsonPointer(root, '/a~1b/c~0d'), 42);
});

test('resolveJsonPointer: throws JsonMergeError when a token is missing', () => {
  const root = nested();
  assert.throws(
    () => resolveJsonPointer(root, '/0/content/9/value'),
    (err) => err instanceof JsonMergeError && err.code === 'VALIDATION_FAILED'
  );
});

test('mergeJsonString: upserts keys, preserves untouched, reports stats', () => {
  const current = JSON.stringify(nested());
  const { result, added, overwritten, beforeKeyCount, afterKeyCount } = mergeJsonString(
    current,
    '/0/content/0/value',
    { beta: 'B2', gamma: 'G' } // overwrite beta, add gamma
  );

  const parsed = JSON.parse(result);
  assert.deepEqual(parsed[0].content[0].value, { alpha: 'A', beta: 'B2', gamma: 'G' });
  assert.deepEqual(added, ['gamma']);
  assert.deepEqual(overwritten, ['beta']);
  assert.equal(beforeKeyCount, 2);
  assert.equal(afterKeyCount, 3);
});

test('mergeJsonString: deep-merges nested objects rather than replacing them', () => {
  const current = JSON.stringify({ cfg: { a: { x: 1 }, keep: true } });
  const { result } = mergeJsonString(current, '/cfg', { a: { y: 2 } });
  const parsed = JSON.parse(result);
  // x preserved, y added, keep untouched
  assert.deepEqual(parsed.cfg, { a: { x: 1, y: 2 }, keep: true });
});

test('mergeJsonString: pointer to root object merges at top level', () => {
  const current = JSON.stringify({ a: 1 });
  const { result, added } = mergeJsonString(current, '', { b: 2 });
  assert.deepEqual(JSON.parse(result), { a: 1, b: 2 });
  assert.deepEqual(added, ['b']);
});

test('mergeJsonString: invalid JSON throws VALIDATION_FAILED', () => {
  assert.throws(
    () => mergeJsonString('not json {', '', { a: 1 }),
    (err) => err instanceof JsonMergeError && err.code === 'VALIDATION_FAILED'
  );
});

test('mergeJsonString: pointer resolving to a non-object throws VALIDATION_FAILED', () => {
  const current = JSON.stringify({ a: 'scalar' });
  assert.throws(
    () => mergeJsonString(current, '/a', { x: 1 }),
    (err) => err instanceof JsonMergeError && err.code === 'VALIDATION_FAILED'
  );
});

test('mergeJsonString: pointer resolving to an array throws VALIDATION_FAILED', () => {
  const current = JSON.stringify({ list: [1, 2] });
  assert.throws(
    () => mergeJsonString(current, '/list', { x: 1 }),
    (err) => err instanceof JsonMergeError && err.code === 'VALIDATION_FAILED'
  );
});
