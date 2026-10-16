import test from 'node:test';
import assert from 'node:assert/strict';
import { validateBenchmark, estimatePerformance, calculateSkill, scoringConvention, scoreVirtual, virtualEligibility } from '../src/skill-rating.js';
import { computeSkill, officialBaseline } from '../src/skill-service.js';
const start = 1700000000000;
const baseline = { rating: 1200, date: start, contestId: 90, contestName: 'Official round' };
const official = [{ contestId: 90, contestName: 'Official round', handle: 'Example', newRating: 1200, oldRating: 1100, ratingUpdateTimeSeconds: start / 1000 }];
function storage() { const map = new Map(); return { getItem: key => map.get(key) || null, setItem: (key, value) => map.set(key, value) }; }
function benchmark(minutes = 10) {
  return { contest: { id: 42, name: 'Test round', type: 'ICPC', phase: 'FINISHED', startTimeSeconds: start / 1000 - 86400, durationSeconds: 7200 },
    problems: [{ index: 'A', name: 'Task A' }, { index: 'B', name: 'Task B' }],
    changes: Array.from({ length: 40 }, (_, index) => ({ contestId: 42, handle: `peer${index}`, oldRating: 1200, rank: index + 1 })),
    rows: Array.from({ length: 40 }, (_, index) => ({ handle: `peer${index}`, rank: index + 1, points: 1, penalty: 10 + index, successfulHackCount: 0, unsuccessfulHackCount: 0 })),
    samples: Array.from({ length: 10 }, (_, index) => ({ points: 1, penalty: 10 + index + minutes,
      problemResults: [{ points: 1, type: 'FINAL', bestSubmissionTimeSeconds: (10 + index) * 60 + 59, rejectedAttemptCount: 1 }, { points: 0, type: 'FINAL', rejectedAttemptCount: 12 }] })),
  };
}
function round(at = start + 86400000) {
  const session = { id: `cf-virtual:example:42:${at / 1000}`, startedAt: at / 1000, endsAt: at / 1000 + 7200,
    startEvidence: 'reported', attempts: 1, pending: 0, provisionalAccepted: 0, priorAttemptProblems: 0, unknownProblemCount: 0,
    problems: [{ index: 'A', state: 'accepted', solveSeconds: 1200, penaltyAttempts: 0, icpcPenaltyAttempts: 0 }, { index: 'B', state: 'unattempted', penaltyAttempts: 0, icpcPenaltyAttempts: 0 }] };
  return { contestId: 42, complete: true, historyComplete: true, syncedAt: at + 8000000, ignored: { identity: 0, timing: 0, malformed: 0 }, sessions: [session] };
}
test('latest published official result defines the VC reset even when rating is unchanged', () => {
  const later = { ...official[0], contestId: 91, ratingUpdateTimeSeconds: start / 1000 + 10 };
  assert.equal(officialBaseline([official[0], later], start + 20000).contestId, 91);
  assert.equal(officialBaseline([official[0], later], start + 5000).contestId, 90);
});
test('without virtuals VC estimate equals the latest official rating exactly', () => {
  const value = calculateSkill([], start + 1000, baseline);
  assert.equal(value.rating, 1200); assert.equal(value.count, 0); assert.equal(value.baselineOnly, true);
});
test('a good virtual changes the VC estimate and produces one delta', () => {
  const value = calculateSkill([{ id: 'vc1', kind: 'virtual', startedAt: start + 1000, date: start + 10000, performance: 1600, coverage: 1 }], start + 20000, baseline);
  assert.ok(value.rating > 1200 && value.rating < 1600);
  assert.equal(value.entries[0].rankedDelta, value.rating - 1200);
});
test('new main contest discards all earlier VC adjustments and resets to its new rating', () => {
  const observations = [{ id: 'vc1', kind: 'virtual', startedAt: start + 1000, date: start + 10000, performance: 2000 }];
  assert.ok(calculateSkill(observations, start + 20000, baseline).rating > 1200);
  const reset = calculateSkill(observations, start + 30000, { rating: 1250, date: start + 25000 });
  assert.equal(reset.rating, 1250); assert.equal(reset.count, 0);
});
test('the period lasts until the next main contest, without a fourteen-day or twenty-result cap', () => {
  const observations = Array.from({ length: 25 }, (_, i) => ({ id: `vc${i}`, kind: 'virtual', startedAt: start + i * 86400000 + 1000, date: start + (i + 1) * 86400000, performance: 1300 }));
  assert.equal(calculateSkill([...observations, observations[24]], start + 30 * 86400000, baseline).count, 25);
});
test('official results seed the estimate without downloading or replaying official fields', async () => {
  const result = await computeSkill({ handle: 'Example', official, rounds: [], storage: storage(), now: start + 1000,
    benchmark: () => { throw new Error('No standings request is needed'); } });
  assert.equal(result.skill.rating, 1200); assert.equal(result.skill.count, 0);
});
test('a full virtual after the reset is counted automatically', async () => {
  const result = await computeSkill({ handle: 'Example', official, rounds: [round()], storage: storage(), now: start + 2 * 86400000, benchmark: async () => benchmark() });
  assert.equal(result.skill.count, 1); assert.equal(result.analyses[0].counted, true);
});
test('a virtual that started before the main contest reset cannot leak into the new VC period', async () => {
  const result = await computeSkill({ handle: 'Example', official, rounds: [round(start - 1000000)], storage: storage(), now: start + 2 * 86400000,
    benchmark: () => { throw new Error('Pre-reset virtual must not download a field'); } });
  assert.equal(result.skill.rating, 1200); assert.equal(result.skill.count, 0);
});
test('field download failure preserves the entire prior report', async () => {
  const raw = storage(); const args = { handle: 'Example', official, storage: raw, now: start + 2 * 86400000 };
  await computeSkill({ ...args, rounds: [] }); const saved = raw.getItem('ranked-skill-example');
  await assert.rejects(computeSkill({ ...args, rounds: [round()], benchmark: async () => { throw new Error('offline'); } }), /offline/);
  assert.equal(raw.getItem('ranked-skill-example'), saved);
});
test('incomplete original field can give an approximate comparison against available opponents', () => {
  const data = benchmark(); data.rows = data.rows.slice(0, 30); validateBenchmark(data, 42);
  assert.equal(estimatePerformance(data, { points: 1, penalty: 25 }, 'Example').coverage, 0.75);
});
test('limited coverage increases uncertainty and reduces influence in either direction', () => {
  for (const performance of [800, 1800]) {
    const observation = { id: 'vc', kind: 'virtual', startedAt: start + 1000, date: start + 10000, performance };
    const full = calculateSkill([{ ...observation, coverage: 1 }], start + 20000, baseline);
    const partial = calculateSkill([{ ...observation, coverage: 0.5 }], start + 20000, baseline);
    assert.ok(Math.abs(partial.rating - 1200) < Math.abs(full.rating - 1200));
    assert.ok(partial.uncertainty >= full.uncertainty);
  }
});
test('at least 25 established opponents remain necessary for performance', () => {
  const data = benchmark(); data.rows = data.rows.slice(0, 24);
  assert.throws(() => estimatePerformance(data, { points: 1, penalty: 25 }, 'Example'), /25 opponents/);
});
test('familiarity, pending verdicts and incomplete history do not become rated evidence', () => {
  const snapshot = round(); const session = snapshot.sessions[0]; const data = benchmark();
  assert.match(virtualEligibility({ ...snapshot, historyComplete: false }, session, data, start + 2 * 86400000), /complete submission history/);
  assert.match(virtualEligibility(snapshot, { ...session, priorAttemptProblems: 1 }, data, start + 2 * 86400000), /Earlier attempts/);
  assert.match(virtualEligibility(snapshot, { ...session, pending: 1 }, data, start + 2 * 86400000), /pending/);
});
test('both ten- and twenty-minute ICPC penalties are detected from official samples', () => {
  assert.equal(scoringConvention(benchmark(10)).penaltyMinutes, 10);
  assert.equal(scoringConvention(benchmark(20)).penaltyMinutes, 20);
});
test('virtual score uses the detected penalty and floors solve time to minutes', () => {
  const value = scoreVirtual({ problems: [{ index: 'A', state: 'accepted', solveSeconds: 659, penaltyAttempts: 1, icpcPenaltyAttempts: 2 }] }, benchmark(10));
  assert.equal(value.points, 1); assert.equal(value.penalty, 30);
});
test('contradictory scoring is rejected', () => {
  const data = benchmark(); data.samples[9].penalty += 7;
  assert.throws(() => scoringConvention(data), /unsupported penalty/);
});
test('unrated users without observable sessions get no fabricated rating', () => {
  assert.equal(calculateSkill([], start).rating, null);
});

test('cached overlapping virtuals disappear immediately when a new official reset arrives', () => {
  const observations = [{ id: 'overlap', kind: 'virtual', startedAt: start + 1000, date: start + 10000, performance: 2000 }];
  assert.equal(calculateSkill(observations, start + 20000, baseline).count, 1);
  const reset = calculateSkill(observations, start + 20000, { ...baseline, date: start + 5000 });
  assert.equal(reset.count, 0); assert.equal(reset.rating, baseline.rating);
});
test('unverifiable legacy observations and invalid coverage cannot distort a reset estimate', () => {
  const observation = { id: 'legacy', kind: 'virtual', date: start + 10000, performance: 2000 };
  assert.equal(calculateSkill([observation], start + 20000, baseline).count, 0);
  for (const coverage of [NaN, -1, 0, 2]) {
    assert.equal(calculateSkill([{ ...observation, startedAt: start + 1000, coverage }], start + 20000, baseline).rating, baseline.rating);
  }
});
