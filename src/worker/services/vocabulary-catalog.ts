import { z } from 'zod'
import type { PersistenceDatabase } from '../persistence/d1'
import { isImageCapableGeminiModel, requestVocabularyJson, VOCABULARY_PROMPT_VERSION, type VocabularySuggestion } from './vocabulary-image'

const MATCH_CONFIDENCE = 0.9
const VALIDATION_CONFIDENCE = 0.95
export const lexicalFields = ['zh_tw_definition', 'english_example', 'zh_tw_example_translation'] as const
export type LexicalField = typeof lexicalFields[number]
export type LexicalContent = Record<LexicalField, string>

export interface CatalogRecord {
  id: string
  normalized_key: string
  part_of_speech: string | null
  part_of_speech_key: string
  sense_key: string
  semantic_sense: string
  cefr_level: string | null
  source_dataset: string
  content_version: number
  zh_tw_definition: string | null
  english_example: string | null
  zh_tw_example_translation: string | null
}

export type VocabularyPlan = {
  kind: 'ready' | 'review_needed'
  item: VocabularySuggestion
  normalized_key: string
  part_of_speech_key: string
  sense_key: string
  target_catalog_id: string | null
  content: Partial<LexicalContent>
  reason: 'ambiguous_sense' | 'low_confidence' | 'validation_failed' | 'catalog_conflict' | 'catalog_changed' | null
  validation_status: 'passed' | 'review_needed' | 'not_run'
  validation_confidence: number | null
  model: string
  prompt_version: string
  provenance: string
  content_hash: string | null
  catalog?: CatalogRecord
}

export class VocabularyAiError extends Error {
  constructor(readonly unavailable = false) { super('Vocabulary enrichment is temporarily unavailable.') }
}

async function askVocabulary(input: unknown, schema: Record<string, unknown>,
  env: { GEMINI_API_KEY?: string; GEMINI_MODEL?: string }) {
  const response = await requestVocabularyJson(input, schema, env)
  if (!response) throw new VocabularyAiError(!env.GEMINI_API_KEY || !isImageCapableGeminiModel(env.GEMINI_MODEL ?? 'gemini-3.8-flash'))
  return response
}

export function normalizeHeadword(value: string) {
  return value.normalize('NFKC').trim().replace(/\s+/g, ' ').toLowerCase()
}

export function normalizeSense(value: string) {
  return value.normalize('NFKC').trim().toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '-')
    .replace(/^-+|-+$/g, '')
}

export async function vocabularyContentHash(content: Partial<LexicalContent>) {
  const value = JSON.stringify(lexicalFields.map(field => content[field] ?? null))
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))
  return [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, '0')).join('')
}

const matchResponseSchema = z.strictObject({
  version: z.literal(1),
  matches: z.array(z.strictObject({
    item_index: z.number().int().min(0).max(9),
    action: z.enum(['match', 'new', 'ambiguous']),
    candidate_index: z.number().int().min(0).max(49).nullable(),
    confidence: z.number().min(0).max(1),
  })).max(10),
})
const generatedResponseSchema = z.strictObject({
  version: z.literal(1),
  items: z.array(z.strictObject({
    item_index: z.number().int().min(0).max(9),
    zh_tw_definition: z.string().trim().min(1).max(500).optional(),
    english_example: z.string().trim().min(1).max(1000).optional(),
    zh_tw_example_translation: z.string().trim().min(1).max(1000).optional(),
  })).max(10),
})
const validationResponseSchema = z.strictObject({
  version: z.literal(1),
  results: z.array(z.strictObject({
    item_index: z.number().int().min(0).max(9),
    valid: z.boolean(),
    confidence: z.number().min(0).max(1),
    reason: z.string().trim().max(240),
  })).max(10),
})

