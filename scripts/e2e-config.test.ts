import { readFileSync } from 'node:fs'
import { expect, test } from 'vitest'

test('local E2E config cannot resolve a real deployed D1 binding', () => {
  const config = JSON.parse(readFileSync('e2e/wrangler.jsonc', 'utf8'))
  expect(config.workers_dev).toBe(false)
  expect(config.env).toBeUndefined()
  expect(config.d1_databases).toEqual([{
    binding: 'DB', database_name: 'relai-e2e-local-only',
    database_id: '00000000-0000-0000-0000-000000000082',
    migrations_dir: '../migrations', remote: false,
  }])
  const setup = readFileSync('scripts/setup-e2e.ts', 'utf8')
  expect(setup).toContain("'--local', '--persist-to', persistence")
  expect(setup).not.toContain("'--remote'")
  const vite = readFileSync('vite.e2e.config.ts', 'utf8')
  expect(vite).toContain('remoteBindings: false')
  expect(vite).toContain("configPath: 'e2e/wrangler.jsonc'")
})
