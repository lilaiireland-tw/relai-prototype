import { z } from 'zod'
import { ENGLISH_LEVELS } from '../services/types'

const nullableText = z.string().nullable()
export const cardSchema = z.object({
 id: z.string(), user_id: z.string(), source_item_id: nullableText,
 card_type: z.enum(['vocabulary', 'error_log']), front_content: z.string(), back_content: z.string(),
 part_of_speech: nullableText, zh_tw_definition: nullableText, english_example: nullableText.optional(),
 zh_tw_example_translation: nullableText.optional(), explanation: nullableText,
 irish_usage: nullableText, source: nullableText, is_favorite: z.boolean(),
 last_reviewed_at: nullableText, next_review_at: nullableText, created_at: z.string(), updated_at: z.string(),
})
export const cardResponse = z.object({ card: cardSchema })
export const cardsResponse = z.object({ cards: z.array(cardSchema), next_cursor: nullableText })
export const settingsResponse = z.object({ settings: z.object({
 daily_goal: z.number().int().min(1).max(100), timezone: z.string(),
 english_level: z.enum(ENGLISH_LEVELS).nullable(),
}) })
export const statsResponse = z.object({
 streak_days: z.number(), longest_streak: z.number(), total_cards: z.number(),
 total_cards_created: z.number(), total_reviews: z.number(), today_completed_reviews: z.number(),
 daily_goal: z.number(), today_progress: z.number(), daily_goal_completed: z.boolean(),
})
export const starterResponse = z.object({ english_level: z.enum(ENGLISH_LEVELS),
 starter_cards_created: z.number(), already_selected: z.boolean() })
export const reviewResponse = z.object({ completed: z.literal(true), already_completed: z.boolean() })
const vocabularySuggestionSchema = z.strictObject({
 headword: z.string().min(1), part_of_speech: z.string().min(1), semantic_sense: z.string().min(1),
 source_context: z.string().min(1), confidence: z.number().min(0).max(1),
})
export const vocabularyImageResponse = z.strictObject({
 contract_version: z.literal(1), source_item_id: z.string().uuid(), suggestions: z.array(vocabularySuggestionSchema).max(10),
})
const vocabularyReviewReason = z.enum(['ambiguous_sense', 'low_confidence', 'validation_failed', 'catalog_conflict', 'catalog_changed'])
export const vocabularySaveResponse = z.strictObject({ results: z.array(z.discriminatedUnion('status', [
 z.strictObject({ headword: z.string(), status: z.literal('saved') }),
 z.strictObject({ headword: z.string(), status: z.literal('already_saved') }),
 z.strictObject({ headword: z.string(), status: z.literal('review_needed'), candidate_id: z.string().min(1), reason: vocabularyReviewReason }),
])) })
