# Worker D1 persistence (Issue #30)

`src/worker/persistence` is the v1 repository boundary. Construct
`createRepositories(env.DB)` per request/service invocation. It accepts the
structural subset of the Cloudflare D1 binding needed here (`prepare`, `bind`,
`first`, `run`, `all`); no adapter, ORM, global binding or route SQL is required.
Only users and sessions repositories are implemented. Issue #39 adds
`users.listAccounts()`, a fixed safe-field projection for internal account
management; it never selects credential salts or digests and rejects failed D1
results rather than returning an empty success.

## Query conventions

- Keep SQL in repository modules. Use fixed column lists and prepared statements
  with every input passed through `bind`; interpolate only private static SQL
  fragments such as column lists. Never interpolate client values or identifiers.
- Row shapes match the approved migration: snake_case, integer booleans (`0 | 1`),
  UTC ISO-8601 text timestamps and explicit nullable fields. Callers supply IDs,
  normalized usernames, timestamps and already derived credentials. No password
  hashing, normalization or clock policy is implemented here.
- `role` is unrestricted `string` with a create default of `'user'`;
  `cohort_source` is `string | null`. These approved TEXT columns have no
  persistence-level enums or additional schema constraints.
- Lookups resolve to a typed row or `null`; inserts return the persisted row using
  `RETURNING`. Mutations return `{ changes }`, including zero for absent targets.
  Unique violations and D1 failures reject; do not turn errors into empty results.
  Never log credentials/digests or expose raw database errors or `UserRow` to clients.
- Use narrowly named operations rather than arbitrary field patches. Users support
  provisioning, login timestamp recording, credential replacement and activation.
  Disabling an account does not itself revoke sessions: the later admin/auth
  service must orchestrate both operations as required by the PRD.
- `tokenDigest` validates an already computed lowercase SHA-256 hex digest and
  gives it a branded type. Session create/lookup/revoke also validate at runtime.
  No persistence API takes a raw token or computes a digest. The upstream auth
  layer must derive the digest; format validation cannot prove its provenance.
  Issue #37 now supplies that upstream derivation in `src/worker/auth/crypto.ts`:
  `digestSessionToken` hashes raw transport text and returns this existing
  `TokenDigest` type. See [auth crypto contracts](auth-crypto.md). Raw tokens
  remain outside repository inputs; credentials contain only salt/digest fields.
- Session lookup returns stored timing fields even for expired sessions. Auth
  decides expiry and activity policy; persistence does not renew expiry. Last-seen
  updates require both session ID and authenticated user ID. Digest lookup/revoke
  are the session-auth bootstrap operations. User-wide revocation is an internal
  account operation, not authorization based on a client-supplied user ID.
- Future user-owned table repositories must include authenticated `user_id` in
  their query predicates. Client-supplied IDs never establish authorization.
  Add only repositories assigned by a later issue.

## Offline tests

Run `npm run test:persistence` for focused tests; they also run in `npm test`.
Node 24's in-memory SQLite executes the committed migration and the actual SQL
through a small D1-compatible test adapter. Each test gets a fresh database.
There is no Wrangler configuration, persistent state, credential, remote database
or production dependency. Failure-result tests use a deterministic fake transport.
The adapter verifies SQLite SQL behavior, not Cloudflare runtime/network behavior.

The schema stays unchanged. Follow [the migration runbook](d1-migrations.md) for
future assigned schema tasks; tests never apply a remote migration.

API reference: [Cloudflare prepared statements](https://developers.cloudflare.com/d1/worker-api/prepared-statements/).
