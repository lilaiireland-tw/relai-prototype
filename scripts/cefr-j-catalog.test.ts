import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { DatabaseSync, type StatementSync } from 'node:sqlite'
import { describe, expect, it } from 'vitest'
import { CatalogImportError, DATASET, importCatalog, normalizeKey, validateManifest, type CatalogDatabase, type CatalogStatement } from './cefr-j-catalog'

const fixture = JSON.parse(readFileSync('scripts/fixtures/cefr-j-1.6-small.json', 'utf8'))

function localDatabase() {
  const sqlite = new DatabaseSync(':memory:')
  sqlite.exec('PRAGMA foreign_keys = ON')
  for (const name of readdirSync('migrations').filter(name => name.endsWith('.sql')).sort()) {
    sqlite.exec(readFileSync(join('migrations', name), 'utf8'))
  }
  type Values = (string | null)[]
  const bound = (statement: StatementSync, values: Values) => ({
    all: async <T>() => ({ success: true, results: statement.all(...values) as T[] }),
    run: async () => ({ success: true, meta: { changes: Number(statement.run(...values).changes) } }),
    execute: () => statement.run(...values),
  })
  const db: CatalogDatabase = {
    prepare(sql: string) {
      const statement = sqlite.prepare(sql)
      return {
        bind: (...values: Values) => bound(statement, values),
        all: async <T>() => ({ success: true, results: statement.all() as T[] }),
      }
    },
    async batch(statements: CatalogStatement[]) {
      sqlite.exec('BEGIN')
      try {
        const results = statements.map(statement => ({ success: true, meta: { changes: Number((statement as CatalogStatement & { execute(): { changes: number | bigint } }).execute().changes) } }))
        sqlite.exec('COMMIT')
        return results
      } catch (error) {
        sqlite.exec('ROLLBACK')
        throw error
      }
    },
  }
  return { sqlite, db }
}

describe('CEFR-J catalog import', () => {
  it('imports A1–B2 fixture, keeps POS and provenance, and is idempotent without creating cards', async () => {
    const { sqlite, db } = localDatabase()
    expect(await importCatalog(db, fixture)).toEqual({ inserted: 8, skipped: 0, rejected: 0 })
    expect(await importCatalog(db, fixture)).toEqual({ inserted: 0, skipped: 8, rejected: 0 })
    expect(sqlite.prepare('SELECT cefr_level, COUNT(*) AS count FROM vocabulary_catalog GROUP BY cefr_level ORDER BY cefr_level').all())
      .toEqual([{ cefr_level: 'A1', count: 3 }, { cefr_level: 'A2', count: 1 },
        { cefr_level: 'B1', count: 3 }, { cefr_level: 'B2', count: 1 }])
    expect(sqlite.prepare("SELECT part_of_speech FROM vocabulary_catalog WHERE normalized_key = 'about' ORDER BY part_of_speech").all())
      .toEqual([{ part_of_speech: 'adverb' }, { part_of_speech: 'preposition' }])
    expect(sqlite.prepare('SELECT source_dataset, source_version, provenance, zh_tw_definition, english_example, zh_tw_example_translation, irish_usage FROM vocabulary_catalog LIMIT 1').get())
      .toMatchObject({ source_dataset: DATASET, source_version: '1.6', provenance: fixture.provenance,
        zh_tw_definition: null, english_example: null, zh_tw_example_translation: null, irish_usage: null })
    expect(sqlite.prepare('SELECT COUNT(*) AS count FROM flashcards').get()).toEqual({ count: 0 })
    sqlite.close()
  })

  it('rejects C1/C2, malformed levels, empty words, and conflicting normalized identities before writing', async () => {
    const { sqlite, db } = localDatabase()
    for (const level of ['C1', 'C2', 'A3']) {
      await expect(importCatalog(db, { ...fixture, rows: [{ headword: 'word', pos: 'noun', CEFR: level }] }))
        .rejects.toThrow(/unsupported CEFR level/)
    }
    await expect(importCatalog(db, { ...fixture, rows: [{ headword: '  ', pos: null, CEFR: 'A1' }] }))
      .rejects.toThrow(/empty headword/)
    await expect(importCatalog(db, { ...fixture, rows: [
      { headword: ' Book ', pos: 'noun', CEFR: 'A1' },
      { headword: 'book', pos: 'noun', CEFR: 'A1' },
    ] })).rejects.toThrow(/Duplicate normalized identity/)
    await expect(importCatalog(db, { ...fixture, rows: [{ headword: 'word', pos: 'noun', CEFR: 'C1' }] }))
      .rejects.toMatchObject({ counts: { inserted: 0, skipped: 0, rejected: 1 } } satisfies Partial<CatalogImportError>)
    expect(sqlite.prepare('SELECT COUNT(*) AS count FROM vocabulary_catalog').get()).toEqual({ count: 0 })
    sqlite.close()
  })

  it('allows the same headword across POS and levels, and rejects changed same-version rows', async () => {
    const { sqlite, db } = localDatabase()
    const source = { ...fixture, rows: [
      { headword: 'Book', pos: 'noun', CEFR: 'A1' },
      { headword: 'book', pos: 'verb', CEFR: 'A1' },
      { headword: 'book', pos: 'noun', CEFR: 'A2' },
    ] }
    expect(normalizeKey(' Book ')).toBe('book')
    expect(await importCatalog(db, source)).toEqual({ inserted: 3, skipped: 0, rejected: 0 })
    await expect(importCatalog(db, { ...source, rows: [
      { headword: 'BOOK', pos: 'noun', CEFR: 'A1' }, ...source.rows.slice(1),
    ] })).rejects.toThrow(/differs/)
    sqlite.close()
  })

  it('rejects a different installed version without overwriting it', async () => {
    const { sqlite, db } = localDatabase()
    sqlite.prepare(`INSERT INTO vocabulary_catalog (id, headword, normalized_key, cefr_level, source_dataset,
      source_version, provenance, created_at, updated_at) VALUES ('old', 'book', 'book', 'A1', ?,
      '1.5', 'old source', '2026-10-01', '2026-10-01')`).run(DATASET)
    await expect(importCatalog(db, fixture)).rejects.toThrow(/different CEFR-J catalog version/)
    expect(sqlite.prepare('SELECT COUNT(*) AS count FROM vocabulary_catalog').get()).toEqual({ count: 1 })
    sqlite.close()
  })

  it('requires approved source metadata', () => {
    expect(() => validateManifest({ ...fixture, version: '1.5' })).toThrow(/metadata/)
    expect(() => validateManifest({ ...fixture, provenance: 'unknown' })).toThrow(/metadata/)
  })
})
