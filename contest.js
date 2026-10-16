import { codeforcesRequest } from './src/codeforces.js?v=3';
import { scheduleLocalSession, activateScheduledSession, finishLocalSession, buildLocalResults, fetchLocalSubmissions, createLocalSessionStore } from './src/local-session.js?v=12';
import { createBrowserStorage } from './src/storage.js';

const store = createLocalSessionStore(createBrowserStorage());
const id = new URLSearchParams(location.search).get('session');
let session = id ? store.load(id) : null;
let busy = false;
let lastPoll = 0;
let completing = false;
let activating = false;
const $ = (selector) => document.querySelector(selector);
const labels = { accepted: 'Accepted', provisional: 'Accepted; final tests unconfirmed', pending: 'Judging', unsolved: 'Not solved', unattempted: 'No submission' };
const duration = (seconds) => `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
const localInputValue = (timestamp) => new Date(timestamp - new Date(timestamp).getTimezoneOffset() * 60000).toISOString().slice(0, 16);
const locked = (action) => navigator.locks ? navigator.locks.request(`ranked-local-${id}`, action) : action();

function recommendedStartTime(now = Date.now()) {
  return Math.ceil((now + 10000) / 300000) * 300000;
}

function prepareStartTimeInput() {
  const input = $('#contest-start-time');
  const minimum = Math.ceil((Date.now() + 10000) / 60000) * 60000;
  input.min = localInputValue(minimum);
  if (!input.value) input.value = localInputValue(recommendedStartTime());
  updateTimezoneLabel();
}

function updateTimezoneLabel() {
  const input = $('#contest-start-time');
  const parsed = new Date(input.value);
  const selected = Number.isFinite(parsed.getTime()) ? parsed : new Date(recommendedStartTime());
  const offset = -selected.getTimezoneOffset();
  const sign = offset >= 0 ? '+' : '-';
  const hours = String(Math.floor(Math.abs(offset) / 60)).padStart(2, '0');
  const minutes = String(Math.abs(offset) % 60).padStart(2, '0');
  const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  $('#local-timezone').textContent = `${zone ? `${zone} · ` : ''}UTC${sign}${hours}:${minutes}`;
}

function formatCountdown(seconds) {
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const rest = seconds % 60;
  if (days) return `${days}d ${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(rest).padStart(2, '0')}`;
  if (hours) return `${hours}:${String(minutes).padStart(2, '0')}:${String(rest).padStart(2, '0')}`;
  return duration(seconds);
}

if (!session) {
  $('#contest-title').textContent = 'Session not found';
  fail('Open a recommended contest from the dashboard and choose its Prepare action.');
} else {
  $('#history-link').href = `/history.html?handle=${encodeURIComponent(session.handle)}`;
  document.title = `${session.contest.name} — Ranked`;
  render();
  if (session.status === 'scheduled') tick();
  else if (session.status !== 'ready') sync();
  setInterval(tick, 1000);
}

$('#start-contest').addEventListener('click', async () => {
  if (busy || !session) return;
  const startInput = $('#contest-start-time');
  startInput.setCustomValidity('');
  const scheduledAt = new Date(startInput.value).getTime();
  if (!startInput.checkValidity() || !startInput.value || !Number.isFinite(scheduledAt) || scheduledAt <= Date.now()) {
    startInput.setCustomValidity('Choose a future local start time.');
    startInput.reportValidity();
    return;
  }
  startInput.setCustomValidity('');
  setBusy(true);
  $('#start-status').textContent = 'Checking earlier submissions before scheduling…';
  try {
    const start = () => locked(async () => {
      reloadSession();
      if (session.status !== 'ready') return;
      const running = store.findOpen(session.handle);
      if (running && running.id !== id && Date.now() < running.endsAt) throw new Error('Another local contest is running. Resume it from the dashboard.');
      const baseline = await fetchLocalSubmissions(session, codeforcesRequest);
      session = store.save(scheduleLocalSession(session, baseline, scheduledAt));
    });
    await (navigator.locks ? navigator.locks.request(`ranked-local-start-${session.handle}`, start) : start());
    $('#contest-error').hidden = true;
    render();
    $('#start-status').textContent = '';
  } catch (error) { fail(`Could not schedule the contest. ${error.message}`); }
  finally { setBusy(false); }
  if (session?.status === 'scheduled') tick();
});

$('#end-contest').addEventListener('click', () => finish());
$('#sync-contest').addEventListener('click', () => sync());
document.addEventListener('visibilitychange', () => {
  if (!document.hidden && session?.status === 'scheduled') tick();
  else if (!document.hidden && session?.status !== 'ready') { tick(); sync(); }
});
$('#contest-start-time').addEventListener('input', () => {
  $('#contest-start-time').setCustomValidity('');
  updateTimezoneLabel();
});
window.addEventListener('storage', (event) => {
  if (event.key === null || event.key === `ranked-local-session-${id}`) {
    session = store.load(id);
    if (!session) return showMissingSession();
    render();
  }
});

function setBusy(value) {
  busy = value;
  $('#start-contest').disabled = value;
  $('#contest-start-time').disabled = value;
  $('#sync-contest').disabled = value;
}

function fail(message) {
  $('#contest-error').hidden = false;
  $('#contest-error').textContent = message;
}

function showMissingSession() {
  ['#contest-prestart', '#contest-scheduled', '#contest-workspace'].forEach((selector) => { $(selector).hidden = true; });
  $('#contest-title').textContent = 'Session not found';
  fail('The saved session is no longer available. Return to the dashboard.');
}

function reloadSession() {
  session = store.load(id);
  if (!session) {
    showMissingSession();
    throw new Error('The saved session is no longer available. Return to the dashboard.');
  }
  return session;
}

function render() {
  $('#contest-title').textContent = session.contest.name;
  $('#contest-meta').textContent = `@${session.handle} · ${session.problems.length} problems · ${Math.round(session.contest.durationSeconds / 60)} minutes${session.contest.kind === 'custom' ? ' · Custom practice' : ''}`;
  $('#contest-prestart').hidden = session.status !== 'ready';
  $('#contest-scheduled').hidden = session.status !== 'scheduled';
  $('#contest-workspace').hidden = session.status === 'ready' || session.status === 'scheduled';
  const familiar = session.problems.filter((problem) => problem.priorAttemptIds.length).length;
  $('#prestart-familiarity').textContent = familiar ? `Earlier attempts are recorded on ${familiar} problems. You can still use this round for practice.` : '';
  if (session.status === 'ready') {
    prepareStartTimeInput();
    return;
  }
  if (session.status === 'scheduled') {
    $('#scheduled-start-label').textContent = `Starts ${new Date(session.scheduledAt).toLocaleString()}`;
    tick();
    return;
  }
  $('#end-contest').hidden = session.status === 'ended';
  $('#contest-phase').textContent = session.status === 'ended' ? (session.endReason === 'time-expired' ? 'TIME IS UP' : 'SESSION ENDED EARLY') : 'CONTEST IN PROGRESS';
  $('#contest-window').textContent = `Started ${new Date(session.startedAt).toLocaleString()} · ${session.status === 'ended' ? 'Ended' : 'Ends'} ${new Date(session.endedAt ?? session.endsAt).toLocaleTimeString()}`;
  $('#contest-progress').textContent = session.results ? `${session.results.solved}/${session.problems.length} accepted · ${session.results.attempts} submissions · ${session.results.pending} awaiting final verdicts` : 'Results not synced yet';
  $('#last-sync').textContent = session.results ? `Last synced ${new Date(session.results.syncedAt).toLocaleTimeString()}` : '';
  $('#contest-results-note').textContent = session.results
    ? `${session.results.priorAttemptProblems} problems had earlier recorded attempts. Excluded: ${session.results.ignored.baseline + session.results.ignored.beforeStart} pre-start, ${session.results.ignored.afterEnd} after the session, ${session.results.ignored.nonPractice} non-practice, and ${session.results.ignored.invalid} invalid or unmatched submissions. No rating change.`
    : 'Only new practice submissions within this session’s time window will count.';
  const list = $('#contest-problems');
  list.replaceChildren();
  session.problems.forEach((problem) => {
    const row = document.createElement('li');
    const link = document.createElement('a');
    link.href = `https://codeforces.com/contest/${problem.contestId}/problem/${encodeURIComponent(problem.index)}`;
    link.target = '_blank'; link.rel = 'noreferrer';
    const label = problem.label || problem.index;
    link.textContent = `${label}. ${problem.name || `Problem ${label}`}`;
    const status = document.createElement('span');
    const result = session.results?.problems.find((entry) => entry.index === problem.index
      && (entry.contestId ?? session.contest.id) === problem.contestId);
    const source = session.contest.kind === 'custom' ? `CF ${problem.contestId}${problem.index} · ` : '';
    status.textContent = source + (result ? `${labels[result.state]} · ${result.attempts} submissions${result.solveSeconds == null ? '' : ` · ${duration(result.solveSeconds)}`}` : 'Not synced');
    row.append(link, status); list.append(row);
  });
  tick();
}

