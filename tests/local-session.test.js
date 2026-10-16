import test from 'node:test';
import assert from 'node:assert/strict';
import { prepareLocalSession, beginLocalSession, scheduleLocalSession, activateScheduledSession, finishLocalSession, buildLocalResults, fetchLocalSubmissions, createLocalSessionStore } from '../src/local-session.js';

const start = 1700000000000;
const contest = { id: 42, name: 'Test round', durationSeconds: 7200 };
const problems = ['A', 'B1', 'B2', 'C', 'D'].map((index) => ({ contestId: 42, index, name: `Task ${index}` }));
const draft = (extra = {}) => prepareLocalSession({ id: 'session-1', handle: 'Example', contest, problems, now: start - 60000, ...extra });
const active = (baseline = []) => beginLocalSession(draft(), baseline, start);
const record = (id, seconds, index = 'A', verdict = 'OK', extra = {}) => ({
  id, contestId: 42, problem: problems.find((problem) => problem.index === index),
  creationTimeSeconds: start / 1000 + seconds, verdict, testset: 'TESTS',
  author: { contestId: 42, participantType: 'PRACTICE', members: [{ handle: 'Example' }] }, ...extra,
});
const build = (session, submissions) => buildLocalResults(session, submissions, start + 8000000);

test('preparation retains the full lineup without starting the timer', () => {
  const session = draft({ problems: [...problems].reverse() });
  assert.equal(session.status, 'ready');
  assert.equal(session.startedAt, null);
  assert.equal(session.endsAt, null);
  assert.deepEqual(session.problems.map((problem) => problem.index), ['A', 'B1', 'B2', 'C', 'D']);
  assert.throws(() => build(session, []));
});

test('setup time is excluded; starting aligns to CF seconds and uses the original duration', () => {
  const session = beginLocalSession(draft(), [], start + 123456);
  assert.equal(session.startedAt, start + 124000);
  assert.equal(session.endsAt - session.startedAt, 7200000);
  assert.throws(() => beginLocalSession(session, [], start + 999999));
});

test('an older pending submission cannot be credited after it becomes accepted', () => {
  const old = record(1, -20, 'A', 'TESTING');
  const session = active([old]);
  const results = build(session, [{ ...old, verdict: 'OK' }, record(2, 30, 'B1')]);
  assert.equal(results.solved, 1);
  assert.equal(results.ignored.baseline, 1);
  assert.equal(results.problems[0].priorAttempts, 1);
});

test('counts only new practice submissions within the exact time window', () => {
  const results = build(active(), [record(1, -1), record(2, 0), record(3, 7199, 'B1'), record(4, 7200, 'C'), record(5, 7201, 'D')]);
  assert.equal(results.solved, 2);
  assert.equal(results.attempts, 2);
  assert.equal(results.problems[0].solveSeconds, 0);
  assert.equal(results.ignored.beforeStart, 1);
  assert.equal(results.ignored.afterEnd, 2);
});

test('virtual and official submissions cannot become local practice solves', () => {
  const virtual = record(1, 10);
  virtual.author.participantType = 'VIRTUAL';
  const official = record(2, 20);
  official.author.participantType = 'CONTESTANT';
  const results = build(active(), [virtual, official]);
  assert.equal(results.solved, 0);
  assert.equal(results.ignored.nonPractice, 2);
});

test('wrong handle, team, ghost, and mismatched contest data are excluded', () => {
  const wrong = record(1, 10); wrong.author.members[0].handle = 'SomeoneElse';
  const team = record(2, 20); team.author.members.push({ handle: 'Teammate' });
  const ghost = record(3, 30); ghost.author.ghost = true;
  const mismatch = record(4, 40); mismatch.author.contestId = 999;
  const results = build(active(), [wrong, team, ghost, mismatch]);
  assert.equal(results.solved, 0);
  assert.equal(results.ignored.invalid, 4);
});

test('deduplicates submissions and finds the earliest confirmed solve', () => {
  const accepted = record(3, 100);
  const results = build(active(), [record(4, 200), accepted, accepted, record(1, 30, 'A', 'WRONG_ANSWER'), record(2, 50, 'A', 'COMPILATION_ERROR')]);
  assert.equal(results.attempts, 4);
  assert.equal(results.solved, 1);
  assert.equal(results.problems[0].solveSeconds, 100);
});

