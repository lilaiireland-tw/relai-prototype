export const API_BASE_PATH = '/relaiapp/api/v1'

// Only the existing Worker contract is exposed. Add paths when APIs exist.
type ApiPath = '/health' | '/auth/login' | '/auth/me' | '/auth/logout'
export function apiUrl(path: ApiPath): string {
  return `${API_BASE_PATH}${path}`
}

export interface HealthResponse { status: 'ok' }
export interface AuthUser { id: string; username: string; display_name: string; role: 'user' | 'admin' }
export interface AuthResponse { user: AuthUser }
export interface LoginInput { username: string; password: string }

function decodeAuth(value: unknown): AuthResponse {
  if (typeof value !== 'object' || value === null || !('user' in value)) throw new Error('Invalid user')
  const user = value.user
  if (typeof user !== 'object' || user === null ||
    !('id' in user) || typeof user.id !== 'string' ||
    !('username' in user) || typeof user.username !== 'string' ||
    !('display_name' in user) || typeof user.display_name !== 'string' ||
    !('role' in user) || (user.role !== 'user' && user.role !== 'admin')) throw new Error('Invalid user')
  return { user: { id: user.id, username: user.username, display_name: user.display_name, role: user.role } }
}
export class ApiError extends Error {
  constructor(
    public readonly kind: 'http' | 'network' | 'invalid-response',
    message: string,
    public readonly status?: number,
  ) {
    super(message)
    this.name = 'ApiError'
  }
}

export function createApiClient(transport: typeof fetch = (...args) => globalThis.fetch(...args)) {
  const unauthorizedListeners = new Set<() => void>()
  async function request(path: ApiPath, body?: LoginInput): Promise<Response> {
    let response: Response
    try {
      response = await transport(apiUrl(path), {
        method: body || path === '/auth/logout' ? 'POST' : 'GET',
        mode: 'same-origin',
        // The browser exclusively manages the HttpOnly session cookie.
        credentials: 'same-origin',
        headers: { Accept: 'application/json', ...(body ? { 'Content-Type': 'application/json' } : {}) },
        ...(body ? { body: JSON.stringify(body) } : {}),
        cache: 'no-store',
        signal: AbortSignal.timeout(10_000),
      })
    } catch {
      throw new ApiError('network', '無法連線至服務，請稍後再試。')
    }
    if (!response.ok) {
      // me is resolved by its caller, which can discard stale bootstrap responses.
      if (response.status === 401 && path !== '/auth/login' && path !== '/auth/me') unauthorizedListeners.forEach(listener => listener())
      throw new ApiError('http', '服務暫時無法使用，請稍後再試。', response.status)
    }
    return response
  }
  async function getJson<T>(path: ApiPath, decode: (value: unknown) => T, body?: LoginInput): Promise<T> {
    const response = await request(path, body)
    try {
      const value: unknown = await response.json()
      return decode(value)
    } catch {
      throw new ApiError('invalid-response', '服務回應格式不正確，請稍後再試。')
    }
  }

  return {
    onUnauthorized(listener: () => void) {
      unauthorizedListeners.add(listener)
      return () => { unauthorizedListeners.delete(listener) }
    },
    login(input: LoginInput): Promise<AuthResponse> { return getJson('/auth/login', decodeAuth, input) },
    me(): Promise<AuthResponse> { return getJson('/auth/me', decodeAuth) },
    async logout(): Promise<void> { await request('/auth/logout') },
    getHealth(): Promise<HealthResponse> {
      return getJson('/health', value => {
        if (typeof value !== 'object' || value === null || !('status' in value) || value.status !== 'ok') {
          throw new Error('Invalid health response')
        }
        return { status: 'ok' }
      })
    },
  }
}
export const apiClient = createApiClient()
