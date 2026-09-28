import assert from 'node:assert/strict'
import { log } from 'node:console'
import { appendFile } from 'node:fs/promises'
import process from 'node:process'
import { setTimeout as delay } from 'node:timers/promises'
import { pathToFileURL, URL } from 'node:url'

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
  const urls = await verifyStagingHealth(process.env.STAGING_URL)
  log(`Staging health passed: ${urls.health}`)
  log(`Product Owner test URL: ${urls.app}`)
  if (process.env.GITHUB_OUTPUT) await appendFile(process.env.GITHUB_OUTPUT, `app_url=${urls.app}\n`)
  if (process.env.GITHUB_STEP_SUMMARY) {
    await appendFile(process.env.GITHUB_STEP_SUMMARY,
      `### Staging deployment\n\nCommit: ${process.env.GITHUB_SHA}\n\n` +
      `- [Test app](${urls.app})\n- [Health](${urls.health}): HTTP 200, \`{"status":"ok"}\`\n` +
      '- Worker: `relai-prototype-staging`\n- Binding: `DB` -> `relai-staging-db`\n')
  }
}
