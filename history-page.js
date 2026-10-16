import { codeforcesRequest } from './src/codeforces.js?v=3';
import { syncSubmissionHistory } from './src/history.js?v=3';
import { createHistoryStore } from './src/history-store.js?v=2';
import { createBrowserStorage } from './src/storage.js';
import { createRatingHistoryStore, normalizeRatingHistory } from './src/rating-history.js';
import { buildHistoryTimeline, filterHistory, historyTypes } from './src/history-timeline.js?v=2';
import { createSessionLibrary, discoverVirtualRounds } from './src/session-library.js?v=2';
import { createLocalSessionStore } from './src/local-session.js?v=12';
import { syncRoundResults } from './src/virtual-results.js?v=2';
import { SKILL_WINDOW_MS, calculateSkill } from './src/skill-rating.js?v=7';
import { computeSkill, loadSkill, skillSignature, loadBenchmark, officialBaseline } from './src/skill-service.js?v=8';
import { renderVirtualResults } from './src/results-view.js?v=5';
import { loadProblemset, loadContestList } from './src/catalogue-store.js?v=1';

const $ = (selector) => document.querySelector(selector);
const storage = createBrowserStorage();
const ratingStore = createRatingHistoryStore(storage);
const submissionStore = createHistoryStore();
const library = createSessionLibrary(storage);
const localStore = createLocalSessionStore(storage);
let skillReport = null;
let handle = '';
let ratings = null;
let history = null;
let submissions = [];
let busy = false;
let catalogue = null;
let recentContests = null;
let selectedDetails = null;
let rows = [];
const messages = { ratings: '', submissions: '' };

