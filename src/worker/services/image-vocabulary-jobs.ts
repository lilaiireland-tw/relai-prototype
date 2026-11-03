import type { PersistenceDatabase } from '../persistence/d1'
import { createRepositories } from '../persistence'
import { saveVocabulary, type VocabularySaveResult } from '../persistence/vocabulary'
import { prepareVocabulary, type VocabularyPlan } from './vocabulary-catalog'
import { extractVocabularyFromImage, isImageCapableGeminiModel, requestVocabularyJson,
  type VocabularySuggestion } from './vocabulary-image'

export const IMAGE_JOB_LIMIT = 5
const LEASE_MS = 4 * 60_000
const DISPATCH_LIMIT = 5

export interface ImageJobMessage { job_id: string }
export interface ImageJobQueue {
  send(message: ImageJobMessage, options?: { contentType?: 'json'; delaySeconds?: number }): Promise<void>
}
export interface ImageStorage {
  put(key: string, value: Uint8Array): Promise<unknown>
  get(key: string): Promise<{ arrayBuffer(): Promise<ArrayBuffer> } | null>
  delete(key: string): Promise<void>
  list(options?: { prefix?: string; limit?: number; cursor?: string }): Promise<{
    objects: { key: string; uploaded: Date }[]; truncated: boolean; cursor?: string
  }>
}
export interface ImageJobEnv {
  DB: PersistenceDatabase
  IMAGE_JOBS?: ImageJobQueue
  IMAGE_STORAGE?: ImageStorage
  GEMINI_API_KEY?: string
  GEMINI_MODEL?: string
}

type JobStatus = 'received' | 'queued' | 'recognizing' | 'recognized' | 'enriching' | 'saving' | 'completed' | 'failed' | 'needs_attention'
interface ImageJobRow {
  job_id: string; user_id: string; idempotency_key: string; image_hash: string; image_key: string | null; mime_type: string
  quota_date: string; status: JobStatus; stage: string; recognized_json: string | null; plans_json: string | null
  results_json: string | null; provider_stage: string | null; provider_state: 'none' | 'started' | 'completed' | 'unknown'
  provider_results_json: string; ai_model: string | null; error_code: string | null; lease_token: string | null
  lease_until: string | null; lease_attempts: number; dispatch_attempts: number; next_dispatch_at: string
  created_at: string; updated_at: string; completed_at: string | null
}
interface ProviderResult { model: string; value: unknown }
export interface ImageQuota { limit: number; used: number; remaining: number; resets_at: string }
export type ImageJobStatusResponse = {
  job_id: string; status: JobStatus; stage: string; error_code: string | null
  suggestions?: unknown[]; results?: VocabularySaveResult[]; cards?: unknown[]
}

const dublinDate = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Europe/Dublin', year: 'numeric', month: '2-digit', day: '2-digit',
})
const dublinDateTime = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'Europe/Dublin', year: 'numeric', month: '2-digit', day: '2-digit',
  hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
})

export function imageQuotaWindow(now = new Date()) {
  const parts = Object.fromEntries(dublinDate.formatToParts(now).map(part => [part.type, part.value]))
  const quotaDate = `${parts.year}-${parts.month}-${parts.day}`
  const [year, month, day] = quotaDate.split('-').map(Number)
  const target = Date.UTC(year, month - 1, day + 1)
  const shown = Object.fromEntries(dublinDateTime.formatToParts(new Date(target)).map(part => [part.type, part.value]))
  const represented = Date.UTC(Number(shown.year), Number(shown.month) - 1, Number(shown.day),
    Number(shown.hour), Number(shown.minute), Number(shown.second))
  return { quotaDate, resetsAt: new Date(target + target - represented).toISOString() }
}

export async function imageQuota(db: PersistenceDatabase, userId: string, now = new Date()): Promise<ImageQuota> {
  const { quotaDate, resetsAt } = imageQuotaWindow(now)
  const row = await db.prepare(`SELECT COUNT(*) AS used FROM image_vocabulary_jobs WHERE user_id = ? AND quota_date = ?`)
    .bind(userId, quotaDate).first<{ used: number }>()
  if (!row) throw new Error('Could not read image request quota.')
  return { limit: IMAGE_JOB_LIMIT, used: row.used, remaining: Math.max(0, IMAGE_JOB_LIMIT - row.used), resets_at: resetsAt }
}

