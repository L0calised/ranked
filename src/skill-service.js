import { codeforcesRequest, codeforcesStandings } from './codeforces.js?v=3';
import { createBenchmarkStore } from './benchmark-store.js';
import { validateBenchmark, virtualEligibility, scoreVirtual, estimatePerformance, calculateSkill, SKILL_VERSION, SKILL_WINDOW_MS } from './skill-rating.js?v=6';
const fields = createBenchmarkStore();
const keyFor = (handle) => `ranked-skill-${handle.toLowerCase()}`;

export function skillSignature(official, rounds) {
  return JSON.stringify([official.map((r) => [r.contestId, r.oldRating, r.newRating, r.rank, r.ratingUpdateTimeSeconds]),
    rounds.map((r) => [r.contestId, r.syncedAt])]);
}
export function loadSkill(storage, handle) {
  try {
    const saved = JSON.parse(storage.getItem(keyFor(handle)));
    return saved?.version === SKILL_VERSION && saved.handle === handle.toLowerCase() && Array.isArray(saved.analyses) && Array.isArray(saved.observations)
      && saved.analyses.every((entry) => entry && typeof entry.id === 'string' && typeof entry.reason === 'string' && typeof entry.counted === 'boolean')
      && saved.observations.every((entry) => entry && typeof entry.id === 'string' && ['official', 'virtual'].includes(entry.kind) && Number.isFinite(entry.performance) && Number.isFinite(entry.date))
      && typeof saved.signature === 'string' && Number.isFinite(saved.computedAt) ? saved : null;
  } catch { return null; }
}
export async function loadBenchmark(contestId, { request = codeforcesRequest, standings = codeforcesStandings } = {}) {
  const cached = await fields.load(contestId);
  if (cached) { try { return validateBenchmark(cached, contestId); } catch { /* Refetch malformed/obsolete fields. */ } }
  const data = await standings(contestId);
  if (!['CF', 'ICPC'].includes(data?.contest?.type)) {
    const error = new Error('This contest format has no supported performance comparison.');
    error.code = 'UNSUPPORTED_BENCHMARK';
    throw error;
  }
  const changes = await request('contest.ratingChanges', { contestId: String(contestId) });
  const benchmark = validateBenchmark({ ...data, changes }, contestId);
  await fields.save(contestId, benchmark);
  return benchmark;
}

export async function computeSkill({ handle, official, rounds, unavailableRounds = [], storage, onProgress = () => {}, now = Date.now(), benchmark = loadBenchmark }) {
  const baseline = officialBaseline(official, now);
  const cutoff = baseline?.date ?? now - SKILL_WINDOW_MS;
  const selected = [
    ...rounds.flatMap((snapshot) => snapshot.sessions.map((session) => ({ id: session.id, kind: 'virtual', contestId: snapshot.contestId,
      date: session.endsAt * 1000, snapshot, session }))),
  ].filter((row) => row.session.startedAt * 1000 > cutoff && row.date <= now).sort((a, b) => a.date - b.date || a.id.localeCompare(b.id));
  const analyses = unavailableRounds.map((round) => ({ id: `discovered:${round.contestId}`, counted: false, reason: round.reason }));
  const observations = []; const loaded = new Map();
  for (let index = 0; index < selected.length; index += 1) {
    const row = selected[index];
    onProgress({ index: index + 1, total: selected.length, contestId: row.contestId });
    // Refresh all discovered recent results before calling this function. A
    // download failure preserves the previous report rather than selecting wins.
    let data;
    try {
      if (!loaded.has(row.contestId)) loaded.set(row.contestId, await benchmark(row.contestId));
      data = loaded.get(row.contestId);
    } catch (error) {
      if (error.code !== 'UNSUPPORTED_BENCHMARK') throw error;
      analyses.push({ id: row.id, counted: false, reason: error.message });
      continue;
    }
    try {
        const first = row.snapshot.sessions.slice().sort((a, b) => a.startedAt - b.startedAt)[0];
        if (first?.id !== row.id) { analyses.push({ id: row.id, counted: false, reason: 'Repeated virtual participation in the same round.' }); continue; }
        const reason = virtualEligibility(row.snapshot, row.session, data, now);
        if (reason) { analyses.push({ id: row.id, reason, counted: false }); continue; }
        const score = scoreVirtual(row.session, data);
        const performance = estimatePerformance(data, score, handle);
        const observation = { id: row.id, contestId: row.contestId, date: row.date, startedAt: row.session.startedAt * 1000,
          baselineDate: baseline?.date ?? null, kind: 'virtual', ...performance };
        observations.push(observation);
        analyses.push({ ...observation, counted: true, reason: baseline ? 'Virtual completed after your latest official rated contest.' : 'Recent virtual; provisional estimate without an official rating.' });
    } catch (error) { analyses.push({ id: row.id, counted: false, reason: error.message }); }
  }
  const report = { version: SKILL_VERSION, handle: handle.toLowerCase(), computedAt: now,
    signature: skillSignature(official, rounds), analyses, observations,
    baseline };
  // Commit the whole report once; no partial prefix ratings are persisted.
  const newer = loadSkill(storage, handle);
  if (newer && newer.computedAt > report.computedAt) return { ...newer, skill: calculateSkill(newer.observations, now, newer.baseline) };
  storage.setItem(keyFor(handle), JSON.stringify(report));
  return { ...report, skill: calculateSkill(observations, now, report.baseline) };
}


export function officialBaseline(official, now = Date.now()) {
  const latest = official.filter((row) => Number.isFinite(row.newRating) && row.ratingUpdateTimeSeconds * 1000 <= now)
    .sort((a, b) => b.ratingUpdateTimeSeconds - a.ratingUpdateTimeSeconds)[0];
  return latest ? { rating: latest.newRating, date: latest.ratingUpdateTimeSeconds * 1000, contestId: latest.contestId, contestName: latest.contestName } : null;
}
