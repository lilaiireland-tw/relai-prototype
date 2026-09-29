import { insertRow, mutate, type PersistenceDatabase } from './d1'
import { assertTokenDigest, type CreateSessionInput, type SessionRow, type TokenDigest } from './types'

const columns = 'id, user_id, token_digest, created_at, expires_at, last_seen_at'

export function createSessionsRepository(db: PersistenceDatabase) {
  return {
    findByTokenDigest(digest: TokenDigest): Promise<SessionRow | null> {
      assertTokenDigest(digest)
      return db.prepare(`SELECT ${columns} FROM sessions WHERE token_digest = ?`)
        .bind(digest).first<SessionRow>()
    },
    create(input: CreateSessionInput): Promise<SessionRow> {
      assertTokenDigest(input.token_digest)
      return insertRow<SessionRow>(db.prepare(`INSERT INTO sessions (${columns})
        VALUES (?, ?, ?, ?, ?, ?) RETURNING ${columns}`)
        .bind(input.id, input.user_id, input.token_digest, input.created_at,
          input.expires_at, input.last_seen_at ?? null))
    },
    revokeByTokenDigest(digest: TokenDigest) {
      assertTokenDigest(digest)
      return mutate(db.prepare('DELETE FROM sessions WHERE token_digest = ?').bind(digest))
    },
    revokeForUser(userId: string) {
      return mutate(db.prepare('DELETE FROM sessions WHERE user_id = ?').bind(userId))
    },
    recordLastSeen(id: string, userId: string, at: string) {
      return mutate(db.prepare('UPDATE sessions SET last_seen_at = ? WHERE id = ? AND user_id = ?')
        .bind(at, id, userId))
    },
  }
}