test('pending verdicts and pretest acceptances remain provisional', () => {
  const results = build(active(), [record(1, 30, 'A', 'TESTING'), record(2, 40, 'B1', 'OK', { testset: 'PRETESTS' })]);
  assert.equal(results.solved, 0);
  assert.equal(results.pending, 2);
  assert.equal(results.problems[0].state, 'pending');
  assert.equal(results.problems[1].state, 'provisional');
});

test('an early finish fixes the cutoff and cannot be resumed or extended', () => {
  const session = finishLocalSession(active(), start + 120500);
  assert.equal(session.endedAt, start + 120000);
  assert.equal(session.endReason, 'ended-early');
  const results = build(session, [record(1, 119), record(2, 120, 'B1')]);
  assert.equal(results.solved, 1);
  assert.equal(results.ignored.afterEnd, 1);
  assert.equal(finishLocalSession(session, start + 500000).endedAt, session.endedAt);
  assert.throws(() => finishLocalSession(draft(), start));
});

test('time expiry keeps the original deadline even when the page was closed', () => {
  const session = finishLocalSession(active(), start + 9000000);
  assert.equal(session.endedAt, start + 7200000);
  assert.equal(session.endReason, 'time-expired');
});

test('fresh verdicts can remove a solve after a rejudge without changing the session window', () => {
  const session = finishLocalSession(active(), start + 7200000);
  assert.equal(build(session, [record(1, 100)]).solved, 1);
  assert.equal(build(session, [record(1, 100, 'A', 'CHALLENGED')]).solved, 0);
  assert.equal(session.endedAt, start + 7200000);
});

test('preserves familiarity from shared problems in earlier rounds', () => {
  const earlier = record(1, -100);
  earlier.problem = { ...earlier.problem, contestId: 999 };
  const session = beginLocalSession(draft({ historySubmissions: [earlier] }), [], start);
  assert.equal(build(session, []).priorAttemptProblems, 1);
});

function memoryStorage() {
  const map = new Map();
  return { get length() { return map.size; }, key: (index) => [...map.keys()][index], getItem: (name) => map.get(name) || null,
    setItem: (name, value) => map.set(name, value) };
}

test('restores fixed times after reload and isolates local session history by handle', () => {
  const storage = memoryStorage();
  const store = createLocalSessionStore(storage);
  store.save(active());
  const reloaded = createLocalSessionStore(storage);
  assert.deepEqual(reloaded.load('session-1'), active());
  assert.equal(reloaded.findOpen('EXAMPLE', start).id, 'session-1');
  assert.equal(reloaded.list('another').length, 0);
  assert.throws(() => store.save({ ...active(), startedAt: start + 1000, endsAt: start + 7201000 }));
  store.save(finishLocalSession(active(), start + 100000));
  assert.throws(() => store.save(active()));
});

test('scheduled starts survive reload, reject premature activation, and keep the chosen window after a late return', () => {
  const store = createLocalSessionStore(memoryStorage());
  const scheduled = store.save(scheduleLocalSession(draft(), [], start, start - 60000));
  assert.equal(scheduled.status, 'scheduled');
  assert.equal(scheduled.startedAt, null);
  assert.throws(() => activateScheduledSession(scheduled, start - 1));
  assert.throws(() => build(scheduled, []));
  assert.throws(() => scheduleLocalSession(draft(), [], start - 1, start));
  const resumed = store.save(activateScheduledSession(store.load(scheduled.id), start + 600000));
  assert.equal(resumed.startedAt, start);
  assert.equal(resumed.endsAt, start + 7200000);
  assert.equal(resumed.status, 'active');
  assert.throws(() => store.save({ ...scheduled, scheduledAt: start + 60000, endsAt: start + 7260000 }));
});

test('reopening after the entire scheduled window ends uses the original expiry', () => {
  const scheduled = scheduleLocalSession(draft(), [], start, start - 60000);
  const ended = activateScheduledSession(scheduled, start + 9000000);
  assert.equal(ended.status, 'ended');
  assert.equal(ended.endedAt, start + 7200000);
  assert.equal(ended.endReason, 'time-expired');
});

test('attempts made during the waiting countdown count as prior exposure, never as contest solves', () => {
  const scheduled = scheduleLocalSession(draft(), [], start, start - 60000);
  const results = build(activateScheduledSession(scheduled, start), [record(1, -20), record(2, 20)]);
  assert.equal(results.solved, 1);
  assert.equal(results.ignored.beforeStart, 1);
  assert.equal(results.priorAttemptProblems, 1);
  assert.equal(results.problems[0].priorAttempts, 1);
});

