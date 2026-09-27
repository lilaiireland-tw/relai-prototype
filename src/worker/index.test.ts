import { describe, expect, it } from 'vitest'
import app from './index'

describe('worker health endpoint', () => {
  it('responds under the API prefix', async () => {
    const response = await app.request('http://localhost/api/v1/health')

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ status: 'ok' })
  })
})
