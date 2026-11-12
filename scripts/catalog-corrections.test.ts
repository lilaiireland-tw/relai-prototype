import { readFileSync, readdirSync } from 'node:fs'
import { DatabaseSync } from 'node:sqlite'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { applyCatalogChanges, correctionColumns, parseCsv, planCatalogChanges, preflightChanges, type CatalogSnapshot } from './catalog-corrections'
import { sqliteD1 } from './sqlite-d1'
import { options } from './import-catalog-corrections'
import { bootstrapStarterPack, STARTER_CATALOG_IDS } from '../src/worker/persistence/starter-pack'
import { vocabularyContentHash } from '../src/worker/services/vocabulary-catalog'
import { importReviewedDemo } from './cefr-j-catalog'
import type { PersistenceDatabase } from '../src/worker/persistence/d1'

const review = parseCsv(readFileSync('docs/catalog-112/starter-review.csv', 'utf8'))
const at = '2026-11-12T12:00:00.000Z'
const migrationSql = readdirSync('migrations').filter(name => name.endsWith('.sql')).sort()
  .map(name => readFileSync(`migrations/${name}`, 'utf8')).join('\n')

function fixture() {
  const sqlite = new DatabaseSync(':memory:')
  sqlite.exec(migrationSql)
  const db = sqliteD1(sqlite)
  const correctionTargets: Record<string, string>[] = [...review.filter(row => row.cefr_level === 'B1'),
    ...Array.from({ length: 32 }, (_, i) => ({ ...review[0], id: `synthetic-${i}`, headword: `synthetic-${i}` }))]
  const targets = [...review, ...correctionTargets.slice(20)]
  for (const row of targets) {
    const corrected = correctionTargets.some(target => target.id === row.id)
    sqlite.prepare(`INSERT INTO vocabulary_catalog (id, headword, normalized_key, part_of_speech,
      part_of_speech_key, sense_key, semantic_sense, cefr_level, source_dataset, source_version, provenance,
      zh_tw_definition, english_example, zh_tw_example_translation, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, 'synthetic sense', ?, ?, ?, 'original source', ?, ?, ?, ?, ?)`)
      .run(row.id, row.headword, row.headword.toLowerCase(), row.part_of_speech, row.part_of_speech,
        row.sense_key, row.cefr_level, row.source_dataset, row.source_version,
        corrected ? 'old definition' : null, corrected ? row.english_example : null,
        corrected ? 'old translation' : null, at, at)
  }
  const snapshot = sqlite.prepare('SELECT * FROM vocabulary_catalog').all() as CatalogSnapshot[]
  const corrections = correctionTargets.map(target => {
    const row = snapshot.find(row => row.id === target.id)!
    return Object.fromEntries(['id', 'headword', 'part_of_speech', 'cefr_level', 'source_dataset',
      'publication_status', 'semantic_sense', 'sense_key', 'content_version', 'content_hash']
      .map(key => [key, String(row[key] ?? '')]).concat([
        ['原始中文解釋', String(row.zh_tw_definition)], ['原始例句中文', String(row.zh_tw_example_translation)],
        ...Object.entries(correctionColumns).map(([key, column]) => [column, target[key]]),
      ]))
  })
  return { sqlite, db, snapshot, corrections, plan: planCatalogChanges(snapshot, corrections, review) }
}

