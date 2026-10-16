const keyFor = (handle) => `ranked-official-ratings-${handle.toLowerCase()}`;

export function normalizeRatingHistory(handle, records, syncedAt = Date.now()) {
  const owner = handle.toLowerCase();
  if (!Array.isArray(records) || !Number.isFinite(syncedAt) || syncedAt < 0) throw new Error('Invalid rating history response.');
  const unique = new Map();
  for (const record of records) {
    if (!record || record.handle?.toLowerCase() !== owner
      || !Number.isSafeInteger(record.contestId) || record.contestId <= 0
      || typeof record.contestName !== 'string' || !record.contestName.trim()
      || !Number.isSafeInteger(record.rank) || record.rank <= 0
      || !Number.isSafeInteger(record.ratingUpdateTimeSeconds) || record.ratingUpdateTimeSeconds <= 0
      || !Number.isSafeInteger(record.oldRating) || !Number.isSafeInteger(record.newRating)) {
      throw new Error('Codeforces returned an invalid or incorrectly identified rating record.');
    }
    const previous = unique.get(record.contestId);
    if (!previous || record.ratingUpdateTimeSeconds >= previous.ratingUpdateTimeSeconds) {
      unique.set(record.contestId, {
        contestId: record.contestId, contestName: record.contestName, handle: owner, rank: record.rank,
        ratingUpdateTimeSeconds: record.ratingUpdateTimeSeconds, oldRating: record.oldRating, newRating: record.newRating,
      });
    }
  }
  return { version: 1, handle: owner, syncedAt, records: [...unique.values()].sort((a, b) => b.ratingUpdateTimeSeconds - a.ratingUpdateTimeSeconds) };
}

export function createRatingHistoryStore(storage) {
  function load(handle) {
    try {
      const snapshot = JSON.parse(storage.getItem(keyFor(handle)));
      if (snapshot?.version !== 1 || snapshot.handle !== handle.toLowerCase() || !Number.isFinite(snapshot.syncedAt)) return null;
      return normalizeRatingHistory(handle, snapshot.records, snapshot.syncedAt);
    } catch { return null; }
  }
  return {
    load,
    save(snapshot) {
      if (snapshot?.version !== 1 || !Number.isFinite(snapshot.syncedAt)) throw new Error('Invalid rating history snapshot.');
      const valid = normalizeRatingHistory(snapshot.handle, snapshot.records, snapshot.syncedAt);
      const previous = load(valid.handle);
      if (previous && previous.syncedAt > valid.syncedAt) return previous;
      storage.setItem(keyFor(valid.handle), JSON.stringify(valid));
      return valid;
    },
  };
}
