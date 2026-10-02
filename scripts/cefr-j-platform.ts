import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { GetPlatformProxyOptions } from 'wrangler'
import type { CatalogDatabase } from './cefr-j-catalog'

export interface CatalogPlatform {
  env: { DB: CatalogDatabase }
  dispose(): Promise<void>
}

interface SelectedConfig {
  name?: string
  account_id?: string
  compatibility_date?: string
  d1_databases: { binding: string; database_name?: string; database_id?: string; remote?: boolean; preview_database_id?: string }[]
}

export interface CatalogPlatformAdapter {
  readConfig(options: { config: string; env: string }): SelectedConfig
  getPlatformProxy(options: GetPlatformProxyOptions): Promise<CatalogPlatform>
}

export function requireStagingConfirmation(remote: boolean, confirmation?: string) {
  if (remote && confirmation !== 'relai-staging-db') {
    throw new Error('Remote import requires --confirm-staging relai-staging-db.')
  }
  if (!remote && confirmation) throw new Error('--confirm-staging is only valid with --remote.')
}

export async function openCatalogPlatform(
  remote: boolean,
  confirmation?: string,
  injected?: CatalogPlatformAdapter,
): Promise<CatalogPlatform> {
  requireStagingConfirmation(remote, confirmation)
  let api = injected
  if (!api) {
    const { unstable_readConfig, getPlatformProxy } = await import('wrangler')
    api = { readConfig: unstable_readConfig,
      getPlatformProxy: (options) => getPlatformProxy<CatalogPlatform['env']>(options) }
  }
  const selected = api.readConfig({ config: 'wrangler.jsonc', env: 'staging' })
  const production = api.readConfig({ config: 'wrangler.jsonc', env: 'production' })
  const binding = selected.d1_databases[0]
  const productionIds = production.d1_databases.flatMap(db => [db.database_id, db.preview_database_id])
  if (selected.d1_databases.length !== 1 || binding?.binding !== 'DB' ||
    binding.database_name !== 'relai-staging-db' ||
    !binding.database_id || !/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(binding.database_id) ||
    productionIds.some(id => id?.toLowerCase() === binding.database_id?.toLowerCase())) {
    throw new Error('Staging D1 binding did not match a separate relai-staging-db.')
  }
  if (!remote) {
    return api.getPlatformProxy({ configPath: 'wrangler.jsonc', environment: 'staging',
      remoteBindings: false, persist: true, envFiles: [] })
  }

  // Only this importer opts into remote D1. Do not copy preview IDs, vars,
  // secrets, assets, routes, or production environments into this private config.
  const config = {
    name: selected.name,
    account_id: selected.account_id,
    compatibility_date: selected.compatibility_date,
    env: { staging: { name: selected.name, d1_databases: [{
      binding: 'DB', database_name: binding.database_name,
      database_id: binding.database_id, remote: true,
    }] } },
  }
  const directory = await mkdtemp(join(tmpdir(), 'relai-catalog-'))
  const configPath = join(directory, 'wrangler.jsonc')
  let platform: CatalogPlatform | undefined
  try {
    await writeFile(configPath, JSON.stringify(config), { mode: 0o600, flag: 'wx' })
    const resolved = api.readConfig({ config: configPath, env: 'staging' }).d1_databases
    if (resolved.length !== 1 || resolved[0].binding !== 'DB' ||
      resolved[0].database_id !== binding.database_id ||
      resolved[0].database_name !== 'relai-staging-db' || resolved[0].remote !== true ||
      resolved[0].preview_database_id) {
      throw new Error('Importer config did not resolve a remote staging D1 binding.')
    }
    platform = await api.getPlatformProxy({ configPath, environment: 'staging',
      remoteBindings: true, persist: false, envFiles: [] })
    if (!platform.env.DB) throw new Error('Configured DB binding is missing.')
    // Read-only preflight: never trust a local/unknown backend in --remote mode.
    // Cloudflare D1 reports its backend version, region and primary status.
    const probe: { success: boolean; results: { connectivity_ok: number }[]; meta?: {
      served_by?: string; served_by_region?: string; served_by_primary?: boolean
    } } = await platform.env.DB.prepare('SELECT 1 AS connectivity_ok').all<{ connectivity_ok: number }>()
    if (!probe.success || probe.results[0]?.connectivity_ok !== 1 ||
      !probe.meta?.served_by || /miniflare/i.test(probe.meta.served_by) ||
      !probe.meta.served_by_region || typeof probe.meta.served_by_primary !== 'boolean') {
      throw new Error('Remote staging D1 could not be verified; refusing a local or unknown backend.')
    }
    const connected = platform
    return { env: connected.env, async dispose() {
      try { await connected.dispose() } finally {
        await rm(directory, { recursive: true, force: true })
      }
    } }
  } catch (error) {
    try { await platform?.dispose() } finally {
      await rm(directory, { recursive: true, force: true })
    }
    throw error
  }
}
