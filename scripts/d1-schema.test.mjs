import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { test } from 'node:test'
import { env, execPath } from 'node:process'
import { schemaSql, verifyCoreSchema } from './d1-schema-verification.mjs'

// Explicit operator-only test: never wired into CI/CD or ordinary deploy scripts.
test('initial schema matches PRD on clean local D1 and Wrangler applies it only once', { timeout: 180000 }, () => {
  const persistence = mkdtempSync(join(tmpdir(), 'relai-24-d1-'))
  const run = (command, args = []) => {
    const result = spawnSync(execPath, [resolve('node_modules/wrangler/bin/wrangler.js'),
      'd1', ...command, 'relai-staging-db', '--config', 'wrangler.jsonc',
      '--env', 'staging', '--local', '--persist-to', persistence, ...args], {
      encoding: 'utf8', timeout: 60000,
      env: { ...env, CI: 'true', WRANGLER_SEND_METRICS: 'false', WRANGLER_LOG_PATH: join(persistence, 'logs') },
    })
    assert.ifError(result.error)
    assert.equal(result.status, 0, result.stdout + result.stderr)
    return result.stdout
  }
  const query = (sql) => JSON.parse(run(['execute'], ['--command', sql, '--json']))
    .flatMap((response) => response.results)
  const schema = () => query(schemaSql)
  assert.deepEqual(schema(), [], 'Fresh persistence must contain no application schema')
  assert.match(run(['migrations', 'apply']), /0001_initial_core_schema.sql/)

  const metadata = new Map()
  const { schema: initialSchema, history } = verifyCoreSchema((sql) => {
    const result = JSON.parse(run(['execute'], ['--command', sql, '--json']))
    metadata.set(sql, result)
    return result
  })
  const altered = (change) => (sql) => {
    const result = JSON.parse(JSON.stringify(metadata.get(sql)))
    change(sql, result)
    return result
  }
  assert.throws(() => verifyCoreSchema(altered((sql, result) => {
    if (sql.startsWith('PRAGMA index_info')) {
      const position = sql.split('\n').findIndex((line) => line.includes("'idx_sessions_user_id'"))
      result[position].results = []
    }
  })), /index required/)
  assert.throws(() => verifyCoreSchema(altered((sql, result) => {
    if (sql.startsWith('PRAGMA index_list')) {
      result[0].results.forEach((index) => { index.unique = 0 })
    }
  })), /username must be unique/)
  assert.throws(() => verifyCoreSchema(altered((sql, result) => {
    if (sql === 'SELECT name FROM d1_migrations ORDER BY id') {
      result[0].results.push({ name: 'unexpected.sql' })
    }
  })), /History must match/)
  assert.match(run(['migrations', 'apply']), /No migrations to apply/)
  assert.match(run(['migrations', 'list']), /No migrations to apply/)
  assert.deepEqual(schema(), initialSchema, 'Second apply must leave schema unchanged')
  assert.deepEqual(query('SELECT name FROM d1_migrations ORDER BY id'), history)
})
