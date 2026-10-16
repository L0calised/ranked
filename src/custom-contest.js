import { isPracticeRound, isRecentRound, divisionPreference, problemKey, problemFamily } from './recommendations.js?v=7';

// Fixed practice format: five tasks, one per source round, over two hours.
// Search stays bounded so a sparse archive cannot freeze the browser.
export function generateCustomContest({ contests, problems, submissions, rating, excludedContestIds = [], excludedProblemKeys = [], recentOnly = false, now = Date.now() }) {
  const target = Math.min(3500, Math.max(800, Math.round((Number.isFinite(rating) ? rating : 1000) / 100) * 100));
  const targets = [-300, -100, 100, 300, 500].map((offset) => Math.min(3500, Math.max(800, target + offset)));
  const excludedRounds = new Set(excludedContestIds.map(Number));
  const rounds = new Map(contests.filter((contest) => isPracticeRound(contest) && !excludedRounds.has(contest.id)
    && Number.isFinite(divisionPreference(contest, rating))).map((contest) => [contest.id, contest]));
  const recent = new Set([...rounds.values()].filter((contest) => isRecentRound(contest, now)).map((contest) => contest.id));
  const preferences = new Map([...rounds.values()].map((contest) => [contest.id, divisionPreference(contest, rating)]));
  const attempted = new Set([...excludedProblemKeys, ...submissions.map((submission) => problemKey(submission.problem)).filter(Boolean)]);
  const attemptedFamilies = new Set(submissions.map((submission) => problemFamily(submission.problem)).filter(Boolean));
  // Also exclude variants of explicitly hidden/previously offered tasks.
  for (const problem of problems) if (attempted.has(problemKey(problem))) attemptedFamilies.add(problemFamily(problem));
  const unique = new Map();
  for (const problem of problems) {
    const key = problemKey(problem), family = problemFamily(problem);
    if (!key || !rounds.has(problem.contestId) || typeof problem.index !== 'string' || !family
      || !Number.isFinite(problem.rating) || problem.rating < 800 || problem.rating > 3500
      || (problem.type && problem.type !== 'PROGRAMMING') || attempted.has(key) || attemptedFamilies.has(family)) continue;
    unique.set(key, { ...problem, family });
  }
  const recentProblems = [...unique.values()].filter((problem) => recent.has(problem.contestId));
  const pools = recentOnly ? [recentProblems] : [recentProblems, [...unique.values()]];
  for (const pool of pools) {
    const options = targets.map((difficulty) => pool
      .filter((problem) => Math.abs(problem.rating - difficulty) <= 200)
      .sort((a, b) => Number(recent.has(b.contestId)) - Number(recent.has(a.contestId))
        || Math.abs(a.rating - difficulty) - Math.abs(b.rating - difficulty)
        || preferences.get(a.contestId) - preferences.get(b.contestId)
        || (rounds.get(b.contestId).startTimeSeconds || 0) - (rounds.get(a.contestId).startTimeSeconds || 0)
        || problemKey(a).localeCompare(problemKey(b), 'en', { numeric: true })).slice(0, 100));
    if (options.some((candidates) => !candidates.length)) continue;
    const chosen = [], usedRounds = new Set(), usedFamilies = new Set();
    let visits = 0;
    function select(slot) {
      if (slot === targets.length) return true;
      for (const problem of options[slot]) {
        if (++visits > 20000) return false;
        if (usedRounds.has(problem.contestId) || usedFamilies.has(problem.family)
          || (chosen.length && problem.rating < chosen.at(-1).rating)) continue;
        chosen.push(problem); usedRounds.add(problem.contestId); usedFamilies.add(problem.family);
        if (select(slot + 1)) return true;
        chosen.pop(); usedRounds.delete(problem.contestId); usedFamilies.delete(problem.family);
      }
      return false;
    }
    if (!select(0)) continue;
    const selected = chosen.map(({ family, ...problem }, index) => ({ ...problem, label: String.fromCharCode(65 + index) }));
    return {
      contest: { kind: 'custom', id: `custom:${selected.map(problemKey).join(',')}`, name: 'Custom practice contest',
        durationSeconds: 7200, generatorVersion: 2, targetRating: target, targetDifficulties: targets,
        usesOlderProblems: selected.some((problem) => !recent.has(problem.contestId)) },
      problems: selected,
    };
  }
  return null;
}