function tick() {
  if (!session || session.status === 'ready') return;
  if (session.status === 'scheduled') {
    const untilStart = Math.max(0, Math.ceil((session.scheduledAt - Date.now()) / 1000));
    $('#scheduled-clock').textContent = formatCountdown(untilStart);
    if (Date.now() >= session.scheduledAt && !activating) {
      activating = true;
      locked(async () => {
        const latest = reloadSession();
        if (latest.status === 'scheduled' && Date.now() >= latest.scheduledAt) session = store.save(activateScheduledSession(latest));
        else session = latest;
      }).then(() => {
        render();
        if (session.status !== 'scheduled' && session.status !== 'ready') sync();
      }).catch((error) => fail(error.message)).finally(() => { activating = false; });
    }
    return;
  }
  const remaining = Math.min(session.contest.durationSeconds, Math.max(0, Math.ceil((session.endsAt - Date.now()) / 1000)));
  $('#contest-clock').textContent = session.status === 'ended' ? 'ENDED' : duration(remaining);
  if (session.status === 'active' && Date.now() >= session.endsAt && !completing) finish();
  if (session.status === 'active' && !document.hidden && Date.now() - lastPoll >= 30000) sync();
}

async function finish() {
  if (!session || session.status !== 'active' || completing) return;
  completing = true;
  try {
    await locked(() => {
      reloadSession();
      session = finishLocalSession(session);
      // Recompute from the last observed records without falsely advancing the
      // sync timestamp. A failed final fetch must retain known results.
      if (session.results && session.observedSubmissions) {
        session.results = { ...buildLocalResults(session, session.observedSubmissions), syncedAt: session.results.syncedAt };
      }
      session = store.save(session);
    });
    render();
  } catch (error) { fail(error.message); }
  finally { completing = false; }
  sync();
}

