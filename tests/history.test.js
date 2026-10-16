import test from 'node:test';
import assert from 'node:assert/strict';
import { syncSubmissionHistory } from '../src/history.js';
import { createHistoryStore } from '../src/history-store.js';
import { recommendRounds } from '../src/recommendations.js';

const entries = (count) => Array.from({ length: count }, (_, index) => ({ id: count - index, verdict: 'OK' }));
const options = { handle: 'Example', pageSize: 4, overlap: 1, now: () => 1234 };
function api(rows, calls = []) {
  return async (method, params) => {
    assert.equal(method, 'user.status');
    calls.push(Number(params.from));
    return rows.slice(Number(params.from) - 1, Number(params.from) - 1 + Number(params.count));
  };
}
const cached = (submissions, complete = true) => ({ version: 1, handle: 'example', submissions, complete });

test('scans past the first page, overlaps offsets, and deduplicates submissions', async () => {
  const calls = [];
  const result = await syncSubmissionHistory({ ...options, request: api(entries(10), calls) });
  assert.deepEqual(calls, [1, 4, 7, 10]);
  assert.deepEqual(result.submissions.map((entry) => entry.id), entries(10).map((entry) => entry.id));
  assert.equal(result.complete, true);
  assert.equal(result.handle, 'example');
  assert.equal(result.syncedAt, 1234);
});

test('an exactly full first page is followed through to the tail', async () => {
  const calls = [];
  const result = await syncSubmissionHistory({ ...options, request: api(entries(4), calls) });
  assert.deepEqual(calls, [1, 4]);
  assert.equal(result.submissions.length, 4);
});

test('handles accounts with no submissions', async () => {
  const result = await syncSubmissionHistory({ ...options, request: api([]) });
  assert.equal(result.complete, true);
  assert.deepEqual(result.submissions, []);
});

test('refreshes completed history up to the known boundary and updates verdicts', async () => {
  const rows = entries(10);
  rows.find((entry) => entry.id === 5).verdict = 'WRONG_ANSWER';
  const calls = [];
  const result = await syncSubmissionHistory({ ...options, checkpoint: cached(entries(5)), request: api(rows, calls) });
  assert.deepEqual(calls, [1, 4]);
  assert.equal(result.submissions.length, 10);
  assert.equal(result.submissions.find((entry) => entry.id === 5).verdict, 'WRONG_ANSWER');
});

test('a partial cache never provides an early stopping boundary', async () => {
  const calls = [];
  const result = await syncSubmissionHistory({ ...options, checkpoint: cached(entries(10).slice(0, 4), false), request: api(entries(10), calls) });
  assert.deepEqual(calls, [1, 4, 7, 10]);
  assert.equal(result.submissions.length, 10);
});

test('a failed first import persists only an incomplete checkpoint', async () => {
  const saved = [];
  await assert.rejects(syncSubmissionHistory({ ...options,
    request: async (_method, params) => {
      if (params.from !== '1') throw new Error('Network unavailable');
      return entries(10).slice(0, 4);
    }, save: async (snapshot) => saved.push(snapshot),
  }), /interrupted after checking 4 submissions/);
  assert.equal(saved.length, 1);
  assert.equal(saved[0].complete, false);
});

test('an interrupted incremental refresh cannot create a false completed boundary', async () => {
  const saved = [];
  await assert.rejects(syncSubmissionHistory({ ...options, checkpoint: cached(entries(5)),
    request: async (_method, params) => {
      if (params.from !== '1') throw new Error('Network unavailable');
      return entries(10).slice(0, 4);
    }, save: async (snapshot) => saved.push(snapshot),
  }));
  assert.equal(saved.length, 0);
});

test('new submissions during paging are picked up on the next refresh without losing old attempts', async () => {
  let count = 10;
  const first = await syncSubmissionHistory({ ...options, request: async (_method, params) => {
    const page = entries(count).slice(Number(params.from) - 1, Number(params.from) - 1 + Number(params.count));
    count = 12;
    return page;
  } });
  assert.equal(first.submissions.length, 10);
  const refreshed = await syncSubmissionHistory({ ...options, request: api(entries(12)), checkpoint: first });
  assert.equal(refreshed.submissions.length, 12);
});

test('lost overlap or malformed API pages fail instead of declaring completion', async () => {
  await assert.rejects(syncSubmissionHistory({ ...options, request: async (_method, params) =>
    params.from === '1' ? entries(10).slice(0, 4) : [{ id: 2 }, { id: 1 }],
  }), /history changed/);
  await assert.rejects(syncSubmissionHistory({ ...options, request: async () => [{ id: 1 }, { id: 2 }] }), /unexpected submission page/);
});

