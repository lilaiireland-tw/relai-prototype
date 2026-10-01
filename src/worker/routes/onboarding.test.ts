import { readFileSync, readdirSync } from 'node:fs'
import { DatabaseSync } from 'node:sqlite'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createApp } from '../index'
import { digestSessionToken, generateSessionToken } from '../auth/crypto'
import { createRepositories } from '../persistence'
import type { PersistenceDatabase, PersistenceStatement, SqlValue } from '../persistence/d1'
import { STARTER_BATCH_SIZE } from '../persistence/starter-pack'

const fixture = JSON.parse(readFileSync('scripts/fixtures/cefr-j-1.6-small.json', 'utf8')) as {
  dataset: string; version: string; provenance: string
  rows: { headword: string; pos: string; CEFR: string }[]
}
const now = '2026-10-02T10:00:00.000Z'

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

describe('initial CEFR-J onboarding API', () => {
  let sqlite: DatabaseSync
  let db: PersistenceDatabase
  let app: ReturnType<typeof createApp>
  let sessions: ReturnType<typeof createRepositories>

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date(now))
    sqlite = new DatabaseSync(':memory:')
    sqlite.exec('PRAGMA foreign_keys = ON')
    for (const name of readdirSync('migrations').filter(name => name.endsWith('.sql')).sort()) {
      sqlite.exec(readFileSync(`migrations/${name}`, 'utf8'))
    }
    db = sqliteD1(sqlite)
    sessions = createRepositories(db)
    app = createApp()
  })
  afterEach(() => {
    sqlite.close()
    vi.useRealTimers()
  })

  const seedCatalog = (sqlite: DatabaseSync) => {
    const add = sqlite.prepare(`INSERT INTO vocabulary_catalog
      (id, headword, normalized_key, part_of_speech, cefr_level, source_dataset,
       source_version, provenance, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    fixture.rows.forEach((row, index) => add.run(`catalog-${index}`, row.headword,
      row.headword.trim().toLowerCase(), row.pos, row.CEFR,
      fixture.dataset, fixture.version, fixture.provenance, now, now))
  }
  const addCatalog = (sqlite: DatabaseSync, id: string, headword: string, level: string, pos = 'noun') => {
    sqlite.prepare(`INSERT INTO vocabulary_catalog
      (id, headword, normalized_key, part_of_speech, cefr_level, source_dataset,
       source_version, provenance, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, '1.6', ?, ?, ?)`).run(id, headword, headword.toLowerCase(), pos, level,
      fixture.dataset, fixture.provenance, now, now)
  }
  const cardRows = (sqlite: DatabaseSync, userId: string) => sqlite.prepare(`SELECT front_content, back_content,
    part_of_speech, zh_tw_definition, vocabulary_catalog_id, vocabulary_key, source
    FROM flashcards WHERE user_id = ? ORDER BY vocabulary_key`).all(userId)

  async function createSession(userId: string, mustChangePassword = false) {
    await sessions.users.create({ id: userId, username: userId, display_name: userId,
      password_salt: 'synthetic', password_digest: 'synthetic', must_change_password: mustChangePassword,
      created_at: now, updated_at: now })
    const token = generateSessionToken()
    await sessions.sessions.create({ id: crypto.randomUUID(), user_id: userId,
      token_digest: await digestSessionToken(token), created_at: now,
      expires_at: '2026-10-09T10:00:00.000Z' })
    return `relai_session=${token}`
  }
  function choose(level: unknown, cookie?: string, extra: Record<string, unknown> = {}) {
    return app.request('https://example.test/relaiapp/api/v1/onboarding/level', {
      method: 'POST', headers: { 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}) },
      body: JSON.stringify({ english_level: level, ...extra }),
    }, { DB: db, AUTH_PEPPER: 'synthetic' })
  }

  it.each(['A1', 'A2', 'B1', 'B2'])('persists %s and materializes only that CEFR-J level', async level => {
    seedCatalog(sqlite)
    const cookie = await createSession(`user-${level}`)
    const response = await choose(level, cookie)
    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({ english_level: level, already_selected: false })
    expect(sqlite.prepare('SELECT english_level FROM user_settings WHERE user_id = ?').get(`user-${level}`))
      .toEqual({ english_level: level })
    const cards = cardRows(sqlite, `user-${level}`)
    expect(cards.length).toBe(fixture.rows.filter(row => row.CEFR === level)
      .map(row => row.headword.toLowerCase()).filter((key, index, keys) => keys.indexOf(key) === index).length)
    expect(cards.every(card => typeof card.vocabulary_catalog_id === 'string' &&
      card.zh_tw_definition === null && String(card.source).includes('1.6'))).toBe(true)
    expect(sqlite.prepare('SELECT total_cards_created FROM user_stats WHERE user_id = ?').get(`user-${level}`))
      .toEqual({ total_cards_created: cards.length })
  })

  it('rejects invalid levels, client user_id, missing session, and password-change accounts', async () => {
    seedCatalog(sqlite)
    expect((await choose('A1')).status).toBe(401)
    const guarded = await createSession('guarded', true)
    expect((await choose('A1', guarded)).status).toBe(403)
    const cookie = await createSession('owner')
    for (const level of ['C1', 'C2', 'A3', '', null, 1]) {
      expect((await choose(level, cookie)).status).toBe(400)
    }
    expect((await choose('A1', cookie, { user_id: 'other' })).status).toBe(400)
    expect(sqlite.prepare('SELECT COUNT(*) AS count FROM flashcards').get()).toEqual({ count: 0 })
    expect(sqlite.prepare('SELECT COUNT(*) AS count FROM user_settings').get()).toEqual({ count: 0 })
  })

  it('uses a fixed 100-key selection, dedupes POS conflicts, preserves existing cards, and retries safely', async () => {
    for (let index = 0; index < STARTER_BATCH_SIZE + 5; index++) {
      const headword = `fixture-${String(index).padStart(3, '0')}`
      addCatalog(sqlite, `cat-${index}-noun`, headword, 'A2')
      if (index < 5) addCatalog(sqlite, `cat-${index}-verb`, headword, 'A2', 'verb')
    }
    addCatalog(sqlite, 'prior-level', 'fixture-000', 'A1')
    const cookie = await createSession('owner')
    sqlite.prepare(`INSERT INTO flashcards (id, user_id, card_type, front_content, back_content,
      vocabulary_catalog_id, vocabulary_key, created_at, updated_at)
      VALUES ('existing', 'owner', 'vocabulary', 'existing', 'keep me',
      'prior-level', 'fixture-000', ?, ?)`).run(now, now)
    const first = await choose('A2', cookie)
    expect(first.status).toBe(200)
    expect(await first.json()).toEqual({ english_level: 'A2', starter_cards_created: 99, already_selected: false })
    expect(cardRows(sqlite, 'owner')).toHaveLength(100)
    expect(sqlite.prepare("SELECT back_content FROM flashcards WHERE id = 'existing'").get())
      .toEqual({ back_content: 'keep me' })
    expect(sqlite.prepare('SELECT COUNT(DISTINCT vocabulary_key) AS count FROM flashcards WHERE user_id = ?').get('owner'))
      .toEqual({ count: 100 })
    expect(sqlite.prepare('SELECT total_cards_created FROM user_stats WHERE user_id = ?').get('owner'))
      .toEqual({ total_cards_created: 99 })
    const second = await choose('A2', cookie)
    expect(await second.json()).toEqual({ english_level: 'A2', starter_cards_created: 0, already_selected: true })
    expect(cardRows(sqlite, 'owner')).toHaveLength(100)
    expect(cardRows(sqlite, 'owner').every(card => card.zh_tw_definition === null)).toBe(true)
    expect(cardRows(sqlite, 'owner').some(card => card.vocabulary_key === 'fixture-100')).toBe(false)
  })

  it('isolates users, handles concurrent retries, and never changes level or deletes cards', async () => {
    seedCatalog(sqlite)
    const firstCookie = await createSession('first')
    const secondCookie = await createSession('second')
    const responses = await Promise.all([choose('A1', firstCookie), choose('A1', firstCookie)])
    expect(responses.map(response => response.status)).toEqual([200, 200])
    expect(cardRows(sqlite, 'first')).toHaveLength(2)
    expect(cardRows(sqlite, 'second')).toHaveLength(0)
    expect((await choose('A1', secondCookie)).status).toBe(200)
    expect(cardRows(sqlite, 'second')).toHaveLength(2)
    const change = await choose('B1', firstCookie)
    expect(change.status).toBe(409)
    expect(await change.json()).toMatchObject({ english_level: 'A1', error: { code: 'LEVEL_ALREADY_SELECTED' } })
    expect(cardRows(sqlite, 'first')).toHaveLength(2)
    expect(sqlite.prepare("SELECT english_level FROM user_settings WHERE user_id = 'first'").get())
      .toEqual({ english_level: 'A1' })
  })

  it('lets only one of two concurrent initial levels claim the user', async () => {
    seedCatalog(sqlite)
    const cookie = await createSession('owner')
    const responses = await Promise.all([choose('A1', cookie), choose('B1', cookie)])
    expect(responses.map(response => response.status).sort()).toEqual([200, 409])
    const selected = sqlite.prepare("SELECT english_level FROM user_settings WHERE user_id = 'owner'")
      .get() as { english_level: string }
    const cards = sqlite.prepare(`SELECT DISTINCT catalog.cefr_level FROM flashcards AS card
      JOIN vocabulary_catalog AS catalog ON catalog.id = card.vocabulary_catalog_id
      WHERE card.user_id = 'owner'`).all() as { cefr_level: string }[]
    expect(cards).toEqual([{ cefr_level: selected.english_level }])
  })

  it('does not persist a level when the selected catalog is unavailable', async () => {
    const cookie = await createSession('owner')
    const response = await choose('A1', cookie)
    expect(response.status).toBe(503)
    expect(sqlite.prepare('SELECT COUNT(*) AS count FROM user_settings').get()).toEqual({ count: 0 })
  })

  it('copies available ReLai enrichment while retaining the catalog link', async () => {
    addCatalog(sqlite, 'enriched', 'ability', 'A2')
    sqlite.prepare(`UPDATE vocabulary_catalog SET zh_tw_definition = ?, english_example = ?,
      zh_tw_example_translation = ?, irish_usage = ? WHERE id = 'enriched'`)
      .run('test-existing-zh', 'test-existing-example', 'test-existing-translation', 'test-existing-usage')
    const cookie = await createSession('owner')
    expect((await choose('A2', cookie)).status).toBe(200)
    const card = cardRows(sqlite, 'owner')[0]
    expect(card).toMatchObject({ front_content: 'ability', part_of_speech: 'noun',
      zh_tw_definition: 'test-existing-zh', vocabulary_catalog_id: 'enriched', vocabulary_key: 'ability' })
    expect(card.back_content).toContain('test-existing-zh')
    expect(card.back_content).toContain('test-existing-example')
    expect(card.back_content).toContain('test-existing-translation')
    expect(sqlite.prepare("SELECT irish_usage FROM flashcards WHERE user_id = 'owner'").get())
      .toEqual({ irish_usage: 'test-existing-usage' })
  })
})
