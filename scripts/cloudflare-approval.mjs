import { error } from 'node:console'
import process from 'node:process'

export const remoteApprovalFlag = '--approve-remote-cloudflare'
export const remoteApprovalEnv = 'RELAI_REMOTE_CLOUDFLARE_APPROVAL'
const remoteApprovalValue = 'I_UNDERSTAND_REMOTE_CLOUDFLARE_COSTS_AND_IMPACT'

export function requireRemoteApproval(args, env = process.env) {
  if (args.filter((arg) => arg === remoteApprovalFlag).length !== 1 || env[remoteApprovalEnv] !== remoteApprovalValue) {
    throw new Error(`Blocked remote Cloudflare access. Owner approval requires both ${remoteApprovalFlag} and ${remoteApprovalEnv}=${remoteApprovalValue}.`)
  }
  return args.filter((arg) => arg !== remoteApprovalFlag)
}

export function logRemoteRisk(operation, estimate) {
  error(`REMOTE CLOUDFLARE OPERATION: ${operation}`)
  error(`Estimated D1 scan risk: ${estimate}`)
  error('Cloudflare billing can differ from result counts; stop if the target or estimate is unexpected.')
}
