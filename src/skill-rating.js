export const SKILL_VERSION = 8;
export const SKILL_DAYS = 14;
export const SKILL_WINDOW_MS = SKILL_DAYS * 86400000;
const finite = Number.isFinite;
const count = (value) => Number.isSafeInteger(value) && value >= 0;
const codingPoints = (row, type) => type === 'CF'
  ? row.points - 100 * row.successfulHackCount + 50 * row.unsuccessfulHackCount : row.points;

export function validateBenchmark(data, contestId) {
  if (data?.contest?.id !== contestId || data.contest.phase !== 'FINISHED' || data.contest.frozen
    || !['CF', 'ICPC'].includes(data.contest.type) || !count(data.contest.startTimeSeconds) || !count(data.contest.durationSeconds)
    || data.contest.durationSeconds <= 0 || !Array.isArray(data.problems) || !data.problems.length
    || data.problems.some((p) => typeof p?.index !== 'string') || new Set(data.problems.map((p) => p.index)).size !== data.problems.length
    || !Array.isArray(data.rows) || !Array.isArray(data.samples) || !Array.isArray(data.changes)) throw new Error('Unsupported or incomplete final contest benchmark.');
  const owners = new Set();
  for (const row of data.rows) {
    if (typeof row.handle !== 'string' || owners.has(row.handle.toLowerCase()) || !finite(row.points)
      || !count(row.penalty) || !count(row.successfulHackCount) || !count(row.unsuccessfulHackCount)
      || codingPoints(row, data.contest.type) < -0.01) throw new Error('Invalid standings row.');
    owners.add(row.handle.toLowerCase());
  }
  const changed = new Set();
  for (const change of data.changes) {
    if (change?.contestId !== contestId || typeof change.handle !== 'string' || changed.has(change.handle.toLowerCase())
      || !Number.isSafeInteger(change.oldRating) || !count(change.rank) || change.rank < 1) throw new Error('Invalid rated contest field.');
    changed.add(change.handle.toLowerCase());

  }

  return data;
}

export function cfProblemScore(maximum, seconds, wrong, factor = 1) {
  return Math.max(maximum * 0.3, maximum - Math.floor(maximum * Math.floor(seconds / 60) * factor / 250) - 50 * wrong);
}

// Validate the score convention against final official task results before using it.
// Unsupported/special rounds fail closed rather than silently adopting a default.
export function scoringConvention(data) {
  const { contest, problems, samples } = data;
  if (samples.length < 10) throw new Error('Too little scoring evidence in this contest.');
  if (contest.type === 'ICPC') {
    let accepted = 0;
    const candidates = new Set([10, 20]);
    for (const row of samples) {
      if (row.problemResults?.length !== problems.length) throw new Error('Incomplete scoring sample.');
      let points = 0; let solveMinutes = 0; let wrong = 0;
      for (const result of row.problemResults) {
        if (result.type !== 'FINAL' || !count(result.rejectedAttemptCount) || !finite(result.points)) throw new Error('Final task scoring evidence is missing.');
        if (result.points > 0) {
          if (result.points !== 1 || !count(result.bestSubmissionTimeSeconds)) throw new Error('Nonstandard ICPC scoring is unsupported.');
          points += 1; accepted += 1;
          solveMinutes += Math.floor(result.bestSubmissionTimeSeconds / 60);
          wrong += result.rejectedAttemptCount;
        }
      }
      if (points !== row.points || !count(row.penalty)) throw new Error('This round uses unsupported solved-count scoring.');
      for (const minutes of candidates) {
        if (solveMinutes + minutes * wrong !== row.penalty) candidates.delete(minutes);
      }
      if (!candidates.size) throw new Error('This round uses an unsupported penalty convention.');
    }
    if (accepted < 10) throw new Error('Too little scoring evidence.');
    if (candidates.size !== 1) throw new Error('Not enough wrong-attempt evidence to determine this round’s penalty.');
    return { type: 'ICPC', penaltyMinutes: [...candidates][0] };
  }
  if (problems.some((problem) => !finite(problem.points) || problem.points <= 0)) throw new Error('Original problem point values are unavailable.');
  const factors = [...new Set([7200 / contest.durationSeconds, 1])];
  const verified = [];
  for (const factor of factors) {
    let checks = 0; let valid = true;
    for (const row of samples) {
      if (row.problemResults?.length !== problems.length) { valid = false; break; }
      for (let index = 0; index < problems.length; index += 1) {
        const result = row.problemResults[index];
        if (result.type !== 'FINAL' || !count(result.rejectedAttemptCount) || !finite(result.points)) { valid = false; break; }
        if (result.points <= 0) continue;
        if (!count(result.bestSubmissionTimeSeconds)
          || Math.abs(cfProblemScore(problems[index].points, result.bestSubmissionTimeSeconds, result.rejectedAttemptCount, factor) - result.points) > 0.01) { valid = false; break; }
        checks += 1;
      }
      if (!valid) break;
    }
    if (valid && checks >= 20) verified.push(factor);
  }
  if (verified.length === 1) return { type: 'CF', factor: verified[0] };
  throw new Error(verified.length > 1 ? 'Time-decay scoring is ambiguous in the available samples.' : 'The original scoring convention could not be verified.');
}

