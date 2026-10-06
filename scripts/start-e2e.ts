import { createServer } from 'vite'
import { prepareE2E } from './setup-e2e'
import process from 'node:process'

await prepareE2E()
const server = await createServer({ configFile: 'vite.e2e.config.ts', mode: 'e2e' })
await server.listen()
for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, async () => { await server.close(); process.exit(0) })
}
