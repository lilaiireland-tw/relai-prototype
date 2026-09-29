import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { GetPlatformProxyOptions } from 'wrangler'
import type { AdminPlatform, Arguments } from './manage-user'

interface SelectedConfig {
  name?: string
  account_id?: string
  compatibility_date?: string
  d1_databases: { binding: string; database_name?: string; database_id?: string }[]
}

export interface PlatformAdapter {
  readConfig(options: { config: string; env: string }): SelectedConfig
  getPlatformProxy(options: GetPlatformProxyOptions): Promise<AdminPlatform>
}

/** Called only by the CLI after argument, production and pepper checks pass. */
export async function openAdminPlatform(
  environment: Arguments['environment'],
  injected?: PlatformAdapter,
): Promise<AdminPlatform> {
  if (environment !== 'staging' && environment !== 'production') {
    throw new Error('Environment must be staging or production.')
  }
  // Loading Wrangler is deferred, so ordinary module imports have no remote effects.
  let api = injected
  if (!api) {
    const { unstable_readConfig, getPlatformProxy } = await import('wrangler')
    api = {
      readConfig: unstable_readConfig,
      getPlatformProxy: (options) => getPlatformProxy<AdminPlatform['env']>(options),
    }
  }
  const selected = api.readConfig({ config: 'wrangler.jsonc', env: environment })
  const binding = selected.d1_databases.find((db) => db.binding === 'DB')
  const expectedName = environment === 'production' ? 'relai-prod-db' : 'relai-staging-db'
  if (selected.d1_databases.length !== 1 || !binding?.database_id || binding.database_name !== expectedName) {
    throw new Error('Configured DB binding does not match the selected environment.')
  }

  // Copy only public routing metadata and the selected D1 identity. Never copy vars,
  // secrets, assets, routes, OAuth data, or the source config's other bindings.
  const config = {
    name: selected.name,
    account_id: selected.account_id,
    compatibility_date: selected.compatibility_date,
    env: {
      [environment]: {
        name: selected.name,
        d1_databases: [{ binding: 'DB', database_name: binding.database_name,
          database_id: binding.database_id, remote: true }],
      },
    },
  }
  const directory = await mkdtemp(join(tmpdir(), 'relai-admin-'))
  const configPath = join(directory, 'wrangler.jsonc')
  let platform: AdminPlatform | undefined
  try {
    await writeFile(configPath, JSON.stringify(config), { mode: 0o600, flag: 'wx' })
    platform = await api.getPlatformProxy({ configPath, environment, remoteBindings: true,
      persist: false, envFiles: [] })
    if (!platform.env.DB) throw new Error('Configured DB binding is missing.')
    const connected = platform
    return {
      env: connected.env,
      async dispose() {
        try { await connected.dispose() } finally {
          // This path is the private mkdtemp directory created by this invocation.
          await rm(directory, { recursive: true, force: true })
        }
      },
    }
  } catch {
    try { await platform?.dispose() } finally {
      await rm(directory, { recursive: true, force: true })
    }
    throw new Error('Admin platform setup failed.')
  }
}
