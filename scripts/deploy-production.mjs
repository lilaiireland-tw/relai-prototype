import { spawnSync } from 'node:child_process'
import process from 'node:process'
import { error as logError } from 'node:console'
import { resolve } from 'node:path'
import { URL, fileURLToPath, pathToFileURL } from 'node:url'
import { logRemoteRisk, requireRemoteApproval, remoteApprovalFlag } from './cloudflare-approval.mjs'

let approvedArgs
try {
  approvedArgs = requireRemoteApproval(process.argv.slice(2))
  if (approvedArgs.length) throw new Error('Unknown production deployment option.')
} catch (error) {
  logError(error instanceof Error ? error.message : String(error))
  process.exit(1)
}

logRemoteRisk('production deployment', 'the deployment command issues no D1 SQL; production deployment and subsequent Worker traffic are possible.')
const root = resolve(fileURLToPath(new URL('..', import.meta.url)))
const guard = pathToFileURL(resolve(root, 'scripts/deny-remote-network.mjs')).href
const build = spawnSync(process.execPath, ['--import', guard, 'node_modules/vite/bin/vite.js', 'build', '--mode', 'production'], {
  cwd: root, stdio: 'inherit',
})
if (build.error) throw build.error
if (build.status !== 0) process.exit(build.status ?? 1)
const deploy = spawnSync(process.execPath, ['scripts/run-remote-wrangler.mjs', remoteApprovalFlag, 'production-deploy'], {
  cwd: root, stdio: 'inherit', env: process.env,
})
if (deploy.error) throw deploy.error
process.exitCode = deploy.status ?? 1
