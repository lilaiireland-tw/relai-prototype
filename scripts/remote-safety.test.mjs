import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { URL } from 'node:url'
import { readFileSync } from 'node:fs'
import process from 'node:process'
import { test } from 'node:test'
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

test('guarded commands keep Wrangler logs in the repository', () => {
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
