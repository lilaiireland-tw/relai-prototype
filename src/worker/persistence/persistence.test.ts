import { readFileSync } from 'node:fs'
import { DatabaseSync } from 'node:sqlite'
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
    sqlite.exec(readFileSync('migrations/0001_initial_core_schema.sql', 'utf8'))
    repositories = createRepositories(sqliteD1(sqlite))
  })
  afterEach(() => sqlite.close())

  it('creates and looks up users with schema defaults and nullable fields', async () => {
    const row = await repositories.users.create(user)
    expect(row).toEqual({ ...user, role: 'user', is_active: 1, cohort_source: null, last_login_at: null })
    expect(await repositories.users.findById(user.id)).toEqual(row)
    expect(await repositories.users.findByUsername(user.username)).toEqual(row)
    expect(await repositories.users.findById('missing')).toBeNull()
    expect(await repositories.users.findByUsername('missing')).toBeNull()
  })

  it('preserves explicit account values including inactive status', async () => {
    expect(await repositories.users.create({ ...user, role: 'admin', is_active: 0,
      cohort_source: 'internal_beta', last_login_at: at })).toMatchObject({
      role: 'admin', is_active: 0, cohort_source: 'internal_beta', last_login_at: at,
    })
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
      role: 'user', is_active: 0, cohort_source: null, last_login_at: later,
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
    return { bind() { return this }, first, run }
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
