import { readdirSync, readFileSync } from 'node:fs'
import { DatabaseSync } from 'node:sqlite'
import { PassThrough, Writable } from 'node:stream'
import type { ReadStream, WriteStream } from 'node:tty'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createRepositories, tokenDigest } from '../src/worker/persistence'
import type { PersistenceDatabase, PersistenceStatement, SqlValue } from '../src/worker/persistence/d1'
import { verifyPassword } from '../src/worker/auth/crypto'
import { generatePassword, parseArguments, runManageUser } from './manage-user'
import { promptTerminal } from './manage-user-prompt'

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
    for (const name of readdirSync('migrations').filter(name => name.endsWith('.sql')).sort()) {
      sqlite.exec(readFileSync(`migrations/${name}`, 'utf8'))
    }
    db = localD1(sqlite)
    repositories = createRepositories(db)
  })
  afterEach(() => { sqlite.close(); vi.unstubAllEnvs(); vi.restoreAllMocks() })
  const run = (argv: string[]) => runManageUser(argv, { openPlatform, output, error })
  const password = () => output.mock.calls.at(-1)![0].split('Password: ')[1]
  const interactive = ['create', '--interactive', '--env', 'staging']
  function answers(chosen: string, confirmation = chosen, username = 'Tina') {
    const values = [username, 'Tina', '', chosen, confirmation]
    return vi.fn(async () => values.shift()!)
  }

  it.each(['12345678', ' temporary e\u0301 password '])('creates interactive accounts with exact chosen credentials offline', async (chosen) => {
    const prompt = answers(chosen)
    expect(await runManageUser(interactive, { openPlatform, output, error, prompt })).toBe(0)
    expect(prompt.mock.calls).toEqual([
      ['Username: ', false], ['Display name: ', false], ['Cohort source (optional): ', false],
      ['Temporary password: ', true], ['Confirm temporary password: ', true],
    ])
    const row = (await repositories.users.findByUsername('Tina'))!
    expect(row).toMatchObject({ must_change_password: true, cohort_source: null, is_active: 1 })
    expect(sqlite.prepare('SELECT must_change_password FROM users').get()!.must_change_password).toBe(1)
    expect(await verifyPassword(chosen, row, process.env.AUTH_PEPPER!)).toBe(true)
    if (chosen.trim() !== chosen) {
      expect(await verifyPassword(chosen.trim(), row, process.env.AUTH_PEPPER!)).toBe(false)
      expect(await verifyPassword(chosen.normalize('NFC'), row, process.env.AUTH_PEPPER!)).toBe(false)
    }
    expect(JSON.stringify(sqlite.prepare('SELECT * FROM users').all()).includes(chosen)).toBe(false)
    expect(output.mock.calls).toEqual([['Account created; password change required.']])
    expect(JSON.stringify([output.mock.calls, error.mock.calls]).includes(chosen)).toBe(false)
    for (const method of logs) expect(console[method]).not.toHaveBeenCalled()
    const { getPlatformProxy } = await import('wrangler')
    expect(getPlatformProxy).not.toHaveBeenCalled()
    expect(openPlatform).toHaveBeenCalledWith('staging')
    expect(dispose).toHaveBeenCalledTimes(1)
  })

  it('uses a fresh salt for each interactive account with the same password', async () => {
    const chosen = crypto.randomUUID()
    for (const username of ['One', 'Two']) {
      expect(await runManageUser(interactive, { openPlatform, output, error, prompt: answers(chosen, chosen, username) })).toBe(0)
    }
    const one = (await repositories.users.findByUsername('One'))!
    const two = (await repositories.users.findByUsername('Two'))!
    expect(one.password_salt).not.toBe(two.password_salt)
    expect(one.password_digest).not.toBe(two.password_digest)
  })

  it.each([
    ['1234567', '1234567', 'Temporary password must contain at least 8 characters.'],
    ['12345678', '87654321', 'Temporary password confirmation does not match.'],
    ['12345678 ', '12345678', 'Temporary password confirmation does not match.'],
  ])('rejects invalid temporary passwords before platform access', async (chosen, confirmation, message) => {
    expect(await runManageUser(interactive, { openPlatform, output, error, prompt: answers(chosen, confirmation) })).toBe(1)
    expect(error.mock.calls).toEqual([[message]])
    expect(openPlatform).not.toHaveBeenCalled()
    expect(output).not.toHaveBeenCalled()
    expect(sqlite.prepare('SELECT count(*) AS count FROM users').get()!.count).toBe(0)
  })

  it('checks pepper and production confirmation before prompting or opening the platform', async () => {
    const prompt = answers(crypto.randomUUID())
    for (const confirmation of [[], ['--confirm-production', 'wrong']]) {
      expect(await runManageUser(['create', '--interactive', '--env', 'production', ...confirmation],
        { openPlatform, output, error, prompt })).toBe(1)
    }
    expect(prompt).not.toHaveBeenCalled()
    expect(openPlatform).not.toHaveBeenCalled()
    vi.stubEnv('AUTH_PEPPER', undefined)
    expect(await runManageUser(interactive, { openPlatform, output, error, prompt })).toBe(1)
    expect(prompt).not.toHaveBeenCalled()
    expect(openPlatform).not.toHaveBeenCalled()
    vi.stubEnv('AUTH_PEPPER', crypto.randomUUID())
    expect(await runManageUser(['create', '--interactive', '--env', 'production', '--confirm-production', 'relai-prod-db'],
      { openPlatform, output, error, prompt })).toBe(0)
    expect(openPlatform).toHaveBeenCalledWith('production')
  })

  it('fails interactive input and transport safely without exposing chosen credentials', async () => {
    const chosen = crypto.randomUUID()
    const prompt = vi.fn(async () => { throw new Error(chosen) })
    expect(await runManageUser(interactive, { openPlatform, output, error, prompt })).toBe(1)
    expect(openPlatform).not.toHaveBeenCalled()
    db.prepare = () => { throw new Error(chosen) }
    expect(await runManageUser(interactive, { openPlatform, output, error, prompt: answers(chosen) })).toBe(1)
    expect(error.mock.calls).toEqual(Array.from({ length: 2 }, () => ['Account operation failed; no credential output.']))
    expect(output).not.toHaveBeenCalled()
    for (const method of logs) expect(console[method]).not.toHaveBeenCalled()
  })

  it.each([
    ['create', '--interactive', '--interactive'], ['create', '--interactive', '--password', 'forbidden'],
    [...create, '--password', 'forbidden'], [...create, '--interactive'], ['list', '--interactive'],
    ['reset-password', '--interactive'], ['create', '--interactive', 'true'],
  ].map(argv => [argv]))('rejects unsupported interactive arguments before access: %j', async (argv) => {
    expect(await run(argv)).toBe(1)
    expect(openPlatform).not.toHaveBeenCalled()
  })

  it('creates active accounts with exact username, free-text cohort, defaults, UUID and UTC timestamps', async () => {
    expect(await run([...create, '--cohort-source', ' custom cohort '])).toBe(0)
    const issued = password()
    const row = (await repositories.users.findByUsername('Alex'))!
    expect(await repositories.users.findByUsername('alex')).toBeNull()
    expect(row).toMatchObject({ username: 'Alex', display_name: 'Alex', role: 'user',
      is_active: 1, must_change_password: true, cohort_source: ' custom cohort ', last_login_at: null })
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

describe('terminal password input', () => {
  function terminal() {
    const input = Object.assign(new PassThrough(), { isTTY: true, setRawMode: vi.fn() })
    let text = ''
    const output = Object.assign(new Writable({ write(chunk, _encoding, done) { text += chunk.toString(); done() } }), { isTTY: true })
    return { input, output, text: () => text,
      ask: (secret = true) => promptTerminal('Temporary password: ', secret,
        input as unknown as ReadStream, output as unknown as WriteStream) }
  }

  it('preserves pasted whitespace and Unicode without echoing plaintext and restores cooked mode', async () => {
    const tty = terminal()
    const chosen = ' pasted e\u0301 password '
    const result = tty.ask()
    tty.input.write(`${chosen}\r`)
    expect(await result).toBe(chosen)
    expect(tty.text()).toBe('Temporary password: \n')
    expect(tty.input.setRawMode.mock.calls).toEqual([[true], [false]])
    expect(tty.input.listenerCount('keypress')).toBe(0)
  })

  it.each(['\u0003', '\u0004'])('cancels safely and restores terminal input: %j', async (key) => {
    const tty = terminal()
    const result = tty.ask()
    tty.input.write(key)
    await expect(result).rejects.toThrow(/Input (cancelled|closed)/)
    expect(tty.input.setRawMode.mock.calls).toEqual([[true], [false]])
    expect(tty.text()).toBe('Temporary password: \n')
    expect(tty.input.listenerCount('keypress')).toBe(0)
  })

  it('echoes ordinary fields', async () => {
    const tty = terminal()
    const result = promptTerminal('Username: ', false,
      tty.input as unknown as ReadStream, tty.output as unknown as WriteStream)
    expect(tty.text()).toContain('Username: ')
    tty.input.write('Tina\r')
    expect(await result).toBe('Tina')
    expect(tty.text()).toContain('Tina')
  })

  it('renders ordinary prompts in order before input and keeps both secret answers hidden', async () => {
    const tty = terminal()
    for (const [label, value] of [
      ['Username: ', 'Tina'], ['Display name: ', 'Tina'], ['Cohort source (optional): ', ''],
      ['Temporary password: ', ' pasted e\u0301 password '],
      ['Confirm temporary password: ', ' pasted e\u0301 password '],
    ]) {
      const secret = label.includes('password')
      const answer = promptTerminal(label, secret,
        tty.input as unknown as ReadStream, tty.output as unknown as WriteStream)
      expect(tty.text()).toContain(label)
      tty.input.write(`${value}\r`)
      expect(await answer).toBe(value)
    }
    expect(tty.text()).not.toContain(' pasted e\u0301 password ')
    expect(tty.input.setRawMode.mock.calls.at(-1)).toEqual([false])
    expect(tty.input.listenerCount('keypress')).toBe(0)
  })

  it('restores a previously raw terminal after secret input fails', async () => {
    const tty = terminal()
    Object.assign(tty.input, { isRaw: true })
    const answer = tty.ask()
    tty.input.emit('error', new Error('private transport detail'))
    await expect(answer).rejects.toThrow('Input closed.')
    expect(tty.input.setRawMode.mock.calls).toEqual([[true], [true]])
    expect(tty.input.listenerCount('keypress')).toBe(0)
    expect(tty.text()).toBe('Temporary password: \n')
  })

  it('refuses non-TTY input or output before reading', async () => {
    for (const stream of ['input', 'output'] as const) {
      const tty = terminal()
      tty[stream].isTTY = false
      await expect(tty.ask()).rejects.toThrow('Interactive input requires a TTY.')
      expect(tty.text()).toBe('')
      expect(tty.input.setRawMode).not.toHaveBeenCalled()
    }
  })
})
