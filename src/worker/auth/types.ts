import type { PersistenceDatabase } from '../persistence'
import type { ImageJobQueue, ImageStorage } from '../services/image-vocabulary-jobs'

export interface SafeUser {
  id: string
  username: string
  display_name: string
  role: string
  must_change_password: boolean
}

/** Server-only binding subset. No auth material belongs in shared/client types. */
export type AuthEnv = {
  Bindings: { DB: PersistenceDatabase; AUTH_PEPPER: string; GEMINI_API_KEY?: string; GEMINI_MODEL?: string;
    IMAGE_JOBS?: ImageJobQueue; IMAGE_STORAGE?: ImageStorage }
  Variables: { user: SafeUser }
}
