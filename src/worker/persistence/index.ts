import type { PersistenceDatabase } from './d1'
import { createSessionsRepository } from './sessions'
import { createUsersRepository } from './users'

export function createRepositories(db: PersistenceDatabase) {
  return { users: createUsersRepository(db), sessions: createSessionsRepository(db) }
}

export { tokenDigest } from './types'
export type { CreateSessionInput, CreateUserInput, UpdateCredentialInput, SessionRow, UserRow, TokenDigest } from './types'
export type { MutationResult, PersistenceDatabase } from './d1'
