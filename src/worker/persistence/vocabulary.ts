import type { PersistenceDatabase, PersistenceStatement } from './d1'
import { lexicalFields, normalizeSense, vocabularyContentHash, type CatalogRecord, type LexicalContent, type LexicalField, type VocabularyPlan } from '../services/vocabulary-catalog'

type MaybeLexicalContent = Record<LexicalField, string | null | undefined>

export type VocabularySaveResult = {
  headword: string
  status: 'saved' | 'already_saved' | 'review_needed'
  candidate_id?: string
  reason?: 'ambiguous_sense' | 'low_confidence' | 'validation_failed' | 'catalog_conflict' | 'catalog_changed'
}

function contentOf(row: Pick<CatalogRecord, LexicalField>): MaybeLexicalContent {
  return {
    zh_tw_definition: row.zh_tw_definition,
    english_example: row.english_example,
    zh_tw_example_translation: row.zh_tw_example_translation,
  }
}

function complete(content: Partial<MaybeLexicalContent>) {
  return Boolean(content.zh_tw_definition?.trim() && content.english_example?.trim() &&
    content.zh_tw_example_translation?.trim())
}

function sameContent(a: Partial<MaybeLexicalContent>, b: Partial<MaybeLexicalContent>) {
  return a.zh_tw_definition === b.zh_tw_definition && a.english_example === b.english_example &&
    a.zh_tw_example_translation === b.zh_tw_example_translation
}

function candidateInsert(db: PersistenceDatabase, plan: VocabularyPlan, userId: string,
  sourceItemId: string, at: string, targetCatalogId = plan.target_catalog_id) {
  return db.prepare(`INSERT INTO vocabulary_catalog_candidates (id, owner_user_id, source_item_id,
    headword, normalized_key, part_of_speech, part_of_speech_key, sense_key, semantic_sense, source_context,
    target_catalog_id, zh_tw_definition, english_example, zh_tw_example_translation, status, model,
    prompt_version, validation_status, validation_confidence, provenance, content_hash, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'review_needed', ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(owner_user_id, source_item_id, normalized_key, part_of_speech_key, sense_key) DO NOTHING`)
    .bind(crypto.randomUUID(), userId, sourceItemId, plan.item.headword, plan.normalized_key,
      plan.item.part_of_speech, plan.part_of_speech_key, plan.sense_key, plan.item.semantic_sense,
      plan.item.source_context, targetCatalogId, plan.content.zh_tw_definition ?? null,
      plan.content.english_example ?? null, plan.content.zh_tw_example_translation ?? null,
      plan.model, plan.prompt_version, plan.validation_status, plan.validation_confidence,
      plan.provenance, plan.content_hash, at, at)
}

