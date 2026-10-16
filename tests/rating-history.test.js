import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeRatingHistory, createRatingHistoryStore } from '../src/rating-history.js';
const change = (extra = {}) => ({ handle: 'Example', contestId: 42, contestName: 'Round 42', rank: 123, oldRating: 1200, newRating: 1250, ratingUpdateTimeSeconds: 1700000000, ...extra });
function storage() {
  const entries = new Map();
  return { getItem: (key) => entries.get(key) ?? null, setItem: (key, value) => entries.set(key, value) };
}
test('normalizes official history without inventing ratings, ranks or dates', () => {
  const data = normalizeRatingHistory('EXAMPLE', [change(), change({ contestId: 43, newRating: 1200, ratingUpdateTimeSeconds: 1700000001 })], 100);
  assert.equal(data.handle, 'example');
  assert.deepEqual(data.records.map((row) => row.contestId), [43, 42]);
  assert.equal(data.records[1].rank, 123);
  assert.equal(data.records[1].oldRating, 1200);
  assert.equal(data.syncedAt, 100);
});
test('duplicate contest records use the newest rating update', () => {
  const data = normalizeRatingHistory('example', [change({ ratingUpdateTimeSeconds: 1700000001, newRating: 1280 }), change()]);
  assert.equal(data.records.length, 1);
  assert.equal(data.records[0].newRating, 1280);
});
test('empty official history is valid for an unrated handle', () => {
  assert.deepEqual(normalizeRatingHistory('example', []).records, []);
});
test('malformed, wrong-owner and fractional records are rejected as a whole', () => {
  for (const invalid of [null, change({ handle: 'Other' }), change({ rank: 0 }), change({ newRating: 1200.5 }), change({ contestId: -1 }), change({ contestName: '' }), change({ ratingUpdateTimeSeconds: 0 })]) {
    assert.throws(() => normalizeRatingHistory('example', [change(), invalid]));
  }
  assert.throws(() => normalizeRatingHistory('example', {}));
});
test('rating snapshots isolate handles and ignore corrupt cache entries', () => {
  const raw = storage(); const store = createRatingHistoryStore(raw);
  store.save(normalizeRatingHistory('example', [change()], 200));
  assert.equal(store.load('EXAMPLE').records.length, 1);
  assert.equal(store.load('other'), null);
  raw.setItem('ranked-official-ratings-other', '{broken');
  assert.equal(store.load('other'), null);
  raw.setItem('ranked-official-ratings-other', JSON.stringify(store.load('example')));
  assert.equal(store.load('other'), null);
});
test('older responses and invalid refreshes cannot replace a newer saved snapshot', () => {
  const store = createRatingHistoryStore(storage());
  store.save(normalizeRatingHistory('example', [change({ newRating: 1300 })], 200));
  assert.equal(store.save(normalizeRatingHistory('example', [change()], 100)).records[0].newRating, 1300);
  assert.throws(() => store.save({ handle: 'example', syncedAt: 300, records: [change({ rank: -1 })] }));
  assert.equal(store.load('example').records[0].newRating, 1300);
});
test('storage failure remains visible to the caller', () => {
  const store = createRatingHistoryStore({ getItem: () => null, setItem: () => { throw new Error('Full'); } });
  assert.throws(() => store.save(normalizeRatingHistory('example', [])), /Full/);
});

test('missing cache timestamps are not replaced with a fabricated current sync time', () => {
  const raw = storage(); const store = createRatingHistoryStore(raw);
  const missing = normalizeRatingHistory('example', [change()], 100);
  delete missing.syncedAt;
  raw.setItem('ranked-official-ratings-example', JSON.stringify(missing));
  assert.equal(store.load('example'), null);
  assert.throws(() => store.save(missing));
});
