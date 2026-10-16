// Shared by the browser cache and the Vercel proxy. Keep full standings off the wire.
export function compactStandings(data) {
  if (!data?.contest || !Array.isArray(data.rows) || !Array.isArray(data.problems)) throw new Error('Invalid standings response.');
  const rows = data.rows.filter((row) => row.party?.participantType === 'CONTESTANT'
    && !row.party.ghost && row.party.members?.length === 1);
  const sampleRows = rows.filter((row, index) => index % Math.max(1, Math.floor(rows.length / 200)) === 0).slice(0, 250);
  return {
    contest: { id: data.contest.id, name: data.contest.name, type: data.contest.type, phase: data.contest.phase,
      durationSeconds: data.contest.durationSeconds, startTimeSeconds: data.contest.startTimeSeconds, frozen: data.contest.frozen === true },
    problems: data.problems.map(({ index, name, points }) => ({ index, name, points })),
    rows: rows.map((row) => ({ handle: row.party.members[0].handle, rank: row.rank, points: row.points,
      penalty: row.penalty, successfulHackCount: row.successfulHackCount || 0, unsuccessfulHackCount: row.unsuccessfulHackCount || 0 })),
    samples: sampleRows.map((row) => ({ points: row.points, penalty: row.penalty,
      successfulHackCount: row.successfulHackCount || 0, unsuccessfulHackCount: row.unsuccessfulHackCount || 0,
      problemResults: row.problemResults.map(({ points, penalty, rejectedAttemptCount, type, bestSubmissionTimeSeconds }) => ({ points, penalty, rejectedAttemptCount, type, bestSubmissionTimeSeconds })) })),
  };
}
