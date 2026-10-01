import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { getPlatformProxy, unstable_readConfig } from 'wrangler'
import { CatalogImportError, importCatalog, type CatalogDatabase } from './cefr-j-catalog'

function options(args: string[]) {
  let file: string | undefined
  let remote = false
  let confirmation: string | undefined
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--file') file = args[++i]
    else if (args[i] === '--remote') remote = true
    else if (args[i] === '--confirm-staging') confirmation = args[++i]
    else throw new Error(`Unknown argument: ${args[i]}`)
  }
  if (!file) throw new Error('Usage: npm run catalog:import -- --file <manifest.json> [--remote --confirm-staging relai-staging-db]')
  if (remote && confirmation !== 'relai-staging-db') throw new Error('Remote import requires --confirm-staging relai-staging-db.')
  if (!remote && confirmation) throw new Error('--confirm-staging is only valid with --remote.')
  return { file, remote }
}

async function main() {
  const { file, remote } = options(process.argv.slice(2))
  const manifest: unknown = JSON.parse(await readFile(resolve(file), 'utf8'))
  const config = unstable_readConfig({ config: 'wrangler.jsonc', env: 'staging' })
  const bindings = config.d1_databases ?? []
  if (bindings.length !== 1 || bindings[0].binding !== 'DB' || bindings[0].database_name !== 'relai-staging-db') {
    throw new Error('Staging D1 binding did not match relai-staging-db.')
  }
  const platform = await getPlatformProxy<{ DB: CatalogDatabase }>({
    configPath: 'wrangler.jsonc', environment: 'staging', remoteBindings: remote,
    persist: !remote, envFiles: [],
  })
  try {
    const result = await importCatalog(platform.env.DB, manifest)
    console.log(JSON.stringify({ mode: remote ? 'staging' : 'local', ...result }))
  } finally {
    await platform.dispose()
  }
}

main().catch(error => {
  if (error instanceof CatalogImportError) {
    console.error(JSON.stringify({ ...error.counts, error: error.message }))
  } else {
    console.error(error instanceof Error ? error.message : String(error))
  }
  process.exitCode = 1
})
