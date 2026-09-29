# Develop deployment — Issue #15

| Source | Environment | Worker | Binding | Database |
|---|---|---|---|---|
| `develop` | `staging` | `relai-prototype-staging` | `DB` | `relai-staging-db` |

Test app: <https://relai-prototype-staging.lilaiireland.workers.dev/relaiapp/>

Health: <https://relai-prototype-staging.lilaiireland.workers.dev/relaiapp/api/v1/health>

## Deployment ownership

**The repository-approved automated staging deployment owner is Cloudflare
Workers Builds / Git integration.** Verify its live connection and build status
in the Cloudflare Dashboard. GitHub Actions runs only the existing PR quality checks in
`.github/workflows/ci.yml`. No Actions workflow deploys this environment, and no
GitHub staging environment or deployment secrets are required.

The repository supplies two commands for Cloudflare:

- `npm run build:staging:validated`: lint, typecheck, tests, staging build and
  generated staging binding verification.
- `npm run deploy:staging:built`: recheck the generated config, Wrangler packaging
  dry-run, deploy that build and verify live health. It does not rebuild or retarget
  a production build.

Both use the locked local Wrangler. The config check rejects a production Worker,
wrong/extra D1 bindings, disabled workers.dev, custom routes and an inherited
`CLOUDFLARE_ENV`. The health check
requires HTTPS on the stable staging workers.dev origin, HTTP 200, JSON content
type and exactly `{"status":"ok"}` at `/relaiapp/api/v1/health`. It rejects redirects
and retries up to six times with ten-second timeouts and five-second delays.
Health checks runtime availability, not schema, auth, Gemini or product acceptance.

## Product Owner Dashboard settings

Use these settings when auditing or reconnecting the existing staging Worker.
Check the current Cloudflare build history for live connection status.

