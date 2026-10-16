import { codeforcesRequest } from './src/codeforces.js?v=3';
import { problemKey, problemFamily, recommendRounds, isRecentRound } from './src/recommendations.js?v=7';
import { generateCustomContest } from './src/custom-contest.js?v=6';
import { syncSubmissionHistory } from './src/history.js?v=3';
import { createHistoryStore } from './src/history-store.js?v=2';
import { syncRoundResults } from './src/virtual-results.js?v=2';
import { renderVirtualResults } from './src/results-view.js?v=5';
import { createSessionLibrary } from './src/session-library.js?v=2';
import { createLocalSessionStore, prepareLocalSession } from './src/local-session.js?v=12';
import { calculateSkill } from './src/skill-rating.js?v=7';
import { createRatingHistoryStore, normalizeRatingHistory } from './src/rating-history.js';
import { loadSkill, officialBaseline } from './src/skill-service.js?v=8';
import { createBrowserStorage } from './src/storage.js';
import { createProblemExclusions, exclusionStorageKey, findExcludedProblem } from './src/problem-exclusions.js?v=2';

const form = document.querySelector('#handle-form');
const input = document.querySelector('#handle');
const hint = document.querySelector('#form-hint');
const button = document.querySelector('#connect-button');
const rating = document.querySelector('#official-rating');
const rank = document.querySelector('#cf-rank');
const maxRating = document.querySelector('#max-rating');
const profileName = document.querySelector('#profile-name');
const profileLink = document.querySelector('#profile-link');
const submissionList = document.querySelector('#submission-list');
const recommendationSection = document.querySelector('#recommendation-section');
const recommendButton = document.querySelector('#recommend-button');
const customButton = document.querySelector('#custom-contest-button');
const historyLink = document.querySelector('#history-link');
const exclusionsLink = document.querySelector('#excluded-problems-link');
const recommendationNote = document.querySelector('#recommendation-note');
const choicesContainer = document.querySelector('#round-choices');
const recommendationResult = document.querySelector('#recommendation-result');
const sessionPanel = document.querySelector('#session-panel');
const resultsContainer = document.querySelector('#round-results');
const resultsStatus = document.querySelector('#results-status');
const storage = createBrowserStorage();
const officialRatings = createRatingHistoryStore(storage);
const sessionLibrary = createSessionLibrary(storage);
const localStore = createLocalSessionStore(storage);
const exclusions = createProblemExclusions(storage);

const savedHandle = storage.getItem('ranked-codeforces-handle');
let connectedProfile = null;
let userSubmissions = [];
let historyState = null;
const historyStore = createHistoryStore();
let selectedRound = null;
let roundChoices = [];
let catalogue = null;
let findingContest = false;
let creatingCustom = false;
let syncingResults = false;
const shownContestIds = new Set();
const shownCustomProblemKeys = new Set();
let localSession = null;
let localWakeup = null;
function hasActiveSession() {
  return ['scheduled', 'active'].includes(localSession?.status) && Date.now() < localSession.endsAt;
}