async function sha256(bytes: Uint8Array) {
  const digest = await crypto.subtle.digest('SHA-256', new Uint8Array(bytes).buffer)
  return [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, '0')).join('')
}

export async function acceptImageJob(
  env: ImageJobEnv, userId: string, key: string, bytes: Uint8Array, mimeType: string, now = new Date(),
): Promise<{ job: ImageJobRow; quota: ImageQuota; duplicate: boolean }> {
  const imageHash = await sha256(bytes)
  const existing = await env.DB.prepare(`SELECT * FROM image_vocabulary_jobs WHERE user_id = ? AND idempotency_key = ?`)
    .bind(userId, key).first<ImageJobRow>()
  if (existing) {
    if (existing.image_hash !== imageHash) throw new Error('IDEMPOTENCY_CONFLICT')
    if (existing.status === 'received') await dispatchImageJob(env, existing.job_id, now).catch(() => undefined)
    return { job: existing, quota: await imageQuota(env.DB, userId, now), duplicate: true }
  }
  if (!(await imageQuota(env.DB, userId, now)).remaining) throw new Error('DAILY_IMAGE_LIMIT_REACHED')
  const model = env.GEMINI_MODEL ?? 'gemini-3.8-flash'
  if (!env.GEMINI_API_KEY || !isImageCapableGeminiModel(model)) throw new Error('GEMINI_UNAVAILABLE')
  if (!env.IMAGE_STORAGE || !env.IMAGE_JOBS) throw new Error('IMAGE_JOBS_UNAVAILABLE')

  const jobId = crypto.randomUUID()
  const imageKey = `image-jobs/${jobId}`
  const at = now.toISOString()
  const { quotaDate } = imageQuotaWindow(now)
  await env.IMAGE_STORAGE.put(imageKey, bytes)
  let inserted: ImageJobRow | null
  try {
    inserted = await env.DB.prepare(`INSERT INTO image_vocabulary_jobs
      (job_id, user_id, idempotency_key, image_hash, image_key, mime_type, quota_date, status, stage,
        next_dispatch_at, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, 'received', 'received', ?, ?, ?) RETURNING *`)
      .bind(jobId, userId, key, imageHash, imageKey, mimeType, quotaDate, at, at, at).first<ImageJobRow>()
    if (!inserted) throw new Error('Could not reserve image job.')
  } catch (error) {
    await env.IMAGE_STORAGE.delete(imageKey).catch(() => undefined)
    const raced = await env.DB.prepare(`SELECT * FROM image_vocabulary_jobs WHERE user_id = ? AND idempotency_key = ?`)
      .bind(userId, key).first<ImageJobRow>()
    if (raced) {
      if (raced.image_hash !== imageHash) throw new Error('IDEMPOTENCY_CONFLICT')
      return { job: raced, quota: await imageQuota(env.DB, userId, now), duplicate: true }
    }
    if (String(error).includes('DAILY_IMAGE_LIMIT_REACHED')) throw error
    throw error
  }
  await dispatchImageJob(env, jobId, now).catch(() => undefined)
  return { job: inserted, quota: await imageQuota(env.DB, userId, now), duplicate: false }
}

