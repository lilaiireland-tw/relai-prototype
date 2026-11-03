import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import { URL } from 'node:url'
import { unstable_readConfig as readConfig } from 'wrangler'
import { prepareDeployConfig } from './prepare-deploy-config.mjs'
import { verifyStagingBuild, verifyStagingDeployEnvironment } from './verify-staging-build.mjs'
import { stagingUrls, verifyStagingHealth } from './verify-staging-health.mjs'

const { Response } = globalThis

const staging = {
  name: 'relai-prototype-staging',
  workers_dev: true,
  routes: [],
  secrets: { required: ['AUTH_PEPPER', 'GEMINI_API_KEY'] },
  observability: { enabled: true, logs: { enabled: true, invocation_logs: true } },
  d1_databases: [{ binding: 'DB', database_name: 'relai-staging-db', database_id: 'staging-id' }],
}
const origin = 'https://relai-prototype-staging.example.workers.dev'

test('source Wrangler config enables observability only for staging', () => {
  const config = readConfig({ config: 'wrangler.jsonc', env: 'staging' })
  assert.equal(config.observability?.enabled, true)
  assert.equal(config.observability?.logs?.enabled, true)
  assert.equal(config.observability?.logs?.invocation_logs, true)
  for (const env of ['', 'production']) {
    const other = readConfig({ config: 'wrangler.jsonc', env })
    assert.notEqual(other.observability?.enabled, true)
    assert.notEqual(other.observability?.logs?.enabled, true)
  }
})

test('staging build guard rejects missing or disabled observability in source and generated config', () => {
  verifyStagingBuild(staging, staging)
  for (const observability of [
    undefined,
    { ...staging.observability, enabled: false },
    { logs: staging.observability.logs },
    { enabled: true },
    { enabled: true, logs: { invocation_logs: true } },
    { enabled: true, logs: { enabled: false, invocation_logs: true } },
    { enabled: true, logs: { enabled: true } },
    { enabled: true, logs: { enabled: true, invocation_logs: false } },
  ]) {
    const invalid = { ...staging, observability }
    assert.throws(() => verifyStagingBuild(invalid, staging), /Built staging.*must be enabled/)
    assert.throws(() => verifyStagingBuild(staging, invalid), /Source staging.*must be enabled/)
  }
})

test('staging deployment guard rejects a production build, swapped DB, extra binding and custom routes', () => {
  verifyStagingBuild(staging, staging)
  for (const patch of [
    { name: 'relai-prototype' },
    { name: 'relai-prototype-staging-staging' },
    { workers_dev: false },
    { route: 'example.com/*' },
    { routes: ['example.com/*'] },
    { d1_databases: [] },
    { d1_databases: [...staging.d1_databases, ...staging.d1_databases] },
    { d1_databases: [{ ...staging.d1_databases[0], database_name: 'relai-prod-db' }] },
    { d1_databases: [{ ...staging.d1_databases[0], database_id: 'production-id' }] },
    { d1_databases: [{ ...staging.d1_databases[0], binding: 'OTHER' }] },
    { secrets: { required: [] } },
    { secrets: { required: ['AUTH_PEPPER'] } },
  ]) assert.throws(() => verifyStagingBuild({ ...staging, ...patch }, staging))
})

test('staging and production deployment flows restore secret names after local builds', () => {
  assert.match(readFileSync(new URL('./deploy-staging.mjs', import.meta.url), 'utf8'), /prepare-deploy-config\.mjs', 'staging'/)
  assert.match(readFileSync(new URL('./deploy-production.mjs', import.meta.url), 'utf8'), /prepare-deploy-config\.mjs', 'production'/)
})

test('validated staging builds prepare the deployment config before verification', () => {
  const { scripts } = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'))
  assert.match(scripts['build:staging:validated'],
    /npm run build && node --import \.\/scripts\/deny-remote-network\.mjs scripts\/prepare-deploy-config\.mjs staging && npm run verify:staging-build/)
})

test('staging deploy rejects an inherited Cloudflare environment before Wrangler runs', () => {
  verifyStagingDeployEnvironment({})
  for (const value of ['staging', 'production']) {
    assert.throws(() => verifyStagingDeployEnvironment({ CLOUDFLARE_ENV: value }),
      /Unset CLOUDFLARE_ENV.*second -staging suffix/)
  }
})

test('staging deploy commands run the environment guard before Wrangler', () => {
  const { scripts } = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'))
  for (const name of ['deploy', 'deploy:staging:built']) {
    assert.match(scripts[name], /deploy-staging\.mjs/)
  }
  assert.match(readFileSync(new URL('./deploy-staging.mjs', import.meta.url), 'utf8'), /requireRemoteApproval/)
})

test('staging and production deployment preparation preserves only required secret names and exact D1 targets', () => {
  for (const env of ['staging', 'production']) {
    const source = readConfig({ config: 'wrangler.jsonc', env })
    const built = { name: source.name, d1_databases: source.d1_databases, secrets: { required: [] } }
    const prepared = prepareDeployConfig(built, source)
    assert.deepEqual(prepared.secrets, { required: ['AUTH_PEPPER', 'GEMINI_API_KEY'] })
    assert.deepEqual(prepared.d1_databases, source.d1_databases)
    assert.throws(() => prepareDeployConfig({ ...built, name: 'wrong-worker' }, source), /must match/)
    assert.throws(() => prepareDeployConfig({ ...built, d1_databases: [] }, source), /Exactly one built D1/)
  }
})

test('health URL guard accepts only the stable staging workers.dev origin', () => {
  assert.equal(stagingUrls(origin).health, `${origin}/relaiapp/api/v1/health`)
  for (const value of [undefined, 'http://relai-prototype-staging.example.workers.dev',
    'https://relai-prototype.example.workers.dev', 'https://version-relai-prototype-staging.example.workers.dev',
    `${origin}/relaiapp/`, `${origin}?token=value`, `${origin}:444`,
    'https://user:password@relai-prototype-staging.example.workers.dev',
  ]) assert.throws(() => stagingUrls(value))
})

test('health check validates the API path, HTTP status, JSON content type and exact body', async () => {
  const urls = await verifyStagingHealth(origin, { fetcher: async (url, options) => {
    assert.equal(url, `${origin}/relaiapp/api/v1/health`)
    assert.equal(options.redirect, 'error')
    return Response.json({ status: 'ok' })
  } })
  assert.equal(urls.app, `${origin}/relaiapp/`)
  for (const fetcher of [
    async () => new Response('unavailable', { status: 503 }),
    async () => new Response('<html>SPA fallback</html>', { headers: { 'content-type': 'text/html' } }),
    async () => Response.json({ status: 'failed' }),
    async () => { throw new Error('network failure') },
  ]) await assert.rejects(verifyStagingHealth(origin, { fetcher, attempts: 1 }), /health check failed/)
})

test('health retries transient failures and fails after the bounded retry count', async () => {
  let calls = 0
  let waits = 0
  const wait = async () => { waits++ }
  const fetcher = async () => ++calls === 2 ? Response.json({ status: 'ok' }) : new Response('', { status: 503 })
  await verifyStagingHealth(origin, { fetcher, attempts: 2, wait })
  assert.equal(calls, 2)
  assert.equal(waits, 1)
  calls = 0
  waits = 0
  await assert.rejects(verifyStagingHealth(origin, {
    fetcher: async () => { calls++; throw new Error('network failure') }, attempts: 3, wait,
  }), /failed after 3 attempts/)
  assert.equal(calls, 3)
  assert.equal(waits, 2)
})