function updateSessionActions() {
  const busy = findingContest || syncingResults;
  const blocked = hasActiveSession() || busy;
  recommendButton.disabled = blocked || !connectedProfile || !historyState?.complete;
  customButton.disabled = recommendButton.disabled;
  choicesContainer.querySelectorAll('button').forEach((action) => { action.disabled = blocked; });
  customButton.textContent = creatingCustom ? 'Generating…' : 'Create custom contest';
  customButton.title = hasActiveSession() ? 'Finish your scheduled or active contest before creating another.'
    : 'Generate five suitable unseen problems, preferring recent rounds.';
  const scheduled = localSession?.status === 'scheduled' && Date.now() < localSession.scheduledAt;
  recommendButton.innerHTML = findingContest && !creatingCustom ? 'Looking…' : scheduled ? 'Contest scheduled' : hasActiveSession() ? 'Session in progress' : `${selectedRound ? 'Find more contests' : 'Find contests'} <span aria-hidden="true">→</span>`;
  recommendationResult.querySelectorAll('button').forEach((action) => {
    action.disabled = action.matches('[data-sync-results], [data-start-session]') ? busy : blocked;
  });
  const startButton = recommendationResult.querySelector('[data-start-session]');
  if (startButton) startButton.textContent = scheduled ? 'View scheduled start' : hasActiveSession() ? 'Resume contest'
    : selectedRound?.contest.kind === 'custom' ? 'Prepare custom contest' : 'Start on Ranked';
  const excluded = connectedProfile ? exclusions.list(connectedProfile.handle) : [];
  let hasExcludedProblems = false;
  recommendationResult.querySelectorAll('[data-problem-key]').forEach((row) => {
    const problem = selectedRound?.problems.find((entry) => problemKey(entry) === row.dataset.problemKey);
    if (!problem) return;
    const match = findExcludedProblem(problem, excluded);
    const exact = match && problemKey(match) === problemKey(problem);
    hasExcludedProblems ||= Boolean(match);
    row.classList.toggle('problem-excluded', Boolean(match));
    const status = row.querySelector('[data-problem-status]');
    status.textContent = [match ? exact ? 'Excluded' : 'Related problem excluded' : '', hasRecordedAttempt(problem) ? 'Attempt in your history' : '',
      selectedRound.contest.kind === 'custom' ? `CF ${problem.contestId}${problem.index}` : ''].filter(Boolean).join(' · ');
    const action = row.querySelector('[data-exclude-problem]');
    action.textContent = exact ? 'Restore' : match ? 'Manage exclusions' : 'Exclude';
    action.title = exact ? 'Remove this manual exclusion.' : match ? 'Restore the related exclusion on the Excluded problems page.'
      : 'Leave this problem out of future recommendations.';
  });
  if (startButton && hasExcludedProblems && !hasActiveSession()) startButton.disabled = true;
}
if (savedHandle) {
  input.value = savedHandle;
  loadCodeforcesProfile(savedHandle);
}

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  const handle = input.value.trim();
  if (!/^[a-zA-Z0-9_-]{1,24}$/.test(handle)) {
    setError('Use 1–24 letters, numbers, underscores, or hyphens.');
    input.focus();
    return;
  }
  try { storage.setItem('ranked-codeforces-handle', handle); }
  catch (error) { setError(error.message); return; }
  await loadCodeforcesProfile(handle);
});

input.addEventListener('input', () => hint.classList.remove('error'));
recommendButton.addEventListener('click', () => findRecommendation());
customButton.addEventListener('click', () => findRecommendation({ customOnly: true }));
choicesContainer.addEventListener('click', (event) => {
  const pick = event.target.closest('[data-pick-round]');
  if (pick && connectedProfile && !findingContest && !syncingResults && !hasActiveSession()) {
    const round = roundChoices.find((entry) => entry.contest.id === Number(pick.dataset.pickRound));
    if (!round || round.contest.id === selectedRound?.contest.id) return;
    try {
      storage.setItem(`ranked-round-${connectedProfile.handle.toLowerCase()}`, JSON.stringify(round));
      selectedRound = round;
      rememberRecommendation(round);
      renderRecommendation(round.contest, round.problems);
      renderRoundChoices();
      choicesContainer.querySelector(`[data-pick-round="${round.contest.id}"]`)?.focus();
      recommendationNote.textContent = historyDescription() + (isRecentRound(round.contest) ? '' : ' Older archive round.');
    } catch (error) { resultsStatus.textContent = error.message; resultsStatus.classList.add('error'); }
  }
});
recommendationResult.addEventListener('click', (event) => {
  if (event.target.closest('[data-start-session]')) startSession();
  if (event.target.closest('[data-sync-results]')) importRoundResults();
  const excludeButton = event.target.closest('[data-exclude-problem]');
  if (excludeButton && selectedRound && connectedProfile && !findingContest && !syncingResults && !hasActiveSession()) {
    const problem = selectedRound.problems.find((entry) => problemKey(entry) === excludeButton.dataset.excludeProblem);
    if (!problem) return;
    try {
      const match = findExcludedProblem(problem, exclusions.list(connectedProfile.handle));
      if (match && problemKey(match) !== problemKey(problem)) {
        location.href = exclusionsLink.href;
        return;
      }
      if (match) {
        exclusions.restore(connectedProfile.handle, problemKey(problem));
        resultsStatus.textContent = 'Manual exclusion restored.';
      } else {
        exclusions.exclude(connectedProfile.handle, problem);
        resultsStatus.textContent = `Excluded ${problem.name || problemKey(problem)}. ${selectedRound.contest.kind === 'custom'
          ? 'Create another custom contest to get a complete fresh set, or restore this problem.'
          : 'Find another round, or restore this problem to use the full lineup.'}`;
      }
      resultsStatus.classList.remove('error');
      updateSessionActions();
    } catch (error) { resultsStatus.textContent = error.message; resultsStatus.classList.add('error'); }
  }
});
window.addEventListener('storage', (event) => {
  if (connectedProfile && event.key === `ranked-skill-${connectedProfile.handle.toLowerCase()}`) renderSkillPreview(connectedProfile.handle);
  if (connectedProfile && (event.key === null || event.key === exclusionStorageKey(connectedProfile.handle)
    || event.key?.startsWith('ranked-local-session-'))) refreshLocalSession();
});
window.addEventListener('pageshow', () => refreshLocalSession());
document.addEventListener('visibilitychange', () => { if (!document.hidden) refreshLocalSession(); });

