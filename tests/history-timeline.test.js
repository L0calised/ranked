import test from 'node:test';
import assert from 'node:assert/strict';
import { buildHistoryTimeline, filterHistory } from '../src/history-timeline.js';
const started = 1700000000;
const virtual = (extra = {}) => ({ id: 'cf-virtual:example:42:1700000000', startedAt: started, endsAt: started + 7200, status: 'ended', solved: 2, problems: [{}, {}, {}], ...extra });
const round = (sessions = [virtual()]) => ({ contestId: 42, contestName: 'Round 42', syncedAt: started * 1000 + 9000000, sessions });
const local = (extra = {}) => ({ id: 'local-1', contest: { id: 42, name: 'Round 42' }, problems: [{}, {}, {}], status: 'ready', startedAt: null, scheduledAt: null, endsAt: null, createdAt: started * 1000 - 1000, results: null, ...extra });
const official = (extra = {}) => ({ contestId: 42, contestName: 'Round 42', ratingUpdateTimeSeconds: started + 100, rank: 123, oldRating: 1250, newRating: 1300, ...extra });
test('combines histories without merging distinct official, native and local participations', () => {
  const rows = buildHistoryTimeline({ official: [official()], rounds: [round()], localSessions: [local()] });
  assert.deepEqual(rows.map((row) => row.kind), ['official', 'virtual', 'local']);
  assert.equal(new Set(rows.map((row) => row.id)).size, 3);
  assert.equal(rows[0].date, (started + 100) * 1000);
  assert.equal(rows[1].date, started * 1000);
  assert.equal(rows[2].date, started * 1000 - 1000);
});
test('official positive, negative and zero deltas come from actual old/new ratings', () => {
  for (const [rating, expected] of [[1300, 50], [1200, -50], [1250, 0]]) {
    const [row] = buildHistoryTimeline({ official: [official({ newRating: rating })] });
    assert.equal(row.delta, expected); assert.equal(row.newRating, rating); assert.equal(row.rank, 123);
    assert.equal(row.dateLabel, 'Rating updated');
  }
});
test('unofficial rows never receive official or invented estimated rating and rank', () => {
  const rows = buildHistoryTimeline({ rounds: [round()], localSessions: [local(), local({ id: 'custom-1', contest: { id: 'custom:42A', name: 'Custom', kind: 'custom' } })] });
  for (const row of rows) assert.deepEqual([row.rank, row.delta, row.newRating], [null, null, null]);
  assert.equal(rows.find((row) => row.kind === 'custom').result, 'Not synced');
});
test('repeated virtual starts remain distinct and refresh snapshots deduplicate stable IDs', () => {
  const later = virtual({ id: 'cf-virtual:example:42:1700010000', startedAt: started + 10000 });
  const rows = buildHistoryTimeline({ rounds: [round([virtual(), later]), round([virtual(), later])] });
  assert.equal(rows.length, 2); assert.equal(rows[0].sessionId, later.id);
});
test('discovery is shown as a round needing import, never as a verified zero-solve session', () => {
  const discovered = [{ contestId: 42, submissionCount: 3, lastSubmissionAt: started }];
  let rows = buildHistoryTimeline({ discovered });
  assert.equal(rows[0].status, 'Import needed'); assert.equal(rows[0].discovery, true);
  assert.equal(rows[0].result, '3 virtual submissions');
  rows = buildHistoryTimeline({ discovered, rounds: [round([])] });
  assert.equal(rows[0].status, 'No identifiable session');
  rows = buildHistoryTimeline({ discovered, rounds: [round()] });
  assert.equal(rows.length, 1); assert.equal(rows[0].discovery, undefined);
});
test('local prepared, scheduled, running and expired states respect millisecond timestamps', () => {
  const now = started * 1000;
  const states = [local(), local({ id: 'scheduled', status: 'scheduled', scheduledAt: now + 10000, endsAt: now + 100000 }),
    local({ id: 'active', status: 'active', startedAt: now - 10000, endsAt: now + 10000 }),
    local({ id: 'expired', status: 'active', startedAt: now - 100000, endsAt: now - 1000 }),
    local({ id: 'early', status: 'ended', startedAt: now - 100000, endsAt: now + 1000, endReason: 'ended-early' })];
  const rows = buildHistoryTimeline({ localSessions: states, now });
  for (const [id, status] of [['local-1', 'Prepared'], ['scheduled', 'Scheduled'], ['active', 'In progress'], ['expired', 'Window ended'], ['early', 'Ended early']]) {
    assert.equal(rows.find((row) => row.sessionId === id).status, status);
  }
});
test('zero-solve synced results differ from results never synced; provisional data is flagged', () => {
  const rows = buildHistoryTimeline({ localSessions: [local(), local({ id: 'synced', results: { solved: 0, pending: 1, syncedAt: 100 } })], rounds: [round([virtual({ priorAttemptProblems: 1 })])] });
  assert.equal(rows.find((row) => row.sessionId === 'synced').result, '0/3 accepted');
  assert.equal(rows.find((row) => row.sessionId === 'local-1').result, 'Not synced');
  assert.equal(rows.find((row) => row.kind === 'virtual').needsReview, false);
  assert.equal(rows.find((row) => row.sessionId === 'synced').needsReview, true);
});
test('filters and search compose and match names, types, IDs and status', () => {
  const rows = buildHistoryTimeline({ official: [official()], rounds: [round()], localSessions: [local()] });
  assert.equal(filterHistory(rows, { kind: 'official', search: '42' }).length, 1);
  assert.equal(filterHistory(rows, { search: '  ROUND ' }).length, 3);
  assert.equal(filterHistory(rows, { search: 'CF virtual' }).length, 1);
  assert.equal(filterHistory(rows, { search: 'Prepared' }).length, 1);
  assert.equal(filterHistory(rows, { kind: 'custom' }).length, 0);
  assert.equal(filterHistory(rows, { search: '<script>' }).length, 0);
});