export async function dispatchImageJob(env: ImageJobEnv, jobId: string, now = new Date(), knownAttempts?: number) {
  if (!env.IMAGE_JOBS) throw new Error('IMAGE_JOBS_UNAVAILABLE')
  const row = knownAttempts === undefined ? await env.DB.prepare(`SELECT dispatch_attempts FROM image_vocabulary_jobs WHERE job_id = ?`)
    .bind(jobId).first<{ dispatch_attempts: number }>() : { dispatch_attempts: knownAttempts }
  if (!row) return
  if (row.dispatch_attempts >= DISPATCH_LIMIT) {
    await env.DB.prepare(`UPDATE image_vocabulary_jobs SET status = 'failed', error_code = 'DISPATCH_RETRIES_EXHAUSTED', updated_at = ?
      WHERE job_id = ? AND status IN ('received', 'queued') AND lease_until IS NULL`)
      .bind(now.toISOString(), jobId).run()
    return
  }
  const delay = Math.min(300, 30 * 2 ** row.dispatch_attempts)
  try {
    await env.IMAGE_JOBS.send({ job_id: jobId }, { contentType: 'json' })
    const next = new Date(now.getTime() + delay * 1000).toISOString()
    await env.DB.prepare(`UPDATE image_vocabulary_jobs SET status = 'queued', stage = 'queued',
      dispatch_attempts = dispatch_attempts + 1, next_dispatch_at = ?, updated_at = ?
      WHERE job_id = ? AND status IN ('received', 'queued')`)
      .bind(next, now.toISOString(), jobId).run()
  } catch {
    const next = new Date(now.getTime() + delay * 1000).toISOString()
    await env.DB.prepare(`UPDATE image_vocabulary_jobs SET dispatch_attempts = dispatch_attempts + 1,
      next_dispatch_at = ?, updated_at = ? WHERE job_id = ? AND status IN ('received', 'queued')`)
      .bind(next, now.toISOString(), jobId).run()
  }
}

class UnknownProviderOutcome extends Error {}

async function fencedUpdate(env: ImageJobEnv, jobId: string, lease: string, sql: string, values: unknown[]) {
  const result = await env.DB.prepare(sql).bind(...values as (string | number | null)[]).run()
  if (!result.success || result.meta.changes !== 1) throw new Error(`Lost image job lease ${jobId}/${lease}`)
}

async function providerRequest(
  env: ImageJobEnv, job: ImageJobRow, lease: string, stage: string, input: unknown, schema: Record<string, unknown>, now: () => Date,
): Promise<ProviderResult | null> {
  let results: Record<string, ProviderResult> = {}
  try { results = JSON.parse(job.provider_results_json) as Record<string, ProviderResult> }
  catch { results = {} }
  if (results[stage]) return results[stage]

  await fencedUpdate(env, job.job_id, lease, `UPDATE image_vocabulary_jobs SET status = ?, stage = ?, provider_stage = ?,
      provider_state = 'started', updated_at = ? WHERE job_id = ? AND lease_token = ?`,
    [stage === 'recognition' ? 'recognizing' : 'enriching', stage, stage, now().toISOString(), job.job_id, lease])
  const response = await requestVocabularyJson(input, schema, env)
  if (!response) {
    await env.DB.prepare(`UPDATE image_vocabulary_jobs SET status = 'needs_attention', stage = 'needs_attention',
      provider_state = 'unknown', error_code = 'EXTERNAL_OUTCOME_UNKNOWN', lease_token = NULL, lease_until = NULL, updated_at = ?
      WHERE job_id = ? AND lease_token = ?`).bind(now().toISOString(), job.job_id, lease).run()
    throw new UnknownProviderOutcome()
  }
  results[stage] = response
  job.provider_results_json = JSON.stringify(results)
  await fencedUpdate(env, job.job_id, lease, `UPDATE image_vocabulary_jobs SET provider_state = 'completed',
      provider_results_json = ?, ai_model = ?, updated_at = ? WHERE job_id = ? AND lease_token = ?`,
    [JSON.stringify(results), response.model, now().toISOString(), job.job_id, lease])
  return response
}

function jobExtraction(value: string | null) {
  if (!value) return null
  try {
    const parsed = JSON.parse(value) as { version?: number; suggestions?: unknown[] }
    return parsed.version === 1 && Array.isArray(parsed.suggestions) ? parsed : null
  } catch { return null }
}

async function markNeedsAttention(env: ImageJobEnv, jobId: string, lease: string, at: string) {
  await env.DB.prepare(`UPDATE image_vocabulary_jobs SET status = 'needs_attention', stage = 'needs_attention',
    provider_state = 'unknown', error_code = 'EXTERNAL_OUTCOME_UNKNOWN', lease_token = NULL, lease_until = NULL, updated_at = ?
    WHERE job_id = ? AND lease_token = ?`).bind(at, jobId, lease).run()
}