const selectionJsonSchema = {
  type: 'object', properties: { version: { type: 'integer' }, matches: { type: 'array', maxItems: 10, items: {
    type: 'object', properties: { item_index: { type: 'integer' }, action: { type: 'string', enum: ['match', 'new', 'ambiguous'] },
      candidate_index: { type: ['integer', 'null'] }, confidence: { type: 'number' } },
    required: ['item_index', 'action', 'candidate_index', 'confidence'],
  } } }, required: ['version', 'matches'],
}
const generatedJsonSchema = {
  type: 'object', properties: { version: { type: 'integer' }, items: { type: 'array', maxItems: 10, items: {
    type: 'object', properties: { item_index: { type: 'integer' }, zh_tw_definition: { type: 'string' },
      english_example: { type: 'string' }, zh_tw_example_translation: { type: 'string' } },
    required: ['item_index'],
  } } }, required: ['version', 'items'],
}
const validationJsonSchema = {
  type: 'object', properties: { version: { type: 'integer' }, results: { type: 'array', maxItems: 10, items: {
    type: 'object', properties: { item_index: { type: 'integer' }, valid: { type: 'boolean' },
      confidence: { type: 'number' }, reason: { type: 'string' } },
    required: ['item_index', 'valid', 'confidence', 'reason'],
  } } }, required: ['version', 'results'],
}

function complete(content: Partial<LexicalContent>): content is LexicalContent {
  return lexicalFields.every(field => typeof content[field] === 'string' && content[field]!.trim().length > 0)
}

function missing(content: Partial<LexicalContent>) {
  return lexicalFields.filter(field => !content[field]?.trim())
}

function provenance(item: VocabularySuggestion, model: string,
  validationStatus: VocabularyPlan['validation_status'], reason: string | null) {
  return JSON.stringify({ kind: 'gemini-image', recognition_confidence: item.confidence,
    model, prompt_version: VOCABULARY_PROMPT_VERSION, validation_status: validationStatus, reason })
}

async function readCatalog(db: PersistenceDatabase, item: VocabularySuggestion): Promise<CatalogRecord[]> {
  const result = await db.prepare(`SELECT id, normalized_key, part_of_speech, part_of_speech_key, sense_key,
      semantic_sense, cefr_level, source_dataset, content_version, zh_tw_definition, english_example,
      zh_tw_example_translation FROM vocabulary_catalog
    WHERE normalized_key = ? AND part_of_speech_key = ? AND publication_status = 'published'
    ORDER BY id LIMIT 50`)
    .bind(normalizeHeadword(item.headword), item.part_of_speech).all<CatalogRecord>()
  if (!result.success) throw new Error('Could not inspect vocabulary catalog.')
  return result.results
}

function semanticMatchPrompt(items: { itemIndex: number; item: VocabularySuggestion; candidates: CatalogRecord[] }[]) {
  const input = items.map(({ itemIndex, item, candidates }) => ({ item_index: itemIndex,
    headword: item.headword, part_of_speech: item.part_of_speech, source_context: item.source_context,
    detected_sense: item.semantic_sense, candidates: candidates.map((candidate, candidate_index) => ({
      candidate_index, semantic_sense: candidate.semantic_sense,
      definition: candidate.zh_tw_definition, example: candidate.english_example,
      translation: candidate.zh_tw_example_translation,
    })) }))
  return `For each recognized word, compare its source meaning with the supplied published senses. Choose match only when the source context clearly expresses that same sense. Choose new only when it is clearly a different sense. Choose ambiguous when evidence is insufficient or candidates conflict. Do not create IDs or keys. Return contract version 1 and exactly one decision per item. Confidence must reflect semantic evidence, not spelling alone.\n${JSON.stringify(input)}`
}

function generationPrompt(items: { item_index: number; item: VocabularySuggestion; missing: LexicalField[];
  existing: Partial<LexicalContent> }[]) {
  return `Generate only the listed missing lexical fields for each English vocabulary sense. Use Traditional Chinese (Taiwan). Write a new, generic example that demonstrates the supplied sense and a faithful translation; do not quote or reproduce the user's source context. Never change or return fields that are not missing. Return contract version 1 with exactly one item per input item.\n${JSON.stringify(items)}`
}

function validationPrompt(items: { item_index: number; item: VocabularySuggestion; content: LexicalContent }[]) {
  return `Independently check that each definition, example and Traditional Chinese translation accurately express the supplied English sense and source context. Mark valid only when all fields are coherent, the example demonstrates that sense, and the translation matches the example. Return one decision per item, confidence from 0 to 1, and a short reason. Return contract version 1.\n${JSON.stringify(items)}`
}

