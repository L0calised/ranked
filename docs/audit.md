# Project review — 2026-10-17

## Current scope and architecture

This is a personal Codeforces practice companion: choose a complete untouched round, generate a five-problem custom set, solve on CF, and review timed results. A personal VC estimate starts at the latest official rating and resets after every new official rated result. There is no separate rated registration, lifetime second rating, or calibrated custom-contest rating.

The existing architecture fits this scope. Keep vanilla HTML/CSS/JavaScript modules, IndexedDB for large history/benchmark caches, localStorage for small session/report records, and the read-only standings proxy. No framework rebuild, external database, authentication service, or background worker is needed for this version.

## Fixes from this review

- Saved VC observations now include their start time. A virtual crossing a new official reset cannot briefly enter the new period through the cached display. Derived report version 5 invalidates older reports; saved sessions and submission history remain intact.
- Invalid opponent coverage cannot produce a nonnumeric rating.
- IndexedDB saves read and update within one transaction. Partial histories cannot replace complete histories. Concurrent complete snapshots retain previously observed submissions and prefer newer verdicts.
- Saved custom contests use the same related-version familiarity matching as new recommendations. An attempt on an easy/hard variant rules out preserving that familiar custom selection as fresh.
- Starting the Python server on an occupied port now gives a direct instruction and an alternate port instead of a traceback. Invalid port input is also handled.
- Added regression checks for rating reset overlap, invalid observations, concurrent history writes, and both backend implementations.
- Browser asset URLs were updated together so existing pages can load the fixes after refreshing.

## Efficiency and data flow

- The first account import scans accessible submission history with overlapping pages; later refreshes stop at a verified complete boundary. Partial/scoped caches cannot establish that boundary.
- Recommendation selection groups problems by contest. Custom selection has bounded search and keeps original source identities. Up to three full-round choices appear by default; switching within that batch makes no API request.
- CF requests are queued and spaced by at least 2.2 seconds within the browser. Web Locks coordinate tabs where supported.
- Only native virtuals in the current official-contest period are automatically assessed. Official results supply reset points without downloading/replaying their entire fields.
- Browser benchmark cache: 24-hour expiry, up to 48 fields. Local proxy cache: 24-hour expiry, up to 24 fields. Vercel responses request shared cache storage for 24 hours.
- Completed native snapshots can be reused for 15 minutes when they cover observed submissions and final judging. Manual round Refresh retrieves fresh verdicts. Active local sessions poll only while visible.
- Custom/local results remain practice results with solves, attempts, verdicts, and times. They are not assigned an invented shared-field rating.

## Verification

Commands:

```sh
npm run check
node --test --test-isolation=none
python3 -m unittest discover -s tests -p '*_test.py' -v
```

The JavaScript suite has 145 passing tests. The Python suite has four passing local-server integration tests. Both proxy implementations were checked for request validation, compact official results, upstream errors, and cache behavior. Python integration tests mock upstream CF responses and bind only a temporary loopback port.

Isolated Firefox scenarios use controlled CF API fixtures and a fresh browser profile:

- Connecting automatically offers three full rounds with their entire lineups and direct CF links.
- Switching choices makes no API calls; selection survives reload; Find more offers another batch.
- Custom generation selects five different source rounds; scheduling persists across reload; countdown activates at the saved time.
- Source-aware custom solve tracking and early finish preserve results.
- History automatically imports native virtuals and updates the VC estimate.
- A new official result resets the estimate even when its rating delta is zero; the reset survives reload and appears on the dashboard.
- Failed API refreshes show an error and retain saved rating/history.
- Individual exclusions can be restored; missing sessions show a recovery message.
- Separate IndexedDB store instances preserve complete histories and newer verdicts across competing writes.
- Dashboard, history, contest, and exclusions pages fit the checked 390-pixel viewport; history-table scrolling stays contained.
- The final desktop screenshot was visually inspected: square panels, readable text, restrained blue actions, and all three default contest choices.

No Codeforces submissions or account changes are performed by these checks. Temporary servers and browser processes are cleaned up; an existing user server is left alone.

## Practical limits

All personal data is stored in the current browser/device. Clearing site storage removes it; there is no cross-device sync. Local timers use the device clock. A native virtual without submissions may not be detectable. Reading editorials or prior off-platform familiarity cannot be inferred from API data.

VC performance is an approximate comparison with available original opponents, not an official virtual rank or validated forecast. Missing/contradictory timing, familiarity, pending verdicts, and unsupported scoring are explained rather than assigned fabricated performance. The displayed range is cautious-to-main, not a statistical confidence interval.

The browser tests reproduce contest flows with fixtures; they do not replace playing a real contest over its full duration. Vercel deployment, production concurrency, and future API availability were not validated in this review. This version is suitable for the agreed personal-use scope.
