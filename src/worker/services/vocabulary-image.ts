import { z } from 'zod'

export const DEFAULT_GEMINI_MODEL = 'gemini-3.8-flash'
export const VOCABULARY_PROMPT_VERSION = 'b5.4-v1'
const imageModel = /^gemini-(?:(?:2\.5|[3-9](?:\.\d+)?)-(?:flash(?:-lite)?|pro|argon)(?:-(?:preview(?:-\d{2}-\d{4})?|latest))?|(flash|flash-lite|pro)-latest)$/
const partsOfSpeech = ['noun', 'verb', 'adjective', 'adverb', 'preposition', 'pronoun', 'conjunction', 'determiner', 'interjection', 'phrase'] as const

export const vocabularySuggestionSchema = z.strictObject({
  headword: z.string().trim().min(1).max(100),
  part_of_speech: z.enum(partsOfSpeech),
  semantic_sense: z.string().trim().min(1).max(160),
  source_context: z.string().trim().min(1).max(500),
  confidence: z.number().min(0).max(1),
})
const suggestionsSchema = z.strictObject({ version: z.literal(1), suggestions: z.array(vocabularySuggestionSchema).max(10) })
export type VocabularySuggestion = z.infer<typeof vocabularySuggestionSchema>
export type VocabularySelection = Pick<VocabularySuggestion,
  'headword' | 'part_of_speech' | 'semantic_sense' | 'source_context'> & { resolve_sense?: boolean }

export function isImageCapableGeminiModel(value: string) { return imageModel.test(value) }

function base64(bytes: Uint8Array): string {
  let binary = ''
  for (let offset = 0; offset < bytes.length; offset += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000))
  }
  return btoa(binary)
}

function outputText(payload: unknown): string | null {
  if (typeof payload !== 'object' || payload === null || !('status' in payload) || payload.status !== 'completed' ||
    !('steps' in payload) || !Array.isArray(payload.steps)) return null
  const text = payload.steps.flatMap(step => {
    if (typeof step !== 'object' || step === null || !('type' in step) || step.type !== 'model_output' ||
      !('content' in step) || !Array.isArray(step.content)) return []
    return step.content.flatMap((part: unknown) => typeof part === 'object' && part !== null && 'type' in part &&
      part.type === 'text' && 'text' in part && typeof part.text === 'string' ? [part.text] : [])
  }).join('')
  return text || null
}

export async function requestVocabularyJson(
  input: unknown, schema: Record<string, unknown>, env: { GEMINI_API_KEY?: string; GEMINI_MODEL?: string },
): Promise<{ model: string; value: unknown } | null> {
  const model = env.GEMINI_MODEL ?? DEFAULT_GEMINI_MODEL
  if (!env.GEMINI_API_KEY || !isImageCapableGeminiModel(model)) return null
  try {
    const response = await fetch('https://generativelanguage.googleapis.com/v1beta/interactions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': env.GEMINI_API_KEY },
      body: JSON.stringify({ model, input, response_format: { type: 'text', mime_type: 'application/json', schema } }),
      signal: AbortSignal.timeout(45_000),
    })
    if (!response.ok) return null
    const text = outputText(await response.json())
    if (!text) return null
    return { model, value: JSON.parse(text) as unknown }
  } catch {
    return null
  }
}

const recognitionJsonSchema = {
  type: 'object', additionalProperties: false,
  properties: {
    version: { type: 'integer' },
    suggestions: {
      type: 'array', maxItems: 10,
      items: { type: 'object', additionalProperties: false, properties: {
        headword: { type: 'string' }, part_of_speech: { type: 'string', enum: partsOfSpeech },
        semantic_sense: { type: 'string' }, source_context: { type: 'string' }, confidence: { type: 'number' },
      }, required: ['headword', 'part_of_speech', 'semantic_sense', 'source_context', 'confidence'] },
    },
  }, required: ['version', 'suggestions'],
}

export async function extractVocabularyFromImage(
  bytes: Uint8Array, mimeType: string, env: { GEMINI_API_KEY?: string; GEMINI_MODEL?: string },
) {
  const response = await requestVocabularyJson([
    { type: 'text', text: 'Identify up to 10 useful English headwords visibly present in this English-learning image. Return the base headword, one canonical part of speech, a concise English semantic sense, a short exact relevant source context from the image, and confidence from 0 to 1. Do not invent words. Do not generate definitions, examples, translations, IDs, keys, or approval states. Use JSON contract version 1.' },
    { type: 'image', data: base64(bytes), mime_type: mimeType },
  ], recognitionJsonSchema, env)
  if (!response) return null
  const parsed = suggestionsSchema.safeParse(response.value)
  if (!parsed.success) return null
  const seen = new Set<string>()
  const suggestions = parsed.data.suggestions.filter(item => {
    const key = JSON.stringify([item.headword.normalize('NFKC').trim().toLowerCase(), item.part_of_speech,
      item.semantic_sense.normalize('NFKC').trim().toLowerCase()])
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
  return { model: response.model, suggestions }
}
