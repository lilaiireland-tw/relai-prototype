import { spawnSync } from 'node:child_process'
import { error as logError } from 'node:console'
import process from 'node:process'
import { resolve } from 'node:path'
import { logRemoteRisk, requireRemoteApproval } from './cloudflare-approval.mjs'

const operations = {
  'staging-migration-list': {
    args: ['d1', 'migrations', 'list', 'relai-staging-db', '--config', 'wrangler.jsonc', '--env', 'staging', '--remote'],
    risk: 'migration history only; its row count depends on the number of applied migrations.',
  },
  'staging-migration-apply': {
    args: ['d1', 'migrations', 'apply', 'relai-staging-db', '--config', 'wrangler.jsonc', '--env', 'staging', '--remote'],
    risk: 'remote write; D1 reads and writes depend on the reviewed pending migration.',
  },
  'production-d1-info': {
    args: ['d1', 'info', 'relai-prod-db', '--config', 'wrangler.jsonc', '--env', 'production', '--json'],
    risk: 'database metadata only; Cloudflare account API access occurs, but no D1 SQL is issued.',
  },
  'production-migration-list': {
    args: ['d1', 'migrations', 'list', 'relai-prod-db', '--config', 'wrangler.jsonc', '--env', 'production', '--remote'],
    risk: 'migration history only; its row count depends on the number of applied migrations.',
  },
  'production-migration-apply': {
    args: ['d1', 'migrations', 'apply', 'relai-prod-db', '--config', 'wrangler.jsonc', '--env', 'production', '--remote'],
    risk: 'remote write; D1 reads and writes depend on the reviewed pending migration.',
  },
  'staging-deploy-dry-run': {
    args: ['deploy', '--config', 'dist/relai_prototype/wrangler.json', '--dry-run'],
    risk: 'no D1 SQL is issued by this command; Cloudflare account API access still occurs.',
  },
  'staging-deploy': {
    args: ['deploy', '--config', 'dist/relai_prototype/wrangler.json'],
    risk: 'no D1 SQL is issued by this command; deployment may cause later Worker traffic.',
  },
  'production-deploy': {
    args: ['deploy'],
    risk: 'no D1 SQL is issued by this command; production deployment and subsequent traffic are possible.',
  },
}

let approvedArgs
try {
  approvedArgs = requireRemoteApproval(process.argv.slice(2))
  if (approvedArgs.length !== 1 || !operations[approvedArgs[0]]) {
    throw new Error('Unknown or malformed remote Wrangler operation.')
  }
} catch (error) {
  logError(error instanceof Error ? error.message : String(error))
  process.exit(1)
}

const operation = operations[approvedArgs[0]]
logRemoteRisk(approvedArgs[0], operation.risk)
const result = spawnSync(process.execPath, [resolve('node_modules/wrangler/bin/wrangler.js'), ...operation.args], {
  cwd: process.cwd(), stdio: 'inherit', env: { ...process.env, WRANGLER_SEND_METRICS: 'false' },
})
if (result.error) throw result.error
process.exitCode = result.status ?? 1