async function loadCodeforcesProfile(handle) {
  window.clearTimeout(localWakeup);
  connectedProfile = null;
  historyState = null;
  userSubmissions = [];
  selectedRound = null;
  roundChoices = [];
  renderRoundChoices();
  shownContestIds.clear();
  shownCustomProblemKeys.clear();
  recommendationResult.replaceChildren();
  renderVirtualResults(resultsContainer, null);
  resultsStatus.textContent = '';
  recommendationSection.hidden = true;
  sessionPanel.replaceChildren();
  sessionPanel.hidden = true;
  localSession = null;
  exclusionsLink.href = '/excluded.html';
  historyLink.href = `/history.html?handle=${encodeURIComponent(handle)}`;
  recommendButton.disabled = true;
  customButton.disabled = true;
  setLoading(true);
  hint.classList.remove('error');
  hint.textContent = `Loading public Codeforces data for @${handle}…`;
  try {
    const users = await codeforcesRequest('user.info', { handles: handle });
    const user = users[0];
    if (!user) throw new Error('That handle was not found. Check the spelling and try again.');

    renderProfile(user, []);
    submissionList.firstElementChild.textContent = 'Syncing public submission history…';
    const ratingRefresh = codeforcesRequest('user.rating', { handle: user.handle }).then((records) => {
      try { officialRatings.save(normalizeRatingHistory(user.handle, records)); } catch { /* Keep prior saved data; profile/practice remain available. */ }
    }).catch(() => {});
    const checkpoint = await historyStore.load(user.handle);
    historyState = await syncSubmissionHistory({
      handle: user.handle,
      request: codeforcesRequest,
      checkpoint,
      save: (snapshot) => historyStore.save(snapshot),
      onProgress: ({ count, pages, incremental }) => {
        hint.textContent = `${incremental ? 'Refreshing' : 'Syncing'} @${user.handle}: ${count.toLocaleString()} submissions, ${pages} pages checked…`;
      },
    });
    await ratingRefresh;
    connectedProfile = user;
    exclusionsLink.href = `/excluded.html?handle=${encodeURIComponent(user.handle)}`;
    userSubmissions = historyState.submissions;
    renderProfile(user, userSubmissions);
    recommendationSection.hidden = false;
    recommendButton.disabled = hasActiveSession();
    recommendationNote.textContent = historyDescription();
    const savedRound = readJson(`ranked-round-${user.handle.toLowerCase()}`, null);
    if (validSavedRound(savedRound)) {
      selectedRound = savedRound;
      rememberRecommendation(savedRound);
      renderRecommendation(savedRound.contest, savedRound.problems);
      if (savedRound.problems.some(hasRecordedAttempt)) {
        recommendationNote.textContent = `${historyDescription()} Your saved contest has recorded attempts; find another for a fresh recommendation.`;
      }
      recommendButton.innerHTML = 'Find another <span aria-hidden="true">→</span>';
    }
    try { exclusions.migrateLegacy(user.handle, validSavedRound(savedRound) ? savedRound.problems : []); }
    catch (error) { resultsStatus.textContent = error.message; resultsStatus.classList.add('error'); }
    hint.textContent = `Connected to @${user.handle}. ${userSubmissions.length.toLocaleString()} submissions synced.${historyStore.persistent ? '' : ' Browser history storage is unavailable; the next visit will need another full sync.'}`;
    refreshLocalSession();
    await findRecommendation({ refreshHistory: false, preserveSelection: true });
  } catch (error) {
    setError(error.message || 'Could not load Codeforces data. Please try again shortly.');
  } finally {
    setLoading(false);
  }
}

