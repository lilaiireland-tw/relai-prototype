import assert from 'node:assert/strict'
import { log } from 'node:console'
import { unstable_readConfig as readConfig } from 'wrangler'

// Resolve the source configuration explicitly, never the previous Vite build.
const resolve = (env) => readConfig({ config: 'wrangler.jsonc', env })
const binding = (config, expectedName) => {
  assert.equal(config.d1_databases.length, 1, 'Exactly one D1 binding is required')
  const db = config.d1_databases[0]
  assert.equal(db.binding, 'DB')
  assert.equal(db.database_name, expectedName)
  assert.match(db.database_id, /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i)
  assert.notEqual(db.remote, true, 'Local development must use local D1 simulation')
  return db.database_id
}

const staging = resolve('staging')
const production = resolve('production')
const stagingId = binding(staging, 'relai-staging-db')
const productionId = binding(production, 'relai-prod-db')
assert.equal(binding(resolve(''), 'relai-staging-db'), stagingId)
assert.notEqual(stagingId, productionId, 'Staging and production must be physically separate')
assert.notEqual(staging.name, production.name, 'Environments must target separate Workers')
log('Verified: default/staging -> DB -> relai-staging-db; production -> DB -> relai-prod-db; distinct IDs.')
