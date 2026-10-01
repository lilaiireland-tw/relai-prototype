import { createHash } from 'node:crypto'

export const DATASET = 'CEFR-J Vocabulary Profile'
export const VERSION = '1.6'
export const PROVENANCE = 'The CEFR-J Wordlist Version 1.6. Compiled by Yukio Tono, Tokyo University of Foreign Studies. Retrieved from https://www.cefr-j.org/download.html on 2026-10-01.'
export const LEVELS = ['A1', 'A2', 'B1', 'B2'] as const

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
    bind(...values: (string | null)[]): CatalogStatement
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
  const versions = await db.prepare('SELECT DISTINCT source_version FROM vocabulary_catalog WHERE source_dataset = ?')
    .bind(DATASET).all<{ source_version: string }>()
  if (!versions.success) throw new Error('Could not inspect catalog versions.')
  if (versions.results.some(row => row.source_version !== VERSION)) {
    throw new CatalogImportError('A different CEFR-J catalog version already exists; no overwrite was attempted.',
      { inserted: 0, skipped: 0, rejected: rows.length })
  }
  const existing = await db.prepare(`SELECT id, headword, normalized_key, part_of_speech, cefr_level,
      source_dataset, source_version, provenance FROM vocabulary_catalog WHERE source_dataset = ? AND source_version = ?`)
    .bind(DATASET, VERSION).all<CatalogRow>()
  if (!existing.success) throw new Error('Could not inspect existing catalog rows.')
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
    const statements = pending.slice(start, start + 100).map(row => db.prepare(`INSERT INTO vocabulary_catalog
      (id, headword, normalized_key, part_of_speech, cefr_level, source_dataset, source_version,
       provenance, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .bind(row.id, row.headword, row.normalized_key, row.part_of_speech, row.cefr_level,
        row.source_dataset, row.source_version, row.provenance, timestamp, timestamp))
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
