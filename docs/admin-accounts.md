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

Non-interactive create/reset issue 24 random bytes (192 bits) encoded as 32 unpadded base64url
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

## Provisioning a new beta account (Issue #48)

Supply the matching `AUTH_PEPPER` through the process environment first, as above.
Use a real terminal for interactive creation; piped input/output is refused.

### A. Interactive temporary-password creation

```sh
npm run user:manage -- create --interactive --env staging
```

The CLI asks for username, display name, optional cohort source, temporary
password and password confirmation. Leave cohort source empty to omit it.
Enter at least 8 characters (an 8-digit password is accepted) and confirm the
exact same password. Password entry is hidden; no plaintext or masking characters
are echoed. Spaces and Unicode are preserved exactly, without trimming or
normalization. A short password or mismatched confirmation fails before any
platform connection. Ctrl+C cancels input. Rerun the command to retry.
Interactive mode collects all account fields through prompts; do not combine it
with `--username`, `--display-name` or `--cohort-source` options.

Never put the chosen password in command arguments, files or GitHub. There is no
`--password` option. The CLI derives credential material immediately using a fresh
random salt and the existing `AUTH_PEPPER` crypto. The temporary password is never
stored plaintext: D1 receives only `password_salt` and `password_digest` as
credential material. The chosen password is never printed back, including after
success; keep it available privately for secure handoff to the student.

### B. Existing random-password creation

```sh
npm run user:manage -- create --username alex --display-name "Alex"
```

Optional `--cohort-source "Referral notes"` remains available. The CLI generates
the existing 32-character random password and prints it exactly once after
successful persistence. Handle that output privately; only salt and digest are
stored in D1.

Both creation flows set `must_change_password = true` (D1 integer `1`). The
student logs in at `/relaiapp/login` with the handed-off temporary password and
is directed to `/relaiapp/change-password`. They enter the temporary password,
then choose and confirm a new password of at least eight characters. After the
change, the app refreshes account state and opens Home. The temporary password
no longer works; the new password works on subsequent login. Existing accounts
are unchanged, and reset-password behavior remains as documented above.
Staging remains the default; production still requires both
`--env production --confirm-production relai-prod-db`.

## Offline validation

`npm run test:admin` runs injected in-memory SQLite and fake-binding tests against
the existing migration and repository SQL. They also run in `npm test`; no remote
D1, OAuth credentials, real pepper or real beta accounts are needed. Ordinary
module imports never open a platform proxy. Do not execute the CLI against real
staging/production accounts during implementation or test validation.

## Staging checks for account operations

For an authorized staging check, verify the active Worker and migration history
first. Then create a dedicated account through the interactive flow, log in,
confirm forced password change, log out, and confirm the old password fails while
the new one works. Inspect the HttpOnly cookie and browser storage without
recording secrets. Use only `relai-prototype-staging` and `relai-staging-db`;
production account operations require their separate release authorization.
