import test from 'node:test';
import assert from 'node:assert/strict';
import { createSessionLibrary, discoverVirtualRounds } from '../src/session-library.js';
import { buildVirtualSessions } from '../src/virtual-results.js';

function storage() {
  const entries = new Map();
  return {
    get length() { return entries.size; },
    key: (index) => [...entries.keys()][index] ?? null,
    getItem: (key) => entries.get(key) ?? null,
    setItem: (key, value) => entries.set(key, value),
  };
}
const startedAt = 1700000000;
function submission(id, contestId = 42, type = 'VIRTUAL', handle = 'Example') {
  return { id, contestId, creationTimeSeconds: startedAt + id, relativeTimeSeconds: id, verdict: 'OK', testset: 'TESTS',
    problem: { contestId, index: 'A' },
    author: { participantType: type, members: [{ handle }], startTimeSeconds: startedAt, ghost: false } };
}
function snapshot({ handle = 'example', contestId = 42, verdict = 'OK', syncedAt = 100 } = {}) {
  const contest = { id: contestId, name: `Contest ${contestId}`, durationSeconds: 7200 };
  const record = { ...submission(1, contestId, 'VIRTUAL', handle), verdict };
  return { version: 1, complete: true, handle, contestId, contestName: contest.name, syncedAt,
    ...buildVirtualSessions({ handle, contest, problems: [record.problem], submissions: [record], nowSeconds: startedAt + 8000 }) };
}

test('discovers virtual rounds across all history without counting practice or duplicate IDs', () => {
  const record = submission(1);
  const rounds = discoverVirtualRounds('EXAMPLE', [record, record, submission(2, 43), submission(3, 42, 'PRACTICE'), submission(4, 42, 'CONTESTANT')]);
  assert.deepEqual(rounds.map((round) => [round.contestId, round.submissionCount]), [[43, 1], [42, 1]]);
});

test('discovery excludes team, ghost and other-handle submissions', () => {
  const team = submission(1);
  team.author.members.push({ handle: 'Teammate' });
  const ghost = submission(2);
  ghost.author.ghost = true;
  assert.deepEqual(discoverVirtualRounds('example', [team, ghost, submission(3, 42, 'VIRTUAL', 'SomeoneElse')]), []);
});

test('discovery does not mistake missing timing for an identifiable session', () => {
  const record = submission(1);
  delete record.author.startTimeSeconds;
  delete record.relativeTimeSeconds;
  assert.equal(discoverVirtualRounds('example', [record]).length, 1);
  const report = buildVirtualSessions({ handle: 'example', contest: { id: 42, durationSeconds: 7200 }, problems: [record.problem], submissions: [record] });
  assert.equal(report.sessions.length, 0);
});

test('re-import updates verdicts without adding duplicate sessions', () => {
  const library = createSessionLibrary(storage());
  library.saveRound(snapshot());
  library.saveRound(snapshot({ verdict: 'WRONG_ANSWER', syncedAt: 200 }));
  const sessions = library.listSessions('EXAMPLE');
  assert.equal(sessions.length, 1);
  assert.equal(sessions[0].session.solved, 0);
});

test('handle libraries are isolated, including handles with a shared prefix', () => {
  const library = createSessionLibrary(storage());
  library.saveRound(snapshot());
  library.saveRound(snapshot({ handle: 'example-other' }));
  assert.equal(library.listSessions('example').length, 1);
  assert.equal(library.listSessions('example-other').length, 1);
  assert.deepEqual(library.listSessions('unrelated'), []);
});

test('keeps other rounds when one round is refreshed and sorts sessions by start', () => {
  const library = createSessionLibrary(storage());
  library.saveRound(snapshot());
  const later = snapshot({ contestId: 43 });
  later.sessions[0].startedAt += 10000;
  later.sessions[0].endsAt += 10000;
  later.sessions[0].id = `cf-virtual:example:43:${later.sessions[0].startedAt}`;
  library.saveRound(later);
  library.saveRound(snapshot({ syncedAt: 200 }));
  assert.deepEqual(library.listSessions('example').map((entry) => entry.contestId), [43, 42]);
});

test('incomplete, corrupt and misidentified snapshots cannot replace good results', () => {
  const store = storage();
  const library = createSessionLibrary(store);
  library.saveRound(snapshot());
  assert.throws(() => library.saveRound({ ...snapshot(), complete: false }));
  assert.throws(() => library.saveRound({ ...snapshot(), handle: 'someoneelse' }));
  store.setItem('ranked-results-example-100', '{broken');
  assert.equal(library.listRounds('example').length, 1);
});

test('an older tab snapshot cannot overwrite newer imported results', () => {
  const library = createSessionLibrary(storage());
  library.saveRound(snapshot({ verdict: 'WRONG_ANSWER', syncedAt: 200 }));
  library.saveRound(snapshot({ syncedAt: 100 }));
  assert.equal(library.loadRound('example', 42).sessions[0].solved, 0);
});

test('zero-session imports are retained without fabricating history entries', () => {
  const library = createSessionLibrary(storage());
  library.saveRound({ ...snapshot(), sessions: [] });
  assert.equal(library.listRounds('example').length, 1);
  assert.equal(library.listSessions('example').length, 0);
});

test('loads existing result keys created before the library overview existed', () => {
  const store = storage();
  store.setItem('ranked-results-example-42', JSON.stringify(snapshot()));
  assert.equal(createSessionLibrary(store).listSessions('example').length, 1);
});

test('malformed saved result rows cannot break the results page', () => {
  const store = storage();
  const library = createSessionLibrary(store);
  const broken = snapshot();
  broken.sessions[0].problems = [null];
  store.setItem('ranked-results-example-42', JSON.stringify(broken));
  assert.equal(library.loadRound('example', 42), null);
  assert.deepEqual(library.listSessions('example'), []);
  assert.throws(() => library.saveRound(broken));
});
