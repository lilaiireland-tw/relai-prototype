import assert from 'node:assert/strict'
import { Buffer } from 'node:buffer'
import { readFile } from 'node:fs/promises'
import { test } from 'node:test'
import { URL } from 'node:url'
import { preview } from 'vite'

const { fetch } = globalThis

test('built Cloudflare routing under /relaiapp', { timeout: 60_000 }, async (t) => {
  const server = await preview({ preview: { host: '127.0.0.1', port: 0, open: false } })
  try {
    const origin = `http://127.0.0.1:${server.httpServer.address().port}`
    const html = await readFile(new URL('../dist/client/index.html', import.meta.url), 'utf8')
    const navigateHeaders = { Accept: 'text/html', 'Sec-Fetch-Mode': 'navigate' }

    await t.test('direct navigation and refresh return the built SPA document', async () => {
      for (const path of ['', '/', '/login', '/home', '/cards', '/flashcards', '/error-log', '/auth?mode=register', '/stats', '/settings']) {
        const response = await fetch(`${origin}/relaiapp${path}`, { headers: navigateHeaders })
        assert.equal(response.status, 200, path)
        assert.match(response.headers.get('content-type'), /text\/html/)
        assert.equal(await response.text(), html, path)
      }
    })

    await t.test('generated asset URLs serve asset bytes instead of SPA HTML', async () => {
      const assetPaths = [...html.matchAll(/(?:src|href)="([^"]+)"/g)].map((match) => match[1])
      assert.ok(assetPaths.length > 0)
      for (const path of assetPaths) {
        assert.ok(path.startsWith('/relaiapp/assets/'), path)
        const response = await fetch(`${origin}${path}`)
        assert.equal(response.status, 200, path)
        assert.match(response.headers.get('content-type'), /javascript|text\/css/)
        const file = new URL(`../dist/client/${path.slice('/relaiapp/'.length)}`, import.meta.url)
        assert.deepEqual(Buffer.from(await response.arrayBuffer()), await readFile(file), path)
      }
    })

    await t.test('health remains JSON even on browser navigation', async () => {
      for (const headers of [{ Accept: 'application/json' }, navigateHeaders]) {
        const response = await fetch(`${origin}/relaiapp/api/v1/health`, { headers })
        assert.equal(response.status, 200)
        assert.match(response.headers.get('content-type'), /application\/json/)
        assert.deepEqual(await response.json(), { status: 'ok' })
      }
    })

    await t.test('the entire API namespace bypasses SPA fallback', async () => {
      for (const path of ['/api', '/api/', '/api/unknown', '/api/v1', '/api/v1/unknown', '/api/v1/cards', '/api/v1/auth/login', '/api/v1/stats/summary', '/api/v1/settings', '/api/v2/health']) {
        const response = await fetch(`${origin}/relaiapp${path}`, { headers: navigateHeaders })
        assert.equal(response.status, 404, path)
        assert.match(response.headers.get('content-type'), /application\/json/)
        assert.deepEqual(await response.json(), {
          error: { code: 'NOT_FOUND', message: 'API route not found.' },
        })
      }
      const response = await fetch(`${origin}/relaiapp/api/v1/health`, { method: 'POST' })
      assert.equal(response.status, 404)
      assert.match(response.headers.get('content-type'), /application\/json/)
    })
  } finally {
    await server.close()
  }
})
