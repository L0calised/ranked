import test from 'node:test';
import assert from 'node:assert/strict';
import { generateCustomContest } from '../src/custom-contest.js';
import { problemKey, problemFamily } from '../src/recommendations.js';

const round = (id, extra = {}) => ({ id, name: `Codeforces Round ${id}`, type: 'CF', phase: 'FINISHED', durationSeconds: 7200, startTimeSeconds: id * 1000, ...extra });
const problem = (contestId, rating, name = `Task ${contestId}`, index = 'A') => ({ contestId, rating, name, index, type: 'PROGRAMMING' });
function pool() {
  const problems = [900, 1100, 1300, 1500, 1700].flatMap((rating, slot) => [1, 2, 3].map((copy) => problem(slot * 10 + copy, rating)));
  return { contests: problems.map((entry) => round(entry.contestId)), problems, submissions: [], rating: 1158 };
}

test('generates five ordered tasks from different source rounds with a fixed two-hour duration', () => {
  const result = generateCustomContest(pool());
  assert.equal(result.contest.kind, 'custom');
  assert.equal(result.contest.durationSeconds, 7200);
  assert.deepEqual(result.problems.map((entry) => entry.label), ['A', 'B', 'C', 'D', 'E']);
  assert.deepEqual(result.problems.map((entry) => entry.rating), [900, 1100, 1300, 1500, 1700]);
  assert.equal(new Set(result.problems.map((entry) => entry.contestId)).size, 5);
  assert.equal(new Set(result.problems.map((entry) => entry.index)).size, 1); // Original letters can repeat.
  assert.equal(result.contest.id, `custom:${result.problems.map(problemKey).join(',')}`);
});

test('prefers recent rounds when difficulty matches equally and is deterministic', () => {
  const input = pool();
  const result = generateCustomContest(input);
  assert.deepEqual(result.problems.map((entry) => entry.contestId), [3, 13, 23, 33, 43]);
  assert.deepEqual(generateCustomContest(input), result);
});

test('wrong answers, hidden source rounds, and previously offered keys are excluded', () => {
  const input = pool();
  const result = generateCustomContest({ ...input, submissions: [{ verdict: 'WRONG_ANSWER', problem: input.problems[2] }],
    excludedContestIds: [13], excludedProblemKeys: ['23/A'] });
  assert.ok(result);
  assert.ok(!result.problems.some((entry) => [3, 13, 23].includes(entry.contestId)));
});

test('prior exposure to an easy version excludes the unseen hard version as well', () => {
  const input = pool();
  input.problems.find((entry) => entry.contestId === 3).name = 'Shared task (Hard Version)';
  const result = generateCustomContest({ ...input, submissions: [{ problem: { contestId: 999, index: 'F', name: '  SHARED TASK (Easy Version) ' } }] });
  assert.ok(!result.problems.some((entry) => entry.contestId === 3));
  assert.equal(problemFamily({ name: 'Shared task (Constructive Version)' }), problemFamily({ name: 'Shared task (Counting Version)' }));
});

test('never selects two related versions within the same set', () => {
  const input = pool();
  input.problems.find((entry) => entry.contestId === 3).name = 'Duplicate (Easy Version)';
  input.problems.find((entry) => entry.contestId === 13).name = 'Duplicate (Hard Version)';
  const result = generateCustomContest(input);
  assert.equal(new Set(result.problems.map(problemFamily)).size, 5);
  assert.equal(result.problems.filter((entry) => problemFamily(entry) === 'duplicate').length, 1);
});

test('hiding a source key excludes its related variants too', () => {
  const input = pool();
  input.problems.find((entry) => entry.contestId === 2).name = 'Hidden (Easy Version)';
  input.problems.find((entry) => entry.contestId === 3).name = 'Hidden (Hard Version)';
  const result = generateCustomContest({ ...input, excludedProblemKeys: ['2/A'] });
  assert.ok(result);
  assert.ok(!result.problems.some((entry) => problemFamily(entry) === 'hidden'));
});

