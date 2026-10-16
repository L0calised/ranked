// Anonymous public API calls. JSONP is supported by Codeforces and works
// from a static site without a third-party proxy or API credentials.
let queue = Promise.resolve();
let lastRequestAt = 0;

function enqueueRequest(action) {
  const run = async () => {
    let shared = 0;
    try { shared = Number(localStorage.getItem('ranked-cf-last-request-at')) || 0; }
    catch { /* Session-only timing remains available. */ }
    if (shared > Date.now() + 5000) shared = 0;
    const delay = Math.max(0, 2200 - (Date.now() - Math.max(lastRequestAt, shared)));
    if (delay) await new Promise((resolve) => setTimeout(resolve, delay));
    lastRequestAt = Date.now();
    try { localStorage.setItem('ranked-cf-last-request-at', String(lastRequestAt)); }
    catch { /* Do not prevent public API access when browser storage is blocked. */ }
    return action();
  };
  // Coordinate the dashboard and contest tabs when Web Locks are available.
  const request = queue.then(() => globalThis.navigator?.locks
    ? navigator.locks.request('ranked-codeforces-api', run) : run());
  queue = request.catch(() => {});
  return request;
}

function requestJsonp(method, params) {
  return new Promise((resolve, reject) => {
    const callback = `rankedCf${Date.now()}${Math.random().toString(36).slice(2)}`;
    const url = new URL(`https://codeforces.com/api/${method}`);
    Object.entries(params).forEach(([key, value]) => url.searchParams.set(key, value));
    url.searchParams.set('jsonp', callback);
    const script = document.createElement('script');
    let settled = false;
    const timeout = setTimeout(() => finish(new Error('Codeforces took too long to respond. Please try again.')), 30000);

    function finish(error, payload) {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      delete window[callback];
      script.remove();
      if (error) reject(error);
      else if (payload?.status !== 'OK') reject(new Error(payload?.comment || 'Codeforces could not complete the request.'));
      else resolve(payload.result);
    }

    window[callback] = (payload) => finish(null, payload);
    script.onerror = () => finish(new Error('Could not reach Codeforces. Check your connection and try again.'));
    script.src = url.href;
    document.head.append(script);
  });
}

export function codeforcesRequest(method, params = {}) {
  return enqueueRequest(() => requestJsonp(method, params));
}

export function codeforcesStandings(contestId) {
  if (!Number.isSafeInteger(contestId) || contestId <= 0) return Promise.reject(new Error('Invalid contest ID.'));
  return enqueueRequest(async () => {
    const response = await fetch(`/api/standings?contestId=${contestId}`, { signal: AbortSignal.timeout(30000) });
    if (!response.headers.get('content-type')?.includes('application/json')) {
      const error = new Error('The standings service is unavailable.');
      error.code = 'STANDINGS_PROXY_UNAVAILABLE';
      throw error;
    }
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.error || 'Could not load standings.');
    return payload;
  });
}
