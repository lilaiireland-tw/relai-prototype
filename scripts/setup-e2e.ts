import { execFileSync } from 'node:child_process'
import { existsSync, lstatSync, mkdirSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'
import { createPasswordCredential } from '../src/worker/auth/crypto'
import { e2ePepper, e2eUser } from './e2e-data'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const persistence = resolve(root, '.wrangler/e2e')
const config = resolve(root, 'e2e/wrangler.jsonc')
const quote = (value: string) => `'${value.replaceAll("'", "''")}'`

function wrangler(args: string[]) {
  // Arguments are fixed by this helper: no caller-controlled remote/config switches.
  execFileSync(process.execPath, [resolve(root, 'node_modules/wrangler/bin/wrangler.js'),
    'd1', ...args, 'relai-e2e-local-only', '--config', config,
    '--local', '--persist-to', persistence], {
    cwd: root, stdio: 'pipe',
    env: { ...process.env, CLOUDFLARE_ENV: '', CI: 'true', WRANGLER_SEND_METRICS: 'false' },
  })
}

export async function prepareE2E() {
  // Check the resolved parent before recursively deleting only this fixed test directory.
  mkdirSync(resolve(root, '.wrangler'), { recursive: true })
  if (realpathSync(resolve(root, '.wrangler')) !== resolve(root, '.wrangler')) {
    throw new Error('E2E persistence parent must not be a symlink.')
  }
  if (existsSync(persistence) && lstatSync(persistence).isSymbolicLink()) {
    throw new Error('E2E persistence directory must not be a symlink.')
  }
  rmSync(persistence, { recursive: true, force: true })
  mkdirSync(persistence, { recursive: true })
  writeFileSync(resolve(root, 'e2e/.dev.vars'), `AUTH_PEPPER=${e2ePepper}\n`)
  wrangler(['migrations', 'apply'])
  const credential = await createPasswordCredential(e2eUser.password, e2ePepper)
  const at = '2026-01-01T00:00:00.000Z'
  const sql = [
    `INSERT INTO users (id,username,display_name,password_salt,password_digest,created_at,updated_at,must_change_password) VALUES ('e2e-user',${quote(e2eUser.username)},'Local E2E Learner',${quote(credential.password_salt)},${quote(credential.password_digest)},${quote(at)},${quote(at)},0);`,
    `INSERT INTO user_settings (user_id,daily_goal,timezone,english_level,created_at,updated_at) VALUES ('e2e-user',10,'UTC','A1',${quote(at)},${quote(at)});`,
    ...['apple', 'book', 'cat'].map((word, index) => {
      const id = `e2e-${3 - index}`
      return `INSERT INTO vocabulary_catalog (id,headword,normalized_key,cefr_level,source_dataset,source_version,provenance,english_example,created_at,updated_at) VALUES (${quote(id)},${quote(word)},${quote(word)},'A1','local-e2e','82','Synthetic local-only fixture',${quote(`This is a ${word}.`)},${quote(at)},${quote(at)});
      INSERT INTO flashcards (id,user_id,card_type,front_content,back_content,part_of_speech,source,vocabulary_catalog_id,vocabulary_key,created_at,updated_at) VALUES (${quote(id)},'e2e-user','vocabulary',${quote(word)},${quote(`This is a ${word}.`)},'noun','local-e2e',${quote(id)},${quote(word)},${quote(at)},${quote(at)});`
    }),
  ].join('\n')
  const seed = resolve(persistence, 'seed.sql')
  try {
    writeFileSync(seed, sql)
    wrangler(['execute', '--file', seed])
  } finally { rmSync(seed, { force: true }) }
}

export function resetE2EState() {
  wrangler(['execute', '--command', `DELETE FROM sessions;
    DELETE FROM review_events;
    DELETE FROM user_stats;
    UPDATE flashcards SET last_reviewed_at=NULL,next_review_at=NULL,is_favorite=0;
    UPDATE user_settings SET daily_goal=10,timezone='UTC',english_level='A1';`])
}
