const indexOrder = new Intl.Collator('en', { numeric: true });

export function problemKey(problem) {
  return problem?.contestId && problem?.index ? `${problem.contestId}/${problem.index}` : null;
}

function nameKey(problem) {
  return problemFamily(problem);
}

// Conservative matching for easy/hard and other named versions. Names cannot
// identify every shared idea, so familiarity can still be reported by the user.
export function problemFamily(problem) {
  return (problem?.name || '').normalize('NFKC').toLowerCase()
    .replace(/\s*\([^)]*(?:version|edition|easy|hard|simple|medium|difficult)[^)]*\)/g, '')
    .replace(/\s*[-:]\s*(?:easy|hard|simple|medium|difficult)(?:\s+(?:version|edition))?\s*$/g, '')
    .replace(/\s+/g, ' ').replace(/[\s.!?]+$/, '').trim();
}

export function isPracticeRound(contest) {
  return Number.isSafeInteger(contest.id) && contest.id > 0 && contest.phase === 'FINISHED'
    && /Codeforces (?:Global )?Round|Educational Codeforces Round/i.test(contest.name)
    && ['CF', 'ICPC'].includes(contest.type) && Number.isSafeInteger(contest.durationSeconds)
    && contest.durationSeconds >= 3600 && contest.durationSeconds <= 14400;
}

export function isRecentRound(contest, now = Date.now()) {
  const cutoff = new Date(now);
  cutoff.setUTCFullYear(cutoff.getUTCFullYear() - 2);
  return Number.isFinite(contest.startTimeSeconds)
    && contest.startTimeSeconds >= cutoff.getTime() / 1000 && contest.startTimeSeconds <= now / 1000;
}

// Recommendation preferences, not Codeforces eligibility rules. Opening-task
// difficulty is checked separately; a division name alone cannot calibrate a round.
export function divisionPreference(contest, rating) {
  const target = Number.isFinite(rating) ? rating : 1000;
  const name = contest.name || '';
  const divisions = new Set([...name.matchAll(/Div\.?\s*([1-4])/gi)].map((match) => Number(match[1])));
  if (/Div\.?\s*1\s*\+\s*(?:Div\.?\s*)?2/i.test(name)) divisions.add(2);
  if (divisions.size === 1 && divisions.has(1) && target < 2100) return Infinity;
  if (divisions.has(2)) return 0; // Includes combined Div. 1 + Div. 2 rounds.
  if (divisions.has(3)) return 1;
  if (divisions.has(4)) return 2;
  return 3; // Other eligible Div. 1, open, and global rounds.
}

// Match at round level; never remove hard, unrated, or split-version tasks
// from a selected round. This is a suitability heuristic, not a skill model.
export function recommendRounds({ contests, problems, submissions, rating, excludedIds = [], now = Date.now() }) {
  const target = Number.isFinite(rating) ? rating : 1000;
  const attempted = new Set(submissions.map((submission) => problemKey(submission.problem)).filter(Boolean));
  const attemptedNames = new Set(submissions.map((submission) => nameKey(submission.problem)).filter(Boolean));
  const excluded = new Set(excludedIds.map(Number));
  const preferences = new Map(contests.map((contest) => [contest.id, divisionPreference(contest, target)]));
  const recent = new Set(contests.filter((contest) => isRecentRound(contest, now)).map((contest) => contest.id));
  const groups = new Map();
  for (const problem of problems) {
    if (!problemKey(problem)) continue;
    const group = groups.get(problem.contestId) || new Map();
    group.set(problem.index, problem);
    groups.set(problem.contestId, group);
  }

  return contests.flatMap((contest) => {
    if (excluded.has(contest.id) || !isPracticeRound(contest) || !Number.isFinite(preferences.get(contest.id))) return [];
    const lineup = [...(groups.get(contest.id)?.values() || [])]
      .sort((a, b) => indexOrder.compare(a.index, b.index));
    if (lineup.length < 4) return [];
    // Any attempt, including a wrong answer, excludes the entire round.
    // Matching name families also catches shared divisions and named versions.
    if (lineup.some((problem) => attempted.has(problemKey(problem)) || attemptedNames.has(nameKey(problem)))) return [];
    const difficulties = lineup.map((problem) => problem.rating).filter(Number.isFinite);
    const accessible = difficulties.filter((difficulty) => difficulty <= target + 300).length;
    if (accessible < 2 || !difficulties.some((difficulty) => difficulty <= target + 100)
      || !difficulties.some((difficulty) => difficulty >= target + 200)) return [];
    return [{ contest, problems: lineup }];
  }).sort((a, b) => Number(recent.has(b.contest.id)) - Number(recent.has(a.contest.id))
    || preferences.get(a.contest.id) - preferences.get(b.contest.id)
    || (b.contest.startTimeSeconds || 0) - (a.contest.startTimeSeconds || 0));
}
