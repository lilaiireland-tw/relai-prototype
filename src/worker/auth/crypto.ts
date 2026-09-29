import { tokenDigest, type TokenDigest } from '../persistence/types'

declare const rawSessionTokenBrand: unique symbol
/** Sensitive transport material. Never log it or pass it to persistence. */
export type RawSessionToken = string & { readonly [rawSessionTokenBrand]: true }

/** The only credential fields suitable for the users persistence boundary. */
export interface PasswordCredential {
  password_salt: string
  password_digest: string
}

function base64url(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function decodeBase64url(value: string, byteLength: number): Uint8Array<ArrayBuffer> {
  if (typeof value !== 'string' || value.length !== Math.ceil(byteLength * 8 / 6) || !/^[A-Za-z0-9_-]+$/.test(value)) {
    throw new Error('Invalid auth material format.')
  }
  const padded = value.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - value.length % 4) % 4)
  const bytes = Uint8Array.from(atob(padded), char => char.charCodeAt(0))
  // Reject noncanonical unused bits as well as padded/incorrect-length inputs.
  if (bytes.length !== byteLength || base64url(bytes) !== value) throw new Error('Invalid auth material format.')
  return bytes
}

export function generateCredentialSalt(): string {
  return base64url(crypto.getRandomValues(new Uint8Array(16)))
}

function credentialMessage(password: string, salt: Uint8Array): Uint8Array<ArrayBuffer> {
  // v1 wire encoding: UTF8("v1\0") || fixed 16 decoded salt bytes || UTF8(password).
  // Fixed prefix and salt length make every boundary unambiguous (including NULs).
  const passwordBytes = new TextEncoder().encode(password)
  const message = new Uint8Array(3 + salt.length + passwordBytes.length)
  message.set([0x76, 0x31, 0x00])
  message.set(salt, 3)
  message.set(passwordBytes, 3 + salt.length)
  return message
}

async function pepperKey(authPepper: string, usage: 'sign' | 'verify'): Promise<CryptoKey> {
  if (typeof authPepper !== 'string' || authPepper.length === 0) throw new Error('Auth secret is not configured.')
  return crypto.subtle.importKey('raw', new TextEncoder().encode(authPepper),
    { name: 'HMAC', hash: 'SHA-256' }, false, [usage])
}

function hex(bytes: ArrayBuffer): string {
  return [...new Uint8Array(bytes)].map(byte => byte.toString(16).padStart(2, '0')).join('')
}

export async function derivePasswordDigest(password: string, passwordSalt: string, authPepper: string): Promise<string> {
  const salt = decodeBase64url(passwordSalt, 16)
  const key = await pepperKey(authPepper, 'sign')
  return `v1:${hex(await crypto.subtle.sign('HMAC', key, credentialMessage(password, salt)))}`
}

export async function createPasswordCredential(password: string, authPepper: string): Promise<PasswordCredential> {
  const password_salt = generateCredentialSalt()
  return { password_salt, password_digest: await derivePasswordDigest(password, password_salt, authPepper) }
}

export async function verifyPassword(password: string, credential: PasswordCredential, authPepper: string): Promise<boolean> {
  // Parse stored public format before any signature verification. No string comparison of HMACs.
  const digest = credential.password_digest
  if (typeof digest !== 'string' || digest.length !== 67 || !/^v1:[a-f0-9]{64}$/.test(digest)) return false
  let salt: Uint8Array<ArrayBuffer>
  try { salt = decodeBase64url(credential.password_salt, 16) } catch { return false }
  const signature = Uint8Array.from(digest.slice(3).match(/../g)!, byte => parseInt(byte, 16))
  const key = await pepperKey(authPepper, 'verify')
  return crypto.subtle.verify('HMAC', key, signature, credentialMessage(password, salt))
}

/** Validate incoming transport material separately from the stored digest boundary. */
export function rawSessionToken(value: string): RawSessionToken {
  decodeBase64url(value, 32)
  return value as RawSessionToken
}

export function generateSessionToken(): RawSessionToken {
  return rawSessionToken(base64url(crypto.getRandomValues(new Uint8Array(32))))
}

export async function digestSessionToken(rawToken: RawSessionToken): Promise<TokenDigest> {
  rawSessionToken(rawToken) // Runtime guard also protects callers outside TypeScript.
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(rawToken))
  return tokenDigest(hex(digest))
}
