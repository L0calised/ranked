# VC estimate (model v6)

## Period and reset

Official CF rating is the main rating and is displayed unchanged. The personal VC estimate starts at the latest official rating-change record's `newRating`. The period begins when that record is published (`ratingUpdateTimeSeconds`). Every later official record resets the estimate and excludes the previous period's VC adjustments, even when `newRating` is unchanged. A virtual must have started after the reset and completed its full original window to count.

There is no rolling cutoff for a user with an official rating: include all eligible virtuals since the latest reset. Users with no official rating have a provisional 14-day fallback and a broad model prior; no observable session means no invented rating.

History retains previous sessions. Their results can still be reviewed, but pre-reset adjustments do not enter the current period. Local timers and custom contests show solves, attempts, and times; they do not receive a made-up shared-field rating.

## Assessment

A complete fresh full native CF virtual is compared with available solo contestants from final public standings, joined to their pre-contest ratings through `contest.ratingChanges`. Exclude old-rating-zero opponents and require at least 25 established opponents. Use the contest's actual scoring convention, verified against official samples: a unique 10/20-minute wrong-answer penalty for ICPC-style rounds, or a supported verified time-decay rule with original maximum points for CF rounds. Compare coding scores without hack adjustments. Handle ties at their midpoint.

Invert mean Elo expected wins against the matched field to produce approximate performance. Original CF official rating is not used to manufacture the performance. Current standings can differ from the historical rated field. Instead of a hard 80% coverage cutoff, record the matched fraction and increase observation uncertainty as coverage declines. No missing scores are fabricated, and the result does not represent an official virtual placement. The comparison may still be biased by missing opponents; it is a personal estimate, not a calibrated future-rating prediction.

Replay eligible virtuals in time order from the official baseline. Baseline model SD is 200; virtual observation SD is `350/sqrt(coverage)`, increased at field boundaries. Prior variance grows by 12² per day, and posterior SD has a 100-point floor. More uncertainty reduces changes in either direction. The optional displayed range is mean minus two model SDs through mean; it is not a validated confidence interval. With zero eligible virtuals the displayed VC estimate is exactly the official baseline and no range is shown.

Earlier practice on the round or related problem versions does not block the native virtual. Only solves and attempts within that virtual’s original time window enter its score; earlier solves do not count automatically. Repeated virtual sessions, pending or provisional judging, missing original lineup, or contradictory identity/timing are excluded with an explanation. A user stopping early does not automatically discard a native virtual once its original full window ends. Sessions with no public submissions may not be observable. Reading an editorial or receiving assistance without recorded submissions cannot be detected.

## Integration and storage

Start native participation on CF itself, or use Ranked's existing local practice timer. No separate Rated registration is required on Ranked. Refresh history imports current-period native results and updates the VC estimate automatically. Recommendations keep complete source rounds; generated sets use A–E labels while submissions match original contest IDs and problem indices.

Account history is fully cached then updated incrementally. Original fields have a 24-hour bounded cache; completed native result snapshots may be reused for 15 minutes if they cover observed activity and final judging. A manual round Refresh forces a verdict fetch. Network failures retain the previous complete report. A fresh official baseline is applied for display immediately, so a failed optional VC refresh cannot retain the old period's adjustments.

The dashboard also refreshes public official rating history on connect, so a zero-delta main contest still resets the VC period. The latest official record, not merely a changed rating number, identifies the reset.

The read-only local/Vercel standings proxy remains necessary for anonymous public standings. Run `python3 server.py` locally. Browser storage and clocks can be edited, so the estimate is suitable for personal review, not an authenticated competitive leaderboard.

## References

[API methods](https://codeforces.com/apiHelp/methods), [rating and standings objects](https://codeforces.com/apiHelp/objects), [contest scoring rules](https://codeforces.com/blog/entry/4088).

Saved observations retain both their start and end times. Display applies the start-time cutoff immediately when a new official result arrives, including when that result is published during an ongoing virtual. Older derived reports are recomputed; saved sessions and submission history are retained.
