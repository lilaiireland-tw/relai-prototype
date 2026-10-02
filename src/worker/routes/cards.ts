import { Hono } from 'hono'
import { z } from 'zod'
import type { AuthEnv } from '../auth/types'
import { requireAuth, requirePasswordChanged } from '../middleware/auth'
import { createRepositories } from '../persistence'
import { content, id, invalidInput, notFound, optionalContent, parseJson } from './product-utils'

const listInput = z.strictObject({
  card_type: z.enum(['vocabulary', 'error_log']).optional(),
  favorite: z.enum(['true', 'false']).optional(),
  needs_review: z.enum(['true', 'false']).optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
  cursor: z.string().max(1024).optional(),
})
const patchInput = z.strictObject({
  front_content: content.optional(), back_content: content.optional(),
  part_of_speech: optionalContent.optional(), zh_tw_definition: optionalContent.optional(),
  explanation: optionalContent.optional(), irish_usage: optionalContent.optional(),
}).refine(value => Object.keys(value).length > 0)
const favoriteInput = z.strictObject({ favorite: z.boolean() })
const cursorInput = z.strictObject({ created_at: z.iso.datetime(), id })

export const cards = new Hono<AuthEnv>()
cards.use('*', requireAuth, requirePasswordChanged)
cards.use('*', async (c, next) => { c.header('Cache-Control', 'no-store'); await next() })

cards.get('/', async (c) => {
  const query = listInput.safeParse(Object.fromEntries(new URL(c.req.url).searchParams))
  if (!query.success) return c.json(invalidInput, 400)
  let cursor: z.infer<typeof cursorInput> | undefined
  if (query.data.cursor) {
    try { cursor = cursorInput.parse(JSON.parse(atob(query.data.cursor))) } catch { return c.json(invalidInput, 400) }
  }
  const cutoff = new Date(Date.now() - 7 * 86400000).toISOString()
  const result = await createRepositories(c.env.DB).flashcards.list(c.get('user').id, {
    cardType: query.data.card_type, favorite: query.data.favorite === undefined ? undefined : query.data.favorite === 'true',
    needsReviewBefore: query.data.needs_review === 'true' ? cutoff : undefined,
    limit: query.data.limit, cursor,
  })
  return c.json({ cards: result.cards, next_cursor: result.nextCursor
    ? btoa(JSON.stringify(result.nextCursor)) : null })
})

cards.get('/:id', async (c) => {
  const card = await createRepositories(c.env.DB).flashcards.find(c.get('user').id, c.req.param('id'))
  return card ? c.json({ card }) : c.json(notFound, 404)
})

cards.patch('/:id', async (c) => {
  const input = patchInput.safeParse(await parseJson(c.req.raw))
  if (!input.success) return c.json(invalidInput, 400)
  const repos = createRepositories(c.env.DB)
  const current = await repos.flashcards.find(c.get('user').id, c.req.param('id'))
  if (!current) return c.json(notFound, 404)
  if ((current.card_type === 'vocabulary' && input.data.explanation !== undefined) ||
      (current.card_type === 'error_log' && (input.data.part_of_speech !== undefined ||
        input.data.zh_tw_definition !== undefined))) return c.json(invalidInput, 400)
  const card = await repos.flashcards.update(c.get('user').id, c.req.param('id'),
    input.data, new Date().toISOString())
  return card ? c.json({ card }) : c.json(notFound, 404)
})

cards.delete('/:id', async (c) => {
  const result = await createRepositories(c.env.DB).flashcards.delete(c.get('user').id, c.req.param('id'))
  return result.changes ? c.body(null, 204) : c.json(notFound, 404)
})

cards.post('/:id/favorite', async (c) => {
  const input = favoriteInput.safeParse(await parseJson(c.req.raw))
  if (!input.success) return c.json(invalidInput, 400)
  const card = await createRepositories(c.env.DB).flashcards.setFavorite(c.get('user').id,
    c.req.param('id'), input.data.favorite, new Date().toISOString())
  return card ? c.json({ card }) : c.json(notFound, 404)
})
