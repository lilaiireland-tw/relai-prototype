# Closed-beta account management (Issue #39)

Run from the repository root with Node.js 24 and installed dependencies. Only an
authorized operator with Cloudflare D1 access should execute these commands.
Supply the target Worker's matching `AUTH_PEPPER` through the process environment
using your protected secret injection workflow. The CLI does not accept a pepper
argument, read credential files directly, or obtain the pepper from Worker bindings.
Missing pepper prevents all commands, including listing, before creating a
temporary config or opening a platform connection.

```sh
npm run user:manage -- create --username alex --display-name "Alex"
npm run user:manage -- create --username alex --display-name "Alex" --cohort-source "Referral notes"
npm run user:manage -- reset-password --username alex
npm run user:manage -- disable --username alex
npm run user:manage -- list
```

Staging is the default. `--env staging` is also accepted. Production requires both
`--env production --confirm-production relai-prod-db`; any other environment or
confirmation value fails before opening a platform/D1 connection. Database IDs
come solely from the source `wrangler.jsonc`.

Per the Product Owner's Issue #39 clarification, the CLI resolves the selected
environment using Wrangler's config reader, then writes a private temporary
`wrangler.jsonc` outside the repository. Only the selected `DB` identity is copied
and marked `remote: true` for this execution. `getPlatformProxy` receives that
temporary path with `remoteBindings: true`, explicit environment, no local state
persistence and no dotenv files. The committed config remains non-remote; no IDs
are duplicated in the CLI. All validation, confirmation and pepper checks precede
temporary config creation. Cleanup disposes the proxy and removes its temporary
directory on completion or failure. Normal cleanup cannot run after a forced
process kill.

The options follow the installed Wrangler version and its
[Node API documentation](https://developers.cloudflare.com/workers/wrangler/api/#getplatformproxy).

Usernames retain their exact spelling and case. Leading/trailing whitespace is
rejected; display name must be nonempty. Cohort source is unrestricted text.
Creation uses a UUID, UTC timestamps, an active account and the repository's
default `user` role. No settings, stats or learning records are provisioned.

Create/reset issue 24 random bytes (192 bits) encoded as 32 unpadded base64url
characters, then use the approved [credential crypto](auth-crypto.md). D1 receives
only the salt and digest. Successful create/reset prints the password exactly
once to operator stdout after persistence confirms success. Handle that output as
sensitive material; it is not recoverable from D1. Raw transport failures are
replaced with fixed errors and never logged by the CLI. A cleanup failure reports
a nonzero exit code without repeating credential output.

Reset invalidates the old password and retains sessions. Disable revokes all
existing sessions through the sessions repository before deactivating the account;
the user is retained, and repeating disable is safe. These are sequential D1
operations: if a later operation fails, an earlier confirmed write can remain.
Retry disable after a failure. The CLI does not claim atomicity across repository
operations or guarantee delivery of stdout after a committed credential write.

List outputs JSON containing only account ID, username, display name, role, active
status, cohort source and account timestamps (including last login). Disabled
accounts remain visible. Password salts and digests are excluded by the repository
SQL projection.

## Offline validation

`npm run test:admin` runs injected in-memory SQLite and fake-binding tests against
the existing migration and repository SQL. They also run in `npm test`; no remote
D1, OAuth credentials, real pepper or real beta accounts are needed. Ordinary
module imports never open a platform proxy. Do not execute the CLI against real
staging/production accounts during implementation or test validation.
