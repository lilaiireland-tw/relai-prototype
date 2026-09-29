import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Hono } from 'hono'
import { createApp } from '../index'
import * as authCrypto from '../auth/crypto'
import type { AuthEnv } from '../auth/types'
import { requireAuth, requirePasswordChanged } from '../middleware/auth'
import { createRepositories } from '../persistence'
import type { PersistenceDatabase, PersistenceStatement, SqlValue } from '../persistence/d1'

// Offline D1 transport: actual repositories/SQL/committed schema, fresh SQLite per test.
function sqliteD1(sqlite: DatabaseSync): PersistenceDatabase {
  function statement(sql: string, values: SqlValue[] = []): PersistenceStatement {
    return {
      bind: (...bound) => statement(sql, bound),
      async first<T>() { return (sqlite.prepare(sql).get(...values) as T | undefined) ?? null },
      async all<T>() { return { success: true, results: sqlite.prepare(sql).all(...values) as T[] } },
      async run() {
        return { success: true, meta: { changes: Number(sqlite.prepare(sql).run(...values).changes) } }
      },
    }
  }
  return { prepare: sql => statement(sql) }
}

const at = '2026-09-29T10:00:00.000Z'
const expiry = '2026-10-06T10:00:00.000Z'
const password = ' synthetic password\u0000愛🍀 '
const testPepper = 'offline-synthetic-binding'
const profile = { id: 'synthetic-user', username: 'Beta', display_name: 'Beta Test', role: 'user', must_change_password: false }
const invalidCredentials = { error: { code: 'INVALID_CREDENTIALS', message: '登入資訊不正確。' } }
const unauthorized = { error: { code: 'UNAUTHORIZED', message: 'Authentication required.' } }
const serverError = { error: { code: 'INTERNAL_SERVER_ERROR', message: 'Internal server error.' } }