export async function saveVocabulary(
  db: PersistenceDatabase, userId: string, sourceItemId: string, plans: VocabularyPlan[], at: string,
): Promise<VocabularySaveResult[]> {
  if (!db.batch) throw new Error('D1 batch is required to save vocabulary.')
  const results: VocabularySaveResult[] = Array(plans.length)
  const statements: PersistenceStatement[] = []

  for (const [planIndex, plan] of plans.entries()) {
    if (plan.kind === 'review_needed') {
      statements.push(candidateInsert(db, plan, userId, sourceItemId, at))
      results[planIndex] = { headword: plan.item.headword, status: 'review_needed', reason: plan.reason ?? 'ambiguous_sense' }
      continue
    }

    if (plan.target_catalog_id) {
      const catalog = plan.catalog
      if (!catalog) throw new Error('Catalog enrichment target was not loaded.')
      const isIncomplete = !complete(contentOf(catalog))
      if (isIncomplete) {
        const content = plan.content as LexicalContent
        const hash = plan.content_hash ?? await vocabularyContentHash(content)
        statements.push(db.prepare(`UPDATE vocabulary_catalog SET
          zh_tw_definition = COALESCE(NULLIF(TRIM(zh_tw_definition), ''), ?),
          english_example = COALESCE(NULLIF(TRIM(english_example), ''), ?),
          zh_tw_example_translation = COALESCE(NULLIF(TRIM(zh_tw_example_translation), ''), ?),
          content_version = content_version + 1, content_hash = ?, provenance = ?, model = ?, prompt_version = ?, updated_at = ?
          WHERE id = ? AND publication_status = 'published' AND content_version = ?
            AND (NULLIF(TRIM(zh_tw_definition), '') IS NULL OR NULLIF(TRIM(english_example), '') IS NULL
              OR NULLIF(TRIM(zh_tw_example_translation), '') IS NULL)`)
          .bind(content.zh_tw_definition, content.english_example, content.zh_tw_example_translation,
            hash, plan.provenance, plan.model, plan.prompt_version, at, catalog.id, catalog.content_version))
        statements.push(db.prepare(`INSERT INTO vocabulary_catalog_versions (id, catalog_id, version, content_hash,
          zh_tw_definition, english_example, zh_tw_example_translation, irish_usage, provenance, model, prompt_version, created_at)
          SELECT ?, id, content_version, content_hash, zh_tw_definition, english_example,
            zh_tw_example_translation, irish_usage, provenance, model, prompt_version, ?
          FROM vocabulary_catalog WHERE id = ? AND changes() > 0`)
          .bind(crypto.randomUUID(), at, catalog.id))
      } else {
        continue
      }
      continue
    }

    const id = crypto.randomUUID()
    const content = plan.content as LexicalContent
    const hash = plan.content_hash ?? await vocabularyContentHash(content)
    statements.push(db.prepare(`INSERT INTO vocabulary_catalog (id, headword, normalized_key, part_of_speech,
      part_of_speech_key, sense_key, semantic_sense, cefr_level, source_dataset, source_version,
      provenance, zh_tw_definition, english_example, zh_tw_example_translation, publication_status,
      owner_user_id, model, prompt_version, content_version, content_hash, published_at, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, NULL, 'gemini-ai', ?, ?, ?, ?, ?, 'published', NULL, ?, ?, 1, ?, ?, ?, ?)
      ON CONFLICT DO NOTHING`)
      .bind(id, plan.item.headword, plan.normalized_key, plan.item.part_of_speech, plan.part_of_speech_key,
        plan.sense_key, plan.item.semantic_sense, plan.prompt_version,
        plan.provenance, content.zh_tw_definition, content.english_example, content.zh_tw_example_translation,
        plan.model, plan.prompt_version, hash, at, at, at))
    statements.push(db.prepare(`INSERT INTO vocabulary_catalog_versions (id, catalog_id, version, content_hash,
      zh_tw_definition, english_example, zh_tw_example_translation, irish_usage, provenance, model, prompt_version, created_at)
      SELECT ?, id, content_version, content_hash, zh_tw_definition, english_example,
        zh_tw_example_translation, irish_usage, provenance, model, prompt_version, ?
      FROM vocabulary_catalog WHERE id = ? AND changes() > 0`)
      .bind(crypto.randomUUID(), at, id))
  }

  if (statements.length) {
    const batch = await db.batch(statements)
    if (batch.length !== statements.length || batch.some(result => !result.success)) {
      throw new Error('Vocabulary catalog write batch failed.')
    }
  }

  for (const [index, plan] of plans.entries()) {
    if (plan.kind !== 'review_needed') continue
    const candidate = await db.prepare(`SELECT id FROM vocabulary_catalog_candidates WHERE owner_user_id = ?
      AND source_item_id = ? AND normalized_key = ? AND part_of_speech_key = ? AND sense_key = ?`)
      .bind(userId, sourceItemId, plan.normalized_key, plan.part_of_speech_key, plan.sense_key).first<{ id: string }>()
    if (!candidate) throw new Error('Vocabulary review candidate could not be stored.')
    results[index] = { ...results[index], candidate_id: candidate.id }
  }

  const cards: { plan: VocabularyPlan; resultIndex: number; catalogId: string; index: number }[] = []
  for (const [planIndex, plan] of plans.entries()) {
    if (plan.kind !== 'ready') continue
    const row = plan.target_catalog_id
      ? await db.prepare(`SELECT id, publication_status, zh_tw_definition, english_example, zh_tw_example_translation
          FROM vocabulary_catalog WHERE id = ?`).bind(plan.target_catalog_id).first<{
          id: string; publication_status: string; zh_tw_definition: string | null;
          english_example: string | null; zh_tw_example_translation: string | null
        }>()
      : await db.prepare(`SELECT id, publication_status, zh_tw_definition, english_example, zh_tw_example_translation
          FROM vocabulary_catalog WHERE normalized_key = ? AND part_of_speech_key = ? AND sense_key = ?
            AND publication_status = 'published'`).bind(plan.normalized_key, plan.part_of_speech_key, plan.sense_key).first<{
          id: string; publication_status: string; zh_tw_definition: string | null;
          english_example: string | null; zh_tw_example_translation: string | null
        }>()
    if (!row || row.publication_status !== 'published' || !complete(contentOf(row))) {
      const reviewPlan: VocabularyPlan = { ...plan, kind: 'review_needed', target_catalog_id: row?.id ?? null,
        reason: 'catalog_changed', validation_status: 'review_needed' }
      const candidateId = await saveCandidate(db, reviewPlan, userId, sourceItemId, at)
      results[planIndex] = { headword: plan.item.headword, status: 'review_needed',
        candidate_id: candidateId, reason: 'catalog_changed' }
      continue
    }
    if (plan.target_catalog_id && writeConflict(plan, row)) {
      const reviewPlan: VocabularyPlan = { ...plan, kind: 'review_needed', target_catalog_id: row.id,
        reason: 'catalog_conflict', validation_status: 'review_needed' }
      const candidateId = await saveCandidate(db, reviewPlan, userId, sourceItemId, at)
      results[planIndex] = { headword: plan.item.headword, status: 'review_needed',
        candidate_id: candidateId, reason: 'catalog_conflict' }
      continue
    }
    if (!plan.target_catalog_id && !sameContent(contentOf(row), plan.content)) {
      const reviewPlan: VocabularyPlan = { ...plan, kind: 'review_needed', target_catalog_id: row.id,
        reason: 'catalog_conflict', validation_status: 'review_needed' }
      const candidateId = await saveCandidate(db, reviewPlan, userId, sourceItemId, at)
      results[planIndex] = { headword: plan.item.headword, status: 'review_needed',
        candidate_id: candidateId, reason: 'catalog_conflict' }
      continue
    }
    const owned = await db.prepare('SELECT id FROM flashcards WHERE user_id = ? AND vocabulary_catalog_id = ?')
      .bind(userId, row.id).first<{ id: string }>()
    if (owned) {
      results[planIndex] = { headword: plan.item.headword, status: 'already_saved' }
      continue
    }
    const index = cards.length
    cards.push({ plan, resultIndex: planIndex, catalogId: row.id, index })
  }

  if (cards.length) {
    const cardStatements: PersistenceStatement[] = []
    for (const card of cards) {
      cardStatements.push(db.prepare(`INSERT INTO flashcards (id, user_id, source_item_id, card_type,
        vocabulary_catalog_id, created_at, updated_at)
        SELECT ?, ?, ?, 'vocabulary', id, ?, ? FROM vocabulary_catalog
        WHERE id = ? AND publication_status = 'published' AND ? = 1 ON CONFLICT DO NOTHING`)
        .bind(crypto.randomUUID(), userId, sourceItemId, at, at, card.catalogId,
          complete(card.plan.content) ? 1 : 0))
      cardStatements.push(db.prepare(`INSERT INTO user_stats (user_id, total_cards_created, updated_at)
        SELECT ?, changes(), ? WHERE changes() > 0
        ON CONFLICT(user_id) DO UPDATE SET
          total_cards_created = user_stats.total_cards_created + excluded.total_cards_created,
          updated_at = excluded.updated_at`).bind(userId, at))
    }
    const batch = await db.batch(cardStatements)
    if (batch.length !== cardStatements.length || batch.some(result => !result.success)) {
      throw new Error('Vocabulary flashcard batch failed.')
    }
    for (const card of cards) {
      if (batch[card.index * 2].meta.changes > 0) {
        results[card.resultIndex] = { headword: card.plan.item.headword, status: 'saved' }
      } else {
        const owned = await db.prepare('SELECT id FROM flashcards WHERE user_id = ? AND vocabulary_catalog_id = ?')
          .bind(userId, card.catalogId).first<{ id: string }>()
        if (owned) {
          results[card.resultIndex] = { headword: card.plan.item.headword, status: 'already_saved' }
        } else {
          const reviewPlan: VocabularyPlan = { ...card.plan, kind: 'review_needed',
            target_catalog_id: card.catalogId, reason: 'catalog_changed', validation_status: 'review_needed' }
          results[card.resultIndex] = { headword: card.plan.item.headword, status: 'review_needed',
            candidate_id: await saveCandidate(db, reviewPlan, userId, sourceItemId, at), reason: 'catalog_changed' }
        }
      }
    }
  }
  return results
}

