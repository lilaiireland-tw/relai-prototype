import { readdirSync, readFileSync } from 'node:fs'
import { DatabaseSync } from 'node:sqlite'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createRepositories } from './index'
import type { PersistenceDatabase, PersistenceStatement, SqlValue } from './d1'

function sqliteD1(sqlite: DatabaseSync): PersistenceDatabase {
  function statement(sql: string, values: SqlValue[] = []): PersistenceStatement {
    return {
      bind: (...bound) => statement(sql, bound),
      async first<T>() { return (sqlite.prepare(sql).get(...values) as T | undefined) ?? null },
      async all<T>() { return { success: true, results: sqlite.prepare(sql).all(...values) as T[] } },
      async run() {
        const result = sqlite.prepare(sql).run(...values)
        return { success: true, meta: { changes: Number(result.changes) } }
      },
    }
  }
  return { prepare: sql => statement(sql) }
}

const at = '2026-09-29T10:00:00.000Z'
const later = '2026-09-29T11:00:00.000Z'
const old = '2026-09-20T10:00:00.000Z'
const card = (id: string, userId: string, createdAt = at) => ({
  id, user_id: userId, source_item_id: null, card_type: 'vocabulary',
  front_content: `front-${id}`, back_content: 'back', part_of_speech: null,
  zh_tw_definition: null, explanation: null, irish_usage: null, source: null,
  is_favorite: 0, last_reviewed_at: null, next_review_at: null,
  created_at: createdAt, updated_at: createdAt,
})

