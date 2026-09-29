import { mutate, type PersistenceDatabase } from './d1'
import type { StatsCounters, UserStatsRow } from './types'

const columns = `user_id, streak_days, longest_streak, total_cards_created,
  total_reviews, last_active_date, updated_at`

export function createUserStatsRepository(db: PersistenceDatabase) {
  const find = (userId: string): Promise<UserStatsRow | null> =>
    db.prepare(`SELECT ${columns} FROM user_stats WHERE user_id = ?`).bind(userId).first<UserStatsRow>()
  return {
    find,
    async getOrCreate(userId: string, at: string): Promise<UserStatsRow> {
      await mutate(db.prepare('INSERT INTO user_stats (user_id, updated_at) VALUES (?, ?) ON CONFLICT(user_id) DO NOTHING')
        .bind(userId, at))
      const row = await find(userId)
      if (!row) throw new Error('Persistence stats default failed.')
      return row
    },
    update(userId: string, counters: StatsCounters, updatedAt: string) {
      return mutate(db.prepare(`UPDATE user_stats SET streak_days = ?, longest_streak = ?,
        total_cards_created = ?, total_reviews = ?, last_active_date = ?, updated_at = ? WHERE user_id = ?`)
        .bind(counters.streak_days, counters.longest_streak, counters.total_cards_created,
          counters.total_reviews, counters.last_active_date, updatedAt, userId))
    },
  }
}
