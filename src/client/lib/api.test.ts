import { describe, expect, it, vi } from 'vitest'
import { apiUrl, createApiClient } from './api'
import { createApp } from '../../worker'

describe('same-origin client API', () => {
  it('constructs the health URL independently of the current SPA route', () => {
    expect(apiUrl('/health')).toBe('/relaiapp/api/v1/health')
  })

  it('decodes successful health and uses browser cookie compatible transport', async () => {
    const transport = vi.fn<typeof fetch>().mockResolvedValue(Response.json({ status: 'ok' }))
    await expect(createApiClient(transport).getHealth()).resolves.toEqual({ status: 'ok' })
    expect(transport).toHaveBeenCalledTimes(1)
    expect(transport).toHaveBeenCalledWith('/relaiapp/api/v1/health', {
      method: 'GET', mode: 'same-origin', credentials: 'same-origin',
      headers: { Accept: 'application/json' }, cache: 'no-store', signal: expect.any(AbortSignal),
    })
  })

  it('matches the actual existing Worker health contract', async () => {
    const transport: typeof fetch = async (input, init) => createApp().request(String(input), init)
    await expect(createApiClient(transport).getHealth()).resolves.toEqual({ status: 'ok' })
  })

  it.each([401, 404, 500, 503])('handles HTTP %s without exposing raw server details', async status => {
    const transport = vi.fn<typeof fetch>().mockResolvedValue(new Response('private server detail', { status }))
    await expect(createApiClient(transport).getHealth()).rejects.toMatchObject({ name: 'ApiError', kind: 'http', status })
    await expect(createApiClient(transport).getHealth()).rejects.not.toThrow('private server detail')
  })

  it.each([new TypeError('private network detail'), new DOMException('timeout', 'TimeoutError')])(
    'handles network failure or timeout', async error => {
      const transport = vi.fn<typeof fetch>().mockRejectedValue(error)
      await expect(createApiClient(transport).getHealth()).rejects.toMatchObject({ kind: 'network' })
      await expect(createApiClient(transport).getHealth()).rejects.not.toThrow(error.message)
    },
  )

  it.each([null, [], {}, { status: 'down' }, { status: true }, 'ok'])('rejects invalid health schema %j', async value => {
    const transport = vi.fn<typeof fetch>().mockResolvedValue(Response.json(value))
    await expect(createApiClient(transport).getHealth()).rejects.toMatchObject({ kind: 'invalid-response' })
  })

  it.each(['<html>SPA fallback</html>', '{broken'])('rejects non-JSON successful responses', async body => {
    const transport = vi.fn<typeof fetch>().mockResolvedValue(new Response(body))
    await expect(createApiClient(transport).getHealth()).rejects.toMatchObject({ kind: 'invalid-response' })
  })
})
