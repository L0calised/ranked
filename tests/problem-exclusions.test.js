import test from 'node:test';
import assert from 'node:assert/strict';
import { createProblemExclusions, exclusionStorageKey, findExcludedProblem } from '../src/problem-exclusions.js';
import { recommendRounds } from '../src/recommendations.js';

function storage() {
  const map = new Map();
  return { getItem: (key) => map.get(key) ?? null, setItem: (key, value) => map.set(key, value), removeItem: (key) => map.delete(key) };
}
const task = (contestId = 42, index = 'A', name = `Task ${contestId}${index}`) => ({ contestId, index, name });

test('only the chosen problem is excluded, with case-insensitive handle isolation and no duplicates', () => {
  const store = createProblemExclusions(storage());
  store.exclude('Example', task(), 100);
  store.exclude('EXAMPLE', task(), 200);
  store.exclude('example', task(43), 300);
  assert.deepEqual(store.list('example').map((entry) => [entry.contestId, entry.excludedAt]), [[43, 300], [42, 100]]);
  assert.equal(store.isExcluded('example', task(42, 'B')), false);
  assert.deepEqual(store.list('another'), []);
  assert.deepEqual(store.list('example-other'), []);
});

test('individual restore and restore all persist after reload without deleting other handles', () => {
  const data = storage();
  const store = createProblemExclusions(data);
  store.exclude('example', task(42)); store.exclude('example', task(43)); store.exclude('another', task(44));
  createProblemExclusions(data).restore('EXAMPLE', '42/A');
  assert.deepEqual(store.list('example').map((entry) => entry.contestId), [43]);
  store.restoreAll('example');
  assert.deepEqual(createProblemExclusions(data).list('example'), []);
  assert.equal(store.list('another').length, 1);
});

test('related versions are excluded conservatively and the exact source match takes precedence', () => {
  const store = createProblemExclusions(storage());
  store.exclude('example', task(42, 'B1', 'Shared task (Easy Version)'));
  assert.equal(store.isExcluded('example', task(999, 'C', 'Shared task (Hard Version)')), true);
  assert.equal(findExcludedProblem(task(42, 'B1'), store.list('example')).index, 'B1');
  store.restore('example', '42/B1');
  assert.equal(store.isExcluded('example', task(999, 'C', 'Shared task (Hard Version)')), false);
});

test('legacy custom source keys migrate once and can be restored without reappearing', () => {
  const data = storage();
  data.setItem('ranked-custom-hidden-example', JSON.stringify(['42/A', '43/B', '42/A', 'bad', null]));
  const store = createProblemExclusions(data);
  store.migrateLegacy('Example', [task(42), task(43, 'B')]);
  assert.equal(store.list('example').length, 2);
  assert.equal(store.list('example').find((entry) => entry.contestId === 42).name, 'Task 42A');
  assert.equal(data.getItem('ranked-custom-hidden-example'), null);
  store.restore('example', '42/A');
  store.migrateLegacy('example');
  assert.equal(store.list('example').length, 1);
  store.restoreAll('example');
  assert.equal(store.list('example').length, 0);
});

test('retired whole-contest hiding does not silently exclude every problem from a round', () => {
  const data = storage();
  data.setItem('ranked-recognized-example', '[42]');
  const store = createProblemExclusions(data);
  assert.deepEqual(store.migrateLegacy('example', [task(42), task(42, 'B')]), []);
  assert.equal(store.isExcluded('example', task()), false);
});

test('storage write failures preserve existing exclusions and unmigrated legacy choices', () => {
  const data = storage();
  const store = createProblemExclusions(data);
  store.exclude('example', task());
  data.setItem('ranked-custom-hidden-example', '["43/B"]');
  data.setItem = () => { throw new Error('Full'); };
  assert.throws(() => store.migrateLegacy('example'), /Full/);
  assert.equal(data.getItem('ranked-custom-hidden-example'), '["43/B"]');
  assert.equal(store.list('example').length, 1);
  assert.throws(() => store.restore('example', '42/A'), /Full/);
  assert.equal(store.list('example').length, 1);
});

test('corrupt or misidentified data is ignored, and invalid source IDs cannot be written', () => {
  const data = storage();
  const store = createProblemExclusions(data);
  data.setItem(exclusionStorageKey('example'), '{broken');
  assert.deepEqual(store.list('example'), []);
  data.setItem(exclusionStorageKey('example'), JSON.stringify({ version: 1, handle: 'another', problems: [task()] }));
  assert.deepEqual(store.list('example'), []);
  assert.throws(() => store.exclude('example', task(-1)));
  assert.throws(() => store.exclude('example', task(42, '../A')));
});

test('excluding one problem prevents recommending its full round as untouched, including named variants', () => {
  const store = createProblemExclusions(storage());
  store.exclude('example', task(999, 'B1', 'Familiar task (Easy Version)'));
  const result = recommendRounds({ rating: 1158,
    contests: [{ id: 42, name: 'Codeforces Round 42 (Div. 2)', type: 'CF', phase: 'FINISHED', durationSeconds: 7200 }],
    problems: ['A', 'B', 'C', 'D'].map((index, position) => ({ contestId: 42, index, name: position ? `Task ${index}` : 'Familiar task (Hard Version)', rating: 800 + position * 300 })),
    submissions: store.list('example').map((problem) => ({ problem })),
  });
  assert.deepEqual(result, []);
});
