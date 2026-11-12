import { readFileSync, readdirSync } from 'node:fs'
import { DatabaseSync } from 'node:sqlite'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { z } from 'zod'
import { prepareVocabulary } from './vocabulary-catalog'
import type { VocabularySuggestion } from './vocabulary-image'
import type { PersistenceDatabase, PersistenceStatement, SqlValue } from '../persistence/d1'
import {
  acceptImageJob, consumeImageJobs, imageJobStatus, imageQuota, imageQuotaWindow, processImageJob, recoverFailedImageJob,
  abandonImageJob, currentImageJob, type ImageJobEnv, type ImageJobMessage, type ImageStorage,
} from './image-vocabulary-jobs'

const now = new Date('2027-01-02T10:00:00.000Z')
const image = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 0])
const suggestion = { headword: 'curious', part_of_speech: 'adjective' as const, semantic_sense: 'eager to know',
  source_context: 'She was curious about the map.', confidence: 0.99 }
const pattern = { pattern: 'be curious about + noun', zh_tw_explanation: '對……感到好奇',
  example: 'She is curious about the map.', zh_tw_example_translation: '她對那張地圖感到好奇。' }

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
  if (typeof value === 'object' && value !== null && 'version' in value && value.version === 1 &&
    'suggestions' in value && Array.isArray(value.suggestions)) {
    value = { version: 2, outcome: 'english', suggestions: value.suggestions.map(item => ({ contextual_support: 'clear', ...item })) }
  }
  return Response.json({ status: 'completed', steps: [{ type: 'model_output',
    content: [{ type: 'text', text: JSON.stringify(value) }] }] })
}

function environment() {
  const sqlite = new DatabaseSync(':memory:')
  sqlite.exec('PRAGMA foreign_keys = ON')
  for (const name of readdirSync('migrations').filter(name => name.endsWith('.sql')).sort()) {
    sqlite.exec(readFileSync(`migrations/${name}`, 'utf8'))
  }
  sqlite.prepare(`INSERT INTO users (id, username, display_name, password_salt, password_digest, created_at, updated_at)
    VALUES ('owner', 'owner', 'Owner', 'salt', 'digest', ?, ?)`).run(now.toISOString(), now.toISOString())
  const objects = new Map<string, Uint8Array>()
  const sends: ImageJobMessage[] = []
  const listCalls: { prefix?: string; limit?: number; cursor?: string }[] = []
  const storage: ImageStorage = {
    async put(key, value) { objects.set(key, new Uint8Array(value)) },
    async get(key) { const value = objects.get(key); return value ? { async arrayBuffer() { return new Uint8Array(value).buffer as ArrayBuffer } } : null },
    async delete(key) { objects.delete(key) },
    async list(options = {}) {
      listCalls.push(options)
      const keys = [...objects.keys()].sort()
      const after = options.cursor ? keys.findIndex(key => key > options.cursor!) : 0
      const start = after < 0 ? keys.length : after
      const page = keys.slice(start, start + (options.limit ?? 100))
      const truncated = start + page.length < keys.length
      return { objects: page.map(key => ({ key, uploaded: now })), truncated,
        ...(truncated ? { cursor: page[page.length - 1] } : {}) }
    },
  }
  const env: ImageJobEnv = {
    DB: sqliteD1(sqlite), IMAGE_STORAGE: storage, GEMINI_API_KEY: 'test-key', GEMINI_MODEL: 'gemini-3.8-flash',
    IMAGE_JOBS: { async send(message) { sends.push(message) } },
  }
  return { sqlite, env, objects, sends, listCalls }
}

function interleaveBeforeRun(env: ImageJobEnv, sqlMatch: string, interleave: () => void) {
  const database = env.DB
  let interleaved = false
  function wrap(statement: PersistenceStatement, sql: string): PersistenceStatement {
    return {
      ...statement,
      bind(...values) { return wrap(statement.bind(...values), sql) },
      first: () => statement.first(),
      all: () => statement.all(),
      async run() {
        if (!interleaved && sql.includes(sqlMatch)) {
          interleaved = true
          interleave()
        }
        return statement.run()
      },
    }
  }
  env.DB = { ...database, prepare(sql) {
    return wrap(database.prepare(sql), sql)
  } }
  return () => interleaved
}

function addCatalog(sqlite: DatabaseSync, id: string, item: VocabularySuggestion = suggestion, level: string | null = null) {
  sqlite.prepare(`INSERT INTO vocabulary_catalog (id, headword, normalized_key, part_of_speech, part_of_speech_key,
    sense_key, semantic_sense, cefr_level, source_dataset, source_version, provenance, zh_tw_definition,
    english_example, zh_tw_example_translation, publication_status, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'test', '1', '{}', 'definition', 'An example.', 'translation', 'published', ?, ?)`)
    .run(id, item.headword, item.headword.toLowerCase(), item.part_of_speech, item.part_of_speech,
      item.semantic_sense.toLowerCase().replace(/[^a-z0-9]+/g, '-'), item.semantic_sense, level, now.toISOString(), now.toISOString())
}

