import { Hono } from 'hono'
import { z } from 'zod'
import type { AuthEnv } from '../auth/types'
import { requireAuth, requirePasswordChanged } from '../middleware/auth'
import { createRepositories } from '../persistence'
import { listVocabularyReviewCandidates, reviewVocabularyCandidate, saveVocabulary, type VocabularySaveResult } from '../persistence/vocabulary'
import { vocabularySuggestionSchema } from '../services/vocabulary-image'
import { normalizeHeadword, normalizeSense, prepareVocabulary } from '../services/vocabulary-catalog'
import { abandonImageJob, currentImageJob, acceptImageJob, imageJobStatus, imageQuota, recoverFailedImageJob } from '../services/image-vocabulary-jobs'

const MAX_IMAGE_BYTES = 5 * 1024 * 1024
const MAX_MULTIPART_BYTES = MAX_IMAGE_BYTES + 64 * 1024
const selectionSchema = z.strictObject({
  headword: z.string().trim().min(1).max(100),
  part_of_speech: z.string().trim().min(1).max(40),
  semantic_sense: z.string().trim().min(1).max(160),
  source_context: z.string().trim().min(1).max(500),
  resolve_sense: z.boolean().optional(),
})
const extractionSchema = z.strictObject({ version: z.literal(1), suggestions: z.array(vocabularySuggestionSchema).max(10) })
const saveInput = z.strictObject({
  source_item_id: z.string().uuid(),
  items: z.array(selectionSchema).min(1).max(10),
})
const candidateReviewInput = z.discriminatedUnion('action', [
  z.strictObject({ action: z.literal('reject') }),
  z.strictObject({
    action: z.literal('publish'),
    semantic_sense: z.string().trim().min(1).max(160).optional(),
    zh_tw_definition: z.string().trim().min(1).max(500).optional(),
    english_example: z.string().trim().min(1).max(1000).optional(),
    zh_tw_example_translation: z.string().trim().min(1).max(1000).optional(),
  }),
])

async function readImage(request: Request): Promise<
  { bytes: Uint8Array; mimeType: string } | { status: 400 | 413 | 415 }
> {
  const declaredLength = Number(request.headers.get('content-length'))
  if (Number.isFinite(declaredLength) && declaredLength > MAX_MULTIPART_BYTES) return { status: 413 }
  if (!request.body) return { status: 400 }
  const reader = request.body.getReader()
  const chunks: Uint8Array[] = []
  let length = 0
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      length += value.length
      if (length > MAX_MULTIPART_BYTES) {
        await reader.cancel()
        return { status: 413 }
      }
      chunks.push(value)
    }
  } catch {
    return { status: 400 }
  }
  const body = new Uint8Array(length)
  let offset = 0
  for (const chunk of chunks) { body.set(chunk, offset); offset += chunk.length }
  let form: FormData
  try {
    form = await new Request(request.url, { method: 'POST', headers: request.headers, body }).formData()
  } catch {
    return { status: 400 }
  }
  const values = form.getAll('image')
  if ([...form.keys()].length !== 1 || values.length !== 1 || !(values[0] instanceof File)) return { status: 400 }
  const file = values[0]
  if (file.size === 0 || file.size > MAX_IMAGE_BYTES) return { status: file.size > MAX_IMAGE_BYTES ? 413 : 400 }
  const mimeType = file.type.toLowerCase()
  const bytes = new Uint8Array(await file.arrayBuffer())
  const valid = mimeType === 'image/jpeg' && bytes.length >= 4 && bytes[0] === 0xff && bytes[1] === 0xd8 &&
      bytes[2] === 0xff && bytes.at(-2) === 0xff && bytes.at(-1) === 0xd9
    || mimeType === 'image/png' && bytes.length >= 33 &&
      [137, 80, 78, 71, 13, 10, 26, 10].every((byte, index) => bytes[index] === byte) &&
      new TextDecoder().decode(bytes.subarray(12, 16)) === 'IHDR' &&
      new TextDecoder().decode(bytes.subarray(-8, -4)) === 'IEND'
    || mimeType === 'image/webp' && bytes.length >= 12 && new TextDecoder().decode(bytes.subarray(0, 4)) === 'RIFF' &&
      new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(4, true) + 8 === bytes.length &&
      new TextDecoder().decode(bytes.subarray(8, 12)) === 'WEBP'
  if (!valid) return { status: 415 }
  return { bytes, mimeType }
}

