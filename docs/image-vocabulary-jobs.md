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

## Recovery

Safe internal delivery failures use bounded Queue retries and the D1 dispatcher. Inspect the configured DLQ and job row when a message reaches it. An administrator can retry a `failed` job through the authenticated `POST /relaiapp/api/v1/vocabulary/image-jobs/:job_id/recover` route. Jobs marked `needs_attention` are deliberately excluded: Gemini may have accepted the request without the Worker persisting its result, so replaying that provider stage could repeat a billable call. Queue delivery is at least once; the D1 lease and provider checkpoints suppress duplicate work when state is known.