export async function processImageJob(env: ImageJobEnv, jobId: string, clock: () => Date = () => new Date()) {
  if (!env.IMAGE_STORAGE) throw new Error('IMAGE_STORAGE_UNAVAILABLE')
  const at = clock()
  const existing = await env.DB.prepare(`SELECT * FROM image_vocabulary_jobs WHERE job_id = ?`).bind(jobId).first<ImageJobRow>()
  if (!existing || ['completed', 'failed', 'needs_attention'].includes(existing.status)) return
  if (existing.lease_until && Date.parse(existing.lease_until) > at.getTime()) return
  if (existing.provider_state === 'started' || existing.provider_state === 'unknown') {
    await markNeedsAttention(env, jobId, existing.lease_token ?? '', at.toISOString())
    return
  }
  const lease = crypto.randomUUID()
  const leaseUntil = new Date(at.getTime() + LEASE_MS).toISOString()
  const job = await env.DB.prepare(`UPDATE image_vocabulary_jobs SET lease_token = ?, lease_until = ?,
    lease_attempts = lease_attempts + 1, updated_at = ? WHERE job_id = ? AND
    (lease_until IS NULL OR lease_until <= ?) AND status NOT IN ('completed', 'failed', 'needs_attention') RETURNING *`)
    .bind(lease, leaseUntil, at.toISOString(), jobId, at.toISOString()).first<ImageJobRow>()
  if (!job) return
  try {
    const model = env.GEMINI_MODEL ?? 'gemini-3.8-flash'
    if (!env.GEMINI_API_KEY || !isImageCapableGeminiModel(model)) {
      await fencedUpdate(env, jobId, lease, `UPDATE image_vocabulary_jobs SET status = 'failed', stage = 'failed',
        error_code = 'GEMINI_UNAVAILABLE', lease_token = NULL, lease_until = NULL, updated_at = ?
        WHERE job_id = ? AND lease_token = ?`, [clock().toISOString(), jobId, lease])
      return
    }
    let extracted = jobExtraction(job.recognized_json)
    if (!extracted) {
      const object = job.image_key ? await env.IMAGE_STORAGE.get(job.image_key) : null
      if (!object) {
        await fencedUpdate(env, jobId, lease, `UPDATE image_vocabulary_jobs SET status = 'failed', stage = 'failed',
          error_code = 'IMAGE_MISSING', lease_token = NULL, lease_until = NULL, updated_at = ?
          WHERE job_id = ? AND lease_token = ?`, [clock().toISOString(), jobId, lease])
        return
      }
      const bytes = new Uint8Array(await object.arrayBuffer())
      const recognitionRequest = (input: unknown, schema: Record<string, unknown>) =>
        providerRequest(env, job, lease, 'recognition', input, schema, clock)
      const recognized = await extractVocabularyFromImage(bytes, job.mime_type, env, recognitionRequest)
      if (!recognized) {
        await fencedUpdate(env, jobId, lease, `UPDATE image_vocabulary_jobs SET status = 'failed', stage = 'failed',
          error_code = 'INVALID_PROVIDER_OUTPUT', lease_token = NULL, lease_until = NULL, updated_at = ?
          WHERE job_id = ? AND lease_token = ?`, [clock().toISOString(), jobId, lease])
        return
      }
      extracted = { version: 1, suggestions: recognized.suggestions }
      const raw = JSON.stringify(extracted)
      if (!env.DB.batch) throw new Error('D1 batch is required to persist recognition results.')
      await env.DB.batch([
        env.DB.prepare(`INSERT INTO source_items (id, user_id, source_type, raw_text, processing_status, ai_model, created_at, updated_at)
          VALUES (?, ?, 'image', ?, 'processed', ?, ?, ?) ON CONFLICT(id) DO NOTHING`)
          .bind(jobId, job.user_id, raw, recognized.model, clock().toISOString(), clock().toISOString()),
        env.DB.prepare(`UPDATE image_vocabulary_jobs SET recognized_json = ?, ai_model = ?, status = 'recognized', stage = 'recognized', updated_at = ?
          WHERE job_id = ? AND lease_token = ?`).bind(raw, recognized.model, clock().toISOString(), jobId, lease),
      ])
    }

    const savedPlans = job.plans_json ? JSON.parse(job.plans_json) as VocabularyPlan[] : null
    let plans = savedPlans
    if (!plans) {
      await fencedUpdate(env, jobId, lease, `UPDATE image_vocabulary_jobs SET status = 'enriching', stage = 'enriching', updated_at = ?
        WHERE job_id = ? AND lease_token = ?`, [clock().toISOString(), jobId, lease])
      const generationRequest = (input: unknown, schema: Record<string, unknown>,
        _env: { GEMINI_API_KEY?: string; GEMINI_MODEL?: string }, stage?: string) =>
        providerRequest(env, job, lease, stage ?? 'catalog_generation', input, schema, clock)
      plans = await prepareVocabulary(env.DB, extracted.suggestions as VocabularySuggestion[], env, job.ai_model ?? model, generationRequest)
      const serialized = JSON.stringify(plans)
      await fencedUpdate(env, jobId, lease, `UPDATE image_vocabulary_jobs SET plans_json = ?, status = 'saving', stage = 'saving', updated_at = ?
        WHERE job_id = ? AND lease_token = ?`, [serialized, clock().toISOString(), jobId, lease])
    }
    const saved = await saveVocabulary(env.DB, job.user_id, job.job_id, plans, clock().toISOString())
    const cards = await Promise.all(saved.flatMap(result => 'card_id' in result
      ? [createRepositories(env.DB).flashcards.find(job.user_id, result.card_id)] : []))
    const resultJson = JSON.stringify({ results: saved, card_ids: cards.flatMap(card => card ? [card.id] : []) })
    await fencedUpdate(env, jobId, lease, `UPDATE image_vocabulary_jobs SET results_json = ?, status = 'completed', stage = 'completed',
      completed_at = ?, image_key = NULL, lease_token = NULL, lease_until = NULL, updated_at = ?
      WHERE job_id = ? AND lease_token = ?`, [resultJson, clock().toISOString(), clock().toISOString(), jobId, lease])
    if (job.image_key) await env.IMAGE_STORAGE.delete(job.image_key).catch(() => undefined)
  } catch (error) {
    if (error instanceof UnknownProviderOutcome) return
    throw error
  }
}

