# Ranked

A small personal Codeforces practice companion:

- Find a suitable untouched full round, preferring recent Div. 2, then Div. 3, then Div. 4 rounds.
- Generate a five-problem custom contest from different source rounds.
- Solve and submit on Codeforces, then review solves, attempts, times, and an approximate virtual-contest performance.
- Keep a VC estimate between official contests. It starts at your latest official CF rating and resets after every new official rated contest.

## Run

```sh
python3 server.py
```

Open http://localhost:4173. No dependency installation or API keys are needed. Stop any old server already using this port first. The server includes a read-only standings proxy needed for performance comparisons; `python3 -m http.server` cannot provide that route.

## Use

1. Connect your public Codeforces handle.
2. Up to three suitable full rounds appear automatically after connecting. Choose one, or choose **Create custom contest**. Switching between the offered rounds needs no extra API calls. Find more contests refreshes history and offers another batch.
3. For a full round, start native virtual participation on Codeforces. Alternatively, schedule a local practice timer on Ranked. Custom sets use the same local timer and original CF problem links.
4. Return to **History → Refresh history**. Native virtual results since your latest official contest are imported automatically. Local/custom sessions open on their own contest page to sync submissions and review results.

There is no separate rated registration on Ranked. Opening a CF link does not start a virtual; CF's own participation screen still controls that. For local sessions, the saved scheduled time controls the countdown and duration, including after closing/reopening the page.

## Results and VC estimate

Official CF rating is displayed unchanged. The VC estimate starts at the latest official result's new rating, then updates from eligible full native virtuals started afterward. A new official result resets it, including an official contest with zero rating change. Old virtuals stay in History but their adjustments do not carry into the new period. Users without an official rating get a provisional estimate from the last 14 days of observable virtuals.

Performance compares the timed coding result with available original rated opponents. ICPC-style wrong-answer penalties are detected from official samples; CF point conventions are validated before use. Partial opponent coverage gives a less certain result with less influence on the VC estimate; missing opponents are not assigned fabricated scores. The value is approximate, not an official rating prediction or official virtual rank. The optional range beside it is a cautious-to-main estimate, not a validated confidence interval.

Repeated/familiar problems, pending verdicts, contradictory timing, and unusable scoring evidence do not affect the estimate. All observable solves remain reviewable. Local timers and custom sets show practice results; no calibrated rating is invented for a mixed set without an original shared field.

## Storage and efficiency

- Account submission history is paginated fully once and then refreshed incrementally in IndexedDB, so earlier attempts remain available for familiarity checks. Transactional saves protect complete history from partial or older writes in another tab.
- Original contest fields are cached for 24 hours in a bounded IndexedDB cache. Completed virtual result snapshots can be reused for 15 minutes; per-round Refresh forces fresh verdicts.
- Only native virtuals in the current official-contest period are automatically assessed. Official contests are reset points; the app no longer downloads their whole rated fields or maintains a second lifetime rating.
- Sessions, preferences, and calculated reports stay on this browser/device. No login or cross-device database is required. Browser records are not trusted competitive evidence.

## Files

```text
index.html / app.js            Handle, full-round recommendation, custom generation
contest.html / contest.js      Scheduling, countdown, timer, problem links, results
history.html / history-page.js Session history, automatic import, VC estimate/reset
excluded.html / excluded.js   Restore manually excluded problems
styles.css                    Plain responsive UI
server.py                     Local site and read-only standings proxy
api/standings.js              Equivalent Vercel endpoint
src/                          API, selection, generation, history, scoring, storage
src/skill-service.js           Current VC period and cached performance assessment
src/skill-rating.js            Score comparison and VC updates
```

Vercel can serve the static files and `api/standings.js` together using the Other framework preset without a build step. A framework migration is not needed for the current scope.

## Checks

```sh
npm run check
node --test --test-isolation=none
python3 -m unittest discover -s tests -p '*_test.py' -v
```

Tests use fixtures and do not submit anything on Codeforces. See [the audit](docs/audit.md) for current verification and limits, [generation details](docs/custom-contests.md), and [VC calculation details](docs/skill-rating.md).