export async function prepareVocabulary(
  db: PersistenceDatabase, userId: string, sourceItemId: string, items: VocabularySuggestion[],
  env: { GEMINI_API_KEY?: string; GEMINI_MODEL?: string }, recognitionModel: string,
): Promise<VocabularyPlan[]> {
  const rows = await Promise.all(items.map(item => readCatalog(db, item)))
  const selected = new Map<number, CatalogRecord>()
  const needsMatch: { itemIndex: number; item: VocabularySuggestion; candidates: CatalogRecord[] }[] = []
  const plans: (VocabularyPlan | undefined)[] = Array(items.length)

  for (const [itemIndex, item] of items.entries()) {
    const normalized_key = normalizeHeadword(item.headword)
    const part_of_speech_key = item.part_of_speech
    const sense_key = normalizeSense(item.semantic_sense)
    const exact = rows[itemIndex].find(record => record.sense_key === sense_key)
    if (item.confidence < MATCH_CONFIDENCE) {
      const approved = await db.prepare(`SELECT catalog_id FROM vocabulary_catalog_candidates
        WHERE owner_user_id = ? AND source_item_id = ? AND normalized_key = ?
        AND part_of_speech_key = ? AND sense_key = ? AND status = 'published'`)
        .bind(userId, sourceItemId, normalized_key, part_of_speech_key, sense_key).first<{ catalog_id: string | null }>()
      const corrected = approved ? null : await db.prepare(`SELECT catalog_id FROM vocabulary_catalog_candidates
        WHERE owner_user_id = ? AND source_item_id = ? AND normalized_key = ?
          AND part_of_speech_key = ? AND source_context = ? AND status = 'published'
        ORDER BY id LIMIT 2`)
        .bind(userId, sourceItemId, normalized_key, part_of_speech_key, item.source_context).all<{ catalog_id: string | null }>()
      const approvedCatalogId = approved?.catalog_id ?? (corrected?.results.length === 1 ? corrected.results[0].catalog_id : null)
      const approvedCatalog = rows[itemIndex].find(record => record.id === approvedCatalogId)
      if (approvedCatalog) selected.set(itemIndex, approvedCatalog)
      else plans[itemIndex] = { kind: 'review_needed', item, normalized_key, part_of_speech_key, sense_key,
        target_catalog_id: null, content: {}, reason: 'low_confidence', validation_status: 'not_run',
        validation_confidence: null, model: recognitionModel, prompt_version: VOCABULARY_PROMPT_VERSION,
        provenance: provenance(item, recognitionModel, 'not_run', 'low_confidence'), content_hash: null }
    } else if (exact) {
      selected.set(itemIndex, exact)
    } else if (rows[itemIndex].length) {
      needsMatch.push({ itemIndex, item, candidates: rows[itemIndex] })
    }
  }

  if (needsMatch.length) {
    const response = await askVocabulary(semanticMatchPrompt(needsMatch), selectionJsonSchema, env)
    const parsed = matchResponseSchema.safeParse(response.value)
    if (!parsed.success) throw new VocabularyAiError()
    const decisions = new Map(parsed.data.matches.map(result => [result.item_index, result]))
    if (decisions.size !== needsMatch.length || needsMatch.some(({ itemIndex }) => !decisions.has(itemIndex))) {
      throw new VocabularyAiError()
    }
    for (const entry of needsMatch) {
      const decision = decisions.get(entry.itemIndex)!
      if (decision.action === 'match' && decision.confidence >= MATCH_CONFIDENCE && decision.candidate_index !== null &&
        entry.candidates[decision.candidate_index]) {
        selected.set(entry.itemIndex, entry.candidates[decision.candidate_index])
      } else if (decision.action === 'new' && decision.confidence >= MATCH_CONFIDENCE && decision.candidate_index === null) {
        // The catalog lookup completed before this item is treated as a new sense.
      } else {
        const item = entry.item
        const normalized_key = normalizeHeadword(item.headword)
        const part_of_speech_key = item.part_of_speech
        const sense_key = normalizeSense(item.semantic_sense)
        plans[entry.itemIndex] = { kind: 'review_needed', item, normalized_key, part_of_speech_key, sense_key,
          target_catalog_id: null, content: {}, reason: 'ambiguous_sense', validation_status: 'not_run',
          validation_confidence: decision.confidence, model: response.model, prompt_version: VOCABULARY_PROMPT_VERSION,
          provenance: provenance(item, response.model, 'not_run', 'ambiguous_sense'), content_hash: null }
      }
    }
  }

  const generationInputs: { item_index: number; item: VocabularySuggestion; missing: LexicalField[];
    existing: Partial<LexicalContent>; catalog: CatalogRecord | null }[] = []
  for (const [itemIndex, item] of items.entries()) {
    if (plans[itemIndex]) continue
    const catalog = selected.get(itemIndex) ?? null
    const existing: Partial<LexicalContent> = catalog ? {
      zh_tw_definition: catalog.zh_tw_definition ?? undefined,
      english_example: catalog.english_example ?? undefined,
      zh_tw_example_translation: catalog.zh_tw_example_translation ?? undefined,
    } : {}
    const missingFields = missing(existing)
    if (catalog && missingFields.length === 0) {
      plans[itemIndex] = { kind: 'ready', item, normalized_key: normalizeHeadword(item.headword),
        part_of_speech_key: item.part_of_speech, sense_key: catalog.sense_key, target_catalog_id: catalog.id,
        content: existing, reason: null, validation_status: 'passed', validation_confidence: 1,
        model: catalog.source_dataset, prompt_version: VOCABULARY_PROMPT_VERSION,
        provenance: catalog.source_dataset, content_hash: null, catalog }
    } else {
      generationInputs.push({ item_index: itemIndex, item, missing: missingFields.length ? missingFields : [...lexicalFields], existing, catalog })
    }
  }

  if (!generationInputs.length) return plans as VocabularyPlan[]
  const generated = await askVocabulary(generationPrompt(generationInputs), generatedJsonSchema, env)
  const parsedGenerated = generatedResponseSchema.safeParse(generated.value)
  if (!parsedGenerated.success) throw new VocabularyAiError()
  const generatedByIndex = new Map(parsedGenerated.data.items.map(item => [item.item_index, item]))
  if (generatedByIndex.size !== generationInputs.length || generationInputs.some(item => !generatedByIndex.has(item.item_index))) {
    throw new VocabularyAiError()
  }

  const validationInputs: { item_index: number; item: VocabularySuggestion; content: LexicalContent }[] = []
  const mergedByIndex = new Map<number, LexicalContent>()
  for (const input of generationInputs) {
    const output = generatedByIndex.get(input.item_index)!
    const supplied = output as Partial<Record<LexicalField, string>>
    if (Object.keys(output).some(key => key !== 'item_index' && !input.missing.includes(key as LexicalField)) ||
      input.missing.some(field => !supplied[field]?.trim())) throw new VocabularyAiError()
    const content = { ...input.existing, ...supplied } as LexicalContent
    if (!complete(content)) throw new VocabularyAiError()
    mergedByIndex.set(input.item_index, content)
    validationInputs.push({ item_index: input.item_index, item: input.item, content })
  }

  const validation = await askVocabulary(validationPrompt(validationInputs), validationJsonSchema, env)
  const parsedValidation = validationResponseSchema.safeParse(validation.value)
  if (!parsedValidation.success) throw new VocabularyAiError()
  const validationByIndex = new Map(parsedValidation.data.results.map(result => [result.item_index, result]))
  if (validationByIndex.size !== validationInputs.length || validationInputs.some(item => !validationByIndex.has(item.item_index))) {
    throw new VocabularyAiError()
  }

  for (const input of generationInputs) {
    const item = input.item
    const validationResult = validationByIndex.get(input.item_index)!
    const isValid = validationResult.valid && validationResult.confidence >= VALIDATION_CONFIDENCE
    const content = mergedByIndex.get(input.item_index)!
    const model = generated.model
    const hash = await vocabularyContentHash(content)
    plans[input.item_index] = { kind: isValid ? 'ready' : 'review_needed', item,
      normalized_key: normalizeHeadword(item.headword),
      part_of_speech_key: item.part_of_speech,
      sense_key: input.catalog?.sense_key ?? normalizeSense(item.semantic_sense),
      target_catalog_id: input.catalog?.id ?? null,
      content, reason: isValid ? null : 'validation_failed',
      validation_status: isValid ? 'passed' : 'review_needed', validation_confidence: validationResult.confidence,
      model, prompt_version: VOCABULARY_PROMPT_VERSION,
      provenance: provenance(item, model, isValid ? 'passed' : 'review_needed',
        isValid ? null : validationResult.reason), content_hash: hash, catalog: input.catalog ?? undefined }
  }

  return plans as VocabularyPlan[]
}