function status(message, error = false) {
  $('#history-status').textContent = message;
  $('#history-status').classList.toggle('error', error);
}
function setBusy(value) {
  busy = value;
  $('#history-refresh').disabled = value;
  $('#history-handle').disabled = value;
  $('#history-rows').querySelectorAll('[data-import]').forEach((button) => { button.disabled = value || !history?.complete; });
}
function closeDetails() {
  selectedDetails = null;
  $('#history-details').hidden = true;
  renderVirtualResults($('#history-results'), null);
}
function viewDetails(contestId, sessionId = null) {
  const snapshot = library.loadRound(handle, contestId);
  if (!snapshot) return;
  selectedDetails = { contestId, sessionId };
  $('#history-details').hidden = false;
  renderVirtualResults($('#history-results'), snapshot, { sessionId });
}
function render() {
  const baseline = officialBaseline(ratings?.records || []);
  const rounds = handle ? library.listRounds(handle) : [];
  rows = buildHistoryTimeline({
    official: ratings?.records || [], rounds,
    localSessions: handle ? localStore.list(handle) : [],
    discovered: discoverVirtualRounds(handle, submissions),
  });
  const { analyses, skillEntries } = renderSkill(rounds);
  const visible = filterHistory(rows, { kind: $('#history-type').value, search: $('#history-search').value });
  $('#history-summary').textContent = handle
    ? `${visible.length} of ${rows.length} entries for @${handle}. ${rows.filter((row) => row.discovery).length} rounds await an identifiable session import.`
    : 'Choose a Codeforces handle to view its history.';
  $('#history-sync-note').textContent = [
    ratings ? `Official ratings synced ${new Date(ratings.syncedAt).toLocaleString()}.` : 'Official rating history has not been loaded.',
    Number.isFinite(history?.syncedAt) ? `Submission history synced ${new Date(history.syncedAt).toLocaleString()}${history.complete ? '.' : ' (incomplete).'} `
      : history ? 'Saved submission history is incomplete; refresh to finish importing.' : 'Submission history has not been loaded.',
    !submissionStore.persistent ? 'Submission cache is available for this visit only.' : '',
  ].join(' ');
  const body = $('#history-rows');
  body.replaceChildren();
  for (const row of visible) {
    const tr = document.createElement('tr');
    tr.dataset.kind = row.kind;
    tr.dataset.entryId = row.id;
    const date = cell(new Date(row.date).toLocaleString());
    date.title = row.dateLabel;
    const name = cell(row.name);
    const result = cell(row.result);
    const note = document.createElement('small');
    note.textContent = `${row.status}${row.needsReview ? ' · Needs review' : ''}`;
    if (row.syncedAt) note.title = `Results last synced ${new Date(row.syncedAt).toLocaleString()}`;
    result.append(note);
    const delta = cell(row.delta == null ? '—' : row.delta > 0 ? `+${row.delta}` : String(row.delta));
    if (row.delta != null) delta.className = row.delta > 0 ? 'rating-gain' : row.delta < 0 ? 'rating-loss' : '';
    const actions = document.createElement('td');
    if (row.kind === 'official') {
      const link = document.createElement('a');
      link.href = `https://codeforces.com/contest/${row.contestId}/standings`;
      link.target = '_blank'; link.rel = 'noreferrer'; link.textContent = 'Standings ↗'; actions.append(link);
    } else if (row.kind === 'virtual') {
      if (!row.discovery) actions.append(action('View', 'view', row.id));
      const refresh = action(row.discovery ? 'Import results' : 'Refresh', 'import', row.contestId);
      refresh.disabled = busy || !history?.complete;
      refresh.title = history?.complete ? 'Fetch fresh Codeforces verdicts for this round.' : 'Refresh submission history first to check earlier attempts.';
      actions.append(refresh);
    } else {
      const link = document.createElement('a');
      link.href = `/contest.html?session=${encodeURIComponent(row.sessionId)}`;
      link.textContent = row.status === 'In progress' || row.status === 'Scheduled' ? 'Resume' : 'Open session';
      actions.append(link);
    }
    const analysis = analyses.get(row.id);
    const update = skillEntries.get(row.id);
    const performance = cell(analysis?.performance ?? '—');
    const rankedDelta = cell(update ? signed(update.rankedDelta) : '—');
    const isReset = row.kind === 'official' && row.contestId === baseline?.contestId;
    const rankedRating = cell(isReset ? baseline.rating : update?.rankedRating ?? '—');
    if (row.kind === 'official') {
      const reset = document.createElement('small'); reset.textContent = isReset ? 'VC estimate resets here' : 'Official CF result'; name.append(reset);
    } else if (row.kind === 'virtual') {
      const explanation = analysis?.reason || (row.discovery ? 'Import results first.' : 'Refresh history to assess this result.');
      performance.title = analysis?.estimatedRank ? `${explanation} ${analysis.kind === 'official' ? 'Original rated-field placement' : 'Estimated coding placement'}: ${analysis.estimatedRank} against ${analysis.fieldSize} established opponents. Extreme results have higher uncertainty.` : explanation;
      const eligibility = document.createElement('small');
      eligibility.textContent = analysis ? analysis.counted ? update ? 'Counts toward VC estimate' : 'Before the latest official contest' : analysis.reason : row.date <= (baseline?.date ?? Date.now() - SKILL_WINDOW_MS) ? 'Before the current VC period' : row.discovery ? 'Sync to analyze' : 'Not calculated';
      name.append(eligibility);
    } else performance.title = 'Practice result: open the session for solves, attempts, and solve times.';
    tr.append(date, name, cell(historyTypes[row.kind]), result, cell(row.rank ?? '—'), delta, cell(row.newRating ?? '—'), performance, rankedDelta, rankedRating, actions);
    body.append(tr);
  }
  if (!visible.length) {
    const tr = document.createElement('tr'); const empty = cell(handle ? 'No history matches these filters. Public virtual sessions appear after submission sync; local sessions appear after preparing a contest here.' : 'Enter a handle above.');
    empty.colSpan = 11; tr.append(empty); body.append(tr);
  }
  if (selectedDetails) viewDetails(selectedDetails.contestId, selectedDetails.sessionId);
}
function cell(value) {
  const element = document.createElement('td'); element.textContent = String(value); return element;
}
function action(label, key, value) {
  const button = document.createElement('button'); button.type = 'button'; button.className = 'secondary-button';
  button.dataset[key] = value; button.textContent = label; return button;
}

