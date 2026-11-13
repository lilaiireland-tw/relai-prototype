import { lexicalFields, vocabularyContentHash, type LexicalField } from '../src/worker/services/vocabulary-catalog'
import type { PersistenceDatabase, SqlValue } from '../src/worker/persistence/d1'
import { STARTER_CATALOG_IDS } from '../src/worker/persistence/starter-pack'

export type CatalogSnapshot = Record<string, SqlValue> & { id: string; content_version: number }
export interface CatalogChange {
  before: CatalogSnapshot
  after: CatalogSnapshot
  fields: LexicalField[]
  reason: 'correction' | 'starter_completion'
}

// RFC 4180 quoting, including embedded commas, quotes and line breaks.
export function parseCsv(text: string): Record<string, string>[] {
  const rows: string[][] = []
  let row: string[] = [], cell = '', quoted = false, closed = false
  text = text.replace(/^\uFEFF/, '')
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') { cell += '"'; i++ }
      else if (ch === '"') { quoted = false; closed = true }
      else cell += ch
    } else if (ch === ',' || ch === '\n' || ch === '\r') {
      row.push(cell); cell = ''; closed = false
      if (ch !== ',') {
        if (ch === '\r' && text[i + 1] === '\n') i++
        rows.push(row); row = []
      }
    } else if (ch === '"' && !cell && !closed) quoted = true
    else {
      if (closed || ch === '"') throw new Error('Invalid CSV quoting.')
      cell += ch
    }
  }
  if (quoted) throw new Error('Unclosed CSV quote.')
  if (cell || closed || row.length) rows.push([...row, cell])
  const header = rows.shift()
  if (!header?.length || new Set(header).size !== header.length) throw new Error('Missing or duplicate CSV header.')
  return rows.map(values => {
    if (values.length !== header.length) throw new Error('CSV column count mismatch.')
    return Object.fromEntries(header.map((key, i) => [key, values[i]]))
  })
}

export const correctionColumns = {
  zh_tw_definition: '建議字典釋義',
  english_example: '英文例句',
  zh_tw_example_translation: '建議例句中文',
} as const
const identityFields = ['headword', 'part_of_speech', 'cefr_level', 'source_dataset',
  'publication_status', 'semantic_sense', 'sense_key', 'content_version', 'content_hash'] as const

function uniqueRows(rows: Record<string, string>[]) {
  const seen = new Set<string>()
  for (const row of rows) {
    if (!row.id || seen.has(row.id)) throw new Error('Missing or duplicate Catalog ID.')
    seen.add(row.id)
  }
}

/** Pure offline planning. Private corrections remain in the local report, pending separate review. */
export function planCatalogChanges(snapshot: CatalogSnapshot[], corrections: Record<string, string>[], review: Record<string, string>[]) {
  uniqueRows(corrections); uniqueRows(review)
  const byId = new Map(snapshot.map(row => [row.id, row]))
  if (byId.size !== snapshot.length) throw new Error('Duplicate snapshot ID.')
  const changes = new Map<string, CatalogChange>()
  const trace: { id: string; status: string; fields: LexicalField[]; before: CatalogSnapshot; after: CatalogSnapshot }[] = []
  for (const csv of corrections) {
    const before = byId.get(csv.id)
    if (!before || identityFields.some(key => !(key in csv) || String(before[key] ?? '') !== csv[key])) {
      throw new Error(`Correction identity/version conflict: ${csv.id}`)
    }
    if (csv['原始中文解釋'] !== before.zh_tw_definition || csv['原始例句中文'] !== before.zh_tw_example_translation) {
      throw new Error(`Correction old-value conflict: ${csv.id}`)
    }
    const after = { ...before }
    for (const field of lexicalFields) {
      const column = correctionColumns[field]
      if (!(column in csv)) throw new Error(`Missing correction column: ${column}`)
      if (csv[column].trim()) after[field] = csv[column]
    }
    const fields = lexicalFields.filter(field => before[field] !== after[field])
    const privateRow = before.publication_status !== 'published' || before.owner_user_id !== null
    trace.push({ id: csv.id, status: privateRow ? 'private_pending' : fields.length ? 'changed' : 'unchanged', fields, before, after })
    if (fields.length && !privateRow) changes.set(csv.id, { before, after, fields, reason: 'correction' })
  }
  const allStarterIds = Object.values(STARTER_CATALOG_IDS).flat()
  if (review.length !== 80 || new Set(allStarterIds).size !== 80 ||
    allStarterIds.some(id => !review.some(row => row.id === id))) throw new Error('Review must match all 80 fixed Starter IDs.')
  for (const csv of review) {
    const before = byId.get(csv.id)
    const level = Object.entries(STARTER_CATALOG_IDS).find(([, ids]) => ids.includes(csv.id))?.[0]
    if (!before || ['headword', 'part_of_speech', 'sense_key', 'cefr_level', 'source_dataset', 'source_version']
      .some(key => csv[key] !== before[key]) || before.cefr_level !== level ||
      before.source_dataset !== 'CEFR-J Vocabulary Profile' || before.source_version !== '1.6' ||
      before.publication_status !== 'published' || before.owner_user_id !== null) {
      throw new Error(`Starter identity conflict: ${csv.id}`)
    }
    const after = { ...(changes.get(csv.id)?.after ?? before) }
    for (const field of lexicalFields) {
      if (!csv[field]?.trim()) throw new Error(`Incomplete Starter review: ${csv.id}`)
      if (!String(after[field] ?? '').trim()) after[field] = csv[field]
      else if (after[field] !== csv[field]) throw new Error(`Review would overwrite existing/corrected content: ${csv.id}`)
    }
    // Existing patterns are preserved; the one-time completion proposes none.
    if (csv.usage_patterns !== before.usage_patterns) throw new Error(`Usage-pattern conflict: ${csv.id}`)
    const fields = lexicalFields.filter(field => before[field] !== after[field])
    if (fields.length) changes.set(csv.id, { before, after, fields,
      reason: changes.has(csv.id) ? 'correction' : 'starter_completion' })
  }
  return { changes: [...changes.values()], trace }
}