function readJson(key, fallback) {
  try { return JSON.parse(storage.getItem(key)) ?? fallback; }
  catch { return fallback; }
}

function validSavedRound(round) {
  const custom = round?.contest?.kind === 'custom';
  return (custom ? typeof round.contest.id === 'string' && round.contest.id.startsWith('custom:')
    : Number.isSafeInteger(round?.contest?.id) && round.contest.id > 0) && typeof round.contest.name === 'string'
    && Number.isSafeInteger(round.contest.durationSeconds) && round.contest.durationSeconds > 0
    && Array.isArray(round.problems) && (custom ? round.problems.length === 5 : round.problems.length >= 4)
    && new Set(round.problems.map(problemKey)).size === round.problems.length
    && round.problems.every((problem, index) => Number.isSafeInteger(problem?.contestId) && problem.contestId > 0
      && (custom ? problem.label === String.fromCharCode(65 + index) : problem.contestId === round.contest.id)
      && typeof problem.index === 'string' && problem.index);
}

function rememberRecommendation(round) {
  if (round.contest.kind === 'custom') round.problems.forEach((problem) => shownCustomProblemKeys.add(problemKey(problem)));
  else shownContestIds.add(round.contest.id);
}

async function ensureCatalogue() {
  if (!catalogue) {
    const problemset = await codeforcesRequest('problemset.problems');
    const contests = await codeforcesRequest('contest.list');
    catalogue = { problems: problemset.problems || [], contests: contests || [] };
  }
  return catalogue;
}

function refreshLocalSession() {
  if (!connectedProfile) return;
  renderSkillPreview(connectedProfile.handle);
  localSession = localStore.findOpen(connectedProfile.handle);
  window.clearTimeout(localWakeup);
  if (hasActiveSession()) {
    const wakeAt = localSession.status === 'scheduled' && Date.now() < localSession.scheduledAt ? localSession.scheduledAt : localSession.endsAt;
    // Browsers overflow timeouts longer than about 24 days into a tight loop.
    localWakeup = window.setTimeout(refreshLocalSession, Math.min(2147483647, Math.max(0, wakeAt - Date.now() + 50)));
  }
  renderLocalResume();
  updateSessionActions();
}

function historyDescription() {
  return `Checked ${userSubmissions.length.toLocaleString()} submissions across the available public history. Exclude individual problems you recognize from reading without submitting.`;
}

function hasRecordedAttempt(problem) {
  const family = problemFamily(problem);
  return userSubmissions.some((submission) => problemKey(submission.problem) === problemKey(problem)
    || (family && problemFamily(submission.problem) === family));
}