export const vocabulary = new Hono<AuthEnv>()
vocabulary.use('*', requireAuth, requirePasswordChanged)
vocabulary.use('*', async (c, next) => { c.header('Cache-Control', 'no-store'); await next() })

vocabulary.get('/image-jobs/quota', async c => c.json(await imageQuota(c.env.DB, c.get('user').id)))

vocabulary.get('/image-jobs/latest', async c => {
  const userId = c.get('user').id
  await currentImageJob(c.env, userId)
  const job = await c.env.DB.prepare(`SELECT job_id, user_id, status, stage, error_code, recognized_json, results_json
    FROM image_vocabulary_jobs WHERE user_id = ? ORDER BY created_at DESC LIMIT 1`)
    .bind(userId).first<Parameters<typeof imageJobStatus>[1]>()
  if (!job) return c.json({ error: { code: 'IMAGE_JOB_NOT_FOUND', message: 'No previous image job.' } }, 404)
  return c.json(await imageJobStatus(c.env.DB, job))
})

vocabulary.get('/image-jobs/current', async c => {
  const job = await currentImageJob(c.env, c.get('user').id)
  if (!job) return c.json({ error: { code: 'IMAGE_JOB_NOT_FOUND', message: 'No active image job.' } }, 404)
  return c.json(await imageJobStatus(c.env.DB, job))
})

vocabulary.post('/image-jobs/:id/abandon', async c => {
  await abandonImageJob(c.env, c.get('user').id, c.req.param('id'))
  return c.json({ status: 'abandoned' })
})

vocabulary.post('/image-jobs', async c => {
  const image = await readImage(c.req.raw)
  if ('status' in image) {
    const message = image.status === 413 ? 'Image is too large.' : image.status === 415 ? 'Upload a valid JPG, PNG, or WebP image.' : 'Upload one image file.'
    return c.json({ error: { code: image.status === 413 ? 'IMAGE_TOO_LARGE' : 'INVALID_IMAGE', message } }, image.status)
  }
  const key = z.string().uuid().safeParse(c.req.header('Idempotency-Key'))
  if (!key.success) return c.json({ error: { code: 'INVALID_IDEMPOTENCY_KEY', message: 'Provide a valid image request key.' } }, 400)
  const now = new Date()
  try {
    const accepted = await acceptImageJob(c.env, c.get('user').id, key.data, image.bytes, image.mimeType, now)
    return c.json({ job_id: accepted.job.job_id, status: accepted.job.status, quota: accepted.quota }, 202)
  } catch (error) {
    if (String(error).includes('IMAGE_JOB_ACTIVE')) {
      const job = await currentImageJob(c.env, c.get('user').id)
      return c.json({ error: { code: 'IMAGE_JOB_ACTIVE', message: 'Finish or abandon the current image job.', job_id: job?.job_id } }, 409)
    }
    if (String(error).includes('IDEMPOTENCY_CONFLICT')) {
      return c.json({ error: { code: 'IDEMPOTENCY_CONFLICT', message: 'This request key was already used for another image.' } }, 409)
    }
    if (String(error).includes('DAILY_IMAGE_LIMIT_REACHED')) {
      const quota = await imageQuota(c.env.DB, c.get('user').id, now)
      c.header('Retry-After', String(Math.max(1, Math.ceil((Date.parse(quota.resets_at) - now.getTime()) / 1000))))
      return c.json({ error: { code: 'DAILY_IMAGE_LIMIT_REACHED', ...quota } }, 429)
    }
    if (String(error).includes('IMAGE_JOBS_UNAVAILABLE')) {
      return c.json({ error: { code: 'IMAGE_JOBS_UNAVAILABLE', message: 'Image capture is temporarily unavailable.' } }, 503)
    }
    if (String(error).includes('GEMINI_UNAVAILABLE')) {
      return c.json({ error: { code: 'GEMINI_UNAVAILABLE', message: 'Image vocabulary extraction is unavailable.' } }, 503)
    }
    throw error
  }
})

vocabulary.get('/image-jobs/by-key/:key', async c => {
  await currentImageJob(c.env, c.get('user').id)
  const job = await c.env.DB.prepare(`SELECT job_id, user_id, status, stage, error_code, recognized_json, results_json
    FROM image_vocabulary_jobs WHERE user_id = ? AND idempotency_key = ?`)
    .bind(c.get('user').id, c.req.param('key')).first<Parameters<typeof imageJobStatus>[1]>()
  if (!job) return c.json({ error: { code: 'IMAGE_JOB_NOT_FOUND', message: 'Image job was not found.' } }, 404)
  return c.json(await imageJobStatus(c.env.DB, job))
})

