// The public Codeforces catalogs are large and shared by recommendations and
// History. Keep them in IndexedDB so visits do not redownload them.
const DB_NAME = 'ranked-catalogue';
const STORE_NAME = 'catalogues';
const MAX_AGES = { problemset: 24 * 60 * 60 * 1000, 'contest-list': 15 * 60 * 1000 };
const memory = new Map();
const pending = new Map();
let database;

function openDatabase() {
  if (!globalThis.indexedDB) return Promise.reject(new Error('IndexedDB unavailable.'));
  if (!database) database = new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(STORE_NAME, { keyPath: 'key' });
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
    request.onblocked = () => reject(new Error('Catalogue storage is blocked.'));
  });
  return database;
}

async function read(key) {
  try {
    const db = await openDatabase();
    const entry = await new Promise((resolve, reject) => {
      const transaction = db.transaction(STORE_NAME, 'readonly');
      const request = transaction.objectStore(STORE_NAME).get(key);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    if (entry) memory.set(key, entry);
  } catch { /* The in-memory cache still works for this page. */ }
  const entry = memory.get(key);
  return entry && Date.now() - entry.savedAt < MAX_AGES[key] && entry.savedAt <= Date.now() + 5000 ? entry.data : null;
}

async function write(key, data) {
  const entry = { key, savedAt: Date.now(), data };
  memory.set(key, entry);
  try {
    const db = await openDatabase();
    await new Promise((resolve, reject) => {
      const transaction = db.transaction(STORE_NAME, 'readwrite');
      transaction.objectStore(STORE_NAME).put(entry);
      transaction.oncomplete = resolve;
      transaction.onerror = () => reject(transaction.error);
      transaction.onabort = () => reject(transaction.error || new Error('Catalogue cache save aborted.'));
    });
  } catch { /* Cache failures must not block a recommendation. */ }
}

export function loadCataloguePart(key, fetcher) {
  if (!['problemset', 'contest-list'].includes(key)) return Promise.reject(new Error('Unknown public catalogue.'));
  const load = async () => {
    const saved = await read(key);
    if (saved) return saved;
    const fetch = async () => {
      const secondLook = await read(key);
      if (secondLook) return secondLook;
      const data = await fetcher();
      if (!Array.isArray(data)) throw new Error(`Codeforces returned an invalid ${key} catalogue.`);
      await write(key, data);
      return data;
    };
    return globalThis.navigator?.locks
      ? navigator.locks.request(`ranked-catalogue-${key}`, fetch)
      : fetch();
  };
  if (pending.has(key)) return pending.get(key);
  const request = load().finally(() => pending.delete(key));
  pending.set(key, request);
  return request;
}

export function loadProblemset(fetcher) {
  return loadCataloguePart('problemset', async () => {
    const result = await fetcher();
    if (!Array.isArray(result?.problems)) throw new Error('Codeforces returned an invalid problem catalogue.');
    return result.problems;
  });
}

export function loadContestList(fetcher) {
  return loadCataloguePart('contest-list', fetcher);
}
