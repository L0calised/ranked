const prefixFor = (handle) => `ranked-results-${handle.toLowerCase()}-`;
const keyFor = (handle, contestId) => `${prefixFor(handle)}${contestId}`;

function validSnapshot(snapshot, handle, contestId) {
  const count = (value) => Number.isSafeInteger(value) && value >= 0;
  return snapshot?.version === 1 && snapshot.complete === true
    && snapshot.handle === handle.toLowerCase() && snapshot.contestId === Number(contestId)
    && Number.isSafeInteger(snapshot.contestId) && snapshot.contestId > 0
    && Number.isFinite(snapshot.syncedAt) && typeof snapshot.contestName === 'string'
    && ['practice', 'official', 'other', 'identity', 'timing', 'malformed'].every((field) => count(snapshot.ignored?.[field]))
    && Array.isArray(snapshot.sessions)
    && snapshot.sessions.every((session) => typeof session?.id === 'string'
      && session.id === `cf-virtual:${handle.toLowerCase()}:${contestId}:${session.startedAt}`
      && Number.isSafeInteger(session.startedAt) && session.startedAt > 0
      && Number.isSafeInteger(session.endsAt) && session.endsAt > session.startedAt
      && ['in-progress', 'ended'].includes(session.status) && ['reported', 'inferred', 'mixed'].includes(session.startEvidence)
      && ['solved', 'attempts', 'pending', 'provisionalAccepted', 'priorAttemptProblems', 'outsideWindowCount', 'unknownProblemCount'].every((field) => count(session[field]))
      && Array.isArray(session.problems) && session.problems.every((problem) => typeof problem?.index === 'string'
        && ['accepted', 'provisional', 'pending', 'unsolved', 'unattempted'].includes(problem.state)
        && count(problem.attempts) && (problem.solveSeconds == null || (Number.isFinite(problem.solveSeconds) && problem.solveSeconds >= 0))));
}

export function createSessionLibrary(storage) {
  function loadRound(handle, contestId) {
    try {
      const snapshot = JSON.parse(storage.getItem(keyFor(handle, contestId)));
      return validSnapshot(snapshot, handle, contestId) ? snapshot : null;
    } catch { return null; }
  }
  function listRounds(handle) {
    const rounds = [];
    const prefix = prefixFor(handle);
    for (let index = 0; index < storage.length; index += 1) {
      const key = storage.key(index);
      if (!key?.startsWith(prefix) || !/^\d+$/.test(key.slice(prefix.length))) continue;
      const snapshot = loadRound(handle, Number(key.slice(prefix.length)));
      if (snapshot) rounds.push(snapshot);
    }
    return rounds.sort((a, b) => b.syncedAt - a.syncedAt);
  }
  return {
    loadRound, listRounds,
    saveRound(snapshot) {
      if (!validSnapshot(snapshot, snapshot?.handle || '', snapshot?.contestId)) {
        throw new Error('Only a complete, correctly identified results snapshot can be saved.');
      }
      const previous = loadRound(snapshot.handle, snapshot.contestId);
      // An older refresh from another tab must not replace a newer snapshot.
      if (previous && previous.syncedAt > snapshot.syncedAt) return previous;
      storage.setItem(keyFor(snapshot.handle, snapshot.contestId), JSON.stringify(snapshot));
      return snapshot;
    },
    listSessions(handle) {
      const sessions = new Map();
      for (const snapshot of listRounds(handle)) {
        for (const session of snapshot.sessions) {
          if (!sessions.has(session.id)) sessions.set(session.id, {
            session, contestId: snapshot.contestId, contestName: snapshot.contestName, syncedAt: snapshot.syncedAt,
          });
        }
      }
      return [...sessions.values()].sort((a, b) => b.session.startedAt - a.session.startedAt);
    },
  };
}

// Discovery only identifies rounds containing virtual submissions. Importing
// fresh round data and timing evidence is still required to reconstruct sessions.
export function discoverVirtualRounds(handle, submissions) {
  const owner = handle.toLowerCase();
  const rounds = new Map();
  const seen = new Set();
  for (const submission of submissions) {
    const party = submission.author;
    if (!Number.isSafeInteger(submission.id) || submission.id <= 0 || seen.has(submission.id)
      || !Number.isSafeInteger(submission.contestId) || submission.contestId <= 0
      || party?.participantType !== 'VIRTUAL' || party.ghost || party.members?.length !== 1
      || party.members[0]?.handle?.toLowerCase() !== owner) continue;
    seen.add(submission.id);
    const round = rounds.get(submission.contestId) || { contestId: submission.contestId, submissionCount: 0, lastSubmissionAt: 0 };
    round.submissionCount += 1;
    round.lastSubmissionAt = Math.max(round.lastSubmissionAt, submission.creationTimeSeconds || 0);
    rounds.set(round.contestId, round);
  }
  return [...rounds.values()].sort((a, b) => b.lastSubmissionAt - a.lastSubmissionAt);
}