describe('controlled catalog corrections', () => {
  it('parses escaped quotes, commas, semicolons and multiline cells, rejecting malformed CSV', () => {
    expect(parseCsv('id,text\r\nx,"a, b; ""quoted""\nnext"\r\n')).toEqual([{ id: 'x', text: 'a, b; "quoted"\nnext' }])
    for (const bad of ['id,id\nx,y', 'id,text\nx', 'id,text\nx,"open', 'id,text\nx,"closed"tail']) {
      expect(() => parseCsv(bad)).toThrow()
    }
  })

  it('requires explicit apply, fixed staging and both existing remote approvals', () => {
    const args = ['--snapshot', 'local.sql', '--corrections', 'local.csv']
    expect(options(args).apply).toBe(false)
    for (const extra of [ ['--remote'], ['--remote', '--apply', '--confirm-staging', 'production'],
      ['--remote', '--apply', '--confirm-staging', 'relai-staging-db'], ['--apply'], ['--out', 'docs/leak'] ]) {
      expect(() => options([...args, ...extra], {})).toThrow()
    }
    expect(options([...args, '--remote', '--apply', '--confirm-staging', 'relai-staging-db', '--approve-remote-cloudflare'], {
      RELAI_REMOTE_CLOUDFLARE_APPROVAL: 'I_UNDERSTAND_REMOTE_CLOUDFLARE_COSTS_AND_IMPACT',
    }).remote).toBe(true)
  })

  it('traces 52 corrections, completes 60 starters, preserves corrected B1 and is write-free on rerun', async () => {
    const f = fixture()
    try {
      expect(f.plan.trace).toHaveLength(52)
      expect(f.plan.changes).toHaveLength(112)
      const before = await preflightChanges(f.db, f.plan.changes, at)
      expect(before.conflicts).toEqual([])
      await applyCatalogChanges(f.db, before.pending)
      const again = await preflightChanges(f.db, f.plan.changes, at)
      expect(again.pending).toEqual([])
      expect(again.conflicts).toEqual([])
      expect(again.unchanged).toHaveLength(112)
      for (const row of review) {
        const stored = f.sqlite.prepare('SELECT * FROM vocabulary_catalog WHERE id = ?').get(row.id)!
        expect(stored).toMatchObject({ zh_tw_definition: row.zh_tw_definition, english_example: row.english_example,
          zh_tw_example_translation: row.zh_tw_example_translation, content_version: 2, publication_status: 'published', owner_user_id: null })
        expect(stored.content_hash).toBe(await vocabularyContentHash({ zh_tw_definition: row.zh_tw_definition,
          english_example: row.english_example, zh_tw_example_translation: row.zh_tw_example_translation, usage_patterns: [] }))
        expect(JSON.parse(String(stored.provenance)).previous).toBe('original source')
      }
      expect(f.sqlite.prepare('SELECT COUNT(*) AS n FROM vocabulary_catalog_versions').get()).toEqual({ n: 112 })
      // The old importer only fills gaps and must never restore old B1 definitions.
      await expect(importReviewedDemo(f.db as Parameters<typeof importReviewedDemo>[0],
        JSON.parse(readFileSync('data/ai-enrichment/b1-sample-20.json', 'utf8')))).rejects.toThrow(/identity differs/)
      expect((await preflightChanges(f.db, f.plan.changes, at)).unchanged).toHaveLength(112)
      for (const level of ['A1', 'A2', 'B1', 'B2'] as const) {
        f.sqlite.prepare(`INSERT INTO users (id, username, display_name, password_salt, password_digest, created_at, updated_at)
          VALUES (?, ?, ?, 'synthetic', 'synthetic', ?, ?)`).run(level, level, level, at, at)
        expect(await bootstrapStarterPack(f.db, level, level, at)).toMatchObject({ kind: 'created', starter_cards_created: 20 })
        expect(await bootstrapStarterPack(f.db, level, level, at)).toMatchObject({ kind: 'repeat', starter_cards_created: 0 })
        expect(f.sqlite.prepare('SELECT vocabulary_catalog_id AS id FROM flashcards WHERE user_id = ?').all(level)
          .map(row => row.id).sort()).toEqual([...STARTER_CATALOG_IDS[level]].sort())
      }
    } finally { f.sqlite.close() }
  })

  it('rejects duplicate/missing IDs, POS/sense/version mismatch, and a review reverting B1 corrections', () => {
    const f = fixture()
    try {
      expect(() => planCatalogChanges(f.snapshot, [...f.corrections, f.corrections[0]], review)).toThrow(/duplicate/)
      for (const field of ['id', 'part_of_speech', 'sense_key', 'content_version', 'content_hash']) {
        const rows = structuredClone(f.corrections); rows[0][field] = 'mismatch'
        expect(() => planCatalogChanges(f.snapshot, rows, review)).toThrow(/conflict/)
      }
      const reverting = structuredClone(review)
      reverting.find(row => row.cefr_level === 'B1')!.zh_tw_definition = 'old definition'
      expect(() => planCatalogChanges(f.snapshot, f.corrections, reverting)).toThrow(/overwrite/)
      expect(() => planCatalogChanges(f.snapshot, f.corrections, review.slice(1))).toThrow(/80/)
    } finally { f.sqlite.close() }
  })

  it('keeps private records pending and detects remote drift before any write', async () => {
    const f = fixture()
    try {
      const snapshot = structuredClone(f.snapshot)
      const target = snapshot.find(row => row.id === 'synthetic-0')!
      target.publication_status = 'review_needed'; target.owner_user_id = 'synthetic-private-owner'
      const csv = f.corrections.find(row => row.id === target.id)!
      csv.publication_status = 'review_needed'
      const plan = planCatalogChanges(snapshot, f.corrections, review)
      expect(plan.trace.find(row => row.id === target.id)?.status).toBe('private_pending')
      expect(plan.changes.some(row => row.before.id === target.id)).toBe(false)
      f.sqlite.prepare('UPDATE vocabulary_catalog SET content_version = 3 WHERE id = ?').run(f.plan.changes[0].before.id)
      expect((await preflightChanges(f.db, f.plan.changes, at)).conflicts).toEqual([f.plan.changes[0].before.id])
      expect(f.sqlite.prepare('SELECT COUNT(*) AS n FROM vocabulary_catalog_versions').get()).toEqual({ n: 0 })
    } finally { f.sqlite.close() }
  })

  it.each(['history failure', 'concurrent change'])('rolls back the entire affected row on %s', async failure => {
    const f = fixture()
    try {
      const checked = await preflightChanges(f.db, f.plan.changes.slice(0, 2), at)
      if (failure === 'history failure') f.sqlite.exec(`CREATE TRIGGER fail_history BEFORE INSERT ON vocabulary_catalog_versions
        WHEN NEW.catalog_id = '${checked.pending[1].before.id}' BEGIN SELECT RAISE(ABORT, 'synthetic'); END`)
      else f.sqlite.prepare('UPDATE vocabulary_catalog SET updated_at = ? WHERE id = ?').run('concurrent', checked.pending[1].before.id)
      await expect(applyCatalogChanges(f.db, checked.pending)).rejects.toThrow()
      expect(f.sqlite.prepare('SELECT content_version FROM vocabulary_catalog WHERE id = ?').get(checked.pending[0].before.id)).toEqual({ content_version: 2 })
      expect(f.sqlite.prepare('SELECT content_version FROM vocabulary_catalog WHERE id = ?').get(checked.pending[1].before.id)).toEqual({ content_version: 1 })
      expect(f.sqlite.prepare('SELECT COUNT(*) AS n FROM vocabulary_catalog_versions').get()).toEqual({ n: 1 })
    } finally { f.sqlite.close() }
  })

  it('binds special characters without treating them as SQL', async () => {
    const f = fixture()
    try {
      const csv = f.corrections.find(row => row.id === 'synthetic-0')!
      csv[correctionColumns.zh_tw_definition] = "引號 '；分號;\n換行\""
      const plan = planCatalogChanges(f.snapshot, f.corrections, review)
      const checked = await preflightChanges(f.db, plan.changes, at)
      await applyCatalogChanges(f.db, checked.pending)
      expect(f.sqlite.prepare("SELECT zh_tw_definition FROM vocabulary_catalog WHERE id = 'synthetic-0'").get())
        .toEqual({ zh_tw_definition: csv[correctionColumns.zh_tw_definition] })
    } finally { f.sqlite.close() }
  })

  it('keeps prior history and unrelated Catalog rows unchanged', async () => {
    const f = fixture()
    try {
      const id = f.plan.changes[0].before.id
      f.sqlite.prepare(`INSERT INTO vocabulary_catalog_versions (id, catalog_id, version,
        zh_tw_definition, provenance, created_at) VALUES ('original-history', ?, 1, 'old definition', 'original source', ?)`)
        .run(id, at)
      const history = f.sqlite.prepare("SELECT * FROM vocabulary_catalog_versions WHERE id = 'original-history'").get()
      const otherId = f.plan.changes[1].before.id
      const other = f.sqlite.prepare('SELECT * FROM vocabulary_catalog WHERE id = ?').get(otherId)
      await applyCatalogChanges(f.db, (await preflightChanges(f.db, f.plan.changes.slice(0, 1), at)).pending)
      expect(f.sqlite.prepare("SELECT * FROM vocabulary_catalog_versions WHERE id = 'original-history'").get()).toEqual(history)
      expect(f.sqlite.prepare('SELECT * FROM vocabulary_catalog WHERE id = ?').get(otherId)).toEqual(other)
      expect(f.sqlite.prepare('SELECT version FROM vocabulary_catalog_versions WHERE catalog_id = ? ORDER BY version').all(id))
        .toEqual([{ version: 1 }, { version: 2 }])
    } finally { f.sqlite.close() }
  })

  it('runs 52 corrections, atomic history, retries and four level packs on real isolated local D1', async () => {
    const f = fixture()
    const directory = await mkdtemp(join(tmpdir(), 'relai-112-local-d1-'))
    const { getPlatformProxy } = await import('wrangler')
    const configPath = join(directory, 'wrangler.jsonc')
    await writeFile(configPath, JSON.stringify({ name: 'relai-112-local-only', compatibility_date: '2026-09-27',
      d1_databases: [{ binding: 'DB', database_name: 'relai-112-local-only',
        database_id: '00000000-0000-0000-0000-000000000112', remote: false }] }))
    const platform = await getPlatformProxy<{ DB: PersistenceDatabase }>({ configPath, remoteBindings: false, persist: false, envFiles: [] })
    try {
      const db = platform.env.DB
      const schema = f.sqlite.prepare("SELECT sql FROM sqlite_master WHERE sql IS NOT NULL AND name NOT LIKE 'sqlite_%' ORDER BY rowid").all()
      await db.batch!(schema.map(row => db.prepare(String(row.sql))))
      const keys = Object.keys(f.snapshot[0])
      for (let i = 0; i < f.snapshot.length; i += 20) {
        await db.batch!(f.snapshot.slice(i, i + 20).map(row => db.prepare(`INSERT INTO vocabulary_catalog (${keys.join(',')})
          VALUES (${keys.map(() => '?').join(',')})`).bind(...keys.map(key => row[key]))))
      }
      const first = (await preflightChanges(db, f.plan.changes, at)).pending[0]
      await db.prepare(`INSERT INTO vocabulary_catalog_versions (id, catalog_id, version, provenance, created_at)
        VALUES ('conflict', ?, 2, 'synthetic conflict', ?)`).bind(first.before.id, at).run()
      await expect(applyCatalogChanges(db, [first])).rejects.toThrow()
      expect(await db.prepare('SELECT content_version FROM vocabulary_catalog WHERE id = ?').bind(first.before.id).first()).toEqual({ content_version: 1 })
      await db.prepare("DELETE FROM vocabulary_catalog_versions WHERE id = 'conflict'").run()
      await applyCatalogChanges(db, (await preflightChanges(db, f.plan.changes, at)).pending)
      expect((await preflightChanges(db, f.plan.changes, at)).unchanged).toHaveLength(112)
      expect(await db.prepare('SELECT COUNT(*) AS n FROM vocabulary_catalog_versions').first()).toEqual({ n: 112 })
      for (const level of ['A1', 'A2', 'B1', 'B2'] as const) {
        await db.prepare(`INSERT INTO users (id, username, display_name, password_salt, password_digest, created_at, updated_at)
          VALUES (?, ?, ?, 'synthetic', 'synthetic', ?, ?)`).bind(level, level, level, at, at).run()
        expect(await bootstrapStarterPack(db, level, level, at)).toMatchObject({ kind: 'created', starter_cards_created: 20 })
        expect(await bootstrapStarterPack(db, level, level, at)).toMatchObject({ kind: 'repeat', starter_cards_created: 0 })
        expect((await db.prepare(`SELECT DISTINCT catalog.cefr_level AS level FROM flashcards AS card
          JOIN vocabulary_catalog AS catalog ON catalog.id = card.vocabulary_catalog_id WHERE card.user_id = ?`)
          .bind(level).all()).results).toEqual([{ level }])
      }
    } finally { await platform.dispose(); f.sqlite.close(); await rm(directory, { recursive: true, force: true }) }
  }, 90_000)
})
