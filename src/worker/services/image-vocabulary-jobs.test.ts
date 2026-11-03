import { readFileSync, readdirSync } from 'node:fs'
import { DatabaseSync } from 'node:sqlite'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { z } from 'zod'
import { prepareVocabulary } from './vocabulary-catalog'
import type { PersistenceDatabase, PersistenceStatement, SqlValue } from '../persistence/d1'
import {
  acceptImageJob, consumeImageJobs, imageJobStatus, imageQuota, imageQuotaWindow, processImageJob, recoverFailedImageJob,
  recoverImageJobs, type ImageJobEnv, type ImageJobMessage, type ImageStorage,
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

describe('durable image vocabulary jobs', () => {
  afterEach(() => vi.unstubAllGlobals())

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

  it.each([{ suggestions: [] }, { suggestions: [{ ...suggestion, confidence: 0.5 }] }])('preserves empty recognition and intentional sense-confirmation completion: %j', async ({ suggestions }) => {
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

  it('enforces five concurrent unique daily reservations per Dublin date and isolates users', async () => {
    const { sqlite, env } = environment()
    try {
      const settled = await Promise.allSettled(Array.from({ length: 6 }, () =>
        acceptImageJob(env, 'owner', crypto.randomUUID(), image, 'image/png', now)))
      expect(settled.filter(result => result.status === 'fulfilled')).toHaveLength(5)
      expect(settled.filter(result => result.status === 'rejected' && String(result.reason).includes('DAILY_IMAGE_LIMIT_REACHED'))).toHaveLength(1)
      expect(await imageQuota(env.DB, 'owner', now)).toMatchObject({ limit: 5, used: 5, remaining: 0 })
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
        await acceptImageJob(env, 'owner', crypto.randomUUID(), image, 'image/png', now)
      }
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
      expect(JSON.parse(row.recognized_json)).toEqual({ version: 1, suggestions: [suggestion] })
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

  it('recovers the D1 outbox after Queue send fails and supports safe operator recovery', async () => {
    const { sqlite, env, sends } = environment()
    try {
      let failFirst = true
      env.IMAGE_JOBS = { async send(message) { sends.push(message); if (failFirst) { failFirst = false; throw new Error('queue unavailable') } } }
      const accepted = await acceptImageJob(env, 'owner', crypto.randomUUID(), image, 'image/png', now)
      expect(accepted.job.status).toBe('received')
      const database = env.DB
      let dispatchReads = 0
      env.DB = { ...database, prepare(sql) {
        if (sql.includes('SELECT dispatch_attempts FROM image_vocabulary_jobs')) dispatchReads++
        return database.prepare(sql)
      } }
      await recoverImageJobs(env, new Date(now.getTime() + 60_000))
      expect(dispatchReads).toBe(0)
      expect(sqlite.prepare('SELECT status FROM image_vocabulary_jobs WHERE job_id = ?').get(accepted.job.job_id))
        .toEqual({ status: 'queued' })
      sqlite.prepare(`UPDATE image_vocabulary_jobs SET status = 'failed', error_code = 'IMAGE_MISSING' WHERE job_id = ?`)
        .run(accepted.job.job_id)
      expect(await recoverFailedImageJob(env, accepted.job.job_id, now)).toBe(true)
      expect(sqlite.prepare('SELECT status, dispatch_attempts FROM image_vocabulary_jobs WHERE job_id = ?').get(accepted.job.job_id))
        .toMatchObject({ status: 'queued', dispatch_attempts: 1 })
    } finally { sqlite.close() }
  })

  it('does not reset a job after a Queue consumer acquires its lease', async () => {
    const { sqlite, env, sends } = environment()
    try {
      const accepted = await acceptImageJob(env, 'owner', crypto.randomUUID(), image, 'image/png', now)
      const staleAt = new Date(now.getTime() - 10 * 60_000).toISOString()
      const recoveryAt = new Date(now.getTime() + 6 * 60_000)
      sqlite.prepare(`UPDATE image_vocabulary_jobs SET status = 'queued', updated_at = ?, next_dispatch_at = ? WHERE job_id = ?`)
        .run(staleAt, staleAt, accepted.job.job_id)
      const leaseUntil = new Date(recoveryAt.getTime() + 4 * 60_000).toISOString()
      const interleaved = interleaveBeforeRun(env, "SET status = 'received', stage = 'received',", () => {
        sqlite.prepare(`UPDATE image_vocabulary_jobs SET status = 'recognizing', stage = 'recognizing', lease_token = ?,
          lease_until = ?, updated_at = ? WHERE job_id = ?`).run('consumer-lease', leaseUntil, recoveryAt.toISOString(), accepted.job.job_id)
      })
      const fetch = vi.fn<typeof globalThis.fetch>()
      vi.stubGlobal('fetch', fetch)
      await recoverImageJobs(env, recoveryAt)
      expect(interleaved()).toBe(true)
      expect(sqlite.prepare('SELECT status, lease_token, lease_until FROM image_vocabulary_jobs WHERE job_id = ?')
        .get(accepted.job.job_id)).toEqual({ status: 'recognizing', lease_token: 'consumer-lease', lease_until: leaseUntil })
      expect(sends).toHaveLength(1)

      const ack = vi.fn()
      await consumeImageJobs({ messages: [1, 2].map(() => ({ body: { job_id: accepted.job.job_id }, attempts: 1,
        ack, retry: vi.fn() })) }, env)
      expect(ack).toHaveBeenCalledTimes(2)
      expect(fetch).not.toHaveBeenCalled()
    } finally { sqlite.close() }
  })

  it('does not requeue a job completed after recovery selects it', async () => {
    const { sqlite, env, sends } = environment()
    try {
      const accepted = await acceptImageJob(env, 'owner', crypto.randomUUID(), image, 'image/png', now)
      const staleAt = new Date(now.getTime() - 10 * 60_000).toISOString()
      const recoveryAt = new Date(now.getTime() + 6 * 60_000)
      sqlite.prepare(`UPDATE image_vocabulary_jobs SET status = 'queued', updated_at = ?, next_dispatch_at = ? WHERE job_id = ?`)
        .run(staleAt, staleAt, accepted.job.job_id)
      const interleaved = interleaveBeforeRun(env, "SET status = 'received', stage = 'received',", () => {
        sqlite.prepare(`UPDATE image_vocabulary_jobs SET status = 'completed', stage = 'completed', completed_at = ?,
          updated_at = ?, lease_token = NULL, lease_until = NULL WHERE job_id = ?`)
          .run(recoveryAt.toISOString(), recoveryAt.toISOString(), accepted.job.job_id)
      })
      const fetch = vi.fn<typeof globalThis.fetch>()
      vi.stubGlobal('fetch', fetch)
      await recoverImageJobs(env, recoveryAt)
      expect(interleaved()).toBe(true)
      expect(sqlite.prepare('SELECT status FROM image_vocabulary_jobs WHERE job_id = ?').get(accepted.job.job_id))
        .toEqual({ status: 'completed' })
      expect(sends).toHaveLength(1)
      expect(fetch).not.toHaveBeenCalled()
    } finally { sqlite.close() }
  })

  it('keeps an unknown provider outcome leased if a consumer wins the needs-attention race', async () => {
    const { sqlite, env, sends } = environment()
    try {
      const accepted = await acceptImageJob(env, 'owner', crypto.randomUUID(), image, 'image/png', now)
      const staleAt = new Date(now.getTime() - 10 * 60_000).toISOString()
      const recoveryAt = new Date(now.getTime() + 6 * 60_000)
      sqlite.prepare(`UPDATE image_vocabulary_jobs SET status = 'recognizing', provider_state = 'started', provider_stage = 'recognition',
        lease_token = 'expired-lease', lease_until = ?, updated_at = ? WHERE job_id = ?`)
        .run(staleAt, staleAt, accepted.job.job_id)
      const leaseUntil = new Date(recoveryAt.getTime() + 4 * 60_000).toISOString()
      const interleaved = interleaveBeforeRun(env, "SET status = 'needs_attention', stage = 'needs_attention',", () => {
        sqlite.prepare(`UPDATE image_vocabulary_jobs SET lease_token = 'consumer-lease', lease_until = ?, updated_at = ?
          WHERE job_id = ?`).run(leaseUntil, recoveryAt.toISOString(), accepted.job.job_id)
      })
      const fetch = vi.fn<typeof globalThis.fetch>()
      vi.stubGlobal('fetch', fetch)
      await recoverImageJobs(env, recoveryAt)
      expect(interleaved()).toBe(true)
      expect(sqlite.prepare('SELECT status, provider_state, lease_token, lease_until FROM image_vocabulary_jobs WHERE job_id = ?')
        .get(accepted.job.job_id)).toEqual({ status: 'recognizing', provider_state: 'started', lease_token: 'consumer-lease', lease_until: leaseUntil })
      expect(sends).toHaveLength(1)
      expect(fetch).not.toHaveBeenCalled()
    } finally { sqlite.close() }
  })

  it('advances R2 cleanup through bounded pages of more than 100 stale objects', async () => {
    const { sqlite, env, objects, listCalls } = environment()
    try {
      for (let index = 0; index < 250; index++) objects.set(`image-jobs/${String(index).padStart(3, '0')}`, image)
      const cleanupAt = new Date(now.getTime() + 25 * 60 * 60_000)
      await recoverImageJobs(env, cleanupAt)
      expect(objects.size).toBe(150)
      expect(listCalls[0]).toEqual({ prefix: 'image-jobs/', limit: 100 })
      await recoverImageJobs(env, cleanupAt)
      expect(objects.size).toBe(50)
      expect(listCalls[1]).toEqual({ prefix: 'image-jobs/', limit: 100, cursor: 'image-jobs/099' })
      await recoverImageJobs(env, cleanupAt)
      expect(objects.size).toBe(0)
      expect(listCalls[2]).toEqual({ prefix: 'image-jobs/', limit: 100, cursor: 'image-jobs/199' })
      expect(sqlite.prepare('SELECT cursor FROM image_storage_cleanup_state WHERE singleton = 1').get())
        .toEqual({ cursor: null })
    } finally { sqlite.close() }
  })

  it('deletes original R2 keys only for expired terminal jobs', async () => {
    const { sqlite, env, objects } = environment()
    try {
      const jobs = await Promise.all(Array.from({ length: 5 }, () =>
        acceptImageJob(env, 'owner', crypto.randomUUID(), image, 'image/png', now)))
      const cleanupAt = new Date(now.getTime() + 25 * 60 * 60_000)
      for (const [index, status] of ['completed', 'failed', 'needs_attention'].entries()) {
        sqlite.prepare('UPDATE image_vocabulary_jobs SET status = ?, stage = ?, updated_at = ? WHERE job_id = ?')
          .run(status, status, now.toISOString(), jobs[index].job.job_id)
      }
      sqlite.prepare(`UPDATE image_vocabulary_jobs SET status = 'recognizing', stage = 'recognizing',
        lease_until = ?, updated_at = ? WHERE job_id = ?`)
        .run(new Date(cleanupAt.getTime() + 60_000).toISOString(), cleanupAt.toISOString(), jobs[3].job.job_id)
      sqlite.prepare(`UPDATE image_vocabulary_jobs SET status = 'completed', stage = 'completed', updated_at = ? WHERE job_id = ?`)
        .run(cleanupAt.toISOString(), jobs[4].job.job_id)
      const originalKeys = jobs.map(job => job.job.image_key!)
      const deleted: string[] = []
      const originalDelete = env.IMAGE_STORAGE!.delete.bind(env.IMAGE_STORAGE)
      env.IMAGE_STORAGE!.delete = async key => { deleted.push(key); await originalDelete(key) }

      await recoverImageJobs(env, cleanupAt)

      expect(deleted.sort()).toEqual(originalKeys.slice(0, 3).sort())
      expect(deleted.every(key => typeof key === 'string' && key.length > 0)).toBe(true)
      expect(objects.has(originalKeys[3])).toBe(true)
      expect(objects.has(originalKeys[4])).toBe(true)
      expect(sqlite.prepare('SELECT image_key FROM image_vocabulary_jobs WHERE job_id = ?').get(jobs[3].job.job_id))
        .toEqual({ image_key: originalKeys[3] })
      expect(sqlite.prepare('SELECT image_key FROM image_vocabulary_jobs WHERE job_id = ?').get(jobs[4].job.job_id))
        .toEqual({ image_key: originalKeys[4] })
    } finally { sqlite.close() }
  })

  it('retries cleanup after an R2 deletion failure without advancing the cursor', async () => {
    const { sqlite, env, objects } = environment()
    try {
      const accepted = await acceptImageJob(env, 'owner', crypto.randomUUID(), image, 'image/png', now)
      const key = accepted.job.image_key!
      sqlite.prepare(`UPDATE image_vocabulary_jobs SET status = 'completed', stage = 'completed', updated_at = ? WHERE job_id = ?`)
        .run(now.toISOString(), accepted.job.job_id)
      const cleanupAt = new Date(now.getTime() + 25 * 60 * 60_000)
      const originalDelete = env.IMAGE_STORAGE!.delete.bind(env.IMAGE_STORAGE)
      const deleted: string[] = []
      let fail = true
      env.IMAGE_STORAGE!.delete = async value => {
        deleted.push(value)
        if (fail) { fail = false; throw new Error('simulated R2 failure') }
        await originalDelete(value)
      }

      await expect(recoverImageJobs(env, cleanupAt)).rejects.toThrow('simulated R2 failure')
      expect(objects.has(key)).toBe(true)
      expect(sqlite.prepare('SELECT image_key FROM image_vocabulary_jobs WHERE job_id = ?').get(accepted.job.job_id))
        .toEqual({ image_key: null })
      expect(sqlite.prepare('SELECT cursor FROM image_storage_cleanup_state WHERE singleton = 1').get())
        .toEqual({ cursor: null })

      await recoverImageJobs(env, cleanupAt)
      expect(deleted).toEqual([key, key])
      expect(objects.has(key)).toBe(false)
    } finally { sqlite.close() }
  })
})
