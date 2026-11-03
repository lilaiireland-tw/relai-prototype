import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { test } from 'node:test'
import { DatabaseSync } from 'node:sqlite'

test('runtime COUNT queries use their user-scoped indexes on isolated SQLite', () => {
  const db = new DatabaseSync(':memory:')
  try {
    for (const migration of readdirSync('migrations').filter((name) => name.endsWith('.sql')).sort()) {
      db.exec(readFileSync(join('migrations', migration), 'utf8'))
    }
    const plan = (sql) => db.prepare(`EXPLAIN QUERY PLAN ${sql}`).all().map((row) => row.detail).join('\n')
    assert.match(plan('SELECT COUNT(*) FROM flashcards WHERE user_id = ?'), /idx_flashcards_user_id_/)
    assert.match(plan('SELECT COUNT(*) FROM review_events WHERE user_id = ? AND reviewed_at >= ? AND reviewed_at < ?'),
      /idx_review_events_user_id_reviewed_at/)
    assert.match(plan(`SELECT id, username, display_name, role, is_active, cohort_source, created_at, updated_at, last_login_at
      FROM users ORDER BY username LIMIT 1001`), /USING INDEX sqlite_autoindex_users/)
    assert.match(plan(`SELECT id, owner_user_id, created_at FROM vocabulary_catalog_candidates
      WHERE status = ? ORDER BY created_at, id`), /idx_vocabulary_catalog_candidates_review/)
    assert.match(plan(`SELECT source_version FROM vocabulary_catalog_sources
      WHERE source_dataset = ? AND source_version < ?
      UNION ALL
      SELECT source_version FROM vocabulary_catalog_sources
      WHERE source_dataset = ? AND source_version > ?
      LIMIT 1`), /idx_vocabulary_catalog_sources_source_identity/)
  } finally {
    db.close()
  }
})