describe('product persistence with local SQLite D1 transport', () => {
  let sqlite: DatabaseSync
  let repos: ReturnType<typeof createRepositories>
  const addCard = (id: string, userId: string, createdAt = at) => {
    const row = card(id, userId, createdAt)
    sqlite.prepare(`INSERT INTO flashcards (id, user_id, source_item_id, card_type, front_content,
      back_content, part_of_speech, zh_tw_definition, explanation, irish_usage, source, is_favorite,
      last_reviewed_at, next_review_at, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(...Object.values(row))
  }

  beforeEach(() => {
    sqlite = new DatabaseSync(':memory:')
    for (const name of readdirSync('migrations').filter(name => name.endsWith('.sql')).sort()) {
      sqlite.exec(readFileSync(`migrations/${name}`, 'utf8'))
    }
    repos = createRepositories(sqliteD1(sqlite))
  })
  afterEach(() => sqlite.close())

  it('scopes card list, lookup, edits, deletion, favorite and review timestamp', async () => {
    addCard('a', 'one'); addCard('b', 'two')
    expect((await repos.flashcards.list('one')).cards.map(row => row.id)).toEqual(['a'])
    expect(await repos.flashcards.find('one', 'b')).toBeNull()
    expect(await repos.flashcards.update('one', 'b', { front_content: 'changed' }, later)).toBeNull()
    expect(await repos.flashcards.delete('one', 'b')).toEqual({ changes: 0 })
    expect(await repos.flashcards.setFavorite('one', 'b', true, later)).toBeNull()
    expect(await repos.flashcards.recordReview('one', 'b', later)).toEqual({ changes: 0 })
    expect(await repos.flashcards.find('two', 'b')).toMatchObject({ front_content: 'front-b', is_favorite: false })
    expect(await repos.flashcards.update('one', 'a', { front_content: 'new', explanation: 'note' }, later))
      .toMatchObject({ front_content: 'new', explanation: 'note', updated_at: later })
    expect(await repos.flashcards.setFavorite('one', 'a', true, later)).toMatchObject({ is_favorite: true })
    expect(await repos.flashcards.toggleFavorite('one', 'a', later)).toMatchObject({ is_favorite: false })
    expect(await repos.flashcards.recordReview('one', 'a', later)).toEqual({ changes: 1 })
    expect(await repos.flashcards.find('one', 'a')).toMatchObject({ last_reviewed_at: later })
    expect(await repos.flashcards.delete('one', 'a')).toEqual({ changes: 1 })
    expect(await repos.flashcards.find('one', 'a')).toBeNull()
    expect(await repos.flashcards.find('two', 'b')).not.toBeNull()
  })

  it('filters type, favorite and seven-day needs-review and bounds cursor pages', async () => {
    addCard('a', 'one'); addCard('b', 'one'); addCard('c', 'one', old); addCard('d', 'two')
    sqlite.prepare('UPDATE flashcards SET card_type = ?, is_favorite = ?, last_reviewed_at = ? WHERE id = ?')
      .run('error_log', 1, old, 'b')
    sqlite.prepare('UPDATE flashcards SET last_reviewed_at = ? WHERE id = ?').run(later, 'c')
    expect((await repos.flashcards.list('one', { cardType: 'error_log' })).cards.map(row => row.id)).toEqual(['b'])
    expect((await repos.flashcards.list('one', { favorite: true })).cards.map(row => row.id)).toEqual(['b'])
    expect((await repos.flashcards.list('one', { needsReviewBefore: at })).cards.map(row => row.id)).toEqual(['b', 'a'])
    const first = await repos.flashcards.list('one', { limit: 1 })
    expect(first.cards.map(row => row.id)).toEqual(['b'])
    const second = await repos.flashcards.list('one', { limit: 1, cursor: first.nextCursor! })
    expect(second.cards.map(row => row.id)).toEqual(['a'])
    for (let index = 0; index < 101; index++) addCard(`extra-${index}`, 'one', old)
    const bounded = await repos.flashcards.list('one', { limit: 999 })
    expect(bounded.cards).toHaveLength(100)
    expect(bounded.nextCursor).not.toBeNull()
    expect(await repos.flashcards.list('one', { limit: 0 })).toMatchObject({ cards: [expect.anything()] })
    await expect(repos.flashcards.list('one', { limit: Number.NaN })).rejects.toThrow('Invalid card limit.')
  })

  it('identifies same-user review replay and hides another user’s event', async () => {
    const input = { id: 'review-1', client_event_id: 'event-1', card_id: 'a',
      review_result: 'viewed', reviewed_at: at, created_at: later }
    expect(await repos.reviewEvents.insert('one', input)).toMatchObject({ kind: 'inserted', event: { user_id: 'one' } })
    expect(await repos.reviewEvents.insert('one', { ...input, id: 'review-2' }))
      .toMatchObject({ kind: 'duplicate', event: { id: 'review-1' } })
    expect(await repos.reviewEvents.findByClientEventId('two', input.client_event_id)).toBeNull()
    expect(await repos.reviewEvents.countInRange('one', at, '2026-09-30T00:00:00.000Z')).toBe(1)
    expect(await repos.reviewEvents.countInRange('two', at, '2026-09-30T00:00:00.000Z')).toBe(0)
    await expect(repos.reviewEvents.insert('two', { ...input, id: 'review-3' })).rejects.toThrow()
    expect(sqlite.prepare('SELECT COUNT(*) AS n FROM review_events').get()).toEqual({ n: 1 })
    await expect(repos.reviewEvents.insert('one', { ...input, id: 'review-1', client_event_id: 'different' }))
      .rejects.toThrow()
  })

  it('creates deterministic stats defaults and updates only the requested user', async () => {
    expect(await repos.userStats.find('one')).toBeNull()
    const initial = await repos.userStats.getOrCreate('one', at)
    expect(initial).toEqual({ user_id: 'one', streak_days: 0, longest_streak: 0,
      total_cards_created: 0, total_reviews: 0, last_active_date: null, updated_at: at })
    expect(await repos.userStats.getOrCreate('one', later)).toEqual(initial)
    await repos.userStats.getOrCreate('two', at)
    expect(await repos.userStats.update('missing', { streak_days: 1, longest_streak: 1,
      total_cards_created: 2, total_reviews: 3, last_active_date: '2026-09-29' }, later)).toEqual({ changes: 0 })
    expect(await repos.userStats.update('one', { streak_days: 1, longest_streak: 2,
      total_cards_created: 3, total_reviews: 4, last_active_date: '2026-09-29' }, later)).toEqual({ changes: 1 })
    expect(await repos.userStats.find('one')).toMatchObject({ total_reviews: 4, streak_days: 1 })
    expect(await repos.userStats.find('two')).toMatchObject({ total_reviews: 0 })
  })

  it('creates settings with schema daily goal and scopes individual and combined updates', async () => {
    expect(await repos.userSettings.find('one')).toBeNull()
    const initial = await repos.userSettings.getOrCreate('one', 'Europe/Dublin', at)
    expect(initial).toEqual({ user_id: 'one', daily_goal: 10, timezone: 'Europe/Dublin',
      english_level: null, created_at: at, updated_at: at })
    expect(await repos.userSettings.getOrCreate('one', 'UTC', later)).toEqual(initial)
    await repos.userSettings.getOrCreate('two', 'UTC', at)
    expect(await repos.userSettings.update('missing', { daily_goal: 5 }, later)).toBeNull()
    expect(await repos.userSettings.update('one', { daily_goal: 5 }, later)).toMatchObject({ daily_goal: 5 })
    expect(await repos.userSettings.update('one', { timezone: 'Asia/Taipei' }, later)).toMatchObject({ timezone: 'Asia/Taipei' })
    expect(await repos.userSettings.update('one', { daily_goal: 12, timezone: 'Europe/London' }, later))
      .toMatchObject({ daily_goal: 12, timezone: 'Europe/London' })
    expect(await repos.userSettings.find('two')).toMatchObject({ daily_goal: 10, timezone: 'UTC' })
  })
})
