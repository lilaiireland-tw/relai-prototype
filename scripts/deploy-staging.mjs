import { spawnSync } from 'node:child_process'
import process from 'node:process'
import { error as logError } from 'node:console'
import { resolve } from 'node:path'
import { URL, fileURLToPath, pathToFileURL } from 'node:url'
import { logRemoteRisk, requireRemoteApproval, remoteApprovalFlag } from './cloudflare-approval.mjs'

const args = process.argv.slice(2)
let approvedArgs
try {
  approvedArgs = requireRemoteApproval(args)
  if (approvedArgs.some((arg) => arg !== '--build')) throw new Error('Unknown staging deployment option.')
} catch (error) {
  logError(error instanceof Error ? error.message : String(error))
  process.exit(1)
}

logRemoteRisk('staging deployment', 'the deployment command issues no D1 SQL; the bounded health check makes at most 6 GET requests to the current health route.')
const root = resolve(fileURLToPath(new URL('..', import.meta.url)))
const guard = pathToFileURL(resolve(root, 'scripts/deny-remote-network.mjs')).href
const run = (args, env = process.env) => {
  const result = spawnSync(process.execPath, args, { cwd: root, env, stdio: 'inherit' })
  if (result.error) throw result.error
  if (result.status !== 0) process.exit(result.status ?? 1)
}

if (approvedArgs.includes('--build')) {
  run(['--import', guard, 'node_modules/vite/bin/vite.js', 'build', '--mode', 'staging'])
}
run(['--import', guard, 'scripts/prepare-deploy-config.mjs', 'staging'])
run(['--import', guard, 'scripts/verify-staging-build.mjs'])
run(['scripts/run-remote-wrangler.mjs', remoteApprovalFlag, 'staging-deploy-dry-run'])
run(['scripts/run-remote-wrangler.mjs', remoteApprovalFlag, 'staging-deploy'])
run(['scripts/verify-staging-health.mjs', remoteApprovalFlag])
