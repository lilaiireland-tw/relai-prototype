import { describe, expect, it, vi } from 'vitest'
import { apiUrl, createApiClient } from './api'
import { createApp } from '../../worker'

describe('same-origin client API', () => {
  const user = { id: 'u1', username: 'Exact User', display_name: 'Alex', role: 'user', must_change_password: false }
  it('posts only password-change fields and retains auth on a wrong current password', async () => {
    const transport = vi.fn<typeof fetch>().mockResolvedValue(new Response(null, { status: 401 }))
    const client = createApiClient(transport)
    const unauthorized = vi.fn()
    client.onUnauthorized(unauthorized)
    await expect(client.changePassword({ current_password: ' old ', new_password: ' new-value ' })).rejects.toMatchObject({ status: 401 })
    expect(transport).toHaveBeenCalledWith('/relaiapp/api/v1/auth/change-password', expect.objectContaining({
      method: 'POST', credentials: 'same-origin', body: JSON.stringify({ current_password: ' old ', new_password: ' new-value ' }),
    }))
    expect(unauthorized).not.toHaveBeenCalled()
  })
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

  it('accepts individual ambiguous results and returns saved cards', async () => {
    const card = { id: '00000000-0000-4000-8000-000000000001', user_id: 'u1', source_item_id: null,
      card_type: 'vocabulary', front_content: 'bank', back_content: '河岸', part_of_speech: 'noun',
      zh_tw_definition: '河岸', english_example: 'They walked along the bank.', zh_tw_example_translation: '他們沿著河岸走。',
      explanation: null, irish_usage: null, source: 'gemini-ai 1', is_favorite: false,
      last_reviewed_at: null, next_review_at: null, created_at: '2026-01-01T00:00:00.000Z', updated_at: '2026-01-01T00:00:00.000Z' }
    const ambiguous = { headword: 'bank', status: 'ambiguous', reason: 'ambiguous_sense',
      item: { headword: 'bank', part_of_speech: 'noun', semantic_sense: 'land beside water',
        source_context: 'by the river', confidence: 0.99 },
      options: [{ catalog_id: '00000000-0000-4000-8000-000000000002', semantic_sense: 'land beside a river' }] }
    const transport = vi.fn<typeof fetch>().mockResolvedValue(Response.json({ results: [ambiguous,
      { headword: 'curious', status: 'saved', card_id: card.id }], cards: [card] }))
    const client = createApiClient(transport)
    const items = [{ headword: 'bank', part_of_speech: 'noun', semantic_sense: 'river edge', source_context: 'by the river' }]
    await expect(client.saveVocabulary('00000000-0000-4000-8000-000000000001', items)).resolves.toMatchObject({
      results: [{ status: 'ambiguous', options: [{ semantic_sense: 'land beside a river' }] },
        { status: 'saved', card_id: card.id }], cards: [{ id: card.id }],
    })
    expect(transport).toHaveBeenCalledWith('/relaiapp/api/v1/vocabulary/save', expect.objectContaining({
      signal: expect.any(AbortSignal),
    }))
    transport.mockResolvedValue(Response.json({ results: [{ headword: 'bank', status: 'ambiguous' }], cards: [] }))
    await expect(client.saveVocabulary('00000000-0000-4000-8000-000000000001', items))
      .rejects.toMatchObject({ kind: 'invalid-response' })
  })

  it.each(['<html>SPA fallback</html>', '{broken'])('rejects non-JSON successful responses', async body => {
    const transport = vi.fn<typeof fetch>().mockResolvedValue(new Response(body))
    await expect(createApiClient(transport).getHealth()).rejects.toMatchObject({ kind: 'invalid-response' })
  })
})
