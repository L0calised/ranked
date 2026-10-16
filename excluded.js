import { createBrowserStorage } from './src/storage.js';
import { createProblemExclusions, exclusionStorageKey } from './src/problem-exclusions.js?v=2';
import { problemKey } from './src/recommendations.js?v=7';

const storage = createBrowserStorage();
const exclusions = createProblemExclusions(storage);
const $ = (selector) => document.querySelector(selector);
let handle = '';
$('#excluded-handle').value = new URLSearchParams(location.search).get('handle') || storage.getItem('ranked-codeforces-handle') || '';

function showHandle() {
  const value = $('#excluded-handle').value.trim();
  if (!/^[a-z0-9_-]{1,24}$/i.test(value)) { report('Enter a valid Codeforces handle.', true); return; }
  handle = value.toLowerCase();
  $('#history-link').href = `/history.html?handle=${encodeURIComponent(handle)}`;
  $('#excluded-search').value = '';
  history.replaceState(null, '', `/excluded.html?handle=${encodeURIComponent(handle)}`);
  try { exclusions.migrateLegacy(handle); report(''); }
  catch (error) { report(error.message, true); }
  render();
}

function render() {
  const all = handle ? exclusions.list(handle) : [];
  const search = $('#excluded-search').value.trim().toLowerCase();
  const shown = all.filter((problem) => `${problem.name} ${problemKey(problem)} ${problem.contestId}${problem.index}`.toLowerCase().includes(search));
  $('#restore-all').disabled = !all.length;
  $('#excluded-summary').textContent = handle ? `${all.length} excluded problem${all.length === 1 ? '' : 's'} for @${handle}.${search ? ` ${shown.length} match your filter.` : ''}` : 'Choose a handle to see its excluded problems.';
  const list = $('#excluded-list');
  list.replaceChildren();
  for (const problem of shown) {
    const row = document.createElement('li');
    const info = document.createElement('div');
    const link = document.createElement('a');
    link.href = `https://codeforces.com/contest/${problem.contestId}/problem/${encodeURIComponent(problem.index)}`;
    link.target = '_blank'; link.rel = 'noreferrer';
    link.textContent = problem.name || `Codeforces ${problem.contestId}${problem.index}`;
    const source = document.createElement('p');
    source.className = 'result-caveat';
    source.textContent = `CF ${problem.contestId}${problem.index}`;
    info.append(link, source);
    const restore = document.createElement('button');
    restore.type = 'button'; restore.className = 'secondary-button';
    restore.dataset.restoreProblem = problemKey(problem); restore.textContent = 'Restore';
    row.append(info, restore); list.append(row);
  }
  if (!shown.length) {
    const empty = document.createElement('li');
    empty.textContent = search ? 'No excluded problems match your filter.' : 'No problems are manually excluded.';
    list.append(empty);
  }
}

function report(message, error = false) {
  $('#excluded-status').textContent = message;
  $('#excluded-status').classList.toggle('error', error);
}

$('#excluded-handle-form').addEventListener('submit', (event) => { event.preventDefault(); showHandle(); });
$('#excluded-search').addEventListener('input', render);
$('#excluded-list').addEventListener('click', (event) => {
  const button = event.target.closest('[data-restore-problem]');
  if (!button || !handle) return;
  try { exclusions.restore(handle, button.dataset.restoreProblem); report('Problem restored.'); render(); }
  catch (error) { report(error.message, true); }
});
$('#restore-all').addEventListener('click', () => {
  if (!handle) return;
  try { exclusions.restoreAll(handle); report('All manual problem exclusions restored.'); render(); }
  catch (error) { report(error.message, true); }
});
window.addEventListener('storage', (event) => { if (event.key === null || event.key === exclusionStorageKey(handle)) render(); });
if ($('#excluded-handle').value) showHandle();
else render();