export async function imageJobStatus(
  db: PersistenceDatabase, job: Pick<ImageJobRow, 'job_id' | 'user_id' | 'status' | 'stage' | 'error_code' | 'recognized_json' | 'results_json'>,
): Promise<ImageJobStatusResponse> {
  const extraction = jobExtraction(job.recognized_json)
  let results: VocabularySaveResult[] | undefined
  let cards: unknown[] | undefined
  if (job.results_json) {
    const stored = JSON.parse(job.results_json) as { results: VocabularySaveResult[]; card_ids: string[] }
    results = stored.results
    cards = (await Promise.all(stored.card_ids.map(id => createRepositories(db).flashcards.find(job.user_id, id))))
      .filter(card => card !== null)
  }
  return { job_id: job.job_id, status: job.status, stage: job.stage, error_code: job.error_code ?? null,
    ...(extraction ? { suggestions: extraction.suggestions } : {}), ...(results ? { results } : {}), ...(cards ? { cards } : {}) }
}

export async function consumeImageJobs(batch: { messages: { body: ImageJobMessage; attempts: number; ack(): void; retry(options?: { delaySeconds?: number }): void }[] }, env: ImageJobEnv) {
  for (const message of batch.messages) {
    try {
      await processImageJob(env, message.body.job_id)
      message.ack()
    } catch {
      message.retry({ delaySeconds: Math.min(300, 5 * 2 ** Math.min(message.attempts, 6)) })
    }
  }
}

