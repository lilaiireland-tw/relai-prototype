import { existsSync, readFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { dirname, isAbsolute } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { GetPlatformProxyOptions } from 'wrangler'
import { openAdminPlatform, type PlatformAdapter } from './manage-user-platform'
import { runManageUser } from './manage-user'
import type { PersistenceDatabase } from '../src/worker/persistence'

// Even an accidental uninjected adapter call cannot open a real connection.
vi.mock('wrangler', () => ({
  unstable_readConfig: vi.fn(() => { throw new Error('Real config reader forbidden in this test') }),
  getPlatformProxy: vi.fn(() => { throw new Error('Real connection forbidden in this test') }),
}))

const sourceText = readFileSync('wrangler.jsonc', 'utf8')
const source = JSON.parse(sourceText.replace(/^\s*\/\/.*$/gm, ''))
const db = {} as PersistenceDatabase

function adapter(environment: 'staging' | 'production') {
  const selected = { ...source, ...source.env[environment] }
  const readConfig = vi.fn(() => selected)
  const dispose = vi.fn(async () => {})
  let configPath = ''
  const getPlatformProxy = vi.fn(async (options: GetPlatformProxyOptions) => {
    configPath = options.configPath!
    expect(isAbsolute(configPath)).toBe(true)
    expect(options).toMatchObject({ environment, remoteBindings: true, persist: false, envFiles: [] })
    const temporary = JSON.parse(readFileSync(configPath, 'utf8'))
    expect(temporary.env[environment].d1_databases).toEqual([{
      binding: 'DB', database_name: selected.d1_databases[0].database_name,
      database_id: selected.d1_databases[0].database_id, remote: true,
    }])
    expect(Object.keys(temporary.env)).toEqual([environment])
    expect(Object.keys(temporary).sort()).toEqual(['name', 'compatibility_date', 'env'].sort())
    expect(readFileSync('wrangler.jsonc', 'utf8')).toBe(sourceText)
    return { env: { DB: db }, dispose }
  })
  return { readConfig, getPlatformProxy, dispose, selected, path: () => configPath }
}

afterEach(() => { vi.unstubAllEnvs(); vi.restoreAllMocks() })

describe('ephemeral admin platform adapter with mocked remote connection', () => {
  it.each(['staging', 'production'] as const)('derives %s DB from source and removes the config after disposal', async (environment) => {
    const fake = adapter(environment)
    const platform = await openAdminPlatform(environment, fake)
    try {
      expect(platform.env.DB).toBe(db)
      expect(fake.readConfig).toHaveBeenCalledWith({ config: 'wrangler.jsonc', env: environment })
      expect(existsSync(fake.path())).toBe(true)
    } finally { await platform.dispose() }
    expect(fake.dispose).toHaveBeenCalledTimes(1)
    expect(existsSync(dirname(fake.path()))).toBe(false)
    expect(source.env[environment].d1_databases[0].remote).not.toBe(true)
  })

  it('removes the temporary config when proxy setup fails', async () => {
    const fake = adapter('staging')
    const connect = fake.getPlatformProxy
    fake.getPlatformProxy = vi.fn(async (options) => {
      await connect(options)
      throw new Error('Proxy creation failed')
    })
    await expect(openAdminPlatform('staging', fake)).rejects.toThrow('Admin platform setup failed.')
    expect(existsSync(dirname(fake.path()))).toBe(false)
  })

  it('removes the temporary config even when proxy disposal fails', async () => {
    const fake = adapter('staging')
    fake.dispose.mockRejectedValueOnce(new Error('Dispose failed'))
    const platform = await openAdminPlatform('staging', fake)
    await expect(platform.dispose()).rejects.toThrow('Dispose failed')
    expect(existsSync(dirname(fake.path()))).toBe(false)
  })

  it('cleans up an acquired proxy with a missing DB binding', async () => {
    const fake = adapter('staging')
    const api: PlatformAdapter = { readConfig: fake.readConfig, async getPlatformProxy(options) {
      await fake.getPlatformProxy(options)
      return { env: {} as { DB: PersistenceDatabase }, dispose: fake.dispose }
    } }
    await expect(openAdminPlatform('staging', api)).rejects.toThrow('Admin platform setup failed.')
    expect(fake.dispose).toHaveBeenCalledTimes(1)
    expect(existsSync(dirname(fake.path()))).toBe(false)
  })

  it('copies no source vars, secrets or extra bindings', async () => {
    const fake = adapter('staging')
    // Sentinel field names, not secrets: the entire sections must be excluded.
    fake.selected.vars = { SHOULD_NOT_COPY: true }
    fake.selected.secrets = { required: ['SHOULD_NOT_COPY'] }
    const platform = await openAdminPlatform('staging', fake)
    try {
      expect(readFileSync(fake.path(), 'utf8')).not.toContain('SHOULD_NOT_COPY')
    } finally { await platform.dispose() }
  })

  it('rejects a swapped/missing DB and invalid environment before temporary config creation', async () => {
    const fake = adapter('staging')
    fake.selected.d1_databases = source.env.production.d1_databases
    await expect(openAdminPlatform('staging', fake)).rejects.toThrow('Configured DB binding')
    await expect(openAdminPlatform('other' as 'staging', fake)).rejects.toThrow('Environment must be')
    expect(fake.getPlatformProxy).not.toHaveBeenCalled()
    expect(fake.path()).toBe('')
  })

  it('CLI validation and missing pepper prevent entry to the adapter, config creation and connection', async () => {
    const fake = adapter('production')
    const openPlatform = vi.fn((environment: 'staging' | 'production') => openAdminPlatform(environment, fake))
    const deps = { openPlatform, output: vi.fn(), error: vi.fn() }
    vi.stubEnv('AUTH_PEPPER', crypto.randomUUID())
    for (const args of [[], ['list', '--env', 'invalid'], ['list', '--env', 'production'],
      ['list', '--env', 'production', '--confirm-production', 'relai-prod-db ']]) {
      expect(await runManageUser(args, deps)).toBe(1)
    }
    vi.stubEnv('AUTH_PEPPER', undefined)
    expect(await runManageUser(['create', '--username', 'Alex', '--display-name', 'Alex'], deps)).toBe(1)
    expect(await runManageUser(['list'], deps)).toBe(1)
    expect(openPlatform).not.toHaveBeenCalled()
    expect(fake.readConfig).not.toHaveBeenCalled()
    expect(fake.getPlatformProxy).not.toHaveBeenCalled()
    expect(fake.path()).toBe('')
  })

  it('actual Node imports are inert and executable guards fail before Wrangler is loaded', () => {
    const env = { ...process.env, AUTH_PEPPER: '' }
    const imported = spawnSync(process.execPath, ['--import', 'tsx', '--input-type=module', '--eval',
      "await import('./scripts/manage-user.ts'); await import('./scripts/manage-user-platform.ts')"],
      { env, encoding: 'utf8' })
    expect(imported.status).toBe(0)
    expect(imported.stdout).toBe('')
    expect(imported.stderr).toBe('')
    for (const [args, message] of [
      [['list', '--env', 'production'], 'Production requires --env production --confirm-production relai-prod-db.'],
      [['create', '--username', 'Alex', '--display-name', 'Alex'], 'AUTH_PEPPER is required in the process environment.'],
    ] as const) {
      const guarded = spawnSync(process.execPath, ['--import', 'tsx', 'scripts/manage-user.ts', ...args],
        { env, encoding: 'utf8' })
      expect(guarded.status).toBe(1)
      expect(guarded.stdout).toBe('')
      expect(guarded.stderr.trim()).toBe(message)
    }
  })

  it('importing either module never resolves a config or opens a remote proxy', async () => {
    await import('./manage-user-platform')
    await import('./manage-user')
    const api = await import('wrangler')
    expect(api.unstable_readConfig).not.toHaveBeenCalled()
    expect(api.getPlatformProxy).not.toHaveBeenCalled()
  })
})
