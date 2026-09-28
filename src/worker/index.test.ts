import { Hono } from 'hono'
import { describe, expect, it } from 'vitest'
import worker, { createApp } from './index'

describe('Worker API', () => {
  it('returns machine-readable health from the Worker entrypoint', async () => {
    const response = await worker.fetch(new Request('https://example.com/relaiapp/api/v1/health'))

    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toContain('application/json')
    expect(await response.json()).toEqual({ status: 'ok' })
  })

  it.each([
    '/relaiapp/api',
    '/relaiapp/api/',
    '/relaiapp/api/v1',
    '/relaiapp/api/v1/',
    '/relaiapp/api/v1/unknown',
    '/relaiapp/api/v2/health',
  ])(
    'returns JSON 404 for %s',
    async (path) => {
      const response = await createApp().request(path, { headers: { Accept: 'text/html' } })

      expect(response.status).toBe(404)
      expect(response.headers.get('content-type')).toContain('application/json')
      expect(await response.json()).toEqual({
        error: { code: 'NOT_FOUND', message: 'API route not found.' },
      })
    },
  )

  it('returns JSON 404 for an unsupported health method', async () => {
    const response = await createApp().request('/relaiapp/api/v1/health', { method: 'POST' })

    expect(response.status).toBe(404)
    expect(await response.json()).toEqual({
      error: { code: 'NOT_FOUND', message: 'API route not found.' },
    })
  })

  it.each(['sync', 'async'])('sanitizes %s errors from grouped API routes', async (mode) => {
    const app = createApp()
    const failingRoutes = new Hono()
    const error = new Error('private database details and secret')
    error.stack = 'private stack trace'
    failingRoutes.get('/failure', () => {
      if (mode === 'async') return Promise.reject(error)
      throw error
    })
    app.route('/relaiapp/api/v1', failingRoutes)

    const response = await app.request('/relaiapp/api/v1/failure')

    expect(response.status).toBe(500)
    expect(response.headers.get('content-type')).toContain('application/json')
    expect(await response.json()).toEqual({
      error: { code: 'INTERNAL_SERVER_ERROR', message: 'Internal server error.' },
    })
  })

  it.each(['/relaiapp/home', '/relaiapp/apiary/health', '/api/v1/health'])(
    'does not claim %s as an API route',
    async (path) => {
      const response = await createApp().request(path)

      expect(response.status).toBe(404)
      expect(response.headers.get('content-type')).toBeNull()
      expect(await response.text()).toBe('')
    },
  )
})
