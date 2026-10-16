# Custom practice contests

Recent full Codeforces rounds remain the first recommendation. If none remain, try a complete custom set from recent rounds before using the older archive. The search order is recent full round, recent custom set, older full round, then a custom set allowing older sources. No framework, database, API key, or dependency is required.

The dashboard also has a **Create custom contest** button beside the automatic contest search. It requests a custom set directly, even when full rounds remain. Each click refreshes history and avoids custom tasks already offered during this visit. It tries recent sources first, then permits older sources if necessary. A failed generation keeps the current recommendation available. The button is disabled during a search/import and while a local contest is scheduled or active.

## Selection

- Five tasks, one per source round, with a fixed 120-minute duration.
- Finished standard Codeforces/Educational rounds only; rated programming problems only.
- Recent means the last two calendar years. Try a complete recent set first, and allow older sources only as a final fallback. Prefer recent problems within a mixed-age pool and label sets that include older sources.
- Exclude pure Div. 1 sources below a user rating of 2100. Combined/open rounds remain eligible when task difficulty fits. See [division preferences](plan.md) for the app's heuristic, which is separate from official CF eligibility.
- Use the official rating rounded to the nearest 100, or 1000 for an unrated user. Clamp the target to 800–3500.
- Target difficulties are the baseline plus −300, −100, +100, +300, and +500, each clamped to 800–3500. Allow a maximum difference of 200 from each target and require nondecreasing selected difficulty.
- Within an age group, prefer a closer difficulty, then a suitable division and newer source round. This is a practice heuristic, not a calibrated performance model. Age never changes the reported solve count or a problem's stored rating.
- Exclude any recorded attempt, manually excluded source tasks and related versions, and every problem from earlier local sessions that have started, even if no submission was made. Repeated generation also excludes custom tasks offered earlier in this visit.
- Match related names after removing qualifiers such as “Easy Version”, “Hard Version”, and other named versions. Avoid related names within one set as well as those found in earlier attempts.
- Use a bounded search of up to 100 candidates per slot and 20,000 visits. Backtrack when an early choice blocks later slots. If no complete set is found within the search, keep the current recommendation and display the reason; never fill missing slots with seen or unsuitable tasks.

Names cannot prove that two tasks are unrelated. Missing names, missing public submissions, and familiarity without submissions remain unknown. The user can exclude an individual familiar problem, then generate a complete replacement set. A preview containing a manual exclusion cannot be prepared until it is restored or replaced. Source problems in the same round remain eligible when they are unrelated. Search bounds may miss a feasible combination in an unusually constrained archive.

Manual exclusions are reversible on the **Excluded problems** page, with filtering, individual restore, and Restore all. They are stored per handle on this device. Earlier bulk custom-set choices migrate to individual source records; the retired whole-round hiding preference is no longer used. Restoring a preference does not erase actual submissions or played-session exposure.

## Identity and tracking

The recommendation has a synthetic `custom:` ID derived from its source problem keys. It is not a Codeforces contest ID. Labels A–E are local positions; the original source contest ID and problem index remain on each problem and result. Multiple original A problems therefore remain distinct.

Prepare the custom contest from its recommendation, choose a local start time, and schedule it. At the saved start, the page reveals the source links and begins the fixed timer. Submit in Codeforces practice mode. This does not register virtual participation or create a CF mashup.

Preparation retains earlier familiarity from the synced full history. Baseline and subsequent refreshes fetch fresh `user.status` pages back through the draft's creation time, including all submissions in the waiting and active windows. Paging keeps overlap and rejects inconsistent timestamps. It usually needs one page; heavy activity or an old draft may require more. Each refresh revisits the complete window to pick up judging changes, rather than stopping at previously known IDs.

Scoped history snapshots carry `sinceSeconds`. They are not persisted as whole-account history, and a whole-account import cannot use them as its stopping boundary. Result matching keeps source tasks and any related-name records needed for familiarity, and counts only correctly identified solo practice submissions within the saved contest window.

Closing the page preserves the chosen start and deadline. Early end fixes a cutoff. Results and sessions stay in this browser, alongside regular local sessions. Existing regular-round records continue to load without new labels or result source IDs.

## Rating and later work

Custom sessions currently report solves, attempts, verdicts, solve times, and prior exposure. No skill rating is calculated, and there is no artificial score penalty for being a custom set. Generator version, target difficulties, source IDs, and selected problem ratings are retained for future calibration.

Trusted timing, server storage, performance calibration, and explicit uncertainty must come before rating these sessions. Guided CF mashup creation/linking is a separate future feature.
