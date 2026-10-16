const labels = { accepted: 'Accepted', provisional: 'Accepted, final tests unconfirmed', pending: 'Judging', unsolved: 'Not solved', unattempted: 'No submission' };
const time = (seconds) => `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
const date = (seconds) => new Date(seconds * 1000).toLocaleString();

export function renderVirtualResults(container, snapshot, { sessionId = null } = {}) {
  container.replaceChildren();
  container.hidden = !snapshot;
  if (!snapshot) return;
  const title = document.createElement('h3');
  title.textContent = `Virtual results · ${snapshot.contestName}`;
  const note = document.createElement('p');
  note.className = 'result-caveat';
  note.textContent = `Last synced ${new Date(snapshot.syncedAt).toLocaleString()}. Submission summary. Approximate performance and VC estimate changes appear in History when available.`;
  container.append(title, note);
  if (!snapshot.sessions.length) {
    const empty = document.createElement('p');
    empty.textContent = snapshot.fetchedCount === 0
      ? 'Codeforces returned no public submissions for this round. Starting or ending the local timer alone does not create a Codeforces virtual result. Start virtual participation and submit on Codeforces to import that session.'
      : 'No identifiable virtual session was found in the public submissions for this round. A session with no submissions may not be detectable.';
    container.append(empty);
  }
  const sessions = snapshot.sessions.filter((session) => !sessionId || session.id === sessionId);
  if (sessionId && !sessions.length && snapshot.sessions.length) {
    const missing = document.createElement('p');
    missing.textContent = 'This session is no longer identifiable in the latest snapshot. Choose another session from History.';
    container.append(missing);
  }
  sessions.forEach((session, index) => {
    const details = document.createElement('details');
    details.open = index === 0;
    const summary = document.createElement('summary');
    summary.textContent = `${date(session.startedAt)} · ${session.solved}/${session.problems.length} accepted · ${session.attempts} submissions · ${session.status === 'in-progress' ? 'In progress at last sync' : 'Time ended'}`;
    const evidence = document.createElement('p');
    evidence.className = 'result-caveat';
    evidence.textContent = `${session.startEvidence === 'reported' ? 'Start reported by Codeforces.' : 'Start reconstructed wholly or partly from virtual submission times.'} ${session.pending} judging; ${session.provisionalAccepted} accepted submissions without confirmed final tests. ${session.priorAttemptProblems} problems with earlier recorded attempts; earlier practice does not block the VC estimate.`;
    const table = document.createElement('table');
    const caption = document.createElement('caption');
    caption.textContent = 'Submissions within the original contest duration';
    const head = document.createElement('thead');
    const headings = document.createElement('tr');
    ['Problem', 'Result', 'Submissions', 'First accepted'].forEach((label) => {
      const cell = document.createElement('th');
      cell.scope = 'col';
      cell.textContent = label;
      headings.append(cell);
    });
    head.append(headings);
    const body = document.createElement('tbody');
    session.problems.forEach((problem) => {
      const row = document.createElement('tr');
      [problem.index, labels[problem.state], String(problem.attempts), problem.solveSeconds == null ? '—' : time(problem.solveSeconds)].forEach((value) => {
        const cell = document.createElement('td');
        cell.textContent = value;
        row.append(cell);
      });
      body.append(row);
    });
    table.append(caption, head, body);
    details.append(summary, evidence, table);
    if (session.outsideWindowCount || session.unknownProblemCount) {
      const warning = document.createElement('p');
      warning.textContent = `${session.outsideWindowCount} submissions outside the time window excluded; ${session.unknownProblemCount} observed problems missing from the saved lineup. These results need review.`;
      details.append(warning);
    }
    container.append(details);
  });
  const excluded = document.createElement('p');
  excluded.className = 'result-caveat';
  const { practice, official, other, identity, timing, malformed } = snapshot.ignored;
  excluded.textContent = `Kept separate: ${practice} practice, ${official} official, ${other} other submissions. Could not classify: ${identity} identity/team, ${timing} timing, ${malformed} invalid records.`;
  container.append(excluded);
}
