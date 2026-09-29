import type { PersistenceDatabase } from '../persistence'

export interface SafeUser {
  id: string
  username: string
  display_name: string
  role: string
}

/** Server-only binding subset. No auth material belongs in shared/client types. */
export type AuthEnv = {
  Bindings: { DB: PersistenceDatabase; AUTH_PEPPER: string }
  Variables: { user: SafeUser }
}
