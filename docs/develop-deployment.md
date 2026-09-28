# Develop deployment — Issue #15

| Source | Wrangler environment | Worker | Binding | Database |
|---|---|---|---|---|
| `develop` | `staging` | `relai-prototype-staging` | `DB` | `relai-staging-db` |

Test app: <https://relai-prototype-staging.lilaiireland.workers.dev/relaiapp/>

Health: <https://relai-prototype-staging.lilaiireland.workers.dev/relaiapp/api/v1/health>

## Deployment ownership

**GitHub Actions is the sole automated staging deployment owner.**
`.github/workflows/deploy-staging.yml` deploys the exact triggering `develop`
commit after lint, typecheck, tests and staging build. It compares the generated
Vite configuration with the source staging D1 binding and rejects a production
Worker, extra D1 bindings, changed database ID, disabled workers.dev or custom
routes. Wrangler dry-run checks packaging before uploading. The workflow deploys
the explicit generated config, never a production build retargeted at deploy time.

Pushes to `develop` and manual dispatch on `develop` are supported. The job's ref
guard rejects manual dispatch on other branches. PR events and `main` do not
trigger deployment. One concurrency group serializes staging deployments without
cancelling an upload in progress. There are no DB migrations in this workflow.

Do not enable Cloudflare Workers Builds / Git integration for this Worker. The
Worker did not exist before the Issue #15 bootstrap; it was created with Wrangler
without connecting Workers Builds. If ownership changes later, disable the old
deployment path before enabling its replacement. Do not connect both deployers.
Manual Wrangler deployment is a bootstrap or recovery path only; coordinate it
with the Actions owner so it does not overlap an active run.

## One-time admin setup

A repository admin must configure **Settings → Environments → staging**:

1. Limit deployment branches to the branch `develop`, with no tags.
2. Add environment secret `CLOUDFLARE_ACCOUNT_ID` for the account containing the
   already-provisioned `relai-staging-db` and `relai-prototype-staging` Worker.
3. Add environment secret `CLOUDFLARE_API_TOKEN` using an account-owned API token
   with the Worker deployment permissions required by Wrangler. Scope it to the
   intended account and the staging Worker wherever supported. A workers.dev-only
   deployment needs no custom zone route permissions. Do not grant D1 management
   permissions just to deploy a Worker with an existing D1 binding.
4. Leave Cloudflare Workers Builds disconnected from the staging Worker.

Use Cloudflare's [Worker permissions](https://developers.cloudflare.com/workers/authorization/workers/)
and [GitHub Actions authentication guide](https://developers.cloudflare.com/workers/ci-cd/external-cicd/github-actions/)
when creating the token. Store it directly in GitHub's secret UI; do not paste it
in an issue, PR, chat, source file or command argument. Do not copy local Wrangler
OAuth credentials into CI. Gemini/auth secrets are not needed for this skeleton.

**Current setup limitation:** repository secret/variable inspection found no
deployment credentials on 2026-09-28. The `staging` environment was absent;
attempting to create it returned GitHub HTTP 403, “Must have admin rights to
Repository.” No GitHub environment or secret was changed. The workflow fails
explicitly if either credential is missing. The live staging smoke deployment
passed using the existing local Cloudflare login; a successful automated run is
pending admin setup and the Product Owner's merge to `develop`.

## Status, retries and verification

After setup and merge, open **Actions → Deploy staging**. Each run records the
source SHA, validation and deployment logs. After successful health verification,
the job summary and GitHub staging deployment contain the app URL. Health failure
fails the run even if the upload succeeded; inspect both Actions and the staging
Worker's Cloudflare Deployments tab. A failed health check does not roll back code.

For a retry, rerun a specific run (redeploys that run's SHA), or push a new
reviewed commit to `develop`. GitHub requires a workflow to exist on the default
branch before `workflow_dispatch` is available. This repo's default branch is
`main`, so manual dispatch is pending normal promotion of the workflow file to
`main`; this issue does not change that branch. Automatic `develop` push runs and
their reruns work after this PR is merged. See
[GitHub manual-run requirements](https://docs.github.com/en/actions/how-tos/manage-workflow-runs/manually-run-a-workflow).

Once dispatch is available, choose **Run workflow → develop** (deploys current
develop) or use the CLI. Never select `main`; the job ref guard will skip it.

```sh
gh workflow run deploy-staging.yml --repo lilaiireland-tw/relai-prototype --ref develop
gh run list --repo lilaiireland-tw/relai-prototype --workflow deploy-staging.yml
gh run view <run-id> --repo lilaiireland-tw/relai-prototype --log
gh run rerun <run-id> --repo lilaiireland-tw/relai-prototype
```

For coordinated manual recovery, start from a clean, current `develop` checkout:

```sh
npm ci
npm run lint
npm run typecheck
npm test
npm run build
npm run verify:staging-build
npx --no-install wrangler deploy --config dist/relai_prototype/wrangler.json --dry-run
npm run deploy
```

`npm run deploy` always rebuilds staging and checks its generated binding before
uploading. Do not use `--env production` on a staging build. Cloudflare environments
are selected at [Vite build time](https://developers.cloudflare.com/workers/vite-plugin/reference/cloudflare-environments/).

Verify remotely in a POSIX shell:

```sh
STAGING_URL=https://relai-prototype-staging.lilaiireland.workers.dev npm run verify:staging-health
```

Or PowerShell:

```powershell
$env:STAGING_URL = 'https://relai-prototype-staging.lilaiireland.workers.dev'
npm.cmd run verify:staging-health
```

The health script accepts only a stable staging HTTPS workers.dev origin, rejects
redirects, and requires HTTP 200, JSON content type and exactly `{"status":"ok"}`
from `/relaiapp/api/v1/health`. It retries six times, with ten-second request
timeouts and five-second delays. This checks runtime availability; it does not
check D1 tables, authentication, Gemini or product acceptance.

## Validation evidence (2026-09-28)

- Required lint, typecheck, tests (22 existing + 4 deployment tests) and staging
  build passed. Deployment tests reject production configuration, custom routes,
  invalid health responses and exhausted retries.
- Generated staging binding verification and explicit generated-config Wrangler
  dry-run passed with only `DB` -> `relai-staging-db`.
- Generated staging types confirmed `DB: D1Database` in a temporary file.
- Local Cloudflare preview routing checks passed all five checks. The sandbox
  initially blocked Wrangler's local registry; rerunning with registry access
  passed. No routing code change was needed.
- `deploy-staging.yml` passed actionlint 1.7.12 (shellcheck not installed).
- Bootstrap used a separate detached checkout of latest `origin/develop`, commit
  `536ba8d`, with locked dependencies. Wrangler 4.142.0 uploaded only
  `relai-prototype-staging`, reporting `DB` -> `relai-staging-db`.
- Bootstrap version: `a8fa280b-ef95-4f1f-839e-7eb295b2c648`.
- Live health returned HTTP 200 and `{"status":"ok"}`; `/relaiapp/` and its emitted
  JavaScript asset returned HTTP 200 with the expected content types.

No production Worker, custom route, D1 schema/data or Cloudflare resource deletion
was involved. Product acceptance and merging remain with the designated reviewers
and Product Owner. The automation itself still needs its first post-merge run.
