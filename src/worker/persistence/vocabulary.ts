import type { PersistenceDatabase, PersistenceStatement } from './d1'
import { lexicalFields, normalizeSense, vocabularyContentHash, type CatalogRecord, type LexicalContent, type LexicalField, type VocabularyPlan } from '../services/vocabulary-catalog'

type MaybeLexicalContent = Partial<Record<LexicalField, string | null | undefined>> & { usage_patterns?: CatalogRecord['usage_patterns'] }

export type VocabularySaveResult = {
  headword: string
  status: 'saved' | 'already_saved'
  card_id: string
} | {
  headword: string
  status: 'ambiguous'
  reason: 'ambiguous_sense' | 'low_confidence'
  item: VocabularyPlan['item']
  options: { catalog_id: string; semantic_sense: string }[]
} | {
  headword: string
  status: 'not_saved'
  reason: 'invalid_content' | 'enrichment_unavailable' | 'catalog_changed' | 'save_failed'
}

function contentOf(row: Pick<CatalogRecord, LexicalField> & Partial<Pick<CatalogRecord, 'usage_patterns'>>): MaybeLexicalContent {
  return {
      zh_tw_definition: row.zh_tw_definition,
      english_example: row.english_example,
      zh_tw_example_translation: row.zh_tw_example_translation,
      usage_patterns: row.usage_patterns,
  }
}

function complete(content: Partial<MaybeLexicalContent>) {
  return Boolean(content.zh_tw_definition?.trim() && content.english_example?.trim() &&
    content.zh_tw_example_translation?.trim())
}

function sameContent(a: Partial<MaybeLexicalContent>, b: Partial<MaybeLexicalContent>) {
  return a.zh_tw_definition === b.zh_tw_definition && a.english_example === b.english_example &&
    a.zh_tw_example_translation === b.zh_tw_example_translation &&
    JSON.stringify(a.usage_patterns ?? []) === JSON.stringify(b.usage_patterns ?? [])
}

