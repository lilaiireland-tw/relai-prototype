import { apiClient, type HealthResponse } from '../lib/api'

export interface RuntimeService {
  readonly source: 'api'
  getHealth(): Promise<HealthResponse>
}

export const runtimeData: RuntimeService = {
  source: 'api',
  getHealth: () => apiClient.getHealth(),
}
