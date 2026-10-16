const VERSION = 1;

// Scan all accessible pages, with overlap to detect shifting offsets. A completed
// cache lets later scans stop at a previously known submission ID. Partial caches
// never establish that boundary: they must be scanned through to the oldest page.
export async function syncSubmissionHistory({
  handle, request, checkpoint = null, onProgress = () => {}, save = async () => {},
  pageSize = 1000, overlap = 100, now = Date.now,
  sinceSeconds = null,
}) {
  if (!Number.isInteger(pageSize) || !Number.isInteger(overlap) || overlap < 1 || pageSize <= overlap) {
    throw new Error('Invalid submission-history page size or overlap.');
  }
  if (sinceSeconds !== null && (!Number.isSafeInteger(sinceSeconds) || sinceSeconds < 0)) throw new Error('Invalid submission window.');
  const owner = handle.toLowerCase();
  const validCache = sinceSeconds === null && checkpoint?.sinceSeconds == null && checkpoint?.version === VERSION && checkpoint.handle === owner
    && Array.isArray(checkpoint.submissions)
    && checkpoint.submissions.every((submission) => Number.isSafeInteger(submission?.id) && submission.id > 0);
  const cached = validCache ? checkpoint.submissions : [];
  const baselineComplete = validCache && checkpoint.complete === true;
  const baselineIds = new Set(baselineComplete ? cached.map((submission) => submission.id) : []);
  const merged = new Map(cached.map((submission) => [submission.id, submission]));
  let from = 1;
  let pages = 0;
  let previousTail = null;

  const snapshot = (complete) => ({
    version: VERSION, handle: owner, complete,
    ...(sinceSeconds === null ? {} : { sinceSeconds }),
    syncedAt: complete ? now() : null,
    submissions: [...merged.values()].sort((a, b) => b.id - a.id),
  });

  try {
    while (true) {
      onProgress({ count: merged.size, pages, stage: 'fetching', incremental: baselineComplete });
      const page = await request('user.status', { handle, from: String(from), count: String(pageSize) });
      if (!Array.isArray(page) || page.length > pageSize
        || page.some((submission, index) => !Number.isSafeInteger(submission?.id) || submission.id <= 0
          || (index > 0 && submission.id > page[index - 1].id))) {
        throw new Error('Codeforces returned an unexpected submission page. Please retry.');
      }
      if (sinceSeconds !== null && page.some((submission, index) => !Number.isSafeInteger(submission.creationTimeSeconds)
        || submission.creationTimeSeconds < 0
        || (index > 0 && submission.creationTimeSeconds > page[index - 1].creationTimeSeconds))) {
        throw new Error('Codeforces returned inconsistent submission times. Please retry.');
      }
      if (previousTail !== null && !page.some((submission) => submission.id === previousTail)) {
        throw new Error('Submission history changed while paging. Please retry the sync.');
      }
      pages += 1;
      const reachedBaseline = baselineComplete && page.some((submission) => baselineIds.has(submission.id));
      for (const submission of page) merged.set(submission.id, submission);
      const complete = reachedBaseline || page.length < pageSize
        || (sinceSeconds !== null && page.some((submission) => submission.creationTimeSeconds < sinceSeconds));
      // Keep an existing complete cache untouched during an interrupted refresh;
      // writing new head pages into it could create a false stopping boundary.
      if (!baselineComplete || complete) await save(snapshot(complete));
      onProgress({ count: merged.size, pages, stage: complete ? 'complete' : 'fetching', incremental: baselineComplete });
      if (complete) return snapshot(true);
      const tail = page.at(-1).id;
      if (previousTail !== null && tail >= previousTail) {
        throw new Error('Submission history did not advance. Please retry the sync.');
      }
      previousTail = tail;
      from += pageSize - overlap;
    }
  } catch (error) {
    const failure = new Error(`History sync interrupted after checking ${merged.size.toLocaleString()} submissions. ${error.message}`);
    failure.cause = error;
    throw failure;
  }
}
