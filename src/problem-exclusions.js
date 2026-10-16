import { problemKey, problemFamily } from './recommendations.js?v=7';

export const exclusionStorageKey = (handle) => `ranked-excluded-problems-${handle.toLowerCase()}`;
const legacyKey = (handle) => `ranked-custom-hidden-${handle.toLowerCase()}`;
const validProblem = (problem) => Number.isSafeInteger(problem?.contestId) && problem.contestId > 0
  && typeof problem.index === 'string' && /^[a-z0-9]+$/i.test(problem.index);

export function findExcludedProblem(problem, entries) {
  const exact = entries.find((entry) => problemKey(entry) === problemKey(problem));
  const family = problemFamily(problem);
  return exact || (family && entries.find((entry) => family === problemFamily(entry))) || null;
}

export function createProblemExclusions(storage) {
  function list(handle) {
    try {
      const saved = JSON.parse(storage.getItem(exclusionStorageKey(handle)));
      if (saved?.version !== 1 || saved.handle !== handle.toLowerCase() || !Array.isArray(saved.problems)) return [];
      return [...new Map(saved.problems.filter((problem) => validProblem(problem)
        && typeof problem.name === 'string' && Number.isFinite(problem.excludedAt))
        .map((problem) => [problemKey(problem), problem])).values()].sort((a, b) => b.excludedAt - a.excludedAt);
    } catch { return []; }
  }
  function save(handle, problems) {
    storage.setItem(exclusionStorageKey(handle), JSON.stringify({ version: 1, handle: handle.toLowerCase(), problems }));
  }
  function migrateLegacy(handle, catalogue = []) {
    const raw = storage.getItem(legacyKey(handle));
    const existing = list(handle);
    const names = new Map(catalogue.map((problem) => [problemKey(problem), problem.name]));
    const entries = new Map(existing.map((problem) => [problemKey(problem), problem]));
    let previous = [];
    try { const parsed = JSON.parse(raw); if (Array.isArray(parsed)) previous = parsed; } catch { /* Ignore corrupt legacy entries. */ }
    for (const key of previous) {
      if (typeof key !== 'string' || !/^[1-9]\d*\/[a-z0-9]+$/i.test(key)) continue;
      const [contestId, index] = key.split('/');
      if (!entries.has(key) && Number.isSafeInteger(Number(contestId))) entries.set(key, {
        contestId: Number(contestId), index, name: '', excludedAt: Date.now(),
      });
    }
    const original = [...entries.values()];
    const enriched = original.map((problem) => !problem.name && typeof names.get(problemKey(problem)) === 'string'
      ? { ...problem, name: names.get(problemKey(problem)) } : problem);
    if (raw !== null || enriched.some((problem, index) => problem !== original[index])) {
      save(handle, enriched); // Preserve the old key if the new write fails.
      if (raw !== null) storage.removeItem(legacyKey(handle));
    }
    return list(handle);
  }
  return {
    list, migrateLegacy,
    exclude(handle, problem, now = Date.now()) {
      if (!validProblem(problem)) throw new Error('This problem cannot be excluded because its source is invalid.');
      migrateLegacy(handle);
      const entries = new Map(list(handle).map((entry) => [problemKey(entry), entry]));
      const key = problemKey(problem);
      entries.set(key, entries.get(key) || { contestId: problem.contestId, index: problem.index,
        name: typeof problem.name === 'string' ? problem.name : '', excludedAt: now });
      save(handle, [...entries.values()]);
    },
    restore(handle, key) {
      migrateLegacy(handle);
      save(handle, list(handle).filter((problem) => problemKey(problem) !== key));
    },
    restoreAll(handle) {
      save(handle, []);
      storage.removeItem(legacyKey(handle));
    },
    isExcluded(handle, problem) {
      return Boolean(findExcludedProblem(problem, list(handle)));
    },
  };
}