async function findRecommendation({ customOnly = false, refreshHistory = true, preserveSelection = false } = {}) {
  refreshLocalSession();
  if (!connectedProfile || !historyState?.complete || hasActiveSession() || findingContest || syncingResults) return;
  findingContest = true;
  creatingCustom = customOnly;
  updateSessionActions();
  setLoading(true);
  recommendationNote.textContent = customOnly ? 'Generating a custom practice contest. The first search may take a few seconds.'
    : 'Finding a suitable finished round. The first search may take a few seconds.';
  try {
    if (refreshHistory) {
      historyState = await syncSubmissionHistory({
        handle: connectedProfile.handle, request: codeforcesRequest, checkpoint: historyState,
        save: (snapshot) => historyStore.save(snapshot),
        onProgress: ({ count }) => { recommendationNote.textContent = `Refreshing submission history before ${customOnly ? 'generating a contest' : 'choosing a round'}… ${count.toLocaleString()} submissions checked.`; },
      });
    }
    userSubmissions = historyState.submissions;
    renderProfile(connectedProfile, userSubmissions);
    await ensureCatalogue();
    refreshLocalSession();
    const excludedProblems = exclusions.migrateLegacy(connectedProfile.handle, catalogue.problems);
    const excludedKeys = excludedProblems.map(problemKey);
    const exposure = localStore.list(connectedProfile.handle)
      .filter((session) => session.startedAt !== null || (session.status === 'scheduled' && session.scheduledAt <= Date.now()))
      .flatMap((session) => session.problems);
    const evidence = [...userSubmissions, ...exposure.map((problem) => ({ problem })),
      ...excludedProblems.map((problem) => ({ problem }))];
    const candidates = customOnly ? [] : recommendRounds({
      ...catalogue,
      submissions: evidence,
      rating: connectedProfile.rating,
      excludedIds: [...shownContestIds].filter((id) => !(preserveSelection && id === selectedRound?.contest.id)),
    });
    const customOptions = {
      ...catalogue, submissions: evidence, rating: connectedProfile.rating,
      excludedProblemKeys: [...excludedKeys, ...shownCustomProblemKeys],
    };
    const preferred = preserveSelection && selectedRound?.contest.kind !== 'custom'
      ? candidates.find(({ contest }) => contest.id === selectedRound?.contest.id) : null;
    const savedCustom = preserveSelection && selectedRound?.contest.kind === 'custom'
      && selectedRound.problems.every((problem) => !hasRecordedAttempt(problem) && !exclusions.isExcluded(connectedProfile.handle, problem)
        && !exposure.some((seen) => problemKey(seen) === problemKey(problem)
          || problemFamily(seen) && problemFamily(seen) === problemFamily(problem))) ? selectedRound : null;
    const next = preferred || savedCustom || (customOnly ? generateCustomContest(customOptions) : candidates.find(({ contest }) => isRecentRound(contest))
      || generateCustomContest({ ...customOptions, recentOnly: true })
      || candidates[0] || generateCustomContest(customOptions));
    if (!next) {
      recommendationNote.textContent = `${customOnly ? 'There are not enough suitable unseen problems to generate a complete custom contest.' : 'No suitable fresh full round or balanced custom set is available in this search.'}${selectedRound ? ' Your current recommendation is kept below.' : ''}`;
      if (!selectedRound) showRecommendationMessage('There are not enough suitable unseen problems to generate a complete set. You can review earlier sessions on the History page.');
      return;
    }
    storage.setItem(`ranked-round-${connectedProfile.handle.toLowerCase()}`, JSON.stringify(next));
    selectedRound = next;
    const options = candidates.filter(({ contest }) => (next.contest.kind === 'custom' || isRecentRound(next.contest)) ? isRecentRound(contest) : true);
    roundChoices = next.contest.kind === 'custom' ? options.slice(0, 3)
      : [next, ...options.filter(({ contest }) => contest.id !== next.contest.id)].slice(0, 3);
    roundChoices.forEach(({ contest }) => shownContestIds.add(contest.id));
    rememberRecommendation(next);
    renderRoundChoices();
    renderRecommendation(selectedRound.contest, selectedRound.problems);
    const fallbackNote = savedCustom ? ' Your saved custom contest is kept below.' : next.contest.kind === 'custom'
      ? `${customOnly ? ' Generated' : ' No suitable recent full round remained, so we generated'} a five-problem, two-hour practice contest.${next.contest.usesOlderProblems ? ' Recent sources were insufficient; older problems are included.' : ''}`
      : !isRecentRound(next.contest) ? ' Recent options were insufficient; this is an older full round.' : '';
    recommendationNote.textContent = historyDescription() + (roundChoices.length > 1 ? ` Choose one of ${roundChoices.length} full rounds below.` : '') + fallbackNote;
  } catch (error) {
    recommendationNote.textContent = error.message || 'Could not load contest data. Please try again.';
  } finally {
    findingContest = false;
    creatingCustom = false;
    setLoading(false);
    updateSessionActions();
  }
}

