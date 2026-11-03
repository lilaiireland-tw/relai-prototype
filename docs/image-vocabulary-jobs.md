# Image vocabulary jobs

Image capture returns `202` after an authenticated D1 job row and per-user Dublin-day quota reservation are committed. D1 holds the job, idempotency key, recognized suggestions, provider checkpoints, and card results. Queue messages contain only `job_id`. The staging Worker uses a private R2 binding for the temporary image and its Queue consumer plus a one-minute scheduled dispatcher for the D1 outbox and expired leases.

## Staging setup

Before enabling the Issue #93 flow in staging, an operator must create the names already declared under `env.staging` in `wrangler.jsonc`:

```sh
npm exec -- wrangler queues create relai-vocab-image-jobs-staging
npm exec -- wrangler queues create relai-vocab-image-jobs-staging-dlq
npm exec -- wrangler r2 bucket create relai-vocabulary-images-staging
```

Then inspect the staging Queue consumer and bindings in Cloudflare. The consumer uses one message per batch, five retries, and the configured dead-letter queue. Do not expose the R2 bucket publicly. The Worker deletes completed image objects and scheduled cleanup removes old orphaned or terminal objects after 24 hours.

The code and bindings are staging-only. Production requires separate Queue, DLQ, and private R2 names plus a separately reviewed production rollout; no production binding is configured by this change.

## D1 and release order

Migration `0006_durable_image_vocabulary_jobs.sql` only adds catalog usage-pattern columns, the job table/indexes, and the atomic daily-quota trigger. It does not rewrite or delete user, catalog, card, or review rows. Test it locally with the repository's migration checks. Before the staging Worker release, the Product Owner/operator must verify the staging backup and applied migration history, then apply the pending migration to `relai-staging-db` using the documented migration workflow. The Worker must not serve the new capture route until both the migration and staging Queue/R2 bindings exist. No remote migration or resource creation is part of this change.

## Query bounds and index cost

The daily quota count uses `(user_id, quota_date)`, so it seeks to one user's Dublin-day range and reads at most five reserved jobs. R2 cleanup lists at most 100 objects and performs one indexed `image_key IN (...)` lookup for the stale keys, then deletes or clears at most those 100 objects/rows. The partial image-key index contains only rows with a live key.

The one-minute recovery selection is one D1 read with two indexed branches: due outbox rows use `(status, next_dispatch_at)`; stale active jobs use the partial `(updated_at, created_at, lease_until)` index. The proposed `(status, updated_at, lease_until, created_at)` index was tested, but its leading status and lease columns required a temporary sort for the actual multi-status `ORDER BY updated_at, created_at`. The active-state partial index plus branch-local ordering and 50-row limits avoids a ledger scan and unbounded sort. Dispatch reuses the selected attempt count, avoiding a second read per selected row; follow-up writes and Queue sends are limited to the 50 returned rows.

Migration 0006 adds CHECK-constrained usage-pattern columns to `vocabulary_catalog`, `vocabulary_catalog_versions`, and `vocabulary_catalog_candidates`. SQLite validates those constraints against existing rows, so application cost is a linear read across those three tables, with no table rebuild or row copy. Remote row counts were not queried under the Cloudflare safety restriction; the migration operator should assess current table sizes before applying it. The new job ledger is empty when its indexes are created, so its initial index build is negligible. As jobs accrue, quota, live-image-key, and active-recovery indexes add logarithmic write maintenance; the two partial indexes store only eligible rows. Migration 0005 is unchanged and is not rerun.

## Recovery

Safe internal delivery failures use bounded Queue retries and the D1 dispatcher. Inspect the configured DLQ and job row when a message reaches it. An administrator can retry a `failed` job through the authenticated `POST /relaiapp/api/v1/vocabulary/image-jobs/:job_id/recover` route. Jobs marked `needs_attention` are deliberately excluded: Gemini may have accepted the request without the Worker persisting its result, so replaying that provider stage could repeat a billable call. Queue delivery is at least once; the D1 lease and provider checkpoints suppress duplicate work when state is known.
