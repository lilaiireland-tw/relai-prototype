import { createHash, randomUUID } from 'node:crypto'

export const DATASET = 'CEFR-J Vocabulary Profile'
export const VERSION = '1.6'
export const PROVENANCE = 'The CEFR-J Wordlist Version 1.6. Compiled by Yukio Tono, Tokyo University of Foreign Studies. Retrieved from https://www.cefr-j.org/download.html on 2026-10-01.'
export const LEVELS = ['A1', 'A2', 'B1', 'B2'] as const
// shortcut: fixed to the published CEFR-J 1.6 size; update with an independently reviewed source version.
const MAX_SOURCE_ROWS = 7801

export interface SourceRow {
  headword: unknown
  pos: unknown
  CEFR: unknown
}

export interface CatalogManifest {
  dataset: string
  version: string
  provenance: string
  rows: SourceRow[]
}

export interface ImportCounts { inserted: number; skipped: number; rejected: number }

export class CatalogImportError extends Error {
  constructor(message: string, readonly counts: ImportCounts) {
    super(message)
  }
}

export interface CatalogStatement {
  all<T>(): Promise<{ results: T[]; success: boolean }>
  run(): Promise<{ success: boolean; meta: { changes: number } }>
}

export interface CatalogDatabase {
  prepare(sql: string): {
    bind(...values: (string | number | null)[]): CatalogStatement
    all<T>(): Promise<{ results: T[]; success: boolean }>
  }
  batch(statements: CatalogStatement[]): Promise<{ success: boolean; meta: { changes: number } }[]>
}

interface CatalogRow {
  id: string
  headword: string
  normalized_key: string
  part_of_speech: string | null
  cefr_level: string
  source_dataset: string
  source_version: string
  provenance: string
}

export interface ReviewedDemoRow {
  id: string
  headword: string
  part_of_speech: string
  cefr_level: 'B1'
  zh_tw_definition: string
  english_example: string
  zh_tw_example_translation: string
  irish_usage: string | null
}
interface ExistingDemoRow extends CatalogRow {
  zh_tw_definition: string | null
  english_example: string | null
  zh_tw_example_translation: string | null
  irish_usage: string | null
}

export function normalizeKey(headword: string): string {
  return headword.trim().toLowerCase()
}

function identity(row: Pick<CatalogRow, 'cefr_level' | 'normalized_key' | 'part_of_speech'>): string {
  return JSON.stringify([row.cefr_level, row.normalized_key, row.part_of_speech ?? ''])
}

function stableId(dataset: string, version: string, identityKey: string): string {
  return `cefr-j-${createHash('sha256').update(JSON.stringify([dataset, version, identityKey])).digest('hex')}`
}

export function validateManifest(value: unknown): CatalogRow[] {
  if (typeof value !== 'object' || value === null || !('rows' in value) || !Array.isArray(value.rows)) {
    throw new Error('Catalog manifest must contain a rows array.')
  }
  const manifest = value as CatalogManifest
  if (manifest.dataset !== DATASET || manifest.version !== VERSION || manifest.provenance !== PROVENANCE) {
    throw new Error('Catalog dataset, version, or attribution does not match approved CEFR-J 1.6 metadata.')
  }
  if (manifest.rows.length === 0) throw new Error('Catalog source has no rows.')
  if (manifest.rows.length > MAX_SOURCE_ROWS) throw new Error(`Catalog source exceeds the ${MAX_SOURCE_ROWS}-row CEFR-J 1.6 limit.`)
  const seen = new Map<string, CatalogRow>()
  return manifest.rows.map((source, index) => {
    const line = index + 1
    if (typeof source !== 'object' || source === null || typeof source.headword !== 'string' ||
      typeof source.CEFR !== 'string' || (source.pos !== null && typeof source.pos !== 'string')) {
      throw new Error(`Invalid source row ${line}: headword, pos, and CEFR types are required.`)
    }
    const headword = source.headword.trim()
    const normalized_key = normalizeKey(headword)
    const part_of_speech = source.pos === null ? null : source.pos.trim() || null
    if (!headword || !normalized_key) throw new Error(`Invalid source row ${line}: empty headword.`)
    if (!LEVELS.includes(source.CEFR as typeof LEVELS[number])) {
      throw new Error(`Invalid source row ${line}: unsupported CEFR level ${source.CEFR}.`)
    }
    const row: CatalogRow = {
      id: '', headword, normalized_key, part_of_speech, cefr_level: source.CEFR,
      source_dataset: DATASET, source_version: VERSION, provenance: PROVENANCE,
    }
    const key = identity(row)
    if (seen.has(key)) {
      throw new Error(`Duplicate normalized identity at row ${line}.`)
    }
    row.id = stableId(DATASET, VERSION, key)
    seen.set(key, row)
    return row
  })
}

