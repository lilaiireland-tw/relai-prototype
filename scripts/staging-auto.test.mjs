import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, writeFileSync, rmSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import process from 'node:process'
import { test } from 'node:test'
import { unstable_readConfig as readConfig } from 'wrangler'
import { directoryDigest } from './staging-build-record.mjs'
import { deployAuto, verifyAutoRelease } from './deploy-staging-auto.mjs'
import { verifyAutoStagingBindings } from './verify-staging-build.mjs'

const current = { commit: 'a'.repeat(40), build: '12345678-1234-1234-1234-123456789abc', migrations: 'schema-digest', artifacts: 'artifact-digest' }
const env = {
  WORKERS_CI: '1', WORKERS_CI_BRANCH: 'develop', WORKERS_CI_COMMIT_SHA: current.commit,
  WORKERS_CI_BUILD_UUID: current.build, CLOUDFLARE_API_TOKEN: 'mock-only', CLOUDFLARE_ACCOUNT_ID: 'b'.repeat(32),
  STAGING_URL: 'https://relai-prototype-staging.lilaiireland.workers.dev',
}
const policy = { enabled: true, migrations: current.migrations }

test('automatic release rejects local/PR/production contexts, missing credentials, schema holds and stale validation', () => {
  verifyAutoRelease(env, policy, current, current)
  for (const patch of [
    { WORKERS_CI: '' }, { WORKERS_CI_BRANCH: 'feature/test' }, { WORKERS_CI_BRANCH: 'main' },
    { WORKERS_CI_COMMIT_SHA: 'c'.repeat(40) }, { WORKERS_CI_COMMIT_SHA: 'short' },
    { WORKERS_CI_BUILD_UUID: '' }, { CLOUDFLARE_API_TOKEN: '' }, { CLOUDFLARE_ACCOUNT_ID: '' },
    { GITHUB_ACTIONS: 'true' }, { CLOUDFLARE_ENV: 'staging' }, { CLOUDFLARE_ENV: 'production' },
    { RELAI_REMOTE_CLOUDFLARE_APPROVAL: 'unexpected' }, { STAGING_URL: 'https://relai-prototype.lilaiireland.workers.dev' },
  ]) assert.throws(() => verifyAutoRelease({ ...env, ...patch }, policy, current, current))
  for (const invalid of [{ enabled: false, migrations: current.migrations }, { enabled: true, migrations: null }, { enabled: true, migrations: 'old' }]) {
    assert.throws(() => verifyAutoRelease(env, invalid, current, current), /hold/)
  }
  for (const recorded of [null, { ...current, commit: 'old' }, { ...current, build: 'old' }, { ...current, artifacts: 'changed' }, { consumed: true }]) {
    assert.throws(() => verifyAutoRelease(env, policy, current, recorded), /fresh successful validated build/)
  }
})

test('auto deployment limits bindings to the approved Worker, D1, EU R2 and staging queues', () => {
  const staging = readConfig({ config: 'wrangler.jsonc', env: 'staging' })
  verifyAutoStagingBindings(staging, staging)
  for (const patch of [
    { name: 'relai-prototype' }, { name: 'relai-prototype-staging-staging' },
    { d1_databases: [{ ...staging.d1_databases[0], database_name: 'relai-prod-db' }] },
    { d1_databases: [{ ...staging.d1_databases[0], database_id: 'wrong-id' }] },
    { routes: ['example.com/*'] }, { secrets: { required: [] } },
    { r2_buckets: [{ ...staging.r2_buckets[0], jurisdiction: 'us' }] },
    { triggers: { crons: ['* * * * *'] } }, { queues: {} },
  ]) assert.throws(() => verifyAutoStagingBindings({ ...staging, ...patch }, staging))
})

test('auto dispatcher stops before every remote step on validation/dry-run failures and consumes duplicate builds', async () => {
  const calls = []
  let recorded = current
  const options = {
    env, policy, current, recorded,
    run: args => calls.push(args), consume: () => { recorded = { consumed: true } },
    health: async url => calls.push(url), report: message => calls.push(message),
  }
  await assert.rejects(deployAuto({ ...options, policy: { enabled: false } }))
  assert.equal(calls.length, 0)
  await assert.rejects(deployAuto({ ...options, run: () => { throw new Error('config failed') } }), /config failed/)
  assert.equal(recorded, current)
  await assert.rejects(deployAuto({ ...options, run: args => {
    calls.push(args)
    if (args.includes('--dry-run')) throw new Error('packaging failed')
  } }), /packaging failed/)
  assert.deepEqual(recorded, { consumed: true })
  assert.equal(calls.length, 2)
  await assert.rejects(deployAuto({ ...options, recorded }), /fresh successful/)
  calls.length = 0
  await deployAuto(options)
  assert.equal(calls.length, 5)
  assert.ok(calls[0].includes('--auto'))
  assert.ok(calls[1].includes('--dry-run'))
  assert.deepEqual(calls[2], ['node_modules/wrangler/bin/wrangler.js', 'deploy', '--config', 'dist/relai_prototype/wrangler.json'])
  assert.match(calls[3], new RegExp(current.commit))
  assert.match(calls[3], /https:\/\/dash.cloudflare.com\//)
  assert.equal(calls[4], env.STAGING_URL)
  calls.length = 0
  await assert.rejects(deployAuto({ ...options, health: async () => { throw new Error('health failed') } }), /health failed/)
  assert.equal(calls.length, 4, 'A failed health check never triggers another deploy')
})

test('migration digest covers old contents and every filename, independent of creation order', () => {
  const root = mkdtempSync(join(tmpdir(), 'relai-schema-hold-'))
  try {
    writeFileSync(join(root, '0001.sql'), 'CREATE TABLE example (id INTEGER);')
    const original = directoryDigest(root)
    writeFileSync(join(root, '0001.sql'), 'CREATE TABLE example (id TEXT);')
    assert.notEqual(directoryDigest(root), original)
    writeFileSync(join(root, '0001.sql'), 'CREATE TABLE example (id INTEGER);')
    assert.equal(directoryDigest(root), original)
    writeFileSync(join(root, '0002.sql'), '-- new migration')
    assert.notEqual(directoryDigest(root), original)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('validated build clears old receipt before checks and records only after all checks succeed', () => {
  const { scripts } = JSON.parse(readFileSync('package.json', 'utf8'))
  const command = scripts['build:staging:validated']
  assert.match(command, /^node --import .*staging-build-record.mjs begin && npm run lint && npm run typecheck && npm test && npm run build/)
  assert.match(command, /verify:staging-build && node --import .*staging-build-record.mjs complete$/)
  const release = JSON.parse(readFileSync('staging-release.json', 'utf8'))
  assert.equal(typeof release.enabled, 'boolean')
  if (release.enabled) assert.match(release.migrations, /^[a-f0-9]{64}$/)
  else assert.ok(release.migrations === null || /^[a-f0-9]{64}$/.test(release.migrations))
})

test('real automatic entry point cannot dispatch from an isolated local process', () => {
  const result = spawnSync(process.execPath, ['scripts/deploy-staging-auto.mjs'], {
    env: { ...process.env, WORKERS_CI: '', CLOUDFLARE_API_TOKEN: '' }, encoding: 'utf8',
  })
  assert.notEqual(result.status, 0)
})
