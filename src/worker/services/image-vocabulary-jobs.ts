import type { PersistenceDatabase } from '../persistence/d1'
import { createRepositories } from '../persistence'
import { saveVocabulary, type VocabularySaveResult } from '../persistence/vocabulary'
import { prepareVocabulary, type VocabularyPlan } from './vocabulary-catalog'
import { ENGLISH_LEVELS } from '../persistence/starter-pack'
import { extractVocabularyFromImage, isImageCapableGeminiModel, requestVocabularyJson,
  type VocabularySuggestion } from './vocabulary-image'

export const IMAGE_JOB_LIMIT = 5
const LEASE_MS = 4 * 60_000
const DISPATCH_LIMIT = 5
const SESSION_MS = 10 * 60_000
const activeStatuses = "('received', 'queued', 'recognizing', 'recognized', 'enriching', 'saving')"

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
interface ProviderResult { model: string; value: unknown; checkpoint?: boolean }
export interface ImageQuota { limit: number; used: number; remaining: number; resets_at: string }
export type ImageJobStatusResponse = {
  job_id: string; status: JobStatus; stage: string; error_code: string | null
  suggestions?: unknown[]; results?: VocabularySaveResult[]; cards?: unknown[]
  outcome?: string
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
  await currentImageJob(env, userId, now)
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
      SELECT ?, ?, ?, ?, ?, ?, ?, 'received', 'received', ?, ?, ?
      WHERE NOT EXISTS (SELECT 1 FROM image_vocabulary_jobs WHERE user_id = ? AND status IN ${activeStatuses}) RETURNING *`)
      .bind(jobId, userId, key, imageHash, imageKey, mimeType, quotaDate, at, at, at, userId).first<ImageJobRow>()
    if (!inserted) throw new Error('IMAGE_JOB_ACTIVE')
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
  const dispatched = await env.DB.prepare('SELECT * FROM image_vocabulary_jobs WHERE job_id = ?').bind(jobId).first<ImageJobRow>()
  if (dispatched?.status === 'failed') await env.IMAGE_STORAGE.delete(imageKey).catch(() => undefined)
  return { job: dispatched ?? inserted, quota: await imageQuota(env.DB, userId, now), duplicate: false }
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
    await env.DB.prepare(`UPDATE image_vocabulary_jobs SET status = 'failed', stage = 'failed', error_code = 'QUEUE_SEND_FAILED',
      dispatch_attempts = dispatch_attempts + 1, next_dispatch_at = ?, updated_at = ?
      WHERE job_id = ? AND status IN ('received', 'queued') AND lease_token IS NULL`)
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
  if (results[stage]) return { ...results[stage], checkpoint: true }

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
    const parsed = JSON.parse(value) as { version?: number; suggestions?: unknown[]; outcome?: string }
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
  if (Date.parse(existing.created_at) + SESSION_MS <= at.getTime()) {
    await currentImageJob(env, existing.user_id, at)
    return
  }
  if (existing.lease_until && Date.parse(existing.lease_until) > at.getTime()) return
  if (existing.provider_state === 'started' || existing.provider_state === 'unknown') {
    await markNeedsAttention(env, jobId, existing.lease_token ?? '', at.toISOString())
    if (existing.image_key) await env.IMAGE_STORAGE.delete(existing.image_key).catch(() => undefined)
    return
  }
  const lease = crypto.randomUUID()
  const leaseUntil = new Date(at.getTime() + LEASE_MS).toISOString()
  const job = await env.DB.prepare(`UPDATE image_vocabulary_jobs SET lease_token = ?, lease_until = ?,
    lease_attempts = lease_attempts + 1, updated_at = ? WHERE job_id = ? AND
    (lease_until IS NULL OR lease_until <= ?) AND status NOT IN ('completed', 'failed', 'needs_attention')
      AND provider_state NOT IN ('started', 'unknown') RETURNING *`)
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
    const settings = await createRepositories(env.DB).userSettings.find(job.user_id)
    const englishLevel = ENGLISH_LEVELS.find(level => level === settings?.english_level) ?? null
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
      const recognized = await extractVocabularyFromImage(bytes, job.mime_type, env, recognitionRequest, englishLevel)
      if (!recognized) {
        await fencedUpdate(env, jobId, lease, `UPDATE image_vocabulary_jobs SET status = 'failed', stage = 'failed',
          error_code = 'INVALID_PROVIDER_OUTPUT', lease_token = NULL, lease_until = NULL, updated_at = ?
          WHERE job_id = ? AND lease_token = ?`, [clock().toISOString(), jobId, lease])
        return
      }
      extracted = { version: 1, suggestions: recognized.suggestions, outcome: recognized.outcome }
      const raw = JSON.stringify(extracted)
      if (!env.DB.batch) throw new Error('D1 batch is required to persist recognition results.')
      await env.DB.batch([
        env.DB.prepare(`INSERT INTO source_items (id, user_id, source_type, raw_text, processing_status, ai_model, created_at, updated_at)
          SELECT ?, ?, 'image', ?, 'processed', ?, ?, ? WHERE EXISTS (
            SELECT 1 FROM image_vocabulary_jobs WHERE job_id = ? AND lease_token = ?) ON CONFLICT(id) DO NOTHING`)
          .bind(jobId, job.user_id, raw, recognized.model, clock().toISOString(), clock().toISOString(), jobId, lease),
        env.DB.prepare(`UPDATE image_vocabulary_jobs SET recognized_json = ?, ai_model = ?, status = 'recognized', stage = 'recognized', updated_at = ?
          WHERE job_id = ? AND lease_token = ?`).bind(raw, recognized.model, clock().toISOString(), jobId, lease),
      ])
    }

    const savedPlans = job.plans_json ? JSON.parse(job.plans_json) as VocabularyPlan[] : null
    let plans = savedPlans
    if (savedPlans) {
      plans = extracted.suggestions!.map(value => {
        const item = value as VocabularySuggestion
        const plan = savedPlans.find(plan => plan.item.headword === item.headword &&
          plan.item.part_of_speech === item.part_of_speech && plan.item.semantic_sense === item.semantic_sense &&
          plan.item.source_context === item.source_context)
        if (!plan) throw new Error('Image job plan does not match recognized vocabulary.')
        return plan
      })
    }
    if (!plans) {
      await fencedUpdate(env, jobId, lease, `UPDATE image_vocabulary_jobs SET status = 'enriching', stage = 'enriching', updated_at = ?
        WHERE job_id = ? AND lease_token = ?`, [clock().toISOString(), jobId, lease])
      const generationRequest = (input: unknown, schema: Record<string, unknown>,
        _env: { GEMINI_API_KEY?: string; GEMINI_MODEL?: string }, stage?: string) =>
        providerRequest(env, job, lease, stage ?? 'catalog_generation', input, schema, clock)
      plans = await prepareVocabulary(env.DB, extracted.suggestions as VocabularySuggestion[], env, job.ai_model ?? model, generationRequest, job.user_id)
      const serialized = JSON.stringify(plans)
      await fencedUpdate(env, jobId, lease, `UPDATE image_vocabulary_jobs SET plans_json = ?, status = 'saving', stage = 'saving', updated_at = ?
        WHERE job_id = ? AND lease_token = ?`, [serialized, clock().toISOString(), jobId, lease])
    }
    await fencedUpdate(env, jobId, lease, `UPDATE image_vocabulary_jobs SET status = 'saving', stage = 'saving'
      WHERE job_id = ? AND lease_token = ?`, [jobId, lease])
    const saved = await saveVocabulary(env.DB, job.user_id, job.job_id, plans, clock().toISOString(), lease)
    // Preserve suggestions/results positions; apply CEFR priority only to cards.
    const rankedResults = saved.map((result, index) => ({ result, plan: plans[index] }))
    if (englishLevel) {
      const rank = (plan: VocabularyPlan) => {
        const level = ENGLISH_LEVELS.findIndex(level => level === plan.catalog?.cefr_level)
        return level < 0 ? ENGLISH_LEVELS.length : Math.abs(level - ENGLISH_LEVELS.indexOf(englishLevel))
      }
      rankedResults.sort((a, b) => rank(a.plan) - rank(b.plan))
    }
    const cards = await Promise.all(rankedResults.flatMap(({ result }) => 'card_id' in result
      ? [createRepositories(env.DB).flashcards.find(job.user_id, result.card_id)] : []))
    const hasCards = saved.some(result => result.status === 'saved' || result.status === 'already_saved')
    const noCardsSaved = saved.some(result => result.status === 'not_saved') && !hasCards
    const outcome = noCardsSaved ? undefined : extracted.outcome === 'no_english' || extracted.outcome === 'unreadable' ? extracted.outcome
      : hasCards ? saved.some(result => result.status === 'not_saved' || result.status === 'skipped') ? 'partial' : 'saved'
        : saved.some(result => result.status === 'skipped' && result.reason === 'already_owned') ? 'no_new_words' : 'no_reliable_words'
    const resultJson = JSON.stringify({ results: saved, card_ids: cards.flatMap(card => card ? [card.id] : []), outcome })
    const status = noCardsSaved ? 'failed' : 'completed'
    await fencedUpdate(env, jobId, lease, `UPDATE image_vocabulary_jobs SET results_json = ?, status = ?, stage = ?, error_code = ?,
      completed_at = ?, image_key = NULL, lease_token = NULL, lease_until = NULL, updated_at = ?
      WHERE job_id = ? AND lease_token = ?`, [resultJson, status, status, noCardsSaved ? 'NO_CARDS_SAVED' : null,
      clock().toISOString(), clock().toISOString(), jobId, lease])
    if (job.image_key) await env.IMAGE_STORAGE.delete(job.image_key).catch(() => undefined)
  } catch (error) {
    if (error instanceof UnknownProviderOutcome) return
    throw error
  } finally {
    const terminal = await env.DB.prepare(`SELECT status FROM image_vocabulary_jobs WHERE job_id = ?`)
      .bind(jobId).first<{ status: string }>()
    if (terminal && ['completed', 'failed', 'needs_attention'].includes(terminal.status) && job.image_key) {
      await env.IMAGE_STORAGE.delete(job.image_key).catch(() => undefined)
    }
  }
}

export async function imageJobStatus(
  db: PersistenceDatabase, job: Pick<ImageJobRow, 'job_id' | 'user_id' | 'status' | 'stage' | 'error_code' | 'recognized_json' | 'results_json'>,
): Promise<ImageJobStatusResponse> {
  const extraction = jobExtraction(job.recognized_json)
  let results: VocabularySaveResult[] | undefined
  let cards: unknown[] | undefined
  let outcome: string | undefined
  if (job.results_json) {
    const stored = JSON.parse(job.results_json) as { results: VocabularySaveResult[]; card_ids: string[]; outcome?: string }
    outcome = stored.outcome
    results = stored.results.map(result => result.status === 'ambiguous'
      ? { headword: result.headword, status: 'skipped', reason: 'insufficient_context' } : result)
    cards = (await Promise.all(stored.card_ids.map(id => createRepositories(db).flashcards.find(job.user_id, id))))
      .filter(card => card !== null)
  }
  return { job_id: job.job_id, status: job.status, stage: job.stage, error_code: job.error_code ?? null,
    ...(outcome ? { outcome } : {}),
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

export async function abandonImageJob(env: ImageJobEnv, userId: string, jobId: string, now = new Date()) {
  const job = await env.DB.prepare(`UPDATE image_vocabulary_jobs SET status = 'failed', stage = 'abandoned',
    error_code = 'IMAGE_JOB_ABANDONED', lease_token = NULL, lease_until = NULL, updated_at = ?
    WHERE user_id = ? AND job_id = ? AND status IN ${activeStatuses} RETURNING *`)
    .bind(now.toISOString(), userId, jobId).first<ImageJobRow>()
  if (job?.image_key) await env.IMAGE_STORAGE?.delete(job.image_key).catch(() => undefined)
  return Boolean(job)
}

// Event-driven expiration touches only this user's indexed ledger; no global recovery.
export async function currentImageJob(env: ImageJobEnv, userId: string, now = new Date()) {
  const jobs = await env.DB.prepare(`UPDATE image_vocabulary_jobs SET status = 'failed', stage = 'abandoned',
    error_code = 'IMAGE_JOB_TIMEOUT', lease_token = NULL, lease_until = NULL, updated_at = ?
    WHERE user_id = ? AND status IN ${activeStatuses} AND created_at <= ? RETURNING *`)
    .bind(now.toISOString(), userId, new Date(now.getTime() - SESSION_MS).toISOString()).all<ImageJobRow>()
  for (const job of jobs.results) {
    if (job.image_key) await env.IMAGE_STORAGE?.delete(job.image_key).catch(() => undefined)
  }
  return env.DB.prepare(`SELECT * FROM image_vocabulary_jobs WHERE user_id = ? AND status IN ${activeStatuses}
    ORDER BY created_at DESC LIMIT 1`).bind(userId).first<ImageJobRow>()
}

export async function recoverFailedImageJob(env: ImageJobEnv, jobId: string, now = new Date()) {
  const result = await env.DB.prepare(`UPDATE image_vocabulary_jobs SET status = 'received', stage = 'received', error_code = NULL,
    lease_token = NULL, lease_until = NULL, dispatch_attempts = 0, next_dispatch_at = ?, updated_at = ?
    WHERE job_id = ? AND status = 'failed' AND stage != 'abandoned' AND provider_state NOT IN ('started', 'unknown')
      AND NOT EXISTS (SELECT 1 FROM image_vocabulary_jobs AS active
        WHERE active.user_id = image_vocabulary_jobs.user_id AND active.job_id != image_vocabulary_jobs.job_id
          AND active.status IN ${activeStatuses})`)
    .bind(now.toISOString(), now.toISOString(), jobId).run()
  if (!result.success || result.meta.changes !== 1) return false
  await dispatchImageJob(env, jobId, now)
  return true
}