function renderRoundChoices() {
  choicesContainer.replaceChildren();
  choicesContainer.hidden = roundChoices.length < 2;
  for (const round of roundChoices) {
    const card = document.createElement('article');
    const selected = round.contest.id === selectedRound?.contest.id;
    card.className = `round-choice${selected ? ' selected' : ''}`;
    const title = document.createElement('h3'); title.textContent = round.contest.name;
    const caption = document.createElement('p');
    caption.textContent = `${round.problems.length} problems · ${formatDuration(round.contest.durationSeconds)} · ${formatTime(round.contest.startTimeSeconds)}`;
    const pick = document.createElement('button'); pick.type = 'button';
    pick.className = selected ? '' : 'secondary-button';
    pick.dataset.pickRound = round.contest.id;
    pick.textContent = selected ? 'Selected' : 'Choose this round';
    pick.setAttribute('aria-pressed', String(selected));
    pick.disabled = findingContest || syncingResults || hasActiveSession();
    card.append(title, caption, pick); choicesContainer.append(card);
  }
}

function renderRecommendation(contest, problems) {
  const custom = contest.kind === 'custom';
  recommendationResult.replaceChildren();
  resultsStatus.textContent = '';
  renderVirtualResults(resultsContainer, custom ? null : sessionLibrary.loadRound(connectedProfile.handle, contest.id));
  const card = document.createElement('article');
  card.className = 'contest-result-card';
  const top = document.createElement('div');
  top.className = 'contest-result-top';
  const info = document.createElement('div');
  const title = document.createElement('h3');
  title.textContent = contest.name;
  const caption = document.createElement('p');
  caption.textContent = `${problems.length} problems · ${formatDuration(contest.durationSeconds)} · ${custom
    ? `Generated practice set${contest.usesOlderProblems ? ' · Includes older sources' : ''}`
    : `${formatTime(contest.startTimeSeconds)}${isRecentRound(contest) ? '' : ' · Older archive'}`}`;
  info.append(title, caption);
  top.append(info);

  const list = document.createElement('ol');
  list.className = 'recommended-problems';
  problems.forEach((problem) => {
    const row = document.createElement('li');
    row.dataset.problemKey = problemKey(problem);
    const link = document.createElement('a');
    link.href = `https://codeforces.com/contest/${problem.contestId}/problem/${encodeURIComponent(problem.index)}`;
    link.target = '_blank';
    link.rel = 'noreferrer';
    const label = custom ? problem.label : problem.index;
    link.textContent = problem.name ? `${label}. ${problem.name}` : `Problem ${label}`;
    const status = document.createElement('span');
    status.dataset.problemStatus = '';
    status.textContent = hasRecordedAttempt(problem) ? 'Attempt in your history' : custom ? `CF ${problem.contestId}${problem.index}` : '';
    const controls = document.createElement('div');
    controls.className = 'problem-controls';
    const exclude = document.createElement('button');
    exclude.type = 'button'; exclude.className = 'secondary-button problem-exclusion-button';
    exclude.dataset.excludeProblem = problemKey(problem); exclude.textContent = 'Exclude';
    controls.append(status, exclude);
    row.append(link, controls);
    list.append(row);
  });

  const note = document.createElement('p');
  note.className = 'result-caveat';
  note.textContent = custom
    ? 'Five problems from different rounds, ordered by difficulty. Tags and difficulty ratings are hidden. Schedule this contest here, then solve and submit through the original Codeforces problem links. Practice results only.'
    : 'Full round, original duration. Tags and difficulty ratings are hidden. Start virtual participation on Codeforces, or prepare timed practice here and submit on Codeforces. Opening either option does not start the timer.';
  const actions = document.createElement('div');
  actions.className = 'contest-actions';
  const roundLink = document.createElement('a');
  roundLink.className = 'primary-link';
  roundLink.href = `https://codeforces.com/contest/${contest.id}`;
  roundLink.target = '_blank';
  roundLink.rel = 'noreferrer';
  roundLink.textContent = 'Start on Codeforces ↗';
  const syncButton = document.createElement('button');
  syncButton.type = 'button';
  syncButton.className = 'secondary-button';
  syncButton.dataset.syncResults = '';
  syncButton.textContent = 'Sync CF virtual results';
  const startButton = document.createElement('button');
  startButton.type = 'button';
  startButton.className = 'secondary-button';
  startButton.dataset.startSession = '';
  startButton.disabled = false;
  startButton.textContent = hasActiveSession() ? 'Resume contest' : custom ? 'Prepare custom contest' : 'Start on Ranked';
  if (custom) actions.append(startButton);
  else {
    actions.append(roundLink, startButton, syncButton);
  }
  const exclusionNote = document.createElement('p');
  exclusionNote.className = 'result-caveat';
  exclusionNote.textContent = custom
    ? 'Exclude individual problems you recognize. Create custom contest generates a complete replacement set. Review or restore exclusions on the Excluded problems page.'
    : 'Find more contests offers another batch for this visit. Excluding a problem rules out this full round as untouched; its other problems remain available for custom sets.';
  card.append(top, list, note, actions, exclusionNote);
  recommendationResult.append(card);
  updateSessionActions();
}

