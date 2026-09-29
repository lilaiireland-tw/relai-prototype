import type { Context } from 'hono'
import { setCookie } from 'hono/cookie'
import { rawSessionToken, type RawSessionToken } from './crypto'

export const sessionCookieName = 'relai_session'
export const sessionLifetimeSeconds = 604800

/** Accept only the literal canonical opaque token; reject ambiguous duplicate cookies. */
export function readSessionToken(cookieHeader: string | undefined): RawSessionToken | null {
  const values = (cookieHeader ?? '').split(';').map(part => part.trim())
    .filter(part => part.split('=', 1)[0] === sessionCookieName)
  if (values.length !== 1) return null
  try { return rawSessionToken(values[0].slice(sessionCookieName.length + 1)) } catch { return null }
}

export function writeSessionCookie(c: Context, token: RawSessionToken | null, expiresAt?: string) {
  setCookie(c, sessionCookieName, token ?? '', {
    httpOnly: true,
    sameSite: 'Lax',
    path: '/relaiapp',
    secure: new URL(c.req.url).protocol === 'https:',
    maxAge: token === null ? 0 : sessionLifetimeSeconds,
    expires: token === null ? new Date(0) : new Date(expiresAt!),
  })
}
