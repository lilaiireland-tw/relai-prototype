import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { log } from 'node:console'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { argv, env, execPath } from 'node:process'
import { logRemoteRisk, requireRemoteApproval } from './cloudflare-approval.mjs'
import { verifyCoreSchema } from './d1-schema-verification.mjs'

// Explicit operator command only. No apply/list commands or arbitrary SQL input.
requireRemoteApproval(argv.slice(2))
assert.equal(argv.length, 3, 'Pass only --approve-remote-cloudflare after the two required owner opt-ins')
logRemoteRisk('staging D1 schema verification', '0 application-table rows; at most 200 sqlite_schema rows plus metadata for known tables and 50 migration-history rows. Cloudflare billing may differ.')
const { unstable_readConfig: readConfig } = await import('wrangler')
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
const execute = (sql) => {
  const responses = run(['d1', 'execute', db.database_name, '--remote', '--command', sql])
  for (const response of responses) {
    assert.equal(response.success, true)
    assert.equal(response.meta.rows_written, 0, 'Verification must remain read-only')
    assert.equal(response.meta.changed_db, false)
  }
  return responses
}
const verified = verifyCoreSchema(execute, { requireEmpty: false })
const history = execute('SELECT id, name, applied_at FROM d1_migrations ORDER BY id LIMIT 50')[0].results
log(JSON.stringify({ account, worker: config.name, binding: db.binding,
  database: info.name, tables: verified.tables, indexes: verified.indexes,
  history,
  verification: 'Exact PRD columns/defaults/keys, required indexes/uniqueness and bounded migration history verified. No application-table scans are run.',
}, null, 2))