async function fetchAndSaveRound(round, onProgress) {
  const result = await syncRoundResults({
    handle: connectedProfile.handle, contest: round.contest, problems: round.problems,
    request: codeforcesRequest, historySubmissions: userSubmissions, historyComplete: historyState?.complete === true, onProgress,
  });
  // Round refreshes must not change the all-contest history cache's head boundary.
  userSubmissions = [...new Map([...userSubmissions, ...result.submissions].map((submission) => [submission.id, submission])).values()]
    .sort((a, b) => b.id - a.id);
  renderProfile(connectedProfile, userSubmissions);
  let saved = true;
  let snapshot = result.snapshot;
  try { snapshot = sessionLibrary.saveRound(snapshot); }
  catch { saved = false; }
  refreshLocalSession();
  if (selectedRound?.contest.id === round.contest.id) renderVirtualResults(resultsContainer, snapshot);
  if (selectedRound) {
    recommendationNote.textContent = historyDescription();
  }
  return { snapshot, saved };
}

function importSummary(snapshot, saved) {
  return `Synced ${snapshot.sessions.length} identifiable virtual sessions from ${snapshot.fetchedCount} public submissions.${saved ? '' : ' Results could not be saved in this browser; sync again next visit.'}`;
}

async function importRoundResults() {
  if (!selectedRound || selectedRound.contest.kind === 'custom' || !connectedProfile || findingContest || syncingResults) return;
  syncingResults = true;
  setLoading(true);
  updateSessionActions();
  resultsStatus.classList.remove('error');
  resultsStatus.textContent = 'Fetching fresh submissions for this round…';
  try {
    const { snapshot, saved } = await fetchAndSaveRound(selectedRound, ({ count, pages }) => {
      resultsStatus.textContent = `Syncing round results: ${count.toLocaleString()} submissions across ${pages} pages…`;
    });
    resultsStatus.textContent = importSummary(snapshot, saved);
  } catch (error) {
    resultsStatus.classList.add('error');
    resultsStatus.textContent = `Could not sync results. ${error.message}${resultsContainer.hidden ? '' : ' Last-synced results below may be out of date.'}`;
  } finally {
    syncingResults = false;
    setLoading(false);
    updateSessionActions();
  }
}

function formatDuration(seconds) {
  const minutes = Math.round(seconds / 60);
  return `${minutes} minutes`;
}

function startSession() {
  if (!selectedRound || !connectedProfile || findingContest || syncingResults) return;
  try {
    const running = localStore.findOpen(connectedProfile.handle);
    if (running && Date.now() < running.endsAt) {
      location.href = `/contest.html?session=${encodeURIComponent(running.id)}`;
      return;
    }
    if (selectedRound.problems.some((problem) => exclusions.isExcluded(connectedProfile.handle, problem))) {
      throw new Error('Restore the excluded problems or choose another recommendation before preparing this contest.');
    }
    const prepared = localStore.list(connectedProfile.handle).find((session) => session.status === 'ready' && session.contest.id === selectedRound.contest.id);
    if (prepared) {
      location.href = `/contest.html?session=${encodeURIComponent(prepared.id)}`;
      return;
    }
    const draft = prepareLocalSession({
      id: crypto.randomUUID(), handle: connectedProfile.handle,
      contest: selectedRound.contest, problems: selectedRound.problems, historySubmissions: userSubmissions,
    });
    localStore.save(draft);
    location.href = `/contest.html?session=${encodeURIComponent(draft.id)}`;
  } catch (error) {
    resultsStatus.classList.add('error');
    resultsStatus.textContent = `Could not prepare this contest. ${error.message}`;
  }
}

