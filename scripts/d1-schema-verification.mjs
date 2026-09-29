import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'

// Shared metadata-only assertions: no seeds or writes in the verifier.
export const schemaSql = "SELECT type, name, tbl_name, sql FROM sqlite_schema WHERE name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%' AND name != 'd1_migrations' ORDER BY name"

export function verifyCoreSchema(execute) {
  const query = (sql) => execute(sql).flatMap((response) => response.results)
  const schema = () => query(schemaSql)
  const prd = readFileSync('ReLai_PRD_v3.1.md', 'utf8')
  const section = prd.split('# 十二、Database Schema')[1].split('# 十三、Database')[0]
  const definitions = [...section.matchAll(/## `([^`]+)`\s+```text\s+([^`]+)```/g)]
  const tables = ['users', 'sessions', 'source_items', 'flashcards', 'review_events', 'user_stats', 'user_settings']
  assert.deepEqual(definitions.map((match) => match[1]), tables)
  const initialSchema = schema()
  assert.deepEqual(initialSchema.filter((row) => row.type === 'table').map((row) => row.name).sort(), [...tables].sort())
  assert.ok(initialSchema.every((row) => ['table', 'index'].includes(row.type)), 'No triggers or views')

  const indexLists = execute(tables.map((table) =>
    `PRAGMA index_list('${table}');`).join('\n'))
  const indexDescriptors = indexLists.flatMap((response, position) => response.results.map((index) =>
    ({ table_name: tables[position], index_name: index.name, is_unique: index.unique })))
  const indexColumns = execute(indexDescriptors.map((index) =>
    `PRAGMA index_info('${index.index_name}');`).join('\n'))
  const indexes = indexColumns.flatMap((response, position) => response.results.map((column) =>
    ({ ...indexDescriptors[position], column_name: column.name })))
  const hasIndex = (table, columns, unique = false) => indexes.some((index) =>
    index.table_name === table && (!unique || index.is_unique === 1) &&
    JSON.stringify(indexes.filter((row) => row.index_name === index.index_name).map((row) => row.column_name)) === JSON.stringify(columns))

  for (const [, table, definition] of definitions) {
    const expected = definition.trim().split(/\r?\n/).map((line) => {
      const [name, type] = line.split(' ')
      if (line.includes('UNIQUE')) assert.ok(hasIndex(table, [name], true), `${table}.${name} must be unique`)
      return { name, type, notnull: Number(line.includes('NOT NULL')),
        dflt_value: line.match(/DEFAULT (.+)$/)?.[1] ?? null, pk: Number(line.includes('PK')) }
    })
    const columns = query(`PRAGMA table_info('${table}')`).map(({ name, type, notnull, dflt_value, pk }) =>
      ({ name, type, notnull, dflt_value, pk }))
    assert.deepEqual(columns, expected, `${table}: exact PRD columns, types, nullability, defaults and primary keys`)
    assert.deepEqual(query(`PRAGMA foreign_key_list('${table}')`), [], 'No unapproved foreign key semantics')
    assert.equal(query(`SELECT COUNT(*) AS count FROM ${table}`)[0].count, 0, 'Migration must not seed data')
  }
  for (const [table, columns] of [
    ['users', ['username']], ['sessions', ['token_digest']], ['sessions', ['user_id']],
    ['sessions', ['expires_at']], ['flashcards', ['user_id', 'created_at']],
    ['flashcards', ['user_id', 'card_type']], ['flashcards', ['user_id', 'last_reviewed_at']],
    ['flashcards', ['user_id', 'is_favorite']], ['review_events', ['user_id', 'reviewed_at']],
    ['review_events', ['client_event_id']],
  ]) assert.ok(hasIndex(table, columns), `${table}(${columns}) index required`)

  const history = query('SELECT name FROM d1_migrations ORDER BY id')
  const migrations = readdirSync('migrations').filter((name) => name.endsWith('.sql')).sort()
  assert.deepEqual(history.map((row) => row.name), migrations, 'History must match committed SQL files')
  return { schema: initialSchema, history, tables, indexes }
}