export function virtualEligibility(snapshot, session, data, now = Date.now()) {
  if (!snapshot?.complete || snapshot.syncedAt < session.endsAt * 1000 || now < session.endsAt * 1000) return 'Waiting for the full contest window and a final result refresh.';
  if (!snapshot.historyComplete) return 'Refresh and import with complete submission history first.';
  if (session.pending || session.provisionalAccepted) return 'Judging or final-test confirmation is pending.';
  if (session.startEvidence !== 'reported') return 'A Codeforces-reported start time is required.';
  if (session.unknownProblemCount || snapshot.ignored.identity || snapshot.ignored.timing || snapshot.ignored.malformed) return 'Submission identity, timing, or lineup needs review.';
  const keys = session.problems.map((p) => p.index).sort().join(',');
  if (keys !== data.problems.map((p) => p.index).sort().join(',')) return 'The saved lineup does not match the official lineup.';
  if (session.endsAt - session.startedAt !== data.contest.durationSeconds) return 'The contest duration does not match.';
  if (session.startedAt < (data.contest.startTimeSeconds + data.contest.durationSeconds)) return 'Virtual participation predates the original contest end.';
  if (!session.attempts) return 'No public submission evidence.';
  if (session.problems.some((p) => data.contest.type === 'ICPC' ? !count(p.icpcPenaltyAttempts) : !count(p.penaltyAttempts) || p.scoringAmbiguous)) return 'Refresh this session: scoring evidence is missing or ambiguous.';
  return null;
}

export function scoreVirtual(session, data) {
  const convention = scoringConvention(data);
  let points = 0; let penalty = 0;
  for (const problem of session.problems) {
    if (problem.state !== 'accepted') continue;
    if (!count(problem.solveSeconds) || !count(problem.penaltyAttempts)) throw new Error('Invalid solve-time evidence.');
    const source = data.problems.find((p) => p.index === problem.index);
    if (convention.type === 'ICPC') {
      points += 1; penalty += Math.floor(problem.solveSeconds / 60) + convention.penaltyMinutes * problem.icpcPenaltyAttempts;
    } else points += cfProblemScore(source.points, problem.solveSeconds, problem.penaltyAttempts, convention.factor);
  }
  return { points, penalty, convention };
}

