export const remoteApprovalFlag: string
export const remoteApprovalEnv: string
export function requireRemoteApproval(args: string[], env?: NodeJS.ProcessEnv): string[]
export function logRemoteRisk(operation: string, estimate: string): void
