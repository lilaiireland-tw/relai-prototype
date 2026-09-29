export const API_BASE_PATH = '/relaiapp/api/v1'

// Only the existing Worker contract is exposed. Add paths when APIs exist.
type ApiPath = '/health'
export function apiUrl(path: ApiPath): string {
  return `${API_BASE_PATH}${path}`
}

export interface HealthResponse { status: 'ok' }
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
  async function getJson<T>(path: ApiPath, decode: (value: unknown) => T): Promise<T> {
    let response: Response
    try {
      response = await transport(apiUrl(path), {
        method: 'GET',
        mode: 'same-origin',
        // Browser-managed HttpOnly cookies remain compatible with future auth.
        credentials: 'same-origin',
        headers: { Accept: 'application/json' },
        cache: 'no-store',
        signal: AbortSignal.timeout(10_000),
      })
    } catch {
      throw new ApiError('network', '無法連線至服務，請稍後再試。')
    }
    if (!response.ok) {
      throw new ApiError('http', '服務暫時無法使用，請稍後再試。', response.status)
    }
    try {
      const value: unknown = await response.json()
      return decode(value)
    } catch {
      throw new ApiError('invalid-response', '服務回應格式不正確，請稍後再試。')
    }
  }

  return {
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
