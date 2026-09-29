import { afterEach, describe, expect, expectTypeOf, it, vi } from 'vitest'
import { tokenDigest, type CreateUserInput, type TokenDigest } from '../persistence/types'
import { createSessionsRepository } from '../persistence/sessions'
import {
  createPasswordCredential, derivePasswordDigest, digestSessionToken, generateCredentialSalt,
  generateSessionToken, rawSessionToken, verifyPassword, type RawSessionToken,
} from './crypto'

// Synthetic fixtures only. Expected digests independently calculated with Python hmac/hashlib.
const salt = 'AAECAwQFBgcICQoLDA0ODw' // bytes 00..0f
const password = ' test password\0愛🍀 '
const pepper = 'test-only-pepper'
const passwordDigest = 'v1:4c0e8ae7c9489938b1148df12255433d4f5522a53acec7d596bec831a0999caa'
const credential = { password_salt: salt, password_digest: passwordDigest }
const token = 'AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8' // bytes 00..1f
const sessionDigest = 'ea866a757e4c38babfa8127cbe9a409d3e1f93a00ff1488ff735fcf917afffd0'

afterEach(() => vi.restoreAllMocks())

describe('v1 password credentials', () => {
  it('uses fresh 16-byte Web Crypto entropy and canonical unpadded base64url', () => {
    const random = vi.spyOn(crypto, 'getRandomValues')
    const first = generateCredentialSalt()
    const second = generateCredentialSalt()
    expect(random).toHaveBeenCalledTimes(2)
    expect(random.mock.calls.map(([bytes]) => bytes?.byteLength)).toEqual([16, 16])
    expect(random.mock.calls[0][0]).not.toBe(random.mock.calls[1][0])
    expect(first).toMatch(/^[A-Za-z0-9_-]{22}$/)
    expect(atob(first.replace(/-/g, '+').replace(/_/g, '/') + '==')).toHaveLength(16)
    expect(second).not.toBe(first)
  })

  it('encodes fixed entropy without changing the salt bytes', () => {
    vi.spyOn(crypto, 'getRandomValues').mockImplementationOnce(bytes => {
      const array = bytes as Uint8Array
      array.set(Array.from({ length: 16 }, (_, i) => i))
      return bytes
    })
    expect(generateCredentialSalt()).toBe(salt)
  })

  it('matches the versioned HMAC vector and is deterministic', async () => {
    expect(await derivePasswordDigest(password, salt, pepper)).toBe(passwordDigest)
    expect(await derivePasswordDigest(password, salt, pepper)).toBe(passwordDigest)
  })

  it.each([
    ['password', password + 'x', salt, pepper],
    ['salt', password, 'AQECAwQFBgcICQoLDA0ODw', pepper],
    ['pepper', password, salt, pepper + 'x'],
  ])('changes the digest when %s changes', async (_input, newPassword, newSalt, newPepper) => {
    expect(await derivePasswordDigest(newPassword, newSalt, newPepper)).not.toBe(passwordDigest)
    expect(await verifyPassword(newPassword, { ...credential, password_salt: newSalt }, newPepper)).toBe(false)
  })

  it('uses HMAC verification with a non-extractable UTF-8 pepper key', async () => {
    const verify = vi.spyOn(crypto.subtle, 'verify')
    const sign = vi.spyOn(crypto.subtle, 'sign')
    const importKey = vi.spyOn(crypto.subtle, 'importKey')
    expect(await verifyPassword(password, credential, pepper)).toBe(true)
    expect(verify).toHaveBeenCalledTimes(1)
    expect(verify.mock.calls[0][0]).toBe('HMAC')
    expect(importKey).toHaveBeenCalledWith('raw', new TextEncoder().encode(pepper),
      { name: 'HMAC', hash: 'SHA-256' }, false, ['verify'])
    expect(sign).not.toHaveBeenCalled()
  })

  it('preserves password whitespace, NULs and Unicode without normalization', async () => {
    expect(await verifyPassword(password.trim(), credential, pepper)).toBe(false)
    const decomposed = await createPasswordCredential('e\u0301', pepper)
    expect(await verifyPassword('é', decomposed, pepper)).toBe(false)
    const empty = await createPasswordCredential('', pepper) // No password policy in primitives.
    expect(await verifyPassword('', empty, pepper)).toBe(true)
  })

  it.each([
    '', 'a'.repeat(64), `v2:${'a'.repeat(64)}`, `V1:${'a'.repeat(64)}`,
    `v1:${'A'.repeat(64)}`, `v1:${'g'.repeat(64)}`, `v1:${'a'.repeat(63)}`,
    `v1:${'a'.repeat(65)}`, passwordDigest + '\n', passwordDigest + ':extra',
  ])('rejects malformed/unsupported stored digest before Web Crypto verification: %s', async digest => {
    const verify = vi.spyOn(crypto.subtle, 'verify')
    expect(await verifyPassword(password, { ...credential, password_digest: digest }, pepper)).toBe(false)
    expect(verify).not.toHaveBeenCalled()
  })

  it.each(['', salt + '==', salt.slice(0, -1), salt.slice(0, -1) + 'x', '!'.repeat(22), 'A'.repeat(43)])(
    'rejects malformed/noncanonical stored salt: %s', async invalidSalt => {
      await expect(derivePasswordDigest(password, invalidSalt, pepper)).rejects.toThrow('Invalid auth material format.')
      const verify = vi.spyOn(crypto.subtle, 'verify')
      expect(await verifyPassword(password, { ...credential, password_salt: invalidSalt }, pepper)).toBe(false)
      expect(verify).not.toHaveBeenCalled()
    },
  )

  it('fails on missing pepper instead of deriving an unkeyed credential', async () => {
    await expect(derivePasswordDigest(password, salt, '')).rejects.toThrow('Auth secret is not configured.')
    await expect(verifyPassword(password, credential, '')).rejects.toThrow('Auth secret is not configured.')
  })

  it('returns only salt/digest persistence fields with fresh entropy for every credential', async () => {
    const first: Pick<CreateUserInput, 'password_salt' | 'password_digest'> = await createPasswordCredential(password, pepper)
    const second = await createPasswordCredential(password, pepper)
    expect(Object.keys(first).sort()).toEqual(['password_digest', 'password_salt'])
    expect(first.password_salt).not.toBe(second.password_salt)
    expect(first.password_digest).not.toBe(second.password_digest)
    expect(first.password_digest).toMatch(/^v1:[a-f0-9]{64}$/)
    expect(await verifyPassword(password, first, pepper)).toBe(true)
  })
})

