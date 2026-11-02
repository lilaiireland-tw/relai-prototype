import { readFileSync, readdirSync } from 'node:fs'
import { DatabaseSync } from 'node:sqlite'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createApp } from '../index'
import { digestSessionToken, generateSessionToken } from '../auth/crypto'
import { createRepositories } from '../persistence'
import type { PersistenceDatabase, PersistenceStatement, SqlValue } from '../persistence/d1'
import type { VocabularySuggestion } from '../services/vocabulary-image'

const now = '2027-01-02T10:00:00.000Z'
const reviewed = JSON.parse(readFileSync('data/ai-enrichment/b1-sample-20.json', 'utf8')) as {
  id: string; headword: string; part_of_speech: string; cefr_level: string; zh_tw_definition: string
  english_example: string; zh_tw_example_translation: string; irish_usage: string | null
}[]
const suggestion: VocabularySuggestion = {
  headword: 'curious', part_of_speech: 'adjective', zh_tw_definition: '好奇的',
  english_example: 'She was curious about the old map.', zh_tw_example_translation: '她對那張舊地圖感到好奇。',
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

describe('authenticated image vocabulary', () => {
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

  async function session(userId: string) {
    const repos = createRepositories(db)
    await repos.users.create({ id: userId, username: userId, display_name: userId,
      password_salt: 'synthetic', password_digest: 'synthetic', must_change_password: false,
      created_at: now, updated_at: now })
    const token = generateSessionToken()
    await repos.sessions.create({ id: crypto.randomUUID(), user_id: userId,
      token_digest: await digestSessionToken(token), created_at: now, expires_at: '2027-01-09T10:00:00.000Z' })
    return `relai_session=${token}`
  }

  async function sourceItem(userId: string) {
    const id = crypto.randomUUID()
    await db.prepare(`INSERT INTO source_items
      (id, user_id, source_type, raw_text, processing_status, ai_model, created_at, updated_at)
      VALUES (?, ?, 'image', NULL, 'processed', 'gemini-3.8-flash', ?, ?)`)
      .bind(id, userId, now, now).run()
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

  function save(cookie: string, sourceId: string, items: VocabularySuggestion[]) {
    return app.request('https://example.test/relaiapp/api/v1/vocabulary/save', {
      method: 'POST', headers: { Cookie: cookie, 'Content-Type': 'application/json' },
      body: JSON.stringify({ source_item_id: sourceId, items }),
    }, { DB: db, AUTH_PEPPER: 'synthetic', ...bindings })
  }

  function addReviewedCatalog(row: typeof reviewed[number]) {
    sqlite.prepare(`INSERT INTO vocabulary_catalog (id, headword, normalized_key, part_of_speech, cefr_level,
      source_dataset, source_version, provenance, zh_tw_definition, english_example,
      zh_tw_example_translation, irish_usage, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, 'CEFR-J Vocabulary Profile', '1.6', 'reviewed source', ?, ?, ?, ?, ?, ?)`)
      .run(row.id, row.headword, row.headword.toLowerCase(), row.part_of_speech, row.cefr_level,
        row.zh_tw_definition, row.english_example, row.zh_tw_example_translation, row.irish_usage, now, now)
  }

  it('validates one real image, calls Gemini server-side, and stores no image bytes', async () => {
    const cookie = await session('owner')
    const payload = { status: 'completed', steps: [{ type: 'model_output', content: [{ type: 'text', text: JSON.stringify({ suggestions: [suggestion] }) }] }] }
    const gemini = vi.fn<typeof fetch>().mockResolvedValue(Response.json(payload))
    vi.stubGlobal('fetch', gemini)
    const response = await upload(cookie, new File([png], 'sample.png', { type: 'image/png' }))
    expect(response.status).toBe(200)
    const result = await response.json() as { source_item_id: string; suggestions: VocabularySuggestion[] }
    expect(result.suggestions).toEqual([suggestion])
    expect(gemini).toHaveBeenCalledOnce()
    const [url, request] = gemini.mock.calls[0]
    expect(url).toBe('https://generativelanguage.googleapis.com/v1beta/interactions')
    expect(new Headers(request?.headers).get('x-goog-api-key')).toBe('synthetic-test-key')
    expect(JSON.stringify(request?.body)).not.toContain('synthetic-test-key')
    expect(JSON.stringify(sqlite.prepare('SELECT user_id, source_type, raw_text, ai_model FROM source_items').get()))
      .toBe(JSON.stringify({ user_id: 'owner', source_type: 'image', raw_text: null, ai_model: 'gemini-3.8-flash' }))
    expect(sqlite.prepare('SELECT COUNT(*) AS count FROM flashcards').get()).toEqual({ count: 0 })
  })

  it('rejects unauthenticated, multiple-field, mislabeled, oversized, and invalid-model uploads safely', async () => {
    const unauthorized = await upload(undefined, new File([png], 'sample.png', { type: 'image/png' }))
    expect(unauthorized.status).toBe(401)
    const cookie = await session('owner')
    const gemini = vi.fn<typeof fetch>().mockResolvedValue(Response.json({}))
    vi.stubGlobal('fetch', gemini)
    expect((await upload(cookie, new File([png], 'sample.png', { type: 'image/png' }), true)).status).toBe(400)
    expect((await upload(cookie, new File([png], 'sample.jpg', { type: 'image/jpeg' }))).status).toBe(415)
    expect((await upload(cookie, new File([new Uint8Array(5 * 1024 * 1024 + 1)], 'large.png', { type: 'image/png' }))).status).toBe(413)
    expect(gemini).not.toHaveBeenCalled()
    const badModel = await app.request('https://example.test/relaiapp/api/v1/vocabulary/image', {
      method: 'POST', headers: { Cookie: cookie }, body: (() => { const form = new FormData(); form.append('image', new File([png], 'sample.png', { type: 'image/png' })); return form })(),
    }, { DB: db, AUTH_PEPPER: 'synthetic', GEMINI_API_KEY: 'test', GEMINI_MODEL: 'gemini-3.8-flash-tts' })
    expect(badModel.status).toBe(503)
    expect(gemini).not.toHaveBeenCalled()
  })

  it('fails safely on invalid Gemini output and upstream errors without persisting extraction state', async () => {
    const cookie = await session('owner')
    for (const response of [
      Response.json({ status: 'completed', steps: [] }),
      new Response('private upstream error', { status: 429 }),
    ]) {
      vi.stubGlobal('fetch', vi.fn<typeof fetch>().mockResolvedValue(response))
      const result = await upload(cookie, new File([png], 'sample.png', { type: 'image/png' }))
      expect(result.status).toBe(502)
      expect(await result.text()).not.toContain('private upstream error')
    }
    vi.stubGlobal('fetch', vi.fn<typeof fetch>().mockRejectedValue(new DOMException('private timeout detail', 'TimeoutError')))
    expect((await upload(cookie, new File([png], 'sample.png', { type: 'image/png' }))).status).toBe(502)
    expect(sqlite.prepare('SELECT COUNT(*) AS count FROM source_items').get()).toEqual({ count: 0 })
  })

  it('saves catalog and personal entries, deduplicates, and returns persisted cards', async () => {
    const cookie = await session('owner')
    const sourceId = await sourceItem('owner')
    const canonical = reviewed[0]
    addReviewedCatalog(canonical)
    const catalogSuggestion: VocabularySuggestion = {
      headword: canonical.headword, part_of_speech: canonical.part_of_speech,
      zh_tw_definition: canonical.zh_tw_definition, english_example: canonical.english_example,
      zh_tw_example_translation: canonical.zh_tw_example_translation,
    }
    const personal: VocabularySuggestion = { ...suggestion }
    const first = await save(cookie, sourceId, [catalogSuggestion, personal])
    expect(first.status).toBe(200)
    expect(await first.json()).toEqual({ results: [
      { headword: canonical.headword, status: 'saved' }, { headword: 'curious', status: 'saved' },
    ] })
    expect(sqlite.prepare('SELECT vocabulary_catalog_id, user_vocabulary_item_id FROM flashcards ORDER BY vocabulary_catalog_id').all())
      .toEqual([{ vocabulary_catalog_id: null, user_vocabulary_item_id: expect.any(String) },
        { vocabulary_catalog_id: canonical.id, user_vocabulary_item_id: null }])
    expect(sqlite.prepare('SELECT headword, zh_tw_definition, source FROM user_vocabulary_items').get())
      .toEqual({ headword: 'curious', zh_tw_definition: '好奇的', source: 'Gemini image extraction' })
    expect(sqlite.prepare('SELECT total_cards_created FROM user_stats WHERE user_id = ?').get('owner'))
      .toEqual({ total_cards_created: 2 })
    const retry = await save(cookie, sourceId, [catalogSuggestion, personal])
    expect(await retry.json()).toEqual({ results: [
      { headword: canonical.headword, status: 'already_saved' }, { headword: 'curious', status: 'already_saved' },
    ] })
    const concurrent: VocabularySuggestion = { headword: 'landmark', part_of_speech: 'noun', zh_tw_definition: '地標',
      english_example: 'The landmark is easy to find.', zh_tw_example_translation: '這個地標很容易找到。' }
    const retries = await Promise.all([save(cookie, sourceId, [concurrent]), save(cookie, sourceId, [concurrent])])
    const statuses = await Promise.all(retries.map(async response =>
      (await response.json() as { results: { status: string }[] }).results[0].status))
    expect(statuses.sort()).toEqual(['already_saved', 'saved'])
    expect(sqlite.prepare('SELECT COUNT(*) AS count FROM flashcards WHERE user_id = ?').get('owner')).toEqual({ count: 3 })
    expect(sqlite.prepare('SELECT total_cards_created FROM user_stats WHERE user_id = ?').get('owner'))
      .toEqual({ total_cards_created: 3 })
    const cards = await app.request('https://example.test/relaiapp/api/v1/cards?limit=100', {
      headers: { Cookie: cookie },
    }, { DB: db, AUTH_PEPPER: 'synthetic' })
    const listed = await cards.json() as { cards: { front_content: string; back_content: string; source_item_id: string | null }[] }
    expect(listed.cards).toHaveLength(3)
    expect(listed.cards.find(card => card.front_content === 'curious')).toMatchObject({
      back_content: expect.stringContaining('好奇的'), source_item_id: sourceId,
    })
  })

  it('marks missing or mismatched catalog definitions pending and isolates users', async () => {
    const ownerCookie = await session('owner')
    const otherCookie = await session('other')
    const ownerSource = await sourceItem('owner')
    const otherSource = await sourceItem('other')
    const canonical = reviewed[1]
    const missingDefinition = reviewed[2]
    addReviewedCatalog(canonical)
    addReviewedCatalog(missingDefinition)
    sqlite.prepare('UPDATE vocabulary_catalog SET zh_tw_definition = NULL WHERE id = ?').run(missingDefinition.id)
    const mismatch: VocabularySuggestion = {
      headword: canonical.headword, part_of_speech: canonical.part_of_speech,
      zh_tw_definition: 'different meaning', english_example: 'A sentence.', zh_tw_example_translation: '翻譯。',
    }
    const noDefinition: VocabularySuggestion = { headword: missingDefinition.headword,
      part_of_speech: missingDefinition.part_of_speech, zh_tw_definition: missingDefinition.zh_tw_definition,
      english_example: missingDefinition.english_example, zh_tw_example_translation: missingDefinition.zh_tw_example_translation }
    const pending = await save(ownerCookie, ownerSource, [mismatch, noDefinition])
    expect(await pending.json()).toEqual({ results: [
      { headword: canonical.headword, status: 'pending', reason: 'definition_mismatch', catalog_definition: canonical.zh_tw_definition },
      { headword: missingDefinition.headword, status: 'pending', reason: 'definition_missing', catalog_definition: null },
    ] })
    expect(sqlite.prepare('SELECT COUNT(*) AS count FROM flashcards').get()).toEqual({ count: 0 })
    expect((await save(otherCookie, ownerSource, [suggestion])).status).toBe(404)
    const first = await save(ownerCookie, ownerSource, [suggestion])
    const second = await save(otherCookie, otherSource, [suggestion])
    expect((await first.json() as { results: { status: string }[] }).results[0].status).toBe('saved')
    expect((await second.json() as { results: { status: string }[] }).results[0].status).toBe('saved')
    expect(sqlite.prepare('SELECT user_id, COUNT(*) AS count FROM flashcards GROUP BY user_id ORDER BY user_id').all())
      .toEqual([{ user_id: 'other', count: 1 }, { user_id: 'owner', count: 1 }])
  })

  it('rolls back personal vocabulary if its flashcard cannot be created', async () => {
    const cookie = await session('owner')
    const sourceId = await sourceItem('owner')
    sqlite.exec(`CREATE TRIGGER reject_card BEFORE INSERT ON flashcards
      BEGIN SELECT RAISE(ABORT, 'synthetic failure'); END`)
    const response = await save(cookie, sourceId, [suggestion])
    expect(response.status).toBe(500)
    expect(sqlite.prepare('SELECT COUNT(*) AS count FROM user_vocabulary_items').get()).toEqual({ count: 0 })
    expect(sqlite.prepare('SELECT COUNT(*) AS count FROM flashcards').get()).toEqual({ count: 0 })
    expect(sqlite.prepare('SELECT COUNT(*) AS count FROM user_stats').get()).toEqual({ count: 0 })
  })
})
