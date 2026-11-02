# D1 row-read cost analysis (2026-11-02)

This is an offline review. Migration 0005 was not edited or run remotely, and PR
#94 was inspected read-only at head `f43c6560e33c6b6c70716d81f6dcf6f7d80c2524`.

## Migration 0005

I replayed migrations 0001–0004 and 0005 in an isolated temporary SQLite file
using Node 24 / SQLite 3.51.2. The synthetic starting data had 2,000 catalog
source rows (500 lexical keys across four levels), 500 personal vocabulary
rows, 550 flashcards and 1,000 review events. The migration completed and
preserved all source/card/review rows while reducing the canonical catalog to
1,000 rows. `EXPLAIN QUERY PLAN` was captured for each data-copy statement.
Elapsed local time is not a D1 billing estimate.

| SQL step | Local plan | Cost shape |
| --- | --- | --- |
| Rank/deduplicate `vocabulary_catalog_sources` into the new catalog | `SCAN source`; `USE TEMP B-TREE FOR ORDER BY` | One full source scan plus a sort: O(S log S). |
| Set `canonical_catalog_id` on every source row using a correlated catalog lookup | `SCAN source`; `CORRELATED SCALAR SUBQUERY`; `SCAN catalog` | A full catalog scan for each source row: O(S × C), the dominant risk. The useful catalog lookup indexes are created later in the migration. |
| Seed initial catalog versions | `SCAN vocabulary_catalog` | One full catalog scan: O(C). |
| Seed private catalog versions | `SCAN vocabulary_catalog USING INDEX idx_vocabulary_catalog_private_sense` | One pass over private entries through the partial index. |
| Copy personal vocabulary into private catalog entries | `SCAN item` | One full `user_vocabulary_items` scan: O(U). |
| Rebuild flashcards | `SCAN card`; indexed lookups into source and personal rows | Full flashcard copy plus indexed joins; old flashcard indexes are dropped and rebuilt. |
| Rebuild review events | `SCAN review_events_legacy` | Full review-event copy; its user/date index is rebuilt. |

The correlated lookup can produce millions of candidate-row visits without a
large migration file. At the synthetic scale, 2,000 source rows each scan a
1,000-row catalog (up to about two million candidate visits). Larger source and
canonical catalogs multiply. The plan is evidence of O(S × C) work, not a
measurement of D1 billed rows. Other O(N) scans and table/index copies add cost.

The migration renames and retains the old catalog as
`vocabulary_catalog_sources`, creates a deduplicated canonical catalog, and
copies/replaces `flashcards` and `review_events`. It rebuilds several catalog,
flashcard, source and review indexes. Those copies and index builds are
expected work; the unindexed correlated lookup is the preventable hotspot.
Future migrations should create a lookup index on
`(normalized_key, part_of_speech_key, sense_key)` before such a correlated
update, or use an indexed set-based mapping. Do not alter historical 0005.

Migration 0005 was applied at 17:03:53 UTC according to the supplied local
forensic evidence, aligning with the 17:03 UTC read spike. That timing plus the
query plan makes 0005 the strongest repository suspect. It does not prove that
0005 caused all approximately 30.62 million reads.

## PR #94 (read-only assessment)

The PR head proposes migration 0006, a one-minute staging scheduled handler,
Queue processing with batches of one and up to five retries, plus polling.
Local SQLite 3.51.2 plans were run on the 0006 schema with 1,000 synthetic job
rows. This does not measure Cloudflare billing.

- **Migration 0006:** three `ALTER TABLE ... ADD COLUMN ... CHECK` statements
  add JSON checks to `vocabulary_catalog`, `vocabulary_catalog_versions` and
  `vocabulary_catalog_candidates`. SQLite 3.37 and later validates a new CHECK
  constraint against every existing row, so these are three O(N) reads and
  fail if existing values violate the check. The tested local runtime is 3.51.2;
  the Cloudflare D1 runtime was not queried. See [SQLite ALTER TABLE](https://www.sqlite.org/lang_altertable.html).
- **Daily quota:** the trigger and `imageQuota()` count jobs by
  `(user_id, quota_date)`. The current plan can use the existing
  `(user_id, created_at)` index for `user_id`, but must scan that user's job
  history and filter dates. A normal new submission performs two explicit quota
  counts plus the trigger count. Add `(user_id, quota_date)` in PR #94; it makes
  the count index-bounded and covering.
- **Scheduled recovery:** `recoverImageJobs()` runs every minute in staging,
  returns at most 50 rows, and orders by `created_at`. The plan uses the dispatch
  index for the first OR branch and only the status prefix of the lease index
  for stale jobs, then sorts through a temporary B-tree. Replacing/extending the
  lease index with `(status, updated_at, lease_until, created_at)` lets the
  stale branch also constrain by `updated_at`; a local candidate index produced
  that plan. The 50-row output cap does not cap rows examined or sorted.
- **R2 cleanup lookup:** for each of at most 100 listed objects per scheduled
  run, cleanup queries D1 by `image_key`. The current plan is `SCAN
  image_vocabulary_jobs`; add a partial index on `image_key WHERE image_key IS
  NOT NULL` in PR #94. The listing requests one 100-object page without using
  its cursor, so objects beyond that page may wait indefinitely if early pages
  remain ineligible.
- **Polling:** job-by-ID uses the primary key and recovery-by-key uses the unique
  `(user_id, idempotency_key)` index. Client polling is capped at eight requests
  with exponential waits (1, 2, 4, then up to 8 seconds). A completed response
  can add up to ten card lookups. These paths are bounded; do not add more poll
  retries without a cost check.
- **Queue retries:** each delivery starts with a job read and lease update;
  later stages perform additional checkpoint reads/writes, up to ten vocabulary
  items, and up to ten card reads. Queue retries and dispatch retries are
  bounded, and unknown Gemini outcomes go to `needs_attention` rather than
  repeating a potentially billable provider call. Retries can still repeat the
  initial D1 read and lease work.
- **Unbounded admin list:** `/vocabulary/review` returns all review-needed
  candidates. It has a status/created-time index but no result limit and sorts
  by `created_at, id`. Pagination changes the API contract, so record it as a
  Product Owner decision/follow-up rather than silently changing it in this PR.

**Changes to make directly in PR #94:** add the daily quota index, index the
cleanup lookup, and replace/extend the stale-recovery index; include a short
written scan-risk note for the three checked column additions and verify local
plans after each index. Keep the existing bounded polling and retry behavior.
Do not alter PR #94 as part of this review.

## Remaining unknowns

The exact D1 row counts at migration time, the billed database, number of
migration executions, complete Query Insights statements, and concurrent
application/operator reads are unavailable offline. SQLite query plans show
algorithmic work but do not reproduce D1's physical read accounting. The
correlated 0005 lookup can explain a large portion of the spike, but the
available evidence cannot attribute the full incident to it.
