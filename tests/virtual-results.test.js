import test from 'node:test';
import assert from 'node:assert/strict';
import { buildVirtualSessions, syncRoundResults } from '../src/virtual-results.js';

const contest = { id: 42, name: 'Codeforces Round 42', durationSeconds: 7200 };
const start = 1700000000;
const problems = ['A', 'B', 'C', 'D'].map((index) => ({ contestId: 42, index, name: `Task ${index}` }));
function submission(id, elapsed, index = 'A', verdict = 'OK', extra = {}) {
  return { id, contestId: 42, creationTimeSeconds: start + elapsed, relativeTimeSeconds: elapsed,
    problem: problems.find((problem) => problem.index === index) || { contestId: 42, index, name: index },
    author: { contestId: 42, participantType: 'VIRTUAL', startTimeSeconds: start, members: [{ handle: 'Example' }] },
    verdict, testset: 'TESTS', ...extra };
}
function build(submissions, extra = {}) {
  return buildVirtualSessions({ handle: 'Example', contest, problems, submissions, nowSeconds: start + 10000, ...extra });
}

test('deduplicates attempts and counts one solve per problem at its earliest accepted submission', () => {
  const accepted = submission(3, 300);
  const result = build([submission(4, 400), accepted, accepted, submission(2, 150, 'A', 'COMPILATION_ERROR'), submission(1, 100, 'A', 'WRONG_ANSWER')]);
  assert.equal(result.sessions.length, 1);
  const session = result.sessions[0];
  assert.equal(session.solved, 1);
  assert.equal(session.attempts, 4);
  assert.equal(session.problems[0].solveSeconds, 300);
  assert.deepEqual(session.problems[0].submissionIds, [1, 2, 3, 4]);
  assert.equal(session.problems[3].state, 'unattempted');
  assert.equal(session.startEvidence, 'reported');
});

test('keeps practice and official submissions separate even within the virtual time window', () => {
  const virtual = submission(1, 100);
  const practice = submission(2, 200, 'B', 'OK', { author: { ...virtual.author, participantType: 'PRACTICE' } });
  const official = submission(3, 300, 'C', 'OK', { author: { ...virtual.author, participantType: 'CONTESTANT' } });
  const result = build([virtual, practice, official]);
  assert.equal(result.sessions[0].solved, 1);
  assert.equal(result.sessions[0].attempts, 1);
  assert.equal(result.ignored.practice, 1);
  assert.equal(result.ignored.official, 1);
  assert.equal(build([practice]).sessions.length, 0);
});

test('reconstructs a virtual start using relative time when no explicit start is provided', () => {
  const record = submission(1, 100);
  delete record.author.startTimeSeconds;
  const session = build([record]).sessions[0];
  assert.equal(session.startedAt, start);
  assert.equal(session.startEvidence, 'inferred');
  assert.equal(session.problems[0].solveSeconds, 100);
});

test('reported and inferred records of the same start belong to one session', () => {
  const inferred = submission(2, 200, 'B');
  delete inferred.author.startTimeSeconds;
  const sessions = build([submission(1, 100), inferred]).sessions;
  assert.equal(sessions.length, 1);
  assert.equal(sessions[0].solved, 2);
  assert.equal(sessions[0].startEvidence, 'mixed');
});

test('multiple virtual attempts stay separate and retain prior-exposure evidence', () => {
  const later = submission(2, 100);
  later.creationTimeSeconds += 20000;
  later.author.startTimeSeconds += 20000;
  const sessions = build([submission(1, 100), later], { nowSeconds: start + 30000 }).sessions;
  assert.equal(sessions.length, 2);
  assert.equal(sessions[0].priorAttemptProblems, 1);
  assert.equal(sessions[1].priorAttemptProblems, 0);
  assert.notEqual(sessions[0].id, sessions[1].id);
  assert.equal(sessions[1].id, `cf-virtual:example:42:${start}`);
});

test('missing, negative, future, and contradictory timing cannot create a session', () => {
  const missing = submission(1, 100);
  delete missing.author.startTimeSeconds;
  delete missing.relativeTimeSeconds;
  const contradictory = submission(2, 100, 'B', 'OK', { relativeTimeSeconds: 800 });
  const negative = submission(3, 100, 'C', 'OK', { relativeTimeSeconds: -1 });
  const future = submission(4, 20000);
  const result = build([missing, contradictory, negative, future]);
  assert.equal(result.sessions.length, 0);
  assert.equal(result.ignored.timing, 4);
});