async function sync() {
  if (!session || ['ready', 'scheduled'].includes(session.status) || busy) return;
  setBusy(true); lastPoll = Date.now();
  $('#tracking-status').textContent = 'Syncing Codeforces submissions…';
  try {
    const submissions = await fetchLocalSubmissions(session, codeforcesRequest, ({ count }) => {
      $('#tracking-status').textContent = `Checking ${count} ${session.contest.kind === 'custom' ? 'recent submissions for this set' : 'submissions for this round'}…`;
    });
    await locked(() => {
      reloadSession();
      if (session.status === 'active' && Date.now() >= session.endsAt) session = finishLocalSession(session);
      const baseline = new Set(session.baselineIds);
      session = store.save({ ...session, results: buildLocalResults(session, submissions),
        observedSubmissions: submissions.filter((submission) => !baseline.has(submission.id)
          && submission.creationTimeSeconds * 1000 < session.endsAt),
      });
    });
    $('#contest-error').hidden = true;
    $('#tracking-status').textContent = session.status === 'ended' ? 'Results synced. You can sync again to refresh pending verdicts.' : 'Tracking practice submissions. Updates run every 30 seconds while this page is visible.';
    render();
  } catch (error) {
    $('#tracking-status').textContent = `Could not refresh results. ${error.message} Retry with Sync submissions.`;
  } finally { lastPoll = Date.now(); setBusy(false); }
}
