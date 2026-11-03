# ADR: Event-driven image jobs and one active recognition session

Status: proposed for Issue #103; remote rollout and final acceptance are separate.

## Decision

Keep the asynchronous Cloudflare Queue backend and unchanged automatic `processImageJob() -> prepareVocabulary() -> saveVocabulary()` pipeline. Present one synchronous task to each authenticated user. Enforce per-user admission atomically in D1, preserve idempotency keys and the five-upload daily quota, persist results before success, and reconnect without provider calls. Fence provider/source checkpoints and each vocabulary transaction against abandonment. Preserve canonical catalog rules and PR #102's 10/10, 0/10 and 6/10 contracts.

Remove the scheduled entrypoint and explicitly clear staging Cron triggers. No periodic D1 recovery, cleanup-state query/update, R2 listing or DLQ scanning remains. Retain historical tables and migrations. Replace R2 scans with immediate deletion attempts and an owner-approved manual lifecycle rule. [Operational instructions, failure matrix, migration scan-risk assessment and rollback](../image-vocabulary-jobs.md) are part of this decision.

## Trade-offs

Unfinished jobs are best effort: bounded safe redelivery can resume checkpoints, but there is no guarantee of eventual processing after interruption, uncertain dispatch or DLQ delivery. Users may abandon, and ten-minute expiry occurs on the next relevant request/event. We prefer this to paid idle recovery. Unknown external outcomes never trigger automatic paid retries. Cancellation cannot undo an external bill or already committed words. Per-word fencing preserves the existing atomic save unit instead of introducing an all-image transaction or manual save phase.

Migration 0008 adds an active-user partial index, avoiding growing per-user history scans without a new lock table or external coordinator. Existing historical active sessions are not destructively normalized. Queue batch size remains 1 and concurrency remains 5. Production settings remain unchanged.

## Cost and throughput estimate (illustrative, no live load test)

Idle cost attributable to this feature: **0 scheduled invocations, 0 periodic D1 reads/writes, 0 R2 list operations**. This removes 1,440 scheduled invocations/day and their recovery/cleanup queries and list calls. A user-triggered status check is bounded to the current user's active index and current job; it is event-driven, not idle background work. One UI polling run makes at most eight status requests; user-requested checks and reloads can add more.

Per accepted image: one short-lived R2 put/get and best-effort delete, Queue delivery, job/provider checkpoints, and up to ten word transactions. D1 result reads scale with returned card count (at most ten). Conflicting simultaneous uploads can temporarily put then delete an image before the atomic guard rejects them. The five/day quota bounds accepted images per user, not Gemini requests: recognition plus missing-content generation may require multiple provider stages.

With five consumers, approximate throughput is `5 / average job duration in seconds` images/second. At an illustrative 30 seconds/job this is about 10 images/minute; at 60 seconds it is about 5/minute, before provider limits. Provider request fan-out and account/model quotas can cause 429s below that rate. Unknown/failed provider responses are parked rather than automatically retried; do not raise concurrency without quota evidence. Residual costs include actual uploads, Queue retries/DLQ storage, D1 ledger/index growth and reads from explicit status requests, Gemini calls (including uncertain outcomes), and R2 storage until delayed lifecycle deletion. No monetary price or capacity guarantee is claimed.

## Evidence and alternatives

Local regression tests exercise simultaneous same-user admission, different users, quota/idempotency, abandonment/timeout fences, completion and safe checkpoint replay, provider uncertainty, persisted result recovery and zero scheduled/listing paths. Browser tests exercise reconnect and single-task controls. Deployment tests require an explicit empty generated Cron list. No remote Cloudflare/Gemini test or load test is authorized.

Rejected: keeping Cron recovery (idle cost), client-only locking (cross-device race), synchronous provider processing in the HTTP upload request (disconnect/timeout risk), and manual vocabulary confirmation (changes the product decision).