test('rejects unrated problems, unfinished rounds, and special events', () => {
  const input = pool();
  input.problems.find((entry) => entry.contestId === 1).rating = undefined;
  input.contests.find((entry) => entry.id === 2).phase = 'CODING';
  input.contests.find((entry) => entry.id === 3).name = 'April Fools Day Contest';
  const result = generateCustomContest(input);
  assert.ok(result);
  assert.ok(!result.problems.some((entry) => [1, 2, 3].includes(entry.contestId)));
});

test('does not manufacture an incomplete or badly calibrated set when the pool is too small', () => {
  const input = pool();
  assert.equal(generateCustomContest({ ...input, problems: input.problems.slice(0, 4) }), null);
  assert.equal(generateCustomContest({ ...input, problems: input.problems.map((entry) => ({ ...entry, rating: 3500 })) }), null);
});

test('backtracks when an early choice would consume the only source available for the hardest slot', () => {
  const problems = [problem(1, 900), problem(2, 800), problem(3, 1100), problem(4, 1300), problem(5, 1500), problem(1, 1700, 'Hardest', 'F')];
  const result = generateCustomContest({ contests: [round(1, { startTimeSeconds: 999999 }), ...[2, 3, 4, 5].map((id) => round(id))], problems, submissions: [], rating: 1200 });
  assert.ok(result);
  assert.equal(result.problems.at(-1).contestId, 1);
  assert.equal(result.problems[0].contestId, 2);
});

test('unrated users receive the documented baseline and input catalogues remain unchanged', () => {
  const input = pool();
  const before = structuredClone(input);
  const result = generateCustomContest({ ...input, rating: undefined });
  assert.ok(result);
  assert.equal(result.contest.targetRating, 1000);
  assert.deepEqual(input, before);
});

const now = Date.UTC(2026, 9, 16);
test('a complete recent set is preferred over exact difficulty matches in the old archive', () => {
  const input = pool();
  const fresh = [1000, 1200, 1400, 1600, 1800].map((rating, index) => problem(100 + index, rating));
  input.problems.push(...fresh);
  input.contests.push(...fresh.map((entry) => round(entry.contestId, { startTimeSeconds: now / 1000 - 86400 })));
  const result = generateCustomContest({ ...input, now });
  assert.ok(result.problems.every((entry) => entry.contestId >= 100));
  assert.equal(result.contest.usesOlderProblems, false);
});

test('recent-only generation cannot silently include old problems; older sources remain an explicit fallback', () => {
  const input = pool();
  assert.equal(generateCustomContest({ ...input, now, recentOnly: true }), null);
  const result = generateCustomContest({ ...input, now });
  assert.ok(result);
  assert.equal(result.contest.usesOlderProblems, true);
});

test('older fallback keeps recent sources where possible and identifies mixed-age sets', () => {
  const input = pool();
  for (const entry of input.contests) if ([3, 13, 23, 33].includes(entry.id)) entry.startTimeSeconds = now / 1000 - 86400;
  assert.equal(generateCustomContest({ ...input, now, recentOnly: true }), null);
  const result = generateCustomContest({ ...input, now });
  assert.ok(result);
  assert.deepEqual(result.problems.slice(0, 4).map((entry) => entry.contestId), [3, 13, 23, 33]);
  assert.equal(result.contest.usesOlderProblems, true);
});

test('custom generation also excludes pure Div. 1 sources for lower-rated users', () => {
  const input = pool();
  input.contests.find((entry) => entry.id === 3).name = 'Codeforces Round 3 (Div. 1)';
  const result = generateCustomContest(input);
  assert.ok(result);
  assert.ok(!result.problems.some((entry) => entry.contestId === 3));
});

test('excluding one source task leaves other unrelated tasks from its round available for custom sets', () => {
  const input = pool();
  input.problems = input.problems.filter((entry) => entry.rating !== 1300);
  input.problems.push(problem(3, 1300, 'A different task', 'B'));
  const result = generateCustomContest({ ...input, excludedProblemKeys: ['3/A'] });
  assert.ok(result);
  assert.ok(result.problems.some((entry) => entry.contestId === 3 && entry.index === 'B'));
  assert.ok(!result.problems.some((entry) => entry.contestId === 3 && entry.index === 'A'));
});
