import type { PersistenceDatabase, PersistenceStatement } from './d1'
import type { VocabularySuggestion } from '../services/vocabulary-image'

interface CatalogItem {
  id: string
  normalized_key: string
  part_of_speech: string | null
  zh_tw_definition: string | null
  english_example: string | null
  zh_tw_example_translation: string | null
}
type SaveResult = {
  headword: string
  status: 'saved' | 'already_saved' | 'pending'
  reason?: 'definition_missing' | 'definition_mismatch' | 'content_incomplete' | 'catalog_ambiguous' | 'catalog_changed'
  catalog_definition?: string | null
}
interface PlannedSave {
  item: VocabularySuggestion
  key: string
  catalog: CatalogItem | null
  resultIndex: number
}

export async function saveVocabulary(
  db: PersistenceDatabase, userId: string, sourceItemId: string, items: VocabularySuggestion[], at: string,
): Promise<SaveResult[]> {
  if (!db.batch) throw new Error('D1 batch is required to save vocabulary.')
  const results: SaveResult[] = []
  const planned: PlannedSave[] = []
  const seen = new Set<string>()

  for (const item of items) {
    const key = item.headword.trim().toLowerCase()
    if (seen.has(key)) {
      results.push({ headword: item.headword, status: 'already_saved' })
      continue
    }
    seen.add(key)
    const owned = await db.prepare('SELECT id FROM flashcards WHERE user_id = ? AND vocabulary_key = ?')
      .bind(userId, key).first<{ id: string }>()
    if (owned) {
      results.push({ headword: item.headword, status: 'already_saved' })
      continue
    }
    const matches = await db.prepare(`SELECT id, normalized_key, part_of_speech, zh_tw_definition,
        english_example, zh_tw_example_translation FROM vocabulary_catalog WHERE normalized_key = ? ORDER BY id`)
      .bind(key).all<CatalogItem>()
    if (!matches.success) throw new Error('Could not inspect vocabulary catalog matches.')
    const partOfSpeechMatches = matches.results.filter(match => match.part_of_speech === item.part_of_speech)
    let catalog: CatalogItem | null = null
    if (partOfSpeechMatches.length) {
      const complete = partOfSpeechMatches.filter(match => match.zh_tw_definition?.trim() &&
        match.english_example?.trim() && match.zh_tw_example_translation?.trim())
      if (!complete.length) {
        results.push({ headword: item.headword, status: 'pending',
          reason: partOfSpeechMatches.some(match => !match.zh_tw_definition?.trim()) ? 'definition_missing' : 'content_incomplete',
          catalog_definition: partOfSpeechMatches[0].zh_tw_definition })
        continue
      }
      if (new Set(complete.map(({ zh_tw_definition, english_example, zh_tw_example_translation }) =>
        JSON.stringify([zh_tw_definition, english_example, zh_tw_example_translation]))).size > 1) {
        results.push({ headword: item.headword, status: 'pending', reason: 'catalog_ambiguous',
          catalog_definition: complete[0].zh_tw_definition })
        continue
      }
      catalog = complete[0]
    }
    planned.push({ item, key, catalog, resultIndex: results.length })
    results.push({ headword: item.headword, status: 'pending' })
  }

  if (planned.length === 0) return results
  const statements: PersistenceStatement[] = []
  const inserts: { plan: PlannedSave; index: number }[] = []
  for (const plan of planned) {
    const { item, key, catalog } = plan
    if (catalog) {
      statements.push(db.prepare(`INSERT INTO flashcards (id, user_id, source_item_id, card_type,
        vocabulary_catalog_id, vocabulary_key, created_at, updated_at)
        SELECT ?, ?, ?, 'vocabulary', id, normalized_key, ?, ? FROM vocabulary_catalog
        WHERE id = ? AND normalized_key = ? AND part_of_speech = ?
          AND NULLIF(TRIM(zh_tw_definition), '') IS NOT NULL AND NULLIF(TRIM(english_example), '') IS NOT NULL
          AND NULLIF(TRIM(zh_tw_example_translation), '') IS NOT NULL ON CONFLICT DO NOTHING`)
        .bind(crypto.randomUUID(), userId, sourceItemId, at, at, catalog.id, key, item.part_of_speech))
    } else {
      statements.push(db.prepare(`INSERT INTO user_vocabulary_items (id, user_id, headword, normalized_key,
        part_of_speech, zh_tw_definition, english_example, zh_tw_example_translation, source, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'Gemini image extraction', ?, ?)
        ON CONFLICT(user_id, normalized_key) DO NOTHING`)
        .bind(crypto.randomUUID(), userId, item.headword, key, item.part_of_speech,
          item.zh_tw_definition, item.english_example, item.zh_tw_example_translation, at, at))
      statements.push(db.prepare(`INSERT INTO flashcards (id, user_id, source_item_id, card_type,
        user_vocabulary_item_id, vocabulary_key, created_at, updated_at)
        SELECT ?, ?, ?, 'vocabulary', id, normalized_key, ?, ? FROM user_vocabulary_items
        WHERE user_id = ? AND normalized_key = ? ON CONFLICT DO NOTHING`)
        .bind(crypto.randomUUID(), userId, sourceItemId, at, at, userId, key))
    }
    const cardIndex = statements.length - 1
    inserts.push({ plan, index: cardIndex })
    statements.push(db.prepare(`INSERT INTO user_stats (user_id, total_cards_created, updated_at)
      SELECT ?, changes(), ? WHERE changes() > 0
      ON CONFLICT(user_id) DO UPDATE SET
        total_cards_created = user_stats.total_cards_created + excluded.total_cards_created,
        updated_at = excluded.updated_at`).bind(userId, at))
  }

  const batch = await db.batch(statements)
  if (batch.length !== statements.length || batch.some(result => !result.success)) {
    throw new Error('Vocabulary save batch failed.')
  }
  for (const { plan, index } of inserts) {
    if (batch[index].meta.changes > 0) {
      results[plan.resultIndex] = { headword: plan.item.headword, status: 'saved' }
      continue
    }
    const owned = await db.prepare('SELECT id FROM flashcards WHERE user_id = ? AND vocabulary_key = ?')
      .bind(userId, plan.key).first<{ id: string }>()
    results[plan.resultIndex] = owned
      ? { headword: plan.item.headword, status: 'already_saved' }
      : { headword: plan.item.headword, status: 'pending', reason: 'catalog_changed',
        catalog_definition: plan.catalog?.zh_tw_definition ?? null }
  }
  return results
}
