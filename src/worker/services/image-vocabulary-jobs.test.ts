import { readFileSync, readdirSync } from 'node:fs'
import { DatabaseSync } from 'node:sqlite'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { PersistenceDatabase, PersistenceStatement, SqlValue } from '../persistence/d1'
import {
  acceptImageJob, imageJobStatus, imageQuota, imageQuotaWindow, processImageJob, recoverFailedImageJob,
  recoverImageJobs, type ImageJobEnv, type ImageJobMessage, type ImageStorage,
} from './image-vocabulary-jobs'

const now = new Date('2027-01-02T10:00:00.000Z')
const image = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 0])
const suggestion = { headword: 'curious', part_of_speech: 'adjective', semantic_sense: 'eager to know',
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
  const storage: ImageStorage = {
    async put(key, value) { objects.set(key, new Uint8Array(value)) },
    async get(key) { const value = objects.get(key); return value ? { async arrayBuffer() { return new Uint8Array(value).buffer as ArrayBuffer } } : null },
    async delete(key) { objects.delete(key) },
    async list() { return { objects: [...objects.keys()].map(key => ({ key, uploaded: now })), truncated: false } },
  }
  const env: ImageJobEnv = {
    DB: sqliteD1(sqlite), IMAGE_STORAGE: storage, GEMINI_API_KEY: 'test-key', GEMINI_MODEL: 'gemini-3.8-flash',
    IMAGE_JOBS: { async send(message) { sends.push(message) } },
  }
  return { sqlite, env, objects, sends }
}

describe('durable image vocabulary jobs', () => {
  afterEach(() => vi.unstubAllGlobals())

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
      await recoverImageJobs(env, new Date(now.getTime() + 60_000))
      expect(sqlite.prepare('SELECT status FROM image_vocabulary_jobs WHERE job_id = ?').get(accepted.job.job_id))
        .toEqual({ status: 'queued' })
      sqlite.prepare(`UPDATE image_vocabulary_jobs SET status = 'failed', error_code = 'IMAGE_MISSING' WHERE job_id = ?`)
        .run(accepted.job.job_id)
      expect(await recoverFailedImageJob(env, accepted.job.job_id, now)).toBe(true)
      expect(sqlite.prepare('SELECT status, dispatch_attempts FROM image_vocabulary_jobs WHERE job_id = ?').get(accepted.job.job_id))
        .toMatchObject({ status: 'queued', dispatch_attempts: 1 })
    } finally { sqlite.close() }
  })
})
