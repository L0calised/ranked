import test from 'node:test';
import assert from 'node:assert/strict';
import { loadCataloguePart, loadProblemset } from '../src/catalogue-store.js?v=1';

test('the public catalogue fetch is shared by simultaneous callers and cached for this page', async () => {
  let calls = 0;
  const fetcher = async () => { calls += 1; await new Promise(resolve => setTimeout(resolve, 5)); return [{ id: 42 }]; };
  const [first, second] = await Promise.all([
    loadCataloguePart('contest-list', fetcher),
    loadCataloguePart('contest-list', fetcher),
  ]);
  assert.deepEqual(first, [{ id: 42 }]);
  assert.deepEqual(second, first);
  assert.equal(calls, 1);
  await loadCataloguePart('contest-list', fetcher);
  assert.equal(calls, 1);
});

test('catalogue cache rejects unknown keys and bad API responses and can retry', async () => {
  await assert.rejects(loadCataloguePart('unknown', async () => []), /Unknown public catalogue/);
  await assert.rejects(loadProblemset(async () => ({})), /invalid problem catalogue/);
  const result = await loadProblemset(async () => ({ problems: [{ contestId: 17, index: 'A' }] }));
  assert.equal(result[0].contestId, 17);
});