function renderLocalResume() {
  sessionPanel.replaceChildren();
  sessionPanel.hidden = !localSession;
  if (!localSession) return;
  const title = document.createElement('strong');
  title.textContent = localSession.contest.name;
  const link = document.createElement('a');
  link.className = 'primary-link';
  link.href = `/contest.html?session=${encodeURIComponent(localSession.id)}`;
  link.textContent = hasActiveSession() ? 'Resume contest →' : 'Review timed session →';
  const content = document.createElement('div');
  content.className = 'session-header';
  content.append(title, link);
  sessionPanel.append(content);
}

function showRecommendationMessage(message) {
  recommendationResult.replaceChildren();
  const paragraph = document.createElement('p');
  paragraph.className = 'recommendation-message';
  paragraph.textContent = message;
  recommendationResult.append(paragraph);
}

function renderSkillPreview(handle, officialRating = connectedProfile?.rating) {
  const report = loadSkill(storage, handle);
  const baseline = officialBaseline(officialRatings.load(handle)?.records || []);
  const changed = Number.isFinite(officialRating) && baseline?.rating !== officialRating;
  const summary = changed ? { rating: officialRating, count: 0 } : calculateSkill(report?.observations || [], Date.now(), baseline);
  document.querySelector('#dashboard-skill').textContent = summary.rating ?? officialRating ?? '—';
  document.querySelector('#dashboard-skill-range').hidden = !summary.count;
  document.querySelector('#dashboard-skill-range').textContent = summary.count ? `(${summary.conservative}–${summary.rating})` : '';
  document.querySelector('#dashboard-skill-note').textContent = summary.count ? `${summary.count} virtuals since your latest official contest. Update in History.` : 'Starts at your official CF rating. Update results in History.';
}

function renderProfile(user, submissions) {
  renderSkillPreview(user.handle, user.rating);
  rating.innerHTML = '';
  rating.append(document.createTextNode(user.rating ?? 'Unrated'));
  const suffix = document.createElement('span');
  suffix.textContent = user.rating == null ? 'no official rating' : 'official rating';
  rating.append(suffix);
  rank.textContent = user.rank || 'Unrated';
  maxRating.textContent = `Max ${user.maxRating ?? '—'}`;
  profileName.textContent = user.firstName ? `${user.firstName} ${user.lastName || ''}`.trim() : user.handle;
  profileLink.href = `https://codeforces.com/profile/${encodeURIComponent(user.handle)}`;
  renderSubmissions(submissions || [], user.handle);
}

function renderSubmissions(submissions, handle) {
  submissionList.replaceChildren();
  if (!submissions.length) {
    const empty = document.createElement('li');
    empty.className = 'empty-submissions';
    empty.textContent = `No public submissions found for @${handle}.`;
    submissionList.append(empty);
    return;
  }

  submissions.slice(0, 5).forEach((submission) => {
    const item = document.createElement('li');
    const problem = submission.problem || {};
    const problemLink = document.createElement('a');
    problemLink.className = 'problem-link';
    problemLink.href = `https://codeforces.com/contest/${submission.contestId}/problem/${encodeURIComponent(problem.index || '')}`;
    problemLink.target = '_blank';
    problemLink.rel = 'noreferrer';
    problemLink.textContent = `${problem.index || '?'} · ${problem.name || 'Unknown problem'}`;
    const detail = document.createElement('span');
    detail.className = 'submission-detail';
    detail.textContent = `${verdictLabel(submission.verdict)} · ${formatTime(submission.creationTimeSeconds)}`;
    item.append(problemLink, detail);
    submissionList.append(item);
  });
}

function verdictLabel(verdict) {
  if (!verdict) return 'In queue';
  return verdict === 'OK' ? 'Accepted' : verdict.replaceAll('_', ' ').toLowerCase().replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function formatTime(seconds) {
  if (!seconds) return 'time unavailable';
  return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' }).format(new Date(seconds * 1000));
}

function setLoading(isLoading) {
  button.disabled = isLoading;
  button.innerHTML = isLoading ? 'Loading…' : 'Connect handle <span aria-hidden="true">→</span>';
  input.disabled = isLoading;
}

function setError(message) {
  hint.textContent = message;
  hint.classList.add('error');
  profileName.textContent = 'Could not load profile';
  submissionList.replaceChildren();
  const error = document.createElement('li');
  error.className = 'empty-submissions';
  error.textContent = message;
  submissionList.append(error);
}

