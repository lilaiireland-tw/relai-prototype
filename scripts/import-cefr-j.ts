import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { CatalogImportError, importCatalog, importReviewedDemo } from './cefr-j-catalog'
import { openCatalogPlatform, requireStagingConfirmation } from './cefr-j-platform'

export function options(args: string[]) {
  let file: string | undefined
  let enrichmentFile = 'data/ai-enrichment/b1-sample-20.json'
  let remote = false
  let confirmation: string | undefined
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--file') file = args[++i]
    else if (args[i] === '--enrichment') enrichmentFile = args[++i]
    else if (args[i] === '--remote') remote = true
    else if (args[i] === '--confirm-staging') confirmation = args[++i]
    else throw new Error(`Unknown argument: ${args[i]}`)
  }
  if (!file) throw new Error('Usage: npm run catalog:import -- --file <manifest.json> [--enrichment <reviewed.json>] [--remote --confirm-staging relai-staging-db]')
  requireStagingConfirmation(remote, confirmation)
  return { file, enrichmentFile, remote, confirmation }
}

async function main() {
  const { file, enrichmentFile, remote, confirmation } = options(process.argv.slice(2))
  const manifest: unknown = JSON.parse(await readFile(resolve(file), 'utf8'))
  const enrichment: unknown = JSON.parse(await readFile(resolve(enrichmentFile), 'utf8'))
  const platform = await openCatalogPlatform(remote, confirmation)
  try {
    const result = await importCatalog(platform.env.DB, manifest)
    const reviewedDemo = await importReviewedDemo(platform.env.DB, enrichment)
    console.log(JSON.stringify({ mode: remote ? 'staging' : 'local', ...result, reviewed_demo: reviewedDemo }))
  } finally {
    await platform.dispose()
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main().catch(error => {
  if (error instanceof CatalogImportError) {
    console.error(JSON.stringify({ ...error.counts, error: error.message }))
  } else {
    console.error(error instanceof Error ? error.message : String(error))
  }
  process.exitCode = 1
})
