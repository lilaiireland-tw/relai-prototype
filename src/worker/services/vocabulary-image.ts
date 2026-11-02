import { z } from 'zod'

export const DEFAULT_GEMINI_MODEL = 'gemini-3.8-flash'
const imageModel = /^gemini-(?:(?:2\.5|[3-9](?:\.\d+)?)-(?:flash(?:-lite)?|pro|argon)(?:-(?:preview(?:-\d{2}-\d{4})?|latest))?|(flash|flash-lite|pro)-latest)$/

const suggestion = z.strictObject({
  headword: z.string().trim().min(1).max(100),
  part_of_speech: z.string().trim().min(1).max(40),
  zh_tw_definition: z.string().trim().min(1).max(500),
  english_example: z.string().trim().min(1).max(1000),
  zh_tw_example_translation: z.string().trim().min(1).max(1000),
})
const suggestionsSchema = z.strictObject({ suggestions: z.array(suggestion).max(10) })
export const vocabularySuggestionSchema = suggestion
export type VocabularySuggestion = z.infer<typeof suggestion>
export function isImageCapableGeminiModel(value: string) { return imageModel.test(value) }

const responseSchema = {
  type: 'object',
  properties: {
    suggestions: {
      type: 'array', maxItems: 10,
      items: {
        type: 'object',
        properties: {
          headword: { type: 'string' },
          part_of_speech: { type: 'string' },
          zh_tw_definition: { type: 'string' },
          english_example: { type: 'string' },
          zh_tw_example_translation: { type: 'string' },
        },
        required: ['headword', 'part_of_speech', 'zh_tw_definition', 'english_example', 'zh_tw_example_translation'],
      },
    },
  },
  required: ['suggestions'],
}

function base64(bytes: Uint8Array): string {
  let binary = ''
  for (let offset = 0; offset < bytes.length; offset += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000))
  }
  return btoa(binary)
}

export async function extractVocabularyFromImage(
  bytes: Uint8Array, mimeType: string, env: { GEMINI_API_KEY?: string; GEMINI_MODEL?: string },
) {
  const model = env.GEMINI_MODEL ?? DEFAULT_GEMINI_MODEL
  if (!env.GEMINI_API_KEY || !isImageCapableGeminiModel(model)) return null
  try {
    const response = await fetch('https://generativelanguage.googleapis.com/v1beta/interactions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': env.GEMINI_API_KEY },
      body: JSON.stringify({
        model,
        input: [
          { type: 'text', text: 'Find up to 10 useful English vocabulary words that are visibly present in this English-learning image. Use each word in its base form. Do not invent words. For each, provide its part of speech, a natural Traditional Chinese (Taiwan) definition, a short original English example sentence, and a natural Traditional Chinese translation of that sentence.' },
          { type: 'image', data: base64(bytes), mime_type: mimeType },
        ],
        response_format: { type: 'text', mime_type: 'application/json', schema: responseSchema },
      }),
      signal: AbortSignal.timeout(45_000),
    })
    if (!response.ok) return null
    const payload: unknown = await response.json()
    if (typeof payload !== 'object' || payload === null || !('status' in payload) || payload.status !== 'completed' ||
      !('steps' in payload) || !Array.isArray(payload.steps)) return null
    const text = payload.steps.flatMap(step => {
      if (typeof step !== 'object' || step === null || !('type' in step) || step.type !== 'model_output' ||
        !('content' in step) || !Array.isArray(step.content)) return []
      return step.content.flatMap((part: unknown) => typeof part === 'object' && part !== null && 'type' in part &&
        part.type === 'text' && 'text' in part && typeof part.text === 'string' ? [part.text] : [])
    }).join('')
    if (!text) return null
    const parsed = suggestionsSchema.safeParse(JSON.parse(text))
    return parsed.success ? { model, suggestions: parsed.data.suggestions } : null
  } catch {
    return null
  }
}