vocabulary.get('/image-jobs/:id', async c => {
  await currentImageJob(c.env, c.get('user').id)
  const job = await c.env.DB.prepare(`SELECT job_id, user_id, status, stage, error_code, recognized_json, results_json
    FROM image_vocabulary_jobs WHERE user_id = ? AND job_id = ?`)
    .bind(c.get('user').id, c.req.param('id')).first<Parameters<typeof imageJobStatus>[1]>()
  if (!job) return c.json({ error: { code: 'IMAGE_JOB_NOT_FOUND', message: 'Image job was not found.' } }, 404)
  return c.json(await imageJobStatus(c.env.DB, job))
})

vocabulary.post('/image-jobs/:id/recover', async c => {
  if (c.get('user').role !== 'admin') {
    return c.json({ error: { code: 'FORBIDDEN', message: 'Administrator access required.' } }, 403)
  }
  const recovered = await recoverFailedImageJob(c.env, c.req.param('id'))
  return recovered
    ? c.json({ status: 'queued' }, 202)
    : c.json({ error: { code: 'IMAGE_JOB_NOT_RECOVERABLE', message: 'This job is not safe to retry automatically.' } }, 409)
})

vocabulary.post('/image', c => c.json({ error: { code: 'ASYNC_IMAGE_JOBS_REQUIRED', message: 'Submit images through /vocabulary/image-jobs.' } }, 410))

