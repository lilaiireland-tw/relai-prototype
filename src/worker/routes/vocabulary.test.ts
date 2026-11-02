import { readFileSync, readdirSync } from 'node:fs'
import { DatabaseSync } from 'node:sqlite'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createApp } from '../index'
import { digestSessionToken, generateSessionToken } from '../auth/crypto'
import { createRepositories } from '../persistence'
import type { PersistenceDatabase, PersistenceStatement, SqlValue } from '../persistence/d1'
import type { VocabularySelection, VocabularySuggestion } from '../services/vocabulary-image'
import { normalizeSense } from '../services/vocabulary-catalog'

const now = '2027-01-02T10:00:00.000Z'
const suggestion: VocabularySuggestion = {
  headword: 'curious', part_of_speech: 'adjective', semantic_sense: 'eager to know or learn',
  source_context: 'She was curious about the old map.', confidence: 0.99,
}
const completeContent = {
  zh_tw_definition: '好奇的',
  english_example: 'She was curious about the old map.',
  zh_tw_example_translation: '她對那張舊地圖感到好奇。',
}
const png = new Uint8Array(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/lJ8AAAAASUVORK5CYII=', 'base64'))

function sqliteD1(sqlite: DatabaseSync): PersistenceDatabase {
  type Executable = PersistenceStatement & { execute(): { changes: number | bigint } }
  function statement(sql: string, values: SqlValue[] = []): Executable {
    return {
      bind: (...bound) => statement(sql, bound),
      async first<T>() { return (sqlite.prepare(sql).get(...values) as T | undefined) ?? null },
      async all<T>() { return { success: true, results: sqlite.prepare(sql).all(...values) as T[] } },
      async run() { return { success: true, meta: { changes: Number(sqlite.prepare(sql).run(...values).changes) } } },
      execute: () => sqlite.prepare(sql).run(...values),
    }
  }
  return {
    prepare: sql => statement(sql),
    async batch(statements) {
      sqlite.exec('BEGIN')
      try {
        const results = statements.map(value => ({ success: true,
          meta: { changes: Number((value as Executable).execute().changes) } }))
        sqlite.exec('COMMIT')
        return results
      } catch (error) {
        sqlite.exec('ROLLBACK')
        throw error
      }
    },
  }
}

function modelOutput(value: unknown) {
  return Response.json({ status: 'completed', steps: [{ type: 'model_output',
    content: [{ type: 'text', text: JSON.stringify(value) }] }] })
}

function selection(item: VocabularySuggestion): VocabularySelection {
  return { headword: item.headword, part_of_speech: item.part_of_speech,
    semantic_sense: item.semantic_sense, source_context: item.source_context }
}

describe('authenticated canonical image vocabulary', () => {
  let sqlite: DatabaseSync
  let db: PersistenceDatabase
  const app = createApp()
  const bindings = { GEMINI_API_KEY: 'synthetic-test-key', GEMINI_MODEL: 'gemini-3.8-flash' }

  beforeEach(() => {
    sqlite = new DatabaseSync(':memory:')
    sqlite.exec('PRAGMA foreign_keys = ON')
    for (const name of readdirSync('migrations').filter(name => name.endsWith('.sql')).sort()) {
      sqlite.exec(readFileSync(`migrations/${name}`, 'utf8'))
    }
    db = sqliteD1(sqlite)
  })
  afterEach(() => { sqlite.close(); vi.unstubAllGlobals() })

  async function session(userId: string, role = 'user') {
    const repos = createRepositories(db)
    await repos.users.create({ id: userId, username: userId, display_name: userId, role,
      password_salt: 'synthetic', password_digest: 'synthetic', must_change_password: false,
      created_at: now, updated_at: now })
    const token = generateSessionToken()
    await repos.sessions.create({ id: crypto.randomUUID(), user_id: userId,
      token_digest: await digestSessionToken(token), created_at: now, expires_at: '2027-01-09T10:00:00.000Z' })
    return `relai_session=${token}`
  }

  async function sourceItem(userId: string, items: VocabularySuggestion[] = [suggestion]) {
    const id = crypto.randomUUID()
    await db.prepare(`INSERT INTO source_items
      (id, user_id, source_type, raw_text, processing_status, ai_model, created_at, updated_at)
      VALUES (?, ?, 'image', ?, 'processed', 'gemini-3.8-flash', ?, ?)`)
      .bind(id, userId, JSON.stringify({ version: 1, suggestions: items }), now, now).run()
    return id
  }

  function upload(cookie: string | undefined, file: File, extra = false) {
    const form = new FormData()
    form.append('image', file)
    if (extra) form.append('other', 'ignored')
    return app.request('https://example.test/relaiapp/api/v1/vocabulary/image', {
      method: 'POST', headers: cookie ? { Cookie: cookie } : {}, body: form,
    }, { DB: db, AUTH_PEPPER: 'synthetic', ...bindings })
  }

  function save(cookie: string, sourceId: string, items: VocabularySelection[]) {
    return app.request('https://example.test/relaiapp/api/v1/vocabulary/save', {
      method: 'POST', headers: { Cookie: cookie, 'Content-Type': 'application/json' },
      body: JSON.stringify({ source_item_id: sourceId, items }),
    }, { DB: db, AUTH_PEPPER: 'synthetic', ...bindings })
  }

  function addCatalog(item: VocabularySuggestion,
    fields: Partial<Record<keyof typeof completeContent, string | null>>, id: string = crypto.randomUUID()) {
    sqlite.prepare(`INSERT INTO vocabulary_catalog (id, headword, normalized_key, part_of_speech,
      part_of_speech_key, sense_key, semantic_sense, cefr_level, source_dataset, source_version,
      provenance, zh_tw_definition, english_example, zh_tw_example_translation, publication_status,
      content_version, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, 'B1', 'test', '1', 'fixture', ?, ?, ?, 'published', 1, ?, ?)`)
      .run(id, item.headword, item.headword.normalize('NFKC').trim().toLowerCase(), item.part_of_speech,
        item.part_of_speech, normalizeSense(item.semantic_sense), item.semantic_sense,
        fields.zh_tw_definition ?? null, fields.english_example ?? null,
        fields.zh_tw_example_translation ?? null, now, now)
    sqlite.prepare(`INSERT INTO vocabulary_catalog_versions (id, catalog_id, version, content_hash,
      zh_tw_definition, english_example, zh_tw_example_translation, provenance, created_at)
      SELECT ?, id, content_version, content_hash, zh_tw_definition, english_example,
        zh_tw_example_translation, provenance, created_at FROM vocabulary_catalog WHERE id = ?`)
      .run(crypto.randomUUID(), id)
    return id
  }

  it('recognizes a real image into a versioned context-only contract and stores no image bytes', async () => {
    const cookie = await session('owner')
    const payload = { version: 1, suggestions: [suggestion] }
    const gemini = vi.fn<typeof fetch>().mockResolvedValue(modelOutput(payload))
    vi.stubGlobal('fetch', gemini)
    const response = await upload(cookie, new File([png], 'sample.png', { type: 'image/png' }))
    expect(response.status).toBe(200)
    const result = await response.json() as { contract_version: number; source_item_id: string; suggestions: VocabularySuggestion[] }
    expect(result).toMatchObject({ contract_version: 1, suggestions: [suggestion] })
    expect(gemini).toHaveBeenCalledOnce()
    const [url, request] = gemini.mock.calls[0]
    expect(url).toBe('https://generativelanguage.googleapis.com/v1beta/interactions')
    expect(new Headers(request?.headers).get('x-goog-api-key')).toBe('synthetic-test-key')
    expect(JSON.stringify(request?.body)).not.toContain('synthetic-test-key')
    const source = sqlite.prepare('SELECT user_id, raw_text, ai_model FROM source_items').get() as {
      user_id: string; raw_text: string; ai_model: string
    }
    expect(source).toMatchObject({ user_id: 'owner', ai_model: 'gemini-3.8-flash' })
    expect(JSON.parse(source.raw_text)).toEqual(payload)
    expect(source.raw_text).not.toContain(Buffer.from(png).toString('base64'))
    expect(sqlite.prepare('SELECT COUNT(*) AS count FROM flashcards').get()).toEqual({ count: 0 })
  })

  it('rejects unauthenticated, malformed uploads, unsupported models and invalid structured output', async () => {
    expect((await upload(undefined, new File([png], 'sample.png', { type: 'image/png' }))).status).toBe(401)
    const cookie = await session('owner')
    const gemini = vi.fn<typeof fetch>().mockResolvedValue(modelOutput({ version: 1, suggestions: [] }))
    vi.stubGlobal('fetch', gemini)
    expect((await upload(cookie, new File([png], 'sample.png', { type: 'image/png' }), true)).status).toBe(400)
    expect((await upload(cookie, new File([png], 'sample.jpg', { type: 'image/jpeg' }))).status).toBe(415)
    expect((await upload(cookie, new File([new Uint8Array(5 * 1024 * 1024 + 1)], 'large.png', { type: 'image/png' }))).status).toBe(413)
    const badModel = await app.request('https://example.test/relaiapp/api/v1/vocabulary/image', {
      method: 'POST', headers: { Cookie: cookie }, body: (() => { const form = new FormData(); form.append('image', new File([png], 'sample.png', { type: 'image/png' })); return form })(),
    }, { DB: db, AUTH_PEPPER: 'synthetic', GEMINI_API_KEY: 'test', GEMINI_MODEL: 'gemini-3.8-flash-tts' })
    expect(badModel.status).toBe(503)
    vi.stubGlobal('fetch', vi.fn<typeof fetch>().mockResolvedValue(modelOutput({ suggestions: [{ ...suggestion, confidence: 'high' }] })))
    expect((await upload(cookie, new File([png], 'sample.png', { type: 'image/png' }))).status).toBe(502)
    expect(sqlite.prepare('SELECT COUNT(*) AS count FROM source_items').get()).toEqual({ count: 0 })
  })

  it('reuses a complete canonical sense across users without lexical AI calls', async () => {
    const ownerCookie = await session('owner')
    const otherCookie = await session('other')
    const ownerSource = await sourceItem('owner')
    const otherSource = await sourceItem('other')
    const canonical = addCatalog(suggestion, completeContent, 'curious-canonical')
    const gemini = vi.fn<typeof fetch>()
    vi.stubGlobal('fetch', gemini)
    const first = await save(ownerCookie, ownerSource, [selection(suggestion)])
    const second = await save(otherCookie, otherSource, [selection(suggestion)])
    const firstResult = await first.json() as { results: { status: string; card_id: string }[]; cards: { id: string; source_item_id: string }[] }
    const secondResult = await second.json() as { results: { status: string; card_id: string }[]; cards: { id: string; source_item_id: string }[] }
    expect(firstResult.results[0]).toMatchObject({ status: 'saved', card_id: expect.any(String) })
    expect(firstResult.cards[0]).toMatchObject({ id: firstResult.results[0].card_id, source_item_id: ownerSource })
    expect(secondResult.results[0].status).toBe('saved')
    expect(secondResult.cards).toHaveLength(1)
    expect(gemini).not.toHaveBeenCalled()
    expect(sqlite.prepare('SELECT user_id, vocabulary_catalog_id FROM flashcards ORDER BY user_id').all())
      .toEqual([{ user_id: 'other', vocabulary_catalog_id: canonical }, { user_id: 'owner', vocabulary_catalog_id: canonical }])
    expect(sqlite.prepare('SELECT zh_tw_definition FROM vocabulary_catalog WHERE id = ?').get(canonical))
      .toEqual({ zh_tw_definition: completeContent.zh_tw_definition })
    expect(sqlite.prepare('SELECT COUNT(*) AS count FROM user_vocabulary_items').get()).toEqual({ count: 0 })
  })

  it('enriches only missing catalog fields and appends a content version', async () => {
    const cookie = await session('owner')
    const sourceId = await sourceItem('owner')
    const existing = { zh_tw_definition: '既有且已驗證的定義', english_example: null, zh_tw_example_translation: null }
    const canonical = addCatalog(suggestion, existing, 'incomplete-canonical')
    const gemini = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(modelOutput({ version: 1, items: [{ item_index: 0,
        english_example: completeContent.english_example,
        zh_tw_example_translation: completeContent.zh_tw_example_translation }] }))
    vi.stubGlobal('fetch', gemini)
    const response = await save(cookie, sourceId, [selection(suggestion)])
    expect((await response.json() as { results: { status: string }[] }).results[0].status).toBe('saved')
    expect(gemini).toHaveBeenCalledTimes(1)
    const request = JSON.parse(String(gemini.mock.calls[0][1]?.body)) as { input: string }
    expect(request.input).toContain('"missing":["english_example","zh_tw_example_translation"]')
    expect(request.input).toContain('既有且已驗證的定義')
    expect(sqlite.prepare('SELECT zh_tw_definition, english_example, zh_tw_example_translation, content_version FROM vocabulary_catalog WHERE id = ?')
      .get(canonical)).toEqual({ zh_tw_definition: '既有且已驗證的定義',
        english_example: completeContent.english_example, zh_tw_example_translation: completeContent.zh_tw_example_translation,
        content_version: 2 })
    expect(sqlite.prepare('SELECT version FROM vocabulary_catalog_versions WHERE catalog_id = ? ORDER BY version').all(canonical))
      .toEqual([{ version: 1 }, { version: 2 }])
    const provenance = JSON.parse(String((sqlite.prepare('SELECT provenance FROM vocabulary_catalog WHERE id = ?').get(canonical) as { provenance: string }).provenance))
    expect(provenance).toMatchObject({ previous: 'fixture', enrichment: { field_validation: 'passed' } })
  })

  it('creates a new published sense without inventing a CEFR level', async () => {
    const cookie = await session('owner')
    const sourceId = await sourceItem('owner')
    vi.stubGlobal('fetch', vi.fn<typeof fetch>().mockResolvedValue(
      modelOutput({ version: 1, items: [{ item_index: 0, ...completeContent }] })))
    const response = await save(cookie, sourceId, [selection(suggestion)])
    const result = await response.json() as { results: { status: string; card_id: string }[]; cards: { id: string }[] }
    expect(result.results[0]).toMatchObject({ status: 'saved', card_id: result.cards[0].id })
    const catalog = sqlite.prepare(`SELECT id, cefr_level, publication_status, content_version, source_dataset,
      provenance
      FROM vocabulary_catalog WHERE normalized_key = 'curious'`).get() as Record<string, unknown>
    expect(catalog).toMatchObject({ cefr_level: null, publication_status: 'published', content_version: 1, source_dataset: 'gemini-ai' })
    expect(String(catalog.provenance)).not.toContain('source_item_id')
    expect(String(catalog.provenance)).not.toContain(suggestion.source_context)
    expect(sqlite.prepare('SELECT catalog_id, version FROM vocabulary_catalog_versions WHERE catalog_id = ?').all(String(catalog.id)))
      .toEqual([{ catalog_id: catalog.id, version: 1 }])
    expect(sqlite.prepare('SELECT vocabulary_catalog_id FROM flashcards WHERE user_id = ?').get('owner'))
      .toEqual({ vocabulary_catalog_id: catalog.id })
    expect(sqlite.prepare('SELECT source_item_id FROM flashcards WHERE user_id = ?').get('owner'))
      .toEqual({ source_item_id: sourceId })
  })

  it('keeps two senses of bank as separate canonical IDs', async () => {
    const cookie = await session('owner')
    const bankSenses: VocabularySuggestion[] = [
      { ...suggestion, headword: 'bank', part_of_speech: 'noun', semantic_sense: 'financial institution',
        source_context: 'She deposited the money at the bank.' },
      { ...suggestion, headword: 'bank', part_of_speech: 'noun', semantic_sense: 'land beside a river',
        source_context: 'They sat on the bank of the river.' },
    ]
    const sourceId = await sourceItem('owner', bankSenses)
    const generated = bankSenses.map((item, item_index) => ({ item_index,
      zh_tw_definition: item.semantic_sense, english_example: item.source_context,
      zh_tw_example_translation: `翻譯 ${item_index}` }))
    vi.stubGlobal('fetch', vi.fn<typeof fetch>()
      .mockResolvedValueOnce(modelOutput({ version: 1, items: generated })))
    const response = await save(cookie, sourceId, bankSenses.map(selection))
    expect((await response.json() as { results: { status: string }[] }).results.map(row => row.status))
      .toEqual(['saved', 'saved'])
    const entries = sqlite.prepare(`SELECT id, sense_key FROM vocabulary_catalog WHERE normalized_key = 'bank'
      AND publication_status = 'published' ORDER BY sense_key`).all() as { id: string; sense_key: string }[]
    expect(entries).toHaveLength(2)
    expect(new Set(entries.map(row => row.sense_key)).size).toBe(2)
    expect(sqlite.prepare('SELECT COUNT(DISTINCT vocabulary_catalog_id) AS count FROM flashcards').get())
      .toEqual({ count: 2 })
  })

  it('links concurrent users to one canonical row and is idempotent on repeated saves', async () => {
    const ownerCookie = await session('owner')
    const otherCookie = await session('other')
    const ownerSource = await sourceItem('owner')
    const otherSource = await sourceItem('other')
    const gemini = vi.fn<typeof fetch>().mockImplementation(async (_input, init) => {
      const request = JSON.parse(String(init?.body)) as { input: string }
      return request.input.startsWith('Generate only')
        ? modelOutput({ version: 1, items: [{ item_index: 0, ...completeContent }] })
        : modelOutput({ version: 1, matches: [{ item_index: 0, action: 'new', candidate_index: null, confidence: 0.99 }] })
    })
    vi.stubGlobal('fetch', gemini)
    const [first, concurrent] = await Promise.all([
      save(ownerCookie, ownerSource, [selection(suggestion)]), save(otherCookie, otherSource, [selection(suggestion)]),
    ])
    expect((await first.json() as { results: { status: string }[] }).results[0].status).toBe('saved')
    expect((await concurrent.json() as { results: { status: string }[] }).results[0].status).toBe('saved')
    const ids = sqlite.prepare('SELECT DISTINCT vocabulary_catalog_id FROM flashcards ORDER BY vocabulary_catalog_id').all() as { vocabulary_catalog_id: string }[]
    expect(ids).toHaveLength(1)
    const retry = await save(ownerCookie, ownerSource, [selection(suggestion)])
    expect((await retry.json() as { results: { status: string }[] }).results[0].status).toBe('already_saved')
    expect(sqlite.prepare('SELECT COUNT(*) AS count FROM flashcards WHERE user_id = ?').get('owner')).toEqual({ count: 1 })
    expect(sqlite.prepare('SELECT COUNT(*) AS count FROM user_stats WHERE user_id = ?').get('owner')).toEqual({ count: 1 })
    expect(gemini).toHaveBeenCalledTimes(2)
  })

  it('returns ambiguous senses for user resolution without blocking eligible words', async () => {
    const ownerCookie = await session('owner')
    const bank: VocabularySuggestion = { ...suggestion, headword: 'bank', part_of_speech: 'noun',
      semantic_sense: 'a place beside a river', source_context: 'They sat on the bank beside the river.' }
    const other: VocabularySuggestion = { ...bank, headword: 'curious', part_of_speech: 'adjective',
      semantic_sense: 'eager to know or learn', source_context: suggestion.source_context }
    const sourceId = await sourceItem('owner', [bank, other])
    const financialId = addCatalog({ ...bank, semantic_sense: 'financial institution' }, completeContent, 'bank-financial')
    const riverId = addCatalog({ ...bank, semantic_sense: 'land beside a river' }, completeContent, 'bank-river')
    vi.stubGlobal('fetch', vi.fn<typeof fetch>()
      .mockResolvedValueOnce(modelOutput({ version: 1, matches: [{ item_index: 0, action: 'ambiguous', candidate_index: null, confidence: 0.55 }] }))
      .mockResolvedValueOnce(modelOutput({ version: 1, items: [{ item_index: 1, ...completeContent }] })))
    const first = await save(ownerCookie, sourceId, [selection(bank), selection(other)])
    const result = await first.json() as { results: { status: string; options?: { catalog_id: string; semantic_sense: string }[] }[]; cards: { id: string }[] }
    expect(result.results.map(item => item.status)).toEqual(['ambiguous', 'saved'])
    expect(result.results[0].options).toEqual([
      { catalog_id: financialId, semantic_sense: 'financial institution' },
      { catalog_id: riverId, semantic_sense: 'land beside a river' },
    ])
    expect(result.cards).toHaveLength(1)
    expect(sqlite.prepare('SELECT COUNT(*) AS count FROM vocabulary_catalog_candidates').get()).toEqual({ count: 0 })

    const chosen = result.results[0].options![1]
    const resolved = await save(ownerCookie, sourceId, [{ ...selection(bank), semantic_sense: chosen.semantic_sense, resolve_sense: true }])
    const resolvedResult = await resolved.json() as { results: { status: string; card_id: string }[]; cards: { id: string }[] }
    expect(resolvedResult.results[0]).toMatchObject({ status: 'saved', card_id: resolvedResult.cards[0].id })
    expect(sqlite.prepare('SELECT vocabulary_catalog_id FROM flashcards WHERE id = ?').get(resolvedResult.results[0].card_id))
      .toEqual({ vocabulary_catalog_id: riverId })
  })

  it('saves valid words when one generated item fails deterministic field validation', async () => {
    const cookie = await session('owner')
    const second: VocabularySuggestion = { ...suggestion, headword: 'map', part_of_speech: 'noun',
      semantic_sense: 'a representation of an area', source_context: 'The map showed the river.' }
    const sourceId = await sourceItem('owner', [suggestion, second])
    vi.stubGlobal('fetch', vi.fn<typeof fetch>().mockResolvedValue(modelOutput({ version: 1, items: [
      { item_index: 0, ...completeContent },
      { item_index: 1, zh_tw_definition: '地圖', unexpected: 'reject this field' },
    ] })))
    const response = await save(cookie, sourceId, [selection(suggestion), selection(second)])
    expect(response.status).toBe(200)
    expect((await response.json() as { results: { status: string; reason?: string }[] }).results)
      .toMatchObject([{ status: 'saved' }, { status: 'not_saved', reason: 'invalid_content' }])
    expect(sqlite.prepare('SELECT COUNT(*) AS count FROM vocabulary_catalog WHERE normalized_key = ?').get('curious'))
      .toEqual({ count: 1 })
    expect(sqlite.prepare('SELECT COUNT(*) AS count FROM vocabulary_catalog WHERE normalized_key = ?').get('map'))
      .toEqual({ count: 0 })
    expect(sqlite.prepare('SELECT COUNT(*) AS count FROM vocabulary_catalog_candidates').get()).toEqual({ count: 0 })
    expect(sqlite.prepare('SELECT COUNT(*) AS count FROM flashcards').get()).toEqual({ count: 1 })
  })
})
