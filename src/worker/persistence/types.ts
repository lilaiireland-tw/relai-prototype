export type SqlBoolean = 0 | 1

/** Worker-internal credential-bearing row; never serialize directly to clients. */
export interface UserRow {
  id: string
  username: string
  display_name: string
  password_salt: string
  password_digest: string
  must_change_password: boolean
  role: string
  is_active: SqlBoolean
  cohort_source: string | null
  created_at: string
  updated_at: string
  last_login_at: string | null
}

export type CreateUserInput = Omit<UserRow, 'role' | 'is_active' | 'cohort_source' | 'last_login_at' | 'must_change_password'> &
  Partial<Pick<UserRow, 'role' | 'is_active' | 'cohort_source' | 'last_login_at' | 'must_change_password'>>

/** Already derived credentials; identity must come from the authenticated service. */
export type UpdateCredentialInput = Pick<UserRow,
  'password_salt' | 'password_digest' | 'must_change_password' | 'updated_at'>

/** Account-management projection: credentials never leave the repository. */
export type AdminAccountRow = Omit<UserRow, 'password_salt' | 'password_digest' | 'must_change_password'>

declare const tokenDigestBrand: unique symbol
export type TokenDigest = string & { readonly [tokenDigestBrand]: true }

/** Validates an already computed SHA-256 hex digest. Never pass a raw token. */
export function tokenDigest(value: string): TokenDigest {
  if (!/^[a-f0-9]{64}$/.test(value)) throw new Error('Invalid session token digest.')
  return value as TokenDigest
}

export function assertTokenDigest(value: TokenDigest): void {
  tokenDigest(value)
}

export interface SessionRow {
  id: string
  user_id: string
  token_digest: TokenDigest
  created_at: string
  expires_at: string
  last_seen_at: string | null
}

export type CreateSessionInput = Omit<SessionRow, 'last_seen_at'> &
  Partial<Pick<SessionRow, 'last_seen_at'>>
