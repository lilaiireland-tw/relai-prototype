# Image vocabulary jobs

Issue #103 supersedes the scheduled recovery described in the original B5.5 PRD. See [ADR: event-driven image sessions](adr/001-event-driven-image-jobs.md) for the decision and operational trade-offs.

Authenticated upload returns `202` after the D1 job and Europe/Dublin daily quota reservation. Queue messages contain only `job_id`. The consumer automatically runs `processImageJob() -> prepareVocabulary() -> saveVocabulary()`, persists results/cards, then communicates completion. Uncertain senses are skipped without manual confirmation; legacy `resolve_sense` requests return 410 and `/vocabulary/save` only replays persisted results.

Recognition contract v2 classifies `english`, `no_english`, or `unreadable` in the same image request. Bilingual material can supply English candidates; Latin spelling alone is not language evidence. Each candidate supplies contextual support as well as confidence. The request uses the validated user's stored CEFR setting, never a client level. Catalog levels order eligible senses; unknown levels remain eligible. Canonical ownership is checked in one bounded query before enrichment, and complete catalog content is reused. Full recommendation/backfill policy remains in #105.

Completed jobs persist an `outcome`: `saved`, `partial`, `no_english`, `unreadable`, `no_new_words`, or `no_reliable_words`. Empty normal outcomes create no cards and are not system errors. A batch with failed saves and no saved/already-saved result fails with `NO_CARDS_SAVED`. Invalid fresh recognition schemas fail with `INVALID_PROVIDER_OUTPUT`; unknown external outcomes retain `needs_attention` without a paid retry. Partial success retains individual `skipped`/`not_saved` reasons.

No migration is needed. Version-one recognition/provider checkpoints remain readable only for already checkpointed stages; legacy ambiguous plans/results become safe skips. Existing terminal jobs are not rewritten or reprocessed. Missing historical language metadata is never guessed as non-English or unreadable; the UI shows a neutral empty-result message.

## Session and recovery API

- `GET /relaiapp/api/v1/vocabulary/image-jobs/latest`: the authenticated user's most recently submitted job, including completed, failed and abandoned jobs, or 404 for an empty history. Uses `WHERE user_id = ? ORDER BY created_at DESC LIMIT 1` and the existing `idx_image_vocabulary_jobs_user_created` index from migration 0006. Persisted suggestions/results/cards use the existing status serializer; this read never dispatches Queue work or calls Gemini. Event-driven timeout marks stale active jobs before returning their final state.
- `GET /relaiapp/api/v1/vocabulary/image-jobs/current`: the authenticated user's active session, or 404.
- `GET /relaiapp/api/v1/vocabulary/image-jobs/:id` and `/by-key/:key`: owner-scoped persisted results; these never call Gemini.
- `POST /relaiapp/api/v1/vocabulary/image-jobs/:id/abandon`: owner-scoped, idempotent explicit abandonment. Completed/terminal jobs remain unchanged.
- Existing admin `/:id/recover` is limited to known-safe failed stages, excludes abandoned work, and refuses another active session for that user.

A single atomic INSERT/NOT EXISTS statement enforces admission across tabs/devices. Admin recovery uses the same active-session predicate. A partial user/creation index bounds these checks to active jobs. The five accepted uploads/day trigger and user/key uniqueness remain authoritative. Abandonment/failure does not refund quota. Existing historical concurrent jobs are not rewritten; new admission waits until they finish or expire.

The client waits for one task, polls only its job up to eight times with 1/2/4/8-second backoff (8-second cap), then offers explicit status-check/abandon controls. Every page opening/reload discovers the latest job from the authenticated server, including terminal states, without reading or writing localStorage for recovery. An active job resumes bounded polling; a completed job displays persisted results/cards; failed or abandoned jobs display their final state and permit a new upload. A 404 leaves the initial upload interface empty. Browser IDs/keys remain useful only for upload idempotency and uncertain upload-response lookup, not recovery correctness. No timer runs when capture is idle. A stale session expires after ten minutes from acceptance, only on a user request or delivery event. This bounds abandoned/DLQ locks without a global scanner.

## Failure semantics

