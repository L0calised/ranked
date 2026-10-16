import { syncSubmissionHistory } from './history.js?v=3';
import { problemFamily } from './recommendations.js?v=7';

const prefix = 'ranked-local-session-';
const key = (problem) => `${problem.contestId}/${problem.index}`;
const sameProblem = (a, b) => key(a) === key(b) || (problemFamily(a) && problemFamily(a) === problemFamily(b));
const isOwner = (submission, handle) => !submission.author?.ghost && submission.author?.members?.length === 1
  && submission.author.members[0]?.handle?.toLowerCase() === handle.toLowerCase();

export function prepareLocalSession({ id, handle, contest, problems, historySubmissions = [], now = Date.now() }) {
  const custom = contest.kind === 'custom';
  if (!id || !handle || (custom ? typeof contest.id !== 'string' || !contest.id.startsWith('custom:') : !Number.isSafeInteger(contest.id))
    || !Number.isSafeInteger(contest.durationSeconds) || contest.durationSeconds <= 0 || !problems.length
    || (custom && problems.length > 26) || problems.some((problem) => !Number.isSafeInteger(problem.contestId) || problem.contestId <= 0
      || (!custom && problem.contestId !== contest.id) || !problem.index)) {
    throw new Error('A handle, valid source problems, and a fixed contest duration are required.');
  }
  const ordered = [...problems];
  if (!custom) ordered.sort((a, b) => a.index.localeCompare(b.index, 'en', { numeric: true }));
  return {
    version: 1, id, handle: handle.toLowerCase(), format: 'local-practice', clockSource: 'browser',
    contest: { id: contest.id, kind: custom ? 'custom' : 'round', name: contest.name, durationSeconds: contest.durationSeconds,
      ...(custom ? { generatorVersion: contest.generatorVersion, targetRating: contest.targetRating, targetDifficulties: contest.targetDifficulties,
        usesOlderProblems: contest.usesOlderProblems === true } : {}) },
    createdAt: now, status: 'ready', startedAt: null, endsAt: null, endedAt: null,
    baselineIds: [], results: null,
    problems: [...new Map(ordered.map((problem, position) => [key(problem), {
      contestId: problem.contestId, index: problem.index, name: problem.name,
      label: custom ? String.fromCharCode(65 + position) : problem.index,
      ...(Number.isFinite(problem.rating) ? { rating: problem.rating } : {}),
      priorAttemptIds: historySubmissions.filter((submission) => isOwner(submission, handle)
        && submission.problem && sameProblem(problem, submission.problem)).map((submission) => submission.id),
    }])).values()],
  };
}

export function beginLocalSession(session, baselineSubmissions, now = Date.now()) {
  if (session.status !== 'ready') throw new Error('This session has already been started.');
  // CF submission timestamps have second precision. Start at the next whole
  // second so submissions from the partial pre-start second cannot be credited.
  const startedAt = Math.ceil(now / 1000) * 1000;
  const withBaseline = applyBaseline(session, baselineSubmissions);
  return { ...withBaseline, status: 'active', startedAt, endsAt: startedAt + session.contest.durationSeconds * 1000 };
}

export function scheduleLocalSession(session, baselineSubmissions, scheduledAt, now = Date.now()) {
  if (session.status !== 'ready') throw new Error('This session has already been scheduled or started.');
  if (!Number.isSafeInteger(scheduledAt) || scheduledAt <= now) throw new Error('Choose a start time in the future.');
  const withBaseline = applyBaseline(session, baselineSubmissions);
  return { ...withBaseline, status: 'scheduled', scheduledAt, startedAt: null,
    endsAt: scheduledAt + session.contest.durationSeconds * 1000 };
}

export function activateScheduledSession(session, now = Date.now()) {
  if (session.status !== 'scheduled') throw new Error('This contest has not been scheduled.');
  if (now < session.scheduledAt) throw new Error('The scheduled start time has not arrived.');
  const active = { ...session, status: 'active', startedAt: session.scheduledAt };
  return now >= session.endsAt ? finishLocalSession(active, now) : active;
}

function applyBaseline(session, baselineSubmissions) {
  return { ...session,
    baselineIds: baselineSubmissions.map((submission) => submission.id),
    problems: session.problems.map((problem) => ({ ...problem,
      priorAttemptIds: [...new Set([...problem.priorAttemptIds, ...baselineSubmissions
        .filter((submission) => isOwner(submission, session.handle) && submission.problem && sameProblem(problem, submission.problem))
        .map((submission) => submission.id)])],
    })),
  };
}

export function finishLocalSession(session, now = Date.now()) {
  if (session.status === 'ended') return session;
  if (session.status !== 'active') throw new Error('Start the session before ending it.');
  // An early end excludes the partial final second rather than crediting an
  // ambiguous submission created after the click in that same second.
  const endedAt = Math.max(session.startedAt, Math.min(session.endsAt, Math.floor(now / 1000) * 1000));
  return { ...session, status: 'ended', endedAt, endReason: now >= session.endsAt ? 'time-expired' : 'ended-early' };
}

