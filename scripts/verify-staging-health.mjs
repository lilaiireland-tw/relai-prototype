import assert from 'node:assert/strict'
import { error as logError, log } from 'node:console'
import process from 'node:process'
import { setTimeout as delay } from 'node:timers/promises'
import { pathToFileURL, URL } from 'node:url'
import { logRemoteRisk, requireRemoteApproval } from './cloudflare-approval.mjs'

const { AbortSignal } = globalThis

export function stagingUrls(value) {
  const url = new URL(value)
  assert.equal(url.protocol, 'https:')
  assert.match(url.hostname, /^relai-prototype-staging\.[a-z0-9-]+\.workers\.dev$/, 'Use the stable staging Worker URL')
  assert.equal(url.port, '')
  assert.equal(url.username + url.password + url.search + url.hash, '')
  assert.equal(url.pathname, '/')
  return { app: `${url.origin}/relaiapp/`, health: `${url.origin}/relaiapp/api/v1/health` }
}

export async function verifyStagingHealth(value, { fetcher = globalThis.fetch, attempts = 6, wait = delay } = {}) {
  const urls = stagingUrls(value)
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      const response = await fetcher(urls.health, {
        headers: { Accept: 'application/json' },
        redirect: 'error',
        signal: AbortSignal.timeout(10_000),
      })
      assert.equal(response.status, 200, 'Health endpoint must return HTTP 200')
      assert.match(response.headers.get('content-type') ?? '', /application\/json/i, 'Health must return JSON')
      assert.deepEqual(await response.json(), { status: 'ok' })
      return urls
    } catch {
      if (attempt === attempts) throw new Error(`Staging health check failed after ${attempts} attempts`)
      await wait(5_000)
    }
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const args = requireRemoteApproval(process.argv.slice(2))
    assert.equal(args.length, 0, 'This staging health check accepts only the remote approval flag')
    logRemoteRisk('staging Worker health check', 'at most 6 GET requests to the health endpoint; the current route does not query D1.')
    const urls = await verifyStagingHealth(process.env.STAGING_URL)
    log(`Staging health passed: ${urls.health}`)
    log(`Product Owner test URL: ${urls.app}`)
  } catch (error) {
    logError(error instanceof Error ? error.message : String(error))
    process.exitCode = 1
  }
}