test('allows explicit start timing when the optional relative field is absent', () => {
  const record = submission(1, 100);
  delete record.relativeTimeSeconds;
  assert.equal(build([record]).sessions[0].problems[0].solveSeconds, 100);
});

test('the contest end is exclusive and late submissions cannot inflate solves', () => {
  const session = build([submission(1, 0), submission(2, 7200, 'B'), submission(3, 7201, 'C')]).sessions[0];
  assert.equal(session.solved, 1);
  assert.equal(session.problems[0].solveSeconds, 0);
  assert.equal(session.outsideWindowCount, 2);
});

test('pending verdicts and pretest acceptances remain provisional', () => {
  const session = build([submission(1, 100, 'A', 'TESTING'), submission(2, 200, 'B', undefined),
    submission(3, 300, 'C', 'OK', { testset: 'PRETESTS' })
  ].map((record) => record.id === 2 ? { ...record, verdict: undefined } : record)).sessions[0];
  assert.equal(session.solved, 0);
  assert.equal(session.pending, 2);
  assert.equal(session.provisionalAccepted, 1);
  assert.equal(session.problems[2].state, 'provisional');
});

test('fresh failed verdicts replace previously accepted cached verdicts on reimport', () => {
  const old = submission(1, 100);
  const changed = { ...old, verdict: 'CHALLENGED' };
  assert.equal(build([changed], { historySubmissions: [old] }).sessions[0].solved, 0);
});

test('team, ghost, wrong-handle, and unrelated-contest records are excluded', () => {
  const team = submission(1, 100);
  team.author.members.push({ handle: 'Teammate' });
  const other = submission(2, 100);
  other.author.members = [{ handle: 'SomeoneElse' }];
  const ghost = submission(3, 100);
  ghost.author.ghost = true;
  const result = build([team, other, ghost, submission(4, 100, 'A', 'OK', { contestId: 900 })]);
  assert.equal(result.sessions.length, 0);
  assert.equal(result.ignored.identity, 3);
  assert.equal(result.ignored.malformed, 1);
});

test('observed problems missing from the archive are included and flagged', () => {
  const session = build([submission(1, 100, 'Z')]).sessions[0];
  assert.equal(session.unknownProblemCount, 1);
  assert.equal(session.problems.length, 5);
  assert.equal(session.solved, 1);
});

test('prior attempts on shared problems from other rounds are retained', () => {
  const earlier = submission(1, 100);
  earlier.creationTimeSeconds = start - 100;
  earlier.problem = { ...problems[0], contestId: 999 };
  assert.equal(build([submission(2, 200)], { historySubmissions: [earlier] }).sessions[0].priorAttemptProblems, 1);
});

test('no submissions does not fabricate a zero-score virtual session', () => {
  assert.deepEqual(build([]).sessions, []);
});

test('in-progress sessions are labeled using the original contest duration', () => {
  const session = build([submission(1, 100)], { nowSeconds: start + 500 }).sessions[0];
  assert.equal(session.status, 'in-progress');
  assert.equal(session.endsAt, start + 7200);
});

test('fresh round import targets contest.status and repeated imports keep stable IDs', async () => {
  const requests = [];
  const request = async (method, params) => {
    requests.push({ method, params });
    return [submission(1, 100)];
  };
  const config = { handle: 'Example', contest, problems, request, now: () => (start + 10000) * 1000 };
  const first = await syncRoundResults(config);
  const second = await syncRoundResults(config);
  assert.equal(requests.length, 2);
  assert.equal(requests[0].method, 'contest.status');
  assert.equal(requests[0].params.contestId, '42');
  assert.equal(requests[0].params.handle, 'Example');
  assert.equal(first.snapshot.complete, true);
  assert.deepEqual(first.snapshot.sessions, second.snapshot.sessions);
});

test('round import fetches every page and rejects an incomplete import', async () => {
  const rows = Array.from({ length: 1100 }, (_, index) => submission(1100 - index, 1100 - index));
  const config = { handle: 'Example', contest, problems, now: () => (start + 10000) * 1000 };
  const calls = [];
  const result = await syncRoundResults({ ...config, request: async (_method, params) => {
    calls.push(params.from);
    return rows.slice(Number(params.from) - 1, Number(params.from) - 1 + Number(params.count));
  } });
  assert.deepEqual(calls, ['1', '901']);
  assert.equal(result.snapshot.sessions[0].attempts, 1100);
  await assert.rejects(syncRoundResults({ ...config, request: async (_method, params) => {
    if (params.from !== '1') throw new Error('Network failure');
    return rows.slice(0, 1000);
  } }), /interrupted/);
});