export async function saveVocabulary(
  db: PersistenceDatabase, userId: string, sourceItemId: string, plans: VocabularyPlan[], at: string, imageJobLease?: string,
): Promise<VocabularySaveResult[]> {
  if (!db.batch) throw new Error('D1 batch is required to save vocabulary.')
  const results: VocabularySaveResult[] = []
  for (const [planIndex, plan] of plans.entries()) {
    if (plan.kind === 'ambiguous') {
      results[planIndex] = { headword: plan.item.headword, status: 'ambiguous',
        reason: plan.reason === 'low_confidence' ? 'low_confidence' : 'ambiguous_sense',
        item: plan.item, options: plan.options ?? [] }
      continue
    }
    if (plan.kind === 'invalid') {
      results[planIndex] = { headword: plan.item.headword, status: 'not_saved',
        reason: plan.reason === 'enrichment_unavailable' ? 'enrichment_unavailable' : 'invalid_content' }
      continue
    }
    try {
      const catalog = plan.catalog
      const content = plan.content as LexicalContent
      const statements: PersistenceStatement[] = []
      if (imageJobLease) {
        // A NOT NULL failure rolls back this whole word batch if abandonment won the race.
        statements.push(db.prepare(`UPDATE image_vocabulary_jobs SET stage = CASE
          WHEN lease_token = ? AND status = 'saving' THEN stage ELSE NULL END WHERE job_id = ?`)
          .bind(imageJobLease, sourceItemId))
      }
      if (plan.target_catalog_id && !catalog) throw new Error('Catalog enrichment target was not loaded.')
      if (catalog && !complete(contentOf(catalog))) {
        const hash = plan.content_hash ?? await vocabularyContentHash(content)
        statements.push(
          db.prepare(`UPDATE vocabulary_catalog SET
            zh_tw_definition = COALESCE(NULLIF(TRIM(zh_tw_definition), ''), ?),
            english_example = COALESCE(NULLIF(TRIM(english_example), ''), ?),
            zh_tw_example_translation = COALESCE(NULLIF(TRIM(zh_tw_example_translation), ''), ?),
            usage_patterns = CASE WHEN usage_patterns = '[]' AND ? IS NOT NULL THEN ? ELSE usage_patterns END,
            content_version = content_version + 1, content_hash = ?, provenance = ?, model = ?, prompt_version = ?, updated_at = ?
            WHERE id = ? AND publication_status = 'published' AND content_version = ?
              AND (NULLIF(TRIM(zh_tw_definition), '') IS NULL OR NULLIF(TRIM(english_example), '') IS NULL
                OR NULLIF(TRIM(zh_tw_example_translation), '') IS NULL)`)
            .bind(content.zh_tw_definition, content.english_example, content.zh_tw_example_translation,
              content.usage_patterns?.length ? JSON.stringify(content.usage_patterns) : null,
              content.usage_patterns?.length ? JSON.stringify(content.usage_patterns) : null,
              hash, JSON.stringify({ previous: catalog.provenance, enrichment: JSON.parse(plan.provenance) }),
              plan.model, plan.prompt_version, at, catalog.id, catalog.content_version),
          db.prepare(`INSERT INTO vocabulary_catalog_versions (id, catalog_id, version, content_hash,
            zh_tw_definition, english_example, zh_tw_example_translation, irish_usage, usage_patterns, provenance, model, prompt_version, created_at)
            SELECT ?, id, content_version, content_hash, zh_tw_definition, english_example,
              zh_tw_example_translation, irish_usage, usage_patterns, provenance, model, prompt_version, ?
            FROM vocabulary_catalog WHERE id = ? AND changes() > 0`).bind(crypto.randomUUID(), at, catalog.id),
        )
      } else if (!plan.target_catalog_id) {
        const id = crypto.randomUUID()
        const hash = plan.content_hash ?? await vocabularyContentHash(content)
        statements.push(
          db.prepare(`INSERT INTO vocabulary_catalog (id, headword, normalized_key, part_of_speech,
            part_of_speech_key, sense_key, semantic_sense, cefr_level, source_dataset, source_version,
            provenance, zh_tw_definition, english_example, zh_tw_example_translation, usage_patterns, publication_status,
            owner_user_id, model, prompt_version, content_version, content_hash, published_at, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, NULL, 'gemini-ai', ?, ?, ?, ?, ?, ?, 'published', NULL, ?, ?, 1, ?, ?, ?, ?)
            ON CONFLICT DO NOTHING`)
            .bind(id, plan.item.headword, plan.normalized_key, plan.item.part_of_speech, plan.part_of_speech_key,
              plan.sense_key, plan.item.semantic_sense, plan.prompt_version, plan.provenance,
              content.zh_tw_definition, content.english_example, content.zh_tw_example_translation,
              JSON.stringify(content.usage_patterns ?? []),
              plan.model, plan.prompt_version, hash, at, at, at),
          db.prepare(`INSERT INTO vocabulary_catalog_versions (id, catalog_id, version, content_hash,
            zh_tw_definition, english_example, zh_tw_example_translation, irish_usage, usage_patterns, provenance, model, prompt_version, created_at)
            SELECT ?, id, content_version, content_hash, zh_tw_definition, english_example,
              zh_tw_example_translation, irish_usage, usage_patterns, provenance, model, prompt_version, ?
            FROM vocabulary_catalog WHERE id = ? AND changes() > 0`).bind(crypto.randomUUID(), at, id),
        )
      }
      const cardId = crypto.randomUUID()
      const cardIndex = statements.length
      statements.push(
        db.prepare(`INSERT INTO flashcards (id, user_id, source_item_id, card_type, vocabulary_catalog_id, created_at, updated_at)
          SELECT ?, ?, ?, 'vocabulary', id, ?, ? FROM vocabulary_catalog
          WHERE ${plan.target_catalog_id ? 'id = ?' : 'normalized_key = ? AND part_of_speech_key = ? AND sense_key = ?'}
            AND publication_status = 'published'
            AND NULLIF(TRIM(zh_tw_definition), '') IS NOT NULL
            AND NULLIF(TRIM(english_example), '') IS NOT NULL
            AND NULLIF(TRIM(zh_tw_example_translation), '') IS NOT NULL
          ON CONFLICT DO NOTHING`)
          .bind(cardId, userId, sourceItemId, at, at,
            ...(plan.target_catalog_id ? [plan.target_catalog_id] : [plan.normalized_key, plan.part_of_speech_key, plan.sense_key])),
      )
      statements.push(
        db.prepare(`INSERT INTO user_stats (user_id, total_cards_created, updated_at)
          SELECT ?, changes(), ? WHERE changes() > 0
          ON CONFLICT(user_id) DO UPDATE SET
            total_cards_created = user_stats.total_cards_created + excluded.total_cards_created,
            updated_at = excluded.updated_at`).bind(userId, at),
      )
      const batch = await db.batch(statements)
      if (batch.length !== statements.length || batch.some(result => !result.success)) throw new Error('Vocabulary write failed.')
      if (batch[cardIndex].meta.changes > 0) {
        results[planIndex] = { headword: plan.item.headword, status: 'saved', card_id: cardId }
      } else {
        const existing = plan.target_catalog_id
          ? await db.prepare('SELECT id FROM flashcards WHERE user_id = ? AND vocabulary_catalog_id = ?')
            .bind(userId, plan.target_catalog_id).first<{ id: string }>()
          : await db.prepare(`SELECT card.id FROM flashcards AS card JOIN vocabulary_catalog AS catalog
              ON catalog.id = card.vocabulary_catalog_id WHERE card.user_id = ? AND catalog.normalized_key = ?
                AND catalog.part_of_speech_key = ? AND catalog.sense_key = ?`)
            .bind(userId, plan.normalized_key, plan.part_of_speech_key, plan.sense_key).first<{ id: string }>()
        results[planIndex] = existing
          ? { headword: plan.item.headword, status: 'already_saved', card_id: existing.id }
          : { headword: plan.item.headword, status: 'not_saved', reason: 'catalog_changed' }
      }
    } catch {
      results[planIndex] = { headword: plan.item.headword, status: 'not_saved', reason: 'save_failed' }
    }
  }
  return results
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
      zh_tw_definition, english_example, zh_tw_example_translation, irish_usage, usage_patterns, provenance, model, prompt_version, created_at)
      SELECT ?, id, content_version, content_hash, zh_tw_definition, english_example,
        zh_tw_example_translation, irish_usage, usage_patterns, provenance, model, prompt_version, ?
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
      zh_tw_definition, english_example, zh_tw_example_translation, usage_patterns, publication_status, owner_user_id,
      model, prompt_version, content_version, content_hash, published_at, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, NULL, 'gemini-ai-reviewed', ?, ?, ?, ?, ?, '[]', 'published', NULL,
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