export async function importCatalog(db: CatalogDatabase, source: unknown): Promise<ImportCounts> {
  // All source rows are validated before any database write. Duplicate source identities fail.
  let rows: CatalogRow[]
  try {
    rows = validateManifest(source)
  } catch (error) {
    throw new CatalogImportError(error instanceof Error ? error.message : 'Catalog source validation failed.',
      { inserted: 0, skipped: 0, rejected: 1 })
  }
  const versions = await db.prepare(`SELECT source_version FROM vocabulary_catalog_sources
      WHERE source_dataset = ? AND source_version < ?
    UNION ALL
    SELECT source_version FROM vocabulary_catalog_sources
      WHERE source_dataset = ? AND source_version > ?
    LIMIT 1`).bind(DATASET, VERSION, DATASET, VERSION).all<{ source_version: string }>()
  if (!versions.success) throw new Error('Could not inspect catalog versions.')
  if (versions.results.some(row => row.source_version !== VERSION)) {
    throw new CatalogImportError('A different CEFR-J catalog version already exists; no overwrite was attempted.',
      { inserted: 0, skipped: 0, rejected: rows.length })
  }
  const existing = await db.prepare(`SELECT id, headword, normalized_key, part_of_speech, cefr_level,
      source_dataset, source_version, provenance FROM vocabulary_catalog_sources WHERE source_dataset = ? AND source_version = ?
      LIMIT ${MAX_SOURCE_ROWS + 1}`)
    .bind(DATASET, VERSION).all<CatalogRow>()
  if (!existing.success) throw new Error('Could not inspect existing catalog rows.')
  if (existing.results.length > MAX_SOURCE_ROWS) {
    throw new CatalogImportError(`Existing CEFR-J source exceeds the ${MAX_SOURCE_ROWS}-row read limit; no write was attempted.`,
      { inserted: 0, skipped: 0, rejected: rows.length })
  }
  const byIdentity = new Map(existing.results.map(row => [identity(row), row]))
  const incoming = new Map(rows.map(row => [identity(row), row]))
  for (const current of existing.results) {
    const expected = incoming.get(identity(current))
    if (!expected || Object.keys(expected).some(key => current[key as keyof CatalogRow] !== expected[key as keyof CatalogRow])) {
      throw new CatalogImportError('Existing CEFR-J catalog differs from this same-version source; no overwrite was attempted.',
        { inserted: 0, skipped: 0, rejected: rows.length })
    }
  }
  const pending = rows.filter(row => !byIdentity.has(identity(row)))
  const timestamp = new Date().toISOString()
  for (let start = 0; start < pending.length; start += 100) {
    const statements = pending.slice(start, start + 100).flatMap(row => {
      const posKey = (row.part_of_speech?.trim() || 'unknown').toLowerCase()
      const senseKey = `cefrj:${row.cefr_level}`
      return [
        db.prepare(`INSERT INTO vocabulary_catalog (id, headword, normalized_key, part_of_speech,
          part_of_speech_key, sense_key, semantic_sense, cefr_level, source_dataset, source_version,
          provenance, publication_status, content_version, published_at, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, 'CEFR-J sense requires source context.', ?, ?, ?, ?,
            'published', 1, ?, ?, ?)`)
          .bind(row.id, row.headword, row.normalized_key, row.part_of_speech, posKey, senseKey,
            row.cefr_level, row.source_dataset, row.source_version, row.provenance, timestamp, timestamp, timestamp),
        db.prepare(`INSERT INTO vocabulary_catalog_versions (id, catalog_id, version, content_hash, provenance, created_at)
          SELECT ?, id, content_version, content_hash, provenance, ? FROM vocabulary_catalog
          WHERE id = ? AND changes() > 0`).bind(randomUUID(), timestamp, row.id),
        db.prepare(`INSERT INTO vocabulary_catalog_sources (id, headword, normalized_key, part_of_speech,
          cefr_level, source_dataset, source_version, provenance, created_at, updated_at, canonical_catalog_id)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
          .bind(row.id, row.headword, row.normalized_key, row.part_of_speech, row.cefr_level,
            row.source_dataset, row.source_version, row.provenance, timestamp, timestamp, row.id),
      ]
    })
    try {
      const results = await db.batch(statements)
      if (results.length !== statements.length || results.some(result => !result.success || result.meta.changes !== 1)) {
        throw new Error('Batch result was incomplete.')
      }
    } catch {
      throw new CatalogImportError('Catalog batch insert failed; inspect D1 state before rerunning.',
        { inserted: start, skipped: rows.length - pending.length, rejected: pending.length - start })
    }
  }
  return { inserted: pending.length, skipped: rows.length - pending.length, rejected: 0 }
}

export async function importReviewedDemo(db: CatalogDatabase, source: unknown) {
  if (!Array.isArray(source) || source.length !== 20) throw new Error('Reviewed demo fixture must contain exactly 20 rows.')
  const rows = source as ReviewedDemoRow[]
  const seen = new Set<string>()
  for (const [index, row] of rows.entries()) {
    if (typeof row !== 'object' || row === null || typeof row.id !== 'string' ||
      typeof row.headword !== 'string' || typeof row.part_of_speech !== 'string' || row.cefr_level !== 'B1' ||
      typeof row.zh_tw_definition !== 'string' || !row.zh_tw_definition.trim() ||
      typeof row.english_example !== 'string' || !row.english_example.trim() ||
      typeof row.zh_tw_example_translation !== 'string' || !row.zh_tw_example_translation.trim() ||
      (row.irish_usage !== null && typeof row.irish_usage !== 'string')) {
      throw new Error(`Invalid reviewed demo row ${index + 1}.`)
    }
    const normalized_key = normalizeKey(row.headword)
    const identityKey = JSON.stringify([row.cefr_level, normalized_key, row.part_of_speech])
    if (!normalized_key || seen.has(identityKey) ||
      row.id !== stableId(DATASET, VERSION, identityKey)) {
      throw new Error(`Invalid reviewed demo identity at row ${index + 1}.`)
    }
    seen.add(identityKey)
  }

  const existing = await db.prepare(`SELECT id, headword, normalized_key, part_of_speech, cefr_level,
      source_dataset, source_version, provenance, zh_tw_definition, english_example,
      zh_tw_example_translation, irish_usage FROM vocabulary_catalog
      WHERE id IN (${rows.map(() => '?').join(', ')})`)
    .bind(...rows.map(row => row.id)).all<ExistingDemoRow>()
  if (!existing.success) throw new Error('Could not inspect reviewed demo catalog rows.')
  const expected = new Map(rows.map(row => [row.id, row]))
  for (const current of existing.results) {
    const row = expected.get(current.id)!
    if (current.headword !== row.headword || current.normalized_key !== normalizeKey(row.headword) ||
      current.part_of_speech !== row.part_of_speech || current.cefr_level !== row.cefr_level ||
      current.source_dataset !== DATASET || current.source_version !== VERSION || current.provenance !== PROVENANCE) {
      throw new Error('Existing reviewed demo catalog identity differs; no enrichment was applied.')
    }
  }

  const present = new Set(existing.results.map(row => row.id))
  const previous = new Map(existing.results.map(row => [row.id, row]))
  const needsEnrichment = (row: ReviewedDemoRow) => {
    const current = previous.get(row.id)
    return Boolean(current && [
      [current.zh_tw_definition, row.zh_tw_definition], [current.english_example, row.english_example],
      [current.zh_tw_example_translation, row.zh_tw_example_translation], [current.irish_usage, row.irish_usage],
    ].some(([oldValue, newValue]) => !oldValue?.trim() && Boolean(newValue?.trim())))
  }
  const timestamp = new Date().toISOString()
  const hash = (row: Pick<ReviewedDemoRow, 'zh_tw_definition' | 'english_example' | 'zh_tw_example_translation' | 'irish_usage'>) => createHash('sha256').update(JSON.stringify([
    row.zh_tw_definition, row.english_example, row.zh_tw_example_translation, row.irish_usage,
  ])).digest('hex')
  const finalContent = (row: ReviewedDemoRow) => {
    const current = previous.get(row.id)
    return {
      zh_tw_definition: current?.zh_tw_definition?.trim() ? current.zh_tw_definition : row.zh_tw_definition,
      english_example: current?.english_example?.trim() ? current.english_example : row.english_example,
      zh_tw_example_translation: current?.zh_tw_example_translation?.trim()
        ? current.zh_tw_example_translation : row.zh_tw_example_translation,
      irish_usage: current?.irish_usage?.trim() ? current.irish_usage : row.irish_usage,
    }
  }
  const statements: CatalogStatement[] = rows.flatMap(row => [
    db.prepare(`INSERT INTO vocabulary_catalog (id, headword, normalized_key, part_of_speech, part_of_speech_key,
      sense_key, semantic_sense, cefr_level, source_dataset, source_version, provenance, zh_tw_definition,
      english_example, zh_tw_example_translation, irish_usage, publication_status, content_version,
      content_hash, published_at, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, 'Reviewed B1 demo sense.', 'B1', ?, ?, ?, ?, ?, ?, ?,
        'published', 1, ?, ?, ?, ?) ON CONFLICT(id) DO NOTHING`)
      .bind(row.id, row.headword, normalizeKey(row.headword), row.part_of_speech,
        row.part_of_speech.trim().toLowerCase(), `reviewed-demo:${row.id}`, DATASET, VERSION, PROVENANCE,
        row.zh_tw_definition, row.english_example, row.zh_tw_example_translation, row.irish_usage,
        hash(row), timestamp, timestamp, timestamp),
    db.prepare(`INSERT INTO vocabulary_catalog_versions (id, catalog_id, version, content_hash, zh_tw_definition,
      english_example, zh_tw_example_translation, irish_usage, provenance, created_at)
      SELECT ?, id, content_version, content_hash, zh_tw_definition, english_example,
        zh_tw_example_translation, irish_usage, provenance, ? FROM vocabulary_catalog
      WHERE id = ? AND changes() > 0`).bind(randomUUID(), timestamp, row.id),
    db.prepare(`UPDATE vocabulary_catalog SET
      zh_tw_definition = COALESCE(NULLIF(TRIM(zh_tw_definition), ''), ?),
      english_example = COALESCE(NULLIF(TRIM(english_example), ''), ?),
      zh_tw_example_translation = COALESCE(NULLIF(TRIM(zh_tw_example_translation), ''), ?),
      irish_usage = COALESCE(NULLIF(TRIM(irish_usage), ''), ?), content_version = content_version + 1,
      content_hash = ?, updated_at = ?
      WHERE id = ? AND headword = ? AND normalized_key = ? AND part_of_speech = ?
        AND cefr_level = 'B1' AND source_dataset = ? AND source_version = ? AND provenance = ?
        AND (NULLIF(TRIM(zh_tw_definition), '') IS NULL OR NULLIF(TRIM(english_example), '') IS NULL
          OR NULLIF(TRIM(zh_tw_example_translation), '') IS NULL
          OR (? IS NOT NULL AND NULLIF(TRIM(irish_usage), '') IS NULL))`)
      .bind(row.zh_tw_definition, row.english_example, row.zh_tw_example_translation,
        row.irish_usage, hash(finalContent(row)), timestamp, row.id, row.headword, normalizeKey(row.headword),
        row.part_of_speech, DATASET, VERSION, PROVENANCE, row.irish_usage),
    db.prepare(`INSERT INTO vocabulary_catalog_versions (id, catalog_id, version, content_hash, zh_tw_definition,
      english_example, zh_tw_example_translation, irish_usage, provenance, model, prompt_version, created_at)
      SELECT ?, id, content_version, content_hash, zh_tw_definition, english_example,
        zh_tw_example_translation, irish_usage, provenance, model, prompt_version, ? FROM vocabulary_catalog
      WHERE id = ? AND changes() > 0`).bind(randomUUID(), timestamp, row.id),
  ])
  const results = await db.batch(statements)
  if (results.length !== statements.length || results.some(result => !result.success)) {
    throw new Error('Reviewed demo enrichment batch failed; inspect catalog state before rerunning.')
  }
  return {
    inserted: rows.filter(row => !present.has(row.id)).length,
    enriched: rows.filter(needsEnrichment).length,
    unchanged: rows.filter(row => present.has(row.id) && !needsEnrichment(row)).length,
  }
}
