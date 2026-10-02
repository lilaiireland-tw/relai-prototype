import { readdirSync, readFileSync } from 'node:fs'
import { DatabaseSync } from 'node:sqlite'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createApp } from '../index'
import { digestSessionToken, generateSessionToken } from '../auth/crypto'
import { createRepositories } from '../persistence'
import type { PersistenceDatabase, PersistenceStatement, SqlValue } from '../persistence/d1'

const now = '2026-10-02T00:30:00.000Z'
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
  return { prepare: sql => statement(sql), async batch(statements) {
    sqlite.exec('BEGIN')
    try {
      const result = statements.map(value => ({ success: true,
        meta: { changes: Number((value as Executable).execute().changes) } }))
      sqlite.exec('COMMIT')
      return result
    } catch (error) { sqlite.exec('ROLLBACK'); throw error }
  } }
}

describe('authenticated product APIs', () => {
  let sqlite: DatabaseSync
  let db: PersistenceDatabase
  let app: ReturnType<typeof createApp>
  let owner: string
  let other: string
  let guarded: string

  beforeEach(async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date(now))
    sqlite = new DatabaseSync(':memory:')
    for (const name of readdirSync('migrations').filter(name => name.endsWith('.sql')).sort()) {
      sqlite.exec(readFileSync(`migrations/${name}`, 'utf8'))
    }
    db = sqliteD1(sqlite)
    app = createApp()
    const repos = createRepositories(db)
    async function session(userId: string, mustChangePassword = false) {
      await repos.users.create({ id: userId, username: userId, display_name: userId,
        password_salt: 'synthetic', password_digest: 'synthetic', must_change_password: mustChangePassword,
        created_at: now, updated_at: now })
      const token = generateSessionToken()
      await repos.sessions.create({ id: crypto.randomUUID(), user_id: userId,
        token_digest: await digestSessionToken(token), created_at: now,
        expires_at: '2026-10-09T00:30:00.000Z' })
      return `relai_session=${token}`
    }
    owner = await session('owner')
    other = await session('other')
    guarded = await session('guarded', true)
    const addCard = (id: string, userId: string, type = 'vocabulary', reviewed: string | null = null) =>
      sqlite.prepare(`INSERT INTO flashcards (id, user_id, card_type, front_content, back_content,
        last_reviewed_at, created_at, updated_at) VALUES (?, ?, ?, ?, 'back', ?, ?, ?)`)
        .run(id, userId, type, id, reviewed, now, now)
    addCard('a', 'owner')
    addCard('b', 'owner', 'error_log', '2026-09-24T00:30:00.000Z')
    addCard('boundary', 'owner', 'vocabulary', '2026-09-25T00:30:00.000Z')
    addCard('recent', 'owner', 'vocabulary', '2026-09-25T00:30:00.001Z')
    addCard('foreign', 'other')
  })
  afterEach(() => { sqlite.close(); vi.useRealTimers() })

  function request(path: string, cookie = owner, method = 'GET', body?: unknown) {
    return app.request(`https://example.test/relaiapp/api/v1${path}`, {
      method, headers: { Cookie: cookie, ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    }, { DB: db, AUTH_PEPPER: 'synthetic' })
  }
  const event = (cardId = 'a', clientId = '123e4567-e89b-42d3-a456-426614174000') => ({
    card_id: cardId, client_event_id: clientId, review_result: 'viewed', reviewed_at: now,
  })
  const count = (table: string) => (sqlite.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get() as { n: number }).n

  it('requires a completed authenticated session and has no create-card API', async () => {
    for (const path of ['/cards', '/cards/a', '/reviews', '/stats/summary', '/settings']) {
      expect((await request(path, '', path === '/reviews' ? 'POST' : 'GET')).status).toBe(401)
      expect((await request(path, guarded, path === '/reviews' ? 'POST' : 'GET')).status).toBe(403)
    }
    expect((await request('/cards', owner, 'POST', { front_content: 'x' })).status).toBe(404)
  })

  it('isolates list, detail, edits, favorite, deletion and review by session user', async () => {
    const list = await request('/cards?user_id=other&limit=2')
    expect(list.status).toBe(400)
    const page = await request('/cards?limit=2')
    const data = await page.json() as { cards: { id: string }[]; next_cursor: string }
    expect(data.cards).toHaveLength(2)
    expect(data.cards.every(card => card.id !== 'foreign')).toBe(true)
    const nextPage = await request(`/cards?limit=2&cursor=${encodeURIComponent(data.next_cursor)}`)
    expect((await nextPage.json() as { cards: { id: string }[] }).cards).toHaveLength(2)
    expect((await request('/cards/foreign')).status).toBe(404)
    expect((await request('/cards/foreign', owner, 'PATCH', { front_content: 'no' })).status).toBe(404)
    expect((await request('/cards/foreign/favorite', owner, 'POST', { favorite: true })).status).toBe(404)
    expect((await request('/cards/foreign', owner, 'DELETE')).status).toBe(404)
    expect((await request('/reviews', owner, 'POST', event('foreign'))).status).toBe(404)
    expect((await request('/cards/foreign', other)).status).toBe(200)
    expect((await request('/cards/a/favorite', owner, 'POST', { favorite: true })).status).toBe(200)
    const favorites = await request('/cards?favorite=true')
    expect((await favorites.json() as { cards: { id: string }[] }).cards.map(card => card.id)).toEqual(['a'])
    expect(sqlite.prepare("SELECT is_favorite FROM flashcards WHERE id = 'a'").get()).toEqual({ is_favorite: 1 })
    expect((await request('/cards/a', owner, 'DELETE')).status).toBe(204)
    expect((await request('/cards/a')).status).toBe(404)
    expect((await request('/cards/foreign', other)).status).toBe(200)
  })

  it('filters needs-review at the strict seven-day boundary and validates pagination', async () => {
    const result = await request('/cards?needs_review=true')
    expect((await result.json() as { cards: { id: string }[] }).cards.map(card => card.id))
      .toEqual(['b', 'a'])
    const filtered = await request('/cards?card_type=error_log&favorite=false')
    expect((await filtered.json() as { cards: { id: string }[] }).cards.map(card => card.id)).toEqual(['b'])
    for (const query of ['limit=0', 'limit=101', 'limit=NaN', 'cursor=bad', 'card_type=other']) {
      expect((await request(`/cards?${query}`)).status).toBe(400)
    }
  })

  it('accepts only true for needs_review and omits the filter when absent', async () => {
    for (const value of ['false', '0', '1', 'TRUE', '']) {
      const response = await request(`/cards?needs_review=${value}`)
      expect(response.status).toBe(400)
      expect(await response.json()).toMatchObject({ error: { code: 'INVALID_INPUT' } })
    }
    const response = await request('/cards')
    expect(response.status).toBe(200)
    expect((await response.json() as { cards: { id: string }[] }).cards.map(card => card.id))
      .toEqual(['recent', 'boundary', 'b', 'a'])
  })

  it('strictly whitelists card fields and keeps card type and catalog identity immutable', async () => {
    for (const key of ['id', 'user_id', 'card_type', 'vocabulary_catalog_id', 'vocabulary_key',
      'source_item_id', 'source', 'created_at', 'updated_at', 'last_reviewed_at', 'next_review_at', 'is_favorite']) {
      for (const cardId of ['a', 'b']) {
        expect((await request(`/cards/${cardId}`, owner, 'PATCH',
          { part_of_speech: 'edited', [key]: 'changed' })).status).toBe(400)
      }
    }
    expect((await request('/cards/a', owner, 'PATCH', { explanation: 'wrong type' })).status).toBe(400)
    expect((await request('/cards/b', owner, 'PATCH', { zh_tw_definition: 'wrong type' })).status).toBe(400)
    expect((await request('/cards/a', owner, 'PATCH', { back_content: 'edited', zh_tw_definition: 'meaning' })).status).toBe(200)
    expect((await request('/cards/b', owner, 'PATCH', { explanation: 'fixed' })).status).toBe(200)
    expect(sqlite.prepare("SELECT card_type, back_content FROM flashcards WHERE id = 'a'").get())
      .toEqual({ card_type: 'vocabulary', back_content: 'edited' })
  })

  it('persists Error Log error-type edits through part_of_speech for the owner only', async () => {
    expect((await request('/cards/b', other, 'PATCH', { part_of_speech: 'Grammar' })).status).toBe(404)
    const response = await request('/cards/b', owner, 'PATCH', { part_of_speech: 'Grammar' })
    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({ card: { card_type: 'error_log', part_of_speech: 'Grammar' } })
    expect(await (await request('/cards/b')).json()).toMatchObject({ card: { part_of_speech: 'Grammar' } })
    expect(sqlite.prepare("SELECT card_type, part_of_speech FROM flashcards WHERE id = 'b'").get())
      .toEqual({ card_type: 'error_log', part_of_speech: 'Grammar' })
  })

  it('records explicit completion once and updates local-day goal and streak', async () => {
    expect(count('review_events')).toBe(0)
    await request('/cards/a')
    expect(count('review_events')).toBe(0)
    expect((await request('/settings', owner, 'PATCH', { timezone: 'America/Los_Angeles', daily_goal: 2 })).status).toBe(200)
    expect((await request('/reviews', owner, 'POST', event())).status).toBe(201)
    vi.setSystemTime(new Date('2026-10-02T01:30:00.000Z'))
    expect((await request('/reviews', owner, 'POST', event())).status).toBe(200)
    expect(count('review_events')).toBe(1)
    expect(sqlite.prepare("SELECT total_reviews, streak_days FROM user_stats WHERE user_id = 'owner'").get())
      .toEqual({ total_reviews: 1, streak_days: 1 })
    expect(sqlite.prepare("SELECT last_reviewed_at FROM flashcards WHERE id = 'a'").get())
      .toEqual({ last_reviewed_at: now })
    const summary = await request('/stats/summary')
    expect(await summary.json()).toMatchObject({ total_reviews: 1, total_cards: 4,
      today_completed_reviews: 1, daily_goal: 2, today_progress: 1, daily_goal_completed: false,
      streak_days: 1, longest_streak: 1 })
    expect((await request('/reviews', owner, 'POST', event('b'))).status).toBe(409)
    expect(count('review_events')).toBe(1)
  })

  it('advances streak on the next local day and rolls back a failed review batch', async () => {
    expect((await request('/reviews', owner, 'POST', event())).status).toBe(201)
    vi.setSystemTime(new Date('2026-10-03T00:30:00.000Z'))
    expect((await request('/reviews', owner, 'POST', event('b', '123e4567-e89b-42d3-a456-426614174001'))).status).toBe(201)
    expect(sqlite.prepare("SELECT total_reviews, streak_days, longest_streak FROM user_stats WHERE user_id = 'owner'").get())
      .toEqual({ total_reviews: 2, streak_days: 2, longest_streak: 2 })
    const original = sqlite.prepare("SELECT last_reviewed_at FROM flashcards WHERE id = 'recent'").get()
    sqlite.exec(`CREATE TRIGGER fail_review_stats BEFORE UPDATE ON user_stats
      BEGIN SELECT RAISE(ABORT, 'synthetic failure'); END`)
    expect((await request('/reviews', owner, 'POST', event('recent', '123e4567-e89b-42d3-a456-426614174002'))).status).toBe(500)
    expect(count('review_events')).toBe(2)
    expect(sqlite.prepare("SELECT last_reviewed_at FROM flashcards WHERE id = 'recent'").get()).toEqual(original)
    expect(sqlite.prepare("SELECT total_reviews FROM user_stats WHERE user_id = 'owner'").get()).toEqual({ total_reviews: 2 })
  })

  it('validates settings and changes level without bootstrap or deletion', async () => {
    expect((await request('/settings', owner, 'PATCH', { english_level: 'A2' })).status).toBe(409)
    sqlite.prepare("UPDATE user_settings SET english_level = 'A1' WHERE user_id = 'owner'").run()
    for (const patch of [{ daily_goal: 0 }, { timezone: 'Invalid/Zone' },
      { english_level: 'C1' }, { user_id: 'other' }, {}]) {
      expect((await request('/settings', owner, 'PATCH', patch)).status).toBe(400)
    }
    const changed = await request('/settings', owner, 'PATCH', { english_level: 'B2', daily_goal: 5 })
    expect(changed.status).toBe(200)
    expect(await changed.json()).toMatchObject({ settings: { english_level: 'B2', daily_goal: 5 } })
    expect(count('flashcards')).toBe(5)
    expect(count('vocabulary_catalog')).toBe(0)
  })
})
