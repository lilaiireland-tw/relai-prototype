import { parseCsv } from '../../../scripts/catalog-corrections'
import { readFileSync, readdirSync } from 'node:fs'
import { DatabaseSync } from 'node:sqlite'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createApp } from '../index'
import { digestSessionToken, generateSessionToken } from '../auth/crypto'
import { createRepositories } from '../persistence'
import type { PersistenceDatabase, PersistenceStatement, SqlValue } from '../persistence/d1'
import { STARTER_BATCH_SIZE, STARTER_CATALOG_IDS, type EnglishLevel } from '../persistence/starter-pack'

const fixture = JSON.parse(readFileSync('scripts/fixtures/cefr-j-1.6-small.json', 'utf8')) as {
  dataset: string; version: string; provenance: string
  rows: { headword: string; pos: string; CEFR: string }[]
}
const reviewFixture = parseCsv(readFileSync('docs/catalog-112/starter-review.csv', 'utf8'))
const demoFixture = reviewFixture.filter(row => row.cefr_level === 'B1')
const now = '2026-10-02T10:00:00.000Z'

function sqliteD1(sqlite: DatabaseSync, starterBindings: number[]): PersistenceDatabase {
  type Executable = PersistenceStatement & { execute(): { changes: number | bigint } }
  function statement(sql: string, values: SqlValue[] = []): Executable {
    return {
      bind: (...bound) => {
        if (bound.length > 100) throw new Error('D1 bound-parameter limit exceeded')
        if (sql.includes('INSERT INTO flashcards')) starterBindings.push(bound.length)
        return statement(sql, bound)
      },
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
  let starterBindings: number[]

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date(now))
    sqlite = new DatabaseSync(':memory:')
    sqlite.exec('PRAGMA foreign_keys = ON')
    for (const name of readdirSync('migrations').filter(name => name.endsWith('.sql')).sort()) {
      sqlite.exec(readFileSync(`migrations/${name}`, 'utf8'))
    }
    starterBindings = []
    db = sqliteD1(sqlite, starterBindings)
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
       source_version, provenance, zh_tw_definition, english_example, zh_tw_example_translation,
       irish_usage, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    reviewFixture.forEach(row => add.run(row.id, row.headword, row.headword.trim().toLowerCase(),
      row.part_of_speech, row.cefr_level, fixture.dataset, fixture.version, fixture.provenance,
      row.zh_tw_definition, row.english_example, row.zh_tw_example_translation, null, now, now))
  }
  const addCatalog = (sqlite: DatabaseSync, id: string, headword: string, level: string, pos = 'noun') => {
    sqlite.prepare(`INSERT INTO vocabulary_catalog
      (id, headword, normalized_key, part_of_speech, part_of_speech_key, sense_key, semantic_sense,
       cefr_level, source_dataset, source_version, provenance, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, 'fixture sense', ?, ?, '1.6', ?, ?, ?)`).run(id, headword,
      headword.toLowerCase(), pos, pos.toLowerCase(), `fixture:${id}`, level,
      fixture.dataset, fixture.provenance, now, now)
  }
  const cardRows = (sqlite: DatabaseSync, userId: string) => sqlite.prepare(`SELECT catalog.headword AS front_content,
    COALESCE(catalog.zh_tw_definition || char(10), '') || COALESCE(catalog.english_example,
      'CEFR-J ' || catalog.cefr_level || COALESCE(' · ' || catalog.part_of_speech, '')) ||
      COALESCE(char(10) || catalog.zh_tw_example_translation, '') AS back_content,
    catalog.part_of_speech, catalog.zh_tw_definition, card.vocabulary_catalog_id,
    catalog.source_dataset || ' ' || catalog.source_version AS source,
    catalog.irish_usage
    FROM flashcards AS card JOIN vocabulary_catalog AS catalog ON catalog.id = card.vocabulary_catalog_id
    WHERE card.user_id = ? ORDER BY card.vocabulary_catalog_id`).all(userId)

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

  const seedFullPack = seedCatalog

  it('creates the same 20 reviewed cards under the D1 parameter limit for retries and a second user', async () => {
    expect(STARTER_BATCH_SIZE).toBe(20)
    seedFullPack(sqlite)
    const firstCookie = await createSession('first')
    const secondCookie = await createSession('second')
    // Both requests can read unclaimed settings before either batch runs.
    const responses = await Promise.all([choose('B1', firstCookie), choose('B1', firstCookie)])
    expect(responses.map(response => response.status)).toEqual([200, 200])
    const bodies = await Promise.all(responses.map(response => response.json()))
    expect(bodies).toContainEqual({ english_level: 'B1', starter_cards_created: 20, already_selected: false })
    expect(bodies).toContainEqual({ english_level: 'B1', starter_cards_created: 0, already_selected: true })
    expect(await (await choose('B1', firstCookie)).json())
      .toEqual({ english_level: 'B1', starter_cards_created: 0, already_selected: true })
    expect(await (await choose('B1', secondCookie)).json())
      .toEqual({ english_level: 'B1', starter_cards_created: 20, already_selected: false })
    for (const userId of ['first', 'second']) {
      expect(cardRows(sqlite, userId)).toHaveLength(20)
      expect(sqlite.prepare('SELECT total_cards_created FROM user_stats WHERE user_id = ?').get(userId))
        .toEqual({ total_cards_created: 20 })
    }
    expect(starterBindings.length).toBeGreaterThan(0)
    expect(starterBindings.every(count => count < 100)).toBe(true)
  })

  it.each([[0, 5], [5, 10], [10, 20], [0, 20]])(
    'counts actual inserts when existing cards occupy positions %i through %i', async (start, end) => {
      seedFullPack(sqlite)
      const cookie = await createSession('owner')
      await sessions.userSettings.getOrCreate('owner', 'Europe/Dublin', now)
      await sessions.userStats.getOrCreate('owner', now)
      sqlite.prepare("UPDATE user_stats SET total_cards_created = 200 WHERE user_id = 'owner'").run()
      for (let index = start; index < end; index++) {
        sqlite.prepare(`INSERT INTO flashcards (id, user_id, card_type,
          vocabulary_catalog_id, created_at, updated_at)
          VALUES (?, 'owner', 'vocabulary', ?, ?, ?)`)
          .run(`existing-${index}`, demoFixture[index].id, now, now)
      }
      const created = 20 - (end - start)
      expect(await (await choose('B1', cookie)).json())
        .toEqual({ english_level: 'B1', starter_cards_created: created, already_selected: false })
      expect(cardRows(sqlite, 'owner')).toHaveLength(20)
      expect(sqlite.prepare("SELECT total_cards_created FROM user_stats WHERE user_id = 'owner'").get())
        .toEqual({ total_cards_created: 200 + created })
      expect(await (await choose('B1', cookie)).json())
        .toEqual({ english_level: 'B1', starter_cards_created: 0, already_selected: true })
      expect(sqlite.prepare("SELECT total_cards_created FROM user_stats WHERE user_id = 'owner'").get())
        .toEqual({ total_cards_created: 200 + created })
      expect(await sessions.userSettings.find('owner')).toMatchObject({ english_level: 'B1', timezone: 'Europe/Dublin' })
    })

  it.each(['later insert', 'level claim'])('rolls back all chunks and stats after a failed %s', async failure => {
    seedFullPack(sqlite)
    const cookie = await createSession('owner')
    sqlite.exec(failure === 'later insert'
      ? `CREATE TRIGGER reject_starter BEFORE INSERT ON flashcards
          WHEN NEW.vocabulary_catalog_id = '${demoFixture[10].id}'
          BEGIN SELECT RAISE(ABORT, 'synthetic failure'); END`
      : `CREATE TRIGGER reject_claim BEFORE INSERT ON user_settings
          BEGIN SELECT RAISE(ABORT, 'synthetic failure'); END`)
    expect((await choose('B1', cookie)).status).toBe(500)
    expect(cardRows(sqlite, 'owner')).toHaveLength(0)
    expect(await sessions.userStats.find('owner')).toBeNull()
    expect(await sessions.userSettings.find('owner')).toBeNull()
    sqlite.exec(failure === 'later insert' ? 'DROP TRIGGER reject_starter' : 'DROP TRIGGER reject_claim')
    expect(await (await choose('B1', cookie)).json())
      .toEqual({ english_level: 'B1', starter_cards_created: 20, already_selected: false })
  })

  it.each(['A1', 'A2', 'B1', 'B2'])('persists %s and materializes only the selected level IDs', async level => {
    seedCatalog(sqlite)
    const cookie = await createSession(`user-${level}`)
    const response = await choose(level, cookie)
    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({ english_level: level, already_selected: false })
    expect(sqlite.prepare('SELECT english_level FROM user_settings WHERE user_id = ?').get(`user-${level}`))
      .toEqual({ english_level: level })
    const cards = cardRows(sqlite, `user-${level}`)
    expect(cards.map(card => card.vocabulary_catalog_id).sort()).toEqual([...STARTER_CATALOG_IDS[level as EnglishLevel]].sort())
    expect(cards.every(card => typeof card.vocabulary_catalog_id === 'string' &&
      card.zh_tw_definition && String(card.back_content).includes(String(card.zh_tw_definition)) &&
      String(card.source).includes('1.6'))).toBe(true)
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

  it('preserves an existing same-key card and ignores other catalog matches outside the approved IDs', async () => {
    seedCatalog(sqlite)
    const firstRow = demoFixture[0]
    addCatalog(sqlite, 'prior-level', firstRow.headword, 'A1', firstRow.part_of_speech)
    addCatalog(sqlite, 'other-pos', firstRow.headword, 'B1', 'other POS')
    const cookie = await createSession('owner')
    sqlite.prepare(`INSERT INTO flashcards (id, user_id, card_type,
      vocabulary_catalog_id, created_at, updated_at)
      VALUES ('existing', 'owner', 'vocabulary', 'prior-level', ?, ?)`).run(now, now)
    const first = await choose('A2', cookie)
    expect(first.status).toBe(200)
    expect(await first.json()).toEqual({ english_level: 'A2', starter_cards_created: 20, already_selected: false })
    expect(cardRows(sqlite, 'owner')).toHaveLength(21)
    expect(sqlite.prepare("SELECT back_content FROM flashcards WHERE id = 'existing'").get())
      .toEqual({ back_content: null })
    expect(sqlite.prepare('SELECT COUNT(DISTINCT vocabulary_catalog_id) AS count FROM flashcards WHERE user_id = ?').get('owner'))
      .toEqual({ count: 21 })
    expect(sqlite.prepare('SELECT total_cards_created FROM user_stats WHERE user_id = ?').get('owner'))
      .toEqual({ total_cards_created: 20 })
    const second = await choose('A2', cookie)
    expect(await second.json()).toEqual({ english_level: 'A2', starter_cards_created: 0, already_selected: true })
    expect(cardRows(sqlite, 'owner')).toHaveLength(21)
    expect(cardRows(sqlite, 'owner').filter(card => card.vocabulary_catalog_id !== 'prior-level')
      .every(card => card.zh_tw_definition !== null)).toBe(true)
  })

  it('isolates users, handles concurrent retries, and never changes level or deletes cards', async () => {
    seedCatalog(sqlite)
    const firstCookie = await createSession('first')
    const secondCookie = await createSession('second')
    const responses = await Promise.all([choose('A1', firstCookie), choose('A1', firstCookie)])
    expect(responses.map(response => response.status)).toEqual([200, 200])
    expect(cardRows(sqlite, 'first')).toHaveLength(20)
    expect(cardRows(sqlite, 'second')).toHaveLength(0)
    expect((await choose('A1', secondCookie)).status).toBe(200)
    expect(cardRows(sqlite, 'second')).toHaveLength(20)
    const change = await choose('B1', firstCookie)
    expect(change.status).toBe(409)
    expect(await change.json()).toMatchObject({ english_level: 'A1', error: { code: 'LEVEL_ALREADY_SELECTED' } })
    expect(cardRows(sqlite, 'first')).toHaveLength(20)
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
    expect(['A1', 'B1']).toContain(selected.english_level)
    expect(cards).toEqual([{ cefr_level: selected.english_level }])
  })

  it('does not persist a level when the selected catalog is unavailable', async () => {
    const cookie = await createSession('owner')
    const response = await choose('A1', cookie)
    expect(response.status).toBe(503)
    expect(sqlite.prepare('SELECT COUNT(*) AS count FROM user_settings').get()).toEqual({ count: 0 })
  })

  it.each(['A1', 'A2', 'B1', 'B2'] as const)('rejects every incomplete or ineligible %s pack without writes', async level => {
    seedCatalog(sqlite)
    const cookie = await createSession('owner')
    const id = STARTER_CATALOG_IDS[level][0]
    for (const [column, invalid] of [
      ['zh_tw_definition', ' '], ['english_example', null], ['zh_tw_example_translation', ''],
      ['cefr_level', level === 'B1' ? 'A1' : 'B1'], ['publication_status', 'review_needed'],
      ['part_of_speech', ''],
    ] as const) {
      const original = sqlite.prepare(`SELECT ${column} AS value FROM vocabulary_catalog WHERE id = ?`).get(id)!.value
      sqlite.prepare(`UPDATE vocabulary_catalog SET ${column} = ?, owner_user_id = ? WHERE id = ?`)
        .run(invalid, column === 'publication_status' ? 'owner' : null, id)
      expect((await choose(level, cookie)).status).toBe(503)
      expect(cardRows(sqlite, 'owner')).toHaveLength(0)
      expect(await sessions.userSettings.find('owner')).toBeNull()
      expect(await sessions.userStats.find('owner')).toBeNull()
      sqlite.prepare(`UPDATE vocabulary_catalog SET ${column} = ?, owner_user_id = NULL WHERE id = ?`).run(original, id)
    }
    sqlite.prepare('DELETE FROM vocabulary_catalog WHERE id = ?').run(id)
    expect((await choose(level, cookie)).status).toBe(503)
    expect(await sessions.userSettings.find('owner')).toBeNull()
  })

  it('rechecks completeness inside the batch if the catalog changes after selection', async () => {
    seedCatalog(sqlite)
    const cookie = await createSession('owner')
    const batch = db.batch!.bind(db)
    db.batch = async statements => {
      sqlite.prepare('UPDATE vocabulary_catalog SET english_example = NULL WHERE id = ?').run(STARTER_CATALOG_IDS.A1[0])
      return batch(statements)
    }
    expect((await choose('A1', cookie)).status).toBe(500)
    expect(cardRows(sqlite, 'owner')).toHaveLength(0)
    expect(await sessions.userSettings.find('owner')).toBeNull()
    expect(await sessions.userStats.find('owner')).toBeNull()
  })

  it('reads reviewed canonical enrichment through the catalog link without copying it to ownership rows', async () => {
    seedCatalog(sqlite)
    const reviewed = demoFixture[0]
    sqlite.prepare(`UPDATE vocabulary_catalog SET zh_tw_definition = ?, english_example = ?,
      zh_tw_example_translation = ?, irish_usage = ? WHERE id = ?`)
      .run('test-existing-zh', 'test-existing-example', 'test-existing-translation', 'test-existing-usage', reviewed.id)
    const cookie = await createSession('owner')
    expect((await choose('B1', cookie)).status).toBe(200)
    const card = cardRows(sqlite, 'owner').find(row => row.vocabulary_catalog_id === reviewed.id)!
    expect(card).toMatchObject({ front_content: reviewed.headword, part_of_speech: reviewed.part_of_speech,
      zh_tw_definition: 'test-existing-zh', vocabulary_catalog_id: reviewed.id })
    expect(card.back_content).toContain('test-existing-zh')
    expect(card.back_content).toContain('test-existing-example')
    expect(card.back_content).toContain('test-existing-translation')
    expect(sqlite.prepare("SELECT front_content, back_content, irish_usage, source FROM flashcards WHERE user_id = 'owner'").get())
      .toEqual({ front_content: null, back_content: null, irish_usage: null, source: null })
  })
})
