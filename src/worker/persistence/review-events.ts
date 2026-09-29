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