async function refresh(value) {
  if (busy) return;
  const nextHandle = value.trim();
  if (!/^[a-zA-Z0-9_-]{1,24}$/.test(nextHandle)) { status('Use 1–24 letters, numbers, underscores, or hyphens.', true); return; }
  if (handle.toLowerCase() !== nextHandle.toLowerCase()) closeDetails();
  handle = nextHandle;
  ratings = ratingStore.load(handle);
  skillReport = loadSkill(storage, handle);
  $('#skill-status').textContent = ''; $('#skill-status').classList.remove('error');
  history = null; submissions = [];
  $('#history-handle').value = handle;
  const url = new URL(location.href); url.searchParams.set('handle', handle); url.searchParams.delete('register'); window.history.replaceState(null, '', url);
  $('#history-exclusions').href = `/excluded.html?handle=${encodeURIComponent(handle)}`;
  setBusy(true); status('Loading saved history…'); render();
  let refreshed = false;
  try {
    history = await submissionStore.load(handle);
    submissions = history?.submissions || [];
    render();
    messages.ratings = 'Fetching official ratings…'; messages.submissions = 'Refreshing submissions…';
    const report = () => status(`${messages.ratings} ${messages.submissions}`);
    report();
    const results = await Promise.allSettled([
      (async () => {
        // Timestamp the request, so an older in-flight response cannot replace a newer snapshot.
        const requestedAt = Date.now();
        const records = await codeforcesRequest('user.rating', { handle });
        ratings = normalizeRatingHistory(handle, records, requestedAt);
        try { ratings = ratingStore.save(ratings); messages.ratings = 'Official ratings refreshed.'; }
        catch { messages.ratings = 'Official ratings loaded, but could not be saved on this device.'; }
        render(); report();
      })(),
      (async () => {
        history = await syncSubmissionHistory({ handle, request: codeforcesRequest, checkpoint: history,
          save: (snapshot) => submissionStore.save(snapshot),
          onProgress: ({ count }) => { messages.submissions = `Checking ${count.toLocaleString()} submissions…`; report(); },
        });
        submissions = history.submissions;
        messages.submissions = 'Submission history refreshed.'; render(); report();
      })(),
    ]);
    results.forEach((result, index) => {
      if (result.status === 'rejected') messages[index ? 'submissions' : 'ratings'] = `${index ? 'Submission' : 'Official rating'} refresh failed: ${result.reason?.message || 'Try again.'} Saved data is kept.`;
    });
    refreshed = results.every((result) => result.status === 'fulfilled');
    status(`${messages.ratings} ${messages.submissions}`, !refreshed);
  } catch (error) { status(error.message || 'Could not load history. Saved sessions are kept.', true); }
  finally { setBusy(false); render(); }
  if (refreshed && ratings && history?.complete) {
    setBusy(true); try { await calculateRanked(); } finally { setBusy(false); render(); }
  }

}

async function importRound(contestId) {
  if (busy || !handle || !history?.complete || !Number.isSafeInteger(contestId)) return;
  setBusy(true); status('Loading the original round and problem lineup…');
  try {
    if (!catalogue) {
      const [problems, contests] = await Promise.all([
        loadProblemset(() => codeforcesRequest('problemset.problems')),
        loadContestList(() => codeforcesRequest('contest.list')),
      ]);
      catalogue = { problems, contests };
      recentContests = contests;
    }
    const contest = catalogue.contests.find((entry) => entry.id === contestId);
    const problems = catalogue.problems.filter((problem) => problem.contestId === contestId);
    if (!contest || !problems.length) throw new Error('This round is unavailable in the public regular-contest catalog. Private mashups and gyms need separate access support.');
    const result = await syncRoundResults({ handle, contest, problems, request: codeforcesRequest, historySubmissions: submissions, historyComplete: history?.complete === true,
      onProgress: ({ count }) => status(`Importing fresh results: ${count} public submissions checked…`),
    });
    // Do not move the complete account-history cache's incremental boundary with round-only data.
    submissions = [...new Map([...submissions, ...result.submissions].map((entry) => [entry.id, entry])).values()].sort((a, b) => b.id - a.id);
    let snapshot = result.snapshot;
    let saved = true;
    try { snapshot = library.saveRound(snapshot); } catch { saved = false; }
    render();
    if (saved) await calculateRanked();
    $('#history-details').hidden = false;
    selectedDetails = saved ? { contestId, sessionId: null } : null;
    renderVirtualResults($('#history-results'), snapshot);
    status(`Imported ${snapshot.sessions.length} identifiable virtual sessions.${saved ? '' : ' Results could not be saved; sync again next visit.'}`);
  } catch (error) { status(`Could not import results. ${error.message} Saved results are kept.`, true); }
  finally { setBusy(false); }
}

$('#history-handle-form').addEventListener('submit', (event) => { event.preventDefault(); refresh($('#history-handle').value); });
$('#history-type').addEventListener('change', render);
$('#history-search').addEventListener('input', render);
$('#history-close-details').addEventListener('click', closeDetails);
$('#history-rows').addEventListener('click', (event) => {
  const importButton = event.target.closest('[data-import]');
  if (importButton) importRound(Number(importButton.dataset.import));
  const view = event.target.closest('[data-view]');
  if (view) {
    const row = rows.find((entry) => entry.id === view.dataset.view);
    if (row) { viewDetails(row.contestId, row.sessionId); $('#history-close-details').focus(); }
  }
});
window.addEventListener('storage', () => {
  if (busy || !handle) return;
  ratings = ratingStore.load(handle); skillReport = loadSkill(storage, handle); render();
});
window.addEventListener('pageshow', () => { if (!busy) render(); });
document.addEventListener('visibilitychange', () => { if (!document.hidden && !busy) render(); });
const initialHandle = new URLSearchParams(location.search).get('handle') || storage.getItem('ranked-codeforces-handle') || '';


