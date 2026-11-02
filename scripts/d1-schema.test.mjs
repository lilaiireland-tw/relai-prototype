import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, readdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { test } from 'node:test'
import { env, execPath } from 'node:process'
import { DatabaseSync } from 'node:sqlite'
import { schemaSql, verifyCoreSchema } from './d1-schema-verification.mjs'

// Explicit operator-only test: never wired into CI/CD or ordinary deploy scripts.
test('core schema and password-change state match approved migrations on clean local D1 and Wrangler applies it only once', { timeout: 180000 }, () => {
  const persistence = mkdtempSync(join(tmpdir(), 'relai-24-d1-'))
  const run = (command, args = []) => {
    const result = spawnSync(execPath, [resolve('node_modules/wrangler/bin/wrangler.js'),
      'd1', ...command, 'relai-staging-db', '--config', 'wrangler.jsonc',
      '--env', 'staging', '--local', '--persist-to', persistence, ...args], {
      encoding: 'utf8', timeout: 60000,
      env: { ...env, CI: 'true', WRANGLER_SEND_METRICS: 'false', WRANGLER_LOG_PATH: join(persistence, 'logs') },
    })
    assert.ifError(result.error)
    assert.equal(result.status, 0, result.stdout + result.stderr)
    return result.stdout
  }
  const query = (sql) => JSON.parse(run(['execute'], ['--command', sql, '--json']))
    .flatMap((response) => response.results)
  const schema = () => query(schemaSql)
  assert.deepEqual(schema(), [], 'Fresh persistence must contain no application schema')
  const applied = run(['migrations', 'apply'])
  assert.match(applied, /0001_initial_core_schema.sql/)
  assert.match(applied, /0002_add_users_must_change_password.sql/)
  assert.match(applied, /0003_add_cefr_j_vocabulary_foundation.sql/)
  assert.match(applied, /0004_normalize_vocabulary_ownership.sql/)

  const metadata = new Map()
  const { schema: initialSchema, history } = verifyCoreSchema((sql) => {
    const result = JSON.parse(run(['execute'], ['--command', sql, '--json']))
    metadata.set(sql, result)
    return result
  })
  const altered = (change) => (sql) => {
    const result = JSON.parse(JSON.stringify(metadata.get(sql)))
    change(sql, result)
    return result
  }
  assert.throws(() => verifyCoreSchema(altered((sql, result) => {
    if (sql.startsWith('PRAGMA index_info')) {
      const position = sql.split('\n').findIndex((line) => line.includes("'idx_sessions_user_id'"))
      result[position].results = []
    }
  })), /index required/)
  assert.throws(() => verifyCoreSchema(altered((sql, result) => {
    if (sql.startsWith('PRAGMA index_list')) {
      result[0].results.forEach((index) => { index.unique = 0 })
    }
  })), /username must be unique/)
  assert.throws(() => verifyCoreSchema(altered((sql, result) => {
    if (sql === 'SELECT name FROM d1_migrations ORDER BY id') {
      result[0].results.push({ name: 'unexpected.sql' })
    }
  })), /History must match/)
  assert.match(run(['migrations', 'apply']), /No migrations to apply/)
  assert.match(run(['migrations', 'list']), /No migrations to apply/)
  assert.deepEqual(schema(), initialSchema, 'Second apply must leave schema unchanged')
  assert.deepEqual(query('SELECT name FROM d1_migrations ORDER BY id'), history)
})