export function buildLocalResults(session, submissions, now = Date.now()) {
  if (session.status === 'ready' || session.status === 'scheduled') throw new Error('A contest that has not started has no timed results.');
  const stop = session.endedAt ?? session.endsAt;
  const baseline = new Set(session.baselineIds);
  const lineup = new Set(session.problems.map(key));
  const ignored = { beforeStart: 0, afterEnd: 0, baseline: 0, nonPractice: 0, invalid: 0 };
  const counted = [];
  for (const submission of new Map(submissions.map((record) => [record.id, record])).values()) {
    if (!Number.isSafeInteger(submission.id) || submission.id <= 0 || !submission.problem || !lineup.has(key(submission.problem))
      || submission.contestId !== submission.problem.contestId || !isOwner(submission, session.handle)
      || (submission.author.contestId != null && submission.author.contestId !== submission.problem.contestId)
      || !Number.isSafeInteger(submission.creationTimeSeconds) || submission.creationTimeSeconds * 1000 > now + 5000) {
      ignored.invalid += 1; continue;
    }
    if (baseline.has(submission.id)) { ignored.baseline += 1; continue; }
    if (submission.author.participantType !== 'PRACTICE') { ignored.nonPractice += 1; continue; }
    const created = submission.creationTimeSeconds * 1000;
    if (created < session.startedAt) { ignored.beforeStart += 1; continue; }
    if (created >= stop) { ignored.afterEnd += 1; continue; }
    counted.push(submission);
  }
  const problems = session.problems.map((problem) => {
    // Scheduling leaves a waiting period after the baseline fetch. Attempts
    // during that period are exposure even though they are outside the timer.
    const priorAttempts = new Set([...problem.priorAttemptIds, ...submissions
      .filter((submission) => Number.isSafeInteger(submission?.id) && submission.id > 0
        && Number.isSafeInteger(submission.creationTimeSeconds)
        && submission.creationTimeSeconds * 1000 < session.startedAt
        && isOwner(submission, session.handle) && submission.problem && sameProblem(problem, submission.problem))
      .map((submission) => submission.id)]).size;
    const attempts = counted.filter((submission) => key(submission.problem) === key(problem))
      .sort((a, b) => a.creationTimeSeconds - b.creationTimeSeconds || a.id - b.id);
    const accepted = attempts.find((submission) => submission.verdict === 'OK' && submission.testset === 'TESTS');
    const pending = attempts.filter((submission) => !submission.verdict || ['SUBMITTED', 'TESTING'].includes(submission.verdict)).length;
    const provisional = attempts.filter((submission) => submission.verdict === 'OK' && submission.testset !== 'TESTS').length;
    return { contestId: problem.contestId, index: problem.index, label: problem.label || problem.index,
      attempts: attempts.length, submissionIds: attempts.map((submission) => submission.id),
      state: accepted ? 'accepted' : provisional ? 'provisional' : pending ? 'pending' : attempts.length ? 'unsolved' : 'unattempted',
      solveSeconds: accepted ? (accepted.creationTimeSeconds * 1000 - session.startedAt) / 1000 : null,
      pending, provisional, priorAttempts };
  });
  return { syncedAt: now, complete: true, solved: problems.filter((problem) => problem.state === 'accepted').length,
    attempts: counted.length, pending: problems.reduce((sum, problem) => sum + problem.pending + problem.provisional, 0),
    priorAttemptProblems: problems.filter((problem) => problem.priorAttempts > 0).length, problems, ignored };
}

export async function fetchLocalSubmissions(session, request, onProgress) {
  const custom = session.contest.kind === 'custom';
  const history = await syncSubmissionHistory({ handle: session.handle, onProgress,
    // The prepared draft already contains earlier familiarity from the full
    // history. Fresh scans cover its waiting period and the whole session, so
    // rejudges inside that window are refreshed without scanning an account's
    // entire lifetime on every poll. These scoped snapshots are never cached.
    sinceSeconds: custom ? Math.floor(session.createdAt / 1000) : null,
    request: custom ? request : (_method, params) => request('contest.status', { ...params, contestId: String(session.contest.id) }),
  });
  const sources = new Set(session.problems.map((problem) => problem.contestId));
  return history.submissions.filter((submission) => sources.has(submission.contestId)
    || (custom && submission.problem && session.problems.some((problem) => sameProblem(problem, submission.problem))));
}