function writeConflict(plan: VocabularyPlan, row: { zh_tw_definition: string | null; english_example: string | null;
  zh_tw_example_translation: string | null }) {
  const original: MaybeLexicalContent = plan.catalog ? contentOf(plan.catalog) : {
    zh_tw_definition: null, english_example: null, zh_tw_example_translation: null,
  }
  return (plan.content.zh_tw_definition !== original.zh_tw_definition &&
      row.zh_tw_definition !== plan.content.zh_tw_definition) ||
    (plan.content.english_example !== original.english_example && row.english_example !== plan.content.english_example) ||
    (plan.content.zh_tw_example_translation !== original.zh_tw_example_translation &&
      row.zh_tw_example_translation !== plan.content.zh_tw_example_translation)
}

async function saveCandidate(db: PersistenceDatabase, plan: VocabularyPlan, userId: string, sourceItemId: string, at: string) {
  await db.batch!([candidateInsert(db, plan, userId, sourceItemId, at)])
  const candidate = await db.prepare(`SELECT id FROM vocabulary_catalog_candidates WHERE owner_user_id = ?
    AND source_item_id = ? AND normalized_key = ? AND part_of_speech_key = ? AND sense_key = ?`)
    .bind(userId, sourceItemId, plan.normalized_key, plan.part_of_speech_key, plan.sense_key).first<{ id: string }>()
  if (!candidate) throw new Error('Vocabulary review candidate could not be stored.')
  return candidate.id
}

