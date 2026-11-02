# D1 migration workflow — Issue #22

Repository-root [`/migrations`](../migrations/README.md) is the sole ReLai v1
schema source of truth. Default, staging, and production D1 bindings explicitly
use `migrations_dir: "migrations"`. The committed history contains migrations
`0001` through `0005_canonical_sense_aware_vocabulary.sql`.
Check remote migration history before code that depends on a migration is deployed.

`0004_normalize_vocabulary_ownership.sql` resets prototype flashcards, reviews,
stats and selected levels rather than backfilling disposable learning data. It
must only be applied remotely through a separately approved staging operation.
Because the old and new Worker schemas are incompatible, coordinate the migration
with deployment of the Worker that expects the new schema; do not leave the old
Worker running against the migrated database.

## B5.4 canonical vocabulary migration (0005)

`0005_canonical_sense_aware_vocabulary.sql` is append-only and is designed for
a database that has already applied 0001–0004. Do not rerun or edit 0004: its
historical prototype reset is not part of this migration. 0005 preserves users,
sessions, source/onboarding records, settings, stats, favorites, flashcards,
review events, the original CEFR-J rows and legacy personal vocabulary. It
archives the old CEFR-J rows in `vocabulary_catalog_sources`, adds a
canonical-to-source mapping, and rebuilds flashcards with only a canonical
catalog reference plus user learning state. Legacy personal cards map to private
`review_needed` catalog records so their content is retained without claiming a
verified shared sense.

The existing Worker schema is incompatible with the rebuilt `flashcards` and
`vocabulary_catalog` tables. Schedule the staging migration together with the
matching Worker release; an old Worker must not continue serving writes against
the new schema. Never apply this migration from routine build, CI or deploy
commands.

### Staging operator procedure

This is an operator runbook only. It was not executed as part of Issue #91; no
remote D1 write is authorized by the PR.

1. Select the reviewed commit intended for staging. Verify the authenticated
   Cloudflare account and confirm `relai-staging-db` and its exact database ID
   using [D1 environments](d1-environments.md). Confirm remotely that 0001–0004
   are applied and 0005 alone is pending:

   ```sh
   npm run verify:d1-config
   npx wrangler d1 info relai-staging-db --config wrangler.jsonc --env staging --json
   npm run db:migrations:list:staging
   ```

2. Take a recoverable, access-controlled D1 backup/export using the approved
   Cloudflare operator procedure. Do not put the export or credentials in the
   repository. Restore a copy into an isolated local D1 and rehearse 0005 there;
   compare pre/post counts and representative IDs/content for users, sessions,
   source_items, settings, stats, old source catalog rows, personal vocabulary,
   cards, favorites and review events. Run `PRAGMA foreign_key_check` on the copy
   and confirm every vocabulary card joins a catalog entry. The committed local
   migration preservation test can be run with `npm run test:d1-schema`.

3. Coordinate a staging maintenance window because the old and new Worker
   schemas are not mutually compatible. Reconfirm the target, pending SQL and
   backup before the explicit write:

   ```sh
   npm run db:migrations:apply:staging
   npm run db:migrations:list:staging
   ```

4. Deploy the matching reviewed Worker build immediately after migration, then
   run `npm run verify:d1-schema:staging` and authorized staging smoke checks.
   Verify 0005 is recorded exactly once, all vocabulary cards resolve to catalog
   entries, and favorites, review history, stats, settings and source/onboarding
   records retain their pre-migration values. Record the commit, backup reference,
   migration and verification evidence. If migration or verification fails, stop;
   do not delete rows or repair the schema with ad hoc Dashboard SQL.

Run all commands from the repository root with the installed Wrangler. Each
command selects the database name, source config and environment explicitly.
Do not use generated `dist` configuration: a previous Vite build must not select
the migration target. Migration history is append-only: never edit, rename,
reorder or delete committed/applied SQL; fix it with a new migration. Wrangler
records applied filenames in `d1_migrations`; preserve that history.

## Local workflow

For a future assigned schema task:

```sh
npm run verify:d1-config
npm run db:migrations:create -- describe_change
# Edit and review the generated SQL, then:
npm run db:migrations:list:local
npm run db:migrations:apply:local
npm run db:migrations:list:local
npm run dev
```

Equivalent commands:

```sh
npx wrangler d1 migrations create relai-staging-db describe_change --config wrangler.jsonc --env staging
npx wrangler d1 migrations list relai-staging-db --config wrangler.jsonc --env staging --local
npx wrangler d1 migrations apply relai-staging-db --config wrangler.jsonc --env staging --local
```

`create` writes a local, sequentially numbered SQL file only. Resolve numbering
conflicts before merging. `--local` uses simulated D1 in `.wrangler/state`, shared
with `npm run dev`, and never accesses a remote database. Stop the dev server
before applying; smoke-test the assigned change locally and commit its SQL before
remote apply. Repeated apply should report no remaining migrations.

Do not create a dummy migration to silence a list/apply result.

## Explicit staging operation

Use the reviewed commit intended for staging. Verify the authenticated account
and exact database ID against [D1 environments](d1-environments.md) before writes.
Remote operations require account access with D1 write permission; credentials
stay in protected Wrangler login/token configuration, never committed or logged.

```sh
npm run verify:d1-config
npx wrangler d1 info relai-staging-db --config wrangler.jsonc --env staging --json
npm run db:migrations:list:staging
# Review pending SQL and target relai-staging-db before explicitly running:
npm run db:migrations:apply:staging
npm run db:migrations:list:staging
```

The staging scripts expand to:

