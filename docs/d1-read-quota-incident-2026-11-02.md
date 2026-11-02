# D1 read-quota incident review — 2026-11-02

## Incident and attribution

The Product Owner reports that the Cloudflare account reached its Workers Free daily limit of 5,000,000 D1 rows read on 2026-11-02, blocking staging reads. This repository review did not access Cloudflare resources or historical account analytics. The affected database, exact time window, and operation responsible therefore remain unconfirmed.

## Suspected source and evidence

Two repository-level suspects merit checking against historical analytics. Before this change, `scripts/verify-staging-d1-schema.mjs` ran `PRAGMA foreign_key_check`, a `COUNT(*)` join over flashcards and the canonical vocabulary catalog, then aggregate `COUNT(*)` queries over nine application tables. Those scans were unbounded by result limits and a read-only query can still consume row-read quota. Separately, a repeated `catalog:import --remote` could return every existing CEFR-J source row (the published 1.6 catalog has 7,801 rows) before deciding it was already imported. Neither script is proven to have run during the incident window.

The supplied local forensic evidence places Migration 0005's remote application at 17:03:53 UTC, within the read spike. Offline SQLite query plans now identify its canonical-source mapping update as a correlated full catalog scan per source row, making it the strongest repository-level suspect. This is not proof that it caused all 30.62 million reported reads. See the [offline migration and PR #94 cost analysis](d1-row-read-cost-analysis-2026-11-02.md).

Historical repository evidence shows that an operator ran `verify:d1-schema:staging` against staging on 2026-09-28; [the Issue #25 record](staging-d1-schema-25.md) documents remote D1 access and table counts. [The catalog import guide](cefr-j-catalog-import.md) documents a staging import command but provides no evidence that it was run remotely. This confirms prior verifier use and a possible importer path, not that either caused the 2026-11-02 event.

Ordinary test paths are local by construction: `test:d1-schema` passes Wrangler `--local` with temporary persistence; E2E uses a separate local config and `--local`; deployment tests inject fake fetch responses; `verify:d1-config` resolves checked-in configuration without a database query. CI runs these checks but did not previously have explicit credential stripping or egress guards. Their code does not provide evidence of millions of remote D1 rows read.

## Runtime SQL review

- `flashcards.count` runs `COUNT(*) WHERE user_id = ?`; migrations provide user-prefixed flashcard indexes.
- `review_events.countInRange` and `timestampsInRange` constrain by user and date; migrations provide `(user_id, reviewed_at)`.
- Local SQLite `EXPLAIN QUERY PLAN` regression checks confirm those count queries select their user-scoped indexes. This does not show their historical usage or guarantee a small number of index entries for a highly active user.
- The catalog import now rejects manifests larger than the published 7,801-row CEFR-J 1.6 source, caps its existing-row read at 7,802 (one overflow detector), and probes other source versions with an indexed, one-result query. These caps bound input/result rows; billed reads can differ.
- The admin-only `/vocabulary/review` endpoint returns every `review_needed` candidate. It uses `(status, created_at)` but has no result limit; candidate growth is a secondary unbounded-read risk. The manual `user:manage list` command was capped at 1,000 accounts plus a one-row overflow detector; larger lists fail without partial output. Neither path is proven to have run during the incident. Pagination for `/vocabulary/review` needs a separate product decision because it changes the API contract.
- The PR #96 checkout has no scheduled handler. PR #94, reviewed separately, proposes a one-minute staging recovery/cleanup handler; its bounded query and per-object D1 lookup risks are documented in the offline cost analysis. The staging health helper has a fixed six-request retry ceiling and is approval-gated.

## Affected command paths

- Remote reads: `verify:d1-schema:staging`, staging/production migration list and production D1 info scripts, `verify:staging-health`, `user:manage`, and `catalog:import --remote`.
- Remote writes or deployment: staging/production migration apply scripts, `deploy`, `deploy:staging:built`, and `deploy:production`.
- Routine checks now use the isolated wrappers for `npm test`, `test:d1-schema`, `test:e2e`, targeted Vitest suites, builds, local migrations, and offline configuration verification.

## Changes

- Removed `COUNT(*)`, `PRAGMA foreign_key_check`, and the linked-card scan from remote schema verification. Schema and migration metadata result sets have explicit caps; related metadata PRAGMAs are grouped into bounded requests.
- Capped the remote catalog import's source rows and existing-record result set at the published CEFR-J 1.6 size, with a one-row overflow check.
- Added a two-part owner opt-in to repository remote operator scripts and printed scan-risk estimates before execution.
- Added a Node egress guard, isolated local test runner, Playwright loopback-only route guard, empty remote credentials in CI, and a CI credential assertion.
- Documented safe local commands and the incident restriction in `AGENTS.md` and `README.md`.

## Local validation

- `npm run lint`, `npm run typecheck`, `npm test` (422 Vitest tests and 18 Node checks), `npm run test:d1-schema` (13 local tests), and `npm run build` passed.
- `npm run test:e2e` completed all 5 browser tests against local Worker/D1, but Playwright remained active after the last test on Windows and the process was interrupted (exit code 1). GitHub Actions E2E remains to confirm on its Linux runner.
- No Cloudflare or Google credentials were used. No Dashboard, remote D1, live API, migration, Queue/R2, or deploy operation was performed.

## Remaining evidence needed

With separate Product Owner approval, inspect historical Dashboard per-database row-read analytics and Worker invocation history for 2026-11-02. Compare those records with the incident window and any operator/Codex activity. Do not run a live query to recreate the event. Review runtime volume limits separately if the historical evidence points to authenticated application traffic.