test('a different handle cache cannot contaminate a history', async () => {
  const result = await syncSubmissionHistory({ ...options, checkpoint: { ...cached([{ id: 999 }]), handle: 'someoneelse' }, request: api(entries(2)) });
  assert.deepEqual(result.submissions.map((entry) => entry.id), [2, 1]);
});

test('history still syncs if IndexedDB is unavailable', async () => {
  const store = createHistoryStore();
  assert.equal(store.persistent, false);
  const result = await syncSubmissionHistory({ ...options, request: api(entries(6)), save: (snapshot) => store.save(snapshot) });
  assert.deepEqual(await store.load('EXAMPLE'), result);
});

test('an old wrong answer beyond submission 1000 excludes its whole round', async () => {
  const rows = entries(1100);
  rows[1050].problem = { contestId: 42, index: 'D', name: 'Old attempt' };
  rows[1050].verdict = 'WRONG_ANSWER';
  const result = await syncSubmissionHistory({ handle: 'Example', request: api(rows) });
  const rounds = recommendRounds({
    contests: [{ id: 42, name: 'Codeforces Round 42', type: 'CF', phase: 'FINISHED', durationSeconds: 7200 }],
    problems: ['A', 'B', 'C', 'D'].map((index, position) => ({ contestId: 42, index, name: index, rating: 800 + 300 * position })),
    submissions: result.submissions, rating: 1158,
  });
  assert.deepEqual(rounds, []);
});

test('bounded session scans page through the whole time window and stop only after its start', async () => {
  const rows = entries(10).map((entry) => ({ ...entry, creationTimeSeconds: 100 + entry.id }));
  const calls = [];
  const result = await syncSubmissionHistory({ ...options, sinceSeconds: 106, request: api(rows, calls) });
  assert.deepEqual(calls, [1, 4]);
  assert.equal(result.sinceSeconds, 106);
  assert.ok(result.submissions.some((entry) => entry.creationTimeSeconds === 106));
  assert.equal(result.complete, true);
});

test('bounded scans always refresh verdicts and cannot become a full-history cache boundary', async () => {
  const rows = entries(10).map((entry) => ({ ...entry, creationTimeSeconds: 100 + entry.id }));
  const scoped = await syncSubmissionHistory({ ...options, sinceSeconds: 106, request: api(rows) });
  const changed = rows.map((entry) => ({ ...entry, verdict: 'CHALLENGED' }));
  const refreshed = await syncSubmissionHistory({ ...options, sinceSeconds: 106, checkpoint: scoped, request: api(changed) });
  assert.equal(refreshed.submissions.find((entry) => entry.id === 6).verdict, 'CHALLENGED');
  const calls = [];
  const full = await syncSubmissionHistory({ ...options, checkpoint: scoped, request: api(rows, calls) });
  assert.equal(full.submissions.length, 10);
  assert.deepEqual(calls, [1, 4, 7, 10]);
});

test('bounded scans reject missing or contradictory timestamps instead of stopping early', async () => {
  await assert.rejects(syncSubmissionHistory({ ...options, sinceSeconds: 106, request: api(entries(10)) }), /inconsistent submission times/);
  await assert.rejects(syncSubmissionHistory({ ...options, sinceSeconds: 106,
    request: async () => [{ id: 3, creationTimeSeconds: 1 }, { id: 2, creationTimeSeconds: 999 }],
  }), /inconsistent submission times/);
});

test('a partial sync cannot overwrite an already complete saved history', async () => {
  const store = createHistoryStore();
  const full = { ...cached(entries(10)), syncedAt: 100 };
  await store.save(full);
  await store.save({ ...cached(entries(12).slice(0, 4), false), syncedAt: null });
  assert.deepEqual(await store.load('Example'), full);
});
test('concurrent complete histories retain observed attempts and the freshest verdicts', async () => {
  const store = createHistoryStore();
  await store.save({ ...cached([{ id: 3, verdict: 'WRONG_ANSWER' }, { id: 1 }]), syncedAt: 200 });
  await store.save({ ...cached([{ id: 3, verdict: 'OK' }, { id: 2 }]), syncedAt: 100 });
  const saved = await store.load('example');
  assert.equal(saved.syncedAt, 200);
  assert.deepEqual(saved.submissions.map(s => s.id), [3, 2, 1]);
  assert.equal(saved.submissions[0].verdict, 'WRONG_ANSWER');
});
