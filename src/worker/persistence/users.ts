import { insertRow, mutate, type PersistenceDatabase } from './d1'
import type { CreateUserInput, SqlBoolean, UserRow } from './types'

const columns = `id, username, display_name, password_salt, password_digest, role,
  is_active, cohort_source, created_at, updated_at, last_login_at`

export function createUsersRepository(db: PersistenceDatabase) {
  return {
    findById(id: string): Promise<UserRow | null> {
      return db.prepare(`SELECT ${columns} FROM users WHERE id = ?`).bind(id).first<UserRow>()
    },
    findByUsername(username: string): Promise<UserRow | null> {
      return db.prepare(`SELECT ${columns} FROM users WHERE username = ?`)
        .bind(username).first<UserRow>()
    },
    create(input: CreateUserInput): Promise<UserRow> {
      return insertRow<UserRow>(db.prepare(`INSERT INTO users (${columns})
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING ${columns}`)
        .bind(input.id, input.username, input.display_name, input.password_salt,
          input.password_digest, input.role ?? 'user', input.is_active ?? 1,
          input.cohort_source ?? null, input.created_at, input.updated_at, input.last_login_at ?? null))
    },
    recordLogin(id: string, at: string) {
      return mutate(db.prepare('UPDATE users SET last_login_at = ?, updated_at = ? WHERE id = ?')
        .bind(at, at, id))
    },
    replaceCredential(id: string, input: Pick<UserRow, 'password_salt' | 'password_digest' | 'updated_at'>) {
      return mutate(db.prepare('UPDATE users SET password_salt = ?, password_digest = ?, updated_at = ? WHERE id = ?')
        .bind(input.password_salt, input.password_digest, input.updated_at, id))
    },
    setActive(id: string, active: SqlBoolean, updatedAt: string) {
      return mutate(db.prepare('UPDATE users SET is_active = ?, updated_at = ? WHERE id = ?')
        .bind(active, updatedAt, id))
    },
  }
}
