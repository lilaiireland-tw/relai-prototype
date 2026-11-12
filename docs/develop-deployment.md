# Develop deployment — Issue #108

**Framework only: automatic delivery is disabled.** `staging-release.json` ships
with `enabled: false` and no confirmed schema digest. This PR does not authorize
activation, Dashboard changes, remote API calls or deployment. AC1 requires later
Product Owner activation and on-site acceptance.

| Source | Worker | D1 | R2 |
|---|---|---|---|
| Protected `develop` | `relai-prototype-staging` | `relai-staging-db` (`41ead93a-40f6-4016-b49c-df00a18e86da`) | `relai-vocabulary-images-staging`, EU |

Production (`main`, `relai-prototype`, `relai-prod-db`) remains manual and unchanged.
GitHub Actions is only the PR quality gate. Cloudflare Workers Builds / Git
integration is the **sole** staging automatic deployer; do not add Actions CD or
create another Worker.

## Authorization and limits

After separate PO activation, the AGENTS.md standing exception covers only Builds
publishing reviewed `develop` merge commits to this existing staging Worker, with
its reviewed existing bindings, followed by at most six GETs to
`https://relai-prototype-staging.lilaiireland.workers.dev/relaiapp/api/v1/health`.
It never permits D1 SQL, schema reads or migrations, Queue/R2 data/resource
operations, other API paths, production, local Codex or arbitrary GitHub workflows.
Manual deployment and health scripts still require explicit per-action PO approval
and both existing operator opt-ins. Do not permanently set
`RELAI_REMOTE_CLOUDFLARE_APPROVAL` in Builds or CI.

