import { Hono } from 'hono'
import { z } from 'zod'
import { readSessionToken, writeSessionCookie } from '../auth/session'
import type { AuthEnv } from '../auth/types'
import { requireAuth } from '../middleware/auth'
import { createRepositories } from '../persistence'
import { createAuthService } from '../services/auth'

const loginInput = z.object({ username: z.string().min(1), password: z.string().min(1) })
export const auth = new Hono<AuthEnv>()

auth.use('*', async (c, next) => {
  c.header('Cache-Control', 'no-store')
  await next()
})

auth.post('/login', async (c) => {
  let body: unknown
  try { body = await c.req.json() } catch { body = undefined }
  const input = loginInput.safeParse(body)
  if (!input.success) {
    return c.json({ error: { code: 'INVALID_INPUT', message: 'Invalid login request.' } }, 400)
  }
  const result = await createAuthService(createRepositories(c.env.DB))
    .login(input.data.username, input.data.password, c.env.AUTH_PEPPER)
  if (!result) {
    return c.json({ error: { code: 'INVALID_CREDENTIALS', message: '登入資訊不正確。' } }, 401)
  }
  writeSessionCookie(c, result.token, result.expiresAt)
  return c.json({ user: result.user })
})

auth.get('/me', requireAuth, (c) => c.json({ user: c.get('user') }))

auth.post('/logout', async (c) => {
  // Clear first so even the safe 500 boundary on an internal failure clears it.
  writeSessionCookie(c, null)
  const token = readSessionToken(c.req.header('Cookie'))
  if (token) await createAuthService(createRepositories(c.env.DB)).logout(token)
  return c.body(null, 204)
})
