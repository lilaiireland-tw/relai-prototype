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

export type CardType = 'vocabulary' | 'error_log'

export interface FlashcardRow {
  id: string
  user_id: string
  source_item_id: string | null
  card_type: CardType
  front_content: string
  back_content: string
  part_of_speech: string | null
  zh_tw_definition: string | null
  explanation: string | null
  irish_usage: string | null
  source: string | null
  is_favorite: boolean
  last_reviewed_at: string | null
  next_review_at: string | null
  created_at: string
  updated_at: string
}

export type EditableFlashcard = Pick<FlashcardRow, 'card_type' | 'front_content' | 'back_content' |
  'part_of_speech' | 'zh_tw_definition' | 'explanation' | 'irish_usage' | 'source'>

export interface ReviewEventRow {
  id: string
  client_event_id: string
  user_id: string
  card_id: string
  review_result: string
  reviewed_at: string
  created_at: string
}

export type CreateReviewEventInput = Omit<ReviewEventRow, 'user_id'>

export interface UserStatsRow {
  user_id: string
  streak_days: number
  longest_streak: number
  total_cards_created: number
  total_reviews: number
  last_active_date: string | null
  updated_at: string
}

export type StatsCounters = Pick<UserStatsRow, 'streak_days' | 'longest_streak' |
  'total_cards_created' | 'total_reviews' | 'last_active_date'>

export interface UserSettingsRow {
  user_id: string
  daily_goal: number
  timezone: string
  created_at: string
  updated_at: string
}
