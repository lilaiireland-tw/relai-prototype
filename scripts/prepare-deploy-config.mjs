import assert from 'node:assert/strict'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import process from 'node:process'
import { pathToFileURL } from 'node:url'
import { unstable_readConfig as readConfig } from 'wrangler'

const requiredSecrets = ['AUTH_PEPPER', 'GEMINI_API_KEY']

export function prepareDeployConfig(built, source) {
  assert.deepEqual(source.secrets?.required, requiredSecrets, 'Both runtime secrets must remain required for deployment')
  assert.equal(built.name, source.name, 'Build Worker must match the selected deployment environment')
  assert.equal(source.d1_databases?.length, 1, 'Exactly one source D1 binding is required')
  assert.equal(built.d1_databases?.length, 1, 'Exactly one built D1 binding is required')
  const [sourceDb] = source.d1_databases
  const [builtDb] = built.d1_databases
  for (const key of ['binding', 'database_name', 'database_id']) {
    assert.equal(builtDb[key], sourceDb[key], `Built D1 ${key} must match the selected deployment environment`)
  }
  if (source.name === 'relai-prototype-staging') {
    assert.deepEqual(source.triggers?.crons, [], 'Staging must explicitly remove Cron triggers')
    built = { ...built, triggers: { crons: [] } }
  }
  return { ...built, secrets: { required: requiredSecrets } }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const environment = process.argv[2]
  if (!['staging', 'production'].includes(environment)) {
    throw new Error('Select exactly one deployment environment: staging or production.')
  }

  const outputPath = resolve('dist/relai_prototype/wrangler.json')
  assert.equal(existsSync(join(dirname(outputPath), '.dev.vars')), false,
    'Local secret values must not be present in the deployment bundle.')
  const output = JSON.parse(readFileSync(outputPath, 'utf8'))
  const source = readConfig({ config: 'wrangler.jsonc', env: environment })
  const prepared = prepareDeployConfig(output, source)
  writeFileSync(outputPath, `${JSON.stringify(prepared, null, 2)}\n`)
}
