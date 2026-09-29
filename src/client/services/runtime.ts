import { createApiClient, type HealthResponse } from '../lib/api'

export interface RuntimeService {
  readonly source: 'api'
  getHealth(): Promise<HealthResponse>
}

const api = createApiClient()
export const runtimeData: RuntimeService = {
  source: 'api',
  getHealth: () => api.getHealth(),
}