export function createLocalSessionStore(storage) {
  function load(id) {
    try {
      const session = JSON.parse(storage.getItem(prefix + id));
      return validSession(session, id) ? session : null;
    } catch { return null; }
  }
  function list(handle) {
    const sessions = [];
    for (let index = 0; index < storage.length; index += 1) {
      const name = storage.key(index);
      if (!name?.startsWith(prefix)) continue;
      const session = load(name.slice(prefix.length));
      if (session?.handle === handle.toLowerCase()) sessions.push(session);
    }
    return sessions.sort((a, b) => b.createdAt - a.createdAt);
  }
  return { load, list,
    findOpen: (handle, now = Date.now()) => list(handle).find((session) => ['scheduled', 'active'].includes(session.status) && session.endsAt > now) || null,
    save(session) {
      if (!validSession(session, session?.id)) throw new Error('The local session record is invalid and could not be saved.');
      const previous = load(session.id);
      if (previous && (previous.handle !== session.handle || previous.contest.id !== session.contest.id
        || (previous.status !== 'ready' && previous.problems.map(key).join(',') !== session.problems.map(key).join(','))
        || (previous.startedAt !== null && (previous.startedAt !== session.startedAt || previous.endsAt !== session.endsAt))
        || (previous.status === 'scheduled' && (session.status === 'ready' || session.scheduledAt !== previous.scheduledAt || session.endsAt !== previous.endsAt))
        || (previous.status === 'ended' && (session.status !== 'ended' || session.endedAt !== previous.endedAt)))) {
        throw new Error('A started session cannot be reset or reassigned. Reload to continue.');
      }
      storage.setItem(prefix + session.id, JSON.stringify(session));
      return session;
    },
  };
}

function validSession(session, id) {
  const custom = session?.contest?.kind === 'custom';
  const ids = (values) => Array.isArray(values) && values.every((value) => Number.isSafeInteger(value) && value > 0);
  const count = (value) => Number.isSafeInteger(value) && value >= 0;
  if (session?.version !== 1 || typeof id !== 'string' || !id || session.id !== id || session.format !== 'local-practice'
    || typeof session.handle !== 'string' || !/^[a-z0-9_-]{1,24}$/.test(session.handle)
    || !Number.isFinite(session.createdAt) || !ids(session.baselineIds)
    || (custom ? typeof session.contest.id !== 'string' || !session.contest.id.startsWith('custom:')
      : !Number.isSafeInteger(session.contest?.id) || session.contest.id <= 0)
    || typeof session.contest.name !== 'string'
    || !Number.isSafeInteger(session.contest.durationSeconds) || session.contest.durationSeconds <= 0
    || !Array.isArray(session.problems) || !session.problems.length
    || session.problems.some((problem) => typeof problem?.index !== 'string' || !problem.index
      || !Number.isSafeInteger(problem.contestId) || problem.contestId <= 0
      || (!custom && problem.contestId !== session.contest.id) || !ids(problem.priorAttemptIds))
    || new Set(session.problems.map(key)).size !== session.problems.length
    || (custom && session.contest.id !== `custom:${session.problems.map(key).join(',')}`)
    || (custom && (session.problems.length > 26 || session.problems.some((problem, index) => problem.label !== String.fromCharCode(65 + index))))
    || !['ready', 'scheduled', 'active', 'ended'].includes(session.status)) return false;
  if (session.status === 'ready' && (session.startedAt !== null || session.endsAt !== null || session.endedAt !== null)) return false;
  if (session.status === 'scheduled' && (!Number.isSafeInteger(session.scheduledAt) || !Number.isFinite(session.endsAt)
    || session.startedAt !== null || session.endedAt !== null || session.endsAt - session.scheduledAt !== session.contest.durationSeconds * 1000)) return false;
  if (['active', 'ended'].includes(session.status) && (!Number.isFinite(session.startedAt) || !Number.isFinite(session.endsAt)
    || session.endsAt - session.startedAt !== session.contest.durationSeconds * 1000
    || (session.scheduledAt != null && session.startedAt !== session.scheduledAt))) return false;
  if (session.status === 'active' && session.endedAt !== null) return false;
  if (session.status === 'ended' && (!Number.isFinite(session.endedAt) || session.endedAt < session.startedAt || session.endedAt > session.endsAt)) return false;
  const results = session.results;
  if (results != null && (!Number.isFinite(results.syncedAt)
    || !['solved', 'attempts', 'pending', 'priorAttemptProblems'].every((field) => count(results[field]))
    || !['beforeStart', 'afterEnd', 'baseline', 'nonPractice', 'invalid'].every((field) => count(results.ignored?.[field]))
    || !Array.isArray(results.problems) || results.problems.length !== session.problems.length
    || new Set(results.problems.map((problem) => `${problem?.contestId ?? session.contest.id}/${problem?.index}`)).size !== session.problems.length
    || results.problems.some((problem) => !session.problems.some((entry) => entry.index === problem?.index
      && entry.contestId === (problem.contestId ?? session.contest.id))
      || !['accepted', 'provisional', 'pending', 'unsolved', 'unattempted'].includes(problem.state)
      || !count(problem.attempts) || (problem.solveSeconds != null && (!Number.isFinite(problem.solveSeconds) || problem.solveSeconds < 0))))) return false;
  return session.observedSubmissions == null || (Array.isArray(session.observedSubmissions) && session.observedSubmissions.every((entry) => entry && typeof entry === 'object'));
}