| Event | Behavior |
| --- | --- |
| Queue send fails or its outcome is uncertain | Fail the unleased job, release admission, delete image best effort; late messages cannot claim it. If a consumer already claimed it, retain its fence. No scheduled outbox replay. |
| Duplicate/redelivered message | Terminal jobs are ignored; live leases suppress duplicates; known persisted provider checkpoints can resume after lease expiry. |
| Worker interruption / lost lease | Safe Queue retry may resume known stages after the four-minute lease. If no delivery remains, the user can abandon or the ten-minute event-driven timeout releases admission. |
| Provider outcome uncertain | Persist `needs_attention`, never automatically repeat a paid stage; admin replay is refused. If interruption prevented that write, a later delivery detects `provider_state = started` and parks it. |
| Queue retry exhaustion / DLQ | No automatic DLQ scanning or replay; explicit abandonment or event-driven timeout releases the session. Remote inspection/replay needs separate owner authorization. |
| Abandonment races recognition or saving | Clear the lease atomically. Provider checkpoints and source writes are fenced. Each word's catalog/card/stats batch starts with a lease assertion in the same D1 transaction; losing the fence rolls back that batch. Already committed words remain; no later words can commit. |

An already-started external request cannot reliably be cancelled or unbilled. Abandonment prevents its response from persisting or saving more cards. Immediate image deletion is attempted on completion, terminal processing failure, Queue send failure, timeout and abandonment; interrupted deletion/orphan uploads rely on lifecycle expiration.

## Manual R2 lifecycle configuration (separate approval required)

Do not execute this as part of development or PR validation. With explicit staging-specific Product Owner approval, an operator opens Cloudflare Dashboard -> R2 -> `relai-vocabulary-images-staging` -> Settings -> Object Lifecycle Rules -> Add rule. Create an enabled rule restricted to prefix `image-jobs/`, with object deletion/expiration after **1 day**. Confirm the platform's supported minimum and displayed semantics before saving; keep unrelated rules intact. Do not enable public access or change storage class. Production requires separate authorization and configuration.

[Cloudflare lifecycle documentation](https://developers.cloudflare.com/r2/buckets/object-lifecycles/) describes prefix filtering and delayed removal (typically within 24 hours of expiration, potentially longer). Expiration is not an exact deletion deadline; residual storage charges last until deletion. The ten-minute session limit is far below the one-day image retention target, so valid new processing does not depend on an image near expiry. Very old deliveries are abandoned before reading images. No lifecycle configuration was performed by this change.

## Deployment, migration and rollback

Migration `0008_image_active_sessions.sql` adds only a non-unique partial index. Migrations 0001?0007 and historical cleanup tables remain unchanged. It is necessary to avoid scanning each user's entire job history for active admission. Local D1 must apply all migrations first. Before any remote application, review this migration separately and obtain a narrowly scoped environment-specific owner approval.

Scan-risk assessment: index construction reads `image_vocabulary_jobs` once, tests each row's status, and indexes only active rows; no row copy/rebuild, deletion or ownership change occurs. Volume is the existing job ledger size (not remotely measured here); worst-case migration work is linear in ledger rows. The operator must assess historical size from approved evidence before migration. Subsequent checks seek `(user_id, created_at)` over active rows; normal new admission holds at most one active row per user. Historical active rows are handled by that user's event-driven expiry. Index maintenance adds writes only on job events.

With separate staging migration/deployment authorization: apply reviewed 0008 before deploying the built Worker. Use the repository approval wrappers and documented release workflow. Generated staging config must contain `triggers.crons: []` explicitly, consumer batch size 1 and concurrency 5. This removes any previously installed one-minute Cron on deployment. Production configuration is unchanged. No remote verification, migration, resource operation or deployment is part of this PR.

Rollback requires separate authorization: deploy a reviewed prior-compatible application with the Cron list still explicitly empty. Do not restore the old one-minute schedule unintentionally. Keep the additive index and applied migrations; do not rewrite history. Leaving the lifecycle rule enabled preserves ephemeral storage cleanup. Restoring global recovery or changing lifecycle settings requires a separate decision.
