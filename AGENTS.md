# ReLai Codex Engineering Rules

## 1. Source of Truth

Before implementation, consult the following sources in order:

1. `AGENTS.md`
2. Assigned GitHub Issue
3. `README.md`
4. `ReLai_PRD_v3.4.md`

Read the relevant sections needed for the assigned task. Avoid repeatedly reading unchanged documents or loading entire documents when targeted sections are sufficient.

If documents conflict, use the following authority:

- **Product requirements:** PRD
- **Infrastructure and implementation:** README
- **Task scope and acceptance criteria:** Assigned GitHub Issue
- **Engineering workflow and safety:** AGENTS.md

If a conflict materially affects implementation, report it before proceeding. Do not silently override explicit requirements.

---

## 2. Engineering Philosophy — Ponytail

Use the installed Ponytail skill when available.

**Preferred mode: `full`.**

Follow these principles:

- Implement the smallest complete solution that satisfies the assigned Issue.
- Understand affected code paths before modifying them.
- Reuse existing components, utilities, repositories, APIs, and established patterns.
- Prefer existing platform capabilities and installed dependencies.
- Avoid speculative features, unnecessary abstractions, wrappers, configuration, and future-proofing.
- Avoid introducing dependencies when existing code or platform features can solve the problem.
- Keep changes focused, readable, and maintainable.
- Prefer simple implementations without sacrificing correctness.
- Preserve security, validation, accessibility, error handling, and data integrity.
- Add targeted tests for non-trivial logic and regression risks.

Do not sacrifice correctness merely to reduce code size, execution time, or token usage.

Project-specific requirements and safety rules take precedence over conflicting optimization suggestions.

Do not automatically invoke Ponytail Review or Audit. These are optional tools used only when explicitly requested.

---

## 3. Development Workflow

For every assigned GitHub Task:

1. Verify the working tree and current branch.
2. Fetch the latest `develop`.
3. Create one feature branch from the latest `develop`.
4. Read the assigned Issue and relevant implementation files.
5. Implement only the assigned scope.
6. Add or update necessary tests.
7. Run targeted validation during development.
8. Run required pre-PR validation.
9. Perform one focused self-review of the final diff.
10. Commit the changes.
11. Push the feature branch.
12. Open a Pull Request targeting `develop`.
13. Stop and report the PR URL.

### Never

- Merge PRs.
- Start another Issue automatically.
- Perform final product acceptance.
- Expand the assigned scope without Product Owner approval.
- Make unrelated refactors or cosmetic changes.
- Modify production infrastructure without explicit authorization.
- Force push shared branches.
- Discard unrelated uncommitted changes.

If unrelated local changes exist, preserve them and avoid including them in the assigned PR.

### Branch Policy

- `develop`: integration and staging
- `main`: production
- `feature/*`: feature development
- `fix/*`: bug fixes
- `chore/*`: maintenance and tooling

Feature branches must originate from the latest `develop` unless the assigned Issue explicitly specifies otherwise.

---

## 4. Architecture

ReLai v1 uses:

- React
- TypeScript
- Vite
- React Router
- Cloudflare Workers
- Hono
- Cloudflare D1
- Gemini API for AI functionality

### Application Paths

Production application:

`/relaiapp`

API prefix:

`/relaiapp/api/v1/*`

### Architecture Rules

- Keep the existing Cloudflare-native architecture.
- Use Cloudflare Worker as the backend runtime.
- Keep API handlers thin.
- Reuse existing typed D1 repositories.
- Use prepared statements for database operations.
- Keep authentication and authorization server-side.
- Scope user-owned data access to the authenticated user.
- Preserve existing API contracts unless explicitly changed by the Issue.
- Preserve existing UI conventions unless the Issue requires a change.
- Avoid unnecessary services, layers, and dependencies.

Do not introduce FastAPI, PostgreSQL, Supabase, or another backend architecture for new ReLai v1 functionality.

---

## 5. Environment and Security

### Environment Mapping

| Branch | Environment | Database |
|---|---|---|
| `develop` | Staging | `relai-staging-db` |
| `main` | Production | `relai-prod-db` |

### Mandatory Safety Rules

Never:

- Bind `develop` to `relai-prod-db`.
- Bind production to `relai-staging-db`.
- Run destructive production database commands.
- Apply production migrations without explicit Product Owner approval.
- Delete Cloudflare resources.
- Modify production routes or infrastructure without authorization.
- Expose credentials, API keys, session tokens, cookies, or secrets.
- Commit secrets or environment-specific credentials.
- Weaken authentication, authorization, or input validation.
- Use client-supplied `user_id` as the authorization source.
- Perform remote database writes without the authorization required by the Issue.

