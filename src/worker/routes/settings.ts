import { Hono } from 'hono'
import { z } from 'zod'
import type { AuthEnv } from '../auth/types'
import { requireAuth, requirePasswordChanged } from '../middleware/auth'
import { createRepositories } from '../persistence'
import { ENGLISH_LEVELS } from '../persistence/starter-pack'
import { invalidInput, parseJson } from './product-utils'

const timezone = z.string().min(1).max(100).refine(value => {
  try { new Intl.DateTimeFormat('en', { timeZone: value }); return true } catch { return false }
})
const patchInput = z.strictObject({
  daily_goal: z.number().int().min(1).max(100).optional(),
  timezone: timezone.optional(), english_level: z.enum(ENGLISH_LEVELS).optional(),
}).refine(value => Object.keys(value).length > 0)

export const settings = new Hono<AuthEnv>()
settings.use('*', requireAuth, requirePasswordChanged)
settings.use('*', async (c, next) => { c.header('Cache-Control', 'no-store'); await next() })

settings.get('/', async (c) => {
  const row = await createRepositories(c.env.DB).userSettings.getOrCreate(c.get('user').id,
    'UTC', new Date().toISOString())
  return c.json({ settings: row })
})

settings.patch('/', async (c) => {
  const input = patchInput.safeParse(await parseJson(c.req.raw))
  if (!input.success) return c.json(invalidInput, 400)
  const repos = createRepositories(c.env.DB)
  const userId = c.get('user').id
  const at = new Date().toISOString()
  const current = await repos.userSettings.getOrCreate(userId, 'UTC', at)
  if (input.data.english_level && current.english_level === null) {
    return c.json({ error: { code: 'INITIAL_LEVEL_REQUIRED', message: 'Choose an initial level during onboarding.' } }, 409)
  }
  const row = await repos.userSettings.update(userId, input.data, at)
  return c.json({ settings: row })
})
