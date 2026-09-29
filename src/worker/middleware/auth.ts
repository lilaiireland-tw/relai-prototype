import { createMiddleware } from 'hono/factory'
import { readSessionToken } from '../auth/session'
import type { AuthEnv } from '../auth/types'
import { createRepositories } from '../persistence'
import { createAuthService } from '../services/auth'

export const requireAuth = createMiddleware<AuthEnv>(async (c, next) => {
  const token = readSessionToken(c.req.header('Cookie'))
  const user = token ? await createAuthService(createRepositories(c.env.DB)).resolveSession(token) : null
  if (!user) return c.json({ error: { code: 'UNAUTHORIZED', message: 'Authentication required.' } }, 401)
  c.set('user', user)
  await next()
})

/** Apply after requireAuth to product APIs that require completed onboarding. */
export const requirePasswordChanged = createMiddleware<AuthEnv>(async (c, next) => {
  const user = c.get('user')
  if (!user) return c.json({ error: { code: 'UNAUTHORIZED', message: 'Authentication required.' } }, 401)
  if (user.must_change_password) {
    return c.json({ error: { code: 'PASSWORD_CHANGE_REQUIRED', message: 'Password change required.' } }, 403)
  }
  await next()
})
