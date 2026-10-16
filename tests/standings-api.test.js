import test from 'node:test';
import assert from 'node:assert/strict';
import handler from '../api/standings.js';

function response() {
  return { headers: {}, setHeader(name, value) { this.headers[name] = value; },
    status(code) { this.code = code; return this; }, json(data) { this.data = data; return this; } };
}
const standings = () => ({ contest: { id: 42, phase: 'FINISHED', type: 'CF', durationSeconds: 7200 },
  problems: [{ index: 'A', name: 'Task', points: 500 }], rows: [
    { party: { participantType: 'CONTESTANT', members: [{ handle: 'Example' }] }, rank: 1, points: 400, penalty: 0,
      problemResults: [{ points: 400, type: 'FINAL', rejectedAttemptCount: 0, bestSubmissionTimeSeconds: 1200 }] },
    { party: { participantType: 'VIRTUAL', members: [{ handle: 'Virtual' }] } },
  ] });
async function withFetch(mock, action) {
  const previous = globalThis.fetch; globalThis.fetch = mock;
  try { await action(); } finally { globalThis.fetch = previous; }
}
test('standings endpoint rejects writes and malformed IDs before making requests', async () => {
  await withFetch(() => { throw new Error('Must not fetch'); }, async () => {
    for (const contestId of [undefined, '', '0', '-1', '1.5', '10000000', ['42', '43'], '42&url=other']) {
      const res = response(); await handler({ method: 'GET', query: { contestId } }, res);
      assert.equal(res.code, 400);
    }
    const res = response(); await handler({ method: 'POST', query: { contestId: '42' } }, res);
    assert.equal(res.code, 405);
  });
});
test('standings endpoint fetches only the fixed public API and returns compact official results', async () => {
  await withFetch(async (url) => {
    assert.equal(url, 'https://codeforces.com/api/contest.standings?contestId=42');
    return { ok: true, json: async () => ({ status: 'OK', result: standings() }) };
  }, async () => {
    const res = response(); await handler({ method: 'GET', query: { contestId: '42' } }, res);
    assert.equal(res.code, 200); assert.equal(res.data.rows.length, 1);
    assert.equal(res.data.rows[0].handle, 'Example'); assert.equal(res.data.samples.length, 1);
    assert.match(res.headers['Cache-Control'], /s-maxage=86400/);
    assert.equal(res.data.rows[0].problemResults, undefined);
  });
});
test('standings endpoint never caches unfinished, frozen, mismatched or failed upstream responses', async () => {
  const invalid = [
    { status: 'FAILED', comment: 'Try later' },
    ...[{ phase: 'CODING' }, { frozen: true }, { id: 43 }].map(change => {
      const data = standings(); Object.assign(data.contest, change); return { status: 'OK', result: data };
    }),
  ];
  for (const payload of invalid) {
    await withFetch(async () => ({ ok: true, json: async () => payload }), async () => {
      const res = response(); await handler({ method: 'GET', query: { contestId: '42' } }, res);
      assert.equal(res.code, 502); assert.equal(res.headers['Cache-Control'], undefined);
    });
  }
  await withFetch(async () => { throw new Error('Timed out'); }, async () => {
    const res = response(); await handler({ method: 'GET', query: { contestId: '42' } }, res);
    assert.equal(res.code, 502); assert.equal(res.data.error, 'Timed out');
  });
});
