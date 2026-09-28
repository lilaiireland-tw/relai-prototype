import assert from 'node:assert/strict'
import { log } from 'node:console'
import { readFile } from 'node:fs/promises'
import process from 'node:process'
import { pathToFileURL } from 'node:url'
import { unstable_readConfig as readConfig } from 'wrangler'

export function verifyStagingBuild(config, staging) {
  assert.equal(config.name, 'relai-prototype-staging', 'Deploy only the staging Worker')
  assert.equal(config.name, staging.name)
  assert.equal(config.workers_dev, true, 'Staging must enable its stable workers.dev URL')
  assert.ok(!config.route, 'Staging must not have a custom route')
  assert.deepEqual(config.routes ?? [], [], 'Staging must not deploy custom routes')
  assert.equal(config.d1_databases?.length, 1, 'Exactly one staging D1 binding is required')
  const [db] = config.d1_databases
  assert.equal(db.binding, 'DB')
  assert.equal(db.database_name, 'relai-staging-db')
  assert.equal(db.database_id, staging.d1_databases[0].database_id, 'Build must use the staging database ID')
  assert.notEqual(db.remote, true)
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const staging = readConfig({ config: 'wrangler.jsonc', env: 'staging' })
  const built = JSON.parse(await readFile('dist/relai_prototype/wrangler.json', 'utf8'))
  verifyStagingBuild(built, staging)
  log('Verified staging build: relai-prototype-staging -> DB -> relai-staging-db; workers.dev only.')
}
