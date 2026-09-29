export type UserRole = 'user' | 'admin'
export type CohortSource = 'lilai_referral' | 'organic' | 'internal_beta'
export type SqlBoolean = 0 | 1

/** Worker-internal credential-bearing row; never serialize directly to clients. */
export interface UserRow {
  id: string
  username: string
  display_name: string
  password_salt: string
  password_digest: string
  role: UserRole
  is_active: SqlBoolean
  cohort_source: CohortSource | null
  created_at: string
  updated_at: string
  last_login_at: string | null
}

export type CreateUserInput = Omit<UserRow, 'role' | 'is_active' | 'cohort_source' | 'last_login_at'> &
  Partial<Pick<UserRow, 'role' | 'is_active' | 'cohort_source' | 'last_login_at'>>

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
