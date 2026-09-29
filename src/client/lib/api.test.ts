import { describe, expect, it, vi } from 'vitest'
import { apiUrl, createApiClient } from './api'
import { createApp } from '../../worker'

describe('same-origin client API', () => {
  const user = { id: 'u1', username: 'Exact User', display_name: 'Alex', role: 'user', must_change_password: false }
  it('uses the typed auth contract and preserves credentials exactly', async () => {
    const transport = vi.fn<typeof fetch>().mockImplementation(async () => Response.json({ user, token: 'must-discard' }))
    const client = createApiClient(transport)
    await expect(client.login({ username: ' Exact User ', password: ' Secret ' })).resolves.toEqual({ user })
    expect(transport).toHaveBeenLastCalledWith('/relaiapp/api/v1/auth/login', expect.objectContaining({
      method: 'POST', mode: 'same-origin', credentials: 'same-origin', cache: 'no-store',
      headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: ' Exact User ', password: ' Secret ' }),
    }))
    await expect(client.me()).resolves.toEqual({ user })
    expect(transport).toHaveBeenLastCalledWith('/relaiapp/api/v1/auth/me', expect.objectContaining({ method: 'GET', credentials: 'same-origin' }))
    transport.mockResolvedValue(new Response(null, { status: 204 }))
    await expect(client.logout()).resolves.toBeUndefined()
    expect(transport).toHaveBeenLastCalledWith('/relaiapp/api/v1/auth/logout', expect.objectContaining({ method: 'POST', credentials: 'same-origin' }))
  })
  it('projects only safe user fields and rejects invalid auth responses', async () => {
    const transport = vi.fn<typeof fetch>().mockResolvedValue(Response.json({ user: { ...user, password: 'private', token: 'private' } }))
    await expect(createApiClient(transport).me()).resolves.toEqual({ user })
    for (const value of [null, {}, { user: null }, { user: { ...user, id: 42 } },
      { user: { ...user, must_change_password: 'false' } },
      { user: { ...user, must_change_password: undefined } }]) {
      transport.mockResolvedValue(Response.json(value))
      await expect(createApiClient(transport).me()).rejects.toMatchObject({ kind: 'invalid-response' })
    }
  })
  it('accepts other role strings from the Worker contract for login and me', async () => {
    const safeUser = { ...user, role: 'beta_tester' }
    const transport = vi.fn<typeof fetch>().mockImplementation(async () => Response.json({ user: safeUser }))
    const client = createApiClient(transport)
    await expect(client.login({ username: user.username, password: 'Secret' })).resolves.toEqual({ user: safeUser })
    await expect(client.me()).resolves.toEqual({ user: safeUser })
  })
  it.each([undefined, null, 42, true, [], {}])('rejects a non-string role %j for login and me', async role => {
    const transport = vi.fn<typeof fetch>().mockImplementation(async () => Response.json({ user: { ...user, role } }))
    const client = createApiClient(transport)
    await expect(client.login({ username: user.username, password: 'Secret' })).rejects.toMatchObject({ kind: 'invalid-response' })
    await expect(client.me()).rejects.toMatchObject({ kind: 'invalid-response' })
  })
  it('notifies session expiry subscribers, excluding login errors and caller-managed me', async () => {
    const transport = vi.fn<typeof fetch>().mockResolvedValue(new Response('private', { status: 401 }))
    const client = createApiClient(transport)
    const expired = vi.fn()
    const unsubscribe = client.onUnauthorized(expired)
    await expect(client.login({ username: 'x', password: 'x' })).rejects.toMatchObject({ status: 401 })
    await expect(client.me()).rejects.toMatchObject({ status: 401 })
    expect(expired).not.toHaveBeenCalled()
    await expect(client.getHealth()).rejects.toMatchObject({ status: 401 })
    expect(expired).toHaveBeenCalledTimes(1)
    unsubscribe()
    await expect(client.getHealth()).rejects.toMatchObject({ status: 401 })
    expect(expired).toHaveBeenCalledTimes(1)
  })
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
