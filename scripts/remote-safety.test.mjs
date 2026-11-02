import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { URL } from 'node:url'
import { readFileSync } from 'node:fs'
import process from 'node:process'
import { test } from 'node:test'
import { unstable_readConfig as readConfig } from 'wrangler'
import { remoteApprovalEnv, requireRemoteApproval } from './cloudflare-approval.mjs'
import { assertLocalNetworkTarget } from './deny-remote-network.mjs'

test('remote Cloudflare approval fails closed unless both independent opt-ins are present', () => {
  assert.throws(() => requireRemoteApproval(['--approve-remote-cloudflare'], {}), /Blocked remote Cloudflare access/)
  assert.throws(() => requireRemoteApproval([], { [remoteApprovalEnv]: 'I_UNDERSTAND_REMOTE_CLOUDFLARE_COSTS_AND_IMPACT' }), /Blocked remote Cloudflare access/)
  assert.deepEqual(requireRemoteApproval(['--approve-remote-cloudflare', 'd1', 'execute'], {
    [remoteApprovalEnv]: 'I_UNDERSTAND_REMOTE_CLOUDFLARE_COSTS_AND_IMPACT',
  }), ['d1', 'execute'])
})

test('isolated checks block Cloudflare and Google hosts and allow loopback services', async () => {
  assert.throws(() => assertLocalNetworkTarget('api.cloudflare.com', 'https:'), /Blocked remote network access/)
  assert.throws(() => assertLocalNetworkTarget('generativelanguage.googleapis.com', 'https:'), /Blocked remote network access/)
  assert.doesNotThrow(() => assertLocalNetworkTarget('127.0.0.1'))
  await assert.rejects(globalThis.fetch('https://api.cloudflare.com/client/v4/'), /Blocked remote network access/)
  await assert.rejects(globalThis.fetch('https://generativelanguage.googleapis.com/'), /Blocked remote network access/)
})

test('local npm entry points use the credential and network isolation wrapper', () => {
  const { scripts } = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'))
  for (const name of [
    'dev', 'build', 'build:production', 'preview', 'lint', 'typecheck', 'verify:d1-config',
    'verify:staging-build', 'test:e2e:report', 'test:e2e:trace', 'db:migrations:create',
    'db:migrations:list:local', 'db:migrations:apply:local',
  ]) assert.match(scripts[name], /deny-remote-network\.mjs/)
  for (const name of ['test', 'test:d1-schema', 'test:persistence', 'test:auth', 'test:auth-api', 'test:e2e']) {
    assert.match(scripts[name], /run-isolated-tests\.mjs/)
  }
})

test('staging and production local Workers do not bind .dev.vars secrets', async () => {
  for (const env of ['staging', 'production']) {
    const config = await readConfig({ config: 'wrangler.jsonc', env })
    assert.deepEqual(config.secrets, { required: [] })
  }
})

