import { appendFile, mkdir, readFile, writeFile } from 'node:fs/promises'
import { resolve, relative, isAbsolute } from 'node:path'
import { pathToFileURL } from 'node:url'
import { DatabaseSync } from 'node:sqlite'
import { applyCatalogChanges, parseCsv, planCatalogChanges, preflightChanges, type CatalogSnapshot } from './catalog-corrections'
import { openCatalogPlatform, requireStagingConfirmation } from './cefr-j-platform'
import { logRemoteRisk, requireRemoteApproval } from './cloudflare-approval.mjs'
import type { PersistenceDatabase } from '../src/worker/persistence/d1'
import { sqliteD1 } from './sqlite-d1'
import type { CatalogDatabase } from './cefr-j-catalog'

export function options(args: string[], env: NodeJS.ProcessEnv = process.env) {
  const remote = args.includes('--remote'), apply = args.includes('--apply')
  const flags = new Set(['--remote', '--apply', '--approve-remote-cloudflare'])
  const values: Record<string, string> = {}
  const seen = new Set<string>()
  for (let i = 0; i < args.length; i++) {
    const key = args[i]
    if (seen.has(key)) throw new Error(`Duplicate argument: ${key}`)
    seen.add(key)
    if (flags.has(key)) continue
    if (!['--snapshot', '--corrections', '--review', '--out', '--local-db', '--confirm-staging'].includes(key) ||
      !args[i + 1] || args[i + 1].startsWith('--')) throw new Error(`Invalid argument: ${key}`)
    values[key] = args[++i]
  }
  if (!values['--snapshot'] || !values['--corrections']) throw new Error('--snapshot and --corrections are required local files.')
  requireStagingConfirmation(remote, values['--confirm-staging'])
  if (remote) {
    if (!apply || values['--local-db']) throw new Error('Remote mode requires --apply and forbids --local-db; dry-run is offline only.')
    requireRemoteApproval(args, env)
  } else if (seen.has('--approve-remote-cloudflare')) throw new Error('Remote approval is invalid in local mode.')
  if (apply && !remote && !values['--local-db']) throw new Error('Local apply requires an explicit isolated --local-db.')
  const out = resolve(values['--out'] ?? 'data/catalog-local/report')
  const child = relative(resolve('data/catalog-local'), out)
  if (!child || child.startsWith('..') || isAbsolute(child)) throw new Error('Reports must use a child of gitignored data/catalog-local/.')
  return { remote, apply, out, snapshot: values['--snapshot'], corrections: values['--corrections'],
    review: values['--review'] ?? 'docs/catalog-112/starter-review.csv', localDb: values['--local-db'], confirmation: values['--confirm-staging'] }
}

async function main() {
  const opts = options(process.argv.slice(2))
  if (!opts.remote) await import('./deny-remote-network.mjs')
  const [sql, correctionCsv, reviewCsv] = await Promise.all([
    readFile(opts.snapshot, 'utf8'), readFile(opts.corrections, 'utf8'), readFile(opts.review, 'utf8'),
  ])
  // The PO-provided SQL is trusted local input, executed only in an ephemeral offline SQLite DB.
  // It is never sent to D1. All operator writes below are prepared, exact-ID changes.
  const snapshot = new DatabaseSync(':memory:')
  let rows: CatalogSnapshot[]
  try {
    snapshot.exec(sql)
    rows = snapshot.prepare('SELECT * FROM vocabulary_catalog').all() as CatalogSnapshot[]
  } finally { snapshot.close() }
  const corrections = parseCsv(correctionCsv)
  const plan = planCatalogChanges(rows, corrections, parseCsv(reviewCsv))
  await mkdir(opts.out, { recursive: true, mode: 0o700 })
  await writeFile(resolve(opts.out, 'plan.json'), JSON.stringify(plan, null, 2), { mode: 0o600 })
  const summary = { mode: opts.remote ? 'staging-apply' : opts.apply ? 'local-apply' : 'offline-dry-run',
    input: plan.trace.length, changed: plan.trace.filter(row => row.status === 'changed').length,
    unchanged: plan.trace.filter(row => row.status === 'unchanged').length,
    private_pending: plan.trace.filter(row => row.status === 'private_pending').length,
    correction_fields: plan.trace.reduce((count, row) => count + row.fields.length, 0),
    pending_catalog_rows: plan.changes.length, starter_completions: plan.changes.filter(row => row.reason === 'starter_completion').length,
    risk: 'One indexed preflight read per changed ID; apply uses one guarded exact-ID read, one row update and one history insert per pending ID. No catalog scans remotely; actual billing may differ.' }
  await writeFile(resolve(opts.out, 'summary.json'), JSON.stringify(summary, null, 2), { mode: 0o600 })
  console.log(JSON.stringify(summary))
  if (!opts.apply) return
  if (opts.remote) logRemoteRisk('Issue #112 staging corrections', summary.risk)
  const platform = opts.remote ? await openCatalogPlatform(true, opts.confirmation) : undefined
  const local = !opts.remote ? new DatabaseSync(resolve(opts.localDb!)) : undefined
  const db = local ? sqliteD1(local) : platform!.env.DB as PersistenceDatabase & CatalogDatabase
  const receipt = resolve(opts.out, `apply-${Date.now()}-${crypto.randomUUID()}.jsonl`)
  try {
    const at = new Date().toISOString()
    const preflight = await preflightChanges(db, plan.changes, at)
    await writeFile(`${receipt}.backup.json`, JSON.stringify(preflight, null, 2), { flag: 'wx', mode: 0o600 })
    if (preflight.conflicts.length) throw new Error(`Preflight conflicts: ${preflight.conflicts.join(', ')}; no writes attempted.`)
    // Durable exact-ID old/new values are saved before the first write. Restrict directory ACLs on Windows.
    await writeFile(receipt, JSON.stringify({ at, unchanged: preflight.unchanged }) + '\n', { flag: 'wx', mode: 0o600 })
    await applyCatalogChanges(db, preflight.pending, async (id, version) => {
      await appendFile(receipt, JSON.stringify({ id, version, status: 'applied' }) + '\n')
    })
    console.log(JSON.stringify({ applied: preflight.pending.length, unchanged: preflight.unchanged.length }))
  } catch (error) {
    await appendFile(receipt, JSON.stringify({ status: 'stopped', error: error instanceof Error ? error.message : String(error) }) + '\n')
    throw error
  } finally { local?.close(); await platform?.dispose() }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main().catch(error => {
  console.error(error instanceof Error ? error.message : String(error)); process.exitCode = 1
})