vocabulary.post('/save', async c => {
  let body: unknown
  try { body = await c.req.json() } catch { body = undefined }
  const input = saveInput.safeParse(body)
  if (!input.success) return c.json({ error: { code: 'INVALID_INPUT', message: 'Select up to 10 valid vocabulary suggestions.' } }, 400)
  const userId = c.get('user').id
  const source = await c.env.DB.prepare(`SELECT id, raw_text, ai_model FROM source_items
    WHERE id = ? AND user_id = ? AND source_type = 'image' AND processing_status = 'processed'`)
    .bind(input.data.source_item_id, userId).first<{ id: string; raw_text: string | null; ai_model: string | null }>()
  if (!source) return c.json({ error: { code: 'SOURCE_NOT_FOUND', message: 'Image extraction was not found.' } }, 404)
  const job = await c.env.DB.prepare(`SELECT status, results_json, provider_state FROM image_vocabulary_jobs WHERE job_id = ? AND user_id = ?`)
    .bind(source.id, userId).first<{ status: string; results_json: string | null; provider_state: string }>()
  if (!job || job.status !== 'completed' || job.provider_state === 'started' || job.provider_state === 'unknown' || !job.results_json) {
    return c.json({ error: { code: 'IMAGE_JOB_ALREADY_PROCESSED', message: 'Only completed jobs with persisted results can be saved.' } }, 409)
  }
  let persisted: { results: VocabularySaveResult[]; card_ids: string[] }
  try { persisted = JSON.parse(job.results_json) as typeof persisted } catch {
    return c.json({ error: { code: 'IMAGE_JOB_RESULT_UNAVAILABLE', message: 'Persisted image results are unavailable.' } }, 409)
  }
  if (input.data.items.every(item => !item.resolve_sense)) {
    const cards = await Promise.all(persisted.card_ids.map(id => createRepositories(c.env.DB).flashcards.find(userId, id)))
    return c.json({ results: persisted.results, cards: cards.filter(card => card !== null) })
  }
  if (input.data.items.some(item => !item.resolve_sense)) {
    return c.json({ error: { code: 'INVALID_INPUT', message: 'Resolve one persisted ambiguous sense at a time.' } }, 400)
  }
  let extraction: z.infer<typeof extractionSchema>
  try {
    extraction = extractionSchema.parse(JSON.parse(source.raw_text ?? ''))
  } catch {
    return c.json({ error: { code: 'EXTRACTION_NOT_FOUND', message: 'Recognized words are no longer available.' } }, 409)
  }
  for (const item of input.data.items) {
    const allowed = persisted.results.some(result => result.status === 'ambiguous' &&
      result.item.headword === item.headword && result.item.part_of_speech === item.part_of_speech &&
      result.item.source_context === item.source_context &&
      result.options.some(option => option.semantic_sense === item.semantic_sense))
    if (!allowed) return c.json({ error: { code: 'INVALID_INPUT', message: 'Select a published sense offered for this image job.' } }, 400)
  }
  const bySelection = new Map(extraction.suggestions.map(item => [JSON.stringify([
    item.headword, item.part_of_speech, item.semantic_sense, item.source_context,
  ]), item]))
  const byContext = new Map<string, z.infer<typeof vocabularySuggestionSchema>[]>()
  for (const item of extraction.suggestions) {
    const key = JSON.stringify([item.headword, item.part_of_speech, item.source_context])
    byContext.set(key, [...(byContext.get(key) ?? []), item])
  }
  const items = await Promise.all(input.data.items.map(async item => {
    const exact = bySelection.get(JSON.stringify([
      item.headword, item.part_of_speech, item.semantic_sense, item.source_context,
    ]))
    if (!item.resolve_sense) return exact
    const matches = byContext.get(JSON.stringify([item.headword, item.part_of_speech, item.source_context]))
    if (matches?.length !== 1) return undefined
    const canonical = await c.env.DB.prepare(`SELECT id FROM vocabulary_catalog WHERE normalized_key = ?
      AND part_of_speech_key = ? AND sense_key = ? AND publication_status = 'published'`)
      .bind(normalizeHeadword(item.headword), item.part_of_speech, normalizeSense(item.semantic_sense))
      .first<{ id: string }>()
    return canonical ? { ...(exact ?? matches[0]), semantic_sense: item.semantic_sense, confidence: 1 } : undefined
  }))
  if (items.some(item => !item)) {
    return c.json({ error: { code: 'INVALID_INPUT', message: 'Select words from this image extraction.' } }, 400)
  }
  let plans: Awaited<ReturnType<typeof prepareVocabulary>>
  try {
    plans = await prepareVocabulary(c.env.DB, items as z.infer<typeof vocabularySuggestionSchema>[],
      c.env, source.ai_model ?? 'unknown', async () => { throw new Error('DURABLE_CHECKPOINT_REQUIRED') })
  } catch (error) {
    if (String(error).includes('DURABLE_CHECKPOINT_REQUIRED')) {
      return c.json({ error: { code: 'IMAGE_JOB_CHECKPOINT_REQUIRED', message: 'This sense needs a durable image-job checkpoint.' } }, 409)
    }
    throw error
  }
  const results = await saveVocabulary(c.env.DB, userId, source.id, plans, new Date().toISOString())
  const flashcards = createRepositories(c.env.DB).flashcards
  const cards = await Promise.all(results.flatMap(result => 'card_id' in result
    ? [flashcards.find(userId, result.card_id)] : []))
  return c.json({ results, cards: cards.filter(card => card !== null) })
})

vocabulary.get('/review', async c => {
  if (c.get('user').role !== 'admin') {
    return c.json({ error: { code: 'FORBIDDEN', message: 'Administrator access required.' } }, 403)
  }
  return c.json({ candidates: await listVocabularyReviewCandidates(c.env.DB) })
})

vocabulary.post('/review/:id', async c => {
  if (c.get('user').role !== 'admin') {
    return c.json({ error: { code: 'FORBIDDEN', message: 'Administrator access required.' } }, 403)
  }
  let body: unknown
  try { body = await c.req.json() } catch { body = undefined }
  const input = candidateReviewInput.safeParse(body)
  if (!input.success) return c.json({ error: { code: 'INVALID_INPUT', message: 'Provide a valid candidate review decision.' } }, 400)
  const result = await reviewVocabularyCandidate(c.env.DB, c.req.param('id'), c.get('user').id,
    input.data, new Date().toISOString())
  if (result.status === 'not_found') return c.json({ error: { code: 'CANDIDATE_NOT_FOUND', message: 'Review candidate was not found.' } }, 404)
  if (result.status === 'incomplete') return c.json({ error: { code: 'INCOMPLETE_CANDIDATE', message: 'Add a definition, example and translation before publishing.' } }, 400)
  if (result.status === 'conflict') return c.json({ error: { code: 'CATALOG_CONFLICT', message: 'Published content conflicts with this candidate. It was left unchanged; reject the candidate if it is not appropriate.' } }, 409)
  return c.json({ status: result.status, ...(result.status === 'published' ? { catalog_id: result.catalog_id } : {}) })
})
