import { Hono } from 'hono'
import { z } from 'zod'
import type { AuthEnv } from '../auth/types'
import { requireAuth, requirePasswordChanged } from '../middleware/auth'
import { bootstrapStarterPack, ENGLISH_LEVELS } from '../persistence/starter-pack'

const levelInput = z.strictObject({ english_level: z.enum(ENGLISH_LEVELS) })
export const onboarding = new Hono<AuthEnv>()

onboarding.use('*', async (c, next) => {
  c.header('Cache-Control', 'no-store')
  await next()
})

onboarding.post('/level', requireAuth, requirePasswordChanged, async (c) => {
  let body: unknown
  try { body = await c.req.json() } catch { body = undefined }
  const input = levelInput.safeParse(body)
  if (!input.success) {
    return c.json({ error: { code: 'INVALID_INPUT', message: 'Choose A1, A2, B1, or B2.' } }, 400)
  }
  const result = await bootstrapStarterPack(c.env.DB, c.get('user').id,
    input.data.english_level, new Date().toISOString())
  if (result.kind === 'catalog_unavailable') {
    return c.json({ error: { code: 'CATALOG_UNAVAILABLE', message: 'Starter vocabulary is unavailable.' } }, 503)
  }
  if (result.kind === 'different_level') {
    return c.json({ error: { code: 'LEVEL_ALREADY_SELECTED', message: 'An initial level was already selected.' },
      english_level: result.english_level }, 409)
  }
  return c.json({ english_level: result.english_level,
    starter_cards_created: result.starter_cards_created, already_selected: result.kind === 'repeat' })
})
