import type { PersistenceDatabase } from './d1'
import type { EnglishLevel } from './types'

export const STARTER_BATCH_SIZE = 100
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

  // Choose exactly one catalog row per personal vocabulary_key. The tie-breaker is
  // stable catalog id, so repeated or concurrent requests see the same bounded pack.
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
  const values = ids.map(() => '(?, ?)').join(', ')
  const statements = [
    db.prepare(`INSERT INTO user_settings (user_id, timezone, english_level, created_at, updated_at)
      VALUES (?, 'UTC', ?, ?, ?)
      ON CONFLICT(user_id) DO UPDATE SET english_level = excluded.english_level,
        updated_at = excluded.updated_at WHERE user_settings.english_level IS NULL`)
      .bind(userId, level, at, at),
    db.prepare(`WITH chosen(catalog_id, card_id) AS (VALUES ${values})
      INSERT INTO flashcards (id, user_id, card_type, front_content, back_content,
        part_of_speech, zh_tw_definition, explanation, irish_usage, source,
        vocabulary_catalog_id, vocabulary_key, created_at, updated_at)
      SELECT chosen.card_id, ?, 'vocabulary', catalog.headword,
        COALESCE(catalog.zh_tw_definition || char(10), '') ||
        COALESCE(catalog.english_example,
          'CEFR-J ' || catalog.cefr_level || COALESCE(' · ' || catalog.part_of_speech, '')) ||
        COALESCE(char(10) || catalog.zh_tw_example_translation, ''),
        catalog.part_of_speech, catalog.zh_tw_definition, NULL, catalog.irish_usage,
        catalog.source_dataset || ' ' || catalog.source_version,
        catalog.id, catalog.normalized_key, ?, ?
      FROM chosen JOIN vocabulary_catalog AS catalog ON catalog.id = chosen.catalog_id
      WHERE changes() = 1 AND NOT EXISTS (
        SELECT 1 FROM flashcards AS owned WHERE owned.user_id = ?
          AND owned.card_type = 'vocabulary' AND owned.vocabulary_key = catalog.normalized_key
      ) ON CONFLICT DO NOTHING`)
      .bind(...ids.flat(), userId, at, at, userId),
    db.prepare(`INSERT INTO user_stats (user_id, total_cards_created, updated_at)
      SELECT ?, changes(), ? WHERE changes() > 0
      ON CONFLICT(user_id) DO UPDATE SET
        total_cards_created = user_stats.total_cards_created + excluded.total_cards_created,
        updated_at = excluded.updated_at`).bind(userId, at),
  ]
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
  return results[0].meta.changes === 1
    ? { kind: 'created', english_level: level, starter_cards_created: results[1].meta.changes }
    : { kind: 'repeat', english_level: level, starter_cards_created: 0 }
}
