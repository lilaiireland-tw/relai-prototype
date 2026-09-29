import { mutate, type PersistenceDatabase, type SqlValue } from './d1'
import type { CardType, EditableFlashcard, FlashcardRow, SqlBoolean } from './types'

const columns = `id, user_id, source_item_id, card_type, front_content, back_content,
  part_of_speech, zh_tw_definition, explanation, irish_usage, source, is_favorite,
  last_reviewed_at, next_review_at, created_at, updated_at`
type StoredCard = Omit<FlashcardRow, 'is_favorite'> & { is_favorite: SqlBoolean }
const mapCard = (row: StoredCard): FlashcardRow => ({ ...row, is_favorite: row.is_favorite === 1 })
const editable = ['card_type', 'front_content', 'back_content', 'part_of_speech',
  'zh_tw_definition', 'explanation', 'irish_usage', 'source'] as const

export interface CardCursor { created_at: string; id: string }
export interface CardListQuery {
  cardType?: CardType
  favorite?: boolean
  /** PRD v3.3: never reviewed or reviewed before this server-computed seven-day cutoff. */
  needsReviewBefore?: string
  limit?: number
  cursor?: CardCursor
}

export function createFlashcardsRepository(db: PersistenceDatabase) {
  return {
    async list(userId: string, query: CardListQuery = {}): Promise<{ cards: FlashcardRow[]; nextCursor: CardCursor | null }> {
      const limit = Math.min(100, Math.max(1, Math.trunc(query.limit ?? 20)))
      if (!Number.isFinite(limit)) throw new Error('Invalid card limit.')
      const predicates = ['user_id = ?']
      const values: SqlValue[] = [userId]
      if (query.cardType !== undefined) { predicates.push('card_type = ?'); values.push(query.cardType) }
      if (query.favorite !== undefined) { predicates.push('is_favorite = ?'); values.push(query.favorite ? 1 : 0) }
      if (query.needsReviewBefore !== undefined) {
        predicates.push('(last_reviewed_at IS NULL OR last_reviewed_at < ?)')
        values.push(query.needsReviewBefore)
      }
      if (query.cursor !== undefined) {
        predicates.push('(created_at < ? OR (created_at = ? AND id < ?))')
        values.push(query.cursor.created_at, query.cursor.created_at, query.cursor.id)
      }
      const result = await db.prepare(`SELECT ${columns} FROM flashcards WHERE ${predicates.join(' AND ')}
        ORDER BY created_at DESC, id DESC LIMIT ?`).bind(...values, limit + 1).all<StoredCard>()
      if (!result.success) throw new Error('Persistence card listing failed.')
      const page = result.results.slice(0, limit).map(mapCard)
      const last = page.at(-1)
      return { cards: page, nextCursor: result.results.length > limit && last
        ? { created_at: last.created_at, id: last.id } : null }
    },
    async find(userId: string, id: string): Promise<FlashcardRow | null> {
      const row = await db.prepare(`SELECT ${columns} FROM flashcards WHERE id = ? AND user_id = ?`)
        .bind(id, userId).first<StoredCard>()
      return row ? mapCard(row) : null
    },
    async update(userId: string, id: string, patch: Partial<EditableFlashcard>, updatedAt: string): Promise<FlashcardRow | null> {
      const keys = editable.filter(key => patch[key] !== undefined)
      if (keys.length === 0) throw new Error('Empty card update.')
      const values = keys.map(key => patch[key] as SqlValue)
      const row = await db.prepare(`UPDATE flashcards SET ${keys.map(key => `${key} = ?`).join(', ')}, updated_at = ?
        WHERE id = ? AND user_id = ? RETURNING ${columns}`)
        .bind(...values, updatedAt, id, userId).first<StoredCard>()
      return row ? mapCard(row) : null
    },
    delete(userId: string, id: string) {
      return mutate(db.prepare('DELETE FROM flashcards WHERE id = ? AND user_id = ?').bind(id, userId))
    },
    async setFavorite(userId: string, id: string, favorite: boolean, updatedAt: string): Promise<FlashcardRow | null> {
      const row = await db.prepare(`UPDATE flashcards SET is_favorite = ?, updated_at = ?
        WHERE id = ? AND user_id = ? RETURNING ${columns}`)
        .bind(favorite ? 1 : 0, updatedAt, id, userId).first<StoredCard>()
      return row ? mapCard(row) : null
    },
    async toggleFavorite(userId: string, id: string, updatedAt: string): Promise<FlashcardRow | null> {
      const row = await db.prepare(`UPDATE flashcards SET is_favorite = 1 - is_favorite, updated_at = ?
        WHERE id = ? AND user_id = ? RETURNING ${columns}`)
        .bind(updatedAt, id, userId).first<StoredCard>()
      return row ? mapCard(row) : null
    },
    recordReview(userId: string, id: string, reviewedAt: string) {
      return mutate(db.prepare(`UPDATE flashcards SET last_reviewed_at = ?, updated_at = ?
        WHERE id = ? AND user_id = ?`).bind(reviewedAt, reviewedAt, id, userId))
    },
  }
}