test('local network guard clears Cloudflare and Google credentials before command code runs', () => {
  const names = [
    'CLOUDFLARE_API_TOKEN', 'CLOUDFLARE_API_KEY', 'CF_API_TOKEN', 'CLOUDFLARE_ACCOUNT_ID',
    'GOOGLE_API_KEY', 'GOOGLE_APPLICATION_CREDENTIALS', 'GEMINI_API_KEY',
  ]
  const env = { ...process.env, ...Object.fromEntries(names.map(name => [name, 'local-safety-test-sentinel'])) }
  const probe = `import process from 'node:process'; process.exitCode = ${JSON.stringify(names)}.some(name => process.env[name] !== '') ? 1 : 0`
  const result = spawnSync(process.execPath, [
    '--import', new URL('./deny-remote-network.mjs', import.meta.url).href,
    '--input-type=module', '-e', probe,
  ], { env, encoding: 'utf8' })
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`)
})

test('guarded commands keep Wrangler configuration, registry and logs in the repository', () => {
  assert.match(process.env.XDG_CONFIG_HOME ?? '', /\.wrangler[\\/](?:e2e[\\/]config|local[\\/]config)$/)
  assert.match(process.env.WRANGLER_REGISTRY_PATH ?? '', /\.wrangler[\\/](?:e2e[\\/]registry|local[\\/]registry)$/)
  assert.match(process.env.WRANGLER_LOG_PATH ?? '', /\.wrangler[\\/]logs$/)
})

test('remote schema verifier contains no application-table row scans', () => {
  const source = readFileSync(new URL('./verify-staging-d1-schema.mjs', import.meta.url), 'utf8')
  assert.doesNotMatch(source, /COUNT\s*\(\s*\*\s*\)|foreign_key_check/i)
  assert.match(source, /LIMIT 50/)
  const schema = readFileSync(new URL('./d1-schema-verification.mjs', import.meta.url), 'utf8')
  assert.match(schema, /LIMIT 200/)
})

test('CI strips Cloudflare and Google credentials from both jobs', () => {
  const ci = readFileSync(new URL('../.github/workflows/ci.yml', import.meta.url), 'utf8')
  for (const job of ['quality:', 'e2e:']) {
    const section = ci.split(job)[1]?.split(/\n {2}[a-z][\w-]*:/)[0] ?? ''
    assert.match(section, /CLOUDFLARE_API_TOKEN:\s*''/)
    assert.match(section, /GEMINI_API_KEY:\s*''/)
  }
})

test('ordinary CI never invokes remote migrations or deployment', () => {
  const ci = readFileSync(new URL('../.github/workflows/ci.yml', import.meta.url), 'utf8')
  assert.doesNotMatch(ci, /db:migrations:apply|wrangler[^\n]*--remote|npm run deploy/)
  assert.match(ci, /npm run test:e2e/)
})

test('remote Wrangler package scripts route through the fail-closed wrapper', () => {
  const { scripts } = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'))
  for (const name of [
    'db:migrations:list:staging', 'db:migrations:apply:staging', 'db:info:production',
    'db:migrations:list:production', 'db:migrations:apply:production',
  ]) {
    assert.match(scripts[name], /run-remote-wrangler\.mjs/)
  }
  assert.match(scripts.deploy, /deploy-staging\.mjs/)
  assert.match(scripts['deploy:staging:built'], /deploy-staging\.mjs/)
  assert.match(scripts['deploy:production'], /deploy-production\.mjs/)
})

test('remote schema verification fails before Wrangler is imported when approval is missing', () => {
  const result = spawnSync(process.execPath, ['scripts/verify-staging-d1-schema.mjs'], {
    env: { ...process.env, CLOUDFLARE_ACCOUNT_ID: '', [remoteApprovalEnv]: '' }, encoding: 'utf8',
  })
  assert.notEqual(result.status, 0)
  assert.match(result.stderr, /Blocked remote Cloudflare access/)
})

test('remote command entry points fail closed before dispatch when approval is missing', () => {
  const entryPoints = [
    ['scripts/run-remote-wrangler.mjs', 'staging-migration-list'],
    ['scripts/run-remote-wrangler.mjs', 'production-d1-info'],
    ['scripts/run-remote-wrangler.mjs', 'production-migration-list'],
    ['scripts/run-remote-wrangler.mjs', 'production-migration-apply'],
    ['scripts/verify-staging-health.mjs'],
    ['scripts/deploy-staging.mjs'],
    ['scripts/deploy-production.mjs'],
    ['--import', 'tsx', 'scripts/manage-user.ts', 'list'],
    ['--import', 'tsx', 'scripts/import-cefr-j.ts', '--file', 'missing.json', '--remote', '--confirm-staging', 'relai-staging-db'],
  ]
  for (const args of entryPoints) {
    const result = spawnSync(process.execPath, args, {
      env: { ...process.env, AUTH_PEPPER: 'local-test-only', [remoteApprovalEnv]: '', CLOUDFLARE_API_TOKEN: '', CLOUDFLARE_ACCOUNT_ID: '' },
      encoding: 'utf8',
    })
    assert.notEqual(result.status, 0, args.join(' '))
    assert.match(`${result.stdout}\n${result.stderr}`, /Blocked remote Cloudflare access/, args.join(' '))
  }
})

test('approved remote entry points reject unexpected arguments before dispatch', () => {
  const approvedEnv = {
    ...process.env,
    [remoteApprovalEnv]: 'I_UNDERSTAND_REMOTE_CLOUDFLARE_COSTS_AND_IMPACT',
    CLOUDFLARE_API_TOKEN: '',
    CLOUDFLARE_ACCOUNT_ID: '',
  }
  for (const args of [
    ['scripts/deploy-production.mjs', '--approve-remote-cloudflare', '--unexpected'],
    ['scripts/verify-staging-health.mjs', '--approve-remote-cloudflare', '--unexpected'],
  ]) {
    const result = spawnSync(process.execPath, args, { env: approvedEnv, encoding: 'utf8' })
    assert.notEqual(result.status, 0, args.join(' '))
    assert.match(`${result.stdout}\n${result.stderr}`, /Unknown production deployment option|only the remote approval flag/, args.join(' '))
  }
})
