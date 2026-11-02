import type { PersistenceDatabase, PersistenceStatement } from './d1'
import type { EnglishLevel } from './types'
import demoVocabulary from '../../../data/ai-enrichment/b1-sample-20.json'

export const STARTER_BATCH_SIZE = demoVocabulary.length
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
const DEMO_CARDS = demoVocabulary.map(row => ({ id: row.id, headword: row.headword,
  normalized_key: row.headword.trim().toLowerCase(), part_of_speech: row.part_of_speech }))

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

  const expected = DEMO_CARDS.map(() => '(?, ?, ?, ?)').join(', ')
  const candidates = await db.prepare(`WITH expected(id, headword, normalized_key, part_of_speech) AS (VALUES ${expected})
      SELECT catalog.id FROM expected JOIN vocabulary_catalog AS catalog
        ON catalog.id = expected.id AND catalog.headword = expected.headword
          AND catalog.normalized_key = expected.normalized_key AND catalog.part_of_speech = expected.part_of_speech
      WHERE catalog.source_dataset = ? AND catalog.source_version = ? AND catalog.cefr_level = 'B1'
        AND catalog.publication_status = 'published'
        AND NULLIF(TRIM(catalog.zh_tw_definition), '') IS NOT NULL
        AND NULLIF(TRIM(catalog.english_example), '') IS NOT NULL
        AND NULLIF(TRIM(catalog.zh_tw_example_translation), '') IS NOT NULL
      ORDER BY catalog.id`)
    .bind(...DEMO_CARDS.flatMap(row => [row.id, row.headword, row.normalized_key, row.part_of_speech]),
      SOURCE_DATASET, SOURCE_VERSION).all<CatalogIdentity>()
  if (!candidates.success) throw new Error('Could not select CEFR-J starter entries.')
  if (candidates.results.length !== STARTER_BATCH_SIZE) return { kind: 'catalog_unavailable' }

  const ids = candidates.results.map(({ id }) => [id, crypto.randomUUID()] as const)
  const values = ids.map(() => '(?, ?)').join(', ')
  const statements: PersistenceStatement[] = [
    db.prepare(`WITH chosen(catalog_id, card_id) AS (VALUES ${values})
      INSERT INTO flashcards (id, user_id, card_type, vocabulary_catalog_id, created_at, updated_at)
      SELECT chosen.card_id, ?, 'vocabulary', catalog.id, ?, ?
      FROM chosen JOIN vocabulary_catalog AS catalog ON catalog.id = chosen.catalog_id
      WHERE NOT EXISTS (
        SELECT 1 FROM user_settings WHERE user_id = ? AND english_level IS NOT NULL
      ) AND NOT EXISTS (
        SELECT 1 FROM flashcards AS owned WHERE owned.user_id = ?
          AND owned.card_type = 'vocabulary' AND owned.vocabulary_catalog_id = catalog.id
      ) ON CONFLICT DO NOTHING`)
      .bind(...ids.flat(), userId, at, at, userId, userId),
    db.prepare(`INSERT INTO user_stats (user_id, total_cards_created, updated_at)
      SELECT ?, changes(), ? WHERE changes() > 0
      ON CONFLICT(user_id) DO UPDATE SET
        total_cards_created = user_stats.total_cards_created + excluded.total_cards_created,
        updated_at = excluded.updated_at`).bind(userId, at),
    db.prepare(`INSERT INTO user_settings (user_id, timezone, english_level, created_at, updated_at)
    VALUES (?, 'UTC', ?, ?, ?)
    ON CONFLICT(user_id) DO UPDATE SET english_level = excluded.english_level,
      updated_at = excluded.updated_at WHERE user_settings.english_level IS NULL`)
      .bind(userId, level, at, at),
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
  return results[2].meta.changes === 1
    ? { kind: 'created', english_level: level,
      starter_cards_created: results[0].meta.changes }
    : { kind: 'repeat', english_level: level, starter_cards_created: 0 }
}
