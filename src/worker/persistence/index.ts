import type { PersistenceDatabase } from './d1'
import { createSessionsRepository } from './sessions'
import { createUsersRepository } from './users'
import { createFlashcardsRepository } from './flashcards'
import { createReviewEventsRepository } from './review-events'
import { createUserStatsRepository } from './user-stats'
import { createUserSettingsRepository } from './user-settings'

export function createRepositories(db: PersistenceDatabase) {
  return {
    users: createUsersRepository(db), sessions: createSessionsRepository(db),
    flashcards: createFlashcardsRepository(db), reviewEvents: createReviewEventsRepository(db),
    userStats: createUserStatsRepository(db), userSettings: createUserSettingsRepository(db),
  }
}

export { tokenDigest } from './types'
export type { CreateSessionInput, CreateUserInput, UpdateCredentialInput, SessionRow, UserRow, TokenDigest } from './types'
export type { MutationResult, PersistenceDatabase } from './d1'
export type { CardType, EditableFlashcard, FlashcardRow, CreateReviewEventInput,
  ReviewEventRow, UserStatsRow, StatsCounters, UserSettingsRow, EnglishLevel } from './types'
export type { CardCursor, CardListQuery } from './flashcards'
export type { ReviewInsertResult } from './review-events'
