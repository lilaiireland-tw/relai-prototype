import { createServer } from 'vite'
import { resolve } from 'node:path'
import { prepareE2E } from './setup-e2e'
import process from 'node:process'

await prepareE2E()
process.env.WRANGLER_REGISTRY_PATH = resolve('.wrangler/e2e/registry')
process.env.WRANGLER_LOG_PATH = resolve('.wrangler/e2e/logs')
process.env.XDG_CONFIG_HOME = resolve('.wrangler/e2e/config')
const server = await createServer({ configFile: 'vite.e2e.config.ts', mode: 'e2e' })
await server.listen()
for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, () => {
    const forceExit = setTimeout(() => process.exit(0), 5_000)
    void server.close().then(() => { clearTimeout(forceExit); process.exit(0) })
  })
}
