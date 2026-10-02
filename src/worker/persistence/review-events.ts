import type { PersistenceDatabase } from './d1'
import type { CreateReviewEventInput, ReviewEventRow } from './types'

const columns = 'id, client_event_id, user_id, card_id, review_result, reviewed_at, created_at'
export type ReviewInsertResult = { kind: 'inserted'; event: ReviewEventRow } |
  { kind: 'duplicate'; event: ReviewEventRow }

export function createReviewEventsRepository(db: PersistenceDatabase) {
  const findByClientEventId = (userId: string, clientEventId: string): Promise<ReviewEventRow | null> =>
    db.prepare(`SELECT ${columns} FROM review_events WHERE client_event_id = ? AND user_id = ?`)
      .bind(clientEventId, userId).first<ReviewEventRow>()
  return {
    findByClientEventId,
    async timestampsInRange(userId: string, startInclusive: string, endExclusive: string): Promise<string[]> {
      const result = await db.prepare(`SELECT reviewed_at FROM review_events
        WHERE user_id = ? AND reviewed_at >= ? AND reviewed_at < ?`)
        .bind(userId, startInclusive, endExclusive).all<{ reviewed_at: string }>()
      if (!result.success) throw new Error('Persistence review lookup failed.')
      return result.results.map(row => row.reviewed_at)
    },
    async complete(userId: string, cardId: string, clientEventId: string, at: string,
      localDay: string, priorDay: string): Promise<'inserted' | 'duplicate' | 'conflict'> {
      if (!db.batch) throw new Error('D1 batch is required for review completion.')
      const eventId = crypto.randomUUID()
      const statements = [
        db.prepare(`INSERT INTO review_events (${columns})
          SELECT ?, ?, ?, id, 'viewed', ?, ? FROM flashcards WHERE id = ? AND user_id = ?
          ON CONFLICT(client_event_id) DO NOTHING`)
          .bind(eventId, clientEventId, userId, at, at, cardId, userId),
        db.prepare(`UPDATE flashcards SET last_reviewed_at = ?, updated_at = ?
          WHERE id = ? AND user_id = ? AND changes() = 1`).bind(at, at, cardId, userId),
        db.prepare(`INSERT INTO user_stats (user_id, streak_days, longest_streak,
          total_reviews, last_active_date, updated_at)
          SELECT ?, 1, 1, 1, ?, ? WHERE changes() = 1
          ON CONFLICT(user_id) DO UPDATE SET
            total_reviews = user_stats.total_reviews + 1,
            streak_days = CASE WHEN user_stats.last_active_date = excluded.last_active_date
              THEN user_stats.streak_days WHEN user_stats.last_active_date = ?
              THEN user_stats.streak_days + 1 ELSE 1 END,
            longest_streak = MAX(user_stats.longest_streak,
              CASE WHEN user_stats.last_active_date = excluded.last_active_date
                THEN user_stats.streak_days WHEN user_stats.last_active_date = ?
                THEN user_stats.streak_days + 1 ELSE 1 END),
            last_active_date = excluded.last_active_date, updated_at = excluded.updated_at`)
          .bind(userId, localDay, at, priorDay, priorDay),
      ]
      const results = await db.batch(statements)
      if (results.length !== statements.length || results.some(result => !result.success)) {
        throw new Error('Review completion batch failed.')
      }
      if (results[0].meta.changes === 1) return 'inserted'
      const existing = await findByClientEventId(userId, clientEventId)
      return existing?.card_id === cardId ? 'duplicate' : 'conflict'
    },
    async countInRange(userId: string, startInclusive: string, endExclusive: string): Promise<number> {
      const row = await db.prepare(`SELECT COUNT(*) AS count FROM review_events
        WHERE user_id = ? AND reviewed_at >= ? AND reviewed_at < ?`)
        .bind(userId, startInclusive, endExclusive).first<{ count: number }>()
      if (!row) throw new Error('Persistence review count failed.')
      return row.count
    },
    async insert(userId: string, input: CreateReviewEventInput): Promise<ReviewInsertResult> {
      // Conflict is global by schema; only a same-user replay is classified as duplicate.
      const row = await db.prepare(`INSERT INTO review_events (${columns}) VALUES (?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(client_event_id) DO NOTHING RETURNING ${columns}`)
        .bind(input.id, input.client_event_id, userId, input.card_id, input.review_result,
          input.reviewed_at, input.created_at).first<ReviewEventRow>()
      if (row) return { kind: 'inserted', event: row }
      const existing = await findByClientEventId(userId, input.client_event_id)
      if (!existing) throw new Error('Review event ID collision or persistence failure.')
      return { kind: 'duplicate', event: existing }
    },
  }
}
