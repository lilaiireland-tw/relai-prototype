import { spawnSync } from 'node:child_process'
import process from 'node:process'
import { dirname, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const guard = pathToFileURL(resolve(root, 'scripts/deny-remote-network.mjs')).href
const env = {
  ...process.env,
  NODE_OPTIONS: [process.env.NODE_OPTIONS, `--import=${guard}`].filter(Boolean).join(' '),
  CLOUDFLARE_API_TOKEN: '',
  CLOUDFLARE_API_KEY: '',
  CF_API_TOKEN: '',
  CLOUDFLARE_ACCOUNT_ID: '',
  CLOUDFLARE_ENV: '',
  CLOUDFLARE_LOAD_DEV_VARS_FROM_DOT_ENV: 'false',
  CLOUDFLARE_INCLUDE_PROCESS_ENV: 'false',
  GOOGLE_API_KEY: '',
  GOOGLE_APPLICATION_CREDENTIALS: '',
  GEMINI_API_KEY: '',
  WRANGLER_SEND_METRICS: 'false',
}
const vitest = resolve(root, 'node_modules/vitest/vitest.mjs')
const playwright = resolve(root, 'node_modules/@playwright/test/cli.js')
const commands = {
  all: [[vitest, 'run'], ['--test', 'scripts/deployment.test.mjs', 'scripts/remote-safety.test.mjs', 'scripts/runtime-read-query-plan.test.mjs'], ['scripts/verify-d1-config.mjs']],
  d1Schema: [['--test', 'scripts/d1-schema.test.mjs', 'scripts/remote-safety.test.mjs']],
  routing: [[resolve(root, 'node_modules/vite/bin/vite.js'), 'build', '--mode', 'staging'], ['--test', 'scripts/routing.test.mjs']],
  e2e: [[playwright, 'test', ...process.argv.slice(3)]],
  catalog: [[vitest, 'run', 'scripts/cefr-j-catalog.test.ts', 'scripts/cefr-j-platform.test.ts']],
  admin: [[vitest, 'run', 'scripts/manage-user.test.ts', 'scripts/manage-user-platform.test.ts']],
  persistence: [[vitest, 'run', 'src/worker/persistence/persistence.test.ts', 'src/worker/persistence/product-persistence.test.ts']],
  auth: [[vitest, 'run', 'src/worker/auth/crypto.test.ts']],
  authApi: [[vitest, 'run', 'src/worker/routes/auth.test.ts']],
}

const suite = process.argv[2]
if (!commands[suite]) throw new Error(`Unknown isolated test suite: ${suite ?? '(missing)'}`)
if (suite === 'e2e') {
  env.WRANGLER_REGISTRY_PATH = resolve(root, '.wrangler/e2e/registry')
  env.WRANGLER_LOG_PATH = resolve(root, '.wrangler/e2e/logs')
  env.XDG_CONFIG_HOME = resolve(root, '.wrangler/e2e/config')
}
for (const args of commands[suite]) {
  const nodeArgs = suite === 'routing' && args[0].endsWith('vite.js')
    ? ['--import', guard, ...args] : args
  const result = spawnSync(process.execPath, nodeArgs, { cwd: root, env, stdio: 'inherit' })
  if (result.error) throw result.error
  if (result.status !== 0) {
    process.exitCode = result.status ?? 1
    break
  }
}
