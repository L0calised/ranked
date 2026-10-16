import test from 'node:test';
import assert from 'node:assert/strict';
import { recommendRounds, isRecentRound, divisionPreference } from '../src/recommendations.js';

function round(id, overrides = {}) {
  return { id, name: `Codeforces Round ${id} (Div. 2)`, phase: 'FINISHED', type: 'CF', durationSeconds: 7200, startTimeSeconds: id * 100, ...overrides };
}
function lineup(contestId) {
  return [['A', 800], ['B1', 1000], ['B2', 1200], ['C', 1600], ['D', 2200], ['E', 2800], ['F', undefined]]
    .map(([index, rating]) => ({ contestId, index, rating, name: `Task ${contestId} ${index}` }));
}
function search(overrides = {}) {
  return recommendRounds({ contests: [round(1)], problems: lineup(1), submissions: [], rating: 1158, ...overrides });
}
test('keeps hard, unrated, and split-version problems in contest order', () => {
  const result = search({ problems: lineup(1).reverse() });
  assert.equal(result.length, 1);
  assert.deepEqual(result[0].problems.map((problem) => problem.index), ['A', 'B1', 'B2', 'C', 'D', 'E', 'F']);
  assert.equal(result[0].contest.durationSeconds, 7200);
});
test('an unsuccessful attempt excludes the whole round', () => {
  assert.deepEqual(search({ submissions: [{ verdict: 'WRONG_ANSWER', problem: lineup(1)[4] }] }), []);
});
test('recognizes shared names across contest IDs', () => {
  assert.deepEqual(search({ submissions: [{ problem: { ...lineup(1)[0], contestId: 900, index: 'C' } }] }), []);
});
test('prefers the most recent eligible round', () => {
  const result = search({ contests: [round(1), round(2)], problems: [...lineup(1), ...lineup(2)] });
  assert.deepEqual(result.map((entry) => entry.contest.id), [2, 1]);
});
test('skips recognized and displayed rounds', () => {
  assert.deepEqual(search({ excludedIds: ['1'] }), []);
});
test('includes Codeforces rounds using ICPC scoring', () => {
  assert.equal(search({ contests: [round(1, { type: 'ICPC', name: 'Codeforces Round 1 (Div. 3)' })] }).length, 1);
});
test('rejects live rounds, special events, and unsuitable opening difficulty', () => {
  assert.deepEqual(search({ contests: [round(1, { phase: 'CODING' })] }), []);
  assert.deepEqual(search({ contests: [round(1, { name: 'April Fools Day Contest' })] }), []);
  assert.deepEqual(search({ rating: 0 }), []);
  assert.deepEqual(search({ problems: lineup(1).map((problem) => ({ ...problem, rating: undefined })) }), []);
});
test('uses a 1000 baseline for unrated accounts', () => {
  assert.equal(search({ rating: undefined }).length, 1);
});
test('does not mutate source problem order', () => {
  const problems = lineup(1).reverse();
  const before = problems.map((problem) => problem.index);
  search({ problems });
  assert.deepEqual(problems.map((problem) => problem.index), before);
});

const now = Date.UTC(2026, 9, 16);
test('prefers recent rounds before older rounds even if the older division is a better match', () => {
  const contests = [round(1, { name: 'Codeforces Round 1 (Div. 3)', startTimeSeconds: Date.UTC(2020, 0, 1) / 1000 }),
    round(2, { startTimeSeconds: Date.UTC(2026, 0, 1) / 1000 })];
  const result = search({ contests, problems: [...lineup(1), ...lineup(2)], now });
  assert.deepEqual(result.map((entry) => entry.contest.id), [2, 1]);
});

test('prefers Div. 2 within the recent window even when a Div. 3 is newer, retaining the full lineup', () => {
  const contests = [round(1, { name: 'Codeforces Round 1 (Div. 3)', startTimeSeconds: Date.UTC(2026, 0, 1) / 1000 }),
    round(2, { startTimeSeconds: Date.UTC(2025, 0, 1) / 1000 })];
  const result = search({ contests, problems: [...lineup(1), ...lineup(2)], now });
  assert.deepEqual(result.map((entry) => entry.contest.id), [2, 1]);
  assert.equal(result[0].problems.length, lineup(1).length);
});

test('pure Div. 1 rounds require a higher user rating, while combined rounds remain available', () => {
  assert.deepEqual(search({ contests: [round(1, { name: 'Codeforces Round 1 (Div. 1)' })] }), []);
  assert.equal(search({ rating: 2200, contests: [round(1, { name: 'Codeforces Round 1 (Div. 1)' })] }).length, 1);
  for (const name of ['Codeforces Round 1 (Div. 1 + Div. 2)', 'Codeforces Round 1 (Div. 1 + 2)']) {
    assert.equal(search({ contests: [round(1, { name })] }).length, 1);
  }
});

test('division priority is Div. 2, then Div. 3, then Div. 4; Div. 1 still requires a higher rating', () => {
  const div = (value) => round(1, { name: `Codeforces Round 1 (Div. ${value})` });
  assert.equal(divisionPreference(div(4), undefined), 2);
  assert.equal(divisionPreference(div(3), 1300), 1);
  assert.equal(divisionPreference(div(2), 1800), 0);
  assert.equal(divisionPreference(div(1), 2099), Infinity);
  assert.ok(Number.isFinite(divisionPreference(div(1), 2100)));
});

test('Div. 2 > Div. 3 > Div. 4 ordering applies to rated and unrated users', () => {
  const contests = [4, 3, 2].map((division, index) => round(index + 1, {
    name: `Codeforces Round ${index + 1} (Div. ${division})`, startTimeSeconds: now / 1000 - (index + 1) * 86400,
  }));
  for (const rating of [undefined, 1158, 1800]) {
    const result = search({ contests, problems: contests.flatMap((contest) => lineup(contest.id)), rating, now });
    assert.deepEqual(result.map((entry) => entry.contest.id), [3, 2, 1]);
  }
});

test('the recent window uses a two-year calendar boundary and retains older fallback candidates', () => {
  const boundary = Date.UTC(2024, 9, 16) / 1000;
  assert.equal(isRecentRound(round(1, { startTimeSeconds: boundary }), now), true);
  assert.equal(isRecentRound(round(1, { startTimeSeconds: boundary - 1 }), now), false);
  assert.equal(isRecentRound(round(1, { startTimeSeconds: now / 1000 + 1 }), now), false);
  assert.equal(search({ now }).length, 1);
});