describe('durable image vocabulary jobs', () => {
  afterEach(() => vi.unstubAllGlobals())

  it.each(['no_english', 'unreadable'] as const)('completes %s as a normal empty outcome with no enrichment', async outcome => {
    const { sqlite, env, objects } = environment()
    try {
      const provider = vi.fn(async () => modelOutput({ version: 2, outcome, suggestions: [] }))
      vi.stubGlobal('fetch', provider)
      const { job } = await acceptImageJob(env, 'owner', crypto.randomUUID(), image, 'image/png', now)
      await processImageJob(env, job.job_id, () => now)
      const row = await env.DB.prepare('SELECT * FROM image_vocabulary_jobs WHERE job_id = ?').bind(job.job_id).first()
      expect(await imageJobStatus(env.DB, row as Parameters<typeof imageJobStatus>[1]))
        .toMatchObject({ status: 'completed', error_code: null, outcome, cards: [], results: [] })
      await processImageJob(env, job.job_id, () => now)
      expect(provider).toHaveBeenCalledOnce()
      expect(objects.size).toBe(0)
    } finally { sqlite.close() }
  })

  it.each([0, 6])('automatically saves %i supported English words from bilingual material and skips the rest despite high confidence', async validCount => {
    const { sqlite, env } = environment()
    try {
      sqlite.prepare(`INSERT INTO user_settings (user_id, timezone, english_level, created_at, updated_at) VALUES ('owner', 'UTC', 'B1', ?, ?)`)
        .run(now.toISOString(), now.toISOString())
      const suggestions = ['map', 'apple', 'book', 'chair', 'door', 'lamp', 'river', 'tree', 'window', 'road']
        .map((headword, index) => ({ ...suggestion, headword,
          source_context: `Read the English word ${headword}. 英文教材`, contextual_support: index < validCount ? 'clear' : 'insufficient' }))
      const provider = vi.fn<typeof fetch>()
        .mockResolvedValueOnce(modelOutput({ version: 2, outcome: 'english', suggestions }))
        .mockResolvedValueOnce(modelOutput({ version: 1, items: suggestions.slice(0, validCount).map((_, item_index) => ({
          item_index, zh_tw_definition: 'definition', english_example: 'An example.', zh_tw_example_translation: 'translation',
        })) }))
      vi.stubGlobal('fetch', provider)
      const { job } = await acceptImageJob(env, 'owner', crypto.randomUUID(), image, 'image/png', now)
      await processImageJob(env, job.job_id, () => now)
      const row = await env.DB.prepare('SELECT * FROM image_vocabulary_jobs WHERE job_id = ?').bind(job.job_id).first()
      const status = await imageJobStatus(env.DB, row as Parameters<typeof imageJobStatus>[1])
      expect(status).toMatchObject({ status: 'completed', outcome: validCount ? 'partial' : 'no_reliable_words', error_code: null })
      expect(status.cards).toHaveLength(validCount)
      expect(status.results?.slice(validCount)).toEqual(suggestions.slice(validCount).map(item => ({
        headword: item.headword, status: 'skipped', reason: 'insufficient_context',
      })))
      expect(provider).toHaveBeenCalledTimes(validCount ? 2 : 1)
      const recognition = JSON.parse(String(provider.mock.calls[0][1]?.body))
      expect(recognition.input[0].text).toContain('verified CEFR level B1')
      expect(recognition.input[0].text).toContain('bilingual Chinese/English')
      expect(recognition.input[0].text).toContain('Shared Latin letters')
      const contract = z.fromJSONSchema(recognition.response_format.schema)
      expect(contract.safeParse({ version: 2, outcome: 'english', suggestions }).success).toBe(true)
      expect(contract.safeParse({ version: 2, suggestions }).success).toBe(false)
      expect(contract.safeParse({ version: 2, outcome: 'english', suggestions: [suggestion] }).success).toBe(false)
    } finally { sqlite.close() }
  })

  it.each(['match', 'skip', 'invalid'])('handles catalog %s without generating complete catalog content', async action => {
    const { sqlite, env } = environment()
    try {
      const bank = { ...suggestion, headword: 'bank', part_of_speech: 'noun' as const,
        semantic_sense: 'a place beside a river', source_context: 'They sat on the bank beside the river.' }
      addCatalog(sqlite, 'bank-financial', { ...bank, semantic_sense: 'financial institution' })
      addCatalog(sqlite, 'bank-river', { ...bank, semantic_sense: 'land beside a river' })
      const provider = vi.fn<typeof fetch>()
        .mockResolvedValueOnce(modelOutput({ version: 1, suggestions: [bank] }))
        .mockResolvedValueOnce(modelOutput({ version: action === 'invalid' ? 9 : 1,
          matches: [{ item_index: 0, action, candidate_index: action === 'match' ? 1 : null, confidence: 0.99 }] }))
      vi.stubGlobal('fetch', provider)
      const { job } = await acceptImageJob(env, 'owner', crypto.randomUUID(), image, 'image/png', now)
      await processImageJob(env, job.job_id, () => now)
      expect(sqlite.prepare('SELECT vocabulary_catalog_id FROM flashcards WHERE user_id = ?').all('owner'))
        .toEqual(action === 'match' ? [{ vocabulary_catalog_id: 'bank-river' }] : [])
      expect(sqlite.prepare('SELECT status, error_code FROM image_vocabulary_jobs WHERE job_id = ?').get(job.job_id))
        .toEqual({ status: action === 'invalid' ? 'failed' : 'completed', error_code: action === 'invalid' ? 'NO_CARDS_SAVED' : null })
      if (action === 'invalid') {
        const plans = sqlite.prepare('SELECT plans_json FROM image_vocabulary_jobs WHERE job_id = ?').get(job.job_id) as { plans_json: string }
        expect(JSON.parse(plans.plans_json)[0].validation_failure).toEqual({ stage: 'catalog_match', item_index: 0, code: 'response_schema' })
      }
      expect(provider).toHaveBeenCalledTimes(2)
    } finally { sqlite.close() }
  })

  it.each([false, true])('preserves suggestion/result correspondence and CEFR card order (checkpoint replay: %s)', async replay => {
    const { sqlite, env } = environment()
    try {
      const keys = ['unknown', 'lower', 'target', 'owned']
      const items = keys.map((key, index) => ({ ...suggestion,
        headword: index === 1 || index === 2 ? 'bank' : key,
        semantic_sense: index === 1 ? 'financial institution' : index === 2 ? 'land beside a river' : suggestion.semantic_sense,
      }))
      items.forEach((item, index) => addCatalog(sqlite, keys[index], item, [null, 'A2', 'B1', 'B1'][index]))
      sqlite.prepare(`INSERT INTO flashcards (id, user_id, card_type, vocabulary_catalog_id, created_at, updated_at)
        VALUES ('original', 'owner', 'vocabulary', 'owned', ?, ?)`).run(now.toISOString(), now.toISOString())
      sqlite.prepare(`INSERT INTO user_settings (user_id, timezone, english_level, created_at, updated_at) VALUES ('owner', 'UTC', 'B1', ?, ?)`)
        .run(now.toISOString(), now.toISOString())
      const provider = vi.fn(async () => modelOutput({ version: 1, suggestions: items }))
      vi.stubGlobal('fetch', provider)
      const prepare = vi.spyOn(env.DB, 'prepare')
      const { job } = await acceptImageJob(env, 'owner', crypto.randomUUID(), image, 'image/png', now)
      if (replay) {
        interleaveBeforeRun(env, 'SET results_json = ?, status = ?', () => { throw new Error('simulated final-status crash') })
        await expect(processImageJob(env, job.job_id, () => now)).rejects.toThrow('simulated final-status crash')
        // Simulate a checkpoint persisted by the earlier CEFR-sorting implementation.
        const stored = sqlite.prepare('SELECT plans_json FROM image_vocabulary_jobs WHERE job_id = ?')
          .get(job.job_id) as { plans_json: string }
        sqlite.prepare('UPDATE image_vocabulary_jobs SET plans_json = ? WHERE job_id = ?')
          .run(JSON.stringify(JSON.parse(stored.plans_json).reverse()), job.job_id)
      }
      await processImageJob(env, job.job_id, () => new Date(now.getTime() + (replay ? 5 * 60_000 : 0)))
      const row = await env.DB.prepare('SELECT * FROM image_vocabulary_jobs WHERE job_id = ?').bind(job.job_id).first()
      const status = await imageJobStatus(env.DB, row as Parameters<typeof imageJobStatus>[1])
      expect(status.cards).toHaveLength(3)
      expect(status.suggestions).toEqual(items.map(item => ({ ...item, contextual_support: 'clear' })))
      expect(status.results?.map(item => item.headword)).toEqual(items.map(item => item.headword))
      const catalogId = (id: string) => (sqlite.prepare('SELECT vocabulary_catalog_id FROM flashcards WHERE id = ?')
        .get(id) as { vocabulary_catalog_id: string }).vocabulary_catalog_id
      expect(status.results?.map(result => 'card_id' in result ? catalogId(result.card_id) : result.reason))
        .toEqual(['unknown', 'lower', 'target', 'already_owned'])
      expect(status.results?.slice(0, 3).map(result => result.status))
        .toEqual(Array(3).fill(replay ? 'already_saved' : 'saved'))
      expect(status.cards?.map(card => catalogId((card as { id: string }).id))).toEqual(['target', 'lower', 'unknown'])
      const checkpoint = sqlite.prepare('SELECT plans_json, results_json FROM image_vocabulary_jobs WHERE job_id = ?')
        .get(job.job_id) as { plans_json: string; results_json: string }
      expect(JSON.parse(checkpoint.plans_json).map((plan: { item: unknown }) => plan.item))
        .toEqual(replay ? [...status.suggestions!].reverse() : status.suggestions)
      expect(JSON.parse(checkpoint.results_json).results).toEqual(status.results)
      expect(status.results).toContainEqual({ headword: 'owned', status: 'skipped', reason: 'already_owned' })
      expect(provider).toHaveBeenCalledOnce()
      await processImageJob(env, job.job_id, () => now)
      expect(await imageJobStatus(env.DB, row as Parameters<typeof imageJobStatus>[1])).toEqual(status)
      expect(provider).toHaveBeenCalledOnce()
      const lookups = prepare.mock.calls.map(([sql]) => sql).filter(sql => sql.startsWith('SELECT * FROM (SELECT id,'))
      expect(lookups).toHaveLength(1)
      const plan = sqlite.prepare('EXPLAIN QUERY PLAN ' + lookups[0])
        .all(...items.flatMap(item => [item.headword, item.part_of_speech]))
        .map(row => row.detail).join('\n')
      expect(plan).toContain('SEARCH vocabulary_catalog USING INDEX')
      expect(plan).not.toContain('SCAN vocabulary_catalog')
      // A later upload containing only the same owned sense is a normal empty result.
      const second = await acceptImageJob(env, 'owner', crypto.randomUUID(), image, 'image/png', now)
      provider.mockImplementation(async () => modelOutput({ version: 1, suggestions: [items[3]] }))
      await processImageJob(env, second.job.job_id, () => now)
      const secondRow = await env.DB.prepare('SELECT * FROM image_vocabulary_jobs WHERE job_id = ?').bind(second.job.job_id).first()
      expect(await imageJobStatus(env.DB, secondRow as Parameters<typeof imageJobStatus>[1]))
        .toMatchObject({ status: 'completed', outcome: 'no_new_words', cards: [] })
      expect(provider).toHaveBeenCalledTimes(2)
      expect(sqlite.prepare('SELECT COUNT(*) AS count FROM flashcards').get()).toEqual({ count: 4 })
    } finally { sqlite.close() }
  })

  it('safely skips legacy ambiguous plans and reads historical results without reprocessing completed jobs', async () => {
    const { sqlite, env } = environment()
    try {
      const [plan] = await prepareVocabulary(env.DB, [{ ...suggestion, confidence: 0.5 }], env, 'legacy')
      const { job } = await acceptImageJob(env, 'owner', crypto.randomUUID(), image, 'image/png', now)
      sqlite.prepare(`UPDATE image_vocabulary_jobs SET plans_json = ?, recognized_json = ? WHERE job_id = ?`)
        .run(JSON.stringify([{ ...plan, kind: 'ambiguous', reason: 'low_confidence' }]),
          JSON.stringify({ version: 1, suggestions: [suggestion] }), job.job_id)
      const provider = vi.fn()
      vi.stubGlobal('fetch', provider)
      await processImageJob(env, job.job_id, () => now)
      sqlite.prepare('UPDATE image_vocabulary_jobs SET results_json = ? WHERE job_id = ?')
        .run(JSON.stringify({ results: [{ headword: 'curious', status: 'ambiguous', reason: 'low_confidence', item: suggestion, options: [] }], card_ids: [] }), job.job_id)
      const row = await env.DB.prepare('SELECT * FROM image_vocabulary_jobs WHERE job_id = ?').bind(job.job_id).first()
      expect((await imageJobStatus(env.DB, row as Parameters<typeof imageJobStatus>[1])).results)
        .toEqual([{ headword: 'curious', status: 'skipped', reason: 'insufficient_context' }])
      await processImageJob(env, job.job_id, () => now)
      expect(provider).not.toHaveBeenCalled()
    } finally { sqlite.close() }
  })

  it('replays a version-one recognition provider checkpoint without another Gemini request', async () => {
    const { sqlite, env } = environment()
    try {
      const { job } = await acceptImageJob(env, 'owner', crypto.randomUUID(), image, 'image/png', now)
      sqlite.prepare(`UPDATE image_vocabulary_jobs SET provider_state = 'completed', provider_results_json = ? WHERE job_id = ?`)
        .run(JSON.stringify({
          recognition: { model: 'legacy', value: { version: 1, suggestions: [suggestion] } },
          catalog_generation: { model: 'legacy', value: { version: 1, items: [{ item_index: 0,
            zh_tw_definition: 'definition', english_example: 'An example.', zh_tw_example_translation: 'translation' }] } },
        }), job.job_id)
      const provider = vi.fn()
      vi.stubGlobal('fetch', provider)
      await processImageJob(env, job.job_id, () => now)
      expect(sqlite.prepare('SELECT status FROM image_vocabulary_jobs WHERE job_id = ?').get(job.job_id)).toEqual({ status: 'completed' })
      expect(sqlite.prepare('SELECT COUNT(*) AS count FROM flashcards').get()).toEqual({ count: 1 })
      expect(provider).not.toHaveBeenCalled()
    } finally { sqlite.close() }
  })

  it.each([
    { version: 2, outcome: 'no_english', suggestions: [{ ...suggestion, contextual_support: 'clear' }] },
    { version: 2, outcome: 'english', suggestions: [suggestion] },
    { version: 1, suggestions: [suggestion] },
  ])('fails a fresh invalid recognition contract without enrichment: %j', async value => {
    const { sqlite, env } = environment()
    try {
      const provider = vi.fn(async () => Response.json({ status: 'completed', steps: [{ type: 'model_output',
        content: [{ type: 'text', text: JSON.stringify(value) }] }] }))
      vi.stubGlobal('fetch', provider)
      const { job } = await acceptImageJob(env, 'owner', crypto.randomUUID(), image, 'image/png', now)
      await processImageJob(env, job.job_id, () => now)
      expect(sqlite.prepare('SELECT status, error_code FROM image_vocabulary_jobs WHERE job_id = ?').get(job.job_id))
        .toEqual({ status: 'failed', error_code: 'INVALID_PROVIDER_OUTPUT' })
      await processImageJob(env, job.job_id, () => now)
      expect(provider).toHaveBeenCalledOnce()
    } finally { sqlite.close() }
  })

  it.each([
    [{ version: 2, items: [] }, 'response_schema'],
    [{ version: 1, items: [] }, 'missing_item'],
    [{ version: 1, items: [{ item_index: '0' }] }, 'missing_item'],
    [{ version: 1, items: [{ item_index: 0, zh_tw_definition: '' }] }, 'item_schema'],
    [{ version: 1, items: [{ item_index: 0, secret_user_text: 'do not log me' }] }, 'item_schema'],
    [{ version: 1, items: [{ item_index: 0 }, { item_index: 0 }] }, 'duplicate_index'],
    [{ version: 1, items: [{ item_index: 0 }] }, 'missing_fields'],
  ])('rejects malformed generation with content-free diagnostics: %j', async (value, code) => {
    const { sqlite, env } = environment()
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    try {
      const plans = await prepareVocabulary(env.DB, [suggestion], env, 'test-model', async () => ({ model: 'test-model', value }))
      expect(plans[0]).toMatchObject({ kind: 'invalid', reason: 'invalid_content', content: {},
        validation_failure: { stage: 'catalog_generation', item_index: 0, code } })
      expect(warn.mock.calls).toEqual([[JSON.stringify({ event: 'vocabulary_validation_failed',
        stage: 'catalog_generation', item_index: 0, code })]])
    } finally { warn.mockRestore(); sqlite.close() }
  })

  it.each([{ suggestions: [] }, { suggestions: [{ ...suggestion, confidence: 0.5 }] }])('completes normal empty recognition and skips uncertain candidates: %j', async ({ suggestions }) => {
    const { sqlite, env } = environment()
    try {
      const provider = vi.fn(async () => modelOutput({ version: 1, suggestions }))
      vi.stubGlobal('fetch', provider)
      const { job } = await acceptImageJob(env, 'owner', crypto.randomUUID(), image, 'image/png', now)
      await processImageJob(env, job.job_id, () => now)
      expect(sqlite.prepare('SELECT status, error_code FROM image_vocabulary_jobs WHERE job_id = ?').get(job.job_id))
        .toEqual({ status: 'completed', error_code: null })
      expect(provider).toHaveBeenCalledOnce()
    } finally { sqlite.close() }
  })

  it.each([10, 0, 6])('saves %i of ten recognized words and reports the terminal outcome without retrying', async validCount => {
    const { sqlite, env, objects } = environment()
    try {
      const suggestions = ['map', 'apple', 'book', 'chair', 'door', 'lamp', 'river', 'tree', 'window', 'road']
        .map(headword => ({ ...suggestion, headword, part_of_speech: 'noun' }))
      const items = suggestions.map((_, item_index) => item_index < validCount
        ? { item_index, zh_tw_definition: '測試詞義', english_example: 'A natural example.', zh_tw_example_translation: '自然的例句。' }
        : { item_index })
      const provider = vi.fn<typeof fetch>()
        .mockResolvedValueOnce(modelOutput({ version: 1, suggestions }))
        .mockResolvedValueOnce(modelOutput({ version: 1, items: [...items].reverse() }))
      vi.stubGlobal('fetch', provider)
      const { job } = await acceptImageJob(env, 'owner', crypto.randomUUID(), image, 'image/png', now)
      await processImageJob(env, job.job_id, () => now)
      const row = await env.DB.prepare('SELECT * FROM image_vocabulary_jobs WHERE job_id = ?').bind(job.job_id).first()
      const status = await imageJobStatus(env.DB, row as Parameters<typeof imageJobStatus>[1])
      expect(status).toMatchObject({ status: validCount ? 'completed' : 'failed',
        stage: validCount ? 'completed' : 'failed', error_code: validCount ? null : 'NO_CARDS_SAVED' })
      expect(status.cards).toHaveLength(validCount)
      expect(status.results?.map(result => result.status)).toEqual(suggestions.map((_, index) => index < validCount ? 'saved' : 'not_saved'))
      const checkpoint = await env.DB.prepare('SELECT plans_json FROM image_vocabulary_jobs WHERE job_id = ?')
        .bind(job.job_id).first<{ plans_json: string }>()
      expect(JSON.parse(checkpoint!.plans_json).slice(validCount).map((plan: { validation_failure: unknown }) => plan.validation_failure))
        .toEqual(suggestions.slice(validCount).map((_, index) => ({ stage: 'catalog_generation', item_index: validCount + index, code: 'missing_fields' })))
      expect(sqlite.prepare('SELECT COUNT(*) AS count FROM vocabulary_catalog').get()).toEqual({ count: validCount })
      expect(objects.size).toBe(0)
      await processImageJob(env, job.job_id, () => now)
      expect(provider).toHaveBeenCalledTimes(2)
      const body = JSON.parse(String(provider.mock.calls[1][1]?.body))
      expect(body.response_format).toMatchObject({ type: 'text', mime_type: 'application/json' })
      const contract = z.fromJSONSchema(body.response_format.schema)
      expect(contract.safeParse({ version: 1, items: suggestions.map((_, item_index) => ({ item_index })) }).success).toBe(false)
      expect(contract.safeParse({ version: 1, items: suggestions.map((_, item_index) => ({ item_index,
        zh_tw_definition: '詞義', english_example: 'An example.', zh_tw_example_translation: '例句。' })) }).success).toBe(true)
    } finally { sqlite.close() }
  })

  it.each([false, true])('does not let ambiguous words hide a zero-card failure (valid generation: %s)', async valid => {
    const { sqlite, env } = environment()
    try {
      const suggestions = [suggestion, { ...suggestion, headword: 'map', confidence: 0.5 }]
      const provider = vi.fn<typeof fetch>()
        .mockResolvedValueOnce(modelOutput({ version: 1, suggestions }))
        .mockResolvedValueOnce(modelOutput({ version: 1, items: [{ item_index: 0, ...(valid ? {
          zh_tw_definition: 'definition', english_example: 'She is curious.', zh_tw_example_translation: 'translation',
        } : {}) }] }))
      vi.stubGlobal('fetch', provider)
      const { job } = await acceptImageJob(env, 'owner', crypto.randomUUID(), image, 'image/png', now)
      await processImageJob(env, job.job_id, () => now)
      const row = await env.DB.prepare('SELECT * FROM image_vocabulary_jobs WHERE job_id = ?').bind(job.job_id).first()
      expect(await imageJobStatus(env.DB, row as Parameters<typeof imageJobStatus>[1])).toMatchObject({
        status: valid ? 'completed' : 'failed', stage: valid ? 'completed' : 'failed',
        error_code: valid ? null : 'NO_CARDS_SAVED',
        results: [{ status: valid ? 'saved' : 'not_saved' }, { status: 'skipped', reason: 'insufficient_context' }],
        cards: valid ? [expect.objectContaining({ front_content: 'curious' })] : [],
      })
      const ack = vi.fn()
      const retry = vi.fn()
      await consumeImageJobs({ messages: [{ body: { job_id: job.job_id }, attempts: 2, ack, retry }] }, env)
      expect(ack).toHaveBeenCalledOnce()
      expect(retry).not.toHaveBeenCalled()
      expect(provider).toHaveBeenCalledTimes(2)
      expect((await imageQuota(env.DB, 'owner', now)).used).toBe(1)
    } finally { sqlite.close() }
  })

  it.each(['invalid_json', 'invalid_schema', 'persistence_failure'])('reports %s after recognition without retrying the provider', async failure => {
    const { sqlite, env, objects } = environment()
    try {
      const generated = modelOutput({ version: 1, items: [{ item_index: 0,
        zh_tw_definition: 'definition', english_example: 'She is curious.', zh_tw_example_translation: 'translation' }] })
      const provider = vi.fn<typeof fetch>()
        .mockResolvedValueOnce(modelOutput({ version: 1, suggestions: [suggestion] }))
        .mockResolvedValueOnce(failure === 'invalid_json'
          ? Response.json({ status: 'completed', steps: [{ type: 'model_output', content: [{ type: 'text', text: '{' }] }] })
          : failure === 'invalid_schema' ? modelOutput({ version: 2, items: [] }) : generated)
      vi.stubGlobal('fetch', provider)
      if (failure === 'persistence_failure') sqlite.exec(`CREATE TRIGGER reject_card BEFORE INSERT ON flashcards
        BEGIN SELECT RAISE(ABORT, 'simulated persistence failure'); END`)
      const { job } = await acceptImageJob(env, 'owner', crypto.randomUUID(), image, 'image/png', now)
      await processImageJob(env, job.job_id, () => now)
      const row = await env.DB.prepare('SELECT * FROM image_vocabulary_jobs WHERE job_id = ?').bind(job.job_id).first()
      expect(await imageJobStatus(env.DB, row as Parameters<typeof imageJobStatus>[1])).toMatchObject({
        status: failure === 'invalid_json' ? 'needs_attention' : 'failed',
        error_code: failure === 'invalid_json' ? 'EXTERNAL_OUTCOME_UNKNOWN' : 'NO_CARDS_SAVED',
        suggestions: [suggestion],
        ...(failure === 'invalid_json' ? {} : { results: [{ status: 'not_saved',
          reason: failure === 'invalid_schema' ? 'invalid_content' : 'save_failed' }], cards: [] }),
      })
      expect((await imageJobStatus(env.DB, row as Parameters<typeof imageJobStatus>[1])).outcome).toBeUndefined()
      await processImageJob(env, job.job_id, () => now)
      expect(provider).toHaveBeenCalledTimes(2)
      expect(sqlite.prepare('SELECT COUNT(*) AS count FROM flashcards').get()).toEqual({ count: 0 })
      expect(sqlite.prepare('SELECT COUNT(*) AS count FROM vocabulary_catalog').get()).toEqual({ count: 0 })
      expect(objects.size).toBe(0)
    } finally { sqlite.close() }
  })

  it('resumes the saving checkpoint without provider calls or duplicate cards after a final-status write fails', async () => {
    const { sqlite, env } = environment()
    try {
      const provider = vi.fn<typeof fetch>()
        .mockResolvedValueOnce(modelOutput({ version: 1, suggestions: [suggestion] }))
        .mockResolvedValueOnce(modelOutput({ version: 1, items: [{ item_index: 0,
          zh_tw_definition: '好奇的', english_example: 'She is curious.', zh_tw_example_translation: '她很好奇。' }] }))
      vi.stubGlobal('fetch', provider)
      const { job } = await acceptImageJob(env, 'owner', crypto.randomUUID(), image, 'image/png', now)
      interleaveBeforeRun(env, 'SET results_json = ?, status = ?', () => { throw new Error('simulated final-status crash') })
      await expect(processImageJob(env, job.job_id, () => now)).rejects.toThrow('simulated final-status crash')
      await processImageJob(env, job.job_id, () => new Date(now.getTime() + 5 * 60_000))
      const row = await env.DB.prepare('SELECT * FROM image_vocabulary_jobs WHERE job_id = ?').bind(job.job_id).first()
      expect(await imageJobStatus(env.DB, row as Parameters<typeof imageJobStatus>[1]))
        .toMatchObject({ status: 'completed', error_code: null, results: [{ status: 'already_saved' }], cards: [{ front_content: 'curious' }] })
      expect(provider).toHaveBeenCalledTimes(2)
      expect(sqlite.prepare('SELECT COUNT(*) AS count FROM flashcards').get()).toEqual({ count: 1 })
    } finally { sqlite.close() }
  })

  it('enforces one active job across simultaneous tabs/devices and isolates users', async () => {
    const { sqlite, env } = environment()
    try {
      const settled = await Promise.allSettled(Array.from({ length: 6 }, () =>
        acceptImageJob(env, 'owner', crypto.randomUUID(), image, 'image/png', now)))
      expect(settled.filter(result => result.status === 'fulfilled')).toHaveLength(1)
      expect(settled.filter(result => result.status === 'rejected' && String(result.reason).includes('IMAGE_JOB_ACTIVE'))).toHaveLength(5)
      expect(await imageQuota(env.DB, 'owner', now)).toMatchObject({ limit: 5, used: 1, remaining: 4 })
      sqlite.prepare(`INSERT INTO users (id, username, display_name, password_salt, password_digest, created_at, updated_at)
        VALUES ('other', 'other', 'Other', 'salt', 'digest', ?, ?)`).run(now.toISOString(), now.toISOString())
      expect((await acceptImageJob(env, 'other', crypto.randomUUID(), image, 'image/png', now)).quota)
        .toMatchObject({ used: 1, remaining: 4 })
    } finally { sqlite.close() }
  })

  it('uses the quota, cleanup, and recovery indexes for bounded lookups', () => {
    const { sqlite } = environment()
    try {
      const insert = sqlite.prepare(`INSERT INTO image_vocabulary_jobs
        (job_id, user_id, idempotency_key, image_hash, image_key, mime_type, quota_date, status, stage,
          next_dispatch_at, created_at, updated_at)
        VALUES (?, 'owner', ?, 'synthetic-hash', ?, 'image/png', ?, ?, ?, ?, ?, ?)`)
      const statuses = ['received', 'queued', 'recognizing', 'recognized', 'enriching', 'saving', 'completed']
      for (let index = 0; index < 700; index++) {
        const date = new Date(Date.UTC(2020, 0, index + 1)).toISOString()
        const status = statuses[index % statuses.length]
        insert.run('job-' + index, 'key-' + index, 'image-jobs/' + index, date.slice(0, 10), status, status,
          date, date, date)
      }
      const plan = (sql: string, ...values: (string | number | null)[]) => sqlite.prepare('EXPLAIN QUERY PLAN ' + sql)
        .all(...values).map(row => (row as { detail: string }).detail).join('\n')
      const active = plan(`SELECT job_id FROM image_vocabulary_jobs WHERE user_id = ?
        AND status IN ('received', 'queued', 'recognizing', 'recognized', 'enriching', 'saving') ORDER BY created_at DESC LIMIT 1`, 'owner')
      expect(active).toContain('idx_image_vocabulary_jobs_active_user')
      expect(active).not.toContain('SCAN image_vocabulary_jobs')
      const quota = plan('SELECT COUNT(*) FROM image_vocabulary_jobs WHERE user_id = ? AND quota_date = ?', 'owner', '2020-01-01')
      const cleanup = plan('SELECT job_id FROM image_vocabulary_jobs WHERE image_key IN (?, ?)', 'image-jobs/1', 'image-jobs/2')
      const cleanupUpdate = plan(`UPDATE image_vocabulary_jobs SET image_key = NULL WHERE image_key IN (?, ?)
        AND status IN ('completed', 'failed', 'needs_attention') AND updated_at <= ? RETURNING job_id`,
      'image-jobs/1', 'image-jobs/2', '2027-01-02T10:00:00.000Z')
      const recovery = plan(`SELECT job_id, status, provider_state, lease_until, lease_token, dispatch_attempts, updated_at, next_dispatch_at FROM (
        SELECT job_id, status, provider_state, lease_until, lease_token, dispatch_attempts, updated_at, next_dispatch_at
          FROM image_vocabulary_jobs WHERE status = 'received' AND next_dispatch_at <= ?
            AND (lease_until IS NULL OR lease_until <= ?) ORDER BY next_dispatch_at LIMIT 50
      ) UNION ALL SELECT job_id, status, provider_state, lease_until, lease_token, dispatch_attempts, updated_at, next_dispatch_at FROM (
        SELECT job_id, status, provider_state, lease_until, lease_token, dispatch_attempts, updated_at, next_dispatch_at
          FROM image_vocabulary_jobs INDEXED BY idx_image_vocabulary_jobs_recovery
          WHERE status IN ('queued', 'recognizing', 'recognized', 'enriching', 'saving') AND updated_at <= ?
            AND (lease_until IS NULL OR lease_until <= ?) ORDER BY updated_at, created_at LIMIT 50
      ) LIMIT 50`, '2027-01-02T10:00:00.000Z', '2027-01-02T10:00:00.000Z',
      '2027-01-02T09:55:00.000Z', '2027-01-02T10:00:00.000Z')
      expect(quota).toContain('idx_image_vocabulary_jobs_quota')
      expect(cleanup).toContain('idx_image_vocabulary_jobs_image_key')
      expect(cleanupUpdate).toContain('idx_image_vocabulary_jobs_image_key')
      expect(cleanupUpdate).not.toMatch(/SCAN image_vocabulary_jobs/)
      expect(recovery).toContain('idx_image_vocabulary_jobs_dispatch')
      expect(recovery).toContain('idx_image_vocabulary_jobs_recovery')
      expect(recovery).not.toMatch(/SCAN image_vocabulary_jobs|USE TEMP B-TREE/)
      sqlite.exec('CREATE INDEX idx_status_first_recovery_candidate ON image_vocabulary_jobs(status, updated_at, lease_until, created_at)')
      const statusFirst = plan(`SELECT job_id FROM image_vocabulary_jobs INDEXED BY idx_status_first_recovery_candidate
        WHERE status IN ('queued', 'recognizing', 'recognized', 'enriching', 'saving') AND updated_at <= ?
          AND (lease_until IS NULL OR lease_until <= ?) ORDER BY updated_at, created_at LIMIT 50`,
      '2027-01-02T09:55:00.000Z', '2027-01-02T10:00:00.000Z')
      expect(statusFirst).toContain('USE TEMP B-TREE FOR ORDER BY')
    } finally { sqlite.close() }
  })

  it('returns the original job for duplicate key and rejects a changed image without charging twice', async () => {
    const { sqlite, env, sends, objects } = environment()
    try {
      const key = crypto.randomUUID()
      const first = await acceptImageJob(env, 'owner', key, image, 'image/png', now)
      const duplicate = await acceptImageJob(env, 'owner', key, image, 'image/png', now)
      expect(duplicate).toMatchObject({ duplicate: true, job: { job_id: first.job.job_id } })
      expect(sends).toEqual([{ job_id: first.job.job_id }])
      await expect(acceptImageJob(env, 'owner', key, new Uint8Array([1, 2, 3]), 'image/png', now))
        .rejects.toThrow('IDEMPOTENCY_CONFLICT')
      expect((await imageQuota(env.DB, 'owner', now)).used).toBe(1)
      expect(objects.size).toBe(1)
      for (let index = 0; index < 4; index++) {
        const active = await currentImageJob(env, 'owner', now)
        await abandonImageJob(env, 'owner', active!.job_id, now)
        await acceptImageJob(env, 'owner', crypto.randomUUID(), image, 'image/png', now)
      }
      await expect(acceptImageJob(env, 'owner', crypto.randomUUID(), image, 'image/png', now)).rejects.toThrow('DAILY_IMAGE_LIMIT_REACHED')
      const afterLimit = await acceptImageJob(env, 'owner', key, image, 'image/png', now)
      expect(afterLimit.duplicate).toBe(true)
      expect((await imageQuota(env.DB, 'owner', now)).used).toBe(5)
      expect(sends).toHaveLength(5)
    } finally { sqlite.close() }
  })

  it('coalesces concurrent submissions with the same user key before Queue dispatch', async () => {
    const { sqlite, env, sends, objects } = environment()
    try {
      const key = crypto.randomUUID()
      const accepted = await Promise.all(Array.from({ length: 6 }, () =>
        acceptImageJob(env, 'owner', key, image, 'image/png', now)))
      expect(new Set(accepted.map(result => result.job.job_id)).size).toBe(1)
      expect(accepted.filter(result => !result.duplicate)).toHaveLength(1)
      expect((await imageQuota(env.DB, 'owner', now)).used).toBe(1)
      expect(sends).toHaveLength(1)
      expect(objects.size).toBe(1)
      expect(sqlite.prepare('SELECT COUNT(*) AS count FROM image_vocabulary_jobs').get()).toEqual({ count: 1 })
    } finally { sqlite.close() }
  })

  it('computes the next Ireland midnight across GMT/BST transitions', () => {
    expect(imageQuotaWindow(new Date('2026-10-24T22:59:00.000Z')))
      .toEqual({ quotaDate: '2026-10-24', resetsAt: '2026-10-24T23:00:00.000Z' })
    expect(imageQuotaWindow(new Date('2026-10-25T22:59:00.000Z')))
      .toEqual({ quotaDate: '2026-10-25', resetsAt: '2026-10-26T00:00:00.000Z' })
    expect(imageQuotaWindow(new Date('2026-03-28T23:59:00.000Z')))
      .toEqual({ quotaDate: '2026-03-28', resetsAt: '2026-03-29T00:00:00.000Z' })
  })

  it('suppresses duplicate Queue delivery with a D1 lease and reuses persisted provider stages', async () => {
    const { sqlite, env, objects } = environment()
    try {
      const accepted = await acceptImageJob(env, 'owner', crypto.randomUUID(), image, 'image/png', now)
      let call = 0
      vi.stubGlobal('fetch', vi.fn(async () => {
        call++
        await new Promise(resolve => setTimeout(resolve, 10))
        return modelOutput(call === 1
          ? { version: 1, suggestions: [suggestion] }
          : { version: 1, items: [{ item_index: 0, zh_tw_definition: '好奇的；求知的',
            english_example: 'She is curious about the map.', zh_tw_example_translation: '她對地圖感到好奇。', usage_patterns: [pattern] }] })
      }))
      await Promise.all([processImageJob(env, accepted.job.job_id, () => now), processImageJob(env, accepted.job.job_id, () => now)])
      expect(call).toBe(2)
      const row = sqlite.prepare('SELECT status, recognized_json, results_json FROM image_vocabulary_jobs WHERE job_id = ?')
        .get(accepted.job.job_id) as { status: string; recognized_json: string; results_json: string }
      expect(row.status).toBe('completed')
      expect(JSON.parse(row.recognized_json)).toEqual({ version: 1, outcome: 'english', suggestions: [{ ...suggestion, contextual_support: 'clear' }] })
      const result = await imageJobStatus(env.DB, { job_id: accepted.job.job_id, user_id: 'owner', status: 'completed',
        stage: 'completed', error_code: null, recognized_json: row.recognized_json, results_json: row.results_json })
      expect(result.results?.[0].status).toBe('saved')
      expect(result.cards?.[0]).toMatchObject({ usage_patterns: [pattern] })
      expect(objects.size).toBe(0)
    } finally { sqlite.close() }
  })

  it('resumes from a persisted Gemini response after a worker crashes before the next D1 checkpoint', async () => {
    const { sqlite, env } = environment()
    try {
      const accepted = await acceptImageJob(env, 'owner', crypto.randomUUID(), image, 'image/png', now)
      let call = 0
      vi.stubGlobal('fetch', vi.fn(async () => {
        call++
        return modelOutput(call === 1 ? { version: 1, suggestions: [suggestion] }
          : { version: 1, items: [{ item_index: 0, zh_tw_definition: '好奇的；求知的',
            english_example: 'She is curious about the map.', zh_tw_example_translation: '她對地圖感到好奇。' }] })
      }))
      const database = env.DB
      const batch = database.batch!
      let crashOnce = true
      env.DB = { ...database, batch: async statements => {
        if (crashOnce) { crashOnce = false; throw new Error('simulated worker crash') }
        return batch(statements)
      } }
      await expect(processImageJob(env, accepted.job.job_id, () => now)).rejects.toThrow('simulated worker crash')
      expect(sqlite.prepare('SELECT provider_state, recognized_json FROM image_vocabulary_jobs WHERE job_id = ?')
        .get(accepted.job.job_id)).toMatchObject({ provider_state: 'completed', recognized_json: null })
      await processImageJob(env, accepted.job.job_id, () => new Date(now.getTime() + 5 * 60_000))
      expect(call).toBe(2)
      expect(sqlite.prepare('SELECT status FROM image_vocabulary_jobs WHERE job_id = ?').get(accepted.job.job_id))
        .toEqual({ status: 'completed' })
    } finally { sqlite.close() }
  })

  it('parks unknown Gemini outcomes instead of retrying and blocks operator replay', async () => {
    const { sqlite, env } = environment()
    try {
      const accepted = await acceptImageJob(env, 'owner', crypto.randomUUID(), image, 'image/png', now)
      const fetch = vi.fn<typeof globalThis.fetch>().mockRejectedValue(new Error('connection lost'))
      vi.stubGlobal('fetch', fetch)
      await processImageJob(env, accepted.job.job_id, () => now)
      await processImageJob(env, accepted.job.job_id, () => new Date(now.getTime() + 10 * 60_000))
      const row = sqlite.prepare('SELECT status, provider_state, error_code FROM image_vocabulary_jobs WHERE job_id = ?')
        .get(accepted.job.job_id)
      expect(row).toEqual({ status: 'needs_attention', provider_state: 'unknown', error_code: 'EXTERNAL_OUTCOME_UNKNOWN' })
      expect(fetch).toHaveBeenCalledOnce()
      expect(await recoverFailedImageJob(env, accepted.job.job_id, now)).toBe(false)
    } finally { sqlite.close() }
  })

  it('fails closed on Queue send failure and releases the active session', async () => {
    const { sqlite, env, objects } = environment()
    try {
      env.IMAGE_JOBS = { async send() { throw new Error('uncertain queue send') } }
      const first = await acceptImageJob(env, 'owner', crypto.randomUUID(), image, 'image/png', now)
      expect(await currentImageJob(env, 'owner', now)).toBeNull()
      expect(sqlite.prepare('SELECT status, error_code FROM image_vocabulary_jobs WHERE job_id = ?').get(first.job.job_id))
        .toEqual({ status: 'failed', error_code: 'QUEUE_SEND_FAILED' })
      const provider = vi.fn()
      vi.stubGlobal('fetch', provider)
      await processImageJob(env, first.job.job_id, () => now)
      expect(provider).not.toHaveBeenCalled()
      await acceptImageJob(env, 'owner', crypto.randomUUID(), image, 'image/png', now)
      expect(objects.size).toBeLessThanOrEqual(2)
    } finally { sqlite.close() }
  })

  it.each(['abandon', 'timeout'])('fences late provider completion after %s and permits a new session', async action => {
    const { sqlite, env } = environment()
    try {
      const first = await acceptImageJob(env, 'owner', crypto.randomUUID(), image, 'image/png', now)
      let finish!: (response: Response) => void
      const provider = vi.fn(() => new Promise<Response>(resolve => { finish = resolve }))
      vi.stubGlobal('fetch', provider)
      const processing = processImageJob(env, first.job.job_id, () => now)
      await vi.waitFor(() => expect(provider).toHaveBeenCalledOnce())
      if (action === 'abandon') await abandonImageJob(env, 'owner', first.job.job_id, now)
      else await currentImageJob(env, 'owner', new Date(now.getTime() + 11 * 60_000))
      const second = await acceptImageJob(env, 'owner', crypto.randomUUID(), image, 'image/png', now)
      const rejected = expect(processing).rejects.toThrow('Lost image job lease')
      finish(modelOutput({ version: 1, suggestions: [suggestion] }))
      await rejected
      await processImageJob(env, first.job.job_id, () => now)
      expect(provider).toHaveBeenCalledOnce()
      expect((await currentImageJob(env, 'owner', now))?.job_id).toBe(second.job.job_id)
      expect(sqlite.prepare('SELECT COUNT(*) AS count FROM flashcards').get()).toEqual({ count: 0 })
      expect(await recoverFailedImageJob(env, first.job.job_id, now)).toBe(false)
    } finally { sqlite.close() }
  })

  it('rolls back vocabulary writes when abandonment wins immediately before a save batch', async () => {
    const { sqlite, env } = environment()
    try {
      const first = await acceptImageJob(env, 'owner', crypto.randomUUID(), image, 'image/png', now)
      vi.stubGlobal('fetch', vi.fn(async () => modelOutput({ version: 1, suggestions: [suggestion] })))
      const batch = env.DB.batch!
      let calls = 0
      env.DB.batch = async statements => {
        if (++calls === 2) await abandonImageJob(env, 'owner', first.job.job_id, now)
        return batch(statements)
      }
      // Supply a valid generated plan, then race the actual transactional save.
      sqlite.prepare(`UPDATE image_vocabulary_jobs SET plans_json = ?, recognized_json = ? WHERE job_id = ?`)
        .run(JSON.stringify(await prepareVocabulary(env.DB, [suggestion], env, 'test', async () => ({ model: 'test', value: {
          version: 1, items: [{ item_index: 0, zh_tw_definition: 'definition', english_example: 'She is curious.', zh_tw_example_translation: 'translation' }],
        } }))), JSON.stringify({ version: 1, suggestions: [suggestion] }), first.job.job_id)
      calls = 1
      await expect(processImageJob(env, first.job.job_id, () => now)).rejects.toThrow('Lost image job lease')
      expect(sqlite.prepare('SELECT COUNT(*) AS count FROM flashcards').get()).toEqual({ count: 0 })
      expect(sqlite.prepare('SELECT COUNT(*) AS count FROM vocabulary_catalog').get()).toEqual({ count: 0 })
    } finally { sqlite.close() }
  })

  it('does not reclaim a lease when the old consumer starts a provider call after the initial read', async () => {
    const { sqlite, env } = environment()
    try {
      const { job } = await acceptImageJob(env, 'owner', crypto.randomUUID(), image, 'image/png', now)
      const database = env.DB
      env.DB = { ...database, prepare(sql) {
        if (sql.includes('SET lease_token = ?, lease_until = ?')) {
          sqlite.prepare(`UPDATE image_vocabulary_jobs SET provider_state = 'started', lease_token = 'old' WHERE job_id = ?`).run(job.job_id)
        }
        return database.prepare(sql)
      } }
      const provider = vi.fn()
      vi.stubGlobal('fetch', provider)
      await processImageJob(env, job.job_id, () => now)
      expect(provider).not.toHaveBeenCalled()
      expect(sqlite.prepare('SELECT provider_state, lease_token FROM image_vocabulary_jobs WHERE job_id = ?').get(job.job_id))
        .toEqual({ provider_state: 'started', lease_token: 'old' })
    } finally { sqlite.close() }
  })

  it('has no scheduled entrypoint or storage listing path for idle work', async () => {
    const worker = (await import('../index')).default
    expect('scheduled' in worker).toBe(false)
    const { sqlite, env, listCalls } = environment()
    try {
      const prepare = vi.spyOn(env.DB, 'prepare')
      await consumeImageJobs({ messages: [] }, env)
      expect(prepare).not.toHaveBeenCalled()
      expect(listCalls).toEqual([])
    } finally { sqlite.close() }
    const source = readFileSync('src/worker/services/image-vocabulary-jobs.ts', 'utf8')
    expect(source).not.toContain('IMAGE_STORAGE.list(')
    expect(source).not.toContain('image_storage_cleanup_state')
    const config = readFileSync('wrangler.jsonc', 'utf8')
    expect(config).toContain('"triggers": { "crons": [] }')
  })
})