1. Sign in to the Cloudflare account containing `relai-staging-db`. Open
   **Workers & Pages → relai-prototype-staging → Settings → Builds → Connect**.
   Reuse the existing Worker. [Connecting an existing Worker](https://developers.cloudflare.com/workers/ci-cd/builds/#connect-an-existing-worker).
2. Select GitHub. As the repository owner or an authorized GitHub App administrator,
   install/authorize **Cloudflare Workers and Pages** for
   `lilaiireland-tw/relai-prototype`. Choose that repository in Cloudflare.
   [GitHub access](https://developers.cloudflare.com/workers/ci-cd/builds/git-integration/github-integration/#manage-access).
3. Enter the settings below before saving the connection. In **Settings → Build(s)
   → Branch control**, confirm the deployment branch is `develop` and uncheck
   **Enable Preview Builds**. The field labelled **Production branch** means this
   Worker's active deployment branch; it must be `develop` for the staging Worker.
   [Branch controls](https://developers.cloudflare.com/workers/ci-cd/builds/build-branches/).

| Dashboard setting | Required value |
|---|---|
| Git repository | `lilaiireland-tw/relai-prototype` |
| Git / Production branch | `develop` |
| Preview builds | Disabled |
| Root directory | Repository root (`/`) |
| Build command | `npm run build:staging:validated` |
| Deploy command | `npm run deploy:staging:built` |
| Build variable `STAGING_URL` | `https://relai-prototype-staging.lilaiireland.workers.dev` |
| Build variable `NODE_VERSION` | `24` |

Do **not** set `CLOUDFLARE_ENV` in Cloudflare Builds variables or secrets. Remove
any existing value before saving or retrying a build. `npm run build` invokes
Vite in staging mode; `vite.config.ts` selects the named staging environment
inside that build process and emits a flattened
`dist/relai_prototype/wrangler.json` named `relai-prototype-staging`.
`npm run deploy:staging:built` starts a separate Wrangler process against that
generated config. If it inherits `CLOUDFLARE_ENV=staging`, Wrangler can target
`relai-prototype-staging-staging`. The predeploy verifier fails before the dry run
or deploy when the variable is present. Do not pass `--env staging` to a deploy
of the flattened config.

4. Under **Build Variables and Secrets**, set only the two plain build variables
   in the table. Use Cloudflare's Builds API-token selection for deployment
   authentication. Keep credentials in Cloudflare; do not copy local OAuth tokens
   into source or GitHub. [Build settings](https://developers.cloudflare.com/workers/ci-cd/builds/configuration/),
   [Node version selection](https://developers.cloudflare.com/workers/ci-cd/builds/build-image/).
5. Save or inspect the connection and inspect a build. Confirm its source is a
   merged `develop` SHA, the Worker is `relai-prototype-staging`, and deployment
   logs list only `DB` → `relai-staging-db`. Confirm its final health check passed
   and open the test app URL. If connection starts a build before branch settings
   are finalized, cancel it and retry only after `develop` and previews are correct.

No setup step targets `relai-prototype`, `relai-prod-db`, production routes or
production promotion. Do not add a second Actions deployment workflow.

## Status and retries

Cloudflare build history exposes the source commit and build/deploy logs. Its
GitHub check run links back to build details. Open the staging Worker's Builds
history to inspect or retry a failed build, using the same reviewed settings.
[GitHub build checks](https://developers.cloudflare.com/workers/ci-cd/builds/git-integration/github-integration/#check-run).
Pushes to `develop` trigger Builds after connection; feature branches and `main`
do not build this Worker while preview builds are disabled.

Deployment followed by failed health verification fails the command but does not
roll back code. Inspect the staging Worker's Deployments tab and logs before
retrying. Coordinate any manual recovery with Workers Builds to avoid overlapping
deployments. Manual recovery is an operator action, not a second automated owner:

```sh
# From a clean, current develop checkout, with a local Cloudflare login:
npm ci
unset CLOUDFLARE_ENV
npm run build:staging:validated
STAGING_URL=https://relai-prototype-staging.lilaiireland.workers.dev npm run deploy:staging:built
```

For read-only health verification in PowerShell:

```powershell
$env:STAGING_URL = 'https://relai-prototype-staging.lilaiireland.workers.dev'
npm.cmd run verify:staging-health
```

For manual recovery in PowerShell, remove the inherited variable before running
the build and deploy commands:

```powershell
Remove-Item Env:CLOUDFLARE_ENV -ErrorAction SilentlyContinue
npm.cmd run build:staging:validated
$env:STAGING_URL = 'https://relai-prototype-staging.lilaiireland.workers.dev'
npm.cmd run deploy:staging:built
```

Environment selection happens at [Vite build time](https://developers.cloudflare.com/workers/vite-plugin/reference/cloudflare-environments/).
Deploy `dist/relai_prototype/wrangler.json` after verifying it. Do not attempt to
retarget a staging build with `--env production`. D1 migrations are separate
operator actions.

## Historical validation evidence

- Staging safety and health tests cover wrong Worker/D1/route settings, invalid
  health responses and exhausted retries; they need no remote credentials.
- The original bootstrap remains valid: a separate checkout of latest
  `origin/develop` at `536ba8d` deployed using Wrangler 4.142.0 and only
  `DB` → `relai-staging-db` on 2026-09-28.
- Bootstrap version: `a8fa280b-ef95-4f1f-839e-7eb295b2c648`. Live health returned
  HTTP 200 with `{"status":"ok"}`; the app and its JavaScript asset returned HTTP
  200 with the expected content types. This deployment is not undone.
- Review revision removes the Actions deployer and its GitHub-specific output
  hooks; CI remains unchanged. `npm run build:staging:validated` passed lint,
  typecheck, 22 existing tests, four deployment tests, staging build and generated
  binding verification. Explicit generated-config dry-run listed only
  `DB` → `relai-staging-db`; the revised live health script passed.

The evidence above records the original bootstrap and review-time checks. It does
not establish current Dashboard connection or deployment status. Inspect the
Cloudflare Builds and Deployments tabs for the current state.

## Accidental Worker from password-onboarding validation

The intended staging Worker is **`relai-prototype-staging`**. A separate,
unintended **`relai-prototype-staging-staging`** Worker was created during Issue
#50 validation. The source `wrangler.jsonc` names only the intended staging Worker
and `relai-prototype` for production. `npm run verify:staging-build` checks the
generated deployment name and D1 binding; the deployment guard rejects the
accidental name. No repository build or deploy command targets the extra Worker.

The Product Owner can remove only the accidental Worker after reviewing its
identity in the correct Cloudflare account:

1. Run `npm run verify:d1-config`, `npm run build`, and
   `npm run verify:staging-build` locally. Confirm the generated Worker name is
   `relai-prototype-staging` and `DB` points to `relai-staging-db`.
2. Run these **read-only** queries and compare their names and deployments:

   ```sh
   npx wrangler deployments list --name relai-prototype-staging-staging --json
   npx wrangler deployments list --name relai-prototype-staging --json
   ```

   In **Workers & Pages**, open both exact names and verify the intended Worker
   owns the stable staging URL, Git connection and current `develop` deployments.
   Stop if the names, account or ownership are ambiguous.
3. As the Product Owner, delete only `relai-prototype-staging-staging` in its
   Dashboard **Settings → Delete Worker** action, or run this exact command after
   reviewing the target:

   ```sh
   npx wrangler delete --name relai-prototype-staging-staging
   ```

   Do not add `--env staging` or use the repository's default Worker name. Never
   target `relai-prototype-staging`, `relai-prototype`, or either D1 database.
   Codex does not perform this deletion. See the
   [Cloudflare Wrangler Worker delete reference](https://developers.cloudflare.com/workers/wrangler/commands/workers/#delete)
   for the `--name` option.
