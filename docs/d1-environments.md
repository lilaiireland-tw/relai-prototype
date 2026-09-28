# D1 environment provisioning — Issue #14

| Branch | Wrangler environment | Worker | Binding | Database |
|---|---|---|---|---|
| `develop` | `staging` | `relai-prototype-staging` | `DB` | `relai-staging-db` |
| `main` | `production` | `relai-prototype` | `DB` | `relai-prod-db` |

Database IDs belong only in the server-side source configuration, `wrangler.jsonc`.
The top-level/default binding is staging. Named environments repeat their bindings
explicitly because D1 bindings are not inherited. Neither binding enables remote
local development. Never swap the names/IDs or share a database between environments.

## Provisioning commands used

On 2026-09-28, inspected `wrangler.jsonc`, then listed the authenticated account's
D1 resources. Neither ReLai database existed. The two existing
`lilai-applications-*` databases were left untouched. Created each ReLai database
once using Wrangler 4.142.0; both were placed in WEUR by Cloudflare's default
placement. No location or jurisdiction restriction was specified.

```sh
npx wrangler --version
npx wrangler d1 list --json
npx wrangler d1 create relai-staging-db --env staging --update-config=false
npx wrangler d1 create relai-prod-db --env production --update-config=false
npx wrangler d1 info relai-staging-db --config wrangler.jsonc --env staging --json
npx wrangler d1 info relai-prod-db --config wrangler.jsonc --env production --json
npx wrangler d1 execute DB --config wrangler.jsonc --env staging --remote --command 'SELECT 1 AS connectivity_ok' --json
npx wrangler d1 execute DB --config wrangler.jsonc --env production --remote --command 'SELECT 1 AS connectivity_ok' --json
```

The create commands deliberately disabled automatic config updates; bindings were
added explicitly under the correct environments. During provisioning, Wrangler
warned that staging was not yet configured and production did not yet have a
binding. Final configuration resolves both environments without those warnings.
On Windows PowerShell, `npx.cmd` / `npm.cmd` were used when script execution policy
blocked the `.ps1` launchers (the initial list used `npx`). Local checks set
`WRANGLER_LOG_PATH` to a temporary directory to avoid writing outside the workspace.

**Do not rerun creation blindly.** List first and reuse each exact existing name.
If a matching name cannot be resolved unambiguously, stop and investigate. Never
delete/recreate a database to resolve configuration problems.

## Build and configuration verification

```sh
npm run lint
npm run typecheck
npm test
npm run verify:d1-config
npm run test:routing
npm run build
npm run build:production
npx wrangler deploy --dry-run
npm run build
npx wrangler deploy --dry-run
npx wrangler types "$env:TEMP/relai-14-env.d.ts" --config wrangler.jsonc --env staging --include-runtime=false
```

`verify:d1-config` uses Wrangler's resolver with explicit source config, checking
default/staging names and IDs, the production name, distinct IDs, separate Worker
names, and local simulation. It runs with `npm test` and needs no Cloudflare token.
The type-generation command above uses PowerShell's temporary path and confirmed
`DB: D1Database` without committing generated runtime declarations.

Vite uses the staging mode for default dev/build commands, and the production mode
only for `build:production`. Vite config sets `CLOUDFLARE_ENV` from that mode and
rejects conflicting environment selection. Its generated deployment configuration
is a snapshot of the selected binding at build time. Do not try to switch an
existing build with `wrangler deploy --env ...` or an environment variable set
only at deployment time. See Cloudflare's [environment documentation](https://developers.cloudflare.com/workers/vite-plugin/reference/cloudflare-environments/).

Inspect `dist/relai_prototype/wrangler.json` after each build: staging must contain
Worker `relai-prototype-staging` and `DB` -> `relai-staging-db`; production must
contain Worker `relai-prototype` and `DB` -> `relai-prod-db`. Generated server
configuration is ignored by Git. Neither ID nor either database name may appear
in `dist/client`. Dry runs show the selected D1 resource without deploying it.

## Migration source of truth (Issue #22)

All D1 bindings explicitly point to repository-root `migrations/`. This directory
is the v1 schema source of truth; legacy Supabase/Alembic SQL is not used.
See [D1 migration workflow](d1-migrations.md) for exact create/list/apply commands,
append-only rules, local persistence, and the explicit manual production runbook.
Local operations use simulated D1; staging operations explicitly name
`relai-staging-db` with source config and `--env staging --remote`. Production
migration is an approved operator release action only. No migrations run through
GitHub Actions, Cloudflare staging CD, or ordinary develop build/deploy commands.
Issue #22 adds no SQL/application schema and applies no production migration.

## Deployment selection (commands documented, not executed)

From `develop`, `npm run deploy` rebuilds staging before deploying. From `main`,
`npm run deploy:production` rebuilds production before deploying. Branch-to-environment
selection is an operator rule; Git alone does not select bindings. No CD workflow,
route/domain configuration, or actual Worker deployment was added in this issue.

## Validation evidence and safety

- Lint, typecheck, all 22 existing tests, configuration verification, and both
  environment builds passed.
- The existing routing preview smoke test passed all 5 checks. Preview uses the
  generated build binding without attempting to reselect a named environment.
- Independent `d1 info` responses confirmed the exact names and distinct IDs;
  each database had zero application tables and size 12,288 bytes.
- Both explicit `DB` connectivity queries returned `connectivity_ok: 1`, with
  `changes: 0`, `changed_db: false`, and `rows_written: 0`.
- Both generated Worker configurations and dry-run bindings matched the table.
- Client output was checked for database identifiers and secret configuration;
  none was present. Commit contents contain no secret values or local credentials.

No application tables, schema migrations, user/application data writes, production
seeds, authentication, Gemini integration, or legacy PostgreSQL changes were made.
No existing Cloudflare resource was deleted or recreated. The runtime health
endpoint is unchanged and does not expose database details. Connectivity checks
remain operator-only read-only CLI commands.

Known limitations: application schema and queries remain future work. Production
routing and deployment automation are outside this issue. Wrangler's resolver API
used by the check is marked unstable and may need adjustment on a Wrangler upgrade.
