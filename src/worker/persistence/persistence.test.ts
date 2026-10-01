import { readdirSync, readFileSync } from 'node:fs'
import { DatabaseSync } from 'node:sqlite'
import { createHash } from 'node:crypto'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createRepositories, tokenDigest, type CreateUserInput, type TokenDigest } from './index'
import { insertRow, mutate, type PersistenceDatabase, type PersistenceStatement, type SqlValue } from './d1'

/** Real SQLite executes repository SQL; only the small D1 transport is simulated. */
function sqliteD1(sqlite: DatabaseSync): PersistenceDatabase {
  function statement(sql: string, values: SqlValue[] = []): PersistenceStatement {
    return {
      bind: (...bound) => statement(sql, bound),
      async first<T>() {
        return (sqlite.prepare(sql).get(...values) as T | undefined) ?? null
      },
      async all<T>() {
        return { success: true, results: sqlite.prepare(sql).all(...values) as T[] }
      },
      async run() {
        const result = sqlite.prepare(sql).run(...values)
        return { success: true, meta: { changes: Number(result.changes) } }
      },
    }
  }
  return { prepare: (sql) => statement(sql) }
}

const at = '2026-09-29T10:00:00.000Z'
const later = '2026-09-29T11:00:00.000Z'
const digest = tokenDigest('a'.repeat(64))
const otherDigest = tokenDigest('b'.repeat(64))
const user: CreateUserInput = {
  id: 'user-1', username: 'beta', display_name: 'Beta', password_salt: 'salt',
  password_digest: 'credential-digest', created_at: at, updated_at: at,
}
const session = {
  id: 'session-1', user_id: user.id, token_digest: digest, created_at: at, expires_at: later,
}

