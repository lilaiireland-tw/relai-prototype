import { mutate, type PersistenceDatabase } from './d1'
import type { UserSettingsRow } from './types'

const columns = 'user_id, daily_goal, timezone, english_level, created_at, updated_at'
type SettingsPatch = Partial<Pick<UserSettingsRow, 'daily_goal' | 'timezone'>>

export function createUserSettingsRepository(db: PersistenceDatabase) {
  const find = (userId: string): Promise<UserSettingsRow | null> =>
    db.prepare(`SELECT ${columns} FROM user_settings WHERE user_id = ?`).bind(userId).first<UserSettingsRow>()
  return {
    find,
    async getOrCreate(userId: string, timezone: string, at: string): Promise<UserSettingsRow> {
      await mutate(db.prepare(`INSERT INTO user_settings (user_id, timezone, created_at, updated_at)
        VALUES (?, ?, ?, ?) ON CONFLICT(user_id) DO NOTHING`).bind(userId, timezone, at, at))
      const row = await find(userId)
      if (!row) throw new Error('Persistence settings default failed.')
      return row
    },
    async update(userId: string, patch: SettingsPatch, updatedAt: string): Promise<UserSettingsRow | null> {
      const fields = (['daily_goal', 'timezone'] as const).filter(key => patch[key] !== undefined)
      if (fields.length === 0) throw new Error('Empty settings update.')
      const row = await db.prepare(`UPDATE user_settings SET ${fields.map(key => `${key} = ?`).join(', ')},
        updated_at = ? WHERE user_id = ? RETURNING ${columns}`)
        .bind(...fields.map(key => patch[key]!), updatedAt, userId).first<UserSettingsRow>()
      return row
    },
  }
}
