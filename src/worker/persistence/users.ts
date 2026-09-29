import { insertRow, mutate, type PersistenceDatabase } from './d1'
import type { AdminAccountRow, CreateUserInput, SqlBoolean, UpdateCredentialInput, UserRow } from './types'

const columns = `id, username, display_name, password_salt, password_digest, role,
  is_active, cohort_source, created_at, updated_at, last_login_at, must_change_password`

type StoredUserRow = Omit<UserRow, 'must_change_password'> & { must_change_password: SqlBoolean }

function userRow(row: StoredUserRow): UserRow {
  return { ...row, must_change_password: row.must_change_password === 1 }
}

export function createUsersRepository(db: PersistenceDatabase) {
  return {
    async listAccounts(): Promise<AdminAccountRow[]> {
      const result = await db.prepare(`SELECT id, username, display_name, role,
        is_active, cohort_source, created_at, updated_at, last_login_at
        FROM users ORDER BY username, id`).all<AdminAccountRow>()
      if (!result.success) throw new Error('Persistence account listing failed.')
      return result.results
    },
    async findById(id: string): Promise<UserRow | null> {
      const row = await db.prepare(`SELECT ${columns} FROM users WHERE id = ?`).bind(id).first<StoredUserRow>()
      return row === null ? null : userRow(row)
    },
    async findByUsername(username: string): Promise<UserRow | null> {
      const row = await db.prepare(`SELECT ${columns} FROM users WHERE username = ?`)
        .bind(username).first<StoredUserRow>()
      return row === null ? null : userRow(row)
    },
    async create(input: CreateUserInput): Promise<UserRow> {
      const row = await insertRow<StoredUserRow>(db.prepare(`INSERT INTO users (${columns})
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING ${columns}`)
        .bind(input.id, input.username, input.display_name, input.password_salt,
          input.password_digest, input.role ?? 'user', input.is_active ?? 1,
          input.cohort_source ?? null, input.created_at, input.updated_at, input.last_login_at ?? null,
          input.must_change_password ? 1 : 0))
      return userRow(row)
    },
    recordLogin(id: string, at: string) {
      return mutate(db.prepare('UPDATE users SET last_login_at = ?, updated_at = ? WHERE id = ?')
        .bind(at, at, id))
    },
    replaceCredential(id: string, input: Pick<UserRow, 'password_salt' | 'password_digest' | 'updated_at'>) {
      return mutate(db.prepare('UPDATE users SET password_salt = ?, password_digest = ?, updated_at = ? WHERE id = ?')
        .bind(input.password_salt, input.password_digest, input.updated_at, id))
    },
    // The caller supplies trusted authenticated identity, never client ownership.
    updateCredential(authenticatedUserId: string, input: UpdateCredentialInput) {
      return mutate(db.prepare(`UPDATE users SET password_salt = ?, password_digest = ?,
        must_change_password = ?, updated_at = ? WHERE id = ?`)
        .bind(input.password_salt, input.password_digest, input.must_change_password ? 1 : 0,
          input.updated_at, authenticatedUserId))
    },
    changeCredential(authenticatedUserId: string, currentDigest: string, input: UpdateCredentialInput) {
      return mutate(db.prepare(`UPDATE users SET password_salt = ?, password_digest = ?,
        must_change_password = 0, updated_at = ?
        WHERE id = ? AND password_digest = ? AND is_active = 1`)
        .bind(input.password_salt, input.password_digest, input.updated_at,
          authenticatedUserId, currentDigest))
    },
    setActive(id: string, active: SqlBoolean, updatedAt: string) {
      return mutate(db.prepare('UPDATE users SET is_active = ?, updated_at = ? WHERE id = ?')
        .bind(active, updatedAt, id))
    },
  }
}
