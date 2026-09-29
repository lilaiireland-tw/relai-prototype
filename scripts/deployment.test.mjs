import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import { URL } from 'node:url'
import { verifyStagingBuild, verifyStagingDeployEnvironment } from './verify-staging-build.mjs'
import { stagingUrls, verifyStagingHealth } from './verify-staging-health.mjs'

const { Response } = globalThis

const staging = {
  name: 'relai-prototype-staging',
  workers_dev: true,
  routes: [],
  d1_databases: [{ binding: 'DB', database_name: 'relai-staging-db', database_id: 'staging-id' }],
}
const origin = 'https://relai-prototype-staging.example.workers.dev'

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
  ]) assert.throws(() => verifyStagingBuild({ ...staging, ...patch }, staging))
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
    assert.match(scripts[name], /npm run verify:staging-build && wrangler deploy/)
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
