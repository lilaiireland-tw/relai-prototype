# D1 migration workflow — Issue #22

Repository-root [`/migrations`](../migrations/README.md) is the sole ReLai v1
schema source of truth. Default, staging, and production D1 bindings explicitly
use `migrations_dir: "migrations"`. Issue #22 established the workflow; Issue #24
adds `0001_initial_core_schema.sql` for the seven PRD-defined core tables.
Legacy Supabase/Alembic migrations remain historical references and untouched.

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

With no SQL files, list/apply reports no migrations; this is expected for #22.
Do not create a dummy migration or the application schema to silence it.

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

These commands are a future release runbook, **not executed for #22**. There is
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
list/apply checks directory discovery without remote writes. No remote apply is
needed for #22. Actual SQL replay and schema smoke tests belong to future tasks.

On Windows use `npm.cmd` / `npx.cmd` if PowerShell blocks `.ps1` launchers.
Keep logs in a writable temporary path with
`$env:WRANGLER_LOG_PATH = Join-Path $env:TEMP 'relai-22-wrangler'`.

References: [Cloudflare D1 migrations](https://developers.cloudflare.com/d1/reference/migrations/)
and [Wrangler D1 commands](https://developers.cloudflare.com/workers/wrangler/commands/d1/).

## Initial core schema validation (Issue #24)

`0001_initial_core_schema.sql` creates only `users`, `sessions`, `source_items`,
`flashcards`, `review_events`, `user_stats`, and `user_settings`, matching PRD
section twelve exactly. It preserves PRD nullability, primary keys and defaults:
`role = 'user'`, `is_active = 1`, `is_favorite = 0`, the four stats counters at
`0`, and `daily_goal = 10`. No SQL timezone default is defined in the PRD.
IDs/timestamps remain supplied by future application code.

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
It reads PRD table definitions independently and compares all columns, types,
nullability, primary keys and defaults with `PRAGMA table_info`. Index metadata
checks every required index and all three unique constraints. It verifies all
seven tables are empty, migration history records one application, and a second
apply/list reports no pending migrations with schema and history unchanged.
Temporary state/logs are retained in the OS temp directory for inspection.

This test is an explicit operator command, outside `npm test`, GitHub Actions,
Cloudflare staging CD and deployment scripts. Neither remote database is accessed.
No remote migration was applied for Issue #24; normal migration safety rules still
apply to any future separately authorized release.
