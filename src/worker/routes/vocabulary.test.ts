import { readFileSync, readdirSync } from 'node:fs'
import { DatabaseSync } from 'node:sqlite'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createApp } from '../index'
import { digestSessionToken, generateSessionToken } from '../auth/crypto'
import { createRepositories } from '../persistence'
import { saveVocabulary as persistVocabulary } from '../persistence/vocabulary'
import type { PersistenceDatabase, PersistenceStatement, SqlValue } from '../persistence/d1'
import type { VocabularySelection, VocabularySuggestion } from '../services/vocabulary-image'
import { normalizeSense, prepareVocabulary } from '../services/vocabulary-catalog'

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
const storedImages = new Map<string, Uint8Array>()
const queueSend = vi.fn(async (message: { job_id: string }) => { void message.job_id })
const imageBindings = {
  IMAGE_JOBS: { send: queueSend },
  IMAGE_STORAGE: {
    async put(key: string, value: Uint8Array) { storedImages.set(key, new Uint8Array(value)) },
    async get(key: string) {
      const value = storedImages.get(key)
      return value ? { async arrayBuffer() { return new Uint8Array(value).buffer as ArrayBuffer } } : null
    },
    async delete(key: string) { storedImages.delete(key) },
    async list() { return { objects: [...storedImages.keys()].map(key => ({ key, uploaded: new Date(now) })), truncated: false } },
  },
}

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
  const bindings = { GEMINI_API_KEY: 'synthetic-test-key', GEMINI_MODEL: 'gemini-3.8-flash', ...imageBindings }

  beforeEach(() => {
    sqlite = new DatabaseSync(':memory:')
    sqlite.exec('PRAGMA foreign_keys = ON')
    for (const name of readdirSync('migrations').filter(name => name.endsWith('.sql')).sort()) {
      sqlite.exec(readFileSync(`migrations/${name}`, 'utf8'))
    }
    db = sqliteD1(sqlite)
    storedImages.clear(); queueSend.mockClear()
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
    await db.prepare(`INSERT INTO image_vocabulary_jobs (job_id, user_id, idempotency_key, image_hash, mime_type,
      quota_date, status, stage, results_json, next_dispatch_at, created_at, updated_at)
      VALUES (?, ?, ?, 'test-hash', 'image/png', '2027-01-02', 'completed', 'completed', NULL, ?, ?, ?)`)
      .bind(id, userId, crypto.randomUUID(), now, now, now).run()
    return id
  }

  async function completeSource(userId: string, sourceId: string, items: VocabularySuggestion[]) {
    const plans = await prepareVocabulary(db, items, bindings, 'gemini-3.8-flash')
    const results = await persistVocabulary(db, userId, sourceId, plans, now)
    const card_ids = results.flatMap(result => 'card_id' in result ? [result.card_id] : [])
    await db.prepare('UPDATE image_vocabulary_jobs SET results_json = ? WHERE job_id = ? AND user_id = ?')
      .bind(JSON.stringify({ results, card_ids }), sourceId, userId).run()
  }

  function upload(cookie: string | undefined, file: File, extra = false, key = crypto.randomUUID()) {
    const form = new FormData()
    form.append('image', file)
    if (extra) form.append('other', 'ignored')
    return app.request('https://example.test/relaiapp/api/v1/vocabulary/image-jobs', {
      method: 'POST', headers: cookie ? { Cookie: cookie, 'Idempotency-Key': key } : {}, body: form,
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

  it('accepts a valid image as a durable 202 job and sends only its id to the Queue', async () => {
    const cookie = await session('owner')
    const payload = { version: 1, suggestions: [suggestion] }
    const gemini = vi.fn<typeof fetch>().mockResolvedValue(modelOutput(payload))
    vi.stubGlobal('fetch', gemini)
    const response = await upload(cookie, new File([png], 'sample.png', { type: 'image/png' }))
    expect(response.status).toBe(202)
    const result = await response.json() as { job_id: string; status: string; quota: { used: number; remaining: number } }
    expect(result).toMatchObject({ job_id: expect.any(String), status: 'received', quota: { used: 1, remaining: 4 } })
    expect(gemini).not.toHaveBeenCalled()
    expect(queueSend).toHaveBeenCalledWith({ job_id: result.job_id }, { contentType: 'json' })
    expect(queueSend.mock.calls[0][0]).toEqual({ job_id: result.job_id })
    expect(storedImages.has(`image-jobs/${result.job_id}`)).toBe(true)
    expect(sqlite.prepare('SELECT id FROM source_items').all()).toEqual([])
    expect(sqlite.prepare('SELECT status, dispatch_attempts FROM image_vocabulary_jobs WHERE job_id = ?').get(result.job_id))
      .toEqual({ status: 'queued', dispatch_attempts: 1 })
    expect(sqlite.prepare('SELECT COUNT(*) AS count FROM flashcards').get()).toEqual({ count: 0 })
  })

  it('rejects unauthenticated and malformed uploads before quota or Queue work', async () => {
    expect((await upload(undefined, new File([png], 'sample.png', { type: 'image/png' }))).status).toBe(401)
    const cookie = await session('owner')
    const gemini = vi.fn<typeof fetch>().mockResolvedValue(modelOutput({ version: 1, suggestions: [] }))
    vi.stubGlobal('fetch', gemini)
    expect((await upload(cookie, new File([png], 'sample.png', { type: 'image/png' }), true)).status).toBe(400)
    expect((await upload(cookie, new File([png], 'sample.jpg', { type: 'image/jpeg' }))).status).toBe(415)
    expect((await upload(cookie, new File([new Uint8Array(5 * 1024 * 1024 + 1)], 'large.png', { type: 'image/png' }))).status).toBe(413)
    const badModel = await app.request('https://example.test/relaiapp/api/v1/vocabulary/image-jobs', {
      method: 'POST', headers: { Cookie: cookie, 'Idempotency-Key': crypto.randomUUID() }, body: (() => { const form = new FormData(); form.append('image', new File([png], 'sample.png', { type: 'image/png' })); return form })(),
    }, { DB: db, AUTH_PEPPER: 'synthetic', GEMINI_API_KEY: 'test', GEMINI_MODEL: 'gemini-3.8-flash-tts' })
    expect(badModel.status).toBe(503)
    vi.stubGlobal('fetch', vi.fn<typeof fetch>().mockResolvedValue(modelOutput({ suggestions: [{ ...suggestion, confidence: 'high' }] })))
    const accepted = await upload(cookie, new File([png], 'sample.png', { type: 'image/png' }))
    expect(accepted.status).toBe(202)
    expect(vi.mocked(fetch)).not.toHaveBeenCalled()
    expect(sqlite.prepare('SELECT COUNT(*) AS count FROM source_items').get()).toEqual({ count: 0 })
  })

  it('rejects legacy saves without persisted job results before any Gemini call', async () => {
    const cookie = await session('owner')
    const sourceId = await sourceItem('owner')
    const gemini = vi.fn<typeof fetch>()
    vi.stubGlobal('fetch', gemini)
    const response = await save(cookie, sourceId, [selection(suggestion)])
    expect(response.status).toBe(409)
    expect((await response.json() as { error: { code: string } }).error.code).toBe('IMAGE_JOB_ALREADY_PROCESSED')
    expect(gemini).not.toHaveBeenCalled()
  })

  it('reuses a complete canonical sense across users without lexical AI calls', async () => {
    const ownerCookie = await session('owner')
    const otherCookie = await session('other')
    const ownerSource = await sourceItem('owner')
    const otherSource = await sourceItem('other')
    const canonical = addCatalog(suggestion, completeContent, 'curious-canonical')
    const gemini = vi.fn<typeof fetch>()
    vi.stubGlobal('fetch', gemini)
    await completeSource('owner', ownerSource, [suggestion])
    const first = await save(ownerCookie, ownerSource, [selection(suggestion)])
    await completeSource('other', otherSource, [suggestion])
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
    await completeSource('owner', sourceId, [suggestion])
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
    await completeSource('owner', sourceId, [suggestion])
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

  it('generates concise Taiwan dictionary meanings and versions up to two shared usage patterns', async () => {
    const cookie = await session('owner')
    const sourceId = await sourceItem('owner')
    const usagePatterns = [
      { pattern: 'be curious about + noun', zh_tw_explanation: '對……感到好奇',
        example: 'She is curious about the map.', zh_tw_example_translation: '她對地圖感到好奇。' },
      { pattern: 'curious to + verb', zh_tw_explanation: '好奇想知道……',
        example: 'I was curious to see what happened.', zh_tw_example_translation: '我很好奇接下來發生了什麼。' },
    ]
    const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(modelOutput({ version: 1,
      items: [{ item_index: 0, zh_tw_definition: '好奇的；求知的',
        english_example: 'She was curious about the map.', zh_tw_example_translation: '她對那張地圖感到好奇。',
        usage_patterns: usagePatterns }] }))
    vi.stubGlobal('fetch', fetch)
    await completeSource('owner', sourceId, [suggestion])
    const response = await save(cookie, sourceId, [selection(suggestion)])
    const result = await response.json() as { results: { status: string }[]; cards: { usage_patterns: unknown[] }[] }
    expect(result.results[0].status).toBe('saved')
    expect(result.cards[0].usage_patterns).toEqual(usagePatterns)
    const prompt = JSON.parse(String(fetch.mock.calls[0][1]?.body)) as { input: string }
    expect(prompt.input).toContain('1–3 concise, idiomatic Taiwan Traditional Chinese dictionary equivalents')
    expect(prompt.input).toContain('「；」')
    expect(prompt.input).toContain('part_of_speech')
    expect(prompt.input).toContain('source_context')
    expect(prompt.input).toContain('She used to walk to work.')
    expect(prompt.input).toContain('She is used to walking to work.')
    expect(prompt.input).toContain('She used a map to find the station.')
    const catalog = sqlite.prepare(`SELECT zh_tw_definition, usage_patterns FROM vocabulary_catalog WHERE normalized_key = 'curious'`)
      .get() as { zh_tw_definition: string; usage_patterns: string }
    expect(catalog).toEqual({ zh_tw_definition: '好奇的；求知的', usage_patterns: JSON.stringify(usagePatterns) })
    const version = sqlite.prepare(`SELECT usage_patterns FROM vocabulary_catalog_versions WHERE catalog_id =
      (SELECT id FROM vocabulary_catalog WHERE normalized_key = 'curious')`).get() as { usage_patterns: string }
    expect(JSON.parse(version.usage_patterns)).toEqual(usagePatterns)
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
    await completeSource('owner', sourceId, bankSenses)
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
    await Promise.all([completeSource('owner', ownerSource, [suggestion]), completeSource('other', otherSource, [suggestion])])
    const [first, concurrent] = await Promise.all([
      save(ownerCookie, ownerSource, [selection(suggestion)]), save(otherCookie, otherSource, [selection(suggestion)]),
    ])
    expect((await first.json() as { results: { status: string }[] }).results[0].status).toBe('saved')
    expect((await concurrent.json() as { results: { status: string }[] }).results[0].status).toBe('saved')
    const ids = sqlite.prepare('SELECT DISTINCT vocabulary_catalog_id FROM flashcards ORDER BY vocabulary_catalog_id').all() as { vocabulary_catalog_id: string }[]
    expect(ids).toHaveLength(1)
    const retry = await save(ownerCookie, ownerSource, [selection(suggestion)])
    expect((await retry.json() as { results: { status: string }[] }).results[0].status).toBe('saved')
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
    await completeSource('owner', sourceId, [bank, other])
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
    await completeSource('owner', sourceId, [suggestion, second])
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
