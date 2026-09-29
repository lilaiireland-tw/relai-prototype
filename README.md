# ReLai

ReLai is a Closed Beta learning prototype for Taiwanese learners of English in Ireland. Its goal is to turn learners' own vocabulary and mistakes into useful review cards. The current learning screens use mock data while real product persistence is the next phase.

## Current application

- React, TypeScript, Vite, React Router and Tailwind CSS serve the browser app at `/relaiapp/`.
- One Cloudflare Worker serves the static app and a Hono API on the same origin. The API namespace is `/relaiapp/api/v1/*`.
- The implemented API provides health and authentication endpoints. Health reports Worker availability, not D1 or product readiness.
- Cloudflare D1 holds the current schema and authentication data. Only user and session repositories are implemented; cards, reviews, stats and settings in the UI are mock backed or placeholders.
- Gemini is the planned AI provider. AI ingestion and offline/PWA features are not implemented.

## Closed Beta authentication

There is no public signup. An operator provisions accounts with `npm run user:manage`; interactive creation accepts a temporary password and the existing noninteractive option generates a random password. New accounts have `must_change_password` set. On first login, the app routes them to `/relaiapp/change-password` and keeps product routes closed until they choose a new password. Authenticated users can change their password later from Settings.

The Worker uses an opaque seven day `HttpOnly`, `SameSite=Lax` session cookie, with `Secure` on HTTPS. D1 stores password salts and digests and a digest of each session token, never plaintext passwords or raw tokens. The browser keeps authentication state in memory; passwords and tokens are not stored in `localStorage` or `sessionStorage`. This closed beta credential scheme is described in [auth crypto](docs/auth-crypto.md); see the [auth API](docs/auth-session-api.md) and [account runbook](docs/admin-accounts.md) for exact behavior. Authentication uses a server secret `AUTH_PEPPER`; never expose it to the client.

## Environments and schema

| Branch | Worker | D1 binding `DB` |
| --- | --- | --- |
| `develop` / staging | `relai-prototype-staging` | `relai-staging-db` |
| `main` / production | `relai-prototype` | `relai-prod-db` |

`wrangler.jsonc` is the source for Worker names and D1 IDs. Vite selects the environment at build time; the default development and build commands select staging. The databases are separate. Root `migrations/` is the sole schema source of truth and contains `0001_initial_core_schema.sql` and `0002_add_users_must_change_password.sql`. Migration application is an explicit operator action, separate from CI and deployment. Repository contents alone do not establish which remote migrations or deployments are currently live. See [D1 environments](docs/d1-environments.md) and [migration workflow](docs/d1-migrations.md).

## Repository layout

```text
src/client/          React pages, auth state, API client and mock product data
src/worker/          Hono API, auth, session middleware and D1 repositories
migrations/          Append-only D1 SQL migrations
scripts/             Account CLI, verification tools and their tests
docs/                Current operator and developer runbooks
public/              Static routing configuration
wrangler.jsonc       Worker and D1 environment bindings
vite.config.ts       Vite base path and Cloudflare build selection
ReLai_PRD_v3.1.md   Product requirements and later-phase design
```

See [repository structure](docs/structure.md) for the current modules and their responsibilities.

## Development and validation

Use Node.js 24 and run commands from the repository root:

```sh
npm ci
npm run dev
npm run lint
npm run typecheck
npm test
npm run build
npm run test:routing
```

Open `/relaiapp/` in the Vite dev server. `GET /relaiapp/api/v1/health` returns `{"status":"ok"}` when the Worker responds. Local development uses simulated D1. Focused checks include `npm run test:auth-api`, `npm run test:admin`, `npm run test:persistence`, and `npm run test:d1-schema`.

For authorized account operations, supply the matching `AUTH_PEPPER` through a protected process environment and follow [account management](docs/admin-accounts.md). Interactive staging creation starts with:

```sh
npm run user:manage -- create --interactive --env staging
```

Do not use real accounts or remote databases for routine local validation.

## Delivery

GitHub Actions runs PR quality checks only. The repository-approved staging workflow assigns automated deployment from `develop` to Cloudflare Workers Builds, with `npm run build:staging:validated` and `npm run deploy:staging:built` as its commands. The latter deploys the verified staging build and checks health. The repository does not establish whether the live Cloudflare Dashboard Git connection is currently active; inspect its Builds and Deployments tabs for status. Production deployment remains a protected manual release path from `main`. D1 migrations are separately reviewed operator actions and are never applied by the CI or staging deploy commands. See [develop deployment](docs/develop-deployment.md) for configuration and the staging Worker cleanup procedure.

## Roadmap status

- Platform and runtime: complete.
- D1 foundation and closed beta auth: complete.
- Temporary password onboarding: complete.
- Next product phase after this maintenance PR is merged: real cards, reviews, stats and settings persistence.
- Later phases: Gemini ingestion and PWA/offline support.

For product behavior, use [the PRD](ReLai_PRD_v3.1.md). For implementation and deployment, use this README and the linked runbooks. Task scope comes from the assigned GitHub Issue.
