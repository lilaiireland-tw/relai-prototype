import { z } from 'zod'
import type { PersistenceDatabase } from '../persistence/d1'
import { requestVocabularyJson, VOCABULARY_PROMPT_VERSION, type VocabularySuggestion } from './vocabulary-image'

const MATCH_CONFIDENCE = 0.9
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
  provenance: string
  content_version: number
  zh_tw_definition: string | null
  english_example: string | null
  zh_tw_example_translation: string | null
}

export type VocabularyPlan = {
  kind: 'ready' | 'ambiguous' | 'invalid'
  item: VocabularySuggestion
  normalized_key: string
  part_of_speech_key: string
  sense_key: string
  target_catalog_id: string | null
  content: Partial<LexicalContent>
  reason: 'ambiguous_sense' | 'low_confidence' | 'invalid_content' | 'enrichment_unavailable' | 'catalog_changed' | 'catalog_conflict' | null
  model: string
  prompt_version: string
  provenance: string
  content_hash: string | null
  catalog?: CatalogRecord
  options?: { catalog_id: string; semantic_sense: string }[]
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

const matchItemSchema = z.strictObject({
    item_index: z.number().int().min(0).max(9),
    action: z.enum(['match', 'new', 'ambiguous']),
    candidate_index: z.number().int().min(0).max(49).nullable(),
    confidence: z.number().min(0).max(1),
})
const matchResponseSchema = z.strictObject({
  version: z.literal(1),
  matches: z.array(z.unknown()).max(10),
})
const generatedItemSchema = z.strictObject({
    item_index: z.number().int().min(0).max(9),
    zh_tw_definition: z.string().trim().min(1).max(500).optional(),
    english_example: z.string().trim().min(1).max(1000).optional(),
    zh_tw_example_translation: z.string().trim().min(1).max(1000).optional(),
})
const generatedResponseSchema = z.strictObject({
  version: z.literal(1),
  items: z.array(z.unknown()).max(10),
})

const selectionJsonSchema = {
  type: 'object', additionalProperties: false, properties: { version: { type: 'integer' }, matches: { type: 'array', maxItems: 10, items: {
    type: 'object', additionalProperties: false, properties: { item_index: { type: 'integer' }, action: { type: 'string', enum: ['match', 'new', 'ambiguous'] },
      candidate_index: { type: ['integer', 'null'] }, confidence: { type: 'number' } },
    required: ['item_index', 'action', 'candidate_index', 'confidence'],
  } } }, required: ['version', 'matches'],
}
const generatedJsonSchema = {
  type: 'object', additionalProperties: false, properties: { version: { type: 'integer' }, items: { type: 'array', maxItems: 10, items: {
    type: 'object', additionalProperties: false, properties: { item_index: { type: 'integer' }, zh_tw_definition: { type: 'string' },
      english_example: { type: 'string' }, zh_tw_example_translation: { type: 'string' } },
    required: ['item_index'],
  } } }, required: ['version', 'items'],
}
function complete(content: Partial<LexicalContent>): content is LexicalContent {
  return lexicalFields.every(field => typeof content[field] === 'string' && content[field]!.trim().length > 0)
}

function missing(content: Partial<LexicalContent>) {
  return lexicalFields.filter(field => !content[field]?.trim())
}

function provenance(item: VocabularySuggestion, model: string) {
  return JSON.stringify({ kind: 'gemini-image', recognition_confidence: item.confidence,
    model, prompt_version: VOCABULARY_PROMPT_VERSION, field_validation: 'passed' })
}

async function readCatalog(db: PersistenceDatabase, item: VocabularySuggestion): Promise<CatalogRecord[]> {
  const result = await db.prepare(`SELECT id, normalized_key, part_of_speech, part_of_speech_key, sense_key,
      semantic_sense, cefr_level, source_dataset, provenance, content_version, zh_tw_definition, english_example,
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

export async function prepareVocabulary(
  db: PersistenceDatabase, items: VocabularySuggestion[],
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
      plans[itemIndex] = { kind: 'ambiguous', item, normalized_key, part_of_speech_key, sense_key,
        target_catalog_id: null, content: {}, reason: 'low_confidence', model: recognitionModel,
        prompt_version: VOCABULARY_PROMPT_VERSION, provenance: '', content_hash: null,
        options: rows[itemIndex].map(record => ({ catalog_id: record.id, semantic_sense: record.semantic_sense })) }
    } else if (exact) {
      selected.set(itemIndex, exact)
    } else if (rows[itemIndex].length) {
      needsMatch.push({ itemIndex, item, candidates: rows[itemIndex] })
    }
  }

  if (needsMatch.length) {
    let response: Awaited<ReturnType<typeof requestVocabularyJson>> = null
    let parsed: z.infer<typeof matchResponseSchema> | null = null
    response = await requestVocabularyJson(semanticMatchPrompt(needsMatch), selectionJsonSchema, env)
    if (response) {
      const result = matchResponseSchema.safeParse(response.value)
      if (result.success) parsed = result.data
    }
    const decisions = new Map<number, z.infer<typeof matchItemSchema>>()
    const invalidIndexes = new Set<number>()
    for (const value of parsed?.matches ?? []) {
      const decision = matchItemSchema.safeParse(value)
      const itemIndex = typeof value === 'object' && value !== null && 'item_index' in value &&
        typeof value.item_index === 'number' ? value.item_index : null
      if (!decision.success) { if (itemIndex !== null) invalidIndexes.add(itemIndex); continue }
      if (decisions.has(decision.data.item_index)) invalidIndexes.add(decision.data.item_index)
      decisions.set(decision.data.item_index, decision.data)
    }
    for (const entry of needsMatch) {
      const decision = invalidIndexes.has(entry.itemIndex) ? undefined : decisions.get(entry.itemIndex)
      if (decision?.action === 'match' && decision.confidence >= MATCH_CONFIDENCE && decision.candidate_index !== null &&
        entry.candidates[decision.candidate_index]) {
        selected.set(entry.itemIndex, entry.candidates[decision.candidate_index])
      } else if (decision?.action === 'new' && decision.confidence >= MATCH_CONFIDENCE && decision.candidate_index === null) {
        // The catalog lookup completed before this item is treated as a new sense.
      } else {
        const item = entry.item
        const normalized_key = normalizeHeadword(item.headword)
        const part_of_speech_key = item.part_of_speech
        const sense_key = normalizeSense(item.semantic_sense)
        plans[entry.itemIndex] = { kind: 'ambiguous', item, normalized_key, part_of_speech_key, sense_key,
          target_catalog_id: null, content: {}, reason: 'ambiguous_sense', model: response?.model ?? recognitionModel,
          prompt_version: VOCABULARY_PROMPT_VERSION, provenance: '', content_hash: null,
          options: entry.candidates.map(candidate => ({ catalog_id: candidate.id, semantic_sense: candidate.semantic_sense })) }
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
        content: existing, reason: null,
        model: catalog.source_dataset, prompt_version: VOCABULARY_PROMPT_VERSION,
        provenance: catalog.source_dataset, content_hash: null, catalog }
    } else {
      generationInputs.push({ item_index: itemIndex, item, missing: missingFields.length ? missingFields : [...lexicalFields], existing, catalog })
    }
  }

  if (!generationInputs.length) return plans as VocabularyPlan[]
  let generated: Awaited<ReturnType<typeof requestVocabularyJson>> = null
  let parsedGenerated: z.infer<typeof generatedResponseSchema> | null = null
  generated = await requestVocabularyJson(generationPrompt(generationInputs), generatedJsonSchema, env)
  if (generated) {
    const result = generatedResponseSchema.safeParse(generated.value)
    if (result.success) parsedGenerated = result.data
  }
  const generatedByIndex = new Map<number, z.infer<typeof generatedItemSchema>>()
  const invalidIndexes = new Set<number>()
  for (const value of parsedGenerated?.items ?? []) {
    const output = generatedItemSchema.safeParse(value)
    const itemIndex = typeof value === 'object' && value !== null && 'item_index' in value &&
      typeof value.item_index === 'number' ? value.item_index : null
    if (!output.success) { if (itemIndex !== null) invalidIndexes.add(itemIndex); continue }
    if (generatedByIndex.has(output.data.item_index)) invalidIndexes.add(output.data.item_index)
    generatedByIndex.set(output.data.item_index, output.data)
  }

  for (const input of generationInputs) {
    const item = input.item
    const output = invalidIndexes.has(input.item_index) ? undefined : generatedByIndex.get(input.item_index)
    const supplied = output as Partial<Record<LexicalField, string>> | undefined
    const invalid = !output || Object.keys(output).some(key => key !== 'item_index' && !input.missing.includes(key as LexicalField)) ||
      input.missing.some(field => !supplied?.[field]?.trim())
    const content = { ...input.existing, ...supplied } as Partial<LexicalContent>
    if (invalid || !complete(content)) {
      plans[input.item_index] = { kind: 'invalid', item, normalized_key: normalizeHeadword(item.headword),
        part_of_speech_key: item.part_of_speech, sense_key: input.catalog?.sense_key ?? normalizeSense(item.semantic_sense),
        target_catalog_id: input.catalog?.id ?? null, content: {}, reason: generated ? 'invalid_content' : 'enrichment_unavailable',
        model: generated?.model ?? recognitionModel, prompt_version: VOCABULARY_PROMPT_VERSION,
        provenance: '', content_hash: null, catalog: input.catalog ?? undefined }
      continue
    }
    const finalContent = content as LexicalContent
    plans[input.item_index] = { kind: 'ready', item, normalized_key: normalizeHeadword(item.headword),
      part_of_speech_key: item.part_of_speech, sense_key: input.catalog?.sense_key ?? normalizeSense(item.semantic_sense),
      target_catalog_id: input.catalog?.id ?? null, content: finalContent, reason: null,
      model: generated!.model, prompt_version: VOCABULARY_PROMPT_VERSION,
      provenance: provenance(item, generated!.model), content_hash: await vocabularyContentHash(finalContent),
      catalog: input.catalog ?? undefined }
  }

  return plans as VocabularyPlan[]
}
