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
  assert.match(applied, /0005_canonical_sense_aware_vocabulary.sql/)
  assert.match(applied, /0006_durable_image_vocabulary_jobs.sql/)
  assert.match(applied, /0007_image_storage_cleanup_cursor.sql/)

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
    if (sql === 'SELECT name FROM d1_migrations ORDER BY id LIMIT 50') {
      result[0].results.push({ name: 'unexpected.sql' })
    }
  })), /History must match/)
  assert.match(run(['migrations', 'apply']), /No migrations to apply/)
  assert.match(run(['migrations', 'list']), /No migrations to apply/)
  assert.deepEqual(schema(), initialSchema, 'Second apply must leave schema unchanged')
  assert.deepEqual(query('SELECT name FROM d1_migrations ORDER BY id LIMIT 50'), history)
})

test('canonical catalog senses are shared while user-owned learning state stays separate', () => {
  const db = new DatabaseSync(':memory:')
  db.exec('PRAGMA foreign_keys = ON')
  for (const name of readdirSync('migrations').filter(name => name.endsWith('.sql')).sort()) {
    db.exec(readFileSync(join('migrations', name), 'utf8'))
  }
  const addCatalog = db.prepare(`INSERT INTO vocabulary_catalog
    (id, headword, normalized_key, part_of_speech, part_of_speech_key, sense_key, semantic_sense,
      cefr_level, source_dataset, source_version, provenance, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'test-catalog', '1', 'test attribution', '2026-10-01', '2026-10-01')`)
  addCatalog.run('cat-a', 'Book', 'book', 'noun', 'noun', 'reading-material', 'bound pages', 'A1')
  assert.throws(() => addCatalog.run('cat-duplicate', 'Book', 'book', 'noun', 'noun', 'reading-material', 'bound pages', 'A1'), /UNIQUE/)
  addCatalog.run('cat-b', 'Book', 'book', 'noun', 'noun', 'financial-institution', 'place to keep money', null)
  addCatalog.run('cat-c', 'Book', 'book', 'verb', 'verb', 'reserve', 'to arrange in advance', null)
  assert.throws(() => addCatalog.run('cat-c1', 'Book', 'book', 'noun', 'noun', 'reading-material', 'bound pages', 'C1'), /CHECK/)
  assert.throws(() => addCatalog.run('cat-c2', 'Book', 'book', 'noun', 'noun', 'reading-material', 'bound pages', 'C2'), /CHECK/)
  assert.deepEqual({ ...db.prepare(`SELECT source_dataset, source_version, provenance, zh_tw_definition,
    english_example, zh_tw_example_translation, irish_usage FROM vocabulary_catalog WHERE id = 'cat-a'`).get() }, {
    source_dataset: 'test-catalog', source_version: '1', provenance: 'test attribution',
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
    (id, user_id, card_type, created_at, updated_at, vocabulary_catalog_id)
    VALUES (?, ?, 'vocabulary', '2026-10-01', '2026-10-01', ?)`)
  addCard.run('card-a', 'one', 'cat-a')
  assert.throws(() => addCard.run('retry', 'one', 'cat-a'), /UNIQUE/)
  assert.throws(() => addCard.run('missing-catalog', 'three', 'missing'), /FOREIGN KEY/)
  db.prepare(`INSERT INTO user_vocabulary_items (id, user_id, headword, normalized_key, created_at, updated_at)
    VALUES ('personal-book', 'one', 'Book', 'book', '2026-10-01', '2026-10-01')`).run()
  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM user_vocabulary_items').get().count, 1,
    'legacy personal entries remain archived independently from cards')
  addCard.run('card-b', 'two', 'cat-a')
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

test('0005 and 0006 preserve existing users, catalog, cards, reviews, settings and source data', () => {
  const db = new DatabaseSync(':memory:')
  db.exec('PRAGMA foreign_keys = ON')
  const migrations = readdirSync('migrations').filter(name => name.endsWith('.sql')).sort()
  for (const name of migrations.slice(0, 4)) db.exec(readFileSync(join('migrations', name), 'utf8'))
  db.exec(`INSERT INTO users (id, username, display_name, password_salt, password_digest, created_at, updated_at)
      VALUES ('owner', 'owner', 'Existing Owner', 'salt', 'digest', '2026-10-01', '2026-10-01');
    INSERT INTO user_settings (user_id, timezone, created_at, updated_at, english_level)
      VALUES ('owner', 'Europe/London', '2026-10-01', '2026-10-01', 'B1');
    INSERT INTO user_stats (user_id, streak_days, longest_streak, total_cards_created, total_reviews, updated_at)
      VALUES ('owner', 3, 5, 2, 4, '2026-10-02');
    INSERT INTO source_items (id, user_id, source_type, raw_text, processing_status, ai_model, created_at, updated_at)
      VALUES ('source', 'owner', 'image', '{"onboarding":"preserved"}', 'processed', 'fixture', '2026-10-01', '2026-10-01');
    INSERT INTO vocabulary_catalog (id, headword, normalized_key, part_of_speech, cefr_level,
      source_dataset, source_version, provenance, zh_tw_definition, english_example,
      zh_tw_example_translation, created_at, updated_at)
      VALUES ('source-cat', 'book', 'book', 'noun', 'A1', 'CEFR-J Vocabulary Profile', 'test-v1',
        'published fixture', '書本', 'I read a book.', '我讀了一本書。', '2026-10-01', '2026-10-01');
    INSERT INTO user_vocabulary_items (id, user_id, headword, normalized_key, part_of_speech,
      zh_tw_definition, english_example, zh_tw_example_translation, source, created_at, updated_at)
      VALUES ('personal', 'owner', 'bank', 'bank', 'noun', '河岸', 'We sat on the bank.', '我們坐在河岸上。',
        'image', '2026-10-01', '2026-10-01');
    INSERT INTO flashcards (id, user_id, source_item_id, card_type, is_favorite, last_reviewed_at,
      created_at, updated_at, vocabulary_catalog_id, vocabulary_key)
      VALUES ('catalog-card', 'owner', 'source', 'vocabulary', 1, '2026-10-02', '2026-10-01', '2026-10-02', 'source-cat', 'book');
    INSERT INTO flashcards (id, user_id, source_item_id, card_type, is_favorite, last_reviewed_at,
      created_at, updated_at, user_vocabulary_item_id, vocabulary_key)
      VALUES ('personal-card', 'owner', 'source', 'vocabulary', 1, '2026-10-02', '2026-10-01', '2026-10-02', 'personal', 'bank');
    INSERT INTO flashcards (id, user_id, card_type, front_content, back_content, created_at, updated_at)
      VALUES ('error-card', 'owner', 'error_log', 'wrong', 'right', '2026-10-01', '2026-10-01');
    INSERT INTO review_events (id, client_event_id, user_id, card_id, review_result, reviewed_at, created_at)
      VALUES ('review-1', 'event-1', 'owner', 'catalog-card', 'remembered', '2026-10-02', '2026-10-02'),
        ('review-2', 'event-2', 'owner', 'personal-card', 'forgot', '2026-10-02', '2026-10-02');`)
  db.exec(readFileSync(join('migrations', '0005_canonical_sense_aware_vocabulary.sql'), 'utf8'))

  assert.deepEqual(db.prepare('SELECT id, display_name FROM users').all().map(row => ({ ...row })), [{ id: 'owner', display_name: 'Existing Owner' }])
  assert.deepEqual({ ...db.prepare('SELECT english_level, timezone FROM user_settings WHERE user_id = ?').get('owner') },
    { english_level: 'B1', timezone: 'Europe/London' })
  assert.deepEqual({ ...db.prepare('SELECT streak_days, longest_streak, total_cards_created, total_reviews FROM user_stats WHERE user_id = ?').get('owner') },
    { streak_days: 3, longest_streak: 5, total_cards_created: 2, total_reviews: 4 })
  assert.equal({ ...db.prepare('SELECT raw_text FROM source_items WHERE id = ?').get('source') }.raw_text, '{"onboarding":"preserved"}')
  assert.deepEqual({ ...db.prepare('SELECT id, canonical_catalog_id, zh_tw_definition FROM vocabulary_catalog_sources WHERE id = ?').get('source-cat') },
    { id: 'source-cat', canonical_catalog_id: 'source-cat', zh_tw_definition: '書本' })
  assert.deepEqual({ ...db.prepare(`SELECT card.id, card.vocabulary_catalog_id, card.is_favorite, card.last_reviewed_at,
      catalog.zh_tw_definition FROM flashcards AS card JOIN vocabulary_catalog AS catalog
      ON catalog.id = card.vocabulary_catalog_id WHERE card.id = 'catalog-card'`).get() },
    { id: 'catalog-card', vocabulary_catalog_id: 'source-cat', is_favorite: 1, last_reviewed_at: '2026-10-02', zh_tw_definition: '書本' })
  assert.deepEqual({ ...db.prepare(`SELECT card.id, card.vocabulary_catalog_id, card.is_favorite, catalog.owner_user_id,
      catalog.zh_tw_definition FROM flashcards AS card JOIN vocabulary_catalog AS catalog
      ON catalog.id = card.vocabulary_catalog_id WHERE card.id = 'personal-card'`).get() },
    { id: 'personal-card', vocabulary_catalog_id: 'legacy-personal', is_favorite: 1,
      owner_user_id: 'owner', zh_tw_definition: '河岸' })
  assert.deepEqual(db.prepare('SELECT id, review_result FROM review_events ORDER BY id').all().map(row => ({ ...row })),
    [{ id: 'review-1', review_result: 'remembered' }, { id: 'review-2', review_result: 'forgot' }])
  assert.deepEqual({ ...db.prepare('SELECT id, front_content, back_content FROM flashcards WHERE id = ?').get('error-card') },
    { id: 'error-card', front_content: 'wrong', back_content: 'right' })
  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM user_vocabulary_items WHERE id = ?').get('personal').count, 1)
  assert.equal(db.prepare('PRAGMA table_info(flashcards)').all().some(column => column.name === 'vocabulary_key'), false)
  const preserved = {
    user: { ...db.prepare("SELECT id, display_name FROM users WHERE id = 'owner'").get() },
    settings: { ...db.prepare("SELECT user_id, timezone, english_level FROM user_settings WHERE user_id = 'owner'").get() },
    source: { ...db.prepare("SELECT id, raw_text FROM source_items WHERE id = 'source'").get() },
    cards: db.prepare("SELECT id, user_id, is_favorite FROM flashcards WHERE user_id = 'owner' ORDER BY id").all().map(row => ({ ...row })),
    reviews: db.prepare("SELECT id, client_event_id, card_id FROM review_events WHERE user_id = 'owner' ORDER BY id").all().map(row => ({ ...row })),
  }
  db.exec(readFileSync(join('migrations', '0006_durable_image_vocabulary_jobs.sql'), 'utf8'))
  assert.deepEqual({
    user: { ...db.prepare("SELECT id, display_name FROM users WHERE id = 'owner'").get() },
    settings: { ...db.prepare("SELECT user_id, timezone, english_level FROM user_settings WHERE user_id = 'owner'").get() },
    source: { ...db.prepare("SELECT id, raw_text FROM source_items WHERE id = 'source'").get() },
    cards: db.prepare("SELECT id, user_id, is_favorite FROM flashcards WHERE user_id = 'owner' ORDER BY id").all().map(row => ({ ...row })),
    reviews: db.prepare("SELECT id, client_event_id, card_id FROM review_events WHERE user_id = 'owner' ORDER BY id").all().map(row => ({ ...row })),
  }, preserved)
  assert.equal(db.prepare("SELECT usage_patterns FROM vocabulary_catalog WHERE id = 'source-cat'").get().usage_patterns, '[]')
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