describe('closed-beta auth API', () => {
  let sqlite: DatabaseSync
  let db: PersistenceDatabase
  let env: AuthEnv['Bindings']
  let repositories: ReturnType<typeof createRepositories>
  let app: ReturnType<typeof createApp>
  let credential: authCrypto.PasswordCredential
  let logs: ReturnType<typeof vi.spyOn>[]

  beforeEach(async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date(at))
    logs = ['log', 'warn', 'error', 'info', 'debug'].map(method =>
      vi.spyOn(console, method as 'log').mockImplementation(() => {}))
    sqlite = new DatabaseSync(':memory:')
    for (const name of readdirSync('migrations').filter(name => name.endsWith('.sql')).sort()) {
      sqlite.exec(readFileSync(`migrations/${name}`, 'utf8'))
    }
    db = sqliteD1(sqlite)
    repositories = createRepositories(db)
    env = { DB: db, AUTH_PEPPER: testPepper }
    app = createApp()
    credential = await authCrypto.createPasswordCredential(password, testPepper)
    await repositories.users.create({ ...profile, ...credential, cohort_source: 'internal_beta',
      created_at: at, updated_at: at })
  })

  afterEach(() => {
    for (const log of logs) expect(log).not.toHaveBeenCalled()
    sqlite.close()
    vi.restoreAllMocks()
    vi.useRealTimers()
  })

  function request(path: string, init: RequestInit = {}, protocol = 'https') {
    return app.request(`${protocol}://example.test/relaiapp/api/v1${path}`, init, env)
  }
  function login(body: unknown = { username: profile.username, password }, protocol = 'https') {
    return request('/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body) }, protocol)
  }
  function changePassword(body: unknown, sessionCookie?: string) {
    return request('/auth/change-password?user_id=another-user', { method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(sessionCookie ? { Cookie: sessionCookie } : {}) },
      body: JSON.stringify(body) })
  }
  function cookie(response: Response) { return response.headers.get('set-cookie')!.split(';')[0] }
  function tokenFrom(response: Response) { return authCrypto.rawSessionToken(cookie(response).slice('relai_session='.length)) }
  async function sessionFrom(response: Response) {
    return repositories.sessions.findByTokenDigest(await authCrypto.digestSessionToken(tokenFrom(response)))
  }
  function failSql(matches: (sql: string) => boolean) {
    const prepare = db.prepare
    vi.spyOn(db, 'prepare').mockImplementation(sql => {
      if (matches(sql)) throw new Error(`private runtime: ${password} ${testPepper} ${credential.password_digest}`)
      return prepare(sql)
    })
  }
  function expectCookie(response: Response, secure: boolean, cleared = false) {
    const value = response.headers.get('set-cookie')!
    expect(value).toContain('Path=/relaiapp')
    expect(value).toContain('HttpOnly')
    expect(value).toContain('SameSite=Lax')
    expect(value.includes('; Secure')).toBe(secure)
    expect(value).toContain(`Max-Age=${cleared ? 0 : 604800}`)
    expect(value).toContain(`Expires=${new Date(cleared ? 0 : expiry).toUTCString()}`)
    expect(value).not.toContain('Domain=')
    if (cleared) expect(value).toMatch(/^relai_session=;/)
    else expect(value).toMatch(/^relai_session=[A-Za-z0-9_-]{43};/)
  }

  it.each(['https', 'http'])('logs in on %s with digest-only storage and the exact cookie policy', async protocol => {
    const response = await login(undefined, protocol)
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ user: profile })
    expect(response.headers.get('cache-control')).toBe('no-store')
    expectCookie(response, protocol === 'https')
    const session = await sessionFrom(response)
    expect(session).toEqual({ id: expect.stringMatching(/^[a-f0-9-]{36}$/), user_id: profile.id,
      token_digest: await authCrypto.digestSessionToken(tokenFrom(response)), created_at: at,
      expires_at: expiry, last_seen_at: null })
    expect(JSON.stringify(sqlite.prepare('SELECT * FROM sessions').all())).not.toContain(tokenFrom(response))
    expect(await repositories.users.findById(profile.id)).toMatchObject({ last_login_at: at })
    expect(JSON.stringify([...response.headers].filter(([key]) => key !== 'set-cookie'))).not.toContain(tokenFrom(response))
  })

  it('preserves login and safe public responses for a password-change-required account', async () => {
    await repositories.users.updateCredential(profile.id, { ...credential,
      must_change_password: true, updated_at: at })
    const response = await login()
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ user: { ...profile, must_change_password: true } })
    const me = await request('/auth/me', { headers: { Cookie: cookie(response) } })
    expect(me.status).toBe(200)
    expect(await me.json()).toEqual({ user: { ...profile, must_change_password: true } })
    expect(await repositories.users.findById(profile.id)).toMatchObject({ must_change_password: true })
  })

  it('changes only the session user credential with fresh salt and clears the required flag', async () => {
    await repositories.users.updateCredential(profile.id, { ...credential,
      must_change_password: true, updated_at: at })
    await repositories.users.create({ ...profile, id: 'another-user', username: 'Other', ...credential,
      created_at: at, updated_at: at })
    const loggedIn = await login()
    const originalSession = await sessionFrom(loggedIn)
    const nextPassword = ' new pass\u0000愛🍀 '
    const response = await changePassword({ current_password: password, new_password: nextPassword,
      user_id: 'another-user', password_salt: 'attacker', must_change_password: true }, cookie(loggedIn))
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ user: { ...profile, must_change_password: false } })
    expect(response.headers.get('set-cookie')).toBeNull()
    expect(response.headers.get('cache-control')).toBe('no-store')
    const updated = await repositories.users.findById(profile.id)
    expect(updated).toMatchObject({ must_change_password: false, updated_at: at })
    expect(updated!.password_salt).not.toBe(credential.password_salt)
    expect(updated!.password_digest).not.toBe(credential.password_digest)
    expect(await authCrypto.verifyPassword(nextPassword, updated!, testPepper)).toBe(true)
    expect(await authCrypto.verifyPassword(nextPassword.trim(), updated!, testPepper)).toBe(false)
    expect(await repositories.users.findById('another-user')).toMatchObject({ ...credential, must_change_password: false })
    expect(await sessionFrom(loggedIn)).toEqual({ ...originalSession, last_seen_at: at })
    const me = await request('/auth/me', { headers: { Cookie: cookie(loggedIn) } })
    expect(await me.json()).toEqual({ user: { ...profile, must_change_password: false } })
    expect((await login({ username: profile.username, password })).status).toBe(401)
    expect((await login({ username: profile.username, password: nextPassword })).status).toBe(200)
    for (const secret of [password, nextPassword, testPepper, updated!.password_salt, updated!.password_digest]) {
      expect(JSON.stringify([...response.headers])).not.toContain(secret)
    }
  })

  it('rejects wrong current password without changing credentials', async () => {
    const loggedIn = await login()
    const response = await changePassword({ current_password: 'wrong', new_password: 'new-password' }, cookie(loggedIn))
    expect(response.status).toBe(401)
    expect(await response.json()).toEqual({ error: { code: 'INVALID_CREDENTIALS', message: 'Invalid current password.' } })
    expect(await repositories.users.findById(profile.id)).toMatchObject(credential)
  })

  it.each([undefined, 'relai_session=invalid'])('requires a valid session for password change', async sessionCookie => {
    const response = await changePassword({ current_password: password, new_password: 'new-password' }, sessionCookie)
    expect(response.status).toBe(401)
    expect(await response.json()).toEqual(unauthorized)
    expect(await repositories.users.findById(profile.id)).toMatchObject(credential)
  })

  it('rejects disabled users even with an existing session', async () => {
    const loggedIn = await login()
    await repositories.users.setActive(profile.id, 0, at)
    const response = await changePassword({ current_password: password, new_password: 'new-password' }, cookie(loggedIn))
    expect(response.status).toBe(401)
    expect(await response.json()).toEqual(unauthorized)
    expect(await repositories.users.findById(profile.id)).toMatchObject(credential)
  })

  it.each([{}, { current_password: password }, { current_password: password, new_password: '1234567' },
    { current_password: '', new_password: 'new-password' },
    { current_password: password, new_password: 12345678 }])('validates password-change input', async body => {
    const loggedIn = await login()
    const response = await changePassword(body, cookie(loggedIn))
    expect(response.status).toBe(400)
    expect(await response.json()).toEqual({ error: { code: 'INVALID_INPUT', message: 'Invalid password change request.' } })
    expect(await repositories.users.findById(profile.id)).toMatchObject(credential)
  })

  it.each([
    { name: 'seven ASCII code points', newPassword: '1234567', valid: false },
    { name: 'seven code points including astral emoji', newPassword: 'a😀😀😀😀😀😀', valid: false },
    { name: 'four astral emoji despite eight UTF-16 units', newPassword: '😀😀😀😀', valid: false },
    { name: 'eight ASCII code points', newPassword: '12345678', valid: true },
    { name: 'eight code points including astral emoji', newPassword: 'a😀😀😀😀😀😀😀', valid: true },
  ])('uses Unicode code points for the new-password minimum: $name', async ({ newPassword, valid }) => {
    const loggedIn = await login()
    const response = await changePassword({ current_password: password, new_password: newPassword }, cookie(loggedIn))
    expect(response.status).toBe(valid ? 200 : 400)
    const stored = await repositories.users.findById(profile.id)
    if (valid) {
      expect(await response.json()).toEqual({ user: profile })
      expect(await authCrypto.verifyPassword(newPassword, stored!, testPepper)).toBe(true)
      expect((await login({ username: profile.username, password })).status).toBe(401)
    } else {
      expect(await response.json()).toEqual({ error: { code: 'INVALID_INPUT', message: 'Invalid password change request.' } })
      expect(stored).toMatchObject(credential)
    }
  })

  it('offers a reusable onboarding guard without blocking auth endpoints', async () => {
    const product = new Hono<AuthEnv>()
    product.get('/ready', requireAuth, requirePasswordChanged, c => c.json({ id: c.get('user').id }))
    app.route('/relaiapp/api/v1', product)
    await repositories.users.updateCredential(profile.id, { ...credential, must_change_password: true, updated_at: at })
    const loggedIn = await login()
    expect((await request('/auth/me', { headers: { Cookie: cookie(loggedIn) } })).status).toBe(200)
    const blocked = await request('/ready', { headers: { Cookie: cookie(loggedIn) } })
    expect(blocked.status).toBe(403)
    expect(await blocked.json()).toEqual({ error: { code: 'PASSWORD_CHANGE_REQUIRED', message: 'Password change required.' } })
    expect((await changePassword({ current_password: password, new_password: 'new-password' }, cookie(loggedIn))).status).toBe(200)
    expect((await request('/ready', { headers: { Cookie: cookie(loggedIn) } })).status).toBe(200)
  })

  it('preserves username and password exactly and ignores client authorization fields', async () => {
    await repositories.users.create({ ...profile, id: 'spaced', username: ' Beta ', ...credential,
      created_at: at, updated_at: at })
    const result = await login({ username: ' Beta ', password, user_id: 'attacker' })
    expect(result.status).toBe(200)
    expect(await result.json()).toEqual({ user: { ...profile, id: 'spaced', username: ' Beta ' } })
    expect((await login({ username: 'beta', password })).status).toBe(401)
    expect((await login({ username: profile.username, password: password.trim() })).status).toBe(401)
  })

  it.each(['wrong-password', 'nonexistent', 'disabled'])('uses identical failures and verifies crypto for %s', async scenario => {
    if (scenario === 'disabled') await repositories.users.setActive(profile.id, 0, at)
    const verify = vi.spyOn(authCrypto, 'verifyPassword')
    const hmacVerify = vi.spyOn(crypto.subtle, 'verify')
    const response = await login({ username: scenario === 'nonexistent' ? 'missing' : profile.username,
      password: scenario === 'wrong-password' ? 'wrong' : password })
    expect(response.status).toBe(401)
    expect(await response.json()).toEqual(invalidCredentials)
    expect(verify).toHaveBeenCalledTimes(1)
    expect(hmacVerify).toHaveBeenCalledTimes(1)
    expect(verify.mock.calls[0][1]).toMatchObject(scenario === 'nonexistent'
      ? { password_salt: 'AAECAwQFBgcICQoLDA0ODw',
        password_digest: 'v1:4c0e8ae7c9489938b1148df12255433d4f5522a53acec7d596bec831a0999caa' }
      : credential)
    expect(response.headers.get('set-cookie')).toBeNull()
    expect(sqlite.prepare('SELECT * FROM sessions').all()).toEqual([])
    expect(await repositories.users.findById(profile.id)).toMatchObject({ last_login_at: null })
  })

  it('never authenticates a nonexistent user even if the synthetic verification succeeds', async () => {
    env.AUTH_PEPPER = 'test-only-pepper'
    const verify = vi.spyOn(crypto.subtle, 'verify')
    const response = await login({ username: 'missing', password: ' test password\u0000愛🍀 ' })
    expect(verify).toHaveResolvedWith(true)
    expect(response.status).toBe(401)
    expect(await response.json()).toEqual(invalidCredentials)
    expect(sqlite.prepare('SELECT * FROM sessions').all()).toEqual([])
  })

  it('never authenticates a nonexistent user even if the synthetic verification succeeds', async () => {
    env.AUTH_PEPPER = 'test-only-pepper'
    const verify = vi.spyOn(crypto.subtle, 'verify')
    const response = await login({ username: 'missing', password: ' test password\u0000愛🍀 ' })
    expect(verify).toHaveResolvedWith(true)
    expect(response.status).toBe(401)
    expect(await response.json()).toEqual(invalidCredentials)
    expect(sqlite.prepare('SELECT * FROM sessions').all()).toEqual([])
  })

  it.each([{}, null, [], '', { username: '', password }, { username: 'Beta', password: '' },
    { username: 1, password }, { username: 'Beta', password: 1 }, { username: 'Beta' }])(
    'rejects invalid input safely: %j', async body => {
      const response = await login(body)
      expect(response.status).toBe(400)
      expect(await response.json()).toEqual({ error: { code: 'INVALID_INPUT', message: 'Invalid login request.' } })
      expect(response.headers.get('set-cookie')).toBeNull()
    })

  it.each(['', '{invalid-json'])('rejects malformed JSON safely', async body => {
    const response = await request('/auth/login', { method: 'POST', body })
    expect(response.status).toBe(400)
    expect(await response.json()).toEqual({ error: { code: 'INVALID_INPUT', message: 'Invalid login request.' } })
  })

  it.each(['', undefined])('fails safely without AUTH_PEPPER', async pepper => {
    Object.assign(env, { AUTH_PEPPER: pepper })
    const response = await login()
    expect(response.status).toBe(500)
    expect(await response.json()).toEqual(serverError)
    expect(response.headers.get('set-cookie')).toBeNull()
    expect(sqlite.prepare('SELECT * FROM sessions').all()).toEqual([])
  })

  it.each(['lookup', 'insert', 'crypto'])('sanitizes %s failures with no cookie', async step => {
    if (step === 'crypto') vi.spyOn(crypto.subtle, 'verify').mockRejectedValue(new Error(password))
    else failSql(sql => step === 'lookup' ? sql.includes('FROM users') : sql.startsWith('INSERT INTO sessions'))
    const response = await login()
    expect(response.status).toBe(500)
    expect(await response.json()).toEqual(serverError)
    expect(response.headers.get('set-cookie')).toBeNull()
    expect(sqlite.prepare('SELECT * FROM sessions').all()).toEqual([])
  })

  it.each(['throw', 'zero-changes', 'cleanup-fails'])('cleans up new sessions after bookkeeping failure (%s)', async mode => {
    if (mode === 'zero-changes') {
      const prepare = db.prepare
      vi.spyOn(db, 'prepare').mockImplementation(sql => sql.startsWith('UPDATE users SET last_login_at')
        ? { ...prepare(sql), bind: () => ({ ...prepare(sql), run: async () => ({ success: true, meta: { changes: 0 } }) }) }
        : prepare(sql))
    } else failSql(sql => sql.startsWith('UPDATE users SET last_login_at')
      || (mode === 'cleanup-fails' && sql.startsWith('DELETE FROM sessions')))
    const response = await login()
    expect(response.status).toBe(500)
    expect(await response.json()).toEqual(serverError)
    expect(response.headers.get('set-cookie')).toBeNull()
    expect(sqlite.prepare('SELECT * FROM sessions').all()).toHaveLength(mode === 'cleanup-fails' ? 1 : 0)
  })

  it('me uses typed validated identity, records last seen, and keeps fixed expiry/token', async () => {
    // A second route demonstrates reuse of the typed safe identity boundary.
    const protectedRoutes = new Hono<AuthEnv>()
    protectedRoutes.get('/identity', requireAuth, c => c.json({ user: c.get('user') }))
    app.route('/relaiapp/api/v1', protectedRoutes)
    const loggedIn = await login()
    const before = await sessionFrom(loggedIn)
    vi.setSystemTime(new Date('2026-09-30T10:00:00.000Z'))
    for (const path of ['/auth/me?user_id=attacker', '/identity?user_id=attacker']) {
      const response = await request(path, { headers: { Cookie: cookie(loggedIn), 'X-User-Id': 'attacker',
        Authorization: 'Bearer attacker' } })
      expect(response.status).toBe(200)
      expect(await response.json()).toEqual({ user: profile })
      expect(response.headers.get('set-cookie')).toBeNull()
    }
    expect(await sessionFrom(loggedIn)).toEqual({ ...before, last_seen_at: '2026-09-30T10:00:00.000Z' })
  })

  it.each([undefined, '', 'other=value', 'relai_session=', 'relai_session=short',
    `relai_session=${'a'.repeat(64)}`, `relai_session=${'A'.repeat(42)}B`,
    `relai_session=${'A'.repeat(43)}=`, `relai_session=${'A'.repeat(42)}%41`,
    `relai_session=${'A'.repeat(43)}; relai_session=${'A'.repeat(43)}`])(
    'rejects missing/malformed cookies before persistence: %s', async value => {
      const prepare = vi.spyOn(db, 'prepare')
      const response = await request('/auth/me', { headers: value === undefined ? {} : { Cookie: value } })
      expect(response.status).toBe(401)
      expect(await response.json()).toEqual(unauthorized)
      expect(prepare).not.toHaveBeenCalled()
      expect(response.headers.get('set-cookie')).toBeNull()
    })

  it('rejects unknown and revoked sessions and ignores Bearer/client user IDs', async () => {
    const loggedIn = await login()
    await repositories.sessions.revokeByTokenDigest(await authCrypto.digestSessionToken(tokenFrom(loggedIn)))
    const inputs: HeadersInit[] = [{ Cookie: cookie(loggedIn) }, { Cookie: `relai_session=${authCrypto.generateSessionToken()}` },
      { Authorization: `Bearer ${tokenFrom(loggedIn)}`, 'X-User-Id': profile.id }]
    for (const headers of inputs) {
      const response = await request(`/auth/me?user_id=${profile.id}`, { headers })
      expect(response.status).toBe(401)
      expect(await response.json()).toEqual(unauthorized)
    }
  })

  it('returns current user fields and accepts a session immediately before fixed expiry', async () => {
    const loggedIn = await login()
    sqlite.prepare('UPDATE users SET display_name = ?, role = ? WHERE id = ?').run('Updated Name', 'admin', profile.id)
    vi.setSystemTime(new Date(Date.parse(expiry) - 1))
    const response = await request('/auth/me', { headers: { Cookie: `other=value; ${cookie(loggedIn)}` } })
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ user: { ...profile, display_name: 'Updated Name', role: 'admin' } })
    expect(response.headers.get('set-cookie')).toBeNull()
    expect(await sessionFrom(loggedIn)).toMatchObject({ expires_at: expiry })
  })

  it('rejects a session revoked between lookup and last-seen bookkeeping', async () => {
    const loggedIn = await login()
    const prepare = db.prepare
    vi.spyOn(db, 'prepare').mockImplementation(sql => {
      if (sql.startsWith('UPDATE sessions')) sqlite.exec('DELETE FROM sessions')
      return prepare(sql)
    })
    const response = await request('/auth/me', { headers: { Cookie: cookie(loggedIn) } })
    expect(response.status).toBe(401)
    expect(await response.json()).toEqual(unauthorized)
  })

  it('returns current user fields and accepts a session immediately before fixed expiry', async () => {
    const loggedIn = await login()
    sqlite.prepare('UPDATE users SET display_name = ?, role = ? WHERE id = ?').run('Updated Name', 'admin', profile.id)
    vi.setSystemTime(new Date(Date.parse(expiry) - 1))
    const response = await request('/auth/me', { headers: { Cookie: `other=value; ${cookie(loggedIn)}` } })
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ user: { ...profile, display_name: 'Updated Name', role: 'admin' } })
    expect(response.headers.get('set-cookie')).toBeNull()
    expect(await sessionFrom(loggedIn)).toMatchObject({ expires_at: expiry })
  })

  it('rejects a session revoked between lookup and last-seen bookkeeping', async () => {
    const loggedIn = await login()
    const prepare = db.prepare
    vi.spyOn(db, 'prepare').mockImplementation(sql => {
      if (sql.startsWith('UPDATE sessions')) sqlite.exec('DELETE FROM sessions')
      return prepare(sql)
    })
    const response = await request('/auth/me', { headers: { Cookie: cookie(loggedIn) } })
    expect(response.status).toBe(401)
    expect(await response.json()).toEqual(unauthorized)
  })

  it.each(['expired', 'at-expiry', 'invalid-expiry', 'disabled', 'missing-user'])('rejects and revokes %s sessions', async state => {
    const loggedIn = await login()
    if (state === 'expired') vi.setSystemTime(new Date('2026-10-07T10:00:00.000Z'))
    if (state === 'at-expiry') vi.setSystemTime(new Date(expiry))
    if (state === 'invalid-expiry') sqlite.prepare('UPDATE sessions SET expires_at = ?').run('invalid')
    if (state === 'disabled') await repositories.users.setActive(profile.id, 0, at)
    if (state === 'missing-user') {
      // Model an orphan without relying on the normal schema cascade to remove it.
      sqlite.exec('PRAGMA foreign_keys = OFF')
      sqlite.prepare('DELETE FROM users WHERE id = ?').run(profile.id)
      expect(await sessionFrom(loggedIn)).not.toBeNull()
    }
    const response = await request('/auth/me', { headers: { Cookie: cookie(loggedIn) } })
    expect(response.status).toBe(401)
    expect(await response.json()).toEqual(unauthorized)
    expect(await sessionFrom(loggedIn)).toBeNull()
    expect(response.headers.get('set-cookie')).toBeNull()
  })

  it('still rejects disabled sessions when revocation fails', async () => {
    const loggedIn = await login()
    await repositories.users.setActive(profile.id, 0, at)
    failSql(sql => sql.startsWith('DELETE FROM sessions'))
    const response = await request('/auth/me', { headers: { Cookie: cookie(loggedIn) } })
    expect(response.status).toBe(401)
    expect(await response.json()).toEqual(unauthorized)
  })

  it.each(['session-lookup', 'user-lookup', 'last-seen'])('sanitizes me %s persistence failures', async step => {
    const loggedIn = await login()
    failSql(sql => step === 'session-lookup' ? sql.includes('FROM sessions')
      : step === 'user-lookup' ? sql.includes('FROM users') : sql.startsWith('UPDATE sessions'))
    const response = await request('/auth/me', { headers: { Cookie: cookie(loggedIn) } })
    expect(response.status).toBe(500)
    expect(await response.json()).toEqual(serverError)
    expect(response.headers.get('set-cookie')).toBeNull()
  })

  it.each(['https', 'http'])('revokes and clears a session idempotently on %s', async protocol => {
    const loggedIn = await login(undefined, protocol)
    for (let attempt = 0; attempt < 2; attempt++) {
      const response = await request('/auth/logout', { method: 'POST', headers: { Cookie: cookie(loggedIn) } }, protocol)
      expect(response.status).toBe(204)
      expect(await response.text()).toBe('')
      expectCookie(response, protocol === 'https', true)
      expect(await sessionFrom(loggedIn)).toBeNull()
    }
  })

  it('logout revokes only the supplied cookie session', async () => {
    const first = await login()
    const second = await login()
    const response = await request('/auth/logout?user_id=attacker', { method: 'POST', headers: { Cookie: cookie(first) },
      body: JSON.stringify({ user_id: profile.id }) })
    expect(response.status).toBe(204)
    expect(await sessionFrom(first)).toBeNull()
    expect(await sessionFrom(second)).not.toBeNull()
  })

  it('logout revokes only the supplied cookie session', async () => {
    const first = await login()
    const second = await login()
    const response = await request('/auth/logout?user_id=attacker', { method: 'POST', headers: { Cookie: cookie(first) },
      body: JSON.stringify({ user_id: profile.id }) })
    expect(response.status).toBe(204)
    expect(await sessionFrom(first)).toBeNull()
    expect(await sessionFrom(second)).not.toBeNull()
  })

  it.each([undefined, 'relai_session=malformed', `relai_session=${'A'.repeat(43)}`])(
    'clears missing/malformed/unknown cookies with empty 204', async value => {
      const response = await request('/auth/logout', { method: 'POST',
        headers: value === undefined ? {} : { Cookie: value } })
      expect(response.status).toBe(204)
      expect(await response.text()).toBe('')
      expectCookie(response, true, true)
    })

  it('clears the cookie even when logout encounters an internal failure', async () => {
    const loggedIn = await login()
    failSql(sql => sql.startsWith('DELETE FROM sessions'))
    const response = await request('/auth/logout', { method: 'POST', headers: { Cookie: cookie(loggedIn) } })
    expect(response.status).toBe(500)
    expect(await response.json()).toEqual(serverError)
    expectCookie(response, true, true)
  })

  it('keeps health public and unknown/register/product routes safely absent', async () => {
    expect((await app.request('/relaiapp/api/v1/health')).status).toBe(200)
    for (const path of ['/auth/register', '/auth/signup', '/unknown', '/cards', '/stats', '/settings']) {
      const response = await request(path, { method: 'POST' })
      expect(response.status).toBe(404)
      expect(await response.json()).toEqual({ error: { code: 'NOT_FOUND', message: 'API route not found.' } })
    }
  })

  it('keeps route SQL and auth internals outside client code', () => {
    const routes = readFileSync('src/worker/routes/auth.ts', 'utf8')
    expect(routes).not.toMatch(/SELECT|INSERT|UPDATE|DELETE|\.prepare\(/)
    function inspect(directory: string) {
      for (const entry of readdirSync(directory, { withFileTypes: true })) {
        const path = join(directory, entry.name)
        if (entry.isDirectory()) { inspect(path); continue }
        if (!/\.tsx?$/.test(entry.name) || entry.name.endsWith('.test.ts')) continue
        const source = readFileSync(path, 'utf8')
        expect(source).not.toMatch(/AUTH_PEPPER|password_salt|password_digest|relai_session|Bearer|worker\/auth/)
        expect(source).not.toMatch(/localStorage\.(setItem|getItem)\(['"](?:token|access_token|session_token)/)
      }
    }
    inspect('src/client')
  })
})