async function completedRow(change: CatalogChange, at: string): Promise<CatalogSnapshot> {
  const after = { ...change.after }
  after.content_version = change.before.content_version + 1
  after.content_hash = await vocabularyContentHash({
    zh_tw_definition: String(after.zh_tw_definition), english_example: String(after.english_example),
    zh_tw_example_translation: String(after.zh_tw_example_translation),
    usage_patterns: JSON.parse(String(after.usage_patterns)),
  })
  after.updated_at = at
  after.provenance = JSON.stringify({ previous: change.before.provenance, correction: 'PO-reviewed Issue #112' })
  return after
}

/** Indexed, bounded preflight. No writes until every target has passed. */
export async function preflightChanges(db: PersistenceDatabase, changes: CatalogChange[], at: string) {
  if (changes.length > 132 || new Set(changes.map(row => row.before.id)).size !== changes.length) {
    throw new Error('Invalid or oversized change plan.')
  }
  const pending: { before: CatalogSnapshot; after: CatalogSnapshot }[] = []
  const unchanged: string[] = []
  const conflicts: string[] = []
  for (const change of changes) {
    const current = await db.prepare('SELECT * FROM vocabulary_catalog WHERE id = ?').bind(change.before.id).first<CatalogSnapshot>()
    const after = await completedRow(change, at)
    const same = (expected: CatalogSnapshot, ignoreTime = false) => current &&
      Object.keys(expected).every(key => ignoreTime && key === 'updated_at' || current[key] === expected[key])
    if (same(after, true)) unchanged.push(change.before.id)
    else if (same(change.before)) pending.push({ before: change.before, after })
    else conflicts.push(change.before.id)
  }
  return { pending, unchanged, conflicts }
}

/** One row + its new history snapshot per transaction; guarded again against concurrent edits. */
export async function applyCatalogChanges(db: PersistenceDatabase, pending: { before: CatalogSnapshot; after: CatalogSnapshot }[],
  onApplied: (id: string, version: number) => Promise<void> = async () => {}) {
  if (!db.batch) throw new Error('D1 batch required.')
  for (const { before, after } of pending) {
    const keys = Object.keys(before)
    const guard = keys.map(key => `"${key}" IS ?`).join(' AND ')
    // Column identifiers originate in the trusted schema, never in CSV headers.
    if (keys.some(key => !/^[a-z_]+$/.test(key))) throw new Error('Invalid schema column.')
    const results = await db.batch([
      db.prepare(`SELECT CASE WHEN EXISTS (SELECT 1 FROM vocabulary_catalog WHERE ${guard})
        THEN 1 ELSE json('catalog_version_conflict') END`).bind(...keys.map(key => before[key])),
      db.prepare(`UPDATE vocabulary_catalog SET zh_tw_definition = ?, english_example = ?,
        zh_tw_example_translation = ?, content_version = ?, content_hash = ?, provenance = ?, updated_at = ? WHERE id = ?`)
        .bind(after.zh_tw_definition, after.english_example, after.zh_tw_example_translation,
          after.content_version, after.content_hash, after.provenance, after.updated_at, before.id),
      db.prepare(`INSERT INTO vocabulary_catalog_versions (id, catalog_id, version, content_hash,
        zh_tw_definition, english_example, zh_tw_example_translation, irish_usage, usage_patterns,
        provenance, model, prompt_version, created_at)
        SELECT ?, id, content_version, content_hash, zh_tw_definition, english_example,
        zh_tw_example_translation, irish_usage, usage_patterns, provenance, model, prompt_version, updated_at
        FROM vocabulary_catalog WHERE id = ?`).bind(crypto.randomUUID(), before.id),
    ])
    if (results.length !== 3 || results.some(result => !result.success) || results[1].meta.changes !== 1 || results[2].meta.changes !== 1) {
      throw new Error(`Catalog batch failed: ${before.id}`)
    }
    await onApplied(before.id, after.content_version)
  }
}
