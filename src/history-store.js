// IndexedDB avoids localStorage's small size limit for large submission histories.
// If storage is unavailable, a session-only fallback still permits a full sync.
function keepHistory(previous, incoming) {
  if (!previous || previous.handle !== incoming.handle) return incoming;
  // Partial scans must not move the incremental stopping boundary of a complete
  // history, including when two tabs finish their requests in a different order.
  if (previous.complete && !incoming.complete) return previous;
  if (!previous.complete || !incoming.complete) return incoming;
  const newer = previous.syncedAt > incoming.syncedAt ? previous : incoming;
  const older = newer === incoming ? previous : incoming;
  return { ...newer, submissions: [...new Map([...older.submissions, ...newer.submissions]
    .map((submission) => [submission.id, submission])).values()].sort((a, b) => b.id - a.id) };
}

export function createHistoryStore() {
  const memory = new Map();
  let persistent = typeof indexedDB !== 'undefined';
  let database;

  function open() {
    if (!database) database = new Promise((resolve, reject) => {
      const request = indexedDB.open('ranked-history', 1);
      request.onupgradeneeded = () => request.result.createObjectStore('histories', { keyPath: 'handle' });
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
      request.onblocked = () => reject(new Error('History storage is blocked.'));
    });
    return database;
  }

  async function transact(mode, action) {
    const db = await open();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction('histories', mode);
      const request = action(transaction.objectStore('histories'));
      transaction.oncomplete = () => resolve(request.result);
      transaction.onerror = () => reject(transaction.error);
      transaction.onabort = () => reject(transaction.error || new Error('History storage transaction aborted.'));
    });
  }

  return {
    get persistent() { return persistent; },
    async load(handle) {
      const key = handle.toLowerCase();
      if (persistent) {
        try {
          const saved = await transact('readonly', (store) => store.get(key));
          if (saved) memory.set(key, saved);
        } catch { persistent = false; }
      }
      return memory.get(key) || null;
    },
    async save(snapshot) {
      let saved = keepHistory(memory.get(snapshot.handle), snapshot);
      if (persistent) {
        try {
          const db = await open();
          await new Promise((resolve, reject) => {
            const transaction = db.transaction('histories', 'readwrite');
            const store = transaction.objectStore('histories');
            const request = store.get(snapshot.handle);
            request.onsuccess = () => {
              saved = keepHistory(request.result, saved);
              store.put(saved);
            };
            transaction.oncomplete = resolve;
            transaction.onerror = () => reject(transaction.error);
            transaction.onabort = () => reject(transaction.error || new Error('History save aborted.'));
          });
        }
        catch { persistent = false; }
      }
      memory.set(snapshot.handle, saved);
      return saved;
    },
  };
}
