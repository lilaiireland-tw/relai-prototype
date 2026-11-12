import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { readFileSync, readdirSync, rmSync, writeFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import process from 'node:process'
import { pathToFileURL } from 'node:url'

export const buildRecordPath = '.wrangler/staging-validated.json'
export const git = (...args) => execFileSync('git', args, { encoding: 'utf8' }).trim()

export function directoryDigest(directory) {
  const hash = createHash('sha256')
  function visit(path, prefix = '') {
    for (const entry of readdirSync(path, { withFileTypes: true }).sort((a, b) => a.name < b.name ? -1 : 1)) {
      const name = `${prefix}${entry.name}`
      assert.ok(!entry.isSymbolicLink(), 'Release inputs must not contain symlinks')
      if (entry.isDirectory()) visit(join(path, entry.name), `${name}/`)
      else hash.update(JSON.stringify([name, readFileSync(join(path, entry.name)).toString('base64')]))
    }
  }
  visit(directory)
  return hash.digest('hex')
}

export function buildRecord() {
  return {
    commit: git('rev-parse', 'HEAD'),
    build: process.env.WORKERS_CI_BUILD_UUID ?? '',
    artifacts: directoryDigest('dist'),
    migrations: directoryDigest('migrations'),
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  if (process.argv[2] === 'begin') rmSync(buildRecordPath, { force: true })
  else if (process.argv[2] === 'complete') {
    mkdirSync('.wrangler', { recursive: true })
    writeFileSync(buildRecordPath, JSON.stringify(buildRecord()))
  } else throw new Error('Select begin or complete for validated staging builds')
}
