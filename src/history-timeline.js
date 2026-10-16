export const historyTypes = { official: 'Official rated', virtual: 'CF virtual', local: 'Local round', custom: 'Custom set' };

// Dates are milliseconds here. Codeforces virtual/rating timestamps arrive in seconds.
// A discovered round is evidence of submissions, not an identified session.
export function buildHistoryTimeline({ official = [], rounds = [], localSessions = [], discovered = [], now = Date.now() } = {}) {
  const rows = new Map();
  const put = (row) => rows.set(row.id, { rank: null, delta: null, newRating: null, ...row });
  for (const change of official) put({
    id: `official:${change.contestId}`, kind: 'official', contestId: change.contestId, name: change.contestName,
    date: change.ratingUpdateTimeSeconds * 1000, dateLabel: 'Rating updated', status: 'Rated', result: 'Official result',
    rank: change.rank, delta: change.newRating - change.oldRating, newRating: change.newRating,
  });
  const imported = new Set();
  for (const round of rounds) {
    if (round.sessions.length) imported.add(round.contestId);
    for (const session of round.sessions) put({
      id: session.id, kind: 'virtual', contestId: round.contestId, name: round.contestName,
      date: session.startedAt * 1000, dateLabel: 'Virtual start', status: session.status === 'in-progress' ? 'In progress at last sync' : 'Window ended',
      result: `${session.solved}/${session.problems.length} accepted`, sessionId: session.id,
      syncedAt: round.syncedAt, needsReview: Boolean(session.pending || session.provisionalAccepted || session.priorAttemptProblems || session.outsideWindowCount || session.unknownProblemCount),
    });
  }
  for (const session of localSessions) {
    const status = session.status === 'ready' ? 'Prepared'
      : session.status === 'ended' ? session.endReason === 'ended-early' ? 'Ended early' : 'Window ended'
      : now >= session.endsAt ? 'Window ended'
      : session.status === 'scheduled' && now < session.scheduledAt ? 'Scheduled' : 'In progress';
    put({ id: `local:${session.id}`, sessionId: session.id, kind: session.contest.kind === 'custom' ? 'custom' : 'local',
      contestId: session.contest.id, name: session.contest.name,
      date: session.startedAt ?? session.scheduledAt ?? session.createdAt,
      dateLabel: session.startedAt != null ? 'Session start' : session.scheduledAt != null ? 'Scheduled start' : 'Prepared',
      status, result: session.results ? `${session.results.solved}/${session.problems.length} accepted` : 'Not synced',
      syncedAt: session.results?.syncedAt,
      needsReview: Boolean(session.results && (session.results.pending || session.results.priorAttemptProblems || session.results.problems?.some((problem) => problem.state === 'provisional'))),
    });
  }
  for (const round of discovered) {
    if (imported.has(round.contestId)) continue;
    const saved = rounds.find((entry) => entry.contestId === round.contestId);
    put({ id: `discovered:${round.contestId}`, kind: 'virtual', contestId: round.contestId,
      name: saved?.contestName || `Codeforces contest ${round.contestId}`,
      date: round.lastSubmissionAt * 1000, dateLabel: 'Latest virtual submission',
      status: saved ? 'No identifiable session' : 'Import needed', result: `${round.submissionCount} virtual submissions`, discovery: true,
    });
  }
  return [...rows.values()].sort((a, b) => b.date - a.date || a.id.localeCompare(b.id));
}

export function filterHistory(rows, { kind = 'all', search = '' } = {}) {
  const query = search.trim().toLowerCase();
  return rows.filter((row) => (kind === 'all' || row.kind === kind)
    && `${row.name} ${row.contestId} ${historyTypes[row.kind]} ${row.status}`.toLowerCase().includes(query));
}