```sh
npx wrangler d1 migrations list relai-staging-db --config wrangler.jsonc --env staging --remote
npx wrangler d1 migrations apply relai-staging-db --config wrangler.jsonc --env staging --remote
```

Staging migration is an operator action separate from deployment. Never add it
to GitHub Actions, Cloudflare Workers Builds, or ordinary develop build/deploy
commands. Coordinate explicit apply before deploying code that requires the
schema, checking compatibility with the currently running Worker. Wrangler may
skip its confirmation prompt in noninteractive shells; do not rely on that prompt
for environment safety.

## Production: explicit manual release only

These commands are a manual release runbook. There is
no production migration package script or CI/CD hook. Deployment alone never
applies migrations.

1. Obtain Product Owner authorization for the production release. Check out the
   approved `main` release commit; confirm its SQL passed local/staging checks.
   Review pending SQL, schema compatibility and a recovery plan.
2. Verify the authenticated account and exact production ID from source config.
   Stop if the target mapping is ambiguous or incorrect.

   ```sh
   npm run verify:d1-config
   npx wrangler d1 info relai-prod-db --config wrangler.jsonc --env production --json
   npx wrangler d1 migrations list relai-prod-db --config wrangler.jsonc --env production --remote
   ```

3. After release approval and target review, manually run:

   ```sh
   npx wrangler d1 migrations apply relai-prod-db --config wrangler.jsonc --env production --remote
   npx wrangler d1 migrations list relai-prod-db --config wrangler.jsonc --env production --remote
   ```

4. Record release commit, applied filenames and outcome. Check the schema before
   the separately authorized production deployment. On failure, stop and inspect;
   earlier successful migrations may remain applied. Never delete resources,
   rewrite migration history or silently repair schema with Dashboard SQL.

Never bind develop to `relai-prod-db`, production to `relai-staging-db`, or apply
production migrations during develop deployment or routine validation.

## Validation without production mutation

```sh
npm run lint
npm run typecheck
npm test
npm run build
npx wrangler d1 migrations create --help
npx wrangler d1 migrations list --help
npx wrangler d1 migrations apply --help
npm run db:migrations:list:local
npm run db:migrations:apply:local
```

The config check resolves every binding offline and checks the root migration
directory and distinct database IDs. CLI help checks command support; local
list/apply checks directory discovery without remote writes. Remote apply is not
part of ordinary validation. Use `npm run test:d1-schema` for local SQL replay.

On Windows use `npm.cmd` / `npx.cmd` if PowerShell blocks `.ps1` launchers.
Keep logs in a writable temporary path with
`$env:WRANGLER_LOG_PATH = Join-Path $env:TEMP 'relai-22-wrangler'`.

References: [Cloudflare D1 migrations](https://developers.cloudflare.com/d1/reference/migrations/)
and [Wrangler D1 commands](https://developers.cloudflare.com/workers/wrangler/commands/d1/).

## Initial core schema validation (Issue #24)

`0001_initial_core_schema.sql` creates only `users`, `sessions`, `source_items`,
`flashcards`, `review_events`, `user_stats`, and `user_settings`. Later migrations
add the PRD password-change state and CEFR-J catalog, level and linkage columns.
The initial migration preserves its original nullability, primary keys and defaults:
`role = 'user'`, `is_active = 1`, `is_favorite = 0`, the four stats counters at
`0`, and `daily_goal = 10`. No SQL timezone default is defined in the PRD.
IDs/timestamps are supplied by application code, not SQL defaults.

SQLite's unique indexes for `username`, `token_digest` and `client_event_id`
satisfy their required lookup indexes. Seven explicit indexes cover the other
PRD access patterns, including composite column order. No extra foreign keys,
cascades, enum checks, triggers, timestamp generators or seed data are added.

Run the explicit local integration check from the repository root:

```sh
npm run test:d1-schema
```

Each run allocates a fresh temporary persistence directory, proves the database
has no application schema, and applies with the installed Wrangler using only
`relai-staging-db --config wrangler.jsonc --env staging --local --persist-to`.
It reads current PRD table definitions, including the Issue #47 approved
`users.must_change_password INTEGER NOT NULL DEFAULT 0` column, and compares all columns, types,
nullability, primary keys and defaults with `PRAGMA table_info`. Index metadata
checks every required index and all three unique constraints. It verifies all
application tables are empty, migration history records each committed migration once, and a second
apply/list reports no pending migrations with schema and history unchanged.
Temporary state/logs are retained in the OS temp directory for inspection.

Issue #63 extends this local test with the empty CEFR-J A1–B2 catalog, nullable
`user_settings.english_level`, and flashcard catalog/normalized-key linkage.
It checks allowed levels, uniqueness, nullable enrichment and per-user dedupe.
The new migration does not import vocabulary or apply to remote D1.

This test is an explicit operator command, outside `npm test`, GitHub Actions,
Cloudflare staging CD and deployment scripts. Neither remote database is accessed.
The local schema test does not apply remote migrations. Follow the operator
workflow above for a separately authorized release.

## Initial staging application (Issue #25)

The reviewed `0001_initial_core_schema.sql` was applied to `relai-staging-db`
on 2026-09-28. See [exact commands and verification evidence](staging-d1-schema-25.md).
Use the explicit read-only verifier after authenticating and selecting the
documented ReLai account with `CLOUDFLARE_ACCOUNT_ID`:

```sh
npm run verify:d1-schema:staging
```

It checks remote identity, active staging Worker binding, exact PRD schema,
required indexes/unique constraints, empty application tables and committed
migration history. It never applies migrations and is not part of CI/CD.