function signed(value) { return value > 0 ? `+${value}` : String(value); }
function renderSkill(rounds) {
  const baseline = officialBaseline(ratings?.records || []);
  const reportCurrent = Boolean(skillReport && ratings && history?.complete && skillReport.signature === skillSignature(ratings.records, rounds));
  const summary = calculateSkill(skillReport?.observations || [], Date.now(), baseline);
  $('#skill-official').textContent = baseline?.rating ?? (ratings ? 'Unrated' : '—');
  $('#skill-estimate').textContent = summary.rating ?? '—';
  $('#skill-range').hidden = !summary.count;
  $('#skill-range').textContent = summary.count ? `(${summary.conservative}–${summary.rating})` : '';
  $('#skill-note').textContent = baseline
    ? `${summary.count} eligible virtuals since ${baseline.contestName || 'your latest official contest'}. ${summary.count ? `Started at ${baseline.rating}.` : `VC estimate reset to ${baseline.rating}.`}${skillReport && !reportCurrent ? ' Refresh history to update.' : ''}`
    : `${summary.count || 0} recent eligible virtuals. ${summary.count ? 'Provisional estimate until your first official rated contest.' : 'Play a contest, then refresh history to see your results.'}`;
  return { analyses: new Map((skillReport?.analyses || []).map((entry) => [entry.id, entry])), skillEntries: new Map(summary.entries.map((entry) => [entry.id, entry])) };
}
async function calculateRanked() {
  $('#skill-status').classList.remove('error');
  try {
    const unavailableRounds = [];
    const cutoff = officialBaseline(ratings.records)?.date ?? Date.now() - SKILL_WINDOW_MS;
    const discovered = discoverVirtualRounds(handle, submissions);
    // Round metadata determines whether a recent submission's full contest
    // window can end inside the lookback. Old archives stay available separately.
    if (discovered.length) {
      const contests = catalogue?.contests || recentContests || (recentContests = await loadContestList(() => codeforcesRequest('contest.list')));
      for (const round of discovered) {
        const contest = contests.find((entry) => entry.id === round.contestId);
        if (!contest) {
          if (round.lastSubmissionAt * 1000 >= cutoff) unavailableRounds.push({ contestId: round.contestId, reason: 'Public full-round metadata is unavailable; private mashups and gyms are not rated here.' });
          continue;
        }
        if ((round.lastSubmissionAt + contest.durationSeconds) * 1000 < cutoff) continue;
        const cached = library.loadRound(handle, round.contestId);
        const complete = cached?.historyComplete && cached.syncedAt >= round.lastSubmissionAt * 1000
          && Date.now() - cached.syncedAt < 15 * 60000
          && cached.sessions.every((session) => !session.pending && !session.provisionalAccepted
            && !(Date.now() >= session.endsAt * 1000 && cached.syncedAt < session.endsAt * 1000)
            && session.problems.every((problem) => Number.isInteger(problem.penaltyAttempts) && Number.isInteger(problem.icpcPenaltyAttempts)));
        if (complete) continue;
        $('#skill-status').textContent = `Syncing recent virtual results: ${contest.name}…`;
        let benchmark;
        try { benchmark = await loadBenchmark(contest.id); }
        catch (error) {
          if (error.code !== 'UNSUPPORTED_BENCHMARK') throw error;
          unavailableRounds.push({ contestId: contest.id, reason: error.message }); continue;
        }
        const problems = benchmark.problems.map((problem) => ({ ...problem, contestId: contest.id }));
        const result = await syncRoundResults({ handle, contest, problems, request: codeforcesRequest, historySubmissions: submissions, historyComplete: history.complete });
        library.saveRound(result.snapshot);
      }
    }
    const rounds = library.listRounds(handle);
    skillReport = await computeSkill({ handle, official: ratings.records, rounds, unavailableRounds, storage,
      onProgress: ({ index, total, contestId }) => { $('#skill-status').textContent = `Calculating ${index}/${total}: contest ${contestId}…`; },
    });
    $('#skill-status').textContent = `Results updated. ${skillReport.analyses.filter((entry) => entry.counted).length} virtuals counted since the latest official contest.`;
    $('#skill-status').classList.remove('error'); render();
  } catch (error) {
    $('#skill-status').textContent = error.code === 'STANDINGS_PROXY_UNAVAILABLE'
      ? 'The standings service is missing. In its terminal, press Ctrl+C, then run: python3 server.py. Refresh this page and refresh history again.'
      : `Calculation stopped: ${error.message} The previous saved estimate is kept.`;
    $('#skill-status').classList.add('error');
  }
}

render();
if (initialHandle) refresh(initialHandle);