// Elo expected wins against the original rated field, with midrank ties and a
// half-win/half-loss regularizer at the extremes. This is not CF's delta formula.
export function estimatePerformance(data, target, owner) {
  const changes = new Map(data.changes.map((r) => [r.handle.toLowerCase(), r]));
  const field = data.rows.filter((row) => row.handle.toLowerCase() !== owner.toLowerCase()
    && changes.get(row.handle.toLowerCase())?.oldRating > 0);
  if (field.length < 25) throw new Error('At least 25 opponents with established pre-contest ratings are required.');
  let better = 0; let tied = 0;
  const ratings = [];
  for (const row of field) {
    const points = codingPoints(row, data.contest.type);
    const samePoints = Math.abs(points - target.points) < 0.01;
    const comparison = samePoints ? data.contest.type === 'ICPC' ? target.penalty - row.penalty : 0 : points - target.points;
    if (comparison > 0) better += 1;
    else if (comparison === 0) tied += 1;
    ratings.push(changes.get(row.handle.toLowerCase()).oldRating);
  }
  const established = data.changes.filter((change) => change.handle.toLowerCase() !== owner.toLowerCase() && change.oldRating > 0);
  const coverage = established.length ? field.length / established.length : 0;
  return { ...performanceFromField(ratings, better, tied), points: target.points, penalty: target.penalty, coverage };
}

function performanceFromField(ratings, better, tied) {
  const size = ratings.length;
  const winFraction = (size - better - tied / 2 + 0.5) / (size + 1);
  let low = -500; let high = 5000;
  for (let step = 0; step < 50; step += 1) {
    const middle = (low + high) / 2;
    const expected = ratings.reduce((sum, rating) => sum + 1 / (1 + 10 ** ((rating - middle) / 400)), 0) / size;
    if (expected < winFraction) low = middle; else high = middle;
  }
  return { performance: Math.round((low + high) / 2), estimatedRank: 1 + better + tied / 2,
    fieldSize: size, boundary: better === 0 || better + tied === size };
}

export function calculateSkill(observations, now = Date.now(), baseline = null) {
  const cutoff = baseline?.date ?? now - SKILL_WINDOW_MS;
  const unique = [...new Map(observations.filter((r) => r && typeof r.id === 'string' && finite(r.performance) && finite(r.date) && r.date > cutoff && r.date <= now
    && (finite(r.startedAt) ? r.startedAt > cutoff && r.startedAt <= r.date : !baseline || r.baselineDate === baseline.date)
    && (r.coverage == null || finite(r.coverage) && r.coverage > 0 && r.coverage <= 1)
    && r.kind === 'virtual').map((r) => [r.id, r])).values()]
    .sort((a, b) => a.date - b.date || a.id.localeCompare(b.id));
  if (!unique.length) {
    if (!finite(baseline?.rating) || !finite(baseline?.date) || baseline.date > now) return { version: SKILL_VERSION, rating: null, entries: [], count: 0 };
    const uncertainty = Math.round(Math.sqrt(350 ** 2 + Math.max(0, (now - baseline.date) / 86400000) * 12 ** 2));
    return { version: SKILL_VERSION, rating: baseline.rating, uncertainty, conservative: baseline.rating - 2 * uncertainty, entries: [], count: 0, provisional: true, baselineOnly: true };
  }
  let mean = baseline?.rating ?? 1400;
  let variance = baseline ? 200 ** 2 : 600 ** 2;
  let previousDate = baseline?.date ?? unique[0].date;
  const entries = [];
  for (const observation of unique) {
    variance += Math.max(0, (observation.date - previousDate) / 86400000) * 12 ** 2;
    const noise = 350 / Math.sqrt(Math.max(0.01, observation.coverage ?? 1)) * (observation.boundary ? 1.5 : 1);
    const gain = variance / (variance + noise ** 2);
    const before = Math.round(mean);
    mean += gain * (observation.performance - mean);
    variance = Math.max(100 ** 2, variance * (1 - gain));
    entries.push({ ...observation, rankedDelta: Math.round(mean) - before, rankedRating: Math.round(mean) });
    previousDate = observation.date;
  }
  variance += Math.max(0, (now - previousDate) / 86400000) * 12 ** 2;
  const uncertainty = Math.round(Math.sqrt(variance));
  return { version: SKILL_VERSION, rating: Math.round(mean), uncertainty,
    conservative: Math.round(mean - 2 * uncertainty), count: entries.length, entries,
    lastEventAt: previousDate, provisional: entries.length < 5 };
}
