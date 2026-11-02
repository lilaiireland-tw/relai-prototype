import type { PersistenceDatabase, PersistenceStatement } from './d1'
import type { EnglishLevel } from './types'

export const STARTER_BATCH_SIZE = 100
// 47 associations use 99 bindings, within D1's 100-parameter query limit.
const STARTER_INSERT_SIZE = 47
const SOURCE_DATASET = 'CEFR-J Vocabulary Profile'
const SOURCE_VERSION = '1.6'
export const ENGLISH_LEVELS = ['A1', 'A2', 'B1', 'B2'] as const
export type { EnglishLevel } from './types'

type StarterResult =
  | { kind: 'created' | 'repeat'; english_level: EnglishLevel; starter_cards_created: number }
  | { kind: 'different_level'; english_level: EnglishLevel }
  | { kind: 'catalog_unavailable' }

interface SettingsLevel { english_level: EnglishLevel | null }
interface CatalogIdentity { id: string }

/** Initial level selection only. The claim and materialization are one D1 transaction. */
export async function bootstrapStarterPack(
  db: PersistenceDatabase, userId: string, level: EnglishLevel, at: string,
): Promise<StarterResult> {
  if (!db.batch) throw new Error('D1 batch is required for starter bootstrap.')

  const current = await db.prepare('SELECT english_level FROM user_settings WHERE user_id = ?')
    .bind(userId).first<SettingsLevel>()
  if (current?.english_level) {
    return current.english_level === level
      ? { kind: 'repeat', english_level: level, starter_cards_created: 0 }
      : { kind: 'different_level', english_level: current.english_level }
  }

  // Stable id tie-breaker gives each normalized key one deterministic catalog row.
  const candidates = await db.prepare(`WITH ranked AS (
      SELECT id, normalized_key,
        ROW_NUMBER() OVER (PARTITION BY normalized_key ORDER BY id) AS key_rank
      FROM vocabulary_catalog
      WHERE source_dataset = ? AND source_version = ? AND cefr_level = ?
    ) SELECT id FROM ranked WHERE key_rank = 1
      ORDER BY normalized_key, id LIMIT ?`)
    .bind(SOURCE_DATASET, SOURCE_VERSION, level, STARTER_BATCH_SIZE).all<CatalogIdentity>()
  if (!candidates.success) throw new Error('Could not select CEFR-J starter entries.')
  if (candidates.results.length === 0) return { kind: 'catalog_unavailable' }

  const ids = candidates.results.map(({ id }) => [id, crypto.randomUUID()] as const)
  const statements: PersistenceStatement[] = []
  const insertIndexes: number[] = []
  // D1 batch makes the level claim and all card inserts one transaction.
  for (let offset = 0; offset < ids.length; offset += STARTER_INSERT_SIZE) {
    const chunk = ids.slice(offset, offset + STARTER_INSERT_SIZE)
    const values = chunk.map(() => '(?, ?)').join(', ')
    insertIndexes.push(statements.length)
    statements.push(db.prepare(`WITH chosen(catalog_id, card_id) AS (VALUES ${values})
      INSERT INTO flashcards (id, user_id, card_type, vocabulary_catalog_id,
        vocabulary_key, created_at, updated_at)
      SELECT chosen.card_id, ?, 'vocabulary', catalog.id, catalog.normalized_key, ?, ?
      FROM chosen JOIN vocabulary_catalog AS catalog ON catalog.id = chosen.catalog_id
      WHERE NOT EXISTS (
        SELECT 1 FROM user_settings WHERE user_id = ? AND english_level IS NOT NULL
      ) AND NOT EXISTS (
        SELECT 1 FROM flashcards AS owned WHERE owned.user_id = ?
          AND owned.card_type = 'vocabulary' AND owned.vocabulary_key = catalog.normalized_key
      ) ON CONFLICT DO NOTHING`)
      .bind(...chunk.flat(), userId, at, at, userId, userId))
    // changes() belongs to the immediately preceding INSERT.
    statements.push(db.prepare(`INSERT INTO user_stats (user_id, total_cards_created, updated_at)
      SELECT ?, changes(), ? WHERE changes() > 0
      ON CONFLICT(user_id) DO UPDATE SET
        total_cards_created = user_stats.total_cards_created + excluded.total_cards_created,
        updated_at = excluded.updated_at`).bind(userId, at))
  }
  const claimIndex = statements.length
  statements.push(db.prepare(`INSERT INTO user_settings (user_id, timezone, english_level, created_at, updated_at)
    VALUES (?, 'UTC', ?, ?, ?)
    ON CONFLICT(user_id) DO UPDATE SET english_level = excluded.english_level,
      updated_at = excluded.updated_at WHERE user_settings.english_level IS NULL`)
    .bind(userId, level, at, at))
  const results = await db.batch(statements)
  if (results.length !== statements.length || results.some(result => !result.success)) {
    throw new Error('Starter bootstrap batch failed.')
  }
  const chosenLevel = await db.prepare('SELECT english_level FROM user_settings WHERE user_id = ?')
    .bind(userId).first<SettingsLevel>()
  if (!chosenLevel?.english_level) throw new Error('Starter level was not persisted.')
  if (chosenLevel.english_level !== level) {
    return { kind: 'different_level', english_level: chosenLevel.english_level }
  }
  return results[claimIndex].meta.changes === 1
    ? { kind: 'created', english_level: level,
      starter_cards_created: insertIndexes.reduce((count, index) => count + results[index].meta.changes, 0) }
    : { kind: 'repeat', english_level: level, starter_cards_created: 0 }
}