describe('opaque sessions', () => {
  it('uses fresh 32-byte Web Crypto entropy and unpadded base64url', () => {
    const random = vi.spyOn(crypto, 'getRandomValues')
    const first = generateSessionToken()
    const second = generateSessionToken()
    expectTypeOf(first).toEqualTypeOf<RawSessionToken>()
    expectTypeOf<RawSessionToken>().not.toMatchTypeOf<TokenDigest>()
    expectTypeOf<TokenDigest>().not.toMatchTypeOf<RawSessionToken>()
    expect(random.mock.calls.map(([bytes]) => bytes?.byteLength)).toEqual([32, 32])
    expect(random.mock.calls[0][0]).not.toBe(random.mock.calls[1][0])
    expect(first).toMatch(/^[A-Za-z0-9_-]{43}$/)
    expect(atob(first.replace(/-/g, '+').replace(/_/g, '/') + '=')).toHaveLength(32)
    expect(second).not.toBe(first)
  })

  it('matches fixed token entropy and hashes UTF-8 token text, not decoded entropy', async () => {
    vi.spyOn(crypto, 'getRandomValues').mockImplementationOnce(bytes => {
      const array = bytes as Uint8Array
      array.set(Array.from({ length: 32 }, (_, i) => i))
      return bytes
    })
    const raw = generateSessionToken()
    expect(raw).toBe(token)
    const digest = await digestSessionToken(raw)
    expectTypeOf(digest).toEqualTypeOf<TokenDigest>()
    expect(digest).toBe(sessionDigest)
    expect(await digestSessionToken(rawSessionToken(token))).toBe(digest)
    expect(tokenDigest(digest)).toBe(digest)
    expect(digest).toMatch(/^[a-f0-9]{64}$/)
    expect(digest).toHaveLength(64)
    expect(await digestSessionToken(generateSessionToken())).not.toBe(digest)
  })

  it.each(['', token + '=', token.slice(0, -1), token.slice(0, -1) + '9', '!'.repeat(43), 'a'.repeat(64)])(
    'rejects invalid raw-token material at the transport boundary: %s', async invalid => {
      expect(() => rawSessionToken(invalid)).toThrow('Invalid auth material format.')
      await expect(digestSessionToken(invalid as RawSessionToken)).rejects.toThrow('Invalid auth material format.')
    },
  )

  it('passes only derived digests into the existing session persistence boundary', async () => {
    const raw = rawSessionToken(token)
    const digest = await digestSessionToken(raw)
    const session = { id: 'session-test', user_id: 'user-test', token_digest: digest,
      created_at: '2026-09-29T10:00:00.000Z', expires_at: '2026-09-30T10:00:00.000Z' }
    const bind = vi.fn()
    const prepare = vi.fn(() => ({
      bind(...values: (string | number | null)[]) {
        bind(...values)
        return { bind: this.bind, async first<T>() { return { ...session, last_seen_at: null } as T },
          async run() { return { success: true, meta: { changes: 1 } } } }
      },
      async first<T>(): Promise<T | null> { return null },
      async run() { return { success: true, meta: { changes: 0 } } },
    }))
    const repository = createSessionsRepository({ prepare })
    expect(await repository.create(session)).toEqual({ ...session, last_seen_at: null })
    await repository.findByTokenDigest(digest)
    await repository.revokeByTokenDigest(digest)
    expect(bind.mock.calls.flat()).toContain(digest)
    expect(bind.mock.calls.flat()).not.toContain(raw)
    expect(() => tokenDigest(raw)).toThrow('Invalid session token digest.')
    prepare.mockClear()
    // @ts-expect-error Raw transport material cannot satisfy TokenDigest.
    expect(() => repository.findByTokenDigest(raw)).toThrow('Invalid session token digest.')
    expect(prepare).not.toHaveBeenCalled()
  })
})

it('does not log secrets or retain them in credential results/errors', async () => {
  const logs = [vi.spyOn(console, 'log'), vi.spyOn(console, 'info'), vi.spyOn(console, 'warn'),
    vi.spyOn(console, 'error'), vi.spyOn(console, 'debug')]
  const result = await createPasswordCredential(password, pepper)
  const raw = generateSessionToken()
  await digestSessionToken(raw)
  await verifyPassword(password, result, pepper)
  const serialized = JSON.stringify(result)
  for (const secret of [password, pepper, raw]) expect(serialized).not.toContain(secret)
  await expect(derivePasswordDigest(password, 'invalid', pepper)).rejects.toThrow('Invalid auth material format.')
  for (const log of logs) expect(log).not.toHaveBeenCalled()
})
