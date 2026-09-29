import { createPasswordCredential, digestSessionToken, generateSessionToken, verifyPassword, type RawSessionToken } from '../auth/crypto'
import { sessionLifetimeSeconds } from '../auth/session'
import type { SafeUser } from '../auth/types'
import type { createRepositories, UserRow } from '../persistence'

type Repositories = ReturnType<typeof createRepositories>

// Fixed valid v1 interoperability vector from docs/auth-crypto.md. Non-secret,
// server-side only; missing usernames must still execute HMAC verification.
const syntheticCredential = {
  password_salt: 'AAECAwQFBgcICQoLDA0ODw',
  password_digest: 'v1:4c0e8ae7c9489938b1148df12255433d4f5522a53acec7d596bec831a0999caa',
}

function safeUser(user: UserRow): SafeUser {
  return { id: user.id, username: user.username, display_name: user.display_name, role: user.role,
    must_change_password: user.must_change_password }
}

export function createAuthService(repositories: Repositories) {
  const { users, sessions } = repositories
  return {
    async login(username: string, password: string, authPepper: string) {
      if (typeof authPepper !== 'string' || authPepper.length === 0) throw new Error('Auth configuration unavailable.')
      const user = await users.findByUsername(username)
      const verified = await verifyPassword(password, user ?? syntheticCredential, authPepper)
      if (!user || !verified || user.is_active !== 1) return null

      const token = generateSessionToken()
      const digest = await digestSessionToken(token)
      const createdAt = new Date().toISOString()
      const expiresAt = new Date(Date.parse(createdAt) + sessionLifetimeSeconds * 1000).toISOString()
      await sessions.create({ id: crypto.randomUUID(), user_id: user.id, token_digest: digest,
        created_at: createdAt, expires_at: expiresAt, last_seen_at: null })
      try {
        if ((await users.recordLogin(user.id, createdAt)).changes !== 1) {
          throw new Error('Login bookkeeping failed.')
        }
      } catch (error) {
        try { await sessions.revokeByTokenDigest(digest) } catch { /* Best effort; never log auth material. */ }
        throw error
      }
      return { user: safeUser(user), token, expiresAt }
    },

    async resolveSession(token: RawSessionToken) {
      const digest = await digestSessionToken(token)
      const session = await sessions.findByTokenDigest(digest)
      if (!session) return null
      const now = new Date()
      const expiresAt = Date.parse(session.expires_at)
      if (!Number.isFinite(expiresAt) || expiresAt <= now.getTime()) {
        try { await sessions.revokeByTokenDigest(digest) } catch { /* Reject even if cleanup fails. */ }
        return null
      }
      const user = await users.findById(session.user_id)
      if (!user || user.is_active !== 1) {
        try { await sessions.revokeByTokenDigest(digest) } catch { /* Reject even if cleanup fails. */ }
        return null
      }
      if ((await sessions.recordLastSeen(session.id, user.id, now.toISOString())).changes !== 1) return null
      return safeUser(user)
    },

    async logout(token: RawSessionToken) {
      await sessions.revokeByTokenDigest(await digestSessionToken(token))
    },

    async changePassword(authenticatedUserId: string, currentPassword: string, newPassword: string, authPepper: string) {
      if (typeof authPepper !== 'string' || authPepper.length === 0) throw new Error('Auth configuration unavailable.')
      const user = await users.findById(authenticatedUserId)
      if (!user || user.is_active !== 1) return null
      if (!await verifyPassword(currentPassword, user, authPepper)) return null
      const credential = await createPasswordCredential(newPassword, authPepper)
      const updated = await users.changeCredential(authenticatedUserId, user.password_digest, { ...credential,
        must_change_password: false, updated_at: new Date().toISOString() })
      if (updated.changes !== 1) return null
      return { ...safeUser(user), must_change_password: false }
    },
  }
}
