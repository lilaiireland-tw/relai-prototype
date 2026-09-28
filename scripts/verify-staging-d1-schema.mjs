import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { log } from 'node:console'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { argv, env, execPath } from 'node:process'
import { unstable_readConfig as readConfig } from 'wrangler'
import { verifyCoreSchema } from './d1-schema-verification.mjs'

// Explicit operator command only. No apply/list commands or arbitrary SQL input.
assert.equal(argv.length, 2, 'This staging-only verifier accepts no arguments')
const account = '622900d9297cd7c09cad966aaae64617'
assert.equal(env.CLOUDFLARE_ACCOUNT_ID, account, 'Select the verified ReLai account explicitly')
const config = readConfig({ config: 'wrangler.jsonc', env: 'staging' })
assert.equal(config.name, 'relai-prototype-staging')
assert.equal(config.d1_databases.length, 1)
const [db] = config.d1_databases
assert.equal(db.binding, 'DB')
assert.equal(db.database_name, 'relai-staging-db')
assert.equal(db.migrations_dir, 'migrations')
assert.notEqual(db.remote, true)

const run = (args) => {
  const result = spawnSync(execPath, [resolve('node_modules/wrangler/bin/wrangler.js'),
    ...args, '--config', 'wrangler.jsonc', '--env', 'staging', '--json'], {
    encoding: 'utf8', timeout: 60000,
    env: { ...env, WRANGLER_SEND_METRICS: 'false',
      WRANGLER_LOG_PATH: env.WRANGLER_LOG_PATH ?? join(tmpdir(), 'relai-25-wrangler') },
  })
  assert.ifError(result.error)
  assert.equal(result.status, 0, result.stdout + result.stderr)
  return JSON.parse(result.stdout)
}
const info = run(['d1', 'info', db.database_name])
assert.equal(info.name, db.database_name)
assert.equal(info.uuid, db.database_id, 'Remote identity must match the source staging binding')
const deployments = run(['deployments', 'list'])
assert.ok(deployments.length > 0, 'Staging must have an active deployment')
const active = deployments.toSorted((a, b) => a.created_on.localeCompare(b.created_on)).at(-1)
for (const version of active.versions) {
  const details = run(['versions', 'view', version.version_id])
  const bindings = details.resources.bindings.filter((binding) => binding.type === 'd1')
  assert.equal(bindings.length, 1)
  assert.equal(bindings[0].name, 'DB')
  assert.equal(bindings[0].database_id, db.database_id, 'Live staging Worker must still bind the staging DB')
}
const execute = (sql) => {
  const responses = run(['d1', 'execute', db.database_name, '--remote', '--command', sql])
  for (const response of responses) {
    assert.equal(response.success, true)
    assert.equal(response.meta.rows_written, 0, 'Verification must remain read-only')
    assert.equal(response.meta.changed_db, false)
  }
  return responses
}
const verified = verifyCoreSchema(execute)
log(JSON.stringify({ account, worker: config.name, binding: db.binding,
  deployment: active.id, versions: active.versions,
  database: info.name, tables: verified.tables, indexes: verified.indexes,
  history: execute('SELECT id, name, applied_at FROM d1_migrations ORDER BY id')[0].results,
  verification: 'Exact PRD columns/defaults/keys, required indexes/uniqueness, empty tables and committed migration history verified; all queries read-only.',
}, null, 2))
