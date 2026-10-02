import { existsSync, readFileSync } from 'node:fs'
import { mkdtemp, rm } from 'node:fs/promises'
import { spawnSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import type { GetPlatformProxyOptions } from 'wrangler'
import { openCatalogPlatform, type CatalogPlatformAdapter } from './cefr-j-platform'
import { options } from './import-cefr-j'
import type { CatalogDatabase } from './cefr-j-catalog'

// Use the real config resolver, but forbid uninjected connections to Cloudflare.
vi.mock('wrangler', async importOriginal => ({
  ...await importOriginal<typeof import('wrangler')>(),
  getPlatformProxy: vi.fn(() => { throw new Error('Real remote connection forbidden in tests') }),
}))

const sourceText = readFileSync('wrangler.jsonc', 'utf8')
const source = JSON.parse(sourceText.replace(/^\s*\/\/.*$/gm, ''))
const remoteResult = { success: true, results: [{ connectivity_ok: 1 }],
  meta: { served_by: 'v3-prod', served_by_region: 'WEUR', served_by_primary: true } }

let runtimeDirectory: string
beforeAll(async () => {
  runtimeDirectory = await mkdtemp(join(tmpdir(), 'relai-catalog-runtime-test-'))
  vi.stubEnv('WRANGLER_REGISTRY_PATH', join(runtimeDirectory, 'registry'))
  vi.stubEnv('WRANGLER_LOG_PATH', join(runtimeDirectory, 'logs'))
  await import('wrangler')
}, 30_000)
afterAll(async () => {
  vi.unstubAllEnvs()
  await rm(runtimeDirectory, { recursive: true, force: true })
})

async function adapter(result: unknown = remoteResult) {
  const { unstable_readConfig } = await import('wrangler')
  const readConfig = vi.fn((args: { config: string; env: string }) => unstable_readConfig(args))
  const all = vi.fn(async () => result)
  const prepare = vi.fn(() => ({ all }))
  const batch = vi.fn()
  const db = { prepare, batch } as unknown as CatalogDatabase
  const dispose = vi.fn(async () => {})
  let configPath = ''
  const getPlatformProxy = vi.fn(async (args: GetPlatformProxyOptions) => {
    configPath = args.configPath!
    return { env: { DB: db }, dispose }
  })
  return { readConfig, getPlatformProxy, prepare, all, batch, dispose, path: () => configPath }
}

describe('CEFR-J importer platform selection (no remote connections)', () => {
  it('keeps local mode on the normal config with remote support disabled and local persistence', async () => {
    const fake = await adapter()
    await openCatalogPlatform(false, undefined, fake)
    expect(fake.getPlatformProxy).toHaveBeenCalledWith({ configPath: 'wrangler.jsonc',
      environment: 'staging', remoteBindings: false, persist: true, envFiles: [] })
    expect(fake.prepare).not.toHaveBeenCalled()
    expect(source.env.staging.d1_databases[0].remote).not.toBe(true)
    expect(source.d1_databases[0].remote).not.toBe(true)
  })

  it('resolves an importer-only remote staging binding using the real Wrangler resolver', async () => {
    const fake = await adapter()
    const platform = await openCatalogPlatform(true, 'relai-staging-db', fake)
    try {
      const { unstable_readConfig } = await import('wrangler')
      const resolved = unstable_readConfig({ config: fake.path(), env: 'staging' })
      expect(resolved.d1_databases).toEqual([{
        binding: 'DB', database_name: 'relai-staging-db',
        database_id: source.env.staging.d1_databases[0].database_id, remote: true,
      }])
      const temporary = JSON.parse(readFileSync(fake.path(), 'utf8'))
      expect(Object.keys(temporary.env)).toEqual(['staging'])
      expect(Object.keys(temporary).sort()).toEqual(['compatibility_date', 'env', 'name'])
      expect(temporary.env.staging.d1_databases).toEqual([{
        binding: 'DB', database_name: 'relai-staging-db',
        database_id: source.env.staging.d1_databases[0].database_id, remote: true,
      }])
      expect(fake.getPlatformProxy).toHaveBeenCalledWith({ configPath: fake.path(),
        environment: 'staging', remoteBindings: true, persist: false, envFiles: [] })
      expect(fake.prepare).toHaveBeenCalledExactlyOnceWith('SELECT 1 AS connectivity_ok')
      expect(fake.batch).not.toHaveBeenCalled()
      expect(readFileSync('wrangler.jsonc', 'utf8')).toBe(sourceText)
    } finally { await platform.dispose() }
    expect(fake.dispose).toHaveBeenCalledTimes(1)
    expect(existsSync(dirname(fake.path()))).toBe(false)
  })

  it.each([
    { ...remoteResult, meta: { ...remoteResult.meta, served_by: 'miniflare.db' } },
    { ...remoteResult, meta: undefined },
    { ...remoteResult, meta: { served_by: 'unknown' } },
    { ...remoteResult, success: false },
    { ...remoteResult, results: [] },
  ])('fails closed on a local, unknown or unsuccessful preflight: %j', async result => {
    const fake = await adapter(result)
    await expect(openCatalogPlatform(true, 'relai-staging-db', fake)).rejects.toThrow(/refusing a local or unknown backend/)
    expect(fake.prepare).toHaveBeenCalledExactlyOnceWith('SELECT 1 AS connectivity_ok')
    expect(fake.batch).not.toHaveBeenCalled()
    expect(fake.dispose).toHaveBeenCalledTimes(1)
    expect(existsSync(dirname(fake.path()))).toBe(false)
  })

  it('proves actual simulated D1 is local and refuses it when returned for remote mode', async () => {
    const real = await vi.importActual<typeof import('wrangler')>('wrangler')
    const state = await mkdtemp(join(tmpdir(), 'relai-catalog-test-'))
    const fake = await adapter()
    const localAdapter: CatalogPlatformAdapter = {
      readConfig: fake.readConfig,
      getPlatformProxy: args => real.getPlatformProxy({ ...args, persist: { path: state } }),
    }
    const local = await openCatalogPlatform(false, undefined, localAdapter)
    try {
      const result = await local.env.DB.prepare('SELECT 1 AS connectivity_ok').all()
      expect(result).toMatchObject({ success: true, meta: { served_by: 'miniflare.db' } })
      fake.getPlatformProxy.mockResolvedValueOnce({ env: local.env, dispose: fake.dispose })
      await expect(openCatalogPlatform(true, 'relai-staging-db', fake)).rejects.toThrow(/refusing a local or unknown backend/)
      expect(await local.env.DB.prepare("SELECT name FROM sqlite_master WHERE name='vocabulary_catalog'").all())
        .toMatchObject({ results: [] })
    } finally {
      await local.dispose()
      await rm(state, { recursive: true, force: true })
    }
  }, 30_000)

  it.each([undefined, 'relai-prod-db', 'relai-staging-db ', 'wrong'])('rejects confirmation %s before config or proxy access', async confirmation => {
    const fake = await adapter()
    await expect(openCatalogPlatform(true, confirmation, fake)).rejects.toThrow(/requires --confirm-staging/)
    expect(fake.readConfig).not.toHaveBeenCalled()
    expect(fake.getPlatformProxy).not.toHaveBeenCalled()
  })

  it.each([
    { ...source.env.production.d1_databases[0] },
    { ...source.env.production.d1_databases[0], database_name: 'relai-staging-db' },
    { ...source.env.staging.d1_databases[0], database_id: '' },
  ])('rejects production bindings, including a production ID renamed staging: %j', async binding => {
    const fake = await adapter()
    const read = fake.readConfig.getMockImplementation()!
    fake.readConfig.mockImplementation(args => args.env === 'staging'
      ? { ...read(args), d1_databases: [binding] } : read(args))
    await expect(openCatalogPlatform(true, 'relai-staging-db', fake)).rejects.toThrow(/Staging D1 binding/)
    expect(fake.getPlatformProxy).not.toHaveBeenCalled()
  })

  it('rejects a remote flag lost during config resolution before opening a proxy', async () => {
    const fake = await adapter()
    const read = fake.readConfig.getMockImplementation()!
    let path = ''
    fake.readConfig.mockImplementation(args => {
      const resolved = read(args)
      if (args.config === 'wrangler.jsonc') return resolved
      path = args.config
      return { ...resolved, d1_databases: resolved.d1_databases.map((db: { remote?: boolean }) => ({ ...db, remote: false })) }
    })
    await expect(openCatalogPlatform(true, 'relai-staging-db', fake)).rejects.toThrow(/did not resolve a remote staging/)
    expect(fake.getPlatformProxy).not.toHaveBeenCalled()
    expect(existsSync(dirname(path))).toBe(false)
  })

  it('does not retry with a local proxy after connection failure and cleans up its config', async () => {
    const fake = await adapter()
    let path = ''
    fake.getPlatformProxy.mockImplementation(async args => {
      path = args.configPath!
      throw new Error('Remote session unavailable')
    })
    await expect(openCatalogPlatform(true, 'relai-staging-db', fake)).rejects.toThrow('Remote session unavailable')
    expect(fake.getPlatformProxy).toHaveBeenCalledTimes(1)
    expect(existsSync(dirname(path))).toBe(false)
  })

  it('removes temporary config even if disposal fails', async () => {
    const fake = await adapter()
    const platform = await openCatalogPlatform(true, 'relai-staging-db', fake)
    fake.dispose.mockRejectedValueOnce(new Error('Dispose failed'))
    await expect(platform.dispose()).rejects.toThrow('Dispose failed')
    expect(existsSync(dirname(fake.path()))).toBe(false)
  })

  it('keeps CLI confirmation guards and disallows any environment/config/production switches', () => {
    expect(options(['--file', 'manifest.json'])).toMatchObject({ remote: false })
    expect(options(['--file', 'manifest.json', '--remote', '--confirm-staging', 'relai-staging-db']))
      .toMatchObject({ remote: true, confirmation: 'relai-staging-db' })
    for (const args of [
      ['--remote'], ['--remote', '--confirm-staging', 'relai-prod-db'],
      ['--confirm-staging', 'relai-staging-db'], ['--env', 'production'],
      ['--config', 'production.json'], ['--confirm-production', 'relai-prod-db'],
    ]) expect(() => options(['--file', 'manifest.json', ...args])).toThrow()
  })

  it('module imports are inert and executable invalid confirmation fails before file/database access', () => {
    const imported = spawnSync(process.execPath, ['--import', 'tsx', '--input-type=module', '--eval',
      "await import('./scripts/import-cefr-j.ts'); await import('./scripts/cefr-j-platform.ts')"], { encoding: 'utf8' })
    expect(imported.status).toBe(0)
    expect(imported.stdout).toBe('')
    expect(imported.stderr).toBe('')
    const rejected = spawnSync(process.execPath, ['--import', 'tsx', 'scripts/import-cefr-j.ts',
      '--file', 'nonexistent.json', '--remote', '--confirm-staging', 'relai-prod-db'], { encoding: 'utf8' })
    expect(rejected.status).toBe(1)
    expect(rejected.stderr.trim()).toBe('Remote import requires --confirm-staging relai-staging-db.')
  })
})