### P0 Remote Cloudflare Access Guard (Issue #95)

Effective 2026-11-02, routine development, debugging, builds, tests and CI must not access Cloudflare staging or production resources. Without specific Product Owner authorization, do not make any remote Cloudflare API request, remote D1 read or write, remote schema verification, live Worker/API check, remote migration, Wrangler tail/deploy call, Queue/R2 operation, or remote import/seed. Read-only operations can still consume D1 row-read quota.

- Use only isolated local D1, mocked services, simulated Queue/R2 and local browser services for routine work.
- Routine Codex execution must have empty Cloudflare, Google and Gemini credential variables, no accessible authenticated Wrangler profile, and no secret bindings in local Worker processes. Repository wrappers clear process credentials, isolate Wrangler state and block non-loopback Node network access; local Worker configs exclude `.dev.vars` secrets, and CI asserts empty credentials and blocks remote traffic.
- Before running an npm script, inspect its full command and transitive scripts for remote access. Do not infer safety from a read-only label.
- `npm test`, `npm run test:d1-schema`, `npm run test:e2e`, builds and CI must block outbound Cloudflare/Google access and receive empty Cloudflare/Google credentials.
- Direct `wrangler`/`npx wrangler` commands bypass repository approval wrappers. Do not use direct Wrangler commands for remote operations; empty environment variables do not replace isolation from cached Wrangler authentication.
- Remote operator commands fail closed and require both `--approve-remote-cloudflare` and `RELAI_REMOTE_CLOUDFLARE_APPROVAL=I_UNDERSTAND_REMOTE_CLOUDFLARE_COSTS_AND_IMPACT`. These safeguards do not themselves authorize an operation: Codex must also have separate explicit Product Owner authorization for that specific remote action. Never set the opt-in during routine development.
- The staging schema verifier is metadata-only, bounded, and operator-only. Do not add application-table counts, `PRAGMA foreign_key_check`, or unbounded result queries to it.
- Historical Cloudflare Dashboard analytics may be reviewed only with separate authorization. Do not run live SQL to attribute a quota incident.
- Staging and production operations require separate, environment-specific Product Owner authorizations. A staging approval never authorizes production, or vice versa; authorize each remote action separately.
- Do not apply migrations, deploy, access remote resources, or merge as part of P0 incident analysis or safety hardening.

### Scoped staging delivery policy (Issue #108)