`WORKERS_CI` and the local validation receipt are **not authentication**. Cloudflare
[documents that injected variables can be overridden](https://developers.cloudflare.com/workers/ci-cd/builds/configuration/#default-variables).
The actual boundary is the reviewed Builds connection to the exact repository,
Worker and protected branch, disabled previews, restricted Dashboard administration,
and a dedicated deployment token that is never available to local Codex or PR CI.
Repository guards cannot inspect Dashboard branch controls or prove token scopes
without remote calls; they make no such claim.

Cloudflare's [default generated token](https://developers.cloudflare.com/workers/ci-cd/builds/configuration/#api-token)
has broad permissions. Before enabling, PO must review a dedicated Builds-only
user token for the intended account with only the permissions necessary to publish
this Worker with its existing D1/EU R2/Queue bindings. Do not grant D1 SQL/migration,
R2 object access, route edits or production access as a convenience. Cloudflare may
only offer account-level Workers Scripts edit rather than per-Worker token scope;
**do not claim a per-Worker IAM guarantee**. If the available scope/role permits
unacceptable production or resource operations, keep the gate disabled until PO
accepts that platform limitation or provisions a sufficiently isolated account.
Do not expand token permissions to make a failed build pass without PO review.

## Product Owner activation checklist

These are future operator steps, not authorization for Codex to execute them.

1. Inspect the existing staging Worker's Git integration and last failed build in
   Dashboard. Confirm the intended account and existing Worker. If disconnected,
   plan a one-time connection to that Worker; do not create a second staging Worker.
2. Protect `develop` on GitHub: require PRs, human review, current passing
   `Repository quality checks` and `Playwright E2E` checks before merge, and block
   direct pushes/bypass. A Builds environment variable cannot prove a merge was
   reviewed. Confirm untrusted feature/PR code cannot obtain the Builds token.
3. Before any enabling merge, stop/disconnect automatic Builds triggers and cancel
   queued/running builds. Keep delivery held while auditing settings and schema.
4. Separately authorize any required staging migrations using the
   [D1 runbook](d1-migrations.md); never auto-apply them. PO must confirm the entire
   repository migration history is current in staging, including previously added
   migrations, and confirm code/schema compatibility. No remote query is part of
   auto delivery. No table scans are implied by this confirmation.
5. Compute the complete local migration digest (names and contents, not a commit
   diff) in a clean Linux checkout matching Builds (`core.autocrlf=false`) with
   this credential-cleared, network-isolated command. The digest covers raw bytes;
   a Windows checkout with converted line endings produces a different digest
   and safely holds release. Do not copy that converted digest into the baseline.

   ```sh
   node --import ./scripts/deny-remote-network.mjs --input-type=module -e "import { directoryDigest } from './scripts/staging-build-record.mjs'; console.log(directoryDigest('migrations'))"
   ```

   In a separately reviewed activation PR, set `staging-release.json` to
   `{"enabled":true,"migrations":"<confirmed 64-character digest>"}`. PO approval
   must explicitly adopt the scoped standing delivery policy. Merge only while
   Builds is stopped. A digest is a recorded human assertion, not proof of live
   schema. Schema drift outside repository migrations requires an immediate hold.
6. Audit the following settings under **Workers & Pages → relai-prototype-staging
   → Settings → Builds**. [Connect an existing Worker](https://developers.cloudflare.com/workers/ci-cd/builds/#connect-an-existing-worker),
   [branch controls](https://developers.cloudflare.com/workers/ci-cd/builds/build-branches/),
   [build configuration](https://developers.cloudflare.com/workers/ci-cd/builds/configuration/).

| Setting | Required value |
|---|---|
| Worker | Existing `relai-prototype-staging` |
| GitHub repository | `lilaiireland-tw/relai-prototype` |
| Production/deployment branch | `develop` (this is the staging Worker's active branch) |
| Preview builds | Disabled |
| Root | `/` |
| Build command | `npm run build:staging:validated` |
| Deploy command | `npm run deploy:staging:auto` |
| `NODE_VERSION` | `24` |
| `STAGING_URL` | `https://relai-prototype-staging.lilaiireland.workers.dev` |
| `CLOUDFLARE_ACCOUNT_ID` | Intended staging account ID |
| Authentication | Dedicated, reviewed Builds deployment API token selection |
| `CLOUDFLARE_ENV` | Absent |
| `RELAI_REMOTE_CLOUDFLARE_APPROVAL` | Absent |

Do not manually override `WORKERS_CI`, `WORKERS_CI_BRANCH`,
`WORKERS_CI_COMMIT_SHA` or `WORKERS_CI_BUILD_UUID`. These come from Builds. Ensure
the selected deployment token is supplied as `CLOUDFLARE_API_TOKEN` to the deploy
command; never print it or copy it into GitHub, local shells, source or chat.
Runtime `AUTH_PEPPER` and `GEMINI_API_KEY` must already exist on the staging Worker;
keep them out of build variables and the bundle. `secrets.required` is retained so
missing runtime secrets cause deployment failure. No command creates secrets.

7. Only after PO approves all checks, reconnect/resume Builds and run the reviewed
   current `develop` SHA. Inspect the build link/check run, commit SHA, Wrangler
   target/bindings, version and health result. PO performs AC1 acceptance. Verify
   feature and main pushes cannot trigger this Worker. Nothing here authorizes
   production changes or product acceptance by Codex.

## Local build and deployment behavior

`build:staging:validated` first clears the previous validation receipt, then runs
lint, typecheck, all tests, staging build, deployment config preparation and
config verification. Each routine child clears credentials, isolates cached
Wrangler state and blocks non-loopback Node access under #95. Only complete
success records the checkout SHA, Builds UUID, artifact digest and complete
migration digest in ignored `.wrangler/staging-validated.json`.

`deploy:staging:auto` accepts no arguments. It requires Workers Builds on develop,
the matching full checkout SHA, build UUID, clean tracked checkout, explicit
account/token, exact staging URL, enabled release policy, confirmed migration
digest and unchanged successful build receipt. It rejects Actions, inherited
`CLOUDFLARE_ENV` and the generic operator approval variable. It rechecks the exact
Worker/D1/EU R2, staging queues, no Cron/custom routes and required secret names,
then consumes the receipt **before** the packaging dry run and deployment. It
uses the locked local Wrangler against the flattened config with no `--env` flag,
so it cannot append `-staging` again. No migration command runs.

The dispatcher has only dry-run, staging publish and bounded health steps. It
never retries deployment. Successful publication logs the full SHA, Builds UUID
and the account's staging Builds history URL; use the UUID to open the exact build
and retain its permalink with release evidence. Wrangler logs include the deployed
version. A health failure after publish fails the build but does not undo publish;
the SHA/build link is logged before health so the failure remains traceable.
Health requires HTTPS, no redirects, HTTP 200 and exactly `{"status":"ok"}` JSON,
at most six attempts with ten-second timeouts and five-second delays. It checks no
D1 schema, auth, Gemini or product behavior.

## Schema changes, failures and rollback

- A migration added, removed, renamed or modified anywhere in the complete set
  invalidates the confirmed digest, including migrations from earlier commits.
  Automatic delivery stops before remote dispatch. Never update the digest merely
  to satisfy CI: schema readiness requires PO confirmation and separately approved
  migration work. For schema-changing PRs, first pause/cancel Builds, merge a hold
  (`enabled: false`) and plan a compatible release with PO. After local migration
  validation, separately authorized remote application and PO confirmation, use a
  reviewed PR to update the digest and resume delivery. Also hold for schema drift
  or compatibility changes not represented by a new migration.
- CI/build failures never create a fresh receipt. Guard/config failures stop
  before deployment. Packaging failure consumes the receipt and does not publish.
  A second deploy invocation in the same build is rejected. A deliberate Dashboard
  retry must rerun the full validated build to create a new receipt; it may publish
  the same SHA again. No remote deduplication query or global exactly-once claim is
  made. Cancel superseded/overlapping builds and confirm newest develop SHA before
  retry; a stale in-flight build must not overwrite a later deployment.
- To stop release immediately, PO disables/disconnects Builds and cancels pending
  and running builds, then submits a hold PR (`enabled: false`). A hold commit
  cannot cancel code already running in an older build. Revoke the dedicated token
  if delivery authorization is withdrawn. Keep previews disabled throughout.
- On bad code or failed post-publish health, stop Builds first and inspect its logs
  and deployment history. Prefer a reviewed revert PR to protected develop followed
  by validated delivery once PO confirms schema compatibility. An emergency
  Dashboard rollback/manual recovery requires separate staging authorization; do
  not merge, rollback, deploy or change resources as routine diagnosis. Worker
  rollback does not roll back D1 data or schema. See
  [Cloudflare rollback limits](https://developers.cloudflare.com/workers/versions-and-deployments/rollbacks/).

Manual recovery remains `npm run build:staging:validated` followed by
`npm run deploy:staging:built -- --approve-remote-cloudflare`, with the explicit
per-run `RELAI_REMOTE_CLOUDFLARE_APPROVAL=I_UNDERSTAND_REMOTE_CLOUDFLARE_COSTS_AND_IMPACT`
and `STAGING_URL` set by the separately authorized operator. Unset
`CLOUDFLARE_ENV`; never deploy the flattened config with `--env staging`. Coordinate
with stopped Builds to avoid two deployers. `verify:staging-health` also retains
both operator opt-ins. Local guard tests use mocks and no live Cloudflare resources.

Existing staging observability/logs/invocation logs remain enabled. Do not log
passwords, session tokens/cookies, secrets or sensitive learning content. The
previous unintended `relai-prototype-staging-staging` Worker was removed by PO;
this change must never recreate it. Historical deployment evidence in prior Git
revisions does not establish current Dashboard connection or schema readiness.