test('catalog and personal vocabulary ownership stay normalized, isolated and deduplicated', () => {
  const db = new DatabaseSync(':memory:')
  db.exec('PRAGMA foreign_keys = ON')
  for (const name of readdirSync('migrations').filter(name => name.endsWith('.sql')).sort()) {
    db.exec(readFileSync(join('migrations', name), 'utf8'))
  }
  const addCatalog = db.prepare(`INSERT INTO vocabulary_catalog
    (id, headword, normalized_key, part_of_speech, cefr_level, source_dataset, source_version,
      provenance, created_at, updated_at) VALUES (?, ?, ?, ?, ?, 'CEFR-J Vocabulary Profile',
      'test-release', 'test attribution', '2026-10-01', '2026-10-01')`)
  addCatalog.run('cat-a', 'Book', 'book', null, 'A1')
  assert.throws(() => addCatalog.run('cat-duplicate', 'Book', 'book', null, 'A1'), /UNIQUE/)
  addCatalog.run('cat-b', 'Book', 'book', null, 'A2')
  addCatalog.run('cat-c', 'Book', 'book', 'verb', 'A1')
  assert.throws(() => addCatalog.run('cat-c1', 'Book', 'book', null, 'C1'), /CHECK/)
  assert.throws(() => addCatalog.run('cat-c2', 'Book', 'book', null, 'C2'), /CHECK/)
  assert.deepEqual({ ...db.prepare(`SELECT source_dataset, source_version, provenance, zh_tw_definition,
    english_example, zh_tw_example_translation, irish_usage FROM vocabulary_catalog WHERE id = 'cat-a'`).get() }, {
    source_dataset: 'CEFR-J Vocabulary Profile', source_version: 'test-release', provenance: 'test attribution',
    zh_tw_definition: null, english_example: null, zh_tw_example_translation: null, irish_usage: null,
  })

  const settings = db.prepare(`INSERT INTO user_settings (user_id, timezone, created_at, updated_at, english_level)
    VALUES (?, 'UTC', '2026-10-01', '2026-10-01', ?)`)
  settings.run('unset', null)
  db.exec(`INSERT INTO user_settings (user_id, timezone, created_at, updated_at)
    VALUES ('default-unset', 'UTC', '2026-10-01', '2026-10-01')`)
  for (const level of ['A1', 'A2', 'B1', 'B2']) settings.run(`user-${level}`, level)
  assert.equal(db.prepare(`SELECT english_level FROM user_settings WHERE user_id = 'unset'`).get().english_level, null)
  assert.equal(db.prepare(`SELECT english_level FROM user_settings WHERE user_id = 'default-unset'`).get().english_level, null)
  assert.throws(() => settings.run('user-C1', 'C1'), /CHECK/)
  assert.throws(() => settings.run('user-C2', 'C2'), /CHECK/)

  const addCard = db.prepare(`INSERT INTO flashcards
    (id, user_id, card_type, created_at, updated_at, vocabulary_catalog_id, vocabulary_key)
    VALUES (?, ?, 'vocabulary', '2026-10-01', '2026-10-01', ?, ?)`)
  addCard.run('card-a', 'one', 'cat-a', 'book')
  assert.throws(() => addCard.run('retry', 'one', 'cat-a', 'different'), /UNIQUE/)
  assert.throws(() => addCard.run('wrong-key', 'three', 'cat-a', 'other'), /FOREIGN KEY/)
  db.prepare(`INSERT INTO user_vocabulary_items (id, user_id, headword, normalized_key, created_at, updated_at)
    VALUES ('personal-book', 'one', 'Book', 'book', '2026-10-01', '2026-10-01')`).run()
  assert.throws(() => db.prepare(`INSERT INTO flashcards (id, user_id, card_type, created_at, updated_at,
    user_vocabulary_item_id, vocabulary_key) VALUES ('ai-duplicate', 'one', 'vocabulary',
    '2026-10-01', '2026-10-01', 'personal-book', 'book')`).run(), /UNIQUE/)
  assert.throws(() => db.prepare(`INSERT INTO flashcards (id, user_id, card_type, created_at, updated_at,
    user_vocabulary_item_id, vocabulary_key) VALUES ('cross-user', 'two', 'vocabulary',
    '2026-10-01', '2026-10-01', 'personal-book', 'book')`).run(), /FOREIGN KEY/)
  addCard.run('card-b', 'two', 'cat-a', 'book')
  assert.throws(() => addCard.run('missing-catalog', 'three', 'missing', 'other'), /FOREIGN KEY/)
  assert.throws(() => db.prepare(`INSERT INTO user_vocabulary_items
    (id, user_id, headword, normalized_key, created_at, updated_at)
    VALUES ('duplicate-personal', 'one', 'BOOK', 'book', '2026-10-01', '2026-10-01')`).run(), /UNIQUE/)
  assert.throws(() => db.prepare(`INSERT INTO flashcards
    (id, user_id, card_type, front_content, back_content, created_at, updated_at, vocabulary_catalog_id)
    VALUES ('wrong-type', 'three', 'error_log', 'x', 'x', '2026-10-01', '2026-10-01', 'cat-a')`).run(), /CHECK/)
  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM flashcards').get().count, 2)
  db.prepare("UPDATE flashcards SET is_favorite = 1, last_reviewed_at = '2026-10-02' WHERE id = 'card-a'").run()
  assert.equal(db.prepare("SELECT is_favorite FROM flashcards WHERE id = 'card-b'").get().is_favorite, 0)
  db.prepare("DELETE FROM flashcards WHERE id = 'card-a'").run()
  assert.equal(db.prepare("SELECT headword FROM vocabulary_catalog WHERE id = 'cat-a'").get().headword, 'Book')
  assert.equal(db.prepare("SELECT COUNT(*) AS count FROM flashcards WHERE id = 'card-b'").get().count, 1)
  db.prepare(`INSERT INTO flashcards
    (id, user_id, card_type, front_content, back_content, created_at, updated_at)
    VALUES ('personal-error', 'one', 'error_log', 'wrong', 'right', '2026-10-01', '2026-10-01')`).run()
  assert.equal(db.prepare("SELECT card_type FROM flashcards WHERE id = 'personal-error'").get().card_type, 'error_log')
  db.close()
})

test('normalization migration discards disposable learning state without backfilling cards', () => {
  const db = new DatabaseSync(':memory:')
  db.exec('PRAGMA foreign_keys = ON')
  for (const name of readdirSync('migrations').filter(name => name.endsWith('.sql')).sort().slice(0, 3)) {
    db.exec(readFileSync(join('migrations', name), 'utf8'))
  }
  db.exec(`INSERT INTO user_settings (user_id, timezone, created_at, updated_at, english_level)
    VALUES ('owner', 'UTC', '2026-10-01', '2026-10-01', 'A1');
    INSERT INTO user_stats (user_id, updated_at) VALUES ('owner', '2026-10-01');
    INSERT INTO flashcards (id, user_id, card_type, front_content, back_content, created_at, updated_at)
      VALUES ('old-card', 'owner', 'vocabulary', 'old', 'old content', '2026-10-01', '2026-10-01');
    INSERT INTO review_events (id, client_event_id, user_id, card_id, review_result, reviewed_at, created_at)
      VALUES ('review', 'event', 'owner', 'old-card', 'viewed', '2026-10-01', '2026-10-01');`)
  db.exec(readFileSync(join('migrations', '0004_normalize_vocabulary_ownership.sql'), 'utf8'))
  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM flashcards').get().count, 0)
  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM review_events').get().count, 0)
  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM user_stats').get().count, 0)
  assert.equal(db.prepare("SELECT english_level FROM user_settings WHERE user_id = 'owner'").get().english_level, null)
  db.close()
})