This repository change does not activate deployment or authorize a remote action.
Only after separate Product Owner activation, Cloudflare Workers Builds may hold
standing authorization to publish reviewed `develop` merge commits to the existing
`relai-prototype-staging` Worker and perform at most six GET requests to its
`/relaiapp/api/v1/health` route. This narrow exception requires the protected
GitHub repository/branch connection (with the temporary #110 exception below),
previews disabled, dedicated least-privilege Builds token custody, and
`staging-release.json` enabled with the PO-confirmed
complete migration digest. See `docs/develop-deployment.md` before activation.

`WORKERS_CI` variables and build receipts detect mistakes; they do not authenticate
Builds or prove token scope. Never supply Builds credentials to local Codex, PR CI
or arbitrary workflows. No standing authorization covers those actors, Production,
D1 SQL/migrations/schema reads, Queue/R2 data or resource operations, or other API
paths. Attaching the existing reviewed staging bindings during Worker publication
is the only resource-binding change in scope. Manual operator scripts retain
both opt-ins and separate per-action PO authorization. Never store the generic
`RELAI_REMOTE_CLOUDFLARE_APPROVAL` in Builds.

New/changed migrations hold automatic delivery until the PO separately authorizes
any remote migration, confirms staging readiness and approves the new full digest.
A matching digest records human confirmation; it does not query or prove live schema.
Production remains manual. Do not enable, deploy, merge or edit the Dashboard as
part of implementing #108.

Issue #110 temporary exception: PO has deferred GitHub `develop` Branch Protection
while PO is the only user with push access. Until protection is enabled, only PO
may merge, after human PR review and passing `Repository quality checks` and
`Playwright E2E` checks. Direct pushes and review/check bypass remain prohibited
by policy, but are not technically prevented: unreviewed or failing commits could
reach Builds. Branch obscurity is not a control, and a `develop` SHA does not prove
PR review. Follow up by requiring PRs, human approval and both checks, and blocking
direct pushes/bypass with Branch Protection. This exception does not activate CD,
weaken `main`/Production protections, Cloudflare's `develop`-only branch control,
disabled previews, token custody or any remote-resource restriction.

### Database Migrations

- Use repository-root `migrations/` as the schema source of truth.
- Apply every new migration first to isolated local D1 and validate its schema and data effects before any remote operation.
- Any migration that copies or rebuilds an existing table requires a written scan-risk assessment covering affected tables, expected row volume, access plan, indexes, and growth behavior.
- Codex must never apply remote migrations automatically. Staging and production migration operations require separate, explicit, narrowly scoped Product Owner authorization.
- Keep remote verification metadata-only and bounded; a full-table scan requires separate explicit approval for that verification.
- Keep migrations append-only.
- Never rewrite an already applied migration.
- Preserve existing user data and ownership relationships.
- Validate schema and data compatibility when migrations affect existing records.
- Keep staging and production migrations separate.
- Ordinary CI must never apply migrations to any remote database. Never automatically apply production migrations through CI or development deployment.

Database safety takes priority over implementation speed.

---

## 6. Efficient Repository Exploration

Minimize unnecessary file reads and tool calls.

### Required Behavior

- Inspect the files directly relevant to the assigned Issue.
- Follow affected imports, callers, interfaces, and tests where necessary.
- Use targeted searches before opening large files.
- Prefer `git diff`, focused searches, and relevant file ranges.
- Reuse information already obtained during the current task.
- Avoid repeatedly reading unchanged files.
- Avoid repository-wide exploration unless required to understand the change.

### Avoid

- Reading the entire repository without a specific reason.
- Repeatedly listing directories.
- Dumping large source files when only a function is relevant.
- Searching unrelated modules.
- Repeatedly consulting the same documentation.
- Producing lengthy implementation plans for straightforward tasks.

For simple changes, proceed directly after understanding the affected code.

For complex changes, create a short internal implementation plan and execute it without unnecessary intermediate approval requests.

---

## 7. Implementation Scope Control

Implement only what is necessary to satisfy the assigned Issue and its acceptance criteria.

### Prefer

- Existing shared utilities.
- Existing UI components.
- Existing database repositories.
- Existing API patterns.
- Existing test fixtures.
- Native platform capabilities.
- Minimal, localized changes.

### Avoid

- Premature abstraction.
- New frameworks or dependencies without justification.
- General-purpose infrastructure for one specific feature.
- Unrequested configuration options.
- Unrelated formatting changes.
- Unnecessary code movement.
- Speculative optimization.
- Rewriting working modules without evidence of a problem.
- Additional documentation unrelated to the task.

If implementation reveals a separate improvement opportunity, mention it in the PR's Known Limitations or as a follow-up recommendation.

Do not implement it without authorization.

---

## 8. Testing and Validation

Use risk-based validation during implementation while preserving the project's required PR quality checks.

### During Development

Run the smallest meaningful validation for the code being changed.

Examples:

- Changed utility: relevant unit tests.
- Changed component: relevant component tests.
- Changed API: relevant route and persistence tests.
- Changed authentication: authentication and authorization tests.
- Changed D1 logic: persistence, schema, and migration tests.
- Changed browser behavior: relevant Playwright tests.
- Changed deployment configuration: relevant configuration and routing tests.

Do not repeatedly run the full repository test suite after every small edit.

If a test fails:

1. Identify the actual cause.
2. Apply a focused correction.
3. Rerun the affected test.
4. Expand validation only when the failure indicates broader risk.

### Before Opening a PR

Unless the assigned Issue explicitly defines different requirements, run:

```bash
npm run lint
npm run typecheck
npm test
npm run build
```

Additionally:

- Run Playwright E2E when the change affects browser workflows or when required by the Issue.
- Run relevant D1/schema verification against isolated local D1 only. Remote schema verification requires separate explicit Product Owner authorization and is not a PR check.
- Run security-focused tests for authentication, authorization, or sensitive data handling.
- Run deployment-specific checks when configuration or routing changes.

Run each passing validation command only once against the final unchanged implementation.

If code changes after validation, rerun only the checks invalidated by those changes, unless full validation is required.

### CI

GitHub Actions remains the authoritative automated PR quality gate.

Do not duplicate CI execution merely to reconfirm an unchanged passing result.

Never report a test as passing unless it actually ran successfully.

Do not skip required validation to save tokens or execution time.

---

## 9. Code Review Policy

Codex is responsible for implementation and necessary self-checks.

Independent PR review and final acceptance are separate responsibilities.

### Required Self-Review

Perform one focused review of the final diff before committing.

Check:

- Assigned Issue requirements and acceptance criteria.
- Correctness of changed logic.
- Affected callers and API contracts.
- Authentication and authorization risks.
- Database integrity and migration safety.
- Relevant regression risks.
- Missing tests for non-trivial changes.
- Accidental unrelated changes.

Fix identified defects within the assigned scope.

### Avoid

- Repeated self-review loops.
- Full repository audits for isolated changes.
- Reviewing unchanged code without a concrete reason.
- Repeated style-only reviews.
- Unrequested performance optimization.
- Automatic invocation of `/ponytail-review`.
- Automatic invocation of `/ponytail-audit`.
- Starting a second review cycle after PR creation.

If the Product Owner explicitly requests a deeper review, use the appropriate Ponytail review skill.

Do not perform independent final acceptance.

---

## 10. Token and Tool Efficiency

Optimize for correct results with minimal unnecessary work.

### Communication

- Keep progress updates concise.
- Avoid repeating the Issue description.
- Avoid explaining standard implementation details unless requested.
- Do not produce lengthy summaries of unchanged code.
- Report meaningful blockers, failed validations, or decisions requiring Product Owner input.
- Do not repeatedly ask for confirmation when the assigned Issue already provides the answer.

### Tool Usage

- Batch related read-only operations when practical.
- Prefer focused commands over repeated broad searches.
- Avoid redundant test runs.
- Avoid repeatedly checking Git status when the repository state has not changed.
- Avoid unnecessary dependency installation.
- Avoid installing tooling already available in the repository.
- Do not run extra audits solely to demonstrate thoroughness.

Efficiency must never compromise correctness, security, or required acceptance criteria.

---

## 11. Git and Pull Requests

### Commit Rules

- Commit only changes related to the assigned Issue.
- Use clear, concise commit messages.
- Avoid unnecessary commits for cosmetic adjustments.
- Never commit secrets, generated credentials, or unrelated files.
- Do not amend, rewrite, or force push shared history without authorization.

### Pull Request Rules

Target branch:

`develop`

Every PR must include:

**Summary**

Briefly describe the implemented outcome.

**Changes**

Summarize meaningful code and behavior changes.

**Validation**

List commands actually executed and their results.

**Known Limitations**

State unresolved limitations, skipped checks, and relevant risks. Use `None` when appropriate.

**Issue Reference**

`Closes #<issue-number>`

### After PR Creation

- Return the PR URL.
- Summarize implementation and validation concisely.
- Mention any unresolved blocker or risk.
- Stop.

Do not merge the PR or start additional work.

---

## 12. Responsibility and Decision Authority

### Codex

Responsible for:

- Assigned Issue implementation.
- Necessary tests.
- Focused validation.
- One targeted self-review.
- Commit and push.
- PR creation.

Not responsible for:

- Final product acceptance.
- Independent comprehensive review.
- Merging PRs.
- Unapproved architectural changes.
- Starting unrelated Issues.

### ChatGPT Web

Responsible for:

- Independent PR review.
- Acceptance assessment.
- Architecture and product recommendations.
- Identifying risks requiring Product Owner decisions.

### Product Owner

Responsible for:

- Product requirements.
- Architecture decisions.
- Scope approval.
- Production authorization.
- Final acceptance decisions.
- PR merging.
- Release approval.

---

## 13. Definition of Done

A Codex task is complete when:

1. The assigned Issue scope is implemented.
2. Required tests are added or updated.
3. Required validation passes, or blockers are explicitly reported.
4. The final diff has received one focused self-review.
5. Changes are committed.
6. The feature branch is pushed.
7. A PR targeting `develop` is opened.
8. The PR contains the required summary and validation details.
9. Codex reports the PR URL and stops.

**Do not continue into the next task.**

---

## Final Principle

Deliver the smallest complete, maintainable, and secure implementation that satisfies the assigned Issue.

Reuse existing architecture and code. Avoid unnecessary review cycles, tool calls, tests, abstractions, and documentation.

Preserve required engineering quality and safety.

**Implement → Validate → Review Once → Commit → Push → Open PR → Stop.**
