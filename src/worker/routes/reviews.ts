import { Hono } from 'hono'
import { z } from 'zod'
import type { AuthEnv } from '../auth/types'
import { requireAuth, requirePasswordChanged } from '../middleware/auth'
import { createRepositories } from '../persistence'
import { id, invalidInput, localDate, notFound, parseJson, previousDate } from './product-utils'

const reviewInput = z.strictObject({
  client_event_id: z.uuid(), card_id: id, review_result: z.literal('viewed'),
  reviewed_at: z.iso.datetime().optional(),
})
export const reviews = new Hono<AuthEnv>()
reviews.use('*', requireAuth, requirePasswordChanged)
reviews.use('*', async (c, next) => { c.header('Cache-Control', 'no-store'); await next() })

reviews.post('/', async (c) => {
  const input = reviewInput.safeParse(await parseJson(c.req.raw))
  if (!input.success) return c.json(invalidInput, 400)
  const userId = c.get('user').id
  const repos = createRepositories(c.env.DB)
  if (!await repos.flashcards.find(userId, input.data.card_id)) return c.json(notFound, 404)
  const at = new Date().toISOString()
  const settings = await repos.userSettings.getOrCreate(userId, 'UTC', at)
  const day = localDate(new Date(at), settings.timezone)
  const result = await repos.reviewEvents.complete(userId, input.data.card_id,
    input.data.client_event_id, at, day, previousDate(day))
  if (result === 'conflict') return c.json({ error: { code: 'EVENT_CONFLICT', message: 'Review event conflict.' } }, 409)
  return c.json({ completed: true, already_completed: result === 'duplicate' }, result === 'inserted' ? 201 : 200)
})
