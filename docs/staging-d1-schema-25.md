# Staging initial schema evidence — Issue #25

Executed on 2026-09-28 from `feat/25-apply-staging-d1-schema`, based on latest
`develop` commit `3bcc88233afab51392c484baa21cb1c25dd5db4c` (merged #24 / PR #28).
No migration SQL was added or changed. The only committed application migration
was `migrations/0001_initial_core_schema.sql`; its SHA-256 at application was
`E2EE461AB7AC655C093449023D65F926DE6FEDA9E955F613B0F3EBB84B9CFBB5`.

## Target and preflight

Installed Wrangler: **4.142.0**. `whoami` confirmed OAuth authentication for
`lilaiireland@gmail.com`, account `622900d9297cd7c09cad966aaae64617`, with
`account (read)`, `workers (write)` and `d1 (write)` among its scopes.
Credentials remained in protected Wrangler configuration; no token was printed
or committed. The exact staging UUID returned by `d1 info` matched the server-side
source binding in `wrangler.jsonc`. Source resolution confirmed
`relai-prototype-staging`: `DB -> relai-staging-db`, with root `migrations/`.

Commands below were run from the repository root in Windows PowerShell:

```powershell
$env:WRANGLER_LOG_PATH = Join-Path $env:TEMP 'relai-25-wrangler'
$env:WRANGLER_SEND_METRICS = 'false'
npx.cmd wrangler whoami
$env:CLOUDFLARE_ACCOUNT_ID = '622900d9297cd7c09cad966aaae64617'
npx.cmd wrangler d1 info relai-staging-db --config wrangler.jsonc --env staging --json
npm.cmd run verify:d1-config
Get-ChildItem migrations/*.sql
(Get-FileHash migrations/0001_initial_core_schema.sql -Algorithm SHA256).Hash
npx.cmd wrangler d1 execute relai-staging-db --config wrangler.jsonc --env staging --remote --command "SELECT type, name, tbl_name, sql FROM sqlite_schema ORDER BY name" --json
npx.cmd wrangler versions list --config wrangler.jsonc --env staging --json
npx.cmd wrangler deployments list --config wrangler.jsonc --env staging --json
npx.cmd wrangler versions view 164afc0a-dff0-438b-b39d-e789e5c1f170 --config wrangler.jsonc --env staging --json
```

Initial `d1 info`: `name = relai-staging-db`, `num_tables = 0`,
`database_size = 12288`, region WEUR. The read-only `sqlite_schema` inspection
returned only Cloudflare's `_cf_KV` table: no application tables and no
`d1_migrations` history yet. Its metadata reported `changes = 0`,
`changed_db = false`, `rows_written = 0`. Thus comparison with the single
committed migration established the pending application migration before any
migration-list command could initialize tracking metadata.

The live deployment `1eb0a048-51e2-472f-9bc7-c2ea8c9cae6d` served version
`164afc0a-dff0-438b-b39d-e789e5c1f170` at 100%. That version's only D1 binding
was `DB`, whose `database_id` matched the exact source staging UUID.

## Local validation before application

```powershell
npm.cmd run test:d1-schema
npm.cmd run lint
npm.cmd run typecheck
npm.cmd test
npm.cmd run build
```

All passed. The schema integration check used fresh local persistence, verified
exact PRD columns/types/nullability/defaults/primary keys, required indexes and
uniqueness, empty tables, and migration history. Second local apply/list reported
no migrations pending and left schema/history unchanged. Shared assertions now
also reject missing index coverage, lost username uniqueness and unexpected
history using altered copies of local metadata, with no additional DB writes.
`npm test` passed 22 Vitest tests, four deployment tests, and offline binding
checks. Build selected staging only. A test-only `structuredClone` lint error
was corrected and lint rerun successfully before remote apply.

## Migration application and repeat check

```powershell
npm.cmd run db:migrations:list:staging
npm.cmd run db:migrations:apply:staging
npm.cmd run verify:d1-schema:staging
npm.cmd run db:migrations:list:staging
```

The list/apply scripts explicitly expand to installed Wrangler commands:

```text
wrangler d1 migrations list relai-staging-db --config wrangler.jsonc --env staging --remote
wrangler d1 migrations apply relai-staging-db --config wrangler.jsonc --env staging --remote
```

Before application, the list reported **only `0001_initial_core_schema.sql`**.
Wrangler 4.142.0's list calls `CREATE TABLE IF NOT EXISTS` for migration tracking;
this metadata initialization followed the read-only preflight above. A PowerShell
guard initially treated a single filename as a scalar and stopped before apply;
wrapping the matches in `@(...)` corrected that guard. The rerun again verified
exactly one expected pending filename and the reviewed SQL hash before apply.
There was no unexpected account, target, environment or migration.

The apply output identified the remote `relai-staging-db` UUID matching the
source staging binding and reported:

```text
About to apply 1 migration(s)
Using fallback value in non-interactive context: yes
Executed 15 commands in 2.58ms
0001_initial_core_schema.sql | success
```

The final remote list reported **`No migrations to apply!`**. No second remote
apply was needed. Remote history was exactly:

| id | name | applied_at (UTC) |
|---|---|---|
| 1 | 0001_initial_core_schema.sql | 2026-09-28 14:11:36 |

This matches the sole committed SQL migration, with no extra history entries.

## Remote schema and binding verification

`verify:d1-schema:staging` uses only `d1 info`, Worker deployment/version reads,
`SELECT` and read-only `PRAGMA` metadata commands. It accepts no arguments,
requires the verified account ID, resolves source config with explicit staging,
compares the remote DB identity with that binding, and verifies the active
deployment's D1 binding. It never runs migration list/apply or accepts custom SQL.
All SQL response metadata must report `rows_written = 0` and
`changed_db = false`. It remains an explicit operator command, outside ordinary
tests, CI/CD and deploy scripts.

All seven tables matched exact PRD columns/defaults/nullability/keys and had
`COUNT(*) = 0`: `users`, `sessions`, `source_items`, `flashcards`,
`review_events`, `user_stats`, `user_settings`. No unapproved views, triggers or
foreign keys were found. Verified required index metadata:

| Table | Index | Columns in order | Unique |
|---|---|---|---|
| users | sqlite_autoindex_users_2 | username | yes |
| sessions | sqlite_autoindex_sessions_2 | token_digest | yes |
| sessions | idx_sessions_user_id | user_id | no |
| sessions | idx_sessions_expires_at | expires_at | no |
| flashcards | idx_flashcards_user_id_created_at | user_id, created_at | no |
| flashcards | idx_flashcards_user_id_card_type | user_id, card_type | no |
| flashcards | idx_flashcards_user_id_last_reviewed_at | user_id, last_reviewed_at | no |
| flashcards | idx_flashcards_user_id_is_favorite | user_id, is_favorite | no |
| review_events | idx_review_events_user_id_reviewed_at | user_id, reviewed_at | no |
| review_events | sqlite_autoindex_review_events_2 | client_event_id | yes |

Primary-key autoindexes were also present for all seven tables. The verifier
confirmed the same active deployment/version and `DB -> relai-staging-db` after
application. Source config was unchanged; the normal staging build also retained
the staging binding. Remote verification printed its table/index/history evidence
and exited successfully.

## Safety and limitations

No production remote command or production environment command was run. Offline
configuration checks resolve both source environments to prove isolation but do
not contact either database. No Worker deployment, seed users/application data,
drop/reset/recreate, resource deletion, Dashboard schema edits, automatic
migrations, query layer, Auth, API or Gemini changes were made.

The verifier requires empty application tables for this initial migration task;
future seeded staging checks must adapt that expectation under a separate issue.
PRD headings/format and Wrangler's unstable resolver API remain test contracts.
Account ID is pinned in the staging verifier and must be deliberately reviewed
if the account changes. Existing Node punycode deprecation warnings do not affect
validation. These are implementation verification results for review, not final
product acceptance.