test('expired records do not mask a still-open session and invalid stored records are ignored', () => {
  const storage = memoryStorage();
  const store = createLocalSessionStore(storage);
  const first = active();
  const second = { ...beginLocalSession(draft({ id: 'session-2' }), [], start + 8000000), createdAt: start + 1 };
  store.save(first);
  store.save(second);
  assert.equal(store.findOpen('example', start + 8000000).id, 'session-2');
  assert.equal(store.findOpen('example', start + 16000000), null);
  storage.setItem('ranked-local-session-broken', JSON.stringify({ ...first, id: 'broken', baselineIds: null }));
  assert.equal(store.load('broken'), null);
  assert.throws(() => store.save({ ...first, id: 'invalid', handle: 42 }));
});

test('local result sync fetches fresh contest pages and propagates API errors', async () => {
  const calls = [];
  const rows = await fetchLocalSubmissions(active(), async (method, params) => {
    calls.push({ method, params }); return [record(1, 30)];
  });
  assert.equal(calls[0].method, 'contest.status');
  assert.equal(calls[0].params.handle, 'example');
  assert.equal(calls[0].params.contestId, '42');
  assert.equal(rows.length, 1);
  await assert.rejects(fetchLocalSubmissions(active(), async () => { throw new Error('Offline'); }), /Offline/);
});

const customDraft = () => prepareLocalSession({ id: 'custom-session', handle: 'Example', now: start - 60000,
  contest: { id: 'custom:42/A,43/A,44/A,45/A,46/A', kind: 'custom', name: 'Custom practice contest', durationSeconds: 7200 },
  problems: [42, 43, 44, 45, 46].map((contestId, index) => ({ contestId, index: 'A', name: `Source ${contestId}`, rating: 900 + index * 200 })),
});
function customRecord(id, contestId, seconds) {
  return { ...record(id, seconds), contestId, problem: { contestId, index: 'A', name: `Source ${contestId}` },
    author: { contestId, participantType: 'PRACTICE', members: [{ handle: 'Example' }] } };
}

test('custom sources with identical original letters keep distinct labels, solves, and submission identities', () => {
  const session = beginLocalSession(customDraft(), [], start);
  assert.deepEqual(session.problems.map((problem) => problem.label), ['A', 'B', 'C', 'D', 'E']);
  const results = build(session, [customRecord(1, 42, 10), customRecord(2, 43, 20), customRecord(3, 43, 30), customRecord(4, 999, 40)]);
  assert.equal(results.solved, 2);
  assert.deepEqual(results.problems.map((problem) => problem.attempts), [1, 2, 0, 0, 0]);
  assert.deepEqual(results.problems.slice(0, 2).map((problem) => [problem.contestId, problem.index, problem.label]), [[42, 'A', 'A'], [43, 'A', 'B']]);
  const store = createLocalSessionStore(memoryStorage());
  store.save({ ...session, results });
  assert.equal(store.load(session.id).results.solved, 2);
  assert.throws(() => store.save({ ...session, problems: [...session.problems].reverse() }));
});

test('custom tracking fetches user history once and filters unrelated source rounds', async () => {
  const calls = [];
  const rows = [customRecord(3, 43, 30), customRecord(2, 999, 20), customRecord(1, 42, -70)];
  const fetched = await fetchLocalSubmissions(customDraft(), async (method, params) => {
    calls.push({ method, params }); return rows;
  });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].method, 'user.status');
  assert.deepEqual(fetched.map((submission) => submission.id), [3, 1]);
});

test('custom tracking retains prior exposure to a related version from another source round', async () => {
  const related = customRecord(5, 999, -20);
  related.problem.name = 'Source 42 (Easy Version)';
  const fetched = await fetchLocalSubmissions(customDraft(), async () => [customRecord(6, 42, 10), related]);
  assert.equal(fetched.length, 2);
  const results = build(beginLocalSession(customDraft(), [], start), fetched);
  assert.equal(results.solved, 1);
  assert.equal(results.problems[0].priorAttempts, 1);
  assert.equal(results.ignored.invalid, 1);
});

test('round sessions saved before labels and source IDs were added still restore correctly', () => {
  const session = active();
  session.results = build(session, [record(1, 10)]);
  delete session.contest.kind;
  session.problems.forEach((problem) => { delete problem.label; });
  session.results.problems.forEach((problem) => { delete problem.contestId; delete problem.label; });
  const storage = memoryStorage();
  storage.setItem('ranked-local-session-' + session.id, JSON.stringify(session));
  const store = createLocalSessionStore(storage);
  assert.equal(store.load(session.id).results.solved, 1);
  assert.equal(store.save(store.load(session.id)).contest.id, 42);
});