describe('users and sessions persistence', () => {
  let sqlite: DatabaseSync
  let repositories: ReturnType<typeof createRepositories>

  beforeEach(() => {
    sqlite = new DatabaseSync(':memory:')
    for (const name of readdirSync('migrations').filter(name => name.endsWith('.sql')).sort()) {
      sqlite.exec(readFileSync(`migrations/${name}`, 'utf8'))
    }
    repositories = createRepositories(sqliteD1(sqlite))
  })
  afterEach(() => sqlite.close())

  it('keeps migration history append-only and migrates existing users to false', async () => {
    const initial = readFileSync('migrations/0001_initial_core_schema.sql', 'utf8')
    // Git checkouts may use CRLF; pin the committed SQL content independent of line endings.
    expect(createHash('sha256').update(initial.replace(/\r\n/g, '\n')).digest('hex')).toBe(
      'ac5b16e3b0d8c264a271d6dd7fef4df55ecd5428654097dd42d6ff0c75a14337')
    expect(readdirSync('migrations').filter(name => name.endsWith('.sql')).sort()).toEqual([
      '0001_initial_core_schema.sql', '0002_add_users_must_change_password.sql',
      '0003_add_cefr_j_vocabulary_foundation.sql',
    ])
    const legacy = new DatabaseSync(':memory:')
    try {
      legacy.exec(initial)
      legacy.prepare(`INSERT INTO users (id, username, display_name, password_salt,
        password_digest, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)`)
        .run(user.id, user.username, user.display_name, user.password_salt, user.password_digest, at, at)
      const before = legacy.prepare('SELECT * FROM users').get()!
      legacy.exec(readFileSync('migrations/0002_add_users_must_change_password.sql', 'utf8'))
      expect(legacy.prepare('SELECT * FROM users').get()).toEqual({ ...before, must_change_password: 0 })
      const users = createRepositories(sqliteD1(legacy)).users
      expect(await users.findById(user.id)).toEqual({ ...before, must_change_password: false })
      // Old SQL callers that omit the column continue to receive the database default.
      legacy.prepare(`INSERT INTO users (id, username, display_name, password_salt,
        password_digest, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)`)
        .run('old-caller', 'other', 'Other', 'salt', 'digest', at, at)
      expect(await users.findById('old-caller')).toMatchObject({ must_change_password: false })
    } finally { legacy.close() }
  })

  it.each([true, false])('creates and reads password-change state %s as a boolean', async flag => {
    const row = await repositories.users.create({ ...user, must_change_password: flag })
    expect(row.must_change_password).toBe(flag)
    expect(sqlite.prepare('SELECT must_change_password FROM users WHERE id = ?').get(user.id))
      .toEqual({ must_change_password: flag ? 1 : 0 })
    expect(await repositories.users.findById(user.id)).toEqual(row)
    expect(await repositories.users.findByUsername(user.username)).toEqual(row)
  })

  it.each([true, false])('updates credentials and all state together from flag %s', async initialFlag => {
    const before = await repositories.users.create({ ...user, must_change_password: initialFlag })
    const other = await repositories.users.create({ ...user, id: 'other', username: 'other' })
    const input = { password_salt: "salt'); DROP TABLE users; --", password_digest: 'fresh-digest',
      must_change_password: !initialFlag, updated_at: later }
    expect(await repositories.users.updateCredential("' OR 1=1 --", input)).toEqual({ changes: 0 })
    expect(await repositories.users.findById(user.id)).toEqual(before)
    expect(await repositories.users.updateCredential(user.id, input)).toEqual({ changes: 1 })
    expect(await repositories.users.findById(user.id)).toEqual({ ...before, ...input })
    expect(sqlite.prepare('SELECT password_salt, password_digest, must_change_password, updated_at FROM users WHERE id = ?')
      .get(user.id)).toEqual({ ...input, must_change_password: input.must_change_password ? 1 : 0 })
    expect(await repositories.users.findById(other.id)).toEqual(other)
    expect(await repositories.users.updateCredential('missing', input)).toEqual({ changes: 0 })
    // Legacy admin replacement preserves the flag instead of choosing onboarding policy.
    await repositories.users.replaceCredential(user.id, { ...input, password_digest: 'legacy-digest' })
    expect(await repositories.users.findById(user.id)).toMatchObject({ must_change_password: !initialFlag })
  })

  it('keeps the account projection fixed without selecting credential fields', async () => {
    await repositories.users.create({ ...user, must_change_password: true })
    expect(await repositories.users.listAccounts()).toEqual([{
      id: user.id, username: user.username, display_name: user.display_name, role: 'user', is_active: 1,
      cohort_source: null, created_at: at, updated_at: at, last_login_at: null,
    }])
  })

  it('leaves all credential fields unchanged when the combined update fails', async () => {
    const before = await repositories.users.create({ ...user, must_change_password: true })
    // Test-only trigger simulates a database rejection during the single UPDATE.
    sqlite.exec(`CREATE TRIGGER reject_credential BEFORE UPDATE OF password_digest ON users
      BEGIN SELECT RAISE(ABORT, 'synthetic failure'); END`)
    await expect(repositories.users.updateCredential(user.id, {
      password_salt: 'fresh-salt', password_digest: 'fresh-digest',
      must_change_password: false, updated_at: later,
    })).rejects.toThrow('synthetic failure')
    expect(await repositories.users.findById(user.id)).toEqual(before)
  })

  it('creates and looks up users with schema defaults and nullable fields', async () => {
    const row = await repositories.users.create(user)
    expect(row).toEqual({ ...user, must_change_password: false, role: 'user', is_active: 1, cohort_source: null, last_login_at: null })
    expect(await repositories.users.findById(user.id)).toEqual(row)
    expect(await repositories.users.findByUsername(user.username)).toEqual(row)
    expect(await repositories.users.findById('missing')).toBeNull()
    expect(await repositories.users.findByUsername('missing')).toBeNull()
  })

  it('round-trips unrestricted role and cohort TEXT values including inactive status', async () => {
    const input = { ...user, role: 'custom-role', is_active: 0 as const,
      cohort_source: 'custom-cohort', last_login_at: at }
    const row = await repositories.users.create(input)
    expect(row).toEqual({ ...input, must_change_password: false })
    expect(await repositories.users.findById(user.id)).toEqual({ ...input, must_change_password: false })
    expect(await repositories.users.findByUsername(user.username)).toEqual({ ...input, must_change_password: false })
  })

  it('updates only approved login, credential and activation fields', async () => {
    await repositories.users.create(user)
    expect(await repositories.users.recordLogin(user.id, later)).toEqual({ changes: 1 })
    expect(await repositories.users.replaceCredential(user.id, {
      password_salt: 'new-salt', password_digest: 'new-digest', updated_at: later,
    })).toEqual({ changes: 1 })
    expect(await repositories.users.setActive(user.id, 0, later)).toEqual({ changes: 1 })
    expect(await repositories.users.findById(user.id)).toEqual({ ...user,
      password_salt: 'new-salt', password_digest: 'new-digest', updated_at: later,
      must_change_password: false, role: 'user', is_active: 0, cohort_source: null, last_login_at: later,
    })
    expect(await repositories.users.recordLogin('missing', later)).toEqual({ changes: 0 })
    expect(await repositories.users.setActive('missing', 0, later)).toEqual({ changes: 0 })
    expect(await repositories.users.replaceCredential('missing', user)).toEqual({ changes: 0 })
  })

  it('binds SQL-looking user data literally for creates and lookups', async () => {
    const username = "beta'); DROP TABLE users; --"
    const row = await repositories.users.create({ ...user, username })
    expect(await repositories.users.findByUsername(username)).toEqual(row)
    expect(await repositories.users.findByUsername("' OR 1=1 --")).toBeNull()
    expect(await repositories.users.findById("' OR 1=1 --")).toBeNull()
  })

  it('surfaces unique constraint failures without overwriting existing rows', async () => {
    await repositories.users.create(user)
    await expect(repositories.users.create({ ...user, id: 'user-2' })).rejects.toThrow()
    await expect(repositories.users.create({ ...user, username: 'other' })).rejects.toThrow()
    await repositories.sessions.create(session)
    await expect(repositories.sessions.create({ ...session, id: 'session-2' })).rejects.toThrow()
    await expect(repositories.sessions.create({ ...session, token_digest: otherDigest })).rejects.toThrow()
    expect(await repositories.sessions.findByTokenDigest(digest)).toMatchObject(session)
  })

  it('creates and reads session timing fields without applying auth policy', async () => {
    const row = await repositories.sessions.create(session)
    expect(row).toEqual({ ...session, last_seen_at: null })
    expect(await repositories.sessions.findByTokenDigest(digest)).toEqual(row)
    expect(await repositories.sessions.findByTokenDigest(otherDigest)).toBeNull()
    expect(await repositories.sessions.recordLastSeen(session.id, 'other-user', later)).toEqual({ changes: 0 })
    expect(await repositories.sessions.recordLastSeen(session.id, user.id, later)).toEqual({ changes: 1 })
    expect(await repositories.sessions.findByTokenDigest(digest)).toEqual({ ...session, last_seen_at: later })
    expect(await repositories.sessions.recordLastSeen('missing', user.id, later)).toEqual({ changes: 0 })
    expect(await repositories.sessions.create({ ...session, id: 'session-2',
      token_digest: otherDigest, last_seen_at: at })).toMatchObject({ last_seen_at: at })
  })

  it('revokes one digest idempotently and keeps other sessions', async () => {
    await repositories.sessions.create(session)
    await repositories.sessions.create({ ...session, id: 'session-2', token_digest: otherDigest })
    expect(await repositories.sessions.revokeByTokenDigest(digest)).toEqual({ changes: 1 })
    expect(await repositories.sessions.revokeByTokenDigest(digest)).toEqual({ changes: 0 })
    expect(await repositories.sessions.findByTokenDigest(digest)).toBeNull()
    expect(await repositories.sessions.findByTokenDigest(otherDigest)).not.toBeNull()
  })

  it('revokes all sessions for exactly one user with bound ownership values', async () => {
    await repositories.sessions.create(session)
    await repositories.sessions.create({ ...session, id: 'session-2', token_digest: otherDigest })
    const thirdDigest = tokenDigest('c'.repeat(64))
    await repositories.sessions.create({ ...session, id: 'session-3', user_id: 'user-2', token_digest: thirdDigest })
    expect(await repositories.sessions.revokeForUser("' OR 1=1 --")).toEqual({ changes: 0 })
    expect(await repositories.sessions.revokeForUser(user.id)).toEqual({ changes: 2 })
    expect(await repositories.sessions.revokeForUser(user.id)).toEqual({ changes: 0 })
    expect(await repositories.sessions.findByTokenDigest(digest)).toBeNull()
    expect(await repositories.sessions.findByTokenDigest(otherDigest)).toBeNull()
    expect(await repositories.sessions.findByTokenDigest(thirdDigest)).not.toBeNull()
  })

  it('rejects raw tokens at the digest boundary and at every digest repository entry', async () => {
    expect(() => tokenDigest('raw-session-token')).toThrow('Invalid session token digest.')
    expect(() => tokenDigest('A'.repeat(64))).toThrow()
    const raw = 'raw-session-token' as TokenDigest
    expect(() => repositories.sessions.create({ ...session, token_digest: raw })).toThrow()
    expect(() => repositories.sessions.findByTokenDigest(raw)).toThrow()
    expect(() => repositories.sessions.revokeByTokenDigest(raw)).toThrow()
    expect(await repositories.sessions.findByTokenDigest(digest)).toBeNull()
  })

  it('requires a branded digest at compile time', () => {
    // @ts-expect-error Raw strings are not digest inputs.
    const invalid: typeof session = { ...session, token_digest: 'raw-token' }
    expect(invalid.token_digest).toBe('raw-token')
  })
})

describe('shared D1 result behavior', () => {
  function fake(first: PersistenceStatement['first'], run: PersistenceStatement['run']): PersistenceStatement {
    return { bind() { return this }, first, run, async all() { return { success: false, results: [] } } }
  }

  it('rejects a missing insert result and unsuccessful mutation', async () => {
    const statement = fake(async () => null, async () => ({ success: false, meta: { changes: 0 } }))
    await expect(insertRow(statement)).rejects.toThrow('Persistence insert returned no row.')
    await expect(mutate(statement)).rejects.toThrow('Persistence mutation failed.')
  })

  it('propagates rejected D1 reads and writes rather than treating them as missing data', async () => {
    const error = new Error('D1 unavailable')
    const statement = fake(async () => { throw error }, async () => { throw error })
    const repositories = createRepositories({ prepare: () => statement })
    await expect(repositories.users.findById('user')).rejects.toBe(error)
    await expect(repositories.sessions.findByTokenDigest(digest)).rejects.toBe(error)
    await expect(repositories.users.create(user)).rejects.toBe(error)
    await expect(repositories.sessions.revokeForUser('user')).rejects.toBe(error)
  })
})
