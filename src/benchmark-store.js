// Compact shared contest fields are larger than per-handle results: use IndexedDB,
// retain at most 48 fields, and keep a session-only fallback when storage fails.
export function createBenchmarkStore() {
  const memory = new Map();
  let dbPromise;
  const open = () => dbPromise ||= new Promise((resolve, reject) => {
    const req = indexedDB.open('ranked-benchmarks', 1);
    req.onupgradeneeded = () => req.result.createObjectStore('fields', { keyPath: 'contestId' }).createIndex('savedAt', 'savedAt');
    req.onsuccess = () => resolve(req.result); req.onerror = () => reject(req.error);
    req.onblocked = () => reject(new Error('Benchmark storage blocked.'));
  });
  const transact = async (mode, action) => {
    const db = await open();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction('fields', mode);
      const request = action(transaction.objectStore('fields'));
      transaction.oncomplete = () => resolve(request.result);
      transaction.onerror = transaction.onabort = () => reject(transaction.error);
    });
  };
  return {
    async load(id) {
      try { const entry = await transact('readonly', (store) => store.get(id)); if (entry) memory.set(id, entry); } catch { /* Session cache. */ }
      const entry = memory.get(id);
      return entry && Date.now() - entry.savedAt < 86400000 && entry.savedAt <= Date.now() + 5000 ? entry.data : null;
    },
    async save(id, data) {
      const entry = { contestId: id, savedAt: Date.now(), data }; memory.set(id, entry);
      if (memory.size > 48) memory.delete(memory.keys().next().value);
      try {
        await transact('readwrite', (store) => store.put(entry));
        const db = await open();
        await new Promise((resolve, reject) => {
          const transaction = db.transaction('fields', 'readwrite');
          const cursor = transaction.objectStore('fields').index('savedAt').openKeyCursor(null, 'prev');
          let retained = 0;
          cursor.onsuccess = () => {
            const item = cursor.result;
            if (!item) return;
            retained += 1;
            if (retained > 48) transaction.objectStore('fields').delete(item.primaryKey);
            item.continue();
          };
          transaction.oncomplete = resolve;
          transaction.onerror = transaction.onabort = () => reject(transaction.error);
        });
      } catch { /* This calculation remains usable even if cache writes fail. */ }
    },
  };
}
