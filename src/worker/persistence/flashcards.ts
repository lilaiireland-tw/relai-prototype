import { mutate, type PersistenceDatabase, type SqlValue } from './d1'
import type { CardType, EditableFlashcard, FlashcardRow, SqlBoolean } from './types'

const columns = `card.id, card.user_id, card.source_item_id, card.card_type,
  CASE WHEN card.card_type = 'error_log' THEN card.front_content
    ELSE COALESCE(catalog.headword, personal.headword) END AS front_content,
  CASE WHEN card.card_type = 'error_log' THEN card.back_content ELSE
    COALESCE(COALESCE(catalog.zh_tw_definition, personal.zh_tw_definition) || char(10), '') ||
    COALESCE(catalog.english_example, personal.english_example,
      'CEFR-J ' || catalog.cefr_level || COALESCE(' · ' || catalog.part_of_speech, ''), 'Vocabulary') ||
    COALESCE(char(10) || COALESCE(catalog.zh_tw_example_translation, personal.zh_tw_example_translation), '')
  END AS back_content,
  CASE WHEN card.card_type = 'error_log' THEN card.part_of_speech
    ELSE COALESCE(catalog.part_of_speech, personal.part_of_speech) END AS part_of_speech,
  CASE WHEN card.card_type = 'error_log' THEN card.zh_tw_definition
    ELSE COALESCE(catalog.zh_tw_definition, personal.zh_tw_definition) END AS zh_tw_definition,
  card.explanation,
  CASE WHEN card.card_type = 'error_log' THEN card.irish_usage
    ELSE COALESCE(catalog.irish_usage, personal.irish_usage) END AS irish_usage,
  CASE WHEN card.card_type = 'error_log' THEN card.source
    ELSE COALESCE(catalog.source_dataset || ' ' || catalog.source_version, personal.source) END AS source,
  card.is_favorite, card.last_reviewed_at, card.next_review_at, card.created_at, card.updated_at`
const joins = `FROM flashcards AS card
  LEFT JOIN vocabulary_catalog AS catalog ON catalog.id = card.vocabulary_catalog_id
  LEFT JOIN user_vocabulary_items AS personal ON personal.id = card.user_vocabulary_item_id
    AND personal.user_id = card.user_id`
type StoredCard = Omit<FlashcardRow, 'is_favorite'> & { is_favorite: SqlBoolean }
const mapCard = (row: StoredCard): FlashcardRow => ({ ...row, is_favorite: row.is_favorite === 1 })
const editable = ['front_content', 'back_content', 'part_of_speech',
  'zh_tw_definition', 'explanation', 'irish_usage', 'source'] as const

export interface CardCursor { created_at: string; id: string }
export interface CardListQuery {
  cardType?: CardType
  favorite?: boolean
  needsReviewBefore?: string
  limit?: number
  cursor?: CardCursor
}

export function createFlashcardsRepository(db: PersistenceDatabase) {
  const find = async (userId: string, id: string): Promise<FlashcardRow | null> => {
    const row = await db.prepare(`SELECT ${columns} ${joins} WHERE card.id = ? AND card.user_id = ?`)
      .bind(id, userId).first<StoredCard>()
    return row ? mapCard(row) : null
  }
  return {
    async count(userId: string): Promise<number> {
      const row = await db.prepare('SELECT COUNT(*) AS count FROM flashcards WHERE user_id = ?')
        .bind(userId).first<{ count: number }>()
      if (!row) throw new Error('Persistence card count failed.')
      return row.count
    },
    async list(userId: string, query: CardListQuery = {}): Promise<{ cards: FlashcardRow[]; nextCursor: CardCursor | null }> {
      const limit = Math.min(100, Math.max(1, Math.trunc(query.limit ?? 20)))
      if (!Number.isFinite(limit)) throw new Error('Invalid card limit.')
      const predicates = ['card.user_id = ?']
      const values: SqlValue[] = [userId]
      if (query.cardType !== undefined) { predicates.push('card.card_type = ?'); values.push(query.cardType) }
      if (query.favorite !== undefined) { predicates.push('card.is_favorite = ?'); values.push(query.favorite ? 1 : 0) }
      if (query.needsReviewBefore !== undefined) {
        predicates.push('(card.last_reviewed_at IS NULL OR card.last_reviewed_at < ?)')
        values.push(query.needsReviewBefore)
      }
      if (query.cursor !== undefined) {
        predicates.push('(card.created_at < ? OR (card.created_at = ? AND card.id < ?))')
        values.push(query.cursor.created_at, query.cursor.created_at, query.cursor.id)
      }
      const result = await db.prepare(`SELECT ${columns} ${joins} WHERE ${predicates.join(' AND ')}
        ORDER BY card.created_at DESC, card.id DESC LIMIT ?`).bind(...values, limit + 1).all<StoredCard>()
      if (!result.success) throw new Error('Persistence card listing failed.')
      const page = result.results.slice(0, limit).map(mapCard)
      const last = page.at(-1)
      return { cards: page, nextCursor: result.results.length > limit && last
        ? { created_at: last.created_at, id: last.id } : null }
    },
    find,
    async update(userId: string, id: string, patch: Partial<EditableFlashcard>, updatedAt: string): Promise<FlashcardRow | null> {
      const keys = editable.filter(key => patch[key] !== undefined)
      if (keys.length === 0) throw new Error('Empty card update.')
      const result = await db.prepare(`UPDATE flashcards SET ${keys.map(key => `${key} = ?`).join(', ')}, updated_at = ?
        WHERE id = ? AND user_id = ? AND card_type = 'error_log' RETURNING id`)
        .bind(...keys.map(key => patch[key] as SqlValue), updatedAt, id, userId).first<{ id: string }>()
      return result ? find(userId, id) : null
    },
    delete(userId: string, id: string) {
      return mutate(db.prepare('DELETE FROM flashcards WHERE id = ? AND user_id = ?').bind(id, userId))
    },
    async setFavorite(userId: string, id: string, favorite: boolean, updatedAt: string): Promise<FlashcardRow | null> {
      const result = await db.prepare(`UPDATE flashcards SET is_favorite = ?, updated_at = ?
        WHERE id = ? AND user_id = ? RETURNING id`).bind(favorite ? 1 : 0, updatedAt, id, userId).first<{ id: string }>()
      return result ? find(userId, id) : null
    },
    async toggleFavorite(userId: string, id: string, updatedAt: string): Promise<FlashcardRow | null> {
      const result = await db.prepare(`UPDATE flashcards SET is_favorite = 1 - is_favorite, updated_at = ?
        WHERE id = ? AND user_id = ? RETURNING id`).bind(updatedAt, id, userId).first<{ id: string }>()
      return result ? find(userId, id) : null
    },
    recordReview(userId: string, id: string, reviewedAt: string) {
      return mutate(db.prepare(`UPDATE flashcards SET last_reviewed_at = ?, updated_at = ?
        WHERE id = ? AND user_id = ?`).bind(reviewedAt, reviewedAt, id, userId))
    },
  }
}