export interface VocabularyReviewCandidate {
  id: string
  owner_user_id: string
  headword: string
  part_of_speech: string
  semantic_sense: string
  source_context: string
  target_catalog_id: string | null
  zh_tw_definition: string | null
  english_example: string | null
  zh_tw_example_translation: string | null
  model: string
  validation_status: string
  validation_confidence: number | null
  created_at: string
}

export async function listVocabularyReviewCandidates(db: PersistenceDatabase) {
  const result = await db.prepare(`SELECT id, owner_user_id, headword, part_of_speech, semantic_sense,
    source_context, target_catalog_id, zh_tw_definition, english_example, zh_tw_example_translation,
    model, validation_status, validation_confidence, created_at FROM vocabulary_catalog_candidates
    WHERE status = 'review_needed' ORDER BY created_at, id`).all<VocabularyReviewCandidate>()
  if (!result.success) throw new Error('Could not read vocabulary review candidates.')
  return result.results
}

export type CandidateDecision =
  | { action: 'publish'; semantic_sense?: string; zh_tw_definition?: string; english_example?: string; zh_tw_example_translation?: string }
  | { action: 'reject' }

export type CandidateReviewResult =
  | { status: 'published'; catalog_id: string }
  | { status: 'rejected' }
  | { status: 'not_found' }
  | { status: 'incomplete' }
  | { status: 'conflict' }

