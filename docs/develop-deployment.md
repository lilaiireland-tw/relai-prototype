# Develop deployment — Issue #15

| Source | Environment | Worker | Binding | Database |
|---|---|---|---|---|
| `develop` | `staging` | `relai-prototype-staging` | `DB` | `relai-staging-db` |

Test app: <https://relai-prototype-staging.lilaiireland.workers.dev/relaiapp/>

Health: <https://relai-prototype-staging.lilaiireland.workers.dev/relaiapp/api/v1/health>

## Deployment ownership

**Cloudflare Workers Builds / Git integration is the single automated staging
deployment owner.** GitHub Actions runs only the existing PR quality checks in
`.github/workflows/ci.yml`. No Actions workflow deploys this environment, and no
GitHub staging environment or deployment secrets are required.

The repository supplies two commands for Cloudflare:

- `npm run build:staging:validated`: lint, typecheck, tests, staging build and
  generated staging binding verification.
- `npm run deploy:staging:built`: recheck the generated config, Wrangler packaging
  dry-run, deploy that build and verify live health. It does not rebuild or retarget
  a production build.

Both use the locked local Wrangler. The config check rejects a production Worker,
wrong/extra D1 bindings, disabled workers.dev and custom routes. The health check
requires HTTPS on the stable staging workers.dev origin, HTTP 200, JSON content
type and exactly `{"status":"ok"}` at `/relaiapp/api/v1/health`. It rejects redirects
and retries up to six times with ten-second timeouts and five-second delays.
Health checks runtime availability, not schema, auth, Gemini or product acceptance.

## Product Owner Dashboard setup

Perform this setup **after the revised PR is merged to `develop`**, so its commands
exist on the selected branch. The connection has not been performed by Codex.

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
| Build variable `CLOUDFLARE_ENV` | `staging` |
| Build variable `STAGING_URL` | `https://relai-prototype-staging.lilaiireland.workers.dev` |
| Build variable `NODE_VERSION` | `24` |

4. Under **Build Variables and Secrets**, set the three plain build variables in
   the table. Use Cloudflare's Builds API-token selection for deployment
   authentication. Keep credentials in Cloudflare; do not copy local OAuth tokens
   into source or GitHub. [Build settings](https://developers.cloudflare.com/workers/ci-cd/builds/configuration/),
   [Node version selection](https://developers.cloudflare.com/workers/ci-cd/builds/build-image/).
5. Save the connection and inspect the first build. Confirm its source is the
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
npm run build:staging:validated
STAGING_URL=https://relai-prototype-staging.lilaiireland.workers.dev npm run deploy:staging:built
```

For read-only health verification in PowerShell:

```powershell
$env:STAGING_URL = 'https://relai-prototype-staging.lilaiireland.workers.dev'
npm.cmd run verify:staging-health
```

Environment selection happens at [Vite build time](https://developers.cloudflare.com/workers/vite-plugin/reference/cloudflare-environments/).
Deploy `dist/relai_prototype/wrangler.json` after verifying it. Do not attempt to
retarget a staging build with `--env production`. No D1 migration is in this task.

## Validation evidence and remaining setup

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

The Product Owner still needs to authorize/connect the GitHub App in Cloudflare
and complete the first Workers Builds run after merge. Local packaging and the
existing live smoke deployment do not prove that the Dashboard connection works.
