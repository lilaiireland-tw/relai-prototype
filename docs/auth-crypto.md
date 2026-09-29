# Worker auth crypto primitives (Issue #37)

`src/worker/auth/crypto.ts` implements the exact approved v1 construction from
Issue #37. It uses Worker globals (`crypto.getRandomValues`, `crypto.subtle`,
`TextEncoder`, `btoa`, `atob`) without Node crypto, dependencies or environment
access. The caller supplies the server-side `AUTH_PEPPER` value. No keys or
secrets are cached at module scope, logged, or persisted by these functions.

## Password credentials

- `generateCredentialSalt()` fills a fresh 16-byte `Uint8Array` with
  `crypto.getRandomValues`, then encodes it as canonical unpadded base64url
  (22 characters).
- `derivePasswordDigest(password, passwordSalt, authPepper)` validates and
  decodes the salt, imports **UTF-8 bytes of the supplied pepper string** as a
  non-extractable HMAC-SHA-256 key, and signs the v1 message below. The pepper
  string is not decoded as hex/base64 and must be nonempty.
- `createPasswordCredential(password, authPepper)` generates a fresh salt and
  returns only `{ password_salt, password_digest }`, suitable for the existing
  users create/reset persistence input. It never returns the password or pepper.
- `verifyPassword(password, credential, authPepper)` validates the stored
  digest and salt first, then uses `crypto.subtle.verify('HMAC', ...)` with the
  decoded 32-byte signature. It does not compare secret digest strings itself.

### Exact v1 message and stored format

```text
message = UTF8("v1\0") || decoded_salt[16] || UTF8(password)
          76 31 00       exactly 16 bytes    remaining bytes
key     = UTF8(AUTH_PEPPER)
mac     = HMAC-SHA-256(key, message)
password_digest = "v1:" || lowercase_hex(mac)
```

The prefix is three bytes, including one NUL byte. Fixed prefix and salt lengths
make the byte boundaries unambiguous, even when a password contains NULs.
Passwords and pepper are not trimmed or Unicode-normalized. The current
account-management CLI and password-change API enforce their respective policies.
The stored digest is exactly 67 characters, with no whitespace, extra fields,
uppercase hex or unsupported version. Salt must be canonical base64url with
exactly 16 decoded bytes; padding and nonzero unused encoding bits are rejected.

Malformed/unsupported stored credentials and incorrect passwords yield `false`.
Invalid salt passed to derivation throws a fixed format error; a missing pepper
when importing a key throws a fixed configuration error. Crypto runtime failures
propagate to the server-side caller. These internal errors must not be serialized
as public auth responses. No function receives a username or queries accounts;
generic login errors and account-existence timing policy belong to the auth
service. Format validation itself is not claimed to take constant time.

Synthetic interoperability vector (not an account or a production secret):

```text
salt bytes:      00 01 02 03 04 05 06 07 08 09 0a 0b 0c 0d 0e 0f
password_salt:   AAECAwQFBgcICQoLDA0ODw
password:        " test password\u0000愛🍀 " (including both spaces)
AUTH_PEPPER:     "test-only-pepper"
password_digest: v1:4c0e8ae7c9489938b1148df12255433d4f5522a53acec7d596bec831a0999caa
```

This is the approved small closed-beta credential scheme. Interactive account
creation also permits an operator-chosen temporary password of at least eight
characters, followed by a required first-login change. Any future scheme needs
a new version and explicit product/architecture approval.

## Opaque sessions

- `generateSessionToken()` fills a fresh 32-byte array with Web Crypto entropy
  and returns a branded `RawSessionToken`: canonical unpadded base64url text
  (43 characters). The raw value is sensitive transport material only.
- `rawSessionToken(value)` validates incoming raw transport text and brands it
  separately from persistence digests. It rejects incorrect length/alphabet,
  padding and noncanonical unused bits. It does not authenticate a session.
- `digestSessionToken(rawToken)` computes **SHA-256 over UTF-8 bytes of the
  encoded token string**, not its decoded random bytes. It returns exactly
  64 lowercase hex characters through the existing `tokenDigest(...)` validator
  from Issue #30, with the existing `TokenDigest` type. It also validates raw
  format at runtime.

`RawSessionToken` and `TokenDigest` are separate incompatible brands. Keep the
raw value only in transient transport handling; pass the derived digest to
sessions create/lookup/revoke. Neither a brand nor format validation proves
entropy provenance or session validity. No function here stores a raw token,
creates a session row, sets a cookie, or decides expiry/revocation policy.

Synthetic vector: random bytes `00..1f` encode to
`AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8`. SHA-256 of that string is
`ea866a757e4c38babfa8127cbe9a409d3e1f93a00ff1488ff735fcf917afffd0`.

## Tests and scope

Run `npm run test:auth`; these tests also run in `npm test`. They use the test
host's standard global Web Crypto, fixed entropy spies, independent Python
HMAC/SHA-256 vectors, and a recording fake persistence transport. No remote D1,
production secrets or real accounts are involved. They cover encoding, changed
inputs, verification, malformed storage/transport, separate raw/digest types,
digest-only repository calls and absence of secret logging.

This module is server-side only. Do not import it into `src/client` or put
`AUTH_PEPPER` in `VITE_*`, public responses or D1. The crypto module itself
does not decide routes, cookies, account workflows or schema.

Runtime reference: [Cloudflare Workers Web Crypto](https://developers.cloudflare.com/workers/runtime-apis/web-crypto/).