export async function reviewVocabularyCandidate(
  db: PersistenceDatabase, candidateId: string, reviewerId: string, decision: CandidateDecision, at: string,
): Promise<CandidateReviewResult> {
  if (!db.batch) throw new Error('D1 batch is required to review vocabulary candidates.')
  const candidate = await db.prepare(`SELECT * FROM vocabulary_catalog_candidates
    WHERE id = ? AND status = 'review_needed'`).bind(candidateId).first<{
      id: string; owner_user_id: string; source_item_id: string; headword: string; normalized_key: string;
      part_of_speech: string; part_of_speech_key: string; sense_key: string; semantic_sense: string;
      source_context: string; target_catalog_id: string | null; zh_tw_definition: string | null;
      english_example: string | null; zh_tw_example_translation: string | null; model: string;
      prompt_version: string; provenance: string
    }>()
  if (!candidate) return { status: 'not_found' }
  if (decision.action === 'reject') {
    const result = await db.prepare(`UPDATE vocabulary_catalog_candidates SET status = 'rejected',
      reviewed_by = ?, reviewed_at = ?, updated_at = ? WHERE id = ? AND status = 'review_needed'`)
      .bind(reviewerId, at, at, candidateId).run()
    if (!result.success) throw new Error('Could not reject vocabulary candidate.')
    return { status: 'rejected' }
  }

  const content: LexicalContent = {
    zh_tw_definition: decision.zh_tw_definition ?? candidate.zh_tw_definition ?? '',
    english_example: decision.english_example ?? candidate.english_example ?? '',
    zh_tw_example_translation: decision.zh_tw_example_translation ?? candidate.zh_tw_example_translation ?? '',
  }
  if (!complete(content)) return { status: 'incomplete' }

  if (candidate.target_catalog_id) {
    const target = await db.prepare(`SELECT id, content_version, zh_tw_definition, english_example,
      zh_tw_example_translation, irish_usage, provenance, model, prompt_version FROM vocabulary_catalog
      WHERE id = ? AND publication_status = 'published'`).bind(candidate.target_catalog_id).first<{
        id: string; content_version: number; zh_tw_definition: string | null; english_example: string | null;
        zh_tw_example_translation: string | null; irish_usage: string | null; provenance: string;
        model: string | null; prompt_version: string | null
      }>()
    if (!target) return { status: 'conflict' }
    const current = contentOf(target)
    for (const field of lexicalFields) {
      if (current[field]?.trim() && current[field] !== content[field]) return { status: 'conflict' }
    }
    const finalContent = {
      zh_tw_definition: current.zh_tw_definition?.trim() ? current.zh_tw_definition : content.zh_tw_definition,
      english_example: current.english_example?.trim() ? current.english_example : content.english_example,
      zh_tw_example_translation: current.zh_tw_example_translation?.trim()
        ? current.zh_tw_example_translation : content.zh_tw_example_translation,
    }
    const hash = await vocabularyContentHash(finalContent)
    const reviewProvenance = JSON.stringify({ previous: target.provenance, reviewed_by: reviewerId,
      candidate_id: candidate.id, action: 'missing_fields_only' })
    const update = db.prepare(`UPDATE vocabulary_catalog SET
      zh_tw_definition = COALESCE(NULLIF(TRIM(zh_tw_definition), ''), ?),
      english_example = COALESCE(NULLIF(TRIM(english_example), ''), ?),
      zh_tw_example_translation = COALESCE(NULLIF(TRIM(zh_tw_example_translation), ''), ?),
      content_version = content_version + 1, content_hash = ?, provenance = ?, model = ?, prompt_version = ?, updated_at = ?
      WHERE id = ? AND publication_status = 'published' AND content_version = ?
        AND (NULLIF(TRIM(zh_tw_definition), '') IS NULL OR NULLIF(TRIM(english_example), '') IS NULL
          OR NULLIF(TRIM(zh_tw_example_translation), '') IS NULL)`)
      .bind(content.zh_tw_definition, content.english_example, content.zh_tw_example_translation,
        hash, reviewProvenance, candidate.model, candidate.prompt_version, at, target.id, target.content_version)
    const version = db.prepare(`INSERT INTO vocabulary_catalog_versions (id, catalog_id, version, content_hash,
      zh_tw_definition, english_example, zh_tw_example_translation, irish_usage, provenance, model, prompt_version, created_at)
      SELECT ?, id, content_version, content_hash, zh_tw_definition, english_example,
        zh_tw_example_translation, irish_usage, provenance, model, prompt_version, ?
      FROM vocabulary_catalog WHERE id = ? AND changes() > 0`)
      .bind(crypto.randomUUID(), at, target.id)
    const batch = await db.batch([update, version])
    if (batch.length !== 2 || batch.some(result => !result.success)) throw new Error('Vocabulary enrichment review failed.')
    const finalRow = await db.prepare(`SELECT zh_tw_definition, english_example, zh_tw_example_translation
      FROM vocabulary_catalog WHERE id = ?`).bind(target.id).first<MaybeLexicalContent>()
    if (!finalRow || !complete(finalRow) || !sameContent(finalRow, finalContent)) return { status: 'conflict' }
    const updateCandidate = await db.prepare(`UPDATE vocabulary_catalog_candidates SET status = 'published',
      catalog_id = ?, reviewed_by = ?, reviewed_at = ?, updated_at = ?
      WHERE id = ? AND status = 'review_needed'`).bind(target.id, reviewerId, at, at, candidate.id).run()
    if (!updateCandidate.success) throw new Error('Could not finish vocabulary enrichment review.')
    return { status: 'published', catalog_id: target.id }
  }

  const semanticSense = decision.semantic_sense?.trim() || candidate.semantic_sense
  const senseKey = normalizeSense(semanticSense)
  const existing = await db.prepare(`SELECT id, zh_tw_definition, english_example, zh_tw_example_translation
    FROM vocabulary_catalog WHERE normalized_key = ? AND part_of_speech_key = ? AND sense_key = ?
      AND publication_status = 'published'`)
    .bind(candidate.normalized_key, candidate.part_of_speech_key, senseKey).first<{
      id: string; zh_tw_definition: string | null; english_example: string | null; zh_tw_example_translation: string | null
    }>()
  if (existing) {
    if (!sameContent(contentOf(existing), content)) return { status: 'conflict' }
    const result = await db.prepare(`UPDATE vocabulary_catalog_candidates SET status = 'published',
      semantic_sense = ?, sense_key = ?, catalog_id = ?, zh_tw_definition = ?, english_example = ?,
      zh_tw_example_translation = ?, reviewed_by = ?, reviewed_at = ?, updated_at = ?
      WHERE id = ? AND status = 'review_needed'`)
      .bind(semanticSense, senseKey, existing.id, content.zh_tw_definition, content.english_example,
        content.zh_tw_example_translation, reviewerId, at, at, candidate.id).run()
    if (!result.success) throw new Error('Could not resolve vocabulary candidate.')
    return { status: 'published', catalog_id: existing.id }
  }

  const id = crypto.randomUUID()
  const hash = await vocabularyContentHash(content)
  const provenance = JSON.stringify({ source: candidate.provenance, reviewed_by: reviewerId, candidate_id: candidate.id })
  const batch = await db.batch([
    db.prepare(`INSERT INTO vocabulary_catalog (id, headword, normalized_key, part_of_speech, part_of_speech_key,
        sense_key, semantic_sense, cefr_level, source_dataset, source_version, provenance,
      zh_tw_definition, english_example, zh_tw_example_translation, publication_status, owner_user_id,
      model, prompt_version, content_version, content_hash, published_at, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, NULL, 'gemini-ai-reviewed', ?, ?, ?, ?, ?, 'published', NULL,
        ?, ?, 1, ?, ?, ?, ?) ON CONFLICT DO NOTHING`)
      .bind(id, candidate.headword, candidate.normalized_key, candidate.part_of_speech, candidate.part_of_speech_key,
        senseKey, semanticSense, candidate.prompt_version, provenance,
        content.zh_tw_definition, content.english_example, content.zh_tw_example_translation,
        candidate.model, candidate.prompt_version, hash, at, at, at),
    db.prepare(`INSERT INTO vocabulary_catalog_versions (id, catalog_id, version, content_hash, zh_tw_definition,
      english_example, zh_tw_example_translation, irish_usage, provenance, model, prompt_version, created_at)
      SELECT ?, id, content_version, content_hash, zh_tw_definition, english_example,
        zh_tw_example_translation, irish_usage, provenance, model, prompt_version, ?
      FROM vocabulary_catalog WHERE id = ? AND changes() > 0`).bind(crypto.randomUUID(), at, id),
  ])
  if (batch.length !== 2 || batch.some(result => !result.success)) throw new Error('Vocabulary candidate publication failed.')
  const published = await db.prepare(`SELECT id, zh_tw_definition, english_example, zh_tw_example_translation
    FROM vocabulary_catalog WHERE normalized_key = ? AND part_of_speech_key = ? AND sense_key = ?
      AND publication_status = 'published'`)
    .bind(candidate.normalized_key, candidate.part_of_speech_key, senseKey).first<{
      id: string; zh_tw_definition: string | null; english_example: string | null; zh_tw_example_translation: string | null
    }>()
  if (!published || !sameContent(contentOf(published), content)) return { status: 'conflict' }
  const result = await db.prepare(`UPDATE vocabulary_catalog_candidates SET status = 'published',
    semantic_sense = ?, sense_key = ?, catalog_id = ?, zh_tw_definition = ?, english_example = ?,
    zh_tw_example_translation = ?, reviewed_by = ?, reviewed_at = ?, updated_at = ?
    WHERE id = ? AND status = 'review_needed'`)
    .bind(semanticSense, senseKey, published.id, content.zh_tw_definition, content.english_example,
      content.zh_tw_example_translation, reviewerId, at, at, candidate.id).run()
  if (!result.success) throw new Error('Could not finish vocabulary candidate publication.')
  return { status: 'published', catalog_id: published.id }
}
