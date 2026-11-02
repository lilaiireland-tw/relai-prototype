import { Hono } from 'hono'
import { z } from 'zod'
import type { AuthEnv } from '../auth/types'
import { requireAuth, requirePasswordChanged } from '../middleware/auth'
import { saveVocabulary } from '../persistence/vocabulary'
import { extractVocabularyFromImage, isImageCapableGeminiModel, vocabularySuggestionSchema } from '../services/vocabulary-image'

const MAX_IMAGE_BYTES = 5 * 1024 * 1024
const MAX_MULTIPART_BYTES = MAX_IMAGE_BYTES + 64 * 1024
const saveInput = z.strictObject({
  source_item_id: z.string().uuid(),
  items: z.array(vocabularySuggestionSchema).min(1).max(10),
})

async function readImage(request: Request): Promise<
  { file: File; bytes: Uint8Array; mimeType: string } | { status: 400 | 413 | 415 }
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
  return { file, bytes, mimeType }
}

export const vocabulary = new Hono<AuthEnv>()
vocabulary.use('*', requireAuth, requirePasswordChanged)
vocabulary.use('*', async (c, next) => { c.header('Cache-Control', 'no-store'); await next() })

vocabulary.post('/image', async c => {
  const image = await readImage(c.req.raw)
  if ('status' in image) {
    const message = image.status === 413 ? 'Image is too large.' : image.status === 415 ? 'Upload a valid JPG, PNG, or WebP image.' : 'Upload one image file.'
    return c.json({ error: { code: image.status === 413 ? 'IMAGE_TOO_LARGE' : 'INVALID_IMAGE', message } }, image.status)
  }
  const model = c.env.GEMINI_MODEL ?? 'gemini-3.8-flash'
  if (!c.env.GEMINI_API_KEY || !isImageCapableGeminiModel(model)) {
    return c.json({ error: { code: 'GEMINI_UNAVAILABLE', message: 'Image vocabulary extraction is unavailable.' } }, 503)
  }
  const extracted = await extractVocabularyFromImage(image.bytes, image.mimeType, c.env)
  if (!extracted) {
    return c.json({ error: { code: 'EXTRACTION_FAILED', message: 'Image vocabulary could not be extracted.' } }, 502)
  }
  const sourceItemId = crypto.randomUUID()
  const inserted = await c.env.DB.prepare(`INSERT INTO source_items
    (id, user_id, source_type, raw_text, processing_status, ai_model, created_at, updated_at)
    VALUES (?, ?, 'image', NULL, 'processed', ?, ?, ?)`)
    .bind(sourceItemId, c.get('user').id, extracted.model, new Date().toISOString(), new Date().toISOString()).run()
  if (!inserted.success) throw new Error('Could not record image extraction metadata.')
  return c.json({ source_item_id: sourceItemId, suggestions: extracted.suggestions })
})

vocabulary.post('/save', async c => {
  let body: unknown
  try { body = await c.req.json() } catch { body = undefined }
  const input = saveInput.safeParse(body)
  if (!input.success) return c.json({ error: { code: 'INVALID_INPUT', message: 'Select up to 10 valid vocabulary suggestions.' } }, 400)
  const userId = c.get('user').id
  const source = await c.env.DB.prepare(`SELECT id FROM source_items
    WHERE id = ? AND user_id = ? AND source_type = 'image' AND processing_status = 'processed'`)
    .bind(input.data.source_item_id, userId).first<{ id: string }>()
  if (!source) return c.json({ error: { code: 'SOURCE_NOT_FOUND', message: 'Image extraction was not found.' } }, 404)
  const results = await saveVocabulary(c.env.DB, userId, source.id, input.data.items, new Date().toISOString())
  return c.json({ results })
})
