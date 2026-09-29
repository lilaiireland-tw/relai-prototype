import { readFileSync } from 'node:fs'
import { DatabaseSync } from 'node:sqlite'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createRepositories, tokenDigest } from '../src/worker/persistence'
import type { PersistenceDatabase, PersistenceStatement, SqlValue } from '../src/worker/persistence/d1'
import { verifyPassword } from '../src/worker/auth/crypto'
import { generatePassword, parseArguments, runManageUser } from './manage-user'

vi.mock('wrangler', () => ({ getPlatformProxy: vi.fn(() => { throw new Error('Remote access forbidden in tests') }) }))

function localD1(sqlite: DatabaseSync): PersistenceDatabase {
  function statement(sql: string, values: SqlValue[] = []): PersistenceStatement {
    return {
      bind: (...bound) => statement(sql, bound),
      async first<T>() { return (sqlite.prepare(sql).get(...values) as T | undefined) ?? null },
      async all<T>() { return { success: true, results: sqlite.prepare(sql).all(...values) as T[] } },
      async run() { return { success: true, meta: { changes: Number(sqlite.prepare(sql).run(...values).changes) } } },
    }
  }
  return { prepare: (sql) => statement(sql) }
}

describe('offline admin account management', () => {
  let sqlite: DatabaseSync
  let db: PersistenceDatabase
  let repositories: ReturnType<typeof createRepositories>
  const output = vi.fn<(text: string) => void>()
  const error = vi.fn<(text: string) => void>()
  const dispose = vi.fn(async () => {})
  const openPlatform = vi.fn(async () => ({ env: { DB: db }, dispose }))
  const create = ['create', '--username', 'Alex', '--display-name', 'Alex']
  const logs = ['log', 'warn', 'error', 'debug', 'info'] as const

  beforeEach(() => {
    vi.clearAllMocks()
    // Ephemeral test-only material, never printed or serialized as a fixture.
    vi.stubEnv('AUTH_PEPPER', crypto.randomUUID())
    for (const method of logs) vi.spyOn(console, method).mockImplementation(() => {})
    sqlite = new DatabaseSync(':memory:')
    sqlite.exec(readFileSync('migrations/0001_initial_core_schema.sql', 'utf8'))
    db = localD1(sqlite)
    repositories = createRepositories(db)
  })
  afterEach(() => { sqlite.close(); vi.unstubAllEnvs(); vi.restoreAllMocks() })
  const run = (argv: string[]) => runManageUser(argv, { openPlatform, output, error })
  const password = () => output.mock.calls.at(-1)![0].split('Password: ')[1]

  it('creates active accounts with exact username, free-text cohort, defaults, UUID and UTC timestamps', async () => {
    expect(await run([...create, '--cohort-source', ' custom cohort '])).toBe(0)
    const issued = password()
    const row = (await repositories.users.findByUsername('Alex'))!
    expect(await repositories.users.findByUsername('alex')).toBeNull()
    expect(row).toMatchObject({ username: 'Alex', display_name: 'Alex', role: 'user',
      is_active: 1, cohort_source: ' custom cohort ', last_login_at: null })
    expect(row.id).toMatch(/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/)
    expect(row.created_at).toBe(new Date(row.created_at).toISOString())
    expect(row.updated_at).toBe(row.created_at)
    expect(await verifyPassword(issued, row, process.env.AUTH_PEPPER!)).toBe(true)
    expect(output).toHaveBeenCalledTimes(1)
    expect(JSON.stringify(row).includes(issued)).toBe(false)
    for (const table of ['user_stats', 'user_settings', 'flashcards']) {
      expect(sqlite.prepare(`SELECT count(*) AS count FROM ${table}`).get()!.count).toBe(0)
    }
    for (const method of logs) expect(console[method]).not.toHaveBeenCalled()
    expect(error).not.toHaveBeenCalled()
    expect(dispose).toHaveBeenCalledTimes(1)
  })

  it('uses exactly 24 random bytes, canonical unpadded base64url (192 bits)', () => {
    const random = vi.spyOn(crypto, 'getRandomValues').mockImplementation((array) => {
      const bytes = array as Uint8Array
      for (let i = 0; i < bytes.length; i++) bytes[i] = i
      return array
    })
    const issued = generatePassword()
    expect(random).toHaveBeenCalledTimes(1)
    expect((random.mock.calls[0][0] as Uint8Array).length).toBe(24)
    expect(issued).toMatch(/^[A-Za-z0-9_-]{32}$/)
    expect(Buffer.from(issued, 'base64url')).toEqual(Buffer.from(Array.from({ length: 24 }, (_, i) => i)))
    expect(Buffer.from(issued, 'base64url').toString('base64url') === issued).toBe(true)
  })

  it('rejects duplicates without issuing another password or overwriting the account', async () => {
    await run(create)
    const before = await repositories.users.findByUsername('Alex')
    output.mockClear()
    expect(await run(create)).toBe(1)
    expect(output).not.toHaveBeenCalled()
    expect(await repositories.users.findByUsername('Alex')).toEqual(before)
  })

  it('resets salt/digest, invalidates the old password, displays once and retains sessions', async () => {
    await run(create)
    const oldPassword = password()
    const before = (await repositories.users.findByUsername('Alex'))!
    await repositories.sessions.create({ id: 'session', user_id: before.id,
      token_digest: tokenDigest('a'.repeat(64)), created_at: before.created_at, expires_at: before.created_at })
    output.mockClear()
    vi.useFakeTimers(); vi.setSystemTime(new Date('2030-01-01T00:00:00Z'))
    try { expect(await run(['reset-password', '--username', 'Alex'])).toBe(0) } finally { vi.useRealTimers() }
    const after = (await repositories.users.findByUsername('Alex'))!
    expect(after.password_salt === before.password_salt).toBe(false)
    expect(after.password_digest === before.password_digest).toBe(false)
    expect(after.updated_at).toBe('2030-01-01T00:00:00.000Z')
    expect(await verifyPassword(oldPassword, after, process.env.AUTH_PEPPER!)).toBe(false)
    expect(await verifyPassword(password(), after, process.env.AUTH_PEPPER!)).toBe(true)
    expect(output).toHaveBeenCalledTimes(1)
    expect(await repositories.sessions.findByTokenDigest(tokenDigest('a'.repeat(64)))).not.toBeNull()
  })

  it('revokes all user sessions and deactivates without deletion; repeated disable is safe', async () => {
    await run(create)
    await run(['create', '--username', 'Other', '--display-name', 'Other'])
    const user = (await repositories.users.findByUsername('Alex'))!
    const other = (await repositories.users.findByUsername('Other'))!
    for (const [id, userId, hex] of [['one', user.id, 'a'], ['two', user.id, 'b'], ['other', other.id, 'c']]) {
      await repositories.sessions.create({ id, user_id: userId, token_digest: tokenDigest(hex.repeat(64)),
        created_at: user.created_at, expires_at: user.created_at })
    }
    for (let i = 0; i < 2; i++) {
      expect(await run(['disable', '--username', 'Alex'])).toBe(0)
      expect((await repositories.users.findByUsername('Alex'))!.is_active).toBe(0)
      expect(await repositories.sessions.findByTokenDigest(tokenDigest('a'.repeat(64)))).toBeNull()
      expect(await repositories.sessions.findByTokenDigest(tokenDigest('b'.repeat(64)))).toBeNull()
    }
    expect(await repositories.sessions.findByTokenDigest(tokenDigest('c'.repeat(64)))).not.toBeNull()
  })

  it('lists only safe fields, including disabled users', async () => {
    await run(create)
    await run(['disable', '--username', 'Alex'])
    output.mockClear()
    expect(await run(['list'])).toBe(0)
    const rows = JSON.parse(output.mock.calls[0][0])
    expect(Object.keys(rows[0]).sort()).toEqual(['id', 'username', 'display_name', 'role', 'is_active',
      'cohort_source', 'created_at', 'updated_at', 'last_login_at'].sort())
    expect(rows[0].is_active).toBe(0)
  })

  it.each(['reset-password', 'disable'])('uses exact lookup and fails safely for missing users: %s', async (command) => {
    await run(create); output.mockClear()
    expect(await run([command, '--username', 'alex'])).toBe(1)
    expect(output).not.toHaveBeenCalled()
  })

  it.each(['create', 'reset-password'])('never displays passwords or transport error contents on failed %s', async (command) => {
    if (command === 'reset-password') await run(create)
    output.mockClear()
    const realPrepare = db.prepare
    db.prepare = (sql) => {
      if (sql.startsWith('INSERT') || sql.startsWith('UPDATE')) throw new Error(process.env.AUTH_PEPPER)
      return realPrepare(sql)
    }
    expect(await run(command === 'create' ? create : [command, '--username', 'Alex'])).toBe(1)
    expect(output).not.toHaveBeenCalled()
    expect(error.mock.calls).toEqual([['Account operation failed; no credential output.']])
    for (const method of logs) expect(console[method]).not.toHaveBeenCalled()
  })

  it('does not display a password for an unconfirmed zero-row reset', async () => {
    await run(create); output.mockClear()
    const realPrepare = db.prepare
    db.prepare = (sql) => {
      const stmt = realPrepare(sql)
      if (sql.startsWith('UPDATE')) stmt.bind = () => ({ ...stmt, async run() { return { success: true, meta: { changes: 0 } } } })
      return stmt
    }
    expect(await run(['reset-password', '--username', 'Alex'])).toBe(1)
    expect(output).not.toHaveBeenCalled()
  })

  it('does not display a password when create returns no persisted row', async () => {
    const realPrepare = db.prepare
    db.prepare = (sql) => {
      const stmt = realPrepare(sql)
      if (sql.startsWith('INSERT')) stmt.bind = () => ({ ...stmt, async first() { return null } })
      return stmt
    }
    expect(await run(create)).toBe(1)
    expect(output).not.toHaveBeenCalled()
  })

  it('reports list failures rather than printing an empty successful list', async () => {
    db.prepare = () => ({ bind() { return this }, async first() { return null },
      async run() { return { success: false, meta: { changes: 0 } } },
      async all() { return { success: false, results: [] } } })
    expect(await run(['list'])).toBe(1)
    expect(output).not.toHaveBeenCalled()
  })

  it('fails disable safely when revocation fails and can retry', async () => {
    await run(create); output.mockClear()
    const realPrepare = db.prepare
    db.prepare = (sql) => {
      if (sql.startsWith('DELETE')) throw new Error('Transport failed')
      return realPrepare(sql)
    }
    expect(await run(['disable', '--username', 'Alex'])).toBe(1)
    expect(output).not.toHaveBeenCalled()
    db.prepare = realPrepare
    expect(await run(['disable', '--username', 'Alex'])).toBe(0)
  })

  it('reports cleanup failure without repeating credential output', async () => {
    dispose.mockRejectedValueOnce(new Error(process.env.AUTH_PEPPER))
    expect(await run(create)).toBe(1)
    expect(output).toHaveBeenCalledTimes(1)
    expect(error.mock.calls).toEqual([['Platform cleanup failed.']])
  })

  it.each(['create', 'reset-password', 'disable', 'list'])('missing pepper prevents any platform access or mutation: %s', async (command) => {
    vi.stubEnv('AUTH_PEPPER', undefined)
    expect(await run(command === 'create' ? create : command === 'list' ? ['list'] : [command, '--username', 'Alex'])).toBe(1)
    expect(openPlatform).not.toHaveBeenCalled()
    expect(output).not.toHaveBeenCalled()
  })

  it('defaults to staging and requires exact production confirmation before opening bindings', async () => {
    expect(parseArguments(['list']).environment).toBe('staging')
    await run(['list']); expect(openPlatform).toHaveBeenCalledWith('staging')
    openPlatform.mockClear()
    for (const argv of [['list', '--env', 'production'], ['list', '--env', 'production', '--confirm-production', 'wrong'],
      ['list', '--env', 'production', '--confirm-production', 'relai-prod-db '], ['list', '--env', 'preview']]) {
      expect(await run(argv)).toBe(1)
    }
    expect(openPlatform).not.toHaveBeenCalled()
    expect(await run(['list', '--env', 'production', '--confirm-production', 'relai-prod-db'])).toBe(0)
    expect(openPlatform).toHaveBeenCalledWith('production')
  })

  it.each([[], ['delete'], ['list', '--pepper', 'forbidden'], ['list', '--env'],
    ['list', '--env', 'staging', '--env', 'staging'], ['list', '--username', 'Alex'],
    ['create', '--username', ' Alex', '--display-name', 'Alex'], ['create', '--username', 'Alex ', '--display-name', 'Alex'],
    ['create', '--username', '', '--display-name', 'Alex'], ['create', '--username', 'Alex', '--display-name', ' ']])(
    'rejects invalid arguments without opening a binding: %j', async (...argv) => {
      expect(await run(argv as string[])).toBe(1)
      expect(openPlatform).not.toHaveBeenCalled()
    })

  it('disposes the proxy after success and failure', async () => {
    await run(['list'])
    await run(['disable', '--username', 'missing'])
    expect(dispose).toHaveBeenCalledTimes(2)
  })

  it('import and ordinary tests never call the real platform opener', async () => {
    await import('./manage-user')
    const { getPlatformProxy } = await import('wrangler')
    expect(getPlatformProxy).not.toHaveBeenCalled()
  })
})
