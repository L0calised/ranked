import { syncSubmissionHistory } from './history.js';
import { problemFamily } from './recommendations.js?v=7';

const pendingVerdicts = new Set(['TESTING', 'SUBMITTED']);
const validTime = (value) => Number.isSafeInteger(value) && value >= 0;
const normalizedName = (problem) => problem?.name?.trim().toLowerCase();

// Build evidence from fresh submissions, without inferring leaderboard scores.
export function buildVirtualSessions({ handle, contest, problems, submissions, historySubmissions = [], nowSeconds = Math.floor(Date.now() / 1000) }) {
  if (!Number.isSafeInteger(contest.id) || !Number.isSafeInteger(contest.durationSeconds) || contest.durationSeconds <= 0) {
    throw new Error('A contest ID and original duration are required to import results.');
  }
  const owner = handle.toLowerCase();
  const groups = new Map();
  const ignored = { practice: 0, official: 0, other: 0, identity: 0, timing: 0, malformed: 0 };
  const records = [...new Map(submissions.map((submission) => [submission.id, submission])).values()];
  const known = new Map([...historySubmissions, ...records].map((submission) => [submission.id, submission]));

  for (const submission of records) {
    if (!Number.isSafeInteger(submission.id) || submission.id <= 0 || submission.contestId !== contest.id
      || submission.problem?.contestId !== contest.id || !submission.problem?.index) {
      ignored.malformed += 1;
      continue;
    }
    const party = submission.author;
    if (party?.members?.length !== 1 || party.members[0]?.handle?.toLowerCase() !== owner || party.ghost
      || (party.contestId != null && party.contestId !== contest.id)) {
      ignored.identity += 1;
      continue;
    }
    if (party.participantType !== 'VIRTUAL') {
      const category = party.participantType === 'PRACTICE' ? 'practice' : party.participantType === 'CONTESTANT' ? 'official' : 'other';
      ignored[category] += 1;
      continue;
    }
    const created = submission.creationTimeSeconds;
    const relative = submission.relativeTimeSeconds;
    const hasReported = validTime(party.startTimeSeconds) && party.startTimeSeconds > 0;
    const start = hasReported ? party.startTimeSeconds : validTime(created) && validTime(relative) ? created - relative : null;
    if (!validTime(created) || !validTime(start) || start <= 0 || created < start || created > nowSeconds + 5
      || (party.startTimeSeconds != null && !hasReported)
      || (relative != null && !validTime(relative))
      || (hasReported && validTime(relative) && Math.abs(created - start - relative) > 1)) {
      ignored.timing += 1;
      continue;
    }
    const id = `cf-virtual:${owner}:${contest.id}:${start}`;
    if (!groups.has(id)) groups.set(id, { id, startedAt: start, reported: false, inferred: false, records: [] });
    const group = groups.get(id);
    group.reported ||= hasReported;
    group.inferred ||= !hasReported;
    group.records.push(submission);
  }

  const sessions = [...groups.values()].map((group) => {
    const endsAt = group.startedAt + contest.durationSeconds;
    const inWindow = group.records.filter((submission) => submission.creationTimeSeconds < endsAt);
    const outsideWindowCount = group.records.length - inWindow.length;
    const lineup = new Map(problems.filter((problem) => problem.contestId === contest.id).map((problem) => [problem.index, problem]));
    let unknownProblemCount = 0;
    for (const submission of inWindow) {
      if (!lineup.has(submission.problem.index)) {
        lineup.set(submission.problem.index, submission.problem);
        unknownProblemCount += 1;
      }
    }
    const results = [...lineup.values()].sort((a, b) => a.index.localeCompare(b.index, 'en', { numeric: true })).map((problem) => {
      const attempts = inWindow.filter((submission) => submission.problem.index === problem.index)
        .sort((a, b) => a.creationTimeSeconds - b.creationTimeSeconds || a.id - b.id);
      const accepted = attempts.find((submission) => submission.verdict === 'OK' && submission.testset === 'TESTS');
      const provisionalAccepted = attempts.filter((submission) => submission.verdict === 'OK' && submission.testset !== 'TESTS').length;
      const pending = attempts.filter((submission) => !submission.verdict || pendingVerdicts.has(submission.verdict)).length;
      const priorAttempts = [...known.values()].filter((submission) => validTime(submission.creationTimeSeconds)
        && submission.creationTimeSeconds < group.startedAt
        && submission.author?.members?.some((member) => member.handle?.toLowerCase() === owner)
        && ((submission.problem?.contestId === contest.id && submission.problem?.index === problem.index)
          || (normalizedName(problem) && normalizedName(problem) === normalizedName(submission.problem)))).length;
      // Separate submission count from score penalties. Compilation errors and
      // first-test failures do not carry standard CF penalties. Ambiguous legacy
      // metadata is excluded from rating instead of guessed.
      const beforeAccepted = accepted ? attempts.filter((submission) => submission.id !== accepted.id
        && (submission.creationTimeSeconds < accepted.creationTimeSeconds || (submission.creationTimeSeconds === accepted.creationTimeSeconds && submission.id < accepted.id))) : [];
      const failed = beforeAccepted.filter((s) => !['COMPILATION_ERROR', 'SKIPPED', 'REJECTED'].includes(s.verdict));
      const penaltyAttempts = failed.filter((s) => s.verdict === 'OK' || (Number.isSafeInteger(s.passedTestCount) && s.passedTestCount > 0)).length;
      const scoringAmbiguous = failed.some((s) => s.verdict !== 'OK' && !Number.isSafeInteger(s.passedTestCount))
        || (accepted && attempts.some((s) => s.id > accepted.id && !['COMPILATION_ERROR', 'SKIPPED', 'REJECTED'].includes(s.verdict)));
      return {
        penaltyAttempts, icpcPenaltyAttempts: failed.length, scoringAmbiguous: Boolean(scoringAmbiguous),
        index: problem.index, attempts: attempts.length,
        submissionIds: attempts.map((submission) => submission.id),
        state: accepted ? 'accepted' : provisionalAccepted ? 'provisional' : pending ? 'pending' : attempts.length ? 'unsolved' : 'unattempted',
        solveSeconds: accepted ? accepted.creationTimeSeconds - group.startedAt : null,
        pending, provisionalAccepted, priorAttempts,
      };
    });
    return {
      repeatedExposure: [...known.values()].some((submission) => submission.creationTimeSeconds < group.startedAt
        && submission.author?.members?.some((member) => member.handle?.toLowerCase() === owner)
        && [...lineup.values()].some((problem) => problemFamily(problem) && problemFamily(problem) === problemFamily(submission.problem))),
      id: group.id, startedAt: group.startedAt, endsAt,
      status: nowSeconds < endsAt ? 'in-progress' : 'ended',
      startEvidence: group.reported && group.inferred ? 'mixed' : group.reported ? 'reported' : 'inferred',
      solved: results.filter((problem) => problem.state === 'accepted').length,
      attempts: inWindow.length,
      pending: results.reduce((sum, problem) => sum + problem.pending, 0),
      provisionalAccepted: results.reduce((sum, problem) => sum + problem.provisionalAccepted, 0),
      priorAttemptProblems: results.filter((problem) => problem.priorAttempts > 0).length,
      outsideWindowCount, unknownProblemCount, problems: results,
    };
  }).sort((a, b) => b.startedAt - a.startedAt);
  return { sessions, ignored };
}

export async function syncRoundResults({ handle, contest, problems, request, historySubmissions = [], historyComplete = false, onProgress, now = Date.now }) {
  // Re-fetch every page of this round even when the overall history is cached:
  // older verdicts may have changed following judging or a rejudge.
  const history = await syncSubmissionHistory({
    handle,
    request: (_method, params) => request('contest.status', { ...params, contestId: String(contest.id) }),
    onProgress, now,
  });
  const syncedAt = now();
  const report = buildVirtualSessions({ handle, contest, problems, submissions: history.submissions,
    historySubmissions, nowSeconds: Math.floor(syncedAt / 1000) });
  return {
    submissions: history.submissions,
    snapshot: { version: 1, handle: handle.toLowerCase(), contestId: contest.id, contestName: contest.name,
      syncedAt, complete: true, historyComplete, fetchedCount: history.submissions.length, ...report },
  };
}
