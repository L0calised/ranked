// Reading blocked storage should show an empty state, not break module startup.
// Writes must fail visibly: a scheduled contest needs durable browser storage.
export function createBrowserStorage(getStorage = () => globalThis.localStorage) {
  const read = (action, fallback) => {
    try { return action(getStorage()); }
    catch { return fallback; }
  };
  const write = (action) => {
    try { action(getStorage()); }
    catch { throw new Error('Browser storage is unavailable or full. Allow site storage or free some space, then retry.'); }
  };
  return {
    get length() { return read((storage) => storage.length, 0); },
    key: (index) => read((storage) => storage.key(index), null),
    getItem: (key) => read((storage) => storage.getItem(key), null),
    setItem: (key, value) => write((storage) => storage.setItem(key, value)),
    removeItem: (key) => write((storage) => storage.removeItem(key)),
  };
}
