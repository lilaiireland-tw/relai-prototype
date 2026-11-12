import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { log, error as logError } from 'node:console'
import { readFileSync, writeFileSync } from 'node:fs'
import process from 'node:process'
import { pathToFileURL } from 'node:url'
import { buildRecord, buildRecordPath, git } from './staging-build-record.mjs'
import { stagingUrls, verifyStagingHealth } from './verify-staging-health.mjs'
import { verifyStagingDeployEnvironment } from './verify-staging-build.mjs'

// These checks detect mistakes; Builds connection, protected develop and token custody authorize delivery.
export function verifyAutoRelease(env, policy, current, recorded) {
  assert.equal(env.WORKERS_CI, '1', 'Automatic deployment requires Workers Builds')
  assert.equal(env.WORKERS_CI_BRANCH, 'develop', 'Only develop may deploy staging')
  assert.ok(!env.GITHUB_ACTIONS, 'GitHub Actions cannot deploy staging')
  verifyStagingDeployEnvironment(env)
  assert.match(env.WORKERS_CI_COMMIT_SHA ?? '', /^[a-f0-9]{40}$/, 'A full Builds commit SHA is required')
  assert.equal(env.WORKERS_CI_COMMIT_SHA, current.commit, 'Builds SHA must match checkout')
  assert.match(env.WORKERS_CI_BUILD_UUID ?? '', /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/, 'Build UUID required')
  assert.equal(current.build, env.WORKERS_CI_BUILD_UUID)
  assert.ok(env.CLOUDFLARE_API_TOKEN, 'A dedicated Builds deployment token is required')
  assert.match(env.CLOUDFLARE_ACCOUNT_ID ?? '', /^[a-f0-9]{32}$/, 'Explicit Builds account required')
  assert.ok(!env.RELAI_REMOTE_CLOUDFLARE_APPROVAL, 'Do not store operator approval in Builds')
  assert.equal(policy.enabled, true, 'Staging auto deployment is on release hold; PO activation required')
  assert.equal(policy.migrations, current.migrations, 'Schema hold: PO must confirm the complete migration set')
  assert.deepEqual(recorded, current, 'A fresh successful validated build is required; rebuild after failure or reuse')
  assert.equal(env.STAGING_URL, 'https://relai-prototype-staging.lilaiireland.workers.dev')
  stagingUrls(env.STAGING_URL)
}

export async function deployAuto({ env, policy, current, recorded, run, consume, health, report }) {
  verifyAutoRelease(env, policy, current, recorded)
  run(['--import', './scripts/deny-remote-network.mjs', 'scripts/verify-staging-build.mjs', '--auto'])
  // Consume before dispatch so a failed/duplicate invocation cannot silently redeploy this build.
  consume()
  const args = ['node_modules/wrangler/bin/wrangler.js', 'deploy', '--config', 'dist/relai_prototype/wrangler.json']
  run([...args, '--dry-run'])
  run(args)
  report(`Published staging commit ${current.commit}; build ${current.build}; https://dash.cloudflare.com/${env.CLOUDFLARE_ACCOUNT_ID}/workers/services/view/relai-prototype-staging/production/builds`)
  await health(env.STAGING_URL)
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    assert.equal(process.argv.length, 2, 'Automatic deployment accepts no options')
    assert.equal(git('status', '--porcelain', '--untracked-files=no'), '', 'Deploy only a clean checkout')
    await deployAuto({
      env: process.env,
      policy: JSON.parse(readFileSync('staging-release.json', 'utf8')),
      current: buildRecord(),
      recorded: JSON.parse(readFileSync(buildRecordPath, 'utf8')),
      consume: () => writeFileSync(buildRecordPath, JSON.stringify({ consumed: true })),
      run: args => {
        const result = spawnSync(process.execPath, args, {
          stdio: 'inherit', env: { ...process.env, WRANGLER_SEND_METRICS: 'false' },
        })
        if (result.error) throw result.error
        assert.equal(result.status, 0, 'Staging deployment step failed')
      },
      health: verifyStagingHealth,
      report: log,
    })
  } catch (error) {
    logError(error instanceof Error ? error.message : String(error))
    process.exitCode = 1
  }
}