export async function recoverImageJobs(env: ImageJobEnv, now = new Date()) {
  const at = now.toISOString()
  const staleBefore = new Date(now.getTime() - LEASE_MS).toISOString()
  const rows = await env.DB.prepare(`SELECT job_id, status, provider_state, lease_until, dispatch_attempts FROM (
    SELECT job_id, status, provider_state, lease_until, dispatch_attempts FROM image_vocabulary_jobs
      WHERE status = 'received' AND next_dispatch_at <= ? ORDER BY next_dispatch_at LIMIT 50
  ) UNION ALL SELECT job_id, status, provider_state, lease_until, dispatch_attempts FROM (
    SELECT job_id, status, provider_state, lease_until, dispatch_attempts FROM image_vocabulary_jobs INDEXED BY idx_image_vocabulary_jobs_recovery
      WHERE status IN ('queued', 'recognizing', 'recognized', 'enriching', 'saving') AND updated_at <= ?
        AND (lease_until IS NULL OR lease_until <= ?) ORDER BY updated_at, created_at LIMIT 50
  ) LIMIT 50`)
    .bind(at, staleBefore, at).all<Pick<ImageJobRow, 'job_id' | 'status' | 'provider_state' | 'lease_until' | 'dispatch_attempts'>>()
  for (const row of rows.results) {
    if (row.provider_state === 'started' || row.provider_state === 'unknown') {
      await env.DB.prepare(`UPDATE image_vocabulary_jobs SET status = 'needs_attention', stage = 'needs_attention',
        error_code = 'EXTERNAL_OUTCOME_UNKNOWN', lease_token = NULL, lease_until = NULL, updated_at = ? WHERE job_id = ?`)
        .bind(at, row.job_id).run()
    } else {
      await env.DB.prepare(`UPDATE image_vocabulary_jobs SET status = 'received', stage = 'received', lease_token = NULL,
        lease_until = NULL, next_dispatch_at = ?, updated_at = ? WHERE job_id = ?`)
        .bind(at, at, row.job_id).run()
      await dispatchImageJob(env, row.job_id, now, row.dispatch_attempts)
    }
  }
  await cleanupImageStorage(env, now)
}

async function cleanupImageStorage(env: ImageJobEnv, now: Date) {
  if (!env.IMAGE_STORAGE) return
  const objects = await env.IMAGE_STORAGE.list({ prefix: 'image-jobs/', limit: 100 })
  const cutoff = now.getTime() - 24 * 60 * 60_000
  const staleObjects = objects.objects.filter(object => object.uploaded.getTime() <= cutoff)
  if (!staleObjects.length) return
  const keys = staleObjects.map(object => object.key)
  const lookup = await env.DB.prepare('SELECT job_id, status, image_key, updated_at FROM image_vocabulary_jobs WHERE image_key IN (' +
    keys.map(() => '?').join(', ') + ')')
    .bind(...keys).all<{ job_id: string; status: JobStatus; image_key: string; updated_at: string }>()
  const jobs = new Map(lookup.results.map(job => [job.image_key, job]))
  for (const object of staleObjects) {
    const job = jobs.get(object.key)
    if (!job || (['completed', 'failed', 'needs_attention'].includes(job.status) && Date.parse(job.updated_at) <= cutoff)) {
      await env.IMAGE_STORAGE.delete(object.key)
      if (job) await env.DB.prepare('UPDATE image_vocabulary_jobs SET image_key = NULL WHERE job_id = ? AND image_key = ?')
        .bind(job.job_id, object.key).run()
    }
  }
}

export async function recoverFailedImageJob(env: ImageJobEnv, jobId: string, now = new Date()) {
  const result = await env.DB.prepare(`UPDATE image_vocabulary_jobs SET status = 'received', stage = 'received', error_code = NULL,
    lease_token = NULL, lease_until = NULL, dispatch_attempts = 0, next_dispatch_at = ?, updated_at = ?
    WHERE job_id = ? AND status = 'failed' AND provider_state NOT IN ('started', 'unknown')`)
    .bind(now.toISOString(), now.toISOString(), jobId).run()
  if (!result.success || result.meta.changes !== 1) return false
  await dispatchImageJob(env, jobId, now)
  return true
}
